/** P121b: Prima's SOPs and workflows in the office guide (/guide/prima-sop). The flows are Prima's own catalog
 * (apps/prima/apps/web/src/sop), copied into prima-sops.json by scripts/prima-sops.mjs; prima-sops.test.ts checks the
 * copy is current. Read only: every "Open in Prima" button opens that screen (and tab) inside the office's Prima. */
import { queryOptions, useQuery } from "@tanstack/react-query";

export const PRIMA_SOP_PAGE = "prima-sop";

export interface Text2 {
  en: string;
  ms: string;
}

export interface PrimaPlace {
  view: string;
  tab?: string;
  label: Text2;
}

export interface PrimaSopStep {
  who: Text2;
  does: Text2;
  where?: PrimaPlace;
  decision?: boolean;
  outside?: boolean;
}

export type PrimaSopStatus = "in_force" | "trial" | "off" | "draft";

export interface PrimaSop {
  id: string;
  app: string;
  title: Text2;
  purpose: Text2;
  start?: PrimaPlace;
  starter: Text2;
  steps: PrimaSopStep[];
  rules: Text2[];
  status: PrimaSopStatus;
  statusNote?: Text2;
  source: { doc: string; decided?: string };
  words?: string;
}

export interface PrimaApp {
  id: string;
  en: string;
  ms: string;
}

export interface PrimaSops {
  apps: PrimaApp[];
  sops: PrimaSop[];
}

export const pick = (t: Text2, lang: "en" | "ms") => (lang === "ms" ? t.ms : t.en);

/** The address inside the office's Prima: /prima#<view> or /prima#<view>/<tab>. */
export const primaHash = (p: { view: string; tab?: string }) => (p.tab ? `${p.view}/${p.tab}` : p.view);

export const primaSopsQuery = queryOptions({
  queryKey: ["guide", "prima-sops"],
  queryFn: async (): Promise<PrimaSops> => (await import("./prima-sops.json")).default as PrimaSops,
  staleTime: Infinity,
});

/** The catalog, fetched the first time it is needed (it is its own file, so the guide opens without it). */
export function usePrimaSops(enabled = true) {
  return useQuery({ ...primaSopsQuery, enabled }).data;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'");

/** Every word typed must be somewhere in the flow (either language); a title match ranks first. */
export function searchPrimaSops(data: PrimaSops | undefined, query: string, app?: string): PrimaSop[] {
  if (!data) return [];
  const words = fold(query).split(/\s+/).filter(Boolean);
  const list = app ? data.sops.filter((s) => s.app === app) : data.sops;
  if (!words.length) return list;
  const appName = new Map(data.apps.map((a) => [a.id, `${a.en} ${a.ms}`]));
  const scored: { s: PrimaSop; score: number }[] = [];
  for (const s of list) {
    const title = fold(`${s.title.en} ${s.title.ms}`);
    const body = fold(
      [
        s.purpose.en, s.purpose.ms, s.starter.en, s.starter.ms, s.words ?? "", appName.get(s.app) ?? "",
        ...s.steps.flatMap((x) => [x.who.en, x.who.ms, x.does.en, x.does.ms, x.where?.label.en ?? "", x.where?.label.ms ?? ""]),
        ...s.rules.flatMap((r) => [r.en, r.ms]),
      ].join(" "),
    );
    if (!words.every((w) => title.includes(w) || body.includes(w))) continue;
    scored.push({ s, score: words.filter((w) => title.includes(w)).length });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.s);
}
