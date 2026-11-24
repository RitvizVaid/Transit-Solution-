import type { Itinerary } from '@transit/shared-types';
import { Fragment } from 'react';
import { useNow } from '../hooks/useNow';
import { CONGESTION_META, formatClock, formatDuration, formatFare } from '../lib/format';
import { ChevronRightIcon, WalkIcon } from './icons';
import { LegTimeline } from './LegTimeline';
import { LiveArrivalBadge } from './LiveArrivalBadge';
import { Pill } from './Pill';
import { RouteChip } from './RouteChip';
import { t } from '../lib/i18n';

interface Props {
  itinerary: Itinerary;
  selected: boolean;
  onSelect: () => void;
  /** Rank in the list, for the accessible name. */
  index: number;
}

export function ItineraryCard({ itinerary, selected, onSelect, index }: Props) {
  const { durationSeconds, estimatedFare, congestionLevel, legs, walkTimeSeconds } = itinerary;
  const firstRide = legs.find((l) => l.mode !== 'WALK');
  const congestion = CONGESTION_META[congestionLevel];
  const now = useNow(60_000);
  const arrival = formatClock(new Date(now + durationSeconds * 1000));
  const detailsId = `itinerary-${itinerary.id}-details`;

  return (
    <article
      className={`rounded-2xl bg-white ring-1 transition-shadow ${selected ? 'shadow-md ring-2 ring-teal-700' : 'ring-slate-200 hover:ring-slate-300'}`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        aria-controls={detailsId}
        className="block w-full rounded-2xl p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
      >
        <span className="sr-only">{t('Option {n}: ', { n: index + 1 })}</span>
        <span className="flex items-baseline justify-between gap-3">
          <span className="block text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {formatDuration(durationSeconds)}
          </span>
          <span className="text-right">
            <span className="text-lg font-semibold text-slate-900 tabular-nums">
              {formatFare(estimatedFare)}
            </span>
            <span className="block text-xs text-slate-500">{t('est. fare')}</span>
          </span>
        </span>
        <span className="-mt-1 block text-sm text-slate-500">
          {t('Arrive ~{time} · {walk} walking', {
            time: arrival,
            walk: formatDuration(walkTimeSeconds),
          })}
        </span>

        <span className="mt-3 flex flex-wrap items-center gap-1">
          {legs.map((leg, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRightIcon size={14} className="text-slate-400" />}
              {leg.mode === 'WALK' ? (
                <span className="inline-flex items-center gap-0.5 text-sm text-slate-600">
                  <WalkIcon size={16} />
                  <span className="sr-only">{t('Walk')}</span>
                  {Math.max(1, Math.round(leg.durationSeconds / 60))}
                  <span className="sr-only"> min</span>
                </span>
              ) : (
                <RouteChip mode={leg.mode} name={leg.routeShortName} color={leg.routeColor} />
              )}
            </Fragment>
          ))}
        </span>

        <span className="mt-3 flex flex-wrap gap-1.5">
          {firstRide && <LiveArrivalBadge leg={firstRide} />}
          <Pill tone={congestion.tone}>{congestion.label}</Pill>
        </span>
      </button>

      {selected && (
        <div id={detailsId} className="border-t border-slate-100 px-4 pt-4">
          <LegTimeline legs={legs} />
        </div>
      )}
    </article>
  );
}
