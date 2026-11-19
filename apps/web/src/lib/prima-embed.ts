/** P117 (Fitri, 19 Nov 2026: "Prima and Agentic Office merge into one"): Prima shown inside the
 * office page (pages/prima.tsx frames /prima/), with the office's sidebar as its menu.
 *
 * Prima tells the office (apps/prima/apps/web/src/office-embed.ts) what this person has (its apps
 * and screens, already in their Prima language) and which screen is open; the office's sidebar
 * lists and marks them and opens them with the same addresses Prima reads ('#clock', '#@hr').
 * What Prima has is kept per person on this device, so the sidebar shows it before Prima opens. */
import { create } from "zustand";

export interface PrimaScreen {
  view: string;
  label: string;
}

export interface PrimaApp {
  id: string;
  title: string;
  screens: PrimaScreen[];
}

export interface PrimaMenu {
  apps: PrimaApp[];
  /** The everyday screens (with apps), or every screen (a short menu without apps). */
  screens: PrimaScreen[];
}

interface PrimaState {
  userId: string | null;
  menu: PrimaMenu | null;
  /** Where Prima is: '#clock', '#@hr', '#home'. */
  hash: string;
  view: string;
  space: string | null;
  frame: Window | null;
  load: (userId: string) => void;
  setMenu: (menu: PrimaMenu) => void;
  setRoute: (r: { hash: string; view: string; space: string | null }) => void;
  setFrame: (w: Window | null) => void;
}

const key = (userId: string) => `agentic.prima.menu:${userId}`;

const isScreen = (x: unknown): x is PrimaScreen =>
  !!x && typeof (x as PrimaScreen).view === "string" && typeof (x as PrimaScreen).label === "string";

/** Only what is well formed (it comes from another frame and from storage). */
export function cleanMenu(raw: unknown): PrimaMenu | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { apps?: unknown; screens?: unknown };
  const screens = Array.isArray(r.screens) ? r.screens.filter(isScreen).slice(0, 200) : [];
  const apps = Array.isArray(r.apps)
    ? r.apps
        .filter((a): a is PrimaApp => !!a && typeof (a as PrimaApp).id === "string" && typeof (a as PrimaApp).title === "string")
        .map((a) => ({ id: a.id, title: a.title, screens: Array.isArray(a.screens) ? a.screens.filter(isScreen).slice(0, 100) : [] }))
        .slice(0, 30)
    : [];
  return apps.length || screens.length ? { apps, screens } : null;
}

export const usePrima = create<PrimaState>((set, get) => ({
  userId: null,
  menu: null,
  hash: "",
  view: "",
  space: null,
  frame: null,
  load: (userId) => {
    if (get().userId === userId) return;
    let menu: PrimaMenu | null = null;
    try {
      menu = cleanMenu(JSON.parse(localStorage.getItem(key(userId)) ?? "null"));
    } catch {
      menu = null;
    }
    set({ userId, menu });
  },
  setMenu: (menu) => {
    const userId = get().userId;
    if (userId) {
      try {
        localStorage.setItem(key(userId), JSON.stringify(menu));
      } catch {
        /* private mode: kept until the page reloads */
      }
    }
    set({ menu });
  },
  setRoute: (r) => set({ hash: r.hash, view: r.view, space: r.space }),
  setFrame: (frame) => set({ frame }),
}));

/** Open a Prima screen or app in the Prima already showing. False when Prima is not open here. */
export function primaGo(hash: string): boolean {
  const w = usePrima.getState().frame;
  if (!w) return false;
  try {
    w.postMessage({ source: "office", type: "go", hash }, window.location.origin);
    return true;
  } catch {
    return false;
  }
}

/** Every screen this person has in Prima (everyday and inside apps). */
export function allScreens(menu: PrimaMenu | null): PrimaScreen[] {
  if (!menu) return [];
  return [...menu.screens, ...menu.apps.flatMap((a) => a.screens)];
}
