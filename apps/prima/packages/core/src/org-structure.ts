import { isOgm, isOpsDirector } from './ops-access';
import { AccessDenied } from "./access";
import { accessClosed } from "./access";
import { isGroupLeader } from "./access";
import { isHrDirector } from "./access";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { dateOf } from "./time";
import type { Id, IsoDate, IsoDateTime, User } from "./types";
import { CENTRAL_EMPLOYER_IDS } from "./access";
import { UNIT_DEPARTMENTS } from "./unit-heads";
import { UNIT_HEAD_KEYS } from "./unit-heads";
import { unitHeadsOf as markedUnitHeadsOf } from "./unit-heads";
import { lineManagerOf } from "./work";

/**
 * Org chart and reporting lines (Fauzan, 23 Nov 2026: "Recheck and rethink the organizational structure and also
 * organizational chart. Make sure every head can put who staff under it. So every task can be set correctly.").
 *
 * Before this, who reports to whom was worked out only from job fields and job titles (work.ts lineManagerOf), with the
 * Chief of Staff shown as an assumed manager wherever no rule fitted, and nobody could change it in the app. Now:
 * - the CEO or the HR Director (Chief of Staff or Deputy) names the head and deputy of each central department and
 *   central company;
 * - every head puts staff under themselves, or under someone already in their own line, with a reason;
 * - the CEO and the HR Director may set any line (HR governs HR in every company).
 * lineManagerOf reads these lines first, so everything that already follows the line (work tasks and help, the team
 * board, work rebalance, team memos, claim checks, time slips, leave asked by a manager, toolbox and meeting heads)
 * follows the chart. Role-based ladders (case escalation, FW renewal ladder, approvals by job) are unchanged.
 *
 * Rows hold ids and the reason only. Each change is audited. Guards and site devices are not on the chart: guards stay
 * in the JA Group app for about a year.
 */

