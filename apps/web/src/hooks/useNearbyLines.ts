import type { LatLng, NearestLineResponse } from '@transit/shared-types';
import { useEffect, useState } from 'react';
import { fetchNearbyStops, fetchNearestLine, fetchRoutes, isAbortError } from '../api';
import { groupNearbyLines, type NearbyLine } from '../lib/nearby';

export const NEARBY_RADII = [100, 300, 500] as const;
export type NearbyRadius = (typeof NEARBY_RADII)[number];

export type NearbyState =
  | { status: 'idle' }
  | { status: 'loading'; lines: NearbyLine[] }
  /** `nearest`: undefined when lookup failed, null when no fallback is needed or available. */
  | { status: 'ok'; lines: NearbyLine[]; nearest: NearestLineResponse | null | undefined }
  | { status: 'error' };

interface Answer {
  key: string;
  ok: boolean;
  lines: NearbyLine[];
  nearest: NearestLineResponse | null | undefined;
}

export function useNearbyLines(center: LatLng | null, radius: NearbyRadius, enabled: boolean) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);

  // ~11 m precision: avoids refetching on GPS jitter.
  const lat = center ? Number(center.lat.toFixed(4)) : null;
  const lng = center ? Number(center.lng.toFixed(4)) : null;
  const key = lat === null || lng === null ? null : `${lat},${lng},${radius},${attempt}`;

  useEffect(() => {
    if (!enabled || !key || lat === null || lng === null) return;
    const ctrl = new AbortController();
    Promise.all([fetchNearbyStops({ lat, lng, radius }, ctrl.signal), fetchRoutes()])
      .then(async ([{ stops }, routes]) => {
        const lines = groupNearbyLines(stops, routes);
        // Nothing in range: look for the closest mapped corridor.
        const nearest = lines.length
          ? null
          : await fetchNearestLine({ lat, lng }, ctrl.signal).catch(() => undefined);
        if (!ctrl.signal.aborted) setAnswer({ key, ok: true, lines, nearest });
      })
      .catch((err: unknown) => {
        if (!isAbortError(err) && !ctrl.signal.aborted)
          setAnswer({ key, ok: false, lines: [], nearest: null });
      });
    return () => ctrl.abort();
  }, [key, lat, lng, radius, enabled]);

  let state: NearbyState;
  if (!enabled || !key) state = { status: 'idle' };
  else if (answer?.key !== key) state = { status: 'loading', lines: answer?.lines ?? [] };
  else
    state = answer.ok
      ? { status: 'ok', lines: answer.lines, nearest: answer.nearest }
      : { status: 'error' };

  return { state, retry: () => setAttempt((n) => n + 1) };
}
