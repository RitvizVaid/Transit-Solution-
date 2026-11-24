import type { LngLatTuple } from './geo.js';
import type { VehicleMode } from './transit.js';

export const QUEUE_LEVELS = ['empty', 'normal', 'crowded', 'severe'] as const;
export type PassengerQueueLevel = (typeof QUEUE_LEVELS)[number];

// ---------------------------------------------------------------------------
// GET /api/v1/stands/:standId
// ---------------------------------------------------------------------------

/** A recent marshal report stays in effect this long, then the stand reverts to baseline. */
export const STAND_REPORT_TTL_MS = 30 * 60_000;

/**
 * `reported` = shaped by a marshal report within STAND_REPORT_TTL_MS.
 * `baseline` = typical values from the route schedule; nobody has observed them.
 */
export const STAND_SOURCES = ['baseline', 'reported'] as const;
export type StandSource = (typeof STAND_SOURCES)[number];

export interface StandStatus {
  standId: string;
  name: string;
  coordinates: LngLatTuple;
  /** Where these values come from. Only `reported` values may be shown as live. */
  source: StandSource;
  /** e.g. 5 autos waiting. Null when no recent report gives a basis for a count. */
  availableVehiclesEstimate: number | null;
  passengerQueueLevel: PassengerQueueLevel;
  averageWaitMinutes: number;
  /** ISO 8601: last accepted report, or null if this stand has none. */
  lastReportedAt: string | null;
  /** ISO 8601: when the reported values revert to baseline. Null for baseline. */
  expiresAt: string | null;
  /** ISO 8601: last report, or when the server loaded the feed. Prefer `lastReportedAt`. */
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Driver / marshal reports (POST /api/v1/telemetry/reports)
// ---------------------------------------------------------------------------

export const REPORT_KINDS = [
  'DEPARTING_NOW',
  'STAND_FULL',
  'HEAVY_TRAFFIC',
  'STAND_EMPTY',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface StandReport {
  /** Client-generated idempotency key, reused when an offline report is retried. */
  reportId: string;
  standId: string;
  kind: ReportKind;
  /** Optional head count, e.g. "10+ people waiting" becomes 10. */
  passengerCount?: number;
  reportedAt: string;
}

// ---------------------------------------------------------------------------
// Live vehicles
// ---------------------------------------------------------------------------

/** How full a vehicle is, as told by someone riding it. */
export const OCCUPANCY_LEVELS = ['seats_available', 'standing_only', 'full'] as const;
export type Occupancy = (typeof OCCUPANCY_LEVELS)[number];

/** `crowd` = a commuter sharing their ride; `simulated` = demo traffic, never real. */
export const VEHICLE_SOURCES = ['crowd', 'simulated'] as const;
export type VehicleSource = (typeof VEHICLE_SOURCES)[number];

export interface VehiclePosition {
  vehicleId: string;
  routeId?: string;
  mode: VehicleMode;
  coordinates: LngLatTuple;
  /** Degrees clockwise from north. */
  bearing?: number;
  speedKmh?: number;
  timestamp: string;
  source?: VehicleSource;
  /** Reported by a rider on board (crowd vehicles only). */
  occupancy?: Occupancy;
}

// ---------------------------------------------------------------------------
// Ride sharing: a commuter's phone reports where their vehicle is
// (POST /api/v1/rides/positions, POST /api/v1/rides/end)
// ---------------------------------------------------------------------------

export interface RidePosition {
  /**
   * Random id generated on the rider's phone for one ride. Only the phone knows it, so
   * only that phone can move its vehicle; it is never broadcast.
   */
  rideId: string;
  routeId: string;
  coordinates: LngLatTuple;
  /** GPS accuracy radius in metres, as reported by the browser. */
  accuracyM?: number;
  /** ISO 8601 time the phone took the fix. */
  recordedAt: string;
  /** The rider's latest answer to "how full is it?", if they gave one. */
  occupancy?: Occupancy;
}

export const RIDE_REJECT_REASONS = [
  'unknown_route',
  'off_route',
  'inaccurate',
  'too_frequent',
  'implausible_speed',
  'stale',
  'ride_too_long',
  'capacity',
] as const;
export type RideRejectReason = (typeof RIDE_REJECT_REASONS)[number];

export type RidePositionResponse =
  | {
      accepted: true;
      /** Public id of this ride's vehicle on the live map. */
      vehicleId: string;
      /** Distance from the reported fix to the route line. */
      offsetMeters: number;
    }
  | { accepted: false; reason: RideRejectReason; offsetMeters?: number };

export interface RideEnd {
  rideId: string;
}

// ---------------------------------------------------------------------------
// GET /api/v1/arrivals?stopId=&routeId=&towardsStopId=
// ---------------------------------------------------------------------------

/**
 * A vehicle a rider is sharing that is heading towards the stop. Only crowd vehicles are
 * used: simulated traffic is never turned into an arrival estimate.
 */
export interface ArrivalEstimate {
  routeId: string;
  vehicleId: string;
  /** Expected seconds until it reaches the stop, as a range (running times vary). */
  etaSeconds: { min: number; max: number };
  /** Distance along the route still to cover. */
  distanceMeters: number;
  occupancy?: Occupancy;
  /** ISO 8601 time of the position this is based on. */
  observedAt: string;
}

export interface ArrivalsResponse {
  stopId: string;
  /** Soonest first. Empty when nobody is sharing an approaching vehicle. */
  arrivals: ArrivalEstimate[];
}

// ---------------------------------------------------------------------------
// WebSocket messages, discriminated by `type`
// ---------------------------------------------------------------------------

/** Server to client. */
export type ServerMessage =
  | { type: 'vehicle.position'; payload: VehiclePosition }
  /** The vehicle left the map (e.g. its rider stopped sharing). */
  | { type: 'vehicle.removed'; payload: { vehicleId: string } }
  | { type: 'stand.status'; payload: StandStatus };

/** Client to server: subscribe to a viewport or a set of stands. */
export type ClientMessage =
  | { type: 'subscribe.bbox'; bbox: [west: number, south: number, east: number, north: number] }
  | { type: 'subscribe.stands'; standIds: string[] }
  | { type: 'unsubscribe' };
