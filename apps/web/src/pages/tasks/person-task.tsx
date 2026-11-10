/**
 * P97: a person's task in the task sheet. The person takes it (Accept, Start), says what they
 * wait for, marks it done (it goes to the giver's check when asked for one), comments, adds
 * files (the sheet's Files block) and can hand a step to their own AI. The giver or their
 * manager follows it, checks it, sends it back with a comment, changes who and when.
 */
import { ArrowCounterClockwiseIcon, ChatTextIcon, CheckIcon, HandIcon, PaperPlaneRightIcon, PlayIcon, RobotIcon, UserSwitchIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AssigneePicker } from "@/components/assignee-picker";
import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { PERSON_STATUS } from "@/lib/people";
import { cn } from "@/lib/utils";
import { agentsQuery, workKeys, type Task, type TaskStatus } from "@/lib/work";

import { DuePicker } from "./quick-add";
import { DueChip } from "./team-views";

function useTaskCall(task: Task) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: workKeys.tasks });
    qc.invalidateQueries({ queryKey: workKeys.task(task.id) });
  };
}

const TEXTAREA = "w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] placeholder:text-muted/80 focus-visible:border-accent focus-visible:outline-none";

export function PersonTaskPanel({ task, meId, canWrite }: { task: Task; meId: string; canWrite: boolean }) {
  const t = useT();
  const refresh = useTaskCall(task);
  const mine = task.assignee_user_id === meId;
  const gave = task.created_by === `user:${meId}`;
  const [comment, setComment] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [handing, setHanding] = useState(false);
  const move = useMutation({
    mutationFn: (body: { status?: TaskStatus; due_at?: string | null; assignee_user_id?: string | null; assignee_agent_id?: string | null }) => api<Task>(`/api/tasks/${task.id}`, "PATCH", body),
    onSuccess: (r, body) => {
      refresh();
      if (body.status) toast.success(r.status === "review" ? t("Sent for a check.") : t("Moved to {column}.", { column: t(PERSON_STATUS[r.status] ?? r.status) }));
      else toast.success(t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const accept = useMutation({
    mutationFn: () => api<Task>(`/api/tasks/${task.id}/accept`, "POST", {}),
    onSuccess: () => { refresh(); toast.success(t("Accepted.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const say = useMutation({
    mutationFn: (text: string) => api(`/api/tasks/${task.id}/comments`, "POST", { text }),
    onSuccess: () => { refresh(); setComment(""); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  /** A comment first, then the move (waiting: what for; sent back: what to change). */
  const withNote = async (status: TaskStatus) => {
    if (comment.trim()) await say.mutateAsync(comment.trim());
    move.mutate({ status });
    setWaiting(false);
  };
  const s = task.status;
  const busy = move.isPending || accept.isPending || say.isPending;
  return (
    <section aria-label={t("Work for a person")} className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <span className="inline-flex min-w-0 items-center gap-2">
          <PersonAvatar name={task.assignee_user_name ?? "?"} id={task.assignee_user_id ?? undefined} size="sm" />
          <span className="grid min-w-0">
            <span className="truncate font-medium">{mine ? t("For you") : t("For {name}", { name: task.assignee_user_name ?? "" })}</span>
            {task.created_by_name ? <span className="truncate text-[12px] text-muted">{gave ? t("You gave it") : t("From {name}", { name: task.created_by_name })}</span> : null}
          </span>
        </span>
        <DueChip task={task} />
        {canWrite ? <DuePicker compact value={task.due_at ?? null} onChange={(due_at) => move.mutate({ due_at })} /> : null}
      </div>

      {canWrite ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {mine && s === "triage" ? <Button size="sm" loading={busy} onClick={() => move.mutate({ status: "ready" })}><CheckIcon size={14} weight="bold" /> {t("Accept")}</Button> : null}
          {mine && (s === "triage" || s === "ready" || s === "blocked") ? (
            <Button size="sm" variant={s === "triage" ? "outline" : "primary"} loading={busy} onClick={() => move.mutate({ status: "running" })}>
              <PlayIcon size={14} weight="fill" /> {s === "blocked" ? t("Carry on") : t("Start")}
            </Button>
          ) : null}
          {mine && (s === "running" || s === "ready" || s === "blocked") ? (
            <Button size="sm" variant={s === "running" ? "primary" : "outline"} loading={busy} onClick={() => move.mutate({ status: "done" })}>
              <CheckIcon size={14} weight="bold" /> {task.requires_review && !gave ? t("Done, send for a check") : t("Mark done")}
            </Button>
          ) : null}
          {mine && s === "running" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setWaiting((v) => !v)}><HandIcon size={14} /> {t("I'm waiting on something")}</Button> : null}
          {s === "review" && !mine ? (
            <>
              <Button size="sm" loading={busy} onClick={() => accept.mutate()}><CheckIcon size={14} weight="bold" /> {t("Accept")}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void withNote("running")}><ArrowCounterClockwiseIcon size={14} /> {comment.trim() ? t("Send back with this comment") : t("Send back")}</Button>
            </>
          ) : null}
          {s === "review" && mine && !gave ? <p className="text-[12.5px] text-muted">{t("Waiting for {name} to check it.", { name: task.created_by_name ?? t("the giver") })}</p> : null}
          {s === "done" ? <Button size="sm" variant="outline" loading={busy} onClick={() => move.mutate({ status: "running" })}><ArrowCounterClockwiseIcon size={14} /> {t("Reopen")}</Button> : null}
          {mine && s !== "done" && s !== "cancelled" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setHanding((v) => !v)}><RobotIcon size={14} /> {t("Hand a step to my AI")}</Button>
          ) : null}
          {!mine && (s === "triage" || s === "ready" || s === "running" || s === "blocked") ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
              <UserSwitchIcon size={14} className="shrink-0" />
              <AssigneePicker compact allowNobody={false} label={t("Give it to")} value={`user:${task.assignee_user_id}`}
                onChange={(v) => {
                  if (!v || v === `user:${task.assignee_user_id}`) return;
                  const [kind, id] = v.split(/:(.*)/s) as [string, string];
                  move.mutate(kind === "user" ? { assignee_user_id: id } : { assignee_agent_id: id });
                }} />
            </span>
          ) : null}
        </div>
      ) : null}

      {waiting ? (
        <div className="grid gap-2 rounded-[var(--radius-sm)] border border-warn/30 bg-warn/6 p-2.5">
          <textarea autoFocus rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("What are you waiting for?")} aria-label={t("What are you waiting for?")} className={TEXTAREA} />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={() => void withNote("blocked")}>{t("Mark as waiting")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setWaiting(false)}>{t("Cancel")}</Button>
          </div>
        </div>
      ) : null}

      {handing ? <HandToAi task={task} meId={meId} onDone={() => setHanding(false)} /> : null}

      {canWrite && !waiting ? (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) say.mutate(comment.trim()); }}>
          <label className="sr-only" htmlFor={`comment-${task.id}`}>{t("Comment")}</label>
          <textarea id={`comment-${task.id}`} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("Write a comment, a question or an update")}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && comment.trim()) say.mutate(comment.trim()); }} className={TEXTAREA} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-muted"><ChatTextIcon size={12} className="mr-1 inline" />{mine ? t("{name} sees it.", { name: task.created_by_name ?? t("The giver") }) : t("{name} sees it.", { name: task.assignee_user_name ?? "" })}</span>
            <Button size="sm" type="submit" variant="outline" disabled={!comment.trim()} loading={say.isPending}><PaperPlaneRightIcon size={14} /> {t("Comment")}</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function HandToAi({ task, meId, onDone }: { task: Task; meId: string; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: agents = [], isLoading } = useQuery(agentsQuery);
  const mineAi = agents.filter((a) => a.owner_user_id === meId && a.status === "active");
  const [agent, setAgent] = useState("");
  const [brief, setBrief] = useState("");
  const picked = agent || mineAi[0]?.id || "";
  const hand = useMutation({
    mutationFn: () => api<Task>(`/api/tasks/${task.id}/hand-to-ai`, "POST", { agent_id: picked, brief }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      toast.success(t("{name} is on it.", { name: r.assignee_name ?? t("Your AI") }));
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (isLoading) return null;
  if (!mineAi.length) return <p className="text-[12.5px] text-muted">{t("You have no AI of your own yet. Set one up in My AI.")}</p>;
  return (
    <div className={cn("grid gap-2 rounded-[var(--radius-sm)] border border-accent/30 bg-accent-soft/20 p-2.5")}>
      {mineAi.length > 1 ? (
        <Select value={picked} onValueChange={setAgent} label={t("Which AI")} options={mineAi.map((a) => ({ value: a.id, label: a.name }))} />
      ) : <p className="text-[12.5px] text-muted">{t("{name} does this step and reports back here.", { name: mineAi[0]!.name })}</p>}
      <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("What should it do? Leave empty to give it the whole task.")} aria-label={t("What should it do?")} className={TEXTAREA} />
      <div className="flex gap-2">
        <Button size="sm" loading={hand.isPending} onClick={() => hand.mutate()}><RobotIcon size={14} /> {t("Hand it over")}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
      </div>
    </div>
  );
}
