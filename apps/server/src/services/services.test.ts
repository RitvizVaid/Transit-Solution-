import { describe, expect, it, vi } from 'vitest';
import { MORNING, NIGHT, pilotNetwork } from '../test/fixtures.js';
import { itineraryFare, legFare } from './fares.js';
import { decodePolyline, encodePolyline, haversineMeters, MeasuredLine } from './geo.js';
import { mulberry32, randomReport, simulatedPositions } from './simulator.js';
import { REPORT_TTL_MS, StandStore } from './stands.js';
import { isWithin, localSecondsOfDay } from './time.js';

describe('geo', () => {
  it('round-trips encoded polylines', () => {
    const pts = [
      { lat: 28.6675, lng: 77.2282 },
      { lat: 28.6662, lng: 77.2296 },
      { lat: -12.5, lng: -45.25 },
    ];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });

  it('interpolates and slices a measured line by distance', () => {
    const line = new MeasuredLine([
      { lat: 28.0, lng: 77.0 },
      { lat: 28.01, lng: 77.0 },
      { lat: 28.02, lng: 77.0 },
    ]);
    expect(line.length).toBeCloseTo(2224, -1);
    expect(line.at(line.length / 2).point.lat).toBeCloseTo(28.01, 4);
    expect(line.at(10).bearing).toBeCloseTo(0, 0);
    const part = line.slice(500, 1500);
    expect(part).toHaveLength(3); // start, middle vertex, end
    expect(haversineMeters(part[0]!, { lat: 28, lng: 77 })).toBeCloseTo(500, -1);
    expect(line.slice(1500, 500)[0]!.lat).toBeGreaterThan(line.slice(1500, 500)[2]!.lat);
  });
});

describe('fares', () => {
  const kg1 = { minFare: 20, baseKm: 1.5, perKm: 8, currency: 'INR' };
  it('charges the minimum fare within the base distance', () => {
    expect(legFare(kg1, 1150)).toBe(20);
  });
  it('adds per-km beyond the base, rounded up to ₹5', () => {
    expect(legFare(kg1, 3000)).toBe(35); // 20 + 1.5 × 8 = 32 → 35
  });
  it('sums separate tickets for each ride', () => {
    expect(
      itineraryFare([
        { model: kg1, distanceMeters: 1000 },
        { model: kg1, distanceMeters: 1000 },
      ]),
    ).toEqual({
      currency: 'INR',
      amount: 40,
    });
  });
});

describe('time', () => {
  it('converts instants to IST seconds of day', () => {
    expect(localSecondsOfDay(MORNING)).toBe(10 * 3600);
    expect(localSecondsOfDay(new Date('2026-12-01T00:00:00Z'))).toBe(5.5 * 3600);
  });
  it('handles service windows past midnight', () => {
    expect(isWithin(3600, 22 * 3600, 25 * 3600)).toBe(true);
    expect(isWithin(12 * 3600, 22 * 3600, 25 * 3600)).toBe(false);
  });
});

