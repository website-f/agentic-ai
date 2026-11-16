/**
 * P107 (Fitri, 16 Nov 2026: "some pages show lists whereby the things got too many ... use datatables instead with filter
 * and search ... fully responsive, beautifully done, mobile friendly"): one table for every long list in Prima.
 * Modelled on the office's apps/web/src/components/ui/data-table.tsx, but client-side only (Prima's API has no paging):
 * the screen loads its records as before and hands them all to the table, which searches, filters, sorts and pages them.
 * The rules live in datatable-model.ts (tested by scripts/datatable.test.mjs); the look in styles/datatable.css.
 *
 * HOW TO USE (for the engineers converting screens)
 *
 *   import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
 *
 *   const columns: DtColumn<Staff>[] = [
 *     { id: 'name', label: 'Name', value: (s) => s.name, render: (s) => <Person name={s.name} sub={s.title} />, phone: 'title' },
 *     { id: 'title', label: 'Job title', value: (s) => s.title, phone: 'sub' },
 *     { id: 'company', label: 'Company', value: (s) => companyName(s.companyId), hideBelow: 1100 },
 *     { id: 'joined', label: 'Joined', value: (s) => s.joinedOn, sort: 'date' },          // shows "3 Nov 2026"
 *     { id: 'pay', label: 'Basic pay', value: (s) => s.basic, sort: 'money' },           // right-aligned, "RM1,234.50"
 *     { id: 'status', label: 'Status', value: (s) => s.status, translate: true, render: (s) => <Chip tone="ok">{s.status}</Chip> },
 *   ];
 *   const filters: DtFilter<Staff>[] = [
 *     { id: 'company', label: 'Company', value: (s) => s.companyId, optionLabel: companyName },  // options from the rows
 *     { id: 'status', label: 'Status', value: (s) => s.status },
 *   ];
 *   <DataTable label="Staff" stateKey="hr.staff" rows={data.staff} rowKey={(s) => s.id} columns={columns}
 *     filters={filters} onRowClick={(s) => setOpen(s.id)}
 *     actions={(s) => [{ label: 'Edit', onClick: () => edit(s) }, { label: 'Remove', tone: 'danger', onClick: () => remove(s) }]}
 *     loading={loading} error={error} empty={<Empty title="No staff yet." />} />
 *
 * - Every label is written in English; the page translator (i18n.ts) shows it in BM. Add a BM row for each new label.
 * - `value` is what a column sorts, searches and (without `render`) shows. Keep it plain text, a number or an ISO date.
 *   A column without `value` only draws (`render`) and is not sorted or searched. `translate: true` lets the search find
 *   a value by its BM wording too (statuses, kinds); names are found as typed.
 * - `sort`: 'text' | 'number' | 'date' | 'money' (or false). Numbers and money are right-aligned with tabular figures.
 * - `hideBelow`: a screen width in px under which the column drops out of the computer table (it stays on phone cards).
 * - Phones (< 768 px) get cards: `phone: 'title'` lines lead the card (default: the first column), `'sub'` lines sit
 *   under it in grey, `'fact'` (default) shows "label: value" (at most `phoneFacts`, default 4), `'hidden'` leaves it off.
 * - Filters are pick-lists above the table. Options come from the rows (each value once, A to Z) unless given; a row may
 *   give several values (a person in two companies). A filter with fewer than two choices is not shown.
 * - `stateKey` keeps the search, filters, sort, page and page size for the visit (sessionStorage), so Back returns to the
 *   same rows. Give each table its own key ("hr.staff", "claims.mine"). `defaults` sets the first state (e.g. a status).
 *   A tile or button outside the table that picks a filter: hold the state with `useTableState(key)` and pass `control`.
 * - A screen that searched on the server (`api.x(q)`) now loads once without the search and lets the table search.
 * - Row click (`onRowClick`) opens what clicking did before. Row actions: one action shows as a small button, several as
 *   a ⋯ menu. `rowEnd` draws the screen's own controls in the last cell when a menu does not fit; `rowDetail` draws a
 *   block under the row across the table (an item list, a comment box with Approve / Return). `rowTone` gives a
 *   row a coloured left edge (warn / crit / info) where the old list had one.
 * - Row ticks (`selection` + `bulk`) only where the screen already has bulk actions.
 * - Never change what a screen loads, who may see it or what its buttons do: the table only arranges the rows.
 *
 * P107b (Fitri, 16 Nov 2026: View, Edit, Delete with confirmation, ticks with bulk delete, Export, Add and Import on
 * every table). All optional; a screen gives only what Prima already lets that person do:
 *
 *   <DataTable ...
 *     onView={(s) => setOpen(s.id)}            // the screen's own drawer or card; or `details` for a read-only drawer of
 *                                              // every column when the screen has none. A row click opens it too.
 *     onEdit={(s) => setEditing(s.id)} editLabel="Edit site" canEdit={(s) => mayEdit}  // the EXISTING edit form
 *     onDelete={(s, reason) => api.closeX(s.id, reason)} deleteLabel="Close site" deleteReason canDelete={...}
 *                                              // only when the API already has the action; asks first (a dialog,
 *                                              // with a reason box when `deleteReason`), ticks get "Delete ticked"
 *     onDeleteMany={(rows, reason) => api.closeMany(...)}   // optional one call for many; default one by one
 *     exportable={false}                       // Export (CSV of the rows found, or the ticked ones) is on by default
 *     exportName="site-list"                   // file "site-list-2026-11-16.csv"; columns: `exportValue` or `false`
 *     selectable                               // ticks kept by the table (for Export ticked) when the screen has none
 *     onAdd={() => setAdding(true)} addLabel="Add site"          // the EXISTING create form
 *     importKind="site" importCompanyId={companyId}              // the universal importer (ImportDrawer), or
 *     onImport={() => setImporting(true)} importLabel="Import item list (Excel, CSV, PDF)"   // the screen's own
 *   />
 * - The row menu reads View, Edit, the screen's own `actions`, then Delete in red. Phone cards get the same menu.
 * - No new API route, permission or rule comes with these: the server still checks every call.
 */
