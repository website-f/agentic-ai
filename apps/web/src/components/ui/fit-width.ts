/**
 * Content-aware width for side sheets and dialogs.
 *
 * A panel starts at its normal width (set by its classes). When something inside would scroll
 * sideways (a wide table, a screenshot, a long unbroken line), the panel widens just enough to
 * show it, up to `min(72rem, 100vw - 2rem)`; markdown tables and code blocks count at their
 * unwrapped width.
 * Past that cap the content has to wrap, which `SHEET_BODY` below makes it do. Nothing in a
 * sheet scrolls sideways. On phones (full-width bottom sheets) it only does the table fallback.
 *
 * Used as a React 19 callback ref (it returns its own cleanup): no state, no effect, no re-render.
 */

const MAX_REM = 72;
const GUTTER_REM = 2;

/** Strips that scroll sideways on purpose (tab bars, chip rows) hide their scrollbar: skip those. */
function scrollsOnPurpose(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  return cs.scrollbarWidth === "none" || el.hasAttribute("data-scroll-x");
}

/** How many px the widest sideways-overflowing box inside `root` is short of. */
function horizontalShortfall(root: HTMLElement): number {
  let short = 0;
  const all = root.getElementsByTagName("*");
  for (let i = -1; i < all.length; i++) {
    const el = i < 0 ? root : all[i];
    if (!(el instanceof HTMLElement) || el.clientWidth === 0) continue;
    const d = el.scrollWidth - el.clientWidth;
    if (d <= 1 || d <= short) continue;
    const cs = getComputedStyle(el);
    // The sheet body clips sideways overflow (it never scrolls that way), so it counts too.
    if (!el.hasAttribute("data-sheet-body")) {
      if (cs.overflowX !== "auto" && cs.overflowX !== "scroll") continue;
      if (scrollsOnPurpose(el, cs)) continue;
    }
    // scrollWidth leaves out the box's own end padding: add it, or the content ends flush
    // against the edge and a table still wraps by those few pixels.
    short = Math.max(short, d + (parseFloat(cs.paddingRight) || 0));
  }
  return short;
}

export function fitWidth(panel: HTMLElement | null): (() => void) | undefined {
  if (!panel || typeof MutationObserver === "undefined" || typeof requestAnimationFrame === "undefined") return undefined;
  let frame = 0;
  let viewport = window.innerWidth;

  const measure = () => {
    frame = 0;
    if (!panel.isConnected) return stop();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const cap = Math.min(MAX_REM * rem, window.innerWidth - GUTTER_REM * rem);
    // Start from the natural width every time, so the panel narrows again when the wide content
    // goes away (another tab, a collapsed section). Layout is read synchronously and nothing is
    // painted in between, so this does not flicker.
    const tables = Array.from(panel.querySelectorAll<HTMLElement>(".md table"));
    const code = Array.from(panel.querySelectorAll<HTMLElement>(".md pre"));
    panel.style.minWidth = "";
    for (const t of tables) delete t.dataset.stack;
    const natural = panel.offsetWidth;
    if (natural < cap) {
      // The width the content would like: markdown tables and code blocks unwrapped, everything
      // else as laid out. They are put back (wrapping) right after measuring.
      for (const t of tables) Object.assign(t.style, { width: "max-content", maxWidth: "none" });
      for (const c of code) Object.assign(c.style, { whiteSpace: "pre", overflowWrap: "normal" });
      let short = horizontalShortfall(panel);
      for (const t of tables) Object.assign(t.style, { width: "", maxWidth: "" });
      for (const c of code) Object.assign(c.style, { whiteSpace: "", overflowWrap: "" });
      // Text reflows at each new width, so further passes catch content that needed a bit more.
      for (let pass = 0; pass < 3 && short > 1; pass++) {
        // +2px: offsetWidth and scrollWidth are rounded, and a table 0.4px short wraps a cell.
        const width = Math.min(cap, Math.ceil(panel.offsetWidth + short) + 2);
        if (width <= panel.offsetWidth) break;
        panel.style.minWidth = `${width}px`;
        if (width >= cap) break;
        short = horizontalShortfall(panel);
      }
    }
    // A table that still does not fit (the panel is at its cap, or a bottom sheet on a phone) is
    // shown as stacked cards, one per row, instead of scrolling sideways or crushing its columns.
    for (const t of tables) if (t.scrollWidth > t.clientWidth + 1) t.dataset.stack = "";
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const onResize = () => {
    if (!panel.isConnected) return stop();
    if (window.innerWidth === viewport) return;
    viewport = window.innerWidth;
    schedule();
  };

  // Content changes (data arriving, tabs, sections opening) and images finishing loading. The
  // panel's own `style` is not watched: this function writes it.
  const mutations = new MutationObserver(schedule);
  mutations.observe(panel, { childList: true, subtree: true, characterData: true, attributeFilter: ["class", "open", "data-state", "src"] });
  panel.addEventListener("load", schedule, true);
  window.addEventListener("resize", onResize);
  schedule();

  // React 19 calls this cleanup. Some wrappers (vaul) drop it and pass `null` instead: then the
  // next frame or resize after the panel left the page cleans up.
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    mutations.disconnect();
    panel?.removeEventListener("load", schedule, true);
    window.removeEventListener("resize", onResize);
  }
  return stop;
}

