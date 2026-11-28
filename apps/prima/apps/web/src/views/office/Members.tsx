/**
 * P139 Members and roles: everyone who signs in to the office, in Prima's table (search, filters, sort, pages, export,
 * ticks). People managers (members.manage, or team.manage for their own company or department) add a member, change
 * their role, company, department, job title, who they report to, name or email, email them a sign-in password and
 * remove them, one or many. The roles offered are the ones the office lets this person give (assignable_roles). The
 * office checks every change again (routers/members.py, signin_mail.py).
 * P145b (owner, 27 Nov 2026: "open a FULL PAGE instead of the off-canvas drawer"): a row opens the member's own page
 * (MemberPage.tsx, #members/member/<id>); the drawer stays for the org chart's person panel.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { CopyIcon, EnvelopeSimpleIcon } from '@phosphor-icons/react';
import { useApp } from '../../App';
import {
  office,
  saved,
  type OfficeCompany,
  type OfficeLibraryGrants,
  type OfficeMember,
  type OfficeRole,
  type OfficeUnitKey,
} from '../../api/office';
import { DataTable, type DtColumn, type DtFilter } from '../../DataTable';
import { Facts, Stat, Stats } from '../../kit';
import { SearchSelect, type SelectOption } from '../../SearchSelect';
import { Chip, Drawer, ErrorNotice, dateLabel, useAction, useLoad, useToast, type Tone } from '../../ui';
import { openMember } from './member-route';
import {
  ConfirmDialog,
  Field,
  NEEDS_DEPARTMENT,
  PLACED,
  ROLE_INFO,
  STATUS_TEXT,
  allowedCompanies,
  assignableRoles,
  companyIdsOf,
  companyNamesOf,
  memberStatus,
  openOffice,
  placementBody,
  roleLabel,
  sortedCompanies,
  useChange,
  usePowers,
  when,
  type MemberStatus,
} from './shared';

export const STATUS_TONE: Record<MemberStatus, Tone> = { active: 'ok', pending: 'warn', disabled: 'neutral' };

export function MembersTab() {
  const p = usePowers();
  const { go } = useApp();
  const members = useLoad(() => office.members(), []);
  const companies = useLoad(() => office.companies(), []);
  const [adding, setAdding] = useState(false);
  const [emailing, setEmailing] = useState<OfficeMember | null>(null);
  const list = members.data;
  // P145b: their own full page (refresh-safe, deep-linkable), not a drawer.
  const open = (m: OfficeMember) => openMember(go, m.user_id);
  const isMe = (m: OfficeMember) => m.user_id === p.me.user.id;

  const columns: DtColumn<OfficeMember>[] = [
    {
      id: 'name',
      label: 'Name',
      value: (m) => m.name,
      phone: 'title',
      render: (m) => (
        <span className="oa-name">
          <b data-no-translate>{m.name}</b>
          {isMe(m) && <Chip tone="info">You</Chip>}
          {m.job_title && <small data-no-translate>{m.job_title}</small>}
        </span>
      ),
    },
    {
      id: 'email',
      label: 'Email',
      value: (m) => m.email,
      phone: 'sub',
      render: (m) => (
        <span data-no-translate className="oa-email">
          {m.email}
        </span>
      ),
    },
    { id: 'role', label: 'Role', value: (m) => roleLabel(m.role), translate: true, render: (m) => <Chip tone="info">{roleLabel(m.role)}</Chip> },
    {
      id: 'company',
      label: 'Company',
      value: (m) => companyNamesOf(m).join(', ') || null,
      render: (m) => <span data-no-translate>{companyNamesOf(m).join(', ') || '–'}</span>,
      hideBelow: 900,
    },
    {
      id: 'department',
      label: 'Department',
      value: (m) => m.department_name ?? null,
      render: (m) => <span data-no-translate>{m.department_name || '–'}</span>,
      hideBelow: 1100,
    },
    {
      id: 'last',
      label: 'Last sign-in',
      value: (m) => m.last_login_at,
      sort: 'date',
      hideBelow: 1250,
      render: (m) => (m.last_login_at ? dateLabel(m.last_login_at) : <span className="muted">Never</span>),
    },
    {
      id: 'status',
      label: 'Status',
      value: (m) => STATUS_TEXT[memberStatus(m)],
      translate: true,
      render: (m) => <Chip tone={STATUS_TONE[memberStatus(m)]}>{STATUS_TEXT[memberStatus(m)]}</Chip>,
    },
  ];

  const companyName = useMemo(() => new Map((companies.data ?? []).map((c) => [c.id, c.name])), [companies.data]);
  const filters: DtFilter<OfficeMember>[] = [
    { id: 'role', label: 'Role', value: (m) => m.role, optionLabel: roleLabel, allLabel: 'Every role' },
    { id: 'company', label: 'Company', value: (m) => companyIdsOf(m), optionLabel: (id) => companyName.get(id) ?? id, allLabel: 'Every company' },
    { id: 'department', label: 'Department', value: (m) => m.department_name ?? null, allLabel: 'Every department' },
    { id: 'status', label: 'Status', value: (m) => memberStatus(m), optionLabel: (s) => STATUS_TEXT[s as MemberStatus] ?? s, allLabel: 'Any status' },
  ];

  const count = (s: MemberStatus) => list?.filter((m) => memberStatus(m) === s).length ?? 0;
  return (
    <div className="oa-stack">
      <Stats>
        <Stat label="Members" value={list ? list.length : '…'} />
        <Stat label="Active" value={list ? count('active') : '…'} tone="ok" />
        <Stat label="Not signed in yet" value={list ? count('pending') : '…'} tone={count('pending') ? 'warn' : undefined} />
        <Stat label="Switched off" value={list ? count('disabled') : '…'} />
      </Stats>
      <DataTable
        label="Members"
        stateKey="office.members"
        rows={list}
        rowKey={(m) => m.user_id}
        columns={columns}
        filters={filters}
        searchText={(m) => `${m.reports_to_name ?? ''} ${m.job_title ?? ''}`}
        searchPlaceholder="Search name, email or job title"
        defaults={{ sort: 'name' }}
        loading={members.loading && !members.data}
        loadingWhat="members"
        error={members.error}
        recordName={(m) => m.name}
        onView={open}
        viewLabel="Open profile"
        onEdit={p.people ? open : undefined}
        editLabel="Edit profile and access"
        actions={(m) => [
          {
            label: 'Email a sign-in password',
            icon: <EnvelopeSimpleIcon size={16} aria-hidden="true" />,
            hidden: !p.members || !m.is_active || isMe(m),
            onClick: () => setEmailing(m),
          },
        ]}
        onDelete={p.people ? (m) => office.removeMember(m.user_id) : undefined}
        onDeleteMany={
          p.people
            ? async (rows) => {
                const r = await office.removeMembers(rows.map((m) => m.user_id));
                if (!('results' in r)) return undefined;
                return {
                  done: r.results.filter((x) => x.ok).map((x) => x.user_id),
                  failed: r.results.filter((x) => !x.ok).map((x) => ({ key: x.user_id, error: x.message || 'Refused by the office.' })),
                };
              }
            : undefined
        }
        canDelete={(m) => !isMe(m)}
        deleteLabel="Remove"
        deleteNote="They lose access to the office at once and are signed out. Their personal agents stay, without an owner."
        onAdd={p.people ? () => setAdding(true) : undefined}
        addLabel="Add member"
        onImport={p.people ? () => openOffice('/settings/members?import=1') : undefined}
        importLabel="Import from Excel"
        exportName="members"
      />
      {adding && <AddMember companies={companies.data ?? []} onClose={() => setAdding(false)} />}
      {emailing && <EmailSignin member={emailing} onClose={() => setEmailing(null)} />}
    </div>
  );
}

// ---------- Email a sign-in password ----------

export function EmailSignin({ member, onClose }: { member: Pick<OfficeMember, 'user_id' | 'name' | 'email'>; onClose: () => void }) {
  const change = useChange();
  return (
    <ConfirmDialog
      title={
        <>
          Email a sign-in password to <q data-no-translate>{member.name}</q>?
        </>
      }
      body={
        <>
          {'A new sign-in password goes to '}
          <b data-no-translate>{member.email}</b>
          {'. Their old password stops working. Ask them to look in Junk too.'}
        </>
      }
      confirmLabel="Email it"
      run={() => change(() => office.emailSignin(member.user_id), `Sign-in password emailed to ${member.name}.`)}
      onClose={onClose}
    />
  );
}

// ---------- Where they sit: role, company, department ----------

export interface Place {
  role: OfficeRole;
  companyIds: string[];
  departmentId: string;
}

export function PlaceFields({
  value,
  onChange,
  roles,
  companies,
  lockedRole,
  hideRole,
}: {
  value: Place;
  onChange: (p: Place) => void;
  roles: OfficeRole[];
  companies: OfficeCompany[];
  lockedRole?: string;
  /** P145b: the role is chosen elsewhere on the page; only the company and department here. */
  hideRole?: boolean;
}) {
  const p = usePowers();
  const allowed = allowedCompanies(p.me);
  const pool = sortedCompanies(allowed ? companies.filter((c) => allowed.includes(c.id)) : companies);
  const placed = PLACED.includes(value.role);
  const home = pool.find((c) => c.id === value.companyIds[0]) ?? null;
  const others = value.companyIds.slice(1);
  const [find, setFind] = useState('');
  const roleOptions: SelectOption[] = roles.map((r) => ({ value: r, label: r === 'hod' ? 'Head of department (HOD)' : ROLE_INFO[r].label }));
  const deptOptions: SelectOption[] = [
    { value: '', label: NEEDS_DEPARTMENT.includes(value.role) ? 'Choose a department' : 'No department' },
    ...(home ? [...home.departments].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: d.name })) : []),
  ];
  const setHome = (id: string) => onChange({ ...value, companyIds: [id, ...others.filter((x) => x !== id)], departmentId: '' });
  const toggleOther = (id: string, on: boolean) =>
    onChange({ ...value, companyIds: [value.companyIds[0] ?? '', ...(on ? [...others, id] : others.filter((x) => x !== id))].filter(Boolean) });
  const shown = pool.filter((c) => c.id !== home?.id && (!find.trim() || c.name.toLowerCase().includes(find.trim().toLowerCase())));
  return (
    <>
      {!hideRole && (
        <Field label="Role" hint={lockedRole ?? ROLE_INFO[value.role]?.blurb} wide>
          <SearchSelect
            className="select"
            aria-label="Role"
            value={value.role}
            disabled={!!lockedRole}
            options={roleOptions}
            onChange={(r) =>
              onChange({
                ...value,
                role: r as OfficeRole,
                companyIds: PLACED.includes(r as OfficeRole) && !value.companyIds.length && pool[0] ? [pool[0].id] : value.companyIds,
              })
            }
          />
        </Field>
      )}
      {placed ? (
        <>
          <Field label="Company" hint={others.length ? `Also in ${others.length} other ${others.length === 1 ? 'company' : 'companies'}.` : undefined}>
            <SearchSelect
              className="select"
              aria-label="Company"
              value={home?.id ?? ''}
              placeholder="Choose a company"
              options={pool.map((c) => ({ value: c.id, label: c.name }))}
              onChange={setHome}
            />
          </Field>
          {value.role !== 'branch_manager' && (
            <Field label="Department">
              <SearchSelect
                className="select"
                aria-label="Department"
                value={value.departmentId}
                options={deptOptions}
                onChange={(d) => onChange({ ...value, departmentId: d })}
              />
            </Field>
          )}
          {pool.length > 1 && (
            <details className="oa-wide oa-more" open={others.length > 0}>
              <summary>Also works in other companies {others.length ? `(${others.length})` : ''}</summary>
              {pool.length > 8 && (
                <input className="input" aria-label="Find a company" placeholder="Find a company" value={find} onChange={(e) => setFind(e.target.value)} />
              )}
              <div className="oa-checks">
                {shown.map((c) => (
                  <label key={c.id} className="oa-check-row">
                    <input type="checkbox" checked={others.includes(c.id)} onChange={(e) => toggleOther(c.id, e.target.checked)} />
                    <span data-no-translate>{c.name}</span>
                  </label>
                ))}
                {!shown.length && <span className="small muted">No other company matches.</span>}
              </div>
            </details>
          )}
        </>
      ) : (
        <p className="small muted oa-wide">{`${ROLE_INFO[value.role]?.label ?? 'This role'}: sees the whole office, not one company.`}</p>
      )}
    </>
  );
}

