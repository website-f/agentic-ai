import { useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import {
  ArrowUpIcon,
  BuildingsIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  HandshakeIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  TrayIcon,
  TreeStructureIcon,
  UserCircleIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  UsersThreeIcon,
  XIcon,
} from '@phosphor-icons/react';
import type { api } from '../api';
import { useApp } from '../App';
import { office, officeFetch } from '../api/office';
import { structure, type OrgUnitRow, type PositionRow, type Structure, type StructureMember, type UnitKind, type WorkGroup } from '../api/structure';
import { useLang } from '../i18n';
import { Avatar } from '../kit';
import { Select } from '../SearchSelect';
import { Chip, Drawer, ErrorNotice, useAction, useLoad } from '../ui';
import { CompaniesTree } from './OrgCompanies';
import { openMember } from './office/member-route';
import { ROLES, roleLabel } from './office/shared';
import type { ChartMemory } from './org-memory';

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

/** P146: a member's settings in a drawer over the chart (the chart stays as it is), with Open full profile there. */
function QuickButton({ userId, name, prima }: { userId: string; name: string; prima: PrimaBridge }) {
  if (!prima.onQuick) return null;
  return (
    <button type="button" className="btn btn-sm btn-ghost oc-profile" title={`Quick edit: ${name}`} aria-label={`Quick edit: ${name}`} onClick={() => prima.onQuick?.(userId, name)}>
      <NotePencilIcon size={14} aria-hidden="true" />
      <span className="hide-sm">Quick edit</span>
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

export type Drag = { kind: 'member'; userId: string } | { kind: 'position'; id: string } | { kind: 'group'; id: string } | null;

type Panel =
  | { kind: 'unit'; unit: OrgUnitRow | null; parent: OrgUnitRow | null }
  | { kind: 'add'; unit: OrgUnitRow }
  | { kind: 'position'; pos: PositionRow | null; unit: OrgUnitRow; reportsTo: PositionRow | null }
  | { kind: 'holders'; pos: PositionRow }
  // P146: put people in a unit; one person or one work group of the "By people" layout; the office's company tools.
  | { kind: 'people'; unit: OrgUnitRow }
  | { kind: 'person'; userId: string; unit: OrgUnitRow }
  | { kind: 'group'; group: WorkGroup; unit: OrgUnitRow }
  | { kind: 'company' }
  | { kind: 'officeDept'; unit: OrgUnitRow };

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
  /** P146: a member's settings in a drawer over the chart. */
  onQuick?: (userId: string, name: string) => void;
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
  /** P146: work groups, the people holding a role in each unit (not its sub-units), one unit per office company. */
  groups: WorkGroup[];
  unitPeople: Map<string, StructureMember[]>;
  companies: OrgUnitRow[];
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
  const unitPeople = new Map<string, StructureMember[]>();
  for (const [pid, list] of holders) {
    const p = pos.get(pid);
    if (p) for (const h of list) push(unitPeople, p.unit_id, h);
  }
  // P146: the unit standing for each office company (a company unit first, as the office made them).
  const companies: OrgUnitRow[] = [];
  const seenBranch = new Set<string>();
  for (const u of [...s.units].sort((a, b) => Number(a.kind !== 'company') - Number(b.kind !== 'company') || a.sort - b.sort)) {
    if (!u.branch_id || u.department_id || seenBranch.has(u.branch_id)) continue;
    seenBranch.add(u.branch_id);
    companies.push(u);
  }
  companies.sort((a, b) => a.name.localeCompare(b.name));
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
    groups: s.groups ?? [],
    unitPeople,
    companies,
  };
}

/** P146: each unit shown by its roles (default) or by its people (who reports to whom, pairs and teams side by side). */
export type Layout = 'role' | 'people';
const LAYOUT_KEY = 'prima.org.layout';

function readLayout(): { all: Layout; units: Record<string, Layout> } {
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as { all?: unknown; units?: unknown } | null;
    if (v && (v.all === 'role' || v.all === 'people')) return { all: v.all, units: v.units && typeof v.units === 'object' ? (v.units as Record<string, Layout>) : {} };
  } catch {
    /* this browser only */
  }
  return { all: 'role', units: {} };
}

export function useStructure(memory?: ChartMemory | null) {
  const load = useLoad(() => structure.get(), []);
  const model = useMemo(() => (load.data ? buildModel(load.data) : null), [load.data]);
  // Open units (null: only the top of the tree). P146: as they were when the chart comes back from a member's page.
  const [open, setOpen] = useState<Set<string> | null>(() => (memory?.open ? new Set(memory.open) : null));
  const [panel, setPanel] = useState<Panel | null>(null);
  const [unsorted, setUnsorted] = useState(!!memory?.unsorted);
  // P146: the company the Unsorted panel shows ('' all, '-' none).
  const [unsortedCompany, setUnsortedCompany] = useState(memory?.unsortedCompany ?? '');
  const openUnsorted = (company: string) => {
    setUnsortedCompany(company);
    setUnsorted(true);
  };
  const [drag, setDrag] = useState<Drag>(null);
  const [layout, setLayoutState] = useState(readLayout);
  const layoutOf = (unitId: string): Layout => layout.units[unitId] ?? layout.all;
  /** One unit (or every unit, null) by role or by people; remembered in this browser. */
  const setLayout = (unitId: string | null, v: Layout) =>
    setLayoutState((o) => {
      const n = unitId === null ? { all: v, units: {} } : { all: o.all, units: { ...o.units, [unitId]: v } };
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(n));
      } catch {
        /* this browser only */
      }
      return n;
    });
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
  return { load, model, open, isOpen, toggle, openAll, closeAll, setOpen, panel, setPanel, unsorted, setUnsorted, unsortedCompany, setUnsortedCompany, openUnsorted, drag, setDrag, layout, layoutOf, setLayout };
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
  // P146: people inside a unit (the "By people" layout).
  personReportsTo: (userId: string, bossId: string | null) => void;
  pair: (unitId: string, userId: string, withId: string) => void;
  joinGroup: (g: WorkGroup, userId: string) => void;
  leaveGroup: (g: WorkGroup, userId: string) => void;
  groupLead: (g: WorkGroup, userId: string | null) => void;
};

/** Whether `boss` is `userId` or reports (through anyone) to them: `userId` may not report to `boss` then. */
function personUnder(userId: string, boss: string, m: Model): boolean {
  for (let at: string | null | undefined = boss, n = 0; at && n < 60; at = m.byUser.get(at)?.reports_to_user_id, n++) if (at === userId) return true;
  return false;
}

