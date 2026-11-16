/**
 * P107: the rules behind Prima's DataTable (DataTable.tsx), kept apart from React so they can be tested on their own
 * (scripts/datatable.test.mjs): search, filters, sort, pages, and the per-screen state kept in sessionStorage.
 * Everything here is client-side: the screen loads its records as before and the table only arranges them.
 */
import { toCsv } from '@prima/core';

export type SortKind = 'text' | 'number' | 'date' | 'money';
export type SortDir = 'asc' | 'desc';
export type Cell = string | number | null | undefined;

/** The parts of a column the rules need (DataTable's DtColumn adds how it is drawn). */
export interface ColumnRule<T> {
  id: string;
  /** The column's value: what it sorts by, searches and shows when there is no `render`. */
  value?: (row: T) => Cell;
  /** How it sorts; `false` makes the heading plain. Default: 'text' when there is a value. */
  sort?: SortKind | false;
  /** Searched by the search box. Default: true when there is a value. */
  search?: boolean;
  /** The search also matches the value as it reads on screen (Malay), e.g. a status "Active" found by "aktif". */
  translate?: boolean;
  /**
   * P107b: what the CSV export writes for this column. Default: `value` (money as 1234.50, dates as 2026-11-16).
   * `false` leaves the column out of the file (a column of buttons, or something not to be copied out).
   */
  exportValue?: ((row: T) => Cell) | false;
}

export interface FilterRule<T> {
  id: string;
  /** The row's value(s) for this filter. A row with several (a person in two companies) matches any of them. */
  value: (row: T) => string | readonly string[] | null | undefined;
}

export interface TableState {
  q: string;
  /** Filter id to the chosen value; '' or missing = all. */
  f: Record<string, string>;
  /** Column id, or '' for the list's own order. */
  sort: string;
  dir: SortDir;
  /** 1-based. */
  page: number;
  size: number;
}

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_STATE: TableState = { q: '', f: {}, sort: '', dir: 'asc', page: 1, size: 25 };

/** Lower case, no accents, punctuation as spaces ("Sdn. Bhd." finds "sdn bhd"); the same as the pick-lists. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The words typed, folded. */
export function words(q: string): string[] {
  return fold(q).split(' ').filter(Boolean);
}

/**
 * The text a row is found by: every searchable column's value, plus its on-screen (Malay) wording when the column asks,
 * plus the screen's own extra text. `tr` is the screen language's translator (identity in English).
 */
export function haystack<T>(row: T, columns: ColumnRule<T>[], tr: ((s: string) => string) | null, extra?: (row: T) => string): string {
  const parts: string[] = [];
  for (const c of columns) {
    if (!c.value || c.search === false) continue;
    const v = c.value(row);
    if (v == null || v === '') continue;
    const s = String(v);
    parts.push(s);
    if (c.translate && tr) {
      const t = tr(s);
      if (t !== s) parts.push(t);
    }
  }
  if (extra) parts.push(extra(row));
  return ` ${fold(parts.join(' '))} `;
}

/** Rows whose text holds every word typed (in any order). `hay` caches each row's text. */
export function searchRows<T>(rows: T[], q: string, hay: (row: T) => string): T[] {
  const ws = words(q);
  if (!ws.length) return rows;
  return rows.filter((r) => {
    const h = hay(r);
    return ws.every((w) => h.includes(w));
  });
}

function valuesOf<T>(f: FilterRule<T>, row: T): string[] {
  const v = f.value(row);
  if (v == null) return [];
  return (typeof v === 'string' ? [v] : [...v]).filter((x) => x !== '');
}

/** Rows that match every chosen filter. */
export function filterRows<T>(rows: T[], filters: FilterRule<T>[], chosen: Record<string, string>): T[] {
  const active = filters.filter((f) => chosen[f.id]);
  if (!active.length) return rows;
  return rows.filter((r) => active.every((f) => valuesOf(f, r).includes(chosen[f.id])));
}

