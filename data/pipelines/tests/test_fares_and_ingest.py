"""Zonal fares, fare matrix (C3.4 / C4.4) and GPS trace import (C4.2).

Run from data/pipelines:  python -m unittest discover -s tests -t . -v
"""

from __future__ import annotations

import csv
import json
import random
import shutil
import tempfile
import unittest
from pathlib import Path

from gtfs_pipeline.__main__ import main
from gtfs_pipeline.build import build_feed
from gtfs_pipeline.corridors import CorridorError, Fare, fare_for, load_network
from gtfs_pipeline.ingest import gpx_speed_kmh, match_stops, read_track, simplify
from gtfs_pipeline.validate import validate_feed

GEOJSON = Path(__file__).resolve().parents[2] / "geojson"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


class ZoneFareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        build_feed(load_network(GEOJSON), cls.tmp, "t")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def test_zone_fares_are_standard_gtfs(self):
        stops = {s["stop_id"]: s for s in read_csv(self.tmp / "stops.txt")}
        self.assertEqual(stops["ito"]["zone_id"], "SOUTH")
        rules = [r for r in read_csv(self.tmp / "fare_rules.txt") if r["route_id"] == "M-14"]
        self.assertIn(
            {"fare_id": "M-14-z-NORTH-SOUTH", "route_id": "M-14", "origin_id": "NORTH", "destination_id": "SOUTH"},
            rules,
        )
        self.assertIn("M-14-z-SOUTH-NORTH", {r["fare_id"] for r in rules})  # symmetric expansion
        prices = {f["fare_id"]: f["price"] for f in read_csv(self.tmp / "fare_attributes.txt")}
        self.assertEqual(prices["M-14-z-NORTH-SOUTH"], "20.00")

    def test_fare_matrix_covers_every_stop_pair(self):
        net = load_network(GEOJSON)
        rows = read_csv(self.tmp / "fare_matrix.csv")
        expected = sum(
            len(r.stop_ids) * (len(r.stop_ids) - 1) // 2 * (2 if r.bidirectional else 1) for r in net.routes
        )
        self.assertEqual(len(rows), expected)
        m14 = {(r["from_stop_id"], r["to_stop_id"]): r for r in rows if r["route_id"] == "M-14"}
        self.assertEqual(m14[("isbt-mini-1", "ito")]["fare"], "20.00")
        self.assertEqual(m14[("isbt-mini-1", "ito")]["basis"], "zone")
        kg1 = {(r["from_stop_id"], r["to_stop_id"]): r for r in rows if r["route_id"] == "KG-1"}
        self.assertEqual(kg1[("kg-auto-1", "ccm-auto-1")]["basis"], "distance")
        self.assertEqual(kg1[("kg-auto-1", "ccm-auto-1")]["fare"], "20.00")

    def test_fare_rule_matches_the_api(self):
        f = Fare(20, 1.5, 8)
        self.assertEqual(fare_for(f, 1.15), 20)
        self.assertEqual(fare_for(f, 3.0), 35)  # 20 + 1.5 × 8 = 32 → ₹35, same as the API's fares test
        z = Fare(10, 3, 2, zones=(("A", "B", 15.0),))
        self.assertEqual(fare_for(z, 5, "A", "B"), 15)
        self.assertEqual(fare_for(z, 5, "B", "A"), 15)  # unlisted pair → distance: 10 + 2×2 = 14 → 15
        self.assertEqual(fare_for(z, 8, "B", "A"), 20)  # 10 + 5×2 = 20

    def test_validator_rejects_unknown_zone(self):
        rules = self.tmp / "fare_rules.txt"
        original = rules.read_text()
        try:
            rules.write_text(original + "M-14-z-NORTH-SOUTH,M-14,MARS,SOUTH\n")
            self.assertTrue(any("MARS" in e for e in validate_feed(self.tmp).errors))
        finally:
            rules.write_text(original)


class ZoneCorridorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(GEOJSON, self.tmp / "geojson")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_zone_fare_must_use_route_zones(self):
        path = self.tmp / "geojson" / "routes" / "KG-1.geojson"
        data = json.loads(path.read_text())
        data["features"][0]["properties"]["fare"]["zones"] = [{"from": "NORTH", "to": "SOUTH", "price": 30}]
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(CorridorError, "uses a zone none of its stops are in"):
            load_network(self.tmp / "geojson")


