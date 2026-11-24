import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { RateLimiter } from './rateLimit.js';

describe('RateLimiter', () => {
  it('allows up to the limit per key per window, then resets', () => {
    let now = 60_000 * 1000;
    const l = new RateLimiter(2, 60_000, () => now);
    expect([l.hit('a'), l.hit('a'), l.hit('a')]).toEqual([true, true, false]);
    expect(l.hit('b')).toBe(true);
    expect(l.retryAfterSec()).toBe(60);
    now += 60_000;
    expect(l.hit('a')).toBe(true);
  });
});

describe('loadConfig reporting safety', () => {
  const TOKENS = JSON.stringify({ 'kg-auto-1': 'x'.repeat(40) });

  it('turns simulated reports off when real reporting is configured', () => {
    const c = loadConfig({ SIMULATE: 'true', REPORT_TOKENS_JSON: TOKENS });
    expect(c.simulateReports).toBe(false);
    expect(c.simulateVehicles).toBe(true);
  });

  it('refuses an explicit request to mix real and simulated reports', () => {
    expect(() => loadConfig({ SIMULATE_REPORTS: 'true', REPORT_TOKENS_JSON: TOKENS })).toThrow(
      /SIMULATE_REPORTS/,
    );
  });

  it('keeps simulated reports for demos without reporting', () => {
    expect(loadConfig({ SIMULATE: 'true' }).simulateReports).toBe(true);
  });

  it('can disable rate limiting only explicitly', () => {
    expect(loadConfig({}).rateLimits).not.toBe(false);
    expect(loadConfig({ RATE_LIMIT: 'off' }).rateLimits).toBe(false);
  });
});