/** A filter's choices from the rows themselves: each distinct value once, A to Z, with how many rows have it. */
export function deriveOptions<T>(rows: T[], f: FilterRule<T>): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) for (const v of new Set(valuesOf(f, r))) counts.set(v, (counts.get(v) ?? 0) + 1);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => collator.compare(a.value, b.value));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A value made comparable for its kind; null = blank (always last). */
export function sortKey(v: Cell, kind: SortKind): string | number | null {
  if (v == null || v === '') return null;
  if (kind === 'number' || kind === 'money') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'date') {
    const t = typeof v === 'number' ? v : Date.parse(String(v).length === 7 ? `${v}-01` : String(v));
    return Number.isFinite(t) ? t : null;
  }
  return String(v);
}

function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** Sorted by one column; blanks last either way, ties keep the list's own order. */
export function sortRows<T>(rows: T[], col: ColumnRule<T> | undefined, dir: SortDir): T[] {
  if (!col?.value || col.sort === false) return rows;
  const kind: SortKind = col.sort || 'text';
  const get = col.value;
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i, k: sortKey(get(r), kind) }))
    .sort((x, y) => {
      if (x.k === null || y.k === null) return x.k === y.k ? x.i - y.i : x.k === null ? 1 : -1;
      return sign * compareKeys(x.k, y.k) || x.i - y.i;
    })
    .map((x) => x.r);
}

/** A heading clicked: the same column turns round; another starts its natural way (text A to Z, numbers, money and dates largest / newest first). */
export function nextSort(s: Pick<TableState, 'sort' | 'dir'>, id: string, kind: SortKind = 'text'): Pick<TableState, 'sort' | 'dir'> {
  if (s.sort === id) return { sort: id, dir: s.dir === 'asc' ? 'desc' : 'asc' };
  return { sort: id, dir: kind === 'text' ? 'asc' : 'desc' };
}

/** Which page is shown and which rows it holds, 1-based ("26–50 of 245"). */
export function pageRange(page: number, size: number, total: number): { pages: number; page: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  if (!total) return { pages, page: p, from: 0, to: 0 };
  const from = (p - 1) * size + 1;
  return { pages, page: p, from, to: Math.min(total, from + size - 1) };
}

/** The numbered page buttons: the first, the last, the current one and its neighbours; gaps as '…'. */
export function pageButtons(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => keep.add(n));
  const out: (number | '…')[] = [];
  let last = 0;
  for (const n of [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)) {
    if (n - last > 1) out.push(n - last === 2 ? n - 1 : '…');
    out.push(n);
    last = n;
  }
  return out;
}

/** Everything at once: the rows that match, sorted, and this page's slice. */
export function viewRows<T>(
  rows: T[],
  columns: ColumnRule<T>[],
  filters: FilterRule<T>[],
  state: TableState,
  hay: (row: T) => string,
): { matched: number; rows: T[]; page: ReturnType<typeof pageRange>; all: T[] } {
  const found = sortRows(searchRows(filterRows(rows, filters, state.f), state.q, hay), columns.find((c) => c.id === state.sort), state.dir);
  const page = pageRange(state.page, state.size, found.length);
  return { matched: found.length, rows: found.slice(page.from ? page.from - 1 : 0, page.to), page, all: found };
}

/** A change to the state: anything but the page goes back to page 1 (page 9 of a search may not exist). */
export function changeState(s: TableState, change: Partial<TableState>): TableState {
  const next = { ...s, ...change, f: change.f ? { ...s.f, ...change.f } : s.f };
  if (!('page' in change)) next.page = 1;
  return next;
}

/** The "1–25 of 245" line (an en dash; i18n.ts has the Malay pattern). Empty when nothing matches. */
export function countLine(from: number, to: number, total: number): string {
  if (!total) return '';
  const f = (n: number) => n.toLocaleString('en-MY');
  return `${f(from)}–${f(to)} of ${f(total)}`;
}

const KEY = (id: string) => `prima.table.${id}`;

