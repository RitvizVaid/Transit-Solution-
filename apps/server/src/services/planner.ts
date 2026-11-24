import type {
  CongestionLevel,
  Itinerary,
  LatLng,
  Leg,
  NamedPlace,
  PlanResponse,
} from '@transit/shared-types';
import type { NetworkRoute, Pattern, TransitNetwork } from '../gtfs/network.js';
import { itineraryFare } from './fares.js';
import { encodePolyline, haversineMeters } from './geo.js';
import type { StandStore } from './stands.js';
import { isWithin, localSecondsOfDay } from './time.js';

export interface PlanOptions {
  departAt?: Date;
  fromName?: string;
  toName?: string;
  maxResults?: number;
}

/** Tunables. Exported so tests and future config can reason about them. */
export const PLANNER = {
  walkSpeedMs: 1.25, // 4.5 km/h
  /** Streets are not straight lines: straight-line distance × this ≈ walking distance. */
  detourFactor: 1.25,
  maxAccessWalkM: 800,
  maxTransferWalkM: 400,
  /** Ranking penalty per transfer (not added to the displayed duration). */
  transferPenaltySec: 180,
  /** Below this, an access/egress walk is dropped from the itinerary. */
  minWalkLegM: 30,
  /** Nobody boards a shared auto for a few hundred metres; shorter hops are walked. */
  minRideM: 500,
  /** Deep-search fallback limit (rides) when nothing with ≤ 1 transfer exists. */
  maxRides: 4,
  /** Offer walking the whole way up to this straight-line distance. */
  maxWalkOnlyM: 2500,
  /** Drop options slower than best × ratio + slack. */
  keepRatio: 1.6,
  keepSlackSec: 600,
} as const;

interface Access {
  stopId: string;
  walkM: number;
  walkSec: number;
}

interface Ride {
  pattern: Pattern;
  route: NetworkRoute;
  board: number;
  alight: number;
  waitSec: number;
}

interface TransferWalk {
  fromStopId: string;
  toStopId: string;
  walkM: number;
  walkSec: number;
}

interface Option {
  key: string;
  rankSec: number;
  rides: Ride[];
  access?: Access;
  egress?: Access;
  /** transfers[i] = walk between rides[i] alighting and rides[i + 1] boarding (0 m if same stop). */
  transfers?: TransferWalk[];
  walkOnly?: { walkM: number; walkSec: number };
}

/** Round-based search state: standing at a stop, ready to board the next ride. */
interface Ready {
  stopId: string;
  cost: number;
  via:
    | { kind: 'access'; access: Access }
    | {
        kind: 'transfer';
        fromStopId: string;
        walk: { walkM: number; walkSec: number };
        arrived: Arrived;
      };
}

/** Round-based search state: just got off a ride at a stop. */
interface Arrived {
  cost: number;
  ride: Ride;
  ready: Ready;
}

const walkFor = (straightM: number) => {
  const walkM = straightM * PLANNER.detourFactor;
  return { walkM: Math.round(walkM), walkSec: Math.round(walkM / PLANNER.walkSpeedMs) };
};

/**
 * Built-in planner for frequency-based informal networks: walk → ride → (walk) → ride → walk.
 * Expected time = walks + expected waits + in-vehicle time. Waits use live stand reports
 * when available, otherwise half the mean headway. Prefers ≤ 1 transfer (every transfer is
 * another wait and fare); falls back to a round-based search with up to 3 rides so any two
 * points in the network can still be connected.
 */
export class Planner {
  constructor(
    private readonly net: TransitNetwork,
    private readonly stands?: StandStore,
  ) {}

