/**
 * P79: where each step of a page's guide is on the screen, for the picture tour (guide-tour.tsx).
 *
 * A step names its element with `target` (a CSS selector, best `[data-guide="..."]`, which a page
 * puts on the element it means) or with `labels` (what the element is called on screen, in the
 * language the person reads: the office's steps, lib/page-tip-marks.ts). A step without either,
 * or whose element is not on the page, is matched by its words: a step says "Open Waiting for you", the page has a heading or button
 * reading "Waiting for you", and the longest such label wins (inside the page's main area
 * before its menus; on screen before off it). Both are in the language the person reads, so
 * Malay steps find Malay buttons.
 */
import { IGNORE_ATTR } from "./capture";

export interface GuideStep {
  text: string;
  /** CSS selector of the element the step is about. */
  target?: string;
  /** Or what that element is called on screen (the first found wins). */
  labels?: string[];
  /** Or the element itself, found by whoever wrote the step (Prima's tour reads its layout). */
  el?: Element;
}

/** Where a step's element is, in CSS pixels of the window. `off`: the element is there but
 * scrolled away (above or below what is on screen). */
export interface StepBox {
  x: number;
  y: number;
  w: number;
  h: number;
  off: "above" | "below" | null;
}

const LABELLED =
  "button, a[href], summary, label, legend, th, h1, h2, h3, h4, [role=tab], [role=button], [role=menuitem], [role=link], [role=heading], input, textarea, select, [aria-label]";
const INTERACTIVE = /^(button|a|summary|input|textarea|select)$/;
const MIN = 4; // shorter labels ("OK", "All") match too much
const MAX = 64;

/** Letters and digits only (any script), single spaces; the case is kept. */
function words(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Lower case, letters and digits only (any script), single spaces. */
export function plain(s: string): string {
  return words(s).toLowerCase();
}

function shown(el: Element, win: Window): boolean {
  if (el.closest(`[${IGNORE_ATTR}]`) || el.closest("[aria-hidden=true], [inert]")) return false;
  if (!el.getClientRects().length) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = win.getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.opacity !== "0";
}

/** What the element is called, as written (not as styled: an upper-case heading is read in the
 * case its text has). A button's first line only: a card's button carries its title. */
export function labelOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.placeholder.trim();
  const raw = el.textContent ?? "";
  const seen = (el as HTMLElement).innerText;
  const first = (seen ?? raw).split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const at = raw.toLowerCase().indexOf(first.toLowerCase());
  return at >= 0 ? raw.slice(at, at + first.length) : first;
}

function onScreen(el: Element, win: Window): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < win.innerHeight && r.right > 0 && r.left < win.innerWidth;
}

/** Does the step name this label? As a name: same case, whole words, and a one-word name not
 * merely starting a sentence ("Search to see…" is an instruction, not the Search button). */
export function names(step: string, label: string): boolean {
  const l = words(label);
  if (l.length < MIN || l.length > MAX || !/^[\p{Lu}\p{N}]/u.test(l)) return false;
  const single = !l.includes(" ");
  return step
    .split(/[.:;?!]\s+|\s+[-–—]\s+/)
    .some((sentence) => {
      const s = ` ${words(sentence)} `;
      if (!single) return s.includes(` ${l} `);
      return s.indexOf(` ${l} `, 1) > 0;
    });
}

/** The element a step's words point at, or null. */
export function matchByWords(text: string, doc: Document = document, win: Window = window): Element | null {
  if (words(text).length < MIN) return null;
  const main = doc.querySelector("main, [role=main]");
  let best: { el: Element; score: number } | null = null;
  for (const el of Array.from(doc.body.querySelectorAll(LABELLED))) {
    if (!(el instanceof HTMLElement)) continue; // icons (svg) say nothing a step names
    const label = labelOf(el);
    if (!names(text, label) || !shown(el, win)) continue;
    const inMain = !!main?.contains(el);
    const visible = onScreen(el, win);
    // The menus around the page count only where they can be seen.
    if (main && !inMain && !visible) continue;
    const l = words(label);
    let score = l.length * 4 + l.split(" ").length * 10;
    if (INTERACTIVE.test(el.localName) || el.hasAttribute("role")) score += 6;
    if (inMain) score += 30;
    if (visible) score += 60;
    if (!best || score > best.score) best = { el, score };
  }
  return best?.el ?? null;
}

