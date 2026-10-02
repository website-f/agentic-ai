/** P9 data: the company overview, reports agents publish, and saved website logins. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export interface BranchStats {
  id: string;
  name: string;
  color: string;
  agents: number;
  working: number;
  waiting: number;
  helpers: number;
  tasks_created: number;
  tasks_done: number;
  tasks_failed: number;
  open: Record<"triage" | "ready" | "running" | "blocked" | "review", number>;
  approvals_pending: number;
  calls: number;
  tokens: number;
  cached_tokens: number;
  usd: number;
  reports: number;
  labels: { label: string; count: number }[];
  done_by_day: { day: string; count: number }[];
  issues: number;
}

export interface Issue {
  kind: "failed" | "waiting" | "incident" | "budget";
  branch_id: string | null;
  task_id?: string;
  agent_id?: string;
  title: string;
  detail: string;
  at: string;
}

export interface Overview {
  days: number;
  scope: { kind: string; label: string };
  generated_at: string;
  totals: {
    branches: number;
    agents: number;
    helpers: number;
    working: number;
    tasks_created: number;
    tasks_done: number;
    tasks_failed: number;
    open: number;
    approvals_pending: number;
    usd: number;
    tokens: number;
    reports: number;
  };
  office: { calls: number; tokens: number; usd: number } | null;
  labels: { label: string; count: number }[];
  branches: BranchStats[];
  top_agents: { id: string; name: string; role: string; color: string; branch_id: string; done: number; failed: number; usd: number }[];
  issues: Issue[];
}

export interface Summary {
  text: string;
  model: string | null;
  cached: boolean;
  generated_at: string;
}

export interface ReportTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface Report {
  id: string;
  title: string;
  summary: string;
  body: string | null;
  tables: ReportTable[] | null;
  table_count: number;
  row_count: number;
  labels: string[];
  agent_id: string | null;
  agent_name: string | null;
  agent_color: string | null;
  branch_id: string | null;
  branch_name: string | null;
  task_id: string | null;
  task_title: string | null;
  created_at: string;
}

export interface SavedLogin {
  id: string;
  name: string;
  hosts: string[];
  username_hint: string;
  branch_id: string | null;
  branch_name: string | null;
  owner_user_id: string | null;
  agent_ids: string[];
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  can_manage: boolean;
}

export const officeKeys = {
  overview: (days: number) => ["overview", days] as const,
  reports: ["reports"] as const,
  report: (id: string) => ["reports", id] as const,
  logins: ["vault", "logins"] as const,
};

export const overviewQuery = (days: number) =>
  queryOptions({
    queryKey: officeKeys.overview(days),
    queryFn: () => api<Overview>(`/api/overview?days=${days}`),
    refetchInterval: 30_000,
  });

export const reportsQuery = queryOptions({ queryKey: officeKeys.reports, queryFn: () => api<Report[]>("/api/reports") });
export const reportQuery = (id: string) =>
  queryOptions({ queryKey: officeKeys.report(id), queryFn: () => api<Report>(`/api/reports/${id}`) });
export const loginsQuery = queryOptions({ queryKey: officeKeys.logins, queryFn: () => api<SavedLogin[]>("/api/vault/logins") });

export function usdShort(n: number): string {
  if (!n) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
