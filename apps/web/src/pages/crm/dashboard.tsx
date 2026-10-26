/** P50 the CRM dashboard: tiles that count, total or chart what is in the lists (a number,
 * bars, a pie, a line over time, or the latest rows). The owner adds, edits, resizes, moves
 * and removes tiles; people it is shared with see them. Tap a tile's title to open its list. */
import {
  ArrowLeftIcon, ArrowRightIcon, ChartBarHorizontalIcon, ChartDonutIcon, ChartLineUpIcon, ChartPieSliceIcon, DotsThreeIcon,
  FunnelIcon, HashIcon, ListBulletsIcon, PencilSimpleIcon, PlusIcon, SparkleIcon, TrashIcon, XIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from "recharts";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  addWidget, crmDashboardQuery, crmKeys, crmObjectQuery, crmPeopleQuery, deleteWidget, FILTER_OPS, updateWidget,
  type CrmField, type CrmObject, type FieldType, type Filter, type Widget,
} from "@/lib/crm-hub";
import { cn } from "@/lib/utils";

import { crmIcon } from "./icons";

type Kind = Widget["kind"];
type Size = Widget["size"];
type Metric = "count" | "sum" | "avg";
type Period = "day" | "week" | "month" | "year";

const KINDS: { kind: Kind; label: string; hint: string; icon: Icon }[] = [
  { kind: "number", label: msg("A number"), hint: msg("One big figure"), icon: HashIcon },
  { kind: "bar", label: msg("Bars"), hint: msg("Compare groups side by side"), icon: ChartBarHorizontalIcon },
  { kind: "pie", label: msg("Pie"), hint: msg("How the whole is shared out"), icon: ChartDonutIcon },
  { kind: "line", label: msg("Over time"), hint: msg("Up or down by day, week or month"), icon: ChartLineUpIcon },
  { kind: "list", label: msg("Latest list"), hint: msg("The newest few, to open quickly"), icon: ListBulletsIcon },
];

const SIZES: { value: Size; label: string }[] = [
  { value: "sm", label: msg("Small") },
  { value: "md", label: msg("Medium") },
  { value: "lg", label: msg("Large") },
];

const PERIODS: { value: Period; label: string; per: string }[] = [
  { value: "day", label: msg("Each day"), per: msg("day") },
  { value: "week", label: msg("Each week"), per: msg("week") },
  { value: "month", label: msg("Each month"), per: msg("month") },
  { value: "year", label: msg("Each year"), per: msg("year") },
];

/** A sensible starting size for each kind (the owner can change it). */
const KIND_SIZE: Record<Kind, Size> = { number: "sm", bar: "md", pie: "sm", line: "md", list: "sm" };

const SPAN: Record<Size, string> = { sm: "", md: "md:col-span-2", lg: "md:col-span-2 xl:col-span-3" };

const NUMERIC: FieldType[] = ["number", "money", "percent", "rating"];
const GROUPABLE: FieldType[] = ["select", "multi_select", "person", "checkbox"];
const DATES: FieldType[] = ["date", "datetime"];

const PALETTE = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
const OTHER_COLOR = "var(--series-other)";
const TOOLTIP_BOX = "rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]";
const AXIS_TICK = { fontSize: 11, fill: "var(--color-muted)" };

// ---------------------------------------------------------------- formatting

