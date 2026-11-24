# @transit/web

Owners: **Contributor 1** (commuter UI, PWA) and **Contributor 2** (`src/map/`).
Vite + React 19 + TypeScript + Tailwind CSS v4, installable PWA (Workbox via `vite-plugin-pwa`).

```
src/
  pages/PlannerPage.tsx   page state: trip, tabs, sheet, geolocation, URL sync
  components/
    BottomSheet           draggable sheet (peek/half/full) on phones, side panel ≥ 768 px
    SearchPanel           from/to fields, swap, "use my location"
    LocationInput         place-search combobox (ARIA combobox + listbox, keyboard support)
    TripResults           loading / error / empty / results / recent trips
    ItineraryCard         duration, fare, leg chips, live wait, congestion; expands to LegTimeline
    LiveArrivalBadge      live stand wait (polled) with headway fallback
    NearbyLines           radius picker + lines within 100/300/500 m
    Banners               offline notice, install prompt
  hooks/                  usePlan, useGeocode, useGeolocation, useNearbyLines, useStandStatus, …
  lib/                    pure logic with unit tests: format, colour contrast, Photon parser,
                          URL encoding, recent-trips storage, nearby grouping, stand poller
  map/MapView.tsx         map placeholder + the MapViewProps contract for Contributor 2
  api.ts                  typed client for /api/v1
  config.ts               API base, geocoder, search bounds, polling intervals
```

## Run

```sh
pnpm dev                    # from the repo root: API + web + driver portal
pnpm --filter @transit/web test
pnpm --filter @transit/web build && pnpm --filter @transit/web preview   # test the PWA
```

The service worker only runs in `build` + `preview` (or production), not in `vite dev`.

## Environment

| Var                 | Default                    | Purpose                                         |
| ------------------- | -------------------------- | ----------------------------------------------- |
| `VITE_API_BASE`     | same origin                | API origin when the web app is hosted separately |
| `VITE_GEOCODER_URL` | `https://photon.komoot.io` | Photon-compatible geocoder                      |
| `API_URL`           | `http://localhost:3000`    | Dev/preview proxy target for `/api`             |

The public Photon instance is fine for development but has a fair-use policy. For the
pilot, self-host Photon or proxy it through the API with caching.

## How the informal-transit pieces work

- **No timetables.** Legs carry `frequencyMinutes`; cards say "every 3–5 min" instead of a departure time.
- **Live waits.** When a leg has `boardingStandId`, `LiveArrivalBadge` shows the stand's reported
  wait and vehicle count, pushed over the `/api/v1/live` WebSocket (`lib/live.ts`, shared by the
  map) the moment a marshal reports. `lib/standStore.ts` keeps one entry per stand and falls back
  to 30-s REST polling only while the socket is down. Reports older than 15 min show as stale
  (the badge ages on its own via `useNow`).
- **Offline.** The app shell is precached. `/api/v1/plan` is network-first with a cache
  fallback, and the last five trips (with results) are kept in `localStorage`, so a commuter can
  reopen a trip with no signal.
- **Shareable trips.** From/to are kept in the URL (`?from=lat,lng,Name&to=…`), so a stand can
  print a QR code with its own location as the origin.
- **Install.** The "Add to home screen" prompt appears only after a successful search, with an
  iOS-specific hint, and stays dismissed once closed.

## For Contributor 2 (map)

Replace the body of `MapView` in `src/map/MapView.tsx` with MapLibre. The page already passes
`origin`, `destination`, the selected `itinerary` (decode `Leg.geometryPolyline`, precision 5),
`userLocation`, the Nearby `center` + `radiusMeters`, and `insets` (use as map padding so routes
aren't hidden under the sheet). `onPick` is reserved for long-press to set a point.
