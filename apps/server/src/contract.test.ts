/**
 * Shared API contracts: every payload the API sends must match
 * packages/shared-types at runtime, not just at compile time. These checks walk real
 * responses field by field.
 *
 * Contract details:
 *  - Leg.frequencyMinutes is a range { min, max } (informal headways vary), not a number.
 *  - Leg.mode adds E_RICKSHAW and SHARED_TAXI; Leg adds optional boardingStandId.
 */
import {
  CONGESTION_LEVELS,
  LEG_MODES,
  QUEUE_LEVELS,
  type Itinerary,
  type Leg,
  type NearbyStopsResponse,
  type PlanResponse,
  type ServerMessage,
  type StandStatus,
  type TransitRoute,
} from '@transit/shared-types';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { decodePolyline } from './services/geo.js';
import { GTFS_DIR } from './test/fixtures.js';

const app = await buildApp({
  config: {
    gtfsDir: GTFS_DIR,
    reportDbPath: ':memory:',
    reportTokenHashes: {
      'rf-1': createHash('sha256').update('a'.repeat(64)).digest('hex'),
    },
    simulateVehicles: false,
    simulateReports: false,
    otpUrl: undefined,
    demoTimeOfDay: '10:00',
  },
});
afterAll(() => app.close());

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown) => typeof v === 'string' && v.length > 0;
const isIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isHex = (v: unknown) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);

function checkPlace(p: Leg['from'], where: string) {
  expect(isStr(p.name), `${where}.name`).toBe(true);
  expect(p.lat >= -90 && p.lat <= 90, `${where}.lat`).toBe(true);
  expect(p.lng >= -180 && p.lng <= 180, `${where}.lng`).toBe(true);
}

function checkLeg(l: Leg, where: string) {
  expect((LEG_MODES as readonly string[]).includes(l.mode), `${where}.mode=${l.mode}`).toBe(true);
  checkPlace(l.from, `${where}.from`);
  checkPlace(l.to, `${where}.to`);
  expect(isNum(l.durationSeconds) && l.durationSeconds >= 0, `${where}.durationSeconds`).toBe(true);
  expect(isNum(l.distanceMeters) && l.distanceMeters >= 0, `${where}.distanceMeters`).toBe(true);
  expect(
    decodePolyline(l.geometryPolyline).length,
    `${where}.geometryPolyline`,
  ).toBeGreaterThanOrEqual(2);
  if (l.mode === 'WALK') {
    expect(l.routeShortName, `${where} walk has no route`).toBeUndefined();
  } else {
    expect(isStr(l.routeShortName), `${where}.routeShortName`).toBe(true);
    expect(isHex(l.routeColor), `${where}.routeColor`).toBe(true);
    expect(l.frequencyMinutes!.min <= l.frequencyMinutes!.max, `${where}.frequencyMinutes`).toBe(
      true,
    );
    if (l.boardingStandId !== undefined) expect(isStr(l.boardingStandId)).toBe(true);
  }
}

function checkItinerary(itinerary: Itinerary, where: string) {
  expect(isStr(itinerary.id), `${where}.id`).toBe(true);
  for (const k of ['durationSeconds', 'walkTimeSeconds', 'transitTimeSeconds'] as const) {
    expect(isNum(itinerary[k]) && itinerary[k] >= 0, `${where}.${k}`).toBe(true);
  }
  expect(itinerary.durationSeconds).toBeGreaterThanOrEqual(
    itinerary.walkTimeSeconds + itinerary.transitTimeSeconds,
  );
  expect(itinerary.estimatedFare.currency).toBe('INR');
  expect(isNum(itinerary.estimatedFare.amount) && itinerary.estimatedFare.amount >= 0).toBe(true);
  expect(
    (CONGESTION_LEVELS as readonly string[]).includes(itinerary.congestionLevel),
    `${where}.congestionLevel`,
  ).toBe(true);
  expect(itinerary.legs.length).toBeGreaterThan(0);
  itinerary.legs.forEach((l, i) => checkLeg(l, `${where}.legs[${i}]`));
  // Legs chain end-to-start.
  for (let i = 1; i < itinerary.legs.length; i++) {
    expect(itinerary.legs[i - 1]!.to.lat).toBeCloseTo(itinerary.legs[i]!.from.lat, 4);
    expect(itinerary.legs[i - 1]!.to.lng).toBeCloseTo(itinerary.legs[i]!.from.lng, 4);
  }
}

