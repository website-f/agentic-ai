/**
 * P96: the phone helpers that need a little script (styles/mobile.css holds the rest; the why is in
 * apps/prima/docs/P96_MOBILE_APP_READY.md).
 *  - Tables: each list table (3 to 12 columns, one plain header row) is marked data-phone="cards" and every cell gets
 *    its column's name as data-label, so on a phone it reads as one card per row. Grids of days or months, rosters and
 *    attendance sheets (or any table marked data-phone="scroll") keep sideways scrolling.
 *  - Typing: while a text field has the focus on a phone, <html data-typing> lets the bottom bars step aside for the
 *    keyboard, and the field is scrolled into view once the keyboard is up.
 */
const SKIP_TABLES = '.roster, .ros-wrap table, .att-sheet table, [data-phone="scroll"], .lbl-sheet table, .print-only table';
const DAY_OR_MONTH = /^(mon|tue|wed|thu|fri|sat|sun|isn|sel|rab|kha|jum|sab|ahd)\b|^\d{1,2} \w{3}\b|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mei|ogo|dis|okt)\w* ?'?\d{2}/i;

/** Whether a table reads as a list of records (cards on a phone) rather than a grid. Exported for its test. */
export function cardable(heads: string[], spans: boolean, cellCounts: number[]): boolean {
  if (spans || heads.length < 3 || heads.length > 12) return false;
  if (cellCounts.some((n) => n !== heads.length)) return false;
  // Columns that are days or months: a grid to compare across, kept as a table.
  if (heads.filter((h) => DAY_OR_MONTH.test(h.trim())).length >= 3) return false;
  return true;
}

const seen = new WeakMap<HTMLTableElement, string>();

function labelTable(t: HTMLTableElement) {
  const head = t.tHead?.rows;
  const body = t.tBodies[0]?.rows;
  if (!head || head.length !== 1 || !body) return;
  const ths = [...head[0].cells];
  const heads = ths.map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
  const rows = [...t.tBodies].flatMap((b) => [...b.rows]);
  const sig = `${heads.join('|')}#${rows.length}`;
  if (seen.get(t) === sig) return;
  seen.set(t, sig);
  const spans = ths.some((c) => c.colSpan > 1 || c.rowSpan > 1) || rows.some((r) => [...r.cells].some((c) => c.colSpan > 1 || c.rowSpan > 1));
  const ok = !t.matches(SKIP_TABLES) && !t.closest('[data-phone="scroll"]') && cardable(heads, spans, rows.slice(0, 40).map((r) => r.cells.length));
  if (!ok) {
    if (t.dataset.phone === 'cards') delete t.dataset.phone;
    return;
  }
  t.dataset.phone = 'cards';
  for (const r of rows)
    [...r.cells].forEach((c, i) => {
      const label = heads[i] ?? '';
      if (label) c.dataset.label = label;
      else delete c.dataset.label;
      // A cell with buttons or several lines takes the card's whole width.
      if (c.querySelector('button, .btn, .row, ul, ol, input, select, textarea') || (c.textContent ?? '').length > 60) c.dataset.wide = '';
      else delete c.dataset.wide;
    });
}

let queued = false;
function scan() {
  queued = false;
  document.querySelectorAll('table').forEach((t) => labelTable(t as HTMLTableElement));
}

const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file]):not([type=color]), textarea, select, [contenteditable="true"]';

/** Starts the phone helpers once, for the life of the page. */
export function startMobile(doc: Document = document) {
  const win = doc.defaultView;
  if (!win || (win as unknown as { __primaMobile?: boolean }).__primaMobile) return;
  (win as unknown as { __primaMobile?: boolean }).__primaMobile = true;
  // Tables: labelled as React draws them, and again when the translator changes a heading's language.
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(scan);
  }).observe(doc.body, { subtree: true, childList: true, characterData: true });
  scan();
  // Typing on a phone.
  const phone = () => win.matchMedia('(max-width: 860px)').matches;
  doc.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el?.matches?.(TEXT_FIELD) || !phone()) return;
    doc.documentElement.dataset.typing = '';
    // Once the keyboard is up, bring the field into the middle of what is visible.
    win.setTimeout(() => {
      if (doc.activeElement === el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 350);
  });
  doc.addEventListener('focusout', () => {
    win.setTimeout(() => {
      const a = doc.activeElement as HTMLElement | null;
      if (!a?.matches?.(TEXT_FIELD)) delete doc.documentElement.dataset.typing;
    }, 0);
  });
}
