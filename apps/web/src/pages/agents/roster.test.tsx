/** P107: the agents roster as a data table: search, filters from the address, status, open a row. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "@/lib/work";

// The theme store reads the colour scheme when it is imported.
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

import { AgentsTable } from "./roster";

const agent = (id: string, name: string, extra: Partial<Agent> = {}): Agent => ({
  id, slug: id, name, role: "Clerk", template: null, branch_id: "br_a", branch_name: "Alpha Sdn Bhd", department_id: "dp_fin", department_name: "Finance",
  soul: "", model_group: "smart", tools: {}, autonomy: "ask", sop_ids: [], color: "#13895f", reports_to: null, status: "active", role_kind: "leaf",
  max_parallel_children: 0, max_spawn_depth: 0, budget_daily_tokens: null, budget_monthly_usd: null, heartbeat: false, current_task: null,
  open_tasks: 0, created_at: "2026-11-01T00:00:00Z", view_only: false, private: false, ...extra,
});

const AGENTS: Agent[] = [
  agent("ag_1", "Aisyah", { role: "Accountant" }),
  agent("ag_2", "Badrul", { role: "Researcher", department_id: "dp_ops", department_name: "Operations", status: "paused" }),
  agent("ag_3", "Chong", { role: "Writer", branch_id: "br_b", branch_name: "Beta Trading", department_id: null, department_name: null, owner_name: "Hana" }),
  agent("ag_4", "Devi", { role: "Analyst", current_task: { id: "tk_1", title: "Monthly report", status: "running" } }),
];

function renderAt(path: string) {
  const root = createRootRoute();
  const list = createRoute({ getParentRoute: () => root, path: "/agents", component: () => <AgentsTable agents={AGENTS} statuses={{}} many /> });
  const detail = createRoute({ getParentRoute: () => root, path: "/agents/$agentId", component: () => <p>Agent page</p> });
  const router = createRouter({ routeTree: root.addChildren([list, detail]), history: createMemoryHistory({ initialEntries: [path] }) });
  render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the agents table", { timeout: 30_000 }, () => {
  it("lists every agent with its company, department and state", async () => {
    renderAt("/agents");
    const table = await screen.findByRole("table", { name: "Agents" });
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    const chong = within(table).getByRole("button", { name: /Chong/ }).closest("tr")!;
    expect(within(chong).getByText("Beta Trading")).toBeInTheDocument();
    expect(within(chong).getByText("No department")).toBeInTheDocument();
    expect(within(chong).getByText("Hana")).toBeInTheDocument();
    const badrul = within(table).getByRole("button", { name: /Badrul/ }).closest("tr")!;
    expect(within(badrul).getByText("Paused")).toBeInTheDocument();
    const devi = within(table).getByRole("button", { name: /Devi/ }).closest("tr")!;
    expect(within(devi).getByText("Working")).toBeInTheDocument();
    expect(within(devi).getByText("Monthly report")).toBeInTheDocument();
  });

  it("reads its filters from the address", async () => {
    renderAt("/agents?department=dp_ops");
    const table = await screen.findByRole("table", { name: "Agents" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("Badrul")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("finds by role and opens an agent's page", async () => {
    const router = renderAt("/agents?q=writer");
    const table = await screen.findByRole("table", { name: "Agents" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    fireEvent.click(within(table).getByRole("button", { name: /Chong/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/agents/ag_3"));
    expect(await screen.findByText("Agent page")).toBeInTheDocument();
  });
});
