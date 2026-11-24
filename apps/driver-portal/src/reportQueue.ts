import type { StandReport } from '@transit/shared-types';

/**
 * Reports are never lost to a bad signal: each one goes into a persistent queue
 * first, then the queue is flushed in order. A report keeps its original
 * `reportedAt`, so a late delivery still lands at the right time on the server.
 */
export interface QueuedReport {
  id: string;
  report: StandReport;
  attempts: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
export type SendResult =
  | { status: 'ok' }
  | { status: 'retry' }
  | { status: 'drop'; reason: 'authorization' | 'expired' | 'rejected' };
type Send = (r: StandReport) => Promise<SendResult>;

export interface FlushResult {
  deliveredIds: string[];
  rejectedIds: string[];
  expiredIds: string[];
  authorizationFailed: boolean;
}

const KEY = 'driver.reportQueue.v1';
/** Older reports are useless for live status; don't replay them. */
export const MAX_AGE_MS = 30 * 60_000;
export const MAX_QUEUE = 50;

export class ReportQueue {
  private flushing = false;

  constructor(
    private readonly store: Store | null,
    private readonly now: () => number = Date.now,
  ) {}

  list(standId?: string): QueuedReport[] {
    try {
      const parsed: unknown = JSON.parse(this.store?.getItem(KEY) ?? '[]');
      const reports = Array.isArray(parsed) ? (parsed as QueuedReport[]) : [];
      return standId ? reports.filter((item) => item.report.standId === standId) : reports;
    } catch {
      return [];
    }
  }

  private save(items: QueuedReport[]): boolean {
    try {
      this.store?.setItem(KEY, JSON.stringify(items.slice(-MAX_QUEUE)));
      return this.store !== null;
    } catch {
      return false;
    }
  }

  enqueue(report: StandReport): { item: QueuedReport; persisted: boolean } {
    const item = {
      id: report.reportId,
      report,
      attempts: 0,
    };
    return { item, persisted: this.save([...this.list(), item]) };
  }

  /**
   * Sends this stand's reports oldest first. Other stands remain queued because their
   * credentials are separate. Stops at the first retryable failure.
   */
  async flush(send: Send, standId: string): Promise<FlushResult> {
    const empty = (): FlushResult => ({
      deliveredIds: [],
      rejectedIds: [],
      expiredIds: [],
      authorizationFailed: false,
    });
    if (this.flushing) return empty();
    this.flushing = true;
    try {
      const all = this.list();
      const result = empty();
      const remaining: QueuedReport[] = [];
      const active = all.filter((item) => item.report.standId === standId);
      for (const item of all) {
        if (item.report.standId !== standId) remaining.push(item);
      }

      const fresh = active.filter((item) => {
        if (this.now() - Date.parse(item.report.reportedAt) < MAX_AGE_MS) return true;
        result.expiredIds.push(item.id);
        return false;
      });

      for (let index = 0; index < fresh.length; index++) {
        const item = fresh[index]!;
        const outcome = await send(item.report).catch((): SendResult => ({ status: 'retry' }));
        if (outcome.status === 'retry') {
          remaining.push({ ...item, attempts: item.attempts + 1 }, ...fresh.slice(index + 1));
          break;
        }
        if (outcome.status === 'ok') result.deliveredIds.push(item.id);
        else if (outcome.reason === 'authorization') {
          result.authorizationFailed = true;
          remaining.push(item, ...fresh.slice(index + 1));
          break;
        } else if (outcome.reason === 'expired') result.expiredIds.push(item.id);
        else {
          result.rejectedIds.push(item.id);
        }
      }

      this.save(remaining);
      return result;
    } finally {
      this.flushing = false;
    }
  }
}
