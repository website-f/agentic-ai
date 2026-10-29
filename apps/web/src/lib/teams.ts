/** Types and queries for teams and governance (P7): meetings, schedules and their ledger,
 * incidents, pings and budgets. */
import { queryOptions } from "@tanstack/react-query";

import { locale, t } from "@/i18n";

import { api } from "./api";

export interface MeetingOutcome {
  decision: string;
  rationale: string;
  options: string[];
  dissent: string[];
  actions: { owner: string; action: string }[];
}

export interface MeetingTurn {
  id: number;
  round: number;
  speaker: string;
  name: string;
  kind: "turn" | "human" | "outcome" | "system";
  content: string;
  tokens: number;
  created_at: string;
}

export interface Meeting {
  id: string;
  topic: string;
  status: "running" | "done" | "failed" | "cancelled";
  participants: { id: string; name: string; color: string; role: string }[];
  initiator_agent_id: string | null;
  started_by: string;
  task: { id: string; title: string } | null;
  max_rounds: number;
  rounds_done: number;
  token_budget: number;
  tokens_used: number;
  outcome: MeetingOutcome | null;
  decision_path: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  turns?: MeetingTurn[];
}

export interface Schedule {
  id: string;
  name: string;
  agent_id: string;
  agent_name: string;
  agent_color: string;
  title: string;
  brief: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  requires_review: boolean;
  last_run_at: string | null;
  last_status: RunStatus | null;
  next_runs: string[];
  created_at: string;
  /** Who set it up: a person on the Schedules page, or the agent itself when a person asked
   * it in chat or a task ("set up by Aina from chat"). One-offs switch off after firing. */
  origin?: { via: "page" | "chat" | "task" | "other"; person_name: string | null; by_agent: boolean; once: boolean };
}

export type RunStatus = "claimed" | "running" | "completed" | "failed";

export interface JobRun {
  id: number;
  job: "schedule" | "heartbeat" | string;
  schedule_id: string | null;
  schedule_name: string | null;
  status: RunStatus;
  task_id: string | null;
  task_title: string | null;
  attempt: number;
  error: string | null;
  detail: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
}

export interface Incident {
  id: number;
  signature: string;
  title: string;
  count: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
}

export interface SystemJob {
  id: string;
  description: string;
  reachable: boolean;
  paused: boolean | null;
  next: string[];
  recent: { scheduled_at: string; started_at: string }[];
  last_logged: string | null;
}

export interface Ping {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_color: string;
  kind: "idle" | "budget_alert";
  message: string;
  created_at: string;
  resolved_at: string | null;
}

export interface BudgetState {
  tokens_today: number;
  token_limit: number | null;
  usd_month: number;
  usd_limit: number | null;
  token_ratio: number;
  usd_ratio: number;
  over: boolean;
  near: boolean;
  day: string;
  month: string;
}

export interface AgentBudget extends BudgetState {
  by_day: { day: string; tokens: number; usd: number }[];
}

export interface BudgetRow extends BudgetState {
  agent_id: string;
  name: string;
  color: string;
}

export const teamKeys = {
  meetings: ["meetings"] as const,
  meeting: (id: string) => ["meetings", id] as const,
  schedules: ["schedules"] as const,
  runs: (job?: string) => ["runs", job ?? "all"] as const,
  incidents: ["incidents"] as const,
  systemJobs: ["system-jobs"] as const,
  pings: ["pings"] as const,
  budgets: ["budgets"] as const,
  agentBudget: (id: string) => ["budgets", id] as const,
};

export const meetingsQuery = queryOptions({ queryKey: teamKeys.meetings, queryFn: () => api<Meeting[]>("/api/meetings") });
export const meetingQuery = (id: string) =>
  queryOptions({ queryKey: teamKeys.meeting(id), queryFn: () => api<Meeting>(`/api/meetings/${id}`) });
export const schedulesQuery = queryOptions({ queryKey: teamKeys.schedules, queryFn: () => api<Schedule[]>("/api/schedules") });
export const runsQuery = (job?: string) =>
  queryOptions({ queryKey: teamKeys.runs(job), queryFn: () => api<JobRun[]>(`/api/runs${job ? `?job=${job}` : ""}`) });
export const incidentsQuery = queryOptions({ queryKey: teamKeys.incidents, queryFn: () => api<Incident[]>("/api/incidents") });
export const systemJobsQuery = queryOptions({ queryKey: teamKeys.systemJobs, queryFn: () => api<SystemJob[]>("/api/system-jobs") });
export const pingsQuery = queryOptions({ queryKey: teamKeys.pings, queryFn: () => api<Ping[]>("/api/pings") });
export const budgetsQuery = queryOptions({ queryKey: teamKeys.budgets, queryFn: () => api<BudgetRow[]>("/api/budgets") });
export const agentBudgetQuery = (id: string) =>
  queryOptions({ queryKey: teamKeys.agentBudget(id), queryFn: () => api<AgentBudget>(`/api/agents/${id}/budget`) });

