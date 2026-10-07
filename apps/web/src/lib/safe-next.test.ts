import { describe, expect, it } from "vitest";

import { safeHref, safeNext } from "./search";

describe("safeNext (where to go after signing in)", () => {
  it("keeps in-app paths, with their query and hash", () => {
    expect(safeNext("/tasks")).toBe("/tasks");
    expect(safeNext("/files?f=fl_1&page=3#top")).toBe("/files?f=fl_1&page=3#top");
  });

  it("never sends a person to another site", () => {
    for (const bad of [
      "//evil.example/x",
      String.raw`/\evil.example/x`,
      String.raw`\\evil.example`,
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example/x",
      "javascript:alert(1)",
      "tasks",
      "",
    ]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBe("/");
    }
  });

  it("falls back for anything that is not a string", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext(["/tasks"])).toBe("/");
    expect(safeNext("//evil.example", "")).toBe("");
  });

  it("safeHref rejects the backslash trick too", () => {
    expect(safeHref(String.raw`/\evil.example`)).toBeNull();
    expect(safeHref("/ok/path")).toBe("/ok/path");
  });
});
