#!/usr/bin/env python3
"""Export the app's real tree crowns around each demo area.

Reads local files only and writes data/crowns.json. Nothing is fetched.

    python3 -I tools/export_crowns.py <TreeCrowns.bin> data/areas.json data/crowns.json

TreeCrowns.bin is the app's crown index: a "TREE" header, a grid of start offsets and
six-byte records (x, y as fractions of the bounds, then crown height and radius in
quarter metres). Each area keeps the crowns within REACH_METERS of any of its stops, as
flat [longitude, latitude, height, radius] runs with coordinates in millionths of a degree
from the bounds' minimum corner.
"""

import json
import math
import struct
import sys

REACH_METERS = 1000
EARTH = 6_371_008.8


def main(crowns_path, areas_path, output_path):
    data = open(crowns_path, "rb").read()
    assert data[:4] == b"TREE"
    count = struct.unpack_from("<I", data, 4)[0]
    min_lat, min_lng, max_lat, max_lng = struct.unpack_from("<4d", data, 8)
    columns, rows = struct.unpack_from("<2H", data, 40)
    points = 44 + (columns * rows + 1) * 4
    areas = json.load(open(areas_path))["areas"]

    stops = {area["key"]: [stop["lngLat"] for stop in area["stops"]] for area in areas}
    out = {key: [] for key in stops}
    scale = math.cos(math.radians(1.35))
    for index in range(count):
        x, y, height, radius = struct.unpack_from("<2H2B", data, points + index * 6)
        lng = min_lng + x / 65535 * (max_lng - min_lng)
        lat = min_lat + y / 65535 * (max_lat - min_lat)
        for key, centres in stops.items():
            if any(math.hypot(math.radians(lng - c[0]) * EARTH * scale, math.radians(lat - c[1]) * EARTH) <= REACH_METERS for c in centres):
                out[key] += [round((lng - min_lng) * 1e6), round((lat - min_lat) * 1e6), height, radius]
    with open(output_path, "w") as f:
        json.dump({"origin": [min_lng, min_lat], "areas": out}, f, separators=(",", ":"))
    for key, values in out.items():
        print(f"{key}: {len(values) // 4} crowns")


if __name__ == "__main__":
    main(*sys.argv[1:4])
