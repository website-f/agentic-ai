import {
  ArrowDownIcon,
  ArrowUpIcon,
  BuildingsIcon,
  ChartBarIcon,
  CoinsIcon,
  HandIcon,
  SparkleIcon,
  TrophyIcon,
  WarningCircleIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Markdown } from "@/components/markdown";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { overviewQuery, usdShort, type BranchStats, type Issue, type Overview, type Summary } from "@/lib/office-data";
import { useBranch } from "@/lib/stores";
import { cn, timeAgo } from "@/lib/utils";

const RANGES = [1, 7, 30, 90] as const;
const MAX_SERIES = 7; // 7 branches by name, the rest folded into "Other" (8 colors in all)

/** Color follows the branch (by id), never its rank, so filters do not repaint survivors. */
function branchColors(branches: BranchStats[]): Map<string, string> {
  const map = new Map<string, string>();
  [...branches].sort((a, b) => a.id.localeCompare(b.id)).forEach((b, i) => map.set(b.id, i < 8 ? `var(--series-${i + 1})` : "var(--series-other)"));
  return map;
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

function Kpis({ o }: { o: Overview }) {
  const t = o.totals;
  const items = [
    { label: "Agents", value: t.agents, note: `${t.working} working now${t.helpers ? `, ${t.helpers} helpers` : ""}` },
    { label: "Tasks done", value: t.tasks_done, note: `${t.tasks_created} created` },
    { label: "Failed", value: t.tasks_failed, bad: t.tasks_failed > 0 },
    { label: "Waiting on people", value: t.approvals_pending, warn: t.approvals_pending > 0, note: `${t.open} open tasks` },
    { label: "Reports", value: t.reports },
    { label: "AI spend", value: usdShort(t.usd), note: `${Intl.NumberFormat(undefined, { notation: "compact" }).format(t.tokens)} tokens` },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-[var(--radius-md)] border border-border bg-surface px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <p className="text-[12.5px] text-muted">{i.label}</p>
          <p className={cn("mt-0.5 flex items-center gap-1.5 text-[22px] leading-tight font-semibold tabular", i.bad && "text-danger", i.warn && "text-warn")}>
            {i.bad ? <WarningCircleIcon size={18} weight="fill" aria-label="Has failures" /> : null}
            {i.value}
          </p>
          {i.note ? <p className="truncate text-[12px] text-muted">{i.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** The questions the owner asks first: who has the most of the top work type, the most work, the most trouble. */
function Leaders({ o }: { o: Overview }) {
  const top = o.labels[0];
  const by = (f: (b: BranchStats) => number) => [...o.branches].sort((a, b) => f(b) - f(a))[0];
  const cards: { icon: typeof TrophyIcon; label: string; branch?: BranchStats; value: string; tone?: string }[] = [];
  if (top) {
    const b = by((x) => x.labels.find((l) => l.label === top.label)?.count ?? 0);
    const n = b?.labels.find((l) => l.label === top.label)?.count ?? 0;
    if (b && n) cards.push({ icon: TrophyIcon, label: `Most ${top.label} work`, branch: b, value: `${n} of ${top.count}` });
  }
  const busy = by((x) => x.tasks_created);
  if (busy?.tasks_created) cards.push({ icon: ChartBarIcon, label: "Most work", branch: busy, value: `${busy.tasks_created} tasks` });
  const trouble = by((x) => x.issues);
  if (trouble?.issues) cards.push({ icon: WarningIcon, label: "Most issues", branch: trouble, value: `${trouble.issues} to look at`, tone: "text-danger" });
  const waiting = by((x) => x.approvals_pending);
  if (waiting?.approvals_pending) cards.push({ icon: HandIcon, label: "Most waiting on people", branch: waiting, value: `${waiting.approvals_pending} decisions`, tone: "text-warn" });
  const spend = by((x) => x.usd);
  if (spend?.usd) cards.push({ icon: CoinsIcon, label: "Highest AI spend", branch: spend, value: usdShort(spend.usd) });
  if (!cards.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
          <p className={cn("flex items-center gap-1.5 text-[12.5px] text-muted")}><c.icon size={14} weight="duotone" className={c.tone ?? "text-accent"} /> {c.label}</p>
          <p className="mt-1 truncate text-[15px] font-semibold">{c.branch?.name}</p>
          <p className="text-[12.5px] text-muted tabular">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function Briefing({ days }: { days: number }) {
  const [s, setS] = useState<Summary | null>(null);
  const brief = useMutation({
    mutationFn: (fresh: boolean) => api<Summary>(`/api/overview/summary?days=${days}${fresh ? "&fresh=true" : ""}`, "POST", {}),
    onSuccess: setS,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <section aria-label="AI briefing" className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <SparkleIcon size={18} weight="duotone" className="text-accent" />
        <h2 className="flex-1 text-[14.5px] font-semibold">Briefing</h2>
        <Button size="sm" variant={s ? "outline" : "primary"} loading={brief.isPending} onClick={() => brief.mutate(!!s)}>
          {s ? "Brief me again" : "Brief me"}
        </Button>
      </div>
      {s ? (
        <div className="mt-3 grid gap-2">
          <Markdown>{s.text}</Markdown>
          <p className="text-[11.5px] text-muted">
            Written {timeAgo(s.generated_at).toLowerCase()} by {s.model ?? "the office model"} from the numbers on this page only{s.cached ? " (saved, no new cost)" : ""}.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-muted">A few bullet points on where work is piling up, failing or waiting, and what to do next. It reads only the numbers on this page (a fraction of a cent).</p>
      )}
    </section>
  );
}

function DoneTooltip({ active, payload, label, names }: TooltipContentProps<number, string> & { names: Map<string, string> }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0).reverse();
  const total = rows.reduce((s, p) => s + Number(p.value), 0);
  return (
    <div className="min-w-44 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]">
      <p className="mb-1.5 font-medium">{shortDay(String(label))}</p>
      {rows.length ? (
        <ul className="grid gap-1">
          {rows.map((p) => (
            <li key={String(p.dataKey)} className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: String(p.color) }} />
              <span className="flex-1 text-muted">{names.get(String(p.dataKey)) ?? String(p.dataKey)}</span>
              <span className="font-mono tabular">{Number(p.value)}</span>
            </li>
          ))}
          <li className="mt-1 flex justify-between border-t border-border pt-1"><span className="text-muted">Total</span><span className="font-mono tabular">{total}</span></li>
        </ul>
      ) : <p className="text-muted">Nothing finished</p>}
    </div>
  );
}

function DoneChart({ o }: { o: Overview }) {
  const { series, data, names, colors } = useMemo(() => {
    const colors = branchColors(o.branches);
    const ranked = [...o.branches].sort((a, b) => a.name.localeCompare(b.name));
    const shown = ranked.length > MAX_SERIES + 1 ? ranked.slice(0, MAX_SERIES) : ranked;
    const other = ranked.length > MAX_SERIES + 1 ? ranked.slice(MAX_SERIES) : [];
    const names = new Map<string, string>(shown.map((b) => [b.id, b.name]));
    if (other.length) { names.set("other", `Other (${other.length})`); colors.set("other", "var(--series-other)"); }
    const days = o.branches[0]?.done_by_day.map((d) => d.day) ?? [];
    const data = days.map((day, i) => {
      const row: Record<string, number | string> = { day };
      for (const b of shown) row[b.id] = b.done_by_day[i]?.count ?? 0;
      if (other.length) row.other = other.reduce((s, b) => s + (b.done_by_day[i]?.count ?? 0), 0);
      return row;
    });
    return { series: [...shown.map((b) => b.id), ...(other.length ? ["other"] : [])], data, names, colors };
  }, [o]);
  const total = data.reduce((s, r) => s + series.reduce((t, k) => t + Number(r[k] ?? 0), 0), 0);
  return (
    <section aria-label="Work finished per day" className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <h2 className="text-[14.5px] font-semibold">Work finished per day, by branch</h2>
      <p className="text-[12.5px] text-muted">{total} tasks finished in the last {o.days} day{o.days === 1 ? "" : "s"}.</p>
      {series.length > 1 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" aria-label="Legend">
          {series.map((k) => (
            <li key={k} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: colors.get(k) }} />{names.get(k)}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={(p) => <DoneTooltip {...(p as TooltipContentProps<number, string>)} names={names} />} />
            {series.map((k, i) => (
              <Bar key={k} dataKey={k} stackId="done" fill={colors.get(k)} stroke="var(--color-surface)" strokeWidth={2}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={36} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

type SortKey = "name" | "agents" | "tasks_created" | "tasks_done" | "tasks_failed" | "open" | "approvals_pending" | "issues" | "usd";
const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "name", label: "Branch" },
  { key: "agents", label: "Agents", num: true },
  { key: "tasks_created", label: "Created", num: true },
  { key: "tasks_done", label: "Done", num: true },
  { key: "tasks_failed", label: "Failed", num: true },
  { key: "open", label: "Open", num: true },
  { key: "approvals_pending", label: "Waiting", num: true },
  { key: "issues", label: "Issues", num: true },
  { key: "usd", label: "Spend", num: true },
];

function value(b: BranchStats, k: SortKey): number | string {
  if (k === "open") return Object.values(b.open).reduce((s, n) => s + n, 0);
  return b[k] as number | string;
}

function BranchTable({ o }: { o: Overview }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "tasks_created", desc: true });
  const setBranch = useBranch((s) => s.setBranchId);
  const navigate = useNavigate();
  const colors = branchColors(o.branches);
  const rows = [...o.branches].sort((a, b) => {
    const x = value(a, sort.key), y = value(b, sort.key);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -c : c;
  });
  return (
    <section aria-label="Branches compared" className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-[13px]">
          <thead className="border-b border-border bg-surface-2/50 text-left text-[12px] text-muted">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2 font-medium", c.num && "text-right")} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.key !== "name" }))}>
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? <ArrowDownIcon size={11} /> : <ArrowUpIcon size={11} />) : null}
                  </button>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium">Work types</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((b) => (
              <tr key={b.id} className="hover:bg-surface-2/50">
                <td className="px-3 py-2">
                  <button className="flex items-center gap-2 font-medium hover:text-accent" onClick={() => { setBranch(b.id); navigate({ to: "/office" }); }} title={`Open ${b.name}'s office`}>
                    <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: colors.get(b.id) }} />{b.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-right tabular">{b.agents}{b.working ? <span className="text-muted"> ({b.working} working)</span> : null}</td>
                <td className="px-3 py-2 text-right tabular">{b.tasks_created}</td>
                <td className="px-3 py-2 text-right tabular">{b.tasks_done}</td>
                <td className={cn("px-3 py-2 text-right tabular", b.tasks_failed && "font-medium text-danger")}>{b.tasks_failed}</td>
                <td className="px-3 py-2 text-right tabular">{value(b, "open")}</td>
                <td className={cn("px-3 py-2 text-right tabular", b.approvals_pending && "font-medium text-warn")}>{b.approvals_pending}</td>
                <td className={cn("px-3 py-2 text-right tabular", b.issues && "font-medium text-danger")}>{b.issues}</td>
                <td className="px-3 py-2 text-right font-mono tabular">{usdShort(b.usd)}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {b.labels.length ? b.labels.slice(0, 3).map((l) => <Pill key={l.label}>{l.label} {l.count}</Pill>) : <span className="text-muted">-</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const ISSUE_ICON: Record<Issue["kind"], { icon: typeof XCircleIcon; tone: string; label: string }> = {
  failed: { icon: XCircleIcon, tone: "text-danger", label: "Failed" },
  waiting: { icon: HandIcon, tone: "text-warn", label: "Waiting long" },
  incident: { icon: WarningIcon, tone: "text-danger", label: "Incident" },
  budget: { icon: CoinsIcon, tone: "text-warn", label: "Budget" },
};

function Issues({ o }: { o: Overview }) {
  const names = new Map(o.branches.map((b) => [b.id, b.name]));
  return (
    <section aria-label="Issues" className="rounded-[var(--radius-md)] border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-2.5 text-[14px] font-semibold">Needs attention <span className="font-normal text-muted">· {o.issues.length}</span></h2>
      {o.issues.length ? (
        <ul className="divide-y divide-border">
          {o.issues.slice(0, 12).map((i, n) => {
            const k = ISSUE_ICON[i.kind];
            return (
              <li key={n} className="flex gap-2.5 px-4 py-2.5">
                <k.icon size={16} weight="duotone" className={cn("mt-0.5 shrink-0", k.tone)} aria-label={k.label} />
                <div className="min-w-0 flex-1">
                  {i.task_id ? (
                    <Link to="/tasks" search={{ task: i.task_id }} className="block truncate text-[13px] font-medium hover:text-accent">{i.title}</Link>
                  ) : <p className="truncate text-[13px] font-medium">{i.title}</p>}
                  <p className="truncate text-[12px] text-muted">{k.label} · {names.get(i.branch_id ?? "") ?? "Office"} · {timeAgo(i.at)}{i.detail ? ` · ${i.detail}` : ""}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="px-4 py-6 text-center text-[13px] text-muted">Nothing failing or stuck.</p>}
    </section>
  );
}

function TopAgents({ o }: { o: Overview }) {
  const names = new Map(o.branches.map((b) => [b.id, b.name]));
  return (
    <section aria-label="Top agents" className="rounded-[var(--radius-md)] border border-border bg-surface">
      <h2 className="border-b border-border px-4 py-2.5 text-[14px] font-semibold">Most work done</h2>
      {o.top_agents.length ? (
        <ul className="divide-y divide-border">
          {o.top_agents.map((a) => (
            <li key={a.id}>
              <Link to="/agents/$agentId" params={{ agentId: a.id }} className="flex items-center gap-2.5 px-4 py-2 hover:bg-surface-2/50">
                <AgentAvatar name={a.name} color={a.color} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{a.name}</span>
                  <span className="block truncate text-[12px] text-muted">{a.role} · {names.get(a.branch_id)}</span>
                </span>
                <span className="text-right text-[12px] tabular">
                  <span className="block font-medium">{a.done} done</span>
                  <span className="block text-muted">{a.failed ? `${a.failed} failed · ` : ""}{usdShort(a.usd)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-6 text-center text-[13px] text-muted">No finished work yet in this period.</p>}
    </section>
  );
}

export function OverviewPage() {
  const search = useSearch({ strict: false }) as { days?: number };
  const navigate = useNavigate();
  const days = RANGES.find((r) => r === search.days) ?? 7;
  const { data: o, isLoading, error } = useQuery(overviewQuery(days));
  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="Company overview"
        description={o && o.scope.kind !== "all" ? `Every branch in ${o.scope.label}, side by side.` : "Every branch side by side: what they are working on, what is failing or waiting on people, and what it costs."}
        actions={
          <RadioGroup.Root value={String(days)} onValueChange={(v) => navigate({ to: "/overview", search: { days: Number(v) }, replace: true })}
            aria-label="Period" className="inline-flex rounded-sm border border-border p-0.5">
            {RANGES.map((r) => (
              <RadioGroup.Item key={r} value={String(r)} className="rounded-[6px] px-3 py-1 text-[13px] text-muted data-[state=checked]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-fg">
                {r === 1 ? "Today" : `${r} days`}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
        }
      />
      {isLoading ? (
        <div className="grid gap-4"><Skeleton className="h-24 rounded-[var(--radius-md)]" /><Skeleton className="h-72 rounded-[var(--radius-md)]" /></div>
      ) : error || !o ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !o.branches.length ? (
        <EmptyState icon={BuildingsIcon} title="No branches yet" body="Create a branch in Organization, add agents, and their work shows here." />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Kpis o={o} />
          <Leaders o={o} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <DoneChart o={o} />
            <Briefing days={days} />
          </div>
          <BranchTable o={o} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            <Issues o={o} />
            <TopAgents o={o} />
          </div>
        </div>
      )}
    </Page>
  );
}