import { Fragment, Suspense, lazy, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  PlusIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { ImportKind } from '@prima/core';
import { Empty, Search } from './kit';
import { Drawer, ErrorNotice, Loading, RefreshContext, dateLabel, money, notify } from './ui';
import { activateDrawer } from './drawer-focus';
import { useBackClose } from './back-close';
import { SearchSelect } from './SearchSelect';
import { tr, useLang } from './i18n';
import {
  DEFAULT_STATE,
  PAGE_SIZES,
  changeState,
  countLine,
  csvName,
  csvText,
  deriveOptions,
  exportGrid,
  exportRows,
  haystack,
  loadState,
  nextSort,
  pageButtons,
  reasonOk,
  runBulk,
  runEach,
  saveState,
  standardActions,
  viewRows,
  type Cell,
  type ColumnRule,
  type FilterRule,
  type ManyOutcome,
  type SortDir,
  type SortKind,
  type TableState,
} from './datatable-model';
import './styles/datatable.css';

// The universal importer (P81) loads only when a table offers it.
const ImportButton = lazy(() => import('./views/ImportDrawer').then((m) => ({ default: m.ImportButton })));

export type { SortKind, SortDir, TableState } from './datatable-model';

export interface DtColumn<T> extends ColumnRule<T> {
  /** The heading, in English (translated on screen). */
  label: string;
  /** How a cell is drawn; default: the value, formatted for its kind (money as RM, dates as "3 Nov 2026"). */
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Drop the column from the computer table on screens narrower than this many px (phone cards keep it). */
  hideBelow?: number;
  /** Its place on a phone card. Default: the first column is the title, the rest are facts. */
  phone?: 'title' | 'sub' | 'fact' | 'hidden';
  /** A CSS width for the computer column, e.g. '8rem'. */
  width?: string;
  className?: string;
}

export interface DtFilter<T> extends FilterRule<T> {
  /** The filter's name, in English ("Company"). */
  label: string;
  /** Fixed choices; default: each value found in the rows. */
  options?: { value: string; label: string }[];
  /** The words for a value found in the rows (a company id to its name). */
  optionLabel?: (value: string) => string;
  /** The "no filter" choice; default "All". */
  allLabel?: string;
}

export interface DtAction {
  label: string;
  onClick: () => void;
  tone?: 'danger';
  disabled?: boolean;
  icon?: ReactNode;
  /** Leave the action out for this row (e.g. not allowed). */
  hidden?: boolean;
}

export interface DataTableProps<T> {
  /** Names the table for screen readers, in English ("Staff"). */
  label: string;
  rows: readonly T[] | null | undefined;
  rowKey: (row: T) => string;
  columns: DtColumn<T>[];
  filters?: DtFilter<T>[];
  /** Keeps search, filters, sort and page for the visit (sessionStorage). One key per table. */
  stateKey?: string;
  /** The first state: a sort, a page size, a chosen filter. */
  defaults?: Partial<TableState>;
  /** Extra text a row is found by (a staff number, an IC). */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  noSearch?: boolean;
  onRowClick?: (row: T) => void;
  actions?: (row: T) => DtAction[];
  /** The screen's own controls for a row, drawn in the last cell / at the foot of a phone card. */
  rowEnd?: (row: T) => ReactNode;
  rowClass?: (row: T) => string | undefined;
  /** More about a row under it, across the whole table (an item list, a comment box with Approve and Return). */
  rowDetail?: (row: T) => ReactNode;
  /** A coloured edge on rows that need a look (the lists' old left stripe). */
  rowTone?: (row: T) => 'warn' | 'crit' | 'info' | undefined;
  /** Row ticks, only for screens that already have bulk actions. */
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void; canSelect?: (row: T) => boolean };
  /** Shown above the rows while any are ticked. */
  bulk?: ReactNode;
  /** More controls beside the filters (a month picker, an export button). */
  toolbar?: ReactNode;
  loading?: boolean;
  /** For "Loading staff…" (English). */
  loadingWhat?: string;
  error?: string | null;
  /** Shown when there are no rows at all. */
  empty?: ReactNode;
  pageSizes?: readonly number[];
  phoneFacts?: number;
  /** Forces the computer table or the phone cards (tests, narrow panels). */
  layout?: 'auto' | 'table' | 'cards';
  className?: string;
  /** The table's state held by the screen (`useTableState`), when something outside the table sets a filter (a tile). */
  control?: TableControl;

  // ---------- P107b: the standard tools (see the how-to at the top) ----------
  /** Export (CSV) of the rows found, or of the ticked rows when some are ticked. Default on. */
  exportable?: boolean;
  /** The file's name before the date; default: the label ("Site list" gives site-list-2026-11-16.csv). */
  exportName?: string;
  /** The screen's own detail view (drawer or card). Shown as View in the row menu; a row click opens it too. */
  onView?: (row: T) => void;
  /** A screen with no detail view: View and a row click open a read-only drawer with every column. */
  details?: boolean;
  viewLabel?: string;
  /** The record's name in the confirm dialog and the details drawer; default: the first column's value. */
  recordName?: (row: T) => string;
  /** The screen's EXISTING edit form for the row. */
  onEdit?: (row: T) => void;
  editLabel?: string;
  canEdit?: (row: T) => boolean;
  /** The API's own delete / close / remove for one row. The table asks first; the server checks and may refuse. */
  onDelete?: (row: T, reason: string) => Promise<unknown>;
  /** One call for several ticked rows (returns `{ done, failed }` keys, or nothing for all done); default: `onDelete` one by one. */
  onDeleteMany?: (rows: T[], reason: string) => Promise<unknown>;
  /** Says truthfully what happens: "Close site", "Remove from directory". Default "Delete". */
  deleteLabel?: string;
  canDelete?: (row: T) => boolean;
  /** The dialog asks for a reason (Prima: a change says why); the reason goes to `onDelete`. */
  deleteReason?: boolean;
  /** A line under the question: what happens to the record ("It stays in the history, closed."). */
  deleteNote?: string;
  /** Row ticks kept by the table (Export ticked) on a screen without its own `selection`. On with `onDelete`. */
  selectable?: boolean;
  /** The screen's EXISTING create form. */
  onAdd?: () => void;
  addLabel?: string;
  /** The screen's own importer (e.g. Items' SmartImport). */
  onImport?: () => void;
  importLabel?: string;
  /** The universal importer for this kind of record (ImportDrawer); it shows only for those who may import it. */
  importKind?: ImportKind;
  importCompanyId?: string | null;
}

