/** P92: Settings > Roles and access: the matrix (roles as columns), the phone list, and what a
 * switch saves. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RolesAccessPage } from "./roles-access";

vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) => (
    <header><h1>{title}</h1><p>{description}</p>{actions}</header>
  ),
}));

const ADMIN = ["read", "office.view", "org.read", "members.manage", "org.manage", "audit.read", "work.write", "approvals.decide", "agents.manage",
  "engine.manage", "brain.manage", "channels.manage", "vault.manage", "assistants.use", "finance.view", "finance.manage", "engine.view",
  "storage.manage", "mcp.manage"];
const LEAD = ADMIN.filter((p) => !["engine.manage", "engine.view", "storage.manage", "mcp.manage"].includes(p));
const row = (role: string, def: string[], grant: string[] = [], revoke: string[] = []) => ({
  role, editable: role !== "owner", default: def, grant, revoke,
  effective: [...new Set([...def, ...grant])].filter((p) => !revoke.includes(p)),
});
const DATA = {
  roles: [row("owner", [...ADMIN, "members.assign_owner"]), row("admin", ADMIN), row("viewer", ["read", "office.view", "org.read", "engine.view"]),
    row("management", LEAD), row("hr", LEAD, [], ["audit.read"])],
  grantable: [], owner_only: ["members.assign_owner", "roles.manage", "crm.access", "feedback.manage"],
};

let puts: unknown[] = [];
beforeEach(() => {
  puts = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/org/role-access" && init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(DATA), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(DATA), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RolesAccessPage /></QueryClientProvider>);
}

describe("Roles and access", { timeout: 30_000 }, () => {
  it("shows every editable role as a column, never the owner, and what differs from the default", async () => {
    show();
    const matrix = await screen.findByTestId("roles-matrix");
    const heads = within(matrix).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads[0]).toBe("Area");
    expect(heads.slice(1).map((h) => h?.replace(/\d+ changed/, ""))).toEqual(["Admin", "Viewer", "Management", "HR"]);
    expect(heads[4]).toContain("1 changed"); // HR without the audit log
    const engine = within(matrix).getByLabelText("AI engine: see for Management");
    expect(engine).toHaveAttribute("aria-checked", "false");
    expect(within(matrix).getByLabelText("AI engine: see for Admin")).toHaveAttribute("aria-checked", "true");
    expect(within(matrix).getByLabelText("Audit log for HR")).toHaveAttribute("aria-checked", "false");
  });

  it("saves what the owner switched, as grant and revoke per role", async () => {
    show();
    const matrix = await screen.findByTestId("roles-matrix");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.click(within(matrix).getByLabelText("AI engine: see for Management"));
    fireEvent.click(within(matrix).getByLabelText("Money: change for Management"));
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ roles: { hr: { grant: [], revoke: ["audit.read"] }, management: { grant: ["engine.view"], revoke: ["finance.manage"] } } });
  });

  it("on a phone: pick a role, then a list of switches", async () => {
    show();
    const phone = await screen.findByTestId("roles-phone");
    // Management first; one switch per area.
    const switches = within(phone).getAllByRole("switch");
    expect(switches.length).toBeGreaterThan(15);
    expect(within(phone).getByLabelText("File storage for Management")).toHaveAttribute("aria-checked", "false");
    expect(within(phone).getByLabelText("Members and roles for Management")).toHaveAttribute("aria-checked", "true");
  });
});
