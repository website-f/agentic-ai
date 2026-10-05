/**
 * P21 accountable work, shared by the board, the task sheet, the new-task dialog, the monitor
 * and the review settings: what a task waits for (blockers, or an owner + action), silent runs,
 * and review stages (an agent reviewer before a person).
 */
import {
  CheckCircleIcon,
  HourglassMediumIcon,
  LinkSimpleIcon,
  MoonStarsIcon,
  PlusIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  UserFocusIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { t, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useDebounced } from "@/lib/paged";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, STATUS_INFO, workKeys, type Task, type TaskStatus } from "@/lib/work";

// ---------------------------------------------------------------- types (API P21 fields)

export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
  assignee_agent_id?: string | null;
}

/** Fields the API adds to every task (routers/tasks.py fill_accountable). */
export interface Accountable {
  blocked_owner?: string | null;
  blocked_owner_name?: string | null;
  blocked_action?: string | null;
  waiting_for?: TaskRef[];
  restartable?: boolean;
  review_round?: number;
  quiet_minutes?: number | null;
}
export type TaskX = Task & Accountable;

export type ReviewStage = { type: "agent"; agent_id: string } | { type: "human" };
export interface ReviewPolicy {
  stages: ReviewStage[];
  max_rounds: number;
}
export interface ReviewEntry {
  round: number;
  stage: number;
  decision: "accept" | "changes" | "error";
  notes?: string;
  reviewer_id?: string;
  reviewer_name?: string;
  review_task_id?: string;
  ts: string;
  text: string;
}
/** Fields the task detail adds (blockers, what waits for it, review trail and policy). */
export interface AccountableDetail {
  blockers?: TaskRef[];
  blocking?: TaskRef[];
  reviews?: ReviewEntry[];
  review_policy?: (ReviewPolicy & { summary: string | null }) | null;
}

// ---------------------------------------------------------------- the waiting path

export interface WaitingPath {
  kind: "blockers" | "owner" | "review" | "approval";
  title: string;
  detail?: string;
  /** Why, for the task sheet (the board shows title and detail only). */
  reason?: string;
}

/** Who or what a task waits for, in words (null when it waits for nothing). */
export function waitingPath(task: TaskX): WaitingPath | null {
  const owner = task.blocked_owner_name ?? (task.blocked_owner?.startsWith("agent:") ? t("an agent") : null);
  if (task.status === "review" && task.blocked_owner?.startsWith("agent:")) {
    return { kind: "review", title: t("{name} is reviewing it", { name: task.blocked_owner_name ?? t("A reviewer agent") }) };
  }
  if (task.status !== "blocked") return null;
  const waits = task.waiting_for ?? [];
  if (waits.length && !task.blocked_owner) {
    const names = waits.slice(0, 2).map((w) => w.title).join(", ");
    return {
      kind: "blockers",
      title: waits.length === 1 ? t("Waiting for 1 task") : t("Waiting for {n} tasks", { n: waits.length }),
      detail: waits.length > 2 ? t("{names} and {n} more", { names, n: waits.length - 2 }) : names,
    };
  }
  if (task.blocked_action) {
    return { kind: task.pending_approvals ? "approval" : "owner", title: owner ? t("Waiting for {name}", { name: owner }) : t("Waiting for an approver"), detail: task.blocked_action, reason: task.blocked_reason ?? undefined };
  }
  if (task.pending_approvals) return { kind: "approval", title: t("Waiting for an approver"), detail: task.blocked_reason ?? undefined };
  return task.blocked_reason ? { kind: "owner", title: task.blocked_reason } : null;
}

/** The status label, honest about who it waits on ("Waiting on you" only when it is a person). */
export function statusLabel(task: TaskX): string {
  const p = waitingPath(task);
  if (task.status === "blocked" && p?.kind === "blockers") return t("Waiting");
  if (task.status === "review" && p?.kind === "review") return t("Agent review");
  return t(STATUS_INFO[task.status].label);
}

