import type { NamedPlace } from '@transit/shared-types';
import type { Place } from '../types';

/**
 * Trips live in the URL (`?from=lat,lng,Name&to=...`) so a plan can be shared,
 * bookmarked, or printed as a QR code at a stand with the origin pre-filled.
 */
export function encodePlace(p: NamedPlace): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.name}`;
}

export function decodePlace(value: string | null): Place | null {
  if (!value) return null;
  const [latStr = '', lngStr = '', ...rest] = value.split(',');
  if (!latStr.trim() || !lngStr.trim()) return null;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  const name = rest.join(',').trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return { name, lat, lng, source: 'url' };
}

export function readTripFromSearch(search: string): { from: Place | null; to: Place | null } {
  const q = new URLSearchParams(search);
  return { from: decodePlace(q.get('from')), to: decodePlace(q.get('to')) };
}

export function tripSearch(
  from: NamedPlace | null,
  to: NamedPlace | null,
  current: string,
): string {
  const q = new URLSearchParams(current);
  if (from) q.set('from', encodePlace(from));
  else q.delete('from');
  if (to) q.set('to', encodePlace(to));
  else q.delete('to');
  const s = q.toString();
  return s ? `?${s}` : '';
}
