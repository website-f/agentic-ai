// Group website management (Fauzan, 27 Oct 2026). One register of every company's domains and websites, run by IT:
// quarterly content reviews with the company, monthly checks, urgent issues, DNS change control and renewals.
// Domain registration, Cloudflare hosting, GitHub and Microsoft 365 are separate services. No integration is
// connected yet, so every publication, check and notice outside Prima is a manual record and is labelled that way.

import { webActive, webIt, webManager, webTicketPolicy, socialInactivityDays } from './web-ticket-policy';
import { isGroupLeader } from './access';
import { RULES } from './rules';
import type { Store } from './store';
import { addDays, daysBetween, dateOf, fromMs, toMs } from './time';
import type { ItTicket, Company, Id, IsoDate, IsoDateTime, User } from './types';
import { BadRequest, NotFound } from './service';
import {
  CONNECTOR_INFO,
  dnsFingerprint,
  hostOf,
  type ConnectorKey,
  type ConnectorState,
  type DomainObserved,
  type SiteObserved,
  type SpInboxItem,
  type WebFeed,
} from './websites-connectors';

// ---------- Records ----------

export type WebRequired = 'yes' | 'no' | 'under_review';

/** The company's website set-up, kept beside the company master (never a second company record). */
export interface WebCompany {
  id: Id;
  companyId: Id;
  websiteRequired: WebRequired;
  /** Why no website is needed, and who agreed it. */
  notRequired: { reason: string; by: string; byId: Id; at: IsoDateTime } | null;
  itAdminId: Id | null;
  backupId: Id | null;
  contentOwnerId: Id | null;
  approverId: Id | null;
  note: string;
  /** Social media and online presence accounts of this company (Fauzan, 31 Oct 2026). */
  social?: WebSocial[];
  /** Microsoft 365 mailbox housekeeping for this company, reviewed by IT. */
  mailboxes?: WebMailboxes;
}

export type SocialPlatform = 'facebook' | 'instagram' | 'linkedin' | 'tiktok' | 'youtube' | 'x' | 'google_business' | 'whatsapp_business' | 'other';

/** A company social media or online listing account. Who holds it and who can get in matters more than the posts. */
export interface WebSocial {
  id: Id;
  companyId: Id;
  platform: SocialPlatform;
  name: string;
  url: string;
  status: 'active' | 'dormant' | 'closed' | 'unknown';
  /** Held by the company (business portfolio, company page) and never only by one person's own account. */
  ownership: 'business_portfolio' | 'company_page' | 'personal' | 'unknown';
  holder: string;
  admins: { name: string; companyEmail: boolean; twoFactor: boolean | null }[];
  recoveryEmail: string;
  itAdminId: Id | null;
  contentOwnerId: Id | null;
  approverId: Id | null;
  lastPostOn: IsoDate | null;
  statusReason?: string;
  vault: { manager: string; entry: string; access: string } | null;
  /** The last people-and-access review (who is admin, leavers removed, 2FA), with the reviewer's comment. */
  accessReview: { at: IsoDateTime; by: string; note: string; removed: string } | null;
  note: string;
}

/** Email health of a domain: the DNS records that keep company email delivered and stop others sending as it. */
export interface WebMailHealth {
  dnsObservation?: { spfPresent: boolean; dkimRecordPresent: boolean; dmarcPresent: boolean; mxPresent: boolean };
  spf: 'pass' | 'missing' | 'too_many_lookups' | 'unknown';
  dkim: 'on' | 'off' | 'unknown';
  dmarc: 'reject' | 'quarantine' | 'none' | 'missing' | 'unknown';
  dmarcReports: boolean | null;
  mx: 'm365' | 'other' | 'missing' | 'unknown';
  source: 'manual' | 'dns';
  checkedAt: IsoDateTime | null;
  checkedBy: string | null;
}

export interface WebMailboxes {
  licensed: number | null;
  shared: number | null;
  /** Leavers whose mailbox is not yet blocked, converted to shared or closed. */
  leaversPending: number | null;
  /** Mailboxes close to the 50 GB limit of an unlicensed shared mailbox or their plan. */
  nearFull: number | null;
  /** Mailboxes forwarding to addresses outside the company. */
  forwardingOutside: number | null;
  reviewedAt: IsoDateTime | null;
  reviewedBy: string | null;
  note: string;
}

export type DomainStatus = 'active' | 'expired' | 'pending' | 'transferring' | 'unknown';

export interface WebDomain {
  id: Id;
  name: string;
  /** Usually one company; more than one where a group arrangement shares the domain. */
  companyIds: Id[];
  primary: boolean;
  registrar: string;
  status: DomainStatus;
  registeredOn: IsoDate | null;
  expiresOn: IsoDate | null;
  renewOn: IsoDate | null;
  autoRenew: 'on' | 'off' | 'unknown';
  renewalAmount: number | null;
  currency: string;
  /** Who pays the renewal (Finance). */
  renewalOwnerId: Id | null;
  /** Who holds the registrar account (a person or team, never the password). */
  accountOwner: string;
  dnsProvider: string;
  nameservers: string[];
  /** Microsoft 365 email runs on this domain: a DNS change can stop company email. */
  m365Email: boolean | null;
  itAdminId: Id | null;
  backupId: Id | null;
  lastVerifiedOn: IsoDate | null;
  /** Where the sign-in is kept: the approved password manager, the vault entry name, who may open it. */
  vault: { manager: string; entry: string; access: string } | null;
  receiptRef: string;
  note: string;
  renewals: { at: IsoDateTime; by: string; from: IsoDate | null; to: IsoDate; evidence: string; amount: number | null }[];
  payment: { status: 'unpaid' | 'paid' | 'not_due'; ref: string; by: string; at: IsoDateTime } | null;
  /** Filled by the connectors only. */
  observed?: DomainObserved;
  /** Email health (SPF, DKIM, DMARC, MX), from the DNS reading or entered by IT. */
  mail?: WebMailHealth;
}

export type SiteStatus = 'live' | 'development' | 'offline' | 'retired';
export type DeployMethod = 'github' | 'direct_upload' | 'other' | 'unknown';

export interface WebSite {
  id: Id;
  name: string;
  companyId: Id;
  purpose: string;
  status: SiteStatus;
  url: string;
  domainIds: Id[];
  hosting: { provider: string; project: string; plan: string; free: boolean | null; customDomain: boolean | null };
  deploy: DeployMethod;
  repoRef: string;
  sourceRef: string;
  /** Owners for this website; empty means the company's defaults apply. */
  itAdminId: Id | null;
  backupId: Id | null;
  contentOwnerId: Id | null;
  approverId: Id | null;
  contact: { phone: string; email: string; whatsapp: string };
  form: { present: boolean | null; provider: string; recipient: string };
  https: { ok: boolean | null; checkedOn: IsoDate | null };
  claims: string;
  cost: { hosting: number | null; extras: string; ownerId: Id | null };
  recovery: { lastGoodVersion: string; instructionsRef: string };
  vault: { manager: string; entry: string; access: string } | null;
  /** A website excused from the quarterly review, with who agreed it. */
  reviewException: { reason: string; by: string; at: IsoDateTime } | null;
  note: string;
  /** Filled by the connectors only. */
  observed?: SiteObserved;
}

export type ReviewOutcome = 'changes' | 'no_changes' | 'assist';
export type ReviewStage = 'request' | 'verify' | 'compliance' | 'prepare' | 'approval' | 'publish' | 'test' | 'complete' | 'done';
export type TestResult = 'pass' | 'fail' | 'na';

export interface WebChange {
  page: string;
  existing: string;
  proposed: string;
  reason: string;
  docRef: string;
  verifiedBy: string;
  compliance: boolean;
  complianceDecision: { ok: boolean; by: string; at: IsoDateTime; note: string } | null;
}

export interface WebTest {
  key: string;
  result: TestResult | null;
  note: string;
  evidence: string;
  by: string | null;
  at: IsoDateTime | null;
  issueId: Id | null;
  /** When a failed item later passes: what was corrected and when it was tested again. */
  correction: string;
}

export interface WebReview {
  id: Id;
  siteId: Id;
  companyId: Id;
  quarter: string;
  openedAt: IsoDateTime;
  openedBy: string;
  responseDue: IsoDate;
  approvalDue: IsoDate;
  completeDue: IsoDate;
  stage: ReviewStage;
  needsHelp: boolean;
  response: {
    outcome: ReviewOutcome;
    topics: string[];
    note: string;
    by: string;
    byId: Id;
    at: IsoDateTime;
    reusedFrom: Id | null;
  } | null;
  changes: WebChange[];
  verified: { by: string; byId: Id; at: IsoDateTime } | null;
  preparation: { previewUrl: string; previousVersion: string; desktopOk: boolean; mobileOk: boolean; summary: string; by: string; at: IsoDateTime } | null;
  approvals: { decision: 'approve' | 'amend' | 'reject'; note: string; by: string; byId: Id; at: IsoDateTime }[];
  publication: { at: IsoDateTime; by: string; versionRef: string; liveUrl: string; issue: string; method: 'manual' } | null;
  tests: WebTest[];
  completed: { by: string; at: IsoDateTime; outstanding: string[] } | null;
  history: { at: IsoDateTime; by: string; text: string }[];
}

export type CheckStatus = 'not_started' | 'in_progress' | 'completed' | 'completed_issues' | 'overdue' | 'na';

export interface WebCheck {
  id: Id;
  /** What is checked: a website (the default), a social media account or a domain's email. */
  kind?: 'site' | 'social' | 'mail';
  /** The website, social account or domain checked. */
  siteId: Id;
  companyId: Id;
  month: string;
  assignedToId: Id | null;
  items: { key: string; result: TestResult | null; note: string; issueId: Id | null }[];
  na: { reason: string; by: string } | null;
  doneBy: string | null;
  doneAt: IsoDateTime | null;
  /** Every result so far is entered by a person. Automated uptime checks would be marked 'automated'. */
  source: 'manual';
}

export type IssueSeverity = 'critical' | 'high' | 'normal' | 'low';
export type IssueCategory = 'DOWN' | 'SECURITY' | 'WRONG_INFO' | 'CLAIM' | 'FORM' | 'UNAUTHORISED' | 'DOMAIN' | 'EMAIL' | 'TEST_FAIL' | 'SOCIAL' | 'OTHER';

export interface WebIssue {
  id: Id;
  ref: string;
  companyId: Id;
  siteId: Id | null;
  domainId: Id | null;
  category: IssueCategory;
  description: string;
  severity: IssueSeverity;
  reportedBy: string;
  reportedById: Id;
  at: IsoDateTime;
  ownerId: Id | null;
  impact: string;
  immediateAction: string;
  escalateToId: Id | null;
  targetOn: IsoDate;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  resolution: { note: string; evidence: string; by: string; at: IsoDateTime } | null;
  origin: { kind: 'manual' | 'review' | 'check' | 'dns' | 'connector' | 'sharepoint'; id: Id | null };
  /** An urgent content change approved outside the quarterly cycle. */
  urgent: { reason: string; approvedBy: string; approvedById: Id; changed: string; publishedAt: IsoDateTime | null; checks: string; at: IsoDateTime } | null;
  history: { at: IsoDateTime; by: string; text: string }[];
  /** The IT help request that carries this work in the IT ticket queue (Fauzan, 31 Oct 2026). */
  itTicketId?: Id | null;
}

export interface WebDnsChange {
  id: Id;
  ref: string;
  domainId: Id;
  reason: string;
  windowFrom: IsoDateTime;
  windowTo: IsoDateTime;
  ownerId: Id;
  raisedBy: string;
  raisedById: Id;
  at: IsoDateTime;
  pre: { key: string; doneAt: IsoDateTime | null; by: string | null; note: string }[];
  approval: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  post: { key: string; result: TestResult | null; note: string; by: string | null; at: IsoDateTime | null }[];
  status: 'draft' | 'approved' | 'done' | 'rolled_back' | 'cancelled';
  finalConfig: string;
  incident: string;
}

export interface WebNotice {
  id: Id;
  at: IsoDateTime;
  toUserId: Id;
  title: string;
  link: { kind: 'review' | 'issue' | 'domain' | 'dns' | 'check' | 'site'; id: Id };
  /** Scheduled reminders carry a key so each one goes to each person once. */
  key?: string;
  /** Shown inside Prima. Email and Teams stay 'not_connected' until Microsoft 365 is connected and authorised. */
  delivery: { inApp: 'delivered'; email: 'not_connected'; teams: 'not_connected' };
}

export type Delivery = 'not_connected' | 'queued' | 'sent' | 'failed' | 'not_sent';

export interface WebSettings {
  id: 'settings';
  domainReminderDays: number[];
  /** Renewal not confirmed this close to expiry goes to the management escalation list. */
  renewalEscalateDays: number;
  /** Days after the quarter starts: review opens, company answers, approval given. Completion is the quarter end. */
  requestDay: number;
  responseDays: number;
  approvalDays: number;
  responseReminderDays: number;
  monthlyDueDay: number;
  issueTargetHours: Record<IssueSeverity, number>;
  escalationIds: Id[];
  blockSelfApproval: boolean;
  /** Phase 2: open reviews and checks when due and send reminders and escalations, when IT or management opens the module. */
  autoSchedule: boolean;
  /** Days before a monthly check is due that the checker is reminded. */
  checkReminderDays: number;
  /** Days past a deadline before the management escalation list is told. */
  overdueEscalateDays: number;
  lastScheduleRun: IsoDateTime | null;
  /** Each connector is off until the CEO switches it on (and its key is set on the server). */
  connectorsOn: Record<ConnectorKey, boolean>;
  connectorState: Partial<Record<ConnectorKey, ConnectorState>>;
  /** Requests read from the SharePoint list, waiting for the IT Manager to accept or decline. */
  spInbox: SpInboxItem[];
  updatedBy: string | null;
  updatedAt: IsoDateTime | null;
}

// ---------- Fixed lists ----------

export const WEB_DEFAULTS: Omit<WebSettings, 'escalationIds'> = {
  id: 'settings',
  domainReminderDays: [60, 30, 7, 0],
  renewalEscalateDays: 7,
  requestDay: 0,
  responseDays: 30,
  approvalDays: 60,
  responseReminderDays: 7,
  monthlyDueDay: 25,
  issueTargetHours: { critical: 4, high: 24, normal: 120, low: 240 },
  blockSelfApproval: true,
  autoSchedule: true,
  checkReminderDays: 5,
  overdueEscalateDays: 7,
  lastScheduleRun: null,
  connectorsOn: { cloudflare: false, github: false, uptime: false, registrar: false, maildns: false, m365: false, sharepoint: false },
  connectorState: {},
  spInbox: [],
  updatedBy: null,
  updatedAt: null,
};

export const REVIEW_TOPICS: [string, string][] = [
  ['profile', 'Company name and profile'],
  ['services', 'Services'],
  ['address', 'Address and operating hours'],
  ['phone', 'Telephone numbers'],
  ['email', 'Email and WhatsApp contact'],
  ['people', 'Published staff and management details'],
  ['licences', 'Licence and certification claims'],
  ['clients', 'Client names, logos and testimonials'],
  ['careers', 'Careers and recruitment'],
  ['news', 'News, photographs and old announcements'],
  ['privacy', 'Privacy notice and contact form details'],
];

export const REVIEW_TESTS: [string, string][] = [
  ['home', 'Homepage loads'],
  ['updated', 'Updated pages display correctly'],
  ['mobile', 'Mobile view works'],
  ['desktop', 'Desktop view works'],
  ['https', 'HTTPS works'],
  ['links', 'Important links work'],
  ['tel', 'Telephone link works'],
  ['mail', 'Email link works'],
  ['whatsapp', 'WhatsApp link works, if present'],
  ['form', 'Contact form works end to end, if present'],
  ['recipient', 'The right person receives the test enquiry'],
  ['m365', 'Company email works, if DNS was changed'],
  ['recovery', 'Previous version or recovery reference is available'],
];

export const MONTHLY_ITEMS: [string, string][] = [
  ['loads', 'Website loads'],
  ['home', 'Homepage displays correctly'],
  ['https', 'HTTPS valid, no browser warning'],
  ['nav', 'Main navigation works'],
  ['tel', 'Phone link works'],
  ['mail', 'Email link works'],
  ['whatsapp', 'WhatsApp link works, if any'],
  ['form', 'Contact form reaches the right person, if any'],
  ['info', 'Key company information is not obviously wrong'],
  ['tamper', 'No unauthorised changes or suspicious content'],
  ['domain', 'Domain renewal status checked'],
];

export const SOCIAL_ITEMS: [string, string][] = [
  ['access', 'Admins are still the right people; leavers removed'],
  ['twofa', 'Two-step sign-in on for every admin'],
  ['ownership', 'Held by the company business account, not one person'],
  ['info', 'Name, phone, address and licence claims are correct'],
  ['posts', 'No guard faces, site locations, patrol times or arms details posted'],
  ['messages', 'Messages and comments answered or passed on'],
  ['impersonation', 'No fake pages using the company name'],
  ['activity', 'Posted this month, or marked dormant'],
];

export const MAIL_ITEMS: [string, string][] = [
  ['spf', 'SPF record present and within 10 lookups'],
  ['dkim', 'DKIM signing on in Microsoft 365'],
  ['dmarc', 'DMARC record present (moving towards quarantine or reject)'],
  ['reports', 'DMARC reports read; no unknown senders'],
  ['leavers', 'Leavers blocked; their mailbox converted to shared or closed'],
  ['size', 'No mailbox close to full'],
  ['forwarding', 'No forwarding to outside addresses'],
  ['mfa', 'Multi-factor sign-in on for every mailbox user'],
  ['shared', 'Shared mailbox access is still right'],
];

export const SOCIAL_PLATFORMS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  x: 'X (Twitter)',
  google_business: 'Google Business Profile',
  whatsapp_business: 'WhatsApp Business',
  other: 'Other',
};

const PERSONAL_MAIL = /@(gmail|yahoo|hotmail|outlook|live|icloud|ymail)\./i;

/** What is wrong with a social account's set-up, from Meta's and the platforms' own security advice. */
export function socialFlags(a: WebSocial, today: IsoDate): string[] {
  if (a.status === 'closed') return [];
  const out: string[] = [];
  if (a.admins.length < 2) out.push('Fewer than two admins');
  if (a.admins.some((x) => !x.companyEmail)) out.push('An admin signs in with a personal email');
  if (a.admins.some((x) => x.twoFactor !== true)) out.push('Two-step sign-in not confirmed for every admin');
  if (a.ownership === 'personal' || a.ownership === 'unknown') out.push('Not held by a company business account');
  if (!a.recoveryEmail || PERSONAL_MAIL.test(a.recoveryEmail)) out.push('Recovery email is missing or personal');
  if (!a.accessReview || daysBetween(dateOf(a.accessReview.at), today) > 90) out.push('Access review due (every 90 days)');
  if (a.status === 'active' && socialInactivityDays(a.lastPostOn,today)===null) out.push('Last post date not recorded: verify activity');
  else if (a.status === 'active' && a.lastPostOn && socialInactivityDays(a.lastPostOn,today)! >= 180) out.push('No post in 180 days: company Manager review required');
  if (!a.itAdminId) out.push('No IT administrator');
  return out;
}

export function mailFlags(h: WebMailHealth | undefined): string[] {
  if (!h) return ['Email health not checked'];
  const out: string[] = [];
  if (h.spf === 'missing') out.push('No SPF record');
  if (h.spf === 'too_many_lookups') out.push('SPF over 10 lookups: mail may fail');
  if (h.dkim === 'off') out.push('DKIM signing off');
  if (h.dmarc === 'missing') out.push('No DMARC record');
  if (h.dmarc === 'none') out.push('DMARC only monitoring (p=none)');
  if (h.dmarcReports == null) out.push('DMARC report collection not checked');
  if (h.dmarcReports === false) out.push('No DMARC reports collected');
  if (h.mx === 'missing') out.push('No MX record');
  if ([h.spf, h.dkim, h.dmarc, h.mx].includes('unknown')) out.push('Some records not checked');
  return out;
}

export function mailboxFlags(m: WebMailboxes | undefined, today: IsoDate): string[] {
  if (!m) return ['Mailboxes not reviewed'];
  const out: string[] = [];
  if ([m.leaversPending, m.forwardingOutside, m.nearFull].some(x => x == null)) out.push('Some mailbox risk checks not checked');
  if (m.leaversPending) out.push(`${m.leaversPending} leaver mailbox${m.leaversPending === 1 ? '' : 'es'} still open`);
  if (m.forwardingOutside) out.push(`${m.forwardingOutside} forwarding outside the company`);
  if (m.nearFull) out.push(`${m.nearFull} close to full`);
  if (!m.reviewedAt || daysBetween(dateOf(m.reviewedAt), today) > 90) out.push('Mailbox review due (every 90 days)');
  return out;
}

/** Reads SPF, DMARC, DKIM and MX from public DNS answers (the email DNS connector). */
export function mailHealthFromDns(x: { spf: string | null; dmarc: string | null; dkim: boolean; mx: string[] }): Omit<WebMailHealth, 'checkedAt' | 'checkedBy'> {
  const lookups = x.spf ? (x.spf.match(/\b(include|a|mx|ptr|exists|redirect)[:=\s]/gi) ?? []).length : 0;
  const policy = x.dmarc?.match(/\bp=(none|quarantine|reject)/i)?.[1]?.toLowerCase() as WebMailHealth['dmarc'] | undefined;
  return {
    spf: !x.spf ? 'missing' : lookups > 10 ? 'too_many_lookups' : 'unknown',
    dkim: 'unknown',
    dmarc: !x.dmarc ? 'missing' : (policy ?? 'none'),
    dmarcReports: null,
    mx: !x.mx.length ? 'missing' : x.mx.some((m) => /mail\.protection\.outlook\.com\.?$/i.test(m)) ? 'm365' : 'other',
    source: 'dns',
    dnsObservation: { spfPresent: !!x.spf, dkimRecordPresent: x.dkim, dmarcPresent: !!x.dmarc, mxPresent: x.mx.length > 0 },
  };
}

export function checkItems(kind: WebCheck['kind']): [string, string][] {
  return kind === 'social' ? SOCIAL_ITEMS : kind === 'mail' ? MAIL_ITEMS : MONTHLY_ITEMS;
}

