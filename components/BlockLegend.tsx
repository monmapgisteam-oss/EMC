"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/format";
import { MON_L, ROMAN, T, type Lang } from "@/lib/i18n";
import { BLOCK_TEXT, SLAB_CELLS, sliceValue, type BlockModelMeta, type BlockSlice, type SliceMode } from "@/lib/blockModel";

export interface BlockLegendProps {
  meta: BlockModelMeta;
  /** Харуулж буй блокийн хугацаа (сарын дугаар — «II → III» бол 3) */
  period: number;
  /** Хэрэглэгч хугацааг толгойн сараас тусад нь тогтоосон эсэх */
  pinned: boolean;
  /** Толгойн сонгосон сар */
  month: number;
  lang: Lang;
  onPeriod: (period: number) => void;
  onFollow: () => void;
  slice: BlockSlice;
  onSlice: (slice: BlockSlice) => void;
}

const value = (number: number, decimals = 0) => number === 0 ? "0" : fmt(number, decimals);
const span = (from: number, to: number, sep = " → ") => `${ROMAN[from - 1] ?? from}${sep}${ROMAN[to - 1] ?? to}`;

export default function BlockLegend({
  meta, period, pinned, month, lang, onPeriod, onFollow, slice, onSlice,
}: BlockLegendProps) {
  const t = T[lang];
  const tx = BLOCK_TEXT[lang];
  const isMn = lang === "mn";
  const monthData = meta.months[String(period)] ?? null;
  const classes = meta.classes;
  const periods = Object.keys(meta.months).map(Number).sort((a, b) => a - b);
  const badge = monthData ? span(monthData.from, monthData.to) : ROMAN[period - 1] ?? String(period);
  const badgeTitle = monthData
    ? `${MON_L[lang][monthData.from - 1]} → ${MON_L[lang][monthData.to - 1]}`
    : MON_L[lang][period - 1];

  /* Картыг нууж/гаргана — зөвхөн толгой үлдэнэ. Сонголт хөтөчид хадгалагдана. */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem("emc-block-legend") === "collapsed"); } catch { /* хадгалалтгүй */ }
  }, []);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem("emc-block-legend", c ? "open" : "collapsed"); } catch { /* хадгалалтгүй */ }
    return !c;
  });
  const toggleLabel = collapsed ? (isMn ? "Дэлгэх" : "Expand") : (isMn ? "Нуух" : "Collapse");

  const modes: { m: SliceMode; n: string }[] = [
    { m: "off", n: isMn ? "Үгүй" : "Off" },
    { m: "z", n: isMn ? "Хэвтээ" : "Plan" },
    { m: "i", n: isMn ? "Дагуу" : "Long" },
    { m: "j", n: isMn ? "Хөндлөн" : "Cross" },
  ];
  const axis = slice.mode === "i" ? 0 : slice.mode === "j" ? 1 : 2;
  const steps = monthData ? monthData.dims[axis] : 1;
  const sv = monthData && slice.mode !== "off" ? sliceValue(monthData, meta, slice) : 0;
  /* Нэг үе сонгосон бол мужаар нь (RL 1243–1258 м), эс бол зүсэлтийн түвшин */
  const svLo = sv - SLAB_CELLS * meta.cell[axis];
  const svText = slice.slab ? `${fmt(svLo, 0)}–${fmt(sv, 0)}` : fmt(sv, 0);
  const sliceLabel = slice.mode === "z" ? `RL ${svText} м` : `${svText} м`;

  return (
    <aside className={`block-legend${monthData ? "" : " block-legend--empty"}${collapsed ? " block-legend--collapsed" : ""}`}
           aria-label={`${t.blkTitle} · ${badgeTitle}`}>
      <header className="block-legend__header">
        <div><span className="block-legend__eyebrow">{isMn ? "БЛОК МОДЕЛЬ" : "BLOCK MODEL"}</span><h3>{t.blkTitle}</h3></div>
        <span className="block-legend__period" title={badgeTitle} aria-label={badgeTitle}>{badge}</span>
        <button type="button" className="block-legend__toggle" onClick={toggle}
                aria-expanded={!collapsed} aria-controls="block-legend-body"
                title={toggleLabel} aria-label={toggleLabel}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={collapsed ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
          </svg>
        </button>
      </header>

      <div id="block-legend-body" className="block-legend__body" hidden={collapsed}>
        {/* Хугацаа — толгойн сараас хамааралгүйгээр өөр сарын блокийг харна */}
        <div className="block-legend__label">
          <span>{isMn ? "Хугацаа" : "Period"}</span>
          {pinned && (
            <button type="button" className="block-legend__link" onClick={onFollow}>
              {isMn ? `${ROMAN[month - 1]} сартай холбох` : `Follow month ${ROMAN[month - 1]}`}
            </button>
          )}
        </div>
        <div className="block-legend__periods" role="group" aria-label={isMn ? "Хугацаа" : "Period"}>
          {periods.map((p) => {
            const d = meta.months[String(p)];
            return (
              <button key={p} type="button" aria-pressed={p === period}
                      className={p === month ? "is-month" : undefined}
                      title={`${MON_L[lang][d.from - 1]} → ${MON_L[lang][d.to - 1]}`}
                      onClick={() => onPeriod(p)}>
                {span(d.from, d.to, "→")}
              </button>
            );
          })}
        </div>

        {monthData ? (
          <>
            <dl className="block-legend__metrics">
              <div><dt>{isMn ? "Нийт масс" : "Total mass"}</dt><dd>{value(monthData.kt, 1)}<small>{t.blkKt}</small></dd></div>
              <div><dt>{isMn ? "Дундаж Cu" : "Average Cu"}</dt><dd>{monthData.cu.toFixed(3)}<small>%</small></dd></div>
            </dl>

            <div className="block-legend__columns"><span>{isMn ? "Cu агуулга, %" : "Cu grade, %"}</span><span>{isMn ? "Массын хувь" : "Mass share"}</span></div>
            <ul className="block-legend__classes">
              {classes.map((item, index) => {
                const upper = classes[index + 1]?.min;
                const range = index === 0 && upper !== undefined
                  ? `< ${upper.toFixed(2)}`
                  : upper === undefined ? `≥ ${item.min.toFixed(2)}` : `${item.min.toFixed(2)}–${upper.toFixed(2)}`;
                const share = Number.isFinite(monthData.share[index]) ? monthData.share[index] : null;
                const percentage = share === null ? "—" : `${(share * 100).toFixed(1)}%`;
                return (
                  <li className="block-legend__class" key={`${item.min}-${index}`}
                    aria-label={`${tx.classes[index]} · ${range} Cu%: ${percentage}`}>
                    <span className="block-legend__swatch" style={{ background: item.color }} aria-hidden="true" />
                    <span className="block-legend__range">{range}<small>{tx.classes[index]}</small></span>
                    <span className="block-legend__track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, (share ?? 0) * 100))}%`, background: item.color }} /></span>
                    <span className="block-legend__share">{percentage}</span>
                  </li>
                );
              })}
            </ul>

            {/* Зүсэлт — зүссэн нүүр нь доторх блокуудын өнгөөр харагдана */}
            <div className="block-legend__label block-legend__label--slice">
              <span>{isMn ? "Зүсэлт" : "Slice"}</span>
              {slice.mode !== "off" && <b>{sliceLabel}</b>}
            </div>
            <div className="block-legend__seg" role="group" aria-label={isMn ? "Зүсэлт" : "Slice"}>
              {modes.map(({ m, n }) => (
                <button key={m} type="button" aria-pressed={slice.mode === m}
                        onClick={() => onSlice({ ...slice, mode: m, pos: slice.mode === "off" ? 0.6 : slice.pos })}>
                  {n}
                </button>
              ))}
            </div>
            {slice.mode !== "off" && (
              <div className="block-legend__slice">
                <input type="range" min={0} max={1} step={1 / Math.max(steps, 1)} value={slice.pos}
                       aria-label={sliceLabel}
                       onChange={(e) => onSlice({ ...slice, pos: Number(e.target.value) })} />
                <label>
                  <input type="checkbox" checked={slice.slab}
                         onChange={(e) => onSlice({ ...slice, slab: e.target.checked })} />
                  {slice.mode === "z"
                    ? (isMn ? "Зөвхөн нэг шат (15 м)" : "Single bench (15 m)")
                    : (isMn ? "Зөвхөн нэг огтлол (20 м)" : "Single section (20 m)")}
                </label>
              </div>
            )}

            <footer className="block-legend__footer"><span>{value(monthData.blocks)} {isMn ? "блок" : "blocks"}</span><span>Micromine</span></footer>
          </>
        ) : (
          <div className="block-legend__missing">
            <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
            </svg>
            <strong>{isMn ? "Блок загвар байхгүй" : "No block model available"}</strong>
            <p>{period === 1 ? t.blkNone : isMn ? "Сонгосон сарын олборлосон блокийн өгөгдөл байхгүй." : "Mined-block data is unavailable for the selected month."}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
