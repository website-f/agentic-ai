/** What an agent is doing, live: its browser screen, its steps, and what came out of its work.
 * Shared by the Monitor page, the office agent sheet and the agent page. */
import {
  ArrowSquareOutIcon,
  BrainIcon,
  BrowserIcon,
  CaretDownIcon,
  ChatCircleDotsIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  ClipboardTextIcon,
  CursorClickIcon,
  EyeIcon,
  HandIcon,
  LightningIcon,
  TreeStructureIcon,
  UsersThreeIcon,
  WarningIcon,
  WrenchIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { onLiveEvent } from "@/lib/live";
import { activityQuery, belongsTo, mergeFeed, monitorKeys, type AgentActivity, type FeedEvent } from "@/lib/monitor";
import type { Report } from "@/lib/office-data";
import { tokensShort } from "@/lib/teams";
import { cn, timeAgo } from "@/lib/utils";
import { STATUS_INFO, type Task } from "@/lib/work";

const VIEW_W = 1280; // the browser's viewport, for placing the click marker

export type Line = { icon: typeof BrainIcon; tone: string; title: string; body?: string; meta?: string };

/** The fields the different activity events carry (all optional). */
export interface Act {
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

export function describe(e: FeedEvent): Line | null {
  const d = e.data as Act;
  if (e.type === "agent.activity") {
    switch (d.kind) {
      case "think": {
        const tools = d.tools ?? [];
        return {
          icon: BrainIcon,
          tone: "text-accent",
          title: tools.length ? tr("Decided to use {tools}", { tools: tools.map((x) => x.tool).join(", ") }) : tr("Thought"),
          body: d.text || (tools[0]?.args ?? ""),
          meta: [d.model, d.tokens ? tr("{n} tokens", { n: tokensShort(d.tokens) }) : null, d.cached ? tr("{n} cached", { n: tokensShort(d.cached) }) : null, d.cost_usd ? `$${Number(d.cost_usd).toFixed(4)}` : null].filter(Boolean).join(" · "),
        };
      }
      case "tool_call":
        return { icon: WrenchIcon, tone: "text-muted", title: tr("Using {tool}", { tool: d.label ?? d.tool ?? "" }), body: d.args };
      case "tool_result":
        return { icon: CheckCircleIcon, tone: "text-ok", title: tr("Got the result of {tool}", { tool: d.tool ?? "" }), body: d.preview };
      case "browser":
        return {
          icon: d.action === "goto" ? BrowserIcon : CursorClickIcon,
          tone: d.error ? "text-danger" : "text-info",
          title: d.target ? tr("Browser: {action} {target}", { action: d.action ?? "", target: d.target }) : tr("Browser: {action}", { action: d.action ?? "" }),
          body: d.error ? String(d.error) : [d.title, d.url].filter(Boolean).join(" · "),
        };
      case "ask":
        return d.from_memory
          ? { icon: LightningIcon, tone: "text-ok", title: tr("Knew the answer from the office memory (did not need to ask {name})", { name: d.to ?? "" }), body: d.question }
          : { icon: ChatCircleDotsIcon, tone: "text-accent", title: tr("Asked {name}", { name: d.to ?? "" }), body: d.question };
      case "answer":
        return { icon: CheckCircleIcon, tone: "text-ok", title: tr("Final answer"), body: d.text };
      default:
        return { icon: CircleNotchIcon, tone: "text-muted", title: String(d.kind) };
    }
  }
  if (e.type === "approval.requested") return { icon: HandIcon, tone: "text-warn", title: tr("Waiting on you"), body: String(d.summary ?? "") };
  if (e.type === "meeting.turn") return { icon: UsersThreeIcon, tone: "text-accent", title: tr("Said in a meeting"), body: String(d.content ?? "") };
  if (e.type === "task.event") {
    const icon = d.kind === "delegated" ? TreeStructureIcon : d.kind === "memory" ? BrainIcon : d.kind === "tool_blocked" ? WarningIcon : CircleNotchIcon;
    if (["tool", "status"].includes(String(d.kind))) return null; // covered by the activity lines
    return { icon, tone: d.kind === "tool_blocked" ? "text-danger" : "text-muted", title: String(d.text ?? d.kind) };
  }
  return null;
}

const FEED = ["agent.activity", "task.event", "meeting.turn", "approval.requested"];

/** The agent's activity (history from the API, then live events), thinking flag, browser. */
export function useAgentFeed(agentId: string) {
  const qc = useQueryClient();
  const query = useQuery(activityQuery(agentId));
  const [live, setLive] = useState<FeedEvent[]>([]);
  const [thinking, setThinking] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  useEffect(() => onLiveEvent((ev) => {
    if (ev.type === "agent.thinking" && ev.data.agent_id === agentId) setThinking(Boolean(ev.data.on));
    if (!belongsTo(ev, agentId) || !FEED.includes(ev.type)) return;
    setLive((l) => mergeFeed(l, [ev as FeedEvent]));
    if (ev.type === "agent.activity" && ev.data.kind === "browser" && typeof ev.data.session === "string") setSession(ev.data.session);
    if (ev.type === "task.event" && ["status", "delegated", "delegation_done"].includes(String(ev.data.kind))) {
      qc.invalidateQueries({ queryKey: monitorKeys.activity(agentId) });
      qc.invalidateQueries({ queryKey: ["agent-outcome", agentId] });
    }
  }), [agentId, qc]);
  const feed = useMemo(() => mergeFeed(query.data?.events ?? [], live), [query.data, live]);
  const lines = useMemo(() => feed.map((e) => ({ e, line: describe(e) })).filter((x): x is { e: FeedEvent; line: Line } => !!x.line), [feed]);
  return {
    ...query,
    data: query.data as AgentActivity | undefined,
    feed,
    lines,
    thinking,
    browser: session ?? query.data?.browser?.session ?? null,
  };
}

/** The agent's browser, refreshed about once a second. `live` = the agent is still working. */
export function Screen({ session, events, live = true }: { session: string; events: FeedEvent[]; live?: boolean }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(VIEW_W);
  const box = useRef<HTMLDivElement>(null);
  const last = [...events].reverse().find((e) => e.type === "agent.activity" && e.data.kind === "browser");
  const d = (last?.data ?? {}) as Act;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [live]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = width / VIEW_W;
  const fresh = live && last && now - new Date(last.ts).getTime() < 4000;
  return (
    <figure className="grid grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      <figcaption className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-1.5 text-[12px]">
        <span className="flex gap-1" aria-hidden><span className="size-2.5 rounded-full bg-danger/60" /><span className="size-2.5 rounded-full bg-warn/60" /><span className="size-2.5 rounded-full bg-ok/60" /></span>
        <span className="min-w-0 flex-1 truncate rounded-sm bg-surface px-2 py-0.5 font-mono text-muted" title={d.url}>{d.url ?? "about:blank"}</span>
        <span className="shrink-0">{live ? <Pill tone="accent" live>{t("Live")}</Pill> : <Pill>{t("Last screen")}</Pill>}</span>
      </figcaption>
      <div ref={box} className="relative aspect-[16/10] bg-surface-2">
        {/* Always requested (it retries every tick); a message covers it while nothing loads. */}
        <img src={`/api/browser/${session}/frame.jpg?t=${tick}`} alt={d.title ? t("The agent's browser: {title}", { title: d.title }) : t("The agent's browser: a web page")}
          className={cn("absolute inset-0 size-full object-contain object-top", failed && "invisible")}
          onError={() => setFailed(true)} onLoad={() => setFailed(false)} />
        {failed ? (
          <p className="absolute inset-0 grid place-items-center text-[13px] text-muted">{live ? t("The browser is starting…") : t("The browser was closed.")}</p>
        ) : null}
        {d.point && fresh ? (
          <span aria-hidden className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/25 motion-safe:animate-ping"
            style={{ left: d.point.x * scale, top: d.point.y * scale }} />
        ) : null}
      </div>
    </figure>
  );
}

/** Steps, newest last (scrolls to the end as they arrive). */
export function StepList({ lines, empty, className }: { lines: { e: FeedEvent; line: Line }[]; empty: string; className?: string }) {
  // Keep the newest step in view by scrolling the list itself, never the page around it.
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <ol ref={box} aria-live="polite" className={cn("grid min-h-0 content-start gap-0 overflow-y-auto px-4 py-2", className)}>
      {lines.length ? lines.map(({ e, line: L }) => {
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
      }) : <li className="py-6 text-center text-[13px] text-muted">{empty}</li>}
    </ol>
  );
}

/** Compact live view for side panels: screen (or what it is doing), and the latest steps.
 * `viewOnly`: the viewer only watches this agent (a colleague's), so nothing invites them to instruct it. */
export function AgentLive({ agentId, name, viewOnly = false }: { agentId: string; name: string; viewOnly?: boolean }) {
  const t = useT();
  const f = useAgentFeed(agentId);
  if (f.isLoading) return <Skeleton className="h-64 rounded-[var(--radius-md)]" />;
  if (f.error || !f.data) return <p role="alert" className="text-[13px] text-danger">{errorMessage(f.error)}</p>;
  const working = !!f.data.task;
  const last = f.lines.at(-1)?.line;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {f.browser ? (
        <Screen key={f.browser} session={f.browser} events={f.feed} live={working} />
      ) : (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/50 px-4 py-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-surface", f.thinking ? "text-accent motion-safe:animate-pulse" : last?.tone ?? "text-muted")}>
            {f.thinking ? <BrainIcon size={18} weight="duotone" /> : last ? <last.icon size={18} weight="duotone" /> : <EyeIcon size={18} weight="duotone" />}
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">{f.thinking ? t("{name} is thinking…", { name }) : last?.title ?? t("{name} is at their desk", { name })}</p>
            <p className="text-[12px] text-muted">{t("No browser open. When {name} works on the web, the screen shows here live.", { name })}</p>
          </div>
        </div>
      )}
      {f.data.task ? (
        <p className="text-[12.5px] text-muted">
          {f.thinking ? <span className="text-accent">{t("Thinking…")} </span> : null}
          {f.data.task.tokens ? t("{calls} model calls, {tokens} tokens on this task so far.", { calls: f.data.task.calls ?? 0, tokens: tokensShort(f.data.task.tokens) }) : t("Just started.")}
          {f.data.helpers?.length ? ` ${t("Helpers: {names}.", { names: f.data.helpers.map((h) => h.name).join(", ") })}` : ""}
        </p>
      ) : null}
      <section aria-label={t("What {name} is doing", { name })} className="flex max-h-80 flex-col rounded-[var(--radius-md)] border border-border bg-surface">
        <h4 className="flex items-center justify-between border-b border-border px-4 py-2 text-[12.5px] font-semibold">
          <span>{t("Step by step")} <span className="font-normal text-muted">· {working ? t("live") : t("latest")}</span></span>
          <Link to="/monitor" search={{ agent: agentId }} className="inline-flex items-center gap-1 font-normal text-accent hover:underline">{t("Full monitor")} <ArrowSquareOutIcon size={12} /></Link>
        </h4>
        <StepList lines={f.lines.slice(-40)} empty={viewOnly ? t("Nothing yet. When {name} works, each step shows here.", { name }) : t("Nothing yet. Give {name} a task and watch it work here.", { name })} className="flex-1" />
      </section>
    </div>
  );
}

