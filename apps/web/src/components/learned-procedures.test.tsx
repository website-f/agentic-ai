/** P96: the agent page shows what the agent does from memory, the tokens that saved, and the
 * switch and Forget only to someone who manages it. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AgentSavings, LearnedProcedures, type Procedure } from "./learned-procedures";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function proc(over: Partial<Procedure> = {}): Procedure {
  return {
    id: "rt_1", name: "Tender status check", description: "", status: "active", steps: 4, tools: ["browser_open"],
    browser: true, own: true, learned_here: true, uses: 3, successes: 3, failures: 0, tokens_saved: 42_000,
    last_used_at: new Date().toISOString(), note: null, can_forget: true, ...over,
  };
}

function detail(over: Partial<AgentSavings> = {}, items: Procedure[] = [proc()]) {
  return {
    agent_id: "ag_1", agent_name: "Rina", replay: true, office_on: true, can_manage: true, procedures: items.length,
    active: items.length, replays: 3, tokens_saved: 42_000, answers_reused: 2, answer_tokens_saved: 8_000, items, ...over,
  };
}

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LearnedProcedures", () => {
  it("shows the procedures and the tokens saved, and the manager switches replay off", async () => {
    const calls: { path: string; method: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      calls.push({ path, method: init?.method ?? "GET", body: init?.body as string | undefined });
      return json(init?.method === "PUT" ? { replay: false } : detail());
    }));
    render(wrap(<LearnedProcedures agentId="ag_1" name="Rina" />));
    expect(await screen.findByText("Tender status check")).toBeInTheDocument();
    expect(screen.getByText(/3 jobs done from memory, 2 answers reused: 50k tokens saved/)).toBeInTheDocument();
    expect(screen.getByText(/in the browser/)).toBeInTheDocument();
    expect(screen.getByText(/its own, for one person/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && c.path === "/api/procedures/agents/ag_1")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === "PUT")!.body!)).toEqual({ replay: false });
  });

  it("someone who only sees the agent gets no switch and no Forget", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(detail({ can_manage: false }, [proc({ can_forget: false, own: false, learned_here: false })]))));
    render(wrap(<LearnedProcedures agentId="ag_1" name="Rina" />));
    expect(await screen.findByText("Tender status check")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /Forget/ })).toBeNull();
    expect(screen.getByText(/learned by a colleague/)).toBeInTheDocument();
  });
});
