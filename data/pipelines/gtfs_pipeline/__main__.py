"""CLI.  Run from data/pipelines:

    python -m gtfs_pipeline build      # geojson -> data/gtfs/delhi-pilot (+ validate)
    python -m gtfs_pipeline validate   # check an existing feed
    python -m gtfs_pipeline package    # zip the feed into deploy/otp/ for OpenTripPlanner
    python -m gtfs_pipeline cluster points.csv -o virtual-stops.geojson
    python -m gtfs_pipeline import-trace ride.gpx --route-id KG-9 --mode E_RICKSHAW --name "…"
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

from .build import build_feed
from .cluster import cluster_file
from .corridors import MODES, CorridorError, load_network, load_stops
from .ingest import gpx_speed_kmh, import_trace
from .validate import validate_feed

DATA = Path(__file__).resolve().parents[2]  # .../data
REPO = DATA.parent
DEFAULT_SRC = DATA / "geojson"
DEFAULT_FEED = DATA / "gtfs" / "delhi-pilot"
DEFAULT_ZIP = REPO / "deploy" / "otp" / "delhi-pilot-gtfs.zip"


def _print_report(feed: Path) -> bool:
    rep = validate_feed(feed)
    for w in rep.warnings:
        print(f"  warning: {w}")
    for e in rep.errors:
        print(f"  ERROR:   {e}")
    print(f"validate: {'OK' if rep.ok else 'FAILED'} ({len(rep.errors)} errors, {len(rep.warnings)} warnings)")
    return rep.ok


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="gtfs_pipeline", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="build GTFS from corridor GeoJSON")
    b.add_argument("--src", type=Path, default=DEFAULT_SRC)
    b.add_argument("--out", type=Path, default=DEFAULT_FEED)
    b.add_argument("--version", help="feed_version (default: today)")

    v = sub.add_parser("validate", help="validate a GTFS directory")
    v.add_argument("feed", type=Path, nargs="?", default=DEFAULT_FEED)

    p = sub.add_parser("package", help="validate and zip a feed for OTP")
    p.add_argument("feed", type=Path, nargs="?", default=DEFAULT_FEED)
    p.add_argument("--out", type=Path, default=DEFAULT_ZIP)

    c = sub.add_parser("cluster", help="cluster boarding GPS points into virtual stops")
    c.add_argument("points", type=Path, help="CSV with lat,lon columns")
    c.add_argument("-o", "--out", type=Path, required=True)
    c.add_argument("--eps", type=float, default=40, help="cluster radius in metres (default 40)")
    c.add_argument("--min-points", type=int, default=5)
    c.add_argument("--prefix", default="virtual")

    t = sub.add_parser("import-trace", help="GPX/KML ride-along trace -> routes/<id>.geojson")
    t.add_argument("trace", type=Path, help=".gpx or .kml file")
    t.add_argument("--route-id", required=True)
    t.add_argument("--mode", required=True, choices=sorted(MODES))
    t.add_argument("--name", required=True, help="long name, e.g. 'Kashmere Gate - Tis Hazari'")
    t.add_argument("--color", default="0F766E")
    t.add_argument("--stop-radius", type=float, default=60, help="attach stops within N metres (default 60)")
    t.add_argument("--src", type=Path, default=DEFAULT_SRC)
    t.add_argument("--force", action="store_true", help="overwrite an existing route file")

    args = ap.parse_args(argv)

    if args.cmd == "build":
        try:
            net = load_network(args.src)
        except CorridorError as e:
            print("corridor errors:\n" + "\n".join(f"  {line}" for line in str(e).splitlines()))
            return 1
        stats = build_feed(net, args.out, args.version)
        print(f"build: wrote {args.out} " + ", ".join(f"{v} {k}" for k, v in stats.items()))
        return 0 if _print_report(args.out) else 1

    if args.cmd == "validate":
        return 0 if _print_report(args.feed) else 1

    if args.cmd == "package":
        if not _print_report(args.feed):
            return 1
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(args.feed.glob("*.txt")):
                z.write(f, f.name)
        print(f"package: wrote {args.out}")
        return 0

    if args.cmd == "import-trace":
        out = args.src / "routes" / f"{args.route_id}.geojson"
        try:
            corridor = import_trace(
                args.trace, load_stops(args.src / "stops.geojson"), out, args.route_id, args.mode,
                args.name, force=args.force, color=args.color, stop_radius_m=args.stop_radius,
            )
        except (ValueError, FileExistsError) as e:
            print(f"import-trace: {e}")
            return 1
        props = corridor["features"][0]["properties"]
        print(f"import-trace: wrote {out} ({props['trace_length_km']} km, stops: {', '.join(props['stops'])})")
        speed = gpx_speed_kmh(args.trace) if args.trace.suffix.lower() == ".gpx" else None
        if speed:
            print(f"  measured average speed {speed} km/h; set avg_speed_kmh accordingly")
        print("  review headway_min, service, avg_speed_kmh and fare, then run `build`")
        return 0

    if args.cmd == "cluster":
        n = cluster_file(args.points, args.out, args.eps, args.min_points, args.prefix)
        print(f"cluster: {n} virtual stops -> {args.out}")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
