/**
 * P139 Roles and access: what each office role may do, permission by permission, grouped by area. The owner turns a
 * permission on or off per role, resets one role or all, and reviews the changes before saving; it applies from each
 * person's next click. The owner role is locked: it always has everything. The office shows this table to owners
 * only (GET /api/org/role-access is owner-only), so everyone else reads what each role is for.
 * Same rules as the office's apps/web/src/lib/role-access.ts and api/routers/role_access.py.
 */
import { useState } from 'react';
import { ArrowCounterClockwiseIcon, LockSimpleIcon } from '@phosphor-icons/react';
import { office, type OfficeRole, type RoleAccess, type RoleAccessRole, type RoleChanges } from '../../api/office';
import { Card, Empty, Search } from '../../kit';
import { SearchSelect } from '../../SearchSelect';
import { Chip, ErrorNotice, Loading, useLoad } from '../../ui';
import { ConfirmDialog, ROLES, ROLE_INFO, roleLabel, useChange, usePowers } from './shared';

interface Area {
  key: string;
  section: string;
  label: string;
  hint: string;
  perms: string[];
}

const WORK = 'Office and daily work';
const AI = 'AI team and knowledge';
const PEOPLE = 'People and organisation';
const SYSTEM = 'System and connections';
const SECTIONS = [WORK, AI, PEOPLE, SYSTEM];

const AREAS: Area[] = [
  {
    key: 'office',
    section: WORK,
    label: 'The whole office',
    hint: 'Command center, every agent, schedules, reports and the company overview.',
    perms: ['office.view'],
  },
  { key: 'work', section: WORK, label: 'Give work to the AI', hint: 'Tasks, chat and workflows.', perms: ['work.write'] },
  { key: 'approvals', section: WORK, label: 'Approvals', hint: 'Decide what agents ask before they act.', perms: ['approvals.decide'] },
  {
    key: 'assistants',
    section: WORK,
    label: 'Private assistants',
    hint: 'Their own assistants for company pulse, mail and chasing people.',
    perms: ['assistants.use'],
  },
  { key: 'twin', section: WORK, label: 'Own AI twin', hint: 'One personal AI that works for them.', perms: ['agents.own'] },
  { key: 'twin-logins', section: WORK, label: 'Own saved logins', hint: 'Website logins of their own that their AI twin may use.', perms: ['vault.own'] },
  { key: 'agents', section: AI, label: 'AI team and agents', hint: 'Create and change agents, their skills and SOPs.', perms: ['agents.manage'] },
  { key: 'brain', section: AI, label: 'Brain and learning', hint: 'What the office knows and how agents learn.', perms: ['brain.manage'] },
  {
    key: 'library',
    section: AI,
    label: 'Library files and saved logins',
    hint: 'Manage company files and the website logins agents use.',
    perms: ['vault.manage'],
  },
  {
    key: 'members',
    section: PEOPLE,
    label: 'Members and roles',
    hint: 'Add people, change their role, name or email, reset passwords. Never more access than their own.',
    perms: ['members.manage'],
  },
  {
    key: 'team',
    section: PEOPLE,
    label: 'Their own team',
    hint: 'Add and change the people below them in their company or department.',
    perms: ['team.manage'],
  },
  {
    key: 'org-see',
    section: PEOPLE,
    label: 'Organisation: see',
    hint: 'See every company and department and the setup pages, without changing them.',
    perms: ['org.read'],
  },
  {
    key: 'org-change',
    section: PEOPLE,
    label: 'Organisation: change',
    hint: 'Companies, departments, web connections and approved services.',
    perms: ['org.manage'],
  },
  { key: 'audit', section: PEOPLE, label: 'Audit log', hint: 'Every change made by people and agents.', perms: ['audit.read'] },
  { key: 'engine-see', section: SYSTEM, label: 'AI engine: see', hint: 'The AI providers, models and what the AI costs.', perms: ['engine.view'] },
  {
    key: 'engine-change',
    section: SYSTEM,
    label: 'AI engine: change',
    hint: 'Add or remove AI keys, choose models, privacy masking.',
    perms: ['engine.manage'],
  },
  {
    key: 'storage',
    section: SYSTEM,
    label: 'File storage',
    hint: 'Where company files are kept, with bucket keys and file server passwords.',
    perms: ['storage.manage'],
  },
  { key: 'mcp', section: SYSTEM, label: 'MCP tools', hint: 'Connect tools from other systems for the agents.', perms: ['mcp.manage'] },
  {
    key: 'channels',
    section: SYSTEM,
    label: 'Channels',
    hint: 'Telegram, WhatsApp, Microsoft 365 and API tokens for the company.',
    perms: ['channels.manage'],
  },
];

