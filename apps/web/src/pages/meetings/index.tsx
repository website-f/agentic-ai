import { ChatsTeardropIcon, CheckIcon, GavelIcon, KanbanIcon, PaperPlaneRightIcon, PlusIcon, ProhibitIcon, StopIcon, UsersThreeIcon, WarningCircleIcon, type Icon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { canShare } from "@/components/agent-access";
import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, IconTile, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta } from "@/components/ui/card";
import { DataTable, TableFilter, useServerTable, useTableState, type Column } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { usePagedList } from "@/lib/paged";
import { meQuery } from "@/lib/queries";
import { everyRow } from "@/lib/table-export";
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
  { value: "agents" as const, label: msg("Agent meetings") },
  { value: "minutes" as const, label: msg("People meetings") },
];

const STATUS: Record<Meeting["status"], { label: string; tone: "accent" | "ok" | "danger" | "neutral" }> = {
  running: { label: msg("In progress"), tone: "accent" },
  done: { label: msg("Decided"), tone: "ok" },
  failed: { label: msg("No outcome"), tone: "danger" },
  cancelled: { label: msg("Cancelled"), tone: "neutral" },
};

/** Past meetings: every status but running. */
const PAST = "done,failed,cancelled";
/** The page's own address keys; everything else belongs to its tables. */
const PAGE_KEYS = ["m", "new", "task", "tab", "rec"];

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
  const t = useT();
  // The file name is a link, so the sentence is split around it (the word order stays Malay).
  const [savedBefore = "", savedAfter = ""] = t("Saved to the brain as {file}.").split("{file}");
  return (
    <section aria-label={t("Outcome")} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-[var(--radius-md)] border border-ok/30 bg-ok/6 p-4">
      <p className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ok uppercase"><GavelIcon size={14} weight="bold" /> {t("Decision")}</p>
      <p className="text-[15px] leading-snug font-medium break-words">{o.decision}</p>
      {o.rationale ? <p className="text-[13.5px] text-muted">{o.rationale}</p> : null}
      {o.options.length ? (
        <div className="grid gap-1">
          <h4 className="text-[12.5px] font-semibold">{t("Options weighed")}</h4>
          <ul className="list-disc pl-5 text-[13px] text-muted">{o.options.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
      {o.dissent.length ? (
        <div className="grid gap-1">
          <h4 className="text-[12.5px] font-semibold">{t("Dissent")}</h4>
          <ul className="list-disc pl-5 text-[13px] text-muted">{o.dissent.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
      {o.actions.length ? (
        <div className="grid gap-1">
          <h4 className="text-[12.5px] font-semibold">{t("Next steps")}</h4>
          <ul className="grid gap-1 text-[13px]">
            {o.actions.map((a) => (
              <li key={a.action} className="flex min-w-0 gap-2"><CheckIcon size={14} className="mt-0.5 shrink-0 text-ok" /><span className="min-w-0 break-words">{a.owner ? <span className="font-medium">{a.owner}: </span> : null}{a.action}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[12px] text-muted">
        {t("A recommendation: any action still goes through approvals.")}
        {path ? <> {savedBefore}<Link to="/brain" search={{ path }} className="text-accent hover:underline">{path.split("/").pop()}</Link>{savedAfter}</> : null}
      </p>
    </section>
  );
}

function Turn({ t: turn, color }: { t: MeetingTurn; color?: string }) {
  const t = useT();
  if (turn.kind === "system") return <li className="mx-auto max-w-[90%] rounded-full bg-surface-2/70 px-3 py-1 text-center text-[12px] text-muted">{turn.content}</li>;
  if (turn.kind === "outcome") return null;
  const human = turn.kind === "human";
  // The API writes this exact text when an agent passes.
  const passed = turn.content === "(nothing to add)";
  return (
    <li className={cn("flex min-w-0 gap-2.5", human && "flex-row-reverse")}>
      {human ? null : <AgentAvatar name={turn.name} color={color ?? "#888"} size="sm" />}
      <div className={cn("min-w-0 max-w-[85%] rounded-[var(--radius-md)] px-3 py-2", human ? "bg-accent text-accent-fg" : "bg-surface-2", passed && "bg-transparent px-0 py-1")}>
        <p className={cn("text-[11.5px] font-medium", human ? "text-accent-fg/80" : "text-muted")}>{human ? t("{name} (you) · round {round}", { name: turn.name, round: turn.round }) : t("{name} · round {round}", { name: turn.name, round: turn.round })}</p>
        <p className={cn("text-[13.5px] whitespace-pre-wrap [overflow-wrap:anywhere]", passed && "text-muted italic")}>{passed ? t("(nothing to add)") : turn.content}</p>
      </div>
    </li>
  );
}

function MeetingSheet({ id, canWrite, onClose }: { id: string; canWrite: boolean; onClose: () => void }) {
  const t = useT();
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
    onSuccess: () => { refresh(); toast.success(t("Meeting stopped.")); },
  });
  const colors = Object.fromEntries((m?.participants ?? []).map((p) => [p.id, p.color]));
  const running = m?.status === "running";

  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} title={m?.topic ?? t("Meeting")}
      description={m ? (
        <span className="grid gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={STATUS[m.status].tone} live={running}>{t(STATUS[m.status].label)}</Pill>
            <Faces m={m} />
            <span className="min-w-0">{m.participants.map((p) => p.name).join(", ")}</span>
          </span>
          {m.task ? <Link to="/tasks" search={{ task: m.task.id }} className="inline-flex w-fit max-w-full items-center gap-1.5 text-accent hover:underline"><KanbanIcon size={13} className="shrink-0" /><span className="truncate">{m.task.title}</span></Link> : null}
        </span>
      ) : undefined}
      actions={running && canWrite ? <Button size="sm" variant="ghost" loading={stop.isPending} onClick={() => stop.mutate()}><StopIcon size={14} /> {t("Stop")}</Button> : undefined}>
      {isLoading ? <Skeleton className="h-48" /> : error || !m ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {m.outcome ? <Outcome o={m.outcome} path={m.decision_path} /> : null}
          {m.status === "failed" ? <p role="alert" className="rounded-sm border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger">{m.error}</p> : null}
          <dl className="grid grid-cols-3 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2/40 text-[12px]">
            {([
              [t("Round"), t("{a} of {b}", { a: Math.min(m.rounds_done + (running ? 1 : 0), m.max_rounds), b: m.max_rounds })],
              [t("Tokens"), t("{a} of {b}", { a: tokensShort(m.tokens_used), b: tokensShort(m.token_budget) })],
              [t("Started"), timeAgo(m.created_at)],
            ] as const).map(([k, v], i) => (
              <div key={k} className={cn("grid min-w-0 gap-0.5 px-3 py-2", i > 0 && "border-l border-border")}>
                <dt className="text-muted">{k}</dt>
                <dd className="truncate text-[13px] font-medium tabular">{v}</dd>
              </div>
            ))}
          </dl>
          <ol aria-label={t("Transcript")} aria-live="polite" className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {turns.map((x) => <Turn key={x.id} t={x} color={colors[x.speaker.replace("agent:", "")]} />)}
            {running ? <li className="flex items-center gap-2 text-[12.5px] text-muted"><span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" /> {t("The next agent is thinking…")}</li> : null}
          </ol>
          <div ref={end} />
          {running && canWrite ? (
            <form className="sticky bottom-0 -mx-1 flex gap-2 border-t border-border bg-surface px-1 pt-3 pb-1" onSubmit={(e) => { e.preventDefault(); if (text.trim()) say.mutate(); }}>
              <label htmlFor="interject" className="sr-only">{t("Add to the discussion")}</label>
              <input id="interject" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Add a point; agents read it on their next turn")}
                className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
              <Button type="submit" size="icon" aria-label={t("Send")} disabled={!text.trim()} loading={say.isPending}><PaperPlaneRightIcon size={16} weight="fill" /></Button>
            </form>
          ) : null}
        </div>
      )}
    </SideSheet>
  );
}

function NewMeeting({ taskId, onClose, onStarted }: { taskId?: string; onClose: () => void; onStarted: (id: string) => void }) {
  const t = useT();
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
    onSuccess: (m) => { qc.invalidateQueries({ queryKey: teamKeys.meetings }); toast.success(t("Meeting started.")); onStarted(m.id); },
  });
  const chair = picked.length ? agents.find((a) => a.id === picked[0])?.name : undefined;
  const [postedBefore = "", postedAfter = ""] = t("The decision is posted to {task}.").split("{task}");
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("New meeting")} className="sm:max-w-xl"
      description={t("Two to five agents discuss for a few rounds, then the first one you pick writes one decision summary.")}
      footer={<>
        <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
        <Button loading={start.isPending} disabled={topic.trim().length < 3 || picked.length < 2} onClick={() => start.mutate()}><UsersThreeIcon size={16} /> {t("Start meeting")}</Button>
      </>}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {task ? <p className="flex items-start gap-2 rounded-sm bg-surface-2/60 px-3 py-2 text-[13px] text-muted"><KanbanIcon size={15} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{postedBefore}<span className="font-medium text-fg">{task.task.title}</span>{postedAfter}</span></p> : null}
        <TextareaField label={t("What should they decide?")} rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} autoFocus
          placeholder={t("e.g. Which flour supplier should we use from next month, and why?")} />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t("Who attends")} <span className="font-normal text-muted">{chair ? t("({n} of 5, {name} chairs)", { n: picked.length, name: chair }) : t("({n} of 5)", { n: picked.length })}</span></legend>
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
          <span id="rounds-label" className="text-[13px] font-medium">{t("Rounds")}</span>
          <RadioGroup.Root aria-labelledby="rounds-label" value={rounds} onValueChange={setRounds} className="inline-flex w-fit gap-0.5 rounded-sm border border-border bg-surface-2/60 p-0.5">
            {["1", "2", "3", "4"].map((v) => (
              <RadioGroup.Item key={v} value={v} className="h-8 min-w-10 rounded-[6px] px-3.5 text-[13px] text-muted tabular transition-colors hover:text-fg data-[state=checked]:bg-surface data-[state=checked]:font-medium data-[state=checked]:text-fg data-[state=checked]:shadow-[0_1px_2px_hsl(var(--shadow)/0.12)] data-[state=checked]:ring-1 data-[state=checked]:ring-border">{v}</RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          <p className="text-[12.5px] text-muted">{t("Everyone speaks once per round. It ends early when nobody has anything new.")}</p>
        </div>
        <FormError message={start.error ? errorMessage(start.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

export function MeetingsPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const search = useSearch({ strict: false }) as MeetingsSearch;
  const navigate = useNavigate();
  // Live meetings are few and stay complete; past ones pile up (P107: a data table, searched,
  // filtered and paged on the server; "p_" keeps its place in the address apart).
  const live = usePagedList<Meeting>(teamKeys.meetings, "/api/meetings", { status: "running" }, { pageSize: 200 });
  const pastCount = usePagedList<Meeting>(teamKeys.meetings, "/api/meetings", { status: PAST }, { pageSize: 1 });
  const doneCount = usePagedList<Meeting>(teamKeys.meetings, "/api/meetings", { status: "done" }, { pageSize: 1 });
  const control = useTableState({ size: 25 }, { prefix: "p_", filters: ["status"] });
  const pastTable = useServerTable<Meeting>(teamKeys.meetings, "/api/meetings", control.state, { status: PAST });
  const isLoading = live.isLoading || pastCount.isLoading;
  const error = live.error ?? pastCount.error;
  // The page's own keys change; the tables' places (search, page, sort) stay.
  const go = (next: MeetingsSearch) => navigate({
    to: "/meetings",
    search: ((prev: Record<string, unknown>) => {
      const kept = Object.fromEntries(Object.entries(prev).filter(([k]) => !PAGE_KEYS.includes(k)));
      return { ...kept, ...next };
    }) as never,
    replace: true,
  });
  const running = live.items;
  const pastTotal = pastCount.total ?? 0;
  const meetings = isLoading || error ? undefined : { length: (live.total ?? running.length) + pastTotal };

  const caller = (m: Meeting) => (m.initiator_agent_id
    ? t("Called by {name}", { name: m.participants.find((p) => p.id === m.initiator_agent_id)?.name ?? t("an agent") })
    : t("Called by a person"));
  const row = (m: Meeting) => {
    return (
      <ListRow
        key={m.id}
        onClick={() => go({ m: m.id })}
        leading={<IconTile icon={STATUS_ICON[m.status]} tone={STATUS[m.status].tone} size="sm" />}
        title={<span className="block whitespace-normal break-words">{m.topic}</span>}
        meta={<Meta items={[caller(m), m.task ? <span className="truncate">{m.task.title}</span> : null, timeAgo(m.created_at)]} />}
        trailing={<><Faces m={m} size="sm" /><Pill tone={STATUS[m.status].tone} live={m.status === "running"}>{t(STATUS[m.status].label)}</Pill></>}
      >
        {m.outcome ? <span className="mt-1 line-clamp-2 text-[13px] break-words text-muted">{m.outcome.decision}</span> : null}
      </ListRow>
    );
  };
  const decided = doneCount.total ?? 0;
  const columns: Column<Meeting>[] = [
    {
      id: "topic", header: t("Topic"), sortable: true, card: "title", exportValue: (m) => m.topic,
      cell: (m) => (
        <span className="flex min-w-0 items-start gap-2.5">
          <IconTile icon={STATUS_ICON[m.status]} tone={STATUS[m.status].tone} size="sm" className="shrink-0" />
          <span className="grid min-w-0 gap-0.5 pt-0.5">
            <span className="text-[13.5px] font-medium break-words">{m.topic}</span>
            {m.outcome ? <span className="line-clamp-2 text-[12.5px] font-normal break-words text-muted">{m.outcome.decision}</span> : null}
          </span>
        </span>
      ),
    },
    { id: "decision", header: t("Decision"), exportOnly: true, cell: () => null, exportValue: (m) => m.outcome?.decision ?? "" },
    { id: "status", header: t("Status"), exportValue: (m) => t(STATUS[m.status].label), cell: (m) => <Pill tone={STATUS[m.status].tone}>{t(STATUS[m.status].label)}</Pill> },
    { id: "who", header: t("Agents"), hideBelow: "lg", exportValue: (m) => m.participants.map((p) => p.name).join(", "), cell: (m) => <Faces m={m} size="sm" /> },
    {
      id: "caller", header: t("Called by"), hideBelow: "xl",
      exportValue: (m) => (m.initiator_agent_id ? m.participants.find((p) => p.id === m.initiator_agent_id)?.name ?? t("an agent") : t("A person")),
      cell: (m) => (
        <span className="break-words text-muted">
          {m.initiator_agent_id ? m.participants.find((p) => p.id === m.initiator_agent_id)?.name ?? t("an agent") : t("A person")}
        </span>
      ),
    },
    {
      id: "task", header: t("Task"), hideBelow: "xl", exportValue: (m) => m.task?.title ?? "",
      cell: (m) => m.task ? <span className="line-clamp-2 break-words">{m.task.title}</span> : <span className="text-muted">-</span>,
    },
    {
      id: "created", header: t("When"), sortable: true, kind: "date", className: "whitespace-nowrap", exportValue: (m) => m.created_at,
      cell: (m) => <time dateTime={m.created_at} className="text-muted">{timeAgo(m.created_at)}</time>,
    },
  ];

  const tabs = <Segmented label={t("Kind of meeting")} value={search.tab === "minutes" ? "minutes" : "agents"} options={TABS.map((x) => ({ ...x, label: t(x.label) }))} onChange={(v) => go(v === "minutes" ? { tab: "minutes" } : {})} className="w-fit" />;

  if (search.tab === "minutes") {
    return (
      <Page>
        <PageHeader title={t("Meetings")}
          description={t("Upload a recording of a real meeting (voice or video): you get a timestamped transcript, minutes in English or Bahasa Melayu, and action items you can turn into tasks. Finished minutes go into the library so agents can look up past decisions.")} />
        {tabs}
        <PeopleMeetings canWrite={canWrite} rec={search.rec} onOpen={(rec) => go({ tab: "minutes", rec })} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t("Meetings")}
        description={t("Agents talk a decision through for a few rounds and come back with one summary: the decision, why, what else they weighed and who disagreed. Meetings recommend; they never approve anything.")}
        actions={canWrite ? <Button data-guide="meetings.new" onClick={() => go({ new: 1 })}><PlusIcon size={16} weight="bold" /> {t("New meeting")}</Button> : null} />
      {tabs}
      {isLoading ? <Skeleton className="h-48 rounded-[var(--radius-md)]" /> : error || !meetings ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : !meetings.length ? (
        <EmptyState icon={UsersThreeIcon} title={t("No meetings yet")}
          body={t("Agents call one with the consult tool when a task needs several views. You can also start one yourself, on its own or for a task.")}
          action={canWrite ? <Button variant="outline" onClick={() => go({ new: 1 })}><ChatsTeardropIcon size={16} /> {t("Start a meeting")}</Button> : undefined} />
      ) : (
        <>
          <StatGrid className="lg:grid-cols-3">
            <Stat label={t("In progress")} value={running.length} icon={ChatsTeardropIcon} tone="accent" hint={running.length ? t("Agents are talking now") : t("Nothing live")} />
            <Stat label={t("Decided")} value={decided} icon={GavelIcon} tone="ok" hint={t("of {n} finished", { n: pastTotal })} />
            <Stat label={t("Total meetings")} value={meetings.length} icon={UsersThreeIcon} tone="neutral" className="max-lg:col-span-2" />
          </StatGrid>
          {running.length ? (
            <Section title={t("Happening now")} description={t("Open one to follow along or add a point.")}>
              <ListCard data-guide="meetings.list" className="border-accent/40">{running.map(row)}</ListCard>
            </Section>
          ) : null}
          {pastTotal ? (
            <Section title={t("Past meetings")}>
              <div data-guide={running.length ? undefined : "meetings.list"} className="min-w-0">
                <DataTable<Meeting>
                  label={t("Past meetings")}
                  columns={columns}
                  rows={pastTable.rows}
                  total={pastTable.total}
                  mode="server"
                  rowId={(m) => m.id}
                  rowLabel={(m) => m.topic}
                  control={control}
                  loading={pastTable.loading}
                  fetching={pastTable.fetching}
                  error={pastTable.error}
                  onRetry={pastTable.refetch}
                  onOpen={(m) => go({ m: m.id })}
                  searchPlaceholder={t("Search topics")}
                  exportName={t("meetings")}
                  exportRows={() => everyRow<Meeting>("/api/meetings", control.state, { status: PAST })}
                  filters={
                    <TableFilter control={control} id="status" label={t("Status")} allLabel={t("All statuses")}
                      options={(["done", "failed", "cancelled"] as const).map((s) => ({ value: s, label: t(STATUS[s].label) }))} />
                  }
                />
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
