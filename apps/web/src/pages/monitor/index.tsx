import {
  ArrowSquareOutIcon,
  BrainIcon,
  BrowserIcon,
  ChatCircleDotsIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CursorClickIcon,
  EyeIcon,
  HandIcon,
  LightningIcon,
  SquaresFourIcon,
  TreeStructureIcon,
  UsersThreeIcon,
  WarningIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { onLiveEvent, useLive } from "@/lib/live";
import { activityQuery, belongsTo, mergeFeed, monitorKeys, wallQuery, type FeedEvent, type WallItem } from "@/lib/monitor";
import { tokensShort } from "@/lib/teams";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery, type Agent } from "@/lib/work";

import { agentState } from "../agents/roster";

const VIEW_W = 1280; // the browser's viewport, for placing the click marker

type Line = { icon: typeof BrainIcon; tone: string; title: string; body?: string; meta?: string };

/** The fields the different activity events carry (all optional). */
interface Act {
  kind?: string;
  tools?: { tool: string; args: string }[];
  text?: string;
  model?: string;
  tokens?: number;
  cached?: number;
  cost_usd?: number | null;
  label?: string;
  tool?: string;
  args?: string;
  preview?: string;
  action?: string;
  target?: string;
  error?: string | null;
  title?: string;
  url?: string;
  point?: { x: number; y: number } | null;
  to?: string;
  question?: string;
  from_memory?: boolean;
  summary?: string;
  content?: string;
  actor?: string;
}

function describe(e: FeedEvent): Line | null {
  const d = e.data as Act;
  if (e.type === "agent.activity") {
    switch (d.kind) {
      case "think": {
        const tools = d.tools ?? [];
        return {
          icon: BrainIcon,
          tone: "text-accent",
          title: tools.length ? `Decided to use ${tools.map((t) => t.tool).join(", ")}` : "Thought",
          body: d.text || (tools[0]?.args ?? ""),
          meta: [d.model, d.tokens ? `${tokensShort(d.tokens)} tokens` : null, d.cached ? `${tokensShort(d.cached)} cached` : null, d.cost_usd ? `$${Number(d.cost_usd).toFixed(4)}` : null].filter(Boolean).join(" · "),
        };
      }
      case "tool_call":
        return { icon: WrenchIcon, tone: "text-muted", title: `Using ${d.label ?? d.tool}`, body: d.args };
      case "tool_result":
        return { icon: CheckCircleIcon, tone: "text-ok", title: `Got the result of ${d.tool}`, body: d.preview };
      case "browser":
        return {
          icon: d.action === "goto" ? BrowserIcon : CursorClickIcon,
          tone: d.error ? "text-danger" : "text-info",
          title: `Browser: ${d.action}${d.target ? ` ${d.target}` : ""}`,
          body: d.error ? String(d.error) : [d.title, d.url].filter(Boolean).join(" · "),
        };
      case "ask":
        return d.from_memory
          ? { icon: LightningIcon, tone: "text-ok", title: `Knew the answer from the office memory (did not need to ask ${d.to})`, body: d.question }
          : { icon: ChatCircleDotsIcon, tone: "text-accent", title: `Asked ${d.to}`, body: d.question };
      case "answer":
        return { icon: CheckCircleIcon, tone: "text-ok", title: "Final answer", body: d.text };
      default:
        return { icon: CircleNotchIcon, tone: "text-muted", title: String(d.kind) };
    }
  }
  if (e.type === "approval.requested") return { icon: HandIcon, tone: "text-warn", title: "Waiting on you", body: String(d.summary ?? "") };
  if (e.type === "meeting.turn") return { icon: UsersThreeIcon, tone: "text-accent", title: "Said in a meeting", body: String(d.content ?? "") };
  if (e.type === "task.event") {
    const icon = d.kind === "delegated" ? TreeStructureIcon : d.kind === "memory" ? BrainIcon : d.kind === "tool_blocked" ? WarningIcon : CircleNotchIcon;
    if (["tool", "status"].includes(String(d.kind))) return null; // covered by the activity lines
    return { icon, tone: d.kind === "tool_blocked" ? "text-danger" : "text-muted", title: String(d.text ?? d.kind) };
  }
  return null;
}

