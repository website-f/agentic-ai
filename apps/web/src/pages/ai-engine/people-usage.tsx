/**
 * P113: AI usage per user, owners, admins and the developer (P115; earlier only the developer;
 * the API refuses everyone else). One row per person for a period, most tokens first; open a
 * row for their full report: by feature, agent, model and day, and every call. P114: each call
 * with what it was about (their message and the reply, or the task's brief and result), their
 * conversations and the tasks their use paid for (opening them is audited). Numbers come from
 * the model-call ledger (api/routers/ai_people_usage.py).
 */
import { BuildingsIcon, ChartBarIcon, ChatsCircleIcon, CoinsIcon, CrownIcon, FileXlsIcon, ListChecksIcon, SparkleIcon, TextAaIcon, UsersIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState, IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
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
import { startDownload } from "@/lib/native";
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
  /** P147: calls Microsoft 365 Copilot answered instead of the AI engine (free, no tokens of
   * ours), and the tokens the engine would have used for them (estimated). */
  copilot_calls?: number;
  saved_tokens?: number;
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
  /** P114: what it was about. "task": the brief and result; "chat": their message and the reply,
   * matched by person, agent and time; null: no text kept for this feature. */
  source: "task" | "chat" | null;
  asked: string | null;
  answered: string | null;
  session_id: string | null;
  session_title: string | null;
}

export interface UsageEventDetail extends UsageEvent {
  task_status: string | null;
  error_detail: string | null;
}

export interface UsageFacets {
  agents: { id: string | null; name: string | null; calls: number }[];
  models: { model: string; provider: string; calls: number }[];
}

export interface ConversationRow {
  id: string;
  title: string;
  agent_id: string;
  agent_name: string | null;
  messages: number;
  asked: number;
  first_at: string;
  last_at: string;
  first_message: string | null;
  /** Chat calls with that agent while it ran (matched by time). */
  tokens: number;
  cost_usd: number;
}

export interface ConversationDetail {
  id: string;
  title: string;
  agent_id: string;
  agent_name: string | null;
  lines: { id: number; role: "user" | "assistant"; content: string; at: string }[];
  more: boolean;
}

