import type { Itinerary } from '@transit/shared-types';
import { describe, expect, it } from 'vitest';
import { boundsOf, circlePolygon, decodePolyline, itineraryToGeoJSON } from './geometry';
import { VehicleAnimator } from './vehicleAnimator';

describe('decodePolyline', () => {
  it('decodes the Google reference example to [lng, lat]', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });
  it('returns nothing for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('itineraryToGeoJSON', () => {
  const it0: Itinerary = {
    id: 'x',
    durationSeconds: 1,
    walkTimeSeconds: 1,
    transitTimeSeconds: 0,
    estimatedFare: { currency: 'INR', amount: 0 },
    congestionLevel: 'low',
    legs: [
      {
        mode: 'WALK',
        from: { name: 'a', lat: 28.6, lng: 77.2 },
        to: { name: 'b', lat: 28.61, lng: 77.21 },
        durationSeconds: 1,
        distanceMeters: 1,
        geometryPolyline: '',
      },
      {
        mode: 'AUTO_RICKSHAW',
        routeColor: '#16A34A',
        from: { name: 'b', lat: 28.61, lng: 77.21 },
        to: { name: 'c', lat: 28.62, lng: 77.22 },
        durationSeconds: 1,
        distanceMeters: 1,
        geometryPolyline: '_p~iF~ps|U_ulLnnqC',
      },
    ],
  };

  it('makes one styled line per leg, straight-line fallback for missing geometry', () => {
    const fc = itineraryToGeoJSON(it0);
    expect(fc.features.map((f) => f.properties)).toEqual([
      { index: 0, walk: true, color: '#475569' },
      { index: 1, walk: false, color: '#16A34A' },
    ]);
    expect(fc.features[0]!.geometry.coordinates).toEqual([
      [77.2, 28.6],
      [77.21, 28.61],
    ]);
  });
});

describe('boundsOf / circlePolygon', () => {
  it('computes bounds', () => {
    expect(
      boundsOf([
        [1, 2],
        [3, -1],
        [0, 5],
      ]),
    ).toEqual([
      [0, -1],
      [3, 5],
    ]);
    expect(boundsOf([])).toBeNull();
  });
  it('closes the ring at roughly the right radius', () => {
    const ring = circlePolygon({ lat: 28.66, lng: 77.23 }, 300).coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const dLatM = Math.abs(ring[16]![1]! - 28.66) * 111_320; // quarter turn = due north
    expect(dLatM).toBeCloseTo(300, -1);
  });
});

describe('VehicleAnimator', () => {
  const ping = (id: string, lng: number, lat: number) => ({
    vehicleId: id,
    mode: 'AUTO_RICKSHAW' as const,
    coordinates: [lng, lat] as [number, number],
    timestamp: '',
  });

  it('glides from the drawn position to each new ping', () => {
    const a = new VehicleAnimator(2000, 15_000);
    a.update(ping('v', 0, 0), 0);
    a.update(ping('v', 10, 0), 1000);
    expect(a.frame(1000)[0]!.at).toEqual([0, 0]);
    expect(a.frame(2000)[0]!.at[0]).toBeCloseTo(5);
    expect(a.frame(3000)[0]!.at).toEqual([10, 0]);
    expect(a.frame(2000, false)[0]!.at).toEqual([10, 0]); // reduced motion: jump
  });

  it('drops vehicles that stop reporting', () => {
    const a = new VehicleAnimator(2000, 15_000);
    a.update(ping('v', 0, 0), 0);
    expect(a.frame(10_000)).toHaveLength(1);
    expect(a.frame(16_000)).toHaveLength(0);
    expect(a.size).toBe(0);
  });
});
