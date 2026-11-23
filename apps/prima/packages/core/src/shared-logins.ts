import { AccessDenied, CENTRAL_EMPLOYER_IDS, centralEmployerName, isGroupLeader } from "./access";
import { UNIT_HEAD_KEYS, unitHeadsOf } from "./unit-heads";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { addDays, dateOf, daysBetween } from "./time";
import type { Id, IsoDate, IsoDateTime, User } from "./types";
import { registerWall } from "./walls";

/**
 * Shared login list (Fauzan, 23 Nov 2026: "Prepare also password key vault so password are kept so each person wont
 * forgot password and it safe", "Wider as a whole", then "Now build" on the Microsoft-Premium-first plan).
 *
 * Prima keeps ONLY the list: which shared login exists, for which company or central department, who owns it, who the
 * backup is, who may use it, where the password is kept and when it was last changed. Prima NEVER holds a password,
 * a PIN, a token or a recovery code: those stay in the Microsoft shared-login tile (My Apps) or in the vault. The AI
 * helpers are never given this list.
 *
 * The list does not give or remove access by itself: IT sets the Microsoft group or the vault folder by hand. A row
 * saying "Microsoft tile" is a record of where the password is kept, never a claim that Microsoft is connected.
 */
export const SHARED_LOGIN_PLACES = ['microsoft_tile', 'vault', 'own_account'] as const;
export type SharedLoginPlace = (typeof SHARED_LOGIN_PLACES)[number];
export const SHARED_LOGIN_PLACE_LABEL: Record<SharedLoginPlace, string> = {
  microsoft_tile: 'Microsoft shared-login tile (My Apps)',
  vault: 'Password vault',
  own_account: 'Each person has their own login (no shared password)',
};

/** The kind of portal, so the group view can show which usual portals a company has no login for yet. */
export const SHARED_LOGIN_KINDS = ['ssm', 'lhdn', 'einvoice', 'kwsp', 'perkeso', 'hrdc', 'mysst', 'kdn', 'bank', 'ewallet', 'eperolehan', 'tender_portal', 'other'] as const;
export type SharedLoginKind = (typeof SHARED_LOGIN_KINDS)[number];
export const SHARED_LOGIN_KIND_LABEL: Record<SharedLoginKind, string> = {
  ssm: 'SSM',
  lhdn: 'LHDN MyTax',
  einvoice: 'LHDN e-Invoice (MyInvois)',
  kwsp: 'KWSP / EPF',
  perkeso: 'PERKESO / SOCSO',
  hrdc: 'HRD Corp',
  mysst: 'Customs MySST (sales and service tax)',
  kdn: 'KDN eSIMS',
  bank: 'Bank',
  ewallet: 'E-wallet',
  eperolehan: 'ePerolehan',
  tender_portal: 'Buyer tender or vendor portal',
  other: 'Other',
};

/**
 * Kinds of portal IT or the CEO can add or change in the app (Fauzan, 23 Nov 2026: "Make sure it have add button to
 * add anything more"). A row here changes a built-in kind's name or whether every company must have it, or adds a new
 * kind (for example a state land office or a client portal). Turned-off kinds stay on the old logins; nothing is deleted.
 */
export const SHARED_LOGIN_USUAL = ['none', 'every', 'security'] as const;
export type SharedLoginUsual = (typeof SHARED_LOGIN_USUAL)[number];
export interface SharedLoginKindRow {
  /** The kind's key: a built-in key, or one made from the name of a new kind. */
  id: string;
  label: string;
  /** Must every company have one ('every'), only the security companies ('security'), or no company ('none')? */
  usual: SharedLoginUsual;
  active: boolean;
  updatedBy: string;
  updatedAt: IsoDateTime;
}
export interface SharedLoginKindView {
  key: string;
  label: string;
  usual: SharedLoginUsual;
  active: boolean;
  builtIn: boolean;
  /** Bank and e-wallet logins also name the provider and the last 4 digits of each account. */
  money: boolean;
}
/** Built-in kinds with the usual list from rule SHARED-LOGIN-PORTALS, then the rows IT or the CEO saved. */
export function mergeSharedLoginKinds(rows: SharedLoginKindRow[]): SharedLoginKindView[] {
  const usual = RULES.sharedLoginPortals.value;
  const out = new Map<string, SharedLoginKindView>();
  for (const k of SHARED_LOGIN_KINDS)
    out.set(k, { key: k, label: SHARED_LOGIN_KIND_LABEL[k], usual: usual.everyCompany.includes(k) ? 'every' : usual.securityCompany.includes(k) ? 'security' : 'none', active: true, builtIn: true, money: k === 'bank' || k === 'ewallet' });
  for (const r of rows) {
    const base = out.get(r.id);
    out.set(r.id, { key: r.id, label: r.label, usual: r.usual, active: r.id === 'other' ? true : r.active, builtIn: !!base, money: base?.money ?? false });
  }
  return [...out.values()];
}

