import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  NoteIcon,
  SealWarningIcon,
  TargetIcon,
  WarningCircleIcon,
  ArrowElbowLeftUpIcon,
  BrainIcon,
  CoinsIcon,
  GavelIcon,
  TreeStructureIcon,
  UsersThreeIcon,
  ChatTextIcon,
  CheckIcon,
  CircleNotchIcon,
  FlagIcon,
  HandIcon,
  LightningIcon,
  PlayIcon,
  ProhibitIcon,
  TrashIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { ApprovalCard } from "@/components/approval-card";
import { Markdown } from "@/components/markdown";
import { TaskPlan } from "@/components/task-plan";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { PRIORITY_INFO, STATUS_INFO, taskQuery, workKeys, type Task, type TaskEvent } from "@/lib/work";

const EVENT_ICON: Record<string, typeof FlagIcon> = {
  created: FlagIcon, run: PlayIcon, status: CircleNotchIcon, tool: WrenchIcon, tool_blocked: ProhibitIcon,
  progress: ChatTextIcon, feedback: ArrowCounterClockwiseIcon, cancel: XIcon, memory: BrainIcon, skill: LightningIcon,
  delegated: TreeStructureIcon, delegation_done: TreeStructureIcon, meeting_called: UsersThreeIcon, decision: GavelIcon,
  correction: ArrowCounterClockwiseIcon, budget: CoinsIcon,
};

