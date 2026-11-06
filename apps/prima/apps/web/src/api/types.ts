import type { ExtractionClient } from './it-extraction';
import type { ConnectionsClient } from './connections';
export type { ConnectionsClient, SharePointStatus, SharePointCheck, SharePointLibraries, SharePointItems } from './connections';
import type { ClientShareLink, ClientShareReport } from '@prima/core';
export type { ClientShareLink, ClientShareReport } from '@prima/core';
/** linksOn is false when the server has no link key or public address set: links cannot be made there. */
export type ClientShareLinksView = { canCreate: boolean; links: (ClientShareLink & { live: boolean })[]; linksOn: boolean };
import type {
  FinRequestAction,
  FinCheckSection,
  FinCloseAction,
  FinPackKind,
  FinPaymentAction,
  ArishaDraft,
  CmsServiceKind,
  ArishaAnswer,
  ArishaFinanceDraft,
  ArishaReviewDraft,
  ArishaTurn,
  DataMode,
  ArmedJobStatus,
  AttendanceIssue,
  Case,
  CaseType,
  Company,
  DisciplineStep,
  FaceCapture,
  FollowUpKind,
  Home,
  GrowthPanel,
  GrowthMargin,
  IsoDate,
  PrimaService,
  RecordKind,
  ReportDef,
  RecordValues,
  EvidenceDoc,
  FwPaper,
  SocsoStatus,
  ProofInput,
  Quotation,
  Severity,
  Tender,
  TenderDecisionChoice,
  TenderBidPart,
  TenderPaperKind,
  TenderQuery,
  TenderRecord,
  TenderStatus,
  User,
} from '@prima/core';

type R<K extends keyof PrimaService> = PrimaService[K] extends (...args: never[]) => Promise<infer T> ? T : never;
export type ArmsRequestAction = Parameters<PrimaService['armsRequestStep']>[2];
export type ArmsRequestStepExtra = NonNullable<Parameters<PrimaService['armsRequestStep']>[4]>;
export type RaiseArmsRequestInput = Parameters<PrimaService['raiseArmsRequest']>[1];
export type SpecialOpsLegalFlags = R<'specialOpsLegalFlags'>;
export type ArmsTradingState = R<'armsTrading'>;
export type ApprovalLimitsView = R<'approvalLimits'>;
export type TransportBoard = R<'transportBoard'>;
export type AmRentCheck = R<'amRentCheck'>;
export type AmBuyInput = Parameters<PrimaService['amBuyRequest']>[1];
export type AmWhatsAppBoard = R<'amWhatsAppBoard'> & { connector: { configured: boolean; switchedOn: boolean; sending: boolean; missing: string[] } };

