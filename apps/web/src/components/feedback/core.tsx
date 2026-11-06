/**
 * P73: the floating feedback button. It sits on the right edge (drag it up or down out of the
 * way) and opens as liquid drops:
 *   - Mark up this screen: a screenshot of the page as you see it, to circle and note on;
 *   - Write feedback: in your own words, without a screenshot;
 *   - Rules & guide: what this page is for, your role, the house rules and how the system is run;
 *   - My feedback: what you sent, where it stands and the developer's answers.
 * Knows nothing of the page around it: the office (host.tsx, on every route) and the stand-alone
 * widget (feedback-widget/, inside Prima) say which page this is and what its rules panel shows.
 */
import {
  CameraIcon,
  ChatTeardropTextIcon,
  ClockCounterClockwiseIcon,
  GavelIcon,
  MegaphoneSimpleIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { msg, useLang, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { feedbackConfigQuery, feedbackKeys, sendFeedback, type FeedbackCategory, type FeedbackIn, type HouseRule } from "@/lib/feedback";
import { cn } from "@/lib/utils";

import { Annotator, composeNote, composeShot, type Mark, type Shot } from "./annotator";
import { canCaptureScreen, capturePage, captureScreen } from "./capture";
import { areaOf, boxOf, findStep, type GuideStep } from "./guide-targets";
import { GuideTour, type Tour } from "./guide-tour";
import { LiquidLayer, type Origin } from "./liquid-layer";
import { GeneralForm, MinePanel } from "./panels";

/** The page the feedback is about: its address and its name as people know it. */
export interface FeedbackPage {
  path: string;
  title: string;
}

type View = "shot" | "general" | "rules" | "mine" | "tour";

const ITEMS: { view: View; icon: Icon; label: string; hint: string }[] = [
  { view: "shot", icon: CameraIcon, label: msg("Mark up this screen"), hint: msg("Screenshot, then circle what you mean") },
  { view: "general", icon: ChatTeardropTextIcon, label: msg("Write feedback"), hint: msg("No screenshot, just tell us") },
  { view: "rules", icon: GavelIcon, label: msg("Rules & guide"), hint: msg("What this page is for, and the rules") },
  { view: "mine", icon: ClockCounterClockwiseIcon, label: msg("My feedback"), hint: msg("What you sent and the answers") },
];

// The drops fan out to the left of the button on an arc (radius 116 px), evenly spaced.
const DROPS = [-93, -31, 31, 93].map((dy) => ({ x: -Math.sqrt(116 * 116 - dy * dy), y: dy }));
const dropAt = (i: number) => DROPS[i] ?? { x: 0, y: 0 };
// The goo needs a real box to draw in: this much room around the button.
const GOO = { left: 220, top: 150, width: 240, height: 300 };

const POS_KEY = "agentic.feedback.y";
function readY(): number {
  try {
    const v = Number(localStorage.getItem(POS_KEY));
    return Number.isFinite(v) && v >= 0.12 && v <= 0.88 ? v : 0.62;
  } catch {
    return 0.62;
  }
}

/** Is one of the page's own dialogs or sheets open? (They are portalled into <body>.) */
function usePageDialog(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const check = () => setUp(!!document.querySelector('body > * [role="dialog"], body > [role="dialog"]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true });
    return () => mo.disconnect();
  }, []);
  return up;
}

/**
 * The button and everything it opens. `page` is asked each time it is needed (the page can
 * change under a button that stays mounted); `rules` draws the Rules & guide panel.
 * `onOpen` runs as the drops come out (the widget refreshes the language there).
 */
type RulesProps = { rules: HouseRule[]; onClose: () => void; onTour: (steps: GuideStep[], heading?: string) => void };

/** The page's own Rules & guide, drawn as an element (its handlers run on clicks, not while drawing). */
function RulesSlot({ render, ...p }: RulesProps & { render: (p: RulesProps) => ReactNode }) {
  return <>{render(p)}</>;
}

export function Feedback({
  page: pageOf,
  rules: rulesPanel,
  onOpen,
}: {
  page: () => FeedbackPage;
  rules: (p: RulesProps) => ReactNode;
  onOpen?: () => void;
}) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const qc = useQueryClient();
  const cfg = useQuery(feedbackConfigQuery);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false); // taking the picture
  const [shot, setShot] = useState<Shot | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const [moving, setMoving] = useState(false); // the tour taking a new picture
  const [y, setY] = useState(readY);
  const [origin, setOrigin] = useState<Origin>({ x: 0, y: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ startY: number; startV: number; moved: boolean } | null>(null);
  const page = pageOf();

  // Press: the drops come out or fold back. Coming out, the widget re-reads the page's language.
  const toggle = () => {
    if (!open) onOpen?.();
    setOpen(!open);
  };

  const where = useCallback((): Origin => {
    const r = button.current?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth - 36, y: window.innerHeight * y };
  }, [y]);

  // Escape folds the drops back.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useMutation({
    mutationFn: (body: FeedbackIn) => sendFeedback(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: feedbackKeys.mine });
      setView(null);
      toast.success(t("Thank you! Your feedback went to the developer."), { description: t("See where it stands under My feedback.") });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const context = (): FeedbackIn["context"] => ({
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: lang,
    theme: document.documentElement.dataset.theme ?? "",
    browser: navigator.userAgent.slice(0, 400),
  });

  const takeShot = async (exact = false) => {
    setOpen(false);
    setView(null);
    setBusy(true);
    // Let the drops and any panel fold away first: they are not part of the picture.
    await new Promise((r) => setTimeout(r, exact ? 120 : 260));
    try {
      const canvas = exact ? await captureScreen() : await capturePage();
      const scale = exact ? canvas.width / window.innerWidth : Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.round(canvas.width / scale);
      const height = Math.round(canvas.height / scale);
      setShot({ canvas, width, height, scale, url: canvas.toDataURL("image/png"), via: exact ? "screen" : "page" });
      setOrigin(where());
      setView("shot");
    } catch (e) {
      if (exact && e instanceof DOMException && e.name === "NotAllowedError") {
        toast(t("Screen capture was not allowed."), { description: t("Mark up this screen works without it.") });
      } else {
        toast.error(t("The screenshot did not work on this page."), {
          description: t("Send it as written feedback instead, or try Exact screen capture."),
          action: { label: t("Write feedback"), onClick: () => openView("general") },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  // P79 Show me on this page: find each step's element, then take the picture (Rules & guide
  // is left out of it, as the feedback button is) and open the tour at step `at`.
  // `again`: the tour is open and moves to a step out of sight: the page scrolls there under it
  // and the picture is taken anew, without closing (the tour is not part of the picture).
  const startTour = async (steps: GuideStep[], at = 0, heading?: string, again = false) => {
    if (again) setMoving(true);
    else {
      setView(null);
      setBusy(true);
      await new Promise((r) => setTimeout(r, 120));
    }
    try {
      const els = steps.map((s) => {
        const el = findStep(s);
        return el ? areaOf(el) : null;
      });
      // The step it opens at is in the picture: scrolled to first when it is out of sight.
      const first = els[at];
      if (first && boxOf(first).off) {
        first.scrollIntoView({ block: "center", inline: "nearest" });
        await new Promise((r) => setTimeout(r, 380));
      }
      const boxes = els.map((el) => (el ? boxOf(el) : null));
      const canvas = await capturePage({ scale: 1 });
      setTour({
        url: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
        title: pageOf().title,
        heading,
        // Each step keeps the element it was found at, so the next picture finds the same one.
        steps: steps.map((s, i) => ({ ...s, el: els[i] ?? s.el, box: boxes[i] ?? null })),
        at,
      });
      if (!again) {
        setOrigin(where());
        setView("tour");
      }
    } catch {
      toast.error(t("The picture of this page did not work."), { description: t("The steps are still listed under Rules & guide.") });
      setOrigin(where());
      setView("rules");
    } finally {
      if (again) setMoving(false);
      else setBusy(false);
    }
  };

  // A step scrolled out of sight: the page goes there, then a new picture.
  const goToStep = (i: number) => {
    if (!tour || moving) return;
    void startTour(tour.steps.map(({ box: _box, ...step }) => step), i, tour.heading, true);
  };

  const openView = (v: View) => {
    if (v === "shot") {
      void takeShot();
      return;
    }
    setOrigin(where());
    setOpen(false);
    setView(v);
  };

  const sendShot = (v: { category: FeedbackCategory; note: string; marks: Mark[] }) => {
    if (!shot) return;
    let image: string;
    try {
      image = composeShot(shot, v.marks);
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    send.mutate({
      kind: "screenshot",
      category: v.category,
      note: composeNote(v.note, v.marks),
      page_path: page.path,
      page_title: page.title,
      marks: v.marks.length,
      screenshot: image,
      context: { ...context(), viewport: `${shot.width}x${shot.height}` },
    });
  };

  const sendGeneral = (v: { category: FeedbackCategory; note: string; aboutPage: boolean }) =>
    send.mutate({
      kind: "general",
      category: v.category,
      note: v.note.trim(),
      page_path: v.aboutPage ? page.path : "",
      page_title: v.aboutPage ? page.title : "",
      marks: 0,
      screenshot: null,
      context: context(),
    });

  // The button moves up and down the right edge when dragged; a short press opens it.
  const onDown = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { startY: e.clientY, startV: y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    setOpen(false);
    setY(Math.max(0.12, Math.min(0.88, d.startV + dy / window.innerHeight)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      try {
        localStorage.setItem(POS_KEY, String(y));
      } catch {
        /* storage blocked: it stays there for this visit */
      }
    } else toggle();
  };

  const closeView = useCallback(() => setView(null), []);
  const backToGuide = useCallback(() => setView("rules"), []);
  // Free the picture's memory once the circle has shrunk away.
  useEffect(() => {
    if (view === "shot" || !shot) return;
    const id = setTimeout(() => setShot(null), 600);
    return () => clearTimeout(id);
  }, [view, shot]);
  useEffect(() => {
    if (view === "tour" || !tour) return;
    const id = setTimeout(() => setTour(null), 600);
    return () => clearTimeout(id);
  }, [view, tour]);

  const showButton = !busy && !view;
  // Over the page's own dialogs and sheets the button steps back (smaller, see-through) until
  // pointed at, so it never hides what the dialog shows.
  const dialogUp = usePageDialog();
  const quiet = dialogUp && !open;

  return (
    <>
      {/* The goo: the drops melt into the button and out of it. */}
      <svg aria-hidden width="0" height="0" className="pointer-events-none fixed" data-feedback-ignore="">
        <defs>
          <filter id="feedback-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="catch"
            data-feedback-ignore=""
            className="fixed inset-0 z-[69] bg-neutral-950/10"
            style={{ pointerEvents: "auto" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
        ) : null}
      </AnimatePresence>

      <div
        data-feedback-ignore=""
        className={cn(
          "fixed right-3 z-[70] size-0 transition-[opacity,scale] duration-200 md:right-4",
          !showButton ? "pointer-events-none opacity-0" : quiet ? "scale-[0.72] opacity-45 hover:scale-100 hover:opacity-100 focus-within:scale-100 focus-within:opacity-100" : "opacity-100",
        )}
        style={{ top: `${y * 100}%`, pointerEvents: showButton ? "auto" : "none" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Liquid layer: plain colour shapes only, blurred together by the goo filter. */}
        <div aria-hidden className="pointer-events-none absolute" style={{ left: -GOO.left, top: -GOO.top, width: GOO.width, height: GOO.height, filter: "url(#feedback-goo)" }}>
          <div className="absolute size-0" style={{ left: GOO.left, top: GOO.top }}>
          <motion.span
            className="absolute -top-7 -left-14 block size-14 rounded-full bg-accent"
            animate={{ scale: open ? 1.06 : 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 18 }}
          />
          {ITEMS.map((it, i) => {
            const p = dropAt(i);
            return (
              <motion.span
                key={it.view}
                className="absolute -top-[22px] -left-[50px] block size-11 rounded-full bg-accent"
                initial={false}
                animate={open ? { x: p.x, y: p.y, scale: 1 } : { x: 0, y: 0, scale: 0.3 }}
                transition={{ type: "spring", stiffness: 330, damping: open ? 17 : 26, delay: open ? i * 0.05 : (ITEMS.length - i) * 0.025 }}
              />
            );
          })}
          </div>
        </div>

        {/* Content layer: the icons and labels, crisp above the goo. */}
        {ITEMS.map((it, i) => {
          const p = dropAt(i);
          return (
            <motion.div
              key={it.view}
              className="absolute -top-[22px] -left-[50px] flex items-center"
              initial={false}
              animate={open ? { x: p.x, y: p.y, opacity: 1, scale: 1 } : { x: 0, y: 0, opacity: 0, scale: 0.4 }}
              transition={{ type: "spring", stiffness: 330, damping: open ? 17 : 26, delay: open ? i * 0.05 : 0 }}
              style={{ pointerEvents: open ? "auto" : "none" }}
            >
              <motion.span
                className="pointer-events-none absolute right-[calc(100%+10px)] w-max rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-1.5 text-right shadow-[var(--shadow-pop)]"
                // Never past the left edge of a phone: wrap within the room left of the drop.
                style={{ maxWidth: `min(15rem, calc(100vw - ${Math.round(Math.abs(p.x) + 100)}px))` }}
                initial={false}
                animate={open ? { opacity: 1, x: 0 } : { opacity: 0, x: 10 }}
                transition={{ delay: open ? 0.12 + i * 0.05 : 0, duration: 0.18 }}
              >
                <span className="block text-[13px] font-semibold leading-tight">{t(it.label)}</span>
                <span className="block text-[11.5px] leading-tight text-muted">{t(it.hint)}</span>
              </motion.span>
              <button
                type="button"
                tabIndex={open ? 0 : -1}
                onClick={() => openView(it.view)}
                aria-label={t(it.label)}
                className="grid size-11 place-items-center rounded-full text-accent-fg outline-none focus-visible:ring-2 focus-visible:ring-fg/60"
              >
                <it.icon size={20} weight="bold" />
              </button>
            </motion.div>
          );
        })}

        <button
          ref={button}
          type="button"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
          aria-expanded={open}
          aria-label={open ? t("Close feedback") : t("Feedback")}
          title={open ? t("Close feedback") : t("Feedback: tell us about this page (drag to move)")}
          className="group absolute -top-7 -left-14 grid size-14 touch-none place-items-center rounded-full text-accent-fg shadow-[0_10px_30px_-8px_color-mix(in_oklab,var(--accent)_70%,transparent)] outline-none select-none focus-visible:ring-2 focus-visible:ring-fg/60 focus-visible:ring-offset-2"
        >
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ type: "spring", stiffness: 380, damping: 20 }} className="grid place-items-center">
            {open ? <XIcon size={22} weight="bold" /> : <MegaphoneSimpleIcon size={23} weight="fill" className="transition-transform group-hover:-rotate-12" />}
          </motion.span>
          {/* A gentle ripple so people notice it the first time. */}
          {!open ? <span aria-hidden className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-accent/30 [animation-duration:2.6s] [animation-iteration-count:3]" /> : null}
        </button>
      </div>

      {busy ? (
        <div data-feedback-ignore="" className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+1rem)] z-[70] flex justify-center">
          <span className="rounded-full bg-neutral-900/90 px-4 py-2 text-[13px] font-medium text-white shadow-lg">{t("Taking the screenshot…")}</span>
        </div>
      ) : null}

      <LiquidLayer open={view === "shot" && !!shot} origin={origin} onClose={closeView} label={t("Mark up this screen")}>
        {shot ? (
          <Annotator
            shot={shot}
            pageLabel={page.title}
            onCancel={closeView}
            onSend={sendShot}
            sending={send.isPending}
            onRetakeScreen={canCaptureScreen() && shot.via === "page" ? () => void takeShot(true) : undefined}
          />
        ) : null}
      </LiquidLayer>
      <LiquidLayer open={view === "general"} origin={origin} onClose={closeView} label={t("Write feedback")}>
        <GeneralForm pageLabel={page.title} sending={send.isPending} onSend={sendGeneral} onScreenshot={() => void takeShot()} onClose={closeView} />
      </LiquidLayer>
      <LiquidLayer open={view === "rules"} origin={origin} onClose={closeView} label={t("Rules & guide")}>
        <RulesSlot render={rulesPanel} rules={cfg.data?.rules ?? []} onClose={closeView} onTour={(steps, heading) => void startTour(steps, 0, heading)} />
      </LiquidLayer>
      <LiquidLayer open={view === "tour" && !!tour} origin={origin} onClose={closeView} label={t("Show me on this page")}>
        {tour ? <GuideTour tour={tour} moving={moving} onBack={backToGuide} onClose={closeView} onGo={goToStep} /> : null}
      </LiquidLayer>
      <LiquidLayer open={view === "mine"} origin={origin} onClose={closeView} label={t("My feedback")}>
        <MinePanel onClose={closeView} onNew={() => setView("general")} />
      </LiquidLayer>
    </>
  );
}
