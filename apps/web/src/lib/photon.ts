import type { LatLng } from '@transit/shared-types';
import type { Place } from '../types';

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
}

export function photonSearchUrl(
  base: string,
  query: string,
  bias: LatLng,
  bounds?: [west: number, south: number, east: number, north: number],
  limit = 6,
): string {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    lat: String(bias.lat),
    lon: String(bias.lng),
    lang: 'en',
  });
  if (bounds) params.set('bbox', bounds.join(','));
  return `${base}/api/?${params}`;
}

export function photonReverseUrl(base: string, point: LatLng): string {
  const params = new URLSearchParams({
    lat: String(point.lat),
    lon: String(point.lng),
    lang: 'en',
  });
  return `${base}/reverse?${params}`;
}

/** Turns a Photon GeoJSON response into de-duplicated places. Ignores malformed features. */
export function parsePhoton(json: unknown): Place[] {
  const features = (json as { features?: PhotonFeature[] } | null)?.features ?? [];
  const seen = new Set<string>();
  const places: Place[] = [];

  for (const f of features) {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const p = f.properties ?? {};
    const street = [p.housenumber, p.street].filter(Boolean).join(' ') || undefined;
    const name = p.name ?? street;
    if (!name) continue;

    const parts = [street !== name ? street : undefined, p.district, p.city, p.state];
    const detail = [...new Set(parts.filter((x): x is string => !!x && x !== name))].join(', ');

    const key = `${name}|${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);

    places.push({ name, detail: detail || undefined, lat, lng, source: 'search' });
  }
  return places;
}
