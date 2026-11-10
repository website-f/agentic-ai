/** P97: the member editor's organisation parts: a department made from the dropdown, and who a
 * head of department manages (searchable ticks, "Everyone in Finance", one save). */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Me, Member } from "@/lib/types";

import { NewDepartment, OrgLine, TeamDialog } from "./members-org";

const m = (id: string, name: string, extra: Partial<Member> = {}): Member => ({
  user_id: id, email: `${id}@example.com`, name, role: "staff", is_active: true, must_change_password: false, last_login_at: null,
  joined_at: "2026-11-01T00:00:00Z", department_id: "dp_fin", department_name: "Finance", ...extra,
});
const HANA = m("u_hana", "Hana", { role: "hod", heads_department: true, manages: 1 });
const ALL = [HANA, m("u_sara", "Sara", { reports_to_user_id: "u_hana", reports_to_name: "Hana" }), m("u_tom", "Tom"), m("u_omar", "Omar", { department_id: "dp_ops", department_name: "Operations" })];
const OWNER: Me = { user: { id: "u_owner", email: "o@example.com", name: "Owner", must_change_password: false }, workspace: { id: "ws", name: "W", slug: "w", timezone: "Asia/Kuala_Lumpur" }, role: "owner", permissions: ["read", "members.manage", "org.manage"] };
const HOD: Me = { ...OWNER, user: { ...OWNER.user, id: "u_hana" }, role: "hod", permissions: ["read", "team.manage"] };

let sent: { path: string; method: string; body: unknown }[] = [];
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  sent = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/api/members/u_hana/team") return method === "PUT" ? json({ done: 2, skipped: 0, results: [] }) : json([ALL[1]]);
    if (url.pathname === "/api/members") return json(ALL);
    if (url.pathname.endsWith("/departments")) return json({ id: "dp_new", branch_id: "br_1", name: "Procurement", slug: "procurement", position: 9 });
    return json([]);
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("Who a head of department manages", { timeout: 30_000 }, () => {
  it("ticks people (search, everyone in the department) and saves the whole list", async () => {
    const closed = vi.fn();
    wrap(<TeamDialog member={HANA} me={OWNER} open onOpenChange={closed} />);
    const group = await screen.findByRole("group", { name: "People Hana manages" }, { timeout: 10_000 });
    await waitFor(() => expect(screen.getByLabelText("Sara")).toBeChecked());
    expect(group).toHaveTextContent("Tom");
    fireEvent.change(screen.getByPlaceholderText("Search by name or place"), { target: { value: "oper" } });
    expect(screen.queryByLabelText("Tom")).toBeNull();
    fireEvent.click(screen.getByLabelText("Omar"));
    fireEvent.change(screen.getByPlaceholderText("Search by name or place"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Everyone in Finance" }));
    expect(screen.getByLabelText("Tom")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("PUT");
    expect([...(sent[0]!.body as { user_ids: string[] }).user_ids].sort()).toEqual(["u_omar", "u_sara", "u_tom"]);
  });

  it("is read only for the head of department themselves", async () => {
    wrap(<TeamDialog member={HANA} me={HOD} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Sara")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("shows who heads, manages and reports to whom under a name", () => {
    wrap(<><OrgLine member={HANA} onTeam={() => {}} /><OrgLine member={ALL[1]!} /></>);
    expect(screen.getByText("Head of Finance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manages 1 person" })).toBeInTheDocument();
    expect(screen.getByText("Reports to Hana")).toBeInTheDocument();
  });
});

describe("A new department from the member editor", { timeout: 30_000 }, () => {
  it("adds it to the branch and picks it", async () => {
    const made = vi.fn();
    wrap(<NewDepartment branchId="br_1" onMade={made} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("New department name"), { target: { value: "Procurement" } });
    fireEvent.click(screen.getByRole("button", { name: "Add department" }));
    await waitFor(() => expect(made).toHaveBeenCalledWith(expect.objectContaining({ id: "dp_new", name: "Procurement" })));
    expect(sent[0]).toEqual({ path: "/api/branches/br_1/departments", method: "POST", body: { name: "Procurement" } });
  });
});
