import type { AuditEntry } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { TableName } from "./types";
import type { User } from "./types";
import type { AuditBody } from "./store";
import type { Store } from "./store";
import type { HrItRequest } from "./hr-it-types";
import { addDays } from "./time";
import { dateOf } from "./time";
import { daysBetween } from "./time";
import { actRole } from "./access";
import { isCentralEmployer } from "./access";
import { isGroupLeader } from "./access";
import { visibleCompanyIds } from "./access";


// ---------- Who receives ----------

/** A receiving desk. Resolved to named people at the moment of the event, so the item has an owner from the start. */
export type OrgDesk =
  | 'hr'
  | 'it'
  | 'finance'
  | 'fwm'
  | 'procurement'
  | 'asset'
  | 'legal'
  | 'pdpa'
  | 'cms'
  | 'transport'
  | 'chief_of_staff'
  | 'director_office'
  | 'act'
  | 'company_office'
  | 'coo'
  | 'ceo';

export const ORG_DESK_LABEL: Record<OrgDesk, string> = {
  hr: 'HR',
  it: 'IT',
  finance: 'Finance',
  fwm: 'Foreign Worker Management',
  procurement: 'Procurement and Goodwill store',
  asset: 'Asset Management',
  legal: 'Legal',
  pdpa: 'PDPA officer',
  cms: 'CMS command centre',
  transport: 'Transport',
  chief_of_staff: 'Chief of Staff office',
  director_office: 'Director Office',
  act: 'ACT (Audit, Compliance and Transformation)',
  company_office: 'Company office (manager and admin executives)',
  coo: 'COO',
  ceo: 'CEO',
};

const DEPT_OF: Partial<Record<OrgDesk, NonNullable<User['department']>>> = {
  hr: 'hr',
  it: 'it',
  fwm: 'fwm',
  procurement: 'procurement',
  asset: 'asset',
  legal: 'legal',
  pdpa: 'pdpa',
  cms: 'cms',
  transport: 'transport',
  chief_of_staff: 'chief_of_staff',
  director_office: 'director_office',
  act: 'audit',
};

/**
 * The people of a desk who receive a hand-over. Only active staff accounts; never a system feed, a site device or a
 * closed account. Finance (Fauzan, 3 Nov 2026, G5): the leader and deputy of the team the Finance Director assigned to
 * that company (data entry staff get the work from their leader); when no team is recorded, or the team has nobody
 * yet, the Finance Director. Company office: that company's manager and admin executives only. FWM's despatch does not
 * open worker records, so does not receive them.
 */
export function deskPeople(
  desk: OrgDesk,
  users: User[],
  companyId: Id | null,
  today: IsoDate,
  financeTeam: number | null = null,
  runBy: Id | null = null,
): User[] {
  const active = users.filter(
    (u) => !u.integration && u.role !== 'site_device' && !(u.accessClosedFrom && u.accessClosedFrom <= today),
  );
  switch (desk) {
    case 'finance': {
      const team =
        financeTeam == null
          ? []
          : active.filter(
              (u) =>
                u.role === 'pwvsb_officer' &&
                u.department === 'finance' &&
                u.financeTeam === financeTeam &&
                (u.financeRole === 'leader' || u.financeRole === 'deputy'),
            );
      return team.length ? team : active.filter((u) => u.leadership === 'finance_director');
    }
    case 'company_office':
      // Also the office that runs this company (Company office #57, set by the Chief of Staff or CEO): its head and
      // admin executives without a branch, the same accounts the run link lets in (withRunCompanies).
      return companyId
        ? active.filter(
            (u) =>
              (u.role === 'company_manager' || u.role === 'admin_exec') &&
              (u.companyIds.includes(companyId) || (!!runBy && !u.branchId && u.companyIds.includes(runBy))),
          )
        : [];
    case 'coo':
      return active.filter((u) => u.opsTier === 'coo');
    case 'ceo':
      return active.filter((u) => u.opsTier === 'ceo');
    case 'chief_of_staff':
      return active.filter(
        (u) => u.leadership === 'cos' || u.leadership === 'deputy_cos' || (u.role === 'pwvsb_officer' && u.department === 'chief_of_staff'),
      );
    case 'fwm':
      return active.filter((u) => u.role === 'pwvsb_officer' && u.department === 'fwm' && u.fwmRole !== 'despatch');
    case 'procurement':
      return active.filter((u) => u.role === 'pwvsb_officer' && u.department === 'procurement' && u.procRole !== 'storekeeper');
    default: {
      const dept = DEPT_OF[desk];
      return dept ? active.filter((u) => u.role === 'pwvsb_officer' && u.department === dept) : [];
    }
  }
}

// ---------- The catalogue ----------

/**
 * Where a flow stands today:
 *  - live: the source action is on main; the hand-over runs as soon as the layer is switched on.
 *  - in_pr: the source action is in an open department PR; the line wakes up when that PR merges.
 *  - direct: the receiving screen already reads the keyed record directly (no re-keying); the layer adds the notice.
 *  - waits: needs an outside system first (JA app API, SQL Account link, bank feed).
 */
export type OrgFlowStatus = 'live' | 'in_pr' | 'direct' | 'waits';

export interface OrgFlowTarget {
  desk: OrgDesk;
  /** to-do: the desk must do something and close it with a note. info: for their awareness, closes when read. */
  kind: 'todo' | 'info';
  /** What the desk is asked to do. Plain words, no personal or money details. */
  task: string;
  /** Working days are not modelled; calendar days from the event. Only for a to-do. */
  dueDays?: number;
  /**
   * The person who keyed the record is on this desk's list too. Normally the keyer is never told about their own work;
   * a line with this flag is the keyer's own next step (HR opening the HR/IT joining request after keying a joiner).
   */
  toKeyer?: boolean;
  /**
   * For the company office: which office desk should get it once the Company office module merges
   * (PrimaService.officeDeskHolders, "Build each company's own office" thread). Until then the manager and admin
   * executives receive it.
   */
  officeDesk?: 'people' | 'clients' | 'tenders' | 'licences' | 'cases' | 'office';
}

