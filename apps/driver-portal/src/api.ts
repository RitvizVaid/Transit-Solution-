import type { ServerMessage, StandReport, StandStatus } from '@transit/shared-types';

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

export async function fetchStands(): Promise<StandStatus[]> {
  const res = await fetch(`${API_BASE}/api/v1/stands`);
  if (!res.ok) throw new Error(`stands ${res.status}`);
  return (await res.json()) as StandStatus[];
}

/** 202 → delivered; 4xx → the server will never accept it (drop); else retry later. */
export async function sendReport(report: StandReport): Promise<'ok' | 'retry' | 'drop'> {
  const res = await fetch(`${API_BASE}/api/v1/telemetry/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (res.ok) return 'ok';
  return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
    ? 'drop'
    : 'retry';
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
