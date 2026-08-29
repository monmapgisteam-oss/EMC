# -*- coding: utf-8 -*-
"""
Тээврийн маршрутыг ЖИНХЭНЭ замын сүлжээгээр тооцно.

    python tools/build_haul_routes.py

Оролт
    Road_truck/FeatureServer/0 — 35 шугам, 77 км, тээврийн замын сүлжээ
    Owoolgo_medee/FeatureServer/4 — овоолгын 2D хүрээ
    Multipatch_EMC/FeatureServer/0 (type1 = 1) — баяжуулах үйлдвэр
    public/data/pit_mesh.json — ил уурхайн ачаалах цэг

Гаралт
    public/data/haul_routes.json

АРГА
  1. Шугам бүрийн оройг метр рүү (ойролцоо тэгш өнцөгт) хөрвүүлж, 1 м-ээс
     ойр давхардсаныг нь хаяна.
  2. Зангилаа нэгтгэх: ӨӨР шугамын оройнууд SNAP метрийн дотор байвал нэг
     зангилаа болгож union-find-аар нийлүүлнэ. SNAP = 15 м үед сүлжээ 100 %
     нэг бүрэлдэхүүн болдог (10 м үед 99 %, 2 м үед ердөө 38 %) — тээврийн
     зам 30+ м өргөн, оройнууд яг давхцаж дижитайзчигдаагүй.
  3. Ачаалах цэг ба хүлээн авагч бүрийг сүлжээний ХАМГИЙН ОЙРЫН зангилаанд
     наана. Хүлээн авагчийн хувьд түүний полигоны БҮХ оройг харьцуулна —
     төвөөр нь тооцвол том овоолгын хувьд хэдэн зуун метр алдаа гарна.
  4. Ачаалах цэгээс хүлээн авагч бүр рүү Dijkstra-аар хамгийн богино зам.

ХЯЗГААР
  Хэрэв зам тухайн овоолгод хүрэхгүй бол сүүлчийн зангилаанаас полигон
  хүртэл ШУЛУУН холбоос нэмнэ. Уг холбоосын уртыг `stub` талбарт бичиж,
  гаралтын лог дээр анхааруулна — зохиосон зам болохыг нь мэдэж байх ёстой.
"""
import json, math, os, heapq, collections, urllib.request, urllib.parse

AGOL = "https://services7.arcgis.com/iErGCwr6emXIFjPR/arcgis/rest/services"
ROADS = f"{AGOL}/Road_truck/FeatureServer/0"
PILE2D = f"{AGOL}/Owoolgo_medee/FeatureServer/4"
BLDFS = f"{AGOL}/Multipatch_EMC/FeatureServer/0"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "haul_routes.json")
PIT = os.path.join(ROOT, "public", "data", "pit_mesh.json")

SNAP = 15.0          # зангилаа нэгтгэх хүлцэл, м
LAT0 = 49.02
SX = 111320.0 * math.cos(math.radians(LAT0))
SY = 110540.0

# Excel-ийн багана -> хүлээн авагч. lib/flow.ts дахь DEST_DEF-тэй тохирно.
DESTS = [
    ("BU",     "Баяжуулах үйлдвэр",  None),
    ("OV12",   "Овоолго 12",         ["Овоолго 12"]),
    ("OV14",   "Овоолго 14",         ["Овоолго 14"]),
    ("OV8A",   "Овоолго 8а",         ["Овоолго 8а"]),
    ("OV9A",   "Овоолго 9а · 8 · 9", ["Овоолго 9а", "Овоолго 8", "Овоолго 9"]),
    ("OV9B",   "Овоолго 9б",         ["Овоолго 9б"]),
    ("HOOSON", "Овоолго №1, 4, 11",  ["Овоолго 1", "Овоолго 4", "Овоолго 11"]),
]


def get(url, params):
    q = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}/query?{q}", timeout=90) as r:
        return json.load(r)


def xy(lon, lat):
    return (lon * SX, lat * SY)


def lonlat(p):
    return (round(p[0] / SX, 7), round(p[1] / SY, 7))


def d2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


class UF:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[b] = a


