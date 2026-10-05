import {
  ArrowRightIcon,
  BrainIcon,
  BuildingsIcon,
  CalculatorIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  ClockCountdownIcon,
  CoinsIcon,
  GearSixIcon,
  HardHatIcon,
  HeadsetIcon,
  InfoIcon,
  LightningIcon,
  MegaphoneIcon,
  NetworkIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  TimerIcon,
  UsersThreeIcon,
  WalletIcon,
  type Icon,
} from "@phosphor-icons/react";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState, IconTile, Page, PageHeader, Section, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow, Meta } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { useBranch } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { agentsQuery, type Agent } from "@/lib/work";

// ---------------------------------------------------------------- data (GET /api/impact)

interface DeptImpact {
  id: string;
  name: string;
  branch_id: string;
  agents: number;
  agent_names: string[];
  tasks_done: number;
  tasks_failed: number;
  usd: number;
  labels: { label: string; count: number }[];
  coverage: "working" | "ready" | "none";
}

interface BranchImpact {
  id: string;
  name: string;
  color: string;
  industry: string;
  agents: number;
  tasks_done: number;
  tasks_failed: number;
  usd: number;
  departments: DeptImpact[];
}

interface Impact {
  days: number;
  generated_at: string;
  scope: { kind: string; label: string };
  default_minutes: number;
  totals: {
    tasks_done: number;
    tasks_failed: number;
    in_review: number;
    unassigned_done: number;
    success_rate: number | null;
    agents: number;
    usd: number;
    calls: number;
    calls_unpriced: number;
    tokens: number;
  };
  coverage: { departments: number; with_agents: number; working: number };
  approvals: {
    decided: number;
    approved: number;
    denied: number;
    answered: number;
    pending: number;
    median_minutes: number | null;
    average_minutes: number | null;
  };
  skills: { active: number; learned: number; learned_in_window: number; uses_in_window: number };
  labels: { label: string; count: number }[];
  work_types: { label: string; count: number }[];
  done_by_day: { day: string; count: number }[];
  branches: BranchImpact[];
  top_agents: { id: string; name: string; role: string; branch_id: string; done: number }[];
}

const impactQuery = (days: number) =>
  queryOptions({ queryKey: ["impact", days] as const, queryFn: () => api<Impact>(`/api/impact?days=${days}`) });

// ---------------------------------------------------------------- assumptions (this viewer's)

type Mode = "department" | "work_type";

interface Assumptions {
  minutes: number; // a person's minutes per task, unless set per department / work type
  deptMinutes: Record<string, number>;
  labelMinutes: Record<string, number>;
  mode: Mode;
  rate: number; // RM per staff hour
  fx: number; // RM per US$
  review: number; // % of the freed time people spend checking AI work
  roiHours: number | null; // null = use the measured figure
  roiSpend: number | null;
}

const DEFAULTS: Assumptions = {
  minutes: 30,
  deptMinutes: {},
  labelMinutes: {},
  mode: "department",
  rate: 25,
  fx: 4.2,
  review: 20,
  roiHours: null,
  roiSpend: null,
};
const STORE = "agentic.impact.v1";

