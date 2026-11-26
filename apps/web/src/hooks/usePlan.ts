import type { PlanResponse } from '@transit/shared-types';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { fetchPlan, isAbortError } from '../api';
import { findRecentTrip, saveRecentTrip, tripKey, type RecentTrip } from '../lib/recentTrips';
import type { TripQuery } from '../types';

export type PlanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ok';
      data: PlanResponse;
      /** `cache` = saved copy shown because the network is slow or offline. */
      source: 'network' | 'cache';
      savedAt?: string;
      refreshing: boolean;
    }
  | { status: 'error'; error: Error };

type RequestIdentity = { key: string; attempt: number };
type Answer = { request: RequestIdentity } & (
  Awaited<ReturnType<typeof fetchPlan>> | { error: Error }
);

/**
 * Fetches itineraries for a trip. A saved copy of the same trip is shown
 * immediately (and kept if the network fails), then replaced by fresh results.
 * State is derived from (trip, cached copy, latest answer); the effect only
 * records answers.
 */
export function usePlan(query: TripQuery | null, onSaved?: (trips: RecentTrip[]) => void) {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const key = query ? tripKey(query.from, query.to) : null;
  // Returning to the same trip starts a new request with its own answer.
  const request = useMemo(() => (key ? { key, attempt } : null), [key, attempt]);

  const latestQuery = useEffectEvent(() => query);
  const saved = useEffectEvent((trips: RecentTrip[]) => onSaved?.(trips));

  useEffect(() => {
    const q = latestQuery();
    if (!request || !key || !q) return;
    const ctrl = new AbortController();
    fetchPlan(
      {
        fromLat: q.from.lat,
        fromLng: q.from.lng,
        toLat: q.to.lat,
        toLng: q.to.lng,
        fromName: q.from.name,
        toName: q.to.name,
      },
      ctrl.signal,
    )
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setAnswer({ request, ...result });
        if (result.cached) return;
        saved(
          saveRecentTrip({
            key,
            from: { ...q.from, source: 'recent' },
            to: { ...q.to, source: 'recent' },
            savedAt: new Date().toISOString(),
            plan: result.data,
          }),
        );
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted || isAbortError(err)) return;
        setAnswer({ request, error: err instanceof Error ? err : new Error(String(err)) });
      });
    return () => ctrl.abort();
  }, [request, key]);

  // Saved copy of this trip (a few KB of localStorage; cheap to read each render).
  const cached = key ? findRecentTrip(key) : null;

  let state: PlanState;
  const current = answer?.request === request ? answer : null;
  if (!key) state = { status: 'idle' };
  else if (current && 'data' in current) {
    state = {
      status: 'ok',
      data: current.data,
      source: current.cached ? 'cache' : 'network',
      savedAt: current.savedAt,
      refreshing: false,
    };
  } else if (cached) {
    state = {
      status: 'ok',
      data: cached.plan,
      source: 'cache',
      savedAt: cached.savedAt,
      refreshing: !current,
    };
  } else if (current && 'error' in current) state = { status: 'error', error: current.error };
  else state = { status: 'loading' };

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
