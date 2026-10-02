/** Live monitor: an agent's steps as they happen, and its browser screen. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export interface FeedEvent {
  seq: number;
  ts: string;
  type: string; // agent.activity | task.event | meeting.turn | approval.requested
  data: Record<string, unknown>;
}

export interface AgentActivity {
  agent: { id: string; name: string; role: string; color: string; status: string; clone_of?: string | null };
  helpers?: { id: string; name: string; color: string }[];
  task: { id: string; title: string; status: string; calls?: number; tokens?: number } | null;
  today: { calls: number; tokens: number; usd: number };
  browser: { session: string } | null;
  events: FeedEvent[];
}

export const monitorKeys = {
  activity: (id: string) => ["monitor", id] as const,
  wall: ["monitor", "wall"] as const,
};

/** One tile of the wall: an agent at work right now. */
export interface WallItem {
  agent: { id: string; name: string; role: string; color: string; branch_id: string; clone_of: string | null };
  task: { id: string; title: string; status: string };
  browser: { session: string } | null;
  last: { ts: string; data: Record<string, unknown> } | null;
}

export const wallQuery = queryOptions({
  queryKey: monitorKeys.wall,
  queryFn: () => api<WallItem[]>("/api/monitor/wall"),
  refetchInterval: 5_000,
});

export const activityQuery = (id: string) =>
  queryOptions({
    queryKey: monitorKeys.activity(id),
    queryFn: () => api<AgentActivity>(`/api/agents/${id}/activity?limit=200`),
    refetchInterval: 20_000, // a safety net; live events keep it current
  });

/** The events of one agent, newest last, without duplicates. */
export function mergeFeed(a: FeedEvent[], b: FeedEvent[]): FeedEvent[] {
  const seen = new Map<number, FeedEvent>();
  for (const e of [...a, ...b]) seen.set(e.seq, e);
  return [...seen.values()].sort((x, y) => x.seq - y.seq).slice(-400);
}

export function belongsTo(e: { type: string; data: Record<string, unknown> }, agentId: string): boolean {
  if (e.data.agent_id === agentId) return true;
  return e.type === "task.event" && e.data.actor === `agent:${agentId}`;
}
