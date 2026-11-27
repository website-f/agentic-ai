/**
 * P139 (owner, 27 Nov 2026: "no web view: the same screens, Prima's own"): a small typed client for the Agentic
 * Office's own API, which runs on the same site as Prima. Members and organization (views/office/*) call it directly:
 * the office's session cookie goes with each call, and changes send back its CSRF token (the agentic_csrf cookie) as
 * the x-csrf-token header with a JSON body ({} when there is nothing to send, DELETE too). The office checks every
 * permission again; the screens only hide what the office would refuse.
 *
 * Shapes follow the office: apps/api/agentic/api/schemas.py and routers/{org,members,role_access,prima_master,
 * role_preview,signin_mail,account}.py (and the office's own screens in apps/web/src/lib/types.ts).
 */
import { savedLang } from '../i18n';

// ---------- Shapes ----------

export type OfficeRole =
  'owner' | 'admin' | 'it_support' | 'branch_manager' | 'hod' | 'group_hod' | 'supervisor' | 'staff' | 'operator' | 'approver' | 'viewer' | 'management' | 'hr';

export interface OfficeScope {
  kind: 'all' | 'branch' | 'department' | 'own';
  label: string;
  branch_id: string | null;
  branch_name: string | null;
  department_id: string | null;
  department_name: string | null;
  branches?: { id: string; name: string }[];
}

/** GET /api/auth/me: who is signed in to the office, their role, permissions and the roles they may give. */
export interface OfficeMe {
  user: { id: string; email: string; name: string };
  role: OfficeRole;
  permissions: string[];
  scope?: OfficeScope | null;
  assignable_roles?: OfficeRole[];
}

export interface OfficeDepartment {
  id: string;
  branch_id: string;
  name: string;
  slug: string;
  position: number;
}

/** An office "branch": a company, with its departments. */
export interface OfficeCompany {
  id: string;
  name: string;
  slug: string;
  color: string;
  isolated: boolean;
  created_at: string;
  departments: OfficeDepartment[];
  industry?: string;
  data_level?: string;
}

export interface OfficeMember {
  user_id: string;
  email: string;
  name: string;
  role: OfficeRole;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  joined_at: string;
  branch_id?: string | null;
  branch_name?: string | null;
  branches?: { id: string; name: string }[];
  department_id?: string | null;
  department_name?: string | null;
  microsoft?: boolean;
  reports_to_user_id?: string | null;
  reports_to_name?: string | null;
  heads_department?: boolean;
  manages?: number;
  job_title?: string | null;
  /** P109: what of the Library they read, and whether they may upload for other companies. */
  library_scope?: 'company' | 'department';
  uploads_for_others?: boolean;
  /** P144: extra Library access given to them (null or missing: none). */
  library_grants?: OfficeLibraryGrants | null;
  /** P99: the office and Prima, or Prima only; their chosen Prima screens (null: all their Prima role allows). */
  access?: OfficeAccessKind;
  prima_modules?: string[] | null;
  /** P106: the Prima department of their own Prima account. */
  prima_department?: PrimaDepartment | null;
  /** P145: the job role (position) they hold in the group structure (api/structure.ts). */
  position_id?: string | null;
  /** P145: a shared or work mailbox, used only on the Microsoft 365 page (they sign in with `email`). */
  work_email?: string | null;
}

export type OfficeAccessKind = 'agentic' | 'prima_only';

/** P106/P125: the Prima departments a member's own Prima account may be in (the office's own list). */
export const PRIMA_DEPARTMENTS = [
  'operations',
  'finance',
  'procurement',
  'hr',
  'chief_of_staff',
  'it',
  'legal',
  'audit',
  'transport',
  'asset',
  'pdpa',
  'fwm',
  'cms',
] as const;
export type PrimaDepartment = (typeof PRIMA_DEPARTMENTS)[number];

/** P99: GET /api/members/prima-modules: Prima's screens in its own apps and groups. */
export interface PrimaModuleRow {
  id: string;
  title: string;
  blurb: string;
  always: boolean;
}
export interface PrimaCatalog {
  enabled: boolean;
  /** Screens everyone keeps (the home screen and their own things). */
  always: string[];
  /** The screens the signed-in person may give (null: all of Prima). */
  mine: string[] | null;
  apps: { id: string; title: string; blurb: string; groups: { title: string; modules: PrimaModuleRow[] }[] }[];
}

