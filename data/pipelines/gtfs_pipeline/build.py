"""Corridor network -> GTFS feed directory.

Informal routes have no timetable, so each direction gets ONE template trip whose
stop_times hold relative running times, plus a frequencies.txt row with
exact_times=0 ("runs every N seconds between start and end").

Non-standard columns/files (ignored by OTP and validators, used by our API):
  routes.txt      informal_mode, min_headway_min, max_headway_min
  stops.txt       is_stand, informal_stop
  informal_fares.txt   route_id, min_fare, base_km, per_km, currency
  fare_matrix.csv      every stop pair per route with its fare (not a GTFS file)
"""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from .corridors import Network, Route, fare_for
from .geo import cumulative_lengths, project_onto_line

AGENCY_ID = "DIT"
SERVICE_ID = "DAILY"
DWELL_SECS = 20  # boarding/alighting at intermediate stops
# Extended GTFS route types: 1501 = communal taxi (shared autos, e-rickshaws, taxis); 3 = bus.
ROUTE_TYPE = {"AUTO_RICKSHAW": 1501, "E_RICKSHAW": 1501, "SHARED_TAXI": 1501, "MINIBUS": 3, "BUS": 3}


def hhmm_to_secs(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 3600 + int(m) * 60


def secs_to_gtfs(t: int) -> str:
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def readable_text_color(hex_color: str) -> str:
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (0, 2, 4))
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b)]
    lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    return "000000" if (lum + 0.05) / 0.05 > 1.05 / (lum + 0.05) else "FFFFFF"


def _directions(route: Route):
    """Yields (direction_id, stop_ids, shape) for each direction served."""
    yield 0, route.stop_ids, route.shape
    if route.bidirectional:
        yield 1, list(reversed(route.stop_ids)), list(reversed(route.shape))


