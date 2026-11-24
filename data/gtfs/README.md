# data/gtfs

Generated feeds, one directory per feed. **Do not hand-edit**: change `data/geojson/`
and run `pnpm data:build`.

| Feed           | Coverage                                                        |
| -------------- | --------------------------------------------------------------- |
| `delhi-pilot/` | 7 informal routes, 23 stops: Kashmere Gate, Old Delhi, Chandni Chowk, Red Fort, Daryaganj–ITO, New Delhi Rly Stn–Connaught Place |

The feed is committed (it is small) so the API can load it without Python. The API
reads `GTFS_DIR` (default `data/gtfs/delhi-pilot`); OpenTripPlanner reads the zip
produced by `python -m gtfs_pipeline package` in `deploy/otp/`.

Pilot data is hand-traced from OpenStreetMap and plausible-but-unsurveyed headways and
fares; replace with field data before public launch (see `data/pipelines/README.md`).
