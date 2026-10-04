import { GUIDE_PAGES, type GuidePage } from "./targets";

/** Routes that are part of a documented page without sharing its path prefix. */
const ALIASES: Record<string, string> = {
  "/settings": "settings",
  "/welcome": "my-worker",
  "/approve": "approvals",
};

/** The guide page that documents the screen at `pathname` (longest matching route wins). */
export function guidePageFor(pathname: string): GuidePage | undefined {
  if (pathname === "/guide" || pathname.startsWith("/guide/") || pathname === "/present") return undefined;
  let best: GuidePage | undefined;
  for (const p of GUIDE_PAGES) {
    const hit = p.route === "/" ? pathname === "/" : pathname === p.route || pathname.startsWith(`${p.route}/`);
    if (hit && (!best || p.route.length > best.route.length)) best = p;
  }
  if (best) return best;
  for (const [prefix, id] of Object.entries(ALIASES)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return GUIDE_PAGES.find((p) => p.id === id);
  }
  return undefined;
}
