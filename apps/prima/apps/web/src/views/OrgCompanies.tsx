import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CaretDownIcon, CaretRightIcon, MagnifyingGlassIcon, PencilSimpleIcon, PlusIcon, UserPlusIcon } from '@phosphor-icons/react';
import { Avatar } from '../kit';
import { Drawer, ErrorNotice, useAction } from '../ui';
import { Select } from '../SearchSelect';

/**
 * P139 (Fitri, 27 Nov 2026: "in the org chart, where are all the organizations? ... the users under each department
 * searchable ... add more departments from here ... edit each organization's department names ... members setup here
 * too, fully custom"): the Companies view of the org chart canvas. Every company the office keeps, its departments and
 * the people in each, from the office's own records (the same as Members and organization): add a company or a
 * department, rename either, find anyone, move a person to another department or company by dragging them (or from
 * their box), change their role. The office applies its own rules to every change; the view reloads after each.
 */

type Dept = { id: string; branch_id: string; name: string; position: number };
type Company = { id: string; name: string; color: string; departments: Dept[] };
type Member = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  job_title?: string | null;
  branch_id: string | null;
  department_id: string | null;
  is_active: boolean;
};
type Me = { role: string; permissions: string[]; assignable_roles: string[] };

const ROLE: Record<string, string> = {
  owner: 'Owner',
  admin: 'Global admin',
  it_support: 'IT support',
  management: 'Management',
  hr: 'HR',
  branch_manager: 'Branch manager',
  group_hod: 'Group HOD',
  hod: 'Head of department',
  supervisor: 'Supervisor',
  staff: 'Staff',
  operator: 'Operator',
  approver: 'Approver',
  viewer: 'Viewer',
};

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)agentic_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function office<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf() },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!r.ok) throw new Error((data && typeof data === 'object' && 'message' in data && data.message) || `The office refused (${r.status}).`);
  return data as T;
}

