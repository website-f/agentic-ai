import { describe, expect, it } from "vitest";

import { AREAS, changesOf, effectiveOf, sameChanges, stateOf, toggle, type RoleAccess } from "./role-access";

// What the API may change (core/security.py GRANTABLE): every one has an area on the page.
const GRANTABLE = [
  "agents.manage", "agents.own", "approvals.decide", "assistants.use", "audit.read", "brain.manage", "channels.manage", "engine.manage",
  "engine.view", "finance.manage", "finance.view", "mcp.manage", "members.manage", "office.view", "org.manage", "org.read", "storage.manage",
  "team.manage", "vault.manage", "vault.own", "work.write",
];
const HR_DEFAULT = ["read", "office.view", "org.read", "members.manage", "org.manage", "audit.read", "work.write", "approvals.decide", "agents.manage",
  "brain.manage", "channels.manage", "vault.manage", "assistants.use", "finance.view", "finance.manage"];
const area = (key: string) => AREAS.find((a) => a.key === key)!;

describe("P92: Roles and access areas", () => {
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

  it("shows an area that is only partly there", () => {
    expect(stateOf(["org.read"], area("org"))).toBe("some");
    expect(stateOf(["org.read", "org.manage"], area("org"))).toBe("on");
    expect(stateOf([], area("org"))).toBe("off");
    const on = toggle({}, "viewer", ["read", "office.view", "org.read", "engine.view"], area("org"), true);
    expect(on.viewer).toEqual({ grant: ["org.manage"], revoke: [] });
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
