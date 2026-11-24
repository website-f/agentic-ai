import { AccessDenied, accessClosed, isHrDirector } from './access';
import { sha256Hex } from './audit';
import { REGIONS } from './regions';
import { BadRequest } from './service';
import type { Store } from './store';
import { addDays, dateOf } from './time';
import type { AuthorityGrant, Id, IsoDate, IsoDateTime, User } from './types';

/**
 * Accounts and Access (Fauzan, 15 Nov 2026, "Build it now"). Until now Prima could not add an office sign-in or give
 * anyone access to a company: accounts came only from the built-in sample set, and guard sign-ins from a server script.
 * Here IT (the IT Manager, IT Lead or an IT Executive) or central HR prepares a request: new accounts, real names on
 * existing accounts, a Microsoft account link, a link to the person's HR record, and company access to add or end. The
 * HR Director (Chief of Staff or Deputy) or the CEO approves it with a comment, never their own request and never one
 * that touches their own account; the whole request then goes in at once, or none of it does. Changes to a leader's
 * account (Chairman, Vice Chairman, Finance Director, Chief of Staff, Deputy, OGM, Operations Director, COO) need the
 * CEO. The CEO's own account and system feeds are never changed here. Closing access stays with offboarding.
 *
 * On PostgreSQL the app role still may not write accounts or grants: approving calls prima.apply_account_request
 * (module accounts-access-v1), which checks the same rules again in the database before it writes.
 */

/** The kinds of account this screen may create. Leaders' accounts are never created here (they exist already). */
export interface AccountTemplate {
  key: string;
  label: string;
  /** The fixed fields every account of this kind carries. */
  shape: Partial<User> & { role: User['role'] };
  /** 'office': belongs to one company (company office staff). 'central': a PWVSB department, company access by grants. */
  where: 'office' | 'central';
  /** Extra choices this kind needs. */
  needs?: ('financeTeam' | 'actTeam' | 'opsSector' | 'areaStates' | 'regionIds')[];
}

const C = (key: string, label: string, shape: Partial<User>, needs?: AccountTemplate['needs']): AccountTemplate => ({
  key,
  label,
  shape: { role: 'pwvsb_officer', ...shape } as AccountTemplate['shape'],
  where: 'central',
  ...(needs ? { needs } : {}),
});

