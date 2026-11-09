/**
 * P92: Settings > Roles and access. The areas a person sees, each the permissions it switches,
 * and the arithmetic of the owner's changes (grant / revoke per role) on top of the defaults.
 * The server (api/routers/role_access.py, core/security.py) checks and applies the same.
 */
import { msg } from "@/i18n";
import { api } from "@/lib/api";
import type { Role } from "@/lib/types";

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

export type Changes = Partial<
  Record<Role, { grant: string[]; revoke: string[] }>
>;

export interface Area {
  key: string;
  label: string;
  hint: string;
  perms: string[];
}

/** One row per area, in plain words; English keys (render with t()). */
export const AREAS: Area[] = [
  {
    key: "engine-see",
    label: msg("AI engine: see"),
    hint: msg("The AI providers, models and what the AI costs."),
    perms: ["engine.view"],
  },
  {
    key: "engine-change",
    label: msg("AI engine: change"),
    hint: msg("Add or remove AI keys, choose models, privacy masking."),
    perms: ["engine.manage"],
  },
  {
    key: "storage",
    label: msg("File storage"),
    hint: msg(
      "Where company files are kept, with bucket keys and file server passwords.",
    ),
    perms: ["storage.manage"],
  },
  {
    key: "mcp",
    label: msg("MCP tools"),
    hint: msg("Connect tools from other systems for the agents."),
    perms: ["mcp.manage"],
  },
  {
    key: "members",
    label: msg("Members and roles"),
    hint: msg(
      "Add people, change their role, name or email, reset passwords. Never more access than their own.",
    ),
    perms: ["members.manage"],
  },
  {
    key: "team",
    label: msg("Their own team"),
    hint: msg(
      "Add and change the people below them in their branch or department.",
    ),
    perms: ["team.manage"],
  },
  {
    key: "org",
    label: msg("Organisation settings"),
    hint: msg(
      "Companies, departments, approval limits, web connections and approved services.",
    ),
    perms: ["org.manage", "org.read"],
  },
  {
    key: "office",
    label: msg("The whole office"),
    hint: msg(
      "Command center, every agent, schedules, reports and the company overview.",
    ),
    perms: ["office.view"],
  },
  {
    key: "work",
    label: msg("Give work to the AI"),
    hint: msg("Tasks, chat and workflows."),
    perms: ["work.write"],
  },
  {
    key: "approvals",
    label: msg("Approvals"),
    hint: msg("Decide what agents ask before they act."),
    perms: ["approvals.decide"],
  },
  {
    key: "agents",
    label: msg("AI team and agents"),
    hint: msg("Create and change agents, their skills and SOPs."),
    perms: ["agents.manage"],
  },
  {
    key: "brain",
    label: msg("Brain and learning"),
    hint: msg("What the office knows and how agents learn."),
    perms: ["brain.manage"],
  },
  {
    key: "money-see",
    label: msg("Money: see"),
    hint: msg("Invoices, bills, payments and cash flow."),
    perms: ["finance.view"],
  },
  {
    key: "money-change",
    label: msg("Money: change"),
    hint: msg("Record payments, send reminders, approve bills."),
    perms: ["finance.manage"],
  },
  {
    key: "library",
    label: msg("Library files and saved logins"),
    hint: msg("Manage company files and the website logins agents use."),
    perms: ["vault.manage"],
  },
  {
    key: "channels",
    label: msg("Channels"),
    hint: msg(
      "Telegram, WhatsApp, Microsoft 365 and API tokens for the company.",
    ),
    perms: ["channels.manage"],
  },
  {
    key: "audit",
    label: msg("Audit log"),
    hint: msg("Every change made by people and agents."),
    perms: ["audit.read"],
  },
  {
    key: "assistants",
    label: msg("Private assistants"),
    hint: msg(
      "Their own assistants for company pulse, mail and chasing people.",
    ),
    perms: ["assistants.use"],
  },
  {
    key: "twin",
    label: msg("Own AI twin"),
    hint: msg("One personal AI that works for them, with its own logins."),
    perms: ["agents.own", "vault.own"],
  },
];

export const roleAccessKey = ["org", "role-access"] as const;
export const getRoleAccess = () => api<RoleAccess>("/api/org/role-access");
export const saveRoleAccess = (roles: Changes) =>
  api<RoleAccess>("/api/org/role-access", "PUT", { roles });

export type CellState = "on" | "off" | "some";

export function stateOf(perms: Iterable<string>, area: Area): CellState {
  const have = new Set(perms);
  const n = area.perms.filter((p) => have.has(p)).length;
  return n === area.perms.length ? "on" : n === 0 ? "off" : "some";
}

/** The role's permissions with these changes on top of its defaults (as the server does). */
export function effectiveOf(
  defaults: string[],
  change?: { grant: string[]; revoke: string[] },
): Set<string> {
  const out = new Set(defaults);
  for (const p of change?.grant ?? []) out.add(p);
  for (const p of change?.revoke ?? []) out.delete(p);
  return out;
}

/** Turn one area on or off for one role: the smallest change from its defaults. */
export function toggle(
  changes: Changes,
  role: Role,
  defaults: string[],
  area: Area,
  on: boolean,
): Changes {
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
  if (grant.size || revoke.size)
    next[role] = { grant: [...grant].sort(), revoke: [...revoke].sort() };
  else delete next[role];
  return next;
}

export function changesOf(data: RoleAccess): Changes {
  const out: Changes = {};
  for (const r of data.roles)
    if (r.editable && (r.grant.length || r.revoke.length))
      out[r.role] = { grant: [...r.grant], revoke: [...r.revoke] };
  return out;
}

export const sameChanges = (a: Changes, b: Changes) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (c: Changes) =>
  Object.keys(c)
    .sort()
    .map((k) => [k, c[k as Role]]);
