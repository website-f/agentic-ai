import type { HomeItem } from "./service";
import type { HomeView } from "./service";
import type { CompanyLicence } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { User } from "./types";
import { registerRollout } from "./rollouts";


/** The size Fauzan set for every company office (2 Nov 2026). */
export const OFFICE_TEAM = { heads: 1, minExecs: 2, maxExecs: 8, source: 'Fauzan, 2 Nov 2026: 1 Company Manager or GM and 2 to 8 executives per company' };

export type OfficeDesk = 'people' | 'clients' | 'tenders' | 'licences' | 'cases' | 'office';

/**
 * The company's work, split into desks. Each desk lists the screens whose work lands on it, so the office queue is
 * routed automatically from the same items the Home board already shows (nothing typed twice).
 */
export const OFFICE_DESKS: { desk: OfficeDesk; label: string; covers: string; views: HomeView[] }[] = [
  {
    desk: 'people',
    label: 'Guards, attendance and roster',
    covers: 'No-shows, empty shifts, guard papers and training (KDN, CSG), leave, guard records',
    views: ['people', 'attendance', 'roster', 'sites', 'hr', 'fwm', 'staffclock'],
  },
  {
    desk: 'clients',
    label: 'Clients, contracts and billing',
    covers: 'Client reports and visits, contracts and renewals, invoices to chase, branches',
    views: ['clients', 'contracts', 'finance', 'branches', 'credit'],
  },
  { desk: 'tenders', label: 'Tenders and quotations', covers: 'Tenders closing, bidding papers, quotations being prepared', views: ['commercial'] },
  {
    desk: 'licences',
    label: 'Licences, insurance and compliance',
    covers: 'KDN, MOF and SSM renewals, insurance cover, company secretary filings, compliance obligations',
    views: ['compliance', 'insurance', 'corporate', 'grc', 'governance', 'continuity', 'pdpa'],
  },
  { desk: 'cases', label: 'Cases and incidents', covers: 'Incidents and complaints raised at sites, until closed', views: ['cases'] },
  {
    desk: 'office',
    label: 'Office, purchases and claims',
    covers: 'Purchases and stock, staff claims, hostel bills, vehicles, IT help',
    views: ['purchasing', 'claims', 'hostels', 'fleet', 'it', 'websites', 'staffpay'],
  },
];

const DESK_OF_VIEW = new Map<HomeView, OfficeDesk>(OFFICE_DESKS.flatMap((d) => d.views.map((v) => [v, d.desk] as const)));

/**
 * Items only the head may act on: approvals (a manager never hands their signature to an executive) and arms (need to
 * know; executives have no arms access).
 */
export function deskOf(item: HomeItem): OfficeDesk | 'head' {
  // Office requests are the head's own (the company manager requests, the Chief of Staff and COO approve).
  if (item.tag === 'Approve' || item.go.view === 'arms' || item.go.view === 'requests') return 'head';
  return DESK_OF_VIEW.get(item.go.view) ?? 'head';
}

/** One desk's owner and backup for one company. Id is `desk-<companyId>-<desk>`, so a desk has one row. */
export interface CompanyDeskAssignment {
  id: Id;
  companyId: Id;
  desk: OfficeDesk;
  ownerUserId: Id | null;
  backupUserId: Id | null;
  note: string;
  setBy: string;
  setById: Id;
  setAt: IsoDateTime;
}

export function deskId(companyId: Id, desk: OfficeDesk): Id {
  return `desk-${companyId}-${desk}`;
}

export function isOfficeDesk(v: unknown): v is OfficeDesk {
  return typeof v === 'string' && OFFICE_DESKS.some((d) => d.desk === v);
}

/** The company's own head and executives, read from the accounts HR and IT keep. Branch managers run branches. */
function ownOfficeTeam(users: User[], companyId: Id, today: IsoDate) {
  const open = (u: User) => !u.integration && !(u.accessClosedFrom && u.accessClosedFrom <= today) && u.companyIds.includes(companyId);
  const managers = users.filter((u) => open(u) && u.role === 'company_manager');
  const execs = users.filter((u) => open(u) && u.role === 'admin_exec' && !u.branchId);
  // Fauzan, 2 Nov 2026: where a company has a GM, the GM is the head. A Company Manager account beside a GM is kept and
  // shown, but does not head the office or share out its desks.
  const gms = managers.filter((u) => headLabel(u) === 'General Manager');
  const heads = gms.length ? gms : managers;
  return { heads, execs, besideHead: managers.filter((u) => !heads.includes(u)) };
}

