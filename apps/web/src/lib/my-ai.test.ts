import { describe, expect, it } from "vitest";

import { ALL_NAV, NAV } from "@/nav";
import routerSource from "@/router.tsx?raw";

import { assistantsFallback, canAssist, myAiTab } from "./my-ai";

// The role tables as the API serialises them (core/security.py).
const STAFF = ["agents.own", "approvals.decide", "read", "vault.own", "work.write"];
const SUPERVISOR = ["approvals.decide", "assistants.use", "read", "work.write"];
const OPERATOR = ["org.read", "read", "work.write"];

/** What the sidebar shows (components/shell.tsx): not hidden, and the permission allows it. */
function sidebar(perms: string[]): string[] {
  return NAV.flatMap((s) => s.items)
    .filter((i) => !i.hidden && (!i.perm || [i.perm].flat().some((p) => perms.includes(p))))
    .map((i) => i.to);
}

describe("P30: one personal AI per person", () => {
  it("gives staff one entry, My AI, and no assistants", () => {
    const seen = sidebar(STAFF);
    expect(seen).toContain("/my-worker");
    expect(seen).not.toContain("/assistants");
    expect(seen).not.toContain("/twin");
    const myAi = ALL_NAV.find((n) => n.to === "/my-worker")!;
    expect(myAi.label).toBe("My AI");
    expect(myAi.also).toContain("/twin"); // the twin page counts as My AI
  });

  it("keeps assistants for people who manage others", () => {
    expect(sidebar(SUPERVISOR)).toContain("/assistants");
    expect(sidebar(SUPERVISOR)).not.toContain("/my-worker");
    expect(sidebar(OPERATOR)).not.toContain("/assistants");
    expect(ALL_NAV.find((n) => n.to === "/assistants")!.perm).toBe("assistants.use");
  });

  it("sends people without assistants to their AI, or their desk", () => {
    expect(canAssist(STAFF)).toBe(false);
    expect(canAssist(SUPERVISOR)).toBe(true);
    expect(assistantsFallback(STAFF)).toBe("/my-worker");
    expect(assistantsFallback(OPERATOR)).toBe("/workspace");
    // The /assistants route guards with these (a link cannot open the page).
    const block = routerSource.slice(routerSource.indexOf('path: "/assistants"'));
    expect(block.slice(0, block.indexOf("createRoute("))).toMatch(/canAssist\(context\.me\.permissions\)/);
  });

  it("knows which My AI tab a page is", () => {
    expect(myAiTab("/my-worker")).toBe("today");
    expect(myAiTab("/twin")).toBe("profile");
    expect(myAiTab("/twin", "tasks")).toBe("tasks");
    expect(myAiTab("/twin", "nonsense")).toBe("profile");
  });
});