/** The screen's last search, filters, sort and page (Back returns to them). Bad or missing values fall back. */
export function loadState(id: string | undefined, defaults: TableState, store: Pick<Storage, 'getItem'> | null = safeSession()): TableState {
  if (!id || !store) return defaults;
  try {
    const raw = store.getItem(KEY(id));
    if (!raw) return defaults;
    const v = JSON.parse(raw) as Partial<TableState>;
    const f: Record<string, string> = {};
    if (v.f && typeof v.f === 'object') for (const [k, x] of Object.entries(v.f)) if (typeof x === 'string') f[k] = x;
    return {
      q: typeof v.q === 'string' ? v.q : defaults.q,
      f: { ...defaults.f, ...f },
      sort: typeof v.sort === 'string' ? v.sort : defaults.sort,
      dir: v.dir === 'desc' ? 'desc' : v.dir === 'asc' ? 'asc' : defaults.dir,
      page: typeof v.page === 'number' && v.page >= 1 ? Math.floor(v.page) : defaults.page,
      size: typeof v.size === 'number' && v.size >= 1 && v.size <= 500 ? Math.floor(v.size) : defaults.size,
    };
  } catch {
    return defaults;
  }
}

export function saveState(id: string | undefined, s: TableState, store: Pick<Storage, 'setItem'> | null = safeSession()): void {
  if (!id || !store) return;
  try {
    store.setItem(KEY(id), JSON.stringify(s));
  } catch {
    /* private window or full storage: the state lasts while the screen is open */
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

// ---------- P107b: export, the standard row actions and deleting several rows ----------
// (Fitri, 16 Nov 2026: "when clicked it didn't show details or features like delete (with confirmation), edit, view,
// or multi select bulk and multi remove or even export function on each datatable.")

/** A value as the CSV file holds it: plain numbers (money with two decimals, no "RM"), dates as typed (ISO). */
export function exportCell(v: Cell, kind: SortKind | false | undefined): string {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return kind === 'money' ? v.toFixed(2) : String(v);
  }
  return String(v);
}

/** The columns a file gets: each with a value or an export value, unless the column opted out. */
export function exportColumns<C extends ColumnRule<never>>(columns: C[]): C[] {
  return columns.filter((c) => c.exportValue !== false && !!(c.exportValue || c.value));
}

/**
 * The rows and columns of an export: a heading row (each column's label, in the screen's language) and one row per
 * record. `tr` turns English into the screen's language; it is used for the headings and for columns marked `translate`
 * (statuses, kinds), so the file reads like the screen. Names and numbers are written as they are.
 */
export function exportGrid<T>(rows: readonly T[], columns: (ColumnRule<T> & { label: string })[], tr: (s: string) => string = (s) => s): string[][] {
  const cols = exportColumns(columns as ColumnRule<never>[]) as unknown as (ColumnRule<T> & { label: string })[];
  const head = cols.map((c) => tr(c.label));
  const body = rows.map((r) =>
    cols.map((c) => {
      const get = c.exportValue || c.value!;
      const s = exportCell(get(r), c.sort);
      return c.translate && s ? tr(s) : s;
    }),
  );
  return [head, ...body];
}

/** Which rows an export writes: the ticked ones when some are ticked, otherwise every row the search and filters found (all pages). */
export function exportRows<T>(found: readonly T[], all: readonly T[], ticked: ReadonlySet<string> | null | undefined, rowKey: (row: T) => string): T[] {
  if (!ticked || ticked.size === 0) return [...found];
  // Ticked rows in the order shown; a ticked row the search now hides still goes in (it is ticked), after the rest.
  const shown = found.filter((r) => ticked.has(rowKey(r)));
  const seen = new Set(shown.map(rowKey));
  return [...shown, ...all.filter((r) => ticked.has(rowKey(r)) && !seen.has(rowKey(r)))];
}

/** The CSV text: a UTF-8 byte-order mark first, so Excel shows Malay words and names with accents correctly. */
export function csvText(grid: string[][]): string {
  return '﻿' + toCsv(grid);
}

/** "site-list-2026-11-16.csv": the screen's name in plain letters, then the day (on this device's calendar). */
export function csvName(stem: string, on: Date = new Date()): string {
  const slug = fold(stem).replace(/ /g, '-').slice(0, 60) || 'list';
  const d = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, '0')}-${String(on.getDate()).padStart(2, '0')}`;
  return `${slug}-${d}.csv`;
}

/** One row action, as the table draws it (DataTable's DtAction has the same shape). */
export interface ActionRule {
  label: string;
  onClick: () => void;
  tone?: 'danger';
  disabled?: boolean;
  hidden?: boolean;
  icon?: unknown;
}

/**
 * The row menu in its standard order: View, Edit, the screen's own actions, then Delete (red, last). Edit and Delete
 * show only for rows the screen allows (`canEdit`, `canDelete`); View only when the screen has something to show.
 */
export function standardActions<T, A extends ActionRule>(
  row: T,
  o: {
    view?: (row: T) => void;
    viewLabel?: string;
    edit?: (row: T) => void;
    editLabel?: string;
    canEdit?: (row: T) => boolean;
    remove?: (row: T) => void;
    deleteLabel?: string;
    canDelete?: (row: T) => boolean;
    extra?: A[];
  },
): (A | ActionRule)[] {
  const out: (A | ActionRule)[] = [];
  if (o.view) out.push({ label: o.viewLabel ?? 'View', onClick: () => o.view!(row) });
  if (o.edit && (o.canEdit?.(row) ?? true)) out.push({ label: o.editLabel ?? 'Edit', onClick: () => o.edit!(row) });
  for (const a of o.extra ?? []) if (!a.hidden) out.push(a);
  if (o.remove && (o.canDelete?.(row) ?? true)) out.push({ label: o.deleteLabel ?? 'Delete', tone: 'danger', onClick: () => o.remove!(row) });
  return out;
}

export interface ManyOutcome {
  /** The keys of the rows done. */
  done: string[];
  /** The rows refused, by name, with the server's words. */
  failed: { key: string; name: string; error: string }[];
}

/**
 * Deletes several rows one after another with the screen's own one-row action (so each keeps the server's checks,
 * locks and reason), and says how many went through. One refusal does not stop the rest.
 */
export async function runEach<T>(rows: readonly T[], one: (row: T) => Promise<unknown>, rowKey: (row: T) => string, nameOf: (row: T) => string): Promise<ManyOutcome> {
  const out: ManyOutcome = { done: [], failed: [] };
  for (const r of rows) {
    try {
      await one(r);
      out.done.push(rowKey(r));
    } catch (e) {
      out.failed.push({ key: rowKey(r), name: nameOf(r), error: e instanceof Error ? e.message : String(e ?? 'Refused') });
    }
  }
  return out;
}

/**
 * The outcome of a screen's own bulk call: `{ done, failed }` keys as returned, or (nothing returned) all done. A call
 * that throws refuses them all with its message.
 */
export async function runBulk<T>(rows: readonly T[], many: (rows: T[]) => Promise<unknown>, rowKey: (row: T) => string, nameOf: (row: T) => string): Promise<ManyOutcome> {
  try {
    const r = (await many([...rows])) as Partial<{ done: string[]; failed: { key: string; error: string }[] }> | undefined | null;
    if (r && Array.isArray(r.done)) {
      const byKey = new Map(rows.map((x) => [rowKey(x), x]));
      return {
        done: r.done,
        failed: (r.failed ?? []).map((f) => ({ key: f.key, name: byKey.has(f.key) ? nameOf(byKey.get(f.key)!) : f.key, error: f.error })),
      };
    }
    return { done: rows.map(rowKey), failed: [] };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e ?? 'Refused');
    return { done: [], failed: rows.map((x) => ({ key: rowKey(x), name: nameOf(x), error })) };
  }
}

/** The reason box: required screens need this many letters (Prima: every change says why). */
export const REASON_MIN = 5;
export function reasonOk(reason: string, required: boolean): boolean {
  return !required || reason.trim().length >= REASON_MIN;
}
