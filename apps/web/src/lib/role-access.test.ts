import { describe, expect, it } from "vitest";

import { AREAS, changesOf, diffOf, effectiveOf, opensOf, resetRole, sameChanges, SECTIONS, stateOf, toggle, type RoleAccess, type RoleAccessRole } from "./role-access";

// What the API may change (core/security.py GRANTABLE): every one has an area on the page.
const GRANTABLE = [
  "agents.manage", "agents.own", "approvals.decide", "assistants.use", "audit.read", "brain.manage", "channels.manage", "engine.manage",
  "engine.view", "finance.manage", "finance.view", "mcp.manage", "members.manage", "office.view", "org.manage", "org.read", "storage.manage",
  "team.manage", "vault.manage", "vault.own", "work.write",
];
const HR_DEFAULT = ["read", "office.view", "org.read", "members.manage", "org.manage", "audit.read", "work.write", "approvals.decide", "agents.manage",
  "brain.manage", "channels.manage", "vault.manage", "assistants.use", "finance.view", "finance.manage"];
const area = (key: string) => AREAS.find((a) => a.key === key)!;

describe("P92/P98: Roles and access rows", () => {
  it("covers every permission the owner may change, never an owner-only one or read", () => {
    const covered = new Set(AREAS.flatMap((a) => a.perms));
    expect([...covered].sort()).toEqual([...GRANTABLE].sort());
    for (const p of ["members.assign_owner", "roles.manage", "crm.access", "feedback.manage", "read"]) expect(covered.has(p)).toBe(false);
  });

  it("turns an area on and off as the smallest change from the defaults", () => {
    let c = toggle({}, "hr", HR_DEFAULT, area("engine-see"), true);
    expect(c).toEqual({ hr: { grant: ["engine.view"], revoke: [] } });
    expect(stateOf(effectiveOf(HR_DEFAULT, c.hr), area("engine-see"))).toBe("on");
    c = toggle(c, "hr", HR_DEFAULT, area("audit"), false);
    expect(c.hr).toEqual({ grant: ["engine.view"], revoke: ["audit.read"] });
    // Back to the default: no change left for the role.
    c = toggle(toggle(c, "hr", HR_DEFAULT, area("engine-see"), false), "hr", HR_DEFAULT, area("audit"), true);
    expect(c).toEqual({});
  });

  it("has one row per permission, each in an area, with the pages it opens", () => {
    for (const a of AREAS) {
      expect(a.perms).toHaveLength(1);
      expect(SECTIONS).toContain(a.section);
    }
    expect(stateOf(["org.read"], area("org-see"))).toBe("on");
    expect(stateOf([], area("org-change"))).toBe("off");
    expect(opensOf(area("engine-see"))).toContain("AI Engine");
    expect(opensOf(area("storage"))).toEqual(["File storage"]);
    expect(opensOf(area("members"))).toContain("Members and roles");
    const on = toggle({}, "viewer", ["read", "office.view", "org.read", "engine.view"], area("org-change"), true);
    expect(on.viewer).toEqual({ grant: ["org.manage"], revoke: [] });
  });

  it("resets one role and says what a save changes against the defaults", () => {
    const roles = [
      { role: "hr", editable: true, default: HR_DEFAULT, effective: [], grant: [], revoke: [] },
      { role: "viewer", editable: true, default: ["read", "office.view"], effective: [], grant: [], revoke: [] },
      { role: "owner", editable: false, default: [], effective: [], grant: [], revoke: [] },
    ] as unknown as RoleAccessRole[];
    const saved = { hr: { grant: ["engine.view"], revoke: [] } };
    const draft = { hr: { grant: ["engine.view"], revoke: ["audit.read"] }, viewer: { grant: ["work.write"], revoke: [] } };
    expect(resetRole(draft, "viewer")).toEqual({ hr: draft.hr });
    const d = diffOf(roles, draft, saved);
    expect(d.map((x) => x.role)).toEqual(["hr", "viewer"]);
    expect(d[0]).toEqual({ role: "hr", added: ["engine.view"], removed: ["audit.read"], turnsOn: [], turnsOff: ["audit.read"] });
    expect(d[1]).toEqual({ role: "viewer", added: ["work.write"], removed: [], turnsOn: ["work.write"], turnsOff: [] });
    // Resetting a saved change shows as turning it off.
    expect(diffOf(roles, {}, saved)).toEqual([{ role: "hr", added: [], removed: [], turnsOn: [], turnsOff: ["engine.view"] }]);
  });

  it("reads the saved changes and compares drafts", () => {
    const data = { roles: [
      { role: "owner", editable: false, default: [], effective: [], grant: [], revoke: [] },
      { role: "hr", editable: true, default: HR_DEFAULT, effective: [], grant: ["engine.view"], revoke: [] },
      { role: "staff", editable: true, default: [], effective: [], grant: [], revoke: [] },
    ], grantable: GRANTABLE, owner_only: [] } as unknown as RoleAccess;
    expect(changesOf(data)).toEqual({ hr: { grant: ["engine.view"], revoke: [] } });
    expect(sameChanges({ hr: { grant: ["engine.view"], revoke: [] } }, changesOf(data))).toBe(true);
    expect(sameChanges({}, changesOf(data))).toBe(false);
  });
});
