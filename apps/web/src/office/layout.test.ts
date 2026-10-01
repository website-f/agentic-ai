import { describe, expect, it } from "vitest";

import { buildOffice } from "./layout";
import { findPath } from "./path";
import type { OfficeAgent, OfficeSnapshot } from "./types";

const agent = (id: string, dept: string | null): OfficeAgent => ({
  id, name: id, role: "x", color: "#13895f", department_id: dept, status: "active", state: "idle",
  pending_approvals: 0, task: null, last: null,
});

function snap(agents: OfficeAgent[], depts = ["Management", "Finance", "Research", "Operations", "Data", "Writing"]): OfficeSnapshot {
  return {
    branch: { id: "b", name: "Maju", slug: "maju", color: "#000" },
    departments: depts.map((n) => ({ id: n.toLowerCase(), name: n, slug: n.toLowerCase() })),
    agents,
  };
}

describe("office layout", () => {
  it("gives every agent a desk and every desk a reachable seat", () => {
    const agents = [
      ...Array.from({ length: 7 }, (_, i) => agent(`fin${i}`, "finance")),
      agent("r1", "research"),
      agent("loose", null), // no department: hot desks
    ];
    const map = buildOffice(snap(agents));
    expect(map.desks.size).toBe(agents.length);
    const seats = [...map.desks.values()].map((d) => `${d.seat.x},${d.seat.y}`);
    expect(new Set(seats).size).toBe(seats.length);
    expect(map.rooms.some((r) => r.label === "Hot desks")).toBe(true);

    // From every seat, every shared place can be reached.
    const places = Object.values(map.zones).flat();
    for (const d of map.desks.values()) {
      for (const p of places) {
        expect(findPath(map.width, map.height, map.walkable, d.seat, p), `${d.agentId} -> ${p.x},${p.y}`).not.toBeNull();
      }
    }
  });

  it("is deterministic and has every shared zone", () => {
    const s = snap([agent("a", "finance")]);
    const a = buildOffice(s);
    const b = buildOffice(s);
    expect(a.tiles).toEqual(b.tiles);
    for (const z of ["breakroom", "library", "workshop", "bug", "podium", "meeting"] as const) {
      expect(a.zones[z].length, z).toBeGreaterThan(0);
    }
    for (const spots of Object.values(a.zones)) for (const p of spots) expect(a.walkable[p.y * a.width + p.x]).toBe(true);
  });

  it("works with one department and no agents", () => {
    const map = buildOffice(snap([], ["Finance"]));
    expect(map.desks.size).toBe(0);
    expect(map.width).toBeGreaterThan(20);
  });
});

describe("findPath", () => {
  it("walks around walls with 4-way steps", () => {
    // 5x3 grid with a wall in the middle column except the bottom row
    const w = 5, h = 3;
    const walk = [true, true, false, true, true, true, true, false, true, true, true, true, true, true, true];
    const p = findPath(w, h, walk, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(p.at(-1)).toEqual({ x: 4, y: 0 });
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i]!.x - p[i - 1]!.x) + Math.abs(p[i]!.y - p[i - 1]!.y)).toBe(1);
    expect(p.some((s) => s.y === 2)).toBe(true);
    expect(findPath(w, h, walk.map(() => false), { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
  });
});
