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

export const ROLE_INFO: Record<Role, { label: string; blurb: string }> = {
  owner: { label: "Owner", blurb: "Everything, including owner access and workspace-level budgets." },
  admin: { label: "Admin", blurb: "Members, organization, AI keys and policies." },
  branch_manager: { label: "Branch manager", blurb: "Runs one branch: its agents, work, approvals, logins and people." },
  hod: { label: "Head of department", blurb: "Runs one department: its agents, work, approvals and people." },
  supervisor: { label: "Supervisor", blurb: "Gives the department's agents work and decides what they ask. Does not change agents." },
  staff: { label: "Staff", blurb: "Has personal agents: creates them, gives them work, answers them." },
  operator: { label: "Operator", blurb: "Creates and assigns work across the workspace, instructs agents." },
  approver: { label: "Approver", blurb: "Decides approvals across the workspace and reviews what agents learn." },
  viewer: { label: "Viewer", blurb: "Read only, the whole workspace." },
};
