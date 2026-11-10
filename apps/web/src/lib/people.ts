/**
 * P97: people's work. Tasks for people (a member instead of an AI agent), the people a person
 * may give work to, and the tasks given to me. The rules are the server's (apps/api
 * agentic/teams/people.py); this mirrors them so the board only offers moves that work.
 */
import { queryOptions } from "@tanstack/react-query";

import { msg } from "@/i18n";

import { api } from "./api";
import type { Role } from "./types";
import { workKeys, type Task, type TaskStatus } from "./work";

/** One person I may give a task to (GET /api/team/people). */
export interface TeamPerson {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  branch_name: string | null;
  department_name: string | null;
  heads_department: boolean;
  me: boolean;
  reports_to_me: boolean;
  open_tasks: number;
}

export interface AssignedTasks {
  items: Task[];
  done: Task[];
  counts: { open: number; new: number; overdue: number; due_today: number };
}

// Under workKeys.tasks: every live task event refreshes them (lib/live.ts).
export const peopleKeys = {
  team: [...workKeys.tasks, "team-people"] as const,
  assigned: [...workKeys.tasks, "assigned-to-me"] as const,
};

export const teamPeopleQuery = queryOptions({
  queryKey: peopleKeys.team,
  queryFn: () => api<TeamPerson[]>("/api/team/people"),
  staleTime: 60_000,
});

export const assignedTasksQuery = queryOptions({
  queryKey: peopleKeys.assigned,
  queryFn: () => api<AssignedTasks>("/api/me/assigned-tasks"),
  staleTime: 15_000,
});

export const isPersonTask = (t: Pick<Task, "assignee_user_id">) => !!t.assignee_user_id;

/** A person's task moves by hand (server: PERSON_MOVES). */
export const PERSON_MOVES: Partial<Record<TaskStatus, TaskStatus[]>> = {
  triage: ["ready", "running", "done", "cancelled"],
  ready: ["triage", "running", "done", "cancelled"],
  running: ["ready", "blocked", "review", "done", "cancelled"],
  blocked: ["running", "ready", "done", "cancelled"],
  review: ["done", "running", "cancelled"],
  done: ["running"],
  cancelled: ["triage"],
};

/** An agent's task moves by hand (server: MANUAL_MOVES). Running and blocked are agent-driven. */
export const AGENT_MOVES: Partial<Record<TaskStatus, TaskStatus[]>> = {
  triage: ["ready", "cancelled"],
  ready: ["triage", "cancelled"],
  review: ["done", "cancelled"],
  failed: ["triage", "cancelled"],
  done: ["triage"],
  cancelled: ["triage"],
};

export const movesFor = (t: Task) => (isPersonTask(t) ? PERSON_MOVES : AGENT_MOVES)[t.status] ?? [];
export const canMoveTask = (t: Task | null | undefined, to: TaskStatus) => !!t && movesFor(t).includes(to);

/** What a person's task is called in each state (people take, start and finish work). */
export const PERSON_STATUS: Partial<Record<TaskStatus, string>> = {
  triage: msg("New"),
  ready: msg("To do"),
  running: msg("In progress"),
  blocked: msg("Waiting"),
  review: msg("In review"),
  done: msg("Done"),
  cancelled: msg("Cancelled"),
};

/** The next step a person takes on their own task, as one button. */
export function nextStep(t: Task): { to: TaskStatus; label: string } | null {
  if (t.status === "triage") return { to: "ready", label: msg("Accept") };
  if (t.status === "ready") return { to: "running", label: msg("Start") };
  if (t.status === "running" || t.status === "blocked") return { to: "done", label: msg("Mark done") };
  return null;
}

export type DueTone = "overdue" | "today" | "soon" | "later";

/** How soon a task is due: overdue, today, within 3 days, or later (null: no date or finished). */
export function dueTone(t: Pick<Task, "due_at" | "status">, now = Date.now()): DueTone | null {
  if (!t.due_at || t.status === "done" || t.status === "cancelled") return null;
  const due = new Date(t.due_at);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (due.getTime() < now) return "overdue";
  if (due.getTime() <= end.getTime()) return "today";
  if (due.getTime() - now <= 3 * 86_400_000) return "soon";
  return "later";
}

/** A short due label: "Today 17:00", "Fri 14 Nov", "14 Nov 2027". */
export function dueLabel(iso: string, locale?: string, now = Date.now()): string {
  const d = new Date(iso);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(locale, sameYear ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/** Group tasks for the "Due" view: overdue, today, this week, later, no date. */
export type DueGroup = "overdue" | "today" | "week" | "later" | "none";
export function dueGroup(t: Pick<Task, "due_at" | "status">, now = Date.now()): DueGroup {
  if (!t.due_at) return "none";
  const tone = dueTone(t, now);
  if (tone === "overdue") return "overdue";
  if (tone === "today") return "today";
  return new Date(t.due_at).getTime() - now <= 7 * 86_400_000 ? "week" : "later";
}

/** The end of a day `days` from today at 17:00 local time, as ISO (quick due picks). */
export function dueIn(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
}

/** A board filter value for one assignee: "user:<id>" or "agent:<id>". */
export type AssigneeRef = `user:${string}` | `agent:${string}`;
export const assigneeOf = (t: Task): AssigneeRef | null =>
  t.assignee_user_id ? `user:${t.assignee_user_id}` : t.assignee_agent_id ? `agent:${t.assignee_agent_id}` : null;

/** Roles that can have people reporting to them (server: MANAGER_ROLES). */
export const MANAGER_ROLES: Role[] = ["owner", "admin", "management", "hr", "branch_manager", "hod", "supervisor"];
