/* ==========================================================================
   Материалын урсгал: ил уурхай -> хүлээн авагч
   --------------------------------------------------------------------------
   Ачааны машины тоо, чиглэл бүгд EXCEL-ийн тоон дээр суурилна. Тухайн сарын
   тонн хэдий их байна тэр чиглэлд төдий олон машин явна.

   МАРШРУТ — `Road_truck` сервисийн ЖИНХЭНЭ тээврийн замаар.
     35 шугам, 77 км. `tools/build_haul_routes.py` нь үүнийг граф болгож
     (15 м-ийн хүлцлээр зангилаа нэгтгэхэд 100 % холбогдоно), ачаалах цэгээс
     хүлээн авагч бүр рүү Dijkstra-аар хамгийн богино замыг тооцоод
     `public/data/haul_routes.json`-д бичнэ. Ажиллах үед энэ файлыг л уншина.

     Өмнө нь схемийн Безье муруй байсан: тухайн үед байсан `Engineering_EMC/22`
     давхарга бол CAD-ийн зурган давхарга байсан тул граф болгоход хамгийн том
     холбогдсон бүрэлдэхүүн нь ердөө 6 % гарч байв.

   ЗОГСОЛТ — зигзаг эргэлт дээр.
     Уулын замын шилжлэгт (switchback) машин зогсож, ухарч эргэдэг. Тиймээс
     чиглэл огцом эргэсэн цэгүүдийг илрүүлээд тэнд машиныг түр зогсооно.
   ========================================================================== */

import { C } from "./config";
import { sumCol } from "./excel";

export type DestCode = "BU" | "OV12" | "OV14" | "OV8A" | "OV9A" | "OV9B" | "HOOSON";

export interface Dest {
  code: DestCode;
  name: string;
  col: number;          // Excel-ийн багана
  lon: number; lat: number; z: number;
  color: string;
  path: [number, number][];   // жинхэнэ замын оройнууд
  len: number;                // замын урт, м
  stub: number;               // сүлжээнээс хүлээн авагч хүртэлх зохиомол холбоос, м
}

export interface FlowPt { lon: number; lat: number; z: number; s: number }
export interface FlowRoute { dest: Dest; pts: FlowPt[]; len: number; stops: number[] }

