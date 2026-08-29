"use client";

import { createContext, useContext, useMemo, useState,
         type Dispatch, type ReactNode, type SetStateAction } from "react";
import { T, LISTS, type Lang, type Dict } from "./i18n";

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

interface Store {
  m: number;
  setM: (m: number) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  sel: Selection;
  setSel: (s: Selection) => void;
  blk: string | null;
  setBlk: (b: string | null) => void;
  tip: TipState | null;
  setTip: Dispatch<SetStateAction<TipState | null>>;
  t: Dict;
  lists: (typeof LISTS)["mn"];
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [m, setMRaw] = useState(1);
  const [lang, setLang] = useState<Lang>("mn");
  const [sel, setSel] = useState<Selection>(null);
  const [blk, setBlk] = useState<string | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  /* Сар солиход блокийн сонголт хүчингүй болно */
  const setM = (next: number) => {
    setMRaw(next);
    setBlk(null);
  };

  const value = useMemo<Store>(
    () => ({
      m, setM, lang, setLang, sel, setSel, blk, setBlk, tip, setTip,
      t: T[lang] as Dict,
      lists: LISTS[lang] as (typeof LISTS)["mn"],
    }),
    [m, lang, sel, blk, tip],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore-г StoreProvider дотор дуудна");
  return v;
}