/**
 * Classes for a sheet's or dialog's scrolling body. It scrolls down, never sideways: long words,
 * ids and links break, and code and pre-formatted text wrap. A markdown table that does not fit
 * even at the widest the panel may get (`data-stack`, set by `fitWidth`), or any markdown table in
 * a phone-narrow body, becomes stacked cards: one per row, each cell as "Column  value" (the
 * column labels come from `Markdown`). Tailwind needs literal class names, hence the repetition.
 */
export const SHEET_BODY = [
  "@container min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto break-words",
  "[&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_.md_table]:max-w-full",
  // Stacked table cards: tables flagged by fitWidth.
  "[&_.md_table[data-stack]_thead]:hidden [&_.md_table[data-stack]_tbody]:grid [&_.md_table[data-stack]_tbody]:gap-2",
  "[&_.md_table[data-stack]_tr]:grid [&_.md_table[data-stack]_tr]:overflow-hidden [&_.md_table[data-stack]_tr]:rounded-sm [&_.md_table[data-stack]_tr]:border [&_.md_table[data-stack]_tr]:border-border",
  "[&_.md_table[data-stack]_td]:grid [&_.md_table[data-stack]_td]:min-w-0 [&_.md_table[data-stack]_td]:grid-cols-[minmax(0,min(40%,12rem))_minmax(0,1fr)] [&_.md_table[data-stack]_td]:gap-3 [&_.md_table[data-stack]_td]:border-0 [&_.md_table[data-stack]_td]:border-b [&_.md_table[data-stack]_td:last-child]:border-b-0",
  "[&_.md_table[data-stack]_td]:before:content-[attr(data-label)] [&_.md_table[data-stack]_td]:before:font-medium [&_.md_table[data-stack]_td]:before:text-muted",
  // Stacked table cards: every markdown table below 26rem of body width.
  "@max-[26rem]:[&_.md_thead]:hidden @max-[26rem]:[&_.md_tbody]:grid @max-[26rem]:[&_.md_tbody]:gap-2",
  "@max-[26rem]:[&_.md_tr]:grid @max-[26rem]:[&_.md_tr]:overflow-hidden @max-[26rem]:[&_.md_tr]:rounded-sm @max-[26rem]:[&_.md_tr]:border @max-[26rem]:[&_.md_tr]:border-border",
  "@max-[26rem]:[&_.md_td]:grid @max-[26rem]:[&_.md_td]:min-w-0 @max-[26rem]:[&_.md_td]:grid-cols-[minmax(0,min(40%,12rem))_minmax(0,1fr)] @max-[26rem]:[&_.md_td]:gap-3 @max-[26rem]:[&_.md_td]:border-0 @max-[26rem]:[&_.md_td]:border-b @max-[26rem]:[&_.md_td:last-child]:border-b-0",
  "@max-[26rem]:[&_.md_td]:before:content-[attr(data-label)] @max-[26rem]:[&_.md_td]:before:font-medium @max-[26rem]:[&_.md_td]:before:text-muted",
].join(" ");
