import type {
  CongestionLevel,
  FrequencyRange,
  LegMode,
  Money,
  Occupancy,
  PassengerQueueLevel,
} from '@transit/shared-types';
import { t } from './i18n';

/** Non-breaking space: keeps "1.1 km" / "10 min" on one line. */
const NBSP = ' ';

export function formatDuration(seconds: number): string {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return t(`{n}${NBSP}min`, { n: totalMin });
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? t(`{h}${NBSP}h {m}${NBSP}min`, { h, m }) : t(`{h}${NBSP}h`, { h });
}

export function formatDistance(meters: number): string {
  if (meters < 100) return `${Math.max(1, Math.round(meters))}${NBSP}m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10}${NBSP}m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)}${NBSP}km`;
}

export function formatFare({ currency, amount }: Money): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

export function formatFrequency({ min, max }: FrequencyRange): string {
  return min === max ? t('every {n} min', { n: min }) : t('every {min}–{max} min', { min, max });
}

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const diffSec = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(diffSec)) return '';
  if (diffSec < 60) return t('just now');
  const min = Math.round(diffSec / 60);
  if (min < 60) return t('{n} min ago', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('{n} h ago', { n: h });
  return t('{n} d ago', { n: Math.round(h / 24) });
}

/** "3–6 min", "1–2 min", "under 1 min": an arrival range in whole minutes. */
export function formatEta(eta: { min: number; max: number }): string {
  if (eta.max < 60) return t('under 1 min');
  const lo = Math.max(0, Math.floor(eta.min / 60));
  const hi = Math.max(lo + 1, Math.ceil(eta.max / 60));
  return lo === 0 ? t('within {n} min', { n: hi }) : t('{min}–{max} min', { min: lo, max: hi });
}

/** `label` is read in the current language each time (see lib/i18n). */
const level = (label: string, tone: Tone) => ({
  get label() {
    return t(label);
  },
  tone,
});

export const OCCUPANCY_META: Record<Occupancy, { label: string; tone: Tone }> = {
  seats_available: level('Seats free', 'good'),
  standing_only: level('Standing only', 'warn'),
  full: level('Full', 'bad'),
};

const mode = (label: string, vehicles: string) => ({
  get label() {
    return t(label);
  },
  get vehicles() {
    return vehicles && t(vehicles);
  },
});

export const MODE_META: Record<LegMode, { label: string; vehicles: string }> = {
  WALK: mode('Walk', ''),
  AUTO_RICKSHAW: mode('Shared auto', 'autos'),
  E_RICKSHAW: mode('E-rickshaw', 'e-rickshaws'),
  SHARED_TAXI: mode('Shared taxi', 'taxis'),
  MINIBUS: mode('Minibus', 'minibuses'),
  BUS: mode('Bus', 'buses'),
};

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export const CONGESTION_META: Record<CongestionLevel, { label: string; tone: Tone }> = {
  low: level('Short wait', 'good'),
  moderate: level('Moderate wait', 'warn'),
  high: level('Long wait', 'bad'),
};

export const QUEUE_META: Record<PassengerQueueLevel, { label: string; tone: Tone }> = {
  empty: level('No queue', 'good'),
  normal: level('Normal queue', 'good'),
  crowded: level('Crowded', 'warn'),
  severe: level('Very crowded', 'bad'),
};

export const TONE_CLASSES: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  warn: 'bg-amber-50 text-amber-900 ring-amber-600/25',
  bad: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/15',
};

export const TONE_DOT: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
  neutral: 'bg-slate-400',
};