/** A central department's logins, or the CEO's master accounts (seen and kept by the CEO only). */
export const SHARED_LOGIN_MASTER = 'ceo_master';
export const SHARED_LOGIN_DEPARTMENTS = [
  'finance', 'hr', 'fwm', 'it', 'procurement', 'transport', 'arms_control', 'asset', 'audit', 'operations', 'cms',
  'chief_of_staff', 'director_office', 'pdpa', 'legal', 'marketing', SHARED_LOGIN_MASTER,
] as const;
export type SharedLoginDepartment = (typeof SHARED_LOGIN_DEPARTMENTS)[number];

/** The kinds of login Marketing uses to lodge tenders (Marketing item AH10, Fauzan 23 Nov 2026). */
export const TENDER_LOGIN_KINDS: readonly string[] = ['eperolehan', 'tender_portal'];

export interface SharedLoginPerson {
  id: Id;
  name: string;
}

export interface SharedLogin {
  id: Id;
  /** The system, in plain words: "SSM e-Info", "KDN eSIMS", "Maybank2E (maker)". */
  system: string;
  /** The kind of portal (older rows without one count as "other"). */
  kind?: string;
  /**
   * Bank and e-wallet logins (Fauzan, 23 Nov 2026: "each company have a lot of bank account and e wallet account"): the
   * bank or e-wallet provider, and the LAST 4 DIGITS of each account or wallet this login reaches. Never a full number.
   */
  provider?: string | null;
  accounts?: string[];
  /** The sign-in page, https only. */
  url: string | null;
  /** Exactly one of these two: a company's login, or a central department's. */
  companyId: Id | null;
  department: SharedLoginDepartment | null;
  place: SharedLoginPlace;
  owner: SharedLoginPerson;
  backup: SharedLoginPerson;
  /** Who holds the phone or token that receives the second-step code, if the portal uses one. */
  twoFa: SharedLoginPerson | null;
  /** Everyone else who may use it. */
  users: SharedLoginPerson[];
  /** Ids of everyone named on the row: the database row rule reads this. */
  people: Id[];
  /** The day the password was last changed. Null for "own login" rows: there is no shared password. */
  lastChanged: IsoDate | null;
  /**
   * Set when a person who has left is taken off the row (IT names a new owner or backup) before the password was
   * changed: the leaver still knows it, so the change stays due until it is recorded.
   */
  changeAfter?: { since: IsoDate; names: string[] } | null;
  note: string;
  status: 'active' | 'closed';
  changes: { at: IsoDateTime; by: string; byId: Id; date: IsoDate; reason: string }[];
  createdBy: string;
  createdAt: IsoDateTime;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

const isIt = (u: User) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'it';
const isCeo = (u: User) => !u.integration && u.opsTier === 'ceo';
const isCentralHr = (u: User) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'hr';

/** IT keeps the list (adds, edits, closes); the CEO may do the same and alone keeps the master accounts. */
export function keepsSharedLogins(user: User): boolean {
  return isIt(user) || isCeo(user);
}
/** The whole list, master accounts apart: IT (sets it up), central HR (leaving steps) and the group leaders. */
export function seesAllSharedLogins(user: User): boolean {
  return !user.integration && (isIt(user) || isCentralHr(user) || isGroupLeader(user));
}
/** A Company Manager sees the logins of their own company. */
export function seesCompanySharedLogins(user: User): boolean {
  return !user.integration && user.role === 'company_manager';
}
/**
 * The head of a central department, or of a central company that is not a security company, sees that department's or
 * company's logins, as a Company Manager does for a company (review, 23 Nov 2026: "whole company wide"). Who heads what
 * comes from unitHeadsOf: the job on the sign-in, or the head named in the organisation chart.
 */
export function sharedLoginHeadOf(user: User): string[] {
  return unitHeadsOf(user);
}
registerWall('shared_login_keep', keepsSharedLogins);
registerWall('shared_login_all', seesAllSharedLogins);
registerWall('shared_login_company', seesCompanySharedLogins);
registerWall('shared_login_master', isCeo);
// One wall per head, named after the department or company it covers, so the database row rule can read it.
for (const k of UNIT_HEAD_KEYS) registerWall(`shared_login_head_${k}`, (u) => sharedLoginHeadOf(u).includes(k));

/** Who may be named on a login: office staff only. Guards, site supervisors, site devices and system feeds are not. */
export function mayBeOnSharedLogin(u: User): boolean {
  return !u.integration && ['director', 'pwvsb_officer', 'company_manager', 'admin_exec'].includes(u.role);
}

/** Words that mean someone is typing a secret into the list. Refused, so the list never becomes the vault. */
const SECRET = /(pass\s*word|pass\s*code|kata\s*laluan|\bpwd\b|\bpin\b|\botp\b|\btac\b|recovery\s*code|kod\s*pemulihan)\s*(is|ialah|adalah)?\s*[:=-]/i;

function text(v: unknown, field: string, min: number, max: number): string {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < min) throw new BadRequest(`${field} is needed.`);
  if (s.length > max) throw new BadRequest(`${field} is too long (at most ${max} characters).`);
  if (SECRET.test(s)) throw new BadRequest('Never type a password, PIN or code here. Prima keeps only the list; the password stays in the Microsoft tile or the vault.');
  return s;
}

