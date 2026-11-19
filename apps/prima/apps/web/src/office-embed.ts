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
