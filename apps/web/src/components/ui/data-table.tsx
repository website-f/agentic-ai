/**
 * P96: one data table for every long list in the office.
 *
 * - Search box (debounced), sortable columns, numbered pages with a page size, row actions,
 *   optional row ticks, loading / error / empty states.
 * - Phone first: below the `md` breakpoint each row is a card of "label: value" lines with its
 *   actions, so nothing scrolls sideways. From `md` up it is a real <table> (caption, scoped
 *   headings, aria-sort, labelled controls); columns marked `hideBelow` drop out on narrower
 *   desktops and come back on wide ones.
 * - Its state (search, page, size, sort) lives in the address (`useTableState`), so Back,
 *   refresh and a shared link show the same rows. `useLocalTableState` keeps it in memory for
 *   tables inside sheets and dialogs.
 * - Two modes. "client": give it every row; it searches, sorts and pages them itself (small
 *   lists). "server": give it one page and `total`; the API does the work with
 *   `?q=&page=&size=&sort=` (sort "-col" is descending), see `useServerTable` and
 *   apps/api/agentic/api/table.py.
 */
import {
  CaretDownIcon, CaretLeftIcon, CaretRightIcon, CaretUpDownIcon, CaretUpIcon, DotsThreeIcon, DownloadSimpleIcon, EyeIcon, FileArrowUpIcon,
  MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon, XIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, useQuery, type QueryKey } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { useT } from "@/i18n";
import { apiWithHeaders, errorMessage } from "@/lib/api";
import { saveFile } from "@/lib/native";
import { useDebounced } from "@/lib/paged";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { ConfirmDialog } from "./confirm";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./menu";
import { SearchInput } from "./search-input";
import { SearchSelect } from "./search-select";
import { Select } from "./select";
import { Skeleton } from "./skeleton";

export type SortDir = "asc" | "desc";

export interface TableState {
  q: string;
  /** 1-based. */
  page: number;
  size: number;
  /** A column id, or "" for the list's own order. */
  sort: string;
  dir: SortDir;
  /** The list's own filters (e.g. {role: "staff"}); "" or missing = no filter. Server mode
   * sends them as query params. */
  f: Record<string, string>;
}

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const TABLE_DEFAULTS: TableState = { q: "", page: 1, size: 25, sort: "", dir: "asc", f: {} };

export interface TableControl {
  state: TableState;
  /** Merge a change (`f` merges too). Anything but `page` sends the reader back to page 1. */
  set: (change: Partial<TableState>) => void;
}

/** One filter's value and setter, e.g. `const [role, setRole] = filterOf(control, "role")`. */
export function filterOf(control: TableControl, key: string): [string, (v: string) => void] {
  return [control.state.f[key] ?? "", (v: string) => control.set({ f: { [key]: v } })];
}

const ALL = "__all";

/** P107: one filter as a chip-like select beside the search box, kept in the table's state
 * (`useTableState(..., { filters: [id] })`). "" is "all"; a set filter stands out in the
 * accent colour. Long lists (more than 8 options) get a searchable picker. */
export function TableFilter({ control, id, label, allLabel, options, searchable, className }: {
  control: TableControl;
  id: string;
  /** The filter's name (the select's accessible name), already translated. */
  label: string;
  /** "All companies", already translated. */
  allLabel: string;
  options: { value: string; label: string; hint?: string }[];
  searchable?: boolean;
  className?: string;
}) {
  const t = useT();
  const [value, setValue] = filterOf(control, id);
  const on = !!value;
  const all = [{ value: ALL, label: allLabel }, ...options];
  const style = cn("w-full sm:w-auto sm:max-w-60 sm:min-w-36", on && "border-accent/50 bg-accent-soft/50 font-medium text-fg", className);
  const pick = (v: string) => setValue(v === ALL ? "" : v);
  return searchable ?? options.length > 8 ? (
    <SearchSelect size="md" label={label} value={value || ALL} onValueChange={pick} options={all} className={style}
      searchPlaceholder={t("Search {list}", { list: label.toLowerCase() })} />
  ) : (
    <Select size="md" label={label} value={value || ALL} onValueChange={pick} options={all} className={style} />
  );
}

/** P107: a row's ⋯ menu (give it MenuItems). */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <DotsThreeIcon size={20} weight="bold" />
        </Button>
      </MenuTrigger>
      <MenuContent>{children}</MenuContent>
    </Menu>
  );
}

export interface Column<T> {
  id: string;
  /** Already translated. */
  header: string;
  cell: (row: T) => ReactNode;
  /** Client mode: the value it sorts by (server mode: the API sorts by `id`). Setting either
   * `sortable` or `sortValue` makes the heading a sort button. */
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
  /** What kind of value it is, for the phone's sort menu wording and the first direction. */
  kind?: "text" | "number" | "date";
  /** Hide the column on narrower desktops (it still shows on phone cards unless `card: "hide"`). */
  hideBelow?: "lg" | "xl" | "2xl";
  /** On phone cards: "title" lines lead the card, "full" spans the card without a label,
   * "hide" leaves it out; the default is a "label: value" line. */
  card?: "title" | "full" | "hide" | "field";
  align?: "left" | "right";
  /** Extra classes for the column's cells (e.g. a width). */
  className?: string;
  /** P107: the value Export writes for this column (default: `sortValue`; a column with
   * neither is left out of the file). */
  exportValue?: (row: T) => string | number | null | undefined;
  /** P107: leave this column out of Export. */
  noExport?: boolean;
  /** P107: only in the exported file, never on screen (e.g. an email shown inside the name cell). */
  exportOnly?: boolean;
}

