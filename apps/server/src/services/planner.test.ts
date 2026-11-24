import { describe, expect, it, vi } from 'vitest';
import { MORNING, NIGHT, PLACES, pilotNetwork } from '../test/fixtures.js';
import { decodePolyline, haversineMeters } from './geo.js';
import { OtpClient } from './otp.js';
import { Planner } from './planner.js';
import { PlanService } from './planService.js';
import { StandStore } from './stands.js';

const net = pilotNetwork();
const rides = (legs: { mode: string; routeShortName?: string }[]) =>
  legs.filter((l) => l.mode !== 'WALK').map((l) => l.routeShortName);

describe('Planner (built-in)', () => {
  const planner = new Planner(net, new StandStore(net, () => MORNING.getTime()));

  it('finds the direct shared auto from Kashmere Gate to Chandni Chowk', () => {
    const { itineraries } = planner.plan(PLACES.kgMetro, PLACES.ccMarket, {
      departAt: MORNING,
      fromName: 'Kashmere Gate Metro',
      toName: 'Chandni Chowk Market',
    });
    const best = itineraries[0]!;
    expect(rides(best.legs)).toEqual(['KG-1']);
    const ride = best.legs.find((l) => l.mode !== 'WALK')!;
    expect(ride).toMatchObject({
      mode: 'AUTO_RICKSHAW',
      boardingStandId: 'kg-auto-1',
      routeColor: '#16A34A',
    });
    expect(best.legs[0]!.from.name).toBe('Kashmere Gate Metro');
    expect(best.legs.at(-1)!.to.name).toBe('Chandni Chowk Market');
    expect(best.estimatedFare).toEqual({ currency: 'INR', amount: 20 });
  });

  it('reports duration = walks + expected waits + ride time', () => {
    const best = planner.plan(PLACES.kgMetro, PLACES.ccMarket, { departAt: MORNING })
      .itineraries[0]!;
    const wait = best.durationSeconds - best.walkTimeSeconds - best.transitTimeSeconds;
    expect(wait).toBe(2 * 60); // KG stand baseline: ~2 min
    expect(best.walkTimeSeconds).toBe(
      best.legs.filter((l) => l.mode === 'WALK').reduce((s, l) => s + l.durationSeconds, 0),
    );
  });

  it('uses a transfer when no single route connects', () => {
    const { itineraries } = planner.plan(PLACES.civilLines, PLACES.redFort, { departAt: MORNING });
    expect(itineraries.length).toBeGreaterThan(0);
    const withTransfer = itineraries.find((option) => rides(option.legs).length === 2);
    expect(withTransfer).toBeDefined();
    expect(rides(withTransfer!.legs)[0]).toBe('CL-6');
    // Two separate tickets.
    expect(withTransfer!.estimatedFare.amount).toBeGreaterThanOrEqual(20);
  });

  it('routes New Delhi station to Connaught Place on NR-5', () => {
    const best = planner.plan(PLACES.ndls, PLACES.cp, { departAt: MORNING }).itineraries[0]!;
    expect(rides(best.legs)).toEqual(['NR-5']);
  });

  it('produces ride geometry that follows the route between the stops', () => {
    const best = planner.plan(PLACES.kgMetro, PLACES.ccMarket, { departAt: MORNING })
      .itineraries[0]!;
    const ride = best.legs.find((l) => l.mode !== 'WALK')!;
    const pts = decodePolyline(ride.geometryPolyline);
    expect(pts.length).toBeGreaterThan(3);
    expect(haversineMeters(pts[0]!, ride.from)).toBeLessThan(20);
    expect(haversineMeters(pts.at(-1)!, ride.to)).toBeLessThan(20);
  });

  it('offers walking only at night for short trips, and nothing for long ones', () => {
    const short = planner.plan(PLACES.kgMetro, PLACES.ccMarket, { departAt: NIGHT }).itineraries;
    expect(short).toHaveLength(1);
    expect(short[0]!.legs.map((l) => l.mode)).toEqual(['WALK']);
    expect(planner.plan(PLACES.civilLines, PLACES.ito, { departAt: NIGHT }).itineraries).toEqual(
      [],
    );
  });

  it('returns nothing outside the network', () => {
    expect(planner.plan(PLACES.gurugram, PLACES.cp, { departAt: MORNING }).itineraries).toEqual([]);
  });

  it('never returns two options on the same route sequence', () => {
    const { itineraries } = planner.plan(PLACES.kgMetro, PLACES.redFort, { departAt: MORNING });
    const sigs = itineraries.map((option) => rides(option.legs).join('>'));
    expect(new Set(sigs).size).toBe(sigs.length);
    expect(itineraries.length).toBeLessThanOrEqual(3);
  });

  it('lets live stand reports change waits and congestion', () => {
    const stands = new StandStore(net, () => MORNING.getTime());
    const live = new Planner(net, stands);
    const before = live.plan(PLACES.kgMetro, PLACES.ccMarket, { departAt: MORNING })
      .itineraries[0]!;
    for (let i = 0; i < 2; i++) {
      stands.apply({ standId: 'kg-auto-1', kind: 'STAND_FULL', reportedAt: MORNING.toISOString() });
    }
    const after = live
      .plan(PLACES.kgMetro, PLACES.ccMarket, { departAt: MORNING })
      .itineraries.find((option) => rides(option.legs).includes('KG-1'))!;
    expect(after.durationSeconds).toBeGreaterThan(before.durationSeconds);
    expect(after.congestionLevel).toBe('high');
  });
});