const hueOf = (key: string) => [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

type Edit =
  | { kind: 'company-new' }
  | { kind: 'company-name'; company: Company }
  | { kind: 'dept-new'; company: Company }
  | { kind: 'dept-name'; dept: Dept }
  | { kind: 'person'; member: Member; to?: { company: Company; dept: Dept | null } }
  | { kind: 'add-person'; company: Company; dept: Dept | null };

export function CompaniesTree() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, m, who] = await Promise.all([
        office<Company[]>('/api/branches'),
        office<Member[]>('/api/members'),
        office<Me>('/api/auth/me'),
      ]);
      setCompanies(b);
      setMembers(Array.isArray(m) ? m : []);
      setMe(who);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const canOrg = !!me?.permissions.includes('org.manage');
  const canPeople = !!me && (me.permissions.includes('members.manage') || me.permissions.includes('team.manage'));
  const byCompany = useMemo(() => {
    const m = new Map<string, Member[]>();
    for (const p of members) m.set(p.branch_id ?? '', [...(m.get(p.branch_id ?? '') ?? []), p]);
    return m;
  }, [members]);
  const needle = q.trim().toLowerCase();
  const hit = (p: Member) => !needle || `${p.name} ${p.email} ${p.job_title ?? ''} ${ROLE[p.role] ?? p.role}`.toLowerCase().includes(needle);
  // Searching opens the companies that have someone matching.
  const shown = useMemo(() => {
    if (!companies) return [];
    if (!needle) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(needle) || (byCompany.get(c.id) ?? []).some(hit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, needle, byCompany]);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const dropOn = (company: Company, dept: Dept | null) => {
    const who = members.find((p) => p.user_id === dragging);
    setDragging(null);
    if (!who || !canPeople) return;
    if (who.branch_id === company.id && (who.department_id ?? null) === (dept?.id ?? null)) return;
    setEdit({ kind: 'person', member: who, to: { company, dept } });
  };

  if (error) return <ErrorNotice error={error instanceof Error ? error.message : String(error)} />;
  if (!companies) return <p className="muted">Loading the companies…</p>;
  return (
    <div className="oc-node oco">
      <div className="oc-box oc-group oco-root">
        <span className="oc-band" aria-hidden="true" />
        <div className="oc-box-main">
          <div className="oc-box-text">
            <strong className="oc-name">All companies</strong>
            <span className="oc-role">
              <span className="num">{companies.length}</span> <span>companies</span> · <span className="num">{members.length}</span> <span>people</span>
            </span>
            <label className="oco-find">
              <MagnifyingGlassIcon size={15} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person, email or company" aria-label="Find a person, email or company" />
            </label>
          </div>
        </div>
        {canOrg && (
          <button type="button" className="oc-add" title="Add a company" aria-label="Add a company" onClick={() => setEdit({ kind: 'company-new' })}>
            <PlusIcon size={13} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
      <span className="oc-stem" aria-hidden="true" />
      <ul className="oc-kids oc-wrap">
        {shown.map((c) => {
          const people = byCompany.get(c.id) ?? [];
          const isOpen = open.has(c.id) || (!!needle && people.some(hit));
          return (
            <li key={c.id}>
              <div className="oc-node">
                <div
                  className="oc-box oc-unit oco-co"
                  style={{ '--oc-h': hueOf(c.id) } as CSSProperties}
                  onDragOver={(e) => dragging && canPeople && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(c, null);
                  }}
                >
                  <span className="oc-band" aria-hidden="true" />
                  <div className="oc-box-main">
                    <div className="oc-box-text">
                      <strong className="oc-name" title={c.name}>
                        {c.name}
                      </strong>
                      <span className="oc-role">
                        <span className="num">{c.departments.length}</span> <span>departments</span> · <span className="num">{people.length}</span> <span>people</span>
                      </span>
                    </div>
                    {canOrg && (
                      <button type="button" className="oco-icon" title="Rename the company" aria-label={`Rename ${c.name}`} onClick={() => setEdit({ kind: 'company-name', company: c })}>
                        <PencilSimpleIcon size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <button type="button" className="oc-toggle" aria-expanded={isOpen} onClick={() => toggle(c.id)} title={isOpen ? 'Close' : 'Departments and people'}>
                    {isOpen ? <CaretDownIcon size={11} weight="bold" aria-hidden="true" /> : <CaretRightIcon size={11} weight="bold" aria-hidden="true" />}
                    <span className="num">{people.length}</span>
                  </button>
                  {canOrg && (
                    <button type="button" className="oc-add" title="Add a department" aria-label={`Add a department to ${c.name}`} onClick={() => setEdit({ kind: 'dept-new', company: c })}>
                      <PlusIcon size={13} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {isOpen && (
                  <>
                    <span className="oc-stem" aria-hidden="true" />
                    <ul className="oc-kids oc-wrap">
                      {[...c.departments.map((d) => d as Dept | null), null].map((d) => {
                        const inDept = people.filter((p) => (p.department_id ?? null) === (d?.id ?? null));
                        if (!d && !inDept.length) return null;
                        return (
                          <li key={d?.id ?? `${c.id}-none`}>
                            <DeptBox
                              company={c}
                              dept={d}
                              people={inDept}
                              hit={hit}
                              canOrg={canOrg}
                              canPeople={canPeople}
                              dragging={dragging}
                              onDrag={setDragging}
                              onDrop={() => dropOn(c, d)}
                              onEdit={setEdit}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {edit && me && (
        <EditDrawer
          edit={edit}
          me={me}
          companies={companies}
          members={members}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DeptBox({
  company,
  dept,
  people,
  hit,
  canOrg,
  canPeople,
  dragging,
  onDrag,
  onDrop,
  onEdit,
}: {
  company: Company;
  dept: Dept | null;
  people: Member[];
  hit: (p: Member) => boolean;
  canOrg: boolean;
  canPeople: boolean;
  dragging: string | null;
  onDrag: (id: string | null) => void;
  onDrop: () => void;
  onEdit: (e: Edit) => void;
}) {
  const [find, setFind] = useState('');
  const [over, setOver] = useState(false);
  const f = find.trim().toLowerCase();
  const list = people.filter((p) => hit(p) && (!f || `${p.name} ${p.email} ${p.job_title ?? ''}`.toLowerCase().includes(f)));
  return (
    <div
      className="oc-box oco-dept"
      data-drop={(over && !!dragging) || undefined}
      onDragOver={(e) => {
        if (!dragging || !canPeople) return;
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
    >
      <div className="oco-dept-head">
        <strong className="oc-name">{dept ? dept.name : 'No department yet'}</strong>
        <span className="muted small">
          <span className="num">{people.length}</span>
        </span>
        {dept && canOrg && (
          <button type="button" className="oco-icon" title="Rename the department" aria-label={`Rename ${dept.name}`} onClick={() => onEdit({ kind: 'dept-name', dept })}>
            <PencilSimpleIcon size={14} aria-hidden="true" />
          </button>
        )}
        {canPeople && (
          <button type="button" className="oco-icon" title="Put someone in this department" aria-label="Put someone in this department" onClick={() => onEdit({ kind: 'add-person', company, dept })}>
            <UserPlusIcon size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      {people.length > 6 && (
        <label className="oco-find oco-find-sm">
          <MagnifyingGlassIcon size={13} aria-hidden="true" />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in this department" aria-label="Find in this department" />
        </label>
      )}
      <ul className="oco-people">
        {list.map((p) => (
          <li
            key={p.user_id}
            draggable={canPeople || undefined}
            data-dragging={dragging === p.user_id || undefined}
            onDragStart={
              canPeople
                ? (e) => {
                    e.dataTransfer.setData('text/plain', p.user_id);
                    onDrag(p.user_id);
                  }
                : undefined
            }
            onDragEnd={() => onDrag(null)}
          >
            <button type="button" className="oco-person" onClick={() => canPeople && onEdit({ kind: 'person', member: p })} title={canPeople ? 'Role, company and department' : undefined}>
              <Avatar name={p.name} size={24} />
              <span className="oco-person-text">
                <strong title={p.name}>{p.name}</strong>
                <span className="muted small" title={p.email}>
                  {[ROLE[p.role] ?? p.role, p.job_title].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          </li>
        ))}
        {!list.length && <li className="muted small oco-none">{people.length ? 'Nobody matches.' : 'Nobody here yet.'}</li>}
      </ul>
    </div>
  );
}

function EditDrawer({ edit, me, companies, members, onClose, onDone }: { edit: Edit; me: Me; companies: Company[]; members: Member[]; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const startName = edit.kind === 'company-name' ? edit.company.name : edit.kind === 'dept-name' ? edit.dept.name : '';
  const [name, setName] = useState(startName);
  const person = edit.kind === 'person' ? edit.member : null;
  const [who, setWho] = useState('');
  const [role, setRole] = useState(person?.role ?? 'staff');
  const [company, setCompany] = useState(edit.kind === 'person' ? (edit.to?.company.id ?? person?.branch_id ?? '') : edit.kind === 'add-person' ? edit.company.id : '');
  const [dept, setDept] = useState(edit.kind === 'person' ? (edit.to ? (edit.to.dept?.id ?? '') : (person?.department_id ?? '')) : edit.kind === 'add-person' ? (edit.dept?.id ?? '') : '');
  const roles = [...new Set([...(me.assignable_roles ?? []), ...(person ? [person.role] : [])])];
  const depts = companies.find((c) => c.id === company)?.departments ?? [];
  const title =
    edit.kind === 'company-new'
      ? 'Add a company'
      : edit.kind === 'company-name'
        ? 'Rename the company'
        : edit.kind === 'dept-new'
          ? `Add a department to ${edit.company.name}`
          : edit.kind === 'dept-name'
            ? 'Rename the department'
            : edit.kind === 'add-person'
              ? `Put someone in ${edit.dept?.name ?? edit.company.name}`
              : person?.name ?? '';
  const save = async () => {
    switch (edit.kind) {
      case 'company-new':
        return office('/api/branches', 'POST', { name: name.trim() });
      case 'company-name':
        return office(`/api/branches/${edit.company.id}`, 'PATCH', { name: name.trim() });
      case 'dept-new':
        return office(`/api/branches/${edit.company.id}/departments`, 'POST', { name: name.trim() });
      case 'dept-name':
        return office(`/api/departments/${edit.dept.id}`, 'PATCH', { name: name.trim() });
      case 'add-person': {
        const m = members.find((x) => x.user_id === who);
        if (!m) throw new Error('Choose a person.');
        return office(`/api/members/${m.user_id}`, 'PATCH', { role: m.role, branch_id: company || null, department_id: dept || null });
      }
      case 'person':
        return office(`/api/members/${edit.member.user_id}`, 'PATCH', { role, branch_id: company || null, department_id: dept || null });
    }
  };
  const needsName = edit.kind === 'company-new' || edit.kind === 'company-name' || edit.kind === 'dept-new' || edit.kind === 'dept-name';
  const ready = needsName ? name.trim().length >= 2 && name.trim() !== startName : edit.kind === 'add-person' ? !!who : true;
  return (
    <Drawer title={title} sub={person ? person.email : undefined} onClose={onClose}>
      <div className="org-form">
        <ErrorNotice error={act.error} />
        {needsName && (
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={edit.kind.startsWith('dept') ? 'e.g. Operations' : 'e.g. Sasa Security Services Sdn Bhd'} />
          </label>
        )}
        {edit.kind === 'add-person' && (
          <label className="field">
            <span>Person</span>
            <Select className="input" value={who} onChange={(e) => setWho(e.target.value)} searchable>
              <option value="">Search a name or email…</option>
              {[...members]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name} ({m.email})
                  </option>
                ))}
            </Select>
          </label>
        )}
        {edit.kind === 'person' && (
          <>
            <label className="field">
              <span>Role</span>
              <Select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE[r] ?? r}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span>Company</span>
              <Select
                className="input"
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value);
                  setDept('');
                }}
                searchable
              >
                <option value="">None</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span>Department</span>
              <Select className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">None</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
        <div className="org-form-actions">
          <button className="btn btn-primary" disabled={act.busy || !ready} onClick={() => act.run(save, 'Saved.').then((r) => r !== undefined && onDone())}>
            Save
          </button>
        </div>
      </div>
    </Drawer>
  );
}
