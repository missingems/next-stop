#!/usr/bin/env python3
"""Export the stops and bus routes the demo map needs, clipped around each area.

Reads local files only and writes data/areas.json. Nothing is fetched.

    python3 -I tools/export_routes.py <busRoutes.json> <serviceStops.json> \
        <serviceOperators.json> <busStops.json> data/areas.json

busRoutes.json and serviceStops.json pair each service's directions by index: an encoded
polyline and the ordered stop codes. busStops.json is a list of LTA bus stops with
BusStopCode, Description, RoadName, Latitude and Longitude.
"""

import json
import math
import sys

AREAS = [
    ("orchard", "Orchard", 1.30420, 103.83190),
    ("bugis", "Bugis", 1.30010, 103.85560),
    ("tampines", "Tampines", 1.35390, 103.94440),
    ("jurong-east", "Jurong East", 1.33340, 103.74220),
    ("toa-payoh", "Toa Payoh", 1.33290, 103.84720),
    ("city-hall", "City Hall", 1.29340, 103.85520),
]

AREA_METERS = 550
STOPS_PER_AREA = 4
MIN_APPROACHING = 4
SNAP_METERS = 60
UPSTREAM_METERS = 1600
DOWNSTREAM_METERS = 600
MIN_UPSTREAM_METERS = 600
SIMPLIFY_METERS = 1.5
EARTH = 6_371_008.8


def decode(encoded):
    points, index, lat, lng = [], 0, 0, 0
    while index < len(encoded):
        for axis in (0, 1):
            shift, result = 0, 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lng += delta
        points.append((lat / 1e5, lng / 1e5))
    return points


def encode(points):
    out, last = [], (0, 0)
    for lat, lng in points:
        current = (round(lat * 1e5), round(lng * 1e5))
        for value in (current[0] - last[0], current[1] - last[1]):
            value = ~(value << 1) if value < 0 else value << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        last = current
    return "".join(out)


def local(point, origin):
    scale = math.cos(math.radians(origin[0]))
    return (
        math.radians(point[1] - origin[1]) * EARTH * scale,
        math.radians(point[0] - origin[0]) * EARTH,
    )


def distance(a, b):
    x, y = local(b, a)
    return math.hypot(x, y)


def nearest(points, centre):
    best = (float("inf"), 0, 0.0)
    for i in range(len(points) - 1):
        ax, ay = local(points[i], centre)
        bx, by = local(points[i + 1], centre)
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        t = 0 if length == 0 else max(0, min(1, -(ax * dx + ay * dy) / length))
        d = math.hypot(ax + dx * t, ay + dy * t)
        if d < best[0]:
            best = (d, i, t)
    return best


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def clip(points, segment, t):
    stop = lerp(points[segment], points[segment + 1], t)
    before, travelled, previous = [stop], 0.0, stop
    for i in range(segment, -1, -1):
        step = distance(previous, points[i])
        if travelled + step > UPSTREAM_METERS:
            before.append(lerp(previous, points[i], (UPSTREAM_METERS - travelled) / step))
            travelled = UPSTREAM_METERS
            break
        before.append(points[i])
        travelled += step
        previous = points[i]
    upstream = travelled
    after, travelled, previous = [], 0.0, stop
    for i in range(segment + 1, len(points)):
        step = distance(previous, points[i])
        if travelled + step > DOWNSTREAM_METERS:
            after.append(lerp(previous, points[i], (DOWNSTREAM_METERS - travelled) / step))
            break
        after.append(points[i])
        travelled += step
        previous = points[i]
    return list(reversed(before)) + after, upstream


def simplify(points):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        origin = points[first]
        ax, ay = 0.0, 0.0
        bx, by = local(points[last], origin)
        length = math.hypot(bx - ax, by - ay) or 1
        worst, index = 0.0, None
        for i in range(first + 1, last):
            px, py = local(points[i], origin)
            d = abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length
            if d > worst:
                worst, index = d, i
        if index is not None and worst > SIMPLIFY_METERS:
            keep[index] = True
            stack += [(first, index), (index, last)]
    return [p for p, k in zip(points, keep) if k]


def regular(service):
    return not (service.endswith("e") or service.startswith("NR") or service.startswith("CT"))


def main(routes_path, service_stops_path, operators_path, stops_path, output_path):
    routes = json.load(open(routes_path))
    service_stops = json.load(open(service_stops_path))
    operators = json.load(open(operators_path))
    stops = {stop["BusStopCode"]: stop for stop in json.load(open(stops_path))}
    decoded = {service: [decode(line) if line else [] for line in lines] for service, lines in routes.items()}

    calls = {}
    for service, directions in service_stops.items():
        if not regular(service) or service not in decoded:
            continue
        for direction, codes in enumerate(directions):
            for position, code in enumerate(codes):
                calls.setdefault(code, []).append((service, direction, position, codes))

    areas = []
    for key, name, lat, lng in AREAS:
        centre = (lat, lng)
        candidates = []
        for code, stop in stops.items():
            point = (stop["Latitude"], stop["Longitude"])
            if distance(centre, point) > AREA_METERS or code not in calls:
                continue
            services, seen = [], set()
            for service, direction, position, codes in calls[code]:
                if service in seen or position == len(codes) - 1:
                    continue
                seen.add(service)
                destination = stops.get(codes[-1], {}).get("Description")
                if not destination:
                    continue
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
            approaching = sum("line" in entry for entry in services)
            if approaching >= MIN_APPROACHING:
                candidates.append((approaching, len(services), code, stop, services))
        candidates.sort(key=lambda c: (-c[0], -c[1]))
        picked, names = [], set()
        for approaching, count, code, stop, services in candidates:
            if stop["Description"] in names or len(picked) >= STOPS_PER_AREA:
                continue
            names.add(stop["Description"])
            services.sort(key=lambda entry: (len(entry["service"].rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ")), entry["service"]))
            picked.append({
                "code": code,
                "name": stop["Description"],
                "road": stop["RoadName"],
                "lngLat": [round(stop["Longitude"], 6), round(stop["Latitude"], 6)],
                "services": services,
            })
        areas.append({"key": key, "name": name, "stops": picked})
        print(f"{name}: " + "; ".join(f"{s['name']} ({sum('line' in e for e in s['services'])}/{len(s['services'])})" for s in picked))
    with open(output_path, "w") as f:
        json.dump({"areas": areas}, f, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main(*sys.argv[1:6])