describe('OTP integration', () => {
  const otpBody = {
    data: {
      plan: {
        itineraries: [
          {
            duration: 900,
            walkTime: 240,
            legs: [
              {
                mode: 'WALK',
                duration: 150,
                distance: 200,
                transitLeg: false,
                route: null,
                from: { name: 'Origin', lat: 28.6675, lon: 77.2282, stop: null },
                to: {
                  name: 'Kashmere Gate Auto Stand',
                  lat: 28.6662,
                  lon: 77.2296,
                  stop: { gtfsId: '1:kg-auto-1' },
                },
                legGeometry: { points: 'abc' },
              },
              {
                mode: 'BUS',
                duration: 600,
                distance: 1150,
                transitLeg: true,
                route: { gtfsId: '1:KG-1', shortName: 'KG-1', color: '16A34A' },
                from: {
                  name: 'Kashmere Gate Auto Stand',
                  lat: 28.6662,
                  lon: 77.2296,
                  stop: { gtfsId: '1:kg-auto-1' },
                },
                to: {
                  name: 'Chandni Chowk Stand',
                  lat: 28.656,
                  lon: 77.231,
                  stop: { gtfsId: '1:ccm-auto-1' },
                },
                legGeometry: { points: 'def' },
              },
            ],
          },
        ],
      },
    },
  };

  it('maps OTP itineraries onto our contract with informal modes and fares', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(otpBody), { status: 200 }));
    const otp = new OtpClient(
      'http://otp:8080',
      net,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    const { itineraries } = await otp.plan(PLACES.kgMetro, PLACES.ccMarket, {
      departAt: MORNING,
      fromName: 'KG Metro',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://otp:8080/otp/gtfs/v1',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.variables).toMatchObject({ date: '2026-12-01', time: '10:00' });
    const it0 = itineraries[0]!;
    expect(it0.legs[0]!.from.name).toBe('KG Metro');
    expect(it0.legs[1]).toMatchObject({
      mode: 'AUTO_RICKSHAW',
      boardingStandId: 'kg-auto-1',
      routeColor: '#16A34A',
    });
    expect(it0.estimatedFare.amount).toBe(20);
  });

  it('falls back to the built-in planner when OTP fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('down', { status: 503 }));
    const service = new PlanService(
      new Planner(net),
      new OtpClient('http://otp:8080', net, undefined, fetchImpl as unknown as typeof fetch),
    );
    const res = await service.plan(PLACES.kgMetro, PLACES.ccMarket, { departAt: MORNING });
    expect(res.source).toBe('builtin');
    expect(res.plan.itineraries.length).toBeGreaterThan(0);
  });
});

describe('network coverage (Sprint 2 goal: plan between any two points in the pilot zone)', () => {
  const planner = new Planner(net);
  /** Needs 5 informal rides; in reality a metro trip. Closing it needs a new corridor (C4). */
  const KNOWN_GAPS = new Set(['civil-lines-metro>rajiv-chowk-g5', 'rajiv-chowk-g5>civil-lines-metro']);

  it('connects every pair of stops during service hours, except documented gaps', () => {
    const stops = [...net.stops.values()];
    const unplannable: string[] = [];
    for (const a of stops) {
      for (const b of stops) {
        if (a === b) continue;
        if (!planner.plan(a, b, { departAt: MORNING }).itineraries.length) unplannable.push(`${a.id}>${b.id}`);
      }
    }
    expect(unplannable.sort()).toEqual([...KNOWN_GAPS].sort());
    expect(stops.length * (stops.length - 1) - unplannable.length).toBeGreaterThanOrEqual(550);
  });

  it('falls back to a multi-transfer route when nothing simpler exists', () => {
    const kg = net.stops.get('kg-auto-1')!;
    const cp = net.stops.get('rajiv-chowk-g5')!;
    const best = planner.plan(kg, cp, { departAt: MORNING }).itineraries[0]!;
    expect(rides(best.legs)).toEqual(['KG-1', 'NS-8', 'JM-3', 'NR-5']);
    // Separate ticket per ride, and every ride leg is connected end to start.
    expect(best.estimatedFare.amount).toBeGreaterThanOrEqual(4 * 10);
    for (let i = 1; i < best.legs.length; i++) {
      expect(haversineMeters(best.legs[i - 1]!.to, best.legs[i]!.from)).toBeLessThan(1);
    }
  });

  it('plans in well under a millisecond per query on the pilot network', () => {
    const t = performance.now();
    for (let i = 0; i < 200; i++) planner.plan(PLACES.civilLines, PLACES.ito, { departAt: MORNING });
    expect((performance.now() - t) / 200).toBeLessThan(5);
  });
});
