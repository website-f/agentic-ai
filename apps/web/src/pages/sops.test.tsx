/** P107: the SOPs list is a data table: search, filters kept in the address, a row opens the
 * SOP, and ticked rows are deleted in one call after a confirm. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SopsPage } from "./sops";

vi.mock("@/components/page", () => ({
  Page: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  IconTile: () => null,
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}));
vi.mock("./library-hub/hub", () => ({ LibraryHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header> }));

const ME = { user: { id: "u_me", name: "Owner One", email: "owner@example.com" }, role: "owner", permissions: ["read", "org.manage"], scope: { kind: "all" } };
const BRANCHES = [
  { id: "br_1", name: "Maju Sdn Bhd", color: "#000", departments: [{ id: "d_fin", name: "Finance" }] },
  { id: "br_2", name: "Jaya Bhd", color: "#000", departments: [] },
];
const sop = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `s${i}`, scope: "workspace", scope_id: null, scope_label: "Every company", title: `Procedure ${String(i).padStart(2, "0")}`,
  body: "", version: 1 + (i % 3), updated_by: null, updated_at: new Date(Date.now() - i * 60_000).toISOString(), status: "active", ...extra,
});
const SOPS = [
  ...Array.from({ length: 30 }, (_, i) => sop(i)),
  sop(40, { title: "Month-end close", scope: "branch", scope_id: "br_2", scope_label: "Jaya Bhd" }),
  sop(41, { title: "Petty cash claims", scope: "department", scope_id: "d_fin", scope_label: "Finance, Maju Sdn Bhd", status: "draft" }),
];

let posts: { path: string; body: unknown }[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  posts = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    if (init?.method === "POST") {
      posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
      return json({ files: 0, sops: 2, skipped: [] });
    }
    if (url.pathname === "/api/sops") return json(SOPS);
    if (url.pathname === "/api/branches") return json(BRANCHES);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(at = "/sops") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["me"], ME);
  const root = createRootRoute({ component: SopsPage });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: [at] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("SOPs", { timeout: 30_000 }, () => {
  it("lists every SOP in a table with numbered pages", async () => {
    show();
    const table = await screen.findByRole("table", { name: "SOPs" });
    expect(within(table).getAllByRole("row")).toHaveLength(26); // heading + 25
    expect(screen.getByText("Showing 1 to 25 of 32")).toBeInTheDocument();
    // Every company's first, then one company's, then a department's (the draft, on page 2).
    expect(within(table).queryByText("Draft")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(within(screen.getByRole("table", { name: "SOPs" })).getByText("Draft")).toBeInTheDocument();
  });

  it("filters from the address and finds words once typing settles", async () => {
    const router = show("/sops?company=br_2");
    const table = await screen.findByRole("table", { name: "SOPs" });
    // Jaya Bhd: every company's SOPs and its own, not Maju's Finance one.
    await waitFor(() => expect(screen.getByText("Showing 1 to 25 of 31")).toBeInTheDocument());
    expect(within(table).queryByText("Petty cash claims")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "month end" } });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: "month end", company: "br_2" }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: "SOPs" })).getAllByRole("row")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Month-end close" })).toBeInTheDocument();
  });

  it("opens a SOP from its row and keeps the table's place", async () => {
    const router = show("/sops?page=2");
    fireEvent.click(await screen.findByRole("button", { name: /^Petty cash claims/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ sop: "s41", page: 2 }));
  });

  it("deletes the ticked SOPs after a confirm", async () => {
    show("/sops?status=draft");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Petty cash claims" }));
    const bar = screen.getByRole("region", { name: "Ticked rows" });
    fireEvent.click(within(bar).getByRole("button", { name: "Delete ticked" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete 1 SOP?" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    await waitFor(() => expect(posts).toEqual([{ path: "/api/library/delete", body: { files: [], sops: ["s41"] } }]));
  });
});
