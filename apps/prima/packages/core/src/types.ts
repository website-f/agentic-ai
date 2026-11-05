import type {MetricStream,MetricReceipt,MetricTarget,MetricCalendar} from './it-workflow-metrics-types';
import type {ProcurementAuthority,ProcurementPacket,ProcurementReceipt} from './it-procurement-types';
import type {RentalCorrectionRequest,RentalCorrectionReview,RentalBillReplacement,RentalReplacementPayment,RentalCorrectionReceipt} from './rental-correction-types';
import type {HrItRequest,HrItApproval,HrItDelegation,HrItAuthorityMapping,HrItReceipt} from './hr-it-types';
// Domain types for Wave 1. Every record that belongs to a company carries companyId:
// records never span two companies (master plan, rule 2).

export type Id = string;
/** ISO date, YYYY-MM-DD */
export type IsoDate = string;
/** ISO timestamp with offset */
export type IsoDateTime = string;

export type BranchModel = 'A' | 'B' | 'C';
export type ShiftStructure = 'A' | 'B' | 'C' | 'D' | 'E';
export type Nationality = 'MY' | 'NP';
export type Severity = 'P1' | 'P2' | 'P3' | 'P4';

export interface Company {
  id: Id;
  code: string;
  name: string;
  isPilot: boolean;
  headOfCompany: string;
  state: string;
  /** Planned headline figures for companies we have no detailed mock data for. */
  guardCount: number;
  siteCount: number;
  /** Verified statutory company facts, initially absent on mock scaffolding. */
  ssmNo?: string;
  registeredOn?: IsoDate | null;
  registeredAddress?: string | null;
  businessAddress?: string | null;
  sourceRef?: string | null;
  verificationStatus?: 'draft' | 'verified';
  verifiedBy?: string | null;
  verifiedOn?: IsoDate | null;
  /** Who last saved the draft (Central Admin 5A part 3): the person who checks it against SSM is someone else. */
  draftById?: Id | null;
  draftBy?: string | null;
}

export interface Branch {
  id: Id;
  companyId: Id;
  name: string;
  model: BranchModel;
  state: string;
  /** The signed branch agreement, by version (V11, V12, V12.1). No version means no agreement on record. */
  agreements?: BranchAgreement[];
  /**
   * Masterplan 145: a branch added in Prima starts as proposed and is activated by the company manager once its
   * papers are on record. Branches with no status predate this and count as active.
   */
  status?: 'proposed' | 'active' | 'step_in' | 'terminating' | 'closed';
  setup?: BranchSetup;
  /** Masterplan 148 and 170: accounts the branch may use, with the bank number kept to its last 4 digits. */
  accounts?: BranchAccount[];
  /** Company step-in (masterplan 146.1, 157): the company runs the branch directly; reason kept. */
  stepIn?: { by: string; at: IsoDateTime; reason: string; endedBy: string | null; endedAt: IsoDateTime | null } | null;
  /** Termination steps in order (masterplan 157). */
  termination?: { step: import('./branch-ledger').TerminationStep; by: string; at: IsoDateTime; note: string }[];
  history?: { at: IsoDateTime; by: string; what: string }[];
  /** Masterplan 145: business case and 13-week cash forecast at formation, by version (newest last). */
  businessCases?: BranchBusinessCase[];
  /** Branch treasury: daily figures Finance records from the bank statement (newest kept, at most 90). */
  treasury?: BranchTreasuryDay[];
  /** Cash float limit set by the company manager, with the reason. */
  floatLimit?: { amount: number; by: string; at: IsoDateTime; reason: string } | null;
}

/** A branch business case: the company's own estimates, entered by company staff and reviewed by Finance. */
export interface BranchBusinessCase {
  version: number;
  sites: number;
  guards: number;
  monthlyBilling: number;
  monthlyCosts: number;
  startupCost: number;
  openingCash: number;
  fundingSource: string;
  assumptions: string;
  cash13: { week: number; inflow: number; outflow: number }[];
  by: string;
  byId: Id;
  at: IsoDateTime;
  reviewedBy: string | null;
  reviewedById: Id | null;
  reviewedAt: IsoDateTime | null;
  reviewNote: string;
}

