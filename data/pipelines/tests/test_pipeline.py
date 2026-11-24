"""Run from data/pipelines:  python -m unittest discover -s tests -v"""

from __future__ import annotations

import csv
import json
import random
import shutil
import tempfile
import unittest
from pathlib import Path

from gtfs_pipeline.__main__ import main
from gtfs_pipeline.build import build_feed, readable_text_color, secs_to_gtfs
from gtfs_pipeline.cluster import dbscan
from gtfs_pipeline.corridors import CorridorError, load_network
from gtfs_pipeline.geo import haversine_m, project_onto_line
from gtfs_pipeline.validate import validate_feed

GEOJSON = Path(__file__).resolve().parents[2] / "geojson"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


class GeoTests(unittest.TestCase):
    def test_haversine_known_distance(self):
        # ~1.11 km per 0.01 degree of latitude
        self.assertAlmostEqual(haversine_m((77.0, 28.0), (77.0, 28.01)), 1112, delta=2)

    def test_projection_along_and_offset(self):
        line = [(77.0, 28.0), (77.0, 28.01)]
        along, offset = project_onto_line((77.0001, 28.005), line)
        self.assertAlmostEqual(along, 556, delta=3)
        self.assertAlmostEqual(offset, 9.8, delta=1)

    def test_projection_clamps_to_ends(self):
        along, _ = project_onto_line((77.0, 27.99), [(77.0, 28.0), (77.0, 28.01)])
        self.assertEqual(along, 0)


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.net = load_network(GEOJSON)
        cls.stats = build_feed(cls.net, cls.tmp / "feed", "test")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def test_pilot_feed_is_valid(self):
        rep = validate_feed(self.tmp / "feed")
        self.assertEqual(rep.errors, [])
        self.assertEqual(rep.warnings, [])

    def test_every_route_runs_both_ways_on_frequencies(self):
        routes = {r["route_id"] for r in read_csv(self.tmp / "feed" / "routes.txt")}
        trips = read_csv(self.tmp / "feed" / "trips.txt")
        freqs = {f["trip_id"]: f for f in read_csv(self.tmp / "feed" / "frequencies.txt")}
        self.assertEqual(len(trips), 2 * len(routes))
        for t in trips:
            self.assertIn(t["trip_id"], freqs)
            self.assertEqual(freqs[t["trip_id"]]["exact_times"], "0")

    def test_headway_is_midpoint_of_range(self):
        freqs = {f["trip_id"]: f for f in read_csv(self.tmp / "feed" / "frequencies.txt")}
        self.assertEqual(freqs["KG-1-d0"]["headway_secs"], str(4 * 60))  # 3-5 min

    def test_running_time_matches_speed(self):
        rows = [r for r in read_csv(self.tmp / "feed" / "stop_times.txt") if r["trip_id"] == "KG-1-d0"]
        first, last = rows[0], rows[-1]
        dist = float(last["shape_dist_traveled"])
        h, m, s = map(int, last["arrival_time"].split(":"))
        elapsed = h * 3600 + m * 60 + s - 6 * 3600
        dwell = 20 * (len(rows) - 2)
        self.assertAlmostEqual((elapsed - dwell) / (dist / (14 / 3.6)), 1, delta=0.02)
        self.assertEqual(first["arrival_time"], "06:00:00")

    def test_reverse_direction_reverses_stops(self):
        st = read_csv(self.tmp / "feed" / "stop_times.txt")
        d0 = [r["stop_id"] for r in st if r["trip_id"] == "KG-1-d0"]
        d1 = [r["stop_id"] for r in st if r["trip_id"] == "KG-1-d1"]
        self.assertEqual(d1, list(reversed(d0)))

    def test_informal_extensions_present(self):
        stops = {s["stop_id"]: s for s in read_csv(self.tmp / "feed" / "stops.txt")}
        self.assertEqual(stops["kg-auto-1"]["is_stand"], "1")
        self.assertEqual(stops["sis-ganj"]["informal_stop"], "1")
        fares = {f["route_id"]: f for f in read_csv(self.tmp / "feed" / "informal_fares.txt")}
        self.assertEqual(fares["KG-1"]["per_km"], "8.0")


class CorridorValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(GEOJSON, self.tmp / "geojson")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def _edit_route(self, route_id: str, **props):
        path = self.tmp / "geojson" / "routes" / f"{route_id}.geojson"
        data = json.loads(path.read_text())
        data["features"][0]["properties"].update(props)
        path.write_text(json.dumps(data))

    def test_unknown_stop_is_reported(self):
        self._edit_route("KG-1", stops=["kg-auto-1", "nowhere"])
        with self.assertRaisesRegex(CorridorError, "unknown stop 'nowhere'"):
            load_network(self.tmp / "geojson")

    def test_stop_far_from_line_is_reported(self):
        self._edit_route("KG-1", stops=["kg-auto-1", "ito"])
        with self.assertRaisesRegex(CorridorError, "from the route line"):
            load_network(self.tmp / "geojson")

    def test_out_of_order_stops_are_reported(self):
        self._edit_route("KG-1", stops=["kg-auto-1", "cc-metro", "gpo", "ccm-auto-1"])
        with self.assertRaisesRegex(CorridorError, "out of order"):
            load_network(self.tmp / "geojson")

    def test_bad_headway_and_mode(self):
        self._edit_route("KG-1", headway_min={"min": 6, "max": 3}, mode="ROCKET")
        with self.assertRaises(CorridorError) as cm:
            load_network(self.tmp / "geojson")
        self.assertIn("headway_min", str(cm.exception))
        self.assertIn("ROCKET", str(cm.exception))

    def test_cli_build_returns_nonzero_on_errors(self):
        self._edit_route("KG-1", color="#16A34A")
        self.assertEqual(main(["build", "--src", str(self.tmp / "geojson"), "--out", str(self.tmp / "out")]), 1)


class ValidatorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        build_feed(load_network(GEOJSON), self.tmp, "t")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_detects_broken_references_and_times(self):
        st = self.tmp / "stop_times.txt"
        text = st.read_text().replace("KG-1-d0,06:01:38", "KG-1-d0,05:00:00", 1).replace(",gpo,", ",ghost,", 1)
        st.write_text(text)
        errors = "\n".join(validate_feed(self.tmp).errors)
        self.assertIn("unknown stop ghost", errors)
        self.assertIn("times go backwards", errors)

    def test_detects_missing_required_file(self):
        (self.tmp / "agency.txt").unlink()
        self.assertIn("missing required file agency.txt", validate_feed(self.tmp).errors)


class ClusterTests(unittest.TestCase):
    def test_finds_dense_boarding_points_and_ignores_noise(self):
        rng = random.Random(7)
        jitter = lambda c: (c[0] + rng.uniform(-0.0002, 0.0002), c[1] + rng.uniform(-0.0002, 0.0002))  # noqa: E731
        a, b = (77.2296, 28.6662), (77.2310, 28.6560)
        pts = [jitter(a) for _ in range(30)] + [jitter(b) for _ in range(12)]
        pts += [(77.20 + i * 0.01, 28.60) for i in range(5)]  # scattered noise
        clusters = dbscan(pts, eps_m=40, min_points=5)
        self.assertEqual([c.count for c in clusters], [30, 12])
        self.assertLess(haversine_m(clusters[0].centroid, a), 15)


class HelperTests(unittest.TestCase):
    def test_text_colour_and_time_format(self):
        self.assertEqual(readable_text_color("EAB308"), "000000")
        self.assertEqual(readable_text_color("7C3AED"), "FFFFFF")
        self.assertEqual(secs_to_gtfs(25 * 3600 + 61), "25:01:01")


if __name__ == "__main__":
    unittest.main()
