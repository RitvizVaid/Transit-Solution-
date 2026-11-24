import type { ArrivalEstimate } from '@transit/shared-types';
import { useEffect, useState } from 'react';
import { fetchArrivals, isAbortError } from '../api';

const POLL_MS = 15_000;

/**
 * Riders' vehicles heading to a stop on one route (GET /api/v1/arrivals), refreshed while
 * the page is visible. Null until the first answer or when there is nothing to ask about.
 */
export function useArrivals(
  stopId?: string,
  routeId?: string,
  towardsStopId?: string,
): ArrivalEstimate[] | null {
  const [answer, setAnswer] = useState<{ key: string; arrivals: ArrivalEstimate[] } | null>(null);
  const key = stopId ? `${stopId}|${routeId ?? ''}|${towardsStopId ?? ''}` : null;

  useEffect(() => {
    if (!stopId || !key) return;
    let ctrl: AbortController | null = null;
    const load = () => {
      if (document.hidden) return;
      ctrl?.abort();
      const c = new AbortController();
      ctrl = c;
      fetchArrivals({ stopId, routeId, towardsStopId }, c.signal)
        .then((r) => setAnswer({ key, arrivals: r.arrivals }))
        .catch((err: unknown) => {
          // Live arrivals are a bonus: on failure keep showing the schedule only.
          if (!isAbortError(err)) setAnswer({ key, arrivals: [] });
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      ctrl?.abort();
    };
  }, [key, stopId, routeId, towardsStopId]);

  return answer?.key === key ? answer.arrivals : null;
}
