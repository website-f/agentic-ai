import {
  ArrowElbowLeftUpIcon,
  ArrowElbowDownRightIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  CoinsIcon,
  FlagIcon,
  KanbanIcon,
  PencilSimpleIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
  TreeStructureIcon,
  ArrowCounterClockwiseIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { LoadMore } from "@/components/load-more";
import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Meta, Toolbar } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, t, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { lockedBranchId } from "@/lib/company";
import {
  BUDGET,
  buildTree,
  doneShare,
  dueLabel,
  fxRate,
  objectiveKeys,
  objectiveQuery,
  objectivesQuery,
  rm,
  STATUS,
  type Objective,
  type ObjectiveInput,
  type ObjectiveNode,
  type ObjectiveStatus,
} from "@/lib/objectives";
import { usePagedList } from "@/lib/paged";
import { branchesQuery, meQuery } from "@/lib/queries";
import { hasAny, type Branch } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { STATUS_INFO, type Task } from "@/lib/work";

type Filter = ObjectiveStatus | "all";
const EVERY = "__every";
const NONE = "__none";

const STATUS_TONE: Record<ObjectiveStatus, Tone> = { active: "accent", done: "ok", dropped: "neutral" };

// ---------------------------------------------------------------- small parts

/** Done (and failed) work as one bar; cancelled work does not count. */
function ProgressBar({ o, className }: { o: Objective; className?: string }) {
  const t = useT();
  const counted = o.progress.total - o.progress.cancelled;
  const done = counted ? (o.progress.done / counted) * 100 : 0;
  const failed = counted ? (o.progress.failed / counted) * 100 : 0;
  return (
    <div
      className={cn("flex h-1.5 overflow-hidden rounded-full bg-surface-2", className)}
      role="progressbar"
      aria-label={t("Work done")}
      aria-valuemin={0}
      aria-valuemax={counted}
      aria-valuenow={o.progress.done}
    >
      <div className="h-full bg-ok transition-[width]" style={{ width: `${done}%` }} />
      <div className="h-full bg-danger/70 transition-[width]" style={{ width: `${failed}%` }} />
    </div>
  );
}

function progressText(o: Objective): string {
  const p = o.progress;
  if (!p.total) return t("No work linked yet");
  const bits = [t("{done} of {total} done", { done: p.done, total: p.total - p.cancelled })];
  if (p.failed) bits.push(t("{n} failed", { n: p.failed }));
  if (p.open) bits.push(t("{n} open", { n: p.open }));
  return bits.join(" · ");
}

function BudgetPill({ o }: { o: Objective }) {
  const t = useT();
  if (o.budget_state === "none" || o.budget_usd === null) return null;
  const b = BUDGET[o.budget_state];
  return <Pill tone={b.tone} className="px-2 text-[11.5px] leading-[18px]">{t(b.label)}</Pill>;
}

function DuePill({ due }: { due: string | null }) {
  const d = dueLabel(due);
  if (!d) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", d.tone === "danger" && "font-medium text-danger", d.tone === "warn" && "text-warn")}>
      <CalendarBlankIcon size={12} aria-hidden /> {d.text}
    </span>
  );
}

// ---------------------------------------------------------------- the list

