"use client";

import { createContext, useContext, useEffect, useMemo, useState,
         type Dispatch, type ReactNode, type SetStateAction } from "react";
import { T, type Lang, type Dict } from "./i18n";

/** Баруун талын картад юу харуулах вэ */
export type Selection =
  | { kind: "bench"; tuv: number }
  | { kind: "dest"; ci: number; title: string; featName: string }
  | null;

export interface TipRow {
  label: string;
  value: string;
  color?: string | null;
}
export interface TipState {
  x: number;
  y: number;
  title: string;
  key?: string;
  rows: TipRow[];
  hint?: string;
}

/** «auto» = үйлдлийн системийн тохиргоог дагана */
export type Theme = "auto" | "light" | "dark";

interface Store {
  m: number;
  setM: (m: number) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  sel: Selection;
  setSel: (s: Selection) => void;
  blk: string | null;
  setBlk: (b: string | null) => void;
  tip: TipState | null;
  setTip: Dispatch<SetStateAction<TipState | null>>;
  t: Dict;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [m, setMRaw] = useState(1);
  const [lang, setLang] = useState<Lang>("mn");
  const [sel, setSel] = useState<Selection>(null);
  const [blk, setBlk] = useState<string | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [theme, setTheme] = useState<Theme>("auto");

  /* Хадгалсан сонголтыг сэргээнэ. Серверийн рендэрт localStorage
     байхгүй тул зөвхөн монтлогдсоны дараа уншина. */
  useEffect(() => {
    const v = localStorage.getItem("emc-theme");
    if (v === "light" || v === "dark") setTheme(v);
  }, []);

  /* `data-theme` нь app/globals.css дахь :root[data-theme=...]-ыг асаана.
     «auto» үед атрибутыг ХАСНА — тэгвэл prefers-color-scheme дагана. */
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "auto") {
      el.removeAttribute("data-theme");
      localStorage.removeItem("emc-theme");
    } else {
      el.setAttribute("data-theme", theme);
      localStorage.setItem("emc-theme", theme);
    }
    /* ArcGIS-ийн симболууд өнгөө үүсэх үедээ авдаг тул мэдэгдэнэ */
    window.dispatchEvent(new CustomEvent("emc-theme"));
  }, [theme]);

  /* Сар солиход блокийн сонголт хүчингүй болно */
  const setM = (next: number) => {
    setMRaw(next);
    setBlk(null);
  };

  const value = useMemo<Store>(
    () => ({
      m, setM, lang, setLang, sel, setSel, blk, setBlk, tip, setTip,
      theme, setTheme,
      t: T[lang] as Dict,
    }),
    [m, lang, sel, blk, tip, theme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore-г StoreProvider дотор дуудна");
  return v;
}
