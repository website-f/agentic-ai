import { ChatsTeardropIcon, CheckIcon, GavelIcon, KanbanIcon, PaperPlaneRightIcon, PlusIcon, ProhibitIcon, StopIcon, UsersThreeIcon, WarningCircleIcon, type Icon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { canShare } from "@/components/agent-access";
import { AgentAvatar } from "@/components/agent-avatar";
import { LoadMore } from "@/components/load-more";
import { EmptyState, IconTile, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { usePagedList } from "@/lib/paged";
import { meQuery } from "@/lib/queries";
import { meetingQuery, teamKeys, tokensShort, type Meeting, type MeetingOutcome, type MeetingTurn } from "@/lib/teams";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, taskQuery } from "@/lib/work";

import { PeopleMeetings } from "./minutes";

interface MeetingsSearch {
  m?: string;
  new?: number;
  task?: string;
  tab?: "minutes";
  rec?: string;
}

const TABS = [
  { value: "agents" as const, label: "Agent meetings" },
  { value: "minutes" as const, label: "People meetings" },
];

const STATUS: Record<Meeting["status"], { label: string; tone: "accent" | "ok" | "danger" | "neutral" }> = {
  running: { label: "In progress", tone: "accent" },
  done: { label: "Decided", tone: "ok" },
  failed: { label: "No outcome", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const STATUS_ICON: Record<Meeting["status"], Icon> = {
  running: ChatsTeardropIcon,
  done: GavelIcon,
  failed: WarningCircleIcon,
  cancelled: ProhibitIcon,
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
    <section aria-label="Outcome" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border border-ok/30 bg-ok/6 p-4">
      <p className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ok uppercase"><GavelIcon size={14} weight="bold" /> Decision</p>
      <p className="text-[15px] leading-snug font-medium break-words">{o.decision}</p>
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
              <li key={a.action} className="flex min-w-0 gap-2"><CheckIcon size={14} className="mt-0.5 shrink-0 text-ok" /><span className="min-w-0 break-words">{a.owner ? <span className="font-medium">{a.owner}: </span> : null}{a.action}</span></li>
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
  if (t.kind === "system") return <li className="mx-auto max-w-[90%] rounded-full bg-surface-2/70 px-3 py-1 text-center text-[12px] text-muted">{t.content}</li>;
  if (t.kind === "outcome") return null;
  const human = t.kind === "human";
  const passed = t.content === "(nothing to add)";
  return (
    <li className={cn("flex min-w-0 gap-2.5", human && "flex-row-reverse")}>
      {human ? null : <AgentAvatar name={t.name} color={color ?? "#888"} size="sm" />}
      <div className={cn("min-w-0 max-w-[85%] rounded-[var(--radius-md)] px-3 py-2", human ? "bg-accent text-accent-fg" : "bg-surface-2", passed && "bg-transparent px-0 py-1")}>
        <p className={cn("text-[11.5px] font-medium", human ? "text-accent-fg/80" : "text-muted")}>{t.name}{human ? " (you)" : ""} · round {t.round}</p>
        <p className={cn("text-[13.5px] whitespace-pre-wrap [overflow-wrap:anywhere]", passed && "text-muted italic")}>{t.content}</p>
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
        <span className="grid gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={STATUS[m.status].tone} live={running}>{STATUS[m.status].label}</Pill>
            <Faces m={m} />
            <span className="min-w-0">{m.participants.map((p) => p.name).join(", ")}</span>
          </span>
          {m.task ? <Link to="/tasks" search={{ task: m.task.id }} className="inline-flex w-fit max-w-full items-center gap-1.5 text-accent hover:underline"><KanbanIcon size={13} className="shrink-0" /><span className="truncate">{m.task.title}</span></Link> : null}
        </span>
      ) : undefined}
      actions={running && canWrite ? <Button size="sm" variant="ghost" loading={stop.isPending} onClick={() => stop.mutate()}><StopIcon size={14} /> Stop</Button> : undefined}>
      {isLoading ? <Skeleton className="h-48" /> : error || !m ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {m.outcome ? <Outcome o={m.outcome} path={m.decision_path} /> : null}
          {m.status === "failed" ? <p role="alert" className="rounded-sm border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger">{m.error}</p> : null}
          <dl className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2/40 text-[12px]">
            {([
              ["Round", `${Math.min(m.rounds_done + (running ? 1 : 0), m.max_rounds)} of ${m.max_rounds}`],
              ["Tokens", `${tokensShort(m.tokens_used)} of ${tokensShort(m.token_budget)}`],
              ["Started", timeAgo(m.created_at)],
            ] as const).map(([k, v], i) => (
              <div key={k} className={cn("grid min-w-0 gap-0.5 px-3 py-2", i > 0 && "border-l border-border")}>
                <dt className="text-muted">{k}</dt>
                <dd className="truncate text-[13px] font-medium tabular">{v}</dd>
              </div>
            ))}
          </dl>
          <ol aria-label="Transcript" aria-live="polite" className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {turns.map((t) => <Turn key={t.id} t={t} color={colors[t.speaker.replace("agent:", "")]} />)}
            {running ? <li className="flex items-center gap-2 text-[12.5px] text-muted"><span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" /> The next agent is thinking…</li> : null}
          </ol>
          <div ref={end} />
          {running && canWrite ? (
            <form className="sticky bottom-0 -mx-1 flex gap-2 border-t border-border bg-surface px-1 pt-3 pb-1" onSubmit={(e) => { e.preventDefault(); if (text.trim()) say.mutate(); }}>
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
  // Only the viewer's own shared agents attend: not colleagues' (view only) nor personal assistants.
  const active = agents.filter((a) => a.status === "active" && canShare(a));
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
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button loading={start.isPending} disabled={topic.trim().length < 3 || picked.length < 2} onClick={() => start.mutate()}><UsersThreeIcon size={16} /> Start meeting</Button>
      </>}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {task ? <p className="flex items-start gap-2 rounded-sm bg-surface-2/60 px-3 py-2 text-[13px] text-muted"><KanbanIcon size={15} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">The decision is posted to <span className="font-medium text-fg">{task.task.title}</span>.</span></p> : null}
        <TextareaField label="What should they decide?" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} autoFocus
          placeholder="e.g. Which flour supplier should we use from next month, and why?" />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium">Who attends <span className="font-normal text-muted">({picked.length} of 5{picked.length ? `, ${agents.find((a) => a.id === picked[0])?.name} chairs` : ""})</span></legend>
          <div className="flex flex-wrap gap-2">
            {active.map((a) => {
              const on = picked.includes(a.id);
              return (
                <button key={a.id} type="button" aria-pressed={on} onClick={() => toggle(a.id)}
                  className={cn("inline-flex min-h-9 items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px] transition-colors", on ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:bg-surface-2 hover:text-fg")}>
                  <AgentAvatar name={a.name} color={a.color} size="xs" /> {a.name}
                  {on ? <CheckIcon size={12} weight="bold" className="text-accent" /> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-1.5">
          <span id="rounds-label" className="text-[13px] font-medium">Rounds</span>
          <RadioGroup.Root aria-labelledby="rounds-label" value={rounds} onValueChange={setRounds} className="inline-flex w-fit gap-0.5 rounded-sm border border-border bg-surface-2/60 p-0.5">
            {["1", "2", "3", "4"].map((v) => (
              <RadioGroup.Item key={v} value={v} className="h-8 min-w-10 rounded-[6px] px-3.5 text-[13px] text-muted tabular transition-colors hover:text-fg data-[state=checked]:bg-surface data-[state=checked]:font-medium data-[state=checked]:text-fg data-[state=checked]:shadow-[0_1px_2px_hsl(var(--shadow)/0.12)] data-[state=checked]:ring-1 data-[state=checked]:ring-border">{v}</RadioGroup.Item>
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
  // Live meetings are few and stay complete; past ones pile up and load 50 at a time.
  const live = usePagedList<Meeting>(teamKeys.meetings, "/api/meetings", { status: "running" }, { pageSize: 200 });
  const pastList = usePagedList<Meeting>(teamKeys.meetings, "/api/meetings", { status: "done,failed,cancelled" });
  const doneCount = usePagedList<Meeting>(teamKeys.meetings, "/api/meetings", { status: "done" }, { pageSize: 1 });
  const isLoading = live.isLoading || pastList.isLoading;
  const error = live.error ?? pastList.error;
  const go = (next: MeetingsSearch) => navigate({ to: "/meetings", search: next, replace: true });
  const running = live.items;
  const past = pastList.items;
  const pastTotal = pastList.total ?? past.length;
  const meetings = isLoading || error ? undefined : { length: (live.total ?? running.length) + pastTotal };

  const row = (m: Meeting) => {
    const caller = m.initiator_agent_id ? `Called by ${m.participants.find((p) => p.id === m.initiator_agent_id)?.name ?? "an agent"}` : "Called by a person";
    return (
      <ListRow
        key={m.id}
        onClick={() => go({ m: m.id })}
        leading={<IconTile icon={STATUS_ICON[m.status]} tone={STATUS[m.status].tone} size="sm" />}
        title={<span className="block whitespace-normal break-words">{m.topic}</span>}
        meta={<Meta items={[caller, m.task ? <span className="truncate">{m.task.title}</span> : null, timeAgo(m.created_at)]} />}
        trailing={<><Faces m={m} size="sm" /><Pill tone={STATUS[m.status].tone} live={m.status === "running"}>{STATUS[m.status].label}</Pill></>}
      >
        {m.outcome ? <span className="mt-1 line-clamp-2 text-[13px] break-words text-muted">{m.outcome.decision}</span> : null}
      </ListRow>
    );
  };
  const decided = doneCount.total ?? past.filter((m) => m.status === "done").length;

  const tabs = <Segmented label="Kind of meeting" value={search.tab === "minutes" ? "minutes" : "agents"} options={TABS} onChange={(t) => go(t === "minutes" ? { tab: "minutes" } : {})} className="w-fit" />;

  if (search.tab === "minutes") {
    return (
      <Page>
        <PageHeader title="Meetings"
          description="Upload a recording of a real meeting (voice or video): you get a timestamped transcript, minutes in English or Bahasa Melayu, and action items you can turn into tasks. Finished minutes go into the library so agents can look up past decisions." />
        {tabs}
        <PeopleMeetings canWrite={canWrite} rec={search.rec} onOpen={(rec) => go({ tab: "minutes", rec })} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Meetings"
        description="Agents talk a decision through for a few rounds and come back with one summary: the decision, why, what else they weighed and who disagreed. Meetings recommend; they never approve anything."
        actions={canWrite ? <Button data-guide="meetings.new" onClick={() => go({ new: 1 })}><PlusIcon size={16} weight="bold" /> New meeting</Button> : null} />
      {tabs}
      {isLoading ? <Skeleton className="h-48 rounded-[var(--radius-md)]" /> : error || !meetings ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : !meetings.length ? (
        <EmptyState icon={UsersThreeIcon} title="No meetings yet"
          body="Agents call one with the consult tool when a task needs several views. You can also start one yourself, on its own or for a task."
          action={canWrite ? <Button variant="outline" onClick={() => go({ new: 1 })}><ChatsTeardropIcon size={16} /> Start a meeting</Button> : undefined} />
      ) : (
        <>
          <StatGrid className="lg:grid-cols-3">
            <Stat label="In progress" value={running.length} icon={ChatsTeardropIcon} tone="accent" hint={running.length ? "Agents are talking now" : "Nothing live"} />
            <Stat label="Decided" value={decided} icon={GavelIcon} tone="ok" hint={`of ${pastTotal} finished`} />
            <Stat label="Total meetings" value={meetings.length} icon={UsersThreeIcon} tone="neutral" className="max-lg:col-span-2" />
          </StatGrid>
          {running.length ? (
            <Section title="Happening now" description="Open one to follow along or add a point.">
              <ListCard data-guide="meetings.list" className="border-accent/40">{running.map(row)}</ListCard>
            </Section>
          ) : null}
          {past.length ? (
            <Section title="Past meetings">
              <div className="grid gap-3">
                <ListCard data-guide={running.length ? undefined : "meetings.list"}>{past.map(row)}</ListCard>
                <LoadMore noun="meetings" shown={past.length} total={pastList.total} hasMore={pastList.hasMore} loading={pastList.isFetchingMore} onLoad={pastList.loadMore} />
              </div>
            </Section>
          ) : null}
        </>
      )}
      {search.m ? <MeetingSheet key={search.m} id={search.m} canWrite={canWrite} onClose={() => go({})} /> : null}
      {search.new && canWrite ? <NewMeeting taskId={search.task} onClose={() => go({})} onStarted={(id) => go({ m: id })} /> : null}
    </Page>
  );
}
