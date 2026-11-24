# @transit/driver-portal

Owner: **Contributor 5**. One-screen mobile web app for stand marshals and drivers.

- **Stand**: from the QR code at the stand (`?stand=kg-auto-1`), else pick from the list;
  remembered on the phone.
- **Reports**: big bilingual (English / Hindi) buttons → `POST /api/v1/telemetry/reports`:
  Departing now · 10+ waiting · 20+ waiting · No passengers · Heavy traffic.
  1.5 s lock after each tap (one tap = one report), haptic tick where supported.
- **Feedback**: the stand's live wait / vehicles / queue, pushed over `/api/v1/live`, so the
  marshal sees the effect of their report.
- **Offline outbox** (`src/reportQueue.ts`): every report is queued in localStorage first,
  then sent in order; flushed on `online`, every 15 s and on open. Keeps the original
  `reportedAt`; drops reports older than 30 min or rejected by the server (4xx).

`pnpm dev:driver` → http://localhost:5174 (proxies `/api` incl. WebSocket to the API).
`VITE_API_BASE` when hosted on a different origin from the API.
