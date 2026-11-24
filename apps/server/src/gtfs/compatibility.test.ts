import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
});