function loadAssumptions(): Assumptions {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Assumptions>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function saveAssumptions(a: Assumptions) {
  try {
    localStorage.setItem(STORE, JSON.stringify(a));
  } catch {
    // Private windows and blocked storage: the page still works, it just forgets.
  }
}

const rm = (n: number) => `RM ${n.toLocaleString(locale(), { maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 && n > 0 ? 2 : 0 })}`;
const hrs = (n: number) => tr("{n} h", { n: n.toLocaleString(locale(), { maximumFractionDigits: n < 10 ? 1 : 0 }) });
const mins = (n: number | null) =>
  n === null
    ? "–"
    : n < 1
      ? tr("< 1 min")
      : n < 90
        ? tr("{n} min", { n: Math.round(n) })
        : tr("{n} h", { n: (n / 60).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });

function NumberInput({
  value,
  onChange,
  label,
  placeholder,
  suffix,
  className,
  min = 0,
  step = 1,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  placeholder?: string;
  suffix?: string;
  className?: string;
  min?: number;
  step?: number;
}) {
  return (
    <span className={cn("relative inline-flex min-w-0 items-center", className)}>
      <Input
        type="number"
        inputMode="decimal"
        aria-label={label}
        min={min}
        step={step}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          onChange(raw === "" || !Number.isFinite(n) ? null : Math.max(min, n));
        }}
        className={cn("h-9 tabular", suffix && "pr-11")}
      />
      {suffix ? <span className="pointer-events-none absolute right-2.5 text-[12px] text-muted">{suffix}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------- what the team can do

interface Capability {
  key: string;
  title: string;
  icon: Icon;
  tone: Tone;
  match: RegExp; // on the agent's role and department
  industry?: string;
  points: string[];
  example: string;
}

const CAPABILITIES: Capability[] = [
  {
    key: "finance",
    title: msg("Finance & accounts"),
    icon: CoinsIcon,
    tone: "orange",
    match: /\b(finance|account)/i,
    points: [
      msg("Cash-flow forecasts with an 80% range, worked out by a formula, not guessed"),
      msg("Loan and hire-purchase maths: instalment, schedule and the true effective rate"),
      msg("Budget vs actual, debtor ageing with a collection plan, the monthly management report"),
    ],
    example:
      msg("Forecast our cash for the next 3 months.\nOpening balance RM 40,000.\nCash in Apr-Sep: 52000, 48000, 55000, 50000, 53000, 51000.\nCash out Apr-Sep: 50000, 51000, 54000, 56000, 55000, 57000.\nShow the closing balance each month, the 80% range, and any month where cash runs short."),
  },
  {
    key: "sales",
    title: msg("Sales & marketing"),
    icon: MegaphoneIcon,
    tone: "info",
    match: /\b(sales|marketing|business development)/i,
    points: [
      msg("Quotations, proposals and follow-ups drafted for you to approve"),
      msg("Price and margin check before a quote goes out (markup is not margin)"),
      msg("Prospect research and campaign ideas"),
    ],
    example:
      msg("Check this price before we quote.\nOur cost is RM 1,000 per unit and sales wants to quote RM 1,300. We target a 30% gross margin.\nIs the price OK, and what price gives 30%? Say whether the price includes SST."),
  },
  {
    key: "operations",
    title: msg("Operations"),
    icon: GearSixIcon,
    tone: "ok",
    match: /\b(operations?|ops)\b/i,
    points: [
      msg("Schedules, checklists and supplier follow-ups"),
      msg("Meeting notes turned into decisions and action items with owners"),
      msg("Early warnings on what is late, with who owns it"),
    ],
    example:
      msg("Turn these notes into decisions and action items with owners and dates:\nWeekly ops meeting. Agreed to switch courier to the cheaper quote from next month. Lorry 2 service overdue, Azman to book. Stock count moved to the 28th. Nobody decided who covers the front desk during leave."),
  },
  {
    key: "hr",
    title: msg("HR & admin"),
    icon: UsersThreeIcon,
    tone: "pink",
    match: /\b(hr|human resource|admin)/i,
    points: [
      msg("Staff questions answered from your own HR policies, with the policy cited"),
      msg("Leave and claims checked against the rules"),
      msg("Letters, memos and onboarding checklists drafted"),
    ],
    example:
      msg("Draft an onboarding checklist for a new admin executive starting next Monday: first-day setup, documents to collect (IC, bank, EPF, SOCSO, EIS, tax), who they meet in week one, and what to check at the end of probation."),
  },
  {
    key: "customer_service",
    title: msg("Customer service"),
    icon: HeadsetIcon,
    tone: "accent",
    match: /\b(customer|support)/i,
    points: [
      msg("Polite, policy-based replies drafted for a person to send"),
      msg("Each case tracked until it is closed"),
      msg("Repeat problems reported to the right department"),
    ],
    example:
      msg("Draft a reply to a customer whose delivery is 3 days late. They ordered 20 units on the 2nd, were promised delivery on the 9th, and are asking for a discount. Apologise, give a new date, and do not promise a discount (a manager decides)."),
  },
  {
    key: "network",
    title: msg("Network & IT"),
    icon: NetworkIcon,
    tone: "violet",
    industry: "network",
    match: /\b(network|noc|it helpdesk|it support|helpdesk)\b/i,
    points: [
      msg("Alarms and logs grouped into incidents with impact and SLA figures"),
      msg("Incident reports, change requests and outage notices drafted"),
      msg("First-line helpdesk: step-by-step troubleshooting from your manuals"),
    ],
    example:
      msg("Summarise last week's network incidents for the monthly SLA report:\nMon 02:10-02:55 core switch KL-01 down (all KL customers).\nWed 14:00-14:20 fibre cut on the Shah Alam link (12 customers).\nFri 09:30-09:40 DNS slow (no outage).\nGive minutes down per site, uptime % for the month (31 days), and what to tell customers."),
  },
  {
    key: "engineering",
    title: msg("Projects & QS"),
    icon: HardHatIcon,
    tone: "warn",
    industry: "engineering",
    match: /\b(project|quantity|qs|contract)/i,
    points: [
      msg("Programme against progress, site reports and early delay warnings"),
      msg("Bills of quantities, cost estimates and variation valuations"),
      msg("Subcontractor quotations compared line by line"),
    ],
    example:
      msg("Compare these two subcontractor quotations for the M&E works:\nA: RM 412,000, 16 weeks, 5% retention, excludes testing and commissioning.\nB: RM 438,500, 14 weeks, 5% retention, includes testing and commissioning (about RM 18,000 if bought separately).\nWhich is better value and what should we clarify before awarding?"),
  },
];

function agentFor(cap: Capability, agents: Agent[], branchId: string | null): Agent | undefined {
  const fits = agents.filter((a) => cap.match.test(`${a.role} ${a.department_name ?? ""}`));
  return fits.find((a) => a.branch_id === branchId) ?? fits[0];
}

// ---------------------------------------------------------------- page

const RANGES = [
  { value: "7", label: msg("7 days") },
  { value: "30", label: msg("30 days") },
  { value: "90", label: msg("90 days") },
] as const;

const COVERAGE: Record<DeptImpact["coverage"], { label: string; tone: "ok" | "info" | "neutral"; tile: Tone }> = {
  working: { label: msg("Working"), tone: "ok", tile: "ok" },
  ready: { label: msg("Agent ready"), tone: "info", tile: "info" },
  none: { label: msg("No agent yet"), tone: "neutral", tile: "neutral" },
};

export function ImpactPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data, isLoading, error } = useQuery(impactQuery(Number(days)));
  const [a, setA] = useState<Assumptions>(loadAssumptions);
  const update = (patch: Partial<Assumptions>) =>
    setA((prev) => {
      const next = { ...prev, ...patch };
      saveAssumptions(next);
      return next;
    });

  return (
    <Page>
      <PageHeader
        title={t("Impact")}
        description={t("What your AI team measurably did, from your own records. Anything estimated is labelled, and the assumptions behind it are yours to change.")}
        actions={<Segmented label={t("Period")} value={days} onChange={setDays} options={RANGES.map((r) => ({ value: r.value, label: t(r.label) }))} />}
      />
      {isLoading ? (
        <div className="grid gap-4">
          <StatGrid className="sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />
            ))}
          </StatGrid>
          <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          {t("Could not load the impact report.")} {errorMessage(error)}
        </div>
      ) : data ? (
        <ImpactBody data={data} a={a} update={update} canManage={me.permissions.includes("org.manage")} canAudit={me.permissions.includes("audit.read")} />
      ) : null}
    </Page>
  );
}

