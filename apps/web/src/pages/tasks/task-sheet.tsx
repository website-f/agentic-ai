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
  ArrowsClockwiseIcon,
  HourglassMediumIcon,
  MoonStarsIcon,
  ShieldCheckIcon,
  FileTextIcon,
  EyeIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { ApprovalCard } from "@/components/approval-card";
import { Markdown } from "@/components/markdown";
import { TaskDocuments } from "@/components/provenance";
import { TaskObjectivePanel } from "@/components/objective-bits";
import { TaskPlan } from "@/components/task-plan";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { PinButton } from "@/components/pin-button";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { keys, meQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { canShareTasks, PRIORITY_INFO, STATUS_INFO, taskQuery, VISIBILITY, workKeys, type Task, type TaskEvent, type Visibility } from "@/lib/work";

import { BlockersPanel, canWait, QuietBadge, ReviewRoundPill, ReviewTrail, statusLabel, waitingPath, type AccountableDetail, type TaskX } from "./accountable";

const EVENT_ICON: Record<string, typeof FlagIcon> = {
  created: FlagIcon, run: PlayIcon, status: CircleNotchIcon, tool: WrenchIcon, tool_blocked: ProhibitIcon,
  progress: ChatTextIcon, feedback: ArrowCounterClockwiseIcon, cancel: XIcon, memory: BrainIcon, skill: LightningIcon,
  delegated: TreeStructureIcon, delegation_done: TreeStructureIcon, meeting_called: UsersThreeIcon, decision: GavelIcon,
  correction: ArrowCounterClockwiseIcon, budget: CoinsIcon,
  review: ShieldCheckIcon, silent: MoonStarsIcon, reconcile: ArrowsClockwiseIcon, blockers: HourglassMediumIcon,
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

/** Meeting states as the task sheet shows them (the API sends the key). */
const MEETING_STATUS: Record<string, string> = { running: msg("In progress"), done: msg("Done"), failed: msg("Failed"), cancelled: msg("Cancelled") };

function Facts({ task }: { task: Task }) {
  const t = useT();
  const items: [string, ReactNode][] = [
    [t("Created"), timeAgo(task.created_at)],
    [t("Last update"), timeAgo(task.updated_at)],
    [t("Runs"), task.run_count],
    [t("Model calls"), task.steps_used],
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
  const t = useT();
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border">
      {tasks.map((c) => (
        <li key={c.id}>
          <Link to="/tasks" search={{ task: c.id }} className="flex min-h-12 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2/60">
            {c.assignee_name ? <AgentAvatar name={c.assignee_name} color={c.assignee_color ?? "#888"} size="xs" /> : null}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] font-medium break-words">{c.title}</span>
              <span className="block truncate text-[12px] text-muted">{c.assignee_name ?? t("Unassigned")}{c.has_output_schema ? ` · ${t("structured answer")}` : ""}</span>
            </span>
            <Pill tone={STATUS_INFO[c.status].tone} className="shrink-0">{t(STATUS_INFO[c.status].label)}</Pill>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ events }: { events: TaskEvent[] }) {
  const t = useT();
  return (
    <ol className="grid grid-cols-[minmax(0,1fr)] gap-0">
      {events.map((e, i) => {
        const Icon = EVENT_ICON[e.kind] ?? CircleNotchIcon;
        return (
          <li key={e.id} className="relative flex min-w-0 gap-3 pb-3.5">
            {i < events.length - 1 ? <span aria-hidden className="absolute top-7 bottom-0.5 left-[13px] w-px bg-border" /> : null}
            <span className={cn("relative grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted ring-4 ring-surface", e.kind === "tool_blocked" && "bg-danger/12 text-danger", (e.kind === "progress" || e.kind === "decision") && "bg-accent-soft text-accent", (e.kind === "memory" || e.kind === "skill") && "bg-info/12 text-info", (e.kind === "feedback" || e.kind === "silent") && "bg-warn/12 text-warn", e.kind === "review" && "bg-info/12 text-info")}>
              <Icon size={13} weight="bold" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[13px] break-words">
                <span className="font-medium">{e.actor_name ?? (e.actor === "system" ? t("System") : e.actor)}</span>{" "}
                <span className="text-muted">
                  {e.kind === "progress" ? <>{t("posted an update:")} <span className="text-fg">{e.text}</span></> : e.kind === "feedback" ? <>{t("sent it back:")} <span className="text-fg">{e.text}</span></> : e.kind === "decision" ? <>{t("summed up the meeting:")} <span className="whitespace-pre-line text-fg">{e.text}</span></> : e.text}
                </span>
              </p>
              {e.kind === "decision" && typeof e.data?.meeting_id === "string" ? (
                <Link to="/meetings" search={{ m: e.data.meeting_id }} className="mt-1 inline-block text-[12.5px] text-accent hover:underline">{t("Read the meeting")}</Link>
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
  const t = useT();
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
    toast.success(t("Task deleted."));
    onDeleted();
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<Task>(`/api/tasks/${task.id}/${path}`, "POST", body ?? {}),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: workKeys.task(task.id) });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(({ start: t("Started."), cancel: t("Cancelling."), accept: t("Accepted."), revise: t("Sent back with your feedback.") } as Record<string, string>)[v.path] ?? t("Done."));
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
        <textarea autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} placeholder={t("What should change?")} aria-label={t("Feedback")}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={!feedback.trim()} loading={act.isPending}>{t("Send back")}</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setRevising(false)}>{t("Cancel")}</Button>
        </div>
      </form>
    );
  }
  return (
    <>
      {s === "review" ? <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: "accept" })}><CheckIcon size={14} weight="bold" /> {t("Accept")}</Button> : null}
      {s === "review" || s === "done" || s === "failed" ? <Button size="sm" variant="outline" onClick={() => setRevising(true)}><ArrowCounterClockwiseIcon size={14} /> {t("Send back")}</Button> : null}
      {s === "blocked" && (task as TaskX).restartable && task.assignee_agent_id ? (
        <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: "start" })}>
          <PlayIcon size={14} weight="fill" /> {(task as TaskX).waiting_for?.length && !(task as TaskX).blocked_owner ? t("Start now anyway") : t("Retry")}
        </Button>
      ) : null}
      {(s === "triage" || s === "ready" || s === "failed" || s === "cancelled") && task.assignee_agent_id ? (
        <Button size="sm" variant={s === "failed" ? "outline" : "primary"} loading={act.isPending} onClick={() => act.mutate({ path: "start" })}>
          <PlayIcon size={14} weight="fill" /> {s === "failed" ? t("Retry") : t("Start")}
        </Button>
      ) : null}
      {s !== "done" && s !== "cancelled" ? (
        <Button size="sm" variant="outline" asChild>
          <Link to="/meetings" search={{ new: 1, task: task.id }}><UsersThreeIcon size={14} /> {t("Meeting")}</Link>
        </Button>
      ) : null}
      {s === "running" || s === "blocked" || s === "ready" || s === "triage" ? (
        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ path: "cancel" })}><HandIcon size={14} /> {t("Cancel")}</Button>
      ) : null}
      {s === "done" || s === "failed" || s === "cancelled" ? (
        <Button size="sm" variant="ghost" className="text-muted hover:text-danger" disabled={act.isPending} onClick={() => setDeleting(true)}><TrashIcon size={14} /> {t("Delete")}</Button>
      ) : null}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t("Delete this task?")} danger confirmLabel={t("Delete")}
        body={t("The task, its conversation, its history and any sub-tasks are removed for good. Reports and files it produced stay.")} onConfirm={remove} />
    </>
  );
}

