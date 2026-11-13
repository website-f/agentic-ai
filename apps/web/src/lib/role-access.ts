/**
 * P92 / P98: Settings > Roles and access. Every permission the owner may give or take, one row
 * each, grouped by area, in plain words with what it opens; and the arithmetic of the owner's
 * changes (grant / revoke per role) on top of the defaults. The server (api/routers/
 * role_access.py, core/security.py) checks and applies the same.
 */
import { msg } from "@/i18n";
import { api } from "@/lib/api";
import type { Role } from "@/lib/types";
import { ALL_NAV } from "@/nav";

export interface RoleAccessRole {
  role: Role;
  editable: boolean;
  default: string[];
  effective: string[];
  grant: string[];
  revoke: string[];
}

export interface RoleAccess {
  roles: RoleAccessRole[];
  grantable: string[];
  owner_only: string[];
}

export type Changes = Partial<Record<Role, { grant: string[]; revoke: string[] }>>;

/** One row of the matrix: one permission (perms has exactly one), in an area (section). */
export interface Area {
  key: string;
  label: string;
  hint: string;
  perms: string[];
  section: string;
}

/** The areas rows are grouped under, in order (English keys: render with t()). */
export const SECTIONS: string[] = [
  msg("Office and daily work"),
  msg("AI team and knowledge"),
  msg("People and organisation"),
  msg("System and connections"),
];
const [WORK, AI, PEOPLE, SYSTEM] = SECTIONS as [string, string, string, string];

/** One row per permission, in plain words; English keys (render with t()). */
export const AREAS: Area[] = [
  { key: "office", section: WORK, label: msg("The whole office"), hint: msg("Command center, every agent, schedules, reports and the company overview."), perms: ["office.view"] },
  { key: "work", section: WORK, label: msg("Give work to the AI"), hint: msg("Tasks, chat and workflows."), perms: ["work.write"] },
  { key: "approvals", section: WORK, label: msg("Approvals"), hint: msg("Decide what agents ask before they act."), perms: ["approvals.decide"] },
  { key: "assistants", section: WORK, label: msg("Private assistants"), hint: msg("Their own assistants for company pulse, mail and chasing people."), perms: ["assistants.use"] },
  { key: "twin", section: WORK, label: msg("Own AI twin"), hint: msg("One personal AI that works for them."), perms: ["agents.own"] },
  { key: "twin-logins", section: WORK, label: msg("Own saved logins"), hint: msg("Website logins of their own that their AI twin may use."), perms: ["vault.own"] },
  { key: "agents", section: AI, label: msg("AI team and agents"), hint: msg("Create and change agents, their skills and SOPs."), perms: ["agents.manage"] },
  { key: "brain", section: AI, label: msg("Brain and learning"), hint: msg("What the office knows and how agents learn."), perms: ["brain.manage"] },
  { key: "library", section: AI, label: msg("Library files and saved logins"), hint: msg("Manage company files and the website logins agents use."), perms: ["vault.manage"] },
  { key: "members", section: PEOPLE, label: msg("Members and roles"), hint: msg("Add people, change their role, name or email, reset passwords. Never more access than their own."), perms: ["members.manage"] },
  { key: "team", section: PEOPLE, label: msg("Their own team"), hint: msg("Add and change the people below them in their branch or department."), perms: ["team.manage"] },
  { key: "org-see", section: PEOPLE, label: msg("Organisation: see"), hint: msg("See every company and department and the setup pages, without changing them."), perms: ["org.read"] },
  { key: "org-change", section: PEOPLE, label: msg("Organisation: change"), hint: msg("Companies, departments, web connections and approved services."), perms: ["org.manage"] },
  { key: "audit", section: PEOPLE, label: msg("Audit log"), hint: msg("Every change made by people and agents."), perms: ["audit.read"] },
  { key: "engine-see", section: SYSTEM, label: msg("AI engine: see"), hint: msg("The AI providers, models and what the AI costs."), perms: ["engine.view"] },
  { key: "engine-change", section: SYSTEM, label: msg("AI engine: change"), hint: msg("Add or remove AI keys, choose models, privacy masking."), perms: ["engine.manage"] },
  { key: "storage", section: SYSTEM, label: msg("File storage"), hint: msg("Where company files are kept, with bucket keys and file server passwords."), perms: ["storage.manage"] },
  { key: "mcp", section: SYSTEM, label: msg("MCP tools"), hint: msg("Connect tools from other systems for the agents."), perms: ["mcp.manage"] },
  { key: "channels", section: SYSTEM, label: msg("Channels"), hint: msg("Telegram, WhatsApp, Microsoft 365 and API tokens for the company."), perms: ["channels.manage"] },
];

