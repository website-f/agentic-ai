/** P99: the Access section of the member editor (Agentic + Prima or Prima only, Prima modules),
 * the list badges, the bulk dialog, and the Prima-only landing that sends people on to Prima. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Member } from "@/lib/types";

import { AccessBadges, AccessFields, accessChanges, BulkAccessDialog, DEFAULT_ACCESS, moduleOptions, type AccessValue, type PrimaCatalog } from "./members-access";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {}, Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));

const CAT: PrimaCatalog = {
  enabled: true,
  always: ["home", "mine"],
  mine: null,
  apps: [
    { id: "home", title: "Home", blurb: "", groups: [{ title: "My work", modules: [
      { id: "home", title: "Home", blurb: "", always: true }, { id: "mine", title: "My details", blurb: "", always: true }] }] },
    { id: "equip", title: "Equipment", blurb: "", groups: [{ title: "Equipment and vehicles", modules: [
      { id: "items", title: "Items and equipment", blurb: "Issue, return, scan.", always: false },
      { id: "fleet", title: "Vehicles", blurb: "", always: false }] }] },
    { id: "pay", title: "Payroll", blurb: "", groups: [{ title: "Pay runs", modules: [{ id: "staffpay", title: "Staff payroll", blurb: "", always: false }] }] },
  ],
};

const MEMBER: Member = {
  user_id: "us_1", email: "siti@example.com", name: "Siti", role: "staff", is_active: true, must_change_password: false,
  last_login_at: null, joined_at: "2026-11-01T00:00:00Z", access: "agentic", prima_modules: null,
};

let posts: { path: string; body: unknown }[] = [];
let catalog: PrimaCatalog = CAT;
let status: object = { enabled: true, running: true, linked: true, problem: "", needs_microsoft: false };
beforeEach(() => {
  posts = [];
  catalog = CAT;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (init?.method === "POST") {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return json({ results: [{ user_id: "us_1", ok: true, message: null }], done: 1, skipped: 0 });
    }
    if (path.startsWith("/api/members/prima-modules")) return json(catalog);
    if (path.endsWith("/prima")) return json({ enabled: true, role: "pwvsb_officer", role_label: "PWVSB staff", where: "Their own Prima account.", record: "Siti" });
    if (path.startsWith("/api/prima/status")) return json(status);
    if (path.startsWith("/api/auth/me")) return json({ user: { id: "us_1", email: "siti@example.com", name: "Siti", must_change_password: false }, workspace: { id: "w", name: "W", slug: "w", timezone: "UTC" }, role: "staff", permissions: ["read"], access: "prima_only" });
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function Fields({ start = DEFAULT_ACCESS, member, onValue }: { start?: AccessValue; member?: Member; onValue: (v: AccessValue) => void }) {
  const [v, setV] = useState(start);
  return <AccessFields value={v} member={member} onChange={(n) => { setV(n); onValue(n); }} />;
}

describe("Access section", { timeout: 30_000 }, () => {
  it("offers Agentic + Prima or Prima only, then all modules or a searchable chosen list", async () => {
    const seen: AccessValue[] = [];
    wrap(<Fields member={MEMBER} onValue={(v) => seen.push(v)} />);
    expect(screen.getByRole("radio", { name: /Agentic \+ Prima/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Prima only/ }));
    expect(seen.at(-1)).toEqual({ access: "prima_only", modules: null });
    fireEvent.click(screen.getByRole("radio", { name: "Choose modules" }));
    expect(seen.at(-1)).toEqual({ access: "prima_only", modules: [] });
    // The Prima role they have and where it is set.
    expect(await screen.findByTestId("prima-role")).toHaveTextContent("Prima role: PWVSB staff");
    expect(await screen.findByText(/Always included: Home, My details/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prima modules" }));
    fireEvent.click(await screen.findByText("Items and equipment"));
    expect(seen.at(-1)).toEqual({ access: "prima_only", modules: ["items"] });
  });

  it("never offers a module the reader does not have, nor all of Prima", async () => {
    const opts = moduleOptions({ ...CAT, mine: ["items"] }, []);
    expect(opts.map((o) => [o.value, !!o.disabled])).toEqual([["items", false], ["fleet", true], ["staffpay", true]]);
    expect(opts[0]).toMatchObject({ group: "Equipment" });
    // What the person already had stays theirs to keep.
    expect(moduleOptions({ ...CAT, mine: ["items"] }, ["fleet"]).find((o) => o.value === "fleet")?.disabled).toBe(false);
    catalog = { ...CAT, mine: ["items"] };
    wrap(<Fields onValue={() => {}} start={{ access: "agentic", modules: ["items"] }} />);
    await screen.findByText("You can give only the Prima modules you have yourself.");
    expect(screen.getByRole("radio", { name: "All modules their Prima role allows" })).toBeDisabled();
  });

  it("sends only what changed", () => {
    expect(accessChanges(DEFAULT_ACCESS, DEFAULT_ACCESS)).toEqual({});
    expect(accessChanges(DEFAULT_ACCESS, { access: "prima_only", modules: null })).toEqual({ access: "prima_only" });
    expect(accessChanges({ access: "agentic", modules: ["a", "b"] }, { access: "agentic", modules: ["b", "a"] })).toEqual({});
    expect(accessChanges({ access: "agentic", modules: ["a"] }, DEFAULT_ACCESS)).toEqual({ prima_modules: null });
  });

  it("shows badges in the list only when someone is not on the defaults", () => {
    const { container, rerender } = wrap(<AccessBadges member={MEMBER} />);
    expect(container.textContent).toBe("");
    rerender(<QueryClientProvider client={new QueryClient()}><AccessBadges member={{ ...MEMBER, access: "prima_only", prima_modules: ["items", "fleet"] }} /></QueryClientProvider>);
    expect(container.textContent).toContain("Prima only");
    expect(container.textContent).toContain("2 Prima modules");
  });

  it("sets access for everyone ticked at once", async () => {
    wrap(<BulkAccessDialog userIds={["us_1", "us_2"]} open onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Prima only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: "/api/members/bulk", body: { user_ids: ["us_1", "us_2"], action: "prima", access: "prima_only", prima_modules: null } });
  });
});

describe("Prima-only landing", { timeout: 30_000 }, () => {
  it("sends a Prima-only person straight on to Prima", async () => {
    const { PrimaOnlyPage } = await import("./prima-only");
    const go = vi.fn();
    wrap(<PrimaOnlyPage go={go} />);
    await waitFor(() => expect(go).toHaveBeenCalledWith("/prima/"));
    expect(screen.getByText("Your access is Prima")).toBeInTheDocument();
  });

  it("says why when Prima cannot open yet, with Connect Microsoft", async () => {
    status = { enabled: true, running: true, linked: false, problem: "", needs_microsoft: true };
    const { PrimaOnlyPage } = await import("./prima-only");
    const go = vi.fn();
    wrap(<PrimaOnlyPage go={go} />);
    expect(await screen.findByTestId("prima-connect")).toBeInTheDocument();
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Open Prima/ })).toHaveAttribute("href", "/prima/");
  });
});
