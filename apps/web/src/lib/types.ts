import { msg } from "@/i18n";

export type Role =
  | "owner"
  | "admin"
  | "branch_manager"
  | "hod"
  | "supervisor"
  | "staff"
  | "operator"
  | "approver"
  | "viewer";

/** Office roles see a slice of the workspace (P9). */
export const SCOPED_ROLES: Role[] = ["branch_manager", "hod", "supervisor", "staff"];

export interface Scope {
  kind: "all" | "branch" | "department" | "own";
  label: string;
  branch_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  department_name: string | null;
}

export interface Me {
  user: { id: string; email: string; name: string; must_change_password: boolean };
  workspace: { id: string; name: string; slug: string; timezone: string };
  role: Role;
  permissions: string[];
  scope?: Scope | null;
}

export const hasAny = (me: Me, ...perms: string[]) => perms.some((p) => me.permissions.includes(p));

export interface Member {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  agents?: number;
  joined_at: string;
}

export interface Department {
  id: string;
  branch_id: string;
  name: string;
  slug: string;
  position: number;
}

export interface Branch {
  id: string;
  name: string;
  slug: string;
  color: string;
  isolated: boolean;
  /** What the company does (P19): picks its ready-made AI team. */
  industry?: string;
  created_at: string;
  departments: Department[];
}

export interface AuditItem {
  id: number;
  ts: string;
  actor: string;
  actor_name: string | null;
  action: string;
  target: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
}

export interface AuditPage {
  items: AuditItem[];
  next_before_id: number | null;
  /** First page only: entries per kind (signin, people, org, work, agents, other). */
  kinds?: Record<string, number> | null;
  /** First page only: entries matching the kind filter. */
  total?: number | null;
}

export interface ComponentStatus {
  name: string;
  ok: boolean;
  detail: string;
  latency_ms: number | null;
}

export interface SystemStatus {
  ok: boolean;
  version: string;
  components: ComponentStatus[];
  counts: Record<string, number>;
}

/** English keys (msg): render with t(ROLE_INFO[r].label). */
export const ROLE_INFO: Record<Role, { label: string; blurb: string }> = {
  owner: { label: msg("Owner"), blurb: msg("Everything, including owner access and workspace-level budgets.") },
  admin: { label: msg("Admin"), blurb: msg("Members, organization, AI keys and policies.") },
  branch_manager: { label: msg("Branch manager"), blurb: msg("Runs one branch: its agents, work, approvals, logins and people.") },
  hod: { label: msg("Head of department"), blurb: msg("Runs one department: its agents, work, approvals and people.") },
  supervisor: { label: msg("Supervisor"), blurb: msg("Gives the department's agents work and decides what they ask. Does not change agents.") },
  staff: { label: msg("Staff"), blurb: msg("Has personal agents: creates them, gives them work, answers them.") },
  operator: { label: msg("Operator"), blurb: msg("Creates and assigns work across the workspace, instructs agents.") },
  approver: { label: msg("Approver"), blurb: msg("Decides approvals across the workspace and reviews what agents learn.") },
  viewer: { label: msg("Viewer"), blurb: msg("Read only, the whole workspace.") },
};
