import {
  ArrowCounterClockwiseIcon,
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
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { ApprovalCard } from "@/components/approval-card";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
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

function SubTasks({ tasks }: { tasks: Task[] }) {
  return (
    <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
      {tasks.map((c) => (
        <li key={c.id}>
          <Link to="/tasks" search={{ task: c.id }} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2/60">
            {c.assignee_name ? <AgentAvatar name={c.assignee_name} color={c.assignee_color ?? "#888"} size="xs" /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{c.title}</span>
              <span className="block text-[12px] text-muted">{c.assignee_name ?? "Unassigned"}{c.has_output_schema ? " · structured answer" : ""}</span>
            </span>
            <Pill tone={STATUS_INFO[c.status].tone}>{STATUS_INFO[c.status].label}</Pill>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ events }: { events: TaskEvent[] }) {
  return (
    <ol className="grid gap-0">
      {events.map((e, i) => {
        const Icon = EVENT_ICON[e.kind] ?? CircleNotchIcon;
        return (
          <li key={e.id} className="relative flex gap-3 pb-3">
            {i < events.length - 1 ? <span aria-hidden className="absolute top-6 bottom-0 left-[11px] w-px bg-border" /> : null}
            <span className={cn("relative grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-muted", e.kind === "tool_blocked" && "bg-danger/12 text-danger", e.kind === "progress" && "bg-accent-soft text-accent", (e.kind === "memory" || e.kind === "skill") && "bg-info/12 text-info")}>
              <Icon size={13} weight="bold" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px]">
                <span className="font-medium">{e.actor_name ?? (e.actor === "system" ? "System" : e.actor)}</span>{" "}
                <span className="text-muted">
                  {e.kind === "progress" ? <>posted an update: <span className="text-fg">{e.text}</span></> : e.kind === "feedback" ? <>sent it back: <span className="text-fg">{e.text}</span></> : e.kind === "decision" ? <>summed up the meeting: <span className="whitespace-pre-line text-fg">{e.text}</span></> : e.text}
                </span>
              </p>
              {e.kind === "decision" && typeof e.data?.meeting_id === "string" ? (
                <Link to="/meetings" search={{ m: e.data.meeting_id }} className="mt-1 inline-block text-[12.5px] text-accent hover:underline">Read the meeting</Link>
              ) : null}
              {e.kind === "tool" && typeof e.data?.result_preview === "string" ? (
                <p className="mt-1 line-clamp-2 font-mono text-[11.5px] text-muted">{e.data.result_preview}</p>
              ) : null}
              <time className="text-[11.5px] text-muted" dateTime={e.ts}>{timeAgo(e.ts)}</time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Actions({ task, canWrite }: { task: Task; canWrite: boolean }) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
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
    </>
  );
}

export function TaskSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data, isLoading, error } = useQuery({ ...taskQuery(taskId), refetchInterval: (q) => (q.state.data?.task.status === "running" ? 4000 : false) });
  const t = data?.task;
  const pending = data?.approvals.filter((a) => a.status === "pending") ?? [];

  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={t ? t.title : "Task"}
      description={t ? (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={STATUS_INFO[t.status].tone}>{STATUS_INFO[t.status].label}</Pill>
          {t.priority !== "normal" ? <Pill tone={PRIORITY_INFO[t.priority].tone}>{PRIORITY_INFO[t.priority].label}</Pill> : null}
          {t.assignee_name ? <span className="flex items-center gap-1.5"><AgentAvatar name={t.assignee_name} color={t.assignee_color ?? "#888"} size="xs" /> {t.assignee_name}</span> : <span>Unassigned</span>}
          {t.run_count > 1 ? <span>Run {t.run_count}</span> : null}
        </span>
      ) : undefined}
      actions={t ? <Actions task={t} canWrite={me.permissions.includes("work.write")} /> : undefined}
    >
      {isLoading ? <Skeleton className="h-40" /> : error || !data || !t ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
        <div className="grid gap-6">
          {pending.length ? (
            <section className="grid gap-2">
              <h3 className="text-[13px] font-semibold text-warn">Waiting on you</h3>
              {pending.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={me.permissions.includes("approvals.decide")} showTask={false} />)}
            </section>
          ) : null}
          {t.result ? (
            <section className="grid gap-2">
              <h3 className="text-[13px] font-semibold">Result</h3>
              <div className="rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3"><Markdown>{t.result}</Markdown></div>
            </section>
          ) : null}
          {t.error ? <p role="alert" className="rounded-sm border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger">{t.error}</p> : null}
          {t.status === "running" ? (
            <p className="flex items-center gap-2 text-[13px] text-accent"><CircleNotchIcon size={15} className="motion-safe:animate-spin" /> {t.assignee_name} is working. This updates live.</p>
          ) : null}
          {data.parent ? (
            <Link to="/tasks" search={{ task: data.parent.id }} className="flex items-center gap-2 text-[13px] text-muted hover:text-fg">
              <ArrowElbowLeftUpIcon size={14} /> Part of <span className="font-medium text-fg">{data.parent.title}</span> ({data.parent.assignee_name})
            </Link>
          ) : null}
          {data.children.length ? (
            <section className="grid gap-2">
              <h3 className="text-[13px] font-semibold">
                Handed out <span className="font-normal text-muted">· {data.children.filter((c) => c.status === "done" || c.status === "review").length} of {data.children.length} done</span>
              </h3>
              <SubTasks tasks={data.children} />
            </section>
          ) : null}
          {data.meetings.length ? (
            <section className="grid gap-2">
              <h3 className="text-[13px] font-semibold">Meetings</h3>
              <ul className="grid gap-2">
                {data.meetings.map((m) => (
                  <li key={m.id}>
                    <Link to="/meetings" search={{ m: m.id }} className="block rounded-[var(--radius-md)] border border-border px-3 py-2.5 hover:bg-surface-2/60">
                      <span className="flex items-center justify-between gap-2 text-[13px] font-medium">{m.topic}<Pill tone={m.status === "done" ? "ok" : m.status === "running" ? "accent" : "neutral"}>{m.status === "running" ? "In progress" : m.status}</Pill></span>
                      {m.outcome ? <span className="mt-1 block text-[12.5px] text-muted">{m.outcome.decision}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {t.brief ? (
            <section className="grid gap-2">
              <h3 className="text-[13px] font-semibold">Brief</h3>
              <Markdown className="text-muted">{t.brief}</Markdown>
            </section>
          ) : null}
          {t.goal ? (
            <section className="grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold">Keeps going until
                {t.goal_tries ? <Pill tone="accent">{t.goal_tries} retr{t.goal_tries === 1 ? "y" : "ies"}</Pill> : null}
              </h3>
              <p className="text-[13px] text-muted">{t.goal}</p>
            </section>
          ) : null}
          <section className="grid gap-2">
            <h3 className="text-[13px] font-semibold">Timeline</h3>
            <Timeline events={data.events} />
          </section>
          {data.transcript.length ? (
            <details className="rounded-[var(--radius-md)] border border-border">
              <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium">Full conversation ({data.transcript.length} messages, {t.steps_used} model calls)</summary>
              <ol className="grid gap-3 border-t border-border px-4 py-3">
                {data.transcript.map((m) => (
                  <li key={m.id} className="text-[12.5px]">
                    <p className="mb-0.5 font-mono text-[11px] text-muted uppercase">
                      {m.role}{m.name ? ` · ${m.name}` : ""}{m.tool_calls.length ? ` · calls ${m.tool_calls.join(", ")}` : ""}{m.meta?.model ? ` · ${m.meta.model}` : ""}
                    </p>
                    {m.content ? <p className={cn("whitespace-pre-wrap", m.role === "tool" && "font-mono text-[11.5px] text-muted")}>{m.content.length > 1500 ? m.content.slice(0, 1500) + "…" : m.content}</p> : null}
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
