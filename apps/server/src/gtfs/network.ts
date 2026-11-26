import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEG_MODES,
  type FrequencyRange,
  type LatLng,
  type NearestLineResponse,
  type NearbyStop,
  type Stop,
  type TransitRoute,
  type VehicleMode,
} from '@transit/shared-types';
import { EARTH_RADIUS_M, haversineMeters, MeasuredLine } from '../services/geo.js';
import { parseCsv } from './csv.js';
import { readServiceCalendars, type ServiceCalendar } from './serviceCalendar.js';

export interface NetworkStop extends Stop {
  isStand: boolean;
  /** GTFS stops.zone_id, used by zonal (stage) fares. */
  zoneId?: string;
}

export interface FareModel {
  minFare: number;
  baseKm: number;
  perKm: number;
  currency: string;
  /** Zonal fares from GTFS fare_rules origin_id/destination_id: "FROM>TO" → price. */
  zoneFares?: Record<string, number>;
}

export interface NetworkRoute extends TransitRoute {
  frequencyMinutes: FrequencyRange;
  serviceHours: { start: string; end: string };
  fare: FareModel;
}

/** One direction of a route: ordered stops with running time and distance from the first stop. */
export interface Pattern {
  tripId: string;
  routeId: string;
  headsign: string;
  stops: { stopId: string; offsetSec: number; distM: number }[];
  shape: MeasuredLine;
  /** Service window in seconds after local midnight. */
  serviceStartSec: number;
  serviceEndSec: number;
  headwaySec: number;
  calendar?: ServiceCalendar;
}

const toSecs = (t: string) => {
  const [h = 0, m = 0, s = 0] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};
const FREQUENCY_TIME = /^\d{1,2}:[0-5]\d:[0-5]\d$/;
const hhmm = (secs: number) =>
  `${String(Math.floor(secs / 3600)).padStart(2, '0')}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}`;

const GTFS_BUS_TYPES = new Set([3, 700, 702, 704, 711, 715]);
function modeFor(row: Record<string, string>): VehicleMode {
  const m = row.informal_mode as VehicleMode | undefined;
  if (m && (LEG_MODES as readonly string[]).includes(m) && m !== ('WALK' as string)) return m;
  return GTFS_BUS_TYPES.has(Number(row.route_type)) ? 'BUS' : 'SHARED_TAXI';
}

/** Grid cell size for the stop index, in degrees (~550 m at Delhi's latitude). */
const CELL = 0.005;

/**
 * In-memory transit network loaded from a GTFS directory. Small feeds (city pilots)
 * fit comfortably in memory; queries are synchronous.
 */
export class TransitNetwork {
  readonly stops = new Map<string, NetworkStop>();
  readonly routes = new Map<string, NetworkRoute>();
  readonly patterns: Pattern[] = [];
  /** stopId → (pattern index, stop index) for every pattern serving the stop. */
  readonly servedBy = new Map<string, { pattern: Pattern; index: number }[]>();
  readonly feedVersion: string;
  private readonly grid = new Map<string, NetworkStop[]>();

  private constructor(feedVersion: string) {
    this.feedVersion = feedVersion;
  }

