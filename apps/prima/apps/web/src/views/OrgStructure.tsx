import { useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import {
  ArrowUpIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  TreeStructureIcon,
  UserCircleIcon,
  UserMinusIcon,
  UsersThreeIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { api } from '../api';
import { useApp } from '../App';
import { structure, type OrgUnitRow, type PositionRow, type Structure, type StructureMember, type UnitKind } from '../api/structure';
import { useLang } from '../i18n';
import { Avatar } from '../kit';
import { Select } from '../SearchSelect';
import { Chip, Drawer, ErrorNotice, useAction, useLoad } from '../ui';
import { openMember } from './office/member-route';
import { ROLES, roleLabel } from './office/shared';

/** Opens a member's own page (P145b) from the chart. */
function ProfileButton({ userId, name }: { userId: string; name: string }) {
  const { go } = useApp();
  return (
    <button type="button" className="btn btn-sm btn-ghost oc-profile" title={`Open profile: ${name}`} aria-label={`Open profile: ${name}`} onClick={() => openMember(go, userId)}>
      <UserCircleIcon size={14} aria-hidden="true" />
      <span className="hide-sm">Open profile</span>
    </button>
  );
}

/**
 * P145 (owner, 27 Nov 2026: "Full revamp of the org chart, organization and members setup. Roles come from DIRECTOR
 * OFFICE GORVERNANCE.pdf and GOVERNMENT OPERATION.pdf ... In the org chart Departments section everything must be wired,
 * the tree connected accordingly ... If a member's role can't be identified, I must be able to sort them manually very
 * easily. The org chart must be fully flexible; I can add a new role when it's not listed.").
 *
 * The Departments view of the chart: the group's units (offices, departments, divisions, regions, companies) as one
 * connected tree from the office (api/structure.ts), each unit with its roles as a sub-tree by who reports to whom, and
 * the people holding each role. A Prima department or central company that stands for a unit shows its head and deputy
 * there, as before. Whoever may change the structure adds units and roles (+), renames (pencil), drags a role onto
 * another (reports to), drags a person onto a role (holds it), and sorts the people with no role yet in the Unsorted
 * panel (search, filter by company, tick many, pick a role, Assign; a suggestion when the job title names a role). The
 * office checks every change again.
 */
type Chart = Awaited<ReturnType<typeof api.orgChart>>;
type Person = Chart['people'][number];
type PrimaUnit = Chart['units'][number];

export type Drag = { kind: 'member'; userId: string } | { kind: 'position'; id: string } | null;

type Panel =
  | { kind: 'unit'; unit: OrgUnitRow | null; parent: OrgUnitRow | null }
  | { kind: 'add'; unit: OrgUnitRow }
  | { kind: 'position'; pos: PositionRow | null; unit: OrgUnitRow; reportsTo: PositionRow | null }
  | { kind: 'holders'; pos: PositionRow };

/** What the chart (Prima's own data and boxes) lends the structure view. */
export interface PrimaBridge {
  units: PrimaUnit[];
  byId: Map<string, Person>;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  /** A Prima unit's head, deputy or member (P138). */
  onUnit?: (unit: PrimaUnit, who: Person | null) => void;
  /** Add (null) or rename a Prima department (P141). */
  onUnitEdit?: (unit: PrimaUnit | null) => void;
  renderUnit: (u: PrimaUnit) => ReactNode;
  renderTeam: (people: Person[]) => ReactNode;
  membersOf: (u: PrimaUnit) => Person[];
}

// ---------------------------------------------------------------- the model

interface Model {
  s: Structure;
  unit: Map<string, OrgUnitRow>;
  byKey: Map<string, OrgUnitRow>;
  pos: Map<string, PositionRow>;
  subUnits: Map<string, OrgUnitRow[]>;
  rootRoles: Map<string, PositionRow[]>;
  subRoles: Map<string, PositionRow[]>;
  holders: Map<string, StructureMember[]>;
  unsorted: StructureMember[];
  byUser: Map<string, StructureMember>;
  byPrima: Map<string, StructureMember>;
  people: Map<string, number>;
  placeName: Map<string, string>;
}

const push = <T,>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);

function buildModel(s: Structure): Model {
  const unit = new Map(s.units.map((u) => [u.id, u]));
  const byKey = new Map(s.units.map((u) => [u.key, u]));
  const pos = new Map(s.positions.map((p) => [p.id, p]));
  const subUnits = new Map<string, OrgUnitRow[]>();
  for (const u of [...s.units].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))) push(subUnits, u.parent_id && unit.has(u.parent_id) ? u.parent_id : '', u);
  const rootRoles = new Map<string, PositionRow[]>();
  const subRoles = new Map<string, PositionRow[]>();
  for (const p of s.positions) {
    const boss = p.reports_to_id ? pos.get(p.reports_to_id) : undefined;
    if (boss && boss.unit_id === p.unit_id) push(subRoles, boss.id, p);
    else push(rootRoles, p.unit_id, p);
  }
  const holders = new Map<string, StructureMember[]>();
  const unsorted: StructureMember[] = [];
  for (const m of [...s.members].sort((a, b) => a.name.localeCompare(b.name))) {
    if (m.position_id && pos.has(m.position_id)) push(holders, m.position_id, m);
    else unsorted.push(m);
  }
  // People in a unit and every unit under it.
  const people = new Map<string, number>();
  const count = (id: string): number => {
    const own = s.positions.filter((p) => p.unit_id === id).reduce((n, p) => n + (holders.get(p.id)?.length ?? 0), 0);
    const n = own + (subUnits.get(id) ?? []).reduce((a, u) => a + count(u.id), 0);
    people.set(id, n);
    return n;
  };
  for (const r of subUnits.get('') ?? []) count(r.id);
  const placeName = new Map<string, string>();
  for (const m of s.members) {
    if (m.branch_id && m.branch_name) placeName.set(m.branch_id, m.branch_name);
    if (m.department_id && m.department_name) placeName.set(m.department_id, m.department_name);
  }
  return {
    s,
    unit,
    byKey,
    pos,
    subUnits,
    rootRoles,
    subRoles,
    holders,
    unsorted,
    byUser: new Map(s.members.map((m) => [m.user_id, m])),
    byPrima: new Map(s.members.filter((m) => m.prima_id).map((m) => [m.prima_id as string, m])),
    people,
    placeName,
  };
}

