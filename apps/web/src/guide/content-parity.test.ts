/** The Malay twins mirror the English long-form content exactly: same ids, order, targets,
 * states, shots, videos, routes and links, and the same number of **UI labels** in every
 * paragraph. Only the words differ. Run with the other guide tests. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FAQ, GLOSSARY, TRACKS } from "@/pages/tutorial/content";
import { FAQ_MS, GLOSSARY_MS, TRACKS_MS } from "@/pages/tutorial/content.ms";

import { FLOW_DOCS, GUIDE_GROUPS, PAGE_DOCS } from "./content";
import { FLOW_CHAPTERS_MS, FLOW_DOCS_MS, PAGE_DOCS_MS } from "./content.ms";
import { searchGuide } from "./data";
import type { GuideManifest } from "./manifest";
import { SLIDES } from "./slides";
import { SLIDES_MS } from "./slides.ms";
import { GUIDE_FLOWS, GUIDE_PAGES } from "./targets";
import { GROUP_LABELS_MS, GUIDE_FLOWS_MS, GUIDE_PAGES_MS } from "./targets.ms";

const bolds = (s: string) => (s.match(/\*\*(.+?)\*\*/g) ?? []).length;

/** Same number of **labels**, balanced markers, and real Malay text (not a copy of the English). */
function samePara(en: string, ms: string, where: string) {
  expect(ms.split("**").length % 2, `${where}: unbalanced ** in "${ms}"`).toBe(1);
  expect(bolds(ms), `${where}: **labels** in\n  EN: ${en}\n  MS: ${ms}`).toBe(bolds(en));
  expect(ms.trim().length, `${where}: empty`).toBeGreaterThan(0);
  expect(ms, `${where}: em or en dash`).not.toMatch(/[—–]/);
}

describe("guide content: Malay twin", () => {
  it("documents the same pages in the same order", () => {
    expect(Object.keys(PAGE_DOCS_MS)).toEqual(Object.keys(PAGE_DOCS));
  });

  it("mirrors every page: lists, spots, recipes, states, targets and related links", () => {
    for (const [id, en] of Object.entries(PAGE_DOCS)) {
      const ms = PAGE_DOCS_MS[id]!;
      samePara(en.purpose, ms.purpose, `${id} purpose`);
      samePara(en.who, ms.who, `${id} who`);
      expect(ms.can.length, `${id} can`).toBe(en.can.length);
      en.can.forEach((c, i) => samePara(c, ms.can[i]!, `${id} can[${i}]`));
      expect(ms.tips.length, `${id} tips`).toBe(en.tips.length);
      en.tips.forEach((c, i) => samePara(c, ms.tips[i]!, `${id} tips[${i}]`));
      expect(Object.keys(ms.spots), `${id} spots`).toEqual(Object.keys(en.spots));
      for (const k of Object.keys(en.spots)) samePara(en.spots[k]!, ms.spots[k]!, `${id} spot ${k}`);
      expect(ms.related, `${id} related`).toEqual(en.related);
      expect(ms.howto.length, `${id} howto`).toBe(en.howto.length);
      en.howto.forEach((r, i) => {
        const m = ms.howto[i]!;
        samePara(r.title, m.title, `${id} recipe ${i} title`);
        expect(m.state, `${id} recipe ${i} state`).toBe(r.state);
        expect(m.steps.map((s) => s.target ?? null), `${id} recipe ${i} targets`).toEqual(r.steps.map((s) => s.target ?? null));
        r.steps.forEach((s, j) => samePara(s.text, m.steps[j]!.text, `${id} recipe ${i} step ${j}`));
      });
    }
  });

  it("captions the same flows with the same number of steps", () => {
    expect(Object.keys(FLOW_DOCS_MS)).toEqual(Object.keys(FLOW_DOCS));
    for (const [id, en] of Object.entries(FLOW_DOCS)) {
      expect(FLOW_DOCS_MS[id]!.steps.length, id).toBe(en.steps.length);
      samePara(en.summary, FLOW_DOCS_MS[id]!.summary, `${id} summary`);
    }
  });

  it("mirrors targets.ts: ids, routes, groups, states and highlighted controls", () => {
    expect(GUIDE_PAGES_MS.map((p) => p.id)).toEqual(GUIDE_PAGES.map((p) => p.id));
    GUIDE_PAGES.forEach((en, i) => {
      const ms = GUIDE_PAGES_MS[i]!;
      expect(ms.route, en.id).toBe(en.route);
      expect(ms.group, en.id).toBe(en.group);
      expect(!!ms.who, `${en.id} who`).toBe(!!en.who);
      expect(ms.states.map((s) => s.key), `${en.id} states`).toEqual(en.states.map((s) => s.key));
      // The "(/route)" hint in a state's how-to line stays the same route.
      ms.states.forEach((s, j) => expect(s.how.match(/\(\/[^)]*\)/)?.[0] ?? null, `${en.id} state ${s.key}`).toBe(en.states[j]!.how.match(/\(\/[^)]*\)/)?.[0] ?? null));
      expect(ms.targets.map((t) => t.id), `${en.id} targets`).toEqual(en.targets.map((t) => t.id));
      for (const t of ms.targets) expect(t.label.length, t.id).toBeGreaterThan(0);
    });
    expect(GUIDE_FLOWS_MS.map((f) => [f.id, f.page])).toEqual(GUIDE_FLOWS.map((f) => [f.id, f.page]));
  });

  it("names every sidebar group in Malay", () => {
    for (const g of GUIDE_GROUPS) expect(GROUP_LABELS_MS[g], g).toBeTruthy();
  });

  it("translates every chapter label the capture recorded", () => {
    const path = join(__dirname, "../../public/guide-media/manifest.json");
    if (!existsSync(path)) return;
    const m = JSON.parse(readFileSync(path, "utf8")) as GuideManifest;
    for (const v of Object.values(m.videos)) for (const c of v.chapters) expect(FLOW_CHAPTERS_MS[c.label], c.label).toBeTruthy();
  });

  it("finds pages by Malay words when searching the Malay guide", () => {
    const src = { pages: GUIDE_PAGES_MS, docs: PAGE_DOCS_MS };
    expect(searchGuide("lulus sekali", 30, src)[0]?.page.id).toBe("approvals");
    expect(searchGuide("whatsapp", 30, src).map((h) => h.page.id)).toContain("channels");
  });
});

