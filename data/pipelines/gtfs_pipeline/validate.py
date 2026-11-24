"""Structural GTFS checks that catch the mistakes OTP would choke on.

Not a replacement for the MobilityData validator (run it in CI / before release),
but fast, dependency-free and good enough for every local build.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED = {
    "agency.txt": ["agency_name", "agency_url", "agency_timezone"],
    "stops.txt": ["stop_id", "stop_name", "stop_lat", "stop_lon"],
    "routes.txt": ["route_id", "route_type"],
    "trips.txt": ["route_id", "service_id", "trip_id"],
    "stop_times.txt": ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
    "calendar.txt": ["service_id", "start_date", "end_date"],
}
OPTIONAL = {
    "frequencies.txt": ["trip_id", "start_time", "end_time", "headway_secs"],
    "shapes.txt": ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
    "fare_attributes.txt": ["fare_id", "price", "currency_type", "payment_method", "transfers"],
    "fare_rules.txt": ["fare_id"],
}
TIME = re.compile(r"^\d{1,2}:[0-5]\d:[0-5]\d$")


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _secs(t: str) -> int:
    h, m, s = map(int, t.split(":"))
    return h * 3600 + m * 60 + s


def _read(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def validate_feed(feed_dir: Path) -> Report:
    rep = Report()
    tables: dict[str, list[dict[str, str]]] = {}

    for name, cols in {**REQUIRED, **OPTIONAL}.items():
        path = feed_dir / name
        if not path.exists():
            if name in REQUIRED:
                rep.errors.append(f"missing required file {name}")
            continue
        rows = _read(path)
        header = rows[0].keys() if rows else []
        for c in cols:
            if rows and c not in header:
                rep.errors.append(f"{name}: missing column {c}")
        tables[name] = rows
    if rep.errors:
        return rep

    def unique(name: str, key: str) -> set[str]:
        ids = [r[key] for r in tables.get(name, [])]
        dups = {i for i in ids if ids.count(i) > 1}
        for d in sorted(dups):
            rep.errors.append(f"{name}: duplicate {key} {d!r}")
        return set(ids)

    stop_ids = unique("stops.txt", "stop_id")
    route_ids = unique("routes.txt", "route_id")
    trip_ids = unique("trips.txt", "trip_id")
    service_ids = {r["service_id"] for r in tables["calendar.txt"]}
    shape_ids = {r["shape_id"] for r in tables.get("shapes.txt", [])}

    for s in tables["stops.txt"]:
        lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            rep.errors.append(f"stops.txt: {s['stop_id']} has invalid coordinates")

    for r in tables["routes.txt"]:
        for col in ("route_color", "route_text_color"):
            if r.get(col) and not re.fullmatch(r"[0-9A-Fa-f]{6}", r[col]):
                rep.errors.append(f"routes.txt: {r['route_id']} {col} {r[col]!r} is not 6 hex digits")
        if not (r.get("route_short_name") or r.get("route_long_name")):
            rep.errors.append(f"routes.txt: {r['route_id']} needs a short or long name")

    routes_with_trips = set()
    for t in tables["trips.txt"]:
        if t["route_id"] not in route_ids:
            rep.errors.append(f"trips.txt: {t['trip_id']} references unknown route {t['route_id']}")
        if t["service_id"] not in service_ids:
            rep.errors.append(f"trips.txt: {t['trip_id']} references unknown service {t['service_id']}")
        if t.get("shape_id") and t["shape_id"] not in shape_ids:
            rep.errors.append(f"trips.txt: {t['trip_id']} references unknown shape {t['shape_id']}")
        routes_with_trips.add(t["route_id"])
    for rid in sorted(route_ids - routes_with_trips):
        rep.warnings.append(f"routes.txt: route {rid} has no trips")

    by_trip: dict[str, list[dict[str, str]]] = {}
    used_stops = set()
    for st in tables["stop_times.txt"]:
        if st["trip_id"] not in trip_ids:
            rep.errors.append(f"stop_times.txt: unknown trip {st['trip_id']}")
            continue
        if st["stop_id"] not in stop_ids:
            rep.errors.append(f"stop_times.txt: unknown stop {st['stop_id']}")
        for col in ("arrival_time", "departure_time"):
            if not TIME.match(st[col]):
                rep.errors.append(f"stop_times.txt: {st['trip_id']} bad {col} {st[col]!r}")
        used_stops.add(st["stop_id"])
        by_trip.setdefault(st["trip_id"], []).append(st)

    for trip_id, rows in by_trip.items():
        rows.sort(key=lambda r: int(r["stop_sequence"]))
        if len(rows) < 2:
            rep.errors.append(f"stop_times.txt: trip {trip_id} has fewer than two stops")
        prev = -1
        for r in rows:
            arr, dep = _secs(r["arrival_time"]), _secs(r["departure_time"])
            if arr < prev or dep < arr:
                rep.errors.append(f"stop_times.txt: trip {trip_id} times go backwards at seq {r['stop_sequence']}")
            prev = dep
    for tid in sorted(trip_ids - by_trip.keys()):
        rep.errors.append(f"trips.txt: trip {tid} has no stop_times")
    for sid in sorted(stop_ids - used_stops):
        rep.warnings.append(f"stops.txt: stop {sid} is not served by any trip")

    for fq in tables.get("frequencies.txt", []):
        if fq["trip_id"] not in trip_ids:
            rep.errors.append(f"frequencies.txt: unknown trip {fq['trip_id']}")
        if _secs(fq["start_time"]) >= _secs(fq["end_time"]):
            rep.errors.append(f"frequencies.txt: {fq['trip_id']} start_time must be before end_time")
        if not 0 < int(fq["headway_secs"]) <= 7200:
            rep.errors.append(f"frequencies.txt: {fq['trip_id']} headway_secs out of range")

    shape_seq: dict[str, int] = {}
    for p in tables.get("shapes.txt", []):
        seq = int(p["shape_pt_sequence"])
        if seq <= shape_seq.get(p["shape_id"], -1):
            rep.errors.append(f"shapes.txt: {p['shape_id']} sequence not increasing")
        shape_seq[p["shape_id"]] = seq

    fare_ids = {f["fare_id"] for f in tables.get("fare_attributes.txt", [])}
    zone_ids = {s.get("zone_id", "") for s in tables["stops.txt"]} - {""}
    for fr in tables.get("fare_rules.txt", []):
        for col in ("origin_id", "destination_id"):
            if fr.get(col) and fr[col] not in zone_ids:
                rep.errors.append(f"fare_rules.txt: {fr['fare_id']} {col} {fr[col]!r} is not a stop zone_id")
        if fr["fare_id"] not in fare_ids:
            rep.errors.append(f"fare_rules.txt: unknown fare {fr['fare_id']}")
        if fr.get("route_id") and fr["route_id"] not in route_ids:
            rep.errors.append(f"fare_rules.txt: unknown route {fr['route_id']}")

    return rep
