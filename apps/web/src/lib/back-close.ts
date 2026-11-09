/** P96: the phone's Back (Android back button, a back swipe, the browser's Back) closes the open
 * sheet or dialog instead of leaving the page, like a native app.
 *
 * Opening a sheet adds one history entry with the same address (its id in `history.state`);
 * Back pops it and the sheet closes. Closing it any other way (X, Cancel, tap outside, Escape)
 * takes that entry back off, so the next Back leaves the page as usual. Sheets stack: Back
 * closes the top one first.
 *
 * The router never sees these entries: they are pushed with the browser's own pushState (the
 * router only wraps the instance method) and the pops they cause are stopped before the router's
 * listener, so nothing reloads. Only on touch screens (a phone, a tablet, the wrapped app):
 * with a mouse, Back keeps meaning "previous page".
 *
 * Sheets that the address opens (a task sheet at ?task=..., a file at ?f=...) already close on
 * Back through the router: when the address changed between the tap and the sheet opening, no
 * entry is added. */
import { useEffect, useRef } from "react";

import { useMedia } from "./use-media";

const KEY = "__sheets";

interface Entry {
  id: string;
  close: () => void;
  /** Taken off already (Back pressed or the page moved on): nothing left to undo. */
  done: boolean;
}

const stack: Entry[] = [];
/** Pops we cause ourselves; the router has nothing to do for them. */
let swallow = 0;
/** A close waiting one tick before it steps back: a sheet that reopens at once (React's
 * StrictMode, a quick close and open) takes the entry over instead of adding another. */
let pending: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
let installed = false;
let seq = 0;
/** The address when the person last tapped, clicked or pressed a key. */
let inputHref: string | null = null;
const noteInput = () => {
  inputHref = window.location.href;
};

function idsOf(state: unknown): string[] {
  const v = (state as Record<string, unknown> | null)?.[KEY];
  return Array.isArray(v) ? (v as string[]) : [];
}

const topId = () => idsOf(window.history.state).at(-1);

function onPop(e: PopStateEvent) {
  const here = idsOf(e.state);
  let closed = false;
  // Every open sheet whose entry is gone closes, the top one first.
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i]!;
    if (here.includes(s.id)) continue;
    stack.splice(i, 1);
    s.done = true;
    closed = true;
    s.close();
  }
  if (swallow > 0) {
    swallow--;
    e.stopImmediatePropagation();
    return;
  }
  // Back closed a sheet: the address did not change, so the router has nothing to do.
  if (closed) {
    e.stopImmediatePropagation();
    return;
  }
  // Landed on an entry a sheet left behind (the page moved on while it was open): step over
  // it, so one Back is one visible step.
  if (here.length && !here.some((id) => stack.some((s) => s.id === id))) {
    e.stopImmediatePropagation();
    window.history.back();
  }
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Capture on window runs before the router's own popstate listener.
  window.addEventListener("popstate", onPop, { capture: true });
  for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, noteInput, { capture: true, passive: true });
}

/** The sheet opened on this address (from a tap, a key, or later on its own), not because the
 * address changed: only then does it need its own Back entry. */
export function opensInPlace(): boolean {
  return inputHref !== null && inputHref === window.location.href;
}

/** The browser's pushState, not the router's wrapper around it. */
function rawPush(state: unknown) {
  const proto = Object.getPrototypeOf(window.history) as History;
  proto.pushState.call(window.history, state, "");
}

/** Open: one history entry for this sheet. Returns the entry to hand to `closeSheet`. */
export function openSheet(close: () => void): Entry {
  install();
  if (pending && topId() === pending.id) {
    // The sheet that just closed opens again: reuse its entry.
    clearTimeout(pending.timer);
    const entry: Entry = { id: pending.id, close, done: false };
    pending = null;
    stack.push(entry);
    return entry;
  }
  const id = `s${Date.now().toString(36)}${(seq++).toString(36)}`;
  const state = { ...((window.history.state as Record<string, unknown> | null) ?? {}), [KEY]: [...idsOf(window.history.state), id] };
  rawPush(state);
  const entry: Entry = { id, close, done: false };
  stack.push(entry);
  return entry;
}

/** Closed by the person (or unmounted): take its entry back off, if it is still on top. */
export function closeSheet(entry: Entry): void {
  const i = stack.indexOf(entry);
  if (i >= 0) stack.splice(i, 1);
  if (entry.done) return;
  entry.done = true;
  if (topId() !== entry.id) return; // the page moved on: the entry stays behind (see onPop)
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
  const id = entry.id;
  pending = {
    id,
    timer: setTimeout(() => {
      pending = null;
      // Still on top (no navigation in between): step back over it, quietly.
      if (topId() === id) {
        swallow++;
        window.history.back();
      }
    }, 0),
  };
}

/** Back closes this sheet while it is open (touch screens only, unless `enabled` says). */
export function useBackClose(open: boolean, onClose: () => void, enabled?: boolean): void {
  const touch = useMedia("(pointer: coarse)");
  const on = enabled ?? touch;
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open || !on || !opensInPlace()) return;
    const entry = openSheet(() => close.current());
    return () => closeSheet(entry);
  }, [open, on]);
}

install(); // listen from the start, so the first tap is seen

/** Tests only. */
export function resetBackCloseForTests(): void {
  inputHref = null;
  stack.length = 0;
  swallow = 0;
  if (pending) clearTimeout(pending.timer);
  pending = null;
}
