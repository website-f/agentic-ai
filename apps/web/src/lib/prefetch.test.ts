import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { warmApprovals, warmDesk, warmShell } from "./prefetch";
import { approvalsQuery } from "./work";

function fakeApi(bodies: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const path = url.split("?")[0]!;
      return new Response(JSON.stringify(bodies[path] ?? []), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.unstubAllGlobals());

describe("a page's first data, asked for early (P104)", () => {
  it("asks for what the page asks for, with the same keys", async () => {
    const calls = fakeApi({});
    const qc = new QueryClient();
    warmApprovals(qc, false);
    await settle();
    expect(calls).toEqual(["/api/approvals?state=pending"]);
    expect(qc.getQueryData(approvalsQuery("pending").queryKey)).toEqual([]);
  });

  it("on a hover, asks only for what is not known at all", async () => {
    const calls = fakeApi({});
    const qc = new QueryClient();
    qc.setQueryData(approvalsQuery("pending").queryKey, [], { updatedAt: 0 }); // known, but old
    warmApprovals(qc, true);
    await settle();
    expect(calls).toEqual([]);
    warmApprovals(qc, false); // opening the page refreshes it, as the page itself would
    await settle();
    expect(calls).toEqual(["/api/approvals?state=pending"]);
  });

  it("asks for the shell's data once, not on every page", async () => {
    const calls = fakeApi({ "/api/branches": [], "/api/me/prefs": {}, "/api/system/status": {} });
    const qc = new QueryClient();
    warmShell(qc);
    await settle();
    warmShell(qc);
    await settle();
    expect([...calls].sort()).toEqual(["/api/branches", "/api/me/prefs", "/api/system/status"]);
  });

  it("asks for the workspace's sections that show, as soon as the desk says so", async () => {
    const desk = { layout: { sections: [{ id: "ai", hidden: true }] }, may_assist: true, can_ask: true };
    const calls = fakeApi({ "/api/desk": desk });
    const qc = new QueryClient();
    warmDesk(qc, false, undefined);
    await settle();
    await settle();
    expect(calls).toContain("/api/desk");
    expect(calls).toContain("/api/forms");
    expect(calls).toContain("/api/me/assigned-tasks");
    expect(calls).toContain("/api/desk/meetings"); // Today shows and the person may have meetings
    expect(calls).not.toContain("/api/me/allowance"); // the AI section is hidden
  });

  it("another desk tab asks only for the desk", async () => {
    const calls = fakeApi({});
    const qc = new QueryClient();
    warmDesk(qc, false, "files");
    await settle();
    expect([...calls].sort()).toEqual(["/api/desk", "/api/desk/items"]);
  });
});
