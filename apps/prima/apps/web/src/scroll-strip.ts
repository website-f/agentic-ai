/**
 * P90 (Fitri, 9 Nov 2026): section tabs and filter chips that run off the side of the screen could only be swiped on a
 * phone; on a computer the last tabs could not be reached. Every sideways strip on every screen now gets, without
 * changing the screens:
 *   - faded edges and round arrow buttons, only on the side where more tabs are hidden (click to scroll a page)
 *   - the mouse wheel scrolls it sideways while the pointer is over it (the page scrolls again at either end)
 *   - drag with the mouse to scroll it, without the drag counting as a click on a tab
 *   - the chosen tab is brought into view when the screen opens and when it changes
 *   - arrow keys, Home and End move between the tabs; the focused tab is kept in view
 * A strip is any element below that scrolls sideways (overflow-x auto or scroll). The phone's bottom bar (.tabs) is not
 * one of them. The arrows are added inside the strip with aria-hidden: screen readers and the Tab key skip them.
 */
import './styles/kit-controls.css';

const STRIPS = '.tabbar, .seg, .hx-tabs, .ws-tabs, .hr-jump, .gv-seg-scroll, [data-scroll-strip]';
const CHOSEN = '[aria-selected="true"], [aria-current="page"], [aria-current="true"], [aria-pressed="true"]';
const EDGE = 48; // keep a chosen tab clear of the arrow
const CHEVRON = {
  start: 'M168.49 199.51a12 12 0 01-17 17l-80-80a12 12 0 010-17l80-80a12 12 0 0117 17L97 128z',
  end: 'M184.49 136.49l-80 80a12 12 0 01-17-17L159 128 87.51 56.49a12 12 0 0117-17l80 80a12 12 0 010 17z',
};

type Side = 'start' | 'end';
const live = new Map<HTMLElement, () => void>();

function scrolls(el: HTMLElement): boolean {
  const o = getComputedStyle(el).overflowX;
  return o === 'auto' || o === 'scroll';
}

/** The colour behind the strip, for the faded edges. */
function backdrop(el: HTMLElement): string {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c)) return c;
  }
  return '';
}

function arrow(side: Side): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'strip-arrow';
  b.dataset.side = side;
  b.tabIndex = -1;
  b.setAttribute('aria-hidden', 'true');
  b.title = side === 'start' ? 'Scroll left' : 'Scroll right';
  b.innerHTML = `<span><svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="${CHEVRON[side]}"/></svg></span>`;
  return b;
}

function items(el: HTMLElement): HTMLElement[] {
  return Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('strip-arrow'));
}

/** Scroll the strip (only the strip, never the page) so this child is in view. */
function reveal(el: HTMLElement, child: Element, smooth: boolean) {
  const c = child.getBoundingClientRect();
  const s = el.getBoundingClientRect();
  if (!c.width || !s.width) return;
  const pad = Math.min(EDGE, Math.max(0, (s.width - c.width) / 2));
  let dx = 0;
  if (c.left < s.left + pad) dx = c.left - s.left - pad;
  else if (c.right > s.right - pad) dx = c.right - s.right + pad;
  if (dx) el.scrollBy({ left: dx, behavior: smooth ? 'smooth' : 'auto' });
}