def _gpx(points: list[tuple[float, float]]) -> str:
    pts = "".join(
        f'<trkpt lat="{lat}" lon="{lon}"><time>2026-11-20T08:{i // 60:02d}:{i % 60:02d}Z</time></trkpt>'
        for i, (lon, lat) in enumerate(points)
    )
    return (
        '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">'
        f"<trk><trkseg>{pts}</trkseg></trk></gpx>"
    )


def _densify(line: list[tuple[float, float]], step: float = 0.0002) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        n = max(1, int(max(abs(x2 - x1), abs(y2 - y1)) / step))
        out += [(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n) for k in range(n)]
    return out + [line[-1]]


class TraceImportTests(unittest.TestCase):
    """C4.2: convert recorded driver GPS traces (GPX/KML) into the GTFS pipeline."""

    KG1 = [(77.2296, 28.6662), (77.2299, 28.6645), (77.2301, 28.6628), (77.2302, 28.6600),
           (77.2302, 28.6582), (77.2306, 28.6570), (77.2310, 28.6560)]

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(GEOJSON, self.tmp / "geojson")
        (self.tmp / "geojson" / "routes" / "KG-1.geojson").unlink()  # re-create it from a "ride"
        rng = random.Random(3)
        self.noisy = [
            (x + rng.uniform(-0.00004, 0.00004), y + rng.uniform(-0.00004, 0.00004)) for x, y in _densify(self.KG1)
        ]

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def _import(self, trace: Path, route_id: str, mode: str) -> int:
        return main(["import-trace", str(trace), "--route-id", route_id, "--mode", mode,
                     "--name", "Kashmere Gate - Chandni Chowk", "--src", str(self.tmp / "geojson")])

    def test_gpx_ride_becomes_a_valid_route(self):
        trace = self.tmp / "ride.gpx"
        trace.write_text(_gpx(self.noisy))
        self.assertEqual(self._import(trace, "KG-1", "AUTO_RICKSHAW"), 0)
        route = json.loads((self.tmp / "geojson" / "routes" / "KG-1.geojson").read_text())["features"][0]
        self.assertEqual(route["properties"]["stops"], ["kg-auto-1", "gpo", "cc-metro", "ccm-auto-1"])
        # Simplification keeps the shape but drops GPS jitter.
        self.assertLess(len(route["geometry"]["coordinates"]), len(self.noisy) / 3)
        self.assertAlmostEqual(route["properties"]["trace_length_km"], 1.15, delta=0.1)
        # The imported corridor goes straight through build + validate.
        self.assertEqual(main(["build", "--src", str(self.tmp / "geojson"), "--out", str(self.tmp / "feed")]), 0)

    def test_kml_from_google_my_maps(self):
        coords = " ".join(f"{x},{y},0" for x, y in self.noisy)
        kml = (
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString>'
            f"<coordinates>{coords}</coordinates></LineString></Placemark></Document></kml>"
        )
        trace = self.tmp / "ride.kml"
        trace.write_text(kml)
        self.assertEqual(len(read_track(trace)), len(self.noisy))
        self.assertEqual(self._import(trace, "KG-1", "AUTO_RICKSHAW"), 0)

    def test_refuses_traces_off_the_network_and_existing_routes(self):
        far = self.tmp / "far.gpx"
        far.write_text(_gpx([(77.0, 28.4), (77.01, 28.41)]))
        self.assertEqual(self._import(far, "X-1", "E_RICKSHAW"), 1)
        ok = self.tmp / "ok.gpx"
        ok.write_text(_gpx(self.noisy))
        self.assertEqual(self._import(ok, "M-14", "MINIBUS"), 1)  # exists; needs --force

    def test_speed_from_timestamps(self):
        trace = self.tmp / "ride.gpx"
        trace.write_text(_gpx(self.noisy))  # one point per second
        speed = gpx_speed_kmh(trace)
        self.assertIsNotNone(speed)
        self.assertGreater(speed, 20)

    def test_simplify_keeps_corners(self):
        line = _densify([(77.0, 28.0), (77.01, 28.0), (77.01, 28.01)])
        self.assertEqual(len(simplify(line, 5)), 3)
        self.assertEqual(match_stops(line, {}, 50), [])


if __name__ == "__main__":
    unittest.main()
