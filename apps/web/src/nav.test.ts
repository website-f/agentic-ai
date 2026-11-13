import { describe, expect, it } from "vitest";

import { navItemFor, pathAllowed } from "./nav";

// What the API gives a staff member and an owner (core/security.py PERMISSIONS).
const STAFF = ["read", "work.write", "approvals.decide", "agents.own", "vault.own"];
const OWNER = [
  "read", "office.view", "org.read", "members.manage", "org.manage", "audit.read", "work.write", "approvals.decide",
  "agents.manage", "engine.manage", "brain.manage", "channels.manage", "vault.manage", "assistants.use",
  "members.assign_owner", "engine.view", "storage.manage", "mcp.manage", "roles.manage",
];
// P92: management and HR: an admin's access without the AI engine, file storage and MCP tools.
const MANAGEMENT = OWNER.filter((p) => !["members.assign_owner", "engine.manage", "engine.view", "storage.manage", "mcp.manage", "roles.manage"].includes(p));
const VIEWER = ["read", "office.view", "org.read", "engine.view"];

describe("P36: one guard for pages and the sidebar", () => {
  it("keeps staff to their own desk, their AI and their work", () => {
    for (const path of ["/workspace", "/my-worker", "/twin", "/tasks", "/tasks/tk_1", "/approvals", "/chat", "/files", "/library", "/settings", "/logins"]) {
      expect(pathAllowed(path, STAFF), path).toBe(true);
    }
    for (const path of [
      "/", "/overview", "/agents", "/agents/ag_1", "/agents/new", "/office", "/monitor", "/brain", "/skills", "/learning",
      "/organization", "/schedules", "/ai-engine", "/activity", "/settings/members", "/settings/ai-use", "/objectives",
    ]) {
      expect(pathAllowed(path, STAFF), path).toBe(false);
    }
  });

  it("lets the owner everywhere", () => {
    for (const path of ["/", "/agents/ag_1", "/brain", "/settings/members", "/settings/ai-use", "/ai-engine"]) {
      expect(pathAllowed(path, OWNER), path).toBe(true);
    }
  });

  it("matches a page to its own entry, not a shorter one", () => {
    expect(navItemFor("/settings/ai-use")?.to).toBe("/settings/ai-use");
    expect(navItemFor("/settings")?.to).toBe("/settings");
    expect(navItemFor("/sops")?.to).toBe("/sops");
    expect(navItemFor("/")?.to).toBe("/");
  });

  it("P102: has no Customers and money pages (the CRM, contacts, deals, money, approval limits)", () => {
    for (const path of ["/crm", "/contacts", "/contacts/pt_1", "/deals", "/money", "/settings/approval-limits"]) {
      expect(navItemFor(path)?.to ?? "", path).not.toMatch(/^\/(crm|contacts|deals|money|settings\/approval-limits)/);
    }
  });
});

describe("P92: AI engine, file storage and MCP tools are their own switches", () => {
  it("keeps management and HR out of the AI engine, file storage and MCP tools, and lets them everywhere else an admin goes", () => {
    for (const path of ["/ai-engine", "/settings/storage", "/mcp-servers", "/settings/roles"]) {
      expect(pathAllowed(path, MANAGEMENT), path).toBe(false);
    }
    for (const path of ["/", "/agents/ag_1", "/brain", "/settings/members", "/settings/ai-use", "/activity", "/organization", "/channels", "/approvals"]) {
      expect(pathAllowed(path, MANAGEMENT), path).toBe(true);
    }
  });

  it("leaves those pages to who had them: the owner everywhere, a viewer sees the AI engine only", () => {
    for (const path of ["/ai-engine", "/settings/storage", "/mcp-servers", "/settings/roles"]) {
      expect(pathAllowed(path, OWNER), path).toBe(true);
    }
    expect(pathAllowed("/ai-engine", VIEWER)).toBe(true);
    expect(pathAllowed("/settings/storage", VIEWER)).toBe(false);
    expect(pathAllowed("/mcp-servers", VIEWER)).toBe(false);
  });

  it("follows what the owner gave a role (the permissions /me sends)", () => {
    expect(pathAllowed("/ai-engine", [...MANAGEMENT, "engine.view"])).toBe(true);
    expect(pathAllowed("/activity", MANAGEMENT.filter((p) => p !== "audit.read"))).toBe(false);
    expect(navItemFor("/settings/roles")?.to).toBe("/settings/roles");
  });
});
