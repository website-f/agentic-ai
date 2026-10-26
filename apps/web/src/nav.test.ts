import { describe, expect, it } from "vitest";

import { navItemFor, pathAllowed } from "./nav";

// What the API gives a staff member and an owner (core/security.py PERMISSIONS).
const STAFF = ["read", "work.write", "approvals.decide", "agents.own", "vault.own"];
const OWNER = [
  "read", "office.view", "org.read", "members.manage", "org.manage", "audit.read", "work.write", "approvals.decide",
  "agents.manage", "engine.manage", "brain.manage", "channels.manage", "vault.manage", "assistants.use",
  "finance.view", "finance.manage", "members.assign_owner",
];

describe("P36: one guard for pages and the sidebar", () => {
  it("keeps staff to their own desk, their AI and their work", () => {
    for (const path of ["/workspace", "/my-worker", "/twin", "/tasks", "/tasks/tk_1", "/approvals", "/chat", "/files", "/library", "/settings", "/logins"]) {
      expect(pathAllowed(path, STAFF), path).toBe(true);
    }
    for (const path of [
      "/", "/overview", "/agents", "/agents/ag_1", "/agents/new", "/office", "/monitor", "/brain", "/skills", "/learning",
      "/organization", "/schedules", "/ai-engine", "/activity", "/settings/members", "/settings/ai-use", "/objectives", "/money",
    ]) {
      expect(pathAllowed(path, STAFF), path).toBe(false);
    }
  });

  it("lets the owner everywhere", () => {
    for (const path of ["/", "/agents/ag_1", "/brain", "/settings/members", "/settings/ai-use", "/ai-engine", "/money"]) {
      expect(pathAllowed(path, OWNER), path).toBe(true);
    }
  });

  it("matches a page to its own entry, not a shorter one", () => {
    expect(navItemFor("/settings/ai-use")?.to).toBe("/settings/ai-use");
    expect(navItemFor("/settings")?.to).toBe("/settings");
    expect(navItemFor("/sops")?.to).toBe("/sops");
    expect(navItemFor("/")?.to).toBe("/");
  });
});
