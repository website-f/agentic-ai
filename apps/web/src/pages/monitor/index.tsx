import { ArrowSquareOutIcon, BrainIcon, CoinsIcon, EyeIcon, ListChecksIcon, LockSimpleIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AgentAccessPills } from "@/components/agent-access";
import { AgentAvatar } from "@/components/agent-avatar";
import { describe, Screen, StepList, useAgentFeed, type Line } from "@/components/agent-live";
import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { onLiveEvent, useLive } from "@/lib/live";
import { monitorKeys, wallQuery, type WallItem } from "@/lib/monitor";
import { tokensShort } from "@/lib/teams";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, type Agent } from "@/lib/work";

import { agentState } from "../agents/roster";

function Desk({ agent, line, thinking }: { agent: Agent; line: Line | null; thinking: boolean }) {
  const Icon = thinking ? BrainIcon : line?.icon ?? EyeIcon;
  return (
    <div className="grid min-h-60 place-items-center rounded-[var(--radius-md)] border border-dashed border-border bg-surface-2/50 p-6 text-center sm:aspect-[16/10]">
      <div className="grid max-w-md justify-items-center gap-3">
        <span className={cn("grid size-14 place-items-center rounded-full bg-surface ring-1 ring-border", thinking ? "text-accent motion-safe:animate-pulse" : line?.tone ?? "text-muted")}>
          <Icon size={28} weight="duotone" />
        </span>
        <p className="text-[15px] font-medium break-words">{thinking ? `${agent.name} is thinking…` : line?.title ?? `${agent.name} is at their desk`}</p>
        {!thinking && line?.body ? <p className="line-clamp-3 text-[13px] text-muted">{line.body}</p> : null}
        <p className="text-[12px] text-muted">No browser open. When this agent works on the web, its screen shows here live.</p>
      </div>
    </div>
  );
}

function Watch({ agent }: { agent: Agent }) {
  const { data, isLoading, error, feed, lines, thinking, browser } = useAgentFeed(agent.id);
  const last = lines.at(-1)?.line ?? null;
  const state = agentState(agent, useLive.getState().agentStatus[agent.id]);

  if (isLoading) return <Skeleton className="h-96 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
      <Card className="flex flex-wrap items-start gap-x-4 gap-y-3 p-4 sm:p-5">
        <AgentAvatar name={agent.name} color={agent.color} working={state.label === "Working"} />
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold break-words">
            {agent.name} <Pill tone={state.tone}>{thinking ? "Thinking" : state.label}</Pill>
            <AgentAccessPills agent={agent} />
          </h2>
          <p className="text-[13px] break-words text-muted">
            {data.task ? <>On {agent.view_only ? <span className="text-fg">{data.task.title}</span> : <Link to="/tasks" search={{ task: data.task.id }} className="text-accent hover:underline">{data.task.title}</Link>}{data.task.tokens ? ` · ${data.task.calls} model calls, ${tokensShort(data.task.tokens)} tokens so far` : ""}</> : "No task right now."}
          </p>
          {data.helpers?.length ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              Helpers on this job:
              {data.helpers.map((h) => (
                <Link key={h.id} to="/monitor" search={{ agent: h.id }} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-fg hover:bg-surface-2">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: h.color }} /> {h.name}
                </Link>
              ))}
            </p>
          ) : null}
          {data.agent.clone_of ? (
            <p className="mt-1 text-[12.5px] text-muted">
              A helper. <Link to="/monitor" search={{ agent: data.agent.clone_of }} className="text-accent hover:underline">Watch the agent it helps</Link>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full sm:flex-col sm:items-end">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] text-muted tabular">
            <CoinsIcon size={13} className="shrink-0" /> Last 24 h: {tokensShort(data.today.tokens)} tokens, ${data.today.usd.toFixed(3)}
          </span>
          <Link to="/agents/$agentId" params={{ agentId: agent.id }} className="inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
            Profile <ArrowSquareOutIcon size={13} />
          </Link>
        </div>
      </Card>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {browser ? <Screen session={browser} events={feed} live={!!data.task} /> : <Desk agent={agent} line={last} thinking={thinking} />}
        <section aria-label="What it is doing" className="flex max-h-[34rem] min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
          <h3 className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 text-[13.5px] font-semibold">
            <IconTile icon={ListChecksIcon} size="sm" className="size-7" /> Step by step
            <Pill tone="accent" live className="ml-auto">Live</Pill>
          </h3>
          <StepList lines={lines} empty={agent.view_only ? `Nothing yet. When ${agent.name} works, each step shows here.` : `Nothing yet. Give ${agent.name} a task and watch it work here.`} className="flex-1" />
        </section>
      </div>
    </div>
  );
}

/** A small live screen for the wall: the browser frame, refreshed every two seconds. */
function MiniScreen({ session, title }: { session: string; title: string }) {
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);
  return failed ? (
    <p className="absolute inset-0 grid place-items-center text-[12px] text-muted">Opening the browser…</p>
  ) : (
    <img src={`/api/browser/${session}/frame.jpg?t=${tick}`} alt={`Browser: ${title}`} className="absolute inset-0 size-full object-contain object-top"
      onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
  );
}

