import { describe, expect, it } from 'vitest';
import { pilotNetwork } from '../test/fixtures.js';
import { parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿id,name\r\n1,"Chandni Chowk, Old Delhi"\r\n2,"say ""hi"""\r\n');
    expect(rows).toEqual([
      { id: '1', name: 'Chandni Chowk, Old Delhi' },
      { id: '2', name: 'say "hi"' },
    ]);
  });

  it('fills missing trailing fields and ignores blank lines', () => {
    expect(parseCsv('a,b,c\n1,2\n\n')).toEqual([{ a: '1', b: '2', c: '' }]);
  });
});

describe('TransitNetwork (pilot feed)', () => {
  const net = pilotNetwork();

  it('loads every route with informal extensions', () => {
    expect(net.routes.size).toBe(8);
    const kg1 = net.routes.get('KG-1')!;
    expect(kg1).toMatchObject({
      mode: 'AUTO_RICKSHAW',
      color: '#16A34A',
      frequencyMinutes: { min: 3, max: 5 },
      serviceHours: { start: '06:00', end: '23:00' },
      fare: { minFare: 20, baseKm: 1.5, perKm: 8, currency: 'INR' },
    });
    expect(net.routes.get('CC-RF')!.mode).toBe('E_RICKSHAW');
    expect(net.routes.get('M-14')!.mode).toBe('MINIBUS');
  });

  it('builds two directional patterns per route with increasing offsets', () => {
    expect(net.patterns).toHaveLength(16);
    for (const p of net.patterns) {
      for (let i = 1; i < p.stops.length; i++) {
        expect(p.stops[i]!.offsetSec).toBeGreaterThan(p.stops[i - 1]!.offsetSec);
        expect(p.stops[i]!.distM).toBeGreaterThan(p.stops[i - 1]!.distM);
      }
    }
  });

  it('knows which routes serve each stop and which stops are stands', () => {
    const kg = net.stops.get('kg-auto-1')!;
    expect(kg.isStand).toBe(true);
    expect(kg.routeIds.sort()).toEqual(['CL-6', 'GR-2', 'KG-1']);
    expect(net.stops.get('sis-ganj')!.isVirtual).toBe(true);
  });

  it('finds nearby stops within the radius, nearest first', () => {
    const stops = net.nearbyStops({ lat: 28.6662, lng: 77.2296 }, 300);
    expect(stops[0]!.id).toBe('kg-auto-1');
    expect(stops[0]!.distanceMeters).toBe(0);
    expect(stops.every((s) => s.distanceMeters <= 300)).toBe(true);
    const sorted = [...stops].sort((a, b) => a.distanceMeters - b.distanceMeters);
    expect(stops).toEqual(sorted);
    expect(stops[0]).not.toHaveProperty('isStand');
  });

  it('returns nothing far from the network', () => {
    expect(net.nearbyStops({ lat: 28.4595, lng: 77.0266 }, 2000)).toEqual([]);
  });
});
