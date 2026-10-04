/** Types and queries for teams and governance (P7): meetings, schedules and their ledger,
 * incidents, pings and budgets. */
import { queryOptions } from "@tanstack/react-query";

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

/** Ready-made cron lines for the schedule form. Custom stays one click away. */
export const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: "Every weekday at 9:00", cron: "0 9 * * 1-5" },
  { label: "Every day at 18:00", cron: "0 18 * * *" },
  { label: "Every Monday at 9:00", cron: "0 9 * * 1" },
  { label: "Every Friday at 16:00", cron: "0 16 * * 5" },
  { label: "1st of every month at 9:00", cron: "0 9 1 * *" },
  { label: "Every hour, 9:00 to 17:00 on weekdays", cron: "0 9-17 * * 1-5" },
];

export function describeCron(cron: string): string {
  return CRON_PRESETS.find((p) => p.cron === cron)?.label ?? cron;
}

export function tokensShort(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