/** A titled block inside the sheet: small icon, heading, optional trailing note. */
function SheetSection({ icon: IconCmp, title, note, tone, children }: { icon: typeof FlagIcon; title: string; note?: ReactNode; tone?: "warn"; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
      <h3 className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold", tone === "warn" && "text-warn")}>
        <IconCmp size={15} weight="duotone" className={tone === "warn" ? "text-warn" : "text-muted"} />
        {title}
        {note ? <span className="font-normal text-muted">{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Facts({ task: t }: { task: Task }) {
  const items: [string, ReactNode][] = [
    ["Created", timeAgo(t.created_at)],
    ["Last update", timeAgo(t.updated_at)],
    ["Runs", t.run_count],
    ["Model calls", t.steps_used],
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2/40 sm:grid-cols-4">
      {items.map(([k, v], i) => (
        <div key={k} className={cn("grid min-w-0 gap-0.5 border-border px-3.5 py-2", i % 2 === 1 && "border-l", i >= 2 && "max-sm:border-t", i === 2 && "sm:border-l")}>
          <dt className="truncate text-[11.5px] text-muted">{k}</dt>
          <dd className="truncate text-[13px] font-medium tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function SubTasks({ tasks }: { tasks: Task[] }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
      {tasks.map((c) => (
        <li key={c.id}>
          <Link to="/tasks" search={{ task: c.id }} className="flex min-h-12 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2/60">
            {c.assignee_name ? <AgentAvatar name={c.assignee_name} color={c.assignee_color ?? "#888"} size="xs" /> : null}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] font-medium break-words">{c.title}</span>
              <span className="block truncate text-[12px] text-muted">{c.assignee_name ?? "Unassigned"}{c.has_output_schema ? " · structured answer" : ""}</span>
            </span>
            <Pill tone={STATUS_INFO[c.status].tone} className="shrink-0">{STATUS_INFO[c.status].label}</Pill>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ events }: { events: TaskEvent[] }) {
  return (
    <ol className="grid grid-cols-[minmax(0,1fr)] gap-0">
      {events.map((e, i) => {
        const Icon = EVENT_ICON[e.kind] ?? CircleNotchIcon;
        return (
          <li key={e.id} className="relative flex min-w-0 gap-3 pb-3.5">
            {i < events.length - 1 ? <span aria-hidden className="absolute top-7 bottom-0.5 left-[13px] w-px bg-border" /> : null}
            <span className={cn("relative grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted ring-4 ring-surface", e.kind === "tool_blocked" && "bg-danger/12 text-danger", (e.kind === "progress" || e.kind === "decision") && "bg-accent-soft text-accent", (e.kind === "memory" || e.kind === "skill") && "bg-info/12 text-info", e.kind === "feedback" && "bg-warn/12 text-warn")}>
              <Icon size={13} weight="bold" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[13px] break-words">
                <span className="font-medium">{e.actor_name ?? (e.actor === "system" ? "System" : e.actor)}</span>{" "}
                <span className="text-muted">
                  {e.kind === "progress" ? <>posted an update: <span className="text-fg">{e.text}</span></> : e.kind === "feedback" ? <>sent it back: <span className="text-fg">{e.text}</span></> : e.kind === "decision" ? <>summed up the meeting: <span className="whitespace-pre-line text-fg">{e.text}</span></> : e.text}
                </span>
              </p>
              {e.kind === "decision" && typeof e.data?.meeting_id === "string" ? (
                <Link to="/meetings" search={{ m: e.data.meeting_id }} className="mt-1 inline-block text-[12.5px] text-accent hover:underline">Read the meeting</Link>
              ) : null}
              {e.kind === "tool" && typeof e.data?.result_preview === "string" ? (
                <p className="mt-1 line-clamp-2 rounded-[6px] bg-surface-2/60 px-2 py-1 font-mono text-[11.5px] break-all text-muted">{e.data.result_preview}</p>
              ) : null}
              <time className="mt-0.5 block text-[11.5px] text-muted" dateTime={e.ts}>{timeAgo(e.ts)}</time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Actions({ task, canWrite, onDeleted }: { task: Task; canWrite: boolean; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    try {
      await api(`/api/tasks/${task.id}`, "DELETE");
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    qc.removeQueries({ queryKey: workKeys.task(task.id) });
    qc.invalidateQueries({ queryKey: workKeys.tasks });
    qc.invalidateQueries({ queryKey: keys.status });
    toast.success("Task deleted.");
    onDeleted();
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<Task>(`/api/tasks/${task.id}/${path}`, "POST", body ?? {}),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: workKeys.task(task.id) });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success({ start: "Started.", cancel: "Cancelling.", accept: "Accepted.", revise: "Sent back with your feedback." }[v.path] ?? "Done.");
      setRevising(false);
      setFeedback("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!canWrite) return null;
  const s = task.status;
  if (revising) {
    return (
      <form className="grid w-full gap-2" onSubmit={(e) => { e.preventDefault(); if (feedback.trim()) act.mutate({ path: "revise", body: { feedback } }); }}>
        <textarea autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} placeholder="What should change?" aria-label="Feedback"
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={!feedback.trim()} loading={act.isPending}>Send back</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setRevising(false)}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <>
      {s === "review" ? <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: "accept" })}><CheckIcon size={14} weight="bold" /> Accept</Button> : null}
      {s === "review" || s === "done" || s === "failed" ? <Button size="sm" variant="outline" onClick={() => setRevising(true)}><ArrowCounterClockwiseIcon size={14} /> Send back</Button> : null}
      {(s === "triage" || s === "ready" || s === "failed" || s === "cancelled") && task.assignee_agent_id ? (
        <Button size="sm" variant={s === "failed" ? "outline" : "primary"} loading={act.isPending} onClick={() => act.mutate({ path: "start" })}>
          <PlayIcon size={14} weight="fill" /> {s === "failed" ? "Retry" : "Start"}
        </Button>
      ) : null}
      {s !== "done" && s !== "cancelled" ? (
        <Button size="sm" variant="outline" asChild>
          <Link to="/meetings" search={{ new: 1, task: task.id }}><UsersThreeIcon size={14} /> Meeting</Link>
        </Button>
      ) : null}
      {s === "running" || s === "blocked" || s === "ready" || s === "triage" ? (
        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ path: "cancel" })}><HandIcon size={14} /> Cancel</Button>
      ) : null}
      {s === "done" || s === "failed" || s === "cancelled" ? (
        <Button size="sm" variant="ghost" className="text-muted hover:text-danger" disabled={act.isPending} onClick={() => setDeleting(true)}><TrashIcon size={14} /> Delete</Button>
      ) : null}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="Delete this task?" danger confirmLabel="Delete"
        body="The task, its conversation, its history and any sub-tasks are removed for good. Reports and files it produced stay." onConfirm={remove} />
    </>
  );
}

export function TaskSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data, isLoading, error } = useQuery({ ...taskQuery(taskId), refetchInterval: (q) => (q.state.data?.task.status === "running" ? 4000 : false) });
  const t = data?.task;
  const pending = data?.approvals.filter((a) => a.status === "pending") ?? [];
  const childrenDone = data?.children.filter((c) => c.status === "done" || c.status === "review").length ?? 0;

  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t ? <span className="line-clamp-3 break-words">{t.title}</span> : "Task"}
      description={t ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Pill tone={STATUS_INFO[t.status].tone} live={t.status === "running"}>{STATUS_INFO[t.status].label}</Pill>
          {t.priority !== "normal" ? <Pill tone={PRIORITY_INFO[t.priority].tone}>{PRIORITY_INFO[t.priority].label}</Pill> : null}
          {t.assignee_name ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-fg"><AgentAvatar name={t.assignee_name} color={t.assignee_color ?? "#888"} size="xs" /> <span className="truncate">{t.assignee_name}</span></span>
          ) : <span>Unassigned</span>}
          {t.run_count > 1 ? <span className="tabular">Run {t.run_count}</span> : null}
          {t.labels?.map((l) => <Pill key={l}>{l}</Pill>)}
        </span>
      ) : undefined}
      actions={t ? <Actions task={t} canWrite={me.permissions.includes("work.write")} onDeleted={onClose} /> : undefined}
    >
      {isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-16 rounded-[var(--radius-md)]" />
          <Skeleton className="h-40 rounded-[var(--radius-md)]" />
          <Skeleton className="h-24 rounded-[var(--radius-md)]" />
        </div>
      ) : error || !data || !t ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {pending.length ? (
            <SheetSection icon={SealWarningIcon} title="Waiting on you" note={pending.length > 1 ? `${pending.length} decisions` : undefined} tone="warn">
              {pending.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={me.permissions.includes("approvals.decide")} showTask={false} />)}
            </SheetSection>
          ) : null}
          {t.error ? (
            <p role="alert" className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 px-3.5 py-3 text-[13px] break-words text-danger">
              <WarningCircleIcon size={17} weight="duotone" className="mt-px shrink-0" /> <span className="min-w-0">{t.error}</span>
            </p>
          ) : null}
          {t.status === "blocked" && t.blocked_reason && !pending.length ? (
            <p className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warn/30 bg-warn/8 px-3.5 py-3 text-[13px] break-words text-warn">
              <HandIcon size={17} weight="duotone" className="mt-px shrink-0" /> <span className="min-w-0">{t.blocked_reason}</span>
            </p>
          ) : null}
          {t.status === "running" ? (
            <p className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/50 px-3.5 py-3 text-[13px] text-accent">
              <CircleNotchIcon size={16} className="shrink-0 motion-safe:animate-spin" /> {t.assignee_name} is working. This updates live.
            </p>
          ) : null}
          {data.parent ? (
            <Link to="/tasks" search={{ task: data.parent.id }} className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5 text-[13px] text-muted transition-colors hover:bg-surface-2/60 hover:text-fg">
              <ArrowElbowLeftUpIcon size={15} className="shrink-0" />
              <span className="min-w-0">Part of <span className="font-medium break-words text-fg">{data.parent.title}</span>{data.parent.assignee_name ? ` (${data.parent.assignee_name})` : ""}</span>
            </Link>
          ) : null}
          <Facts task={t} />
          {t.result ? (
            <SheetSection icon={CheckCircleIcon} title="Result">
              <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3.5"><Markdown>{t.result}</Markdown></div>
            </SheetSection>
          ) : null}
          {data.children.length ? (
            <SheetSection icon={TreeStructureIcon} title="Handed out" note={`${childrenDone} of ${data.children.length} done`}>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Sub-tasks done" aria-valuemin={0} aria-valuemax={data.children.length} aria-valuenow={childrenDone}>
                <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${(childrenDone / data.children.length) * 100}%` }} />
              </div>
              <SubTasks tasks={data.children} />
            </SheetSection>
          ) : null}
          {data.meetings.length ? (
            <SheetSection icon={UsersThreeIcon} title="Meetings">
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {data.meetings.map((m) => (
                  <li key={m.id}>
                    <Link to="/meetings" search={{ m: m.id }} className="grid gap-1 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5 transition-colors hover:bg-surface-2/60">
                      <span className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 text-[13px] font-medium break-words">{m.topic}</span>
                        <Pill className="shrink-0 capitalize" tone={m.status === "done" ? "ok" : m.status === "running" ? "accent" : "neutral"}>{m.status === "running" ? "In progress" : m.status}</Pill>
                      </span>
                      {m.outcome ? <span className="line-clamp-3 text-[12.5px] break-words text-muted">{m.outcome.decision}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </SheetSection>
          ) : null}
          {t.brief ? (
            <SheetSection icon={NoteIcon} title="Brief">
              <Markdown className="text-[13.5px] text-muted">{t.brief}</Markdown>
            </SheetSection>
          ) : null}
          {t.goal ? (
            <section className="grid min-w-0 gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3">
              <h3 className="flex flex-wrap items-center gap-2 text-[13px] font-semibold"><TargetIcon size={15} weight="duotone" className="text-muted" /> Keeps going until
                {t.goal_tries ? <Pill tone="accent">{t.goal_tries} retr{t.goal_tries === 1 ? "y" : "ies"}</Pill> : null}
              </h3>
              <p className="text-[13px] break-words text-muted">{t.goal}</p>
            </section>
          ) : null}
          <TaskPlan events={data.events} />
          <SheetSection icon={ClockCounterClockwiseIcon} title="Timeline" note={`${data.events.length} events`}>
            <Timeline events={data.events} />
          </SheetSection>
          {data.transcript.length ? (
            <details className="group min-w-0 rounded-[var(--radius-md)] border border-border">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
                <CaretRightIcon size={13} weight="bold" className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                <span className="min-w-0">Full conversation <span className="font-normal text-muted">({data.transcript.length} messages, {t.steps_used} model calls)</span></span>
              </summary>
              <ol className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-border px-4 py-3">
                {data.transcript.map((m) => (
                  <li key={m.id} className="min-w-0 text-[12.5px]">
                    <p className="mb-0.5 font-mono text-[11px] break-words text-muted uppercase">
                      {m.role}{m.name ? ` · ${m.name}` : ""}{m.tool_calls.length ? ` · calls ${m.tool_calls.join(", ")}` : ""}{m.meta?.model ? ` · ${m.meta.model}` : ""}
                    </p>
                    {m.content ? <p className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", m.role === "tool" && "font-mono text-[11.5px] text-muted")}>{m.content.length > 1500 ? m.content.slice(0, 1500) + "…" : m.content}</p> : null}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      )}
    </SideSheet>
  );
}