export interface OrgFlow {
  id: string;
  /** In business words, for the map screen. */
  name: string;
  /** The desk that keys the record once. */
  keyedBy: OrgDesk;
  /** What is keyed. */
  record: string;
  /** Audit actions that start the flow: exact, or a prefix ending in '.'. */
  actions: string[];
  targets: OrgFlowTarget[];
  status: OrgFlowStatus;
  /** Where it is built or what it waits for. */
  note: string;
  /** Optional filter on the keyed record (read inside the same transaction). */
  when?: { table: TableName; test: (row: Record<string, unknown>) => boolean };
}

/**
 * Actions never routed by this layer, whatever a flow says: confidential lines with their own walls and handlers.
 * Matching is by prefix.
 */
export const NEVER_ROUTED: readonly string[] = Object.freeze([
  'grc.whistle',
  'arms.',
  'hr.case_',
  'pdpa.',
  'staff.face_',
  'person.pin',
  'user.access.review',
  'it.access.',
  'confidentiality.',
  'file.open',
]);

export const ORG_FLOWS: readonly OrgFlow[] = Object.freeze([
  {
    id: 'staff_join',
    name: 'New office staff joins',
    keyedBy: 'hr',
    record: 'Office staff record (HR form)',
    actions: ['record.add.officeStaff'],
    targets: [
      { desk: 'hr', kind: 'todo', task: 'Open the HR/IT joining request for this person, so IT can prepare the account and device.', dueDays: 1, toKeyer: true },
      { desk: 'it', kind: 'todo', task: 'Prepare the Microsoft account, device and Prima access through the joining intake.', dueDays: 3 },
      { desk: 'finance', kind: 'todo', task: 'Add the new staff to the staff payroll; the salary account is verified separately.', dueDays: 7 },
      { desk: 'chief_of_staff', kind: 'todo', task: 'Check the new staff is added to the group medical and insurance cover.', dueDays: 7 },
      { desk: 'company_office', kind: 'info', task: 'A new staff member is joining your company.' , officeDesk: 'people' },
    ],
    status: 'live',
    note: 'HR keys the staff once on the record form. IT works from the HR/IT joining request (hr-it-intake) for that person; the hand-over is done only once IT has recorded the Microsoft identity there, and not needed only when HR cancels it.',
  },
  {
    id: 'staff_leave',
    name: 'Staff leaves: access closed',
    keyedBy: 'hr',
    record: 'Leaving date on the staff record',
    actions: ['user.access.close'],
    targets: [
      { desk: 'it', kind: 'todo', task: 'Disable the Microsoft account and collect devices and access cards.', dueDays: 1 },
      { desk: 'finance', kind: 'todo', task: 'Prepare the final pay and stop the salary from the leaving date.', dueDays: 7 },
      { desk: 'procurement', kind: 'info', task: 'Collect any uniform or equipment issued to the leaver.' },
    ],
    status: 'live',
    note: 'Prima closes the account itself on the day; these are the steps outside Prima.',
  },
  {
    id: 'pay_change',
    name: 'Basic pay change',
    keyedBy: 'hr',
    record: 'Pay change request',
    actions: ['pay.change.request'],
    targets: [{ desk: 'finance', kind: 'info', task: 'A pay change is waiting for approval; it reaches payroll once approved.' }],
    status: 'live',
    note: 'Approval stays CoS then COO with VC consent (HR #51). No amount is shown in the hand-over.',
  },
  {
    id: 'bank_change',
    name: 'Salary account change',
    keyedBy: 'hr',
    record: 'Salary account change',
    actions: ['pay.bank.request'],
    targets: [{ desk: 'finance', kind: 'todo', task: 'Verify the new salary account with the staff before the next pay run.', dueDays: 3 }],
    status: 'live',
    note: 'The masked account is on the request; Finance verifies it by call-back (payee checks in Finance #49).',
  },
  {
    id: 'staff_claim',
    name: 'Staff claim submitted',
    keyedBy: 'hr',
    record: 'Medical, optical or travel claim',
    actions: ['claims.submit'],
    targets: [{ desk: 'finance', kind: 'info', task: 'A staff claim is on its way; it joins the payment list once approved.' }],
    status: 'live',
    note: 'Receipt wallet and payment list are in Finance #49.',
  },
  {
    id: 'expense',
    name: 'Expense submitted',
    keyedBy: 'company_office',
    record: 'Expense request',
    actions: ['expense.submit'],
    targets: [{ desk: 'finance', kind: 'info', task: 'An expense is on its way; it joins the payment list once approved.' }],
    status: 'live',
    note: '',
  },
  {
    id: 'purchase',
    name: 'Purchase raised',
    keyedBy: 'procurement',
    record: 'Purchase request with quotes',
    actions: ['pur.request', 'it.purchase'],
    targets: [{ desk: 'finance', kind: 'info', task: 'A purchase is being approved; expect the supplier invoice and payment.' }],
    status: 'live',
    note: 'Three quotes and COO/CEO approval stay inside Procurement and IT.',
  },
  {
    id: 'store_issue',
    name: 'Goodwill store issues equipment to a guard',
    keyedBy: 'procurement',
    record: 'Stock issue (rental or sale, bill-to company)',
    actions: ['store.issue'],
    targets: [
      { desk: 'finance', kind: 'info', task: 'A Goodwill billing line was added for this company (rental or sale).' },
      { desk: 'company_office', kind: 'info', task: 'Equipment was issued to one of your guards; it will be billed by Goodwill.' , officeDesk: 'people' },
    ],
    status: 'live',
    note: 'The billing draft itself is Gov Ops #54.',
  },
  {
    id: 'store_dispute',
    name: 'Guard disputes an equipment hand-over',
    keyedBy: 'company_office',
    record: 'Signed receipt disputed',
    actions: ['store.handover.disputed'],
    targets: [
      { desk: 'procurement', kind: 'todo', task: 'Resolve the disputed hand-over with the OM and the guard.', dueDays: 3 },
      { desk: 'act', kind: 'info', task: 'An equipment hand-over was disputed.' },
    ],
    status: 'in_pr',
    note: 'Gov Ops #54.',
  },
  {
    id: 'it_rental_bill',
    name: 'Merdeka bills device rental',
    keyedBy: 'it',
    record: 'IT rental bill',
    actions: ['it.rental.bill'],
    targets: [
      { desk: 'finance', kind: 'todo', task: 'Record the Merdeka rental invoice in SQL Account for this company.', dueDays: 7 },
      { desk: 'company_office', kind: 'info', task: 'Merdeka sent this month’s device rental bill.' , officeDesk: 'office' },
    ],
    status: 'live',
    note: 'Payment is recorded by Finance on the same bill (IT pilot).',
  },
  {
    id: 'hostel_bill',
    name: 'Hostel bill received',
    keyedBy: 'fwm',
    record: 'Hostel bill',
    actions: ['hostel.bill'],
    targets: [{ desk: 'finance', kind: 'todo', task: 'Pay the hostel bill by its due date and record the payment once.', dueDays: 7 }],
    status: 'live',
    note: '',
  },
  {
    id: 'hostel_paid',
    name: 'Hostel bill paid',
    keyedBy: 'finance',
    record: 'Hostel payment (account, day, reference)',
    actions: ['finance.hostel.paid', 'hostel.paid'],
    targets: [{ desk: 'fwm', kind: 'info', task: 'The hostel bill is paid; the record is on the bill.' }],
    status: 'direct',
    note: 'Finance #49 already shows the payment on FWM’s hostel screen; this adds the notice.',
  },
  {
    id: 'fw_renewal',
    name: 'Foreign worker permit renewal submitted',
    keyedBy: 'fwm',
    record: 'PLKS / passport / FOMEMA renewal',
    actions: ['fwm.renewal'],
    targets: [
      { desk: 'finance', kind: 'todo', task: 'Prepare payment of the levy and renewal fees for this renewal.', dueDays: 5 },
      { desk: 'company_office', kind: 'info', task: 'A permit renewal was submitted for one of your workers.' , officeDesk: 'people' },
    ],
    status: 'live',
    note: '',
  },
  {
    id: 'socso',
    name: 'SOCSO claim started',
    keyedBy: 'hr',
    record: 'SOCSO claim',
    actions: ['socso.start'],
    targets: [
      { desk: 'finance', kind: 'info', task: 'A SOCSO claim may change sick pay (EA s.60F(4)); hold the affected days until settled.' },
      { desk: 'company_office', kind: 'info', task: 'A SOCSO claim was started for one of your staff.' , officeDesk: 'people' },
    ],
    status: 'live',
    note: '',
  },
  {
    id: 'case_serious',
    name: 'Serious site case raised',
    keyedBy: 'company_office',
    record: 'Case (incident) report',
    actions: ['case.raise'],
    targets: [
      { desk: 'cms', kind: 'info', task: 'A serious case was raised at a site; watch it until closed.' },
      { desk: 'chief_of_staff', kind: 'todo', task: 'Check whether an insurance claim or notice to the insurer is needed.', dueDays: 3 },
      { desk: 'coo', kind: 'info', task: 'A serious case was raised at a site.' },
    ],
    status: 'live',
    note: 'Only P1 and P2 cases (the two most urgent of the guidebook severities). Escalation inside operations is unchanged.',
    when: { table: 'cases', test: (r) => r.severity === 'P1' || r.severity === 'P2' },
  },
  {
    id: 'osh_high',
    name: 'Site risk assessment with high risks',
    keyedBy: 'company_office',
    record: 'OSH risk assessment',
    actions: ['grc.osh'],
    targets: [{ desk: 'hr', kind: 'todo', task: 'The OSH coordinator reviews the high risks and the controls.', dueDays: 7 }],
    status: 'live',
    note: '',
  },
  {
    id: 'client_add',
    name: 'New client',
    keyedBy: 'company_office',
    record: 'Client account and sites',
    actions: ['client.add'],
    targets: [
      { desk: 'finance', kind: 'todo', task: 'Open the customer in SQL Account with the e-Invoice details.', dueDays: 5 },
      { desk: 'cms', kind: 'info', task: 'A new client and its sites are coming on; prepare monitoring.' },
    ],
    status: 'live',
    note: '',
  },
  {
    id: 'client_offboard',
    name: 'Client leaves',
    keyedBy: 'company_office',
    record: 'Client offboarding',
    actions: ['client.offboard'],
    targets: [
      { desk: 'finance', kind: 'todo', task: 'Final invoice, deposit refund and guarantee release for this client.', dueDays: 14 },
      { desk: 'procurement', kind: 'todo', task: 'Collect Goodwill equipment from the client’s sites.', dueDays: 14 },
      { desk: 'it', kind: 'todo', task: 'Collect site devices and close site system accounts.', dueDays: 14 },
      { desk: 'cms', kind: 'info', task: 'Stop monitoring the client’s sites on the last day.' },
    ],
    status: 'live',
    note: '',
  },
  {
    id: 'contract_add',
    name: 'Contract signed, mobilisation opened',
    keyedBy: 'company_office',
    record: 'Contract',
    actions: ['contract.add'],
    targets: [
      { desk: 'finance', kind: 'todo', task: 'Set up the billing schedule from the contract.', dueDays: 7 },
      { desk: 'chief_of_staff', kind: 'todo', task: 'Check insurance and the performance guarantee cover the contract.', dueDays: 7 },
      { desk: 'procurement', kind: 'todo', task: 'Prepare equipment for the new site’s guards.', dueDays: 7 },
      { desk: 'hr', kind: 'info', task: 'A new contract needs manpower; see the mobilisation plan.' },
      { desk: 'cms', kind: 'info', task: 'A new site will need monitoring from its start date.' },
    ],
    status: 'live',
    note: 'The W15 stop (an expired licence blocks a new contract) is Central Admin 5C, not built yet.',
  },
  {
    id: 'contract_change',
    name: 'Contract changed',
    keyedBy: 'company_office',
    record: 'Contract variation',
    actions: ['contract.update'],
    targets: [{ desk: 'finance', kind: 'info', task: 'A contract changed; check the billing schedule.' }],
    status: 'live',
    note: '',
  },
  {
    id: 'client_invoice',
    name: 'Invoice sent to a client',
    keyedBy: 'company_office',
    record: 'Client invoice sent',
    actions: ['client.invoice', 'finance.billing.invoice'],
    targets: [{ desk: 'finance', kind: 'info', task: 'An invoice went out; expect the receipt in the bank statement.' }],
    status: 'live',
    note: 'Receipts are matched on the bank statement in Finance #49.',
  },
  {
    id: 'credit_loan',
    name: 'PWVSB lends to a company',
    keyedBy: 'finance',
    record: 'Credit loan',
    actions: ['credit.loan'],
    targets: [
      { desk: 'legal', kind: 'todo', task: 'Prepare the loan agreement and stamping.', dueDays: 7 },
      { desk: 'company_office', kind: 'info', task: 'A PWVSB loan to your company was recorded.' , officeDesk: 'office' },
    ],
    status: 'live',
    note: 'Enforcement stays off until counsel validates (V10).',
  },
  {
    id: 'legal_matter',
    name: 'Legal matter opened',
    keyedBy: 'legal',
    record: 'Legal matter',
    actions: ['legal.matter'],
    targets: [
      { desk: 'company_office', kind: 'info', task: 'A legal matter was opened for your company.' , officeDesk: 'licences' },
      { desk: 'finance', kind: 'info', task: 'A legal matter was opened; consider a provision.' },
    ],
    status: 'live',
    note: '',
  },
  {
    id: 'asset_disposal',
    name: 'Asset disposed',
    keyedBy: 'asset',
    record: 'Asset disposal',
    actions: ['asset.disposal.'],
    targets: [{ desk: 'finance', kind: 'todo', task: 'Post the disposal in SQL Account.', dueDays: 7 }],
    status: 'live',
    note: 'ACT already watches unposted disposals.',
  },
  {
    id: 'branch_settlement',
    name: 'Branch settlement approved',
    keyedBy: 'company_office',
    record: 'Branch settlement',
    actions: ['branch.settlement'],
    targets: [{ desk: 'finance', kind: 'todo', task: 'Pay the branch manager’s share as approved.', dueDays: 7 }],
    status: 'live',
    note: '',
  },
  {
    id: 'ar_writeoff',
    name: 'Bad debt written off',
    keyedBy: 'finance',
    record: 'Receivable write-off',
    actions: ['finance.ar.writeoff'],
    targets: [
      { desk: 'act', kind: 'info', task: 'A receivable was written off.' },
      { desk: 'company_office', kind: 'info', task: 'A client debt of your company was written off.' , officeDesk: 'clients' },
    ],
    status: 'in_pr',
    note: 'Finance #49.',
  },
  {
    id: 'payee_changed',
    name: 'Supplier or payee bank details changed',
    keyedBy: 'finance',
    record: 'Payee change',
    actions: ['finance.payee.changed'],
    targets: [{ desk: 'act', kind: 'info', task: 'Payee bank details changed (fraud watch).' }],
    status: 'in_pr',
    note: 'Finance #49.',
  },
  {
    id: 'guarantee_called',
    name: 'Bank guarantee called or claimed',
    keyedBy: 'finance',
    record: 'Guarantee',
    actions: ['finance.guarantee.called', 'finance.guarantee.claimed'],
    targets: [
      { desk: 'legal', kind: 'todo', task: 'Review the guarantee call and the contract position.', dueDays: 3 },
      { desk: 'company_office', kind: 'info', task: 'A guarantee of your company was called or claimed.' , officeDesk: 'licences' },
    ],
    status: 'in_pr',
    note: 'Finance #49.',
  },
  {
    id: 'osh_incident',
    name: 'Office OSH incident',
    keyedBy: 'hr',
    record: 'OSH incident',
    actions: ['hr.osh_incident'],
    targets: [{ desk: 'chief_of_staff', kind: 'todo', task: 'Check whether an insurance claim is needed.', dueDays: 3 }],
    status: 'in_pr',
    note: 'HR #51.',
  },
  {
    id: 'licence_renewal_fee',
    name: 'Licence renewal fee to pay',
    keyedBy: 'company_office',
    record: 'Licence renewal case (KDN, majlis, vendor panel, ISO, fire)',
    actions: ['renewal.fee'],
    targets: [{ desk: 'finance', kind: 'todo', task: 'Pay the renewal fee so the submission is not held up.', dueDays: 3 }],
    status: 'in_pr',
    note: 'Central Admin #52 (5C). A lapsed licence already blocks a new contract there (W15).',
  },
  {
    id: 'licence_renewed',
    name: 'Licence renewed',
    keyedBy: 'company_office',
    record: 'Licence renewal case',
    actions: ['renewal.renewed'],
    targets: [
      { desk: 'legal', kind: 'info', task: 'A licence was renewed; update tender and contract papers that quote it.' },
      { desk: 'company_office', kind: 'info', task: 'Your licence was renewed; use the new copy in tenders.', officeDesk: 'licences' },
    ],
    status: 'in_pr',
    note: 'Central Admin #52 (5C).',
  },
  {
    id: 'ja_feeds',
    name: 'Guard attendance, patrol and pay from the JA app',
    keyedBy: 'company_office',
    record: 'JA app records',
    actions: [],
    targets: [
      { desk: 'cms', kind: 'info', task: 'No-shows and SOS alerts within 1 minute.' },
      { desk: 'finance', kind: 'info', task: 'Guard pay summary per company for payment and SQL Account.' },
    ],
    status: 'waits',
    note: 'Waits for the JA app API (request documents sent 2 Nov 2026).',
  },
  {
    id: 'sql_account',
    name: 'SQL Account postings read back',
    keyedBy: 'finance',
    record: 'SQL Account ledger',
    actions: [],
    targets: [{ desk: 'act', kind: 'info', task: 'Postings missing in SQL Account show as ACT signals.' }],
    status: 'waits',
    note: 'Waits for a read-only SQL Account link; staff paste the export today.',
  },
] satisfies OrgFlow[]);

