import type {
  NearbyStopsResponse,
  NearestLineResponse,
  PlanResponse,
  ArrivalsResponse,
  RidePositionResponse,
  RouteSuggestion,
  ServerMessage,
  StandStatus,
  TransitRoute,
} from '@transit/shared-types';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { GTFS_DIR } from './test/fixtures.js';
import { LiveHub } from './websocket/hub.js';

const REPORT_TOKEN = 'a'.repeat(64);
const RF_REPORT_TOKEN = 'b'.repeat(64);
const MISSING_STAND_TOKEN = 'c'.repeat(64);
const ADMIN_TOKEN = 'd'.repeat(64);
const app = await buildApp({
  config: {
    adminTokenHash: createHash('sha256').update(ADMIN_TOKEN).digest('hex'),
    gtfsDir: GTFS_DIR,
    reportDbPath: ':memory:',
    reportTokenHashes: {
      'odrs-1': createHash('sha256').update(REPORT_TOKEN).digest('hex'),
      'rf-1': createHash('sha256').update(RF_REPORT_TOKEN).digest('hex'),
      nope: createHash('sha256').update(MISSING_STAND_TOKEN).digest('hex'),
    },
    simulateVehicles: false,
    simulateReports: false,
    otpUrl: undefined,
    demoTimeOfDay: '10:00',
  },
});
afterAll(() => app.close());