/** One day's branch treasury figures, recorded by Finance from the bank statement and payroll run. */
export interface BranchTreasuryDay {
  on: IsoDate;
  bankBalance: number;
  statementRef: string;
  floatHeld: number;
  payrollDueOn: IsoDate | null;
  payrollDueAmount: number | null;
  payrollRef: string | null;
  paymentsDue7d: number;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

/** Papers a branch needs before activation. References only: Prima never checks with KDN or the council itself. */
export interface BranchSetup {
  kdnRef: string | null;
  premisesRef: string | null;
  insuranceRef: string | null;
  /** SQL Account project code for the branch's P&L; set by Finance, unique in the company. */
  sqlProjectCode: string | null;
  sqlProjectCodeBy: string | null;
  /** The licensed company stays the statutory employer (masterplan 149); recorded by the company manager. */
  legalEmployer: string | null;
  activatedBy: string | null;
  activatedAt: IsoDateTime | null;
}

export interface BranchAccount {
  id: Id;
  /** A: the company's own bank account for the branch; B: the SQL project ledger; C: a partner's own business. */
  kind: 'company_branch_bank' | 'project_ledger' | 'partner_entity';
  holder: string;
  bank: string;
  last4: string;
  ssmRegNo: string | null;
  signatories: string;
  addedBy: string;
  addedAt: IsoDateTime;
  verifiedBy: string | null;
  verifiedAt: IsoDateTime | null;
  verifyNote: string;
  closedAt: IsoDateTime | null;
}

/**
 * One line of a branch month (masterplan 163.1, 165.1): every figure cites its SQL Account document or payroll
 * reference. Billing is the tax-exclusive invoiced value of signed work; a credit note is negative.
 */
export interface BranchSettlementLine {
  kind: 'billing' | 'credit_note' | 'true_up' | import('./branch-ledger').BranchCostKind;
  ref: string;
  siteId: Id | null;
  amount: number;
  note: string;
}

/**
 * A signed branch agreement version (V12.1): Model A, the company keeps a signed % of eligible billing and the manager
 * takes the rest after costs; B, salary only; C, the company keeps a signed % of net branch profit. Every percentage
 * comes from the signed agreement: there is no default.
 */
export interface BranchAgreement {
  version: number;
  effectiveFrom: IsoDate;
  model: BranchModel;
  managerName: string;
  managerKind: 'employee' | 'partner_company';
  companyBillingSharePct: number | null;
  companyNetProfitSharePct: number | null;
  managerSalary: number | null;
  signedRef: string;
  by: string;
  at: IsoDateTime;
}

/** A branch's month: figures (test data until SQL project codes are read), the split, and the company's approval. */
export interface BranchSettlement {
  id: Id;
  companyId: Id;
  branchId: Id;
  period: string;
  billing: number;
  costs: { wages: number; statutory: number; other: number };
  /** returned: sent back with a reason for the preparer to correct; validated: Finance agreed it to the ledger. */
  status: 'draft' | 'returned' | 'approved' | 'validated' | 'paid';
  approvedBy: string | null;
  approvedAt: IsoDateTime | null;
  /** Lines the month was prepared from. Absent on older test rows, which are shown as not prepared from SQL. */
  lines?: BranchSettlementLine[];
  /** The payroll run or JA pay summary the wages lines come from (masterplan 149). */
  payrollRef?: string | null;
  preparedBy?: string | null;
  preparedById?: Id | null;
  preparedAt?: IsoDateTime | null;
  approvedById?: Id | null;
  approveNote?: string;
  validatedBy?: string | null;
  validatedById?: Id | null;
  validatedAt?: IsoDateTime | null;
  validateNote?: string;
  paidBy?: string | null;
  paidAt?: IsoDateTime | null;
  bankRef?: string | null;
  steps?: { at: IsoDateTime; by: string; what: string; note: string }[];
}

/**
 * Something a branch did that the company must see (Fauzan, 24 Oct 2026: every company matter is controlled or
 * monitored by the company). C waits for the company first; M is done within limits and the company may reverse it.
 */
export interface BranchAction {
  id: Id;
  companyId: Id;
  branchId: Id;
  control: 'C' | 'M';
  kind: 'expense' | 'roster' | 'client' | 'purchase' | 'staff';
  title: string;
  amount: number | null;
  at: IsoDateTime;
  by: string;
  status: 'awaiting' | 'accepted' | 'reversed';
  reviewedBy: string | null;
  reviewedAt: IsoDateTime | null;
  note: string;
}

export type SiteRisk = 'low' | 'medium' | 'high';

export interface Site {
  id: Id;
  companyId: Id;
  branchId: Id;
  code: string;
  name: string;
  client: string;
  address: string;
  lat: number;
  lng: number;
  risk: SiteRisk;
  armed: boolean;
  /** Geofence radius in metres for clock-in. */
  geofenceM: number;
  /**
   * Minutes between patrol rounds when the client asked for a different time (Fauzan, 25 Oct 2026).
   * null or missing means the group default, rule OPS-PATROL-GAP.
   */
  patrolIntervalMin?: number | null;
  /** Why the interval differs, e.g. the client's letter or request. */
  patrolIntervalNote?: string | null;
  /** Government sites escalate to the Operations General Manager, private sites to the Operations Director. Missing means private. */
  sector?: 'government' | 'private';
  /**
   * The Malaysian state the site is in. Used when the site has no branch (or its branch is not set up), so the OM and
   * Regional OM who cover that state see it (go-live readiness, 2 Nov 2026).
   */
  state?: string;
}

export interface Post {
  id: Id;
  companyId: Id;
  siteId: Id;
  name: string;
  shiftStructure: ShiftStructure;
  guardsPerShift: number;
}

/** 'office' is company staff other than guards and officers: managers, admin executives (Fauzan, 25 Oct 2026). */
export type PersonRole = 'guard' | 'supervisor' | 'patrol_officer' | 'office';
export type PersonStatus = 'active' | 'suspended' | 'left';

export interface Person {
  id: Id;
  companyId: Id;
  branchId: Id;
  staffNo: string;
  name: string;
  nationality: Nationality;
  /** Masked identity number (IC or passport); full numbers live in the restricted vault. */
  idMasked: string;
  dob: IsoDate;
  phone: string;
  role: PersonRole;
  status: PersonStatus;
  hiredOn: IsoDate;
  /**
   * The person's PIN for patrol scans on shared site devices and witness sign-offs, kept only as a keyed salted hash
   * (pin.ts). null or missing: no PIN set yet, so PIN sign-in is refused until HR sets one. Never sent to a browser.
   */
  pinHash?: string | null;
  /**
   * Date the face was enrolled for clock-in, with the person's written biometric consent
   * (PDPA sensitive data). null means not enrolled. The face template itself never sits in
   * this record; it lives with the face engine in Malaysia.
   */
  faceEnrolledOn: IsoDate | null;
  /** Basic monthly pay in RM (mock until payroll rules and payslips arrive). */
  basicPay?: number;
  /** Hiring papers on file (Shahirah, 26 Oct 2026): the signed agreement, the stamped agreement and the vetting certificate. */
  hiringDocs?: HiringDoc[];
  /**
   * The utility clause in the worker's contract of employment (Fauzan, 26 Oct 2026): without it, utility excess is a
   * notice only, never a deduction.
   */
  utilityClause?: { docId: Id; by: string; at: IsoDateTime } | null;
  /** The worker's one-time signed acknowledgement of the hostel utility rule. */
  utilityAck?: { docId: Id; by: string; at: IsoDateTime } | null;
  /** Job title for office staff, e.g. Admin Executive. */
  jobTitle?: string;
  /** SOCSO (PERKESO) number, when on record. */
  socsoNo?: string;
  /**
   * A Malaysian who opted out of LINDUNG 24 Jam is not covered for accidents outside work. Foreign workers cannot opt
   * out. Undefined means not recorded.
   */
  lindungOptOut?: boolean;
  /**
   * Zakat deducted from salary, chosen by the staff member themselves (Fauzan, 2 Nov 2026: "staff can choose what they
   * want and how much the percentage of it"): the zakat body and the percentage of gross pay. Null or missing: none.
   */
  zakat?: { body: string; percent: number; set: { by: string; byId: Id; at: IsoDateTime } } | null;
  /** Every change of the zakat choice, newest last (kept 24). */
  zakatHistory?: { body: string | null; percent: number | null; by: string; byId: Id; at: IsoDateTime }[];
  /** Driver's written consent to dashcam and health monitoring while driving, filed by the PDPA officer. */
  monitoringConsent?: { docId: Id; by: string; at: IsoDateTime } | null;
  /** Salary account for staff payroll (test data: masked; full numbers live with Finance and the bank). */
  bank?: { bank: string; accountMasked: string } | null;
  /**
   * Fixed monthly allowances paid with the staff salary. HR sets them from its allowance list (Fauzan, 3 Nov 2026); a
   * change takes effect only after the HR Director verifies it and the Vice Chairman consents. A line without a typeId was
   * entered before the list and counts for EPF, SOCSO, PCB and the HRD levy.
   */
  allowances?: { label: string; amount: number; typeId?: Id }[];
  // Office staff record kept by HR (Fauzan, 27 Oct 2026). The full IC and salary account no longer sit on the person
  // record: they live behind the HR database wall in staffIds and staffAccounts (HR Phase 3, slice 3A part 3).
  /** Legacy only: rows written before the HR wall. Cleared to null when HR next saves the record. */
  idFull?: string | null;
  /** Legacy only: rows written before the HR wall. Cleared to null when HR next saves the record. */
  bankAccountFull?: string | null;
  /** The day a verified salary account change took effect; payroll flags the line that month. */
  bankChangedOn?: IsoDate;
  gender?: 'M' | 'F';
  /** Marital status and children, for PCB. */
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed';
  children?: number;
  email?: string;
  address?: string;
  department?: string;
  /** Who the staff member reports to, by name. */
  reportsTo?: string;
  employmentType?: 'permanent' | 'contract' | 'probation';
  /**
   * HR Phase 3, slice 3C (Fauzan, 2 Nov 2026): days HR gives above the Act for this staff member. HR may only raise a
   * number, never go below the law, and always gives a reason.
   */
  leaveOverrides?: Partial<Record<LeaveOverrideKind, { days: number; note: string; by: string; byId: Id; at: IsoDateTime }>>;
  /**
   * Working from home is open only to staff HR has allowed (Fauzan, 2 Nov 2026: "only HR can choose ... the system will
   * block it until HR turns it on for the staff member"). Null or missing: not allowed.
   */
  wfhAllowed?: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  probationEndsOn?: IsoDate | null;
  /** HR's probation decisions (slice 3B): confirmed, or extended to a new date, each with a comment. */
  probationDecisions?: { decision: 'confirm' | 'extend'; newEndsOn: IsoDate | null; note: string; by: string; byId: Id; at: IsoDateTime }[];
  contractEndsOn?: IsoDate | null;
  epfNo?: string;
  taxNo?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  /**
   * When the person first started in the group (Fauzan, 3 Nov 2026). By law a transfer to another company starts a new
   * employment, so hiredOn is the new company's start; the HR record keeps the first group start here.
   */
  groupJoinedOn?: IsoDate | null;
  /** The staff movement that created this record or moved this person (transfer in, or the one that moved them out). */
  movedFrom?: { movementId: Id; personId: Id; companyId: Id } | null;
  movedTo?: { movementId: Id; personId: Id; companyId: Id } | null;
  /** Working for another group company while still employed here (allowed with the CEO's consent, Fauzan, 3 Nov 2026). */
  secondment?: { movementId: Id; toCompanyId: Id; from: IsoDate; until: IsoDate } | null;
  /** The leaving step: why and when employment ends. Status turns to left on the last day. */
  leaving?: {
    kind: 'resigned' | 'terminated' | 'contract_end' | 'retired' | 'transferred';
    noticeOn: IsoDate | null;
    lastDayOn: IsoDate;
    reason: string;
    by: string;
    at: IsoDateTime;
  } | null;
}

/**
 * A change to an office staff member's basic pay (Fauzan, 27 Oct 2026: "need CoS verify"). HR proposes it on the staff
 * form; it takes effect only when the Chief of Staff or Deputy (HR Director) verifies it. A new hire's first pay too.
 */
export interface PayChange {
  id: Id;
  companyId: Id;
  personId: Id;
  from: number | null;
  to: number;
  reason: string;
  /** First day the new pay applies. */
  effectiveOn: IsoDate;
  requestedBy: string;
  requestedById: Id;
  requestedAt: IsoDateTime;
  status: 'pending' | 'verified' | 'rejected';
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  note: string | null;
  /**
   * A salary account change (insider abuse audit, Fauzan 27 Oct 2026): HR keys it, then the HR Director and Finance both
   * verify it before the account is used. Absent means a basic pay change.
   */
  kind?: 'PAY' | 'BANK' | 'ALLOWANCE';
  /** An allowance change (Fauzan, 3 Nov 2026): the whole fixed monthly list before and after. from/to hold the totals. */
  allowancesFrom?: { label: string; amount: number; typeId?: Id }[];
  allowancesTo?: { label: string; amount: number; typeId?: Id }[];
  bankFrom?: { bank: string; accountMasked: string } | null;
  /** The new account, masked. The full number waits behind the HR wall (StaffAccount.pending) until both checks are done. */
  bankTo?: { bank: string; accountMasked: string; accountFull?: string } | null;
  hrDirectorCheck?: { by: string; byId: Id; at: IsoDateTime; note?: string } | null;
  financeCheck?: { by: string; byId: Id; at: IsoDateTime } | null;
  /**
   * A basic pay change (a salary amount set each year or on review) takes effect only when the Vice Chairman consents,
   * after the HR Director verifies it (Fauzan, 1 Nov 2026).
   */
  vcConsent?: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /**
   * An allowance change consented before its date waits (null) and is applied on the day it takes effect (Arisha main
   * retest, 4 Nov 2026). Absent on older rows means applied at consent.
   */
  applied?: { at: IsoDateTime; by: string } | null;
}

/**
 * Leave and absence reasons asked for in the app (Fauzan, 25 Oct 2026: "request for leave or reason for absent, all
 * request and given reason in the app"). The guard asks on the site device or through the company; the company decides.
 */
export type LeaveKind = 'ANNUAL' | 'SICK' | 'HOSPITAL' | 'EMERGENCY' | 'UNPAID' | 'ABSENCE_REASON' | 'MATERNITY' | 'PATERNITY';

/** Leave kinds whose yearly days HR may raise above the Act for one staff member (Fauzan, 2 Nov 2026). */
export type LeaveOverrideKind = 'ANNUAL' | 'SICK' | 'MATERNITY' | 'PATERNITY';

export interface LeaveRequest {
  id: Id;
  companyId: Id;
  personId: Id;
  kind: LeaveKind;
  from: IsoDate;
  to: IsoDate;
  /** Working days counted against the balance. */
  days: number;
  reason: string;
  /** Medical certificate, letter or other document (rule CASE-PROOF). */
  proofIds: Id[];
  requestedAt: IsoDateTime;
  requestedBy: string;
  via: 'site_device' | 'company';
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string | null;
  /** The illness as written on the MC, for sick leave and hospitalisation (medical data: HR, the company and the worker only). */
  illness?: string;
  /** Clinic or hospital that issued the MC. */
  clinic?: string;
  /** The serial printed on the MC; one MC is used once. */
  mcNo?: string;
  /** The staff member's own refused request this one corrects; its MC documents are reused (Arisha review, 3 Nov 2026). */
  correctsId?: Id;
  /** Hospitalisation only: the claim papers and where the claim is (Shahirah, 26 Oct 2026). */
  hospitalClaim?: HospitalClaim;
  /**
   * Office staff only (Fauzan, 1 Nov 2026): the HR Administrator decides staff leave with the Vice Chairman's consent.
   * HR's approval is kept here and the request stays pending until the Vice Chairman consents (or refuses).
   */
  hrApproval?: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /**
   * Office staff of a licensed company (Fauzan, 3 Nov 2026): the Company Manager authorises the request first, with a
   * comment; HR then decides as before. Central staff (PWVSB, Merdeka, Goodwill) have no company manager step.
   */
  managerAuthorised?: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
}

export type HiringDocKind = 'AGREEMENT' | 'AGREEMENT_STAMPED' | 'VETTING_CERT';
export interface HiringDoc {
  kind: HiringDocKind;
  docIds: Id[];
  by: string;
  at: IsoDateTime;
}

export type HospitalDocItem = 'ADMISSION_LETTER' | 'GUARANTEE_LETTER' | 'MEDICAL_CERT' | 'DISCHARGE_SUMMARY' | 'ITEMISED_BILL' | 'CLAIM_FORM';
export type HospitalDocStatus = 'missing' | 'received' | 'not_needed';
export type HospitalClaimStage = 'collecting' | 'submitted' | 'approved' | 'paid' | 'rejected';
export interface HospitalClaim {
  docs: { item: HospitalDocItem; status: HospitalDocStatus; docIds: Id[]; by: string | null; at: IsoDateTime | null }[];
  stage: HospitalClaimStage;
  /** Who the claim goes to, such as the group hospitalisation insurer or SPIKPA. */
  insurer: string | null;
  history: { at: IsoDateTime; by: string; text: string }[];
}

/** What the face engine reports for one capture, checked 1:1 against the enrolled face. */
export interface FaceCapture {
  /** Similarity to the enrolled face, 0 to 1. */
  score: number;
  /** Passed the live-person check (not a photo or screen held up to the camera). */
  live: boolean;
}

export type CredentialType =
  | 'KDN_GUARD_CARD'
  /** Vetting application submitted in KDN eSIMS; issuedOn is the submission date. */
  | 'KDN_VETTING'
  | 'CSG_TRAINING'
  | 'TNG_TRAINING'
  | 'PLKS_PERMIT'
  | 'PASSPORT'
  | 'FOMEMA'
  | 'FW_INSURANCE'
  | 'FIREARM_PERMIT'
  /** Range practice for an armed guard; expiresOn is when the next practice is due. */
  | 'RANGE_PRACTICE';

export interface Credential {
  id: Id;
  companyId: Id;
  personId: Id;
  type: CredentialType;
  number: string;
  issuedOn: IsoDate;
  /** null means it does not expire (e.g. CSG training certificate). */
  expiresOn: IsoDate | null;
  /** Who entered it in Prima (HR or the company head, Fauzan 2 Nov 2026); absent when it came from JA or the seed. */
  recordedBy?: string | null;
  recordedById?: Id | null;
  recordedAt?: IsoDateTime | null;
}

export type LicenceType =
  | 'KDN_LICENCE'
  | 'MOF_REGISTRATION'
  | 'INSURANCE'
  | 'SSM_ANNUAL_RETURN'
  /** Central Admin 5C (Fauzan, 2 Nov 2026): every renewal a company holds. */
  | 'MAJLIS_PREMISE'
  | 'MAJLIS_SIGNBOARD'
  | 'VENDOR_PANEL'
  | 'ISO_CERT'
  | 'FIRE_CERT'
  | 'OTHER_COMPLIANCE';

/** One step of settling a renewal (5C): who did it and when. */
export interface RenewalMark {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note?: string | null;
}

/**
 * A renewal being settled (Central Admin 5C, Fauzan 2 Nov 2026): each company renews its own items; Central Admin
 * monitors. Papers, the company manager's sign-off (never the preparer), the fee through Finance, submission, the
 * agency's follow-up, then the new certificate and expiry, confirmed by Central Admin.
 */
export interface RenewalCase {
  openedOn: IsoDate;
  openedBy: string;
  openedById: Id;
  /** The paper checklist, from the RENEWAL-PAPERS rule, ticked by the company. */
  papers: { name: string; done: RenewalMark | null; ref?: string | null }[];
  signed: RenewalMark | null;
  /** Fee paid through Finance: the payment reference Finance gives. */
  fee: (RenewalMark & { ref: string; amount: number | null }) | null;
  submitted: (RenewalMark & { ref: string; on: IsoDate }) | null;
  agencyNotes: RenewalMark[];
  /** Sent back (agency refused or asked for more, or the signer returned it): back to the papers with the reason. */
  returns: RenewalMark[];
  renewed: (RenewalMark & { newExpiresOn: IsoDate; oldExpiresOn: IsoDate | null; certificateRef: string }) | null;
  confirmed: RenewalMark | null;
}

export interface CompanyLicence {
  id: Id;
  companyId: Id;
  type: LicenceType;
  reference: string;
  /** null means we have no record: shown as UNKNOWN, never green. */
  expiresOn: IsoDate | null;
  /** Which council, panel, standard or permit this is (5C), e.g. "MBPJ premise licence", "ISO 9001". */
  title?: string | null;
  /** Who issues it, e.g. the council, KDN, MOF, the certifying body. */
  issuer?: string | null;
  /** The branch office it is for (majlis licences are per premises). */
  branchId?: Id | null;
  /** The renewal now being settled, if any. */
  renewal?: RenewalCase | null;
  /** Past renewals, newest first. */
  renewals?: { closedOn: IsoDate; oldExpiresOn: IsoDate | null; newExpiresOn: IsoDate; certificateRef: string; by: string }[];
}

export interface Shift {
  id: Id;
  companyId: Id;
  siteId: Id;
  postId: Id;
  personId: Id | null;
  date: IsoDate;
  start: IsoDateTime;
  end: IsoDateTime;
  status: 'draft' | 'published';
}

export type AttendanceFlag =
  | 'LATE'
  | 'OUTSIDE_GEOFENCE'
  | 'NO_PHOTO'
  | 'OFFLINE_SYNC'
  | 'EARLY_LEAVE'
  | 'NO_SHOW'
  | 'NOT_ROSTERED'
  | 'FACE_NOT_MATCHED'
  | 'NO_LIVENESS'
  | 'NO_FACE_ENROLMENT';

export interface Attendance {
  id: Id;
  companyId: Id;
  siteId: Id;
  shiftId: Id | null;
  personId: Id;
  deviceId: string;
  clockIn: IsoDateTime | null;
  clockOut: IsoDateTime | null;
  lat: number | null;
  lng: number | null;
  distanceM: number | null;
  photo: boolean;
  flags: AttendanceFlag[];
  /** Supervisor locks the day at D+1 before payroll inputs (W11). */
  locked: boolean;
}

/** Attendance problems the PIC is alerted to (Shahirah, comments on the attendance sheet, 25 Oct 2026). */
export type AttendanceIssue = 'NO_SHOW' | 'POST_EMPTY' | 'LATE' | 'OUTSIDE_GEOFENCE' | 'EARLY_LEAVE' | 'FACE_NOT_MATCHED' | 'NOT_ROSTERED';
export type FollowUpKind = 'STAFF_ALERTED' | 'REPLACEMENT' | 'DISCIPLINE' | 'EXCUSED';
/**
 * Steps of the one group disciplinary handbook (Fauzan, 25 Oct 2026: same handbook for every guard, following
 * labour law). The company records them; the app never decides or issues discipline itself.
 */
export type DisciplineStep =
  | 'VERBAL_WARNING'
  | 'WRITTEN_WARNING'
  | 'FINAL_WARNING'
  | 'SHOW_CAUSE'
  | 'DOMESTIC_INQUIRY'
  | 'SUSPENSION'
  | 'DOWNGRADE'
  | 'DISMISSAL';

/** What the PIC or CMS did about an attendance problem. Kept as the absence and discipline record. */
export interface AttendanceFollowUp {
  id: Id;
  companyId: Id;
  siteId: Id;
  postId: Id | null;
  shiftId: Id | null;
  attendanceId: Id | null;
  personId: Id | null;
  date: IsoDate;
  issue: AttendanceIssue;
  kind: FollowUpKind;
  at: IsoDateTime;
  by: string;
  /** Company staff or the CMS desk. */
  /** Who acted: the company, the CMS desk, or operations stepping in for the company (rule OPS-STEP-IN). */
  byDesk: 'company' | 'cms' | 'operations';
  note: string;
  replacementShiftId: Id | null;
  replacementPersonId: Id | null;
  discipline: DisciplineStep | null;
  /** Show-cause letter: the date the guard's written reply is due. */
  replyDue?: IsoDate | null;
  /** Suspension without wages after an inquiry: number of days (Employment Act s.14(1)(c), at most 14). */
  suspensionDays?: number | null;
  /** Supporting documents, e.g. the medical certificate or the letter given (rule CASE-PROOF). */
  proofIds?: Id[];
}

/** Where a photo or visit was, checked against the site (Fauzan, 25 Oct 2026: geo-tag that it is true). */
export type EvidencePlace = 'on_site' | 'away' | 'weak_gps';
/** Device time compared with the server's: matches, sent later (offline), or the phone clock is wrong. */
export type EvidenceTime = 'ok' | 'sent_later' | 'clock_wrong';

/**
 * A photo taken with the in-app camera for an incident report or a site visit. The picture carries a burned-in
 * time and GPS stamp; the server keeps its own receive time, the checked location and a SHA-256 of the image.
 */
export interface EvidencePhoto {
  id: Id;
  companyId: Id;
  siteId: Id;
  caseId: Id | null;
  visitId: Id | null;
  takenBy: string;
  /** Time on the phone when the picture was taken. */
  capturedAt: IsoDateTime;
  /** Time the server received it; this is the trusted time. */
  receivedAt: IsoDateTime;
  lat: number;
  lng: number;
  accuracyM: number | null;
  distanceM: number;
  place: EvidencePlace;
  time: EvidenceTime;
  sha256: string;
  bytes: number;
  /** Stamped JPEG as a data URL. Production keeps the file in Malaysian object storage instead. */
  image: string;
  caption: string;
  source: 'in_app_camera' | 'test_picture';
}

/**
 * A supporting document (Fauzan, 25 Oct 2026: every case must be verified and done with proof, a photo or a
 * document): a PDF or a picture of a letter, police report, client confirmation or medical certificate.
 */
export interface EvidenceDoc {
  id: Id;
  companyId: Id;
  caseId: Id | null;
  followUpId: Id | null;
  leaveId?: Id | null;
  socsoId?: Id | null;
  /** A foreign-worker renewal receipt or the proof of an FWM task. */
  fwmId?: Id | null;
  tenderId?: Id | null;
  reportId?: Id | null;
  /** A hiring paper or hospital claim paper on a worker's file. */
  hrPersonId?: Id | null;
  /** A hostel bill, its payment request or its payment slip. */
  hostelBillId?: Id | null;
  /** A staff claim's receipt or check-up result. */
  staffClaimId?: Id | null;
  /** A receipt kept in a staff member's own wallet (the person's id), claimed now or later (Fauzan, 2 Nov 2026). */
  walletOf?: Id | null;
  wallet?: import('./receipts').ReceiptWallet | null;
  /** A PDPA notification or a client's signed consent. */
  pdpaCaseId?: Id | null;
  /** A vehicle renewal, service or payment receipt, or a driver's monitoring consent. */
  vehicleId?: Id | null;
  /** A product certificate. */
  productId?: Id | null;
  name: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  bytes: number;
  sha256: string;
  /** File as a data URL. Production keeps the file in Malaysian object storage instead. */
  data: string;
  caption: string;
  uploadedBy: string;
  receivedAt: IsoDateTime;
}

/** A supervisor, manager or operations visit to a site, checked in by GPS and closed with photos and findings. */
export interface SiteVisit {
  id: Id;
  companyId: Id;
  siteId: Id;
  userId: Id;
  visitorName: string;
  visitorTitle: string;
  purpose: string;
  startedAt: IsoDateTime;
  lat: number;
  lng: number;
  accuracyM: number | null;
  distanceM: number;
  place: EvidencePlace;
  endedAt: IsoDateTime | null;
  findings: string | null;
  status: 'open' | 'closed';
}

export type CaseStatus = 'open' | 'acknowledged' | 'escalated' | 'resolved' | 'closed';
export type CaseType = 'INCIDENT' | 'SOS' | 'MISSED_CHECKIN' | 'NO_SHOW' | 'COMPLAINT' | 'COMPLIANCE' | 'IDENTITY_CHECK' | 'ARMS';

export interface CaseEvent {
  at: IsoDateTime;
  by: string;
  action: string;
  note?: string;
}

/**
 * Who must act on a site case next. Operations hierarchy (Fauzan, 25 Oct 2026): guard, then the officer stationed
 * at the site (only some sites have one), the patrolling officer, the Operations Manager and the Regional Operations
 * Manager, who confirms the case fully resolved. Above the ROM only big matters, escalated by decision: the head of
 * operations for the site's sector (Operations General Manager for government sites, Operations Director for
 * private sites), then the COO, then the CEO.
 */
export type EscalationLevel = 'OFFICER' | 'PATROL' | 'OM' | 'ROM' | 'HEAD' | 'COO' | 'CEO' | 'DONE';

export interface CaseSignOff {
  level: Exclude<EscalationLevel, 'DONE'>;
  outcome: 'verified' | 'resolved' | 'sent_back' | 'confirmed' | 'escalated';
  by: string;
  at: IsoDateTime;
  note: string;
  /** Signed by a higher level because the case waited past its time at this level. */
  stepIn?: boolean;
  /** Photos and documents given as proof with this sign-off (rule CASE-PROOF). */
  proofIds?: Id[];
}

/** The guard who reported, confirmed by face on the site device. */
export interface CaseReporter {
  personId: Id;
  staffNo: string;
  name: string;
  face: 'confirmed' | 'not_confirmed';
  flags: AttendanceFlag[];
}

export interface Case {
  id: Id;
  ref: string;
  companyId: Id;
  siteId: Id | null;
  type: CaseType;
  severity: Severity;
  title: string;
  description: string;
  reportedBy: string;
  openedAt: IsoDateTime;
  slaDueAt: IsoDateTime;
  status: CaseStatus;
  owner: string | null;
  events: CaseEvent[];
  /** Escalation ladder for site cases; missing means it starts with the supervisor. */
  level?: EscalationLevel;
  levelSince?: IsoDateTime;
  signOffs?: CaseSignOff[];
  reporter?: CaseReporter | null;
}

export interface PatrolCheckpoint {
  id: Id;
  companyId: Id;
  siteId: Id;
  name: string;
  tagCode: string;
}

export interface PatrolScan {
  id: Id;
  companyId: Id;
  siteId: Id;
  checkpointId: Id;
  personId: Id;
  at: IsoDateTime;
  /** Patrols are recorded only by tapping a coded NFC tag (Fauzan, 24 Oct 2026). */
  method: 'NFC';
  /** Chip serial number read from the tag, kept so a copied tag can be spotted later. */
  tagSerial?: string | null;
}

// ---------- Arms control (V13, V14) ----------

/** Fixed statuses. There is no "kept by guard" status; UNVERIFIED is never counted as secure. */
export type FirearmStatus = 'IN_VAULT' | 'ISSUED' | 'MAINTENANCE' | 'UNVERIFIED' | 'LOST' | 'DEPOSITED' | 'OFF_REGISTER';

/** An approved armoury or safe of one licensed company. Exact locations stay off general screens. */
export interface Vault {
  id: Id;
  companyId: Id;
  name: string;
  /**
   * Where the firearms are stored, each with its own police approval (Fauzan, 25 Oct 2026): the company's
   * armoury (default), a police station, or an arms safe (peti besi) at a client's premises.
   */
  kind?: 'COMPANY_ARMOURY' | 'POLICE_STATION' | 'CLIENT_SAFE';
  /** The client site holding the safe, for CLIENT_SAFE. The safe is owned and managed by the company, not the client. */
  siteId?: Id | null;
  /** Last time the paper register book was checked against the online register (Fauzan, 25 Oct 2026: both are kept). */
  registerCheckedAt?: IsoDateTime | null;
  /** Each check of the register book against the online register, newest last (slice 4B; last 30 kept). */
  registerChecks?: { at: IsoDateTime; by: string; matches: boolean; note: string; caseRef: string | null }[];
  /** Company staff authorised to open and use this storage. When set, nobody else may issue from it. */
  authorisedUsers?: string[];
  state: string;
  /** PDRM approval reference and expiry for this storage. */
  approvalRef: string;
  approvalExpiresOn: IsoDate | null;
  /** The Amra (armoury keeper) who issues and receives at this vault, usually admin staff (Fauzan, 25 Oct 2026). */
  custodian: string;
  custodianRole?: string;
  /** Holder of this vault's A licence, usually a director or manager of the company (Fauzan, 25 Oct 2026). */
  aLicenceHolder?: string;
  aLicenceRole?: string;
  lastCountAt: IsoDateTime | null;
  lastCountOk: boolean | null;
  /** null means the alarm feed is not connected: shown as unknown, never as secure. */
  alarmOnline: boolean | null;
  /** Vault camera feed seen by CMS (V14 s.222). null or missing means not connected, shown as unknown. */
  cctvOnline?: boolean | null;
  /** The recorder can prove it is recording. A live camera with no recording is still an exception (V14 s.226). */
  recordingOk?: boolean | null;
}

/** A door or access event from the vault's own system, matched by CMS against issues, returns and counts (V14 s.209). */
export interface VaultEvent {
  id: Id;
  companyId: Id;
  vaultId: Id;
  at: IsoDateTime;
  kind: 'DOOR_OPEN' | 'DOOR_FORCED' | 'ACCESS_DENIED';
  /** Card or PIN holder named by the access system; null when the system did not say. */
  by: string | null;
}

/**
 * Ammunition held in one vault, by calibre (V14 s.208). The ledger is the balance from approved
 * receipts, issues and returns; the count is the last physical count. A difference is never
 * adjusted silently: it opens a reviewed case.
 */
export interface AmmoStock {
  id: Id;
  companyId: Id;
  vaultId: Id;
  calibre: string;
  ledger: number;
  counted: number | null;
  countedAt: IsoDateTime | null;
  countedBy: string | null;
  /** Second person who checked the count. The same person counting and checking is flagged. */
  checkedBy: string | null;
  /**
   * Every receipt, issue, return and count, newest last (slice 4B, last 60 kept). Issues and returns come from the
   * firearm issue and return themselves, so rounds are keyed once.
   */
  log?: { at: IsoDateTime; kind: 'RECEIPT' | 'ISSUE' | 'RETURN' | 'COUNT'; rounds: number; by: string; ref: string }[];
}

/** The client's signed agreement for armed service at a site or for an armed job, with its insurance (V14 s.212, s.224). */
export interface ArmsAgreement {
  id: Id;
  companyId: Id;
  siteId: Id | null;
  jobKind?: 'BODYGUARD' | 'CIT' | 'CDM' | 'CASH_VAULT';
  client: string;
  armedPosts: number;
  signedOn: IsoDate | null;
  endsOn: IsoDate | null;
  insurer: string | null;
  policyRef: string | null;
  insuranceExpiresOn: IsoDate | null;
  /** Name of a site still being set up, before it exists as a site. */
  siteName?: string;
  /**
   * Setting up armed service (Fauzan, 25 Oct 2026): notify the police once that armed guards are being placed,
   * install a small arms vault at the site if one is used, get police approval, then go live. Not repeated daily.
   */
  setup?: { policeNotice: PoliceRef | null; siteVaultId: Id | null; siteVaultPlanned: boolean; approval: PoliceRef | null };
}

/** The ten steps every arms request goes through (V14 s.223). */
export type ArmsRequestState =
  | 'draft'
  | 'submitted'
  | 'arms_review'
  | 'company_auth'
  | 'legal_check'
  | 'regulator_pending'
  | 'approved'
  | 'verified'
  | 'reconciled'
  | 'closed';

/** A request to buy, move, transfer, service, dispose of or report the loss of a firearm or ammunition. */
export interface ArmsRequest {
  id: Id;
  companyId: Id;
  ref: string;
  /** TRADE_BUY, TRADE_SELL and IMPORT are arms trading (slice 4H): refused while the CEO's trading switch is off. */
  kind: 'ACQUIRE' | 'MOVE' | 'TRANSFER' | 'SERVICE' | 'DISPOSE' | 'LOSS_REPORT' | 'TRADE_BUY' | 'TRADE_SELL' | 'IMPORT';
  title: string;
  state: ArmsRequestState;
  openedAt: IsoDateTime;
  updatedAt: IsoDateTime;
  raisedBy: string;
  /** Deadline set by Compliance, for example a police report; null when none applies. */
  dueBy: IsoDate | null;
  note: string;
  /** Needs legal review before company authority (transfers between companies, dealing, disposal). */
  needsLegal: boolean;
  /** For a move or transfer: where the arms go from and to. A different state needs police approval. */
  fromState?: string;
  toState?: string;
  policeNotice?: PoliceRef | null;
  policeApproval?: PoliceRef | null;
  /** Slice 4C: who raised it, so nobody approves their own request. */
  raisedById?: Id | null;
  /** Firearms the request is about (move, transfer, service, disposal, loss, sale). */
  firearmIds?: Id[];
  /** Ammunition: calibre and rounds (buy), or items and quantity (firearms to buy). */
  calibre?: string | null;
  quantity?: number | null;
  /** Estimated cost in RM. Any spending needs the COO or the CEO, with a reason (plan 4C). */
  estCost?: number | null;
  supplierId?: Id | null;
  /** Where the arms go: a vault of the same company (move) or of another group company (transfer). */
  toVaultId?: Id | null;
  toCompanyId?: Id | null;
  /** The COO's or CEO's approval of the spending. */
  /** The COO or CEO's spending approval, bound to the amount they approved. */
  spend?: { by: string; byId: Id; at: IsoDateTime; reason: string; amount?: number } | null;
  /** Every step with who took it and why, oldest first. */
  log?: { at: IsoDateTime; by: string; byId: Id; from: ArmsRequestState; to: ArmsRequestState; action: string; reason: string }[];
  /** Arms trading and import (slice 4H): only while the CEO's trading switch is on. */
  trade?: ArmsTradeDetail | null;
}

/** Buyer, police and import papers for an arms trade (slice 4H; Fauzan, 2 Nov 2026). */
export interface ArmsTradeDetail {
  /** Sale: the buyer must hold a valid licence, the police approval and the end-user certificate (Fauzan answer 3). */
  buyer?: { name: string; licenceRef: string; licenceExpiresOn: IsoDate; policeApprovalRef: string; endUserCertRef: string } | null;
  /** Import order, in this order: CPO import licence, then KDN approval of the papers, then shipping (Fauzan, 2 Nov 2026). */
  import?: {
    /** The exporter's country and its export licence. */
    country: string;
    exportLicenceRef: string | null;
    /** When the application went to the police, and in which district: approval time differs by district (answer 5). */
    district: string;
    appliedOn: IsoDate;
    cpo: { ref: string; on: IsoDate; endsOn: IsoDate } | null;
    kdn: { ref: string; on: IsoDate } | null;
    /** Port Klang or KLIA only (answer 4). */
    port: 'PORT_KLANG' | 'KLIA' | null;
    customsToldOn: IsoDate | null;
    shippedOn: IsoDate | null;
    arrivedOn: IsoDate | null;
    declaredOn: IsoDate | null;
    /** The endorsed import licence goes back to the OCPD within 3 days after its term (Arms Act s.15). */
    endorsedReturnedOn: IsoDate | null;
  } | null;
}

export interface Firearm {
  id: Id;
  companyId: Id;
  vaultId: Id;
  /** Internal reference painted or tagged on the firearm. */
  tag: string;
  kind: 'Shotgun' | 'Revolver' | 'Pistol';
  /** Serial number masked to the last digits; the full number is in the restricted register. */
  serialMasked: string;
  /**
   * The full serial number (Fauzan, 27 Oct 2026). Restricted: only Arms Control sees it, on the firearm form; every
   * screen and report shows serialMasked. Set once; a wrong serial is corrected by the Arms Control Manager, never typed over.
   */
  serial?: string;
  /** The RFID tag fixed to the firearm (EPC code), scanned at every issue and return (rule ARMS-RFID). Null: not tagged yet. */
  rfidTag?: string | null;
  status: FirearmStatus;
  /** Licence under the Arms Act 1960, held by the company's nominated person; expires 30 June (s.4). */
  licenceRef: string;
  licenceExpiresOn: IsoDate | null;
  /** Next armourer service; null means no service record, shown as unknown. */
  serviceDueOn?: IsoDate | null;
  /**
   * OPERATIONAL (default) is the company's own firearm for armed posts. TRADE is dealer stock
   * held for sale under an arms dealer licence: registered apart and never issued to a guard.
   */
  ownership?: 'OPERATIONAL' | 'TRADE';
  /** When the firearm was found missing. Starts the 14-day police report clock (Arms Act s.7(1)). */
  missingSince?: IsoDateTime | null;
  /** Police report made for a missing firearm. */
  policeReport?: { ref: string; on: IsoDate } | null;
  /** Deposited at a police station after the licence expired or was revoked (Arms Act s.27(1)). */
  depositedWithPolice?: { station: string; on: IsoDate; receiptRef?: string; by?: string } | null;
  /** Calibre, so rounds issued and returned move the vault's ammunition ledger (slice 4B). */
  calibre?: string | null;
  /** Found again after being reported missing: who checked it and when (slice 4B). */
  found?: { at: IsoDateTime; by: string; checkedBy: string; note: string } | null;
  /** Off the register: sold under the dealer licence, disposed of, or transferred to another company (slices 4C, 4H). */
  offRegister?: { reason: 'SOLD' | 'DISPOSED' | 'TRANSFERRED'; ref: string; on: IsoDate } | null;
}

/** One issue from the vault and its return. */
export interface ArmsMovement {
  id: Id;
  companyId: Id;
  firearmId: Id;
  vaultId: Id;
  personId: Id;
  siteId: Id;
  shiftId: Id | null;
  rounds: number;
  issuedAt: IsoDateTime;
  issuedBy: string;
  issueWitness: string;
  dueBack: IsoDateTime;
  returnedAt: IsoDateTime | null;
  returnedTo: string | null;
  returnWitness: string | null;
  roundsReturned: number | null;
  caseRef: string | null;
  /** How the firearm was identified at issue and return: its RFID tag scanned, or picked by hand (rule ARMS-RFID). */
  issueCheck?: 'rfid' | 'manual';
  returnCheck?: 'rfid' | 'manual' | null;
}

// ---------- SOCSO claims (Fauzan, 26 Oct 2026) ----------

export type SocsoCaseType = 'WORK_ACCIDENT' | 'COMMUTING' | 'EMERGENCY' | 'OCCUPATIONAL_DISEASE' | 'NON_WORK_ACCIDENT' | 'INVALIDITY' | 'DEATH';
export type SocsoStatus = 'DRAFT' | 'REPORTED' | 'DOCS_COMPLETE' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'APPEAL' | 'CLOSED';

/**
 * A SOCSO (PERKESO) claim for one staff member, started from their profile (SOCSO Claims SOP, 26 Oct 2026). HR
 * submits Form 34 in PERKESO's ASSIST portal by hand and records the reference here; there is no PERKESO API.
 */
export interface SocsoClaim {
  id: Id;
  companyId: Id;
  personId: Id;
  type: SocsoCaseType;
  status: SocsoStatus;
  /** When it happened, and when the company was told: the 48-hour clock for Form 34 starts at toldAt. */
  incidentAt: IsoDateTime;
  toldAt: IsoDateTime;
  place: string;
  description: string;
  witnesses: string;
  /** The incident case this claim belongs to, if any. */
  caseId: Id | null;
  openedBy: string;
  openedAt: IsoDateTime;
  perkesoRef: string | null;
  reportedAt: IsoDateTime | null;
  /** Documents on the checklist: item id to document ids in evidenceDocs. */
  docs: { item: string; docIds: Id[]; by: string; at: IsoDateTime }[];
  /** A required document missing, with the reason HR went ahead without it. */
  overrides: { item: string; reason: string; by: string; at: IsoDateTime }[];
  /** Medical certificates: the days off. */
  mcs: { from: IsoDate; to: IsoDate; docId: Id | null }[];
  decision: { outcome: 'APPROVED' | 'REJECTED'; on: IsoDate; note: string; by: string } | null;
  amountPaid: number | null;
  returnToWork: IsoDate | null;
  closedAt: IsoDateTime | null;
  /** `medical` entries are shown in full to HR only. */
  history: { at: IsoDateTime; by: string; what: string; medical?: boolean }[];
  /** Rehabilitation and return to work (SOCSO Claims SOP, rehabilitation section, 26 Oct 2026). */
  rehab?: SocsoRehab;
}

/** What a work restriction keeps the person from, until HR clears it. NO_DUTY: no shifts at all. */
export type SocsoRestrictionKind = 'NO_DUTY' | 'NO_PATROL' | 'NO_ARMED' | 'NO_NIGHT';

export interface SocsoRestriction {
  id: Id;
  kind: SocsoRestrictionKind;
  note: string;
  from: IsoDate;
  /** Last day, if the doctor gave one; it still holds until HR clears it. */
  until: IsoDate | null;
  setBy: string;
  setAt: IsoDateTime;
  clearedBy: string | null;
  clearedAt: IsoDateTime | null;
  clearNote: string | null;
}

export interface SocsoRehab {
  /** HR asked PERKESO for the Return to Work programme, and the date PERKESO referred the person. */
  rtwRequestedOn: IsoDate | null;
  referralOn: IsoDate | null;
  caseManager: { name: string; phone: string } | null;
  plan: string;
  targetReturn: IsoDate | null;
  appointments: { id: Id; at: IsoDateTime; what: string; by: string }[];
  restrictions: SocsoRestriction[];
  /** The officer's weekly call while the person is off, and for the first month back. */
  checkIns: { at: IsoDateTime; by: string; note: string }[];
}

// ---------- Foreign Worker Management (Fauzan, 26 Oct 2026) ----------

/** The foreign-worker papers FWM renews and the reminder ladder follows. */
export type FwPaper = 'PLKS_PERMIT' | 'PASSPORT' | 'FOMEMA' | 'FW_INSURANCE';

/** FWM submitted the renewal and holds the receipt: the reminder ladder pauses for that paper. */
export interface FwRenewal {
  id: Id;
  companyId: Id;
  personId: Id;
  paper: FwPaper;
  /** The expiry this submission answers; a new expiry date starts the ladder again. */
  expiresOn: IsoDate;
  submittedOn: IsoDate;
  /** Where it was submitted: FWCMS, eSIMS, JIM counter, FOMEMA, insurer. */
  channel: string;
  receiptDocIds: Id[];
  note: string;
  by: string;
  at: IsoDateTime;
}

/** Errands FWM asks the OM to get done with the guard (Fauzan, 26 Oct 2026). */
export type FwmTaskKind = 'FOMEMA' | 'JIM' | 'TNG' | 'BIOMETRIC' | 'UTILITY_CLAUSE' | 'OTHER';

/** FWM sends a dated task to the OM; the OM sends the guard and uploads proof; FWM accepts or sends it back. */
export interface FwmTask {
  id: Id;
  companyId: Id;
  personId: Id;
  kind: FwmTaskKind;
  what: string;
  place: string;
  dueOn: IsoDate;
  /** The Operations Manager of the guard's area, when one is set up. */
  omUserId: Id | null;
  createdBy: string;
  /** Who in FWM sent it (newer tasks), so they are told when the COO checks it in FWM's place. */
  createdById?: Id;
  createdAt: IsoDateTime;
  status: 'open' | 'done' | 'accepted' | 'returned';
  proofIds: Id[];
  doneNote: string | null;
  doneBy: string | null;
  /** Who reported it done (newer tasks), so nobody checks their own work by id, not by name. */
  doneById?: Id;
  doneAt: IsoDateTime | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: IsoDateTime | null;
  /** The COO's accepts and returns in place of FWM, for the FWM Manager and Deputy (Fauzan, 31 Oct 2026). */
  cooNotices?: CooNotice[];
}

// ---------- Responsible recruitment and worker welfare (masterplan §240, Fauzan 3 Nov 2026) ----------

/**
 * The checks FWM runs on each foreign worker: what they paid to get the job (asked once, privately, on arrival), where
 * their passport is, and how they are. Fauzan approved building every remaining masterplan item on 3 Nov 2026.
 */
export type FwCheckKind = 'ARRIVAL_FEE' | 'PASSPORT' | 'WELFARE';

/** What a worker raised in a welfare check. */
export type FwConcern = 'PAY' | 'HOURS' | 'HOUSING' | 'TREATMENT' | 'FEES' | 'DOCUMENTS' | 'HEALTH' | 'OTHER';

export interface FwWelfareCheck {
  id: Id;
  companyId: Id;
  personId: Id;
  kind: FwCheckKind;
  checkedOn: IsoDate;
  /** Arrival fee check: the recruiting agency, whether the worker paid anyone, how much (RM) and to whom. */
  agency?: string;
  paidAnything?: boolean;
  amount?: number | null;
  paidTo?: string;
  /** Passport check: who holds it. Company safekeeping needs the worker's signed consent. */
  heldBy?: 'worker' | 'company';
  /** Welfare check: what the worker raised; none means all well. */
  concerns?: FwConcern[];
  /** FWM's note. Confidential: FWM and the group leaders only, never the company or the OM. */
  note: string;
  docIds: Id[];
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** 'clear': nothing to follow up. 'open': a fee found, a passport held without consent, or a concern raised. */
  status: 'clear' | 'open' | 'closed';
  /** Arrival fee follow-up: what the agency paid back to the worker (RM). */
  repaid?: number | null;
  closeNote: string | null;
  closedBy: string | null;
  closedById: Id | null;
  closedAt: IsoDateTime | null;
  closeDocIds?: Id[];
  /**
   * Passport follow-ups only: how custody ended (Arisha main review, 3 Nov 2026). 'worker' = given back to the worker
   * (their signed receipt attached); 'company' = the worker signed consent for company safekeeping.
   */
  custodyAfter?: 'worker' | 'company';
}

// ---------- Staff clock (Fauzan, 26 Oct 2026) ----------

export type StaffClockFlag =
  /** No location from the phone at the clock. */
  | 'NO_GPS'
  /** Clocked more than the allowed distance from the staff member's base. */
  | 'AWAY_FROM_BASE'
  | 'FACE_NOT_MATCHED'
  | 'NO_LIVENESS'
  /** No face enrolled: the time-stamped photo is the record, for the manager to look at. */
  | 'PHOTO_ONLY'
  /** The phone's clock differs from the server's by more than the allowed minutes. */
  | 'PHONE_TIME_OFF'
  /** Never signed out: closed at the last office door exit that day, or at 23:59 when the door has no exit. HR confirms the hours. */
  | 'NO_SIGN_OUT'
  /** Signed out more than the allowed minutes after the office door last recorded them leaving (Fauzan, 27 Oct 2026). */
  | 'LEFT_BEFORE_SIGN_OUT'
  /** Clocked in at sign-in; the face check has not been done yet (Fauzan, 2 Nov 2026). */
  | 'FACE_PENDING';

/**
 * One office door reading from the access-control system, monitored by CMS (Fauzan, 27 Oct 2026). Used to check the
 * staff clock against when the person actually left the office.
 */
export interface DoorEvent {
  id: Id;
  userId: Id;
  userName: string;
  companyId: Id | null;
  door: string;
  direction: 'in' | 'out';
  at: IsoDateTime;
  receivedAt: IsoDateTime;
}

/** The photo taken at a staff clock-in or clock-out, with its burned-in time and GPS stamp. */
export interface StaffClockShot {
  /** Stamped JPEG as a data URL. Production keeps the file in Malaysian object storage instead. */
  image: string;
  sha256: string;
  capturedAt: IsoDateTime;
  receivedAt: IsoDateTime;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  /** Metres from the base, when the staff member has one and the phone gave a location. */
  distanceM: number | null;
  face: FaceCapture | null;
  /** 'login': taken automatically when the staff member signed in or out (no photo). */
  source: 'in_app_camera' | 'test_picture' | 'login' | 'door';
}

/**
 * Every staff member's own clock-in and clock-out on their phone, with face or a time-stamped photo and the
 * location (Fauzan, 26 Oct 2026). Guards keep clocking in on the site device. The location is followed only from
 * clock-in to clock-out.
 */
export interface StaffClock {
  id: Id;
  userId: Id;
  userName: string;
  /** The company the staff member works for; null for PWVSB central staff. */
  companyId: Id | null;
  in: StaffClockShot;
  out: StaffClockShot | null;
  flags: StaffClockFlag[];
  /** Last location received while clocked in (server time). */
  lastPingAt: IsoDateTime | null;
  pings: number;
  /**
   * 'login' (Fauzan, 27 Oct 2026): starts when the staff member signs in and ends when they sign out, whether the
   * laptop or PC is in use, idle or asleep. 'photo': the earlier phone clock with face or a stamped photo.
   */
  mode?: 'login' | 'photo';
  /** The face check after a sign-in clock in (Fauzan, 2 Nov 2026), with the photo kept for HR to spot-check. */
  faceCheck?: StaffClockShot | null;
}

/** One location reading while a staff member is clocked in. None is accepted outside working hours. */
export interface LocationPing {
  id: Id;
  clockId: Id;
  userId: Id;
  companyId: Id | null;
  capturedAt: IsoDateTime;
  receivedAt: IsoDateTime;
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** Metres from the base, when there is one. */
  distanceM: number | null;
}

// ---------- Working from home (Fauzan, 27 Oct 2026) ----------

/**
 * A staff member's working from home arrangement: a flexible working arrangement applied for in writing and answered
 * in writing within 60 days (Employment Act 1955 s.60P). Office-based staff only; field roles work on site.
 */
export interface RemoteArrangement {
  id: Id;
  userId: Id;
  userName: string;
  /** The company the staff member works for; null for PWVSB central staff. */
  companyId: Id | null;
  /** Weekdays worked from home: 1 Monday to 5 Friday. */
  days: number[];
  from: IsoDate;
  /** Last day; null while it runs until ended. */
  to: IsoDate | null;
  reason: string;
  /** Where the staff member works from. Checked once at the start of each home day, never followed. */
  place: { label: string; lat: number; lng: number; radiusM: number };
  /** When the staff member read and accepted the notice of what is recorded on home days (PDPA notice). */
  noticeAt: IsoDateTime;
  appliedAt: IsoDateTime;
  /** The written answer is due by this day (60 days from the application). */
  answerBy: IsoDate;
  status: 'applied' | 'approved' | 'refused' | 'ended';
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  /** The written answer; required for a refusal and when a manager ends an arrangement. */
  decisionNote: string;
  endedBy?: string;
  endedAt?: IsoDateTime;
  endNote?: string;
}

export interface RemoteTask {
  id: Id;
  text: string;
  status: 'planned' | 'done' | 'carried';
  /** What came out of it: a file name, a record number or a sentence. */
  output: string;
}

/** One scheduled check-in on a home day. */
export interface RemoteCheckIn {
  /** Due time, HH:MM Malaysia time. */
  due: string;
  at: IsoDateTime | null;
  note: string;
}

/**
 * One day worked from home: the morning plan, the check-ins, the end-of-day report and the manager's review. Work is
 * judged by what is planned and delivered, not by watching the screen.
 */
export interface RemoteDay {
  id: Id;
  userId: Id;
  userName: string;
  companyId: Id | null;
  date: IsoDate;
  arrangementId: Id;
  plan: { at: IsoDateTime; tasks: RemoteTask[] } | null;
  checkIns: RemoteCheckIn[];
  report: { at: IsoDateTime; summary: string; blockers: string } | null;
  review: { by: string; at: IsoDateTime; verdict: 'accepted' | 'queried'; note: string } | null;
  /** The one location check at the start of the day: whether the device was at the approved place. */
  start: { at: IsoDateTime; distanceM: number; atPlace: boolean } | null;
}

// ---------- Remote and branch work plan (Fauzan, 27 Oct 2026) ----------

/** Where a task is also kept in Microsoft Planner (P1: in both for now, Planner preferred). */
export interface PlannerLink {
  planId: string;
  /** Planner's own task id once the task has been sent; null while it waits in the outbox. */
  taskId: string | null;
  state: 'pending' | 'synced' | 'error';
  syncedAt: IsoDateTime | null;
  /** The last change seen from Planner, so the newer side wins. */
  plannerChangedAt: IsoDateTime | null;
  error: string;
}

/**
 * A piece of work with a definition of done. It comes from the role playbook, from the manager, from a meeting, or
 * the person adds it. It is finished only with proof of the output, and the manager accepts or returns it.
 */
export interface WorkTask {
  id: Id;
  /** The person who does the task. */
  userId: Id;
  userName: string;
  companyId: Id | null;
  title: string;
  /** What "done" means: the output the manager will check. */
  doneMeans: string;
  /** 'ceo': a CEO instruction, tracked to done (Central Admin 5E, Fauzan 2 Nov 2026). */
  source: 'playbook' | 'assigned' | 'meeting' | 'own' | 'ceo';
  playbookItemId: string | null;
  /** For playbook duties: the day, week (Monday) or month the duty belongs to. */
  period: string | null;
  assignedBy: string | null;
  assignedById: Id | null;
  createdAt: IsoDateTime;
  dueAt: IsoDateTime;
  priority: 'high' | 'normal';
  status: 'open' | 'done' | 'returned' | 'accepted';
  evidence: { at: IsoDateTime; note: string; ref: string } | null;
  /** Asked for more time before the due time, with the reason. */
  late: { at: IsoDateTime; reason: string; newDueAt: IsoDateTime } | null;
  review: { by: string; at: IsoDateTime; verdict: 'accepted' | 'returned'; note: string } | null;
  planner: PlannerLink | null;
  /** The COO's accepts and returns in place of the line manager, for the person told (Fauzan, 31 Oct 2026). */
  cooNotices?: CooNotice[];
  /**
   * The manager moved or readjusted this task (Fauzan, 2 Nov 2026), oldest first, each with a reason. A move to
   * another person starts their time from the move; adviceId names Arisha's advice the manager followed, if any.
   */
  changes?: WorkTaskChange[];
}

export interface WorkTaskChange {
  at: IsoDateTime;
  by: string;
  byId: Id;
  kind: 'reassign' | 'adjust';
  fromUserId: Id;
  fromName: string;
  toUserId: Id;
  toName: string;
  dueFrom: IsoDateTime;
  dueTo: IsoDateTime;
  priorityFrom: 'high' | 'normal';
  priorityTo: 'high' | 'normal';
  reason: string;
  adviceId: string | null;
}

/** The morning check-in (D2): hours, top 3 priorities and any support needed. On a home day it fills the day plan. */
export interface WorkCheckIn {
  id: Id;
  userId: Id;
  userName: string;
  companyId: Id | null;
  date: IsoDate;
  at: IsoDateTime;
  where: 'office' | 'home' | 'branch' | 'field';
  hours: string;
  priorities: string[];
  support: string;
}

/** "Stuck, need help" (D3): goes to the line manager; unanswered after 30 minutes it shows to the manager's manager. */
export interface HelpRequest {
  id: Id;
  userId: Id;
  userName: string;
  companyId: Id | null;
  at: IsoDateTime;
  taskId: Id | null;
  text: string;
  managerId: Id | null;
  answer: { by: string; at: IsoDateTime; text: string } | null;
}

/** A weekly one-to-one between a manager and a team member (D3), with what was agreed. */
export interface OneOnOne {
  id: Id;
  userId: Id;
  userName: string;
  companyId: Id | null;
  managerId: Id;
  managerName: string;
  date: IsoDate;
  notes: string;
  agreed: string[];
}

/** The line manager (or HR) confirms the person knows their playbook (D5, before working from home). */
export interface PlaybookSignoff {
  id: Id;
  userId: Id;
  companyId: Id | null;
  key: string;
  by: string;
  at: IsoDateTime;
}

/** Proof attached to a branch record: a stamped photo from the in-app camera (hash kept, not the image in the list). */
export interface WorkProof {
  sha256: string;
  capturedAt: IsoDateTime;
  receivedAt: IsoDateTime;
  lat: number | null;
  lng: number | null;
}

/** A far-branch checklist (D8): daily by 10:00, weekly by Friday, monthly by the 25th, each with photo proof. */
export interface BranchCheck {
  id: Id;
  branchId: Id;
  companyId: Id;
  kind: 'daily' | 'weekly' | 'monthly';
  period: string;
  by: string;
  at: IsoDateTime;
  items: { key: string; label: string; ok: boolean; note: string }[];
  proof: WorkProof | null;
}

/**
 * A visit or check on a far branch (D7, D9): OM twice a month, Regional OM monthly, ACT one unannounced audit per
 * half year, and up to 2 random CMS or company manager video spot checks a month.
 */
export interface BranchVisit {
  id: Id;
  branchId: Id;
  companyId: Id;
  kind: 'om' | 'rom' | 'act' | 'spot';
  announced: boolean;
  by: string;
  byId: Id;
  at: IsoDateTime;
  result: 'ok' | 'issues';
  findings: string;
  proof: WorkProof | null;
}

// ---------- Tenders and quotations ----------

/** Government tenders are tracked by the Director Office Administrator; private ones by the COO / Private Sector team (V3, V12). */
export type TenderChannel = 'GOVERNMENT' | 'PRIVATE';
export type TenderStatus = 'open' | 'preparing' | 'submitted' | 'won' | 'lost' | 'no_bid';

/** A tender this licensed company may bid for. The bid is always in the company's own name. */
export interface Tender {
  id: Id;
  companyId: Id;
  ref: string;
  title: string;
  buyer: string;
  channel: TenderChannel;
  /** Where the notice came from, e.g. MyProcurement, ePerolehan, client invitation, branch lead. */
  source: string;
  /** Who leads the pursuit for the company. */
  owner: string;
  closesOn: IsoDate;
  guards: number;
  sites: number;
  status: TenderStatus;
  /** Estimated contract value per month in RM, if known. */
  estMonthly: number | null;
  /** The work needs armed guards (bank, CIT, cash, close protection); Arms Control follows these. */
  armed?: boolean;
  /** GUARDING (default) is a security service bid; ARMS_SUPPLY is a bid to supply arms-related items under a dealer licence. */
  kind?: 'GUARDING' | 'ARMS_SUPPLY';
  /** Steps of the tender protocol and checklist items done on this tender (Fauzan, 25 Oct 2026). */
  protocolDone?: TenderStepDone[];
  /** Tender papers uploaded: notice, arahan petender, specification, forms. */
  papers?: TenderPaper[];
  /** The files the bid must carry, each under the name the tender asks for. */
  bidFiles?: TenderBidFile[];
  /** What to do on this tender, drafted by the AI agent from the papers or added by the Director Office. */
  checklist?: TenderCheckItem[];
  /** The Director Office Administrator checked the drafted checklist. */
  checklistReview?: { by: string; at: IsoDateTime; note: string; reader: string } | null;
  /** Checks before the bid is lodged: the company's manager, a second manager, then the CEO. */
  verifications?: TenderVerification[];
  /** The bid was lodged; the submission slip is the proof. */
  submission?: { by: string; at: IsoDateTime; note: string; proofIds: Id[] } | null;
  /** Tender record and buyer's mandatory dates (Director Office guide V1.0 section 01 and data list, 11 Oct 2026). */
  record?: TenderRecord;
  /** Who does each protocol step or checklist item, and by when. */
  plan?: TenderStepPlan[];
  /** Teruskan / Tangguh / Tidak bida, with the reason (guide section 01). */
  decision?: TenderDecision | null;
  /** Questions and conflicts to refer to the buyer (guide: percanggahan dirujuk kepada pembeli). */
  queries?: TenderQuery[];
  /** A lead only: not confirmed as a live tender yet (data list, e.g. DBP). */
  leadOnly?: boolean;
  /** Part of a joint entry: several group companies enter the same tender (Fauzan, 26 Oct 2026). */
  groupId?: Id;
}

/**
 * Several group companies entering the same tender (Fauzan, 26 Oct 2026). The Director Office sets who enters and
 * collects the proof; each company bids in its own name and its manager verifies it with the submission slip. A
 * snapshot taken at the slip (steps, document names and the slip) is the Director Office's proof that it was sent.
 */
export interface TenderGroup {
  id: Id;
  ref: string;
  title: string;
  buyer: string;
  channel: TenderChannel;
  closesOn: IsoDate;
  createdBy: string;
  createdAt: IsoDateTime;
  entries: TenderGroupEntry[];
}
export interface TenderGroupEntry {
  companyId: Id;
  tenderId: Id;
  /** Taken when the submission slip is uploaded. */
  proof: {
    stepsDone: number;
    stepsTotal: number;
    naSteps: number;
    documents: string[];
    checks: TenderCheckLevel[];
    slip: { name: string; sha256: string; by: string; at: IsoDateTime } | null;
    submittedBy: string;
    submittedAt: IsoDateTime;
  } | null;
}

/** One line of a price schedule: RM a month and over the contract. */
export interface TenderPriceLine {
  item: string;
  monthly: number;
  months: number;
}

/** What the Director Office records about a tender, from the notice and official papers. Times are MYT. */
export interface TenderRecord {
  adOn?: IsoDate | null;
  officialLink?: string;
  /** Closing time, 'HH:MM' MYT. */
  closesAt?: string;
  briefing?: { on: IsoDate | null; mandatory: boolean; place: string; outcome: string } | null;
  siteVisit?: { on: IsoDate | null; mandatory: boolean; place: string; outcome: string } | null;
  /** Last day to register or buy the documents. */
  docsBy?: IsoDate | null;
  /** Last day for questions to the buyer. */
  queriesBy?: IsoDate | null;
  /** e.g. ePerolehan online, tender box by hand. */
  submissionMethod?: string;
  validityDays?: number | null;
  contractMonths?: number | null;
  contractStart?: IsoDate | null;
  contractEnd?: IsoDate | null;
  extension?: string;
  /** Indicative contract value for the whole term, RM. */
  indicativeTotal?: number | null;
  indicativeSource?: string;
  sstIncluded?: boolean | null;
  /** Unit the price schedule asks for, e.g. RM per guard per month. */
  priceUnit?: string;
  mofCodes?: string[];
  kdnArea?: string;
  bumiputeraOnly?: boolean | null;
  locality?: string;
  /** Guard posts manned at the same time, day and night, and the shift length in hours. */
  dayPosts?: number | null;
  nightPosts?: number | null;
  shiftHours?: number | null;
  fees?: string;
  priceLines?: TenderPriceLine[];
}

export interface TenderStepPlan {
  stepId: string;
  pic: string;
  due: IsoDate | null;
}

export type TenderDecisionChoice = 'TERUSKAN' | 'TANGGUH' | 'TIDAK_BIDA';

export interface TenderDecision {
  choice: TenderDecisionChoice;
  reason: string;
  by: string;
  at: IsoDateTime;
}

export interface TenderQuery {
  id: string;
  text: string;
  /** Page or clause of the papers. */
  ref: string;
  by: string;
  at: IsoDateTime;
  status: 'open' | 'sent' | 'answered';
  answer: string;
}

/**
 * A report companies or central departments must send to the Director Office, weekly or monthly (Fauzan,
 * 25 Oct 2026). The Director Office Administrator sets the list.
 */
export interface ReportDef {
  id: string;
  name: string;
  detail: string;
  from: 'company' | 'department';
  /** For a department report: which central department sends it. */
  department?: NonNullable<User['department']>;
  /** Recurring, or one time (Fauzan, 2 Nov 2026: "It can set it recurring or one time"). */
  frequency: ReportFrequency;
  /**
   * Weekly and every 2 weeks: day of the week it is due (1 Monday to 7 Sunday). Monthly: day of the next month.
   * Quarterly: day of the month after the quarter ends. Yearly and one time: not used (see dueOn).
   */
  dueDay: number;
  /** One time: the date it is due. Yearly: the date it is due each year (the month and day are used). */
  dueOn?: IsoDate | null;
  active: boolean;
  /** Monthly department report: the sections it must cover, set by the ACT Director (rule RPT-MONTHLY). */
  sections?: string[];
  /** The figures ACT compares with Prima's own records. */
  checks?: string[];
  formBy?: { by: string; at: IsoDateTime } | null;
}

export type ReportFrequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly' | 'once';

/** One report sent. Group-level record; a company's file stays behind its company wall in evidenceDocs. */
export interface ReportSubmission {
  id: Id;
  defId: string;
  /** '2026-W43' for a week, '2026-10' for a month. */
  period: string;
  companyId: Id | null;
  department: NonNullable<User['department']> | null;
  by: string;
  at: IsoDateTime;
  note: string;
  /** Company report: document ids in evidenceDocs. */
  docIds: Id[];
  /** Department report: the file itself (group-level, no company wall). */
  file?: { name: string; data: string } | null;
  /** The sections of the standard form the sender says the report covers. */
  sectionsCovered?: string[];
}

/**
 * A meeting anywhere in the group (Fauzan, 25 Oct 2026). The Director Office Administrator follows every meeting,
 * collects the minutes and their summary, and tracks the deadlines. A company's meeting stays behind its company wall;
 * a group meeting has no company.
 */
export interface Meeting {
  id: Id;
  companyId: Id | null;
  department: NonNullable<User['department']> | null;
  kind: 'board' | 'management' | 'operations' | 'department' | 'client' | 'toolbox' | 'other';
  title: string;
  /** Meetings set together as a repeating series (Fauzan, 2 Nov 2026: recurring or one time). */
  seriesId?: Id | null;
  repeat?: MeetingRepeat | null;
  organiser: string;
  start: IsoDateTime;
  end: IsoDateTime;
  location: string;
  attendees: string[];
  /** One agenda item per line. */
  agenda: string;
  /** Pre-briefing checklist (Fauzan, 27 Oct 2026); filled from rule MTG-PREP when the meeting is set. */
  prep?: { label: string; done: boolean; by: string | null; at: IsoDateTime | null }[];
  status: 'scheduled' | 'held' | 'cancelled';
  minutes: { text: string; by: string; at: IsoDateTime; file?: { name: string; data: string } | null } | null;
  /** Summary and action items drafted by the AI agent from the minutes; the Director Office checks it. */
  summary: {
    text: string;
    actions: { text: string; owner: string; due: IsoDate | null; done: boolean }[];
    reader: string;
    at: IsoDateTime;
    checkedBy: string | null;
    checkedAt: IsoDateTime | null;
  } | null;
}

export type MeetingRepeat = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly';

/** The eight tender folders of the Director Office data list (11 Oct 2026). */
/** Which part of the bid a file belongs to. The technical part must not show the company name (Fauzan, 28 Oct 2026). */
export type TenderBidPart = 'TEKNIKAL' | 'KEWANGAN' | 'HARGA' | 'LAIN';

/** A file the bid must carry, under the exact name the tender asks for (Fauzan, 28 Oct 2026, rule TENDER-FILES). */
export interface TenderBidFile {
  id: string;
  part: TenderBidPart;
  /** The file name the tender asks for, e.g. "Dokumen Teknikal.pdf". Never the company name. */
  required: string;
  docId: Id | null;
  by?: string;
  at?: IsoDateTime;
  /** What the app could read of the file: whether it read any text, and company names found (the file is refused when any). */
  scan?: { readText: boolean; where: string[] } | null;
  /** Technical files: the preparer checked every page, header, footer, stamp, letterhead and file properties. */
  confirmedBy?: string | null;
  confirmedAt?: IsoDateTime | null;
}

export type TenderPaperKind = 'IKLAN' | 'ARAHAN' | 'TEKNIKAL' | 'KEWANGAN' | 'HARGA' | 'TAKLIMAT' | 'PINDAAN' | 'PENGHANTARAN';

export interface TenderPaper {
  docId: Id;
  kind: TenderPaperKind;
  name: string;
  by: string;
  at: IsoDateTime;
}

export interface TenderCheckItem {
  id: string;
  label: string;
  detail: string;
  ref: string;
  source: 'ai' | 'doa';
  needsDocument: boolean;
}

/** Fauzan, 26 Oct 2026: the person who prepared the bid signs, then the company manager signs that all is verified. */
export type TenderCheckLevel = 'PREPARER' | 'MANAGER';

export interface TenderVerification {
  level: TenderCheckLevel;
  userId: Id;
  by: string;
  at: IsoDateTime;
  note: string;
}

/**
 * One step of the group tender protocol. The Director Office Administrator sets the protocol (Fauzan, 25 Oct 2026);
 * admin staff must finish every step before the tender moves to the status in 'before'.
 */
export interface TenderProtocolStep {
  id: string;
  label: string;
  detail: string;
  before: 'preparing' | 'submitted';
  /** The step is done only with a document attached (checklist, approval, letter). */
  needsDocument: boolean;
  /** Section of the guide, e.g. '02 Kelayakan & dokumen asas'. */
  section?: string;
  /** Number in the guide, e.g. '02.01'. */
  code?: string;
  /** Only the company manager may mark it done (04.09 price approved by management). */
  managerOnly?: boolean;
  /** Done by the app itself: the manager's signature or the submission slip (05.06 to 05.09). */
  auto?: 'MANAGER' | 'SLIP';
}

export interface TenderProtocol {
  id: 'tender';
  version: number;
  steps: TenderProtocolStep[];
  setBy: string;
  setAt: IsoDateTime;
  note: string;
  /** True until the Director Office loads the real protocol. */
  placeholder: boolean;
}

export interface TenderStepDone {
  stepId: string;
  version: number;
  by: string;
  at: IsoDateTime;
  note: string;
  proofIds: Id[];
  /** Selesai (done) or T/B, not applicable. T/B needs a reason and a reference, and a supervisor confirms it. */
  status?: 'done' | 'na';
  /** Page or clause of the papers the evidence or the T/B reason rests on. */
  ref?: string;
  naConfirmedBy?: string | null;
  naConfirmedAt?: IsoDateTime | null;
}

// ---------- Armed operations (Arms Control monitors, Fauzan 25 Oct 2026) ----------

export type ArmedJobKind = 'BODYGUARD' | 'CIT' | 'CDM' | 'CASH_VAULT';
export type ArmedJobStatus = 'scheduled' | 'in_progress' | 'completed' | 'delayed' | 'incident';

/** One armed job run by a licensed company: close protection, cash-in-transit, cash deposit machine service or cash vaulting. */
export interface ArmedJob {
  id: Id;
  companyId: Id;
  ref: string;
  kind: ArmedJobKind;
  client: string;
  /** Route, machines or location, without exact cash amounts. */
  detail: string;
  start: IsoDateTime;
  end: IsoDateTime;
  crew: Id[];
  firearmIds: Id[];
  vehicle: string | null;
  status: ArmedJobStatus;
  lastUpdate: string;
  lastUpdateAt: IsoDateTime;
  /** States the job passes through. Leaving the home state needs police approval (Fauzan, 25 Oct 2026). */
  states?: string[];
  /** Police approval when the job takes arms out of the home state (Fauzan, 25 Oct 2026). */
  policeApproval?: PoliceRef | null;
}

/** A police notice or approval: its reference and date. */
export interface PoliceRef {
  ref: string;
  on: IsoDate;
}

/** A supplier of firearms, ammunition, servicing or equipment. Arms Control deals with suppliers for the group. */
export interface ArmsSupplier {
  id: Id;
  name: string;
  supplies: ('Firearms' | 'Ammunition' | 'Servicing' | 'Equipment')[];
  /** The supplier's own dealer or service licence. null means no copy on file, shown as unknown. */
  licenceRef: string | null;
  licenceExpiresOn: IsoDate | null;
  contact: string;
  lastOrderOn: IsoDate | null;
  /**
   * The supplier file (slice 4C; Fauzan, 2 Nov 2026: "store all supplier data on arms trading, its connection,
   * agreement or letter"; many suppliers are foreign). All optional, so older rows still read.
   */
  country?: string | null;
  /** Company registration number in its own country. */
  registrationNo?: string | null;
  /** The local agent or importer for a foreign supplier. */
  localAgent?: string | null;
  /** Price currency, e.g. MYR, USD, EUR. */
  currency?: string | null;
  people?: { name: string; role: string; phone: string; email: string }[];
  /** Which group companies deal with it, and how. */
  links?: { companyId: Id; relation: string; since: IsoDate | null }[];
  papers?: SupplierPaper[];
}

/** An agreement, letter or permit in the supplier file, with its file. */
export interface SupplierPaper {
  id: Id;
  kind: 'AGREEMENT' | 'LETTER' | 'QUOTATION' | 'DEALER_LICENCE' | 'EXPORT_LICENCE' | 'END_USER_CERT' | 'IMPORT_PERMIT' | 'OTHER';
  title: string;
  ref: string | null;
  on: IsoDate;
  expiresOn: IsoDate | null;
  /** The uploaded file (evidence document), when attached. */
  docId: Id | null;
  by: string;
  at: IsoDateTime;
}

/** One item a supplier we have engaged offers, with its spec and price (Fauzan, 25 Oct 2026). */
export interface SupplierItem {
  id: Id;
  supplierId: Id;
  category: 'Firearm' | 'Ammunition' | 'Servicing' | 'Equipment';
  name: string;
  spec: string;
  unit: string;
  /** RM per unit, before tax. */
  unitPrice: number;
  priceValidUntil: IsoDate | null;
  leadTimeDays: number | null;
  minOrder: number | null;
}

/**
 * An arms dealer licence (buying and selling arms) held by a licensed security company.
 * Fauzan, 25 Oct 2026: three companies will hold one, and keep trade stock in their own vault.
 */
export interface DealerLicence {
  id: Id;
  companyId: Id;
  status: 'planned' | 'applied' | 'approved' | 'refused' | 'expired';
  reference: string | null;
  appliedOn: IsoDate | null;
  expiresOn: IsoDate | null;
  note: string;
}

/** A day or night watch on one vault, monitored from CMS control. */
export interface VaultWatch {
  id: Id;
  companyId: Id;
  vaultId: Id;
  date: IsoDate;
  shift: 'day' | 'night';
  start: IsoDateTime;
  end: IsoDateTime;
  watcher: string | null;
  clockIn: IsoDateTime | null;
  /** Last check-in seen by CMS (call, camera or tag at the vault door). */
  lastCheckAt: IsoDateTime | null;
  /** Each check-in, newest last (slice 4B, last 48 kept). */
  checks?: { at: IsoDateTime; by: string; how: 'call' | 'camera' | 'tag' }[];
}

/** The two CMS posts. Every shift has at least one Head Control and one Monitor Officer (Fauzan, 25 Oct 2026). */
export type CmsPost = 'HEAD_CONTROL' | 'MONITOR_OFFICER';

/** One seat on a CMS command centre shift. CMS staff work for PWVSB, not for a licensed company. */
export interface CmsShift {
  id: Id;
  date: IsoDate;
  start: IsoDateTime;
  end: IsoDateTime;
  post: CmsPost;
  /** 1 for the first seat of this post on the shift, 2 for the second, and so on. */
  seat: number;
  staffName: string | null;
  /** null means not yet clocked in. */
  clockIn: IsoDateTime | null;
  /** Set when the CMS settings change and this seat is no longer part of the pattern. */
  cancelled?: boolean;
  /** Head Control only: when the handover from the previous shift was taken, and what is still open. */
  handoverAt?: IsoDateTime | null;
  handoverNote?: string | null;
}

/** A person who works in the CMS command centre, and the posts they may fill. */
export interface CmsStaff {
  id: Id;
  name: string;
  posts: CmsPost[];
  /** IP phone extension at the CMS console. */
  ext: string;
  active: boolean;
}

/** CMS parameters, set by Arms Control (Fauzan, 25 Oct 2026). One record for the whole group. */
export interface CmsSettings {
  id: 'cms';
  /** Two 12-hour shifts or three 8-hour shifts a day. */
  shiftPattern: '2x12' | '3x8';
  /** When the first shift of the day starts, HH:MM Malaysia time. */
  firstShiftStart: string;
  headControlPerShift: number;
  monitorOfficersPerShift: number;
  /** Minutes after shift start before a seat with nobody clocked in counts as a no-show. */
  clockInGraceMin: number;
  /** Minutes after shift start by which Head Control must take the handover. */
  handoverWithinMin: number;
  /** How often each vault watch must check in with CMS. */
  vaultWatchCheckMin: number;
  /** Seconds a company extension rings before the phone system forwards the call to CMS. */
  forwardAfterSec: number;
  /** CMS should answer a forwarded call within this many seconds. */
  answerTargetSec: number;
  /** A forwarded call nobody answered must be called back within this many minutes. */
  callbackWithinMin: number;
  /** CMS must acknowledge a panic, SOS, intrusion or fire alarm within this many seconds. */
  alarmAckSec: number;
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

/** A company IP phone extension. Unanswered calls forward to CMS, the group's phone focal point (Fauzan, 25 Oct 2026). */
export interface PhoneExtension {
  id: Id;
  companyId: Id;
  ext: string;
  label: string;
  forwardToCms: boolean;
  /** Ring time set in the phone system before forwarding; null when not read from the phone system. */
  forwardAfterSec: number | null;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: IsoDateTime | null;
}

/**
 * A site system CMS is linked to: the client's or company's CCTV recorder, or an alarm panel.
 * Video stays in the site's own recorder; CMS reads its health and events only (V13 s.4).
 */
export interface SiteSystem {
  id: Id;
  companyId: Id;
  siteId: Id;
  kind: 'CCTV' | 'ALARM_PANEL';
  name: string;
  /** False until the link to CMS has been set up and tested at the site (V13: LIVE only once tested). */
  linked: boolean;
  status: 'online' | 'offline' | 'not_recording' | 'unknown';
  cameras: number | null;
  camerasOnline: number | null;
  lastHeartbeatAt: IsoDateTime | null;
  /**
   * What the CMS app observed, in time order whatever order it arrived in: runs of up or down observations (status
   * snapshots, DEVICE_ONLINE/OFFLINE edges, events from the device). Time no observation speaks for is Unknown.
   */
  observed?: { state: 'up' | 'down'; from: IsoDateTime; last: IsoDateTime }[];
}

/** An emergency or alarm event at a site that reaches CMS: guard SOS, panic button, intrusion, fire, camera tamper. */
export interface SiteAlarm {
  id: Id;
  companyId: Id;
  siteId: Id;
  kind: 'GUARD_SOS' | 'PANIC' | 'INTRUSION' | 'FIRE' | 'CAMERA_TAMPER' | 'LINK_LOST' | 'CMS_EVENT';
  /** From the CMS Command Centre app (slice 4E): its event kind, its event id (so a resent event never counts twice) and its summary. */
  cmsKind?: string | null;
  cmsEventId?: string | null;
  /** The CMS app's alarm this row was closed under: one case per alarm, however many events and resends. */
  cmsAlarmId?: string | null;
  summary?: string | null;
  source: string;
  at: IsoDateTime;
  status: 'new' | 'acknowledged' | 'closed';
  ackAt: IsoDateTime | null;
  ackBy: string | null;
  /** The operator's verdict after checking: a real event (an incident case is opened) or a false alarm. */
  verdict: 'real' | 'false' | null;
  caseId: Id | null;
  note: string | null;
  closedBy?: string | null;
  /** Head Control, a second person, reviews every false alarm (insider abuse audit, 27 Oct 2026). */
  falseReview?: { by: string; at: IsoDateTime; agree: boolean; note: string } | null;
}

/** A call to a company extension, from the phone system's call records. */
export interface PhoneCall {
  id: Id;
  companyId: Id;
  extensionId: Id;
  /** Caller number, partly hidden. */
  caller: string;
  at: IsoDateTime;
  outcome: 'answered' | 'forwarded_answered' | 'forwarded_missed';
  answeredBy: string | null;
  /** Seconds from ringing to answer, at the extension or at CMS. */
  answerSec: number | null;
  callbackAt: IsoDateTime | null;
  callbackBy: string | null;
  note: string | null;
}

export type QuotationStatus = 'draft' | 'awaiting_approval' | 'returned' | 'approved' | 'sent' | 'accepted' | 'rejected';

/** A price offer to a client. The admin team prepares it; the Company Manager approves it (maker-checker). */
export interface Quotation {
  id: Id;
  companyId: Id;
  ref: string;
  client: string;
  siteName: string;
  tenderId: Id | null;
  guards: number;
  hoursPerDay: 8 | 12;
  /** RM per guard per month. */
  ratePerGuard: number;
  /** RM per month for the whole quotation. */
  monthlyTotal: number;
  validUntil: IsoDate;
  status: QuotationStatus;
  preparedBy: string;
  preparedById: Id;
  preparedAt: IsoDateTime;
  approvedBy: string | null;
  approvedAt: IsoDateTime | null;
  note: string;
}

/**
 * A sales lead before any quotation or tender (V3 CRM). The company researches the prospect (SSM, payment record,
 * current provider, risks) and surveys the site before it proposes a price. A lead also open at another group company
 * is shown as a conflict, so two of our companies do not chase the same client unknowingly.
 */
export interface SalesLead {
  id: Id;
  companyId: Id;
  ref: string;
  prospect: string;
  sector: 'GOVERNMENT' | 'BANK' | 'INDUSTRIAL' | 'COMMERCIAL' | 'RESIDENTIAL' | 'EDUCATION' | 'HEALTH' | 'OTHER';
  /** Where the lead came from: referral, walk-in, branch, website, existing client. */
  source: string;
  owner: string;
  createdAt: IsoDateTime;
  guardsEst: number;
  estMonthly: number | null;
  stage: 'new' | 'researched' | 'surveyed' | 'proposal' | 'won' | 'lost' | 'dropped';
  research: {
    ssmRegNo: string;
    ssmActive: boolean;
    ssmCheckedOn: IsoDate;
    payment: 'good' | 'slow' | 'unknown';
    currentProvider: string;
    risks: string;
    armed: boolean;
    by: string;
    at: IsoDateTime;
  } | null;
  survey: { on: IsoDate; by: string; guardsNeeded: number; hoursPerDay: 8 | 12; note: string } | null;
  /** The manager accepted a slow or unknown payment record before the proposal. */
  riskAcceptedBy: string | null;
  quotationId: Id | null;
  /** Masterplan 147: the branch that originated the lead; contracting stays with the licensed company. */
  branchId?: Id | null;
  nextAction: { on: IsoDate; what: string } | null;
  notes: { at: IsoDateTime; by: string; text: string }[];
  closed: { on: IsoDate; by: string; reason: string } | null;
}

/**
 * 'guard' is a guard's own sign-in (Fauzan, 25 Oct 2026): view only, and only their own details, shift reminders,
 * roster, clock-in and clock-out record and patrol rounds. It never opens any company screen.
 */
export type UserRole = 'director' | 'pwvsb_officer' | 'company_manager' | 'admin_exec' | 'supervisor' | 'site_device' | 'guard';

export interface User {
  id: Id;
  name: string;
  title: string;
  role: UserRole;
  /**
   * The Microsoft Entra object ID of this person's Microsoft 365 account, recorded by IT. Microsoft sign-in opens
   * Prima only for a linked account; the link is by this ID, never by name or email.
   */
  entraOid?: string;
  /**
   * Offboarding (pre-publication review R3, 31 Oct 2026): the first day this account is refused. Set by HR when a
   * leaver's last day is recorded (the day after it), or by HR, the HR Director or the CEO to close access now. Every
   * sign-in and every request checks it; the person's grants end the day before.
   */
  accessClosedFrom?: IsoDate | null;
  /** Who closed the access, when and why (shown to HR and in the audit log). */
  accessClosed?: { by: string; at: IsoDateTime; reason: string } | null;
  /** Companies this user belongs to. */
  companyIds: Id[];
  /** For supervisors and site devices: the sites they work at. */
  siteIds: Id[];
  /** For a guard's own sign-in, and for officers: their own person record, which they may read (Fauzan, 25 Oct 2026). */
  personId?: Id;
  /** For PWVSB staff: the central department they work in (V7: central departments sit at PWVSB). */
  department?:
    | 'operations'
    | 'hr'
    | 'arms_control'
    | 'chief_of_staff'
    | 'cms'
    | 'director_office'
    | 'fwm'
    | 'pdpa'
    | 'transport'
    | 'asset'
    | 'finance'
    | 'it'
    | 'legal'
    | 'audit'
    | 'procurement';
  /** PWVSB credit (V8, V10): the credit officer who watches PWVSB's financing to the companies. */
  creditOfficer?: boolean;
  /**
   * The company secretary (Permata Management, Fauzan 24 Oct 2026): monitors the SSM filings of the companies it serves,
   * view only (Fauzan, 1 Nov 2026). Head office Corporate Admin records them.
   */
  corpSecretary?: boolean;
  /** IT department (Fauzan, 27 Oct 2026): 1 IT Manager, 1 IT Lead and 4 IT Executives. */
  itRole?: 'manager' | 'lead' | 'executive';
  /**
   * ACT, Audit, Compliance and Transformation (Fauzan, 2 Nov 2026): 1 Director ('lead', kept for the Arisha pilot
   * record) and 2 teams, each with 1 Auditor and 1 Enforcement officer. Department 'audit'.
   */
  actRole?: 'lead' | 'auditor' | 'enforcement';
  /** The ACT team (1 or 2) an Auditor or Enforcement officer belongs to; each team covers its own workflows. */
  actTeam?: 1 | 2;
  /**
   * Procurement and Inventory (Fauzan, 27 Oct 2026): under the Operations General Manager, monitored by the COO and
   * CEO; 1 executive and 2 storekeepers. Department 'procurement'.
   */
  /** Goodwill's Inventory Manager sets the rental and sale prices (Fauzan, 2 Nov 2026). */
  procRole?: 'manager' | 'executive' | 'storekeeper';
  /** Asset Management: the Asset Director approves reminder letters and notices of demand for unpaid rent. */
  assetRole?: 'director';
  /**
   * Foreign Worker Management (Fauzan, 26 Oct 2026): FWM Manager, Deputy Manager, 3 FWM Executives and a driver cum
   * despatch. The despatch carries papers and runs errands; he does not open worker records or payslips.
   */
  fwmRole?: 'manager' | 'deputy' | 'executive' | 'despatch';
  /**
   * Finance (Fauzan, 27 Oct 2026): the Finance Director, then 7 teams, each a team leader, a deputy and 2 data entry
   * executives. All group staff, working in SQL Account.
   */
  financeTeam?: number;
  financeRole?: 'leader' | 'deputy' | 'data_entry';
  /**
   * Group leadership who may see group-wide data (Fauzan, 26 Oct 2026): Chairman, Vice Chairman, Finance Director,
   * Chief of Staff and Deputy Chief of Staff; the CEO and COO are marked by opsTier. Everyone else sees only their own
   * line of work.
   */
  leadership?: 'chairman' | 'vice_chairman' | 'finance_director' | 'cos' | 'deputy_cos';
  /** For Regional Operations Managers: the regions they cover, across every company with sites there. */
  regionIds?: string[];
  /**
   * Place in the operations hierarchy (Fauzan, 25 Oct 2026). 'patrol' is a patrolling officer (role supervisor,
   * siteIds are the sites on the patrol); a supervisor without a tier is the officer stationed at the site.
   */
  opsTier?: 'patrol' | 'om' | 'regional' | 'ogm' | 'ops_director' | 'coo' | 'ceo';
  /**
   * Which side an OM or Regional OM works for (Fauzan, 2 Nov 2026): Goodwill Empire runs government sites and Sasa Team
   * runs private sites, each with its own regional teams. Missing means both sides (older records and tests).
   */
  opsSector?: 'government' | 'private';
  /**
   * For a patrolling officer working for more than one company in the group (Fauzan, 25 Oct 2026): the company
   * whose screens they open first. They see each other company only at the sites in siteIds.
   */
  homeCompanyId?: Id;
  /**
   * Monthly salary of a patrolling officer (mock). An officer working for several companies is paid by each
   * company in proportion to the guards of that company under their command (rule OPS-SHARED-PAY).
   */
  monthlySalary?: number;
  /** A system sign-in for a connected app (the JA Group app feed), never a person; it cannot sign in to screens. */
  integration?: 'ja' | 'door' | 'planner' | 'cms' | 'tracker' | 'am' | 'whatsapp';
  /** For a far-branch manager (Fauzan, 27 Oct 2026): the branch they run. */
  branchId?: Id;