export function neverRouted(action: string): boolean {
  return NEVER_ROUTED.some((p) => action === p || (p.endsWith('.') || p.endsWith('_') ? action.startsWith(p) : false));
}

/** Flows started by an audit action. A confidential action starts none. */
/**
 * Where each hand-over's record is kept: the screen to open, and for cases and people the record itself.
 * Opening is a link only. The screen it opens checks its own permissions on the server as it always does; this map
 * never grants anything (Arisha review of PR #56, 2 Nov 2026).
 */
export const ORG_FLOW_OPENS: Readonly<Record<string, { view: string; screen: string; route?: 'caseId' | 'personId' }>> = Object.freeze({
  staff_join: { view: 'people', screen: 'People', route: 'personId' },
  staff_leave: { view: 'people', screen: 'People' },
  pay_change: { view: 'staffpay', screen: 'Staff pay' },
  bank_change: { view: 'staffpay', screen: 'Staff pay' },
  staff_claim: { view: 'claims', screen: 'Claims' },
  expense: { view: 'finance', screen: 'Finance' },
  purchase: { view: 'purchasing', screen: 'Purchasing' },
  store_issue: { view: 'purchasing', screen: 'Purchasing' },
  store_dispute: { view: 'purchasing', screen: 'Purchasing' },
  it_rental_bill: { view: 'it', screen: 'IT' },
  hostel_bill: { view: 'hostels', screen: 'Hostels' },
  hostel_paid: { view: 'hostels', screen: 'Hostels' },
  fw_renewal: { view: 'fwm', screen: 'Foreign workers' },
  socso: { view: 'socso', screen: 'SOCSO' },
  case_serious: { view: 'cases', screen: 'Cases', route: 'caseId' },
  osh_high: { view: 'grc', screen: 'Governance and risk' },
  client_add: { view: 'clients', screen: 'Clients' },
  client_offboard: { view: 'clients', screen: 'Clients' },
  contract_add: { view: 'contracts', screen: 'Contracts' },
  contract_change: { view: 'contracts', screen: 'Contracts' },
  client_invoice: { view: 'finance', screen: 'Finance' },
  credit_loan: { view: 'credit', screen: 'Credit' },
  legal_matter: { view: 'corporate', screen: 'Corporate' },
  asset_disposal: { view: 'assets', screen: 'Assets' },
  branch_settlement: { view: 'branches', screen: 'Branches' },
  ar_writeoff: { view: 'finance', screen: 'Finance' },
  payee_changed: { view: 'finance', screen: 'Finance' },
  guarantee_called: { view: 'insurance', screen: 'Insurance' },
  osh_incident: { view: 'hr', screen: 'HR' },
  licence_renewal_fee: { view: 'compliance', screen: 'Licences' },
  licence_renewed: { view: 'compliance', screen: 'Licences' },
});

