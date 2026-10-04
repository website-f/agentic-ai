import { queryOptions, useQuery } from "@tanstack/react-query";

import { PAGE_DOCS, plain, type PageDoc } from "./content";
import { MANIFEST_URL, type GuideManifest, type GuideShot, type GuideVideo } from "./manifest";
import { GUIDE_FLOWS, GUIDE_PAGES, type GuidePage } from "./targets";

export type Device = "desktop" | "mobile";

function isManifest(v: unknown): v is GuideManifest {
  if (!v || typeof v !== "object") return false;
  const m = v as Partial<GuideManifest>;
  return typeof m.shots === "object" && m.shots !== null && typeof m.videos === "object" && m.videos !== null;
}

/** Fetches the capture manifest. Missing, not JSON or malformed = null: the guide shows placeholders. */
export async function fetchManifest(): Promise<GuideManifest | null> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    // A missing file can come back as the app's index.html (SPA fallback): not JSON, so no manifest.
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const json: unknown = await res.json();
    return isManifest(json) ? json : null;
  } catch {
    return null;
  }
}

export const manifestQuery = queryOptions({
  queryKey: ["guide", "manifest"],
  queryFn: fetchManifest,
  staleTime: 5 * 60_000,
  retry: false,
});

export function useManifest() {
  return useQuery(manifestQuery).data ?? null;
}

export function shotOf(m: GuideManifest | null, key: string, device: Device): GuideShot | undefined {
  return m?.shots[key]?.[device];
}

export function videoOf(m: GuideManifest | null, id: string): GuideVideo | undefined {
  return m?.videos[id];
}

/** Shot keys of a page: "<page>" then "<page>:<state>" per captured state. */
export function shotKeys(page: GuidePage): string[] {
  return [page.id, ...page.states.map((st) => `${page.id}:${st.key}`)];
}

/** Every shot key the capture can produce (from targets.ts). */
export const ALL_SHOT_KEYS = new Set(GUIDE_PAGES.flatMap(shotKeys));

export const flowsOf = (pageId: string) => GUIDE_FLOWS.filter((f) => f.page === pageId);

/** Pages in sidebar order, grouped. */
export function groupedPages(pages: GuidePage[] = GUIDE_PAGES) {
  const out: { group: string; pages: GuidePage[] }[] = [];
  for (const p of pages) {
    const g = out.find((x) => x.group === p.group);
    if (g) g.pages.push(p);
    else out.push({ group: p.group, pages: [p] });
  }
  return out;
}

// ---------------------------------------------------------------- search

export interface SearchHit {
  page: GuidePage;
  /** Where it matched: "Page", a recipe title, "Tip"… */
  where: string;
  snippet: string;
  score: number;
}

function docTexts(page: GuidePage, doc: PageDoc): { where: string; text: string; weight: number }[] {
  return [
    { where: "Page", text: page.title, weight: 6 },
    { where: "About", text: doc.purpose, weight: 3 },
    ...doc.can.map((t) => ({ where: "What you can do", text: t, weight: 2 })),
    ...doc.howto.flatMap((r) => [
      { where: r.title, text: r.title, weight: 4 },
      ...r.steps.map((st) => ({ where: r.title, text: st.text, weight: 1 })),
    ]),
    ...doc.tips.map((t) => ({ where: "Tip", text: t, weight: 1 })),
    ...page.targets.map((t) => ({ where: "On screen", text: t.label, weight: 1 })),
  ];
}

/** Every word of the query must appear somewhere on the page; hits are ranked by where they match. */
export function searchGuide(query: string, limit = 30): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const page of GUIDE_PAGES) {
    const doc = PAGE_DOCS[page.id];
    if (!doc) continue;
    const texts = docTexts(page, doc).map((t) => ({ ...t, text: plain(t.text), low: plain(t.text).toLowerCase() }));
    const all = texts.map((t) => t.low).join(" ");
    if (!words.every((w) => all.includes(w))) continue;
    let best: (typeof texts)[number] | undefined;
    let bestScore = 0;
    for (const t of texts) {
      const n = words.filter((w) => t.low.includes(w)).length;
      const sc = n * t.weight + (n === words.length ? 5 : 0);
      if (sc > bestScore) {
        bestScore = sc;
        best = t;
      }
    }
    if (best) hits.push({ page, where: best.where, snippet: best.text, score: bestScore });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
