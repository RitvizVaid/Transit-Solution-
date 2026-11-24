import type { VehiclePosition } from '@transit/shared-types';
import type { LngLat } from './geometry';

interface Track {
  from: LngLat;
  to: LngLat;
  /** When `to` was received (ms). */
  t0: number;
  last: VehiclePosition;
}

/**
 * Smooths 2-second GPS pings into continuous motion: each new ping starts a glide
 * from where the marker is drawn now to the new position, over `glideMs`.
 * Vehicles not heard from for `staleMs` are dropped (end of trip, lost signal).
 */
export class VehicleAnimator {
  private readonly tracks = new Map<string, Track>();

  constructor(
    private readonly glideMs = 2000,
    private readonly staleMs = 15_000,
  ) {}

  get size(): number {
    return this.tracks.size;
  }

  update(v: VehiclePosition, now: number): void {
    const t = this.tracks.get(v.vehicleId);
    const current = t ? this.positionOf(t, now) : v.coordinates;
    this.tracks.set(v.vehicleId, { from: current, to: v.coordinates, t0: now, last: v });
  }

  private positionOf(t: Track, now: number): LngLat {
    const k = Math.min(1, Math.max(0, (now - t.t0) / this.glideMs));
    return [t.from[0] + (t.to[0] - t.from[0]) * k, t.from[1] + (t.to[1] - t.from[1]) * k];
  }

  /** Current interpolated positions; prunes stale vehicles. */
  frame(now: number, animate = true): { vehicle: VehiclePosition; at: LngLat }[] {
    const out: { vehicle: VehiclePosition; at: LngLat }[] = [];
    for (const [id, t] of this.tracks) {
      if (now - t.t0 > this.staleMs) {
        this.tracks.delete(id);
        continue;
      }
      out.push({ vehicle: t.last, at: animate ? this.positionOf(t, now) : t.to });
    }
    return out;
  }

  clear(): void {
    this.tracks.clear();
  }
}
