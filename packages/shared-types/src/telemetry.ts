import type { LngLatTuple } from './geo.js';
import type { VehicleMode } from './transit.js';

export const QUEUE_LEVELS = ['empty', 'normal', 'crowded', 'severe'] as const;
export type PassengerQueueLevel = (typeof QUEUE_LEVELS)[number];

// ---------------------------------------------------------------------------
// GET /api/v1/stands/:standId
// ---------------------------------------------------------------------------

export interface StandStatus {
  standId: string;
  name: string;
  coordinates: LngLatTuple;
  /** e.g. 5 autos waiting. */
  availableVehiclesEstimate: number;
  passengerQueueLevel: PassengerQueueLevel;
  averageWaitMinutes: number;
  /** ISO 8601 timestamp. */
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
  standId: string;
  kind: ReportKind;
  /** Optional head count, e.g. "10+ people waiting" becomes 10. */
  passengerCount?: number;
  reportedAt: string;
}

// ---------------------------------------------------------------------------
// Live vehicles
// ---------------------------------------------------------------------------

export interface VehiclePosition {
  vehicleId: string;
  routeId?: string;
  mode: VehicleMode;
  coordinates: LngLatTuple;
  /** Degrees clockwise from north. */
  bearing?: number;
  speedKmh?: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// WebSocket messages, discriminated by `type`
// ---------------------------------------------------------------------------

/** Server to client. */
export type ServerMessage =
  | { type: 'vehicle.position'; payload: VehiclePosition }
  | { type: 'stand.status'; payload: StandStatus };

/** Client to server: subscribe to a viewport or a set of stands. */
export type ClientMessage =
  | { type: 'subscribe.bbox'; bbox: [west: number, south: number, east: number, north: number] }
  | { type: 'subscribe.stands'; standIds: string[] }
  | { type: 'unsubscribe' };
