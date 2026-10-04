/** My AI twin (P18): a staff member's one agent, their virtual self at work. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";
import type { Agent } from "./work";

export type Tone = "friendly" | "professional" | "brief" | "detailed";

/** The wizard's answers. */
export interface TwinAnswers {
  name: string;
  role: string;
  job: string;
  style: string;
  tone: Tone;
  languages: string[];
  helps_with: string[];
  ask_first: string[];
  hours: string;
  heartbeat: boolean;
  color: string;
}

export interface TwinOption {
  key: string;
  label: string;
  hint: string;
  locked?: boolean;
}

export interface TwinState {
  eligible: boolean;
  can_create: boolean;
  twin: Agent | null;
  profile: Partial<TwinAnswers> | null;
  adoptable: { id: string; name: string; role: string; color: string; status: string }[];
  suggested: TwinAnswers;
  person: {
    name: string;
    first_name: string;
    initials: string;
    email: string;
    role: string;
    branch_name: string | null;
    department_name: string | null;
  };
  sops: { id: string; title: string; scope: string; scope_label: string }[];
  options: {
    helps_with: TwinOption[];
    ask_first: TwinOption[];
    tones: TwinOption[];
    languages: string[];
    hours: string[];
    colors: string[];
  };
  polished?: boolean;
}

export interface TwinPreview {
  soul: string;
  polished: boolean;
  tools: Record<string, string>;
  facts: string[];
}

export const twinKeys = { me: ["me", "twin"] as const };

export const twinQuery = queryOptions({
  queryKey: twinKeys.me,
  queryFn: () => api<TwinState>("/api/me/twin"),
  staleTime: 30_000,
});

/** Starting answers for the wizard: what was saved, else what the twin is, else suggestions. */
export function startingAnswers(s: TwinState): TwinAnswers {
  const base = { ...s.suggested, ...(s.profile ?? {}) } as TwinAnswers;
  if (s.twin && !s.profile) {
    base.name = s.twin.name;
    base.role = s.twin.role;
    base.color = s.twin.color;
    base.heartbeat = s.twin.heartbeat;
  }
  return base;
}

export const saveTwin = (answers: TwinAnswers & { polish?: boolean }, update: boolean) =>
  api<TwinState>("/api/me/twin", update ? "PATCH" : "POST", answers);

export const previewTwin = (answers: TwinAnswers & { polish?: boolean }) =>
  api<TwinPreview>("/api/me/twin/preview", "POST", answers);

export const adoptTwin = (agentId: string) => api<TwinState>("/api/me/twin/adopt", "POST", { agent_id: agentId });

export const teachTwin = (text: string, target: "user" | "memory") =>
  api<{ user: string[]; memory: string[] }>("/api/me/twin/teach", "POST", { text, target });

/** People who have a twin: their role has agents.own. Managers (agents.manage) add agents instead. */
export const staffOnly = (perms: string[]) => perms.includes("agents.own") && !perms.includes("agents.manage");