/** The work group of this unit that a member is in, if any. */
function groupIn(unitId: string, userId: string, m: Model): WorkGroup | undefined {
  return m.groups.find((g) => g.unit_id === unitId && g.member_ids.includes(userId));
}

/** P146: what the tree's boxes do (Departments and Companies views alike). */
function useTreeX(st: StructureState, prima: PrimaBridge) {
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
    personReportsTo: (userId, bossId) => {
      const who = m.byUser.get(userId);
      if (!who || (who.reports_to_user_id ?? null) === bossId || (bossId && personUnder(userId, bossId, m))) return;
      void act.run(() => structure.setReportsTo(userId, bossId), 'Reporting line saved.');
    },
    pair: (unitId, userId, withId) => {
      if (userId === withId) return;
      const g = groupIn(unitId, withId, m);
      if (g?.member_ids.includes(userId)) return;
      if (g) void act.run(() => structure.updateGroup(g.id, { member_ids: [...g.member_ids, userId], move: true }), 'Paired.');
      else void act.run(() => structure.addGroup({ unit_id: unitId, member_ids: [withId, userId], move: true }), 'Paired.');
    },
    joinGroup: (g, userId) => {
      if (g.member_ids.includes(userId) || g.lead_user_id === userId) return;
      void act.run(() => structure.updateGroup(g.id, { member_ids: [...g.member_ids, userId], move: true }), 'Paired.');
    },
    leaveGroup: (g, userId) => {
      const rest = g.member_ids.filter((i) => i !== userId);
      if (rest.length === g.member_ids.length) return;
      // A group of one is kept only when it works with someone (a manager and the one person they work with).
      if (!rest.length || (rest.length === 1 && !g.lead_user_id)) void act.run(() => structure.removeGroup(g.id).then(() => null), 'Unpaired.');
      else void act.run(() => structure.updateGroup(g.id, { member_ids: rest }), 'Unpaired.');
    },
    groupLead: (g, userId) => {
      if (g.lead_user_id === userId || (userId && g.member_ids.includes(userId))) return;
      void act.run(() => structure.updateGroup(g.id, { lead_user_id: userId }), 'Reporting line saved.');
    },
  };
  return { x, act, rest };
}

