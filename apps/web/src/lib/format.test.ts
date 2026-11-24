import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  formatDuration,
  formatFare,
  formatFrequency,
  formatRelativeTime,
} from './format';

const plain = (s: string) => s.replace(/ /g, ' ');

describe('formatDuration', () => {
  it.each([
    [0, '1 min'],
    [59, '1 min'],
    [840, '14 min'],
    [3600, '1 h'],
    [3900, '1 h 5 min'],
  ])('%i s → %s', (s, expected) => expect(plain(formatDuration(s))).toBe(expected));
});

describe('formatDistance', () => {
  it.each([
    [0, '1 m'],
    [42, '42 m'],
    [204, '200 m'],
    [1160, '1.2 km'],
    [12_400, '12 km'],
  ])('%i m → %s', (m, expected) => expect(plain(formatDistance(m))).toBe(expected));
  it('never breaks between number and unit', () => {
    expect(formatDistance(1160)).toBe('1.2 km');
  });
});

describe('formatFare', () => {
  it('formats rupees without paise for whole amounts', () => {
    expect(formatFare({ currency: 'INR', amount: 20 })).toBe('₹20');
  });
  it('keeps paise when present', () => {
    expect(formatFare({ currency: 'INR', amount: 12.5 })).toBe('₹12.50');
  });
});

describe('formatFrequency', () => {
  it('shows a range or a single value', () => {
    expect(formatFrequency({ min: 3, max: 5 })).toBe('every 3–5 min');
    expect(formatFrequency({ min: 4, max: 4 })).toBe('every 4 min');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-12-01T10:00:00Z');
  it.each([
    ['2026-12-01T09:59:30Z', 'just now'],
    ['2026-12-01T09:48:00Z', '12 min ago'],
    ['2026-12-01T07:00:00Z', '3 h ago'],
    ['2026-11-28T10:00:00Z', '3 d ago'],
    ['not a date', ''],
  ])('%s → %s', (iso, expected) => expect(formatRelativeTime(iso, now)).toBe(expected));
});
