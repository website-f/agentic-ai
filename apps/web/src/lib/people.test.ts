/** P97: the board's rules for people's tasks mirror the server's. */
import { describe, expect, it } from "vitest";

import { quickBody } from "@/pages/tasks/quick-add";

import { canMoveTask, dueGroup, dueTone, movesFor, nextStep } from "./people";
import type { Task } from "./work";

const task = (extra: Partial<Task>): Task => ({
  id: "tk_1", title: "x", brief: "", status: "triage", priority: "normal", assignee_agent_id: null, assignee_name: null, assignee_color: null,
  source: "manual", requires_review: false, result: null, error: null, blocked_reason: null, run_count: 0, steps_used: 0, pending_approvals: 0,
  created_by: "user:u1", created_at: "2026-11-11T00:00:00Z", updated_at: "2026-11-11T00:00:00Z", started_at: null, finished_at: null,
  parent_task_id: null, depth: 0, schedule_id: null, has_output_schema: false, ...extra,
});

describe("people's tasks", () => {
  it("moves a person's task by people's rules and an agent's by the agent rules", () => {
    const person = task({ assignee_user_id: "u2", status: "running" });
    expect(movesFor(person)).toEqual(["ready", "blocked", "review", "done", "cancelled"]);
    expect(canMoveTask(person, "done")).toBe(true);
    const agent = task({ assignee_agent_id: "ag_1", status: "running" });
    expect(movesFor(agent)).toEqual([]); // running agents move themselves
    expect(canMoveTask(task({ assignee_agent_id: "ag_1", status: "review" }), "done")).toBe(true);
    expect(canMoveTask(null, "done")).toBe(false);
  });

  it("offers one next step: accept, start, mark done", () => {
    expect(nextStep(task({ status: "triage" }))?.to).toBe("ready");
    expect(nextStep(task({ status: "ready" }))?.to).toBe("running");
    expect(nextStep(task({ status: "running" }))?.to).toBe("done");
    expect(nextStep(task({ status: "review" }))).toBeNull();
  });

  it("says how soon a task is due", () => {
    const now = new Date(2026, 10, 11, 10, 0).getTime();
    const at = (d: number, h = 17) => new Date(2026, 10, 11 + d, h, 0).toISOString();
    expect(dueTone(task({ due_at: at(0, 9) }), now)).toBe("overdue");
    expect(dueTone(task({ due_at: at(0) }), now)).toBe("today");
    expect(dueTone(task({ due_at: at(2) }), now)).toBe("soon");
    expect(dueTone(task({ due_at: at(20) }), now)).toBe("later");
    expect(dueTone(task({ due_at: at(-3), status: "done" }), now)).toBeNull();
    expect(dueGroup(task({ due_at: at(5) }), now)).toBe("week");
    expect(dueGroup(task({ due_at: null }), now)).toBe("none");
  });

  it("builds a quick task for a person (no check by default) or an agent (starts)", () => {
    expect(quickBody({ title: " Call the bank ", assignee: "user:u2", due: null, priority: "high" }))
      .toEqual({ title: "Call the bank", priority: "high", due_at: null, assignee_user_id: "u2", requires_review: false });
    expect(quickBody({ title: "Draft", assignee: "agent:ag_1", due: "2026-11-12T09:00:00.000Z", priority: "normal" }))
      .toEqual({ title: "Draft", priority: "normal", due_at: "2026-11-12T09:00:00.000Z", assignee_agent_id: "ag_1", start: true });
    expect(quickBody({ title: "Later", assignee: "", due: null, priority: "low" })).toEqual({ title: "Later", priority: "low", due_at: null });
  });
});