export const DNS_PRE: [string, string][] = [
  ['current', 'Current DNS provider and nameservers recorded'],
  ['export', 'Existing DNS records exported or written down'],
  ['m365', 'Microsoft 365 and other service records identified'],
  ['site', 'Website records that will change identified'],
  ['rollback', 'Rollback plan ready'],
  ['owner', 'IT owner assigned'],
  ['window', 'Change window scheduled'],
];

export const DNS_POST: [string, string][] = [
  ['resolves', 'Website resolves'],
  ['https', 'HTTPS works'],
  ['m365', 'Microsoft 365 email sends and receives'],
  ['others', 'Other affected services tested'],
  ['final', 'Final DNS set-up recorded'],
];


// ---------- Dates ----------

/** The calendar quarter of a date in Malaysia time: key like 2026-Q4, first and last day. */
export function quarterOf(d: IsoDate): { key: string; start: IsoDate; end: IsoDate } {
  const y = Number(d.slice(0, 4));
  const q = Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
  const startMonth = (q - 1) * 3 + 1;
  const start = `${y}-${String(startMonth).padStart(2, '0')}-01` as IsoDate;
  const nextStart = q === 4 ? (`${y + 1}-01-01` as IsoDate) : (`${y}-${String(startMonth + 3).padStart(2, '0')}-01` as IsoDate);
  return { key: `${y}-Q${q}`, start, end: addDays(nextStart, -1) };
}

export function quarterByKey(key: string): { key: string; start: IsoDate; end: IsoDate } {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) throw new BadRequest('Give the quarter like 2026-Q4.');
  return quarterOf(`${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01` as IsoDate);
}

export function previousQuarter(key: string): string {
  const q = quarterByKey(key);
  return quarterOf(addDays(q.start, -1)).key;
}

const monthOf = (d: IsoDate) => d.slice(0, 7);

// ---------- Service ----------

type Viewer = {
  user: User;
  /** The CEO: owner and master administrator of every system and domain (Fauzan, 28 Oct 2026). */
  admin: boolean;
  /** The IT Lead: the technical head, who approves technical changes such as DNS. */
  tech: boolean;
  /**
   * Pilot (Fauzan, 28 Oct 2026): the companies and ACT are not on the system yet, so the IT Manager, who deals with the
   * companies, records their answers, checks and approvals on their behalf, naming the person and how they gave it.
   */
  proxy: boolean;
  /** IT Manager or IT Lead: every company, assigns IT staff. The IT Manager supervises; the IT Lead is technical. */
  itHead: boolean;
  it: boolean;
  /** CEO, COO, Finance Director, Chief of Staff, Deputy Chief of Staff, Chairman, Vice Chairman. */
  group: boolean;
  /** Chief of Staff and Deputy (Vice) Chief of Staff: the administration exceptions view. */
  cos: boolean;
  /** ACT verifies licence and certification claims. */
  compliance: boolean;
  finance: boolean;
};

const STAGE_LABEL: Record<ReviewStage, string> = {
  request: 'Waiting for the company',
  verify: 'Business owner to verify',
  compliance: 'Compliance check',
  prepare: 'IT preparing the change',
  approval: 'Waiting for approval',
  publish: 'IT to publish',
  test: 'IT testing',
  complete: 'IT to record completion',
  done: 'Completed',
};

