"use client";

/* ==========================================================================
   ArcGIS SceneView — бүхэлдээ browser талд ажиллана.
   page.tsx-ээс  dynamic(..., { ssr: false })  -ээр дуудагдана.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import Map from "@arcgis/core/Map";
import Basemap from "@arcgis/core/Basemap";
import SceneView from "@arcgis/core/views/SceneView";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import TileLayer from "@arcgis/core/layers/TileLayer";
import ElevationLayer from "@arcgis/core/layers/ElevationLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Mesh from "@arcgis/core/geometry/Mesh";
import Point from "@arcgis/core/geometry/Point";
import * as wmUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import esriConfig from "@arcgis/core/config";

import { useStore } from "@/lib/store";
import {
  SVC, C, COL_NAMES, BASEMAPS, ELEV_URL, GROUND_OPACITY, GROUND_NM,
  BU_TYPE, BLD_COLOR, PILE2COL, pileWhere, type BasemapKey,
} from "@/lib/config";
import { cuOf, metalSum, moOf, sumCol } from "@/lib/excel";
import {
  loadDests, damCenter, tailingsPath, FlowSim,
  type Dest,
} from "@/lib/flow";
import { fmt, hex, num1 } from "@/lib/format";

/** @arcgis/core-ийн assets-ыг node_modules-оос хуулахгүйгээр CDN-ээс авна */
esriConfig.assetsPath = "https://js.arcgis.com/4.34/@arcgis/core/assets";

interface MeshInfo { url: string; lon: number; lat: number; z: number }

/**
 * Контейнерийн өндөр хоёр кадр дараалан тогтвортой болтол хүлээнэ.
 *
 * SceneView үүсэх агшинд контейнер нь 0 өндөртэй байвал ArcGIS анхны
 * кадраа хоосноор зурдаг. React-ийн hydration + dynamic import дуусах үед
 * grid-ийн байрлал хараахан суугаагүй байж болзошгүй тул хэмжээ суусны
 * ДАРАА л view үүсгэнэ.
 */