/**
 * The link a receiver gets for a hand-over, or why there is none. Pure: company sight is passed in.
 * exact: the screen opens that very record (cases and people). Otherwise the screen opens at its list and `find`
 * names the record to look for; the link never claims to land on a record it cannot select.
 */
export type OrgOpen =
  | { view: string; screen: string; exact: true; caseId?: Id; personId?: Id }
  | { view: string; screen: string; exact: false; find: string }
  | { refused: string };

export function openFor(task: Pick<OrgTask, 'flowId' | 'companyId' | 'entity' | 'entityId'>, user: User, seesCompany: (companyId: Id) => boolean): OrgOpen {
  const o = ORG_FLOW_OPENS[task.flowId];
  if (!o) return { refused: 'This record has no screen to open yet.' };
  if (user.integration) return { refused: 'A system feed opens nothing.' };
  if (task.companyId && !seesCompany(task.companyId)) return { refused: `Kept on ${o.screen} of a company you do not have access to. Ask its office.` };
  if (o.route) return { view: o.view, screen: o.screen, exact: true, [o.route]: task.entityId };
  return { view: o.view, screen: o.screen, exact: false, find: `${task.entity} ${task.entityId}` };
}

/**
 * IT's joining hand-over is bound to the HR/IT joining request (hr-it-intake) for that person in that company, the same
 * rule as prima.org_joining_state in db/modules/org-links-v1.sql:
 *  ready      a submitted onboarding request carries the Microsoft identity IT recorded (done is allowed);
 *  waiting    HR opened one, IT's record is not on it yet;
 *  cancelled  every such request was cancelled by HR (not needed is allowed);
 *  missing    HR has not opened one.
 * People access is not widened: IT works from the HR/IT joining screen it already has.
 */
