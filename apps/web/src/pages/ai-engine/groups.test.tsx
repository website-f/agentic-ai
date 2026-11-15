/** P105: the owner marks which models share the work, and sees each one's answer time and success. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerTime, sharedFirst, withShared, type Group, type GroupMember, type MemberStats } from "./data";
import { GroupsTab } from "./groups";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const provider = (id: string, name: string) => ({
  id, name, preset: null, base_url: "https://x.fake/v1", key_hint: "...", has_key: true, tier: "paid", priority: 100, enabled: true,
  health: "ok", cooling_seconds: 0, last_test_at: null, last_test_result: null, model_count: 1, recent_checks: [],
});

const A1: GroupMember = { provider_id: "ap_1", model_id: "DeepSeek-V4.1-Flash-1017", shared: true };
const A2: GroupMember = { provider_id: "ap_2", model_id: "arisha-gpt41-mini", shared: true };
const OA: GroupMember = { provider_id: "ap_3", model_id: "gpt-5.4-mini" };

const smart: Group = { name: "smart", label: "Smart", description: "Best quality.", members: [A1, A2, OA], kind: "chat", size: 3 };
const stats: MemberStats[] = [
  { provider_id: "ap_1", model_id: A1.model_id, calls: 140, ok: 137, success_rate: 0.979, avg_ms: 1180 },
  { provider_id: "ap_2", model_id: A2.model_id, calls: 128, ok: 90, success_rate: 0.703, avg_ms: 1900 },
];

let calls: { path: string; method: string; body?: string }[] = [];

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body as string | undefined });
    if (method === "PUT") return json({ ...smart, members: JSON.parse(String(init?.body)).members });
    if (path.startsWith("/api/ai/groups/stats")) return json(stats);
    if (path.startsWith("/api/ai/groups")) return json([smart]);
    if (path.startsWith("/api/ai/providers")) return json([provider("ap_1", "Azure AI Foundry"), provider("ap_2", "Azure AI Foundry 2"), provider("ap_3", "OpenAI")]);
    if (path.startsWith("/api/ai/models")) return json([]);
    return json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sharing the work in a model group", () => {
  it("keeps shared models on top, in their order", () => {
    expect(sharedFirst([OA, A1, A2]).map((m) => m.model_id)).toEqual([A1.model_id, A2.model_id, OA.model_id]);
    expect(withShared([A1, A2, OA], OA, true).every((m) => m.shared)).toBe(true);
    const off = withShared([A1, A2, OA], A1, false);
    expect(off.map((m) => m.model_id)).toEqual([A2.model_id, A1.model_id, OA.model_id]);
    expect("shared" in off[1]!).toBe(false);
  });

  it("writes answer times short", () => {
    expect(answerTime(850)).toBe("850 ms");
    expect(answerTime(1180)).toBe("1.2 s");
    expect(answerTime(12_400)).toBe("12 s");
  });

  it("shows who shares the work and how each model answers", async () => {
    render(wrap(<GroupsTab canManage />));
    expect(await screen.findByText(/2 models share the work and take turns/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("98% ok")).toBeInTheDocument());
    const line = screen.getByTitle("Last 24 hours: 140 calls, 137 answered, average answer time 1.2 s");
    expect(line.textContent).toBe("1.2 s · 98% ok · 140 calls");
    expect(screen.getByText("70% ok").className).toContain("text-warn"); // failing often: marked
    expect(screen.getByText("No calls in the last 24 hours")).toBeInTheDocument(); // OpenAI, unused
    const switches = screen.getAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
  });

  it("the owner turns Share on for another model and the group is saved with it", async () => {
    render(wrap(<GroupsTab canManage />));
    fireEvent.click(await screen.findByRole("switch", { name: `Share the work: ${OA.model_id}` }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/api/ai/groups/smart");
    expect(JSON.parse(put.body!).members).toEqual([A1, A2, { ...OA, shared: true }]);
  });

  it("turning Share off moves the model below the ones still sharing", async () => {
    render(wrap(<GroupsTab canManage />));
    fireEvent.click(await screen.findByRole("switch", { name: `Share the work: ${A1.model_id}` }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.method === "PUT")!.body!).members as GroupMember[];
    expect(sent.map((m) => [m.model_id, !!m.shared])).toEqual([
      [A2.model_id, true],
      [A1.model_id, false],
      [OA.model_id, false],
    ]);
  });

  it("someone who only views the AI engine sees the numbers but no switches", async () => {
    render(wrap(<GroupsTab canManage={false} />));
    expect(await screen.findByText(/2 models share the work/)).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});
