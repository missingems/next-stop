#!/usr/bin/env python3
"""Export the app's 3D bus (RouteBus.usdz) as a small binary mesh for the demo map.

Reads local files only and writes data/bus.bin. Nothing is fetched.

    unzip RouteBus.usdz -d <folder>
    python3 -I tools/export_bus.py <folder>/SingleDeck-SBS.usda data/bus.bin

The USDA mesh is triangles with per-vertex points, normals and palette UVs. The output
is a "BUS1" header, the vertex and index counts as uint32, the deduplicated vertices as
float32 [x, y, z, nx, ny, nz, u, v], then uint16 indices.
"""

import re
import struct
import sys


def values(source, name):
    match = re.search(re.escape(name) + r"\s*=\s*\[(.*?)\]", source, re.S)
    return [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", match.group(1))]


def main(usda_path, output_path):
    source = open(usda_path).read()
    points = values(source, "point3f[] points")
    normals = values(source, "normal3f[] normals")
    uvs = values(source, "texCoord2f[] primvars:st")
    counts = values(source, "int[] faceVertexCounts")
    corners = [int(v) for v in values(source, "int[] faceVertexIndices")]
    assert set(counts) == {3}

    vertices, lookup, indices = [], {}, []
    for corner in corners:
        vertex = tuple(points[corner * 3:corner * 3 + 3] + normals[corner * 3:corner * 3 + 3] + uvs[corner * 2:corner * 2 + 2])
        if vertex not in lookup:
            lookup[vertex] = len(vertices)
            vertices.append(vertex)
        indices.append(lookup[vertex])
    assert len(vertices) < 65536
    with open(output_path, "wb") as f:
        f.write(b"BUS1" + struct.pack("<2I", len(vertices), len(indices)))
        for vertex in vertices:
            f.write(struct.pack("<8f", *vertex))
        f.write(struct.pack(f"<{len(indices)}H", *indices))
    print(f"{len(vertices)} vertices, {len(indices) // 3} triangles")


if __name__ == "__main__":
    main(*sys.argv[1:3])
