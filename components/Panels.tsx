"use client";

import { useStore } from "@/lib/store";
import { C, COL_NAMES, COL_UNITS, ELEV, BLK2PILE } from "@/lib/config";
import { benchesOf, blocksAt, cuOf, grp, metalSum, moOf, monthlyFlow, sumCol } from "@/lib/excel";
import { fmt, gradeColor } from "@/lib/format";
import { MON_L, ROMAN } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ KPI */
export function Kpis() {
  const { m, t } = useStore();
  const p = m > 1 ? m - 1 : null;
  const defs = [
    { k: t.kOre,  v: sumCol(m, C.NIIT), u: t.uKt,  prev: p ? sumCol(p, C.NIIT) : null },
    { k: t.kBu,   v: sumCol(m, C.BU),   u: t.uKt,  prev: p ? sumCol(p, C.BU) : null },
    { k: t.kCu,   v: cuOf(m),           u: t.uPct, prev: p ? cuOf(p) : null, dec: 3 },
    { k: t.kRock, v: sumCol(m, C.TSUL), u: t.uM3,  prev: p ? sumCol(p, C.TSUL) : null },
  ];
  return (
    <div className="kpis">
      {defs.map((o) => {
        const pc = o.prev ? ((o.v - o.prev) / o.prev) * 100 : null;
        return (
          <div className="kpi" key={o.k}>
            <div className="k">{o.k}</div>
            <div className="v">
              <b>{o.dec ? o.v.toFixed(o.dec) : fmt(o.v, 0)}</b>
              <i>{o.u}</i>
            </div>
            {pc === null ? (
              <div className="d na">{t.noPrev}</div>
            ) : (
              <div className={"d " + (pc >= 0 ? "up" : "dn")}>
                {(pc >= 0 ? "▲ " : "▼ ") + Math.abs(pc).toFixed(1) + "%"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- түвшний рейл */
export function BenchRail() {
  const { m, t, lang, sel, setSel, setBlk, setTip } = useStore();
  /* Зөвхөн тухайн сард ХӨДӨЛГӨӨНТЭЙ түвшин. Өмнө нь бүх 20 хаялбарыг
     жагсааж, мэдээлэлгүй нь «—» болж хоосон зай эзэлж байсан. */
  const act = benchesOf(m);
  const mx = Math.max(...act.map((e) => sumCol(m, C.NIIT, e)), 1);

  return (
    <div className="rail">
      {act.map((e) => {
        const kt = sumCol(m, C.NIIT, e);
        const cu = cuOf(m, e);
        return (
          <button
            key={e}
            className="bench"
            aria-pressed={sel?.kind === "bench" && sel.tuv === e}
            onClick={() => { setSel({ kind: "bench", tuv: e }); setBlk(null); }}
            onMouseEnter={(ev) =>
              setTip({
                x: ev.clientX, y: ev.clientY,
                title: `${e} м · ${t.dBench}`, key: `${m} | ${e}`,
                rows: [
                  { label: COL_NAMES[lang][C.NIIT], value: `${fmt(kt, 1)} ${t.uKt}`, color: gradeColor(cu) },
                  { label: "Cu", value: `${cu.toFixed(3)} %` },
                  { label: "Mo", value: `${moOf(m, e).toFixed(4)} %` },
                  { label: COL_NAMES[lang][C.TSUL], value: `${fmt(sumCol(m, C.TSUL, e), 0)} ${t.uM3}` },
                ],
              })
            }
            onMouseMove={(ev) => setTip((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY } : prev))}
            onMouseLeave={() => setTip(null)}
          >
            <span className="bl">{e}</span>
            <span className="bbar">
              {/* Өнгийг `--c` хувьсагчаар дамжуулна: дүүргэлт нь тунгалаг,
                  тойрог нь мөн өнгөөрөө — CSS дээр нэг дор шийдэгдэнэ. */}
              <i style={{ width: `${((kt / mx) * 100).toFixed(1)}%`,
                          ["--c" as any]: gradeColor(cu) }} />
            </span>
            <span className="bv">{fmt(kt, 0)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------- дэлгэрэнгүй карт */
export function DetailCard() {
  const { m, t, lang, sel, blk, setBlk } = useStore();

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
          <div className="joinbar">
            <span className="jk">{`Сар ${m}`}</span>
            <span className="jk hi">{`Түвшин ${sel.tuv}`}</span>
            {cur && <span className="jk hi">{`Блок ${cur}`}</span>}
            <span className="jarrow">→</span>
            <span className="jk">{cur === "БҮ" ? t.bu : BLK2PILE[cur ?? ""] ?? "—"}</span>
          </div>
          <div className="blkchips">
            {blks.map((b) => (
              <button key={b} aria-pressed={b === cur} onClick={() => setBlk(b)}>
                {b === "БҮ" ? "БҮ" : "№" + b}
              </button>
            ))}
          </div>
          <div className="dtable">
            {!rows.length || !g ? (
              <div className="empty">{t.noData}</div>
            ) : (
              <table>
                <thead>
                  <tr><th>{t.thCol}</th><th>{t.thKt}</th><th>{t.thCu}</th><th>{t.thMo}</th></tr>
                </thead>
                <tbody>
                  {rows.map((i) => {
                    const isPct = i === C.HAY || i === C.BOHP;
                    return (
                      <tr key={i}>
                        <td>
                          {COL_NAMES[lang][i]}
                          {!isPct && <span className="zero"> {COL_UNITS[lang][i]}</span>}
                        </td>
                        <td className="mono">{fmt(g.kt[i], isPct ? 2 : 1)}</td>
                        <td className={"mono" + (g.cu[i] ? "" : " zero")}>{g.cu[i] ? g.cu[i].toFixed(3) : "—"}</td>
                        <td className={"mono" + (g.mo[i] ? "" : " zero")}>{g.mo[i] ? g.mo[i].toFixed(4) : "—"}</td>
                      </tr>
                    );
                  })}
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
        <div className="joinbar">
          <span className="jk">{`Сар ${m}`}</span>
          <span className="jk">{lang === "mn" ? "Багана" : "Column"}</span>
          <span className="jk hi">{COL_NAMES[lang][ci].split("—").pop()?.trim()}</span>
          <span className="jarrow">→</span>
          <span className="jk">{sel.featName}</span>
        </div>
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
export function Timeline() {
  const { m, setM, t, lang, setTip } = useStore();
  const cols = ["var(--s1)", "var(--s2)", "var(--s3)"];
  const names = [t.sBu, t.sOv, t.sOv2];
  const data = [1, 2, 3, 4, 5, 6].map((mm) => monthlyFlow(mm));
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
function DualBars({
  rows, aLabel, bLabel, aDec, bDec, aColor, bColor,
}: {
  rows: { key: string; a: number; b: number }[];
  aLabel: string; bLabel: string;
  aDec: number; bDec: number;
  aColor: string; bColor: string;
}) {
  const aMax = Math.max(...rows.map((r) => r.a), 1e-9);
  const bMax = Math.max(...rows.map((r) => r.b), 1e-9);
  return (
    <div className="dchart">
      <div className="dhead">
        <span className="dsp" />
        <span style={{ color: aColor }}>{aLabel}</span>
        <span style={{ color: bColor }}>{bLabel}</span>
      </div>
      {rows.map((r) => (
        <div className="drow" key={r.key}>
          <span className="dlab">{r.key}</span>
          <span className="dcell">
            <span className="dbar"><i style={{ width: `${(r.a / aMax) * 100}%`, ["--c" as any]: aColor }} /></span>
            <span className="dval">{r.a ? r.a.toFixed(aDec) : "—"}</span>
          </span>
          <span className="dcell">
            <span className="dbar"><i style={{ width: `${(r.b / bMax) * 100}%`, ["--c" as any]: bColor }} /></span>
            <span className="dval">{r.b ? r.b.toFixed(bDec) : "—"}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Агуулга, % — Cu ба Mo, сар тус бүрээр */
export function GradeChart() {
  const rows = [1, 2, 3, 4, 5, 6].map((mm) => ({
    key: ROMAN[mm - 1], a: cuOf(mm), b: moOf(mm),
  }));
  return <DualBars rows={rows} aLabel="Cu %" bLabel="Mo %"
                   aDec={3} bDec={4} aColor="var(--g5)" bColor="var(--s3)" />;
}

/** Металл, тонн — Cu ба Mo, сар тус бүрээр */
export function MetalChart() {
  const rows = [1, 2, 3, 4, 5, 6].map((mm) => ({
    key: ROMAN[mm - 1],
    a: metalSum(mm, "cut", C.NIIT),
    b: metalSum(mm, "mot", C.NIIT),
  }));
  return <DualBars rows={rows} aLabel="Cu т" bLabel="Mo т"
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