  plan(from: LatLng, to: LatLng, opts: PlanOptions = {}): PlanResponse {
    const nowSec = localSecondsOfDay(opts.departAt ?? new Date());
    const active = (p: Pattern) => isWithin(nowSec, p.serviceStartSec, p.serviceEndSec);

    const access = this.accessMap(from);
    const egress = this.accessMap(to);
    const best = new Map<string, Option>();
    const consider = (o: Option) => {
      const cur = best.get(o.key);
      if (!cur || o.rankSec < cur.rankSec) best.set(o.key, o);
    };

    for (const p1 of this.net.patterns) {
      if (!active(p1)) continue;
      const route1 = this.net.routes.get(p1.routeId);
      if (!route1) continue;

      p1.stops.forEach((s1, i) => {
        const acc = access.get(s1.stopId);
        if (!acc) return;
        const wait1 = this.waitSec(p1, s1.stopId);

        for (let k = i + 1; k < p1.stops.length; k++) {
          const sk = p1.stops[k]!;
          if (sk.distM - s1.distM < PLANNER.minRideM) continue;
          const ride1 = sk.offsetSec - s1.offsetSec;
          const base = acc.walkSec + wait1 + ride1;

          // Direct.
          const egr = egress.get(sk.stopId);
          if (egr) {
            consider({
              key: p1.tripId,
              rankSec: base + egr.walkSec,
              rides: [{ pattern: p1, route: route1, board: i, alight: k, waitSec: wait1 }],
              access: acc,
              egress: egr,
            });
          }

          // One transfer, possibly with a short walk between stops.
          const alightStop = this.net.stops.get(sk.stopId)!;
          for (const near of this.net.nearbyStops(alightStop, PLANNER.maxTransferWalkM)) {
            const tw =
              near.id === sk.stopId ? { walkM: 0, walkSec: 0 } : walkFor(near.distanceMeters);
            for (const { pattern: p2, index: m } of this.net.servedBy.get(near.id) ?? []) {
              if (p2.routeId === p1.routeId || !active(p2)) continue;
              const route2 = this.net.routes.get(p2.routeId);
              if (!route2) continue;
              const wait2 = this.waitSec(p2, near.id);
              for (let n = m + 1; n < p2.stops.length; n++) {
                const sn = p2.stops[n]!;
                const egr2 = egress.get(sn.stopId);
                if (!egr2 || sn.distM - p2.stops[m]!.distM < PLANNER.minRideM) continue;
                const ride2 = sn.offsetSec - p2.stops[m]!.offsetSec;
                consider({
                  key: `${p1.tripId}>${p2.tripId}`,
                  rankSec:
                    base + tw.walkSec + PLANNER.transferPenaltySec + wait2 + ride2 + egr2.walkSec,
                  rides: [
                    { pattern: p1, route: route1, board: i, alight: k, waitSec: wait1 },
                    { pattern: p2, route: route2, board: m, alight: n, waitSec: wait2 },
                  ],
                  access: acc,
                  egress: egr2,
                  transfers: [{ fromStopId: sk.stopId, toStopId: near.id, ...tw }],
                });
              }
            }
          }
        }
      });
    }

    // Nothing with ≤ 1 transfer: search deeper (up to maxRides) so every pair of points in
    // the network stays plannable. Fewest transfers wins; this only runs when needed.
    if (![...best.values()].some((o) => o.rides.length > 0)) {
      const deep = this.roundSearch(access, egress, active, PLANNER.maxRides);
      if (deep) consider(deep);
    }

    const straight = haversineMeters(from, to);
    if (straight <= PLANNER.maxWalkOnlyM) {
      const w = walkFor(straight);
      consider({ key: 'walk', rankSec: w.walkSec, rides: [], walkOnly: w });
    }

    const options = this.dropDominatedTransfers([...best.values()]).sort(
      (a, b) => a.rankSec - b.rankSec,
    );
    const fastest = options[0]?.rankSec ?? 0;
    const kept = this.dedupe(options)
      .filter((o) => o.rankSec <= fastest * PLANNER.keepRatio + PLANNER.keepSlackSec)
      .slice(0, opts.maxResults ?? 3);

    const fromPlace: NamedPlace = { name: opts.fromName || 'Start', ...from };
    const toPlace: NamedPlace = { name: opts.toName || 'Destination', ...to };
    return { itineraries: kept.map((o) => this.toItinerary(o, fromPlace, toPlace)) };
  }

  private accessMap(point: LatLng): Map<string, Access> {
    const map = new Map<string, Access>();
    for (const s of this.net.nearbyStops(point, PLANNER.maxAccessWalkM)) {
      map.set(s.id, { stopId: s.id, ...walkFor(s.distanceMeters) });
    }
    return map;
  }