export const RUN_TONE: Record<RunStatus, "neutral" | "accent" | "ok" | "danger"> = {
  claimed: "neutral",
  running: "accent",
  completed: "ok",
  failed: "danger",
};

// ---------------------------------------------------------------- schedules in plain words (P55)
// People pick "every Monday and Thursday at 9:00 am" (components/ui/schedule-picker); underneath
// it is a five-field cron line (minute hour day month weekday; weekday 0 = Sunday) that nobody
// types. Pure: these turn one into the other and into words, in the app's language.

export type Frequency = "once" | "daily" | "weekdays" | "weekly" | "monthly" | "hourly";

export interface SchedulePlan {
  /** "yearly" is only read back (a cron someone made elsewhere); the picker does not offer it. */
  freq: Frequency | "yearly";
  /** "HH:MM" (every few hours: not used, see `minute`). */
  time: string;
  /** Once: "YYYY-MM-DD", in the schedule's time zone. */
  date: string;
  /** Every week: cron weekdays, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Every month (and yearly): the day, 1–31 (the picker offers 1–28: every month has them). */
  monthDay: number;
  /** Yearly: 1–12. */
  month: number;
  /** Every few hours: 1, 2, 3, 4, 6, 8 or 12; the minute past the hour; the hours it runs
   * between (or all day); weekdays only. */
  every: number;
  minute: number;
  window: [number, number] | null;
  weekdaysOnly: boolean;
}

export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12];
/** Weekdays in the order people read a week here: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const pad = (n: number) => String(n).padStart(2, "0");
/** A local date as "YYYY-MM-DD". */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export function splitTime(time: string): [number, number] {
  const [h, m] = (time || "09:00").split(":").map(Number);
  return [clamp(h ?? 9, 0, 23), clamp(m ?? 0, 0, 59)];
}

/** A new schedule: weekdays at 9:00 am (a one-off defaults to tomorrow). */
export function defaultPlan(now = new Date()): SchedulePlan {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    freq: "weekdays", time: "09:00", date: isoDay(tomorrow), days: [1], monthDay: 1, month: 1,
    every: 2, minute: 0, window: [9, 17], weekdaysOnly: true,
  };
}

function weekdayField(days: number[]): string {
  const set = [...new Set(days.map((d) => d % 7))].sort((a, b) => a - b);
  if (set.length === 7) return "*";
  if (set.join() === "1,2,3,4,5") return "1-5";
  return set.join(",");
}