export interface Truck {
  id: number;
  dest: DestCode;
  destName: string;
  lon: number; lat: number; z: number;
  heading: number;
  loaded: boolean;
  halted: boolean;      // эргэлт дээр зогсож байна уу
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

/** Excel-ийн багана, өнгө, нэр. Кодууд haul_routes.json-той тохирно. */
const DEST_DEF: Record<DestCode, { name: string; col: number; color: string }> = {
  BU:     { name: "Баяжуулах үйлдвэр",  col: C.BU,     color: "var(--s1)" },
  OV12:   { name: "Овоолго 12",         col: C.OV12,   color: "var(--s2)" },
  OV14:   { name: "Овоолго 14",         col: C.OV14,   color: "var(--s2)" },
  OV8A:   { name: "Овоолго 8а",         col: C.OV8A,   color: "var(--s2)" },
  OV9A:   { name: "Овоолго 9а · 8 · 9", col: C.OV9A,   color: "var(--s3)" },
  OV9B:   { name: "Овоолго 9б",         col: C.OV9B,   color: "var(--s3)" },
  HOOSON: { name: "Овоолго №1, 4, 11",  col: C.HOOSON, color: "var(--s4)" },
};

/** Урьдчилан тооцсон жинхэнэ маршрутуудыг уншина. */
export async function loadDests(): Promise<Dest[]> {
  let raw: Record<string, { name: string; pts: [number, number][]; len: number; stub: number }>;
  try {
    raw = await (await fetch("/data/haul_routes.json")).json();
  } catch {
    return [];
  }
  const out: Dest[] = [];
  for (const code of Object.keys(DEST_DEF) as DestCode[]) {
    const r = raw[code];
    if (!r || !r.pts || r.pts.length < 2) continue;
    const d = DEST_DEF[code];
    const end = r.pts[r.pts.length - 1];
    out.push({
      code, name: d.name, col: d.col, color: d.color,
      path: r.pts, len: r.len, stub: r.stub,
      lon: end[0], lat: end[1], z: code === "BU" ? 1400 : 1360,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ зогсолт */

/** Чиглэл ийм өнцгөөс их эргэвэл шилжлэг гэж үзнэ (градус). */
const TURN_DEG = 95;
/** Эргэлтийг хэмжих цонх — нэг шилжлэг олон оройд хуваагдсан байдаг (м). */
const TURN_WIN = 55;
/** Хоёр зогсолт хоорондоо ойрхон бол нэг гэж үзнэ (м). */
const STOP_MERGE = 90;

function ptAt(pts: FlowPt[], s: number) {
  const sc = Math.max(0, Math.min(pts[pts.length - 1].s, s));
  let i = 1;
  while (i < pts.length - 1 && pts[i].s < sc) i++;
  const a = pts[i - 1], b = pts[i];
  const t = (sc - a.s) / Math.max(1e-6, b.s - a.s);
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
}

/**
 * Замын шилжлэгүүдийг олно.
 *
 * Орой тус бүрээр өнцөг хэмжвэл олдохгүй: нэг шилжлэг 4–6 оройд хуваагдаж,
 * тус бүр нь 30–40° л эргэсэн байдаг. Тиймээс тухайн цэгээс ӨМНӨХ ба ХОЙНОХ
 * `TURN_WIN` метрийн чиглэлийг харьцуулна.
 */
function findStops(pts: FlowPt[]): number[] {
  const len = pts[pts.length - 1].s;
  const raw: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const s = pts[i].s;
    if (s < TURN_WIN || s > len - TURN_WIN) continue;
    const a = ptAt(pts, s - TURN_WIN);
    const b = ptAt(pts, s + TURN_WIN);
    const la = pts[i].lat;
    const v1x = (pts[i].lon - a.lon) * mLon(la), v1y = (pts[i].lat - a.lat) * M_LAT;
    const v2x = (b.lon - pts[i].lon) * mLon(la), v2y = (b.lat - pts[i].lat) * M_LAT;
    const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
    if (n1 < 1 || n2 < 1) continue;
    const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (turn >= TURN_DEG) raw.push(s);
  }
  /* Зэргэлдээ оройнууд нэг л шилжлэгийг зааж байвал нийлүүлнэ */
  const out: number[] = [];
  for (const s of raw) {
    if (!out.length || s - out[out.length - 1] > STOP_MERGE) out.push(s);
    else out[out.length - 1] = (out[out.length - 1] + s) / 2;
  }
  return out;
}

/** Урьдчилан тооцсон замаас FlowRoute үүсгэнэ. */
export function makeRoute(dest: Dest): FlowRoute {
  const pts: FlowPt[] = [];
  let s = 0;
  dest.path.forEach((p, i) => {
    const q = { lon: p[0], lat: p[1], z: 0, s: 0 };
    if (i > 0) s += metres(pts[i - 1], q);
    q.s = s;
    pts.push(q);
  });
  return { dest, pts, len: s, stops: findStops(pts) };
}

function at(r: FlowRoute, s: number) {
  const sc = Math.max(0, Math.min(r.len, s));
  let i = 1;
  while (i < r.pts.length - 1 && r.pts[i].s < sc) i++;
  const a = r.pts[i - 1], b = r.pts[i];
  const t = (sc - a.s) / Math.max(1e-6, b.s - a.s);
  const lon = a.lon + (b.lon - a.lon) * t;
  const lat = a.lat + (b.lat - a.lat) * t;
  const dx = (b.lon - a.lon) * mLon(lat);
  const dy = (b.lat - a.lat) * M_LAT;
  return { lon, lat, z: 0, heading: (Math.atan2(dx, dy) * 180) / Math.PI };
}

interface Unit { route: FlowRoute; s: number; dir: 1 | -1; wait: number; next: number }

const SPEED_LOADED = 7;    // м/с (~25 км/ц)
const SPEED_EMPTY = 10;    // м/с (~36 км/ц)
const STOP_SEC = 2.2;      // шилжлэг дээр зогсох хугацаа

/** Явах чиглэлд байгаа дараагийн зогсолтын индекс */
function nextStop(r: FlowRoute, s: number, dir: 1 | -1) {
  if (dir === 1) {
    for (let i = 0; i < r.stops.length; i++) if (r.stops[i] > s + 1) return i;
    return -1;
  }
  for (let i = r.stops.length - 1; i >= 0; i--) if (r.stops[i] < s - 1) return i;
  return -1;
}

/** Тухайн сарын тонноор машинуудыг чиглэл тус бүрт хуваарилна */
export class FlowSim {
  private units: Unit[] = [];
  readonly trucks: Truck[] = [];
  readonly routes: FlowRoute[] = [];

  constructor(dests: Dest[], month: number, fleet = 14) {
    const share = dests.map((d) => ({ d, v: sumCol(month, d.col) })).filter((x) => x.v > 0);
    const total = share.reduce((a, x) => a + x.v, 0) || 1;

    let id = 0;
    share.forEach((x, k) => {
      const route = makeRoute(x.d);
      this.routes.push(route);
      /* Хамгийн багадаа 1 машин; үлдсэнийг тонны хувиар */
      const n = Math.max(1, Math.round((x.v / total) * fleet));
      for (let i = 0; i < n; i++) {
        const s = route.len * ((i / n + k * 0.13) % 1);
        this.units.push({ route, s, dir: 1, wait: 0, next: nextStop(route, s, 1) });
        this.trucks.push({
          id: id++, dest: x.d.code, destName: x.d.name,
          lon: 0, lat: 0, z: 0, heading: 0, loaded: true, halted: false,
          tonnes: x.v, color: x.d.color,
        });
      }
    });
    this.step(0);
  }

  step(dt: number) {
    this.units.forEach((u, i) => {
      const t = this.trucks[i];
      const r = u.route;

      if (u.wait > 0) {
        u.wait -= dt;
        t.halted = true;
      } else {
        t.halted = false;
        const v = u.dir === 1 ? SPEED_LOADED : SPEED_EMPTY;
        let ns = u.s + u.dir * v * dt;

        /* Шилжлэг дээр зогсоно — цаашилж давахгүй, яг тэр цэгт таслана */
        if (u.next >= 0) {
          const sp = r.stops[u.next];
          if ((u.dir === 1 && ns >= sp) || (u.dir === -1 && ns <= sp)) {
            ns = sp;
            u.wait = STOP_SEC;
            u.next += u.dir;
            if (u.next < 0 || u.next >= r.stops.length) u.next = -1;
          }
        }

        if (ns >= r.len) { ns = r.len; u.dir = -1; u.next = nextStop(r, ns, -1); }
        else if (ns <= 0) { ns = 0; u.dir = 1; u.next = nextStop(r, ns, 1); }
        u.s = ns;
      }

      const p = at(r, u.s);
      t.lon = p.lon; t.lat = p.lat; t.z = 0;
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
import { SVC } from "./config";

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
      z: 0,
    });
  }
  return pts;
}
