"use client";

/* ==========================================================================
   ArcGIS SceneView — бүхэлдээ browser талд ажиллана.
   page.tsx-ээс  dynamic(..., { ssr: false })  -ээр дуудагдана.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import Map from "@arcgis/core/Map";
import Basemap from "@arcgis/core/Basemap";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Expand from "@arcgis/core/widgets/Expand";
import SceneView from "@arcgis/core/views/SceneView";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import IntegratedMeshLayer from "@arcgis/core/layers/IntegratedMeshLayer";
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
  SVC, C, COL_NAMES, ELEV_URL, GROUND_OPACITY, GROUND_NM,
  BU_TYPE, BLD_COLOR, PILE_COLOR, PILE_HEX, PILE_EDGE, PILE_EDGE_HEX,
  PILE2COL, TRUCK_COLOR, pileWhere,
} from "@/lib/config";
import { cuOf, metalSum, moOf, sumCol, GRADE_BREAKS, GRADE_RANGE } from "@/lib/excel";
import {
  loadDests, loadParked, loadTailLine, FlowSim,
  type Dest, type Truck,
} from "@/lib/flow";
import { fmt, hex, num1 } from "@/lib/format";

/** @arcgis/core-ийн assets-ыг node_modules-оос хуулахгүйгээр CDN-ээс авна */
esriConfig.assetsPath = "https://js.arcgis.com/4.34/@arcgis/core/assets";

/** Хаягдлын хоолой */
/* Гүн ба диаметрийг бодит хэмжээнээс ТОМРУУЛСАН: 4.4 км урт коридорыг
   бүтнээр нь харах зумд (≈2.5 м/пиксел) 6 м-ийн хоолой 2 пиксел болж,
   хагас тунгалаг гадаргуугаар огт уншигдахгүй байв. */
const TAIL_DEPTH = 12;     // гүн, м (гадаргуугаас доош)
const PIPE_D = 14;         // хоолойн диаметр, м
/* ҮҮРЛЭСЭН байх ёстой: долгион < цөм < бүрхүүл. Урьд нь долгион (10.5)
   цөмөөс (8.5) ТОМ байсан тул хоолойн гадуур цухуйж, ирмэг нь тасархай
   ширүүн харагдаж байв. */
