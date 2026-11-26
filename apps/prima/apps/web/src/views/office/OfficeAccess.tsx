/**
 * P139 Office access: what the office keeps of its own, in Prima's look (the office's apps/web/src/pages/office-access.tsx).
 *   - Prima keeps the companies and people: what the last run did and what waits for the owner (/api/prima-master);
 *   - who runs the office itself: owners, global admins and IT support (the owner adds and takes off);
 *   - helping someone sign in: find them, fix their email, email a sign-in password, reset their Microsoft link, and
 *     the emails that asked for a password but nobody has (/api/prima-master/unknown-signins);
 *   - Sign in as a role (/api/role-preview): a practice account; the page starts again as that role.
 */
import { useEffect, useState } from 'react';
import { ArrowsClockwiseIcon, EnvelopeSimpleIcon, PencilSimpleIcon, SignInIcon, UserMinusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { office, saved, type OfficeMember, type OfficeRole } from '../../api/office';
import { useApp, type ViewName } from '../../App';
import { Card, Search } from '../../kit';
import { SearchSelect } from '../../SearchSelect';
import { Chip, Drawer, ErrorNotice, Loading, useAction, useLoad } from '../../ui';
import { EmailSignin, ResetMicrosoft } from './Members';
import { ConfirmDialog, Field, roleLabel, useChange, usePowers, when } from './shared';

const OFFICE_ROLES: OfficeRole[] = ['owner', 'admin', 'it_support'];

/** The value after the person stops typing for a moment. */
function useSettled(value: string, ms = 300): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function OfficeAccessTab() {
  const p = usePowers();
  return (
    <div className="oa-stack">
      <PrimaMasterPanel />
      {p.runsOffice && <WhoRunsOffice />}
      {p.runsOffice && <SignInHelp />}
      <RolePreviewCard />
      {!p.runsOffice && (
        <p className="notice" data-tone="info">
          Owners, global admins and IT support manage who runs the office and help people sign in.
        </p>
      )}
    </div>
  );
}

// ---------- Prima keeps the companies and people ----------

const SCREENS: { view: ViewName; label: string; what: string }[] = [
  { view: 'accounts', label: 'Accounts and access', what: 'Add people, their company, department and access' },
  { view: 'orgchart', label: 'Org chart', what: 'Who reports to whom, and each unit’s head' },
  { view: 'people', label: 'People', what: 'Staff records (HR), with the email they sign in with' },
  { view: 'overview', label: 'Companies', what: 'Add a company (CEO)' },
];

function PrimaMasterPanel() {
  const { go, canOpen } = useApp();
  const q = useLoad(() => office.primaMaster(), []);
  const act = useAction();
  const data = q.data;
  if (!data?.on) return null;
  const s = data.summary ?? {};
  const held = Array.isArray(data.held) ? data.held : [];
  const screens = SCREENS.filter((x) => !canOpen || canOpen(x.view));
  return (
    <Card
      title="Companies, departments and people are kept in Prima"
      sub="The office follows Prima every 30 minutes: new companies and people appear by themselves, with their company, department and access level."
      actions={
        data.can_run ? (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => void act.run(() => office.primaRun(), 'The office follows Prima again.')}>
            <ArrowsClockwiseIcon size={15} aria-hidden="true" /> {act.busy ? 'Following Prima…' : 'Follow Prima now'}
          </button>
        ) : undefined
      }
    >
      <div className="oa-stack">
        <ErrorNotice error={act.error} />
        {screens.length > 0 && (
          <div className="oa-tiles">
            {screens.map((x) => (
              <button key={x.view} type="button" className="oa-tile" onClick={() => go({ view: x.view })}>
                <b>{x.label}</b>
                <small>{x.what}</small>
              </button>
            ))}
          </div>
        )}
        {Object.keys(s).length > 0 && (
          <p className="small muted">
            {`Last run: ${s.added ?? 0} added, ${s.raised ?? 0} given more access, ${s.moved ?? 0} moved, ${s.companies_made ?? 0} companies added, ${s.no_email ?? 0} without an email (add one in Prima).`}
          </p>
        )}
        {held.length > 0 && (
          <div className="oa-warn-box">
            <div className="oa-bar">
              <b>{`Waiting for the owner: ${held.length} ${held.length === 1 ? 'change' : 'changes'} that take access away`}</b>
              {data.can_apply_held && (
                <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => void act.run(() => office.primaApplyHeld(), 'Applied.')}>
                  Apply these
                </button>
              )}
            </div>
            <ul className="oa-plain-list">
              {held.slice(0, 60).map((h) => (
                <li key={`${h.user_id}:${h.kind}`}>
                  <b data-no-translate>{h.name}</b>{' '}
                  <span className="muted">
                    {h.kind === 'close' ? 'Prima closed their access: sign-in would be switched off' : `${roleLabel(h.from_role)} → ${roleLabel(h.to_role)}`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="small muted">
              Nobody loses access by surprise: these wait until the owner applies them. To keep someone’s access, give it to them in Prima (for example name
              them head of their unit in the Org chart).
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- Who runs the office ----------

function WhoRunsOffice() {
  const p = usePowers();
  const owners = useLoad(() => office.membersPage({ role: 'owner', pageSize: 100 }), []);
  const admins = useLoad(() => office.membersPage({ role: 'admin', pageSize: 100 }), []);
  const it = useLoad(() => office.membersPage({ role: 'it_support', pageSize: 100 }), []);
  const [q, setQ] = useState('');
  const settled = useSettled(q);
  const found = useLoad(
    () => (p.owner && settled.trim().length >= 2 ? office.membersPage({ q: settled, pageSize: 25 }) : Promise.resolve(null)),
    [settled, p.owner],
  );
  const [give, setGive] = useState<OfficeRole>('admin');
  const [confirm, setConfirm] = useState<{ member: OfficeMember; role: OfficeRole } | null>(null);
  const change = useChange();
  const people = [...(owners.data?.items ?? []), ...(admins.data?.items ?? []), ...(it.data?.items ?? [])];
  const loading = owners.loading && !owners.data;
  const error = owners.error || admins.error || it.error;
  const candidates = (found.data?.items ?? []).filter((m) => !OFFICE_ROLES.includes(m.role));
  return (
    <Card
      title="Who runs the office"
      sub="Owners, global admins and IT support are the office’s own: Prima never changes them. Taking someone off gives them back the access their Prima job gives (within 30 minutes)."
    >
      <div className="oa-stack">
        <ErrorNotice error={error} />
        {loading ? (
          <Loading what="the office's admins" />
        ) : (
          <ul className="oa-list oa-boxed">
            {people.map((m) => (
              <li key={m.user_id} className="oa-list-row">
                <span className="oa-list-main">
                  <b data-no-translate>{m.name}</b>
                  <small data-no-translate>{m.email}</small>
                </span>
                <span className="oa-list-actions">
                  <Chip tone="info">{roleLabel(m.role)}</Chip>
                  {p.owner && m.role !== 'owner' && m.user_id !== p.me.user.id && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirm({ member: m, role: 'staff' })}>
                      <UserMinusIcon size={15} aria-hidden="true" /> Take off
                    </button>
                  )}
                </span>
              </li>
            ))}
            {!people.length && <li className="oa-list-row muted">No one yet.</li>}
          </ul>
        )}
        {p.owner && (
          <div className="oa-stack">
            <div className="oa-add-row">
              <Search value={q} onChange={setQ} placeholder="Find someone to add (name or email)" />
              <SearchSelect
                className="select"
                aria-label="As"
                value={give}
                onChange={(v) => setGive(v as OfficeRole)}
                options={[
                  { value: 'admin', label: 'Global admin' },
                  { value: 'it_support', label: 'IT support' },
                  { value: 'owner', label: 'Owner' },
                ]}
              />
            </div>
            {found.error && <ErrorNotice error={found.error} />}
            {settled.trim().length >= 2 && found.data && !candidates.length && <p className="small muted">No one found who is not already here.</p>}
            {candidates.length > 0 && (
              <ul className="oa-list oa-boxed">
                {candidates.map((m) => (
                  <li key={m.user_id} className="oa-list-row">
                    <span className="oa-list-main">
                      <b data-no-translate>{m.name}</b>
                      <small data-no-translate>{m.email}</small>
                    </span>
                    <button className="btn btn-sm" onClick={() => setConfirm({ member: m, role: give })}>
                      <UserPlusIcon size={15} aria-hidden="true" /> {`Add as ${roleLabel(give)}`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {confirm && (
        <ConfirmDialog
          title={
            confirm.role === 'staff' ? (
              <>
                Take <q data-no-translate>{confirm.member.name}</q> off running the office?
              </>
            ) : (
              <>
                Make <q data-no-translate>{confirm.member.name}</q> {roleLabel(confirm.role)}?
              </>
            )
          }
          body={
            confirm.role === 'staff'
              ? 'They become staff here now; their Prima job gives them back their usual access within 30 minutes.'
              : confirm.role === 'owner'
                ? 'An owner can do everything, including making other owners and changing what each role may do.'
                : `They get the access of ${roleLabel(confirm.role)} at once.`
          }
          confirmLabel={confirm.role === 'staff' ? 'Take off' : 'Add'}
          danger={confirm.role === 'staff'}
          run={() => change(() => office.updateMember(confirm.member.user_id, { role: confirm.role }), 'Saved.')}
          onClose={() => setConfirm(null)}
        />
      )}
    </Card>
  );
}

// ---------- Help someone sign in ----------

function SignInHelp() {
  const [q, setQ] = useState('');
  const settled = useSettled(q);
  const found = useLoad(() => (settled.trim().length >= 2 ? office.membersPage({ q: settled, pageSize: 25 }) : Promise.resolve(null)), [settled]);
  const [fixing, setFixing] = useState<OfficeMember | null>(null);
  const [emailing, setEmailing] = useState<OfficeMember | null>(null);
  const [resetting, setResetting] = useState<OfficeMember | null>(null);
  const items = found.data?.items ?? [];
  const searching = settled.trim().length >= 2;
  return (
    <Card
      title="Help someone sign in"
      sub="Find them by name or email. The emailed sign-in password goes only to the email shown here, so a typo (outlookk.com) means nothing arrives: fix it first. Ask them to look in Junk too."
    >
      <div className="oa-stack">
        <Search value={q} onChange={setQ} placeholder="Name or email" />
        {found.error && <ErrorNotice error={found.error} />}
        {searching &&
          (found.loading && !found.data ? (
            <Loading what="people" />
          ) : items.length ? (
            <ul className="oa-list oa-boxed">
              {items.map((m) => (
                <li key={m.user_id} className="oa-list-row oa-help-row">
                  <span className="oa-list-main">
                    <b data-no-translate>{m.name}</b>
                    <small>
                      <span data-no-translate>{m.email}</span>
                      {` · ${m.last_login_at ? 'signed in before' : 'never signed in'}`}
                      {!m.is_active ? ' · switched off' : ''}
                    </small>
                  </span>
                  <span className="oa-list-actions">
                    <button className="btn btn-sm" onClick={() => setFixing(m)}>
                      <PencilSimpleIcon size={14} aria-hidden="true" /> Fix email
                    </button>
                    <button className="btn btn-sm" disabled={!m.is_active} onClick={() => setEmailing(m)}>
                      <EnvelopeSimpleIcon size={14} aria-hidden="true" /> Email a sign-in password
                    </button>
                    <button className="btn btn-sm" onClick={() => setResetting(m)}>
                      <ArrowsClockwiseIcon size={14} aria-hidden="true" /> Reset Microsoft
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">No one found. People are added in Prima (People, then Accounts and access).</p>
          ))}
        <NotRegistered />
      </div>
      {fixing && <FixIdentity member={fixing} onClose={() => setFixing(null)} />}
      {emailing && <EmailSignin member={emailing} onClose={() => setEmailing(null)} />}
      {resetting && <ResetMicrosoft member={resetting} onClose={() => setResetting(null)} />}
    </Card>
  );
}

/** Correct a name or sign-in email typed wrong when they were added. */
function FixIdentity({ member, onClose }: { member: OfficeMember; onClose: () => void }) {
  const act = useAction();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const emailChanged = email.trim().toLowerCase() !== member.email.toLowerCase();
  const nameChanged = name.trim().replace(/\s+/g, ' ') !== member.name;
  const save = async () => {
    if (!nameChanged && !emailChanged) return;
    const r = await act.run(
      () => office.updateMember(member.user_id, { ...(nameChanged ? { name: name.trim() } : {}), ...(emailChanged ? { email: email.trim() } : {}) }),
      saved(emailChanged ? `Saved. ${name.trim()} signs in again with ${email.trim()}.` : 'Saved.'),
    );
    if (r !== undefined) onClose();
  };
  return (
    <Drawer title="Change name or email" sub="Correct a name or email typed wrong when they were added." onClose={onClose}>
      <form
        className="oa-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name" wide>
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" wide>
          <input className="input" type="email" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {emailChanged && (
          <p className="notice oa-wide" data-tone="warn">
            They will need to sign in again. With Microsoft, they are linked to the account of the new email, here and in Prima.
          </p>
        )}
        <ErrorNotice error={act.error} />
        <div className="oa-form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={act.busy || (!nameChanged && !emailChanged) || !name.trim() || !email.includes('@')}>
            {act.busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

/** Who asked for a sign-in password in the last 7 days with an email nobody here has. */
function NotRegistered() {
  const { go, canOpen } = useApp();
  const q = useLoad(() => office.unknownSignins(), []);
  const rows = Array.isArray(q.data) ? q.data : [];
  if (!rows.length) return null;
  return (
    <div className="oa-warn-box">
      <b>{`Asked for a sign-in password but not added yet (${rows.length})`}</b>
      <p className="small muted">
        No email is sent to these addresses: nobody here has them. Add each person in Prima (People, Add office staff) with this exact email; they can sign in
        within 30 minutes. A misspelt address is just a typo: ignore it.
      </p>
      <ul className="oa-plain-list">
        {rows.slice(0, 50).map((r) => (
          <li key={r.email} className="oa-split-line">
            <b data-no-translate>{r.email}</b>
            <span className="muted">{when(r.at)}</span>
          </li>
        ))}
      </ul>
      {(!canOpen || canOpen('people')) && (
        <div>
          <button className="btn btn-sm" onClick={() => go({ view: 'people' })}>
            Open People
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Sign in as a role ----------

function RolePreviewCard() {
  const q = useLoad(() => office.rolePreview(), []);
  const act = useAction();
  const [role, setRole] = useState('staff');
  const [branchId, setBranchId] = useState('');
  const [deptId, setDeptId] = useState('');
  const data = q.data;
  if (!data?.can_start || !Array.isArray(data.roles) || !Array.isArray(data.branches)) return null;
  const chosen = data.roles.find((r) => r.role === role);
  const branch = data.branches.find((b) => b.id === branchId) ?? data.branches[0];
  const start = async () => {
    const r = await act.run(() =>
      office.startRolePreview({
        role,
        branch_id: chosen?.needs_branch ? (branch?.id ?? null) : null,
        department_id: chosen?.needs_department ? deptId || branch?.departments[0]?.id || null : null,
      }),
    );
    // A fresh page: every screen, menu and Prima itself start again as the practice account.
    if (r) (window.top ?? window).location.assign('/');
  };
  return (
    <Card
      title="Sign in as a role"
      sub="See exactly what another role sees. A practice account for that role is made the first time and kept, so you can change its permissions and try things on it. A bar at the bottom brings you back."
    >
      <div className="oa-preview">
        <Field label="Role">
          <SearchSelect
            className="select"
            aria-label="Role"
            value={role}
            onChange={setRole}
            options={data.roles.map((r) => ({ value: r.role, label: r.label }))}
          />
        </Field>
        {chosen?.needs_branch && data.branches.length > 0 && (
          <Field label="Company">
            <SearchSelect
              className="select"
              aria-label="Company"
              value={branch?.id ?? ''}
              onChange={(v) => {
                setBranchId(v);
                setDeptId('');
              }}
              options={data.branches.map((b) => ({ value: b.id, label: b.name }))}
            />
          </Field>
        )}
        {chosen?.needs_department && branch && branch.departments.length > 0 && (
          <Field label="Department">
            <SearchSelect
              className="select"
              aria-label="Department"
              value={deptId || branch.departments[0]?.id || ''}
              onChange={setDeptId}
              options={branch.departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Field>
        )}
        <div className="oa-preview-go">
          <button className="btn btn-primary" disabled={act.busy} onClick={() => void start()}>
            <SignInIcon size={16} weight="bold" aria-hidden="true" /> {act.busy ? 'Signing in…' : 'Sign in as this role'}
          </button>
        </div>
      </div>
      <ErrorNotice error={act.error} />
    </Card>
  );
}
