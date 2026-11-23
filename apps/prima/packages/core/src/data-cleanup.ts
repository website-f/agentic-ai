import { AccessDenied, isGroupLeader } from './access';
import { RULES } from './rules';
import type { Store } from './store';
import type { Company, Contract, Id, IsoDate, Person, Post, Site, User } from './types';

/**
 * Data clean-up checker (Part AG, AG15; Fauzan, 23 Nov 2026: "Use system more than ai"). Data collection runs to about
 * 18 January 2027, and wrong or doubled records entered now carry into pay, rosters and billing. These fixed rules look
 * for duplicates, gaps and clashes in staff, site and contract records. No AI is used and nothing is changed: each
 * finding names the record by its number only (staff number, site code or contract reference), says what is wrong and
 * how to fix it, and the company office that owns the record corrects it in the usual form. A finding clears by itself
 * once the record is right. It reads the records as they are now, so it is always as fresh as a nightly run.
 *
 * Who sees what: the company office (company manager, admin executives, director) sees its own companies; central HR
 * sees staff findings in every company (HR governs HR in every company); the group leaders and ACT see everything.
 */

export type CleanupArea = 'staff' | 'site' | 'contract';
export type CleanupLevel = 'fix' | 'check';

export interface CleanupFinding {
  /** Stable for the same problem on the same record, so a list can be compared from day to day. */
  id: string;
  rule: string;
  area: CleanupArea;
  /** 'fix': the record is wrong. 'check': it may be right, but someone must look (for example a person in two companies). */
  level: CleanupLevel;
  companyId: Id;
  companyCode: string;
  /** The record by its number only: never a name, IC or phone. */
  record: string;
  /** Other records in the same problem, also by number only (for example the other company's staff number). */
  with: string[];
  what: string;
  fix: string;
}