function checkStand(s: StandStatus) {
  expect(isStr(s.standId) && isStr(s.name)).toBe(true);
  expect(s.coordinates).toHaveLength(2);
  expect(s.coordinates[0]).toBeGreaterThan(70); // [lng, lat] order
  expect(Number.isInteger(s.availableVehiclesEstimate) && s.availableVehiclesEstimate >= 0).toBe(
    true,
  );
  expect((QUEUE_LEVELS as readonly string[]).includes(s.passengerQueueLevel)).toBe(true);
  expect(isNum(s.averageWaitMinutes) && s.averageWaitMinutes > 0).toBe(true);
  expect(isIso(s.lastUpdated)).toBe(true);
}

describe('§4 contract: GET /api/v1/plan', () => {
  it('matches the exact request example from the plan (mode=TRANSIT,WALK)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plan?fromLat=28.6675&fromLng=77.2282&toLat=28.6555&toLng=77.23&mode=TRANSIT,WALK',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<PlanResponse>();
    expect(Object.keys(body)).toEqual(['itineraries']);
    body.itineraries.forEach((itinerary, i) => checkItinerary(itinerary, `itineraries[${i}]`));
  });

  it('holds for every itinerary between a spread of pilot stops', async () => {
    const stops = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/stops/nearby?lat=28.655&lng=77.23&radius=2000',
      })
    ).json<NearbyStopsResponse>().stops;
    expect(stops.length).toBeGreaterThan(15);
    let checked = 0;
    for (let i = 0; i < stops.length; i += 3) {
      for (let j = 1; j < stops.length; j += 4) {
        const a = stops[i]!;
        const b = stops[j]!;
        if (a.id === b.id) continue;
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/plan?fromLat=${a.lat}&fromLng=${a.lng}&toLat=${b.lat}&toLng=${b.lng}&fromName=${encodeURIComponent(a.name)}`,
        });
        const body = res.json<PlanResponse>();
        body.itineraries.forEach((itinerary, k) =>
          checkItinerary(itinerary, `${a.id}>${b.id}[${k}]`),
        );
        for (const itinerary of body.itineraries.slice(0, 1)) {
          expect(itinerary.legs[0]!.from.name).toBe(a.name);
        }
        checked += body.itineraries.length;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('§4 contract: stands, routes, live messages', () => {
  it('GET /api/v1/stands and /stands/:id return StandStatus', async () => {
    const all = (await app.inject({ method: 'GET', url: '/api/v1/stands' })).json<StandStatus[]>();
    expect(all.length).toBeGreaterThanOrEqual(10);
    all.forEach(checkStand);
    checkStand(
      (await app.inject({ method: 'GET', url: `/api/v1/stands/${all[0]!.standId}` })).json(),
    );
  });

  it('GET /api/v1/routes returns TransitRoute', async () => {
    const routes = (await app.inject({ method: 'GET', url: '/api/v1/routes' })).json<
      TransitRoute[]
    >();
    for (const r of routes) {
      expect(isStr(r.id) && isStr(r.shortName)).toBe(true);
      expect(LEG_MODES.filter((m) => m !== 'WALK') as string[]).toContain(r.mode);
      expect(isHex(r.color)).toBe(true);
      expect(r.serviceHours!.start < r.serviceHours!.end).toBe(true);
    }
  });

  it('WebSocket messages are ServerMessage', async () => {
    const ws = await app.injectWS('/api/v1/live');
    const got: ServerMessage[] = [];
    ws.on('message', (d: Buffer) => got.push(JSON.parse(d.toString()) as ServerMessage));
    ws.send(JSON.stringify({ type: 'subscribe.bbox', bbox: [77.2, 28.62, 77.26, 28.68] }));
    for (let i = 0; i < 50 && got.length < 5; i++) await new Promise((r) => setTimeout(r, 10));
    expect(got.length).toBeGreaterThanOrEqual(5);
    for (const m of got) {
      expect(['stand.status', 'vehicle.position']).toContain(m.type);
      if (m.type === 'stand.status') checkStand(m.payload);
    }
    ws.terminate();
  });
});
