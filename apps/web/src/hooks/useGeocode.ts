import { useEffect, useState } from 'react';
import { isAbortError } from '../api';
import { config } from '../config';
import { parsePhoton, photonSearchUrl } from '../lib/photon';
import type { Place } from '../types';
import { useDebouncedValue } from './useDebouncedValue';

export const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 300;

export interface GeocodeState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  results: Place[];
}

interface Answer {
  query: string;
  status: 'ok' | 'error';
  results: Place[];
}

/**
 * Debounced place search. Answers are stored with the query they belong to;
 * "loading" and "idle" are derived during render, so effects only set state
 * when the network answers.
 */
export function useGeocode(query: string, enabled: boolean): GeocodeState {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const active = enabled && debounced.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    fetch(photonSearchUrl(config.geocoderUrl, debounced, config.searchBias, config.searchBounds), {
      signal: ctrl.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`geocoder ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((json) => setAnswer({ query: debounced, status: 'ok', results: parsePhoton(json) }))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setAnswer({ query: debounced, status: 'error', results: [] });
      });
    return () => ctrl.abort();
  }, [debounced, active]);

  if (!enabled || trimmed.length < MIN_QUERY_LENGTH) return { status: 'idle', results: [] };
  // Still typing, or waiting for this query's answer: keep showing the previous results.
  if (answer?.query !== trimmed) return { status: 'loading', results: answer?.results ?? [] };
  return answer;
}
