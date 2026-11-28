/**
 * P145b (owner, 27 Nov 2026: "for each member, when I click view/edit, open a FULL PAGE instead of the off-canvas
 * drawer, about this user's profile: there I can set their Prima + Agentic access to which page/module and make sure
 * it's fully reflected; set their Library access; custom role; and add a new role in case the role is not listed").
 *
 * One member's own page in Members and organization (#members/member/<user_id>), in cards, each with its own Save:
 *   Profile        name, sign-in email, work email (Microsoft 365 page only), status, sign-in help   PATCH /api/members/{id}
 *   Job role       position from the group structure (the PDFs) or a new one, company, department,
 *                  job title, reports to                        PUT /api/members/{id}/position, POST /api/org/structure/positions
 *   Agentic access the office role (permission level) and what it gives                          PATCH /api/members/{id}
 *   Prima access   Agentic + Prima or Prima only, the Prima screens (ticked), Prima department, and
 *                  what Prima will really open (the office's Members > Access, P99/P128)   PUT /api/members/{id}/prima-access
 *   Library access what of the Library they read, units and companies given (P144)          PUT /api/members/{id}/library
 *   Remove         DELETE /api/members/{id}
 * The office checks every change again; each card shows only what /api/auth/me says this person may do (as the drawer).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  MinusCircleIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { useApp } from '../../App';
import {
  PRIMA_DEPARTMENTS,
  office,
  saved,
  type OfficeAccessKind,
  type OfficeCompany,
  type OfficeMember,
  type OfficeRole,
  type PrimaAccessIn,
  type PrimaCatalog,
  type PrimaDepartment,
  type PrimaEffective,
  type PrimaNeed,
} from '../../api/office';
import { structure, type OrgUnitRow, type PositionRow, type Structure } from '../../api/structure';
import { Card, Facts } from '../../kit';
import { SearchSelect, type SelectOption } from '../../SearchSelect';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../../ui';
import { EmailSignin, LibraryAccess, PlaceFields, RemoveMember, ResetMicrosoft, STATUS_TONE, placeOf, placeProblem, samePlace, type Place } from './Members';
import { AREAS, SECTIONS } from './RolesAccess';
import {
  Field,
  PLACED,
  ROLES,
  ROLE_INFO,
  STATUS_TEXT,
  assignableRoles,
  companyNamesOf,
  memberStatus,
  placementBody,
  roleLabel,
  usePowers,
  when,
} from './shared';
import '../../styles/member-page.css';

const SECTION_LINKS = [
  { id: 'mp-profile', label: 'Profile' },
  { id: 'mp-job', label: 'Job role and place' },
  { id: 'mp-agentic', label: 'Agentic access' },
  { id: 'mp-prima', label: 'Prima access' },
  { id: 'mp-library', label: 'Library access' },
] as const;

const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** The value after the person stops changing it for a moment. */
function useSettled(value: string, ms = 400): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function MemberPage({ userId, onBack, backLabel }: { userId: string; onBack: () => void; /** P146: "Back to the org chart" when opened from it. */ backLabel?: string }) {
  const p = usePowers();
  const member = useLoad(() => office.member(userId), [userId]);
  const members = useLoad(() => office.members(), []);
  const companies = useLoad(() => office.companies(), []);
  const struct = useLoad(() => structure.get(), []);
  const m = member.data;

  const back = (
    <button type="button" className="btn btn-ghost btn-sm mp-back" onClick={onBack}>
      <ArrowLeftIcon size={16} aria-hidden="true" /> {backLabel ?? 'Back to members'}
    </button>
  );
  if (!m)
    return (
      <div className="mp-page">
        {back}
        {member.error ? (
          <Card>
            <ErrorNotice error={member.error} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={member.reload}>
                Try again
              </button>
            </div>
          </Card>
        ) : (
          <Loading what="their profile" />
        )}
      </div>
    );

  const isMe = m.user_id === p.me.user.id;
  const status = memberStatus(m);
  const all = members.data ?? [];
  const comps = companies.data ?? [];
  // Each card starts again from what the office saved when its own part changes (not when another card saves).
  const k = (...xs: unknown[]) => JSON.stringify(xs);
  const mayLibrary = !isMe && (p.members || (p.team && m.reports_to_user_id === p.me.user.id));
  const position = struct.data?.positions.find((x) => x.id === (m.position_id ?? struct.data?.members.find((y) => y.user_id === m.user_id)?.position_id));

  return (
    <div className="mp-page">
      {back}
      <header className="mp-head">
        <span className="mp-avatar" aria-hidden="true">
          {initials(m.name)}
        </span>
        <div className="mp-head-text">
          <h1 data-no-translate>{m.name}</h1>
          <p className="mp-head-sub">
            <span data-no-translate>{m.email}</span>
            {(position?.title || m.job_title) && (
              <>
                {' · '}
                <span data-no-translate>{position?.title || m.job_title}</span>
              </>
            )}
          </p>
          <div className="mp-chips">
            <Chip tone="info">{roleLabel(m.role)}</Chip>
            <Chip tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Chip>
            {m.access === 'prima_only' && <Chip tone="neutral">Prima only</Chip>}
            {isMe && <Chip tone="info">You</Chip>}
          </div>
        </div>
      </header>
      <nav className="mp-jump" aria-label="On this page">
        {SECTION_LINKS.map((s) => (
          <button key={s.id} type="button" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {s.label}
          </button>
        ))}
      </nav>

      <ProfileCard key={k(m.name, m.email, m.work_email)} member={m} isMe={isMe} />
      <JobCard
        key={k(m.position_id, m.job_title, m.reports_to_user_id, m.department_id, m.branches, m.branch_id, m.role, struct.data ? 1 : 0)}
        member={m}
        members={all}
        companies={comps}
        struct={struct.data}
        structError={struct.error}
        isMe={isMe}
      />
      <AgenticCard key={k(m.role, m.branch_id, m.department_id)} member={m} companies={comps} isMe={isMe} />
      <PrimaCard key={k(m.access, m.prima_modules, m.prima_department, m.role)} member={m} isMe={isMe} />
      <Card id="mp-library" title="Library access" sub="What of the Library they and their AI read, and what more was given to them.">
        {mayLibrary ? (
          <LibraryAccess key={k(m.library_scope, m.uploads_for_others, m.library_grants)} member={m} companies={comps} bare />
        ) : (
          <p className="notice" data-tone="info">
            {isMe
              ? 'Nobody sets their own Library access. Ask another owner or admin.'
              : 'Owners, admins, management and HR set this, or the manager they report to.'}
          </p>
        )}
      </Card>
      {p.people && !isMe && <DangerCard member={m} onRemoved={onBack} />}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase() || '?';
}

// ---------- Profile ----------

function ProfileCard({ member, isMe }: { member: OfficeMember; isMe: boolean }) {
  const p = usePowers();
  const act = useAction();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [work, setWork] = useState(member.work_email ?? '');
  const [emailing, setEmailing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const status = memberStatus(member);
  const mayEdit = p.people;

  const nameChanged = name.trim().replace(/\s+/g, ' ') !== member.name;
  const emailChanged = email.trim().toLowerCase() !== member.email.toLowerCase();
  const workChanged = work.trim().toLowerCase() !== (member.work_email ?? '').toLowerCase();
  const dirty = nameChanged || emailChanged || workChanged;
  const problem = !name.trim()
    ? 'Give their name.'
    : !validEmail(email)
      ? 'The sign-in email does not look right.'
      : work.trim() && !validEmail(work)
        ? 'The work email does not look right.'
        : null;

  const save = async () => {
    if (!dirty || problem) return;
    await act.run(
      () =>
        office.updateMember(member.user_id, {
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(emailChanged ? { email: email.trim() } : {}),
          ...(workChanged ? { work_email: work.trim() || null } : {}),
        }),
      saved(emailChanged ? `Saved. ${name.trim()} signs in again with ${email.trim()}.` : 'Saved.'),
    );
  };

  const facts: [ReactNode, ReactNode][] = [
    [
      'Status',
      <Chip key="s" tone={STATUS_TONE[status]}>
        {STATUS_TEXT[status]}
      </Chip>,
    ],
    ['Last sign-in', when(member.last_login_at)],
    ['Member since', dateLabel(member.joined_at)],
    ['Microsoft sign-in', member.microsoft ? 'Linked' : 'Not linked'],
  ];
  if (!mayEdit) {
    facts.unshift(
      [
        'Sign-in email',
        <span key="e" data-no-translate>
          {member.email}
        </span>,
      ],
      [
        'Work email',
        <span key="w" data-no-translate>
          {member.work_email || '–'}
        </span>,
      ],
    );
  }
  if (member.manages) facts.push(['People under them', member.manages]);

  return (
    <Card
      id="mp-profile"
      title="Profile"
      sub="Who they are and how they sign in."
      actions={
        mayEdit && !isMe ? (
          <div className="mp-actions">
            {p.members && member.is_active && (
              <button className="btn btn-sm" onClick={() => setEmailing(true)}>
                <EnvelopeSimpleIcon size={15} aria-hidden="true" /> Email a sign-in password
              </button>
            )}
            {p.members && (
              <button className="btn btn-sm" onClick={() => setResetting(true)}>
                Reset Microsoft link
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="oa-stack">
        <Facts items={facts} />
        {mayEdit && (
          <form
            className="oa-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="Name">
              <input className="input" value={name} maxLength={120} autoComplete="off" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Sign-in email" hint="Their own email: they sign in with it (password or Microsoft).">
              <input className="input" type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Work email" hint="A shared or work mailbox, used only on the Microsoft 365 page. Leave empty if they have none.">
              <input
                className="input"
                type="email"
                value={work}
                autoComplete="off"
                placeholder="name@company.com"
                onChange={(e) => setWork(e.target.value)}
              />
            </Field>
            {emailChanged && (
              <p className="notice oa-wide" data-tone="warn">
                They will need to sign in again. With Microsoft, they are linked to the account of the new email, here and in Prima.
              </p>
            )}
            {dirty && problem && <p className="small muted oa-wide">{problem}</p>}
            <ErrorNotice error={act.error} />
            <div className="oa-form-actions">
              <button
                type="button"
                className="btn"
                disabled={act.busy || !dirty}
                onClick={() => {
                  setName(member.name);
                  setEmail(member.email);
                  setWork(member.work_email ?? '');
                }}
              >
                Undo changes
              </button>
              <button className="btn btn-primary" disabled={act.busy || !dirty || !!problem}>
                {act.busy ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </form>
        )}
      </div>
      {emailing && <EmailSignin member={member} onClose={() => setEmailing(false)} />}
      {resetting && <ResetMicrosoft member={member} onClose={() => setResetting(false)} />}
    </Card>
  );
}

// ---------- Job role (position) and place ----------

function unitPath(u: OrgUnitRow | undefined, byId: Map<string, OrgUnitRow>): string {
  if (!u) return 'Other';
  const parent = u.parent_id ? byId.get(u.parent_id) : undefined;
  return parent ? `${parent.name} › ${u.name}` : u.name;
}

const positionLabel = (x: PositionRow) => (x.title_ms && x.title_ms !== x.title ? `${x.title} (${x.title_ms})` : x.title);

function positionOptions(s: Structure, empty: string): SelectOption[] {
  const units = new Map(s.units.map((u) => [u.id, u]));
  const rows = s.positions.map((x) => ({ x, group: unitPath(units.get(x.unit_id), units), unitSort: units.get(x.unit_id)?.sort ?? 0 }));
  rows.sort((a, b) => a.unitSort - b.unitSort || a.group.localeCompare(b.group) || a.x.level - b.x.level || a.x.sort - b.x.sort || a.x.title.localeCompare(b.x.title));
  return [{ value: '', label: empty }, ...rows.map((r) => ({ value: r.x.id, label: positionLabel(r.x), group: r.group }))];
}

function JobCard({
  member,
  members,
  companies,
  struct,
  structError,
  isMe,
}: {
  member: OfficeMember;
  members: OfficeMember[];
  companies: OfficeCompany[];
  struct: Structure | null;
  structError: string | null;
  isMe: boolean;
}) {
  const p = usePowers();
  const act = useAction();
  const mayEdit = p.people;
  const startPos = member.position_id ?? struct?.members.find((y) => y.user_id === member.user_id)?.position_id ?? '';
  const [positionId, setPositionId] = useState(startPos);
  const [jobTitle, setJobTitle] = useState(member.job_title ?? '');
  const [reportsTo, setReportsTo] = useState(member.reports_to_user_id ?? '');
  const start = placeOf(member);
  const [place, setPlace] = useState<Place>(start);
  const [adding, setAdding] = useState(false);
  const canPosition = mayEdit && !!struct?.can_edit;

  const posById = useMemo(() => new Map((struct?.positions ?? []).map((x) => [x.id, x])), [struct]);
  const unitById = useMemo(() => new Map((struct?.units ?? []).map((u) => [u.id, u])), [struct]);
  const options = useMemo(() => (struct ? positionOptions(struct, 'No job role yet') : []), [struct]);
  const pos = positionId ? posById.get(positionId) : undefined;
  const boss = pos?.reports_to_id ? posById.get(pos.reports_to_id) : undefined;
  // Whoever holds the job this one reports to: offered as "Reports to" (one person only, never guessed).
  const bossHolders = boss ? (struct?.members ?? []).filter((y) => y.position_id === boss.id && y.user_id !== member.user_id && y.is_active) : [];

  const managers: SelectOption[] = useMemo(
    () => [
      { value: '', label: 'No one' },
      ...members
        .filter((x) => x.user_id !== member.user_id && x.is_active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => ({ value: x.user_id, label: x.job_title ? `${x.name} (${x.job_title})` : x.name })),
    ],
    [members, member.user_id],
  );

  const pickPosition = (id: string) => {
    const before = positionId ? posById.get(positionId)?.title : undefined;
    const next = id ? posById.get(id) : undefined;
    // The job title follows the job role unless someone typed their own.
    if (next && (!jobTitle.trim() || jobTitle.trim() === before || jobTitle.trim() === member.job_title)) setJobTitle(next.title);
    setPositionId(id);
  };

  const posChanged = positionId !== startPos;
  const titleChanged = jobTitle.trim() !== (member.job_title ?? '');
  const lineChanged = reportsTo !== (member.reports_to_user_id ?? '');
  const placeChanged = !samePlace(place, start);
  const dirty = posChanged || titleChanged || lineChanged || placeChanged;
  const problem = placeChanged ? placeProblem(place) : null;

  const save = async () => {
    if (!dirty || problem) return;
    await act.run(async () => {
      if (posChanged) await structure.setPosition(member.user_id, positionId || null, false);
      const body: Record<string, unknown> = {
        ...(placeChanged ? { role: member.role, ...placementBody(member.role, place.companyIds, place.departmentId) } : {}),
        ...(titleChanged ? { job_title: jobTitle.trim() || null } : {}),
        ...(lineChanged ? { reports_to_user_id: reportsTo || null } : {}),
      };
      return Object.keys(body).length ? office.updateMember(member.user_id, body) : null;
    }, saved('Saved.'));
  };

  const roleHint = pos?.default_role && pos.default_role !== member.role && pos.default_role in ROLE_INFO ? (pos.default_role as OfficeRole) : null;

  return (
    <Card id="mp-job" title="Job role and place" sub="Their job in the group (the roles from the Director Office and Government operation PDFs), company, department and line.">
      <div className="oa-stack">
        {structError && !struct && (
          <p className="notice" data-tone="warn">
            {'The group’s job roles could not be loaded: '}
            {structError}
          </p>
        )}
        {mayEdit ? (
          <form
            className="oa-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {struct && (
              <Field
                label="Job role"
                hint={canPosition ? 'Search by job title or unit. Not listed? Add a new role below.' : 'Only people who manage the organization or members change job roles.'}
                wide
              >
                <SearchSelect
                  className="select"
                  aria-label="Job role"
                  value={positionId}
                  options={options}
                  searchable
                  disabled={!canPosition}
                  onChange={pickPosition}
                />
              </Field>
            )}
            {pos && (
              <div className="mp-pos oa-wide">
                <span>
                  <span className="muted">Unit</span> <b data-no-translate>{unitPath(unitById.get(pos.unit_id), unitById)}</b>
                </span>
                {boss && (
                  <span>
                    <span className="muted">Reports to the job</span> <b data-no-translate>{positionLabel(boss)}</b>
                  </span>
                )}
                {pos.duties && <span className="small muted" data-no-translate>{pos.duties}</span>}
                {bossHolders.length === 1 && bossHolders[0].user_id !== reportsTo && (
                  <span>
                    <button type="button" className="btn btn-sm" onClick={() => setReportsTo(bossHolders[0].user_id)}>
                      {'Reports to '}
                      <span data-no-translate>{bossHolders[0].name}</span>
                    </button>
                  </span>
                )}
                {roleHint && (
                  <span className="small">
                    <WarningIcon size={13} aria-hidden="true" /> <span>Usual office role for this job:</span> <b>{roleLabel(roleHint)}</b>{' '}
                    <span>Change it under Agentic access below.</span>
                  </span>
                )}
              </div>
            )}
            {canPosition && struct && (
              <div className="oa-wide">
                {adding ? (
                  <AddRoleForm struct={struct} member={member} near={pos} onDone={() => setAdding(false)} />
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
                    <PlusIcon size={15} aria-hidden="true" /> Add a new role
                  </button>
                )}
              </div>
            )}
            <Field label="Job title" hint="Shown on the organization chart. It follows the job role; change it if their title differs.">
              <input className="input" value={jobTitle} maxLength={120} placeholder="For example: HR Executive" onChange={(e) => setJobTitle(e.target.value)} />
            </Field>
            <Field label="Reports to">
              <SearchSelect className="select" aria-label="Reports to" value={reportsTo} options={managers} searchable onChange={setReportsTo} />
            </Field>
            <PlaceFields value={place} onChange={setPlace} roles={[member.role]} companies={companies} hideRole />
            {isMe && <p className="small muted oa-wide">You may change your own place only if the office allows it; it checks again.</p>}
            {problem && <p className="small muted oa-wide">{problem}</p>}
            <ErrorNotice error={act.error} />
            <div className="oa-form-actions">
              <button className="btn btn-primary" disabled={act.busy || !dirty || !!problem}>
                {act.busy ? 'Saving…' : 'Save job role and place'}
              </button>
            </div>
          </form>
        ) : (
          <Facts
            items={[
              ['Job role', <span key="p" data-no-translate>{pos ? positionLabel(pos) : '–'}</span>],
              ['Company', <span key="c" data-no-translate>{companyNamesOf(member).join(', ') || '–'}</span>],
              ['Department', <span key="d" data-no-translate>{member.department_name || '–'}</span>],
              ['Job title', <span key="j" data-no-translate>{member.job_title || '–'}</span>],
              ['Reports to', <span key="r" data-no-translate>{member.reports_to_name || 'No one'}</span>],
            ]}
          />
        )}
      </div>
    </Card>
  );
}

/** A job role that is not in the list yet: added to the group structure, then given to this member. */
function AddRoleForm({ struct, member, near, onDone }: { struct: Structure; member: OfficeMember; near: PositionRow | undefined; onDone: () => void }) {
  const act = useAction();
  const [title, setTitle] = useState('');
  const [titleMs, setTitleMs] = useState('');
  const [unitId, setUnitId] = useState(near?.unit_id ?? '');
  const [reportsTo, setReportsTo] = useState(near?.id ?? '');
  const [role, setRole] = useState('');
  const byId = useMemo(() => new Map(struct.units.map((u) => [u.id, u])), [struct]);
  const unitOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: 'Choose a unit' },
      ...[...struct.units]
        .sort((a, b) => a.sort - b.sort || unitPath(a, byId).localeCompare(unitPath(b, byId)))
        .map((u) => ({ value: u.id, label: unitPath(u, byId) })),
    ],
    [struct, byId],
  );
  const bossOptions = useMemo(() => positionOptions(struct, 'No one (top of the unit)'), [struct]);
  const roleOptions: SelectOption[] = [
    { value: '', label: 'Not set' },
    ...ROLES.filter((r) => r !== 'owner').map((r) => ({ value: r, label: ROLE_INFO[r].label })),
  ];
  const clash = struct.positions.find((x) => x.unit_id === unitId && x.title.trim().toLowerCase() === title.trim().toLowerCase());
  const ready = title.trim().length >= 2 && !!unitId && !clash;
  const add = async () => {
    if (!ready) return;
    const r = await act.run(
      async () => {
        const made = await structure.addPosition({
          title: title.trim(),
          title_ms: titleMs.trim() || null,
          unit_id: unitId,
          reports_to_id: reportsTo || null,
          default_role: role || null,
        });
        await structure.setPosition(member.user_id, made.id, true);
        return made;
      },
      (made) => `${made.title} added and given to ${member.name}.`,
    );
    if (r) onDone();
  };
  return (
    <div className="mp-add-role">
      <h3 className="oa-h3">Add a new role</h3>
      <p className="small muted">For a job that is not in the list. It joins the group structure (the org chart shows it) and is given to them at once.</p>
      <div className="oa-form">
        <Field label="Title">
          <input className="input" value={title} maxLength={120} autoFocus placeholder="For example: Senior Executive, Tender" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Malay title" hint="Optional.">
          <input className="input" value={titleMs} maxLength={120} placeholder="Contoh: Eksekutif Kanan, Tender" onChange={(e) => setTitleMs(e.target.value)} />
        </Field>
        <Field label="Unit">
          <SearchSelect className="select" aria-label="Unit" value={unitId} options={unitOptions} searchable onChange={setUnitId} />
        </Field>
        <Field label="Reports to the job">
          <SearchSelect className="select" aria-label="Reports to the job" value={reportsTo} options={bossOptions} searchable onChange={setReportsTo} />
        </Field>
        <Field label="Usual office role" hint="What people in this job usually get in the office. Their own office role is set under Agentic access.">
          <SearchSelect className="select" aria-label="Usual office role" value={role} options={roleOptions} onChange={setRole} />
        </Field>
        {clash && <p className="small muted oa-wide">This unit already has that role: pick it from the list instead.</p>}
        <ErrorNotice error={act.error} />
        <div className="oa-form-actions">
          <button type="button" className="btn" disabled={act.busy} onClick={onDone}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={act.busy || !ready} onClick={() => void add()}>
            {act.busy ? 'Adding…' : 'Add the role and give it to them'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Agentic access: the office role ----------

function AgenticCard({ member, companies, isMe }: { member: OfficeMember; companies: OfficeCompany[]; isMe: boolean }) {
  const p = usePowers();
  const { go } = useApp();
  const act = useAction();
  const assignable = assignableRoles(p.me);
  const touchable = assignable.includes(member.role);
  const roles = touchable ? assignable : [member.role, ...assignable];
  const [role, setRole] = useState<OfficeRole>(member.role);
  const start = placeOf(member);
  const [place, setPlace] = useState<Place>(start);
  const access = useLoad(() => (p.owner ? office.roleAccess() : Promise.resolve(null)), [p.owner]);
  const locked = !p.people
    ? 'Only people who manage members change roles.'
    : isMe
      ? 'You cannot change your own role. Ask another owner or admin.'
      : !touchable
        ? 'Their role is above what you may give, so only an owner can change it.'
        : null;

  const roleChanged = role !== member.role;
  const next: Place = { ...place, role };
  const needsPlace = roleChanged && PLACED.includes(role);
  const problem = roleChanged ? placeProblem(next) : null;
  const dirty = roleChanged || (needsPlace && !samePlace(next, { ...start, role }));

  const save = async () => {
    if (!dirty || problem) return;
    await act.run(() => office.updateMember(member.user_id, { role, ...placementBody(role, next.companyIds, next.departmentId) }), saved('Office role saved.'));
  };

  const perms = role === 'owner' ? null : new Set(access.data?.roles.find((r) => r.role === role)?.effective ?? []);
  const roleOptions: SelectOption[] = roles.map((r) => ({ value: r, label: r === 'hod' ? 'Head of department (HOD)' : ROLE_INFO[r].label }));

  return (
    <Card id="mp-agentic" title="Agentic access" sub="Their office role: what they may do in the Agentic Office (AI team, tasks, Library, approvals, people).">
      <div className="oa-stack">
        <form
          className="oa-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Office role" hint={locked ?? undefined} wide>
            <SearchSelect className="select" aria-label="Office role" value={role} options={roleOptions} disabled={!!locked} onChange={(r) => setRole(r as OfficeRole)} />
          </Field>
          <div className="mp-role-blurb oa-wide">
            <b>{ROLE_INFO[role]?.label ?? role}</b>
            <span>{ROLE_INFO[role]?.blurb}</span>
            {PLACED.includes(role) ? (
              <span className="small muted">Works inside their company (and department): they see and run that part of the office only.</span>
            ) : (
              <span className="small muted">Sees the whole office, not one company.</span>
            )}
          </div>
          {needsPlace && <PlaceFields value={next} onChange={(x) => setPlace(x)} roles={[role]} companies={companies} hideRole />}
          {problem && <p className="small muted oa-wide">{problem}</p>}
          <ErrorNotice error={act.error} />
          {!locked && (
            <div className="oa-form-actions">
              <button
                type="button"
                className="btn"
                disabled={act.busy || !dirty}
                onClick={() => {
                  setRole(member.role);
                  setPlace(start);
                }}
              >
                Undo changes
              </button>
              <button className="btn btn-primary" disabled={act.busy || !dirty || !!problem}>
                {act.busy ? 'Saving…' : 'Save office role'}
              </button>
            </div>
          )}
        </form>
        <div className="mp-perms">
          <h3 className="oa-h3">What this role gives</h3>
          {role === 'owner' ? (
            <p className="small">Everything, including owner access, making other owners and changing what each role may do.</p>
          ) : !p.owner ? (
            <p className="small muted">Only an owner sees exactly what each role may do, permission by permission.</p>
          ) : access.error ? (
            <ErrorNotice error={access.error} />
          ) : !access.data ? (
            <Loading what="what the role gives" />
          ) : (
            <div className="mp-perm-sections">
              {SECTIONS.map((sec) => (
                <div key={sec} className="mp-perm-section">
                  <span className="mp-perm-title">{sec}</span>
                  <ul>
                    {AREAS.filter((a) => a.section === sec).map((a) => {
                      const on = !!perms && a.perms.every((x) => perms.has(x));
                      return (
                        <li key={a.key} className={on ? 'mp-on' : 'mp-off'} title={a.hint}>
                          {on ? <CheckCircleIcon size={15} weight="fill" aria-hidden="true" /> : <MinusCircleIcon size={15} aria-hidden="true" />}
                          <span>{a.label}</span>
                          <span className="mp-vh">{on ? 'Yes' : 'No'}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="small muted">
            Everyone with the same office role gets the same permissions: the office has no extra or withheld permissions for one person. To change what a
            role may do, an owner uses Roles and access.
          </p>
          {p.owner && (
            <div>
              <button type="button" className="btn btn-sm" onClick={() => go({ view: 'members', tab: 'roles' })}>
                Open Roles and access
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- Prima access: Agentic + Prima or Prima only, the Prima screens, the Prima department ----------

const DEPARTMENT_LABELS: Record<PrimaDepartment, string> = {
  operations: 'Operations',
  finance: 'Finance',
  procurement: 'Procurement and stores',
  hr: 'HR',
  chief_of_staff: 'Chief of Staff office',
  it: 'IT',
  legal: 'Legal',
  audit: 'Audit (ACT)',
  transport: 'Transport',
  asset: 'Asset management',
  pdpa: 'PDPA',
  fwm: 'Foreign workers',
  cms: 'CMS (control and monitoring)',
};
/** P125: these open staff personal data, payroll or money in Prima: central staff only. */
const SENSITIVE: PrimaDepartment[] = ['hr', 'finance', 'chief_of_staff', 'audit', 'legal'];

const ACCESS_CHOICES: { value: OfficeAccessKind; title: string; line: string }[] = [
  { value: 'agentic', title: 'Agentic + Prima', line: 'The office (desk, AI, tasks, chat) and Prima.' },
  { value: 'prima_only', title: 'Prima only', line: 'Signs in on the same page and goes straight to Prima. No office pages, AI or chat.' },
];

const sameList = (a: string[] | null, b: string[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && [...a].sort().join() === [...b].sort().join());

/** What a ticked screen Prima will not open still needs, in plain words (the office's needLine). */
function NeedLine({ n }: { n: PrimaNeed }) {
  switch (n.kind) {
    case 'department':
      return n.departments.length === 1 ? (
        <>
          {'Needs Prima department '}
          <b>{DEPARTMENT_LABELS[n.departments[0]] ?? n.departments[0]}</b>.
        </>
      ) : (
        <>
          {'Needs one of these Prima departments: '}
          {n.departments.map((d, i) => (
            <span key={d}>
              {i > 0 && ', '}
              <b>{DEPARTMENT_LABELS[d] ?? d}</b>
            </span>
          ))}
          .
        </>
      );
    case 'branch_manager':
      return <>Only for a company’s office staff (office role Branch manager).</>;
    case 'central_staff':
      return <>Only for central staff, not a branch manager.</>;
    case 'job':
      return (
        <>
          <span>Needs a Prima job:</span> <span data-no-translate>{n.jobs.slice(0, 3).join(', ')}</span>.{' '}
          <span>It is given in Prima (Accounts and access), not from the office.</span>
        </>
      );
    case 'leadership':
      return <>Only for group leadership in Prima.</>;
    default:
      return <>Not opened to office accounts.</>;
  }
}

function PrimaCard({ member, isMe }: { member: OfficeMember; isMe: boolean }) {
  const p = usePowers();
  const isOwner = member.role === 'owner';
  const mayEdit = p.members && !isMe && !isOwner;
  return (
    <Card id="mp-prima" title="Prima access" sub="Whether they use the office too, the Prima screens they get, and their Prima department. Saved in the office; Prima follows it.">
      {isOwner ? (
        <p className="notice" data-tone="info">
          Owners always have the office and all of Prima.
        </p>
      ) : !p.members ? (
        <div className="oa-stack">
          <Facts
            items={[
              ['What they can open', member.access === 'prima_only' ? 'Prima only' : 'Agentic + Prima'],
              [
                'Prima screens',
                member.prima_modules == null ? (
                  'All their Prima role allows'
                ) : (
                  <span key="n">
                    {member.prima_modules.length} <span>chosen</span>
                  </span>
                ),
              ],
            ]}
          />
          <p className="small muted">Owners, admins, management and HR set what someone reaches in Prima.</p>
        </div>
      ) : (
        <PrimaAccessForm member={member} mayEdit={mayEdit} isMe={isMe} />
      )}
    </Card>
  );
}

function PrimaAccessForm({ member, mayEdit, isMe }: { member: OfficeMember; mayEdit: boolean; isMe: boolean }) {
  const act = useAction();
  const catalog = useLoad(() => office.primaModules(), []);
  const had = member.prima_modules ?? null;
  const [access, setAccess] = useState<OfficeAccessKind>(member.access ?? 'agentic');
  const [modules, setModules] = useState<string[] | null>(had);
  const [department, setDepartment] = useState<PrimaDepartment | null>(member.prima_department ?? null);
  const [find, setFind] = useState('');
  const formKey = JSON.stringify({ modules, department });
  const previewKey = useSettled(formKey);
  const preview = useLoad(
    () => office.memberPrima(member.user_id, JSON.parse(previewKey) as { modules: string[] | null; department: PrimaDepartment | null }),
    [member.user_id, previewKey],
  );
  const cat: PrimaCatalog | null = catalog.data;
  const e: PrimaEffective | null = preview.data?.effective ?? null;
  const opens = new Set(e?.screens.map((x) => x.id) ?? []);
  const needs = new Map((e?.needs ?? []).map((n) => [n.id, n]));
  const choose = modules !== null;
  const allowedAll = cat ? cat.mine === null || had === null : true;
  const may = (id: string) => !cat || cat.mine === null || cat.mine.includes(id) || had === null || had.includes(id);
  const always = cat ? cat.apps.flatMap((a) => a.groups.flatMap((g) => g.modules)).filter((x) => x.always) : [];

  const accessChanged = access !== (member.access ?? 'agentic');
  const modulesChanged = !sameList(modules, had);
  const deptChanged = department !== (member.prima_department ?? null);
  const dirty = accessChanged || modulesChanged || deptChanged;

  const save = async () => {
    if (!dirty) return;
    const body: PrimaAccessIn = {
      ...(accessChanged ? { access } : {}),
      ...(modulesChanged ? { prima_modules: modules } : {}),
      ...(deptChanged ? { prima_department: department } : {}),
    };
    await act.run(() => office.setPrimaAccess(member.user_id, body), saved('Prima access saved. Prima follows it the next time they open or reload it.'));
  };

  const toggle = (id: string, on: boolean) => setModules((cur) => (on ? [...new Set([...(cur ?? []), id])] : (cur ?? []).filter((x) => x !== id)));
  const q = find.trim().toLowerCase();
  const deptOptions: SelectOption[] = [
    { value: '', label: 'No department' },
    ...PRIMA_DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] })),
  ];

  return (
    <div className="oa-stack">
      {isMe && <p className="notice" data-tone="info">You cannot change your own access. Ask another owner or admin.</p>}
      <fieldset className="mp-fieldset" disabled={!mayEdit}>
        <legend>What they can open</legend>
        <div role="radiogroup" aria-label="What they can open" className="mp-choices">
          {ACCESS_CHOICES.map((c) => (
            <button key={c.value} type="button" role="radio" aria-checked={access === c.value} className="mp-choice" onClick={() => setAccess(c.value)}>
              <b>{c.title}</b>
              <small>{c.line}</small>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mp-fieldset" disabled={!mayEdit}>
        <legend>Prima screens</legend>
        <div role="radiogroup" aria-label="Prima screens" className="mp-choices mp-choices-row">
          <button type="button" role="radio" aria-checked={!choose} className="mp-choice" disabled={!allowedAll && choose} onClick={() => setModules(null)}>
            <b>All screens their Prima role allows</b>
          </button>
          <button type="button" role="radio" aria-checked={choose} className="mp-choice" onClick={() => setModules(had ?? [])}>
            <b>Choose screens</b>
          </button>
        </div>
        {catalog.error && <ErrorNotice error={catalog.error} />}
        {cat && !cat.enabled && <p className="small muted">Prima is not set up on this server yet; this applies once it is.</p>}
        {choose && !cat && !catalog.error && <Loading what="Prima's screens" />}
        {choose && cat && (
          <div className="oa-stack">
            <p className="small muted">
              <span>Always included:</span> <span data-no-translate>{always.map((x) => x.title).join(', ')}</span>
            </p>
            <p className="small muted">A screen not ticked is hidden in Prima, and Prima refuses it with a plain message.</p>
            {cat.mine !== null && <p className="small muted">You can give only the Prima screens you have yourself.</p>}
            <input className="input" type="search" aria-label="Find a screen" placeholder="Find a screen" value={find} onChange={(ev) => setFind(ev.target.value)} />
            <div className="mp-apps">
              {cat.apps.map((a) => {
                const mods = a.groups.flatMap((g) => g.modules.filter((x) => !x.always).map((x) => ({ ...x, group: g.title })));
                const shown = q ? mods.filter((x) => `${x.title} ${x.blurb} ${x.group} ${a.title}`.toLowerCase().includes(q)) : mods;
                if (!shown.length) return null;
                const ticked = mods.filter((x) => modules?.includes(x.id)).length;
                const givable = mods.filter((x) => may(x.id)).map((x) => x.id);
                return (
                  <details key={a.id} className="mp-app" open={!!q || ticked > 0}>
                    <summary>
                      <b data-no-translate>{a.title}</b>
                      <span className="mp-count">
                        {ticked}/{mods.length}
                      </span>
                    </summary>
                    <div className="mp-app-tools">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModules((cur) => [...new Set([...(cur ?? []), ...givable])])}>
                        Tick all
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModules((cur) => (cur ?? []).filter((x) => !mods.some((y) => y.id === x)))}>
                        Clear
                      </button>
                    </div>
                    <ul className="mp-mods">
                      {shown.map((x) => {
                        const on = !!modules?.includes(x.id);
                        const need = on ? needs.get(x.id) : undefined;
                        const open = on && opens.has(x.id);
                        return (
                          <li key={x.id}>
                            <label className="mp-mod">
                              <input type="checkbox" checked={on} disabled={!may(x.id) && !on} onChange={(ev) => toggle(x.id, ev.target.checked)} />
                              <span className="mp-mod-text">
                                <span data-no-translate className="mp-mod-title">
                                  {x.title}
                                </span>
                                <small className="muted" data-no-translate>
                                  {[x.group !== a.title ? x.group : '', x.blurb].filter(Boolean).join(' · ')}
                                </small>
                                {open && (
                                  <small className="mp-on">
                                    <CheckCircleIcon size={13} weight="fill" aria-hidden="true" /> Opens in Prima
                                  </small>
                                )}
                                {need && (
                                  <small className="mp-need">
                                    <WarningIcon size={13} aria-hidden="true" /> <NeedLine n={need} />
                                  </small>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                );
              })}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="mp-fieldset" disabled={!mayEdit}>
        <legend>Prima department</legend>
        <SearchSelect
          className="select"
          aria-label="Prima department"
          value={department ?? ''}
          options={deptOptions}
          onChange={(v) => setDepartment((v || null) as PrimaDepartment | null)}
        />
        <p className="small muted">
          For their own Prima account: Prima opens the screens of their department, and the department’s work comes with it. A Prima staff record keeps the
          department set in Prima.
        </p>
        {department && SENSITIVE.includes(department) && (
          <p className="notice" data-tone="warn">
            {department === 'hr'
              ? 'HR sees staff personal data and payroll in Prima. Give it only to people who do HR work. Central staff only, not branch managers.'
              : 'This department sees money, pay or staff records in Prima. Give it only to people who do that work. Central staff only, not branch managers.'}
          </p>
        )}
      </fieldset>

      <PrimaExplain
        loading={preview.loading && !preview.data}
        error={preview.error}
        role={preview.data?.role_label ?? null}
        where={preview.data?.where ?? ''}
        e={e}
        onDepartment={mayEdit ? setDepartment : undefined}
        stale={preview.loading || previewKey !== formKey}
      />

      {mayEdit && (
        <>
          <ErrorNotice error={act.error} />
          <div className="oa-form-actions">
            <button
              type="button"
              className="btn"
              disabled={act.busy || !dirty}
              onClick={() => {
                setAccess(member.access ?? 'agentic');
                setModules(had);
                setDepartment(member.prima_department ?? null);
              }}
            >
              Undo changes
            </button>
            <button type="button" className="btn btn-primary" disabled={act.busy || !dirty} onClick={() => void save()}>
              {act.busy ? 'Saving…' : 'Save Prima access'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** P128: what they will really get in Prima with what is on the form (the office works it out by Prima's own rule). */
function PrimaExplain({
  loading,
  error,
  role,
  where,
  e,
  onDepartment,
  stale,
}: {
  loading: boolean;
  error: string | null;
  role: string | null;
  where: string;
  e: PrimaEffective | null;
  onDepartment?: (d: PrimaDepartment) => void;
  stale: boolean;
}) {
  if (loading) return <Loading what="what they get in Prima" />;
  if (error) return <ErrorNotice error={error} />;
  const tip = e?.suggestion;
  return (
    <section className="mp-explain" aria-busy={stale || undefined} data-stale={stale || undefined}>
      <h3 className="oa-h3">In Prima they will get</h3>
      <p className="small">
        <span className="muted">Prima role</span> <b data-no-translate>{role ?? '–'}</b>
        <br />
        <span className="muted" data-no-translate>
          {where}
        </span>
      </p>
      {e && e.how !== 'top' && (
        <p className="small">
          <span className="muted">Prima department</span> <b>{e.department ? DEPARTMENT_LABELS[e.department] : 'None'}</b>
        </p>
      )}
      {e?.how === 'refused' && (
        <p className="notice" data-tone="warn">
          Prima refused this department for them: their own staff record is in a company’s office, so they are that company’s office staff. Their Prima
          opens with no department.
        </p>
      )}
      {e && (
        <div className="mp-screens">
          <span className="muted small">Screens that open</span>
          {e.screens.length ? (
            <ul className="mp-tags">
              {e.screens.map((s) => (
                <li key={s.id} data-no-translate>
                  {s.title}
                </li>
              ))}
            </ul>
          ) : (
            <span className="small">None</span>
          )}
        </div>
      )}
      {e && e.needs.length > 0 && (
        <div className="mp-screens">
          <span className="muted small">Ticked, but Prima will not open them yet</span>
          <ul className="mp-needs">
            {e.needs.map((n) => (
              <li key={n.id}>
                <WarningIcon size={13} aria-hidden="true" />
                <span>
                  <b data-no-translate>{n.title}</b>: <NeedLine n={n} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tip && onDepartment && (
        <div className="mp-tip">
          <span className="small">
            <span>Prima department</span> <b>{DEPARTMENT_LABELS[tip.department]}</b> <span>would also open:</span>{' '}
            <span data-no-translate>{tip.adds.map((x) => x.title).join(', ')}</span>
          </span>
          <span className="small muted">A department is a job in Prima: they get all of that department’s work, not only these screens.</span>
          {tip.sensitive && <span className="small mp-need">This department sees money, pay, staff records or other protected data in Prima.</span>}
          <div>
            <button type="button" className="btn btn-sm" onClick={() => onDepartment(tip.department)}>
              {'Use '}
              <span>{DEPARTMENT_LABELS[tip.department]}</span>
            </button>
          </div>
        </div>
      )}
      {e && e.company_access.length > 0 && (
        <p className="small muted">
          <span>These show a company’s records only for the companies Prima gives them (Accounts and access in Prima):</span>{' '}
          <span data-no-translate>{e.company_access.map((x) => x.title).join(', ')}</span>
        </p>
      )}
    </section>
  );
}

// ---------- Remove ----------

function DangerCard({ member, onRemoved }: { member: OfficeMember; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  return (
    <Card title="Remove member">
      <div className="mp-danger">
        <p className="small">They lose access to the office at once and are signed out. Their personal agents stay, without an owner.</p>
        <button type="button" className="btn btn-danger" onClick={() => setRemoving(true)}>
          <TrashIcon size={16} weight="bold" aria-hidden="true" /> Remove
        </button>
      </div>
      {removing && <RemoveMember member={member} onClose={() => setRemoving(false)} onDone={onRemoved} />}
    </Card>
  );
}
