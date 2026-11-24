import type { LatLng, PlanResponse } from '@transit/shared-types';
import type { Place } from '../types';

/**
 * Recent trips, with their last itineraries, kept in localStorage so they can be
 * reopened offline. The service worker also caches /api/v1/plan responses.
 */
export interface RecentTrip {
  key: string;
  from: Place;
  to: Place;
  savedAt: string;
  plan: PlanResponse;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'transit.recentTrips.v1';
export const MAX_RECENT_TRIPS = 5;

export function tripKey(from: LatLng, to: LatLng): string {
  return [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(',');
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // disabled storage (privacy mode, embedded webviews)
  }
}

export function loadRecentTrips(store = defaultStore()): RecentTrip[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RecentTrip[]) : [];
  } catch {
    return [];
  }
}

export function findRecentTrip(key: string, store = defaultStore()): RecentTrip | null {
  return loadRecentTrips(store).find((t) => t.key === key) ?? null;
}

export function saveRecentTrip(trip: RecentTrip, store = defaultStore()): RecentTrip[] {
  const next = [trip, ...loadRecentTrips(store).filter((t) => t.key !== trip.key)].slice(
    0,
    MAX_RECENT_TRIPS,
  );
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded: keep working without persistence.
  }
  return next;
}
