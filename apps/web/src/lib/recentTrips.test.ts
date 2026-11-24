import { describe, expect, it } from 'vitest';
import type { Place } from '../types';
import {
  findRecentTrip,
  loadRecentTrips,
  MAX_RECENT_TRIPS,
  saveRecentTrip,
  tripKey,
  type RecentTrip,
} from './recentTrips';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const place = (name: string, lat: number): Place => ({ name, lat, lng: 77.2, source: 'recent' });
const trip = (i: number): RecentTrip => {
  const from = place(`A${i}`, 28 + i / 100);
  const to = place(`B${i}`, 28.5);
  return {
    key: tripKey(from, to),
    from,
    to,
    savedAt: '2026-12-01T00:00:00Z',
    plan: { itineraries: [] },
  };
};

describe('recent trips', () => {
  it('saves newest first, de-duplicates by key and caps the list', () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_RECENT_TRIPS + 2; i++) saveRecentTrip(trip(i), store);
    saveRecentTrip(trip(3), store);

    const trips = loadRecentTrips(store);
    expect(trips).toHaveLength(MAX_RECENT_TRIPS);
    expect(trips[0]?.from.name).toBe('A3');
    expect(trips.filter((t) => t.from.name === 'A3')).toHaveLength(1);
  });

  it('finds a trip by coordinates key', () => {
    const store = memoryStore();
    saveRecentTrip(trip(1), store);
    expect(findRecentTrip(trip(1).key, store)?.to.name).toBe('B1');
    expect(findRecentTrip('nope', store)).toBeNull();
  });

  it('survives corrupt storage and missing storage', () => {
    expect(loadRecentTrips(memoryStore({ 'transit.recentTrips.v1': '{oops' }))).toEqual([]);
    expect(loadRecentTrips(null)).toEqual([]);
  });

  it('keeps working when the store is full', () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(saveRecentTrip(trip(1), store)).toHaveLength(1);
  });
});