export const placeOf = (m: OfficeMember): Place => ({ role: m.role, companyIds: companyIdsOf(m), departmentId: m.department_id ?? '' });
export const samePlace = (a: Place, b: Place) => a.role === b.role && a.departmentId === b.departmentId && a.companyIds.join() === b.companyIds.join();

export function placeProblem(pl: Place): string | null {
  if (!PLACED.includes(pl.role)) return null;
  if (!pl.companyIds.length) return 'Choose a company.';
  if (NEEDS_DEPARTMENT.includes(pl.role) && !pl.departmentId) return 'A head of department or supervisor needs a department.';
  return null;
}

// ---------- Add a member ----------

function TempPassword({ email, password }: { email: string; password: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast('Copied.');
    } catch {
      toast('The browser blocked copying. Select the password and copy it by hand.');
    }
  };
  return (
    <div className="oa-stack">
      <p>
        {'Give this temporary password to '}
        <b data-no-translate>{email}</b>
        {'. It is shown only once. They choose their own password the first time they sign in.'}
      </p>
      <div className="oa-secret">
        <code data-no-translate>{password}</code>
        <button type="button" className="btn btn-sm" onClick={() => void copy()}>
          <CopyIcon size={15} aria-hidden="true" /> Copy
        </button>
      </div>
    </div>
  );
}