function WallTile({ item, onOpen }: { item: WallItem; onOpen: () => void }) {
  const line = item.last ? describe({ seq: 0, ts: item.last.ts, type: "agent.activity", data: item.last.data }) : null;
  const Icon = line?.icon ?? EyeIcon;
  const waiting = item.task.status === "blocked";
  return (
    <button onClick={onOpen} className="group grid min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface text-left shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] transition-[border-color,box-shadow] hover:border-accent/50 hover:shadow-[var(--shadow-soft)] focus-visible:border-accent">
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        <AgentAvatar name={item.agent.name} color={item.agent.color} size="sm" working={!waiting} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium">
            <span className="truncate">{item.agent.name}</span>
            {item.agent.clone_of ? <Pill tone="info">Helper</Pill> : null}
          </span>
          <span className="block truncate text-[12px] text-muted">{item.task.title}</span>
        </span>
        <Pill tone={waiting ? "warn" : "accent"} live={!waiting} className="shrink-0">{waiting ? "Waiting on you" : "Live"}</Pill>
      </div>
      <div className="relative aspect-[16/10] bg-surface-2">
        {item.browser ? <MiniScreen session={item.browser.session} title={item.task.title} /> : (
          <div className="absolute inset-0 grid place-items-center p-4 text-center">
            <span className="grid justify-items-center gap-2">
              <Icon size={24} weight="duotone" className={line?.tone ?? "text-muted"} />
              <span className="line-clamp-2 text-[12.5px]">{line?.title ?? "Working"}</span>
            </span>
          </div>
        )}
      </div>
      <p className="truncate border-t border-border px-3 py-1.5 text-[11.5px] text-muted">
        {line ? `${line.title}${item.last ? ` · ${timeAgo(item.last.ts)}` : ""}` : "Starting…"}
      </p>
    </button>
  );
}

/** Everyone at work, in one view: the owner's wall of screens. */
function Wall({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { data = [], isLoading, error } = useQuery(wallQuery);
  useEffect(() => onLiveEvent((ev) => {
    if (ev.type === "agent.status" || ev.type === "task.updated") qc.invalidateQueries({ queryKey: monitorKeys.wall });
  }), [qc]);
  if (isLoading) return <Skeleton className="h-96 rounded-[var(--radius-md)]" />;
  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data.length) {
    return <EmptyState icon={SquaresFourIcon} title="Nobody is working right now" body="When agents start tasks, each one shows here with its live screen. Pick an agent to see its history and last steps." />;
  }
  return (
    <section aria-label="Agents at work" className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {data.map((item) => <WallTile key={item.agent.id} item={item} onOpen={() => onOpen(item.agent.id)} />)}
    </section>
  );
}

export function MonitorPage() {
  const { data: agents = [], isLoading } = useQuery(agentsQuery);
  const statuses = useLive((s) => s.agentStatus);
  const search = useSearch({ strict: false }) as { agent?: string; wall?: number };
  const navigate = useNavigate();
  const active = agents.filter((a) => a.status !== "retired");
  const selected = search.agent ? active.find((a) => a.id === search.agent) : undefined;
  const working = active.filter((a) => a.current_task).length;
  return (
    <Page className="max-w-7xl">
      <PageHeader title="Monitor" description="Watch any agent work, live: what it is thinking, every tool it uses, what it asks colleagues, and its browser screen when it works on the web." />
      {isLoading ? <Skeleton className="h-96 rounded-[var(--radius-md)]" /> : !active.length ? (
        <EmptyState icon={EyeIcon} title="No agents to watch" body="Create an agent first." />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
          <nav aria-label="Agents" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)] lg:flex-col lg:overflow-y-auto lg:pb-0 [&::-webkit-scrollbar]:hidden">
            <button onClick={() => navigate({ to: "/monitor", search: {}, replace: true })} aria-current={!selected}
              className={cn("flex max-w-60 shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors lg:w-full lg:max-w-none", !selected ? "border-accent bg-accent-soft/60" : "border-border bg-surface hover:bg-surface-2")}>
              <IconTile icon={SquaresFourIcon} size="sm" className="rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">Everyone at work</span>
                <span className="block truncate text-[12px] text-muted">{working} working now</span>
              </span>
            </button>
            {active.map((a) => {
              const st = agentState(a, statuses[a.id]);
              return (
                <button key={a.id} onClick={() => navigate({ to: "/monitor", search: { agent: a.id }, replace: true })} aria-current={a.id === selected?.id}
                  className={cn("flex max-w-60 shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors lg:w-full lg:max-w-none", a.id === selected?.id ? "border-accent bg-accent-soft/60" : "border-border bg-surface hover:bg-surface-2")}>
                  <AgentAvatar name={a.name} color={a.color} size="sm" working={st.label === "Working"} />
                  <span className={cn("min-w-0 flex-1", a.clone_of && "pl-1")}>
                    <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium">
                      <span className="truncate">{a.clone_of ? "↳ " : ""}{a.name}</span>
                      {a.view_only ? <EyeIcon size={13} className="shrink-0 text-muted" aria-label="View only" /> : null}
                      {a.private ? <LockSimpleIcon size={13} className="shrink-0 text-muted" aria-label="Private" /> : null}
                    </span>
                    <span className="block truncate text-[12px] text-muted">{st.label}{a.current_task ? ` · ${a.current_task.title}` : ""}</span>
                  </span>
                </button>
              );
            })}
          </nav>
          {selected ? <Watch key={selected.id} agent={selected} /> : <Wall onOpen={(id) => navigate({ to: "/monitor", search: { agent: id }, replace: true })} />}
        </div>
      )}
    </Page>
  );
}