function day(v: unknown, field: string): IsoDate {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new BadRequest(`${field} must be a date.`);
  return s;
}

/** The n-th working day after a date (Saturday and Sunday are skipped; public holidays are not counted). */
export function workingDaysAfter(d: IsoDate, n: number): IsoDate {
  let out = d;
  for (let left = n; left > 0; ) {
    out = addDays(out, 1);
    const dow = new Date(`${out}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return out;
}

/**
 * The five central companies (PWVSB, Merdeka Network, Goodwill Empire, Sasa Team, Perfect Global Logistics) are not
 * among the 38 security companies but have their own SSM, LHDN, EPF and bank logins: they are on the pick list too.
 */
function withCentral(list: { id: Id; code: string; name: string }[]): { id: Id; code: string; name: string }[] {
  const have = new Set(list.map((c) => c.id));
  const central = CENTRAL_EMPLOYER_IDS.filter((id) => !have.has(id)).map((id) => ({ id, code: id.toUpperCase(), name: centralEmployerName(id) ?? id }));
  return [...list, ...central];
}

export type SharedLoginState = 'ok' | 'due_soon' | 'overdue' | 'leaver' | 'leaver_late' | 'closed';

export class SharedLoginService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
  ) {}

  private async ready() {
    if (this.store.hasTable && !(await this.store.hasTable('sharedLogins')))
      throw new BadRequest('The shared login list is not installed in this database yet (module shared-logins-v1).');
  }

  /** The kinds of portal: built-in ones and the ones IT or the CEO added or changed. */
  async kinds(): Promise<SharedLoginKindView[]> {
    const rows = this.store.hasTable && !(await this.store.hasTable('sharedLoginKinds')) ? [] : await this.store.list('sharedLoginKinds', {});
    return mergeSharedLoginKinds(rows);
  }

  private sees(user: User, r: SharedLogin): boolean {
    if (user.integration) return false;
    if (r.department === SHARED_LOGIN_MASTER) return isCeo(user);
    if (seesAllSharedLogins(user)) return true;
    if (r.people.includes(user.id)) return true;
    const heads = sharedLoginHeadOf(user);
    if ((r.department && heads.includes(`d_${r.department}`)) || (r.companyId && heads.includes(`c_${r.companyId}`))) return true;
    return seesCompanySharedLogins(user) && !!r.companyId && user.companyIds.includes(r.companyId);
  }

  private mayKeep(user: User, r: Pick<SharedLogin, 'department'>): boolean {
    return r.department === SHARED_LOGIN_MASTER ? isCeo(user) : keepsSharedLogins(user);
  }

  /** The owner, the backup, or whoever keeps the list records that the password was changed. */
  private mayRecord(user: User, r: SharedLogin): boolean {
    return r.status === 'active' && r.place !== 'own_account' && (this.mayKeep(user, r) || r.owner.id === user.id || r.backup.id === user.id);
  }

  private state(r: SharedLogin, today: IsoDate, leftOn: Map<Id, IsoDate>): { state: SharedLoginState; nextDue: IsoDate | null; leavers: string[]; changeBy: IsoDate | null } {
    if (r.status === 'closed') return { state: 'closed', nextDue: null, leavers: [], changeBy: null };
    const rule = RULES.sharedLogin.value;
    // A person who left on or after the day of the last change still knows the password (or still sits on the list):
    // change it. Recording the change takes leavers off the row, so the same day does not flag it twice.
    const gone = [r.owner, r.backup, ...(r.twoFa ? [r.twoFa] : []), ...r.users]
      .map((p) => ({ p, left: leftOn.get(p.id) }))
      .filter((x): x is { p: SharedLoginPerson; left: IsoDate } => !!x.left && x.left <= today);
    const stale = r.place === 'own_account' ? gone : gone.filter((x) => !r.lastChanged || x.left >= r.lastChanged);
    const owed = r.place !== 'own_account' ? r.changeAfter : null;
    const leavers = [...new Set([...stale.map((x) => x.p.name), ...(owed?.names ?? [])])];
    const nextDue = r.lastChanged && r.place !== 'own_account' ? addDays(r.lastChanged, rule.changeDays) : null;
    if (leavers.length) {
      const first = [...stale.map((x) => x.left), ...(owed ? [owed.since] : [])].sort()[0]!;
      const changeBy = workingDaysAfter(first, rule.leaverWorkingDays);
      return { state: today > changeBy ? 'leaver_late' : 'leaver', nextDue, leavers, changeBy };
    }
    if (!nextDue) return { state: 'ok', nextDue: null, leavers, changeBy: null };
    if (today > nextDue) return { state: 'overdue', nextDue, leavers, changeBy: nextDue };
    if (daysBetween(today, nextDue) <= rule.remindDays) return { state: 'due_soon', nextDue, leavers, changeBy: nextDue };
    return { state: 'ok', nextDue, leavers, changeBy: nextDue };
  }

  private async leftOn(): Promise<Map<Id, IsoDate>> {
    const out = new Map<Id, IsoDate>();
    for (const u of await this.store.list('users', {})) if (u.accessClosedFrom) out.set(u.id, u.accessClosedFrom);
    return out;
  }

  private async companies(user: User): Promise<{ id: Id; code: string; name: string }[]> {
    // IT usually sees no company itself: the Accounts and Access module's own function gives the names. A failed
    // query would end the database transaction, so ask first whether that module is installed.
    if (this.store.accountCompanies && keepsSharedLogins(user) && (!this.store.hasTable || (await this.store.hasTable('accountRequests'))))
      return withCentral(await this.store.accountCompanies());
    return withCentral((await this.store.list('companies', {})).map((c) => ({ id: c.id, code: c.code, name: c.name })));
  }

  async board(user: User) {
    if (!mayBeOnSharedLogin(user)) throw new AccessDenied('view', 'the shared login list (office staff only)');
    await this.ready();
    const today = dateOf(this.now());
    const leftOn = await this.leftOn();
    const companies = await this.companies(user);
    const coName = new Map(companies.map((c) => [c.id, c.name]));
    const rows = (await this.store.list('sharedLogins', {}))
      .filter((r) => this.sees(user, r))
      .map((r) => ({
        ...r,
        companyName: r.companyId ? (coName.get(r.companyId) ?? r.companyId) : null,
        ...this.state(r, today, leftOn),
        mayEdit: this.mayKeep(user, r),
        mayRecord: this.mayRecord(user, r),
      }))
      .sort((a, b) => (a.companyName ?? `~${a.department}`).localeCompare(b.companyName ?? `~${b.department}`) || a.system.localeCompare(b.system));
    const keeps = keepsSharedLogins(user);
    // Group-wide view (review, 23 Nov 2026): every company and central department, with how many logins it has on
    // the list and how many need a change now, so a company or department with none listed stands out.
    const live = rows.filter((r) => r.status === 'active');
    const kinds = await this.kinds();
    const usual = {
      everyCompany: kinds.filter((k) => k.active && k.usual === 'every').map((k) => k.key),
      securityCompany: kinds.filter((k) => k.active && k.usual === 'security').map((k) => k.key),
    };
    // The company bank accounts Finance keeps (what this person may read of it): each should be reached by a bank login.
    const finBanks = new Map<Id, { bank: string; last4: string }[]>();
    for (const f of await this.store.list('finStatus', {}).catch(() => []))
      finBanks.set(f.companyId, (f.banks ?? []).map((b) => ({ bank: b.bank, last4: b.accountMasked.replace(/\D/g, '').slice(-4) })));
    const tally = (pick: (r: (typeof rows)[number]) => boolean, expected: string[] = []) => {
      const mine = live.filter(pick);
      const have = new Set(mine.map((r) => r.kind ?? 'other'));
      return {
        logins: mine.length,
        needAction: mine.filter((r) => r.state === 'overdue' || r.state === 'leaver' || r.state === 'leaver_late').length,
        // The usual portals (rule SHARED-LOGIN-PORTALS) this company has no login for yet.
        missing: expected.filter((k) => !have.has(k)),
        bankLogins: mine.filter((r) => r.kind === 'bank').length,
        walletLogins: mine.filter((r) => r.kind === 'ewallet').length,
      };
    };
    // Finance's bank accounts for a company that no bank login on the list reaches (same last 4 digits).
    const unreached = (companyId: Id) => {
      const known = finBanks.get(companyId);
      if (!known) return null;
      const reached = new Set(live.filter((r) => r.companyId === companyId && r.kind === 'bank').flatMap((r) => r.accounts ?? []));
      return { total: known.length, noLogin: known.filter((b) => !reached.has(b.last4)).map((b) => `${b.bank} ••${b.last4}`) };
    };
    // The group view: everything for IT, HR and the leaders; a Company Manager gets the same view for their own companies.
    const whole = seesAllSharedLogins(user) || keeps;
    // Marketing item AH10: the Tender Executives who cover a company (their company access lines) should be named on
    // that company's tender portal logins, so they can lodge. Shown to those who see the whole list.
    const today2 = today;
    const coverers = new Map<Id, SharedLoginPerson[]>();
    if (whole) {
      const marketing = new Map((await this.store.list('users', {})).filter((u) => !u.integration && !u.accessClosedFrom && u.department === 'marketing' && u.marketingRole === 'executive').map((u) => [u.id, u]));
      for (const g of await this.store.list('grants', {})) {
        const u = marketing.get(g.userId);
        if (!u || g.validFrom > today2 || g.validTo < today2) continue;
        const list = coverers.get(g.companyId) ?? [];
        if (!list.some((p) => p.id === u.id)) list.push({ id: u.id, name: u.name });
        coverers.set(g.companyId, list);
      }
    }
    const tenderCheck = (companyId: Id) => {
      const cover = coverers.get(companyId) ?? [];
      const logins = live.filter((r) => r.companyId === companyId && TENDER_LOGIN_KINDS.includes(r.kind ?? ''));
      const named = new Set(logins.flatMap((r) => r.people));
      return { tenderLogins: logins.length, tenderStaffNotNamed: logins.length ? cover.filter((p) => !named.has(p.id)).map((p) => p.name) : cover.map((p) => p.name) };
    };
    const ownCompanies = !whole && seesCompanySharedLogins(user);
    const coverage = whole || ownCompanies
      ? [
          ...companies.filter((c) => whole || user.companyIds.includes(c.id)).map((c) => {
            const central = CENTRAL_EMPLOYER_IDS.includes(c.id);
            return { key: `c:${c.id}`, kind: 'company' as const, name: c.name, central, ...tally((r) => r.companyId === c.id, [...usual.everyCompany, ...(central ? [] : usual.securityCompany)]), bankAccounts: unreached(c.id), ...(whole ? tenderCheck(c.id) : { tenderLogins: null, tenderStaffNotNamed: [] as string[] }) };
          }),
          ...SHARED_LOGIN_DEPARTMENTS.filter((d) => whole && (d !== SHARED_LOGIN_MASTER || isCeo(user))).map((d) => ({ key: `d:${d}`, kind: 'department' as const, name: d, central: true, ...tally((r) => r.department === d), bankAccounts: null, tenderLogins: null, tenderStaffNotNamed: [] as string[] })),
        ]
      : [];
    return {
      today,
      coverage,
      usualPortals: usual.everyCompany,
      securityPortals: usual.securityCompany,
      kinds,
      mayKinds: keeps,
      rule: RULES.sharedLogin.value,
      mayAdd: keeps,
      mayMaster: isCeo(user),
      mayLeaverList: seesAllSharedLogins(user),
      rows,
      // The pick lists, only for those who keep the list.
      companies: keeps ? companies : [],
      // IT writes to the audit log without a company: IT usually sees no company itself.
      people: keeps
        ? (await this.store.list('users', {}))
            .filter((u) => mayBeOnSharedLogin(u) && !(u.accessClosedFrom && u.accessClosedFrom <= today))
            .map((u) => ({ id: u.id, name: u.name, title: u.title }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    };
  }

  private async person(id: unknown, field: string, today: IsoDate): Promise<SharedLoginPerson> {
    const u = id ? await this.store.get('users', String(id)) : undefined;
    if (!u || !mayBeOnSharedLogin(u)) throw new BadRequest(`${field}: choose an office staff member.`);
    if (u.accessClosedFrom && u.accessClosedFrom <= today) throw new BadRequest(`${field}: ${u.name} has left; choose someone else.`);
    return { id: u.id, name: u.name };
  }

  /** Add a login to the list, or change its details. Never a password. */
  async save(user: User, input: Record<string, unknown>) {
    if (user.integration || !keepsSharedLogins(user)) throw new AccessDenied('view', 'keeping the shared login list (IT keeps it; the CEO keeps the master accounts)');
    await this.ready();
    const at = this.now();
    const today = dateOf(at);
    const system = text(input.system, 'The name of the system', 2, 80);
    const rawUrl = String(input.url ?? '').trim();
    let url: string | null = null;
    if (rawUrl) {
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw new BadRequest('The web address is not valid.');
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new BadRequest('The web address must start with https:// and hold no user name or password.');
      url = `${parsed.origin}${parsed.pathname}`.slice(0, 200);
    }
    const companyId = input.companyId ? String(input.companyId) : null;
    const department = input.department ? (String(input.department) as SharedLoginDepartment) : null;
    if ((companyId ? 1 : 0) + (department ? 1 : 0) !== 1) throw new BadRequest('Choose a company or a central department, not both.');
    if (department && !SHARED_LOGIN_DEPARTMENTS.includes(department)) throw new BadRequest('Choose a department from the list.');
    if (department === SHARED_LOGIN_MASTER && !isCeo(user)) throw new AccessDenied('view', 'the master accounts (the CEO only)');
    if (companyId && !(await this.companies(user)).some((c) => c.id === companyId)) throw new BadRequest('Choose a company from the list.');
    const kind = input.kind ? String(input.kind) : 'other';
    const kindOf = (await this.kinds()).find((k) => k.key === kind);
    const was = input.id ? await this.store.get('sharedLogins', String(input.id).slice(0, 80)) : undefined;
    // A kind turned off is not offered for new logins; a login that already has it keeps it.
    if (!kindOf || (!kindOf.active && was?.kind !== kind)) throw new BadRequest('Choose the kind of portal from the list.');
    const money = kindOf.money;
    const provider = money ? text(input.provider, kind === 'bank' ? 'The bank' : 'The e-wallet provider', 2, 60) : null;
    const accounts = money ? [...new Set((Array.isArray(input.accounts) ? input.accounts : []).map((a) => String(a).trim()))] : [];
    if (accounts.some((a) => !/^\d{4}$/.test(a))) throw new BadRequest('Give only the last 4 digits of each account or wallet, never the full number.');
    if (accounts.length > 50) throw new BadRequest('At most 50 accounts on one login.');
    if (money && accounts.length === 0) throw new BadRequest(`Give the last 4 digits of at least one ${kind === 'bank' ? 'bank account' : 'wallet'} this login reaches.`);
    const place = String(input.place ?? '') as SharedLoginPlace;
    if (!SHARED_LOGIN_PLACES.includes(place)) throw new BadRequest('Say where the password is kept.');
    const owner = await this.person(input.ownerId, 'Owner', today);
    const backup = await this.person(input.backupId, 'Backup', today);
    if (backup.id === owner.id) throw new BadRequest('The backup must be a different person from the owner.');
    const twoFa = input.twoFaId ? await this.person(input.twoFaId, 'Holder of the second-step phone', today) : null;
    const userIds = [...new Set((Array.isArray(input.userIds) ? input.userIds : []).map(String))].filter((x) => x !== owner.id && x !== backup.id);
    if (userIds.length > RULES.sharedLogin.value.maxUsers) throw new BadRequest(`At most ${RULES.sharedLogin.value.maxUsers} other users on one login; ask for one login per person instead.`);
    const users: SharedLoginPerson[] = [];
    for (const x of userIds) users.push(await this.person(x, 'User', today));
    const note = input.note ? text(input.note, 'The note', 0, 300) : '';
    const lastChanged = place === 'own_account' ? null : day(input.lastChanged, 'The day the password was last changed');
    if (lastChanged && lastChanged > today) throw new BadRequest('The day the password was last changed cannot be in the future.');
    const people = [...new Set([owner.id, backup.id, ...(twoFa ? [twoFa.id] : []), ...users.map((u) => u.id)])];
    const body = { system, kind, provider, accounts, url, companyId, department, place, owner, backup, twoFa, users, people, note, updatedBy: user.name, updatedAt: at };
    const id = input.id ? String(input.id).slice(0, 80) : null;
    return this.store.transaction(async (tx) => {
      const same = (await tx.list('sharedLogins', {})).find(
        (r) => r.id !== id && r.status === 'active' && r.companyId === companyId && r.department === department && r.system.toLowerCase() === system.toLowerCase(),
      );
      if (same) throw new BadRequest(`${system} is already on the list for this company or department.`);
      if (!id) {
        const newId = `slg-${Date.parse(at).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const row: SharedLogin = { id: newId, ...body, lastChanged, status: 'active', changes: [], createdBy: user.name, createdAt: at };
        await tx.insert('sharedLogins', row);
        await tx.audit({ at, actor: user.name, companyId: null, action: 'shared_login.added', entity: 'shared_login', entityId: newId, summary: `${system} added to the shared login list (owner ${owner.name}, backup ${backup.name}, ${users.length} other users). No password is held.` });
        return row;
      }
      await tx.lock?.('sharedLogins', id);
      const r = await tx.get('sharedLogins', id);
      if (!r) throw new NotFound('Shared login');
      if (!this.mayKeep(user, r)) throw new AccessDenied('view', 'the master accounts (the CEO only)');
      if (r.status === 'closed') throw new BadRequest('This login is closed. Add it again if it is back in use.');
      if ((r.companyId ?? null) !== companyId || (r.department ?? null) !== department) throw new BadRequest('A login stays with its company or department. Close it and add it again to move it.');
      // The last-changed day moves only through "password changed", so the history stays true.
      // A leaver taken off the row still knows the password: keep the change due until it is recorded.
      const leftOn = await this.leftOn();
      const off = [r.owner, r.backup, ...(r.twoFa ? [r.twoFa] : []), ...r.users]
        .filter((p) => !people.includes(p.id))
        .map((p) => ({ p, left: leftOn.get(p.id) }))
        .filter((x): x is { p: SharedLoginPerson; left: IsoDate } => !!x.left && x.left <= today && (!r.lastChanged || x.left >= r.lastChanged));
      const changeAfter =
        place === 'own_account'
          ? null
          : off.length
            ? { since: [...off.map((x) => x.left), ...(r.changeAfter ? [r.changeAfter.since] : [])].sort()[0]!, names: [...new Set([...(r.changeAfter?.names ?? []), ...off.map((x) => x.p.name)])].slice(0, 30) }
            : (r.changeAfter ?? null);
      // The company never changes (checked above), and the database store refuses a patch that names it.
      const { companyId: _same, ...rest } = body;
      const patch = { ...rest, changeAfter, lastChanged: place === 'own_account' ? null : (r.lastChanged ?? lastChanged) };
      await tx.update('sharedLogins', id, patch);
      const was = new Set(r.people);
      const added = people.filter((p) => !was.has(p)).length;
      const removed = r.people.filter((p) => !people.includes(p)).length;
      await tx.audit({ at, actor: user.name, companyId: null, action: 'shared_login.changed', entity: 'shared_login', entityId: id, summary: `${system} changed on the shared login list (owner ${owner.name}, backup ${backup.name}; ${added} added, ${removed} removed).` });
      return { ...r, ...patch };
    });
  }

  /** The owner, the backup or IT records that the password was changed (the day and why). */
  async recordChange(user: User, input: Record<string, unknown>) {
    if (user.integration) throw new AccessDenied('view', 'the shared login list');
    await this.ready();
    const id = String(input.id ?? '').slice(0, 80);
    const at = this.now();
    const today = dateOf(at);
    const date = day(input.date ?? today, 'The day it was changed');
    const reason = text(input.reason, 'The reason', 3, 200);
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sharedLogins', id);
      const r = await tx.get('sharedLogins', id);
      if (!r || !this.sees(user, r)) throw new NotFound('Shared login');
      if (!this.mayRecord(user, r)) throw new AccessDenied('view', 'recording a password change (the owner, the backup or IT)');
      if (date > today) throw new BadRequest('The day it was changed cannot be in the future.');
      if (r.lastChanged && date < r.lastChanged) throw new BadRequest(`It was last changed on ${r.lastChanged}; the new day cannot be earlier.`);
      // Leavers come off the row when the change is recorded: they no longer know the password.
      const leftOn = await this.leftOn();
      const gone = (p: SharedLoginPerson) => !!leftOn.get(p.id) && leftOn.get(p.id)! <= today;
      if (gone(r.owner) || gone(r.backup)) throw new BadRequest('The owner or the backup has left. Ask IT to name a new one first, then record the change.');
      const users = r.users.filter((p) => !gone(p));
      const twoFa = r.twoFa && gone(r.twoFa) ? null : r.twoFa;
      const people = [...new Set([r.owner.id, r.backup.id, ...(twoFa ? [twoFa.id] : []), ...users.map((u) => u.id)])];
      const patch = { lastChanged: date, changeAfter: null, users, twoFa, people, changes: [...r.changes, { at, by: user.name, byId: user.id, date, reason }].slice(-20), updatedBy: user.name, updatedAt: at };
      await tx.update('sharedLogins', id, patch);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'shared_login.password_changed', entity: 'shared_login', entityId: id, summary: `Password change recorded for ${r.system} on ${date}: ${reason}` });
      return { ...r, ...patch };
    });
  }

  /** A login no longer in use is closed with a reason; nothing is deleted. */
  async close(user: User, input: Record<string, unknown>) {
    if (user.integration || !keepsSharedLogins(user)) throw new AccessDenied('view', 'keeping the shared login list');
    await this.ready();
    const id = String(input.id ?? '').slice(0, 80);
    const reason = text(input.reason, 'The reason', 3, 200);
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('sharedLogins', id);
      const r = await tx.get('sharedLogins', id);
      if (!r) throw new NotFound('Shared login');
      if (!this.mayKeep(user, r)) throw new AccessDenied('view', 'the master accounts (the CEO only)');
      if (r.status === 'closed') throw new BadRequest('This login is already closed.');
      const patch = { status: 'closed' as const, note: `${r.note ? `${r.note} ` : ''}Closed: ${reason}`.slice(0, 300), updatedBy: user.name, updatedAt: at };
      await tx.update('sharedLogins', id, patch);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'shared_login.closed', entity: 'shared_login', entityId: id, summary: `${r.system} closed on the shared login list: ${reason}` });
      return { ...r, ...patch };
    });
  }

  /** Leaving steps: every shared login a person is named on, so the owner changes each password. */
  async leaverList(user: User, personId: Id) {
    if (!seesAllSharedLogins(user)) throw new AccessDenied('view', 'the shared logins of a person who is leaving (HR, IT and the group leaders)');
    await this.ready();
    return (await this.store.list('sharedLogins', {}))
      .filter((r) => r.status === 'active' && this.sees(user, r) && r.people.includes(personId))
      .map((r) => ({ id: r.id, system: r.system, companyId: r.companyId, department: r.department, place: r.place, owner: r.owner.name, backup: r.backup.name, as: r.owner.id === personId ? 'owner' : r.backup.id === personId ? 'backup' : r.twoFa?.id === personId ? 'second-step phone' : 'user' }));
  }

  /** Home: what the owner or the backup must change, and what IT must re-assign. */
  async homeItems(user: User) {
    if (user.integration) return [];
    if (this.store.hasTable && !(await this.store.hasTable('sharedLogins'))) return [];
    const today = dateOf(this.now());
    const leftOn = await this.leftOn();
    const rows = (await this.store.list('sharedLogins', {})).filter((r) => r.status === 'active' && this.sees(user, r));
    const mine = rows.filter((r) => r.owner.id === user.id || r.backup.id === user.id).map((r) => ({ r, s: this.state(r, today, leftOn) }));
    const out: { tone: 'warn' | 'crit'; tag: string; title: string; detail: string; go: { view: 'shared-logins' } }[] = [];
    const late = mine.filter((x) => x.s.state === 'overdue' || x.s.state === 'leaver_late' || x.s.state === 'leaver');
    const soon = mine.filter((x) => x.s.state === 'due_soon');
    const names = (xs: typeof mine) => xs.slice(0, 3).map((x) => x.r.system).join(' · ');
    if (late.length) out.push({ tone: 'crit', tag: 'Logins', title: `${late.length} shared password(s) to change now`, detail: names(late), go: { view: 'shared-logins' } });
    if (soon.length) out.push({ tone: 'warn', tag: 'Logins', title: `${soon.length} shared password(s) to change within ${RULES.sharedLogin.value.remindDays} days`, detail: names(soon), go: { view: 'shared-logins' } });
    if (keepsSharedLogins(user)) {
      const orphan = rows.filter((r) => [r.owner, r.backup].some((p) => !!leftOn.get(p.id) && leftOn.get(p.id)! <= today));
      if (orphan.length) out.push({ tone: 'crit', tag: 'Logins', title: `${orphan.length} shared login(s) need a new owner or backup`, detail: orphan.slice(0, 3).map((r) => r.system).join(' · '), go: { view: 'shared-logins' } });
    }
    return out;
  }

  /**
   * IT or the CEO adds a kind of portal, or changes one: its name, whether every company (or every security company)
   * must have a login for it, or turns it off. The list of logins is not changed.
   */
  async saveKind(user: User, input: Record<string, unknown>) {
    if (user.integration || !keepsSharedLogins(user)) throw new AccessDenied('view', 'the kinds of portal (IT and the CEO keep them)');
    await this.ready();
    if (this.store.hasTable && !(await this.store.hasTable('sharedLoginKinds'))) throw new BadRequest('The kinds of portal are not installed in this database yet (module shared-logins-v1).');
    const at = this.now();
    const label = text(input.label, 'The name of the kind of portal', 2, 60);
    const usual = String(input.usual ?? 'none') as SharedLoginUsual;
    if (!SHARED_LOGIN_USUAL.includes(usual)) throw new BadRequest('Say which companies must have it: every company, the security companies, or none.');
    const active = input.active === undefined ? true : input.active === true;
    const kinds = await this.kinds();
    let key = input.key ? String(input.key).slice(0, 30) : '';
    if (key) {
      if (!kinds.some((k) => k.key === key)) throw new NotFound('Kind of portal');
    } else {
      key = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').slice(0, 30).replace(/^_+|_+$/g, '');
      if (key.length < 2) throw new BadRequest('Give the kind of portal a name with letters or numbers.');
      if (kinds.some((k) => k.key === key || k.label.toLowerCase() === label.toLowerCase())) throw new BadRequest(`${label} is already a kind of portal.`);
    }
    if (kinds.some((k) => k.key !== key && k.label.toLowerCase() === label.toLowerCase())) throw new BadRequest(`${label} is already a kind of portal.`);
    if (key === 'other' && (!active || usual !== 'none')) throw new BadRequest('"Other" always stays on and no company must have it.');
    const row: SharedLoginKindRow = { id: key, label, usual, active, updatedBy: user.name, updatedAt: at };
    return this.store.transaction(async (tx) => {
      const old = await tx.get('sharedLoginKinds', key);
      if (old) await tx.update('sharedLoginKinds', key, row);
      else await tx.insert('sharedLoginKinds', row);
      const who = usual === 'every' ? 'every company must have one' : usual === 'security' ? 'every security company must have one' : 'no company must have one';
      await tx.audit({ at, actor: user.name, companyId: null, action: old ? 'shared_login.kind_changed' : 'shared_login.kind_added', entity: 'shared_login_kind', entityId: key, summary: `Kind of portal ${label} ${old || kinds.some((k) => k.key === key) ? 'changed' : 'added'}: ${who}${active ? '' : '; turned off for new logins'}.` });
      return mergeSharedLoginKinds([row]).find((k) => k.key === key)!;
    });
  }

  async act(user: User, action: string, input: Record<string, unknown>) {
    if (action === 'save') return this.save(user, input);
    if (action === 'kind') return this.saveKind(user, input);
    if (action === 'changed') return this.recordChange(user, input);
    if (action === 'close') return this.close(user, input);
    throw new BadRequest('Unknown action');
  }
}
