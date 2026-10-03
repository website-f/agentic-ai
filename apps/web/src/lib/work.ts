/** Types and queries for agents, SOPs, tasks, approvals and broadcasts (P2). */
import { queryOptions } from "@tanstack/react-query";

import { api } from "./api";

export type ToolMode = "allow" | "ask" | "deny";
export type TaskStatus = "triage" | "ready" | "running" | "blocked" | "review" | "done" | "failed" | "cancelled";
export type Priority = "low" | "normal" | "high" | "urgent";

export interface Template {
  id: string;
  role: string;
  department: string;
  model_group: string;
  soul: string;
  tools: Record<string, ToolMode>;
  role_kind: string;
  color: string;
}

export interface ToolInfo {
  name: string;
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
  default_mode: ToolMode;
}

export interface Agent {
  id: string;
  slug: string;
  name: string;
  role: string;
  template: string | null;
  branch_id: string;
  branch_name: string;
  department_id: string | null;
  department_name: string | null;
  soul: string;
  model_group: string;
  tools: Record<string, ToolMode>;
  autonomy: "ask" | "auto";
  sop_ids: string[];
  color: string;
  reports_to: string | null;
  status: "active" | "paused" | "retired";
  role_kind: "leaf" | "orchestrator";
  max_parallel_children: number;
  max_spawn_depth: number;
  budget_daily_tokens: number | null;
  budget_monthly_usd: number | null;
  heartbeat: boolean;
  current_task: { id: string; title: string; status: TaskStatus } | null;
  open_tasks: number;
  created_at: string;
  owner_user_id?: string | null;
  owner_name?: string | null;
  clone_of?: string | null;
  can_manage?: boolean;
  /** The viewer only watches this agent (a colleague's agent in their branch): no chat, tasks or edits. */
  view_only: boolean;
  /** A personal assistant: only ever returned to its owner. */
  private: boolean;
}

export interface SOP {
  id: string;
  scope: "workspace" | "branch" | "department" | "library";
  scope_id: string | null;
  scope_label: string;
  title: string;
  body: string;
  version: number;
  updated_by: string | null;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  brief: string;
  status: TaskStatus;
  priority: Priority;
  assignee_agent_id: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
  source: string;
  requires_review: boolean;
  result: string | null;
  error: string | null;
  blocked_reason: string | null;
  run_count: number;
  steps_used: number;
  pending_approvals: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  parent_task_id: string | null;
  depth: number;
  schedule_id: string | null;
  has_output_schema: boolean;
  labels?: string[];
  branch_id?: string | null;
  goal?: string | null;
  goal_tries?: number;
}

export interface TaskEvent {
  id: number;
  ts: string;
  kind: string;
  actor: string;
  actor_name: string | null;
  text: string;
  data: Record<string, unknown> | null;
}

export interface Approval {
  id: string;
  kind: "tool" | "question" | "budget";
  tool_name: string;
  tool_label: string;
  args: Record<string, unknown>;
  reason: string;
  risk: "low" | "medium" | "high";
  rule: string;
  status: "pending" | "approved" | "denied" | "answered" | "expired" | "cancelled";
  scope: "once" | "always" | null;
  answer: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  expires_at: string;
  task_id: string;
  task_title: string;
  agent_id: string;
  agent_name: string;
  agent_color: string;
}

export interface TranscriptItem {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string | null;
  name: string | null;
  tool_calls: string[];
  created_at: string;
  meta: { provider?: string; model?: string } | null;
}

export interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  approvals: Approval[];
  transcript: TranscriptItem[];
  children: Task[];
  parent: Task | null;
  meetings: { id: string; topic: string; status: string; outcome: { decision: string } | null }[];
}

export interface Audience {
  all: boolean;
  branch_ids: string[];
  department_ids: string[];
  agent_ids: string[];
}

export interface Receipt {
  agent_id: string;
  agent_name: string;
  agent_role: string;
  agent_color: string;
  department_name: string | null;
  branch_name: string;
  delivered_at: string;
  ack_at: string | null;
  reply: string | null;
  task_id: string | null;
}

export interface Broadcast {
  id: string;
  sender: string;
  sender_name: string | null;
  audience: Audience;
  audience_label: string;
  mode: "announcement" | "directive";
  request_reply: boolean;
  body: string;
  created_at: string;
  targets: number;
  acked: number;
  receipts: Receipt[] | null;
}

export const workKeys = {
  agents: ["agents"] as const,
  agent: (id: string) => ["agents", id] as const,
  templates: ["agents", "templates"] as const,
  tools: ["agents", "tools"] as const,
  sops: ["sops"] as const,
  tasks: ["tasks"] as const,
  task: (id: string) => ["tasks", id] as const,
  approvals: (state: "pending" | "history") => ["approvals", state] as const,
  broadcasts: ["broadcasts"] as const,
  broadcast: (id: string) => ["broadcasts", id] as const,
  sessions: (agentId: string) => ["chat", agentId, "sessions"] as const,
  messages: (sessionId: string) => ["chat", "messages", sessionId] as const,
};

export const agentsQuery = queryOptions({ queryKey: workKeys.agents, queryFn: () => api<Agent[]>("/api/agents") });
export const agentQuery = (id: string) =>
  queryOptions({ queryKey: workKeys.agent(id), queryFn: () => api<Agent>(`/api/agents/${id}`) });
export const templatesQuery = queryOptions({
  queryKey: workKeys.templates,
  queryFn: () => api<Template[]>("/api/agents/templates"),
  staleTime: Infinity,
});
export const toolsQuery = queryOptions({
  queryKey: workKeys.tools,
  queryFn: () => api<ToolInfo[]>("/api/agents/tools"),
  staleTime: Infinity,
});
export const sopsQuery = queryOptions({ queryKey: workKeys.sops, queryFn: () => api<SOP[]>("/api/sops") });
export const tasksQuery = queryOptions({ queryKey: workKeys.tasks, queryFn: () => api<Task[]>("/api/tasks") });
export const taskQuery = (id: string) =>
  queryOptions({ queryKey: workKeys.task(id), queryFn: () => api<TaskDetail>(`/api/tasks/${id}`) });
export const approvalsQuery = (state: "pending" | "history" = "pending") =>
  queryOptions({ queryKey: workKeys.approvals(state), queryFn: () => api<Approval[]>(`/api/approvals?state=${state}`) });
export const broadcastsQuery = queryOptions({
  queryKey: workKeys.broadcasts,
  queryFn: () => api<Broadcast[]>("/api/broadcasts"),
});
export const broadcastQuery = (id: string) =>
  queryOptions({ queryKey: workKeys.broadcast(id), queryFn: () => api<Broadcast>(`/api/broadcasts/${id}`) });

export const STATUS_INFO: Record<TaskStatus, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "danger" | "info" }> = {
  triage: { label: "Triage", tone: "neutral" },
  ready: { label: "Ready", tone: "info" },
  running: { label: "Running", tone: "accent" },
  blocked: { label: "Waiting on you", tone: "warn" },
  review: { label: "In review", tone: "info" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const PRIORITY_INFO: Record<Priority, { label: string; tone: "neutral" | "info" | "warn" | "danger" }> = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "neutral" },
  high: { label: "High", tone: "warn" },
  urgent: { label: "Urgent", tone: "danger" },
};
