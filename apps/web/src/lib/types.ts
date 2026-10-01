export type Role = "owner" | "admin" | "operator" | "approver" | "viewer";

export interface Me {
  user: { id: string; email: string; name: string; must_change_password: boolean };
  workspace: { id: string; name: string; slug: string; timezone: string };
  role: Role;
  permissions: string[];
}

export interface Member {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
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
  operator: { label: "Operator", blurb: "Creates and assigns work, instructs agents." },
  approver: { label: "Approver", blurb: "Decides approvals and reviews what agents learn." },
  viewer: { label: "Viewer", blurb: "Read only." },
};