function fmt(v: number, money: boolean, compact = false): string {
  const lang = locale();
  if (compact) {
    const s = new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(v);
    return money ? `RM ${s}` : s;
  }
  return money
    ? `RM ${v.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : v.toLocaleString(lang, { maximumFractionDigits: 2 });
}

/** A period key from the server ("2026", "2026-10" or "2026-10-19") as a short date. */
function periodText(key: string, long = false): string {
  const lang = locale();
  if (/^\d{4}$/.test(key)) return key;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1)));
  if (!m[3]) return d.toLocaleDateString(lang, { month: "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString(lang, { day: "numeric", month: "short", year: long ? "numeric" : undefined, timeZone: "UTC" });
}

const short = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------------------------------------------------------------- the dashboard

export function CrmDashboard({ objects, canEdit, onOpenObject }: { objects: CrmObject[]; canEdit: boolean; onOpenObject: (key: string, recordId?: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const dash = useQuery(crmDashboardQuery);
  const widgets = dash.data?.widgets ?? [];
  const grouped = widgets.some((w) => w.kind === "bar" || w.kind === "pie");
  const people = useQuery({ ...crmPeopleQuery, enabled: grouped });
  const names = new Map((people.data ?? []).map((p) => [p.id, p.name]));
  const [editing, setEditing] = useState<Widget | "new" | null>(null);
  const [removing, setRemoving] = useState<Widget | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: crmKeys.dashboard });

  const reorder = useMutation({
    mutationFn: (next: Widget[]) =>
      Promise.all(next.map((w, i) => (w.position !== i + 1 ? updateWidget(w.id, { position: i + 1 }) : null))),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: crmKeys.dashboard });
      qc.setQueryData(crmDashboardQuery.queryKey, (old) => (old ? { ...old, widgets: next } : old));
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => void refresh(),
  });
  const resize = useMutation({
    mutationFn: ({ id, size }: { id: string; size: Size }) => updateWidget(id, { size }),
    onMutate: async ({ id, size }) => {
      await qc.cancelQueries({ queryKey: crmKeys.dashboard });
      qc.setQueryData(crmDashboardQuery.queryKey, (old) => (old ? { ...old, widgets: old.widgets.map((w) => (w.id === id ? { ...w, size } : w)) } : old));
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => void refresh(),
  });

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j]!, next[i]!];
    reorder.mutate(next);
  };

  if (dash.isLoading) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-4" aria-busy>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className={cn("rounded-[var(--radius-md)]", i === 1 ? "h-64 md:col-span-2" : "h-40")} />)}
      </div>
    );
  }
  if (dash.error) return <p role="alert" className="text-danger">{errorMessage(dash.error)}</p>;

  const addButton = canEdit && objects.length ? (
    <Button onClick={() => setEditing("new")}><PlusIcon size={16} weight="bold" /> {t("Add a tile")}</Button>
  ) : null;

  return (
    <div className="grid min-w-0 gap-3">
      {!widgets.length ? (
        <EmptyState icon={ChartPieSliceIcon} title={t("No tiles yet")}
          body={canEdit
            ? objects.length
              ? t("Tiles show your numbers at a glance: how many deals are open, sales this month, jobs by status, the newest customers. Add one and pick what it counts.")
              : t("Add a list to the CRM first, then tiles can count what is in it.")
            : t("The owner has not added any tiles yet.")}
          action={addButton ?? undefined} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-muted">{t("Tap a tile's name to open its list.")}</p>
            {addButton}
          </div>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-4">
            {widgets.map((w, i) => (
              <Tile key={w.id} w={w} names={names} onOpenObject={onOpenObject}
                menu={canEdit ? (
                  <TileMenu w={w} first={i === 0} last={i === widgets.length - 1}
                    onEdit={() => setEditing(w)} onSize={(size) => resize.mutate({ id: w.id, size })}
                    onMove={(by) => move(i, by)} onRemove={() => setRemoving(w)} />
                ) : null} />
            ))}
          </ul>
        </>
      )}

      {editing ? (
        <TileDialog key={editing === "new" ? "new" : editing.id} objects={objects} widget={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} danger confirmLabel={t("Remove")}
        title={t("Remove the tile \"{name}\"?", { name: removing?.title ?? "" })}
        body={t("Only the tile goes. The list and its records stay as they are.")}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteWidget(removing.id);
            await refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }} />
    </div>
  );
}

// ---------------------------------------------------------------- one tile

function Tile({ w, names, menu, onOpenObject }: { w: Widget; names: Map<string, string>; menu: ReactNode; onOpenObject: (key: string, recordId?: string) => void }) {
  const t = useT();
  const open = () => onOpenObject(w.object.key);
  // The server sends raw keys for some groups: people's ids, yes/no as True/False, "(empty)".
  const label = (g: { key: string; label: string }) => {
    if (g.key === "") return t("Not filled in");
    if (g.label !== g.key) return g.label;
    if (g.key === "True") return t("Yes");
    if (g.key === "False") return t("No");
    return names.get(g.key) ?? g.label;
  };
  const groups = w.data.groups.map((g) => ({ ...g, label: w.kind === "line" ? g.key : label(g) }));

  let body: ReactNode;
  if (w.kind === "number") body = <NumberBody w={w} />;
  else if (w.kind === "list") body = <ListBody w={w} onOpen={open} onOpenRecord={(id) => onOpenObject(w.object.key, id)} />;
  else if (!groups.length) body = <p className="grid h-32 place-items-center text-center text-[13px] text-muted">{t("Nothing to show yet.")}</p>;
  else if (w.kind === "bar") body = <BarBody w={w} groups={groups} />;
  else if (w.kind === "pie") body = <PieBody w={w} groups={groups} />;
  else body = <LineBody w={w} groups={groups} />;

  return (
    <li className={cn("flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 sm:p-4", SPAN[w.size])}>
      <div className="flex min-w-0 items-start gap-2">
        <button type="button" onClick={open} title={t("Open {name}", { name: w.object.name })}
          className="group flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-sm text-left">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-sm" style={{ background: `${w.object.color}1f`, color: w.object.color }}>
            {createElement(crmIcon(w.object.icon), { size: 18, weight: "duotone" })}
          </span>
          <span className="grid min-w-0">
            <span className="truncate text-[14px] font-semibold group-hover:text-accent group-hover:underline">{w.title}</span>
            <span className="truncate text-[12px] text-muted">{w.object.name}{w.config.filters?.length ? ` · ${t("only some")}` : ""}</span>
          </span>
        </button>
        {menu}
      </div>
      <div className="min-w-0 flex-1">{body}</div>
    </li>
  );
}

function TileMenu({ w, first, last, onEdit, onSize, onMove, onRemove }: {
  w: Widget; first: boolean; last: boolean; onEdit: () => void; onSize: (s: Size) => void; onMove: (by: -1 | 1) => void; onRemove: () => void;
}) {
  const t = useT();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 sm:size-9" aria-label={t("Options for {name}", { name: w.title })}><DotsThreeIcon size={18} weight="bold" /></Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<PencilSimpleIcon />} onSelect={onEdit}>{t("Edit")}</MenuItem>
        <MenuSeparator />
        <MenuLabel>{t("Size")}</MenuLabel>
        <MenuRadioGroup value={w.size} onValueChange={(v) => onSize(v as Size)}>
          {SIZES.map((s) => <MenuRadioItem key={s.value} value={s.value}>{t(s.label)}</MenuRadioItem>)}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem icon={<ArrowLeftIcon />} disabled={first} onSelect={() => onMove(-1)}>{t("Move earlier")}</MenuItem>
        <MenuItem icon={<ArrowRightIcon />} disabled={last} onSelect={() => onMove(1)}>{t("Move later")}</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<TrashIcon />} danger onSelect={onRemove}>{t("Remove")}</MenuItem>
      </MenuContent>
    </Menu>
  );
}

// ---------------------------------------------------------------- tile bodies

type Group = { key: string; label: string; value: number };

function NumberBody({ w }: { w: Widget }) {
  const t = useT();
  const metric = w.config.metric ?? "count";
  return (
    <div className="grid gap-1">
      <p className="text-3xl font-semibold tracking-tight break-words tabular sm:text-4xl">{fmt(w.data.total, w.money)}</p>
      <p className="text-[12.5px] text-muted">
        {metric === "sum" ? t("Total") : metric === "avg" ? t("Average") : t("How many")}
      </p>
    </div>
  );
}

function ListBody({ w, onOpen, onOpenRecord }: { w: Widget; onOpen: () => void; onOpenRecord: (id: string) => void }) {
  const t = useT();
  const rows = w.data.rows ?? [];
  if (!rows.length) return <p className="py-6 text-center text-[13px] text-muted">{t("Nothing here yet.")}</p>;
  return (
    <div className="grid gap-1">
      <ul className="-mx-1 grid">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpenRecord(r.id)}
              className="flex min-h-11 w-full min-w-0 items-center rounded-sm px-1 text-left text-[13.5px] hover:bg-surface-2">
              <span className="truncate">{r.title || t("(no name)")}</span>
            </button>
          </li>
        ))}
      </ul>
      {w.data.total > rows.length ? (
        <button type="button" onClick={onOpen} className="min-h-11 justify-self-start text-[12.5px] font-medium text-accent hover:underline">
          {t("See all {n}", { n: w.data.total.toLocaleString(locale()) })}
        </button>
      ) : null}
    </div>
  );
}

function TileTooltip({ active, payload, w, title }: TooltipContentProps<number, string> & { w: Widget; title: (g: Group) => string }) {
  if (!active || !payload?.length) return null;
  const g = payload[0]!.payload as Group;
  return (
    <div className={TOOLTIP_BOX}>
      <p className="font-medium">{title(g)}</p>
      <p className="font-mono tabular">{fmt(g.value, w.money)}</p>
    </div>
  );
}

function BarBody({ w, groups }: { w: Widget; groups: Group[] }) {
  const height = Math.max(120, groups.length * 30 + 12);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={groups} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-border)" />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmt(v, false, true)} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={96} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: string) => short(String(v), 14)} />
          <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={(p) => <TileTooltip {...(p as TooltipContentProps<number, string>)} w={w} title={(g) => g.label} />} />
          <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieBody({ w, groups }: { w: Widget; groups: Group[] }) {
  const t = useT();
  const additive = (w.config.metric ?? "count") !== "avg";
  // More than 8 slices is hard to read: fold the rest into "Other" (only when the values add up).
  let slices = groups.map((g, i) => ({ ...g, color: PALETTE[i] ?? OTHER_COLOR }));
  if (additive && groups.length > 8) {
    const rest = groups.slice(7);
    slices = [...slices.slice(0, 7), { key: "__other", label: t("Other ({n})", { n: rest.length }), value: rest.reduce((s, g) => s + g.value, 0), color: OTHER_COLOR }];
  }
  const sum = slices.reduce((s, g) => s + g.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative mx-auto size-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={slices.length > 1 ? 1.5 : 0}
              stroke="var(--color-surface)" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
            </Pie>
            <Tooltip content={(p) => <TileTooltip {...(p as TooltipContentProps<number, string>)} w={w} title={(g) => g.label} />} />
          </PieChart>
        </ResponsiveContainer>
        {additive ? (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-center text-[15px] font-semibold tabular">{fmt(w.data.total, w.money, true)}</p>
        ) : null}
      </div>
      <ul className="grid min-w-40 flex-1 gap-1.5 text-[12.5px]">
        {slices.map((s) => (
          <li key={s.key} className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="shrink-0 font-medium tabular">{fmt(s.value, w.money, w.money)}</span>
            {additive && sum > 0 ? <span className="w-9 shrink-0 text-right text-muted tabular">{Math.round((s.value / sum) * 100)}%</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineBody({ w, groups }: { w: Widget; groups: Group[] }) {
  const t = useT();
  const week = w.config.period === "week";
  const longLabel = (g: Group) => (week ? t("Week of {day}", { day: periodText(g.key, true) }) : periodText(g.key, true));
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={groups} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="key" tickFormatter={(k: string) => periodText(String(k))} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmt(v, false, true)} allowDecimals={(w.config.metric ?? "count") !== "count"} />
          <Tooltip cursor={{ stroke: "var(--color-border)" }} content={(p) => <TileTooltip {...(p as TooltipContentProps<number, string>)} w={w} title={longLabel} />} />
          <Line type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} isAnimationActive={false}
            dot={groups.length <= 12 ? { r: 3.5, fill: "var(--series-1)", stroke: "var(--color-surface)", strokeWidth: 2 } : false}
            activeDot={{ r: 5, stroke: "var(--color-surface)", strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- add / edit a tile

function TileDialog({ objects, widget, onClose }: { objects: CrmObject[]; widget?: Widget; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const cfg = widget?.config;
  const firstFilter = cfg?.filters?.[0];
  const [objectKey, setObjectKey] = useState(cfg?.object && objects.some((o) => o.key === cfg.object) ? cfg.object : objects[0]?.key ?? "");
  const [kind, setKind] = useState<Kind>(widget?.kind ?? "number");
  const [size, setSize] = useState<Size>(widget?.size ?? "sm");
  const [sizeTouched, setSizeTouched] = useState(!!widget);
  const [metric, setMetric] = useState<Metric>((cfg?.metric as Metric | undefined) ?? "count");
  const [field, setField] = useState(cfg?.field ?? "");
  const [groupBy, setGroupBy] = useState(cfg?.group_by ?? "");
  const [dateField, setDateField] = useState(cfg?.date_field ?? "");
  const [period, setPeriod] = useState<Period>((cfg?.period as Period | undefined) ?? "month");
  const [filterOn, setFilterOn] = useState(!!firstFilter);
  const [fField, setFField] = useState(firstFilter?.field ?? "");
  const [fOp, setFOp] = useState(firstFilter?.op ?? "is");
  const [fValue, setFValue] = useState(() => {
    const v = firstFilter?.value;
    if (Array.isArray(v)) return String(v[0] ?? "");
    if (typeof v === "boolean") return v ? "true" : "false";
    return v === undefined || v === null ? "" : String(v);
  });
  const [title, setTitle] = useState(widget?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!widget);

  const detail = useQuery(crmObjectQuery(objectKey));
  const people = useQuery(crmPeopleQuery);
  const obj = objects.find((o) => o.key === objectKey);
  const fields = detail.data?.fields ?? [];
  const numeric = fields.filter((f) => NUMERIC.includes(f.type));
  const groupable = fields.filter((f) => GROUPABLE.includes(f.type));
  const dates = fields.filter((f) => DATES.includes(f.type));
  const filterable = fields.filter((f) => f.type !== "file");

  // Choices follow the list picked: anything that no longer fits falls back to the first that does.
  const pick = (list: CrmField[], key: string) => (list.some((f) => f.key === key) ? key : list[0]?.key ?? "");
  const metricNow: Metric = metric !== "count" && !numeric.length ? "count" : metric;
  const valueKey = metricNow === "count" ? "" : pick(numeric, field);
  const groupKey = pick(groupable, groupBy);
  const dateKey = pick(dates, dateField);
  const filterField = filterable.find((f) => f.key === fField) ?? filterable[0];
  const ops = FILTER_OPS.filter((o) => !o.types || (filterField && o.types.includes(filterField.type)));
  const op = ops.find((o) => o.op === fOp) ?? ops[0];
  const needsValue = filterOn && !!op && !op.noValue;

  const kindOk: Record<Kind, boolean> = { number: true, list: true, bar: groupable.length > 0, pie: groupable.length > 0, line: dates.length > 0 };
  const label = (list: CrmField[], key: string) => list.find((f) => f.key === key)?.label ?? "";
  const things = (obj?.name ?? "").toLowerCase();

  // A title that says what the tile shows, until the owner types their own.
  const what = metricNow === "sum" ? t("Total {field}", { field: label(numeric, valueKey).toLowerCase() })
    : metricNow === "avg" ? t("Average {field}", { field: label(numeric, valueKey).toLowerCase() })
    : t("Number of {things}", { things });
  let suggested = kind === "list" ? t("Latest {things}", { things })
    : kind === "bar" || kind === "pie" ? t("{what} by {group}", { what, group: label(groupable, groupKey).toLowerCase() })
    : kind === "line" ? t("{what} per {period}", { what, period: t(PERIODS.find((p) => p.value === period)?.per ?? "month") })
    : what;
  if (filterOn && filterField && op && (op.noValue || fValue)) {
    const shown = op.noValue ? "" : ` ${valueLabel(filterField, fValue, people.data, t)}`;
    suggested = `${suggested} (${filterField.label.toLowerCase()} ${t(op.label)}${shown})`;
  }
  suggested = suggested.charAt(0).toUpperCase() + suggested.slice(1);
  suggested = suggested.slice(0, 120);
  const finalTitle = (titleTouched ? title : suggested).trim();

  const problem = !obj ? t("Pick a list.")
    : detail.isLoading ? null
    : !kindOk[kind] ? (kind === "line" ? t("This list has no date field to draw over time.") : t("This list has no field with choices to split by."))
    : metricNow !== "count" && kind !== "list" && !valueKey ? t("Pick the number to add up.")
    : needsValue && !fValue.trim() ? t("Fill in the condition, or remove it.")
    : !finalTitle ? t("Give the tile a name.")
    : null;

  const save = useMutation({
    mutationFn: () => {
      const keep: Record<string, unknown> = {};
      for (const k of ["sort", "last", "top"]) if (cfg && k in cfg) keep[k] = (cfg as Record<string, unknown>)[k];
      const filters: Filter[] = filterOn && filterField && op
        ? [{ field: filterField.key, op: op.op, ...(op.noValue ? {} : { value: filterValue(filterField, op.op, fValue) }) }, ...(cfg?.filters?.slice(1) ?? [])]
        : cfg?.filters?.slice(1) ?? [];
      const config: Widget["config"] = { ...keep, object: objectKey };
      if (kind !== "list") {
        config.metric = metricNow;
        if (valueKey) config.field = valueKey;
      }
      if (kind === "bar" || kind === "pie") config.group_by = groupKey;
      if (kind === "line") { config.date_field = dateKey; config.period = period; }
      if (filters.length) config.filters = filters;
      const body = { title: finalTitle, kind, size, config };
      return widget ? updateWidget(widget.id, body) : addWidget(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.dashboard });
      toast.success(widget ? t("Tile saved.") : t("Tile added."));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  let step = 0;
  const next = () => ++step;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={widget ? t("Edit tile") : t("Add a tile")}
      description={t("A tile counts or charts what is in one of your lists. It updates by itself.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button loading={save.isPending} disabled={!!problem || detail.isLoading || !!detail.error} onClick={() => save.mutate()}>
            {widget ? t("Save") : t("Add tile")}
          </Button>
        </>
      }>
      <div className="grid gap-5">
        <Step n={next()} title={t("Which list?")}>
          <Select value={objectKey} onValueChange={setObjectKey} label={t("Which list?")}
            options={objects.map((o) => ({ value: o.key, label: o.name }))} />
          {detail.error ? <p role="alert" className="text-[12.5px] text-danger">{errorMessage(detail.error)}</p> : null}
        </Step>

        <Step n={next()} title={t("What should it show?")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {KINDS.map((k) => {
              const ok = detail.isLoading || kindOk[k.kind];
              return (
                <button key={k.kind} type="button" disabled={!ok} aria-pressed={kind === k.kind}
                  onClick={() => { setKind(k.kind); if (!sizeTouched) setSize(KIND_SIZE[k.kind]); }}
                  className={cn("grid min-h-11 content-start gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors disabled:opacity-40",
                    kind === k.kind ? "border-accent bg-accent-soft/40" : "border-border hover:border-accent/40")}>
                  <k.icon size={20} weight="duotone" className="text-accent" />
                  <span className="text-[13.5px] font-medium">{t(k.label)}</span>
                  <span className="text-[12px] text-muted">
                    {ok ? t(k.hint) : k.kind === "line" ? t("Needs a date field") : t("Needs a field with choices")}
                  </span>
                </button>
              );
            })}
          </div>
        </Step>

        {kind !== "list" ? (
          <Step n={next()} title={t("What should it count?")}>
            <Select value={metricNow} onValueChange={(v) => setMetric(v as Metric)} label={t("What should it count?")}
              options={[
                { value: "count", label: t("How many {things}", { things }) },
                { value: "sum", label: t("Total of a number"), hint: numeric.length ? t("e.g. all the amounts added up") : t("Needs a number or money field"), disabled: !numeric.length },
                { value: "avg", label: t("Average of a number"), hint: numeric.length ? t("e.g. the usual deal size") : t("Needs a number or money field"), disabled: !numeric.length },
              ]} />
            {metricNow !== "count" ? (
              <Select value={valueKey} onValueChange={setField} label={metricNow === "sum" ? t("Total of") : t("Average of")}
                options={numeric.map((f) => ({ value: f.key, label: f.label }))} />
            ) : null}
          </Step>
        ) : null}

        {(kind === "bar" || kind === "pie") && groupable.length ? (
          <Step n={next()} title={t("Split by")}>
            <Select value={groupKey} onValueChange={setGroupBy} label={t("Split by")} options={groupable.map((f) => ({ value: f.key, label: f.label }))} />
          </Step>
        ) : null}

        {kind === "line" && dates.length ? (
          <Step n={next()} title={t("Over which date?")}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={dateKey} onValueChange={setDateField} label={t("Date")} options={dates.map((f) => ({ value: f.key, label: f.label }))} />
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)} label={t("Group by")} options={PERIODS.map((p) => ({ value: p.value, label: t(p.label) }))} />
            </div>
          </Step>
        ) : null}

        <Step n={next()} title={t("Only count some? (optional)")}>
          {!filterOn ? (
            <Button variant="outline" className="min-h-11 justify-self-start sm:min-h-10" disabled={!filterable.length}
              onClick={() => { setFilterOn(true); setFField(filterField?.key ?? ""); }}>
              <FunnelIcon size={15} /> {t("Add a condition")}
            </Button>
          ) : (
            <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={filterField?.key ?? ""} onValueChange={(v) => { setFField(v); setFOp("is"); setFValue(""); }} label={t("Field")}
                  options={filterable.map((f) => ({ value: f.key, label: f.label }))} />
                <Select value={op?.op ?? "is"} onValueChange={(v) => { setFOp(v); }} label={t("Condition")}
                  options={ops.map((o) => ({ value: o.op, label: t(o.label) }))} />
              </div>
              {needsValue && filterField ? <FilterValue field={filterField} value={fValue} onChange={setFValue} people={people.data ?? []} /> : null}
              <Button variant="ghost" size="sm" className="min-h-11 justify-self-start sm:min-h-8" onClick={() => { setFilterOn(false); setFValue(""); }}>
                <XIcon size={13} /> {t("Remove the condition")}
              </Button>
            </div>
          )}
        </Step>

        <Step n={next()} title={t("Name and size")}>
          <Field label={t("Tile name")} value={titleTouched ? title : suggested} maxLength={120}
            onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }} />
          {titleTouched && suggested && title.trim() !== suggested ? (
            <button type="button" onClick={() => { setTitle(suggested); setTitleTouched(false); }}
              className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-left text-[12.5px] text-accent hover:underline sm:min-h-8">
              <SparkleIcon size={14} className="shrink-0" /> {t("Use \"{name}\"", { name: suggested })}
            </button>
          ) : null}
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Size")}</span>
            <Segmented value={size} onChange={(v) => { setSize(v); setSizeTouched(true); }} label={t("Size")}
              options={SIZES.map((s) => ({ value: s.value, label: t(s.label) }))} className="self-start" />
          </div>
        </Step>

        {problem && !detail.isLoading ? <p className="text-[12.5px] text-muted">{problem}</p> : null}
      </div>
    </ResponsiveDialog>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="flex items-center gap-2 text-[13.5px] font-semibold">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] text-accent tabular">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function FilterValue({ field, value, onChange, people }: { field: CrmField; value: string; onChange: (v: string) => void; people: { id: string; name: string }[] }) {
  const t = useT();
  const pickOne = { value: "__", label: t("Pick one") };
  const asSelect = (options: { value: string; label: string }[]) => (
    <Select value={value || "__"} onValueChange={(v) => onChange(v === "__" ? "" : v)} label={t("Value")} options={[pickOne, ...options]} />
  );
  if (field.type === "select" || field.type === "multi_select") return asSelect((field.options.choices ?? []).map((c) => ({ value: c.value, label: c.label })));
  if (field.type === "checkbox") return asSelect([{ value: "true", label: t("Yes") }, { value: "false", label: t("No") }]);
  if (field.type === "person") return asSelect(people.map((p) => ({ value: p.id, label: p.name })));
  return (
    <Input aria-label={t("Value")} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 sm:h-10"
      type={DATES.includes(field.type) ? "date" : "text"}
      inputMode={NUMERIC.includes(field.type) || field.type === "auto" ? "decimal" : undefined} />
  );
}

/** The condition's value as the server reads it. */
function filterValue(field: CrmField, op: string, raw: string): unknown {
  const v = raw.trim();
  if (op === "any_of") return [v];
  if (field.type === "checkbox") return v === "true";
  return v;
}

/** The condition's value in words, for the suggested title. */
function valueLabel(field: CrmField, raw: string, people: { id: string; name: string }[] | undefined, t: (s: string) => string): string {
  if (!raw) return "";
  if (field.type === "checkbox") return raw === "true" ? t("Yes") : t("No");
  if (field.type === "person") return people?.find((p) => p.id === raw)?.name ?? raw;
  if (field.type === "select" || field.type === "multi_select") return field.options.choices?.find((c) => c.value === raw)?.label ?? raw;
  return raw;
}