def _write(path: Path, header: list[str], rows: list[list]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


def build_feed(net: Network, out_dir: Path, feed_version: str | None = None) -> dict[str, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    version = feed_version or date.today().strftime("%Y%m%d")

    _write(out_dir / "agency.txt",
           ["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"],
           [[AGENCY_ID, "Delhi informal transit (community-mapped)", "https://example.org/transit", "Asia/Kolkata", "en"]])

    _write(out_dir / "feed_info.txt",
           ["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"],
           [["HackwithDelhi Transit", "https://example.org/transit", "en", "20260101", "20271231", version]])

    _write(out_dir / "calendar.txt",
           ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
           [[SERVICE_ID, 1, 1, 1, 1, 1, 1, 1, "20260101", "20271231"]])

    used_stops = sorted({sid for r in net.routes for sid in r.stop_ids})
    _write(out_dir / "stops.txt",
           ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "zone_id", "is_stand", "informal_stop"],
           [[s.stop_id, s.name, f"{s.coord[1]:.6f}", f"{s.coord[0]:.6f}", 0, s.zone, int(s.is_stand), int(s.virtual)]
            for s in (net.stops[sid] for sid in used_stops)])

    route_rows, trip_rows, st_rows, freq_rows, shape_rows = [], [], [], [], []
    fare_attr_rows, fare_rule_rows, informal_fare_rows, matrix_rows = [], [], [], []

    for r in sorted(net.routes, key=lambda r: r.route_id):
        route_rows.append([r.route_id, AGENCY_ID, r.short_name, r.long_name, ROUTE_TYPE[r.mode],
                           r.color, readable_text_color(r.color), r.mode, r.headway_min[0], r.headway_min[1]])
        speed_ms = r.avg_speed_kmh / 3.6
        start, end = hhmm_to_secs(r.service[0]), hhmm_to_secs(r.service[1])
        headway_secs = round((r.headway_min[0] + r.headway_min[1]) / 2 * 60)

        for direction, stop_ids, shape in _directions(r):
            trip_id, shape_id = f"{r.route_id}-d{direction}", f"{r.route_id}-s{direction}"
            headsign = net.stops[stop_ids[-1]].name
            trip_rows.append([r.route_id, SERVICE_ID, trip_id, headsign, direction, shape_id])

            cum = cumulative_lengths(shape)
            for seq, (pt, dist) in enumerate(zip(shape, cum), start=1):
                shape_rows.append([shape_id, f"{pt[1]:.6f}", f"{pt[0]:.6f}", seq, round(dist, 1)])

            alongs: list[float] = []
            t = start
            prev_along = 0.0
            for seq, sid in enumerate(stop_ids, start=1):
                along, _ = project_onto_line(net.stops[sid].coord, shape)
                alongs.append(along)
                t += round((along - prev_along) / speed_ms) if seq > 1 else 0
                prev_along = along
                dwell = DWELL_SECS if 1 < seq < len(stop_ids) else 0
                st_rows.append([trip_id, secs_to_gtfs(t), secs_to_gtfs(t + dwell), sid, seq, round(along, 1),
                                0 if seq < len(stop_ids) else 1, 0 if seq > 1 else 1])
                t += dwell

            for i, a in enumerate(stop_ids):
                for j in range(i + 1, len(stop_ids)):
                    b = stop_ids[j]
                    km = (alongs[j] - alongs[i]) / 1000
                    za, zb = net.stops[a].zone, net.stops[b].zone
                    zoned = r.fare.zone_price(za, zb) is not None if za and zb else False
                    matrix_rows.append([r.route_id, direction, a, b, f"{km:.3f}",
                                        f"{fare_for(r.fare, km, za, zb):.2f}", "zone" if zoned else "distance"])

            freq_rows.append([trip_id, secs_to_gtfs(start), secs_to_gtfs(end), headway_secs, 0])

        if r.fare.zones:
            # Standard GTFS zonal fares (fares v1): one fare per origin/destination zone pair.
            for za, zb, price in r.fare.zones:
                fare_id = f"{r.route_id}-z-{za}-{zb}"
                fare_attr_rows.append([fare_id, f"{price:.2f}", r.fare.currency, 0, 0])
                fare_rule_rows.append([fare_id, r.route_id, za, zb])
        else:
            fare_id = f"{r.route_id}-base"
            fare_attr_rows.append([fare_id, f"{r.fare.min_fare:.2f}", r.fare.currency, 0, 0])
            fare_rule_rows.append([fare_id, r.route_id, "", ""])
        informal_fare_rows.append([r.route_id, f"{r.fare.min_fare:.2f}", r.fare.base_km, r.fare.per_km, r.fare.currency])

    _write(out_dir / "routes.txt",
           ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color",
            "route_text_color", "informal_mode", "min_headway_min", "max_headway_min"], route_rows)
    _write(out_dir / "trips.txt", ["route_id", "service_id", "trip_id", "trip_headsign", "direction_id", "shape_id"], trip_rows)
    _write(out_dir / "stop_times.txt",
           ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "shape_dist_traveled",
            "pickup_type", "drop_off_type"], st_rows)
    _write(out_dir / "frequencies.txt", ["trip_id", "start_time", "end_time", "headway_secs", "exact_times"], freq_rows)
    _write(out_dir / "shapes.txt", ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence", "shape_dist_traveled"], shape_rows)
    _write(out_dir / "fare_attributes.txt", ["fare_id", "price", "currency_type", "payment_method", "transfers"], fare_attr_rows)
    _write(out_dir / "fare_rules.txt", ["fare_id", "route_id", "origin_id", "destination_id"], fare_rule_rows)
    # Fare matrix between every pair of stops on each route (C4: "tabulate fares between
    # junctions and stands"). Printed for stands; cross-checked against the API fare engine.
    _write(out_dir / "fare_matrix.csv",
           ["route_id", "direction_id", "from_stop_id", "to_stop_id", "distance_km", "fare", "basis"], matrix_rows)
    _write(out_dir / "informal_fares.txt", ["route_id", "min_fare", "base_km", "per_km", "currency"], informal_fare_rows)

    return {"routes": len(route_rows), "trips": len(trip_rows), "stops": len(used_stops),
            "stop_times": len(st_rows), "shape_points": len(shape_rows)}
