# -*- coding: utf-8 -*-
"""
DWG (ил уурхайн сарын multipatch) -> хаялбарын полигон -> GeoJSON

Ажиллуулах (ArcGIS Pro-гийн python-оор):
  "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\envs\\arcgispro-py3\\python.exe" tools\\build_pit.py

Гаралт: data/pit.geojson  — талбарууд: m (сар), elev (түвшин, м)
        data/pit_rim.geojson — сар бүрийн питийн хүрээ

DWG-д солбицол тодорхойлогдоогүй тул UTM 48N (EPSG:32648) гэж үзнэ.
Excel-ийн Түвшин баганатай яг тохирох өндрүүдээр контур татна.
"""
import arcpy, os, json, glob, shutil, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pit_mask import masked_raster     # build_pit_mesh.py-тэй ИЖИЛ маск

SRC     = r"\\SARUUL\Share\EMC\dwg"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
SR_IN   = arcpy.SpatialReference(32648)   # WGS 84 / UTM zone 48N
SR_OUT  = arcpy.SpatialReference(4326)    # WGS 84 lon/lat
CELL    = 2.0
# Excel «Нийт орд arcgis» -> Түвшин баганын утгууд
LEVELS  = [1175, 1190, 1205, 1220, 1235, 1250, 1265, 1280,
           1295, 1310, 1325, 1340, 1355, 1370, 1385, 1400, 1415, 1430, 1445, 1460]
MIN_AREA   = 1500.0  # м² — үүнээс жижиг хэлтэрхийг хаяна
SIMPLIFY_M = 3.0     # м — ерөнхийлөх хүлцэл
PRECISION  = 6       # аравтын орон (~0.1 м)

arcpy.env.overwriteOutput = True
arcpy.CheckOutExtension("3D")
arcpy.CheckOutExtension("Spatial")

scratch = os.path.join(os.environ.get("TEMP", "."), "pitwork")
if os.path.isdir(scratch):
    shutil.rmtree(scratch, ignore_errors=True)
os.makedirs(scratch)
gdb = os.path.join(scratch, "work.gdb")
arcpy.management.CreateFileGDB(scratch, "work.gdb")


def mp_to_raster(mp_fc, out_ras):
    """arcpy хувилбар бүрт нэр өөр тул аль ажиллахыг нь олно."""
    for fn in (getattr(arcpy.conversion, "MultipatchToRaster", None),
               getattr(arcpy.ddd, "MultipatchToRaster", None),
               getattr(arcpy.ddd, "MultiPatchToRaster", None)):
        if fn is None:
            continue
        fn(mp_fc, out_ras, CELL)
        return
    raise RuntimeError("MultipatchToRaster хэрэгсэл олдсонгүй")


def round_coords(o):
    """Координатын аравтын орныг богиносгож файлын хэмжээг 3-4 дахин багасгана."""
    if isinstance(o, float):
        return round(o, PRECISION)
    if isinstance(o, list):
        return [round_coords(x) for x in o]
    return o


def to_geojson(fc, basename):
    """FeaturesToJSON нь өргөтгөлөө өөрөө нэмдэг тул гарсан файлыг хайж олно."""
    out = os.path.join(scratch, basename)
    for p in glob.glob(out + "*"):
        try:
            os.remove(p)
        except OSError:
            pass
    arcpy.conversion.FeaturesToJSON(fc, out, geoJSON="GEOJSON")
    found = sorted(glob.glob(out + "*"))
    if not found:
        raise RuntimeError("GeoJSON гарсангүй: " + basename)
    with open(found[0], encoding="utf-8") as f:
        return json.load(f)


bench_parts, rim_parts = [], []

