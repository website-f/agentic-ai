/** Workflows (P9): visual procedures drawn on a canvas or drafted by an analyst agent. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export type NodeType = "start" | "step" | "decision" | "handoff" | "end";

export interface WNode {
  id: string;
  type: NodeType;
  title: string;
  body: string;
  role: string;
  x: number;
  y: number;
}

export interface WEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface Graph {
  nodes: WNode[];
  edges: WEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  graph: Graph;
  status: "draft" | "active";
  source: "manual" | "analyst";
  agent_ids: string[];
  branch_id: string | null;
  created_by: string;
  created_at: string;
  steps: number;
  procedure: string;
}

export const workflowKeys = { all: ["workflows"] as const };

export const workflowsQuery = queryOptions({
  queryKey: workflowKeys.all,
  queryFn: () => api<Workflow[]>("/api/workflows"),
});

export const NODE_TYPES: { type: NodeType; label: string; color: string }[] = [
  { type: "start", label: "Start", color: "var(--series-3)" },
  { type: "step", label: "Step", color: "var(--series-1)" },
  { type: "decision", label: "Decision", color: "var(--series-4)" },
  { type: "handoff", label: "Hand off", color: "var(--series-7)" },
  { type: "end", label: "End", color: "var(--series-8)" },
];

export const NODE_COLOR: Record<NodeType, string> = Object.fromEntries(
  NODE_TYPES.map((n) => [n.type, n.color]),
) as Record<NodeType, string>;

let counter = 0;
export const newNodeId = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;
