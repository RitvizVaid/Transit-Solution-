import type { Itinerary, LatLng } from '@transit/shared-types';
import { DEFAULT_ROUTE_COLOR } from '../lib/color';

export type LngLat = [number, number];
export type Bounds = [[number, number], [number, number]]; // [[west, south], [east, north]]

/** Google encoded polyline (precision 5) → [lng, lat] pairs. */
export function decodePolyline(str: string): LngLat[] {
  const out: LngLat[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i <= str.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

export interface LegFeatureProps {
  index: number;
  walk: boolean;
  color: string;
}

/** One LineString per leg; walks fall back to a straight line if geometry is missing. */
export function itineraryToGeoJSON(
  it: Itinerary,
): GeoJSON.FeatureCollection<GeoJSON.LineString, LegFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: it.legs.map((leg, index) => {
      const decoded = leg.geometryPolyline ? decodePolyline(leg.geometryPolyline) : [];
      const coordinates: LngLat[] =
        decoded.length >= 2
          ? decoded
          : [
              [leg.from.lng, leg.from.lat],
              [leg.to.lng, leg.to.lat],
            ];
      return {
        type: 'Feature',
        properties: {
          index,
          walk: leg.mode === 'WALK',
          color: leg.mode === 'WALK' ? '#475569' : (leg.routeColor ?? DEFAULT_ROUTE_COLOR),
        },
        geometry: { type: 'LineString', coordinates },
      };
    }),
  };
}

export function boundsOf(points: LngLat[]): Bounds | null {
  if (!points.length) return null;
  let [w, s] = points[0]!;
  let [e, n] = points[0]!;
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** Polygon approximating a circle of `radiusM` around `center` (equirectangular; fine < 5 km). */
export function circlePolygon(center: LatLng, radiusM: number, steps = 64): GeoJSON.Polygon {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([center.lng + dLng * Math.cos(a), center.lat + dLat * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}
