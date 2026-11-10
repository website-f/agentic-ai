/**
 * P97: the board's other views. "List": every open and done task as the shared data table
 * (sort, search, pages; cards on phones). "Due": what is overdue, due today, this week and
 * later, so a head of department sees at a glance what is slipping.
 */
import { CalendarBlankIcon, CheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { AssigneeFace, assigneeName } from "@/components/person-avatar";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { DataTable, useLocalTableState, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { dueGroup, dueLabel, dueTone, isPersonTask, nextStep, PERSON_STATUS, type DueGroup } from "@/lib/people";
import { cn, timeAgo } from "@/lib/utils";
import { PRIORITY_INFO, STATUS_INFO, workKeys, type Task, type TaskStatus } from "@/lib/work";

export interface ViewFilters {
  q: string;
  who?: string;
  assignee?: string;
  branch?: string;
}

const OPEN = "triage,ready,running,blocked,review";

function url(f: ViewFilters, extra: Record<string, string>): string {
  const p = new URLSearchParams({ limit: "500", ...extra });
  if (f.q) p.set("q", f.q);
  if (f.who && f.who !== "all") p.set("who", f.who);
  if (f.assignee) p.set("assignee", f.assignee);
  if (f.branch) p.set("branch_id", f.branch);
  return `/api/tasks?${p}`;
}

/** The status a card shows: people's words for a person's task. */
export function statusText(t: Task, tr: (s: string) => string): string {
  return tr((isPersonTask(t) ? PERSON_STATUS[t.status] : null) ?? STATUS_INFO[t.status].label);
}

export function DueChip({ task, className }: { task: Task; className?: string }) {
  const t = useT();
  const tone = dueTone(task);
  if (!task.due_at || !tone) return null;
  const label = dueLabel(task.due_at, locale());
  return (
    <span title={t("Due {when}", { when: new Date(task.due_at).toLocaleString(locale()) })}
      className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium tabular whitespace-nowrap",
        tone === "overdue" ? "bg-danger/10 text-danger" : tone === "today" ? "bg-warn/12 text-warn" : tone === "soon" ? "bg-info/10 text-info" : "bg-surface-2 text-muted", className)}>
      {tone === "overdue" ? <WarningCircleIcon size={11} weight="bold" /> : <CalendarBlankIcon size={11} />}
      {tone === "overdue" ? t("Overdue {when}", { when: label }) : tone === "today" ? t("Today {when}", { when: label }) : label}
    </span>
  );
}

