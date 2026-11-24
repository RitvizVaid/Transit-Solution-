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
type Send = (r: StandReport) => Promise<'ok' | 'retry' | 'drop'>;

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

  list(): QueuedReport[] {
    try {
      const parsed: unknown = JSON.parse(this.store?.getItem(KEY) ?? '[]');
      return Array.isArray(parsed) ? (parsed as QueuedReport[]) : [];
    } catch {
      return [];
    }
  }

  private save(items: QueuedReport[]) {
    try {
      this.store?.setItem(KEY, JSON.stringify(items.slice(-MAX_QUEUE)));
    } catch {
      /* storage full or disabled: the in-flight send still happens */
    }
  }

  enqueue(report: StandReport): QueuedReport {
    const item = {
      id: `${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      report,
      attempts: 0,
    };
    this.save([...this.list(), item]);
    return item;
  }

  /**
   * Sends queued reports oldest first. Stops at the first retryable failure (still
   * offline), drops reports the server rejects or that are too old. Returns how many
   * were delivered.
   */
  async flush(send: Send): Promise<number> {
    if (this.flushing) return 0;
    this.flushing = true;
    let delivered = 0;
    try {
      let items = this.list().filter(
        (i) => this.now() - Date.parse(i.report.reportedAt) < MAX_AGE_MS,
      );
      while (items.length) {
        const [head, ...rest] = items as [QueuedReport, ...QueuedReport[]];
        const result = await send(head.report).catch(() => 'retry' as const);
        if (result === 'retry') {
          items = [{ ...head, attempts: head.attempts + 1 }, ...rest];
          break;
        }
        if (result === 'ok') delivered += 1;
        items = rest;
      }
      this.save(items);
      return delivered;
    } finally {
      this.flushing = false;
    }
  }
}
