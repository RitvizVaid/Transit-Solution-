# Development log

Running log of the build, kept while working through every contributor role in
[GAME_PLAN.md](GAME_PLAN.md). Newest entries at the bottom of each day.
Each entry: **who** (role) · **what** · **why** · **verified how**.

Roles: **C1** commuter UI & PWA · **C2** map & geospatial · **C3** API, routing, real-time ·
**C4** data & GTFS · **C5** DevOps, QA, driver portal.

---

## 2026-11-24

### Step 1 · Repository reorganisation (all)
- Moved the cloned Flutter repo to `legacy/trufi-core-flutter/` with history (1,287 renames).
- Created pnpm workspace: `apps/web`, `apps/server`, `apps/driver-portal`, `packages/shared-types`,
  plus `data/`, `deploy/`, `docs/`, CI workflow.
- Decisions: Vite + React (static PWA, no SSR needed); Fastify + TypeScript so the API shares types.
- Verified: typecheck, tests, builds, `docker compose up` smoke test through nginx.
- Committed by Nitish as `ae0c3bb` on `infra/monorepo-reorg`.

### C1 · Commuter UI & PWA
- Bottom-sheet layout (peek/half/full, drag + keyboard; side panel ≥ 768 px).
- From/To place search (Photon, debounced, Delhi NCR bbox, ARIA combobox), GPS, swap.
- Itinerary cards + step timeline; live stand wait badge with headway fallback.
- Nearby lines tab (100/300/500 m). PWA: precache, network-first plans, recent trips offline,
  install prompt after first success. Trip kept in the URL (shareable / stand QR codes).
- Contract change: optional `Leg.boardingStandId` (shared-types) → flagged for C2/C3 review.
- Verified: 47 web unit tests; CDP-driven headless Chrome at 390×844 for results, nearby,
  search → pick → plan, and offline reload.
- Branch `feat/c1-itinerary-ui` (uncommitted).

### C4 · Informal transit data pipeline & GTFS
- **Source of truth** in `data/geojson/`: `stops.geojson` (23 boarding points: 10 marshalled
  stands, 8 informal pick-up points) + `routes/*.geojson` (7 corridors: KG-1, GR-2, CC-RF, M-14,
  JM-3, NR-5, CL-6) with headway range, service hours, average speed and distance fare model.
- Contract change: added `E_RICKSHAW` to `LEG_MODES` (e-rickshaws dominate Old Delhi last-mile).
- `data/pipelines/gtfs_pipeline` (stdlib-only Python, no installs):
  - `build`: one template trip per direction + `frequencies.txt` (`exact_times=0`); running time
    from distance along shape ÷ speed + 20 s dwell; extended route types (1501 communal taxi, 3 bus);
    extension columns `informal_mode`, headway range, `is_stand`, `informal_stop`, and
    `informal_fares.txt` (min fare + per-km beyond a base distance).
  - `validate`: references, times monotonic, frequencies, shapes, fares, coordinates.
  - `cluster`: DBSCAN over boarding GPS points → candidate virtual stops (GeoJSON).
  - `package`: validate + zip into `deploy/otp/` for OpenTripPlanner.
- Root scripts: `pnpm data:build | data:test | data:package`.
- Why stdlib-only: anyone on the team can rebuild the feed on a fresh laptop; pandas/geopandas
  were overkill at this size.
- Verified: feed validates with 0 errors / 0 warnings; 18 Python unit tests (geometry, build
  invariants, corridor error reporting, validator negatives, clustering on synthetic points).
- Caveat: geometry is hand-traced and headways/fares are plausible estimates, not surveyed.

