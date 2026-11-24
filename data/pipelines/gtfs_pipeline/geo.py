"""Small geodesy helpers. Coordinates are (lon, lat) tuples, GeoJSON order."""

from __future__ import annotations

import math
from typing import Sequence

EARTH_RADIUS_M = 6_371_008.8

LonLat = tuple[float, float]


def haversine_m(a: LonLat, b: LonLat) -> float:
    """Great-circle distance in metres."""
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def _to_xy(p: LonLat, ref_lat: float) -> tuple[float, float]:
    """Equirectangular projection to metres; accurate enough within a city."""
    k = math.pi / 180 * EARTH_RADIUS_M
    return p[0] * k * math.cos(math.radians(ref_lat)), p[1] * k


def cumulative_lengths(line: Sequence[LonLat]) -> list[float]:
    out = [0.0]
    for a, b in zip(line, line[1:]):
        out.append(out[-1] + haversine_m(a, b))
    return out


def project_onto_line(point: LonLat, line: Sequence[LonLat]) -> tuple[float, float]:
    """Returns (distance along the line in metres, offset from the line in metres)
    for the closest point on the polyline."""
    if len(line) < 2:
        raise ValueError("line needs at least two points")
    ref_lat = point[1]
    px, py = _to_xy(point, ref_lat)
    cum = cumulative_lengths(line)
    best = (math.inf, 0.0)  # (offset, along)
    for i, (a, b) in enumerate(zip(line, line[1:])):
        ax, ay = _to_xy(a, ref_lat)
        bx, by = _to_xy(b, ref_lat)
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        cx, cy = ax + t * dx, ay + t * dy
        offset = math.hypot(px - cx, py - cy)
        if offset < best[0]:
            seg_len = cum[i + 1] - cum[i]
            best = (offset, cum[i] + t * seg_len)
    return best[1], best[0]