export type Overview = R<'groupOverview'>;
export type CompanyDashboard = R<'companyDashboard'>;
export type SiteList = R<'sites'>;
export type SiteDetail = R<'siteDetail'>;
export type PeopleList = R<'people'>;
export type PersonDetail = R<'personDetail'>;
export type Roster = R<'roster'>;
export type Candidates = R<'candidates'>;
export type AttendanceDay = R<'attendance'>;
export type AttendanceAlerts = R<'attendanceAlerts'>;
export type DisciplineHistory = R<'disciplineHistory'>;
export type GuardProfile = R<'guardProfile'>;
export type MyDuty = R<'myDuty'>;
export type MyStaffClock = R<'myStaffClock'>;
export type StaffClockBoard = R<'staffClockBoard'>;
export type StaffClockDetail = R<'staffClockDetail'>;
export type MyRemote = R<'myRemote'>;
export type RemoteBoard = R<'remoteBoard'>;
export type RemoteApplyInput = Parameters<PrimaService['remoteApply']>[1];
export type MyWork = R<'myWork'>;
export type TeamWork = R<'teamWork'>;
export type WorkRebalance = R<'workRebalance'>;
export type WorkReassignInput = Parameters<PrimaService['workTaskReassign']>[2];
export type WorkAdjustInput = Parameters<PrimaService['workTaskAdjust']>[2];
export type PersonWork = R<'personWork'>;
export type WorkSummary = R<'workSummary'>;
export type BranchWork = R<'branchWork'>;
export type WorkCheckInInput = Parameters<PrimaService['workCheckIn']>[1];
export type WorkTaskInput = Parameters<PrimaService['workTaskAdd']>[1];
export type BranchCheckInput = Parameters<PrimaService['branchCheckSubmit']>[2];
export type BranchVisitInput = Parameters<PrimaService['branchVisitRecord']>[2];
export type StaffShotInput = Parameters<PrimaService['staffClockIn']>[1];
export type MyFace = R<'myFace'>;
export type FaceReviews = R<'faceReviews'>;
export type PublicHolidays = R<'publicHolidays'>;
export type HrLeaveSettings = R<'hrLeaveSettings'>;
export type FlexRequests = R<'flexRequests'>;
export type HrJoinLeave = R<'hrJoinLeave'>;
export type HrCases = R<'hrCases'>;
export type HrCaseInput = Parameters<PrimaService['openHrCase']>[1];
export type HrCaseStepInput = Parameters<PrimaService['hrCaseStep']>[2];
export type OfficeOshBoard = R<'officeOsh'>;
export type OshCoordinatorInput = Parameters<PrimaService['appointOshCoordinator']>[1];
export type OfficeAssessmentInput = Parameters<PrimaService['recordOfficeAssessment']>[1];
export type OshIncidentInput = Parameters<PrimaService['reportOshIncident']>[1];
export type OshReportInput = Parameters<PrimaService['recordOshReport']>[2];
export type TrainingBoard = R<'trainingRecords'>;
export type GuardTrainingBoard = R<'guardTraining'>;
export type GuardPaperInput = Parameters<PrimaService['recordGuardPaper']>[1];
export type TrainingInput = Parameters<PrimaService['recordTraining']>[1];
export type AppraisalBoard = R<'appraisals'>;
export type AppraisalOpenInput = Parameters<PrimaService['openAppraisal']>[1];
export type AppraisalRateInput = Parameters<PrimaService['rateAppraisal']>[2];
export type PolicyBoard = R<'hrPolicies'>;
export type PolicyInput = Parameters<PrimaService['publishPolicy']>[1];
export type OvertimeBoard = R<'staffOvertime'>;
export type HrLegalBoard = R<'hrLegalChecks'>;
export type HrLegalInput = Parameters<PrimaService['updateHrLegalCheck']>[2];
export type OvertimeInput = Parameters<PrimaService['setStaffOvertime']>[1];
export type OvertimePreviewInput = Parameters<PrimaService['overtimePreview']>[1];
export type OvertimePreview = R<'overtimePreview'>;
export type Vacancies = R<'vacancies'>;
export type StaffMovements = R<'staffMovements'>;
export type AllowancesData = R<'allowanceTypes'>;
export type LoginHandoversData = R<'loginHandovers'>;
export type LeavingGuide = R<'leavingGuide'>;
export type HrFilingInput = Parameters<PrimaService['recordHrFiling']>[1];
export type VacancyInput = Parameters<PrimaService['raiseVacancy']>[1];
export type HolidayInput = Parameters<PrimaService['addPublicHoliday']>[1];
export type FlexInput = Parameters<PrimaService['requestFlex']>[1];
export type TenderProtocolView = R<'tenderProtocol'>;
export type TenderBoard = R<'tenderBoard'>;
export type TenderGroups = R<'tenderGroups'>;
export type Reports = R<'reports'>;
export type Meetings = R<'meetings'>;
export type TenderProtocolInput = Parameters<PrimaService['setTenderProtocol']>[1];
export type LeaveList = R<'leaveRequests'>;
export type SocsoClaims = R<'socsoClaims'>;
export type SocsoClaimDetail = R<'socsoClaimDetail'>;
export type SocsoStartInput = Parameters<PrimaService['startSocsoClaim']>[2];
export type SocsoAdvanceInput = NonNullable<Parameters<PrimaService['advanceSocsoClaim']>[3]>;
export type FwmBoard = R<'fwmBoard'>;
export type FwmWelfare = R<'fwmWelfare'>;
export type HostelBoard = R<'hostelBoard'>;
export type StaffClaims = R<'staffClaims'>;
export type MyReceipts = R<'myReceipts'>;
export type Memos = R<'memos'>;
export type PdpaBoard = R<'pdpaBoard'>;
export type FleetBoard = R<'fleetBoard'>;
export type ClientBoard = R<'clientBoard'>;
export type CompanyOffice = R<'companyOffice'>;
export type CompanyOffices = R<'companyOffices'>;
export interface OfficeDeskInput {
  desk: string;
  ownerUserId: string | null;
  backupUserId: string | null;
}
export type JaBoard = R<'jaBoard'>;
export type AmBoard = R<'amBoard'>;
export type StaffPayBoard = R<'staffPayroll'>;
export type FinBoard = R<'finBoard'>;
export type FinDesk = Awaited<ReturnType<PrimaService['finance']['desk']>>;
export type FinSettingsView = Awaited<ReturnType<PrimaService['finance']['settingsView']>>;
export type FinKpiView = Awaited<ReturnType<PrimaService['financeKpi']['view']>>;
export type FinRequestList = Awaited<ReturnType<PrimaService['financeRequests']['list']>>;
export type FinCooDesk = Awaited<ReturnType<PrimaService['finance']['cooDesk']>>;
export type FinControls = Awaited<ReturnType<PrimaService['financeControls']['view']>>;
export type FinDashboard = Awaited<ReturnType<PrimaService['financeControls']['dashboard']>>;
export type FinPack = Awaited<ReturnType<PrimaService['financeControls']['pack']>>;
export type FinControlArea = 'payees' | 'statements' | 'ageing' | 'sst' | 'plan' | 'einvoice' | 'ar' | 'bankrec' | 'regular' | 'guarantees' | 'tax' | 'mandates' | 'advances' | 'petty' | 'cards' | 'billing' | 'govt' | 'moneyin' | 'stamp' | 'dailycash' | 'intercompany' | 'cash13' | 'pack' | 'hostel' | 'deposits' | 'fd' | 'charges' | 'wht' | 'schedules' | 'assets' | 'audit' | 'credit' | 'supstatements' | 'figures' | 'coa' | 'sql';
export type ContractBoard = R<'contracts'>;
export type BranchBoard = R<'branchBoard'>;
export type ItBoard = R<'itBoard'>;
export type ItPlan = R<'itPlan'>;
/** Group website management (Fauzan, 27 Oct 2026). */
export type WebBoard = Awaited<ReturnType<PrimaService['websites']['board']>>;
export type WebBoardOk = Extract<WebBoard, { allowed: true }>;
export type CorpBoard = R<'corpBoard'>;
export type CompanyFiles = R<'companyFiles'>;
export type CompanyFileInput = Parameters<PrimaService['saveCompanyFile']>[2];
export type CompanyFileStart = Parameters<PrimaService['startCompanyFile']>[2];
export type MeetingActionInput = Parameters<PrimaService['addMeetingAction']>[2];
export type RenewalBoard = R<'renewalBoard'>;
export type RenewalAction = 'open' | 'paper' | 'addPaper' | 'sign' | 'fee' | 'submit' | 'agency' | 'return' | 'renewed' | 'confirm';
export type RenewalBody = { index?: number; name?: string; ref?: string; amount?: number | null; on?: string; note?: string; newExpiresOn?: string; ok?: boolean };
export type CreditBoard = R<'creditBoard'>;
export type CreditLoanInput = Parameters<PrimaService['addCreditLoan']>[2];
export type CreditCorrectionInput = Parameters<PrimaService['creditCorrectRecord']>[2];
export type PurBoard = R<'purBoard'>;
export type GovBoard = R<'govBoard'>;
export type GrcBoard = R<'grcBoard'>;
export type PdpaRights = R<'pdpaRights'>;
export type BcmBoard = R<'bcmBoard'>;
export type CorpAuditLegal = R<'corpAuditLegal'>;
export type SalesLeads = R<'salesLeads'>;
export type FixedAssets = R<'fixedAssets'>;
export type ActBoard = R<'actBoard'>;
export type ActFindingInput = Parameters<PrimaService['raiseActFinding']>[1];
export type ActFindingBody = Parameters<PrimaService['actFindingStep']>[3];
export type ActAuditInput = Parameters<PrimaService['recordActAudit']>[1];
export type ActImprovementInput = Parameters<PrimaService['addActImprovement']>[1];
export type DisposalAction = Parameters<PrimaService['amDisposalStep']>[2];
export type DisposalBody = Parameters<PrimaService['amDisposalStep']>[3];
export type SalesLeadInput = Parameters<PrimaService['addSalesLead']>[2];
export type SalesLeadAction = Parameters<PrimaService['salesLeadStep']>[2];
export type SalesLeadBody = Parameters<PrimaService['salesLeadStep']>[3];
export type LegalMatterInput = Parameters<PrimaService['addLegalMatter']>[2];
export type AuditStepBody = Parameters<PrimaService['corpAuditStep']>[3];
export type LegalStepBody = Parameters<PrimaService['legalMatterStep']>[3];
export type PdpaDpoInput = Parameters<PrimaService['recordPdpaDpo']>[2];
export type PdpaRequestInput = Parameters<PrimaService['addPdpaRequest']>[1];
export type WhistleInput = Parameters<PrimaService['submitWhistle']>[1];
export type GiftInput = Parameters<PrimaService['declareGift']>[1];
export type GovMandateInput = Parameters<PrimaService['addGovMandate']>[2];
export type PurRequestInput = Parameters<PrimaService['raisePurRequest']>[2];
export type PurSupplierInput = Parameters<PrimaService['addPurSupplier']>[2];
export type PurStepBody = NonNullable<Parameters<PrimaService['purStep']>[3]>;
export type MyItems = R<'myItems'>;
export type DeliveryProof = R<'deliveryProof'>;
export type RecordFormData = R<'recordForm'>;
export type PayChangesData = R<'payChanges'>;
export type CorpChangeInput = Parameters<PrimaService['raiseCorpChange']>[2];
export type CorpFilingInput = Parameters<PrimaService['addCorpFiling']>[2];
export type ItTicketInput = Parameters<PrimaService['raiseItTicket']>[1];
export type ItPurchaseInput = Parameters<PrimaService['raiseItPurchase']>[1];
export type BranchAgreementInput = Parameters<PrimaService['addBranchAgreement']>[2];
export type VariationInput = Parameters<PrimaService['addContractVariation']>[2];
export type ArmedJobInput = Parameters<PrimaService['planArmedJob']>[1];
export type ContractInput = Parameters<PrimaService['addContract']>[1];
export type ClientAccountInput = Parameters<PrimaService['addClientAccount']>[1];
export type StaffPayRunView = R<'staffPayRun'>;
export type StaffPayAction = Parameters<PrimaService['staffPayStep']>[2];
export type StaffPayStepBody = NonNullable<Parameters<PrimaService['staffPayStep']>[3]>;
export type StaffPayFile = Parameters<PrimaService['staffPayExport']>[2];
export type StaffPayLinePatch = Parameters<PrimaService['setStaffPayLine']>[3];
export type ExpenseBoard = R<'expenseBoard'>;
export type ExpenseInput = Parameters<PrimaService['saveExpense']>[1];
export type ProductBoard = R<'productBoard'>;
export type ProposalCheck = R<'proposalReadiness'>;
export type ProductInput = Parameters<PrimaService['saveProduct']>[1];
export type ProductCertInput = Parameters<PrimaService['saveProductCert']>[2];
export type VehicleRequestInput = Parameters<PrimaService['requestVehicle']>[1];
export type VehicleWorkInput = Parameters<PrimaService['recordVehicleWork']>[2];
export type PdpaCaseInput = Parameters<PrimaService['openPdpaCase']>[1];
export type PdpaStepName = Parameters<PrimaService['pdpaStep']>[2];
export type HostelBillInput = { hostelId: string; kind: 'RENT' | 'ELECTRICITY' | 'WATER' | 'MAINTENANCE'; period: string; amount: number; dueOn: string };
export type StaffClaimInput = Parameters<PrimaService['submitStaffClaim']>[1];
export type FwRenewalInput = Parameters<PrimaService['submitFwRenewal']>[3];
export type FwmTaskInput = Parameters<PrimaService['createFwmTask']>[2];
export type FwCheckInput = Parameters<PrimaService['recordFwCheck']>[2];
export type FwCheckCloseInput = Parameters<PrimaService['closeFwCheck']>[2];
export type SocsoRehabInput = Parameters<PrimaService['setSocsoRehab']>[2];
export type SocsoRestrictionInput = Parameters<PrimaService['addSocsoRestriction']>[2];
export type LeaveInput = Parameters<PrimaService['requestLeave']>[1];
export type HospitalClaimInput = Parameters<PrimaService['updateHospitalClaim']>[2];
export type HiringDocKind = Parameters<PrimaService['uploadHiringDoc']>[2];
export interface FollowUpInput {
  shiftId?: string | null;
  attendanceId?: string | null;
  issue: AttendanceIssue;
  kind: FollowUpKind;
  note: string;
  replacementPersonId?: string | null;
  discipline?: DisciplineStep | null;
  suspensionDays?: number | null;
  proof?: ProofInput[];
}
export type CaseList = R<'cases'>;
export type CaseDetail = R<'caseDetail'>;
export type SiteVisits = R<'siteVisits'>;
/** A stamped photo from the in-app camera with its GPS fix. */
export interface PhotoInput {
  image: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  capturedAt: string;
  caption?: string;
  source?: 'in_app_camera' | 'test_picture';
}
export type Compliance = R<'compliance'>;
export type AuditLog = R<'auditLog'>;
export type ClockInResult = R<'clockIn'>;
export type ClockOutResult = R<'clockOut'>;
export type ScanResult = R<'scanCheckpoint'>;
export type Commercial = R<'commercial'>;
export type HrMonitor = R<'hrMonitor'>;
export type Insurance = R<'insurance'>;
export type Cms = R<'cms'>;
export type CmsCommissioning = R<'cmsCommissioning'>;
export type CmsServiceInput = Parameters<PrimaService['setCmsService']>[2];
export type CmsSettingsPatch = Parameters<PrimaService['updateCmsSettings']>[1];
export type RegionalOps = R<'regionalOps'>;
export type GovOpsMonitor = R<'govOpsMonitor'>;
export type ManagementFees = R<'managementFees'>;
export type ManagementFeeBills = R<'managementFeeBills'>;
export type ArmsOverview = R<'armsOverview'>;
export type ArmsDetail = R<'arms'>;
export type ArmsControl = R<'armsControl'>;

