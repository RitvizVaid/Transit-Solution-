import { createHash } from 'node:crypto';
import type {
  ArrivalEstimate,
  LatLng,
  RidePosition,
  RidePositionResponse,
  VehiclePosition,
} from '@transit/shared-types';
import type { NetworkRoute, Pattern, TransitNetwork } from '../gtfs/network.js';
import { haversineMeters } from './geo.js';

/** Tunables for crowd-shared rides. Exported so tests can reason about them. */
export const RIDES = {
  /** A fix further than this from the route line is not shown as that route's vehicle. */
  maxOffRouteM: 120,
  /** Fixes less accurate than this are ignored (indoor / cell-tower positions). */
  maxAccuracyM: 80,
  /** Phones send every ~5 s; faster updates are refused to bound load. */
  minIntervalMs: 3_000,
  /** Shared autos and minibuses in a city: anything faster between fixes is a GPS jump. */
  maxSpeedKmh: 90,
  /** A ride vanishes from the map when its phone has been silent this long. */
  silentAfterMs: 60_000,
  /** Fixes taken longer ago than this (or in the future) are not "live". */
  maxFixAgeMs: 60_000,
  /** Sharing stops after this; the phone must start a new ride. */
  maxRideMs: 3 * 60 * 60_000,
  /** Upper bound on simultaneously tracked rides (memory / abuse guard). */
  maxActiveRides: 5_000,
  /** Arrival estimates further out than this are not offered (too uncertain to help). */
  maxEtaSec: 30 * 60,
  /** Within this distance of the stop the vehicle counts as there / gone, not arriving. */
  atStopM: 25,
} as const;

/**
 * Seconds from the start of the pattern to `alongM`, interpolated between the
 * timetable running times of the surrounding stops.
 */
export function offsetAt(pattern: Pattern, alongM: number): number {
  const stops = pattern.stops;
  let i = 0;
  while (i < stops.length - 2 && stops[i + 1]!.distM <= alongM) i++;
  const a = stops[i]!;
  const b = stops[i + 1] ?? a;
  const span = b.distM - a.distM;
  const t = span > 0 ? Math.max(0, Math.min(1, (alongM - a.distM) / span)) : 0;
  return a.offsetSec + (b.offsetSec - a.offsetSec) * t;
}

interface Ride {
  vehicleId: string;
  route: NetworkRoute;
  /** Direction the rider is travelling, once it can be told from two fixes. */
  pattern: Pattern;
  startedAt: number;
  lastAcceptedAt: number;
  lastFixAt: number;
  lastPoint: LatLng;
  alongM: number;
  vehicle: VehiclePosition;
}

/** Public vehicle id: derived from the secret ride id, but does not reveal it. */
export const vehicleIdFor = (rideId: string) =>
  `crowd-${createHash('sha256').update(rideId).digest('hex').slice(0, 16)}`;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Live vehicles reported by commuters riding them. Each accepted fix is snapped onto
 * the route, so the map shows where the vehicle is on its corridor and never the
 * rider's exact GPS point. In memory only: nothing about a ride is stored on disk.
 */
export class RideTracker {
  private readonly rides = new Map<string, Ride>();

  constructor(
    private readonly net: TransitNetwork,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.rides.size;
  }

