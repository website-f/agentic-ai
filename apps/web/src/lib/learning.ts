/** The learning engine (P17): what agents learned, how it was checked, and what it cost. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import type { ProposalKind } from "./skills";

export type LearningMode = "review" | "auto_safe" | "auto";
export type ProposalStatus = "pending" | "approved" | "rejected" | "superseded";
export type FactSource = "task" | "chat" | "person" | "agent" | "dream";

export interface LearningDecision {
  id: string;
  skill_id: string | null;
  name: string;
  kind: ProposalKind;
  status: ProposalStatus;
  reason: string;
  proposed_by: string;
  decided_by: string | null;
  auto: boolean;
  note: string | null;
  /** [passed, total] for the proposed text and for the version it replaces. */
  eval: { new: [number, number] | null; old: [number, number] | null; error?: string | null } | null;
  created_at: string;
  decided_at: string | null;
}

export interface LearningOverview {
  days: number;
  mode: LearningMode;
  /** P19: a reviewer reads real work before it is handed in. */
  self_check: boolean;
  modes: { key: LearningMode; label: string }[];
  can_configure: boolean;
  proposals: {
    created: number;
    by_status: Partial<Record<ProposalStatus, number>>;
    approved_auto: number;
    approved_human: number;
    waiting: number;
    eval_pass_rate: number | null;
  };
  skills: { active: number; new_versions: number };
  uses: { total: number; accepted: number; sent_back: number; failed: number; success_rate: number | null; prev_success_rate: number | null };
  facts: { learned: number; by_source: Partial<Record<FactSource, number>>; replaced: number };
  spend: { calls: number; tokens: number; cost_usd: number };
  series: { day: string; proposed: number; approved: number; facts: number }[];
  top_skills: { id: string; name: string; version: number; uses: number; success_rate: number | null }[];
  recent: LearningDecision[];
}

export interface LearnSourceIn {
  url?: string;
  file_id?: string;
  text?: string;
  focus: string;
  agent_id?: string;
}

export interface LearnSourceOut {
  id: string;
  name: string;
  kind: ProposalKind;
  status: string;
  reason: string;
}

export const LEARNING_RANGES = [7, 30, 90] as const;
export type LearningRange = (typeof LEARNING_RANGES)[number];

export const learningKeys = {
  all: ["learning"] as const,
  overview: (days: number) => ["learning", "overview", days] as const,
};

export const learningOverviewQuery = (days: LearningRange) =>
  queryOptions({ queryKey: learningKeys.overview(days), queryFn: () => api<LearningOverview>(`/api/learning/overview?days=${days}`) });

export const setLearningMode = (mode: LearningMode) => api<{ mode: LearningMode }>("/api/learning/settings", "PUT", { mode });
export const setSelfCheck = (self_check: boolean) => api<{ self_check: boolean }>("/api/learning/settings", "PUT", { self_check });
export const learnFromSource = (body: LearnSourceIn) => api<LearnSourceOut>("/api/learning/learn-source", "POST", body);
export const revertSkill = (id: string, version: number) =>
  api<{ id: string; name: string; version: number }>(`/api/skills/${id}/revert`, "POST", { version });

export const trajectoriesUrl = (days = 90, outcome: "accepted" | "all" = "accepted") =>
  `/api/learning/trajectories.jsonl?days=${days}&outcome=${outcome}`;

/** The autopilot writes "Approved automatically: ..." when it switches a change on by itself.
 *  Proposal payloads carry no raw `decided_by`, so the note is the marker. */
export function isAutoApproved(p: { status: string; decision_note: string | null }): boolean {
  return p.status === "approved" && !!p.decision_note?.startsWith("Approved automatically");
}

/** Plain explanation of each autopilot mode, shown under its label. */
export const MODE_HELP: Record<LearningMode, string> = {
  review: "Nothing changes how agents work until a person approves it. Safest, and the most to review.",
  auto_safe: "A change goes live by itself only when the safety scan is clean and its tests pass at least as well as the current version. The rest wait for you.",
  auto: "Also switches on clean changes that have no tests yet. Fastest; every change can still be rolled back.",
};