export interface OrgLine {
  /** 'line-<userId>' for a reporting line, 'head-<unitKey>' for a named unit head. */
  id: Id;
  kind: 'line' | 'head';
  /** line: the staff member placed. */
  userId?: Id;
  /** line: who they report to; null means back to the standard line from their job. */
  managerId?: Id | null;
  /** head: the unit key (unit-heads.ts). */
  unit?: string;
  /** head: the named head and deputy; null clears the name (the job-based head, if any, stays). */
  headId?: Id | null;
  deputyId?: Id | null;
  /**
   * The last day this line or named role holds, for a role held for a while (acting, cover, a project). Empty means it
   * holds until changed. After that day the person goes back to the line from the job and the named role lapses
   * (Fauzan, 23 Nov 2026: "Some staff have a few roles it hold for a while or for the whole").
   */
  until?: IsoDate | null;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

const UNIT_COMPANIES = CENTRAL_EMPLOYER_IDS;
export function isUnitKey(k: unknown): k is string {
  return typeof k === 'string' && UNIT_HEAD_KEYS.includes(k);
}

/**
 * Heads the chart also counts by job, beyond the shared marker (unit-heads.ts): the IT Manager (IT and Merdeka), the ACT
 * Director, the Finance Director, and the Chief of Staff and Deputy (HR, the Chief of Staff office and PWVSB).
 */
function chartJobHeadsOf(u: User): string[] {
  if (u.integration || u.role !== 'pwvsb_officer' || u.accessClosedFrom) return [];
  const out: string[] = [];
  if (u.department === 'it' && u.itRole === 'manager') out.push('d_it', 'c_merdeka');
  if (u.department === 'audit' && u.actRole === 'lead') out.push('d_audit');
  if (u.leadership === 'finance_director') out.push('d_finance');
  if (u.leadership === 'cos' || u.leadership === 'deputy_cos') out.push('d_hr', 'd_chief_of_staff', 'c_pwvsb');
  return out;
}
/** The units a person heads on the chart: the shared marker plus the job heads above. */
export function chartHeadsOf(u: User): string[] {
  return [...new Set([...markedUnitHeadsOf(u), ...chartJobHeadsOf(u)])];
}
/** Heads by job (not named in the chart). */
function jobHeadsOf(u: User): string[] {
  return chartHeadsOf({ ...u, headOf: undefined });
}

export const ORG_LINES_MISSING = 'The org chart settings are not installed in this database yet (module org-lines-v1, run by the CEO).';

const UNIT_LABEL: Record<string, string> = {
  d_operations: 'Operations',
  d_hr: 'Human Resources',
  d_arms_control: 'Arms Control',
  d_chief_of_staff: 'Chief of Staff office',
  d_cms: 'CMS command centre',
  d_director_office: 'Director Office',
  d_fwm: 'Foreign Worker Management',
  d_pdpa: 'PDPA',
  d_transport: 'Transport',
  d_asset: 'Asset Management',
  d_finance: 'Finance',
  d_it: 'IT',
  d_legal: 'Legal',
  d_audit: 'ACT (Audit, Compliance and Transformation)',
  d_procurement: 'Procurement and Inventory',
  d_marketing: 'Marketing',
  c_pwvsb: 'PWVSB (group employer)',
  c_merdeka: 'Merdeka Network (IT company)',
  c_goodwill: 'Goodwill Empire (government operations)',
  c_sasateam: 'Sasa Team (private operations)',
  c_pgl: 'Perfect Global Logistics (transport)',
};
export function unitLabel(key: string): string {
  return UNIT_LABEL[key] ?? key;
}

/** People on the chart: office staff and officers. Guards, site devices and system feeds are not. */
export function onOrgChart(u: User, today: IsoDate): boolean {
  // The company secretary is an outside firm (view only), not staff.
  return !u.integration && !u.corpSecretary && u.role !== 'guard' && u.role !== 'site_device' && !accessClosed(u, today);
}

/** The top of the group: never placed under anyone. */
/**
 * The OGM delegates any patrolling officer to an OM (Fauzan, 23 Nov 2026: "Any om delegated by ogm"). The Operations
 * Director does the same on the private side (private operations study, 23 Nov 2026): each head only for officers not
 * tied to the other side, and only to OMs and Regional OMs of their own side or not tied to a side.
 */
function headSide(actor: User): 'government' | 'private' | null {
  return isOgm(actor) ? 'government' : isOpsDirector(actor) ? 'private' : null;
}
function onSide(u: User, side: 'government' | 'private'): boolean {
  return !u.opsSector || u.opsSector === side;
}
function ogmDelegatesPatrol(actor: User, target: User): boolean {
  const side = headSide(actor);
  return !!side && target.opsTier === 'patrol' && onSide(target, side);
}

function isTop(u: User): boolean {
  return u.opsTier === 'ceo' || u.leadership === 'chairman' || u.leadership === 'vice_chairman';
}

/** Who may set any line and name unit heads: the CEO, and the HR Director (Chief of Staff or Deputy). */
export function setsWholeChart(u: User): boolean {
  if (u.integration || u.accessClosedFrom) return false;
  return (u.opsTier === 'ceo' && (u.role === 'director' || u.role === 'pwvsb_officer')) || isHrDirector(u);
}

/** Who sees the whole chart: group leaders, the HR Director and central HR. Everyone else sees their own line. */
export function seesWholeChart(u: User): boolean {
  if (u.integration) return false;
  return isGroupLeader(u) || isHrDirector(u) || (u.role === 'pwvsb_officer' && u.department === 'hr');
}

function sameList(a: string[] | undefined, b: string[]): boolean {
  const x = a ?? [];
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Lays the chart over users as they are read: reportsToId from the lines, headOf and deputyOf from the named heads. A
 * named head row is the answer for its unit, so a stale mark elsewhere for that unit is dropped. A manager whose access
 * has closed is not used (the standard line applies until a head moves the person).
 */
/** The rows still holding today: a row with an end date lapses after that day. */
export function activeOrgLines(lines: OrgLine[], today: IsoDate): OrgLine[] {
  return lines.filter((l) => !l.until || l.until >= today);
}

export function applyOrgLines<U extends User>(users: U[], allLines: OrgLine[], today: IsoDate): U[] {
  const lines = activeOrgLines(allLines, today);
  if (!lines.length) return users;
  const byId = new Map(users.map((u) => [u.id, u]));
  const manager = new Map<Id, Id>();
  const head = new Map<string, Id | null>();
  const deputy = new Map<string, Id | null>();
  for (const l of lines) {
    if (l.kind === 'line' && l.userId && l.managerId) {
      const m = byId.get(l.managerId);
      if (m && m.id !== l.userId && !m.integration && !accessClosed(m, today)) manager.set(l.userId, l.managerId);
    } else if (l.kind === 'head' && l.unit && isUnitKey(l.unit)) {
      head.set(l.unit, l.headId ?? null);
      deputy.set(l.unit, l.deputyId ?? null);
    }
  }
  return users.map((u) => applyOne(u, manager, head, deputy));
}

function applyOne<U extends User>(u: U, manager: Map<Id, Id>, head: Map<string, Id | null>, deputy: Map<string, Id | null>): U {
  const reportsToId = manager.get(u.id);
  const headOf = [...new Set([...(u.headOf ?? []).filter((k) => !head.has(k)), ...[...head].filter(([, id]) => id === u.id).map(([k]) => k)])].sort();
  const deputyOf = [...new Set([...(u.deputyOf ?? []).filter((k) => !deputy.has(k)), ...[...deputy].filter(([, id]) => id === u.id).map(([k]) => k)])].sort();
  if (u.reportsToId === reportsToId && sameList(u.headOf, headOf) && sameList(u.deputyOf, deputyOf)) return u;
  const next = { ...u, headOf: headOf.length ? headOf : undefined, deputyOf: deputyOf.length ? deputyOf : undefined, reportsToId };
  if (!next.headOf) delete next.headOf;
  if (!next.deputyOf) delete next.deputyOf;
  if (!next.reportsToId) delete next.reportsToId;
  return next;
}

/** One user read on their own: the manager on their line is read too, so a closed manager is still not used. */
export async function overlayOne<U extends User>(u: U, allLines: OrgLine[], today: IsoDate, getUser: (id: Id) => Promise<User | undefined>): Promise<U> {
  const lines = activeOrgLines(allLines, today);
  if (!lines.length) return u;
  const line = lines.find((l) => l.kind === 'line' && l.userId === u.id && l.managerId);
  const m = line?.managerId ? await getUser(line.managerId) : undefined;
  return applyOrgLines(m ? [u, m as U] : [u], lines, today)[0];
}

const CHART = Symbol.for('prima.orgChart');

/**
 * Wraps a store so every read of users carries the chart (reportsToId, headOf, deputyOf). The lines are read once and
 * kept until this wrapper writes one. Before module org-lines-v1 is installed, users are returned as stored.
 */
export function withOrgChart<S extends Store>(store: S, clock: () => IsoDateTime): S {
  if ((store as unknown as Record<symbol, unknown>)[CHART]) return store;
  let cached: OrgLine[] | null = null;
  const lines = async (): Promise<OrgLine[]> => {
    if (cached) return cached;
    try {
      if (store.hasTable && !(await store.hasTable('orgLines'))) return (cached = []);
      cached = (await store.list('orgLines', {})) ?? [];
    } catch {
      // A dataset without the table (older test data) has no chart yet.
      cached = [];
    }
    return cached;
  };
  const proxy: S = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === CHART) return true;
      if (prop === 'list')
        return async (table: string, ...rest: unknown[]) => {
          const out = await (target.list as (...a: unknown[]) => Promise<unknown[]>).call(proxy, table, ...rest);
          if (table !== 'users') return out;
          return applyOrgLines(out as User[], await lines(), dateOf(clock()));
        };
      if (prop === 'get')
        return async (table: string, id: string) => {
          const out = await (target.get as (...a: unknown[]) => Promise<unknown>).call(proxy, table, id);
          if (table !== 'users' || !out) return out;
          return overlayOne(out as User, await lines(), dateOf(clock()), (mid) => (target.get as (...a: unknown[]) => Promise<User | undefined>).call(proxy, 'users', mid));
        };
      // A unit of work runs on this wrapper too (the store below may bind its own wrapper as the unit), so users read
      // inside it carry the chart and a line written inside it is seen straight after.
      if (prop === 'transaction')
        return async (fn: (tx: Store) => Promise<unknown>) => {
          try {
            return await (target.transaction as (f: (tx: Store) => Promise<unknown>) => Promise<unknown>).call(proxy, () => fn(proxy));
          } finally {
            cached = null;
          }
        };
      // Taking the chart lock drops what was read before it, so the next read sees changes another request committed.
      // A store without a lock (the single-threaded test store) keeps having none: services check for it.
      if (prop === 'lock' && typeof Reflect.get(target, prop, receiver) === 'function')
        return async (table: string, id: string) => {
          if (table === 'orgLines') cached = null;
          const fn = Reflect.get(target, prop, receiver) as (...a: unknown[]) => Promise<void>;
          await fn.call(proxy, table, id);
          if (table === 'orgLines') cached = null;
        };
      if (prop === 'insert' || prop === 'update')
        return async (table: string, ...rest: unknown[]) => {
          if (table === 'orgLines') cached = null;
          return (Reflect.get(target, prop, receiver) as (...a: unknown[]) => Promise<unknown>).call(proxy, table, ...rest);
        };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(proxy) : v;
    },
  });
  return proxy;
}

