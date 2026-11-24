# data/pipelines

Owner: **Contributor 4**. Builds the GTFS feed in `data/gtfs/delhi-pilot/` from the
hand-traced corridors in `data/geojson/`. **Standard library only** (Python 3.10+):
no virtualenv or `pip install` needed.

```sh
cd data/pipelines
python -m gtfs_pipeline build        # geojson -> GTFS, then validates
python -m gtfs_pipeline validate     # re-check an existing feed
python -m gtfs_pipeline package      # validate + zip into deploy/otp/ for OpenTripPlanner
python -m gtfs_pipeline cluster boardings.csv -o virtual-stops.geojson --eps 40
python -m unittest discover -s tests -t .
```

From the repo root: `pnpm data:build`, `pnpm data:test`.

## Source format (`data/geojson/`)

- `stops.geojson`: every boarding point. `stop_id`, `name`, `is_stand` (marshalled stand
  with live reports), `virtual` (informal pick-up point, no pole).
- `routes/<ROUTE>.geojson`: one LineString per route, traced along the road, with:

| Property         | Example                                              |
| ---------------- | ---------------------------------------------------- |
| `route_id`       | `KG-1`                                               |
| `mode`           | `AUTO_RICKSHAW`, `E_RICKSHAW`, `SHARED_TAXI`, `MINIBUS`, `BUS` |
| `color`          | `16A34A` (no `#`)                                    |
| `stops`          | ordered stop ids along the line                      |
| `headway_min`    | `{ "min": 3, "max": 5 }` minutes between departures  |
| `service`        | `{ "start": "06:00", "end": "23:00" }`               |
| `avg_speed_kmh`  | `14` (includes traffic)                              |
| `fare`           | `{ "min_fare": 20, "base_km": 1.5, "per_km": 8 }`    |
| `bidirectional`  | `true` → a reverse trip is generated                 |

`build` refuses bad input with every problem listed: unknown stops, stops > 150 m off
the line or out of order, invalid colours, modes, headways or service hours.

## What the feed contains

Each direction is one template trip plus a `frequencies.txt` row (`exact_times=0`),
because informal vehicles leave when full, not on a clock. Running times come from
distance along the shape ÷ `avg_speed_kmh`, plus 20 s dwell at intermediate stops.
Headway = midpoint of the min/max range.

Extensions OTP ignores but our API reads:

| File / column                                | Use                                         |
| -------------------------------------------- | ------------------------------------------- |
| `routes.txt`: `informal_mode`, `min/max_headway_min` | exact mode + headway range for the UI |
| `stops.txt`: `is_stand`, `informal_stop`     | live stand status, "informal stop" tag      |
| `informal_fares.txt`                         | distance fares: `max(min, min + (km − base_km) × per_km)` |

Route types use extended GTFS: `1501` communal taxi (autos, e-rickshaws, shared taxis), `3` bus.

## Adding real field data

1. Record ride-alongs (GPX) and boarding points (CSV `lat,lon`) per corridor.
2. `cluster` the boarding points → candidate virtual stops; rename and merge into `stops.geojson`.
3. Replace the route's hand-traced LineString with the cleaned GPS trace.
4. Measure headways at stands (stand marshals' "Departing now" reports give this) and update `headway_min`.
5. `build`, then run the [MobilityData validator](https://github.com/MobilityData/gtfs-validator) before release.