/** P26: who else may look at this task (managers and owners). */
function ShareControl({ task }: { task: Task }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (v: Visibility) => api<Task>(`/api/tasks/${task.id}`, "PATCH", { visibility: v }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workKeys.tasks });
      void qc.invalidateQueries({ queryKey: taskQuery(task.id).queryKey });
      toast.success(t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5">
      <EyeIcon size={16} className="shrink-0 text-muted" />
      <span className="text-[13px] font-medium">{t("Who can see it")}</span>
      <Select size="sm" value={task.visibility ?? "private"} onValueChange={(v) => save.mutate(v as Visibility)} label={t("Who can see it")}
        disabled={save.isPending} className="min-w-0 flex-1 sm:max-w-64"
        options={VISIBILITY.map((o) => ({ value: o.value, label: t(o.label), hint: t(o.hint) }))} />
    </div>
  );
}

export function TaskSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data, isLoading, error } = useQuery({ ...taskQuery(taskId), refetchInterval: (q) => (q.state.data?.task.status === "running" ? 4000 : false) });
  const task = data?.task as TaskX | undefined;
  const acc: AccountableDetail = (data ?? {}) as AccountableDetail;
  const path = task ? waitingPath(task) : null;
  // A task shared with you to look at (P26) is read only, whatever your role.
  const canWrite = me.permissions.includes("work.write") && !data?.read_only;
  const pending = data?.approvals.filter((a) => a.status === "pending") ?? [];
  const childrenDone = data?.children.filter((c) => c.status === "done" || c.status === "review").length ?? 0;
  // "Part of {title}": the title is styled, so the sentence is split around it (Malay keeps the order).
  const [partBefore = "", partAfter = ""] = t("Part of {title}").split("{title}");

  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={task ? <span className="line-clamp-3 break-words">{task.title}</span> : t("Task")}
      description={task ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Pill tone={STATUS_INFO[task.status].tone} live={task.status === "running"}>{statusLabel(task)}</Pill>
          <QuietBadge minutes={task.quiet_minutes} />
          <ReviewRoundPill task={task} />
          {task.priority !== "normal" ? <Pill tone={PRIORITY_INFO[task.priority].tone}>{t(PRIORITY_INFO[task.priority].label)}</Pill> : null}
          {task.assignee_name ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-fg"><AgentAvatar name={task.assignee_name} color={task.assignee_color ?? "#888"} size="xs" /> <span className="truncate">{task.assignee_name}</span></span>
          ) : <span>{t("Unassigned")}</span>}
          {task.run_count > 1 ? <span className="tabular">{t("Run {n}", { n: task.run_count })}</span> : null}
          {task.labels?.map((l) => <Pill key={l}>{l}</Pill>)}
        </span>
      ) : undefined}
      actions={task ? (
        <>
          <PinButton kind="task" refId={task.id} title={task.title} withLabel />
          {data?.read_only ? null : <Actions task={task} canWrite={me.permissions.includes("work.write")} onDeleted={onClose} />}
        </>
      ) : undefined}
    >
      {isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-16 rounded-[var(--radius-md)]" />
          <Skeleton className="h-40 rounded-[var(--radius-md)]" />
          <Skeleton className="h-24 rounded-[var(--radius-md)]" />
        </div>
      ) : error || !data || !task ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {data.read_only ? (
            <p className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-info/30 bg-info/8 px-3.5 py-3 text-[13px] text-info">
              <EyeIcon size={17} weight="duotone" className="mt-px shrink-0" />
              <span className="min-w-0">{t("Shared with you to look at. You can follow it and pin it to your workspace, but not change it.")}</span>
            </p>
          ) : canShareTasks(me.permissions) ? (
            <ShareControl task={task} />
          ) : null}
          {pending.length ? (
            <SheetSection icon={SealWarningIcon} title={t("Waiting on you")} note={pending.length > 1 ? t("{n} decisions", { n: pending.length }) : undefined} tone="warn">
              {pending.map((a) => <ApprovalCard key={a.id} approval={a} canDecide={me.permissions.includes("approvals.decide")} showTask={false} />)}
            </SheetSection>
          ) : null}
          {task.error ? (
            <p role="alert" className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 px-3.5 py-3 text-[13px] break-words text-danger">
              <WarningCircleIcon size={17} weight="duotone" className="mt-px shrink-0" /> <span className="min-w-0">{task.error}</span>
            </p>
          ) : null}
          {path && !pending.length ? (
            <div className={cn("flex items-start gap-2.5 rounded-[var(--radius-md)] border px-3.5 py-3 text-[13px] break-words", path.kind === "blockers" || path.kind === "review" ? "border-info/30 bg-info/8 text-info" : "border-warn/30 bg-warn/8 text-warn")}>
              {path.kind === "blockers" ? <HourglassMediumIcon size={17} weight="duotone" className="mt-px shrink-0" /> : path.kind === "review" ? <ShieldCheckIcon size={17} weight="duotone" className="mt-px shrink-0" /> : <HandIcon size={17} weight="duotone" className="mt-px shrink-0" />}
              <span className="grid min-w-0 gap-0.5">
                <span className="font-medium">{path.title}</span>
                {path.detail ? <span className="opacity-90">{path.detail}</span> : null}
                {path.reason && path.reason !== path.detail ? <span className="text-[12.5px] opacity-80">{path.reason}</span> : null}
              </span>
            </div>
          ) : null}
          {task.status === "running" ? (
            <p className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/50 px-3.5 py-3 text-[13px] text-accent">
              <CircleNotchIcon size={16} className="shrink-0 motion-safe:animate-spin" /> {task.quiet_minutes
                ? t("{name} has been quiet for {n} min. It is still running; nothing was stopped.", { name: task.assignee_name ?? "", n: task.quiet_minutes })
                : t("{name} is working. This updates live.", { name: task.assignee_name ?? "" })}
            </p>
          ) : null}
          {data.parent ? (
            <Link to="/tasks" search={{ task: data.parent.id }} className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5 text-[13px] text-muted transition-colors hover:bg-surface-2/60 hover:text-fg">
              <ArrowElbowLeftUpIcon size={15} className="shrink-0" />
              <span className="min-w-0">{partBefore}<span className="font-medium break-words text-fg">{data.parent.title}</span>{partAfter}{data.parent.assignee_name ? ` (${data.parent.assignee_name})` : ""}</span>
            </Link>
          ) : null}
          <Facts task={task} />
          <TaskObjectivePanel taskId={task.id} branchId={task.branch_id} objective={data.objective} request={data.request} canWrite={canWrite} />
          {acc.blockers?.length || acc.blocking?.length || (canWrite && canWait(task)) ? (
            <SheetSection icon={HourglassMediumIcon} title={t("Waits for")} note={acc.blockers?.length ? t("{done} of {total} done", { done: acc.blockers.filter((b) => b.status === "done").length, total: acc.blockers.length }) : undefined}>
              <BlockersPanel task={task} detail={acc} canWrite={canWrite} />
            </SheetSection>
          ) : null}
          {acc.reviews?.length || acc.review_policy ? (
            <SheetSection icon={ShieldCheckIcon} title={t("Review")} note={task.review_round ? (task.review_round === 1 ? t("1 round of changes") : t("{n} rounds of changes", { n: task.review_round })) : undefined}>
              <ReviewTrail detail={acc} />
            </SheetSection>
          ) : null}
          {task.result ? (
            <SheetSection icon={CheckCircleIcon} title={t("Result")}>
              <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3.5"><Markdown>{task.result}</Markdown></div>
            </SheetSection>
          ) : null}
          <TaskDocuments taskId={task.id} icon={<FileTextIcon size={15} weight="duotone" className="text-muted" />}
            title={(n) => <>{t("Documents made in this task")} <span className="font-normal text-muted tabular">{n}</span></>} />
          {data.children.length ? (
            <SheetSection icon={TreeStructureIcon} title={t("Handed out")} note={t("{done} of {total} done", { done: childrenDone, total: data.children.length })}>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={t("Sub-tasks done")} aria-valuemin={0} aria-valuemax={data.children.length} aria-valuenow={childrenDone}>
                <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${(childrenDone / data.children.length) * 100}%` }} />
              </div>
              <SubTasks tasks={data.children} />
            </SheetSection>
          ) : null}
          {data.meetings.length ? (
            <SheetSection icon={UsersThreeIcon} title={t("Meetings")}>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {data.meetings.map((m) => (
                  <li key={m.id}>
                    <Link to="/meetings" search={{ m: m.id }} className="grid gap-1 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5 transition-colors hover:bg-surface-2/60">
                      <span className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 text-[13px] font-medium break-words">{m.topic}</span>
                        <Pill className="shrink-0 capitalize" tone={m.status === "done" ? "ok" : m.status === "running" ? "accent" : "neutral"}>{t(MEETING_STATUS[m.status] ?? m.status)}</Pill>
                      </span>
                      {m.outcome ? <span className="line-clamp-3 text-[12.5px] break-words text-muted">{m.outcome.decision}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </SheetSection>
          ) : null}
          {task.brief ? (
            <SheetSection icon={NoteIcon} title={t("Brief")}>
              <Markdown className="text-[13.5px] text-muted">{task.brief}</Markdown>
            </SheetSection>
          ) : null}
          {task.goal ? (
            <section className="grid min-w-0 gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-4 py-3">
              <h3 className="flex flex-wrap items-center gap-2 text-[13px] font-semibold"><TargetIcon size={15} weight="duotone" className="text-muted" /> {t("Keeps going until")}
                {task.goal_tries ? <Pill tone="accent">{task.goal_tries === 1 ? t("1 retry") : t("{n} retries", { n: task.goal_tries })}</Pill> : null}
              </h3>
              <p className="text-[13px] break-words text-muted">{task.goal}</p>
            </section>
          ) : null}
          <TaskPlan events={data.events} />
          <SheetSection icon={ClockCounterClockwiseIcon} title={t("Timeline")} note={data.events.length === 1 ? t("1 event") : t("{n} events", { n: data.events.length })}>
            <Timeline events={data.events} />
          </SheetSection>
          {data.transcript.length ? (
            <details className="group min-w-0 rounded-[var(--radius-md)] border border-border">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
                <CaretRightIcon size={13} weight="bold" className="shrink-0 text-muted transition-transform group-open:rotate-90" />
                <span className="min-w-0">{t("Full conversation")} <span className="font-normal text-muted">{t("({n} messages, {calls} model calls)", { n: data.transcript.length, calls: task.steps_used })}</span></span>
              </summary>
              <ol className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-border px-4 py-3">
                {data.transcript.map((m) => (
                  <li key={m.id} className="min-w-0 text-[12.5px]">
                    <p className="mb-0.5 font-mono text-[11px] break-words text-muted uppercase">
                      {m.role}{m.name ? ` · ${m.name}` : ""}{m.tool_calls.length ? ` · ${t("calls {tools}", { tools: m.tool_calls.join(", ") })}` : ""}{m.meta?.model ? ` · ${m.meta.model}` : ""}
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
