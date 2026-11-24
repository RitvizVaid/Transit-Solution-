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
| POST   | `/api/v1/telemetry/session` | verify bearer token and return its stand |
| POST   | `/api/v1/telemetry/reports`  | authenticated report; 202 accepted, 200 duplicate |
| POST   | `/api/v1/rides/positions`    | rider shares their vehicle's position; `RidePositionResponse` |
| POST   | `/api/v1/rides/end`          | rider stops sharing; 204             |
| GET    | `/api/v1/arrivals`           | `ArrivalsResponse`: shared vehicles heading to a stop |
| POST   | `/api/v1/suggestions`        | commuter route suggestion; 202, held for review |
| GET    | `/api/v1/suggestions`        | pending suggestions; reviewer bearer token |
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

- `Itinerary.durationSeconds` = walking + **expected waits** + riding. Each ride's wait is
  half its route's headway; a stand report still in effect scales that by how the stand
  compares with its baseline (e.g. a full stand doubles each route's own wait). A route is
  only offered if it is still running when the rider reaches it. Waits are not legs:
  `duration − walkTime − transitTime` is the total expected wait.
- `Itinerary.estimatedFare`: sum of separate tickets per ride (informal modes don't share fares).
- `Itinerary.congestionLevel`: `low | moderate | high` from expected wait and the boarding stand's queue.
- `Leg.mode`: `WALK | AUTO_RICKSHAW | E_RICKSHAW | SHARED_TAXI | MINIBUS | BUS`
- `Leg.frequencyMinutes`: `{ min, max }` headway range.
- `Leg.routeId`: network route id on ride legs (absent for walks and unknown OTP routes);
  use it to share a ride on that route.
- `Leg.fromStopId`, `Leg.toStopId`: network stops where the ride boards and gets off (they fix
  the direction); use them with `GET /arrivals`.
- `Leg.boardingStandId`: set when the leg boards at a marshalled stand → poll it or subscribe live.
- `Leg.geometryPolyline`: Google encoded polyline, precision 5. Rides follow the route shape;
  walks are straight lines (built-in planner) or street paths (OTP).

Errors: **400** for missing/out-of-range coordinates or an unparseable `departAt`.
An empty `itineraries` array means the configured planner found no itinerary for the
request. It does not establish that no real-world service exists. It then carries
`noRouteReason`, the most specific explanation the data supports:

| `noRouteReason` | Meaning |
| --- | --- |
| `no_stops_near_origin` | no known stop within walking distance (800 m) of the start |
| `no_stops_near_destination` | none near the destination |
| `outside_service_hours` | stops near both ends, but none of their routes run now |
| `no_connection` | routes run near both ends, but no connection was found |

**429** with `Retry-After` when one client IP sends more than 120 plans a minute.

## Network

`GET /api/v1/routes` → `TransitRoute[]`: id, shortName, longName, mode, color, frequencyMinutes,
serviceHours. Changes only with a new feed; clients may cache.

`GET /api/v1/stops/nearby?lat=&lng=&radius=` → `{ stops: NearbyStop[] }`, nearest first.
`radius` in metres, 1–2000, default 300. Each stop lists `routeIds` and `isVirtual`
(informal pick-up point without a marked stop).

## Stands

`StandStatus`: `standId`, `name`, `coordinates` (`[lng, lat]`), `source`,
`availableVehiclesEstimate`, `passengerQueueLevel` (`empty | normal | crowded | severe`),
`averageWaitMinutes`, `lastReportedAt`, `expiresAt`, `lastUpdated`.

- `source: "baseline"`: no report in effect. Values are the schedule estimate (wait ≈ half the
  shortest mean headway), nobody observed them: `availableVehiclesEstimate` and `expiresAt`
  are `null`. Clients must not present these as live.
- `source: "reported"`: shaped by a marshal report within the last 30 minutes
  (`STAND_REPORT_TTL_MS`); `expiresAt` says when it reverts. `availableVehiclesEstimate` is
  only a number when the reports give a basis for one (e.g. after "stand empty").
- `lastReportedAt` is the last accepted report even after it expired (so clients can say
  "last report 40 min ago"); `null` if the stand never had one. `lastUpdated` is kept for
  older clients (last report, or feed load time).

When a report expires the server pushes the reverted `stand.status` to live subscribers
(within ~2 s), so open apps do not keep showing it.

## POST /api/v1/telemetry/reports

```json
{ "reportId": "uuid", "standId": "kg-auto-1", "kind": "STAND_FULL", "passengerCount": 12, "reportedAt": "2026-12-01T09:00:00+05:30" }
```

Both telemetry endpoints require `Authorization: Bearer <stand-token>`. The report token
must belong to the same stand named in the payload. Tokens are configured server-side in
`REPORT_TOKENS_JSON` as a JSON object mapping stand IDs to distinct secrets of at least
32 bytes. `/telemetry/session` verifies a token and returns `{ "standId": "..." }`.

| `kind`          | Effect                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| `DEPARTING_NOW` | one fewer vehicle, queue eases; 3+ recent departures set wait = measured headway ÷ 2 |
| `STAND_FULL`    | queue crowded (severe on repeat or `passengerCount ≥ 20`), no vehicles, wait ≥ 2× baseline |
| `STAND_EMPTY`   | queue empty, one more vehicle waiting, wait back to baseline               |
| `HEAVY_TRAFFIC` | wait × 1.5 + 1 min                                                          |

Timestamps more than a minute in the future are replaced by the server time. Reports older
than 30 minutes return **410**; out-of-order reports and a reused ID with different content
return **409**. Repeating an identical report ID and payload returns **200** without applying
the report twice. A new accepted report returns **202** with the updated stand. Invalid body
returns **400**, invalid/missing token **401**, and a token for another stand **403**.
Reporting with no configured tokens returns **503**. More than 30 reports a minute for one
stand returns **429**; `/telemetry/session` allows 20 attempts a minute per IP.

## Crowd-shared rides

A commuter riding a shared auto, e-rickshaw, taxi or minibus can let their phone report
where the vehicle is. No account is needed. The phone sends a fix about every 5 s:

```json
POST /api/v1/rides/positions
{ "rideId": "random-id-made-on-the-phone", "routeId": "KG-1", "coordinates": [77.2302, 28.66], "accuracyM": 12, "recordedAt": "2026-12-01T10:00:00+05:30" }
```

`occupancy` is optional: `seats_available | standing_only | full`, the rider's answer to "how
full is it?". It sticks to the ride until changed and is shown with the vehicle and its
arrival estimates.

`rideId` (16–64 chars, `[A-Za-z0-9-]`) is generated on the phone for one ride and is the
only thing that lets a phone move its vehicle. It is never broadcast: the public
`vehicleId` is `crowd-` plus a hash of it. One ride id stays on one route.

The response is **200** for every well-formed request; the outcome is in the body:

| Body | Meaning |
| ---- | ------- |
| `{ "accepted": true, "vehicleId": "crowd-…", "offsetMeters": 6 }` | broadcast as a `crowd` vehicle |
| `{ "accepted": false, "reason": "off_route", "offsetMeters": 430 }` | > 120 m from the route line |
| `reason: "inaccurate"` | `accuracyM` > 80 m |
| `reason: "stale"` | fix older (or later) than 60 s, or not newer than the previous fix |
| `reason: "too_frequent"` | < 3 s since the last accepted fix |
| `reason: "implausible_speed"` | > 90 km/h since the last fix (GPS jump) |
| `reason: "unknown_route"` | unknown route, or a different route than this ride started on |
| `reason: "ride_too_long"` | ride older than 3 hours; start a new one |
| `reason: "capacity"` | server is tracking its maximum number of rides |

Accepted fixes are **snapped onto the route line** before broadcast, so others see where
the vehicle is on its corridor, not the rider's exact GPS point. Rides are held in memory
only and disappear after 60 s without an accepted fix. `POST /api/v1/rides/end`
`{ "rideId": "…" }` removes the vehicle at once (**204**, also for unknown ids).
While at least one rider is sharing a route, simulated vehicles for that route are hidden.
Invalid bodies return **400**; unknown fields are stripped, not stored. **429** above 240
requests a minute from one IP (generous: many phones share a carrier IP).

### GET /api/v1/arrivals?stopId=&routeId=&towardsStopId=

Shared vehicles heading to `stopId`, soonest first. `routeId` limits it to one route;
`towardsStopId` (the leg's `toStopId`) keeps only vehicles going that way, since vehicles in
the other direction pass the same stop. **404** for an unknown stop.

```json
{ "stopId": "gpo", "arrivals": [ { "routeId": "KG-1", "vehicleId": "crowd-…", "etaSeconds": { "min": 140, "max": 300 }, "distanceMeters": 610, "occupancy": "full", "observedAt": "…" } ] }
```

The ETA is the timetable running time from the vehicle's point on the route to the stop,
minus the time since its last fix, widened to a range (×0.8 … ×1.4 + 60 s). Only crowd
vehicles count, never simulated ones; estimates beyond 30 minutes are left out. An empty
list means nobody on an approaching vehicle is sharing, not that none is coming.

## Route suggestions

`POST /api/v1/suggestions` (from the app's empty-result screen):

```json
{ "from": { "name": "Seelampur", "lat": 28.6704, "lng": 77.2689 }, "to": { "name": "ISBT", "lat": 28.668, "lng": 77.228 }, "mode": "E_RICKSHAW", "routeName": "Seelampur - ISBT", "fareInr": 20, "note": "from the metro gate" }
```

Only `from` and `to` are required. Returns **202** `{ "id", "status": "pending" }`.
Coordinates are rounded to 3 decimals (~110 m) before saving; nothing identifies the sender.
Suggestions are **never used for planning or shown to others** until a reviewer has checked
them with operators. 10 a minute per IP.

`GET /api/v1/suggestions` with `Authorization: Bearer <ADMIN_TOKEN>` lists pending ones
(**401** wrong token, **503** if `ADMIN_TOKEN` is not configured).

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
{ "type": "vehicle.position", "payload": { "vehicleId": "KG-1-d0#53", "routeId": "KG-1", "mode": "AUTO_RICKSHAW", "coordinates": [77.2301, 28.6612], "bearing": 178, "speedKmh": 14, "timestamp": "…", "source": "simulated" } }
{ "type": "vehicle.removed", "payload": { "vehicleId": "crowd-5701540d0c63e114" } }
```

Vehicle positions come every ~2 s. `source` is `crowd` for a commuter sharing their ride
and `simulated` for demo traffic (`SIMULATE_VEHICLES`); clients should not present
simulated vehicles as real. Crowd positions are also pushed the moment they are accepted.
`vehicle.removed` is sent when a rider stops sharing; other vehicles simply stop updating
and clients drop them after ~15 s. A bbox subscription
replaces the previous bbox; a stands subscription replaces the previous stand list; both can
be active at once.

## Conventions

- Coordinates: objects use `{ lat, lng }`; tuples use `[lng, lat]` (GeoJSON).
- Times: ISO 8601 with offset; the service day is IST (UTC+05:30).
- Durations in seconds, distances in metres, headways in minutes, money as `{ currency, amount }`.
- Errors: non-2xx with `{ error: "<code>" }`, or Fastify's validation error shape for 400s.