/** The element called exactly `name` (a count after it is allowed: "Waiting on you 3"), on screen
 * and in the page's main area first. */
export function byLabel(name: string, doc: Document = document, win: Window = window): Element | null {
  const want = plain(name);
  if (!want) return null;
  // A name with a blank in it ("Always allow for {name}") stands for any filling.
  const parts = name.split(/\{\w+\}/);
  const filled = parts.length > 1 ? new RegExp(`^${parts.map(plain).join(" ?.+? ?")}$`) : null;
  const main = doc.querySelector("main, [role=main]");
  let best: { el: Element; score: number } | null = null;
  for (const el of Array.from(doc.body.querySelectorAll(LABELLED))) {
    if (!(el instanceof HTMLElement)) continue;
    const got = plain(labelOf(el));
    const same = filled ? filled.test(got) : got === want || (got.startsWith(`${want} `) && /^\d+$/.test(got.slice(want.length + 1)));
    if (!same) continue;
    if (!shown(el, win)) continue;
    const inMain = !!main?.contains(el);
    const visible = onScreen(el, win);
    if (main && !inMain && !visible) continue;
    let score = 0;
    if (INTERACTIVE.test(el.localName) || el.hasAttribute("role")) score += 6;
    if (inMain) score += 30;
    if (visible) score += 60;
    if (!best || score > best.score) best = { el, score };
  }
  return best?.el ?? null;
}

/** The element a step is about: its target when that is on the page, then its labels, else its words. */
export function findStep(step: GuideStep, doc: Document = document, win: Window = window): Element | null {
  if (step.el?.isConnected && shown(step.el, win)) return step.el;
  if (step.target) {
    try {
      const all = Array.from(doc.querySelectorAll(step.target)).filter((el) => shown(el, win));
      const el = all.find((e) => onScreen(e, win)) ?? all[0];
      if (el) return el;
    } catch {
      /* not a selector this browser reads: try the words */
    }
  }
  for (const name of step.labels ?? []) {
    const el = byLabel(name, doc, win);
    if (el) return el;
  }
  return matchByWords(step.text, doc, win);
}

const HEADING = /^(h[2-4]|legend)$/;

/** What to light for an element: a heading (or a caption) stands for the card or section it
 * heads, when that is a box of its own and not most of the screen. */
export function areaOf(el: Element, win: Window = window): Element {
  if (!HEADING.test(el.localName) && el.getAttribute("role") !== "heading") return el;
  const screen = win.innerWidth * win.innerHeight;
  let at: Element | null = el.parentElement;
  for (let up = 0; at && up < 5 && at !== el.ownerDocument.body; up++, at = at.parentElement) {
    if (at.localName === "main") break;
    const r = at.getBoundingClientRect();
    if (r.width * r.height > screen * 0.45) break;
    const cs = win.getComputedStyle(at);
    const boxed = /^(section|article|fieldset|li)$/.test(at.localName) || at.getAttribute("role") === "region" ||
      (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") || (cs.boxShadow && cs.boxShadow !== "none");
    if (boxed) return at;
  }
  return el;
}

/** Where an element is now, kept within the window (with `off` when it is scrolled away). */
export function boxOf(el: Element, win: Window = window): StepBox {
  const r = el.getBoundingClientRect();
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const off = r.bottom <= 0 ? "above" : r.top >= vh ? "below" : null;
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  return { x, y, w: Math.max(0, Math.min(vw, r.right) - x), h: Math.max(0, Math.min(vh, r.bottom) - y), off };
}