const PATH_ICON = { blockers: HourglassMediumIcon, owner: UserFocusIcon, review: ShieldCheckIcon, approval: SealCheckIcon };

/** Compact "Waiting for" line on board cards. */
export function WaitingChip({ task }: { task: TaskX }) {
  const p = waitingPath(task);
  if (!p) return null;
  const Icon = PATH_ICON[p.kind];
  const calm = p.kind === "blockers" || p.kind === "review";
  return (
    <p className={cn("flex min-w-0 items-start gap-1.5 rounded-[6px] px-2 py-1 text-[12px]", calm ? "bg-info/10 text-info" : "bg-warn/10 text-warn")}>
      <Icon size={13} weight="bold" className="mt-[3px] shrink-0" />
      <span className="min-w-0">
        <span className="line-clamp-2 font-medium break-words">{p.title}</span>
        {p.detail ? <span className="line-clamp-2 break-words opacity-85">{p.detail}</span> : null}
      </span>
    </p>
  );
}

export function QuietBadge({ minutes, className }: { minutes?: number | null; className?: string }) {
  const t = useT();
  if (!minutes) return null;
  const text = minutes >= 120 ? t("Quiet for {n} h", { n: Math.floor(minutes / 60) }) : t("Quiet for {n} min", { n: minutes });
  return (
    <Pill tone="warn" className={cn("shrink-0", className)} title={t("No agent activity for a while. It is still running; nothing was stopped.")}>
      <MoonStarsIcon size={12} weight="fill" /> {text}
    </Pill>
  );
}

export function ReviewRoundPill({ task }: { task: TaskX }) {
  const t = useT();
  const reviewing = task.status === "review" && !!task.blocked_owner?.startsWith("agent:");
  if (!task.review_round && !reviewing) return null;
  const sentBack = task.review_round === 1 ? t("The reviewer agent sent it back 1 time") : t("The reviewer agent sent it back {n} times", { n: task.review_round ?? 0 });
  return (
    <Pill tone="info" title={task.review_round ? sentBack : undefined}>
      <ShieldCheckIcon size={11} weight="fill" /> {reviewing ? t("Review round {n}", { n: (task.review_round ?? 0) + 1 }) : t("Sent back {n}×", { n: task.review_round ?? 0 })}
    </Pill>
  );
}

// ---------------------------------------------------------------- picking tasks to wait for

const OPEN_STATUSES = "triage,ready,running,blocked,review";

