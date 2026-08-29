/* ==========================================================================
   Excel «Нийт орд arcgis» — асуулгууд
   Түлхүүр: "Сар|Түвшин|Блок",  утга: 15 баганын массив × 5 үзүүлэлт
   ========================================================================== */
import raw from "@/public/data/excel.json";
import { C } from "./config";

export type Measure = "kt" | "cu" | "cut" | "mo" | "mot";
export type Group = Record<Measure, number[]>;

export const G = raw as unknown as Record<string, Group>;

const KEYS = Object.keys(G);

/** Тухайн сарын бүх түлхүүр */
export function keysOf(m: number): string[] {
  return KEYS.filter((k) => parseInt(k, 10) === m);
}

export function grp(m: number, tuv: number, blk: string): Group | null {
  return G[`${m}|${tuv}|${blk}`] ?? null;
}

/** Тухайн сар + түвшинд байгаа «Блок»-ууд (БҮ эхэнд) */
export function blocksAt(m: number, tuv: number): string[] {
  const out: string[] = [];
  for (const k of KEYS) {
    const p = k.split("|");
    if (+p[0] === m && +p[1] === tuv) out.push(p[2]);
  }
  return out.sort((a, b) => (a === "БҮ" ? -1 : b === "БҮ" ? 1 : a.localeCompare(b)));
}

/** Тухайн сард хөдөлгөөнтэй байсан түвшингүүд — дээрээс доош */
export function benchesOf(m: number): number[] {
  const s = new Set<number>();
  for (const k of keysOf(m)) s.add(+k.split("|")[1]);
  return [...s].sort((a, b) => b - a);
}

/** Баганын нийлбэр. tuv өгвөл зөвхөн тэр түвшингээр. */
export function sumCol(m: number, ci: number, tuv?: number): number {
  let t = 0;
  for (const k of keysOf(m)) {
    if (tuv !== undefined && +k.split("|")[1] !== tuv) continue;
    t += G[k].kt[ci];
  }
  return t;
}

export function metalSum(m: number, which: Measure, ci: number, tuv?: number): number {
  let t = 0;
  for (const k of keysOf(m)) {
    if (tuv !== undefined && +k.split("|")[1] !== tuv) continue;
    t += G[k][which][ci];
  }
  return t;
}

/** Жигнэсэн Cu агуулга, % — металл / (тонн × 1000) */
export function cuOf(m: number, tuv?: number): number {
  const kt = sumCol(m, C.NIIT, tuv);
  return kt > 0 ? (metalSum(m, "cut", C.NIIT, tuv) / (kt * 1000)) * 100 : 0;
}

export function moOf(m: number, tuv?: number): number {
  const kt = sumCol(m, C.NIIT, tuv);
  return kt > 0 ? (metalSum(m, "mot", C.NIIT, tuv) / (kt * 1000)) * 100 : 0;
}

/** Доод зурвасын өгөгдөл: БҮ-т · овоолгод (балансын) · овоолгод (балансын бус) */
export function monthlyFlow(m: number): [number, number, number] {
  return [
    sumCol(m, C.BU),
    sumCol(m, C.OV12) + sumCol(m, C.OV14) + sumCol(m, C.OV8A),
    sumCol(m, C.OV9A) + sumCol(m, C.OV9B),
  ];
}
