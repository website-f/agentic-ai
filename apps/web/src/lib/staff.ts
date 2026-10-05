/** Staff onboarding ("hire your AI worker") and the staff home (P19). */
import { queryOptions } from "@tanstack/react-query";

import { locale, msg, t } from "@/i18n";

import { api } from "./api";
import type { Agent, TaskStatus } from "./work";

export interface Break {
  start: string;
  end: string;
}

/** An agent's working hours (agents.work_hours). Days are ISO weekdays, Mon=1 .. Sun=7. */
export interface WorkHours {
  tz: string;
  days: number[];
  start: string;
  end: string;
  breaks: Break[];
  urgent_anytime: boolean;
}

export interface Duty {
  state: "working" | "break" | "off" | "always";
  on: boolean;
  until: string | null;
  label: string;
}

export interface Company {
  id: string;
  name: string;
  color: string;
  industry: string;
  departments: { id: string; name: string }[];
}

export interface StaffState {
  eligible: boolean;
  role: string;
  person: { name: string; first_name: string };
  workspace: { name: string; timezone: string };
  onboarding: { done?: boolean; at?: string; agent_id?: string };
  placement: {
    branch_id: string | null;
    branch_name: string | null;
    department_id: string | null;
    department_name: string | null;
    branch_locked: boolean;
    department_locked: boolean;
    can_choose: boolean;
  };
  companies: Company[];
  twin: Agent | null;
  blueprints: { id: string; name: string; description: string; role: string }[];
  workflows: { id: string; name: string; description: string; status: string; steps: number; following: boolean }[];
  default_hours: WorkHours;
}

export interface DutyIn {
  title: string;
  brief: string;
  when: string;
  urgent: boolean;
}

export interface HireIn {
  blueprint_id: string | null;
  workflow_ids: string[];
  duties: DutyIn[];
  work_hours: WorkHours;
  first_task: { title: string; brief: string; urgent: boolean } | null;
}

export interface HireOut {
  twin: Agent;
  duties: { id: string; title: string; summary: string }[];
  first_task: { id: string; title: string; status: TaskStatus; starts_at: string | null; note: string | null } | null;
  warnings: string[];
}

export type WhenRead = { ok: true; cron: string; summary: string; first: string } | { ok: false; question: string };

export interface WorkerTask {
  id: string;
  title: string;
  status: TaskStatus;
  kind: "done" | "working" | "waiting" | "queued" | "review" | "failed" | "cancelled";
  priority: string;
  note: string | null;
  source: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface WorkerHome {
  eligible: boolean;
  person: { name: string; first_name: string };
  onboarding: StaffState["onboarding"];
  twin: Agent | null;
  now?: string;
  timezone?: string;
  duty?: Duty;
  hours_label?: string;
  today?: WorkerTask[];
  upcoming?: { id: string; title: string; at: string; starts_at: string }[];
  waiting?: {
    approvals: { id: string; kind: string; tool_name: string; reason: string; task_id: string; task_title: string; created_at: string }[];
    reviews: WorkerTask[];
  };
  duties?: { id: string; title: string; brief: string; cron: string; enabled: boolean; urgent: boolean; next_run: string | null; last_run_at: string | null }[];
  workflows?: { id: string; name: string; status: string }[];
  blueprint?: string | null;
  counts?: { done_today: number; open: number; waiting: number };
}

export const staffKeys = { state: ["me", "staff"] as const, worker: ["me", "worker"] as const };

export const staffQuery = queryOptions({
  queryKey: staffKeys.state,
  queryFn: () => api<StaffState>("/api/me/staff"),
  staleTime: 10_000,
});

export const workerQuery = queryOptions({
  queryKey: staffKeys.worker,
  queryFn: () => api<WorkerHome>("/api/me/worker"),
  refetchInterval: 30_000,
});

export const setPlacement = (branch_id: string, department_id: string | null) =>
  api<StaffState>("/api/me/placement", "PUT", { branch_id, department_id });

export const readWhen = (text: string) => api<WhenRead>(`/api/me/worker/when?text=${encodeURIComponent(text)}`);

export const hireWorker = (body: HireIn) => api<HireOut>("/api/me/worker/hire", "POST", body);

export const addDuty = (d: DutyIn) => api<{ id: string; summary: string; warning: string | null }>("/api/me/worker/duties", "POST", d);

export const setWorkflows = (workflow_ids: string[]) => api<{ changed: string[] }>("/api/me/worker/workflows", "PUT", { workflow_ids });

export const saveHours = (agentId: string, work_hours: WorkHours | null) => api<Agent>(`/api/agents/${agentId}`, "PATCH", { work_hours });

/* ------------------------------------------------------------ hours, on the client */

/** English keys (they also match Intl's en-US weekday names): render with t(). */
export const DAY_SHORT = [msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat"), msg("Sun")] as const;

export const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function daysLabel(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return t("Every day");
  if (!d.length) return t("No days");
  const run = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  if (run) return `${t(DAY_SHORT[d[0]! - 1]!)}–${t(DAY_SHORT[d[d.length - 1]! - 1]!)}`;
  return d.map((x) => t(DAY_SHORT[x - 1]!)).join(", ");
}

/** The same one-liner the server writes: "Mon–Fri 09:00–18:00, lunch 13:00–14:00". */
export function describeHours(wh: WorkHours): string {
  let out = `${daysLabel(wh.days)} ${wh.start}–${wh.end}`;
  wh.breaks.forEach((b, i) => {
    const lunch = i === 0 && mins(b.start) >= 660 && mins(b.start) <= 900;
    out += `, ${lunch ? t("lunch {start}–{end}", { start: b.start, end: b.end }) : t("break {start}–{end}", { start: b.start, end: b.end })}`;
  });
  return out;
}

/** What is wrong with the hours, in words, or null (mirrors agents/work_hours.clean). */
export function hoursProblem(wh: WorkHours): string | null {
  if (!wh.days.length) return t("Pick at least one working day.");
  if (mins(wh.start) >= mins(wh.end)) return t("The day must end after it starts (overnight shifts are not supported).");
  const sorted = [...wh.breaks].sort((a, b) => mins(a.start) - mins(b.start));
  for (const b of sorted) {
    if (mins(b.start) >= mins(b.end)) return t("The break {start}–{end} must end after it starts.", { start: b.start, end: b.end });
    if (mins(b.start) < mins(wh.start) || mins(b.end) > mins(wh.end)) return t("The break {start}–{end} must be inside the working day.", { start: b.start, end: b.end });
  }
  for (let i = 1; i < sorted.length; i++) if (mins(sorted[i]!.start) < mins(sorted[i - 1]!.end)) return t("Breaks must not overlap.");
  return null;
}

/** Local time in a time zone, "14:05". */
export function clock(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toTimeString().slice(0, 5);
  }
}

/* ------------------------------------------------------------ the login choice */

export type LoginPath = "staff" | "manager";
const LOGIN_KEY = "agentic.login-path";

export function lastLoginPath(): LoginPath {
  try {
    return window.localStorage.getItem(LOGIN_KEY) === "manager" ? "manager" : "staff";
  } catch {
    return "staff";
  }
}

export function rememberLoginPath(p: LoginPath): void {
  try {
    window.localStorage.setItem(LOGIN_KEY, p);
  } catch {
    // private mode / blocked storage: the choice is just not remembered
  }
}
