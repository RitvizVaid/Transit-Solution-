import type {
  CongestionLevel,
  FrequencyRange,
  LegMode,
  Money,
  PassengerQueueLevel,
} from '@transit/shared-types';

/** Non-breaking space: keeps "1.1 km" / "10 min" on one line. */
const NBSP = ' ';

export function formatDuration(seconds: number): string {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin}${NBSP}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}${NBSP}h ${m}${NBSP}min` : `${h}${NBSP}h`;
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
  return min === max ? `every ${min} min` : `every ${min}–${max} min`;
}

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const diffSec = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(diffSec)) return '';
  if (diffSec < 60) return 'just now';
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const MODE_META: Record<LegMode, { label: string; vehicles: string }> = {
  WALK: { label: 'Walk', vehicles: '' },
  AUTO_RICKSHAW: { label: 'Shared auto', vehicles: 'autos' },
  E_RICKSHAW: { label: 'E-rickshaw', vehicles: 'e-rickshaws' },
  SHARED_TAXI: { label: 'Shared taxi', vehicles: 'taxis' },
  MINIBUS: { label: 'Minibus', vehicles: 'minibuses' },
  BUS: { label: 'Bus', vehicles: 'buses' },
};

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export const CONGESTION_META: Record<CongestionLevel, { label: string; tone: Tone }> = {
  low: { label: 'Short wait', tone: 'good' },
  moderate: { label: 'Moderate wait', tone: 'warn' },
  high: { label: 'Long wait', tone: 'bad' },
};

export const QUEUE_META: Record<PassengerQueueLevel, { label: string; tone: Tone }> = {
  empty: { label: 'No queue', tone: 'good' },
  normal: { label: 'Normal queue', tone: 'good' },
  crowded: { label: 'Crowded', tone: 'warn' },
  severe: { label: 'Very crowded', tone: 'bad' },
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
