/** P111: the organization chart. Trees from the people list (roots, loops, filters), boxes and
 * team boxes, finding a person, changing who someone reports to (editors only), the phone list. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ancestorsOf, buildForest, descendantsOf, filterPeople, splitForest, type OrgChart, type OrgPerson } from "@/lib/hierarchy";
import type { Me } from "@/lib/types";

import { OrgChartView } from "./org-chart";

const p = (id: string, name: string, boss: string | null, extra: Partial<OrgPerson> = {}): OrgPerson => ({
  user_id: id, name, job_title: null, role: "staff", branch_id: "b_maju", branch_name: "Maju", branch_ids: ["b_maju"],
  department_id: null, department_name: null, reports_to_user_id: boss, reports_to_name: null, direct_reports: 0,
  heads_department: false, is_active: true, limited: false, ...extra,
});

// Top > Deputy > (Store head > 3 storekeepers), (Cleaning manager); Lone is on their own.
const PEOPLE: OrgPerson[] = [
  p("u_top", "Ahmad Top", null, { job_title: "General Manager", role: "owner" }),
  p("u_dep", "Nora Deputy", "u_top", { job_title: "Deputy General Manager" }),
  p("u_store", "Hafiz Store", "u_dep", { job_title: "Store Head", branch_id: "b_kbk", branch_name: "KBK", branch_ids: ["b_kbk"] }),
  p("u_k1", "Azman Keeper", "u_store", { job_title: "Storekeeper" }),
  p("u_k2", "Bakri Keeper", "u_store", { job_title: "Storekeeper" }),
  p("u_k3", "Chong Keeper", "u_store", { job_title: "Storekeeper" }),
  p("u_clean", "Munirah Clean", "u_dep", { job_title: "Cleaning Manager", department_id: "d_ops", department_name: "Operations" }),
  p("u_lone", "Lone Person", null),
];
const ME_OWNER: Me = { user: { id: "u_top", email: "top@example.com", name: "Ahmad Top", must_change_password: false }, workspace: { id: "w", name: "W", slug: "w", timezone: "Asia/Kuala_Lumpur" }, role: "owner", permissions: ["read", "members.manage", "office.view"] };
const ME_STAFF: Me = { ...ME_OWNER, user: { ...ME_OWNER.user, id: "u_k1", name: "Azman Keeper" }, role: "staff", permissions: ["read"] };

let chart: OrgChart;
let sent: { path: string; method: string; body: unknown }[] = [];
let phone = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  sent = [];
  phone = false;
  chart = { people: PEOPLE.map((x) => ({ ...x, editable: true })), me: "u_top", can_edit: true, whole: true, edit_scope: "all" };
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: phone && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/api/members/hierarchy") return json(chart);
    if (url.pathname.startsWith("/api/members/") && method === "PATCH") return json({});
    return json([]);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(me: Me, focus?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: () => <OrgChartView me={me} initialFocus={focus} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/organization"] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

describe("the chart's trees", () => {
  it("finds the roots, the lines and the people on their own, never looping", () => {
    const forest = buildForest(PEOPLE);
    const { trees, alone } = splitForest(forest);
    expect(trees.map((n) => n.person.name)).toEqual(["Ahmad Top"]);
    expect(trees[0]!.size).toBe(6);
    expect(alone.map((x) => x.name)).toEqual(["Lone Person"]);
    expect(ancestorsOf(PEOPLE, "u_k2")).toEqual(["u_store", "u_dep", "u_top"]);
    expect([...descendantsOf(PEOPLE, "u_dep")].sort()).toEqual(["u_clean", "u_k1", "u_k2", "u_k3", "u_store"]);
    // A loop in old data still draws everyone once.
    const loop = [p("a", "A", "b"), p("b", "B", "a")];
    const f = buildForest(loop);
    expect(f.length).toBe(1);
    expect(f[0]!.size).toBe(1);
  });

  it("keeps the managers above the people a filter finds", () => {
    const { people, matched } = filterPeople(PEOPLE, (x) => x.branch_id === "b_kbk");
    expect(people.map((x) => x.user_id).sort()).toEqual(["u_dep", "u_store", "u_top"]);
    expect([...matched!]).toEqual(["u_store"]);
  });
});

describe("OrgChartView", { timeout: 30_000 }, () => {
  it("draws boxes with titles, a team box, and the people on their own", async () => {
    show(ME_OWNER);
    const region = await screen.findByRole("region", { name: "Organization chart" });
    expect(within(region).getByText("Deputy General Manager")).toBeInTheDocument();
    // Three storekeepers with nobody under them: one list box under their head.
    const keeper = within(region).getByText("Bakri Keeper").closest("ul")!;
    expect(within(keeper).getAllByText("Storekeeper")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "Not in the chart yet" })).toHaveTextContent("Lone Person");
    expect(screen.getByText("8 people · 6 reporting lines")).toBeInTheDocument();
    // Closing a level hides the people under it.
    fireEvent.click(within(region).getByRole("button", { name: "Close the people under Hafiz Store" }));
    expect(within(region).queryByText("Bakri Keeper")).toBeNull();
  });

  it("lets an editor change who someone reports to, never under their own people", async () => {
    show(ME_OWNER);
    const region = await screen.findByRole("region", { name: "Organization chart" });
    fireEvent.pointerDown(within(region).getByRole("button", { name: "Options for Hafiz Store" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Change reports to" }));
    const dialog = await screen.findByRole("dialog", { name: "Who Hafiz Store reports to" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reports to" }));
    await screen.findByRole("combobox");
    expect(screen.queryByRole("option", { name: /Azman Keeper/ })).toBeNull(); // under him: no loop offered
    fireEvent.click(screen.getByRole("option", { name: /Munirah Clean/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toContainEqual({ path: "/api/members/u_store", method: "PATCH", body: { reports_to_user_id: "u_clean" } }));
  });

  it("P113: shows staff the organization, view only, without any way to change it", async () => {
    chart = {
      people: [
        p("u_top", "Ahmad Top", null, { job_title: "General Manager", role: null, limited: true, direct_reports: null }),
        p("u_dep", "Nora Deputy", "u_top", { role: null, limited: true, direct_reports: null }),
        p("u_store", "Hafiz Store", "u_dep", { role: null, limited: true, direct_reports: null }),
        p("u_k1", "Azman Keeper", "u_store"),
      ],
      me: "u_k1", can_edit: false, whole: false,
    };
    show(ME_STAFF, "u_k1");
    const region = await screen.findByRole("region", { name: "Organization chart" });
    expect(within(region).getByText("General Manager")).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Options for/ })).toBeNull();
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set many at once in Members" })).toBeNull();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it("P113: lets a head of department change only their own people, under their own part or above them", async () => {
    // Nora (HOD) sees her people in full; the rest by name only; she may change the store line.
    const ME_HOD: Me = { ...ME_OWNER, user: { ...ME_OWNER.user, id: "u_dep", name: "Nora Deputy" }, role: "hod", permissions: ["read", "team.manage", "office.view"] };
    chart = {
      people: [
        p("u_top", "Ahmad Top", null, { job_title: "General Manager", role: null, limited: true, direct_reports: null }),
        p("u_dep", "Nora Deputy", "u_top", { role: "hod" }),
        p("u_store", "Hafiz Store", "u_dep", { editable: true }),
        p("u_k1", "Azman Keeper", "u_store", { editable: true }),
        p("u_k2", "Bakri Keeper", "u_store", { editable: true }),
        p("u_clean", "Munirah Clean", "u_top", { role: null, limited: true, direct_reports: null }),
      ],
      me: "u_dep", can_edit: true, whole: false, edit_scope: "department",
    };
    show(ME_HOD);
    const region = await screen.findByRole("region", { name: "Organization chart" });
    expect(screen.getByText(/the people in your department/)).toBeInTheDocument();
    expect(screen.queryByText("View only")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Options for Munirah Clean" })).toBeNull();
    expect(within(region).queryByRole("button", { name: "Options for Ahmad Top" })).toBeNull();
    fireEvent.pointerDown(within(region).getByRole("button", { name: "Options for Azman Keeper" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Change reports to" }));
    const dialog = await screen.findByRole("dialog", { name: "Who Azman Keeper reports to" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reports to" }));
    await screen.findByRole("combobox");
    expect(screen.getByRole("option", { name: /Ahmad Top/ })).toBeInTheDocument(); // above her
    expect(screen.queryByRole("option", { name: /Munirah Clean/ })).toBeNull(); // not her part
    fireEvent.click(screen.getByRole("option", { name: /Bakri Keeper/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toContainEqual({ path: "/api/members/u_k1", method: "PATCH", body: { reports_to_user_id: "u_k2" } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Her own box: the people under her, never her own line.
    fireEvent.pointerDown(within(region).getByRole("button", { name: "Options for Nora Deputy" }), { button: 0, pointerType: "mouse" });
    expect(await screen.findByRole("menuitem", { name: "People under them" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Change reports to" })).toBeNull();
  });

  it("is an indented list on a phone", async () => {
    phone = true;
    show(ME_OWNER);
    const tree = await screen.findByRole("tree", { name: "Organization chart" });
    expect(within(tree).getAllByRole("treeitem").length).toBe(7);
    fireEvent.click(within(tree).getByRole("button", { name: "Close the people under Nora Deputy" }));
    expect(within(tree).getAllByRole("treeitem").length).toBe(2);
  });
});
