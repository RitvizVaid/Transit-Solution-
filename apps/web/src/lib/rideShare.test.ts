import type { RidePosition, RidePositionResponse } from '@transit/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { MAX_SHARE_MS, RideShare, SEND_EVERY_MS, type Fix, type FixError } from './rideShare';

const TARGET = { routeId: 'KG-1', routeName: 'KG-1', mode: 'AUTO_RICKSHAW' as const };
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(
  answer: (p: RidePosition) => Promise<RidePositionResponse> = async () => ({
    accepted: true,
    vehicleId: 'crowd-x',
    offsetMeters: 4,
  }),
) {
  let now = 1_000_000;
  let onFix: ((f: Fix) => void) | null = null;
  let onError: ((e: FixError) => void) | null = null;
  let timer: (() => void) | null = null;
  const unwatch = vi.fn();
  const send = vi.fn(answer);
  const end = vi.fn(async () => undefined);
  const share = new RideShare({
    watch: (f, e) => {
      onFix = f;
      onError = e;
      return unwatch;
    },
    send,
    end,
    now: () => now,
    newRideId: () => 'ride-secret-1234567890',
    every: (_ms, fn) => {
      timer = fn;
      return () => {
        timer = null;
      };
    },
  });
  return {
    share,
    send,
    end,
    unwatch,
    fix: (lat = 28.66, accuracyM = 10) => onFix!({ lat, lng: 77.23, accuracyM, at: now }),
    error: (e: FixError) => onError!(e),
    tick: async (ms = SEND_EVERY_MS) => {
      now += ms;
      timer?.();
      await flush();
    },
    hasTimer: () => timer !== null,
  };
}

describe('RideShare', () => {
  it('sends the first fix at once, then only the newest fix per interval', async () => {
    const t = setup();
    t.share.start(TARGET);
    expect(t.share.getState()).toMatchObject({ status: 'sharing', signal: 'starting' });

    t.fix(28.66);
    await flush();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0]![0]).toMatchObject({
      rideId: 'ride-secret-1234567890',
      routeId: 'KG-1',
      coordinates: [77.23, 28.66],
    });
    expect(t.share.getState()).toMatchObject({ signal: 'on_route', accepted: 1 });

    t.fix(28.661);
    t.fix(28.662);
    await t.tick();
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.send.mock.calls[1]![0].coordinates).toEqual([77.23, 28.662]);

    // No new fix: nothing is re-sent.
    await t.tick();
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it('tells the rider when they are off route, GPS is weak or the network is down', async () => {
    const answers: RidePositionResponse[] = [
      { accepted: false, reason: 'off_route', offsetMeters: 400 },
      { accepted: false, reason: 'inaccurate' },
    ];
    let i = 0;
    const t = setup(async () => {
      const a = answers[i++];
      if (!a) throw new TypeError('Failed to fetch');
      return a;
    });
    t.share.start(TARGET);
    t.fix();
    await flush();
    expect(t.share.getState()).toMatchObject({ signal: 'off_route' });
    t.fix();
    await t.tick();
    expect(t.share.getState()).toMatchObject({ signal: 'weak_gps' });
    t.fix();
    await t.tick();
    expect(t.share.getState()).toMatchObject({ signal: 'offline', accepted: 0 });
  });

  it('stops cleanly, ends the ride on the server and stops watching GPS', async () => {
    const t = setup();
    t.share.start(TARGET);
    t.fix();
    await flush();
    t.share.stop();
    expect(t.unwatch).toHaveBeenCalled();
    expect(t.hasTimer()).toBe(false);
    expect(t.end).toHaveBeenCalledWith('ride-secret-1234567890');
    expect(t.share.getState()).toEqual({
      status: 'stopped',
      routeName: 'KG-1',
      reason: 'user',
      accepted: 1,
    });
    t.share.dismiss();
    expect(t.share.getState()).toEqual({ status: 'idle' });
  });

  it('does not call the server to end a ride that never sent anything', () => {
    const t = setup();
    t.share.start(TARGET);
    t.share.stop();
    expect(t.end).not.toHaveBeenCalled();
  });

  it('switches itself off after the time limit', async () => {
    const t = setup();
    t.share.start(TARGET);
    t.fix();
    await flush();
    await t.tick(MAX_SHARE_MS + 1);
    expect(t.share.getState()).toMatchObject({ status: 'stopped', reason: 'time_limit' });
    expect(t.unwatch).toHaveBeenCalled();
  });

  it('stops when location permission is denied, and keeps going on a weak signal', () => {
    const t = setup();
    t.share.start(TARGET);
    t.error('unavailable');
    expect(t.share.getState()).toMatchObject({ status: 'sharing', signal: 'weak_gps' });
    t.error('denied');
    expect(t.share.getState()).toMatchObject({ status: 'stopped', reason: 'denied' });
  });

  it('reports unsupported browsers without starting', () => {
    const share = new RideShare({
      watch: null,
      send: vi.fn(),
      end: vi.fn(),
      now: () => 0,
      newRideId: () => 'x',
      every: () => () => undefined,
    });
    share.start(TARGET);
    expect(share.getState()).toMatchObject({ status: 'stopped', reason: 'unsupported' });
  });

  it('ignores an answer that arrives after the rider stopped', async () => {
    let resolve!: (r: RidePositionResponse) => void;
    const t = setup(() => new Promise((r) => (resolve = r)));
    t.share.start(TARGET);
    t.fix();
    t.share.stop();
    resolve({ accepted: true, vehicleId: 'crowd-x', offsetMeters: 1 });
    await flush();
    expect(t.share.getState()).toMatchObject({ status: 'stopped', accepted: 0 });
  });

  it('sends how full the vehicle is, and resends the last fix when only that changes', async () => {
    const t = setup();
    t.share.start(TARGET);
    t.fix();
    await flush();
    expect(t.send.mock.calls[0]![0].occupancy).toBeUndefined();
    // Stuck in traffic: no new GPS fix, but the rider says it is full now.
    t.share.setOccupancy('full');
    await flush();
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.send.mock.calls[1]![0]).toMatchObject({
      occupancy: 'full',
      coordinates: [77.23, 28.66],
    });
    expect(t.share.getState()).toMatchObject({ occupancy: 'full' });
    // The answer sticks for later fixes.
    t.fix(28.661);
    await t.tick();
    expect(t.send.mock.calls[2]![0].occupancy).toBe('full');
  });
});
