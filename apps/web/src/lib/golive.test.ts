import { describe, expect, it } from "vitest";

import { defaultHome, goLivePlan, type GoLiveCompany } from "./golive";

const co = (id: string, name: string, x: Partial<GoLiveCompany> = {}): GoLiveCompany => ({
  id, name, departments: 0, agents: 0, files: 0, members: 0, linked_folders: 0, other: 0, ...x,
});

describe("P81 start fresh for go-live", () => {
  const companies = [
    co("b1", "Maju", { agents: 2, departments: 5 }),
    co("b2", "Group Company 01 (mock)", { agents: 3, files: 4, departments: 5, other: 7 }),
    co("b3", "Group Company 02 (mock)", { departments: 2 }),
    co("b4", "Alfa", { agents: 2 }),
  ];

  it("adds up what goes and what moves", () => {
    const p = goLivePlan({ companies }, new Set(["b2", "b3"]), null);
    expect(p.removed).toBe(2);
    expect(p.departments).toBe(7);
    expect(p.other).toBe(7);
    expect(p.agents).toBe(3);
    expect(p.files).toBe(4);
    expect(p.needsHome).toBe(true);
    // Nobody picked: the kept company with the most AI workers, then by name.
    expect(p.home).toBe("b4");
    expect(p.ready).toBe(true);
    expect(p.kept.map((c) => c.id)).toEqual(["b1", "b4"]);
  });

  it("keeps the owner's pick only when it is a company that stays", () => {
    expect(goLivePlan({ companies }, new Set(["b2"]), "b1").home).toBe("b1");
    expect(goLivePlan({ companies }, new Set(["b2"]), "b2").home).toBe("b4");
  });

  it("needs no home when nothing outlives the removed companies", () => {
    const p = goLivePlan({ companies }, new Set(["b3"]), "b1");
    expect(p.needsHome).toBe(false);
    expect(p.home).toBeNull();
    expect(p.ready).toBe(true);
  });

  it("is not ready when everything goes and AI workers have nowhere to go", () => {
    const p = goLivePlan({ companies }, new Set(companies.map((c) => c.id)), null);
    expect(p.needsHome).toBe(true);
    expect(p.home).toBeNull();
    expect(p.ready).toBe(false);
    expect(defaultHome([])).toBeNull();
  });
});
