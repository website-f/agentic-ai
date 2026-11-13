/** P96: the skill sheet shows publishing buttons only to someone the server lets publish this
 * skill (`can_publish`): a supervisor, or a HOD looking at a skill every agent uses, gets
 * "Suggest a change" and no Retire or Restore, never a button that ends in "not allowed". */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillDetail } from "@/lib/skills";
import { SkillSheet } from "./skill-sheet";

function skill(canPublish: boolean): SkillDetail {
  return {
    id: "sk_1", name: "meeting-notes", description: "Turn notes into decisions and actions.", version: 2,
    trust: "builtin", status: "active", branch_id: null, agent_ids: [], created_by: "system",
    created_by_name: "Built in", approved_by_name: null, created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-02T00:00:00Z", last_used_at: null,
    stats: { uses: 0, accepted: 0, sent_back: 0, failed: 0, success_rate: null, avg_tokens: null },
    baseline_tokens: null, saved_pct: null, pending: 0, body: "## Steps\n1. Read.",
    versions: [
      { version: 2, description: "d", body: "b2", note: "Updated", created_by_name: "A", approved_by_name: null, created_at: "2026-11-02T00:00:00Z" },
      { version: 1, description: "d", body: "b1", note: "Built in", created_by_name: "A", approved_by_name: null, created_at: "2026-11-01T00:00:00Z" },
    ],
    uses: [], eval_cases: [], last_eval: null, proposals: [], can_publish: canPublish,
  };
}

function serve(body: unknown) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const data = url.includes("/api/agents") ? [] : body;
      return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SkillSheet id="sk_1" canWrite onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("skill sheet buttons follow what the server allows", () => {
  it("someone who may publish it edits, retires, restores a version and chooses who uses it", async () => {
    serve(skill(true));
    open();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: /^Edit$/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Retire/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Restore version 1/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("radiogroup", { name: "Who can use it" })).toBeInTheDocument();
  });

  it("someone who may not only suggests a change and reads who uses it", async () => {
    serve(skill(false));
    open();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("button", { name: /Suggest a change/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Retire/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Restore version/ })).toBeNull();
    expect(within(dialog).queryByRole("radiogroup", { name: "Who can use it" })).toBeNull();
    expect(within(dialog).getByText("Every agent.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Reference files")).toBeNull();
  });

  it("P102: a skill brought in from a folder lists its reference files", async () => {
    serve({ ...skill(true), files: [{ file: "references/portal-guide.md", chars: 7752 }, { file: "tools.md", chars: 1381 }] });
    open();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Reference files")).toBeInTheDocument();
    expect(within(dialog).getByText("references/portal-guide.md")).toBeInTheDocument();
    expect(within(dialog).getByText("tools.md")).toBeInTheDocument();
  });
});