/** One click to take the next step on my own task (accept, start, mark done). */
export function NextStepButton({ task, meId, size = "sm" }: { task: Task; meId: string; size?: "sm" | "md" }) {
  const t = useT();
  const qc = useQueryClient();
  const step = task.assignee_user_id === meId ? nextStep(task) : null;
  const go = useMutation({
    mutationFn: (to: TaskStatus) => api<Task>(`/api/tasks/${task.id}`, "PATCH", { status: to }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      toast.success(r.status === "review" ? t("Sent for a check.") : t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!step) return null;
  return (
    <Button size={size} variant={step.to === "done" ? "primary" : "outline"} loading={go.isPending} onClick={(e) => { e.stopPropagation(); go.mutate(step.to); }}>
      {step.to === "done" ? <CheckIcon size={14} weight="bold" /> : null} {t(step.label)}
    </Button>
  );
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
const STATUS_RANK: Record<TaskStatus, number> = { triage: 0, ready: 1, running: 2, blocked: 3, review: 4, done: 5, failed: 6, cancelled: 7 };

export function ListView({ f, onOpen }: { f: ViewFilters; onOpen: (id: string) => void }) {
  const t = useT();
  const control = useLocalTableState({ size: 25 });
  const { data = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [...workKeys.tasks, "list-view", f],
    queryFn: () => api<Task[]>(url(f, { status: `${OPEN},done` })),
  });
  const columns: Column<Task>[] = [
    {
      id: "title", header: t("Task"), card: "title", sortValue: (r) => r.title.toLowerCase(),
      cell: (r) => (
        <span className="grid min-w-0 gap-0.5">
          <span className="line-clamp-2 font-medium break-words">{r.title}</span>
          {r.labels?.length ? <span className="flex flex-wrap gap-1">{r.labels.slice(0, 3).map((l) => <Pill key={l}>{l}</Pill>)}</span> : null}
        </span>
      ),
    },
    {
      id: "assignee", header: t("For"), sortValue: (r) => (assigneeName(r) ?? "~").toLowerCase(),
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <AssigneeFace task={r} />
          <span className="truncate">{assigneeName(r) ?? <span className="text-muted italic">{t("Unassigned")}</span>}</span>
        </span>
      ),
    },
    { id: "status", header: t("Status"), sortValue: (r) => STATUS_RANK[r.status], cell: (r) => <Pill tone={STATUS_INFO[r.status].tone}>{statusText(r, t)}</Pill> },
    { id: "due", header: t("Due"), kind: "date", sortValue: (r) => r.due_at ?? "9999", cell: (r) => (r.due_at ? <DueChip task={r} /> : <span className="text-muted">-</span>) },
    { id: "priority", header: t("Priority"), hideBelow: "lg", sortValue: (r) => PRIORITY_RANK[r.priority], cell: (r) => <Pill tone={PRIORITY_INFO[r.priority].tone}>{t(PRIORITY_INFO[r.priority].label)}</Pill> },
    { id: "updated", header: t("Updated"), kind: "date", hideBelow: "xl", sortValue: (r) => r.updated_at, cell: (r) => <span className="text-muted tabular">{timeAgo(r.updated_at)}</span> },
  ];
  return (
    <DataTable<Task> label={t("Tasks")} columns={columns} rows={data} rowId={(r) => r.id} rowLabel={(r) => r.title} control={control}
      loading={isLoading} fetching={isFetching} error={error} onRetry={() => void refetch()} noSearch onOpen={(r) => onOpen(r.id)}
      empty={<EmptyState icon={CalendarBlankIcon} title={t("No tasks here")} body={t("Add one above, or change the filters.")} />} />
  );
}

const GROUPS: { id: DueGroup; label: string; tone: string }[] = [
  { id: "overdue", label: msg("Overdue"), tone: "text-danger" },
  { id: "today", label: msg("Due today"), tone: "text-warn" },
  { id: "week", label: msg("This week"), tone: "text-info" },
  { id: "later", label: msg("Later"), tone: "text-muted" },
];

export function DueView({ f, meId, onOpen }: { f: ViewFilters; meId: string; onOpen: (id: string) => void }) {
  const t = useT();
  const { data = [], isLoading, error } = useQuery({
    queryKey: [...workKeys.tasks, "due-view", f],
    queryFn: () => api<Task[]>(url(f, { status: OPEN, has_due: "true" })),
  });
  if (isLoading) return <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />)}</div>;
  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data.length) return <EmptyState icon={CalendarBlankIcon} title={t("Nothing is due")} body={t("Tasks with a due date show here, soonest first.")} />;
  const by = new Map<DueGroup, Task[]>();
  for (const task of data) {
    const g = dueGroup(task);
    by.set(g, [...(by.get(g) ?? []), task]);
  }
  return (
    <div className="grid min-w-0 gap-5">
      {GROUPS.map((g) => {
        const rows = by.get(g.id) ?? [];
        if (!rows.length) return null;
        return (
          <section key={g.id} aria-label={t(g.label)} className="grid min-w-0 gap-2">
            <h2 className={cn("flex items-center gap-2 text-[13px] font-semibold", g.tone)}>
              {t(g.label)} <span className="rounded-full bg-surface-2 px-2 text-[11.5px] font-medium text-muted tabular">{rows.length}</span>
            </h2>
            <ul className="grid min-w-0 divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
              {rows.map((task) => <DueRow key={task.id} task={task} meId={meId} onOpen={() => onOpen(task.id)} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function DueRow({ task, meId, onOpen }: { task: Task; meId: string; onOpen: () => void }): ReactNode {
  const t = useT();
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 basis-60 items-center gap-2.5 text-left">
        <AssigneeFace task={task} size="sm" />
        <span className="grid min-w-0 gap-0.5">
          <span className="line-clamp-2 text-[13.5px] font-medium break-words">{task.title}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <span className="truncate">{assigneeName(task) ?? t("Unassigned")}</span>
            <span aria-hidden>·</span>
            <span>{statusText(task, t)}</span>
          </span>
        </span>
      </button>
      <DueChip task={task} />
      <NextStepButton task={task} meId={meId} />
    </li>
  );
}
