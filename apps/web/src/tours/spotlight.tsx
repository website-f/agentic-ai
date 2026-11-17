/**
 * P109: one step of a guided tour. The page dims except the element the step is about, which
 * stays clickable inside a highlighted ring; a card beside it says what it is and what to
 * click, with Back, Next and Skip. On a phone the card sits at the bottom of the screen.
 *
 * Keyboard: Right arrow or Enter on Next goes on, Left arrow goes back, Escape skips. Focus
 * moves to the card on every step (screen readers read its title and text, and the step count
 * is announced) and stays inside it; it goes back where it was when the tour ends.
 */
import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { chooseLanguage } from "@/components/language-switch";
import { Button } from "@/components/ui/button";
import { useLang, useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { selectorOf, type TourStep } from "./tours";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 6;
/** How long to look for the step's element: a page that just opened may still be loading. */
export const WAIT_NEW_PAGE = 2500;
const WAIT_SAME_PAGE = 700;
const PHONE = 640;

/** The first element of the step's anchors that is on screen. */
export function findTarget(step: TourStep): HTMLElement | null {
  for (const anchor of step.target ?? []) {
    let nodes: NodeListOf<HTMLElement>;
    try {
      nodes = document.querySelectorAll<HTMLElement>(selectorOf(anchor));
    } catch {
      continue; // a bad selector: try the next anchor
    }
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
};

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the card goes: under the element, else above, else beside; inside the screen. */
function placeCard(box: Box | null, vw: number, vh: number, cw: number, ch: number): { left: number; top: number } {
  const m = 12;
  if (!box) return { left: Math.max(m, (vw - cw) / 2), top: Math.max(m, (vh - ch) / 2) };
  const clampX = (x: number) => Math.min(Math.max(m, x), Math.max(m, vw - cw - m));
  const clampY = (y: number) => Math.min(Math.max(m, y), Math.max(m, vh - ch - m));
  if (box.y + box.h + m + ch <= vh) return { left: clampX(box.x), top: box.y + box.h + m };
  if (box.y - m - ch >= 0) return { left: clampX(box.x), top: box.y - m - ch };
  if (box.x + box.w + m + cw <= vw) return { left: box.x + box.w + m, top: clampY(box.y) };
  if (box.x - m - cw >= 0) return { left: box.x - m - cw, top: clampY(box.y) };
  return { left: clampX(box.x), top: clampY(vh - ch - m) };
}

export interface SpotlightProps {
  step: TourStep;
  index: number;
  count: number;
  title: string;
  /** False while the tour is still moving to the step's page. */
  ready?: boolean;
  /** The step is on a page that just opened (look for its element for longer). */
  newPage?: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  /** The step's element is not on screen and the step may be left out. */
  onMissing?: () => void;
}

export function Spotlight({ step, index, count, title, ready = true, newPage = true, onNext, onBack, onSkip, onMissing }: SpotlightProps) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const card = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [searching, setSearching] = useState(!!step.target?.length);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState({ w: 340, h: 200 });
  const last = index >= count - 1;
  const phone = view.w < PHONE;
  const missing = useRef(onMissing);
  useEffect(() => {
    missing.current = onMissing;
  });

  // Find the step's element (it may appear a moment after the page opens), then follow it as
  // the page scrolls or changes size. (Each step is its own Spotlight: this starts empty.)
  useEffect(() => {
    if (!ready || !step.target?.length) return;
    let el: HTMLElement | null = null;
    let gone = false;
    const began = Date.now();
    let timer = 0;
    const follow = () => {
      if (!el || !el.isConnected) {
        el = findTarget(step);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
        }
      }
      if (el) {
        setBox(boxOf(el));
        setSearching(false);
      } else if (Date.now() - began > (newPage ? WAIT_NEW_PAGE : WAIT_SAME_PAGE)) {
        setSearching(false);
        if (step.skip && missing.current) {
          gone = true;
          missing.current();
          return;
        }
      }
      if (!gone) timer = window.setTimeout(follow, el ? 250 : 120);
    };
    follow();
    const onMove = () => (el ? setBox(boxOf(el)) : undefined);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      gone = true;
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [step, ready, newPage]);

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1)) setSize({ w: r.width, h: r.height });
  }, [step, box, view, size.w, size.h, searching]);

  // Focus the card on every step; give it back to what had it when the tour ends.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (before && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, [index, step]);

  // Keys: arrows move, Escape skips, Tab stays inside the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSkip();
      } else if (e.key === "ArrowRight" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft" && index > 0 && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onBack();
      } else if (e.key === "Tab" && card.current) {
        const items = [...card.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
        if (!items.length) return;
        const first = items[0]!;
        const end = items[items.length - 1]!;
        const at = document.activeElement;
        if (e.shiftKey && (at === first || at === card.current)) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && (at === end || !card.current.contains(at))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, onBack, onNext, onSkip]);

  const shown = ready && !searching;
  const pos = placeCard(box, view.w, view.h, size.w, size.h);
  const hole = box
    ? `M${box.x + 8} ${box.y}h${box.w - 16}a8 8 0 0 1 8 8v${box.h - 16}a8 8 0 0 1 -8 8h${-(box.w - 16)}a8 8 0 0 1 -8 -8v${-(box.h - 16)}a8 8 0 0 1 8 -8z`
    : "";

  return createPortal(
    <div data-tour-overlay className="fixed inset-0 z-[60]" style={{ pointerEvents: "none" }}>
      {/* The dim: everything but the hole takes the clicks (nothing happens); the hole lets
          them through to the element. */}
      <svg aria-hidden className="fixed inset-0 size-full" width={view.w} height={view.h} style={{ pointerEvents: "none" }}>
        <path
          d={`M0 0H${view.w}V${view.h}H0Z ${hole}`}
          fillRule="evenodd"
          className="fill-black/55 transition-[d] duration-200 dark:fill-black/70"
          style={{ pointerEvents: "auto" }}
          onClick={(e) => e.stopPropagation()}
        />
      </svg>
      {box ? (
        <div data-tour-ring aria-hidden className="fixed rounded-[10px] ring-2 ring-accent ring-offset-2 ring-offset-transparent transition-all duration-200 motion-safe:animate-pulse"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, pointerEvents: "none" }} />
      ) : null}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        aria-describedby="tour-step-body"
        tabIndex={-1}
        data-tour-card
        className={cn(
          "fixed grid gap-3 border border-border bg-surface p-4 text-fg shadow-[var(--shadow-pop)] outline-none transition-opacity duration-150",
          phone
            ? "inset-x-0 bottom-0 rounded-t-[var(--radius-lg)] pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "w-[min(22rem,calc(100vw-1.5rem))] rounded-[var(--radius-lg)]",
          shown ? "opacity-100" : "opacity-0",
        )}
        style={{ pointerEvents: "auto", ...(phone ? {} : { left: pos.left, top: pos.top }) }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase" aria-live="polite">
            {title} · {t("Step {n} of {total}", { n: index + 1, total: count })}
          </p>
          <button type="button" onClick={onSkip} aria-label={t("Close the tour")} title={t("Close the tour")}
            className="-mt-1.5 -mr-1.5 grid size-9 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg">
            <XIcon size={15} />
          </button>
        </div>
        <div className="grid gap-1.5">
          <h2 id="tour-step-title" className="text-[16px] leading-snug font-semibold tracking-tight">{t(step.title)}</h2>
          <p id="tour-step-body" className="text-[13.5px] leading-relaxed text-fg/85">{t(step.body)}</p>
        </div>
        {step.language ? (
          <div role="group" aria-label={t("Language")} className="flex flex-wrap gap-2">
            {/* Bahasa Melayu first: most staff read it first. */}
            {(["ms", "en"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => chooseLanguage(l)}
                className={cn("h-9 rounded-full border px-3.5 text-[13px] font-medium pointer-coarse:h-11",
                  lang === l ? "border-accent/50 bg-accent-soft text-accent" : "border-border bg-surface text-fg hover:bg-surface-2")}>
                {l === "ms" ? "Bahasa Melayu" : "English"}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onSkip} className="pointer-coarse:h-11">{t("Skip tour")}</Button>
          <span className="flex-1" />
          {index > 0 ? (
            <Button variant="outline" size="sm" onClick={onBack} className="pointer-coarse:h-11">
              <CaretLeftIcon size={14} /> {t("Back")}
            </Button>
          ) : null}
          <Button size="sm" onClick={onNext} className="pointer-coarse:h-11" data-tour-next>
            {last ? t("Finish") : <>{t("Next")} <CaretRightIcon size={14} /></>}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
