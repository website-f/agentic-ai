/**
 * P113: AI usage per user, the developer's report (only the system's developer sees this tab;
 * the API refuses everyone else). One row per person for a period, most tokens first; open a
 * row for their full report: by feature, agent, model and day, and every call (never what was
 * said). Numbers come from the model-call ledger (api/routers/ai_people_usage.py).
 */
import { BuildingsIcon, ChartBarIcon, CoinsIcon, CrownIcon, TextAaIcon, UsersIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CompanyPicker } from "@/components/ui/company-picker";
import { DataTable, filterOf, useLocalTableState, useServerTable, withParams, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { branchesQuery } from "@/lib/queries";
import { everyRow } from "@/lib/table-export";
import { ROLE_INFO, type Role } from "@/lib/types";
import { cn, initials, timeAgo } from "@/lib/utils";

import { compact, usd } from "./data";

// ---------------------------------------------------------------- shapes (the API's)

export interface UsageSums {
  calls: number;
  errors: number;
  prompt: number;
  completion: number;
  cached: number;
  tokens: number;
  cost_usd: number;
  /** Successful calls to a model with no price. */
  unpriced: number;
}

export interface PersonUsage extends UsageSums {
  user_id: string;
  name: string;
  email: string;
  /** "" = no longer a member. */
  role: string;
  member: boolean;
  branch_id: string | null;
  branch_name: string | null;
  department_name: string | null;
  share: number;
  top_feature: string | null;
  last_used: string | null;
  today_used: number;
  today_limit: number | null;
}

export interface UsagePeriod { key: PeriodKey; start: string; end: string; days: number; timezone: string }

export interface PeopleUsageBody {
  period: UsagePeriod;
  currency: string;
  totals: UsageSums & {
    active_users: number;
    office_tokens: number;
    office_calls: number;
    top_feature: string | null;
    top_feature_tokens: number;
    features: (UsageSums & { feature: string })[];
  };
  people: PersonUsage[];
}

export interface UsageReport {
  period: UsagePeriod;
  currency: string;
  person: {
    user_id: string; name: string; email: string; role: string; member: boolean;
    branch_name: string | null; department_name: string | null; today_used: number; today_limit: number | null;
  };
  totals: UsageSums;
  tasks: number;
  first_used: string | null;
  last_used: string | null;
  by_feature: (UsageSums & { feature: string })[];
  by_purpose: (UsageSums & { purpose: string; feature: string; charged: boolean })[];
  by_agent: (UsageSums & { agent_id: string | null; name: string | null })[];
  by_model: (UsageSums & { provider: string; model: string; group: string | null })[];
  daily: { day: string; calls: number; tokens: number; cost_usd: number }[];
}

export interface UsageEvent {
  id: number;
  ts: string;
  purpose: string;
  feature: string;
  charged: boolean;
  agent_id: string | null;
  agent_name: string | null;
  task_id: string | null;
  task_title: string | null;
  provider: string;
  model: string;
  group: string | null;
  prompt: number;
  completion: number;
  cached: number;
  tokens: number;
  cost_usd: number | null;
  status: string;
  error_class: string | null;
  latency_ms: number;
}

// ---------------------------------------------------------------- words

export const PERIODS = ["today", "7d", "30d", "month", "last_month", "custom"] as const;
export type PeriodKey = (typeof PERIODS)[number];
const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: msg("Today"),
  "7d": msg("7 days"),
  "30d": msg("30 days"),
  month: msg("This month"),
  last_month: msg("Last month"),
  custom: msg("Custom|period"),
};

/** What the work was for (the API's feature keys, from each call's purpose). */
export const FEATURE_LABELS: Record<string, string> = {
  chat: msg("Chat with agents"),
  agent_task: msg("Agent tasks"),
  api: msg("API chat"),
  workflows: msg("Workflows and builders"),
  documents: msg("Documents"),
  meetings: msg("Meetings and minutes"),
  voice: msg("Voice to text"),
  mail: msg("Mail"),
  learning: msg("Learning and memory"),
  broadcasts: msg("Broadcasts"),
  files: msg("Reading files and pictures"),
  images: msg("Making pictures"),
  overview: msg("Overview summaries"),
  twin: msg("Digital twin"),
  help: msg("Help"),
  admin: msg("Admin tools"),
  engine: msg("Engine tests and playground"),
  other: msg("Other"),
};

