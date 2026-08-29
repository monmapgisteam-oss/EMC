# -*- coding: utf-8 -*-
"""
Тээврийн маршрут: ил уурхайгаас хүлээн авагч бүр рүү — ЖИНХЭНЭ замаар

Ажиллуулах (ArcGIS Pro-гийн python):
  "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\envs\\arcgispro-py3\\python.exe" tools/build_haul_routes.py

Гаралт: public/data/haul_routes.json

Яагаад ArcGIS хэрэгтэй вэ:
  «Зам» давхаргын 3 568 шугам нь CAD-аас гаралтай тул огтлолцол дээрээ
  нийтлэг оройгүй — түүхийгээр нь граф болгоход хамгийн том холбогдсон
  бүрэлдэхүүн ердөө 10 зангилаа гарсан. `FeatureToLine` нь огтлолцол бүрт
  шугамыг тасалж (планаржуулж) жинхэнэ сүлжээ болгоно.

Дараа нь: зангилааг 1 м-ийн нарийвчлалаар нэгтгэж граф байгуулаад,
питийн ачаалах цэгээс хүлээн авагч бүр рүү Dijkstra-гаар хамгийн богино
замыг олно. Урт нь налууг тооцсон 3D урт.
"""
import arcpy, os, json, math, heapq, shutil
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "haul_routes.json")

AGOL = "https://services7.arcgis.com/iErGCwr6emXIFjPR/arcgis/rest/services"
ROADS = AGOL + "/Engineering_EMC/FeatureServer/22"
PILES = AGOL + "/Owoolgo_medee/FeatureServer/4"
BLD = AGOL + "/Multipatch_EMC/FeatureServer/0"

SR = arcpy.SpatialReference(4326)
SNAP_M = 1.0                     # зангилаа нэгтгэх нарийвчлал, м
PIT_ENV = (104.1086, 49.0072, 104.1492, 49.0329)

# Excel-ийн хүлээн авагч -> газарзүйн бай
DESTS = [
    ("BU",     "Баяжуулах үйлдвэр",        None),
    ("OV12",   "Овоолго 12",               ["Овоолго 12"]),
    ("OV14",   "Овоолго 14",               ["Овоолго 14"]),
    ("OV8A",   "Овоолго 8а",               ["Овоолго 8а"]),
    ("OV9A",   "Овоолго 9а · 8 · 9",       ["Овоолго 9а", "Овоолго 8", "Овоолго 9"]),
    ("OV9B",   "Овоолго 9б",               ["Овоолго 9б"]),
    ("HOOSON", "Овоолго №1, 4, 11",        ["Овоолго 1", "Овоолго 4", "Овоолго 11"]),
]

arcpy.env.overwriteOutput = True
arcpy.env.outputZFlag = "Enabled"

scratch = os.path.join(os.environ.get("TEMP", "."), "haul")
if os.path.isdir(scratch):
    shutil.rmtree(scratch, ignore_errors=True)
os.makedirs(scratch)
gdb = os.path.join(scratch, "w.gdb")
arcpy.management.CreateFileGDB(scratch, "w.gdb")

KX = 111320 * math.cos(math.radians(49.02))
KY = 110540


def m_xy(lon, lat):
    return lon * KX, lat * KY


def dist3(a, b):
    ax, ay = m_xy(a[0], a[1]); bx, by = m_xy(b[0], b[1])
    dz = (b[2] or 0) - (a[2] or 0)
    return math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + dz * dz)


def nkey(p):
    x, y = m_xy(p[0], p[1])
    return (int(round(x / SNAP_M)), int(round(y / SNAP_M)))


# ------------------------------------------------- 1) зам -> планаржуулах
print("зам татаж байна…", flush=True)
raw = os.path.join(gdb, "roads_raw")
arcpy.management.CopyFeatures(ROADS, raw)
print("  түүхий:", arcpy.management.GetCount(raw)[0], flush=True)

pl = os.path.join(gdb, "roads_planar")
arcpy.management.FeatureToLine(raw, pl, "0.5 Meters", "NO_ATTRIBUTES")
print("  планаржуулсан:", arcpy.management.GetCount(pl)[0], flush=True)

prj = os.path.join(gdb, "roads_wgs")
arcpy.management.Project(pl, prj, SR)

