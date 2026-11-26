import type { StandReport } from '@transit/shared-types';

/**
 * Reports are saved on the device when storage is available, then flushed in order.
 * A report keeps its original
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
      this.store?.setItem(KEY, JSON.stringify(items));
      return this.store !== null;
    } catch {
      return false;
    }
  }

  enqueue(report: StandReport): {
    item: QueuedReport;
    persisted: boolean;
    reason?: 'full';
  } {
    const item = {
      id: report.reportId,
      report,
      attempts: 0,
    };
    const queued = this.list();
    if (queued.length >= MAX_QUEUE) return { item, persisted: false, reason: 'full' };
    return { item, persisted: this.save([...queued, item]) };
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
      const result = empty();
      const active = this.list(standId);
      let retryId: string | undefined;

      const fresh = active.filter((item) => {
        if (this.now() - Date.parse(item.report.reportedAt) < MAX_AGE_MS) return true;
        result.expiredIds.push(item.id);
        return false;
      });

      for (const item of fresh) {
        const outcome = await send(item.report).catch((): SendResult => ({ status: 'retry' }));
        if (outcome.status === 'retry') {
          retryId = item.id;
          break;
        }
        if (outcome.status === 'ok') result.deliveredIds.push(item.id);
        else if (outcome.reason === 'authorization') {
          result.authorizationFailed = true;
          break;
        } else if (outcome.reason === 'expired') result.expiredIds.push(item.id);
        else {
          result.rejectedIds.push(item.id);
        }
      }

      // Reports may have been added while the network request was pending.
      const completed = new Set([
        ...result.deliveredIds,
        ...result.rejectedIds,
        ...result.expiredIds,
      ]);
      this.save(
        this.list().flatMap((item) => {
          if (item.report.standId !== standId) return [item];
          if (completed.has(item.id)) return [];
          return [item.id === retryId ? { ...item, attempts: item.attempts + 1 } : item];
        }),
      );
      return result;
    } finally {
      this.flushing = false;
    }
  }
}