export const DATA_CLEANUP_RULES: Record<string, { area: CleanupArea; level: CleanupLevel; what: string; fix: string }> = {
  'STAFF-TWO-COMPANIES': { area: 'staff', level: 'check', what: 'The same person (name, date of birth and IC) is active in two companies at once.', fix: 'If the person moved, mark the old record as left. A move is a fresh employment; one person is active in one company only.' },
  'STAFF-TWICE': { area: 'staff', level: 'fix', what: 'The same person is entered twice in this company.', fix: 'Keep one record and mark the other as left with the reason "entered twice".' },
  'STAFF-NUMBER-TWICE': { area: 'staff', level: 'fix', what: 'Two people in this company have the same staff number.', fix: 'Give one of them their correct staff number.' },
  'STAFF-NO-START': { area: 'staff', level: 'fix', what: 'The start date is missing or not a real date.', fix: 'Enter the day the person started work, from the offer letter or first payslip.' },
  'STAFF-START-BEFORE-18': { area: 'staff', level: 'fix', what: 'The start date is before the person turned 18, or before the date of birth.', fix: 'Check the date of birth and the start date against the IC and the offer letter.' },
  'STAFF-NO-BIRTH': { area: 'staff', level: 'fix', what: 'The date of birth is missing or not a real date.', fix: 'Enter the date of birth from the IC or passport.' },
  'STAFF-NO-ID': { area: 'staff', level: 'fix', what: 'No IC or passport number is on record.', fix: 'HR enters the IC or passport number from the copy on file.' },
  'STAFF-NO-PHONE': { area: 'staff', level: 'fix', what: 'An active person has no phone number.', fix: 'Enter the phone number the person uses for work.' },
  'STAFF-GUARD-OVER-AGE': { area: 'staff', level: 'check', what: `An active guard is over ${RULES.maxGuardAge.value} (rule HR-AGE-MAX).`, fix: 'Check the date of birth. If it is right, HR decides the guard\'s next step.' },
  'STAFF-BRANCH': { area: 'staff', level: 'fix', what: 'The branch on the record does not belong to this company.', fix: 'Choose one of this company\'s own branches, or none.' },
  'SITE-NO-CONTRACT': { area: 'site', level: 'check', what: 'The site has no live contract.', fix: 'Link the site to its signed contract or letter of award in Contracts, or close the site if the work has ended.' },
  'SITE-CODE-TWICE': { area: 'site', level: 'fix', what: 'Two sites in this company have the same site code.', fix: 'Give one of them its correct code. If it is the same site, keep one.' },
  'SITE-NO-POST': { area: 'site', level: 'fix', what: 'The site has no guard post.', fix: 'Add the posts and guards per shift from the contract.' },
  'SITE-NO-PLACE': { area: 'site', level: 'fix', what: 'The site has no address or no map location.', fix: 'Enter the address and set the location on the map (clock-in uses it).' },
  'CONTRACT-END-BEFORE-START': { area: 'contract', level: 'fix', what: 'The contract ends before it starts.', fix: 'Correct the start and end dates from the signed contract.' },
  'CONTRACT-PAST-END': { area: 'contract', level: 'check', what: 'The contract\'s end date has passed but it is still open.', fix: 'Record the signed renewal, or end the contract.' },
  'CONTRACT-NO-SITE': { area: 'contract', level: 'fix', what: 'The contract has no site.', fix: 'Add the sites the contract covers.' },
  'CONTRACT-SITE-ELSEWHERE': { area: 'contract', level: 'fix', what: 'The contract lists a site that is missing or belongs to another company.', fix: 'Remove that site, or ask the right company to record its own contract.' },
  'CONTRACT-REF-TWICE': { area: 'contract', level: 'fix', what: 'Two contracts in this company have the same reference.', fix: 'Correct the reference, or keep one if they are the same contract.' },
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d: unknown): d is IsoDate => typeof d === 'string' && ISO.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const addYears = (d: IsoDate, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
const norm = (s: string | undefined | null) => (s ?? '').toLowerCase().replace(/\b(bin|binti|bt|b|a\/l|a\/p|al|ap)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const blank = (s: string | undefined | null) => !s || !s.replace(/[\s*-]/g, '');
const LIVE_CONTRACT: Contract['state'][] = ['awarded', 'mobilising', 'ready', 'active', 'suspended'];

export interface CleanupInput {
  companies: Company[];
  people: Person[];
  sites: Site[];
  posts: Post[];
  contracts: Contract[];
  branches: { id: Id; companyId: Id }[];
  today: IsoDate;
}

/** The rules themselves: pure, so the same answer comes from a test, the demo and the server. */
export function dataCleanupFindings(x: CleanupInput): CleanupFinding[] {
  const code = new Map(x.companies.map((c) => [c.id, c.code]));
  const out: CleanupFinding[] = [];
  const add = (rule: string, companyId: Id, record: string, withRecs: string[] = []) => {
    const r = DATA_CLEANUP_RULES[rule];
    out.push({ id: `${rule}:${companyId}:${record}`, rule, area: r.area, level: r.level, companyId, companyCode: code.get(companyId) ?? companyId, record, with: withRecs, what: r.what, fix: r.fix });
  };
  const staffNo = (p: Person) => p.staffNo || p.id;
  const groupBy = <T>(list: T[], key: (t: T) => string | null) => {
    const m = new Map<string, T[]>();
    for (const t of list) {
      const k = key(t);
      if (k) m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.values()].filter((g) => g.length > 1);
  };

  // Staff
  const active = x.people.filter((p) => p.status !== 'left');
  const branchCo = new Map(x.branches.map((b) => [b.id, b.companyId]));
  const same = (p: Person) => (norm(p.name) && realDate(p.dob) && !blank(p.idMasked) ? `${norm(p.name)}|${p.dob}|${p.idMasked.replace(/\s/g, '').toUpperCase()}` : null);
  for (const g of groupBy(active, same)) {
    const companies = new Set(g.map((p) => p.companyId));
    for (const p of g) {
      const others = g.filter((o) => o !== p);
      if (companies.size > 1) {
        const elsewhere = others.filter((o) => o.companyId !== p.companyId);
        if (elsewhere.length) add('STAFF-TWO-COMPANIES', p.companyId, staffNo(p), elsewhere.map((o) => `${code.get(o.companyId) ?? o.companyId} ${staffNo(o)}`));
      }
      const here = others.filter((o) => o.companyId === p.companyId);
      if (here.length) add('STAFF-TWICE', p.companyId, staffNo(p), here.map(staffNo));
    }
  }
  for (const g of groupBy(x.people, (p) => (p.staffNo ? `${p.companyId}|${p.staffNo.trim().toUpperCase()}` : null))) {
    if (new Set(g.map(same)).size === 1 && same(g[0])) continue; // the same person twice is STAFF-TWICE, said once
    add('STAFF-NUMBER-TWICE', g[0].companyId, g[0].staffNo, []);
  }
  for (const p of active) {
    const no = staffNo(p);
    const dobOk = realDate(p.dob);
    if (!dobOk) add('STAFF-NO-BIRTH', p.companyId, no);
    if (!realDate(p.hiredOn)) add('STAFF-NO-START', p.companyId, no);
    else if (dobOk && p.hiredOn < addYears(p.dob, 18)) add('STAFF-START-BEFORE-18', p.companyId, no);
    if (blank(p.idMasked)) add('STAFF-NO-ID', p.companyId, no);
    if (blank(p.phone)) add('STAFF-NO-PHONE', p.companyId, no);
    if (dobOk && p.role === 'guard' && p.status === 'active' && x.today >= addYears(p.dob, RULES.maxGuardAge.value + 1)) add('STAFF-GUARD-OVER-AGE', p.companyId, no);
    if (p.branchId && branchCo.has(p.branchId) && branchCo.get(p.branchId) !== p.companyId) add('STAFF-BRANCH', p.companyId, no);
  }

  // Sites
  const siteById = new Map(x.sites.map((s) => [s.id, s]));
  const endOf = (c: Contract) => [c.endOn, ...(c.renewals ?? []).map((r) => r.toEndOn)].filter(realDate).sort().pop() ?? null;
  const live = x.contracts.filter((c) => LIVE_CONTRACT.includes(c.state) && !c.endedOn && (endOf(c) ?? '9999') >= x.today);
  const covered = new Set(live.flatMap((c) => c.siteIds));
  const posted = new Set(x.posts.map((p) => p.siteId));
  for (const g of groupBy(x.sites, (s) => (s.code ? `${s.companyId}|${s.code.trim().toUpperCase()}` : null))) add('SITE-CODE-TWICE', g[0].companyId, g[0].code);
  for (const s of x.sites) {
    const no = s.code || s.id;
    if (!covered.has(s.id)) add('SITE-NO-CONTRACT', s.companyId, no);
    if (!posted.has(s.id)) add('SITE-NO-POST', s.companyId, no);
    if (blank(s.address) || !Number.isFinite(s.lat) || !Number.isFinite(s.lng) || (s.lat === 0 && s.lng === 0)) add('SITE-NO-PLACE', s.companyId, no);
  }

  // Contracts
  for (const g of groupBy(x.contracts, (c) => (c.ref ? `${c.companyId}|${c.ref.trim().toUpperCase()}` : null))) add('CONTRACT-REF-TWICE', g[0].companyId, g[0].ref);
  for (const c of x.contracts) {
    const no = c.ref || c.id;
    if (c.state === 'terminated' || c.endedOn) continue;
    if (realDate(c.startOn) && realDate(c.endOn) && c.endOn < c.startOn) add('CONTRACT-END-BEFORE-START', c.companyId, no);
    const end = endOf(c);
    if (end && end < x.today) add('CONTRACT-PAST-END', c.companyId, no);
    if (!c.siteIds.length) add('CONTRACT-NO-SITE', c.companyId, no);
    const wrong = c.siteIds.filter((id) => siteById.get(id)?.companyId !== c.companyId);
    if (wrong.length) add('CONTRACT-SITE-ELSEWHERE', c.companyId, no, wrong.map((id) => siteById.get(id)?.code ?? 'missing site'));
  }
  return out;
}

/** Central HR: staff findings in every company. */
const centralHr = (u: User) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'hr';
const companyOffice = (u: User) => !u.integration && (u.role === 'company_manager' || u.role === 'admin_exec' || u.role === 'director');
const everything = (u: User) => !u.integration && (isGroupLeader(u) || (u.role === 'pwvsb_officer' && u.department === 'audit'));

export function dataCleanupAllowed(u: User): boolean {
  return everything(u) || centralHr(u) || (companyOffice(u) && u.companyIds.length > 0);
}

/** Which findings this person may see. */
export function dataCleanupMaySee(u: User, f: Pick<CleanupFinding, 'area' | 'companyId'>): boolean {
  if (everything(u)) return true;
  if (companyOffice(u) && u.companyIds.includes(f.companyId)) return true;
  return centralHr(u) && f.area === 'staff';
}

export class DataCleanupService {
  constructor(private store: Store, private now: () => string) {}

  private async findings(): Promise<CleanupFinding[]> {
    const [companies, people, sites, posts, contracts, branches] = await Promise.all([
      this.store.list('companies', {}),
      this.store.list('people', {}),
      this.store.list('sites', {}),
      this.store.list('posts', {}),
      this.store.list('contracts', {}),
      this.store.list('branches', {}),
    ]);
    return dataCleanupFindings({ companies, people, sites, posts, contracts, branches, today: this.now().slice(0, 10) });
  }

  /** The list for one person, newest rules first by area, with counts. Records by number only. */
  async board(user: User, q: { companyId?: string; area?: string } = {}) {
    if (!dataCleanupAllowed(user)) throw new AccessDenied('view', '(data clean-up: company office, central HR, ACT and group leaders)');
    const all = (await this.findings()).filter((f) => dataCleanupMaySee(user, f));
    const companies = [...new Map(all.map((f) => [f.companyId, f.companyCode])).entries()].map(([id, code]) => ({ id, code, open: all.filter((f) => f.companyId === id).length })).sort((a, b) => b.open - a.open);
    const shown = all.filter((f) => (!q.companyId || f.companyId === q.companyId) && (!q.area || f.area === q.area));
    const byRule = Object.entries(DATA_CLEANUP_RULES)
      .map(([rule, r]) => ({ rule, area: r.area, level: r.level, what: r.what, fix: r.fix, open: shown.filter((f) => f.rule === rule).length }))
      .filter((r) => r.open > 0);
    return { asOf: this.now(), total: all.length, companies, byRule, findings: shown.slice(0, 500), more: Math.max(0, shown.length - 500) };
  }

  /** Home: the company office sees how many of its records need fixing. Leaders and HR open the board themselves. */
  async homeItems(user: User) {
    if (!companyOffice(user) || !user.companyIds.length) return [];
    const n = (await this.findings()).filter((f) => dataCleanupMaySee(user, f) && f.level === 'fix').length;
    return n ? [{ tone: 'warn' as const, tag: 'Data', title: `${n} record(s) to fix before data collection ends`, detail: 'Open Data clean-up: each line names the record by its number and says how to fix it.', go: { view: 'data-cleanup' as const } }] : [];
  }
}
