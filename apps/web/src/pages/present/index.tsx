/** The client presentation, full screen without the app shell (signed in).
 *
 * Landscape screens: a 1600x900 stage scaled to fit, one slide at a time. Arrow keys, Space,
 * PageUp/PageDown, Home/End, swipe, or click the left/right half to move; N notes, O overview,
 * F full screen, Esc closes the overview. /present?s=5 opens slide 5.
 * Portrait phones and small windows: the slides stack as cards you scroll.
 * Print (Ctrl+P -> Save as PDF): one slide per landscape page in the brand look. */
import {
  ArrowLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CornersInIcon,
  CornersOutIcon,
  NotepadIcon,
  PrinterIcon,
  SquaresFourIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { LogoMark } from "@/components/logo";
import { useManifest } from "@/guide/data";
import { useSlides } from "@/guide/lang";
import type { GuideManifest } from "@/guide/manifest";
import { SLIDES } from "@/guide/slides";
import { useT } from "@/i18n";
import { meQuery } from "@/lib/queries";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { SlideView, type Presenter } from "./slide";

const W = 1600;
const H = 900;
// Every language has the same slides (content-parity.test.ts), so the count is fixed.
const TOTAL = SLIDES.length;

const PRINT_CSS = `
@page { size: ${W}px ${H}px; margin: 0; }
@media print {
  html, body, #root { height: auto !important; background: var(--bg) !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .present-screen { display: none !important; }
  .present-print { display: block !important; }
  .present-print > section { width: ${W}px; height: ${H}px; overflow: hidden; break-after: page; page-break-after: always; }
  .present-print > section:last-child { break-after: auto; page-break-after: auto; }
}`;

/** Measures a box with a ResizeObserver (React 19 ref cleanup). */
function useBoxSize() {
  const [size, setSize] = useState({ w: W, h: H });
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function useFullscreen() {
  const [on, setOn] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const supported = typeof document !== "undefined" && !!document.fullscreenEnabled;
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  return { on, supported, toggle };
}

/** The print copy mounts once the screen has settled (so its images are cached by Ctrl+P),
 * or right before printing. */
function usePrintDeck() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 2500);
    const before = () => flushSync(() => setMounted(true));
    window.addEventListener("beforeprint", before);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("beforeprint", before);
    };
  }, []);
  return mounted;
}

function PrintDeck({ manifest, presenter }: { manifest: GuideManifest | null; presenter: Presenter }) {
  const slides = useSlides();
  return (
    <div className="present-print hidden" aria-hidden>
      {slides.map((s, i) => (
        <section key={s.id}>
          <SlideView slide={s} index={i} total={TOTAL} manifest={manifest} presenter={presenter} eager />
        </section>
      ))}
    </div>
  );
}

