/** P109 guided tours: the spotlight (highlight, Next, Back, Skip, keys), the welcome tour that
 * starts by itself once, "Show me how" on a page, and the tours' data (every role, every step's
 * tour, anchors that exist in the app). */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLang } from "@/i18n";
import { stepView, type GettingStarted, type StepKey } from "@/lib/getting-started";
import { GettingStartedPage } from "@/pages/getting-started";
import { Suspense } from "react";

import { resetTourHost, TourHost } from "./host";
import { Spotlight } from "./spotlight";
import { useTour } from "./store";
import { TourButton } from "./tour-button";
import { pageTours, selectorOf, TOURS, tourById, tourFor, welcomeTour } from "./tours";

const ME = {
  user: { id: "us_siti", email: "siti@example.com", name: "Siti", must_change_password: false },
  workspace: { id: "ws_1", name: "Acme", slug: "acme", timezone: "Asia/Kuala_Lumpur" },
  role: "staff",
  permissions: ["read", "work.write", "approvals.decide", "agents.own", "vault.own"],
  access: "agentic",
};

const state = (over: Partial<GettingStarted> = {}): GettingStarted => ({
  role: "staff", group: "staff", is_developer: false,
  steps: [{ key: "email", done: true, by: "data", optional: false, manual: false }, { key: "workspace", done: false, by: null, optional: false, manual: false }],
  done: 1, total: 2, complete: false, tours_seen: [], welcome: null, resume: null, dismissed: false, ...over,
});

let sent: { url: string; method: string; body: Record<string, unknown> }[] = [];
let gs: GettingStarted = state();
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  sent = [];
  gs = state();
  localStorage.clear();
  useTour.setState({ running: null });
  resetTourHost();
  useLang.setState({ lang: "en" });
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/auth/me") return json(ME);
    if (url.pathname === "/api/getting-started") {
      if (method === "PUT") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        sent.push({ url: url.pathname, method, body });
        gs = { ...gs, ...(body.welcome !== undefined ? { welcome: body.welcome as GettingStarted["welcome"] } : {}),
          ...(body.tour_seen ? { tours_seen: [...gs.tours_seen, body.tour_seen as string] } : {}) };
      }
      return json(gs);
    }
    if (url.pathname === "/api/desk/items") return json([]);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Give an element a size on screen (jsdom has no layout). */
function sized(el: Element, box = { left: 100, top: 120, width: 200, height: 40 }) {
  (el as HTMLElement).getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) }) as DOMRect;
}

function Page({ name }: { name: string }) {
  return (
    <div>
      <h1 data-tour="page.title" ref={(el) => { if (el) sized(el); }}>{name}</h1>
      <div data-guide="desk.ask" ref={(el) => { if (el) sized(el, { left: 20, top: 200, width: 300, height: 50 }); }}>Ask</div>
      <TourButton />
    </div>
  );
}

