import type { NearbyStop, TransitRoute } from '@transit/shared-types';
import { describe, expect, it } from 'vitest';
import { groupNearbyLines } from './nearby';

const route = (id: string): TransitRoute => ({ id, shortName: id, mode: 'AUTO_RICKSHAW' });
const stop = (id: string, distanceMeters: number, routeIds: string[]): NearbyStop => ({
  id,
  name: id,
  lat: 0,
  lng: 0,
  isVirtual: false,
  routeIds,
  distanceMeters,
});

describe('groupNearbyLines', () => {
  it('lists each route once at its nearest stop, closest first', () => {
    const lines = groupNearbyLines(
      [stop('far', 250, ['A', 'B']), stop('near', 40, ['B']), stop('mid', 120, ['C', 'A'])],
      [route('A'), route('B'), route('C')],
    );
    expect(lines.map((l) => [l.route.id, l.nearestStop.id, l.stopCount])).toEqual([
      ['B', 'near', 2],
      ['A', 'mid', 2],
      ['C', 'mid', 1],
    ]);
  });

  it('ignores stops served only by unknown routes', () => {
    expect(groupNearbyLines([stop('s', 10, ['ghost'])], [route('A')])).toEqual([]);
  });

  it('breaks distance ties by route name', () => {
    const lines = groupNearbyLines([stop('s', 10, ['Z', 'M'])], [route('Z'), route('M')]);
    expect(lines.map((l) => l.route.id)).toEqual(['M', 'Z']);
  });
});
