/** P97: the team board's pieces: quick add for a person or an agent, and a person's own task
 * in the sheet (accept, mark done, comment). */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/lib/work";

import { PersonTaskPanel } from "./person-task";
import { QuickAdd } from "./quick-add";

const PEOPLE = [
  { user_id: "u_hana", name: "Hana", email: "hana@example.com", role: "hod", branch_name: "Maju", department_name: "Finance", heads_department: true, me: true, reports_to_me: false, open_tasks: 0 },
  { user_id: "u_sara", name: "Sara", email: "sara@example.com", role: "staff", branch_name: "Maju", department_name: "Finance", heads_department: false, me: false, reports_to_me: true, open_tasks: 2 },
];
const AGENTS = [{ id: "ag_1", name: "Faiz", role: "Finance agent", color: "#13895f", status: "active", view_only: false, owner_user_id: null }];

const TASK: Task = {
  id: "tk_1", title: "Reconcile October", brief: "", status: "triage", priority: "high", assignee_agent_id: null, assignee_name: null, assignee_color: null,
  source: "manual", requires_review: true, result: null, error: null, blocked_reason: null, run_count: 0, steps_used: 0, pending_approvals: 0,
  created_by: "user:u_hana", created_at: "2026-11-11T00:00:00Z", updated_at: "2026-11-11T00:00:00Z", started_at: null, finished_at: null,
  parent_task_id: null, depth: 0, schedule_id: null, has_output_schema: false, assignee_user_id: "u_sara", assignee_user_name: "Sara", created_by_name: "Hana", due_at: null,
};

let sent: { path: string; method: string; body: unknown }[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/api/team/people") return json(PEOPLE);
    if (url.pathname === "/api/agents") return json(AGENTS);
    if (url.pathname === "/api/tasks" && method === "POST") return json({ ...TASK, id: "tk_new" });
    if (url.pathname.startsWith("/api/tasks/") && method === "PATCH") {
      const body = JSON.parse(String(init?.body));
      return json({ ...TASK, ...body, status: body.status === "done" ? "review" : body.status ?? TASK.status });
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
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Quick add", { timeout: 30_000 }, () => {
  it("gives a task to a person picked from people and agents, with a priority, on Enter", async () => {
    wrap(<QuickAdd />);
    fireEvent.change(screen.getByPlaceholderText("Add a task and press Enter"), { target: { value: "Check the claims" } });
    fireEvent.click(screen.getByRole("button", { name: /For whom/ }));
    const list = await screen.findByRole("listbox", { name: "For whom" });
    await waitFor(() => expect(list).toHaveTextContent("People"));
    expect(list).toHaveTextContent("AI agents");
    expect(list).toHaveTextContent("Your team");
    fireEvent.change(screen.getByLabelText("Find a person or agent"), { target: { value: "sar" } });
    fireEvent.click(await screen.findByRole("option", { name: /Sara/ }));
    fireEvent.click(screen.getByRole("button", { name: /Priority: Normal/ }));
    fireEvent.submit(screen.getByPlaceholderText("Add a task and press Enter").closest("form")!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ path: "/api/tasks", method: "POST", body: { title: "Check the claims", priority: "high", due_at: null, assignee_user_id: "u_sara", requires_review: false } });
    await waitFor(() => expect(screen.getByPlaceholderText("Add a task and press Enter")).toHaveValue(""));
  });

  it("starts an agent on it when an agent is picked", async () => {
    wrap(<QuickAdd defaultAssignee="agent:ag_1" />);
    await screen.findByRole("button", { name: /For whom: Faiz/ });
    fireEvent.change(screen.getByPlaceholderText("Add a task and press Enter"), { target: { value: "Draft the letter" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toMatchObject({ assignee_agent_id: "ag_1", start: true });
  });
});

describe("A person's task in the sheet", { timeout: 30_000 }, () => {
  it("lets the person accept it, then mark it done (it goes to the giver's check)", async () => {
    const { rerender } = wrap(<PersonTaskPanel task={TASK} meId="u_sara" canWrite />);
    expect(screen.getByText("For you")).toBeInTheDocument();
    expect(screen.getByText("From Hana")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(sent[0]).toEqual({ path: "/api/tasks/tk_1", method: "PATCH", body: { status: "ready" } }));
    const qc = new QueryClient();
    rerender(<QueryClientProvider client={qc}><PersonTaskPanel task={{ ...TASK, status: "running" }} meId="u_sara" canWrite /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Done, send for a check" }));
    await waitFor(() => expect(sent.at(-1)).toEqual({ path: "/api/tasks/tk_1", method: "PATCH", body: { status: "done" } }));
  });

  it("lets the giver comment and send it back from review", async () => {
    wrap(<PersonTaskPanel task={{ ...TASK, status: "review" }} meId="u_hana" canWrite />);
    expect(screen.getByText("For Sara")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Add the bank file" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send back with this comment" }));
    });
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]).toEqual({ path: "/api/tasks/tk_1/comments", method: "POST", body: { text: "Add the bank file" } });
    expect(sent[1]).toEqual({ path: "/api/tasks/tk_1", method: "PATCH", body: { status: "running" } });
  });

  it("shows nothing to change for someone who may only look", () => {
    wrap(<PersonTaskPanel task={TASK} meId="u_other" canWrite={false} />);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByLabelText("Comment")).toBeNull();
  });
});