/** The agent's browser, refreshed about once a second while it is open. */
function Screen({ session, events }: { session: string; events: FeedEvent[] }) {
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(VIEW_W);
  const box = useRef<HTMLDivElement>(null);
  const last = [...events].reverse().find((e) => e.type === "agent.activity" && e.data.kind === "browser");
  const d = (last?.data ?? {}) as Act;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = width / VIEW_W;
  const fresh = last && now - new Date(last.ts).getTime() < 4000;
  return (
    <figure className="grid gap-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      <figcaption className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-1.5 text-[12px]">
        <span className="flex gap-1" aria-hidden><span className="size-2.5 rounded-full bg-danger/60" /><span className="size-2.5 rounded-full bg-warn/60" /><span className="size-2.5 rounded-full bg-ok/60" /></span>
        <span className="min-w-0 flex-1 truncate rounded-sm bg-surface px-2 py-0.5 font-mono text-muted" title={d.url}>{d.url ?? "about:blank"}</span>
        <Pill tone="accent" live>Live</Pill>
      </figcaption>
      <div ref={box} className="relative aspect-[16/10] bg-surface-2">
        {failed ? (
          <p className="absolute inset-0 grid place-items-center text-[13px] text-muted">The browser is starting…</p>
        ) : (
          <img src={`/api/browser/${session}/frame.jpg?t=${tick}`} alt={`The agent's browser: ${d.title ?? "a web page"}`} className="absolute inset-0 size-full object-contain object-top"
            onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
        )}
        {d.point && fresh ? (
          <span aria-hidden className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/25 motion-safe:animate-ping"
            style={{ left: d.point.x * scale, top: d.point.y * scale }} />
        ) : null}
      </div>
    </figure>
  );
}

function Desk({ agent, line, thinking }: { agent: Agent; line: Line | null; thinking: boolean }) {
  const Icon = thinking ? BrainIcon : line?.icon ?? EyeIcon;
  return (
    <div className="grid aspect-[16/10] place-items-center rounded-[var(--radius-md)] border border-border bg-surface-2/50 p-6 text-center">
      <div className="grid max-w-md justify-items-center gap-3">
        <span className={cn("grid size-14 place-items-center rounded-full bg-surface", thinking ? "text-accent motion-safe:animate-pulse" : line?.tone ?? "text-muted")}>
          <Icon size={28} weight="duotone" />
        </span>
        <p className="text-[15px] font-medium">{thinking ? `${agent.name} is thinking…` : line?.title ?? `${agent.name} is at their desk`}</p>
        {!thinking && line?.body ? <p className="line-clamp-3 text-[13px] text-muted">{line.body}</p> : null}
        <p className="text-[12px] text-muted">No browser open. When this agent works on the web, its screen shows here live.</p>
      </div>
    </div>
  );
}

