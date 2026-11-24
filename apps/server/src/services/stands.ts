import { EventEmitter } from 'node:events';
import type { PassengerQueueLevel, StandReport, StandStatus } from '@transit/shared-types';
import type { TransitNetwork } from '../gtfs/network.js';

/** A stand's state falls back to its schedule-based baseline when reports are this old. */
export const REPORT_TTL_MS = 30 * 60_000;
const QUEUE_ORDER: PassengerQueueLevel[] = ['empty', 'normal', 'crowded', 'severe'];

interface StandState {
  status: StandStatus;
  baseline: StandStatus;
  /** Timestamps of recent "Departing now" reports, used to measure the real headway. */
  departures: number[];
  reportedAt: number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const shiftQueue = (q: PassengerQueueLevel, by: number) =>
  QUEUE_ORDER[clamp(QUEUE_ORDER.indexOf(q) + by, 0, QUEUE_ORDER.length - 1)]!;

/**
 * Live state of marshalled stands, driven by driver/marshal reports.
 * Emits `change` with the new StandStatus after every report.
 *
 * In-memory: correct for a single API instance. For several instances, back this
 * with Redis (hash per stand + pub/sub on `change`); the interface stays the same.
 */
export class StandStore extends EventEmitter<{ change: [StandStatus] }> {
  private readonly stands = new Map<string, StandState>();
  private readonly now: () => number;

  constructor(network: TransitNetwork, now: () => number = Date.now) {
    super();
    this.now = now;
    const loadedAt = new Date(now()).toISOString();
    for (const stop of network.stands()) {
      // Baseline: expected wait = half the shortest mean headway of routes serving the stand.
      const headways = stop.routeIds
        .map((id) => network.routes.get(id)?.frequencyMinutes)
        .filter((f): f is { min: number; max: number } => !!f)
        .map((f) => (f.min + f.max) / 2);
      const wait = Math.max(1, Math.round(Math.min(...headways, 20) / 2));
      const baseline: StandStatus = {
        standId: stop.id,
        name: stop.name,
        coordinates: [stop.lng, stop.lat],
        availableVehiclesEstimate: 2,
        passengerQueueLevel: 'normal',
        averageWaitMinutes: wait,
        lastUpdated: loadedAt,
      };
      this.stands.set(stop.id, { status: baseline, baseline, departures: [], reportedAt: null });
    }
  }

  /** Replays recent persisted observations in event-time order during server startup. */
  restore(reports: StandReport[]): void {
    for (const report of reports) {
      if (this.has(report.standId)) this.apply(report);
    }
  }

  has(standId: string): boolean {
    return this.stands.has(standId);
  }

  get(standId: string): StandStatus | undefined {
    const s = this.stands.get(standId);
    if (!s) return undefined;
    if (s.reportedAt !== null && this.now() - s.reportedAt > REPORT_TTL_MS) {
      // Stale reports: show the baseline but keep the honest "last report" time.
      return { ...s.baseline, lastUpdated: s.status.lastUpdated };
    }
    return s.status;
  }

  list(): StandStatus[] {
    return [...this.stands.keys()].map((id) => this.get(id)!);
  }

  /** Expected wait at a stand in minutes, if it is a stand with fresh information. */
  waitMinutes(standId: string): number | undefined {
    return this.get(standId)?.averageWaitMinutes;
  }

  apply(report: StandReport): StandStatus {
    const state = this.stands.get(report.standId);
    if (!state) throw new Error(`unknown stand ${report.standId}`);
    const at = Date.parse(report.reportedAt);
    const ts = Number.isFinite(at) && at <= this.now() + 60_000 ? at : this.now();
    const cur = this.get(report.standId)!;
    const base = state.baseline;
    const next: StandStatus = { ...cur, lastUpdated: new Date(ts).toISOString() };

    switch (report.kind) {
      case 'DEPARTING_NOW': {
        state.departures = [...state.departures, ts].filter((t) => ts - t < 60 * 60_000).slice(-6);
        next.availableVehiclesEstimate = Math.max(0, cur.availableVehiclesEstimate - 1);
        next.passengerQueueLevel = shiftQueue(cur.passengerQueueLevel, -1);
        if (state.departures.length >= 3) {
          // Measured headway from the last departures beats the schedule.
          const gaps = state.departures.slice(1).map((t, i) => t - state.departures[i]!);
          const meanMin = gaps.reduce((a, b) => a + b, 0) / gaps.length / 60_000;
          next.averageWaitMinutes = clamp(Math.round(meanMin / 2), 1, 30);
        }
        break;
      }
      case 'STAND_FULL': {
        // A second "full" report, or 20+ people, means the queue is out of hand.
        const alreadyCrowded = QUEUE_ORDER.indexOf(cur.passengerQueueLevel) >= 2;
        const many = (report.passengerCount ?? 10) >= 20;
        next.passengerQueueLevel = many || alreadyCrowded ? 'severe' : 'crowded';
        next.averageWaitMinutes = clamp(
          Math.max(cur.averageWaitMinutes, base.averageWaitMinutes * 2),
          1,
          30,
        );
        next.availableVehiclesEstimate = 0;
        break;
      }
      case 'STAND_EMPTY': {
        next.passengerQueueLevel = 'empty';
        next.availableVehiclesEstimate = cur.availableVehiclesEstimate + 1;
        next.averageWaitMinutes = Math.max(
          1,
          Math.min(cur.averageWaitMinutes, base.averageWaitMinutes),
        );
        break;
      }
      case 'HEAVY_TRAFFIC': {
        next.averageWaitMinutes = clamp(Math.round(cur.averageWaitMinutes * 1.5 + 1), 1, 30);
        break;
      }
    }

    state.status = next;
    state.reportedAt = ts;
    this.emit('change', next);
    return next;
  }
}
