import { ChatsTeardropIcon, CheckIcon, GavelIcon, PaperPlaneRightIcon, PlusIcon, StopIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { meetingQuery, meetingsQuery, teamKeys, tokensShort, type Meeting, type MeetingOutcome, type MeetingTurn } from "@/lib/teams";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, taskQuery } from "@/lib/work";

interface MeetingsSearch {
  m?: string;
  new?: number;
  task?: string;
}

const STATUS: Record<Meeting["status"], { label: string; tone: "accent" | "ok" | "danger" | "neutral" }> = {
  running: { label: "In progress", tone: "accent" },
  done: { label: "Decided", tone: "ok" },
  failed: { label: "No outcome", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function Faces({ m, size = "xs" }: { m: Meeting; size?: "xs" | "sm" }) {
  return (
    <span className="flex -space-x-1.5">
      {m.participants.map((p) => <AgentAvatar key={p.id} name={p.name} color={p.color} size={size} className="ring-2 ring-surface" />)}
    </span>
  );
}

export function Outcome({ o, path }: { o: MeetingOutcome; path: string | null }) {
  return (
    <section aria-label="Outcome" className="grid gap-3 rounded-[var(--radius-md)] border border-ok/30 bg-ok/6 p-4">
      <p className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ok uppercase"><GavelIcon size={14} weight="bold" /> Decision</p>
      <p className="text-[15px] font-medium leading-snug">{o.decision}</p>
      {o.rationale ? <p className="text-[13.5px] text-muted">{o.rationale}</p> : null}
      {o.options.length ? (
        <div className="grid gap-1">
          <h4 className="text-[12.5px] font-semibold">Options weighed</h4>
          <ul className="list-disc pl-5 text-[13px] text-muted">{o.options.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
      {o.dissent.length ? (
        <div className="grid gap-1">
          <h4 className="text-[12.5px] font-semibold">Dissent</h4>
          <ul className="list-disc pl-5 text-[13px] text-muted">{o.dissent.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
      {o.actions.length ? (
        <div className="grid gap-1">
          <h4 className="text-[12.5px] font-semibold">Next steps</h4>
          <ul className="grid gap-1 text-[13px]">
            {o.actions.map((a) => (
              <li key={a.action} className="flex gap-2"><CheckIcon size={14} className="mt-0.5 shrink-0 text-muted" />{a.owner ? <span className="font-medium">{a.owner}:</span> : null} {a.action}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[12px] text-muted">
        A recommendation: any action still goes through approvals.
        {path ? <> Saved to the brain as <Link to="/brain" search={{ path }} className="text-accent hover:underline">{path.split("/").pop()}</Link>.</> : null}
      </p>
    </section>
  );
}

function Turn({ t, color }: { t: MeetingTurn; color?: string }) {
  if (t.kind === "system") return <li className="text-center text-[12px] text-muted">{t.content}</li>;
  if (t.kind === "outcome") return null;
  const human = t.kind === "human";
  const passed = t.content === "(nothing to add)";
  return (
    <li className={cn("flex gap-2.5", human && "flex-row-reverse")}>
      {human ? null : <AgentAvatar name={t.name} color={color ?? "#888"} size="sm" />}
      <div className={cn("min-w-0 max-w-[85%] rounded-[var(--radius-md)] px-3 py-2", human ? "bg-accent text-accent-fg" : "bg-surface-2", passed && "bg-transparent px-0 py-1")}>
        <p className={cn("text-[11.5px] font-medium", human ? "text-accent-fg/80" : "text-muted")}>{t.name}{human ? " (you)" : ""} · round {t.round}</p>
        <p className={cn("whitespace-pre-wrap text-[13.5px]", passed && "text-muted italic")}>{t.content}</p>
      </div>
    </li>
  );
}

function MeetingSheet({ id, canWrite, onClose }: { id: string; canWrite: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: m, isLoading, error } = useQuery({ ...meetingQuery(id), refetchInterval: (q) => (q.state.data?.status === "running" ? 4000 : false) });
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const turns = m?.turns ?? [];
  const live = m?.status === "running";
  // Follow the conversation while it is live; a finished meeting opens on its decision.
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, live]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: teamKeys.meeting(id) });
    qc.invalidateQueries({ queryKey: teamKeys.meetings });
  };
  const say = useMutation({
    mutationFn: () => api<Meeting>(`/api/meetings/${id}/interject`, "POST", { text }),
    onSuccess: () => { setText(""); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const stop = useMutation({
    mutationFn: () => api<Meeting>(`/api/meetings/${id}/cancel`, "POST"),
    onSuccess: () => { refresh(); toast.success("Meeting stopped."); },
  });
  const colors = Object.fromEntries((m?.participants ?? []).map((p) => [p.id, p.color]));
  const running = m?.status === "running";

  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} title={m?.topic ?? "Meeting"}
      description={m ? (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={STATUS[m.status].tone} live={running}>{STATUS[m.status].label}</Pill>
          <Faces m={m} />
          <span>{m.participants.map((p) => p.name).join(", ")}</span>
          {m.task ? <Link to="/tasks" search={{ task: m.task.id }} className="text-accent hover:underline">{m.task.title}</Link> : null}
        </span>
      ) : undefined}
      actions={running && canWrite ? <Button size="sm" variant="ghost" loading={stop.isPending} onClick={() => stop.mutate()}><StopIcon size={14} /> Stop</Button> : undefined}>
      {isLoading ? <Skeleton className="h-48" /> : error || !m ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
        <div className="grid gap-5">
          {m.outcome ? <Outcome o={m.outcome} path={m.decision_path} /> : null}
          {m.status === "failed" ? <p role="alert" className="rounded-sm border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger">{m.error}</p> : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted tabular">
            <span>Round {Math.min(m.rounds_done + (running ? 1 : 0), m.max_rounds)} of {m.max_rounds}</span>
            <span>{tokensShort(m.tokens_used)} of {tokensShort(m.token_budget)} tokens</span>
            <span>Started {timeAgo(m.created_at).toLowerCase()}</span>
          </div>
          <ol aria-label="Transcript" aria-live="polite" className="grid gap-3">
            {turns.map((t) => <Turn key={t.id} t={t} color={colors[t.speaker.replace("agent:", "")]} />)}
            {running ? <li className="flex items-center gap-2 text-[12.5px] text-muted"><span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" /> The next agent is thinking…</li> : null}
          </ol>
          <div ref={end} />
          {running && canWrite ? (
            <form className="sticky bottom-0 flex gap-2 border-t border-border bg-surface pt-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) say.mutate(); }}>
              <label htmlFor="interject" className="sr-only">Add to the discussion</label>
              <input id="interject" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a point; agents read it on their next turn"
                className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
              <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()} loading={say.isPending}><PaperPlaneRightIcon size={16} weight="fill" /></Button>
            </form>
          ) : null}
        </div>
      )}
    </SideSheet>
  );
}

function NewMeeting({ taskId, onClose, onStarted }: { taskId?: string; onClose: () => void; onStarted: (id: string) => void }) {
  const qc = useQueryClient();
  const { data: agents = [] } = useQuery(agentsQuery);
  const { data: task } = useQuery({ ...taskQuery(taskId ?? ""), enabled: !!taskId });
  const active = agents.filter((a) => a.status === "active");
  const [topic, setTopic] = useState("");
  // Until someone picks, the task's own agent is in (and chairs).
  const [chosen, setChosen] = useState<string[] | null>(null);
  const picked = chosen ?? (task?.task.assignee_agent_id ? [task.task.assignee_agent_id] : []);
  const [rounds, setRounds] = useState("2");
  const toggle = (id: string) => setChosen(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length >= 5 ? picked : [...picked, id]);
  const start = useMutation({
    mutationFn: () => api<Meeting>("/api/meetings", "POST", { topic, participant_ids: picked, rounds: Number(rounds), task_id: taskId }),
    onSuccess: (m) => { qc.invalidateQueries({ queryKey: teamKeys.meetings }); toast.success("Meeting started."); onStarted(m.id); },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title="New meeting" className="sm:max-w-xl"
      description="Two to five agents discuss for a few rounds, then the first one you pick writes one decision summary."
      footer={<Button loading={start.isPending} disabled={topic.trim().length < 3 || picked.length < 2} onClick={() => start.mutate()}>Start meeting</Button>}>
      <div className="grid gap-4">
        {task ? <p className="text-[13px] text-muted">The decision is posted to <span className="font-medium text-fg">{task.task.title}</span>.</p> : null}
        <TextareaField label="What should they decide?" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} autoFocus
          placeholder="e.g. Which flour supplier should we use from next month, and why?" />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium">Who attends <span className="font-normal text-muted">({picked.length} of 5{picked.length ? `, ${agents.find((a) => a.id === picked[0])?.name} chairs` : ""})</span></legend>
          <div className="flex flex-wrap gap-2">
            {active.map((a) => {
              const on = picked.includes(a.id);
              return (
                <button key={a.id} type="button" aria-pressed={on} onClick={() => toggle(a.id)}
                  className={cn("inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px] transition-colors", on ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:bg-surface-2")}>
                  <AgentAvatar name={a.name} color={a.color} size="xs" /> {a.name}
                  {on ? <CheckIcon size={12} weight="bold" className="text-accent" /> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-1.5">
          <span id="rounds-label" className="text-[13px] font-medium">Rounds</span>
          <RadioGroup.Root aria-labelledby="rounds-label" value={rounds} onValueChange={setRounds} className="inline-flex w-fit rounded-sm border border-border p-0.5">
            {["1", "2", "3", "4"].map((v) => (
              <RadioGroup.Item key={v} value={v} className="rounded-[6px] px-3.5 py-1 text-[13px] text-muted tabular data-[state=checked]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-fg">{v}</RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          <p className="text-[12.5px] text-muted">Everyone speaks once per round. It ends early when nobody has anything new.</p>
        </div>
        <FormError message={start.error ? errorMessage(start.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

export function MeetingsPage() {
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const search = useSearch({ strict: false }) as MeetingsSearch;
  const navigate = useNavigate();
  const { data: meetings, isLoading, error } = useQuery(meetingsQuery);
  const go = (next: MeetingsSearch) => navigate({ to: "/meetings", search: next, replace: true });
  const running = meetings?.filter((m) => m.status === "running") ?? [];
  const past = meetings?.filter((m) => m.status !== "running") ?? [];

  const row = (m: Meeting) => (
    <li key={m.id}>
      <button onClick={() => go({ m: m.id })} className="grid w-full gap-1.5 px-4 py-3 text-left hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium">{m.topic}</span>
            <Pill tone={STATUS[m.status].tone} live={m.status === "running"}>{STATUS[m.status].label}</Pill>
          </span>
          {m.outcome ? <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{m.outcome.decision}</span> : null}
          <span className="mt-0.5 block text-[12px] text-muted">
            {m.initiator_agent_id ? `Called by ${m.participants.find((p) => p.id === m.initiator_agent_id)?.name ?? "an agent"}` : "Called by a person"}
            {m.task ? ` · ${m.task.title}` : ""} · {timeAgo(m.created_at).toLowerCase()}
          </span>
        </span>
        <Faces m={m} size="sm" />
      </button>
    </li>
  );

  return (
    <Page>
      <PageHeader title="Meetings"
        description="Agents talk a decision through for a few rounds and come back with one summary: the decision, why, what else they weighed and who disagreed. Meetings recommend; they never approve anything."
        actions={canWrite ? <Button onClick={() => go({ new: 1 })}><PlusIcon size={16} weight="bold" /> New meeting</Button> : null} />
      {isLoading ? <Skeleton className="h-48 rounded-[var(--radius-md)]" /> : error || !meetings ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : !meetings.length ? (
        <EmptyState icon={UsersThreeIcon} title="No meetings yet"
          body="Agents call one with the consult tool when a task needs several views. You can also start one yourself, on its own or for a task."
          action={canWrite ? <Button variant="outline" onClick={() => go({ new: 1 })}><ChatsTeardropIcon size={16} /> Start a meeting</Button> : undefined} />
      ) : (
        <div className="grid gap-6">
          {running.length ? (
            <section className="grid gap-2">
              <h2 className="text-[13px] font-semibold">Happening now</h2>
              <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-accent/40 bg-surface">{running.map(row)}</ul>
            </section>
          ) : null}
          {past.length ? (
            <section className="grid gap-2">
              <h2 className="text-[13px] font-semibold">Past meetings</h2>
              <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">{past.map(row)}</ul>
            </section>
          ) : null}
        </div>
      )}
      {search.m ? <MeetingSheet key={search.m} id={search.m} canWrite={canWrite} onClose={() => go({})} /> : null}
      {search.new && canWrite ? <NewMeeting taskId={search.task} onClose={() => go({})} onStarted={(id) => go({ m: id })} /> : null}
    </Page>
  );
}
