import type { ServerMessage, StandReport, StandStatus } from '@transit/shared-types';
import type { SendResult } from './reportQueue';

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

export async function fetchStands(): Promise<StandStatus[]> {
  const res = await fetch(`${API_BASE}/api/v1/stands`);
  if (!res.ok) throw new Error(`stands ${res.status}`);
  return (await res.json()) as StandStatus[];
}

export async function authorizeReportToken(
  standId: string,
  token: string,
): Promise<'ok' | 'invalid' | 'unavailable'> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/telemetry/session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return 'unavailable';
  }
  if (res.status === 401 || res.status === 403) return 'invalid';
  if (!res.ok) return 'unavailable';
  let body: { standId: string };
  try {
    body = (await res.json()) as { standId: string };
  } catch {
    return 'unavailable';
  }
  return body.standId === standId ? 'ok' : 'invalid';
}

/** Only retry transient failures; report IDs make retries idempotent. */
export async function sendReport(report: StandReport, token: string): Promise<SendResult> {
  const res = await fetch(`${API_BASE}/api/v1/telemetry/reports`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(report),
  });
  if (res.ok) return { status: 'ok' };
  if (res.status === 401 || res.status === 403) return { status: 'drop', reason: 'authorization' };
  if (res.status === 410) return { status: 'drop', reason: 'expired' };
  if (
    res.status === 409 ||
    (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
  )
    return { status: 'drop', reason: 'rejected' };
  return { status: 'retry' };
}

/** Live status for one stand. Returns an unsubscribe function. */
export function watchStand(standId: string, onStatus: (s: StandStatus) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const url = API_BASE
    ? `${API_BASE.replace(/^http/, 'ws')}/api/v1/live`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/live`;

  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      ws?.send(JSON.stringify({ type: 'subscribe.stands', standIds: [standId] }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.type === 'stand.status' && msg.payload.standId === standId) onStatus(msg.payload);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (!closed) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
    };
    ws.onerror = () => ws?.close();
  };
  connect();

  return () => {
    closed = true;
    clearTimeout(timer);
    ws?.close();
  };
}