function IconButton({ label, onClick, active, children, className }: { label: string; onClick: () => void; active?: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full transition-colors",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Every slide as a small picture; click one to jump there. */
function Overview({ index, manifest, presenter, onPick, onClose }: { index: number; manifest: GuideManifest | null; presenter: Presenter; onPick: (i: number) => void; onClose: () => void }) {
  const t = useT();
  const slides = useSlides();
  const [ref, size] = useBoxSize();
  const cols = size.w >= 1200 ? 4 : size.w >= 820 ? 3 : 2;
  const gap = 16;
  const thumbW = Math.max(120, (size.w - gap * (cols - 1)) / cols);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-md"
      role="dialog"
      aria-label={t("All slides")}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <p className="text-[14px] font-semibold">{t("All slides")}</p>
        <IconButton label={t("Close overview (Esc)")} onClick={onClose}>
          <XIcon size={18} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <div ref={ref} className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(i)}
              className={cn(
                "group grid gap-2 rounded-[var(--radius-md)] p-1.5 text-left transition-colors",
                i === index ? "bg-accent-soft ring-2 ring-accent" : "hover:bg-surface-2",
              )}
            >
              <span className="relative block overflow-hidden rounded-[8px] border border-border" style={{ height: ((thumbW - 12) * H) / W }}>
                <span className="absolute top-0 left-0 block origin-top-left" style={{ width: W, height: H, transform: `scale(${(thumbW - 12) / W})` }}>
                  <SlideView slide={s} index={i} total={TOTAL} manifest={manifest} presenter={presenter} />
                </span>
              </span>
              <span className="flex min-w-0 items-baseline gap-2 px-1 text-[12.5px]">
                <span className="font-semibold text-muted tabular">{i + 1}</span>
                <span className="truncate">{s.title}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------- stage (landscape)

function StageDeck({ index, go, manifest, presenter }: { index: number; go: (i: number) => void; manifest: GuideManifest | null; presenter: Presenter }) {
  const t = useT();
  const slides = useSlides();
  const [ref, box] = useBoxSize();
  const [notes, setNotes] = useState(false);
  const [overview, setOverview] = useState(false);
  const [dir, setDir] = useState(1);
  const [touch, setTouch] = useState<{ x: number; y: number } | null>(null);
  const fs = useFullscreen();
  const reduce = useReducedMotion();
  const scale = Math.min(box.w / W, box.h / H);
  const slide = slides[index]!;

  const move = useCallback(
    (to: number) => {
      const n = Math.max(0, Math.min(TOTAL - 1, to));
      if (n === index) return;
      setDir(n > index ? 1 : -1);
      go(n);
    },
    [go, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = e.key;
      if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") move(index + 1);
      else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") move(index - 1);
      else if (k === "Home") move(0);
      else if (k === "End") move(TOTAL - 1);
      else if (k === "n" || k === "N") setNotes((v) => !v);
      else if (k === "o" || k === "O") setOverview((v) => !v);
      else if (k === "f" || k === "F") fs.toggle();
      else if (k === "Escape") setOverview(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, move, fs]);

  /** Click the left half to go back, the right half to go on (not on controls or videos). */
  const onStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, a, video, input, textarea")) return;
    const r = e.currentTarget.getBoundingClientRect();
    move(e.clientX - r.left < r.width / 2 ? index - 1 : index + 1);
  };

  return (
    <div className="present-screen fixed inset-0 flex flex-col bg-surface-2 text-fg select-none">
      <div className="absolute inset-x-0 top-0 z-20 h-[3px] bg-border/60">
        <motion.div
          className="h-full bg-accent"
          initial={false}
          animate={{ width: `${((index + 1) / TOTAL) * 100}%` }}
          transition={{ duration: reduce ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <div
        ref={ref}
        className="relative min-h-0 flex-1 cursor-pointer overflow-hidden"
        onClick={onStageClick}
        onTouchStart={(e) => setTouch({ x: e.touches[0]!.clientX, y: e.touches[0]!.clientY })}
        onTouchEnd={(e) => {
          if (!touch) return;
          const dx = e.changedTouches[0]!.clientX - touch.x;
          const dy = e.changedTouches[0]!.clientY - touch.y;
          setTouch(null);
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? index + 1 : index - 1);
        }}
      >
        <div
          className="absolute top-1/2 left-1/2 overflow-hidden rounded-[10px] shadow-[var(--shadow-pop)]"
          style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <AnimatePresence initial={false} custom={dir}>
            <motion.div
              key={slide.id}
              custom={dir}
              className="absolute inset-0"
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -60 }}
              transition={{ duration: reduce ? 0.15 : 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <SlideView slide={slide} index={index} total={TOTAL} manifest={manifest} presenter={presenter} live />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {notes ? (
          <motion.aside
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden border-t border-border bg-surface"
            aria-label={t("Presenter notes")}
          >
            <div className="mx-auto grid max-h-[26dvh] max-w-5xl gap-1.5 overflow-y-auto px-6 py-4">
              <p className="text-[11.5px] font-semibold tracking-[0.08em] text-accent uppercase">{t("Notes · slide {n}", { n: index + 1 })}</p>
              <p className="text-[16px] leading-relaxed">{slide.notes}</p>
              {slides[index + 1] ? <p className="text-[13px] text-muted">{t("Next: {title}", { title: slides[index + 1]!.title })}</p> : null}
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <div className="flex h-14 shrink-0 items-center gap-1 border-t border-border bg-surface px-2 sm:px-4">
        <Link to="/" className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg" title={t("Back to the office")}>
          <ArrowLeftIcon size={16} />
          <span className="hidden sm:inline">{t("Exit")}</span>
        </Link>
        <div className="flex flex-1 items-center justify-center gap-1">
          <IconButton label={t("Previous slide")} onClick={() => move(index - 1)}>
            <CaretLeftIcon size={18} weight="bold" />
          </IconButton>
          <span className="min-w-16 text-center text-[13px] font-medium tabular">
            {index + 1} / {TOTAL}
          </span>
          <IconButton label={t("Next slide")} onClick={() => move(index + 1)}>
            <CaretRightIcon size={18} weight="bold" />
          </IconButton>
        </div>
        <IconButton label={t("Presenter notes (N)")} onClick={() => setNotes((v) => !v)} active={notes}>
          <NotepadIcon size={18} />
        </IconButton>
        <IconButton label={t("All slides (O)")} onClick={() => setOverview(true)} active={overview}>
          <SquaresFourIcon size={18} />
        </IconButton>
        <IconButton label={t("Print or save as PDF")} onClick={() => window.print()} className="max-sm:hidden">
          <PrinterIcon size={18} />
        </IconButton>
        {fs.supported ? (
          <IconButton label={fs.on ? t("Leave full screen (F)") : t("Full screen (F)")} onClick={fs.toggle} active={fs.on}>
            {fs.on ? <CornersInIcon size={18} /> : <CornersOutIcon size={18} />}
          </IconButton>
        ) : null}
      </div>

      <AnimatePresence>
        {overview ? (
          <Overview
            index={index}
            manifest={manifest}
            presenter={presenter}
            onClose={() => setOverview(false)}
            onPick={(i) => {
              setOverview(false);
              move(i);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------- read (portrait phones)

function ReadDeck({ index, manifest, presenter }: { index: number; manifest: GuideManifest | null; presenter: Presenter }) {
  const t = useT();
  const slides = useSlides();
  const [current, setCurrent] = useState(index);
  const [notes, setNotes] = useState(false);
  const [overview, setOverview] = useState(false);

  /** Follows the slide in view, and scrolls to the deep-linked one on open. */
  const list = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const sections = Array.from(el.querySelectorAll<HTMLElement>("[data-slide]"));
      // After the router's own scroll restoration has run.
      const t = index > 0 ? window.setTimeout(() => sections[index]?.scrollIntoView({ block: "start" }), 120) : 0;
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset.slide));
        },
        { rootMargin: "-45% 0px -50% 0px" },
      );
      sections.forEach((s) => io.observe(s));
      return () => {
        window.clearTimeout(t);
        io.disconnect();
      };
    },
    // Only on mount: the deep link is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const jump = (i: number) => {
    setOverview(false);
    document.querySelector(`[data-slide="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="present-screen min-h-dvh bg-surface-2 text-fg">
      <header
        className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <Link to="/" aria-label={t("Back to the office")} className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-2">
            <ArrowLeftIcon size={18} />
          </Link>
          <LogoMark className="size-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">Agentic Office</p>
            <p className="text-[12px] text-muted tabular">
              {t("Slide {n} of {total}", { n: current + 1, total: TOTAL })}
            </p>
          </div>
          <IconButton label={t("Presenter notes")} onClick={() => setNotes((v) => !v)} active={notes}>
            <NotepadIcon size={18} />
          </IconButton>
          <IconButton label={t("All slides")} onClick={() => setOverview(true)}>
            <SquaresFourIcon size={18} />
          </IconButton>
        </div>
        <div className="h-[3px] bg-border/60">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${((current + 1) / TOTAL) * 100}%` }} />
        </div>
      </header>
      <div ref={list} className="mx-auto grid max-w-2xl gap-4 px-4 py-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}>
        {slides.map((s, i) => (
          <section key={s.id} data-slide={i} className="grid scroll-mt-20 gap-2">
            <p className="px-1 text-[11.5px] font-medium text-muted tabular">
              {i + 1} / {TOTAL}
            </p>
            <SlideView slide={s} index={i} total={TOTAL} manifest={manifest} presenter={presenter} read />
            {notes ? (
              <p className="rounded-[var(--radius-md)] border border-dashed border-border bg-surface px-3.5 py-3 text-[13.5px] leading-relaxed text-muted">
                <span className="font-semibold text-accent">{t("Notes:")} </span>
                {s.notes}
              </p>
            ) : null}
          </section>
        ))}
      </div>
      <AnimatePresence>
        {overview ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-label={t("All slides")}
            className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-md"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
              <p className="text-[14px] font-semibold">{t("All slides")}</p>
              <IconButton label={t("Close")} onClick={() => setOverview(false)}>
                <XIcon size={18} />
              </IconButton>
            </div>
            <ol className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
              {slides.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-[14px]",
                      i === current ? "bg-accent-soft font-medium text-accent" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="w-6 shrink-0 text-right text-[12.5px] text-muted tabular">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{s.eyebrow}</span>
                      <span className="block break-words">{s.title}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------- route component

export function PresentPage() {
  const t = useT();
  const slides = useSlides();
  const { s } = useSearch({ from: "/present" });
  const navigate = useNavigate();
  const { data: me } = useSuspenseQuery(meQuery);
  const manifest = useManifest();
  const printDeck = usePrintDeck();
  // Portrait phones, tablets in portrait and very short windows read better as stacked cards.
  const read = useMedia("(max-width: 900px) and (orientation: portrait), (max-width: 640px), (max-height: 460px)");
  const index = Math.max(0, Math.min(TOTAL - 1, (s ?? 1) - 1));
  const presenter: Presenter = { name: me.user.name, email: me.user.email, workspace: me.workspace.name };
  const go = useCallback((i: number) => void navigate({ to: "/present", search: { s: i + 1 }, replace: true }), [navigate]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${slides[index]?.title ?? t("Presentation")} · Agentic Office`;
    return () => {
      document.title = prev;
    };
  }, [index, slides, t]);

  return (
    <>
      <style>{PRINT_CSS}</style>
      {read ? (
        <ReadDeck index={index} manifest={manifest} presenter={presenter} />
      ) : (
        <StageDeck index={index} go={go} manifest={manifest} presenter={presenter} />
      )}
      {printDeck ? <PrintDeck manifest={manifest} presenter={presenter} /> : null}
    </>
  );
}
