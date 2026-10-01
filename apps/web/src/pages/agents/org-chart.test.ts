import { describe, expect, it } from "vitest";

import type { Agent } from "@/lib/work";

import { buildTree } from "./org-chart";

const agent = (id: string, reports_to: string | null, role_kind: Agent["role_kind"] = "leaf") =>
  ({ id, name: id, reports_to, role_kind }) as Agent;

describe("org chart tree", () => {
  it("nests agents under their manager, leads first", () => {
    const tree = buildTree([agent("cara", "olivia"), agent("ali", "olivia"), agent("olivia", null, "orchestrator"), agent("zed", null)]);
    expect(tree.map((n) => n.agent.id)).toEqual(["olivia", "zed"]);
    expect(tree[0]?.kids.map((n) => n.agent.id)).toEqual(["ali", "cara"]);
  });

  it("puts agents whose manager is in another company at the top", () => {
    const tree = buildTree([agent("ali", "someone-elsewhere")]);
    expect(tree.map((n) => n.agent.id)).toEqual(["ali"]);
  });

  it("still shows every agent if old data has a loop", () => {
    const tree = buildTree([agent("a", "b"), agent("b", "a")]);
    expect(tree.map((n) => n.agent.id).sort()).toEqual(["a", "b"]);
  });
});