describe('HTTP API', () => {
  it('restores recent accepted reports after an API restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'transit-reports-'));
    const reportDbPath = join(directory, 'reports.sqlite');
    const config = {
      gtfsDir: GTFS_DIR,
      reportDbPath,
      reportTokenHashes: {
        'odrs-1': createHash('sha256').update(REPORT_TOKEN).digest('hex'),
      },
      simulateVehicles: false,
      simulateReports: false,
      otpUrl: undefined,
      demoTimeOfDay: '10:00',
    };
    try {
      const first = await buildApp({ config });
      try {
        const report = await first.inject({
          method: 'POST',
          url: '/api/v1/telemetry/reports',
          payload: {
            reportId: 'restart-report-1',
            standId: 'odrs-1',
            kind: 'STAND_FULL',
            passengerCount: 20,
            reportedAt: new Date().toISOString(),
          },
          headers: { authorization: `Bearer ${REPORT_TOKEN}` },
        });
        expect(report.statusCode).toBe(202);
      } finally {
        await first.close();
      }

      const restarted = await buildApp({ config });
      try {
        expect(
          (await restarted.inject({ method: 'GET', url: '/api/v1/stands/odrs-1' })).json(),
        ).toMatchObject({ passengerQueueLevel: 'severe', availableVehiclesEstimate: 0 });
      } finally {
        await restarted.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports health with feed details', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', routes: 8, planner: 'builtin' });
  });

  it('plans a trip and says which planner answered', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plan?fromLat=28.6675&fromLng=77.2282&toLat=28.6555&toLng=77.23&fromName=KG%20Metro&departAt=2026-12-01T10:00:00%2B05:30',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-planner']).toBe('builtin');
    const body = res.json<PlanResponse>();
    expect(body.itineraries.length).toBeGreaterThan(0);
    expect(body.itineraries[0]!.legs[0]!.from.name).toBe('KG Metro');
  });

  it.each([
    ['missing coordinates', '/api/v1/plan'],
    ['out of range', '/api/v1/plan?fromLat=95&fromLng=77&toLat=28&toLng=77'],
    ['bad departAt', '/api/v1/plan?fromLat=28&fromLng=77&toLat=28&toLng=77&departAt=yesterday'],
  ])('rejects %s', async (_name, url) => {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
  });

  it('lists routes without internal fare models', async () => {
    const routes = (await app.inject({ method: 'GET', url: '/api/v1/routes' })).json<
      TransitRoute[]
    >();
    expect(routes.map((r) => r.id)).toContain('KG-1');
    expect(routes[0]).not.toHaveProperty('fare');
  });

  it('finds nearby stops, nearest first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stops/nearby?lat=28.6662&lng=77.2296&radius=300',
    });
    const { stops } = res.json<NearbyStopsResponse>();
    expect(stops[0]?.id).toBe('kg-auto-1');
    expect(stops.every((s) => s.distanceMeters <= 300)).toBe(true);
  });

  it('serves stand status and 404s unknown stands', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/stands' })).json<StandStatus[]>().length,
    ).toBeGreaterThan(5);
    expect((await app.inject({ method: 'GET', url: '/api/v1/stands/kg-auto-1' })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: '/api/v1/stands/nope' })).statusCode).toBe(404);
  });

  it('applies driver reports to stand status', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/telemetry/reports',
      payload: {
        reportId: 'odrs-full-1',
        standId: 'odrs-1',
        kind: 'STAND_FULL',
        passengerCount: 25,
        reportedAt: new Date().toISOString(),
      },
      headers: { authorization: `Bearer ${REPORT_TOKEN}` },
    });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().stand.passengerQueueLevel).toBe('severe');
    const after = (
      await app.inject({ method: 'GET', url: '/api/v1/stands/odrs-1' })
    ).json<StandStatus>();
    expect(after.passengerQueueLevel).toBe('severe');

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/telemetry/reports',
      payload: {
        reportId: 'unknown-stand-1',
        standId: 'nope',
        kind: 'STAND_FULL',
        reportedAt: new Date().toISOString(),
      },
      headers: { authorization: `Bearer ${MISSING_STAND_TOKEN}` },
    });
    expect(unknown.statusCode).toBe(404);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/telemetry/reports',
      payload: {
        reportId: 'invalid-kind-1',
        standId: 'odrs-1',
        kind: 'NOPE',
        reportedAt: new Date().toISOString(),
      },
      headers: { authorization: `Bearer ${REPORT_TOKEN}` },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('requires a valid per-stand token and returns a specific submission outcome', async () => {
    const url = '/api/v1/telemetry/reports';
    const payload = {
      reportId: 'auth-check-1',
      standId: 'odrs-1',
      kind: 'STAND_EMPTY',
      reportedAt: new Date().toISOString(),
    };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload,
          headers: { authorization: 'Bearer invalid' },
        })
      ).statusCode,
    ).toBe(401);

    const wrongStand = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { authorization: `Bearer ${RF_REPORT_TOKEN}` },
    });
    expect(wrongStand.statusCode).toBe(403);

    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/telemetry/session',
      headers: { authorization: `Bearer ${REPORT_TOKEN}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ standId: 'odrs-1' });
  });

  it('deduplicates retries and rejects out-of-order and expired observations', async () => {
    const url = '/api/v1/telemetry/reports';
    const headers = { authorization: `Bearer ${REPORT_TOKEN}` };
    const reportedAt = new Date().toISOString();
    const report = {
      reportId: 'idempotent-1',
      standId: 'odrs-1',
      kind: 'STAND_EMPTY',
      reportedAt,
    };
    const first = await app.inject({ method: 'POST', url, payload: report, headers });
    expect(first.statusCode).toBe(202);
    expect(first.json().duplicate).toBe(false);
    const duplicate = await app.inject({ method: 'POST', url, payload: report, headers });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().duplicate).toBe(true);

    const future = {
      ...report,
      reportId: 'future-idempotent-1',
      reportedAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
    const futureFirst = await app.inject({ method: 'POST', url, payload: future, headers });
    expect(futureFirst.statusCode).toBe(202);
    const futureRetry = await app.inject({ method: 'POST', url, payload: future, headers });
    expect(futureRetry.statusCode).toBe(200);
    expect(futureRetry.json().duplicate).toBe(true);

    const conflict = await app.inject({
      method: 'POST',
      url,
      payload: { ...report, kind: 'STAND_FULL' },
      headers,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('report_id_conflict');

    const old = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...report,
        reportId: 'idempotent-old',
        reportedAt: new Date(Date.now() - 60_000).toISOString(),
      },
      headers,
    });
    expect(old.statusCode).toBe(409);
    expect(old.json().error).toBe('report_out_of_order');

    const expired = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...report,
        reportId: 'idempotent-expired',
        reportedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
      headers,
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error).toBe('report_expired');
  });

  it('publishes an OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toEqual(
      expect.arrayContaining(['/api/v1/plan', '/api/v1/stops/nearby', '/api/v1/telemetry/reports']),
    );
  });
});

describe('WebSocket /api/v1/live', () => {
  it('sends a snapshot on subscribe and pushes report updates', async () => {
    const ws = await app.injectWS('/api/v1/live');
    const messages: ServerMessage[] = [];
    ws.on('message', (d: Buffer) => messages.push(JSON.parse(d.toString()) as ServerMessage));
    const waitFor = async (pred: () => boolean) => {
      for (let i = 0; i < 50 && !pred(); i++) await new Promise((r) => setTimeout(r, 10));
    };

    ws.send(JSON.stringify({ type: 'subscribe.stands', standIds: ['rf-1'] }));
    await waitFor(() => messages.length > 0);
    expect(messages[0]).toMatchObject({ type: 'stand.status', payload: { standId: 'rf-1' } });

    await app.inject({
      method: 'POST',
      url: '/api/v1/telemetry/reports',
      payload: {
        reportId: 'ws-report-1',
        standId: 'rf-1',
        kind: 'STAND_EMPTY',
        reportedAt: new Date().toISOString(),
      },
      headers: { authorization: `Bearer ${RF_REPORT_TOKEN}` },
    });
    await waitFor(() => messages.length > 1);
    expect(messages[1]).toMatchObject({
      type: 'stand.status',
      payload: { standId: 'rf-1', passengerQueueLevel: 'empty' },
    });
    ws.terminate();
  });
});

describe('LiveHub', () => {
  const fakeSocket = () => {
    const sent: ServerMessage[] = [];
    return {
      sent,
      socket: { readyState: 1, send: (d: string) => sent.push(JSON.parse(d) as ServerMessage) },
    };
  };
  const stand = (id: string, lng: number, lat: number): StandStatus => ({
    standId: id,
    name: id,
    coordinates: [lng, lat],
    source: 'baseline',
    availableVehiclesEstimate: null,
    passengerQueueLevel: 'normal',
    averageWaitMinutes: 3,
    lastReportedAt: null,
    expiresAt: null,
    lastUpdated: '2026-12-01T00:00:00Z',
  });

  it('filters stands and vehicles by viewport', () => {
    const hub = new LiveHub(() => [stand('in', 77.23, 28.66), stand('out', 77.5, 28.9)]);
    const a = fakeSocket();
    const s = hub.connect(a.socket);
    s.onMessage(JSON.stringify({ type: 'subscribe.bbox', bbox: [77.2, 28.6, 77.3, 28.7] }));
    expect(a.sent.map((m) => (m.type === 'stand.status' ? m.payload.standId : ''))).toEqual(['in']);

    hub.publishVehicles([
      { vehicleId: 'v1', mode: 'E_RICKSHAW', coordinates: [77.25, 28.65], timestamp: '' },
      { vehicleId: 'v2', mode: 'E_RICKSHAW', coordinates: [76.0, 28.65], timestamp: '' },
    ]);
    const vehicles = a.sent.filter((m) => m.type === 'vehicle.position');
    expect(vehicles).toHaveLength(1);
    s.close();
    expect(hub.size).toBe(0);
  });

  it('ignores malformed messages', () => {
    const hub = new LiveHub(() => []);
    const a = fakeSocket();
    const s = hub.connect(a.socket);
    s.onMessage('not json');
    s.onMessage(JSON.stringify({ type: 'subscribe.bbox', bbox: [1, 2] }));
    expect(a.sent).toEqual([]);
  });
});

describe('C2.5 snapping to the nearest corridor', () => {
  it('snaps a point off the network onto the closest route', async () => {
    // Tis Hazari: ~900 m west of the nearest corridor (CL-6 via Mori Gate).
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/routes/nearest?lat=28.6672&lng=77.2165',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<NearestLineResponse>();
    expect(body.route.id).toBe('CL-6');
    expect(body.nearestStop.id).toBe('mori-gate');
    expect(body.distanceMeters).toBeGreaterThan(700);
    expect(body.distanceMeters).toBeLessThan(1000);
    expect(body.snapped.lng).toBeGreaterThan(77.22);
    expect(body.route).not.toHaveProperty('fare');
  });

  it('returns ~0 m for a point on a route line, between stops', async () => {
    // On KG-1 between GPO and Chandni Chowk Metro.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/routes/nearest?lat=28.6600&lng=77.2302',
    });
    const body = res.json<NearestLineResponse>();
    expect(['KG-1']).toContain(body.route.id);
    expect(body.distanceMeters).toBeLessThan(5);
  });

  it('validates coordinates', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/routes/nearest?lat=200&lng=1' })).statusCode,
    ).toBe(400);
  });
});

describe('Crowd-shared rides', () => {
  const ride = (rideId: string, coordinates: [number, number], extra: object = {}) => ({
    method: 'POST' as const,
    url: '/api/v1/rides/positions',
    payload: {
      rideId,
      routeId: 'KG-1',
      coordinates,
      accuracyM: 12,
      recordedAt: new Date().toISOString(),
      ...extra,
    },
  });
  // On KG-1 between GPO and Chandni Chowk Metro (see the snapping tests above).
  const ON_KG1: [number, number] = [77.2302, 28.66];

  it('broadcasts a rider as a crowd vehicle and removes it when they stop', async () => {
    const ws = await app.injectWS('/api/v1/live');
    const messages: ServerMessage[] = [];
    ws.on('message', (d: Buffer) => messages.push(JSON.parse(d.toString()) as ServerMessage));
    const waitFor = async (pred: () => boolean) => {
      for (let i = 0; i < 50 && !pred(); i++) await new Promise((r) => setTimeout(r, 10));
    };
    ws.send(JSON.stringify({ type: 'subscribe.bbox', bbox: [77.2, 28.62, 77.26, 28.69] }));
    await waitFor(() => messages.some((m) => m.type === 'stand.status'));

    const rideId = 'ws-ride-0123456789';
    const res = await app.inject(ride(rideId, ON_KG1));
    expect(res.statusCode).toBe(200);
    const body = res.json<RidePositionResponse>();
    expect(body).toMatchObject({ accepted: true });
    if (!body.accepted) return;
    expect(JSON.stringify(body)).not.toContain(rideId);

    const isVehicle = (m: ServerMessage) =>
      m.type === 'vehicle.position' && m.payload.vehicleId === body.vehicleId;
    await waitFor(() => messages.some(isVehicle));
    expect(messages.find(isVehicle)).toMatchObject({
      payload: { routeId: 'KG-1', source: 'crowd' },
    });

    const end = await app.inject({ method: 'POST', url: '/api/v1/rides/end', payload: { rideId } });
    expect(end.statusCode).toBe(204);
    await waitFor(() => messages.some((m) => m.type === 'vehicle.removed'));
    expect(messages.find((m) => m.type === 'vehicle.removed')).toEqual({
      type: 'vehicle.removed',
      payload: { vehicleId: body.vehicleId },
    });
    ws.terminate();
  });

  it('answers rejected fixes with a reason, not an error', async () => {
    const res = await app.inject(ride('far-ride-0123456789', [77.0266, 28.4595]));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: false, reason: 'off_route' });
  });

  it('validates the request body', async () => {
    for (const bad of [
      ride('short', ON_KG1),
      ride('bad-coords-0123456789', [200, 28.66] as [number, number]),
      ride('bad-time-0123456789', ON_KG1, { recordedAt: 'yesterday' }),
    ]) {
      expect((await app.inject(bad)).statusCode).toBe(400);
    }
    // Unknown fields are stripped by the schema (Fastify removeAdditional), never kept.
    const extra = await app.inject(ride('extra-prop-0123456789', ON_KG1, { phoneNumber: '123' }));
    expect(extra.statusCode).toBe(200);
    expect(extra.body).not.toContain('123');
  });

  it('turns a rider heading to a stop into an arrival estimate for people waiting', async () => {
    const rideId = 'arrival-ride-0123456789';
    // KG-1 towards Chandni Chowk: share from between GPO and Chandni Chowk Metro.
    const res = await app.inject(ride(rideId, ON_KG1, { occupancy: 'seats_available' }));
    const accepted = res.json<RidePositionResponse>();
    expect(accepted).toMatchObject({ accepted: true });
    const vehicleId = accepted.accepted ? accepted.vehicleId : '';
    const kg1 = app.transit.network.patterns.filter((p) => p.routeId === 'KG-1');
    const downstream = kg1
      .flatMap((p) => {
        const along = p.shape.project({ lat: ON_KG1[1], lng: ON_KG1[0] }).alongM;
        return p.stops.filter((s) => s.distM - along > 200).map((s) => s.stopId);
      })
      .filter((id, i, all) => all.indexOf(id) === i);
    const answers = await Promise.all(
      downstream.map(async (stopId) =>
        (
          await app.inject({ method: 'GET', url: `/api/v1/arrivals?stopId=${stopId}&routeId=KG-1` })
        ).json<ArrivalsResponse>(),
      ),
    );
    // Other tests' riders may also be on KG-1: look for this one.
    const mine = answers.flatMap((a) => a.arrivals).find((a) => a.vehicleId === vehicleId);
    expect(mine).toMatchObject({ routeId: 'KG-1', occupancy: 'seats_available' });
    expect(mine!.etaSeconds.max).toBeGreaterThan(mine!.etaSeconds.min);
    await app.inject({ method: 'POST', url: '/api/v1/rides/end', payload: { rideId } });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/arrivals?stopId=nope' })).statusCode,
    ).toBe(404);
  });

  it('returns routeId on transit legs so riders can share the right route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plan?fromLat=28.6675&fromLng=77.2282&toLat=28.6555&toLng=77.23',
    });
    const rides = res
      .json<PlanResponse>()
      .itineraries.flatMap((i) => i.legs)
      .filter((l) => l.mode !== 'WALK');
    expect(rides.length).toBeGreaterThan(0);
    for (const leg of rides) {
      expect(leg.routeId).toBeTruthy();
      expect(app.transit.network.stops.has(leg.fromStopId!)).toBe(true);
    }
  });
});

describe('Rate limiting', () => {
  it('answers 429 with Retry-After once a client exceeds the plan limit', async () => {
    const limited = await buildApp({
      config: {
        gtfsDir: GTFS_DIR,
        reportDbPath: ':memory:',
        reportTokenHashes: {},
        simulateVehicles: false,
        simulateReports: false,
        otpUrl: undefined,
        demoTimeOfDay: '10:00',
        rateLimits: {
          planPerIp: 2,
          ridesPerIp: 2,
          suggestionsPerIp: 2,
          sessionPerIp: 2,
          reportsPerStand: 2,
        },
      },
    });
    try {
      const plan = () =>
        limited.inject({
          method: 'GET',
          url: '/api/v1/plan?fromLat=28.6675&fromLng=77.2282&toLat=28.6555&toLng=77.23',
        });
      expect((await plan()).statusCode).toBe(200);
      expect((await plan()).statusCode).toBe(200);
      const third = await plan();
      expect(third.statusCode).toBe(429);
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
      // Other clients are unaffected.
      const other = await limited.inject({
        method: 'GET',
        url: '/api/v1/plan?fromLat=28.6675&fromLng=77.2282&toLat=28.6555&toLng=77.23',
        remoteAddress: '10.0.0.9',
      });
      expect(other.statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('Route suggestions', () => {
  const suggestion = {
    from: { name: 'Seelampur', lat: 28.670456, lng: 77.268912 },
    to: { name: 'ISBT', lat: 28.668012, lng: 77.228034 },
    mode: 'E_RICKSHAW',
    routeName: 'Seelampur - ISBT',
    fareInr: 20,
    note: 'Every few minutes from the metro gate',
  };

  it('stores a suggestion for review, rounded to ~100 m, without using it for planning', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suggestions',
      payload: suggestion,
    });
    expect(res.statusCode).toBe(202);
    const { id, status } = res.json<{ id: string; status: string }>();
    expect(status).toBe('pending');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/suggestions',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(list.statusCode).toBe(200);
    const saved = list.json<RouteSuggestion[]>().find((x) => x.id === id)!;
    expect(saved).toMatchObject({
      routeName: 'Seelampur - ISBT',
      fareInr: 20,
      from: { name: 'Seelampur', lat: 28.67, lng: 77.269 },
      to: { lat: 28.668, lng: 77.228 },
    });
    expect(app.transit.network.routes.has('Seelampur - ISBT')).toBe(false);
  });

  it('keeps the review list private and validates input', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/suggestions' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/suggestions',
          headers: { authorization: `Bearer ${'x'.repeat(64)}` },
        })
      ).statusCode,
    ).toBe(401);
    for (const bad of [
      { ...suggestion, from: undefined },
      { ...suggestion, fareInr: -5 },
      { ...suggestion, mode: 'WALK' },
      { ...suggestion, note: 'x'.repeat(501) },
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/suggestions', payload: bad })).statusCode,
      ).toBe(400);
    }
  });
});
