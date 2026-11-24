import type { Leg } from '@transit/shared-types';
import { useNow } from '../hooks/useNow';
import { useStandStatus } from '../hooks/useStandStatus';
import { isLiveReport } from '../lib/standFreshness';
import {
  formatFrequency,
  formatRelativeTime,
  MODE_META,
  QUEUE_META,
  TONE_DOT,
} from '../lib/format';
import { ClockIcon } from './icons';
import { Pill } from './Pill';
import { t } from '../lib/i18n';

/**
 * Informal transit has no timetable, so "arrival" means: how long until the next
 * vehicle leaves this stand. A report still in effect wins; otherwise show the headway.
 * Baseline (schedule) values are never presented as observed.
 */
export function LiveArrivalBadge({ leg, detailed = false }: { leg: Leg; detailed?: boolean }) {
  const snap = useStandStatus(leg.boardingStandId);
  const now = useNow(30_000);
  const stand = snap?.status === 'ok' ? snap.stand : null;

  if (stand && isLiveReport(stand, now)) {
    const queue = QUEUE_META[stand.passengerQueueLevel];
    const vehicles = MODE_META[leg.mode].vehicles || t('vehicles');
    return (
      <Pill tone={queue.tone}>
        <span className="relative flex size-2" aria-hidden="true">
          <span
            className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${TONE_DOT[queue.tone]}`}
          />
          <span className={`relative inline-flex size-2 rounded-full ${TONE_DOT[queue.tone]}`} />
        </span>
        <span className="sr-only">{t('Reported at the stand:')}</span>
        <span>{t('~{n} min wait', { n: stand.averageWaitMinutes })}</span>
        {detailed && (
          <span className="font-normal opacity-80">
            {stand.availableVehiclesEstimate !== null && (
              <>
                {' '}
                · {t('{n} {vehicles} at stand', { n: stand.availableVehiclesEstimate, vehicles })}
              </>
            )}{' '}
            · {queue.label.toLowerCase()} ·{' '}
            {t('reported {time}', { time: formatRelativeTime(stand.lastReportedAt!, now) })}
          </span>
        )}
      </Pill>
    );
  }

  // No report in effect: show the schedule, which is what the estimate is based on.
  if (leg.frequencyMinutes) {
    return (
      <Pill tone="neutral">
        <ClockIcon size={12} />
        {formatFrequency(leg.frequencyMinutes)}
        {detailed && stand && (
          <span className="font-normal opacity-80">
            ·{' '}
            {stand.lastReportedAt
              ? t('last stand report {time}', {
                  time: formatRelativeTime(stand.lastReportedAt, now),
                })
              : t('no stand report yet')}
          </span>
        )}
      </Pill>
    );
  }
  return null;
}
