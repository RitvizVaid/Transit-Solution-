import type { PassengerQueueLevel, ReportKind, StandStatus } from '@transit/shared-types';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { authorizeReportToken, fetchStands, sendReport, watchStand } from './api';
import { ReportQueue } from './reportQueue';

const STAND_KEY = 'driver.standId.v1';

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const isOnline = () => navigator.onLine;

interface Action {
  kind: ReportKind;
  label: string;
  hindi: string;
  passengerCount?: number;
  className: string;
}

/** Big, bilingual, one-tap actions. Ordered by how often marshals use them. */
const ACTIONS: Action[] = [
  {
    kind: 'DEPARTING_NOW',
    label: 'Departing now',
    hindi: 'गाड़ी निकल रही है',
    className: 'bg-teal-700 text-white',
  },
  {
    kind: 'STAND_FULL',
    label: '10+ people waiting',
    hindi: '10+ सवारी इंतज़ार में',
    passengerCount: 10,
    className: 'bg-amber-500 text-slate-950',
  },
  {
    kind: 'STAND_FULL',
    label: '20+ people waiting',
    hindi: '20+ सवारी, बहुत भीड़',
    passengerCount: 20,
    className: 'bg-rose-600 text-white',
  },
  {
    kind: 'STAND_EMPTY',
    label: 'No passengers',
    hindi: 'कोई सवारी नहीं',
    className: 'bg-slate-200 text-slate-900',
  },
  {
    kind: 'HEAVY_TRAFFIC',
    label: 'Heavy traffic',
    hindi: 'भारी ट्रैफ़िक',
    className: 'bg-slate-800 text-white',
  },
];

const QUEUE_LABEL: Record<PassengerQueueLevel, string> = {
  empty: 'No queue',
  normal: 'Normal',
  crowded: 'Crowded',
  severe: 'Very crowded',
};

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function initialStand(): string | null {
  const fromQr = new URLSearchParams(location.search).get('stand');
  return fromQr || safeStorage()?.getItem(STAND_KEY) || null;
}

export function DispatchPage() {
  const [standId, setStandId] = useState<string | null>(initialStand);
  const [stands, setStands] = useState<StandStatus[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetchStands()
      .then(setStands)
      .catch(() => setLoadError(true));
  }, []);

  const choose = (id: string | null) => {
    setStandId(id);
    if (id) safeStorage()?.setItem(STAND_KEY, id);
    else safeStorage()?.removeItem(STAND_KEY);
    const url = new URL(location.href);
    if (id) url.searchParams.set('stand', id);
    else url.searchParams.delete('stand');
    history.replaceState(null, '', url);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-4 pb-[max(env(safe-area-inset-bottom),16px)]">
      {standId ? (
        <Reporter
          standId={standId}
          initial={stands?.find((s) => s.standId === standId) ?? null}
          unknown={!!stands && !stands.some((s) => s.standId === standId)}
          onChangeStand={() => choose(null)}
        />
      ) : (
        <StandPicker stands={stands} error={loadError} onPick={choose} />
      )}
    </main>
  );
}

