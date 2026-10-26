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

export const allowanceKeys = {
  mine: ["allowance", "me"] as const,
  all: ["allowance", "all"] as const,
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
  queryFn: () => api<{ policy: AllowancePolicy; people: PersonAllowance[] }>("/api/allowances"),
  refetchInterval: 60_000,
});

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