function app(path = "/workspace") {
  const root = createRootRoute({ component: () => <><Outlet /><TourHost /></> });
  const routes = ["/workspace", "/tasks", "/welcome"].map((p) =>
    createRoute({ getParentRoute: () => root, path: p, component: () => <Page name={`Page ${p}`} /> }));
  routes.push(createRoute({ getParentRoute: () => root, path: "/getting-started", component: () => <Suspense fallback={null}><GettingStartedPage /></Suspense> }));
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: [path] }) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("the spotlight", () => {
  it("highlights the step's element and moves with Next, Back, Skip and the keyboard", async () => {
    const target = document.createElement("button");
    target.setAttribute("data-guide", "tasks.new");
    target.textContent = "New task";
    document.body.appendChild(target);
    sized(target);
    const onNext = vi.fn();
    const onBack = vi.fn();
    const onSkip = vi.fn();
    render(<Spotlight step={{ target: ["tasks.new"], title: "New task", body: "Click New task." }} index={1} count={3} title="Tasks" onNext={onNext} onBack={onBack} onSkip={onSkip} />);

    const card = await screen.findByRole("dialog", { name: "New task" });
    expect(card).toHaveAccessibleDescription("Click New task.");
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
    // The ring sits on the element (less its padding), and the card has focus.
    const ring = await waitFor(() => {
      const r = document.querySelector<HTMLElement>("[data-tour-ring]");
      expect(r).not.toBeNull();
      return r!;
    });
    expect(ring.style.left).toBe("94px");
    expect(ring.style.width).toBe("212px");
    await waitFor(() => expect(card).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onBack).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSkip).toHaveBeenCalledTimes(2);
    target.remove();
  });

  it("shows the card in the middle when the element is not on screen, or leaves the step out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onMissing = vi.fn();
    render(<Spotlight step={{ target: ["nowhere.here"], title: "Gone", body: "Not here.", skip: true }} index={0} count={2} title="T"
      onNext={() => {}} onBack={() => {}} onSkip={() => {}} onMissing={onMissing} />);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(onMissing).toHaveBeenCalledTimes(1);
    cleanup();
    render(<Spotlight step={{ title: "Hello", body: "Centre." }} index={0} count={1} title="T" onNext={() => {}} onBack={() => {}} onSkip={() => {}} />);
    expect(await screen.findByRole("dialog", { name: "Hello" })).toBeInTheDocument();
    expect(document.querySelector("[data-tour-ring]")).toBeNull();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });

  it("offers Bahasa Melayu first on a welcome card", async () => {
    render(<Spotlight step={{ title: "Welcome", body: "Hi.", language: true }} index={0} count={2} title="T" onNext={() => {}} onBack={() => {}} onSkip={() => {}} />);
    const group = await screen.findByRole("group", { name: "Language" });
    const buttons = group.querySelectorAll("button");
    expect(buttons[0]).toHaveTextContent("Bahasa Melayu");
    fireEvent.click(buttons[0]!);
    expect(useLang.getState().lang).toBe("ms");
  });
});

