import type { StandReport } from '@transit/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { MAX_AGE_MS, ReportQueue } from './reportQueue';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const NOW = Date.parse('2026-12-01T10:00:00Z');
const report = (kind: StandReport['kind'], minutesAgo = 0): StandReport => ({
  standId: 'kg-auto-1',
  kind,
  reportedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
});

describe('ReportQueue', () => {
  it('delivers queued reports in order and empties the queue', async () => {
    const q = new ReportQueue(memory(), () => NOW);
    q.enqueue(report('STAND_FULL'));
    q.enqueue(report('DEPARTING_NOW'));
    const sent: string[] = [];
    const n = await q.flush(async (r) => {
      sent.push(r.kind);
      return 'ok';
    });
    expect(n).toBe(2);
    expect(sent).toEqual(['STAND_FULL', 'DEPARTING_NOW']);
    expect(q.list()).toEqual([]);
  });

  it('stops at the first network failure and keeps the rest for later', async () => {
    const q = new ReportQueue(memory(), () => NOW);
    q.enqueue(report('STAND_FULL'));
    q.enqueue(report('DEPARTING_NOW'));
    const send = vi.fn(async () => 'retry' as const);
    expect(await q.flush(send)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.list().map((i) => [i.report.kind, i.attempts])).toEqual([
      ['STAND_FULL', 1],
      ['DEPARTING_NOW', 0],
    ]);
  });

  it('treats a thrown fetch as retryable', async () => {
    const q = new ReportQueue(memory(), () => NOW);
    q.enqueue(report('STAND_EMPTY'));
    await q.flush(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(q.list()).toHaveLength(1);
  });

  it('drops rejected and stale reports', async () => {
    const q = new ReportQueue(memory(), () => NOW);
    q.enqueue(report('HEAVY_TRAFFIC', MAX_AGE_MS / 60_000 + 1)); // too old
    q.enqueue(report('STAND_FULL'));
    q.enqueue(report('DEPARTING_NOW'));
    const send = vi.fn(async (r: StandReport) =>
      r.kind === 'STAND_FULL' ? ('drop' as const) : ('ok' as const),
    );
    expect(await q.flush(send)).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.list()).toEqual([]);
  });

  it('survives corrupt or missing storage', () => {
    const store = memory();
    store.setItem('driver.reportQueue.v1', '{nope');
    expect(new ReportQueue(store).list()).toEqual([]);
    expect(new ReportQueue(null).enqueue(report('STAND_FULL')).attempts).toBe(0);
  });
});
