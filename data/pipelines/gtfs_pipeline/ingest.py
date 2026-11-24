"""Driver GPS traces (GPX / KML) -> corridor GeoJSON for data/geojson/routes/.

Field workflow: ride along a route with a GPS logger (any phone tracker exports GPX;
Google My Maps exports KML), then:

    python -m gtfs_pipeline import-trace ride.gpx --route-id KG-9 --mode E_RICKSHAW \
        --name "Kashmere Gate - Tis Hazari"

The trace is cleaned (duplicate/zero-length points dropped, Douglas–Peucker simplified),
existing stops within `--stop-radius` metres of the line are attached in travel order, and a
route file is written with every property `build` needs. Headway, speed, hours and fares
start from conservative defaults and must be reviewed before `build`.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path

from .corridors import Stop
from .geo import LonLat, cumulative_lengths, haversine_m, project_onto_line


def read_track(path: Path) -> list[LonLat]:
    """All track/route points of a GPX file, or the LineString coordinates of a KML file."""
    root = ET.parse(path).getroot()
    tag = root.tag.split("}")[-1].lower()
    pts: list[LonLat] = []
    if tag == "gpx":
        for el in root.iter():
            name = el.tag.split("}")[-1]
            if name in ("trkpt", "rtept"):
                pts.append((float(el.attrib["lon"]), float(el.attrib["lat"])))
    elif tag == "kml":
        for el in root.iter():
            if el.tag.split("}")[-1] == "coordinates" and el.text:
                for token in el.text.split():
                    lon, lat, *_ = token.split(",")
                    pts.append((float(lon), float(lat)))
    else:
        raise ValueError(f"{path.name}: expected a GPX or KML file, got <{tag}>")
    if len(pts) < 2:
        raise ValueError(f"{path.name}: needs at least two points")
    return pts


def dedupe(points: list[LonLat], min_step_m: float = 2.0) -> list[LonLat]:
    out = [points[0]]
    for p in points[1:]:
        if haversine_m(out[-1], p) >= min_step_m:
            out.append(p)
    return out


def _perp_m(p: LonLat, a: LonLat, b: LonLat) -> float:
    _, offset = project_onto_line(p, [a, b])
    return offset


def simplify(points: list[LonLat], tolerance_m: float = 8.0) -> list[LonLat]:
    """Douglas–Peucker with a metric tolerance (iterative, no recursion limit)."""
    if len(points) <= 2:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        worst, idx = 0.0, -1
        for k in range(i + 1, j):
            d = _perp_m(points[k], points[i], points[j])
            if d > worst:
                worst, idx = d, k
        if worst > tolerance_m:
            keep[idx] = True
            stack.extend([(i, idx), (idx, j)])
    return [p for p, k in zip(points, keep) if k]


def match_stops(line: list[LonLat], stops: dict[str, Stop], radius_m: float) -> list[str]:
    """Stops within radius of the line, ordered by distance along it (first/last pass only once)."""
    hits: list[tuple[float, str]] = []
    for s in stops.values():
        along, offset = project_onto_line(s.coord, line)
        if offset <= radius_m:
            hits.append((along, s.stop_id))
    hits.sort()
    return [sid for _, sid in hits]


def trace_to_corridor(
    points: list[LonLat],
    stops: dict[str, Stop],
    route_id: str,
    mode: str,
    long_name: str,
    color: str = "0F766E",
    stop_radius_m: float = 60.0,
    tolerance_m: float = 8.0,
    source: str = "",
) -> dict:
    line = simplify(dedupe(points), tolerance_m)
    stop_ids = match_stops(line, stops, stop_radius_m)
    length_km = cumulative_lengths(line)[-1] / 1000
    if len(stop_ids) < 2:
        raise ValueError(
            f"only {len(stop_ids)} known stop(s) within {stop_radius_m:.0f} m of the trace; "
            "add the boarding points to stops.geojson (or cluster them) first"
        )
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "route_id": route_id,
                    "short_name": route_id,
                    "long_name": long_name,
                    "mode": mode,
                    "color": color.lstrip("#").upper(),
                    "stops": stop_ids,
                    # Defaults to review: measure headways at the stand, speed from the trace times.
                    "headway_min": {"min": 5, "max": 10},
                    "service": {"start": "07:00", "end": "21:00"},
                    "avg_speed_kmh": 12,
                    "fare": {"min_fare": 10, "base_km": 1, "per_km": 5, "currency": "INR"},
                    "bidirectional": True,
                    "source": source or "imported GPS trace",
                    "trace_length_km": round(length_km, 2),
                    "needs_review": ["headway_min", "service", "avg_speed_kmh", "fare"],
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(x, 6), round(y, 6)] for x, y in line],
                },
            }
        ],
    }


def import_trace(
    trace: Path,
    stops: dict[str, Stop],
    out: Path,
    route_id: str,
    mode: str,
    long_name: str,
    force: bool = False,
    **kw,
) -> dict:
    if out.exists() and not force:
        raise FileExistsError(f"{out} exists; pass --force to replace it")
    corridor = trace_to_corridor(read_track(trace), stops, route_id, mode, long_name, source=trace.name, **kw)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(corridor, indent=2) + "\n", encoding="utf-8")
    return corridor


# Speed estimate from timestamped GPX (optional helper for reviewers).
def gpx_speed_kmh(path: Path) -> float | None:
    from datetime import datetime

    root = ET.parse(path).getroot()
    samples: list[tuple[LonLat, datetime]] = []
    for el in root.iter():
        if el.tag.split("}")[-1] != "trkpt":
            continue
        t = next((c.text for c in el if c.tag.split("}")[-1] == "time"), None)
        if t:
            samples.append(((float(el.attrib["lon"]), float(el.attrib["lat"])), datetime.fromisoformat(t.replace("Z", "+00:00"))))
    if len(samples) < 2:
        return None
    dist = sum(haversine_m(a[0], b[0]) for a, b in zip(samples, samples[1:]))
    secs = (samples[-1][1] - samples[0][1]).total_seconds()
    return None if secs <= 0 else round(dist / secs * 3.6, 1)