export const ACCOUNT_TEMPLATES: AccountTemplate[] = [
  { key: 'company_manager', label: 'Company manager or GM (company office)', shape: { role: 'company_manager' }, where: 'office' },
  { key: 'admin_exec', label: 'Admin executive (company office)', shape: { role: 'admin_exec' }, where: 'office' },
  C('ops_om', 'Operations Manager (OM)', { department: 'operations', opsTier: 'om' }, ['opsSector', 'areaStates', 'regionIds']),
  C('ops_regional', 'Regional Operations Manager', { department: 'operations', opsTier: 'regional' }, ['opsSector', 'regionIds']),
  C('ops_staff', 'Operations staff (head office)', { department: 'operations' }),
  C('hr', 'HR staff', { department: 'hr' }),
  C('it_manager', 'IT Manager', { department: 'it', itRole: 'manager' }),
  C('it_lead', 'IT Lead', { department: 'it', itRole: 'lead' }),
  C('it_executive', 'IT Executive', { department: 'it', itRole: 'executive' }),
  C('finance_staff', 'Finance staff (no team)', { department: 'finance' }),
  C('finance_leader', 'Finance team leader', { department: 'finance', financeRole: 'leader' }, ['financeTeam']),
  C('finance_deputy', 'Finance team deputy', { department: 'finance', financeRole: 'deputy' }, ['financeTeam']),
  C('finance_data_entry', 'Finance data entry', { department: 'finance', financeRole: 'data_entry' }, ['financeTeam']),
  // D1 (Fauzan, 23 Nov 2026): below the FD, does what the FD delegates. Needs module finance-account-manager-v1.
  C('finance_account_manager', 'Finance Account Manager', { department: 'finance', financeAccountManager: true }),
  C('fwm_manager', 'FWM Manager', { department: 'fwm', fwmRole: 'manager' }),
  C('fwm_deputy', 'FWM Deputy Manager', { department: 'fwm', fwmRole: 'deputy' }),
  C('fwm_executive', 'FWM Executive', { department: 'fwm', fwmRole: 'executive' }),
  C('fwm_despatch', 'FWM driver cum despatch', { department: 'fwm', fwmRole: 'despatch' }),
  C('proc_manager', 'Inventory Manager', { department: 'procurement', procRole: 'manager' }),
  C('proc_executive', 'Procurement executive', { department: 'procurement', procRole: 'executive' }),
  C('proc_storekeeper', 'Storekeeper', { department: 'procurement', procRole: 'storekeeper' }),
  C('act_manager', 'ACT Manager', { department: 'audit', actRole: 'manager' }),
  C('act_auditor', 'ACT Auditor', { department: 'audit', actRole: 'auditor' }, ['actTeam']),
  C('act_enforcement', 'ACT Enforcement officer', { department: 'audit', actRole: 'enforcement' }, ['actTeam']),
  C('arms_control', 'Arms Control', { department: 'arms_control' }),
  C('cms', 'CMS command centre', { department: 'cms' }),
  C('transport', 'Transport', { department: 'transport' }),
  C('pdpa', 'PDPA office', { department: 'pdpa' }),
  C('legal', 'Legal', { department: 'legal' }),
  C('director_office', 'Director Office (DOA)', { department: 'director_office' }),
  C('asset_staff', 'Asset Management staff', { department: 'asset' }),
  // Marketing (Fauzan, 22-23 Nov 2026). In the database these three come with module marketing-accounts-v1.
  C('marketing_manager', 'Marketing Manager', { department: 'marketing', marketingRole: 'manager' }),
  C('marketing_deputy', 'Deputy Marketing Manager', { department: 'marketing', marketingRole: 'deputy' }),
  C('marketing_executive', 'Tender Executive (Marketing)', { department: 'marketing', marketingRole: 'executive' }),
  C('cos_office', 'Chief of Staff office staff', { department: 'chief_of_staff' }),
];

/** Account fields a request may set besides the kind's fixed shape. Everything else stays as it is. */
export const ACCOUNT_FREE_FIELDS = ['id', 'name', 'title', 'companyIds', 'siteIds', 'personId', 'entraOid', 'directoryId', 'accountRequestId', 'financeTeam', 'actTeam', 'opsSector', 'areaStates', 'regionIds'] as const;
/** What a change to an existing account may touch. */
export const ACCOUNT_PATCH_FIELDS = ['name', 'title', 'entraOid', 'personId'] as const;

/** A leader's account: only the CEO approves a change to it. */
export function leaderAccount(u: User): boolean {
  return u.role === 'director' || !!u.leadership || ['ogm', 'ops_director', 'coo', 'ceo'].includes(u.opsTier ?? '');
}

export interface AccessLine {
  companyId: Id;
  scope: 'monitor' | 'act';
}

export interface AccountCreateItem {
  op: 'create';
  template: string;
  name: string;
  title: string;
  /** Company office kinds: the one company. */
  companyId: Id | null;
  access: AccessLine[];
  financeTeam?: number;
  actTeam?: 1 | 2;
  opsSector?: 'government' | 'private';
  areaStates?: string[];
  regionIds?: string[];
  personId: Id | null;
  entraOid: string | null;
  directoryId: Id | null;
  /** Filled when approved. */
  userId?: Id;
}

export interface AccountUpdateItem {
  op: 'update';
  userId: Id;
  /** The account as it was when the request was prepared (shown to the approver). */
  before: { name: string; title: string };
  name: string | null;
  title: string | null;
  entraOid: string | null;
  personId: Id | null;
  addAccess: AccessLine[];
  endAccess: Id[];
}

export type AccountItem = AccountCreateItem | AccountUpdateItem;

export interface AccountRequest {
  id: Id;
  items: AccountItem[];
  /** Why the preparer asks (for example: Sasa office staff starting 18 Nov). */
  reason: string;
  /** Company access added by this request ends on this day unless renewed (at most 3 years). */
  accessUntil: IsoDate;
  preparedById: Id;
  preparedBy: string;
  preparedAt: IsoDateTime;
  status: 'waiting' | 'approved' | 'returned';
  decidedById: Id | null;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  comment: string;
  /** Set in the same step as the approval, when the accounts and grants were written. */
  applied: { at: IsoDateTime; users: Id[]; grants: Id[]; ended: Id[] } | null;
}