const areaOf = (perm: string) => AREAS.find((a) => a.perms.includes(perm));

// ---------- The arithmetic (as the office does it) ----------

function effectiveOf(defaults: string[], change?: { grant: string[]; revoke: string[] }): Set<string> {
  const out = new Set(defaults);
  for (const p of change?.grant ?? []) out.add(p);
  for (const p of change?.revoke ?? []) out.delete(p);
  return out;
}

const isOn = (perms: Set<string>, area: Area) => area.perms.every((p) => perms.has(p));

function toggle(changes: RoleChanges, role: OfficeRole, defaults: string[], area: Area, on: boolean): RoleChanges {
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
  const next: RoleChanges = { ...changes };
  if (grant.size || revoke.size) next[role] = { grant: [...grant].sort(), revoke: [...revoke].sort() };
  else delete next[role];
  return next;
}

function changesOf(data: RoleAccess): RoleChanges {
  const out: RoleChanges = {};
  for (const r of data.roles) if (r.editable && (r.grant.length || r.revoke.length)) out[r.role] = { grant: [...r.grant], revoke: [...r.revoke] };
  return out;
}

const sorted = (c: RoleChanges) =>
  Object.keys(c)
    .sort()
    .map((k) => [k, c[k as OfficeRole]]);
const same = (a: RoleChanges, b: RoleChanges) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

interface Diff {
  role: OfficeRole;
  turnsOn: string[];
  turnsOff: string[];
}

function diffOf(roles: RoleAccessRole[], draft: RoleChanges, saved: RoleChanges): Diff[] {
  const out: Diff[] = [];
  for (const r of roles) {
    if (!r.editable) continue;
    const now = effectiveOf(r.default, saved[r.role]);
    const next = effectiveOf(r.default, draft[r.role]);
    const d = { role: r.role, turnsOn: [...next].filter((p) => !now.has(p)).sort(), turnsOff: [...now].filter((p) => !next.has(p)).sort() };
    if (d.turnsOn.length || d.turnsOff.length) out.push(d);
  }
  return out;
}

const permName = (perm: string) => areaOf(perm)?.label ?? perm;

// ---------- The tab ----------

export function RolesAccessTab() {
  const p = usePowers();
  if (!p.owner) return <RolesExplained />;
  return <RolesMatrix />;
}

