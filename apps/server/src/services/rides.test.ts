import type { LatLng, RidePosition } from '@transit/shared-types';
import { describe, expect, it } from 'vitest';
import { pilotNetwork } from '../test/fixtures.js';
import { haversineMeters } from './geo.js';
import { RIDES, RideTracker, vehicleIdFor } from './rides.js';

const net = pilotNetwork();
const T0 = Date.parse('2026-12-01T10:00:00+05:30');
const pattern = net.patterns.find((p) => p.tripId === 'CC-RF-d0')!;
const along = (m: number): LatLng => pattern.shape.at(m).point;
const RIDE_ID = 'ride-0123456789abcdef';

function setup() {
  let now = T0;
  const tracker = new RideTracker(net, () => now);
  const fix = (point: LatLng, extra: Partial<RidePosition> = {}): RidePosition => ({
    rideId: RIDE_ID,
    routeId: 'CC-RF',
    coordinates: [point.lng, point.lat],
    accuracyM: 10,
    recordedAt: new Date(now).toISOString(),
    ...extra,
  });
  return {
    tracker,
    fix,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('RideTracker', () => {
  it('accepts a fix on the route, snaps it and hides the secret ride id', () => {
    const { tracker, fix } = setup();
    const raw = along(300);
    // ~20 m off the line: still on the corridor (GPS noise, rider on the kerb side).
    const noisy = { lat: raw.lat + 0.00018, lng: raw.lng };
    const r = tracker.report(fix(noisy));
    expect(r.accepted).toBe(true);
    if (!r.accepted) return;
    expect(r.vehicleId).toBe(vehicleIdFor(RIDE_ID));
    expect(r.vehicleId).not.toContain(RIDE_ID);
    expect(r.offsetMeters).toBeLessThan(RIDES.maxOffRouteM);

    const [v] = tracker.positions();
    expect(v).toMatchObject({ routeId: 'CC-RF', source: 'crowd', mode: 'E_RICKSHAW' });
    // Broadcast position is on the route line, not the rider's raw GPS point.
    const snapped = { lng: v!.coordinates[0], lat: v!.coordinates[1] };
    expect(pattern.shape.project(snapped).offsetM).toBeLessThan(2);
    expect(haversineMeters(snapped, noisy)).toBeGreaterThan(5);
  });

  it('refuses fixes that are off route, inaccurate, stale or for unknown routes', () => {
    const { tracker, fix } = setup();
    const p = along(300);
    expect(tracker.report(fix({ lat: p.lat + 0.01, lng: p.lng }))).toMatchObject({
      accepted: false,
      reason: 'off_route',
    });
    expect(tracker.report(fix(p, { accuracyM: 500 }))).toMatchObject({ reason: 'inaccurate' });
    expect(
      tracker.report(fix(p, { recordedAt: new Date(T0 - 5 * 60_000).toISOString() })),
    ).toMatchObject({ reason: 'stale' });
    expect(tracker.report(fix(p, { routeId: 'NOPE' }))).toMatchObject({
      reason: 'unknown_route',
    });
    expect(tracker.size).toBe(0);
  });

  it('rate-limits a ride and rejects GPS jumps faster than a city vehicle', () => {
    const { tracker, fix, advance } = setup();
    expect(tracker.report(fix(along(100))).accepted).toBe(true);
    advance(1_000);
    expect(tracker.report(fix(along(110)))).toMatchObject({ reason: 'too_frequent' });
    advance(4_000);
    // 5 s after the first fix, 1 km further: 720 km/h.
    expect(tracker.report(fix(along(1100)))).toMatchObject({ reason: 'implausible_speed' });
    // 5 s, 30 m: ~22 km/h.
    const ok = tracker.report(fix(along(130)));
    expect(ok.accepted).toBe(true);
    expect(tracker.positions()[0]!.speedKmh).toBeGreaterThan(15);
  });

  it('keeps one route per ride id', () => {
    const { tracker, fix, advance } = setup();
    expect(tracker.report(fix(along(100))).accepted).toBe(true);
    advance(5_000);
    const other = net.patterns.find((p) => p.routeId === 'KG-1')!.shape.at(200).point;
    expect(tracker.report(fix(other, { routeId: 'KG-1' }))).toMatchObject({
      reason: 'unknown_route',
    });
  });

  it('drops silent rides, ends rides on request and refuses over-long rides', () => {
    const { tracker, fix, advance } = setup();
    tracker.report(fix(along(100)));
    advance(RIDES.silentAfterMs + 1);
    expect(tracker.positions()).toHaveLength(0);

    tracker.report(fix(along(100)));
    expect(tracker.end(RIDE_ID)).toBe(vehicleIdFor(RIDE_ID));
    expect(tracker.positions()).toHaveLength(0);
    expect(tracker.end(RIDE_ID)).toBeUndefined();

    tracker.report(fix(along(100)));
    let m = 100;
    // Keep reporting every 30 s (well within the silence limit) past the maximum length.
    for (let t = 0; t <= RIDES.maxRideMs; t += 30_000) {
      advance(30_000);
      m = (m + 100) % 1500;
      tracker.report(fix(along(m)));
    }
    advance(30_000);
    expect(tracker.report(fix(along(m)))).toMatchObject({ reason: 'ride_too_long' });
    expect(tracker.positions()).toHaveLength(0);
  });

  it('caps the number of simultaneous rides', () => {
    const { tracker, fix } = setup();
    const max = RIDES.maxActiveRides;
    for (let i = 0; i < max; i++) {
      tracker.report(fix(along(100), { rideId: `ride-${String(i).padStart(16, '0')}` }));
    }
    expect(tracker.size).toBe(max);
    expect(tracker.report(fix(along(100), { rideId: 'ride-overflow-000000' }))).toMatchObject({
      reason: 'capacity',
    });
  });
});
