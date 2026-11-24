import { describe, expect, it } from 'vitest';
import { backoffMs, liveUrl } from './live';

describe('liveUrl', () => {
  it('uses the page origin, upgrading to wss on https', () => {
    expect(liveUrl('', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/v1/live',
    );
    expect(liveUrl('', { protocol: 'https:', host: 'transit.example' })).toBe(
      'wss://transit.example/api/v1/live',
    );
  });
  it('follows a separate API origin', () => {
    expect(liveUrl('https://api.example', { protocol: 'https:', host: 'x' })).toBe(
      'wss://api.example/api/v1/live',
    );
  });
});

describe('backoffMs', () => {
  it('doubles up to 30 s with ±20 % jitter', () => {
    expect(backoffMs(0, () => 0.5)).toBe(1000);
    expect(backoffMs(3, () => 0.5)).toBe(8000);
    expect(backoffMs(10, () => 0.5)).toBe(30_000);
    expect(backoffMs(0, () => 0)).toBe(800);
    expect(backoffMs(0, () => 1)).toBe(1200);
  });
});