export const OFFICE = "office";
const ALL = "all";
const ROLES: Role[] = ["owner", "admin", "management", "hr", "branch_manager", "hod", "supervisor", "staff", "operator", "approver", "viewer"];

export function useFeature() {
  const t = useT();
  return (key: string | null | undefined) => (key ? t(FEATURE_LABELS[key] ?? key) : "–");
}

function pctText(v: number): string {
  if (!v) return "0%";
  if (v < 0.1) return "<0.1%";
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });
}

function money(s: Pick<UsageSums, "cost_usd" | "unpriced" | "calls">): string {
  return s.unpriced && s.unpriced === s.calls && !s.cost_usd ? usd(null) : usd(s.cost_usd);
}

function Num({ children, muted, className }: { children: ReactNode; muted?: boolean; className?: string }) {
  return <span className={cn("font-mono whitespace-nowrap tabular", muted && "text-muted", className)}>{children}</span>;
}

/** Today's allowance: used of limit, with a thin bar. */
function Allowance({ used, limit }: { used: number; limit: number | null }) {
  const t = useT();
  if (limit === null) return <span className="text-[12.5px] whitespace-nowrap text-muted">{t("{used} · no limit", { used: compact(used) })}</span>;
  const ratio = limit ? Math.min(1, used / limit) : 1;
  return (
    <span className="grid min-w-24 gap-1">
      <span className="text-[12.5px] whitespace-nowrap tabular">{t("{used} of {limit}", { used: compact(used), limit: compact(limit) })}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className={cn("block h-full rounded-full", ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warn" : "bg-accent")} style={{ width: `${ratio * 100}%` }} />
      </span>
    </span>
  );
}

function ShareBar({ share }: { share: number }) {
  return (
    <span className="flex min-w-24 items-center gap-2">
      <span className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, share)}%` }} />
      </span>
      <Num className="text-[12.5px]">{pctText(share)}</Num>
    </span>
  );
}

function PersonName({ p }: { p: PersonUsage }) {
  const t = useT();
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold">{initials(p.name)}</span>
      <span className="grid min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 text-[13.5px] font-medium">
          <span className="min-w-0 break-words">{p.name}</span>
          {!p.member ? <Pill>{t("Not a member now")}</Pill> : null}
        </span>
        <span className="text-[12px] break-all text-muted">{p.email}</span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- the period

interface PeriodState { key: PeriodKey; start: string; end: string }

function periodParams(p: PeriodState): Record<string, string> | null {
  if (p.key !== "custom") return { period: p.key };
  if (!p.start || !p.end || p.end < p.start) return null;
  return { period: "custom", start: p.start, end: p.end };
}

function PeriodPicker({ value, onChange }: { value: PeriodState; onChange: (v: PeriodState) => void }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-3">
      <Segmented
        size="sm"
        label={t("Period")}
        value={value.key}
        onChange={(key) => onChange({ ...value, key })}
        options={PERIODS.map((k) => ({ value: k, label: t(PERIOD_LABELS[k]) }))}
        className="max-w-full"
      />
      {value.key === "custom" ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="grid gap-1 text-[12px] text-muted">
            {t("From")}
            <Input type="date" className="h-8 w-40" value={value.start} max={value.end || today} onChange={(e) => onChange({ ...value, start: e.target.value })} />
          </label>
          <label className="grid gap-1 text-[12px] text-muted">
            {t("To")}
            <Input type="date" className="h-8 w-40" value={value.end} min={value.start} max={today} onChange={(e) => onChange({ ...value, end: e.target.value })} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the tab

export function PeopleUsageTab() {
  const t = useT();
  const feature = useFeature();
  const [period, setPeriod] = useState<PeriodState>({ key: "7d", start: "", end: "" });
  const params = periodParams(period);
  const control = useLocalTableState({ size: 25, sort: "tokens", dir: "desc" });
  const table = useServerTable<PersonUsage, PeopleUsageBody>(["ai", "people-usage"], "/api/ai/people-usage", control.state, params ?? {}, {
    pick: (b) => b.people,
    enabled: params !== null,
  });
  const { data: branches = [] } = useQuery(branchesQuery);
  const [role, setRole] = filterOf(control, "role");
  const [branch, setBranch] = filterOf(control, "branch");
  const [open, setOpen] = useState<string | null>(null);
  const body = table.body;
  const totals = body?.totals;

  const columns: Column<PersonUsage>[] = [
    { id: "name", header: t("Name"), sortable: true, card: "title", cell: (p) => <PersonName p={p} />, exportValue: (p) => p.name },
    { id: "email", header: t("Email"), exportOnly: true, cell: (p) => p.email, exportValue: (p) => p.email },
    {
      id: "role", header: t("Role"), sortable: true,
      cell: (p) => (p.role ? t(ROLE_INFO[p.role as Role]?.label ?? p.role) : <span className="text-muted">–</span>),
      exportValue: (p) => (p.role ? t(ROLE_INFO[p.role as Role]?.label ?? p.role) : ""),
    },
    {
      id: "place", header: t("Company"), sortable: true, hideBelow: "2xl",
      cell: (p) => [p.branch_name, p.department_name].filter(Boolean).join(" · ") || <span className="text-muted">–</span>,
      exportValue: (p) => [p.branch_name, p.department_name].filter(Boolean).join(" · "),
    },
    { id: "calls", header: t("Calls"), sortable: true, kind: "number", align: "right", cell: (p) => <Num>{compact(p.calls)}</Num>, exportValue: (p) => p.calls },
    { id: "prompt", header: t("Input tokens"), sortable: true, kind: "number", align: "right", hideBelow: "2xl", cell: (p) => <Num>{compact(p.prompt)}</Num>, exportValue: (p) => p.prompt },
    { id: "completion", header: t("Output tokens"), sortable: true, kind: "number", align: "right", hideBelow: "2xl", cell: (p) => <Num>{compact(p.completion)}</Num>, exportValue: (p) => p.completion },
    {
      id: "tokens", header: t("Total tokens"), sortable: true, kind: "number", align: "right",
      cell: (p) => (
        <span className="grid justify-items-end max-md:justify-items-start">
          <Num className="font-medium">{compact(p.tokens)}</Num>
          <span className="text-[11.5px] whitespace-nowrap text-muted">{t("{in} in · {out} out", { in: compact(p.prompt), out: compact(p.completion) })}</span>
        </span>
      ),
      exportValue: (p) => p.tokens,
    },
    {
      id: "cost", header: t("Cost (USD)"), sortable: true, kind: "number", align: "right",
      cell: (p) => (
        <span className="grid justify-items-end max-md:justify-items-start">
          <Num>{p.calls ? money(p) : "–"}</Num>
          {p.unpriced ? <span className="text-[11.5px] whitespace-nowrap text-warn">{t("{n} unpriced", { n: p.unpriced })}</span> : null}
        </span>
      ),
      exportValue: (p) => p.cost_usd.toFixed(6),
    },
    { id: "share", header: t("Share"), sortable: true, kind: "number", cell: (p) => <ShareBar share={p.share} />, exportValue: (p) => p.share },
    { id: "today", header: t("Allowance today"), sortable: true, kind: "number", hideBelow: "lg", cell: (p) => <Allowance used={p.today_used} limit={p.today_limit} />, exportValue: (p) => (p.today_limit === null ? `${p.today_used}` : `${p.today_used}/${p.today_limit}`) },
    { id: "top", header: t("Mostly for"), hideBelow: "2xl", cell: (p) => (p.top_feature ? feature(p.top_feature) : <span className="text-muted">–</span>), exportValue: (p) => (p.top_feature ? feature(p.top_feature) : "") },
    {
      id: "last_used", header: t("Last used"), sortable: true, kind: "date", hideBelow: "2xl",
      cell: (p) => (p.last_used ? <span className="whitespace-nowrap" title={dateTime(p.last_used)}>{timeAgo(p.last_used)}</span> : <span className="text-muted">–</span>),
      exportValue: (p) => p.last_used ?? "",
    },
  ];

  const topShare = totals?.tokens ? (totals.top_feature_tokens * 100) / totals.tokens : 0;

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl min-w-0 text-[13.5px] text-muted">
          {t("Who uses the AI, how much, and what for. Only you (the developer) see this page. It shows purposes, tasks and numbers, never what was said.")}
        </p>
        <PeriodPicker value={period} onChange={(v) => { setPeriod(v); control.set({ page: 1 }); }} />
      </div>

      {params === null ? (
        <p role="status" className="rounded-[var(--radius-md)] border border-border bg-surface p-4 text-[13.5px] text-muted">{t("Pick a start and an end date (the end on or after the start).")}</p>
      ) : null}

      {!totals ? (
        <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</StatGrid>
      ) : (
        <StatGrid>
          <Stat label={t("Total tokens")} value={compact(totals.tokens)} icon={TextAaIcon} tone="accent"
            hint={t("{in} in, {out} out · {n} calls", { in: compact(totals.prompt), out: compact(totals.completion), n: compact(totals.calls) })} />
          <Stat label={t("Estimated cost")} value={usd(totals.cost_usd)} icon={CoinsIcon} tone="ok"
            hint={totals.unpriced ? t("USD · {n} calls had no price", { n: totals.unpriced }) : t("USD · every call priced")} />
          <Stat label={t("Active users")} value={totals.active_users} icon={UsersIcon} tone="info"
            hint={totals.office_tokens ? t("Plus {n} tokens of the office's own work", { n: compact(totals.office_tokens) }) : t("People who used AI in this period")}
            onClick={totals.office_calls ? () => setOpen(OFFICE) : undefined} />
          <Stat label={t("Top feature")} value={<span className="text-[clamp(1rem,2vw,1.35rem)] leading-tight">{feature(totals.top_feature)}</span>} icon={CrownIcon} tone="violet"
            hint={totals.top_feature ? t("{n} tokens · {pct} of all", { n: compact(totals.top_feature_tokens), pct: pctText(topShare) }) : t("No AI use yet")} />
        </StatGrid>
      )}

      <Card>
        <CardHeader
          title={t("AI usage per user")}
          icon={<IconTile icon={ChartBarIcon} size="sm" tone="accent" />}
          description={
            body
              ? t("{start} to {end} ({tz}). Most tokens first; open a person for their full report. Cost is in US dollars from each model's price in this AI Engine.", {
                  start: shortDay(body.period.start), end: shortDay(body.period.end), tz: body.period.timezone,
                })
              : t("Most tokens first; open a person for their full report.")
          }
        />
        <CardBody>
          <DataTable
            label={t("AI usage per user")}
            mode="server"
            columns={columns}
            rows={table.rows}
            total={table.total}
            rowId={(p) => p.user_id}
            rowLabel={(p) => p.name}
            control={control}
            loading={table.loading}
            fetching={table.fetching}
            error={table.error}
            onRetry={table.refetch}
            searchPlaceholder={t("Search by name, email or company")}
            onOpen={(p) => setOpen(p.user_id)}
            exportName={t("AI usage per user")}
            exportRows={params ? () => everyRow<PersonUsage, PeopleUsageBody>("/api/ai/people-usage", control.state, params, (b) => b.people) : undefined}
            toolbarActions={
              totals?.office_calls ? (
                <Button size="sm" variant="outline" onClick={() => setOpen(OFFICE)}>
                  <BuildingsIcon size={15} /> {t("Office's own work")}
                </Button>
              ) : null
            }
            filters={
              <>
                <Select className="w-full sm:w-40" label={t("Role")} value={role || ALL} onValueChange={(v) => setRole(v === ALL ? "" : v)}
                  options={[{ value: ALL, label: t("All roles") }, ...ROLES.map((r) => ({ value: r, label: t(ROLE_INFO[r].label) }))]} />
                {branches.length > 1 ? (
                  <CompanyPicker className="w-full sm:w-44" label={t("Company")} value={branch || ALL} onValueChange={(v) => setBranch(v === ALL ? "" : v)}
                    before={[{ value: ALL, label: t("All companies") }, { value: "none", label: t("No company") }]} companies={branches} />
                ) : null}
              </>
            }
            empty={<EmptyState icon={UsersIcon} title={t("Nobody matches")} body={t("Try another period, role or company.")} />}
          />
        </CardBody>
      </Card>

      {open && params ? <PersonReport userId={open} params={params} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- one person's report

type Breakdown = "feature" | "agent" | "model" | "purpose";

interface Line { key: string; main: string; sub?: string; s: UsageSums }

function BreakdownList({ lines, total }: { lines: Line[]; total: number }) {
  const t = useT();
  if (!lines.length) return <p className="py-3 text-[13px] text-muted">{t("Nothing in this period.")}</p>;
  return (
    <ul className="grid divide-y divide-border">
      {lines.map((l) => {
        const share = total ? (l.s.tokens * 100) / total : 0;
        return (
          <li key={l.key} className="grid gap-1.5 py-2.5">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <span className="min-w-0 text-[13px]">
                <span className="font-medium break-words">{l.main}</span>
                {l.sub ? <span className="ml-1.5 font-mono text-[11.5px] break-all text-muted">{l.sub}</span> : null}
              </span>
              <span className="flex flex-wrap gap-x-3 text-[12px] text-muted tabular">
                <span>{t("{n} calls", { n: compact(l.s.calls) })}</span>
                <span className="font-medium text-fg">{t("{n} tokens", { n: compact(l.s.tokens) })}</span>
                <span>{money(l.s)}</span>
              </span>
            </div>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, share)}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DailyChart({ daily }: { daily: UsageReport["daily"] }) {
  const t = useT();
  return (
    <div className="h-44 min-w-0" role="img" aria-label={t("Tokens per day")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} fontSize={11} minTickGap={16} />
          <YAxis tickFormatter={(v: number) => compact(v)} tickLine={false} axisLine={false} fontSize={11} width={44} />
          <Tooltip
            cursor={{ fill: "var(--color-surface-2)" }}
            formatter={(v) => [compact(Number(v)), t("Tokens")]}
            labelFormatter={(l) => shortDay(String(l))}
            contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12.5 }}
          />
          <Bar dataKey="tokens" fill="var(--color-accent)" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventsTable({ userId, params }: { userId: string; params: Record<string, string> }) {
  const t = useT();
  const feature = useFeature();
  const control = useLocalTableState({ size: 25, sort: "ts", dir: "desc" });
  const [only, setOnly] = filterOf(control, "feature");
  const url = `/api/ai/people-usage/${encodeURIComponent(userId)}/events`;
  const table = useServerTable<UsageEvent>(["ai", "people-usage", userId, "events"], url, control.state, params);
  const columns: Column<UsageEvent>[] = [
    { id: "ts", header: t("When"), sortable: true, kind: "date", cell: (e) => <span className="whitespace-nowrap">{dateTime(e.ts)}</span>, exportValue: (e) => e.ts },
    {
      id: "purpose", header: t("What for"), card: "title",
      cell: (e) => (
        <span className="grid min-w-0">
          <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
            {feature(e.feature)}
            {e.status === "error" ? <Pill tone="danger">{e.error_class ? t("Failed: {why}", { why: e.error_class }) : t("Failed")}</Pill> : null}
            {!e.charged ? <Pill>{t("Not counted in allowance")}</Pill> : null}
          </span>
          <span className="font-mono text-[11.5px] break-all text-muted">{e.purpose}</span>
        </span>
      ),
      exportValue: (e) => `${feature(e.feature)} (${e.purpose})`,
    },
    {
      id: "task", header: t("Task or agent"),
      cell: (e) => (
        <span className="grid min-w-0 gap-0.5 text-[13px]">
          {e.task_id ? (
            <Link to="/tasks" search={{ task: e.task_id }} className="break-words text-accent hover:underline">{e.task_title ?? e.task_id}</Link>
          ) : null}
          {e.agent_id ? (
            <Link to="/agents/$agentId" params={{ agentId: e.agent_id }} className={cn("break-words hover:underline", e.task_id ? "text-[12px] text-muted" : "text-accent")}>
              {e.agent_name ?? e.agent_id}
            </Link>
          ) : null}
          {!e.task_id && !e.agent_id ? <span className="text-muted">–</span> : null}
        </span>
      ),
      exportValue: (e) => [e.task_title ?? e.task_id, e.agent_name ?? e.agent_id].filter(Boolean).join(" · "),
    },
    {
      id: "model", header: t("Model"), hideBelow: "lg",
      cell: (e) => (
        <span className="grid min-w-0">
          <span className="font-mono text-[12px] break-words">{e.model}</span>
          <span className="text-[11.5px] text-muted">{[e.provider, e.group].filter(Boolean).join(" · ")}</span>
        </span>
      ),
      exportValue: (e) => `${e.provider} / ${e.model}${e.group ? ` (${e.group})` : ""}`,
    },
    {
      id: "tokens", header: t("Tokens"), sortable: true, kind: "number", align: "right",
      cell: (e) => (
        <span className="grid justify-items-end max-md:justify-items-start">
          <Num>{compact(e.tokens)}</Num>
          <span className="text-[11.5px] whitespace-nowrap text-muted">{t("{in} in · {out} out", { in: compact(e.prompt), out: compact(e.completion) })}</span>
        </span>
      ),
      exportValue: (e) => `${e.prompt}/${e.completion}`,
    },
    { id: "cost", header: t("Cost (USD)"), sortable: true, kind: "number", align: "right", cell: (e) => <Num>{usd(e.cost_usd)}</Num>, exportValue: (e) => (e.cost_usd === null ? "" : e.cost_usd.toFixed(6)) },
  ];
  return (
    <DataTable
      label={t("Every call")}
      mode="server"
      columns={columns}
      rows={table.rows}
      total={table.total}
      rowId={(e) => String(e.id)}
      rowLabel={(e) => e.purpose}
      control={control}
      loading={table.loading}
      fetching={table.fetching}
      error={table.error}
      onRetry={table.refetch}
      searchPlaceholder={t("Search purpose or model")}
      exportName={t("AI calls")}
      exportRows={() => everyRow<UsageEvent>(url, control.state, params)}
      stickyHeader={false}
      layout="auto"
      filters={
        <Select className="w-full sm:w-52" label={t("Feature")} value={only || ALL} onValueChange={(v) => setOnly(v === ALL ? "" : v)}
          options={[{ value: ALL, label: t("All features") }, ...Object.keys(FEATURE_LABELS).map((k) => ({ value: k, label: feature(k) }))]} />
      }
      empty={<EmptyState icon={ChartBarIcon} title={t("No calls")} body={t("Nothing in this period.")} />}
    />
  );
}

export function PersonReport({ userId, params, onClose }: { userId: string; params: Record<string, string>; onClose: () => void }) {
  const t = useT();
  const feature = useFeature();
  const [view, setView] = useState<Breakdown>("feature");
  const href = withParams(`/api/ai/people-usage/${encodeURIComponent(userId)}`, params);
  const { data: r, isLoading, error } = useQuery({ queryKey: ["ai", "people-usage", userId, href], queryFn: () => api<UsageReport>(href) });
  const office = userId === OFFICE;

  const lines = useMemo((): Record<Breakdown, Line[]> => {
    if (!r) return { feature: [], agent: [], model: [], purpose: [] };
    return {
      feature: r.by_feature.map((f) => ({ key: f.feature, main: feature(f.feature), s: f })),
      agent: r.by_agent.map((a) => ({ key: a.agent_id ?? "-", main: a.agent_id ? (a.name ?? a.agent_id) : t("No agent (direct use)"), s: a })),
      model: r.by_model.map((m) => ({ key: `${m.provider}/${m.model}/${m.group ?? ""}`, main: m.model, sub: [m.provider, m.group].filter(Boolean).join(" · "), s: m })),
      purpose: r.by_purpose.map((p) => ({ key: p.purpose, main: feature(p.feature), sub: p.purpose, s: p })),
    };
  }, [r, feature, t]);

  const title = office ? t("Office's own work") : (r?.person.name ?? t("AI usage"));
  const where = r ? [r.person.email, r.person.role ? t(ROLE_INFO[r.person.role as Role]?.label ?? r.person.role) : "", r.person.branch_name, r.person.department_name].filter(Boolean).join(" · ") : "";

  return (
    <SideSheet open onOpenChange={(o) => { if (!o) onClose(); }} size="xl" title={title}
      description={office ? t("Work nobody asked for: routines, learning and the office's own jobs.") : where || undefined}>
      {isLoading ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</div>
          <Skeleton className="h-44 rounded-[var(--radius-md)]" />
        </div>
      ) : error || !r ? (
        <p role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">{t("Could not load usage.")} {errorMessage(error)}</p>
      ) : (
        <div className="grid min-w-0 gap-6">
          <p className="text-[12.5px] text-muted">
            {t("{start} to {end}", { start: shortDay(r.period.start), end: shortDay(r.period.end) })}
            {r.last_used ? ` · ${t("Last used {when}", { when: timeAgo(r.last_used) })}` : ""}
            {!r.person.member && !office ? ` · ${t("Not a member now")}` : ""}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("Tokens")} value={compact(r.totals.tokens)} icon={TextAaIcon} tone="accent"
              hint={t("{in} in, {out} out", { in: compact(r.totals.prompt), out: compact(r.totals.completion) })} />
            <Stat label={t("Cost (USD)")} value={money(r.totals)} icon={CoinsIcon} tone="ok"
              hint={r.totals.unpriced ? t("{n} calls had no price", { n: r.totals.unpriced }) : t("Every call priced")} />
            <Stat label={t("Calls")} value={compact(r.totals.calls)} icon={ChartBarIcon} tone="info"
              hint={[r.totals.errors ? t("{n} failed", { n: r.totals.errors }) : "", r.tasks ? t("{n} tasks", { n: r.tasks }) : ""].filter(Boolean).join(" · ") || undefined} />
            {office ? null : (
              <Stat label={t("Allowance today")} value={compact(r.person.today_used)} icon={UsersIcon} tone="violet"
                hint={r.person.today_limit === null ? t("No limit") : t("of {limit} tokens", { limit: compact(r.person.today_limit) })} />
            )}
          </div>

          <section className="grid min-w-0 gap-2">
            <h3 className="text-[14px] font-semibold">{t("Tokens per day")}</h3>
            <DailyChart daily={r.daily} />
          </section>

          <section className="grid min-w-0 gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold">{t("Where it went")}</h3>
              <Segmented size="sm" label={t("Group usage by")} value={view} onChange={setView}
                options={[
                  { value: "feature", label: t("Feature"), count: lines.feature.length },
                  { value: "agent", label: t("Agent"), count: lines.agent.length },
                  { value: "model", label: t("Model"), count: lines.model.length },
                  { value: "purpose", label: t("Purpose"), count: lines.purpose.length },
                ]} />
            </div>
            <BreakdownList lines={lines[view]} total={r.totals.tokens} />
          </section>

          <section className="grid min-w-0 gap-3">
            <div>
              <h3 className="text-[14px] font-semibold">{t("Every call")}</h3>
              <p className="text-[12.5px] text-muted">{t("When, what for, which task or agent, which model, tokens and cost. What was said is never shown.")}</p>
            </div>
            <EventsTable userId={userId} params={params} />
          </section>
        </div>
      )}
    </SideSheet>
  );
}
