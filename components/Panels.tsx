"use client";

import { Fragment } from "react";
import { useStore } from "@/lib/store";
import { C, COL_NAMES, ELEV, BLK2PILE, TRUCK_COLOR } from "@/lib/config";
import { benchesOf, blocksAt, cuOf, grp, metalSum, moOf, monthlyFlow, sumCol } from "@/lib/excel";
import { fmt, gradeColor } from "@/lib/format";
import { MON_L, ROMAN } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";

/* ==========================================================================
   ХОЛБОГДСОН ШҮҮЛТ. Бүх чарт нэг Excel-ээс уншдаг тул нэг дор шүүгдэх
   ёстой: хаялбар сонгоход бусад бүх чарт ЗӨВХӨН тэр түвшний тоог үзүүлнэ.
   Сонголт нь `sel` (store) — хаялбарын жагсаалт болон газрын зургаас
   хоёулангаас нь тавигдана.
   ========================================================================== */
function useTuv(): number | undefined {
  const { sel } = useStore();
  return sel?.kind === "bench" ? sel.tuv : undefined;
}

/* ------------------------------------------------------------------ KPI */
export function Kpis() {
  const { m, t } = useStore();
  const tuv = useTuv();
  const p = m > 1 ? m - 1 : null;
  /* Дөрвөн үзүүлэлт нь Excel-ийн ДӨРВӨН баганаас шууд:
       NOOC   — олборлосон үйлдвэрлэлийн нөөц (захын агуулга 0.25 %)
       NIIT   — нийт олборлосон хүдэр (БҮ + овоолгууд)
       HOOSON — хоосон чулуулаг (Овоолго №1, 4, 11)
       TSUL   — нийт уулын цул */
  const defs = [
    { k: t.kRes,   s: t.kResSub,   ci: C.NOOC,   u: t.uKt, dec: 1 },
    { k: t.kOre,   s: t.kOreSub,   ci: C.NIIT,   u: t.uKt, dec: 0 },
    { k: t.kWaste, s: t.kWasteSub, ci: C.HOOSON, u: t.uM3, dec: 1 },
    { k: t.kRock,  s: t.kRockSub,  ci: C.TSUL,   u: t.uM3, dec: 0 },
  ];
  return (
    <div className="kpis">
      {defs.map((o) => {
        const v = sumCol(m, o.ci, tuv);
        const prev = p ? sumCol(p, o.ci, tuv) : null;
        const pc = prev ? ((v - prev) / prev) * 100 : null;
        return (
          <div className="kpi" key={o.k}>
            <div className="k">{o.k}</div>
            <div className="v">
              <b>{fmt(v, o.dec)}</b>
              <i>{o.u}</i>
              {pc !== null && (
                <em className={pc >= 0 ? "up" : "dn"}>
                  {(pc >= 0 ? "▲ " : "▼ ") + Math.abs(pc).toFixed(1) + "%"}
                </em>
              )}
            </div>
            <div className="ks">{o.s}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- түвшний рейл */
export function BenchRail() {
  const { m, t, lang, sel, toggleBench, setTip } = useStore();
  /* Зөвхөн тухайн сард ХӨДӨЛГӨӨНТЭЙ түвшин. Мэдээлэлгүй хаялбарыг бүдэг
     шошготой үлдээж үзсэн боловч жагсаалтын талыг эзэлж, утгатай мөрүүд
     доош түлхэгдэж байв. Багана нь баруун талын тэнхлэгээс ЗҮҮН тийш
     ургана. */
  const act = benchesOf(m);
  const tot = act.reduce((a2, e) => a2 + sumCol(m, C.NIIT, e), 0) || 1;
  const mx = Math.max(...act.map((e) => sumCol(m, C.NIIT, e)), 1);

  return (
    <div className="rail">
      {act.map((e) => {
        const kt = sumCol(m, C.NIIT, e);
        const cu = cuOf(m, e);
        const w = (kt / mx) * 100;
        /* Сонгогдсон мөр дээр ДАХИН дарахад шүүлт цуцлагдана — зөвлөмжийг
           tooltip-ийн доод мөрөнд шууд бичиж өгнө. */
        const on = sel?.kind === "bench" && sel.tuv === e;
        return (
          <button
            key={e}
            className="bench"
            aria-pressed={on}
            title={on ? t.filterOff : undefined}
            onClick={() => toggleBench(e)}
            onMouseEnter={(ev) =>
              setTip({
                x: ev.clientX, y: ev.clientY,
                title: `${t.dBench} ${e} м`, key: `${m} | ${e}`,
                hint: on ? t.filterAgain : undefined,
                rows: [
                  { label: COL_NAMES[lang][C.NIIT], value: `${fmt(kt, 0)} ${t.uKt}`, color: gradeColor(cu) },
                  { label: t.tCu, value: `${cu.toFixed(3)} %` },
                  { label: t.tMo, value: `${moOf(m, e).toFixed(4)} %` },
                  { label: t.tShare, value: `${((kt / tot) * 100).toFixed(1)} %` },
                ],
              })
            }
            onMouseMove={(ev) => setTip((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY } : prev))}
            onMouseLeave={() => setTip(null)}
          >
            <span className="bwrap">
              <i style={{ width: `${w.toFixed(1)}%`, ["--c" as any]: gradeColor(cu) }}>
                {w > 26 && <b>{fmt(kt, 0)}</b>}
              </i>
            </span>
            <span className="bl">{e}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   Түвшин бүрийн нөөц ба хүдэр — шугаман чарт.
   --------------------------------------------------------------------------
   «Уулын цул» цуврал ХАСАГДСАН: тэр нь мян.м³ бөгөөд бусад хоёр нь
   мян.тн — өөр нэгжийг нэг тэнхлэгт тавих нь буруу байв. Одоо хоёулаа
   мян.тн тул хэмжээгээр нь шууд харьцуулна.
   ========================================================================== */
const BSERIES: { ci: number; c: string; nm: [string, string]; u: "kt" | "m3" }[] = [
  /* Улаан — цуврал өнгө биш тогтмол утга, «Нийт хүдэр»-ээс тод ялгарна */
  { ci: C.NOOC, c: "#e0483a", nm: ["Олборлосон нөөц", "Mined reserve"], u: "kt" },
  { ci: C.NIIT, c: "var(--s1)", nm: ["Нийт хүдэр", "Total ore"], u: "kt" },
];

/* Catmull-Rom сплайныг куб Безье болгож, шулуун холбоосыг гөлгөр муруй
   болгоно. Хяналтын цэгийн Y-г хөрш ХОЁР цэгийн хооронд хязгаарлав:
   энгийн Catmull-Rom нь өгөгдөлд БАЙХГҮЙ оргил, хотгор үүсгэдэг — нөөцийн
   утга 0 хүртэл унасан газар муруй нь тэнхлэгээс доош гарч, байхгүй
   сөрөг утга харуулж мэдэх юм. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const clamp = (v: number, a: number, b: number) =>
    Math.max(Math.min(a, b), Math.min(Math.max(a, b), v));
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i], p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1]);
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1]);
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)}`
       + ` ${c2x.toFixed(2)},${c2y.toFixed(2)}`
       + ` ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

export function BenchLine() {
  const { m, t, lang, setTip } = useStore();
  const li = lang === "mn" ? 0 : 1;
  const act = ELEV.filter((e) => BSERIES.some((s2) => sumCol(m, s2.ci, e)));
  const W = 320, H = 104, PL = 30, PR = 6, PT = 8, PB = 14;
  if (act.length < 2) return <div className="empty">{t.noData}</div>;

  const vals = BSERIES.map((s2) => act.map((e) => sumCol(m, s2.ci, e)));
  const mx = Math.max(...vals.flat(), 1);
  const step = Math.pow(10, Math.floor(Math.log10(mx))) / 2;
  const top = Math.ceil(mx / step) * step;
  const x = (i: number) => PL + (i / (act.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - v / top) * (H - PT - PB);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);

  return (
    <div className="lchart">
      <div className="legend2">
        {BSERIES.map((s2, k) => (
          <span key={k}><i style={{ background: s2.c }} />{s2.nm[li]}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="lsvg">
        {ticks.map((v, k) => (
          <g key={k}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className="lgrid" />
            <text x={PL - 4} y={y(v) + 3} className="ltxt" textAnchor="end">{fmt(v, 0)}</text>
          </g>
        ))}
        {BSERIES.map((s2, k) => (
          <path key={k} fill="none" stroke={s2.c} strokeWidth={1.6}
                strokeLinecap="round" strokeLinejoin="round"
                d={smoothPath(act.map((e, i) => [x(i), y(vals[k][i])] as [number, number]))} />
        ))}
        {BSERIES.map((s2, k) => act.map((e, i) => (
          <circle key={`${k}-${e}`} cx={x(i)} cy={y(vals[k][i])} r={2} fill={s2.c} />
        )))}
        {act.map((e, i) => (
          <text key={e} x={x(i)} y={H - 4} className="ltxt" textAnchor="middle">
            {i % 2 === 0 ? e : ""}
          </text>
        ))}
        {act.map((e, i) => (
          <rect key={`h${e}`} x={x(i) - 8} y={0} width={16} height={H} fill="transparent"
                onMouseEnter={(ev) => setTip({
                  x: ev.clientX, y: ev.clientY, title: `${t.dBench} ${e} м`,
                  rows: BSERIES.map((s2, k) => ({
                    label: s2.nm[li],
                    value: `${fmt(vals[k][i], 0)} ${s2.u === "kt" ? t.uKt : t.uM3}`,
                    color: s2.c,
                  })),
                })}
                onMouseMove={(ev) => setTip((pv) => (pv ? { ...pv, x: ev.clientX, y: ev.clientY } : pv))}
                onMouseLeave={() => setTip(null)} />
        ))}
      </svg>
    </div>
  );
}

/* --------------------------------------------------- дэлгэрэнгүй карт */
export function DetailCard() {
  const { m, t, lang, sel, blk, setBlk } = useStore();
  /* Эвхэгдсэн бүлгүүд. Түлхүүр нь SECTIONS-ийн `key` — нэг төрөл хоёр
     бүлэгт хуваагдсан байж болох тул (Бохирдол: мян.тн ба %) хамт
     эвхэгдэнэ. Хук нь эрт `return`-үүдээс ӨМНӨ байх ёстой. */
  const [hid, setHid] = useState<Record<string, boolean>>({});
  const toggleSec = (k: string) => setHid((p) => ({ ...p, [k]: !p[k] }));
  const anyHid = Object.values(hid).some(Boolean);

  if (!sel) {
    return (
      <div className="pb">
        <div className="empty">{t.emptyMsg}</div>
      </div>
    );
  }

  if (sel.kind === "bench") {
    const blks = blocksAt(m, sel.tuv);
    const cur = blk && blks.includes(blk) ? blk : blks[0];
    const g = cur ? grp(m, sel.tuv, cur) : null;
    const rows = g
      ? Array.from({ length: 15 }, (_, i) => i).filter((i) => g.kt[i] || g.cu[i] || g.mo[i])
      : [];

    return (
      <div className="pb">
          <div className="blkchips">
            {blks.map((b) => (
              <button key={b} aria-pressed={b === cur} onClick={() => setBlk(b)}>
                {b === "БҮ" ? "БҮ" : "№" + b}
              </button>
            ))}
            {/* Эвхсэн бүлгийг сэргээх зам үргэлж нүдэн дээр байна */}
            {anyHid && (
              <button className="secall" onClick={() => setHid({})} title={t.secAll}>
                {t.secAll}
              </button>
            )}
          </div>
          <div className="dtable">
            {!rows.length || !g ? (
              <div className="empty">{t.noData}</div>
            ) : (
              /* БҮЛЭГЛЭСЭН. Урьд нь 15 багана нэг жагсаалтад орж, толгойд
                 «мян.тн» гэж бичээд мөр бүрийн ард «кт»/«м³» гэсэн ӨӨР нэгж
                 давхар наалддаг байсан тул м³-ийн мөрүүд мян.тн-ы багана
                 дор орж ойлгомжгүй болж байв. Одоо нэгж БҮЛГИЙН гарчигт
                 нэг л удаа бичигдэнэ. */
              <table>
                <tbody>
                  {(() => {
                    /* Утга бүхий бүлгүүд ба төрөл тус бүрийн мөрийн тоо.
                       Эвхэгдсэн үед нэг төрлийн ХОЁР бүлэг (Бохирдол ·
                       мян.тн ба Бохирдол · %) хоёр ижил гарчиг болж
                       давхарлахгүйн тулд эхнийхийг нь л үлдээж, нийт
                       мөрийн тоог хажууд нь бичнэ. */
                    const vis = SECTIONS
                      .map((sec) => ({ sec, has: sec.cols.filter((i) => rows.includes(i)) }))
                      .filter((o) => o.has.length);
                    const cnt: Record<string, number> = {};
                    vis.forEach((o) => { cnt[o.sec.key] = (cnt[o.sec.key] ?? 0) + o.has.length; });
                    const seen = new Set<string>();

                    return vis.map(({ sec, has }, si) => {
                      const off = !!hid[sec.key];
                      if (off) {
                        if (seen.has(sec.key)) return null;
                        seen.add(sec.key);
                      }
                      return (
                        <Fragment key={si}>
                          <tr className={"dsec" + (off ? " off" : "")}>
                            <th>
                              <button className="sech" aria-expanded={!off}
                                      onClick={() => toggleSec(sec.key)}
                                      title={off ? t.secShow : t.secHide}>
                                <span className="chev">{off ? "▸" : "▾"}</span>
                                {t[sec.key]}
                                {off && <em>{cnt[sec.key]}</em>}
                              </button>
                            </th>
                            <th className="mono">
                              {off ? "" : sec.unit === "pct" ? t.uPct : sec.unit === "m3" ? t.uM3 : t.uKt}
                            </th>
                            <th className="mono">{off ? "" : t.thCu}</th>
                            <th className="mono">{off ? "" : t.thMo}</th>
                          </tr>
                          {!off && has.map((i) => (
                            <tr key={i}>
                              <td>{COL_NAMES[lang][i]}</td>
                              <td className="mono">{fmt(g.kt[i], sec.unit === "pct" ? 2 : 1)}</td>
                              <td className={"mono" + (g.cu[i] ? "" : " zero")}>
                                {g.cu[i] ? g.cu[i].toFixed(3) : "—"}</td>
                              <td className={"mono" + (g.mo[i] ? "" : " zero")}>
                                {g.mo[i] ? g.mo[i].toFixed(4) : "—"}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            )}
        </div>
      </div>
    );
  }

  /* хүлээн авагч сонгосон */
  const ci = sel.ci;
  const isM3 = ci === C.HOOSON || ci === C.TSUL;
  const rows = ELEV.map((e) => [e, sumCol(m, ci, e), metalSum(m, "cu", ci, e), metalSum(m, "mo", ci, e)] as const)
    .filter((r) => r[1] > 0);
  const tot = rows.reduce((a, r) => a + r[1], 0);

  return (
    <div className="pb">
        <div className="dtable">
          {!rows.length ? (
            <div className="empty">{t.noData}</div>
          ) : (
            <table>
              <thead>
                <tr><th>{t.thLvl}</th><th>{isM3 ? t.uM3 : t.thKt}</th><th>{t.thCu}</th><th>{t.thMo}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r[0]}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{r[0]} м</td>
                    <td className="mono">{fmt(r[1], 1)}</td>
                    <td className={"mono" + (r[2] ? "" : " zero")}>{r[2] ? r[2].toFixed(3) : "—"}</td>
                    <td className={"mono" + (r[3] ? "" : " zero")}>{r[3] ? r[3].toFixed(4) : "—"}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td>{t.thTot}</td><td className="mono">{fmt(tot, 1)}</td><td /><td />
                </tr>
              </tbody>
            </table>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------ сарын шилжилт (зүүн багана)
   Өмнө нь доод талд 880 px өргөн SVG байсан. Зүүн баганад (252 px) багтахын
   тулд сар бүрийг ХЭВТЭЭ мөр болгосон — дээрх түвшний рейлтэй ижил хэмнэл:
   шошго · багана · тоо. Уншихад ч, харьцуулахад ч илүү тод. */
/** Дэлгэрэнгүй картын бүлгүүд — нэгж нь бүлэг тутамд НЭГ удаа бичигдэнэ */
const SECTIONS: { key: "secOre" | "secDil" | "secDest" | "secWaste" | "secRock";
                  unit: "kt" | "pct" | "m3"; cols: number[] }[] = [
  { key: "secOre",   unit: "kt",  cols: [C.NOOC, C.BU_U, C.AGU] },
  { key: "secDil",   unit: "kt",  cols: [C.BOH] },
  { key: "secDil",   unit: "pct", cols: [C.HAY, C.BOHP] },
  { key: "secDest",  unit: "kt",  cols: [C.BU, C.OV12, C.OV14, C.OV8A, C.NIIT] },
  { key: "secWaste", unit: "kt",  cols: [C.OV9A, C.OV9B] },
  { key: "secWaste", unit: "m3",  cols: [C.HOOSON] },
  { key: "secRock",  unit: "m3",  cols: [C.TSUL] },
];

/* ==========================================================================
   Чиглэл тус бүрийн хуваарилалт — сонгосон сард уулын цул ХААШАА, ХЭДИЙ
   хэмжээгээр явсныг задална. I–VI сарын чарт нь гурван бүлгийн ДҮНГ
   харуулдаг бол энэ нь хүлээн авагч бүрээр задална.
   Өнгө нь газрын зураг дээрх машины өнгөтэй ИЖИЛ (TRUCK_COLOR).
   ========================================================================== */
const DEST_ROWS: { ci: number; nm: [string, string]; c: string }[] = [
  { ci: C.BU,     nm: ["Баяжуулах үйлдвэр", "Concentrator"],    c: TRUCK_COLOR.bu },
  { ci: C.OV12,   nm: ["Овоолго 12", "Stockpile 12"],           c: TRUCK_COLOR.ore },
  { ci: C.OV14,   nm: ["Овоолго 14", "Stockpile 14"],           c: TRUCK_COLOR.ore },
  { ci: C.OV8A,   nm: ["Овоолго 8а", "Stockpile 8a"],           c: TRUCK_COLOR.ore },
  { ci: C.OV9A,   nm: ["Овоолго 9а · 8 · 9", "Piles 9a, 8, 9"], c: TRUCK_COLOR.waste },
  { ci: C.OV9B,   nm: ["Овоолго 9б", "Pile 9b"],                c: TRUCK_COLOR.waste },
  { ci: C.HOOSON, nm: ["Овоолго №1, 4, 11", "Piles 1, 4, 11"],  c: TRUCK_COLOR.waste },
];

/* --------------------------------------------------------------------------
   ИДЭВХТЭЙ ШҮҮЛТИЙН МӨР — ArcGIS Dashboard-ийн «selection banner» загвараар.
   Өмнө нь зөвхөн ТҮВШНИЙ шүүлтийг харуулдаг байсан тул газрын зургаас
   сонгосон феатурыг цуцлах нэг ч товч байхгүй, зөвхөн Esc товчоор
   (мэдэхгүй бол огт) арилдаг байв. Одоо идэвхтэй шүүлт БҮР өөрийн ✕-тэй
   чип болж гарах бөгөөд хажууд нь «бүгдийг цэвэрлэх» товч байна.
   -------------------------------------------------------------------------- */
export function FilterBar() {
  const { sel, t, toggleBench, setSel, clearAll, hasFilter } = useStore();

  const chips: { id: string; k: string; v: string; clear: () => void }[] = [];
  if (sel?.kind === "bench")
    chips.push({ id: "bench", k: t.filterOn, v: `${t.dBench} ${sel.tuv} м`,
                 clear: () => toggleBench(sel.tuv) });
  if (sel?.kind === "dest")
    chips.push({ id: "dest", k: t.filterFeat, v: sel.title,
                 clear: () => setSel(null) });

  if (!hasFilter || !chips.length) return null;

  return (
    <div className="fbar" role="group" aria-label={t.filterOn} title={t.filterHint}>
      {chips.map((c) => (
        <span className="fchip" key={c.id}>
          <span className="fk">{c.k}</span>
          <b>{c.v}</b>
          <button className="fcx" onClick={c.clear}
                  title={t.filterOff} aria-label={`${t.filterOff} — ${c.v}`}>✕</button>
        </span>
      ))}
      <span className="fsp" />
      <kbd className="fkbd">Esc</kbd>
      <button className="fx" onClick={clearAll} title={t.filterHint}>{t.filterAll}</button>
    </div>
  );
}

export function DestChart() {
  const { m, t, lang, sel, setTip } = useStore();
  const tuv = useTuv();
  const li = lang === "mn" ? 0 : 1;
  const rows = DEST_ROWS.map((d) => ({ ...d, v: sumCol(m, d.ci, tuv) }));
  const tot = rows.reduce((a, r) => a + r.v, 0) || 1;
  const mx = Math.max(...rows.map((r) => r.v), 1);

  return (
    <div className="dchart">
      {rows.map((r) => (
        /* Газрын зургаас сонгосон хүлээн авагч энд тодрох — сонголт хаана
           тавигдсаныг чарт дээрээс шууд уншина. */
        <div className={"drow2" + (sel?.kind === "dest" && sel.ci === r.ci ? " on" : "")}
             key={r.ci}
             onMouseEnter={(ev) => setTip({
               x: ev.clientX, y: ev.clientY, title: r.nm[li],
               rows: [
                 { label: t.thTot, value: `${fmt(r.v, 0)} ${t.uKt}`, color: r.c },
                 { label: t.uPct, value: `${((r.v / tot) * 100).toFixed(1)} %` },
               ],
             })}
             onMouseMove={(ev) => setTip((p) => (p ? { ...p, x: ev.clientX, y: ev.clientY } : p))}
             onMouseLeave={() => setTip(null)}>
          <span className="dlab2">{r.nm[li]}</span>
          <span className="dbar">
            <i style={{ width: `${(r.v / mx) * 100}%`, ["--c" as any]: r.c }} />
          </span>
          <span className="dval">{r.v ? fmt(r.v, 0) : "—"}</span>
          <span className="dpct">{r.v ? `${((r.v / tot) * 100).toFixed(0)} %` : ""}</span>
        </div>
      ))}
      <div className="drow2 tot">
        <span className="dlab2">{t.thTot}</span>
        <span />
        <span className="dval">{fmt(tot, 0)}</span>
        <span className="dpct">{t.uKt}</span>
      </div>
    </div>
  );
}

export function Timeline() {
  const { m, setM, t, lang, setTip } = useStore();
  const cols = ["var(--s1)", "var(--s2)", "var(--s3)"];
  const names = [t.sBu, t.sOv, t.sOv2];
  const tuv = useTuv();
  const data = [1, 2, 3, 4, 5, 6].map((mm) => monthlyFlow(mm, tuv));
  const totals = data.map((d) => d[0] + d[1] + d[2]);

  /* ХЭМЖҮҮР: өмнө нь баганын урт хамгийн их сарын харьцаагаар тооцогдож
     байсан. Зургаан сарын дүн 4 898–5 488 буюу 11 %-ийн дотор багтдаг тул
     бүх багана бараг ижил урттай гарч, харьцуулах утгагүй болдог байв.
     Одоо 0-ээс эхэлсэн ТОГТМОЛ шатлалт хэмжүүр дээр зурж, хажууд нь
     хуваарийн зураас тавьснаар зөрүү нь хаанаас гарч байгаа нь уншигдана. */
  const STEP = 2000;
  const axMax = Math.ceil(Math.max(...totals, 1) / STEP) * STEP;
  const ticks = Array.from({ length: axMax / STEP + 1 }, (_, k) => k * STEP);

  const cur = data[m - 1];
  const curTot = totals[m - 1] || 1;

  return (
    <>
      {/* хуваарь */}
      <div className="tlax">
        <span className="ml" />
        <span className="tlticks">
          {ticks.map((v, k) => (
            <b key={v} style={{ left: `${(v / axMax) * 100}%` }}
               className={k === 0 ? "first" : k === ticks.length - 1 ? "last" : ""}>
              {/* `fmt` нь 0-ийг «—» болгодог тул тэгийг шууд бичнэ */}
              {v === 0 ? "0" : fmt(v, 0)}
            </b>
          ))}
        </span>
        <span className="tlu">{t.uKt}</span>
      </div>

      <div className="mrows">
        {data.map((d, i) => {
          const sel = i + 1 === m;
          const tot = totals[i];
          return (
            <button key={i} className="mrow" aria-pressed={sel}
                    onClick={() => setM(i + 1)}
                    onMouseEnter={(ev) => setTip({
                      x: ev.clientX, y: ev.clientY, title: MON_L[lang][i],
                      rows: [
                        ...names.map((n, k) => ({
                          label: n,
                          value: `${fmt(d[k], 0)} ${t.uKt}  ·  ${((d[k] / (tot || 1)) * 100).toFixed(0)} %`,
                          color: cols[k],
                        })),
                        { label: t.thTot, value: `${fmt(tot, 0)} ${t.uKt}` },
                      ],
                    })}
                    onMouseMove={(ev) => setTip((p) => (p ? { ...p, x: ev.clientX, y: ev.clientY } : p))}
                    onMouseLeave={() => setTip(null)}>
              <span className="ml">{ROMAN[i]}</span>
              <span className="mtrack">
                <span className="mbar" style={{ width: `${((tot / axMax) * 100).toFixed(2)}%` }}>
                  {d.map((v, k) => (
                    /* Тэг утгыг ОГТ зурахгүй: тойрогтой болсон тул тэг ч
                       гэсэн 2 px-ийн хүрээ болж харагдаж мэдэх юм. */
                    v > 0 ? <i key={k} style={{ flex: `${v} 0 0`, ["--c" as any]: cols[k] }} /> : null
                  ))}
                </span>
              </span>
              <span className="mv">{fmt(tot, 0)}</span>
            </button>
          );
        })}
      </div>

      {/* Тайлбар нь зөвхөн өнгө нэрлэхээс гадна СОНГОСОН сарын тоо, эзлэх
          хувийг шууд харуулна — өмнө нь тоог зөвхөн хулганаар дүүжлэхэд
          л мэдэх боломжтой байсан. */}
      <div className="tlbd">
        <div className="tlbh">{MON_L[lang][m - 1]} · {t.tlBreak}</div>
        {names.map((n, k) => (
          <div className="tlb" key={n}>
            <i style={{ ["--c" as any]: cols[k] }} />
            <span className="tlbn">{n}</span>
            <span className="tlbv">{cur[k] > 0 ? fmt(cur[k], 0) : "—"}</span>
            <span className="tlbp">{cur[k] > 0 ? `${((cur[k] / curTot) * 100).toFixed(0)} %` : ""}</span>
          </div>
        ))}
        <div className="tlb tot">
          <i className="none" />
          <span className="tlbn">{t.thTot}</span>
          <span className="tlbv">{fmt(curTot, 0)}</span>
          <span className="tlbp">{t.uKt}</span>
        </div>
      </div>
    </>
  );
}

/* ==========================================================================
   Хоёр цуврал зэрэгцүүлсэн багана
   --------------------------------------------------------------------------
   Cu (0.4 %) ба Mo (0.01 %) хоёр 40 дахин ялгаатай тул НЭГ тэнхлэгт
   тавьж болохгүй — Mo огт харагдахгүй болно. Тиймээс цуврал тус бүр
   өөрийн масштабтай, зэрэгцээ хоёр багана болгон зурав. Утга бүр нь
   тоогоороо бичигдсэн тул харьцуулалт эндүүрэхгүй.
   ========================================================================== */
/* ==========================================================================
   Хоёр үзүүлэлтийг САРААР харуулах ТАЛБАЙН чарт.
   --------------------------------------------------------------------------
   Хос хэвтээ багана байсныг сольсон: сар хоорондын өөрчлөлт баганаар
   харьцуулагдахгүй байв.

   Хоёр цувралыг НЭГ тэнхлэгт тавихгүй — Cu 0.41 %, Mo 0.014 % шиг хэмжээ
   нь 30 дахин зөрөх тул нэг нь шугам болж хавтгайрна. Тус бүр нь ӨӨРИЙН
   гэсэн жижиг чартатай.

   Тэнхлэг нь 0-ээс биш, цувралын доод утгаас эхэлнэ (Cu 0.410–0.422 гэх
   мэт бага хэлбэлзлийг 0-ээс зурвал шулуун шугам болно). Тасалсныг
   мэдэгдэхийн тулд дээд, доод утгыг ЗААВАЛ бичнэ. */
function AreaPair({
  rows, aLabel, bLabel, aDec, bDec, aColor, bColor, aUnit, bUnit,
}: {
  rows: { key: string; a: number; b: number }[];
  aLabel: string; bLabel: string;
  aDec: number; bDec: number;
  aColor: string; bColor: string;
  aUnit: string; bUnit: string;
}) {
  const { setTip, lang } = useStore();
  const one = (pick: "a" | "b", label: string, color: string, dec: number, unit: string) => {
    const v = rows.map((r) => r[pick]);
    const lo = Math.min(...v), hi = Math.max(...v);
    const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.08 || 1;
    const y0 = lo - pad, y1 = hi + pad;
    const W = 150, H = 54, PB = 10, PT = 8;
    const x = (i: number) => (i / (rows.length - 1)) * W;
    const y = (t2: number) => PT + (1 - (t2 - y0) / (y1 - y0)) * (H - PT - PB);
    /* Гөлгөр муруй — түвшний чарттай ижил `smoothPath`. Талбай нь мөн
       ТЭР МУРУЙГ дагана: шугам гөлгөр, дүүргэлт нь өнцөгтэй үлдвэл хоёр
       нь салж, доод захаараа цагаан зай үүсгэнэ. */
    const pts = rows.map((r, i) => [x(i), y(v[i])] as [number, number]);
    const line = smoothPath(pts);
    const area = `${line} L${W},${H - PB} L0,${H - PB} Z`;
    return (
      <div className="acell">
        <div className="ahead" style={{ color }}>{label}</div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="asvg">
          <path d={area} fill={color} opacity={0.18} />
          <path d={line} fill="none" stroke={color} strokeWidth={1.6}
                strokeLinecap="round" strokeLinejoin="round" />
          {rows.map((r, i) => <circle key={r.key} cx={x(i)} cy={y(v[i])} r={1.8} fill={color} />)}
          {rows.map((r, i) => (
            <rect key={"h" + r.key} x={x(i) - W / (rows.length * 2)} y={0}
                  width={W / rows.length} height={H} fill="transparent"
                  onMouseEnter={(ev) => setTip({
                    x: ev.clientX, y: ev.clientY,
                    title: MON_L[lang][i],
                    rows: [{ label, value: `${v[i].toFixed(dec)} ${unit}`, color }],
                  })}
                  onMouseMove={(ev) => setTip((pv) => (pv ? { ...pv, x: ev.clientX, y: ev.clientY } : pv))}
                  onMouseLeave={() => setTip(null)} />
          ))}
        </svg>
        {/* Тасалсан тэнхлэгийг мэдэгдэхийн тулд доод/дээд утгыг бичнэ */}
        <div className="arange"><span>{lo.toFixed(dec)}</span><span>{hi.toFixed(dec)}</span></div>
        {/* Сарын шошго нь чарт ТУС БҮРИЙН дотор. Хоёрын доор нэг мөр
            байрлуулбал I–III нь зүүн чартын, IV–VI нь баруунгийн доор
            орж, буруу уншигдана. */}
        <div className="axlab">{rows.map((r) => <span key={r.key}>{r.key}</span>)}</div>
      </div>
    );
  };
  return (
    <div className="achart">
      <div className="acells">
        {one("a", aLabel, aColor, aDec, aUnit)}
        {one("b", bLabel, bColor, bDec, bUnit)}
      </div>
    </div>
  );
}

/** Агуулга, % — Cu ба Mo, сар тус бүрээр */
export function GradeChart() {
  const tuv = useTuv();
  const rows = [1, 2, 3, 4, 5, 6].map((mm) => ({
    key: ROMAN[mm - 1], a: cuOf(mm, tuv), b: moOf(mm, tuv),
  }));
  return <AreaPair rows={rows} aLabel="Cu %" bLabel="Mo %" aUnit="%" bUnit="%"
                   aDec={3} bDec={4} aColor="var(--g5)" bColor="var(--s3)" />;
}

/** Металл, тонн — Cu ба Mo, сар тус бүрээр */
export function MetalChart() {
  const tuv = useTuv();
  const rows = [1, 2, 3, 4, 5, 6].map((mm) => ({
    key: ROMAN[mm - 1],
    a: metalSum(mm, "cut", C.NIIT, tuv),
    b: metalSum(mm, "mot", C.NIIT, tuv),
  }));
  return <AreaPair rows={rows} aLabel="Cu т" bLabel="Mo т" aUnit="т" bUnit="т"
                   aDec={0} bDec={0} aColor="var(--g5)" bColor="var(--s3)" />;
}

/* ------------------------------------------------------------ tooltip */
export function Tooltip() {
  const { tip } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useEffect(() => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let x = tip.x + 14, y = tip.y + 14;
    if (x + r.width > window.innerWidth - 8) x = tip.x - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = tip.y - r.height - 14;
    setPos({ left: x, top: y });
  }, [tip]);

  return (
    <div id="tip" ref={ref} role="status" aria-live="polite"
         style={{ opacity: tip ? 1 : 0, left: pos.left, top: pos.top }}>
      {tip && (
        <>
          <span className="tt">{tip.title}</span>
          {tip.key && <span className="tk">{tip.key}</span>}
          {tip.rows.map((r, i) => (
            <div className="row" key={i}>
              <span>
                {r.color && <i style={{ background: r.color }} />}
                {r.label}
              </span>
              <b>{r.value}</b>
            </div>
          ))}
          {tip.hint && <span className="hintline">{tip.hint}</span>}
        </>
      )}
    </div>
  );
}
