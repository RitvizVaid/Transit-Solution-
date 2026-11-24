import type { StandStatus } from '@transit/shared-types';
import { fetchStand, isAbortError } from '../api';
import { config } from '../config';
import { live } from './live';

/**
 * Live stand status shared by every component that shows a stand.
 *
 * Primary feed: the /api/v1/live WebSocket (pushes each report as it happens).
 * Fallback: REST polling every 30 s, only while the socket is down and the tab is
 * visible. One fetch on first subscribe so cards fill in immediately either way.
 */
export type StandSnapshot =
  { status: 'loading' } | { status: 'ok'; stand: StandStatus } | { status: 'error' };

interface Entry {
  listeners: Set<() => void>;
  snapshot: StandSnapshot;
  timer?: ReturnType<typeof setInterval>;
  ctrl?: AbortController;
}

const LOADING: StandSnapshot = { status: 'loading' };
const entries = new Map<string, Entry>();
let releaseLive: (() => void) | null = null;

function publish(entry: Entry, snapshot: StandSnapshot) {
  entry.snapshot = snapshot;
  entry.listeners.forEach((l) => l());
}

function refresh(standId: string, entry: Entry) {
  entry.ctrl?.abort();
  const ctrl = new AbortController();
  entry.ctrl = ctrl;
  fetchStand(standId, ctrl.signal)
    .then((stand) => publish(entry, { status: 'ok', stand }))
    .catch((err: unknown) => {
      if (isAbortError(err)) return;
      // Keep the last good value; only show an error if we never had one.
      if (entry.snapshot.status !== 'ok') publish(entry, { status: 'error' });
    });
}

const hidden = () => typeof document !== 'undefined' && document.hidden;

function startPolling(standId: string, entry: Entry) {
  if (entry.timer || live.isOpen || hidden()) return;
  entry.timer = setInterval(() => refresh(standId, entry), config.standPollMs);
}

function stopPolling(entry: Entry) {
  clearInterval(entry.timer);
  entry.timer = undefined;
}

function syncSubscriptions() {
  live.setStands(entries.keys());
}

live.onStand((stand) => {
  const entry = entries.get(stand.standId);
  if (entry) publish(entry, { status: 'ok', stand });
});

live.onOpenChange((open) => {
  for (const [id, entry] of entries) {
    if (open) stopPolling(entry);
    else startPolling(id, entry);
  }
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    for (const [id, entry] of entries) {
      if (document.hidden) stopPolling(entry);
      else {
        refresh(id, entry);
        startPolling(id, entry);
      }
    }
  });
}

export function subscribeStand(standId: string, listener: () => void): () => void {
  let entry = entries.get(standId);
  if (!entry) {
    entry = { listeners: new Set(), snapshot: LOADING };
    entries.set(standId, entry);
    releaseLive ??= live.retain();
    syncSubscriptions();
    refresh(standId, entry);
    startPolling(standId, entry);
  }
  entry.listeners.add(listener);

  const e = entry;
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0) {
      stopPolling(e);
      e.ctrl?.abort();
      entries.delete(standId);
      syncSubscriptions();
      if (entries.size === 0) {
        releaseLive?.();
        releaseLive = null;
      }
    }
  };
}

export function getStandSnapshot(standId: string): StandSnapshot {
  return entries.get(standId)?.snapshot ?? LOADING;
}
