/** P107: Members is the shared data table in server mode: the address keeps the search,
 * filters (company, department, role, status), sort and page, and the API gets them as before. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MembersPage } from "./members";

vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Section: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  IconTile: () => null,
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}));
vi.mock("@/components/sign-in-emails", () => ({ SignInEmailsBar: () => null, useEmailMember: () => ({ mutate: vi.fn() }) }));
vi.mock("@/components/two-factor", () => ({ ResetTwoFactorDialog: () => null, TwoFactorPill: () => null, useMemberTwoFactor: () => false }));

const ME = { user: { id: "u_me", name: "Owner One", email: "owner@example.com" }, role: "owner", permissions: ["read", "members.manage", "org.manage"], scope: { kind: "all" }, assignable_roles: ["admin", "staff"] };
const BRANCHES = [
  { id: "br_1", name: "Maju Sdn Bhd", color: "#000", isolated: false, departments: [{ id: "d_fin", branch_id: "br_1", name: "Finance" }] },
  { id: "br_2", name: "Jaya Bhd", color: "#000", isolated: false, departments: [{ id: "d_ops", branch_id: "br_2", name: "Operations" }] },
];
const person = (i: number) => ({
  user_id: i === 0 ? "u_me" : `u${i}`, email: `p${i}@example.com`, name: i === 0 ? "Owner One" : `Person ${String(i).padStart(3, "0")}`,
  role: i === 0 ? "owner" : "staff", is_active: true, must_change_password: false, last_login_at: null, branch_id: "br_1", branch_name: "Maju Sdn Bhd",
  department_id: "d_fin", department_name: "Finance", joined_at: new Date(2026, 5, 1).toISOString(), agents: 0, microsoft: false,
});

let calls: URL[] = [];
let bulkBodies: unknown[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  bulkBodies = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    if (url.pathname === "/api/members/bulk") {
      bulkBodies.push(JSON.parse(String(init?.body)));
      return json({ results: [{ user_id: "u1", ok: true, message: null }, { user_id: "u2", ok: false, message: "A workspace needs at least one owner." }], done: 1, skipped: 1 });
    }
    if (url.pathname === "/api/members" && url.searchParams.has("page")) {
      calls.push(url);
      const page = Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("page_size"));
      const items = Array.from({ length: Math.min(size, 245 - (page - 1) * size) }, (_, i) => person((page - 1) * size + i));
      return json({ items, total: 245, page, page_size: size, summary: { members: 245, owners_admins: 1, temp_password: 0, microsoft: 0, agents: 0, roles: { owner: 1, staff: 244 } } });
    }
    if (url.pathname === "/api/branches") return json(BRANCHES);
    if (url.pathname === "/api/members") return json([]);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(at = "/settings/members") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], ME);
  const root = createRootRoute({ component: MembersPage });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [at] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("Members", { timeout: 30_000 }, () => {
  it("shows one page from the server with numbered pages", async () => {
    show();
    const table = await screen.findByRole("table", { name: "Members" });
    expect(within(table).getAllByRole("row")).toHaveLength(26);
    expect(screen.getByText("Showing 1 to 25 of 245")).toBeInTheDocument();
    expect(calls.at(-1)!.search).toBe("?page=1&page_size=25");
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: "Page 10" }));
    await waitFor(() => expect(calls.at(-1)!.searchParams.get("page")).toBe("10"));
    expect(await screen.findByText("Showing 226 to 245 of 245")).toBeInTheDocument();
  });

  it("sends the address's filters and sort to the API (Organization links here by company)", async () => {
    const router = show("/settings/members?company=br_1&department=d_fin&status=pending&sort=-last_seen");
    await screen.findByRole("table", { name: "Members" });
    const url = calls.at(-1)!;
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: "1", page_size: "25", company: "br_1", department: "d_fin", status: "pending", sort: "last_seen", dir: "desc" });
    expect(screen.getByRole("button", { name: "Company", expanded: false })).toHaveTextContent("Maju Sdn Bhd");
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
    await waitFor(() => expect(router.state.location.search).toEqual({ sort: "-last_seen" }));
  });

  it("ticks people, never yourself, and keeps the bulk actions", async () => {
    show();
    await screen.findByRole("table", { name: "Members" });
    expect(screen.queryByRole("checkbox", { name: "Select Owner One" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Person 001" }));
    const bar = screen.getByRole("region", { name: "Ticked rows" });
    expect(within(bar).getByText("1 ticked")).toBeInTheDocument();
    for (const name of [/Change role or place/, /Access/, /Reports to/, /Remove/]) {
      expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Options for Person 001" })).toBeInTheDocument();
  });

  it("removes the ticked people after a confirmation that counts them, and says who was refused", async () => {
    show();
    await screen.findByRole("table", { name: "Members" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Person 001" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Person 002" }));
    const bar = screen.getByRole("region", { name: "Ticked rows" });
    expect(within(bar).getByRole("button", { name: /Export ticked/ })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: /Remove ticked/ }));
    const dialog = await screen.findByRole("dialog", { name: "Remove 2 people?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("1 done, 1 not done: A workspace needs at least one owner.");
    expect(bulkBodies).toEqual([{ user_ids: ["u1", "u2"], action: "remove" }]);
  });

  it("opens a member's details from the row", async () => {
    show();
    fireEvent.click(await screen.findByText("Person 003"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("p3@example.com")).toBeInTheDocument();
    expect(within(sheet).getByText("Finance")).toBeInTheDocument();
  });
});
