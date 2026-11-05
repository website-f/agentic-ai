/**
 * P75: what the feedback widget knows about the Prima screen it is over.
 *
 * Prima keeps its screen in the address's hash (/prima/#staffpay) and may describe it on
 * `window.__primaPage` (title, what it is for, steps, the person's Prima role, Prima's rules for
 * it), announcing changes with a `prima:page` event. Without that the screen's own heading
 * (`.k-head h1`, `.k-head-sub`, Prima's page head) is read instead. Everything here is plain text
 * from the page, shown as text, never as HTML.
 */
import type { Lang } from "@/i18n";

export interface PrimaRule {
  id: string;
  title: string;
  body: string;
  source: string;
}

export interface PrimaPageInfo {
  view: string;
  /** As the person sees it: the screen's heading, in the screen language. */
  title: string;
  /** For the developer's list: "Prima · " and Prima's own name for the screen (English), else the heading. */
  name: string;
  blurb: string;
  steps: string[];
  role: { label: string; blurb: string } | null;
  rules: PrimaRule[];
}

declare global {
  interface Window {
    __primaPage?: unknown;
  }
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** "#staffpay" → "staffpay"; anything that is not a plain screen name → "". */
export function primaView(hash: string): string {
  const v = hash.replace(/^#\/?/, "").split(/[?&/]/)[0] ?? "";
  return /^[a-z0-9][a-z0-9_-]{0,59}$/i.test(v) ? v : "";
}

/** Where the feedback was sent from: "/prima/#staffpay" (the app's folder, then the screen). */
export function primaPath(pathname: string, hash: string): string {
  const base = pathname.startsWith("/prima") ? "/prima/" : pathname || "/";
  const view = primaView(hash);
  return view ? `${base}#${view}` : base;
}

/** Prima's screen language (prima.lang: en, ms or the BM + English mix) as the office's. */
export function primaLang(saved: string | null): Lang {
  return saved === "en" ? "en" : "ms";
}

export function readPrimaLang(): Lang {
  try {
    return primaLang(localStorage.getItem("prima.lang"));
  } catch {
    return "ms";
  }
}

/** A rule told once. Prima's titles are the first sentence of the body (cut short with "…" when
 * long): the body need not repeat the title, and a cut title gives way to the whole text. */
export function oneTelling(r: PrimaRule): PrimaRule {
  if (r.body === r.title) return { ...r, body: "" };
  if (r.title.endsWith("…") && r.body.startsWith(r.title.slice(0, -1).trimEnd())) return { ...r, title: r.body, body: "" };
  if (r.body.startsWith(r.title)) return { ...r, body: r.body.slice(r.title.length).trim() };
  return r;
}

/** Prima's own description of the screen, if it gave one for this screen. */
export function fromContract(raw: unknown, view: string): Omit<PrimaPageInfo, "name"> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const said = text(o.view, 60);
  // A description left over from the screen before is not this screen's.
  if (view && said && said !== view) return null;
  const title = text(o.title, 200);
  if (!title) return null;
  const steps = Array.isArray(o.steps) ? o.steps.map((s) => text(s, 300)).filter(Boolean).slice(0, 12) : [];
  const r = o.role && typeof o.role === "object" ? (o.role as Record<string, unknown>) : null;
  const role = r && text(r.label, 80) ? { label: text(r.label, 80), blurb: text(r.blurb, 600) } : null;
  const rules = Array.isArray(o.rules)
    ? o.rules
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({ id: text(x.id, 40), title: text(x.title, 300), body: text(x.body, 1200), source: text(x.source, 40) }))
        .filter((x) => x.title)
        .map(oneTelling)
        .slice(0, 30)
    : [];
  return { view: view || said, title, blurb: text(o.blurb, 1000), steps, role, rules };
}

/** The screen's heading as the person sees it: Prima's page head, else the main heading and the
 * line under it. */
function heading(doc: Document): { title: string; sub: string } {
  const head = doc.querySelector(".k-head");
  if (head) return { title: text(head.querySelector("h1")?.textContent, 200), sub: text(head.querySelector(".k-head-sub")?.textContent, 1000) };
  const h1 = doc.querySelector("main h1, [role='main'] h1") ?? doc.querySelector("h1");
  const next = h1?.nextElementSibling;
  return { title: text(h1?.textContent, 200), sub: next?.tagName === "P" ? text(next.textContent, 1000) : "" };
}

/** The screen: Prima's description of it (role, rules, steps) with the heading the person sees
 * (Prima translates the page, not the description), else the tab's title. */
export function readPrimaPage(doc: Document = document, win: Window = window): PrimaPageInfo {
  const view = primaView(win.location.hash);
  const given = fromContract(win.__primaPage, view);
  const h = heading(doc);
  const fallback = text(doc.title, 200) || "Prima";
  if (given) return { ...given, title: h.title || given.title, name: `Prima · ${given.title}`, blurb: given.blurb || h.sub };
  return { view, title: h.title || fallback, name: `Prima · ${h.title || fallback}`, blurb: h.sub, steps: [], role: null, rules: [] };
}

/** Places the button stays away from: the no-sign-in preview, and Prima shown inside another
 * page (the office shows its own button around it). */
export function widgetUnwelcome(win: Window = window): boolean {
  if (win.location.pathname.startsWith("/prima/demo")) return true;
  try {
    return win.top !== win.self;
  } catch {
    return true; // framed by another site
  }
}