function StandPicker({
  stands,
  error,
  onPick,
}: {
  stands: StandStatus[] | null;
  error: boolean;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const shown = (stands ?? []).filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <h1 className="text-2xl font-bold text-slate-900">Choose your stand</h1>
      <p className="mt-1 text-slate-600">अपना स्टैंड चुनें · or scan the QR code at the stand</p>
      <label className="mt-4 block">
        <span className="sr-only">Search stands</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stand name"
          className="h-12 w-full rounded-xl bg-slate-100 px-4 text-[16px] focus:bg-white focus:ring-2 focus:ring-teal-700 focus:outline-none"
        />
      </label>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-rose-900">
          Can&rsquo;t load stands. Check your connection and reopen the page.
        </p>
      )}
      {!stands && !error && <p className="mt-4 text-slate-500">Loading stands…</p>}
      <ul className="mt-3 space-y-2">
        {shown.map((s) => (
          <li key={s.standId}>
            <button
              type="button"
              onClick={() => onPick(s.standId)}
              className="w-full rounded-xl bg-white p-4 text-left text-lg font-medium text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              {s.name}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Reporter({
  standId,
  initial,
  unknown,
  onChangeStand,
}: {
  standId: string;
  initial: StandStatus | null;
  unknown: boolean;
  onChangeStand: () => void;
}) {
  const queue = useMemo(() => new ReportQueue(safeStorage()), []);
  const [liveStatus, setStatus] = useState<StandStatus | null>(null);
  const status = liveStatus ?? initial;
  const [pending, setPending] = useState(() => queue.list(standId).length);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);
  const [token, setToken] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => watchStand(standId, setStatus), [standId]);

  const flush = useCallback(async () => {
    if (!token) return null;
    const result = await queue.flush((report) => sendReport(report, token), standId);
    setPending(queue.list(standId).length);
    if (result.authorizationFailed) {
      setAuthorized(false);
      setToken('');
      setAuthError('This stand code is no longer valid. Enter a current code.');
    }
    return result;
  }, [queue, standId, token]);

  useEffect(() => {
    if (!authorized || !token) return;
    const timer = setInterval(() => void flush(), 15_000);
    const initialFlush = online ? setTimeout(() => void flush(), 0) : undefined;
    return () => {
      clearInterval(timer);
      if (initialFlush) clearTimeout(initialFlush);
    };
  }, [authorized, flush, online, token]);

  const unlock = async () => {
    if (!token.trim() || busy !== null) return;
    setBusy(-1);
    setAuthError(null);
    const result = await authorizeReportToken(standId, token.trim());
    if (result === 'ok') {
      setAuthorized(true);
      setToken(token.trim());
    } else {
      setAuthError(
        result === 'invalid'
          ? 'That code is not valid for this stand.'
          : 'Could not verify the code. Check your connection and try again.',
      );
    }
    setBusy(null);
  };

  const report = async (action: Action, index: number) => {
    if (busy !== null || !authorized) return;
    setBusy(index);
    navigator.vibrate?.(30);
    const { item, persisted } = queue.enqueue({
      reportId: crypto.randomUUID(),
      standId,
      kind: action.kind,
      passengerCount: action.passengerCount,
      reportedAt: new Date().toISOString(),
    });
    setPending(queue.list(standId).length);
    const result = await flush();
    if (result?.deliveredIds.includes(item.id)) setFlash(`Sent: ${action.label}`);
    else if (result?.expiredIds.includes(item.id))
      setFlash('This report expired before it could be sent. Please report the current condition.');
    else if (result?.rejectedIds.includes(item.id))
      setFlash('The server rejected this report. Please check the stand and try again.');
    else if (result?.authorizationFailed)
      setFlash('Stand code expired. Enter a current code before reporting again.');
    else if (!persisted) setFlash('Could not save this report. Reconnect and submit it again.');
    else setFlash('Saved on this device. Will send when connected.');
    // Short lock so one tap = one report, even with shaky hands.
    setTimeout(() => setBusy(null), 1500);
    setTimeout(() => setFlash(null), 3000);
  };

  if (unknown) {
    return (
      <div role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900">
        <p className="font-semibold">Unknown stand &ldquo;{standId}&rdquo;</p>
        <button
          type="button"
          onClick={onChangeStand}
          className="mt-3 rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white"
        >
          Choose a stand
        </button>
      </div>
    );
  }

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">Your stand</p>
          <h1 className="truncate text-2xl font-bold text-slate-900">{status?.name ?? standId}</h1>
        </div>
        <button
          type="button"
          onClick={onChangeStand}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
        >
          Change
        </button>
      </header>

      {status && (
        <section
          aria-label="Current stand status"
          className="mt-3 grid grid-cols-3 gap-2 text-center"
        >
          <Stat label="Wait" value={`~${status.averageWaitMinutes} min`} />
          <Stat
            label="Vehicles"
            value={
              status.source === 'reported' && status.availableVehiclesEstimate !== null
                ? String(status.availableVehiclesEstimate)
                : '–'
            }
          />
          <Stat label="Queue" value={QUEUE_LABEL[status.passengerQueueLevel]} />
        </section>
      )}

      {!authorized ? (
        <form
          className="mt-4 space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <label className="block text-sm font-semibold text-slate-800" htmlFor="stand-token">
            Stand reporting code
          </label>
          <input
            id="stand-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="h-12 w-full rounded-xl bg-white px-3 text-[16px] ring-1 ring-slate-300 focus:ring-2 focus:ring-teal-700 focus:outline-none"
            required
          />
          {authError && (
            <p role="alert" className="text-sm text-rose-800">
              {authError}
            </p>
          )}
          <button
            type="submit"
            disabled={busy !== null || !token.trim()}
            className="min-h-12 w-full rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {busy === -1 ? 'Verifying…' : 'Verify stand code'}
          </button>
          <p className="text-xs text-slate-600">
            Ask your stand coordinator for the private reporting code. Do not share it.
          </p>
        </form>
      ) : (
        <>
          {(!online || pending > 0) && (
            <p
              role="status"
              className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950"
            >
              {!online ? 'Offline. ' : ''}
              {pending > 0
                ? `${pending} report${pending > 1 ? 's' : ''} waiting to send.`
                : 'Reports will be saved.'}
            </p>
          )}

          <div className="mt-4 grid flex-1 content-start gap-3">
            {ACTIONS.map((a, i) => (
              <button
                key={a.label}
                type="button"
                onClick={() => void report(a, i)}
                disabled={busy !== null}
                className={`min-h-20 rounded-2xl px-5 py-4 text-left shadow-sm transition active:scale-[0.98] disabled:opacity-60 ${a.className}`}
              >
                <span className="block text-xl font-bold">{a.label}</span>
                <span className="block text-base opacity-90" lang="hi">
                  {a.hindi}
                </span>
              </button>
            ))}
          </div>

          <p aria-live="polite" className="mt-4 min-h-6 text-center font-semibold text-slate-800">
            {flash}
          </p>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-100 px-2 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}