function ImpactBody({
  data,
  a,
  update,
  canManage,
  canAudit,
}: {
  data: Impact;
  a: Assumptions;
  update: (p: Partial<Assumptions>) => void;
  canManage: boolean;
  canAudit: boolean;
}) {
  const t = useT();
  const tot = data.totals;
  const depts = data.branches.flatMap((b) => b.departments);
  const deptDone = depts.reduce((n, d) => n + d.tasks_done, 0);
  const other = Math.max(0, tot.tasks_done - deptDone); // work by agents outside a department, or unassigned
  const minutesFor = (d: DeptImpact) => a.deptMinutes[d.id] ?? a.minutes;
  const hours =
    a.mode === "department"
      ? depts.reduce((h, d) => h + (d.tasks_done * minutesFor(d)) / 60, 0) + (other * a.minutes) / 60
      : data.work_types.reduce((h, w) => h + (w.count * (a.labelMinutes[w.label] ?? a.minutes)) / 60, 0);
  const checking = hours * (a.review / 100);
  const freed = Math.max(0, hours - checking);
  const aiRm = tot.usd * a.fx;
  const staffValue = freed * a.rate;

  if (!tot.tasks_done && !tot.agents) {
    return (
      <EmptyState
        icon={ChartLineUpIcon}
        title={t("Nothing to measure yet")}
        body={t("Once agents finish tasks, this page shows the work done per company and department, the time it freed and what the AI cost. Start by giving an agent a task.")}
        action={
          <Button asChild>
            <Link to="/tasks" search={{ new: 1 }}>
              {t("New task")}
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <StatGrid guide="impact.totals" className="sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat
          label={t("Tasks completed")}
          value={tot.tasks_done.toLocaleString(locale())}
          icon={CheckCircleIcon}
          tone="ok"
          hint={tot.success_rate === null ? t("None finished or failed yet") : t("{pct}% accepted, {n} failed", { pct: Math.round(tot.success_rate * 100), n: tot.tasks_failed })}
        />
        <Stat label={t("Time freed (est.)")} value={hrs(freed)} icon={TimerIcon} tone="accent" hint={t("After {pct}% for checking", { pct: a.review })} />
        <Stat label={t("Staff time value (est.)")} value={rm(staffValue)} icon={WalletIcon} tone="info" hint={t("At {rate} an hour", { rate: rm(a.rate) })} />
        <Stat
          label={t("AI cost")}
          value={rm(aiRm)}
          icon={CoinsIcon}
          tone="orange"
          hint={tot.calls_unpriced ? t("US${usd}, {n} calls unpriced", { usd: tot.usd.toFixed(2), n: tot.calls_unpriced }) : `US$${tot.usd.toFixed(2)}`}
        />
        <Stat
          label={t("Approval turnaround")}
          value={mins(data.approvals.median_minutes)}
          icon={ClockCountdownIcon}
          tone="violet"
          hint={data.approvals.decided ? t("Median of {n} decisions", { n: data.approvals.decided }) : t("No decisions in this period")}
        />
        <Stat label={t("Skills learned")} value={data.skills.learned} icon={LightningIcon} tone="pink" hint={t("{n} uses this period", { n: data.skills.uses_in_window })} />
      </StatGrid>

      <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-3.5 py-2.5 text-[12.5px] text-muted">
        <InfoIcon size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0">
          {a.mode === "department"
            ? t("Measured: tasks, failures, AI cost, approvals and skills, for {scope} over the last {n} days. Estimated: time freed and its value, from the minutes a person would take per task (set per department below). It is time freed for other work, not a headcount saving.", { scope: data.scope.label, n: data.days })
            : t("Measured: tasks, failures, AI cost, approvals and skills, for {scope} over the last {n} days. Estimated: time freed and its value, from the minutes a person would take per task (set per work type below). It is time freed for other work, not a headcount saving.", { scope: data.scope.label, n: data.days })}
        </span>
      </p>

      <DoneChart data={data} />

      <Section title={t("By company and department")} description={t("Accepted work only. Departments without an agent show where the team could grow.")}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {data.branches.map((b) => (
            <BranchBlock key={b.id} b={b} a={a} update={update} minutesFor={minutesFor} fx={a.fx} canManage={canManage} />
          ))}
          {other ? (
            <p className="text-[12.5px] text-muted">
              {other === 1
                ? t("1 completed task was not tied to a department (unassigned work or agents without a department); it counts at {m} minutes.", { m: a.minutes })
                : t("{n} completed tasks were not tied to a department (unassigned work or agents without a department); they count at {m} minutes each.", { n: other, m: a.minutes })}
            </p>
          ) : null}
        </div>
      </Section>

      <AssumptionsCard data={data} a={a} update={update} />

      <RoiCalculator data={data} a={a} update={update} measuredHours={freed} measuredAiRm={aiRm} />

      <Capabilities branches={data.branches} canManage={canManage} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <ApprovalsAndLearning data={data} />
        <SafetyPanel canAudit={canAudit} />
      </div>
    </>
  );
}

function DoneChart({ data }: { data: Impact }) {
  const t = useT();
  const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <Card>
      <CardHeader
        title={t("Tasks completed per day")}
        description={t("{n} accepted in the last {days} days; {review} waiting for review now.", { n: data.totals.tasks_done, days: data.days, review: data.totals.in_review })}
      />
      <CardBody>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.done_by_day} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--color-surface-2)" }}
                labelFormatter={(l) => shortDay(String(l))}
                formatter={(v) => [String(v), t("Tasks done")]}
                contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="count" fill="var(--color-accent)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

function BranchBlock({
  b,
  a,
  update,
  minutesFor,
  fx,
  canManage,
}: {
  b: BranchImpact;
  a: Assumptions;
  update: (p: Partial<Assumptions>) => void;
  minutesFor: (d: DeptImpact) => number;
  fx: number;
  canManage: boolean;
}) {
  const t = useT();
  // The count stays bold inside the translated "{n} done".
  const [doneBefore = "", doneAfter = ""] = t("{n} done").split("{n}");
  const staffed = b.departments.filter((d) => d.agents).length;
  const unstaffed = b.departments.filter((d) => d.coverage === "none" && !d.tasks_done && !d.tasks_failed);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] text-white" style={{ background: b.color }}>
            <BuildingsIcon size={18} weight="duotone" />
          </span>
        }
        title={<span className="break-words">{b.name}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 sm:gap-x-1.5">
            <Meta
              items={[
                t("{n} done", { n: b.tasks_done }),
                b.tasks_failed ? t("{n} failed", { n: b.tasks_failed }) : null,
                b.agents === 1 ? t("1 agent") : t("{n} agents", { n: b.agents }),
                t("{n} of {total} departments staffed", { n: staffed, total: b.departments.length }),
                t("AI {cost}", { cost: rm(b.usd * fx) }),
              ]}
            />
          </span>
        }
        actions={
          canManage && staffed < b.departments.length && !b.agents ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/organization">{t("Add AI team")}</Link>
            </Button>
          ) : undefined
        }
      />
      {b.departments.length ? (
        <ListCard className="rounded-none border-0">
          {b.departments.filter((d) => d.coverage !== "none" || d.tasks_done || d.tasks_failed).map((d) => {
            const c = COVERAGE[d.coverage];
            const h = (d.tasks_done * minutesFor(d)) / 60;
            return (
              <ListRow
                key={d.id}
                leading={<IconTile icon={d.coverage === "working" ? CheckCircleIcon : d.coverage === "ready" ? UsersThreeIcon : InfoIcon} tone={c.tile} size="sm" />}
                title={d.name}
                meta={
                  <Meta
                    items={[
                      d.agent_names.length ? d.agent_names.slice(0, 2).join(", ") + (d.agent_names.length > 2 ? ` +${d.agent_names.length - 2}` : "") : null,
                      d.labels.length ? d.labels.map((l) => `${l.label} ${l.count}`).join(", ") : null,
                      d.tasks_failed ? t("{n} failed", { n: d.tasks_failed }) : null,
                    ]}
                  />
                }
                trailing={
                  <>
                    <Pill tone={c.tone}>{t(c.label)}</Pill>
                    <span className="text-[12.5px] tabular text-muted">
                      {doneBefore}
                      <b className="font-semibold text-fg">{d.tasks_done}</b>
                      {doneAfter}
                      {d.tasks_done ? ` · ≈ ${hrs(h)}` : ""}
                    </span>
                    {a.mode === "department" && d.tasks_done ? (
                      <NumberInput
                        label={t("Minutes a person would take per {dept} task", { dept: d.name })}
                        value={a.deptMinutes[d.id] ?? null}
                        placeholder={String(a.minutes)}
                        suffix={t("min")}
                        className="w-24"
                        onChange={(v) => {
                          const next = { ...a.deptMinutes };
                          if (v === null) delete next[d.id];
                          else next[d.id] = v;
                          update({ deptMinutes: next });
                        }}
                      />
                    ) : null}
                  </>
                }
              />
            );
          })}
          {unstaffed.length ? (
            <ListRow
              leading={<IconTile icon={InfoIcon} tone="neutral" size="sm" />}
              title={<span className="font-normal text-muted">{t("No agent yet")}</span>}
              meta={<span className="break-words">{unstaffed.map((d) => d.name).join(", ")}</span>}
            />
          ) : null}
        </ListCard>
      ) : (
        <CardBody className="text-[13px] text-muted">{t("No departments yet.")}</CardBody>
      )}
    </Card>
  );
}

