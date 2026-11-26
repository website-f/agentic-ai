/**
 * P139: what the four Members and organization tabs share: the office's signed-in person (what they may do), role
 * names, the "are you sure" dialog and small helpers. Plain English: the page translator shows it in BM.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { TrashIcon } from '@phosphor-icons/react';
import { activateDrawer } from '../../drawer-focus';
import { useBackClose } from '../../back-close';
import { ErrorNotice, RefreshContext, useToast } from '../../ui';
import { heldText } from '../../api/office';
import type { OfficeCompany, OfficeMe, OfficeMember, OfficeRole } from '../../api/office';

// ---------- Who is signed in, and what the office lets them do ----------

export interface Powers {
  me: OfficeMe;
  /** Companies and departments: add, rename, delete (org.manage). */
  org: boolean;
  /** Every member (members.manage). */
  members: boolean;
  /** The people in their own company or department (team.manage). */
  team: boolean;
  /** Adds, changes and removes people at all. */
  people: boolean;
  owner: boolean;
  /** Owners, global admins and IT support run the office itself. */
  runsOffice: boolean;
}

export function powersOf(me: OfficeMe): Powers {
  const has = (p: string) => me.permissions.includes(p);
  return {
    me,
    org: has('org.manage'),
    members: has('members.manage'),
    team: has('team.manage'),
    people: has('members.manage') || has('team.manage'),
    owner: me.role === 'owner',
    runsOffice: ['owner', 'admin', 'it_support'].includes(me.role),
  };
}

export const PowersCtx = createContext<Powers | null>(null);

export function usePowers(): Powers {
  const p = useContext(PowersCtx);
  if (!p) throw new Error('usePowers outside Members and organization');
  return p;
}

// ---------- Roles ----------

export const ROLES: OfficeRole[] = [
  'owner',
  'admin',
  'it_support',
  'management',
  'hr',
  'branch_manager',
  'group_hod',
  'hod',
  'supervisor',
  'staff',
  'operator',
  'approver',
  'viewer',
];

export const ROLE_INFO: Record<OfficeRole, { label: string; blurb: string }> = {
  owner: { label: 'Owner', blurb: 'Everything, including owner access and workspace-level budgets.' },
  admin: { label: 'Global admin', blurb: 'Members, organization, AI keys and policies.' },
  it_support: { label: 'IT support', blurb: 'Like a global admin, but every change they make waits for an owner or a global admin to approve it.' },
  management: { label: 'Management', blurb: 'Runs the whole workspace like an admin, without the AI engine, file storage and MCP tools.' },
  hr: { label: 'HR', blurb: 'People, members and the whole workspace like an admin, without the AI engine, file storage and MCP tools.' },
  branch_manager: { label: 'Branch manager', blurb: 'Runs their companies (one or more): agents, work, approvals, logins and people.' },
  group_hod: { label: 'Group HOD', blurb: 'A head of department over several companies.' },
  hod: { label: 'Head of department', blurb: 'Runs one department: its agents, work, approvals and people.' },
  supervisor: { label: 'Supervisor', blurb: "Gives the department's agents work and decides what they ask." },
  staff: { label: 'Staff', blurb: 'Has personal agents: creates them, gives them work, answers them.' },
  operator: { label: 'Operator', blurb: 'Creates and assigns work across the workspace, instructs agents.' },
  approver: { label: 'Approver', blurb: 'Decides approvals across the workspace and reviews what agents learn.' },
  viewer: { label: 'Viewer', blurb: 'Read only, the whole workspace.' },
};

export const roleLabel = (r: string | null | undefined): string => (r && r in ROLE_INFO ? ROLE_INFO[r as OfficeRole].label : (r ?? '–'));

/** Roles that sit in a company (and maybe a department); the others see the whole office. */
export const PLACED: OfficeRole[] = ['branch_manager', 'group_hod', 'hod', 'supervisor', 'staff'];
export const NEEDS_DEPARTMENT: OfficeRole[] = ['hod', 'supervisor'];

/** The roles this person may give: the office's own list (/api/auth/me assignable_roles). */
export function assignableRoles(me: OfficeMe): OfficeRole[] {
  const given = me.assignable_roles;
  if (given) return ROLES.filter((r) => given.includes(r));
  return [];
}

