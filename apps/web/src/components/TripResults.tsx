import type { ReactNode } from 'react';
import type { PlanState } from '../hooks/usePlan';
import { formatRelativeTime } from '../lib/format';
import type { RecentTrip } from '../lib/recentTrips';
import { HistoryIcon, LocateIcon } from './icons';
import { ItineraryCard } from './ItineraryCard';

interface Props {
  plan: PlanState;
  online: boolean;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  recentTrips: RecentTrip[];
  onOpenRecent: (trip: RecentTrip) => void;
  sameOriginAndDestination: boolean;
}

export function TripResults(props: Props) {
  const { plan, online, onRetry, selectedId, onSelect } = props;

  if (props.sameOriginAndDestination) {
    return <Notice>Start and destination are the same place. Pick a different destination.</Notice>;
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
          ? "We couldn't reach the route planner."
          : "You're offline and this trip isn't saved on your phone yet."}
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 block rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          Try again
        </button>
      </Notice>
    );
  }

  const { itineraries } = plan.data;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-baseline justify-between" aria-live="polite">
        <h2 className="text-sm font-semibold text-slate-900">
          {itineraries.length === 1 ? '1 way to go' : `${itineraries.length} ways to go`}
        </h2>
        {plan.source === 'cache' && (
          <span className="text-xs text-slate-500">
            {plan.refreshing ? 'Updating…' : `Saved ${formatRelativeTime(plan.savedAt ?? '')}`}
          </span>
        )}
      </div>

      {itineraries.length === 0 ? (
        <Notice>
          No shared autos, taxis or minibuses connect these places yet. Coverage is growing corridor
          by corridor. Try a nearby landmark.
        </Notice>
      ) : (
        itineraries.map((it, i) => (
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
        Fares are estimates; confirm with the driver. Wait times come from stand marshals and
        drivers.
      </p>
    </div>
  );
}

function IdleState({ recentTrips, onOpenRecent }: Props) {
  if (recentTrips.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-2xl bg-teal-50 p-4 text-sm text-teal-950">
          <p className="font-semibold">Where are you going?</p>
          <p className="mt-1 text-teal-900/80">
            Search a market, metro station or landmark. Tap{' '}
            <LocateIcon size={14} className="inline align-[-2px]" /> to start from where you are.
            We&rsquo;ll show shared autos, taxis and minibuses with live waits at each stand.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4">
      <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Recent trips
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
                  Saved {formatRelativeTime(trip.savedAt)} · works offline
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
