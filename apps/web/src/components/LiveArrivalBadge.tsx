import type { Leg } from '@transit/shared-types';
import { config } from '../config';
import { useNow } from '../hooks/useNow';
import { useStandStatus } from '../hooks/useStandStatus';
import {
  formatFrequency,
  formatRelativeTime,
  MODE_META,
  QUEUE_META,
  TONE_DOT,
} from '../lib/format';
import { ClockIcon } from './icons';
import { Pill } from './Pill';

/**
 * Informal transit has no timetable, so "arrival" means: how long until the next
 * vehicle leaves this stand. Live stand reports win; otherwise show the headway.
 */
export function LiveArrivalBadge({ leg, detailed = false }: { leg: Leg; detailed?: boolean }) {
  const snap = useStandStatus(leg.boardingStandId);
  const now = useNow(30_000);

  if (snap?.status === 'ok') {
    const s = snap.stand;
    const ageMs = now - Date.parse(s.lastUpdated);
    const fresh = ageMs < config.standStaleAfterMs;
    const queue = QUEUE_META[s.passengerQueueLevel];
    const tone = fresh ? queue.tone : 'neutral';
    const vehicles = MODE_META[leg.mode].vehicles || 'vehicles';

    return (
      <Pill tone={tone}>
        <span className="relative flex size-2" aria-hidden="true">
          {fresh && (
            <span
              className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${TONE_DOT[tone]}`}
            />
          )}
          <span className={`relative inline-flex size-2 rounded-full ${TONE_DOT[tone]}`} />
        </span>
        <span className="sr-only">{fresh ? 'Live:' : 'Last report:'}</span>
        <span>~{s.averageWaitMinutes} min wait</span>
        {detailed && (
          <span className="font-normal opacity-80">
            · {s.availableVehiclesEstimate} {vehicles} at stand · {queue.label.toLowerCase()}
          </span>
        )}
        {!fresh && (
          <span className="font-normal opacity-80">· {formatRelativeTime(s.lastUpdated, now)}</span>
        )}
      </Pill>
    );
  }

  if (leg.frequencyMinutes) {
    return (
      <Pill tone="neutral">
        <ClockIcon size={12} />
        {formatFrequency(leg.frequencyMinutes)}
      </Pill>
    );
  }
  return null;
}