export interface TableControl {
  state: TableState;
  /** Merge a change (`f` merges too); anything but `page` goes back to page 1. */
  set: (change: Partial<TableState>) => void;
}

/**
 * The table's state, kept for the visit under `stateKey` (sessionStorage). A screen calls it itself only when it must
 * change the table from outside (a tile that picks a filter): `const t = useTableState('people.list');
 * <Stat onClick={() => t.set({ f: { work: 'no' } })} />  <DataTable control={t} ... />`.
 */
export function useTableState(stateKey?: string, defaults?: Partial<TableState>): TableControl {
  const base: TableState = useMemo(() => ({ ...DEFAULT_STATE, ...defaults, f: { ...defaults?.f } }), [JSON.stringify(defaults ?? {})]); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<TableState>(() => loadState(stateKey, base));
  useEffect(() => saveState(stateKey, state), [stateKey, state]);
  return { state, set: (change: Partial<TableState>) => setState((s) => changeState(s, change)) };
}

const PHONE_BELOW = 768;
const INTERACTIVE = 'a,button,input,select,textarea,label,[role=button],[role=combobox],[role=menuitem],[data-no-row-click]';

/** The window's width, kept current (one listener per table; tables are few on a screen). */
function useWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1366 : window.innerWidth));
  useEffect(() => {
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setW(window.innerWidth));
    };
    window.addEventListener('resize', on);
    on();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', on);
    };
  }, []);
  return w;
}

/** A value as people read it, for its kind. */
export function formatCell(v: Cell, kind: SortKind | false | undefined): ReactNode {
  if (v == null || v === '') return '–';
  if (kind === 'money') return money(typeof v === 'number' ? v : Number(v));
  if (kind === 'date') return typeof v === 'string' ? dateLabel(v) : String(v);
  if (kind === 'number' && typeof v === 'number') return v.toLocaleString('en-MY');
  return String(v);
}

const isNumeric = (c: DtColumn<unknown>) => c.sort === 'number' || c.sort === 'money';
const alignOf = <T,>(c: DtColumn<T>) => c.align ?? (isNumeric(c as DtColumn<unknown>) ? 'right' : 'left');
const sortable = <T,>(c: DtColumn<T>) => !!c.value && c.sort !== false;
const kindOf = <T,>(c: DtColumn<T>): SortKind => (c.sort || 'text') as SortKind;

function draw<T>(c: DtColumn<T>, row: T): ReactNode {
  return c.render ? c.render(row) : formatCell(c.value?.(row), c.sort);
}

