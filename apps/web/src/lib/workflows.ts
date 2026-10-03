/** Workflows (P9): visual procedures drawn on a canvas or drafted by an analyst agent. */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export type NodeType = "start" | "step" | "decision" | "handoff" | "input" | "wait" | "end" | "note";
export type WaitUnit = "minutes" | "hours" | "days";

export interface WNode {
  id: string;
  type: NodeType;
  title: string;
  body: string;
  role: string;
  x: number;
  y: number;
  /** For runs: the agent who does it, whether a person reviews it, who takes a decision. */
  agent_id?: string;
  review?: boolean;
  decider?: "person" | "agent";
  /** What kind of office work a step is (see the step library); shapes the agent's brief. */
  action?: string;
  wait_amount?: number;
  wait_unit?: WaitUnit;
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
  { type: "input", label: "Ask a person", color: "var(--series-5)" },
  { type: "wait", label: "Wait", color: "var(--series-2)" },
  { type: "end", label: "End", color: "var(--series-8)" },
  { type: "note", label: "Note", color: "var(--series-other)" },
];

export const NODE_COLOR: Record<NodeType, string> = Object.fromEntries(
  NODE_TYPES.map((n) => [n.type, n.color]),
) as Record<NodeType, string>;

let counter = 0;
export const newNodeId = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`;

// ---------------------------------------------------------------- runs (P11)

export type StepStatus = "pending" | "ready" | "running" | "waiting" | "scheduled" | "review" | "blocked" | "done" | "failed" | "skipped";
export type RunStatus = "running" | "waiting" | "done" | "failed" | "cancelled";

export interface RunOption { edge_id: string; label: string; to: string; to_title: string }

export interface RunStep {
  id: string;
  type: NodeType;
  title: string;
  role: string;
  body: string;
  review: boolean;
  decider: "person" | "agent";
  status: StepStatus;
  agent_id: string | null;
  agent_name: string | null;
  task_id: string | null;
  task_status: string | null;
  output: string | null;
  error: string | null;
  choice: string | null;
  options: RunOption[];
  by: string | null;
  started_at: string | null;
  finished_at: string | null;
  action: string;
  until: string | null;
  wait: string;
}

export interface RunSummary {
  id: string;
  workflow_id: string | null;
  name: string;
  title: string;
  status: RunStatus;
  error: string | null;
  branch_id: string | null;
  branch_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  done: number;
  total: number;
  needs_you: number;
}

export interface Run extends RunSummary {
  input: string;
  graph: Graph;
  steps: RunStep[];
  files: { id: string; name: string }[];
}

export const runKeys = { all: ["workflow-runs"] as const, one: (id: string) => ["workflow-runs", id] as const };

export const runsQuery = (workflowId?: string) =>
  queryOptions({
    queryKey: [...runKeys.all, "list", workflowId ?? "all"],
    queryFn: () => api<RunSummary[]>(`/api/workflow-runs${workflowId ? `?workflow_id=${workflowId}` : ""}`),
  });

export const runQuery = (id: string) =>
  queryOptions({
    queryKey: runKeys.one(id),
    queryFn: () => api<Run>(`/api/workflow-runs/${id}`),
    refetchInterval: (q) => (q.state.data && ["running", "waiting"].includes(q.state.data.status) ? 4000 : false),
  });

export const RUN_STATUS: Record<RunStatus, { label: string; tone: "info" | "warn" | "ok" | "danger" | "neutral" }> = {
  running: { label: "Running", tone: "info" },
  waiting: { label: "Needs you", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const STEP_LABEL: Record<StepStatus, string> = {
  pending: "Not reached", ready: "Starting", running: "Working", waiting: "Waiting for you", scheduled: "Pausing",
  review: "Waiting for your review", blocked: "Asked a question", done: "Done", failed: "Failed", skipped: "Skipped",
};

