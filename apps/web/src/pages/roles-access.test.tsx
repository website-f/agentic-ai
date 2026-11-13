/** P92: Settings > Roles and access: the matrix (roles as columns), the phone list, and what a
 * switch saves. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RolesAccessPage } from "./roles-access";

vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  EmptyState: ({ title, action }: { title: ReactNode; action?: ReactNode }) => <div><p>{title}</p>{action}</div>,
  PageHeader: ({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) => (
    <header><h1>{title}</h1><p>{description}</p>{actions}</header>
  ),
}));

const ADMIN = ["read", "office.view", "org.read", "members.manage", "org.manage", "audit.read", "work.write", "approvals.decide", "agents.manage",
  "engine.manage", "brain.manage", "channels.manage", "vault.manage", "assistants.use", "engine.view",
  "storage.manage", "mcp.manage"];
const LEAD = ADMIN.filter((p) => !["engine.manage", "engine.view", "storage.manage", "mcp.manage"].includes(p));
const row = (role: string, def: string[], grant: string[] = [], revoke: string[] = []) => ({
  role, editable: role !== "owner", default: def, grant, revoke,
  effective: [...new Set([...def, ...grant])].filter((p) => !revoke.includes(p)),
});
const DATA = {
  roles: [row("owner", [...ADMIN, "members.assign_owner"]), row("admin", ADMIN), row("viewer", ["read", "office.view", "org.read", "engine.view"]),
    row("management", LEAD), row("hr", LEAD, [], ["audit.read"])],
  grantable: [], owner_only: ["members.assign_owner", "roles.manage", "feedback.manage"],
};

let puts: unknown[] = [];
beforeEach(() => {
  puts = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
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
  it("shows the owner locked and every editable role as a column, with what differs from the default", async () => {
    show();
    const matrix = await screen.findByTestId("roles-matrix");
    const heads = within(within(matrix).getAllByRole("row")[0]!).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads[0]).toBe("Permission");
    expect(heads[1]).toBe("Owner Locked");
    expect(heads.slice(2).map((h) => h?.replace(/\d+ changed.*/, ""))).toEqual(["Admin", "Viewer", "Management", "HR"]);
    expect(heads[5]).toContain("1 changed"); // HR without the audit log
    const ownerEngine = within(matrix).getByLabelText("AI engine: change for Owner");
    expect(ownerEngine).toHaveAttribute("aria-checked", "true");
    expect(ownerEngine).toBeDisabled();
    const engine = within(matrix).getByLabelText("AI engine: see for Management");
    expect(engine).toHaveAttribute("aria-checked", "false");
    expect(within(matrix).getByLabelText("AI engine: see for Admin")).toHaveAttribute("aria-checked", "true");
    expect(within(matrix).getByLabelText("Audit log for HR")).toHaveAttribute("aria-checked", "false");
    // Areas group the rows; each row says what it opens.
    expect(within(matrix).getByRole("columnheader", { name: "System and connections" })).toBeInTheDocument();
    expect(within(matrix).getAllByText(/Opens: .*File storage/).length).toBeGreaterThan(0);
  });

  it("reviews the changes against the defaults, then saves them as grant and revoke per role", async () => {
    show();
    const matrix = await screen.findByTestId("roles-matrix");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.click(within(matrix).getByLabelText("AI engine: see for Management"));
    fireEvent.click(within(matrix).getByLabelText("Channels for Management"));
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    fireEvent.click(save);
    const review = await screen.findByTestId("roles-review");
    expect(review).toHaveTextContent("Management");
    expect(review).toHaveTextContent("GetsAI engine: see");
    expect(review).toHaveTextContent("LosesChannels");
    expect(review).toHaveTextContent("Against the default: 1 more, 1 less.");
    expect(review).not.toHaveTextContent("HR"); // HR is not changed by this save
    expect(puts).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ roles: { hr: { grant: [], revoke: ["audit.read"] }, management: { grant: ["engine.view"], revoke: ["channels.manage"] } } });
  });

  it("resets one role to its default and finds permissions by a word", async () => {
    show();
    const matrix = await screen.findByTestId("roles-matrix");
    fireEvent.click(within(matrix).getByRole("button", { name: "Reset HR" }));
    expect(within(matrix).getByLabelText("Audit log for HR")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search permissions or pages"), { target: { value: "storage" } });
    expect(within(matrix).getByLabelText("File storage for Admin")).toBeInTheDocument();
    expect(within(matrix).queryByLabelText("Audit log for HR")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search permissions or pages"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("on a phone: pick a role, then a list of switches", async () => {
    show();
    const phone = await screen.findByTestId("roles-phone");
    // Management first; one switch per permission.
    const switches = within(phone).getAllByRole("switch");
    expect(switches.length).toBe(19);
    expect(within(phone).getByLabelText("File storage for Management")).toHaveAttribute("aria-checked", "false");
    expect(within(phone).getByLabelText("Members and roles for Management")).toHaveAttribute("aria-checked", "true");
  });

  it("says when it cannot load, with a way to try again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "owner_only", message: "Only an owner can change what each role may do." }), { status: 403, headers: { "content-type": "application/json" } })));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an owner can change what each role may do.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
