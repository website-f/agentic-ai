/** P21 objectives: what the company's work is for, how far along it is, and what it cost. */
import { queryOptions } from "@tanstack/react-query";

import { locale, msg, t } from "@/i18n";

import { api } from "./api";

export type ObjectiveStatus = "active" | "done" | "dropped";
export type BudgetState = "none" | "ok" | "near" | "over";

export interface Objective {
  id: string;
  title: string;
  target: string;
  status: ObjectiveStatus;
  due_on: string | null;
  budget_usd: number | null;
  branch_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  department_name: string | null;
  parent_id: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  progress: { total: number; done: number; failed: number; open: number; cancelled: number; requests: number };
  /** Its own work (linked tasks and their request trees), US$ as billed. */
  usd: number;
  tokens: number;
  last_activity: string | null;
  /** With the objectives nested under it: what the budget is checked against. */
  rollup_usd: number;
  budget_state: BudgetState;
}

export interface ObjectiveDetail {
  objective: Objective;
  parent: Objective | null;
  children: Objective[];
  cost_by_day: { day: string; usd: number; calls: number }[];
  timezone: string;
}

/** The objective a task serves, as the task detail carries it. */
export interface TaskObjective {
  id: string;
  title: string;
  target: string;
  status: ObjectiveStatus;
  parent_title: string | null;
}

/** What the whole request a task is part of cost (its root and every part). */
export interface RequestCost {
  root_task_id: string;
  tasks: number;
  usd: number;
  tokens: number;
}

/** One row of the overview's "Cost by objective". */
export interface ObjectiveCost {
  id: string;
  title: string;
  status: ObjectiveStatus;
  branch_id: string | null;
  budget_usd: number | null;
  usd: number;
  tokens: number;
  tasks: number;
}

export interface ObjectiveInput {
  title: string;
  target: string;
  branch_id: string | null;
  department_id: string | null;
  parent_id: string | null;
  due_on: string | null;
  status: ObjectiveStatus;
  budget_usd: number | null;
}

export const objectiveKeys = {
  all: ["objectives"] as const,
  list: (status?: string) => ["objectives", "list", status ?? "all"] as const,
  detail: (id: string) => ["objectives", id] as const,
  tasks: (id: string) => ["objectives", id, "tasks"] as const,
};

export const objectivesQuery = (status?: string) =>
  queryOptions({
    queryKey: objectiveKeys.list(status),
    queryFn: () => api<Objective[]>(`/api/objectives${status ? `?status=${status}` : ""}`),
  });

export const objectiveQuery = (id: string) =>
  queryOptions({ queryKey: objectiveKeys.detail(id), queryFn: () => api<ObjectiveDetail>(`/api/objectives/${id}`) });

export const STATUS: Record<ObjectiveStatus, { label: string; tone: "accent" | "ok" | "neutral" }> = {
  active: { label: msg("Active"), tone: "accent" },
  done: { label: msg("Done"), tone: "ok" },
  dropped: { label: msg("Dropped"), tone: "neutral" },
};

export const BUDGET: Record<Exclude<BudgetState, "none">, { label: string; tone: "ok" | "warn" | "danger" }> = {
  ok: { label: msg("On budget"), tone: "ok" },
  near: { label: msg("Near budget"), tone: "warn" },
  over: { label: msg("Over budget"), tone: "danger" },
};

// ---------------------------------------------------------------- money

const IMPACT_STORE = "agentic.impact.v1";
const DEFAULT_FX = 4.2;

/** Ringgit per US dollar: the rate set on the Impact page (providers bill in US$). */
export function fxRate(): number {
  try {
    const raw = localStorage.getItem(IMPACT_STORE);
    const fx = raw ? Number((JSON.parse(raw) as { fx?: unknown }).fx) : NaN;
    return Number.isFinite(fx) && fx > 0 ? fx : DEFAULT_FX;
  } catch {
    return DEFAULT_FX;
  }
}

/** US$ as billed, shown in ringgit like the Impact page ("RM 0.42", "RM 1,250"). */
export function rm(usd: number, fx: number = fxRate()): string {
  const n = usd * fx;
  if (n > 0 && n < 0.01) return "< RM 0.01";
  return `RM ${n.toLocaleString(locale(), { maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 && n > 0 ? 2 : 0 })}`;
}

/** Done share of the work that counts (cancelled work is left out), 0..1. */
export function doneShare(o: Pick<Objective, "progress">): number {
  const counted = o.progress.total - o.progress.cancelled;
  return counted > 0 ? o.progress.done / counted : 0;
}

/** Days until (negative: since) a due date, in the viewer's calendar. */
export function daysLeft(due: string | null, now: Date = new Date()): number | null {
  if (!due) return null;
  const [y, m, d] = due.split("-").map(Number);
  const end = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

export function dueLabel(due: string | null, now: Date = new Date()): { text: string; tone: "neutral" | "warn" | "danger" } | null {
  const n = daysLeft(due, now);
  if (n === null || !due) return null;
  const date = new Date(`${due}T00:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short", year: n > 300 ? "numeric" : undefined });
  if (n < 0) return { text: t("{date} ({n}d late)", { date, n: -n }), tone: "danger" };
  if (n === 0) return { text: t("{date} (today)", { date }), tone: "warn" };
  if (n <= 7) return { text: t("{date} ({n}d left)", { date, n }), tone: "warn" };
  return { text: date, tone: "neutral" };
}

/** Objectives as a tree: roots (or orphans whose parent is not visible) with their children. */
export interface ObjectiveNode {
  objective: Objective;
  children: ObjectiveNode[];
  depth: number;
}

export function buildTree(rows: Objective[]): ObjectiveNode[] {
  const ids = new Set(rows.map((o) => o.id));
  const kids = new Map<string, Objective[]>();
  for (const o of rows) {
    if (o.parent_id && ids.has(o.parent_id)) kids.set(o.parent_id, [...(kids.get(o.parent_id) ?? []), o]);
  }
  const make = (o: Objective, depth: number, seen: Set<string>): ObjectiveNode => {
    const next = new Set(seen).add(o.id);
    return { objective: o, depth, children: (kids.get(o.id) ?? []).filter((k) => !next.has(k.id)).map((k) => make(k, depth + 1, next)) };
  };
  return rows.filter((o) => !o.parent_id || !ids.has(o.parent_id)).map((o) => make(o, 0, new Set()));
}

/** Pickers: active objectives as flat options, nested ones indented under their parent. */
export function pickerOptions(rows: Objective[], branchId?: string | null): { value: string; label: string; hint?: string }[] {
  const usable = rows.filter((o) => o.status === "active" && (!branchId || !o.branch_id || o.branch_id === branchId));
  const out: { value: string; label: string; hint?: string }[] = [];
  const walk = (nodes: ObjectiveNode[]) => {
    for (const n of nodes) {
      const o = n.objective;
      out.push({ value: o.id, label: `${n.depth ? `${"  ".repeat(n.depth)}↳ ` : ""}${o.title}`, hint: [o.branch_name ?? t("Every company"), o.target].filter(Boolean).join(" · ") });
      walk(n.children);
    }
  };
  walk(buildTree(usable));
  return out;
}
