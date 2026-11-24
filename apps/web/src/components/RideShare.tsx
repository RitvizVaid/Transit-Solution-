import { OCCUPANCY_LEVELS, type Leg } from '@transit/shared-types';
import { useEffect, useState } from 'react';
import { rideShare, useRideShare } from '../hooks/useRideShare';
import { useArrivals } from '../hooks/useArrivals';
import { formatEta, MODE_META, OCCUPANCY_META } from '../lib/format';
import type { ShareSignal, StopReason } from '../lib/rideShare';
import { CloseIcon, LocateIcon } from './icons';
import { Pill } from './Pill';
import { t } from '../lib/i18n';

const SIGNAL_TEXT: Record<ShareSignal, { text: string; dot: string }> = {
  starting: { text: 'Finding your location…', dot: 'bg-slate-400' },
  on_route: { text: 'Others can see this vehicle on the map.', dot: 'bg-emerald-500' },
  off_route: {
    text: "You're not on this route's path. Did you board a different route?",
    dot: 'bg-amber-500',
  },
  weak_gps: { text: 'GPS signal is weak. Waiting for a better fix.', dot: 'bg-amber-500' },
  offline: { text: "Can't reach the server. Will keep trying.", dot: 'bg-rose-500' },
};

const STOP_TEXT: Record<StopReason, string> = {
  user: 'Thanks for sharing your ride.',
  time_limit: 'Sharing stopped automatically after 2 hours.',
  denied: 'Location is blocked, so your ride could not be shared. Allow it in browser settings.',
  unsupported: "This browser can't share location.",
  rejected: 'The server could not accept this ride.',
};

/**
 * "I'm on this vehicle": shown on a ride step. The first tap explains what is shared;
 * the second starts sharing. Nothing is sent until the rider confirms.
 */
export function ShareRideButton({ leg }: { leg: Leg }) {
  const state = useRideShare();
  const [confirming, setConfirming] = useState(false);
  if (leg.mode === 'WALK' || !leg.routeId) return null;
  const routeName = leg.routeShortName ?? leg.routeId;
  const vehicle = MODE_META[leg.mode].label.toLowerCase();

  if (state.status === 'sharing' && state.routeId === leg.routeId) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800">
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
        {t('Sharing this ride')}
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-teal-800 ring-1 ring-teal-700/30 hover:bg-teal-50"
      >
        <LocateIcon size={16} />
        {t('I’m on this {vehicle}', { vehicle })}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-teal-50 p-3 text-sm ring-1 ring-teal-700/15">
      <p className="font-semibold text-teal-950">
        {t('Share where this {vehicle} is?', { vehicle })}
      </p>
      <p className="mt-1 text-teal-900/85">
        {t(
          'People waiting for {route} will see it move on the map. Your position is placed on the route line and is not saved; no name or account is attached. It stops when you tap Stop, close the app, or after 2 hours.',
          { route: routeName },
        )}
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            rideShare.start({ routeId: leg.routeId!, routeName, mode: leg.mode });
          }}
          className="min-h-10 rounded-lg bg-teal-700 px-3 font-semibold text-white hover:bg-teal-800"
        >
          {t('Start sharing')}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="min-h-10 rounded-lg px-3 font-semibold text-teal-900 hover:bg-teal-100"
        >
          {t('Not now')}
        </button>
      </div>
    </div>
  );
}

/** Keeps the screen awake while sharing: phones pause GPS for a locked screen. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => undefined); // battery saver etc.: sharing still works while the screen is on
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active]);
}

/** Always-visible status while a ride is shared, with one big Stop button. */
export function RideShareBanner() {
  const state = useRideShare();
  useWakeLock(state.status === 'sharing');

  if (state.status === 'idle') return null;

  if (state.status === 'stopped') {
    return (
      <section
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-white/95 p-3 text-sm shadow-md ring-1 ring-slate-900/10 backdrop-blur"
      >
        <p className="min-w-0 flex-1 text-slate-800">
          {t(STOP_TEXT[state.reason])}
          {state.accepted > 0 && state.reason !== 'denied' && (
            <span className="text-slate-500">
              {' '}
              {t('{route} was visible to others.', { route: state.routeName })}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => rideShare.dismiss()}
          aria-label={t('Dismiss')}
          className="grid size-9 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <CloseIcon size={18} />
        </button>
      </section>
    );
  }

  const signal = SIGNAL_TEXT[state.signal];
  return (
    <section
      aria-label={t('Sharing your ride')}
      className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 p-3 text-sm text-white shadow-lg"
    >
      <span className="relative flex size-3 shrink-0" aria-hidden="true">
        {state.signal === 'on_route' && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:hidden" />
        )}
        <span className={`relative inline-flex size-3 rounded-full ${signal.dot}`} />
      </span>
      <div className="min-w-0 flex-1" role="status">
        <p className="font-semibold">
          {t('Sharing your ride on {route}', { route: state.routeName })}
        </p>
        <p className="text-white/80">
          {t(signal.text)} {t('Keep this page open.')}
        </p>
      </div>
      <button
        type="button"
        onClick={() => rideShare.stop('user')}
        className="min-h-11 shrink-0 rounded-xl bg-white px-4 font-semibold text-slate-900 hover:bg-slate-100"
      >
        {t('Stop')}
      </button>
      <div className="basis-full" role="group" aria-label={t('How full is it?')}>
        <p className="mb-1.5 text-xs text-white/70">
          {t('How full is it? (helps people waiting)')}
        </p>
        <div className="flex gap-1.5">
          {OCCUPANCY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={state.occupancy === level}
              onClick={() => rideShare.setOccupancy(level)}
              className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold ring-1 ring-white/25 ${
                state.occupancy === level
                  ? 'bg-white text-slate-900'
                  : 'text-white hover:bg-white/10'
              }`}
            >
              {OCCUPANCY_META[level].label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * "Next KG-1 2–6 min away · seats free": a vehicle someone on board is sharing, heading to
 * this ride's boarding stop. Shows nothing when nobody is sharing one (the schedule badge
 * already covers that case).
 */
export function NextSharedVehicle({ leg }: { leg: Leg }) {
  const ride = leg.mode !== 'WALK';
  const arrivals = useArrivals(
    ride ? leg.fromStopId : undefined,
    ride ? leg.routeId : undefined,
    ride ? leg.toStopId : undefined,
  );
  const next = arrivals?.[0];
  if (!next) return null;
  const occupancy = next.occupancy ? OCCUPANCY_META[next.occupancy] : null;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
      <Pill tone="good">
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
        {t('Next {route} {eta} away', {
          route: leg.routeShortName ?? '',
          eta: formatEta(next.etaSeconds),
        })}
      </Pill>
      {occupancy && <Pill tone={occupancy.tone}>{occupancy.label}</Pill>}
      <span className="text-xs text-slate-500">{t('shared by a rider on board')}</span>
    </p>
  );
}
