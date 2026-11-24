import type { StandStatus } from '@transit/shared-types';

/**
 * Whether a stand's values come from a report that is still in effect. The server decides
 * (`source`); `expiresAt` also covers a page that missed the expiry push (socket down).
 */
export function isLiveReport(s: StandStatus, now: number): boolean {
  return s.source === 'reported' && !!s.expiresAt && Date.parse(s.expiresAt) > now;
}
