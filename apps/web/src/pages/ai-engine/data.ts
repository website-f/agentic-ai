import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type Tier = "free" | "paid" | "local";
export type Health = "unknown" | "ok" | "degraded" | "down";

export interface Preset {
  id: string;
  name: string;
  base_url: string;
  tier: Tier;
  priority: number;
  key_url: string;
  key_check: string;
  key_check_fallback: string | null;
  suggested_models: string[];
  notes: string;
  primary: boolean;
}

export interface Provider {
  id: string;
  name: string;
  preset: string | null;
  base_url: string;
  key_hint: string;
  has_key: boolean;
  tier: Tier;
  priority: number;
  enabled: boolean;
  health: Health;
  cooling_seconds: number;
  last_test_at: string | null;
  last_test_result: { ok: boolean; summary: string; model: string | null; error_class: string | null } | null;
  model_count: number;
  recent_checks: { ts: string; ok: boolean; latency_ms: number | null }[];
}

export interface AIModel {
  id: string;
  provider_id: string;
  model_id: string;
  context_window: number | null;
  caps: Partial<Record<"tools" | "json" | "vision" | "embed" | "reasoning", boolean>>;
  price_in: number | null;
  price_out: number | null;
  price_cached_in: number | null;
  stale: boolean;
}

export interface GroupMember {
  provider_id: string;
  model_id: string;
}

export interface Group {
  name: string;
  label: string;
  description: string;
  members: GroupMember[];
}

export interface StepEvent {
  type: "step";
  step: string;
  label: string;
  status: "running" | "ok" | "failed" | "skipped";
  latency_ms?: number;
  detail?: string;
  error_class?: string;
  model?: string;
  usage?: { prompt: number; completion: number; cached: number; reasoning: number };
  cost_usd?: number | null;
  rate?: Record<string, string>;
}

export interface DoneEvent {
  type: "done";
  ok: boolean;
  model?: string;
  models: string[];
}

export type TestEvent = StepEvent | DoneEvent;

export interface UsageRow {
  calls: number;
  prompt: number;
  completion: number;
  cached: number;
  cost: number;
  errors: number;
  avg_latency: number;
  unpriced: number;
  provider?: string;
  model?: string;
  task?: string;
}

export interface Usage {
  days: number;
  totals: UsageRow;
  by_provider: UsageRow[];
  by_model: UsageRow[];
  by_task: UsageRow[];
  daily: { day: string; provider: string; tokens: number; cost: number; calls: number }[];
}

export interface PlaygroundReply {
  content: string;
  provider_name: string;
  model: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cost_usd: number | null;
  attempts: Attempt[];
}

export interface Attempt {
  member: string;
  ok?: boolean;
  skipped?: string;
  failed?: string;
  error_class?: string;
  latency_ms?: number;
}

export const aiKeys = {
  presets: ["ai", "presets"] as const,
  providers: ["ai", "providers"] as const,
  models: (providerId?: string) => ["ai", "models", providerId ?? "all"] as const,
  groups: ["ai", "groups"] as const,
  usage: (days: number) => ["ai", "usage", days] as const,
};

export const presetsQuery = queryOptions({
  queryKey: aiKeys.presets,
  queryFn: () => api<Preset[]>("/api/ai/presets"),
  staleTime: Infinity,
});

export const providersQuery = queryOptions({
  queryKey: aiKeys.providers,
  queryFn: () => api<Provider[]>("/api/ai/providers"),
  refetchInterval: 30_000,
});

export const modelsQuery = (providerId?: string) =>
  queryOptions({
    queryKey: aiKeys.models(providerId),
    queryFn: () => api<AIModel[]>(`/api/ai/models${providerId ? `?provider_id=${providerId}` : ""}`),
  });

export const groupsQuery = queryOptions({
  queryKey: aiKeys.groups,
  queryFn: () => api<Group[]>("/api/ai/groups"),
});

export const usageQuery = (days: number) =>
  queryOptions({
    queryKey: aiKeys.usage(days),
    queryFn: () => api<Usage>(`/api/ai/usage?days=${days}`),
    refetchInterval: 60_000,
  });

/** Color follows the provider, never its rank: slot by creation order (ids are ULIDs). */
export function providerColors(providers: Pick<Provider, "id" | "name">[]): Map<string, string> {
  const ordered = [...providers].sort((a, b) => a.id.localeCompare(b.id));
  const map = new Map<string, string>();
  ordered.forEach((p, i) => {
    const color = i < 8 ? `var(--series-${i + 1})` : "var(--series-other)";
    map.set(p.id, color);
    map.set(p.name, color);
  });
  return map;
}

export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "Unpriced";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
