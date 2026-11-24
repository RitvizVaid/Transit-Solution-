# data/

Owner: **Contributor 4**. Turns unorganised mobility into a GTFS feed OTP can index.

```
gtfs/        the feed: agency, routes, stops, trips, shapes, frequencies, fare files
geojson/     corridor tracks (GeoJSON / KML / GPX) recorded or traced from OSM
pipelines/   Python scripts: traces -> stops clustering -> GTFS, plus validation
raw/         large raw GPS dumps (git-ignored)
```

Flow: `geojson/` (+ `raw/`) → `pipelines/` → `gtfs/` → zipped into `deploy/otp/` → OTP graph.

Informal routes have no timetable, so each route gets one template trip plus a
`frequencies.txt` row such as "every 240-480 s between 06:00 and 22:00"
(`exact_times=0`). Validate with the MobilityData GTFS validator before handing a
feed to the server team.