const websiteQueues = new WeakMap<Store, Promise<unknown>>();
const safeConnectorError = (error: string) => ['REQUEST_FAILED','PROVIDER_REJECTED','INVALID_RESPONSE','RESPONSE_TOO_LARGE','INCOMPLETE_RESPONSE','SYNC_TIMEOUT'].includes(error) ? error : 'REQUEST_FAILED';
export class WebsiteService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private mutationLocked = false,
  ) {}

  private serialize<T>(run: (service: WebsiteService) => Promise<T>): Promise<T> {
    const previous = websiteQueues.get(this.store) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.store.transaction(async tx => {
      await tx.lock?.('webSettings', 'settings');
      return run(new WebsiteService(tx, this.clock, true));
    }));
    websiteQueues.set(this.store, next);
    return next.finally(() => { if (websiteQueues.get(this.store) === next) websiteQueues.delete(this.store); });
  }

  private now(): IsoDateTime {
    return this.clock();
  }

  private today(): IsoDate {
    return dateOf(this.clock());
  }

  private viewer(user: User): Viewer {
    const it = user.role === 'pwvsb_officer' && user.department === 'it';
    return {
      user,
      admin: user.opsTier === 'ceo',
      tech: it && user.itRole === 'lead',
      proxy: it && user.itRole === 'manager' && RULES.pilot.value.on,
      itHead: it && (user.itRole === 'manager' || user.itRole === 'lead'),
      it,
      group: isGroupLeader(user),
      cos: user.role === 'pwvsb_officer' && (user.leadership === 'cos' || user.leadership === 'deputy_cos'),
      compliance: user.role === 'pwvsb_officer' && user.department === 'audit',
      finance: user.role === 'pwvsb_officer' && user.department === 'finance',
    };
  }

  async settings(): Promise<WebSettings> {
    const s = await this.store.get('webSettings', 'settings');
    if (s) return { ...WEB_DEFAULTS, ...s };
    const coo = (await this.store.list('users', {})).find((u) => u.opsTier === 'coo');
    return { ...WEB_DEFAULTS, escalationIds: coo ? [coo.id] : [] };
  }

  private async load() {
    const [companies, profiles, domains, sites, reviews, checks, issues, dns, notices, users, settings] = await Promise.all([
      this.store.list('companies', {}),
      this.store.list('webCompanies', {}),
      this.store.list('webDomains', {}),
      this.store.list('webSites', {}),
      this.store.list('webReviews', {}),
      this.store.list('webChecks', {}),
      this.store.list('webIssues', {}),
      this.store.list('webDnsChanges', {}),
      this.store.list('webNotices', {}),
      this.store.list('users', {}),
      this.settings(),
    ]);
    return { companies, profiles, domains, sites, reviews, checks, issues, dns, notices, users, settings };
  }

  /** Owners of a website: its own, else the company's. */
  private owners(site: WebSite | null, profile: WebCompany | undefined) {
    return {
      itAdminId: site?.itAdminId ?? profile?.itAdminId ?? null,
      backupId: site?.backupId ?? profile?.backupId ?? null,
      contentOwnerId: site?.contentOwnerId ?? profile?.contentOwnerId ?? null,
      approverId: site?.approverId ?? profile?.approverId ?? null,
    };
  }

  private headsOf(users: User[], companyId: Id) {
    return users.filter((u) => u.role === 'company_manager' && u.companyIds.includes(companyId) && !/general manager/i.test(u.title));
  }

  /** Companies this person may see in the module. */
  private visibleCompanyIds(v: Viewer, d: Awaited<ReturnType<WebsiteService['load']>>): Set<Id> {
    if (v.group || v.itHead) return new Set(d.companies.map((c) => c.id));
    const ids = new Set<Id>();
    if (v.it) {
      for (const p of d.profiles) if (p.itAdminId === v.user.id || p.backupId === v.user.id) ids.add(p.companyId);
      for (const s of d.sites) {
        const o = this.owners(s, d.profiles.find((p) => p.companyId === s.companyId));
        if (o.itAdminId === v.user.id || o.backupId === v.user.id) ids.add(s.companyId);
      }
      for (const x of d.domains) if (x.itAdminId === v.user.id || x.backupId === v.user.id) x.companyIds.forEach((c) => ids.add(c));
    }
    if (v.user.role === 'company_manager' || v.user.role === 'admin_exec') v.user.companyIds.forEach((c) => ids.add(c));
    for (const p of d.profiles) if (p.contentOwnerId === v.user.id || p.approverId === v.user.id) ids.add(p.companyId);
    for (const s of d.sites) if (s.contentOwnerId === v.user.id || s.approverId === v.user.id) ids.add(s.companyId);
    if (v.finance) for (const x of d.domains) if (x.renewalOwnerId === v.user.id) x.companyIds.forEach((c) => ids.add(c));
    return ids;
  }

  private domainState(x: WebDomain, today: IsoDate, settings: WebSettings) {
    const days = x.expiresOn ? daysBetween(today, x.expiresOn) : null;
    const status: 'active' | 'expiring' | 'expired' | 'unknown' =
      x.status === 'expired' || (days != null && days < 0) ? 'expired' : days == null || x.status === 'unknown' ? 'unknown' : days <= 60 ? 'expiring' : 'active';
    const steps = [...settings.domainReminderDays].sort((a, b) => b - a);
    const reminder = days == null ? null : (steps.filter((s) => days <= s).pop() ?? null);
    const lastRenewal = x.renewals[x.renewals.length - 1];
    const renewalConfirmed = !!lastRenewal && lastRenewal.to === x.expiresOn && days != null && days > settings.domainReminderDays[0];
    const escalate = days != null && days <= settings.renewalEscalateDays && !renewalConfirmed;
    return { days, status, reminder, escalate };
  }

  private reviewState(r: WebReview, today: IsoDate) {
    const overdue =
      r.stage !== 'done' &&
      (today > r.completeDue || (r.stage === 'request' && today > r.responseDue) || (r.stage === 'approval' && today > r.approvalDue));
    const label: 'not_started' | 'in_progress' | 'awaiting_approval' | 'completed' | 'overdue' =
      r.stage === 'done' ? 'completed' : overdue ? 'overdue' : r.stage === 'approval' ? 'awaiting_approval' : r.stage === 'request' && !r.response ? 'not_started' : 'in_progress';
    return { overdue, label, stageLabel: STAGE_LABEL[r.stage] };
  }

  private checkState(c: WebCheck, today: IsoDate, settings: WebSettings): CheckStatus {
    if (c.na) return 'na';
    const entered = c.items.filter((i) => i.result).length;
    if (c.doneAt) return c.items.some((i) => i.result === 'fail') ? 'completed_issues' : 'completed';
    const due = `${c.month}-${String(settings.monthlyDueDay).padStart(2, '0')}`;
    if (today > due || monthOf(today) > c.month) return 'overdue';
    return entered ? 'in_progress' : 'not_started';
  }

  /** The whole module for one person: what they may see, and the work waiting on them. */
  async board(user: User) {
    const current=await this.store.get('users',user.id);
    if(!webActive(current,this.today()))return {allowed:false as const};
    user=current;
    if (user.integration || user.role === 'site_device' || user.role === 'guard' || user.role === 'supervisor') return { allowed: false as const };
    const v = this.viewer(user);
    const d = await this.load();
    const today = this.today();
    const quarter = quarterOf(today);
    const month = monthOf(today);
    const visible = this.visibleCompanyIds(v, d);
    const ownWork = d.issues.some(x=>x.reportedById===user.id) || v.it && (d.issues.some(x => x.ownerId === user.id) || d.profiles.some(p => (p.social ?? []).some(a => a.itAdminId === user.id)));
    if (!visible.size && !ownWork && !v.compliance && !v.itHead) return { allowed: false as const };
    const name = (id: Id | null | undefined) => (id ? (d.users.find((u) => u.id === id)?.name ?? id) : null);
    const coName = (id: Id) => d.companies.find((c) => c.id === id)?.name ?? id;
    const seesVault = v.it || v.admin;
    const canEditRecords = v.itHead;

    const siteRows = d.sites
      .filter((s) => visible.has(s.companyId))
      .map((s) => {
        const profile = d.profiles.find((p) => p.companyId === s.companyId);
        const o = this.owners(s, profile);
        const reviews = d.reviews.filter((r) => r.siteId === s.id).sort((a, b) => b.quarter.localeCompare(a.quarter));
        const current = reviews.find((r) => r.quarter === quarter.key) ?? null;
        const last = reviews.find((r) => r.stage === 'done') ?? null;
        const check = d.checks.find((c) => c.siteId === s.id && c.month === month) ?? null;
        const lastCheck = d.checks.filter((c) => c.siteId === s.id && c.doneAt).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null;
        const missing = [!o.itAdminId && 'IT administrator', !o.backupId && 'backup administrator', !o.contentOwnerId && 'content owner', !o.approverId && 'content approver'].filter(
          Boolean,
        ) as string[];
        return {
          site: seesVault ? s : { ...s, vault: null, repoRef: s.repoRef ? '(IT only)' : '' },
          companyName: coName(s.companyId),
          owners: { ...o, itAdmin: name(o.itAdminId), backup: name(o.backupId), contentOwner: name(o.contentOwnerId), approver: name(o.approverId) },
          missing,
          domains: d.domains.filter((x) => s.domainIds.includes(x.id)).map((x) => x.name),
          currentReview: current ? { id: current.id, ...this.reviewState(current, today) } : null,
          lastReview: last ? { quarter: last.quarter, at: last.completed?.at ?? null, outstanding: last.completed?.outstanding.length ?? 0 } : null,
          monthly: check ? this.checkState(check, today, d.settings) : null,
          lastCheckOn: lastCheck?.doneAt ? dateOf(lastCheck.doneAt) : null,
          openIssues: d.issues.filter((i) => i.siteId === s.id && (i.status === 'open' || i.status === 'in_progress')).length,
          critical: d.issues.some((i) => i.siteId === s.id && i.severity === 'critical' && (i.status === 'open' || i.status === 'in_progress')),
          canEdit: canEditRecords || o.itAdminId === user.id || o.backupId === user.id,
        };
      });

    const domainRows = d.domains
      .filter((x) => x.companyIds.some((c) => visible.has(c)))
      .map((x) => ({
        domain: seesVault ? x : { ...x, vault: null, accountOwner: v.finance && x.renewalOwnerId === user.id ? x.accountOwner : '(IT only)' },
        companyNames: x.companyIds.map(coName),
        renewalOwner: name(x.renewalOwnerId),
        itAdmin: name(x.itAdminId),
        backup: name(x.backupId),
        sites: d.sites.filter((s) => s.domainIds.includes(x.id)).map((s) => s.name),
        ...this.domainState(x, today, d.settings),
        dnsDrift: !!(x.observed?.dns && x.observed.dnsBaseline && x.observed.dns.fingerprint !== x.observed.dnsBaseline.fingerprint),
        expiryMismatch: !!(x.observed?.registrar?.expiresOn && x.expiresOn && x.observed.registrar.expiresOn !== x.expiresOn),
        canEdit: canEditRecords || x.itAdminId === user.id || x.backupId === user.id,
        canConfirmRenewal: canEditRecords || x.itAdminId === user.id || x.backupId === user.id || x.renewalOwnerId === user.id,
      }))
      .sort((a, b) => (a.days ?? -9999) - (b.days ?? -9999));

    const reviewRows = d.reviews
      .filter((r) => visible.has(r.companyId) && (r.quarter === quarter.key || r.stage !== 'done'))
      .map((r) => {
        const s = d.sites.find((x) => x.id === r.siteId);
        const o = this.owners(s ?? null, d.profiles.find((p) => p.companyId === r.companyId));
        return {
          review: r,
          siteName: s?.name ?? r.siteId,
          url: s?.url ?? '',
          companyName: coName(r.companyId),
          owners: { ...o, itAdmin: name(o.itAdminId), contentOwner: name(o.contentOwnerId), approver: name(o.approverId) },
          ...this.reviewState(r, today),
          can: this.reviewPermissions(v, r, o, d.users),
        };
      })
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.review.quarter.localeCompare(b.review.quarter) || a.companyName.localeCompare(b.companyName));

    const socialRows = d.profiles
      .flatMap((p) =>
        (p.social ?? []).filter(a => visible.has(p.companyId) || (v.it && a.itAdminId === user.id)).map((a) => ({
          account: seesVault ? a : { ...a, vault: null },
          companyName: coName(p.companyId),
          platform: SOCIAL_PLATFORMS[a.platform],
          flags: socialFlags(a, today),
          itAdmin: name(a.itAdminId ?? p.itAdminId),
          canEdit: v.itHead || v.admin || (v.it && a.itAdminId === user.id),
        })),
      )
      .sort((a, b) => b.flags.length - a.flags.length || a.companyName.localeCompare(b.companyName));
    const mailRows = d.domains
      .filter((x) => x.companyIds.some((c) => visible.has(c)) && (x.m365Email || x.mail))
      .map((x) => ({
        domainId: x.id,
        name: x.name,
        companyNames: x.companyIds.map(coName),
        health: x.mail ?? null,
        flags: mailFlags(x.mail),
        itAdmin: name(x.itAdminId),
        canEdit: v.itHead || v.admin || (v.it && (x.itAdminId === user.id || x.backupId === user.id)),
      }))
      .sort((a, b) => b.flags.length - a.flags.length);
    const mailboxRows = d.companies
      .filter((c) => visible.has(c.id) && (d.domains.some((x) => x.m365Email && x.companyIds.includes(c.id)) || d.profiles.some((p) => p.companyId === c.id && p.mailboxes)))
      .map((c) => {
        const m = d.profiles.find((p) => p.companyId === c.id)?.mailboxes;
        return { companyId: c.id, companyName: c.name, mailboxes: m ?? null, flags: mailboxFlags(m, today), canEdit: v.it || v.admin };
      })
      .sort((a, b) => b.flags.length - a.flags.length);

    const checkRows = d.checks
      .filter((c) => visible.has(c.companyId) && (c.month === month || !c.doneAt))
      .map((c) => {
        const t = this.checkTarget(c, d);
        const s = t.site;
        const o = t.owners;
        return {
          check: c,
          kind: c.kind ?? 'site',
          siteName: t.name,
          url: t.url,
          companyName: coName(c.companyId),
          assignedTo: name(c.assignedToId ?? o.itAdminId),
          status: this.checkState(c, today, d.settings),
          canRecord: v.itHead || (v.it && (c.assignedToId === user.id || o.itAdminId === user.id || o.backupId === user.id)),
        };
      })
      .sort((a, b) => a.companyName.localeCompare(b.companyName));

    const policies=await this.ticketPolicies(user);
    const issueRows = d.issues
      .filter((i) => visible.has(i.companyId) || i.reportedById===user.id || (v.it && i.ownerId === user.id))
      .map((i) => ({
        issue: i,
        companyName: coName(i.companyId),
        siteName: d.sites.find((s) => s.id === i.siteId)?.name ?? null,
        owner: name(i.ownerId),
        escalateTo: name(i.escalateToId),
        late: (i.status === 'open' || i.status === 'in_progress') && i.targetOn < today,
        canWork: i.itTicketId ? (v.it && i.ownerId === user.id) : v.itHead || (v.it && i.ownerId === user.id),
        ticketPolicy:i.itTicketId?policies[i.itTicketId]??null:null,
        legacyActions:i.itTicketId?null:{canAssign:visible.has(i.companyId)&&v.itHead,canClose:i.status==='resolved'&&(visible.has(i.companyId)||(v.it&&i.ownerId===user.id))&&(v.itHead||i.reportedById===user.id),canReopen:(i.status==='resolved'||i.status==='closed')&&(visible.has(i.companyId)||(v.it&&i.ownerId===user.id))&&(v.itHead||i.reportedById===user.id)},
      }))
      .sort((a, b) => Number(a.issue.status === 'closed' || a.issue.status === 'resolved') - Number(b.issue.status === 'closed' || b.issue.status === 'resolved') || sevRank(a.issue.severity) - sevRank(b.issue.severity));

    const dnsRows = d.dns
      .filter((c) => {
        const dom = d.domains.find((x) => x.id === c.domainId);
        return !!dom && dom.companyIds.some((id) => visible.has(id));
      })
      .map((c) => ({
        change: c,
        domainName: d.domains.find((x) => x.id === c.domainId)?.name ?? c.domainId,
        m365: d.domains.find((x) => x.id === c.domainId)?.m365Email ?? null,
        owner: name(c.ownerId),
        canWork: v.itHead || (v.it && c.ownerId === user.id),
        canApprove: (v.tech || v.admin) && c.status === 'draft' && c.raisedById !== user.id && c.pre.every((p) => p.doneAt),
      }))
      .sort((a, b) => b.change.at.localeCompare(a.change.at));

    // Company register and coverage, from the company master: never a fixed number.
    const companyRows = d.companies
      .filter((c) => visible.has(c.id))
      .map((c) => this.companyRow(c, d, today, quarter.key, name))
      .sort((a, b) => a.company.name.localeCompare(b.company.name));
    const seesCoverage = v.group || v.itHead;
    const coverage = seesCoverage ? this.coverage(companyRows) : null;

    const complianceQueue = v.compliance || v.proxy
      ? d.reviews
          .filter((r) => r.stage === 'compliance')
          .map((r) => ({
            reviewId: r.id,
            companyName: coName(r.companyId),
            siteName: d.sites.find((s) => s.id === r.siteId)?.name ?? r.siteId,
            changes: r.changes.map((c, i) => ({ ...c, index: i })).filter((c) => c.compliance && !c.complianceDecision),
          }))
      : [];

    const todo = this.todo(v, { siteRows, domainRows, reviewRows, checkRows, issueRows, dnsRows, complianceQueue, settings: d.settings, today });
    // Social media and email work for the people who own it; the IT Head sees one line each.
    const mineSocial = socialRows.filter((a) => a.flags.length && a.account.itAdminId === user.id);
    for (const a of mineSocial) todo.push({ tone: 'warn', text: `${a.platform} ${a.account.name}: ${a.flags[0]}${a.flags.length > 1 ? ` (+${a.flags.length - 1} more)` : ''}`, go: { tab: 'social', id: a.account.id } });
    if (v.itHead || v.group) {
      const nS = socialRows.filter((a) => a.flags.length).length;
      const nM = mailRows.filter((m) => m.flags.length).length + mailboxRows.filter((m) => m.flags.length).length;
      if (nS) todo.push({ tone: 'warn', text: `${nS} social media account${nS === 1 ? '' : 's'} need attention`, go: { tab: 'social', id: '' } });
      if (nM) todo.push({ tone: 'warn', text: `${nM} email domain or mailbox review${nM === 1 ? '' : 's'} need attention`, go: { tab: 'email', id: '' } });
    }

    const kpis = {
      companies: companyRows.length,
      liveSites: siteRows.filter((s) => s.site.status === 'live').length,
      offlineOrCritical: siteRows.filter((s) => s.site.status === 'offline' || s.critical).length,
      reviewsDone: reviewRows.filter((r) => r.review.quarter === quarter.key && r.review.stage === 'done').length,
      reviewsOpen: reviewRows.filter((r) => r.review.quarter === quarter.key && r.review.stage !== 'done' && !r.overdue).length,
      reviewsOverdue: reviewRows.filter((r) => r.overdue).length,
      expiring30: domainRows.filter((x) => x.days != null && x.days >= 0 && x.days <= 30).length,
      expiring60: domainRows.filter((x) => x.days != null && x.days >= 0 && x.days <= 60).length,
      expired: domainRows.filter((x) => x.status === 'expired').length,
      critical: issueRows.filter((i) => i.issue.severity === 'critical' && (i.issue.status === 'open' || i.issue.status === 'in_progress')).length,
      checksDue: checkRows.filter((c) => c.status === 'not_started' || c.status === 'in_progress').length,
      checksOverdue: checkRows.filter((c) => c.status === 'overdue').length,
      awaitingApproval: reviewRows.filter((r) => r.review.stage === 'approval').length,
      awaitingCompany: reviewRows.filter((r) => r.review.stage === 'request').length,
      awaitingPublish: reviewRows.filter((r) => r.review.stage === 'publish').length,
      failedTests: reviewRows.reduce((n, r) => n + r.review.tests.filter((t) => t.result === 'fail').length, 0),
      missingOwners: siteRows.filter((s) => s.missing.length).length,
      dnsUpcoming: dnsRows.filter((c) => c.change.status === 'draft' || c.change.status === 'approved').length,
      socialAccounts: socialRows.filter((a) => a.account.status !== 'closed').length,
      socialFlagged: socialRows.filter((a) => a.flags.length).length,
      mailDomains: mailRows.length,
      mailFlagged: mailRows.filter((m) => m.flags.length).length + mailboxRows.filter((m) => m.flags.length).length,
    };

    const itTeam = d.users.filter((u) => u.department === 'it').map((u) => ({ id: u.id, name: u.name, itRole: u.itRole ?? null }));
    const workload = v.itHead || v.group
      ? itTeam.map((t) => ({
          ...t,
          sites: siteRows.filter((s) => s.owners.itAdminId === t.id).length,
          backupFor: siteRows.filter((s) => s.owners.backupId === t.id).length,
          checksOpen: checkRows.filter((c) => c.status !== 'completed' && c.status !== 'completed_issues' && c.status !== 'na' && (c.check.assignedToId ?? siteRows.find((s) => s.site.id === c.check.siteId)?.owners.itAdminId) === t.id).length,
          reviewsOpen: reviewRows.filter((r) => r.review.stage !== 'done' && r.owners.itAdminId === t.id).length,
          issuesOpen: issueRows.filter((i) => i.issue.ownerId === t.id && (i.issue.status === 'open' || i.issue.status === 'in_progress')).length,
        }))
      : [];

    // People who can be named as owners.
    const people = v.itHead || v.group
      ? d.users
          .filter((u) => !u.integration && u.role !== 'site_device' && u.role !== 'guard' && u.role !== 'supervisor')
          .map((u) => ({ id: u.id, name: u.name, title: u.title, role: u.role, department: u.department ?? null, companyIds: u.companyIds }))
      : [];

    return {
      allowed: true as const,
      role: {
        admin: v.admin,
        tech: v.tech,
        proxy: v.proxy,
        itHead: v.itHead,
        canDelegateIssue:webManager(user),
        it: v.it,
        group: v.group,
        cos: v.cos,
        compliance: v.compliance,
        finance: v.finance,
        head: user.role === 'company_manager',
        company: user.role === 'company_manager' || user.role === 'admin_exec',
      },
      today,
      quarter,
      month,
      settings: { id: d.settings.id, domainReminderDays: d.settings.domainReminderDays, renewalEscalateDays: d.settings.renewalEscalateDays, requestDay: d.settings.requestDay, responseDays: d.settings.responseDays, approvalDays: d.settings.approvalDays, responseReminderDays: d.settings.responseReminderDays, monthlyDueDay: d.settings.monthlyDueDay, issueTargetHours: d.settings.issueTargetHours, escalationIds: d.settings.escalationIds, blockSelfApproval: d.settings.blockSelfApproval, autoSchedule: d.settings.autoSchedule, checkReminderDays: d.settings.checkReminderDays, overdueEscalateDays: d.settings.overdueEscalateDays, lastScheduleRun: d.settings.lastScheduleRun, updatedBy: d.settings.updatedBy, updatedAt: d.settings.updatedAt },
      integrations: (Object.keys(CONNECTOR_INFO) as ConnectorKey[]).map((key) => ({
        key,
        ...CONNECTOR_INFO[key],
        on: d.settings.connectorsOn[key],
        state: v.itHead || v.admin ? (d.settings.connectorState[key] ? { ...d.settings.connectorState[key]!, error: d.settings.connectorState[key]!.error ? safeConnectorError(d.settings.connectorState[key]!.error) : '' } : null) : null,
      })),
      spInbox: v.itHead || v.admin ? d.settings.spInbox.filter((x) => x.state === 'new') : [],
      canConnect: v.admin,
      canSync: v.itHead || v.admin,
      schedule: {
        auto: d.settings.autoSchedule,
        lastRun: d.settings.lastScheduleRun,
        /** Opening the module runs it for these people; the IT Head and the CEO may also run it by hand. */
        runs: v.it || v.group || v.admin,
        canForce: v.itHead || v.admin,
      },
      kpis,
      coverage,
      companies: companyRows,
      sites: siteRows,
      social: socialRows,
      mail: mailRows,
      mailboxes: mailboxRows,
      platforms: SOCIAL_PLATFORMS,
      domains: domainRows,
      reviews: reviewRows,
      checks: checkRows,
      issues: issueRows,
      dns: dnsRows,
      complianceQueue,
      todo,
      workload,
      itTeam,
      people,
      notices: d.notices.filter((n) => n.toUserId === user.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30),
      lists: { topics: REVIEW_TOPICS, tests: REVIEW_TESTS, monthly: MONTHLY_ITEMS,
        social: SOCIAL_ITEMS,
        mail: MAIL_ITEMS, dnsPre: DNS_PRE, dnsPost: DNS_POST },
    };
  }

  private companyRow(c: Company, d: Awaited<ReturnType<WebsiteService['load']>>, today: IsoDate, quarterKey: string, name: (id: Id | null | undefined) => string | null) {
    const profile = d.profiles.find((p) => p.companyId === c.id);
    const domains = d.domains.filter((x) => x.companyIds.includes(c.id));
    const sites = d.sites.filter((s) => s.companyId === c.id && s.status !== 'retired');
    const live = sites.filter((s) => s.status === 'live');
    const states = domains.map((x) => this.domainState(x, today, d.settings).status);
    const domainStatus: 'none' | 'active' | 'expiring' | 'expired' | 'unknown' = !domains.length
      ? 'none'
      : states.includes('expired')
        ? 'expired'
        : states.includes('expiring')
          ? 'expiring'
          : states.includes('unknown')
            ? 'unknown'
            : 'active';
    const websiteStatus: 'live' | 'development' | 'offline' | 'none' | 'not_required' = live.length
      ? 'live'
      : sites.some((s) => s.status === 'offline')
        ? 'offline'
        : sites.some((s) => s.status === 'development')
          ? 'development'
          : profile?.websiteRequired === 'no'
            ? 'not_required'
            : 'none';
    const reviews = d.reviews.filter((r) => r.companyId === c.id);
    const current = reviews.filter((r) => r.quarter === quarterKey);
    const states2 = current.map((r) => this.reviewState(r, today).label);
    const overduePast = reviews.some((r) => r.quarter < quarterKey && r.stage !== 'done');
    const quarterStatus: 'not_started' | 'in_progress' | 'awaiting_approval' | 'completed' | 'overdue' | 'not_applicable' = !live.length
      ? 'not_applicable'
      : states2.includes('overdue') || overduePast
        ? 'overdue'
        : !current.length || states2.every((s) => s === 'not_started')
          ? 'not_started'
          : states2.every((s) => s === 'completed')
            ? 'completed'
            : states2.includes('awaiting_approval')
              ? 'awaiting_approval'
              : 'in_progress';
    const last = reviews.filter((r) => r.stage === 'done').sort((a, b) => (b.completed?.at ?? '').localeCompare(a.completed?.at ?? ''))[0];
    const heads = this.headsOf(d.users, c.id);
    const missing: string[] = [];
    if (!profile) missing.push('website set-up not recorded');
    else {
      if (!profile.itAdminId && !sites.some((s) => s.itAdminId)) missing.push('IT administrator');
      if (!profile.backupId && !sites.some((s) => s.backupId)) missing.push('backup administrator');
      if (!profile.contentOwnerId && !sites.some((s) => s.contentOwnerId)) missing.push('content owner');
      if (!profile.approverId && !sites.some((s) => s.approverId)) missing.push('content approver');
      if (profile.websiteRequired === 'under_review') missing.push('website needed? under review');
    }
    if (!heads.length && /to be named/i.test(c.headOfCompany)) missing.push('Head of Company');
    if (domains.some((x) => !x.expiresOn)) missing.push('domain expiry date');
    const openIssues = d.issues
      .filter((i) => i.companyId === c.id && (i.status === 'open' || i.status === 'in_progress'))
      .sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
    return {
      company: c,
      profile: profile ?? null,
      head: heads.length ? heads.map((h) => h.name).join(', ') : c.headOfCompany,
      websiteRequired: profile?.websiteRequired ?? 'under_review',
      notRequired: profile?.notRequired ?? null,
      itAdmin: name(profile?.itAdminId),
      backup: name(profile?.backupId),
      contentOwner: name(profile?.contentOwnerId),
      approver: name(profile?.approverId),
      domainCount: domains.length,
      siteCount: sites.length,
      liveCount: live.length,
      domainStatus,
      websiteStatus,
      lastReview: last ? { quarter: last.quarter, at: last.completed?.at ?? null, outstanding: last.completed?.outstanding.length ?? 0 } : null,
      quarterStatus,
      mainIssue: openIssues[0] ? `${openIssues[0].severity}: ${openIssues[0].description}` : null,
      missing,
      incomplete: missing.length > 0 || domainStatus === 'unknown',
    };
  }

  private coverage(rows: ReturnType<WebsiteService['companyRow']>[]) {
    const ids = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).map((r) => r.company.id);
    return {
      total: rows.length,
      live: ids((r) => r.websiteStatus === 'live'),
      domainNoSite: ids((r) => r.domainCount > 0 && r.websiteStatus !== 'live'),
      noDomain: ids((r) => r.domainCount === 0),
      noSite: ids((r) => r.siteCount === 0),
      neither: ids((r) => r.domainCount === 0 && r.siteCount === 0),
      missingOwners: ids((r) => r.missing.some((m) => /administrator|owner|approver|Head of Company/.test(m))),
      overdue: ids((r) => r.quarterStatus === 'overdue'),
      notRequired: ids((r) => r.websiteStatus === 'not_required'),
      incomplete: ids((r) => r.incomplete),
    };
  }

  private reviewPermissions(v: Viewer, r: WebReview, o: ReturnType<WebsiteService['owners']>, users: User[]) {
    const id = v.user.id;
    const isHead = v.user.role === 'company_manager' && v.user.companyIds.includes(r.companyId);
    const isOwner = o.contentOwnerId === id;
    const isIt = v.itHead || (v.it && (o.itAdminId === id || o.backupId === id));
    const isApprover = o.approverId === id;
    void users;
    const proxy = v.proxy;
    return {
      respond: r.stage === 'request' && (isOwner || isHead || proxy),
      verify: r.stage === 'verify' && (isHead || isOwner || isApprover || proxy) && r.response?.byId !== id,
      prepare: r.stage === 'prepare' && isIt,
      approve: r.stage === 'approval' && (isApprover || proxy),
      publish: r.stage === 'publish' && isIt,
      test: r.stage === 'test' && isIt,
      complete: r.stage === 'complete' && isIt,
    };
  }

  private todo(
    v: Viewer,
    x: {
      siteRows: { site: WebSite; owners: { itAdminId: Id | null; backupId: Id | null }; missing: string[]; companyName: string }[];
      domainRows: { domain: WebDomain; days: number | null; reminder: number | null; escalate: boolean; canConfirmRenewal: boolean }[];
      reviewRows: { review: WebReview; siteName: string; companyName: string; overdue: boolean; can: Record<string, boolean>; stageLabel: string }[];
      checkRows: { check: WebCheck; siteName: string; status: CheckStatus; canRecord: boolean }[];
      issueRows: { issue: WebIssue; late: boolean; companyName: string }[];
      dnsRows: { change: WebDnsChange; domainName: string; canApprove: boolean; canWork: boolean }[];
      complianceQueue: { reviewId: Id; siteName: string; changes: unknown[] }[];
      settings: WebSettings;
      today: IsoDate;
    },
  ) {
    type Todo = { tone: 'crit' | 'warn' | 'info'; text: string; go: { tab: string; id: Id } };
    const out: Todo[] = [];
    const id = v.user.id;
    for (const r of x.reviewRows) {
      const act = Object.entries(r.can).find(([, ok]) => ok)?.[0];
      if (act) out.push({ tone: r.overdue ? 'crit' : 'warn', text: `${r.companyName}, ${r.siteName}: ${r.stageLabel} (${r.review.quarter})${r.overdue ? ', overdue' : ''}`, go: { tab: 'reviews', id: r.review.id } });
      else if (r.overdue && (v.itHead || v.cos || v.group) && r.review.stage === 'request')
        out.push({ tone: 'crit', text: `${r.companyName}, ${r.siteName}: company has not answered the ${r.review.quarter} review`, go: { tab: 'reviews', id: r.review.id } });
    }
    for (const q of x.complianceQueue) out.push({ tone: 'warn', text: `${q.siteName}: ${q.changes.length} claim${q.changes.length === 1 ? '' : 's'} to verify`, go: { tab: 'reviews', id: q.reviewId } });
    // The IT Head sees the monthly checks as one line; each checker sees their own.
    const openChecks = x.checkRows.filter((c) => c.canRecord && (c.status === 'not_started' || c.status === 'in_progress' || c.status === 'overdue'));
    const own = v.itHead ? openChecks.filter((c) => c.check.assignedToId === id) : openChecks;
    for (const c of own)
      out.push({ tone: c.status === 'overdue' ? 'crit' : 'info', text: `Monthly check ${c.check.month}: ${c.siteName}${c.status === 'overdue' ? ' (overdue)' : ''}`, go: { tab: 'checks', id: c.check.id } });
    if (v.itHead) {
      const late = openChecks.filter((c) => c.status === 'overdue' && c.check.assignedToId !== id).length;
      const due = openChecks.filter((c) => c.status !== 'overdue' && c.check.assignedToId !== id).length;
      if (late) out.push({ tone: 'crit', text: `${late} monthly check${late === 1 ? '' : 's'} overdue across the team`, go: { tab: 'checks', id: '' } });
      if (due) out.push({ tone: 'info', text: `${due} monthly check${due === 1 ? '' : 's'} due across the team`, go: { tab: 'checks', id: '' } });
    }
    for (const dRow of x.domainRows) {
      const mine = dRow.domain.renewalOwnerId === id || (v.itHead && dRow.canConfirmRenewal) || dRow.canConfirmRenewal;
      const mgmt = (v.group || v.cos) && dRow.escalate;
      if (dRow.reminder != null && (mine || mgmt))
        out.push({
          tone: dRow.escalate ? 'crit' : 'warn',
          text: `${dRow.domain.name}: ${dRow.days! < 0 ? `expired ${-dRow.days!} days ago` : `expires in ${dRow.days} days`}${dRow.escalate ? ', renewal not confirmed' : ''}`,
          go: { tab: 'domains', id: dRow.domain.id },
        });
    }
    for (const i of x.issueRows)
      if ((i.issue.ownerId === id || (v.itHead && !i.issue.ownerId) || i.issue.escalateToId === id) && (i.issue.status === 'open' || i.issue.status === 'in_progress'))
        out.push({ tone: i.issue.severity === 'critical' || i.late ? 'crit' : 'warn', text: `${i.issue.ref} ${i.companyName}: ${i.issue.description}`, go: { tab: 'issues', id: i.issue.id } });
    for (const c of x.dnsRows) {
      if (c.canApprove) out.push({ tone: 'warn', text: `DNS change ${c.change.ref} on ${c.domainName} to approve`, go: { tab: 'dns', id: c.change.id } });
      else if (c.canWork && c.change.status === 'approved') out.push({ tone: 'info', text: `DNS change ${c.change.ref} on ${c.domainName}: run and test`, go: { tab: 'dns', id: c.change.id } });
    }
    if (v.itHead) {
      const missing = x.siteRows.filter((s) => s.missing.length && s.site.status === 'live');
      if (missing.length) out.push({ tone: 'warn', text: `${missing.length} live website${missing.length === 1 ? '' : 's'} missing an owner or backup`, go: { tab: 'sites', id: '' } });
    }
    const rank = { crit: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  }

  // ---------- Actions ----------

  /** One door for every change in the module, so each is checked and audited the same way. */
  async act(user: User, action: string, input: Record<string, unknown>): Promise<unknown> {
    if (user.integration) throw new BadRequest('A connected app cannot work here.');
    const access = this.viewer(user);
    if (action === 'runSchedule' && !access.it && !access.group && !access.admin) throw new BadRequest('Only IT or group management runs the website schedule.');
    if (action === 'runSchedule' && input.force === true && !access.itHead && !access.admin) throw new BadRequest('Only the IT Head or CEO runs the schedule by hand.');
    if (!this.mutationLocked) return this.serialize(svc => svc.act(user, action, input));
    const current=await this.store.get('users',user.id);
    if(!webActive(current,this.today()))throw new BadRequest('Current personal sign-in required.');
    const v = this.viewer(current);
    const fn = (
      {
        saveSettings: () => this.saveSettings(v, input),
        saveCompany: () => this.saveCompany(v, input),
        saveDomain: () => this.saveDomain(v, input),
        confirmRenewal: () => this.confirmRenewal(v, input),
        recordPayment: () => this.recordPayment(v, input),
        saveSite: () => this.saveSite(v, input),
        openReviews: () => this.openReviews(v, input),
        respond: () => this.respond(v, input),
        verify: () => this.verify(v, input),
        complianceDecide: () => this.complianceDecide(v, input),
        prepare: () => this.prepare(v, input),
        approve: () => this.approve(v, input),
        publish: () => this.publish(v, input),
        test: () => this.test(v, input),
        complete: () => this.complete(v, input),
        openChecks: () => this.openChecks(v, input),
        recordCheck: () => this.recordCheck(v, input),
        raiseIssue: () => this.raiseIssue(v, input),
        issueStep: () => this.issueStep(v, input),
        urgentChange: () => this.urgentChange(v, input),
        raiseDns: () => this.raiseDns(v, input),
        dnsStep: () => this.dnsStep(v, input),
        runSchedule: () => this.runSchedule(v, input),
        setConnector: () => this.setConnector(v, input),
        acceptDns: () => this.acceptDns(v, input),
        spDecide: () => this.spDecide(v, input),
        saveSocial: () => this.saveSocial(v, input),
        reviewSocialAccess: () => this.reviewSocialAccess(v, input),
        saveMailHealth: () => this.saveMailHealth(v, input),
        saveMailboxes: () => this.saveMailboxes(v, input),
      } as Record<string, () => Promise<unknown>>
    )[action];
    if (!fn) throw new BadRequest(`Unknown website action ${action}.`);
    return fn();
  }

  private async audit(tx: Store, user: User, companyId: Id | null, action: string, entity: string, entityId: Id, summary: string) {
    await tx.audit({ at: this.now(), actor: user.name, companyId, action: `web.${action}`, entity, entityId, summary });
  }

  /** With a key, a person who already has that notice is skipped and the number sent is returned. */
  private async notify(tx: Store, toIds: (Id | null | undefined)[], title: string, link: WebNotice['link'], key?: { base: string; sent: Set<string> }) {
    const at = this.now();
    const seen = new Set<Id>();
    let n = 0;
    for (const to of toIds) {
      if (!to || seen.has(to)) continue;
      seen.add(to);
      const k = key ? `${key.base}:${to}` : undefined;
      if (k && key!.sent.has(k)) continue;
      if (k) key!.sent.add(k);
      await tx.insert('webNotices', {
        id: `wn-${toMs(at)}-${Math.random().toString(36).slice(2, 8)}-${to}`,
        at,
        toUserId: to,
        title,
        link,
        delivery: { inApp: 'delivered', email: 'not_connected', teams: 'not_connected' },
        ...(k ? { key: k } : {}),
      });
      n += 1;
    }
    return n;
  }

  private async itHeadIds(): Promise<Id[]> {
    return (await this.store.list('users', {})).filter((u) => u.department === 'it' && (u.itRole === 'manager' || u.itRole === 'lead')).map((u) => u.id);
  }

  private text(v: unknown, what: string, min = 1, max = 2000): string {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length < min) throw new BadRequest(`Give ${what}.`);
    return s.slice(0, max);
  }

  private policyText(v:unknown,what:string,min:number,max:number):string {
    const value=typeof v==='string'?v.trim():'';
    if(value.length<min||value.length>max)throw new BadRequest(`${what} must be ${min}–${max} characters; evidence is never truncated.`);
    return value;
  }

  private opt(v: unknown, max = 2000): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  private date(v: unknown, what: string, required = false): IsoDate | null {
    if (v == null || v === '') {
      if (required) throw new BadRequest(`Give ${what}.`);
      return null;
    }
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequest(`${what} must be a date like 2026-12-31.`);
    return v as IsoDate;
  }

  private async userId(v: unknown, what: string, check?: (u: User) => boolean): Promise<Id | null> {
    if (v == null || v === '') return null;
    const u = await this.store.get('users', String(v));
    if (!u) throw new BadRequest(`${what}: person not found.`);
    if (check && !check(u)) throw new BadRequest(`${what}: ${u.name} cannot hold this job.`);
    return u.id;
  }

  private async saveSettings(v: Viewer, i: Record<string, unknown>) {
    if (!v.admin) throw new BadRequest('Only the CEO, as owner and master administrator, changes website settings.');
    await this.store.lock?.('webSettings', 'settings');
    const cur = await this.settings();
    const nums = (x: unknown, fallback: number, lo: number, hi: number) => {
      const n = Number(x);
      return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : fallback;
    };
    const reminders = Array.isArray(i.domainReminderDays)
      ? [...new Set((i.domainReminderDays as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 365))].sort((a, b) => b - a)
      : cur.domainReminderDays;
    if (!reminders.length) throw new BadRequest('Keep at least one domain reminder.');
    const responseDays = nums(i.responseDays, cur.responseDays, 1, 85);
    const approvalDays = nums(i.approvalDays, cur.approvalDays, responseDays, 89);
    const escalationIds = Array.isArray(i.escalationIds)
      ? (await Promise.all((i.escalationIds as unknown[]).map((x) => this.userId(x, 'Escalation')))).filter((x): x is Id => !!x)
      : cur.escalationIds;
    const s: WebSettings = {
      ...cur,
      domainReminderDays: reminders,
      renewalEscalateDays: nums(i.renewalEscalateDays, cur.renewalEscalateDays, 0, 60),
      requestDay: nums(i.requestDay, cur.requestDay, 0, 30),
      responseDays,
      approvalDays,
      responseReminderDays: nums(i.responseReminderDays, cur.responseReminderDays, 0, 30),
      monthlyDueDay: nums(i.monthlyDueDay, cur.monthlyDueDay, 1, 28),
      escalationIds,
      blockSelfApproval: typeof i.blockSelfApproval === 'boolean' ? i.blockSelfApproval : cur.blockSelfApproval,
      autoSchedule: typeof i.autoSchedule === 'boolean' ? i.autoSchedule : cur.autoSchedule,
      checkReminderDays: nums(i.checkReminderDays, cur.checkReminderDays, 0, 27),
      overdueEscalateDays: nums(i.overdueEscalateDays, cur.overdueEscalateDays, 0, 60),
      updatedBy: v.user.name,
      updatedAt: this.now(),
    };
    return this.store.transaction(async (tx) => {
      if (await tx.get('webSettings', 'settings')) await tx.update('webSettings', 'settings', s);
      else await tx.insert('webSettings', s);
      await this.audit(tx, v.user, null, 'settings', 'webSettings', 'settings', `Website settings changed: reminders ${reminders.join('/')} days, company answers by day ${responseDays}, approval by day ${approvalDays}`);
      return s;
    });
  }

  private async saveCompany(v: Viewer, i: Record<string, unknown>) {
    const companyId = this.text(i.companyId, 'the company');
    const company = await this.store.get('companies', companyId);
    if (!company) throw new NotFound('Company');
    if (!v.itHead && !v.group) throw new BadRequest('Only the IT Head or group management sets who looks after a company website.');
    const isIt = (u: User) => u.department === 'it';
    const business = (u: User) => !u.integration && u.role !== 'site_device' && u.role !== 'guard';
    const required = (['yes', 'no', 'under_review'] as const).find((x) => x === i.websiteRequired) ?? 'under_review';
    const existing = (await this.store.list('webCompanies', { companyId }))[0];
    let notRequired = existing?.notRequired ?? null;
    if (required === 'no' && (!notRequired || this.opt(i.notRequiredReason))) {
      const reason = this.text(i.notRequiredReason, 'the reason no website is needed', 5);
      notRequired = { reason, by: v.user.name, byId: v.user.id, at: this.now() };
    }
    if (required !== 'no') notRequired = null;
    const row: WebCompany = {
      id: existing?.id ?? `wc-${companyId}`,
      companyId,
      websiteRequired: required,
      notRequired,
      itAdminId: await this.userId(i.itAdminId, 'IT administrator', isIt),
      backupId: await this.userId(i.backupId, 'Backup administrator', isIt),
      contentOwnerId: await this.userId(i.contentOwnerId, 'Content owner', business),
      approverId: await this.userId(i.approverId, 'Content approver', business),
      note: this.opt(i.note, 500),
    };
    if (row.itAdminId && row.itAdminId === row.backupId) throw new BadRequest('The backup administrator must be a different person.');
    return this.store.transaction(async (tx) => {
      if (existing) await tx.update('webCompanies', existing.id, row);
      else await tx.insert('webCompanies', row);
      await this.audit(
        tx,
        v.user,
        companyId,
        'company.save',
        'webCompany',
        row.id,
        `${company.name}: website ${required === 'no' ? `not required (${notRequired?.reason})` : required === 'yes' ? 'required' : 'under review'}; owners updated`,
      );
      return row;
    });
  }

  private async saveDomain(v: Viewer, i: Record<string, unknown>) {
    const id = this.opt(i.id);
    const existing = id ? await this.store.get('webDomains', id) : undefined;
    if (id && !existing) throw new NotFound('Domain');
    const assigned = existing && (existing.itAdminId === v.user.id || existing.backupId === v.user.id);
    if (!v.itHead && !assigned) throw new BadRequest('Only the IT Head or the domain’s IT administrators change domain details.');
    const name = this.text(i.name, 'the domain name', 3, 120).toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) throw new BadRequest('The domain name looks wrong (like company.com.my, no https:// or www).');
    for (const k of ['password', 'authCode', 'recoveryCode', 'privateKey']) if (i[k]) throw new BadRequest('Do not put passwords or codes here. Record only where they are kept in the password manager.');
    const companyIds = Array.isArray(i.companyIds) ? [...new Set((i.companyIds as unknown[]).map(String))] : (existing?.companyIds ?? []);
    if (!companyIds.length) throw new BadRequest('Link the domain to at least one company.');
    for (const c of companyIds) if (!(await this.store.get('companies', c))) throw new BadRequest(`Company ${c} not found.`);
    const dup = (await this.store.list('webDomains', {})).find((x) => x.name === name && x.id !== id);
    if (dup) throw new BadRequest(`${name} is already in the register.`);
    const expiresOn = this.date(i.expiresOn, 'Expiry date');
    if (existing?.expiresOn && expiresOn && expiresOn > existing.expiresOn)
      throw new BadRequest('A later expiry date is a renewal: use Confirm renewal and give the evidence.');
    const vault = i.vault && typeof i.vault === 'object' ? (i.vault as Record<string, unknown>) : null;
    const isIt = (u: User) => u.department === 'it';
    const row: WebDomain = {
      id: existing?.id ?? `wd-${toMs(this.now())}`,
      name,
      companyIds,
      primary: i.primary !== false,
      registrar: this.opt(i.registrar, 80),
      status: (['active', 'expired', 'pending', 'transferring', 'unknown'] as const).find((x) => x === i.status) ?? 'unknown',
      registeredOn: this.date(i.registeredOn, 'Registration date'),
      expiresOn: existing ? (expiresOn ?? existing.expiresOn) : expiresOn,
      renewOn: this.date(i.renewOn, 'Renewal date'),
      autoRenew: (['on', 'off', 'unknown'] as const).find((x) => x === i.autoRenew) ?? 'unknown',
      renewalAmount: i.renewalAmount == null || i.renewalAmount === '' ? null : Number(i.renewalAmount),
      currency: this.opt(i.currency, 5) || 'MYR',
      renewalOwnerId: await this.userId(i.renewalOwnerId, 'Renewal owner'),
      accountOwner: this.opt(i.accountOwner, 120),
      dnsProvider: this.opt(i.dnsProvider, 80),
      nameservers: Array.isArray(i.nameservers) ? (i.nameservers as unknown[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : (existing?.nameservers ?? []),
      m365Email: typeof i.m365Email === 'boolean' ? i.m365Email : null,
      itAdminId: await this.userId(i.itAdminId, 'IT administrator', isIt),
      backupId: await this.userId(i.backupId, 'Backup administrator', isIt),
      lastVerifiedOn: this.date(i.lastVerifiedOn, 'Last verified'),
      vault: vault ? { manager: this.opt(vault.manager, 60), entry: this.opt(vault.entry, 120), access: this.opt(vault.access, 120) } : (existing?.vault ?? null),
      receiptRef: this.opt(i.receiptRef, 300),
      note: this.opt(i.note, 1000),
      renewals: existing?.renewals ?? [],
      payment: existing?.payment ?? null,
    };
    if (row.renewalAmount != null && !(row.renewalAmount >= 0)) throw new BadRequest('The renewal amount must be a number.');
    return this.store.transaction(async (tx) => {
      if (existing) await tx.update('webDomains', existing.id, row);
      else await tx.insert('webDomains', row);
      await this.audit(tx, v.user, companyIds[0], existing ? 'domain.update' : 'domain.add', 'webDomain', row.id, `${existing ? 'Updated' : 'Added'} domain ${name}`);
      return row;
    });
  }

  /** A domain is renewed only when the new expiry date and the evidence are recorded. */
  private async confirmRenewal(v: Viewer, i: Record<string, unknown>) {
    const x = await this.store.get('webDomains', this.text(i.domainId, 'the domain'));
    if (!x) throw new NotFound('Domain');
    if (!v.itHead && x.itAdminId !== v.user.id && x.backupId !== v.user.id && x.renewalOwnerId !== v.user.id)
      throw new BadRequest('Only the renewal owner or the domain’s IT administrators confirm a renewal.');
    const to = this.date(i.newExpiry, 'the new expiry date', true)!;
    if (x.expiresOn && to <= x.expiresOn) throw new BadRequest('The new expiry date must be later than the current one.');
    if (to <= this.today()) throw new BadRequest('The new expiry date must be in the future.');
    const evidence = this.text(i.evidence, 'the evidence (registrar receipt or invoice reference)', 3, 300);
    const amount = i.amount == null || i.amount === '' ? null : Number(i.amount);
    return this.store.transaction(async (tx) => {
      const saved = await tx.update('webDomains', x.id, {
        expiresOn: to,
        status: 'active',
        lastVerifiedOn: this.today(),
        renewals: [...x.renewals, { at: this.now(), by: v.user.name, from: x.expiresOn, to, evidence, amount }],
      });
      await this.audit(tx, v.user, x.companyIds[0], 'domain.renewed', 'webDomain', x.id, `${x.name} renewed to ${to} (evidence ${evidence})`);
      return saved;
    });
  }

  private async recordPayment(v: Viewer, i: Record<string, unknown>) {
    const x = await this.store.get('webDomains', this.text(i.domainId, 'the domain'));
    if (!x) throw new NotFound('Domain');
    if (x.renewalOwnerId !== v.user.id && !v.itHead) throw new BadRequest('Only the renewal owner records the payment.');
    const status = (['unpaid', 'paid', 'not_due'] as const).find((s) => s === i.status);
    if (!status) throw new BadRequest('Choose paid, unpaid or not due yet.');
    const ref = status === 'paid' ? this.text(i.ref, 'the payment reference', 3, 120) : this.opt(i.ref, 120);
    return this.store.transaction(async (tx) => {
      const saved = await tx.update('webDomains', x.id, { payment: { status, ref, by: v.user.name, at: this.now() } });
      await this.audit(tx, v.user, x.companyIds[0], 'domain.payment', 'webDomain', x.id, `${x.name} renewal payment ${status}${ref ? ` (${ref})` : ''}`);
      return saved;
    });
  }

  private async saveSite(v: Viewer, i: Record<string, unknown>) {
    const id = this.opt(i.id);
    const existing = id ? await this.store.get('webSites', id) : undefined;
    if (id && !existing) throw new NotFound('Website');
    const assigned = existing && (existing.itAdminId === v.user.id || existing.backupId === v.user.id);
    if (!v.itHead && !assigned) throw new BadRequest('Only the IT Head or the website’s IT administrators change hosting and repository details.');
    const companyId = this.text(i.companyId ?? existing?.companyId, 'the company');
    if (!(await this.store.get('companies', companyId))) throw new NotFound('Company');
    const url = this.text(i.url, 'the website address', 4, 200);
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new BadRequest('The website address must start with https://');
    const domainIds = Array.isArray(i.domainIds) ? [...new Set((i.domainIds as unknown[]).map(String))] : (existing?.domainIds ?? []);
    for (const d of domainIds) if (!(await this.store.get('webDomains', d))) throw new BadRequest(`Domain ${d} not found.`);
    const h = (i.hosting && typeof i.hosting === 'object' ? i.hosting : {}) as Record<string, unknown>;
    const c = (i.contact && typeof i.contact === 'object' ? i.contact : {}) as Record<string, unknown>;
    const f = (i.form && typeof i.form === 'object' ? i.form : {}) as Record<string, unknown>;
    const r = (i.recovery && typeof i.recovery === 'object' ? i.recovery : {}) as Record<string, unknown>;
    const cost = (i.cost && typeof i.cost === 'object' ? i.cost : {}) as Record<string, unknown>;
    const vault = i.vault && typeof i.vault === 'object' ? (i.vault as Record<string, unknown>) : null;
    const isIt = (u: User) => u.department === 'it';
    const tri = (x: unknown) => (typeof x === 'boolean' ? x : null);
    const status = (['live', 'development', 'offline', 'retired'] as const).find((s) => s === i.status) ?? 'development';
    const row: WebSite = {
      id: existing?.id ?? `ws-${toMs(this.now())}`,
      name: this.text(i.name, 'the website name', 2, 120),
      companyId,
      purpose: this.opt(i.purpose, 200),
      status,
      url,
      domainIds,
      hosting: { provider: this.opt(h.provider, 60), project: this.opt(h.project, 80), plan: this.opt(h.plan, 40), free: tri(h.free), customDomain: tri(h.customDomain) },
      deploy: (['github', 'direct_upload', 'other', 'unknown'] as const).find((x) => x === i.deploy) ?? 'unknown',
      repoRef: this.opt(i.repoRef, 200),
      sourceRef: this.opt(i.sourceRef, 200),
      itAdminId: await this.userId(i.itAdminId, 'IT administrator', isIt),
      backupId: await this.userId(i.backupId, 'Backup administrator', isIt),
      contentOwnerId: await this.userId(i.contentOwnerId, 'Content owner'),
      approverId: await this.userId(i.approverId, 'Content approver'),
      contact: { phone: this.opt(c.phone, 40), email: this.opt(c.email, 120), whatsapp: this.opt(c.whatsapp, 40) },
      form: { present: tri(f.present), provider: this.opt(f.provider, 60), recipient: this.opt(f.recipient, 120) },
      https: existing?.https ?? { ok: null, checkedOn: null },
      claims: this.opt(i.claims, 1000),
      cost: { hosting: cost.hosting == null || cost.hosting === '' ? null : Number(cost.hosting), extras: this.opt(cost.extras, 200), ownerId: await this.userId(cost.ownerId, 'Cost owner') },
      recovery: { lastGoodVersion: this.opt(r.lastGoodVersion, 120), instructionsRef: this.opt(r.instructionsRef, 200) },
      vault: vault ? { manager: this.opt(vault.manager, 60), entry: this.opt(vault.entry, 120), access: this.opt(vault.access, 120) } : (existing?.vault ?? null),
      reviewException: existing?.reviewException ?? null,
      note: this.opt(i.note, 1000),
    };
    if (row.itAdminId && row.itAdminId === row.backupId) throw new BadRequest('The backup administrator must be a different person.');
    if (i.reviewException !== undefined) {
      if (!v.itHead) throw new BadRequest('Only the IT Head excuses a website from the quarterly review.');
      row.reviewException = i.reviewException ? { reason: this.text(i.reviewException, 'the reason for the exception', 5), by: v.user.name, at: this.now() } : null;
    }
    return this.store.transaction(async (tx) => {
      if (existing) await tx.update('webSites', existing.id, row);
      else await tx.insert('webSites', row);
      await this.audit(tx, v.user, companyId, existing ? 'site.update' : 'site.add', 'webSite', row.id, `${existing ? 'Updated' : 'Added'} website ${row.name} (${url}), ${status}`);
      return row;
    });
  }

  /** What a monthly check is about: its name, address and owners, for a website, a social account or a domain's email. */
  private checkTarget(c: WebCheck, d: { sites: WebSite[]; profiles: WebCompany[]; domains: WebDomain[] }) {
    const profile = d.profiles.find((p) => p.companyId === c.companyId);
    if (c.kind === 'social') {
      const a = profile?.social?.find((x) => x.id === c.siteId);
      const base = this.owners(null, profile);
      return { site: null, name: a ? `${SOCIAL_PLATFORMS[a.platform]}: ${a.name}` : c.siteId, url: a?.url ?? '', owners: { ...base, itAdminId: a?.itAdminId ?? base.itAdminId } };
    }
    if (c.kind === 'mail') {
      const x = d.domains.find((y) => y.id === c.siteId);
      const base = this.owners(null, profile);
      return { site: null, name: x ? `Email: ${x.name}` : c.siteId, url: '', owners: { ...base, itAdminId: x?.itAdminId ?? base.itAdminId, backupId: x?.backupId ?? base.backupId } };
    }
    const site = d.sites.find((x) => x.id === c.siteId) ?? null;
    return { site, name: site?.name ?? c.siteId, url: site?.url ?? '', owners: this.owners(site, profile) };
  }

  // ----- Social media and email (Fauzan, 31 Oct 2026) -----

  private async profileFor(companyId: Id): Promise<WebCompany> {
    const p = (await this.store.list('webCompanies', { companyId }))[0];
    if (p) return p;
    if (!(await this.store.get('companies', companyId))) throw new NotFound('Company');
    return { id: `wc-${companyId}`, companyId, websiteRequired: 'under_review', notRequired: null, itAdminId: null, backupId: null, contentOwnerId: null, approverId: null, note: '' };
  }

  private async putProfile(tx: Store, p: WebCompany, patch: Partial<WebCompany>) {
    if (await tx.get('webCompanies', p.id)) return tx.update('webCompanies', p.id, patch);
    const row = { ...p, ...patch };
    await tx.insert('webCompanies', row);
    return row;
  }

  /** IT adds or edits a social media account. Never a password: only where the sign-in is kept. */
  private async saveSocial(v: Viewer, i: Record<string, unknown>) {
    if (!v.it && !v.admin) throw new BadRequest('Only IT records social media accounts.');
    const companyId = this.text(i.companyId, 'the company');
    const p = await this.profileFor(companyId);
    const list = p.social ?? [];
    const existing = i.id ? list.find((x) => x.id === i.id) : undefined;
    if (!v.itHead && !v.admin && !this.visibleCompanyIds(v, await this.load()).has(companyId) && !(existing && existing.itAdminId === v.user.id)) throw new NotFound('Company');
    if (i.id && !existing) throw new NotFound('Social media account');
    if (existing && !v.itHead && !v.admin && existing.itAdminId !== v.user.id) throw new BadRequest('Only its IT administrator or the IT Head changes this account.');
    const platform = (Object.keys(SOCIAL_PLATFORMS) as SocialPlatform[]).find((k) => k === i.platform);
    if (!platform) throw new BadRequest('Choose the platform.');
    const one = <T extends string>(x: unknown, opts: readonly T[], fallback: T) => opts.find((o) => o === x) ?? fallback;
    const admins = Array.isArray(i.admins)
      ? (i.admins as Record<string, unknown>[]).slice(0, 20).map((a) => ({
          name: this.text(a.name, 'each admin’s name', 2, 120),
          companyEmail: a.companyEmail === true,
          twoFactor: a.twoFactor === true ? true : a.twoFactor === false ? false : null,
        }))
      : (existing?.admins ?? []);
    if (Object.values(i).some((x) => typeof x === 'string' && /password|passwd|kata\s*laluan/i.test(x) && /[:=]/.test(x))) throw new BadRequest('Never record a password here; say where it is kept.');
    const row: WebSocial = {
      id: existing?.id ?? `ws-${companyId}-${toMs(this.now())}-${list.length}`,
      companyId,
      platform,
      name: this.text(i.name, 'the page or account name', 2, 160),
      url: this.opt(i.url, 300),
      status: one(i.status, ['active', 'dormant', 'closed', 'unknown'] as const, existing?.status ?? 'unknown'),
      ownership: one(i.ownership, ['business_portfolio', 'company_page', 'personal', 'unknown'] as const, existing?.ownership ?? 'unknown'),
      holder: this.opt(i.holder, 160),
      admins,
      recoveryEmail: this.opt(i.recoveryEmail, 160),
      itAdminId: (await this.userId(i.itAdminId, 'IT administrator', (u) => u.department === 'it')) ?? existing?.itAdminId ?? null,
      contentOwnerId: (await this.userId(i.contentOwnerId, 'Content owner')) ?? existing?.contentOwnerId ?? null,
      approverId: (await this.userId(i.approverId, 'Content approver')) ?? existing?.approverId ?? null,
      lastPostOn: i.lastPostOn ? this.date(i.lastPostOn, 'Last post') : (existing?.lastPostOn ?? null),
      vault: i.vaultEntry ? { manager: this.opt(i.vaultManager, 80) || 'Password manager', entry: this.text(i.vaultEntry, 'the vault entry name', 2, 120), access: this.opt(i.vaultAccess, 160) } : (existing?.vault ?? null),
      accessReview: existing?.accessReview ?? null,
      note: this.opt(i.note, 1000),
    };
    if(row.status==='dormant'||row.status==='closed') row.statusReason=this.policyText(i.statusReason===undefined?existing?.statusReason:i.statusReason,'reason for dormant or closed status',3,500);
    else row.statusReason=existing?.statusReason;
    const social = existing ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row];
    return this.store.transaction(async (tx) => {
      await this.putProfile(tx, p, { social });
      await this.audit(tx, v.user, companyId, existing ? 'social.update' : 'social.add', 'webSocial', row.id, `${existing ? 'Updated' : 'Added'} ${SOCIAL_PLATFORMS[platform]} account ${row.name}${row.statusReason!==existing?.statusReason||row.status!==existing?.status?'; status/reason: '+JSON.stringify({previousStatus:existing?.status??null,status:row.status,previousReason:existing?.statusReason??null,reason:row.statusReason??null}):''}`);
      return row;
    });
  }

  /** The 90-day people-and-access review of a social account, always with a comment. */
  private async reviewSocialAccess(v: Viewer, i: Record<string, unknown>) {
    const companyId = this.text(i.companyId, 'the company');
    const p = await this.profileFor(companyId);
    const a = p.social?.find((x) => x.id === i.id);
    if (!a) throw new NotFound('Social media account');
    if (!v.itHead && !v.admin && a.itAdminId !== v.user.id) throw new BadRequest('The account’s IT administrator or the IT Head reviews its access.');
    const note = this.text(i.note, 'a comment (who has access now and what you checked)', 3, 500);
    const accessReview = { at: this.now(), by: v.user.name, note, removed: this.opt(i.removed, 300) };
    const social = (p.social ?? []).map((x) => (x.id === a.id ? { ...x, accessReview } : x));
    return this.store.transaction(async (tx) => {
      await this.putProfile(tx, p, { social });
      await this.audit(tx, v.user, companyId, 'social.access', 'webSocial', a.id, `${SOCIAL_PLATFORMS[a.platform]} ${a.name}: access reviewed: ${note}${accessReview.removed ? `; removed ${accessReview.removed}` : ''}`);
      return accessReview;
    });
  }

  /** IT records a domain's email health by hand (when the email DNS connector is off). */
  private async saveMailHealth(v: Viewer, i: Record<string, unknown>) {
    const x = await this.store.get('webDomains', this.text(i.domainId, 'the domain'));
    if (!x) throw new NotFound('Domain');
    if (!v.itHead && !v.admin && !(v.it && (x.itAdminId === v.user.id || x.backupId === v.user.id))) throw new BadRequest('The domain’s IT administrator, backup or the IT Head records its email health.');
    const one = <T extends string>(y: unknown, opts: readonly T[]) => opts.find((o) => o === y) ?? ('unknown' as T);
    const mail: WebMailHealth = {
      spf: one(i.spf, ['pass', 'missing', 'too_many_lookups', 'unknown'] as const),
      dkim: one(i.dkim, ['on', 'off', 'unknown'] as const),
      dmarc: one(i.dmarc, ['reject', 'quarantine', 'none', 'missing', 'unknown'] as const),
      dmarcReports: i.dmarcReports === true ? true : i.dmarcReports === false ? false : null,
      mx: one(i.mx, ['m365', 'other', 'missing', 'unknown'] as const),
      source: 'manual',
      checkedAt: this.now(),
      checkedBy: v.user.name,
    };
    const note = this.text(i.note, 'a comment (where you checked it)', 3, 300);
    return this.store.transaction(async (tx) => {
      await tx.update('webDomains', x.id, { mail });
      await this.audit(tx, v.user, x.companyIds[0], 'mail.health', 'webDomain', x.id, `${x.name} email health recorded by hand: SPF ${mail.spf}, DKIM ${mail.dkim}, DMARC ${mail.dmarc} (${note})`);
      return mail;
    });
  }

  /** The 90-day mailbox review for a company: leavers, forwarding, full mailboxes, with a comment. */
  private async saveMailboxes(v: Viewer, i: Record<string, unknown>) {
    if (!v.itHead && !v.admin && !v.it) throw new BadRequest('Only IT reviews mailboxes.');
    const companyId = this.text(i.companyId, 'the company');
    if (!v.itHead && !v.admin && !this.visibleCompanyIds(v, await this.load()).has(companyId)) throw new NotFound('Company');
    const p = await this.profileFor(companyId);
    const n = (y: unknown) => (y === '' || y == null ? null : Number.isFinite(Number(y)) && Number(y) >= 0 ? Math.round(Number(y)) : null);
    const mailboxes: WebMailboxes = {
      licensed: n(i.licensed),
      shared: n(i.shared),
      leaversPending: n(i.leaversPending),
      nearFull: n(i.nearFull),
      forwardingOutside: n(i.forwardingOutside),
      reviewedAt: this.now(),
      reviewedBy: v.user.name,
      note: this.text(i.note, 'a comment (what you checked in the Microsoft 365 admin centre)', 3, 500),
    };
    return this.store.transaction(async (tx) => {
      await this.putProfile(tx, p, { mailboxes });
      await this.audit(tx, v.user, companyId, 'mail.mailboxes', 'webCompany', p.id, `Mailbox review: ${mailboxFlags(mailboxes, this.today()).join('; ') || 'nothing outstanding'} (${mailboxes.note})`);
      return mailboxes;
    });
  }

  // ----- Connectors (Fauzan, 31 Oct 2026) -----

  /** The CEO switches a connector on or off, with a comment. Its key still has to be set on the server. */
  private async setConnector(v: Viewer, i: Record<string, unknown>) {
    if (!v.admin) throw new BadRequest('Only the CEO, as owner and master administrator, switches a connector on or off.');
    const key = (Object.keys(CONNECTOR_INFO) as ConnectorKey[]).find((k) => k === i.key);
    if (!key) throw new BadRequest('Unknown connector.');
    const on = i.on === true;
    if (key === 'm365' && on) throw new BadRequest('Website email and Teams delivery is unavailable in this pilot.');
    const note = this.text(i.note, 'a comment (why, and who agreed)', 3, 500);
    const s = await this.settings();
    const connectorsOn = { ...s.connectorsOn, [key]: on };
    return this.store.transaction(async (tx) => {
      if (await tx.get('webSettings', 'settings')) await tx.update('webSettings', 'settings', { connectorsOn });
      else await tx.insert('webSettings', { ...s, connectorsOn });
      await this.audit(tx, v.user, null, 'connector.set', 'webSettings', key, `${CONNECTOR_INFO[key].name} switched ${on ? 'on' : 'off'}: ${note}`);
      return { key, on };
    });
  }

  /**
   * Matches what the connectors read to the register. Called by the server after it fetched each service with its own
   * key; never from the screen with typed-in data. Only switched-on connectors are applied.
   */
  async syncFromFeed(user: User, feed: WebFeed): Promise<{ran: ConnectorKey[]; issues: string[]; notices: number; state: Partial<Record<ConnectorKey, ConnectorState>>}> {
    if (user.integration) throw new BadRequest('A connected app cannot work here.');
    if (!this.mutationLocked) return this.serialize(svc => svc.syncFromFeed(user, feed));
    const v = this.viewer(user);
    if (!v.itHead && !v.admin) throw new BadRequest('Only the IT Head runs the website connectors.');
    const d = await this.load();
    const s = d.settings;
    const at = feed.at;
    if (!Number.isFinite(toMs(at))) throw new BadRequest('Invalid connector reading time.');
    feed = { ...feed };
    for (const key of Object.keys(CONNECTOR_INFO) as ConnectorKey[]) {
      const previous = s.connectorState[key]?.lastSync;
      if (previous && toMs(previous) > toMs(at)) delete (feed as unknown as Record<string, unknown>)[key];
    }
    const state: Partial<Record<ConnectorKey, ConnectorState>> = { ...s.connectorState };
    const sitePatch = new Map<Id, SiteObserved>();
    const domainPatch = new Map<Id, DomainObserved>();
    const issues: Parameters<WebsiteService['newIssue']>[2][] = [];
    const notices: { base: string; to: (Id | null | undefined)[]; title: string; link: WebNotice['link'] }[] = [];
    const itManagers = d.users.filter((u) => webActive(u,this.today()) && webManager(u)).map((u) => u.id);
    const sent = new Set(d.notices.map((n) => n.key).filter((k): k is string => !!k));
    const hasIssue = (id: string) => d.issues.some((x) => x.origin.kind === 'connector' && x.origin.id === id);
    const siteByHost = (host: string) => d.sites.find((x) => x.status !== 'retired' && host && hostOf(x.url) === host.replace(/^www\./, ''));
    const obsSite = (x: (typeof d.sites)[number]) => sitePatch.get(x.id) ?? { ...(x.observed ?? {}) };
    const obsDomain = (x: (typeof d.domains)[number]) => domainPatch.get(x.id) ?? { ...(x.observed ?? {}) };
    const record = (key: ConnectorKey, r: { ok: true } | { ok: false; error: string }, matched: number, unmatched: string[]) =>
      (state[key] = { lastSync: at, ok: r.ok, error: r.ok ? '' : safeConnectorError(r.error), matched, unmatched: unmatched.slice(0, 50) });

    if (s.connectorsOn.cloudflare && feed.cloudflare) {
      const r = feed.cloudflare;
      if (!r.ok) record('cloudflare', r, 0, []);
      else {
        let matched = 0;
        const unmatched: string[] = [];
        for (const p of r.data.projects) {
          const site = d.sites.find((x) => x.hosting.project && x.hosting.project === p.name) ?? p.domains.map((h) => siteByHost(h)).find(Boolean);
          if (!site) {
            unmatched.push(`project ${p.name}`);
            continue;
          }
          matched += 1;
          sitePatch.set(site.id, { ...obsSite(site), cloudflare: { project: p.name, latest: p.latest, at } });
        }
        for (const z of r.data.zones) {
          const dom = d.domains.find((x) => x.name.toLowerCase() === z.name.toLowerCase());
          if (!dom) {
            unmatched.push(`zone ${z.name}`);
            continue;
          }
          matched += 1;
          const fp = dnsFingerprint(z.records);
          const o = obsDomain(dom);
          o.dns = { fingerprint: fp, count: z.records.length, at };
          if (!o.dnsBaseline) o.dnsBaseline = { fingerprint: fp, at, by: 'Initial observed baseline' };
          else if (o.dnsBaseline.fingerprint !== fp) {
            if (!hasIssue(`dns:${dom.id}:${fp}`))
              issues.push({
                companyId: dom.companyIds[0],
                siteId: null,
                domainId: dom.id,
                category: 'DOMAIN',
                description: `DNS records of ${dom.name} differ from its recorded baseline; verify the change (Cloudflare reading ${dateOf(at)})`,
                severity: dom.m365Email ? 'critical' : 'high',
                ownerId: dom.itAdminId,
                origin: { kind: 'connector', id: `dns:${dom.id}:${fp}` },
                immediateAction: 'Compare with the last export; if the change is right, the IT Lead accepts the new records in Prima with a comment.',
              });
          }
          domainPatch.set(dom.id, o);
        }
        record('cloudflare', r, matched, unmatched);
      }
    }

    if (s.connectorsOn.github && feed.github) {
      const r = feed.github;
      if (!r.ok) record('github', r, 0, []);
      else {
        let matched = 0;
        const unmatched: string[] = [];
        for (const g of r.data.repos) {
          const site = d.sites.find((x) => x.repoRef && (x.repoRef === g.url || x.repoRef.endsWith(`/${g.name}`) || x.repoRef === g.name));
          if (!site) {
            unmatched.push(g.name);
            continue;
          }
          matched += 1;
          sitePatch.set(site.id, { ...obsSite(site), github: { repo: g.name, url: g.url, pushedAt: g.pushedAt, lastCommit: g.lastCommit, at } });
        }
        record('github', r, matched, unmatched);
      }
    }

    if (s.connectorsOn.uptime && feed.uptime) {
      const r = feed.uptime;
      if (!r.ok) record('uptime', r, 0, []);
      else {
        let matched = 0;
        const unmatched: string[] = [];
        for (const m of r.data.monitors) {
          const site = siteByHost(hostOf(m.url));
          if (!site) {
            unmatched.push(m.url);
            continue;
          }
          matched += 1;
          sitePatch.set(site.id, { ...obsSite(site), uptime: { status: m.status, since: m.since, sslExpiresOn: m.sslExpiresOn, at } });
          const o = this.owners(site, d.profiles.find((p) => p.companyId === site.companyId));
          const downId = `down:${site.id}:${m.since ?? dateOf(at)}`;
          if (m.status === 'down' && site.status === 'live' && !hasIssue(downId))
            issues.push({
              companyId: site.companyId,
              siteId: site.id,
              domainId: null,
              category: 'DOWN',
              description: `${site.name} is down (uptime monitor${m.since ? `, since ${m.since}` : ''})`,
              severity: 'critical',
              ownerId: o.itAdminId,
              origin: { kind: 'connector', id: downId },
            });
          const days = m.sslExpiresOn ? daysBetween(dateOf(at), m.sslExpiresOn) : null;
          if (days != null && days <= 14)
            notices.push({
              base: `ssl-${site.id}-${m.sslExpiresOn}`,
              to: [o.itAdminId, o.backupId],
              title: `The https certificate of ${site.name} expires on ${m.sslExpiresOn} (${days} days)`,
              link: { kind: 'site', id: site.id },
            });
        }
        record('uptime', r, matched, unmatched);
      }
    }

    if (s.connectorsOn.registrar && feed.registrar) {
      const r = feed.registrar;
      if (!r.ok) record('registrar', r, 0, []);
      else {
        let matched = 0;
        const unmatched: string[] = [];
        for (const g of r.data.domains) {
          const dom = d.domains.find((x) => x.name.toLowerCase() === g.name.toLowerCase());
          if (!dom) {
            unmatched.push(g.name);
            continue;
          }
          matched += 1;
          domainPatch.set(dom.id, { ...obsDomain(dom), registrar: { expiresOn: g.expiresOn, registrar: g.registrar, at } });
          // Never copied over the register: a renewal is confirmed by a person with evidence.
          if (g.expiresOn && dom.expiresOn !== g.expiresOn)
            notices.push({
              base: `exp-${dom.id}-${g.expiresOn}`,
              to: [dom.itAdminId, dom.renewalOwnerId],
              title: `The registry shows ${dom.name} expiring on ${g.expiresOn}; the register says ${dom.expiresOn ?? 'no date'}. Check and confirm.`,
              link: { kind: 'domain', id: dom.id },
            });
        }
        record('registrar', r, matched, unmatched);
      }
    }

    const mailPatch = new Map<Id, WebMailHealth>();
    if (s.connectorsOn.maildns && feed.maildns) {
      const r = feed.maildns;
      if (!r.ok) record('maildns', r, 0, []);
      else {
        let matched = 0;
        const unmatched: string[] = [];
        for (const g of r.data.domains) {
          const dom = d.domains.find((x) => x.name.toLowerCase() === g.name.toLowerCase());
          if (!dom) {
            unmatched.push(g.name);
            continue;
          }
          matched += 1;
          const mail: WebMailHealth = { ...mailHealthFromDns(g), checkedAt: at, checkedBy: 'Email DNS check' };
          mailPatch.set(dom.id, mail);
          const was = mailFlags(dom.mail);
          const fresh = mailFlags(mail).filter((f) => !was.includes(f) && !/not checked/.test(f));
          if (dom.mail && fresh.length)
            notices.push({ base: `mail-${dom.id}-${fresh.join('|')}`, to: [dom.itAdminId, dom.backupId, ...itManagers], title: `Email health of ${dom.name} changed: ${fresh.join('; ')}`, link: { kind: 'domain', id: dom.id } });
        }
        record('maildns', r, matched, unmatched);
      }
    }

    let spInbox = s.spInbox;
    if (s.connectorsOn.sharepoint && feed.sharepoint) {
      const r = feed.sharepoint;
      if (!r.ok) record('sharepoint', r, 0, []);
      else {
        const known = new Set(spInbox.map((x) => x.id));
        const fresh = r.data.requests.filter((x) => !known.has(x.id));
        spInbox = [...spInbox, ...fresh.map((x) => ({ ...x, state: 'new' as const, decidedBy: null, decidedAt: null, note: '', issueId: null }))].slice(-300);
        if (fresh.length)
          notices.push({
            base: `sp-${fresh.map((x) => x.id).join(',').slice(0, 120)}`,
            to: itManagers,
            title: `${fresh.length} new website request${fresh.length === 1 ? '' : 's'} from SharePoint to accept or decline`,
            link: { kind: 'site', id: 'sharepoint' },
          });
        record('sharepoint', r, r.data.requests.length, []);
      }
    }

    return this.store.transaction(async (tx) => {
      for (const [id, observed] of sitePatch) await tx.update('webSites', id, { observed });
      for (const [id, observed] of domainPatch) await tx.update('webDomains', id, { observed });
      for (const [id, mail] of mailPatch) await tx.update('webDomains', id, { mail });
      const made: string[] = [];
      for (const x of issues) made.push((await this.newIssue(tx, v, x)).ref);
      let n = 0;
      for (const j of notices) n += await this.notify(tx, j.to, j.title, j.link, { base: j.base, sent });
      const patch = { connectorState: state, spInbox };
      if (await tx.get('webSettings', 'settings')) await tx.update('webSettings', 'settings', patch);
      else await tx.insert('webSettings', { ...s, ...patch });
      const ran = (Object.keys(state) as ConnectorKey[]).filter((k) => state[k]?.lastSync === at);
      await this.audit(tx, user, null, 'connectors.sync', 'webSettings', 'connectors', `Connectors read: ${ran.join(', ') || 'none switched on'}; ${made.length} issues opened${made.length ? ` (${made.join(', ')})` : ''}, ${n} notices`);
      return { ran, issues: made, notices: n, state };
    });
  }

  /** The IT Lead or CEO accepts the DNS records now in Cloudflare as correct, with a comment. */
  private async acceptDns(v: Viewer, i: Record<string, unknown>) {
    if (!v.tech && !v.admin) throw new BadRequest('Only the IT Lead (technical) or the CEO accepts DNS records.');
    const dom = await this.store.get('webDomains', this.text(i.domainId, 'the domain'));
    if (!dom) throw new NotFound('Domain');
    const now = dom.observed?.dns;
    if (!now) throw new BadRequest('Cloudflare has not read this domain yet.');
    const note = this.text(i.note, 'a comment (what you compared and why it is right)', 3, 500);
    const observed: DomainObserved = { ...dom.observed, dnsBaseline: { fingerprint: now.fingerprint, at: this.now(), by: v.user.name } };
    return this.store.transaction(async (tx) => {
      await tx.update('webDomains', dom.id, { observed });
      await this.audit(tx, v.user, dom.companyIds[0], 'dns.accept', 'webDomain', dom.id, `${dom.name}: current DNS records accepted as correct: ${note}`);
      return { domainId: dom.id, fingerprint: now.fingerprint };
    });
  }

  /** The IT Manager accepts a SharePoint request (it becomes a website issue) or declines it, always with a comment. */
  private async spDecide(v: Viewer, i: Record<string, unknown>) {
    const manager = v.user.department === 'it' && v.user.itRole === 'manager';
    if (!manager && !v.admin) throw new BadRequest('Only the IT Manager (or the CEO) accepts or declines website requests.');
    const s = await this.settings();
    const item = s.spInbox.find((x) => x.id === i.id);
    if (!item || item.state !== 'new') throw new BadRequest('This request is not waiting for a decision.');
    const accept = i.accept === true;
    const note = this.text(i.note, 'a comment', 3, 500);
    let issueId: Id | null = null;
    return this.store.transaction(async (tx) => {
      if (accept) {
        const site = (await tx.list('webSites', {})).find((x) => item.siteUrl && hostOf(x.url) === hostOf(item.siteUrl));
        const companyId = this.text(i.companyId ?? site?.companyId, 'the company this request is for');
        if (!(await tx.get('companies', companyId))) throw new NotFound('Company');
        const o = this.owners(site ?? null, (await tx.list('webCompanies', { companyId }))[0]);
        const issue = await this.newIssue(tx, v, {
          companyId,
          siteId: site && site.companyId === companyId ? site.id : null,
          domainId: null,
          category: item.kind === 'change' ? 'WRONG_INFO' : 'OTHER',
          description: `${item.kind === 'proposal' ? 'Proposal' : item.kind === 'instruction' ? 'Instruction' : 'Change request'} from SharePoint: ${item.title}${item.detail ? ` — ${item.detail}` : ''}`.slice(0, 1000),
          severity: 'normal',
          ownerId: o.itAdminId,
          origin: { kind: 'sharepoint', id: item.id },
          impact: `Requested by ${item.requestedBy}; ${item.link}`.slice(0, 500),
        });
        issueId = issue.id;
      }
      const spInbox = s.spInbox.map((x) => (x.id === item.id ? { ...x, state: accept ? ('accepted' as const) : ('declined' as const), decidedBy: v.user.name, decidedAt: this.now(), note, issueId } : x));
      await tx.update('webSettings', 'settings', { spInbox });
      await this.audit(tx, v.user, null, 'sharepoint.decide', 'webSettings', item.id, `SharePoint request "${item.title}" ${accept ? 'accepted' : 'declined'}: ${note}`);
      return { id: item.id, accepted: accept, issueId };
    });
  }

  /** Outbound delivery is unavailable, including previously queued legacy notices. */
  async queuedDeliveries(_user: User, _limit = 50): Promise<never[]> { return []; }
  async markDeliveries(_user: User, _results: unknown[]) { throw new BadRequest('Website delivery is unavailable in this pilot.'); }

  /** Flat tables for the Power BI website dashboard. Group leaders and the IT Head only; no vault details. */
  async powerBiFeed(user: User) {
    if (user.integration) throw new BadRequest('A connected app cannot read this report.');
    const v = this.viewer(user);
    if (!v.group && !v.itHead && !v.admin) throw new BadRequest('Only group management and the IT Head read the website report feed.');
    const d = await this.load();
    const today = this.today();
    const co = (id: Id) => d.companies.find((c) => c.id === id)?.name ?? id;
    return {
      generatedAt: this.now(),
      sites: d.sites.map((x) => ({
        id: x.id,
        company: co(x.companyId),
        name: x.name,
        url: x.url,
        status: x.status,
        uptime: x.observed?.uptime?.status ?? 'unknown',
        lastDeployAt: x.observed?.cloudflare?.latest?.at ?? null,
        lastCommitAt: x.observed?.github?.lastCommit?.at ?? null,
        openIssues: d.issues.filter((i) => i.siteId === x.id && (i.status === 'open' || i.status === 'in_progress')).length,
      })),
      domains: d.domains.map((x) => ({ id: x.id, name: x.name, companies: x.companyIds.map(co).join('; '), expiresOn: x.expiresOn, ...this.domainState(x, today, d.settings) })),
      reviews: d.reviews.map((r) => ({ id: r.id, company: co(r.companyId), quarter: r.quarter, stage: r.stage, ...this.reviewState(r, today) })),
      checks: d.checks.map((c) => ({ id: c.id, company: co(c.companyId), month: c.month, status: this.checkState(c, today, d.settings) })),
      issues: d.issues.map((i) => ({ id: i.id, ref: i.ref, company: co(i.companyId), category: i.category, severity: i.severity, status: i.status, at: i.at, source: i.origin.kind })),
    };
  }

  // ----- Schedule (Phase 2) -----

  /**
   * Opens the quarter's reviews and the month's checks when they are due, then sends each reminder and escalation once.
   * It runs when IT or group management opens the module (at most once an hour) or when the IT Head presses Run now,
   * so no server timer is needed. Notices stay inside Prima: email and Teams are not connected.
   */
  private async runSchedule(v: Viewer, i: Record<string, unknown>) {
    if (!v.it && !v.group && !v.admin) throw new BadRequest('Only IT or group management runs the website schedule.');
    const force = i.force === true;
    if (force && !v.itHead && !v.admin) throw new BadRequest('Only the IT Head or the CEO runs the schedule by hand.');
    // One transaction-scoped lock also covers the first run when settings do not yet exist.
    await this.store.lock?.('webSettings', 'settings');
    const s = await this.settings();
    const now = this.now();
    const fresh = s.lastScheduleRun && toMs(now) - toMs(s.lastScheduleRun) < 3_600_000;
    if (!force && (!s.autoSchedule || fresh)) return { ran: false, lastRun: s.lastScheduleRun, reviews: 0, checks: 0, sent: 0 };
    const today = this.today();
    const q = quarterOf(today);
    const reviews = today >= addDays(q.start, s.requestDay) ? (await this.openReviewsFor(v.user, q, true)).opened : 0;
    const checks = await this.openMonthChecks(v.user, monthOf(today));
    const d = await this.load();
    const itManagers = d.users.filter((u) => webActive(u,this.today()) && webManager(u)).map((u) => u.id);
    const sent = new Set(d.notices.map((n) => n.key).filter((k): k is string => !!k));
    const jobs: { base: string; to: (Id | null | undefined)[]; title: string; link: WebNotice['link'] }[] = [];
    const job = (base: string, to: (Id | null | undefined)[], title: string, link: WebNotice['link']) => jobs.push({ base, to, title, link });
    const siteName = (id: Id | null) => d.sites.find((x) => x.id === id)?.name ?? 'website';
    const ownersOf = (siteId: Id | null, companyId: Id) =>
      this.owners(d.sites.find((x) => x.id === siteId) ?? null, d.profiles.find((p) => p.companyId === companyId));

    for (const r of d.reviews) {
      if (r.stage === 'done') continue;
      const o = ownersOf(r.siteId, r.companyId);
      const heads = this.headsOf(d.users, r.companyId).map((u) => u.id);
      const link = { kind: 'review' as const, id: r.id };
      const name = siteName(r.siteId);
      if (r.stage === 'request') {
        if (today > r.responseDue) job(`rv-late-${r.id}`, [o.contentOwnerId, ...heads, ...itManagers], `Late: the company answer for the ${r.quarter} review of ${name} was due ${r.responseDue}`, link);
        else if (today >= addDays(r.responseDue, -s.responseReminderDays)) job(`rv-remind-${r.id}`, [o.contentOwnerId, ...heads], `Reminder: answer the ${r.quarter} website review of ${name} by ${r.responseDue}`, link);
      }
      if (r.stage === 'approval') {
        if (today > r.approvalDue) job(`ap-late-${r.id}`, [o.approverId, ...heads, ...itManagers], `Late: approval of the ${r.quarter} review of ${name} was due ${r.approvalDue}`, link);
        else if (today >= addDays(r.approvalDue, -s.responseReminderDays)) job(`ap-remind-${r.id}`, [o.approverId], `Reminder: approve the ${r.quarter} website review of ${name} by ${r.approvalDue}`, link);
      }
      if (today > addDays(r.completeDue, s.overdueEscalateDays))
        job(`rv-esc-${r.id}`, [...s.escalationIds, ...itManagers], `Escalated: the ${r.quarter} review of ${name} is still open (${STAGE_LABEL[r.stage]}), due ${r.completeDue}`, link);
    }

    // One reminder per checker, and one line per month for the IT Manager and management, so an overdue month is not a flood.
    const lateByMonth = new Map<string, number>();
    const escByMonth = new Map<string, number>();
    for (const c of d.checks) {
      if (c.doneAt || c.na) continue;
      const due = `${c.month}-${String(s.monthlyDueDay).padStart(2, '0')}`;
      const tgt = this.checkTarget(c, d);
      const o = tgt.owners;
      const to = [c.assignedToId ?? o.itAdminId, o.backupId];
      const link = { kind: 'check' as const, id: c.id };
      if (today > due) {
        job(`ck-late-${c.id}`, to, `Overdue: monthly check of ${tgt.name} was due ${due}`, link);
        lateByMonth.set(c.month, (lateByMonth.get(c.month) ?? 0) + 1);
        if (today > addDays(due, s.overdueEscalateDays)) escByMonth.set(c.month, (escByMonth.get(c.month) ?? 0) + 1);
      } else if (today >= addDays(due, -s.checkReminderDays)) job(`ck-remind-${c.id}`, to, `Reminder: monthly check of ${tgt.name} is due ${due}`, link);
    }
    for (const [m, n] of lateByMonth) job(`ck-late-${m}`, itManagers, `${n} monthly website check${n === 1 ? '' : 's'} for ${m} overdue`, { kind: 'check', id: m });
    for (const [m, n] of escByMonth) job(`ck-esc-${m}`, s.escalationIds, `Escalated: ${n} monthly website check${n === 1 ? '' : 's'} for ${m} still not done`, { kind: 'check', id: m });

    for (const x of d.domains) {
      const st = this.domainState(x, today, s);
      if (st.days == null) continue;
      const link = { kind: 'domain' as const, id: x.id };
      if (st.reminder != null)
        job(
          `dm-${x.id}-${x.expiresOn}-${st.days < 0 ? 'expired' : st.reminder}`,
          [x.renewalOwnerId, x.itAdminId, x.backupId],
          st.days < 0 ? `Expired: domain ${x.name} expired on ${x.expiresOn}` : `Domain ${x.name} expires in ${st.days} day${st.days === 1 ? '' : 's'} (${x.expiresOn}): renew and confirm`,
          link,
        );
      if (st.escalate) job(`dm-esc-${x.id}-${x.expiresOn}`, [...s.escalationIds, ...itManagers], `Escalated: renewal of ${x.name} not confirmed, expiry ${x.expiresOn}`, link);
    }

    // Social accounts: the 90-day access review, once a quarter per account.
    for (const p of d.profiles)
      for (const a of p.social ?? [])
        if (a.status !== 'closed' && (!a.accessReview || daysBetween(dateOf(a.accessReview.at), today) > 90))
          job(`so-access-${a.id}-${q.key}`, [a.itAdminId ?? p.itAdminId, ...itManagers], `Access review due: ${SOCIAL_PLATFORMS[a.platform]} ${a.name} (who is admin, leavers removed, two-step sign-in)`, { kind: 'site', id: a.id });
    for(const p of d.profiles) for(const a of p.social??[]) {
      const days=socialInactivityDays(a.lastPostOn,today);
      if(a.status!=='active'||days===null||days<180)continue;
      const managers=d.users.filter(u=>webActive(u,today)&&u.role==='company_manager'&&u.companyIds.includes(p.companyId)).map(u=>u.id);
      job(`so-inactive-${a.id}-${a.lastPostOn}`,managers.length?managers:itManagers,`Social activity review: ${a.name} has no recorded post for ${days} days; confirm activity or record a reason for dormant/closed status`,{kind:'site',id:a.id});
    }
    // Email: the 90-day mailbox review per company with Microsoft 365 email.
    for (const c of d.companies) {
      if (!d.domains.some((x) => x.m365Email && x.companyIds.includes(c.id))) continue;
      const m = d.profiles.find((p) => p.companyId === c.id)?.mailboxes;
      if (!m?.reviewedAt || daysBetween(dateOf(m.reviewedAt), today) > 90)
        job(`mb-review-${c.id}-${q.key}`, itManagers, `Mailbox review due for ${c.name}: leavers, forwarding outside, full mailboxes`, { kind: 'site', id: c.id });
    }

    const nowMs = toMs(now);
    const tickets = await this.store.list('itTickets', {});
    for (const x of d.issues) {
      const t = x.itTicketId ? tickets.find((y) => y.id === x.itTicketId) : null;
      if (t && t.status === 'resolved' && (x.status === 'open' || x.status === 'in_progress'))
        job(`is-ticket-${x.id}`, [x.ownerId, ...itManagers], `${t.ref} is resolved in the IT queue but ${x.ref} is still open: record the fix and evidence in Websites`, { kind: 'issue', id: x.id });
      if (x.status === 'resolved' || x.status === 'closed') continue;
      const hours = s.issueTargetHours[x.severity];
      const late = nowMs - (toMs(x.at) + hours * 3_600_000);
      const link = { kind: 'issue' as const, id: x.id };
      if (late > 0) job(`is-late-${x.id}`, [x.ownerId, ...itManagers], `Past target: ${x.ref} (${x.severity}) open more than ${hours} hours`, link);
      if (late > hours * 3_600_000) job(`is-esc-${x.id}`, [x.escalateToId, ...s.escalationIds], `Escalated: ${x.ref} (${x.severity}) open more than ${hours * 2} hours`, link);
    }

    return this.store.transaction(async (tx) => {
      let n = 0;
      for (const j of jobs) n += await this.notify(tx, j.to, j.title, j.link, { base: j.base, sent });
      const saved: WebSettings = { ...s, lastScheduleRun: now };
      if (await tx.get('webSettings', 'settings')) await tx.update('webSettings', 'settings', { lastScheduleRun: now });
      else await tx.insert('webSettings', saved);
      if (n || reviews || checks || force)
        await this.audit(tx, v.user, null, 'schedule.run', 'webSettings', 'settings', `Website schedule${force ? ' (run by hand)' : ''}: ${reviews} reviews and ${checks} checks opened, ${n} notices sent`);
      return { ran: true, lastRun: now, reviews, checks, sent: n };
    });
  }

  /** The month's checks for every live website, each given to that website's IT administrator. */
  private async openMonthChecks(user: User, month: string) {
    const presence = await this.openPresenceChecks(user, month, null);
    return presence + (await this.openSiteChecks(user, month));
  }

  /** Monthly checks for every active social account and every domain that carries Microsoft 365 email. */
  private async openPresenceChecks(user: User, month: string, assignTo: Id | null) {
    const [profiles, domains, checks] = await Promise.all([this.store.list('webCompanies', {}), this.store.list('webDomains', {}), this.store.list('webChecks', {})]);
    const want: { kind: 'social' | 'mail'; id: Id; companyId: Id; owner: Id | null }[] = [
      ...profiles.flatMap((p) => (p.social ?? []).filter((a) => a.status === 'active').map((a) => ({ kind: 'social' as const, id: a.id, companyId: p.companyId, owner: a.itAdminId ?? p.itAdminId }))),
      ...domains.filter((x) => x.m365Email).map((x) => ({ kind: 'mail' as const, id: x.id, companyId: x.companyIds[0], owner: x.itAdminId })),
    ].filter((w) => !checks.some((c) => c.kind === w.kind && c.siteId === w.id && c.month === month));
    if (!want.length) return 0;
    return this.store.transaction(async (tx) => {
      const per = new Map<Id, number>();
      for (const w of want) {
        const to = assignTo ?? w.owner;
        await tx.insert('webChecks', {
          id: `wk-${month}-${w.kind}-${w.id}`,
          kind: w.kind,
          siteId: w.id,
          companyId: w.companyId,
          month,
          assignedToId: to,
          items: checkItems(w.kind).map(([key]) => ({ key, result: null, note: '', issueId: null })),
          na: null,
          doneBy: null,
          doneAt: null,
          source: 'manual',
        });
        if (to) per.set(to, (per.get(to) ?? 0) + 1);
      }
      for (const [to, n] of per) await this.notify(tx, [to], `${n} monthly social media and email check${n === 1 ? '' : 's'} assigned for ${month}`, { kind: 'check', id: month });
      await this.audit(tx, user, null, 'checks.open', 'webCheck', month, `${month}: ${want.length} social media and email checks opened`);
      return want.length;
    });
  }

  private async openSiteChecks(user: User, month: string) {
    const [sites, checks, profiles] = await Promise.all([this.store.list('webSites', {}), this.store.list('webChecks', {}), this.store.list('webCompanies', {})]);
    const due = sites.filter((x) => x.status === 'live' && !checks.some((c) => (c.kind ?? 'site') === 'site' && c.siteId === x.id && c.month === month));
    if (!due.length) return 0;
    return this.store.transaction(async (tx) => {
      const per = new Map<Id, number>();
      for (const x of due) {
        const o = this.owners(x, profiles.find((p) => p.companyId === x.companyId));
        await tx.insert('webChecks', {
          id: `wk-${month}-${x.id}`,
          siteId: x.id,
          companyId: x.companyId,
          month,
          assignedToId: o.itAdminId,
          items: MONTHLY_ITEMS.map(([key]) => ({ key, result: null, note: '', issueId: null })),
          na: null,
          doneBy: null,
          doneAt: null,
          source: 'manual',
        });
        if (o.itAdminId) per.set(o.itAdminId, (per.get(o.itAdminId) ?? 0) + 1);
      }
      for (const [to, n] of per) await this.notify(tx, [to], `${n} monthly website check${n === 1 ? '' : 's'} assigned for ${month}`, { kind: 'check', id: month });
      await this.audit(tx, user, null, 'checks.open', 'webCheck', month, `${month}: ${due.length} monthly checks opened by the schedule`);
      return due.length;
    });
  }

  // ----- Quarterly reviews -----

  /** Opens one review per live website for the quarter (not for companies without a website). Run again safely. */
  private async openReviews(v: Viewer, i: Record<string, unknown>) {
    if (!v.itHead) throw new BadRequest('Only the IT Head or system administrator opens the quarterly reviews.');
    const q = i.quarter ? quarterByKey(String(i.quarter)) : quarterOf(this.today());
    return this.openReviewsFor(v.user, q, false);
  }

  private async openReviewsFor(user: User, q: { key: string; start: IsoDate; end: IsoDate }, scheduled: boolean) {
    await this.store.lock?.('webSettings', 'settings');
    const s = await this.settings();
    const [sites, reviews, profiles] = await Promise.all([this.store.list('webSites', {}), this.store.list('webReviews', {}), this.store.list('webCompanies', {})]);
    const due = sites.filter((x) => x.status === 'live' && !x.reviewException && !reviews.some((r) => r.siteId === x.id && r.quarter === q.key));
    const at = this.now();
    const clamp = (dd: IsoDate) => (dd > q.end ? q.end : dd);
    return this.store.transaction(async (tx) => {
      const made: Id[] = [];
      for (const site of due) {
        const o = this.owners(site, profiles.find((p) => p.companyId === site.companyId));
        const r: WebReview = {
          id: `wr-${q.key}-${site.id}`,
          siteId: site.id,
          companyId: site.companyId,
          quarter: q.key,
          openedAt: at,
          openedBy: scheduled ? `${user.name} (scheduled run)` : user.name,
          responseDue: clamp(addDays(q.start, s.responseDays)),
          approvalDue: clamp(addDays(q.start, s.approvalDays)),
          completeDue: q.end,
          stage: 'request',
          needsHelp: false,
          response: null,
          changes: [],
          verified: null,
          preparation: null,
          approvals: [],
          publication: null,
          tests: REVIEW_TESTS.map(([key]) => blankTest(key)),
          completed: null,
          history: [{ at, by: user.name, text: scheduled ? 'Review opened by the schedule' : 'Review opened' }],
        };
        await tx.insert('webReviews', r);
        made.push(r.id);
        const heads = this.headsOf(await tx.list('users', {}), site.companyId).map((u) => u.id);
        await this.notify(tx, [o.contentOwnerId, ...heads, o.itAdminId], `${q.key} website review opened: ${site.name}. Please check the content by ${r.responseDue}.`, { kind: 'review', id: r.id });
      }
      if (made.length || !scheduled)
        await this.audit(tx, user, null, 'reviews.open', 'webReview', q.key, `${q.key}: ${made.length} website review${made.length === 1 ? '' : 's'} opened${scheduled ? ' by the schedule' : ''}`);
      return { quarter: q.key, opened: made.length, ids: made };
    });
  }

  /**
   * Pilot: who the IT Manager records a company step for, and how it was given (Teams, email). Returns the name to keep on
   * the record, or null when the person acts for themselves.
   */
  private onBehalf(v: Viewer, i: Record<string, unknown>, own: boolean): { name: string; via: string } | null {
    if (own || !v.proxy) return null;
    const name = this.text(i.onBehalfOf, 'the name of the company person who gave this', 2, 120);
    const via = this.text(i.via, 'how they gave it (for example, Teams message 28 Oct 10:14)', 3, 200);
    return { name, via };
  }

  private async reviewFor(v: Viewer, id: unknown) {
    const r = await this.store.get('webReviews', this.text(id, 'the review'));
    if (!r) throw new NotFound('Review');
    const site = (await this.store.get('webSites', r.siteId)) ?? null;
    const profile = (await this.store.list('webCompanies', { companyId: r.companyId }))[0];
    const o = this.owners(site, profile);
    const can = this.reviewPermissions(v, r, o, []);
    return { r, site, o, can };
  }

  private async saveReview(tx: Store, v: Viewer, r: WebReview, patch: Partial<WebReview>, text: string, action: string) {
    const at = this.now();
    const saved = await tx.update('webReviews', r.id, { ...patch, history: [...r.history, { at, by: v.user.name, text }] });
    await this.audit(tx, v.user, r.companyId, `review.${action}`, 'webReview', r.id, `${r.quarter} review of ${r.siteId}: ${text}`);
    return saved;
  }

  private async respond(v: Viewer, i: Record<string, unknown>) {
    const { r, o, can } = await this.reviewFor(v, i.reviewId);
    if (!can.respond) throw new BadRequest('Only the content owner or the Head of Company answers this review, while it waits for the company.');
    const isHead = v.user.role === 'company_manager' && v.user.companyIds.includes(r.companyId);
    const proxy = this.onBehalf(v, i, o.contentOwnerId === v.user.id || isHead);
    let outcome = (['changes', 'no_changes', 'assist'] as const).find((x) => x === i.outcome);
    let changes: WebChange[] = [];
    let reusedFrom: Id | null = null;
    let topics = Array.isArray(i.topics) ? (i.topics as unknown[]).map(String).filter((t) => REVIEW_TOPICS.some(([k]) => k === t)) : [];
    if (i.reuseFrom) {
      const src = await this.store.get('webReviews', String(i.reuseFrom));
      if (!src || src.quarter !== r.quarter || src.companyId !== r.companyId || !src.response) throw new BadRequest('Reuse only an answer already given for another website of the same company this quarter.');
      outcome = src.response.outcome;
      topics = src.response.topics;
      changes = src.changes.map((c) => ({ ...c, complianceDecision: null }));
      reusedFrom = src.id;
    }
    if (!outcome) throw new BadRequest('Choose: changes needed, reviewed with no changes, or need help.');
    if (!reusedFrom && outcome === 'changes') {
      const list = Array.isArray(i.changes) ? (i.changes as Record<string, unknown>[]) : [];
      if (!list.length) throw new BadRequest('Add at least one change: the page, what it says now and what it should say.');
      changes = list.slice(0, 30).map((c) => ({
        page: this.text(c.page, 'the page or section', 1, 120),
        existing: this.opt(c.existing, 1000),
        proposed: this.text(c.proposed, 'the proposed change', 2, 2000),
        reason: this.opt(c.reason, 500),
        docRef: this.opt(c.docRef, 300),
        verifiedBy: this.opt(c.verifiedBy, 120),
        compliance: c.compliance === true,
        complianceDecision: null,
      }));
    }
    if (outcome === 'no_changes' && i.confirmed !== true && !reusedFrom) throw new BadRequest('Confirm that the website content was reviewed.');
    if (outcome === 'no_changes' && topics.length < REVIEW_TOPICS.length && !reusedFrom)
      throw new BadRequest('Tick every item checked. Mark sections the site does not have as checked too.');
    const note = outcome === 'assist' ? this.text(i.note, 'what help is needed', 3, 1000) : this.opt(i.note, 1000);
    return this.store.transaction(async (tx) => {
      if (outcome === 'assist') {
        const saved = await this.saveReview(tx, v, r, { needsHelp: true }, `Company asked IT for help: ${note}`, 'assist');
        await this.notify(tx, [o.itAdminId, ...(await this.itHeadIds())], `Help needed with the ${r.quarter} website review (${r.siteId})`, { kind: 'review', id: r.id });
        return saved;
      }
      const saved = await this.saveReview(
        tx,
        v,
        r,
        {
          stage: 'verify',
          needsHelp: false,
          response: {
            outcome,
            topics,
            note: proxy ? `${note}${note ? ' ' : ''}(given by ${proxy.name} via ${proxy.via}; recorded by ${v.user.name})` : note,
            by: proxy ? proxy.name : v.user.name,
            byId: proxy ? `proxy:${proxy.name.toLowerCase()}` : v.user.id,
            at: this.now(),
            reusedFrom,
          },
          changes,
        },
        outcome === 'changes' ? `${changes.length} change${changes.length === 1 ? '' : 's'} asked${reusedFrom ? ` (answer reused from ${reusedFrom})` : ''}` : `Reviewed, no changes${reusedFrom ? ` (answer reused from ${reusedFrom})` : ''}`,
        'respond',
      );
      return saved;
    });
  }

  private async verify(v: Viewer, i: Record<string, unknown>) {
    const { r, o, can } = await this.reviewFor(v, i.reviewId);
    if (!can.verify) throw new BadRequest('The business owner (Head of Company, content owner or approver) other than the person who answered verifies the content.');
    const proxy = this.onBehalf(v, i, o.contentOwnerId === v.user.id || o.approverId === v.user.id || (v.user.role === 'company_manager' && v.user.companyIds.includes(r.companyId)));
    if (proxy && r.response?.byId === `proxy:${proxy.name.toLowerCase()}`) throw new BadRequest('Someone other than the person who answered verifies the content.');
    const needsCompliance = r.changes.some((c) => c.compliance && !c.complianceDecision);
    const next: ReviewStage = needsCompliance ? 'compliance' : r.response?.outcome === 'changes' ? 'prepare' : 'approval';
    return this.store.transaction(async (tx) => {
      const saved = await this.saveReview(
        tx,
        v,
        r,
        { stage: next, verified: { by: proxy ? proxy.name : v.user.name, byId: proxy ? `proxy:${proxy.name.toLowerCase()}` : v.user.id, at: this.now() } },
        `Content verified as accurate${proxy ? ` by ${proxy.name} (${proxy.via}; recorded by ${v.user.name})` : ''}; next: ${STAGE_LABEL[next].toLowerCase()}`,
        'verify',
      );
      if (next === 'compliance') {
        const act = (await tx.list('users', {})).filter((u) => u.department === 'audit' && (u.actRole === 'lead' || u.actRole === 'deputy')).map((u) => u.id);
        await this.notify(tx, act, `Licence or certification claim to verify on a company website (${r.quarter})`, { kind: 'review', id: r.id });
      } else if (next === 'approval') await this.notify(tx, [o.approverId], `Website review waiting for your approval (${r.quarter})`, { kind: 'review', id: r.id });
      else await this.notify(tx, [o.itAdminId], `Website changes verified: prepare the preview (${r.quarter})`, { kind: 'review', id: r.id });
      return saved;
    });
  }

  private async complianceDecide(v: Viewer, i: Record<string, unknown>) {
    if (!v.compliance && !v.proxy) throw new BadRequest('Only ACT (compliance) verifies licence and certification claims.');
    const proxy = this.onBehalf(v, i, v.compliance);
    const r = await this.store.get('webReviews', this.text(i.reviewId, 'the review'));
    if (!r) throw new NotFound('Review');
    if (r.stage !== 'compliance') throw new BadRequest('This review is not waiting for a compliance check.');
    const idx = Number(i.index);
    const c = r.changes[idx];
    if (!c || !c.compliance) throw new BadRequest('Choose a change that needs a compliance check.');
    const ok = i.ok === true;
    const note = ok ? this.text(i.note, 'a comment on what you checked (for example, the licence number seen)', 3, 500) : this.text(i.note, 'why the claim cannot be published', 3, 500);
    const changes = r.changes.map((x, k) =>
      k === idx ? { ...x, complianceDecision: { ok, by: proxy ? `${proxy.name} (ACT, via ${proxy.via}; recorded by ${v.user.name})` : v.user.name, at: this.now(), note } } : x,
    );
    const pending = changes.some((x) => x.compliance && !x.complianceDecision);
    const rejected = changes.some((x) => x.complianceDecision && !x.complianceDecision.ok);
    const next: ReviewStage = pending ? 'compliance' : rejected ? 'request' : 'prepare';
    const site = await this.store.get('webSites', r.siteId);
    const o = this.owners(site ?? null, (await this.store.list('webCompanies', { companyId: r.companyId }))[0]);
    return this.store.transaction(async (tx) => {
      const saved = await this.saveReview(tx, v, r, { changes, stage: next, ...(next === 'request' ? { verified: null } : {}) }, `Claim on "${c.page}" ${ok ? 'confirmed' : `not confirmed: ${note}`}`, 'compliance');
      if (next === 'request') await this.notify(tx, [o.contentOwnerId], `A website claim was not confirmed by compliance: please amend (${r.quarter})`, { kind: 'review', id: r.id });
      if (next === 'prepare') await this.notify(tx, [o.itAdminId], `Website changes cleared by compliance: prepare the preview (${r.quarter})`, { kind: 'review', id: r.id });
      return saved;
    });
  }

  private async prepare(v: Viewer, i: Record<string, unknown>) {
    const { r, o, can } = await this.reviewFor(v, i.reviewId);
    if (!can.prepare) throw new BadRequest('Only the website’s IT administrator, backup or the IT Head prepares the change.');
    const previewUrl = this.text(i.previewUrl, 'the preview link', 4, 300);
    const previousVersion = this.text(i.previousVersion, 'the previous version kept (version, commit or backup reference)', 2, 200);
    if (i.desktopOk !== true || i.mobileOk !== true) throw new BadRequest('Check the preview on desktop and on mobile first.');
    const summary = this.text(i.summary, 'a short summary of the change', 3, 1000);
    return this.store.transaction(async (tx) => {
      const saved = await this.saveReview(
        tx,
        v,
        r,
        { stage: 'approval', preparation: { previewUrl, previousVersion, desktopOk: true, mobileOk: true, summary, by: v.user.name, at: this.now() } },
        `Preview ready (${previewUrl}); previous version ${previousVersion}`,
        'prepare',
      );
      await this.notify(tx, [o.approverId], `Website change ready for your approval (${r.quarter}): ${summary}`, { kind: 'review', id: r.id });
      return saved;
    });
  }

  private async approve(v: Viewer, i: Record<string, unknown>) {
    const { r, o, can } = await this.reviewFor(v, i.reviewId);
    if (!can.approve) throw new BadRequest('Only the designated content approver decides this review.');
    const s = await this.settings();
    const proxy = this.onBehalf(v, i, o.approverId === v.user.id);
    const approverId = proxy ? `proxy:${proxy.name.toLowerCase()}` : v.user.id;
    if (s.blockSelfApproval && r.response?.byId === approverId) throw new BadRequest('You answered this review, so someone else must approve it (company approval policy).');
    const decision = (['approve', 'amend', 'reject'] as const).find((x) => x === i.decision);
    if (!decision) throw new BadRequest('Choose approve, ask for amendments or reject.');
    const note = decision === 'approve' ? this.text(i.note, 'a comment with your approval (what you checked)', 3, 1000) : this.text(i.note, 'what must change', 3, 1000);
    const changes = r.response?.outcome === 'changes';
    const next: ReviewStage = decision === 'approve' ? (changes ? 'publish' : 'test') : decision === 'amend' && changes ? 'prepare' : 'request';
    return this.store.transaction(async (tx) => {
      const saved = await this.saveReview(
        tx,
        v,
        r,
        {
          stage: next,
          approvals: [
            ...r.approvals,
            { decision, note: proxy ? `${note}${note ? ' ' : ''}(given by ${proxy.name} via ${proxy.via}; recorded by ${v.user.name})` : note, by: proxy ? proxy.name : v.user.name, byId: approverId, at: this.now() },
          ],
          ...(next === 'request' ? { verified: null, preparation: null } : {}),
        },
        decision === 'approve' ? `Approved${note ? `: ${note}` : ''}` : decision === 'amend' ? `Amendments asked: ${note}` : `Rejected: ${note}`,
        decision,
      );
      if (next === 'request') await this.notify(tx, [o.contentOwnerId], `Website review returned by the approver (${r.quarter}): ${note}`, { kind: 'review', id: r.id });
      else await this.notify(tx, [o.itAdminId], decision === 'approve' ? `Approved: ${changes ? 'publish and test' : 'run the technical check'} (${r.quarter})` : `Amendments asked on the preview (${r.quarter})`, { kind: 'review', id: r.id });
      return saved;
    });
  }

  private async publish(v: Viewer, i: Record<string, unknown>) {
    const { r, can } = await this.reviewFor(v, i.reviewId);
    if (!can.publish) throw new BadRequest('Publish only after approval, by the website’s IT administrator, backup or the IT Head.');
    if (!r.approvals.some((a) => a.decision === 'approve')) throw new BadRequest('Nothing is published before it is approved.');
    const at = i.at && typeof i.at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(i.at) ? (i.at as IsoDateTime) : this.now();
    if (at > this.now()) throw new BadRequest('The publication time cannot be in the future.');
    const versionRef = this.text(i.versionRef, 'the deployment or version reference', 2, 200);
    const liveUrl = this.text(i.liveUrl, 'the live address', 4, 300);
    const issue = this.opt(i.issue, 1000);
    return this.store.transaction(async (tx) => {
      const saved = await this.saveReview(
        tx,
        v,
        r,
        { stage: 'test', publication: { at, by: v.user.name, versionRef, liveUrl, issue, method: 'manual' } },
        `Published by hand (integration not connected), version ${versionRef}${issue ? `; issue: ${issue}` : ''}`,
        'publish',
      );
      return saved;
    });
  }

  private async test(v: Viewer, i: Record<string, unknown>) {
    const { r, o, can } = await this.reviewFor(v, i.reviewId);
    if (!can.test) throw new BadRequest('Only the website’s IT administrator, backup or the IT Head records the tests, after publication or approval.');
    const results = Array.isArray(i.results) ? (i.results as Record<string, unknown>[]) : [];
    if (!results.length) throw new BadRequest('Record at least one test result.');
    const at = this.now();
    const tests = r.tests.map((t) => ({ ...t }));
    const newFails: WebTest[] = [];
    for (const x of results) {
      const t = tests.find((tt) => tt.key === x.key);
      if (!t) throw new BadRequest(`Unknown test ${String(x.key)}.`);
      const result = (['pass', 'fail', 'na'] as const).find((s) => s === x.result);
      if (!result) throw new BadRequest(`Choose pass, fail or not applicable for "${testLabel(t.key)}".`);
      if (t.result === 'fail' && result !== 'fail') {
        const correction = this.text(x.correction, `what was corrected before "${testLabel(t.key)}" was tested again`, 3, 500);
        t.correction = correction;
      }
      if (result === 'na' && !this.opt(x.note)) throw new BadRequest(`Say why "${testLabel(t.key)}" does not apply.`);
      if (result === 'fail' && t.result !== 'fail') newFails.push(t);
      Object.assign(t, { result, note: this.opt(x.note, 500), evidence: this.opt(x.evidence, 300), by: v.user.name, at });
    }
    const all = tests.every((t) => t.result);
    return this.store.transaction(async (tx) => {
      for (const t of newFails) {
        const issue = await this.newIssue(tx, v, {
          companyId: r.companyId,
          siteId: r.siteId,
          domainId: null,
          category: 'TEST_FAIL',
          description: `Failed after ${r.quarter} review: ${testLabel(t.key)}${t.note ? ` (${t.note})` : ''}`,
          severity: t.key === 'home' || t.key === 'https' ? 'high' : 'normal',
          ownerId: o.itAdminId,
          origin: { kind: 'review', id: r.id },
        });
        t.issueId = issue.id;
      }
      const passes = results.filter((x) => x.result === 'pass').length;
      return this.saveReview(
        tx,
        v,
        r,
        { tests, stage: all ? 'complete' : 'test' },
        `Tests recorded: ${passes} passed, ${newFails.length} new failure${newFails.length === 1 ? '' : 's'}${newFails.length ? ' (issue opened)' : ''}`,
        'test',
      );
    });
  }

  /** Complete only with the content reviewed, approval recorded, publication (when changed) and every test answered. */
  private async complete(v: Viewer, i: Record<string, unknown>) {
    const { r, o, can } = await this.reviewFor(v, i.reviewId);
    if (!can.complete) throw new BadRequest('Only the assigned IT staff records completion once all tests are entered.');
    const problems: string[] = [];
    if (!r.response || r.response.outcome === 'assist') problems.push('the company has not reviewed the content');
    if (!r.verified) problems.push('the business owner has not verified it');
    if (!r.approvals.some((a) => a.decision === 'approve')) problems.push('no approval is recorded');
    if (r.response?.outcome === 'changes' && !r.publication) problems.push('the approved change is not published');
    if (r.tests.some((t) => !t.result)) problems.push('some tests are not entered');
    if (problems.length) throw new BadRequest(`Cannot complete yet: ${problems.join('; ')}.`);
    const issues = await this.store.list('webIssues', {});
    const outstanding: string[] = [];
    for (const t of r.tests.filter((x) => x.result === 'fail')) {
      const issue = issues.find((x) => x.id === t.issueId);
      if (!issue || !issue.ownerId) throw new BadRequest(`"${testLabel(t.key)}" failed: give its issue an owner and due date first.`);
      if (issue.status === 'open' || issue.status === 'in_progress') outstanding.push(`${testLabel(t.key)}: ${issue.ref}, owner ${(await this.store.get('users', issue.ownerId))?.name ?? issue.ownerId}, due ${issue.targetOn}`);
    }
    const heads = this.headsOf(await this.store.list('users', {}), r.companyId).map((u) => u.id);
    return this.store.transaction(async (tx) => {
      const saved = await this.saveReview(
        tx,
        v,
        r,
        { stage: 'done', completed: { by: v.user.name, at: this.now(), outstanding } },
        outstanding.length ? `Completed with ${outstanding.length} outstanding item${outstanding.length === 1 ? '' : 's'}` : 'Completed, nothing outstanding',
        'complete',
      );
      await this.notify(tx, [...(await this.itHeadIds()), ...heads, o.contentOwnerId], `${r.quarter} website review completed${outstanding.length ? ` with ${outstanding.length} outstanding` : ''}`, { kind: 'review', id: r.id });
      return saved;
    });
  }

  // ----- Monthly checks -----

  private async openChecks(v: Viewer, i: Record<string, unknown>) {
    if (!v.itHead) throw new BadRequest('Only the IT Head assigns the monthly checks.');
    await this.store.lock?.('webSettings', 'settings');
    const month = typeof i.month === 'string' && /^\d{4}-\d{2}$/.test(i.month) ? i.month : monthOf(this.today());
    const assignTo = await this.userId(i.assignToId, 'Checker', (u) => u.department === 'it');
    const siteIds = Array.isArray(i.siteIds) ? (i.siteIds as unknown[]).map(String) : null;
    const [sites, checks] = await Promise.all([this.store.list('webSites', {}), this.store.list('webChecks', {})]);
    const due = sites.filter((s) => s.status === 'live' && (!siteIds || siteIds.includes(s.id)));
    if (!siteIds) await this.openPresenceChecks(v.user, month, assignTo);
    return this.store.transaction(async (tx) => {
      let made = 0;
      let reassigned = 0;
      for (const s of due) {
        const have = checks.find((c) => c.siteId === s.id && c.month === month);
        if (have) {
          if (assignTo && !have.doneAt && have.assignedToId !== assignTo) {
            await tx.update('webChecks', have.id, { assignedToId: assignTo });
            reassigned += 1;
          }
          continue;
        }
        await tx.insert('webChecks', {
          id: `wk-${month}-${s.id}`,
          siteId: s.id,
          companyId: s.companyId,
          month,
          assignedToId: assignTo,
          items: MONTHLY_ITEMS.map(([key]) => ({ key, result: null, note: '', issueId: null })),
          na: null,
          doneBy: null,
          doneAt: null,
          source: 'manual',
        });
        made += 1;
      }
      if (assignTo) await this.notify(tx, [assignTo], `${made + reassigned} monthly website check${made + reassigned === 1 ? '' : 's'} assigned for ${month}`, { kind: 'check', id: month });
      await this.audit(tx, v.user, null, 'checks.open', 'webCheck', month, `${month}: ${made} monthly checks opened${reassigned ? `, ${reassigned} reassigned` : ''}`);
      return { month, opened: made, reassigned };
    });
  }

  private async recordCheck(v: Viewer, i: Record<string, unknown>) {
    const c = await this.store.get('webChecks', this.text(i.checkId, 'the check'));
    if (!c) throw new NotFound('Check');
    const tgt = this.checkTarget(c, await this.load());
    const site = { name: tgt.name };
    const o = tgt.owners;
    if (!v.itHead && !(v.it && (c.assignedToId === v.user.id || o.itAdminId === v.user.id || o.backupId === v.user.id)))
      throw new BadRequest('Only the assigned IT staff or the IT Head records this check.');
    if (c.doneAt) throw new BadRequest('This check is already completed. Raise an issue for anything new.');
    if (i.na) {
      const reason = this.text(i.na, 'why the check does not apply this month', 5, 300);
      return this.store.transaction(async (tx) => {
        const saved = await tx.update('webChecks', c.id, { na: { reason, by: v.user.name }, doneBy: v.user.name, doneAt: this.now() });
        await this.audit(tx, v.user, c.companyId, 'check.na', 'webCheck', c.id, `${c.month} check of ${site?.name}: not applicable (${reason})`);
        return saved;
      });
    }
    const results = Array.isArray(i.results) ? (i.results as Record<string, unknown>[]) : [];
    const items = c.items.map((x) => ({ ...x }));
    for (const x of results) {
      const it = items.find((y) => y.key === x.key);
      if (!it) throw new BadRequest(`Unknown check item ${String(x.key)}.`);
      const result = (['pass', 'fail', 'na'] as const).find((s) => s === x.result);
      if (!result) throw new BadRequest('Choose pass, fail or not applicable.');
      Object.assign(it, { result, note: this.opt(x.note, 500) });
    }
    const finish = i.finish === true;
    if (finish && items.some((x) => !x.result)) throw new BadRequest('Enter every item before completing the check.');
    return this.store.transaction(async (tx) => {
      for (const it of items.filter((x) => x.result === 'fail' && !x.issueId)) {
        const kind = c.kind ?? 'site';
        const label = checkItems(kind).find(([k]) => k === it.key)?.[1] ?? it.key;
        const serious = kind === 'social' ? ['access', 'twofa', 'impersonation', 'posts'] : kind === 'mail' ? ['spf', 'dkim', 'dmarc', 'forwarding', 'mfa', 'leavers'] : [];
        const issue = await this.newIssue(tx, v, {
          companyId: c.companyId,
          siteId: kind === 'site' ? c.siteId : null,
          domainId: kind === 'mail' ? c.siteId : null,
          category:
            kind === 'social'
              ? 'SOCIAL'
              : kind === 'mail'
                ? 'EMAIL'
                : it.key === 'loads'
                  ? 'DOWN'
                  : it.key === 'https'
                    ? 'SECURITY'
                    : it.key === 'form'
                      ? 'FORM'
                      : it.key === 'tamper'
                        ? 'UNAUTHORISED'
                        : 'TEST_FAIL',
          description: `Monthly check ${c.month}${kind === 'site' ? '' : ` of ${tgt.name}`}: ${label} failed${it.note ? ` (${it.note})` : ''}`,
          severity:
            kind !== 'site'
              ? serious.includes(it.key)
                ? 'high'
                : 'normal'
              : it.key === 'loads' || it.key === 'tamper'
                ? 'critical'
                : it.key === 'https' || it.key === 'form'
                  ? 'high'
                  : 'normal',
          ownerId: o.itAdminId,
          origin: { kind: 'check', id: c.id },
        });
        it.issueId = issue.id;
      }
      const saved = await tx.update('webChecks', c.id, { items, ...(finish ? { doneBy: v.user.name, doneAt: this.now() } : {}) });
      const fails = items.filter((x) => x.result === 'fail').length;
      await this.audit(tx, v.user, c.companyId, finish ? 'check.done' : 'check.save', 'webCheck', c.id, `${c.month} check of ${site?.name}: ${finish ? 'completed' : 'saved'}${fails ? `, ${fails} failed (issue opened)` : ''} (manual)`);
      return saved;
    });
  }

  // ----- Issues -----

  private async newIssue(
    tx: Store,
    v: Viewer,
    x: { companyId: Id; siteId: Id | null; domainId: Id | null; category: IssueCategory; description: string; severity: IssueSeverity; ownerId: Id | null; origin: WebIssue['origin']; impact?: string; immediateAction?: string; escalateToId?: Id | null; targetOn?: IsoDate | null },
  ): Promise<WebIssue> {
    const s = await this.settings();
    const all = await tx.list('webIssues', {});
    const at = this.now();
    const issue: WebIssue = {
      id: `wi-${all.length + 1}-${toMs(at)}`,
      ref: `WEB-${String(all.length + 1).padStart(4, '0')}`,
      companyId: x.companyId,
      siteId: x.siteId,
      domainId: x.domainId,
      category: x.category,
      description: x.description,
      severity: x.severity,
      reportedBy: v.user.name,
      reportedById: v.user.id,
      at,
      ownerId: x.ownerId,
      impact: x.impact ?? '',
      immediateAction: x.immediateAction ?? '',
      escalateToId: x.escalateToId ?? (x.severity === 'critical' ? (s.escalationIds[0] ?? null) : null),
      targetOn: x.targetOn ?? dateOf(fromMs(toMs(at) + s.issueTargetHours[x.severity] * 3_600_000)),
      status: 'open',
      resolution: null,
      origin: x.origin,
      urgent: null,
      history: [{ at, by: v.user.name, text: 'Reported' }],
    };
    // Every website, social media and email issue is also an IT help request, so IT works one queue (Fauzan, 31 Oct 2026).
    const candidate = x.ownerId ? await tx.get('users', x.ownerId) : null;
    const owner = webManager(v.user)&&webActive(candidate,this.today())&&webIt(candidate)&&['manager','lead','executive'].includes(candidate.itRole??'')?candidate:null;
    issue.ownerId=owner?.id??null;
    const ticket = await tx.createItTicket({
      raisedBy: v.user.name,
      raisedById: v.user.id,
      category: (x.category === 'SOCIAL' ? 'SOCIAL' : x.category === 'EMAIL' ? 'EMAIL' : 'WEBSITE') as 'WEBSITE' | 'SOCIAL' | 'EMAIL',
      priority: (x.severity === 'critical' ? 'P1' : x.severity === 'high' ? 'P2' : 'P3') as 'P1' | 'P2' | 'P3',
      title: `${issue.ref}: ${x.description}`.slice(0, 120),
      detail: `Work it in Websites (${issue.ref}); resolve with evidence, then the independent checker confirms.`,
      at,
      assignedTo: owner?.name ?? null,
      assignedToId: owner?.id ?? null,
      status: 'open' as const,
      resolvedAt: null,
      resolution: '',
      channel: 'prima' as const,
      sourceRef: `web:${issue.id}`,
    });
    issue.itTicketId = ticket.id;
    await tx.insert('webIssues', issue);
    await this.audit(tx, v.user, x.companyId, 'issue.raise', 'webIssue', issue.id, `${issue.ref} ${x.severity}: ${x.description} (IT request ${ticket.ref})`);
    const heads = x.severity === 'critical' ? await this.itHeadIds() : [];
    await this.notify(tx, [x.ownerId, ...heads, x.severity === 'critical' ? issue.escalateToId : null], `${x.severity === 'critical' ? 'CRITICAL website issue' : 'Website issue'} ${issue.ref}: ${x.description}`, {
      kind: 'issue',
      id: issue.id,
    });
    return issue;
  }

  private async raiseIssue(v: Viewer, i: Record<string, unknown>) {
    const companyId = this.text(i.companyId, 'the company');
    const company = await this.store.get('companies', companyId);
    if (!company) throw new NotFound('Company');
    const ownCompany = (v.user.role === 'company_manager' || v.user.role === 'admin_exec') && v.user.companyIds.includes(companyId);
    if (!v.it && !v.group && !ownCompany && !v.compliance) throw new BadRequest('Only IT, group management or the company’s own staff report a website issue.');
    const siteId = this.opt(i.siteId) || null;
    const site = siteId ? await this.store.get('webSites', siteId) : null;
    if (siteId && (!site || site.companyId !== companyId)) throw new BadRequest('Choose a website of this company.');
    const domainId = this.opt(i.domainId) || null;
    const severity = (['critical', 'high', 'normal', 'low'] as const).find((s) => s === i.severity);
    if (!severity) throw new BadRequest('Choose how serious it is.');
    const category = (['DOWN', 'SECURITY', 'WRONG_INFO', 'CLAIM', 'FORM', 'UNAUTHORISED', 'DOMAIN', 'EMAIL', 'TEST_FAIL', 'OTHER'] as const).find((c) => c === i.category) ?? 'OTHER';
    const o = this.owners(site ?? null, (await this.store.list('webCompanies', { companyId }))[0]);
    if(i.ownerId && !webManager(v.user))throw new BadRequest('Only the IT Manager delegates linked website work.');
    const ownerId = webManager(v.user) && i.ownerId ? await this.userId(i.ownerId,'Responsible IT staff',u=>webActive(u,this.today())&&webIt(u)&&['manager','lead','executive'].includes(u.itRole??'')) : null;
    return this.store.transaction(async (tx) =>
      this.newIssue(tx, v, {
        companyId,
        siteId,
        domainId,
        category,
        description: this.text(i.description, 'what is wrong', 3, 1000),
        severity,
        ownerId,
        origin: { kind: 'manual', id: null },
        impact: this.opt(i.impact, 500),
        immediateAction: this.opt(i.immediateAction, 500),
        escalateToId: await this.userId(i.escalateToId, 'Escalate to'),
        targetOn: this.date(i.targetOn, 'Target date'),
      }),
    );
  }

  async ticketPolicies(user: User) {
    const d=await this.load(),current=d.users.find(u=>u.id===user.id),result:Record<string,ReturnType<typeof webTicketPolicy>>={};
    if(!webActive(current,this.today()))return result;
    const visible=this.visibleCompanyIds(this.viewer(current),d);
    for(const t of await this.store.list('itTickets',{})) {
      if(!t.sourceRef?.startsWith('web:'))continue;
      const issue=d.issues.find(x=>x.id===t.sourceRef!.slice(4)&&x.itTicketId===t.id);
      const scoped=!!issue&&(visible.has(issue.companyId)||(webIt(current)&&t.assignedToId===current.id));
      result[t.id]=webTicketPolicy(t,current,d.users.find(u=>u.id===t.raisedById),this.today(),scoped);
    }
    return result;
  }

  /** The only mutation boundary for linked web tickets, sharing the website transaction lock. */
  async linkedTicket(user: User, id: string, action: 'assign'|'take'|'resolve'|'confirm'|'reopen', i: Record<string,unknown> = {}):Promise<ItTicket> {
    if(!this.mutationLocked)return this.serialize(s=>s.linkedTicket(user,id,action,i));
    const current=await this.store.get('users',user.id);
    if(!webActive(current,this.today()))throw new BadRequest('Current personal sign-in required.');
    user=current;
    const t=await this.store.get('itTickets',id);
    if(!t?.sourceRef?.startsWith('web:'))throw new NotFound('Linked website request');
    const issue=await this.store.get('webIssues',t.sourceRef.slice(4));
    if(!issue||issue.itTicketId!==t.id)throw new NotFound('Linked website issue');
    const visible=this.visibleCompanyIds(this.viewer(user),await this.load());
    if(!visible.has(issue.companyId)&&!(webIt(user)&&t.assignedToId===user.id))throw new NotFound('Linked website issue scope');
    const requester=await this.store.get('users',t.raisedById);
    const policy=webTicketPolicy(t,user,requester??undefined,this.today());
    const at=this.now(), version=t.webResolutionVersion??0;
    let patch:Partial<ItTicket>={}, note='';
    if(action==='assign'){
      if(!policy.canAssign)throw new BadRequest('The IT Manager delegates an open linked request.');
      const to=await this.store.get('users',String(i.toId??''));
      if(!webActive(to,this.today())||!webIt(to)||!['manager','lead','executive'].includes(to.itRole??''))throw new BadRequest('Choose active personal IT staff.');
      patch={assignedToId:to.id,assignedTo:to.name};note=`Assigned to ${to.name}`;
    }else if(action==='take'||action==='resolve'){
      if(!webIt(user)||t.assignedToId!==user.id||t.status==='resolved')throw new BadRequest('Only the current delegated IT fixer works an open linked request.');
      if(action==='take'){patch={status:'in_progress'};note='Work started';}
      else{
        note=this.policyText(i.note,'combined fix and evidence',3,1000);
        const role=user.itRole;
        if(role!=='manager'&&role!=='lead'&&role!=='executive')throw new BadRequest('Current IT role required.');
        patch={status:'resolved',resolution:note,resolvedAt:at,resolvedById:user.id,resolvedBy:user.name,confirmedAt:null,confirmedVia:null,webResolutionVersion:version+1,webResolution:{version:version+1,resolverId:user.id,resolverRole:role,at}};
      }
    }else if(action==='confirm'){
      if(typeof i.fixed!=='boolean')throw new BadRequest('Fixed must be true or false.');
      if(!policy.canConfirm)throw new BadRequest(policy.legacyResolution?'Legacy resolution needs a reasoned IT Manager reopen, then fresh evidence.':'Only the independent current checker can confirm or return this fix.');
      if(!Number.isSafeInteger(i.expectedResolutionVersion)||i.expectedResolutionVersion!==version)throw new BadRequest('Resolution changed; reload before checking.');
      note=this.policyText(i.note,'checker comment',3,500);
      patch=i.fixed?{confirmedAt:at,confirmedVia:`Prima: ${user.name}`}:{status:'in_progress',confirmedAt:null,confirmedVia:null,resolvedAt:null,resolution:'',resolvedById:null,resolvedBy:null,webResolution:null,reopened:(t.reopened??0)+1};
    }else{
      if(!policy.canReopen)throw new BadRequest('Only the current IT Manager reopens resolved linked work with a reason.');
      if(!Number.isSafeInteger(i.expectedResolutionVersion)||i.expectedResolutionVersion!==version)throw new BadRequest('Resolution changed; reload before reopening.');
      note=this.policyText(i.note,'reason for reopening',3,500);
      patch={status:'open',resolvedAt:null,resolution:'',resolvedById:null,resolvedBy:null,confirmedAt:null,confirmedVia:null,webResolution:null,reopened:(t.reopened??0)+1};
    }
    const history={at,actorId:user.id,action:action==='confirm'?(i.fixed?'confirm':'return'):action,note,resolutionVersion:action==='resolve'?version+1:version,resolution:action==='resolve'?note:t.resolution,resolverId:action==='resolve'?user.id:t.webResolution?.resolverId??t.resolvedById??null,resolverRole:action==='resolve'?user.itRole??null:t.webResolution?.resolverRole??null};
    const saved=await this.store.update('itTickets',id,{...patch,webHistory:[...(t.webHistory??[]),history]});
    await this.syncLinkedTicket(user,saved);
    await this.audit(this.store,user,issue.companyId,`issue.ticket.${history.action}`,'webIssue',issue.id,`${issue.ref}: ${note}`);
    return saved;
  }

  async syncLinkedTicket(user: User, ticket: ItTicket) {
    const issue = (await this.store.list('webIssues', {})).find(x => x.itTicketId === ticket.id && ticket.sourceRef === `web:${x.id}`);
    if (!issue) return;
    const at = this.now();
    const status = ticket.status === 'resolved' ? (ticket.confirmedAt ? 'closed' : 'resolved') : ticket.status === 'in_progress' ? 'in_progress' : 'open';
    const resolution = ticket.status === 'resolved' ? { note: ticket.resolution, evidence: `Linked IT request ${ticket.ref}; verify its recorded proof before acceptance.`, by: ticket.resolvedBy ?? user.name, at: ticket.resolvedAt ?? at } : null;
    await this.store.update('webIssues', issue.id, { status, ownerId: ticket.assignedToId ?? null, resolution, history: [...issue.history, { at, by: user.name, text: `Linked IT request ${ticket.ref}: ${status}` }] });
    await this.audit(this.store, user, issue.companyId, 'issue.it-sync', 'webIssue', issue.id, `${issue.ref}: ${status} from linked IT request`);
  }

  private async issueStep(v: Viewer, i: Record<string, unknown>) {
    const x = await this.store.get('webIssues', this.text(i.issueId, 'the issue'));
    if (!x) throw new NotFound('Issue');
    const visible = this.visibleCompanyIds(v, await this.load());
    if (!visible.has(x.companyId) && !(x.itTicketId&&x.reportedById===v.user.id) && !(v.it && x.ownerId === v.user.id)) throw new NotFound('Issue');
    const step = (['assign', 'start', 'note', 'resolve', 'close', 'reopen'] as const).find((s) => s === i.step);
    if (!step) throw new BadRequest('Unknown step.');
    if(x.itTicketId && ['assign','start','resolve','close','reopen'].includes(step)) {
      const action=step==='start'?'take':step==='close'?'confirm':step;
      const note=step==='resolve'?`${this.policyText(i.note,'what fixed it',3,1000)} (evidence: ${this.policyText(i.evidence,'evidence',3,300)})`:i.note;
      await this.linkedTicket(v.user,x.itTicketId,action as 'assign'|'take'|'resolve'|'confirm'|'reopen',{...i,toId:i.ownerId,note,fixed:step==='close'?i.fixed:undefined});
      return (await this.store.get('webIssues',x.id))!;
    }
    const owner = x.ownerId === v.user.id;
    if (step === 'note' && !v.itHead && !(v.it && owner) && x.reportedById !== v.user.id) throw new BadRequest('Only responsible staff or the reporter may note this issue.');
    if (step === 'assign' && !v.itHead) throw new BadRequest('Only the IT Head assigns website issues.');
    if ((step === 'start' || step === 'resolve') && !owner && !v.itHead) throw new BadRequest('Only the responsible IT staff or the IT Head works this issue.');
    if ((step === 'close' || step === 'reopen') && !v.itHead && x.reportedById !== v.user.id) throw new BadRequest('The person who reported it or the IT Head closes or reopens it.');
    const at = this.now();
    let patch: Partial<WebIssue> = {};
    let text = '';
    if (step === 'assign') {
      const ownerId = await this.userId(i.ownerId, 'Responsible IT staff', (u) => u.department === 'it');
      if (!ownerId) throw new BadRequest('Choose who in IT is responsible.');
      const targetOn = this.date(i.targetOn, 'Target date') ?? x.targetOn;
      patch = { ownerId, targetOn };
      text = `Assigned, due ${targetOn}`;
    } else if (step === 'start') {
      if (x.status !== 'open') throw new BadRequest('Only an open issue can start; reopen resolved work with a reason.');
      patch = { status: 'in_progress' };
      text = 'Work started';
    } else if (step === 'note') {
      text = this.text(i.note, 'the note', 2, 1000);
    } else if (step === 'resolve') {
      if (x.status === 'resolved' || x.status === 'closed') throw new BadRequest('Already resolved.');
      const note = this.text(i.note, 'what was done to fix it', 3, 1000);
      const evidence = this.text(i.evidence, 'the evidence it works (screenshot, test enquiry, link)', 3, 300);
      patch = { status: 'resolved', resolution: { note, evidence, by: v.user.name, at } };
      text = `Resolved: ${note}`;
    } else if (step === 'close') {
      if (x.itTicketId) throw new BadRequest('The requester confirms the linked IT help request.');
      if (x.status !== 'resolved') throw new BadRequest('Resolve it with evidence before closing.');
      patch = { status: 'closed' };
      text = 'Closed';
    } else {
      if (x.status !== 'resolved' && x.status !== 'closed') throw new BadRequest('Only resolved or closed issues can reopen.');
      patch = { status: 'open', resolution: null };
      text = `Reopened: ${this.text(i.note, 'why it is reopened', 3, 500)}`;
    }
    return this.store.transaction(async (tx) => {
      const saved = await tx.update('webIssues', x.id, { ...patch, history: [...x.history, { at, by: v.user.name, text }] });
      await this.audit(tx, v.user, x.companyId, `issue.${step}`, 'webIssue', x.id, `${x.ref}: ${text}`);
      // Keep the linked IT help request in step: resolved here resolves it there; reopened here reopens it.
      const ticket = x.itTicketId ? await tx.get('itTickets', x.itTicketId) : null;
      if (ticket && step === 'resolve')
        await tx.update('itTickets', ticket.id, { status: 'resolved', resolvedAt: at, resolution: `${patch.resolution?.note ?? ''} (evidence: ${patch.resolution?.evidence ?? ''})`.slice(0, 1000), resolvedById: v.user.id, resolvedBy: v.user.name, confirmedAt: null, confirmedVia: null });
      if (ticket && (step === 'reopen' || step === 'start')) await tx.update('itTickets', ticket.id, { status: step === 'start' ? 'in_progress' : 'open', resolvedAt: null, resolution: '', resolvedById: null, resolvedBy: null, confirmedAt: null, confirmedVia: null, reopened: (ticket.reopened ?? 0) + (step === 'reopen' ? 1 : 0) });
      if (ticket && step === 'assign' && patch.ownerId) {
        const to = await tx.get('users', patch.ownerId);
        await tx.update('itTickets', ticket.id, { assignedTo: to?.name ?? null, assignedToId: patch.ownerId });
      }
      if (step === 'assign') await this.notify(tx, [patch.ownerId], `Website issue ${x.ref} assigned to you: ${x.description}`, { kind: 'issue', id: x.id });
      return saved;
    });
  }

  /** Remove or fix unsafe or wrong information now, under the company's emergency authorisation, and record it. */
  private async urgentChange(v: Viewer, i: Record<string, unknown>) {
    const x = await this.store.get('webIssues', this.text(i.issueId, 'the issue'));
    if (!x) throw new NotFound('Issue');
    const site = x.siteId ? await this.store.get('webSites', x.siteId) : null;
    const o = this.owners(site ?? null, (await this.store.list('webCompanies', { companyId: x.companyId }))[0]);
    const authorised = o.approverId === v.user.id || v.group || (v.user.role === 'company_manager' && v.user.companyIds.includes(x.companyId));
    if (!x.urgent) {
      if (!authorised) throw new BadRequest('Only the content approver, the Head of Company or group management approves an urgent change.');
      const reason = this.text(i.reason, 'why it cannot wait', 5, 500);
      const changed = this.text(i.changed, 'what will be changed or removed', 3, 1000);
      const urgent = { reason, approvedBy: v.user.name, approvedById: v.user.id, changed, publishedAt: null, checks: '', at: this.now() };
      return this.store.transaction(async (tx) => {
        const saved = await tx.update('webIssues', x.id, { urgent, history: [...x.history, { at: this.now(), by: v.user.name, text: `Urgent change approved: ${changed}` }] });
        await this.audit(tx, v.user, x.companyId, 'issue.urgent.approve', 'webIssue', x.id, `${x.ref}: urgent change approved (${reason})`);
        await this.notify(tx, [x.ownerId ?? o.itAdminId, ...(await this.itHeadIds())], `Urgent website change approved on ${x.ref}: publish now`, { kind: 'issue', id: x.id });
        return saved;
      });
    }
    if (!v.itHead && !(v.it && (x.ownerId === v.user.id || o.itAdminId === v.user.id || o.backupId === v.user.id))) throw new BadRequest('IT publishes the approved urgent change.');
    if (x.urgent.publishedAt) throw new BadRequest('The urgent change is already recorded as published.');
    const checks = this.text(i.checks, 'the checks done after publishing', 3, 1000);
    const urgent = { ...x.urgent, publishedAt: this.now(), checks };
    return this.store.transaction(async (tx) => {
      const saved = await tx.update('webIssues', x.id, { urgent, history: [...x.history, { at: this.now(), by: v.user.name, text: `Urgent change published by hand; checks: ${checks}` }] });
      await this.audit(tx, v.user, x.companyId, 'issue.urgent.publish', 'webIssue', x.id, `${x.ref}: urgent change published (manual)`);
      return saved;
    });
  }

  // ----- DNS change control -----

  private async raiseDns(v: Viewer, i: Record<string, unknown>) {
    if (!v.it) throw new BadRequest('Only IT raises a DNS or nameserver change.');
    const dom = await this.store.get('webDomains', this.text(i.domainId, 'the domain'));
    if (!dom) throw new NotFound('Domain');
    const reason = this.text(i.reason, 'what will change and why', 5, 1000);
    const windowFrom = this.text(i.windowFrom, 'the start of the change window') as IsoDateTime;
    const windowTo = this.text(i.windowTo, 'the end of the change window') as IsoDateTime;
    if (windowTo <= windowFrom) throw new BadRequest('The window must end after it starts.');
    const ownerId = (await this.userId(i.ownerId, 'IT owner', (u) => u.department === 'it')) ?? v.user.id;
    const all = await this.store.list('webDnsChanges', {});
    const at = this.now();
    const c: WebDnsChange = {
      id: `wdns-${all.length + 1}-${toMs(at)}`,
      ref: `DNS-${String(all.length + 1).padStart(3, '0')}`,
      domainId: dom.id,
      reason,
      windowFrom,
      windowTo,
      ownerId,
      raisedBy: v.user.name,
      raisedById: v.user.id,
      at,
      pre: DNS_PRE.map(([key]) => ({ key, doneAt: key === 'owner' ? at : null, by: key === 'owner' ? v.user.name : null, note: '' })),
      approval: null,
      post: DNS_POST.map(([key]) => ({ key, result: null, note: '', by: null, at: null })),
      status: 'draft',
      finalConfig: '',
      incident: '',
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('webDnsChanges', c);
      await this.audit(tx, v.user, dom.companyIds[0], 'dns.raise', 'webDnsChange', c.id, `${c.ref} on ${dom.name}: ${reason}`);
      return c;
    });
  }

  private async dnsStep(v: Viewer, i: Record<string, unknown>) {
    const c = await this.store.get('webDnsChanges', this.text(i.changeId, 'the change'));
    if (!c) throw new NotFound('DNS change');
    const dom = await this.store.get('webDomains', c.domainId);
    const step = (['pre', 'approve', 'post', 'finish', 'rollback', 'cancel'] as const).find((s) => s === i.step);
    if (!step) throw new BadRequest('Unknown step.');
    const worker = v.itHead || (v.it && c.ownerId === v.user.id);
    const at = this.now();
    let patch: Partial<WebDnsChange> = {};
    let text = '';
    if (step === 'pre') {
      if (!worker) throw new BadRequest('Only the change owner or the IT Head works the checklist.');
      if (c.status !== 'draft') throw new BadRequest('The pre-change checklist is closed once approved.');
      const key = String(i.key);
      const item = c.pre.find((p) => p.key === key);
      if (!item) throw new BadRequest('Unknown checklist item.');
      const note = key === 'export' || key === 'm365' || key === 'rollback' || key === 'current' ? this.text(i.note, 'where it is recorded', 3, 1000) : this.opt(i.note, 1000);
      patch = { pre: c.pre.map((p) => (p.key === key ? { ...p, doneAt: at, by: v.user.name, note } : p)) };
      text = `Done: ${DNS_PRE.find(([k]) => k === key)?.[1]}`;
    } else if (step === 'approve') {
      if (!v.tech && !v.admin) throw new BadRequest('Only the IT Lead (technical) or the CEO (owner) approves a DNS change.');
      if (c.raisedById === v.user.id) throw new BadRequest('Someone other than the person who raised it approves the change.');
      if (c.status !== 'draft') throw new BadRequest('Not waiting for approval.');
      if (c.pre.some((p) => !p.doneAt)) throw new BadRequest('Finish the pre-change checklist first: existing records, Microsoft 365 records and rollback plan.');
      patch = { status: 'approved', approval: { by: v.user.name, byId: v.user.id, at, note: this.text(i.note, 'a comment with your approval (what you checked)', 3, 500) } };
      text = v.admin ? 'Approved by the CEO' : 'Approved by the IT Lead';
    } else if (step === 'post') {
      if (!worker) throw new BadRequest('Only the change owner or the IT Head records the post-change tests.');
      if (c.status !== 'approved') throw new BadRequest('Record tests after the approved change is made.');
      const key = String(i.key);
      const result = (['pass', 'fail', 'na'] as const).find((s) => s === i.result);
      if (!result || !c.post.some((p) => p.key === key)) throw new BadRequest('Choose the test and the result.');
      patch = { post: c.post.map((p) => (p.key === key ? { ...p, result, note: this.opt(i.note, 500), by: v.user.name, at } : p)) };
      text = `${DNS_POST.find(([k]) => k === key)?.[1]}: ${result}`;
    } else if (step === 'finish') {
      if (!worker) throw new BadRequest('Only the change owner or the IT Head closes the change.');
      if (c.post.some((p) => !p.result)) throw new BadRequest('Record every post-change test first.');
      const finalConfig = this.text(i.finalConfig, 'the final DNS set-up', 3, 2000);
      const fails = c.post.filter((p) => p.result === 'fail');
      if (fails.length && !this.opt(i.incident)) throw new BadRequest('A test failed: record the incident and what was done.');
      patch = { status: 'done', finalConfig, incident: this.opt(i.incident, 1000) };
      text = 'Change completed and tested';
    } else if (step === 'rollback') {
      if (!worker) throw new BadRequest('Only the change owner or the IT Head rolls back.');
      patch = { status: 'rolled_back', incident: this.text(i.incident, 'what went wrong and what was restored', 3, 1000) };
      text = 'Rolled back';
    } else {
      if (!worker || c.status !== 'draft') throw new BadRequest('Only a change not yet approved is cancelled, by its owner or the IT Head.');
      patch = { status: 'cancelled' };
      text = 'Cancelled';
    }
    return this.store.transaction(async (tx) => {
      const saved = await tx.update('webDnsChanges', c.id, patch);
      await this.audit(tx, v.user, dom?.companyIds[0] ?? null, `dns.${step}`, 'webDnsChange', c.id, `${c.ref}: ${text}`);
      if (step === 'pre' && saved.pre.every((p) => p.doneAt))
        await this.notify(tx, (await this.itHeadIds()).filter((x) => x !== c.raisedById), `DNS change ${c.ref} on ${dom?.name} ready for approval`, { kind: 'dns', id: c.id });
      return saved;
    });
  }
}

function sevRank(s: IssueSeverity) {
  return { critical: 0, high: 1, normal: 2, low: 3 }[s];
}

function blankTest(key: string): WebTest {
  return { key, result: null, note: '', evidence: '', by: null, at: null, issueId: null, correction: '' };
}

function testLabel(key: string) {
  return REVIEW_TESTS.find(([k]) => k === key)?.[1] ?? key;
}

function monthlyLabel(key: string) {
  return MONTHLY_ITEMS.find(([k]) => k === key)?.[1] ?? key;
}