export type JoiningState = 'ready' | 'waiting' | 'cancelled' | 'missing';
export function joiningState(requests: readonly HrItRequest[], companyId: Id | null, personId: Id): { state: JoiningState; requestId: Id | null } {
  const mine = requests.filter((r) => r.workflow === 'onboard' && r.companyId === companyId && r.subject.kind === 'hr_person' && r.subject.id === personId);
  const ready = mine.find((r) => r.status === 'submitted' && !!r.technical?.oid && !!r.technical?.recordedById);
  if (ready) return { state: 'ready', requestId: ready.id };
  const open = mine.find((r) => r.status !== 'cancelled');
  if (open) return { state: 'waiting', requestId: open.id };
  return mine.length ? { state: 'cancelled', requestId: mine[0].id } : { state: 'missing', requestId: null };
}
/** Hand-overs per inbox page. */
export const INBOX_PAGE = 100;
export const boundToJoining = (t: Pick<OrgTask, 'flowId' | 'desk'>) => t.flowId === 'staff_join' && (t.desk === 'it' || t.desk === 'hr');
/**
 * Which joining states let each desk close its joining hand-over (same rule as org_task_guard):
 * IT done once its identity record is on the request, HR done once the request is open; not needed only when cancelled.
 */
export function joiningAllows(desk: OrgDesk, outcome: 'done' | 'not_needed', state: JoiningState): boolean {
  if (outcome === 'not_needed') return state === 'cancelled';
  return desk === 'it' ? state === 'ready' : state === 'ready' || state === 'waiting';
}
/** What HR's own joining to-do says for each state. */
export const JOINING_SAY_HR: Record<JoiningState, string> = {
  ready: 'The HR/IT joining request is open and IT has recorded the account. You can mark this done.',
  waiting: 'The HR/IT joining request is open. You can mark this done.',
  cancelled: 'You cancelled the joining request. You can mark this not needed.',
  missing: 'Open the HR/IT joining request for this person first; this closes from it.',
};
export const JOINING_SAY: Record<JoiningState, string> = {
  ready:
    'Identity prepared: your Microsoft identity record is on the HR/IT joining request. That request does not create or check the account, licence or device; mark this done only once you have finished those yourself.',
  waiting: 'The HR/IT joining request is open. Record the Microsoft identity there first; this closes from it.',
  cancelled: 'HR cancelled the joining request. You can mark this not needed.',
  missing: 'HR has not opened the HR/IT joining request for this person yet. This stays open until they do.',
};