/** The pages and menus a permission opens (the menu's own rule, nav.ts): English labels. */
export function opensOf(area: Area): string[] {
  const out: string[] = [];
  for (const n of ALL_NAV) {
    const need = n.perm ? [n.perm].flat() : [];
    if (need.some((p) => area.perms.includes(p)) && !out.includes(n.label)) out.push(n.label);
  }
  return out;
}

/** The row of a permission (for its plain name). */
export const areaOf = (perm: string) => AREAS.find((a) => a.perms.includes(perm));

export const roleAccessKey = ["org", "role-access"] as const;
export const getRoleAccess = () => api<RoleAccess>("/api/org/role-access");
export const saveRoleAccess = (roles: Changes) => api<RoleAccess>("/api/org/role-access", "PUT", { roles });

export type CellState = "on" | "off" | "some";

export function stateOf(perms: Iterable<string>, area: Area): CellState {
  const have = new Set(perms);
  const n = area.perms.filter((p) => have.has(p)).length;
  return n === area.perms.length ? "on" : n === 0 ? "off" : "some";
}

/** The role's permissions with these changes on top of its defaults (as the server does). */
export function effectiveOf(defaults: string[], change?: { grant: string[]; revoke: string[] }): Set<string> {
  const out = new Set(defaults);
  for (const p of change?.grant ?? []) out.add(p);
  for (const p of change?.revoke ?? []) out.delete(p);
  return out;
}

/** Turn one area on or off for one role: the smallest change from its defaults. */
export function toggle(changes: Changes, role: Role, defaults: string[], area: Area, on: boolean): Changes {
  const grant = new Set(changes[role]?.grant ?? []);
  const revoke = new Set(changes[role]?.revoke ?? []);
  const base = new Set(defaults);
  for (const p of area.perms) {
    if (on) {
      if (base.has(p)) revoke.delete(p);
      else grant.add(p);
    } else if (base.has(p)) revoke.add(p);
    else grant.delete(p);
  }
  const next: Changes = { ...changes };
  if (grant.size || revoke.size) next[role] = { grant: [...grant].sort(), revoke: [...revoke].sort() };
  else delete next[role];
  return next;
}

/** P98: one role back to its defaults (its change left out). */
export function resetRole(changes: Changes, role: Role): Changes {
  const next: Changes = { ...changes };
  delete next[role];
  return next;
}

export function changesOf(data: RoleAccess): Changes {
  const out: Changes = {};
  for (const r of data.roles)
    if (r.editable && (r.grant.length || r.revoke.length)) out[r.role] = { grant: [...r.grant], revoke: [...r.revoke] };
  return out;
}

export const sameChanges = (a: Changes, b: Changes) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (c: Changes) =>
  Object.keys(c)
    .sort()
    .map((k) => [k, c[k as Role]]);

/** P98: per role, what it would have against its defaults, and what this save changes. */
export interface RoleDiff {
  role: Role;
  /** Given beyond the default / taken from the default, after this save. */
  added: string[];
  removed: string[];
  /** What this save turns on / off compared with what is saved now. */
  turnsOn: string[];
  turnsOff: string[];
}

export function diffOf(roles: RoleAccessRole[], draft: Changes, saved: Changes): RoleDiff[] {
  const out: RoleDiff[] = [];
  for (const r of roles) {
    if (!r.editable) continue;
    const now = effectiveOf(r.default, saved[r.role]);
    const next = effectiveOf(r.default, draft[r.role]);
    const base = new Set(r.default);
    const d: RoleDiff = {
      role: r.role,
      added: [...next].filter((p) => !base.has(p)).sort(),
      removed: [...base].filter((p) => !next.has(p)).sort(),
      turnsOn: [...next].filter((p) => !now.has(p)).sort(),
      turnsOff: [...now].filter((p) => !next.has(p)).sort(),
    };
    if (d.turnsOn.length || d.turnsOff.length) out.push(d);
  }
  return out;
}
