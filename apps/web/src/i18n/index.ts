/**
 * Languages (P22): English and Bahasa Melayu.
 *
 * The English text IS the key: `t("New agent")`, `t("{n} tasks waiting", { n })`. Bahasa Melayu
 * lives in ./ms/*.ts as English → Malay pairs; a missing entry falls back to the English, so a
 * new screen is never blank. `npx vitest run src/i18n` lists every t("…") without a Malay entry.
 *
 * Components use `const t = useT()` (re-renders when the language changes). Code outside
 * React (toasts, helpers) may call `t()` directly; it reads the current language.
 */
import { useCallback } from "react";
import { create } from "zustand";

import { MS } from "./ms";

export type Lang = "en" | "ms";
export type Vars = Record<string, string | number>;

export const LANGS: { key: Lang; label: string; short: string }[] = [
  { key: "en", label: "English", short: "EN" },
  { key: "ms", label: "Bahasa Melayu", short: "BM" },
];

const KEY = "agentic.lang";

function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "ms") return v;
  } catch {
    /* storage blocked: fall back to the browser's language */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ms") ? "ms" : "en";
}

function applyLang(lang: Lang): void {
  if (typeof document !== "undefined") document.documentElement.lang = lang === "ms" ? "ms" : "en";
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLang = create<LangState>((set) => ({
  lang: readLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* storage blocked: the language still applies for this visit */
    }
    applyLang(lang);
    set({ lang });
  },
}));
applyLang(useLang.getState().lang);

const DICTS: Record<Lang, Record<string, string>> = { en: {}, ms: MS };

/**
 * One English word, two meanings: tag it with "|", e.g. t("Open|verb") for the button and
 * t("Open") for the status. English shows the part before "|"; Malay looks up the whole key,
 * then the plain word.
 */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  const bar = text.indexOf("|");
  const plain = bar > 0 ? text.slice(0, bar) : text;
  const s = lang === "en" ? plain : (DICTS[lang][text] ?? DICTS[lang][plain] ?? plain);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Outside React: reads the current language at call time. */
export function t(text: string, vars?: Vars): string {
  return translate(useLang.getState().lang, text, vars);
}

/** In components: `const t = useT()`; the component re-renders when the language changes. */
export function useT(): (text: string, vars?: Vars) => string {
  const lang = useLang((s) => s.lang);
  return useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang]);
}

/**
 * Marks English text that is translated later, at render time: `label: msg("Tasks")` in a
 * list defined outside a component, then `t(item.label)` where it shows. It returns the text
 * unchanged; the coverage test finds msg("…") like t("…").
 */
export function msg(text: string): string {
  return text;
}

/** For Intl APIs (dates, numbers, relative times). */
export function locale(lang: Lang = useLang.getState().lang): string {
  return lang === "ms" ? "ms-MY" : "en-MY";
}
