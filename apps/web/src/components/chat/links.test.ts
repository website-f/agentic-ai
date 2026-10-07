import { describe, expect, it } from "vitest";

import { chatRoute, safeFrom, taskIdIn } from "./links";

describe("safeFrom", () => {
  it("keeps same-origin paths, with their query", () => {
    expect(safeFrom("/chat")).toBe("/chat");
    expect(safeFrom("/assistants?a=ag_1&tab=chat")).toBe("/assistants?a=ag_1&tab=chat");
    expect(safeFrom("/agents/ag_01j9")).toBe("/agents/ag_01j9");
    expect(safeFrom("/")).toBe("/");
  });

  it("refuses other sites and anything that is not a path", () => {
    expect(safeFrom("//evil.example")).toBeUndefined();
    expect(safeFrom("///evil.example")).toBeUndefined();
    expect(safeFrom("/\\evil.example")).toBeUndefined();
    expect(safeFrom("\\\\evil.example")).toBeUndefined();
    expect(safeFrom("https://evil.example")).toBeUndefined();
    expect(safeFrom("javascript:alert(1)")).toBeUndefined();
    expect(safeFrom("chat")).toBeUndefined();
    expect(safeFrom("")).toBeUndefined();
    expect(safeFrom("/\tevil")).toBeUndefined();
    expect(safeFrom("/ok\nLocation: x")).toBeUndefined();
    expect(safeFrom(undefined)).toBeUndefined();
    expect(safeFrom(42)).toBeUndefined();
    expect(safeFrom(["/chat"])).toBeUndefined();
    expect(safeFrom(`/${"a".repeat(3000)}`)).toBeUndefined();
  });
});

describe("chatRoute", () => {
  it("drops an unsafe from and an empty session", () => {
    expect(chatRoute("ag_1", { from: "//x", session: "" })).toEqual({
      to: "/chat/$agentId", params: { agentId: "ag_1" }, search: { from: undefined, session: undefined },
    });
    expect(chatRoute("ag_1", { from: "/chat", session: "cs_1" }).search).toEqual({ from: "/chat", session: "cs_1" });
  });
});

describe("taskIdIn", () => {
  it("finds a task id in a reply", () => {
    expect(taskIdIn('Created task tk_01j9z8x7w6v5t4s3r2q1p0n9m8 for Aisyah: "Quote"')).toBe("tk_01j9z8x7w6v5t4s3r2q1p0n9m8");
    expect(taskIdIn("No task here.")).toBeUndefined();
    expect(taskIdIn(null)).toBeUndefined();
  });
});