function AddMember({ companies, onClose }: { companies: OfficeCompany[]; onClose: () => void }) {
  const p = usePowers();
  const act = useAction();
  const roles = assignableRoles(p.me);
  const allowed = allowedCompanies(p.me);
  const firstCompany = allowed?.[0] ?? null;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [place, setPlace] = useState<Place>(() => {
    const role: OfficeRole = roles.includes('staff') ? 'staff' : (roles[0] ?? 'viewer');
    const sc = p.me.scope;
    return {
      role,
      companyIds: PLACED.includes(role) && firstCompany ? [sc?.branch_id ?? firstCompany] : [],
      departmentId: sc?.kind === 'department' ? (sc.department_id ?? '') : '',
    };
  });
  const [done, setDone] = useState<{ email: string; password: string } | null>(null);
  const problem = placeProblem(place);
  const ready = name.trim() && /.+@.+\..+/.test(email.trim()) && !problem;
  const add = async () => {
    if (!ready) return;
    const r = await act.run(
      () => office.addMember({ name: name.trim(), email: email.trim(), role: place.role, ...placementBody(place.role, place.companyIds, place.departmentId) }),
      (r) =>
        'member' in r && !r.temp_password ? `${email.trim()} added. They sign in with the password they already have.` : saved(`${name.trim()} added.`)(r),
    );
    if (!r) return;
    if ('temp_password' in r && r.temp_password) setDone({ email: email.trim(), password: r.temp_password });
    else onClose();
  };
  if (!roles.length)
    return (
      <Drawer title="Add member" onClose={onClose}>
        <ErrorNotice error="The office does not let you give any role, so you cannot add members." />
      </Drawer>
    );
  return (
    <Drawer title={done ? 'Member added' : 'Add member'} sub={done ? undefined : 'They get a temporary password to sign in with.'} onClose={onClose}>
      {done ? (
        <div className="oa-stack">
          <TempPassword email={done.email} password={done.password} />
          <div className="oa-form-actions">
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          className="oa-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label="Name">
            <input className="input" value={name} maxLength={120} autoFocus autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={email} autoComplete="off" placeholder="name@company.com" onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <PlaceFields value={place} onChange={setPlace} roles={roles} companies={companies} />
          {problem && <p className="small muted oa-wide">{problem}</p>}
          <ErrorNotice error={act.error} />
          <div className="oa-form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={act.busy || !ready}>
              {act.busy ? 'Adding…' : 'Add member'}
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

// ---------- One member: see and change ----------

export function MemberDrawer({
  member,
  members,
  companies,
  onClose,
  onEmail,
  onProfile,
}: {
  member: OfficeMember;
  members: OfficeMember[];
  companies: OfficeCompany[];
  onClose: () => void;
  onEmail: () => void;
  /** P146: opened over the org chart (Quick edit): their full page from here. */
  onProfile?: () => void;
}) {
  const p = usePowers();
  const act = useAction();
  const isMe = member.user_id === p.me.user.id;
  const start = placeOf(member);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [place, setPlace] = useState<Place>(start);
  const [jobTitle, setJobTitle] = useState(member.job_title ?? '');
  const [reportsTo, setReportsTo] = useState(member.reports_to_user_id ?? '');
  const [removing, setRemoving] = useState(false);
  const [resettingMs, setResettingMs] = useState(false);
  const assignable = assignableRoles(p.me);
  const roles = assignable.includes(member.role) ? assignable : [member.role, ...assignable];
  // The office lets nobody touch a role above what they may give (an admin and an owner).
  const touchable = assignable.includes(member.role);
  const status = memberStatus(member);
  // P144: the office's rule for Library access: members.manage, or the manager they report to; never themselves.
  const mayLibrary = !isMe && (p.members || (p.team && member.reports_to_user_id === p.me.user.id));

  const nameChanged = name.trim().replace(/\s+/g, ' ') !== member.name;
  const emailChanged = email.trim().toLowerCase() !== member.email.toLowerCase();
  const placeChanged = !samePlace(place, start);
  const titleChanged = jobTitle.trim() !== (member.job_title ?? '');
  const lineChanged = reportsTo !== (member.reports_to_user_id ?? '');
  const dirty = nameChanged || emailChanged || placeChanged || titleChanged || lineChanged;
  const problem = placeChanged ? placeProblem(place) : null;

  const managers: SelectOption[] = useMemo(
    () => [
      { value: '', label: 'No one' },
      ...members
        .filter((m) => m.user_id !== member.user_id && m.is_active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({ value: m.user_id, label: m.job_title ? `${m.name} (${m.job_title})` : m.name })),
    ],
    [members, member.user_id],
  );

  const save = async () => {
    if (!dirty || problem) return;
    const body: Record<string, unknown> = {
      ...(placeChanged ? { role: place.role, ...placementBody(place.role, place.companyIds, place.departmentId) } : {}),
      ...(nameChanged ? { name: name.trim() } : {}),
      ...(emailChanged ? { email: email.trim() } : {}),
      ...(titleChanged ? { job_title: jobTitle.trim() || null } : {}),
      ...(lineChanged ? { reports_to_user_id: reportsTo || null } : {}),
    };
    const r = await act.run(
      () => office.updateMember(member.user_id, body),
      saved(emailChanged ? `Saved. ${name.trim()} signs in again with ${email.trim()}.` : 'Saved.'),
    );
    if (r !== undefined) onClose();
  };

  const facts: [string, ReactNode][] = [
    [
      'Status',
      <Chip key="s" tone={STATUS_TONE[status]}>
        {STATUS_TEXT[status]}
      </Chip>,
    ],
    ['Role', roleLabel(member.role)],
    [
      'Company',
      <span key="c" data-no-translate>
        {companyNamesOf(member).join(', ') || '–'}
      </span>,
    ],
    [
      'Department',
      <span key="d" data-no-translate>
        {member.department_name || '–'}
      </span>,
    ],
    [
      'Job title',
      <span key="j" data-no-translate>
        {member.job_title || '–'}
      </span>,
    ],
    [
      'Reports to',
      <span key="r" data-no-translate>
        {member.reports_to_name || 'No one'}
      </span>,
    ],
    ['Last sign-in', when(member.last_login_at)],
    ['Member since', dateLabel(member.joined_at)],
    ['Microsoft sign-in', member.microsoft ? 'Linked' : 'Not linked'],
  ];
  if (member.manages) facts.push(['People under them', member.manages]);

  return (
    <>
      <Drawer title={<span data-no-translate>{member.name}</span>} sub={<span data-no-translate>{member.email}</span>} onClose={onClose}>
        <div className="oa-stack">
          {onProfile && (
            <div className="row">
              <button className="btn btn-sm" onClick={onProfile}>
                Open full profile
              </button>
            </div>
          )}
          <Facts items={facts} />
          {p.people && (
            <>
              <div className="row">
                {p.members && member.is_active && !isMe && (
                  <button className="btn btn-sm" onClick={onEmail}>
                    <EnvelopeSimpleIcon size={15} aria-hidden="true" /> Email a sign-in password
                  </button>
                )}
                {p.members && !isMe && (
                  <button className="btn btn-sm" onClick={() => setResettingMs(true)}>
                    Reset Microsoft link
                  </button>
                )}
                {!isMe && (
                  <button className="btn btn-sm oa-danger-text" onClick={() => setRemoving(true)}>
                    Remove
                  </button>
                )}
              </div>
              <h3 className="oa-h3">Change</h3>
              <form
                className="oa-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <Field label="Name">
                  <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Email">
                  <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                {emailChanged && (
                  <p className="notice oa-wide" data-tone="warn">
                    They will need to sign in again. With Microsoft, they are linked to the account of the new email, here and in Prima.
                  </p>
                )}
                <PlaceFields
                  value={place}
                  onChange={setPlace}
                  roles={roles}
                  companies={companies}
                  lockedRole={
                    isMe
                      ? 'You cannot change your own role. Ask another owner or admin.'
                      : !touchable
                        ? 'Their role is above what you may give, so only an owner can change it.'
                        : undefined
                  }
                />
                <Field label="Job title" hint="Shown on the organization chart.">
                  <input
                    className="input"
                    value={jobTitle}
                    maxLength={120}
                    placeholder="For example: HR Executive"
                    onChange={(e) => setJobTitle(e.target.value)}
                  />
                </Field>
                <Field label="Reports to">
                  <SearchSelect className="select" aria-label="Reports to" value={reportsTo} options={managers} onChange={setReportsTo} />
                </Field>
                {problem && <p className="small muted oa-wide">{problem}</p>}
                <ErrorNotice error={act.error} />
                <div className="oa-form-actions">
                  <button type="button" className="btn" onClick={onClose}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" disabled={act.busy || !dirty || !!problem || !name.trim() || !email.includes('@')}>
                    {act.busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
              {mayLibrary && <LibraryAccess member={member} companies={companies} />}
            </>
          )}
        </div>
      </Drawer>
      {removing && <RemoveMember member={member} onClose={() => setRemoving(false)} onDone={onClose} />}
      {resettingMs && <ResetMicrosoft member={member} onClose={() => setResettingMs(false)} />}
    </>
  );
}

// ---------- P144: Library access ----------

const NO_GRANTS: OfficeLibraryGrants = { units: [], companies: [], departments: [] };

const grantKey = (g: OfficeLibraryGrants | null | undefined) => {
  const v = g ?? NO_GRANTS;
  const list = (x: string[] | 'all') => (x === 'all' ? 'all' : [...x].sort().join(','));
  return `${list(v.units)}|${list(v.companies)}|${[...v.departments].sort().join(',')}`;
};

const noGrant = (g: OfficeLibraryGrants) =>
  (g.units !== 'all' && !g.units.length) && (g.companies !== 'all' && !g.companies.length) && !g.departments.length;

/** P144 (the owner, 27 Nov 2026): what of the Library this member reads (their whole company or own department), the
 * units and companies given to them on top (extra access, never less), and whether they upload for other companies.
 * The office checks it again: only units and companies the person setting it opens themselves; all companies only for
 * owners and admins (routers/members.py set_library_access). */
export function LibraryAccess({ member, companies, bare }: { member: OfficeMember; companies: OfficeCompany[]; bare?: boolean }) {
  const p = usePowers();
  const act = useAction();
  const units = useLoad(() => office.libraryUnits(), []);
  const givable = units.data?.units ?? [];
  const every = p.me.scope?.kind === 'all' && p.members;
  const [scope, setScope] = useState<'company' | 'department'>(member.library_scope ?? 'company');
  const [forOthers, setForOthers] = useState(!!member.uploads_for_others);
  const [grants, setGrants] = useState<OfficeLibraryGrants>(member.library_grants ?? NO_GRANTS);
  const [pick, setPick] = useState('');
  const g = grants;
  const unitOn = (k: OfficeUnitKey) => g.units === 'all' || g.units.includes(k);
  const toggleUnit = (k: OfficeUnitKey, on: boolean) => {
    const now = g.units === 'all' ? givable.map((u) => u.key) : g.units;
    const next = on ? [...new Set([...now, k])] : now.filter((x) => x !== k);
    setGrants({ ...g, units: givable.length > 1 && next.length === givable.length ? 'all' : next });
  };
  const picked = g.companies === 'all' ? [] : g.companies;
  const nameOf = (cid: string) => companies.find((c) => c.id === cid)?.name ?? cid;
  const options: SelectOption[] = [
    { value: '', label: 'Add a company' },
    ...sortedCompanies(companies)
      .filter((c) => !picked.includes(c.id))
      .map((c) => ({ value: c.id, label: c.name })),
  ];

  const scopeChanged = scope !== (member.library_scope ?? 'company');
  const othersChanged = forOthers !== !!member.uploads_for_others;
  const grantsChanged = grantKey(grants) !== grantKey(member.library_grants);
  const dirty = scopeChanged || othersChanged || grantsChanged;

  const parts = [scope === 'department' ? 'their own department' : 'their whole company'];
  if (g.units === 'all') parts.push('all units');
  else if (g.units.length) parts.push(g.units.map((k) => givable.find((u) => u.key === k)?.label ?? k).join(', '));
  if (g.companies === 'all') parts.push('all companies');
  else if (g.companies.length) parts.push(g.companies.length <= 3 ? g.companies.map(nameOf).join(', ') : `${g.companies.length} more companies`);
  if (g.departments.length) parts.push(g.departments.length === 1 ? '1 more department' : `${g.departments.length} more departments`);

  const save = async () => {
    if (!dirty) return;
    await act.run(
      () =>
        office.setLibraryAccess(member.user_id, {
          ...(scopeChanged ? { library_scope: scope } : {}),
          ...(othersChanged ? { uploads_for_others: forOthers } : {}),
          ...(grantsChanged ? { grants: noGrant(grants) ? null : grants } : {}),
        }),
      saved('Library access saved.'),
    );
  };

  return (
    <>
      {!bare && <h3 className="oa-h3">Library access</h3>}
      <form
        className="oa-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Files they can see" hint="Heads of department, supervisors and staff only; other roles see more than one department.">
          <SearchSelect
            className="select"
            aria-label="Files they can see"
            value={scope}
            onChange={(v) => setScope(v as 'company' | 'department')}
            options={[
              { value: 'company', label: 'Whole company' },
              { value: 'department', label: 'Own department only' },
            ]}
          />
        </Field>
        {givable.length > 0 && (
          <fieldset className="field oa-wide" aria-label="Units">
            <span className="label">Units</span>
            <div className="row">
              {givable.length > 1 && (
                <label className="row">
                  <input type="checkbox" checked={g.units === 'all'} onChange={(e) => setGrants({ ...g, units: e.target.checked ? 'all' : [] })} />
                  All units
                </label>
              )}
              {givable.map((u) => (
                <label key={u.key} className="row">
                  <input type="checkbox" checked={unitOn(u.key)} onChange={(e) => toggleUnit(u.key, e.target.checked)} />
                  {u.label}
                </label>
              ))}
            </div>
            <span className="small muted">They open the unit in the Library, read its files and add files to it, as its own people do.</span>
          </fieldset>
        )}
        <fieldset className="field oa-wide" aria-label="Other companies">
          <span className="label">Other companies</span>
          {every && (
            <label className="row">
              <input
                type="checkbox"
                checked={g.companies === 'all'}
                onChange={(e) => setGrants({ ...g, companies: e.target.checked ? 'all' : [] })}
              />
              All companies
            </label>
          )}
          {g.companies !== 'all' && (
            <>
              <SearchSelect
                className="select"
                aria-label="Add a company"
                value={pick}
                options={options}
                searchable
                onChange={(v) => {
                  setPick('');
                  if (v) setGrants({ ...g, companies: [...picked, v] });
                }}
              />
              {picked.length > 0 && (
                <div className="row">
                  {picked.map((cid) => (
                    <button
                      key={cid}
                      type="button"
                      className="btn btn-sm"
                      aria-label={`Remove ${nameOf(cid)}`}
                      onClick={() => setGrants({ ...g, companies: picked.filter((x) => x !== cid) })}
                    >
                      <span data-no-translate>{nameOf(cid)}</span> ×
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <span className="small muted">They read each company's shared files (never restricted ones or anyone's own files) and add files to it.</span>
        </fieldset>
        <label className="row oa-wide">
          <input type="checkbox" checked={forOthers} onChange={(e) => setForOthers(e.target.checked)} />
          May upload files for other companies
        </label>
        <p className="notice oa-wide">
          They read:{' '}
          {parts.map((t, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {t}
            </span>
          ))}
          .
        </p>
        <ErrorNotice error={act.error} />
        <div className="oa-form-actions">
          <button className="btn btn-primary" disabled={act.busy || !dirty}>
            {act.busy ? 'Saving…' : 'Save Library access'}
          </button>
        </div>
      </form>
    </>
  );
}

export function RemoveMember({ member, onClose, onDone }: { member: OfficeMember; onClose: () => void; onDone: () => void }) {
  const change = useChange();
  return (
    <ConfirmDialog
      title={
        <>
          Remove <q data-no-translate>{member.name}</q>?
        </>
      }
      body="They lose access to the office at once and are signed out. Their personal agents stay, without an owner."
      confirmLabel="Remove"
      danger
      run={async () => {
        await change(() => office.removeMember(member.user_id), `${member.name} removed.`);
        onDone();
      }}
      onClose={onClose}
    />
  );
}

export function ResetMicrosoft({ member, onClose }: { member: Pick<OfficeMember, 'user_id' | 'name' | 'email'>; onClose: () => void }) {
  const change = useChange();
  return (
    <ConfirmDialog
      title={
        <>
          Reset the Microsoft link of <q data-no-translate>{member.name}</q>?
        </>
      }
      body={
        <>
          {'Use this when the wrong Microsoft account got linked. They are signed out, their Outlook connection stops, and their next Microsoft sign-in with '}
          <b data-no-translate>{member.email}</b>
          {' links again, here and in Prima.'}
        </>
      }
      confirmLabel="Reset Microsoft link"
      danger
      run={() => change(() => office.resetMicrosoft(member.user_id), `${member.name} links again at their next Microsoft sign-in.`)}
      onClose={onClose}
    />
  );
}