function ObjectiveRow({ node, onOpen, active, titles }: { node: ObjectiveNode; onOpen: (id: string) => void; active: string | undefined; titles: Map<string, string> }) {
  const t = useT();
  const o = node.objective;
  const parentTitle = o.parent_id ? titles.get(o.parent_id) : undefined;
  return (
    <>
      <li>
        <button
          type="button"
          onClick={() => onOpen(o.id)}
          aria-current={active === o.id ? "true" : undefined}
          style={{ paddingLeft: `calc(1rem + ${node.depth} * var(--indent))` }}
          className={cn(
            "grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 py-3 pr-4 text-left transition-colors [--indent:0.875rem] hover:bg-surface-2/70 focus-visible:bg-surface-2/70 sm:[--indent:1.75rem]",
            active === o.id && "bg-accent-soft/50",
          )}
        >
          <span className="flex min-w-0 items-start gap-3">
            <IconTile icon={node.depth ? ArrowElbowDownRightIcon : TargetIcon} tone={STATUS_TONE[o.status]} size="sm" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className={cn("text-[14px] leading-snug font-medium break-words", o.status === "dropped" && "text-muted line-through decoration-muted/50")}>{o.title}</span>
              {o.target ? <span className="text-[12.5px] break-words text-muted">{o.target}</span> : null}
              <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                <Meta
                  items={[
                    o.status !== "active" ? <Pill key="s" tone={STATUS[o.status].tone} className="px-2 text-[11.5px] leading-[18px]">{t(STATUS[o.status].label)}</Pill> : null,
                    o.status === "active" && o.due_on ? <DuePill key="d" due={o.due_on} /> : null,
                    o.department_name,
                    o.budget_state !== "none" && o.budget_usd !== null ? <BudgetPill key="b" o={o} /> : null,
                    !node.depth && parentTitle ? <span key="p" className="inline-flex min-w-0 items-center gap-1"><ArrowElbowLeftUpIcon size={12} className="shrink-0" aria-hidden /><span className="truncate">{t("Part of {title}", { title: parentTitle })}</span></span> : null,
                  ]}
                />
              </span>
            </span>
            <span className="grid shrink-0 justify-items-end gap-0.5 text-right">
              <span className="text-[13.5px] font-semibold tabular">{rm(o.rollup_usd)}</span>
              <span className="text-[11.5px] whitespace-nowrap text-muted">{o.budget_usd !== null ? t("of {amount}", { amount: rm(o.budget_usd) }) : t("spent")}</span>
            </span>
          </span>
          <span className="grid min-w-0 gap-1 pl-11">
            <ProgressBar o={o} />
            <span className="flex min-w-0 flex-wrap justify-between gap-x-3 text-[11.5px] text-muted tabular">
              <span>{progressText(o)}</span>
              {o.last_activity ? <span>{t("Active {ago}", { ago: timeAgo(o.last_activity).toLowerCase() })}</span> : null}
            </span>
          </span>
        </button>
      </li>
      {node.children.map((c) => <ObjectiveRow key={c.objective.id} node={c} onOpen={onOpen} active={active} titles={titles} />)}
    </>
  );
}

