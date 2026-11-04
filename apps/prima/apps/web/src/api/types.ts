import type { ExtractionClient } from './it-extraction';
import type { ConnectionsClient } from './connections';
export type { ConnectionsClient, SharePointStatus, SharePointCheck, SharePointLibraries, SharePointItems } from './connections';
import type {
  ArishaDraft,
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
export type PersonWork = R<'personWork'>;
export type WorkSummary = R<'workSummary'>;
export type BranchWork = R<'branchWork'>;
export type WorkCheckInInput = Parameters<PrimaService['workCheckIn']>[1];
export type WorkTaskInput = Parameters<PrimaService['workTaskAdd']>[1];
export type BranchCheckInput = Parameters<PrimaService['branchCheckSubmit']>[2];
export type BranchVisitInput = Parameters<PrimaService['branchVisitRecord']>[2];
export type StaffShotInput = Parameters<PrimaService['staffClockIn']>[1];
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
export type HostelBoard = R<'hostelBoard'>;
export type StaffClaims = R<'staffClaims'>;
export type Memos = R<'memos'>;
export type PdpaBoard = R<'pdpaBoard'>;
export type FleetBoard = R<'fleetBoard'>;
export type ClientBoard = R<'clientBoard'>;
export type JaBoard = R<'jaBoard'>;
export type AmBoard = R<'amBoard'>;
export type StaffPayBoard = R<'staffPayroll'>;
export type FinBoard = R<'finBoard'>;
export type ContractBoard = R<'contracts'>;
export type BranchBoard = R<'branchBoard'>;
export type ItBoard = R<'itBoard'>;
export type ItPlan = R<'itPlan'>;
/** Group website management (Fauzan, 27 Oct 2026). */
export type WebBoard = Awaited<ReturnType<PrimaService['websites']['board']>>;
export type WebBoardOk = Extract<WebBoard, { allowed: true }>;
export type CorpBoard = R<'corpBoard'>;
export type CreditBoard = R<'creditBoard'>;
export type CreditLoanInput = Parameters<PrimaService['addCreditLoan']>[2];
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
export type RecordFormData = R<'recordForm'>;
export type PayChangesData = R<'payChanges'>;
export type CorpChangeInput = Parameters<PrimaService['raiseCorpChange']>[2];
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
export type CmsSettingsPatch = Parameters<PrimaService['updateCmsSettings']>[1];
export type RegionalOps = R<'regionalOps'>;
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
  m365Call(expectedUserId: string, method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
  readonly mode: 'demo' | 'server';
  itImportReviewAssertOwner?(): Promise<void>;
  itImportReviewRequest?(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown>;
  /** Test link only: a few active staff of a company with their test PINs, to sign as a witness. */
  demoWitnesses?(companyId: string): Promise<{ name: string; staffNo: string; pin: string }[]>;
  listUsers(): Promise<User[]>;
  signIn(userId: string): Promise<Me>;
  /** Server only: which sign-in ways this server offers (Microsoft 365 and/or the development picker). */
  signInOptions?(): Promise<{ microsoft: boolean; devLogin: boolean }>;
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
  decideStaffClaim(claimId: string, by: 'cos' | 'hr' | 'coo' | 'finance', ok: boolean, note: string): Promise<unknown>;
  setClaimRate(month: string, vehicle: 'CAR' | 'MOTORCYCLE' | 'COMPANY_CAR', perKm: number): Promise<unknown>;
  productBoard(): Promise<ProductBoard>;
  saveProduct(input: ProductInput): Promise<unknown>;
  saveProductCert(productId: string, input: ProductCertInput, proof: ProofInput[]): Promise<unknown>;
  proposalReadiness(productIds: string[]): Promise<ProposalCheck>;
  clientBoard(): Promise<ClientBoard>;
  jaBoard(): Promise<JaBoard>;
  amBoard(): Promise<AmBoard>;
  staffPayroll(): Promise<StaffPayBoard>;
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
  creditBoard(): Promise<CreditBoard>;
  runCreditCheck(): Promise<{ opened: number; checkedOn: string }>;
  creditDecide(id: string, action: 'reconciled' | 'confirm' | 'clear' | 'suspend' | 'resume', note: string): Promise<unknown>;
  creditEnforcementStep(id: string, no: number, note: string): Promise<unknown>;
  creditRepayment(loanId: string, no: number, amount: number, bankRef: string, paidOn: string): Promise<unknown>;
  creditChargeLodged(loanId: string, ssmRef: string, lodgedOn: string): Promise<unknown>;
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
  actFindingStep(id: string, action: 'plan' | 'fixed' | 'check', body: ActFindingBody): Promise<unknown>;
  recordActAudit(input: ActAuditInput): Promise<unknown>;
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
    action: 'quote' | 'online' | 'submit' | 'approve' | 'reject' | 'order' | 'receive' | 'invoice' | 'post',
    body: PurStepBody,
  ): Promise<unknown>;
  myItems(): Promise<MyItems>;
  confirmMyItem(id: string, received: boolean, note: string): Promise<unknown>;
  addPurSupplier(companyId: string, input: PurSupplierInput): Promise<unknown>;
  purSupplierStep(id: string, action: 'verify_bank' | 'review' | 'coi' | 'abc' | 'block' | 'unblock', note: string): Promise<unknown>;
  stockIssue(companyId: string, input: { itemId: string; personId: string; qty: number; serial?: string }): Promise<unknown>;
  stockReturn(id: string, condition: 'good' | 'worn' | 'damaged' | 'lost', note: string): Promise<unknown>;
  corpFilingStep(id: string, action: 'prepare' | 'lodge' | 'receipt', body: { ref?: string; on?: string }): Promise<unknown>;
  raiseCorpChange(companyId: string, input: CorpChangeInput): Promise<unknown>;
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
  approveBranchSettlement(id: string): Promise<unknown>;
  reviewBranchAction(id: string, decision: 'accepted' | 'reversed', note: string): Promise<unknown>;
  addBranchAgreement(branchId: string, input: BranchAgreementInput): Promise<unknown>;
  setMobItem(id: string, itemId: string, status: 'open' | 'done' | 'risk_accepted', note: string, acceptedUntil: string | null): Promise<unknown>;
  contractStep(id: string, action: 'mobilise' | 'certify' | 'activate' | 'suspend' | 'resume' | 'terminate', note: string): Promise<unknown>;
  contractReview(id: string, day: 1 | 7 | 14 | 30, note: string, invoiceChecked: boolean): Promise<unknown>;
  addContract(input: ContractInput): Promise<unknown>;
  addContractVariation(id: string, input: VariationInput): Promise<unknown>;
  setFinPack(companyId: string, pack: 'audit' | 'tax', itemId: string, status: 'todo' | 'prepared' | 'reviewed' | 'sent'): Promise<unknown>;
  staffPayRun(runId: string): Promise<StaffPayRunView>;
  prepareStaffPay(companyId: string, period: string): Promise<unknown>;
  setStaffPayLine(runId: string, personId: string, patch: StaffPayLinePatch): Promise<unknown>;
  staffPayStep(runId: string, action: StaffPayAction, body: StaffPayStepBody): Promise<unknown>;
  staffPayExport(runId: string, kind: StaffPayFile): Promise<{ filename: string; body: string; note: string }>;
  clientInvoice(accountId: string, period: string, channel: 'hand' | 'email' | 'portal', amount: number | null, proof: ProofInput[]): Promise<unknown>;
  setInvoicePortal(accountId: string, portal: string | null): Promise<unknown>;
  expenseBoard(): Promise<ExpenseBoard>;
  saveExpense(input: ExpenseInput, proof: ProofInput[]): Promise<unknown>;
  submitExpense(id: string): Promise<unknown>;
  decideExpense(id: string, decision: 'approve' | 'return' | 'reject', note: string): Promise<unknown>;
  expenseDocs(id: string): Promise<EvidenceDoc[]>;
  clientStep(accountId: string, phase: 'onboarding' | 'offboarding', key: string, note: string, proof: ProofInput[]): Promise<unknown>;
  addClientAccount(input: ClientAccountInput): Promise<unknown>;
  startOffboarding(accountId: string, reason: string): Promise<unknown>;
  clientContact(accountId: string, kind: 'visit' | 'meeting' | 'call', note: string): Promise<unknown>;
  clientReport(accountId: string, period: string, proof: ProofInput[]): Promise<unknown>;
  clientRating(accountId: string, score: number, comment: string): Promise<unknown>;
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
  decideLeave(id: string, approve: boolean, note: string): Promise<unknown>;
  setPatrolInterval(siteId: string, input: { minutes: number | null; note: string }): Promise<{ siteId: string; intervalMin: number; clientSet: boolean }>;
  roster(siteId: string, from: IsoDate, days: number): Promise<Roster>;
  candidates(shiftId: string, q?: string): Promise<Candidates>;
  assign(shiftId: string, personId: string | null): Promise<{ warnings: { message: string }[] }>;
  publish(siteId: string, from: IsoDate, to: IsoDate): Promise<{ published: number; unfilled: number }>;
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
  quotationAction(quotationId: string, action: QuotationAction, note?: string): Promise<Quotation>;
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
  setMeetingPrep(meetingId: string, input: { index?: number; done?: boolean; add?: string }): Promise<unknown>;
  submitReport(input: Parameters<PrimaService['submitReport']>[1]): Promise<unknown>;
  setReportDefs(defs: ReportDef[], note: string): Promise<unknown>;
  home(companyId?: string): Promise<Home>;
  regionalOps(region?: string): Promise<RegionalOps>;
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

