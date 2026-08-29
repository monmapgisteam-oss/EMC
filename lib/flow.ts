/* ==========================================================================
   Материалын урсгал: ил уурхай -> хүлээн авагч
   --------------------------------------------------------------------------
   Ачааны машины тоо, чиглэл бүгд EXCEL-ийн тоон дээр суурилна. Тухайн сарын
   тонн хэдий их байна тэр чиглэлд төдий олон машин явна.

   МАРШРУТЫН ТУХАЙД — яагаад жинхэнэ замаар биш вэ:
     «Зам» давхарга (Engineering_EMC/22, 3 568 шугам) бол CAD-ийн зурган
     давхарга, маршрутын сүлжээ биш. ArcGIS-ийн `FeatureToLine`-аар
     планаржуулаад граф болгоход хамгийн том холбогдсон бүрэлдэхүүн
     ердөө 6 % (зангилаа нэгтгэх нарийвчлалыг 20 м болгоход ч 34 %),
     овоолгууд руу 2.6–3.3 км «буулт» гарсан. Өөрөөр хэлбэл маршрут нь
     жинхэнэ овоолгод хүрэхгүй. Албадан холбовол байхгүй холбоос зохиох
     болно. Тиймээс урсгалыг СХЕМИЙН муруй замаар харуулж байна —
     хэмжээ, чиглэл, эзлэх хувь нь бодит, зам нь схем.
   ========================================================================== */

import { SVC, C } from "./config";
import { sumCol } from "./excel";

export type DestCode = "BU" | "OV12" | "OV14" | "OV8A" | "OV9A" | "OV9B" | "HOOSON";

export interface Dest {
  code: DestCode;
  name: string;
  col: number;          // Excel-ийн багана
  lon: number; lat: number; z: number;
  color: string;
}

export interface FlowPt { lon: number; lat: number; z: number; s: number }
export interface FlowRoute { dest: Dest; pts: FlowPt[]; len: number }

export interface Truck {
  id: number;
  dest: DestCode;
  destName: string;
  lon: number; lat: number; z: number;
  heading: number;
  loaded: boolean;
  tonnes: number;       // тухайн чиглэлийн сарын тонн
  color: string;
}

const M_LAT = 110540;
const mLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

function metres(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const dx = (b.lon - a.lon) * mLon((a.lat + b.lat) / 2);
  const dy = (b.lat - a.lat) * M_LAT;
  return Math.hypot(dx, dy);
}

/* Excel-ийн багана -> овоолгын нэрс (extent-ийг нь олоход хэрэглэнэ) */
const DEST_DEF: { code: DestCode; name: string; col: number; piles: string[] | null; color: string }[] = [
  { code: "BU",     name: "Баяжуулах үйлдвэр", col: C.BU,     piles: null, color: "var(--s1)" },
  { code: "OV12",   name: "Овоолго 12",        col: C.OV12,   piles: ["Овоолго 12"], color: "var(--s2)" },
  { code: "OV14",   name: "Овоолго 14",        col: C.OV14,   piles: ["Овоолго 14"], color: "var(--s2)" },
  { code: "OV8A",   name: "Овоолго 8а",        col: C.OV8A,   piles: ["Овоолго 8а"], color: "var(--s2)" },
  { code: "OV9A",   name: "Овоолго 9а · 8 · 9", col: C.OV9A,  piles: ["Овоолго 9а", "Овоолго 8", "Овоолго 9"], color: "var(--s3)" },
  { code: "OV9B",   name: "Овоолго 9б",        col: C.OV9B,   piles: ["Овоолго 9б"], color: "var(--s3)" },
  { code: "HOOSON", name: "Овоолго №1, 4, 11", col: C.HOOSON, piles: ["Овоолго 1", "Овоолго 4", "Овоолго 11"], color: "var(--s4)" },
];

async function extentCenter(url: string, where: string) {
  const q = new URLSearchParams({ where, returnExtentOnly: "true", outSR: "4326", f: "json" });
  const d = await (await fetch(`${url}/query?${q}`)).json();
  const e = d?.extent;
  if (!e) return null;
  return { lon: (e.xmin + e.xmax) / 2, lat: (e.ymin + e.ymax) / 2 };
}

/** Хүлээн авагч бүрийн байрлалыг сервисээс нэг удаа тогтооно */
export async function loadDests(): Promise<Dest[]> {
  const out: Dest[] = [];
  for (const d of DEST_DEF) {
    const where = d.piles
      ? d.piles.map((p) => `dugaar = '${p}'`).join(" OR ")
      : "type1 = 1";
    const url = d.piles ? SVC.pile2d : SVC.bldFS;
    try {
      const c = await extentCenter(url, where);
      if (!c) continue;
      /* Овоолгын оргилын өндрийг ойролцоогоор — 2D давхаргад Z байхгүй тул
         питийн ирмэгийн түвшнээс дээш бага зэрэг өргөнө. */
      out.push({ code: d.code, name: d.name, col: d.col, color: d.color,
                 lon: c.lon, lat: c.lat, z: d.code === "BU" ? 1400 : 1360 });
    } catch { /* нэг нь унасан ч бусад нь ажиллана */ }
  }
  return out;
}

/**
 * Ачаалах цэгээс хүлээн авагч хүртэлх схемийн зам.
 * Шулуун биш — хажуу тийш хазайсан хоёр дахин муруй (Безье) болгосон
 * тул питийн ирмэгийг тойрч байгаа мэт уншигдана.
 */