export interface Me {
  user: User;
  companies: Company[];
  now: string;
  /** What the server's records are (PRIMA_DATA_MODE); an older server sends none, which reads as test data. */
  dataMode?: DataMode;
}

export interface RaiseCaseInput {
  companyId: string;
  siteId: string | null;
  type: CaseType;
  severity: Severity;
  title: string;
  description: string;
  /** Site device: the guard signs the report with staff number and face. */
  reporter?: { staffNo: string; face: FaceCapture | null } | null;
  /** Photo or document proof (rule CASE-PROOF); required except for an SOS. */
  proof?: ProofInput[];
}
export type SignOffOutcome = 'verified' | 'resolved' | 'sent_back' | 'confirmed' | 'escalated';

export type CaseAction = 'acknowledge' | 'escalate' | 'resolve' | 'close' | 'note';
export type QuotationAction = 'submit' | 'approve' | 'return' | 'sent' | 'accepted' | 'rejected';

export type NewTender = Parameters<PrimaService['addTender']>[2];

export interface NewQuotation {
  client: string;
  siteName: string;
  tenderId: string | null;
  guards: number;
  hoursPerDay: 8 | 12;
  ratePerGuard: number;
  validDays: number;
  note?: string;
}

/** Everything the screens need. Implemented by the HTTP client and by the in-browser demo. */
export interface Api extends ConnectionsClient, ExtractionClient {
  /** Hand-overs between departments and real-data import (connect-departments, 2 Nov 2026). */
  readonly org: OrgClient;
  m365Call(expectedUserId: string, method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
  readonly mode: 'demo' | 'server';
  itImportReviewAssertOwner?(): Promise<void>;
  itImportReviewRequest?(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown>;
  /** Test link only: a few active staff of a company with their test PINs, to sign as a witness. */
  demoWitnesses?(companyId: string): Promise<{ name: string; staffNo: string; pin: string }[]>;
  listUsers(): Promise<User[]>;
  signIn(userId: string): Promise<Me>;
  /** Server only: which sign-in ways this server offers (Microsoft 365 and/or the development picker). */
  signInOptions?(): Promise<{ microsoft: boolean; devLogin: boolean; office?: boolean }>;
  /** Server only: go to the Microsoft 365 sign-in page; the app reopens signed in. */
  signInMicrosoft?(): Promise<void>;
  /** Server only: forget the session (and sign out of Microsoft for this app). */
  signOut?(): Promise<void>;
  me(): Promise<Me>;
  overview(): Promise<Overview>;
  dashboard(companyId: string): Promise<CompanyDashboard>;
  sites(companyId: string): Promise<SiteList>;
  site(siteId: string): Promise<SiteDetail>;
  people(companyId: string, q?: string): Promise<PeopleList>;
  person(personId: string): Promise<PersonDetail>;
  guardProfile(personId: string): Promise<GuardProfile>;
  myDuty(): Promise<MyDuty>;
  myStaffClock(): Promise<MyStaffClock>;
  /** Sign-in clocks staff in and sign-out clocks them out (Fauzan, 27 Oct 2026). */
  confidentiality(): ReturnType<PrimaService['confidentiality']>;
  acceptConfidentiality(): Promise<unknown>;
  staffSessionStart(): Promise<unknown>;
  staffSessionEnd(): Promise<unknown>;
  staffClockIn(input: StaffShotInput): Promise<unknown>;
  myFace(): Promise<MyFace>;
  registerFace(input: { photo: string; descriptor: number[] }): Promise<unknown>;
  staffFaceCheck(input: StaffShotInput): Promise<unknown>;
  faceReviews(): Promise<FaceReviews>;
  decideFace(personId: string, approve: boolean, note: string): Promise<unknown>;
  removeFace(personId: string, note: string): Promise<unknown>;
  publicHolidays(year?: string): Promise<PublicHolidays>;
  addPublicHoliday(input: HolidayInput): Promise<unknown>;
  removePublicHoliday(id: string, note: string): Promise<unknown>;
  hrLeaveSettings(): Promise<HrLeaveSettings>;
  setLeaveOverride(personId: string, kind: 'ANNUAL' | 'SICK' | 'MATERNITY' | 'PATERNITY', days: number | null, note: string): Promise<unknown>;
  setWfhAllowed(personId: string, allow: boolean, note: string): Promise<unknown>;
  flexRequests(): Promise<FlexRequests>;
  requestFlex(input: FlexInput): Promise<unknown>;
  decideFlex(id: string, approve: boolean, note: string): Promise<unknown>;
  hrJoinLeave(): Promise<HrJoinLeave>;
  hrCases(personId?: string): Promise<HrCases>;
  openHrCase(input: HrCaseInput): Promise<unknown>;
  hrCaseStep(id: string, input: HrCaseStepInput): Promise<unknown>;
  officeOsh(): Promise<OfficeOshBoard>;
  appointOshCoordinator(input: OshCoordinatorInput): Promise<unknown>;
  recordOfficeAssessment(input: OfficeAssessmentInput): Promise<unknown>;
  reportOshIncident(input: OshIncidentInput): Promise<unknown>;
  recordOshReport(id: string, input: OshReportInput): Promise<unknown>;
  trainingRecords(personId?: string): Promise<TrainingBoard>;
  guardTraining(): Promise<GuardTrainingBoard>;
  recordGuardPaper(input: GuardPaperInput): Promise<unknown>;
  recordTraining(input: TrainingInput): Promise<unknown>;
  appraisals(): Promise<AppraisalBoard>;
  openAppraisal(input: AppraisalOpenInput): Promise<unknown>;
  rateAppraisal(id: string, input: AppraisalRateInput): Promise<unknown>;
  commentAppraisal(id: string, comment: string): Promise<unknown>;
  closeAppraisal(id: string, note: string): Promise<unknown>;
  hrPolicies(): Promise<PolicyBoard>;
  publishPolicy(input: PolicyInput): Promise<unknown>;
  staffOvertime(): Promise<OvertimeBoard>;
  hrLegalChecks(): Promise<HrLegalBoard>;
  updateHrLegalCheck(id: string, input: HrLegalInput): Promise<unknown>;
  setStaffOvertime(input: OvertimeInput): Promise<unknown>;
  overtimePreview(input: OvertimePreviewInput): Promise<OvertimePreview>;
  acknowledgePolicy(id: string): Promise<unknown>;
  recordHrFiling(input: HrFilingInput): Promise<unknown>;
  eaDraft(companyId: string, year: string): Promise<{ filename: string; body: string; note: string }>;
  employeeRegister(companyId: string): Promise<{ filename: string; body: string }>;
  decideProbation(personId: string, decision: 'confirm' | 'extend', newEndsOn: string | null, note: string): Promise<unknown>;
  leavingGuide(personId: string): Promise<LeavingGuide>;
  vacancies(): Promise<Vacancies>;
  staffMovements(): Promise<StaffMovements>;
  prepareStaffMovement(input: Parameters<PrimaService['prepareStaffMovement']>[1]): Promise<unknown>;
  staffMovementStep(id: string, approve: boolean, note: string): Promise<unknown>;
  cancelStaffMovement(id: string, note: string): Promise<unknown>;
  applyStaffMovement(id: string): Promise<unknown>;
  authoriseMovementLogin(id: string, approve: boolean, note: string): Promise<unknown>;
  confirmMovementLogin(id: string, note: string): Promise<unknown>;
  loginHandovers(): Promise<LoginHandoversData>;
  applyDueStaffMovements(): Promise<{ applied: string[]; failed: { id: string; message: string }[] }>;
  allowanceTypes(): Promise<AllowancesData>;
  saveAllowanceType(input: Parameters<PrimaService['saveAllowanceType']>[1]): Promise<unknown>;
  requestAllowanceChange(personId: string, input: Parameters<PrimaService['requestAllowanceChange']>[2]): Promise<unknown>;
  raiseVacancy(input: VacancyInput): Promise<unknown>;
  vacancyStep(id: string, action: 'ceo_approve' | 'ceo_refuse' | 'sign' | 'close', note: string): Promise<unknown>;
  staffClockOut(input: StaffShotInput): Promise<unknown>;
  staffPing(input: { lat: number; lng: number; accuracyM: number | null; capturedAt?: string }): Promise<unknown>;
  staffClockBoard(date?: string): Promise<StaffClockBoard>;
  staffClockDetail(id: string): Promise<StaffClockDetail>;
  /** Working from home (Fauzan, 27 Oct 2026). */
  myRemote(): Promise<MyRemote>;
  remoteApply(input: RemoteApplyInput): Promise<unknown>;
  remotePlan(tasks: string[]): Promise<unknown>;
  remoteTask(taskId: string, done: boolean, output: string): Promise<unknown>;
  remoteCheckIn(note: string): Promise<unknown>;
  remoteReport(input: { summary: string; blockers: string }): Promise<unknown>;
  remoteBoard(): Promise<RemoteBoard>;
  remoteDecide(id: string, approve: boolean, note: string): Promise<unknown>;
  remoteEnd(id: string, note: string): Promise<unknown>;
  remoteReview(dayId: string, verdict: 'accepted' | 'queried', note: string): Promise<unknown>;
  myWork(): Promise<MyWork>;
  workCheckIn(input: WorkCheckInInput): Promise<unknown>;
  workTaskAdd(input: WorkTaskInput): Promise<unknown>;
  workTaskDone(id: string, input: { note: string; ref: string }): Promise<unknown>;
  workTaskLate(id: string, input: { reason: string; newDueAt: string }): Promise<unknown>;
  workTaskReview(id: string, accept: boolean, note: string): Promise<unknown>;
  seenCooNotice(kind: 'work' | 'fwm', id: string, noticeId: string): Promise<unknown>;
  helpAsk(input: { text: string; taskId: string | null }): Promise<unknown>;
  helpAnswer(id: string, text: string): Promise<unknown>;
  oneOnOneRecord(input: { userId: string; notes: string; agreed: string[] }): Promise<unknown>;
  playbookSignOff(userId: string): Promise<unknown>;
  teamWork(): Promise<TeamWork>;
  workRebalance(): Promise<WorkRebalance>;
  workRebalanceAskAi(adviceId: string): Promise<{ text: string; source: string }>;
  workTaskReassign(id: string, input: WorkReassignInput): Promise<unknown>;
  workTaskAdjust(id: string, input: WorkAdjustInput): Promise<unknown>;
  personWork(userId: string): Promise<PersonWork>;
  workSummary(): Promise<WorkSummary>;
  plannerSync(): Promise<unknown>;
  branchWork(): Promise<BranchWork>;
  branchCheckSubmit(branchId: string, input: BranchCheckInput): Promise<unknown>;
  branchVisitRecord(branchId: string, input: BranchVisitInput): Promise<unknown>;
  leaveRequests(filter?: { companyId?: string; waiting?: 'me'; status?: 'pending' | 'all' }): Promise<LeaveList>;
  requestLeave(input: LeaveInput): Promise<unknown>;
  socsoClaims(): Promise<SocsoClaims>;
  socsoClaim(id: string): Promise<SocsoClaimDetail>;
  startSocsoClaim(personId: string, input: SocsoStartInput): Promise<{ id: string }>;
  addSocsoDoc(id: string, item: string, proof: ProofInput[], mc?: { from: IsoDate; to: IsoDate }): Promise<unknown>;
  overrideSocsoDoc(id: string, item: string, reason: string): Promise<unknown>;
  advanceSocsoClaim(id: string, to: SocsoStatus, input: SocsoAdvanceInput): Promise<unknown>;
  setSocsoRehab(id: string, input: SocsoRehabInput): Promise<unknown>;
  addSocsoAppointment(id: string, input: { at: string; what: string }): Promise<unknown>;
  addSocsoRestriction(id: string, input: SocsoRestrictionInput): Promise<unknown>;
  clearSocsoRestriction(id: string, restrictionId: string, note: string): Promise<unknown>;
  addSocsoCheckIn(id: string, note: string): Promise<unknown>;
  fwmBoard(): Promise<FwmBoard>;
  hostelBoard(): Promise<HostelBoard>;
  addHostelBill(input: HostelBillInput, proof: ProofInput[]): Promise<unknown>;
  hostelBillStep(billId: string, step: 'request' | 'check' | 'approve' | 'slip', ok: boolean, note: string, proof?: ProofInput[]): Promise<unknown>;
  decideUtilityCharge(chargeId: string, decision: 'NOTICE' | 'DEDUCTION', note: string): Promise<unknown>;
  ackUtilityNotice(chargeId: string): Promise<unknown>;
  fileUtilityPaper(personId: string, what: 'clause' | 'ack', proof: ProofInput[]): Promise<unknown>;
  staffClaims(): Promise<StaffClaims>;
  submitStaffClaim(input: StaffClaimInput, proof: ProofInput[]): Promise<unknown>;
  myReceipts(): Promise<MyReceipts>;
  addReceipts(proof: ProofInput[], reads?: unknown[]): Promise<unknown>;
  receiptAction(id: string, action: 'confirm' | 'remove', input: { date?: string; amount?: number; merchant?: string; kind?: string; why?: string }): Promise<unknown>;
  headVerifyClaim(claimId: string, ok: boolean, note: string): Promise<unknown>;
  decideStaffClaim(claimId: string, by: 'cos' | 'hr' | 'coo' | 'finance', ok: boolean, note: string): Promise<unknown>;
  setClaimRate(month: string, vehicle: 'CAR' | 'MOTORCYCLE' | 'COMPANY_CAR', perKm: number): Promise<unknown>;
  productBoard(): Promise<ProductBoard>;
  saveProduct(input: ProductInput): Promise<unknown>;
  saveProductCert(productId: string, input: ProductCertInput, proof: ProofInput[]): Promise<unknown>;
  proposalReadiness(productIds: string[]): Promise<ProposalCheck>;
  clientBoard(): Promise<ClientBoard>;
  companyOffice(companyId: string): Promise<CompanyOffice>;
  companyOffices(): Promise<CompanyOffices>;
  setOfficeDesks(companyId: string, desks: OfficeDeskInput[], note: string): Promise<unknown>;
  setCompanyRunBy(companyId: string, runByCompanyId: string | null, reason: string): Promise<unknown>;
  jaBoard(): Promise<JaBoard>;
  amBoard(): Promise<AmBoard>;
  staffPayroll(): Promise<StaffPayBoard>;
  myZakat(): Promise<Awaited<ReturnType<PrimaService['myZakat']>>>;
  setMyZakat(input: { body: string | null; percent?: number }): Promise<unknown>;
  statTables(period?: string): Promise<Awaited<ReturnType<PrimaService['statTables']>>>;
  loadStatTable(input: { id: string; from: string; source: string; doc: string; rows: string; above?: { erPct: number; eePct: number } }): Promise<Awaited<ReturnType<PrimaService['loadStatTable']>>>;
  checkStatTable(input: { id: string; version: string; decision: 'check' | 'reject'; comment: string }): Promise<unknown>;
  setEmployerNos(companyId: string, input: { epf: string | null; socso: string | null; lhdnE: string | null; hrd: string | null }): Promise<unknown>;
  finBoard(): Promise<FinBoard>;
  contracts(): Promise<ContractBoard>;
  branchBoard(): Promise<BranchBoard>;
  itBoard(): Promise<ItBoard>;
  itPlan(span: 'week' | 'month' | 'year', from?: string): Promise<ItPlan>;
  websiteBoard(): Promise<WebBoard>;
  websiteAction(action: string, input: Record<string, unknown>): Promise<unknown>;
  /** Website connectors: the server reads each switched-on service; the demo has none. */
  websiteSync(): Promise<{ ran: string[]; issues: string[]; notices: number; delivered: number }>;
  corpBoard(): Promise<CorpBoard>;
  panelBoard(): Promise<R<'panelBoard'>>;
  addPanelFirm(input: Parameters<PrimaService['addPanelFirm']>[1]): Promise<unknown>;
  panelFirmStep(id: string, action: 'review' | 'remove', note: string): Promise<unknown>;
  adviserMoneyStep(id: string, action: Parameters<PrimaService['adviserMoneyStep']>[2], body: Parameters<PrimaService['adviserMoneyStep']>[3]): Promise<unknown>;
  delegationBoard(): Promise<R<'delegationBoard'>>;
  addDelegation(companyId: string, input: Parameters<PrimaService['addDelegation']>[2]): Promise<unknown>;
  delegationStep(id: string, action: Parameters<PrimaService['delegationStep']>[2], note: string, body?: Parameters<PrimaService['delegationStep']>[4]): Promise<unknown>;
  legalHoldBoard(): Promise<R<'legalHoldBoard'>>;
  placeLegalHold(matterId: string, input: Parameters<PrimaService['placeLegalHold']>[2]): Promise<unknown>;
  releaseLegalHold(id: string, reason: string): Promise<unknown>;
  addCriticalRole(companyId: string, input: Parameters<PrimaService['addCriticalRole']>[2]): Promise<unknown>;
  criticalRoleStep(id: string, action: 'review' | 'retire', body: Parameters<PrimaService['criticalRoleStep']>[3]): Promise<unknown>;
  creditCheckLenderLicence(loanId: string, input: Parameters<PrimaService['creditCheckLenderLicence']>[2]): Promise<unknown>;
  ceoInstructions(): Promise<R<'ceoInstructions'>>;
  ceoInstruct(input: Parameters<PrimaService['ceoInstruct']>[1]): Promise<unknown>;
  directorDigest(): Promise<R<'directorDigest'>>;
  directorLegalFlags(): Promise<R<'directorLegalFlags'>>;
  companyFiles(): Promise<CompanyFiles>;
  saveCompanyFile(companyId: string, input: CompanyFileInput): Promise<unknown>;
  startCompanyFile(companyId: string, input: CompanyFileStart): Promise<unknown>;
  checkCompanyFile(companyId: string, input: { ok: boolean; ssmRef: string; mismatches?: string[]; note?: string }): Promise<unknown>;
  renewalBoard(): Promise<RenewalBoard>;
  renewalStep(id: string, action: RenewalAction, body?: RenewalBody): Promise<unknown>;
  creditBoard(): Promise<CreditBoard>;
  runCreditCheck(): Promise<{ opened: number; checkedOn: string }>;
  creditDecide(id: string, action: 'reconciled' | 'confirm' | 'clear' | 'suspend' | 'resume', note: string): Promise<unknown>;
  creditEnforcementStep(id: string, no: number, note: string): Promise<unknown>;
  creditRepayment(loanId: string, no: number, amount: number, bankRef: string, paidOn: string): Promise<unknown>;
  creditChargeLodged(loanId: string, ssmRef: string, lodgedOn: string): Promise<unknown>;
  creditStamped(loanId: string, ref: string, on: string): Promise<unknown>;
  creditCorrectCollateral(loanId: string, kind: CreditLoanInput['collateral'], agreementRef: string | null, reason: string): Promise<unknown>;
  creditCorrectRecord(loanId: string, input: CreditCorrectionInput): Promise<unknown>;
  creditDispute(loanId: string, action: 'raise' | 'close', note: string): Promise<unknown>;
  addCreditLoan(companyId: string, input: CreditLoanInput): Promise<unknown>;
  purBoard(): Promise<PurBoard>;
  govBoard(): Promise<GovBoard>;
  grcBoard(): Promise<GrcBoard>;
  pdpaRights(): Promise<PdpaRights>;
  bcmBoard(): Promise<BcmBoard>;
  corpAuditLegal(): Promise<CorpAuditLegal>;
  salesLeads(companyId: string): Promise<SalesLeads>;
  fixedAssets(): Promise<FixedAssets>;
  actBoard(): Promise<ActBoard>;
  raiseActFinding(input: ActFindingInput): Promise<unknown>;
  actFindingStep(id: string, action: 'plan' | 'fixed' | 'check' | 'follow_up' | 'assign', body: ActFindingBody): Promise<unknown>;
  recordActAudit(input: ActAuditInput): Promise<unknown>;
  assignActWork(input: Parameters<PrimaService['assignActWork']>[1]): Promise<unknown>;
  setActReportForm(input: Parameters<PrimaService['setActReportForm']>[1]): Promise<unknown>;
  setActTiming(input: Parameters<PrimaService['setActTiming']>[1]): Promise<unknown>;
  recordActFieldCheck(input: Parameters<PrimaService['recordActFieldCheck']>[1]): Promise<unknown>;
  openActInvestigation(input: Parameters<PrimaService['openActInvestigation']>[1]): Promise<unknown>;
  addActEvidence(id: string, input: Parameters<PrimaService['addActEvidence']>[2]): Promise<unknown>;
  actEvidence(id: string, evidenceId: string): ReturnType<PrimaService['actEvidence']>;
  actInvestigationStep(id: string, input: Parameters<PrimaService['actInvestigationStep']>[2]): Promise<unknown>;
  addActImprovement(input: ActImprovementInput): Promise<unknown>;
  actImprovementStep(id: string, action: 'approve' | 'step' | 'result', body: { index?: number; note?: string }): Promise<unknown>;
  postDepreciation(ownerEntity: string, period: string, sqlRef: string): Promise<unknown>;
  amDisposalStep(id: string, action: DisposalAction, body: DisposalBody): Promise<unknown>;
  amLifeReview(id: string, decision: 'keep' | 'rehab', body: { note?: string; cost?: number }): Promise<unknown>;
  /** Arisha on the Prima server (Azure OpenAI): on only when the CEO has approved it. The test link uses Claude instead. */
  arishaSummary(input: { context: string; companyId?: string | null }): ReturnType<PrimaService['arishaContext']['summary']>;
  arishaFinanceOptions(companyId: string | null): ReturnType<PrimaService['arishaDrafts']['financeModelOptions']>;
  arishaPrepareFinance(input: Record<string, unknown>): Promise<ArishaFinanceDraft>;
  arishaDraftForm(kind: RecordKind, companyId: string | null): ReturnType<PrimaService['arishaDrafts']['form']>;
  arishaPrepare(input: Record<string, unknown>): Promise<ArishaDraft>;
  arishaDrafts(): ReturnType<PrimaService['arishaDrafts']['list']>;
  arishaFinancePapers(companyId: string): ReturnType<PrimaService['arishaDrafts']['financePapers']>;
  arishaSubmit(payload: ArishaReviewDraft['payload'], companyId: string | null): ReturnType<PrimaService['arishaDrafts']['submit']>;
  arishaCommit(id: string, version: number): ReturnType<PrimaService['arishaDrafts']['commit']>;
  arishaResubmit(id: string, version: number): ReturnType<PrimaService['arishaDrafts']['resubmit']>;
  arishaReturn(id: string, version: number): ReturnType<PrimaService['arishaDrafts']['returnDraft']>;
  arishaStatus(): Promise<{ enabled: boolean }>;
  arisha(input: { brief: string; history: ArishaTurn[] }): Promise<ArishaAnswer>;
  recordKinds(): Promise<RecordKind[]>;
  payChanges(): Promise<PayChangesData>;
  decidePayChange(id: string, verify: boolean, note: string): Promise<unknown>;
  recordForm(kind: RecordKind, id: string | null, companyId: string | null): Promise<RecordFormData>;
  saveRecord(kind: RecordKind, id: string | null, companyId: string | null, values: RecordValues): Promise<unknown>;
  amRecordPayment(unitId: string, input: Parameters<PrimaService['amRecordPayment']>[2]): Promise<unknown>;
  amReversePayment(unitId: string, paymentId: string, reason: string): Promise<unknown>;
  amBankCash(unitId: string, paymentId: string, input: { on: string; slipRef: string }): Promise<unknown>;
  amFollowUp(unitId: string, input: Parameters<PrimaService['amFollowUp']>[2]): Promise<unknown>;
  amDecideLetter(unitId: string, followUpId: string, approve: boolean, note: string): Promise<unknown>;
  addSalesLead(companyId: string, input: SalesLeadInput): Promise<unknown>;
  salesLeadStep(id: string, action: SalesLeadAction, body: SalesLeadBody): Promise<unknown>;
  corpAuditStep(id: string, action: 'planning' | 'pbc_received' | 'add_adjustment' | 'agree_adjustment' | 'signed', body: AuditStepBody): Promise<unknown>;
  addLegalMatter(companyId: string, input: LegalMatterInput): Promise<unknown>;
  addCorpAudit(companyId: string, input: Parameters<PrimaService['addCorpAudit']>[2]): Promise<unknown>;
  addBcmSystem(input: Parameters<PrimaService['addBcmSystem']>[1]): Promise<unknown>;
  addGrcObligation(companyId: string, input: Parameters<PrimaService['addGrcObligation']>[2]): Promise<unknown>;
  legalMatterStep(id: string, action: 'update' | 'fee' | 'close', body: LegalStepBody): Promise<unknown>;
  bcmRecord(
    systemId: string,
    copy: number,
    kind: 'backup' | 'restore',
    input: { on?: string; ok?: boolean; hours?: number; dataLossMinutes?: number; note?: string },
  ): Promise<unknown>;
  bcmDrill(playbookId: string, input: { on: string; findings: string; actionsOpen: number }): Promise<unknown>;
  recordPdpaDpo(companyId: string, input: PdpaDpoInput): Promise<unknown>;
  addPdpaRequest(input: PdpaRequestInput): Promise<unknown>;
  pdpaRequestStep(id: string, action: 'verify' | 'done' | 'refuse', note: string): Promise<unknown>;
  grcEvidence(id: string, on: string, ref: string): Promise<unknown>;
  grcCheck(id: string, ok: boolean, note: string): Promise<unknown>;
  recordOshAssessment(siteId: string, input: { assessedOn: string; hazards: number; highRisks: number; controlsRef: string }): Promise<unknown>;
  submitWhistle(input: WhistleInput): Promise<{ code: string; handledBy: string }>;
  whistleStatus(code: string): Promise<{ code: string; at: string; status: string; outcome: string | null }>;
  whistleStep(id: string, action: 'acknowledge' | 'investigate' | 'note' | 'close', text: string): Promise<unknown>;
  declareGift(input: GiftInput): Promise<unknown>;
  decideGift(id: string, outcome: 'approved' | 'return' | 'donate' | 'refused', note: string): Promise<unknown>;
  addGovMandate(companyId: string, input: GovMandateInput): Promise<unknown>;
  govMandateStep(id: string, action: 'confirm' | 'verify' | 'terminate', body: { resolutionRef?: string; note?: string }): Promise<unknown>;
  raisePurRequest(companyId: string, input: PurRequestInput): Promise<unknown>;
  purStep(
    id: string,
    action: 'quote' | 'online' | 'submit' | 'approve' | 'reject' | 'reopen' | 'order' | 'receive' | 'invoice' | 'post',
    body: PurStepBody,
  ): Promise<unknown>;
  myItems(): Promise<MyItems>;
  deliveryProof(issueId: string): Promise<DeliveryProof>;
  confirmMyItem(id: string, received: boolean, note: string): Promise<unknown>;
  addPurSupplier(companyId: string, input: PurSupplierInput): Promise<unknown>;
  purSupplierStep(id: string, action: 'verify_bank' | 'review' | 'coi' | 'abc' | 'block' | 'unblock', note: string): Promise<unknown>;
  stockIssue(
    companyId: string,
    input: { itemId: string; personId: string; qty: number; serial?: string; slip?: ProofInput[]; omUserId?: string; patrolPersonId?: string },
  ): Promise<unknown>;
  handoverStep(
    id: string,
    step: 'om' | 'patrol' | 'guard',
    input: {
      received: boolean;
      note?: string;
      slip?: ProofInput[];
      photo?: ProofInput[];
      signature?: string;
      place?: { lat: number; lng: number; accuracyM?: number | null } | null;
    },
  ): Promise<unknown>;
  stockReturn(id: string, condition: 'good' | 'worn' | 'damaged' | 'lost', note: string): Promise<unknown>;
  corpFilingStep(id: string, action: 'prepare' | 'lodge' | 'receipt', body: { ref?: string; on?: string }): Promise<unknown>;
  raiseCorpChange(companyId: string, input: CorpChangeInput): Promise<unknown>;
  addCorpFiling(companyId: string, input: CorpFilingInput): Promise<unknown>;
  decideCorpChange(id: string, decision: 'approve' | 'reject', note: string, clauseRef: string): Promise<unknown>;
  recordCorpBoard(id: string, resolutionRef: string, effectiveOn: string): Promise<unknown>;
  raiseItTicket(input: ItTicketInput): Promise<unknown>;
  itTicketStep(id: string, action: 'take' | 'resolve', note: string): Promise<unknown>;
  itAct(action: string, input: Record<string, unknown>): Promise<unknown>;
  hrItAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>;
  itCleanupAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>;
  itMetricsAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>;
  itProcurementAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>;
  itFinanceAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>;
  itGuidanceBoard(expectedUserId: string): Promise<{userId:string;observedAt:string;board:ItBoard}>;
  itManualAct(expectedUserId: string, action: string, input: Record<string, unknown>): Promise<unknown>;
  setItOnboardingStep(id: string, key: string, done: boolean, evidenceRef: string, expectedVersion: number): Promise<unknown>;
  setItTenderItem(id: string, index: number, done: boolean): Promise<unknown>;
  setItAsset(id: string, status: 'in_use' | 'spare' | 'repair' | 'disposal_pending' | 'disposed', assignedTo: string | null, note: string): Promise<unknown>;
  itMaintenance(id: string, kind: 'service' | 'repair', note: string, cost: number): Promise<unknown>;
  raiseItPurchase(input: ItPurchaseInput): Promise<unknown>;
  itPurchaseStep(id: string, action: 'approve' | 'reject' | 'receive', body: { note?: string }): Promise<unknown>;
  approveBranchSettlement(id: string, note: string): Promise<unknown>;
  addBranch(companyId: string, input: { name: string; state: string; model: 'A' | 'B' | 'C' }): Promise<unknown>;
  branchLeadClaims(companyId: string): Promise<R<'branchLeadClaims'>>;
  branchAct(branchId: string, action: string, body: Record<string, unknown>): Promise<unknown>;
  insuranceClaimAct(claimId: string, action: string, body: Record<string, unknown>): Promise<unknown>;
  branchSettlementAct(id: string, action: 'approve' | 'return' | 'validate' | 'paid', body: Record<string, unknown>): Promise<unknown>;
  reviewBranchAction(id: string, decision: 'accepted' | 'reversed', note: string): Promise<unknown>;
  addBranchAgreement(branchId: string, input: BranchAgreementInput): Promise<unknown>;
  setMobItem(id: string, itemId: string, status: 'open' | 'done' | 'risk_accepted', note: string, acceptedUntil: string | null): Promise<unknown>;
  setCmsService(contractId: string, input: CmsServiceInput): Promise<unknown>;
  verifyCmsContact(contractId: string, index: number, version: number, note: string): Promise<unknown>;
  recordCmsTest(contractId: string, version: number, service: CmsServiceKind, siteId: string, note: string): Promise<unknown>;
  acceptCmsService(contractId: string, who: 'operator' | 'client', version: number, input: { note?: string; clientName?: string; ref?: string }): Promise<unknown>;
  cmsCommissioning(): Promise<CmsCommissioning>;
  contractStep(id: string, action: 'mobilise' | 'certify' | 'activate' | 'suspend' | 'resume' | 'terminate', note: string): Promise<unknown>;
  contractReview(id: string, day: 1 | 7 | 14 | 30, note: string, invoiceChecked: boolean): Promise<unknown>;
  addContract(input: ContractInput): Promise<unknown>;
  addContractVariation(id: string, input: VariationInput): Promise<unknown>;
  setFinPack(companyId: string, pack: FinPackKind, itemId: string, status: 'todo' | 'prepared' | 'reviewed' | 'sent', comment?: string): Promise<unknown>;
  finDesk(): Promise<FinDesk>;
  financeToday(): Promise<Awaited<ReturnType<PrimaService['financeToday']>>>;
  /** My advances, cards and petty cash (anyone), and overdue staff advances (HR and Finance), 2 Nov 2026. */
  finCashMine(): Promise<Awaited<ReturnType<PrimaService['financeControls']['cashMine']>>>;
  finDailyCashMine(): Promise<Awaited<ReturnType<PrimaService['financeControls']['dailyCashMine']>>>;
  finAdvancesOverdue(): Promise<Awaited<ReturnType<PrimaService['financeControls']['advancesForHr']>>>;
  finCooDesk(): Promise<FinCooDesk>;
  finSettings(): Promise<FinSettingsView>;
  finKpi(period?: string): Promise<FinKpiView>;
  finRequests(): Promise<FinRequestList>;
  finCreateRequest(companyId: string, input: Record<string, unknown>): Promise<unknown>;
  finRequestStep(companyId: string, requestId: string, action: FinRequestAction, input: Record<string, unknown>): Promise<unknown>;
  finSetSettings(values: Record<string, unknown>, comment: string): Promise<unknown>;
  finCooStep(companyId: string, paymentId: string, action: 'approve' | 'return', input: Record<string, unknown>): Promise<unknown>;
  finControls(companyId: string, billPeriod?: string): Promise<FinControls>;
  finDashboard(): Promise<FinDashboard>;
  finChecksTodo(): Promise<Record<string, Partial<Record<FinCheckSection, number>>>>;
  finPack(companyId: string, period?: string): Promise<FinPack>;
  finControlAction(companyId: string, area: FinControlArea, action: string, input: Record<string, unknown>): Promise<unknown>;
  finCreatePayment(companyId: string, input: Record<string, unknown>): Promise<unknown>;
  finPaymentStep(companyId: string, paymentId: string, action: FinPaymentAction, input: Record<string, unknown>): Promise<unknown>;
  finCloseStep(companyId: string, action: FinCloseAction, input: Record<string, unknown>): Promise<unknown>;
  /** P78: add a company bank account to its books; start books for a company with none. */
  finAddBankAccount(companyId: string, input: { bank: string; last4: string; purpose: string }): Promise<unknown>;
  finStartBooks(companyId: string, input: { team: number; fyEnd: string }): Promise<unknown>;
  finAddPaper(companyId: string, pack: 'audit' | 'tax', input: { label: string; dueOn: string }): Promise<unknown>;
  staffPayRun(runId: string): Promise<StaffPayRunView>;
  prepareStaffPay(companyId: string, period: string): Promise<unknown>;
  setStaffPayLine(runId: string, personId: string, patch: StaffPayLinePatch): Promise<unknown>;
  staffPayStep(runId: string, action: StaffPayAction, body: StaffPayStepBody): Promise<unknown>;
  staffPayExport(runId: string, kind: StaffPayFile): Promise<{ filename: string; body: string; note: string }>;
  clientInvoice(accountId: string, period: string, channel: 'hand' | 'email' | 'portal', amount: number | null, proof: ProofInput[]): Promise<unknown>;
  setInvoicePortal(accountId: string, portal: string | null): Promise<unknown>;
  /** Client report links (Fauzan, 3 Nov 2026): read-only, expiring, one client's own sites. */
  clientShareLinks(accountId: string): Promise<ClientShareLinksView>;
  createClientShareLink(accountId: string, input: { recipient: string; from: string; to: string; days: number }): Promise<{ link: ClientShareLink; url: string | null }>;
  revokeClientShareLink(accountId: string, linkId: string, reason: string): Promise<unknown>;
  previewClientShareLink(accountId: string, linkId: string): Promise<ClientShareReport>;
  expenseBoard(): Promise<ExpenseBoard>;
  saveExpense(input: ExpenseInput, proof: ProofInput[]): Promise<unknown>;
  prefillOfficeRequest(input: { companyId: string; category: 'RENT' | 'UTILITIES'; period?: string }): Promise<unknown>;
  submitExpense(id: string): Promise<unknown>;
  decideExpense(id: string, decision: 'approve' | 'return' | 'reject', note: string): Promise<unknown>;
  expenseDocs(id: string): Promise<EvidenceDoc[]>;
  clientStep(accountId: string, phase: 'onboarding' | 'offboarding', key: string, note: string, proof: ProofInput[]): Promise<unknown>;
  addClientAccount(input: ClientAccountInput): Promise<unknown>;
  startOffboarding(accountId: string, reason: string): Promise<unknown>;
  clientContact(accountId: string, kind: 'visit' | 'meeting' | 'call', note: string): Promise<unknown>;
  clientReport(accountId: string, period: string, proof: ProofInput[]): Promise<unknown>;
  clientRating(accountId: string, score: number, comment: string, input: { from: string; via: 'meeting' | 'visit' | 'call' | 'email' | 'form'; proof?: ProofInput[] }): Promise<unknown>;
  clientComplaint(accountId: string, input: { from: string; via: 'meeting' | 'visit' | 'call' | 'email' | 'form'; what: string; siteId?: string | null; proof?: ProofInput[] }): Promise<unknown>;
  resolveClientComplaint(accountId: string, complaintId: string, resolution: string, proof?: ProofInput[]): Promise<unknown>;
  clientBilling(accountId: string, input: { invoicedTo: string | null; overdueAmount: number; overdueDays: number }): Promise<unknown>;
  fleetBoard(): Promise<FleetBoard>;
  requestVehicle(input: VehicleRequestInput): Promise<unknown>;
  decideVehicleRequest(requestId: string, ok: boolean, vehicleId: string | null, note: string): Promise<unknown>;
  vehicleOut(vehicleId: string, requestId: string | null, km: number, driver?: string): Promise<unknown>;
  vehicleIn(vehicleId: string, km: number, note: string): Promise<unknown>;
  recordVehicleWork(vehicleId: string, input: VehicleWorkInput, proof: ProofInput[]): Promise<unknown>;
  fileMonitoringConsent(personId: string, proof: ProofInput[]): Promise<unknown>;
  /** HR or the company office sets a staff PIN; only its hash is kept (pre-publication review R1). */
  setStaffPin(personId: string, pin: string): Promise<unknown>;
  /** Offboarding: HR, the HR Director or the CEO closes a Prima account from today or a later day. */
  closeAccess(userId: string, input: { from: string | null; reason: string }): Promise<{ userId: string; from: string; grantsEnded: number }>;
  pdpaBoard(): Promise<PdpaBoard>;
  openPdpaCase(input: PdpaCaseInput): Promise<unknown>;
  pdpaStep(caseId: string, step: PdpaStepName, note: string, proof: ProofInput[]): Promise<unknown>;
  pdpaDocs(caseId: string): Promise<EvidenceDoc[]>;
  memos(): Promise<Memos>;
  publishMemo(audience: 'STAFF' | 'FIELD', title: string, body: string, states: string[]): Promise<unknown>;
  readMemo(memoId: string): Promise<unknown>;
  fwmDocs(ref: string): Promise<EvidenceDoc[]>;
  personDocs(personId: string): Promise<EvidenceDoc[]>;
  uploadHiringDoc(personId: string, kind: HiringDocKind, proof: ProofInput[]): Promise<unknown>;
  updateHospitalClaim(leaveId: string, input: HospitalClaimInput, proof: ProofInput[]): Promise<unknown>;
  submitFwRenewal(personId: string, paper: FwPaper, input: FwRenewalInput, proof: ProofInput[]): Promise<unknown>;
  createFwmTask(personId: string, input: FwmTaskInput): Promise<unknown>;
  doneFwmTask(id: string, note: string, proof: ProofInput[]): Promise<unknown>;
  reviewFwmTask(id: string, accept: boolean, note: string): Promise<unknown>;
  fwmWelfare(): Promise<FwmWelfare>;
  recordFwCheck(personId: string, input: FwCheckInput, proof: ProofInput[]): Promise<unknown>;
  closeFwCheck(id: string, input: FwCheckCloseInput, proof: ProofInput[]): Promise<unknown>;
  decideLeave(id: string, approve: boolean, note: string): Promise<unknown>;
  setPatrolInterval(siteId: string, input: { minutes: number | null; note: string }): Promise<{ siteId: string; intervalMin: number; clientSet: boolean }>;
  roster(siteId: string, from: IsoDate, days: number): Promise<Roster>;
  candidates(shiftId: string, q?: string): Promise<Candidates>;
  assign(shiftId: string, personId: string | null): Promise<{ warnings: { message: string }[] }>;
  publish(siteId: string, from: IsoDate, to: IsoDate): Promise<{ published: number; unfilled: number }>;
  /** P78: add unfilled draft shifts for a post (a new site or post, or extra guards). */
  addShifts(siteId: string, input: Parameters<PrimaService['addShifts']>[2]): Promise<{ added: number; from: IsoDate; to: IsoDate }>;
  attendance(companyId: string, date: IsoDate): Promise<AttendanceDay>;
  lockAttendance(companyId: string, date: IsoDate): Promise<{ locked: number }>;
  attendanceAlerts(companyId: string): Promise<AttendanceAlerts>;
  disciplineHistory(companyId: string, personId: string): Promise<DisciplineHistory>;
  followUpAttendance(input: FollowUpInput): Promise<{ replacement: { id: string } | null; warnings: { message: string }[] }>;
  clockIn(input: { staffNo: string; face: FaceCapture | null; lat: number | null; lng: number | null }): Promise<ClockInResult>;
  clockOut(input: { staffNo: string; face: FaceCapture | null }): Promise<ClockOutResult>;
  scan(input: { staffNo: string; pin: string; tagCode: string; tagSerial?: string | null }): Promise<ScanResult>;
  cases(filter?: { companyId?: string; status?: 'active' | 'all'; waiting?: 'me' }): Promise<CaseList>;
  caseDetail(caseId: string): Promise<CaseDetail>;
  raiseCase(input: RaiseCaseInput): Promise<Case>;
  addCasePhoto(caseId: string, input: PhotoInput): Promise<unknown>;
  siteVisits(siteId: string): Promise<SiteVisits>;
  startSiteVisit(siteId: string, input: { lat: number | null; lng: number | null; accuracyM: number | null; purpose: string }): Promise<unknown>;
  addVisitPhoto(visitId: string, input: PhotoInput): Promise<unknown>;
  closeSiteVisit(visitId: string, findings: string): Promise<unknown>;
  updateCase(caseId: string, action: CaseAction, note?: string, proof?: ProofInput[]): Promise<Case>;
  signOffCase(caseId: string, outcome: SignOffOutcome, note: string, proof?: ProofInput[]): Promise<Case>;
  compliance(): Promise<Compliance>;
  commercial(companyId: string): Promise<Commercial>;
  createQuotation(companyId: string, input: NewQuotation): Promise<Quotation>;
  /** P78: enter a new tender for the company. */
  addTender(companyId: string, input: NewTender): Promise<Tender>;
  quotationAction(quotationId: string, action: QuotationAction, note?: string): Promise<Quotation>;
  correctQuotation(quotationId: string, input: { guards: number; hoursPerDay: 8 | 12; ratePerGuard: number; validUntil: string; reason: string }): Promise<Quotation>;
  updateTender(tenderId: string, status: TenderStatus): Promise<Tender>;
  tenderProtocol(): Promise<TenderProtocolView>;
  setTenderProtocol(input: TenderProtocolInput): Promise<unknown>;
  doTenderStep(tenderId: string, stepId: string, note: string, proof: ProofInput[], opts?: { status?: 'done' | 'na'; ref?: string }): Promise<unknown>;
  confirmTenderNa(tenderId: string, stepId: string, accept: boolean): Promise<unknown>;
  undoTenderStep(tenderId: string, stepId: string): Promise<unknown>;
  planTenderStep(tenderId: string, stepId: string, pic: string, due: string | null): Promise<unknown>;
  decideTender(tenderId: string, choice: TenderDecisionChoice, reason: string): Promise<unknown>;
  setTenderRecord(tenderId: string, record: TenderRecord, leadOnly?: boolean): Promise<unknown>;
  addTenderQuery(tenderId: string, text: string, ref: string): Promise<unknown>;
  setTenderQuery(tenderId: string, queryId: string, status: TenderQuery['status'], answer: string): Promise<unknown>;
  addTenderPapers(tenderId: string, kind: TenderPaperKind, proof: ProofInput[]): Promise<unknown>;
  draftTenderChecklist(tenderId: string): Promise<unknown>;
  setTenderBidFiles(tenderId: string, files: { id?: string; part: TenderBidPart; required: string }[]): Promise<unknown>;
  uploadTenderBidFile(tenderId: string, fileId: string, proof: ProofInput[]): Promise<unknown>;
  confirmTenderBidFile(tenderId: string, fileId: string): Promise<unknown>;
  reviewTenderChecklist(tenderId: string, input: Parameters<PrimaService['reviewTenderChecklist']>[2]): Promise<unknown>;
  verifyTender(tenderId: string, approve: boolean, note: string): Promise<unknown>;
  submitTender(tenderId: string, note: string, proof: ProofInput[]): Promise<unknown>;
  tenderBoard(): Promise<TenderBoard>;
  tenderGroups(): Promise<TenderGroups>;
  createTenderGroup(sourceTenderId: string, companyIds: string[]): Promise<unknown>;
  reports(): Promise<Reports>;
  meetings(): Promise<Meetings>;
  scheduleMeeting(input: Parameters<PrimaService['scheduleMeeting']>[1]): Promise<unknown>;
  addMinutes(meetingId: string, text: string): Promise<unknown>;
  checkMeetingSummary(meetingId: string, input: Parameters<PrimaService['checkMeetingSummary']>[2]): Promise<unknown>;
  setMeetingAction(meetingId: string, index: number, done: boolean): Promise<unknown>;
  addMeetingAction(meetingId: string, input: MeetingActionInput): Promise<unknown>;
  setMeetingPrep(meetingId: string, input: { index?: number; done?: boolean; add?: string }): Promise<unknown>;
  submitReport(input: Parameters<PrimaService['submitReport']>[1]): Promise<unknown>;
  setReportDefs(defs: ReportDef[], note: string): Promise<unknown>;
  home(companyId?: string): Promise<Home>;
  growth(): Promise<GrowthPanel>;
  growthMargin(): Promise<GrowthMargin>;
  approvalLimits(): Promise<ApprovalLimitsView>;
  setApprovalLimits(body: { claimsMax: number | null; purchasesMax: number | null; comment: string }): Promise<unknown>;
  regionalOps(region?: string): Promise<RegionalOps>;
  govOpsMonitor(month?: string): Promise<GovOpsMonitor>;
  privateOpsMonitor(month?: string): Promise<GovOpsMonitor>;
  managementFees(): Promise<ManagementFees>;
  managementFeeBills(month?: string): Promise<ManagementFeeBills>;
  setManagementFee(
    companyId: string,
    input: { opsCompany: 'goodwill' | 'sasateam'; kind: 'percent' | 'fixed'; value: number; agreementRef: string },
  ): Promise<unknown>;
  hrMonitor(): Promise<HrMonitor>;
  insurance(): Promise<Insurance>;
  armsOverview(): Promise<ArmsOverview>;
  armsControl(): Promise<ArmsControl>;
  assignCmsShift(shiftId: string, staffName: string): Promise<unknown>;
  cms(): Promise<Cms>;
  updateCmsSettings(patch: CmsSettingsPatch): Promise<unknown>;
  planCmsRoster(days: number): Promise<unknown>;
  recordCmsHandover(shiftId: string, note: string): Promise<unknown>;
  logCallback(callId: string, note: string): Promise<unknown>;
  acknowledgeAlarm(id: string): Promise<unknown>;
  closeAlarm(id: string, verdict: 'real' | 'false', note: string): Promise<unknown>;
  requestTrip(input: { date: string; destination: string; purpose: string; forPersonId?: string }): Promise<unknown>;
  decideTrip(id: string, ok: boolean, note: string): Promise<unknown>;
  whistleReview(id: string, agree: boolean, note: string): Promise<unknown>;
  confirmStockLoss(id: string, ok: boolean, note: string): Promise<unknown>;
  stockCount(itemId: string, counted: number, witness: { staffNo: string; pin: string }): Promise<unknown>;
  amDecideReversal(unitId: string, paymentId: string, approve: boolean, note: string): Promise<unknown>;
  reviewFalseAlarm(id: string, agree: boolean, note: string): Promise<unknown>;
  reviewArmsRequest(id: string, decision: 'pass' | 'return', note: string): Promise<unknown>;
  // Special Ops 4B-4H (draft): one step on an arms request, the trading switch, Transport, Asset Management checks.
  raiseArmsRequest(input: RaiseArmsRequestInput): Promise<unknown>;
  specialOpsLegalFlags(): Promise<SpecialOpsLegalFlags>;
  armsRequestStep(id: string, action: ArmsRequestAction, reason: string, extra?: ArmsRequestStepExtra): Promise<unknown>;
  armsTrading(): Promise<ArmsTradingState>;
  setArmsTrading(on: boolean, reason: string): Promise<unknown>;
  transportBoard(): Promise<TransportBoard>;
  amRentCheck(): Promise<AmRentCheck>;
  amBuyRequest(input: AmBuyInput): Promise<unknown>;
  amBuyDecide(id: string, approve: boolean, reason: string, seenEstCost?: number): Promise<unknown>;
  amBuyReceived(id: string, input: { tag: string; cost: number; boughtOn: string }): Promise<unknown>;
  amBuyReprice(id: string, estCost: number, reason: string): Promise<unknown>;
  // WhatsApp rent reminders (off until an owner connects WhatsApp Business).
  amWhatsApp(): Promise<AmWhatsAppBoard>;
  amWhatsAppConsent(unitId: string, on: boolean, how: string): Promise<unknown>;
  amWhatsAppSettle(unitId: string, reminderId: string, outcome: 'went' | 'resend' | 'drop', reason: string): Promise<unknown>;
  amWhatsAppRun(): Promise<{ queued: number; cancelled: number; sent: number; failed: number; sending: boolean }>;
  arms(companyId: string): Promise<ArmsDetail>;
  issueFirearm(input: { shiftId: string; firearmId: string; rounds: number; witness: { staffNo: string; pin: string }; rfidScan?: string | null }): Promise<unknown>;
  returnFirearm(movementId: string, input: { roundsReturned: number; witness: { staffNo: string; pin: string }; rfidScan?: string | null }): Promise<{ caseRef: string | null }>;
  planArmedJob(input: ArmedJobInput): Promise<unknown>;
  updateArmedJob(id: string, status: ArmedJobStatus, note: string): Promise<unknown>;
  escalateFirearm(movementId: string): Promise<Case>;
  countVault(vaultId: string, input: { counted: number; witness: { staffNo: string; pin: string } }): Promise<{ expected: number; counted: number; ok: boolean; caseRef: string | null }>;
  audit(): Promise<AuditLog>;
  /** Demo only: start again from fresh mock data. */
  reset?(): Promise<void>;
}

/** An error the screen can show as-is, with rule findings when a rule blocked the action. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public findings: { level: 'block' | 'warn'; message: string }[] = [],
  ) {
    super(message);
  }
}


// ---------- Hand-overs between departments and real-data import (connect-departments, 2 Nov 2026) ----------
export type OrgInbox = Awaited<ReturnType<PrimaService['orgLinks']['inbox']>>;
export type OrgMap = Awaited<ReturnType<PrimaService['orgLinks']['map']>> & { rollouts?: { key: string; label: string }[] };
export type OrgImportTemplate = ReturnType<PrimaService['orgImport']['template']>;
export type OrgImportPreview = Awaited<ReturnType<PrimaService['orgImport']['preview']>>;
export type GuideCards = ReturnType<PrimaService['guideCards']>;
export type GuideCardItem = GuideCards['cards'][number];
export interface OrgClient {
  guide(): Promise<GuideCards>;
  inbox(offset?: number): Promise<OrgInbox>;
  close(taskId: string, outcome: 'done' | 'not_needed', note: string): Promise<unknown>;
  read(taskId: string): Promise<unknown>;
  map(): Promise<OrgMap>;
  importTemplate(kind: RecordKind): Promise<OrgImportTemplate>;
  importPreview(kind: RecordKind, companyId: string | null, csv: string): Promise<OrgImportPreview>;
  importCommit(kind: RecordKind, companyId: string | null, csv: string, fingerprint: string): Promise<unknown>;
}