/** The search box: shows what is typed at once, searches once typing settles. */
function SearchBox({ q, onSearch, placeholder }: { q: string; onSearch: (q: string) => void; placeholder: string }) {
  const [typed, setTyped] = useState(q);
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    // Cleared from outside (the Clear button): show it.
    setSeen(q);
    setTyped(q);
  }
  const latest = useRef(onSearch);
  latest.current = onSearch;
  useEffect(() => {
    if (typed.trim() === q.trim()) return;
    const t = setTimeout(() => latest.current(typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed, q]);
  return <Search value={typed} onChange={setTyped} placeholder={placeholder} />;
}

/** A row's actions: one is a small button; several open a menu (a sheet from the bottom on a phone). */
export function RowActions({ items }: { items: DtAction[] }) {
  const shown = items.filter((a) => !a.hidden);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!shown.length) return null;
  if (shown.length === 1) {
    const a = shown[0];
    return (
      <button type="button" className={a.tone === 'danger' ? 'btn btn-sm dt-act dt-danger' : 'btn btn-sm dt-act'} disabled={a.disabled} onClick={a.onClick}>
        {a.icon}
        {a.label}
      </button>
    );
  }
  const menuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
  };
  return (
    <div className="dt-menu" ref={box}>
      <button type="button" className="btn btn-ghost btn-sm dt-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label="More actions" title="More actions" onClick={() => setOpen(!open)}>
        <DotsThreeVerticalIcon size={18} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="dt-menu-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="dt-menu-list" role="menu" id={id} aria-label="Actions" onKeyDown={menuKey}>
            {shown.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                className="dt-menu-item"
                data-tone={a.tone}
                disabled={a.disabled}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tick({ checked, mixed, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!mixed;
  }, [mixed]);
  return (
    <label className="dt-tick" data-no-row-click>
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
    </label>
  );
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    label, rows: given, rowKey, columns, filters = [], stateKey, defaults, searchText, searchPlaceholder = 'Search', noSearch,
    onRowClick, actions, rowEnd, rowClass, rowTone, rowDetail, bulk, toolbar, loading, loadingWhat = 'list', error, empty,
    pageSizes = PAGE_SIZES, phoneFacts = 4, layout = 'auto', className, control,
    exportable = true, exportName, onView, details, viewLabel, recordName, onEdit, editLabel, canEdit, onDelete, onDeleteMany,
    deleteLabel = 'Delete', canDelete, deleteReason, deleteNote, selectable, onAdd, addLabel = 'Add', onImport, importLabel,
    importKind, importCompanyId,
  } = props;
  const { lang } = useLang();
  const width = useWidth();
  const cards = layout === 'cards' || (layout === 'auto' && width < PHONE_BELOW);
  const rows = useMemo(() => (given ?? []) as T[], [given]);
  const captionId = useId();

  const own = useTableState(control ? undefined : stateKey, defaults);
  const { state, set } = control ?? own;
  const { bump } = useContext(RefreshContext);

  // P107b: ticks kept by the table itself (Export ticked, Delete ticked) when the screen has no selection of its own.
  const [ownTicks, setOwnTicks] = useState<Set<string>>(() => new Set());
  const selection: DataTableProps<T>['selection'] = props.selection ?? (selectable || onDelete ? { selected: ownTicks, onChange: setOwnTicks } : undefined);
  // The details drawer (by key, so a reload shows the new values) and the delete dialog.
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [shownRow, setShownRow] = useState<T | null>(null);
  const [deleting, setDeleting] = useState<T[] | null>(null);
  const nameOf = (row: T): string => {
    if (recordName) return recordName(row);
    const c = columns.find((x) => x.value);
    const v = c?.value?.(row);
    return v == null || v === '' ? label : String(v);
  };
  const openDetails = (row: T) => {
    setShownKey(rowKey(row));
    setShownRow(row);
  };
  const viewOf = onView ?? (details ? openDetails : undefined);
  const rowClick = onRowClick ?? viewOf;
  const mayDelete = (row: T) => !!onDelete && (canDelete?.(row) ?? true);
  const menuOf = (row: T): DtAction[] =>
    standardActions(row, {
      view: viewOf,
      viewLabel,
      edit: onEdit,
      editLabel,
      canEdit,
      remove: onDelete ? (r: T) => setDeleting([r]) : undefined,
      deleteLabel,
      canDelete,
      extra: actions?.(row),
    }) as DtAction[];

  // Each row's search text, once per load and language (the BM wording of statuses is looked up here, not per key press).
  const latest = useRef({ columns, searchText });
  latest.current = { columns, searchText };
  const hay = useMemo(() => {
    const t = lang === 'en' ? null : (s: string) => tr(s, lang);
    const cache = new Map<T, string>();
    return (r: T) => {
      let h = cache.get(r);
      if (h === undefined) cache.set(r, (h = haystack(r, latest.current.columns, t, latest.current.searchText)));
      return h;
    };
    // Columns and searchText are usually written inline: the column ids stand for them, so the cache lasts per load.
  }, [rows, lang, columns.map((c) => c.id).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filters: their choices from all rows; only filters with two or more choices (or one chosen) are shown.
  const filterChoices = useMemo(
    () =>
      filters
        .map((f) => {
          const opts = f.options ?? deriveOptions(rows, f).map((o) => ({ value: o.value, label: f.optionLabel ? f.optionLabel(o.value) : o.value }));
          const chosen = state.f[f.id] ?? '';
          const all = chosen && !opts.some((o) => o.value === chosen) ? [...opts, { value: chosen, label: f.optionLabel ? f.optionLabel(chosen) : chosen }] : opts;
          return { f, options: all, chosen };
        })
        .filter((x) => x.options.length >= 2 || x.chosen),
    [rows, filters, state.f],
  );

  const view = useMemo(() => viewRows(rows, columns, filters, state, hay), [rows, columns, filters, state, hay]);
  const { page } = view;
  const searched = !!state.q.trim() || Object.values(state.f).some(Boolean);

  const visible = cards ? columns : columns.filter((c) => !c.hideBelow || width >= c.hideBelow);
  const hasMenu = !!actions || !!viewOf || !!onEdit || !!onDelete;
  const hasActions = hasMenu || !!rowEnd;

  // Ticks on this page.
  const tickable = selection ? view.rows.filter((r) => selection.canSelect?.(r) ?? true) : [];
  const pageIds = tickable.map(rowKey);
  const ticked = selection ? pageIds.filter((id) => selection.selected.has(id)).length : 0;
  // Every row the search and filters found (all pages) that may be ticked: "Tick all 40" picks a whole department.
  const foundIds = selection ? view.all.filter((r) => selection.canSelect?.(r) ?? true).map(rowKey) : [];
  const allFound = foundIds.length > 0 && foundIds.every((id) => selection!.selected.has(id));
  const tickFound = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const id of foundIds) (allFound ? next.delete(id) : next.add(id));
    selection.onChange(next);
  };
  const tickPage = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    const all = pageIds.length > 0 && ticked === pageIds.length;
    for (const id of pageIds) (all ? next.delete(id) : next.add(id));
    selection.onChange(next);
  };
  const tick = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };

  const open = (e: MouseEvent, row: T) => {
    if (!rowClick) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    rowClick(row);
  };
  const openKey = (e: KeyboardEvent, row: T) => {
    if (!rowClick || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      rowClick(row);
    }
  };
  const rowActions = (row: T) =>
    hasActions ? (
      <>
        {rowEnd?.(row)}
        {hasMenu && <RowActions items={menuOf(row)} />}
      </>
    ) : null;

  // ---------- P107b: export, ticked rows, delete ----------
  const canExport = exportable && rows.length > 0;
  const tickedRows = selection && selection.selected.size > 0 ? rows.filter((r) => selection.selected.has(rowKey(r))) : [];
  const deletableTicked = onDelete ? tickedRows.filter(mayDelete) : [];
  const doExport = (ticked: boolean) => {
    const t = lang === 'en' ? (x: string) => x : (x: string) => tr(x, lang);
    const out = exportRows(view.all, rows, ticked && selection ? selection.selected : null, rowKey);
    download(csvText(exportGrid(out, columns, t)), csvName(exportName ?? label));
  };
  const runDelete = async (list: T[], reason: string): Promise<ManyOutcome> => {
    const outcome =
      list.length > 1 && onDeleteMany
        ? await runBulk(list, (rs) => onDeleteMany(rs, reason), rowKey, nameOf)
        : await runEach(list, (r) => onDelete!(r, reason), rowKey, nameOf);
    if (outcome.done.length) {
      if (selection) {
        const next = new Set(selection.selected);
        for (const k of outcome.done) next.delete(k);
        if (next.size !== selection.selected.size) selection.onChange(next);
      }
      if (shownKey && outcome.done.includes(shownKey)) setShownKey(null);
      bump();
    }
    return outcome;
  };
  const shown = shownKey == null ? null : (rows.find((r) => rowKey(r) === shownKey) ?? shownRow);
  const hasTools = !!toolbar || canExport || !!onAdd || !!onImport || !!importKind;

  // ---------- body ----------
  let body: ReactNode;
  if (loading && !rows.length) body = <Loading what={loadingWhat} />;
  else if (error && !rows.length) body = null;
  else if (!rows.length) body = empty ?? <Empty title="Nothing here yet." />;
  else if (!view.rows.length)
    body = (
      <Empty
        title="Nothing matches your search or filters."
        action={
          <button type="button" className="btn btn-sm" onClick={() => set({ q: '', f: Object.fromEntries(Object.keys(state.f).map((k) => [k, ''])) })}>
            Clear search and filters
          </button>
        }
      />
    );
  else if (cards) {
    const titles = columns.filter((c) => c.phone === 'title');
    const heads = titles.length ? titles : columns.slice(0, 1);
    const subs = columns.filter((c) => c.phone === 'sub');
    const facts = columns.filter((c) => !heads.includes(c) && (c.phone ?? 'fact') === 'fact').slice(0, phoneFacts);
    body = (
      <ul className="dt-cards" aria-label={label}>
        {view.rows.map((row) => {
          const id = rowKey(row);
          const canTick = !!selection && (selection.canSelect?.(row) ?? true);
          const on = canTick && selection!.selected.has(id);
          return (
            <li key={id} className={['dt-card', rowClass?.(row)].filter(Boolean).join(' ')} data-click={rowClick ? '' : undefined} data-on={on || undefined} data-tone={rowTone?.(row)} onClick={(e) => open(e, row)}>
              <div className="dt-card-head">
                {canTick && <Tick checked={on} onChange={() => tick(id)} label="Select this row" />}
                <div className="dt-card-title">
                  {rowClick ? (
                    <button type="button" className="dt-card-open" onClick={() => rowClick(row)}>
                      {heads.map((c) => (
                        <span key={c.id} className="dt-card-line">{draw(c, row)}</span>
                      ))}
                    </button>
                  ) : (
                    heads.map((c) => (
                      <span key={c.id} className="dt-card-line">{draw(c, row)}</span>
                    ))
                  )}
                  {subs.map((c) => (
                    <span key={c.id} className="dt-card-sub">{draw(c, row)}</span>
                  ))}
                </div>
                {hasMenu && <div className="dt-card-menu"><RowActions items={menuOf(row)} /></div>}
              </div>
              {facts.length > 0 && (
                <dl className="dt-card-facts">
                  {facts.map((c) => (
                    <div key={c.id} data-align={alignOf(c)}>
                      <dt>{c.label}</dt>
                      <dd>{draw(c, row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {rowDetail && <div className="dt-card-detail">{rowDetail(row)}</div>}
              {rowEnd && <div className="dt-card-end">{rowEnd(row)}</div>}
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <div className="dt-scroll">
        <table className="dt-table" aria-labelledby={captionId} data-phone="scroll">
          <caption id={captionId} className="dt-sr">{label}</caption>
          <thead>
            <tr>
              {selection && (
                <th scope="col" className="dt-tick-col">
                  <Tick checked={pageIds.length > 0 && ticked === pageIds.length} mixed={ticked > 0 && ticked < pageIds.length} onChange={tickPage} label="Select every row on this page" />
                </th>
              )}
              {visible.map((c) => {
                const on = state.sort === c.id;
                return (
                  <th key={c.id} scope="col" data-align={alignOf(c)} style={c.width ? { width: c.width } : undefined} aria-sort={on ? (state.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {sortable(c) ? (
                      <button type="button" className="dt-sort" data-on={on || undefined} onClick={() => set(nextSort(state, c.id, kindOf(c)))}>
                        <span>{c.label}</span>
                        {on ? (state.dir === 'asc' ? <CaretUpIcon size={12} weight="bold" aria-hidden="true" /> : <CaretDownIcon size={12} weight="bold" aria-hidden="true" />) : <CaretUpDownIcon size={12} aria-hidden="true" className="dt-sort-idle" />}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
              {hasActions && (
                <th scope="col" className="dt-act-col">
                  <span className="dt-sr">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => {
              const id = rowKey(row);
              const canTick = !!selection && (selection.canSelect?.(row) ?? true);
              const on = canTick && selection!.selected.has(id);
              const detail = rowDetail?.(row);
              return (
                <Fragment key={id}>
                <tr
                  data-has-detail={detail ? '' : undefined}
                  className={[rowClick ? 'clickable' : '', rowClass?.(row) ?? ''].filter(Boolean).join(' ') || undefined}
                  data-on={on || undefined}
                  data-tone={rowTone?.(row)}
                  tabIndex={rowClick ? 0 : undefined}
                  onClick={(e) => open(e, row)}
                  onKeyDown={(e) => openKey(e, row)}
                >
                  {selection && <td className="dt-tick-col">{canTick && <Tick checked={on} onChange={() => tick(id)} label="Select this row" />}</td>}
                  {visible.map((c) => (
                    <td key={c.id} data-align={alignOf(c)} className={c.className}>
                      {draw(c, row)}
                    </td>
                  ))}
                  {hasActions && <td className="dt-act-col">{rowActions(row)}</td>}
                </tr>
                {detail && (
                  <tr className="dt-detail" data-tone={rowTone?.(row)}>
                    <td colSpan={visible.length + (selection ? 1 : 0) + (hasActions ? 1 : 0)}>{detail}</td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const sortChoices = columns.filter(sortable);
  const sizes = [...new Set([...pageSizes, state.size])].sort((a, b) => a - b);
  const showPager = !loading && view.matched > Math.min(...sizes);

  return (
    <div className={['dt', className].filter(Boolean).join(' ')} data-layout={cards ? 'cards' : 'table'}>
      {(rows.length > 0 || hasTools) && (!noSearch || filterChoices.length > 0 || hasTools || (cards && sortChoices.length > 0)) && (
        <div className="dt-bar">
          {!noSearch && rows.length > 0 && (
            <div className="dt-search">
              <SearchBox q={state.q} onSearch={(q) => set({ q })} placeholder={searchPlaceholder} />
            </div>
          )}
          {rows.length > 0 && filterChoices.map(({ f, options, chosen }) => (
            <label key={f.id} className="dt-filter" data-on={chosen ? '' : undefined}>
              <span className="dt-filter-label">{f.label}</span>
              <SearchSelect
                className="select"
                aria-label={f.label}
                value={chosen}
                onChange={(v) => set({ f: { [f.id]: v } })}
                options={[{ value: '', label: f.allLabel ?? 'All' }, ...options]}
              />
            </label>
          ))}
          {cards && rows.length > 1 && sortChoices.length > 0 && (
            <label className="dt-filter">
              <span className="dt-filter-label">Sort by</span>
              <SearchSelect
                className="select"
                aria-label="Sort by"
                value={state.sort ? `${state.sort}:${state.dir}` : ''}
                onChange={(v) => {
                  const [sort = '', dir = 'asc'] = v.split(':');
                  set({ sort, dir: dir as SortDir });
                }}
                options={[
                  { value: '', label: 'Usual order' },
                  ...sortChoices.flatMap((c) => {
                    const k = kindOf(c);
                    const [up, down] = k === 'date' ? ['Oldest first', 'Newest first'] : k === 'text' ? ['A to Z', 'Z to A'] : ['Lowest first', 'Highest first'];
                    const both = [
                      { value: `${c.id}:asc`, label: `${c.label}: ${up}` },
                      { value: `${c.id}:desc`, label: `${c.label}: ${down}` },
                    ];
                    return k === 'text' ? both : both.reverse();
                  }),
                ]}
              />
            </label>
          )}
          {searched && (
            <button type="button" className="btn btn-ghost btn-sm dt-clear" onClick={() => set({ q: '', f: Object.fromEntries(Object.keys(state.f).map((k) => [k, ''])) })}>
              <XIcon size={14} weight="bold" aria-hidden="true" />
              Clear
            </button>
          )}
          {hasTools && (
            <div className="dt-tools">
              {toolbar}
              {importKind && (
                <Suspense fallback={null}>
                  <ImportButton kind={importKind} companyId={importCompanyId ?? null} label={importLabel} />
                </Suspense>
              )}
              {onImport && (
                <button type="button" className="btn" onClick={onImport}>
                  <UploadSimpleIcon size={16} weight="bold" aria-hidden="true" />
                  {importLabel ?? 'Import from file'}
                </button>
              )}
              {canExport && (
                <button type="button" className="btn dt-export" onClick={() => doExport(tickedRows.length > 0)} title="Download the rows found as a CSV file (opens in Excel)">
                  <DownloadSimpleIcon size={16} weight="bold" aria-hidden="true" />
                  Export
                </button>
              )}
              {onAdd && (
                <button type="button" className="btn btn-primary" onClick={onAdd}>
                  <PlusIcon size={16} weight="bold" aria-hidden="true" />
                  {addLabel}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {error && <ErrorNotice error={error} />}
      {selection && selection.selected.size > 0 && (bulk || canExport || deletableTicked.length > 0) && (
        <div className="dt-bulk" role="region" aria-label="Ticked rows">
          <span className="dt-bulk-count">{`${selection.selected.size} ticked`}</span>
          {bulk}
          {canExport && (
            <button type="button" className="btn" onClick={() => doExport(true)}>
              <DownloadSimpleIcon size={16} weight="bold" aria-hidden="true" />
              Export ticked
            </button>
          )}
          {deletableTicked.length > 0 && (
            <button type="button" className="btn dt-danger-btn" onClick={() => setDeleting(deletableTicked)}>
              <TrashIcon size={16} weight="bold" aria-hidden="true" />
              {deleteLabel === 'Delete' ? 'Delete ticked' : deleteLabel}
            </button>
          )}
          {!bulk && (
            <button type="button" className="btn btn-ghost" onClick={() => selection.onChange(new Set())}>
              Untick all
            </button>
          )}
        </div>
      )}
      {selection && (cards || view.page.pages > 1) && foundIds.length > 0 && (
        <div className="dt-ticks">
          {cards && pageIds.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={tickPage}>
              {ticked === pageIds.length ? 'Untick this page' : 'Tick this page'}
            </button>
          )}
          {foundIds.length > pageIds.length && (
            <button type="button" className="btn btn-sm" onClick={tickFound}>
              {allFound ? 'Untick all' : `Tick all ${foundIds.length}`}
            </button>
          )}
        </div>
      )}
      {body}
      {rows.length > 0 && view.matched > 0 && (
        <nav className="dt-foot" aria-label="Pages">
          <span className="dt-count" aria-live="polite">{countLine(page.from, page.to, view.matched)}</span>
          {showPager && (
            <div className="dt-pager">
              <label className="dt-size">
                <span>Rows</span>
                <SearchSelect className="select" aria-label="Rows per page" value={String(state.size)} onChange={(v) => set({ size: Number(v) })} options={sizes.map((n) => ({ value: String(n), label: String(n) }))} />
              </label>
              <button type="button" className="btn btn-sm dt-page" disabled={page.page <= 1} onClick={() => set({ page: page.page - 1 })} aria-label="Previous page" title="Previous page">
                <CaretLeftIcon size={14} weight="bold" aria-hidden="true" />
              </button>
              {pageButtons(page.page, page.pages).map((p, i) =>
                p === '…' ? (
                  <span key={`gap${i}`} className="dt-gap" aria-hidden="true">…</span>
                ) : (
                  <button key={p} type="button" className="btn btn-sm dt-page" data-on={p === page.page || undefined} aria-current={p === page.page ? 'page' : undefined} onClick={() => set({ page: p })}>
                    {p}
                  </button>
                ),
              )}
              <button type="button" className="btn btn-sm dt-page" disabled={page.page >= page.pages} onClick={() => set({ page: page.page + 1 })} aria-label="Next page" title="Next page">
                <CaretRightIcon size={14} weight="bold" aria-hidden="true" />
              </button>
            </div>
          )}
        </nav>
      )}
      {shown && (
        <DetailsDrawer
          title={nameOf(shown)}
          sub={label}
          columns={columns}
          row={shown}
          onClose={() => setShownKey(null)}
          edit={onEdit && (canEdit?.(shown) ?? true) ? { label: editLabel ?? 'Edit', run: () => (setShownKey(null), onEdit(shown)) } : undefined}
          remove={mayDelete(shown) ? { label: deleteLabel, run: () => setDeleting([shown]) } : undefined}
        />
      )}
      {deleting && (
        <DeleteDialog
          names={deleting.map(nameOf)}
          label={deleteLabel}
          note={deleteNote}
          reasonRequired={!!deleteReason}
          run={(reason) => runDelete(deleting, reason)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** Saves the CSV through the browser's own download. */
function download(text: string, name: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** P107b: a row's details, read only, for a screen with no detail view of its own: every column, label and value. */
export function DetailsDrawer<T>({
  title,
  sub,
  columns,
  row,
  onClose,
  edit,
  remove,
}: {
  title: string;
  sub?: string;
  columns: DtColumn<T>[];
  row: T;
  onClose: () => void;
  edit?: { label: string; run: () => void };
  remove?: { label: string; run: () => void };
}) {
  return (
    <Drawer title={title} sub={sub} onClose={onClose}>
      <dl className="dt-details">
        {columns.map((c) => (
          <div key={c.id}>
            <dt>{c.label}</dt>
            <dd>{draw(c, row)}</dd>
          </div>
        ))}
      </dl>
      {(edit || remove) && (
        <div className="dt-details-actions">
          {edit && (
            <button type="button" className="btn btn-primary" onClick={edit.run}>
              {edit.label}
            </button>
          )}
          {remove && (
            <button type="button" className="btn dt-danger-btn" onClick={remove.run}>
              <TrashIcon size={16} weight="bold" aria-hidden="true" />
              {remove.label}
            </button>
          )}
        </div>
      )}
    </Drawer>
  );
}

/**
 * P107b: "Delete this?" in the kit's look (not the browser's confirm box): names the record (or how many), asks for a
 * reason when the screen needs one, shows the server's refusal in place, and after several says how many went through.
 */
export function DeleteDialog({
  names,
  label,
  note,
  reasonRequired,
  run,
  onClose,
}: {
  names: string[];
  label: string;
  note?: string;
  reasonRequired: boolean;
  run: (reason: string) => Promise<ManyOutcome>;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ManyOutcome | null>(null);
  // Escape, the scrim and the phone's Back close it, but not while the server is working.
  const busyRef = useRef(false);
  busyRef.current = busy;
  const close = useRef(onClose);
  close.current = () => {
    if (!busyRef.current) onClose();
  };
  useEffect(() => (box.current ? activateDrawer(box.current, () => close.current()) : undefined), []);
  useBackClose(true, () => close.current());
  const many = names.length > 1;
  const go = async () => {
    setBusy(true);
    setError(null);
    const o = await run(reason.trim());
    setBusy(false);
    if (!o.failed.length) {
      notify(many ? `${o.done.length} of ${names.length} done.` : 'Done.');
      onClose();
      return;
    }
    if (!many) setError(o.failed[0].error);
    else setOutcome(o);
  };
  const shownNames = names.slice(0, 5);
  return (
    <>
      <div className="scrim dt-dialog-scrim" onClick={() => close.current()} />
      <div ref={box} className="dt-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="dt-dialog-title">
          {many ? (
            <>
              {label} {names.length} {'records?'}
            </>
          ) : (
            <>
              <span>{label}</span> <q data-no-translate>{names[0]}</q>?
            </>
          )}
        </h2>
        {many && !outcome && (
          <ul className="dt-dialog-names" data-no-translate>
            {shownNames.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
            {names.length > shownNames.length && <li className="muted">{`and ${names.length - shownNames.length} more`}</li>}
          </ul>
        )}
        {note && <p className="muted small">{note}</p>}
        {outcome ? (
          <div className="dt-dialog-outcome" role="status">
            <p>
              <strong>{`${outcome.done.length} of ${names.length} done.`}</strong>
            </p>
            <p>{`${outcome.failed.length} could not be done:`}</p>
            <ul className="dt-dialog-names">
              {outcome.failed.slice(0, 8).map((f) => (
                <li key={f.key}>
                  <span data-no-translate>{f.name}</span>: {f.error}
                </li>
              ))}
              {outcome.failed.length > 8 && <li className="muted">{`and ${outcome.failed.length - 8} more`}</li>}
            </ul>
          </div>
        ) : (
          reasonRequired && (
            <label className="field">
              <span className="label">Reason (needed, 5 characters or more)</span>
              <textarea className="textarea" rows={3} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
            </label>
          )
        )}
        {error && <ErrorNotice error={error} />}
        <div className="dt-dialog-actions">
          {outcome ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className="btn" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={busy || !reasonOk(reason, reasonRequired)} aria-busy={busy || undefined} onClick={() => void go()}>
                <TrashIcon size={16} weight="bold" aria-hidden="true" />
                {busy ? 'Working…' : label}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
