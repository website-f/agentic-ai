/**
 * P146 (owner, 28 Nov 2026: "When in the org chart I click to see any member, going back doesn't return to the org
 * chart — such a hassle"): the chart canvas remembers where it was (view, zoom and pan, the boxes open, the Unsorted
 * panel) in this tab's sessionStorage while it is shown. Opening a member's page from the chart marks it to come back
 * (member-route.ts openMember); the canvas, opened again, takes the marked state once and is where it was.
 */
export interface ChartMemory {
  mode: 'lines' | 'units' | 'companies';
  t: { s: number; x: number; y: number };
  /** Reporting lines: the boxes closed. */
  closed: string[];
  /** Prima's own departments open (the office's structure could not be read). */
  openUnits: string[];
  /** The structure's open units (null: only the top). */
  open: string[] | null;
  unsorted: boolean;
  /** The company the Unsorted panel was showing ('' all). */
  unsortedCompany: string;
}

const KEY = 'prima.org.canvas';
const BACK = 'prima.org.canvas.back';

/** Whether the chart canvas is on screen now (a member opened from it returns to it, not to the details). */
export const canvas = { shown: false };

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveChart(m: ChartMemory): void {
  try {
    store()?.setItem(KEY, JSON.stringify(m));
  } catch {
    /* full or blocked: the chart just opens fresh */
  }
}

/** Marks the saved state to be taken when the chart opens again (a member's page opened from it). */
export function markChartReturn(): void {
  try {
    store()?.setItem(BACK, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** The saved state when the chart is coming back to it, else null. Read (twice in development is fine) until cleared. */
export function takeChartReturn(): ChartMemory | null {
  try {
    const s = store();
    const at = Number(s?.getItem(BACK) ?? 0);
    // A day at most: a tab left open overnight opens the chart fresh.
    if (!at || Date.now() - at > 86_400_000) return null;
    const m = JSON.parse(s?.getItem(KEY) ?? 'null') as ChartMemory | null;
    if (!m || typeof m !== 'object' || !m.t || !Number.isFinite(m.t.s)) return null;
    return m;
  } catch {
    return null;
  }
}

/** The chart came back (or opened fresh): the mark is used up. */
export function clearChartReturn(): void {
  try {
    store()?.removeItem(BACK);
  } catch {
    /* ignore */
  }
}
