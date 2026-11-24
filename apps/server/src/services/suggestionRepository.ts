import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { RouteSuggestion, RouteSuggestionInput } from '@transit/shared-types';

/** ~110 m: enough to place a corridor, not enough to pinpoint someone's home. */
const roundCoord = (n: number) => Math.round(n * 1000) / 1000;

interface Row {
  id: string;
  created_at_ms: number;
  status: RouteSuggestion['status'];
  payload: string;
}

/**
 * Commuter route suggestions, held for review. Nothing here is used for planning or shown
 * to other commuters: a reviewer checks it with operators first (see docs).
 */
export class SuggestionRepository {
  private readonly db: Database.Database;
  private readonly insert: Database.Statement;
  private readonly pending: Database.Statement;

  constructor(path: string) {
    if (path !== ':memory:' && !path.startsWith('file:')) {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS route_suggestions (
        id TEXT PRIMARY KEY,
        created_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS route_suggestions_status
        ON route_suggestions (status, created_at_ms);
    `);
    this.insert = this.db.prepare(
      'INSERT INTO route_suggestions (id, created_at_ms, status, payload) VALUES (?, ?, ?, ?)',
    );
    this.pending = this.db.prepare(
      `SELECT id, created_at_ms, status, payload FROM route_suggestions
       WHERE status = 'pending' ORDER BY created_at_ms DESC LIMIT ?`,
    );
  }

  add(input: RouteSuggestionInput, nowMs: number): RouteSuggestion {
    const clean: RouteSuggestionInput = {
      ...input,
      from: { ...input.from, lat: roundCoord(input.from.lat), lng: roundCoord(input.from.lng) },
      to: { ...input.to, lat: roundCoord(input.to.lat), lng: roundCoord(input.to.lng) },
    };
    const suggestion: RouteSuggestion = {
      ...clean,
      id: randomUUID(),
      status: 'pending',
      createdAt: new Date(nowMs).toISOString(),
    };
    this.insert.run(suggestion.id, nowMs, suggestion.status, JSON.stringify(clean));
    return suggestion;
  }

  listPending(limit = 200): RouteSuggestion[] {
    return (this.pending.all(limit) as Row[]).map((r) => ({
      ...(JSON.parse(r.payload) as RouteSuggestionInput),
      id: r.id,
      status: r.status,
      createdAt: new Date(r.created_at_ms).toISOString(),
    }));
  }

  close(): void {
    this.db.close();
  }
}