# ------------------------------------------------------------ 2) граф
adj = defaultdict(list)          # nkey -> [(nkey, урт, [цэгүүд])]
pos = {}                         # nkey -> (lon, lat, z)
with arcpy.da.SearchCursor(prj, ["SHAPE@"]) as cur:
    for (shp,) in cur:
        if shp is None:
            continue
        for part in shp:
            pts = [(p.X, p.Y, p.Z if p.Z is not None else 0.0) for p in part if p]
            if len(pts) < 2:
                continue
            a, b = nkey(pts[0]), nkey(pts[-1])
            if a == b:
                continue
            L = sum(dist3(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
            pos.setdefault(a, pts[0]); pos.setdefault(b, pts[-1])
            adj[a].append((b, L, pts))
            adj[b].append((a, L, pts[::-1]))

print("зангилаа:", len(pos), "| ирмэг:", sum(len(v) for v in adj.values()) // 2, flush=True)

# хамгийн том холбогдсон бүрэлдэхүүн
seen, best = set(), []
for n in pos:
    if n in seen:
        continue
    stack, comp = [n], []
    seen.add(n)
    while stack:
        c = stack.pop(); comp.append(c)
        for (m, _, _) in adj[c]:
            if m not in seen:
                seen.add(m); stack.append(m)
    if len(comp) > len(best):
        best = comp
core = set(best)
print("хамгийн том бүрэлдэхүүн: %d зангилаа (%.0f%%)" % (len(core), len(core) / len(pos) * 100), flush=True)


def nearest_node(lon, lat, within=None):
    tx, ty = m_xy(lon, lat)
    bn, bd = None, 1e18
    src = within if within is not None else pos.keys()
    for k in src:
        p = pos[k]
        x, y = m_xy(p[0], p[1])
        d = (x - tx) ** 2 + (y - ty) ** 2
        if d < bd:
            bd, bn = d, k
    return bn, math.sqrt(bd)


# --------------------------------------------- 3) ачаалах цэг ба хүлээн авагч
# Питийн ачаалах цэг = питийн хүрээн доторх ХАМГИЙН НАМ зангилаа
pit_nodes = [k for k in core
             if PIT_ENV[0] <= pos[k][0] <= PIT_ENV[2] and PIT_ENV[1] <= pos[k][1] <= PIT_ENV[3]]
if not pit_nodes:
    raise SystemExit("Питийн хүрээнд зам олдсонгүй")
load_node = min(pit_nodes, key=lambda k: pos[k][2])
print("ачаалах цэг: %.6f, %.6f, %.0f м" % pos[load_node], flush=True)


def extent_center(url, where):
    d = arcpy.da.SearchCursor  # ашиглахгүй — REST-ээр авна
    import urllib.request, urllib.parse, gzip as gz
    q = urllib.parse.urlencode({"where": where, "returnExtentOnly": "true",
                                "outSR": "4326", "f": "json"})
    req = urllib.request.Request(url + "/query?" + q, headers={"Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
    if b[:2] == b"\x1f\x8b":
        b = gz.decompress(b)
    e = json.loads(b.decode("utf-8")).get("extent")
    if not e:
        return None
    return ((e["xmin"] + e["xmax"]) / 2, (e["ymin"] + e["ymax"]) / 2)


# ------------------------------------------------------------ 4) Dijkstra
def shortest(src, dst):
    dist = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst:
            break
        if d > dist.get(u, 1e18):
            continue
        for (v, L, pts) in adj[u]:
            nd = d + L
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = (u, pts)
                heapq.heappush(pq, (nd, v))
    if dst not in dist:
        return None, 0
    path, cur = [], dst
    while cur != src:
        u, pts = prev[cur]
        path = list(pts) + path
        cur = u
    return path, dist[dst]


routes = {}
for code, name, piles in DESTS:
    if piles:
        where = " OR ".join("dugaar = '%s'" % p for p in piles)
        c = extent_center(PILES, where)
    else:
        c = extent_center(BLD, "type1 = 1")
    if not c:
        print("  %-7s бай олдсонгүй" % code, flush=True)
        continue

    tn, snap = nearest_node(c[0], c[1], core)
    path, L = shortest(load_node, tn)
    if not path:
        print("  %-7s зам холбогдохгүй" % code, flush=True)
        continue

    # цэгүүдийг сийрэгжүүлж, 6 оронтой болгоно
    thin = [path[0]]
    for p in path[1:]:
        if dist3(thin[-1], p) > 4:
            thin.append(p)
    if thin[-1] != path[-1]:
        thin.append(path[-1])

    routes[code] = {
        "name": name,
        "len": round(L, 1),
        "snap": round(snap, 1),
        "path": [[round(p[0], 6), round(p[1], 6), round(p[2], 1)] for p in thin],
    }
    print("  %-7s %-22s %6.0f м · %4d цэг · буулт %.0f м"
          % (code, name, L, len(thin), snap), flush=True)

out = {
    "load": [round(pos[load_node][0], 6), round(pos[load_node][1], 6), round(pos[load_node][2], 1)],
    "routes": routes,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("бичив public/data/haul_routes.json  (%d маршрут, %.1f KB)"
      % (len(routes), os.path.getsize(OUT) / 1024))
