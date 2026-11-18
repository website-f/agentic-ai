/** P113: AI usage per user, the developer's report in the AI Engine. Only the developer sees
 * the tab; the table asks the server for the period, most tokens first; a row opens the
 * person's full report and their calls. P114: each call says what it was about, and their
 * conversations and tasks are one click away. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIEnginePage } from "./index";
import { PeopleUsageTab } from "./people-usage";

vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title }: { title: ReactNode }) => <header><h1>{title}</h1></header>,
  IconTile: () => null,
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}));
// Charts need a real layout; the numbers around them are what is tested here.
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Box, BarChart: Box, Bar: Box, CartesianGrid: Box, XAxis: Box, YAxis: Box, Tooltip: Box };
});

const OWNER = { user: { id: "u_me", name: "Owner One", email: "owner@example.com" }, workspace: { id: "w", name: "Acme", slug: "acme", timezone: "Asia/Kuala_Lumpur" }, role: "owner", permissions: ["engine.view"] };
const DEV = { ...OWNER, user: { ...OWNER.user, is_developer: true } };
const SUMS = { calls: 0, errors: 0, prompt: 0, completion: 0, cached: 0, tokens: 0, cost_usd: 0, unpriced: 0 };
const person = (id: string, name: string, tokens: number, extra: Record<string, unknown> = {}) => ({
  ...SUMS, user_id: id, name, email: `${id}@example.com`, role: "staff", member: true, branch_id: null, branch_name: "Maju", department_name: null,
  calls: tokens ? 4 : 0, prompt: Math.round(tokens * 0.8), completion: tokens - Math.round(tokens * 0.8), tokens, cost_usd: tokens / 100_000,
  share: tokens / 85, top_feature: tokens ? "agent_task" : null, last_used: tokens ? new Date().toISOString() : null, today_used: tokens, today_limit: 50_000, ...extra,
});
const PERIOD = { key: "7d", start: "2026-11-12", end: "2026-11-18", days: 7, timezone: "Asia/Kuala_Lumpur" };
const BODY = {
  period: PERIOD, currency: "USD",
  totals: { ...SUMS, calls: 7, prompt: 7000, completion: 1500, tokens: 8500, cost_usd: 0.086, unpriced: 1, active_users: 3, office_tokens: 600, office_calls: 1,
    top_feature: "agent_task", top_feature_tokens: 3600, features: [] },
  people: [person("u_a", "Aina", 5400, { unpriced: 1 }), person("u_b", "Badrul", 2000, { role: "admin" }), person("u_c", "Chong", 500, { role: "", member: false }), person("u_d", "Dina", 0)],
};
const REPORT = {
  period: PERIOD, currency: "USD",
  person: { user_id: "u_a", name: "Aina", email: "u_a@example.com", role: "staff", member: true, branch_name: "Maju", department_name: null, today_used: 5400, today_limit: 50_000 },
  totals: { ...SUMS, calls: 4, errors: 1, prompt: 4600, completion: 800, tokens: 5400, cost_usd: 0.06, unpriced: 1 },
  tasks: 1, first_used: null, last_used: new Date().toISOString(),
  by_feature: [{ ...SUMS, feature: "agent_task", calls: 2, tokens: 3600 }, { ...SUMS, feature: "chat", calls: 1, tokens: 1200 }],
  by_purpose: [{ ...SUMS, purpose: "agent.task", feature: "agent_task", charged: true, calls: 2, tokens: 3600 }],
  by_agent: [{ ...SUMS, agent_id: "ag_1", name: "Ana", calls: 3, tokens: 4800 }, { ...SUMS, agent_id: null, name: null, calls: 1, tokens: 600 }],
  by_model: [{ ...SUMS, provider: "Good", model: "m1", group: "smart", calls: 4, tokens: 5400 }],
  daily: [{ day: "2026-11-18", calls: 4, tokens: 5400, cost_usd: 0.06 }],
};
const EVENTS = [
  { id: 2, ts: new Date().toISOString(), purpose: "agent.task", feature: "agent_task", charged: true, agent_id: "ag_1", agent_name: "Ana", task_id: "tk_1", task_title: "Quarterly report",
    provider: "Good", model: "m1", group: "smart", prompt: 3000, completion: 500, cached: 0, tokens: 3500, cost_usd: 0.05, status: "ok", error_class: null, latency_ms: 900,
    source: "task", asked: "List overdue invoices", answered: "Twelve customers are overdue.", session_id: null, session_title: null },
  { id: 1, ts: new Date().toISOString(), purpose: "agent.chat", feature: "chat", charged: true, agent_id: "ag_1", agent_name: "Ana", task_id: null, task_title: null,
    provider: "Good", model: "m1", group: "smart", prompt: 1000, completion: 200, cached: 0, tokens: 1200, cost_usd: 0.01, status: "error", error_class: "timeout", latency_ms: 300,
    source: "chat", asked: "How do I compute overtime pay?", answered: "Multiply the hourly rate by 1.5.", session_id: "cs_1", session_title: "Payroll help" },
];
const FACETS = { agents: [{ id: "ag_1", name: "Ana", calls: 3 }, { id: null, name: null, calls: 1 }], models: [{ model: "m1", provider: "Good", calls: 4 }] };
const CONVOS = [{ id: "cs_1", title: "Payroll help", agent_id: "ag_1", agent_name: "Ana", messages: 2, asked: 1, first_at: new Date().toISOString(),
  last_at: new Date().toISOString(), first_message: "How do I compute overtime pay?", tokens: 900, cost_usd: 0.01 }];
const CONVO = { id: "cs_1", title: "Payroll help", agent_id: "ag_1", agent_name: "Ana", more: false, lines: [
  { id: 1, role: "user", content: "How do I compute overtime pay?", at: new Date().toISOString() },
  { id: 2, role: "assistant", content: "Multiply the hourly rate by 1.5.", at: new Date().toISOString() },
] };
const PAID = [{ task_id: "tk_1", title: "Quarterly report", status: "done", brief: "List overdue invoices", agent_name: "Ana", created_at: null, calls: 2, tokens: 3600, cost_usd: 0.05, last_at: new Date().toISOString() }];

let gets: URL[] = [];

function json(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(() => {
  gets = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://office.test");
    if (url.pathname.startsWith("/api/ai/people-usage")) gets.push(url);
    if (url.pathname === "/api/ai/people-usage") return json(BODY, { "X-Total-Count": "4" });
    if (url.pathname === "/api/ai/people-usage/u_a") return json(REPORT);
    if (url.pathname === "/api/ai/people-usage/u_a/events") return json(EVENTS, { "X-Total-Count": "2" });
    if (url.pathname === "/api/ai/people-usage/u_a/events/1") return json({ ...EVENTS[1], task_status: null, error_detail: null });
    if (url.pathname === "/api/ai/people-usage/u_a/facets") return json(FACETS);
    if (url.pathname === "/api/ai/people-usage/u_a/conversations") return json(CONVOS, { "X-Total-Count": "1" });
    if (url.pathname === "/api/ai/people-usage/u_a/conversations/cs_1") return json(CONVO);
    if (url.pathname === "/api/ai/people-usage/u_a/tasks") return json(PAID, { "X-Total-Count": "1" });
    if (url.pathname === "/api/branches") return json([{ id: "br_1", name: "Maju", departments: [] }]);
    if (url.pathname.startsWith("/api/ai/")) return json([]);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(Component: () => ReactNode, me: unknown = DEV, at = "/ai-engine") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], me);
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: "/ai-engine", component: Component });
  const tasks = createRoute({ getParentRoute: () => root, path: "/tasks", component: () => null });
  const agent = createRoute({ getParentRoute: () => root, path: "/agents/$agentId", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([page, tasks, agent]), history: createMemoryHistory({ initialEntries: [at] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("AI usage per user", { timeout: 30_000 }, () => {
  it("is a tab only the developer sees", async () => {
    show(AIEnginePage, DEV);
    const tabs = await screen.findByRole("tablist", { name: "AI Engine sections" }, { timeout: 8000 });
    expect(within(tabs).getByRole("tab", { name: /AI usage per user/ })).toBeInTheDocument();
    cleanup();
    show(AIEnginePage, OWNER);
    const plain = await screen.findByRole("tablist", { name: "AI Engine sections" }, { timeout: 8000 });
    expect(within(plain).queryByRole("tab", { name: /AI usage per user/ })).toBeNull();
    // A plain owner sent straight to the tab lands on Providers.
    cleanup();
    show(AIEnginePage, OWNER, "/ai-engine?tab=people");
    const tabs2 = await screen.findByRole("tablist", { name: "AI Engine sections" }, { timeout: 8000 });
    expect(within(tabs2).getByRole("tab", { name: /Providers/ })).toHaveAttribute("aria-selected", "true");
    expect(gets).toEqual([]);
  });

  it("lists everyone for the period, most tokens first, with the workspace totals", async () => {
    show(PeopleUsageTab);
    const table = await screen.findByRole("table", { name: "AI usage per user" }, { timeout: 8000 });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(5));
    const first = gets[0]!;
    expect(first.searchParams.get("period")).toBe("7d");
    expect(first.searchParams.get("sort")).toBe("-tokens");
    expect(first.searchParams.get("page")).toBe("1");
    const names = within(table).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(names[0]).toContain("Aina");
    expect(names[2]).toContain("Not a member now");
    expect(screen.getByText("8.5k")).toBeInTheDocument(); // total tokens tile
    expect(screen.getByText("$0.09")).toBeInTheDocument(); // estimated cost
    expect(screen.getAllByText("Agent tasks").length).toBeGreaterThan(0); // top feature
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(["Name", "Role", "Calls", "Total tokens", "Cost (USD)", "Share", "Allowance today"]));

    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    await waitFor(() => expect(gets.at(-1)!.searchParams.get("period")).toBe("today"));
    fireEvent.click(screen.getByRole("tab", { name: "Custom" }));
    expect(await screen.findByText("Pick a start and an end date (the end on or after the start).")).toBeInTheDocument();
  });

  it("opens a person's full report and their calls, with what each was about", async () => {
    show(PeopleUsageTab);
    await screen.findByRole("table", { name: "AI usage per user" }, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: /^Aina/ }));
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText("Where it went", undefined, { timeout: 8000 });
    expect(within(sheet).getAllByText("Agent tasks").length).toBeGreaterThan(0);
    const calls = await within(sheet).findByRole("table", { name: "Every call" }, { timeout: 8000 });
    expect(within(calls).getByRole("link", { name: "Quarterly report" })).toHaveAttribute("href", "/tasks?task=tk_1");
    expect(within(calls).getByText("Failed: timeout")).toBeInTheDocument();
    expect(within(calls).getByText("How do I compute overtime pay?")).toBeInTheDocument();
    expect(within(calls).getByText("Twelve customers are overdue.")).toBeInTheDocument();
    expect(within(calls).getByText(/matched by time/)).toBeInTheDocument();
    const ev = gets.find((u) => u.pathname.endsWith("/events"))!;
    expect(ev.searchParams.get("period")).toBe("7d");
    expect(ev.searchParams.get("sort")).toBe("-ts");
    fireEvent.click(within(sheet).getByRole("tab", { name: /^Agent/ }));
    expect(within(sheet).getAllByText("No agent (direct use)").length).toBeGreaterThan(0);
  });

  it("shows their conversations to read in full, and the tasks their use paid for", async () => {
    show(PeopleUsageTab);
    await screen.findByRole("table", { name: "AI usage per user" }, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: /^Aina/ }));
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText("Their logs", undefined, { timeout: 8000 });
    fireEvent.click(within(sheet).getByRole("tab", { name: /^Conversations/ }));
    const convos = await within(sheet).findByRole("table", { name: "Conversations" }, { timeout: 8000 });
    fireEvent.click(within(convos).getByRole("button", { name: /^Payroll help/ }));
    expect(await screen.findByText("Multiply the hourly rate by 1.5.", undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(gets.some((u) => u.pathname.endsWith("/conversations/cs_1"))).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(within(sheet).getByRole("tab", { name: /^Tasks/ }));
    const tasks = await within(sheet).findByRole("table", { name: "Tasks" }, { timeout: 8000 });
    expect(within(tasks).getByRole("link", { name: "Quarterly report" })).toHaveAttribute("href", "/tasks?task=tk_1");
    expect(within(tasks).getByText("3.6k")).toBeInTheDocument();
  });
});