/**
 * The office team of a company. A company run by another company's office (Fauzan, 3 Nov 2026: a company without a
 * licence, or without enough work of its own, sits under a Company Manager) is headed by that office's head, who can
 * also hand its desks to their own executives: the team is the managing office plus any people of its own. Its own
 * Company Manager, if any, works beside the head. One level only: a managed company never manages another.
 * `lentFrom` names, for each person who belongs to the managing office, that company.
 */
export function officeTeam(users: User[], companyId: Id, today: IsoDate, links: RunLink[] = []) {
  const own = ownOfficeTeam(users, companyId, today);
  const parentId = runByCompanyId(links, companyId);
  const lentFrom = new Map<Id, Id>();
  if (!parentId) return { ...own, lentFrom, runBy: null as Id | null };
  const parent = ownOfficeTeam(users, parentId, today);
  for (const u of [...parent.heads, ...parent.besideHead, ...parent.execs]) if (!u.companyIds.includes(companyId)) lentFrom.set(u.id, parentId);
  const heads = parent.heads.length ? parent.heads : own.heads;
  const uniq = (xs: User[]) => xs.filter((u, i) => xs.findIndex((x) => x.id === u.id) === i);
  const besideHead = uniq([...own.heads, ...own.besideHead, ...parent.besideHead]).filter((u) => !heads.some((h) => h.id === u.id));
  const execs = uniq([...own.execs, ...parent.execs]);
  return { heads, execs, besideHead, lentFrom, runBy: parentId as Id | null };
}

/**
 * Which licensed company's office runs a company (Fauzan, 3 Nov 2026). One row per run company, id = the company's id;
 * the CEO sets it with a reason (audited), and null ends the arrangement. Kept apart from the company record so it can be
 * read before the company wall is set (db/modules/company-run-links-v1.sql).
 */
export interface CompanyRunLink {
  id: Id;
  companyId: Id;
  runByCompanyId: Id | null;
  reason: string;
  setBy: string;
  setById: Id;
  setAt: IsoDateTime;
}
export type RunLink = Pick<CompanyRunLink, 'companyId' | 'runByCompanyId'>;

/** The company whose office runs this one, when it is set and valid (not itself, and not itself run by another). */
export function runByCompanyId(links: RunLink[], companyId: Id): Id | null {
  const parentId = links.find((x) => x.companyId === companyId)?.runByCompanyId ?? null;
  if (!parentId || parentId === companyId) return null;
  if (links.some((x) => x.companyId === parentId && x.runByCompanyId)) return null;
  return parentId;
}

/** Companies run by any of these companies' offices. */
export function companiesRunBy(links: RunLink[], companyIds: Id[]): Id[] {
  const out: Id[] = [];
  for (const l of links) {
    const p = runByCompanyId(links, l.companyId);
    if (p && companyIds.includes(p) && !companyIds.includes(l.companyId) && !out.includes(l.companyId)) out.push(l.companyId);
  }
  return out;
}

/**
 * A company office account, with the companies its office runs added to the companies it works for, so the same
 * permission rules (and PostgreSQL's company wall) let the head and executives manage and monitor them. Branch managers,
 * guards, supervisors, group staff and system feeds are unchanged.
 */
export function withRunCompanies<T extends User>(user: T, links: RunLink[]): T {
  if (user.integration || user.branchId || (user.role !== 'company_manager' && user.role !== 'admin_exec')) return user;
  const extra = companiesRunBy(links, user.companyIds);
  return extra.length ? { ...user, companyIds: [...user.companyIds, ...extra] } : user;
}

/**
 * Who sets which office runs a company (Fauzan, 3 Nov 2026: "cos will set"): the Chief of Staff, and the CEO as owner
 * and master admin. Not the Deputy, not Company Managers. The database module enforces the same two accounts.
 */
export function canSetRunBy(user: User): boolean {
  if (user.integration) return false;
  return (user.role === 'pwvsb_officer' && user.leadership === 'cos') || (user.role === 'director' && user.opsTier === 'ceo');
}