function CompanyGroup({ name, color, nodes, count, onOpen, active, titles }: { name: string; color?: string; nodes: ObjectiveNode[]; count: number; onOpen: (id: string) => void; active: string | undefined; titles: Map<string, string> }) {
  return (
    <section aria-label={name} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
      <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
        {color ? <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} /> : <TreeStructureIcon size={14} className="shrink-0 text-muted" aria-hidden />}
        <span className="min-w-0 truncate">{name}</span>
        <Pill className="px-2 text-[11.5px] leading-[18px]">{count}</Pill>
      </h2>
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
        {nodes.map((n) => <ObjectiveRow key={n.objective.id} node={n} onOpen={onOpen} active={active} titles={titles} />)}
      </ul>
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <StatGrid>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</StatGrid>
      <Skeleton className="h-10 w-72 max-w-full rounded-[var(--radius-sm)]" />
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="grid gap-2.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-44 rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- create / edit

function ObjectiveDialog({
  open,
  onOpenChange,
  editing,
  all,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Objective | null;
  all: Objective[];
  onSaved: (o: Objective) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: branches = [] } = useQuery(branchesQuery);
  const isAdmin = me.permissions.includes("org.manage");
  const lockBranch = isAdmin ? null : lockedBranchId(me);
  const lockDept = !isAdmin && me.scope?.kind === "department" ? me.scope.department_id : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [target, setTarget] = useState(editing?.target ?? "");
  const [branch, setBranch] = useState<string>(editing ? (editing.branch_id ?? EVERY) : (lockBranch ?? EVERY));
  const [dept, setDept] = useState<string>(editing?.department_id ?? lockDept ?? NONE);
  const [parent, setParent] = useState<string>(editing?.parent_id ?? NONE);
  const [due, setDue] = useState(editing?.due_on ?? "");
  const [budget, setBudget] = useState(editing?.budget_usd != null ? String(editing.budget_usd) : "");
  const [status, setStatus] = useState<ObjectiveStatus>(editing?.status ?? "active");
  const branchId = branch === EVERY ? null : branch;
  const company = branches.find((b) => b.id === branchId);
  const budgetNum = budget.trim() === "" ? null : Number(budget);

  // A parent must not be this objective or one of its parts, and must allow this company.
  const parentOptions = useMemo(() => {
    const below = new Set<string>();
    if (editing) {
      const kids = (id: string) => all.filter((o) => o.parent_id === id).forEach((o) => { if (!below.has(o.id)) { below.add(o.id); kids(o.id); } });
      below.add(editing.id);
      kids(editing.id);
    }
    return all
      .filter((o) => !below.has(o.id) && (o.status === "active" || o.id === editing?.parent_id) && (!o.branch_id || o.branch_id === branchId))
      .map((o) => ({ value: o.id, label: o.title, hint: o.branch_name ?? t("Every company") }));
  }, [all, editing, branchId, t]);

  const save = useMutation({
    mutationFn: () => {
      const body: ObjectiveInput = {
        title,
        target,
        branch_id: branchId,
        department_id: dept === NONE || !branchId ? null : dept,
        parent_id: parent === NONE ? null : parent,
        due_on: due || null,
        status,
        budget_usd: budgetNum,
      };
      return editing ? api<Objective>(`/api/objectives/${editing.id}`, "PATCH", body) : api<Objective>("/api/objectives", "POST", body);
    },
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: objectiveKeys.all });
      toast.success(editing ? t("Objective saved.") : t("Objective created. Link tasks to it from the task form."));
      onSaved(o);
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};
  const badBudget = budgetNum !== null && (!Number.isFinite(budgetNum) || budgetNum < 0);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t("Edit objective") : t("New objective")}
      description={t("A result the company is working toward. Tasks linked to it tell agents why the work matters, and their cost adds up here.")}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button disabled={!title.trim() || badBudget} loading={save.isPending} onClick={() => save.mutate()}>
            {editing ? t("Save") : t("Create objective")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Field label={t("Objective")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus placeholder={t("e.g. Win 5 government tenders this quarter")} error={fields.title} />
        <TextareaField label={t("Target (optional)")} value={target} onChange={(e) => setTarget(e.target.value)} maxLength={300} rows={2}
          placeholder={t("e.g. 5 awarded, RM 2m in value, by 31 December")} hint={t("What done looks like. Agents read it with every linked task.")} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-medium">{t("Company")}</span>
            <Select value={branch} label={t("Company")} disabled={!!lockBranch} className="w-full min-w-0"
              onValueChange={(v) => { setBranch(v); setDept(NONE); }}
              options={[...(isAdmin ? [{ value: EVERY, label: t("Every company") }] : []), ...branches.filter((b) => !lockBranch || b.id === lockBranch).map((b) => ({ value: b.id, label: b.name }))]} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-medium">{t("Department")}</span>
            <Select value={branchId ? dept : NONE} label={t("Department")} disabled={!branchId || !!lockDept} onValueChange={setDept} className="w-full min-w-0"
              options={[{ value: NONE, label: branchId ? t("Whole company") : t("Pick a company first") }, ...(company?.departments ?? []).filter((d) => !lockDept || d.id === lockDept).map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
        </div>
        {parentOptions.length ? (
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-medium">{t("Part of (optional)")}</span>
            <Select value={parentOptions.some((p) => p.value === parent) ? parent : NONE} label={t("Part of")} onValueChange={setParent} className="w-full min-w-0"
              options={[{ value: NONE, label: t("Nothing, a top objective") }, ...parentOptions]} />
          </div>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field className="content-start" label={t("Due (optional)")} type="date" value={due} onChange={(e) => setDue(e.target.value)} error={fields.due_on} />
          <Field className="content-start" label={t("Budget in US$ (optional)")} type="number" inputMode="decimal" min={0} step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)}
            error={badBudget ? t("Enter an amount of 0 or more.") : fields.budget_usd}
            hint={budgetNum ? t("About {amount} of AI spend (providers bill in US$).", { amount: rm(budgetNum) }) : t("AI spend cap for its work.")} />
        </div>
        {budgetNum !== null && !badBudget ? (
          <p className="rounded-sm border border-border bg-surface-2/50 px-3 py-2 text-[12.5px] text-muted">
            {t("At 80% of the budget you get a notice. At 100%, new work under this objective waits for an approval before it starts; work already running finishes.")}
          </p>
        ) : null}
        {editing ? (
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Status")}</span>
            <Segmented label={t("Status")} value={status} onChange={setStatus} className="w-full [&>button]:flex-1 [&>button]:justify-center"
              options={[{ value: "active", label: t("Active") }, { value: "done", label: t("Done") }, { value: "dropped", label: t("Dropped") }]} />
          </div>
        ) : null}
        <FormError message={save.error && !Object.keys(fields).length ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------- detail

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });
}

function CostTip({ active, payload, label, fx }: TooltipContentProps<number, string> & { fx: number }) {
  if (!active || !payload?.length) return null;
  const usd = Number(payload[0]?.value ?? 0);
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]">
      <p className="font-medium">{shortDay(String(label))}</p>
      <p className="text-muted tabular">{rm(usd, fx)} <span className="text-[11.5px]">(US${usd.toFixed(4)})</span></p>
    </div>
  );
}

