"""Loads and checks the hand-traced corridor sources in data/geojson/."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .geo import LonLat, project_onto_line

MODES = {"AUTO_RICKSHAW", "E_RICKSHAW", "SHARED_TAXI", "MINIBUS", "BUS"}
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
HEX = re.compile(r"^[0-9A-Fa-f]{6}$")
# A stop further than this from its route's line is almost certainly a data error.
MAX_STOP_OFFSET_M = 150


class CorridorError(ValueError):
    """Raised with every problem found, one per line."""


@dataclass(frozen=True)
class Stop:
    stop_id: str
    name: str
    coord: LonLat
    is_stand: bool
    virtual: bool
    zone: str = ""


@dataclass(frozen=True)
class Fare:
    min_fare: float
    base_km: float
    per_km: float
    currency: str = "INR"
    # Zonal pricing (stage fares): (from_zone, to_zone) -> price. Wins over the distance
    # formula when both stops have zones and the pair is listed.
    zones: tuple[tuple[str, str, float], ...] = ()

    def zone_price(self, from_zone: str, to_zone: str) -> float | None:
        for a, b, price in self.zones:
            if (a, b) == (from_zone, to_zone):
                return price
        return None


FARE_STEP = 5


def fare_for(fare: Fare, km: float, from_zone: str = "", to_zone: str = "") -> float:
    """One ride's fare. Same rule as the API (apps/server/src/services/fares.ts):
    zone price if defined, else max(min, min + (km - base_km) * per_km) rounded up to ₹5."""
    zp = fare.zone_price(from_zone, to_zone) if from_zone and to_zone else None
    if zp is not None:
        return zp
    raw = fare.min_fare + max(0.0, km - fare.base_km) * fare.per_km
    return -(-max(fare.min_fare, raw) // FARE_STEP) * FARE_STEP  # ceil to step


@dataclass
class Route:
    route_id: str
    short_name: str
    long_name: str
    mode: str
    color: str
    stop_ids: list[str]
    headway_min: tuple[int, int]
    service: tuple[str, str]
    avg_speed_kmh: float
    fare: Fare
    shape: list[LonLat]
    bidirectional: bool = True
    source_file: str = ""
    stop_offsets_m: dict[str, float] = field(default_factory=dict)


@dataclass
class Network:
    stops: dict[str, Stop]
    routes: list[Route]


def load_stops(path: Path) -> dict[str, Stop]:
    data = json.loads(path.read_text(encoding="utf-8"))
    stops: dict[str, Stop] = {}
    errors: list[str] = []
    for i, f in enumerate(data.get("features", [])):
        p = f.get("properties", {})
        sid = p.get("stop_id")
        coords = f.get("geometry", {}).get("coordinates")
        if not sid or not p.get("name") or not coords or len(coords) != 2:
            errors.append(f"{path.name} feature {i}: needs stop_id, name and Point coordinates")
            continue
        if sid in stops:
            errors.append(f"{path.name}: duplicate stop_id {sid!r}")
            continue
        lon, lat = float(coords[0]), float(coords[1])
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            errors.append(f"{path.name}: {sid} has out-of-range coordinates")
            continue
        stops[sid] = Stop(
            sid, p["name"], (lon, lat), bool(p.get("is_stand")), bool(p.get("virtual")), str(p.get("zone") or "")
        )
    if errors:
        raise CorridorError("\n".join(errors))
    return stops


def _parse_fare(fare: dict, rid: str, stop_ids: list, stops: dict[str, Stop], errors: list[str]) -> Fare:
    zones: list[tuple[str, str, float]] = []
    route_zones = {stops[s].zone for s in stop_ids if s in stops and stops[s].zone}
    for z in fare.get("zones", []):
        a, b, price = str(z.get("from", "")), str(z.get("to", "")), float(z.get("price", -1))
        if a not in route_zones or b not in route_zones:
            errors.append(f"{rid}: zone fare {a}->{b} uses a zone none of its stops are in")
        if price < 0:
            errors.append(f"{rid}: zone fare {a}->{b} needs a price")
        zones.append((a, b, price))
        if fare.get("zones_symmetric") and a != b:
            zones.append((b, a, price))
    if zones:
        unzoned = [s for s in stop_ids if s in stops and not stops[s].zone]
        if unzoned:
            errors.append(f"{rid}: zonal fares need a zone on every stop; missing: {', '.join(unzoned)}")
    return Fare(
        float(fare["min_fare"]),
        float(fare.get("base_km", 0)),
        float(fare.get("per_km", 0)),
        fare.get("currency", "INR"),
        tuple(zones),
    )


def load_route(path: Path, stops: dict[str, Stop]) -> tuple[Route | None, list[str]]:
    errors: list[str] = []
    data = json.loads(path.read_text(encoding="utf-8"))
    lines = [f for f in data.get("features", []) if f.get("geometry", {}).get("type") == "LineString"]
    if len(lines) != 1:
        return None, [f"{path.name}: expected exactly one LineString feature"]
    p = lines[0]["properties"]
    shape = [(float(x), float(y)) for x, y in lines[0]["geometry"]["coordinates"]]

    def need(key: str):
        if key not in p:
            errors.append(f"{path.name}: missing property {key!r}")
        return p.get(key)

    rid, mode, color = need("route_id"), need("mode"), need("color")
    stop_ids, headway, service = need("stops"), need("headway_min"), need("service")
    speed, fare = need("avg_speed_kmh"), need("fare")
    if errors:
        return None, errors

    if mode not in MODES:
        errors.append(f"{rid}: mode {mode!r} not one of {sorted(MODES)}")
    if not HEX.match(str(color)):
        errors.append(f"{rid}: color must be 6 hex digits without '#'")
    if len(shape) < 2:
        errors.append(f"{rid}: shape needs at least two points")
    if not isinstance(stop_ids, list) or len(stop_ids) < 2:
        errors.append(f"{rid}: needs at least two stops")
        stop_ids = []
    for sid in stop_ids:
        if sid not in stops:
            errors.append(f"{rid}: unknown stop {sid!r} (add it to stops.geojson)")
    if len(set(stop_ids)) != len(stop_ids):
        errors.append(f"{rid}: a stop appears twice; split loops into separate routes")
    hmin, hmax = int(headway.get("min", 0)), int(headway.get("max", 0))
    if not 0 < hmin <= hmax:
        errors.append(f"{rid}: headway_min needs 0 < min <= max")
    start, end = service.get("start", ""), service.get("end", "")
    if not (HHMM.match(start) and HHMM.match(end)) or start >= end:
        errors.append(f"{rid}: service needs HH:MM start < end")
    if not 2 <= float(speed) <= 60:
        errors.append(f"{rid}: avg_speed_kmh {speed} looks wrong (2-60)")

    route = Route(
        route_id=rid,
        short_name=p.get("short_name", rid),
        long_name=p.get("long_name", ""),
        mode=mode,
        color=str(color).upper(),
        stop_ids=list(stop_ids),
        headway_min=(hmin, hmax),
        service=(start, end),
        avg_speed_kmh=float(speed),
        fare=_parse_fare(fare, rid, stop_ids, stops, errors),
        shape=shape,
        bidirectional=bool(p.get("bidirectional", True)),
        source_file=path.name,
    )

    # Stops must lie on the line, in order.
    if not errors and len(shape) >= 2:
        last_along = -1.0
        for sid in stop_ids:
            along, offset = project_onto_line(stops[sid].coord, shape)
            route.stop_offsets_m[sid] = along
            if offset > MAX_STOP_OFFSET_M:
                errors.append(f"{rid}: stop {sid} is {offset:.0f} m from the route line (max {MAX_STOP_OFFSET_M})")
            if along <= last_along:
                errors.append(f"{rid}: stop {sid} is out of order along the line")
            last_along = along
    return route, errors


def load_network(geojson_dir: Path) -> Network:
    stops = load_stops(geojson_dir / "stops.geojson")
    routes: list[Route] = []
    errors: list[str] = []
    files = sorted((geojson_dir / "routes").glob("*.geojson"))
    if not files:
        errors.append(f"no route files in {geojson_dir / 'routes'}")
    for path in files:
        route, errs = load_route(path, stops)
        errors.extend(errs)
        if route and not errs:
            routes.append(route)
    ids = [r.route_id for r in routes]
    for dup in {i for i in ids if ids.count(i) > 1}:
        errors.append(f"duplicate route_id {dup!r}")
    if errors:
        raise CorridorError("\n".join(errors))
    return Network(stops, routes)
