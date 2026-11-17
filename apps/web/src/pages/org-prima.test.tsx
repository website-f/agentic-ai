/** P111: each company's Prima link on the Organization page: linked (its Prima name), not linked
 * with why and "Add to Prima" (its SSM details, sent to the office API), or its name differs in
 * Prima with Prima's reason and "Try again". */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { codeHint, draftReady, emptyDraft, PrimaLinkCell } from "./org-prima";

let calls: { method: string; path: string; body: unknown }[] = [];
let answer: Record<string, unknown> = {};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DATA = {
  companies: [{ id: "co-maju", name: "Maju Sdn Bhd" }],
  branches: [
    { id: "br_1", name: "MAJU SDN BHD", company_id: "co-maju", suggestion: null, link: { state: "linked", code: "matched", message: "", made: false } },
    {
      id: "br_2", name: "BARU SECURITY", company_id: null, suggestion: null, code_hint: "BS",
      link: { state: "not_linked", code: "details_needed", message: "Prima has no company called BARU SECURITY yet.", made: false },
    },
    {
      id: "br_3", name: "MAJU HOLDINGS", company_id: "co-maju", suggestion: null,
      link: { state: "name_differs", code: "name_differs", message: "Give a valid formatted SSM registration reference.", made: false },
    },
  ],
};

beforeEach(() => {
  calls = [];
  answer = { outcome: "made", company_id: "co-bs", link: { state: "linked", code: "made", message: "", made: true } };
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://office.test");
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === "/api/prima/companies") return json(DATA);
    if (url.pathname.endsWith("/sync")) return json(answer);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(branchId: string, name: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: () => <PrimaLinkCell branchId={branchId} name={name} canManage /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/organization"] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
}

describe("Prima link of a company", () => {
  it("makes the same code as the API and checks Prima's lengths", () => {
    expect(codeHint("ARENA WIRAJAYA SDN BHD")).toBe("AW");
    expect(codeHint("EAGLE 999 SDN BHD")).toBe("E999");
    expect(codeHint("PRISMA")).toBe("PRISMA");
    expect(draftReady(emptyDraft())).toBe(false);
    expect(draftReady({ ssm_no: "202601009999", state: "Johor", source_ref: "SSM", reason: "Joins", code: "" })).toBe(true);
    expect(draftReady({ ssm_no: "202601009999", state: "Johor", source_ref: "SSM", reason: "Joins", code: "A B" })).toBe(false);
  });

  it("shows a linked company by its Prima name", async () => {
    show("br_1", "Maju Sdn Bhd");
    expect(await screen.findByText("Maju Sdn Bhd")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Prima" })).toBeNull();
  });

  it("adds a company Prima lacks with its SSM details", async () => {
    show("br_2", null);
    expect(await screen.findByText("Not linked")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Add to Prima" }));
    expect(await screen.findByText("Prima has no company called BARU SECURITY yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Company code in Prima")).toHaveValue("BS");
    const add = screen.getAllByRole("button", { name: "Add to Prima" }).at(-1)!;
    expect(add).toBeDisabled(); // nothing invented: the SSM details first
    fireEvent.change(screen.getByLabelText("SSM registration number"), { target: { value: "202601009999 (1234567-X)" } });
    fireEvent.change(screen.getByLabelText("Primary state"), { target: { value: "Selangor" } });
    fireEvent.change(screen.getByLabelText("Source document"), { target: { value: "SSM profile (mock)" } });
    fireEvent.change(screen.getByLabelText("Why it is added"), { target: { value: "Joins the group (mock)" } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(calls.some((c) => c.path === "/api/prima/companies/br_2/sync")).toBe(true));
    const sent = calls.find((c) => c.path === "/api/prima/companies/br_2/sync")!;
    expect(sent.method).toBe("POST");
    expect(sent.body).toEqual({
      details: { ssm_no: "202601009999 (1234567-X)", state: "Selangor", source_ref: "SSM profile (mock)", reason: "Joins the group (mock)", code: "BS" },
    });
    await waitFor(() => expect(screen.queryByLabelText("SSM registration number")).toBeNull()); // closed
  });

  it("keeps the dialog open with Prima's reason when Prima refuses", async () => {
    answer = { outcome: "refused", company_id: null, link: { state: "not_linked", code: "refused", message: "SSM number 1 is already on X.", made: false } };
    show("br_2", null);
    fireEvent.click(await screen.findByRole("button", { name: "Add to Prima" }));
    fireEvent.change(screen.getByLabelText("SSM registration number"), { target: { value: "202601009999" } });
    fireEvent.change(screen.getByLabelText("Primary state"), { target: { value: "Johor" } });
    fireEvent.change(screen.getByLabelText("Source document"), { target: { value: "SSM" } });
    fireEvent.change(screen.getByLabelText("Why it is added"), { target: { value: "Joins" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Prima" }).at(-1)!);
    expect(await screen.findByText("SSM number 1 is already on X.")).toBeInTheDocument();
    expect(screen.getByLabelText("SSM registration number")).toBeInTheDocument();
  });

  it("tries a rename Prima refused again", async () => {
    answer = { outcome: "renamed", company_id: "co-maju", link: { state: "linked", code: "renamed", message: "", made: false } };
    show("br_3", "Maju Sdn Bhd");
    expect(await screen.findByText("Name differs in Prima")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Give a valid formatted SSM registration reference.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" }).at(-1)!);
    await waitFor(() => expect(calls.find((c) => c.path === "/api/prima/companies/br_3/sync")?.body).toEqual({}));
  });
});
