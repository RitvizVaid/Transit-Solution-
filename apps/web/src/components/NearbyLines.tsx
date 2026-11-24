import { NEARBY_RADII, type NearbyRadius, type NearbyState } from '../hooks/useNearbyLines';
import { formatDistance, formatFrequency, MODE_META } from '../lib/format';
import type { NearbyLine } from '../lib/nearby';
import { LocateIcon } from './icons';
import { RouteChip } from './RouteChip';
import { t } from '../lib/i18n';

/** Sheet header for the Nearby tab: where we're searching from + radius control. */
export function NearbyHeader({
  centerLabel,
  radius,
  onRadiusChange,
  onUseMyLocation,
  locating,
  usingGps,
}: {
  centerLabel: string;
  radius: NearbyRadius;
  onRadiusChange: (r: NearbyRadius) => void;
  onUseMyLocation: () => void;
  locating: boolean;
  usingGps: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-slate-600">
          Lines near <span className="font-semibold text-slate-900">{centerLabel}</span>
        </p>
        {!usingGps && (
          <button
            type="button"
            onClick={onUseMyLocation}
            disabled={locating}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-60"
          >
            <LocateIcon size={16} className={locating ? 'animate-pulse' : undefined} />
            {locating ? t('Locating…') : t('Use my location')}
          </button>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label="Search radius"
        className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
      >
        {NEARBY_RADII.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={r === radius}
            onClick={() => onRadiusChange(r)}
            className={`h-10 rounded-lg text-sm font-medium transition-colors ${r === radius ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {r} m
          </button>
        ))}
      </div>
    </div>
  );
}

export function NearbyList({
  state,
  radius,
  onRetry,
  onWidenRadius,
}: {
  state: NearbyState;
  radius: NearbyRadius;
  onRetry: () => void;
  onWidenRadius: (() => void) | null;
}) {
  if (state.status === 'error') {
    return (
      <div className="p-4">
        <div role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-900">
          Couldn&rsquo;t load nearby lines.
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 block rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
          >
            {t('Try again')}
          </button>
        </div>
      </div>
    );
  }

  const lines = state.status === 'idle' ? [] : state.lines;
  const loading = state.status === 'loading' || state.status === 'idle';

  if (loading && lines.length === 0) {
    return (
      <div className="space-y-2 p-4" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (lines.length === 0) {
    const nearest = state.status === 'ok' ? state.nearest : null;
    return (
      <div className="space-y-3 p-4">
        <div role="status" className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
          No lines stop within {radius} m.
          {onWidenRadius && (
            <button
              type="button"
              onClick={onWidenRadius}
              className="ml-1 font-semibold text-teal-800 underline underline-offset-2"
            >
              {t('Search wider')}
            </button>
          )}
        </div>
        {nearest && (
          <section
            aria-label={t('Closest line')}
            className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"
          >
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {t('Closest line')}
            </p>
            <div className="mt-2 flex items-start gap-3">
              <RouteChip
                mode={nearest.route.mode}
                name={nearest.route.shortName}
                color={nearest.route.color}
              />
              <p className="min-w-0 flex-1 font-medium text-slate-900">
                {nearest.route.longName ?? nearest.route.shortName}
              </p>
            </div>
            <p className="mt-2 text-sm text-slate-700">
              Its route passes{' '}
              <span className="font-semibold tabular-nums">
                {formatDistance(nearest.distanceMeters)}
              </span>{' '}
              away; nearest stop <span className="font-medium">{nearest.nearestStop.name}</span> (
              {formatDistance(nearest.nearestStop.distanceMeters)}).
            </p>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className={`p-4 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
      <h2 className="sr-only">Nearby lines</h2>
      <p className="mb-2 px-1 text-xs text-slate-500" aria-live="polite">
        {lines.length} {lines.length === 1 ? 'line' : 'lines'} within {radius} m
      </p>
      <ul className="space-y-2">
        {lines.map((line) => (
          <NearbyLineItem key={line.route.id} line={line} />
        ))}
      </ul>
    </div>
  );
}

function NearbyLineItem({ line }: { line: NearbyLine }) {
  const { route, nearestStop } = line;
  return (
    <li className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex items-start gap-3">
        <RouteChip mode={route.mode} name={route.shortName} color={route.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">{route.longName ?? route.shortName}</p>
          <p className="text-sm text-slate-500">
            {MODE_META[route.mode].label}
            {route.frequencyMinutes && <> · {formatFrequency(route.frequencyMinutes)}</>}
            {route.serviceHours && (
              <>
                {' '}
                · {route.serviceHours.start}–{route.serviceHours.end}
              </>
            )}
          </p>
        </div>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-700">
        <span className="font-semibold tabular-nums text-slate-900">
          {formatDistance(nearestStop.distanceMeters)}
        </span>
        <span className="text-slate-500">to</span>
        <span className="truncate">{nearestStop.name}</span>
        {nearestStop.isVirtual && (
          <span
            className="shrink-0 rounded bg-slate-100 px-1.5 text-xs text-slate-600"
            title="Informal pick-up point, no marked stop"
          >
            informal stop
          </span>
        )}
      </p>
    </li>
  );
}