export function useStructure() {
  const load = useLoad(() => structure.get(), []);
  const model = useMemo(() => (load.data ? buildModel(load.data) : null), [load.data]);
  // Open units (null: only the top of the tree).
  const [open, setOpen] = useState<Set<string> | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [unsorted, setUnsorted] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  const isOpen = (id: string, depth: number) => (open === null ? depth === 0 : open.has(id));
  const toggle = (id: string, depth: number) =>
    setOpen((o) => {
      const n = new Set(o ?? (model ? (model.subUnits.get('') ?? []).map((u) => u.id) : []));
      if (isOpen(id, depth)) n.delete(id);
      else n.add(id);
      return n;
    });
  const openAll = () => setOpen(new Set(model?.s.units.map((u) => u.id) ?? []));
  const closeAll = () => setOpen(new Set());
  return { load, model, isOpen, toggle, openAll, closeAll, setOpen, panel, setPanel, unsorted, setUnsorted, drag, setDrag };
}
export type StructureState = ReturnType<typeof useStructure>;

// ---------------------------------------------------------------- names and matching

const KIND: Record<UnitKind, string> = {
  governance: 'Governance',
  office: 'Office',
  department: 'Department',
  unit: 'Unit',
  division: 'Division',
  region: 'Region',
  company: 'Company',
  team: 'Team',
};

