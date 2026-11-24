# Transit API v1

Base path `/api/v1`. JSON over HTTP; live updates over WebSocket.
**Source of truth for every payload: [`packages/shared-types`](../packages/shared-types/src).**
Interactive OpenAPI docs: `GET /docs` on a running server (`/docs/json` for the document).

Changing a type in `shared-types` needs a review from each contributor who consumes it.

| Method | Path                         | Returns                                |
| ------ | ---------------------------- | -------------------------------------- |
| GET    | `/health`                    | feed version, counts, planner, clients |
| GET    | `/api/v1/plan`               | `PlanResponse` (+ `x-planner` header)  |
| GET    | `/api/v1/routes`             | `TransitRoute[]`                       |
| GET    | `/api/v1/stops/nearby`       | `NearbyStopsResponse`                  |
| GET    | `/api/v1/stands`             | `StandStatus[]`                        |
| GET    | `/api/v1/stands/:standId`    | `StandStatus` or 404                   |
| POST   | `/api/v1/telemetry/reports`  | 202 `{ accepted, stand }`, 404 unknown stand |
| WS     | `/api/v1/live`               | `ServerMessage` stream                 |

## GET /api/v1/plan

| Query      | Required | Notes                                          |
| ---------- | -------- | ---------------------------------------------- |
| `fromLat`, `fromLng` | yes | -90..90 / -180..180                    |
| `toLat`, `toLng`     | yes |                                        |
| `fromName`, `toName` | no  | echoed into the first / last leg (≤ 120 chars) |
| `departAt` | no       | ISO 8601; defaults to now. Decides which routes are in service |
| `mode`     | no       | reserved                                       |

```
GET /api/v1/plan?fromLat=28.6675&fromLng=77.2282&toLat=28.6555&toLng=77.23&fromName=Kashmere%20Gate%20Metro
```

Up to 3 itineraries, fastest expected time first, at most one transfer.
`x-planner: otp | builtin` says which engine answered.

- `Itinerary.durationSeconds` = walking + **expected waits** + riding. Waits are not legs:
  `duration − walkTime − transitTime` is the total expected wait.
- `Itinerary.estimatedFare`: sum of separate tickets per ride (informal modes don't share fares).
- `Itinerary.congestionLevel`: `low | moderate | high` from expected wait and the boarding stand's queue.
- `Leg.mode`: `WALK | AUTO_RICKSHAW | E_RICKSHAW | SHARED_TAXI | MINIBUS | BUS`
- `Leg.frequencyMinutes`: `{ min, max }` headway range.
- `Leg.boardingStandId`: set when the leg boards at a marshalled stand → poll it or subscribe live.
- `Leg.geometryPolyline`: Google encoded polyline, precision 5. Rides follow the route shape;
  walks are straight lines (built-in planner) or street paths (OTP).

Errors: **400** for missing/out-of-range coordinates or an unparseable `departAt`.
An empty `itineraries` array means no route serves the trip at that time.

## Network

`GET /api/v1/routes` → `TransitRoute[]`: id, shortName, longName, mode, color, frequencyMinutes,
serviceHours. Changes only with a new feed; clients may cache.

`GET /api/v1/stops/nearby?lat=&lng=&radius=` → `{ stops: NearbyStop[] }`, nearest first.
`radius` in metres, 1–2000, default 300. Each stop lists `routeIds` and `isVirtual`
(informal pick-up point without a marked stop).

## Stands

`StandStatus`: `standId`, `name`, `coordinates` (`[lng, lat]`), `availableVehiclesEstimate`,
`passengerQueueLevel` (`empty | normal | crowded | severe`), `averageWaitMinutes`,
`lastUpdated` (time of the last report, or of feed load if none).

Without reports a stand shows its schedule baseline (wait ≈ half the shortest mean headway).
Reports older than 30 minutes revert to that baseline; `lastUpdated` stays the real report
time so clients can show "last report 40 min ago".

## POST /api/v1/telemetry/reports

```json
{ "standId": "kg-auto-1", "kind": "STAND_FULL", "passengerCount": 12, "reportedAt": "2026-12-01T09:00:00+05:30" }
```

| `kind`          | Effect                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| `DEPARTING_NOW` | one fewer vehicle, queue eases; 3+ recent departures set wait = measured headway ÷ 2 |
| `STAND_FULL`    | queue crowded (severe on repeat or `passengerCount ≥ 20`), no vehicles, wait ≥ 2× baseline |
| `STAND_EMPTY`   | queue empty, one more vehicle waiting, wait back to baseline               |
| `HEAVY_TRAFFIC` | wait × 1.5 + 1 min                                                          |

Timestamps more than a minute in the future are replaced by the server time.
Responses: **202** with the updated stand, **404** unknown stand, **400** invalid body.

## WebSocket /api/v1/live

Client → server (`ClientMessage`):

```json
{ "type": "subscribe.bbox", "bbox": [77.20, 28.62, 77.26, 28.68] }
{ "type": "subscribe.stands", "standIds": ["kg-auto-1", "isbt-mini-1"] }
{ "type": "unsubscribe" }
```

Server → client (`ServerMessage`): a snapshot of matching stands (and vehicles for a bbox)
right after subscribing, then:

```json
{ "type": "stand.status", "payload": { "standId": "kg-auto-1", "...": "StandStatus" } }
{ "type": "vehicle.position", "payload": { "vehicleId": "KG-1-d0#53", "routeId": "KG-1", "mode": "AUTO_RICKSHAW", "coordinates": [77.2301, 28.6612], "bearing": 178, "speedKmh": 14, "timestamp": "…" } }
```

Vehicle positions come every ~2 s (simulated until driver GPS is live). A bbox subscription
replaces the previous bbox; a stands subscription replaces the previous stand list; both can
be active at once.

## Conventions

- Coordinates: objects use `{ lat, lng }`; tuples use `[lng, lat]` (GeoJSON).
- Times: ISO 8601 with offset; the service day is IST (UTC+05:30).
- Durations in seconds, distances in metres, headways in minutes, money as `{ currency, amount }`.
- Errors: non-2xx with `{ error: "<code>" }`, or Fastify's validation error shape for 400s.