def build_graph():
    d = get(ROADS, {"where": "1=1", "returnGeometry": "true", "outSR": "4326",
                    "f": "json", "resultRecordCount": 5000})
    chains = []
    for f in d["features"]:
        for path in f["geometry"]["paths"]:
            ch = []
            for lon, lat in ((p[0], p[1]) for p in path):
                q = xy(lon, lat)
                if not ch or d2(ch[-1], q) > 1.0:
                    ch.append(q)
            if len(ch) > 1:
                chains.append(ch)

    pts = [q for ch in chains for q in ch]

    uf = UF(len(pts))
    grid = collections.defaultdict(list)
    for i, q in enumerate(pts):
        grid[(int(q[0] // SNAP), int(q[1] // SNAP))].append(i)
    t2 = SNAP * SNAP
    for i, q in enumerate(pts):
        gx, gy = int(q[0] // SNAP), int(q[1] // SNAP)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    if j > i and d2(q, pts[j]) <= t2:
                        uf.union(i, j)

    node, coords = {}, []
    for i in range(len(pts)):
        r = uf.find(i)
        if r not in node:
            node[r] = len(coords)
            coords.append(pts[i])
    nid = [node[uf.find(i)] for i in range(len(pts))]

    adj = collections.defaultdict(list)
    k = 0
    for ch in chains:
        for a in range(len(ch) - 1):
            u, v = nid[k + a], nid[k + a + 1]
            if u != v:
                w = math.sqrt(d2(coords[u], coords[v]))
                adj[u].append((v, w))
                adj[v].append((u, w))
        k += len(ch)
    return coords, adj


def nearest(coords, targets):
    """targets доторх аль нэг цэгт хамгийн ойр байх зангилаа -> (idx, зай)"""
    best, bd = -1, float("inf")
    for i, c in enumerate(coords):
        for t in targets:
            e = d2(c, t)
            if e < bd:
                bd, best = e, i
    return best, math.sqrt(bd)


def access_node(coords, targets, reach=300.0):
    """
    Хүлээн авагчид ХҮРЭХ зангилаа.

    Зүгээр «полигоны аль нэг оройд хамгийн ойр» гэвэл хөрш овоолгууд нэг
    зангилаа сонгодог: «Овоолго 9» зүүн тийш 104.1358 хүртэл сунадаг тул
    «Овоолго 12»-той нийлж, дэлгэц дээр хоёр яг ижил маршрут гардаг байв.
    Тиймээс эхлээд полигоноос `reach` метрийн дотор байгаа зангилаануудыг
    нэр дэвшүүлж, дотроос нь ТӨВД хамгийн ойрыг сонгоно — зам овоолгын
    захын үзүүр рүү биш, биен рүү нь чиглэнэ.
    """
    cx = sum(t[0] for t in targets) / len(targets)
    cy = sum(t[1] for t in targets) / len(targets)
    r2 = reach * reach
    cand = []
    for i, c in enumerate(coords):
        dv = min(d2(c, t) for t in targets)
        if dv <= r2:
            # оноо = полигон хүртэлх зай + 0.4 × төв хүртэлх зай.
            # Цэвэр төвөөр сонговол зам овоолгын биен рүү чиглэх ч зайлшгүй
            # 150–250 м-ийн зохиомол холбоос үлддэг; цэвэр ойрхноор сонговол
            # хөрш овоолгууд нийлдэг. Хоёрын дундаж нь хоёуланг шийднэ.
            cand.append((math.sqrt(dv) + 0.4 * math.sqrt(d2(c, (cx, cy))),
                         i, math.sqrt(dv)))
    if not cand:
        return nearest(coords, targets)
    cand.sort()
    return cand[0][1], cand[0][2]


def dijkstra(adj, src, n):
    dist = [float("inf")] * n
    prev = [-1] * n
    dist[src] = 0.0
    pq = [(0.0, src)]
    while pq:
        dv, u = heapq.heappop(pq)
        if dv > dist[u]:
            continue
        for v, w in adj[u]:
            nd = dv + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    return dist, prev


def dest_points(piles):
    """Хүлээн авагчийн полигоны бүх орой (метрээр)."""
    if piles is None:
        where = "type1 = 1"
        url = BLDFS
    else:
        where = " OR ".join(f"dugaar = '{p}'" for p in piles)
        url = PILE2D
    d = get(url, {"where": where, "returnGeometry": "true", "outSR": "4326",
                  "f": "json", "geometryPrecision": 6, "resultRecordCount": 5000})
    out = []
    for f in d.get("features", []):
        g = f.get("geometry") or {}
        for ring in g.get("rings", []) or g.get("paths", []):
            out.extend(xy(p[0], p[1]) for p in ring)
        if "x" in g:
            out.append(xy(g["x"], g["y"]))
    return out


def main():
    coords, adj = build_graph()
    print(f"сүлжээ: {len(coords)} зангилаа, {sum(len(v) for v in adj.values()) // 2} ирмэг "
          f"(SNAP {SNAP:.0f} м)")

    pit = json.load(open(PIT, encoding="utf-8"))["1"]
    src, src_d = nearest(coords, [xy(pit["lon"], pit["lat"])])
    print(f"ачаалах цэг -> сүлжээ: {src_d:.0f} м")

    dist, prev = dijkstra(adj, src, len(coords))

    out = {}
    for code, name, piles in DESTS:
        tgt = dest_points(piles)
        if not tgt:
            print(f"  {code:<7} ГЕОМЕТР ОЛДСОНГҮЙ")
            continue
        dn, stub = access_node(coords, tgt)
        if dist[dn] == float("inf"):
            print(f"  {code:<7} ЗАМ ОЛДСОНГҮЙ (сүлжээ тасарсан)")
            continue
        path = []
        u = dn
        while u != -1:
            path.append(u)
            u = prev[u]
        path.reverse()
        pts = [lonlat(coords[i]) for i in path]

        # Сүлжээ хүлээн авагчид хүрэхгүй бол шулуун холбоос нэмнэ
        if stub > 25:
            near = min(tgt, key=lambda t: d2(coords[dn], t))
            pts.append(list(lonlat(near)))

        out[code] = {"name": name, "pts": pts,
                     "len": round(dist[dn]), "stub": round(stub)}
        flag = "  ← ЗОХИОМОЛ ХОЛБООС" if stub > 300 else ""
        print(f"  {code:<7} {dist[dn]/1000:6.2f} км · {len(pts):>4} цэг · "
              f"буулт {stub:5.0f} м{flag}")

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"\n{OUT}  ({os.path.getsize(OUT)/1024:.0f} КБ)")


if __name__ == "__main__":
    main()
