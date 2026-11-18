/** P107: Organization lists its companies, departments and members as data tables: search,
 * filters in the address, counts that open the list they count, a company opens in a sheet,
 * row menus (View, Edit, Delete with a confirmation), ticks with bulk delete and Export. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationPage } from "./organization";

vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Section: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  IconTile: () => null,
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}));
vi.mock("./org-starter", () => ({ StarterTeamDialog: () => null, StarterTeamFields: () => null, teamToast: () => "" }));
vi.mock("./tasks/accountable", () => ({ DepartmentReviewDialog: () => null }));
vi.mock("@/components/sign-in-emails", () => ({ SignInEmailsBar: () => null, useEmailMember: () => ({ mutate: vi.fn() }) }));
vi.mock("@/components/two-factor", () => ({ ResetTwoFactorDialog: () => null, TwoFactorPill: () => null, useMemberTwoFactor: () => false }));
const saved = vi.hoisted(() => [] as { blob: Blob; name: string }[]);
vi.mock("@/lib/native", () => ({ saveFile: async (blob: Blob, name: string) => void saved.push({ blob, name }) }));

const ME = {
  user: { id: "u_me", name: "Owner One", email: "owner@example.com" }, role: "owner", permissions: ["read", "org.manage", "members.manage"],
  scope: { kind: "all" }, assignable_roles: ["admin", "staff"],
};
const company = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `br_${i}`, name: `Syarikat ${String(i).padStart(2, "0")} Sdn Bhd`, slug: `s${i}`, color: "#13895f", isolated: false, industry: "general",
  created_at: new Date(2026, 0, 1 + i).toISOString(), data_level: "standard",
  departments: [{ id: `d_${i}_fin`, branch_id: `br_${i}`, name: "Finance", slug: "finance", position: 0 }, { id: `d_${i}_ops`, branch_id: `br_${i}`, name: `Operations ${i}`, slug: "ops", position: 1 }],
  ...extra,
});
const BRANCHES = [
  ...Array.from({ length: 30 }, (_, i) => company(i)),
  company(40, { name: "Kawalan Keselamatan Bhd", isolated: true, industry: "security", data_level: "confidential" }),
];
// Three people in Syarikat 03 (two in its Finance), one in Kawalan.
const person = (i: number, branch: string, dept: string | null) => ({
  user_id: `u${i}`, email: `p${i}@example.com`, name: `Person ${i}`, role: "staff", is_active: true, must_change_password: false, last_login_at: null,
  branch_id: branch, branch_name: branch, department_id: dept, department_name: dept ? "Finance" : null, joined_at: new Date(2026, 5, 1).toISOString(),
});
const PEOPLE = [person(1, "br_3", "d_3_fin"), person(2, "br_3", "d_3_fin"), person(3, "br_3", null), person(4, "br_40", null)];

let calls: { method: string; url: URL }[] = [];
let refuse = new Set<string>();
let primaUp = true;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  refuse = new Set();
  primaUp = true;
  saved.splice(0);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (method === "DELETE") {
      return refuse.has(url.pathname) ? json({ code: "nope", message: "Not allowed here." }, 400) : new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/branches") return json(BRANCHES);
    if (url.pathname === "/api/prima/companies") {
      return primaUp
        ? json({ companies: [{ id: "c1", name: "Prima Kawalan" }], branches: BRANCHES.map((b) => ({ id: b.id, name: b.name, company_id: b.id === "br_40" ? "c1" : null })) })
        : json({ message: "Prima is not set up on this server." }, 404);
    }
    if (url.pathname === "/api/members" && url.searchParams.has("page")) {
      const items = PEOPLE.filter((p) => !url.searchParams.get("company") || p.branch_id === url.searchParams.get("company"));
      return json({ items, total: items.length, page: 1, page_size: 25, summary: { members: 4, owners_admins: 1, temp_password: 0, microsoft: 0, agents: 0, roles: { staff: 4 } } });
    }
    if (url.pathname === "/api/members") return json(PEOPLE);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(at = "/organization") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], ME);
  const root = createRootRoute({ component: OrganizationPage });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [at] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0, ctrlKey: false, pointerType: "mouse" });
  return screen.getByRole("menu");
}

function blobText(b: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(b);
  });
}

const companies = () => screen.getByRole("table", { name: "Companies" });

describe("Organization", { timeout: 30_000 }, () => {
  it("lists every company in a table with numbered pages, its Prima company, counts and a ⋯ menu", async () => {
    show();
    const table = await screen.findByRole("table", { name: "Companies" });
    expect(within(table).getAllByRole("row")).toHaveLength(26); // heading + 25
    expect(screen.getByText("Showing 1 to 25 of 31")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Options for Syarikat 00 Sdn Bhd" })).toBeInTheDocument();
    expect(await within(table).findByRole("button", { name: "Members of Syarikat 03 Sdn Bhd" })).toHaveTextContent("3");
    expect(within(table).getAllByText("Not linked").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(within(companies()).getByText("Kawalan Keselamatan Bhd")).toBeInTheDocument();
    expect(within(companies()).getByText("Prima Kawalan")).toBeInTheDocument();
  });

  it("filters from the address (Prima link, members, knowledge) and finds a company by its department", async () => {
    const router = show("/organization?knowledge=private");
    await waitFor(() => expect(within(companies()).getAllByRole("row")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "operations 40" } });
    await waitFor(() => expect(within(companies()).getAllByRole("row")).toHaveLength(2), { timeout: 4000 });
    expect(screen.getByRole("button", { name: "Kawalan Keselamatan Bhd" })).toBeInTheDocument();
    cleanup();
    show("/organization?prima=yes");
    await waitFor(() => expect(within(companies()).getAllByRole("row")).toHaveLength(2));
    expect(within(companies()).getByText("Kawalan Keselamatan Bhd")).toBeInTheDocument();
    cleanup();
    show("/organization?people=yes");
    await waitFor(() => expect(within(companies()).getAllByRole("row")).toHaveLength(3)); // Syarikat 03 and Kawalan
  });

  it("leaves the Prima column and filter out when Prima is not set up", async () => {
    primaUp = false;
    show();
    await screen.findByRole("table", { name: "Companies" });
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/prima/companies")).toBe(true));
    expect(screen.queryByRole("columnheader", { name: /Prima company/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Prima link" })).toBeNull();
  });

  it("opens a company in a sheet with its departments, and from there its members", async () => {
    const router = show("/organization?q=kawalan");
    fireEvent.click(await screen.findByRole("button", { name: "Kawalan Keselamatan Bhd" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Operations 40")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Rename Finance" })).toBeInTheDocument();
    fireEvent.click(await within(sheet).findByRole("button", { name: /See its 1 member/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ view: "members", m_company: "br_40" }));
    const members = await screen.findByRole("table", { name: "Members" });
    await waitFor(() => expect(within(members).getAllByRole("row")).toHaveLength(2));
    expect(calls.some((c) => c.url.pathname === "/api/members" && c.url.searchParams.get("company") === "br_40")).toBe(true);
  });

  it("deletes a company after a confirmation that names it, through the same API call", async () => {
    show("/organization?q=syarikat 05");
    await waitFor(() => expect(within(companies()).getAllByRole("row")).toHaveLength(2));
    const menu = openMenu("Options for Syarikat 05 Sdn Bhd");
    for (const item of ["View", "Edit", "Add ready-made AI team", "Review stages", "Delete"]) expect(within(menu).getByRole("menuitem", { name: item })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Syarikat 05 Sdn Bhd?" });
    expect(within(dialog).getByText("This removes the branch and its 2 departments. It cannot be undone.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.pathname === "/api/branches/br_5")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ticks companies: Export ticked, and Delete ticked one call each, saying what was refused", async () => {
    refuse.add("/api/branches/br_2");
    show();
    await screen.findByRole("table", { name: "Companies" });
    for (const n of ["01", "02"]) fireEvent.click(screen.getByRole("checkbox", { name: `Select Syarikat ${n} Sdn Bhd` }));
    const bar = screen.getByRole("region", { name: "Ticked rows" });
    fireEvent.click(within(bar).getByRole("button", { name: /Export ticked/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const lines = (await blobText(saved[0]!.blob)).replace(/^﻿/, "").split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"Company","Short name","Prima company","Departments","Members"');
    expect(lines[1]).toContain('"Syarikat 01 Sdn Bhd","s1","","2","0"');
    fireEvent.click(within(bar).getByRole("button", { name: /Delete ticked/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete 2 companies?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("1 done, 1 not done: Not allowed here.");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url.pathname)).toEqual(["/api/branches/br_1", "/api/branches/br_2"]);
  });

  it("exports the companies the filters leave, as CSV", async () => {
    show("/organization?knowledge=private");
    await waitFor(() => expect(within(companies()).getAllByRole("row")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /^Export$/ }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toMatch(/^companies-.*\.csv$/);
    const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.readAsArrayBuffer(saved[0]!.blob);
    }));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the byte-order mark Excel needs
    const text = await blobText(saved[0]!.blob);
    expect(text.split("\r\n")).toHaveLength(2);
    expect(text).toContain('"Kawalan Keselamatan Bhd"');
  });

  it("lists every department with its company and members, filtered by company", async () => {
    show("/organization?view=departments&d_company=br_3");
    const table = await screen.findByRole("table", { name: "Departments" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(3));
    expect(within(table).getByText("Operations 3")).toBeInTheDocument();
    expect(within(table).getAllByText("Syarikat 03 Sdn Bhd")).toHaveLength(2);
    expect(await within(table).findByRole("button", { name: "Members of Finance" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /Add department/ })).toBeInTheDocument();
    const menu = openMenu("Options for Finance");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Finance?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.pathname === "/api/departments/d_3_fin")).toBe(true));
  });

  it("shows the members table with its filters, Add and Import from Excel", async () => {
    show("/organization?view=members");
    const table = await screen.findByRole("table", { name: "Members" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(5));
    for (const name of ["Company", "Department", "Role"]) expect(screen.getByRole("button", { name, expanded: false })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add member/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import from Excel/ })).toBeInTheDocument();
    const menu = openMenu("Options for Person 1");
    expect(within(menu).getByRole("menuitem", { name: "View" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Remove from workspace" })).toBeInTheDocument();
  });

  it("keeps people who do not manage the organization to viewing", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["me"], { ...ME, role: "viewer", permissions: ["read", "office.view", "org.read"] });
    const root = createRootRoute({ component: OrganizationPage });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/organization"] }) });
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
    await screen.findByRole("table", { name: "Companies" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("radio", { name: /Members/ })).toBeNull();
    const menu = openMenu("Options for Syarikat 00 Sdn Bhd");
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["View"]);
    expect(calls.some((c) => c.url.pathname === "/api/prima/companies" || c.url.pathname === "/api/members")).toBe(false);
  });

  it("P113: gives staff the organization chart only, to look at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["me"], { ...ME, role: "staff", permissions: ["read", "work.write"] });
    const root = createRootRoute({ component: OrganizationPage });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/organization"] }) });
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
    expect(await screen.findByText("View only")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Organization" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Companies" })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Companies/ })).toBeNull();
    expect(calls.some((c) => c.url.pathname === "/api/members/hierarchy")).toBe(true);
    expect(calls.some((c) => c.url.pathname === "/api/branches" || c.url.pathname === "/api/members")).toBe(false);
  });
});
