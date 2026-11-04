// In-browser demo: the same PrimaService and rules as the server, running on generated
// mock data. Changes are kept as a short replay log in this browser only, so a reload
// keeps what you did today; a new day starts from fresh mock data.
import { AccessDenied, BadRequest, MemoryStore, NotFound, PrimaService, RuleBlocked, dateOf, fromMs, demoPin, generateDataset, type User } from '@prima/core';
import type { ProofInput, ReportDef } from '@prima/core';
import type { ExpenseInput, PdpaCaseInput, PdpaStepName, ProductCertInput, ProductInput, VehicleRequestInput, VehicleWorkInput } from './types';
import { ApiError, type Api, type CmsSettingsPatch, type FollowUpInput, type LeaveInput, type Me, type PhotoInput, type TenderProtocolInput } from './types';

const LOG_KEY = 'prima-demo-log-v1';
const USER_KEY = 'prima-demo-user';

interface LoggedCall {
  day: string;
  at: string;
  userId: string;
  op: string;
  args: unknown[];
}

function readLog(day: string): LoggedCall[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const log = raw ? (JSON.parse(raw) as LoggedCall[]) : [];
    return log.filter((c) => c.day === day);
  } catch {
    return [];
  }
}

function writeLog(log: LoggedCall[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500)));
  } catch {
    /* storage unavailable: changes last until reload */
  }
}

function toApiError(e: unknown): never {
  if (e instanceof RuleBlocked) throw new ApiError(e.message, 422, e.findings);
  if (e instanceof AccessDenied) throw new ApiError(e.message, 403);
  if (e instanceof NotFound) throw new ApiError(e.message, 404);
  if (e instanceof BadRequest) throw new ApiError(e.message, 400);
  throw e;
}

type Mutations =
  | 'assign'
  | 'publish'
  | 'lockAttendance'
  | 'clockIn'
  | 'clockOut'
  | 'scan'
  | 'raiseCase'
  | 'addCasePhoto'
  | 'startSiteVisit'
  | 'addVisitPhoto'
  | 'closeSiteVisit'
  | 'updateCase'
  | 'signOffCase'
  | 'createQuotation'
  | 'quotationAction'
  | 'updateTender'
  | 'setTenderProtocol'
  | 'doTenderStep'
  | 'staffClockIn'
  | 'staffSessionStart'
  | 'acceptConfidentiality'
  | 'staffSessionEnd'
  | 'startSocsoClaim'
  | 'addSocsoDoc'
  | 'overrideSocsoDoc'
  | 'advanceSocsoClaim'
  | 'setSocsoRehab'
  | 'addSocsoAppointment'
  | 'addSocsoRestriction'
  | 'clearSocsoRestriction'
  | 'addSocsoCheckIn'
  | 'submitFwRenewal'
  | 'createTenderGroup'
  | 'uploadHiringDoc'
  | 'updateHospitalClaim'
  | 'createFwmTask'
  | 'doneFwmTask'
  | 'reviewFwmTask'
  | 'addHostelBill'
  | 'requestHostelPayment'
  | 'checkHostelBill'
  | 'approveHostelBill'
  | 'uploadHostelSlip'
  | 'decideUtilityCharge'
  | 'ackUtilityNotice'
  | 'fileUtilityPaper'
  | 'submitStaffClaim'
  | 'prepareStaffPay'
  | 'setFinPack'
  | 'setMobItem'
  | 'approveBranchSettlement'
  | 'raiseItTicket'
  | 'websiteAction'
  | 'websiteSyncFeed'
  | 'corpFilingStep'
  | 'runCreditCheck'
  | 'creditDecide'
  | 'creditEnforcementStep'
  | 'creditRepayment'
  | 'creditChargeLodged'
  | 'creditDispute'
  | 'addCreditLoan'
  | 'corpAuditStep'
  | 'addSalesLead'
  | 'postDepreciation'
  | 'raiseActFinding'
  | 'actFindingStep'
  | 'recordActAudit'
  | 'addActImprovement'
  | 'actImprovementStep'
  | 'amDisposalStep'
  | 'amLifeReview'
  | 'amRecordPayment'
  | 'arishaSubmit'
  | 'arishaCommit'
  | 'arishaResubmit'
  | 'arishaReturn'
  | 'saveRecord'
  | 'decidePayChange'
  | 'amReversePayment'
  | 'amBankCash'
  | 'amFollowUp'
  | 'amDecideLetter'
  | 'salesLeadStep'
  | 'addLegalMatter'
  | 'legalMatterStep'
  | 'bcmRecord'
  | 'bcmDrill'
  | 'recordPdpaDpo'
  | 'addPdpaRequest'
  | 'pdpaRequestStep'
  | 'grcEvidence'
  | 'grcCheck'
  | 'recordOshAssessment'
  | 'submitWhistle'
  | 'whistleStep'
  | 'declareGift'
  | 'decideGift'
  | 'addGovMandate'
  | 'govMandateStep'
  | 'raisePurRequest'
  | 'purStep'
  | 'addPurSupplier'
  | 'purSupplierStep'
  | 'stockIssue'
  | 'confirmMyItem'
  | 'stockReturn'
  | 'raiseCorpChange'
  | 'decideCorpChange'
  | 'recordCorpBoard'
  | 'itTicketStep'
  | 'itAct'
  | 'setItOnboardingStep'
  | 'setItTenderItem'
  | 'setItAsset'
  | 'itMaintenance'
  | 'raiseItPurchase'
  | 'itPurchaseStep'
  | 'reviewBranchAction'
  | 'addBranchAgreement'
  | 'contractStep'
  | 'contractReview'
  | 'addContractVariation'
  | 'addContract'
  | 'addClientAccount'
  | 'setStaffPayLine'
  | 'staffPayStep'
  | 'staffPayExport'
  | 'cosDecideClaim'
  | 'hrDecideClaim'
  | 'cooDecideClaim'
  | 'financePayClaim'
  | 'setClaimRate'
  | 'publishMemo'
  | 'openPdpaCase'
  | 'requestVehicle'
  | 'clientStep'
  | 'clientInvoice'
  | 'setInvoicePortal'
  | 'saveExpense'
  | 'submitExpense'
  | 'decideExpense'
  | 'startOffboarding'
  | 'clientContact'
  | 'clientReport'
  | 'clientRating'
  | 'clientBilling'
  | 'saveProduct'
  | 'saveProductCert'
  | 'decideVehicleRequest'
  | 'vehicleOut'
  | 'vehicleIn'
  | 'recordVehicleWork'
  | 'fileMonitoringConsent'
  | 'setStaffPin'
  | 'closeAccess'
  | 'pdpaStep'
  | 'readMemo'
  | 'staffClockOut'
  | 'staffPing'
  | 'remoteApply'
  | 'remotePlan'
  | 'remoteTask'
  | 'remoteCheckIn'
  | 'remoteReport'
  | 'remoteDecide'
  | 'remoteEnd'
  | 'remoteReview'
  | 'workCheckIn'
  | 'workTaskAdd'
  | 'workTaskDone'
  | 'workTaskLate'
  | 'workTaskReview'
  | 'seenCooNotice'
  | 'helpAsk'
  | 'helpAnswer'
  | 'oneOnOneRecord'
  | 'playbookSignOff'
  | 'plannerSync'
  | 'branchCheckSubmit'
  | 'branchVisitRecord'
  | 'confirmTenderNa'
  | 'undoTenderStep'
  | 'planTenderStep'
  | 'decideTender'
  | 'setTenderRecord'
  | 'addTenderQuery'
  | 'setTenderQuery'
  | 'addTenderPapers'
  | 'setTenderBidFiles'
  | 'uploadTenderBidFile'
  | 'confirmTenderBidFile'
  | 'draftTenderChecklist'
  | 'reviewTenderChecklist'
  | 'verifyTender'
  | 'submitTender'
  | 'submitReport'
  | 'setReportDefs'
  | 'scheduleMeeting'
  | 'addMinutes'
  | 'checkMeetingSummary'
  | 'setMeetingAction'
  | 'setMeetingPrep'
  | 'issueFirearm'
  | 'returnFirearm'
  | 'planArmedJob'
  | 'updateArmedJob'
  | 'escalateFirearm'
  | 'countVault'
  | 'setPatrolInterval'
  | 'assignCmsShift'
  | 'updateCmsSettings'
  | 'planCmsRoster'
  | 'recordCmsHandover'
  | 'logCallback'
  | 'acknowledgeAlarm'
  | 'followUpAttendance'
  | 'requestLeave'
  | 'decideLeave'
  | 'closeAlarm'
  | 'requestTrip'
  | 'decideTrip'
  | 'whistleReview'
  | 'confirmStockLoss'
  | 'stockCount'
  | 'amDecideReversal'
  | 'reviewFalseAlarm'
  | 'reviewArmsRequest';

export class DemoApi implements Api {
  async m365Call(): Promise<unknown> { throw new Error('Microsoft integration requires the signed-in server app.'); }
  readonly mode = 'demo' as const;
  // Demo never fabricates access checks or reads a live provider.
  itExtractionStatus(): ReturnType<Api['itExtractionStatus']> { return Promise.resolve({enabled:false,configured:false,permitted:false,sourceTypes:[],dataClasses:[],previewOnly:true}); }
  itExtractionPreview(): ReturnType<Api['itExtractionPreview']> { return Promise.reject(new Error('AI extraction is disabled in demo mode.')); }

  async sharePointRequestPreview(_url: string): Promise<import('./connections').ConnectionRequestPreview> { throw new Error('Connection requests require the signed-in server app.'); }
  async sharePointRequest(_url: string, _requestId: string): Promise<import('./connections').ConnectionRequestReceipt> { throw new Error('Connection requests require the signed-in server app.'); }
  async sharePointRequests(): Promise<Awaited<ReturnType<Api['sharePointRequests']>>> { return {serviceId:'sharepoint',userId:(await this.user()).id,requests:[]}; }

  async sharePointStatus(): ReturnType<Api['sharePointStatus']> { return { serviceId: 'sharepoint', userId: (await this.user()).id, status: 'NotConfigured', sites: [] }; }
  sharePointCheck(): ReturnType<Api['sharePointCheck']> { return Promise.reject(new ApiError('SharePoint is not configured in the demo.', 503, [])); }
  sharePointLibraries(): ReturnType<Api['sharePointLibraries']> { return Promise.reject(new ApiError('SharePoint is not configured in the demo.', 503, [])); }
  sharePointItems(): ReturnType<Api['sharePointItems']> { return Promise.reject(new ApiError('SharePoint is not configured in the demo.', 503, [])); }

  private booted: PrimaService | null = null;
  private store: MemoryStore | null = null;
  /** The mock data is made on first use, not while the page opens, so the screen shows at once (Fauzan, 27 Oct 2026). */
  private get svc(): PrimaService {
    if (!this.booted) this.boot();
    return this.booted!;
  }
  private userId: string | null;
  private clockOverride: string | null = null;
  private log: LoggedCall[] = [];