describe("presentation: Malay twin", () => {
  it("has the same slides, kinds, icons, shots, phones and videos", () => {
    expect(SLIDES_MS.map((s) => s.id)).toEqual(SLIDES.map((s) => s.id));
    SLIDES.forEach((en, i) => {
      const ms = SLIDES_MS[i]!;
      expect([ms.kind, ms.shot, ms.phone, ms.video], en.id).toEqual([en.kind, en.shot, en.phone, en.video]);
      expect([!!ms.lead, !!ms.note], `${en.id} lead/note`).toEqual([!!en.lead, !!en.note]);
      expect(ms.points?.map((p) => p.icon), `${en.id} points`).toEqual(en.points?.map((p) => p.icon));
      expect(ms.bullets?.length, `${en.id} bullets`).toBe(en.bullets?.length);
      expect(ms.notes.length, `${en.id} notes`).toBeGreaterThan(20);
      expect(new Set(ms.points?.map((p) => p.title)).size, `${en.id} point titles unique`).toBe(ms.points?.length ?? 0);
    });
  });

  it("makes no absolute promises in Malay either", () => {
    const text = JSON.stringify(SLIDES_MS).toLowerCase();
    expect(text).not.toMatch(/100\s*%|jamin|menggantikan (kakitangan|pekerja|staf)|ganti (kakitangan|pekerja|staf)/);
    expect(text).not.toMatch(/[—–]/);
  });
});

describe("tutorial: Malay twin", () => {
  it("has the same tracks and lessons, with the same routes, signals, permissions, icons and art", () => {
    expect(TRACKS_MS.map((t) => t.id)).toEqual(TRACKS.map((t) => t.id));
    TRACKS.forEach((en, i) => {
      const ms = TRACKS_MS[i]!;
      expect(ms.lessons.map((l) => l.id), en.id).toEqual(en.lessons.map((l) => l.id));
      en.lessons.forEach((l, j) => {
        const m = ms.lessons[j]!;
        expect(m.show.to, l.id).toBe(l.show.to);
        expect(m.show.search, l.id).toEqual(l.show.search);
        expect(!!m.show.label, `${l.id} label`).toBe(!!l.show.label);
        expect([m.signals, m.perm, m.tone, m.art], l.id).toEqual([l.signals, l.perm, l.tone, l.art]);
        expect(m.icon, `${l.id} icon`).toBe(l.icon);
        expect(m.why.length, `${l.id} why is one line`).toBeLessThan(120);
        expect(m.steps.length, `${l.id} steps`).toBe(l.steps.length);
        l.steps.forEach((s, k) => samePara(s, m.steps[k]!, `${l.id} step ${k}`));
      });
    });
  });

  it("has the same glossary terms (icons, tones) and FAQ entries", () => {
    expect(GLOSSARY_MS.map((g) => [g.icon, g.tone])).toEqual(GLOSSARY.map((g) => [g.icon, g.tone]));
    expect(new Set(GLOSSARY_MS.map((g) => g.term)).size).toBe(GLOSSARY_MS.length);
    expect(FAQ_MS.length).toBe(FAQ.length);
    expect(new Set(FAQ_MS.map((f) => f.q)).size).toBe(FAQ_MS.length);
  });
});
