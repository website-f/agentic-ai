/** P97: the desk as each person's virtual desk: the person's own order of blocks (hidden ones
 * left out), Today with what needs them and their work (the slot for tasks people assign them),
 * pins in their folders, pins they can no longer open shown as unavailable, opening pins the
 * right way, renaming and moving a pin, and saving the layout on the server. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { layoutOf, pinTarget, type Desk, type Pin } from "@/lib/desk";

import { DeskHome, unavailable } from "./home";

// The theme store reads the system theme when it loads.
vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

vi.mock("@/components/task-composer/quick-kinds", () => ({ GiveTaskPanel: () => <div>give-task</div> }));
vi.mock("@/components/allowance-meter", () => ({ AllowanceMeter: () => null }));
vi.mock("@/pages/workflows/run", () => ({ StartRunDialog: () => null }));
vi.mock("./hub", () => ({
  DeskShortcuts: () => <nav aria-label="Go to">shortcuts</nav>,
  HowDoI: () => <div>how-do-i</div>,
}));
vi.mock("./ask", () => ({ AskPanel: () => <div>ask-panel</div> }));

const STAFF = ["read", "work.write", "approvals.decide", "agents.own", "vault.own"];
const ME = { user: { id: "u_me", name: "Nur Aisyah", email: "nur@example.com" }, role: "staff", permissions: STAFF };

const pin = (id: string, extra: Partial<Pin>): Pin => ({
  id, kind: "sop", ref: `r_${id}`, title: id, sub: "", status: null, mime: null, url: `/sops?sop=r_${id}`, missing: false, folder: null, label: null, ...extra,
});

function desk(extra: Partial<Desk> = {}): Desk {
  return {
    person: { name: "Nur Aisyah", role: "staff", company: "Maju", department: "Finance" },
    can_ask: true,
    may_assist: false,
    agents: [],
    assignable: [],
    pins: [
      pin("p1", { title: "Claims SOP", name: "Claims checking", label: "Claims SOP", folder: "Every month" }),
      pin("p2", { kind: "link", ref: "https://www.eperolehan.gov.my/", url: "https://www.eperolehan.gov.my/", title: "ePerolehan", sub: "www.eperolehan.gov.my" }),
      pin("p3", { kind: "route", ref: "/settings/members", url: "/settings/members", title: "Members" }),
      pin("p4", { kind: "task", title: "Old task", missing: true }),
    ],
    procedures: { sops: [], sop_total: 0, workflows: [], workflow_total: 0 },
    work: [
      { id: "t1", title: "Prepare the aging report", status: "running", source: "desk", agent_id: "a1", agent_name: "Aisyah's twin", from_me: true, result: "", note: null, updated_at: new Date().toISOString(), made: [], url: "/tasks?task=t1" },
    ],
    waiting: {
      approvals: [{ id: "ap1", kind: "question", tool_name: "ask_human", reason: "Which address should the reminder go to?", task_id: "t2", task_title: "Chase invoice", created_at: new Date().toISOString() }],
      reviews: [],
      documents: [],
    },
    recent_searches: [],
    layout: { sections: [{ id: "pinned", hidden: false }, { id: "today", hidden: false }, { id: "recent", hidden: true }], folders: ["Every month", "Tenders"] },
    files: [],
    file_counts: { total: 0, agent: 0, uploaded: 0 },
    documents: [],
    document_total: 0,
    ...extra,
  };
}

let calls: { method: string; path: string; body: unknown }[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/api/auth/me") return json(ME);
    if (url.pathname === "/api/forms") return json([]);
    if (url.pathname === "/api/desk/items" && method === "GET") return json([]);
    if (url.pathname.startsWith("/api/desk/items/")) return json(pin("p1", {}));
    if (url.pathname === "/api/desk/layout") return json(layoutOf(undefined));
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(d: Desk = desk()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], ME);
  qc.setQueryData(["desk", "home"], d);
  function Home(): ReactNode {
    return <DeskHome desk={qc.getQueryData<Desk>(["desk", "home"]) ?? d} onTab={() => {}} customizing={false} onCustomize={() => {}} />;
  }
  const root = createRootRoute({ component: Home });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/workspace"] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return { qc, router };
}

describe("the desk's rules", () => {
  it("shows every block once, in the person's order, new ones last", () => {
    const l = layoutOf({ layout: { sections: [{ id: "goto", hidden: true }, { id: "today", hidden: false }], folders: [] } });
    expect(l.sections.map((s) => s.id)).toEqual(["goto", "today", "pinned", "recent", "ai", "howto"]);
    expect(l.sections.filter((s) => s.hidden).map((s) => s.id)).toEqual(["goto"]);
    expect(layoutOf(undefined).sections.every((s) => !s.hidden)).toBe(true);
  });

  it("marks a pin unavailable when it is gone or its page is not for this role", () => {
    expect(unavailable(pin("a", { missing: true }), STAFF)).toBe(true);
    expect(unavailable(pin("b", { kind: "route", ref: "/settings/members" }), STAFF)).toBe(true);
    expect(unavailable(pin("c", { kind: "route", ref: "/tasks?task=x" }), STAFF)).toBe(false);
    expect(unavailable(pin("d", { kind: "route", ref: "/prima#clock" }), STAFF)).toBe(false);
    expect(unavailable(pin("e", { kind: "route", ref: "/settings/members?add=1" }), ["members.manage"])).toBe(false);
  });

  it("opens a web link in a new tab, Prima as its own app, the rest in place", () => {
    expect(pinTarget({ kind: "link", url: "https://x.example/" })).toEqual({ href: "https://x.example/", how: "tab" });
    expect(pinTarget({ kind: "route", url: "/prima/#clock" }).how).toBe("page");
    expect(pinTarget({ kind: "route", url: "/prima#clock" }).how).toBe("app");
    expect(pinTarget({ kind: "sop", url: "/sops?sop=1" }).how).toBe("app");
  });
});

describe("DeskHome", { timeout: 30_000 }, () => {
  it("lays out the person's blocks and leaves hidden ones out", async () => {
    const { container } = { container: document.body };
    show();
    await screen.findByRole("region", { name: "Pinned" });
    const order = [...container.querySelectorAll("[data-desk-section]")].map((e) => e.getAttribute("data-desk-section"));
    expect(order).toEqual(["pinned", "today", "ai", "howto", "goto"]); // recent is hidden
    expect(screen.getByRole("button", { name: /Search or jump to anything/ })).toBeInTheDocument();
  });

  it("puts what needs the person first, next to the work on their plate", async () => {
    show();
    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).getByText("Which address should the reminder go to?")).toBeInTheDocument();
    expect(within(today).getByRole("link", { name: "Answer" })).toHaveAttribute("href", "/approvals");
    // The slot the team's assigned tasks drop into.
    const plate = today.querySelector("[data-slot=assigned-to-me]") as HTMLElement;
    expect(within(plate).getByText("Prepare the aging report")).toBeInTheDocument();
    expect(within(plate).getByText("Working")).toBeInTheDocument();
  });

  it("keeps pins in folders, and never opens one the person can no longer see", async () => {
    show();
    const pinned = await screen.findByRole("region", { name: "Pinned" });
    expect(within(pinned).getByRole("heading", { name: "Every month" })).toBeInTheDocument();
    expect(within(pinned).getByRole("heading", { name: "Tenders" })).toBeInTheDocument(); // an empty folder still shows
    const gone = within(pinned).getByRole("button", { name: /Old task/ });
    expect(gone).toBeDisabled();
    expect(gone).toHaveTextContent("Not available");
    expect(within(pinned).getByRole("button", { name: /Members/ })).toBeDisabled();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    fireEvent.click(within(pinned).getByRole("button", { name: /ePerolehan/ }));
    expect(open).toHaveBeenCalledWith("https://www.eperolehan.gov.my/", "_blank", "noopener,noreferrer");
  });

  it("renames a pin and moves it to another folder", async () => {
    show();
    const more = await screen.findByRole("button", { name: "Claims SOP: more" });
    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename or move to a folder" }));
    const name = await screen.findByLabelText("Name on your desk");
    fireEvent.change(name, { target: { value: "Monthly claims SOP" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toBe("/api/desk/items/p1");
    expect(patch.body).toEqual({ label: "Monthly claims SOP", folder: "Every month" });
  });

  it("unpins at once from the pin's menu", async () => {
    const { qc } = show();
    const more = await screen.findByRole("button", { name: "ePerolehan: more" });
    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unpin" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/desk/items/p2")).toBe(true));
    expect(qc.getQueryData<Desk>(["desk", "home"])!.pins.map((p) => p.id)).not.toContain("p2");
  });
});

describe("Customize", { timeout: 30_000 }, () => {
  it("hides a block and saves the order on the server", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["me"], ME);
    qc.setQueryData(["desk", "home"], desk());
    const root = createRootRoute({ component: () => <DeskHome desk={desk()} onTab={() => {}} customizing onCustomize={() => {}} /> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/workspace"] }) });
    render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Show Today" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/desk/layout")).toBe(true));
    const put = calls.find((c) => c.path === "/api/desk/layout")!;
    expect(put.method).toBe("PUT");
    const sections = (put.body as { sections: { id: string; hidden: boolean }[] }).sections;
    expect(sections.map((s) => s.id)).toEqual(["pinned", "today", "recent", "ai", "howto", "goto"]);
    expect(sections.find((s) => s.id === "today")!.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move Pinned down" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/desk/layout")).toHaveLength(2));
    const second = calls.filter((c) => c.path === "/api/desk/layout")[1]!.body as { sections: { id: string }[] };
    expect(second.sections[0]!.id).toBe("today");
  });
});