function Watch({ agent }: { agent: Agent }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery(activityQuery(agent.id));
  const [live, setLive] = useState<FeedEvent[]>([]);
  const [thinking, setThinking] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => onLiveEvent((ev) => {
    if (ev.type === "agent.thinking" && ev.data.agent_id === agent.id) setThinking(Boolean(ev.data.on));
    if (!belongsTo(ev, agent.id) || !["agent.activity", "task.event", "meeting.turn", "approval.requested"].includes(ev.type)) return;
    setLive((l) => mergeFeed(l, [ev as FeedEvent]));
    if (ev.type === "agent.activity" && ev.data.kind === "browser" && typeof ev.data.session === "string") setSession(ev.data.session);
    if (ev.type === "task.event" && ev.data.kind === "status") qc.invalidateQueries({ queryKey: monitorKeys.activity(agent.id) });
  }), [agent.id, qc]);

  const feed = useMemo(() => mergeFeed(data?.events ?? [], live), [data, live]);
  const lines = feed.map((e) => ({ e, line: describe(e) })).filter((x) => x.line);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [lines.length]);
  const browser = session ?? data?.browser?.session ?? null;
  const last = lines.at(-1)?.line ?? null;
  const state = agentState(agent, useLive.getState().agentStatus[agent.id]);

  if (isLoading) return <Skeleton className="h-96 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <AgentAvatar name={agent.name} color={agent.color} working={state.label === "Working"} />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold">{agent.name} <Pill tone={state.tone}>{thinking ? "Thinking" : state.label}</Pill></h2>
          <p className="text-[13px] text-muted">
            {data.task ? <>On <Link to="/tasks" search={{ task: data.task.id }} className="text-accent hover:underline">{data.task.title}</Link>{data.task.tokens ? ` · ${data.task.calls} model calls, ${tokensShort(data.task.tokens)} tokens so far` : ""}</> : "No task right now."}
          </p>
          {data.helpers?.length ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
              Helpers on this job:
              {data.helpers.map((h) => (
                <Link key={h.id} to="/monitor" search={{ agent: h.id }} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-fg hover:bg-surface-2">
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
        <div className="text-right text-[12px] text-muted tabular">
          <p>Last 24 h: {tokensShort(data.today.tokens)} tokens, ${data.today.usd.toFixed(3)}</p>
          <Link to="/agents/$agentId" params={{ agentId: agent.id }} className="inline-flex items-center gap-1 text-accent hover:underline">Profile <ArrowSquareOutIcon size={12} /></Link>
        </div>
      </header>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {browser ? <Screen session={browser} events={feed} /> : <Desk agent={agent} line={last} thinking={thinking} />}
        <section aria-label="What it is doing" className="flex max-h-[34rem] flex-col rounded-[var(--radius-md)] border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Step by step <span className="font-normal text-muted">· live</span></h3>
          <ol aria-live="polite" className="grid flex-1 content-start gap-0 overflow-y-auto px-4 py-2">
            {lines.length ? lines.map(({ e, line }) => {
              const L = line!;
              const Icon = L.icon;
              return (
                <li key={e.seq} className="flex gap-2.5 border-b border-border/60 py-2 last:border-0">
                  <Icon size={16} weight="duotone" className={cn("mt-0.5 shrink-0", L.tone)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{L.title}</p>
                    {L.body ? <p className="line-clamp-3 font-mono text-[11.5px] break-words whitespace-pre-wrap text-muted">{L.body}</p> : null}
                    <p className="text-[11px] text-muted">{timeAgo(e.ts)}{L.meta ? ` · ${L.meta}` : ""}</p>
                  </div>
                </li>
              );
            }) : <li className="py-6 text-center text-[13px] text-muted">Nothing yet. Give {agent.name} a task and watch it work here.</li>}
            <div ref={end} />
          </ol>
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
    <button onClick={onOpen} className="group grid overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface text-left hover:border-accent focus-visible:border-accent">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <AgentAvatar name={item.agent.name} color={item.agent.color} size="sm" working={!waiting} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-[13px] font-medium">
            {item.agent.name}
            {item.agent.clone_of ? <Pill tone="info">Helper</Pill> : null}
          </span>
          <span className="block truncate text-[12px] text-muted">{item.task.title}</span>
        </span>
        <Pill tone={waiting ? "warn" : "accent"} live={!waiting}>{waiting ? "Waiting on you" : "Live"}</Pill>
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
    return <EmptyState icon={SquaresFourIcon} title="Nobody is working right now" body="When agents start tasks, each one shows here with its live screen. Pick an agent on the left to see its history." />;
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
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Agents" className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            <button onClick={() => navigate({ to: "/monitor", search: {}, replace: true })} aria-current={!selected}
              className={cn("flex shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left lg:w-full", !selected ? "border-accent bg-accent-soft/60" : "border-border bg-surface hover:bg-surface-2")}>
              <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-accent"><SquaresFourIcon size={16} weight="duotone" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">Everyone at work</span>
                <span className="block truncate text-[12px] text-muted">{working} working now</span>
              </span>
            </button>
            {active.map((a) => {
              const st = agentState(a, statuses[a.id]);
              return (
                <button key={a.id} onClick={() => navigate({ to: "/monitor", search: { agent: a.id }, replace: true })} aria-current={a.id === selected?.id}
                  className={cn("flex shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left lg:w-full", a.id === selected?.id ? "border-accent bg-accent-soft/60" : "border-border bg-surface hover:bg-surface-2")}>
                  <AgentAvatar name={a.name} color={a.color} size="sm" working={st.label === "Working"} />
                  <span className={cn("min-w-0 flex-1", a.clone_of && "pl-1")}>
                    <span className="block truncate text-[13.5px] font-medium">{a.clone_of ? "↳ " : ""}{a.name}</span>
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
