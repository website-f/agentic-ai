/** P50 one CRM object: its saved views (table, cards, board, calendar), search, filters and
 * sort, adding and opening records, CSV in and out, and (owner) its fields and views.
 * On a phone the table becomes cards and the calendar a list of days. */
import {
  CalendarBlankIcon, CaretLeftIcon, CaretRightIcon, DotsThreeIcon, DownloadSimpleIcon, FunnelIcon, KanbanIcon,
  PlusIcon, RowsIcon, SlidersHorizontalIcon, SquaresFourIcon, TableIcon, TrashIcon, UploadSimpleIcon, XIcon,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  addView, crmKeys, crmObjectQuery, deleteObject, deleteView, exportCsv, FILTER_OPS, importCsv, queryRows, summaryFields,
  updateRecord, updateView, valueText, type CrmField, type CrmObject, type CrmRow, type CrmView, type Filter, type Sort, type ViewKind,
} from "@/lib/crm-hub";
import { useDebounced } from "@/lib/paged";
import { cn } from "@/lib/utils";
import { useMedia } from "@/lib/use-media";

import { ChoiceChip, FieldValue } from "./field-input";
import { FieldsSheet } from "./fields";
import { RecordSheet } from "./record";

const PAGE = 100;
const KIND_ICON: Record<ViewKind, typeof TableIcon> = { table: TableIcon, cards: SquaresFourIcon, board: KanbanIcon, calendar: CalendarBlankIcon };

