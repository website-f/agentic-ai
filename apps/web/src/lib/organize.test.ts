import { describe, expect, it } from "vitest";

import { cleanKeywords, folderGroups } from "./organize";

describe("P149c keywords and sorting preview", () => {
  it("cleans keywords the way the server keeps them", () => {
    expect(cleanKeywords(" Payroll, Nov  2026 ;HR,payroll, #Urgent ")).toEqual(["payroll", "nov 2026", "hr", "urgent"]);
    expect(cleanKeywords(["A", "a", ""])).toEqual(["a"]);
    expect(cleanKeywords(Array.from({ length: 30 }, (_, i) => `k${i}`))).toHaveLength(20);
    expect(cleanKeywords("x".repeat(60))[0]).toHaveLength(40);
  });

  it("groups the proposed folders, sorted ones first and the biggest first", () => {
    const groups = folderGroups([
      { name: "a.pdf", folder: "Payroll/2026/11", sorted: true },
      { name: "b.pdf", folder: "", sorted: false },
      { name: "c.pdf", folder: "Payroll/2026/11", sorted: true },
      { name: "d.pdf", folder: "Leave/2026/11", sorted: true },
    ]);
    expect(groups.map((g) => [g.folder, g.names.length])).toEqual([
      ["Payroll/2026/11", 2],
      ["Leave/2026/11", 1],
      ["", 1],
    ]);
  });
});
