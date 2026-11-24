"""Informal stop clustering: boarding/alighting GPS points -> virtual stops.

Drivers and marshals don't stop at marked poles, so we record where passengers
actually get on and off (from driver phones or ride-alongs) and cluster the
points. Dense clusters become named virtual stops for stops.geojson.

Algorithm: DBSCAN with a haversine radius. O(n^2), fine for a few thousand
points per corridor; switch to a grid index if field data grows past that.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

from .geo import LonLat, haversine_m


@dataclass
class Cluster:
    centroid: LonLat
    count: int
    radius_m: float


def dbscan(points: list[LonLat], eps_m: float = 40, min_points: int = 5) -> list[Cluster]:
    n = len(points)
    labels = [-1] * n  # -1 unvisited/noise, >=0 cluster id
    visited = [False] * n
    neighbours = lambda i: [j for j in range(n) if haversine_m(points[i], points[j]) <= eps_m]  # noqa: E731
    cid = -1
    for i in range(n):
        if visited[i]:
            continue
        visited[i] = True
        seeds = neighbours(i)
        if len(seeds) < min_points:
            continue
        cid += 1
        labels[i] = cid
        queue = [j for j in seeds if j != i]
        while queue:
            j = queue.pop()
            if labels[j] == -1:
                labels[j] = cid
            if visited[j]:
                continue
            visited[j] = True
            more = neighbours(j)
            if len(more) >= min_points:
                queue.extend(k for k in more if labels[k] == -1)

    clusters: list[Cluster] = []
    for c in range(cid + 1):
        members = [points[i] for i in range(n) if labels[i] == c]
        lon = sum(p[0] for p in members) / len(members)
        lat = sum(p[1] for p in members) / len(members)
        radius = max(haversine_m((lon, lat), p) for p in members)
        clusters.append(Cluster((lon, lat), len(members), radius))
    clusters.sort(key=lambda c: -c.count)
    return clusters


def read_points(csv_path: Path) -> list[LonLat]:
    """CSV with `lat,lon` (or `latitude,longitude`) columns; other columns ignored."""
    with csv_path.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return []
    lat_key = "lat" if "lat" in rows[0] else "latitude"
    lon_key = "lon" if "lon" in rows[0] else "longitude"
    return [(float(r[lon_key]), float(r[lat_key])) for r in rows if r.get(lat_key) and r.get(lon_key)]


def clusters_to_geojson(clusters: list[Cluster], prefix: str) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "stop_id": f"{prefix}-{i + 1}",
                    "name": f"Virtual stop {i + 1} (rename me)",
                    "is_stand": False,
                    "virtual": True,
                    "boardings": c.count,
                    "radius_m": round(c.radius_m),
                },
                "geometry": {"type": "Point", "coordinates": [round(c.centroid[0], 6), round(c.centroid[1], 6)]},
            }
            for i, c in enumerate(clusters)
        ],
    }


def cluster_file(csv_path: Path, out_path: Path, eps_m: float, min_points: int, prefix: str) -> int:
    clusters = dbscan(read_points(csv_path), eps_m, min_points)
    out_path.write_text(json.dumps(clusters_to_geojson(clusters, prefix), indent=2) + "\n", encoding="utf-8")
    return len(clusters)
