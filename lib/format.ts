/** Мянгатыг зайгаар тусгаарлана. 0 / null бол «—». */
export function fmt(n: number | null | undefined, d = 1): string {
  if (!n) return "—";
  const p = Math.abs(n).toFixed(d).split(".");
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "−" : "") + p.join(".");
}

/** CSS хувьсагчийн утга (браузер талд) */
export function css(v: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

/** Cu агуулга -> зэсийн ramp дахь алхам (--g1 … --g6) */
export function gradeVar(cu: number): string {
  const t = Math.max(0, Math.min(0.999, (cu - 0.15) / 0.35));
  return `--g${1 + Math.floor(t * 6)}`;
}

/** CSS-д шууд тавих утга. getComputedStyle-ийг ашиглахгүй — Next-ийн
 *  prerender үед тэр хоосон буцаж, баганууд өнгөгүй хэвээр үлддэг. */
export function gradeColor(cu: number): string {
  return `var(${gradeVar(cu)})`;
}

/** "#rrggbb" -> [r,g,b,a] (ArcGIS-ийн симбол материалд) */
export function hex(h: string, a = 1): [number, number, number, number] {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    a,
  ];
}

/** Multipatch_EMC-ийн type1 нь заримдаа тэмдэгт мөр болж ирдэг */
export function num1(v: unknown): number | null {
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