  static load(dir: string): TransitNetwork {
    const read = (name: string, required = true) => {
      const path = join(dir, name);
      if (!existsSync(path)) {
        if (required) throw new Error(`GTFS file missing: ${path}`);
        return [];
      }
      return parseCsv(readFileSync(path, 'utf8'));
    };

    const feedInfo = read('feed_info.txt', false)[0];
    const net = new TransitNetwork(feedInfo?.feed_version ?? 'unknown');

    const fares = new Map(
      read('informal_fares.txt', false).map((f) => [
        f.route_id!,
        {
          minFare: Number(f.min_fare),
          baseKm: Number(f.base_km),
          perKm: Number(f.per_km),
          currency: f.currency || 'INR',
        },
      ]),
    );
    const flatFares = new Map<string, number>();
    const fareAttrs = new Map(
      read('fare_attributes.txt', false).map((f) => [f.fare_id!, Number(f.price)]),
    );
    const zoneFares = new Map<string, Record<string, number>>();
    for (const r of read('fare_rules.txt', false)) {
      const price = fareAttrs.get(r.fare_id!);
      if (!r.route_id || price === undefined) continue;
      if (r.origin_id && r.destination_id) {
        const table = zoneFares.get(r.route_id) ?? {};
        table[`${r.origin_id}>${r.destination_id}`] = price;
        zoneFares.set(r.route_id, table);
      } else {
        flatFares.set(r.route_id, price);
      }
    }

    const freqByTrip = new Map<string, Record<string, string>>();
    for (const frequency of read('frequencies.txt', false)) {
      const tripId = frequency.trip_id;
      if (!tripId || freqByTrip.has(tripId)) {
        throw new Error('Unsupported GTFS: missing trip ID or multiple frequency windows');
      }
      if (frequency.exact_times === '1') {
        throw new Error('Unsupported GTFS: exact scheduled frequency trips');
      }
      const headway = Number(frequency.headway_secs);
      if (!Number.isSafeInteger(headway) || headway <= 0) {
        throw new Error('Invalid GTFS: frequency headway must be a positive integer');
      }
      const { start_time: start = '', end_time: end = '' } = frequency;
      if (
        !FREQUENCY_TIME.test(start) ||
        !FREQUENCY_TIME.test(end) ||
        toSecs(end) <= toSecs(start)
      ) {
        throw new Error('Invalid GTFS frequency window');
      }
      freqByTrip.set(tripId, frequency);
    }
    const tripRows = read('trips.txt');
    if (tripRows.some((trip) => !trip.trip_id || !freqByTrip.has(trip.trip_id))) {
      throw new Error(
        'Unsupported GTFS: scheduled trips without frequencies cannot be used by the built-in planner',
      );
    }
    const hasCalendar = ['calendar.txt', 'calendar_dates.txt'].some((name) =>
      existsSync(join(dir, name)),
    );
    const serviceCalendars = readServiceCalendars(
      read('calendar.txt', false),
      read('calendar_dates.txt', false),
    );
    if (hasCalendar && tripRows.some((trip) => !serviceCalendars.has(trip.service_id ?? ''))) {
      throw new Error('Invalid GTFS: trip references an unknown service calendar');
    }
    const shapes = new Map<string, { seq: number; p: LatLng }[]>();
    for (const s of read('shapes.txt', false)) {
      const list = shapes.get(s.shape_id!) ?? [];
      list.push({
        seq: Number(s.shape_pt_sequence),
        p: { lat: Number(s.shape_pt_lat), lng: Number(s.shape_pt_lon) },
      });
      shapes.set(s.shape_id!, list);
    }

    const routeRows = read('routes.txt');
    const stopTimes = new Map<string, Record<string, string>[]>();
    for (const st of read('stop_times.txt')) {
      const list = stopTimes.get(st.trip_id!) ?? [];
      list.push(st);
      stopTimes.set(st.trip_id!, list);
    }

    // Stops: routeIds filled in below.
    for (const s of read('stops.txt')) {
      if (s.location_type && s.location_type !== '0') continue;
      const stop: NetworkStop = {
        id: s.stop_id!,
        name: s.stop_name!,
        lat: Number(s.stop_lat),
        lng: Number(s.stop_lon),
        isVirtual: s.informal_stop === '1',
        isStand: s.is_stand === '1',
        zoneId: s.zone_id || undefined,
        routeIds: [],
      };
      net.stops.set(stop.id, stop);
      const key = net.cellKey(stop.lat, stop.lng);
      net.grid.set(key, [...(net.grid.get(key) ?? []), stop]);
    }

    for (const trip of tripRows) {
      const rows = (stopTimes.get(trip.trip_id!) ?? []).sort(
        (a, b) => Number(a.stop_sequence) - Number(b.stop_sequence),
      );
      if (rows.length < 2) continue;
      const t0 = toSecs(rows[0]!.departure_time!);
      const shapePts = (shapes.get(trip.shape_id ?? '') ?? [])
        .sort((a, b) => a.seq - b.seq)
        .map((x) => x.p);
      const stopPts = rows
        .map((r) => net.stops.get(r.stop_id!))
        .filter((s): s is NetworkStop => !!s);
      const shape = new MeasuredLine(shapePts.length >= 2 ? shapePts : stopPts);
      const freq = freqByTrip.get(trip.trip_id!)!;

      let cumStraight = 0;
      const stops = rows.map((r, i) => {
        if (i > 0) {
          const prev = net.stops.get(rows[i - 1]!.stop_id!);
          const cur = net.stops.get(r.stop_id!);
          if (prev && cur) cumStraight += haversineMeters(prev, cur);
        }
        return {
          stopId: r.stop_id!,
          offsetSec: toSecs(r.departure_time!) - t0,
          distM: r.shape_dist_traveled ? Number(r.shape_dist_traveled) : cumStraight,
        };
      });

      net.patterns.push({
        tripId: trip.trip_id!,
        routeId: trip.route_id!,
        headsign: trip.trip_headsign || net.stops.get(rows[rows.length - 1]!.stop_id!)?.name || '',
        stops,
        shape,
        serviceStartSec: toSecs(freq.start_time!),
        serviceEndSec: toSecs(freq.end_time!),
        headwaySec: Number(freq.headway_secs),
        calendar: serviceCalendars.get(trip.service_id ?? ''),
      });
    }

    for (const r of routeRows) {
      const patterns = net.patterns.filter((p) => p.routeId === r.route_id);
      if (!patterns.length) continue;
      const headway = Math.round((patterns[0]!.headwaySec / 60) * 10) / 10;
      const min = r.min_headway_min ? Number(r.min_headway_min) : headway;
      const max = r.max_headway_min ? Number(r.max_headway_min) : headway;
      const start = Math.min(...patterns.map((p) => p.serviceStartSec));
      const end = Math.max(...patterns.map((p) => p.serviceEndSec));
      net.routes.set(r.route_id!, {
        id: r.route_id!,
        shortName: r.route_short_name || r.route_id!,
        longName: r.route_long_name || undefined,
        mode: modeFor(r),
        color: r.route_color ? `#${r.route_color}` : undefined,
        frequencyMinutes: { min, max },
        serviceHours: { start: hhmm(start), end: hhmm(end) },
        fare: {
          ...(fares.get(r.route_id!) ?? {
            minFare: flatFares.get(r.route_id!) ?? 0,
            baseKm: 0,
            perKm: 0,
            currency: 'INR',
          }),
          zoneFares: zoneFares.get(r.route_id!),
        },
      });
    }

    for (const pattern of net.patterns) {
      pattern.stops.forEach((s, index) => {
        const list = net.servedBy.get(s.stopId) ?? [];
        list.push({ pattern, index });
        net.servedBy.set(s.stopId, list);
        const stop = net.stops.get(s.stopId);
        if (stop && !stop.routeIds.includes(pattern.routeId)) stop.routeIds.push(pattern.routeId);
      });
    }
    return net;
  }

