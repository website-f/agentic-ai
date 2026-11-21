/** P121b: the guide's copy of Prima's SOP catalog (prima-sops.json) matches Prima's own (apps/prima/apps/web/src/sop),
 * every flow is complete in both languages, and the office passes its links on to Prima. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { primaScreen } from "@/lib/prima-screen";

import data from "./prima-sops.json";
import { primaHash, searchPrimaSops, type PrimaSops } from "./prima-sops";

const sops = data as PrimaSops;
const PRIMA = join(__dirname, "../../../prima/apps/web/src/sop/areas");

describe("Prima SOPs in the guide", () => {
  it("is the same as Prima's own catalog", async () => {
    if (!existsSync(PRIMA)) return; // the office image is built without apps/prima
    // @ts-expect-error: a plain .mjs build script
    const { buildPrimaSops } = await import("../../scripts/prima-sops.mjs");
    const now = JSON.stringify(buildPrimaSops()) + "\n";
    const saved = readFileSync(join(__dirname, "prima-sops.json"), "utf8").replace(/\r\n/g, "\n");
    expect(saved === now, "src/guide/prima-sops.json is out of date: run node scripts/prima-sops.mjs in apps/web").toBe(true);
  });

  it("has every flow in both languages, with unique ids and a known app", () => {
    expect(sops.sops.length).toBeGreaterThan(150);
    const apps = new Set(sops.apps.map((a) => a.id));
    const ids = new Set<string>();
    for (const s of sops.sops) {
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      expect(apps.has(s.app), s.id).toBe(true);
      for (const t of [s.title, s.purpose, s.starter, ...s.steps.flatMap((x) => [x.who, x.does]), ...s.rules]) {
        expect(t.en.trim() && t.ms.trim(), s.id).toBeTruthy();
      }
    }
  });

  it("opens every step's screen and every flow inside the office's Prima", () => {
    for (const s of sops.sops) {
      expect(primaScreen(`#sop/${s.id}`), s.id).toBe(`#sop/${s.id}`);
      for (const p of [s.start, ...s.steps.map((x) => x.where)]) {
        if (p) expect(primaScreen(`#${primaHash(p)}`), `${s.id} ${primaHash(p)}`).not.toBe("");
      }
    }
    expect(primaScreen("#purchasing/store")).toBe("#purchasing/store");
    expect(primaScreen("#clock")).toBe("#clock");
    expect(primaScreen("#a/b/c")).toBe("");
    expect(primaScreen("#x\"><")).toBe("");
  });

  it("finds a flow by English or Malay words", () => {
    expect(searchPrimaSops(sops, "uniform").some((s) => s.id === "equip-uniform-request")).toBe(true);
    expect(searchPrimaSops(sops, "pengawal uniform").length).toBeGreaterThan(0);
    expect(searchPrimaSops(sops, "zzzz-nothing")).toEqual([]);
  });
});
