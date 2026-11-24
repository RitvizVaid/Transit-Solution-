import type {
  NearbyStopsResponse,
  NearestLineResponse,
  PlanRequest,
  PlanResponse,
  RidePosition,
  RidePositionResponse,
  StandStatus,
  TransitRoute,
} from '@transit/shared-types';
import { config } from './config';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, path: string) {
    super(`${path} failed with ${status}`);
    this.status = status;
  }
}

export const isAbortError = (err: unknown) =>
  err instanceof DOMException && err.name === 'AbortError';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

const toQuery = (params: object) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export const fetchPlan = (req: PlanRequest, signal?: AbortSignal) =>
  getJson<PlanResponse>(`/api/v1/plan?${toQuery(req)}`, signal);

export const fetchStand = (standId: string, signal?: AbortSignal) =>
  getJson<StandStatus>(`/api/v1/stands/${encodeURIComponent(standId)}`, signal);

export const fetchNearbyStops = (
  q: { lat: number; lng: number; radius: number },
  signal?: AbortSignal,
) => getJson<NearbyStopsResponse>(`/api/v1/stops/nearby?${toQuery(q)}`, signal);

export const fetchNearestLine = (q: { lat: number; lng: number }, signal?: AbortSignal) =>
  getJson<NearestLineResponse>(`/api/v1/routes/nearest?${toQuery(q)}`, signal);

let routesPromise: Promise<TransitRoute[]> | null = null;
/** Routes change rarely; fetched once per session (and cached by the service worker). */
export function fetchRoutes(): Promise<TransitRoute[]> {
  routesPromise ??= getJson<TransitRoute[]>('/api/v1/routes').catch((err: unknown) => {
    routesPromise = null; // allow a retry
    throw err;
  });
  return routesPromise;
}

/** Crowd ride sharing: send where the vehicle the commuter is riding is now. */
export async function postRidePosition(pos: RidePosition): Promise<RidePositionResponse> {
  const res = await fetch(`${config.apiBase}/api/v1/rides/positions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(pos),
  });
  if (!res.ok) throw new ApiError(res.status, '/api/v1/rides/positions');
  return (await res.json()) as RidePositionResponse;
}

export async function endRide(rideId: string): Promise<void> {
  const res = await fetch(`${config.apiBase}/api/v1/rides/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rideId }),
    keepalive: true,
  });
  if (!res.ok) throw new ApiError(res.status, '/api/v1/rides/end');
}