const DONE: Task["status"][] = ["review", "done", "failed"];

/** What the agent produced: its latest finished tasks (with the result) and its reports. */
export function AgentOutcome({ agentId, name }: { agentId: string; name: string }) {
  const t = useT();
  const tasks = useQuery({
    queryKey: ["agent-outcome", agentId, "tasks"],
    queryFn: () => api<Task[]>(`/api/tasks?agent_id=${agentId}&status=${DONE.join(",")}&full=true`),
  });
  const reports = useQuery({
    queryKey: ["agent-outcome", agentId, "reports"],
    queryFn: () => api<Report[]>(`/api/reports?agent_id=${agentId}&limit=5`),
  });
  const qc = useQueryClient();
  useEffect(() => onLiveEvent((ev) => {
    const mine = ev.data.agent_id === agentId || ev.data.assignee_agent_id === agentId;
    if (mine && (ev.type === "report.created" || (ev.type === "task.updated" && DONE.includes(ev.data.status as Task["status"])))) {
      qc.invalidateQueries({ queryKey: ["agent-outcome", agentId] });
    }
  }), [agentId, qc]);
  const [open, setOpen] = useState<string | null>(null);
  const recent = [...(tasks.data ?? [])]
    .filter((x) => !x.parent_task_id)
    .sort((a, b) => (b.finished_at ?? b.updated_at).localeCompare(a.finished_at ?? a.updated_at))
    .slice(0, 5);
  const first = recent[0]?.id ?? null;
  const shown = open ?? first;
  const reportList = reports.data?.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {reports.data.map((r) => (
            <li key={r.id}>
              <Link to="/reports" search={{ r: r.id }} className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5 hover:border-accent">
                <ClipboardTextIcon size={16} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{r.title}</span>
                  <span className="line-clamp-2 text-[12px] text-muted">{r.summary}</span>
                  <span className="text-[11.5px] text-muted">{r.row_count ? `${t("{n} rows", { n: r.row_count })} · ` : ""}{timeAgo(r.created_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {tasks.isLoading ? <Skeleton className="h-24 rounded-[var(--radius-md)]" /> : recent.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {recent.map((task) => {
            const expanded = shown === task.id;
            const failed = task.status === "failed";
            return (
              <li key={task.id} className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
                <button onClick={() => setOpen(expanded ? "" : task.id)} aria-expanded={expanded} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-2/50">
                  {failed ? <XCircleIcon size={16} weight="duotone" className="shrink-0 text-danger" /> : <CheckCircleIcon size={16} weight="duotone" className="shrink-0 text-ok" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{task.title}</span>
                    <span className="text-[11.5px] text-muted">{STATUS_INFO[task.status] ? t(STATUS_INFO[task.status].label) : task.status} · {timeAgo(task.finished_at ?? task.updated_at)}{task.steps_used ? ` · ${t("{n} model calls", { n: task.steps_used })}` : ""}</span>
                  </span>
                  <CaretDownIcon size={13} className={cn("shrink-0 text-muted transition-transform", expanded && "rotate-180")} />
                </button>
                {expanded ? (
                  <div className="grid gap-2 border-t border-border px-4 py-3">
                    {failed ? <p className="text-[13px] text-danger">{task.error ?? t("Failed.")}</p> : <Markdown className="max-h-80 overflow-y-auto text-[13px]">{task.result ?? t("(no result text)")}</Markdown>}
                    <Link to="/tasks" search={{ task: task.id }} className="text-[12.5px] text-accent hover:underline">{t("Open the task: timeline, transcript, approvals")}</Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-[13px] text-muted">{t("{name} has not finished any work yet.", { name })}</p>}
      {reportList ? <h4 className="mt-1 text-[12.5px] font-semibold text-muted">{t("Reports")}</h4> : null}
      {reportList}
    </div>
  );
}

