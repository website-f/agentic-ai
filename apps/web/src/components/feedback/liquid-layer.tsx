/** P73: the feedback overlays (annotate, write, rules, my feedback) open as a liquid circle
 * growing out of the floating button, and shrink back into it. They are native modal
 * <dialog>s: above everything the page has open (its own dialogs and sheets too).
 *
 * They live in their own container on <body>, outside the app, because a page's own dialog
 * (Radix, vaul) turns pointer events off on <body> and watches the whole document: a press
 * outside it closes it, focus outside it is pulled back, scrolling outside it is blocked.
 * The container turns pointer events back on and keeps those events to itself, so the
 * page's dialog stays open underneath and the feedback can be typed and scrolled.
 *
 * P93: on a phone the layer is as tall as what can be seen (the visual viewport): when the
 * on-screen keyboard comes up it shrinks to the part above the keyboard, so a sheet's own
 * scrolling and its footer (Send) stay in reach. Escape, and the phone's Back button (Chrome on
 * Android closes a modal <dialog> with it), ask to close. */
import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Events a page's open dialog listens for on the document.
const KEEP = ["pointerdown", "mousedown", "touchstart", "focusin", "focusout", "wheel", "touchmove"] as const;
let layer: HTMLDivElement | null = null;
let parent: Element | null = null;

/** Where the overlays go: <body> in the office; the widget's own shadow root elsewhere (Prima),
 * so they wear the office's styles and the host page's styles stay out. */
export function setFeedbackLayerParent(el: Element | null): void {
  parent = el;
  layer = null;
}

function feedbackLayer(): HTMLDivElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement("div");
  layer.setAttribute("data-feedback-ignore", "");
  layer.style.pointerEvents = "auto";
  for (const type of KEEP) layer.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  (parent ?? document.body).appendChild(layer);
  return layer;
}

/** The part of the screen that can be seen, when the on-screen keyboard (or a browser bar) hides
 * some of it: its height and how far down it starts. null: all of it can be seen, or the person
 * has zoomed in (then the layer stays full size and the browser pans over it as usual). */
export interface Visible {
  height: number;
  top: number;
}

export function readVisible(win: Window = window): Visible | null {
  const vv = win.visualViewport;
  if (!vv) return null;
  if (vv.scale > 1.01) return null; // zoomed in: not the keyboard
  const height = Math.round(vv.height);
  const top = Math.max(0, Math.round(vv.offsetTop));
  // Within a couple of pixels of the whole window: nothing hidden.
  if (top < 2 && height >= win.innerHeight - 2) return null;
  return { height, top };
}

/** readVisible(), kept up to date while `active`. */
export function useVisible(active: boolean): Visible | null {
  const [vis, setVis] = useState<Visible | null>(() => (active && typeof window !== "undefined" ? readVisible() : null));
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = readVisible();
        setVis((was) => (was?.height === next?.height && was?.top === next?.top ? was : next));
      });
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [active]);
  return active ? vis : null;
}

/** The text field that has focus, inside the feedback layer (also in the widget's shadow root). */
function activeField(): HTMLElement | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!(el instanceof HTMLElement) || !layer?.contains(el)) return null;
  return el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el : null;
}

export interface Origin {
  x: number;
  y: number;
}

export function LiquidLayer({
  open,
  origin,
  onClose,
  label,
  children,
}: {
  open: boolean;
  origin: Origin;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState(open);
  const vis = useVisible(shown);
  // The keyboard came up or went down (the layer is drawn at its new size by now): what is being
  // typed in stays in sight.
  useEffect(() => {
    if (vis) activeField()?.scrollIntoView?.({ block: "nearest" });
  }, [vis]);
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  if (open && !shown) setShown(true);

  useEffect(() => {
    const d = ref.current;
    if (!d || !shown) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute("open", "");
      }
    }
  }, [open, shown]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // Escape asks to close; the circle shrinks first, then the dialog closes.
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener("cancel", cancel);
    return () => d.removeEventListener("cancel", cancel);
  }, [onClose, shown]);

  if (!shown) return null;
  const host = feedbackLayer();
  const far = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y)) + 40;
  return createPortal(
    <dialog
      ref={ref}
      aria-label={label}
      data-feedback-ignore=""
      data-visible={vis ? "part" : "all"}
      style={{ pointerEvents: "auto", ...(vis ? { top: vis.top, height: vis.height, bottom: "auto" } : null) }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-fg outline-none backdrop:bg-transparent"
    >
      <motion.div
        className="absolute inset-0"
        initial={reduce ? { opacity: 0 } : { clipPath: `circle(0px at ${origin.x}px ${origin.y}px)` }}
        animate={
          reduce
            ? { opacity: open ? 1 : 0 }
            : { clipPath: `circle(${open ? far : 0}px at ${origin.x}px ${origin.y}px)` }
        }
        transition={open ? { type: "spring", stiffness: 120, damping: 20, mass: 0.9 } : { duration: 0.32, ease: [0.6, 0, 0.4, 1] }}
        onAnimationComplete={() => {
          if (open) return;
          const d = ref.current;
          if (d?.open) d.close();
          setShown(false);
        }}
      >
        {children}
      </motion.div>
    </dialog>,
    host,
  );
}
