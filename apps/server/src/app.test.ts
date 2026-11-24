import type {
  NearbyStopsResponse,
  NearestLineResponse,
  PlanResponse,
  ServerMessage,
  StandStatus,
  TransitRoute,
} from '@transit/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { GTFS_DIR } from './test/fixtures.js';
import { LiveHub } from './websocket/hub.js';

const app = await buildApp({
  config: {
    gtfsDir: GTFS_DIR,
    simulateVehicles: false,
    simulateReports: false,
    otpUrl: undefined,
    demoTimeOfDay: '10:00',
  },
});
afterAll(() => app.close());

describe('HTTP API', () => {
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
        standId: 'odrs-1',
        kind: 'STAND_FULL',
        passengerCount: 25,
        reportedAt: new Date().toISOString(),
      },
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
      payload: { standId: 'nope', kind: 'STAND_FULL', reportedAt: new Date().toISOString() },
    });
    expect(unknown.statusCode).toBe(404);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/telemetry/reports',
      payload: { standId: 'odrs-1', kind: 'NOPE', reportedAt: new Date().toISOString() },
    });
    expect(bad.statusCode).toBe(400);
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
      payload: { standId: 'rf-1', kind: 'STAND_EMPTY', reportedAt: new Date().toISOString() },
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
    availableVehiclesEstimate: 1,
    passengerQueueLevel: 'normal',
    averageWaitMinutes: 3,
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
    const res = await app.inject({ method: 'GET', url: '/api/v1/routes/nearest?lat=28.6672&lng=77.2165' });
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
    const res = await app.inject({ method: 'GET', url: '/api/v1/routes/nearest?lat=28.6600&lng=77.2302' });
    const body = res.json<NearestLineResponse>();
    expect(['KG-1']).toContain(body.route.id);
    expect(body.distanceMeters).toBeLessThan(5);
  });

  it('validates coordinates', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/routes/nearest?lat=200&lng=1' })).statusCode).toBe(400);
  });
});
