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
}

export interface Branch {
  id: Id;
  companyId: Id;
  name: string;
  model: BranchModel;
  state: string;
  /** The signed branch agreement, by version (V11, V12, V12.1). No version means no agreement on record. */
  agreements?: BranchAgreement[];
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
  status: 'draft' | 'approved' | 'paid';
  approvedBy: string | null;
  approvedAt: IsoDateTime | null;
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
  /** Driver's written consent to dashcam and health monitoring while driving, filed by the PDPA officer. */
  monitoringConsent?: { docId: Id; by: string; at: IsoDateTime } | null;
  /** Salary account for staff payroll (test data: masked; full numbers live with Finance and the bank). */
  bank?: { bank: string; accountMasked: string } | null;
  /** Fixed monthly allowances paid with the staff salary. */
  allowances?: { label: string; amount: number }[];
  // Office staff record kept by HR (Fauzan, 27 Oct 2026). Test data only; production keeps the full IC and bank
  // account in the restricted vault, shown in full to HR on the form and masked everywhere else.
  /** Full IC or passport number. */
  idFull?: string;
  /** Full salary account number. */
  bankAccountFull?: string;
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
  probationEndsOn?: IsoDate | null;
  contractEndsOn?: IsoDate | null;
  epfNo?: string;
  taxNo?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  /** The leaving step: why and when employment ends. Status turns to left on the last day. */
  leaving?: {
    kind: 'resigned' | 'terminated' | 'contract_end' | 'retired';
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
  kind?: 'PAY' | 'BANK';
  bankFrom?: { bank: string; accountMasked: string } | null;
  bankTo?: { bank: string; accountMasked: string; accountFull: string } | null;
  hrDirectorCheck?: { by: string; byId: Id; at: IsoDateTime } | null;
  financeCheck?: { by: string; byId: Id; at: IsoDateTime } | null;
}

/**
 * Leave and absence reasons asked for in the app (Fauzan, 25 Oct 2026: "request for leave or reason for absent, all
 * request and given reason in the app"). The guard asks on the site device or through the company; the company decides.
 */
export type LeaveKind = 'ANNUAL' | 'SICK' | 'HOSPITAL' | 'EMERGENCY' | 'UNPAID' | 'ABSENCE_REASON';

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
  /** Hospitalisation only: the claim papers and where the claim is (Shahirah, 26 Oct 2026). */
  hospitalClaim?: HospitalClaim;
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
}

export type LicenceType = 'KDN_LICENCE' | 'MOF_REGISTRATION' | 'INSURANCE' | 'SSM_ANNUAL_RETURN';

export interface CompanyLicence {
  id: Id;
  companyId: Id;
  type: LicenceType;
  reference: string;
  /** null means we have no record: shown as UNKNOWN, never green. */
  expiresOn: IsoDate | null;
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
export type FirearmStatus = 'IN_VAULT' | 'ISSUED' | 'MAINTENANCE' | 'UNVERIFIED' | 'LOST';

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
  kind: 'ACQUIRE' | 'MOVE' | 'TRANSFER' | 'SERVICE' | 'DISPOSE' | 'LOSS_REPORT';
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
  depositedWithPolice?: { station: string; on: IsoDate } | null;
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
  | 'LEFT_BEFORE_SIGN_OUT';

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
  source: 'playbook' | 'assigned' | 'meeting' | 'own';
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
  frequency: 'weekly' | 'monthly';
  /** Weekly: day of the week it is due (1 Monday to 7 Sunday). Monthly: day of the next month it is due. */
  dueDay: number;
  active: boolean;
}

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
  kind: 'board' | 'management' | 'operations' | 'department' | 'client' | 'other';
  title: string;
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
}

