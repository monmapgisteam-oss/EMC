# -*- coding: utf-8 -*-
"""
Уурхайн ачааны машины 3D загвар -> public/data/truck.glb

Ажиллуулах:  npm run data:truck   (эсвэл  python tools/build_truck.py)

Яагаад өөрсдөө үүсгэв: ArcGIS-ийн `primitive: "cube"` нь зүгээр л шоо гардаг,
Esri-гийн бэлэн 3D сангаас уурхайн ачааны машин олдсонгүй. Питийн гадаргууг
GLB болгосон яг тэр аргаар (tools/build_pit_mesh.py) энд ч ашиглав.

Тэнхлэг — ArcGIS-ийн glTF заавраар:
    +X = баруун тийш,  +Y = дээш,  −Z = урагш (машины хамар)

Хоёр материал:
    0 «body» — цайвар, ArcGIS дээр төлөвийн өнгөөр TINT хийгдэнэ
    1 «dark» — дугуй, цонх, рам; бараан хэвээр үлдэнэ
"""
import os, json, struct
import math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "truck.glb")

BODY, DARK = 0, 1
groups = {BODY: [], DARK: []}


def quad(mat, a, b, c, d):
    groups[mat].append((a, b, c))
    groups[mat].append((a, c, d))


def box(mat, x0, x1, y0, y1, z0, z1):
    p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    quad(mat, p[4], p[5], p[6], p[7])
    quad(mat, p[1], p[0], p[3], p[2])
    quad(mat, p[0], p[4], p[7], p[3])
    quad(mat, p[5], p[1], p[2], p[6])
    quad(mat, p[3], p[7], p[6], p[2])
    quad(mat, p[0], p[1], p[5], p[4])


def wheel(mat, cx, cy, cz, r, half_w, seg=24):
    """Тэнхлэг нь X (зүүн-баруун)."""
    ring = [(math.cos(2 * math.pi * i / seg), math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    left = [(cx - half_w, cy + s * r, cz + c * r) for c, s in ring]
    right = [(cx + half_w, cy + s * r, cz + c * r) for c, s in ring]
    for i in range(seg):
        j = (i + 1) % seg
        quad(mat, left[i], right[i], right[j], left[j])
    for i in range(1, seg - 1):
        groups[mat].append((left[0], left[i], left[i + 1]))
        groups[mat].append((right[0], right[i + 1], right[i]))


# ----------------------------------------------------------------- геометр
# CAT 793 маягийн хатуу тэвшит ачааны машин.
#   Урт 12.8 м · өргөн 8.0 м · өндөр 6.2 м · дугуйн радиус 1.9 м
#   Бүтцийн дараалал: доод рам -> ТЭГШ тэвш -> урд хана + халхавч -> бүхээг.

HW = 3.75
R = 1.90
AX = R
FRONT_AXLE = -3.9
REAR_AXLE = 3.3

# рам ба урд бампер
box(DARK, -2.7, 2.7, AX - 0.7, AX + 0.7, -5.4, 5.6)
box(DARK, -3.5, 3.5, AX - 0.3, AX + 0.7, -6.4, -5.4)

# тэвш
BODY_Y0, BODY_Y1 = AX + 0.7, AX + 4.3
box(BODY, -HW, HW, BODY_Y0, BODY_Y1, -2.4, 6.4)
box(BODY, -HW, HW, BODY_Y0 - 0.6, BODY_Y0 + 0.2, 4.6, 6.4)
box(BODY, -HW - 0.25, -HW + 0.15, BODY_Y1 - 0.7, BODY_Y1, -2.4, 6.4)
box(BODY, HW - 0.15, HW + 0.25, BODY_Y1 - 0.7, BODY_Y1, -2.4, 6.4)

# урд хана + жолоочийн дээрх халхавч
box(BODY, -HW, HW, BODY_Y0, BODY_Y1, -2.9, -2.4)
box(BODY, -HW, HW, BODY_Y1 - 0.5, BODY_Y1, -6.1, -2.9)

# бүхээг
CAB_Y1 = BODY_Y1 - 0.6
box(BODY, -3.35, -0.9, AX + 0.7, CAB_Y1, -5.7, -3.4)
box(DARK, -3.45, -0.8, CAB_Y1 - 1.5, CAB_Y1 - 0.15, -5.75, -3.35)
box(DARK, -3.5, -0.75, AX + 0.55, AX + 0.85, -5.8, -3.3)

# шат
box(DARK, 0.9, 1.6, AX + 0.2, CAB_Y1 - 0.2, -6.0, -5.6)

# дугуй: урд ганц, хойд хос
wheel(DARK, -(HW - 0.55), AX, FRONT_AXLE, R, 0.62)
wheel(DARK, (HW - 0.55), AX, FRONT_AXLE, R, 0.62)
for sx in (-1, 1):
    wheel(DARK, sx * (HW - 0.50), AX, REAR_AXLE, R, 0.52)
    wheel(DARK, sx * (HW - 1.60), AX, REAR_AXLE, R, 0.52)


# ------------------------------------------------------------------- GLB
def build():
    positions, normals, prims = [], [], []
    for mat in (BODY, DARK):
        start = len(positions)
        for (a, b, c) in groups[mat]:
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            n = (nx / ln, ny / ln, nz / ln)
            for p in (a, b, c):
                positions.append(p)
                normals.append(n)
        prims.append((mat, start, len(positions) - start))

    pos_b = b"".join(struct.pack("<3f", *p) for p in positions)
    nrm_b = b"".join(struct.pack("<3f", *n) for n in normals)
    blob = pos_b + nrm_b

    xs = [p[0] for p in positions]; ys = [p[1] for p in positions]; zs = [p[2] for p in positions]
    gltf = {
        "asset": {"version": "2.0", "generator": "EMC build_truck.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [
            {"attributes": {"POSITION": 2 * i, "NORMAL": 2 * i + 1}, "material": mat, "mode": 4}
            for i, (mat, _, _) in enumerate(prims)
        ]}],
        "materials": [
            {"name": "body", "pbrMetallicRoughness": {
                "baseColorFactor": [0.93, 0.78, 0.24, 1.0],
                "metallicFactor": 0.1, "roughnessFactor": 0.6}},
            {"name": "dark", "pbrMetallicRoughness": {
                "baseColorFactor": [0.12, 0.12, 0.13, 1.0],
                "metallicFactor": 0.2, "roughnessFactor": 0.85}},
        ],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_b), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_b), "byteLength": len(nrm_b), "target": 34962},
        ],
        "accessors": [],
    }
    for (mat, start, count) in prims:
        gltf["accessors"].append({
            "bufferView": 0, "byteOffset": start * 12, "componentType": 5126,
            "count": count, "type": "VEC3",
            "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]})
        gltf["accessors"].append({
            "bufferView": 1, "byteOffset": start * 12, "componentType": 5126,
            "count": count, "type": "VEC3"})

    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((-len(js)) % 4)
    blob += b"\x00" * ((-len(blob)) % 4)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(b"glTF")
        f.write(struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(blob)))
        f.write(struct.pack("<I", len(js))); f.write(b"JSON"); f.write(js)
        f.write(struct.pack("<I", len(blob))); f.write(b"BIN\x00"); f.write(blob)

    print("бичив public/data/truck.glb  ·  %d гурвалжин  ·  %.1f KB"
          % (len(positions) // 3, os.path.getsize(OUT) / 1024))
    print("хэмжээ: %.1f x %.1f x %.1f м (өргөн/өндөр/урт)"
          % (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))


build()
