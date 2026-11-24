# Deployment

Three deployables: the **API** (container), the **commuter web app** and the **driver
portal** (static sites). OpenTripPlanner is optional.

## Option A: one host with Docker Compose (simplest pilot)

```sh
docker compose -f deploy/docker-compose.yml up -d --build
```

nginx in each web container serves the static build and proxies `/api` (HTTP and
WebSocket) to the API container, so everything is same-origin. Put a TLS-terminating proxy
(Caddy, Traefik, a cloud load balancer) in front of ports 8080 / 8081. **HTTPS is required**
for geolocation, service workers and "Add to Home Screen".

`SIMULATE=false` disables generated reports and vehicle positions. Stands without a recent
report are served as `source: "baseline"` (schedule estimate, no vehicle count) and the apps
label them that way. When `REPORT_TOKENS_JSON` is set, simulated reports are switched off
automatically (an explicit `SIMULATE_REPORTS=true` with tokens refuses to start), so real
reports are never mixed with synthetic ones; simulated vehicles may stay on for a demo and
are hidden on any route where a commuter is sharing a real ride. The pilot reporter flow requires
per-stand tokens and SQLite persistence; configure both before collecting field reports.
This is a single-API-instance design; do not scale the API horizontally with local SQLite.

## Option B: managed hosting

| Piece          | Where                                   | Build / run                                            |
| -------------- | --------------------------------------- | ------------------------------------------------------ |
| API            | Railway, Fly.io, Render, Cloud Run      | `deploy/Dockerfile.server` (port 3000, `/health`)      |
| Commuter web   | Vercel, Cloudflare Pages, Netlify       | `pnpm --filter @transit/web... build` → `apps/web/dist` |
| Driver portal  | same                                    | `pnpm --filter @transit/driver-portal... build` → `apps/driver-portal/dist` |

Static hosts need:

- `VITE_CITY` (default `delhi`): which entry of `apps/web/src/city.ts` to build for (search
  area, map centre, header label). Pair it with the API's `GTFS_DIR`; an unknown id fails the
  build.
- `VITE_API_BASE=https://api.your-domain` at build time (the apps then call the API and
  `wss://…/api/v1/live` directly).
- An SPA fallback to `index.html` (Vercel/Netlify/Pages do this for single-page apps;
  add a rewrite rule if yours doesn't).
- Do not cache `sw.js` at the CDN for long; hashed `/assets/*` can be cached forever.

The API needs:

| Env                   | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| `CORS_ORIGIN`         | the web app origin(s), e.g. `https://transit.example`        |
| `SIMULATE`            | `false` for a real pilot                                     |
| `REPORT_TOKENS_JSON`  | server-side JSON mapping each stand ID to a distinct random token (≥32 bytes) |
| `REPORT_DB_PATH`      | durable writable SQLite file; back up this data              |
| `ADMIN_TOKEN`         | optional, ≥32 bytes: lets reviewers read route suggestions    |
| `TRUST_PROXY`         | default `true` (client IP from `X-Forwarded-For`, needed behind nginx / Render for per-IP limits); set `false` if the API is exposed directly |
| `RATE_LIMIT`          | default on; `off` only for local end-to-end tests             |
| `OTP_URL`             | optional, see below                                           |
| `GTFS_DIR`            | already set in the image; rebuild after `pnpm data:build`    |
| `DELHI_OTD_API_KEY`   | optional API-server secret for Delhi bus positions; unset disables polling |

For local Docker Compose, set `REPORT_TOKENS_JSON` in an ignored `.env` file at the
repository root. Example shape (replace every placeholder with a random secret):

```dotenv
REPORT_TOKENS_JSON={"kg-auto-1":"<random-token-at-least-32-bytes>","odrs-1":"<another-random-token-at-least-32-bytes>"}
```

Give each marshal only the token for their stand. The driver portal asks for the token at
the selected stand and keeps it in memory only. Compose stores the SQLite database in the
`transit-state` named volume; managed hosts must mount a persistent volume at the configured
database directory and run a single API instance.

The platform must support WebSockets (all of the above do). Stand state is in memory:
run **one** API instance until `StandStore` is backed by Redis (see `apps/server/README.md`).
Shared rides and rate-limit counters are in memory too.

### Delhi bus positions

The optional feed polls the Delhi Open Transit Data vehicle-position endpoint every
30 seconds. Set `DELHI_OTD_API_KEY` only in the API server's secret environment, never
in a `VITE_` variable, source or browser. Review the
[provider terms](https://otd.delhi.gov.in/terms) and confirm access, redistribution,
attribution and polling limits before enabling it. Check `/health` for `delhiRealtime`
status; do not assume an `ok` poll means every bus is represented. Positions older
than 90 seconds or missing observation timestamps are omitted. The map attributes
the bus positions to Delhi Open Transit Data and distinguishes them from crowd reports.
This layer does not supply bus routes, trip plans or arrival predictions. The separately
configured planning network remains the unsurveyed demo until a suitable static feed
and timetable-aware routing are verified. Test provider compatibility privately with a
replacement key before deploying.

## OpenTripPlanner (optional)

The built-in planner covers the pilot. OTP adds street-accurate walking and scales to big
networks:

1. `pnpm data:package` → `deploy/otp/delhi-pilot-gtfs.zip`
2. Put an OSM extract for the area in `deploy/otp/` (e.g. a Delhi extract from BBBike or
   Geofabrik's northern-zone-india, clipped with osmium).
3. `OTP_URL=http://otp:8080 docker compose -f deploy/docker-compose.yml --profile otp up --build`
   (OTP needs ~4 GB RAM to build the graph.)

If OTP is unreachable or returns nothing, the API falls back to the built-in planner and
says so in the `x-planner` response header.

## Updating the network

1. Edit `data/geojson/`, run `pnpm data:build` (validates), commit `data/gtfs/`.
2. CI checks the committed feed matches its sources.
3. Redeploy the API (the feed is baked into the image) and re-package OTP if used.

## QR codes at stands (Sprint 4)

- Commuter app, origin pre-filled: `https://transit.example/?from=28.66620,77.22960,Kashmere%20Gate%20Auto%20Stand`
- Driver portal, stand pre-selected: `https://driver.transit.example/?stand=kg-auto-1`

Stand ids and coordinates are in `data/geojson/stops.geojson`.