function CostChart({ days }: { days: { day: string; usd: number }[] }) {
  const t = useT();
  const fx = fxRate();
  const total = days.reduce((s, d) => s + d.usd, 0);
  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] font-semibold">
        <span className="flex items-center gap-2"><CoinsIcon size={15} weight="duotone" className="text-muted" /> {t("Cost over time")}</span>
        <span className="text-[12px] font-normal text-muted tabular">{t("{amount} in {n} days", { amount: rm(total, fx), n: days.length })}</span>
      </h3>
      {total > 0 ? (
        <div className="h-40 min-w-0 rounded-[var(--radius-md)] border border-border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days} margin={{ top: 6, right: 4, bottom: 0, left: -14 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10.5, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tickFormatter={(v: number) => (v * fx).toFixed(v * fx < 1 ? 2 : 0)} tick={{ fontSize: 10.5, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} width={44} />
              <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={(p) => <CostTip {...(p as TooltipContentProps<number, string>)} fx={fx} />} />
              <Bar dataKey="usd" fill="var(--color-accent)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-[var(--radius-md)] border border-dashed border-border px-3 py-5 text-center text-[12.5px] text-muted">{t("No AI spend on this objective in the last {n} days.", { n: days.length })}</p>
      )}
    </section>
  );
}

function Fact({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5 px-3.5 py-2.5">
      <dt className="truncate text-[11.5px] text-muted">{label}</dt>
      <dd className="text-[14px] font-semibold break-words tabular">{value}</dd>
      {hint ? <dd className="text-[11.5px] break-words text-muted">{hint}</dd> : null}
    </div>
  );
}

