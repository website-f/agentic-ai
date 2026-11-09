/**
 * P79 "Show me on this page": the page's guide as a tour over a picture of the page itself.
 * The picture is taken the moment it opens (the same copy as a feedback screenshot); each step
 * whose element is on screen gets a numbered mark on it, and the step being read is lit while
 * the rest of the picture dims. A step whose element is scrolled away offers to go there (the
 * page scrolls and a new picture is taken); one not on the page right now says so.
 *
 * Opened from Rules & guide (core.tsx keeps the picture and finds the steps: guide-targets.ts).
 */
import { ArrowLeftIcon, ArrowRightIcon, CrosshairIcon, MapTrifoldIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import type { GuideStep, StepBox } from "./guide-targets";

export interface Tour {
  url: string;
  width: number;
  height: number;
  title: string;
  /** A recipe's name ("Set up a new office in four steps"); the page's own steps have none. */
  heading?: string;
  steps: (GuideStep & { box: StepBox | null })[];
  at: number;
}

const PAD = 6; // CSS px of light around the element

/** A rectangle with a rounded hole in it: the dimmed picture with the lit element. */
function dimPath(w: number, h: number, b: { x: number; y: number; w: number; h: number } | null, r: number): string {
  const outer = `M0 0H${w}V${h}H0Z`;
  if (!b) return outer;
  const x = b.x;
  const y = b.y;
  const rr = Math.min(r, b.w / 2, b.h / 2);
  return (
    `${outer}M${x + rr} ${y}H${x + b.w - rr}A${rr} ${rr} 0 0 1 ${x + b.w} ${y + rr}V${y + b.h - rr}` +
    `A${rr} ${rr} 0 0 1 ${x + b.w - rr} ${y + b.h}H${x + rr}A${rr} ${rr} 0 0 1 ${x} ${y + b.h - rr}V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}Z`
  );
}

export function GuideTour({ tour, moving, onBack, onClose, onGo }: { tour: Tour; moving: boolean; onBack: () => void; onClose: () => void; onGo: (i: number) => void }) {
  const t = useT();
  const phone = useIsPhone();
  const [at, setAt] = useState(tour.at);
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  }, [at]);
  const area = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const n = tour.steps.length;
  const step = tour.steps[at];
  const marked = tour.steps.filter((s) => s.box && !s.box.off).length;

  // A new picture (after going to a step) starts at that step.
  const [seen, setSeen] = useState(tour);
  if (seen !== tour) {
    setSeen(tour);
    setAt(tour.at);
  }

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / tour.width, r.height / tour.height);
      setFit({ w: Math.max(1, Math.floor(tour.width * s)), h: Math.max(1, Math.floor(tour.height * s)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tour.width, tour.height]);

  // To a step: one out of sight is gone to (the page scrolls there and a new picture is taken).
  const go = (i: number) => {
    if (moving || i < 0 || i >= n) return;
    setAt(i);
    if (tour.steps[i]?.box?.off) onGo(i);
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });

  // Arrow keys walk the steps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goRef.current(atRef.current + 1);
      else if (e.key === "ArrowLeft") goRef.current(atRef.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The step being read stays in view in the list.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-step="${at}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [at]);

  const k = fit.w ? tour.width / fit.w : 1; // picture units per screen pixel
  const lit = step?.box && !step.box.off ? { x: step.box.x - PAD, y: step.box.y - PAD, w: step.box.w + PAD * 2, h: step.box.h + PAD * 2 } : null;
  const dot = 12 * k;

  const where = (s: Tour["steps"][number]) =>
    !s.box ? t("Not on this screen right now") : s.box.off === "below" ? t("Further down the page") : s.box.off === "above" ? t("Further up the page") : null;

  const card = step ? (
    <div className="grid gap-2">
      <p className="text-[12px] font-medium text-accent">{t("Step {n} of {total}", { n: at + 1, total: n })}</p>
      <p className="text-[14px] leading-snug">{step.text}</p>
      {where(step) ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span>{where(step)}</span>
          {step.box?.off ? (
            <button type="button" onClick={() => onGo(at)} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              <CrosshairIcon size={13} /> {t("Take me there")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const steps = (
    <ol ref={list} className="grid gap-1.5">
      {tour.steps.map((s, i) => (
        <li key={`${i}-${s.text}`} data-step={i}>
          <button
            type="button"
            onClick={() => go(i)}
            aria-current={i === at ? "step" : undefined}
            className={cn(
              "flex w-full gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors",
              i === at ? "border-accent/40 bg-accent-soft/40" : "border-transparent hover:bg-surface-2",
            )}
          >
            <span
              className={cn(
                "mt-px grid size-[20px] shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular",
                i === at ? "bg-accent text-accent-fg" : "bg-surface text-accent ring-1 ring-accent/30",
              )}
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] text-fg/90">{s.text}</span>
              {where(s) ? <span className="mt-0.5 block text-[11.5px] text-muted">{where(s)}</span> : null}
            </span>
          </button>
          {i === at && s.box?.off ? (
            <button type="button" onClick={() => onGo(i)} className="mt-1 ml-[42px] inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
              <CrosshairIcon size={13} /> {t("Take me there")}
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );

  const nav = (
    <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeftIcon size={14} /> {t("Back to the guide")}
      </Button>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" disabled={at === 0 || moving} onClick={() => go(at - 1)} aria-label={t("Previous")} title={t("Previous")}>
          <ArrowLeftIcon size={14} />
        </Button>
        {at < n - 1 ? (
          <Button size="sm" loading={moving} onClick={() => go(at + 1)}>
            {t("Next")} <ArrowRightIcon size={14} />
          </Button>
        ) : (
          <Button size="sm" onClick={onClose}>{t("Done")}</Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="absolute inset-0 flex flex-col bg-neutral-950/88 backdrop-blur-sm md:flex-row">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2 md:px-5">
          <div className="min-w-0 text-white">
            <p className="truncate text-[13.5px] font-semibold">{t("Show me on this page")}</p>
            <p className="truncate text-[12px] text-white/60">
              {tour.title}
              {n ? ` · ${marked === n ? t("every step in this picture") : t("{a} of {b} steps in this picture", { a: marked, b: n })}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} title={t("Close")}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 md:hidden">
            <XIcon size={18} />
          </button>
        </div>
        <div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-3 md:px-6 md:pb-6">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.08 }}
            className="relative overflow-hidden rounded-[var(--radius-sm)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)] ring-1 ring-white/15"
            style={{ width: fit.w, height: fit.h }}
          >
            <img src={tour.url} alt={t("Screenshot of {page}", { page: tour.title })} draggable={false} className="absolute inset-0 size-full select-none" />
            <svg viewBox={`0 0 ${tour.width} ${tour.height}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
              <motion.path
                fillRule="evenodd"
                className="fill-neutral-950/55"
                initial={false}
                animate={{ d: dimPath(tour.width, tour.height, lit, 10) }}
                transition={{ type: "spring", stiffness: 220, damping: 28 }}
              />
              {lit ? (
                <motion.rect
                  className="fill-none stroke-accent"
                  strokeWidth={2.5 * k}
                  rx={10}
                  initial={false}
                  animate={{ x: lit.x, y: lit.y, width: lit.w, height: lit.h }}
                  transition={{ type: "spring", stiffness: 220, damping: 28 }}
                />
              ) : null}
              {tour.steps.map((s, i) => {
                if (!s.box || s.box.off) return null;
                const cx = Math.min(tour.width - dot, Math.max(dot, s.box.x - PAD));
                const cy = Math.min(tour.height - dot, Math.max(dot, s.box.y - PAD));
                const on = i === at;
                return (
                  <g key={i} role="button" tabIndex={-1} aria-label={t("Step {n} of {total}", { n: i + 1, total: n })} onClick={() => go(i)} className="cursor-pointer">
                    <circle cx={cx} cy={cy} r={on ? dot * 1.15 : dot} strokeWidth={2 * k} className={on ? "fill-accent stroke-white" : "fill-white stroke-accent"} />
                    <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={on ? 13 * k : 12 * k} fontWeight={700} className={on ? "fill-accent-fg" : "fill-accent"}>
                      {i + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </motion.div>
        </div>
      </div>

      <motion.aside
        initial={phone ? { y: 40, opacity: 0 } : { x: 40, opacity: 0 }}
        animate={{ x: 0, y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.12 }}
        className={cn(
          "flex shrink-0 flex-col border-border bg-surface",
          phone ? "max-h-[46dvh] rounded-t-[var(--radius-lg)] border-t pb-[env(safe-area-inset-bottom)]" : "w-[24rem] border-l",
        )}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent ring-1 ring-accent/15">
            <MapTrifoldIcon size={19} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold">{tour.heading ?? t("How to use this page")}</p>
            <p className="text-[12px] text-muted">{t("Each step is marked on the picture. Use the arrows or pick a step.")}</p>
          </div>
          {phone ? null : (
            <button type="button" onClick={onClose} aria-label={t("Close")} title={t("Close")} className="grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg">
              <XIcon size={16} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phone ? card : steps}
        </div>
        {nav}
      </motion.aside>
    </div>
  );
}