/** Search open tasks and pick the ones this task waits for. */
export function TaskPicker({ value, onChange, exclude = [], autoFocus }: { value: TaskRef[]; onChange: (v: TaskRef[]) => void; exclude?: string[]; autoFocus?: boolean }) {
  const t = useT();
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim(), 250);
  const { data = [], isFetching } = useQuery({
    queryKey: [...workKeys.tasks, "pick", needle],
    queryFn: () => api<Task[]>(`/api/tasks?limit=8&status=${OPEN_STATUSES}${needle ? `&q=${encodeURIComponent(needle)}` : ""}`),
    staleTime: 15_000,
  });
  const skip = new Set([...exclude, ...value.map((v) => v.id)]);
  const options = data.filter((x) => !skip.has(x.id));
  return (
    <div className="grid min-w-0 gap-2">
      {value.length ? (
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={t("Waits for")}>
          {value.map((v) => (
            <li key={v.id} className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pr-1 pl-2.5 text-[12.5px]">
              <HourglassMediumIcon size={12} className="shrink-0 text-muted" />
              <span className="truncate">{v.title}</span>
              <button type="button" aria-label={t("Do not wait for {title}", { title: v.title })} onClick={() => onChange(value.filter((x) => x.id !== v.id))}
                className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><XIcon size={12} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={cn("grid min-w-0 gap-1 rounded-sm", autoFocus && "[&_input]:scroll-mt-24")}>
        <SearchInput value={q} onChange={setQ} placeholder={t("Search tasks to wait for")} label={t("Search tasks to wait for")} className="basis-auto" />
        <ul role="listbox" aria-label={t("Tasks")} className="grid max-h-52 min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto rounded-sm border border-border bg-surface">
          {options.length ? options.map((o) => (
            <li key={o.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => { onChange([...value, { id: o.id, title: o.title, status: o.status }]); setQ(""); }}
                className="flex min-h-10 w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-2/70 focus-visible:bg-surface-2/70 focus-visible:outline-none">
                <PlusIcon size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.title}</span>
                  <span className="block truncate text-[11.5px] text-muted">{o.assignee_name ?? t("Unassigned")}</span>
                </span>
                <Pill tone={STATUS_INFO[o.status].tone} className="shrink-0">{t(STATUS_INFO[o.status].label)}</Pill>
              </button>
            </li>
          )) : (
            <li className="px-3 py-2.5 text-[12.5px] text-muted">{isFetching ? t("Searching…") : needle ? t("No open task matches.") : t("No open tasks.")}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- task sheet sections

function TaskRow({ t: row, trailing }: { t: TaskRef; trailing?: ReactNode }) {
  const t = useT();
  const done = row.status === "done";
  const dead = row.status === "cancelled" || row.status === "failed";
  return (
    <li className="flex min-h-11 min-w-0 items-center gap-2.5 px-3 py-1.5">
      {done ? <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-ok" /> : dead ? <WarningCircleIcon size={16} weight="fill" className="shrink-0 text-danger" /> : <HourglassMediumIcon size={16} className="shrink-0 text-muted" />}
      <Link to="/tasks" search={{ task: row.id }} className="min-w-0 flex-1 text-[13px] font-medium break-words hover:text-accent hover:underline">{row.title}</Link>
      <Pill tone={STATUS_INFO[row.status].tone} className="shrink-0">{row.status === "blocked" ? t("Waiting") : t(STATUS_INFO[row.status].label)}</Pill>
      {trailing}
    </li>
  );
}

/** Work that has not started (or is parked) may be told to wait for other tasks. */
export function canWait(t: TaskX): boolean {
  return t.status === "triage" || t.status === "ready" || (t.status === "blocked" && !!t.restartable && !t.blocked_action?.startsWith("Stopped"));
}

/** What this task waits for (editable while it has not started) and what waits for it. */
export function BlockersPanel({ task, detail, canWrite }: { task: TaskX; detail: AccountableDetail; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<TaskRef[]>([]);
  const blockers = detail.blockers ?? [];
  const blocking = detail.blocking ?? [];
  const editable = canWrite && canWait(task);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: workKeys.tasks });
    qc.invalidateQueries({ queryKey: workKeys.task(task.id) });
  };
  const add = useMutation({
    mutationFn: () => api<Task>(`/api/tasks/${task.id}/blockers`, "POST", { task_ids: picked.map((p) => p.id) }),
    onSuccess: () => { refresh(); setPicked([]); setAdding(false); toast.success(t("It waits for them now.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<Task>(`/api/tasks/${task.id}/blockers/${id}`, "DELETE"),
    onSuccess: () => { refresh(); toast.success(t("No longer waiting for it.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!blockers.length && !blocking.length && !editable) return null;
  return (
    <div className="grid min-w-0 gap-3">
      {blockers.length ? (
        <ul aria-label={t("Waits for")} className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
          {blockers.map((b) => (
            <TaskRow key={b.id} t={b} trailing={editable ? (
              <Button size="icon-sm" variant="ghost" aria-label={t("Stop waiting for {title}", { title: b.title })} disabled={remove.isPending} onClick={() => remove.mutate(b.id)}><XIcon size={14} /></Button>
            ) : null} />
          ))}
        </ul>
      ) : null}
      {editable ? (adding ? (
        <div className="grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-border p-3">
          <TaskPicker value={picked} onChange={setPicked} exclude={[task.id, ...blockers.map((b) => b.id)]} autoFocus />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!picked.length} loading={add.isPending} onClick={() => add.mutate()}>{picked.length > 1 ? t("Wait for these {n}", { n: picked.length }) : t("Wait for it")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setPicked([]); }}>{t("Cancel")}</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setAdding(true)}><LinkSimpleIcon size={14} /> {blockers.length ? t("Wait for another task") : t("Start after another task")}</Button>
      )) : null}
      {blocking.length ? (
        <div className="grid min-w-0 gap-1.5">
          <p className="text-[12.5px] text-muted">{t("Starts after this one is done:")}</p>
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
            {blocking.map((b) => <TaskRow key={b.id} t={b} />)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Round by round: who reviewed it and what they said. */
export function ReviewTrail({ detail }: { detail: AccountableDetail }) {
  const t = useT();
  const reviews = detail.reviews ?? [];
  if (!reviews.length && !detail.review_policy) return null;
  return (
    <div className="grid min-w-0 gap-2.5">
      {detail.review_policy?.summary ? <p className="text-[12.5px] break-words text-muted">{t("Checked by {summary}.", { summary: detail.review_policy.summary })}</p> : null}
      {reviews.length ? (
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {reviews.map((r, i) => (
            <li key={`${r.review_task_id ?? i}-${r.ts}`} className="grid min-w-0 gap-1 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-3.5 py-2.5">
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className="font-medium">{t("Round {n}", { n: r.round })}</span>
                <span className="text-muted">{r.reviewer_name ?? t("Reviewer")}</span>
                <Pill tone={r.decision === "accept" ? "ok" : r.decision === "changes" ? "warn" : "danger"} className="ml-auto">
                  {r.decision === "accept" ? t("Accepted") : r.decision === "changes" ? t("Asked for changes") : t("Could not review")}
                </Pill>
              </p>
              {r.notes ? <p className="text-[12.5px] whitespace-pre-line break-words text-fg/90">{r.notes}</p> : null}
              <span className="flex flex-wrap items-center gap-x-3 text-[11.5px] text-muted">
                <time dateTime={r.ts}>{timeAgo(r.ts)}</time>
                {r.review_task_id ? <Link to="/tasks" search={{ task: r.review_task_id }} className="text-accent hover:underline">{t("Open the review")}</Link> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- review settings

const NO_AGENT = "__none";

/** Edit a review policy: an agent reviewer, rounds, and a person's final check. */
export function ReviewPolicyFields({ value, onChange, disabled }: { value: ReviewPolicy | null; onChange: (v: ReviewPolicy | null) => void; disabled?: boolean }) {
  const t = useT();
  const { data: agents = [] } = useQuery(agentsQuery);
  const reviewers = agents.filter((a) => a.status === "active" && !a.clone_of && !a.private);
  const agentStage = value?.stages.find((s): s is { type: "agent"; agent_id: string } => s.type === "agent");
  const human = !!value?.stages.some((s) => s.type === "human");
  const rounds = value?.max_rounds ?? 3;
  const build = (agentId: string | null, withHuman: boolean, maxRounds: number): ReviewPolicy | null => {
    const stages: ReviewStage[] = [...(agentId ? [{ type: "agent" as const, agent_id: agentId }] : []), ...(withHuman ? [{ type: "human" as const }] : [])];
    return agentId ? { stages, max_rounds: maxRounds } : null;
  };
  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-1.5">
        <span className="text-[13px] font-medium">{t("Reviewer agent")}</span>
        <Select value={agentStage?.agent_id ?? NO_AGENT} disabled={disabled} label={t("Reviewer agent")}
          onValueChange={(v) => onChange(build(v === NO_AGENT ? null : v, agentStage ? human : true, rounds))}
          options={[{ value: NO_AGENT, label: t("No agent review (off)") }, ...reviewers.map((a) => ({ value: a.id, label: a.name, hint: a.role }))]} />
        <p className="text-[12px] text-muted">{t("Checks finished work against the request and the SOPs before anyone else sees it. Never reviews its own work.")}</p>
      </div>
      {agentStage ? (
        <>
          <div className="grid min-w-0 gap-1.5 sm:max-w-60">
            <span className="text-[13px] font-medium">{t("Rounds before a person decides")}</span>
            <Select value={String(rounds)} disabled={disabled} label={t("Rounds")} onValueChange={(v) => onChange(build(agentStage.agent_id, human, Number(v)))}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 1 ? t("1 round") : t("{n} rounds", { n }) }))} />
          </div>
          <SwitchField checked={human} disabled={disabled} onCheckedChange={(on) => onChange(build(agentStage.agent_id, on, rounds))}
            label={t("A person gives the final check")} hint={t("After the reviewer accepts, it still waits in review for a person. Off: accepted work is done.")} />
        </>
      ) : null}
    </div>
  );
}

/** Self-contained review settings for a department or a blueprint (loads and saves). */
export function ReviewPolicyCard({ kind, id, canEdit, className }: { kind: "departments" | "blueprints"; id: string; canEdit: boolean; className?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const key = ["review-policy", kind, id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api<{ review_policy: ReviewPolicy | null }>(`/api/${kind}/${id}/review-policy`) });
  const [draft, setDraft] = useState<ReviewPolicy | null | undefined>(undefined);
  const value = draft === undefined ? data?.review_policy ?? null : draft;
  const save = useMutation({
    mutationFn: () => api<{ review_policy: ReviewPolicy | null }>(`/api/${kind}/${id}/review-policy`, "PUT", { review_policy: value }),
    onSuccess: (r) => { qc.setQueryData(key, r); setDraft(undefined); toast.success(r.review_policy ? t("Review stages saved.") : t("Agent review is off.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(data?.review_policy ?? null);
  return (
    <section aria-label={t("Review")} className={cn("grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4", className)}>
      <h3 className="flex min-w-0 flex-wrap items-center gap-2 text-[14px] font-semibold">
        <ShieldCheckIcon size={16} weight="duotone" className="text-muted" /> {t("Review")}
        <Pill tone={value ? "accent" : "neutral"}>{value ? t("On") : t("Off")}</Pill>
      </h3>
      <p className="text-[12.5px] text-muted">{kind === "departments" ? t("For this department's work.") : t("For work by agents made from this blueprint (wins over the department's).")} {t("Helpers' parts and delegated sub-tasks are reviewed by whoever handed them out.")}</p>
      {isLoading ? <Skeleton className="h-16 rounded-sm" /> : <ReviewPolicyFields value={value} onChange={setDraft} disabled={!canEdit} />}
      {canEdit && dirty ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>{t("Save review")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>{t("Discard")}</Button>
        </div>
      ) : null}
    </section>
  );
}

/** Organization page: pick a department of a branch and set its review stages. */
export function DepartmentReviewDialog({ departments, open, onOpenChange }: { departments: { id: string; name: string }[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [dept, setDept] = useState(departments[0]?.id ?? "");
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Review stages")} className="w-[min(94vw,32rem)]"
      description={t("Have a reviewer agent check each department's finished work before it reaches a person. Off by default.")}
      footer={<Button variant="outline" onClick={() => onOpenChange(false)}>{t("Close")}</Button>}>
      {departments.length ? (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[13px] font-medium">{t("Department")}</span>
            <Select value={dept} onValueChange={setDept} label={t("Department")} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          </div>
          {dept ? <ReviewPolicyCard key={dept} kind="departments" id={dept} canEdit /> : null}
        </div>
      ) : <p className="text-[13px] text-muted">{t("Add a department first.")}</p>}
    </ResponsiveDialog>
  );
}