describe("the welcome tour", () => {
  it("starts by itself the first time, once, and is saved as skipped", async () => {
    app("/workspace");
    expect(await screen.findByRole("dialog", { name: "Welcome to Agentic Office" }, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(sent.some((s) => s.body.welcome === "started")).toBe(true));
    expect(useTour.getState().running).toMatchObject({ id: "welcome-staff", user: "us_siti", step: 0 });

    // Next: the desk's ask box is highlighted.
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByRole("dialog", { name: "My workspace: your own desk" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("[data-tour-ring]")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(sent.some((s) => s.body.welcome === "skipped" && s.body.resume === null)).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("agentic.tour")).toBeNull();

    // Opening the app again: no tour by itself.
    cleanup();
    resetTourHost();
    app("/workspace");
    await screen.findByText("Page /workspace");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("waits while staff hire their AI worker", async () => {
    app("/welcome");
    await screen.findByText("Page /welcome");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("carries on after a refresh where it was", async () => {
    gs = state({ welcome: "started" });
    localStorage.setItem("agentic.tour", JSON.stringify({ id: "welcome-staff", step: 1, user: "us_siti" }));
    useTour.setState({ running: { id: "welcome-staff", step: 1, user: "us_siti" } });
    app("/workspace");
    expect(await screen.findByRole("dialog", { name: "My workspace: your own desk" })).toBeInTheDocument();
  });
});

describe("Show me how", () => {
  it("re-runs a page's tour from the button, and marks it seen at the end", async () => {
    gs = state({ welcome: "done" });
    app("/tasks");
    const button = await screen.findByRole("button", { name: /Show me how: a short tour of Tasks/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByRole("dialog", { name: "All the work in one place" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("[data-tour-ring]")).not.toBeNull());
    // The other steps' buttons are not on this test page: they are left out, and the tour ends.
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(sent.some((s) => s.body.tour_seen === "tasks")).toBe(true), { timeout: 20_000 });
    expect(screen.queryByRole("dialog")).toBeNull();
    // ...and again, any time.
    fireEvent.click(screen.getByRole("button", { name: /Show me how/ }));
    expect(await screen.findByRole("dialog", { name: "All the work in one place" })).toBeInTheDocument();
  }, 30_000);
});

describe("the Getting started page", () => {
  it("lists the role's steps, ticks one by hand, and starts any page's tour", async () => {
    gs = state({
      welcome: "skipped",
      steps: [
        { key: "email", done: true, by: "data", optional: false, manual: false },
        { key: "workspace", done: false, by: null, optional: false, manual: false },
        { key: "library", done: false, by: null, optional: false, manual: true },
      ],
      done: 1, total: 3,
    });
    app("/getting-started");
    expect(await screen.findByText("Connect your Microsoft email")).toBeInTheDocument();
    expect(screen.getByText("Set up your workspace")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.getByText(/Your steps as Staff/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Mark as done/ }));
    await waitFor(() => expect(sent.some((x) => JSON.stringify(x.body.mark) === '{"library":true}')).toBe(true));
    // No auto-start once the welcome tour was skipped; the page starts tours by hand.
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Tasks/ }));
    await waitFor(() => expect(useTour.getState().running?.id).toBe("tasks"));
  }, 20_000);
});

describe("the tours", () => {
  it("has a welcome tour for every role group and a tour for each main page", () => {
    for (const g of ["owner", "admin", "branch", "hod", "staff"] as const) expect(welcomeTour(g).welcome).toBe(g);
    for (const p of ["/workspace", "/my-worker", "/tasks", "/approvals", "/chat", "/explorer", "/handoffs", "/forms", "/reports", "/settings/members", "/organization", "/mail", "/settings", "/channels", "/getting-started"]) {
      expect(tourFor(p, ["office.view", "agents.own", "members.manage", "assistants.use"]), p).toBeDefined();
    }
    expect(tourFor("/files", [])?.id).toBe("library");
    expect(tourFor("/settings/members", ["members.manage"])?.id).toBe("members");
    expect(tourFor("/settings/members", ["read"])?.id).toBe("settings"); // without Members: the Settings tour
    expect(pageTours(ME.permissions).map((t) => t.id)).not.toContain("members");
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
    for (const t of TOURS) expect(t.steps.length, t.id).toBeGreaterThan(0);
  });

  it("shows how to do every Getting started step with a tour that exists", () => {
    const keys: StepKey[] = ["welcome", "account", "email", "language", "system_mail", "workspace_settings", "ai_engine", "companies", "prima_map",
      "library_sources", "members", "roles", "team", "workspace", "own_ai", "ai_custom", "library", "first_task", "approvals", "phone"];
    for (const perms of [["agents.own"], ["assistants.use", "team.manage"]]) {
      for (const k of keys) {
        const v = stepView(k, perms);
        if (v.tour) expect(tourById(v.tour), `${k} -> ${v.tour}`).toBeDefined();
      }
    }
  });

  it("points only at anchors the app has (or the Microsoft 365 page may add)", () => {
    const SRC = join(__dirname, "..");
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
    });
    const text = files(SRC).map((f) => readFileSync(f, "utf-8")).join("\n");
    const OPTIONAL = new Set(["mail.tabs", "mail.connect", "mail.accounts", "mail.drafts", "outlook.connection", "assistants.chat", "assistants.quick"]);
    for (const t of TOURS) for (const s of t.steps) for (const a of s.target ?? []) {
      if (a.startsWith("nav:") || a.startsWith("css:") || OPTIONAL.has(a)) continue;
      expect(text.includes(`"${a}"`), `${t.id}: ${a}`).toBe(true);
    }
    expect(selectorOf("nav:/tasks")).toContain('a[href="/tasks"]');
    expect(selectorOf("tasks.new")).toBe('[data-tour~="tasks.new"], [data-guide="tasks.new"]');
  });
});
