import { describe, expect, it } from "vitest";

import { ALL_NAV } from "@/nav";
import routerSource from "@/router.tsx?raw";

import { FAQ, GLOSSARY, TRACKS, lessonState, parseStep, trackOfRole } from "./content";

const lessons = TRACKS.flatMap((t) => t.lessons);

/** Every path the router declares, and the search keys each route reads. */
function routes(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /path:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(routerSource))) {
    // The route's own block: from its path to the next createRoute.
    const rest = routerSource.slice(m.index);
    const end = rest.indexOf("createRoute(", 1);
    out.set(m[1]!, end > 0 ? rest.slice(0, end) : rest);
  }
  return out;
}

describe("tutorial content", () => {
  it("covers four role tracks with lessons", () => {
    expect(TRACKS.map((t) => t.id)).toEqual(["owner", "management", "staff", "approver"]);
    for (const t of TRACKS) expect(t.lessons.length).toBeGreaterThanOrEqual(5);
  });

  it("has unique lesson ids, prefixed by their track", () => {
    const ids = lessons.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TRACKS) for (const l of t.lessons) expect(l.id.startsWith(`${t.id}.`)).toBe(true);
  });

  it("keeps lessons short: 2 to 6 steps, a title and a one-line why", () => {
    for (const l of lessons) {
      expect(l.steps.length).toBeGreaterThanOrEqual(2);
      expect(l.steps.length).toBeLessThanOrEqual(6);
      expect(l.why.length).toBeLessThan(120);
      // Balanced ** markers, so no stray asterisks reach the screen.
      for (const s of l.steps) expect(s.split("**").length % 2).toBe(1);
    }
  });

  it("sends every Show me to a route that exists, with search keys that route reads", () => {
    const all = routes();
    for (const l of lessons) {
      const block = all.get(l.show.to);
      expect(block, `${l.id} -> ${l.show.to}`).toBeDefined();
      for (const key of Object.keys(l.show.search ?? {})) {
        expect(block, `${l.id}: ${l.show.to} reads ?${key}`).toMatch(new RegExp(`\\b${key}\\??:`));
      }
    }
  });

  it("is reachable from the navigation (and so the phone More sheet)", () => {
    expect(ALL_NAV.some((n) => n.to === "/tutorial" && !n.perm)).toBe(true);
    expect(routes().has("/tutorial")).toBe(true);
  });

  it("has a glossary of the core words and an FAQ", () => {
    const words = GLOSSARY.map((g) => g.term.toLowerCase());
    for (const w of ["agent", "task", "approval", "skill", "sop", "library", "workflow", "blueprint", "ai twin", "assistant", "autopilot"]) {
      expect(words).toContain(w);
    }
    expect(FAQ.length).toBeGreaterThanOrEqual(4);
  });

  it("parses UI words and works out lesson state", () => {
    expect(parseStep("Open **Tasks** now")).toEqual([
      { text: "Open ", ui: false },
      { text: "Tasks", ui: true },
      { text: " now", ui: false },
    ]);
    const l = lessons.find((x) => x.id === "owner.task")!;
    expect(lessonState(l, { task_created: true }, [])).toBe("auto");
    expect(lessonState(l, {}, ["owner.task"])).toBe("manual");
    expect(lessonState(l, undefined, undefined)).toBe(false);
    expect(trackOfRole("hod")).toBe("management");
    expect(trackOfRole("viewer")).toBe("approver");
    expect(trackOfRole("admin")).toBe("owner");
    expect(trackOfRole("staff")).toBe("staff");
  });
});
