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
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon, CaretUpDownIcon, CaretUpIcon, DotsThreeVerticalIcon, XIcon } from '@phosphor-icons/react';
import { Empty, Search } from './kit';
import { ErrorNotice, Loading, dateLabel, money } from './ui';
import { SearchSelect } from './SearchSelect';
import { tr, useLang } from './i18n';
import {
  DEFAULT_STATE,
  PAGE_SIZES,
  changeState,
  countLine,
  deriveOptions,
  haystack,
  loadState,
  nextSort,
  pageButtons,
  saveState,
  viewRows,
  type Cell,
  type ColumnRule,
  type FilterRule,
  type SortDir,
  type SortKind,
  type TableState,
} from './datatable-model';
import './styles/datatable.css';

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
    onRowClick, actions, rowEnd, rowClass, rowTone, rowDetail, selection, bulk, toolbar, loading, loadingWhat = 'list', error, empty,
    pageSizes = PAGE_SIZES, phoneFacts = 4, layout = 'auto', className, control,
  } = props;
  const { lang } = useLang();
  const width = useWidth();
  const cards = layout === 'cards' || (layout === 'auto' && width < PHONE_BELOW);
  const rows = useMemo(() => (given ?? []) as T[], [given]);
  const captionId = useId();

  const own = useTableState(control ? undefined : stateKey, defaults);
  const { state, set } = control ?? own;

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
  const hasActions = !!actions || !!rowEnd;

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
    if (!onRowClick) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    onRowClick(row);
  };
  const openKey = (e: KeyboardEvent, row: T) => {
    if (!onRowClick || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick(row);
    }
  };
  const rowActions = (row: T) =>
    hasActions ? (
      <>
        {rowEnd?.(row)}
        {actions && <RowActions items={actions(row)} />}
      </>
    ) : null;

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
            <li key={id} className={['dt-card', rowClass?.(row)].filter(Boolean).join(' ')} data-click={onRowClick ? '' : undefined} data-on={on || undefined} data-tone={rowTone?.(row)} onClick={(e) => open(e, row)}>
              <div className="dt-card-head">
                {canTick && <Tick checked={on} onChange={() => tick(id)} label="Select this row" />}
                <div className="dt-card-title">
                  {onRowClick ? (
                    <button type="button" className="dt-card-open" onClick={() => onRowClick(row)}>
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
                {actions && <div className="dt-card-menu"><RowActions items={actions(row)} /></div>}
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
                  className={[onRowClick ? 'clickable' : '', rowClass?.(row) ?? ''].filter(Boolean).join(' ') || undefined}
                  data-on={on || undefined}
                  data-tone={rowTone?.(row)}
                  tabIndex={onRowClick ? 0 : undefined}
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
      {(rows.length > 0 || toolbar) && (!noSearch || filterChoices.length > 0 || toolbar || (cards && sortChoices.length > 0)) && (
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
          {toolbar && <div className="dt-tools">{toolbar}</div>}
        </div>
      )}
      {error && <ErrorNotice error={error} />}
      {selection && bulk && selection.selected.size > 0 && (
        <div className="dt-bulk" role="region" aria-label="Ticked rows">
          <span className="dt-bulk-count">{`${selection.selected.size} ticked`}</span>
          {bulk}
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
    </div>
  );
}
