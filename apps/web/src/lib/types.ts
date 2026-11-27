import { msg } from "@/i18n";

export type Role =
  | "owner"
  | "admin"
  | "it_support"
  | "branch_manager"
  | "hod"
  | "group_hod"
  | "supervisor"
  | "staff"
  | "operator"
  | "approver"
  | "viewer"
  | "management"
  | "hr";

/** Office roles see a slice of the workspace (P9). */
export const SCOPED_ROLES: Role[] = ["branch_manager", "group_hod", "hod", "supervisor", "staff"];

export interface Scope {
  kind: "all" | "branch" | "department" | "own";
  label: string;
  branch_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  department_name: string | null;
  /** P98: every branch the scope covers (home first). */
  branches?: { id: string; name: string }[];
  /** P144: the companies given to them in the Library (Members page), with names. */
  library_branches?: { id: string; name: string }[];
}

export interface Me {
  // P57: two_factor_setup_required = the company asks for two-step sign-in and it is not set up.
  // P73: is_developer = the system's developer (an owner who also has the Feedbacks page).
  user: { id: string; email: string; name: string; must_change_password: boolean; two_factor_enabled?: boolean; two_factor_setup_required?: boolean; is_developer?: boolean };
  workspace: { id: string; name: string; slug: string; timezone: string };
  role: Role;
  permissions: string[];
  scope?: Scope | null;
  /** P92: the roles this person may give others (the server's own rule). */
  assignable_roles?: Role[];
  /** P99: Prima only (the office opens Prima for them) and their chosen Prima screens (null: all). */
  access?: Access;
  prima_modules?: string[] | null;
  /** P123: Prima is set up here: the app opens on Prima after signing in (lib/start-in-prima.ts). */
  prima?: boolean;
}

/** P99: what a member reaches: the office and Prima, or Prima only. */
export type Access = "agentic" | "prima_only";

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
  /** P98: every branch they work in, home (branch_id) first. */
  branches?: { id: string; name: string }[];
  department_id?: string | null;
  department_name?: string | null;
  agents?: number;
  joined_at: string;
  /** P82: signed in with their Microsoft work account here. */
  microsoft?: boolean;
  /** P97: who they report to, whether they head their department, how many report to them. */
  reports_to_user_id?: string | null;
  reports_to_name?: string | null;
  heads_department?: boolean;
  manages?: number;
  /** P99: the office and Prima, or Prima only; their Prima screens (null or missing: all their Prima role allows). */
  access?: Access;
  prima_modules?: string[] | null;
  /** P106: the Prima department their own Prima account gets (null or missing: none). */
  prima_department?: "transport" | "procurement" | "hr" | "finance" | "chief_of_staff" | "it" | "legal" | "audit" | "operations" | "asset" | "pdpa" | "fwm" | "cms" | null;
  /** P109: the departments they head (any company), what of the Library they read, and
   * whether they may upload files for other companies. */
  head_of?: { id: string; name: string; branch_id?: string | null; branch_name?: string | null }[];
  library_scope?: "company" | "department";
  uploads_for_others?: boolean;
  /** P144: extra Library access given to them (null or missing: none). */
  library_grants?: LibraryGrants | null;
  /** P111: their job title (designation) on the organization chart. */
  job_title?: string | null;
}

/** P144: extra Library access given to one member, on top of their role and place: units
 * ("all" or some), companies ("all" or some ids) and departments (ids). */
export interface LibraryGrants {
  units: ("hr" | "audit" | "finance")[] | "all";
  companies: string[] | "all";
  departments: string[];
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
  // P125: "Admin" is shown as "Global admin" (the id stays "admin").
  admin: { label: msg("Global admin"), blurb: msg("Members, organization, AI keys and policies.") },
  // P125: an admin's access, but every change to members, the organization, access and settings
  // waits for an owner or a global admin to approve it.
  it_support: { label: msg("IT support"), blurb: msg("Like a global admin, but every change they make to members, the organization, access and settings waits for an owner or a global admin to approve it.") },
  branch_manager: { label: msg("Branch manager"), blurb: msg("Runs their branches (one or more): agents, work, approvals, logins and people.") },
  hod: { label: msg("Head of department"), blurb: msg("Runs one department: its agents, work, approvals and people.") },
  // P120: an HOD over several companies (each one they are added to).
  group_hod: { label: msg("Group HOD"), blurb: msg("A head of department over several companies: runs the agents, work, approvals and people of each company they are added to.") },
  supervisor: { label: msg("Supervisor"), blurb: msg("Gives the department's agents work and decides what they ask. Does not change agents.") },
  staff: { label: msg("Staff"), blurb: msg("Has personal agents: creates them, gives them work, answers them.") },
  operator: { label: msg("Operator"), blurb: msg("Creates and assigns work across the workspace, instructs agents.") },
  approver: { label: msg("Approver"), blurb: msg("Decides approvals across the workspace and reviews what agents learn.") },
  viewer: { label: msg("Viewer"), blurb: msg("Read only, the whole workspace.") },
  management: { label: msg("Management"), blurb: msg("Runs the whole workspace like an admin, without the AI engine, file storage and MCP tools. The owner can change this.") },
  hr: { label: msg("HR"), blurb: msg("People, members and the whole workspace like an admin, without the AI engine, file storage and MCP tools. The owner can change this.") },
};