export function flowsFor(action: string): OrgFlow[] {
  if (neverRouted(action)) return [];
  return ORG_FLOWS.filter((f) => f.actions.some((a) => (a.endsWith('.') ? action.startsWith(a) : action === a)));
}

// ---------- Records ----------

export interface OrgEvent {
  id: Id;
  /** The audit entry this came from; one event per audit entry and flow, so a replay writes nothing twice. */
  auditSeq: number;
  at: IsoDateTime;
  flowId: string;
  action: string;
  companyId: Id | null;
  entity: string;
  entityId: Id;
  /** Who keyed it (name, as in the audit log). */
  by: string;
}

export interface OrgTask {
  id: Id;
  eventId: Id;
  flowId: string;
  at: IsoDateTime;
  companyId: Id | null;
  /** The keyed record; the receiver opens it instead of typing it again. */
  entity: string;
  entityId: Id;
  desk: OrgDesk;
  /** The named people who receive it (resolved at the event). Database rows are visible to them, ACT and leadership. */
  userIds: Id[];
  kind: 'todo' | 'info';
  title: string;
  task: string;
  from: string;
  dueOn: IsoDate | null;
  status: 'open' | 'done' | 'not_needed';
  closed: { byId: Id; by: string; at: IsoDateTime; note: string } | null;
  /** When nobody in the desk could be named (no account yet): shown to ACT and leadership as unassigned. */
  unassigned: boolean;
}

export interface OrgNotice {
  id: Id;
  userId: Id;
  taskId: Id;
  at: IsoDateTime;
  /** In-app only. Email, Teams, SMS and push stay unconfigured until separately verified (CLAUDE.md). */
  channel: 'in_app';
  readAt: IsoDateTime | null;
}

/** What one audit entry produces. Pure: the same entry and the same staff list give the same rows. */
export function fanOut(
  entry: AuditEntry,
  users: User[],
  row: Record<string, unknown> | null,
  financeTeam: number | null = null,
  runBy: Id | null = null,
): { events: OrgEvent[]; tasks: OrgTask[]; notices: OrgNotice[] } {
  const events: OrgEvent[] = [];
  const tasks: OrgTask[] = [];
  const notices: OrgNotice[] = [];
  const today = dateOf(entry.at);
  for (const flow of flowsFor(entry.action)) {
    if (flow.when && !(row && flow.when.test(row))) continue;
    const event: OrgEvent = {
      id: `oe-${entry.seq}-${flow.id}`,
      auditSeq: entry.seq,
      at: entry.at,
      flowId: flow.id,
      action: entry.action,
      companyId: entry.companyId,
      entity: entry.entity,
      entityId: entry.entityId,
      by: entry.actor,
    };
    events.push(event);
    for (const t of flow.targets) {
      // The person who keyed it is not told about their own work.
      const people = deskPeople(t.desk, users, entry.companyId, today, financeTeam, runBy).filter((u) => t.toKeyer || u.name !== entry.actor);
      // A central employer (PWVSB, Merdeka) has no company office: nothing to tell, nothing to flag. A security company
      // whose office has nobody on the desk today still gets the line, marked unassigned, so it is never dropped.
      if (t.desk === 'company_office' && (!entry.companyId || isCentralEmployer(entry.companyId))) continue;
      const task: OrgTask = {
        id: `ot-${entry.seq}-${flow.id}-${t.desk}`,
        eventId: event.id,
        flowId: flow.id,
        at: entry.at,
        companyId: entry.companyId,
        entity: entry.entity,
        entityId: entry.entityId,
        desk: t.desk,
        userIds: people.map((u) => u.id),
        kind: t.kind,
        title: flow.name,
        task: t.task,
        from: `${ORG_DESK_LABEL[flow.keyedBy]} (${entry.actor})`,
        dueOn: t.kind === 'todo' && t.dueDays ? addDays(today, t.dueDays) : null,
        status: 'open',
        closed: null,
        unassigned: people.length === 0,
      };
      tasks.push(task);
      for (const u of people) notices.push({ id: `on-${task.id}-${u.id}`, userId: u.id, taskId: task.id, at: entry.at, channel: 'in_app', readAt: null });
    }
  }
  return { events, tasks, notices };
}

// ---------- Hooking the audit log ----------

const ORG = Symbol.for('prima.orgLinks');

interface OrgState {
  muted: number;
}

/** Entity name in the audit log to the table holding it, for flows with a `when` filter. */
function tableOfFlow(entry: AuditEntry): TableName | null {
  for (const f of flowsFor(entry.action)) if (f.when) return f.when.table;
  return null;
}

/**
 * Wrap a store so every audit entry that starts a flow also writes its hand-overs, in the same transaction (both or
 * neither). The store passed into transaction() is the wrapper too, so writes inside units are covered.
 */
export function withOrgLinks<S extends Store>(store: S): S {
  if ((store as unknown as Record<symbol, unknown>)[ORG]) return store;
  const state: OrgState = { muted: 0 };
  const proxy: S = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === ORG) return state;
      if (prop === 'audit') {
        return async (body: AuditBody) => {
          const entry = await target.audit.call(proxy, body);
          if (state.muted === 0 && flowsFor(entry.action).length) await writeHandOvers(target, entry);
          return entry;
        };
      }
      const v = Reflect.get(target, prop, receiver);
      // Methods run with `this` = the wrapper, so transaction(fn) hands the wrapper to fn.
      return typeof v === 'function' ? v.bind(proxy) : v;
    },
  });
  return proxy;
}