export function ObjectPage({ objectKey, isOwner }: { objectKey: string; isOwner: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { v?: string; r?: string };
  const detail = useQuery(crmObjectQuery(objectKey));
  const wide = useMedia("(min-width: 768px)");
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim());
  const [extra, setExtra] = useState<Filter[]>([]);
  const [sortOver, setSortOver] = useState<Sort | null>(null);
  const [adding, setAdding] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [newView, setNewView] = useState(false);

  const obj = detail.data?.object;
  const fields = useMemo(() => detail.data?.fields ?? [], [detail.data]);
  const views = detail.data?.views ?? [];
  const view: CrmView | undefined = views.find((v) => v.id === search.v) ?? views[0];
  const kind: ViewKind = view?.kind ?? "table";
  const shown = kind === "table" && !wide ? "cards" : kind;
  const filters = [...(view?.config.filters ?? []), ...extra];
  const sort = sortOver ? [sortOver] : view?.config.sort ?? [];

  const rows = useInfiniteQuery({
    queryKey: [...crmKeys.rows(objectKey), needle, filters, sort],
    queryFn: ({ pageParam }) => queryRows(objectKey, { q: needle, filters, sort, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (all.length * PAGE < last.total ? all.length * PAGE : undefined),
    enabled: !!obj,
  });
  const list = rows.data?.pages.flatMap((p) => p.rows) ?? [];
  const refs = Object.assign({}, ...(rows.data?.pages.map((p) => p.refs) ?? [])) as Record<string, string>;
  const total = rows.data?.pages[0]?.total ?? 0;

  const setView = (id: string) => void navigate({ to: "/crm", search: (s: Record<string, unknown>) => ({ ...s, v: id, r: undefined }) as never, replace: true });
  const openRecord = (id: string) => void navigate({ to: "/crm", search: (s: Record<string, unknown>) => ({ ...s, r: id }) as never });
  const closeRecord = () => void navigate({ to: "/crm", search: (s: Record<string, unknown>) => ({ ...s, r: undefined }) as never });

  const removeObject = useMutation({
    mutationFn: () => deleteObject(objectKey),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: crmKeys.all }); void navigate({ to: "/crm", search: {} as never }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (detail.isLoading) return <Skeleton className="h-80 rounded-[var(--radius-md)]" />;
  if (detail.error || !obj) return <p role="alert" className="text-danger">{errorMessage(detail.error)}</p>;

  const canAdd = obj.can_edit && obj.kind !== "builtin";

  return (
    <div className="grid min-w-0 gap-3">
      {/* views */}
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1">
        {views.map((v) => {
          const Ico = KIND_ICON[v.kind];
          return (
            <button key={v.id} type="button" onClick={() => setView(v.id)}
              className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-sm px-3 text-[13px] font-medium",
                v.id === view?.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}>
              <Ico size={15} /> {v.name}
            </button>
          );
        })}
        {isOwner ? (
          <button type="button" onClick={() => setNewView(true)} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-sm px-2.5 text-[13px] text-muted hover:text-accent">
            <PlusIcon size={13} /> {t("View")}
          </button>
        ) : null}
      </div>

      {/* toolbar */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search {things}…", { things: obj.name.toLowerCase() })} aria-label={t("Search")} className="h-10 min-w-0 flex-1 sm:max-w-xs" />
        <FilterButton fields={fields} filters={extra} onChange={setExtra} />
        <SortButton fields={fields} sort={sortOver} onChange={setSortOver} />
        <div className="ml-auto flex gap-2">
          {canAdd ? <Button onClick={() => setAdding(true)}><PlusIcon size={16} weight="bold" /> <span className="max-sm:hidden">{t("New {thing}", { thing: obj.singular || obj.name })}</span><span className="sm:hidden">{t("New")}</span></Button> : null}
          <Menu>
            <MenuTrigger asChild><Button variant="outline" size="icon" aria-label={t("More")}><DotsThreeIcon size={18} /></Button></MenuTrigger>
            <MenuContent align="end">
              {isOwner ? <MenuItem icon={<SlidersHorizontalIcon />} onSelect={() => setFieldsOpen(true)}>{t("Fields")}</MenuItem> : null}
              {canAdd ? <MenuItem icon={<UploadSimpleIcon />} onSelect={() => setImporting(true)}>{t("Import a CSV or Excel export")}</MenuItem> : null}
              <MenuItem icon={<DownloadSimpleIcon />} onSelect={() => void exportCsv(objectKey).catch((e) => toast.error(errorMessage(e)))}>{t("Download as CSV")}</MenuItem>
              {isOwner && view && views.length > 1 ? (
                <MenuItem icon={<TrashIcon />} onSelect={() => void deleteView(view.id).then(() => qc.invalidateQueries({ queryKey: crmKeys.object(objectKey) }))}>
                  {t("Remove the view \"{name}\"", { name: view.name })}
                </MenuItem>
              ) : null}
              {isOwner ? <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>{t("Remove from the CRM")}</MenuItem> : null}
            </MenuContent>
          </Menu>
        </div>
      </div>
      {extra.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {extra.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pr-1 pl-2.5 text-[12.5px]">
              {fields.find((x) => x.key === f.field)?.label} {t(FILTER_OPS.find((o) => o.op === f.op)?.label ?? f.op)} {Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "")}
              <button type="button" onClick={() => setExtra(extra.filter((_, j) => j !== i))} className="grid size-6 place-items-center rounded-full text-muted hover:text-danger" aria-label={t("Remove filter")}><XIcon size={11} /></button>
            </span>
          ))}
          {isOwner && view ? (
            <button type="button" className="text-[12.5px] font-medium text-accent hover:underline"
              onClick={() => void updateView(view.id, { config: { ...view.config, filters } }).then(() => { setExtra([]); void qc.invalidateQueries({ queryKey: crmKeys.object(objectKey) }); toast.success(t("Saved to the view.")); })}>
              {t("Save to this view")}
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="text-[12.5px] text-muted">
        {rows.isLoading ? t("Loading…") : t("{n} {things}", { n: total.toLocaleString(locale()), things: total === 1 ? (obj.singular || obj.name).toLowerCase() : obj.name.toLowerCase() })}
      </p>

      {rows.error ? <p role="alert" className="text-danger">{errorMessage(rows.error)}</p>
        : rows.isLoading ? <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        : !list.length ? (
          <EmptyState icon={RowsIcon} title={needle || extra.length ? t("Nothing matches") : t("Nothing here yet")}
            body={needle || extra.length ? t("Try other words or remove a filter.") : obj.kind === "builtin" ? t("This fills itself as the office works.") : t("Add the first one, or import a CSV.")}
            action={canAdd && !needle && !extra.length ? <Button onClick={() => setAdding(true)}><PlusIcon size={16} /> {t("New {thing}", { thing: obj.singular || obj.name })}</Button> : undefined} />
        ) : shown === "board" ? (
          <BoardView obj={obj} fields={fields} rows={list} refs={refs} groupBy={view?.config.group_by} onOpen={openRecord} />
        ) : shown === "calendar" ? (
          <CalendarView obj={obj} fields={fields} rows={list} dateField={view?.config.date_field} onOpen={openRecord} wide={wide} />
        ) : shown === "cards" ? (
          <CardsView obj={obj} fields={fields} rows={list} refs={refs} onOpen={openRecord} />
        ) : (
          <TableView obj={obj} fields={fields} rows={list} refs={refs} columns={view?.config.columns} onOpen={openRecord} />
        )}
      {rows.hasNextPage ? (
        <Button variant="outline" className="justify-self-center" loading={rows.isFetchingNextPage} onClick={() => void rows.fetchNextPage()}>{t("Show more")}</Button>
      ) : null}

      {adding ? <RecordSheet obj={obj} fields={fields} recordId={null} onClose={() => setAdding(false)} /> : null}
      {search.r ? <RecordSheet key={search.r} obj={obj} fields={fields} recordId={search.r} onClose={closeRecord} /> : null}
      {fieldsOpen ? <FieldsSheet objectKey={objectKey} open={fieldsOpen} onOpenChange={setFieldsOpen} /> : null}
      {importing ? <ImportDialog obj={obj} onClose={() => setImporting(false)} /> : null}
      {newView ? <NewViewDialog obj={obj} fields={fields} onClose={(id) => { setNewView(false); if (id) setView(id); }} /> : null}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} danger title={t("Remove {name} from the CRM?", { name: obj.name })} confirmLabel={t("Remove")}
        body={obj.kind === "builtin" ? t("The office's own data stays where it is; only the fields you added in the CRM are removed.") : t("Its records and fields are removed for everyone. Download a CSV first if you may need them.")}
        onConfirm={() => removeObject.mutate()} />
    </div>
  );
}

// ---------------------------------------------------------------- table

function TableView({ obj, fields, rows, refs, columns, onOpen }: {
  obj: CrmObject; fields: CrmField[]; rows: CrmRow[]; refs: Record<string, string>; columns?: string[]; onOpen: (id: string) => void;
}) {
  const t = useT();
  const cols = (columns?.length ? columns.map((k) => fields.find((f) => f.key === k)).filter(Boolean) as CrmField[] : summaryFields(fields, obj.title_field, 7));
  const title = fields.find((f) => f.key === obj.title_field);
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface">
      <table className="w-full min-w-[640px] text-left text-[13.5px]">
        <thead className="bg-surface-2/60 text-[12px] text-muted">
          <tr>
            <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2 font-medium">{title?.label ?? t("Name")}</th>
            {cols.map((f) => <th key={f.key} className="px-3 py-2 font-medium whitespace-nowrap">{f.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer hover:bg-surface-2/50">
              <td className="sticky left-0 z-10 max-w-64 truncate bg-surface px-3 py-2.5 font-medium">{r.title}</td>
              {cols.map((f) => (
                <td key={f.key} className="max-w-56 px-3 py-2.5 align-top">
                  <div className="line-clamp-2"><FieldValue field={f} value={r.data[f.key]} refs={refs} /></div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- cards (phones, and the cards view)

function CardsView({ obj, fields, rows, refs, onOpen }: { obj: CrmObject; fields: CrmField[]; rows: CrmRow[]; refs: Record<string, string>; onOpen: (id: string) => void }) {
  const show = summaryFields(fields, obj.title_field, 4);
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)}
            className="grid w-full gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3.5 text-left transition-colors hover:border-accent/40">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: obj.color }} />
              <span className="min-w-0 truncate text-[14.5px] font-semibold">{r.title}</span>
            </span>
            <dl className="grid gap-1 text-[13px]">
              {show.filter((f) => r.data[f.key] !== undefined && r.data[f.key] !== null && r.data[f.key] !== "").map((f) => (
                <div key={f.key} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                  <dt className="truncate text-muted">{f.label}</dt>
                  <dd className="min-w-0"><FieldValue field={f} value={r.data[f.key]} refs={refs} /></dd>
                </div>
              ))}
            </dl>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- board

function BoardView({ obj, fields, rows, refs, groupBy, onOpen }: {
  obj: CrmObject; fields: CrmField[]; rows: CrmRow[]; refs: Record<string, string>; groupBy?: string; onOpen: (id: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const g = fields.find((f) => f.key === groupBy) ?? fields.find((f) => f.type === "select");
  const dragged = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => updateRecord(obj.key, id, { [g!.key]: to }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: crmKeys.rows(obj.key) }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!g) return <p className="text-[13px] text-muted">{t("A board needs a field with choices, such as Status. Add one in Fields.")}</p>;
  const canMove = obj.can_edit && !g.builtin;
  const cols = [...(g.options.choices ?? []).map((c) => ({ key: c.value, label: c.label, color: c.color })), { key: "", label: t("(empty)"), color: "gray" }];
  const show = summaryFields(fields, obj.title_field, 3).filter((f) => f.key !== g.key);
  const drop = (e: DragEvent, to: string) => {
    e.preventDefault();
    setOver(null);
    if (dragged.current && canMove) move.mutate({ id: dragged.current, to });
  };
  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-2">
      {cols.map((c) => {
        const items = rows.filter((r) => String(r.data[g.key] ?? "") === c.key);
        if (!items.length && c.key === "") return null;
        return (
          <section key={c.key || "_"} onDragOver={(e) => { if (canMove) { e.preventDefault(); setOver(c.key); } }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, c.key)}
            className={cn("grid w-[82vw] max-w-[18rem] shrink-0 snap-start content-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-2 sm:w-72",
              over === c.key && "border-accent bg-accent-soft/40")}>
            <header className="flex items-center justify-between px-1 py-0.5">
              <ChoiceChip c={c} />
              <span className="text-[12px] text-muted tabular">{items.length}</span>
            </header>
            {items.map((r) => (
              <article key={r.id} draggable={canMove} onDragStart={() => { dragged.current = r.id; }}
                className="grid gap-1.5 rounded-sm border border-border bg-surface p-2.5 text-[13px] shadow-[var(--shadow-soft)]">
                <button type="button" onClick={() => onOpen(r.id)} className="truncate text-left text-[13.5px] font-medium hover:text-accent">{r.title}</button>
                {show.map((f) => r.data[f.key] !== undefined && r.data[f.key] !== null ? (
                  <div key={f.key} className="min-w-0 text-muted"><FieldValue field={f} value={r.data[f.key]} refs={refs} /></div>
                ) : null)}
                {canMove ? (
                  <Select size="sm" value={c.key || "__none"} label={t("Move to")} className="md:hidden"
                    onValueChange={(v) => move.mutate({ id: r.id, to: v === "__none" ? "" : v })}
                    options={cols.map((x) => ({ value: x.key || "__none", label: x.label }))} />
                ) : null}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- calendar

function CalendarView({ obj, fields, rows, dateField, onOpen, wide }: {
  obj: CrmObject; fields: CrmField[]; rows: CrmRow[]; dateField?: string; onOpen: (id: string) => void; wide: boolean;
}) {
  const t = useT();
  const f = fields.find((x) => x.key === dateField) ?? fields.find((x) => x.type === "date" || x.type === "datetime");
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  if (!f) return <p className="text-[13px] text-muted">{t("A calendar needs a date field. Add one in Fields.")}</p>;
  const byDay = new Map<string, CrmRow[]>();
  for (const r of rows) {
    const v = r.data[f.key];
    if (!v) continue;
    const d = new Date(String(v).length === 10 ? `${String(v)}T00:00:00` : String(v));
    if (Number.isNaN(d.getTime())) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const head = (
    <div className="flex items-center gap-2">
      <Button size="icon-sm" variant="outline" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t("Previous month")}><CaretLeftIcon size={14} /></Button>
      <span className="min-w-36 text-center text-[14px] font-semibold">{month.toLocaleDateString(locale(), { month: "long", year: "numeric" })}</span>
      <Button size="icon-sm" variant="outline" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={t("Next month")}><CaretRightIcon size={14} /></Button>
    </div>
  );
  const days = [...byDay.keys()].filter((k) => k.startsWith(ym(month))).sort();
  if (!wide) {
    return (
      <div className="grid gap-3">
        {head}
        {!days.length ? <p className="text-[13px] text-muted">{t("Nothing this month.")}</p> : days.map((k) => (
          <section key={k} className="grid gap-1.5">
            <h4 className="text-[12.5px] font-semibold text-muted">{new Date(`${k}T00:00:00`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "short" })}</h4>
            {byDay.get(k)!.map((r) => (
              <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-left text-[13.5px]">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: obj.color }} />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                {f.type === "datetime" ? <span className="text-[12px] text-muted">{valueText(f, r.data[f.key], {}, locale()).split(",").pop()}</span> : null}
              </button>
            ))}
          </section>
        ))}
      </div>
    );
  }
  const first = (month.getDay() + 6) % 7; // Monday first
  const inMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + inMonth) / 7) * 7 }, (_, i) => i - first + 1);
  return (
    <div className="grid gap-3">
      {head}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[var(--radius-md)] border border-border bg-border text-[12.5px]">
        {[t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")].map((d) => <div key={d} className="bg-surface-2 px-2 py-1 font-medium text-muted">{d}</div>)}
        {cells.map((n, i) => {
          const k = n >= 1 && n <= inMonth ? `${ym(month)}-${String(n).padStart(2, "0")}` : "";
          const items = k ? byDay.get(k) ?? [] : [];
          return (
            <div key={i} className={cn("min-h-24 bg-surface p-1.5", !k && "bg-surface-2/40")}>
              {k ? <span className="text-[11.5px] text-muted tabular">{n}</span> : null}
              <div className="mt-1 grid gap-1">
                {items.slice(0, 3).map((r) => (
                  <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="truncate rounded-sm px-1.5 py-0.5 text-left text-[12px] font-medium text-white" style={{ background: obj.color }}>{r.title}</button>
                ))}
                {items.length > 3 ? <span className="px-1 text-[11.5px] text-muted">{t("+{n} more", { n: items.length - 3 })}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- filter and sort

function FilterButton({ fields, filters, onChange }: { fields: CrmField[]; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(fields[0]?.key ?? "");
  const f = fields.find((x) => x.key === field);
  const ops = FILTER_OPS.filter((o) => !o.types || (f && o.types.includes(f.type)));
  const [op, setOp] = useState("is");
  const [value, setValue] = useState("");
  const chosenOp = ops.find((o) => o.op === op) ?? ops[0];
  const add = () => {
    if (!f || !chosenOp) return;
    onChange([...filters, { field: f.key, op: chosenOp.op, value: chosenOp.noValue ? undefined : chosenOp.op === "any_of" ? [value] : value }]);
    setValue("");
    setOpen(false);
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><FunnelIcon size={15} /> <span className="max-sm:hidden">{t("Filter")}</span>{filters.length ? ` (${filters.length})` : ""}</Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title={t("Show only")}
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button><Button onClick={add} disabled={!chosenOp?.noValue && !value}>{t("Add filter")}</Button></>}>
        <div className="grid gap-3">
          <Select value={field} onValueChange={(v) => { setField(v); setOp("is"); setValue(""); }} label={t("Field")} options={fields.map((x) => ({ value: x.key, label: x.label }))} />
          <Select value={chosenOp?.op ?? "is"} onValueChange={setOp} label={t("Condition")} options={ops.map((o) => ({ value: o.op, label: t(o.label) }))} />
          {chosenOp && !chosenOp.noValue ? (
            f && (f.type === "select" || f.type === "multi_select") ? (
              <Select value={value || "__"} onValueChange={(v) => setValue(v === "__" ? "" : v)} label={t("Value")}
                options={[{ value: "__", label: t("Pick one") }, ...(f.options.choices ?? []).map((c) => ({ value: c.value, label: c.label }))]} />
            ) : (
              <Input aria-label={t("Value")} value={value} onChange={(e) => setValue(e.target.value)}
                type={f?.type === "date" || f?.type === "datetime" ? "date" : "text"} inputMode={f && ["number", "money", "percent", "rating", "auto"].includes(f.type) ? "decimal" : undefined} />
            )
          ) : null}
        </div>
      </ResponsiveDialog>
    </>
  );
}

function SortButton({ fields, sort, onChange }: { fields: CrmField[]; sort: Sort | null; onChange: (s: Sort | null) => void }) {
  const t = useT();
  return (
    <Select size="md" className="w-auto max-w-44" label={t("Sort")} value={sort ? `${sort.field}:${sort.dir}` : "__"}
      onValueChange={(v) => { if (v === "__") onChange(null); else { const [field, dir] = v.split(":"); onChange({ field: field!, dir: dir as "asc" | "desc" }); } }}
      options={[{ value: "__", label: t("Sort: as saved") }, ...fields.flatMap((f) => [
        { value: `${f.key}:asc`, label: t("{field}, A to Z / low to high", { field: f.label }) },
        { value: `${f.key}:desc`, label: t("{field}, Z to A / high to low", { field: f.label }) },
      ])]} />
  );
}

// ---------------------------------------------------------------- import, new view

function ImportDialog({ obj, onClose }: { obj: CrmObject; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const run = useMutation({
    mutationFn: () => importCsv(obj.key, text),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: crmKeys.all });
      toast.success(t("{n} added.", { n: r.added }));
      if (!r.problems.length) onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Import into {name}", { name: obj.name })}
      description={t("A CSV file, or an Excel sheet saved as CSV. The first row holds the column names; columns that match a field fill it, and new columns become new fields.")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Close")}</Button><Button loading={run.isPending} disabled={!text} onClick={() => run.mutate()}>{t("Import")}</Button></>}>
      <div className="grid gap-3">
        <button type="button" onClick={() => input.current?.click()} className="grid min-h-24 place-items-center rounded-[var(--radius-md)] border-2 border-dashed border-border px-4 text-center text-[13.5px] text-muted hover:border-accent/50">
          {name || t("Choose a CSV file")}
        </button>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 3_000_000) { toast.error(t("That file is over 3 MB.")); return; }
          setName(file.name);
          setText(await file.text());
        }} />
        {run.error ? <p role="alert" className="text-[13px] text-danger">{errorMessage(run.error)}</p> : null}
        {run.data?.problems.length ? (
          <div className="rounded-sm border border-warn/30 bg-warn/8 p-3 text-[12.5px]">
            <p className="font-medium">{t("{n} added. Some cells could not be read:", { n: run.data.added })}</p>
            <ul className="mt-1 list-disc pl-5">{run.data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}

function NewViewDialog({ obj, fields, onClose }: { obj: CrmObject; fields: CrmField[]; onClose: (id?: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const choices = fields.filter((f) => f.type === "select");
  const dates = fields.filter((f) => f.type === "date" || f.type === "datetime");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ViewKind>("table");
  const [group, setGroup] = useState(choices[0]?.key ?? "");
  const [date, setDate] = useState(dates[0]?.key ?? "");
  const save = useMutation({
    mutationFn: () => addView(obj.key, { name: name || t(kind === "board" ? "Board" : kind === "calendar" ? "Calendar" : kind === "cards" ? "Cards" : "Table"), kind,
      config: kind === "board" ? { group_by: group } : kind === "calendar" ? { date_field: date } : {} }),
    onSuccess: (v) => { void qc.invalidateQueries({ queryKey: crmKeys.object(obj.key) }); onClose(v.id); },
  });
  const KINDS: { kind: ViewKind; label: string; hint: string; ok: boolean }[] = [
    { kind: "table", label: t("Table"), hint: t("Rows and columns, like a spreadsheet"), ok: true },
    { kind: "cards", label: t("Cards"), hint: t("One card per record"), ok: true },
    { kind: "board", label: t("Board"), hint: t("Columns by status; drag to move"), ok: choices.length > 0 },
    { kind: "calendar", label: t("Calendar"), hint: t("By a date"), ok: dates.length > 0 },
  ];
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("New view")}
      footer={<><Button variant="outline" onClick={() => onClose()}>{t("Cancel")}</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{t("Add view")}</Button></>}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => {
            const Ico = KIND_ICON[k.kind];
            return (
              <button key={k.kind} type="button" disabled={!k.ok} onClick={() => setKind(k.kind)}
                className={cn("grid gap-1 rounded-[var(--radius-md)] border p-3 text-left disabled:opacity-40", kind === k.kind ? "border-accent bg-accent-soft/40" : "border-border")}>
                <Ico size={20} className="text-accent" />
                <span className="text-[13.5px] font-medium">{k.label}</span>
                <span className="text-[12px] text-muted">{k.ok ? k.hint : k.kind === "board" ? t("Needs a field with choices") : t("Needs a date field")}</span>
              </button>
            );
          })}
        </div>
        <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. This month's, My clients")} />
        {kind === "board" ? <Select value={group} onValueChange={setGroup} label={t("Columns by")} options={choices.map((f) => ({ value: f.key, label: f.label }))} /> : null}
        {kind === "calendar" ? <Select value={date} onValueChange={setDate} label={t("Date")} options={dates.map((f) => ({ value: f.key, label: f.label }))} /> : null}
      </div>
    </ResponsiveDialog>
  );
}