const FLOW_D = 8.5;        // тасралтгүй усны цөмийн диаметр, м
const WAVE_D = 5.5;        // хөдөлж буй долгионы диаметр, м (цөмөөс НАРИЙН)
const FLOW_SEG = 150;      // нэг долгионы урт, м

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
  const [pitUrl, setPitUrl] = useState("");
  const [pitMsg, setPitMsg] = useState<{ text: string; cls: string }>({ text: "", cls: "" });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const flowTimer = useRef<number | null>(null);
  const simRef = useRef<FlowSim | null>(null);
  const destsRef = useRef<Dest[]>([]);
  const parkedRef = useRef<Truck[]>([]);
  /* Байнгын Graphic обьектууд — давталт бүрт ДАХИН ҮҮСГЭХГҮЙ (анивчихаас сэргийлнэ) */
  const truckGfx = useRef<Graphic[]>([]);
  const truckKey = useRef<string[]>([]);
  const prevBasemap = useRef<Basemap | null>(null);
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

    /** Одоогийн өнгөний горим. `data-theme` байхгүй бол ҮС-ийн тохиргоо. */
    const isDark = () => {
      const a = document.documentElement.getAttribute("data-theme");
      if (a === "dark") return true;
      if (a === "light") return false;
      return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    };

    /* Esri-гийн СОНГОДОГ (растер) суурь зургууд — API key шаарддаггүй.
       Вектор хувилбарууд (…-vector) түлхүүр шаарддаг тул орсонгүй. */
    const BM_IDS = ["satellite", "hybrid", "topo", "streets", "gray",
                    "dark-gray", "terrain", "oceans", "osm",
                    "national-geographic"];

    const L = layersRef.current;

    /* ТЭЭВРИЙН ЗАМ — машин яг үүгээр явна (Road_truck_SL, 32 шугам, 76 км).
       Өмнөх хоёр давхаргыг бүрмөсөн орлоно: `Engineering_EMC/22` (CAD-ийн
       зурган давхарга, граф болдоггүй) ба `Road_truck`.
       Сервисийн өөрийн дүрслэл нимгэн саарал тул уншигдахуйц болгов. */
    L.roadNet = new FeatureLayer({
      url: SVC.roadTruck, title: "road-net", popupEnabled: false,
      /* `on-the-ground` БИШ. Тэр нь ArcGIS-ийн дэлхийн DEM-д шаддаг ба
         энэ талбайд DEM бараг хавтгай ≈1310 м. Ил уурхайн дотор бодит
         гадаргуу 200 м гүн тул зам питийн ханан дээр агаарт зурагдаж,
         машин (бодит мэш дээр явдаг) замаас хол зайд байх мэт харагдаж
         байв. Хоёулаа НЭГ гадаргуу дээр байх ёстой. */
      elevationInfo: { mode: "relative-to-scene", offset: 0 },
      /* Анхдагчаар УНТРААЛТТАЙ — зурган дээр хиймэл өнгөт зураас
         илүүдэж, хиймэл дагуулын зурган дээрх жинхэнэ замыг халхалдаг.
         Машин энэ сүлжээгээр л явна; «Давхарга»-аас асааж болно. */
      visible: false,
    });

    L.dam = new FeatureLayer({
      url: SVC.dam, title: "dam", outFields: ["Date"], popupEnabled: false,
      elevationInfo: { mode: "on-the-ground" },
      /* Далангийн сервис 2024/01-ээс эхэлдэг — 2023 оны мөр байхгүй */
      definitionExpression: "Date = '2024/01'",
    });

    /* Рендерерийг ДАРАХГҮЙ — сервис дээрх өөрийнх нь симбологи ажиллана:
       type1 "1" -> бүдэг шар (БҮ) · "2" -> цагаан (энгийн барилга).
       Утга нь ТЭМДЭГТ МӨР хэлбэртэй тул тоогоор дарж бичих гэж оролдвол
       бүх барилга defaultSymbol рүү унаж саарал болно. */
    L.bld = new SceneLayer({ url: SVC.bld, title: "buildings", popupEnabled: false });

    L.pile2d = new FeatureLayer({
      url: SVC.pile2d, title: "pile-2d", outFields: ["dugaar", "NAME"],
      popupEnabled: false, elevationInfo: { mode: "on-the-ground" },
      definitionExpression: pileWhere("dugaar"),
      /* Овоолго тутамд ЯГ НЭГ полигон — тунгалаг байдал давхарлахгүй тул
         бүх овоолго ижил хэмжээгээр нэвт харагдана. */
      labelsVisible: true,
      labelingInfo: [{
        labelExpressionInfo: { expression: "$feature.dugaar" },
        labelPlacement: "above-center",
        symbol: {
          type: "label-3d",
          symbolLayers: [{
            type: "text", size: 9,
            material: { color: [255, 244, 214, 1] },
            halo: { color: [18, 26, 35, 0.85], size: 1.2 },
            font: { family: "sans-serif", weight: "bold" },
          }],
          verticalOffset: { screenLength: 20, maxWorldLength: 600, minWorldLength: 24 },
          callout: { type: "line", size: 0.8, color: [255, 244, 214, 0.55] },
        },
      }] as any,
    });

    /**
     * Өнгөний горимоос хамаарах рендерерүүд.
     *
     * ArcGIS-ийн симбол өнгөө ҮҮСЭХ АГШИНД авдаг тул өдөр/шөнө солиход
     * өөрөө шинэчлэгддэггүй. Тиймээс тэдгээрийг энд төвлөрүүлж, горим
     * солигдох бүрт дахин тавина (store.tsx-аас `emc-theme` эвент ирнэ).
     * Овоолгын 3D ба барилгын давхарга энд ОРООГҮЙ — тэдний рендерерийг
     * дарахгүй, сервисийн өөрийнхөөр нь үлдээнэ.
     */
    function applyTheme() {
      const d = isDark();
      L.roadNet.renderer = {
        type: "simple",
        /* Нарийн шугам. Урьд нь 7 px байсан нь маршрутын өнгөт шугамын
           «хүрээ» болох зорилготой байсан ба тэр давхарга хасагдсан тул
           одоо шаардлагагүй — зузаан шугам зурган дээр давамгайлдаг. */
        symbol: { type: "simple-line", width: 2, cap: "round", join: "round",
                  color: hex(d ? "#e8d9a8" : "#7a6636", 0.85) },
      } as any;
      L.dam.renderer = {
        type: "simple",
        symbol: { type: "simple-fill", color: hex(d ? "#4b93a2" : "#3f7f8c", 0.42),
                  outline: { color: hex(d ? "#7fd4e6" : "#12525f", 1), width: 2.5 } },
      } as any;
      /* Овоолгын ГАДНА тойрог — улаан, өнгөний горимоос үл хамаарна.
         Бүх овоолго нэг хул шар өнгөтэй болсон тул зөвхөн энэ зураас ба
         нэрийн шошго л тэднийг бие биеэс нь ялгана. */
      /* Хул шар дүүргэлт + УЛААН гадна тойрог. Овоолгуудыг өнгөөр нь
         ялгахгүй — улаан хил ба нэрийн шошго ялгана. */
      L.pile2d.renderer = {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [PILE_COLOR[0], PILE_COLOR[1], PILE_COLOR[2], 0.3],
          outline: { color: PILE_EDGE, width: 1 },
        },
      } as any;
    }
    applyTheme();
    window.addEventListener("emc-theme", applyTheme);

    /* Овоолгын 3D эзэлхүүн — анхдагчаар УНТРААЛТТАЙ.
       Сервист овоолго бүр олон битүү блокоос бүрдэнэ (Овоолго 12 — 20,
       Овоолго 9 — 19, харин Овоолго 1 — 1). Тунгалаг байдал давхарлахад
       үржигддэг тул (харагдах хувь = (1−α)^2N) нэг α-гаар ЖИГД тунгалаг
       болгох боломжгүй: α = 0.34 үед Овоолго 1 нь 44 %, Овоолго 12 нь
       0.03 % нэвт харагдана. Тиймээс овоолгыг ДООРХ 2D мөрөөр — овоолго
       тутамд ЯГ НЭГ гадаргуугаар — үзүүлнэ. Бодит 3D хэлбэрийг нь
       фотограмметрийн мэш аль хэдийн харуулж байна.
       Хэрэгтэй бол «Давхарга»-аас асааж болно. */
    L.pile3d = new SceneLayer({
      url: SVC.pileScene, title: "pile-3d", outFields: ["RefName", "NAME"],
      popupEnabled: false, definitionExpression: pileWhere("RefName"),
      visible: false, opacity: 0.34,
      renderer: {
        type: "simple",
        symbol: {
          type: "mesh-3d",
          symbolLayers: [{
            type: "fill",
            material: { color: PILE_COLOR, colorMixMode: "replace" },
          }],
        },
      } as any,
    });

    /* Ил уурхайн БОДИТ гадаргуу (фотограмметр). Гараар зассан DWG-ийн
       сарын мэшийг ОРЛОХГҮЙ — хоёулаа хэрэгтэй:
         · энэ нь бодит харагдац, машин үүн дээр явна;
         · DWG-ийн сарын мэш нь I–VI сарын ӨӨРЧЛӨЛТИЙГ харуулна
           («Зөвхөн уурхай» горимд бараан дэвсгэр дээр гарна). */
    L.im = new IntegratedMeshLayer({ url: SVC.pitMesh3d, title: "pit-reality-mesh" });

    L.pitMesh = new GraphicsLayer({
      title: "pit-mesh", elevationInfo: { mode: "absolute-height" }, visible: false,
    });
    /* Урсгалын давхаргууд ГАЗРЫН ГАДАРГУУД НААЛДАНА.
       `absolute-height` дээр өндрийг өөрсдөө тооцох шаардлагатай болж,
       ил уурхайн ёроолоос (≈1177 м) эхэлсэн зам гадаргуугийн (≈1310 м)
       ДООГУУР орж, машинууд далдарч байсан. Налуу өнцгөөс харахад дов
       толгод бага зэргийн өргөлтийг ч халхалдаг. `on-the-ground` үед
       ArcGIS шугамыг гадаргуу дагуулж, цэгүүдийг гадаргуунд шахдаг —
       машин хэзээ ч агаарт хөвөхгүй, газрын дор ч орохгүй. */
    /* Урсгалын давхаргууд ГАЗРЫН ГАДАРГУУД НААЛДАНА.
       `relative-to-scene` нь өндрийг гадаргуу биш, СЦЕН ДАВХАРГЫН (овоолго,
       барилга) ОРОЙгоос тоолдог тул зам овоолгын мэшийн дээгүүр гарч
       агаарт өлгөгдөж байв. Жинхэнэ тээврийн замын геометр орж ирснээр
       зам овоолгуудыг тойрч өнгөрдөг болсон тул `on-the-ground` дээр
       далдрах асуудал бараг байхгүй. */
    /* Бодит мэш орж ирснээр газрын ЖИНХЭНЭ гадаргуу нь ArcGIS-ийн
       хавтгай дэлхийн DEM биш, харин тэр мэш болов. `on-the-ground` нь
       DEM-д шаддаг тул машин питийн дотор газрын дор орох байсан.
       `relative-to-scene` нь сцен давхаргын (мөн бодит мэшийн) гадаргууг
       дагадаг — геометрийн z нь тэр гадаргуугаас дээших шилжилт (=0). */
    const onScene = { mode: "relative-to-scene", offset: 0 } as const;
    L.trucks = new GraphicsLayer({ title: "trucks", elevationInfo: onScene });
    /* Хаягдлын хоолой нь ГАЗАР ДООР — гадаргуугаас 20 м доош.
       Харагдахын тулд «Газрын гадаргуу» тохиргоог «Хагас» эсвэл
       «Унтраах» болгоно. */
    L.tails  = new GraphicsLayer({
      title: "tailings",
      elevationInfo: { mode: "relative-to-ground", offset: -TAIL_DEPTH },
    });

    const map = new Map({
      basemap: Basemap.fromId("satellite")!,
      layers: [L.im, L.roadNet, L.dam, L.bld, L.pile2d, L.pile3d, L.pitMesh,
               L.tails, L.trucks],
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
      /* Esri-гийн СУУРЬ ЗУРГИЙН ГАЛЕРЕЙ — зүүн дээд буланд икон, дарахад
         нээгдэнэ. Нэрсийг нь ОРЧУУЛАХГҮЙ, Esri-гийнхээр нь үлдээнэ.
         Урьд нь энд өөрсдийн 4 товчтой самбар байсныг орлоно. */
      view.ui.add(
        new Expand({
          view,
          expandIcon: "basemap",
          content: new BasemapGallery({
            view,
            source: BM_IDS.map((id) => Basemap.fromId(id)).filter(Boolean) as Basemap[],
          }),
        }),
        "top-left",
      );

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
        window.removeEventListener("emc-theme", applyTheme);
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
    /* Зогсоолын шугам дээрх хөдөлгөөнгүй машинууд (уурхайн ажлын талбай,
       үйлдвэрийн орчим). Сар солиход өөрчлөгдөхгүй тул нэг л удаа. */
    parkedRef.current = await loadParked();

    /* Хаягдлын ГАЗАР ДООРХ хоолой — жинхэнэ шугам (Bayjuulah_hayagdal_line) */
    tailPath.current = await loadTailLine();
    drawTailPipe();

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
    if (!destsRef.current.length || !L.trucks) return;

    const sim = new FlowSim(destsRef.current, stateRef.current.m, 14, parkedRef.current);
    simRef.current = sim;

    /* Маршрутыг ТУСГАЙ ШУГАМААР ЗУРАХГҮЙ. Урьд нь чиглэл бүрийг өнгөт
       шугамаар давхарлаж байсан нь `Road_truck_SL` замын дээгүүр гарч,
       өөр нэг зам мэт уншигдаж байв. Одоо газрын зураг дээр ЗӨВХӨН
       сервисийн зам харагдана; чиглэлийг машины ӨНГӨ, харин тонны
       хэмжээг машины ТОО илэрхийлнэ. */
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

  /**
   * Машины хэмжээ.
   *
   * Бодит хэмжээ (8.0 x 6.2 x 12.8 м) нь уурхай + овоолгыг хамарсан
   * хүрээнд пикселийн доогуур ордог тул масштабаас хамааруулж бага зэрэг
   * томруулна.
   *
   * ГЭХДЭЭ ХЭТ ТОМРУУЛЖ БОЛОХГҮЙ. Өмнө нь дээд хязгаар 40 м байсан
   * (өргөн зумд 33 м -> 68 м урт). Ийм ӨНДӨР биет налуу камерт
   * суурьнаасаа хэдэн арван метр тонгойж, машинууд замаас гарсан мэт
   * болж байв. Мөн дүрслэлийн урт нь мөргөлдөөнөөс сэргийлэх зайнаас
   * их байвал зайг хангасан ч НҮДЭНД давхцаж харагддаг: 29 м урт үед
   * давхцал 471, 19 м үед 383 болдгийг хэмжсэн. Одоо 11 м-ээр
   * (≈23 м урт) таслав.
   *
   * Хэмжээг алхамчилсан тул тэмдэгт байнга солигдож анивчихгүй
   * (`truckKey`-г үз).
   */
  function truckHeight() {
    const sc = viewRef.current?.scale ?? 20000;
    const h = Math.max(6.2, Math.min(11, sc / 2200));
    return Math.round(h * 2) / 2;
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
  /** Хоолойн дагуух хуримтлагдсан зай — дэд хэрчим таслахад хэрэгтэй */
  function tailCum() {
    const path = tailPath.current;
    const cum = [0];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const la = ((a.lat + b.lat) / 2) * (Math.PI / 180);
      cum.push(cum[i - 1] + Math.hypot(
        (b.lon - a.lon) * 111320 * Math.cos(la), (b.lat - a.lat) * 110540));
    }
    return cum;
  }

  /** Хоолойн s0..s1 хэсгийн оройнууд */
  function tailSeg(cum: number[], s0: number, s1: number) {
    const path = tailPath.current;
    const total = cum[cum.length - 1];
    const a = Math.max(0, Math.min(total, s0));
    const b = Math.max(0, Math.min(total, s1));
    const at = (s: number) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      const p = path[i - 1], q = path[i];
      return [p.lon + (q.lon - p.lon) * t, p.lat + (q.lat - p.lat) * t, 0];
    };
    const out: number[][] = [at(a)];
    for (let i = 1; i < cum.length - 1; i++) if (cum[i] > a && cum[i] < b) {
      out.push([path[i].lon, path[i].lat, 0]);
    }
    out.push(at(b));
    return out;
  }

  /**
   * Хоолой өөрөө — нэг л удаа зурагдана.
   *
   * `line` биш `path` симбол: дугуй хөндлөн огтлолтой ЖИНХЭНЭ ХООЛОЙ
   * (метрээр хэмжигдэнэ, зумаас хамаарахгүй). Хагас тунгалаг тул дотор нь
   * урсаж буй бодис харагдана. Урьд нь нимгэн шугам дээгүүр бөмбөлөг
   * өнхөрдөг байсан нь хоолой мэт огт уншигддаггүй байв.
   */
  function drawTailPipe() {
    const L = layersRef.current;
    const path = tailPath.current;
    if (!L.tails || path.length < 2) return;
    L.tails.removeAll();
    tailGfx.current = [];
    const geom = {
      type: "polyline", spatialReference: { wkid: 4326 },
      paths: [path.map((p) => [p.lon, p.lat, 0])],
    } as any;
    const tube = (d: number, color: [number, number, number, number]) => ({
      type: "line-3d",
      symbolLayers: [{
        type: "path", profile: "circle", width: d, height: d,
        cap: "round", join: "round",
        material: { color }, castShadows: false,
      }],
    } as any);
    /* 1) Хоолойн бүрхүүл — хагас тунгалаг */
    L.tails.add(new Graphic({ geometry: geom, symbol: tube(PIPE_D, hex("#9fb6c4", 0.5)) }));
    /* 2) УСНЫ ЦӨМ — хоолойн БҮХ УРТААР тасралтгүй. Урьд нь зөвхөн
          хөдөлж буй хэрчмүүд байсан тул хоолой хоосон, ус тасархай
          мэт харагддаг байв. */
    L.tails.add(new Graphic({
      geometry: geom, symbol: tube(FLOW_D, hex(cssVar("var(--water)"), 0.55)),
    }));
  }


  function drawTailings(tsec: number) {
    const L = layersRef.current;
    const path = tailPath.current;
    if (!L.tails || path.length < 2) return;

    /* Урсгалын НЯГТ ба ХУРД нь Excel-ийн тоогоор: «Агуулахад гаргасан
       хүдэр (хаягдал)» + «Бохирдол, нийт» (сард 206–254 мян.тн).
       Хуваарь 0-ээс эхэлнэ — сар хоорондын зөрүү бодитоор уншигдана. */
    const q = sumCol(stateRef.current.m, C.AGU) + sumCol(stateRef.current.m, C.BOH);
    const N = Math.max(4, Math.min(26, Math.round(q / 16)));
    const spd = 0.02 + (q / 260) * 0.05;

    const cum = tailCum();
    const total = cum[cum.length - 1];

    if (tailGfx.current.length !== N) {
      L.tails.removeMany(tailGfx.current);
      tailGfx.current = Array.from({ length: N }, () => new Graphic());
      L.tails.addMany(tailGfx.current);
    }
    for (let k = 0; k < N; k++) {
      const s0 = ((tsec * spd + k / N) % 1) * total;
      const g = tailGfx.current[k];
      /* ГЕОМЕТРийг л шинэчилнэ — симбол хөндөгдөхгүй тул анивчихгүй */
      g.geometry = {
        type: "polyline", spatialReference: { wkid: 4326 },
        paths: [tailSeg(cum, s0, Math.min(total, s0 + FLOW_SEG))],
      } as any;
      if (!g.symbol) {
        g.symbol = {
          type: "line-3d",
          symbolLayers: [{
            /* Усны цөмийн ДОТОР гүйх тод долгион. Цөм нь хагас тунгалаг
               тул дотуур нь харагдана; цөм тасралтгүй учир эдгээр нь
               хоосон зай биш, урсгалын хөдөлгөөнийг л заана. */
            type: "path", profile: "circle",
            width: WAVE_D, height: WAVE_D,
            cap: "round", join: "round",
            material: { color: hex("#cdeef7", 0.95) },
            castShadows: false,
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
  const ISO = ["im", "roadNet", "dam", "bld", "pile2d", "pile3d"];

  function toggleIsolate() { applyIsolate(!isolated); }

  function applyIsolate(on: boolean) {
    const view = viewRef.current, map = mapRef.current, L = layersRef.current;
    if (!view || !map) return;
    setIsolated(on);

    if (on) {
      prevVis.current = {};
      ISO.forEach((k) => { if (L[k]) { prevVis.current[k] = L[k].visible; L[k].visible = false; } });
      prevBasemap.current = map.basemap ?? null;
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
      /* Хэрэглэгч галерейгээс сонгосон суурь зургийг сэргээнэ */
      map.basemap = prevBasemap.current ?? Basemap.fromId("satellite")!;
      map.ground.opacity = GROUND_OPACITY[groundStep];
      view.environment.atmosphereEnabled = true;
      (view.environment.lighting as any).directShadowsEnabled = false;
    }

    document.body.classList.toggle("isolated", on);
    /* Сарын DWG мэш нь ЗӨВХӨН тусгаарлах горимд гарна — энгийн горимд
       бодит мэштэй яг нэг зайг эзэлж, хоёулаа бүдгэрдэг. Хэрэгтэй бол
       «Давхарга»-аас гараар асааж болно. */
    L.pitMesh.visible = on;
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
    { key: "im",      n: t.lyIm,     c: "#9aa6b2" },
    { key: "pitMesh", n: t.lyMesh,   c: "#8d7f70" },
    { key: "pile3d",  n: t.lyPile3d, c: PILE_HEX },
    { key: "pile2d",  n: t.lyPile2d, c: PILE_EDGE_HEX },
    { key: "dam",     n: t.lyDam,    c: "var(--water)" },
    { key: "roadNet", n: t.lyRoadNet, c: "#c9b57a" },
    { key: "bld",     n: t.lyBld,    c: BLD_COLOR.bu },
    { key: "trucks",  n: t.lyTrucks, c: TRUCK_COLOR.bu },
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

            <div className="lbh" style={{ marginTop: 4 }}>{t.ground}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {GROUND_OPACITY.map((o, i) => (
                <button key={i} className="ghost sm" aria-pressed={groundStep === i}
                        onClick={() => { setGroundStep(i); mapRef.current!.ground.opacity = o; }}>
                  {GROUND_NM[lang][i]}
                </button>
              ))}
            </div>

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
          {/* Толгойд бодит муж, доор нь квантилийн завсрууд. Урьд нь
              0.15 / 0.50 гэсэн гараар бичсэн хоёр тоо байв. */}
          <span>{t.legGrade} · {GRADE_RANGE[0].toFixed(2)}–{GRADE_RANGE[1].toFixed(2)}</span>
          <div className="ramp">
            {[1, 2, 3, 4, 5, 6].map((i) => <i key={i} style={{ background: `var(--g${i})` }} />)}
          </div>
          <div className="rax">
            {GRADE_BREAKS.map((b, i) => (
              <b key={i} style={{ left: `${((i + 1) / 6) * 100}%` }}>{b.toFixed(2)}</b>
            ))}
          </div>
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
