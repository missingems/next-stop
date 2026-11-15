#!/usr/bin/env python3
"""Export every bus stop for the demo map's search, with its services and the route lines buses drive in on.

Reads local files only. Nothing is fetched.

    python3 -I tools/export_stops.py <busRoutes.json> <serviceStops.json> <serviceOperators.json> <catalog.json> data

busRoutes.json, serviceStops.json and serviceOperators.json are the app's bundled transit data.
catalog.json is the public NextStopOps catalog; only its "stops" (code -> [lat, lng, name, road]) is read.

Writes data/stops.json (the search index) and data/stops/<cell>.json (stops with services and lines,
one file per CELL x CELL degree tile, loaded when a stop in that tile is picked).
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_routes import (  # noqa: E402
    MIN_UPSTREAM_METERS, SNAP_METERS, clip, decode, encode, nearest, regular, simplify,
)

CELL = 0.02


def cell_of(lat, lng):
    return f"{math.floor(lat / CELL)}_{math.floor(lng / CELL)}"


def service_order(entry):
    return (len(entry["service"].rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ")), entry["service"])


def main(routes_path, service_stops_path, operators_path, catalog_path, out_dir):
    routes = json.load(open(routes_path))
    service_stops = json.load(open(service_stops_path))
    operators = json.load(open(operators_path))
    stops = {code: {"lat": v[0], "lng": v[1], "name": v[2], "road": v[3]} for code, v in json.load(open(catalog_path))["stops"].items()}
    decoded = {service: [decode(line) if line else [] for line in lines] for service, lines in routes.items()}

    calls = {}
    for service, directions in service_stops.items():
        if not regular(service) or service not in decoded:
            continue
        for direction, codes in enumerate(directions):
            for position, code in enumerate(codes):
                calls.setdefault(code, []).append((service, direction, position, codes))

    index, cells = [], {}
    for code in sorted(calls):
        stop = stops.get(code)
        if not stop:
            continue
        point = (stop["lat"], stop["lng"])
        services, seen = [], set()
        for service, direction, position, codes in calls[code]:
            if service in seen or position == len(codes) - 1:
                continue
            destination = stops.get(codes[-1], {}).get("name")
            if not destination:
                continue
            seen.add(service)
            entry = {"service": service, "operator": operators.get(service, "SBST"), "destination": destination}
            lines = decoded[service]
            points = lines[direction] if direction < len(lines) else []
            if len(points) >= 2:
                d, segment, t = nearest(points, point)
                if d <= SNAP_METERS:
                    line, upstream = clip(points, segment, t)
                    if upstream >= MIN_UPSTREAM_METERS:
                        entry["stopAt"] = round(upstream)
                        entry["line"] = encode(simplify(line))
            services.append(entry)
        if not services:
            continue
        services.sort(key=service_order)
        cell = cell_of(*point)
        lng_lat = [round(stop["lng"], 6), round(stop["lat"], 6)]
        index.append([code, stop["name"], stop["road"], lng_lat[0], lng_lat[1]])
        cells.setdefault(cell, []).append({"code": code, "name": stop["name"], "road": stop["road"], "lngLat": lng_lat, "services": services})

    os.makedirs(os.path.join(out_dir, "stops"), exist_ok=True)
    with open(os.path.join(out_dir, "stops.json"), "w") as f:
        json.dump({"cell": CELL, "stops": index}, f, separators=(",", ":"), ensure_ascii=False)
    for cell, entries in cells.items():
        with open(os.path.join(out_dir, "stops", cell + ".json"), "w") as f:
            json.dump({"stops": entries}, f, separators=(",", ":"), ensure_ascii=False)
    driven = sum(1 for entries in cells.values() for s in entries if any("line" in e for e in s["services"]))
    print(f"{len(index)} stops ({driven} with buses to draw) in {len(cells)} cells")


if __name__ == "__main__":
    main(*sys.argv[1:6])
