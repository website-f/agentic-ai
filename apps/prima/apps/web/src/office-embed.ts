/**
 * P117 (Fitri, 19 Nov 2026: "Prima and Agentic Office merge into one"): Prima shown inside the
 * Agentic Office page (a same-origin frame at /prima), under the office's own sidebar and header.
 *
 * Framed, Prima hides its own side menu and phone tabs (the office's sidebar lists Prima's apps
 * and screens instead) and its Sign out (the office signs out). Everything else is unchanged:
 * the same screens, permissions, launcher and top bar. Opened on its own (/prima/ in a tab,
 * Prima-only members, the phone app), nothing changes.
 *
 * Messages, same origin only, both ways:
 * - to the office: { source: 'prima', type: 'menu', apps, screens } (what this person has, from
 *   the menu Prima built for them) and { source: 'prima', type: 'route', hash, view, space, label }.
 * - from the office: { source: 'office', type: 'go', hash } opens a screen ('#clock') or an app
 *   ('#@hr'), the same addresses Prima already reads.
 */

/** Inside a frame whose page is the office (same origin). */
export const framed: boolean = (() => {
  try {
    return window.self !== window.top && window.parent.location.origin === window.location.origin;
  } catch {
    return false; // a parent on another origin: not the office
  }
})();

export interface OfficeScreen {
  view: string;
  label: string;
}

export interface OfficeApp {
  id: string;
  title: string;
  screens: OfficeScreen[];
}

export function tellOffice(msg: Record<string, unknown>): void {
  if (!framed) return;
  try {
    window.parent.postMessage({ source: 'prima', ...msg }, window.location.origin);
  } catch {
    /* the office page went away */
  }
}

/** The office asked for a screen or an app. Returns the clean-up. */
export function onOfficeGo(open: (hash: string) => void): () => void {
  if (!framed) return () => undefined;
  const on = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.source !== window.parent) return;
    const d = e.data as { source?: unknown; type?: unknown; hash?: unknown } | null;
    if (d && d.source === 'office' && d.type === 'go' && typeof d.hash === 'string') open(d.hash);
  };
  window.addEventListener('message', on);
  return () => window.removeEventListener('message', on);
}

/**
 * P122 (Fitri, 21 Nov 2026: "when I click any of Prima's menu items it shows Loading Prima Secure App; make it one
 * system"): the office opens Prima ahead of time, hidden (/prima/?warm=1), so it is already signed in and drawn when the
 * person first goes to it. Until the office first shows it ({ source: 'office', type: 'show' } or a 'go'), Prima does
 * only what any screen does to draw: it does not start the person's working session (the clock-in on opening the
 * system), send waiting surveys, track location or poll the clock. Opened any other way, it is shown from the start.
 */
const warmStart = framed && new URLSearchParams(window.location.search).has('warm');
let officeShown = !warmStart;
const shownListeners = new Set<() => void>();
if (warmStart) {
  const onShow = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.source !== window.parent) return;
    const d = e.data as { source?: unknown; type?: unknown } | null;
    if (!d || d.source !== 'office' || (d.type !== 'show' && d.type !== 'go')) return;
    officeShown = true;
    window.removeEventListener('message', onShow);
    for (const l of shownListeners) l();
  };
  window.addEventListener('message', onShow);
}

/** False only while Prima waits, opened ahead by the office and not yet shown (see above). */
export function isShown(): boolean {
  return officeShown;
}

export function onShown(listener: () => void): () => void {
  shownListeners.add(listener);
  return () => shownListeners.delete(listener);
}