/** Not an owner: what each role is for (the office shows the permission table to owners only). */
function RolesExplained() {
  return (
    <div className="oa-stack">
      <p className="notice" data-tone="info">
        Only an owner can see and change exactly what each role may do. Here is what each role is for.
      </p>
      <Card title="Office roles" flush>
        <ul className="oa-list">
          {ROLES.map((r) => (
            <li key={r} className="oa-list-row">
              <span className="oa-list-main">
                <b>{ROLE_INFO[r].label}</b>
                <small>{ROLE_INFO[r].blurb}</small>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function RolesMatrix() {
  const q = useLoad(() => office.roleAccess(), []);
  const change = useChange();
  const [draft, setDraft] = useState<RoleChanges | null>(null);
  const [phoneRole, setPhoneRole] = useState<OfficeRole>('management');
  const [find, setFind] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (q.loading && !q.data) return <Loading what="roles and access" />;
  if (q.error || !q.data)
    return (
      <div className="oa-stack">
        <ErrorNotice error={q.error ?? 'Could not load roles and access.'} />
        <div>
          <button className="btn" onClick={q.reload}>
            Try again
          </button>
        </div>
      </div>
    );

  const data = q.data;
  const saved = changesOf(data);
  const changes = draft ?? saved;
  const dirty = !same(changes, saved);
  const roles = data.roles.filter((r) => r.editable);
  const owner = data.roles.find((r) => r.role === 'owner');
  const needle = find.trim().toLowerCase();
  const rows = needle ? AREAS.filter((a) => [a.label, a.hint, a.section, ...a.perms].join(' ').toLowerCase().includes(needle)) : AREAS;
  const sections = SECTIONS.map((s) => ({ name: s, rows: rows.filter((a) => a.section === s) })).filter((s) => s.rows.length);
  const cell = (r: RoleAccessRole, area: Area) => {
    const now = isOn(effectiveOf(r.default, changes[r.role]), area);
    return { now, changed: now !== isOn(new Set(r.default), area) };
  };
  const flip = (r: RoleAccessRole, area: Area, on: boolean) => setDraft(toggle(changes, r.role, r.default, area, on));
  const changedCount = (r: RoleAccessRole) => AREAS.filter((a) => cell(r, a).changed).length;
  const picked = roles.find((r) => r.role === phoneRole) ?? roles[0];
  const diff = diffOf(data.roles, changes, saved);

  return (
    <div className="oa-stack">
      <div className="oa-bar">
        <Search value={find} onChange={setFind} placeholder="Search permissions" />
        <div className="row">
          {dirty && <Chip tone="warn">Not saved yet</Chip>}
          <button className="btn" disabled={!Object.keys(changes).length} onClick={() => setResetting(true)}>
            <ArrowCounterClockwiseIcon size={15} aria-hidden="true" /> Reset to defaults
          </button>
          <button className="btn btn-primary" disabled={!dirty} onClick={() => setReviewing(true)}>
            Save changes
          </button>
        </div>
      </div>
      <p className="small muted oa-legend">
        <span>
          <span className="oa-changed-dot" aria-hidden="true" /> Changed from the default
        </span>
        <span>
          <LockSimpleIcon size={13} aria-hidden="true" /> The owner always has everything.
        </span>
      </p>
      {!sections.length && (
        <Empty
          title="Nothing matches."
          action={
            <button className="btn" onClick={() => setFind('')}>
              Clear the search
            </button>
          }
        >
          Try another word, such as members or AI engine.
        </Empty>
      )}

      {/* Phone: pick a role, then its switches. */}
      {picked && sections.length > 0 && (
        <div className="oa-phone-only oa-stack">
          <label className="field">
            <span className="label">Role</span>
            <SearchSelect
              className="select"
              aria-label="Role"
              value={picked.role}
              onChange={(v) => setPhoneRole(v as OfficeRole)}
              options={roles.map((r) => ({ value: r.role, label: changedCount(r) ? `${roleLabel(r.role)} (${changedCount(r)} changed)` : roleLabel(r.role) }))}
            />
          </label>
          <p className="small muted">{ROLE_INFO[picked.role]?.blurb}</p>
          {changedCount(picked) > 0 && (
            <div>
              <button className="btn btn-sm" onClick={() => setDraft({ ...Object.fromEntries(Object.entries(changes).filter(([k]) => k !== picked.role)) })}>
                <ArrowCounterClockwiseIcon size={14} aria-hidden="true" /> Reset {roleLabel(picked.role)}
              </button>
            </div>
          )}
          {sections.map((s) => (
            <Card key={s.name} title={s.name} flush>
              <ul className="oa-list">
                {s.rows.map((area) => {
                  const c = cell(picked, area);
                  return (
                    <li key={area.key} className="oa-list-row">
                      <span className="oa-list-main">
                        <b>{area.label}</b>
                        <small>{area.hint}</small>
                      </span>
                      <Switch on={c.now} changed={c.changed} label={`${area.label} for ${roleLabel(picked.role)}`} onChange={(on) => flip(picked, area, on)} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {/* Computer: the whole table, roles as columns, the owner locked first. */}
      {sections.length > 0 && (
        <div className="oa-matrix-wrap oa-desk-only">
          <table className="oa-matrix">
            <thead>
              <tr>
                <th scope="col" className="oa-matrix-perm">
                  Permission
                </th>
                {owner && (
                  <th scope="col">
                    {roleLabel('owner')}
                    <small>
                      <LockSimpleIcon size={11} aria-hidden="true" /> Locked
                    </small>
                  </th>
                )}
                {roles.map((r) => (
                  <th key={r.role} scope="col" title={ROLE_INFO[r.role]?.blurb}>
                    {roleLabel(r.role)}
                    {changedCount(r) > 0 && (
                      <button className="oa-link" onClick={() => setDraft(Object.fromEntries(Object.entries(changes).filter(([k]) => k !== r.role)))}>
                        Reset
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            {sections.map((s) => (
              <tbody key={s.name}>
                <tr className="oa-matrix-section">
                  <th scope="rowgroup" colSpan={roles.length + 2}>
                    {s.name}
                  </th>
                </tr>
                {s.rows.map((area) => (
                  <tr key={area.key}>
                    <th scope="row" className="oa-matrix-perm">
                      <b>{area.label}</b>
                      <small>{area.hint}</small>
                    </th>
                    {owner && (
                      <td>
                        <Switch on label={`${area.label} for the owner`} locked />
                      </td>
                    )}
                    {roles.map((r) => {
                      const c = cell(r, area);
                      return (
                        <td key={r.role}>
                          <Switch on={c.now} changed={c.changed} label={`${area.label} for ${roleLabel(r.role)}`} onChange={(on) => flip(r, area, on)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {reviewing && (
        <ConfirmDialog
          title="Save these changes?"
          body={
            diff.length ? (
              <ul className="oa-diff">
                {diff.map((d) => (
                  <li key={d.role}>
                    <b>{roleLabel(d.role)}</b>
                    {d.turnsOn.length > 0 && <span className="oa-on">{`Gets: ${d.turnsOn.map(permName).join(', ')}`}</span>}
                    {d.turnsOff.length > 0 && <span className="oa-off">{`Loses: ${d.turnsOff.map(permName).join(', ')}`}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              'Nothing changes.'
            )
          }
          confirmLabel="Save changes"
          run={async () => {
            await change(() => office.saveRoleAccess(changes), 'Saved. Each person gets the new access on their next click.');
            setDraft(null);
          }}
          onClose={() => {
            setReviewing(false);
          }}
        />
      )}
      {resetting && (
        <ConfirmDialog
          title="Put every role back to its defaults?"
          body="Every change made here is undone and saved at once. Each person gets the default access of their role on their next click."
          confirmLabel="Reset to defaults"
          danger
          run={async () => {
            await change(() => office.saveRoleAccess({}), 'Every role is back to its defaults.');
            setDraft(null);
          }}
          onClose={() => setResetting(false)}
        />
      )}
    </div>
  );
}

function Switch({
  on,
  changed,
  label,
  onChange,
  locked,
}: {
  on: boolean;
  changed?: boolean;
  label: string;
  onChange?: (on: boolean) => void;
  locked?: boolean;
}) {
  return (
    <span className="oa-switch-wrap">
      <input
        type="checkbox"
        role="switch"
        className="oa-switch"
        checked={on}
        disabled={locked}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      {changed && <span className="oa-changed-dot oa-switch-dot" aria-hidden="true" />}
    </span>
  );
}