/** A run link as Company office (#57) keeps it: which company's office runs this company (null: its own). */
export interface OrgRunLink {
  companyId: Id;
  runByCompanyId: Id | null;
}

/** The office running a company: set, not itself, and not itself run by another (the same rule as #57's runByCompanyId). */
export function orgRunByOf(links: OrgRunLink[], companyId: Id): Id | null {
  const parent = links.find((x) => x.companyId === companyId)?.runByCompanyId ?? null;
  if (!parent || parent === companyId) return null;
  if (links.some((x) => x.companyId === parent && x.runByCompanyId)) return null;
  return parent;
}

async function writeHandOvers(store: Store, entry: AuditEntry) {
  const users = await store.list('users', {});
  const table = tableOfFlow(entry);
  const row = table ? ((await store.get(table, entry.entityId)) as unknown as Record<string, unknown> | undefined) ?? null : null;
  // Which Finance team keeps this company's books (set by the Finance Director). Unreadable or unset: the FD.
  const needsTeam = !!entry.companyId && flowsFor(entry.action).some((f) => f.targets.some((t) => t.desk === 'finance'));
  // On PostgreSQL the team is read by prima.org_finance_team, the same function the database check uses, so a person
  // who cannot see the company's Finance status still writes the receivers the check expects.
  let team: number | null = null;
  if (needsTeam) {
    if (store.orgFinanceTeam) team = await store.orgFinanceTeam(entry.companyId!);
    else {
      const fin = await store.get('finStatus', `fin-${entry.companyId}`);
      team = fin && Number.isInteger(fin.team) ? fin.team : null;
    }
  }
  // Which company's office runs this one, when a run link is set (Company office #57). On PostgreSQL it is read by
  // prima.org_run_by, the function the database check uses; elsewhere from the run links, when that store keeps them.
  const needsOffice = !!entry.companyId && flowsFor(entry.action).some((f) => f.targets.some((t) => t.desk === 'company_office'));
  let runBy: Id | null = null;
  if (needsOffice) {
    if (store.orgRunBy) runBy = await store.orgRunBy(entry.companyId!);
    else {
      let links: OrgRunLink[] = [];
      try {
        links = (await (store.list as unknown as (t: string) => Promise<OrgRunLink[]>)('companyRunLinks')) ?? [];
      } catch {
        links = []; // this store keeps no run links (the Company office module is not part of it)
      }
      runBy = orgRunByOf(links, entry.companyId!);
    }
  }
  const out = fanOut(entry, users, row, team, runBy);
  for (const e of out.events) if (!(await store.get('orgEvents', e.id))) await store.insert('orgEvents', e);
  for (const t of out.tasks) if (!(await store.get('orgTasks', t.id))) await store.insert('orgTasks', t);
  for (const n of out.notices) if (!(await store.get('orgNotices', n.id))) await store.insert('orgNotices', n);
}

/** Whether a store has the layer on. */
export function orgLinksOn(store: Store): boolean {
  return !!(store as unknown as Record<symbol, unknown>)[ORG];
}

/**
 * Run work without hand-overs: a bulk import of existing records (staff already working, clients already served) must
 * not send hundreds of "new joiner" to-dos. The import is still audited, entry by entry.
 */
export async function withoutHandOvers<R>(store: Store, fn: () => Promise<R>): Promise<R> {
  const state = (store as unknown as Record<symbol, OrgState | undefined>)[ORG];
  if (!state) return fn();
  state.muted++;
  try {
    return await fn();
  } finally {
    state.muted--;
  }
}

/** The environment switch. Off by default so a deploy without the database module behaves exactly as before. */
export function orgLinksEnabled(env: Record<string, string | undefined>): boolean {
  return env.PRIMA_ORG_LINKS === 'true';
}

// ---------- Reading and closing hand-overs ----------

export class OrgLinkError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404,
  ) {
    super(message);
    this.name = 'OrgLinkError';
  }
}

/** ACT and group leadership oversee every hand-over; everyone else sees what is addressed to them. */
export function overseesHandOvers(user: User): boolean {
  return !user.integration && (actRole(user) !== null || isGroupLeader(user));
}

export function taskState(t: OrgTask, today: IsoDate) {
  const overdueDays = t.status === 'open' && t.dueOn ? Math.max(0, daysBetween(t.dueOn, today)) : 0;
  const tone: 'crit' | 'warn' | 'info' | 'ok' =
    t.status !== 'open' ? 'ok' : overdueDays > 0 ? 'crit' : t.kind === 'todo' ? 'warn' : 'info';
  return { overdueDays, tone };
}