export function makeRoute(load: { lon: number; lat: number; z: number }, dest: Dest, bow = 0.18): FlowRoute {
  const N = 48;
  const mx = (load.lon + dest.lon) / 2;
  const my = (load.lat + dest.lat) / 2;
  const dx = dest.lon - load.lon;
  const dy = dest.lat - load.lat;
  /* хяналтын цэгийг перпендикуляр чиглэлд хазайлгана */
  const cx = mx - dy * bow;
  const cy = my + dx * bow;

  const pts: FlowPt[] = [];
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const lon = u * u * load.lon + 2 * u * t * cx + t * t * dest.lon;
    const lat = u * u * load.lat + 2 * u * t * cy + t * t * dest.lat;
    /* өндөр: питээс гарах эхний хэсэгт эгц өгсөж, дараа нь тэгширнэ */
    const climb = Math.min(1, t / 0.45);
    const z = load.z + (dest.z - load.z) * (climb * 0.85 + t * 0.15);
    if (i > 0) s += metres(pts[i - 1], { lon, lat });
    pts.push({ lon, lat, z, s });
  }
  return { dest, pts, len: s };
}

function at(r: FlowRoute, s: number) {
  const sc = Math.max(0, Math.min(r.len, s));
  let i = 1;
  while (i < r.pts.length - 1 && r.pts[i].s < sc) i++;
  const a = r.pts[i - 1], b = r.pts[i];
  const t = (sc - a.s) / Math.max(1e-6, b.s - a.s);
  const lon = a.lon + (b.lon - a.lon) * t;
  const lat = a.lat + (b.lat - a.lat) * t;
  const z = a.z + (b.z - a.z) * t;
  const dx = (b.lon - a.lon) * mLon(lat);
  const dy = (b.lat - a.lat) * M_LAT;
  return { lon, lat, z, heading: (Math.atan2(dx, dy) * 180) / Math.PI };
}

interface Unit { route: FlowRoute; s: number; dir: 1 | -1 }

const SPEED_LOADED = 7;    // м/с (~25 км/ц)
const SPEED_EMPTY = 10;    // м/с (~36 км/ц)

/** Тухайн сарын тонноор машинуудыг чиглэл тус бүрт хуваарилна */
export class FlowSim {
  private units: Unit[] = [];
  readonly trucks: Truck[] = [];
  readonly routes: FlowRoute[] = [];

  constructor(load: { lon: number; lat: number; z: number }, dests: Dest[], month: number, fleet = 14) {
    const share = dests.map((d) => ({ d, v: sumCol(month, d.col) })).filter((x) => x.v > 0);
    const total = share.reduce((a, x) => a + x.v, 0) || 1;

    let id = 0;
    share.forEach((x, k) => {
      const route = makeRoute(load, x.d, k % 2 === 0 ? 0.18 : -0.14);
      this.routes.push(route);
      /* Хамгийн багадаа 1 машин; үлдсэнийг тонны хувиар */
      const n = Math.max(1, Math.round((x.v / total) * fleet));
      for (let i = 0; i < n; i++) {
        const s = route.len * ((i / n + k * 0.13) % 1);
        this.units.push({ route, s, dir: 1 });
        this.trucks.push({
          id: id++, dest: x.d.code, destName: x.d.name,
          lon: 0, lat: 0, z: 0, heading: 0, loaded: true,
          tonnes: x.v, color: x.d.color,
        });
      }
    });
    this.step(0);
  }

  step(dt: number) {
    this.units.forEach((u, i) => {
      const t = this.trucks[i];
      u.s += u.dir * (u.dir === 1 ? SPEED_LOADED : SPEED_EMPTY) * dt;
      if (u.s >= u.route.len) { u.s = u.route.len; u.dir = -1; }
      else if (u.s <= 0) { u.s = 0; u.dir = 1; }
      const p = at(u.route, u.s);
      t.lon = p.lon; t.lat = p.lat; t.z = p.z;
      t.heading = u.dir === 1 ? p.heading : (p.heading + 180) % 360;
      t.loaded = u.dir === 1;      /* уурхайгаас гарах үед ачаалалтай */
    });
  }
}

/* ------------------------------------------------------------------------
   Хаягдлын урсгал: баяжуулах үйлдвэр -> хаягдлын далан
   Excel-ийн «Бохирдол» ба «Захын агуулга — хаягдал» нь хүдэрт орсон
   хаягдал; боловсруулалтын дараа хаягдлын санд очно. Тээврийн машинаар
   биш, ХООЛОЙгоор дамждаг тул урсгалыг хөдөлгөөнт цэгээр үзүүлнэ.
   ------------------------------------------------------------------------ */
export interface TailPt { lon: number; lat: number; z: number }

export async function damCenter(): Promise<{ lon: number; lat: number } | null> {
  const q = new URLSearchParams({
    where: "Date = '2024/01'", returnExtentOnly: "true", outSR: "4326", f: "json",
  });
  const d = await (await fetch(`${SVC.dam}/query?${q}`)).json();
  const e = d?.extent;
  if (!e) return null;
  return { lon: (e.xmin + e.xmax) / 2, lat: (e.ymin + e.ymax) / 2 };
}

export function tailingsPath(bu: Dest, dam: { lon: number; lat: number }): TailPt[] {
  const N = 40;
  const pts: TailPt[] = [];
  const cx = (bu.lon + dam.lon) / 2 + (dam.lat - bu.lat) * 0.10;
  const cy = (bu.lat + dam.lat) / 2 - (dam.lon - bu.lon) * 0.10;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push({
      lon: u * u * bu.lon + 2 * u * t * cx + t * t * dam.lon,
      lat: u * u * bu.lat + 2 * u * t * cy + t * t * dam.lat,
      z: bu.z + (1290 - bu.z) * t,
    });
  }
  return pts;
}