  /**
   * RAPTOR-style rounds: round r keeps, for every stop, the cheapest way to arrive there
   * using exactly r rides (with walking transfers ≤ maxTransferWalkM between rounds).
   * Returns the cheapest option from the first round that reaches the destination.
   */
  private roundSearch(
    access: Map<string, Access>,
    egress: Map<string, Access>,
    active: (p: Pattern) => boolean,
    maxRides: number,
  ): Option | null {
    let ready = new Map<string, Ready>();
    for (const a of access.values()) {
      ready.set(a.stopId, {
        stopId: a.stopId,
        cost: a.walkSec,
        via: { kind: 'access', access: a },
      });
    }

    for (let round = 1; round <= maxRides && ready.size; round++) {
      const arrived = new Map<string, Arrived>();
      for (const p of this.net.patterns) {
        const route = this.net.routes.get(p.routeId);
        if (!route || !active(p)) continue;
        p.stops.forEach((s, i) => {
          const rd = ready.get(s.stopId);
          if (!rd) return;
          if (rd.via.kind === 'transfer' && rd.via.arrived.ride.route.id === route.id) return;
          const wait = this.waitSec(p, s.stopId);
          for (let j = i + 1; j < p.stops.length; j++) {
            const sj = p.stops[j]!;
            if (sj.distM - s.distM < PLANNER.minRideM) continue;
            const cost = rd.cost + wait + (sj.offsetSec - s.offsetSec);
            const cur = arrived.get(sj.stopId);
            if (!cur || cost < cur.cost) {
              arrived.set(sj.stopId, {
                cost,
                ride: { pattern: p, route, board: i, alight: j, waitSec: wait },
                ready: rd,
              });
            }
          }
        });
      }

      let best: { total: number; arrived: Arrived; egress: Access } | null = null;
      for (const [stopId, a] of arrived) {
        const e = egress.get(stopId);
        if (e && (!best || a.cost + e.walkSec < best.total))
          best = { total: a.cost + e.walkSec, arrived: a, egress: e };
      }
      if (best) return this.reconstruct(best.arrived, best.egress, best.total);

      const next = new Map<string, Ready>();
      for (const [stopId, a] of arrived) {
        const stop = this.net.stops.get(stopId)!;
        for (const near of this.net.nearbyStops(stop, PLANNER.maxTransferWalkM)) {
          const walk = near.id === stopId ? { walkM: 0, walkSec: 0 } : walkFor(near.distanceMeters);
          const cost = a.cost + walk.walkSec + PLANNER.transferPenaltySec;
          const cur = next.get(near.id);
          if (!cur || cost < cur.cost) {
            next.set(near.id, {
              stopId: near.id,
              cost,
              via: { kind: 'transfer', fromStopId: stopId, walk, arrived: a },
            });
          }
        }
      }
      ready = next;
    }
    return null;
  }

  private reconstruct(last: Arrived, egress: Access, total: number): Option {
    const rides: Ride[] = [];
    const transfers: TransferWalk[] = [];
    let a = last;
    for (;;) {
      rides.unshift(a.ride);
      const via = a.ready.via;
      if (via.kind === 'access') {
        return {
          key: rides.map((r) => r.pattern.tripId).join('>'),
          rankSec: total,
          rides,
          access: via.access,
          egress,
          transfers,
        };
      }
      transfers.unshift({ fromStopId: via.fromStopId, toStopId: a.ready.stopId, ...via.walk });
      a = via.arrived;
    }
  }

  private waitSec(pattern: Pattern, stopId: string): number {
    const stop = this.net.stops.get(stopId);
    const live = stop?.isStand ? this.stands?.waitMinutes(stopId) : undefined;
    return live !== undefined ? live * 60 : Math.round(pattern.headwaySec / 2);
  }

  /**
   * A transfer is only worth showing if it beats riding one of its routes directly.
   * (Otherwise: "take CL-6 for 2 min, then KG-1" next to "take KG-1".)
   */
  private dropDominatedTransfers(options: Option[]): Option[] {
    const directByRoute = new Map<string, number>();
    for (const o of options) {
      if (o.rides.length === 1) {
        const id = o.rides[0]!.route.id;
        directByRoute.set(id, Math.min(directByRoute.get(id) ?? Infinity, o.rankSec));
      }
    }
    return options.filter(
      (o) =>
        o.rides.length < 2 ||
        o.rides.every((r) => (directByRoute.get(r.route.id) ?? Infinity) > o.rankSec),
    );
  }