export function StructureTree({ st, prima }: { st: StructureState; prima: PrimaBridge }) {
  const m = st.model!;
  const { x, act, rest } = useTreeX(st, prima);
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

function UnitTree({ u, depth, x, company, extra }: { u: OrgUnitRow; depth: number; x: X; /** P146: the Companies view: this office company. */ company?: string; /** Its departments kept elsewhere in the tree. */ extra?: OrgUnitRow[] }) {
  const open = x.st.isOpen(u.id, depth);
  const subs = [...(x.m.subUnits.get(u.id) ?? []), ...(extra ?? [])];
  const roles = x.m.rootRoles.get(u.id) ?? [];
  const byPeople = x.st.layoutOf(u.id) === 'people';
  const pu = x.primaOf.get(u.id) ?? [];
  const staff = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const p of pu) for (const s of x.prima.membersOf(p)) seen.set(s.id, s);
    return [...seen.values()];
  }, [pu, x.prima]);
  const [team, setTeam] = useState(false);
  return (
    <div className="oc-node">
      <UnitBox u={u} depth={depth} x={x} open={open} pu={pu} staff={staff} team={team} onTeam={() => setTeam((t) => !t)} company={company} extra={extra?.length ?? 0} />
      {open && (roles.length > 0 || x.edit || (x.m.unitPeople.get(u.id)?.length ?? 0) > 0) && (
        <>
          <span className="oc-stem" aria-hidden="true" />
          {byPeople ? <PeopleCard u={u} x={x} /> : <RolesCard u={u} roles={roles} x={x} />}
        </>
      )}
      {open && company && <AwayRolesCard top={u} extra={extra ?? []} company={company} x={x} />}
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

function UnitBox({ u, depth, x, open, pu, staff, team, onTeam, company, extra = 0 }: { u: OrgUnitRow; depth: number; x: X; open: boolean; pu: PrimaUnit[]; staff: Person[]; team: boolean; onTeam: () => void; company?: string; extra?: number }) {
  const [over, setOver] = useState(false);
  const roles = x.m.s.positions.filter((p) => p.unit_id === u.id).length;
  const subs = (x.m.subUnits.get(u.id) ?? []).length + extra;
  // P146: in the Companies view, everyone whose company it is (by their office company), and those with no role yet.
  const coPeople = company ? x.m.s.members.filter((p) => p.branch_id === company) : null;
  const people = coPeople ? coPeople.length : (x.m.people.get(u.id) ?? 0);
  const coUnsorted = coPeople ? coPeople.filter((p) => !p.position_id || !x.m.pos.has(p.position_id)).length : 0;
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
          {company && x.edit && coUnsorted > 0 && (
            <button type="button" className="oc-sunit-team oc-co-unsorted" onClick={() => x.st.openUnsorted(company)} title="People of this company with no role yet: sort them">
              <TrayIcon size={13} aria-hidden="true" />
              <span>Unsorted</span> <span className="num">{coUnsorted}</span>
            </button>
          )}
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
        <LayoutSwitch u={u} x={x} />
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

function RoleItem({ p, x, flat, only }: { p: PositionRow; x: X; /** P146: no sub-roles, and the unit's name (a group unit's role in a company). */ flat?: boolean; /** Only these holders (a company's own). */ only?: (h: StructureMember) => boolean }) {
  const kids = flat ? [] : (x.m.subRoles.get(p.id) ?? []);
  const holders = (x.m.holders.get(p.id) ?? []).filter((h) => !only || only(h));
  const boss = p.reports_to_id ? x.m.pos.get(p.reports_to_id) : undefined;
  const away = flat ? undefined : boss && boss.unit_id !== p.unit_id ? boss : undefined;
  const inUnit = flat ? x.m.unit.get(p.unit_id) : undefined;
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
          {inUnit && (
            <span className="oc-pos-up" title="Unit">
              <TreeStructureIcon size={11} aria-hidden="true" />
              {x.names.unit(inUnit)}
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
      {st.unsorted && <UnsortedPanel st={st} m={m} prima={prima} onClose={() => st.setUnsorted(false)} />}
      {pnl?.kind === 'unit' && (
        <Drawer title={pnl.unit ? 'Edit unit' : 'Add a sub-department'} sub={pnl.unit?.name ?? pnl.parent?.name} onClose={close}>
          <UnitForm m={m} unit={pnl.unit} parent={pnl.parent} onDone={close} />
        </Drawer>
      )}
      {pnl?.kind === 'people' && (
        <Drawer title="Add people" sub={pnl.unit.name} onClose={close}>
          <AddPeopleForm m={m} unit={pnl.unit} onDone={close} />
        </Drawer>
      )}
      {pnl?.kind === 'person' && m.byUser.get(pnl.userId) && (
        <Drawer title={m.byUser.get(pnl.userId)!.name} sub={pnl.unit.name} onClose={close}>
          <PersonForm st={st} m={m} prima={prima} userId={pnl.userId} unit={pnl.unit} onClose={close} />
        </Drawer>
      )}
      {pnl?.kind === 'group' && (
        <Drawer title={pnl.group.name || (pnl.group.member_ids.length === 2 ? 'Pair' : 'Team')} sub={pnl.unit.name} onClose={close}>
          <GroupForm m={m} group={m.groups.find((g) => g.id === pnl.group.id) ?? pnl.group} onDone={close} />
        </Drawer>
      )}
      {pnl?.kind === 'company' && (
        <Drawer title="Add a company" sub="A company of the office; its unit appears here" onClose={close}>
          <OfficeNameForm what="company" onDone={close} />
        </Drawer>
      )}
      {pnl?.kind === 'officeDept' && pnl.unit.branch_id && (
        <Drawer title="Add an office department" sub={pnl.unit.name} onClose={close}>
          <OfficeNameForm what="department" branchId={pnl.unit.branch_id} onDone={close} />
        </Drawer>
      )}
      {pnl?.kind === 'add' && (
        <Drawer title={pnl.unit.name} sub="Add a sub-department, a role or people" onClose={close}>
          <div className="org-form">
            <div className="oc-choices">
              <button type="button" className="btn btn-primary" onClick={() => st.setPanel({ kind: 'unit', unit: null, parent: pnl.unit })}>
                <PlusIcon size={14} aria-hidden="true" />
                Add a sub-department
              </button>
              <button type="button" className="btn" onClick={() => st.setPanel({ kind: 'position', pos: null, unit: pnl.unit, reportsTo: null })}>
                <PlusIcon size={14} aria-hidden="true" />
                Add a role
              </button>
              <button type="button" className="btn" onClick={() => st.setPanel({ kind: 'people', unit: pnl.unit })}>
                <UserPlusIcon size={14} aria-hidden="true" />
                Add people
              </button>
              {pnl.unit.branch_id && !pnl.unit.department_id && (
                <button type="button" className="btn btn-ghost" onClick={() => st.setPanel({ kind: 'officeDept', unit: pnl.unit })}>
                  <BuildingsIcon size={14} aria-hidden="true" />
                  Add an office department
                </button>
              )}
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
          <HoldersForm st={st} m={m} prima={prima} pos={m.pos.get(pnl.pos.id) ?? pnl.pos} onClose={close} />
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
  // P146: under a department or a company, a department (a sub-department).
  const [kind, setKind] = useState<UnitKind>(unit?.kind ?? (parent?.kind === 'company' || parent?.kind === 'department' ? 'department' : 'unit'));
  const [parentId, setParentId] = useState(unit ? (unit.parent_id ?? '') : (parent?.id ?? ''));
  const [removing, setRemoving] = useState(false);
  // P146: the office company above (its departments may be linked), and renaming the office's own company or department.
  const branchId = unit?.branch_id ?? (parentId ? chainOf(parentId, m).find((u) => u.branch_id)?.branch_id : null) ?? null;
  const isCompany = !!unit?.branch_id && !unit.department_id;
  const [deptId, setDeptId] = useState(unit?.department_id ?? '');
  const [alsoOffice, setAlsoOffice] = useState(true);
  const companies = useLoad(() => (branchId && !isCompany ? office.companies() : Promise.resolve([])), [branchId, isCompany]);
  const depts = (companies.data ?? []).find((c) => c.id === branchId)?.departments ?? [];
  const clean = name.replace(/\s+/g, ' ').trim();
  const leave = unit ? unitsUnder(unit.id, m) : undefined;
  const empty = unit ? !(m.subUnits.get(unit.id) ?? []).length && !m.s.positions.some((p) => p.unit_id === unit.id) : false;
  const renamed = !!unit && clean !== unit.name;
  const save = async () => {
    const link = isCompany ? {} : { department_id: deptId || null, ...(deptId && branchId ? { branch_id: branchId } : {}) };
    const body = { name: clean, name_ms: nameMs.trim() || null, kind, parent_id: parentId || null, ...link };
    if (unit) await structure.updateUnit(unit.id, body);
    else await structure.addUnit(body);
    if (unit && renamed && alsoOffice) {
      if (isCompany && unit.branch_id) await office.updateCompany(unit.branch_id, { name: clean.slice(0, 120) });
      else if (unit.department_id && unit.department_id === (deptId || null)) await office.renameDepartment(unit.department_id, clean.slice(0, 120));
    }
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
      {branchId && !isCompany && (
        <label className="field">
          <span>Stands for an office department (optional)</span>
          <Select className="input" value={deptId} onChange={(e) => setDeptId(e.target.value)} searchable>
            <option value="">None: only in the chart</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {renamed && (isCompany || !!unit?.department_id) && (
        <label className="oc-check">
          <input type="checkbox" checked={alsoOffice} onChange={(e) => setAlsoOffice(e.target.checked)} />
          <span>{isCompany ? 'Also rename the office company' : 'Also rename the office department'}</span>
        </label>
      )}
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
  const firstBoss = pos ? (pos.reports_to_id ?? '') : (reportsTo?.id ?? topRoleFor(unit.id, m) ?? '');
  const [boss, setBoss] = useState(firstBoss);
  const [role, setRole] = useState(pos?.default_role ?? (pos ? '' : 'staff'));
  const [headcount, setHeadcount] = useState(pos?.headcount != null ? String(pos.headcount) : '');
  const [duties, setDuties] = useState(pos?.duties ?? '');
  const [removing, setRemoving] = useState(false);
  // P146 (owner, 28 Nov 2026: "When I click add role I have no role selection"): a new role starts from the roles
  // already defined anywhere; picking one copies its titles, office role, duties and other names.
  const [picking, setPicking] = useState(!pos && m.s.positions.length > 0);
  const [from, setFrom] = useState<RoleTitle | null>(null);
  const [aliases, setAliases] = useState<string[]>([]);
  const pick = (t: RoleTitle) => {
    setFrom(t);
    setTitle(t.title);
    setTitleMs(t.title_ms ?? '');
    setRole(t.default_role ?? '');
    setDuties(t.duties ?? '');
    setAliases(t.aliases);
    setBoss(reportsTo?.id ?? bossFor(t, unitId, m) ?? firstBoss);
    setPicking(false);
  };
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
    else await structure.addPosition({ ...body, ...(from && aliases.length ? { aliases } : {}) });
    return null;
  };
  const remove = () => structure.removePosition(pos!.id, holders.length > 0).then(() => null);
  if (picking) return <RolePicker m={m} unit={unit} onPick={pick} onNew={() => setPicking(false)} />;
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      {!pos && (
        <div className="oc-picked">
          {from ? (
            <span className="muted small">
              <span>Copied from</span> <strong>{from.title}</strong>: <span>its Malay title, office role, duties and other names. Change anything before adding.</span>
            </span>
          ) : (
            <span className="muted small">A new role, typed here.</span>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
            <MagnifyingGlassIcon size={14} aria-hidden="true" />
            Pick a role
          </button>
        </div>
      )}
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

function HoldersForm({ st, m, prima, pos, onClose }: { st: StructureState; m: Model; prima: PrimaBridge; pos: PositionRow; onClose: () => void }) {
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
              <QuickButton userId={h.user_id} name={h.name} prima={prima} />
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
function UnsortedPanel({ st, m, prima, onClose }: { st: StructureState; m: Model; prima: PrimaBridge; onClose: () => void }) {
  const act = useAction();
  const names = useNames();
  const [q, setQ] = useState('');
  // P146: opened from a company in the Companies view, it shows that company's people.
  const company = st.unsortedCompany;
  const setCompany = st.setUnsortedCompany;
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
              <QuickButton userId={x.user_id} name={x.name} prima={prima} />
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

// ---------------------------------------------------------------- P146: picking a role defined elsewhere

/** One role title as defined anywhere (the places that have it, the first one's details). */
interface RoleTitle {
  key: string;
  title: string;
  title_ms: string | null;
  default_role: string | null;
  duties: string | null;
  aliases: string[];
  places: PositionRow[];
}

function roleTitles(m: Model): RoleTitle[] {
  const out = new Map<string, RoleTitle>();
  for (const p of m.s.positions) {
    const key = norm(p.title);
    if (!key) continue;
    const t = out.get(key);
    if (!t) {
      out.set(key, { key, title: p.title, title_ms: p.title_ms, default_role: p.default_role, duties: p.duties, aliases: [...p.aliases], places: [p] });
      continue;
    }
    t.places.push(p);
    t.title_ms ??= p.title_ms;
    t.default_role ??= p.default_role;
    t.duties ??= p.duties;
    for (const a of p.aliases) if (!t.aliases.includes(a)) t.aliases.push(a);
  }
  return [...out.values()].sort((a, b) => b.places.length - a.places.length || a.title.localeCompare(b.title));
}

/** The first role of a unit, else of the nearest unit above it that has roles. */
function topRoleFor(unitId: string, m: Model): string | null {
  for (const u of chainOf(unitId, m)) {
    const top = (m.rootRoles.get(u.id) ?? [])[0];
    if (top) return top.id;
  }
  return null;
}

/**
 * Who a role copied into `unitId` reports to: a role with the same title as the one it reports to elsewhere, in this unit
 * or a unit above (Operations Manager of Zone B under Zone B's own Zone Head), else that same boss when it sits above this
 * unit too, else this unit's first role (or the nearest above).
 */
function bossFor(t: RoleTitle, unitId: string, m: Model): string | null {
  const chain = new Set(chainOf(unitId, m).map((u) => u.id));
  for (const src of t.places) {
    const b = src.reports_to_id ? m.pos.get(src.reports_to_id) : undefined;
    if (!b) continue;
    const same = m.s.positions.find((p) => chain.has(p.unit_id) && norm(p.title) === norm(b.title));
    if (same) return same.id;
    if (chain.has(b.unit_id)) return b.id;
  }
  return topRoleFor(unitId, m);
}

function RolePicker({ m, unit, onPick, onNew }: { m: Model; unit: OrgUnitRow; onPick: (t: RoleTitle) => void; onNew: () => void }) {
  const names = useNames();
  const [q, setQ] = useState('');
  const all = useMemo(() => roleTitles(m), [m]);
  const words = norm(q).split(' ').filter(Boolean);
  const shown = all.filter((t) => words.every((w) => norm(`${t.title} ${t.title_ms ?? ''} ${t.aliases.join(' ')} ${t.places.map((p) => m.unit.get(p.unit_id)?.name ?? '').join(' ')}`).includes(w)));
  const here = new Set(m.s.positions.filter((p) => p.unit_id === unit.id).map((p) => norm(p.title)));
  return (
    <div className="org-form">
      <p className="muted small">Pick a role already used in the group: its title, Malay title, office role and duties are copied into this unit. Or type a new one.</p>
      <label className="oco-find">
        <MagnifyingGlassIcon size={14} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a role, in English or Malay" aria-label="Find a role" autoFocus />
      </label>
      <ul className="oc-pick-list">
        {shown.slice(0, 80).map((t) => {
          const units = [...new Set(t.places.map((p) => m.unit.get(p.unit_id)).filter((u): u is OrgUnitRow => !!u).map((u) => names.unit(u)))];
          return (
            <li key={t.key}>
              <button type="button" onClick={() => onPick(t)}>
                <span className="oc-pick-text">
                  <strong>{t.title}</strong>
                  {t.title_ms && t.title_ms !== t.title && <span className="muted"> · {t.title_ms}</span>}
                  <span className="muted small oc-pick-units" title={units.join(', ')}>
                    {[t.default_role ? roleLabel(t.default_role) : '', units.slice(0, 3).join(', ') + (units.length > 3 ? ' …' : '')].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {here.has(t.key) && <Chip tone="neutral">In this unit</Chip>}
                <span className="oc-pick-n num" title="Places that have this role">
                  {t.places.length}
                </span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="oc-side-none muted small">No role matches. Type it as a new role.</li>}
      </ul>
      <div className="org-form-actions">
        <button type="button" className="btn" onClick={onNew}>
          <PlusIcon size={14} aria-hidden="true" />
          New role (type it)
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- P146: a unit by its people

function LayoutSwitch({ u, x }: { u: OrgUnitRow; x: X }) {
  const v = x.st.layoutOf(u.id);
  return (
    <span className="oc-layout" role="group" aria-label="Show this unit">
      <button type="button" aria-pressed={v === 'role'} onClick={() => x.st.setLayout(u.id, 'role')} title="Its roles, who holds each">
        By role
      </button>
      <button type="button" aria-pressed={v === 'people'} onClick={() => x.st.setLayout(u.id, 'people')} title="Its people: who reports to whom, pairs and teams side by side">
        By people
      </button>
    </span>
  );
}

type PNode = { kind: 'person'; id: string; who: StructureMember; kids: PNode[] } | { kind: 'group'; id: string; g: WorkGroup; who: StructureMember[]; kids: PNode[] };

/**
 * The people holding a role in this unit as a tree by who they report to. The people of one work group are one node
 * (side by side), under the person the group works with (its lead), else under the manager they share.
 */
function peopleTree(u: OrgUnitRow, m: Model): PNode[] {
  const people = m.unitPeople.get(u.id) ?? [];
  const inUnit = new Map(people.map((p) => [p.user_id, p]));
  const groupOf = new Map<string, WorkGroup>();
  for (const g of m.groups) if (g.unit_id === u.id) for (const id of g.member_ids) if (inUnit.has(id) && !groupOf.has(id)) groupOf.set(id, g);
  const keyOf = (uid: string) => (groupOf.has(uid) ? `g:${groupOf.get(uid)!.id}` : `p:${uid}`);
  const level = (p: StructureMember) => (p.position_id ? (m.pos.get(p.position_id)?.level ?? 99) : 99);
  const nodes = new Map<string, PNode>();
  for (const p of [...people].sort((a, b) => level(a) - level(b) || a.name.localeCompare(b.name))) {
    const k = keyOf(p.user_id);
    if (nodes.has(k)) continue;
    const g = groupOf.get(p.user_id);
    nodes.set(
      k,
      g
        ? { kind: 'group', id: k, g, who: g.member_ids.map((i) => inUnit.get(i)).filter((w): w is StructureMember => !!w && groupOf.get(w.user_id) === g), kids: [] }
        : { kind: 'person', id: k, who: p, kids: [] },
    );
  }
  const up = (uid: string | null | undefined, self: string) => (uid && inUnit.has(uid) && keyOf(uid) !== self ? keyOf(uid) : null);
  const parentOf = (n: PNode): string | null => {
    if (n.kind === 'person') return up(n.who.reports_to_user_id, n.id);
    const lead = up(n.g.lead_user_id, n.id);
    if (lead) return lead;
    const bosses = [...new Set(n.who.map((w) => w.reports_to_user_id ?? ''))];
    return bosses.length === 1 ? up(bosses[0], n.id) : null;
  };
  const kids = new Map<string, PNode[]>();
  const roots: PNode[] = [];
  for (const n of nodes.values()) {
    const at = parentOf(n);
    if (at) push(kids, at, n);
    else roots.push(n);
  }
  const seen = new Set<string>();
  const attach = (n: PNode) => {
    seen.add(n.id);
    n.kids = (kids.get(n.id) ?? []).filter((k) => !seen.has(k.id));
    n.kids.forEach((k) => seen.add(k.id));
    n.kids.forEach(attach);
  };
  roots.forEach(attach);
  // People in a loop of lines (A under B under A): the first of them at the top.
  for (const n of nodes.values())
    if (!seen.has(n.id)) {
      roots.push(n);
      attach(n);
    }
  return roots;
}

function PeopleCard({ u, x }: { u: OrgUnitRow; x: X }) {
  const roots = useMemo(() => peopleTree(u, x.m), [u, x.m]);
  const [over, setOver] = useState(false);
  const d = x.st.drag;
  const loose = d?.kind === 'member' ? groupIn(u.id, d.userId, x.m) : undefined;
  return (
    <div className="oc-roles oc-people">
      <div className="oc-roles-head">
        <UsersIcon size={13} aria-hidden="true" />
        <span>People</span>
        <LayoutSwitch u={u} x={x} />
        {x.edit && (
          <button type="button" className="oc-roles-add" onClick={() => x.st.setPanel({ kind: 'people', unit: u })}>
            <UserPlusIcon size={12} weight="bold" aria-hidden="true" />
            Add people
          </button>
        )}
      </div>
      {x.edit && loose && (
        <div
          className="oc-people-loose"
          data-drop={over || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!over) setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            if (d?.kind === 'member') x.leaveGroup(loose, d.userId);
            x.st.setDrag(null);
          }}
        >
          Drop here to take them out of their pair or team
        </div>
      )}
      {roots.length ? (
        <ul className="oc-ptree oc-ppl">
          {roots.map((n) => (
            <PeopleNode key={n.id} n={n} u={u} x={x} />
          ))}
        </ul>
      ) : (
        <p className="oc-roles-none muted small">Nobody holds a role in this unit yet.</p>
      )}
      {x.edit && roots.length > 0 && <p className="oc-people-tip muted small">Drag a person onto another: they report to them. Drag onto the handshake: they work side by side.</p>}
    </div>
  );
}

function PeopleNode({ n, u, x }: { n: PNode; u: OrgUnitRow; x: X }) {
  return (
    <li>
      {n.kind === 'person' ? <PersonChip who={n.who} u={u} x={x} /> : <GroupBox n={n} u={u} x={x} />}
      {n.kids.length > 0 && (
        <ul>
          {n.kids.map((k) => (
            <PeopleNode key={k.id} n={k} u={u} x={x} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PersonChip({ who, u, x, group }: { who: StructureMember; u: OrgUnitRow; x: X; group?: WorkGroup }) {
  const [over, setOver] = useState<'line' | 'pair' | null>(null);
  const d = x.st.drag;
  const role = who.position_id ? x.m.pos.get(who.position_id) : undefined;
  const boss = who.reports_to_user_id ? x.m.byUser.get(who.reports_to_user_id) : undefined;
  const bossAway = boss && !(x.m.unitPeople.get(u.id) ?? []).some((p) => p.user_id === boss.user_id) ? boss : undefined;
  const takesLine = (): boolean => {
    if (!x.edit) return false;
    if (d?.kind === 'member') return d.userId !== who.user_id && x.m.byUser.get(d.userId)?.reports_to_user_id !== who.user_id && !personUnder(d.userId, who.user_id, x.m);
    if (d?.kind === 'group') {
      const g = x.m.groups.find((y) => y.id === d.id);
      return !!g && !g.member_ids.includes(who.user_id) && g.lead_user_id !== who.user_id;
    }
    return false;
  };
  const takesPair = (): boolean => x.edit && d?.kind === 'member' && d.userId !== who.user_id && !(group?.member_ids.includes(d.userId) ?? false);
  const dropLine = (e: DragEvent) => {
    setOver(null);
    if (!takesLine()) return;
    e.preventDefault();
    e.stopPropagation();
    if (d?.kind === 'member') x.personReportsTo(d.userId, who.user_id);
    else if (d?.kind === 'group') {
      const g = x.m.groups.find((y) => y.id === d.id);
      if (g) x.groupLead(g, who.user_id);
    }
    x.st.setDrag(null);
  };
  const dropPair = (e: DragEvent) => {
    setOver(null);
    if (!takesPair() || d?.kind !== 'member') return;
    e.preventDefault();
    e.stopPropagation();
    if (group) x.joinGroup(group, d.userId);
    else x.pair(u.id, d.userId, who.user_id);
    x.st.setDrag(null);
  };
  return (
    <div
      className="oc-pcard"
      data-drop={over === 'line' || undefined}
      data-dragging={(d?.kind === 'member' && d.userId === who.user_id) || undefined}
      draggable={x.edit || undefined}
      onDragStart={
        x.edit
          ? (e) => {
              e.stopPropagation();
              e.dataTransfer.setData('text/plain', who.user_id);
              e.dataTransfer.effectAllowed = 'move';
              x.st.setDrag({ kind: 'member', userId: who.user_id });
            }
          : undefined
      }
      onDragEnd={() => x.st.setDrag(null)}
      onDragOver={(e) => {
        if (!takesLine()) return;
        e.preventDefault();
        e.stopPropagation();
        if (over !== 'line') setOver('line');
      }}
      onDragLeave={() => setOver(null)}
      onDrop={dropLine}
    >
      <button type="button" className="oc-pcard-main" onClick={() => x.st.setPanel({ kind: 'person', userId: who.user_id, unit: u })} title={who.email}>
        <Avatar name={who.name} size={26} />
        <span className="oc-pcard-text">
          <strong>{who.name}</strong>
          <span className="muted small">{role ? x.names.role(role) : (who.job_title ?? '')}</span>
          {bossAway && (
            <span className="oc-pos-up" title="Reports to">
              <ArrowUpIcon size={11} aria-hidden="true" />
              {bossAway.name}
            </span>
          )}
        </span>
      </button>
      {group && x.edit && (
        <button type="button" className="oc-pcard-x" title="Take out of this pair or team" aria-label={`Take ${who.name} out of this pair or team`} onClick={() => x.leaveGroup(group, who.user_id)}>
          <XIcon size={12} aria-hidden="true" />
        </button>
      )}
      {takesPair() && (
        <span
          className="oc-pair-drop"
          data-drop={over === 'pair' || undefined}
          title="Work side by side with this person"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (over !== 'pair') setOver('pair');
          }}
          onDragLeave={() => setOver(null)}
          onDrop={dropPair}
        >
          <HandshakeIcon size={16} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

function GroupBox({ n, u, x }: { n: Extract<PNode, { kind: 'group' }>; u: OrgUnitRow; x: X }) {
  const [over, setOver] = useState(false);
  const d = x.st.drag;
  const lead = n.g.lead_user_id ? x.m.byUser.get(n.g.lead_user_id) : undefined;
  const takes = x.edit && d?.kind === 'member' && !n.g.member_ids.includes(d.userId) && n.g.lead_user_id !== d.userId;
  return (
    <div
      className="oc-pair"
      data-drop={(over && takes) || undefined}
      data-dragging={(d?.kind === 'group' && d.id === n.g.id) || undefined}
      draggable={x.edit || undefined}
      onDragStart={
        x.edit
          ? (e) => {
              e.stopPropagation();
              e.dataTransfer.setData('text/plain', n.g.id);
              x.st.setDrag({ kind: 'group', id: n.g.id });
            }
          : undefined
      }
      onDragEnd={() => x.st.setDrag(null)}
      onDragOver={(e) => {
        if (!takes) return;
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!takes || d?.kind !== 'member') return;
        e.preventDefault();
        e.stopPropagation();
        x.joinGroup(n.g, d.userId);
        x.st.setDrag(null);
      }}
    >
      <button type="button" className="oc-pair-head" onClick={() => x.st.setPanel({ kind: 'group', group: n.g, unit: u })} title="Name, who they work with, its people">
        <HandshakeIcon size={13} aria-hidden="true" />
        <strong>{n.g.name || (n.who.length === 2 ? 'Pair' : 'Team')}</strong>
        {lead && (
          <span className="muted">
            {' '}
            · <span>with</span> {lead.name}
          </span>
        )}
      </button>
      <div className="oc-pair-row">
        {n.who.map((w) => (
          <PersonChip key={w.user_id} who={w} u={u} x={x} group={n.g} />
        ))}
      </div>
    </div>
  );
}

/** A company's people who hold a role in a group unit (Head of Company, Local Company Administrator): shown in their own company too. */
function AwayRolesCard({ top, extra, company, x }: { top: OrgUnitRow; extra: OrgUnitRow[]; company: string; x: X }) {
  const roles = useMemo(() => {
    const inside = new Set<string>();
    for (const u of [top, ...extra]) for (const id of unitsUnder(u.id, x.m)) inside.add(id);
    const ids = new Set<string>();
    for (const p of x.m.s.members) {
      if (p.branch_id !== company || !p.position_id) continue;
      const pos = x.m.pos.get(p.position_id);
      if (pos && !inside.has(pos.unit_id)) ids.add(pos.id);
    }
    return x.m.s.positions.filter((p) => ids.has(p.id));
  }, [top, extra, company, x.m]);
  if (!roles.length) return null;
  return (
    <>
      <span className="oc-stem" aria-hidden="true" />
      <div className="oc-roles oc-away">
        <div className="oc-roles-head">
          <TreeStructureIcon size={13} aria-hidden="true" />
          <span>Their roles in group units</span>
        </div>
        <ul className="oc-ptree">
          {roles.map((p) => (
            <RoleItem key={p.id} p={p} x={x} flat only={(h) => h.branch_id === company} />
          ))}
        </ul>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- P146: people, one person, a work group

function AddPeopleForm({ m, unit, onDone }: { m: Model; unit: OrgUnitRow; onDone: () => void }) {
  const act = useAction();
  const names = useNames();
  const here = m.s.positions.filter((p) => p.unit_id === unit.id);
  const branch = chainOf(unit.id, m).find((u) => u.branch_id)?.branch_id ?? null;
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(!!branch);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState(here[0]?.id ?? '__member');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = [...m.s.members]
    .filter((p) => (!mine || p.branch_id === branch) && words.every((w) => `${p.name} ${p.email} ${p.job_title ?? ''} ${p.branch_name ?? ''}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(!!a.position_id) - Number(!!b.position_id) || a.name.localeCompare(b.name));
  const flip = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const add = async () => {
    let pid = to;
    if (pid === '__member') {
      // One click: a "Member" role in this unit (made once), under the unit's first role.
      const have = here.find((p) => norm(p.title) === 'member');
      pid = have ? have.id : (await structure.addPosition({ title: 'Member', title_ms: 'Ahli', unit_id: unit.id, reports_to_id: topRoleFor(unit.id, m), default_role: 'staff' })).id;
    }
    return structure.assign([...picked], pid);
  };
  const said = (r: { done: number; skipped: unknown[] }) => (r.skipped.length ? `${r.done} placed, ${r.skipped.length} skipped.` : `${r.done} placed.`);
  const hasMember = here.some((p) => norm(p.title) === 'member');
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="oco-find">
        <MagnifyingGlassIcon size={14} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name, email or job title" aria-label="Find a person" autoFocus />
      </label>
      {branch && (
        <label className="oc-check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>Only this company&apos;s people</span>
        </label>
      )}
      <ul className="oc-side-list oc-add-list">
        {shown.slice(0, 200).map((p) => {
          const now = p.position_id ? m.pos.get(p.position_id) : undefined;
          return (
            <li key={p.user_id} data-picked={picked.has(p.user_id) || undefined}>
              <input type="checkbox" checked={picked.has(p.user_id)} onChange={() => flip(p.user_id)} aria-label={`Select ${p.name}`} />
              <Avatar name={p.name} size={26} />
              <span className="oc-holder-text">
                <strong>{p.name}</strong>
                <span className="muted small">{[now ? names.role(now) : 'No role yet', p.branch_name].filter(Boolean).join(' · ')}</span>
              </span>
            </li>
          );
        })}
        {!shown.length && <li className="oc-side-none muted small">Nobody matches.</li>}
      </ul>
      <label className="field">
        <span>Their role in this unit</span>
        <Select className="input" value={to} onChange={(e) => setTo(e.target.value)} searchable>
          {here.map((p) => (
            <option key={p.id} value={p.id}>
              {names.role(p)}
            </option>
          ))}
          {!hasMember && <option value="__member">Member (a new role here)</option>}
        </Select>
      </label>
      <p className="muted small">Someone already in another role moves here; their job title becomes this role&apos;s title.</p>
      <div className="org-form-actions">
        <button type="button" className="btn btn-primary" disabled={act.busy || !picked.size} onClick={() => act.run(add, said).then((r) => r !== undefined && onDone())}>
          <span>Add</span> <span className="num">({picked.size})</span>
        </button>
      </div>
    </div>
  );
}

function PersonForm({ st, m, prima, userId, unit, onClose }: { st: StructureState; m: Model; prima: PrimaBridge; userId: string; unit: OrgUnitRow; onClose: () => void }) {
  const act = useAction();
  const names = useNames();
  const who = m.byUser.get(userId)!;
  const role = who.position_id ? m.pos.get(who.position_id) : undefined;
  const group = groupIn(unit.id, userId, m);
  const [boss, setBoss] = useState(who.reports_to_user_id ?? '');
  const [mate, setMate] = useState('');
  const everyone = [...m.s.members].filter((p) => p.user_id !== userId).sort((a, b) => a.name.localeCompare(b.name));
  const mates = (m.unitPeople.get(unit.id) ?? []).filter((p) => p.user_id !== userId && !group?.member_ids.includes(p.user_id));
  const mateNames = group
    ? group.member_ids
        .filter((i) => i !== userId)
        .map((i) => m.byUser.get(i)?.name)
        .filter(Boolean)
        .join(', ')
    : '';
  const pairWith = async () => {
    const g = groupIn(unit.id, mate, m);
    if (g) return structure.updateGroup(g.id, { member_ids: [...g.member_ids, userId], move: true });
    return structure.addGroup({ unit_id: unit.id, member_ids: [mate, userId], move: true });
  };
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <dl className="oc-facts">
        <dt>Role</dt>
        <dd>{role ? names.role(role) : <span className="muted">No role yet</span>}</dd>
        {who.branch_name && (
          <>
            <dt>Company</dt>
            <dd>{who.branch_name}</dd>
          </>
        )}
        {group && (
          <>
            <dt>Works with</dt>
            <dd>{mateNames || <span className="muted">Nobody else yet</span>}</dd>
          </>
        )}
      </dl>
      <div className="org-form-actions">
        <QuickButton userId={userId} name={who.name} prima={prima} />
        <ProfileButton userId={userId} name={who.name} />
      </div>
      {m.s.can_edit && (
        <>
          <h3 className="org-form-title">Reports to</h3>
          <div className="org-form-row">
            <Select className="input" value={boss} onChange={(e) => setBoss(e.target.value)} searchable aria-label="Reports to">
              <option value="">Nobody</option>
              {everyone.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {`${p.name}${p.job_title ? ` (${p.job_title})` : ''}`}
                </option>
              ))}
            </Select>
            <button type="button" className="btn btn-primary" disabled={act.busy || boss === (who.reports_to_user_id ?? '')} onClick={() => act.run(() => structure.setReportsTo(userId, boss || null), 'Reporting line saved.')}>
              Save
            </button>
          </div>
          <h3 className="org-form-title">Works side by side with</h3>
          <div className="org-form-row">
            <Select className="input" value={mate} onChange={(e) => setMate(e.target.value)} searchable aria-label="Works side by side with">
              <option value="">Someone in this unit…</option>
              {mates.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <button type="button" className="btn" disabled={act.busy || !mate} onClick={() => act.run(pairWith, 'Paired.').then((r) => r !== undefined && setMate(''))}>
              <HandshakeIcon size={14} aria-hidden="true" />
              Pair
            </button>
          </div>
          {group && (
            <div className="org-form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => st.setPanel({ kind: 'group', group, unit })}>
                <PencilSimpleIcon size={14} aria-hidden="true" />
                Edit the pair or team
              </button>
            </div>
          )}
        </>
      )}
      <div className="org-form-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function GroupForm({ m, group, onDone }: { m: Model; group: WorkGroup; onDone: () => void }) {
  const act = useAction();
  const [name, setName] = useState(group.name ?? '');
  const [lead, setLead] = useState(group.lead_user_id ?? '');
  const [removing, setRemoving] = useState(false);
  const people = group.member_ids.map((i) => m.byUser.get(i)).filter((p): p is StructureMember => !!p);
  const others = [...m.s.members].filter((p) => !group.member_ids.includes(p.user_id)).sort((a, b) => a.name.localeCompare(b.name));
  const save = () => structure.updateGroup(group.id, { name: name.trim() || null, lead_user_id: lead || null });
  const drop = (uid: string) => {
    const rest = group.member_ids.filter((i) => i !== uid);
    return rest.length ? structure.updateGroup(group.id, { member_ids: rest }) : structure.removeGroup(group.id).then(() => null);
  };
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Name (optional)</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="For example: Night patrol pair" />
      </label>
      <label className="field">
        <span>Works with (reports to)</span>
        <Select className="input" value={lead} onChange={(e) => setLead(e.target.value)} searchable>
          <option value="">Nobody set</option>
          {others.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="org-form-actions">
        <button type="button" className="btn btn-primary" disabled={act.busy} onClick={() => act.run(save, 'Saved.').then((r) => r !== undefined && onDone())}>
          Save
        </button>
      </div>
      <h3 className="org-form-title">Its people</h3>
      <ul className="oc-holders">
        {people.map((p) => (
          <li key={p.user_id}>
            <Avatar name={p.name} size={30} />
            <span className="oc-holder-text">
              <strong>{p.name}</strong>
              <span className="muted small">{p.job_title ?? ''}</span>
            </span>
            <button type="button" className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => act.run(() => drop(p.user_id), 'Unpaired.')}>
              <UserMinusIcon size={14} aria-hidden="true" />
              <span className="hide-sm">Take out</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="org-form-actions">
        {removing ? (
          <button type="button" className="btn btn-danger" disabled={act.busy} onClick={() => act.run(() => structure.removeGroup(group.id).then(() => null), 'Unpaired.').then((r) => r !== undefined && onDone())}>
            Yes, separate them
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setRemoving(true)}>
            <TrashIcon size={14} aria-hidden="true" />
            Separate this pair or team
          </button>
        )}
      </div>
      <p className="muted small">Their roles and reporting lines stay as they are.</p>
    </div>
  );
}

/** P139's company tools from the Companies view: a new office company, or a department of one. */
function OfficeNameForm({ what, branchId, onDone }: { what: 'company' | 'department'; branchId?: string; onDone: () => void }) {
  const act = useAction();
  const [name, setName] = useState('');
  const clean = name.replace(/\s+/g, ' ').trim();
  const save = () => (what === 'company' ? officeFetch<unknown>('POST', '/api/branches', { name: clean }) : office.addDepartment(branchId!, clean));
  return (
    <div className="org-form">
      <ErrorNotice error={act.error} />
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={what === 'company' ? 'e.g. Sasa Security Services Sdn Bhd' : 'e.g. Operations'} />
      </label>
      <p className="muted small">{what === 'company' ? 'The office keeps the company; it shows here as a unit with its departments.' : 'The office keeps the department; it shows here as a unit under its company.'}</p>
      <div className="org-form-actions">
        <button type="button" className="btn btn-primary" disabled={act.busy || clean.length < 2} onClick={() => act.run(save, 'Saved.').then((r) => r !== undefined && onDone())}>
          {what === 'company' ? 'Add the company' : 'Add the department'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- P146: the Companies view

/**
 * P146 (owner, 28 Nov 2026: "In the org chart I can set and sort by department, but in Companies why not the same? Do it
 * exactly like the Departments side, editing tree as well."): every office company as its unit of the group structure,
 * its departments under it, their roles and people, edited the same way as Departments (+ sub-department, + role, add
 * people, rename, move, drag people and roles, By people). A company's people who hold a role in a group unit (Head of
 * Company, Local Company Administrator) show in their own company too; Unsorted opens on that company's people. The
 * office's own list (P139: people by office department, moved by dragging) stays one switch away.
 */
export function CompanyStructure({ st, prima }: { st: StructureState; prima: PrimaBridge }) {
  const m = st.model!;
  const { x, act } = useTreeX(st, prima);
  const [q, setQ] = useState('');
  const [plain, setPlain] = useState(false);
  const words = norm(q).split(' ').filter(Boolean);
  const people = useMemo(() => {
    const out = new Map<string, StructureMember[]>();
    for (const p of m.s.members) if (p.branch_id) push(out, p.branch_id, p);
    return out;
  }, [m]);
  const shown = m.companies.filter(
    (c) =>
      !words.length ||
      words.every((w) => norm(`${c.name} ${c.name_ms ?? ''}`).includes(w)) ||
      (people.get(c.branch_id ?? '') ?? []).some((p) => words.every((w) => norm(`${p.name} ${p.email} ${p.job_title ?? ''}`).includes(w))),
  );
  // A company's departments kept elsewhere in the tree (PWVSB's central departments): shown under it too.
  const extraOf = useMemo(() => {
    const out = new Map<string, OrgUnitRow[]>();
    for (const c of m.companies) {
      const inside = unitsUnder(c.id, m);
      const away = m.s.units.filter((u) => u.branch_id === c.branch_id && u.department_id && !inside.has(u.id));
      const awayIds = new Set(away.map((u) => u.id));
      out.set(
        c.id,
        away.filter((u) => !(u.parent_id ? chainOf(u.parent_id, m) : []).some((a) => awayIds.has(a.id))),
      );
    }
    return out;
  }, [m]);
  const switcher = (
    <div className="seg oc-co-switch" role="group" aria-label="Companies shown as">
      <button type="button" aria-pressed={!plain} onClick={() => setPlain(false)}>
        Structure
      </button>
      <button type="button" aria-pressed={plain} onClick={() => setPlain(true)}>
        Office departments
      </button>
    </div>
  );
  if (plain)
    return (
      <div className="oc-struct">
        {switcher}
        <CompaniesTree />
      </div>
    );
  return (
    <div className="oc-struct">
      {switcher}
      {act.error && (
        <div className="oc-struct-error">
          <ErrorNotice error={act.error} />
        </div>
      )}
      <div className="oc-node oco">
        <div className="oc-box oc-group oco-root">
          <span className="oc-band" aria-hidden="true" />
          <div className="oc-box-main">
            <div className="oc-box-text">
              <strong className="oc-name">All companies</strong>
              <span className="oc-role">
                <span className="num">{m.companies.length}</span> <span>companies</span> · <span className="num">{m.s.members.filter((p) => p.branch_id).length}</span> <span>people</span>
              </span>
              <label className="oco-find">
                <MagnifyingGlassIcon size={15} aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a company or a person" aria-label="Find a company or a person" />
              </label>
            </div>
          </div>
          {x.edit && (
            <button type="button" className="oc-add" title="Add a company" aria-label="Add a company" onClick={() => st.setPanel({ kind: 'company' })}>
              <PlusIcon size={13} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
        <span className="oc-stem" aria-hidden="true" />
        <ul className="oc-kids oc-wrap">
          {shown.map((c) => (
            <li key={c.id}>
              <UnitTree u={c} depth={1} x={x} company={c.branch_id ?? undefined} extra={extraOf.get(c.id)} />
            </li>
          ))}
          {!shown.length && <li className="muted small">No company matches.</li>}
        </ul>
      </div>
    </div>
  );
}
