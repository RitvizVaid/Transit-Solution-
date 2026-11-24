import type { Itinerary, Leg, LegMode, PlanResponse } from '@transit/shared-types';
import type { TransitNetwork } from '../gtfs/network.js';
import { itineraryFare, type RideFare } from './fares.js';
import type { PlanOptions } from './planner.js';
import type { StandStore } from './stands.js';

/** OTP 2.x GTFS GraphQL API (OTP ≥ 2.5 serves it at /otp/gtfs/v1). */
const QUERY = /* GraphQL */ `
  query Plan($from: InputCoordinates!, $to: InputCoordinates!, $date: String, $time: String) {
    plan(
      from: $from
      to: $to
      date: $date
      time: $time
      numItineraries: 3
      transportModes: [{ mode: WALK }, { mode: TRANSIT }]
    ) {
      itineraries {
        duration
        walkTime
        legs {
          mode
          duration
          distance
          transitLeg
          route {
            gtfsId
            shortName
            color
          }
          from {
            name
            lat
            lon
            stop {
              gtfsId
            }
          }
          to {
            name
            lat
            lon
            stop {
              gtfsId
            }
          }
          legGeometry {
            points
          }
        }
      }
    }
  }
`;

interface OtpPlace {
  name: string;
  lat: number;
  lon: number;
  stop?: { gtfsId: string } | null;
}
interface OtpLeg {
  mode: string;
  duration: number;
  distance: number;
  transitLeg: boolean;
  route?: { gtfsId: string; shortName?: string; color?: string } | null;
  from: OtpPlace;
  to: OtpPlace;
  legGeometry?: { points: string } | null;
}
interface OtpResponse {
  data?: { plan?: { itineraries?: { duration: number; walkTime: number; legs: OtpLeg[] }[] } };
  errors?: { message: string }[];
}

/** "1:KG-1" → "KG-1" */
const localId = (gtfsId: string | undefined) => gtfsId?.split(':').slice(1).join(':') || gtfsId;

export class OtpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly net: TransitNetwork,
    private readonly stands?: StandStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 4000,
  ) {}

  async plan(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    opts: PlanOptions = {},
  ): Promise<PlanResponse> {
    const when = opts.departAt ?? new Date();
    // OTP wants local date/time; India is a fixed +05:30.
    const local = new Date(when.getTime() + 5.5 * 3600_000).toISOString();
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          from: { lat: from.lat, lon: from.lng },
          to: { lat: to.lat, lon: to.lng },
          date: local.slice(0, 10),
          time: local.slice(11, 16),
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`OTP responded ${res.status}`);
    const body = (await res.json()) as OtpResponse;
    if (body.errors?.length) throw new Error(`OTP error: ${body.errors[0]!.message}`);
    const its = body.data?.plan?.itineraries ?? [];
    return {
      itineraries: its.map((it, i) => this.toItinerary(it, i, opts)),
    };
  }

  private toItinerary(
    it: { duration: number; walkTime: number; legs: OtpLeg[] },
    index: number,
    opts: PlanOptions,
  ): Itinerary {
    const rides: RideFare[] = [];
    const legs: Leg[] = it.legs.map((l, li) => {
      const isFirst = li === 0;
      const isLast = li === it.legs.length - 1;
      const name = (p: OtpPlace, fallback: string | undefined) =>
        (p.name === 'Origin' || p.name === 'Destination') && fallback ? fallback : p.name;
      const base = {
        from: {
          name: name(l.from, isFirst ? opts.fromName : undefined),
          lat: l.from.lat,
          lng: l.from.lon,
        },
        to: { name: name(l.to, isLast ? opts.toName : undefined), lat: l.to.lat, lng: l.to.lon },
        durationSeconds: Math.round(l.duration),
        distanceMeters: Math.round(l.distance),
        geometryPolyline: l.legGeometry?.points ?? '',
      };
      if (!l.transitLeg) return { mode: 'WALK' as const, ...base };

      const route = this.net.routes.get(localId(l.route?.gtfsId) ?? '');
      const boardStop = this.net.stops.get(localId(l.from.stop?.gtfsId) ?? '');
      const alightStop = this.net.stops.get(localId(l.to.stop?.gtfsId) ?? '');
      if (route) {
        rides.push({
          model: route.fare,
          distanceMeters: l.distance,
          fromZone: boardStop?.zoneId,
          toZone: alightStop?.zoneId,
        });
      }
      const mode: LegMode = route?.mode ?? (l.mode === 'BUS' ? 'BUS' : 'SHARED_TAXI');
      return {
        ...base,
        mode,
        routeId: route?.id,
        fromStopId: boardStop?.id,
        toStopId: alightStop?.id,
        routeShortName: route?.shortName ?? l.route?.shortName,
        routeColor: route?.color ?? (l.route?.color ? `#${l.route.color}` : undefined),
        frequencyMinutes: route?.frequencyMinutes,
        boardingStandId: boardStop?.isStand ? boardStop.id : undefined,
      };
    });

    const transitTime = legs
      .filter((l) => l.mode !== 'WALK')
      .reduce((s, l) => s + l.durationSeconds, 0);
    const firstRide = legs.find((l) => l.mode !== 'WALK');
    const stand = firstRide?.boardingStandId
      ? this.stands?.get(firstRide.boardingStandId)
      : undefined;
    const congestion =
      stand?.passengerQueueLevel === 'severe'
        ? 'high'
        : stand?.passengerQueueLevel === 'crowded'
          ? 'moderate'
          : 'low';

    return {
      id: `otp-${index}`,
      durationSeconds: Math.round(it.duration),
      walkTimeSeconds: Math.round(it.walkTime),
      transitTimeSeconds: transitTime,
      estimatedFare: rides.length ? itineraryFare(rides) : { currency: 'INR', amount: 0 },
      congestionLevel: congestion,
      legs,
    };
  }
}