describe('StandStore', () => {
  const net = pilotNetwork();
  const at = (iso: string) => new Date(iso).toISOString();

  it('starts every stand at a schedule-based baseline', () => {
    const store = new StandStore(net, () => MORNING.getTime());
    expect(store.list()).toHaveLength(net.stands().length);
    // KG stand: shortest mean headway is KG-1's 4 min → ~2 min wait.
    expect(store.get('kg-auto-1')).toMatchObject({
      averageWaitMinutes: 2,
      passengerQueueLevel: 'normal',
    });
  });

  it('escalates a full stand and emits changes', () => {
    const store = new StandStore(net, () => MORNING.getTime());
    const changes = vi.fn();
    store.on('change', changes);
    const first = store.apply({
      standId: 'kg-auto-1',
      kind: 'STAND_FULL',
      reportedAt: at('2026-12-01T09:59:00+05:30'),
    });
    expect(first.passengerQueueLevel).toBe('crowded');
    expect(first.availableVehiclesEstimate).toBe(0);
    expect(first.averageWaitMinutes).toBeGreaterThanOrEqual(4);
    const second = store.apply({
      standId: 'kg-auto-1',
      kind: 'STAND_FULL',
      reportedAt: at('2026-12-01T09:59:30+05:30'),
    });
    expect(second.passengerQueueLevel).toBe('severe');
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('measures the real headway from departures', () => {
    const store = new StandStore(net, () => MORNING.getTime());
    for (const m of ['09:30', '09:40', '09:50', '10:00']) {
      store.apply({
        standId: 'kg-auto-1',
        kind: 'DEPARTING_NOW',
        reportedAt: at(`2026-12-01T${m}:00+05:30`),
      });
    }
    expect(store.get('kg-auto-1')!.averageWaitMinutes).toBe(5); // 10-min gaps → ~5 min wait
  });

  it('falls back to baseline after the TTL but keeps the last report time', () => {
    let now = MORNING.getTime();
    const store = new StandStore(net, () => now);
    store.apply({
      standId: 'kg-auto-1',
      kind: 'STAND_FULL',
      reportedAt: new Date(now).toISOString(),
    });
    now += REPORT_TTL_MS + 1000;
    const s = store.get('kg-auto-1')!;
    expect(s.passengerQueueLevel).toBe('normal');
    expect(s.lastUpdated).toBe(new Date(MORNING.getTime()).toISOString());
  });

  it('rejects unknown stands and future timestamps', () => {
    const store = new StandStore(net, () => MORNING.getTime());
    expect(() => store.apply({ standId: 'nope', kind: 'STAND_EMPTY', reportedAt: '' })).toThrow(
      'unknown stand',
    );
    const s = store.apply({
      standId: 'kg-auto-1',
      kind: 'STAND_EMPTY',
      reportedAt: '2030-01-01T00:00:00Z',
    });
    expect(s.lastUpdated).toBe(MORNING.toISOString());
  });
});

describe('simulator', () => {
  const net = pilotNetwork();

  it('places vehicles on their route shapes during service', () => {
    const vs = simulatedPositions(net, MORNING);
    expect(vs.length).toBeGreaterThan(10);
    for (const v of vs) {
      const pattern = net.patterns.find((p) => v.vehicleId.startsWith(`${p.tripId}#`))!;
      const nearest = Math.min(
        ...pattern.shape.points.map((p) =>
          haversineMeters(p, { lat: v.coordinates[1], lng: v.coordinates[0] }),
        ),
      );
      expect(nearest).toBeLessThan(800);
    }
  });

  it('is silent outside service hours and deterministic', () => {
    expect(simulatedPositions(net, NIGHT)).toEqual([]);
    expect(simulatedPositions(net, MORNING)).toEqual(simulatedPositions(net, MORNING));
  });

  it('draws plausible report kinds', () => {
    const rng = mulberry32(1);
    const kinds = Array.from({ length: 500 }, () => randomReport(rng));
    expect(kinds.filter((k) => k === 'DEPARTING_NOW').length).toBeGreaterThan(200);
    expect(new Set(kinds).size).toBe(4);
  });
});

describe('zonal fares (stage fares) and the published fare matrix', () => {
  const net = pilotNetwork();
  const m14 = net.routes.get('M-14')!.fare;

  it('loads GTFS zone fares and prefers them over distance', () => {
    expect(m14.zoneFares).toMatchObject({ 'NORTH>NORTH': 10, 'NORTH>OLD': 15, 'OLD>NORTH': 15, 'NORTH>SOUTH': 20 });
    expect(legFare(m14, 5000, 'NORTH', 'SOUTH')).toBe(20); // distance formula would say 15
    expect(legFare(m14, 5000)).toBe(15); // no zones known → distance
    expect(net.routes.get('KG-1')!.fare.zoneFares).toBeUndefined();
    expect(net.stops.get('ito')!.zoneId).toBe('SOUTH');
  });

  it('charges exactly what data/gtfs/…/fare_matrix.csv publishes, for every stop pair', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { parseCsv } = await import('../gtfs/csv.js');
    const { GTFS_DIR } = await import('../test/fixtures.js');
    const rows = parseCsv(readFileSync(join(GTFS_DIR, 'fare_matrix.csv'), 'utf8'));
    expect(rows.length).toBeGreaterThan(100);
    let checked = 0;
    for (const row of rows) {
      const pattern = net.patterns.find((p) => p.tripId === `${row.route_id}-d${row.direction_id}`)!;
      const a = pattern.stops.find((s) => s.stopId === row.from_stop_id)!;
      const b = pattern.stops.find((s) => s.stopId === row.to_stop_id)!;
      const fare = legFare(
        net.routes.get(row.route_id!)!.fare,
        b.distM - a.distM,
        net.stops.get(a.stopId)!.zoneId,
        net.stops.get(b.stopId)!.zoneId,
      );
      expect(fare, `${row.route_id} ${row.from_stop_id}→${row.to_stop_id}`).toBe(Number(row.fare));
      checked++;
    }
    expect(checked).toBe(rows.length);
  });
});

describe('config and service clock', () => {
  it('splits simulation flags and validates DEMO_TIME_OF_DAY', async () => {
    const { loadConfig } = await import('../config.js');
    expect(loadConfig({ SIMULATE: 'true', SIMULATE_REPORTS: 'false' })).toMatchObject({
      simulateVehicles: true,
      simulateReports: false,
    });
    expect(loadConfig({ NODE_ENV: 'production' })).toMatchObject({ simulateVehicles: false, simulateReports: false });
    expect(loadConfig({ DEMO_TIME_OF_DAY: '10:00' }).demoTimeOfDay).toBe('10:00');
    expect(() => loadConfig({ DEMO_TIME_OF_DAY: '25:99' })).toThrow('DEMO_TIME_OF_DAY');
  });

  it('runs the demo clock from the chosen IST time of day, in real time', async () => {
    const { serviceClock } = await import('./time.js');
    const clock = serviceClock('10:00', Date.now());
    const secs = localSecondsOfDay(clock());
    expect(Math.abs(secs - 10 * 3600)).toBeLessThan(5);
    expect(Math.abs(serviceClock()().getTime() - Date.now())).toBeLessThan(50);
  });
});
