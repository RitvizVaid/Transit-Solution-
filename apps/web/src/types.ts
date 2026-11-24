import type { NamedPlace } from '@transit/shared-types';

/** A place the commuter picked as origin or destination. */
export interface Place extends NamedPlace {
  /** Secondary line, e.g. "Chandni Chowk, Delhi". */
  detail?: string;
  source: 'search' | 'gps' | 'url' | 'recent';
}

export interface TripQuery {
  from: Place;
  to: Place;
}