function waitStableSize(el: HTMLElement, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };

    /* Хамгаалалт нь rAF-ээс ГАДНА байх ёстой. Хэрэв rAF ажиллахгүй бол
       (арын таб, headless орчин) rAF доторх шалгалт хэзээ ч биелэхгүй тул
       газрын зураг мөнхөд «ачаалж байна» гэж үлдэнэ. */
    const guard = setTimeout(finish, timeoutMs);

    let last = -1, same = 0;
    const tick = () => {
      if (done) return;
      const h = el.clientHeight, w = el.clientWidth;
      if (h > 0 && w > 0 && h === last) {
        if (++same >= 2) { clearTimeout(guard); return finish(); }
      } else {
        same = 0;
      }
      last = h;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export default function MineScene() {
  const store = useStore();
  const { m, lang, t, setSel, setBlk, setTip } = store;

  const divRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SceneView | null>(null);
  const mapRef = useRef<Map | null>(null);
  const layersRef = useRef<Record<string, any>>({});
  const meshCache = useRef<Record<number, Mesh>>({});
  const bldCache = useRef<Record<string, any>>({});
  const meshInfo = useRef<Record<string, MeshInfo>>({});
  /* Сонгогдсон сар / хэл нь event handler дотор шинэ утгаараа хэрэгтэй */
  const stateRef = useRef({ m, lang });
  stateRef.current = { m, lang };

  const [ready, setReady] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [groundStep, setGroundStep] = useState(0);
  const [basemapKey, setBasemapKey] = useState<BasemapKey>("imagery");
  const [pitUrl, setPitUrl] = useState("");
  const [pitMsg, setPitMsg] = useState<{ text: string; cls: string }>({ text: "", cls: "" });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const flowTimer = useRef<number | null>(null);
  const simRef = useRef<FlowSim | null>(null);
  const destsRef = useRef<Dest[]>([]);
  /* Байнгын Graphic обьектууд — давталт бүрт ДАХИН ҮҮСГЭХГҮЙ (анивчихаас сэргийлнэ) */
  const truckGfx = useRef<Graphic[]>([]);
  const truckKey = useRef<string[]>([]);
  const tailGfx = useRef<Graphic[]>([]);
  const tailPath = useRef<{ lon: number; lat: number; z: number }[]>([]);

  /* --------------------------------------------------------- эхлүүлэх */
  useEffect(() => {
    if (!divRef.current || viewRef.current) return;
    let cancelled = false;
    let disposed: (() => void) | null = null;

    waitStableSize(divRef.current).then(() => {
      if (cancelled || viewRef.current) return;
      disposed = init();
    });

    function init() {

    const dark =
      document.documentElement.getAttribute("data-theme") === "dark" ||
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;

    const mkBasemap = (k: BasemapKey) =>
      new Basemap({ baseLayers: [new TileLayer({ url: BASEMAPS[k].url })], title: k });

    const L = layersRef.current;

    L.roads = new FeatureLayer({
      url: SVC.roads, title: "roads", outFields: ["badedturl", "azgt", "txt"],
      popupEnabled: false, elevationInfo: { mode: "on-the-ground" },
      renderer: {
        type: "unique-value", field: "badedturl",
        uniqueValueInfos: [
          { value: 0, label: "Авто зам", symbol: line(2.4, 0.85) },
          { value: 2, label: "Бетон зам", symbol: line(1.7, 0.6) },
          { value: 3, label: "Сайжруулсан шороон", symbol: line(1.5, 0.6, true) },
          { value: 1, label: "Явган зам", symbol: line(1.0, 0.6, true) },
        ],
        defaultSymbol: line(1, 0.45),
      } as any,
    });
    function line(w: number, a: number, dash = false) {
      const s: any = { type: "simple-line", color: hex(dark ? "#cfd6d3" : "#5b6663", a), width: w };
      if (dash) s.style = "dash";
      return s;
    }

    L.dam = new FeatureLayer({
      url: SVC.dam, title: "dam", outFields: ["Date"], popupEnabled: false,
      elevationInfo: { mode: "on-the-ground" },
      /* Далангийн сервис 2024/01-ээс эхэлдэг — 2023 оны мөр байхгүй */
      definitionExpression: "Date = '2024/01'",
      renderer: {
        type: "simple",
        symbol: {
          type: "simple-fill", color: hex(dark ? "#4b93a2" : "#3f7f8c", 0.42),
          outline: { color: hex(dark ? "#7fd4e6" : "#12525f", 1), width: 2.5 },
        },
      } as any,
    });

    /* Рендерерийг ДАРАХГҮЙ — сервис дээрх өөрийнх нь симбологи ажиллана:
       type1 "1" -> бүдэг шар (БҮ) · "2" -> цагаан (энгийн барилга).
       Утга нь ТЭМДЭГТ МӨР хэлбэртэй тул тоогоор дарж бичих гэж оролдвол
       бүх барилга defaultSymbol рүү унаж саарал болно. */
    L.bld = new SceneLayer({ url: SVC.bld, title: "buildings", popupEnabled: false });

    L.pile2d = new FeatureLayer({
      url: SVC.pile2d, title: "pile-2d", outFields: ["dugaar", "NAME"],
      popupEnabled: false, visible: false, elevationInfo: { mode: "on-the-ground" },
      definitionExpression: pileWhere("dugaar"),
      renderer: {
        type: "simple",
        symbol: { type: "simple-fill", color: [0, 0, 0, 0],
                  outline: { color: hex(dark ? "#7d8886" : "#8a908d", 0.8), width: 1 } },
      } as any,
    });

    /* Рендерерийг ДАРАХГҮЙ — сервисийн өөрийн цагаан MeshSymbol3D.
       definitionExpression нь Excel-д дурдагдсан 11 овоолгыг л үлдээнэ. */
    L.pile3d = new SceneLayer({
      url: SVC.pileScene, title: "pile-3d", outFields: ["RefName", "NAME"],
      popupEnabled: false, definitionExpression: pileWhere("RefName"),
    });

    L.pitMesh = new GraphicsLayer({ title: "pit-mesh", elevationInfo: { mode: "absolute-height" } });
    /* Урсгалын давхаргууд ГАЗРЫН ГАДАРГУУД НААЛДАНА.
       `absolute-height` дээр өндрийг өөрсдөө тооцох шаардлагатай болж,
       ил уурхайн ёроолоос (≈1177 м) эхэлсэн зам гадаргуугийн (≈1310 м)
       ДООГУУР орж, машинууд далдарч байсан. Налуу өнцгөөс харахад дов
       толгод бага зэргийн өргөлтийг ч халхалдаг. `on-the-ground` үед
       ArcGIS шугамыг гадаргуу дагуулж, цэгүүдийг гадаргуунд шахдаг —
       машин хэзээ ч агаарт хөвөхгүй, газрын дор ч орохгүй. */
    /* `relative-to-scene` = гадаргуу БОЛОН сцен давхаргын (овоолго, барилга)
       ХАМГИЙН ДЭЭД гадаргуугаас тоологдоно. `on-the-ground` үед зам нь
       овоолгын 3D мэшийн доогуур орж далдарч байсан. */
    const onScene = { mode: "relative-to-scene", offset: 4 } as const;
    L.routes = new GraphicsLayer({ title: "routes", elevationInfo: onScene });
    L.trucks = new GraphicsLayer({ title: "trucks", elevationInfo: onScene });
    L.tails  = new GraphicsLayer({ title: "tailings", elevationInfo: onScene });

    const map = new Map({
      basemap: mkBasemap("imagery"),
      layers: [L.roads, L.dam, L.bld, L.pile2d, L.pile3d, L.pitMesh,
               L.routes, L.tails, L.trucks],
    });
    map.ground.layers.add(new ElevationLayer({ url: ELEV_URL }));
    map.ground.opacity = GROUND_OPACITY[0];
    map.ground.navigationConstraint = { type: "none" } as any;
    mapRef.current = map;

    const host = divRef.current;
    if (!host) return () => {};
    let view: SceneView;

    /* SceneView-г нэг л удаа үүсгэнэ. Өмнө нь хэмжээ зөрөхөд view-г устгаад
       дахин үүсгэдэг «засвар» байсан — тэр нь газрын зургийг бүрмөсөн
       хоосон үлдээж байсан тул хассан. Жинхэнэ шалтгаан нь ArcGIS-ийн
       загварын хуудас ачаалагдаагүйд байв (app/layout.tsx-ийг үз). */
    function buildView() {
      view = new SceneView({
        container: host!,
        map,
        qualityProfile: "high",
        camera: {
          position: { longitude: 104.1, latitude: 48.94, z: 5200 }, tilt: 58, heading: 18,
        },
        environment: { lighting: { directShadowsEnabled: false } } as any,
        ui: {
          components: ["zoom", "compass", "navigation-toggle"],
          /* дээд талд .hintbar сууж байгаа тул виджетүүдийг доош түлхэнэ */
          padding: { top: 44, right: 12, bottom: 12, left: 12 },
        } as any,
        popup: { autoOpenEnabled: false } as any,
      });
      viewRef.current = view;
      return view;
    }

    buildView();

    /* --------- питийн мэшийн байрлалын мэдээлэл --------- */
    fetch("/data/pit_mesh.json")
      .then((r) => r.json())
      .then((j) => { meshInfo.current = j; return view.when(); })
      .then(() => {
        if (cancelled) return;
        setReady(true);
        /* ?flow=0 — материалын урсгалыг унтраана (оношилгоо/гүйцэтгэл) */
        const flowOn = !/[?&]flow=0/.test(location.search);
        /* Хоёр goTo зэрэг ажиллуулж болохгүй — сүүлд дуусаад байгаа нь
           нөгөөгөө дардаг. Урсгал асаалттай үед хүрээг `frameFlow` тогтооно
           (уурхай + бүх хүлээн авагч), эсрэг тохиолдолд зөвхөн пит. */
        showMesh(stateRef.current.m).then(() => {
          if (!flowOn) zoomTo(L.pitMesh, undefined, 1.15);
        });
        wireHover(view);
        syncVisible();
        if (flowOn) startFlow();
      })
      .catch(() => setReady(true));

      return () => {
        if (flowTimer.current) window.clearTimeout(flowTimer.current);
        view.destroy();
        viewRef.current = null;
      };
    }

    return () => { cancelled = true; if (disposed) disposed(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ================================================== материалын урсгал
     Ил уурхайгаас хүлээн авагч бүр рүү. Машины ТОО нь Excel-ийн тухайн
     сарын тонны хувиар хуваарилагдана — олон тонн бол олон машин.
     Баяжуулах үйлдвэрээс хаягдлын далан руу хаягдал хоолойгоор урсахыг
     хөдөлгөөнт цэгээр үзүүлнэ (машинаар биш). */
  async function startFlow() {
    const dests = await loadDests();
    if (!dests.length) { zoomTo(layersRef.current.pitMesh, undefined, 1.15); return; }
    destsRef.current = dests;

    const bu = dests.find((d) => d.code === "BU");
    const dam = await damCenter();
    if (bu && dam) tailPath.current = tailingsPath(bu, dam);

    rebuildFlow();
    frameFlow();

    let last = performance.now();
    const tick = () => {
      if (!viewRef.current) return;
      const now = performance.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      simRef.current?.step(dt);
      drawTrucks();
      drawTailings(now / 1000);
      flowTimer.current = window.setTimeout(tick, 120);
    };
    tick();
  }

  /** Уурхай + бүх хүлээн авагчийг нэг дор багтаасан камер.
      Питэд наалдсан зумаар тээвэрлэлт огт уншигдахгүй байсан. */
  function frameFlow() {
    const v = viewRef.current;
    if (!v || !destsRef.current.length) return;
    /* Маршрутын БҮХ орой — уурхай, хүлээн авагч, замууд бүгд багтана */
    const all = destsRef.current.flatMap((d) => d.path);
    if (!all.length) return;
    const lons = all.map((p) => p[0]);
    const lats = all.map((p) => p[1]);
    const pad = 0.002;
    v.goTo({
      target: {
        type: "extent", spatialReference: { wkid: 4326 },
        xmin: Math.min(...lons) - pad, xmax: Math.max(...lons) + pad,
        ymin: Math.min(...lats) - pad, ymax: Math.max(...lats) + pad,
      },
      tilt: 45, heading: 6,
    } as any, { duration: 1400 }).catch(() => {});
  }



  function rebuildFlow() {
    const L = layersRef.current;
    if (!destsRef.current.length || !L.routes) return;

    const sim = new FlowSim(destsRef.current, stateRef.current.m, 14);
    simRef.current = sim;

    /* маршрутын шугам — өргөн нь тухайн чиглэлийн тонны хувьтай пропорциональ */
    L.routes.removeAll();
    const vals = sim.routes.map((r) => sumCol(stateRef.current.m, r.dest.col));
    const mx = Math.max(...vals, 1);
    sim.routes.forEach((r, k) => {
      L.routes.add(new Graphic({
        geometry: {
          type: "polyline", spatialReference: { wkid: 4326 },
          /* z = 0. `relative-to-scene` горимд геометрийн z нь ҮНЭМЛЭХҮЙ
             өндөр биш, гадаргуугаас дээших ШИЛЖИЛТ гэж ойлгогддог тул
             FlowSim-ийн 1177–1400 м-ийг дамжуулбал зам тэнгэрт өлгөгдөнө.
             Өндрийг бүхэлд нь ArcGIS-ийн давхаргын тохиргоо шийднэ. */
          paths: [r.pts.map((p) => [p.lon, p.lat, 0])],
        } as any,
        symbol: {
          type: "line-3d",
          symbolLayers: [{
            /* Өргөнийг ШУУД биш КВАДРАТ ЯЗГУУРААР масштаблана: I сард
               нийт 3 170-аас 3 130 нь БҮ-т очдог тул шугаман масштабаар
               овоолгын чиглэлүүд үсний зузаан болж алга болж байсан. */
            type: "line", size: 2.6 + Math.sqrt(vals[k] / mx) * 5,
            material: { color: hex(cssVar(r.dest.color), 0.75) },
            cap: "round", join: "round",
          }],
        } as any,
      }));
    });

    L.trucks.removeAll();
    truckGfx.current = sim.trucks.map(() => new Graphic());
    truckKey.current = sim.trucks.map(() => "");
    L.trucks.addMany(truckGfx.current);
  }

  /** var(--x) -> бодит hex (ArcGIS-ийн материалд hex хэрэгтэй) */
  function cssVar(v: string) {
    const m = v.match(/var\((--[a-z0-9-]+)\)/i);
    if (!m) return v;
    return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#888888";
  }

  /** Бодит хэмжээ (12.8 x 6.2 м) нь уурхай + овоолгыг хамарсан 6 км-ийн
      хүрээнд пикселийн доогуур ордог. Тиймээс масштабаас хамааруулан
      томруулна — хэмжээг алхамчилсан тул тэмдэгт байнга солигдож
      анивчихгүй (`truckKey`-г үз). */
  function truckHeight() {
    const sc = viewRef.current?.scale ?? 20000;
    const h = Math.max(6.2, Math.min(40, sc / 800));
    return Math.round(h / 3) * 3 || 6;
  }

  function drawTrucks() {
    const sim = simRef.current;
    if (!sim) return;
    sim.trucks.forEach((tr, i) => {
      const g = truckGfx.current[i];
      if (!g) return;
      g.geometry = new Point({
        longitude: tr.lon, latitude: tr.lat, z: 0,   /* давхарга нь газарт нааж байрлуулна */
        spatialReference: { wkid: 4326 },
      });
      const hb = Math.round(tr.heading / 4) * 4;
      const th = truckHeight();
      const key = tr.dest + "|" + hb + "|" + (tr.loaded ? 1 : 0) + "|" + th;
      if (truckKey.current[i] === key) return;
      truckKey.current[i] = key;
      const col = cssVar(tr.color);
      g.symbol = {
        type: "point-3d",
        symbolLayers: [{
          type: "object", resource: { href: "/data/truck.glb" },
          material: { color: hex(col, 1), colorMixMode: "tint" },
          height: th, heading: hb, anchor: "bottom",
        }],
      } as any;
      g.attributes = { dest: tr.dest, destName: tr.destName, loaded: tr.loaded };
    });
  }

  /** Хаягдлын урсгал — хоолойн дагуу хөдөлж буй цэгүүд */
  function drawTailings(tsec: number) {
    const L = layersRef.current;
    const path = tailPath.current;
    if (!L.tails || path.length < 2) return;
    const N = 10;
    if (tailGfx.current.length !== N) {
      L.tails.removeAll();
      tailGfx.current = Array.from({ length: N }, () => new Graphic());
      L.tails.addMany(tailGfx.current);
    }
    const col = cssVar("var(--water)");
    for (let k = 0; k < N; k++) {
      const t = ((tsec * 0.06 + k / N) % 1) * (path.length - 1);
      const i = Math.floor(t), f = t - i;
      const a = path[i], b = path[Math.min(path.length - 1, i + 1)];
      const g = tailGfx.current[k];
      g.geometry = new Point({
        longitude: a.lon + (b.lon - a.lon) * f,
        latitude: a.lat + (b.lat - a.lat) * f,
        z: 0,
        spatialReference: { wkid: 4326 },
      });
      if (!g.symbol) {
        g.symbol = {
          type: "point-3d",
          symbolLayers: [{
            type: "object", resource: { primitive: "sphere" },
            material: { color: hex(col, 1) },
            width: 26, height: 26, depth: 26,
          }],
        } as any;
      }
    }
  }

  /* ---------------------------------------------------- туслах үйлдлүүд */
  function syncVisible() {
    const L = layersRef.current;
    const v: Record<string, boolean> = {};
    for (const k of Object.keys(L)) v[k] = !!L[k]?.visible;
    setVisible(v);
  }

  function meshSymbol(iso: boolean) {
    return {
      type: "mesh-3d",
      symbolLayers: [{ type: "fill",
        material: { color: hex(iso ? "#9a9187" : "#8d7f70", 1), colorMixMode: "replace" } }],
    } as any;
  }

  async function showMesh(month: number) {
    const L = layersRef.current;
    const info = meshInfo.current[String(month)];
    L.pitMesh.removeAll();
    if (!info) return;
    const sym = meshSymbol(isolated);
    if (meshCache.current[month]) {
      L.pitMesh.add(new Graphic({ geometry: meshCache.current[month], symbol: sym }));
      return;
    }
    try {
      const mesh = await Mesh.createFromGLTF(
        new Point({ longitude: info.lon, latitude: info.lat, z: info.z, spatialReference: { wkid: 4326 } }),
        info.url,
      );
      meshCache.current[month] = mesh;
      if (stateRef.current.m === month) {
        L.pitMesh.add(new Graphic({ geometry: mesh, symbol: meshSymbol(isolated) }));
      }
    } catch (e) {
      console.warn("GLB ачаалж чадсангүй:", e);
    }
  }

  function zoomTo(lyr: any, where?: string, pad = 1.6) {
    const view = viewRef.current;
    if (!lyr || !view) return;
    lyr.visible = true;
    const go = (ext: any) => ext && view.goTo({ target: ext.expand(pad), tilt: 58 });
    /* GraphicsLayer дээр queryExtent байдаггүй */
    if (lyr.graphics) { go(lyr.graphics.getItemAt(0)?.geometry?.extent); return; }
    if (lyr.queryExtent) {
      lyr.queryExtent(where ? { where } : undefined)
        .then((r: any) => go(r?.extent), () => go(lyr.fullExtent));
    } else go(lyr.fullExtent);
  }

  /* ---------------------------------------------------------------------
     Multipatch_EMC-ийн I3S кэш дээр атрибутын буфер шилжсэн:
       hitTest -> ner алга · type1 = 1081751420 (хог) ·
       OBJECTID нь FeatureServer-ийн FID-тэй таарахгүй.
     Сервис публиш хийхэд гарсан алдаа тул клиентээс засах боломжгүй.
     Тиймээс атрибутыг FeatureServer-ээс байршлаар нь асууна.
  --------------------------------------------------------------------- */
  async function bldLookup(mapPoint: any) {
    const ll = toLonLat(mapPoint);
    if (!ll) return null;
    const key = ll[0].toFixed(5) + "," + ll[1].toFixed(5);
    if (key in bldCache.current) return bldCache.current[key];

    const geom = JSON.stringify({ x: ll[0], y: ll[1], spatialReference: { wkid: 4326 } });
    const q = `${SVC.bldFS}/query?f=json&returnGeometry=false&outFields=FID,ner,type1` +
              `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
              `&geometry=${encodeURIComponent(geom)}`;
    try {
      const d = await (await fetch(q)).json();
      const fs: any[] = d?.features ?? [];
      /* Хөл давхцвал БҮ-ийнхийг эрхэмлэнэ — харагдах өнгө нь type1-ээс шалтгаална */
      const pick = fs.find((f) => num1(f.attributes?.type1) === BU_TYPE) ?? fs[0];
      const rec = pick?.attributes ?? null;
      bldCache.current[key] = rec;
      return rec;
    } catch {
      bldCache.current[key] = null;
      return null;
    }
  }

  function toLonLat(pt: any): [number, number] | null {
    if (!pt) return null;
    try {
      const wkid = pt.spatialReference?.wkid ?? pt.spatialReference?.latestWkid;
      if (wkid === 102100 || wkid === 3857) {
        const g: any = wmUtils.webMercatorToGeographic(pt);
        return [g.x ?? g.longitude, g.y ?? g.latitude];
      }
      if (pt.longitude != null) return [pt.longitude, pt.latitude];
      return [pt.x, pt.y];
    } catch { return pt?.x != null ? [pt.x, pt.y] : null; }
  }

  /* ------------------------------------------------------------- hover */
  function wireHover(view: SceneView) {
    let pending = false;
    let last: any = null;

    view.on("pointer-move", (ev) => {
      last = ev;
      if (pending) return;
      pending = true;
      requestAnimationFrame(async () => {
        pending = false;
        const res = await view.hitTest(last);
        const h = hitInfo(res);
        const el = view.container as HTMLDivElement | null;
        if (!h) { setTip(null); if (el) el.style.cursor = "default"; return; }
        if (el) el.style.cursor = "pointer";
        const n = (last as any).native;
        const r = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
        const x = n ? n.clientX : last.x + r.left;
        const y = n ? n.clientY : last.y + r.top;
        showFor(h, x, y);
      });
    });

    view.on("pointer-leave", () => setTip(null));

    view.on("click", async (ev) => {
      const h = hitInfo(await view.hitTest(ev));
      if (!h) return;
      if (h.kind === "pitmesh") { toggleIsolate(); return; }
      if (h.kind === "bld") {
        const rec = await bldLookup(h.mapPoint);
        if (rec && num1(rec.type1) === BU_TYPE) {
          setSel({ kind: "dest", ci: C.BU, title: t.bu,
                   featName: "type1 = 1" + (rec.ner ? "  ·  " + rec.ner : "") });
          setBlk(null);
        }
        return;
      }
      if (h.kind === "pile") {
        const ci = PILE2COL[h.name];
        if (ci === undefined) return;
        setSel({ kind: "dest", ci, title: h.name, featName: "RefName = " + h.name });
        setBlk(null);
      }
    });
  }

  function hitInfo(res: any): any {
    const L = layersRef.current;
    for (const r of res?.results ?? []) {
      if (r.type !== "graphic" || !r.graphic) continue;
      const lyr = r.graphic.layer, a = r.graphic.attributes ?? {};
      if (lyr === L.pitMesh) return { kind: "pitmesh" };
      /* SceneLayer-ийн атрибут эвдэрсэн тул зөвхөн байршлыг нь авна */
      if (lyr === L.bld) return { kind: "bld", mapPoint: r.mapPoint };
      if (lyr === L.pile3d) return { kind: "pile", name: a.RefName };
      if (lyr === L.pile2d) return { kind: "pile", name: a.dugaar };
    }
    return null;
  }

  async function showFor(h: any, x: number, y: number) {
    const { m: mm, lang: lg } = stateRef.current;
    const names = COL_NAMES[lg];

    if (h.kind === "pitmesh") {
      setTip({ x, y, title: t.pit, key: "DWG · multipatch",
               rows: [{ label: t.uM3, value: fmt(sumCol(mm, C.TSUL), 0), color: "var(--g4)" }],
               hint: t.clickIso });
      return;
    }

    if (h.kind === "bld") {
      setTip({ x, y, title: t.bu + " …", key: "Multipatch_EMC · FeatureServer", rows: [] });
      const rec = await bldLookup(h.mapPoint);
      if (!rec) { setTip(null); return; }
      if (num1(rec.type1) !== BU_TYPE) {
        setTip({ x, y, title: rec.ner || t.bldPlain,
                 key: `Multipatch_EMC · type1 = ${rec.type1 ?? "—"}`,
                 rows: [{ label: t.ctxOnly, value: "—" }] });
        return;
      }
      const v = sumCol(mm, C.BU);
      const cu = v ? (metalSum(mm, "cut", C.BU) / (v * 1000)) * 100 : 0;
      setTip({ x, y, title: rec.ner || t.bu, key: `${t.bu} · Сар ${mm} · type1 = 1`,
               rows: [
                 { label: names[C.BU].split("—").pop()!.trim(), value: `${fmt(v, 1)} ${t.uKt}`, color: "var(--s1)" },
                 { label: "Cu", value: cu ? cu.toFixed(3) + " %" : "—" },
               ], hint: t.clickPin });
      return;
    }

    /* овоолго */
    const ci = PILE2COL[h.name];
    if (ci === undefined) {
      setTip({ x, y, title: h.name, key: "RefName = " + h.name, rows: [{ label: t.noData, value: "—" }] });
      return;
    }
    const v = sumCol(mm, ci);
    const isM3 = ci === C.HOOSON;
    const col = isM3 ? "var(--s4)" : ci === C.OV9A || ci === C.OV9B ? "var(--s3)" : "var(--s2)";
    const cu = v ? (metalSum(mm, "cut", ci) / (v * 1000)) * 100 : 0;
    const lbl = names[ci].split("—").pop()!.trim();
    setTip({ x, y, title: h.name, key: `Сар ${mm} · ${lbl}`,
             rows: [
               { label: lbl, value: `${v ? fmt(v, 1) : "—"} ${isM3 ? t.uM3 : t.uKt}`, color: col },
               { label: "Cu", value: cu ? cu.toFixed(3) + " %" : "—" },
             ], hint: t.clickPin });
  }

  /* --------------------------------------------------------- тусгаарлах */
  const prevVis = useRef<Record<string, boolean>>({});
  const ISO = ["roads", "dam", "bld", "pile2d", "pile3d"];

  function toggleIsolate() { applyIsolate(!isolated); }

  function applyIsolate(on: boolean) {
    const view = viewRef.current, map = mapRef.current, L = layersRef.current;
    if (!view || !map) return;
    setIsolated(on);

    if (on) {
      prevVis.current = {};
      ISO.forEach((k) => { if (L[k]) { prevVis.current[k] = L[k].visible; L[k].visible = false; } });
      map.basemap = null as any;
      map.ground.opacity = 0;
      (map.ground as any).surfaceColor = "#12181a";
      view.environment.atmosphereEnabled = false;
      view.environment.starsEnabled = false;
      /* Шууд сүүдэр — питийн шатлал, берм, налууг харагдуулах гол хүчин зүйл */
      (view.environment.lighting as any).directShadowsEnabled = true;
      (view.environment.lighting as any).date = new Date("2023-06-21T09:30:00+08:00");
    } else {
      ISO.forEach((k) => { if (L[k]) L[k].visible = prevVis.current[k] ?? true; });
      map.basemap = new Basemap({
        baseLayers: [new TileLayer({ url: BASEMAPS[basemapKey].url })], title: basemapKey,
      });
      map.ground.opacity = GROUND_OPACITY[groundStep];
      view.environment.atmosphereEnabled = true;
      (view.environment.lighting as any).directShadowsEnabled = false;
    }

    document.body.classList.toggle("isolated", on);
    L.pitMesh.visible = true;
    L.pitMesh.graphics.forEach((g: Graphic) => { g.symbol = meshSymbol(on); });
    if (on) setTimeout(() => zoomTo(L.pitMesh, undefined, 1.05), 60);
    syncVisible();
  }

  /* ------------------------------------------------ сар солиход мэш солино */
  useEffect(() => {
    if (!ready) return;
    showMesh(m);
    rebuildFlow();          /* машины тоо сарын тонноор өөрчлөгдөнө */
  }, [m, ready]); // eslint-disable-line

  /* ------------------------------------------------------- Esc товчлуур */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isolated) applyIsolate(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* --------------------------------------------- ил уурхайн сервис нэмэх */
  async function loadPitService() {
    const url = pitUrl.trim();
    if (!url) return;
    setPitMsg({ text: "…", cls: "" });
    const L = layersRef.current, map = mapRef.current!;
    const Ctor: any = /SceneServer/i.test(url) ? SceneLayer : FeatureLayer;
    const lyr = new Ctor({ url, outFields: ["*"], popupEnabled: false, title: "pit-service" });
    try {
      await lyr.load();
      if (L.pitSvc) map.remove(L.pitSvc);
      L.pitSvc = lyr;
      map.add(lyr);
      L.pitMesh.visible = false;             /* локал GLB-г унтраана */
      setPitMsg({ text: `${t.pitOk} · ${lyr.title ?? url.split("/").slice(-2).join("/")}`, cls: "ok" });
      syncVisible();
    } catch (err: any) {
      setPitMsg({ text: `${t.pitErr}: ${err?.message ?? err}`, cls: "err" });
    }
  }

  /* ------------------------------------------------------------- рендер */
  const L = layersRef.current;
  const rows: { key: string; n: string; c: string }[] = [
    ...(L.pitSvc ? [{ key: "pitSvc", n: "Ил уурхай · сервис", c: "var(--g6)" }] : []),
    { key: "pitMesh", n: t.lyMesh,   c: "#8d7f70" },
    { key: "pile3d",  n: t.lyPile3d, c: "var(--s2)" },
    { key: "pile2d",  n: t.lyPile2d, c: "var(--s4)" },
    { key: "dam",     n: t.lyDam,    c: "var(--water)" },
    { key: "roads",   n: t.lyRoads,  c: "var(--ink-3)" },
    { key: "bld",     n: t.lyBld,    c: BLD_COLOR.bu },
    { key: "routes",  n: t.lyRoutes, c: "var(--s2)" },
    { key: "trucks",  n: t.lyTrucks, c: "var(--g5)" },
    { key: "tails",   n: t.lyTails,  c: "var(--water)" },
  ];

  return (
    <>
      <div className="ph">
        <h2>{t.pScene}</h2>
        <button className="ghost sm" aria-pressed={isolated} onClick={toggleIsolate}
                style={{ marginLeft: "auto" }}>{t.btnIso}</button>
        <button className="ghost sm" aria-pressed={layersOpen}
                onClick={() => setLayersOpen((v) => !v)}>{t.btnLayers}</button>
        <span className="src live">ArcGIS 4.34</span>
      </div>

      <div className="mapwrap">
        <div id="viewDiv" ref={divRef} />

        <div className="hintbar">
          <span className="dotp" />
          <span>{t.sceneHint}</span>
        </div>

        {layersOpen && (
          <div className="layerbox">
            <div className="lbh">{t.lyTitle}</div>
            <div>
              {rows.map((r) => {
                const lyr = L[r.key];
                if (!lyr) return null;
                return (
                  <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <button className="lrow" aria-pressed={!!visible[r.key]}
                            onClick={() => { lyr.visible = !lyr.visible; syncVisible(); }}>
                      <span className="sw" style={{ background: r.c }} />
                      <span>{r.n}</span>
                      <span className="tg" />
                    </button>
                    <button className="zoomto" title={t.zoomTo}
                            onClick={() => zoomTo(lyr, r.key === "bld" ? `type1 = ${BU_TYPE}` : undefined)}>⌖</button>
                  </div>
                );
              })}
            </div>

            <div className="lbh" style={{ marginTop: 4 }}>{t.basemap}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
                <button key={k} className="ghost sm" aria-pressed={basemapKey === k}
                        onClick={() => {
                          setBasemapKey(k);
                          mapRef.current!.basemap = new Basemap({
                            baseLayers: [new TileLayer({ url: BASEMAPS[k].url })], title: k });
                        }}>{BASEMAPS[k].nm[lang]}</button>
              ))}
            </div>

            <div className="lbh" style={{ marginTop: 4 }}>{t.ground}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {GROUND_OPACITY.map((o, i) => (
                <button key={i} className="ghost sm" aria-pressed={groundStep === i}
                        onClick={() => { setGroundStep(i); mapRef.current!.ground.opacity = o; }}>
                  {GROUND_NM[lang][i]}
                </button>
              ))}
            </div>
            <div className="lbnote">{t.groundNote}</div>

            <div className="lbsep" />
            <div className="lbh">{t.pitAdd}</div>
            <div className="pitrow">
              <input value={pitUrl} onChange={(e) => setPitUrl(e.target.value)} type="url"
                     spellCheck={false} placeholder="https://services7.arcgis.com/.../SceneServer" />
              <button className="ghost sm" onClick={loadPitService}>{t.btnLoad}</button>
            </div>
            {pitMsg.text && <div className={"lbnote " + pitMsg.cls}>{pitMsg.text}</div>}
          </div>
        )}

        <div className="gradekey">
          <span>{t.legGrade}</span>
          <div className="ramp">
            {[1, 2, 3, 4, 5, 6].map((i) => <i key={i} style={{ background: `var(--g${i})` }} />)}
          </div>
          <div className="rax"><span>0.15</span><span>0.50</span></div>
          <div className="rlegoff"><i /><span>{t.legOff}</span></div>
        </div>

        <div className={"loading" + (ready ? " done" : "")}>
          <span className="spin" />
          <span>{t.loadingTxt}</span>
        </div>
      </div>
    </>
  );
}