/** P128: what a ticked screen Prima will not open for them still needs (office prima/screen_access.py). */
export interface PrimaNeed {
  id: string;
  title: string;
  kind: 'department' | 'branch_manager' | 'central_staff' | 'job' | 'leadership' | 'none';
  departments: PrimaDepartment[];
  jobs: string[];
}

/** P128: what they really get in Prima, by Prima's own menu rule. */
export interface PrimaEffective {
  role: string;
  role_label: string;
  department: PrimaDepartment | null;
  how: 'chosen' | 'none' | 'refused' | 'top';
  screens: { id: string; title: string }[];
  needs: PrimaNeed[];
  company_access: { id: string; title: string }[];
  suggestion: { department: PrimaDepartment; adds: { id: string; title: string }[]; sensitive: boolean } | null;
}

/** P99/P128: GET /api/members/{id}/prima: their Prima role, where it is set, and what they get there. */
export interface PrimaRoleInfo {
  enabled: boolean;
  role: string | null;
  role_label: string | null;
  where: string;
  record: string | null;
  effective: PrimaEffective | null;
}

/** P99: PUT /api/members/{id}/prima-access. Leave out what does not change. */
export interface PrimaAccessIn {
  access?: OfficeAccessKind;
  prima_modules?: string[] | null;
  prima_department?: PrimaDepartment | null;
}

export type OfficeUnitKey = 'hr' | 'audit' | 'finance';

/** P144: extra Library access on top of a member's role and place: units ("all" or some), companies ("all" or some
 * ids) and departments (ids). */
export interface OfficeLibraryGrants {
  units: OfficeUnitKey[] | 'all';
  companies: string[] | 'all';
  departments: string[];
}

/** P144: PUT /api/members/{id}/library. Leave out what does not change; grants null: nothing given. */
export interface OfficeLibraryAccessIn {
  library_scope?: 'company' | 'department';
  uploads_for_others?: boolean;
  grants?: OfficeLibraryGrants | null;
}

/** P143b: a Library unit the signed-in person opens (GET /api/library/units). */
export interface OfficeUnit {
  key: OfficeUnitKey;
  label: string;
  department_id: string;
  department_name: string;
  branch_id: string;
  branch_name: string;
  files: number;
  can_upload: boolean;
}

export interface MembersPage {
  items: OfficeMember[];
  total: number;
  page: number;
  page_size: number;
}

export interface MemberCreated {
  member: OfficeMember;
  /** Shown once; null when an existing account was added. */
  temp_password: string | null;
}

export interface BulkOut {
  results: { user_id: string; ok: boolean; message?: string | null }[];
  done: number;
  skipped: number;
}

