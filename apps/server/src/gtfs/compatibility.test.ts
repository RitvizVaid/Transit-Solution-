import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Planner } from '../services/planner.js';
import { simulatedPositions } from '../services/simulator.js';
import { TransitNetwork } from './network.js';

describe('GTFS compatibility', () => {
  it.each([
    ['', 'scheduled trips without frequencies'],
    [
      'trip_id,start_time,end_time,headway_secs,exact_times\ntrip,06:00:00,07:00:00,600,0\ntrip,07:00:00,08:00:00,900,0\n',
      'multiple frequency windows',
    ],
    [
      'trip_id,start_time,end_time,headway_secs,exact_times\ntrip,06:00:00,07:00:00,600,1\n',
      'exact scheduled frequency trips',
    ],
  ])('rejects unsupported schedules before loading stop times', (frequencies, error) => {
    const dir = mkdtempSync(join(tmpdir(), 'transit-gtfs-test-'));
    try {
      writeFileSync(join(dir, 'trips.txt'), 'trip_id,route_id,service_id\ntrip,route,service\n');
      if (frequencies) writeFileSync(join(dir, 'frequencies.txt'), frequencies);
      expect(() => TransitNetwork.load(dir)).toThrow(error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([true, false])('uses Delhi service dates and overnight windows (weekly=%s)', (weekly) => {
    const dir = mkdtempSync(join(tmpdir(), 'transit-calendar-test-'));
    try {
      const files = {
        'routes.txt': 'route_id,route_short_name,route_type\nnight,Night feeder,3\n',
        'trips.txt': 'trip_id,route_id,service_id\ntrip,night,WEEKLY\n',
        'stops.txt':
          'stop_id,stop_name,stop_lat,stop_lon\na,Start,28.66,77.23\nb,End,28.68,77.23\n',
        'stop_times.txt':
          'trip_id,stop_id,stop_sequence,departure_time\ntrip,a,1,22:00:00\ntrip,b,2,22:10:00\n',
        'frequencies.txt':
          'trip_id,start_time,end_time,headway_secs,exact_times\ntrip,22:00:00,25:00:00,600,0\n',
        'calendar.txt':
          'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWEEKLY,1,0,0,0,0,0,0,20261101,20261130\n',
        'calendar_dates.txt':
          'service_id,date,exception_type\nWEEKLY,20261124,1\nWEEKLY,20261130,2\n',
      };
      for (const [name, contents] of Object.entries(files)) {
        if (weekly || name !== 'calendar.txt') writeFileSync(join(dir, name), contents);
      }
      const network = TransitNetwork.load(dir);
      const planner = new Planner(network);
      const from = { lat: 28.66, lng: 77.23 };
      const to = { lat: 28.68, lng: 77.23 };
      for (const [when, expected] of [
        ['2026-11-22T23:00:00+05:30', false], // Sunday is disabled.
        ['2026-11-23T23:00:00+05:30', weekly],
        ['2026-11-24T00:30:00+05:30', weekly], // Monday's overnight service.
        ['2026-11-24T23:00:00+05:30', true], // Tuesday added by exception.
        ['2026-11-25T00:30:00+05:30', true],
        ['2026-11-25T01:15:00+05:30', false],
        ['2026-11-30T23:00:00+05:30', false], // Monday removed by exception.
        ['2026-12-07T23:00:00+05:30', false], // Outside the active date range.
      ] as const) {
        const departAt = new Date(when);
        const plan = planner.plan(from, to, { departAt });
        expect({
          when,
          planned: plan.itineraries.some((trip) =>
            trip.legs.some((leg) => leg.routeId === 'night'),
          ),
          simulated: simulatedPositions(network, departAt).length > 0,
        }).toEqual({ when, planned: expected, simulated: expected });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
