/** P109: tasks for people, Trello-like. The composer's "For people" form (many assignees, a
 * checklist, sub-tasks), the task's detail (tick the checklist, add items), the board card's
 * faces and progress, and the calendar's and timeline's placing of tasks. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PeopleTaskForm } from "@/components/task-composer/people-task-form";
import { keys } from "@/lib/queries";
import type { Me } from "@/lib/types";
import { workKeys, type Task, type TaskDetail } from "@/lib/work";

import { tasksOn, visibleDays } from "./calendar-view";
import { barOf, groupTasks } from "./gantt-view";
import { AssigneeStack, ChecklistBar, PeopleTaskDetail } from "./people-detail";

const nav = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => (to: unknown) => nav.calls.push(to),
}));

const ME: Me = {
  user: { id: "u_hana", email: "hana@example.com", name: "Hana", must_change_password: false },
  workspace: { id: "ws_1", name: "Acme", slug: "acme", timezone: "Asia/Kuala_Lumpur" },
  role: "hod",
  permissions: ["read", "work.write"],
};
const PEOPLE = [
  { user_id: "u_hana", name: "Hana", email: "hana@example.com", role: "hod", branch_name: "Maju", department_name: "Finance", heads_department: true, me: true, reports_to_me: false, open_tasks: 0 },
  { user_id: "u_sara", name: "Sara", email: "sara@example.com", role: "staff", branch_name: "Maju", department_name: "Finance", heads_department: false, me: false, reports_to_me: true, open_tasks: 2 },
  { user_id: "u_tom", name: "Tom", email: "tom@example.com", role: "staff", branch_name: "Maju", department_name: "Finance", heads_department: false, me: false, reports_to_me: true, open_tasks: 0 },
];

const TASK: Task = {
  id: "tk_1", title: "Prepare the audit pack", brief: "Bank statements", status: "ready", priority: "normal", assignee_agent_id: null, assignee_name: null, assignee_color: null,
  source: "manual", requires_review: true, result: null, error: null, blocked_reason: null, run_count: 0, steps_used: 0, pending_approvals: 0,
  created_by: "user:u_hana", created_at: "2026-11-11T00:00:00Z", updated_at: "2026-11-11T00:00:00Z", started_at: null, finished_at: null,
  parent_task_id: null, depth: 0, schedule_id: null, has_output_schema: false, assignee_user_id: "u_sara", assignee_user_name: "Sara", created_by_name: "Hana",
  due_at: "2026-11-20T09:00:00Z", start_at: "2026-11-18T01:00:00Z", category: "follow_up",
  assignees: [{ user_id: "u_sara", name: "Sara" }, { user_id: "u_tom", name: "Tom" }], watchers: [],
  checklist_done: 1, checklist_total: 2, subtasks_done: 0, subtasks_total: 0, files_count: 0,
};
const CHECKLIST = [
  { id: "ci_1", text: "Bank statements", done: true, position: 1, done_by_name: "Sara", done_at: "2026-11-12T00:00:00Z" },
  { id: "ci_2", text: "Receipts", done: false, position: 2, done_by_name: null, done_at: null },
];
const DETAIL: TaskDetail = { task: TASK, events: [], approvals: [], transcript: [], children: [], parent: null, meetings: [], checklist: CHECKLIST };

let sent: { path: string; method: string; body: unknown }[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  sent = [];
  nav.calls = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/api/team/people") return json(PEOPLE);
    if (url.pathname === "/api/team/watchable") return json(PEOPLE.map((p) => ({ ...p, manages_me: false })));
    if (url.pathname === "/api/tasks" && method === "POST") return json({ ...TASK, id: "tk_new" }, 201);
    if (url.pathname.endsWith("/attachments") || url.pathname === "/api/files") return json([]);
    if (url.pathname === "/api/library") return json({ sources: [], passages: 0, can_reindex: false, can_edit: false });
    if (url.pathname.includes("/checklist")) {
      if (method === "POST") return json([...CHECKLIST, { id: "ci_3", text: "Payslips", done: false, position: 3, done_by_name: null, done_at: null }], 201);
      return json(CHECKLIST.map((c) => (url.pathname.endsWith(c.id) ? { ...c, done: !c.done } : c)));
    }
    return json({ ok: true });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.me, ME);
  qc.setQueryData(workKeys.task(TASK.id), DETAIL);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("The composer's task for people", { timeout: 30_000 }, () => {
  it("gives one task to several people with a checklist and a sub-task, and opens it", async () => {
    const closed = vi.fn();
    wrap(<PeopleTaskForm prefill={{}} onClose={closed} />);
    const create = screen.getByRole("button", { name: /Create task/ });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Prepare the audit pack" } });
    // A head of department picks who: nobody is picked for them.
    await waitFor(() => expect(create).toBeDisabled());
    const who = screen.getByRole("group", { name: "Assign to" });
    fireEvent.click(within(who).getByRole("button", { name: "Assign to" }));
    fireEvent.click(await screen.findByRole("option", { name: /Sara/ }));
    fireEvent.click(screen.getByRole("option", { name: /Tom/ }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const item = screen.getByLabelText("New checklist item");
    fireEvent.change(item, { target: { value: "Bank statements" } });
    fireEvent.keyDown(item, { key: "Enter" });
    expect(screen.getByText("Bank statements")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add a sub-task/ }));
    fireEvent.change(screen.getByLabelText("Sub-task title"), { target: { value: "Scan the receipts" } });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.path).toBe("/api/tasks");
    expect(sent[0]!.body).toMatchObject({
      title: "Prepare the audit pack",
      category: "general",
      assignee_user_ids: ["u_sara", "u_tom"],
      watcher_user_ids: [],
      checklist: ["Bank statements"],
      subtasks: [{ title: "Scan the receipts", assignee_user_id: null }],
      requires_review: true,
      file_ids: [],
    });
    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(nav.calls).toEqual([{ to: "/tasks", search: { task: "tk_new" } }]);
  });
});

describe("A task for people in the sheet", { timeout: 30_000 }, () => {
  it("ticks the checklist and adds an item", async () => {
    wrap(<PeopleTaskDetail task={TASK} detail={DETAIL} canWrite />);
    expect(screen.getByText("1 of 2 done")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Receipts" }));
    await waitFor(() => expect(sent[0]).toEqual({ path: "/api/tasks/tk_1/checklist/ci_2", method: "PATCH", body: { done: true } }));
    const add = screen.getAllByLabelText("New checklist item")[0]!;
    fireEvent.change(add, { target: { value: "Payslips" } });
    fireEvent.keyDown(add, { key: "Enter" });
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: "/api/tasks/tk_1/checklist", method: "POST", body: { text: "Payslips" } }));
  });

  it("shows only what someone who may look can see", () => {
    wrap(<PeopleTaskDetail task={TASK} detail={DETAIL} canWrite={false} />);
    expect(screen.getByRole("checkbox", { name: "Receipts" })).toBeDisabled();
    expect(screen.queryByLabelText("New checklist item")).toBeNull();
    expect(screen.getByText("Sara")).toBeInTheDocument();
  });

  it("shows everyone it is for and the checklist's progress on a card", () => {
    wrap(<><AssigneeStack task={TASK} /><ChecklistBar done={1} total={2} /></>);
    expect(screen.getByLabelText("For Sara, Tom")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Checklist" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });
});

describe("Calendar and timeline", () => {
  const span = (start: string | null, due: string | null) => ({ ...TASK, start_at: start, due_at: due });

  it("lays out six weeks from a Monday and puts a task on each day of its span", () => {
    const days = visibleDays(new Date(2026, 10, 17), "month");
    expect(days).toHaveLength(42);
    expect(days[0]!.getDay()).toBe(1);
    const t = span(new Date(2026, 10, 18, 9).toISOString(), new Date(2026, 10, 20, 17).toISOString());
    expect(tasksOn([t], new Date(2026, 10, 17))).toHaveLength(0);
    expect(tasksOn([t], new Date(2026, 10, 19))).toHaveLength(1);
    expect(tasksOn([t], new Date(2026, 10, 20))).toHaveLength(1);
    expect(tasksOn([span(null, null)], new Date(2026, 10, 20))).toHaveLength(0);
  });

  it("draws a bar from start to due, clipped to what is shown, and groups by person", () => {
    const first = new Date(2026, 10, 16);
    const t = span(new Date(2026, 10, 18, 9).toISOString(), new Date(2026, 10, 20, 17).toISOString());
    expect(barOf(t, first, 14)).toEqual({ left: 2, width: 3 });
    expect(barOf(span(null, new Date(2026, 10, 16, 17).toISOString()), first, 14)).toEqual({ left: 0, width: 1 });
    expect(barOf(span(new Date(2026, 10, 1).toISOString(), new Date(2026, 10, 17).toISOString()), first, 14)).toEqual({ left: 0, width: 2 });
    expect(barOf(span(null, null), first, 14)).toBeNull();
    const groups = groupTasks([t, { ...t, id: "tk_2", assignees: [], assignee_user_id: null, assignee_user_name: null }], "person", "Unassigned");
    expect(groups.map(([g, rows]) => [g, rows.length])).toEqual([["Sara", 1], ["Tom", 1], ["Unassigned", 1]]);
  });
});
