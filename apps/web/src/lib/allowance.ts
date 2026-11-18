import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api";

/** P36: each person's daily AI allowance and the work-scope guard (api/routers/allowances.py). */
export interface Allowance {
  used: number;
  /** Including what managers gave today; null = no limit. */
  limit: number | null;
  remaining: number | null;
  extra: number;
  over: boolean;
  day: string;
  resets_at: string;
}

export interface PersonAllowance extends Allowance {
  user_id: string;
  name: string;
  email: string;
  role: string;
  /** The person's own setting: null = the default for their role, 0 = no limit. */
  own: number | null;
  /** P96: where they sit, today's cost and how much of the limit is used. */
  branch_id?: string | null;
  branch_name?: string | null;
  department_name?: string | null;
  cost_usd?: number;
  /** Percent of the limit used; null = no limit. */
  pct?: number | null;
  status?: AllowanceStatus;
  /** P114: of `extra`, what was given for every day of this week; tasks paused at the limit. */
  extra_week?: number;
  paused?: number;
}

export type AllowanceStatus = "ok" | "near" | "over" | "unlimited";

/** Everyone in scope, whatever the search (the stat tiles). */
export interface AllowanceSummary {
  people: number;
  over: number;
  near: number;
  used: number;
  cost_usd: number;
  /** P114: tasks waiting for more allowance. */
  paused?: number;
}

/** GET /api/allowances: with ?page= one page of people; total is the matching count. */
export interface AllowancesBody {
  policy: AllowancePolicy;
  people: PersonAllowance[];
  total?: number;
  summary?: AllowanceSummary;
}

export interface AllowancePolicy {
  daily_tokens: number;
  roles: string[];
  /** P51: the office's own daily pool, for work nobody asked for (0 = no limit). */
  office_daily_tokens?: number;
}

export interface WorkScope {
  enabled: boolean;
  roles: string[];
  about: string;
}

export interface Refusal {
  at: string;
  user_id: string | null;
  name: string;
  where: string;
  text: string;
  why: string;
}

/** P114: a task paused because the person it is for used up today's allowance. */
export interface PausedTask {
  approval_id: string;
  task_id: string;
  title: string;
  user_id: string;
  /** Whose allowance it is: the person who started the work. */
  name: string;
  agent_id: string | null;
  /** Their AI, by whatever name they gave it, and whose AI it is. */
  agent_name: string | null;
  agent_owner_name: string | null;
  used: number;
  limit: number;
  paused_at: string;
  /** 1 = paused first (more allowance starts them in this order). */
  order: number;
}

export type GiveSpan = "today" | "week";

export interface GiveResult {
  person: PersonAllowance;
  given: number;
  span: GiveSpan;
  ends_at: string;
  resumed: number;
}

export const allowanceKeys = {
  mine: ["allowance", "me"] as const,
  all: ["allowance", "all"] as const,
  paused: ["allowance", "paused"] as const,
  scope: ["work-scope"] as const,
  refusals: ["work-scope", "refusals"] as const,
};

export const myAllowanceQuery = queryOptions({
  queryKey: allowanceKeys.mine,
  queryFn: () => api<Allowance>("/api/me/allowance"),
  refetchInterval: 60_000,
});

export const allowancesQuery = queryOptions({
  queryKey: allowanceKeys.all,
  queryFn: () => api<AllowancesBody>("/api/allowances"),
  refetchInterval: 60_000,
});

/** P114: people managers only (the API refuses others). */
export const pausedQuery = queryOptions({
  queryKey: allowanceKeys.paused,
  queryFn: () => api<PausedTask[]>("/api/allowances/paused"),
  refetchInterval: 60_000,
});

export const giveAllowance = (userId: string, tokens: number, span: GiveSpan) =>
  api<GiveResult>(`/api/allowances/${userId}/give`, "POST", { tokens, span });

export const workScopeQuery = queryOptions({
  queryKey: allowanceKeys.scope,
  queryFn: () => api<WorkScope>("/api/work-scope"),
});

export const refusalsQuery = queryOptions({
  queryKey: allowanceKeys.refusals,
  queryFn: () => api<Refusal[]>("/api/work-scope/refusals"),
});

/** 48,200 -> "48.2k". */
export function tokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}