function enhance(el: HTMLElement) {
  if (live.has(el)) return;
  let start: HTMLButtonElement | null = null;
  let end: HTMLButtonElement | null = null;
  let raf = 0;

  const ensureArrows = () => {
    if (!start || !end) return;
    if (el.firstElementChild !== start) el.prepend(start);
    if (el.lastElementChild !== end) el.append(end);
  };

  const update = () => {
    raf = 0;
    if (!el.isConnected) return;
    const can = scrolls(el);
    const max = el.scrollWidth - el.clientWidth;
    const moreStart = can && max > 1 && el.scrollLeft > 1;
    const moreEnd = can && max > 1 && el.scrollLeft < max - 1;
    if ((moreStart || moreEnd) && !start) {
      start = arrow('start');
      end = arrow('end');
      start.addEventListener('click', () => page(-1));
      end.addEventListener('click', () => page(1));
      ensureArrows();
    }
    if (moreStart || moreEnd) {
      const bg = backdrop(el);
      if (bg) el.style.setProperty('--strip-bg', bg);
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      el.style.setProperty('--strip-gap', `${gap}px`);
    }
    toggle('moreStart', moreStart);
    toggle('moreEnd', moreEnd);
  };
  const toggle = (k: 'moreStart' | 'moreEnd', on: boolean) => {
    if (on && el.dataset[k] === undefined) el.dataset[k] = '';
    else if (!on && el.dataset[k] !== undefined) delete el.dataset[k];
  };
  const later = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  const page = (dir: 1 | -1) => el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' });

  const showChosen = (smooth: boolean) => {
    const chosen = items(el).find((c) => c.matches(CHOSEN));
    if (chosen) reveal(el, chosen, smooth);
  };

  // The mouse wheel scrolls the strip sideways; at either end the page scrolls as usual.
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || !scrolls(el)) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const d = e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? el.clientWidth : 1);
    const next = Math.max(0, Math.min(max, el.scrollLeft + d));
    if (Math.abs(next - el.scrollLeft) < 0.5) return;
    e.preventDefault();
    el.scrollBy({ left: next - el.scrollLeft, behavior: 'auto' });
  };

  // Drag with the mouse to scroll; a drag is not a click on the tab under it.
  let drag: { x: number; left: number; id: number; moved: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !scrolls(el) || el.scrollWidth <= el.clientWidth + 1) return;
    if ((e.target as Element).closest('.strip-arrow, input, select, textarea')) return;
    drag = { x: e.clientX, left: el.scrollLeft, id: e.pointerId, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      el.dataset.dragging = '';
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
    }
    el.scrollLeft = drag.left - dx;
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    delete el.dataset.dragging;
    if (moved) {
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };

  // Arrow keys, Home and End move between the tabs (manual activation: Enter or Space opens one).
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
    const tabs = items(el).filter((c) => c.matches('button, [role="tab"], a[href]') && !(c as HTMLButtonElement).disabled);
    const i = tabs.indexOf(e.target as HTMLElement);
    if (i < 0 || tabs.length < 2) return;
    const to = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : (i + (k === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[to].focus({ preventScroll: true });
    reveal(el, tabs[to], true);
  };
  const onFocus = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t !== el && t.parentElement === el && !t.classList.contains('strip-arrow')) reveal(el, t, true);
  };

  el.addEventListener('scroll', later, { passive: true });
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('keydown', onKey);
  el.addEventListener('focusin', onFocus);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(later) : null;
  ro?.observe(el);
  // Tabs added, removed or chosen: keep the arrows at the ends and the chosen tab in view.
  const mo = new MutationObserver((list) => {
    let chosen = false;
    let kids = false;
    for (const m of list) {
      if (m.type === 'childList' && m.target === el) kids = true;
      if (m.type === 'attributes' && (m.target as Element).parentElement === el && (m.target as Element).matches(CHOSEN)) chosen = true;
    }
    if (kids) {
      ensureArrows();
      for (const c of items(el)) ro?.observe(c);
    }
    if (chosen) showChosen(true);
    if (kids || chosen) later();
  });
  mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'aria-pressed'] });
  for (const c of items(el)) ro?.observe(c);

  update();
  showChosen(false);
  update();

  live.set(el, () => {
    cancelAnimationFrame(raf);
    ro?.disconnect();
    mo.disconnect();
    el.removeEventListener('scroll', later);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('focusin', onFocus);
  });
}

function scan(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches(STRIPS) && !root.closest('.tabs')) consider(root);
  root.querySelectorAll<HTMLElement>(STRIPS).forEach((el) => {
    if (!el.closest('nav.tabs')) consider(el);
  });
}

/** Only strips that scroll sideways (a .seg that wraps or clips is left alone). */
function consider(el: HTMLElement) {
  if (live.has(el)) return;
  if (scrolls(el)) {
    el.dataset.strip = '';
    enhance(el);
  }
}

/** Watch the whole page for strips; returns a stop function. Safe to call more than once. */
let stopAll: (() => void) | null = null;
export function installScrollStrips(root: HTMLElement = document.body): () => void {
  if (stopAll) return stopAll;
  let pending = false;
  const sweep = () => {
    pending = false;
    for (const [el, stop] of live) {
      if (!el.isConnected) {
        stop();
        live.delete(el);
      }
    }
    scan(root);
  };
  const soon = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(sweep);
  };
  const mo = new MutationObserver(soon);
  mo.observe(root, { childList: true, subtree: true });
  // A strip may only start scrolling at a narrower width (phone-only rules).
  window.addEventListener('resize', soon);
  sweep();
  stopAll = () => {
    mo.disconnect();
    window.removeEventListener('resize', soon);
    for (const stop of live.values()) stop();
    live.clear();
    stopAll = null;
  };
  return stopAll;
}