export interface PaidTask {
  task_id: string;
  title: string;
  status: string | null;
  brief: string | null;
  agent_name: string | null;
  created_at: string | null;
  calls: number;
  tokens: number;
  cost_usd: number;
  last_at: string;
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
const ROLES: Role[] = ["owner", "admin", "it_support", "management", "hr", "branch_manager", "group_hod", "hod", "supervisor", "staff", "operator", "approver", "viewer"];

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
  const [dept, setDept] = filterOf(control, "department");
  const [open, setOpen] = useState<string | null>(null);
  // P114: departments of the chosen company, or of every company (named with it).
  const depts = branches
    .filter((b) => !branch || branch === ALL || b.id === branch)
    .flatMap((b) => b.departments.map((d) => ({ value: d.id, label: branch ? d.name : `${b.name} · ${d.name}` })));
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
    {
      // P147: what Microsoft 365 Copilot answered for them, and the engine tokens that saved.
      id: "copilot", header: t("Copilot"), sortable: true, kind: "number", align: "right", hideBelow: "xl",
      cell: (p) => (p.copilot_calls
        ? <span className="grid justify-items-end max-md:justify-items-start"><Num>{compact(p.copilot_calls)}</Num><span className="text-[11.5px] whitespace-nowrap text-ok">{t("{n} saved", { n: compact(p.saved_tokens ?? 0) })}</span></span>
        : <span className="text-muted">–</span>),
      exportValue: (p) => `${p.copilot_calls ?? 0}/${p.saved_tokens ?? 0}`,
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
          {t("Who uses the AI, how much, and what for. Only owners, admins and the system's developer see this page. Open a person for their full report: every call with what they asked and what came back, their conversations and tasks. Opening a report is recorded in the audit log.")}
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
          {totals.copilot_calls ? (
            <Stat label={t("Answered by Copilot")} value={compact(totals.copilot_calls)} icon={SparkleIcon} tone="info"
              hint={t("About {n} engine tokens saved (Microsoft 365 Copilot, free with the licence)", { n: compact(totals.saved_tokens ?? 0) })} />
          ) : null}
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
                {depts.length ? (
                  <Select className="w-full sm:w-52" label={t("Department")} value={dept || ALL} onValueChange={(v) => setDept(v === ALL ? "" : v)}
                    options={[{ value: ALL, label: t("All departments") }, { value: "none", label: t("No department") }, ...depts]} />
                ) : null}
              </>
            }
            empty={<EmptyState icon={UsersIcon} title={t("Nobody matches")} body={t("Try another period, role, company or department.")} />}
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
  const [agent, setAgent] = filterOf(control, "agent");
  const [model, setModel] = filterOf(control, "model");
  const [detail, setDetail] = useState<number | null>(null);
  const url = `/api/ai/people-usage/${encodeURIComponent(userId)}/events`;
  const table = useServerTable<UsageEvent>(["ai", "people-usage", userId, "events"], url, control.state, params);
  const facetsHref = withParams(`/api/ai/people-usage/${encodeURIComponent(userId)}/facets`, params);
  const { data: facets } = useQuery({ queryKey: ["ai", "people-usage", userId, facetsHref], queryFn: () => api<UsageFacets>(facetsHref) });
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
      id: "about", header: t("What it was about"), card: "full",
      cell: (e) => <About e={e} />,
      exportValue: (e) => [e.asked, e.answered].filter(Boolean).join(" → "),
    },
    {
      id: "task", header: t("Task or agent"), hideBelow: "xl",
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
    <>
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
      searchPlaceholder={t("Search what they asked, the reply, task, purpose or model")}
      onOpen={(e) => setDetail(e.id)}
      exportName={t("AI calls")}
      exportRows={() => everyRow<UsageEvent>(url, control.state, params)}
      stickyHeader={false}
      layout="auto"
      filters={
        <>
          <Select className="w-full sm:w-52" label={t("Feature")} value={only || ALL} onValueChange={(v) => setOnly(v === ALL ? "" : v)}
            options={[{ value: ALL, label: t("All features") }, ...Object.keys(FEATURE_LABELS).map((k) => ({ value: k, label: feature(k) }))]} />
          {facets?.agents?.length ? (
            <Select className="w-full sm:w-48" label={t("Agent")} value={agent || ALL} onValueChange={(v) => setAgent(v === ALL ? "" : v)}
              options={[{ value: ALL, label: t("All agents") }, ...facets.agents.map((a) => ({ value: a.id ?? "none", label: a.id ? (a.name ?? a.id) : t("No agent (direct use)") }))]} />
          ) : null}
          {facets?.models && facets.models.length > 1 ? (
            <Select className="w-full sm:w-48" label={t("Model")} value={model || ALL} onValueChange={(v) => setModel(v === ALL ? "" : v)}
              options={[{ value: ALL, label: t("All models") }, ...[...new Set(facets.models.map((m) => m.model))].map((m) => ({ value: m, label: m }))]} />
          ) : null}
        </>
      }
      empty={<EmptyState icon={ChartBarIcon} title={t("No calls")} body={t("Nothing in this period.")} />}
    />
    {detail !== null ? <CallDialog userId={userId} callId={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

// ---------------------------------------------------------------- P114: what it was about

/** What a call was about: the person's message and the reply (chat, matched by time), or the
 * task's brief and result. */
function About({ e, full }: { e: UsageEvent; full?: boolean }) {
  const t = useT();
  if (!e.source) return <span className="text-[12.5px] text-muted">{t("No text kept for this feature")}</span>;
  const clamp = full ? "whitespace-pre-wrap" : "line-clamp-3";
  return (
    <span className="grid min-w-0 gap-1.5 text-[13px]">
      {e.asked ? (
        <span className="grid min-w-0">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{e.source === "task" ? t("What they asked (task brief)") : t("They wrote")}</span>
          <span className={cn("break-words", clamp)}>{e.asked}</span>
        </span>
      ) : null}
      {e.answered ? (
        <span className="grid min-w-0">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{e.source === "task" ? t("Result") : t("The AI replied")}</span>
          <span className={cn("break-words text-muted", clamp)}>{e.answered}</span>
        </span>
      ) : null}
      {e.source === "chat" ? (
        <span className="text-[11.5px] text-muted">
          {e.session_title ? t("In “{title}” · matched by time", { title: e.session_title }) : t("Matched by time")}
        </span>
      ) : null}
    </span>
  );
}

function CallDialog({ userId, callId, onClose }: { userId: string; callId: number; onClose: () => void }) {
  const t = useT();
  const feature = useFeature();
  const { data: e, isLoading, error } = useQuery({
    queryKey: ["ai", "people-usage", userId, "call", callId],
    queryFn: () => api<UsageEventDetail>(`/api/ai/people-usage/${encodeURIComponent(userId)}/events/${callId}`),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => { if (!o) onClose(); }} title={e ? feature(e.feature) : t("AI call")}
      description={e ? `${dateTime(e.ts)} · ${e.purpose}` : undefined} className="sm:max-w-2xl">
      {isLoading ? <Skeleton className="h-40" /> : error || !e ? (
        <p role="alert" className="text-[13.5px] text-danger">{errorMessage(error)}</p>
      ) : (
        <div className="grid min-w-0 gap-4">
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
            {e.task_id ? (<><dt className="text-muted">{t("Task")}</dt><dd><Link to="/tasks" search={{ task: e.task_id }} className="break-words text-accent hover:underline">{e.task_title ?? e.task_id}</Link></dd></>) : null}
            {e.agent_id ? (<><dt className="text-muted">{t("Agent")}</dt><dd className="break-words">{e.agent_name ?? e.agent_id}</dd></>) : null}
            <dt className="text-muted">{t("Model")}</dt><dd className="font-mono text-[12px] break-words">{[e.provider, e.model, e.group].filter(Boolean).join(" · ")}</dd>
            <dt className="text-muted">{t("Tokens")}</dt><dd className="tabular">{t("{in} in · {out} out", { in: compact(e.prompt), out: compact(e.completion) })}</dd>
            <dt className="text-muted">{t("Cost (USD)")}</dt><dd className="tabular">{usd(e.cost_usd)}</dd>
            {e.status === "error" ? (<><dt className="text-muted">{t("Failed")}</dt><dd className="break-words text-danger">{[e.error_class, e.error_detail].filter(Boolean).join(": ")}</dd></>) : null}
          </dl>
          <div className="max-h-[55dvh] overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface-2/40 p-3"><About e={e} full /></div>
        </div>
      )}
    </ResponsiveDialog>
  );
}

function ConversationDialog({ userId, sessionId, onClose }: { userId: string; sessionId: string; onClose: () => void }) {
  const t = useT();
  const { data: c, isLoading, error } = useQuery({
    queryKey: ["ai", "people-usage", userId, "conversation", sessionId],
    queryFn: () => api<ConversationDetail>(`/api/ai/people-usage/${encodeURIComponent(userId)}/conversations/${encodeURIComponent(sessionId)}`),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => { if (!o) onClose(); }} title={c?.title ?? t("Conversation")}
      description={c?.agent_name ? t("With {agent}", { agent: c.agent_name }) : undefined} className="sm:max-w-2xl">
      {isLoading ? <Skeleton className="h-60" /> : error || !c ? (
        <p role="alert" className="text-[13.5px] text-danger">{errorMessage(error)}</p>
      ) : (
        <div className="grid max-h-[65dvh] min-w-0 gap-3 overflow-y-auto pr-1">
          {c.more ? <p className="text-[12px] text-muted">{t("Only the latest {n} messages are shown.", { n: c.lines.length })}</p> : null}
          {c.lines.map((l) => (
            <div key={l.id} className={cn("grid max-w-[92%] min-w-0 gap-1 rounded-[var(--radius-sm)] px-3 py-2 text-[13px]",
              l.role === "user" ? "justify-self-end bg-accent-soft" : "justify-self-start border border-border bg-surface")}>
              <span className="text-[11px] text-muted">{l.role === "user" ? t("They wrote") : (c.agent_name ?? t("The AI replied"))} · {dateTime(l.at)}</span>
              <span className="break-words whitespace-pre-wrap">{l.content}</span>
            </div>
          ))}
          {!c.lines.length ? <p className="text-[13px] text-muted">{t("No messages.")}</p> : null}
        </div>
      )}
    </ResponsiveDialog>
  );
}

function ConversationsTable({ userId, params }: { userId: string; params: Record<string, string> }) {
  const t = useT();
  const control = useLocalTableState({ size: 25, sort: "last", dir: "desc" });
  const url = `/api/ai/people-usage/${encodeURIComponent(userId)}/conversations`;
  const table = useServerTable<ConversationRow>(["ai", "people-usage", userId, "conversations"], url, control.state, params);
  const [open, setOpen] = useState<string | null>(null);
  const columns: Column<ConversationRow>[] = [
    {
      id: "title", header: t("Conversation"), sortable: true, card: "title",
      cell: (c) => (
        <span className="grid min-w-0">
          <span className="font-medium break-words">{c.title}</span>
          {c.first_message ? <span className="line-clamp-2 text-[12px] break-words text-muted">{c.first_message}</span> : null}
        </span>
      ),
      exportValue: (c) => c.title,
    },
    { id: "agent", header: t("Agent"), cell: (c) => c.agent_name ?? <span className="text-muted">–</span>, exportValue: (c) => c.agent_name ?? "" },
    {
      id: "messages", header: t("Messages"), sortable: true, kind: "number", align: "right",
      cell: (c) => <Num>{t("{n} ({mine} theirs)", { n: c.messages, mine: c.asked })}</Num>, exportValue: (c) => c.messages,
    },
    { id: "tokens", header: t("Tokens (about)"), sortable: true, kind: "number", align: "right", cell: (c) => <Num>{compact(c.tokens)}</Num>, exportValue: (c) => c.tokens },
    { id: "cost", header: t("Cost (USD)"), kind: "number", align: "right", hideBelow: "lg", cell: (c) => <Num>{usd(c.cost_usd)}</Num>, exportValue: (c) => c.cost_usd.toFixed(6) },
    { id: "last", header: t("Last message"), sortable: true, kind: "date", cell: (c) => <span className="whitespace-nowrap">{dateTime(c.last_at)}</span>, exportValue: (c) => c.last_at },
  ];
  return (
    <>
      <DataTable label={t("Conversations")} mode="server" columns={columns} rows={table.rows} total={table.total}
        rowId={(c) => c.id} rowLabel={(c) => c.title} control={control} loading={table.loading} fetching={table.fetching}
        error={table.error} onRetry={table.refetch} onOpen={(c) => setOpen(c.id)}
        searchPlaceholder={t("Search the title, agent or anything written")}
        exportName={t("Conversations")} exportRows={() => everyRow<ConversationRow>(url, control.state, params)}
        stickyHeader={false} layout="auto"
        empty={<EmptyState icon={ChatsCircleIcon} title={t("No conversations")} body={t("Nothing in this period.")} />} />
      {open ? <ConversationDialog userId={userId} sessionId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function TasksTable({ userId, params }: { userId: string; params: Record<string, string> }) {
  const t = useT();
  const control = useLocalTableState({ size: 25, sort: "tokens", dir: "desc" });
  const url = `/api/ai/people-usage/${encodeURIComponent(userId)}/tasks`;
  const table = useServerTable<PaidTask>(["ai", "people-usage", userId, "tasks"], url, control.state, params);
  const columns: Column<PaidTask>[] = [
    {
      id: "title", header: t("Task"), sortable: true, card: "title",
      cell: (x) => (
        <span className="grid min-w-0">
          <Link to="/tasks" search={{ task: x.task_id }} className="font-medium break-words text-accent hover:underline">{x.title}</Link>
          {x.brief ? <span className="line-clamp-2 text-[12px] break-words text-muted">{x.brief}</span> : null}
        </span>
      ),
      exportValue: (x) => x.title,
    },
    { id: "agent", header: t("Agent"), hideBelow: "lg", cell: (x) => x.agent_name ?? <span className="text-muted">–</span>, exportValue: (x) => x.agent_name ?? "" },
    { id: "status", header: t("Status"), cell: (x) => (x.status ? <Pill>{x.status}</Pill> : <span className="text-muted">–</span>), exportValue: (x) => x.status ?? "" },
    { id: "calls", header: t("Calls"), sortable: true, kind: "number", align: "right", cell: (x) => <Num>{compact(x.calls)}</Num>, exportValue: (x) => x.calls },
    { id: "tokens", header: t("Tokens"), sortable: true, kind: "number", align: "right", cell: (x) => <Num className="font-medium">{compact(x.tokens)}</Num>, exportValue: (x) => x.tokens },
    { id: "cost", header: t("Cost (USD)"), sortable: true, kind: "number", align: "right", cell: (x) => <Num>{usd(x.cost_usd)}</Num>, exportValue: (x) => x.cost_usd.toFixed(6) },
    { id: "last", header: t("Last call"), sortable: true, kind: "date", hideBelow: "lg", cell: (x) => <span className="whitespace-nowrap">{dateTime(x.last_at)}</span>, exportValue: (x) => x.last_at },
  ];
  return (
    <DataTable label={t("Tasks")} mode="server" columns={columns} rows={table.rows} total={table.total}
      rowId={(x) => x.task_id} rowLabel={(x) => x.title} control={control} loading={table.loading} fetching={table.fetching}
      error={table.error} onRetry={table.refetch} searchPlaceholder={t("Search the task, what was asked or the result")}
      exportName={t("Tasks")} exportRows={() => everyRow<PaidTask>(url, control.state, params)}
      stickyHeader={false} layout="auto"
      empty={<EmptyState icon={ListChecksIcon} title={t("No tasks")} body={t("Nothing in this period.")} />} />
  );
}

export function PersonReport({ userId, params, onClose }: { userId: string; params: Record<string, string>; onClose: () => void }) {
  const t = useT();
  const feature = useFeature();
  const [view, setView] = useState<Breakdown>("feature");
  const [log, setLog] = useState<"calls" | "conversations" | "tasks">("calls");
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
      description={office ? t("Work nobody asked for: routines, learning and the office's own jobs.") : where || undefined}
      // P114: the whole report for the period as one Excel file (summary, breakdowns, every call).
      actions={<Button size="sm" variant="outline" onClick={() => startDownload(withParams(`/api/ai/people-usage/${encodeURIComponent(userId)}/report.xlsx`, params))}>
        <FileXlsIcon size={16} /> {t("Download full report (Excel)")}
      </Button>}>
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
              hint={[
                r.totals.errors ? t("{n} failed", { n: r.totals.errors }) : "",
                r.tasks ? t("{n} tasks", { n: r.tasks }) : "",
                // P147: answered by Microsoft 365 Copilot instead of the engine.
                r.totals.copilot_calls ? t("{n} by Copilot, about {saved} tokens saved", { n: compact(r.totals.copilot_calls), saved: compact(r.totals.saved_tokens ?? 0) }) : "",
              ].filter(Boolean).join(" · ") || undefined} />
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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold">{t("Their logs")}</h3>
                <p className="max-w-xl text-[12.5px] text-muted">
                  {log === "calls"
                    ? t("Every call: when, what for, what they asked and what came back, which model, tokens and cost. Open a call to read it in full. Chat calls are matched to the conversation by time.")
                    : log === "conversations"
                      ? t("Their conversations with agents in this period. Open one to read it. Tokens are the chat calls with that agent while it ran.")
                      : t("The tasks their AI use paid for, most tokens first.")}
                </p>
              </div>
              {office ? null : (
                <Segmented size="sm" label={t("Show")} value={log} onChange={setLog}
                  options={[
                    { value: "calls", label: t("Every call") },
                    { value: "conversations", label: t("Conversations") },
                    { value: "tasks", label: t("Tasks") },
                  ]} />
              )}
            </div>
            {log === "conversations" && !office ? <ConversationsTable userId={userId} params={params} />
              : log === "tasks" && !office ? <TasksTable userId={userId} params={params} />
                : <EventsTable userId={userId} params={params} />}
          </section>
        </div>
      )}
    </SideSheet>
  );
}