const MAX_ITEMS = 200;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const tidy = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const STATES = [...new Set(REGIONS.flatMap((r) => r.states))];

export function accountRoles(u: User | undefined, today: IsoDate) {
  const open = !!u && !u.integration && u.role !== 'site_device' && u.role !== 'guard' && !accessClosed(u, today);
  const it = open && u!.role === 'pwvsb_officer' && u!.department === 'it' && ['manager', 'lead', 'executive'].includes(u!.itRole ?? '');
  const hr = open && u!.role === 'pwvsb_officer' && u!.department === 'hr';
  const director = open && isHrDirector(u!);
  const ceo = open && (u!.role === 'director' || u!.role === 'pwvsb_officer') && u!.opsTier === 'ceo';
  return { view: it || hr || director || ceo, prepare: it || hr, approve: director || ceo, ceo, hr, it };
}

/** The account a create item becomes, exactly as written to the database. */
export function accountFor(item: AccountCreateItem, requestId: Id, n: number): User {
  const t = ACCOUNT_TEMPLATES.find((x) => x.key === item.template)!;
  const u: User = {
    ...(t.shape as User),
    id: `u-acc-${requestId.slice(4, 16)}-${n}`,
    name: item.name,
    title: item.title,
    companyIds: t.where === 'office' && item.companyId ? [item.companyId] : [],
    siteIds: [],
    accountRequestId: requestId,
  };
  if (item.personId) u.personId = item.personId;
  if (item.entraOid) u.entraOid = item.entraOid;
  if (item.directoryId) u.directoryId = item.directoryId;
  if (t.needs?.includes('financeTeam')) u.financeTeam = item.financeTeam;
  if (t.needs?.includes('actTeam')) u.actTeam = item.actTeam;
  if (t.needs?.includes('opsSector') && item.opsSector) u.opsSector = item.opsSector;
  if (t.needs?.includes('areaStates')) u.areaStates = item.areaStates ?? [];
  if (t.needs?.includes('regionIds')) u.regionIds = item.regionIds ?? [];
  return u;
}

export class AccountsAccessService {
  constructor(
    private readonly store: Store,
    private readonly clock: () => IsoDateTime,
  ) {}

  private today() {
    return dateOf(this.clock());
  }

  private async ready(tx: Store = this.store) {
    if (tx.hasTable && !(await tx.hasTable('accountRequests')))
      throw new BadRequest('Accounts and Access is not installed in this database yet (module accounts-access-v1).');
  }

  private async actor(user: User, tx: Store = this.store) {
    const u = await tx.get('users', user.id);
    const r = accountRoles(u, this.today());
    if (!u || !r.view) throw new AccessDenied('view', '(Accounts and Access: IT, HR, the HR Director and the CEO only)');
    return { u, r };
  }