function AssumptionsCard({ data, a, update }: { data: Impact; a: Assumptions; update: (p: Partial<Assumptions>) => void }) {
  const t = useT();
  return (
    <Card>
      <CardHeader
        icon={<IconTile icon={SealCheckIcon} tone="neutral" size="sm" />}
        title={t("Assumptions behind the estimates")}
        description={t("Saved in this browser only. Set them to what the work really takes your people.")}
        actions={
          <Button variant="ghost" size="sm" onClick={() => update({ ...DEFAULTS })}>
            {t("Reset")}
          </Button>
        }
      />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LabeledNumber label={t("Minutes a person takes per task")} hint={t("Used wherever no specific value is set")} value={a.minutes} suffix={t("min")} onChange={(v) => update({ minutes: v ?? DEFAULTS.minutes })} />
          <LabeledNumber label={t("Staff cost per hour")} hint={t("Salary plus EPF, SOCSO and overheads")} value={a.rate} suffix="RM" step={0.5} onChange={(v) => update({ rate: v ?? DEFAULTS.rate })} />
          <LabeledNumber label={t("Time spent checking AI work")} hint={t("Reviewing and correcting, as % of time freed")} value={a.review} suffix="%" onChange={(v) => update({ review: Math.min(100, v ?? DEFAULTS.review) })} />
          <LabeledNumber label={t("Ringgit per US dollar")} hint={t("AI providers bill in US$")} value={a.fx} suffix="RM" step={0.01} onChange={(v) => update({ fx: v || DEFAULTS.fx })} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] font-medium">{t("Estimate minutes by")}</span>
          <Segmented
            label={t("Estimate by")}
            size="sm"
            value={a.mode}
            onChange={(m) => update({ mode: m })}
            options={[
              { value: "department", label: t("Department") },
              { value: "work_type", label: t("Work type"), count: data.work_types.length },
            ]}
          />
        </div>
        {a.mode === "work_type" ? (
          data.work_types.length ? (
            <ListCard>
              {data.work_types.map((w) => (
                <ListRow
                  key={w.label || "_none"}
                  title={w.label || t("No label")}
                  meta={t("{n} done", { n: w.count })}
                  trailing={
                    <NumberInput
                      label={w.label ? t("Minutes per {label} task", { label: w.label }) : t("Minutes per unlabelled task")}
                      value={a.labelMinutes[w.label] ?? null}
                      placeholder={String(a.minutes)}
                      suffix={t("min")}
                      className="w-24"
                      onChange={(v) => {
                        const next = { ...a.labelMinutes };
                        if (v === null) delete next[w.label];
                        else next[w.label] = v;
                        update({ labelMinutes: next });
                      }}
                    />
                  }
                />
              ))}
            </ListCard>
          ) : (
            <p className="text-[13px] text-muted">{t("No completed tasks in this period.")}</p>
          )
        ) : (
          <p className="text-[12.5px] text-muted">{t("Set minutes per department in the company cards above, next to each department that did work.")}</p>
        )}
      </CardBody>
    </Card>
  );
}

