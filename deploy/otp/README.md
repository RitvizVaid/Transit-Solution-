# deploy/otp

OpenTripPlanner's working directory, mounted at `/var/opentripplanner`.

Before running the `otp` compose profile, drop in:

- a GTFS feed zip built from `data/gtfs/` (e.g. `delhi-informal-gtfs.zip`)
- an OSM extract for the pilot area (e.g. `delhi.osm.pbf` from Geofabrik or BBBike)

Both are git-ignored. Optional `build-config.json` / `router-config.json` go here too.
The original Dart reference for driving OTP is available in
[Trufi Core](https://github.com/trufi-association/trufi-core).