/** The managers above a person, nearest first (stops on a loop). */
export function chainOf(u: User, users: User[]): User[] {
  const out: User[] = [];
  let cur: User | null = u;
  for (let i = 0; i < 12 && cur; i++) {
    const next: User | null = lineManagerOf(cur, users).manager;
    if (!next || next.id === u.id || out.some((x) => x.id === next.id)) break;
    out.push(next);
    cur = next;
  }
  return out;
}

/** The units a person belongs to: their department, and the central company that employs them. */
export function unitsOfMember(u: User): string[] {
  const out: string[] = [];
  if (u.department && (UNIT_DEPARTMENTS as readonly string[]).includes(u.department)) out.push(`d_${u.department}`);
  for (const c of u.companyIds ?? []) if ((UNIT_COMPANIES as readonly string[]).includes(c)) out.push(`c_${c}`);
  return out;
}

export type LineHow = 'set' | 'standard' | 'assumed' | 'top';

const CHART_QUEUE = new WeakMap<Store, Promise<unknown>>();

export class OrgStructureService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
  ) {}

  private today(): IsoDate {
    return dateOf(this.now());
  }

  private async installed(): Promise<boolean> {
    if (!this.store.hasTable) return true;
    return this.store.hasTable('orgLines');
  }

  private async people(store: Store = this.store): Promise<User[]> {
    return (await store.list('users', {})).filter((u) => onOrgChart(u, this.today()));
  }

  /**
   * Every change to the chart runs one at a time (Fauzan's retest, 23 Nov 2026: two changes at the same time could make a
   * reporting loop). Inside one unit of work: take the chart lock (PostgreSQL holds it until the request ends), read the
   * chart again, check it, then write. In one process (the test version) changes also queue behind each other.
   */
  private async oneAtATime<R>(fn: (tx: Store) => Promise<R>): Promise<R> {
    const prev = CHART_QUEUE.get(this.store) ?? Promise.resolve();
    const run = prev.then(() =>
      this.store.transaction(async (tx) => {
        await tx.lock?.('orgLines', 'chart');
        return fn(tx);
      }),
    );
    CHART_QUEUE.set(this.store, run.catch(() => undefined));
    return run;
  }

  /** Whether the actor can move this person: their own line, or a unit they head; the CEO and HR Director anyone. */
  private reaches(actor: User, target: User, users: User[]): boolean {
    if (actor.id === target.id || isTop(target)) return false;
    if (setsWholeChart(actor)) return true;
    if (ogmDelegatesPatrol(actor, target)) return true;
    if (chainOf(actor, users).some((x) => x.id === target.id)) return false;
    if (chainOf(target, users).some((x) => x.id === actor.id)) return true;
    const heads = chartHeadsOf(actor);
    return unitsOfMember(target).some((k) => heads.includes(k));
  }

  /** Who the actor may put people under: themselves and the people already in their line (anyone, for the CEO/HR Director). */
  private managerChoices(actor: User, users: User[]): User[] {
    const office = users.filter((u) => u.role !== 'supervisor' || u.opsTier === 'patrol');
    if (setsWholeChart(actor)) return office;
    // The OGM delegates a patrolling officer to any OM or Regional OM (Fauzan, 23 Nov 2026: "Any om delegated by ogm").
    const side = headSide(actor);
    const oms = side ? office.filter((u) => (u.opsTier === 'om' || u.opsTier === 'regional') && onSide(u, side)) : [];
    return office.filter((u) => u.id === actor.id || chainOf(u, users).some((x) => x.id === actor.id) || oms.includes(u));
  }

  /** An optional last day (YYYY-MM-DD), today or later; empty means it holds until changed. */
  private untilOf(v: unknown): IsoDate | null {
    if (v == null || v === '') return null;
    const d = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new BadRequest('The end date must be a date (YYYY-MM-DD).');
    if (d < this.today()) throw new BadRequest('The end date cannot be in the past.');
    return d;
  }

  private how(u: User, users: User[]): LineHow {
    if (isTop(u)) return 'top';
    if (u.reportsToId && users.some((x) => x.id === u.reportsToId)) return 'set';
    return lineManagerOf(u, users).assumed ? 'assumed' : 'standard';
  }

  /** The chart the person may see, with what they may change. */
  async chart(user: User) {
    if (!onOrgChart(user, this.today()) || user.role === 'supervisor') throw new AccessDenied('view', '(office staff only)');
    const installed = await this.installed();
    const users = await this.people();
    const me = users.find((u) => u.id === user.id) ?? user;
    const whole = seesWholeChart(me);
    const above = chainOf(me, users);
    const myHeads = chartHeadsOf(me);
    const visible = whole
      ? users
      : users.filter(
          (u) =>
            u.id === me.id ||
            above.some((a) => a.id === u.id) ||
            chainOf(u, users).some((a) => a.id === me.id) ||
            unitsOfMember(u).some((k) => myHeads.includes(k)),
        );
    const lines = installed ? activeOrgLines(await this.store.list('orgLines', {}), this.today()) : [];
    const lineOf = new Map(lines.filter((l) => l.kind === 'line' && l.userId).map((l) => [l.userId!, l]));
    const people = visible.map((u) => {
      const m = lineManagerOf(u, users);
      const line = lineOf.get(u.id);
      return {
        id: u.id,
        name: u.name,
        title: u.title,
        role: u.role,
        department: u.department ?? null,
        companyIds: u.companyIds ?? [],
        managerId: m.manager?.id ?? null,
        how: this.how(u, users),
        setBy: line && line.managerId ? { by: line.by, at: line.at, reason: line.reason, until: line.until ?? null } : null,
        heads: chartHeadsOf(u),
        deputyOf: u.deputyOf ?? [],
        canMove: installed && this.reaches(me, u, users),
        above: above.some((a) => a.id === u.id),
      };
    });
    const unitKeys = whole ? [...UNIT_DEPARTMENTS.map((d) => `d_${d}`), ...UNIT_COMPANIES.map((c) => `c_${c}`)] : [...new Set([...myHeads, ...unitsOfMember(me)])];
    const headRows = new Map(lines.filter((l) => l.kind === 'head' && l.unit).map((l) => [l.unit!, l]));
    const units = unitKeys.map((key) => {
      const heads = users.filter((u) => chartHeadsOf(u).includes(key));
      const row = headRows.get(key);
      const deputy = row?.deputyId ? users.find((u) => u.id === row.deputyId) : users.find((u) => (u.deputyOf ?? []).includes(key));
      return {
        key,
        label: unitLabel(key),
        heads: heads.map((h) => ({ id: h.id, name: h.name, title: h.title, how: jobHeadsOf(h).includes(key) ? ('job' as const) : ('named' as const) })),
        deputy: deputy ? { id: deputy.id, name: deputy.name, title: deputy.title } : null,
        members: users.filter((u) => unitsOfMember(u).includes(key)).length,
        named: row ? { by: row.by, at: row.at, reason: row.reason, until: row.until ?? null } : null,
      };
    });
    const gaps: string[] = [];
    if (whole) {
      for (const u of units) if (!u.heads.length && u.members) gaps.push(`${u.label}: no head named (${u.members} staff). Their heads cannot see the team's items until one is named.`);
      for (const p of people) if (p.how === 'assumed') gaps.push(`${p.name} (${p.title}): no line from the job, so the Chief of Staff is shown. Put them under the right head.`);
    }
    // Sasa Team and Goodwill have separate staff (Fauzan, 2 Nov 2026): an OM or Regional OM not tied to a side works
    // both sides' sites (private operations study, 23 Nov 2026). Shown to the CEO, the HR Director, the OGM and the
    // Operations Director; nothing is changed automatically.
    if (whole || headSide(me)) {
      for (const u of users)
        if (u.role === 'pwvsb_officer' && u.department === 'operations' && (u.opsTier === 'om' || u.opsTier === 'regional') && !u.opsSector)
          gaps.push(`${u.name} (${u.title}): not tied to a side, so they work both government and private sites. Set Government (Goodwill Empire) or Private (Sasa Team) in Accounts and access.`);
    }
    const choices = installed ? this.managerChoices(me, users) : [];
    return {
      installed,
      whole,
      canNameHeads: installed && setsWholeChart(me),
      meId: me.id,
      people,
      units,
      gaps,
      managerChoices: choices.map((u) => ({ id: u.id, name: u.name, title: u.title })),
      // People the actor may bring under themselves, who are not already directly under them.
      canBring: installed ? users.filter((u) => this.reaches(me, u, users) && lineManagerOf(u, users).manager?.id !== me.id).map((u) => ({ id: u.id, name: u.name, title: u.title })) : [],
      officeUnits: whole ? null : myHeads,
    };
  }

  /** Put a staff member under a manager (or back to the standard line with managerId null). */
  async setLine(user: User, input: { userId?: unknown; managerId?: unknown; reason?: unknown; until?: unknown }) {
    if (!(await this.installed())) throw new BadRequest(ORG_LINES_MISSING);
    const reason = String(input.reason ?? '').trim().slice(0, 300);
    if (reason.length < 3) throw new BadRequest('Give the reason (a few words is enough).');
    const until = this.untilOf(input.until);
    return this.oneAtATime(async (tx) => {
      const users = await this.people(tx);
      const me = users.find((u) => u.id === user.id);
      if (!me || me.role === 'supervisor') throw new AccessDenied('hr.monitor', '(office staff only)');
      const target = users.find((u) => u.id === String(input.userId ?? ''));
      if (!target) throw new NotFound('Staff member');
      if (target.id === me.id) throw new AccessDenied('hr.monitor', '(nobody sets their own line; ask your head or HR)');
      if (isTop(target)) throw new BadRequest('The CEO, the Chairman and the Vice Chairman report to nobody in the chart.');
      const managerId = input.managerId == null || input.managerId === '' ? null : String(input.managerId);
      const manager = managerId ? users.find((u) => u.id === managerId) : null;
      if (managerId && !manager) throw new NotFound('Manager');
      if (manager && manager.id === target.id) throw new BadRequest('Nobody reports to themselves.');
      if (manager && manager.role === 'supervisor' && manager.opsTier !== 'patrol') throw new BadRequest('A site officer cannot have staff under them.');
      if (!this.reaches(me, target, users))
        throw new AccessDenied('hr.monitor', '(you can move only people in your own line or your unit; ask the HR Director for a move between heads)');
      if (manager && !setsWholeChart(me) && headSide(me)) {
        const inMyLine = manager.id === me.id || chainOf(manager, users).some((x) => x.id === me.id);
        const omPick = manager.opsTier === 'om' || manager.opsTier === 'regional';
        // The OGM's delegation covers patrolling officers to OMs; anyone else follows the usual own-line rule.
        const side = headSide(me)!;
        if (target.opsTier === 'patrol' && omPick && !onSide(manager, side))
          throw new AccessDenied('hr.monitor', '(a patrolling officer goes under an OM or a Regional OM of your own side)');
        if (target.opsTier === 'patrol' && !omPick && manager.id !== me.id)
          throw new AccessDenied('hr.monitor', '(the OGM or the Operations Director puts a patrolling officer under an OM or a Regional OM)');
        if (!inMyLine && omPick && target.opsTier !== 'patrol')
          throw new AccessDenied('hr.monitor', '(you can put people only under yourself or under someone already in your line)');
      }
      if (manager && !this.managerChoices(me, users).some((u) => u.id === manager.id))
        throw new AccessDenied('hr.monitor', '(you can put people only under yourself or under someone already in your line)');
      if (manager && chainOf(manager, users).some((x) => x.id === target.id))
        throw new BadRequest(`${manager.name} already reports to ${target.name}; that would make a loop.`);
      const id = `line-${target.id}`;
      const at = this.now();
      const row: OrgLine = { id, kind: 'line', userId: target.id, managerId, until: managerId ? until : null, reason, by: me.name, byId: me.id, at };
      const before = await tx.get('orgLines', id);
      // P138 (office): the database store refuses an update that names the row's id; send the fields only.
      if (before) await tx.update('orgLines', id, withoutId(row));
      else await tx.insert('orgLines', row);
      await tx.audit({
          at,
          actor: me.name,
          companyId: null,
          action: 'org.line_set',
          entity: 'hr.monitor',
          entityId: id,
          summary: manager ? `${target.name} now reports to ${manager.name}${until ? ` until ${until}` : ''}. Reason: ${reason}` : `${target.name} back to the standard line from the job. Reason: ${reason}`,
        });
      return row;
    });
  }

  /** Name the head and deputy of a central department or central company (CEO or HR Director). */
  async setHead(user: User, input: { unit?: unknown; headId?: unknown; deputyId?: unknown; reason?: unknown; until?: unknown }) {
    if (!(await this.installed())) throw new BadRequest(ORG_LINES_MISSING);
    if (!setsWholeChart(user)) throw new AccessDenied('hr.monitor', '(the CEO or the HR Director names heads)');
    const unit = String(input.unit ?? '');
    if (!isUnitKey(unit)) throw new BadRequest('Choose the department or central company.');
    const reason = String(input.reason ?? '').trim().slice(0, 300);
    if (reason.length < 3) throw new BadRequest('Give the reason (a few words is enough).');
    const until = this.untilOf(input.until);
    return this.oneAtATime(async (tx) => {
      const users = await this.people(tx);
      const pick = (v: unknown, what: string) => {
        if (v == null || v === '') return null;
        const u = users.find((x) => x.id === String(v));
        if (!u) throw new NotFound(what);
        if (u.role !== 'pwvsb_officer') throw new BadRequest(`The ${what.toLowerCase()} must be central office staff.`);
        return u;
      };
      const head = pick(input.headId, 'Head');
      const deputy = pick(input.deputyId, 'Deputy');
      if ((head && head.id === user.id) || (deputy && deputy.id === user.id)) throw new AccessDenied('hr.monitor', '(nobody names themselves; another of the CEO or HR Director does)');
      if (head && deputy && head.id === deputy.id) throw new BadRequest('The head and the deputy must be different people.');
      const id = `head-${unit}`;
      const at = this.now();
      const row: OrgLine = { id, kind: 'head', unit, headId: head?.id ?? null, deputyId: deputy?.id ?? null, until: head || deputy ? until : null, reason, by: user.name, byId: user.id, at };
      const before = await tx.get('orgLines', id);
      // P138 (office): the database store refuses an update that names the row's id; send the fields only.
      if (before) await tx.update('orgLines', id, withoutId(row));
      else await tx.insert('orgLines', row);
      await tx.audit({
          at,
          actor: user.name,
          companyId: null,
          action: 'org.head_set',
          entity: 'hr.monitor',
          entityId: id,
          summary: `${unitLabel(unit)}: head ${head?.name ?? 'not named'}, deputy ${deputy?.name ?? 'none'}${until ? `, until ${until}` : ''}. Reason: ${reason}`,
        });
      return row;
    });
  }
}

/** A row's fields without its id, for an update (the PostgreSQL store refuses a patch that names the id). */
function withoutId<T extends { id: unknown }>(row: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = row;
  return rest;
}