function useNames() {
  const { lang } = useLang();
  const ms = lang !== 'en';
  return {
    unit: (u: OrgUnitRow) => (ms && u.name_ms ? u.name_ms : u.name),
    role: (p: PositionRow) => (ms && p.title_ms ? p.title_ms : p.title),
  };
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function chainOf(unitId: string, m: Model): OrgUnitRow[] {
  const out: OrgUnitRow[] = [];
  for (let at = m.unit.get(unitId), n = 0; at && n < 40; at = at.parent_id ? m.unit.get(at.parent_id) : undefined, n++) out.push(at);
  return out;
}

/** The role a member's job title names (its title, Malay title or another name for it), when only one fits. */
export function suggestionFor(mem: StructureMember, m: Model): PositionRow | null {
  const t = norm(mem.job_title);
  if (!t) return null;
  const hits = m.s.positions.filter((p) => norm(p.title) === t || norm(p.title_ms) === t || p.aliases.some((a) => norm(a) === t));
  if (hits.length <= 1) return hits[0] ?? null;
  const near = hits.filter((p) => chainOf(p.unit_id, m).some((u) => (!!mem.department_id && u.department_id === mem.department_id) || (!!mem.branch_id && u.branch_id === mem.branch_id)));
  return near.length === 1 ? near[0] : null;
}

// Prima's central departments and the units of the group's structure they stand for (the seed's keys).
const PRIMA_TO_UNIT: Record<string, string> = {
  d_hr: 'do_hr_administration',
  d_finance: 'finance',
  d_audit: 'act',
  d_asset: 'asset_management',
  d_director_office: 'group_director_office',
  d_chief_of_staff: 'do_governance_exec_coordination',
  d_it: 'dept_it',
  d_procurement: 'dept_procurement',
  d_transport: 'dept_transport',
  d_legal: 'dept_legal',
  d_operations: 'dept_operations',
  d_pdpa: 'dept_pdpa',
  d_fwm: 'dept_fwm',
  d_cms: 'dept_cms',
  d_marketing: 'dept_marketing',
};

function matchPrima(prima: PrimaUnit[], m: Model): { byUnit: Map<string, PrimaUnit[]>; rest: PrimaUnit[] } {
  const byUnit = new Map<string, PrimaUnit[]>();
  const rest: PrimaUnit[] = [];
  for (const pu of prima) {
    const names = [pu.label, pu.standardLabel ?? ''].map(norm).filter(Boolean);
    let hit = PRIMA_TO_UNIT[pu.key] ? m.byKey.get(PRIMA_TO_UNIT[pu.key]) : undefined;
    hit ??= m.s.units.find((u) => names.includes(norm(u.name)) || names.includes(norm(u.name_ms)));
    if (!hit && pu.key.startsWith('c_'))
      hit = m.s.units.find((u) => u.kind === 'company' && names.some((n) => n.length >= 5 && (norm(u.name).startsWith(n) || n.startsWith(norm(u.name)))));
    if (hit) push(byUnit, hit.id, pu);
    else rest.push(pu);
  }
  return { byUnit, rest };
}

function hueOf(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Under `top` (itself included): a role may not report to one of these. */
function rolesUnder(top: string, m: Model): Set<string> {
  const out = new Set<string>([top]);
  const all = m.s.positions;
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all)
      if (p.reports_to_id && out.has(p.reports_to_id) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
  }
  return out;
}

function unitsUnder(top: string, m: Model): Set<string> {
  const out = new Set<string>([top]);
  const walk = (id: string) => (m.subUnits.get(id) ?? []).forEach((u) => (out.add(u.id), walk(u.id)));
  walk(top);
  return out;
}

/** The office account behind a Prima person on the chart (an office-made account, or one the office linked). */
function officeUserOf(p: Person, m: Model): string | null {
  if (p.id.startsWith('u-off-')) return p.id.slice('u-off-'.length);
  return m.byPrima.get(p.id)?.user_id ?? null;
}

// ---------------------------------------------------------------- the tree

type X = {
  st: StructureState;
  m: Model;
  prima: PrimaBridge;
  primaOf: Map<string, PrimaUnit[]>;
  edit: boolean;
  names: ReturnType<typeof useNames>;
  place: (userId: string, positionId: string) => void;
  reportTo: (positionId: string, bossId: string) => void;
  busy: boolean;
};

export function StructureTree({ st, prima }: { st: StructureState; prima: PrimaBridge }) {
  const m = st.model!;
  const names = useNames();
  const act = useAction();
  const { byUnit, rest } = useMemo(() => matchPrima(prima.units, m), [prima.units, m]);
  const x: X = {
    st,
    m,
    prima,
    primaOf: byUnit,
    edit: m.s.can_edit,
    names,
    busy: act.busy,
    place: (userId, positionId) => {
      const who = m.byUser.get(userId);
      const to = m.pos.get(positionId);
      if (!who || !to || who.position_id === positionId) return;
      void act.run(() => structure.setPosition(userId, positionId), 'Placed.');
    },
    reportTo: (positionId, bossId) => {
      if (rolesUnder(positionId, m).has(bossId)) return;
      void act.run(() => structure.updatePosition(positionId, { reports_to_id: bossId }), 'Reporting line saved.');
    },
  };
  const roots = m.subUnits.get('') ?? [];
  return (
    <div className="oc-struct">
      {act.error && (
        <div className="oc-struct-error">
          <ErrorNotice error={act.error} />
        </div>
      )}
      <div className="oc-roots">
        {roots.map((u) => (
          <UnitTree key={u.id} u={u} depth={0} x={x} />
        ))}
        {rest.length > 0 && (
          <div className="oc-node">
            <div className="oc-box oc-group" style={{ '--oc-h': 200 } as CSSProperties}>
              <span className="oc-band" aria-hidden="true" />
              <div className="oc-box-main">
                <div className="oc-box-text">
                  <strong className="oc-name">Other Prima units</strong>
                  <span className="oc-role">Departments and central companies kept in Prima</span>
                </div>
              </div>
              {prima.onUnitEdit && (
                <button type="button" className="oc-add" title="Add a department" aria-label="Add a department" onClick={() => prima.onUnitEdit?.(null)}>
                  <PlusIcon size={13} weight="bold" aria-hidden="true" />
                </button>
              )}
            </div>
            <span className="oc-stem" aria-hidden="true" />
            <ul className="oc-kids oc-wrap">
              {rest.map((u) => (
                <li key={u.key}>{prima.renderUnit(u)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function UnitTree({ u, depth, x }: { u: OrgUnitRow; depth: number; x: X }) {
  const open = x.st.isOpen(u.id, depth);
  const subs = x.m.subUnits.get(u.id) ?? [];
  const roles = x.m.rootRoles.get(u.id) ?? [];
  const pu = x.primaOf.get(u.id) ?? [];
  const staff = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const p of pu) for (const s of x.prima.membersOf(p)) seen.set(s.id, s);
    return [...seen.values()];
  }, [pu, x.prima]);
  const [team, setTeam] = useState(false);
  return (
    <div className="oc-node">
      <UnitBox u={u} depth={depth} x={x} open={open} pu={pu} staff={staff} team={team} onTeam={() => setTeam((t) => !t)} />
      {open && (roles.length > 0 || x.edit) && (
        <>
          <span className="oc-stem" aria-hidden="true" />
          <RolesCard u={u} roles={roles} x={x} />
        </>
      )}
      {open && team && staff.length > 0 && (
        <>
          <span className="oc-stem" aria-hidden="true" />
          {x.prima.renderTeam(staff)}
        </>
      )}
      {open && subs.length > 0 && (
        <>
          <span className="oc-stem" aria-hidden="true" />
          <ul className="oc-kids">
            {subs.map((s) => (
              <li key={s.id}>
                <UnitTree u={s} depth={depth + 1} x={x} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function UnitBox({ u, depth, x, open, pu, staff, team, onTeam }: { u: OrgUnitRow; depth: number; x: X; open: boolean; pu: PrimaUnit[]; staff: Person[]; team: boolean; onTeam: () => void }) {
  const [over, setOver] = useState(false);
  const roles = x.m.s.positions.filter((p) => p.unit_id === u.id).length;
  const subs = (x.m.subUnits.get(u.id) ?? []).length;
  const people = x.m.people.get(u.id) ?? 0;
  const where = [u.branch_id, u.department_id].map((id) => (id ? x.m.placeName.get(id) : undefined)).filter(Boolean) as string[];
  const primaDrop = !!x.prima.onUnit && pu.length > 0;
  return (
    <div
      className="oc-box oc-sunit"
      data-kind={u.kind}
      data-drop={(over && primaDrop && !!x.prima.dragId) || undefined}
      style={{ '--oc-h': hueOf(u.key) } as CSSProperties}
      onDragOver={(e) => {
        if (!primaDrop || !x.prima.dragId) return;
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const who = x.prima.dragId ? x.prima.byId.get(x.prima.dragId) : undefined;
        if (!who || !primaDrop) return;
        e.preventDefault();
        e.stopPropagation();
        x.prima.setDragId(null);
        x.prima.onUnit?.(pu[0], who);
      }}
    >
      <span className="oc-band" aria-hidden="true" />
      <div className="oc-box-main">
        <div className="oc-box-text">
          <span className="oc-unit-title">
            <strong className="oc-name" title={x.names.unit(u)}>
              {x.names.unit(u)}
            </strong>
            {x.edit && (
              <button type="button" className="oc-rename" title="Edit this unit" aria-label={`Edit ${u.name}`} onClick={() => x.st.setPanel({ kind: 'unit', unit: u, parent: null })}>
                <PencilSimpleIcon size={13} aria-hidden="true" />
              </button>
            )}
          </span>
          <span className="oc-meta">
            <span className="oc-dept">{KIND[u.kind] ?? u.kind}</span>
            <span className="oc-how">
              <span className="num">{roles}</span> <span>{roles === 1 ? 'role' : 'roles'}</span> · <span className="num">{people}</span> <span>{people === 1 ? 'person' : 'people'}</span>
            </span>
            {u.custom && <span className="oc-how">Added here</span>}
          </span>
          {where.length > 0 && (
            <span className="oc-heads" title={where.join(' · ')}>
              {where.join(' · ')}
            </span>
          )}
          {pu.map((p) => (
            <span key={p.key} className="oc-sunit-prima">
              {p.heads.map((h) => (
                <span key={h.id} className="oc-unit-person">
                  <Avatar name={h.name} size={22} />
                  <span>
                    <strong>{h.name}</strong>
                    <span className="muted"> · {h.how === 'named' ? 'Head (named)' : 'Head'}</span>
                  </span>
                </span>
              ))}
              {p.deputy && (
                <span className="oc-unit-person">
                  <Avatar name={p.deputy.name} size={22} />
                  <span>
                    <strong>{p.deputy.name}</strong>
                    <span className="muted"> · Deputy</span>
                  </span>
                </span>
              )}
            </span>
          ))}
          {staff.length > 0 && open && (
            <button type="button" className="oc-sunit-team" aria-pressed={team} onClick={onTeam}>
              <UsersThreeIcon size={13} aria-hidden="true" />
              <span>Prima staff</span> <span className="num">{staff.length}</span>
            </button>
          )}
        </div>
      </div>
      {x.edit && (
        <button type="button" className="oc-add" title={`Add to ${u.name}: a role or a sub-unit`} aria-label={`Add to ${u.name}`} onClick={() => x.st.setPanel({ kind: 'add', unit: u })}>
          <PlusIcon size={13} weight="bold" aria-hidden="true" />
        </button>
      )}
      {(subs > 0 || roles > 0 || x.edit || staff.length > 0) && (
        <button type="button" className="oc-toggle" aria-expanded={open} onClick={() => x.st.toggle(u.id, depth)} title={open ? 'Close' : 'Open'}>
          {open ? <CaretDownIcon size={11} weight="bold" aria-hidden="true" /> : <CaretRightIcon size={11} weight="bold" aria-hidden="true" />}
          <span className="num">{subs + roles}</span>
        </button>
      )}
    </div>
  );
}

function RolesCard({ u, roles, x }: { u: OrgUnitRow; roles: PositionRow[]; x: X }) {
  return (
    <div className="oc-roles">
      <div className="oc-roles-head">
        <TreeStructureIcon size={13} aria-hidden="true" />
        <span>Roles</span>
        {x.edit && (
          <button type="button" className="oc-roles-add" onClick={() => x.st.setPanel({ kind: 'position', pos: null, unit: u, reportsTo: null })}>
            <PlusIcon size={12} weight="bold" aria-hidden="true" />
            Add a role
          </button>
        )}
      </div>
      {roles.length ? (
        <ul className="oc-ptree">
          {roles.map((p) => (
            <RoleItem key={p.id} p={p} x={x} />
          ))}
        </ul>
      ) : (
        <p className="oc-roles-none muted small">No roles yet.</p>
      )}
    </div>
  );
}

function RoleItem({ p, x }: { p: PositionRow; x: X }) {
  const kids = x.m.subRoles.get(p.id) ?? [];
  const holders = x.m.holders.get(p.id) ?? [];
  const boss = p.reports_to_id ? x.m.pos.get(p.reports_to_id) : undefined;
  const away = boss && boss.unit_id !== p.unit_id ? boss : undefined;
  const [over, setOver] = useState(false);
  const d = x.st.drag;
  const takes = (): boolean => {
    if (!x.edit) return false;
    if (d?.kind === 'member') return x.m.byUser.get(d.userId)?.position_id !== p.id;
    if (d?.kind === 'position') return d.id !== p.id && !rolesUnder(d.id, x.m).has(p.id) && x.m.pos.get(d.id)?.reports_to_id !== p.id;
    if (x.prima.dragId) {
      const who = x.prima.byId.get(x.prima.dragId);
      return !!who && !!officeUserOf(who, x.m);
    }
    return false;
  };
  const drop = (e: DragEvent) => {
    setOver(false);
    if (!takes()) return;
    e.preventDefault();
    e.stopPropagation();
    if (d?.kind === 'member') x.place(d.userId, p.id);
    else if (d?.kind === 'position') x.reportTo(d.id, p.id);
    else if (x.prima.dragId) {
      const who = x.prima.byId.get(x.prima.dragId);
      const uid = who ? officeUserOf(who, x.m) : null;
      x.prima.setDragId(null);
      if (uid) x.place(uid, p.id);
    }
    x.st.setDrag(null);
  };
  const full = p.headcount != null && holders.length >= p.headcount;
  return (
    <li>
      <div
        className="oc-pos"
        data-vacant={!holders.length || undefined}
        data-drop={over || undefined}
        data-dragging={(d?.kind === 'position' && d.id === p.id) || undefined}
        draggable={x.edit || undefined}
        onDragStart={
          x.edit
            ? (e) => {
                e.stopPropagation();
                e.dataTransfer.setData('text/plain', p.id);
                e.dataTransfer.effectAllowed = 'move';
                x.st.setDrag({ kind: 'position', id: p.id });
              }
            : undefined
        }
        onDragEnd={() => x.st.setDrag(null)}
        onDragOver={(e) => {
          if (!takes()) return;
          e.preventDefault();
          e.stopPropagation();
          if (!over) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <button type="button" className="oc-pos-title" title={p.duties ?? x.names.role(p)} onClick={() => x.st.setPanel({ kind: 'holders', pos: p })}>
          <strong>{x.names.role(p)}</strong>
          {away && (
            <span className="oc-pos-up" title="Reports to">
              <ArrowUpIcon size={11} aria-hidden="true" />
              {x.names.role(away)}
            </span>
          )}
        </button>
        <span className="oc-pos-people">
          {holders.length ? (
            <span className="oc-pos-faces" title={holders.map((h) => h.name).join(', ')}>
              {holders.slice(0, 3).map((h) => (
                <span
                  key={h.user_id}
                  className="oc-pos-face"
                  draggable={x.edit || undefined}
                  onDragStart={
                    x.edit
                      ? (e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData('text/plain', h.user_id);
                          x.st.setDrag({ kind: 'member', userId: h.user_id });
                        }
                      : undefined
                  }
                  onDragEnd={() => x.st.setDrag(null)}
                >
                  <Avatar name={h.name} size={22} />
                </span>
              ))}
              {holders.length === 1 && <span className="oc-pos-name">{holders[0].name}</span>}
            </span>
          ) : (
            <Chip tone="warn">Vacant</Chip>
          )}
          <span className="oc-pos-count num" data-full={full || undefined} title={p.headcount != null ? 'Holders / planned' : 'Holders'}>
            {holders.length}
            {p.headcount != null ? `/${p.headcount}` : ''}
          </span>
        </span>
        {x.edit && (
          <span className="oc-pos-acts">
            <button type="button" title="Add a role under this one" aria-label={`Add a role under ${p.title}`} onClick={() => x.st.setPanel({ kind: 'position', pos: null, unit: x.m.unit.get(p.unit_id)!, reportsTo: p })}>
              <PlusIcon size={12} weight="bold" aria-hidden="true" />
            </button>
            <button type="button" title="Edit this role" aria-label={`Edit ${p.title}`} onClick={() => x.st.setPanel({ kind: 'position', pos: p, unit: x.m.unit.get(p.unit_id)!, reportsTo: null })}>
              <PencilSimpleIcon size={12} aria-hidden="true" />
            </button>
          </span>
        )}
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <RoleItem key={k.id} p={k} x={x} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- drawers and the Unsorted panel

export function StructurePanels({ st, prima }: { st: StructureState; prima: PrimaBridge }) {
  const m = st.model;
  if (!m) return null;
  const pnl = st.panel;
  const close = () => st.setPanel(null);
  const pu = pnl?.kind === 'add' ? matchPrima(prima.units, m).byUnit.get(pnl.unit.id) ?? [] : [];
  return (
    <>
      {st.unsorted && <UnsortedPanel st={st} m={m} onClose={() => st.setUnsorted(false)} />}
      {pnl?.kind === 'unit' && (
        <Drawer title={pnl.unit ? 'Edit unit' : 'Add a sub-unit'} sub={pnl.unit?.name ?? pnl.parent?.name} onClose={close}>
          <UnitForm m={m} unit={pnl.unit} parent={pnl.parent} onDone={close} />
        </Drawer>
      )}
      {pnl?.kind === 'add' && (
        <Drawer title={pnl.unit.name} sub="Add a role or a sub-unit" onClose={close}>
          <div className="org-form">
            <div className="oc-choices">
              <button type="button" className="btn btn-primary" onClick={() => st.setPanel({ kind: 'position', pos: null, unit: pnl.unit, reportsTo: null })}>
                <PlusIcon size={14} aria-hidden="true" />
                Add a role
              </button>
              <button type="button" className="btn" onClick={() => st.setPanel({ kind: 'unit', unit: null, parent: pnl.unit })}>
                <PlusIcon size={14} aria-hidden="true" />
                Add a sub-unit
              </button>
              {pu.map((p) => (
                <span key={p.key} className="oc-choices-prima">
                  {prima.onUnit && (
                    <button type="button" className="btn" onClick={() => (close(), prima.onUnit?.(p, null))}>
                      <span>Head, deputy or member</span> · <span>{p.label}</span>
                    </button>
                  )}
                  {prima.onUnitEdit && (
                    <button type="button" className="btn btn-ghost" onClick={() => (close(), prima.onUnitEdit?.(p))}>
                      <span>Rename the Prima department</span> · <span>{p.label}</span>
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        </Drawer>
      )}
      {pnl?.kind === 'position' && (
        <Drawer title={pnl.pos ? 'Edit role' : 'Add a role'} sub={pnl.pos ? pnl.pos.title : pnl.unit.name} onClose={close}>
          <PositionForm m={m} pos={pnl.pos} unit={pnl.unit} reportsTo={pnl.reportsTo} onDone={close} />
        </Drawer>
      )}
      {pnl?.kind === 'holders' && (
        <Drawer title={pnl.pos.title} sub={m.unit.get(pnl.pos.unit_id)?.name} onClose={close}>
          <HoldersForm st={st} m={m} pos={m.pos.get(pnl.pos.id) ?? pnl.pos} onClose={close} />
        </Drawer>
      )}
    </>
  );
}

/** "Title — Unit" for pickers, every role in the tree's order. */
function roleOptions(m: Model, names: ReturnType<typeof useNames>, leave?: Set<string>) {
  const order: PositionRow[] = [];
  const walkRoles = (list: PositionRow[]) =>
    list.forEach((p) => {
      order.push(p);
      walkRoles(m.subRoles.get(p.id) ?? []);
    });
  const walkUnits = (list: OrgUnitRow[]) =>
    list.forEach((u) => {
      walkRoles(m.rootRoles.get(u.id) ?? []);
      walkUnits(m.subUnits.get(u.id) ?? []);
    });
  walkUnits(m.subUnits.get('') ?? []);
  return order
    .filter((p) => !leave?.has(p.id))
    .map((p) => (
      <option key={p.id} value={p.id}>
        {`${names.role(p)} — ${names.unit(m.unit.get(p.unit_id)!)}`}
      </option>
    ));
}

function unitOptions(m: Model, leave?: Set<string>) {
  const out: ReactNode[] = [];
  const walk = (list: OrgUnitRow[], depth: number) =>
    list.forEach((u) => {
      if (leave?.has(u.id)) return;
      out.push(
        <option key={u.id} value={u.id}>
          {`${'· '.repeat(depth)}${u.name}`}
        </option>,
      );
      walk(m.subUnits.get(u.id) ?? [], depth + 1);
    });
  walk(m.subUnits.get('') ?? [], 0);
  return out;
}

function UnitForm({ m, unit, parent, onDone }: { m: Model; unit: OrgUnitRow | null; parent: OrgUnitRow | null; onDone: () => void }) {
  const act = useAction();
  const [name, setName] = useState(unit?.name ?? '');
  const [nameMs, setNameMs] = useState(unit?.name_ms ?? '');
  const [kind, setKind] = useState<UnitKind>(unit?.kind ?? (parent?.kind === 'company' ? 'department' : 'unit'));
  const [parentId, setParentId] = useState(unit ? (unit.parent_id ?? '') : (parent?.id ?? ''));
  const [removing, setRemoving] = useState(false);
  const clean = name.replace(/\s+/g, ' ').trim();
  const leave = unit ? unitsUnder(unit.id, m) : undefined;
  const empty = unit ? !(m.subUnits.get(unit.id) ?? []).length && !m.s.positions.some((p) => p.unit_id === unit.id) : false;
  const save = async () => {
    const body = { name: clean, name_ms: nameMs.trim() || null, kind, parent_id: parentId || null };
    if (unit) await structure.updateUnit(unit.id, body);
    else await structure.addUnit(body);
    return null;
  };
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="For example: Corporate Communications" autoFocus />
      </label>
      <label className="field">
        <span>Name in Malay (optional)</span>
        <input className="input" value={nameMs} onChange={(e) => setNameMs(e.target.value)} maxLength={160} placeholder="Contoh: Komunikasi Korporat" />
      </label>
      <label className="field">
        <span>Kind</span>
        <Select className="input" value={kind} onChange={(e) => setKind(e.target.value as UnitKind)}>
          {(Object.keys(KIND) as UnitKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND[k]}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>Sits under</span>
        <Select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)} searchable>
          <option value="">Top of the chart</option>
          {unitOptions(m, leave)}
        </Select>
      </label>
      <div className="org-form-actions">
        <button className="btn btn-primary" disabled={act.busy || clean.length < 1} onClick={() => act.run(save, unit ? 'Unit saved.' : 'Unit added.').then((r) => r !== undefined && onDone())}>
          {unit ? 'Save' : 'Add the unit'}
        </button>
        {unit?.custom &&
          empty &&
          (removing ? (
            <button className="btn btn-danger" disabled={act.busy} onClick={() => act.run(() => structure.removeUnit(unit.id).then(() => null), 'Unit removed.').then((r) => r !== undefined && onDone())}>
              Yes, remove it
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => setRemoving(true)}>
              <TrashIcon size={14} aria-hidden="true" />
              Remove this unit
            </button>
          ))}
      </div>
      {unit && !unit.custom && <p className="muted small">This unit comes from the group&apos;s structure: rename or move it; it stays.</p>}
      {unit?.custom && !empty && <p className="muted small">To remove this unit, first move or remove its sub-units and roles.</p>}
    </div>
  );
}

function PositionForm({ m, pos, unit, reportsTo, onDone }: { m: Model; pos: PositionRow | null; unit: OrgUnitRow; reportsTo: PositionRow | null; onDone: () => void }) {
  const act = useAction();
  const names = useNames();
  const [title, setTitle] = useState(pos?.title ?? '');
  const [titleMs, setTitleMs] = useState(pos?.title_ms ?? '');
  const [unitId, setUnitId] = useState(pos?.unit_id ?? unit.id);
  const firstBoss = pos ? (pos.reports_to_id ?? '') : (reportsTo?.id ?? (m.rootRoles.get(unit.id) ?? [])[0]?.id ?? '');
  const [boss, setBoss] = useState(firstBoss);
  const [role, setRole] = useState(pos?.default_role ?? (pos ? '' : 'staff'));
  const [headcount, setHeadcount] = useState(pos?.headcount != null ? String(pos.headcount) : '');
  const [duties, setDuties] = useState(pos?.duties ?? '');
  const [removing, setRemoving] = useState(false);
  const holders = pos ? (m.holders.get(pos.id) ?? []) : [];
  const clean = title.replace(/\s+/g, ' ').trim();
  const hc = headcount.trim() === '' ? null : Number(headcount);
  const hcOk = hc === null || (Number.isInteger(hc) && hc >= 0 && hc <= 100000);
  const leave = pos ? rolesUnder(pos.id, m) : undefined;
  const save = async () => {
    const body = {
      title: clean,
      title_ms: titleMs.trim() || null,
      unit_id: unitId,
      reports_to_id: boss || null,
      default_role: role || null,
      headcount: hc,
      duties: duties.trim() || null,
    };
    if (pos) await structure.updatePosition(pos.id, body);
    else await structure.addPosition(body);
    return null;
  };
  const remove = () => structure.removePosition(pos!.id, holders.length > 0).then(() => null);
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Role title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="For example: Payroll Executive" autoFocus />
      </label>
      <label className="field">
        <span>Title in Malay (optional)</span>
        <input className="input" value={titleMs} onChange={(e) => setTitleMs(e.target.value)} maxLength={160} placeholder="Contoh: Eksekutif Gaji" />
      </label>
      <label className="field">
        <span>Unit</span>
        <Select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)} searchable>
          {unitOptions(m)}
        </Select>
      </label>
      <label className="field">
        <span>Reports to</span>
        <Select className="input" value={boss} onChange={(e) => setBoss(e.target.value)} searchable>
          <option value="">Nobody (top role)</option>
          {roleOptions(m, names, leave)}
        </Select>
      </label>
      <label className="field">
        <span>Office role its people usually have</span>
        <Select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Not set</option>
          {ROLES.filter((r) => r !== 'owner').map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>Planned headcount (optional)</span>
        <input className="input" inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="For example: 3" />
      </label>
      <label className="field">
        <span>Duties (optional)</span>
        <textarea className="input" rows={4} value={duties} onChange={(e) => setDuties(e.target.value)} maxLength={4000} />
      </label>
      <div className="org-form-actions">
        <button className="btn btn-primary" disabled={act.busy || !clean || !hcOk} onClick={() => act.run(save, pos ? 'Role saved.' : 'Role added.').then((r) => r !== undefined && onDone())}>
          {pos ? 'Save' : 'Add the role'}
        </button>
        {pos &&
          (removing ? (
            <button className="btn btn-danger" disabled={act.busy} onClick={() => act.run(remove, 'Role removed.').then((r) => r !== undefined && onDone())}>
              {holders.length ? 'Yes: put its people in Unsorted and remove it' : 'Yes, remove it'}
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => setRemoving(true)}>
              <TrashIcon size={14} aria-hidden="true" />
              Remove this role
            </button>
          ))}
      </div>
      {removing && holders.length > 0 && (
        <p className="muted small">
          <span className="num">{holders.length}</span> <span>{holders.length === 1 ? 'person holds this role: they go to Unsorted.' : 'people hold this role: they go to Unsorted.'}</span>
        </p>
      )}
      {pos && !pos.custom && pos.aliases.length > 0 && (
        <p className="muted small">
          <span>Also called</span>: {pos.aliases.join(', ')}
        </p>
      )}
    </div>
  );
}

function HoldersForm({ st, m, pos, onClose }: { st: StructureState; m: Model; pos: PositionRow; onClose: () => void }) {
  const act = useAction();
  const names = useNames();
  const [who, setWho] = useState('');
  const holders = m.holders.get(pos.id) ?? [];
  const boss = pos.reports_to_id ? m.pos.get(pos.reports_to_id) : undefined;
  const others = m.s.members.filter((x) => x.position_id !== pos.id).sort((a, b) => a.name.localeCompare(b.name));
  const unit = m.unit.get(pos.unit_id);
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <dl className="oc-facts">
        {unit && (
          <>
            <dt>Unit</dt>
            <dd>{names.unit(unit)}</dd>
          </>
        )}
        <dt>Reports to</dt>
        <dd>{boss ? names.role(boss) : <span className="muted">Nobody (top role)</span>}</dd>
        {pos.title_ms && pos.title_ms !== pos.title && (
          <>
            <dt>In Malay</dt>
            <dd>{pos.title_ms}</dd>
          </>
        )}
        <dt>Office role</dt>
        <dd>{pos.default_role ? roleLabel(pos.default_role) : <span className="muted">Not set</span>}</dd>
        <dt>Holders</dt>
        <dd>
          <span className="num">{holders.length}</span>
          {pos.headcount != null && (
            <>
              {' '}
              <span>of</span> <span className="num">{pos.headcount}</span> <span>planned</span>
            </>
          )}
        </dd>
        {pos.duties && (
          <>
            <dt>Duties</dt>
            <dd className="oc-duties">{pos.duties}</dd>
          </>
        )}
      </dl>
      <h3 className="org-form-title">People in this role</h3>
      {holders.length ? (
        <ul className="oc-holders">
          {holders.map((h) => (
            <li key={h.user_id}>
              <Avatar name={h.name} size={30} />
              <span className="oc-holder-text">
                <strong>{h.name}</strong>
                <span className="muted small">{[h.job_title, h.branch_name].filter(Boolean).join(' · ')}</span>
              </span>
              <ProfileButton userId={h.user_id} name={h.name} />
              {m.s.can_edit && (
                <button type="button" className="btn btn-sm btn-ghost" title="Take out of this role (to Unsorted)" disabled={act.busy} onClick={() => act.run(() => structure.setPosition(h.user_id, null, false), 'Moved to Unsorted.')}>
                  <UserMinusIcon size={14} aria-hidden="true" />
                  <span className="hide-sm">Take out</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Vacant: nobody holds this role yet.</p>
      )}
      {m.s.can_edit && (
        <>
          <h3 className="org-form-title">Put someone in this role</h3>
          <div className="org-form-row">
            <Select className="input" value={who} onChange={(e) => setWho(e.target.value)} searchable aria-label="Person">
              <option value="">Search a name…</option>
              {others.map((x) => (
                <option key={x.user_id} value={x.user_id}>
                  {`${x.name}${x.job_title ? ` (${x.job_title})` : ''}`}
                </option>
              ))}
            </Select>
            <button className="btn btn-primary" disabled={act.busy || !who} onClick={() => act.run(() => structure.setPosition(who, pos.id), 'Placed.').then((r) => r !== undefined && setWho(''))}>
              Place
            </button>
          </div>
          <p className="muted small">Their job title becomes this role&apos;s title. Someone already in another role moves here.</p>
          <div className="org-form-actions">
            <button className="btn" onClick={() => st.setPanel({ kind: 'position', pos, unit: unit!, reportsTo: null })}>
              <PencilSimpleIcon size={14} aria-hidden="true" />
              Edit this role
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Everyone with no role yet: search, filter by company, tick many, pick a role and Assign. A suggestion shows when the
 * job title names a role (one click accepts it; Accept all takes every suggestion shown). Rows drag onto a role too.
 */
function UnsortedPanel({ st, m, onClose }: { st: StructureState; m: Model; onClose: () => void }) {
  const act = useAction();
  const names = useNames();
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('');
  const companies = useMemo(() => {
    const out = new Map<string, string>();
    for (const x of m.unsorted) out.set(x.branch_id ?? '', x.branch_name ?? 'No company');
    return [...out.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [m.unsorted]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = m.unsorted.filter(
    (x) => (!company || (x.branch_id ?? '') === (company === '-' ? '' : company)) && words.every((w) => `${x.name} ${x.email} ${x.work_email ?? ''} ${x.job_title ?? ''} ${x.department_name ?? ''}`.toLowerCase().includes(w)),
  );
  const tips = useMemo(() => new Map(m.unsorted.map((x) => [x.user_id, suggestionFor(x, m)])), [m]);
  const shownTips = shown.filter((x) => tips.get(x.user_id));
  const allPicked = shown.length > 0 && shown.every((x) => picked.has(x.user_id));
  const flip = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const assign = async () => {
    const r = await structure.assign([...picked], to);
    setPicked(new Set());
    return r;
  };
  const acceptAll = async () => {
    const groups = new Map<string, string[]>();
    for (const x of shownTips) push(groups, tips.get(x.user_id)!.id, x.user_id);
    let done = 0;
    let skipped = 0;
    for (const [pid, ids] of groups) {
      const r = await structure.assign(ids, pid);
      done += r.done;
      skipped += r.skipped.length;
    }
    return { done, skipped: Array.from({ length: skipped }, () => ({ user_id: '', message: '' })) };
  };
  const said = (r: { done: number; skipped: unknown[] }) => (r.skipped.length ? `${r.done} placed, ${r.skipped.length} skipped.` : `${r.done} placed.`);
  return (
    <aside className="oc-side" aria-label="Unsorted people">
      <header className="oc-side-head">
        <strong>
          <span>Unsorted</span> <span className="num">({m.unsorted.length})</span>
        </strong>
        <button type="button" className="oc-find-clear" aria-label="Close" onClick={onClose}>
          <XIcon size={16} aria-hidden="true" />
        </button>
      </header>
      <p className="muted small oc-side-note">People with no role yet. Tick them, pick a role and Assign, accept a suggestion, or drag a person onto a role in the chart.</p>
      <ErrorNotice error={act.error} />
      <label className="oco-find">
        <MagnifyingGlassIcon size={14} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name, email or job title" aria-label="Find in Unsorted" />
      </label>
      <Select className="input" value={company} onChange={(e) => setCompany(e.target.value)} searchable aria-label="Company">
        <option value="">All companies</option>
        {companies.map(([id, name]) => (
          <option key={id || '-'} value={id || '-'}>
            {name}
          </option>
        ))}
      </Select>
      <div className="oc-side-bar">
        <label className="oc-side-all">
          <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((x) => x.user_id)))} disabled={!shown.length} />
          <span>Select all shown</span>
        </label>
        {m.s.can_edit && shownTips.length > 0 && (
          <button type="button" className="btn btn-sm" disabled={act.busy} onClick={() => act.run(acceptAll, said)}>
            <SparkleIcon size={14} aria-hidden="true" />
            <span>Accept all suggestions</span> <span className="num">({shownTips.length})</span>
          </button>
        )}
      </div>
      <ul className="oc-side-list">
        {shown.map((x) => {
          const tip = tips.get(x.user_id);
          return (
            <li
              key={x.user_id}
              data-picked={picked.has(x.user_id) || undefined}
              draggable={m.s.can_edit || undefined}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', x.user_id);
                st.setDrag({ kind: 'member', userId: x.user_id });
              }}
              onDragEnd={() => st.setDrag(null)}
            >
              <input type="checkbox" checked={picked.has(x.user_id)} onChange={() => flip(x.user_id)} aria-label={`Select ${x.name}`} />
              <Avatar name={x.name} size={28} />
              <span className="oc-holder-text">
                <strong title={x.email}>{x.name}</strong>
                <span className="muted small">{[x.job_title, x.branch_name, x.department_name].filter(Boolean).join(' · ') || x.email}</span>
                {tip && m.s.can_edit && (
                  <button type="button" className="oc-tip" title="Suggested from the job title: click to accept" disabled={act.busy} onClick={() => act.run(() => structure.setPosition(x.user_id, tip.id), 'Placed.')}>
                    <SparkleIcon size={12} aria-hidden="true" />
                    <span>Suggested</span>: <span>{names.role(tip)}</span>
                    <CheckIcon size={12} aria-hidden="true" />
                  </button>
                )}
              </span>
              <ProfileButton userId={x.user_id} name={x.name} />
            </li>
          );
        })}
        {!shown.length && <li className="oc-side-none muted small">{m.unsorted.length ? 'Nobody matches.' : 'Everyone has a role.'}</li>}
      </ul>
      {m.s.can_edit && (
        <footer className="oc-side-foot">
          <Select className="input" value={to} onChange={(e) => setTo(e.target.value)} searchable aria-label="Role">
            <option value="">Pick a role…</option>
            {roleOptions(m, names)}
          </Select>
          <button type="button" className="btn btn-primary" disabled={act.busy || !picked.size || !to} onClick={() => act.run(assign, said)}>
            <span>Assign</span> <span className="num">({picked.size})</span>
          </button>
        </footer>
      )}
    </aside>
  );
}
