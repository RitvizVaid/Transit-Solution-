import type { NamedPlace } from './geo.js';

/** Modes a leg can use. Informal modes are first-class, not folded into BUS. */
export const LEG_MODES = [
  'WALK',
  'AUTO_RICKSHAW',
  'E_RICKSHAW',
  'SHARED_TAXI',
  'MINIBUS',
  'BUS',
] as const;
export type LegMode = (typeof LEG_MODES)[number];
export type VehicleMode = Exclude<LegMode, 'WALK'>;

/** Informal-transit wait index shown on itinerary cards. */
export const CONGESTION_LEVELS = ['low', 'moderate', 'high'] as const;
export type CongestionLevel = (typeof CONGESTION_LEVELS)[number];

export interface Money {
  /** ISO 4217 code, e.g. "INR". */
  currency: string;
  amount: number;
}

/** Headway range for frequency-based services (no fixed timetable). */
export interface FrequencyRange {
  min: number;
  max: number;
}

// ---------------------------------------------------------------------------
// GET /api/v1/plan
// ---------------------------------------------------------------------------

export interface PlanRequest {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  /** Comma-separated in the query string, e.g. "TRANSIT,WALK". */
  mode?: string;
  /** ISO 8601 departure time; defaults to now. */
  departAt?: string;
  /** Display names echoed into the first/last legs (e.g. "Kashmere Gate Metro"). */
  fromName?: string;
  toName?: string;
}

export interface PlanResponse {
  itineraries: Itinerary[];
}

export interface Itinerary {
  id: string;
  durationSeconds: number;
  walkTimeSeconds: number;
  transitTimeSeconds: number;
  estimatedFare: Money;
  congestionLevel: CongestionLevel;
  legs: Leg[];
}

export interface Leg {
  mode: LegMode;
  /** e.g. "Route 4A - Ring Road". Absent for WALK legs. */
  routeShortName?: string;
  /** Hex colour, e.g. "#FF8800". */
  routeColor?: string;
  from: NamedPlace;
  to: NamedPlace;
  durationSeconds: number;
  distanceMeters: number;
  /** In minutes, e.g. { min: 3, max: 5 } renders as "every 3-5 min". */
  frequencyMinutes?: FrequencyRange;
  /**
   * Stand where this leg boards, when it is a known stand. Lets clients show
   * live queue status from GET /api/v1/stands/:standId. Absent for WALK legs.
   */
  boardingStandId?: string;
  /** Google encoded polyline (precision 5). */
  geometryPolyline: string;
}

// ---------------------------------------------------------------------------
// Network entities (GET /api/v1/routes, GET /api/v1/stops/nearby)
// ---------------------------------------------------------------------------

export interface TransitRoute {
  id: string;
  shortName: string;
  longName?: string;
  mode: VehicleMode;
  color?: string;
  frequencyMinutes?: FrequencyRange;
  /** Service window for frequency-based routes, "HH:MM" local time. */
  serviceHours?: { start: string; end: string };
}

export interface Stop extends NamedPlace {
  id: string;
  /** True for informal / virtual stops clustered from boarding traces. */
  isVirtual: boolean;
  routeIds: string[];
}

export interface NearbyStop extends Stop {
  distanceMeters: number;
}

export interface NearbyStopsResponse {
  stops: NearbyStop[];
}

/**
 * GET /api/v1/routes/nearest: the closest corridor to a point, with the point snapped
 * onto it. Informal vehicles can often be hailed anywhere along their corridor, so this
 * is useful even when no stop is close.
 */
export interface NearestLineResponse {
  route: TransitRoute;
  /** Closest point on the route's path. */
  snapped: { lat: number; lng: number };
  /** Straight-line distance from the query point to `snapped`. */
  distanceMeters: number;
  /** The route's closest stop to the query point. */
  nearestStop: NearbyStop;
}

// ---------------------------------------------------------------------------
// Fares
// ---------------------------------------------------------------------------

export interface FareRule {
  routeId?: string;
  mode: VehicleMode;
  minimumFare: Money;
  perKm?: number;
  /** Optional zone-to-zone override. */
  fromZone?: string;
  toZone?: string;
}