  /** Two options using the same routes in the same order are the same choice for a commuter. */
  private dedupe(options: Option[]): Option[] {
    const seen = new Set<string>();
    return options.filter((o) => {
      const sig = o.rides.map((r) => r.route.id).join('>') || 'walk';
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  private congestion(ride: Ride | undefined): CongestionLevel {
    if (!ride) return 'low';
    const stopId = ride.pattern.stops[ride.board]!.stopId;
    const stand = this.stands?.get(stopId);
    const byQueue: CongestionLevel | null =
      stand?.passengerQueueLevel === 'severe'
        ? 'high'
        : stand?.passengerQueueLevel === 'crowded'
          ? 'moderate'
          : null;
    const waitMin = ride.waitSec / 60;
    const byWait: CongestionLevel = waitMin <= 4 ? 'low' : waitMin <= 8 ? 'moderate' : 'high';
    const rank = { low: 0, moderate: 1, high: 2 } as const;
    return byQueue && rank[byQueue] > rank[byWait] ? byQueue : byWait;
  }

  private place(stopId: string): NamedPlace {
    const s = this.net.stops.get(stopId)!;
    return { name: s.name, lat: s.lat, lng: s.lng };
  }

  private walkLeg(from: NamedPlace, to: NamedPlace, walkM: number, walkSec: number): Leg {
    return {
      mode: 'WALK',
      from,
      to,
      durationSeconds: walkSec,
      distanceMeters: walkM,
      geometryPolyline: encodePolyline([from, to]),
    };
  }

  private toItinerary(o: Option, origin: NamedPlace, destination: NamedPlace): Itinerary {
    if (o.walkOnly) {
      return {
        id: 'walk',
        durationSeconds: o.walkOnly.walkSec,
        walkTimeSeconds: o.walkOnly.walkSec,
        transitTimeSeconds: 0,
        estimatedFare: { currency: 'INR', amount: 0 },
        congestionLevel: 'low',
        legs: [this.walkLeg(origin, destination, o.walkOnly.walkM, o.walkOnly.walkSec)],
      };
    }

    const legs: Leg[] = [];
    let walkSec = 0;
    let rideSec = 0;
    let waitSec = 0;
    const pushWalk = (from: NamedPlace, to: NamedPlace, m: number, s: number) => {
      if (m < PLANNER.minWalkLegM) return;
      legs.push(this.walkLeg(from, to, m, s));
      walkSec += s;
    };

    const firstBoard = o.rides[0]!.pattern.stops[o.rides[0]!.board]!.stopId;
    if (o.access) pushWalk(origin, this.place(firstBoard), o.access.walkM, o.access.walkSec);

    o.rides.forEach((r, idx) => {
      const t = idx > 0 ? o.transfers?.[idx - 1] : undefined;
      if (t) pushWalk(this.place(t.fromStopId), this.place(t.toStopId), t.walkM, t.walkSec);
      const b = r.pattern.stops[r.board]!;
      const a = r.pattern.stops[r.alight]!;
      const boardStop = this.net.stops.get(b.stopId)!;
      const duration = a.offsetSec - b.offsetSec;
      rideSec += duration;
      waitSec += r.waitSec;
      legs.push({
        mode: r.route.mode,
        routeId: r.route.id,
        routeShortName: r.route.shortName,
        routeColor: r.route.color,
        from: this.place(b.stopId),
        to: this.place(a.stopId),
        durationSeconds: duration,
        distanceMeters: Math.round(a.distM - b.distM),
        frequencyMinutes: r.route.frequencyMinutes,
        boardingStandId: boardStop.isStand ? boardStop.id : undefined,
        geometryPolyline: encodePolyline(r.pattern.shape.slice(b.distM, a.distM)),
      });
    });

    const last = o.rides[o.rides.length - 1]!;
    const lastStop = last.pattern.stops[last.alight]!.stopId;
    if (o.egress) pushWalk(this.place(lastStop), destination, o.egress.walkM, o.egress.walkSec);

    return {
      id: o.key.replace(/[^A-Za-z0-9>-]/g, ''),
      durationSeconds: walkSec + waitSec + rideSec,
      walkTimeSeconds: walkSec,
      transitTimeSeconds: rideSec,
      estimatedFare: itineraryFare(
        o.rides.map((r) => ({
          model: r.route.fare,
          distanceMeters: r.pattern.stops[r.alight]!.distM - r.pattern.stops[r.board]!.distM,
          fromZone: this.net.stops.get(r.pattern.stops[r.board]!.stopId)?.zoneId,
          toZone: this.net.stops.get(r.pattern.stops[r.alight]!.stopId)?.zoneId,
        })),
      ),
      congestionLevel: this.congestion(o.rides[0]),
      legs,
    };
  }
}