/** An emergency or alarm event at a site that reaches CMS: guard SOS, panic button, intrusion, fire, camera tamper. */
export interface SiteAlarm {
  id: Id;
  companyId: Id;
  siteId: Id;
  kind: 'GUARD_SOS' | 'PANIC' | 'INTRUSION' | 'FIRE' | 'CAMERA_TAMPER' | 'LINK_LOST';
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
  /** IT department (Fauzan, 27 Oct 2026): 1 IT Manager, 1 IT Lead and 4 IT Executives. */
  itRole?: 'manager' | 'lead' | 'executive';
  /**
   * ACT, Audit, Compliance and Transformation (Fauzan, 27 Oct 2026): a Lead and a Deputy, each with an Assistant cum
   * Enforcement. Department 'audit'.
   */
  actRole?: 'lead' | 'deputy' | 'assistant';
  /**
   * Procurement and Inventory (Fauzan, 27 Oct 2026): under the Operations General Manager, monitored by the COO and
   * CEO; 1 executive and 2 storekeepers. Department 'procurement'.
   */
  procRole?: 'executive' | 'storekeeper';
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
  integration?: 'ja' | 'door' | 'planner';
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
  status: 'to_notify' | 'notified' | 'documents' | 'assessing' | 'settled' | 'rejected';
  settledAmount: number | null;
  settledOn: IsoDate | null;
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
  /** Satisfaction, 1 (very unhappy) to 5 (very happy). */
  ratings: { at: IsoDateTime; by: string; score: number; comment: string }[];
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
// the Chief of Staff approves, the Vice Chairman consents, then Finance pays through the bank and posts to SQL Account.
// Prima only drafts the bank file, the SQL Account journal and the EPF, SOCSO, EIS and PCB lists; it never files or pays.

export type StaffPayStage = 'draft' | 'submitted' | 'approved' | 'consented' | 'paid';

export interface StaffPayLine {
  personId: Id;
  staffNo: string;
  name: string;
  jobTitle: string;
  age: number;
  nationality: Nationality;
  basic: number;
  allowanceLines: { label: string; amount: number; fixed: boolean }[];
  allowances: number;
  unpaidDays: number;
  unpaidDeduction: number;
  claimIds: Id[];
  claims: number;
  gross: number;
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
  deductions: number;
  net: number;
  bank: { bank: string; accountMasked: string } | null;
  /** Anything HR or the approvers should look at: no bank account, pay changed from last month, and so on. */
  flags: string[];
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
  approved: StaffPayStep | null;
  consented: StaffPayStep | null;
  /** Finance records the bank's reference once paid, and confirms the PCB was checked in LHDN's e-PCB. */
  paid: (StaffPayStep & { bankRef: string; paidOn: IsoDate; pcbChecked: true }) | null;
  /** Sent back for changes; the approvals start again. */
  returns: (StaffPayStep & { from: StaffPayStage })[];
}

// ---------- Contracts and site mobilisation (V3, V6 amendment; consolidated plan W-contracts) ----------
// A contract is signed or awarded, the site is mobilised against 11 workstreams, the company issues the Site
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
export type MobWorkstream = 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'W7' | 'W8' | 'W9' | 'W10' | 'W11';

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
  versions: ContractVersion[];
  mobilisation: MobItem[];
  /** Site Ready-to-Operate Certificate: the company manager signs once every critical item is done. */
  rtoCert: { by: string; at: IsoDateTime; note: string } | null;
  reviews: ContractReview[];
  history: { at: IsoDateTime; by: string; from: ContractState | null; to: ContractState; note: string }[];
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
export interface FinPackItem {
  id: Id;
  label: string;
  dueOn: IsoDate;
  status: FinPackStatus;
  by: string | null;
  at: IsoDateTime | null;
}

/** One company's books as SQL Account shows them, plus its auditor and tax agent papers. */
export interface FinStatus {
  id: Id;
  /** The company, or 'pwvsb' for PWVSB itself. */
  companyId: Id;
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
}

// ---------- JA Group app feed (Fauzan, 26 Oct 2026) ----------
// Guard-to-officer payroll, foreign worker management and incidents live in the JA Group app. It sends their data to
// Prima by API; Prima shows it read-only and never edits it.

export type JaDataset = 'payroll' | 'worker' | 'incident';

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
  status: 'in_use' | 'disposal_pending' | 'disposed';
  lastCheckedOn: IsoDate | null;
  /** Disposal: the Asset Management team asks, Finance (or the COO for a larger book value) approves, the team records it. */
  disposal?: AmDisposal | null;
  /**
   * End-of-life reviews once fully written off (Fauzan, 27 Oct 2026): if it can still be used, keep using it or
   * refurbish it; dispose only when neither works. Newest last.
   */
  lifeReviews?: { on: IsoDate; decision: 'keep' | 'rehab'; note: string; cost: number | null; by: string; nextReviewOn: IsoDate }[];
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
  status: 'open' | 'planned' | 'fixed' | 'closed';
}

/** One audit of a workflow, against the ACT audit plan. */
export interface ActAudit {
  id: Id;
  area: string;
  companyId: Id | null;
  doneOn: IsoDate;
  by: string;
  result: 'clean' | 'findings';
  note: string;
  findingIds: Id[];
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
  startOn: IsoDate;
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


export interface ItManualReceipt { id:string; userId:string; requestId:string; kind:ItManualKind; hash:string; outcome:"committed"|"rejected"; recordId:string|null; version:number|null; message:string|null; at:string; }

export type ItOperationKind='rental_rates'|'rental_bill'|'rental_history'|'asset_inspection';
export interface ItRentalRate {id:string;version:number;effectiveOn:string;currency:'MYR';monthly:Partial<Record<ItAssetKind,number>>;evidence:string;note:string;byId:string;at:string;}
export interface ItAssetInspection {id:string;assetId:string;jobId:string;version:number;inspectedOn:string;nextDueOn:string;condition:'healthy'|'attention'|'unsafe';findings:string;evidence:string;followUp:string;byId:string;at:string;}
export interface ItOperationalReceipt extends Omit<ItManualReceipt,'kind'>{kind:ItOperationKind;}
