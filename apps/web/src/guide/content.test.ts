import { describe, expect, it } from "vitest";

import routerSource from "@/router.tsx?raw";

import { FLOW_DOCS, GUIDE_GROUPS, PAGE_DOCS } from "./content";
import { ALL_SHOT_KEYS, searchGuide, shotKeys, shotOf } from "./data";
import { FIXTURE_MANIFEST } from "./fixture";
import { guidePageFor } from "./lookup";
import { SLIDES } from "./slides";
import { GUIDE_FLOWS, GUIDE_PAGES, pageById } from "./targets";

const ROUTES = new Set([...routerSource.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]!));
const TARGET_IDS = new Set(GUIDE_PAGES.flatMap((p) => p.targets.map((t) => t.id)));

describe("guide content", () => {
  it("documents every page in GUIDE_PAGES", () => {
    for (const p of GUIDE_PAGES) {
      const doc = PAGE_DOCS[p.id];
      expect(doc, p.id).toBeDefined();
      expect(doc!.purpose.length, p.id).toBeGreaterThan(20);
      expect(doc!.can.length, p.id).toBeGreaterThanOrEqual(2);
      expect(doc!.howto.length, p.id).toBeGreaterThanOrEqual(1);
      expect(doc!.who.length, p.id).toBeGreaterThan(5);
      for (const r of doc!.howto) expect(r.steps.length, `${p.id}: ${r.title}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("has no docs for pages that do not exist", () => {
    for (const id of Object.keys(PAGE_DOCS)) expect(pageById(id), id).toBeDefined();
  });

  it("points every step and spot at a target of its own page", () => {
    for (const p of GUIDE_PAGES) {
      const own = new Set(p.targets.map((t) => t.id));
      const doc = PAGE_DOCS[p.id]!;
      for (const id of Object.keys(doc.spots)) {
        expect(TARGET_IDS.has(id), `${p.id} spot ${id}`).toBe(true);
        expect(own.has(id), `${p.id} spot ${id}`).toBe(true);
      }
      for (const r of doc.howto) {
        for (const st of r.steps) {
          if (!st.target) continue;
          expect(TARGET_IDS.has(st.target), `${p.id} step target ${st.target}`).toBe(true);
          expect(own.has(st.target), `${p.id} step target ${st.target}`).toBe(true);
        }
        if (r.state) expect(p.states.map((s) => s.key), `${p.id} recipe state`).toContain(r.state);
      }
    }
  });

  it("links related pages that exist", () => {
    for (const p of GUIDE_PAGES) for (const id of PAGE_DOCS[p.id]!.related) expect(pageById(id), `${p.id} -> ${id}`).toBeDefined();
  });

  it("uses routes the router declares", () => {
    for (const p of GUIDE_PAGES) expect(ROUTES.has(p.route), p.route).toBe(true);
    for (const r of ["/guide", "/guide/$page", "/present"]) expect(ROUTES.has(r), r).toBe(true);
  });

  it("groups pages like the sidebar", () => {
    for (const p of GUIDE_PAGES) expect(GUIDE_GROUPS as readonly string[], p.id).toContain(p.group);
  });

  it("captions every recorded flow", () => {
    for (const f of GUIDE_FLOWS) {
      expect(FLOW_DOCS[f.id], f.id).toBeDefined();
      expect(FLOW_DOCS[f.id]!.steps.length, f.id).toBeGreaterThanOrEqual(2);
      expect(pageById(f.page), f.id).toBeDefined();
    }
  });

  it("finds pages by what they do", () => {
    expect(searchGuide("approve once")[0]?.page.id).toBe("approvals");
    expect(searchGuide("whatsapp").map((h) => h.page.id)).toContain("channels");
    expect(searchGuide("zzzz-nothing")).toEqual([]);
  });

  it("maps screens to their guide page for the help button", () => {
    expect(guidePageFor("/")?.id).toBe("home");
    expect(guidePageFor("/agents/abc")?.id).toBe("agents");
    expect(guidePageFor("/settings")?.id).toBe("settings");
    expect(guidePageFor("/settings/members")?.id).toBe("settings");
    expect(guidePageFor("/guide/agents")).toBeUndefined();
    expect(guidePageFor("/present")).toBeUndefined();
  });

  it("reads shots from a manifest and tolerates a missing one", () => {
    expect(shotOf(FIXTURE_MANIFEST, "agents", "desktop")?.boxes.length).toBe(3);
    expect(shotOf(FIXTURE_MANIFEST, "agents", "mobile")).toBeUndefined();
    expect(shotOf(null, "agents", "desktop")).toBeUndefined();
    expect(shotKeys(pageById("agents")!)).toEqual(["agents", "agents:new", "agents:detail"]);
  });
});

describe("presentation", () => {
  it("has a full deck with notes", () => {
    expect(SLIDES.length).toBeGreaterThanOrEqual(16);
    expect(SLIDES.length).toBeLessThanOrEqual(20);
    expect(new Set(SLIDES.map((s) => s.id)).size).toBe(SLIDES.length);
    for (const s of SLIDES) expect(s.notes.length, s.id).toBeGreaterThan(20);
  });

  it("references only shot keys and flows the capture produces", () => {
    for (const s of SLIDES) {
      if (s.shot) expect(ALL_SHOT_KEYS.has(s.shot), `${s.id} shot ${s.shot}`).toBe(true);
      if (s.phone) expect(ALL_SHOT_KEYS.has(s.phone), `${s.id} phone ${s.phone}`).toBe(true);
      if (s.video) expect(GUIDE_FLOWS.map((f) => f.id) as string[], `${s.id} video`).toContain(s.video);
    }
  });

  it("makes no absolute promises", () => {
    const text = JSON.stringify(SLIDES).toLowerCase();
    expect(text).not.toMatch(/100\s*%|replaces? (your )?staff|guarantee/);
  });
});
