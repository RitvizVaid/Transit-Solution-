import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { StandReport } from '@transit/shared-types';
import { REPORT_TTL_MS } from './stands.js';

const RETENTION_MS = 24 * 60 * 60_000;

interface StoredReport {
  reportId: string;
  standId: string;
  reportedAtMs: number;
  receivedAtMs: number;
  payload: string;
  requestHash: string;
}

export type RecordReportResult =
  | { status: 'accepted' }
  | { status: 'duplicate' }
  | { status: 'conflict' }
  | { status: 'out_of_order' }
  | { status: 'expired' };

function requestHash(report: StandReport): string {
  const canonical = Object.fromEntries(
    Object.entries(report).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Durable report history, replayed on startup and retained for retry deduplication. */
export class ReportRepository {
  private readonly db: Database.Database;
  private readonly findById: Database.Statement;
  private readonly latestForStand: Database.Statement;
  private readonly recent: Database.Statement;
  private readonly insert: Database.Statement;
  private readonly prune: Database.Statement;

  constructor(path: string) {
    if (path !== ':memory:' && !path.startsWith('file:')) {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stand_reports (
        report_id TEXT PRIMARY KEY,
        stand_id TEXT NOT NULL,
        reported_at_ms INTEGER NOT NULL,
        received_at_ms INTEGER NOT NULL,
        payload TEXT NOT NULL,
        request_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stand_reports_event_time
        ON stand_reports (stand_id, reported_at_ms);
    `);
    this.findById = this.db.prepare(
      'SELECT request_hash AS requestHash FROM stand_reports WHERE report_id = ?',
    );
    this.latestForStand = this.db.prepare(
      'SELECT MAX(reported_at_ms) AS latest FROM stand_reports WHERE stand_id = ?',
    );
    this.recent = this.db.prepare(
      `SELECT payload FROM stand_reports
       WHERE reported_at_ms >= ? AND reported_at_ms <= ? AND received_at_ms >= ?
       ORDER BY reported_at_ms, received_at_ms`,
    );
    this.insert = this.db.prepare(
      `INSERT INTO stand_reports
       (report_id, stand_id, reported_at_ms, received_at_ms, payload, request_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.prune = this.db.prepare('DELETE FROM stand_reports WHERE received_at_ms < ?');
  }

  recentReports(nowMs: number): StandReport[] {
    return (
      this.recent.all(nowMs - REPORT_TTL_MS, nowMs + 60_000, nowMs - RETENTION_MS) as Pick<
        StoredReport,
        'payload'
      >[]
    ).map((row) => JSON.parse(row.payload) as StandReport);
  }

  record(
    report: StandReport,
    receivedAtMs: number,
    apply: () => void,
    submittedReport: StandReport = report,
  ): RecordReportResult {
    const eventAtMs = Date.parse(report.reportedAt);
    const hash = requestHash(submittedReport);
    const transaction = this.db.transaction((): RecordReportResult => {
      const previous = this.findById.get(report.reportId) as
        Pick<StoredReport, 'requestHash'> | undefined;
      if (previous)
        return previous.requestHash === hash ? { status: 'duplicate' } : { status: 'conflict' };
      if (receivedAtMs - eventAtMs > REPORT_TTL_MS) return { status: 'expired' };

      const latest = this.latestForStand.get(report.standId) as { latest: number | null };
      if (latest.latest !== null && eventAtMs < latest.latest) return { status: 'out_of_order' };

      this.insert.run(
        report.reportId,
        report.standId,
        eventAtMs,
        receivedAtMs,
        JSON.stringify(report),
        hash,
      );
      apply();
      this.prune.run(receivedAtMs - RETENTION_MS);
      return { status: 'accepted' };
    });
    return transaction();
  }

  close(): void {
    this.db.close();
  }
}
