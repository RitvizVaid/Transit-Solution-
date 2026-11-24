import { REPORT_KINDS, type ReportKind, type VehiclePosition } from '@transit/shared-types';
import type { TransitNetwork } from '../gtfs/network.js';
import { IST_OFFSET_SEC } from './time.js';

/** Deterministic PRNG so demos and tests are repeatable. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where vehicles would be if every route ran exactly to its headway: vehicle k on a
 * pattern leaves the first stop at serviceStart + k × headway and moves along the
 * shape following the stop_times running times. Used for demos until real driver
 * GPS arrives; the WebSocket message format is the same either way.
 */
export function simulatedPositions(net: TransitNetwork, at: Date): VehiclePosition[] {
  const sec = (at.getTime() / 1000 + IST_OFFSET_SEC) % 86400;
  const out: VehiclePosition[] = [];
  for (const p of net.patterns) {
    const route = net.routes.get(p.routeId);
    if (!route) continue;
    const runtime = p.stops[p.stops.length - 1]!.offsetSec;
    const firstK = Math.max(0, Math.ceil((sec - runtime - p.serviceStartSec) / p.headwaySec));
    const lastK = Math.floor((Math.min(sec, p.serviceEndSec) - p.serviceStartSec) / p.headwaySec);
    for (let k = firstK; k <= lastK; k++) {
      const elapsed = sec - (p.serviceStartSec + k * p.headwaySec);
      if (elapsed < 0 || elapsed > runtime) continue;
      let i = 1;
      while (i < p.stops.length - 1 && p.stops[i]!.offsetSec < elapsed) i++;
      const a = p.stops[i - 1]!;
      const b = p.stops[i]!;
      const span = b.offsetSec - a.offsetSec;
      const t = span > 0 ? Math.min(1, (elapsed - a.offsetSec) / span) : 0;
      const dist = a.distM + (b.distM - a.distM) * t;
      const { point, bearing } = p.shape.at(dist);
      out.push({
        vehicleId: `${p.tripId}#${k}`,
        routeId: p.routeId,
        mode: route.mode,
        coordinates: [Math.round(point.lng * 1e6) / 1e6, Math.round(point.lat * 1e6) / 1e6],
        bearing: Math.round(bearing),
        speedKmh: span > 0 ? Math.round(((b.distM - a.distM) / span) * 3.6) : 0,
        timestamp: at.toISOString(),
        source: 'simulated',
      });
    }
  }
  return out;
}

/** Weighted random marshal report, roughly what a busy stand sends. */
export function randomReport(rng: () => number): ReportKind {
  const weights: Record<ReportKind, number> = {
    DEPARTING_NOW: 0.55,
    STAND_FULL: 0.2,
    STAND_EMPTY: 0.15,
    HEAVY_TRAFFIC: 0.1,
  };
  let r = rng();
  for (const k of REPORT_KINDS) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return 'DEPARTING_NOW';
}
