/** P73: the feedback overlays (annotate, write, rules, my feedback) open as a liquid circle
 * growing out of the floating button, and shrink back into it. They are native modal
 * <dialog>s: above everything the page has open (its own dialogs and sheets too).
 *
 * They live in their own container on <body>, outside the app, because a page's own dialog
 * (Radix, vaul) turns pointer events off on <body> and watches the whole document: a press
 * outside it closes it, focus outside it is pulled back, scrolling outside it is blocked.
 * The container turns pointer events back on and keeps those events to itself, so the
 * page's dialog stays open underneath and the feedback can be typed and scrolled. */
import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Events a page's open dialog listens for on the document.
const KEEP = ["pointerdown", "mousedown", "touchstart", "focusin", "focusout", "wheel", "touchmove"] as const;
let layer: HTMLDivElement | null = null;

function feedbackLayer(): HTMLDivElement {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement("div");
  layer.setAttribute("data-feedback-ignore", "");
  layer.style.pointerEvents = "auto";
  for (const type of KEEP) layer.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  document.body.appendChild(layer);
  return layer;
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
      style={{ pointerEvents: "auto" }}
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
