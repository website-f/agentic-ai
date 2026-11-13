import { describe, expect, it } from "vitest";

import { categoryOf, statusOf } from "@/lib/feedback";
import { navItemFor, pathAllowed } from "@/nav";

import { composeNote, type Mark } from "./annotator";

const OWNER = ["read", "office.view", "org.read", "members.manage", "org.manage", "audit.read", "work.write", "approvals.decide", "agents.manage"];

describe("P73 feedback", () => {
  it("keeps the Feedbacks page to the developer", () => {
    expect(navItemFor("/feedbacks")?.perm).toBe("feedback.manage");
    expect(pathAllowed("/feedbacks", OWNER)).toBe(false);
    expect(pathAllowed("/feedbacks", ["read", "work.write"])).toBe(false);
    expect(pathAllowed("/feedbacks", [...OWNER, "feedback.manage"])).toBe(true);
  });

  it("folds each mark's note under the general note, numbered like the picture", () => {
    const mark = (note: string): Mark => ({ id: 1, tool: "circle", color: "#ef4444", pts: [[0, 0], [10, 10]], note });
    expect(composeNote("Hard to read", [mark("not needed"), mark(" "), mark("broken")])).toBe("Hard to read\n\n(1) not needed\n(3) broken");
    expect(composeNote("", [mark("only this")])).toBe("(1) only this");
    expect(composeNote("  just words  ", [])).toBe("just words");
  });

  it("falls back to Other and New for unknown values", () => {
    expect(categoryOf("nonsense").value).toBe("other");
    expect(statusOf("nonsense").value).toBe("new");
  });
});