for path in sorted(glob.glob(os.path.join(SRC, "CMK_2023*.DWG"))):
    month = int(os.path.basename(path)[8:10])
    print("--- сар %d : %s" % (month, os.path.basename(path)), flush=True)

    mp_src = os.path.join(path, "MultiPatch")
    mp = os.path.join(gdb, "mp_%02d" % month)
    arcpy.management.CopyFeatures(mp_src, mp)
    arcpy.management.DefineProjection(mp, SR_IN)

    ras = os.path.join(scratch, "dem_%02d.tif" % month)
    mp_to_raster(mp, ras)

    # ---- ЗӨВХӨН питийн хотгороор тайрна.
    # Өмнө нь бүх 3.2 x 3.0 км хэмжилтийн талбайг контурлаж байсан тул
    # овоолго, налуу дээрх контурын цагиргууд ч «хаялбар» болж, газрын
    # зураг дээр питээс гадуур хөвөгч хэлтэрхий үүсгэдэг байсан.
    ras_pit = masked_raster(ras, os.path.join(scratch, "dem_pit_%02d.tif" % month))

    # ---- хаялбарын контур
    cont = os.path.join(gdb, "cont_%02d" % month)
    arcpy.ddd.ContourList(ras_pit, cont, LEVELS)

    poly = os.path.join(gdb, "poly_%02d" % month)
    arcpy.management.FeatureToPolygon(cont, poly, None, "NO_ATTRIBUTES")

    # контурын өндрийг полигон руу spatial join-оор буулгана
    joined = os.path.join(gdb, "join_%02d" % month)
    arcpy.analysis.SpatialJoin(poly, cont, joined,
                               "JOIN_ONE_TO_ONE", "KEEP_COMMON",
                               match_option="BOUNDARY_TOUCHES")

    # ---- ерөнхийлөх: жижиг хэлтэрхийг хаяж, оройн цэгийг цөөлнө
    simp = os.path.join(gdb, "simp_%02d" % month)
    arcpy.cartography.SimplifyPolygon(
        joined, simp, "POINT_REMOVE", "%s Meters" % SIMPLIFY_M,
        "%s SquareMeters" % MIN_AREA, "RESOLVE_ERRORS", "NO_KEEP")

    prj = os.path.join(gdb, "prj_%02d" % month)
    arcpy.management.Project(simp, prj, SR_OUT)

    fc = to_geojson(prj, "bench_%02d" % month)
    if fc.get("features"):
        print("    талбарууд:", list((fc["features"][0].get("properties") or {}).keys()), flush=True)

    kept = 0
    for feat in fc.get("features", []):
        p = feat.get("properties") or {}
        elev = p.get("Contour", p.get("CONTOUR", p.get("Elevation", p.get("contour"))))
        if elev is None:
            continue
        geom = feat["geometry"]
        geom["coordinates"] = round_coords(geom["coordinates"])
        bench_parts.append({
            "type": "Feature",
            "properties": {"m": month, "elev": int(round(float(elev)))},
            "geometry": geom
        })
        kept += 1
    print("    хаялбар полигон: %d" % kept, flush=True)

    # ---- питийн хүрээ
    fp = os.path.join(gdb, "fp_%02d" % month)
    arcpy.conversion.RasterToPolygon(
        arcpy.sa.Con(arcpy.sa.IsNull(ras_pit), 0, 1), fp, "SIMPLIFY", "Value")
    arcpy.management.MakeFeatureLayer(fp, "fp_lyr_%02d" % month, "gridcode = 1")
    fp = "fp_lyr_%02d" % month
    fpp = os.path.join(gdb, "fpp_%02d" % month)
    arcpy.management.Project(fp, fpp, SR_OUT)
    fc2 = to_geojson(fpp, "rim_%02d" % month)
    for feat in fc2.get("features", []):
        geom = feat["geometry"]
        geom["coordinates"] = round_coords(geom["coordinates"])
        rim_parts.append({"type": "Feature",
                          "properties": {"m": month},
                          "geometry": geom})


def write(name, feats):
    out = os.path.join(OUT_DIR, name)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False)
    print("бичив %s  (%d феатур, %.1f KB)" % (name, len(feats), os.path.getsize(out) / 1024))


write("pit.geojson", bench_parts)
write("pit_rim.geojson", rim_parts)
print("ДУУСЛАА")