  /**
   * Where this person works from, for the staff clock (Fauzan, 26 Oct 2026). Staff who move between sites (officers,
   * operations managers) have none; their location is recorded but not checked against a place.
   */
  base?: { name: string; lat: number; lng: number; radiusM: number };
  /** For Operations Managers: the states of the area they cover, across every company with sites there. */
  areaStates?: string[];
}

/**
 * A scoped, dated, revocable right for a PWVSB department or the Director Office to act on
 * or monitor a company, derived from a board mandate or management agreement (GOV, V8).
 */
export interface AuthorityGrant {
  id: Id;
  userId: Id;
  companyId: Id;
  scope: 'monitor' | 'act';
  basis: string;
  validFrom: IsoDate;
  validTo: IsoDate;
}

export interface AuditEntry {
  seq: number;
  at: IsoDateTime;
  actor: string;
  companyId: Id | null;
  action: string;
  entity: string;
  entityId: Id;
  summary: string;
  prevHash: string;
  hash: string;
}

// ---------- Insurance (Chief of Staff insurance section, Fauzan 25 Oct 2026) ----------

/** Cover a security company carries. Each policy belongs to one company; PWVSB never holds a company's cover (V7). */
export type InsuranceKind =
  | 'PUBLIC_LIABILITY'
  | 'GROUP_PERSONAL_ACCIDENT'
  | 'GROUP_HOSPITALISATION'
  | 'FW_HOSPITALISATION'
  | 'FIDELITY_GUARANTEE'
  | 'ARMED_SERVICE'
  | 'CASH_IN_TRANSIT'
  | 'MOTOR_FLEET'
  | 'FIRE_OFFICE';

export interface InsurancePolicy {
  id: Id;
  companyId: Id;
  kind: InsuranceKind;
  insurer: string;
  broker: string | null;
  policyNo: string;
  /** Sum insured or limit of liability, RM. */
  sumInsured: number;
  /** Premium for the policy year, RM, including tax and stamp duty. */
  premium: number;
  startsOn: IsoDate;
  expiresOn: IsoDate;
  premiumDueOn: IsoDate;
  premiumPaidOn: IsoDate | null;
  /** How far next year's renewal has got. */
  renewal: 'not_started' | 'quotes' | 'renewed';
}

export interface InsuranceClaim {
  id: Id;
  companyId: Id;
  policyId: Id;
  ref: string;
  what: string;
  incidentOn: IsoDate;
  /** When the insurer was told. Null while the company has not notified yet. */
  notifiedOn: IsoDate | null;
  amountClaimed: number;
  /** offered: the insurer made an offer; settled only once Finance records the money received. */
  status: 'to_notify' | 'notified' | 'documents' | 'assessing' | 'offered' | 'settled' | 'rejected';
  settledAmount: number | null;
  settledOn: IsoDate | null;
  /** Workflow (masterplan 61): who opened it, the insurer's own reference and how it was told. */
  openedBy?: string;
  openedById?: Id;
  insurerRef?: string | null;
  notifyHow?: string | null;
  /** Documents sent or held, each with its reference. Typical lists are in CLAIM_DOCS. */
  docs?: { name: string; ref: string; by: string; at: IsoDateTime }[];
  submittedOn?: IsoDate | null;
  offer?: { amount: number; ref: string; on: IsoDate; by: string; byId: Id; at: IsoDateTime } | null;
  /** The company manager accepts the offer for the company, never the person who recorded it. */
  accepted?: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /** Finance records the money against the bank statement: not the person who accepted. */
  received?: { bankRef: string; on: IsoDate; by: string; byId: Id; at: IsoDateTime } | null;
  rejection?: { reason: string; ref: string; on: IsoDate; by: string; at: IsoDateTime } | null;
  appeal?: { reason: string; by: string; at: IsoDateTime } | null;
  steps?: { at: IsoDateTime; by: string; what: string; note: string }[];
}

/** A guarantee given to a client or buyer for a contract or tender: by a bank, or by an insurer in place of a bank. */
export interface InsuranceGuarantee {
  id: Id;
  companyId: Id;
  kind: 'PERFORMANCE_BOND' | 'TENDER_BOND' | 'BANK_GUARANTEE' | 'INSURANCE_GUARANTEE';
  issuer: string;
  beneficiary: string;
  contractRef: string;
  amount: number;
  /** Fee or premium paid for the guarantee, RM. */
  fee: number;
  issuedOn: IsoDate;
  expiresOn: IsoDate;
  /** The guarantee must stay valid until the contract (or tender validity) ends. */
  contractEndsOn: IsoDate;
  releasedOn: IsoDate | null;
}

export interface Dataset {
  /** Company office desks (Fauzan, 2 Nov 2026): who owns and backs up each area of the company's work. */
  companyDesks: import('./company-office').CompanyDeskAssignment[];
  /** Which licensed company's office runs a company (Fauzan, 3 Nov 2026), set by the CEO. */
  companyRunLinks: import('./company-office').CompanyRunLink[];
  itMetricStreams:MetricStream[];
  itMetricReceipts:{id:string;receipt:MetricReceipt}[];
  itMetricTargets:{id:string;target:MetricTarget}[];
  itMetricCalendars:{id:string;calendar:MetricCalendar}[];
  arishaDrafts: import('./arisha-policy').ArishaReviewDraft[];
  itImportReviews: import('./it-import-review').ItImportReview[];
  companies: Company[];
  branches: Branch[];
  sites: Site[];
  posts: Post[];
  people: Person[];
  credentials: Credential[];
  licences: CompanyLicence[];
  shifts: Shift[];
  attendance: Attendance[];
  cases: Case[];
  checkpoints: PatrolCheckpoint[];
  scans: PatrolScan[];
  tenders: Tender[];
  quotations: Quotation[];
  salesLeads: SalesLead[];
  vaults: Vault[];
  firearms: Firearm[];
  armsMovements: ArmsMovement[];
  armedJobs: ArmedJob[];
  cmsShifts: CmsShift[];
  cmsStaff: CmsStaff[];
  cmsSettings: CmsSettings[];
  phoneExtensions: PhoneExtension[];
  phoneCalls: PhoneCall[];
  siteSystems: SiteSystem[];
  siteAlarms: SiteAlarm[];
  attendanceFollowUps: AttendanceFollowUp[];
  evidencePhotos: EvidencePhoto[];
  evidenceDocs: EvidenceDoc[];
  leaveRequests: LeaveRequest[];
  siteVisits: SiteVisit[];
  vaultWatches: VaultWatch[];
  armsSuppliers: ArmsSupplier[];
  supplierItems: SupplierItem[];
  dealerLicences: DealerLicence[];
  vaultEvents: VaultEvent[];
  ammoStocks: AmmoStock[];
  armsAgreements: ArmsAgreement[];
  armsRequests: ArmsRequest[];
  insurancePolicies: InsurancePolicy[];
  insuranceClaims: InsuranceClaim[];
  insuranceGuarantees: InsuranceGuarantee[];
  users: User[];
  grants: AuthorityGrant[];
  audit: AuditEntry[];
  tenderProtocols: TenderProtocol[];
  reportDefs: ReportDef[];
  reportSubmissions: ReportSubmission[];
  tenderGroups: TenderGroup[];
  meetings: Meeting[];
  staffClocks: StaffClock[];
  doorEvents: DoorEvent[];
  remoteArrangements: RemoteArrangement[];
  remoteDays: RemoteDay[];
  workTasks: WorkTask[];
  workCheckIns: WorkCheckIn[];
  helpRequests: HelpRequest[];
  oneOnOnes: OneOnOne[];
  playbookSignoffs: PlaybookSignoff[];
  branchChecks: BranchCheck[];
  branchVisits: BranchVisit[];
  socsoClaims: SocsoClaim[];
  fwRenewals: FwRenewal[];
  fwmTasks: FwmTask[];
  fwWelfareChecks: FwWelfareCheck[];
  locationPings: LocationPing[];
  hostels: Hostel[];
  hostelStays: HostelStay[];
  hostelBills: HostelBill[];
  utilityCharges: UtilityCharge[];
  claimRates: ClaimRate[];
  memos: Memo[];
  pdpaCases: PdpaCase[];
  pdpaDpos: PdpaDpo[];
  pdpaRequests: PdpaRequest[];
  bcmSystems: BcmSystem[];
  bcmDrills: BcmDrill[];
  corpAudits: CorpAudit[];
  actFindings: ActFinding[];
  actAudits: ActAudit[];
  actImprovements: ActImprovement[];
  amDepnPostings: AmDepnPosting[];
  staffIds: StaffIdentity[];
  staffAccounts: StaffAccount[];
  staffFaces: StaffFace[];
  publicHolidays: PublicHoliday[];
  allowanceTypes: AllowanceType[];
  flexRequests: FlexRequest[];
  vacancies: Vacancy[];
  staffMovements: StaffMovement[];
  loginHandovers: LoginHandover[];
  hrFilings: HrFiling[];
  hrCases: HrCase[];
  officeOsh: OfficeOsh[];
  staffTraining: StaffTraining[];
  staffAppraisals: StaffAppraisal[];
  hrPolicies: HrPolicy[];
  staffOvertime: StaffOvertimeSetting[];
  hrLegalChecks: HrLegalCheck[];
  policyAcks: PolicyAck[];
  legalMatters: LegalMatter[];
  vehicles: Vehicle[];
  products: Product[];
  clientAccounts: ClientAccount[];
  expenseRequests: ExpenseRequest[];
  vehicleRequests: VehicleRequest[];
  staffClaims: StaffClaim[];
  tripApprovals: TripApproval[];
  staffPayRuns: StaffPayRun[];
  finStatus: FinStatus[];
  contracts: Contract[];
  branchSettlements: BranchSettlement[];
  branchActions: BranchAction[];
  itAssets: ItAsset[];
  itDomains: ItDomain[];
  payChanges: PayChange[];
  itTickets: ItTicket[];
  itOnboarding: ItOnboarding[];
  itTenderTasks: ItTenderTask[];
  itPurchases: ItPurchase[];
  itJobs: ItJob[];
  itCodeHolders: ItCodeHolder[];
  itSettings: ItSettings[];
  itManualReceipts: ItManualReceipt[];
  itRentalBills: ItRentalBill[];
  itRentalCorrectionRequests: RentalCorrectionRequest[];
  itRentalCorrectionReviews: RentalCorrectionReview[];
  itRentalReplacements: RentalBillReplacement[];
  itRentalReplacementPayments: RentalReplacementPayment[];
  itRentalCorrectionReceipts: RentalCorrectionReceipt[];
  itRentalRates: ItRentalRate[];
  itAssetInspections: ItAssetInspection[];
  itOperationalReceipts: ItOperationalReceipt[];
  itPurchaseFinanceAuthorities: ProcurementAuthority[];
  itProcurementPackets: ProcurementPacket[];
  itProcurementReceipts: ProcurementReceipt[];
  itCleanupNominations: import('./it-cleanup-types').CleanupNomination[];
  itCleanupArchives: import('./it-cleanup-types').CleanupArchive[];
  itCleanupReceipts: import('./it-cleanup-types').CleanupReceipt[];
  itCleanupPlanBindings: {id:string;jobId:string;planKey:string;refsHash:string}[];
  /** Hand-overs between departments (org-links.ts): events, hand-over items, in-app notices, import receipts. */
  orgEvents: import('./org-links').OrgEvent[];
  orgTasks: import('./org-links').OrgTask[];
  orgNotices: import('./org-links').OrgNotice[];
  orgImports: import('./org-import').OrgImportReceipt[];
  hrItRequests: HrItRequest[];
  hrItApprovals: HrItApproval[];
  hrItDelegations: HrItDelegation[];
  hrItAuthorityMappings: HrItAuthorityMapping[];
  hrItReceipts: HrItReceipt[];
  confidentialityAcks: ConfidentialityAck[];
  itAccounts: ItAccount[];
  itAccessRequests: ItAccessRequest[];
  webCompanies: import('./websites').WebCompany[];
  webDomains: import('./websites').WebDomain[];
  webSites: import('./websites').WebSite[];
  webReviews: import('./websites').WebReview[];
  webChecks: import('./websites').WebCheck[];
  webIssues: import('./websites').WebIssue[];
  webDnsChanges: import('./websites').WebDnsChange[];
  webNotices: import('./websites').WebNotice[];
  webSettings: import('./websites').WebSettings[];
  corpProfiles: CorpProfile[];
  panelFirms: PanelFirm[];
  delegations: Delegation[];
  criticalRoles: CriticalRole[];
  legalHolds: LegalHold[];
  legalHoldVersions: LegalHoldVersion[];
  creditLoans: CreditLoan[];
  creditDefaults: CreditDefault[];
  purSuppliers: PurSupplier[];
  purRequests: PurRequest[];
  stockItems: StockItem[];
  stockIssues: StockIssue[];
  govMandates: GovMandate[];
  grcObligations: GrcObligation[];
  whistleReports: WhistleReport[];
  giftEntries: GiftEntry[];
  oshAssessments: OshAssessment[];
  corpFilings: CorpFiling[];
  corpChanges: CorpChange[];
  jaRecords: JaRecord[];
  jaSyncs: JaSync[];
  amUnits: AmUnit[];
  amWorkOrders: AmWorkOrder[];
  amAssets: AmAsset[];
  amProperties: AmProperty[];
}

// ---------- Hostels, hostel bills and utility excess (Fauzan, 26 Oct 2026) ----------

/** A hostel owned or rented by one company of the group; FWM owns its lifecycle. */
export interface Hostel {
  id: Id;
  companyId: Id;
  name: string;
  address: string;
  beds: number;
  tenure: 'OWNED' | 'RENTED';
  /** Nepali guards work at private-sector sites, so the Operations Director approves; OGM for government. */
  sector: 'private' | 'government';
}

/** A worker living in a hostel from one date to another, for bed-days. */
export interface HostelStay {
  id: Id;
  companyId: Id;
  hostelId: Id;
  personId: Id;
  personName: string;
  from: IsoDate;
  to: IsoDate | null;
}

export type HostelBillKind = 'RENT' | 'ELECTRICITY' | 'WATER' | 'MAINTENANCE';

export interface HostelBillStep {
  userId: Id;
  by: string;
  at: IsoDateTime;
  note: string;
}

export interface HostelFinancePaid {
  bankId: Id;
  /** The bank and the last digits, e.g. "Maybank ****1234". */
  bank: string;
  on: IsoDate;
  ref: string;
  amount: number;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export interface HostelBankSeen {
  statementId: Id;
  lineId: Id;
  date: IsoDate;
  amount: number;
  bank: string;
  at: IsoDateTime;
}

/**
 * A hostel bill, owned by the company that owns or rents the hostel (Fauzan, 26 Oct 2026). The company asks for
 * payment approval, FWM checks it, the Operations Director or OGM approves, then the COO; the company pays from its
 * own bank and books it in its own SQL Account, then uploads the slip. The bill closes only with the slip.
 */
export interface HostelBill {
  id: Id;
  companyId: Id;
  hostelId: Id;
  kind: HostelBillKind;
  /** The month billed, YYYY-MM. */
  period: string;
  amount: number;
  dueOn: IsoDate;
  status: 'due' | 'requested' | 'fwm_checked' | 'sector_approved' | 'coo_approved' | 'paid' | 'returned';
  billDocIds: Id[];
  request: HostelBillStep | null;
  fwmCheck: HostelBillStep | null;
  sectorApproval: HostelBillStep | null;
  cooApproval: HostelBillStep | null;
  slip: (HostelBillStep & { docIds: Id[] }) | null;
  /**
   * Finance keyed the payment in once (Fauzan, 2 Nov 2026: "hostel payment once key in in finance can be known in fwm
   * that hostel bills has been paid with record"): the bank, date, reference and amount, shown to FWM and the company.
   */
  financePaid?: HostelFinancePaid | null;
  /** Where Prima found the money leaving the company's account, on a bank statement Finance loaded. */
  bankSeen?: HostelBankSeen | null;
  returned: HostelBillStep | null;
  createdBy: string;
  createdAt: IsoDateTime;
}

/**
 * One worker's share of a utility bill above the allowance (RM30 electricity, RM20 water per person a month, pro-rated
 * by bed-days). The 1st and 2nd time are a notice only; from the 3rd, HR may choose a deduction if the contract has the
 * utility clause. The count never resets for the person (Fauzan, 26 Oct 2026).
 */
export interface UtilityCharge {
  id: Id;
  companyId: Id;
  personId: Id;
  personName: string;
  hostelId: Id;
  billId: Id;
  kind: 'ELECTRICITY' | 'WATER';
  period: string;
  bedDays: number;
  totalBedDays: number;
  excess: number;
  share: number;
  /** 1 for the person's first excess ever, 2 for the second, and so on. */
  count: number;
  decision: 'NOTICE' | 'DEDUCTION' | null;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  /** Payroll month the deduction goes to, YYYY-MM. */
  payrollMonth: string | null;
  noticeAck: { by: string; at: IsoDateTime } | null;
}

// ---------- Staff claims (Fauzan, 26 Oct 2026; staff = everyone except guards, patrolling officers and officers) ----------

export type ClaimVehicle = 'CAR' | 'MOTORCYCLE' | 'COMPANY_CAR';

/** HR publishes the rate per km for each vehicle type every month. */
/**
 * Fleet (Fauzan, 26 Oct 2026): the head of the Transport department monitors every company vehicle and is reminded of
 * renewals, servicing and payments. Staff request a vehicle and the Transport head approves; each use is logged out
 * and in. CMS also monitors the tracker, dashcam and the driver's health while driving; none is connected yet, so it
 * shows as unknown. Dashcam and health data are personal data: the PDPA officer files each driver's consent.
 */
export type VehicleKind = 'CAR' | 'VAN' | 'MOTORCYCLE' | 'PATROL_CAR' | 'LORRY';
export type VehicleRenewal = 'ROAD_TAX' | 'INSURANCE' | 'PUSPAKOM' | 'PERMIT';

export interface VehicleLogEntry {
  at: IsoDateTime;
  by: string;
  what: string;
  docId: Id | null;
}

export interface Vehicle {
  id: Id;
  companyId: Id;
  plate: string;
  model: string;
  kind: VehicleKind;
  /** Due dates by renewal; a renewal the vehicle does not need is left out. */
  renewals: Partial<Record<VehicleRenewal, IsoDate>>;
  odometerKm: number;
  service: { dueOn: IsoDate; dueKm: number; lastOn: IsoDate | null };
  /** Hire purchase or lease; null when owned outright. */
  payment: { lender: string; monthly: number; dayOfMonth: number; endsOn: IsoDate; paidPeriods: string[] } | null;
  /** Devices for CMS; lastSeen null = not connected (shown as unknown, never as fine). */
  tracker: { id: string; lastSeen: IsoDateTime | null } | null;
  dashcam: { id: string; lastSeen: IsoDateTime | null } | null;
  healthMonitor: boolean;
  /** Who has it now, from the in-and-out log. */
  out: { requestId: Id | null; driver: string; driverUserId: Id | null; at: IsoDateTime; km: number } | null;
  log: VehicleLogEntry[];
  /**
   * The trip now, from the tracker feed (slice 4F). Positions are kept only while the vehicle is out with a driver
   * who has consent on file (on duty only); otherwise the feed only marks the tracker as seen.
   */
  trip?: VehicleTrip | null;
  /** Finished trips, newest last (last 30 kept), for JPJ driving hours. */
  trips?: VehicleTrip[];
}

/** One trip from the tracker feed: driving time for the JPJ hours check, speed and the last position. */
export interface VehicleTrip {
  driver: string;
  driverUserId: Id | null;
  start: IsoDateTime;
  lastAt: IsoDateTime;
  end: IsoDateTime | null;
  km: number;
  maxKmh: number;
  overSpeed: number;
  /** Driving periods (moving or engine on, gaps of 10 minutes or less joined), for the hours check. */
  driving: { from: IsoDateTime; to: IsoDateTime }[];
  last: { lat: number; lng: number; at: IsoDateTime; kmh: number } | null;
  panicAt: IsoDateTime | null;
}

export interface VehicleRequest {
  id: Id;
  companyId: Id;
  vehicleId: Id | null;
  userId: Id;
  name: string;
  purpose: string;
  from: IsoDateTime;
  to: IsoDateTime;
  status: 'requested' | 'approved' | 'rejected' | 'out' | 'returned' | 'cancelled';
  decision: { by: string; at: IsoDateTime; note: string } | null;
  requestedAt: IsoDateTime;
}

/**
 * PDPA (Fauzan, 26 Oct 2026): a PDPA officer manages every personal data matter and is monitored by the Operations
 * Director. Breaches follow the 2024 amendment: the PDP Commissioner within 72 hours, and the affected people within
 * 7 days when there is significant harm. The officer also advises clients and gets their consent before a product
 * that needs client approval is used, and monitors the group's social media.
 */
export type PdpaCaseKind = 'BREACH' | 'CLIENT_CONSENT' | 'SOCIAL';

export interface PdpaStep {
  at: IsoDateTime;
  by: string;
  what: string;
  docId: Id | null;
}

// ---------- Business continuity (V15, Fauzan 24 Oct 2026) ----------
// Every system keeps three copies in Malaysia: the cloud copy, Fauzan's own server and an emergency server. A copy with
// no backup or no restore test on record is unknown, never green.

export interface BcmCopy {
  site: 'CLOUD' | 'OWN_SERVER' | 'EMERGENCY';
  where: string;
  inMalaysia: boolean;
  lastBackupAt: IsoDateTime | null;
  lastRestoreTest: { on: IsoDate; ok: boolean; hours: number; dataLossMinutes: number; by: string; note: string } | null;
}

export interface BcmSystem {
  id: Id;
  name: string;
  /** What breaks for the business when it is down. */
  impact: string;
  rtoHours: number;
  rpoHours: number;
  copies: BcmCopy[];
}

/** A playbook drill: the team walks through or simulates the failure and records what went wrong. */
export interface BcmDrill {
  id: Id;
  playbookId: string;
  on: IsoDate;
  by: string;
  findings: string;
  actionsOpen: number;
}

/** Data protection officer per company, PDPA as amended (from 1 June 2025): appointed and notified to the Commissioner. */
export interface PdpaDpo {
  id: Id;
  companyId: Id;
  name: string;
  email: string;
  appointedOn: IsoDate;
  /** Notified to the PDP Commissioner, with the acknowledgement reference. */
  notified: { on: IsoDate; ref: string } | null;
  /** Business contact published (website or notice). */
  published: boolean;
}

/** A person's request about their own data: access, correction, portability, withdrawing consent, objection. */
export interface PdpaRequest {
  id: Id;
  ref: string;
  companyId: Id;
  kind: 'ACCESS' | 'CORRECTION' | 'PORTABILITY' | 'WITHDRAW_CONSENT' | 'OBJECTION';
  subjectName: string;
  subjectKind: 'guard' | 'staff' | 'client' | 'other';
  detail: string;
  receivedOn: IsoDate;
  dueOn: IsoDate;
  idVerified: { by: string; at: IsoDateTime } | null;
  status: 'open' | 'done' | 'refused';
  closed: { by: string; at: IsoDateTime; note: string } | null;
}

export interface PdpaCase {
  id: Id;
  kind: PdpaCaseKind;
  /** null for a group-wide matter. */
  companyId: Id | null;
  title: string;
  detail: string;
  openedBy: string;
  openedAt: IsoDateTime;
  status: 'open' | 'closed';
  steps: PdpaStep[];
  /** Breach only. */
  breach?: {
    detectedAt: IsoDateTime;
    affected: number;
    significantHarm: boolean;
    commissionerAt: IsoDateTime | null;
    subjectsAt: IsoDateTime | null;
    contained: boolean;
  };
  /** Client consent only: the product needing the client's approval, e.g. CCTV, body camera or visitor records. */
  consent?: { client: string; product: string; advisedAt: IsoDateTime | null; decision: 'pending' | 'given' | 'refused'; decidedAt: IsoDateTime | null };
  /** Social media only. */
  social?: { platform: string; link: string; risk: 'low' | 'medium' | 'high' };
}

/**
 * Expense requests (Fauzan, 26 Oct 2026). Operation claims: the Operations Manager sets the items needed each month
 * and the COO monitors and approves the monthly claim. Office needs: consumables (pens, paper, files; not IT or asset
 * items such as furniture or renovation), office utilities and rent: the company manager requests, the Chief of Staff
 * approves, the COO gives the final approval.
 */
export type ExpenseKind = 'OPS_CLAIM' | 'OFFICE';
export type OfficeCategory = 'SUPPLIES' | 'UTILITIES' | 'RENT';

export interface ExpenseRequest {
  id: Id;
  kind: ExpenseKind;
  companyId: Id;
  /** YYYY-MM the claim or bill is for. */
  period: string;
  category: OfficeCategory | null;
  lines: { item: string; amount: number; note: string }[];
  total: number;
  docIds: Id[];
  userId: Id;
  requestedBy: string;
  createdAt: IsoDateTime;
  status: 'draft' | 'submitted' | 'cos_approved' | 'approved' | 'returned' | 'rejected';
  submittedAt: IsoDateTime | null;
  cosApproval: HostelBillStep | null;
  cooDecision: HostelBillStep | null;
  returned: HostelBillStep | null;
}

/**
 * Client board (Fauzan, 26 Oct 2026): onboarding and offboarding, maintenance visits, monthly reports, satisfaction,
 * documents and billing for each client. Operations Managers, the Operations Director and officers act; the COO
 * monitors every company and each company manager monitors their own.
 */
export interface ClientStep {
  key: string;
  label: string;
  doneAt: IsoDateTime | null;
  by: string | null;
  note: string;
  docId: Id | null;
}

export interface InvoiceProof {
  at: IsoDateTime;
  by: string;
  docId: Id;
}

export type ClientFeedbackVia = 'meeting' | 'visit' | 'call' | 'email' | 'form';

export interface ClientComplaint {
  id: Id;
  at: IsoDateTime;
  by: string;
  /** The person at the client who complained. */
  from: string;
  via: ClientFeedbackVia;
  what: string;
  siteId: Id | null;
  resolvedAt: IsoDateTime | null;
  resolvedBy: string | null;
  resolution: string | null;
  docIds: Id[];
}

export interface ClientAccount {
  id: Id;
  companyId: Id;
  name: string;
  siteIds: Id[];
  stage: 'onboarding' | 'active' | 'offboarding' | 'ended';
  startedOn: IsoDate;
  contractEndsOn: IsoDate | null;
  onboarding: ClientStep[];
  offboarding: ClientStep[] | null;
  offboardReason: string | null;
  /** Relationship contacts and maintenance visits logged by the person in charge (site visits count too). */
  contacts: { at: IsoDateTime; by: string; kind: 'visit' | 'meeting' | 'call'; note: string }[];
  /** Monthly service report to the client, by YYYY-MM. */
  reports: { period: string; at: IsoDateTime; by: string; docId: Id | null }[];
  /**
   * Satisfaction, 1 (very unhappy) to 5 (very happy). from is the person at the client who gave it and via how they
   * gave it (Fauzan, 2 Nov 2026: client satisfaction must be monitored); older ratings may not have them.
   */
  ratings: {
    at: IsoDateTime;
    by: string;
    score: number;
    comment: string;
    from?: string;
    via?: ClientFeedbackVia;
    docId?: Id | null;
  }[];
  /** Complaints from the client, open until Operations records what was done (Fauzan, 2 Nov 2026). */
  complaints?: ClientComplaint[];
  /** Read-only report links shared with the client (client portal, first step). */
  shareLinks?: import('./client-share').ClientShareLink[];
  /**
   * Invoices for each month's work, sent by the 10th of the next month (Fauzan, 26 Oct 2026). Every invoice goes by hand
   * and by email, and through the client's system too when the client needs it; each way has its own proof.
   */
  invoices?: {
    period: string;
    amount: number;
    at: IsoDateTime;
    by: string;
    hand: InvoiceProof | null;
    email: InvoiceProof | null;
    portal: InvoiceProof | null;
  }[];
  /** The client's own invoicing system or portal, when they need invoices submitted there too (e.g. government e-invoicing). */
  invoicePortal?: string | null;
  /** Billing as last recorded from the accounts (SQL Account is the record; not connected yet). */
  billing: { asOf: IsoDate; invoicedTo: string | null; overdueAmount: number; overdueDays: number; by: string } | null;
}

/**
 * Group products sold or rented to clients (Fauzan, 26 Oct 2026): the PDPA officer keeps each product's personal data
 * details and its certificates (MySTI, SIRIM, MCMC or others), so the Operations Director can check a proposal is
 * ready before it goes to the client.
 */
export type CertBody = 'MySTI' | 'SIRIM' | 'MCMC' | 'OTHER';

export interface ProductCert {
  id: Id;
  body: CertBody;
  /** Name of the body when OTHER, or the scheme, e.g. "MCMC type approval via SIRIM QAS". */
  scheme: string;
  ref: string;
  status: 'valid' | 'applying' | 'not_started';
  expiresOn: IsoDate | null;
  /** How to obtain or renew it: the steps and who to contact. */
  procedure: string;
  docId: Id | null;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

export interface Product {
  id: Id;
  name: string;
  category: string;
  mode: 'SALE' | 'RENTAL' | 'BOTH';
  supplier: string;
  /** Personal data the product collects, e.g. video of people, vehicle plates, location, IC numbers. Empty = none. */
  personalData: string[];
  retentionDays: number | null;
  /** The client must agree (and usually put up notices) before it is used. */
  clientConsent: boolean;
  notes: string;
  certs: ProductCert[];
  updatedBy: string;
  updatedAt: IsoDateTime;
}

/** Memos (Fauzan, 26 Oct 2026): only the Chief of Staff publishes to all staff; only the COO to all guards and officers. */
export type MemoAudience = 'STAFF' | 'FIELD';

export interface Memo {
  id: Id;
  audience: MemoAudience;
  title: string;
  body: string;
  publishedBy: string;
  publishedById: Id;
  publishedAt: IsoDateTime;
  /** Only people based in these states see it (Fauzan, 26 Oct 2026: "memo for Penang, so all Penang see"); empty = everywhere. */
  states?: string[];
  /** Who opened and acknowledged it. */
  reads: { userId: Id; name: string; at: IsoDateTime }[];
}

export interface ClaimRate {
  id: Id;
  /** YYYY-MM */
  month: string;
  vehicle: ClaimVehicle;
  perKm: number;
  setBy: string;
  setAt: IsoDateTime;
}

export type StaffClaimKind = 'MEDICAL' | 'DENTAL' | 'OPTICAL' | 'CHECKUP' | 'TRAVEL';

export interface StaffClaim {
  id: Id;
  /** The employer: a company, or 'pwvsb' for central staff. */
  companyId: Id;
  personId: Id;
  personName: string;
  userId: Id;
  kind: StaffClaimKind;
  date: IsoDate;
  /** Medical, dental, optical, check-up: the receipt amount. */
  amount: number;
  /** What the policy allows of it. */
  allowed: number;
  receiptIds: Id[];
  note: string;
  travel: {
    destination: string;
    preApproved: boolean;
    vehicle: ClaimVehicle;
    kmClaimed: number;
    /** Office to the place and back, from the clock-in location pings or the car tracker. */
    kmSystem: number | null;
    perKm: number;
    mileage: number;
    toll: number;
    parking: number;
    overnightNights: number;
    hotel: number;
    food: number;
    /** Why the Chief of Staff must approve, if they must. */
    cosReasons: string[];
  } | null;
  /** HR checks every claim, then the COO approves it (Fauzan, 26 Oct 2026: all claims approved by the COO). */
  status: 'submitted' | 'cos_approved' | 'hr_checked' | 'approved' | 'rejected';
  cosApproval: HostelBillStep | null;
  hrDecision: HostelBillStep | null;
  cooDecision?: HostelBillStep | null;
  /** Pilot: the HR administrator entered it for the staff member (Fauzan, 28 Oct 2026). */
  enteredBy?: { userId: Id; by: string } | null;
  /** Paid by Finance after the COO's approval, with the bank or payment reference. */
  paid?: { by: string; userId: Id; at: IsoDateTime; ref: string } | null;
  /**
   * The company head who verifies it (Fauzan, 2 Nov 2026: "Hr and company head must be notify about the claim also to
   * check or verify"): the company's manager, or for PWVSB central staff their line manager. Any one of them verifies,
   * with a comment; the COO approves only once HR has checked and the head has verified. Empty = no head on record.
   */
  headIds?: Id[];
  headNames?: string[];
  headCheck?: HostelBillStep | null;
  createdAt: IsoDateTime;
}

/**
 * A trip approved before it is made (insider abuse audit, Fauzan 27 Oct 2026). A travel claim counts as pre-approved
 * only when it uses an approved trip of the same person and date; the claimant can no longer tick it themselves.
 */
export interface TripApproval {
  id: Id;
  companyId: Id;
  personId: Id;
  personName: string;
  userId: Id;
  date: IsoDate;
  destination: string;
  purpose: string;
  status: 'pending' | 'approved' | 'rejected';
  decision: HostelBillStep | null;
  /** The travel claim that used it; a trip is claimed once. */
  claimId: Id | null;
  createdAt: IsoDateTime;
}

// ---------- Staff payroll (Fauzan, 27 Oct 2026) ----------
// Guards and officers are paid from the JA Group app; Prima runs payroll for staff. HR prepares each employer's month,
// the Chief of Staff approves, then the COO approves (Fauzan, 1 Nov 2026), then Finance pays through the bank and posts
// to SQL Account.
// Prima only drafts the bank file, the SQL Account journal and the EPF, SOCSO, EIS and PCB lists; it never files or pays.

export type StaffPayStage = 'draft' | 'submitted' | 'approved' | 'coo_approved' | 'paid';

export interface StaffPayLine {
  personId: Id;
  staffNo: string;
  name: string;
  jobTitle: string;
  age: number;
  nationality: Nationality;
  basic: number;
  allowanceLines: { label: string; amount: number; fixed: boolean; typeId?: Id; epf?: boolean; socso?: boolean; pcb?: boolean; hrd?: boolean }[];
  allowances: number;
  unpaidDays: number;
  unpaidDeduction: number;
  claimIds: Id[];
  claims: number;
  gross: number;
  /** Wages for EPF, for SOCSO/EIS/LINDUNG, and taxable pay: gross less allowances HR's list leaves out (3 Nov 2026). */
  epfWage?: number;
  socsoWage?: number;
  taxable?: number;
  epfEe: number;
  epfEr: number;
  socsoEe: number;
  socsoEr: number;
  /** LINDUNG 24 Jam, employee only, kept apart from normal SOCSO (Fauzan, 27 Oct 2026). */
  lindungEe: number;
  lindungRate: number;
  lindungStatus: 'deducted' | 'opted_out' | 'not_started';
  eisEe: number;
  eisEr: number;
  hrd: number;
  pcb: number;
  pcbSource: 'estimate' | 'entered';
  /** Zakat the staff member chose to have deducted (2 Nov 2026); PCB is reduced by it. Missing on older runs = none. */
  zakat?: number;
  zakatBody?: string | null;
  zakatPercent?: number;
  /** PCB before the zakat rebate. */
  pcbBeforeZakat?: number;
  /** The EPF and SOCSO table rows used (table id, version and wage band); missing on runs before 2 Nov 2026. */
  statBands?: { epf: string; socso: string };
  /** The staff member's EPF, SOCSO and income tax numbers for the contribution files. */
  epfNo?: string | null;
  socsoNo?: string | null;
  taxNo?: string | null;
  deductions: number;
  net: number;
  bank: { bank: string; accountMasked: string } | null;
  /** Anything HR or the approvers should look at: no bank account, pay changed from last month, and so on. */
  flags: string[];
  /**
   * Employed for only part of the month (joined, left or transferred within it; Arisha main review, 3 Nov 2026). No
   * proration rule is set, so HR enters the pay for the days worked (partPay) and the month cannot be submitted until then.
   */
  partMonth?: { from: IsoDate; to: IsoDate } | null;
  partPay?: { basic: number; allowances: number; note: string; by: string; at: IsoDateTime } | null;
  /** What the line was calculated from (staffPayInputsKey); a draft whose inputs changed is recalculated before submitting. */
  inputs?: string;
}

export interface StaffPayStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

export interface StaffPayRun {
  id: Id;
  /** The employer: a company, or 'pwvsb' for central staff. */
  companyId: Id;
  /** YYYY-MM */
  period: string;
  stage: StaffPayStage;
  lines: StaffPayLine[];
  prepared: StaffPayStep;
  submitted: StaffPayStep | null;
  /** The Chief of Staff (HR Director) approves first. */
  approved: StaffPayStep | null;
  /** Then the COO approves (Fauzan, 1 Nov 2026); this replaced the Vice Chairman's monthly consent. */
  cooApproved: StaffPayStep | null;
  /** Finance records the bank's reference once paid, and confirms the PCB was checked in LHDN's e-PCB. */
  paid: (StaffPayStep & { bankRef: string; paidOn: IsoDate; pcbChecked: true }) | null;
  /** Sent back for changes; the approvals start again. */
  returns: (StaffPayStep & { from: StaffPayStage })[];
  /** The EPF and PERKESO tables the run used (id and version), so a later check knows which schedule applied. */
  tables?: { id: string; version: string; status: string }[];
}

// ---------- Contracts and site mobilisation (V3, V6 amendment; consolidated plan W-contracts) ----------
// A contract is signed or awarded, the site is mobilised against 12 workstreams (W12 CMS activation), the company issues the Site
// Ready-to-Operate Certificate, and reviews follow at day 1, 7, 14 and 30. Billing follows the contract's method and
// never changes without a signed variation, which becomes a new version.

/** Billing Method 1: hours a day x 30.5 x posts; 2: contracted hours a month; 3: hours a day x days in the month; or a fixed fee. */
export type BillingMethod = 'M1' | 'M2' | 'M3' | 'FIXED';

export interface ContractPost {
  postId: Id | null;
  label: string;
  /** Guards on the post at any one time. */
  guards: number;
  hoursPerDay: number;
  armed: boolean;
  /** RM per guard-hour (Methods 1 to 3). */
  rate: number;
  /** Method 2 only: contracted hours a month per guard position. */
  contractedHours?: number;
}

export interface ContractVersion {
  version: number;
  effectiveFrom: IsoDate;
  billingMethod: BillingMethod;
  posts: ContractPost[];
  /** FIXED only: the monthly fee. */
  fixedFee: number | null;
  sla: { replaceAbsentMinutes: number; incidentReportHours: number; monthlyReportByDay: number };
  penalties: string;
  /** The signed contract or variation, by reference, and who recorded it. */
  signedRef: string;
  reason: string;
  by: string;
  at: IsoDateTime;
}

export type ContractState = 'awarded' | 'mobilising' | 'ready' | 'active' | 'suspended' | 'terminated';
export type MobWorkstream = 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'W7' | 'W8' | 'W9' | 'W10' | 'W11' | 'W12';

export interface MobItem {
  id: Id;
  workstream: MobWorkstream;
  label: string;
  /** Days from the start date; negative is before it. */
  offset: number;
  dueOn: IsoDate;
  /** Critical items block go-live and cannot be risk-accepted; others may be, by the company manager, for up to 30 days. */
  critical: boolean;
  status: 'open' | 'done' | 'risk_accepted';
  by: string | null;
  at: IsoDateTime | null;
  note: string;
  acceptedUntil: IsoDate | null;
  /** 'cms_activation': Prima checks the sites are really linked to CMS before the item can be marked done (§191). */
  check?: 'cms_activation';
}

export interface ContractReview {
  day: 1 | 7 | 14 | 30;
  dueOn: IsoDate;
  doneAt: IsoDateTime | null;
  by: string | null;
  note: string;
  /** Day 30: the first invoice checked against the contract's billing. */
  invoiceChecked?: boolean;
}

export interface Contract {
  id: Id;
  companyId: Id;
  clientAccountId: Id | null;
  clientName: string;
  siteIds: Id[];
  ref: string;
  state: ContractState;
  startOn: IsoDate;
  endOn: IsoDate;
  /** The day it was terminated early (Fauzan, 2 Nov 2026: billing stops there and the end follow-ups open). */
  endedOn?: IsoDate | null;
  versions: ContractVersion[];
  mobilisation: MobItem[];
  /** Site Ready-to-Operate Certificate: the company manager signs once every critical item is done. */
  rtoCert: { by: string; at: IsoDateTime; note: string } | null;
  reviews: ContractReview[];
  history: { at: IsoDateTime; by: string; from: ContractState | null; to: ContractState; note: string }[];
  /** The signed CMS service for this contract (masterplan §191, 3 Nov 2026). Null until the company records it. */
  cmsService?: CmsService | null;
}

export type CmsServiceKind = 'cctv' | 'alarm' | 'attendance' | 'patrol';

/**
 * What CMS has agreed with the client to watch, and the steps that make it live: the signed scope (company manager),
 * every call-out contact verified by a CMS operator's test call, Arms Control's operator acceptance, then the client's
 * acceptance (recorded by the company manager). Changing the scope starts the verifications and acceptances again.
 */
export interface CmsService {
  version: number;
  sites: { siteId: Id; from: string; to: string }[];
  services: CmsServiceKind[];
  signedRef: string;
  clientSignatory: string;
  signedOn: IsoDate;
  recordedBy: string;
  recordedById: Id;
  recordedAt: IsoDateTime;
  contacts: { role: 'site_supervisor' | 'company_manager' | 'regional_om'; siteId: Id | null; userId: Id; name: string; verifiedAt: IsoDateTime | null; verifiedBy: string | null; note: string }[];
  operatorAcceptance: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  clientAcceptance: { clientName: string; ref: string; recordedBy: string; at: IsoDateTime } | null;
  /**
   * Acceptance tests per service and site, recorded by the CMS desk. CCTV and alarm are checked against Prima's own records
   * (prima_record); attendance and patrol run in the JA app, which Prima cannot see, so the operator attests them.
   */
  tests?: { service: CmsServiceKind; siteId: Id; at: IsoDateTime; by: string; byId: Id; basis: 'prima_record' | 'operator_attested'; evidence: string }[];
}

// ---------- IT department (Fauzan, 27 Oct 2026) ----------
// IT runs every electronic asset, watches the group's domains and websites, fills the IT part of tenders, answers
// help requests, teaches Microsoft 365 and sets new staff up on the systems.

export type ItAssetKind = 'LAPTOP' | 'DESKTOP' | 'PHONE' | 'TABLET' | 'PRINTER' | 'NETWORK' | 'CCTV' | 'OTHER';
/**
 * Merdeka Network's monthly bill to a group company for the devices it rents (Fauzan, 28 Oct 2026: every device is
 * rented from Merdeka to the group). The Finance Director issues it (the SQL Account invoice number) and records payment.
 */
/** A person accepted the confidentiality rule (Fauzan, 28 Oct 2026, rule SEC-CONFIDENTIAL); id is the user id. */
export interface ConfidentialityAck {
  id: Id;
  userId: Id;
  name: string;
  version: number;
  at: IsoDateTime;
}

export interface ItRentalBill {
  /** Derived only; original stored bill remains unchanged. */
  originalBillId?: string; correctionReplacementId?: string; rentalCorrectionState?: 'current'|'replacement'|'unverified';
  source?: "configured_rates"|"historical_record";
  currency?: "MYR";
  rateId?: string|null; rateVersion?:number|null; rateEffectiveOn?:string|null;
  assetSnapshot?: {id:string;tag:string;kind:ItAssetKind;ownerId:string;status:string;version:string}[];
  evidence?:string; note?:string; requestId?:string; createdById?:string;
  id: Id;
  companyId: Id;
  /** YYYY-MM */
  period: string;
  lines: { kind: ItAssetKind; count: number; rate: number; amount: number }[];
  total: number;
  invoiceRef: string;
  issuedBy: string;
  issuedAt: IsoDateTime;
  paid: { by: string; at: IsoDateTime; ref: string } | null;
}

export interface ItAsset {
  correction?: import('./it-corrections').ItCorrection;
  /** Manual record metadata; never proof of external provisioning or access. */
  manual?: ItManualMetadata;
  id: Id;
  tag: string;
  kind: ItAssetKind;
  model: string;
  serial: string;
  /** The company that owns it, or 'pwvsb'. */
  ownerId: Id;
  assignedTo: string | null;
  location: string;
  boughtOn: IsoDate;
  warrantyTo: IsoDate | null;
  status: 'in_use' | 'spare' | 'repair' | 'disposal_pending' | 'disposed';
  lastCheckedOn: IsoDate | null;
  /** The purchase it came from, when bought through Prima. */
  purchaseId?: Id | null;
  /** Servicing and repairs, newest last. */
  maintenance?: { at: IsoDateTime; by: string; kind: 'service' | 'repair'; note: string; cost: number }[];
  /** Next routine service (CCTV, network, printers); null when none is scheduled. */
  nextServiceOn?: IsoDate | null;
  disposal?: { reason: string; askedBy: string; askedAt: IsoDateTime; doneBy: string | null; doneAt: IsoDateTime | null } | null;
}

/**
 * Buying IT and electronic equipment (Fauzan, 27 Oct 2026: IT runs the full lifecycle, the COO monitors). An IT
 * Executive asks, the IT Manager approves, then the COO; IT orders, receives and tags each item into the register.
 */
export interface ItPurchase {
  id: Id;
  ref: string;
  ownerId: Id;
  requestedBy: string;
  requestedById: Id;
  at: IsoDateTime;
  reason: string;
  items: { kind: ItAssetKind; description: string; qty: number; unitPrice: number }[];
  total: number;
  /**
   * IT says what is needed and the IT Manager (or the COO, for the IT Manager's own request) agrees the need; then
   * Procurement buys it through its own flow: three quoted suppliers, COO and CEO approval, the storekeeper receives and
   * Finance matches the invoice (Fauzan, 27 Oct 2026). IT tags the items once the goods are received.
   */
  status: 'submitted' | 'procurement' | 'quoting' | 'coo' | 'ceo' | 'finance' | 'paid' | 'rejected' | 'received' | 'partially_received';
  managerStep: { by: string; at: IsoDateTime; note: string } | null;
  /** The COO's approval: given in Prima, or in Microsoft Teams (Approvals) and recorded here with its reference and screenshot. */
  cooStep: ItApproval | null;
  ceoStep?: ItApproval | null;
  /** Pilot route (rule IT-BUY): IT gets three quotes and one evidenced online comparison itself, with documents. */
  quotes?: { supplier: string; amount: number; ref: string; proof: ItProof[]; by: string; at: IsoDateTime }[];
  online?: { source: string; amount: number; ref: string; proof: ItProof[]; by: string; at: IsoDateTime }[];
  chosen?: { index: number; reason: string } | null;
  /** Passed to Finance to pay, and Finance's payment reference once paid. */
  finance?: { sentBy: string; sentAt: IsoDateTime; ref: string; paidRef: string | null; paidOn: IsoDate | null; recordedBy: string | null } | null;
  delivery?: { ref: string; proof: ItProof[]; by: string; at: IsoDateTime } | null;
  /** The Procurement request that buys it. */
  purRequestId: Id | null;
  received: { by: string; at: IsoDateTime; assetIds: Id[] } | null;
}

export interface ItDomain {
  id: Id;
  name: string;
  kind: 'domain' | 'website';
  ownerId: Id;
  registrar: string;
  expiresOn: IsoDate | null;
  sslExpiresOn: IsoDate | null;
  /** Last automatic check; null means never checked, shown as unknown. */
  lastCheckAt: IsoDateTime | null;
  up: boolean | null;
}

export type ItTicketCategory = 'ACCOUNT' | 'DEVICE' | 'M365' | 'NETWORK' | 'PRIMA' | 'WEBSITE' | 'SOCIAL' | 'EMAIL' | 'OTHER';
/** The receipt of one approved IT import batch. */
export interface ItImportReceipt {
  created: string[];
  skipRows: number[];
  skipped: { row: number; why: string }[];
}

export interface ItTicket {
  /** Linked website policy only. Legacy absent snapshots are not inferred. */
  webResolutionVersion?: number;
  webResolution?: { version:number; resolverId:Id; resolverRole:'manager'|'lead'|'executive'; at:IsoDateTime } | null;
  webHistory?: { at:IsoDateTime; actorId:Id; action:string; note:string; resolutionVersion:number; resolution:string; resolverId:Id|null; resolverRole:string|null }[];
  id: Id;
  ref: string;
  raisedBy: string;
  raisedById: Id;
  category: ItTicketCategory;
  priority: 'P1' | 'P2' | 'P3';
  title: string;
  detail: string;
  at: IsoDateTime;
  assignedTo: string | null;
  status: 'open' | 'in_progress' | 'resolved';
  resolvedAt: IsoDateTime | null;
  resolution: string;
  /** Who in IT works it, by id (the IT Manager or IT Lead assigns it, or someone takes it). */
  assignedToId?: Id | null;
  /**
   * Who signed in and resolved it (31 Oct 2026). The assignee is not proof of who fixed it: the IT Lead can resolve a
   * request assigned to someone else. Older resolved requests have none; see itMayHaveFixed.
   */
  resolvedById?: Id | null;
  resolvedBy?: string | null;
  /** The person who asked confirms it is fixed, or says it is not, which reopens it (Fauzan, 28 Oct 2026). */
  confirmedAt?: IsoDateTime | null;
  reopened?: number;
  /** Pilot: the person is not on the system yet; IT logged it for them and how they reached IT. */
  raisedFor?: string | null;
  channel?: 'teams' | 'email' | 'phone' | 'in_person' | 'prima';
  /** How the person confirmed, when IT recorded it for them. */
  confirmedVia?: string | null;
  /** Brought in by the CEO's batch import (task T9): the batch and where the row came from (file and row, email, link). */
  importBatchId?: string | null;
  /** The fingerprints of the preview the CEO approved for that batch, and of its input. */
  importToken?: string | null;
  importInput?: string | null;
  /** On the first item of a batch only: what the CEO approved and what was left out, returned unchanged on a retry. */
  importReceipt?: ItImportReceipt | null;
  sourceRef?: string | null;
}

/** An approval by the COO or the CEO: in Prima, or in Teams and recorded with the Teams reference and a screenshot. */
export interface ItApproval {
  by: string;
  at: IsoDateTime;
  note: string;
  via?: 'prima' | 'teams';
  teamsRef?: string;
  recordedBy?: string;
  proof?: ItProof[];
  decision?: 'approve' | 'reject';
}

/** Joining or leaving: accounts, device, Prima access and Microsoft 365 training, done by the start or last day. */
export type ItManualKind = 'intake' | 'system' | 'guidance' | 'asset';
export interface ItManualMetadata {
  kind: ItManualKind; createdById: Id; createdAt: IsoDateTime; companyId: Id | null; unitLabel: string;
  version: number; state: 'recorded' | 'guidance_given' | 'manually_checked'; connection: 'not_connected';
  receipts: { requestId: string; userId: Id; hash: string; version: number }[];
  personUserId?: Id | null; siteOwnerUserId?: Id | null; itResponsibleId?: Id;
  siteUrl?: string | null; nextReviewOn?: IsoDate | null; jobId?: Id | null;
  evidence?: string; guidanceNote?: string; guidanceById?: Id | null; checkedById?: Id | null; updatedAt?: IsoDateTime;
  provenance?: 'existing_stock'; purchaseDateUnknown?: boolean;
}

export interface ItOnboarding {
  correction?: import('./it-corrections').ItCorrection;
  /** Manual record metadata; never proof of external provisioning or access. */
  manual?: ItManualMetadata;
  id: Id;
  kind: 'join' | 'leave';
  personName: string;
  jobTitle: string;
  ownerId: Id;
  on: IsoDate;
  steps: { key: string; label: string; doneAt: IsoDateTime | null; by: string | null; byId?: Id | null; evidenceRef?: string | null; version?: number; changedById?: Id; changedAt?: IsoDateTime; reopenReason?: string | null }[];
  /** Who in IT owns it (given by the IT Manager or IT Lead). */
  ownerStaffId?: Id | null;
}

/**
 * The IT part of a tender (Fauzan, 28 Oct 2026). The IT Manager finds tenders that need IT input, picks the group
 * company that holds the right IT code, gets the company's documents from it, and gives each IT part to an IT
 * Executive. Some group companies hold IT codes on top of their security and cleaning services.
 */
export interface ItTenderTask {
  id: Id;
  /** The company's own tender record when it exists; '' for a tender IT found itself. */
  tenderId: Id;
  companyId: Id;
  title: string;
  closesOn: IsoDate;
  items: {
    label: string;
    doneAt: IsoDateTime | null;
    by: string | null;
    assigneeId?: Id | null;
    dueOn?: IsoDate | null;
    proof?: ItProof[];
    /** The file name the tender asks for, set by the IT Manager; never the company name (Fauzan, 28 Oct 2026). */
    fileName?: string | null;
    /** Technical parts must carry no company name anywhere. */
    part?: TenderBidPart;
    /** Who confirmed the technical part was checked page by page for the company name. */
    noNameCheck?: { by: string; at: IsoDateTime } | null;
  }[];
  buyer?: string;
  source?: string;
  /** IT codes the tender asks for. */
  codes?: string[];
  /** Papers IT needs from the company (certificates, profile, letters), asked and received by the IT Manager. */
  companyDocs?: { label: string; askedAt: IsoDateTime | null; receivedAt: IsoDateTime | null; by: string | null; proof?: ItProof[] }[];
  stage?: 'preparing' | 'handed_over' | 'submitted' | 'won' | 'lost' | 'dropped';
  /** Open tender or quotation (sebut harga) on eP or another government channel; sets the timeline. */
  kind?: 'tender' | 'quotation';
  foundOn?: IsoDate;
  foundAt?: IsoDateTime;
  /** The dated timeline, one owner per step (Fauzan, 28 Oct 2026). */
  steps?: ItTenderStep[];
  /** Compulsory briefing or site visit, when the tender has one. */
  briefingOn?: IsoDate | null;
  handedOver?: { by: string; at: IsoDateTime; to: string } | null;
  foundBy?: string;
  /** Who in IT owns it (given by the IT Manager or IT Lead). */
  ownerStaffId?: Id | null;
}

/**
 * Proof that an IT job is done (Fauzan, 28 Oct 2026: "make sure they do the job given"): a PDF or a picture of the
 * screen, the signed form or the attendance sheet. Kept on the IT record, which is group data with no company wall.
 */
export interface ItProof {
  name: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  bytes: number;
  sha256: string;
  /** The file itself; left out of the board and fetched one at a time. */
  data: string;
  by: string;
  at: IsoDateTime;
}

export type ItJobKind = 'task' | 'install' | 'check' | 'training' | 'access' | 'other';

/**
 * A job given to someone in IT (Fauzan, 28 Oct 2026). The IT Manager (a supervisor, not technical) or the IT Lead
 * gives it, with a due date. The doer submits it with proof. A technical job is checked by the IT Lead first; the
 * IT Manager then accepts it or sends it back. Nobody accepts their own work. Late jobs go up to the COO, then the CEO.
 */
export interface ItJob {
  id: Id;
  ref: string;
  kind: ItJobKind;
  title: string;
  detail: string;
  priority: 'P1' | 'P2' | 'P3';
  /** Needs the IT Lead's technical check before the IT Manager accepts it. */
  technical: boolean;
  assigneeId: Id;
  assignee: string;
  givenById: Id;
  givenBy: string;
  at: IsoDateTime;
  dueOn: IsoDate;
  status: 'todo' | 'doing' | 'submitted' | 'checked' | 'accepted' | 'returned' | 'cancelled';
  /** Progress notes, submissions, checks, returns and edits, oldest first. */
  log: { at: IsoDateTime; by: string; byId: Id; what: 'start' | 'note' | 'submit' | 'check' | 'accept' | 'return' | 'edit' | 'cancel'; note: string }[];
  proof: ItProof[];
  submittedAt: IsoDateTime | null;
  checkedBy: string | null;
  acceptedBy: string | null;
  acceptedAt: IsoDateTime | null;
  /** Times it was sent back for more work. */
  returns: number;
  /** The regular work in the IT plan this job covers (servicing, checks, renewals, access reviews). */
  planKey?: string | null;
  /** Immutable server-derived protective inventory scope, not inspection completion evidence. */
  planAssetRefs?: {asOf:IsoDate;assets:{id:Id;hash:string}[]};
  /** Brought in by the CEO's batch import (task T9): the batch and where the row came from. */
  importBatchId?: string | null;
  /** The fingerprints of the preview the CEO approved for that batch, and of its input. */
  importToken?: string | null;
  importInput?: string | null;
  /** On the first item of a batch only: what the CEO approved and what was left out, returned unchanged on a retry. */
  importReceipt?: ItImportReceipt | null;
  sourceRef?: string | null;
  /**
   * The COO accepted or returned it (Fauzan, 31 Oct 2026: the COO may accept or return anyone's job; whoever was in
   * charge of checking it is told). Each notice stays until each person told has seen it.
   */
  cooNotices?: CooNotice[];
}

/**
 * The COO accepted or returned someone's work in place of the person in charge of checking it, in a department the
 * COO directly monitors (Fauzan, 31 Oct 2026). The id is stable, so marking one seen never touches a newer one.
 */
export interface CooNotice {
  id: string;
  at: IsoDateTime;
  by: string;
  what: 'accept' | 'return';
  note: string;
  to: Id[];
  seen: Id[];
}

/**
 * A system, domain or account the group runs (Fauzan, 28 Oct 2026: the CEO is the owner and master administrator of
 * all; IT staff only operate it). The register records who may sign in and at what level, never a password.
 */
export interface ItAccount {
  correction?: import('./it-corrections').ItCorrection;
  /** Manual record metadata; never proof of external provisioning or access. */
  manual?: ItManualMetadata;
  id: Id;
  name: string;
  kind: 'm365' | 'azure' | 'registrar' | 'dns' | 'hosting' | 'github' | 'sql_account' | 'network' | 'cctv' | 'prima' | 'other';
  /** Always the CEO; kept so a change is visible. */
  ownerId: Id;
  owner: string;
  /** Where the CEO's master sign-in and recovery codes are kept (place only). */
  masterKeptAt: string;
  mfa: boolean | null;
  access: { userId: Id; name: string; level: 'operator' | 'admin'; since: IsoDate; grantedBy: string }[];
  /** When the CEO last confirmed the access list is right. */
  reviewedOn: IsoDate | null;
  note: string;
}

/** A group company's IT codes (MOF registration), so the IT Manager bids in the name of a company that holds them. */
export interface ItCodeHolder {
  id: Id;
  companyId: Id;
  codes: { code: string; label: string }[];
  /** MOF certificate expiry; an expired certificate cannot bid. */
  expiresOn: IsoDate | null;
  /**
   * Checked by the IT Manager during the pilot against the company's MOF certificate (Fauzan, 28 Oct 2026). A company
   * checked and found to hold no IT code is kept with no codes, so the list shows who is still to check.
   */
  certNo?: string;
  proof?: ItProof[];
  checkedBy?: string | null;
  checkedAt?: IsoDateTime | null;
  note?: string;
}

/** One step of an IT tender's timeline. */
export interface ItTenderStep {
  key: string;
  label: string;
  /** leader: the COO or the CEO (Fauzan, 28 Oct 2026: they see the price before handover). */
  owner: 'manager' | 'exec' | 'lead' | 'leader';
  /** The step whose finish starts this step's clock; null starts when the tender is found. */
  after: string | null;
  /** Target time in minutes (Fauzan, 28 Oct 2026); null for a dated event such as a briefing or the result. */
  minutes: number | null;
  /** The last date allowed: a day before closing. */
  dueOn: IsoDate;
  doneAt: IsoDateTime | null;
  by: string | null;
  note: string;
}

/** IT department settings: who stands in while the IT Manager is away (Fauzan, 28 Oct 2026: the COO). */
export interface ItSettings {
  id: 'it';
  /** The IT Executive paired with the IT Manager who does every IT tender (Fauzan, 28 Oct 2026). */
  tenderExecId?: Id | null;
  managerAwayFrom: IsoDate | null;
  managerAwayUntil: IsoDate | null;
  setBy: string | null;
}

/** IT asks for someone to get or lose access to a system; only the CEO, as owner, decides. */
export interface ItAccessRequest {
  id: Id;
  ref: string;
  accountId: Id;
  action: 'grant' | 'remove';
  userId: Id;
  name: string;
  level: 'operator' | 'admin';
  reason: string;
  askedById: Id;
  askedBy: string;
  at: IsoDateTime;
  status: 'waiting' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string;
}

// ---------- Finance monitor (Fauzan, 27 Oct 2026) ----------
// Finance keeps the books in SQL Account and SQL stays. Prima does not keep accounts: it reads what SQL Account holds
// (test data until the SQL connection exists) and shows whether each company's books are complete, reconciled and
// closed, and tracks the auditor and tax agent papers that the Finance teams prepare.

export interface FinBankAccount {
  id: Id;
  bank: string;
  accountMasked: string;
  purpose: 'operating' | 'payroll' | 'collection';
  /** Balances at the last month end, from SQL Account and from the bank statement. */
  glBalance: number;
  statementBalance: number;
  /** Month end up to which the account is reconciled in SQL Account; null means never. */
  reconciledTo: IsoDate | null;
  openItems: number;
}

export type FinPackStatus = 'todo' | 'prepared' | 'reviewed' | 'sent';
/** The four Finance packs (Phase 2, 31 Oct 2026): the external auditor, the tax agent, the bank and the payment pack. */
export type FinPackKind = 'audit' | 'tax' | 'bank' | 'payment' | 'monthly';
export interface FinPackItem {
  id: Id;
  label: string;
  dueOn: IsoDate;
  status: FinPackStatus;
  by: string | null;
  at: IsoDateTime | null;
  /** Who prepared and who reviewed it, so nobody reviews or sends what they prepared (Phase 2). Older items: unset. */
  preparedById?: Id | null;
  reviewedById?: Id | null;
  /** The reviewer's or sender's comment (every approval gives at least a comment, Fauzan 31 Oct 2026). */
  comment?: string | null;
  /** The month a bank or payment pack item belongs to (YYYY-MM). */
  period?: string;
  /** Filled by Prima from what it already holds (Fauzan, 1 Nov 2026): what the item contains. People still review it. */
  auto?: string[];
  /** Who did the work it lists (loaded, ran, prepared, reviewed, approved or released it): none of them reviews it. */
  autoBy?: Id[];
  /** A fingerprint of what Prima filled when it was reviewed; a later change sends it back for review. */
  autoKey?: string;
  /** Shown when the data changed after review (the review stands for the version it read, kept in `auto`). */
  autoChanged?: boolean;
  /**
   * Fauzan, 1 Nov 2026: someone whose work a Prima-filled pack lists may review it, but another person must also verify.
   * Their review is kept here and the item stays prepared until someone not listed reviews it.
   */
  contributorReview?: { by: string; byId: Id; at: IsoDateTime; comment: string } | null;
}

// ---------- Finance Phase 2 (31 Oct 2026): payment control and the month-end close ----------
// SQL Account stays the books and the bank portal stays where money moves. Prima holds the approvals, the evidence and
// the separation of duties: nobody reviews, approves or releases what they prepared, and nobody releases what they
// approved. Nothing is posted to SQL Account and nothing is paid by Prima.

export type FinPayeeKind = 'supplier' | 'statutory' | 'payroll' | 'tax' | 'intercompany' | 'other';
export type FinPaymentStatus = 'prepared' | 'reviewed' | 'approved' | 'released' | 'returned' | 'cancelled';
/** Who must give the final approval (rule FIN-PAY): 'director' = the Finance Director or the CEO; 'coo' = the COO or the CEO. */
export type FinApprover = 'leader' | 'director' | 'ceo' | 'coo';
/**
 * What a payment is for, which decides who approves it (Fauzan, 1 Nov 2026: approval is by subject matter; only the
 * Finance Director, the CEO and the COO approve). 'finance' goes to the Finance Director or the CEO; the departments
 * the COO directly monitors go to the COO or the CEO.
 */
export type FinSubject = 'finance' | 'operations' | 'it' | 'fwm' | 'inventory' | 'transport' | 'goodwill';
export interface FinStep {
  step: 'prepared' | 'resubmitted' | 'reviewed' | 'approved' | 'released' | 'returned' | 'cancelled' | 'reopened' | 'evidence' | 'explained';
  by: string;
  byId: Id;
  at: IsoDateTime;
  comment: string;
}
/** One payment asked for from a company's bank account. Prima approves it; the bank portal pays it. */
export interface FinPayment {
  id: Id;
  companyId: Id;
  /** The month it was raised in (YYYY-MM). */
  period: string;
  payee: string;
  payeeKind: FinPayeeKind;
  purpose: string;
  amount: number;
  dueOn: IsoDate;
  /** The company bank account it is paid from (FinBankAccount.id). */
  bankId: Id;
  /** The SQL Account document it pays (purchase invoice or payment voucher number). */
  sqlRef: string;
  /** Supporting documents: file names or SharePoint links (never bank passwords or full account numbers). */
  evidence: string[];
  /** What it is for (missing on older records = 'finance'). */
  subject?: FinSubject;
  needs: FinApprover;
  status: FinPaymentStatus;
  steps: FinStep[];
  /** The bank's reference and date once released in the bank portal. */
  bankRef: string | null;
  releasedOn: IsoDate | null;
  /** Part 2: the verified payee, its bank details when approved, and what the releaser saw in the bank portal. */
  payeeId?: Id | null;
  /** `rev` is the payee's revision when approved (its change count); any later change, even of the name only, holds the release. */
  payeeBank?: { bank: string; accountLast4: string; accountName: string; rev?: number } | null;
  /** The company head's approved payment request it pays (Fauzan, 1 Nov 2026); its final approval is this payment's approval. */
  requestId?: Id | null;
  /** A due date of a regular payment this pays (Fauzan, 2 Nov 2026): the amount and payee come from the list. */
  regularId?: Id | null;
  regularPeriod?: string | null;
  /** A Procurement purchase whose three-way match passed and is posted in SQL Account (Fauzan, 2 Nov 2026: suggestion 10). */
  purchaseId?: Id | null;
  /** The budget line it is spent from (automation, 1 Nov 2026): the reviewer and approver are warned if it goes over. */
  budgetLine?: FinPlanLine | null;
  /** Where this payment is approved, fixed when it is prepared or resubmitted (missing on older records = 'prima'). */
  approvalMethod?: FinApprovalMethod;
  /** The day the approval lapses, fixed when it was approved (review finding, 1 Nov 2026: a later settings change never revives it). */
  expiresOn?: IsoDate | null;
  releaseCheck?: { accountLast4: string; accountName: string } | null;
  /** The approval in Teams or SharePoint, when the request started there. */
  external?: FinExternalApproval | null;
  /** The Teams approval Prima read itself from the protected results list (read-only connection, off by default). */
  teams?: FinTeamsRead | null;
  /** The bank statement line that shows the money left, once matched. */
  cleared?: { statementId: Id; lineId: Id; date: IsoDate } | null;
  /** The supplier's validated e-Invoice (MyInvois UUID) or the self-billed e-Invoice this payment settles (1 Nov 2026). */
  eInvoiceRef?: string | null;
  /** The supplier's own invoice number (Fauzan, 2 Nov 2026: duplicate invoice check across every company). */
  invoiceNo?: string | null;
  /** Why the preparer says it is not a duplicate of a similar payment Prima found (shown to the reviewer and approver). */
  notDuplicate?: string | null;
}
export type FinCloseStatus = 'open' | 'prepared' | 'reviewed' | 'approved';
/** One company's month-end close in Prima: the evidence, the exceptions explained, and the Finance Director's approval. */
export interface FinClose {
  id: Id;
  /** The month (YYYY-MM). */
  period: string;
  status: FinCloseStatus;
  /** The SQL Account bank reconciliation report for each bank account (a file name or SharePoint link). */
  bankRecRefs: { bankId: Id; ref: string; by: string; byId: Id; at: IsoDateTime }[];
  /** Why each exception (a posting gap or a failing test other than FS-01, FS-02 and FS-06) is acceptable for now. */
  explanations: { key: string; text: string; by: string; byId: Id; at: IsoDateTime }[];
  steps: FinStep[];
}

// ---------- Finance Phase 2, part 2 (Fauzan, 31 Oct 2026) ----------

/** Who signed what, with the comment every approval carries. */
/** What the Finance Director sets for the whole group (Fauzan, 1 Nov 2026: "put it under the FD to approve, review or set"). */
export interface FinSettingsValues {
  /** An approved payment not released within this many days goes back for approval (Fauzan, 1 Nov 2026: yes). */
  approvalExpiryDays: number;
  bankPackByDay: number;
  paymentPackByDay: number;
  monthlyPackByDay: number;
  ageingByDay: number;
  forecastByDay: number;
  eInvoiceCheckByDay: number;
  matchDays: number;
  unclearedDays: number;
  varianceMinRm: number;
  variancePct: number;
  sstThreshold: number;
  writeOffMinEvidence: number;
  /** Who issues self-billed e-Invoices for foreign suppliers and agents (a role or team, as the FD decides). */
  selfBilledBy: string;
  /**
   * Where payments are approved (Fauzan, 1 Nov 2026: "we have both mechanism but FD or CEO can choose which mechanism
   * it needed for approval"). One place per payment, never both: 'prima' = the approver approves in Prima; 'teams' = the
   * approver approves in Teams and Prima records that result (only once the Teams connection is switched on).
   */
  approvalMethod: FinApprovalMethod;
  /** Automation (Fauzan, 1 Nov 2026): a payment waiting this many days for review or approval is shown to the FD and the CEO. */
  escalateAfterDays: number;
  /** The month-end close should be approved by this day of the next month; after it the FD and the CEO are told. */
  closeApproveByDay: number;
  /** A budget variance is explained by its owner (the team leader) by this day of the month after. */
  varianceByDay: number;
  /**
   * KPI targets in office minutes (Fauzan, 1 Nov 2026: "optimum but reasonable ... by the minutes, not hours ... it can
   * be done in 20 minutes"), from when the work reaches the person, counted only in office hours. PROVISIONAL.
   * Approvals are not timed (Fauzan, 1 Nov 2026: "approve wait time will not be measured. their work end at their part").
   */
  /** Petty cash limits and next year's budget day, set by the Finance Director (Fauzan, 2 Nov 2026). */
  pettyVoucherMax: number;
  pettyFloatMax: number;
  budgetByDecDay: number;
  kpiReviewMinutes: number;
  kpiReleaseMinutes: number;
  kpiReworkMinutes: number;
  kpiCloseReviewMinutes: number;
  /** Share of payments and closes accepted without being returned (%). */
  kpiFirstPassPct: number;
}
export type FinApprovalMethod = 'prima' | 'teams';
export interface FinSettings {
  values: Partial<FinSettingsValues>;
  set: FinSign;
  history: { values: Partial<FinSettingsValues>; set: FinSign }[];
}
/**
 * Approval value limits the CEO sets in the app (Fauzan, 3 Nov 2026: "will set later in the app ... setting button for
 * the CEO to decide"). Null = no limit, which keeps today's rule: the COO approves every staff claim and the COO and the
 * CEO approve every purchase. A claim at or below claimsMax is final once HR has checked it and the company head has
 * verified it (no COO step); a purchase at or below purchasesMax needs the COO only (no CEO step).
 */
export interface ApprovalLimits {
  claimsMax: number | null;
  purchasesMax: number | null;
  set: FinSign | null;
  history: { claimsMax: number | null; purchasesMax: number | null; set: FinSign | null }[];
}
export interface FinSign {
  by: string;
  byId: Id;
  at: IsoDateTime;
  comment: string;
}

/**
 * An approval given in Microsoft Teams (Approvals) or a SharePoint request list, linked to a Prima payment. Prima does
 * not read Teams yet: a Finance person records the link and each approver's decision and comment as shown there.
 */
/**
 * A Teams approval result as Prima reads it from the protected SharePoint results list (Microsoft Graph v1.0 list item
 * and its versions). Only the Finance flow's service account adds these. Design: docs/TEAMS_APPROVALS_INTEGRATION.md.
 */
export interface FinTeamsResultItem {
  itemId: string;
  etag: string;
  createdById: string;
  lastModifiedById: string;
  createdAt: IsoDateTime;
  modifiedAt: IsoDateTime;
  /** Versions SharePoint holds for the item; null = could not be read (not trusted). */
  versionCount: number | null;
  approvalId: string;
  outcome: string;
  completionDate: IsoDateTime | null;
  requestItemId: string;
  requestVersion: string;
  fingerprint: string;
  paymentId: Id;
  companyId: Id;
  /** The approvers the flow actually assigned (Entra object IDs). */
  assignedTo: string[];
  responses: { objectId: string; upn: string; response: string; comment: string; responseDate: IsoDateTime | null }[];
}
/** The request row Finance staff added (requests list). Prima never takes an outcome from it. */
export interface FinTeamsRequestItem {
  itemId: string;
  version: string;
  createdById: string;
  modifiedAt: IsoDateTime;
  paymentId: Id;
  companyId: Id;
  fingerprint: string;
}
export type FinTeamsVerdict = 'approved' | 'rejected' | 'not_approved' | 'void';
/** What Prima concluded from a Teams result, kept on the payment with every failed check. */
export interface FinTeamsRead {
  approvalId: string;
  resultItemId: string;
  requestItemId: string;
  requestVersion: string;
  fingerprint: string;
  etag: string;
  /** A hash of every field at first read; a different hash later voids the result. */
  fieldsHash: string;
  outcome: string;
  completedAt: IsoDateTime | null;
  responses: { approver: string; objectId: string; response: string; comment: string; at: IsoDateTime | null }[];
  verdict: FinTeamsVerdict;
  failures: string[];
  readAt: IsoDateTime;
}

export interface FinExternalApproval {
  system: 'teams' | 'sharepoint';
  url: string;
  /** The request number or title in SharePoint or Teams. */
  requestRef: string;
  decisions: { approver: string; decision: 'approved' | 'rejected'; comment: string; decidedOn: IsoDate }[];
  recordedBy: string;
  recordedById: Id;
  recordedAt: IsoDateTime;
}

/**
 * A payee whose bank details have been checked (paid to the right person). Prima keeps only the bank and the last 4
 * digits; the full number stays in SQL Account and the bank portal. One person enters it, a different person verifies
 * it by calling back on a number from an independent source; until then nobody can pay it.
 */
export interface FinPayee {
  id: Id;
  name: string;
  kind: FinPayeeKind;
  /** Registration number (SSM, KWSP employer number, LHDN or Customs) to tell payees with similar names apart. */
  regNo: string;
  bank: string;
  accountLast4: string;
  /** The name the bank shows for the account (DuitNow or the bank portal's name check), as recorded. */
  accountName: string;
  status: 'pending' | 'verified' | 'blocked';
  entered: FinSign;
  verified: (FinSign & { method: 'callback' | 'document' | 'bank_name_check'; contact: string; numberSource: string }) | null;
  /** Earlier bank details, kept for the audit trail. */
  history: { bank: string; accountLast4: string; accountName: string; until: IsoDateTime; by: string }[];
}

/** One line of a bank statement as loaded from the bank's CSV. Money out is negative. */
export interface FinStatementLine {
  id: Id;
  date: IsoDate;
  description: string;
  ref: string;
  amount: number;
  match:
    | { kind: 'payment'; paymentId: Id; by: string; at: IsoDateTime }
    | { kind: 'other'; note: string; by: string; byId: Id; at: IsoDateTime; ruleId?: Id }
    /** Money in matched to a customer receipt recorded on an invoice case (Fauzan, 1 Nov 2026). */
    | { kind: 'receipt'; caseId: Id; receiptId: Id; by: string; at: IsoDateTime }
    /** A direct debit on the regular payments list (hire purchase, loan, bill), found by Prima (Fauzan, 2 Nov 2026). */
    | { kind: 'regular'; regularId: Id; period: string; by: string; at: IsoDateTime }
    /** Cash collateral of an insurance or bank guarantee paid back, found by Prima. */
    | { kind: 'guarantee'; guaranteeId: Id; by: string; at: IsoDateTime }
    /** A hostel bill the company paid itself, found by Prima on the company's bank statement. */
    | { kind: 'hostel'; hostelBillId: Id; by: string; at: IsoDateTime }
    /** A client deposit or retention paid back, found by Prima (Fauzan, 2 Nov 2026: suggestion 3). */
    | { kind: 'deposit'; depositId: Id; by: string; at: IsoDateTime }
    /** A fixed deposit placed or uplifted, found by Prima (Fauzan, 2 Nov 2026: suggestion 15). */
    | { kind: 'fd'; fdId: Id; by: string; at: IsoDateTime }
    /** A government claim paid (Fauzan, 2 Nov 2026), found by Prima or linked by Finance. */
    | { kind: 'govt'; claimId: Id; by: string; byId?: Id; at: IsoDateTime }
    /** Money in that came with no invoice, allocated by Finance within 7 days and checked by someone else (Fauzan, 2 Nov 2026). */
    | { kind: 'allocated'; to: 'invoice' | 'intercompany' | 'refund' | 'other'; ref: string; payer: string; note: string; by: string; byId: Id; at: IsoDateTime; checked: FinSign | null }
    | null;
}

export interface FinMatchRule {
  id: Id;
  /** The account it applies to; null for every account of the company. */
  bankId: Id | null;
  /** Normalised words that must appear in the bank line's description or reference. */
  pattern: string;
  direction: 'in' | 'out';
  /** Lines above this amount are left for a person. */
  maxAmount: number;
  note: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  used: number;
}

/** One entry from SQL Account's ledger for the bank account (money in +, money out −, from the company's side). */
export interface FinLedgerLine {
  id: Id;
  date: IsoDate;
  docNo: string;
  description: string;
  amount: number;
  /** Set when it was still outstanding at an earlier month's reconciliation and carried forward. */
  carriedFrom?: string;
}
/**
 * Automatic bank reconciliation (Fauzan, 1 Nov 2026: "staff upload the bank statement and the system checks"). The
 * month's bank statement is matched line by line to SQL Account's ledger for that bank account; what is left over is
 * listed as payments not yet presented, deposits not yet credited, and bank items still to post in SQL Account.
 */
export interface FinBankRec {
  id: Id;
  bankId: Id;
  period: string;
  statementId: Id;
  ledgerOpening: number;
  ledgerClosing: number;
  ledger: FinLedgerLine[];
  /** Bank lines from earlier months still not in SQL Account (charges posted late), carried so they can match a later posting. */
  carriedBank?: (FinStatementLine & { carriedFrom: string })[];
  pairs: { lineIds: Id[]; ledgerIds: Id[]; how: 'reference' | 'amount_date' | 'hand'; by: string; byId: Id; at: IsoDateTime; note?: string }[];
  /** Bank-only items (charges, interest, standing orders) explained: posted in SQL Account under this reference, or why not. */
  explained: { lineId: Id; note: string; by: string; byId: Id; at: IsoDateTime }[];
  run: FinSign & { source: string };
  reviewed: FinSign | null;
  /** Revision, raised on every change; the reviewer signs the revision they read (review finding, 1 Nov 2026). */
  rev?: number;
  /** The statement version it was run against; a replaced statement makes it stale until run again. */
  statementVersion?: number;
  /** The earlier month's reconciliation its carried items came from, at the revision and statement version used. */
  carriedFromRec?: { id: Id; rev: number; statementVersion: number } | null;
  /** Everyone who ran it, matched, unmatched or explained in it: none of them reviews it. */
  contributors?: Id[];
}

/** A month's statement for one bank account, loaded into Prima to check payments reached the bank as approved. */
export interface FinStatement {
  id: Id;
  bankId: Id;
  period: string;
  opening: number;
  closing: number;
  lines: FinStatementLine[];
  loaded: FinSign & { source: string };
  /** Raised each time a different statement is loaded for the month (missing = 1); line ids carry it. */
  version?: number;
}

export interface FinAgeBuckets {
  current: number;
  d1to30: number;
  d31to60: number;
  d61to90: number;
  over90: number;
}

/** The month's receivable and payable ageing, from SQL Account's Aging Report, checked against the ledger. */
export interface FinAgeing {
  period: string;
  ar: FinAgeBuckets;
  ap: FinAgeBuckets;
  /** The debtors and creditors control balances in the general ledger at month end. */
  glAr: number;
  glAp: number;
  /** The SQL Account report filed (file name or SharePoint link). */
  source: string;
  note: string;
  prepared: FinSign;
  reviewed: FinSign | null;
}

/** One service tax return (SST-02) for a two-month taxable period. */
export interface FinSstReturn {
  id: Id;
  /** First and last month of the taxable period (YYYY-MM). */
  from: string;
  to: string;
  dueOn: IsoDate;
  /** Value of taxable services in the period (as SQL Account's SST listing shows it). */
  taxableValue: number;
  /**
   * Fauzan, 1 Nov 2026: SST is paid on money received. The money received in the period for taxable services, SST
   * included, and the SST shown on the invoices those receipts paid. Tax = 8/108 of the money received, and it must agree
   * with the invoices' SST (8% of the bill without SST). Older returns without them were prepared on value x rate.
   */
  received?: number | null;
  invoiceSst?: number | null;
  /** The rate used (8% for security services since 1 March 2024). */
  rate: number;
  /** Tax declared on the SST-02. */
  declared: number;
  /** Why the declared tax differs from value x rate (exempt or 6% services, credit notes, bad debt relief). */
  differenceNote: string;
  prepared: FinSign;
  reviewed: FinSign | null;
  /** Filed in MySST, with the acknowledgement reference. */
  filed: (FinSign & { ackRef: string; filedOn: IsoDate }) | null;
  /** The Prima payment to the Royal Malaysian Customs Department that pays it. */
  paymentId: Id | null;
}

/** A claim to the Royal Malaysian Customs Department for service tax back. */
export interface FinCustomsClaim {
  id: Id;
  kind: 'bad_debt_relief' | 'wrong_payment';
  amount: number;
  reason: string;
  /** The full document pack: invoices, receipts, the SST-02, payment proof, write-off approval, recovery evidence. */
  documents: string[];
  returnId: Id | null;
  caseId: Id | null;
  prepared: FinSign;
  /** Submitted to Customs (the claim reference), by someone other than the preparer. */
  submitted: (FinSign & { ref: string; on: IsoDate }) | null;
  /** Customs' answer. */
  result: (FinSign & { outcome: 'approved' | 'rejected'; amount: number; on: IsoDate }) | null;
}

export interface FinSst {
  registered: boolean;
  /** SST registration number (shown on invoices). */
  sstNo: string | null;
  /** The month the first taxable period starts (1 to 12): periods run two months from it. */
  cycleStartMonth: number;
  /** Taxable services billed over the last 12 months, to watch the registration threshold if not registered. */
  last12Months: number | null;
  returns: FinSstReturn[];
  /** Claims to Customs: bad debt relief or a wrong payment (Fauzan, 1 Nov 2026: full documents, Customs must approve, rarely recovered). */
  claims?: FinCustomsClaim[];
}

export const FIN_PLAN_LINES = [
  'revenue',
  'guard_cost',
  'staff_cost',
  'statutory',
  'premises',
  'vehicles',
  'equipment',
  'insurance',
  'other_opex',
  'finance_cost',
  'tax',
  'capex',
] as const;
export type FinPlanLine = (typeof FIN_PLAN_LINES)[number];
export type FinPlanFigures = Partial<Record<FinPlanLine, number[]>>;

/** The year's budget, the monthly actuals from SQL Account and the rolling forecasts. */
export interface FinPlan {
  year: number;
  budget: {
    months: FinPlanFigures;
    assumptions: string;
    status: 'draft' | 'submitted' | 'approved' | 'returned';
    /** Everyone who drafted or submitted this budget; none of them approves it (review finding, 1 Nov 2026). */
    authorIds?: Id[];
    /** Which of the two approvers (FD, CEO) drafted or sent it; both never do, or nobody could approve it. */
    leadAuthors?: ('director' | 'ceo')[];
    submitted?: FinSign | null;
    prepared: FinSign | null;
    approved: FinSign | null;
    returned: FinSign | null;
  };
  /** Actual per line per month, from the SQL Account profit and loss (12 slots; null = not closed yet). */
  actuals: Partial<Record<FinPlanLine, (number | null)[]>>;
  /**
   * Fauzan, 1 Nov 2026: forecasts are quarterly and yearly. A quarterly forecast re-forecasts the year after each quarter
   * closes (asOf March, June, September or December); the yearly forecast is the whole year's outlook, made before or as
   * the year starts. Older entries without `kind` were monthly re-forecasts and read as quarterly.
   */
  forecasts: { asOf: string; months: FinPlanFigures; note: string; by: FinSign; kind?: 'quarterly' | 'yearly' }[];
  /** Explanations for months whose actual is off the budget by more than the rule allows. */
  variances: {
    key: string;
    text: string;
    by: FinSign;
    /** The budget and actual the explanation was written for (review finding, 1 Nov 2026): changed figures need a new one. */
    figures?: { budget: number; actual: number | null };
    /** The FD's or CEO's acceptance, bound to the same figures. */
    accepted?: (FinSign & { figures: { budget: number; actual: number | null } }) | null;
  }[];  /** Approved budget revisions (FD and CEO both approve) and drafts; the budget itself is never changed (item 76/78, 3 Nov 2026). */
  revisions?: import('./finance-plan3').FinBudgetRevision[];
  /** Three-statement forecasts: P&L, balance sheet and cash flow linked, by scenario and version (item 78, 3 Nov 2026). */
  threeStatements?: import('./finance-plan3').FinThreeStatement[];
}

/** One company's books as SQL Account shows them, plus its auditor and tax agent papers. */
/** percent is of the billing for the sector's sites; fixed is RM a month for those sites, shared by hours worked. */
export interface ManagementFee {
  kind: 'percent' | 'fixed';
  value: number;
  agreementRef: string;
  by: string;
  at: IsoDateTime;
}

/** e-Invoice set-up for one company (Fauzan, 1 Nov 2026: e-Invoicing is mandatory and runs from SQL Account). */
export interface FinEInvoiceSetup {
  /** Must the company issue e-Invoices? */
  required: boolean;
  /** Why (its revenue, or a related company's revenue of RM3 million or more), as advised by the tax agent. */
  basis: string;
  /** The date it had to start issuing e-Invoices. */
  startOn: IsoDate | null;
  /** How documents reach MyInvois: SQL Account's MyInvois module (normal), the MyInvois Portal, or another system. */
  via: 'sql_account' | 'portal' | 'other';
  /** The company's own annual turnover used for the RM3 million test (each company is its own entity; Fauzan, 1 Nov 2026). */
  revenue?: number | null;
  set: FinSign;
}
/** One month's e-Invoice check, counted from SQL Account's MyInvois Transaction listing and Batch Check E-Invoice Status. */
export interface FinEInvoiceMonth {
  period: string;
  /** Sales documents (invoices, credit and debit notes) issued in SQL Account in the month. */
  issued: number;
  /** Of those: validated by LHDN, rejected as invalid, stuck in "Submitting", or never submitted. */
  valid: number;
  invalid: number;
  submitting: number;
  notSubmitted: number;
  /** Was there anything to consolidate (sales to buyers who did not ask for an e-Invoice)? */
  consolidatedNeeded: boolean;
  /** The monthly consolidated e-Invoice: its MyInvois UUID and the date it was submitted. */
  consolidated: { uuid: string; submittedOn: IsoDate } | null;
  /** Single sales above RM10,000 that went into the consolidated e-Invoice (should have their own). */
  largeInConsolidated: number;
  /** Self-billed e-Invoices needed (foreign suppliers and agents, payouts to agents or dealers, and similar) and validated. */
  selfBilledNeeded: number;
  selfBilledValid: number;
  /** Supplier invoices posted in the month with no validated e-Invoice from the supplier. */
  suppliersWithout: number;
  /** e-Invoices cancelled after the 72-hour window (should have been a credit note). */
  lateCancels: number;
  source: string;
  note: string;
  prepared: FinSign;
  reviewed: FinSign | null;
  /** Revision, raised on every new set of counts; the reviewer signs the revision they read (review finding, 1 Nov 2026). */
  rev?: number;
  /** A reviewed month reopened by the team leader, the Finance Director or the CEO, with the reason. */
  reopened?: (FinSign & { rev: number })[];
}
export interface FinEInvoice {
  setup: FinEInvoiceSetup | null;
  months: FinEInvoiceMonth[];
}

/** Why a customer invoice is stuck (Fauzan, 1 Nov 2026). */
export type FinArReason = 'wrong_payer' | 'site_changed' | 'dispute' | 'refused' | 'insolvent' | 'govt_late' | 'other';
export type FinArStatus = 'open' | 'reissue_pending' | 'provision_pending' | 'writeoff_pending' | 'reissued' | 'written_off' | 'recovered' | 'closed';
/** One customer invoice that is not being paid, and what Finance does about it. Nothing is ever deleted. */
export interface FinArCase {
  id: Id;
  /** The SQL Account invoice number, its date and the customer billed. */
  invoiceNo: string;
  invoiceDate: IsoDate;
  customer: string;
  amount: number;
  /** Still unpaid. */
  outstanding: number;
  /** The invoice's e-Invoice UUID, if it was validated. */
  eInvoiceUuid: string | null;
  reason: FinArReason;
  detail: string;
  status: FinArStatus;
  opened: FinSign;
  /** Every follow-up: reminders, calls, demand letters, lawyer's letters, payments, decisions. */
  log: { kind: string; text: string; by: string; byId: Id; at: IsoDateTime; on?: IsoDate }[];
  /** Next follow-up date the team set. */
  nextOn: IsoDate | null;
  /**
   * Customer money recorded as received (Fauzan, 1 Nov 2026: "no one person can do it ... must link to bank statements").
   * A receipt reduces what is unpaid only once Prima finds it on the loaded bank statement (same account, same amount,
   * within the matching days); until then it is waiting, and after the uncleared days it is a close exception.
   */
  receipts?: { id: Id; amount: number; ref: string; on: IsoDate; bankId: Id; by: string; byId: Id; at: IsoDateTime; matched: { statementId: Id; lineId: Id; date: IsoDate } | null }[];
  /** Re-issue to the right payer: credit note (or cancellation within 72 hours) and the new invoice. */
  reissue: {
    method: 'credit_note' | 'cancel72h';
    creditNoteNo: string | null;
    creditNoteDate: IsoDate;
    newInvoiceNo: string;
    newCustomer: string;
    newAmount: number;
    note: string;
    requested: FinSign;
    approved: FinSign | null;
  } | null;
  /** Doubtful debt provision (impairment) in the accounts. */
  provision: { amount: number; requested: FinSign; approved: FinSign | null } | null;
  /** Bad debt write-off: the recovery evidence, approval by the Finance Director or the CEO, and SST relief if tax was paid. */
  writeOff: {
    amount: number;
    evidence: string[];
    steps: string;
    sqlRef: string;
    requested: FinSign;
    approved: FinSign | null;
    /** Service tax already paid to Customs on this invoice (payment received, or the 12-month rule). */
    sstPaid: number;
    /** The Customs claim prepared for it (its id in the SST claims). */
    sstRelief: { ref: string; on: IsoDate; by: string } | null;
  } | null;
}

/** One step on a payment request (Fauzan, 1 Nov 2026). */
export interface FinRequestStep {
  step: 'head_approved' | 'verified' | 'approved' | 'returned' | 'resubmitted' | 'cancelled' | 'payment_linked';
  by: string;
  byId: Id;
  at: IsoDateTime;
  comment: string;
}

/**
 * A payment request created by the company head (Fauzan, 1 Nov 2026): department head, then Finance checks the
 * calculation, then the COO (or the FD for Finance) approves, then Finance pays it. See finance-requests.ts.
 */
export interface FinRequest {
  id: Id;
  companyId: Id;
  subject: FinSubject;
  /** Operations only: government sites (the OGM approves) or private sites (the Operations Director approves). */
  sector: 'government' | 'private' | null;
  title: string;
  purpose: string;
  amount: number;
  payee: string;
  dueOn: IsoDate;
  /** How the amount was worked out; Finance checks it. */
  calc: string;
  evidence: string[];
  status: 'head_review' | 'finance_verify' | 'final_approval' | 'approved' | 'returned' | 'cancelled';
  created: { by: string; byId: Id; at: IsoDateTime; comment: string };
  steps: FinRequestStep[];
  /** The Finance payment prepared from it, once approved. */
  paymentId: Id | null;
}

export interface FinStatus {
  id: Id;
  /** The company, or 'pwvsb' for PWVSB itself. */
  companyId: Id;
  /**
   * The management fees the operations companies bill this company, entered by the Finance Director or the CEO from the
   * signed management agreements (Fauzan, 2 Nov 2026): Goodwill Empire for its government sites, Sasa Team for its
   * private sites. Never guessed: until a fee is entered, those sites' profit and loss stays Unknown.
   */
  managementFees?: { goodwill?: ManagementFee | null; sasateam?: ManagementFee | null };
  /** The Finance team (1 to 7) that keeps this company's books. */
  team: number;
  /** Financial year end as MM-DD. */
  fyEnd: string;
  /** Last time Prima received this company's figures from SQL Account; null means never. */
  sqlLastAt: IsoDateTime | null;
  /** Last month end closed in SQL Account. */
  closedTo: IsoDate | null;
  banks: FinBankAccount[];
  /** Last month: what Prima knows was billed or paid, against what is posted in SQL Account. */
  posting: {
    period: string;
    billed: number;
    billedPosted: number;
    staffPayPaid: boolean;
    staffPayPosted: boolean;
    guardPayPaid: boolean;
    guardPayPosted: boolean;
    supplierBillsUnposted: number;
  };
  /** Integrity tests at the last month end (V6): the difference in RM; null means not run. */
  tests: { id: string; label: string; diff: number | null }[];
  arOver90: number;
  apOverdue: number;
  audit: FinPackItem[];
  tax: FinPackItem[];
  /** Phase 2: the monthly bank pack and payment pack items, the payments asked for, and the month-end closes. */
  bank?: FinPackItem[];
  payment?: FinPackItem[];
  payments?: FinPayment[];
  /** Payment requests from the company head (Fauzan, 1 Nov 2026). */
  requests?: FinRequest[];
  closes?: FinClose[];
  /** Part 2 (31 Oct 2026): verified payees, loaded bank statements, monthly ageing, SST and the financial plan. */
  monthly?: FinPackItem[];
  payees?: FinPayee[];
  statements?: FinStatement[];
  /** Automatic bank reconciliations: the bank statement against SQL Account's bank ledger (Fauzan, 1 Nov 2026). */
  bankRecs?: FinBankRec[];
  /**
   * Learned explanations (automation A6, Fauzan 2 Nov 2026): once a reviewer explains a line such as "TNB" or a bank
   * charge and asks Prima to remember it, the same kind of line on later statements is explained by Prima, up to a cap.
   */
  matchRules?: FinMatchRule[];
  /** Tax and statutory filings Finance recorded against the calendar (A10, 2 Nov 2026). */
  taxFilings?: import('./finance-tax-calendar').FinTaxFiling[];
  /** Teams approval results already used (approval ID and results item, once each, for one payment revision). */
  teamsSeen?: { approvalId: string; resultItemId: string; paymentId: Id; fingerprint: string; at: IsoDateTime }[];
  ageing?: FinAgeing[];
  sst?: FinSst;
  plans?: FinPlan[];
  /** e-Invoice (LHDN MyInvois, sent from SQL Account): whether the company must issue them, and the monthly check. */
  einvoice?: FinEInvoice;
  /** Invoice problems (1 Nov 2026): wrong payer or site, disputes, refusals, insolvency; re-issue, provision, bad debt. */
  arCases?: FinArCase[];
  /** The last financial year end whose audited accounts are signed: nothing on or before it is changed. */
  auditedTo?: { date: IsoDate; set: FinSign } | null;
  /** The Finance Director's (or CEO's) monthly review of invoices unpaid over 90 days (Fauzan, 1 Nov 2026). */
  arReviews?: { month: string; sign: FinSign; cases: number; unpaid: number }[];
  /** Group Finance settings, kept on PWVSB's own row only. The Finance Director (or the CEO) sets them (Fauzan, 1 Nov 2026). */
  settings?: FinSettings;
  /** Group row only: the CEO's approval value limits (Fauzan, 3 Nov 2026). See ApprovalLimits. */
  approvalLimits?: ApprovalLimits;
  /** Regular payments: hire purchase, loans, bills, rent, insurance, statutory, zakat, tax, levy (Fauzan, 2 Nov 2026). */
  regular?: FinRegular[];
  /** PWVSB's row only: EPF and PERKESO contribution tables loaded from the published schedules, every version kept. */
  statutoryTables?: import('./statutory-tables').StatTable[];
  /** The employer's own registration numbers for the contribution files (EPF, PERKESO, LHDN E number, HRD Corp). */
  employerNos?: { epf: string | null; socso: string | null; lhdnE: string | null; hrd: string | null; set: { by: string; byId: Id; at: IsoDateTime } } | null;
  /** Insurance guarantees (IG) and bank guarantees (BG) with their cash collateral (Fauzan, 2 Nov 2026). */
  guarantees?: FinGuarantee[];
  /** Deposits and retention sums held by clients (Fauzan, 2 Nov 2026: suggestion 3). */
  clientDeposits?: import('./finance-contract-end').FinClientDeposit[];
  /** Fixed deposits, and what each bank agreed to charge with the months explained (Fauzan, 2 Nov 2026: suggestions 15, 16). */
  fixedDeposits?: import('./finance-banking').FinFixedDeposit[];
  chargeTerms?: import('./finance-banking').FinChargeTerms[];
  /** Withholding tax on payments to non-residents, prepayments and accruals, fixed assets and auditor requests (Fauzan, 2 Nov 2026: suggestions 18, 21, 22, 23). */
  wht?: import('./finance-yearend').FinWht[];
  schedules?: import('./finance-yearend').FinSchedule[];
  fixedAssets?: import('./finance-yearend').FinAsset[];
  faAgreed?: { year: number; sqlCost: number; listCost: number; diff: number; sign: FinSign }[];
  auditRequests?: import('./finance-yearend').FinAuditRequest[];
  /** Credit limits per private client and the posts added after a Finance warning (Fauzan, 2 Nov 2026: suggestion 4). */
  creditLimits?: import('./finance-credit').FinCreditLimit[];
  creditOverrides?: import('./finance-credit').FinCreditOverride[];
  /** Quarterly supplier statement checks for the biggest suppliers (Fauzan, 2 Nov 2026: suggestion 11). */
  supplierChecks?: import('./finance-supplier-statements').FinSupplierCheck[];
  /** The company's tax size (SME or not), recorded by the FD (Fauzan, 2 Nov 2026). */
  taxProfile?: import('./finance-yearend').FinTaxProfile | null;
  chargeReviews?: import('./finance-banking').FinChargeReview[];
  /** Statement figures per month from the SQL Account reports (or a connector read), for FS-01 to FS-12 (3 Nov 2026). */
  ledgerFigures?: import('./finance-ledger').FinLedgerFigures[];
  /** Chart of accounts and cost dimension mapping, every version kept (3 Nov 2026). */
  coaMaps?: import('./finance-ledger').FinCoaMap[];
  /** The company's SQL Account edition, modules and API, recorded and confirmed (3 Nov 2026). */
  sqlDiscovery?: import('./finance-ledger').FinSqlDiscovery | null;
  /** Every SQL Account connector read, accepted or rejected (append only). */
  sqlSyncs?: import('./finance-ledger').FinSqlSync[];
  /** Bank mandates (who signs and approves for each account), every version kept (Fauzan, 2 Nov 2026). */
  mandates?: FinMandate[];
  /** Staff cash advances, petty cash floats and company cards (Fauzan, 2 Nov 2026). */
  advances?: FinAdvance[];
  pettyCash?: FinPettyCash[];
  cards?: FinCard[];
  /** Each contract's monthly invoice in SQL Account, or why there is none (Fauzan, 2 Nov 2026). */
  billing?: import('./finance-billing').FinBillingLine[];
  /** Claims submitted to government clients and their follow-up until paid (Fauzan, 2 Nov 2026). */
  govtClaims?: import('./finance-billing').FinGovtClaim[];
  /** Agreements to stamp, their STAMPS certificates, and refunds of duty on cancelled agreements (Fauzan, 2 Nov 2026). */
  stampDuty?: import('./finance-stamp').FinStampItem[];
  /** Daily cash pay lists: Finance lists, the FD approves, the COO or CEO pays (Fauzan, 2 Nov 2026). */
  dailyCash?: import('./finance-daily-cash').FinDailyCashList[];
  /** Intercompany month-end balances, kept on PWVSB's row for the whole group (Fauzan, 2 Nov 2026). */
  intercompany?: import('./finance-intercompany').FinIcEntry[];
  icExplained?: import('./finance-intercompany').FinIcExplain[];
  /** 13-week cash forecast: Finance's own lines and the weekly reviews (Fauzan, 2 Nov 2026). */
  cash13?: import('./finance-forecast13').FinCash13Line[];
  cash13Reviews?: (FinSign & { lowest: number; firstShortWeek: number | null })[];
  /** Monthly packs reviewed for the board, with the figures as reviewed (Fauzan, 2 Nov 2026). */
  packReviews?: import('./finance-pack').FinPackReview[];
}

// ---------- Regular payments and guarantees (Fauzan, 2 Nov 2026) ----------

export type FinRegularKind = 'hire_purchase' | 'loan' | 'bill' | 'rent' | 'insurance' | 'statutory' | 'zakat' | 'tax' | 'levy' | 'other';
export type FinRegularEvery = 'monthly' | 'quarterly' | 'yearly';

/** One due date of a regular payment. */
export interface FinRegularDue {
  /** The month the payment falls due, YYYY-MM. */
  period: string;
  dueOn: IsoDate;
  /** For an amount that varies (a bill, a contribution file, a zakat list): what was billed this time, with its document. */
  bill?: (FinSign & { amount: number; doc: string; unusual: string | null }) | null;
  /** The Prima payment that pays it (transfers). */
  paymentId?: Id | null;
  /** A direct debit Prima found on the bank statement. */
  debited?: { statementId: Id; lineId: Id; date: IsoDate } | null;
}

/**
 * Something the company pays again and again (Fauzan, 2 Nov 2026: hire purchase, bills, building loans, PCB, zakat,
 * insurance). Somebody other than the person who entered it checks it before Prima counts on it. Transfers are paid as
 * ordinary Prima payments for the due amount; direct debits are found on the bank statement by Prima. Statutory, zakat,
 * tax and levy payments are Finance payments, approved by the Finance Director (or the CEO).
 */
export interface FinRegular {
  id: Id;
  companyId: Id;
  kind: FinRegularKind;
  name: string;
  payeeId: Id;
  payee: string;
  /** Agreement, account, policy or employer number (never a bank account number). */
  reference: string;
  /** Who is paid, for statutory and zakat: EPF, PERKESO, HRD Corp, LHDN PCB, LHDN CP204; Zakat Kuala Lumpur, etc. */
  body: string | null;
  /** Zakat: deducted from staff salaries, or the company's own business zakat. */
  zakatFor: 'staff' | 'business' | null;
  /** EPF, PERKESO, LHDN PCB or HRD Corp worked out by the staff payroll: Prima fills each month's amount (A1). */
  fromPayroll?: boolean;
  method: 'direct_debit' | 'transfer';
  bankId: Id;
  every: FinRegularEvery;
  dueDay: number;
  firstDue: IsoDate;
  lastDue: IsoDate | null;
  /** A fixed instalment; null when it varies and each bill or contribution file gives the amount. */
  amount: number | null;
  /** Hire purchase and loans: what was financed, how many instalments, and the asset or property it is secured on. */
  financed: { principal: number; instalments: number; security: string } | null;
  /** Insurance: when the policy ends and must be renewed. */
  expiresOn: IsoDate | null;
  subject: FinSubject;
  status: 'pending' | 'active' | 'ended';
  added: FinSign;
  checked: FinSign | null;
  ended: FinSign | null;
  dues: FinRegularDue[];
}

/**
 * An insurance guarantee (IG) or bank guarantee (BG) given to a client, usually for a contract or a tender (Fauzan,
 * 2 Nov 2026: "IG can claim back the cash collateral when the IG is expired or released from client"). Prima watches the
 * expiry, the client's release letter, the claim for the collateral and finds the refund on the bank statement.
 */
export interface FinGuarantee {
  id: Id;
  companyId: Id;
  kind: 'IG' | 'BG';
  issuer: string;
  number: string;
  /** The client it is given to. */
  beneficiary: string;
  /** The contract it secures, when known: its release opens when the contract ends (Fauzan, 2 Nov 2026: suggestion 24). */
  contractId?: Id | null;
  /** The contract or tender it secures. */
  purpose: string;
  amount: number;
  /** Cash placed with the issuer as collateral (0 when none), paid back when the guarantee ends. */
  collateral: number;
  /** The account the collateral is paid back into. */
  bankId: Id;
  issuedOn: IsoDate;
  expiresOn: IsoDate;
  status: 'pending' | 'active' | 'released' | 'claimed' | 'refunded' | 'called' | 'ended';
  added: FinSign;
  checked: FinSign | null;
  release: (FinSign & { on: IsoDate; doc: string }) | null;
  claim: (FinSign & { on: IsoDate; ref: string; docs: string[] }) | null;
  refund: { statementId: Id; lineId: Id; date: IsoDate; amount: number } | null;
  called: (FinSign & { amount: number; doc: string }) | null;
  extensions: (FinSign & { from: IsoDate; to: IsoDate; doc: string })[];
}

// ---------- Money outside the payment flow, and bank mandates (Fauzan, 2 Nov 2026: suggestions 6, 7, 8, 9, 14) ----------

export type FinMandateRole = 'signatory' | 'portal_maker' | 'portal_approver';
/** One person on a bank account's mandate: a cheque signatory, or a bank portal maker or approver. */
export interface FinMandatePerson {
  /** Their Prima account, when they have one (so Prima sees when they leave); null for an outside director. */
  userId: Id | null;
  name: string;
  role: FinMandateRole;
  /** The most they may approve alone, from the mandate; null means no personal limit. */
  limit: number | null;
}
/**
 * Who the bank lets sign and approve for one account, as the bank holds it (the board resolution and mandate form).
 * A new version is checked by a second person; it is reviewed every year and whenever someone on it leaves.
 */
export interface FinMandate {
  id: Id;
  bankId: Id;
  version: number;
  /** One approver, or two together; `twoAbove` makes two needed above that amount even when one is enough below it. */
  rule: 'any_one' | 'any_two';
  twoAbove: number | null;
  people: FinMandatePerson[];
  /** The board resolution and the bank's mandate form (file names or SharePoint links). */
  docs: string[];
  status: 'pending' | 'active' | 'replaced' | 'rejected';
  added: FinSign;
  checked: FinSign | null;
  /** The last yearly (or leaver) review that confirmed the bank still holds exactly this list. */
  reviewed: FinSign | null;
}
/** A staff cash advance (travel, site start-up): paid as a normal Prima payment, settled with receipts by a due date. */
export interface FinAdvance {
  id: Id;
  /** The staff member's Prima account (so their home shows it); null when they have none. */
  userId: Id | null;
  name: string;
  purpose: string;
  amount: number;
  /** The Prima payment that pays it out (its approval is the advance's approval). */
  paymentId: Id;
  settleBy: IsoDate;
  status: 'open' | 'submitted' | 'settled' | 'recovered' | 'cancelled';
  added: FinSign;
  /** What the staff member spent (with receipts) and paid back; extra spending is claimed as a normal staff claim. */
  settlement: (FinSign & { spent: number; receipts: string[]; returned: number; returnRef: string | null; extra: number }) | null;
  /** The second person who checked the receipts and the cash returned. */
  checked: FinSign | null;
  /** Not settled in time: recovered from salary or written off with the Finance Director's (or CEO's) approval. */
  recovered: (FinSign & { how: 'payroll' | 'repaid' | 'written_off'; ref: string }) | null;
}
export interface FinPettyVoucher {
  id: Id;
  date: IsoDate;
  amount: number;
  purpose: string;
  receipt: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** The top-up payment that paid it back to the float; null until then. */
  topUpId: Id | null;
}
/** One office's petty cash: a fixed float kept by a custodian, topped up only by the receipts spent, counted monthly. */
export interface FinPettyCash {
  id: Id;
  office: string;
  custodianId: Id;
  custodian: string;
  /** The custodian as a payee, so a top-up is an ordinary Prima payment. */
  payeeId: Id;
  bankId: Id;
  float: number;
  status: 'pending' | 'active' | 'closed';
  added: FinSign;
  checked: FinSign | null;
  vouchers: FinPettyVoucher[];
  topUps: { paymentId: Id; voucherIds: Id[]; amount: number; at: IsoDateTime }[];
  /** Monthly cash counts by someone other than the custodian. */
  counts: (FinSign & { on: IsoDate; cash: number; expected: number; diff: number })[];
}
export interface FinCardLine {
  id: Id;
  date: IsoDate;
  merchant: string;
  amount: number;
  receipt: string | null;
  purpose: string | null;
  /** The holder (or the reviewer) says it was personal: it is paid back by the holder. */
  personal: boolean;
  explained: FinSign | null;
  recovered: (FinSign & { how: 'payroll' | 'repaid'; ref: string }) | null;
}
export interface FinCardStatement {
  id: Id;
  period: string;
  total: number;
  doc: string;
  lines: FinCardLine[];
  loaded: FinSign;
  reviewed: FinSign | null;
}
/** A company credit or fuel card: every line needs a receipt and purpose from the holder, reviewed by someone else. */
export interface FinCard {
  id: Id;
  kind: 'credit' | 'fuel';
  issuer: string;
  last4: string;
  holderId: Id;
  holder: string;
  limit: number;
  status: 'pending' | 'active' | 'cancelled';
  added: FinSign;
  checked: FinSign | null;
  statements: FinCardStatement[];
}

// ---------- JA Group app feed (Fauzan, 26 Oct 2026) ----------
// Guard-to-officer payroll, foreign worker management and incidents live in the JA Group app. It sends their data to
// Prima by API; Prima shows it read-only and never edits it.

export type JaDataset = 'payroll' | 'worker' | 'incident' | 'guard' | 'paySummary';

/**
 * One guard's or officer's pay for one month from the JA Group app (dataset pay-summary in the JA data request), so
 * Operations can check it against the hours clocked (Fauzan, 2 Nov 2026). Amounts in RM; no bank or IC details.
 */
export interface JaPaySummary {
  staffNo: string;
  period: string;
  basic: number;
  otHours: number;
  otPay: number;
  allowances: number;
  deductions: { kind: string; amount: number }[];
  gross: number;
  net: number;
  paidOn: IsoDate | null;
}

/** One company's guard and officer payroll for one month, totals only (no payslip lines). */
export interface JaPayroll {
  period: string;
  headcount: number;
  gross: number;
  net: number;
  employerEpf: number;
  employerSocso: number;
  employerEis: number;
  /** Employee shares, sent separately so normal SOCSO and LINDUNG 24 Jam stay in their own columns. */
  employeeSocso?: number;
  employeeLindung?: number;
  employeeEis?: number;
  pcb: number;
  status: 'draft' | 'approved' | 'paid';
  approvedBy?: string | null;
  approvedAt?: IsoDateTime | null;
  paidOn?: IsoDate | null;
}

export type JaPaper = 'PLKS' | 'PASSPORT' | 'FOMEMA' | 'FWIG' | 'SPIKPA' | 'KDN_LETTER';

/** One foreign worker as the JA app holds them: papers with expiry dates, status and where they are. */
export interface JaWorker {
  staffNo: string;
  name: string;
  nationality: string;
  status: 'active' | 'home_leave' | 'exit_pending' | 'exited' | 'absconded' | 'other';
  serviceYear?: number | null;
  siteCode?: string | null;
  hostel?: string | null;
  papers: { paper: JaPaper; expiresOn: IsoDate | null; renewalSubmittedOn?: IsoDate | null }[];
}

/**
 * One guard or officer as the JA app holds them (HR Phase 3, slice 3G; Fauzan 2 Nov 2026: key in once). Prima files
 * each part where it belongs: the person record every department reads, the full IC and salary account behind the HR
 * wall, and the KDN card, vetting, CSG and TNG with the guard's papers. The JA record Prima keeps holds masked numbers only.
 */
export interface JaGuard {
  staffNo: string;
  name: string;
  nationality: string;
  role: 'guard' | 'supervisor' | 'patrol_officer';
  status: 'active' | 'suspended' | 'left';
  dob: IsoDate;
  hiredOn: IsoDate;
  /** The state the guard works in, to place them in a branch and in the OM's area. */
  state: string | null;
  siteCode: string | null;
  phone: string | null;
  /** Masked here; the full number goes only behind the HR wall. */
  idMasked: string;
  basicPay: number | null;
  bankName: string | null;
  /** Masked here; the full account goes only behind the HR wall. */
  accountMasked: string | null;
  epfNo: string | null;
  socsoNo: string | null;
  kdnCard: { number: string; issuedOn: IsoDate; expiresOn: IsoDate } | null;
  vettingSubmittedOn: IsoDate | null;
  vettingRef: string | null;
  csg: { certificateNo: string; doneOn: IsoDate } | null;
  tng: { certificateNo: string; doneOn: IsoDate } | null;
  /** Prima's person id the record was filed to. */
  personId?: Id;
}

export interface JaIncident {
  occurredAt: IsoDateTime;
  siteCode?: string | null;
  category: string;
  severity: Severity;
  status: 'open' | 'closed';
  summary: string;
  reportedBy?: string | null;
  closedAt?: IsoDateTime | null;
}

export interface JaRecord {
  /** ja:<dataset>:<companyId>:<externalId> */
  id: Id;
  companyId: Id;
  dataset: JaDataset;
  externalId: string;
  /** When the JA app last changed the record, as it says. */
  sourceUpdatedAt: IsoDateTime;
  receivedAt: IsoDateTime;
  payroll?: JaPayroll;
  worker?: JaWorker;
  incident?: JaIncident;
  guard?: JaGuard;
  paySummary?: JaPaySummary;
}

/** One delivery from the JA app: what came, what was kept and why anything was refused. */
export interface JaSync {
  id: Id;
  at: IsoDateTime;
  dataset: JaDataset;
  received: number;
  accepted: number;
  rejected: { externalId: string; reason: string }[];
  /** Companies this delivery covers in full, even with no records (a company with nothing to report is then current, not unknown). */
  covered?: Id[];
}

// ---------- Asset Management (Fauzan, 26 Oct 2026) ----------
// Group rental units, movable (non-electronic) assets, resorts, orchards and the training facility. Run by the Asset
// Management department in its own system (built by a developer); Prima shows it to group leadership and finance only.

export type AmUnitType = 'COMMERCIAL' | 'RESIDENTIAL' | 'INDUSTRIAL' | 'LAND';
export type AmUnitStatus = 'let' | 'vacant' | 'maintenance' | 'reserved';

export interface AmInvoice {
  period: string;
  amount: number;
  paid: number;
  paidOn: IsoDate | null;
}

/**
 * A rent payment recorded by the rental team (Fauzan, 27 Oct 2026), set against the oldest unpaid months first. Cash
 * needs a receipt number and stays "to bank in" until Finance records the bank-in slip.
 */
export interface AmPayment {
  id: Id;
  on: IsoDate;
  amount: number;
  method: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'ONLINE';
  receiptNo: string;
  ref: string;
  /** Which months it paid, and how much of each. */
  applied: { period: string; amount: number }[];
  by: string;
  at: IsoDateTime;
  /** Finance confirms every payment in the bank: cash by the bank-in slip, others by the statement (insider abuse audit). */
  banked: { on: IsoDate; slipRef: string; by: string } | null;
  /** A reversal the team asked for, waiting for the Asset Director (insider abuse audit, 27 Oct 2026). */
  reversal?: { by: string; at: IsoDateTime; reason: string } | null;
  reversed: { by: string; at: IsoDateTime; reason: string } | null;
}

/** What was done about unpaid rent. A reminder letter or notice of demand needs the Asset Director's approval. */
export interface AmFollowUp {
  id: Id;
  on: IsoDate;
  action: 'CALL' | 'MESSAGE' | 'EMAIL' | 'VISIT' | 'PROMISE' | 'LETTER' | 'NOTICE' | 'NOTE';
  note: string;
  promiseOn: IsoDate | null;
  by: string;
  at: IsoDateTime;
  approval: { by: string; at: IsoDateTime; approve: boolean; note: string } | null;
}

export interface AmTenancy {
  tenant: string;
  /** The group office or a state branch renting from Asset Management: billed like any tenant. */
  internal: boolean;
  startOn: IsoDate;
  endOn: IsoDate;
  rent: number;
  deposit: number;
  utilityDeposit: number;
  stamped: boolean;
  /** Tenant contact for the Call, WhatsApp and Email buttons (Fauzan, 27 Oct 2026). Personal data: PDPA applies. */
  tenantPhone?: string | null;
  tenantEmail?: string | null;
  lastContactOn: IsoDate | null;
  invoices: AmInvoice[];
  payments?: AmPayment[];
  followUps?: AmFollowUp[];
  /**
   * WhatsApp rent reminders (Fauzan, 2 Nov 2026). Sent only after the tenant agreed (recorded by the team, with how),
   * and stopped for good when the tenant replies STOP. Each reminder is kept with what WhatsApp said happened to it.
   */
  whatsapp?: {
    consent: { on: boolean; by: string; at: IsoDateTime; how: string } | null;
    reminders: AmRentReminder[];
  } | null;
}

export interface AmRentReminder {
  /** unit:period:stage(-round): the same reminder is never queued twice. */
  id: string;
  stage: 'before' | 'due' | 'late';
  period: string;
  amount: number;
  dueOn: IsoDate;
  queuedAt: IsoDateTime;
  /**
   * queued -> sending (claimed) -> sent (accepted by WhatsApp) -> delivered -> read; failed after the last try; cancelled
   * if paid or opted out. uncertain: the send may or may not have reached WhatsApp (no answer, a timeout, a server error,
   * or a claim with no result). It is never sent again automatically; the team checks and settles it.
   */
  status: 'queued' | 'sending' | 'uncertain' | 'sent' | 'delivered' | 'read' | 'failed' | 'cancelled';
  /** The send that claimed it (one message can cover several units of one tenant), and when. */
  claimId?: string | null;
  claimedAt?: IsoDateTime | null;
  attempts: number;
  providerId: string | null;
  lastError: string | null;
  /** When WhatsApp accepted it. */
  sentAt?: IsoDateTime | null;
  updatedAt: IsoDateTime;
}

export interface AmUnit {
  id: Id;
  code: string;
  type: AmUnitType;
  name: string;
  town: string;
  state: string;
  ownerEntity: string;
  sizeSqft: number;
  askingRent: number;
  status: AmUnitStatus;
  vacantSince: IsoDate | null;
  insuranceExpiry: IsoDate;
  assessmentDue: IsoDate;
  quitRentDue: IsoDate;
  meters: { kind: 'ELECTRICITY' | 'WATER'; account: string; payer: 'tenant' | 'owner'; lastReadOn: IsoDate | null }[];
  tenancy: AmTenancy | null;
  /**
   * What the developer's own system last said about this unit (slice 4G feed). Kept apart from Prima's tenancy: a
   * difference is shown for the team to check, never copied over, and a payment it reports is not banked money.
   */
  feed?: {
    at: IsoDateTime;
    status: string;
    tenant: string | null;
    rent: number | null;
    /** Months the developer system shows as paid, with what it says was paid. Not proof of payment. */
    reportedPaid: { period: string; amount: number; on: IsoDate | null; ref: string | null }[];
  } | null;
}

export interface AmWorkOrder {
  id: Id;
  unitId: Id | null;
  propertyId: Id | null;
  title: string;
  source: 'tenant' | 'planned' | 'inspection';
  raisedOn: IsoDate;
  dueOn: IsoDate;
  status: 'open' | 'in_progress' | 'done';
  cost: number | null;
  contractor: string | null;
  doneOn: IsoDate | null;
}

export interface AmAsset {
  id: Id;
  tag: string;
  description: string;
  category: 'FURNITURE' | 'FITTING' | 'RENOVATION' | 'OTHER';
  /** The entity whose books carry it and where it sits (group office, a branch, a company office, a resort). */
  ownerEntity: string;
  location: string;
  cost: number;
  boughtOn: IsoDate;
  condition: 'good' | 'fair' | 'poor';
  keeper: string;
  status: 'in_use' | 'disposal_pending' | 'disposed' | 'buy_requested' | 'buy_approved' | 'buy_refused';
  lastCheckedOn: IsoDate | null;
  /** Disposal: the Asset Management team asks, Finance (or the COO for a larger book value) approves, the team records it. */
  disposal?: AmDisposal | null;
  /**
   * End-of-life reviews once fully written off (Fauzan, 27 Oct 2026): if it can still be used, keep using it or
   * refurbish it; dispose only when neither works. Newest last.
   */
  lifeReviews?: { on: IsoDate; decision: 'keep' | 'rehab'; note: string; cost: number | null; by: string; nextReviewOn: IsoDate }[];
  /**
   * A purchase asked for by the Asset Management team (slice 4G; Asset Management decides on buying furniture): Finance
   * approves up to the disposal limit, the COO above it, always with a reason and never the person who asked.
   */
  purchase?: {
    reason: string;
    qty: number;
    estCost: number;
    askedBy: string;
    askedById: Id;
    askedAt: IsoDateTime;
    decidedBy: string | null;
    decidedAt: IsoDateTime | null;
    decisionReason: string | null;
    /** Earlier approvals replaced by a re-approval at a new amount (the receipt is bound to the approved amount). */
    history?: { estCost: number; decidedBy: string | null; decidedAt: IsoDateTime | null; decisionReason: string | null; changedBy: string; changedAt: IsoDateTime; reason: string }[];
  } | null;
}

export interface AmDisposal {
  reason: string;
  method: 'SALE' | 'SCRAP' | 'DONATE' | 'WRITE_OFF' | 'TRADE_IN';
  estProceeds: number;
  askedBy: string;
  askedById: Id;
  askedAt: IsoDateTime;
  /** Net book value when asked, which decides who approves. */
  nbvAtAsk: number;
  decision: { by: string; at: IsoDateTime; approve: boolean; note: string } | null;
  done: { on: IsoDate; proceeds: number; party: string; proofRef: string; by: string } | null;
  /** SQL Account journal reference once Finance posts the disposal. */
  sqlRef: string | null;
}

/** Monthly depreciation for one owner entity, posted by Finance in SQL Account; Prima prepares the journal only. */
/**
 * HR database wall (HR Phase 3, slice 3A part 3): a staff member's full IC or passport number, kept apart from the person
 * record that the company and other departments read. Only HR, the HR Director and the CEO read or write it.
 */
export interface StaffIdentity {
  /** Same as the person's id. */
  id: Id;
  personId: Id;
  companyId: Id;
  idFull: string;
  /** A guard or officer (slice 3G): the company's admin staff also read it, and the JA feed keeps it current. */
  guard?: boolean;
  /** A foreign worker: FWM also reads the passport number. */
  foreign?: boolean;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

/**
 * HR database wall: a staff member's full salary account, and a new account waiting for the HR Director and Finance to
 * verify it. HR, the HR Director, the CEO and Finance read it (Finance for the supplier fraud check and to finish a
 * verification).
 */
export interface StaffAccount {
  /** Same as the person's id. */
  id: Id;
  personId: Id;
  companyId: Id;
  /** A guard or officer (slice 3G): the company's admin staff also read it, and the JA feed keeps it current. */
  guard?: boolean;
  accountFull: string | null;
  pending: { changeId: Id; bank: string; accountFull: string } | null;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

/**
 * A staff member's registered face for clock in (Fauzan, 2 Nov 2026; free engine on the phone, face.ts). The staff member
 * registers on their own phone; HR looks at the photo and approves it. Only the person and HR read it; the descriptor
 * never goes back to a phone.
 */
export interface StaffFace {
  /** Same as the person's id. */
  id: Id;
  personId: Id;
  userId: Id;
  companyId: Id;
  /** 128 numbers from the face engine. */
  descriptor: number[];
  /** The registration photo, for HR to check it is the person. */
  photo: string;
  status: 'pending' | 'approved' | 'refused';
  submittedAt: IsoDateTime;
  decidedBy: string | null;
  decidedById: Id | null;
  decidedAt: IsoDateTime | null;
  note: string | null;
}

export interface AmDepnPosting {
  id: Id;
  ownerEntity: string;
  period: string;
  amount: number;
  sqlRef: string;
  by: string;
  at: IsoDateTime;
}

export interface AmProperty {
  id: Id;
  kind: 'RESORT' | 'ORCHARD' | 'TRAINING';
  name: string;
  town: string;
  state: string;
  detail: string;
  licences: { name: string; expiresOn: IsoDate }[];
  months: { period: string; income: number; cost: number; occupancyPct: number | null; harvestKg: number | null; bookings: number | null }[];
}

// ---------- ACT: Audit, Compliance and Transformation (Fauzan, 27 Oct 2026) ----------
// ACT monitors all compliance, audits every workflow, checks discrepancies, finds the solution and leads the
// improvement. The owner fixes; ACT verifies. Overdue findings are shown to the next level, never punished automatically.

export interface ActFinding {
  id: Id;
  ref: string;
  /** The company it concerns; null for a PWVSB department. */
  companyId: Id | null;
  /** The workflow or area audited (rule ACT-PLAN areas). */
  area: string;
  source: 'monitor' | 'workflow_audit' | 'speak_up' | 'manual';
  /** The compliance-monitor signal it was raised from; the evidence was filled in by the server, not typed. */
  signalKey?: string | null;
  /** The ACT team that works it: the team that raised it, or the one the Director gave it to (null: waiting for the Director). */
  team?: 1 | 2 | null;
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
  /** What ACT saw: report, record numbers, photos. */
  evidence: string;
  raisedBy: string;
  raisedById: Id;
  raisedAt: IsoDateTime;
  ownerUserId: Id;
  ownerName: string;
  dueOn: IsoDate;
  plan: { rootCause: string; solution: string; targetOn: IsoDate; by: string; at: IsoDateTime } | null;
  fix: { proof: string; by: string; at: IsoDateTime } | null;
  /** ACT's check that the fix works; a failed check reopens the finding. */
  checks: { ok: boolean; note: string; by: string; at: IsoDateTime }[];
  /** Enforcement follow-ups with the owner: a record of each chase, never a penalty. */
  followUps?: { method: ActFollowUpMethod; note: string; nextOn: IsoDate | null; by: string; byId: Id; at: IsoDateTime }[];
  status: 'open' | 'planned' | 'fixed' | 'closed';
}

export type ActFollowUpMethod = 'call' | 'message' | 'email' | 'visit' | 'meeting' | 'memo';

/**
 * One piece of ACT audit work: a workflow audit, or a review of a department's or company's monthly report. The
 * Director distributes work to a team (status 'assigned'); the team's Auditor records it done. A row with no status is
 * a done workflow audit (older rows).
 */
export interface ActAudit {
  id: Id;
  /** 'workflow' (default) or 'report_review' of a monthly report (Fauzan, 2 Nov 2026). */
  kind?: 'workflow' | 'report_review' | 'timing' | 'field_check' | 'investigation';
  status?: 'assigned' | 'done';
  area: string;
  companyId: Id | null;
  /** Report review: the report and month reviewed, and the sending department (null for a company report). */
  defId?: string | null;
  period?: string | null;
  department?: string | null;
  /** The team the Director gave it to, the date it is due, and the Director's instruction. */
  team?: 1 | 2 | null;
  dueOn?: IsoDate | null;
  assigned?: { by: string; at: IsoDateTime; note: string } | null;
  /**
   * kind 'timing' (Fauzan, 2 Nov 2026: "ACT director have full power on timing for each workflow, segment by
   * segment"): the timing the ACT Director set for a workflow after reviewing it. The latest row per area is in force.
   */
  timing?: {
    /** How often the workflow is audited, replacing the rule ACT-PLAN default. */
    auditMonths: number;
    /** Each step of the workflow and the time it may take, timed from when the work reaches the person. */
    segments: {
      step: string;
      target: number;
      unit: 'hours' | 'days';
      /** Optional work key other screens time against (e.g. a playbook item id 'it-ex-queue', or 'assigned'). */
      key?: string | null;
    }[];
    /** The workflow audit the timing is based on. */
    reviewId: Id;
    reason: string;
  } | null;
  /**
   * kind 'field_check' (Fauzan, 2 Nov 2026): ACT went to the field and saw what actually happens at each step, every 6
   * months. What was seen per step, against the timing in force.
   */
  field?: {
    observed: { step: string; actual: number; unit: 'hours' | 'days'; target: number | null; note: string }[];
    where: string;
    timingId: Id | null;
  } | null;
  /**
   * kind 'investigation' (masterplan item 241, Fauzan 3 Nov 2026): a restricted ACT case file. Only ACT sees it.
   * Evidence is kept with its SHA-256; the custody log only grows.
   */
  investigation?: ActInvestigation | null;
  /** Null while assigned and not yet done. */
  doneOn: IsoDate | null;
  by: string;
  result: 'clean' | 'findings' | null;
  note: string;
  findingIds: Id[];
}

export interface ActEvidence {
  id: Id;
  name: string;
  mime: string;
  bytes: number;
  /** SHA-256 of the data as received; re-checked every time the file is shown. */
  sha256: string;
  data: string;
  /** Where it came from: who handed it over, or which Prima record it was taken from. */
  source: string;
  addedBy: string;
  addedById: Id;
  at: IsoDateTime;
}

export interface ActCustodyEntry {
  at: IsoDateTime;
  by: string;
  byId: Id;
  action: 'opened' | 'evidence_added' | 'evidence_viewed' | 'note' | 'assigned' | 'closed';
  detail: string;
}

export interface ActInvestigation {
  ref: string;
  title: string;
  /** What started it: an anomaly, a finding, or a report (free text, no names needed). */
  basis: { anomalyKey: string | null; findingId: Id | null; note: string };
  state: 'open' | 'closed';
  evidence: ActEvidence[];
  custody: ActCustodyEntry[];
  notes: { at: IsoDateTime; by: string; text: string }[];
  /** Closed by the ACT Director only. Referral goes to HR or Legal; Prima never disciplines anyone itself. */
  conclusion: { outcome: 'substantiated' | 'not_substantiated' | 'referred'; summary: string; referredTo: string | null; by: string; at: IsoDateTime } | null;
}

/** An improvement ACT leads after finding the cause: steps, an owner, a target date and the benefit expected. */
export interface ActImprovement {
  id: Id;
  ref: string;
  title: string;
  benefit: string;
  findingIds: Id[];
  ownerUserId: Id;
  ownerName: string;
  ledBy: string;
  targetOn: IsoDate;
  steps: { text: string; doneOn: IsoDate | null; by: string | null }[];
  approved: { by: string; at: IsoDateTime } | null;
  result: { note: string; by: string; at: IsoDateTime } | null;
  createdAt: IsoDateTime;
}

export type TableName = keyof Dataset;

// ---------- Company secretary (V9, Fauzan 24 Oct 2026) ----------
// Each licensed company keeps its own secretary, filings and board. Prima never lodges a filing or signs a resolution:
// the licensed secretary lodges in MBRS and the company records it here. Any change to a company's corporate structure
// needs PWVSB approval before the board acts (Fauzan, 24 Oct 2026).

/** A company's corporate record. Test data until each secretary confirms it. */
export interface CorpProfile {
  id: Id;
  companyId: Id;
  regNo: string;
  incorporatedOn: IsoDate;
  /** Financial year end month, 1 to 12. */
  fyeMonth: number;
  secretaryFirm: string;
  secretaryLicence: string;
  auditor: string;
  directors: { name: string; appointedOn: IsoDate }[];
  /** Central Admin 5B company file (Fauzan, 2 Nov 2026): kept behind the corporate wall, one record per company. */
  shareholders?: CorpShareholder[];
  beneficialOwners?: CorpBeneficialOwner[];
  constitution?: { adopted: boolean; ref: string; on: IsoDate | null } | null;
  /** The company's key corporate papers on file (registers, constitution, SSM notices), by reference only. */
  papers?: { name: string; ref: string; on: IsoDate | null }[];
  file?: CorpFileStatus | null;
}

/**
 * A firm on the group's panel (Central Admin 5D, Fauzan 2 Nov 2026: "That will be key in by staff later"). Central
 * Admin keeps the audit and secretary firms, PWVSB legal keeps the law firms. A firm taken off stays on record.
 */
export interface PanelFirm {
  id: Id;
  kind: 'AUDIT' | 'LAW' | 'SECRETARY';
  name: string;
  /** The firm's registration: audit firm (AF) number, law firm or secretary licence. */
  regNo: string;
  contact: string;
  /** How the firm charges, in words (for example a yearly fee band or hourly rates). */
  feeBasis: string;
  appointedOn: IsoDate;
  /** Reviewed again a year after appointment or the last review. */
  reviewOn: IsoDate;
  status: 'active' | 'removed';
  addedBy: string;
  addedById: Id;
  at: IsoDateTime;
  reviews: { by: string; at: IsoDateTime; note: string }[];
  removed: { by: string; at: IsoDateTime; note: string } | null;
  /**
   * Masterplan §126 (Fauzan 3 Nov 2026, "build all not build"): the yearly budget for this adviser. The keeper of the
   * list proposes it with a reason; the Finance Director agrees it (never the proposer). A newer proposal for the same
   * year replaces the older one only once agreed; history stays.
   */
  budgets?: AdviserBudget[];
  /**
   * Invoices from an audit or secretary firm, keyed once by the keeper. Law firm fees are not keyed here: they come from
   * the fees on the legal matters. Someone other than the person who keyed it checks it and passes it to Finance, or
   * queries it. Prima never pays.
   */
  invoices?: AdviserInvoice[];
}

export interface AdviserBudget {
  year: string;
  amount: number;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  agreed: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /** Set when a later agreed budget for the same year replaced this one. */
  replacedAt?: IsoDateTime | null;
}

export interface AdviserInvoice {
  id: Id;
  no: string;
  on: IsoDate;
  amount: number;
  /** The group company billed, or null for PWVSB itself. */
  companyId: Id | null;
  forWhat: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  /**
   * Service acceptance (Arisha main round 5, 3 Nov 2026): the person who received the service confirms it was delivered,
   * with evidence (for example the signed audit report or the filing receipt). The billed company's manager accepts its
   * own invoices; the Chief of Staff or the Deputy accepts PWVSB's. Never the person who keyed the invoice.
   */
  acceptance?: { by: string; byId: Id; at: IsoDateTime; evidenceRef: string; note: string } | null;
  check: { result: 'passed' | 'queried'; by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /**
   * The SQL Account payables entry Finance made for it, in the books of the billed entity (the company, or 'pwvsb').
   * Recorded by the Finance Director from what Finance posted; Prima posts and pays nothing.
   */
  ap?: { entityId: Id; apRef: string; postedOn: IsoDate; by: string; byId: Id; at: IsoDateTime } | null;
  /** After a query the keeper corrects the invoice and sends it again; earlier checks stay. */
  history?: { result: 'queried'; by: string; at: IsoDateTime; note: string; acceptance?: AdviserInvoice['acceptance'] }[];
}

/**
 * Masterplan §243 (Fauzan 3 Nov 2026): the emergency delegation and succession register. Who acts for whom, over what,
 * from when to when, and why. Group posts (CEO, COO, CoS and so on) sit under PWVSB (companyId 'pwvsb'); a company's
 * own posts sit under the company. Recorded by one person, approved by another (never the delegate). It is a record:
 * it gives nobody any access or approval right in Prima, and the screen says so.
 */
export interface Delegation {
  id: Id;
  companyId: Id;
  kind: 'EMERGENCY' | 'SUCCESSION' | 'LEAVE_COVER';
  /** The post, in words, e.g. "Chief Executive Officer" or "Company Manager". */
  post: string;
  holderId: Id | null;
  holderName: string;
  delegateId: Id;
  delegateName: string;
  /** What the delegate may act on, in words. */
  scope: string;
  from: IsoDate;
  /** null: until ended (a standing succession line). */
  to: IsoDate | null;
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** Set when a leader approves (one of the CEO, COO or Chief of Staff is enough; Fauzan 3 Nov 2026). */
  approved: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /** revoked: ended early by a leader for cause, not a planned finish. */
  ended: { by: string; byId: Id; at: IsoDateTime; note: string; revoked?: boolean } | null;
  /** The critical post this line covers, from the inventory (post and holder are copied from it, keyed once). */
  criticalRoleId?: Id | null;
  /** Each leader's approval, in order. Never the recorder or the person who acts. */
  /** as: for a succession, 'ceo' (waits for the Chairman), 'chairman' (alone) or 'chairman_consent' (after the CEO). */
  approvals?: { by: string; byId: Id; at: IsoDateTime; note: string; as?: 'leader' | 'ceo' | 'chairman' | 'chairman_consent' }[];
  /**
   * Why the person who acts is fit to: a reference to an HR training or appraisal record, or another document. HR rows
   * stay behind the HR wall; only the reference and a summary are kept here.
   */
  competency?: { kind: 'hr_training' | 'hr_appraisal' | 'document'; ref: string; note: string; by: string; byId: Id; at: IsoDateTime } | null;
  /** Board evidence: the resolution appointing or naming the successor. Needed before a succession line is approved. */
  board?: { resolutionRef: string; on: IsoDate; by: string; byId: Id; at: IsoDateTime } | null;
  /**
   * Time-limited access asked of IT through a help request. Prima grants nothing: IT changes the provider by hand. When
   * the line ends, is revoked, or the access end date passes, a removal request is raised.
   */
  access?: {
    systems: string;
    until: IsoDate;
    by: string;
    byId: Id;
    at: IsoDateTime;
    ticketId: Id;
    ticketRef: string;
    removal: { by: string; byId: Id; at: IsoDateTime; ticketId: Id; ticketRef: string; why: string } | null;
  } | null;
  /** Open work handed from the post holder to the person who acts, and handed back. */
  transfers?: { taskId: Id; title: string; fromId: Id; fromName: string; by: string; at: IsoDateTime; returned: { by: string; at: IsoDateTime } | null }[];
}

/**
 * Masterplan §243 critical-role inventory (Arisha main round 5, 3 Nov 2026): the posts whose absence stops the company
 * or the group, who holds each one, and who could step in. A line in the delegation register covers a post; a post
 * with no approved succession line and no successor ready now shows to the leaders as not covered.
 */
export interface CriticalRole {
  id: Id;
  companyId: Id;
  post: string;
  holderId: Id | null;
  holderName: string;
  whyCritical: string;
  successors: { userId: Id; name: string; readiness: 'ready_now' | 'ready_later' | 'not_ready' }[];
  by: string;
  byId: Id;
  at: IsoDateTime;
  /** Reviewed at least yearly. */
  reviewOn: IsoDate;
  reviews: { by: string; at: IsoDateTime; note: string }[];
  retired: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
}

export interface CorpShareholder {
  name: string;
  /** Individual, or another company (for example PWVSB). */
  kind: 'individual' | 'company';
  shares: number;
  since: IsoDate | null;
}

export interface CorpBeneficialOwner {
  name: string;
  /** How they own or control: shares, votes, the right to appoint directors, or other control. */
  basis: string;
  since: IsoDate;
  /** When the company notified SSM; the law gives 14 days from the change. */
  ssmNotifiedOn: IsoDate | null;
}

/** The Head of Company (or Central Admin) drafts the file; the Deputy Chief of Staff checks it against the SSM extract. */
export interface CorpFileStatus {
  status: 'draft' | 'checked' | 'mismatch';
  draftById: Id;
  draftBy: string;
  draftAt: IsoDateTime;
  checkedBy?: string | null;
  checkedById?: Id | null;
  checkedAt?: IsoDateTime | null;
  /** The SSM extract or profile the check was made against (reference only). */
  ssmRef?: string | null;
  mismatches?: string[];
  note?: string | null;
  /** Earlier checks of this file (returned or confirmed), kept when it is edited and resubmitted. */
  history?: { status: 'checked' | 'mismatch'; by: string; at: IsoDateTime; ssmRef: string; mismatches: string[]; note: string | null }[];
}

/** One year's statutory audit of a company by a firm on the group's auditor panel (V9). */
export interface CorpAudit {
  id: Id;
  companyId: Id;
  fyEnd: IsoDate;
  auditorFirm: string;
  fee: number | null;
  planningOn: IsoDate | null;
  /** Prepared-by-client list: what the auditor asked for and when it was handed over. */
  pbc: { item: string; dueOn: IsoDate; receivedOn: IsoDate | null }[];
  adjustments: { desc: string; amount: number; agreedBy: string | null }[];
  signed: { on: IsoDate; opinion: 'unmodified' | 'qualified' | 'adverse' | 'disclaimer'; ref: string } | null;
}

/** A legal matter: a claim, demand, labour case, regulator matter or contract dispute (V9). */
export interface LegalMatter {
  id: Id;
  companyId: Id;
  ref: string;
  title: string;
  kind: 'LITIGATION' | 'DEMAND' | 'LABOUR' | 'REGULATORY' | 'CONTRACT' | 'OTHER';
  counterparty: string;
  side: 'claimant' | 'respondent';
  /** Amount at stake for the company, RM; null when not money. */
  exposure: number | null;
  lawyer: string;
  nextDate: { on: IsoDate; what: string } | null;
  updates: { at: IsoDateTime; by: string; text: string }[];
  fees: { on: IsoDate; amount: number; invoiceRef: string }[];
  status: 'open' | 'closed';
  outcome: string | null;
  openedOn: IsoDate;
}

/** The records a legal hold may cover, by database table. */
export type LegalHoldTable = 'evidence_docs' | 'evidence_photos' | 'cases' | 'contracts' | 'corp_profiles' | 'people' | 'insurance_claims';

/**
 * Masterplan §125 legal hold (Arisha main 3 Nov 2026; Fauzan "proceed work"). A record kept for a legal matter: while
 * the hold stands, every change keeps the earlier content as a version and the record cannot be deleted. The reason
 * stays on the legal matter (behind the legal wall); this row says only which record, which matter, who and when.
 * Staff are never blocked: their work carries on and the earlier content is preserved.
 */
export interface LegalHold {
  id: Id;
  companyId: Id;
  tbl: LegalHoldTable;
  refId: Id;
  matterId: Id;
  by: string;
  byId: Id;
  at: IsoDateTime;
  released: { by: string; byId: Id; at: IsoDateTime } | null;
}

/** The content of a held record just before a change, kept by the database (append only; legal wall reads). */
export interface LegalHoldVersion {
  id: Id;
  companyId: Id;
  holdId: Id;
  tbl: LegalHoldTable;
  refId: Id;
  at: IsoDateTime;
  byId: Id | null;
  before: unknown;
}

export type CorpFilingKind = 'ANNUAL_RETURN' | 'FINANCIAL_STATEMENTS' | 'DIRECTOR_CHANGE' | 'BO_CHANGE' | 'SHARE_CHANGE' | 'OTHER';

/** A filing with SSM. It stays awaiting acknowledgement until the SSM receipt is recorded. */
export interface CorpFiling {
  id: Id;
  companyId: Id;
  kind: CorpFilingKind;
  title: string;
  dueOn: IsoDate;
  basis: string;
  status: 'open' | 'prepared' | 'lodged' | 'acknowledged';
  prepared: { by: string; at: IsoDateTime } | null;
  /** Lodged by the licensed secretary in MBRS, recorded here with the lodgement reference. */
  lodged: { by: string; at: IsoDateTime; ref: string; on: IsoDate } | null;
  receipt: { by: string; at: IsoDateTime; ref: string } | null;
  changeId?: Id | null;
}

export type CorpChangeKind =
  | 'DIRECTOR'
  | 'SHARES'
  | 'BENEFICIAL_OWNER'
  | 'CONSTITUTION'
  | 'SECRETARY_AUDITOR'
  | 'CHARGE'
  | 'KDN_DETAILS'
  | 'BANK_SIGNATORY'
  | 'MERGER_DISSOLUTION';

/** A change to a company's corporate structure: PWVSB approves, then the company board acts, then it is filed. */
export interface CorpChange {
  id: Id;
  companyId: Id;
  kind: CorpChangeKind;
  title: string;
  detail: string;
  raisedBy: string;
  raisedById: Id;
  at: IsoDateTime;
  status: 'awaiting_pwvsb' | 'approved' | 'rejected' | 'board_done';
  /** PWVSB's decision, citing the signed clause that gives PWVSB the right. */
  pwvsb: { by: string; at: IsoDateTime; note: string; clauseRef: string } | null;
  board: { by: string; at: IsoDateTime; resolutionRef: string; effectiveOn: IsoDate } | null;
  filingId: Id | null;
}

// ---------- Credit and collateral (V8, V10) ----------
// PWVSB lends to, or pays on behalf of, a group company. A beneficial-interest agreement is collateral only. A missed
// instalment opens an investigation; a default confirmed by two people opens the enforcement case automatically.
// Ownership never changes by software, and enforcement steps 7 to 9 stay off until counsel approves the template.

export interface CreditInstalment {
  no: number;
  dueOn: IsoDate;
  amount: number;
  paidOn: IsoDate | null;
  paidAmount: number;
  bankRef: string | null;
}

export interface CreditLoan {
  id: Id;
  companyId: Id;
  ref: string;
  /** A loan, or money PWVSB paid on the company's behalf and recovers on a schedule. */
  kind: 'LOAN' | 'PAID_ON_BEHALF';
  purpose: string;
  secured: boolean;
  principal: number;
  /** Simple interest, % a year. Blocked above the Moneylenders Act cap. */
  ratePct: number;
  /** The first day the financing runs from: the instalment schedule is built from this date. */
  startOn: IsoDate;
  /**
   * The day the agreement was signed (executed), when the credit officer has it. The 30-day stamping clock runs from
   * this date. Prima sets no order between signing and start: either can come first. When it is not recorded, the board
   * counts from the start date and says so (Arisha main review round 2, 2 Nov 2026).
   */
  signedOn?: IsoDate | null;
  termMonths: number;
  agreementRef: string;
  /** The agreement template, for counsel's enforceability approval. */
  templateId: string;
  stamped: { ref: string; on: IsoDate } | null;
  collateral: { kind: 'BENEFICIAL_INTEREST' | 'ASSET_CHARGE' | 'GUARANTEE' | 'NONE'; agreementRef: string | null };
  /** A charge over company property must be lodged with SSM within 30 days of creation (Companies Act 2016 s.352). */
  charge: { createdOn: IsoDate; lodgedOn: IsoDate | null; ssmRef: string | null } | null;
  cureDays: number;
  schedule: CreditInstalment[];
  disputes: { at: IsoDateTime; by: string; note: string; closedAt: IsoDateTime | null }[];
  deferral: { until: IsoDate; by: string; note: string } | null;
  status: 'active' | 'settled' | 'released';
  /**
   * Masterplan §103 (Fauzan 3 Nov 2026): PWVSB's KPKT moneylending licence checked for this loan by the Deputy Chief of
   * Staff (with counsel's confirmation in the note). Not a block on the credit officer: an unchecked or invalid licence
   * goes to the directors' legal flags only (Fauzan 2 Nov 14:59Z).
   */
  lenderLicence?: { ref: string; validTo: IsoDate; validOnLoanDate: boolean; by: string; byId: Id; at: IsoDateTime; note: string } | null;
  /** Audited corrections to the recorded collateral (Central Admin 5G review fix): what changed, from what, and why. */
  corrections?: { at: IsoDateTime; by: string; byId: Id; field: 'collateral' | 'stamp' | 'charge' | 'signedOn'; from: string; to: string; reason: string }[];
}

export interface CreditStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

export interface CreditEnforcementStep {
  no: number;
  label: string;
  /** off: switched off until counsel approves this agreement template. */
  status: 'open' | 'done' | 'off';
  by: string | null;
  at: IsoDateTime | null;
  note: string;
}

/** A missed instalment: an investigation first, a confirmed default only after the checks and two people. */
export interface CreditDefault {
  id: Id;
  companyId: Id;
  loanId: Id;
  instalmentNo: number;
  openedAt: IsoDateTime;
  stage: 'investigating' | 'cleared' | 'confirmed' | 'suspended';
  reconciled: CreditStep | null;
  creditConfirm: CreditStep | null;
  financeConfirm: CreditStep | null;
  /** The first default on an agreement template also needs legal to confirm. */
  legalConfirm: CreditStep | null;
  needsLegal: boolean;
  cleared: CreditStep | null;
  suspended: CreditStep | null;
  enforcement: { openedAt: IsoDateTime; steps: CreditEnforcementStep[] } | null;
}

// ---------- Procurement, warehouse and uniforms (V5) ----------
// Each company buys for itself: it raises, quotes, orders and receives. Approval follows the delegation limits. Finance
// matches the order, the goods received and the supplier's e-Invoice before the bill is entered in SQL Account. Uniforms
// and equipment are issued to a guard against acknowledgement and collected on exit; never charged to the guard.

/** DEVICE: walkie-talkies, bodycams, translation devices. PATROL_DEVICE: patrol phones and NFC tokens. CLEANING: equipment and products for the cleaning services. */
export type PurCategory = 'UNIFORM' | 'GUARD_EQUIPMENT' | 'DEVICE' | 'PATROL_DEVICE' | 'CLEANING' | 'SERVICES' | 'IT' | 'OTHER';

export interface PurSupplier {
  id: Id;
  companyId: Id;
  name: string;
  ssmNo: string;
  categories: PurCategory[];
  /** Bank account checked by Finance against the supplier's bank letter (fraud control). */
  bank: { name: string; account: string; verifiedBy: string | null; verifiedOn: IsoDate | null };
  /** Conflict-of-interest declaration and anti-bribery acknowledgement (MACC Act s.17A, TRUST). */
  coiDeclaredOn: IsoDate | null;
  abcAckOn: IsoDate | null;
  /** Last yearly due-diligence review. */
  reviewedOn: IsoDate | null;
  blocked: { by: string; at: IsoDateTime; note: string } | null;
  addedBy: string;
  at: IsoDateTime;
}

export interface PurStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

export interface PurRequest {
  id: Id;
  companyId: Id;
  ref: string;
  title: string;
  category: PurCategory;
  lines: { item: string; stockItemId: Id | null; qty: number; unitPrice: number }[];
  total: number;
  raisedBy: string;
  raisedById: Id;
  at: IsoDateTime;
  /** Each quote carries the supplier's own document (insider abuse audit, 27 Oct 2026); older mock rows have none. */
  quotes: { supplierId: Id; amount: number; ref: string; by: string; at: IsoDateTime; docIds?: Id[] }[];
  /** Online and marketplace prices for the same items, checked before the quotes go for approval (Fauzan, 27 Oct 2026). */
  online?: { source: string; ref: string; amount: number; by: string; at: IsoDateTime; docIds?: Id[] }[];
  /** An IT purchase this request buys for (IT purchases go through Procurement, Fauzan 27 Oct 2026). */
  itPurchaseId?: Id | null;
  /** Why the chosen quote is dearer than the online price by more than the tolerance. */
  onlineReason?: string | null;
  chosenSupplierId: Id | null;
  /** Why the chosen quote is not the lowest. */
  notLowestReason: string | null;
  /** Approval tiers needed, fixed when it goes for approval from the chosen quote and the delegation limits. */
  tiers: ('manager' | 'coo' | 'ceo')[];
  approvals: (PurStep & { tier: 'manager' | 'coo' | 'ceo' })[];
  status: 'quoting' | 'awaiting_approval' | 'approved' | 'rejected' | 'ordered' | 'received' | 'posted';
  rejected: PurStep | null;
  po: { ref: string; by: string; at: IsoDateTime; amount: number } | null;
  /** Goods received note: quantity received per line. */
  grn: (PurStep & { qty: number[] }) | null;
  invoice: { eInvoiceUuid: string; number: string; amount: number; by: string; at: IsoDateTime } | null;
  match: { ok: boolean; notes: string[]; by: string; at: IsoDateTime } | null;
  posted: { sqlRef: string; by: string; at: IsoDateTime } | null;
  /**
   * Earlier rounds that were rejected, kept as they were when the request was corrected and sent again (Arisha main
   * review round 2, 2 Nov 2026: a rejection needs a correction and resubmission path). Newest last.
   */
  rounds?: {
    title: string;
    lines: PurRequest['lines'];
    total: number;
    quotes: PurRequest['quotes'];
    online: NonNullable<PurRequest['online']>;
    chosenSupplierId: Id | null;
    notLowestReason: string | null;
    onlineReason: string | null;
    approvals: PurRequest['approvals'];
    rejected: PurStep;
    reopened: PurStep;
  }[];
}

export interface StockItem {
  id: Id;
  companyId: Id;
  sku: string;
  name: string;
  kind: 'UNIFORM' | 'EQUIPMENT' | 'DEVICE' | 'PATROL_DEVICE' | 'CLEANING';
  /** Used up (cleaning products): issued, never returned. */
  consumable?: boolean;
  size: string | null;
  onHand: number;
  reorderAt: number;
  /** Last count with a signed-in witness (insider abuse audit, 27 Oct 2026). The count never changes onHand by itself. */
  lastCount?: { on: IsoDate; counted: number; onHand: number; by: string; witness: string } | null;
  /**
   * An opening figure typed when the item was first added waits for a storekeeper's witnessed count before anything is
   * issued from it (go-live readiness, 2 Nov 2026). Missing means the stock came in through goods received.
   */
  opening?: { qty: number; by: string; byId: Id; at: IsoDateTime; confirmed: { on: IsoDate; by: string; witness: string; counted: number } | null } | null;
  /**
   * How Goodwill charges the company whose guard holds the item (Fauzan, 2 Nov 2026): a monthly rental, or a one-off
   * sale. Prices are set by Goodwill's Inventory Manager; a missing price stays missing and is never guessed.
   */
  charge?: 'rental' | 'sale' | null;
  rentalMonthly?: number | null;
  salePrice?: number | null;
}

export interface HandoverStep {
  at: IsoDateTime;
  /** Who recorded it in Prima. */
  by: string;
  /** The slip the receiver signed, or a photo of it. */
  slipDocIds?: Id[];
  /** A photo of the receiver holding the item (Fauzan, 2 Nov 2026: required for the guard when there is no signature). */
  photoDocIds?: Id[];
  /** The receiver's signature, drawn on the screen in Prima (Fauzan, 2 Nov 2026). */
  signatureDocId?: Id;
  /**
   * SHA-256 of each file given at this step (signature, slip, photo), also written into the hash-chained audit log, so a
   * later "not delivered" can be answered with proof that has not been changed (Fauzan, 2 Nov 2026).
   */
  sha256?: Record<Id, string>;
  /** Where the phone said it was when they signed, if it allowed location. Reported by the device, not checked. */
  place?: { lat: number; lng: number; accuracyM: number | null } | null;
}

export interface StockIssue {
  id: Id;
  companyId: Id;
  itemId: Id;
  personId: Id;
  personName: string;
  qty: number;
  issuedAt: IsoDateTime;
  issuedBy: string;
  /** The person confirmed receipt in their own details (Fauzan, 27 Oct 2026); false until they do. */
  acknowledged: boolean;
  confirmedAt?: IsoDateTime | null;
  /** Serial number of a device (radio, bodycam, patrol phone), to follow it through its life. */
  serial?: string | null;
  /**
   * The signed issue slip (or a photo of it) for someone with no Prima account, such as a guard who works in the JA
   * Group app. It stands in for their own confirmation (go-live readiness, 2 Nov 2026).
   */
  slipDocIds?: Id[];
  /** For a Goodwill item: the photo of the guard holding it, taken at handover (Fauzan, 2 Nov 2026). */
  photoDocIds?: Id[];
  /** For a Goodwill store item: the company whose guard holds it, which Goodwill bills (Fauzan, 2 Nov 2026). */
  billTo?: Id | null;
  /**
   * A Goodwill store item travels store -> Operations Manager -> patrolling officer -> guard, and each of them
   * acknowledges receiving it (Fauzan, 2 Nov 2026). The OM confirms in Prima. The patrolling officer and the guard work
   * in the JA Group app, so they sign on the OM's screen; otherwise the OM attaches the slip they signed, and for the
   * guard also a photo of the guard holding the item. The guard's step sets acknowledged.
   * patrol is absent when the item goes to a patrolling officer for their own use.
   */
  handover?: {
    omUserId: Id;
    omName: string;
    om: HandoverStep | null;
    patrol?: { personId: Id; name: string; step: HandoverStep | null } | null;
    /** The guard's own step, set when acknowledged is. */
    guard?: HandoverStep | null;
  } | null;
  /** The person says they did not get it; the storekeeper must sort it out. */
  disputed?: { at: IsoDateTime; note: string } | null;
  returned: {
    at: IsoDateTime;
    by: string;
    condition: 'good' | 'worn' | 'damaged' | 'lost';
    note: string;
    /** A lost or damaged item waits for the company manager to confirm it (insider abuse audit, 27 Oct 2026). */
    confirmed?: { by: string; at: IsoDateTime; note: string } | null;
  } | null;
}

/** A second person who signs in with their staff number and PIN to witness (insider abuse audit, 27 Oct 2026). */
export interface WitnessInput {
  staffNo: string;
  pin: string;
}

// ---------- Governance and authority (V7, V8, V12) ----------
// PWVSB's authority over a company comes from a signed management agreement or a board mandate, never from software.
// Each power names an area, whether PWVSB may act or only monitor, and any amount limit. The company confirms with its
// board resolution, PWVSB legal verifies, and an expired or unverified mandate gives PWVSB no power to act.

export type GovArea = 'OPERATIONS' | 'HR_PAYROLL' | 'FINANCE' | 'PROCUREMENT' | 'CONTRACTS' | 'LICENSING' | 'ARMS' | 'CORPORATE' | 'IT';

export interface GovMandate {
  id: Id;
  companyId: Id;
  kind: 'MANAGEMENT_AGREEMENT' | 'BOARD_MANDATE';
  ref: string;
  title: string;
  signedOn: IsoDate;
  validFrom: IsoDate;
  /** null: open-ended until terminated. */
  validTo: IsoDate | null;
  powers: { area: GovArea; scope: 'act' | 'monitor'; limit: number | null }[];
  addedBy: string;
  addedById: Id;
  at: IsoDateTime;
  /** The company's board confirms it, citing the resolution. */
  companyConfirm: { by: string; byId: Id; at: IsoDateTime; resolutionRef: string } | null;
  /** PWVSB legal checks the signed copy against the register. */
  legalVerify: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  terminated: { by: string; at: IsoDateTime; note: string } | null;
}

// ---------- Assurance: obligations, OSH, whistleblowing, gifts (V15) ----------
// One register of what each company must do and prove, by workstream. The company records evidence (maker); internal
// audit checks it (checker, never the same person). No evidence is UNKNOWN, never green.

export type GrcStream = 'OSH' | 'EMPLOYEE_RELATIONS' | 'ANTI_BRIBERY' | 'TAX' | 'CONTINUITY' | 'PRIVACY' | 'INTERNAL_AUDIT' | 'SUPPLIER' | 'WELFARE' | 'FRAUD';

export interface GrcObligation {
  id: Id;
  companyId: Id;
  stream: GrcStream;
  title: string;
  /** The law or policy behind it. */
  basis: string;
  everyMonths: number;
  evidence: { on: IsoDate; ref: string; by: string; byId: Id; at: IsoDateTime } | null;
  checked: { by: string; byId: Id; at: IsoDateTime; ok: boolean; note: string } | null;
  history: { on: IsoDate; ref: string; by: string; checkedBy: string | null; ok: boolean | null }[];
}

/** A whistleblowing report. The reporter's identity is kept only if they chose to give it, and only the handler sees it. */
export interface WhistleReport {
  id: Id;
  /** Receipt code the reporter keeps to check progress, also when anonymous. */
  code: string;
  at: IsoDateTime;
  anonymous: boolean;
  reporterId: Id | null;
  reporterName: string | null;
  companyId: Id | null;
  category: 'BRIBERY' | 'FRAUD' | 'SAFETY' | 'HARASSMENT' | 'MISCONDUCT' | 'OTHER';
  summary: string;
  /** People named; the report never routes to any of them. */
  implicatedUserIds: Id[];
  handlerId: Id;
  handlerName: string;
  /** 'closing': the handler proposed an outcome; a second handler not named in the report must agree (insider abuse audit). */
  status: 'received' | 'acknowledged' | 'investigating' | 'closing' | 'closed';
  acknowledgedAt: IsoDateTime | null;
  notes: { at: IsoDateTime; by: string; text: string }[];
  outcome: string | null;
  closedAt: IsoDateTime | null;
  proposedOutcome?: string | null;
  closeReview?: { by: string; byId: Id; at: IsoDateTime; agree: boolean; note: string } | null;
}

/** Gifts and hospitality register (MACC Act s.17A adequate procedures). */
export interface GiftEntry {
  id: Id;
  companyId: Id | null;
  declarantId: Id;
  declarantName: string;
  direction: 'received' | 'given';
  counterparty: string;
  counterpartyKind: 'CLIENT' | 'SUPPLIER' | 'PUBLIC_OFFICIAL' | 'OTHER';
  description: string;
  value: number;
  on: IsoDate;
  cash: boolean;
  /** Needed above the limit, for anything with a public official, and for cash. */
  needsDecision: boolean;
  decision: { by: string; byId: Id; at: IsoDateTime; outcome: 'approved' | 'return' | 'donate' | 'refused'; note: string } | null;
  at: IsoDateTime;
}

/** OSH risk assessment (HIRARC) for a site, OSHA 1994 s.18B. */
export interface OshAssessment {
  id: Id;
  companyId: Id;
  siteId: Id;
  assessedOn: IsoDate;
  by: string;
  hazards: number;
  highRisks: number;
  controlsRef: string;
  nextReviewOn: IsoDate;
}


/**
 * A public holiday HR keeps for the year (Fauzan, 2 Nov 2026: "HR can set the holiday days more than what the Act
 * says"). Employment Act s.60D: at least 11 paid public holidays a year, five of them fixed (National Day, the Agong's
 * birthday, the Ruler's or Federal Territory Day, Labour Day and Malaysia Day). Office staff leave skips these days.
 */
/**
 * An allowance HR pays staff (Fauzan, 3 Nov 2026: "HR also have the ability to set allowance, the amount and what
 * allowance is"). Group-wide list kept by HR. The statutory ticks are HR's own reading of the law for this allowance;
 * Prima does not decide them. Payroll counts the allowance for EPF, SOCSO (with EIS and LINDUNG), PCB and the HRD levy
 * only where ticked.
 */
export interface AllowanceType {
  id: Id;
  name: string;
  /** Monthly (fixed on the staff record), one-off (added in a payroll month) or either. */
  frequency: 'monthly' | 'one_off' | 'both';
  /** The usual amount, shown as the default; null when it varies. */
  usualAmount: number | null;
  /** The most HR may set for one person in a month; null for no cap. */
  cap: number | null;
  epf: boolean;
  /** SOCSO, EIS and LINDUNG 24 Jam use the same wage. */
  socso: boolean;
  pcb: boolean;
  hrd: boolean;
  /** Where HR's ticks come from, e.g. the EPF wage definition or an LHDN ruling. */
  basis: string;
  active: boolean;
  addedBy: string;
  addedById: Id;
  addedAt: IsoDateTime;
  changes: { by: string; byId: Id; at: IsoDateTime; note: string }[];
}

export interface PublicHoliday {
  id: Id;
  date: IsoDate;
  name: string;
  /** The states it applies in, by state name as on branches; null for every state. */
  states: string[] | null;
  /** One of the five days the Act fixes, if it is one. */
  compulsory: 'NATIONAL_DAY' | 'AGONG_BIRTHDAY' | 'RULER_BIRTHDAY' | 'LABOUR_DAY' | 'MALAYSIA_DAY' | null;
  addedBy: string;
  addedById: Id;
  addedAt: IsoDateTime;
  note: string;
  /** Taken off the list by HR, with the reason; kept for the record. */
  removed?: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
}

/**
 * A request for flexible hours or days (Employment Act s.60P): answered in writing within 60 days, with the grounds for
 * a refusal. Working from home is the separate home-day arrangement, open only to staff HR has allowed.
 */
export interface FlexRequest {
  id: Id;
  personId: Id;
  userId: Id;
  name: string;
  /** The employer; null for PWVSB central staff. */
  companyId: Id | null;
  kind: 'hours' | 'days';
  /** What the staff member asks for, such as "8.00 to 5.00" or "Monday to Thursday, longer days". */
  detail: string;
  reason: string;
  from: IsoDate;
  to: IsoDate | null;
  requestedAt: IsoDateTime;
  answerBy: IsoDate;
  status: 'pending' | 'approved' | 'refused';
  decidedBy: string | null;
  decidedById: Id | null;
  decidedAt: IsoDateTime | null;
  note: string;
}
/**
 * The sections of Finance's Checks tab (staff-eye review, Fauzan 2 Nov 2026): one section at a time instead of every
 * panel on one page. Paying out, the bank, money in, cash and cards, tax and month-end.
 */
export type FinCheckSection = 'out' | 'bank' | 'in' | 'cash' | 'tax';

export interface ItManualReceipt { id:string; userId:string; requestId:string; kind:ItManualKind; hash:string; outcome:"committed"|"rejected"; recordId:string|null; version:number|null; message:string|null; at:string; }

export type ItOperationKind='rental_rates'|'rental_bill'|'rental_history'|'asset_inspection';
export interface ItRentalRate {id:string;version:number;effectiveOn:string;currency:'MYR';monthly:Partial<Record<ItAssetKind,number>>;evidence:string;note:string;byId:string;at:string;}
export interface ItAssetInspection {id:string;assetId:string;jobId:string;version:number;inspectedOn:string;nextDueOn:string;condition:'healthy'|'attention'|'unsafe';findings:string;evidence:string;followUp:string;byId:string;at:string;}
export interface ItOperationalReceipt extends Omit<ItManualReceipt,'kind'>{kind:ItOperationKind;}

/** A request to fill a post (slice 3B, rule HR-VACANCY): the CEO approves, then the company head signs. */
export interface Vacancy {
  id: Id;
  /** The employer; 'pwvsb' for central posts. */
  companyId: Id;
  title: string;
  department: string;
  headcount: number;
  reason: string;
  /** Monthly basic pay range offered, RM. */
  payFrom: number | null;
  payTo: number | null;
  raisedBy: string;
  raisedById: Id;
  raisedAt: IsoDateTime;
  status: 'waiting_ceo' | 'waiting_head' | 'open' | 'refused' | 'filled' | 'cancelled';
  ceo: { by: string; byId: Id; at: IsoDateTime; note: string; approve: boolean } | null;
  head: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  closed: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
}

/** One approval step on a staff movement. */
export interface StaffMovementStep {
  role: 'receiving_head' | 'hr_director' | 'ceo' | 'vice_chairman';
  approve: boolean;
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
  /** The CEO standing in for the HR Director or Vice Chairman during the pilot. */
  standIn?: boolean;
}

/**
 * A staff movement (Fauzan, 3 Nov 2026): HR prepares it, the steps approve it with a comment, and Prima applies it once.
 * - promotion: the HR Director approves, then the CEO, then the Vice Chairman consents.
 * - transfer to another group company: the receiving company head accepts, then the HR Director approves. By law the new
 *   company is a new employment (fresh leave and service); the HR record keeps the first group start date.
 * - secondment: the host company head accepts, the HR Director approves and the CEO consents; the employer does not change.
 */
/**
 * The login after a transfer (Arisha main review, 3 Nov 2026), kept apart from the movement so IT sees no pay or
 * reasons: the accounts that still point to the old employment, the HR Director's (or CEO's) authorisation, and IT's
 * confirmation, which Prima accepts only once each account points to the new record, has the new company and no
 * longer the old one. Prima does not change accounts; IT does it through the approved account process.
 */
export interface LoginHandover {
  id: Id;
  movementId: Id;
  personName: string;
  fromCompanyId: Id;
  fromCompanyName: string;
  toCompanyId: Id;
  toCompanyName: string;
  effectiveOn: IsoDate;
  accounts: { userId: Id; name: string; title: string }[];
  fromPersonId: Id;
  toPersonId: Id;
  /** Who prepared and applied the movement: neither may authorise the login move. */
  preparedById: Id;
  appliedById: Id;
  status: 'to_authorise' | 'authorised' | 'refused' | 'done';
  authorised: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  done: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  createdAt: IsoDateTime;
}

export interface StaffMovement {
  id: Id;
  /** The current employer. */
  companyId: Id;
  kind: 'promotion' | 'transfer' | 'secondment';
  personId: Id;
  personName: string;
  /** The receiving or host company (the same company for a promotion). */
  toCompanyId: Id;
  effectiveOn: IsoDate;
  reason: string;
  /** Promotion and transfer: the new post. A blank field keeps the current value. */
  post: { jobTitle: string | null; department: string | null; reportsTo: string | null; basicPay: number | null; branchId: Id | null; staffNo: string | null };
  /** Secondment: the last day at the host company. */
  until: IsoDate | null;
  preparedBy: string;
  preparedById: Id;
  preparedAt: IsoDateTime;
  steps: StaffMovementStep[];
  /**
   * waiting: steps still to take. approved: every step agreed, nothing on the staff record changes until the effective
   * date (Arisha main review, 3 Nov 2026). done: applied on or after the effective date, once.
   */
  status: 'waiting' | 'approved' | 'done' | 'refused' | 'cancelled';
  /** Who applied it and when (the last approver when it was already due, otherwise HR or the CEO on the day). */
  applied?: { by: string; byId: Id; at: IsoDateTime } | null;
  /** The last failed attempt to apply it; cleared when it applies. The movement stays approved for a retry. */
  applyError?: { at: IsoDateTime; message: string } | null;
  /** What was applied: the new staff record for a transfer, the verified pay change for new pay. */
  result: { newPersonId?: Id; payChangeId?: Id } | null;
}

export type HrFilingKind = 'CP22' | 'CP22A' | 'EPF_REG' | 'SOCSO_REG' | 'EA' | 'BORANG_E' | 'SH_NOTICE' | 'JKKP8';

/** A statutory filing HR has made (slice 3B): Prima works out what is due; HR records the reference once filed. */
export interface HrFiling {
  /** `${kind}-${personId or companyId}-${year or hire date}` */
  id: Id;
  kind: HrFilingKind;
  companyId: Id;
  personId: Id | null;
  /** The year it covers (EA, Borang E) or the start or last day it is about. */
  period: string;
  ref: string;
  filedOn: IsoDate;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

/**
 * An office staff member's HR case (slice 3E, Fauzan 2 Nov 2026: "need a file on what happen on each staff"): a
 * misconduct matter, a sexual harassment complaint (Employment Act Part XVA) or a grievance. HR keeps it; the app
 * never decides. Sexual harassment cases are confidential: HR, the HR Director and the CEO only.
 */
export type HrCaseKind = 'misconduct' | 'sexual_harassment' | 'grievance' | 'performance';
export type HrCaseStepKind =
  | 'note'
  | 'verbal_warning'
  | 'written_warning'
  | 'final_warning'
  | 'show_cause'
  | 'reply'
  | 'suspension_pending_inquiry'
  | 'inquiry_set'
  | 'inquiry_held'
  | 'refuse_inquiry'
  | 'outcome'
  | 'closed';
export interface HrCaseStep {
  kind: HrCaseStepKind;
  at: IsoDateTime;
  by: string;
  byId: Id;
  note: string;
  docIds?: Id[];
  /** Show-cause: the day the written reply is due. */
  replyDue?: IsoDate | null;
  /** Domestic inquiry: the panel (names) and the hearing day. */
  panel?: string[];
  panelIds?: Id[];
  hearingOn?: IsoDate | null;
  /** Inquiry held: whether the charge (or the complaint) was proven. */
  proven?: boolean | null;
  /** The outcome after an inquiry (s.14(1)), or no action. */
  outcome?: 'no_action' | 'warning' | 'suspension' | 'downgrade' | 'dismissal' | null;
  suspensionDays?: number | null;
}
export interface HrCase {
  id: Id;
  companyId: Id;
  /** The staff member the case is about (the respondent, for a complaint). */
  personId: Id;
  /** A complaint: who complained (a staff record), if any. */
  complainantId: Id | null;
  kind: HrCaseKind;
  title: string;
  confidential: boolean;
  openedAt: IsoDateTime;
  openedBy: string;
  openedById: Id;
  /** Part XVA: the complaint was received on this day; a refusal to inquire is told in writing within 30 days. */
  receivedOn: IsoDate;
  status: 'open' | 'closed';
  steps: HrCaseStep[];
}

// ---------- HR Phase 3, OSH for office staff (Fauzan, 2 Nov 2026: OSH coordinator, office risk assessment, DOSH report) ----------

interface OfficeOshBase {
  id: Id;
  /** The employer. */
  companyId: Id;
  note: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

/** The employer's OSH coordinator (OSHA 1994 s.29A, 5 or more employees). One active at a time. */
export interface OshCoordinator extends OfficeOshBase {
  kind: 'coordinator';
  personId: Id;
  name: string;
  appointedOn: IsoDate;
  /** Training certificate or course reference, if the coordinator has one. */
  trainingRef: string | null;
  endedOn: IsoDate | null;
}

/** An office risk assessment (HIRARC, OSHA 1994 s.18B) for one workplace of the employer. */
export interface OshOfficeAssessment extends OfficeOshBase {
  kind: 'assessment';
  workplace: string;
  assessedOn: IsoDate;
  hazards: number;
  highRisks: number;
  /** What is being done about the high risks, or where the HIRARC file is kept. */
  controls: string;
  nextReviewOn: IsoDate;
}

export type OshIncidentKind = 'accident' | 'dangerous_occurrence' | 'poisoning' | 'disease';

/** An accident, dangerous occurrence, poisoning or disease to report to DOSH (NADOPOD Regulations 2004). */
export interface OshIncident extends OfficeOshBase {
  kind: 'incident';
  incident: OshIncidentKind;
  /** The day it happened, or the day the disease was diagnosed. */
  occurredOn: IsoDate;
  personId: Id | null;
  name: string | null;
  /** A death or serious bodily injury: DOSH is told at once by the quickest means, then the form follows. */
  serious: boolean;
  description: string;
  /** Latest day for the JKKP 6 (or JKKP 7 for a disease) form. */
  reportBy: IsoDate;
  reported: { on: IsoDate; ref: string; by: string; byId: Id; at: IsoDateTime } | null;
}

export type OfficeOsh = OshCoordinator | OshOfficeAssessment | OshIncident;

// ---------- HR Phase 3, slice 3F (Fauzan, 2 Nov 2026): training, appraisal, handbook acknowledgements ----------

/** A course a staff member attended. HR records it; the staff member sees their own. */
export interface StaffTraining {
  id: Id;
  companyId: Id;
  personId: Id;
  name: string;
  course: string;
  provider: string;
  from: IsoDate;
  to: IsoDate;
  hours: number;
  /** Paid by the employer, in RM. */
  cost: number | null;
  /** HRD Corp grant or claim reference, when the course is claimed from the levy. */
  hrdRef: string | null;
  certificateRef: string | null;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export type AppraisalStatus = 'with_appraiser' | 'with_staff' | 'closed';

/**
 * A yearly appraisal: HR opens it and names the appraiser (never the staff member), the appraiser rates 1-5 with a
 * comment, the staff member reads it and may add their own comment, then HR closes it. Not a KPI (on hold).
 */
export interface StaffAppraisal {
  id: Id;
  companyId: Id;
  personId: Id;
  name: string;
  year: string;
  appraiserId: Id;
  appraiserName: string;
  status: AppraisalStatus;
  rating: number | null;
  strengths: string;
  improve: string;
  trainingNeeds: string;
  ratedAt: IsoDateTime | null;
  staffComment: string | null;
  staffAt: IsoDateTime | null;
  closed: { by: string; byId: Id; at: IsoDateTime; note: string } | null;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export type HrPolicyKind = 'handbook' | 'code_of_conduct' | 'it_use' | 'other';

/** A director's record on one HR legal point (hr-legal.ts). The point's text lives in code; this keeps who and when. */
export interface HrLegalCheck {
  id: string;
  status: 'unresolved' | 'in_review' | 'resolved';
  director: { id: Id; name: string } | null;
  history: { at: IsoDateTime; by: string; byId: Id; status: 'unresolved' | 'in_review' | 'resolved'; director: string | null; note: string }[];
}

/**
 * Staff overtime (slice 3D, Fauzan 2 Nov 2026): off until HR turns it on, sets the rates (never below the Employment
 * Act) and names the office staff who may claim it. Group-wide; each change keeps the one before in history.
 */
export interface StaffOvertimeSetting {
  id: 'overtime';
  enabled: boolean;
  normal: number;
  restDay: number;
  publicHoliday: number;
  personIds: Id[];
  comment: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: { enabled: boolean; normal: number; restDay: number; publicHoliday: number; personIds: Id[]; comment: string; by: string; at: IsoDateTime }[];
}

/** A staff handbook, code of conduct or IT-use policy that every office staff member acknowledges. Group-wide. */
export interface HrPolicy {
  id: Id;
  kind: HrPolicyKind;
  title: string;
  version: number;
  /** The text staff read, or where the full document is kept. */
  body: string;
  publishedOn: IsoDate;
  retired: boolean;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

/** A staff member's acknowledgement of one version of a policy. */
export interface PolicyAck {
  /** `${policyId}-${personId}` */
  id: Id;
  companyId: Id;
  policyId: Id;
  version: number;
  personId: Id;
  name: string;
  at: IsoDateTime;
}
