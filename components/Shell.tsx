"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { ROMAN, MON_L } from "@/lib/i18n";
import { BenchRail, DetailCard, GradeChart, Kpis, MetalChart, Timeline, Tooltip } from "./Panels";

/* ArcGIS Maps SDK бол бүхэлдээ browser талын сан — SSR-ээс салгана.
   Түр орлуулагч нь MineScene-тэй ЯГ ИЖИЛ бүтэцтэй байх ёстой: эс тэгвэл
   ачаалж дуусахад .ph толгой нэмэгдэж, .mapwrap-ийн өндөр яг SceneView
   үүсэх агшинд өөрчлөгдөж, зураг панелаа дүүргэхгүй үлддэг. */
const MineScene = dynamic(() => import("./MineScene"), {
  ssr: false,
  loading: () => (
    <>
      <div className="ph">
        <h2>&nbsp;</h2>
        <span className="src live" style={{ marginLeft: "auto" }}>ArcGIS 4.34</span>
      </div>
      <div className="mapwrap">
        <div className="loading"><span className="spin" /><span>ArcGIS…</span></div>
      </div>
    </>
  ),
});

export default function Shell() {
  const { m, setM, lang, setLang, t, lists, setSel } = useStore();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setDrawer(false); setSel(null); }
      if (e.key === "ArrowLeft" && m > 1) setM(m - 1);
      if (e.key === "ArrowRight" && m < 6) setM(m + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m, setM, setSel]);

  const cards: { k: keyof typeof lists; title: string; tag: string }[] = [
    { k: "c0", title: t.c0, tag: t.tagSrc },
    { k: "c1", title: t.c1, tag: "JOIN" },
    { k: "c2", title: t.c2, tag: "LIVE" },
    { k: "c3", title: t.c3, tag: t.wait },
    { k: "c4", title: t.c4, tag: "?" },
  ];

  return (
    <div className="app">
      {/* ---------------------------------------------------------- толгой */}
      <header className="head">
        <div className="brand">
          <div className="mark">Cu</div>
          <div>
            <b>{t.appName}</b>
            <span>{t.appOrg}</span>
          </div>
        </div>

        <div className="hspacer" />

        <span className="hlabel">{t.lMonth}</span>
        <div className="months">
          {ROMAN.map((lbl, i) => (
            <button key={lbl} aria-pressed={i + 1 === m} aria-label={MON_L[lang][i]}
                    onClick={() => setM(i + 1)}>{lbl}</button>
          ))}
        </div>

        <button className="ghost" onClick={() => setDrawer(true)}>{t.btnSrc}</button>
        <div className="seg" role="group" aria-label="Language">
          <button aria-pressed={lang === "mn"} onClick={() => setLang("mn")}>МН</button>
          <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
        </div>
      </header>

      {/* ------------------------------------------------------------ гол */}
      <div className="main">
        <div className="col">
          <Kpis />
          <div className="panel" style={{ flex: 1 }}>
            <div className="ph"><h2>{t.pBench}</h2></div>
            <div className="pb tight"><BenchRail /></div>
          </div>

          <div className="panel" style={{ flex: "none" }}>
            <div className="ph"><h2>{t.chGrade}</h2></div>
            <div className="pb tight"><GradeChart /></div>
          </div>

          <div className="panel" style={{ flex: "none" }}>
            <div className="ph"><h2>{t.chMetal}</h2></div>
            <div className="pb tight"><MetalChart /></div>
          </div>
        </div>

        <div className="col">
          <div className="panel map" style={{ flex: 1 }}>
            <MineScene />
          </div>
        </div>

        <div className="col">
          <div className="panel" style={{ flex: "none" }}>
            <div className="ph"><h2>{t.tlTitle}</h2></div>
            <div className="pb tight"><Timeline /></div>
          </div>
          <div className="panel" style={{ flex: 1 }}>
            <div className="ph">
              <DetailCardTitle />
            </div>
            <DetailBody />
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------- самбар */}
      <div className={"scrim" + (drawer ? " on" : "")} onClick={() => setDrawer(false)} />
      <aside className={"drawer" + (drawer ? " on" : "")} aria-hidden={!drawer}>
        <div className="dh">
          <h2>{t.drTitle}</h2>
          <div style={{ flex: 1 }} />
          <button className="ghost" onClick={() => setDrawer(false)}>✕</button>
        </div>
        <div className="dbody">
          <p>{t.drLead}</p>
          {cards.map((c) => (
            <div className={"card" + (c.k === "c4" ? " warn" : "")} key={c.k}>
              <h3><span>{c.title}</span><em>{c.tag}</em></h3>
              <ul>
                {(lists[c.k] as readonly string[]).map((s, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: s }} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <Tooltip />
    </div>
  );
}

/* DetailCard нь гарчиг + бие хоёрыг хамт буцаадаг тул хуваая */
function DetailCardTitle() {
  const { sel, t } = useStore();
  if (!sel) return <h2>{t.dBench}</h2>;
  if (sel.kind === "bench") return <h2>{`${t.dBench} ${sel.tuv} м`}</h2>;
  return <h2>{sel.title}</h2>;
}

function DetailBody() {
  return <DetailCard />;
}
