import type { VehicleMode } from '@transit/shared-types';
import { useId, useState } from 'react';
import { ApiError, postSuggestion } from '../api';
import { MODE_META } from '../lib/format';
import type { Place } from '../types';
import { t } from '../lib/i18n';

const MODES: VehicleMode[] = ['AUTO_RICKSHAW', 'E_RICKSHAW', 'SHARED_TAXI', 'MINIBUS', 'BUS'];

type Status = 'closed' | 'open' | 'sending' | 'sent' | 'error' | 'limited';

/**
 * "Know a shared auto or bus between these places?" A commuter describes a route the app
 * doesn't know. It is held for review and never shown as fact until checked.
 */
export function SuggestRoute({ from, to }: { from: Place; to: Place }) {
  const id = useId();
  const [status, setStatus] = useState<Status>('closed');
  const [mode, setMode] = useState<VehicleMode | ''>('');
  const [routeName, setRouteName] = useState('');
  const [fare, setFare] = useState('');
  const [note, setNote] = useState('');

  if (status === 'sent') {
    return (
      <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950">
        {t(
          'Thanks! Your suggestion is saved for review. It won’t appear in results until someone checks it with drivers.',
        )}
      </p>
    );
  }

  if (status === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setStatus('open')}
        className="min-h-11 w-full rounded-xl px-4 text-sm font-semibold text-teal-800 ring-1 ring-teal-700/30 hover:bg-teal-50"
      >
        {t('Know a shared auto or bus between these places? Tell us')}
      </button>
    );
  }

  const submit = async () => {
    setStatus('sending');
    const fareInr = Number.parseInt(fare, 10);
    try {
      await postSuggestion({
        from: { name: from.name, lat: from.lat, lng: from.lng },
        to: { name: to.name, lat: to.lat, lng: to.lng },
        mode: mode || undefined,
        routeName: routeName.trim() || undefined,
        fareInr: Number.isFinite(fareInr) ? fareInr : undefined,
        note: note.trim() || undefined,
      });
      setStatus('sent');
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 429 ? 'limited' : 'error');
    }
  };

  const field =
    'mt-1 h-11 w-full rounded-lg bg-white px-3 text-[16px] ring-1 ring-slate-300 focus:ring-2 focus:ring-teal-700 focus:outline-none';
  return (
    <form
      aria-label={t('Suggest a route')}
      className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm ring-1 ring-slate-200"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="font-semibold text-slate-900">
        {t('Suggest a route from {from} to {to}', { from: from.name, to: to.name })}
      </p>
      <div>
        <label htmlFor={`${id}-mode`} className="font-medium text-slate-800">
          {t('Vehicle')}
        </label>
        <select
          id={`${id}-mode`}
          value={mode}
          onChange={(e) => setMode(e.target.value as VehicleMode | '')}
          className={field}
        >
          <option value="">{t('Not sure')}</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_META[m].label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-name`} className="font-medium text-slate-800">
          {t('Name or number on the vehicle')}{' '}
          <span className="font-normal text-slate-500">{t('(optional)')}</span>
        </label>
        <input
          id={`${id}-name`}
          value={routeName}
          maxLength={80}
          onChange={(e) => setRouteName(e.target.value)}
          className={field}
        />
      </div>
      <div>
        <label htmlFor={`${id}-fare`} className="font-medium text-slate-800">
          {t('Usual fare in ₹')}{' '}
          <span className="font-normal text-slate-500">{t('(optional)')}</span>
        </label>
        <input
          id={`${id}-fare`}
          inputMode="numeric"
          value={fare}
          onChange={(e) => setFare(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className={field}
        />
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="font-medium text-slate-800">
          {t('Where to board, how often it runs')}{' '}
          <span className="font-normal text-slate-500">{t('(optional)')}</span>
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          maxLength={500}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className={`${field} h-auto py-2`}
        />
      </div>
      <p className="text-xs text-slate-600">
        {t(
          'We save the two places (to about 100 m) and what you write here, with no name or account. Please don’t include phone numbers.',
        )}
      </p>
      {(status === 'error' || status === 'limited') && (
        <p role="alert" className="text-rose-800">
          {status === 'limited'
            ? t('Too many suggestions from this connection. Please try again in a minute.')
            : t('Could not send. Check your connection and try again.')}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="min-h-11 rounded-lg bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {status === 'sending' ? t('Sending…') : t('Send suggestion')}
        </button>
        <button
          type="button"
          onClick={() => setStatus('closed')}
          className="min-h-11 rounded-lg px-4 font-semibold text-slate-700 hover:bg-slate-100"
        >
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}
