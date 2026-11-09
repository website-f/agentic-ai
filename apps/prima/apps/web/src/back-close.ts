import { useEffect, useRef } from 'react';

/**
 * P96 (Fitri, 10 Nov 2026: "super mobile friendly ... we will export it to APK and iOS"): the phone's Back (Android's
 * back button, the iPhone's swipe back, the browser's Back, and the same inside an app wrapper's WebView) closes the
 * sheet, drawer or dialog open on top instead of leaving the screen. Each open sheet adds one history entry with the
 * same address; Back removes it and closes the sheet. Closing a sheet with its own button removes its entry again,
 * so Back never has to be pressed twice. Only the top sheet closes per Back.
 */
interface Held {
  token: string;
  close: () => void;
}
const held: Held[] = [];
const handled = new WeakSet<Event>();
let skip = 0;
let count = 0;

const stateToken = (): string | undefined => {
  try {
    return (history.state as { primaSheet?: string } | null)?.primaSheet;
  } catch {
    return undefined;
  }
};

if (typeof window !== 'undefined') {
  // Registered when this file loads, before App's own Back handling, so App can tell a sheet's Back from a screen's.
  window.addEventListener('popstate', (e) => {
    if (skip > 0) {
      skip--;
      handled.add(e);
      return;
    }
    const top = held.at(-1);
    if (!top || stateToken() === top.token) return;
    handled.add(e);
    held.pop();
    top.close();
  });
}

/** Whether this Back was used to close a sheet (App then leaves the screen as it is). */
export const backClosedSheet = (e: Event): boolean => handled.has(e);

/** A sheet is open: Back closes it. Returns the release to call when the sheet closes by any other way. */
export function holdBack(close: () => void): () => void {
  const token = `sheet-${++count}`;
  const entry: Held = { token, close };
  held.push(entry);
  try {
    history.pushState({ ...((history.state as object | null) ?? {}), primaSheet: token }, '');
  } catch {
    /* a sandboxed frame without history: the sheet still closes with its own button */
  }
  return () => {
    const i = held.indexOf(entry);
    if (i < 0) return; // closed by Back already
    held.splice(i, 1);
    // Take the sheet's own entry off again (next tick: a screen change in the same click may already have replaced it).
    setTimeout(() => {
      if (stateToken() !== token) return;
      skip++;
      history.back();
    }, 0);
  };
}

/** Hook form: while `open`, the phone's Back calls `close`. */
export function useBackClose(open: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => (open ? holdBack(() => latest.current()) : undefined), [open]);
}