  private cellKey(lat: number, lng: number) {
    return `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
  }

  /** Stops within `radiusM`, nearest first. Uses the grid index to avoid scanning everything. */
  nearbyStops(point: LatLng, radiusM: number): NearbyStop[] {
    const radians = radiusM / EARTH_RADIUS_M;
    const dLat = (radians * 180) / Math.PI;
    const longitudeRatio = Math.sin(radians) / Math.cos((point.lat * Math.PI) / 180);
    const dLng = (Math.asin(Math.min(1, longitudeRatio)) * 180) / Math.PI;
    const out: NearbyStop[] = [];
    const include = (stop: NetworkStop) => {
      const distance = haversineMeters(point, stop);
      if (!Number.isFinite(distance) || distance > radiusM) return;
      const { isStand: _isStand, zoneId: _zoneId, ...publicStop } = stop;
      out.push({
        ...publicStop,
        routeIds: [...stop.routeIds],
        distanceMeters: Math.round(distance),
      });
    };
    const minLat = Math.floor((point.lat - dLat) / CELL);
    const maxLat = Math.floor((point.lat + dLat) / CELL);
    const minLng = Math.floor((point.lng - dLng) / CELL);
    const maxLng = Math.floor((point.lng + dLng) / CELL);
    const cells = (maxLat - minLat + 1) * (maxLng - minLng + 1);
    // Near a pole or the date line, scanning is simpler and avoids a large cell sweep.
    if (
      longitudeRatio >= 1 ||
      cells > this.stops.size ||
      point.lng - dLng <= -180 ||
      point.lng + dLng >= 180
    ) {
      for (const stop of this.stops.values()) include(stop);
    } else {
      for (let la = minLat; la <= maxLat; la++) {
        for (let ln = minLng; ln <= maxLng; ln++) {
          for (const stop of this.grid.get(`${la}:${ln}`) ?? []) include(stop);
        }
      }
    }
    return out.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  /** Closest route corridor to a point, with the point snapped onto the route's path. */
  nearestLine(point: LatLng): NearestLineResponse | null {
    let best: { pattern: Pattern; snapped: LatLng; offsetM: number } | null = null;
    for (const pattern of this.patterns) {
      const { point: snapped, offsetM } = pattern.shape.project(point);
      if (!best || offsetM < best.offsetM) best = { pattern, snapped, offsetM };
    }
    if (!best) return null;
    const route = this.routes.get(best.pattern.routeId);
    if (!route) return null;
    const nearestStop = best.pattern.stops
      .map((s) => this.stops.get(s.stopId)!)
      .map((s) => ({ s, d: haversineMeters(point, s) }))
      .sort((a, b) => a.d - b.d)[0]!;
    const { isStand: _i, zoneId: _z, ...stop } = nearestStop.s;
    const { fare: _f, ...publicRoute } = route;
    return {
      route: publicRoute,
      snapped: {
        lat: Math.round(best.snapped.lat * 1e6) / 1e6,
        lng: Math.round(best.snapped.lng * 1e6) / 1e6,
      },
      distanceMeters: Math.round(best.offsetM),
      nearestStop: {
        ...stop,
        routeIds: [...stop.routeIds],
        distanceMeters: Math.round(nearestStop.d),
      },
    };
  }

  listRoutes(): TransitRoute[] {
    return [...this.routes.values()]
      .map(({ fare: _fare, ...r }) => r)
      .sort((a, b) => a.shortName.localeCompare(b.shortName));
  }

  stands(): NetworkStop[] {
    return [...this.stops.values()].filter((s) => s.isStand);
  }
}