function LabeledNumber({
  label,
  hint,
  value,
  onChange,
  suffix,
  step,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  step?: number;
  placeholder?: string;
}) {
  return (
    <label className="grid min-w-0 content-start gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <NumberInput label={label} value={value} onChange={onChange} suffix={suffix} step={step} placeholder={placeholder} className="w-full" />
      {hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

function RoiCalculator({
  data,
  a,
  update,
  measuredHours,
  measuredAiRm,
}: {
  data: Impact;
  a: Assumptions;
  update: (p: Partial<Assumptions>) => void;
  measuredHours: number;
  measuredAiRm: number;
}) {
  const t = useT();
  const weeksPerMonth = 52 / 12;
  const measuredWeekly = Math.round((measuredHours / data.days) * 7 * 10) / 10;
  const measuredMonthlySpend = Math.round((measuredAiRm / data.days) * 30 * 100) / 100;
  const weekly = a.roiHours ?? measuredWeekly;
  const spend = a.roiSpend ?? measuredMonthlySpend;
  const value = weekly * weeksPerMonth * a.rate;
  const net = value - spend;
  const per = spend > 0 ? value / spend : null;
  return (
    <Card data-guide="impact.roi">
      <CardHeader
        icon={<IconTile icon={CalculatorIcon} tone="info" size="sm" />}
        title={t("Return on the AI spend")}
        description={t("Starts from what was measured; change any figure to plan ahead.")}
      />
      <CardBody className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2">
          <LabeledNumber
            label={t("Staff hours handled per week")}
            hint={t("Measured: {h}, after checking time", { h: hrs(measuredWeekly) })}
            value={a.roiHours}
            placeholder={String(measuredWeekly)}
            suffix={t("h")}
            step={0.5}
            onChange={(v) => update({ roiHours: v })}
          />
          <LabeledNumber
            label={t("AI spend per month")}
            hint={t("Measured: {cost} (this period scaled to 30 days)", { cost: rm(measuredMonthlySpend) })}
            value={a.roiSpend}
            placeholder={String(measuredMonthlySpend)}
            suffix="RM"
            step={10}
            onChange={(v) => update({ roiSpend: v })}
          />
          <LabeledNumber label={t("Staff cost per hour")} value={a.rate} suffix="RM" step={0.5} onChange={(v) => update({ rate: v ?? DEFAULTS.rate })} />
          {a.roiHours !== null || a.roiSpend !== null ? (
            <div className="flex items-end">
              <Button variant="outline" size="sm" onClick={() => update({ roiHours: null, roiSpend: null })}>
                {t("Back to measured")}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="grid content-start gap-3 rounded-[var(--radius-md)] bg-surface-2/50 p-4">
          <RoiLine label={t("Staff time freed per month")} value={`${hrs(weekly * weeksPerMonth)} × ${rm(a.rate)}`} result={rm(value)} />
          <RoiLine label={t("AI spend per month")} value="" result={`− ${rm(spend)}`} />
          <div className="border-t border-border pt-3">
            <RoiLine label={t("Net value per month (est.)")} value="" result={rm(net)} strong tone={net >= 0 ? "text-ok" : "text-danger"} />
          </div>
          <p className="text-[12.5px] text-muted">
            {per !== null
              ? t("About {value} of staff time for each RM 1 of AI spend.", { value: rm(per) })
              : t("No AI spend recorded for this period (free or local models), so a ratio is not meaningful.")}
          </p>
          <ul className="grid gap-1 text-[12px] text-muted">
            <li>• {t("A month is {weeks} weeks; hours are after the {pct}% checking time.", { weeks: weeksPerMonth.toFixed(2), pct: a.review })}</li>
            <li>• {t("Freed time is worth something only if people use it for other work; it is not a cut in headcount.")}</li>
            <li>• {t("AI spend is what providers billed (US$ × {fx}); your subscription or hosting costs are not included.", { fx: a.fx })}</li>
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function RoiLine({ label, value, result, strong, tone }: { label: string; value: string; result: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className={cn("min-w-0 text-[13px]", strong ? "font-semibold" : "text-muted")}>
        {label}
        {value ? <span className="block text-[12px] text-muted tabular">{value}</span> : null}
      </span>
      <span className={cn("tabular", strong ? "text-[18px] font-semibold" : "text-[14px] font-medium", tone)}>{result}</span>
    </div>
  );
}

function Capabilities({ branches, canManage }: { branches: BranchImpact[]; canManage: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: agents = [] } = useQuery(agentsQuery);
  const branchId = useBranch((s) => s.branchId);
  const [company, setCompany] = useState<string>(branchId && branches.some((b) => b.id === branchId) ? branchId : "any");
  const usable = useMemo(
    () => agents.filter((x) => x.status === "active" && !x.clone_of && !x.view_only && !x.private && !x.is_twin && (company === "any" || x.branch_id === company)),
    [agents, company],
  );
  const industries = new Set(branches.map((b) => b.industry));
  const shown = CAPABILITIES.filter((c) => !c.industry || industries.has(c.industry) || agents.some((x) => c.match.test(`${x.role} ${x.department_name ?? ""}`)));
  return (
    <Section
      title={t("What your AI team can do")}
      description={t("Try it opens a new task with an example brief for the right agent. Nothing runs until you create the task, and it waits for your review when done.")}
      actions={
        branches.length > 1 ? (
          <Select
            label={t("Company for Try it")}
            size="sm"
            value={company}
            onValueChange={setCompany}
            className="max-sm:w-full"
            options={[{ value: "any", label: t("Any company") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        ) : undefined
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((c, i) => {
          const agent = agentFor(c, usable, company === "any" ? branchId : company);
          return (
            <Card key={c.key} className="flex flex-col">
              <div className="flex items-start gap-3 px-4 pt-4">
                <IconTile icon={c.icon} tone={c.tone} />
                <div className="min-w-0">
                  <h3 className="text-[14.5px] font-semibold">{t(c.title)}</h3>
                  <p className="text-[12.5px] break-words text-muted">{agent ? `${agent.name}, ${agent.branch_name}` : t("No agent for this yet")}</p>
                </div>
              </div>
              <ul className="grid flex-1 gap-1.5 px-4 py-3 text-[13px]">
                {c.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <CheckCircleIcon size={15} weight="fill" className="mt-0.5 shrink-0 text-accent" />
                    <span className="min-w-0">{t(p)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                <Button
                  data-guide={i === 0 ? "impact.try" : undefined}
                  size="sm"
                  variant={agent ? "primary" : "outline"}
                  onClick={() => navigate({ to: "/tasks", search: { new: 1, agent: agent?.id, brief: t(c.example) } })}
                >
                  {t("Try it")} <ArrowRightIcon size={14} weight="bold" />
                </Button>
                {!agent && canManage ? (
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/organization">{t("Add a ready-made team")}</Link>
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

function ApprovalsAndLearning({ data }: { data: Impact }) {
  const t = useT();
  const ap = data.approvals;
  const sk = data.skills;
  return (
    <Card>
      <CardHeader icon={<IconTile icon={BrainIcon} tone="violet" size="sm" />} title={t("Approvals and learning")} description={t("Last {n} days.", { n: data.days })} />
      <ListCard className="rounded-none border-0">
        <ListRow
          leading={<IconTile icon={SealCheckIcon} tone="ok" size="sm" />}
          title={t("Decisions on agents' requests")}
          meta={<Meta items={[t("{n} approved", { n: ap.approved }), t("{n} denied", { n: ap.denied }), ap.answered ? t("{n} questions answered", { n: ap.answered }) : null]} />}
          trailing={<span className="text-[13px] tabular">{ap.decided}</span>}
        />
        <ListRow
          leading={<IconTile icon={ClockCountdownIcon} tone="violet" size="sm" />}
          title={t("Time to a decision")}
          meta={ap.average_minutes !== null ? t("Average {time}", { time: mins(ap.average_minutes) }) : t("No decisions yet")}
          trailing={<span className="text-[13px] tabular">{t("{time} median", { time: mins(ap.median_minutes) })}</span>}
        />
        <ListRow
          leading={<IconTile icon={ClipboardTextIcon} tone={ap.pending ? "warn" : "neutral"} size="sm" />}
          title={t("Waiting for a person now")}
          trailing={
            ap.pending ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/approvals">{t("{n} to decide", { n: ap.pending })}</Link>
              </Button>
            ) : (
              <span className="text-[13px] text-muted">{t("None")}</span>
            )
          }
        />
        <ListRow
          leading={<IconTile icon={LightningIcon} tone="pink" size="sm" />}
          title={t("Skills the office has")}
          meta={<Meta items={[t("{n} learned and approved by people", { n: sk.learned }), sk.learned_in_window ? t("{n} new this period", { n: sk.learned_in_window }) : null, t("{n} uses", { n: sk.uses_in_window })]} />}
          trailing={<span className="text-[13px] tabular">{sk.active}</span>}
        />
      </ListCard>
    </Card>
  );
}

function SafetyPanel({ canAudit }: { canAudit: boolean }) {
  const t = useT();
  const items: { icon: Icon; title: string; body: string; link?: { to: "/approvals" | "/activity" | "/ai-engine"; label: string } }[] = [
    {
      icon: SealCheckIcon,
      title: msg("People approve what matters"),
      body: msg("Money, messages to customers, submissions and anything that leaves the company wait for a person. Ready-made agents start on 'ask first'."),
      link: { to: "/approvals", label: msg("Approvals") },
    },
    {
      icon: ClipboardTextIcon,
      title: msg("Every change is on record"),
      body: msg("A tamper-evident log of what people and agents did, and finished work waits in Review before it counts as done."),
      link: canAudit ? { to: "/activity", label: msg("Activity log") } : undefined,
    },
    {
      icon: CoinsIcon,
      title: msg("Spending has limits"),
      body: msg("Per-agent budgets alert at 80% and pause the agent at 100% until someone raises the limit."),
      link: { to: "/ai-engine", label: msg("AI spend") },
    },
    {
      icon: ShieldCheckIcon,
      title: msg("AI can be wrong"),
      body: msg("Agents show their workings and the finance tools show their formulas so you can check them. Treat forecasts as ranges, not promises."),
    },
  ];
  return (
    <Card>
      <CardHeader icon={<IconTile icon={ShieldCheckIcon} tone="ok" size="sm" />} title={t("How it stays safe")} />
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
        {items.map((it) => (
          <li key={it.title} className="flex items-start gap-3 px-4 py-3 sm:px-5">
            <it.icon size={18} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
            <div className="grid min-w-0 gap-0.5">
              <span className="text-[13.5px] font-medium">{t(it.title)}</span>
              <span className="text-[12.5px] text-muted">{t(it.body)}</span>
              {it.link ? (
                <Link to={it.link.to} className="inline-flex min-h-9 items-center text-[12.5px] font-medium text-accent hover:underline">
                  {t(it.link.label)}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
