# @transit/server

Owner: **Contributor 3**. Fastify + TypeScript. Routes on the GTFS feed in
`data/gtfs/delhi-pilot/`; contract in [docs/API_SPEC.md](../../docs/API_SPEC.md);
interactive OpenAPI docs at **`/docs`** when running.

```
src/
  app.ts               buildApp(): loads the feed, wires services, plugins, routes, simulator
  config.ts            env → ServerConfig
  gtfs/
    csv.ts             RFC 4180 parser
    network.ts         TransitNetwork: stops (grid index), routes, directional patterns, fares
  services/
    planner.ts         built-in frequency-aware planner (walk → ride → [walk] → ride → walk)
    otp.ts             OpenTripPlanner 2 GraphQL client → our DTOs
    planService.ts     OTP when configured, built-in otherwise / on OTP failure
    fares.ts           distance fare engine (min fare + per km, rounded up to ₹5)
    stands.ts          live stand state from driver/marshal reports
    simulator.ts       synthetic vehicles + reports for demos
    geo.ts, time.ts    haversine, polylines, measured lines; IST clock
  websocket/hub.ts     /api/v1/live fan-out with viewport / stand subscriptions
  routes/              health, plan, network, stands, telemetry, live
```

## How planning works

Informal vehicles leave when full, not on a clock, so the planner ranks options by
**expected** time: walking (straight line × 1.25 at 4.5 km/h) + expected wait (live stand
report, else half the mean headway) + in-vehicle time (from `stop_times`) + a 3-min penalty
per transfer. It considers every boarding stop within 800 m, alighting within 800 m of the
destination, at most one transfer (walks ≤ 400 m between stops), and walking the whole way
(≤ 2.5 km). It drops rides under 500 m, transfers beaten by a direct ride on one of their
routes, and duplicates; returns up to 3 within 1.6× (+10 min) of the best.

Fares: each ride is a separate ticket, `max(min, min + (km − base_km) × per_km)` rounded up to ₹5.

## Live data

- `POST /api/v1/telemetry/reports` (driver portal) updates `StandStore`; each change is pushed
  to WebSocket subscribers and immediately affects plans (waits, congestion). Tokens are
  provisioned per stand through `REPORT_TOKENS_JSON`; reports are persisted in SQLite and
  recent reports are restored on startup.
- Departure reports measure the real headway (≥ 3 departures). Reports older than 30 min fall
  back to the schedule baseline, keeping the honest `lastUpdated`.
- With `SIMULATE=true`, vehicles move along their shapes at their headways and a random stand
  report arrives every ~10 s.

Stand status is in memory and backed by the recent persisted report history, so run one API
instance with a durable writable SQLite path. SQLite prevents duplicate and out-of-order
reports; it does not coordinate multiple API instances.

## Env

| Var           | Default                         | Purpose                                  |
| ------------- | ------------------------------- | ---------------------------------------- |
| `PORT`/`HOST` | `3000` / `0.0.0.0`              |                                          |
| `GTFS_DIR`    | `../../data/gtfs/delhi-pilot`   | Feed to load                             |
| `OTP_URL`     | unset                           | e.g. `http://otp:8080`; unset = built-in |
| `SIMULATE`    | `true` unless `NODE_ENV=production` | synthetic vehicles + reports         |
| `CORS_ORIGIN` | any                             | allowed browser origin                   |
| `REPORT_TOKENS_JSON` | unset                    | JSON object mapping stand IDs to private tokens (min. 32 bytes) |
| `REPORT_DB_PATH` | `.local/reports.sqlite`       | durable SQLite file for accepted reports |

Generate a distinct random token per stand, keep it in server-side environment configuration,
and provide only that stand's token to its marshal. Reports require a token, stable report ID,
and event timestamp; retries are idempotent, reports older than 30 minutes are rejected, and
reports older than the latest accepted event for the stand are rejected.