export interface RoleAccessRole {
  role: OfficeRole;
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

export type RoleChanges = Partial<Record<OfficeRole, { grant: string[]; revoke: string[] }>>;

export interface PrimaMaster {
  on: boolean;
  summary: Record<string, number>;
  held: { user_id: string; name: string; kind: string; from_role: string | null; to_role: string | null }[];
  can_run: boolean;
  can_apply_held: boolean;
}

export interface UnknownSignin {
  email: string;
  at: string;
}

/** P141: one email of POST /api/prima-master/unknown-signins/add. */
export interface UnknownAddResult {
  email: string;
  ok: boolean;
  user_id?: string | null;
  name?: string | null;
  /** Already a member here: left as they are. */
  skipped?: boolean;
  /** null: no sign-in email was asked for. */
  emailed?: boolean | null;
  message?: string | null;
}

export interface UnknownAddOut {
  results: UnknownAddResult[];
  added: number;
  skipped: number;
  failed: number;
  emailed: number;
}

export interface UnknownAddIn {
  emails: string[];
  /** The name chosen on the screen for an email (else the office makes one from the email). */
  names: Record<string, string>;
  role: OfficeRole;
  branch_id: string | null;
  department_id: string | null;
  send_signin: boolean;
}

export interface RolePreview {
  can_start: boolean;
  previewing: boolean;
  as_role: string | null;
  as_label: string | null;
  roles: { role: string; label: string; needs_branch: boolean; needs_department: boolean }[];
  branches: { id: string; name: string; departments: { id: string; name: string }[] }[];
}

/** A change the office held for an owner or a global admin to approve (IT support's changes): HTTP 202. */
export interface Held {
  held: true;
  summary?: string;
  request_id?: string;
}

// ---------- The call ----------

export class OfficeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function csrf(): string {
  const m = /(?:^|;\s*)agentic_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : '';
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function officeFetch<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-lang': savedLang() === 'en' ? 'en' : 'ms' };
  const init: RequestInit = { method, credentials: 'same-origin', headers };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = csrf();
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new OfficeError('Could not reach the office. Check your connection and try again.', 0, 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { message?: unknown; code?: unknown; detail?: unknown }) | null;
  if (!res.ok) {
    let message = typeof data?.message === 'string' && data.message ? data.message : '';
    // FastAPI's own check of a field (422) says what is wrong in `detail`.
    if (!message && Array.isArray(data?.detail)) {
      const first = data.detail[0] as { msg?: unknown } | undefined;
      if (typeof first?.msg === 'string') message = first.msg;
    }
    if (!message && res.status === 403) message = 'The office does not allow you to do this.';
    if (!message && res.status === 401) message = 'Your sign-in has ended. Refresh the page to sign in again.';
    throw new OfficeError(message || `The office refused (${res.status}).`, res.status, typeof data?.code === 'string' ? data.code : '');
  }
  return data as T;
}

/** The office held the change for approval: the words to show instead of "Saved". */
export function heldText(r: unknown): string | null {
  if (r && typeof r === 'object' && (r as Held).held === true) {
    const s = (r as Held).summary;
    return s ? `Sent to the admins for approval: ${s}` : 'Sent to the admins for approval.';
  }
  return null;
}

/** A success message that says "sent for approval" when the office held the change. */
export const saved = (msg: string) => (r: unknown) => heldText(r) ?? msg;

const id = encodeURIComponent;

// ---------- Calls ----------

export const office = {
  me: () => officeFetch<OfficeMe>('GET', '/api/auth/me'),

  // Organization (routers/org.py)
  companies: () => officeFetch<OfficeCompany[]>('GET', '/api/branches'),
  addCompany: (body: { name: string; color: string; isolated: boolean; seed_departments: boolean }) =>
    officeFetch<OfficeCompany | Held>('POST', '/api/branches', { ...body, starter_team: false }),
  updateCompany: (companyId: string, body: { name?: string; color?: string; isolated?: boolean }) =>
    officeFetch<OfficeCompany | Held>('PATCH', `/api/branches/${id(companyId)}`, body),
  deleteCompany: (companyId: string) => officeFetch<void | Held>('DELETE', `/api/branches/${id(companyId)}`, {}),
  addDepartment: (companyId: string, name: string) => officeFetch<OfficeDepartment | Held>('POST', `/api/branches/${id(companyId)}/departments`, { name }),
  renameDepartment: (deptId: string, name: string) => officeFetch<OfficeDepartment | Held>('PATCH', `/api/departments/${id(deptId)}`, { name }),
  deleteDepartment: (deptId: string) => officeFetch<void | Held>('DELETE', `/api/departments/${id(deptId)}`, {}),

  // Members (routers/members.py, signin_mail.py)
  /** Everyone the signed-in person may see (the plain list, no paging). */
  members: () => officeFetch<OfficeMember[]>('GET', '/api/members'),
  /** One page, searched and filtered by the office (Office access). */
  membersPage: (opts: { q?: string; role?: string; pageSize?: 25 | 50 | 100 }) => {
    const p = new URLSearchParams({ page: '1', page_size: String(opts.pageSize ?? 25) });
    if (opts.q?.trim()) p.set('q', opts.q.trim());
    if (opts.role) p.set('role', opts.role);
    return officeFetch<MembersPage>('GET', `/api/members?${p}`);
  },
  addMember: (body: { email: string; name: string; role: OfficeRole; branch_id: string | null; branch_ids: string[]; department_id: string | null }) =>
    officeFetch<MemberCreated | Held>('POST', '/api/members', body),
  updateMember: (userId: string, body: Record<string, unknown>) => officeFetch<OfficeMember | Held>('PATCH', `/api/members/${id(userId)}`, body),
  removeMember: (userId: string) => officeFetch<void | Held>('DELETE', `/api/members/${id(userId)}`, {}),
  removeMembers: (userIds: string[]) => officeFetch<BulkOut | Held>('POST', '/api/members/bulk', { user_ids: userIds, action: 'remove' }),
  emailSignin: (userId: string) => officeFetch<{ ok: boolean; to: string } | Held>('POST', `/api/members/${id(userId)}/email-signin`, {}),
  resetMicrosoft: (userId: string) => officeFetch<OfficeMember | Held>('POST', `/api/members/${id(userId)}/reset-microsoft`, {}),
  /** P144: what of the Library they read, upload for others, and the units and companies given to them. */
  setLibraryAccess: (userId: string, body: OfficeLibraryAccessIn) =>
    officeFetch<OfficeMember | Held>('PUT', `/api/members/${id(userId)}/library`, body),
  /** P120: one member (their own page), with the same rules as the list. */
  member: (userId: string) => officeFetch<OfficeMember>('GET', `/api/members/${id(userId)}`),
  /** P99: Prima's screens to choose from (members.manage). */
  primaModules: () => officeFetch<PrimaCatalog>('GET', '/api/members/prima-modules'),
  /** P128: what they get in Prima; `modules` and `department` explain the form before it is saved. */
  memberPrima: (userId: string, preview?: { modules: string[] | null; department: PrimaDepartment | null }) => {
    const q = new URLSearchParams();
    if (preview) {
      q.set('modules', preview.modules === null ? 'all' : preview.modules.join(','));
      q.set('department', preview.department ?? 'none');
    }
    const qs = q.toString();
    return officeFetch<PrimaRoleInfo>('GET', `/api/members/${id(userId)}/prima${qs ? `?${qs}` : ''}`);
  },
  /** P99: what one member reaches (the office and Prima, or Prima only), their Prima screens and department. */
  setPrimaAccess: (userId: string, body: PrimaAccessIn) => officeFetch<OfficeMember | Held>('PUT', `/api/members/${id(userId)}/prima-access`, body),
  /** P143b: the Library units the signed-in person opens (the ones they may give). */
  libraryUnits: () => officeFetch<{ units: OfficeUnit[] }>('GET', '/api/library/units'),

  // Roles and access (routers/role_access.py: owners only)
  roleAccess: () => officeFetch<RoleAccess>('GET', '/api/org/role-access'),
  saveRoleAccess: (roles: RoleChanges) => officeFetch<RoleAccess>('PUT', '/api/org/role-access', { roles }),

  // Office access (routers/prima_master.py, role_preview.py)
  primaMaster: () => officeFetch<PrimaMaster>('GET', '/api/prima-master'),
  primaRun: () => officeFetch<PrimaMaster>('POST', '/api/prima-master/run', {}),
  primaApplyHeld: () => officeFetch<PrimaMaster>('POST', '/api/prima-master/apply-held', {}),
  unknownSignins: () => officeFetch<UnknownSignin[]>('GET', '/api/prima-master/unknown-signins'),
  /** P141: add them as office members (IT support's add waits for approval). */
  addUnknownSignins: (body: UnknownAddIn) => officeFetch<UnknownAddOut | Held>('POST', '/api/prima-master/unknown-signins/add', body),
  rolePreview: () => officeFetch<RolePreview>('GET', '/api/role-preview'),
  startRolePreview: (body: { role: string; branch_id: string | null; department_id: string | null }) =>
    officeFetch<RolePreview>('POST', '/api/role-preview/start', body),

  // The signed-in person's own account (routers/account.py)
  /** P141: their own name, as everyone in the office sees it. */
  setMyName: (name: string) => officeFetch<OfficeMe>('PUT', '/api/account/name', { name }),
};
