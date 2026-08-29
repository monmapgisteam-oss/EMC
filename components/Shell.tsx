"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { ROMAN, MON_L } from "@/lib/i18n";
import { BenchLine, BenchRail, DestChart, DetailCard, FilterBar, GradeChart, Kpis, MetalChart,
         Timeline, Tooltip } from "./Panels";

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
  const { m, setM, lang, setLang, t, setSel, theme, setTheme } = useStore();

  /* Хажуугийн баганын өргөн — чирж өөрчилнө. Сонголт нь localStorage-д
     хадгалагдана. Дундах багана (газрын зураг) үлдсэн зайг эзэлнэ. */
  const [colL, setColL] = useState(350);
  const [colR, setColR] = useState(376);
  useEffect(() => {
    const l = +(localStorage.getItem("emc-col-l") || 0);
    const r = +(localStorage.getItem("emc-col-r") || 0);
    if (l >= 240) setColL(Math.min(l, 620));
    if (r >= 240) setColR(Math.min(r, 620));
  }, []);

  function startDrag(e: React.PointerEvent, side: "L" | "R") {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = side === "L" ? colL : colR;
    const move = (ev: PointerEvent) => {
      const d = side === "L" ? ev.clientX - x0 : x0 - ev.clientX;
      const w = Math.max(240, Math.min(620, w0 + d));
      if (side === "L") setColL(w); else setColR(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dragging");
      /* Хадгалалт нь move бүрт биш, чирч дуусахад */
      const cur = side === "L" ? "emc-col-l" : "emc-col-r";
      localStorage.setItem(cur, String(side === "L" ? colLRef.current : colRRef.current));
    };
    document.body.classList.add("dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const colLRef = useRef(colL); colLRef.current = colL;
  const colRRef = useRef(colR); colRRef.current = colR;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
      if (e.key === "ArrowLeft" && m > 1) setM(m - 1);
      if (e.key === "ArrowRight" && m < 6) setM(m + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m, setM, setSel]);


  return (
    <div className="app">
      {/* ---------------------------------------------------------- толгой */}
      <header className="head">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo" src="/logo.svg" alt="Erdenet Mining Corporation" />
          <b>{t.appName}</b>
        </div>

        <div className="hspacer" />

        <span className="hlabel">{t.lMonth}</span>
        <div className="months">
          {ROMAN.map((lbl, i) => (
            <button key={lbl} aria-pressed={i + 1 === m} aria-label={MON_L[lang][i]}
                    onClick={() => setM(i + 1)}>{lbl}</button>
          ))}
        </div>

        <div className="seg" role="group" aria-label={t.thTheme}>
          {/* «Авто» хасагдсан — зөвхөн Өдөр / Шөнө */}
          {(["light", "dark"] as const).map((k) => (
            <button key={k} aria-pressed={theme === k} onClick={() => setTheme(k)}
                    title={k === "light" ? t.thLight : t.thDark}>
              {k === "light" ? "☀" : "☾"}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Language">
          <button aria-pressed={lang === "mn"} onClick={() => setLang("mn")}>МН</button>
          <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
        </div>
      </header>

      {/* ------------------------------------------------------------ гол */}
      <div className="main" style={{ gridTemplateColumns: `${colL}px 6px minmax(0,1fr) 6px ${colR}px` }}>
        <div className="col">
          <div className="panel" style={{ flex: "none" }}>
            <div className="ph"><h2>{t.chBench2}</h2></div>
            <div className="pb tight"><BenchLine /></div>
          </div>

          {/* `flex:1` байсан нь хаялбар цөөн үед панелийн доор том хоосон
              зай үлдээж байв. Одоо агуулгаараа багтана, шаардвал агшина. */}
          <div className="panel" style={{ flex: "0 1 auto" }}>
            <div className="ph">
              <h2>{t.pBench}</h2>
              <span className="curamp" title="Cu %">
                {[1, 2, 3, 4, 5, 6].map((i) => <i key={i} style={{ background: `var(--g${i})` }} />)}
              </span>
            </div>
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

        <div className="split" onPointerDown={(e) => startDrag(e, "L")} />

        <div className="col">
          <FilterBar />
          <Kpis />
          <div className="panel map" style={{ flex: 1 }}>
            <MineScene />
          </div>
        </div>

        <div className="split" onPointerDown={(e) => startDrag(e, "R")} />

        <div className="col">
          <div className="panel" style={{ flex: "none" }}>
            <div className="ph"><h2>{t.tlTitle}</h2></div>
            <div className="pb tight"><Timeline /></div>
          </div>
          <div className="panel" style={{ flex: "none" }}>
            <div className="ph"><h2>{t.chDest}</h2></div>
            <div className="pb tight"><DestChart /></div>
          </div>
          <div className="panel" style={{ flex: 1 }}>
            <div className="ph">
              <DetailCardTitle />
            </div>
            <DetailBody />
          </div>
        </div>
      </div>

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
