import type { Leg } from '@transit/shared-types';
import { DEFAULT_ROUTE_COLOR, readableTextColor } from '../lib/color';
import { formatDistance, formatDuration, formatFrequency, MODE_META } from '../lib/format';
import { ModeIcon, PinIcon } from './icons';
import { LiveArrivalBadge } from './LiveArrivalBadge';
import { NextSharedVehicle, ShareRideButton } from './RideShare';
import { t } from '../lib/i18n';

/** Step-by-step view of an itinerary: walk, board, ride, get off, arrive. */
export function LegTimeline({ legs }: { legs: Leg[] }) {
  const last = legs[legs.length - 1];
  return (
    <ol className="relative">
      {legs.map((leg, i) => (
        <LegStep key={i} leg={leg} />
      ))}
      {last && (
        <li className="flex gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-500 text-white">
            <PinIcon size={16} />
          </span>
          <p className="pt-1.5 font-medium text-slate-900">
            {t('Arrive at {place}', { place: last.to.name })}
          </p>
        </li>
      )}
    </ol>
  );
}

function LegStep({ leg }: { leg: Leg }) {
  const walk = leg.mode === 'WALK';
  const color = walk ? '#94a3b8' : (leg.routeColor ?? DEFAULT_ROUTE_COLOR);
  const meta = MODE_META[leg.mode];

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full"
          style={
            walk
              ? { backgroundColor: '#f1f5f9', color: '#475569' }
              : { backgroundColor: color, color: readableTextColor(color) }
          }
        >
          <ModeIcon mode={leg.mode} size={16} />
        </span>
        <span
          aria-hidden="true"
          className="my-1 w-1 flex-1 rounded-full"
          style={
            walk
              ? {
                  backgroundImage: `radial-gradient(circle, ${color} 1.5px, transparent 2px)`,
                  backgroundSize: '4px 8px',
                }
              : { backgroundColor: color }
          }
        />
      </div>

      <div className="min-w-0 flex-1 pb-5">
        {walk ? (
          <>
            <p className="pt-1.5 font-medium text-slate-900">
              {t('Walk to {place}', { place: leg.to.name })}
            </p>
            <p className="text-sm text-slate-500">
              {t('{distance} · about {duration}', {
                distance: formatDistance(leg.distanceMeters),
                duration: formatDuration(leg.durationSeconds),
              })}
            </p>
          </>
        ) : (
          <>
            <p className="pt-1.5 font-medium text-slate-900">
              {meta.label} {leg.routeShortName ?? ''}
              <span className="font-normal text-slate-500">
                {' '}
                {t('from {place}', { place: leg.from.name })}
              </span>
            </p>
            <p className="text-sm text-slate-500">
              {t('Get off at')} <span className="text-slate-700">{leg.to.name}</span> ·{' '}
              {formatDuration(leg.durationSeconds)} · {formatDistance(leg.distanceMeters)}
              {leg.frequencyMinutes && (
                <>
                  {' '}
                  · {t('leaves {frequency}', { frequency: formatFrequency(leg.frequencyMinutes) })}
                </>
              )}
            </p>
            <div className="mt-1.5">
              <LiveArrivalBadge leg={leg} detailed />
            </div>
            <NextSharedVehicle leg={leg} />
            <ShareRideButton leg={leg} />
          </>
        )}
      </div>
    </li>
  );
}
