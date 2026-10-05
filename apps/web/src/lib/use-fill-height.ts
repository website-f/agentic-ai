import { useLayoutEffect, type RefObject } from "react";

/** The fixed phone tab bar (hidden from `md` up, where it measures 0). */
function tabBarHeight(): number {
  for (const n of document.querySelectorAll<HTMLElement>("nav[aria-label=Main]")) {
    if (n.offsetHeight > 0 && getComputedStyle(n).position === "fixed") return n.offsetHeight;
  }
  return 0;
}

/** Bottom padding and borders of every box around `el`: what the page puts below it (this
 * includes the shell's room for the phone tab bar). */
function spaceBelow(el: HTMLElement): number {
  let px = 0;
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    px += parseFloat(s.paddingBottom) + parseFloat(s.borderBottomWidth);
  }
  return px;
}

export interface FillOptions {
  /** "screen" (default): down to the tab bar, less `gap`; content after it scrolls into view.
   * "page": down to the end of the page's own padding, so the page itself never scrolls. */
  fit?: "screen" | "page";
  gap?: number;
  min?: number;
  enabled?: boolean;
}

/**
 * Size an element to the screen that is left below it: from its top (as laid out, whatever the
 * scroll) to the bottom of the viewport. It writes `--fill-h` on the element as
 * `max(min, calc(100dvh - top - bottom))`, so CSS uses `h-[var(--fill-h)]` (children inherit it).
 * `dvh` follows the phone's browser bars; the measuring follows rotation, resizes and anything
 * above the element changing height (headers, banners, wrapping text).
 */
export function useFillHeight(ref: RefObject<HTMLElement | null>, { fit = "screen", gap = 16, min = 320, enabled = true }: FillOptions = {}) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let frame = 0;
    const apply = () => {
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      const bottom = Math.round(fit === "page" ? spaceBelow(el) : tabBarHeight() + gap);
      el.style.setProperty("--fill-h", `max(${min}px, calc(100dvh - ${top}px - ${bottom}px))`);
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    apply();
    const ro = new ResizeObserver(later);
    ro.observe(document.body);
    window.addEventListener("resize", later);
    window.visualViewport?.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", later);
      window.visualViewport?.removeEventListener("resize", later);
    };
  }, [ref, fit, gap, min, enabled]);
}