  /** What the screen shows: the requests, every person's account and company access, and who still has no account. */
  async board(user: User) {
    await this.ready();
    const { u, r } = await this.actor(user);
    const today = this.today();
    const [requests, users, grants, companies] = await Promise.all([
      this.store.list('accountRequests', {}),
      this.store.list('users', {}),
      this.store.list('grants', {}),
      companyList(this.store),
    ]);
    const live = (g: AuthorityGrant) => g.validFrom <= today && g.validTo >= today;
    const accounts = users
      .filter((x) => !x.integration && x.role !== 'site_device' && x.role !== 'guard')
      .map((x) => ({
        id: x.id,
        name: x.name,
        title: x.title,
        role: x.role,
        department: x.department ?? null,
        kind: ACCOUNT_TEMPLATES.find((t) => shapeMatches(x, t))?.label ?? (leaderAccount(x) ? 'Leader' : 'Other'),
        leader: leaderAccount(x),
        companyIds: x.companyIds,
        linked: !!x.entraOid,
        hrRecord: !!x.personId,
        closedFrom: x.accessClosedFrom ?? null,
        fromRequest: x.accountRequestId ?? null,
        mayChange: x.opsTier !== 'ceo' && x.id !== u.id,
        access: grants.filter((g) => g.userId === x.id && live(g)).map((g) => ({ id: g.id, companyId: g.companyId, scope: g.scope, validTo: g.validTo })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Staff directory lines with no account yet (when the directory is installed and this person may read it).
    let directory: { id: Id; name: string; title: string; orgUnit: string; companyId: Id | null; email: string }[] = [];
    try {
      if (!this.store.hasTable || (await this.store.hasTable('staffDirectory'))) {
        const taken = new Set(users.map((x) => x.directoryId).filter(Boolean));
        directory = (await this.store.list('staffDirectory', {}))
          .filter((e) => !taken.has(e.id))
          .map((e) => ({ id: e.id, name: e.name, title: e.title, orgUnit: e.orgUnit, companyId: e.companyId, email: e.email }));
      }
    } catch {
      directory = [];
    }
    // Office staff HR records with no account, for HR (IT never reads HR records).
    let people: { id: Id; name: string; staffNo: string; companyId: Id }[] = [];
    if (r.hr || r.approve) {
      const withAccount = new Set(users.map((x) => x.personId).filter(Boolean));
      people = (await this.store.list('people', {}))
        .filter((p) => p.role === 'office' && !withAccount.has(p.id) && p.status !== 'left')
        .map((p) => ({ id: p.id, name: p.name, staffNo: p.staffNo, companyId: p.companyId }));
    }
    return {
      me: { prepare: r.prepare, approve: r.approve, ceo: r.ceo },
      templates: ACCOUNT_TEMPLATES.map((t) => ({ key: t.key, label: t.label, where: t.where, needs: t.needs ?? [] })),
      regions: REGIONS.map((x) => ({ id: x.id, name: x.name })),
      states: STATES,
      companies: companies.map((c) => ({ id: c.id, code: c.code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
      accounts,
      directory,
      people,
      requests: requests
        .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt))
        .slice(0, 100)
        .map((q) => ({
          ...q,
          mayDecide: r.approve && q.status === 'waiting' && q.preparedById !== u.id && !this.touchesSelf(q, u) && (r.ceo || !this.touchesLeader(q, users)),
        })),
    };
  }

  private touchesSelf(q: AccountRequest, u: User) {
    return q.items.some((i) => i.op === 'update' && i.userId === u.id) || (!!u.personId && q.items.some((i) => i.personId === u.personId));
  }

  private touchesLeader(q: AccountRequest, users: User[]) {
    return q.items.some((i) => i.op === 'update' && leaderAccount(users.find((x) => x.id === i.userId) ?? ({} as User)));
  }

  /** Check and clean every item. Throws with every problem listed by line. */
  private async check(tx: Store, raw: unknown[], me: User, self: Id | null = null) {
    if (!Array.isArray(raw) || raw.length < 1) throw new BadRequest('Add at least one line.');
    if (raw.length > MAX_ITEMS) throw new BadRequest(`At most ${MAX_ITEMS} lines in one request.`);
    const [users, grants, companies, waiting] = await Promise.all([
      tx.list('users', {}),
      tx.list('grants', {}),
      companyList(tx),
      tx.list('accountRequests', {}).then((all) => all.filter((q) => q.status === 'waiting' && q.id !== self)),
    ]);
    const companyIds = new Set(companies.map((c) => c.id));
    const today = this.today();
    const errors: string[] = [];
    const items: AccountItem[] = [];
    const seen = { oid: new Set<string>(), person: new Set<string>(), dir: new Set<string>(), user: new Set<string>() };
    const busy = (pred: (i: AccountItem) => boolean) => waiting.some((q) => q.items.some(pred));
    const name = (v: unknown, what: string, line: number, min: number) => {
      const t = tidy(v);
      if (t.length < min || t.length > 160 || CONTROL.test(String(v ?? ''))) errors.push(`Line ${line}: ${what} must be ${min} to 160 characters.`);
      return t;
    };
    const access = (v: unknown, line: number): AccessLine[] => {
      if (v == null) return [];
      if (!Array.isArray(v) || v.length > 60) {
        errors.push(`Line ${line}: company access must be a list of at most 60 companies.`);
        return [];
      }
      const out: AccessLine[] = [];
      for (const a of v as Record<string, unknown>[]) {
        const companyId = typeof a?.companyId === 'string' ? a.companyId : '';
        const scope = a?.scope === 'act' ? 'act' : a?.scope === 'monitor' ? 'monitor' : null;
        if (!companyIds.has(companyId)) errors.push(`Line ${line}: company ${companyId || '(none)'} is not in the company list.`);
        else if (!scope) errors.push(`Line ${line}: choose "act" or "monitor" for ${companyId}.`);
        else if (out.some((x) => x.companyId === companyId)) errors.push(`Line ${line}: ${companyId} is listed twice.`);
        else out.push({ companyId, scope });
      }
      return out;
    };
    const oidOf = (v: unknown, line: number, userId: Id | null) => {
      if (v == null || v === '') return null;
      const oid = String(v).trim().toLowerCase();
      if (!GUID.test(oid)) errors.push(`Line ${line}: the Microsoft object ID must be a GUID (from the Entra admin centre).`);
      else if (users.some((x) => x.entraOid?.toLowerCase() === oid && x.id !== userId)) errors.push(`Line ${line}: that Microsoft account is already linked to another Prima account.`);
      else if (seen.oid.has(oid) || busy((i) => i.entraOid === oid)) errors.push(`Line ${line}: that Microsoft account is already in this or another waiting request.`);
      seen.oid.add(oid);
      return oid;
    };
    const personOf = async (v: unknown, line: number, userId: Id | null) => {
      if (v == null || v === '') return null;
      const id = String(v);
      const p = await tx.get('people', id);
      if (!p || p.role !== 'office') errors.push(`Line ${line}: HR record ${id} is not an office staff record HR can see.`);
      else if (users.some((x) => x.personId === id && x.id !== userId)) errors.push(`Line ${line}: HR record ${p.staffNo} already has an account.`);
      else if (seen.person.has(id) || busy((i) => i.personId === id)) errors.push(`Line ${line}: HR record ${p.staffNo} is already in this or another waiting request.`);
      else if (me.personId === id) errors.push(`Line ${line}: you cannot prepare your own account.`);
      seen.person.add(id);
      return id;
    };
    for (const [n, x] of (raw as Record<string, unknown>[]).entries()) {
      const line = n + 1;
      if (!x || typeof x !== 'object') {
        errors.push(`Line ${line} is empty.`);
        continue;
      }
      if (x.op === 'create') {
        const t = ACCOUNT_TEMPLATES.find((k) => k.key === x.template);
        if (!t) {
          errors.push(`Line ${line}: choose the kind of account.`);
          continue;
        }
        const item: AccountCreateItem = {
          op: 'create',
          template: t.key,
          name: name(x.name, 'the name', line, 3),
          title: name(x.title, 'the job title', line, 2),
          companyId: null,
          access: access(x.access, line),
          personId: await personOf(x.personId, line, null),
          entraOid: oidOf(x.entraOid, line, null),
          directoryId: null,
        };
        if (t.where === 'office') {
          const c = typeof x.companyId === 'string' ? x.companyId : '';
          if (!companyIds.has(c)) errors.push(`Line ${line}: choose the company this person works for.`);
          else item.companyId = c;
          if (item.access.length) errors.push(`Line ${line}: company office staff see their own company only; leave other company access empty.`);
        } else if (!item.access.length) errors.push(`Line ${line}: give at least one company this person may see (act or monitor).`);
        if (t.needs?.includes('financeTeam')) {
          const ft = Number(x.financeTeam);
          if (!Number.isInteger(ft) || ft < 1 || ft > 7) errors.push(`Line ${line}: choose the Finance team (1 to 7).`);
          else item.financeTeam = ft;
        }
        if (t.needs?.includes('actTeam')) {
          if (x.actTeam !== 1 && x.actTeam !== 2) errors.push(`Line ${line}: choose ACT team 1 or 2.`);
          else item.actTeam = x.actTeam;
        }
        if (t.needs?.includes('opsSector')) {
          if (x.opsSector != null && x.opsSector !== '' && x.opsSector !== 'government' && x.opsSector !== 'private') errors.push(`Line ${line}: the side is government or private.`);
          else if (x.opsSector) item.opsSector = x.opsSector as 'government' | 'private';
        }
        if (t.needs?.includes('regionIds')) {
          const r = Array.isArray(x.regionIds) ? (x.regionIds as unknown[]).map(String) : [];
          if (!r.length || r.some((id) => !REGIONS.some((g) => g.id === id))) errors.push(`Line ${line}: choose the region(s) covered.`);
          item.regionIds = [...new Set(r)];
        }
        if (t.needs?.includes('areaStates')) {
          const s = Array.isArray(x.areaStates) ? (x.areaStates as unknown[]).map(String) : [];
          if (!s.length || s.some((st) => !STATES.includes(st))) errors.push(`Line ${line}: choose the state(s) the OM covers.`);
          item.areaStates = [...new Set(s)];
        }
        if (x.directoryId != null && x.directoryId !== '') {
          const d = String(x.directoryId);
          if (users.some((u) => u.directoryId === d)) errors.push(`Line ${line}: that staff directory line already has an account.`);
          else if (seen.dir.has(d) || busy((i) => i.op === 'create' && i.directoryId === d)) errors.push(`Line ${line}: that staff directory line is already in this or another waiting request.`);
          seen.dir.add(d);
          item.directoryId = d;
        }
        items.push(item);
        continue;
      }
      if (x.op === 'update') {
        const id = typeof x.userId === 'string' ? x.userId : '';
        const target = users.find((u) => u.id === id);
        if (!target || target.integration || target.role === 'site_device' || target.role === 'guard') {
          errors.push(`Line ${line}: choose an office staff account.`);
          continue;
        }
        if (target.opsTier === 'ceo') errors.push(`Line ${line}: the CEO's own account is not changed from inside Prima.`);
        if (target.id === me.id) errors.push(`Line ${line}: you cannot prepare a change to your own account.`);
        if (accessClosed(target, today)) errors.push(`Line ${line}: ${target.name}'s access is closed.`);
        if (seen.user.has(id) || busy((i) => i.op === 'update' && i.userId === id)) errors.push(`Line ${line}: ${target.name} is already in this or another waiting request.`);
        seen.user.add(id);
        const item: AccountUpdateItem = {
          op: 'update',
          userId: id,
          before: { name: target.name, title: target.title },
          name: x.name == null || x.name === '' ? null : name(x.name, 'the name', line, 3),
          title: x.title == null || x.title === '' ? null : name(x.title, 'the job title', line, 2),
          entraOid: oidOf(x.entraOid, line, id),
          personId: await personOf(x.personId, line, id),
          addAccess: access(x.addAccess, line),
          endAccess: [],
        };
        if (item.entraOid && target.entraOid) errors.push(`Line ${line}: ${target.name} is already linked to a Microsoft account; IT unlinks it first (entra:link --unlink).`);
        if (item.personId && target.personId) errors.push(`Line ${line}: ${target.name} is already joined to an HR record.`);
        const mine = grants.filter((g) => g.userId === id && g.validTo >= today);
        for (const a of item.addAccess)
          if (mine.some((g) => g.companyId === a.companyId)) errors.push(`Line ${line}: ${target.name} already has access to ${a.companyId}; end it first to change act or monitor.`);
        if (target.role !== 'pwvsb_officer' && item.addAccess.length) errors.push(`Line ${line}: company office staff see their own company only.`);
        const ends = Array.isArray(x.endAccess) ? (x.endAccess as unknown[]).map(String) : [];
        for (const g of ends) {
          if (!mine.some((m) => m.id === g)) errors.push(`Line ${line}: access ${g} is not a current access of ${target.name}.`);
          else if (!item.endAccess.includes(g)) item.endAccess.push(g);
        }
        if (!item.name && !item.title && !item.entraOid && !item.personId && !item.addAccess.length && !item.endAccess.length) errors.push(`Line ${line}: nothing to change for ${target.name}.`);
        items.push(item);
        continue;
      }
      errors.push(`Line ${line}: choose "new account" or "change an account".`);
    }
    if (errors.length) throw new BadRequest(errors.slice(0, 40).join(' '));
    return items;
  }

  /** IT or central HR sends a request for approval. */
  async submit(user: User, input: { items: unknown; reason: unknown; accessUntil?: unknown }) {
    return this.store.transaction(async (tx) => {
      await this.ready(tx);
      await tx.lock?.('accountRequests', 'accounts');
      const { u, r } = await this.actor(user, tx);
      if (!r.prepare) throw new AccessDenied('view', '(Accounts and Access: IT or HR prepares a request)');
      const reason = tidy(input.reason);
      if (reason.length < 3 || reason.length > 500) throw new BadRequest('Say why (3 to 500 characters), for example: Sasa office staff starting 18 Nov.');
      const today = this.today();
      const until = typeof input.accessUntil === 'string' && input.accessUntil ? input.accessUntil : addDays(today, 365);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today || until > addDays(today, 3 * 366)) throw new BadRequest('Company access may run from tomorrow to at most 3 years ahead.');
      const items = await this.check(tx, input.items as unknown[], u);
      const at = this.clock();
      const all = await tx.list('accountRequests', {});
      const id = `acc-${sha256Hex(JSON.stringify(items) + at + u.id).slice(0, 12)}-${all.length + 1}`;
      const row: AccountRequest = {
        id,
        items,
        reason,
        accessUntil: until,
        preparedById: u.id,
        preparedBy: u.name,
        preparedAt: at,
        status: 'waiting',
        decidedById: null,
        decidedBy: null,
        decidedAt: null,
        comment: '',
        applied: null,
      };
      await tx.insert('accountRequests', row);
      const creates = items.filter((i) => i.op === 'create').length;
      await tx.audit({
        at,
        actor: u.name,
        companyId: null,
        action: 'accounts.request.submit',
        entity: 'account_request',
        entityId: id,
        summary: `Accounts and Access request sent for approval: ${creates} new account(s), ${items.length - creates} change(s). ${reason}`.slice(0, 900),
      });
      return { id, lines: items.length };
    });
  }

  /** The HR Director or the CEO approves (everything goes in at once) or returns a waiting request, with a comment. */
  async decide(user: User, input: { requestId: unknown; approve: unknown; comment: unknown }) {
    return this.store.transaction(async (tx) => {
      await this.ready(tx);
      await tx.lock?.('accountRequests', 'accounts');
      const { u, r } = await this.actor(user, tx);
      if (!r.approve) throw new AccessDenied('view', '(Accounts and Access: only the HR Director or the CEO approves)');
      const q = typeof input.requestId === 'string' ? await tx.get('accountRequests', input.requestId) : undefined;
      if (!q) throw new BadRequest('Request not found.');
      if (q.status !== 'waiting') throw new BadRequest(`This request was already ${q.status}.`);
      if (q.preparedById === u.id) throw new BadRequest('Someone other than the person who prepared the request decides it.');
      if (this.touchesSelf(q, u)) throw new BadRequest('This request changes your own account; someone else decides it.');
      const users = await tx.list('users', {});
      if (!r.ceo && this.touchesLeader(q, users)) throw new BadRequest("This request changes a leader's account; the CEO decides it.");
      const comment = tidy(input.comment);
      if (comment.length < 3 || comment.length > 500) throw new BadRequest('Give a comment (3 to 500 characters).');
      const at = this.clock();
      const approve = input.approve === true;
      if (approve) {
        // Check every line again against the accounts as they are now: someone may have changed them meanwhile.
        const preparer = users.find((x) => x.id === q.preparedById) ?? u;
        await this.check(tx, q.items.map(rawOf), preparer, q.id);
      }
      await tx.update('accountRequests', q.id, { status: approve ? 'approved' : 'returned', decidedById: u.id, decidedBy: u.name, decidedAt: at, comment });
      let applied: AccountRequest['applied'] = null;
      if (approve) applied = tx.applyAccountRequest ? await tx.applyAccountRequest(q.id) : await applyInStore(tx, { ...q, status: 'approved', decidedById: u.id }, at, this.today());
      await tx.audit({
        at,
        actor: u.name,
        companyId: null,
        action: `accounts.request.${approve ? 'approved' : 'returned'}`,
        entity: 'account_request',
        entityId: q.id,
        summary: approve
          ? `Accounts and Access request from ${q.preparedBy} approved: ${applied!.users.length} account(s) made, ${q.items.length - applied!.users.length} changed, ${applied!.grants.length} company access added, ${applied!.ended.length} ended. Comment: ${comment}`.slice(0, 900)
          : `Accounts and Access request from ${q.preparedBy} returned. Comment: ${comment}`.slice(0, 900),
      });
      return { id: q.id, status: approve ? 'approved' : 'returned', applied };
    });
  }

  async act(user: User, action: string, i: Record<string, unknown>) {
    switch (action) {
      case 'submit':
        return this.submit(user, { items: i.items, reason: i.reason, accessUntil: i.accessUntil });
      case 'decide':
        return this.decide(user, { requestId: i.requestId, approve: i.approve, comment: i.comment });
      default:
        throw new BadRequest('Unknown Accounts and Access action.');
    }
  }
}

/** Every company's id, code and name (the database store reads them through prima.acc_companies). */
async function companyList(s: Store): Promise<{ id: Id; code: string; name: string }[]> {
  if (s.accountCompanies) return s.accountCompanies();
  return (await s.list('companies', {})).map((c) => ({ id: c.id, code: c.code, name: c.name }));
}

/** A stored item back in the shape a request sends, so it can be checked again at approval. */
function rawOf(i: AccountItem): Record<string, unknown> {
  if (i.op === 'create') return { ...i };
  return { ...i, name: i.name ?? '', title: i.title ?? '' };
}

/** Whether an account carries exactly the fixed fields of a kind. */
export function shapeMatches(u: User, t: AccountTemplate): boolean {
  const other = ['base', 'monthlySalary', 'homeCompanyId', 'branchId', 'accessClosedFrom', 'accessClosed', 'dutyEnrollment'];
  const rest = Object.fromEntries(Object.entries(u).filter(([k, v]) => !(ACCOUNT_FREE_FIELDS as readonly string[]).includes(k) && !other.includes(k) && v !== undefined && v !== null));
  const want = t.shape as Record<string, unknown>;
  return Object.keys(rest).length === Object.keys(want).length && Object.entries(want).every(([k, v]) => rest[k] === v);
}

/** The demonstration and test store's version of prima.apply_account_request. */
async function applyInStore(tx: Store, q: AccountRequest, at: IsoDateTime, today: IsoDate): Promise<NonNullable<AccountRequest['applied']>> {
  const out = { at, users: [] as Id[], grants: [] as Id[], ended: [] as Id[] };
  let g = 0;
  const grant = async (userId: Id, a: AccessLine) => {
    g += 1;
    const id = `gr-acc-${q.id.slice(4, 16)}-${g}`;
    await tx.insert('grants', { id, userId, companyId: a.companyId, scope: a.scope, basis: `Accounts and Access ${q.id}`, validFrom: today, validTo: q.accessUntil });
    out.grants.push(id);
  };
  for (const [n, i] of q.items.entries()) {
    if (i.op === 'create') {
      const u = accountFor(i, q.id, n + 1);
      await tx.insert('users', u);
      out.users.push(u.id);
      for (const a of i.access) await grant(u.id, a);
    } else {
      const patch: Partial<User> = {};
      if (i.name) patch.name = i.name;
      if (i.title) patch.title = i.title;
      if (i.entraOid) patch.entraOid = i.entraOid;
      if (i.personId) patch.personId = i.personId;
      if (Object.keys(patch).length) await tx.update('users', i.userId, patch);
      for (const a of i.addAccess) await grant(i.userId, a);
      for (const id of i.endAccess) {
        const cur = await tx.get('grants', id);
        if (cur) await tx.update('grants', id, { validTo: addDays(today, -1) < cur.validFrom ? cur.validFrom : addDays(today, -1) });
        out.ended.push(id);
      }
    }
  }
  await tx.update('accountRequests', q.id, { applied: out });
  return out;
}