### C3 · Backend API, routing engine & real-time
- Replaced all fixtures with services on the real feed (`apps/server/src/`):
  - `gtfs/network.ts`: loads GTFS + our extensions; directional patterns with running time and
    shape distance per stop; grid spatial index for nearby queries.
  - `services/planner.ts`: **built-in frequency-aware planner**: access/egress ≤ 800 m, ≤ 1 transfer
    (walk ≤ 400 m), expected wait = live stand wait else headway/2, transfer penalty 3 min,
    walk-only ≤ 2.5 km, service-hours aware (IST). Drops rides < 500 m and transfers beaten by a
    direct ride on one of their routes. Why: OTP 2 needs Java 21 + an OSM street graph (not
    available locally); the built-in planner is also the fallback when OTP is down.
  - `services/otp.ts` + `planService.ts`: OTP 2 GraphQL client mapped to our DTOs (informal modes,
    our fares, stands); used when `OTP_URL` is set, falls back to built-in on error/timeout.
  - `services/fares.ts`: per-ride distance fares rounded up to ₹5; separate tickets per ride.
  - `services/stands.ts`: live stand state from reports (measured headway from departures,
    full/empty/traffic effects, 30-min TTL to baseline); emits changes → plans + WebSocket.
  - `websocket/hub.ts` + `routes/live.ts`: `/api/v1/live` with bbox and stand subscriptions.
  - `services/simulator.ts`: deterministic synthetic vehicles along shapes + random marshal reports
    (`SIMULATE`, on by default outside production) so demos show live data.
  - OpenAPI via `@fastify/swagger` at `/docs`; `/health` reports feed + planner.
- Contract change: optional `PlanRequest.fromName/toName` (names echoed into first/last legs).
- Deploy: server image bakes in the GTFS feed + healthcheck; compose drops unused Redis, makes
  `OTP_URL` opt-in, `SIMULATE` on for demos.
- Sanity-checked plans by hand: KG Metro→Chandni Chowk = KG-1 (13 min, ₹20); Civil Lines→Red Fort =
  CL-6 + M-14; KG Metro→Red Fort = M-14 direct, then KG-1 + CC-RF.
- Verified: 46 server tests (CSV, network, geo, fares, IST clock, stand rules, planner scenarios
  incl. transfers/night/out-of-area/live waits, OTP mapping + fallback with mocked fetch,
  simulator, hub filtering, HTTP routes, OpenAPI, real WebSocket round-trip).
- Not verified: against a live OTP instance (no Java 21/OSM extract here) — client is unit-tested only.

### C2 · Geospatial & interactive map
- `apps/web/src/map/TransitMap.tsx`: MapLibre GL 6 + OpenFreeMap vector style (free, keyless).
  Layers: selected itinerary (rides in route colour with white casing, walks dotted grey),
  Nearby radius circle, live stands (queue colour, dark ring, tap → status popup), live vehicles
  (route colour). DOM markers for start / destination / user location.
- Long-press (touch) / right-click (mouse) → "Start here / Go here"; name filled by Photon reverse
  geocoding (`pickPoint` in PlannerPage).
- `lib/live.ts`: one shared, ref-counted WebSocket with exponential backoff + jitter; re-sends
  viewport and stand subscriptions after reconnects. `standStore` now uses it as the primary feed
  and polls only while the socket is down (C1 Sprint 3 item).
- `vehicleAnimator.ts`: interpolates between 2-s pings, prunes silent vehicles; honours
  `prefers-reduced-motion`.
- Map is lazy-loaded behind Suspense + an error boundary (no WebGL → placeholder; planner keeps
  working). Initial JS stays ~84 KB gz; map chunk ~300 KB gz. Tiles cached cache-first for offline.
- Bugs found while testing in headless Chrome and fixed:
  1. "Worker failed to load": MapLibre 6 resolves its worker via `import.meta.url`, broken by
     bundling → ship worker as a Vite `?url` asset + `setWorkerUrl`.
  2. Map 300 px tall: MapLibre's CSS forces `position: relative` on the container, overriding
     `absolute inset-0` → size the container with `h-full w-full`.
- Note: port 3000 was already used by a `pnpm dev` server on this machine, so I tested on
  3100/4174 and left that process alone.
- Verified: 8 new unit tests (polyline, GeoJSON, bounds, circle, animator, ws URL/backoff);
  screenshots at 390×844 show the M-14 route framed above the sheet, simulated vehicles moving
  along corridors, coloured stands, and the 300 m Nearby circle.

