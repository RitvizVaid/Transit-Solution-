import type { StandStatus } from '@transit/shared-types';
import { describe, expect, it } from 'vitest';
import { isLiveReport } from './standFreshness';

const NOW = Date.parse('2026-12-01T10:00:00Z');
const stand = (p: Partial<StandStatus>): StandStatus => ({
  standId: 'kg-auto-1',
  name: 'KG',
  coordinates: [77.2, 28.6],
  source: 'baseline',
  availableVehiclesEstimate: null,
  passengerQueueLevel: 'normal',
  averageWaitMinutes: 2,
  lastReportedAt: null,
  expiresAt: null,
  lastUpdated: '2026-12-01T09:00:00Z',
  ...p,
});

describe('isLiveReport', () => {
  it('never treats baseline values as live, however recent', () => {
    expect(isLiveReport(stand({ lastUpdated: '2026-12-01T09:59:59Z' }), NOW)).toBe(false);
  });
  it('treats an unexpired report as live', () => {
    expect(
      isLiveReport(stand({ source: 'reported', expiresAt: '2026-12-01T10:20:00Z' }), NOW),
    ).toBe(true);
  });
  it('stops treating a report as live once it expires, even without a push', () => {
    expect(
      isLiveReport(stand({ source: 'reported', expiresAt: '2026-12-01T09:59:00Z' }), NOW),
    ).toBe(false);
  });
});