function TaskList({ objectiveId }: { objectiveId: string }) {
  const t = useT();
  const list = usePagedList<Task>(objectiveKeys.tasks(objectiveId), `/api/objectives/${objectiveId}/tasks`, {}, { pageSize: 20 });
  if (list.isLoading) return <div className="grid gap-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-14 rounded-[var(--radius-sm)]" />)}</div>;
  if (!list.items.length) {
    return <p className="rounded-[var(--radius-md)] border border-dashed border-border px-3 py-5 text-center text-[12.5px] text-muted">{t("No work linked yet. Pick this objective in the new-task form or on a task.")}</p>;
  }
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
        {list.items.map((x) => (
          <li key={x.id}>
            <Link to="/tasks" search={{ task: x.id }} className="flex min-h-12 min-w-0 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2/60">
              {x.assignee_name ? <AgentAvatar name={x.assignee_name} color={x.assignee_color ?? "#888"} size="xs" /> : <span className="size-6 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13px] font-medium break-words">{x.depth ? <span className="text-muted">↳ </span> : null}{x.title}</span>
                <span className="block truncate text-[12px] text-muted">{x.assignee_name ?? t("Unassigned")} · {timeAgo(x.created_at)}</span>
              </span>
              <Pill tone={STATUS_INFO[x.status].tone} className="shrink-0">{t(STATUS_INFO[x.status].label)}</Pill>
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore shown={list.items.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} noun={t("tasks")} />
    </div>
  );
}

function ObjectiveSheet({ id, onClose, onOpen, onEdit }: { id: string; onClose: () => void; onOpen: (id: string) => void; onEdit: (o: Objective) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery(objectiveQuery(id));
  const [deleting, setDeleting] = useState(false);
  const o = data?.objective;
  const setStatus = useMutation({
    mutationFn: (status: ObjectiveStatus) => api<Objective>(`/api/objectives/${id}`, "PATCH", { status }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: objectiveKeys.all });
      toast.success(r.status === "done" ? t("Marked done.") : r.status === "active" ? t("Reopened.") : t("Dropped."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = async () => {
    try {
      await api(`/api/objectives/${id}`, "DELETE");
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    qc.invalidateQueries({ queryKey: objectiveKeys.all });
    toast.success(t("Objective deleted. Its tasks stay, unlinked."));
    onClose();
  };
  const ratio = o && o.budget_usd ? o.rollup_usd / o.budget_usd : 0;
  const [partBefore = "", partAfter = ""] = t("Part of {title}").split("{title}");

  return (
    <SideSheet
      open
      onOpenChange={(v) => !v && onClose()}
      title={o ? <span className="line-clamp-3 break-words">{o.title}</span> : t("Objective")}
      description={o ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Pill tone={STATUS[o.status].tone}>{t(STATUS[o.status].label)}</Pill>
          <BudgetPill o={o} />
          <span>{o.branch_name ?? t("Every company")}{o.department_name ? `, ${o.department_name}` : ""}</span>
        </span>
      ) : undefined}
      actions={o?.can_edit ? (
        <>
          <Button size="sm" variant="outline" onClick={() => onEdit(o)}><PencilSimpleIcon size={14} /> {t("Edit")}</Button>
          {o.status === "active" ? (
            <Button size="sm" loading={setStatus.isPending} onClick={() => setStatus.mutate("done")}><CheckCircleIcon size={14} weight="bold" /> {t("Mark done")}</Button>
          ) : (
            <Button size="sm" variant="outline" loading={setStatus.isPending} onClick={() => setStatus.mutate("active")}><ArrowCounterClockwiseIcon size={14} /> {t("Reopen")}</Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link to="/tasks" search={{ new: 1, objective: o.id }}><KanbanIcon size={14} /> {t("New task")}</Link>
          </Button>
          <Button size="sm" variant="ghost" className="text-muted hover:text-danger" onClick={() => setDeleting(true)}><TrashIcon size={14} /> {t("Delete")}</Button>
        </>
      ) : undefined}
    >
      {isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-20 rounded-[var(--radius-md)]" />
          <Skeleton className="h-40 rounded-[var(--radius-md)]" />
          <Skeleton className="h-32 rounded-[var(--radius-md)]" />
        </div>
      ) : error || !data || !o ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {data.parent ? (
            <button type="button" onClick={() => onOpen(data.parent!.id)} className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5 text-left text-[13px] text-muted transition-colors hover:bg-surface-2/60 hover:text-fg">
              <ArrowElbowLeftUpIcon size={15} className="shrink-0" />
              <span className="min-w-0">{partBefore}<span className="font-medium break-words text-fg">{data.parent.title}</span>{partAfter}</span>
            </button>
          ) : null}
          {o.target ? (
            <section className="grid min-w-0 gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold"><FlagIcon size={15} weight="duotone" className="text-muted" /> {t("Target")}</h3>
              <p className="text-[13.5px] break-words">{o.target}</p>
            </section>
          ) : null}
          <section className="grid min-w-0 gap-2.5">
            <dl className="grid grid-cols-2 divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2/40 sm:grid-cols-4 [&>*]:border-border max-sm:[&>*:nth-child(n+3)]:border-t sm:[&>*+*]:border-l max-sm:[&>*:nth-child(even)]:border-l">
              <Fact label={t("Work done")} value={`${o.progress.done} / ${o.progress.total - o.progress.cancelled}`} hint={o.progress.failed ? t("{n} failed", { n: o.progress.failed }) : t("{n} open", { n: o.progress.open })} />
              <Fact label={t("Spent")} value={rm(o.usd)} hint={t("{n} tokens", { n: Intl.NumberFormat(locale(), { notation: "compact" }).format(o.tokens) })} />
              <Fact label={data.children.length ? t("With parts") : t("Budget")} value={data.children.length ? rm(o.rollup_usd) : o.budget_usd !== null ? rm(o.budget_usd) : t("None")} hint={data.children.length ? t("{n} nested", { n: data.children.length }) : o.budget_usd !== null ? t("{n}% used", { n: Math.round(ratio * 100) }) : t("No cap")} />
              <Fact label={t("Due")} value={dueLabel(o.due_on)?.text ?? t("No date")} hint={o.created_by_name ? t("Set by {name}", { name: o.created_by_name }) : undefined} />
            </dl>
            <div className="grid gap-1">
              <ProgressBar o={o} className="h-2" />
              <p className="text-[12px] text-muted tabular">{progressText(o)}</p>
            </div>
            {o.budget_usd !== null ? (
              <div className="grid gap-1">
                <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={t("Budget used")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
                  <div className={cn("h-full rounded-full", o.budget_state === "over" ? "bg-danger" : o.budget_state === "near" ? "bg-warn" : "bg-ok")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </div>
                <p className="text-[12px] text-muted tabular">
                  {t("{spent} of {budget} budget ({pct}%)", { spent: rm(o.rollup_usd), budget: rm(o.budget_usd), pct: Math.round(ratio * 100) })}{o.budget_state === "over" ? `. ${t("New work under it asks for approval before it starts.")}` : ""}
                </p>
              </div>
            ) : null}
          </section>
          <CostChart days={data.cost_by_day} />
          {data.children.length ? (
            <section className="grid min-w-0 gap-2.5">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold"><TreeStructureIcon size={15} weight="duotone" className="text-muted" /> {t("Parts")} <span className="font-normal text-muted">({data.children.length})</span></h3>
              <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
                {data.children.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpen(c.id)} className="grid w-full min-w-0 gap-1.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2/60">
                      <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="min-w-0 text-[13px] font-medium break-words">{c.title}</span>
                        <span className="shrink-0 text-[12.5px] font-medium tabular">{rm(c.rollup_usd)}</span>
                      </span>
                      <ProgressBar o={c} />
                      <span className="text-[11.5px] text-muted tabular">{progressText(c)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="grid min-w-0 gap-2.5">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold"><KanbanIcon size={15} weight="duotone" className="text-muted" /> {t("Work")} <span className="font-normal text-muted">{t("(tasks and their parts)")}</span></h3>
            <TaskList objectiveId={o.id} />
          </section>
        </div>
      )}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t("Delete this objective?")} danger confirmLabel={t("Delete")}
        body={t("Its tasks stay and are unlinked; objectives nested under it move up a level. To keep its history, mark it done or dropped instead.")} onConfirm={remove} />
    </SideSheet>
  );
}

// ---------------------------------------------------------------- the page

export function ObjectivesPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const search = useSearch({ strict: false }) as { o?: string; new?: number };
  const navigate = useNavigate();
  const { data: rows = [], isLoading, error } = useQuery(objectivesQuery());
  const { data: branches = [] } = useQuery(branchesQuery);
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Objective | null>(null);
  const [dialog, setDialog] = useState(false);
  const canCreate = hasAny(me, "org.manage", "team.manage");
  const creating = dialog || !!search.new;

  const open = (id: string | undefined) => navigate({ to: "/objectives", search: (s: Record<string, unknown>) => ({ ...s, o: id, new: undefined }), replace: !!search.o && !!id });

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { active: 0, done: 0, dropped: 0, all: rows.length };
    for (const o of rows) c[o.status] += 1;
    return c;
  }, [rows]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = rows.filter((o) => (filter === "all" || o.status === filter) && (!needle || `${o.title} ${o.target} ${o.department_name ?? ""}`.toLowerCase().includes(needle)));
    const byBranch = new Map<string, Objective[]>();
    for (const o of shown) byBranch.set(o.branch_id ?? EVERY, [...(byBranch.get(o.branch_id ?? EVERY) ?? []), o]);
    const order: { key: string; name: string; color?: string; branch?: Branch }[] = [
      { key: EVERY, name: t("Every company") },
      ...branches.map((b) => ({ key: b.id, name: b.name, color: b.color, branch: b })),
      ...[...byBranch.keys()].filter((k) => k !== EVERY && !branches.some((b) => b.id === k)).map((k) => ({ key: k, name: byBranch.get(k)![0]!.branch_name ?? t("Other company") })),
    ];
    return order.filter((g) => byBranch.has(g.key)).map((g) => ({ ...g, rows: byBranch.get(g.key)!, nodes: buildTree(byBranch.get(g.key)!) }));
  }, [rows, branches, filter, q, t]);
  const statusWord = filter === "all" ? "" : t(STATUS[filter].label).toLowerCase();
  const noneShown = statusWord
    ? (q ? t("No {status} objectives match \"{q}\".", { status: statusWord, q }) : t("No {status} objectives.", { status: statusWord }))
    : (q ? t("No objectives match \"{q}\".", { q }) : t("No objectives."));

  const titles = useMemo(() => new Map(rows.map((o) => [o.id, o.title])), [rows]);
  // Headline numbers over the top objectives (a parent's roll-up already holds its parts).
  const tops = rows.filter((o) => o.status === "active" && (!o.parent_id || !rows.some((p) => p.id === o.parent_id)));
  const spent = tops.reduce((s, o) => s + o.rollup_usd, 0);
  const done = rows.filter((o) => o.status === "active").reduce((s, o) => s + o.progress.done, 0);
  const total = rows.filter((o) => o.status === "active").reduce((s, o) => s + o.progress.total - o.progress.cancelled, 0);
  const attention = rows.filter((o) => o.status === "active" && (o.budget_state === "over" || o.budget_state === "near" || (dueLabel(o.due_on)?.tone === "danger"))).length;
  const avg = tops.length ? Math.round((tops.reduce((s, o) => s + doneShare(o), 0) / tops.length) * 100) : 0;

  return (
    <Page>
      <PageHeader
        title={t("Objectives")}
        description={t("What the company's work is for. Link tasks to an objective: agents see why the work matters, and progress and cost add up here, including everything a task hands out.")}
        actions={canCreate ? <Button onClick={() => { setEditing(null); setDialog(true); }}><PlusIcon size={16} weight="bold" /> {t("New objective")}</Button> : null}
      />
      {isLoading ? <ListSkeleton /> : error ? (
        <p role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">{t("Could not load objectives. {error}", { error: errorMessage(error) })}</p>
      ) : !rows.length ? (
        <EmptyState
          icon={TargetIcon}
          title={t("No objectives yet")}
          body={canCreate ? t("Set what the company is working toward, such as \"Win 5 government tenders this quarter\". Then link tasks to it: agents see why the work matters and you see what it cost.") : t("Your managers have not set objectives yet. When they do, you can link your tasks to them.")}
          action={canCreate ? <Button onClick={() => { setEditing(null); setDialog(true); }}><PlusIcon size={16} weight="bold" /> {t("New objective")}</Button> : undefined}
        />
      ) : (
        <>
          <StatGrid>
            <Stat label={t("Active objectives")} value={counts.active} icon={TargetIcon} tone="accent" hint={t("{done} done, {dropped} dropped", { done: counts.done, dropped: counts.dropped })} />
            <Stat label={t("Work done")} value={`${done}/${total}`} icon={CheckCircleIcon} tone="ok" hint={tops.length ? t("{n}% on average", { n: avg }) : t("No active work")} />
            <Stat label={t("Spent on active")} value={rm(spent)} icon={CoinsIcon} tone="orange" hint={t("AI spend, all linked work")} />
            <Stat label={t("Needs attention")} value={attention} icon={WarningIcon} tone={attention ? "warn" : "neutral"} hint={attention ? t("Near or over budget, or late") : t("All on track")} />
          </StatGrid>
          <Toolbar className="justify-between">
            <Segmented label={t("Status")} value={filter} onChange={setFilter}
              options={[{ value: "active", label: t("Active"), count: counts.active }, { value: "done", label: t("Done"), count: counts.done }, { value: "dropped", label: t("Dropped"), count: counts.dropped }, { value: "all", label: t("All"), count: counts.all }]} />
            <SearchInput value={q} onChange={setQ} placeholder={t("Search objectives")} />
          </Toolbar>
          {groups.length ? groups.map((g) => (
            <CompanyGroup key={g.key} name={g.name} color={g.color} nodes={g.nodes} count={g.rows.length} onOpen={(id) => open(id)} active={search.o} titles={titles} />
          )) : (
            <Card><CardBody className="py-10 text-center text-[13px] text-muted">{noneShown}</CardBody></Card>
          )}
          <Card>
            <CardHeader icon={<IconTile icon={KanbanIcon} tone="info" size="sm" />} title={t("How work links to an objective")}
              description={t("Pick an objective in the new-task form or on a task. Everything that task hands out (delegated work, helpers, questions to colleagues, workflow steps) joins it automatically.")} />
          </Card>
        </>
      )}
      {search.o ? (
        <ObjectiveSheet id={search.o} onClose={() => open(undefined)} onOpen={(id) => open(id)} onEdit={(o) => { setEditing(o); setDialog(true); }} />
      ) : null}
      {creating ? (
        <ObjectiveDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(v) => { if (!v) { setDialog(false); setEditing(null); if (search.new) navigate({ to: "/objectives", search: (s: Record<string, unknown>) => ({ ...s, new: undefined }), replace: true }); } }}
          editing={editing}
          all={rows}
          onSaved={(o) => { setDialog(false); setEditing(null); open(o.id); }}
        />
      ) : null}
    </Page>
  );
}
