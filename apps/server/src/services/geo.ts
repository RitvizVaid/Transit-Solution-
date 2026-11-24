import type { LatLng } from '@transit/shared-types';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Google encoded polyline, precision 5. */
export function encodePolyline(points: LatLng[]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - prevLat) + enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

export function decodePolyline(str: string): LatLng[] {
  const points: LatLng[] = [];
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
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** A polyline with cumulative distances, for slicing and interpolation by distance. */
export class MeasuredLine {
  readonly points: LatLng[];
  readonly cum: number[];

  constructor(points: LatLng[]) {
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      this.cum.push(this.cum[i - 1]! + haversineMeters(points[i - 1]!, points[i]!));
    }
  }

  get length(): number {
    return this.cum[this.cum.length - 1] ?? 0;
  }

  /** Point (and heading) at `d` metres along the line, clamped to the ends. */
  at(d: number): { point: LatLng; bearing: number } {
    const dist = Math.max(0, Math.min(this.length, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i]! < dist) i++;
    const a = this.points[i - 1]!;
    const b = this.points[i] ?? a;
    const seg = this.cum[i]! - this.cum[i - 1]!;
    const t = seg === 0 ? 0 : (dist - this.cum[i - 1]!) / seg;
    return {
      point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
      bearing: bearingDegrees(a, b),
    };
  }

  /** Closest point on the line to `p` (equirectangular projection; accurate within a city). */
  project(p: LatLng): { point: LatLng; alongM: number; offsetM: number } {
    const k = Math.cos((p.lat * Math.PI) / 180);
    let best = { point: this.points[0] ?? p, alongM: 0, offsetM: Infinity };
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1]!;
      const b = this.points[i]!;
      const dx = (b.lng - a.lng) * k;
      const dy = b.lat - a.lat;
      const seg2 = dx * dx + dy * dy;
      const t =
        seg2 === 0
          ? 0
          : Math.max(0, Math.min(1, ((p.lng - a.lng) * k * dx + (p.lat - a.lat) * dy) / seg2));
      const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      const offsetM = haversineMeters(p, point);
      if (offsetM < best.offsetM) {
        best = { point, alongM: this.cum[i - 1]! + (this.cum[i]! - this.cum[i - 1]!) * t, offsetM };
      }
    }
    return best;
  }

  /** The part of the line between two distances (inclusive, interpolated ends). */
  slice(from: number, to: number): LatLng[] {
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const out: LatLng[] = [this.at(lo).point];
    for (let i = 0; i < this.points.length; i++) {
      if (this.cum[i]! > lo && this.cum[i]! < hi) out.push(this.points[i]!);
    }
    out.push(this.at(hi).point);
    return from <= to ? out : out.reverse();
  }
}
