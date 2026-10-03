/** Types and queries for Skills (P4): library, proposals, test cases, evals. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export interface SkillStats {
  uses: number;
  accepted: number;
  sent_back: number;
  failed: number;
  success_rate: number | null;
  avg_tokens: number | null;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: number;
  trust: "builtin" | "official" | "trusted";
  status: "active" | "retired";
  branch_id: string | null;
  agent_ids: string[];
  created_by: string;
  created_by_name: string;
  approved_by_name: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  stats: SkillStats;
  baseline_tokens: number | null;
  saved_pct: number | null;
  pending: number;
}

export interface EvalCaseResult {
  title: string;
  pass: boolean;
  failures: string[];
  output: string;
  tokens: number;
}

export interface EvalSuite {
  passed: number;
  total: number;
  tokens: number;
  cases: EvalCaseResult[];
  error?: string;
  version?: number;
}

export interface Checks {
  must_contain?: string[];
  must_not_contain?: string[];
  regex?: string;
  number?: { value: number; tolerance?: number };
  json_keys?: string[];
  rubric?: string;
}

export interface SkillDetail extends Skill {
  body: string;
  versions: { version: number; description: string; body: string; note: string | null; created_by_name: string; approved_by_name: string | null; created_at: string }[];
  uses: { agent_name: string; task_id: string | null; task_title: string | null; version: number; outcome: string | null; tokens: number | null; created_at: string }[];
  eval_cases: { id: string; title: string; input: string; checks: Checks }[];
  last_eval: EvalSuite | null;
  proposals: { id: string; kind: ProposalKind; status: string; created_at: string }[];
}

export type ProposalKind = "new" | "patch" | "merge" | "retire";

export interface ScanFinding {
  level: "block" | "warn";
  code: string;
  message: string;
}

/** A review-queue row (GET /api/skill-proposals), kept light: `body` is the first 1000
 *  characters, eval suites carry their counts with an empty `cases` list, and the current /
 *  merged skills come without bodies. The sheet loads ProposalDetail for everything. */
export interface Proposal extends Omit<ProposalDetail, "current" | "other" | "eval_cases"> {
  body_truncated: boolean;
  current: { version: number; description: string; status: string } | null;
  other: { name: string; description: string } | null;
  eval_case_count: number;
}

/** One proposal in full (GET /api/skill-proposals/{id}). */
export interface ProposalDetail {
  id: string;
  kind: ProposalKind;
  name: string;
  description: string;
  body: string;
  base_version: number | null;
  current: { version: number; description: string; body: string; status: string } | null;
  other: { name: string; description: string; body: string } | null;
  stale: boolean;
  reason: string;
  eval_cases: ({ title: string; input: string } & Checks)[];
  scan: ScanFinding[];
  eval: { new?: EvalSuite; old?: EvalSuite; old_version?: number } | null;
  proposed_by: string;
  proposed_by_name: string;
  agent_id: string | null;
  source_task: { id: string; title: string; tokens: number } | null;
  status: "pending" | "approved" | "rejected" | "superseded";
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export const skillKeys = {
  all: ["skills"] as const,
  list: (state: string) => ["skills", "list", state] as const,
  detail: (id: string) => ["skills", "detail", id] as const,
  proposals: (state: string) => ["skills", "proposals", state] as const,
  proposal: (id: string) => ["skills", "proposal", id] as const,
};

export const skillsQuery = (state: "active" | "retired" | "all" = "active") =>
  queryOptions({ queryKey: skillKeys.list(state), queryFn: () => api<Skill[]>(`/api/skills?state=${state}`) });
export const skillQuery = (id: string) =>
  queryOptions({ queryKey: skillKeys.detail(id), queryFn: () => api<SkillDetail>(`/api/skills/${id}`) });
export const proposalsQuery = (state: "pending" | "decided" | "all" = "pending") =>
  queryOptions({ queryKey: skillKeys.proposals(state), queryFn: () => api<Proposal[]>(`/api/skill-proposals?state=${state}`) });
export const proposalQuery = (id: string) =>
  queryOptions({ queryKey: skillKeys.proposal(id), queryFn: () => api<ProposalDetail>(`/api/skill-proposals/${id}`) });

export const KIND_LABEL: Record<ProposalKind, string> = { new: "New skill", patch: "Update", merge: "Merge", retire: "Retire" };
export const TRUST_LABEL: Record<Skill["trust"], string> = { builtin: "Built in", official: "Official", trusted: "Learned" };

export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : `${Math.round(n * 100)}%`;
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}
