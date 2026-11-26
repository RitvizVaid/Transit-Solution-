import type { Itinerary, NoRouteReason } from '@transit/shared-types';
import { useState, type ReactNode } from 'react';
import type { PlanState } from '../hooks/usePlan';
import { formatRelativeTime } from '../lib/format';
import type { RecentTrip } from '../lib/recentTrips';
import { HistoryIcon, LocateIcon } from './icons';
import type { Place } from '../types';
import { ItineraryCard } from './ItineraryCard';
import { SuggestRoute } from './SuggestRoute';
import { t } from '../lib/i18n';

const comparison = {
  recommended: { label: 'Recommended', score: () => 0 },
  duration: { label: 'Fastest', score: (trip: Itinerary) => trip.durationSeconds },
  fare: {
    label: 'Lowest estimated fare',
    score: (trip: Itinerary) => (trip.fareUnavailable ? Infinity : trip.estimatedFare.amount),
  },
  walking: { label: 'Least walking', score: (trip: Itinerary) => trip.walkTimeSeconds },
};
type Comparison = keyof typeof comparison;

interface Props {
  plan: PlanState;
  online: boolean;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  recentTrips: RecentTrip[];
  onOpenRecent: (trip: RecentTrip) => void;
  sameOriginAndDestination: boolean;
  /** The trip being planned; lets an empty result offer to suggest a route. */
  trip: { from: Place; to: Place } | null;
}

export function TripResults(props: Props) {
  const { plan, online, onRetry, selectedId, onSelect } = props;
  const [compareBy, setCompareBy] = useState<Comparison>('recommended');

  if (props.sameOriginAndDestination) {
    return (
      <Notice>
        {t('Start and destination are the same place. Pick a different destination.')}
      </Notice>
    );
  }

  if (plan.status === 'idle') return <IdleState {...props} />;

  if (plan.status === 'loading') {
    return (
      <div className="space-y-3 p-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Finding routes…</span>
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (plan.status === 'error') {
    return (
      <Notice tone="error">
        {online
          ? t("We couldn't reach the route planner.")
          : t("You're offline and this trip isn't saved on your phone yet.")}
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 block rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          {t('Try again')}
        </button>
      </Notice>
    );
  }

  const { itineraries } = plan.data;
  const savedAge = plan.savedAt ? formatRelativeTime(plan.savedAt) : '';
  const { score } = comparison[compareBy];
  const ordered =
    compareBy === 'recommended'
      ? itineraries
      : [...itineraries].sort((a, b) => score(a) - score(b));
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-baseline justify-between" aria-live="polite">
        <h2 className="text-sm font-semibold text-slate-900">
          {itineraries.length === 1
            ? t('1 way to go')
            : t('{n} ways to go', { n: itineraries.length })}
        </h2>
        {plan.source === 'cache' && (
          <span className="text-xs text-slate-500">
            {plan.refreshing
              ? t('Updating…')
              : savedAge
                ? t('Saved {time}', { time: savedAge })
                : t('Saved plan')}
          </span>
        )}
      </div>

      {itineraries.length > 1 && (
        <label className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
          {t('Compare by')}
          <select
            value={compareBy}
            onChange={(event) => setCompareBy(event.currentTarget.value as Comparison)}
            className="min-h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            {Object.entries(comparison).map(([value, { label }]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
      )}

      {itineraries.length === 0 ? (
        <>
          <Notice>{noRouteText(plan.data.noRouteReason)}</Notice>
          {props.trip && online && <SuggestRoute from={props.trip.from} to={props.trip.to} />}
        </>
      ) : (
        ordered.map((it, i) => (
          <ItineraryCard
            key={it.id}
            itinerary={it}
            index={i}
            selected={it.id === selectedId}
            onSelect={() => onSelect(it.id)}
          />
        ))
      )}

      <p className="px-1 pt-1 text-xs leading-relaxed text-slate-500">
        {t(
          'Fares and times are estimates; confirm the fare with the driver. Waits use a stand marshal’s report when one is recent, otherwise how often the route usually runs.',
        )}
      </p>
    </div>
  );
}

function IdleState({ recentTrips, onOpenRecent }: Props) {
  if (recentTrips.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-2xl bg-teal-50 p-4 text-sm text-teal-950">
          <p className="font-semibold">{t('Where are you going?')}</p>
          <p className="mt-1 text-teal-900/80">
            {t('Search a market, metro station or landmark. Tap')}{' '}
            <LocateIcon size={14} className="inline align-[-2px]" />{' '}
            {t(
              'to start from where you are. We’ll show shared autos, taxis and minibuses with the expected wait at each stand.',
            )}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4">
      <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {t('Recent trips')}
      </h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-200">
        {recentTrips.map((trip) => (
          <li key={trip.key}>
            <button
              type="button"
              onClick={() => onOpenRecent(trip)}
              className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50"
            >
              <HistoryIcon size={18} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-slate-900">
                  {trip.from.name} <span className="text-slate-400">→</span> {trip.to.name}
                </span>
                <span className="block text-xs text-slate-500">
                  {t('Saved {time} · works offline', { time: formatRelativeTime(trip.savedAt) })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return (
    <div className="p-4">
      <div
        role={tone === 'error' ? 'alert' : 'status'}
        className={`rounded-2xl p-4 text-sm ${tone === 'error' ? 'bg-rose-50 text-rose-900' : 'bg-slate-50 text-slate-700'}`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Empty results describe this app's search, not the street: informal routes it does not
 * know about may still run, so the copy never says "no service exists".
 */
export function noRouteText(reason: NoRouteReason | undefined): string {
  switch (reason) {
    case 'no_stops_near_origin':
      return t(
        'None of the routes this app knows stop within a short walk of your start. Try starting from a nearby landmark or main road.',
      );
    case 'no_stops_near_destination':
      return t(
        'None of the routes this app knows stop within a short walk of your destination. Try a nearby landmark or main road.',
      );
    case 'outside_service_hours':
      return t(
        'The routes near these places are outside their service schedule. Try a different time or day.',
      );
    default:
      return t(
        "We couldn't find a way between these places with the routes this app knows. Other shared autos or buses may still run here.",
      );
  }
}
