/** P92: staff on a phone: the bottom bar (My desk, Clock in at Prima, Tasks, Chat, More) and a
 * short More sheet with nothing high-level in it. */
import { describe, expect, it } from "vitest";

import { ALL_NAV, HELP_SECTION, hubOf, moreItems, NAV, pathAllowed, sidebarItems, STAFF_TAB_BAR, TAB_BAR, TAB_TARGET, tabBarFor, type NavItem } from "./nav";

// What the API gives each role (core/security.py PERMISSIONS).
const STAFF = ["read", "work.write", "approvals.decide", "agents.own", "vault.own"];
const SUPERVISOR = ["read", "office.view", "work.write", "approvals.decide", "assistants.use"];
const VIEWER = ["read", "office.view", "org.read"];

const allowed = (i: NavItem, perms: string[]) => !i.perm || [i.perm].flat().some((p) => perms.includes(p));

/** The More sheet as the shell builds it (components/shell.tsx MobileTabBar). */
function sheet(perms: string[]) {
  const bar = tabBarFor(perms);
  return NAV.filter((s) => s.title !== HELP_SECTION)
    .map((s) => ({
      title: s.title,
      items: moreItems(sidebarItems(s.items.filter((i) => (!i.hidden || hubOf(i.to)) && allowed(i, perms)), perms).filter((i) => !i.advanced), bar),
    }))
    .filter((s) => s.items.length);
}

describe("P92: staff phone bar", () => {
  it("gives staff My desk, Clock in, Tasks and Chat", () => {
    expect(tabBarFor(STAFF)).toEqual(["/workspace", "/prima", "/tasks", "/chat"]);
    expect(STAFF_TAB_BAR.every((to) => ALL_NAV.some((n) => n.to === to))).toBe(true);
    expect(STAFF_TAB_BAR.every((to) => pathAllowed(to, STAFF))).toBe(true);
  });

  it("opens Prima on its clock screen", () => {
    expect(TAB_TARGET["/prima"]).toMatchObject({ label: "Clock in", hash: "clock" });
  });

  it("keeps today's bar for people who see the office", () => {
    expect(tabBarFor(SUPERVISOR)).toBe(TAB_BAR);
    expect(tabBarFor(VIEWER)).toBe(TAB_BAR);
    expect(TAB_BAR).toContain("/approvals");
  });
});

describe("P92: the staff More sheet", () => {
  const sections = sheet(STAFF);
  const paths = sections.flatMap((s) => s.items.map((i) => i.to));

  it("is short and grouped", () => {
    expect(paths.length).toBeLessThanOrEqual(12);
    expect(sections.map((s) => s.title)).toEqual(["Today", "Work", "Prima", "Library", "Settings"]);
  });

  it("has Approvals (no longer a tab) and Prima (its tab opens only the clock), not the tabs", () => {
    expect(paths).toContain("/approvals");
    expect(paths).toContain("/prima");
    for (const tab of ["/workspace", "/tasks", "/chat"]) expect(paths).not.toContain(tab);
  });

  it("has nothing high-level", () => {
    for (const p of ["/", "/agents", "/brain", "/skills", "/learning", "/objectives", "/ai-engine", "/organization", "/settings/members", "/activity", "/schedules", "/mcp-servers", "/settings/storage"]) {
      expect(paths, p).not.toContain(p);
    }
    expect(paths.every((p) => pathAllowed(p, STAFF))).toBe(true);
  });
});
