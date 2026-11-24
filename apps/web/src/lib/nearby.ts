import type { NearbyStop, TransitRoute } from '@transit/shared-types';

export interface NearbyLine {
  route: TransitRoute;
  nearestStop: NearbyStop;
  /** How many of the nearby stops this line serves. */
  stopCount: number;
}

/** One entry per route that serves any nearby stop, closest boarding point first. */
export function groupNearbyLines(stops: NearbyStop[], routes: TransitRoute[]): NearbyLine[] {
  const routesById = new Map(routes.map((r) => [r.id, r]));
  const lines = new Map<string, NearbyLine>();

  for (const stop of stops) {
    for (const routeId of stop.routeIds) {
      const route = routesById.get(routeId);
      if (!route) continue;
      const line = lines.get(routeId);
      if (!line) {
        lines.set(routeId, { route, nearestStop: stop, stopCount: 1 });
        continue;
      }
      line.stopCount += 1;
      if (stop.distanceMeters < line.nearestStop.distanceMeters) line.nearestStop = stop;
    }
  }

  return [...lines.values()].sort(
    (a, b) =>
      a.nearestStop.distanceMeters - b.nearestStop.distanceMeters ||
      a.route.shortName.localeCompare(b.route.shortName),
  );
}