/** The KDN licence as already recorded in the company's licences (nothing keyed again). A fact shown, never a block. */
export function kdnLicenceState(licences: CompanyLicence[], companyId: Id, today: IsoDate): 'held' | 'expired' | 'unknown' {
  const kdn = licences.filter((l) => l.companyId === companyId && l.type === 'KDN_LICENCE' && l.expiresOn);
  if (!kdn.length) return 'unknown';
  return kdn.some((l) => l.expiresOn! >= today) ? 'held' : 'expired';
}

export function headLabel(u: User): 'General Manager' | 'Company Manager' {
  return /general manager/i.test(u.title) ? 'General Manager' : 'Company Manager';
}

export type OfficeTone = 'ok' | 'warn' | 'crit' | 'neutral';
export interface OfficeFinding {
  tone: OfficeTone;
  rule: string;
  message: string;
}

/**
 * Team size checks (rule OFFICE-TEAM). A company with no office accounts at all is Unknown, never green: its people have
 * not been entered yet.
 */
export function teamFindings(heads: User[], execs: User[], besideHead: User[] = []): OfficeFinding[] {
  const out: OfficeFinding[] = besideHead.map((u) => ({
    tone: 'warn' as const,
    rule: 'OFFICE-TEAM',
    message: `${u.name} still has a Company Manager account beside the GM, who heads the office. HR to change it to an executive account or close it.`,
  }));
  if (!heads.length && !execs.length && !besideHead.length)
    return [{ tone: 'neutral', rule: 'OFFICE-TEAM', message: 'Office people not entered yet. HR adds the Company Manager or GM and the executives.' }];
  if (!heads.length) out.push({ tone: 'crit', rule: 'OFFICE-TEAM', message: 'No Company Manager or GM. Nobody can share out the work or approve.' });
  if (heads.length > OFFICE_TEAM.heads)
    out.push({
      tone: 'warn',
      rule: 'OFFICE-TEAM',
      message: `${heads.length} heads (${heads.map((h) => `${h.name}, ${headLabel(h)}`).join('; ')}). Each company has one Company Manager or GM; HR to keep one head account.`,
    });
  if (execs.length < OFFICE_TEAM.minExecs)
    out.push({
      tone: 'crit',
      rule: 'OFFICE-TEAM',
      message: `${execs.length} executive${execs.length === 1 ? '' : 's'}; the office needs at least ${OFFICE_TEAM.minExecs}.`,
    });
  if (execs.length > OFFICE_TEAM.maxExecs)
    out.push({
      tone: 'warn',
      rule: 'OFFICE-TEAM',
      message: `${execs.length} executives; the limit is ${OFFICE_TEAM.maxExecs}. Ask the COO before adding more.`,
    });
  return out;
}

/**
 * A fair first split when the head has not shared out the desks yet: desks go round the executives in turn, and each
 * desk's backup is the next executive along, so nobody backs up their own desk. Only a suggestion until the head saves it.
 */
export function suggestDesks(execs: User[]): Record<OfficeDesk, { ownerUserId: Id | null; backupUserId: Id | null }> {
  const out = {} as Record<OfficeDesk, { ownerUserId: Id | null; backupUserId: Id | null }>;
  const ids = [...execs].sort((a, b) => a.name.localeCompare(b.name)).map((u) => u.id);
  OFFICE_DESKS.forEach((d, i) => {
    const owner = ids.length ? ids[i % ids.length] : null;
    const backup = ids.length > 1 ? ids[(i + 1) % ids.length] : null;
    out[d.desk] = { ownerUserId: owner, backupUserId: backup };
  });
  return out;
}

/**
 * Who joins Prima when the CEO starts the company office rollout (PRIMA_ROLLOUTS=company_office; Arisha main review of
 * the combined build, 3 Nov 2026: company office staff could not sign in while the IT pilot is on). It admits each
 * licensed company's own office: the head (GM or Company Manager) and the admin executives, both without a branch.
 * Far-branch managers (admin_exec with a branch), guards, supervisors, site devices and system feeds are not admitted.
 * Draft: off until the CEO adds company_office to PRIMA_ROLLOUTS. Which companies join is decided by which office
 * accounts HR and IT create for the wave (Sasa, Arrow Shield and Inas first); closed accounts are refused at sign-in
 * before this rule is read.
 */
export function inCompanyOfficeRollout(user: User): boolean {
  if (user.integration || user.branchId) return false;
  if (user.role !== 'company_manager' && user.role !== 'admin_exec') return false;
  return user.companyIds.length > 0;
}

registerRollout('company_office', 'Company office (head and admin executives of each company)', inCompanyOfficeRollout);