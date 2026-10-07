import { describe, expect, it } from "vitest";

import { cronFor, researchBrief, titleFrom } from "./briefs";

describe("task composer briefs", () => {
  it("makes a title from the first real line", () => {
    expect(titleFrom("\n\n# Reconcile the bank\nmore detail")).toBe("Reconcile the bank");
    expect(titleFrom("- 1) check stock")).toBe("check stock");
    const long = titleFrom("word ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith("…")).toBe(true);
  });

  it("turns repeat presets into cron lines", () => {
    expect(cronFor("weekdays", "09:00", "")).toBe("0 9 * * 1-5");
    expect(cronFor("monday", "08:30", "")).toBe("30 8 * * 1");
    expect(cronFor("monthly", "17:05", "")).toBe("5 17 1 * *");
    expect(cronFor("daily", "", "")).toBe("0 9 * * *");
    expect(cronFor("custom", "09:00", "  15  7 * *   2 ")).toBe("15 7 * * 2");
  });

  it("asks for cited web research", () => {
    const b = researchBrief("  Glove prices in Selangor ", "report");
    expect(b.startsWith("Glove prices in Selangor\n")).toBe(true);
    expect(b).toContain("web_search");
    expect(b).toContain("publish_report");
    expect(researchBrief("x", "answer")).not.toContain("publish_report");
  });
});