/** P107: the standard ⋯ menu of a row: View, Edit, the screen's own items, Delete. */
export interface RowActions<T> {
  /** "View": opens the row's details. */
  view?: (row: T) => void;
  edit?: (row: T) => void;
  /** Rows this person may edit (default: every row). */
  canEdit?: (row: T) => boolean;
  /** Delete one row; the table asks first, naming it. Throwing keeps the dialog open with the
   * reason inside it. */
  remove?: (row: T) => Promise<unknown>;
  /** Rows this person may delete (default: every row). */
  canRemove?: (row: T) => boolean;
  /** "delete" (gone for good, the default) or "remove" (people leave, the record stays). */
  verb?: "delete" | "remove";
  /** The dialog's text under its title: what goes with the row, whether it can be undone. */
  removeBody?: (row: T) => ReactNode;
  /** The screen's own MenuItems, between Edit and Delete. */
  more?: (row: T) => ReactNode;
}

/** P107: what a bulk delete did: how many went, and which did not (with why). */
export interface BulkOutcome {
  done: number;
  failed: { id: string; message: string }[];
}

/** P107: one call per row, one after another; a refusal never stops the rest. */
export async function eachRow<T>(rows: T[], rowId: (row: T) => string, run: (row: T) => Promise<unknown>): Promise<BulkOutcome> {
  const out: BulkOutcome = { done: 0, failed: [] };
  for (const row of rows) {
    try {
      await run(row);
      out.done += 1;
    } catch (e) {
      out.failed.push({ id: rowId(row), message: errorMessage(e) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- export (P107)

/** One CSV cell, always quoted; text starting = + - @ is kept as text (Excel would run it). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '""';
  if (typeof v === "number") return Number.isFinite(v) ? `"${v}"` : '""';
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

function exportCell<T>(c: Column<T>, row: T): string | number | null | undefined {
  const v = (c.exportValue ?? c.sortValue)?.(row);
  // A date column's ISO time reads as "2026-11-16 09:30" (local time).
  if (c.kind === "date" && typeof v === "string" && ISO_DATE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
  return v;
}

/** The columns Export writes. */
export function exportColumns<T>(columns: Column<T>[]): Column<T>[] {
  return columns.filter((c) => !c.noExport && (c.exportValue || c.sortValue));
}

/** Rows as CSV text: the headings, then a line a row, with a byte-order mark first so Excel
 * reads the UTF-8 (Malay names, "–", "RM") right. */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const cols = exportColumns(columns);
  const lines = [cols.map((c) => csvCell(c.header)).join(","), ...rows.map((r) => cols.map((c) => csvCell(exportCell(c, r))).join(","))];
  return "﻿" + lines.join("\r\n");
}

/** "companies-2026-11-16.csv" */
export function csvName(base: string, when = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const safe = base.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").toLowerCase() || "export";
  return `${safe}-${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}.csv`;
}

export interface Selection {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}

export interface DataTableProps<T> {
  /** Names the table for screen readers (the caption) and the phone card list. */
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowId: (row: T) => string;
  /** How a row is named to screen readers ("Select {name}"); default: its id. */
  rowLabel?: (row: T) => string;
  control: TableControl;
  mode?: "client" | "server";
  /** Server mode: rows matching the search and filters. */
  total?: number;
  /** Client mode: the text a row is found by (default: every column's sort value). */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Hide the search box (e.g. a list that is filtered elsewhere). */
  noSearch?: boolean;
  loading?: boolean;
  /** Refreshing in the background: the rows dim a little. */
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Filters beside the search box. On phones they sit two to a row; give a wide one (a
   * segmented control) `col-span-2`. */
  filters?: ReactNode;
  /** Buttons at the right of the toolbar (export, add). */
  toolbarActions?: ReactNode;
  /** The ⋯ menu or buttons for one row. */
  actions?: (row: T) => ReactNode;
  /** Opens a row (a sheet or page). The row's first title cell becomes a button. */
  onOpen?: (row: T) => void;
  /** Row ticks. `canSelect` leaves some rows without a box (e.g. yourself). */
  selection?: Selection & { canSelect?: (row: T) => boolean };
  /** Shown above the rows while any are ticked. */
  bulk?: (selected: ReadonlySet<string>) => ReactNode;
  /** Shown when there are no rows and no search. */
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  pageSizes?: readonly number[];
  /** Forces the phone or desktop layout (tests, embedded uses). */
  layout?: "auto" | "cards" | "table";
  /** P107: desktop rows scroll under a sticky heading inside the viewport's height (default);
   * false lets a short or embedded table grow with the page. */
  stickyHeader?: boolean;
  /** P107: a file name (without ".csv", e.g. "companies") turns on Export: the toolbar's button
   * writes every row matching the search and filters, the bulk bar's the ticked rows. */
  exportName?: string;
  /** P107, server mode: every row matching the search and filters, for Export (without it
   * Export writes the page shown). */
  exportRows?: () => Promise<T[]>;
  /** P107: the standard ⋯ menu (View, Edit, Delete with its confirmation). Shown after `actions`. */
  rowActions?: RowActions<T>;
  /** P107: "Delete ticked" in the bulk bar, with a confirmation that counts them and says what
   * did not go. `run` gets the ticked rows this table has seen (`canRemove` ones only). */
  bulkRemove?: {
    run: (rows: T[], ids: string[]) => Promise<BulkOutcome>;
    canRemove?: (row: T) => boolean;
    /** "delete" (default) or "remove", as RowActions. */
    verb?: "delete" | "remove";
    /** The dialog's text under its title. */
    body?: ReactNode;
    /** The dialog's title for n rows (default "Delete n ticked rows?"). */
    title?: (n: number) => string;
  };
  /** P107: the toolbar's Add (the screen's own form) and Import buttons; labels already translated. */
  onAdd?: () => void;
  addLabel?: string;
  onImport?: () => void;
  importLabel?: string;
  className?: string;
}

// ---------------------------------------------------------------- state

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** "-used" -> {sort: "used", dir: "desc"}. */
export function parseSort(raw: unknown, fallback: Pick<TableState, "sort" | "dir">): Pick<TableState, "sort" | "dir"> {
  if (typeof raw !== "string" || !raw) return { sort: fallback.sort, dir: fallback.dir };
  return raw.startsWith("-") ? { sort: raw.slice(1), dir: "desc" } : { sort: raw, dir: "asc" };
}

export function sortParam(s: Pick<TableState, "sort" | "dir">): string {
  return s.sort ? (s.dir === "desc" ? `-${s.sort}` : s.sort) : "";
}

/** Reads a table's state out of the address's search params (`prefix` keeps two tables on one
 * page apart). Missing or broken values fall back to `defaults`. */
export function readTableState(search: Record<string, unknown>, defaults: TableState, prefix = "", filters: readonly string[] = []): TableState {
  const q = search[`${prefix}q`];
  const f: Record<string, string> = {};
  for (const k of filters) {
    const v = search[`${prefix}${k}`];
    if (v !== undefined && v !== null && v !== "") f[k] = String(v);
    else if (defaults.f[k]) f[k] = defaults.f[k];
  }
  return {
    q: q === undefined || q === null ? defaults.q : String(q),
    page: num(search[`${prefix}page`], defaults.page),
    size: num(search[`${prefix}size`], defaults.size),
    ...parseSort(search[`${prefix}sort`], defaults),
    f,
  };
}

/** The search params for a state: only what differs from the defaults. */
export function writeTableState(
  prev: Record<string, unknown>,
  next: TableState,
  defaults: TableState,
  prefix = "",
): Record<string, unknown> {
  const out = { ...prev };
  const put = (k: string, v: unknown, d: unknown) => {
    if (v === d || v === "" || v === undefined) delete out[`${prefix}${k}`];
    else out[`${prefix}${k}`] = v;
  };
  put("q", next.q.trim(), defaults.q);
  put("page", next.page, defaults.page);
  put("size", next.size, defaults.size);
  const s = sortParam(next);
  put("sort", s, sortParam(defaults));
  if (!s && sortParam(defaults)) out[`${prefix}sort`] = "";
  for (const [k, v] of Object.entries(next.f)) put(k, v, defaults.f[k] ?? "");
  return out;
}

/** Apply a change: anything but the page goes back to page 1 (page 9 of a search may not exist). */
export function changeState(s: TableState, change: Partial<TableState>): TableState {
  const next = { ...s, ...change, f: change.f ? { ...s.f, ...change.f } : s.f };
  if (!("page" in change)) next.page = 1;
  return next;
}

/** A heading clicked: the same column turns round, another starts its natural way (text A to
 * Z, numbers and dates largest / newest first). */
export function nextSort(s: Pick<TableState, "sort" | "dir">, id: string, kind: Column<unknown>["kind"] = "text"): Pick<TableState, "sort" | "dir"> {
  if (s.sort === id) return { sort: id, dir: s.dir === "asc" ? "desc" : "asc" };
  return { sort: id, dir: kind === "text" ? "asc" : "desc" };
}

/** Table state kept in the address. Page and sort changes add a history entry (Back returns to
 * them); the search box replaces it as you type. */
export function useTableState(defaults: Partial<TableState> = {}, opts: { prefix?: string; filters?: readonly string[] } = {}): TableControl {
  const prefix = opts.prefix ?? "";
  const keysOf = (opts.filters ?? []).join(",");
  // Callers pass a fresh object each render: compare it by value.
  const defaultsKey = JSON.stringify(defaults);
  const base = useMemo(() => {
    const d = JSON.parse(defaultsKey) as Partial<TableState>;
    return { ...TABLE_DEFAULTS, ...d, f: { ...d.f } };
  }, [defaultsKey]);
  // Compared by value: the router can hand back the same search object with new contents.
  const raw = useRouterState({ select: (s) => JSON.stringify(s.location.search ?? {}) });
  const navigate = useNavigate();
  const state = useMemo(() => readTableState(JSON.parse(raw) as Record<string, unknown>, base, prefix, keysOf ? keysOf.split(",") : []),
    [raw, base, prefix, keysOf]);
  const set = (change: Partial<TableState>) => {
    const next = changeState(state, change);
    const typing = Object.keys(change).length === 1 && "q" in change;
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => writeTableState(prev, next, base, prefix)) as never,
      replace: typing,
      resetScroll: false,
    });
  };
  return { state, set };
}

/** Table state in memory (tables inside sheets and dialogs, tests). */
export function useLocalTableState(defaults: Partial<TableState> = {}): TableControl {
  const [state, setState] = useState<TableState>({ ...TABLE_DEFAULTS, ...defaults, f: { ...defaults.f } });
  return { state, set: (change) => setState((s) => changeState(s, change)) };
}

/** The query params a server-mode list sends. */
export function tableParams(s: TableState): Record<string, string> {
  const out: Record<string, string> = { page: String(s.page), size: String(s.size) };
  if (s.q.trim()) out.q = s.q.trim();
  const sort = sortParam(s);
  if (sort) out.sort = sort;
  for (const [k, v] of Object.entries(s.f)) if (v) out[k] = v;
  return out;
}

export function withParams(url: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${url}${url.includes("?") ? "&" : "?"}${s}` : url;
}

/** One page of a server-mode list. The API answers with the page's rows (a list, or a body
 * `pick` reads them from) and the matching total in X-Total-Count. */
export function useServerTable<T, B = T[]>(
  key: QueryKey,
  url: string,
  state: TableState,
  extra: Record<string, string | number | boolean | null | undefined> = {},
  opts: { pick?: (body: B) => T[]; enabled?: boolean; refetchInterval?: number } = {},
) {
  const href = withParams(url, { ...extra, ...tableParams(state) });
  const query = useQuery({
    queryKey: [...key, "table", href],
    queryFn: async () => {
      const { data, headers } = await apiWithHeaders<B>(href);
      const rows = opts.pick ? opts.pick(data) : (data as unknown as T[]);
      const total = Number(headers.get("X-Total-Count") ?? rows.length);
      return { rows, total, body: data };
    },
    placeholderData: keepPreviousData,
    enabled: opts.enabled,
    refetchInterval: opts.refetchInterval,
  });
  return {
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    body: query.data?.body,
    loading: query.isLoading,
    fetching: query.isFetching && !query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------- client mode

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an || bn) return an && bn ? 0 : an ? 1 : -1; // blanks last, whichever way
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** Client mode: search, sort, then the page's rows. */
export function clientRows<T>(
  rows: T[],
  columns: Column<T>[],
  state: TableState,
  searchText?: (row: T) => string,
): { rows: T[]; total: number } {
  const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = searchText ?? ((r: T) => columns.map((c) => c.sortValue?.(r) ?? "").join(" "));
  let out = words.length ? rows.filter((r) => {
    const hay = text(r).toLowerCase();
    return words.every((w) => hay.includes(w));
  }) : rows;
  const col = columns.find((c) => c.id === state.sort);
  if (col?.sortValue) {
    const v = col.sortValue;
    const sign = state.dir === "desc" ? -1 : 1;
    out = out
      .map((r, i) => ({ r, i, k: v(r) }))
      .sort((x, y) => {
        const blank = (k: unknown) => k === null || k === undefined || k === "";
        if (blank(x.k) !== blank(y.k)) return blank(x.k) ? 1 : -1;
        return sign * compare(x.k, y.k) || x.i - y.i;
      })
      .map((x) => x.r);
  }
  const total = out.length;
  const pages = Math.max(1, Math.ceil(total / state.size));
  const page = Math.min(state.page, pages);
  return { rows: out.slice((page - 1) * state.size, page * state.size), total };
}

/** How many pages, and which rows this page shows (1-based, for "26 to 50 of 239"). */
export function pageRange(page: number, size: number, total: number): { pages: number; page: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page), pages);
  if (!total) return { pages, page: p, from: 0, to: 0 };
  const from = (p - 1) * size + 1;
  return { pages, page: p, from, to: Math.min(total, from + size - 1) };
}

// ---------------------------------------------------------------- pieces

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};

function isSortable<T>(c: Column<T>, mode: "client" | "server"): boolean {
  return mode === "server" ? !!c.sortable : !!(c.sortable || c.sortValue);
}

function Tick({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label}
      className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]" />
  );
}

/** Keeps the box's text while typing; the table's `q` follows once typing settles. */
function SearchBox({ control, placeholder, label }: { control: TableControl; placeholder?: string; label: string }) {
  const { state, set } = control;
  const [typed, setTyped] = useState(state.q);
  const [seen, setSeen] = useState(state.q);
  // The address changed under us (Back, a cleared filter): show its search.
  if (seen !== state.q) {
    setSeen(state.q);
    if (typed.trim() !== state.q) setTyped(state.q);
  }
  const settled = useDebounced(typed, 300);
  const latest = useRef({ set, q: state.q });
  useEffect(() => {
    latest.current = { set, q: state.q };
  });
  useEffect(() => {
    // Only a settled change of the box sends a search.
    if (settled.trim() !== latest.current.q) latest.current.set({ q: settled.trim() });
  }, [settled]);
  return <SearchInput value={typed} onChange={setTyped} placeholder={placeholder} label={label} className="basis-60" />;
}

function SortMenu<T>({ columns, control, mode }: { columns: Column<T>[]; control: TableControl; mode: "client" | "server" }) {
  const t = useT();
  const sortable = columns.filter((c) => isSortable(c, mode));
  if (!sortable.length) return null;
  const words = (c: Column<T>): [string, string] =>
    c.kind === "number" ? [t("{column}: lowest first", { column: c.header }), t("{column}: highest first", { column: c.header })]
      : c.kind === "date" ? [t("{column}: oldest first", { column: c.header }), t("{column}: newest first", { column: c.header })]
        : [t("{column}: A to Z", { column: c.header }), t("{column}: Z to A", { column: c.header })];
  const options = [
    ...(control.state.sort ? [] : [{ value: "", label: t("Usual order") }]),
    ...sortable.flatMap((c) => {
      const [up, down] = words(c);
      const both = [{ value: `${c.id}:asc`, label: up }, { value: `${c.id}:desc`, label: down }];
      return c.kind === "text" || !c.kind ? both : both.reverse();
    }),
  ];
  const value = control.state.sort ? `${control.state.sort}:${control.state.dir}` : "";
  return (
    <Select size="md" className="w-full" label={t("Sort by")} value={value} placeholder={t("Sort by")}
      onValueChange={(v) => {
        const [sort = "", dir = "asc"] = v.split(":");
        control.set({ sort, dir: dir as SortDir });
      }}
      options={options} />
  );
}

/** P107: the numbered pages to show: the first, the last, and the current one with a
 * neighbour each side; gaps are "…" ([1, "…", 4, 5, 6, "…", 12]). */
export function pageNumbers(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  let lo = Math.max(2, Math.min(page - 1, pages - 4));
  let hi = Math.min(pages - 1, Math.max(page + 1, 5));
  // A gap of one page shows that page instead of "…".
  if (lo === 3) lo = 2;
  if (hi === pages - 2) hi = pages - 1;
  const out: (number | "…")[] = [1];
  if (lo > 2) out.push("…");
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < pages - 1) out.push("…");
  out.push(pages);
  return out;
}

function Pager({ control, total, sizes, noun }: { control: TableControl; total: number; sizes: readonly number[]; noun: string }) {
  const t = useT();
  const { state, set } = control;
  const { pages, page, from, to } = pageRange(state.page, state.size, total);
  return (
    <nav aria-label={t("Pages of {list}", { list: noun })} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[13px] text-muted tabular">{total ? t("Showing {from} to {to} of {total}", { from, to, total }) : null}</p>
        <Select size="sm" className="w-32" label={t("Rows per page")} value={String(state.size)}
          options={[...new Set([...sizes, state.size])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: t("{n} a page", { n }) }))}
          onValueChange={(v) => set({ size: Number(v) })} />
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => set({ page: page - 1 })} aria-label={t("Previous page")}>
          <CaretLeftIcon size={14} />
        </Button>
        {/* Phones: "Page 2 of 9"; wider screens: the numbered pages. */}
        <span className="min-w-24 text-center text-[13px] tabular sm:sr-only">{t("Page {page} of {pages}", { page, pages })}</span>
        <span className="hidden items-center gap-1 sm:flex">
          {pageNumbers(page, pages).map((p, i) => p === "…" ? (
            <span key={`gap${i}`} aria-hidden className="w-6 text-center text-[13px] text-muted">…</span>
          ) : (
            <button key={p} type="button" onClick={() => set({ page: p })} aria-label={t("Page {page}", { page: p })}
              aria-current={p === page ? "page" : undefined}
              className={cn("hit h-8 min-w-8 rounded-sm px-2 text-[13px] tabular transition-colors focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none",
                p === page ? "bg-accent font-semibold text-accent-fg" : "text-fg hover:bg-surface-2")}>
              {p}
            </button>
          ))}
        </span>
        <Button size="icon-sm" variant="outline" disabled={page >= pages} onClick={() => set({ page: page + 1 })} aria-label={t("Next page")}>
          <CaretRightIcon size={14} />
        </Button>
      </div>
    </nav>
  );
}

const INTERACTIVE = "a,button,input,select,textarea,label,[role=button],[role=combobox],[role=menuitem],[data-no-open]";

// ---------------------------------------------------------------- the table

export function DataTable<T>({
  label, columns: allColumns, rows, rowId, rowLabel, control, mode = "client", total: serverTotal, searchText, searchPlaceholder, noSearch,
  loading, fetching, error, onRetry, filters, toolbarActions, actions, onOpen, selection, bulk, empty, rowClassName,
  pageSizes = PAGE_SIZES, layout = "auto", stickyHeader = true, exportName, exportRows, rowActions, bulkRemove,
  onAdd, addLabel, onImport, importLabel, className,
}: DataTableProps<T>) {
  const t = useT();
  const phone = useIsPhone();
  const cards = layout === "cards" || (layout === "auto" && phone);
  const captionId = useId();
  const { state, set } = control;
  // P107: export-only columns are searched and written to the file, never shown.
  const columns = allColumns.some((c) => c.exportOnly) ? allColumns.filter((c) => !c.exportOnly) : allColumns;

  const view = useMemo(
    () => (mode === "client" ? clientRows(rows, allColumns, state, searchText) : { rows, total: serverTotal ?? rows.length }),
    [mode, rows, allColumns, state, searchText, serverTotal],
  );
  const pageRows = view.rows;
  const total = view.total;

  // P107: every row this table has shown, so Export and Delete of rows ticked on another page
  // (server mode) still know them.
  // Rows are matched by id (a screen may hand over fresh objects each render); the rows in hand
  // win over remembered ones.
  const [known, setKnown] = useState<ReadonlyMap<string, T>>(() => new Map());
  if (mode === "server" && pageRows.some((r) => !known.has(rowId(r)))) {
    const next = new Map(known);
    for (const r of pageRows) next.set(rowId(r), r);
    setKnown(next);
  }
  const tickedRows = (): T[] => {
    if (!selection?.selected.size) return [];
    const inHand = new Map((mode === "client" ? rows : pageRows).map((r) => [rowId(r), r] as const));
    return [...selection.selected].flatMap((id) => {
      const r = inHand.get(id) ?? known.get(id);
      return r === undefined ? [] : [r];
    });
  };
  const nameOf = (row: T) => rowLabel?.(row) ?? rowId(row);

  // ---- Export (P107)
  const [exporting, setExporting] = useState(false);
  const download = async (list: T[]) => {
    await saveFile(new Blob([toCsv(allColumns, list)], { type: "text/csv;charset=utf-8" }), csvName(exportName ?? label));
    toast.success(list.length === 1 ? t("1 row exported.") : t("{n} rows exported.", { n: list.length }));
  };
  const exportFiltered = async () => {
    setExporting(true);
    try {
      const list = mode === "client"
        ? clientRows(rows, allColumns, { ...state, page: 1, size: Number.MAX_SAFE_INTEGER }, searchText).rows
        : exportRows ? await exportRows() : pageRows;
      await download(list);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  const exportTicked = () => void download(tickedRows()).catch((e: unknown) => toast.error(errorMessage(e)));

  // ---- Delete one row, and the ticked rows (P107)
  const verb = rowActions?.verb ?? "delete";
  const [target, setTarget] = useState<T | null>(null);
  const [asking, setAsking] = useState(false);
  const untick = (ids: string[]) => {
    if (!selection || !ids.some((id) => selection.selected.has(id))) return;
    const next = new Set(selection.selected);
    for (const id of ids) next.delete(id);
    selection.onChange(next);
  };
  const removeOne = async () => {
    if (!target || !rowActions?.remove) return;
    await rowActions.remove(target);
    const name = nameOf(target);
    toast.success(verb === "remove" ? t("{name} removed.", { name }) : t("{name} deleted.", { name }));
    untick([rowId(target)]);
  };
  const bulkVerb = bulkRemove?.verb ?? "delete";
  const [bulkAsking, setBulkAsking] = useState(false);
  const removable = bulkRemove ? tickedRows().filter((r) => bulkRemove.canRemove?.(r) ?? true) : [];
  const keptBack = (selection?.selected.size ?? 0) - removable.length;
  const removeTicked = async () => {
    if (!bulkRemove || !removable.length) return;
    const ids = removable.map(rowId);
    const out = await bulkRemove.run(removable, ids);
    if (out.done) {
      toast.success(bulkVerb === "remove"
        ? (out.done === 1 ? t("1 removed.") : t("{n} removed.", { n: out.done }))
        : (out.done === 1 ? t("1 deleted.") : t("{n} deleted.", { n: out.done })));
    }
    const failed = new Set(out.failed.map((f) => f.id));
    untick(ids.filter((id) => !failed.has(id)));
    if (out.failed.length) {
      throw new Error(t("{done} done, {failed} not done: {reason}", { done: out.done, failed: out.failed.length, reason: out.failed[0]!.message }));
    }
  };

  /** The standard ⋯ menu of one row (View, Edit, the screen's items, Delete). */
  const standardMenu = (row: T): ReactNode => {
    if (!rowActions) return null;
    const { view: onView, edit, canEdit, remove, canRemove, more } = rowActions;
    const edits = !!edit && (canEdit?.(row) ?? true);
    const removes = !!remove && (canRemove?.(row) ?? true);
    const extra = more?.(row);
    if (!onView && !edits && !removes && !extra) return <span aria-hidden className="inline-block size-10 align-middle" />;
    return (
      <RowMenu label={t("Options for {name}", { name: nameOf(row) })}>
        {onView ? <MenuItem icon={<EyeIcon />} onSelect={() => onView(row)}>{t("View|verb")}</MenuItem> : null}
        {edits ? <MenuItem icon={<PencilSimpleIcon />} onSelect={() => edit!(row)}>{t("Edit")}</MenuItem> : null}
        {extra}
        {removes ? (
          <>
            {onView || edits || extra ? <MenuSeparator /> : null}
            <MenuItem icon={<TrashIcon />} danger onSelect={() => { setTarget(row); setAsking(true); }}>
              {verb === "remove" ? t("Remove") : t("Delete")}
            </MenuItem>
          </>
        ) : null}
      </RowMenu>
    );
  };
  const rowButtons = actions || rowActions
    ? (row: T) => (actions && rowActions ? <span className="inline-flex items-center gap-1">{actions(row)}{standardMenu(row)}</span> : actions ? actions(row) : standardMenu(row))
    : undefined;

  const selectable = selection ? pageRows.filter((r) => selection.canSelect?.(r) ?? true) : [];
  const pageIds = selectable.map(rowId);
  const ticked = selection ? pageIds.filter((id) => selection.selected.has(id)).length : 0;
  const tickPage = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    const all = pageIds.length > 0 && ticked === pageIds.length;
    for (const id of pageIds) {
      if (all) next.delete(id);
      else next.add(id);
    }
    selection.onChange(next);
  };
  const tick = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };

  const titleCols = columns.filter((c) => c.card === "title");
  const firstTitle = titleCols[0]?.id ?? columns[0]?.id;
  const openRow = (e: MouseEvent, row: T) => {
    if (!onOpen) return;
    // A click inside a dialog a row action opened (a portal) bubbles here through React: not a row click.
    if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    onOpen(row);
  };
  const titleCell = (c: Column<T>, row: T) => {
    const body = c.cell(row);
    if (!onOpen || c.id !== firstTitle) return body;
    return (
      <button type="button" onClick={() => onOpen(row)}
        className="max-w-full min-w-0 rounded-sm text-left hover:underline focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none">
        {body}
      </button>
    );
  };

  const searched = !!state.q.trim();
  const filtered = Object.values(state.f).some(Boolean);
  const clearAll = () => set({ q: "", f: Object.fromEntries(Object.keys(state.f).map((k) => [k, ""])) });
  const tools = !!(toolbarActions || exportName || onImport || onAdd);
  const hasToolbar = !noSearch || filters || tools || cards;

  let content: ReactNode;
  if (loading) {
    content = (
      <div className="grid gap-2" aria-busy="true" aria-label={t("Loading")}>
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 rounded-[var(--radius-md)]" />)}
      </div>
    );
  } else if (error && !pageRows.length) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
        <WarningCircleIcon size={18} className="shrink-0" />
        <span className="min-w-0 flex-1 break-words">{t("Could not load this list.")} {errorMessage(error)}</span>
        {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>{t("Try again")}</Button> : null}
      </div>
    );
  } else if (!pageRows.length) {
    content = searched || filtered || !empty ? (
      <div className="grid justify-items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-border bg-surface/60 px-6 py-10 text-center">
        <MagnifyingGlassIcon size={22} className="text-muted" />
        <p className="text-[13.5px] text-muted">
          {searched ? t("Nothing matches “{q}”.", { q: state.q.trim() }) : filtered ? t("Nothing matches these filters.") : t("Nothing to show here yet.")}
        </p>
        {searched ? <Button size="sm" variant="outline" onClick={() => set({ q: "" })}>{t("Clear search")}</Button>
          : filtered ? <Button size="sm" variant="outline" onClick={clearAll}>{t("Clear filters")}</Button> : null}
      </div>
    ) : empty;
  } else if (cards) {
    content = (
      <ul aria-label={label} className="grid gap-2">
        {pageRows.map((row) => {
          const id = rowId(row);
          const canTick = !!selection && (selection.canSelect?.(row) ?? true);
          const on = canTick && selection!.selected.has(id);
          const fields = columns.filter((c) => (c.card ?? "field") === "field");
          const full = columns.filter((c) => c.card === "full");
          const heads = titleCols.length ? titleCols : columns.slice(0, 1);
          return (
            <li key={id} onClick={(e) => openRow(e, row)}
              className={cn("grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-[var(--shadow-soft)]",
                onOpen && "cursor-pointer active:bg-surface-2/60", on && "border-accent/40 bg-accent-soft/40", rowClassName?.(row))}>
              <div className="flex min-w-0 items-start gap-2">
                {canTick ? <span className="pt-1"><Tick checked={on} onChange={() => tick(id)} label={t("Select {name}", { name: rowLabel?.(row) ?? id })} /></span> : null}
                <div className="grid min-w-0 flex-1 gap-0.5 break-words">
                  {heads.map((c) => <div key={c.id} className="min-w-0">{titleCell(c, row)}</div>)}
                </div>
                {rowButtons ? <div className="-my-1 -mr-1 flex shrink-0 items-center gap-1">{rowButtons(row)}</div> : null}
              </div>
              {fields.length ? (
                <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-border/70 pt-2 text-[13px]">
                  {fields.map((c) => (
                    <div key={c.id} className="contents">
                      <dt className="text-muted">{c.header}</dt>
                      <dd className={cn("min-w-0 break-words", c.align === "right" && "tabular")}>{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {full.map((c) => <div key={c.id} className="min-w-0">{c.cell(row)}</div>)}
            </li>
          );
        })}
      </ul>
    );
  } else {
    content = (
      // A scroll box no taller than the screen, so the heading stays in sight (sticky) on long pages.
      <div className={cn("overflow-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-soft)] [scrollbar-width:thin]",
        stickyHeader && "max-h-[max(26rem,calc(100dvh-9rem))]")}>
        <table aria-labelledby={captionId} className="w-full border-separate border-spacing-0 text-[13px]">
          <caption id={captionId} className="sr-only">{label}</caption>
          <thead className="sticky top-0 z-[1] bg-surface-2 [&_th]:border-b [&_th]:border-border">
            <tr>
              {selection ? (
                <th scope="col" className="w-10 bg-surface-2 px-3 py-2.5 text-left">
                  <Tick checked={pageIds.length > 0 && ticked === pageIds.length} indeterminate={ticked > 0 && ticked < pageIds.length}
                    onChange={tickPage} label={t("Select every row on this page")} />
                </th>
              ) : null}
              {columns.map((c) => {
                const sortable = isSortable(c, mode);
                const on = sortable && state.sort === c.id;
                return (
                  <th key={c.id} scope="col" aria-sort={on ? (state.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("bg-surface-2 px-3 py-2.5 text-[11.5px] font-semibold tracking-[0.04em] whitespace-nowrap text-muted uppercase",
                      c.align === "right" ? "text-right" : "text-left", c.hideBelow && HIDE[c.hideBelow])}>
                    {sortable ? (
                      <button type="button" onClick={() => set(nextSort(state, c.id, c.kind))}
                        className={cn("inline-flex items-center gap-1 rounded-sm uppercase hover:text-fg focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none",
                          c.align === "right" && "flex-row-reverse", on && "text-fg")}>
                        {c.header}
                        {on ? (state.dir === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)
                          : <CaretUpDownIcon size={12} className="opacity-50" />}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
              {rowButtons ? <th scope="col" className="w-12 bg-surface-2 px-3 py-2.5"><span className="sr-only">{t("Actions")}</span></th> : null}
            </tr>
          </thead>
          <tbody className="[&>tr:not(:last-child)>td]:border-b [&>tr>td]:border-border/70">
            {pageRows.map((row) => {
              const id = rowId(row);
              const canTick = !!selection && (selection.canSelect?.(row) ?? true);
              const on = canTick && selection!.selected.has(id);
              return (
                <tr key={id} onClick={(e) => openRow(e, row)}
                  className={cn("align-middle transition-colors hover:bg-surface-2/45", onOpen && "cursor-pointer", on && "bg-accent-soft/40 hover:bg-accent-soft/55", rowClassName?.(row))}>
                  {selection ? (
                    <td className="px-3 py-2.5">{canTick ? <Tick checked={on} onChange={() => tick(id)} label={t("Select {name}", { name: rowLabel?.(row) ?? id })} /> : null}</td>
                  ) : null}
                  {columns.map((c) => (
                    <td key={c.id} className={cn("px-3 py-2.5 break-words", c.card === "title" && "min-w-56", c.align === "right" && "text-right tabular", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {titleCell(c, row)}
                    </td>
                  ))}
                  {rowButtons ? <td className="px-1 py-1.5 text-right whitespace-nowrap">{rowButtons(row)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3", className)}>
      {hasToolbar ? (
        // Phones: the search box across, filters and the sort menu two to a row.
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 sm:flex sm:flex-wrap sm:items-center">
          {noSearch ? null : (
            <div className="col-span-2 min-w-0 sm:flex-1 sm:basis-60">
              <SearchBox key={label} control={control} placeholder={searchPlaceholder} label={searchPlaceholder ?? t("Search {list}", { list: label })} />
            </div>
          )}
          {filters}
          {cards ? <div className="min-w-0 sm:w-56"><SortMenu columns={columns} control={control} mode={mode} /></div> : null}
          {filters && filtered ? (
            <Button variant="ghost" className="justify-start sm:justify-center" onClick={clearAll}>
              <XIcon size={14} /> {t("Clear filters")}
            </Button>
          ) : null}
          {tools ? (
            <div className="col-span-2 flex flex-wrap items-center gap-2 sm:ml-auto">
              {toolbarActions}
              {exportName ? (
                <Button variant="outline" loading={exporting} disabled={loading || !total} onClick={() => void exportFiltered()}
                  title={total === 1 ? t("Save the 1 row shown as a CSV file") : t("Save the {n} rows shown as a CSV file", { n: total })}>
                  <DownloadSimpleIcon size={16} /> {t("Export")}
                </Button>
              ) : null}
              {onImport ? <Button variant="outline" onClick={onImport}><FileArrowUpIcon size={16} /> {importLabel ?? t("Import")}</Button> : null}
              {onAdd ? <Button onClick={onAdd}><PlusIcon size={16} weight="bold" /> {addLabel ?? t("Add")}</Button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {selection && (bulk || exportName || bulkRemove) && selection.selected.size ? (
        <div role="region" aria-label={t("Ticked rows")}
          className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-surface px-3 py-2 shadow-sm">
          <span className="text-[13px] font-medium tabular">{selection.selected.size === 1 ? t("1 ticked") : t("{n} ticked", { n: selection.selected.size })}</span>
          {bulk?.(selection.selected)}
          {exportName ? (
            <Button size="sm" variant="outline" onClick={exportTicked}><DownloadSimpleIcon size={14} /> {t("Export ticked")}</Button>
          ) : null}
          {bulkRemove ? (
            <Button size="sm" variant="outline" disabled={!removable.length} onClick={() => setBulkAsking(true)}
              className="text-danger hover:border-danger/40 hover:bg-danger/8">
              <TrashIcon size={14} /> {bulkVerb === "remove" ? t("Remove ticked") : t("Delete ticked")}
            </Button>
          ) : null}
          {bulk ? null : (
            <Button size="sm" variant="ghost" onClick={() => selection.onChange(new Set())}><XIcon size={14} /> {t("Clear")}</Button>
          )}
        </div>
      ) : null}
      {cards && selection && pageIds.length ? (
        <div>
          <Button size="sm" variant="outline" onClick={tickPage}>{ticked === pageIds.length ? t("Untick this page") : t("Tick this page")}</Button>
        </div>
      ) : null}
      <div className={cn("grid min-w-0 gap-3 transition-opacity", fetching && "opacity-70")}>{content}</div>
      <p className="sr-only" aria-live="polite">{loading ? "" : total === 1 ? t("1 row") : t("{n} rows", { n: total })}</p>
      {!loading && total > Math.min(...pageSizes) ? <Pager control={control} total={total} sizes={pageSizes} noun={label} /> : null}
      {rowActions?.remove ? (
        <ConfirmDialog
          open={asking}
          onOpenChange={setAsking}
          title={target ? (verb === "remove" ? t("Remove {name}?", { name: nameOf(target) }) : t("Delete {name}?", { name: nameOf(target) })) : ""}
          body={target ? (rowActions.removeBody?.(target) ?? t("This cannot be undone.")) : null}
          confirmLabel={verb === "remove" ? t("Remove") : t("Delete")}
          danger
          onConfirm={removeOne}
        />
      ) : null}
      {bulkRemove ? (
        <ConfirmDialog
          open={bulkAsking}
          onOpenChange={setBulkAsking}
          title={bulkRemove.title ? bulkRemove.title(removable.length) : bulkVerb === "remove"
            ? (removable.length === 1 ? t("Remove 1 ticked row?") : t("Remove {n} ticked rows?", { n: removable.length }))
            : (removable.length === 1 ? t("Delete 1 ticked row?") : t("Delete {n} ticked rows?", { n: removable.length }))}
          body={
            <span className="grid gap-2">
              <span>{bulkRemove.body ?? t("This cannot be undone.")}</span>
              {keptBack > 0 ? <span>{keptBack === 1 ? t("1 ticked row is not yours to change and stays.") : t("{n} ticked rows are not yours to change and stay.", { n: keptBack })}</span> : null}
            </span>
          }
          confirmLabel={bulkVerb === "remove" ? t("Remove") : t("Delete")}
          danger
          onConfirm={removeTicked}
        />
      ) : null}
    </div>
  );
}
