import { NO_ROUTE_REASONS } from '@transit/shared-types';
import { describe, expect, it } from 'vitest';
import { noRouteText } from './TripResults';

describe('noRouteText', () => {
  it('has specific copy for every reason and never claims no service exists', () => {
    const texts = [...NO_ROUTE_REASONS, undefined].map(noRouteText);
    expect(new Set(texts).size).toBe(NO_ROUTE_REASONS.length);
    for (const t of texts) expect(t).not.toMatch(/no (shared autos|service)|don.t run/i);
  });
});
