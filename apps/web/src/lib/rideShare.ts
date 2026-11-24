import type { LegMode, RidePosition, RidePositionResponse } from '@transit/shared-types';

/** How often the phone sends its latest fix while sharing. */
export const SEND_EVERY_MS = 5_000;
/** Sharing switches itself off after this, in case the rider forgets. */
export const MAX_SHARE_MS = 2 * 60 * 60_000;

export interface Fix {
  lat: number;
  lng: number;
  accuracyM?: number;
  /** Epoch ms the phone took the fix. */
  at: number;
}

export type FixError = 'denied' | 'unavailable';

/** What the rider sees while sharing: is the app actually helping others right now? */
export type ShareSignal =
  /** Waiting for the first GPS fix / first answer. */
  | 'starting'
  /** Last fix was accepted: others can see this vehicle. */
  | 'on_route'
  /** Too far from the route line (wrong route chosen, or got off). */
  | 'off_route'
  /** GPS fix too rough (indoors, tunnel) to place the vehicle. */
  | 'weak_gps'
  /** Could not reach the server; fixes are live-only, so nothing is queued. */
  | 'offline';

export type StopReason = 'user' | 'time_limit' | 'denied' | 'unsupported' | 'rejected';

export type RideShareState =
  | { status: 'idle' }
  | {
      status: 'sharing';
      routeId: string;
      routeName: string;
      mode: LegMode;
      startedAt: number;
      signal: ShareSignal;
      /** Fixes accepted by the server during this ride. */
      accepted: number;
    }
  | { status: 'stopped'; routeName: string; reason: StopReason; accepted: number };

export interface RideShareDeps {
  /** Start watching GPS; returns a function that stops watching. Null = unsupported. */
  watch: ((onFix: (f: Fix) => void, onError: (e: FixError) => void) => () => void) | null;
  send: (pos: RidePosition) => Promise<RidePositionResponse>;
  end: (rideId: string) => Promise<void>;
  now: () => number;
  newRideId: () => string;
  every: (ms: number, fn: () => void) => () => void;
}

export interface RideTarget {
  routeId: string;
  routeName: string;
  mode: LegMode;
}

/**
 * One shared ride at a time: watches GPS, sends the newest fix every few seconds, and
 * reports back whether the vehicle is visible to others. Fixes are live-only: a fix that
 * cannot be sent now is dropped, never queued, because an old position helps nobody.
 */
export class RideShare {
  private state: RideShareState = { status: 'idle' };
  private readonly listeners = new Set<() => void>();
  private rideId: string | null = null;
  private latest: Fix | null = null;
  private lastSentAt: number | null = null;
  private inFlight = false;
  private cleanup: (() => void)[] = [];

  constructor(private readonly deps: RideShareDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getState = (): RideShareState => this.state;

  start(target: RideTarget): void {
    if (this.state.status === 'sharing') this.stop('user');
    if (!this.deps.watch) {
      this.set({
        status: 'stopped',
        routeName: target.routeName,
        reason: 'unsupported',
        accepted: 0,
      });
      return;
    }
    this.rideId = this.deps.newRideId();
    this.latest = null;
    this.lastSentAt = null;
    this.set({
      status: 'sharing',
      ...target,
      startedAt: this.deps.now(),
      signal: 'starting',
      accepted: 0,
    });
    const unwatch = this.deps.watch(
      (fix) => {
        this.latest = fix;
        // Send the very first fix at once so the rider sees feedback quickly.
        if (this.lastSentAt === null) void this.tick();
      },
      (err) => {
        if (err === 'denied') this.stop('denied');
        else this.patch({ signal: 'weak_gps' });
      },
    );
    const cancelTimer = this.deps.every(SEND_EVERY_MS, () => void this.tick());
    this.cleanup = [unwatch, cancelTimer];
  }

  stop(reason: StopReason = 'user'): void {
    const s = this.state;
    if (s.status !== 'sharing') return;
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    const rideId = this.rideId;
    this.rideId = null;
    this.latest = null;
    if (rideId && this.lastSentAt !== null) void this.deps.end(rideId).catch(() => undefined);
    this.set({ status: 'stopped', routeName: s.routeName, reason, accepted: s.accepted });
  }

  /** Forget a finished ride's summary. */
  dismiss(): void {
    if (this.state.status === 'stopped') this.set({ status: 'idle' });
  }

  private async tick(): Promise<void> {
    const s = this.state;
    if (s.status !== 'sharing' || !this.rideId) return;
    if (this.deps.now() - s.startedAt > MAX_SHARE_MS) {
      this.stop('time_limit');
      return;
    }
    const fix = this.latest;
    if (!fix || this.inFlight) return;
    this.latest = null; // each fix is sent at most once
    this.inFlight = true;
    this.lastSentAt = this.deps.now();
    const rideId = this.rideId;
    try {
      const res = await this.deps.send({
        rideId,
        routeId: s.routeId,
        coordinates: [fix.lng, fix.lat],
        accuracyM: fix.accuracyM,
        recordedAt: new Date(fix.at).toISOString(),
      });
      if (this.rideId !== rideId) return; // stopped meanwhile
      if (res.accepted) {
        this.patch({ signal: 'on_route', accepted: this.sharing()!.accepted + 1 });
      } else if (res.reason === 'off_route') this.patch({ signal: 'off_route' });
      else if (res.reason === 'inaccurate') this.patch({ signal: 'weak_gps' });
      else if (res.reason === 'ride_too_long') this.stop('time_limit');
      else if (res.reason === 'unknown_route' || res.reason === 'capacity') this.stop('rejected');
      // too_frequent / stale / implausible_speed: one bad fix, keep the current signal.
    } catch {
      if (this.rideId === rideId) this.patch({ signal: 'offline' });
    } finally {
      this.inFlight = false;
    }
  }

  private sharing() {
    return this.state.status === 'sharing' ? this.state : null;
  }

  private patch(p: Partial<Extract<RideShareState, { status: 'sharing' }>>) {
    const s = this.sharing();
    if (s) this.set({ ...s, ...p });
  }

  private set(next: RideShareState) {
    this.state = next;
    this.listeners.forEach((l) => l());
  }
}
