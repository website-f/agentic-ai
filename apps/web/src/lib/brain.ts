/** Types and queries for the Brain (P3): pages, facts, search, graph, dreams, core memory. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export type PageKind = "wiki" | "decision" | "raw" | "log" | "agent" | "dream" | "root" | "skill";

export interface PageSummary {
  path: string;
  title: string;
  kind: PageKind;
  branch_id: string | null;
  updated_at: string;
  updated_by: string;
  updated_by_name: string;
  chars: number;
}

export interface PageLink {
  name: string;
  path: string | null;
  title: string | null;
}

export interface PageCommit {
  commit: string;
  author: string;
  message: string;
  ts: number;
}

export interface BrainPage extends PageSummary {
  body: string;
  frontmatter: Record<string, string | string[]>;
  links: PageLink[];
  backlinks: PageLink[];
  history: PageCommit[];
}

export interface Fact {
  id: string;
  text: string;
  branch_id: string | null;
  branch_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  source_kind: "task" | "chat" | "person" | "agent" | "dream";
  source_id: string | null;
  source_label: string | null;
  created_by: string;
  created_by_name: string;
  confidence: number;
  hits: number;
  last_used_at: string | null;
  valid_from: string;
  valid_to: string | null;
  end_reason: "replaced" | "merged" | "contradicted" | "forgotten" | null;
  superseded_by: string | null;
}

export interface Hit {
  kind: "page" | "fact" | "message";
  id: string;
  title: string;
  snippet: string;
  score: number;
  via: ("keyword" | "meaning" | "link")[];
  path: string | null;
  when: string | null;
  meta: Record<string, unknown>;
}

export interface SearchResult {
  facts: Hit[];
  pages: Hit[];
  history: Hit[];
  vectors: boolean;
  took_ms: number;
}

export interface DreamChange {
  kind: "merge" | "contradiction" | "import" | "conflict";
  ended?: string;
  ended_text?: string;
  kept?: string;
  kept_text?: string;
  similarity?: number;
  undone?: boolean;
  path?: string;
}

export interface Dream {
  id: string;
  day: string;
  status: "running" | "done" | "failed";
  stats: {
    facts_learned?: number;
    pages_changed?: number;
    active_facts?: number;
    pairs_checked?: number;
    pairs_judged?: number;
    judge_skipped?: string;
    vault?: { imported: number; deleted: number; conflicts: number };
  };
  changes: DreamChange[];
  diary_path: string | null;
  diary?: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Overview {
  pages: number;
  facts: number;
  links: number;
  last_dream: Dream | null;
  dream_hour: number;
  timezone: string;
  search: { backend: string; model: string | null; vectors: boolean };
  vault: { folder: string };
}

export interface GraphData {
  nodes: { id: string; path: string; title: string; kind: PageKind; degree: number }[];
  edges: { source: string; target: string }[];
  unresolved: string[];
}

export interface CoreMemory {
  memory: string[];
  user: string[];
  caps: { memory: number; user: number };
  used: { memory: number; user: number };
  snapshot: string;
}

export const brainKeys = {
  all: ["brain"] as const,
  overview: ["brain", "overview"] as const,
  pages: ["brain", "pages"] as const,
  page: (path: string) => ["brain", "page", path] as const,
  facts: (params: Record<string, string>) => ["brain", "facts", params] as const,
  graph: ["brain", "graph"] as const,
  search: (q: string, history: boolean) => ["brain", "search", q, history] as const,
  dreams: ["brain", "dreams"] as const,
  dream: (id: string) => ["brain", "dreams", id] as const,
  core: (agentId: string) => ["brain", "core", agentId] as const,
  agentFacts: (agentId: string) => ["brain", "agent-facts", agentId] as const,
};

export const overviewQuery = queryOptions({ queryKey: brainKeys.overview, queryFn: () => api<Overview>("/api/brain/overview") });
export const pagesQuery = queryOptions({ queryKey: brainKeys.pages, queryFn: () => api<PageSummary[]>("/api/brain/pages") });
export const pageQuery = (path: string) =>
  queryOptions({ queryKey: brainKeys.page(path), queryFn: () => api<BrainPage>(`/api/brain/page?path=${encodeURIComponent(path)}`) });
export const factsQuery = (params: Record<string, string>) =>
  queryOptions({
    queryKey: brainKeys.facts(params),
    queryFn: () => api<{ total: number; items: Fact[] }>(`/api/brain/facts?${new URLSearchParams(params)}`),
  });
export const graphQuery = queryOptions({ queryKey: brainKeys.graph, queryFn: () => api<GraphData>("/api/brain/graph") });
export const searchQuery = (q: string, history: boolean) =>
  queryOptions({
    queryKey: brainKeys.search(q, history),
    queryFn: () => api<SearchResult>(`/api/brain/search?${new URLSearchParams({ q, history: String(history) })}`),
    enabled: q.trim().length > 1,
    staleTime: 30_000,
  });
export const dreamsQuery = queryOptions({ queryKey: brainKeys.dreams, queryFn: () => api<Dream[]>("/api/brain/dreams") });
export const dreamQuery = (id: string) => queryOptions({ queryKey: brainKeys.dream(id), queryFn: () => api<Dream>(`/api/brain/dreams/${id}`) });
export const coreMemoryQuery = (agentId: string) =>
  queryOptions({ queryKey: brainKeys.core(agentId), queryFn: () => api<CoreMemory>(`/api/agents/${agentId}/memory`) });
export const agentFactsQuery = (agentId: string) =>
  queryOptions({ queryKey: brainKeys.agentFacts(agentId), queryFn: () => api<Fact[]>(`/api/agents/${agentId}/facts`) });

/** Folder labels and colours. Colours follow the categorical series in fixed order. */
export const KIND_INFO: Record<PageKind, { label: string; color: string }> = {
  wiki: { label: "Knowledge", color: "var(--series-1)" },
  decision: { label: "Decision", color: "var(--series-2)" },
  raw: { label: "Source", color: "var(--series-3)" },
  agent: { label: "Agent memory", color: "var(--series-4)" },
  skill: { label: "Skill", color: "var(--series-7)" },
  root: { label: "Vault file", color: "var(--series-other)" },
  log: { label: "Log", color: "var(--series-other)" },
  dream: { label: "Dream diary", color: "var(--series-other)" },
};

export const END_REASON: Record<NonNullable<Fact["end_reason"]>, string> = {
  replaced: "Replaced",
  merged: "Merged as duplicate",
  contradicted: "Contradicted",
  forgotten: "Forgotten",
};

export function factScope(f: Fact): string {
  if (f.agent_name) return `Private to ${f.agent_name}`;
  if (f.branch_name) return f.branch_name;
  return "Every company";
}