/** The companies a manager whose reach is their own company may place people in (null: any). */
export function allowedCompanies(me: OfficeMe): string[] | null {
  const sc = me.scope;
  if (!sc || sc.kind === 'all') return null;
  const ids = sc.branches?.map((b) => b.id) ?? [];
  return ids.length ? ids : sc.branch_id ? [sc.branch_id] : [];
}

/** The place the office expects with a role: none for roles over the whole office. */
export function placementBody(role: OfficeRole, companyIds: string[], departmentId: string) {
  if (!PLACED.includes(role)) return { branch_id: null, branch_ids: [] as string[], department_id: null };
  const ids = companyIds.filter(Boolean);
  return { branch_id: ids[0] ?? null, branch_ids: ids, department_id: departmentId && role !== 'branch_manager' ? departmentId : null };
}

export const companyIdsOf = (m: OfficeMember): string[] => (m.branches?.length ? m.branches.map((b) => b.id) : m.branch_id ? [m.branch_id] : []);
export const companyNamesOf = (m: OfficeMember): string[] => (m.branches?.length ? m.branches.map((b) => b.name) : m.branch_name ? [m.branch_name] : []);

export type MemberStatus = 'active' | 'pending' | 'disabled';
export function memberStatus(m: Pick<OfficeMember, 'is_active' | 'must_change_password'>): MemberStatus {
  if (!m.is_active) return 'disabled';
  return m.must_change_password ? 'pending' : 'active';
}
export const STATUS_TEXT: Record<MemberStatus, string> = { active: 'Active', pending: 'Not signed in yet', disabled: 'Switched off' };

/** Members per company and per department (a person in two companies counts in both). */
export function countsOf(members: OfficeMember[] | null): { byCompany: Map<string, number>; byDept: Map<string, number> } | null {
  if (!members) return null;
  const byCompany = new Map<string, number>();
  const byDept = new Map<string, number>();
  for (const m of members) {
    for (const id of companyIdsOf(m)) byCompany.set(id, (byCompany.get(id) ?? 0) + 1);
    if (m.department_id) byDept.set(m.department_id, (byDept.get(m.department_id) ?? 0) + 1);
  }
  return { byCompany, byDept };
}

export function sortedCompanies(list: OfficeCompany[]): OfficeCompany[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export function when(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });
}

/** Opens an office page in a new browser tab (the office's own screens). */
export function openOffice(path: string) {
  window.open(path, '_blank', 'noopener');
}

// ---------- Changes from a dialog ----------

/**
 * For a confirm dialog: runs the office call, refreshes the screens and shows the message; the office's refusal is
 * thrown, so the dialog shows it in place.
 */
export function useChange() {
  const { bump } = useContext(RefreshContext);
  const toast = useToast();
  return async <T,>(fn: () => Promise<T>, success: string): Promise<T> => {
    const r = await fn();
    bump();
    toast(heldText(r) ?? success);
    return r;
  };
}

// ---------- "Are you sure?" ----------

/**
 * A confirm dialog in the kit's look. `typeToConfirm` asks for the record's exact name first (deleting a company).
 * `run` throws to show the office's refusal in place; the dialog closes when it succeeds.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  typeToConfirm,
  run,
  onClose,
}: {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  run: () => Promise<unknown>;
  onClose: () => void;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const close = useRef(onClose);
  close.current = () => {
    if (!busyRef.current) onClose();
  };
  useEffect(() => (box.current ? activateDrawer(box.current, () => close.current()) : undefined), []);
  useBackClose(true, () => close.current());
  const matches = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase();
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await run();
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <div className="scrim dt-dialog-scrim" onClick={() => close.current()} />
      <div ref={box} className="dt-dialog oa-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="dt-dialog-title">
          {title}
        </h2>
        {body && <div className="muted small oa-confirm-body">{body}</div>}
        {typeToConfirm && (
          <label className="field">
            <span className="label">
              Type <b data-no-translate>{typeToConfirm}</b> to confirm
            </span>
            <input className="input" value={typed} disabled={busy} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        {error && <ErrorNotice error={error} />}
        <div className="dt-dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy || !matches}
            aria-busy={busy || undefined}
            onClick={() => void go()}
          >
            {danger && <TrashIcon size={16} weight="bold" aria-hidden="true" />}
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

/** A small "label: control" block for the forms. */
export function Field({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'field oa-wide' : 'field'}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}