/** The cron line for a plan. */
export function planToCron(p: SchedulePlan): string {
  const [h, m] = splitTime(p.time);
  switch (p.freq) {
    case "once": {
      const [, month, day] = p.date.split("-").map(Number);
      return `${m} ${h} ${day ?? 1} ${month ?? 1} *`;
    }
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${weekdayField(p.days)}`;
    case "monthly":
      return `${m} ${h} ${p.monthDay} * *`;
    case "yearly":
      return `${m} ${h} ${p.monthDay} ${p.month} *`;
    case "hourly": {
      const step = p.every > 1 ? `/${p.every}` : "";
      const hours = p.window ? `${p.window[0]}-${p.window[1]}${step}` : p.every > 1 ? `*/${p.every}` : "*";
      return `${p.minute} ${hours} * * ${p.weekdaysOnly ? "1-5" : "*"}`;
    }
  }
}

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function num(s: string | undefined, lo: number, hi: number, names?: Record<string, number>): number | null {
  if (s === undefined) return null;
  const v = names?.[s.toLowerCase()] ?? (/^\d{1,2}$/.test(s) ? Number(s) : NaN);
  return Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

/** "1-5", "mon,thu", "0,6", "*" → cron weekdays 0–6; null for steps and nonsense. */
function weekdays(field: string): number[] | null {
  if (field === "*") return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [a, b, more] = part.split("-");
    const from = num(a, 0, 7, DOW);
    const to = b === undefined ? from : num(b, 0, 7, DOW);
    if (more !== undefined || from === null || to === null || to < from) return null;
    for (let d = from; d <= to; d++) out.add(d % 7);
  }
  return [...out].sort((x, y) => x - y);
}

/** The next date (from `after`) with this month and day: a one-off's cron has no year. */
function nextDate(month: number, day: number, h: number, m: number, after: Date): string {
  for (let y = after.getFullYear(); y <= after.getFullYear() + 4; y++) {
    const at = new Date(y, month - 1, day, h, m);
    if (at.getMonth() === month - 1 && at >= after) return isoDay(at);
  }
  return isoDay(new Date(after.getFullYear(), month - 1, day));
}

/**
 * A cron line back into a plan, or null when the picker cannot show it (it then stays as it
 * is, read-only). `once`: the schedule switches off after firing, so "30 16 5 11 *" is one
 * date (the next 5 Nov from `after`), not every year.
 */
export function parseCron(cron: string, once = false, after = new Date()): SchedulePlan | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi = "", ho = "", dom = "", mon = "", dow = ""] = f;
  const minute = num(mi, 0, 59);
  if (minute === null) return null;
  const base = defaultPlan(after);
  const hour = num(ho, 0, 23);
  if (hour === null) {
    // Every few hours: "*", "*/2", "9-17" or "9-17/2", every day or on weekdays.
    const m = /^(?:\*|(\d{1,2})-(\d{1,2}))(?:\/(\d{1,2}))?$/.exec(ho);
    if (!m || dom !== "*" || mon !== "*" || once) return null;
    const every = m[3] ? Number(m[3]) : 1;
    const window: [number, number] | null = m[1] !== undefined ? [Number(m[1]), Number(m[2])] : null;
    if (!EVERY_HOURS.includes(every) || (window && !(window[0] < window[1] && window[1] <= 23))) return null;
    const days = weekdays(dow);
    if (dow !== "*" && days?.join() !== "1,2,3,4,5") return null;
    return { ...base, freq: "hourly", every, minute, window, weekdaysOnly: dow !== "*" };
  }
  const time = `${pad(hour)}:${pad(minute)}`;
  if (mon !== "*") {
    const month = num(mon, 1, 12, MON);
    const day = num(dom, 1, 31);
    if (month === null || day === null || dow !== "*") return null;
    return once
      ? { ...base, freq: "once", time, date: nextDate(month, day, hour, minute, after) }
      : { ...base, freq: "yearly", time, month, monthDay: day };
  }
  if (once) return null;
  if (dom !== "*") {
    const day = num(dom, 1, 31);
    return day === null || dow !== "*" ? null : { ...base, freq: "monthly", time, monthDay: day };
  }
  const days = weekdays(dow);
  if (!days?.length) return null;
  if (days.length === 7) return { ...base, freq: "daily", time };
  if (days.join() === "1,2,3,4,5") return { ...base, freq: "weekdays", time };
  return { ...base, freq: "weekly", time, days };
}

/** "9:00 am" / "9:00 PG": the clock as people here read it (12 or 24 hours by language). */
export function clockTime(time: string): string {
  const [h, m] = splitTime(time);
  return new Intl.DateTimeFormat(locale(), { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

/** "Monday" / "Isnin" (`d`: cron weekday, 0 = Sunday). */
export function weekdayName(d: number, width: "long" | "short" | "narrow" = "long"): string {
  return new Intl.DateTimeFormat(locale(), { weekday: width }).format(new Date(2024, 0, 7 + (d % 7))); // 7 Jan 2024: a Sunday
}

/** "Thu, 30 Oct 2026" (`year`) or "30 Oct" for a "YYYY-MM-DD". */
export function dayLabel(iso: string, year = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  const opts: Intl.DateTimeFormatOptions = year ? { weekday: "short", day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(locale(), opts).format(new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1));
}

/** A plan in words: "Every Monday and Thursday at 9:00 am". `full`: a one-off's weekday and year too. */
export function describePlan(p: SchedulePlan, full = false): string {
  const time = clockTime(p.time);
  switch (p.freq) {
    case "once":
      return t("Once on {date} at {time}", { date: dayLabel(p.date, full), time });
    case "daily":
      return t("Every day at {time}", { time });
    case "weekdays":
      return t("Every weekday at {time}", { time });
    case "weekly": {
      const days = WEEK_ORDER.filter((d) => p.days.includes(d)).map((d) => weekdayName(d));
      return t("Every {days} at {time}", { days: new Intl.ListFormat(locale(), { type: "conjunction" }).format(days), time });
    }
    case "monthly":
      return t("Every month on day {day} at {time}", { day: p.monthDay, time });
    case "yearly":
      return t("Every year on {date} at {time}", { date: dayLabel(`2000-${pad(p.month)}-${pad(p.monthDay)}`, false), time });
    case "hourly": {
      const n = p.every;
      if (!p.window) {
        if (p.weekdaysOnly) return n === 1 ? t("Every hour on weekdays") : t("Every {n} hours on weekdays", { n });
        return n === 1 ? t("Every hour") : t("Every {n} hours", { n });
      }
      const from = clockTime(`${p.window[0]}:${p.minute}`);
      const to = clockTime(`${p.window[1]}:${p.minute}`);
      if (p.weekdaysOnly) {
        return n === 1 ? t("Every hour between {from} and {to} on weekdays", { from, to }) : t("Every {n} hours between {from} and {to} on weekdays", { n, from, to });
      }
      return n === 1 ? t("Every hour between {from} and {to}", { from, to }) : t("Every {n} hours between {from} and {to}", { n, from, to });
    }
  }
}

/** Any schedule's timing in words; a cron line the picker did not make reads "Custom timing". */
export function describeCron(cron: string, once = false): string {
  const plan = parseCron(cron, once);
  return plan ? describePlan(plan) : t("Custom timing");
}

export function tokensShort(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