### C5 · DevOps, QA & driver/operator hub
- **Driver portal** (`apps/driver-portal`): stand from QR (`?stand=`) or searchable list,
  remembered; five big bilingual (English/Hindi) buttons incl. 10+ / 20+ waiting; 1.5 s tap lock +
  haptic tick; live stand status pushed back over WebSocket; **offline outbox**
  (`reportQueue.ts`): queue first, send in order, flush on `online` / 15 s / open, keep original
  `reportedAt`, drop 4xx and > 30-min-old reports. Unknown-stand (bad QR) screen.
- **Lint**: oxlint (`pnpm lint`, warnings fail). Why not ESLint: typescript-eslint supports
  TypeScript < 6.1 and this repo is on TypeScript 7 (native, no JS API). Triage: fixed real
  findings (impure `Date.now()` in render → `useNow`; refs written during render → `useEffectEvent`;
  sync setState in effects → derived state in `useGeocode`, `useNearbyLines`, `usePlan`,
  `LocationInput`, `PlannerPage`; a non-hook named `use…`); disabled style-only rules with reasons
  in `.oxlintrc.json`; two documented suppressions (combobox options, outbox flush).
- **E2E** (`e2e/`, Playwright, 17 tests, mobile Pixel 7 + desktop): deep link → itineraries &
  timeline; search → keyboard pick → plan (Photon stubbed); Nearby radius; live WebSocket badge
  update after a report; offline reload; no horizontal overflow; API docs; driver report → server
  state + live feedback; offline outbox then delivery; bad-QR stand. Map tiles blocked in tests.
- **Bug found by E2E and fixed**: vite-plugin-pwa 2 no longer adds `clientsClaim` for
  `autoUpdate`, so on a first visit the service worker didn't control the page and the app would
  not open offline until a second visit → `clientsClaim: true` + `skipWaiting: true`.
- **CI** (`.github/workflows/ci.yml`): `check` (format, lint, typecheck, unit tests, build),
  `data` (pipeline tests + committed feed must equal a fresh build), `e2e` (Chromium, traces
  uploaded on failure), `docker` (compose build). `.gitattributes` pins LF for GTFS/GeoJSON so the
  byte comparison is stable on Windows checkouts.
- **Deploy**: `docs/DEPLOYMENT.md` (compose on one host, or static hosts + container API; env,
  CORS, WebSockets, single-instance note, OTP steps, stand QR URLs).
- Verified: compose stack up on alternate ports: server `healthy`, plan through nginx, 101 live
  WebSocket messages through nginx in 5 s; driver portal tested in headless Chrome (report →
  server `severe` → pushed back to the marshal's screen).

### End of day · status
| Gate | Result |
| --- | --- |
| `pnpm format:check` · `pnpm lint` · `pnpm typecheck` | pass |
| `pnpm test` | 110 passed (server 46, web 57, driver 5, shared-types 2) |
| `pnpm data:test` | 18 passed; feed build is byte-for-byte reproducible |
| `pnpm build` | pass (web first paint ~84 KB gz JS; map chunk ~300 KB gz, lazy) |
| `pnpm e2e` | 17 passed (mobile + desktop, local Chrome) |
| Docker compose | images build; stack healthy; HTTP + WebSocket through nginx |

**Open items / next**
- C4: replace hand-traced geometry, headways and fares with field surveys (GPX ride-alongs,
  boarding-point clustering, stand departure logs). Add more corridors.
- C3: real driver GPS ingestion (replace simulator); Redis-backed `StandStore` for >1 instance;
  rate limiting / simple auth for the report endpoint before public launch.
- C3/C5: verify the OTP path against a live OTP 2.7 with a Delhi OSM extract (unit-tested only).
- C1: Hindi UI for the commuter app (driver portal is already bilingual); saved favourite places.
- C5: production hosting + TLS, error monitoring, stand QR code sheet generator.
- Nothing is committed: all work sits on `feat/c1-itinerary-ui` on top of `ae0c3bb`.
