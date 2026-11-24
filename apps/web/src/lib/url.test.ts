import { describe, expect, it } from 'vitest';
import { decodePlace, encodePlace, readTripFromSearch, tripSearch } from './url';

const kg = { name: 'Kashmere Gate, Delhi', lat: 28.6675, lng: 77.2282 };

describe('place encoding', () => {
  it('round-trips, including commas in the name', () => {
    expect(decodePlace(encodePlace(kg))).toEqual({ ...kg, source: 'url' });
  });

  it('names unnamed points by their coordinates', () => {
    expect(decodePlace('28.6,77.2')?.name).toBe('28.6000, 77.2000');
  });

  it.each(['', 'abc,77,x', '28.6,,x', '95,77,x', '28,200,x', ',,'])('rejects %j', (v) => {
    expect(decodePlace(v)).toBeNull();
  });
});

describe('trip search params', () => {
  it('writes and reads both ends, keeping unrelated params', () => {
    const to = { name: 'Red Fort', lat: 28.6562, lng: 77.241 };
    const search = tripSearch(kg, to, '?lang=hi');
    const q = new URLSearchParams(search);
    expect(q.get('lang')).toBe('hi');
    const trip = readTripFromSearch(search);
    expect(trip.from?.name).toBe(kg.name);
    expect(trip.to?.lat).toBe(28.6562);
  });

  it('removes cleared ends', () => {
    expect(tripSearch(null, null, '?from=1,2,a&to=3,4,b')).toBe('');
  });
});