export class OrgLinkService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
  ) {}

  private today() {
    return dateOf(this.now());
  }

  /** My hand-overs: open first, overdue first; plus my unread count. */
  /**
   * My hand-overs, one page at a time (INBOX_PAGE). The counts are over every hand-over addressed to me, never only
   * the page, and nextOffset reaches the rest (review of d7d472d: 301 tasks showed and counted 300).
   */
  async inbox(user: User, page: { offset?: number } = {}) {
    if (user.integration) throw new OrgLinkError('A system feed has no inbox.', 403);
    // Switched off here: nothing is routed, so there is nothing to read, and the hand-over tables may not be installed
    // yet. Say so plainly instead of reading them (stress database, 3 Nov: the read failed as a configuration error).
    if (!orgLinksOn(this.store))
      return { items: [], total: 0, offset: 0, nextOffset: null, unread: 0, open: 0, overdue: 0, off: true as const, channels: { inApp: false, email: 'not connected', teams: 'not connected' } };
    const today = this.today();
    const [tasks, notices, grants, intake] = await Promise.all([
      this.store.list('orgTasks', {}),
      this.store.list('orgNotices', { userId: user.id }),
      this.store.list('grants'),
      this.store.list('hrItRequests', {}).catch(() => [] as HrItRequest[]),
    ]);
    const sees = new Set(visibleCompanyIds(user, grants, today));
    const mine = tasks
      .filter((t) => t.userIds.includes(user.id))
      .map((t) => ({
        task: t,
        ...taskState(t, today),
        unread: notices.some((n) => n.taskId === t.id && !n.readAt),
        open: openFor(t, user, (c) => sees.has(c)),
        joining: boundToJoining(t) ? { ...joiningState(intake, t.companyId, t.entityId), view: 'hr-it-intake' } : null,
      }))
      .sort(
        (a, b) =>
          Number(a.task.status !== 'open') - Number(b.task.status !== 'open') ||
          b.overdueDays - a.overdueDays ||
          (a.task.dueOn ?? '9999').localeCompare(b.task.dueOn ?? '9999') ||
          b.task.at.localeCompare(a.task.at),
      );
    const offset = Math.max(0, Math.floor(Number(page.offset ?? 0)) || 0);
    const items = mine.slice(offset, offset + INBOX_PAGE);
    return {
      items,
      total: mine.length,
      offset,
      nextOffset: offset + items.length < mine.length ? offset + items.length : null,
      unread: notices.filter((n) => !n.readAt).length,
      open: mine.filter((r) => r.task.status === 'open').length,
      overdue: mine.filter((r) => r.overdueDays > 0).length,
      off: false as const,
      channels: { inApp: true, email: 'not connected', teams: 'not connected' },
    };
  }

  /** Close a hand-over addressed to me: done (a to-do needs a note) or not needed (always with a reason). */
  async close(user: User, taskId: Id, outcome: 'done' | 'not_needed', note: string) {
    const text = (note ?? '').trim().slice(0, 500);
    return this.store.transaction(async (tx) => {
      await tx.lock?.('orgTasks', taskId);
      const t = await tx.get('orgTasks', taskId);
      if (!t || !t.userIds.includes(user.id)) throw new OrgLinkError('Hand-over not found.', 404);
      if (t.status !== 'open') throw new OrgLinkError('This hand-over is already closed.', 400);
      if (outcome !== 'done' && outcome !== 'not_needed') throw new OrgLinkError('Choose done or not needed.', 400);
      if (boundToJoining(t)) {
        const j = joiningState(await tx.list('hrItRequests', {}), t.companyId, t.entityId).state;
        if (!joiningAllows(t.desk, outcome, j)) throw new OrgLinkError((t.desk === 'hr' ? JOINING_SAY_HR : JOINING_SAY)[j], 400);
      }
      if ((t.kind === 'todo' || outcome === 'not_needed') && text.length < 3)
        throw new OrgLinkError(outcome === 'done' ? 'Say what was done (a reference helps).' : 'Say why it is not needed.', 400);
      const at = this.now();
      await tx.update('orgTasks', t.id, { status: outcome, closed: { byId: user.id, by: user.name, at, note: text || 'Read' } });
      for (const n of await tx.list('orgNotices', { taskId: t.id, userId: user.id }))
        if (!n.readAt) await tx.update('orgNotices', n.id, { readAt: at });
      await tx.audit({
        at,
        actor: user.name,
        // A central desk may hold no grant on the company; the line names only the desk and the flow, never the record.
        companyId: null,
        action: 'org.handover.close',
        entity: 'org_task',
        entityId: t.id,
        summary: `${ORG_DESK_LABEL[t.desk]} hand-over "${t.title}" ${outcome === 'done' ? 'done' : 'not needed'}.`,
      });
      return (await tx.get('orgTasks', t.id))!;
    });
  }

  async markRead(user: User, taskId: Id) {
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const mine = await tx.list('orgNotices', { taskId, userId: user.id });
      for (const n of mine) if (!n.readAt) await tx.update('orgNotices', n.id, { readAt: at });
      return { read: mine.length };
    });
  }

  /**
   * The map of how departments connect, with live counts. Everyone signed in sees the map (it holds no records);
   * the counts and the late list are for ACT and group leadership.
   */
  async map(user: User) {
    if (user.integration) throw new OrgLinkError('A system feed has no map.', 403);
    const oversee = overseesHandOvers(user);
    const today = this.today();
    const on = orgLinksOn(this.store);
    const tasks = oversee && on ? await this.store.list('orgTasks', {}) : [];
    const flows = ORG_FLOWS.map((f) => {
      const mine = tasks.filter((t) => t.flowId === f.id);
      const open = mine.filter((t) => t.status === 'open');
      return {
        id: f.id,
        name: f.name,
        keyedBy: ORG_DESK_LABEL[f.keyedBy],
        record: f.record,
        status: f.status,
        note: f.note,
        targets: f.targets.map((t) => ({ desk: ORG_DESK_LABEL[t.desk], kind: t.kind, task: t.task, dueDays: t.dueDays ?? null })),
        counts: oversee
          ? { total: mine.length, open: open.length, overdue: open.filter((t) => taskState(t, today).overdueDays > 0).length }
          : null,
      };
    });
    const allLate = oversee
      ? tasks
          .filter((t) => t.status === 'open' && (taskState(t, today).overdueDays > 0 || t.unassigned))
          .map((t) => ({ task: t, ...taskState(t, today) }))
          .sort((a, b) => b.overdueDays - a.overdueDays)
      : [];
    // The list shows the 100 latest; lateTotal counts them all, and the per-flow counts above are never cut.
    return { oversee, off: !on, flows, late: allLate.slice(0, 100), lateTotal: allLate.length, neverRouted: [...NEVER_ROUTED] };
  }

  /**
   * Signals for ACT's monitor: hand-overs between departments that are late, and hand-overs with nobody to receive
   * them (a desk with no account yet). Same shape as the other ACT signals.
   */
  async actSignals() {
    const today = this.today();
    const tasks = (await this.store.list('orgTasks', {})).filter((t) => t.status === 'open');
    const late = tasks.filter((t) => taskState(t, today).overdueDays > 0).length;
    const nobody = tasks.filter((t) => t.unassigned).length;
    return [
      { key: 'handover_late', area: 'ORGANISATION', label: 'Hand-overs between departments past their due date', count: late, tone: late ? 'crit' : 'ok' },
      { key: 'handover_unassigned', area: 'ORGANISATION', label: 'Hand-overs with nobody in the receiving desk', count: nobody, tone: nobody ? 'warn' : 'ok' },
    ] as const;
  }
}