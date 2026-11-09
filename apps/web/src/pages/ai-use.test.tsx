/** P96: AI use and limits as a data table: find a person by name, filter, sort and page on the
 * server, and change one person's allowance from their row. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiUsePage } from "./ai-use";

vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title }: { title: ReactNode }) => <header><h1>{title}</h1></header>,
  IconTile: () => null,
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}));

const ME = { user: { id: "u_me", name: "Owner One", email: "owner@example.com" }, role: "owner", permissions: ["read", "members.manage", "members.assign_owner"] };
const person = (i: number, extra: Record<string, unknown> = {}) => ({
  user_id: `u${i}`, name: `Person ${String(i).padStart(3, "0")}`, email: `person${i}@example.com`, role: "staff",
  used: 1000 * i, limit: 50_000, remaining: 50_000 - 1000 * i, extra: 0, over: false, day: "2026-11-10", resets_at: "2026-11-11T00:00:00+08:00",
  own: null, branch_id: "br_1", branch_name: "Maju Sdn Bhd", department_name: null, cost_usd: 0, pct: Math.round(2 * i), status: "ok", ...extra,
});
const POLICY = { daily_tokens: 50_000, roles: ["staff"], office_daily_tokens: 2_000_000 };

let gets: URL[] = [];
let puts: { path: string; body: unknown }[] = [];

function json(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(() => {
  gets = [];
  puts = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    if (init?.method === "PUT") {
      puts.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
      return json(person(7, { own: 0, limit: null, pct: null, status: "unlimited" }));
    }
    if (url.pathname === "/api/me") return json(ME);
    if (url.pathname === "/api/branches") return json([{ id: "br_1", name: "Maju Sdn Bhd", departments: [] }]);
    if (url.pathname === "/api/work-scope") return json({ enabled: true, roles: ["staff"], about: "" });
    if (url.pathname === "/api/work-scope/refusals") return json([]);
    if (url.pathname === "/api/allowances") {
      gets.push(url);
      const q = url.searchParams.get("q") ?? "";
      const all = Array.from({ length: 240 }, (_, i) => person(i + 1));
      const found = q ? all.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : all;
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("size") ?? 25);
      return json(
        { policy: POLICY, people: found.slice((page - 1) * size, page * size), total: found.length,
          summary: { people: 240, over: 2, near: 5, used: 123_000, cost_usd: 1.5 } },
        { "X-Total-Count": String(found.length) },
      );
    }
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(at = "/settings/ai-use") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], ME);
  const root = createRootRoute({ component: AiUsePage });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [at] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("AI use and limits", { timeout: 30_000 }, () => {
  it("shows one page of people as a table, with the totals for everyone", async () => {
    show();
    const table = await screen.findByRole("table", { name: "Each person's AI use today" }, { timeout: 8000 });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(26));
    expect(gets[0]!.searchParams.get("page")).toBe("1");
    expect(gets[0]!.searchParams.get("size")).toBe("25");
    expect(screen.getByText("Showing 1 to 25 of 240")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 10")).toBeInTheDocument();
    expect(screen.getByText("123k")).toBeInTheDocument(); // used today, by everyone
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(["Name", "Role", "Where", "Used today", "Limit", "Used %", "Status"]));
  });

  it("finds a staff member by name on the server, and sorts by use", async () => {
    const router = show();
    await screen.findByText("Showing 1 to 25 of 240", undefined, { timeout: 8000 });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search by name or email" }), { target: { value: "person 007" } });
    await waitFor(() => expect(gets.at(-1)!.searchParams.get("q")).toBe("person 007"), { timeout: 3000 });
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(router.state.location.search).toMatchObject({ q: "person 007" });
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Used today/ })).getByRole("button"));
    await waitFor(() => expect(gets.at(-1)!.searchParams.get("sort")).toBe("-used"));
  });

  it("filters by status from the tiles and keeps it in the address", async () => {
    const router = show("/settings/ai-use?status=over");
    await screen.findByRole("table", undefined, { timeout: 8000 });
    expect(gets[0]!.searchParams.get("status")).toBe("over");
    fireEvent.click(screen.getByRole("button", { name: /People at their limit/ }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("status"));
  });

  it("opens a person's row to give them no limit", async () => {
    show();
    await screen.findByText("Showing 1 to 25 of 240", undefined, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: "Change the allowance for Person 007" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("AI allowance for Person 007")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("radio", { name: /No limit/ }));
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Save allowance" })); });
    await waitFor(() => expect(puts).toEqual([{ path: "/api/allowances/u7", body: { daily_tokens: 0 } }]));
  });

  it("asks for at least 1,000 tokens for their own amount", async () => {
    show();
    await screen.findByText("Showing 1 to 25 of 240", undefined, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: /^Person 003/ }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("radio", { name: /Their own amount/ }));
    fireEvent.change(within(sheet).getByRole("spinbutton", { name: "Tokens per day for Person 003" }), { target: { value: "10" } });
    expect(within(sheet).getByText("Give at least 1,000 tokens a day, or pick No limit.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Save allowance" })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "100k" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save allowance" }));
    await waitFor(() => expect(puts).toEqual([{ path: "/api/allowances/u3", body: { daily_tokens: 100_000 } }]));
  });
});