  constructor() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(USER_KEY);
    } catch {
      /* ignore */
    }
    this.userId = saved;
  }

  private realNow(): string {
    return fromMs(Date.now());
  }

  private boot(): void {
    const now = this.realNow();
    const store = new MemoryStore(generateDataset({ today: dateOf(now), now }));
    this.store = store;
    this.booted = new PrimaService(store, () => this.clockOverride ?? this.realNow());
    this.log = readLog(dateOf(now));
  }

  /** Replay today's saved actions once the first screen asks for data. */
  private replayed = false;
  private async ready(): Promise<void> {
    if (this.replayed) return;
    this.replayed = true;
    // Let the opening screen paint before the mock data is made.
    if (!this.booted) await new Promise((r) => setTimeout(r, 0));
    if (!this.booted) this.boot();
    for (const call of this.log) {
      this.clockOverride = call.at;
      try {
        const user = await this.svc.user(call.userId);
        await this.apply(user, call.op as Mutations, call.args);
      } catch {
        /* an action that no longer applies is skipped */
      }
    }
    this.clockOverride = null;
  }

  async demoWitnesses(companyId: string) {
    const me = await this.user().catch(() => null);
    const people = await this.store!.list('people', { companyId });
    return people
      .filter((p) => p.status === 'active' && p.staffNo && p.pinHash && p.id !== me?.personId)
      .sort((a, b) => (a.role === 'office' ? 0 : 1) - (b.role === 'office' ? 0 : 1))
      .slice(0, 3)
      .map((p) => ({ name: p.name, staffNo: p.staffNo!, pin: demoPin(p.staffNo!) }));
  }

  private async user(): Promise<User> {
    await this.ready();
    if (!this.userId) throw new ApiError('Choose who to sign in as.', 401);
    return this.svc.user(this.userId);
  }

  private async read<T>(fn: (svc: PrimaService, u: User) => Promise<T>): Promise<T> {
    try {
      return await fn(this.svc, await this.user());
    } catch (e) {
      return toApiError(e);
    }
  }

  private apply(u: User, op: Mutations, args: unknown[]): Promise<unknown> {
    const a = args as never[];
    switch (op) {
      case 'assign':
        return this.svc.assignShift(u, a[0], a[1]);
      case 'publish':
        return this.svc.publishRoster(u, a[0], a[1], a[2]);
      case 'lockAttendance':
        return this.svc.lockAttendance(u, a[0], a[1]);
      case 'clockIn':
        return this.svc.clockIn(u, a[0]);
      case 'clockOut':
        return this.svc.clockOut(u, a[0]);
      case 'scan':
        return this.svc.scanCheckpoint(u, a[0]);
      case 'addCasePhoto':
        return this.svc.addCasePhoto(u, a[0], a[1]);
      case 'startSiteVisit':
        return this.svc.startSiteVisit(u, a[0], a[1]);
      case 'addVisitPhoto':
        return this.svc.addVisitPhoto(u, a[0], a[1]);
      case 'closeSiteVisit':
        return this.svc.closeSiteVisit(u, a[0], a[1]);
      case 'raiseCase':
        return this.svc.raiseCase(u, a[0]);
      case 'signOffCase':
        return this.svc.signOffCase(u, a[0], a[1], a[2], a[3]);
      case 'updateCase':
        return this.svc.updateCase(u, a[0], a[1], a[2], a[3]);
      case 'createQuotation':
        return this.svc.createQuotation(u, a[0], a[1]);
      case 'quotationAction':
        return this.svc.quotationAction(u, a[0], a[1], a[2]);
      case 'updateTender':
        return this.svc.updateTender(u, a[0], a[1]);
      case 'setTenderProtocol':
        return this.svc.setTenderProtocol(u, a[0]);
      case 'doTenderStep':
        return this.svc.doTenderStep(u, a[0], a[1], a[2], a[3], a[4]);
      case 'acceptConfidentiality':
        return this.svc.acceptConfidentiality(u);
      case 'staffSessionStart':
        return this.svc.staffSessionStart(u);
      case 'staffSessionEnd':
        return this.svc.staffSessionEnd(u);
      case 'staffClockIn':
        return this.svc.staffClockIn(u, a[0]);
      case 'startSocsoClaim':
        return this.svc.startSocsoClaim(u, a[0], a[1]);
      case 'addSocsoDoc':
        return this.svc.addSocsoDoc(u, a[0], a[1], a[2], a[3]);
      case 'overrideSocsoDoc':
        return this.svc.overrideSocsoDoc(u, a[0], a[1], a[2]);
      case 'advanceSocsoClaim':
        return this.svc.advanceSocsoClaim(u, a[0], a[1], a[2]);
      case 'setSocsoRehab':
        return this.svc.setSocsoRehab(u, a[0], a[1]);
      case 'addSocsoAppointment':
        return this.svc.addSocsoAppointment(u, a[0], a[1]);
      case 'addSocsoRestriction':
        return this.svc.addSocsoRestriction(u, a[0], a[1]);
      case 'clearSocsoRestriction':
        return this.svc.clearSocsoRestriction(u, a[0], a[1], a[2]);
      case 'addSocsoCheckIn':
        return this.svc.addSocsoCheckIn(u, a[0], a[1]);
      case 'uploadHiringDoc':
        return this.svc.uploadHiringDoc(u, a[0], a[1], a[2]);
      case 'updateHospitalClaim':
        return this.svc.updateHospitalClaim(u, a[0], a[1], a[2]);
      case 'createTenderGroup':
        return this.svc.createTenderGroup(u, a[0], a[1]);
      case 'submitFwRenewal':
        return this.svc.submitFwRenewal(u, a[0], a[1], a[2], a[3]);
      case 'createFwmTask':
        return this.svc.createFwmTask(u, a[0], a[1]);
      case 'doneFwmTask':
        return this.svc.doneFwmTask(u, a[0], a[1], a[2]);
      case 'reviewFwmTask':
        return this.svc.reviewFwmTask(u, a[0], a[1], a[2]);
      case 'addHostelBill':
        return this.svc.addHostelBill(u, a[0], a[1]);
      case 'requestHostelPayment':
        return this.svc.requestHostelPayment(u, a[0], a[1]);
      case 'checkHostelBill':
        return this.svc.checkHostelBill(u, a[0], a[1], a[2]);
      case 'approveHostelBill':
        return this.svc.approveHostelBill(u, a[0], a[1], a[2]);
      case 'uploadHostelSlip':
        return this.svc.uploadHostelSlip(u, a[0], a[1], a[2]);
      case 'decideUtilityCharge':
        return this.svc.decideUtilityCharge(u, a[0], a[1], a[2]);
      case 'ackUtilityNotice':
        return this.svc.ackUtilityNotice(u, a[0]);
      case 'fileUtilityPaper':
        return this.svc.fileUtilityPaper(u, a[0], a[1], a[2]);
      case 'approveBranchSettlement':
        return this.svc.approveBranchSettlement(u, a[0]);
      case 'runCreditCheck':
        return this.svc.runCreditCheck(u);
      case 'creditDecide':
        return this.svc.creditDecide(u, a[0], a[1], a[2]);
      case 'creditEnforcementStep':
        return this.svc.creditEnforcementStep(u, a[0], a[1], a[2]);
      case 'creditRepayment':
        return this.svc.creditRepayment(u, a[0], a[1], a[2], a[3], a[4]);
      case 'creditChargeLodged':
        return this.svc.creditChargeLodged(u, a[0], a[1], a[2]);
      case 'creditDispute':
        return this.svc.creditDispute(u, a[0], a[1], a[2]);
      case 'addCreditLoan':
        return this.svc.addCreditLoan(u, a[0], a[1]);
      case 'raiseActFinding':
        return this.svc.raiseActFinding(u, a[0]);
      case 'actFindingStep':
        return this.svc.actFindingStep(u, a[0], a[1], a[2]);
      case 'recordActAudit':
        return this.svc.recordActAudit(u, a[0]);
      case 'addActImprovement':
        return this.svc.addActImprovement(u, a[0]);
      case 'actImprovementStep':
        return this.svc.actImprovementStep(u, a[0], a[1], a[2]);
      case 'postDepreciation':
        return this.svc.postDepreciation(u, a[0], a[1], a[2]);
      case 'amDisposalStep':
        return this.svc.amDisposalStep(u, a[0], a[1], a[2]);
      case 'amLifeReview':
        return this.svc.amLifeReview(u, a[0], a[1], a[2]);
      case 'arishaSubmit':
        return this.svc.arishaDrafts.submit(u, a[0], a[1], (a[0] as Parameters<Api['arishaSubmit']>[0])?.type === 'record' ? 'arisha' : 'human');
      case 'arishaCommit':
        return this.svc.arishaDrafts.commit(u, a[0], a[1]);
      case 'arishaResubmit':
        return this.svc.arishaDrafts.resubmit(u, a[0], a[1]);
      case 'arishaReturn':
        return this.svc.arishaDrafts.returnDraft(u, a[0], a[1]);
      case 'saveRecord':
        return this.svc.saveRecord(u, a[0], a[1], a[2], a[3]);
      case 'decidePayChange':
        return this.svc.decidePayChange(u, a[0], a[1], a[2]);
      case 'amRecordPayment':
        return this.svc.amRecordPayment(u, a[0], a[1]);
      case 'amReversePayment':
        return this.svc.amReversePayment(u, a[0], a[1], a[2]);
      case 'amBankCash':
        return this.svc.amBankCash(u, a[0], a[1], a[2]);
      case 'amFollowUp':
        return this.svc.amFollowUp(u, a[0], a[1]);
      case 'amDecideLetter':
        return this.svc.amDecideLetter(u, a[0], a[1], a[2], a[3]);
      case 'addSalesLead':
        return this.svc.addSalesLead(u, a[0], a[1]);
      case 'salesLeadStep':
        return this.svc.salesLeadStep(u, a[0], a[1], a[2]);
      case 'corpAuditStep':
        return this.svc.corpAuditStep(u, a[0], a[1], a[2]);
      case 'addLegalMatter':
        return this.svc.addLegalMatter(u, a[0], a[1]);
      case 'legalMatterStep':
        return this.svc.legalMatterStep(u, a[0], a[1], a[2]);
      case 'bcmRecord':
        return this.svc.bcmRecord(u, a[0], a[1], a[2], a[3]);
      case 'bcmDrill':
        return this.svc.bcmDrill(u, a[0], a[1]);
      case 'recordPdpaDpo':
        return this.svc.recordPdpaDpo(u, a[0], a[1]);
      case 'addPdpaRequest':
        return this.svc.addPdpaRequest(u, a[0]);
      case 'pdpaRequestStep':
        return this.svc.pdpaRequestStep(u, a[0], a[1], a[2]);
      case 'grcEvidence':
        return this.svc.grcEvidence(u, a[0], a[1], a[2]);
      case 'grcCheck':
        return this.svc.grcCheck(u, a[0], a[1], a[2]);
      case 'recordOshAssessment':
        return this.svc.recordOshAssessment(u, a[0], a[1]);
      case 'submitWhistle':
        return this.svc.submitWhistle(u, a[0]);
      case 'whistleStep':
        return this.svc.whistleStep(u, a[0], a[1], a[2]);
      case 'declareGift':
        return this.svc.declareGift(u, a[0]);
      case 'decideGift':
        return this.svc.decideGift(u, a[0], a[1], a[2]);
      case 'addGovMandate':
        return this.svc.addGovMandate(u, a[0], a[1]);
      case 'govMandateStep':
        return this.svc.govMandateStep(u, a[0], a[1], a[2]);
      case 'raisePurRequest':
        return this.svc.raisePurRequest(u, a[0], a[1]);
      case 'purStep':
        return this.svc.purStep(u, a[0], a[1], a[2]);
      case 'addPurSupplier':
        return this.svc.addPurSupplier(u, a[0], a[1]);
      case 'purSupplierStep':
        return this.svc.purSupplierStep(u, a[0], a[1], a[2]);
      case 'confirmMyItem':
        return this.svc.confirmMyItem(u, a[0], a[1], a[2]);
      case 'stockIssue':
        return this.svc.stockIssue(u, a[0], a[1]);
      case 'stockReturn':
        return this.svc.stockReturn(u, a[0], a[1], a[2]);
      case 'corpFilingStep':
        return this.svc.corpFilingStep(u, a[0], a[1], a[2]);
      case 'raiseCorpChange':
        return this.svc.raiseCorpChange(u, a[0], a[1]);
      case 'decideCorpChange':
        return this.svc.decideCorpChange(u, a[0], a[1], a[2], a[3]);
      case 'recordCorpBoard':
        return this.svc.recordCorpBoard(u, a[0], a[1], a[2]);
      case 'websiteAction':
        return this.svc.websites.act(u, a[0], a[1]);
      case 'websiteSyncFeed':
        return this.svc.websites.syncFromFeed(u, a[0]);
      case 'raiseItTicket':
        return this.svc.raiseItTicket(u, a[0]);
      case 'itTicketStep':
        return this.svc.itTicketStep(u, a[0], a[1], a[2]);
      case 'itAct':
        return this.svc.itAct(u, a[0], a[1]);
      case 'setItOnboardingStep':
        return this.svc.setItOnboardingStep(u, a[0], a[1], a[2], a[3], a[4]);
      case 'setItTenderItem':
        return this.svc.setItTenderItem(u, a[0], a[1], a[2]);
      case 'setItAsset':
        return this.svc.setItAsset(u, a[0], a[1], a[2], a[3]);
      case 'itMaintenance':
        return this.svc.itMaintenance(u, a[0], a[1], a[2], a[3]);
      case 'raiseItPurchase':
        return this.svc.raiseItPurchase(u, a[0]);
      case 'itPurchaseStep':
        return this.svc.itPurchaseStep(u, a[0], a[1], a[2]);
      case 'reviewBranchAction':
        return this.svc.reviewBranchAction(u, a[0], a[1], a[2]);
      case 'addBranchAgreement':
        return this.svc.addBranchAgreement(u, a[0], a[1]);
      case 'setMobItem':
        return this.svc.setMobItem(u, a[0], a[1], a[2], a[3], a[4]);
      case 'contractStep':
        return this.svc.contractStep(u, a[0], a[1], a[2]);
      case 'contractReview':
        return this.svc.contractReview(u, a[0], a[1], a[2], a[3]);
      case 'addContract':
        return this.svc.addContract(u, a[0]);
      case 'addClientAccount':
        return this.svc.addClientAccount(u, a[0]);
      case 'addContractVariation':
        return this.svc.addContractVariation(u, a[0], a[1]);
      case 'setFinPack':
        return this.svc.setFinPack(u, a[0], a[1], a[2], a[3]);
      case 'prepareStaffPay':
        return this.svc.prepareStaffPay(u, a[0], a[1]);
      case 'setStaffPayLine':
        return this.svc.setStaffPayLine(u, a[0], a[1], a[2]);
      case 'staffPayStep':
        return this.svc.staffPayStep(u, a[0], a[1], a[2]);
      case 'staffPayExport':
        return this.svc.staffPayExport(u, a[0], a[1]);
      case 'submitStaffClaim':
        return this.svc.submitStaffClaim(u, a[0], a[1]);
      case 'cosDecideClaim':
        return this.svc.cosDecideClaim(u, a[0], a[1], a[2]);
      case 'cooDecideClaim':
        return this.svc.cooDecideClaim(u, a[0], a[1], a[2]);
      case 'financePayClaim':
        return this.svc.financePayClaim(u, a[0], a[1]);
      case 'hrDecideClaim':
        return this.svc.hrDecideClaim(u, a[0], a[1], a[2]);
      case 'setClaimRate':
        return this.svc.setClaimRate(u, a[0], a[1], a[2]);
      case 'saveProduct':
        return this.svc.saveProduct(u, a[0]);
      case 'saveProductCert':
        return this.svc.saveProductCert(u, a[0], a[1], a[2]);
      case 'clientInvoice':
        return this.svc.clientInvoice(u, a[0], a[1], a[2], a[3], a[4]);
      case 'setInvoicePortal':
        return this.svc.setInvoicePortal(u, a[0], a[1]);
      case 'saveExpense':
        return this.svc.saveExpense(u, a[0], a[1]);
      case 'submitExpense':
        return this.svc.submitExpense(u, a[0]);
      case 'decideExpense':
        return this.svc.decideExpense(u, a[0], a[1], a[2]);
      case 'clientStep':
        return this.svc.clientStep(u, a[0], a[1], a[2], a[3], a[4]);
      case 'startOffboarding':
        return this.svc.startOffboarding(u, a[0], a[1]);
      case 'clientContact':
        return this.svc.clientContact(u, a[0], a[1], a[2]);
      case 'clientReport':
        return this.svc.clientReport(u, a[0], a[1], a[2]);
      case 'clientRating':
        return this.svc.clientRating(u, a[0], a[1], a[2]);
      case 'clientBilling':
        return this.svc.clientBilling(u, a[0], a[1]);
      case 'requestVehicle':
        return this.svc.requestVehicle(u, a[0]);
      case 'decideVehicleRequest':
        return this.svc.decideVehicleRequest(u, a[0], a[1], a[2], a[3]);
      case 'vehicleOut':
        return this.svc.vehicleOut(u, a[0], a[1], a[2], a[3]);
      case 'vehicleIn':
        return this.svc.vehicleIn(u, a[0], a[1], a[2]);
      case 'recordVehicleWork':
        return this.svc.recordVehicleWork(u, a[0], a[1], a[2]);
      case 'fileMonitoringConsent':
        return this.svc.fileMonitoringConsent(u, a[0], a[1]);
      case 'setStaffPin':
        return this.svc.setStaffPin(u, a[0], a[1]);
      case 'closeAccess':
        return this.svc.closeAccess(u, a[0], a[1]);
      case 'openPdpaCase':
        return this.svc.openPdpaCase(u, a[0]);
      case 'pdpaStep':
        return this.svc.pdpaStep(u, a[0], a[1], a[2], a[3]);
      case 'publishMemo':
        return this.svc.publishMemo(u, a[0], a[1], a[2], a[3]);
      case 'readMemo':
        return this.svc.readMemo(u, a[0]);
      case 'staffClockOut':
        return this.svc.staffClockOut(u, a[0]);
      case 'staffPing':
        return this.svc.staffPing(u, a[0]);
      case 'remoteApply':
        return this.svc.remoteApply(u, a[0]);
      case 'remotePlan':
        return this.svc.remotePlan(u, a[0]);
      case 'remoteTask':
        return this.svc.remoteTask(u, a[0], a[1], a[2]);
      case 'remoteCheckIn':
        return this.svc.remoteCheckIn(u, a[0]);
      case 'remoteReport':
        return this.svc.remoteReport(u, a[0]);
      case 'remoteDecide':
        return this.svc.remoteDecide(u, a[0], a[1], a[2]);
      case 'remoteEnd':
        return this.svc.remoteEnd(u, a[0], a[1]);
      case 'remoteReview':
        return this.svc.remoteReview(u, a[0], a[1], a[2]);
      case 'workCheckIn':
        return this.svc.workCheckIn(u, a[0]);
      case 'workTaskAdd':
        return this.svc.workTaskAdd(u, a[0]);
      case 'workTaskDone':
        return this.svc.workTaskDone(u, a[0], a[1]);
      case 'workTaskLate':
        return this.svc.workTaskLate(u, a[0], a[1]);
      case 'workTaskReview':
        return this.svc.workTaskReview(u, a[0], a[1], a[2]);
      case 'seenCooNotice':
        return this.svc.seenCooNotice(u, a[0], a[1], a[2]);
      case 'helpAsk':
        return this.svc.helpAsk(u, a[0]);
      case 'helpAnswer':
        return this.svc.helpAnswer(u, a[0], a[1]);
      case 'oneOnOneRecord':
        return this.svc.oneOnOneRecord(u, a[0]);
      case 'playbookSignOff':
        return this.svc.playbookSignOff(u, a[0]);
      case 'plannerSync':
        return this.svc.plannerSync(u);
      case 'branchCheckSubmit':
        return this.svc.branchCheckSubmit(u, a[0], a[1]);
      case 'branchVisitRecord':
        return this.svc.branchVisitRecord(u, a[0], a[1]);
      case 'confirmTenderNa':
        return this.svc.confirmTenderNa(u, a[0], a[1], a[2]);
      case 'undoTenderStep':
        return this.svc.undoTenderStep(u, a[0], a[1]);
      case 'planTenderStep':
        return this.svc.planTenderStep(u, a[0], a[1], a[2], a[3]);
      case 'decideTender':
        return this.svc.decideTender(u, a[0], a[1], a[2]);
      case 'setTenderRecord':
        return this.svc.setTenderRecord(u, a[0], a[1], a[2]);
      case 'addTenderQuery':
        return this.svc.addTenderQuery(u, a[0], a[1], a[2]);
      case 'setTenderQuery':
        return this.svc.setTenderQuery(u, a[0], a[1], a[2], a[3]);
      case 'addTenderPapers':
        return this.svc.addTenderPapers(u, a[0], a[1], a[2]);
      case 'setTenderBidFiles':
        return this.svc.setTenderBidFiles(u, a[0], a[1]);
      case 'uploadTenderBidFile':
        return this.svc.uploadTenderBidFile(u, a[0], a[1], a[2]);
      case 'confirmTenderBidFile':
        return this.svc.confirmTenderBidFile(u, a[0], a[1]);
      case 'draftTenderChecklist':
        return this.svc.draftTenderChecklist(u, a[0]);
      case 'reviewTenderChecklist':
        return this.svc.reviewTenderChecklist(u, a[0], a[1]);
      case 'verifyTender':
        return this.svc.verifyTender(u, a[0], a[1], a[2]);
      case 'submitTender':
        return this.svc.submitTender(u, a[0], a[1], a[2]);
      case 'setReportDefs':
        return this.svc.setReportDefs(u, a[0], a[1]);
      case 'submitReport':
        return this.svc.submitReport(u, a[0]);
      case 'scheduleMeeting':
        return this.svc.scheduleMeeting(u, a[0]);
      case 'addMinutes':
        return this.svc.addMinutes(u, a[0], a[1]);
      case 'checkMeetingSummary':
        return this.svc.checkMeetingSummary(u, a[0], a[1]);
      case 'setMeetingAction':
        return this.svc.setMeetingAction(u, a[0], a[1], a[2]);
      case 'setMeetingPrep':
        return this.svc.setMeetingPrep(u, a[0], a[1]);
      case 'issueFirearm':
        return this.svc.issueFirearm(u, a[0]);
      case 'planArmedJob':
        return this.svc.planArmedJob(u, a[0]);
      case 'updateArmedJob':
        return this.svc.updateArmedJob(u, a[0], a[1], a[2]);
      case 'returnFirearm':
        return this.svc.returnFirearm(u, a[0]);
      case 'escalateFirearm':
        return this.svc.escalateFirearm(u, a[0]);
      case 'countVault':
        return this.svc.countVault(u, a[0], a[1]);
      case 'assignCmsShift':
        return this.svc.assignCmsShift(u, a[0], a[1]);
      case 'updateCmsSettings':
        return this.svc.updateCmsSettings(u, a[0]);
      case 'planCmsRoster':
        return this.svc.planCmsRoster(u, a[0]);
      case 'recordCmsHandover':
        return this.svc.recordCmsHandover(u, a[0], a[1]);
      case 'logCallback':
        return this.svc.logCallback(u, a[0], a[1]);
      case 'followUpAttendance':
        return this.svc.followUpAttendance(u, a[0]);
      case 'requestLeave':
        return this.svc.requestLeave(u, a[0]);
      case 'decideLeave':
        return this.svc.decideLeave(u, a[0], a[1], a[2]);
      case 'acknowledgeAlarm':
        return this.svc.acknowledgeAlarm(u, a[0]);
      case 'requestTrip':
        return this.svc.requestTrip(u, a[0]);
      case 'decideTrip':
        return this.svc.decideTrip(u, a[0], a[1], a[2]);
      case 'whistleReview':
        return this.svc.whistleReview(u, a[0], a[1], a[2]);
      case 'confirmStockLoss':
        return this.svc.confirmStockLoss(u, a[0], a[1], a[2]);
      case 'stockCount':
        return this.svc.stockCount(u, a[0], a[1], a[2]);
      case 'amDecideReversal':
        return this.svc.amDecideReversal(u, a[0], a[1], a[2], a[3]);
      case 'reviewFalseAlarm':
        return this.svc.reviewFalseAlarm(u, a[0], a[1], a[2]);
      case 'closeAlarm':
        return this.svc.closeAlarm(u, a[0], a[1], a[2]);
      case 'reviewArmsRequest':
        return this.svc.reviewArmsRequest(u, a[0], a[1], a[2]);
      case 'setPatrolInterval':
        return this.svc.setPatrolInterval(u, a[0], a[1]);
    }
  }

  private async write<T>(op: Mutations, args: unknown[], expectedUserId?: string): Promise<T> {
    // Test version only: browser checks may hold every change open for a while to test slow responses.
    const hold = (globalThis as { __primaDemoDelayMs?: unknown }).__primaDemoDelayMs;
    if (typeof hold === 'number' && hold > 0) await new Promise((r) => setTimeout(r, Math.min(hold, 5000)));
    const u = await this.user();
    if (expectedUserId && u.id !== expectedUserId) throw new ApiError('Sign-in changed. Reopen manual IT work.',401);
    try {
      const out = (await this.apply(u, op, args)) as T;
      const now = this.realNow();
      this.log.push({ day: dateOf(now), at: now, userId: u.id, op, args });
      writeLog(this.log);
      return out;
    } catch (e) {
      return toApiError(e);
    }
  }

  async listUsers() {
    await this.ready();
    return this.svc.users();
  }

  async signIn(userId: string): Promise<Me> {
    this.userId = userId;
    try {
      localStorage.setItem(USER_KEY, userId);
    } catch {
      /* ignore */
    }
    return this.me();
  }

  me(): Promise<Me> {
    return this.read(async (svc, user) => ({ user, companies: await svc.visibleCompanies(user), now: svc.now(), dataMode: 'test' as const }));
  }

  overview() {
    return this.read((s, u) => s.groupOverview(u));
  }
  dashboard(companyId: string) {
    return this.read((s, u) => s.companyDashboard(u, companyId));
  }
  sites(companyId: string) {
    return this.read((s, u) => s.sites(u, companyId));
  }
  setPatrolInterval(siteId: string, input: Parameters<Api['setPatrolInterval']>[1]) {
    return this.write<Awaited<ReturnType<Api['setPatrolInterval']>>>('setPatrolInterval', [siteId, input]);
  }
  site(siteId: string) {
    return this.read((s, u) => s.siteDetail(u, siteId));
  }
  people(companyId: string, q = '') {
    return this.read((s, u) => s.people(u, companyId, q));
  }
  person(personId: string) {
    return this.read((s, u) => s.personDetail(u, personId));
  }
  myDuty() {
    return this.read((s, u) => s.myDuty(u));
  }
  myStaffClock() {
    return this.read((s, u) => s.myStaffClock(u));
  }
  confidentiality() {
    return this.read((s, u) => s.confidentiality(u));
  }
  acceptConfidentiality() {
    return this.write('acceptConfidentiality', []);
  }
  staffSessionStart() {
    return this.write('staffSessionStart', []);
  }
  staffSessionEnd() {
    return this.write('staffSessionEnd', []);
  }
  staffClockIn(input: Parameters<Api['staffClockIn']>[0]) {
    return this.write('staffClockIn', [input]);
  }
  staffClockOut(input: Parameters<Api['staffClockOut']>[0]) {
    return this.write('staffClockOut', [input]);
  }
  staffPing(input: Parameters<Api['staffPing']>[0]) {
    return this.write('staffPing', [input]);
  }
  staffClockBoard(date?: string) {
    return this.read((s, u) => s.staffClockBoard(u, date));
  }
  staffClockDetail(id: string) {
    return this.read((s, u) => s.staffClockDetail(u, id));
  }
  myRemote() {
    return this.read((s, u) => s.myRemote(u));
  }
  remoteApply(input: Parameters<Api['remoteApply']>[0]) {
    return this.write('remoteApply', [input]);
  }
  remotePlan(tasks: string[]) {
    return this.write('remotePlan', [tasks]);
  }
  remoteTask(taskId: string, done: boolean, output: string) {
    return this.write('remoteTask', [taskId, done, output]);
  }
  remoteCheckIn(note: string) {
    return this.write('remoteCheckIn', [note]);
  }
  remoteReport(input: { summary: string; blockers: string }) {
    return this.write('remoteReport', [input]);
  }
  remoteBoard() {
    return this.read((s, u) => s.remoteBoard(u));
  }
  remoteDecide(id: string, approve: boolean, note: string) {
    return this.write('remoteDecide', [id, approve, note]);
  }
  remoteEnd(id: string, note: string) {
    return this.write('remoteEnd', [id, note]);
  }
  remoteReview(dayId: string, verdict: 'accepted' | 'queried', note: string) {
    return this.write('remoteReview', [dayId, verdict, note]);
  }
  myWork() {
    return this.read((s, u) => s.myWork(u));
  }
  workCheckIn(input: Parameters<Api['workCheckIn']>[0]) {
    return this.write('workCheckIn', [input]);
  }
  workTaskAdd(input: Parameters<Api['workTaskAdd']>[0]) {
    return this.write('workTaskAdd', [input]);
  }
  workTaskDone(id: string, input: { note: string; ref: string }) {
    return this.write('workTaskDone', [id, input]);
  }
  workTaskLate(id: string, input: { reason: string; newDueAt: string }) {
    return this.write('workTaskLate', [id, input]);
  }
  workTaskReview(id: string, accept: boolean, note: string) {
    return this.write('workTaskReview', [id, accept, note]);
  }
  seenCooNotice(kind: 'work' | 'fwm', id: string, noticeId: string) {
    return this.write('seenCooNotice', [kind, id, noticeId]);
  }
  helpAsk(input: { text: string; taskId: string | null }) {
    return this.write('helpAsk', [input]);
  }
  helpAnswer(id: string, text: string) {
    return this.write('helpAnswer', [id, text]);
  }
  oneOnOneRecord(input: { userId: string; notes: string; agreed: string[] }) {
    return this.write('oneOnOneRecord', [input]);
  }
  playbookSignOff(userId: string) {
    return this.write('playbookSignOff', [userId]);
  }
  teamWork() {
    return this.read((s, u) => s.teamWork(u));
  }
  personWork(userId: string) {
    return this.read((s, u) => s.personWork(u, userId));
  }
  workSummary() {
    return this.read((s, u) => s.workSummary(u));
  }
  plannerSync() {
    return this.write('plannerSync', []);
  }
  branchWork() {
    return this.read((s, u) => s.branchWork(u));
  }
  branchCheckSubmit(branchId: string, input: Parameters<Api['branchCheckSubmit']>[1]) {
    return this.write('branchCheckSubmit', [branchId, input]);
  }
  branchVisitRecord(branchId: string, input: Parameters<Api['branchVisitRecord']>[1]) {
    return this.write('branchVisitRecord', [branchId, input]);
  }
  guardProfile(personId: string) {
    return this.read((s, u) => s.guardProfile(u, personId));
  }
  leaveRequests(filter: { companyId?: string; waiting?: 'me'; status?: 'pending' | 'all' } = {}) {
    return this.read((s, u) => s.leaveRequests(u, filter));
  }
  requestLeave(input: LeaveInput) {
    return this.write<unknown>('requestLeave', [input]);
  }
  decideLeave(id: string, approve: boolean, note: string) {
    return this.write<unknown>('decideLeave', [id, approve, note]);
  }
  socsoClaims() {
    return this.read((s, u) => s.socsoClaims(u));
  }
  socsoClaim(id: string) {
    return this.read((s, u) => s.socsoClaimDetail(u, id));
  }
  startSocsoClaim(personId: string, input: Parameters<Api['startSocsoClaim']>[1]) {
    return this.write<{ id: string }>('startSocsoClaim', [personId, input]);
  }
  addSocsoDoc(id: string, item: string, proof: Parameters<Api['addSocsoDoc']>[2], mc?: { from: string; to: string }) {
    return this.write<unknown>('addSocsoDoc', [id, item, proof, mc]);
  }
  overrideSocsoDoc(id: string, item: string, reason: string) {
    return this.write<unknown>('overrideSocsoDoc', [id, item, reason]);
  }
  setSocsoRehab(id: string, input: Parameters<Api['setSocsoRehab']>[1]) {
    return this.write<unknown>('setSocsoRehab', [id, input]);
  }
  addSocsoAppointment(id: string, input: { at: string; what: string }) {
    return this.write<unknown>('addSocsoAppointment', [id, input]);
  }
  addSocsoRestriction(id: string, input: Parameters<Api['addSocsoRestriction']>[1]) {
    return this.write<unknown>('addSocsoRestriction', [id, input]);
  }
  clearSocsoRestriction(id: string, restrictionId: string, note: string) {
    return this.write<unknown>('clearSocsoRestriction', [id, restrictionId, note]);
  }
  addSocsoCheckIn(id: string, note: string) {
    return this.write<unknown>('addSocsoCheckIn', [id, note]);
  }
  fwmBoard() {
    return this.read((s, u) => s.fwmBoard(u));
  }
  hostelBoard() {
    return this.read((s, u) => s.hostelBoard(u));
  }
  addHostelBill(input: Parameters<Api['addHostelBill']>[0], proof: ProofInput[]) {
    return this.write<unknown>('addHostelBill', [input, proof]);
  }
  hostelBillStep(billId: string, step: 'request' | 'check' | 'approve' | 'slip', ok: boolean, note: string, proof: ProofInput[] = []) {
    if (step === 'request') return this.write<unknown>('requestHostelPayment', [billId, note]);
    if (step === 'check') return this.write<unknown>('checkHostelBill', [billId, ok, note]);
    if (step === 'approve') return this.write<unknown>('approveHostelBill', [billId, ok, note]);
    return this.write<unknown>('uploadHostelSlip', [billId, note, proof]);
  }
  decideUtilityCharge(chargeId: string, decision: 'NOTICE' | 'DEDUCTION', note: string) {
    return this.write<unknown>('decideUtilityCharge', [chargeId, decision, note]);
  }
  ackUtilityNotice(chargeId: string) {
    return this.write<unknown>('ackUtilityNotice', [chargeId]);
  }
  fileUtilityPaper(personId: string, what: 'clause' | 'ack', proof: ProofInput[]) {
    return this.write<unknown>('fileUtilityPaper', [personId, what, proof]);
  }
  staffClaims() {
    return this.read((s, u) => s.staffClaims(u));
  }
  branchBoard() {
    return this.read((s, u) => s.branchBoard(u));
  }
  creditBoard() {
    return this.read((s, u) => s.creditBoard(u));
  }
  runCreditCheck() {
    return this.write<{ opened: number; checkedOn: string }>('runCreditCheck', []);
  }
  creditDecide(id: string, action: Parameters<Api['creditDecide']>[1], note: string) {
    return this.write<unknown>('creditDecide', [id, action, note]);
  }
  creditEnforcementStep(id: string, no: number, note: string) {
    return this.write<unknown>('creditEnforcementStep', [id, no, note]);
  }
  creditRepayment(loanId: string, no: number, amount: number, bankRef: string, paidOn: string) {
    return this.write<unknown>('creditRepayment', [loanId, no, amount, bankRef, paidOn]);
  }
  creditChargeLodged(loanId: string, ssmRef: string, lodgedOn: string) {
    return this.write<unknown>('creditChargeLodged', [loanId, ssmRef, lodgedOn]);
  }
  creditDispute(loanId: string, action: 'raise' | 'close', note: string) {
    return this.write<unknown>('creditDispute', [loanId, action, note]);
  }
  addCreditLoan(companyId: string, input: Parameters<Api['addCreditLoan']>[1]) {
    return this.write<unknown>('addCreditLoan', [companyId, input]);
  }
  actBoard() {
    return this.read((s, u) => s.actBoard(u));
  }
  raiseActFinding(input: Parameters<Api['raiseActFinding']>[0]) {
    return this.write<unknown>('raiseActFinding', [input]);
  }
  actFindingStep(id: string, action: Parameters<Api['actFindingStep']>[1], body: Parameters<Api['actFindingStep']>[2]) {
    return this.write<unknown>('actFindingStep', [id, action, body]);
  }
  recordActAudit(input: Parameters<Api['recordActAudit']>[0]) {
    return this.write<unknown>('recordActAudit', [input]);
  }
  addActImprovement(input: Parameters<Api['addActImprovement']>[0]) {
    return this.write<unknown>('addActImprovement', [input]);
  }
  actImprovementStep(id: string, action: Parameters<Api['actImprovementStep']>[1], body: Parameters<Api['actImprovementStep']>[2]) {
    return this.write<unknown>('actImprovementStep', [id, action, body]);
  }
  fixedAssets() {
    return this.read((s, u) => s.fixedAssets(u));
  }
  postDepreciation(ownerEntity: string, period: string, sqlRef: string) {
    return this.write<unknown>('postDepreciation', [ownerEntity, period, sqlRef]);
  }
  amDisposalStep(id: string, action: Parameters<Api['amDisposalStep']>[1], body: Parameters<Api['amDisposalStep']>[2]) {
    return this.write<unknown>('amDisposalStep', [id, action, body]);
  }
  payChanges() {
    return this.read((s, u) => s.payChanges(u));
  }
  decidePayChange(id: string, verify: boolean, note: string) {
    return this.write<unknown>('decidePayChange', [id, verify, note]);
  }
  // The test link has no Prima server: Arisha uses Claude through the page instead.
  arishaSummary(input: Parameters<Api['arishaSummary']>[0]) {
    return this.read((s, u) => s.arishaContext.summary(u, input.context, input.companyId ?? null));
  }
  arishaFinanceOptions(companyId: string | null) {
    return this.read((s, u) => s.arishaDrafts.financeModelOptions(u, companyId));
  }
  arishaPrepareFinance(input: Record<string, unknown>) {
    return this.read((s, u) => s.arishaDrafts.prepareFinance(u, input));
  }
  arishaDraftForm(kind: Parameters<Api['arishaDraftForm']>[0], companyId: string | null) {
    return this.read((s, u) => s.arishaDrafts.form(u, kind, companyId));
  }
  arishaPrepare(input: Record<string, unknown>) { return this.read((s, u) => s.arishaDrafts.prepareRecord(u, input)); }
  arishaDrafts() { return this.read((s, u) => s.arishaDrafts.list(u)); }
  arishaFinancePapers(companyId: string) { return this.read((s, u) => s.arishaDrafts.financePapers(u, companyId)); }
  arishaSubmit(payload: Parameters<Api['arishaSubmit']>[0], companyId: string | null) {
    return this.write<Awaited<ReturnType<Api['arishaSubmit']>>>('arishaSubmit', [payload, companyId]);
  }
  arishaCommit(id: string, version: number) {
    return this.write<Awaited<ReturnType<Api['arishaCommit']>>>('arishaCommit', [id, version]);
  }
  arishaResubmit(id: string, version: number) {
    return this.write<Awaited<ReturnType<Api['arishaResubmit']>>>('arishaResubmit', [id, version]);
  }
  arishaReturn(id: string, version: number) {
    return this.write<Awaited<ReturnType<Api['arishaReturn']>>>('arishaReturn', [id, version]);
  }
  arishaStatus() {
    return Promise.resolve({ enabled: false });
  }
  arisha(): ReturnType<Api['arisha']> {
    return Promise.reject(new Error('Arisha runs on the Prima server only.'));
  }
  recordKinds() {
    return this.read((s, u) => Promise.resolve(s.recordKindsFor(u)));
  }
  recordForm(kind: Parameters<Api['recordForm']>[0], id: string | null, companyId: string | null) {
    return this.read((s, u) => s.recordForm(u, kind, id, companyId));
  }
  saveRecord(kind: Parameters<Api['saveRecord']>[0], id: string | null, companyId: string | null, values: Parameters<Api['saveRecord']>[3]) {
    return this.write<unknown>('saveRecord', [kind, id, companyId, values]);
  }
  amRecordPayment(unitId: string, input: Parameters<Api['amRecordPayment']>[1]) {
    return this.write<unknown>('amRecordPayment', [unitId, input]);
  }
  amReversePayment(unitId: string, paymentId: string, reason: string) {
    return this.write<unknown>('amReversePayment', [unitId, paymentId, reason]);
  }
  amBankCash(unitId: string, paymentId: string, input: { on: string; slipRef: string }) {
    return this.write<unknown>('amBankCash', [unitId, paymentId, input]);
  }
  amFollowUp(unitId: string, input: Parameters<Api['amFollowUp']>[1]) {
    return this.write<unknown>('amFollowUp', [unitId, input]);
  }
  amDecideLetter(unitId: string, followUpId: string, approve: boolean, note: string) {
    return this.write<unknown>('amDecideLetter', [unitId, followUpId, approve, note]);
  }
  amLifeReview(id: string, decision: 'keep' | 'rehab', body: { note?: string; cost?: number }) {
    return this.write<unknown>('amLifeReview', [id, decision, body]);
  }
  salesLeads(companyId: string) {
    return this.read((s, u) => s.salesLeads(u, companyId));
  }
  addSalesLead(companyId: string, input: Parameters<Api['addSalesLead']>[1]) {
    return this.write<unknown>('addSalesLead', [companyId, input]);
  }
  salesLeadStep(id: string, action: Parameters<Api['salesLeadStep']>[1], body: Parameters<Api['salesLeadStep']>[2]) {
    return this.write<unknown>('salesLeadStep', [id, action, body]);
  }
  corpAuditLegal() {
    return this.read((s, u) => s.corpAuditLegal(u));
  }
  corpAuditStep(id: string, action: Parameters<Api['corpAuditStep']>[1], body: Parameters<Api['corpAuditStep']>[2]) {
    return this.write<unknown>('corpAuditStep', [id, action, body]);
  }
  addLegalMatter(companyId: string, input: Parameters<Api['addLegalMatter']>[1]) {
    return this.write<unknown>('addLegalMatter', [companyId, input]);
  }
  legalMatterStep(id: string, action: Parameters<Api['legalMatterStep']>[1], body: Parameters<Api['legalMatterStep']>[2]) {
    return this.write<unknown>('legalMatterStep', [id, action, body]);
  }
  bcmBoard() {
    return this.read((s, u) => s.bcmBoard(u));
  }
  bcmRecord(systemId: string, copy: number, kind: Parameters<Api['bcmRecord']>[2], input: Parameters<Api['bcmRecord']>[3]) {
    return this.write<unknown>('bcmRecord', [systemId, copy, kind, input]);
  }
  bcmDrill(playbookId: string, input: Parameters<Api['bcmDrill']>[1]) {
    return this.write<unknown>('bcmDrill', [playbookId, input]);
  }
  pdpaRights() {
    return this.read((s, u) => s.pdpaRights(u));
  }
  recordPdpaDpo(companyId: string, input: Parameters<Api['recordPdpaDpo']>[1]) {
    return this.write<unknown>('recordPdpaDpo', [companyId, input]);
  }
  addPdpaRequest(input: Parameters<Api['addPdpaRequest']>[0]) {
    return this.write<unknown>('addPdpaRequest', [input]);
  }
  pdpaRequestStep(id: string, action: Parameters<Api['pdpaRequestStep']>[1], note: string) {
    return this.write<unknown>('pdpaRequestStep', [id, action, note]);
  }
  grcBoard() {
    return this.read((s, u) => s.grcBoard(u));
  }
  grcEvidence(id: string, on: string, ref: string) {
    return this.write<unknown>('grcEvidence', [id, on, ref]);
  }
  grcCheck(id: string, ok: boolean, note: string) {
    return this.write<unknown>('grcCheck', [id, ok, note]);
  }
  recordOshAssessment(siteId: string, input: Parameters<Api['recordOshAssessment']>[1]) {
    return this.write<unknown>('recordOshAssessment', [siteId, input]);
  }
  submitWhistle(input: Parameters<Api['submitWhistle']>[0]) {
    return this.write<{ code: string; handledBy: string }>('submitWhistle', [input]);
  }
  whistleStatus(code: string) {
    return this.read((s) => s.whistleStatus(code));
  }
  whistleStep(id: string, action: Parameters<Api['whistleStep']>[1], text: string) {
    return this.write<unknown>('whistleStep', [id, action, text]);
  }
  declareGift(input: Parameters<Api['declareGift']>[0]) {
    return this.write<unknown>('declareGift', [input]);
  }
  decideGift(id: string, outcome: Parameters<Api['decideGift']>[1], note: string) {
    return this.write<unknown>('decideGift', [id, outcome, note]);
  }
  govBoard() {
    return this.read((s, u) => s.govBoard(u));
  }
  addGovMandate(companyId: string, input: Parameters<Api['addGovMandate']>[1]) {
    return this.write<unknown>('addGovMandate', [companyId, input]);
  }
  govMandateStep(id: string, action: Parameters<Api['govMandateStep']>[1], body: Parameters<Api['govMandateStep']>[2]) {
    return this.write<unknown>('govMandateStep', [id, action, body]);
  }
  purBoard() {
    return this.read((s, u) => s.purBoard(u));
  }
  raisePurRequest(companyId: string, input: Parameters<Api['raisePurRequest']>[1]) {
    return this.write<unknown>('raisePurRequest', [companyId, input]);
  }
  myItems() {
    return this.read((s, u) => s.myItems(u));
  }
  confirmMyItem(id: string, received: boolean, note: string) {
    return this.write<unknown>('confirmMyItem', [id, received, note]);
  }
  purStep(id: string, action: Parameters<Api['purStep']>[1], body: Parameters<Api['purStep']>[2]) {
    return this.write<unknown>('purStep', [id, action, body]);
  }
  addPurSupplier(companyId: string, input: Parameters<Api['addPurSupplier']>[1]) {
    return this.write<unknown>('addPurSupplier', [companyId, input]);
  }
  purSupplierStep(id: string, action: Parameters<Api['purSupplierStep']>[1], note: string) {
    return this.write<unknown>('purSupplierStep', [id, action, note]);
  }
  stockIssue(companyId: string, input: Parameters<Api['stockIssue']>[1]) {
    return this.write<unknown>('stockIssue', [companyId, input]);
  }
  stockReturn(id: string, condition: Parameters<Api['stockReturn']>[1], note: string) {
    return this.write<unknown>('stockReturn', [id, condition, note]);
  }
  corpBoard() {
    return this.read((s, u) => s.corpBoard(u));
  }
  corpFilingStep(id: string, action: 'prepare' | 'lodge' | 'receipt', body: { ref?: string; on?: string }) {
    return this.write<unknown>('corpFilingStep', [id, action, body]);
  }
  raiseCorpChange(companyId: string, input: Parameters<Api['raiseCorpChange']>[1]) {
    return this.write<unknown>('raiseCorpChange', [companyId, input]);
  }
  decideCorpChange(id: string, decision: 'approve' | 'reject', note: string, clauseRef: string) {
    return this.write<unknown>('decideCorpChange', [id, decision, note, clauseRef]);
  }
  recordCorpBoard(id: string, resolutionRef: string, effectiveOn: string) {
    return this.write<unknown>('recordCorpBoard', [id, resolutionRef, effectiveOn]);
  }
  itBoard() {
    return this.read((s, u) => s.itBoard(u));
  }
  itPlan(span: 'week' | 'month' | 'year', from?: string) {
    return this.read((s, u) => s.itPlan(u, span, from));
  }
  websiteBoard() {
    return this.read((s, u) => s.websites.board(u));
  }
  /**
   * The test version cannot reach Cloudflare, GitHub, UptimeRobot, RDAP, SharePoint or Microsoft 365. It reads a SAMPLE
   * feed made from the register instead, with one site down, one certificate near expiry, one DNS change made outside
   * Prima, one registry date that differs and two SharePoint requests, so the linking can be tried. Nothing is sent.
   */
  async websiteSync() {
    const u = await this.user();
    const b = await this.svc.websites.board(u);
    if (!b.allowed) return toApiError(new Error('Only IT runs the website connectors.'));
    const at = this.realNow();
    const live = b.sites.filter((x) => x.site.status === 'live');
    const host = (url: string) => url.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const plusDays = (n: number) => dateOf(new Date(Date.parse(at) + n * 86_400_000).toISOString() as typeof at);
    const firstDomain = b.domains[0]?.domain;
    const feed = {
      at,
      cloudflare: {
        ok: true as const,
        data: {
          projects: live.map((x, k) => ({
            name: x.site.hosting.project || `site-${k + 1}`,
            domains: [host(x.site.url)],
            latest: { at, status: 'success', url: `https://sample-${k + 1}.pages.dev`, branch: 'main', commit: `sample${k}` },
          })),
          zones: b.domains.map((x) => ({
            name: x.domain.name,
            records: [
              // The first domain shows a change made outside Prima once Prima has seen it before.
              { type: 'A', name: x.domain.name, content: x.domain.id === firstDomain?.id && x.domain.observed?.dnsBaseline ? '192.0.2.99' : '192.0.2.10' },
              { type: 'MX', name: x.domain.name, content: 'sample.mail.protection.outlook.com' },
            ],
          })),
        },
      },
      github: { ok: true as const, data: { repos: live.filter((x) => x.site.repoRef && x.site.repoRef !== '(IT only)').map((x) => ({ name: x.site.repoRef.split('/').pop() ?? x.site.repoRef, url: x.site.repoRef, pushedAt: at, branch: 'main', lastCommit: { sha: 'sample', at, message: 'Sample commit' } })) } },
      uptime: {
        ok: true as const,
        data: {
          monitors: live.map((x, k) => ({
            url: x.site.url,
            status: k === 0 ? ('down' as const) : ('up' as const),
            since: k === 0 ? at : null,
            sslExpiresOn: plusDays(k === 1 ? 10 : 200),
          })),
        },
      },
      registrar: { ok: true as const, data: { domains: b.domains.map((x, k) => ({ name: x.domain.name, expiresOn: k === 1 ? plusDays(400) : x.domain.expiresOn, registrar: 'Sample registrar' })) } },
      // Email DNS (sample): the first email domain has no DMARC yet and DKIM off, the others are healthy.
      maildns: {
        ok: true as const,
        data: {
          domains: b.domains
            .filter((x) => x.domain.m365Email)
            .map((x, k) => ({
              name: x.domain.name,
              spf: 'v=spf1 include:spf.protection.outlook.com -all',
              dmarc: k === 0 ? null : `v=DMARC1; p=quarantine; rua=mailto:dmarc@${x.domain.name}`,
              dkim: k !== 0,
              mx: [`${x.domain.name.replace(/\./g, '-')}.mail.protection.outlook.com.`],
            })),
        },
      },
      sharepoint: {
        ok: true as const,
        data: {
          requests: [
            { id: 'sp-sample-1', kind: 'change' as const, title: 'Update the office phone number', detail: 'New line 03-0000 0000 (sample)', siteUrl: live[0]?.site.url ?? '', requestedBy: 'Sample company admin', at, link: 'https://example.invalid/sharepoint/1' },
            { id: 'sp-sample-2', kind: 'proposal' as const, title: 'Add a careers page', detail: 'Proposal from the company manager (sample)', siteUrl: live[1]?.site.url ?? '', requestedBy: 'Sample company manager', at, link: 'https://example.invalid/sharepoint/2' },
          ],
        },
      },
    };
    const r = await this.write<{ ran: string[]; issues: string[]; notices: number }>('websiteSyncFeed', [feed]);
    return { ...r, delivered: 0 };
  }
  websiteAction(action: string, input: Record<string, unknown>) {
    return this.write<unknown>('websiteAction', [action, input]);
  }
  raiseItTicket(input: Parameters<Api['raiseItTicket']>[0]) {
    return this.write<unknown>('raiseItTicket', [input]);
  }
  itTicketStep(id: string, action: 'take' | 'resolve', note: string) {
    return this.write<unknown>('itTicketStep', [id, action, note]);
  }
  async itCleanupAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>{
    if(!['cleanupBoard','cleanupReceipt','cleanupAbandon','cleanupNominate','cleanupDecide','cleanupRestore'].includes(action))throw new Error('Unsupported Controlled cleanup action.');
    if((await this.me()).user.id!==expectedUserId)throw new Error('Sign-in changed. Reopen controlled cleanup.');
    const result=action==='cleanupBoard'||action==='cleanupReceipt'?await this.read((s,u)=>{if(u.id!==expectedUserId||u.integration)throw new Error('Identity changed.');return s.itAct(u,action,input)}):await this.write<unknown>('itAct',[action,input],expectedUserId);
    if(this.userId!==expectedUserId)throw new Error('Sign-in changed. Recover with the original account.');
    return result;
  }
  async itMetricsAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>{
    if(!['metricsChoices','metricsBoard','metricsTargets','metricsRecovery','metricsOpen','metricsCommand','metricsSync','metricsReconcile','metricsReviewTarget','metricsReceipt','metricsAbandon'].includes(action))throw new Error('Unsupported Workflow timing action.');
    if((await this.me()).user.id!==expectedUserId)throw new Error('Sign-in changed. Reopen workflow timing.');
    const result=['metricsChoices','metricsBoard','metricsTargets','metricsRecovery','metricsReceipt'].includes(action)?await this.read((s,u)=>{if(u.id!==expectedUserId||u.integration)throw new Error('Identity changed.');return s.itAct(u,action,input)}):await this.write<unknown>('itAct',[action,input],expectedUserId);
    if(this.userId!==expectedUserId)throw new Error('Sign-in changed. Recover with the original account.');
    return result;
  }
  async itProcurementAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>{
    if(!['procurementBoard','procurementReceipt','procurementAbandon','issuePurchaseOrder','recordPurchaseReceipt','checkPurchaseInvoice','requestPurchaseAdvance','decidePurchaseAdvance','recordPurchasePayment'].includes(action))throw new Error('Unsupported Procurement action.');
    if((await this.me()).user.id!==expectedUserId)throw new Error('Sign-in changed. Reopen procurement.');
    const result=action==='procurementBoard'||action==='procurementReceipt'?await this.read((s,u)=>{if(u.id!==expectedUserId||u.integration)throw new Error('Identity changed.');return s.itAct(u,action,input)}):await this.write<unknown>('itAct',[action,input],expectedUserId);
    if(this.userId!==expectedUserId)throw new Error('Sign-in changed. Recover with the original account.');
    return result;
  }
  async itFinanceAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>{
    if(!['rentalCorrectionBoard','rentalCorrectionReceipt','rentalCorrectionAbandon','rentalCorrectionPropose','rentalCorrectionManagerReview','rentalCorrectionFinanceReview','rentalCorrectionCancel','rentalCorrectionRecordPayment'].includes(action))throw new Error('Unsupported Rental correction action.');
    if((await this.me()).user.id!==expectedUserId)throw new Error('Sign-in changed. Reopen rental correction.');
    const result=action==='rentalCorrectionBoard'||action==='rentalCorrectionReceipt'?await this.read((s,u)=>{if(u.id!==expectedUserId||u.integration)throw new Error('Identity changed.');return s.itAct(u,action,input)}):await this.write<unknown>('itAct',[action,input],expectedUserId);
    if(this.userId!==expectedUserId)throw new Error('Sign-in changed. Recover with the original account.');
    return result;
  }
  async hrItAct(expectedUserId:string,action:string,input:Record<string,unknown>):Promise<unknown>{
    if(!['hrItBoard','hrItReceipt','hrItAbandon','hrItCreate','hrItEditScope','hrItSubmit','hrItCancel','hrItTechnical','hrItCollectDetails','hrItSelfDetails','hrItReviewScope','hrItReviewHandoff','hrItRequestDelegation','hrItDecideDelegation'].includes(action))throw new Error('Unsupported HR/IT intake action.');
    if((await this.me()).user.id!==expectedUserId)throw new Error('Sign-in changed. Reopen HR/IT coordination.');
    const result=action==='hrItBoard'||action==='hrItReceipt'?await this.read((s,u)=>{if(u.id!==expectedUserId||u.integration)throw new Error('Identity changed.');return s.itAct(u,action,input)}):await this.write<unknown>('itAct',[action,input],expectedUserId);
    if(this.userId!==expectedUserId)throw new Error('Sign-in changed. Recover with the original account.');
    return result;
  }
  async itGuidanceBoard(expectedUserId:string):Promise<{userId:string;observedAt:string;board:Awaited<ReturnType<Api['itBoard']>>}> {
    if((await this.me()).user.id!==expectedUserId)throw new Error('Sign-in changed. Reopen your workflow guide.');
    const board=await this.read((s,u)=>{if(u.id!==expectedUserId||u.integration)throw new Error('Guide identity changed.');return s.itBoard(u);});
    if(this.userId!==expectedUserId)throw new Error('Sign-in changed while reading guidance.');
    return {userId:expectedUserId,observedAt:new Date().toISOString(),board};
  }
  async itManualAct(expectedUserId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    if (!['correctionBoard','correctAsset','correctSystem','correctIntake','manualBoard','manualReceipt','manualAbandon','createIntake','createSystem','createGuidance','updateGuidance','createAsset','operationalBoard','operationalReceipt','operationalAbandon','setRentalRates','prepareRentalBill','recordRentalHistory','recordAssetInspection'].includes(action)) throw new Error('Unsupported manual IT action.');
    if ((await this.me()).user.id !== expectedUserId) throw new Error('Sign-in changed. Reopen manual IT work.');
    if (action === 'correctionBoard' || action === 'manualBoard' || action === 'manualReceipt' || action === 'operationalBoard' || action === 'operationalReceipt') return this.read((s,u)=> { if(u.id!==expectedUserId) throw new Error('Sign-in changed.'); return s.itAct(u,action,input); });
    const result=await this.write<unknown>('itAct',[action,input],expectedUserId);
    if(this.userId!==expectedUserId)throw new ApiError('Sign-in changed. Check the original account receipt.',409);
    return result;
  }
  itAct(action: string, input: Record<string, unknown>) {
    return this.write<unknown>('itAct', [action, input]);
  }
  setItOnboardingStep(id: string, key: string, done: boolean, evidenceRef: string, expectedVersion: number) {
    return this.write<unknown>('setItOnboardingStep', [id, key, done, evidenceRef, expectedVersion]);
  }
  setItTenderItem(id: string, index: number, done: boolean) {
    return this.write<unknown>('setItTenderItem', [id, index, done]);
  }
  setItAsset(id: string, status: Parameters<Api['setItAsset']>[1], assignedTo: string | null, note: string) {
    return this.write<unknown>('setItAsset', [id, status, assignedTo, note]);
  }
  itMaintenance(id: string, kind: 'service' | 'repair', note: string, cost: number) {
    return this.write<unknown>('itMaintenance', [id, kind, note, cost]);
  }
  raiseItPurchase(input: Parameters<Api['raiseItPurchase']>[0]) {
    return this.write<unknown>('raiseItPurchase', [input]);
  }
  itPurchaseStep(id: string, action: Parameters<Api['itPurchaseStep']>[1], body: Parameters<Api['itPurchaseStep']>[2]) {
    return this.write<unknown>('itPurchaseStep', [id, action, body]);
  }
  approveBranchSettlement(id: string) {
    return this.write<unknown>('approveBranchSettlement', [id]);
  }
  reviewBranchAction(id: string, decision: 'accepted' | 'reversed', note: string) {
    return this.write<unknown>('reviewBranchAction', [id, decision, note]);
  }
  addBranchAgreement(branchId: string, input: Parameters<Api['addBranchAgreement']>[1]) {
    return this.write<unknown>('addBranchAgreement', [branchId, input]);
  }
  contracts() {
    return this.read((s, u) => s.contracts(u));
  }
  setMobItem(id: string, itemId: string, status: 'open' | 'done' | 'risk_accepted', note: string, acceptedUntil: string | null) {
    return this.write<unknown>('setMobItem', [id, itemId, status, note, acceptedUntil]);
  }
  contractStep(id: string, action: Parameters<Api['contractStep']>[1], note: string) {
    return this.write<unknown>('contractStep', [id, action, note]);
  }
  contractReview(id: string, day: 1 | 7 | 14 | 30, note: string, invoiceChecked: boolean) {
    return this.write<unknown>('contractReview', [id, day, note, invoiceChecked]);
  }
  addContract(input: Parameters<Api['addContract']>[0]) {
    return this.write<unknown>('addContract', [input]);
  }
  addClientAccount(input: Parameters<Api['addClientAccount']>[0]) {
    return this.write<unknown>('addClientAccount', [input]);
  }
  addContractVariation(id: string, input: Parameters<Api['addContractVariation']>[1]) {
    return this.write<unknown>('addContractVariation', [id, input]);
  }
  finBoard() {
    return this.read((s, u) => s.finBoard(u));
  }
  setFinPack(companyId: string, pack: 'audit' | 'tax', itemId: string, status: 'todo' | 'prepared' | 'reviewed' | 'sent') {
    return this.write<unknown>('setFinPack', [companyId, pack, itemId, status]);
  }
  staffPayroll() {
    return this.read((s, u) => s.staffPayroll(u));
  }
  staffPayRun(runId: string) {
    return this.read((s, u) => s.staffPayRun(u, runId));
  }
  prepareStaffPay(companyId: string, period: string) {
    return this.write<unknown>('prepareStaffPay', [companyId, period]);
  }
  setStaffPayLine(runId: string, personId: string, patch: Parameters<Api['setStaffPayLine']>[2]) {
    return this.write<unknown>('setStaffPayLine', [runId, personId, patch]);
  }
  staffPayStep(runId: string, action: Parameters<Api['staffPayStep']>[1], body: Parameters<Api['staffPayStep']>[2]) {
    return this.write<unknown>('staffPayStep', [runId, action, body]);
  }
  staffPayExport(runId: string, kind: Parameters<Api['staffPayExport']>[1]) {
    return this.write<Awaited<ReturnType<Api['staffPayExport']>>>('staffPayExport', [runId, kind]);
  }
  submitStaffClaim(input: Parameters<Api['submitStaffClaim']>[0], proof: ProofInput[]) {
    return this.write<unknown>('submitStaffClaim', [input, proof]);
  }
  decideStaffClaim(claimId: string, by: 'cos' | 'hr' | 'coo' | 'finance', ok: boolean, note: string) {
    if (by === 'finance') return this.write<unknown>('financePayClaim', [claimId, note]);
    return this.write<unknown>(by === 'cos' ? 'cosDecideClaim' : by === 'coo' ? 'cooDecideClaim' : 'hrDecideClaim', [claimId, ok, note]);
  }
  setClaimRate(month: string, vehicle: 'CAR' | 'MOTORCYCLE' | 'COMPANY_CAR', perKm: number) {
    return this.write<unknown>('setClaimRate', [month, vehicle, perKm]);
  }
  productBoard() {
    return this.read((s, u) => s.productBoard(u));
  }
  saveProduct(input: ProductInput) {
    return this.write<unknown>('saveProduct', [input]);
  }
  saveProductCert(productId: string, input: ProductCertInput, proof: ProofInput[]) {
    return this.write<unknown>('saveProductCert', [productId, input, proof]);
  }
  proposalReadiness(productIds: string[]) {
    return this.read((s, u) => s.proposalReadiness(u, productIds));
  }
  clientInvoice(accountId: string, period: string, channel: 'hand' | 'email' | 'portal', amount: number | null, proof: ProofInput[]) {
    return this.write<unknown>('clientInvoice', [accountId, period, channel, amount, proof]);
  }
  setInvoicePortal(accountId: string, portal: string | null) {
    return this.write<unknown>('setInvoicePortal', [accountId, portal]);
  }
  expenseBoard() {
    return this.read((s, u) => s.expenseBoard(u));
  }
  saveExpense(input: ExpenseInput, proof: ProofInput[]) {
    return this.write<unknown>('saveExpense', [input, proof]);
  }
  submitExpense(id: string) {
    return this.write<unknown>('submitExpense', [id]);
  }
  decideExpense(id: string, decision: 'approve' | 'return' | 'reject', note: string) {
    return this.write<unknown>('decideExpense', [id, decision, note]);
  }
  expenseDocs(id: string) {
    return this.read((s, u) => s.expenseDocs(u, id));
  }
  amBoard() {
    return this.read((s, u) => s.amBoard(u));
  }
  jaBoard() {
    return this.read((s, u) => s.jaBoard(u));
  }
  clientBoard() {
    return this.read((s, u) => s.clientBoard(u));
  }
  clientStep(accountId: string, phase: 'onboarding' | 'offboarding', key: string, note: string, proof: ProofInput[]) {
    return this.write<unknown>('clientStep', [accountId, phase, key, note, proof]);
  }
  startOffboarding(accountId: string, reason: string) {
    return this.write<unknown>('startOffboarding', [accountId, reason]);
  }
  clientContact(accountId: string, kind: 'visit' | 'meeting' | 'call', note: string) {
    return this.write<unknown>('clientContact', [accountId, kind, note]);
  }
  clientReport(accountId: string, period: string, proof: ProofInput[]) {
    return this.write<unknown>('clientReport', [accountId, period, proof]);
  }
  clientRating(accountId: string, score: number, comment: string) {
    return this.write<unknown>('clientRating', [accountId, score, comment]);
  }
  clientBilling(accountId: string, input: { invoicedTo: string | null; overdueAmount: number; overdueDays: number }) {
    return this.write<unknown>('clientBilling', [accountId, input]);
  }
  fleetBoard() {
    return this.read((s, u) => s.fleetBoard(u));
  }
  requestVehicle(input: VehicleRequestInput) {
    return this.write<unknown>('requestVehicle', [input]);
  }
  decideVehicleRequest(requestId: string, ok: boolean, vehicleId: string | null, note: string) {
    return this.write<unknown>('decideVehicleRequest', [requestId, ok, vehicleId, note]);
  }
  vehicleOut(vehicleId: string, requestId: string | null, km: number, driver?: string) {
    return this.write<unknown>('vehicleOut', [vehicleId, requestId, km, driver]);
  }
  vehicleIn(vehicleId: string, km: number, note: string) {
    return this.write<unknown>('vehicleIn', [vehicleId, km, note]);
  }
  recordVehicleWork(vehicleId: string, input: VehicleWorkInput, proof: ProofInput[]) {
    return this.write<unknown>('recordVehicleWork', [vehicleId, input, proof]);
  }
  fileMonitoringConsent(personId: string, proof: ProofInput[]) {
    return this.write<unknown>('fileMonitoringConsent', [personId, proof]);
  }
  setStaffPin(personId: string, pin: string) {
    return this.write<unknown>('setStaffPin', [personId, pin]);
  }
  closeAccess(userId: string, input: { from: string | null; reason: string }) {
    return this.write<{ userId: string; from: string; grantsEnded: number }>('closeAccess', [userId, input]);
  }
  pdpaBoard() {
    return this.read((s, u) => s.pdpaBoard(u));
  }
  openPdpaCase(input: PdpaCaseInput) {
    return this.write<unknown>('openPdpaCase', [input]);
  }
  pdpaStep(caseId: string, step: PdpaStepName, note: string, proof: ProofInput[]) {
    return this.write<unknown>('pdpaStep', [caseId, step, note, proof]);
  }
  pdpaDocs(caseId: string) {
    return this.read((s, u) => s.pdpaDocs(u, caseId));
  }
  memos() {
    return this.read((s, u) => s.memos(u));
  }
  publishMemo(audience: 'STAFF' | 'FIELD', title: string, body: string, states: string[]) {
    return this.write<unknown>('publishMemo', [audience, title, body, states]);
  }
  readMemo(memoId: string) {
    return this.write<unknown>('readMemo', [memoId]);
  }
  fwmDocs(ref: string) {
    return this.read((s, u) => s.fwmDocs(u, ref));
  }
  personDocs(personId: string) {
    return this.read((s, u) => s.personDocs(u, personId));
  }
  uploadHiringDoc(personId: string, kind: Parameters<Api['uploadHiringDoc']>[1], proof: ProofInput[]) {
    return this.write<unknown>('uploadHiringDoc', [personId, kind, proof]);
  }
  updateHospitalClaim(leaveId: string, input: Parameters<Api['updateHospitalClaim']>[1], proof: ProofInput[]) {
    return this.write<unknown>('updateHospitalClaim', [leaveId, input, proof]);
  }
  submitFwRenewal(personId: string, paper: Parameters<Api['submitFwRenewal']>[1], input: Parameters<Api['submitFwRenewal']>[2], proof: ProofInput[]) {
    return this.write<unknown>('submitFwRenewal', [personId, paper, input, proof]);
  }
  createFwmTask(personId: string, input: Parameters<Api['createFwmTask']>[1]) {
    return this.write<unknown>('createFwmTask', [personId, input]);
  }
  doneFwmTask(id: string, note: string, proof: ProofInput[]) {
    return this.write<unknown>('doneFwmTask', [id, note, proof]);
  }
  reviewFwmTask(id: string, accept: boolean, note: string) {
    return this.write<unknown>('reviewFwmTask', [id, accept, note]);
  }
  advanceSocsoClaim(id: string, to: Parameters<Api['advanceSocsoClaim']>[1], input: Parameters<Api['advanceSocsoClaim']>[2]) {
    return this.write<unknown>('advanceSocsoClaim', [id, to, input]);
  }
  roster(siteId: string, from: string, days: number) {
    return this.read((s, u) => s.roster(u, siteId, from, days));
  }
  candidates(shiftId: string, q = '') {
    return this.read((s, u) => s.candidates(u, shiftId, q));
  }
  attendance(companyId: string, date: string) {
    return this.read((s, u) => s.attendance(u, companyId, date));
  }
  cases(filter?: { companyId?: string; status?: 'active' | 'all'; waiting?: 'me' }) {
    return this.read((s, u) => s.cases(u, filter));
  }
  caseDetail(caseId: string) {
    return this.read((s, u) => s.caseDetail(u, caseId));
  }
  compliance() {
    return this.read((s, u) => s.compliance(u));
  }
  audit() {
    return this.read((s, u) => s.auditLog(u));
  }
  commercial(companyId: string) {
    return this.read((s, u) => s.commercial(u, companyId));
  }
  home(companyId?: string) {
    return this.read((s, u) => s.home(u, companyId));
  }
  regionalOps(region?: string) {
    return this.read((s, u) => s.regionalOps(u, region));
  }
  insurance() {
    return this.read((s, u) => s.insurance(u));
  }
  hrMonitor() {
    return this.read((s, u) => s.hrMonitor(u));
  }
  cms() {
    return this.read((s, u) => s.cms(u));
  }
  updateCmsSettings(patch: CmsSettingsPatch) {
    return this.write<unknown>('updateCmsSettings', [patch]);
  }
  planCmsRoster(days: number) {
    return this.write<unknown>('planCmsRoster', [days]);
  }
  recordCmsHandover(shiftId: string, note: string) {
    return this.write<unknown>('recordCmsHandover', [shiftId, note]);
  }
  attendanceAlerts(companyId: string) {
    return this.read((s, u) => s.attendanceAlerts(u, companyId));
  }
  addCasePhoto(caseId: string, input: PhotoInput) {
    return this.write<unknown>('addCasePhoto', [caseId, input]);
  }
  siteVisits(siteId: string) {
    return this.read((s, u) => s.siteVisits(u, siteId));
  }
  startSiteVisit(siteId: string, input: Parameters<Api['startSiteVisit']>[1]) {
    return this.write<unknown>('startSiteVisit', [siteId, input]);
  }
  addVisitPhoto(visitId: string, input: PhotoInput) {
    return this.write<unknown>('addVisitPhoto', [visitId, input]);
  }
  closeSiteVisit(visitId: string, findings: string) {
    return this.write<unknown>('closeSiteVisit', [visitId, findings]);
  }
  disciplineHistory(companyId: string, personId: string) {
    return this.read((s, u) => s.disciplineHistory(u, companyId, personId));
  }
  followUpAttendance(input: FollowUpInput) {
    return this.write<Awaited<ReturnType<Api['followUpAttendance']>>>('followUpAttendance', [input]);
  }
  acknowledgeAlarm(id: string) {
    return this.write<unknown>('acknowledgeAlarm', [id]);
  }
  requestTrip(input: { date: string; destination: string; purpose: string; forPersonId?: string }) {
    return this.write<unknown>('requestTrip', [input]);
  }
  decideTrip(id: string, ok: boolean, note: string) {
    return this.write<unknown>('decideTrip', [id, ok, note]);
  }
  whistleReview(id: string, agree: boolean, note: string) {
    return this.write<unknown>('whistleReview', [id, agree, note]);
  }
  confirmStockLoss(id: string, ok: boolean, note: string) {
    return this.write<unknown>('confirmStockLoss', [id, ok, note]);
  }
  stockCount(itemId: string, counted: number, witness: { staffNo: string; pin: string }) {
    return this.write<unknown>('stockCount', [itemId, counted, witness]);
  }
  amDecideReversal(unitId: string, paymentId: string, approve: boolean, note: string) {
    return this.write<unknown>('amDecideReversal', [unitId, paymentId, approve, note]);
  }
  reviewFalseAlarm(id: string, agree: boolean, note: string) {
    return this.write<unknown>('reviewFalseAlarm', [id, agree, note]);
  }
  closeAlarm(id: string, verdict: 'real' | 'false', note: string) {
    return this.write<unknown>('closeAlarm', [id, verdict, note]);
  }
  logCallback(callId: string, note: string) {
    return this.write<unknown>('logCallback', [callId, note]);
  }
  assignCmsShift(shiftId: string, staffName: string) {
    return this.write<unknown>('assignCmsShift', [shiftId, staffName]);
  }
  reviewArmsRequest(id: string, decision: 'pass' | 'return', note: string) {
    return this.write<unknown>('reviewArmsRequest', [id, decision, note]);
  }
  armsControl() {
    return this.read((s, u) => s.armsControl(u));
  }
  armsOverview() {
    return this.read((s, u) => s.armsOverview(u));
  }
  arms(companyId: string) {
    return this.read((s, u) => s.arms(u, companyId));
  }

  assign(shiftId: string, personId: string | null) {
    return this.write<{ warnings: { message: string }[] }>('assign', [shiftId, personId]);
  }
  publish(siteId: string, from: string, to: string) {
    return this.write<{ published: number; unfilled: number }>('publish', [siteId, from, to]);
  }
  lockAttendance(companyId: string, date: string) {
    return this.write<{ locked: number }>('lockAttendance', [companyId, date]);
  }
  clockIn(input: Parameters<Api['clockIn']>[0]) {
    return this.write<Awaited<ReturnType<Api['clockIn']>>>('clockIn', [input]);
  }
  clockOut(input: Parameters<Api['clockOut']>[0]) {
    return this.write<Awaited<ReturnType<Api['clockOut']>>>('clockOut', [input]);
  }
  scan(input: Parameters<Api['scan']>[0]) {
    return this.write<Awaited<ReturnType<Api['scan']>>>('scan', [input]);
  }
  raiseCase(input: Parameters<Api['raiseCase']>[0]) {
    return this.write<Awaited<ReturnType<Api['raiseCase']>>>('raiseCase', [input]);
  }
  signOffCase(caseId: string, outcome: Parameters<Api['signOffCase']>[1], note: string, proof: ProofInput[] = []) {
    return this.write<Awaited<ReturnType<Api['signOffCase']>>>('signOffCase', [caseId, outcome, note, proof]);
  }
  updateCase(caseId: string, action: Parameters<Api['updateCase']>[1], note = '', proof: ProofInput[] = []) {
    return this.write<Awaited<ReturnType<Api['updateCase']>>>('updateCase', [caseId, action, note, proof]);
  }

  createQuotation(companyId: string, input: Parameters<Api['createQuotation']>[1]) {
    return this.write<Awaited<ReturnType<Api['createQuotation']>>>('createQuotation', [companyId, input]);
  }
  quotationAction(id: string, action: Parameters<Api['quotationAction']>[1], note = '') {
    return this.write<Awaited<ReturnType<Api['quotationAction']>>>('quotationAction', [id, action, note]);
  }
  addTenderPapers(tenderId: string, kind: Parameters<Api['addTenderPapers']>[1], proof: ProofInput[]) {
    return this.write('addTenderPapers', [tenderId, kind, proof]);
  }
  draftTenderChecklist(tenderId: string) {
    return this.write('draftTenderChecklist', [tenderId]);
  }
  setTenderBidFiles(tenderId: string, files: Parameters<Api['setTenderBidFiles']>[1]) {
    return this.write('setTenderBidFiles', [tenderId, files]);
  }
  uploadTenderBidFile(tenderId: string, fileId: string, proof: ProofInput[]) {
    return this.write('uploadTenderBidFile', [tenderId, fileId, proof]);
  }
  confirmTenderBidFile(tenderId: string, fileId: string) {
    return this.write('confirmTenderBidFile', [tenderId, fileId]);
  }
  reviewTenderChecklist(tenderId: string, input: Parameters<Api['reviewTenderChecklist']>[1]) {
    return this.write('reviewTenderChecklist', [tenderId, input]);
  }
  verifyTender(tenderId: string, approve: boolean, note: string) {
    return this.write('verifyTender', [tenderId, approve, note]);
  }
  submitTender(tenderId: string, note: string, proof: ProofInput[]) {
    return this.write('submitTender', [tenderId, note, proof]);
  }
  meetings() {
    return this.read((s, u) => s.meetings(u));
  }
  scheduleMeeting(input: Parameters<Api['scheduleMeeting']>[0]) {
    return this.write('scheduleMeeting', [input]);
  }
  addMinutes(meetingId: string, text: string) {
    return this.write('addMinutes', [meetingId, text]);
  }
  checkMeetingSummary(meetingId: string, input: Parameters<Api['checkMeetingSummary']>[1]) {
    return this.write('checkMeetingSummary', [meetingId, input]);
  }
  setMeetingAction(meetingId: string, index: number, done: boolean) {
    return this.write('setMeetingAction', [meetingId, index, done]);
  }
  setMeetingPrep(meetingId: string, input: { index?: number; done?: boolean; add?: string }) {
    return this.write('setMeetingPrep', [meetingId, input]);
  }
  reports() {
    return this.read((s, u) => s.reports(u));
  }
  setReportDefs(defs: ReportDef[], note: string) {
    return this.write('setReportDefs', [defs, note]);
  }
  submitReport(input: Parameters<Api['submitReport']>[0]) {
    return this.write('submitReport', [input]);
  }
  tenderGroups() {
    return this.read((s, u) => s.tenderGroups(u));
  }
  createTenderGroup(sourceTenderId: string, companyIds: string[]) {
    return this.write<unknown>('createTenderGroup', [sourceTenderId, companyIds]);
  }
  tenderBoard() {
    return this.read((s, u) => s.tenderBoard(u));
  }
  tenderProtocol() {
    return this.read((s, u) => s.tenderProtocol(u));
  }
  setTenderProtocol(input: TenderProtocolInput) {
    return this.write('setTenderProtocol', [input]);
  }
  doTenderStep(tenderId: string, stepId: string, note: string, proof: ProofInput[], opts?: Parameters<Api['doTenderStep']>[4]) {
    return this.write('doTenderStep', [tenderId, stepId, note, proof, opts ?? {}]);
  }
  confirmTenderNa(tenderId: string, stepId: string, accept: boolean) {
    return this.write('confirmTenderNa', [tenderId, stepId, accept]);
  }
  undoTenderStep(tenderId: string, stepId: string) {
    return this.write('undoTenderStep', [tenderId, stepId]);
  }
  planTenderStep(tenderId: string, stepId: string, pic: string, due: string | null) {
    return this.write('planTenderStep', [tenderId, stepId, pic, due]);
  }
  decideTender(tenderId: string, choice: Parameters<Api['decideTender']>[1], reason: string) {
    return this.write('decideTender', [tenderId, choice, reason]);
  }
  setTenderRecord(tenderId: string, record: Parameters<Api['setTenderRecord']>[1], leadOnly?: boolean) {
    return this.write('setTenderRecord', [tenderId, record, leadOnly]);
  }
  addTenderQuery(tenderId: string, text: string, ref: string) {
    return this.write('addTenderQuery', [tenderId, text, ref]);
  }
  setTenderQuery(tenderId: string, queryId: string, status: Parameters<Api['setTenderQuery']>[2], answer: string) {
    return this.write('setTenderQuery', [tenderId, queryId, status, answer]);
  }
  updateTender(id: string, status: Parameters<Api['updateTender']>[1]) {
    return this.write<Awaited<ReturnType<Api['updateTender']>>>('updateTender', [id, status]);
  }

  issueFirearm(input: Parameters<Api['issueFirearm']>[0]) {
    return this.write<unknown>('issueFirearm', [input]);
  }
  planArmedJob(input: Parameters<Api['planArmedJob']>[0]) {
    return this.write<unknown>('planArmedJob', [input]);
  }
  updateArmedJob(id: string, status: Parameters<Api['updateArmedJob']>[1], note: string) {
    return this.write<unknown>('updateArmedJob', [id, status, note]);
  }
  returnFirearm(movementId: string, input: Parameters<Api['returnFirearm']>[1]) {
    return this.write<{ caseRef: string | null }>('returnFirearm', [{ movementId, ...input }]);
  }
  escalateFirearm(movementId: string) {
    return this.write<Awaited<ReturnType<Api['escalateFirearm']>>>('escalateFirearm', [movementId]);
  }
  countVault(vaultId: string, input: Parameters<Api['countVault']>[1]) {
    return this.write<Awaited<ReturnType<Api['countVault']>>>('countVault', [vaultId, input]);
  }

  async reset() {
    this.log = [];
    writeLog([]);
    this.replayed = false;
    this.boot();
  }
}

