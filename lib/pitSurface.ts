/* ==========================================================================
   Ил уурхайн сарын гадаргуугийн өнгө
   --------------------------------------------------------------------------
   · Байгалийн өнгө: хэвтээ шатны тавцан нь цайвар тоост саарал-шаргал,
     эгц хана нь бараан хүрэн-саарал (уурхайн агаарын зураг дээрх шиг).
     Налууг өндрийн тороос тооцно; бага зэргийн санамсаргүй хэлбэлзэл нь
     гадаргууг хуванцар мэт жигд харагдуулахгүй.
   · Өөрчлөлт: өмнөх сарын хэмжилтээс өндөр нь `CHANGE_M`-ээс илүү
     өөрчлөгдсөн (ухсан эсвэл асгасан) оройг улаанаар будна.
   Бүх сарын мэш нэг эх цэг, нэг 5 м-ийн DEM тороос үүссэн тул оройнууд
   нь сар хооронд яг ижил (x, y) дээр байрладаг — шууд харьцуулна.
   ========================================================================== */
import type Mesh from "@arcgis/core/geometry/Mesh";

/** Үүнээс бага өндрийн зөрүүг хэмжилтийн алдаа гэж үзнэ (м) */
export const CHANGE_M = 1.0;

const BENCH = [192, 188, 179];   // тавцан — тоост цайвар саарал
const FACE = [124, 116, 106];    // хана — бараан хүрэн-саарал
const RED = [227, 52, 44];

export interface PitColors {
  /** Байгалийн өнгө */
  base: Uint8Array;
  /** Өөрчлөлтийг улаанаар тодруулсан өнгө (өмнөх сар байхгүй бол null) */
  change: Uint8Array | null;
  /** Өөрчлөгдсөн талбай, га */
  changedHa: number;
}

const key = (gx: number, gy: number) => (gx + 32768) * 65536 + (gy + 32768);

function gridStep(pos: ArrayLike<number>): number {
  let cell = Infinity;
  for (let i = 3; i < Math.min(pos.length, 30000); i += 3) {
    const d = Math.abs(pos[i] - pos[i - 3]);
    if (d > 0.01 && d < cell) cell = d;
  }
  return Number.isFinite(cell) ? cell : 5;
}

function heights(pos: ArrayLike<number>, cell: number): Map<number, number> {
  const h = new Map<number, number>();
  for (let i = 0; i < pos.length; i += 3) {
    h.set(key(Math.round(pos[i] / cell), Math.round(pos[i + 1] / cell)), pos[i + 2]);
  }
  return h;
}

export function pitColors(mesh: Mesh, prev: Mesh | null): PitColors {
  const pos = mesh.vertexAttributes.position;
  const nv = pos.length / 3;
  const cell = gridStep(pos);
  const cur = heights(pos, cell);
  const old = prev ? heights(prev.vertexAttributes.position, cell) : null;

  /* Өндрийн зөрүүг 3×3 хөршөөр дунджилна — ганц оройн хэлбэлзэл
     гурвалжин «өргөс» болж харагдахаас сэргийлнэ */
  const dzAt = new Map<number, number>();
  if (old) {
    cur.forEach((z, k) => {
      const zp = old.get(k);
      if (zp !== undefined) dzAt.set(k, Math.abs(zp - z));
    });
  }
  const smoothDz = (gx: number, gy: number) => {
    let sum = 0, cnt = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const d = dzAt.get(key(gx + a, gy + b));
      if (d !== undefined) { sum += d; cnt++; }
    }
    return cnt ? sum / cnt : 0;
  };

  const base = new Uint8Array(nv * 4);
  const change = old ? new Uint8Array(nv * 4) : null;
  let changed = 0;
  for (let v = 0; v < nv; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
    const gx = Math.round(x / cell), gy = Math.round(y / cell);
    /* Налуу — хөрш оройнуудын өндрийн ялгаагаар (ирмэг дээр нэг талын) */
    const e = cur.get(key(gx + 1, gy)), w = cur.get(key(gx - 1, gy));
    const n = cur.get(key(gx, gy + 1)), s = cur.get(key(gx, gy - 1));
    const dx = e !== undefined && w !== undefined ? (e - w) / 2 : e !== undefined ? e - z : w !== undefined ? z - w : 0;
    const dy = n !== undefined && s !== undefined ? (n - s) / 2 : n !== undefined ? n - z : s !== undefined ? z - s : 0;
    const slope = Math.hypot(dx, dy) / cell;              // tan(налуу)
    const f = Math.min(Math.max((slope - 0.35) / 1.0, 0), 1);
    /* Тогтвортой «санамсаргүй» хэлбэлзэл (±5 %) — байрлалаас хамаарна */
    const hv = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
    const noise = 1 + (hv - Math.floor(hv) - 0.5) * 0.1;
    for (let c = 0; c < 3; c++) {
      base[4 * v + c] = Math.min(255, (BENCH[c] * (1 - f) + FACE[c] * f) * noise);
    }
    base[4 * v + 3] = 255;

    if (!old || !change) continue;
    const dz = smoothDz(gx, gy);
    const t = dz < CHANGE_M ? 0 : Math.min(1, 0.65 + (dz - CHANGE_M) / 10);
    if (t) changed++;
    for (let c = 0; c < 3; c++) change[4 * v + c] = base[4 * v + c] * (1 - t) + RED[c] * t;
    change[4 * v + 3] = 255;
  }
  return { base, change, changedHa: (changed * cell * cell) / 10000 };
}
