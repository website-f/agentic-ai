/** P123 (boss, 23 Nov 2026: "after signing in show Prima first; the Agentic Office is one entry
 * in Prima's menu, and inside it a Back to Prima button"): where this tab opens.
 *
 * The site's start ("/", after signing in or typing the address) opens Prima for everyone who has
 * it (me.prima, not Prima-only people, who have their own page). Once the person goes into the
 * Agentic Office (Prima's "Agentic Office" entry, or any office page), "/" is the office's own
 * start page for the rest of this tab, until they go back to Prima or sign in again. */
import type { Me } from "./types";

const KEY = "agentic.in-office";

export function inOffice(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setInOffice(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode: this page only */
  }
}

/** Prima is this person's first screen. */
export function startsInPrima(me: Pick<Me, "access" | "prima">): boolean {
  return !!me.prima && me.access !== "prima_only";
}