  report(pos: RidePosition): RidePositionResponse & { vehicle?: VehiclePosition } {
    const now = this.now();
    this.prune(now);

    const route = this.net.routes.get(pos.routeId);
    const patterns = this.net.patterns.filter((p) => p.routeId === pos.routeId);
    if (!route || patterns.length === 0) return { accepted: false, reason: 'unknown_route' };

    const fixAt = Date.parse(pos.recordedAt);
    if (!Number.isFinite(fixAt) || Math.abs(now - fixAt) > RIDES.maxFixAgeMs) {
      return { accepted: false, reason: 'stale' };
    }
    if (pos.accuracyM !== undefined && pos.accuracyM > RIDES.maxAccuracyM) {
      return { accepted: false, reason: 'inaccurate' };
    }

    const point: LatLng = { lng: pos.coordinates[0], lat: pos.coordinates[1] };
    const prev = this.rides.get(pos.rideId);
    if (prev && prev.route.id !== route.id) {
      // A ride id belongs to one route; switching vehicles means starting a new ride.
      return { accepted: false, reason: 'unknown_route' };
    }
    if (prev && now - prev.startedAt > RIDES.maxRideMs) {
      prev.lastAcceptedAt = now; // still talking: keep refusing instead of forgetting it
      return { accepted: false, reason: 'ride_too_long' };
    }
    if (prev && now - prev.lastAcceptedAt < RIDES.minIntervalMs) {
      return { accepted: false, reason: 'too_frequent' };
    }
    if (!prev && this.rides.size >= RIDES.maxActiveRides) {
      return { accepted: false, reason: 'capacity' };
    }

    // Snap to the closest direction of the route; prefer the one this ride already follows,
    // and the one it moves forward along (both directions usually share the same street).
    const candidates = patterns.map((pattern) => ({ pattern, ...pattern.shape.project(point) }));
    const offsetM = Math.min(...candidates.map((c) => c.offsetM));
    if (offsetM > RIDES.maxOffRouteM) {
      return { accepted: false, reason: 'off_route', offsetMeters: Math.round(offsetM) };
    }
    const near = candidates.filter((c) => c.offsetM <= offsetM + 15);
    const forward = prev && near.find((c) => c.pattern === prev.pattern && c.alongM >= prev.alongM);
    const otherForward =
      prev && near.find((c) => c.pattern !== prev.pattern && c.alongM > prev.alongM);
    const pick =
      forward ??
      otherForward ??
      (prev && near.find((c) => c.pattern === prev.pattern)) ??
      near.sort((a, b) => a.offsetM - b.offsetM)[0]!;

    let speedKmh: number | undefined;
    if (prev) {
      const seconds = (fixAt - prev.lastFixAt) / 1000;
      const metres = haversineMeters(prev.lastPoint, point);
      if (seconds <= 0) return { accepted: false, reason: 'stale' };
      speedKmh = (metres / seconds) * 3.6;
      if (speedKmh > RIDES.maxSpeedKmh) return { accepted: false, reason: 'implausible_speed' };
    }

    const vehicleId = prev?.vehicleId ?? vehicleIdFor(pos.rideId);
    const vehicle: VehiclePosition = {
      vehicleId,
      routeId: route.id,
      mode: route.mode,
      coordinates: [round6(pick.point.lng), round6(pick.point.lat)],
      bearing: Math.round(pick.pattern.shape.at(pick.alongM).bearing),
      speedKmh: speedKmh === undefined ? undefined : Math.round(speedKmh),
      timestamp: new Date(fixAt).toISOString(),
      source: 'crowd',
      // A rider who answered "how full?" once keeps that answer until they change it.
      occupancy: pos.occupancy ?? prev?.vehicle.occupancy,
    };
    this.rides.set(pos.rideId, {
      vehicleId,
      route,
      pattern: pick.pattern,
      startedAt: prev?.startedAt ?? now,
      lastAcceptedAt: now,
      lastFixAt: fixAt,
      lastPoint: point,
      alongM: pick.alongM,
      vehicle,
    });
    return { accepted: true, vehicleId, offsetMeters: Math.round(offsetM), vehicle };
  }

  /**
   * Shared vehicles heading towards `stopId` (optionally on one route), soonest first.
   * With `towardsStopId`, only vehicles whose direction reaches `stopId` before it count:
   * a vehicle going the other way passes the same stop but is no use to the rider.
   * ETA = timetable running time from the vehicle's point on the route to the stop, minus
   * the time since the fix, given as a range because real running times vary.
   */
  arrivals(stopId: string, routeId?: string, towardsStopId?: string): ArrivalEstimate[] {
    const now = this.now();
    this.prune(now);
    const out: ArrivalEstimate[] = [];
    for (const ride of this.rides.values()) {
      if (now - ride.startedAt > RIDES.maxRideMs) continue;
      if (routeId && ride.route.id !== routeId) continue;
      const index = ride.pattern.stops.findIndex((s) => s.stopId === stopId);
      const stop = ride.pattern.stops[index];
      if (!stop) continue;
      if (
        towardsStopId &&
        !ride.pattern.stops.slice(index + 1).some((s) => s.stopId === towardsStopId)
      ) {
        continue;
      }
      const distanceM = stop.distM - ride.alongM;
      if (distanceM <= RIDES.atStopM) continue; // at the stop already, or past it
      const sinceFixSec = Math.max(0, (now - ride.lastFixAt) / 1000);
      const eta = stop.offsetSec - offsetAt(ride.pattern, ride.alongM) - sinceFixSec;
      if (eta > RIDES.maxEtaSec) continue;
      const etaSec = Math.max(0, eta);
      const round10 = (n: number) => Math.round(n / 10) * 10;
      out.push({
        routeId: ride.route.id,
        vehicleId: ride.vehicleId,
        etaSeconds: { min: round10(etaSec * 0.8), max: round10(etaSec * 1.4 + 60) },
        distanceMeters: Math.round(distanceM),
        occupancy: ride.vehicle.occupancy,
        observedAt: new Date(ride.lastFixAt).toISOString(),
      });
    }
    return out.sort((a, b) => a.etaSeconds.min - b.etaSeconds.min);
  }

  /** Rider tapped "stop sharing". Returns the vehicle id that left the map, if any. */
  end(rideId: string): string | undefined {
    const ride = this.rides.get(rideId);
    this.rides.delete(rideId);
    return ride?.vehicleId;
  }

  /** Latest position of every ride still reporting (over-long rides are hidden). */
  positions(): VehiclePosition[] {
    const now = this.now();
    this.prune(now);
    return [...this.rides.values()]
      .filter((r) => now - r.startedAt <= RIDES.maxRideMs)
      .map((r) => r.vehicle);
  }

  /**
   * Forgets silent rides. Over-long rides are kept (and refused) until they go silent,
   * so the same id cannot simply carry on as a "new" ride.
   */
  private prune(now: number) {
    for (const [id, ride] of this.rides) {
      if (now - ride.lastAcceptedAt > RIDES.silentAfterMs) this.rides.delete(id);
    }
  }
}
