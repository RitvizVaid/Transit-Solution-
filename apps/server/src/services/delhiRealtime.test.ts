import gtfsRealtime from 'gtfs-realtime-bindings';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { GTFS_DIR } from '../test/fixtures.js';
import { LiveHub } from '../websocket/hub.js';
import { decodeDelhiPositions, DelhiRealtime } from './delhiRealtime.js';

const gtfs = gtfsRealtime.transit_realtime;
const now = Date.parse('2026-11-24T12:00:00Z');
const feed = (entities: gtfsRealtime.transit_realtime.IFeedEntity[]) =>
  gtfs.FeedMessage.encode({ header: { gtfsRealtimeVersion: '2.0' }, entity: entities }).finish();
const bus = (id: string, timestamp: number) => ({
  id,
  vehicle: { position: { latitude: 28.6, longitude: 77.2 }, timestamp },
});

afterEach(() => vi.useRealTimers());

describe('Delhi real-time positions', () => {
  it('only accepts fresh positions and does not attach demo route IDs', () => {
    const bytes = feed([
      bus('bus-1', now / 1000 - 20),
      bus('stale', now / 1000 - 91),
      bus('future', now / 1000 + 31),
      { id: 'missing-time', vehicle: { position: { latitude: 28.6, longitude: 77.2 } } },
      { id: 'bad-position', vehicle: { position: { latitude: 100, longitude: 77 } } },
    ]);
    const positions = decodeDelhiPositions(bytes, now);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      source: 'delhi-otd',
      mode: 'BUS',
      coordinates: [expect.closeTo(77.2), expect.closeTo(28.6)],
      timestamp: '2026-11-24T11:59:40.000Z',
    });
    expect(positions[0]).not.toHaveProperty('routeId');
    expect(positions[0]?.vehicleId).not.toContain('bus-1');
  });

  it('rejects differential feeds', () => {
    const bytes = gtfs.FeedMessage.encode({
      header: {
        gtfsRealtimeVersion: '2.0',
        incrementality: gtfs.FeedHeader.Incrementality.DIFFERENTIAL,
      },
    }).finish();
    expect(() => decodeDelhiPositions(bytes, now)).toThrow('Differential');
  });

  it('clears only Delhi vehicles on feed failure and does not log secrets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const hub = new LiveHub(() => []);
    const warn = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(feed([bus('bus-1', now / 1000)])))
      .mockRejectedValueOnce(new Error('private-test-key'));
    const source = new DelhiRealtime(
      'private-test-key',
      (positions) => hub.publishDelhiVehicles(positions),
      (status) => hub.publishDelhiStatus(status),
      warn,
      fetchImpl,
    );
    hub.publishVehicles([
      {
        vehicleId: 'crowd-1',
        source: 'crowd',
        mode: 'AUTO_RICKSHAW',
        coordinates: [77.2, 28.6],
        timestamp: new Date(now).toISOString(),
      },
    ]);
    source.start();
    await vi.advanceTimersByTimeAsync(0);
    hub.publishVehicles([
      {
        vehicleId: 'crowd-1',
        source: 'crowd',
        mode: 'AUTO_RICKSHAW',
        coordinates: [77.2, 28.6],
        timestamp: new Date(now).toISOString(),
      },
    ]);
    const sent: string[] = [];
    const client = hub.connect({ readyState: 1, send: (msg) => sent.push(msg) });
    const subscribe = () =>
      client.onMessage(JSON.stringify({ type: 'subscribe.bbox', bbox: [77.1, 28.5, 77.3, 28.7] }));
    subscribe();
    expect(sent.some((msg) => msg.includes('"source":"delhi-otd"'))).toBe(true);
    expect(sent.some((msg) => msg.includes('"vehicleId":"crowd-1"'))).toBe(true);
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(source.status).toBe('error');
    expect(sent.some((msg) => msg.includes('"type":"vehicle.removed"'))).toBe(true);
    sent.length = 0;
    subscribe();
    expect(sent.some((msg) => msg.includes('"vehicleId":"crowd-1"'))).toBe(true);
    expect(sent.some((msg) => msg.includes('"mode":"BUS"'))).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-test-key');
    source.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.close();
  });

  it('wires the optional feed without exposing its key in health', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(feed([bus('bus-1', Date.now() / 1000)])));
    const app = await buildApp({
      config: {
        gtfsDir: GTFS_DIR,
        reportDbPath: ':memory:',
        simulateVehicles: false,
        simulateReports: false,
        delhiOtdApiKey: 'private-test-key',
      },
      fetchImpl,
    });
    try {
      await app.ready();
      await vi.waitFor(() => expect(app.transit.delhiRealtime?.status).toBe('ok'));
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.json().delhiRealtime.status).toBe('ok');
      expect(health.body).not.toContain('private-test-key');
    } finally {
      await app.close();
    }
  });
});
