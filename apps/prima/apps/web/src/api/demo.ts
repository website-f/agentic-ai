import { invalidateDutyContext } from '../duty/context';
import { AccessDenied, BadRequest, MemoryStore, NotFound, PrimaService, RuleBlocked, dateOf, fromMs, demoPin, generateDataset, makeTestInhouseKey, sampleLabelToken, type ItemAction, type User, type ClientLostReason, type ProofInput, type ReportDef, testReceiptReader, type FinCloseAction, type FinPackKind, type FinPaymentAction, type FinRequestAction, type CmsServiceKind, ImportError, OrgLinkError, registeredRollouts, withOrgLinks, RULES, type FwPaper, QUALITY_OPS_ACTIONS, demoFwRecruitFiles, type OrgImportReceipt } from '@prima/core';
import { type ExpenseInput, type PdpaCaseInput, type PdpaStepName, type ProductCertInput, type ProductInput, type VehicleRequestInput, type VehicleWorkInput, ApiError, type Api, type CmsSettingsPatch, type FollowUpInput, type LeaveInput, type Me, type PhotoInput, type TenderProtocolInput, type DispatchInput, type DetectionInput, type VideoInput, type PostLogInput, type GateInInput, type NeedsReviewInput, type SiteTaskInput, type DoSiteTaskInput, type ClientCodeInput, type ClientCheckInput, type ClientInspectionInput, type SelfAuditInput, type RbaCommitteeInput, type EthicsInput, type ItEwaste, type FinControlArea, type ArmsRequestAction, type ArmsRequestStepExtra, type AmBuyInput, type RaiseArmsRequestInput, type OfficeDeskInput, type WorkAdjustInput, type WorkReassignInput, type OfficerHoursInput, type CleaningRecordInput, type CleaningSetupInput, type CleaningProofInput, type StockLineInput, type CleaningSlipInput, type ClientWorkAckInput, type GuardTermsInput, type OpportunityInput, type SourceCheckInput, type FwAddFromJaInput, type FwPaperInput, type AmBqActionInput, type PaperReadingResult } from './types';
import type { DisciplineAppealDecision, PolicyCopyInput, StaffLangId } from './types';

const CLEANING_WRITES = new Set(['saveSetup', 'setMap', 'makePlan', 'publish', 'recordTasks', 'recordDelivery', 'receiveDelivery', 'stockCheck', 'recordClientAck', 'saveSiteKit', 'recordSiteKit', 'approveGift', 'recordTakeBack']);

const LOG_KEY = 'prima-demo-log-v1';
const USER_KEY = 'prima-demo-user';
const ALL_STAFF_KEY = 'prima-demo-all-staff';

interface LoggedCall {
  day: string;
  at: string;
  userId: string;
  op: string;
  args: unknown[];
  /** The id of the record this call made, when it made one: later calls in the log that name it are pointed at the
   * record the replay makes, since ids carry a random part. */
  made?: string;
}

const madeId = (out: unknown): string | undefined => {
  const id = out && typeof out === 'object' ? (out as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? id : undefined;
};

/** Replace every string value equal to an id made before the reload with the id the replay made. */
function remap(v: unknown, ids: Map<string, string>): unknown {
  if (typeof v === 'string') return ids.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => remap(x, ids));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x, ids)]));
  return v;
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

/** The hand-over layer's own errors carry their HTTP status. */
function orgError(e: unknown): never {
  if (e instanceof OrgLinkError || e instanceof ImportError) throw new ApiError(e.message, e.status);
  throw e;
}

function toApiError(e: unknown): never {
  if (e instanceof RuleBlocked) throw new ApiError(e.message, 422, e.findings);
  if (e instanceof AccessDenied) throw new ApiError(e.message, 403);
  if (e instanceof NotFound) throw new ApiError(e.message, 404);
  if (e instanceof BadRequest) throw new ApiError(e.message, 400);
  throw e;
}

type Mutations =
  'orgClose' | 'orgRead' | 'orgImport' | 'assign' | 'publish' | 'lockAttendance' | 'clockIn' | 'clockOut' | 'scan' | 'raiseCase' | 'addCasePhoto' | 'startSiteVisit' | 'addVisitPhoto' | 'closeSiteVisit' | 'siteSurveyReceive' | 'siteSurveyPhoto' | 'siteSurveyReview' | 'updateCase' | 'signOffCase' | 'createQuotation' | 'quotationAction' | 'correctQuotation' | 'updateTender' | 'setTenderProtocol' | 'doTenderStep' | 'staffClockIn' | 'registerFace' | 'staffFaceCheck' | 'decideFace' | 'removeFace' | 'addPublicHoliday' | 'removePublicHoliday' | 'setLeaveOverride' | 'setWfhAllowed' | 'requestFlex' | 'decideFlex' | 'recordHrFiling' | 'openHrCase' | 'hrCaseStep' | 'appointOshCoordinator' | 'recordOfficeAssessment' | 'reportOshIncident' | 'recordOshReport' | 'recordTraining' | 'recordGuardPaper' | 'historyLookup' | 'markByLookup' | 'linkExistingRecords' | 'setRehire' | 'linkHistory' | 'separateHistory' | 'addOldEmployment' | 'carryHistoryPaper' | 'openAppraisal' | 'rateAppraisal' | 'commentAppraisal' | 'closeAppraisal' | 'publishPolicy' | 'setStaffOvertime' | 'updateHrLegalCheck' | 'acknowledgePolicy' | 'recordBriefingAcks' | 'addPolicyCopy' | 'setMotherTongue' | 'lodgeDisciplineAppeal' | 'decideDisciplineAppeal' | 'screeningAct' | 'screeningRepeat' | 'decideProbation' | 'raiseVacancy' | 'vacancyStep' | 'advertStep' | 'addApplicant' | 'applicantStep' | 'prepareStaffMovement' | 'staffMovementStep' | 'cancelStaffMovement' | 'applyStaffMovement' | 'authoriseMovementLogin' | 'confirmMovementLogin' | 'applyDueStaffMovements' | 'saveAllowanceType' | 'requestAllowanceChange' | 'eaDraft' | 'employeeRegister' | 'staffSessionStart' | 'acceptConfidentiality' | 'setApprovalLimits' | 'staffSessionEnd' | 'startSocsoClaim' | 'addSocsoDoc' | 'overrideSocsoDoc' | 'advanceSocsoClaim' | 'setSocsoRehab' | 'addSocsoAppointment' | 'addSocsoRestriction' | 'clearSocsoRestriction' | 'addSocsoCheckIn' | 'recordLindung' | 'verifyLindung' | 'addSocsoDependant' | 'addDependantPaper' | 'confirmDependantRoute' | 'recordDeathNotice' | 'addDependantPayment' | 'confirmDependantReceived' | 'assessDosh' | 'recordDoshImmediate' | 'recordDoshForm' | 'recordDoshClientTold' | 'submitFwRenewal' | 'recordFwPaper' | 'ackFwPaper' | 'addFwWorkerFromJa' | 'addFwWorker' | 'createTenderGroup' | 'recordTenderOpportunity' | 'enterTenderOpportunity' | 'addTenderSource' | 'loadTenderSourceStarter' | 'updateTenderSource' | 'recordTenderSourceCheck' | 'uploadHiringDoc' | 'updateHospitalClaim' | 'createFwmTask' | 'doneFwmTask' | 'reviewFwmTask' | 'recordFwCheck' | 'closeFwCheck' | 'openFwRecruitFile' | 'setFwRecruitTravel' | 'recordFwRecruitStep' | 'clearFwRecruitFile' | 'recordFwRecruitArrival' | 'stopFwRecruitFile' | 'addHostelBill' | 'requestHostelPayment' | 'checkHostelBill' | 'approveHostelBill' | 'uploadHostelSlip' | 'decideUtilityCharge' | 'ackUtilityNotice' | 'fileUtilityPaper' | 'submitStaffClaim' | 'addReceipts' | 'receiptAction' | 'headVerifyClaim' | 'prepareStaffPay' | 'setMyZakat' | 'loadStatTable' | 'checkStatTable' | 'setEmployerNos' | 'setFinPack' | 'finCreatePayment' | 'finPaymentStep' | 'finCooStep' | 'finCreateRequest' | 'finRequestStep' | 'finSetSettings' | 'finCloseStep' | 'finControlAction' | 'setMobItem' | 'setCmsService' | 'verifyCmsContact' | 'recordCmsTest' | 'acceptCmsService' | 'approveBranchSettlement' | 'addBranch' | 'branchAct' | 'branchSettlementAct' | 'insuranceClaimAct' | 'raiseItTicket' | 'websiteAction' | 'registerAction' | 'websiteSyncFeed' | 'corpFilingStep' | 'renewalStep' | 'saveCompanyFile' | 'addPanelFirm' | 'panelFirmStep' | 'adviserMoneyStep' | 'addDelegation' | 'delegationStep' | 'addCriticalRole' | 'placeLegalHold' | 'releaseLegalHold' | 'criticalRoleStep' | 'creditCheckLenderLicence' | 'ceoInstruct' | 'checkCompanyFile' | 'runCreditCheck' | 'creditDecide' | 'creditEnforcementStep' | 'creditRepayment' | 'creditChargeLodged' | 'creditStamped' | 'creditCorrectCollateral' | 'creditCorrectRecord' | 'creditDispute' | 'addCreditLoan' | 'corpAuditStep' | 'addSalesLead' | 'postDepreciation' | 'raiseActFinding' | 'actFindingStep' | 'recordActAudit' | 'assignActWork' | 'setActReportForm' | 'setActTiming' | 'recordActFieldCheck' | 'openActInvestigation' | 'addActEvidence' | 'actEvidence' | 'actInvestigationStep' | 'addActImprovement' | 'actImprovementStep' | 'amDisposalStep' | 'amLifeReview' | 'amBqAction' | 'amRecordPayment' | 'arishaSubmit' | 'arishaCommit' | 'arishaResubmit' | 'arishaReturn' | 'saveRecord' | 'decidePayChange' | 'savePayFormula' | 'decidePayFormula' | 'withdrawPayFormula' | 'setPayFormulaUse' | 'approveSiteHours' | 'savePayLaw' | 'setPublicHolidays' | 'amReversePayment' | 'amBankCash' | 'amFollowUp' | 'amDecideLetter' | 'salesLeadStep' | 'addLegalMatter' | 'legalMatterStep' | 'bcmRecord' | 'bcmDrill' | 'recordPdpaDpo' | 'addPdpaRequest' | 'pdpaRequestStep' | 'grcEvidence' | 'grcCheck' | 'recordOshAssessment' | 'submitWhistle' | 'whistleStep' | 'declareGift' | 'decideGift' | 'addGovMandate' | 'govMandateStep' | 'raisePurRequest' | 'purStep' | 'addPurSupplier' | 'purSupplierStep' | 'stockIssue' | 'requestUniform' | 'decideUniformRequest' | 'itemAct' | 'confirmMyItem' | 'handoverStep' | 'setManagementFee' | 'stockReturn' | 'raiseCorpChange' | 'decideCorpChange' | 'recordCorpBoard' | 'itTicketStep' | 'itAct' | 'staffDirectoryAct' | 'setItOnboardingStep' | 'setItTenderItem' | 'setItAsset' | 'itMaintenance' | 'raiseItPurchase' | 'itPurchaseStep' | 'reviewBranchAction' | 'addBranchAgreement' | 'contractStep' | 'contractReview' | 'addContractVariation' | 'addContract' | 'addClientAccount' | 'setStaffPayLine' | 'staffPayStep' | 'staffPayExport' | 'prepareGuardPay' | 'setGuardPayLine' | 'guardPayStep' | 'guardPayExport' | 'guardPayCash' | 'recordPayConsent' | 'approvePayConsent' | 'setStatutory' | 'setGuardAdvances' | 'changeGuardAdvance' | 'approveGuardAdvances' | 'payGuardAdvance' | 'recordGuardLoan' | 'guardLoanStep' | 'cosDecideClaim' | 'hrDecideClaim' | 'cooDecideClaim' | 'financePayClaim' | 'setClaimRate' | 'publishMemo' | 'withdrawMemo' | 'remindMemo' | 'changeMeeting' | 'cancelMeeting' | 'answerMeeting' | 'openPdpaCase' | 'requestVehicle' | 'recordVehicleRental' | 'endVehicleRental' | 'setVehicleRent' | 'moveVehicleUse' | 'setVehicleFuel' | 'addVehicleCard' | 'endVehicleCard' | 'recordFuel' | 'reviewFuel' | 'clientStep' | 'setOfficeDesks' | 'setCompanyRunBy' | 'clientInvoice' | 'clientWorkAck' | 'setInvoicePortal' | 'createClientShareLink' | 'revokeClientShareLink' | 'saveExpense' | 'prefillOfficeRequest' | 'submitExpense' | 'decideExpense' | 'startOffboarding' | 'setClientOwner' | 'addClientPerson' | 'updateClientPerson' | 'addClientRequest' | 'closeClientRequest' | 'decideClientRenewal' | 'sendClientRenewalOffer' | 'answerClientRenewal' | 'clientContact' | 'clientReport' | 'clientRating' | 'clientComplaint' | 'resolveClientComplaint' | 'clientBilling' | 'saveProduct' | 'saveProductCert' | 'decideVehicleRequest' | 'vehicleOut' | 'vehicleIn' | 'recordVehicleWork' | 'fileMonitoringConsent' | 'setStaffPin' | 'closeAccess' | 'pdpaStep' | 'savePdpaRegisterItem' | 'setPdpaSettings' | 'pdpaRegisterStep' | 'recordPdpaConsent' | 'withdrawPdpaConsent' | 'pdpaBreachDetails' | 'recordInsurancePremium' | 'renewInsurancePolicy' | 'cancelInsurancePolicy' | 'readMemo' | 'staffClockOut' | 'staffPing' | 'staffPings' | 'remoteApply' | 'remotePlan' | 'remoteTask' | 'remoteCheckIn' | 'remoteReport' | 'remoteDecide' | 'remoteEnd' | 'remoteReview' | 'requestTimeSlip' | 'cancelTimeSlip' | 'decideTimeSlip' | 'seenTimeSlip' | 'setTimeSlipApprover' | 'workCheckIn' | 'workTaskAdd' | 'workTaskDone' | 'workTaskLate' | 'workTaskReview' | 'workTaskReassign' | 'workTaskAdjust' | 'seenCooNotice' | 'helpAsk' | 'helpAnswer' | 'oneOnOneRecord' | 'playbookSignOff' | 'plannerSync' | 'branchCheckSubmit' | 'branchVisitRecord' | 'confirmTenderNa' | 'undoTenderStep' | 'planTenderStep' | 'decideTender' | 'setTenderRecord' | 'addTenderQuery' | 'setTenderQuery' | 'addTenderPapers' | 'setTenderBidFiles' | 'uploadTenderBidFile' | 'confirmTenderBidFile' | 'draftTenderChecklist' | 'reviewTenderChecklist' | 'verifyTender' | 'submitTender' | 'submitReport' | 'setReportDefs' | 'scheduleMeeting' | 'addMinutes' | 'checkMeetingSummary' | 'setMeetingAction' | 'setMeetingPrep' | 'issueFirearm' | 'returnFirearm' | 'planArmedJob' | 'updateArmedJob' | 'escalateFirearm' | 'countVault' | 'setPatrolInterval' | 'assignCmsShift' | 'updateCmsSettings' | 'setCmsReadinessAnswer' | 'saveCmsReadinessDevice' | 'removeCmsReadinessDevice' | 'reviewCmsReadiness' | 'planCmsRoster' | 'recordCmsHandover' | 'giveCmsHandover' | 'cmsSeatClockIn' | 'cmsSeatClockOut' | 'releaseCmsSeat' | 'logCallback' | 'acknowledgeAlarm' | 'sendDispatch' | 'closeDispatch' | 'cancelDispatch' | 'simulateDetection' | 'dispatchSeen' | 'acknowledgeDispatch' | 'addDispatchPhoto' | 'addDispatchVideo' | 'replyDispatch' | 'addPostLog' | 'gateIn' | 'gateOut' | 'saveNeedsReview' | 'setSiteTask' | 'stopSiteTask' | 'setGateLog' | 'doSiteTask' | 'followUpAttendance' | 'requestLeave' | 'decideLeave' | 'closeAlarm' | 'requestTrip' | 'decideTrip' | 'whistleReview' | 'confirmStockLoss' | 'stockCount' | 'amDecideReversal' | 'reviewFalseAlarm' | 'reviewArmsRequest' | 'armsRequestStep' | 'raiseArmsRequest' | 'setArmsTrading' | 'amBuyRequest' | 'amBuyDecide' | 'amBuyReceived' | 'amBuyReprice' | 'amWhatsAppConsent' | 'amWhatsAppSettle' | 'amQueueRentReminders' | 'recordFwPlacement' | 'endFwPlacement' | 'setFwCostRate' | 'addFwCostLegalNote' | 'draftFwCostMonth' | 'decideFwCostCharges' | 'bookFwCostCharge' | 'askPoliceHelp' | 'assignPoliceHelp' | 'recordPoliceHelpOutcome' | 'answerPoliceHelp' | 'withdrawPoliceHelp' | 'cleaningOp' | 'dutyOp' | 'addMobItem' | 'certifyContractRound' | 'renewContract' | 'linkContractClient' | 'qualityAction' | 'fwStatAct' | 'clientDiligenceAct' | 'siteInstructionsAct' | 'amExtrasAct' | 'jaSwitchAct' | 'jaImportStage' | 'jaSwitchSettings' | 'jaImportDecide' | 'whistleReply' | 'whistleMessage' | 'saveClientCode' | 'stopClientCode' | 'checkClientRequirement' | 'saveClientInspection' | 'fixInspectionLine' | 'saveSelfAudit' | 'nameRbaCommittee' | 'runRbaTrace' | 'settleRbaTraceRow' | 'signEthicsDeclaration' | 'reviewEthicsInterests' | 'fixSelfAuditLine' | 'setClientReport' | 'addShifts' | 'addTender' | 'finAddBankAccount' | 'finStartBooks' | 'finAddPaper' | 'startCompanyFile' | 'addCorpAudit' | 'addBcmSystem' | 'addGrcObligation' | 'addCorpFiling' | 'checkIn' | 'saveCheckinPlace' | 'ownerTestCheckin' | 'setCheckinPlaceActive' | 'setCheckinPolicy' | 'setCheckinRules' | 'decideCheckin' | 'decideClockPhoto' | 'addMeetingAction';

export class DemoApi implements Api {
  async m365Call(): Promise<unknown> { throw new Error('Microsoft integration requires the signed-in server app.'); }
  readonly mode = 'demo' as const;
  // Demo never fabricates access checks or reads a live provider.
  itExtractionStatus(): ReturnType<Api['itExtractionStatus']> { return Promise.resolve({enabled:false,configured:false,permitted:false,sourceTypes:[],dataClasses:[],previewOnly:true}); }
  itExtractionPreview(): ReturnType<Api['itExtractionPreview']> { return Promise.reject(new Error('AI extraction is disabled in demo mode.')); }
  // Suggested drafts are off on the test link: it never calls a model or invents a suggestion.
  draftHelpStatus(): ReturnType<Api['draftHelpStatus']> { return Promise.resolve({ on: false, kinds: [], consentVersion: 'draft-help-v1' }); }
  draftHelpSuggest(): ReturnType<Api['draftHelpSuggest']> { return Promise.reject(new Error('Suggested drafts are not switched on.')); }

  async sharePointRequestPreview(_url: string): Promise<import('./connections').ConnectionRequestPreview> { throw new Error('Connection requests require the signed-in server app.'); }
  async sharePointRequest(_url: string, _requestId: string): Promise<import('./connections').ConnectionRequestReceipt> { throw new Error('Connection requests require the signed-in server app.'); }
  async sharePointRequests(): Promise<Awaited<ReturnType<Api['sharePointRequests']>>> { return {serviceId:'sharepoint',userId:(await this.user()).id,requests:[]}; }

  async sharePointStatus(): ReturnType<Api['sharePointStatus']> { return { serviceId: 'sharepoint', userId: (await this.user()).id, status: 'NotConfigured', sites: [] }; }
  sharePointCheck(): ReturnType<Api['sharePointCheck']> { return Promise.reject(new ApiError('SharePoint is not configured in the demo.', 503, [])); }
  sharePointLibraries(): ReturnType<Api['sharePointLibraries']> { return Promise.reject(new ApiError('SharePoint is not configured in the demo.', 503, [])); }
  sharePointItems(): ReturnType<Api['sharePointItems']> { return Promise.reject(new ApiError('SharePoint is not configured in the demo.', 503, [])); }

  readonly org: import('./types').OrgClient = {
    guide: () => this.read(async (s, u) => s.guideCards(u)),
    inbox: (offset = 0) => this.read((s, u) => s.orgLinks.inbox(u, { offset })).catch(orgError),
    close: (taskId, outcome, note) => this.write<unknown>('orgClose', [taskId, outcome, note]).catch(orgError),
    read: (taskId) => this.write<unknown>('orgRead', [taskId]).catch(orgError),
    map: () => this.read((s, u) => s.orgLinks.map(u)).then((m) => ({ ...m, rollouts: registeredRollouts() })).catch(orgError),
    importTemplate: (kind) => this.read(async (s) => s.orgImport.template(kind)).catch(orgError),
    importPreview: (kind, companyId, csv, opts) => this.read((s, u) => s.orgImport.preview(u, kind, companyId, csv, opts)).catch(orgError),
    importCommit: (kind, companyId, csv, fingerprint, opts) => this.write<OrgImportReceipt>('orgImport', [kind, companyId, csv, fingerprint, opts]).catch(orgError),
    // P90: no AI in the demo build; the in-browser matcher does the work.
    importAiState: async () => ({ on: false }),
    importAiColumns: async () => ({ matches: [], source: 'none' }),
  };

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
      // Test version only: a browser check may open every made-up staff member (not only IT pilot users), to walk
      // through flows such as the time slip as company staff and company heads. Never in the API build.
      if (localStorage.getItem(ALL_STAFF_KEY) === '1') (RULES.pilot.value as { on: boolean }).on = false;
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
    // 40 days of shifts and attendance, so last month's guard pay run has a whole month to count (Fauzan, 5 Nov 2026).
    const ds = generateDataset({ today: dateOf(now), now, daysBack: 40 });
    ds.fwRecruitFiles.push(...demoFwRecruitFiles(dateOf(now), now));
    const store = withOrgLinks(new MemoryStore(ds));
    this.store = store;
    this.booted = new PrimaService(store, () => this.clockOverride ?? this.realNow());
    // Labels made from the request so replaying today's saved actions gives the same labels.
    this.booted.receiptReader = testReceiptReader;
    this.booted.itemLabelMaker = (seed) => sampleLabelToken(`demo:${seed}`);
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
    const ids = new Map<string, string>();
    // A throwaway in-house key, so the test version can seal full visitor details the way the live device does. Only
    // the public half is kept; nothing in the test version can open what it seals.
    try {
      const k = await makeTestInhouseKey('test-inhouse-key');
      this.svc.inhouseKey = { keyId: k.keyId, jwk: k.jwk };
    } catch {
      /* no Web Crypto: devices show that full ID cannot be kept */
    }
    for (const call of this.log) {
      this.clockOverride = call.at;
      try {
        const user = await this.svc.user(call.userId);
        const args = remap(call.args, ids) as unknown[];
        const out = await this.apply(user, call.op as Mutations, args);
        const now = madeId(out);
        if (call.made && now && now !== call.made) ids.set(call.made, now);
        // The log now names the ids this replay made, which the screens show and later calls use.
        call.args = args;
        if (call.made && now) call.made = now;
      } catch {
        /* an action that no longer applies is skipped */
      }
    }
    this.clockOverride = null;
    if (ids.size) writeLog(this.log);
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
      case 'jaSwitchAct':
        return this.svc.jaSwitchAct(u, a[0], a[1], a[2], a[3]);
      case 'jaSwitchSettings':
        return this.svc.jaSwitchSettings(u, a[0]);
      case 'jaImportStage':
        return this.svc.jaImportStage(u, a[0]);
      case 'jaImportDecide':
        return this.svc.jaImportDecide(u, a[0], a[1]);
      case 'assign':
        return this.svc.assignShift(u, a[0], a[1]);
      case 'publish':
        return this.svc.publishRoster(u, a[0], a[1], a[2]);
      case 'addShifts':
        return this.svc.addShifts(u, a[0], a[1]);
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
      case 'siteSurveyReceive':
        return this.svc.siteSurveys.receive(u, a[0]);
      case 'siteSurveyPhoto':
        return this.svc.siteSurveys.addPhoto(u, a[0], { n: a[1], image: a[2] });
      case 'siteSurveyReview':
        return this.svc.siteSurveys.review(u, a[0], a[1], a[2]);
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
      case 'addTender':
        return this.svc.addTender(u, a[0], a[1]);
      case 'correctQuotation':
        return this.svc.correctQuotation(u, a[0], a[1]);
      case 'quotationAction':
        return this.svc.quotationAction(u, a[0], a[1], a[2]);
      case 'updateTender':
        return this.svc.updateTender(u, a[0], a[1]);
      case 'setTenderProtocol':
        return this.svc.setTenderProtocol(u, a[0]);
      case 'doTenderStep':
        return this.svc.doTenderStep(u, a[0], a[1], a[2], a[3], a[4]);
      case 'setApprovalLimits':
        return this.svc.setApprovalLimits(u, args[0] as Record<string, unknown>);
      case 'acceptConfidentiality':
        return this.svc.acceptConfidentiality(u);
      case 'staffSessionStart':
        return this.svc.staffSessionStart(u);
      case 'staffSessionEnd':
        return this.svc.staffSessionEnd(u);
      case 'staffClockIn':
        return this.svc.staffClockIn(u, a[0]);
      case 'registerFace':
        return this.svc.registerFace(u, a[0]);
      case 'staffFaceCheck':
        return this.svc.staffFaceCheck(u, a[0]);
      case 'decideFace':
        return this.svc.decideFace(u, a[0], a[1], a[2]);
      case 'removeFace':
        return this.svc.removeFace(u, a[0], a[1]);
      case 'addPublicHoliday':
        return this.svc.addPublicHoliday(u, a[0]);
      case 'removePublicHoliday':
        return this.svc.removePublicHoliday(u, a[0], a[1]);
      case 'setLeaveOverride':
        return this.svc.setLeaveOverride(u, a[0], a[1], a[2], a[3]);
      case 'setWfhAllowed':
        return this.svc.setWfhAllowed(u, a[0], a[1], a[2]);
      case 'requestFlex':
        return this.svc.requestFlex(u, a[0]);
      case 'decideFlex':
        return this.svc.decideFlex(u, a[0], a[1], a[2]);
      case 'openHrCase':
        return this.svc.openHrCase(u, a[0]);
      case 'hrCaseStep':
        return this.svc.hrCaseStep(u, a[0], a[1]);
      case 'appointOshCoordinator':
        return this.svc.appointOshCoordinator(u, a[0]);
      case 'recordOfficeAssessment':
        return this.svc.recordOfficeAssessment(u, a[0]);
      case 'reportOshIncident':
        return this.svc.reportOshIncident(u, a[0]);
      case 'recordOshReport':
        return this.svc.recordOshReport(u, a[0], a[1]);
      case 'recordTraining':
        return this.svc.recordTraining(u, a[0]);
      case 'recordGuardPaper':
        return this.svc.recordGuardPaper(u, a[0]);
      case 'historyLookup':
        return this.svc.historyLookup(u, a[0]);
      case 'markByLookup':
        return this.svc.markByLookup(u, a[0]);
      case 'linkExistingRecords':
        return this.svc.linkExistingRecords(u);
      case 'setRehire':
        return this.svc.setRehire(u, a[0]);
      case 'linkHistory':
        return this.svc.linkHistory(u, a[0]);
      case 'separateHistory':
        return this.svc.separateHistory(u, a[0]);
      case 'addOldEmployment':
        return this.svc.addOldEmployment(u, a[0]);
      case 'carryHistoryPaper':
        return this.svc.carryHistoryPaper(u, a[0]);
      case 'openAppraisal':
        return this.svc.openAppraisal(u, a[0]);
      case 'rateAppraisal':
        return this.svc.rateAppraisal(u, a[0], a[1]);
      case 'commentAppraisal':
        return this.svc.commentAppraisal(u, a[0], a[1]);
      case 'closeAppraisal':
        return this.svc.closeAppraisal(u, a[0], a[1]);
      case 'publishPolicy':
        return this.svc.publishPolicy(u, a[0]);
      case 'setStaffOvertime':
        return this.svc.setStaffOvertime(u, a[0]);
      case 'updateHrLegalCheck':
        return this.svc.updateHrLegalCheck(u, a[0], a[1]);
      case 'acknowledgePolicy':
        return this.svc.acknowledgePolicy(u, a[0], a[1]);
      case 'recordBriefingAcks':
        return this.svc.recordBriefingAcks(u, a[0], a[1], a[2], a[3]);
      case 'addPolicyCopy':
        return this.svc.addPolicyCopy(u, a[0], a[1]);
      case 'setMotherTongue':
        return this.svc.setMotherTongue(u, a[0], a[1]);
      case 'lodgeDisciplineAppeal':
        return this.svc.lodgeDisciplineAppeal(u, a[0], a[1]);
      case 'decideDisciplineAppeal':
        return this.svc.decideDisciplineAppeal(u, a[0], a[1]);
      case 'screeningAct':
        return this.svc.screening.act(u, a[0], a[1]);
      case 'screeningRepeat':
        return this.svc.screening.repeat(u, a[0]);
      case 'recordHrFiling':
        return this.svc.recordHrFiling(u, a[0]);
      case 'decideProbation':
        return this.svc.decideProbation(u, a[0], a[1], a[2], a[3]);
      case 'raiseVacancy':
        return this.svc.raiseVacancy(u, a[0]);
      case 'vacancyStep':
        return this.svc.vacancyStep(u, a[0], a[1], a[2]);
      case 'advertStep':
        return this.svc.advertStep(u, a[0], a[1], a[2]);
      case 'addApplicant':
        return this.svc.addApplicant(u, a[0], a[1]);
      case 'applicantStep':
        return this.svc.applicantStep(u, a[0], a[1], a[2], a[3]);
      case 'prepareStaffMovement':
        return this.svc.prepareStaffMovement(u, a[0]);
      case 'staffMovementStep':
        return this.svc.staffMovementStep(u, a[0], a[1], a[2]);
      case 'cancelStaffMovement':
        return this.svc.cancelStaffMovement(u, a[0], a[1]);
      case 'authoriseMovementLogin':
        return this.svc.authoriseMovementLogin(u, a[0], a[1], a[2]);
      case 'confirmMovementLogin':
        return this.svc.confirmMovementLogin(u, a[0], a[1]);
      case 'applyStaffMovement':
        return this.svc.applyStaffMovement(u, a[0]);
      case 'applyDueStaffMovements':
        return this.svc.applyDueStaffMovements(u);
      case 'saveAllowanceType':
        return this.svc.saveAllowanceType(u, a[0]);
      case 'requestAllowanceChange':
        return this.svc.requestAllowanceChange(u, a[0], a[1]);
      case 'eaDraft':
        return this.svc.eaDraft(u, a[0], a[1]);
      case 'employeeRegister':
        return this.svc.employeeRegister(u, a[0]);
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
      case 'recordLindung':
        return this.svc.recordLindung(u, a[0], a[1]);
      case 'verifyLindung':
        return this.svc.verifyLindung(u, a[0], a[1], a[2]);
      case 'addSocsoDependant':
        return this.svc.addSocsoDependant(u, a[0], a[1]);
      case 'addDependantPaper':
        return this.svc.addDependantPaper(u, a[0], a[1], a[2], a[3]);
      case 'confirmDependantRoute':
        return this.svc.confirmDependantRoute(u, a[0], a[1], a[2]);
      case 'recordDeathNotice':
        return this.svc.recordDeathNotice(u, a[0], a[1], a[2]);
      case 'addDependantPayment':
        return this.svc.addDependantPayment(u, a[0], a[1]);
      case 'confirmDependantReceived':
        return this.svc.confirmDependantReceived(u, a[0], a[1], a[2]);
      case 'assessDosh':
        return this.svc.assessDosh(u, a[0], a[1], a[2]);
      case 'recordDoshImmediate':
        return this.svc.recordDoshImmediate(u, a[0], a[1]);
      case 'recordDoshForm':
        return this.svc.recordDoshForm(u, a[0], a[1]);
      case 'recordDoshClientTold':
        return this.svc.recordDoshClientTold(u, a[0], a[1]);
      case 'uploadHiringDoc':
        return this.svc.uploadHiringDoc(u, a[0], a[1], a[2]);
      case 'updateHospitalClaim':
        return this.svc.updateHospitalClaim(u, a[0], a[1], a[2]);
      case 'createTenderGroup':
        return this.svc.createTenderGroup(u, a[0], a[1]);
      case 'recordTenderOpportunity':
        return this.svc.recordTenderOpportunity(u, a[0]);
      case 'enterTenderOpportunity':
        return this.svc.enterTenderOpportunity(u, a[0], a[1], a[2]);
      case 'addTenderSource':
        return this.svc.addTenderSource(u, a[0]);
      case 'loadTenderSourceStarter':
        return this.svc.loadTenderSourceStarter(u);
      case 'updateTenderSource':
        return this.svc.updateTenderSource(u, a[0], a[1]);
      case 'recordTenderSourceCheck':
        return this.svc.recordTenderSourceCheck(u, a[0], a[1]);
      case 'submitFwRenewal':
        return this.svc.submitFwRenewal(u, a[0], a[1], a[2], a[3]);
      case 'recordFwPaper':
        return this.svc.recordFwPaper(u, a[0], a[1], a[2], a[3]);
      case 'ackFwPaper':
        return this.svc.ackFwPaper(u, a[0], a[1]);
      case 'addFwWorkerFromJa':
        return this.svc.addFwWorkerFromJa(u, a[0], a[1]);
      case 'addFwWorker':
        return this.svc.addFwWorker(u, a[0]);
      case 'createFwmTask':
        return this.svc.createFwmTask(u, a[0], a[1]);
      case 'doneFwmTask':
        return this.svc.doneFwmTask(u, a[0], a[1], a[2]);
      case 'cleaningOp': {
        const [name, ...rest] = args as [string, ...unknown[]];
        if (!CLEANING_WRITES.has(name)) throw new ApiError('Unknown cleaning action.', 400);
        return (this.svc.cleaning as unknown as Record<string, (u: User, ...x: unknown[]) => Promise<unknown>>)[name](u, ...rest);
      }
      case 'dutyOp': {
        const [name, ...rest] = args as [string, ...unknown[]];
        if (name !== 'publishPosts' && name !== 'publishRoute' && name !== 'saveTerms') throw new ApiError('Unknown duty action.', 400);
        return (this.svc.duty as unknown as Record<string, (u: User, ...x: unknown[]) => Promise<unknown>>)[name](u, ...rest);
      }
      case 'reviewFwmTask':
        return this.svc.reviewFwmTask(u, a[0], a[1], a[2]);
      case 'recordFwCheck':
        return this.svc.recordFwCheck(u, a[0], a[1], a[2]);
      case 'closeFwCheck':
        return this.svc.closeFwCheck(u, a[0], a[1], a[2]);
      case 'openFwRecruitFile':
        return this.svc.openFwRecruitFile(u, a[0]);
      case 'setFwRecruitTravel':
        return this.svc.setFwRecruitTravel(u, a[0], a[1]);
      case 'recordFwRecruitStep':
        return this.svc.recordFwRecruitStep(u, a[0], a[1], a[2], a[3]);
      case 'clearFwRecruitFile':
        return this.svc.clearFwRecruitFile(u, a[0], a[1]);
      case 'recordFwRecruitArrival':
        return this.svc.recordFwRecruitArrival(u, a[0], a[1]);
      case 'stopFwRecruitFile':
        return this.svc.stopFwRecruitFile(u, a[0], a[1]);
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
        return this.svc.approveBranchSettlement(u, a[0], a[1]);
      case 'addBranch':
        return this.svc.addBranch(u, a[0], a[1]);
      case 'branchAct':
        return this.svc.branchAct(u, a[0], a[1], a[2]);
      case 'branchSettlementAct':
        return this.svc.branchSettlementAct(u, a[0], a[1], a[2]);
      case 'insuranceClaimAct':
        return this.svc.insuranceClaimAct(u, a[0], a[1], a[2]);
      case 'runCreditCheck':
        return this.svc.runCreditCheck(u);
      case 'creditDecide':
        return this.svc.creditDecide(u, a[0], a[1], a[2]);
      case 'creditEnforcementStep':
        return this.svc.creditEnforcementStep(u, a[0], a[1], a[2]);
      case 'creditRepayment':
        return this.svc.creditRepayment(u, a[0], a[1], a[2], a[3], a[4]);
      case 'creditStamped':
        return this.svc.creditStamped(u, a[0], a[1], a[2]);
      case 'creditCorrectRecord':
        return this.svc.creditCorrectRecord(u, a[0], a[1]);
      case 'creditCorrectCollateral':
        return this.svc.creditCorrectCollateral(u, a[0], { kind: a[1], agreementRef: a[2], reason: a[3] });
      case 'creditChargeLodged':
        return this.svc.creditChargeLodged(u, a[0], a[1], a[2]);
      case 'creditDispute':
        return this.svc.creditDispute(u, a[0], a[1], a[2]);
      case 'addCreditLoan':
        return this.svc.addCreditLoan(u, a[0], a[1]);
      case 'orgClose':
        return this.svc.orgLinks.close(u, a[0], a[1], a[2]);
      case 'orgRead':
        return this.svc.orgLinks.markRead(u, a[0]);
      case 'orgImport':
        return this.svc.orgImport.commit(u, a[0], a[1], a[2], a[3], a[4]);
      case 'raiseActFinding':
        return this.svc.raiseActFinding(u, a[0]);
      case 'actFindingStep':
        return this.svc.actFindingStep(u, a[0], a[1], a[2]);
      case 'recordActAudit':
        return this.svc.recordActAudit(u, a[0]);
      case 'assignActWork':
        return this.svc.assignActWork(u, a[0]);
      case 'setActReportForm':
        return this.svc.setActReportForm(u, a[0]);
      case 'setActTiming':
        return this.svc.setActTiming(u, a[0]);
      case 'recordActFieldCheck':
        return this.svc.recordActFieldCheck(u, a[0]);
      case 'openActInvestigation':
        return this.svc.openActInvestigation(u, a[0]);
      case 'addActEvidence':
        return this.svc.addActEvidence(u, a[0], a[1]);
      case 'actEvidence':
        return this.svc.actEvidence(u, a[0], a[1]);
      case 'actInvestigationStep':
        return this.svc.actInvestigationStep(u, a[0], a[1]);
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
      case 'amBqAction': {
        const id = a[0] as string;
        const i = a[1] as AmBqActionInput;
        switch (i.kind) {
          case 'brief':
            return this.svc.amBqBrief(u, id, i);
          case 'draft':
            return this.svc.amBqDraft(u, id, i.jobKind, i.measurements);
          case 'save':
            return this.svc.amBqSave(u, id, i);
          case 'submit':
            return this.svc.amBqSubmit(u, id);
          case 'reopen':
            return this.svc.amBqReopen(u, id, i.reason);
          case 'decide':
            return this.svc.amBqDecide(u, id, i.approve, i.note);
          case 'quote':
            return this.svc.amQuoteAdd(u, id, i.quote);
          case 'award':
            return this.svc.amAwardAsk(u, id, i.quoteId, i.reason);
          case 'awardDecide':
            return this.svc.amAwardDecide(u, id, i.approve, i.note);
          case 'vo': {
            const { kind: _k, ...body } = i;
            return this.svc.amVoAsk(u, id, body);
          }
          case 'voWithdraw':
            return this.svc.amVoWithdraw(u, id, i.voId, i.reason);
          case 'voDecide':
            return this.svc.amVoDecide(u, id, i.voId, i.approve, i.note);
        }
        throw new Error("Unknown BQ step.");
      }
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
      case 'savePayFormula':
        return this.svc.savePayFormula(u, a[0]);
      case 'decidePayFormula':
        return this.svc.decidePayFormula(u, a[0], a[1], a[2]);
      case 'withdrawPayFormula':
        return this.svc.withdrawPayFormula(u, a[0]);
      case 'setPayFormulaUse':
        return this.svc.setPayFormulaUse(u, a[0]);
      case 'savePayLaw':
        return this.svc.savePayLaw(u, a[0]);
      case 'approveSiteHours':
        return this.svc.approveSiteHours(u, a[0]);
      case 'setPublicHolidays':
        return this.svc.setPublicHolidays(u, a[0]);
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
      case 'addCorpAudit':
        return this.svc.addCorpAudit(u, a[0], a[1]);
      case 'addBcmSystem':
        return this.svc.addBcmSystem(u, a[0]);
      case 'addGrcObligation':
        return this.svc.addGrcObligation(u, a[0], a[1]);
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
      case 'whistleReply':
        return this.svc.whistleReply(u, a[0], a[1], a[2]);
      case 'whistleMessage':
        return this.svc.whistleMessage(u, a[0], a[1]);
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
      case 'handoverStep':
        return this.svc.handoverStep(u, a[0], a[1], a[2]);
      case 'setManagementFee':
        return this.svc.setManagementFee(u, a[0], a[1]);
      case 'stockIssue':
        return this.svc.stockIssue(u, a[0], a[1]);
      case 'requestUniform':
        return this.svc.requestUniform(u, a[0]);
      case 'decideUniformRequest':
        return this.svc.decideUniformRequest(u, a[0], { ...(a[2] as object), action: a[1] });
      case 'itemAct':
        return this.svc.items.act(u, a[0], a[1]);
      case 'stockReturn':
        return this.svc.stockReturn(u, a[0], a[1], a[2]);
      case 'corpFilingStep':
        return this.svc.corpFilingStep(u, a[0], a[1], a[2]);
      case 'ceoInstruct':
        return this.svc.ceoInstruct(u, a[0]);
      case 'addPanelFirm':
        return this.svc.addPanelFirm(u, a[0]);
      case 'panelFirmStep':
        return this.svc.panelFirmStep(u, a[0], a[1], a[2]);
      case 'adviserMoneyStep':
        return this.svc.adviserMoneyStep(u, a[0], a[1], a[2]);
      case 'addDelegation':
        return this.svc.addDelegation(u, a[0], a[1]);
      case 'delegationStep':
        return this.svc.delegationStep(u, a[0], a[1], a[2], a[3]);
      case 'placeLegalHold':
        return this.svc.placeLegalHold(u, a[0], a[1]);
      case 'releaseLegalHold':
        return this.svc.releaseLegalHold(u, a[0], a[1]);
      case 'addCriticalRole':
        return this.svc.addCriticalRole(u, a[0], a[1]);
      case 'criticalRoleStep':
        return this.svc.criticalRoleStep(u, a[0], a[1], a[2]);
      case 'creditCheckLenderLicence':
        return this.svc.creditCheckLenderLicence(u, a[0], a[1]);
      case 'saveCompanyFile':
        return this.svc.saveCompanyFile(u, a[0], a[1]);
      case 'startCompanyFile':
        return this.svc.startCompanyFile(u, a[0], a[1]);
      case 'checkCompanyFile':
        return this.svc.checkCompanyFile(u, a[0], a[1]);
      case 'renewalStep':
        return this.svc.renewalStep(u, a[0], a[1], a[2]);
      case 'raiseCorpChange':
        return this.svc.raiseCorpChange(u, a[0], a[1]);
      case 'addCorpFiling':
        return this.svc.addCorpFiling(u, a[0], a[1]);
      case 'decideCorpChange':
        return this.svc.decideCorpChange(u, a[0], a[1], a[2], a[3]);
      case 'recordCorpBoard':
        return this.svc.recordCorpBoard(u, a[0], a[1], a[2]);
      case 'registerAction':
        return this.svc.registers.act(u, a[0], a[1]);
      case 'websiteAction':
        return this.svc.websites.act(u, a[0], a[1]);
      case 'websiteSyncFeed':
        return this.svc.websites.syncFromFeed(u, a[0]);
      case 'raiseItTicket':
        return this.svc.raiseItTicket(u, a[0]);
      case 'itTicketStep':
        return this.svc.itTicketStep(u, a[0], a[1], a[2]);
      case 'staffDirectoryAct':
        return this.svc.staffDirectory.act(u, a[0], a[1]);
      case 'itAct':
        return this.svc.itAct(u, a[0], a[1]);
      case 'setItOnboardingStep':
        return this.svc.setItOnboardingStep(u, a[0], a[1], a[2], a[3], a[4]);
      case 'setItTenderItem':
        return this.svc.setItTenderItem(u, a[0], a[1], a[2]);
      case 'setItAsset':
        return this.svc.setItAsset(u, a[0], a[1], a[2], a[3], a[4] ?? null);
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
      case 'setCmsService':
        return this.svc.setCmsService(u, a[0], a[1]);
      case 'verifyCmsContact':
        return this.svc.verifyCmsContact(u, a[0], a[1], a[2], a[3]);
      case 'recordCmsTest':
        return this.svc.recordCmsTest(u, a[0], a[1], a[2], a[3], a[4]);
      case 'acceptCmsService':
        return this.svc.acceptCmsService(u, a[0], a[1], a[2], a[3]);
      case 'setMobItem':
        return this.svc.setMobItem(u, a[0], a[1], a[2], a[3], a[4], a[5]);
      case 'clientDiligenceAct':
        return this.svc.clientQuality.diligenceAct(u, a[1], { ...(a[2] as Record<string, unknown>), accountId: a[0] });
      case 'siteInstructionsAct':
        return this.svc.clientQuality.instructionsAct(u, a[1], { ...(a[2] as Record<string, unknown>), siteId: a[0] });
      case 'addMobItem':
        return this.svc.addMobItem(u, a[0], a[1]);
      case 'certifyContractRound':
        return this.svc.certifyContractRound(u, a[0], a[1], a[2]);
      case 'renewContract':
        return this.svc.renewContract(u, a[0], a[1]);
      case 'linkContractClient':
        return this.svc.linkContractClient(u, a[0], a[1]);
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
        return this.svc.setFinPack(u, a[0], a[1], a[2], a[3], a[4]);
      case 'finCreatePayment':
        return this.svc.finance.createPayment(u, a[0], a[1]);
      case 'finPaymentStep':
        return this.svc.finance.paymentStep(u, a[0], a[1], a[2], a[3]);
      case 'finCloseStep':
        return this.svc.finance.closeStep(u, a[0], a[1], a[2]);
      case 'finAddBankAccount':
        return this.svc.finance.addBankAccount(u, a[0], a[1]);
      case 'finStartBooks':
        return this.svc.finance.startBooks(u, a[0], a[1]);
      case 'finAddPaper':
        return this.svc.addFinPaper(u, a[0], a[1], a[2]);
      case 'finSetSettings':
        return this.svc.finance.setSettings(u, { values: a[0], comment: a[1] });
      case 'finCreateRequest':
        return this.svc.financeRequests.create(u, a[0], a[1]);
      case 'finRequestStep':
        return this.svc.financeRequests.step(u, a[0], a[1], a[2], a[3]);
      case 'finCooStep':
        return this.svc.finance.cooStep(u, a[0], a[1], a[2], a[3]);
      case 'finControlAction': {
        const c = this.svc.financeControls;
        const fn = { payees: c.payeeAction, statements: c.statementAction, ageing: c.ageingAction, figures: c.figuresAction, coa: c.coaAction, sql: c.sqlAction, sst: c.sstAction, plan: c.planAction, einvoice: c.einvoiceAction, ar: c.arAction, bankrec: c.bankRecAction, regular: c.regularAction, guarantees: c.guaranteeAction, tax: c.taxAction, mandates: c.mandateAction, advances: c.advanceAction, petty: c.pettyAction, cards: c.cardAction, billing: c.billingAction, govt: c.govtAction, moneyin: c.moneyInAction, stamp: c.stampAction, dailycash: c.dailyCashAction, exceptionalcash: c.exceptionalCashAction, arrivalcash: c.arrivalCashAction, intercompany: c.icAction, cash13: c.cash13Action, pack: c.packAction, hostel: c.hostelAction, deposits: c.depositAction, fd: c.fdAction, charges: c.chargeAction, wht: c.whtAction, schedules: c.scheduleAction, assets: c.assetAction, audit: c.auditAction, credit: c.creditAction, supstatements: c.supplierStatementAction }[a[1] as 'payees'];
        if (!fn) throw new BadRequest('Unknown area');
        return fn.call(c, u, a[0], a[2], a[3]);
      }
      case 'setMyZakat':
        return this.svc.setMyZakat(u, a[0]);
      case 'loadStatTable':
        return this.svc.loadStatTable(u, a[0]);
      case 'checkStatTable':
        return this.svc.checkStatTable(u, a[0]);
      case 'setEmployerNos':
        return this.svc.setEmployerNos(u, a[0], a[1]);
      case 'prepareStaffPay':
        return this.svc.prepareStaffPay(u, a[0], a[1]);
      case 'setStaffPayLine':
        return this.svc.setStaffPayLine(u, a[0], a[1], a[2]);
      case 'staffPayStep':
        return this.svc.staffPayStep(u, a[0], a[1], a[2]);
      case 'staffPayExport':
        return this.svc.staffPayExport(u, a[0], a[1]);
      case 'prepareGuardPay':
        return this.svc.prepareGuardPay(u, a[0], a[1], a[2] ?? undefined);
      case 'setGuardPayLine':
        return this.svc.setGuardPayLine(u, a[0], a[1], a[2]);
      case 'guardPayStep':
        return this.svc.guardPayStep(u, a[0], a[1], a[2]);
      case 'guardPayExport':
        return this.svc.guardPayExport(u, a[0], a[1]);
      case 'guardPayCash':
        return this.svc.guardPayCash(u, a[0], a[1], a[2], a[3] ?? {});
      case 'recordPayConsent':
        return this.svc.recordPayConsent(u, a[0], a[1]);
      case 'approvePayConsent':
        return this.svc.approvePayConsent(u, a[0], a[1]);
      case 'setStatutory':
        return this.svc.setStatutory(u, a[0]);
      case 'setGuardAdvances':
        return this.svc.setGuardAdvances(u, a[0]);
      case 'changeGuardAdvance':
        return this.svc.changeGuardAdvance(u, a[0], a[1]);
      case 'approveGuardAdvances':
        return this.svc.approveGuardAdvances(u, a[0], a[1]);
      case 'payGuardAdvance':
        return this.svc.payGuardAdvance(u, a[0], a[1]);
      case 'recordGuardLoan':
        return this.svc.recordGuardLoan(u, a[0]);
      case 'guardLoanStep':
        return a[1] === 'decide'
          ? this.svc.decideGuardLoan(u, a[0], a[2])
          : a[1] === 'payout'
            ? this.svc.payOutGuardLoan(u, a[0], a[2])
            : this.svc.cancelGuardLoan(u, a[0], (a[2] as { note?: string } | undefined)?.note ?? '');
      case 'submitStaffClaim':
        return this.svc.submitStaffClaim(u, a[0], a[1]);
      case 'addReceipts':
        return this.svc.addReceipts(u, a[0]).then(async (kept) => {
          for (const r of kept) await this.svc.saveReceiptRead(u, r.id, await this.svc.receiptReader.read(r, this.svc.now()).catch(() => null));
          return kept;
        });
      case 'receiptAction':
        return this.svc.receiptAction(u, a[0], a[1], a[2]);
      case 'headVerifyClaim':
        return this.svc.headVerifyClaim(u, a[0], a[1], a[2]);
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
      case 'clientWorkAck':
        return this.svc.clientWorkAck(u, a[0], a[1]);
      case 'setInvoicePortal':
        return this.svc.setInvoicePortal(u, a[0], a[1]);
      case 'prefillOfficeRequest':
        return this.svc.prefillOfficeRequest(u, a[0]);
      case 'saveExpense':
        return this.svc.saveExpense(u, a[0], a[1]);
      case 'submitExpense':
        return this.svc.submitExpense(u, a[0]);
      case 'decideExpense':
        return this.svc.decideExpense(u, a[0], a[1], a[2]);
      case 'setOfficeDesks':
        return this.svc.setOfficeDesks(u, a[0], { desks: a[1], note: a[2] });
      case 'setCompanyRunBy':
        return this.svc.setCompanyRunBy(u, a[0], { runByCompanyId: a[1], reason: a[2] });
      case 'clientStep':
        return this.svc.clientStep(u, a[0], a[1], a[2], a[3], a[4]);
      case 'startOffboarding':
        return this.svc.startOffboarding(u, a[0], a[1], a[2]);
      case 'setClientOwner':
        return this.svc.setClientOwner(u, a[0], a[1]);
      case 'addClientPerson':
        return this.svc.addClientPerson(u, a[0], a[1]);
      case 'updateClientPerson':
        return this.svc.updateClientPerson(u, a[0], a[1], a[2]);
      case 'addClientRequest':
        return this.svc.addClientRequest(u, a[0], a[1]);
      case 'closeClientRequest':
        return this.svc.closeClientRequest(u, a[0], a[1], a[2]);
      case 'decideClientRenewal':
        return this.svc.decideClientRenewal(u, a[0], a[1]);
      case 'sendClientRenewalOffer':
        return this.svc.sendClientRenewalOffer(u, a[0], a[1]);
      case 'answerClientRenewal':
        return this.svc.answerClientRenewal(u, a[0], a[1]);
      case 'clientContact':
        return this.svc.clientContact(u, a[0], a[1], a[2]);
      case 'clientReport':
        return this.svc.clientReport(u, a[0], a[1], a[2]);
      case 'clientRating':
        return this.svc.clientRating(u, a[0], a[1], a[2], a[3]);
      case 'clientComplaint':
        return this.svc.clientComplaint(u, a[0], a[1]);
      case 'resolveClientComplaint':
        return this.svc.resolveClientComplaint(u, a[0], a[1], a[2], a[3]);
      case 'clientBilling':
        return this.svc.clientBilling(u, a[0], a[1]);
      case 'requestVehicle':
        return this.svc.requestVehicle(u, a[0]);
      case 'recordVehicleRental':
        return this.svc.recordVehicleRental(u, a[0], a[1]);
      case 'endVehicleRental':
        return this.svc.endVehicleRental(u, a[0], a[1]);
      case 'setVehicleRent':
        return this.svc.setVehicleRent(u, a[0], a[1]);
      case 'moveVehicleUse':
        return this.svc.moveVehicleUse(u, a[0], a[1]);
      case 'setVehicleFuel':
        return this.svc.setVehicleFuel(u, a[0], a[1]);
      case 'addVehicleCard':
        return this.svc.addVehicleCard(u, a[0], a[1]);
      case 'endVehicleCard':
        return this.svc.endVehicleCard(u, a[0], a[1], a[2]);
      case 'recordFuel':
        return this.svc.recordFuel(u, a[0], a[1], a[2]);
      case 'reviewFuel':
        return this.svc.reviewFuel(u, a[0], a[1], a[2]);
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
      case 'setPdpaSettings':
        return this.svc.setPdpaSettings(u, a[0], a[1]);
      case 'savePdpaRegisterItem':
        return this.svc.savePdpaRegisterItem(u, a[0], a[1]);
      case 'pdpaRegisterStep':
        return this.svc.pdpaRegisterStep(u, a[0], a[1], a[2]);
      case 'recordPdpaConsent':
        return this.svc.recordPdpaConsent(u, a[0], a[1]);
      case 'withdrawPdpaConsent':
        return this.svc.withdrawPdpaConsent(u, a[0], a[1], a[2]);
      case 'pdpaBreachDetails':
        return this.svc.pdpaBreachDetails(u, a[0], a[1]);
      case 'recordInsurancePremium':
        return this.svc.recordInsurancePremium(u, a[0], a[1]);
      case 'renewInsurancePolicy':
        return this.svc.renewInsurancePolicy(u, a[0], a[1]);
      case 'cancelInsurancePolicy':
        return this.svc.cancelInsurancePolicy(u, a[0], a[1]);
      case 'publishMemo':
        return this.svc.publishMemo(u, a[0], a[1], a[2], a[3], a[4]);
      case 'withdrawMemo':
        return this.svc.withdrawMemo(u, a[0], a[1]);
      case 'remindMemo':
        return this.svc.remindMemo(u, a[0]);
      case 'changeMeeting':
        return this.svc.changeMeeting(u, a[0], a[1]);
      case 'cancelMeeting':
        return this.svc.cancelMeeting(u, a[0], a[1]);
      case 'answerMeeting':
        return this.svc.answerMeeting(u, a[0], a[1], a[2]);
      case 'readMemo':
        return this.svc.readMemo(u, a[0]);
      case 'staffClockOut':
        return this.svc.staffClockOut(u, a[0]);
      case 'staffPing':
        return this.svc.staffPing(u, a[0]);
      case 'staffPings':
        return this.svc.staffPings(u, a[0], a[1]);
      case 'checkIn':
        return this.svc.checkIn(u, a[0], a[1]);
      case 'ownerTestCheckin':
        return a[0] === 'in' ? this.svc.ownerTestCheckins.start(u, a[1], a[1]) : a[0] === 'ping' ? this.svc.ownerTestCheckins.ping(u, a[1]) : this.svc.ownerTestCheckins.end(u, a[1], a[1]);
      case 'saveCheckinPlace':
        return this.svc.saveCheckinPlace(u, a[0]);
      case 'setCheckinPlaceActive':
        return this.svc.setCheckinPlaceActive(u, a[0], a[1]);
      case 'setCheckinPolicy':
        return this.svc.setCheckinPolicy(u, a[0], a[1]);
      case 'setCheckinRules':
        return this.svc.setCheckinRules(u, a[0], a[1]);
      case 'decideCheckin':
        return this.svc.decideCheckin(u, a[0], a[1], a[2]);
      case 'decideClockPhoto':
        return this.svc.decideClockSnap(u, a[0], a[1], a[2]);
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
      case 'requestTimeSlip':
        return this.svc.requestTimeSlip(u, a[0]);
      case 'cancelTimeSlip':
        return this.svc.cancelTimeSlip(u, a[0]);
      case 'decideTimeSlip':
        return this.svc.decideTimeSlip(u, a[0], a[1], a[2]);
      case 'seenTimeSlip':
        return this.svc.seenTimeSlip(u, a[0]);
      case 'setTimeSlipApprover':
        return this.svc.setTimeSlipApprover(u, a[0], a[1]);
      case 'workCheckIn':
        return this.svc.workCheckIn(u, a[0]);
      case 'workTaskAdd':
        return this.svc.workTaskAdd(u, a[0]);
      case 'workTaskDone':
        return this.svc.workTaskDone(u, a[0], a[1]);
      case 'workTaskLate':
        return this.svc.workTaskLate(u, a[0], a[1]);
      case 'workTaskReassign':
        return this.svc.workTaskReassign(u, a[0], a[1]);
      case 'workTaskAdjust':
        return this.svc.workTaskAdjust(u, a[0], a[1]);
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
        return this.svc.confirmTenderNa(u, a[0], a[1], a[2], a[3]);
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
        return this.svc.addMinutes(u, a[0], a[1], a[2]);
      case 'checkMeetingSummary':
        return this.svc.checkMeetingSummary(u, a[0], a[1]);
      case 'setMeetingAction':
        return this.svc.setMeetingAction(u, a[0], a[1], a[2], a[3]);
      case 'addMeetingAction':
        return this.svc.addMeetingAction(u, a[0], a[1]);
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
      case 'setCmsReadinessAnswer':
        return this.svc.setCmsReadinessAnswer(u, a[0], a[1], a[2]);
      case 'saveCmsReadinessDevice':
        return this.svc.saveCmsReadinessDevice(u, a[0], a[1]);
      case 'removeCmsReadinessDevice':
        return this.svc.removeCmsReadinessDevice(u, a[0], a[1], a[2]);
      case 'reviewCmsReadiness':
        return this.svc.reviewCmsReadiness(u, a[0], a[1]);
      case 'planCmsRoster':
        return this.svc.planCmsRoster(u, a[0]);
      case 'recordCmsHandover':
        return this.svc.recordCmsHandover(u, a[0], a[1], a[2] !== false);
      case 'giveCmsHandover':
        return this.svc.giveCmsHandover(u, a[0], a[1]);
      case 'cmsSeatClockIn':
        return this.svc.cmsSeatClockIn(u, a[0]);
      case 'cmsSeatClockOut':
        return this.svc.cmsSeatClockOut(u, a[0], a[1]);
      case 'releaseCmsSeat':
        return this.svc.releaseCmsSeat(u, a[0], a[1]);
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
      case 'sendDispatch':
        return this.svc.sendDispatch(u, a[0]);
      case 'closeDispatch':
        return this.svc.closeDispatch(u, a[0], a[1], a[2]);
      case 'cancelDispatch':
        return this.svc.cancelDispatch(u, a[0], a[1]);
      case 'simulateDetection':
        // Runs as the analytics feed's own system sign-in, as the live feed would.
        return this.svc.user('u-analytics-feed').then((feed) => this.svc.recordAnalyticsDetection(feed, a[0]));
      case 'dispatchSeen':
        return this.svc.dispatchSeen(u, a[0]);
      case 'acknowledgeDispatch':
        return this.svc.acknowledgeDispatch(u, a[0], a[1]);
      case 'addDispatchPhoto':
        return this.svc.addDispatchPhoto(u, a[0], a[1]);
      case 'addDispatchVideo':
        return this.svc.addDispatchVideo(u, a[0], a[1]);
      case 'replyDispatch':
        return this.svc.replyDispatch(u, a[0], a[1]);
      case 'addPostLog':
        return this.svc.addPostLog(u, a[0]);
      case 'gateIn':
        return this.svc.gateIn(u, a[0]);
      case 'gateOut':
        return this.svc.gateOut(u, a[0], a[1]);
      case 'saveNeedsReview':
        return this.svc.saveNeedsReview(u, a[0], a[1]);
      case 'setSiteTask':
        return this.svc.setSiteTask(u, a[0], a[1]);
      case 'setGateLog':
        return this.svc.setGateLog(u, a[0], a[1], a[2]);
      case 'stopSiteTask':
        return this.svc.stopSiteTask(u, a[0], a[1]);
      case 'doSiteTask':
        return this.svc.doSiteTask(u, a[0], a[1]);
      case 'saveClientCode':
        return this.svc.saveClientCode(u, a[0], a[1]);
      case 'setClientReport':
        return this.svc.setClientReport(u, a[0], a[1]);
      case 'stopClientCode':
        return this.svc.stopClientCode(u, a[0], a[1]);
      case 'checkClientRequirement':
        return this.svc.checkClientRequirement(u, a[0], a[1]);
      case 'saveClientInspection':
        return this.svc.saveClientInspection(u, a[0], a[1]);
      case 'fixInspectionLine':
        return this.svc.fixInspectionLine(u, a[0], a[1], a[2]);
      case 'saveSelfAudit':
        return this.svc.saveSelfAudit(u, a[0], a[1]);
      case 'nameRbaCommittee':
        return this.svc.nameRbaCommittee(u, a[0]);
      case 'runRbaTrace':
        return this.svc.runRbaTrace(u, a[0], a[1]);
      case 'settleRbaTraceRow':
        return this.svc.settleRbaTraceRow(u, a[0], a[1], a[2]);
      case 'signEthicsDeclaration':
        return this.svc.signEthicsDeclaration(u, a[0]);
      case 'reviewEthicsInterests':
        return this.svc.reviewEthicsInterests(u, a[0], a[1]);
      case 'fixSelfAuditLine':
        return this.svc.fixSelfAuditLine(u, a[0], a[1], a[2]);
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
      case 'raiseArmsRequest':
        return this.svc.raiseArmsRequest(u, a[0]);
      case 'armsRequestStep':
        return this.svc.armsRequestStep(u, a[0], a[1], a[2], a[3]);
      case 'setArmsTrading':
        return this.svc.setArmsTrading(u, a[0], a[1]);
      case 'amBuyRequest':
        return this.svc.amBuyRequest(u, a[0]);
      case 'amBuyDecide':
        return this.svc.amBuyDecide(u, a[0], a[1], a[2], a[3]);
      case 'amBuyReceived':
        return this.svc.amBuyReceived(u, a[0], a[1]);
      case 'amBuyReprice':
        return this.svc.amBuyReprice(u, a[0], a[1], a[2]);
      case 'amWhatsAppConsent':
        return this.svc.amWhatsAppConsent(u, a[0], a[1], a[2]);
      case 'amWhatsAppSettle':
        return this.svc.amWhatsAppSettle(u, a[0], a[1], a[2], a[3]);
      case 'amQueueRentReminders':
        return this.svc.amQueueRentReminders(u);
      case 'setPatrolInterval':
        return this.svc.setPatrolInterval(u, a[0], a[1]);
      case 'createClientShareLink':
        return this.svc.createClientShareLink(u, a[0], a[1]);
      case 'revokeClientShareLink':
        return this.svc.revokeClientShareLink(u, a[0], a[1], a[2]);
      case 'recordFwPlacement':
        return this.svc.recordFwPlacement(u, a[0], a[1], a[2]);
      case 'endFwPlacement':
        return this.svc.endFwPlacement(u, a[0], a[1]);
      case 'setFwCostRate':
        return this.svc.setFwCostRate(u, a[0]);
      case 'addFwCostLegalNote':
        return this.svc.addFwCostLegalNote(u, a[0]);
      case 'draftFwCostMonth':
        return this.svc.draftFwCostMonth(u, a[0]);
      case 'decideFwCostCharges':
        return this.svc.decideFwCostCharges(u, a[0]);
      case 'bookFwCostCharge':
        return this.svc.bookFwCostCharge(u, a[0], a[1], a[2]);
      case 'askPoliceHelp':
        return this.svc.askPoliceHelp(u, a[0]);
      case 'assignPoliceHelp':
        return this.svc.assignPoliceHelp(u, a[0], a[1]);
      case 'recordPoliceHelpOutcome':
        return this.svc.recordPoliceHelpOutcome(u, a[0], a[1]);
      case 'answerPoliceHelp':
        return this.svc.answerPoliceHelp(u, a[0], a[1], a[2]);
      case 'withdrawPoliceHelp':
        return this.svc.withdrawPoliceHelp(u, a[0], a[1]);
      case 'qualityAction':
        return (QUALITY_OPS_ACTIONS.includes(a[0]) ? this.svc.qualityOps.act(u, a[0], a[1]) : this.svc.quality.act(u, a[0], a[1])) as Promise<unknown>;
      case 'fwStatAct':
        return this.svc.fwStatAct(u, a[0], a[1]);
      case 'amExtrasAct':
        return this.svc.amExtras.act(u, a[0], a[1], a[2], a[3]);
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
      this.log.push({ day: dateOf(now), at: now, userId: u.id, op, args, ...(madeId(out) ? { made: madeId(out) } : {}) });
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
    invalidateDutyContext();
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
  myFace() {
    return this.read((s, u) => s.myFace(u));
  }
  registerFace(input: { photo: string; descriptor: number[] }) {
    return this.write('registerFace', [input]);
  }
  staffFaceCheck(input: Parameters<Api['staffFaceCheck']>[0]) {
    return this.write('staffFaceCheck', [input]);
  }
  // The test version always uses the phone engine; Prima's own engine runs only on the server.
  faceChallenge(): Promise<never> {
    return Promise.reject(new Error('The test version has no server face engine.'));
  }
  staffFaceCheckFrames(): Promise<never> {
    return Promise.reject(new Error('The test version has no server face engine.'));
  }
  faceReviews() {
    return this.read((s, u) => s.faceReviews(u));
  }
  decideFace(personId: string, approve: boolean, note: string) {
    return this.write('decideFace', [personId, approve, note]);
  }
  removeFace(personId: string, note: string) {
    return this.write('removeFace', [personId, note]);
  }
  publicHolidays(year?: string) {
    return this.read((s, u) => s.publicHolidays(u, year));
  }
  addPublicHoliday(input: Parameters<Api['addPublicHoliday']>[0]) {
    return this.write('addPublicHoliday', [input]);
  }
  removePublicHoliday(id: string, note: string) {
    return this.write('removePublicHoliday', [id, note]);
  }
  hrLeaveSettings() {
    return this.read((s, u) => s.hrLeaveSettings(u));
  }
  setLeaveOverride(personId: string, kind: Parameters<Api['setLeaveOverride']>[1], days: number | null, note: string) {
    return this.write('setLeaveOverride', [personId, kind, days, note]);
  }
  setWfhAllowed(personId: string, allow: boolean, note: string) {
    return this.write('setWfhAllowed', [personId, allow, note]);
  }
  flexRequests() {
    return this.read((s, u) => s.flexRequests(u));
  }
  requestFlex(input: Parameters<Api['requestFlex']>[0]) {
    return this.write('requestFlex', [input]);
  }
  decideFlex(id: string, approve: boolean, note: string) {
    return this.write('decideFlex', [id, approve, note]);
  }
  hrCases(personId?: string) {
    return this.read((s, u) => s.hrCases(u, personId));
  }
  openHrCase(input: Parameters<Api['openHrCase']>[0]) {
    return this.write('openHrCase', [input]);
  }
  hrCaseStep(id: string, input: Parameters<Api['hrCaseStep']>[1]) {
    return this.write('hrCaseStep', [id, input]);
  }
  officeOsh() {
    return this.read((s, u) => s.officeOsh(u));
  }
  appointOshCoordinator(input: Parameters<Api['appointOshCoordinator']>[0]) {
    return this.write('appointOshCoordinator', [input]);
  }
  recordOfficeAssessment(input: Parameters<Api['recordOfficeAssessment']>[0]) {
    return this.write('recordOfficeAssessment', [input]);
  }
  reportOshIncident(input: Parameters<Api['reportOshIncident']>[0]) {
    return this.write('reportOshIncident', [input]);
  }
  recordOshReport(id: string, input: Parameters<Api['recordOshReport']>[1]) {
    return this.write('recordOshReport', [id, input]);
  }
  guardTraining() {
    return this.read((s, u) => s.guardTraining(u));
  }
  recordGuardPaper(input: Parameters<Api['recordGuardPaper']>[0]) {
    return this.write('recordGuardPaper', [input]);
  }
  groupHistoryBoard() {
    return this.read((s, u) => s.groupHistoryBoard(u));
  }
  groupHistory(personId: string) {
    return this.read((s, u) => s.groupHistory(u, personId));
  }
  historyLookup(input: Parameters<Api['historyLookup']>[0]) {
    return this.write<Awaited<ReturnType<Api['historyLookup']>>>('historyLookup', [input]);
  }
  markByLookup(input: Parameters<Api['markByLookup']>[0]) {
    return this.write<Awaited<ReturnType<Api['markByLookup']>>>('markByLookup', [input]);
  }
  linkExistingRecords() {
    return this.write<Awaited<ReturnType<Api['linkExistingRecords']>>>('linkExistingRecords', []);
  }
  setRehire(input: Parameters<Api['setRehire']>[0]) {
    return this.write('setRehire', [input]);
  }
  linkHistory(input: Parameters<Api['linkHistory']>[0]) {
    return this.write('linkHistory', [input]);
  }
  separateHistory(input: Parameters<Api['separateHistory']>[0]) {
    return this.write('separateHistory', [input]);
  }
  addOldEmployment(input: Parameters<Api['addOldEmployment']>[0]) {
    return this.write('addOldEmployment', [input]);
  }
  carryHistoryPaper(input: Parameters<Api['carryHistoryPaper']>[0]) {
    return this.write('carryHistoryPaper', [input]);
  }
  trainingRecords(personId?: string) {
    return this.read((s, u) => s.trainingRecords(u, personId));
  }
  recordTraining(input: Parameters<Api['recordTraining']>[0]) {
    return this.write('recordTraining', [input]);
  }
  appraisals() {
    return this.read((s, u) => s.appraisals(u));
  }
  openAppraisal(input: Parameters<Api['openAppraisal']>[0]) {
    return this.write('openAppraisal', [input]);
  }
  rateAppraisal(id: string, input: Parameters<Api['rateAppraisal']>[1]) {
    return this.write('rateAppraisal', [id, input]);
  }
  commentAppraisal(id: string, comment: string) {
    return this.write('commentAppraisal', [id, comment]);
  }
  closeAppraisal(id: string, note: string) {
    return this.write('closeAppraisal', [id, note]);
  }
  hrPolicies() {
    return this.read((s, u) => s.hrPolicies(u));
  }
  publishPolicy(input: Parameters<Api['publishPolicy']>[0]) {
    return this.write('publishPolicy', [input]);
  }
  acknowledgePolicy(id: string, lang?: StaffLangId | null) {
    return this.write('acknowledgePolicy', [id, lang ?? null]);
  }
  recordBriefingAcks(policyId: string, personIds: string[], ref: string, lang?: StaffLangId | null) {
    return this.write<{ recorded: number }>('recordBriefingAcks', [policyId, personIds, ref, lang ?? null]);
  }
  addPolicyCopy(policyId: string, input: PolicyCopyInput) {
    return this.write('addPolicyCopy', [policyId, input]);
  }
  setMotherTongue(personId: string, lang: StaffLangId) {
    return this.write('setMotherTongue', [personId, lang]);
  }
  disciplineAppeals() {
    return this.read((s, u) => s.disciplineAppeals(u));
  }
  lodgeDisciplineAppeal(followUpId: string, input: { grounds: string; lang?: StaffLangId | null }) {
    return this.write('lodgeDisciplineAppeal', [followUpId, input]);
  }
  decideDisciplineAppeal(followUpId: string, input: DisciplineAppealDecision) {
    return this.write('decideDisciplineAppeal', [followUpId, input]);
  }
  screening() {
    return this.read((s, u) => s.screening.board(u));
  }
  screeningAct(action: 'open' | 'check' | 'decide' | 'withdraw' | 'vettingResult' | 'employmentEnded', body: Record<string, unknown>) {
    return this.write('screeningAct', [action, body]);
  }
  screeningRepeat(id: string) {
    return this.write('screeningRepeat', [id]);
  }
  hrLegalChecks() {
    return this.read((s, u) => s.hrLegalChecks(u));
  }
  updateHrLegalCheck(id: string, input: Parameters<Api['updateHrLegalCheck']>[1]) {
    return this.write('updateHrLegalCheck', [id, input]);
  }
  staffOvertime() {
    return this.read((s, u) => s.staffOvertime(u));
  }
  setStaffOvertime(input: Parameters<Api['setStaffOvertime']>[0]) {
    return this.write('setStaffOvertime', [input]);
  }
  overtimePreview(input: Parameters<Api['overtimePreview']>[0]) {
    return this.read((s, u) => s.overtimePreview(u, input));
  }
  hrJoinLeave() {
    return this.read((s, u) => s.hrJoinLeave(u));
  }
  recordHrFiling(input: Parameters<Api['recordHrFiling']>[0]) {
    return this.write('recordHrFiling', [input]);
  }
  eaDraft(companyId: string, year: string) {
    // Writes an audit entry, so it goes through the write path.
    return this.write<Awaited<ReturnType<Api['eaDraft']>>>('eaDraft', [companyId, year]);
  }
  employeeRegister(companyId: string) {
    return this.write<Awaited<ReturnType<Api['employeeRegister']>>>('employeeRegister', [companyId]);
  }
  decideProbation(personId: string, decision: 'confirm' | 'extend', newEndsOn: string | null, note: string) {
    return this.write('decideProbation', [personId, decision, newEndsOn, note]);
  }
  leavingGuide(personId: string) {
    return this.read((s, u) => s.leavingGuide(u, personId));
  }
  vacancies() {
    return this.read((s, u) => s.vacancies(u));
  }
  staffMovements() {
    return this.read((s, u) => s.staffMovements(u));
  }
  prepareStaffMovement(input: Parameters<Api['prepareStaffMovement']>[0]) {
    return this.write('prepareStaffMovement', [input]);
  }
  staffMovementStep(id: string, approve: boolean, note: string) {
    return this.write('staffMovementStep', [id, approve, note]);
  }
  cancelStaffMovement(id: string, note: string) {
    return this.write('cancelStaffMovement', [id, note]);
  }
  authoriseMovementLogin(id: string, approve: boolean, note: string) {
    return this.write('authoriseMovementLogin', [id, approve, note]);
  }
  loginHandovers() {
    return this.read((s, u) => s.loginHandovers(u));
  }
  confirmMovementLogin(id: string, note: string) {
    return this.write('confirmMovementLogin', [id, note]);
  }
  applyStaffMovement(id: string) {
    return this.write('applyStaffMovement', [id]);
  }
  applyDueStaffMovements() {
    return this.write<{ applied: string[]; failed: { id: string; message: string }[] }>('applyDueStaffMovements', []);
  }
  allowanceTypes() {
    return this.read((s, u) => s.allowanceTypes(u));
  }
  saveAllowanceType(input: Parameters<Api['saveAllowanceType']>[0]) {
    return this.write('saveAllowanceType', [input]);
  }
  requestAllowanceChange(personId: string, input: Parameters<Api['requestAllowanceChange']>[1]) {
    return this.write('requestAllowanceChange', [personId, input]);
  }
  raiseVacancy(input: Parameters<Api['raiseVacancy']>[0]) {
    return this.write('raiseVacancy', [input]);
  }
  vacancyStep(id: string, action: Parameters<Api['vacancyStep']>[1], note: string) {
    return this.write('vacancyStep', [id, action, note]);
  }
  advertStep(id: string, action: Parameters<Api['advertStep']>[1], input: Parameters<Api['advertStep']>[2]) {
    return this.write('advertStep', [id, action, input]);
  }
  applicants(vacancyId: string) {
    return this.read((s, u) => s.applicants(u, vacancyId));
  }
  addApplicant(vacancyId: string, input: Parameters<Api['addApplicant']>[1]) {
    return this.write('addApplicant', [vacancyId, input]);
  }
  applicantStep(id: string, status: Parameters<Api['applicantStep']>[1], note: string, interviewAt: string | null) {
    return this.write('applicantStep', [id, status, note, interviewAt]);
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
  staffPings(readings: Parameters<Api['staffPings']>[0], notes?: Parameters<Api['staffPings']>[1]) {
    return this.write<{ accepted: number; skipped: number; notes?: number }>('staffPings', [readings, notes ?? []]);
  }
  clockPhotoReviews() {
    return this.read((s, u) => s.clockSnapReviews(u));
  }
  decideClockPhoto(id: string, decision: 'cleared' | 'upheld', note: string) {
    return this.write('decideClockPhoto', [id, decision, note]);
  }
  // P90: the owner's test check-in.
  myTestCheckins() {
    return this.read((s, u) => s.ownerTestCheckins.mine(u));
  }
  testCheckin(step: 'in' | 'ping' | 'out', fix: Parameters<Api['testCheckin']>[1]) {
    return this.write<unknown>('ownerTestCheckin', [step, fix]);
  }
  // P81: staff check-in by place. The test version has no address lookup (shown as "not looked up").
  myCheckin() {
    return this.read((s, u) => s.myCheckin(u));
  }
  checkinPreview(fix: Parameters<Api['checkinPreview']>[0]) {
    return this.read((s, u) => s.checkinPreview(u, fix));
  }
  checkIn(kind: 'in' | 'out', input: Parameters<Api['checkIn']>[1]) {
    return this.write<Awaited<ReturnType<Api['checkIn']>>>('checkIn', [kind, input]);
  }
  checkinSetup() {
    return this.read((s, u) => s.checkinSetup(u));
  }
  saveCheckinPlace(input: Parameters<Api['saveCheckinPlace']>[0]) {
    return this.write('saveCheckinPlace', [input]);
  }
  setCheckinPlaceActive(id: string, active: boolean) {
    return this.write('setCheckinPlaceActive', [id, active]);
  }
  setCheckinPolicy(companyId: string, outOfArea: Parameters<Api['setCheckinPolicy']>[1]) {
    return this.write('setCheckinPolicy', [companyId, outOfArea]);
  }
  setCheckinRules(userIds: string[], rule: Parameters<Api['setCheckinRules']>[1]) {
    return this.write<{ updated: number }>('setCheckinRules', [userIds, rule]);
  }
  checkinSites(companyId: string) {
    return this.read((s, u) => s.checkinSites(u, companyId));
  }
  checkinDay(date?: string) {
    return this.read((s, u) => s.checkinDay(u, date));
  }
  checkinReviews() {
    return this.read((s, u) => s.checkinReviews(u));
  }
  decideCheckin(id: string, decision: 'cleared' | 'upheld', note: string) {
    return this.write('decideCheckin', [id, decision, note]);
  }
  async geoSearch(_q: string): Promise<{ results: import('./checkin').GeoResult[] }> {
    throw new ApiError('The test version has no address search. Drop the pin on the map instead.', 503);
  }
  async geoReverse(_lat: number, _lng: number) {
    return { address: null, status: 'off' as const };
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
  myTimeSlips() {
    return this.read((s, u) => s.myTimeSlips(u));
  }
  requestTimeSlip(input: { date: string; from: string; to: string; reason: string }) {
    return this.write('requestTimeSlip', [input]);
  }
  cancelTimeSlip(id: string) {
    return this.write('cancelTimeSlip', [id]);
  }
  timeSlipBoard() {
    return this.read((s, u) => s.timeSlipBoard(u));
  }
  decideTimeSlip(id: string, approve: boolean, note: string) {
    return this.write('decideTimeSlip', [id, approve, note]);
  }
  seenTimeSlip(id: string) {
    return this.write('seenTimeSlip', [id]);
  }
  setTimeSlipApprover(approver: 'head' | 'hr', note: string) {
    return this.write('setTimeSlipApprover', [approver, note]);
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
  workRebalance() {
    return this.read((s, u) => s.workRebalance(u));
  }
  workRebalanceAskAi(_adviceId: string): Promise<{ text: string; source: string }> {
    // The test version never calls an AI service.
    return Promise.reject(new Error('Arisha AI is not available in the test version.'));
  }
  workTaskReassign(id: string, input: WorkReassignInput) {
    return this.write('workTaskReassign', [id, input]);
  }
  workTaskAdjust(id: string, input: WorkAdjustInput) {
    return this.write('workTaskAdjust', [id, input]);
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
  workKpi(period?: string) {
    return this.read((s, u) => s.workKpi(u, period));
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
  branchJv(branchId: string) {
    return this.read((s, u) => s.branchJv(u, branchId));
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
  creditStamped(loanId: string, ref: string, on: string) {
    return this.write<unknown>('creditStamped', [loanId, ref, on]);
  }
  creditCorrectRecord(loanId: string, input: Parameters<Api['creditCorrectRecord']>[1]) {
    return this.write<unknown>('creditCorrectRecord', [loanId, input]);
  }
  creditCorrectCollateral(loanId: string, kind: Parameters<Api['creditCorrectCollateral']>[1], agreementRef: string | null, reason: string) {
    return this.write<unknown>('creditCorrectCollateral', [loanId, kind, agreementRef, reason]);
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
  assignActWork(input: Parameters<Api['assignActWork']>[0]) {
    return this.write<unknown>('assignActWork', [input]);
  }
  setActReportForm(input: Parameters<Api['setActReportForm']>[0]) {
    return this.write<unknown>('setActReportForm', [input]);
  }
  setActTiming(input: Parameters<Api['setActTiming']>[0]) {
    return this.write<unknown>('setActTiming', [input]);
  }
  recordActFieldCheck(input: Parameters<Api['recordActFieldCheck']>[0]) {
    return this.write<unknown>('recordActFieldCheck', [input]);
  }
  openActInvestigation(input: Parameters<Api['openActInvestigation']>[0]) {
    return this.write<unknown>('openActInvestigation', [input]);
  }
  addActEvidence(id: string, input: Parameters<Api['addActEvidence']>[1]) {
    return this.write<unknown>('addActEvidence', [id, input]);
  }
  actEvidence(id: string, evidenceId: string) {
    // Viewing is written in the custody log, so it is a logged call.
    return this.write<Awaited<ReturnType<Api['actEvidence']>>>('actEvidence', [id, evidenceId]);
  }
  actInvestigationStep(id: string, input: Parameters<Api['actInvestigationStep']>[1]) {
    return this.write<unknown>('actInvestigationStep', [id, input]);
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
  payFormulaBoard() {
    return this.read((s, u) => s.payFormulaBoard(u));
  }
  payFormulaAt(input: Parameters<Api['payFormulaAt']>[0]) {
    return this.read((s, u) => s.payFormulaAt(u, input));
  }
  savePayFormula(input: Parameters<Api['savePayFormula']>[0]) {
    return this.write<unknown>('savePayFormula', [input]);
  }
  decidePayFormula(id: string, approve: boolean, note: string) {
    return this.write<unknown>('decidePayFormula', [id, approve, note]);
  }
  withdrawPayFormula(id: string) {
    return this.write<unknown>('withdrawPayFormula', [id]);
  }
  setPayFormulaUse(input: Parameters<Api['setPayFormulaUse']>[0]) {
    return this.write<unknown>('setPayFormulaUse', [input]);
  }
  savePayLaw(input: Parameters<Api['savePayLaw']>[0]) {
    return this.write<unknown>('savePayLaw', [input]);
  }
  siteHoursBoard(input: Parameters<Api['siteHoursBoard']>[0]) {
    return this.read((s, u) => s.siteHoursBoard(u, input));
  }
  approveSiteHours(input: Parameters<Api['approveSiteHours']>[0]) {
    return this.write<unknown>('approveSiteHours', [input]);
  }
  publicHolidayBoard(input: Parameters<Api['publicHolidayBoard']>[0]) {
    return this.read((s, u) => s.publicHolidayBoard(u, input));
  }
  setPublicHolidays(input: Parameters<Api['setPublicHolidays']>[0]) {
    return this.write<unknown>('setPublicHolidays', [input]);
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
  amBq(workOrderId: string) {
    return this.read((s, u) => s.amBq(u, workOrderId));
  }
  amBqAction(workOrderId: string, input: AmBqActionInput) {
    // A draft only reads: it is not kept in the test version's change log.
    if (input.kind === 'draft') return this.read((s, u) => s.amBqDraft(u, workOrderId, input.jobKind, input.measurements));
    return this.write<unknown>('amBqAction', [workOrderId, input]);
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
  addCorpAudit(companyId: string, input: Parameters<Api['addCorpAudit']>[1]) {
    return this.write<unknown>('addCorpAudit', [companyId, input]);
  }
  addBcmSystem(input: Parameters<Api['addBcmSystem']>[0]) {
    return this.write<unknown>('addBcmSystem', [input]);
  }
  addGrcObligation(companyId: string, input: Parameters<Api['addGrcObligation']>[1]) {
    return this.write<unknown>('addGrcObligation', [companyId, input]);
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
  whistleReply(code: string, text: string, retaliation: boolean) {
    return this.write<unknown>('whistleReply', [code, text, retaliation]);
  }
  whistleMessage(id: string, text: string) {
    return this.write<unknown>('whistleMessage', [id, text]);
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
  itemBoard() {
    return this.read((s, u) => s.items.board(u));
  }
  itemByLabel(label: string) {
    return this.read((s, u) => s.items.resolve(u, label));
  }
  itemPaper(id: string) {
    return this.read((s, u) => s.items.paperDocument(u, id));
  }
  itemDevicePending(staffNo: string, face: import('@prima/core').FaceCapture | null) {
    return this.read((s, u) => s.items.devicePending(u, staffNo, face));
  }
  itemAct(requestId: string, action: ItemAction) {
    return this.write<{ replay: boolean; result: unknown }>('itemAct', [requestId, action]);
  }
  // P85: reads of the item register. A scan check may note an unknown label for the limiter; that is not replayed.
  itemScanCheck(purpose: Parameters<Api['itemScanCheck']>[0], contextId: string | null, entry: Parameters<Api['itemScanCheck']>[2]) {
    return this.read((s, u) => s.items.scanCheck(u, purpose, contextId, entry));
  }
  itemResolve(code: string) {
    return this.read((s, u) => s.items.resolve(u, code));
  }
  /** P98: the demo has no PDF reader on a server: the screen reads the PDF on this device instead. */
  itemImportRead(_data: string): Promise<import('@prima/core').ReportTable> {
    return Promise.reject(new Error('PDF_READ_LOCAL'));
  }
  itemPassport(itemId: string) {
    return this.read((s, u) => s.items.passport(u, itemId));
  }
  itemLabels(batchId: string) {
    return this.read((s, u) => s.items.labelBatch(u, batchId));
  }
  itemSiteBoard(siteId: string) {
    return this.read((s, u) => s.items.siteBoard(u, siteId));
  }
  itemCount(countId: string) {
    return this.read((s, u) => s.items.countDetail(u, countId));
  }
  itemReport(kind: Parameters<Api['itemReport']>[0], partyId: string | null, format: 'json' | 'csv') {
    return this.read((s, u) => s.items.report(u, kind, partyId, format));
  }
  itemFinance(partyId: string | null) {
    return this.read((s, u) => s.items.finance(u, partyId));
  }
  itemExportFile(batchId: string, name: string) {
    return this.read((s, u) => s.items.batchFile(u, batchId, name));
  }
  raisePurRequest(companyId: string, input: Parameters<Api['raisePurRequest']>[1]) {
    return this.write<unknown>('raisePurRequest', [companyId, input]);
  }
  myItems() {
    return this.read((s, u) => s.myItems(u));
  }
  deliveryProof(issueId: string) {
    return this.read((s, u) => s.deliveryProof(u, issueId));
  }
  confirmMyItem(id: string, received: boolean, note: string) {
    return this.write<unknown>('confirmMyItem', [id, received, note]);
  }
  handoverStep(id: string, step: Parameters<Api['handoverStep']>[1], input: Parameters<Api['handoverStep']>[2]) {
    return this.write<unknown>('handoverStep', [id, step, input]);
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
  uniformRequests() {
    return this.read((s, u) => s.uniformRequests(u));
  }
  requestUniform(input: Parameters<Api['requestUniform']>[0]) {
    return this.write<unknown>('requestUniform', [input]);
  }
  decideUniformRequest(id: string, action: Parameters<Api['decideUniformRequest']>[1], input: Parameters<Api['decideUniformRequest']>[2]) {
    return this.write<unknown>('decideUniformRequest', [id, action, input]);
  }
  ceoInstructions() {
    return this.read((s, u) => s.ceoInstructions(u));
  }
  ceoInstruct(input: Parameters<Api['ceoInstruct']>[0]) {
    return this.write<unknown>('ceoInstruct', [input]);
  }
  directorLegalFlags() {
    return this.read((s, u) => s.directorLegalFlags(u));
  }
  directorDigest() {
    return this.read((s, u) => s.directorDigest(u));
  }
  panelBoard() {
    return this.read((s, u) => s.panelBoard(u));
  }
  addPanelFirm(input: Parameters<Api['addPanelFirm']>[0]) {
    return this.write<unknown>('addPanelFirm', [input]);
  }
  panelFirmStep(id: string, action: 'review' | 'remove', note: string) {
    return this.write<unknown>('panelFirmStep', [id, action, note]);
  }
  adviserMoneyStep(id: string, action: Parameters<Api['adviserMoneyStep']>[1], body: Parameters<Api['adviserMoneyStep']>[2]) {
    return this.write<unknown>('adviserMoneyStep', [id, action, body]);
  }
  delegationBoard() {
    return this.read((s, u) => s.delegationBoard(u));
  }
  addDelegation(companyId: string, input: Parameters<Api['addDelegation']>[1]) {
    return this.write<unknown>('addDelegation', [companyId, input]);
  }
  delegationStep(id: string, action: Parameters<Api['delegationStep']>[1], note: string, body?: Parameters<Api['delegationStep']>[3]) {
    return this.write<unknown>('delegationStep', [id, action, note, body ?? {}]);
  }
  legalHoldBoard() {
    return this.read((s, u) => s.legalHoldBoard(u));
  }
  placeLegalHold(matterId: string, input: Parameters<Api['placeLegalHold']>[1]) {
    return this.write<unknown>('placeLegalHold', [matterId, input]);
  }
  releaseLegalHold(id: string, reason: string) {
    return this.write<unknown>('releaseLegalHold', [id, reason]);
  }
  addCriticalRole(companyId: string, input: Parameters<Api['addCriticalRole']>[1]) {
    return this.write<unknown>('addCriticalRole', [companyId, input]);
  }
  criticalRoleStep(id: string, action: 'review' | 'retire', body: Parameters<Api['criticalRoleStep']>[2]) {
    return this.write<unknown>('criticalRoleStep', [id, action, body]);
  }
  creditCheckLenderLicence(loanId: string, input: Parameters<Api['creditCheckLenderLicence']>[1]) {
    return this.write<unknown>('creditCheckLenderLicence', [loanId, input]);
  }
  companyFiles() {
    return this.read((s, u) => s.companyFiles(u));
  }
  saveCompanyFile(companyId: string, input: Parameters<Api['saveCompanyFile']>[1]) {
    return this.write<unknown>('saveCompanyFile', [companyId, input]);
  }
  startCompanyFile(companyId: string, input: Parameters<Api['startCompanyFile']>[1]) {
    return this.write<unknown>('startCompanyFile', [companyId, input]);
  }
  checkCompanyFile(companyId: string, input: Parameters<Api['checkCompanyFile']>[1]) {
    return this.write<unknown>('checkCompanyFile', [companyId, input]);
  }
  corpBoard() {
    return this.read((s, u) => s.corpBoard(u));
  }
  renewalBoard() {
    return this.read((s, u) => s.renewalBoard(u));
  }
  renewalStep(id: string, action: Parameters<Api['renewalStep']>[1], body: Parameters<Api['renewalStep']>[2] = {}) {
    return this.write<unknown>('renewalStep', [id, action, body]);
  }
  corpFilingStep(id: string, action: 'prepare' | 'lodge' | 'receipt', body: { ref?: string; on?: string }) {
    return this.write<unknown>('corpFilingStep', [id, action, body]);
  }
  raiseCorpChange(companyId: string, input: Parameters<Api['raiseCorpChange']>[1]) {
    return this.write<unknown>('raiseCorpChange', [companyId, input]);
  }
  addCorpFiling(companyId: string, input: Parameters<Api['addCorpFiling']>[1]) {
    return this.write<unknown>('addCorpFiling', [companyId, input]);
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
  registerBoard() {
    return this.read((s, u) => s.registers.board(u));
  }
  registerAction(action: string, input: Record<string, unknown>) {
    return this.write<unknown>('registerAction', [action, input]);
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
  // Demo only: mock data in this browser. The screen asks for dummy rows here.
  staffDirectoryStatus() {
    return Promise.resolve({ enabled: true, ready: true });
  }
  staffDirectory() {
    return this.read((s, u) => s.staffDirectory.board(u));
  }
  staffDirectoryAct(action: 'preview' | 'submit' | 'decide' | 'addOne', input: Record<string, unknown>) {
    return action === 'preview' ? this.read((s, u) => s.staffDirectory.act(u, action, input)) : this.write<unknown>('staffDirectoryAct', [action, input]);
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
  setItAsset(id: string, status: Parameters<Api['setItAsset']>[1], assignedTo: string | null, note: string, ewaste?: ItEwaste | null) {
    return this.write<unknown>('setItAsset', [id, status, assignedTo, note, ewaste ?? null]);
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
  approveBranchSettlement(id: string, note: string) {
    return this.write<unknown>('approveBranchSettlement', [id, note]);
  }
  addBranch(companyId: string, input: { name: string; state: string; model: 'A' | 'B' | 'C' }) {
    return this.write<unknown>('addBranch', [companyId, input]);
  }
  branchLeadClaims(companyId: string) {
    return this.read((s, u) => s.branchLeadClaims(u, companyId));
  }
  branchAct(branchId: string, action: string, body: Record<string, unknown>) {
    return this.write<unknown>('branchAct', [branchId, action, body]);
  }
  insuranceClaimAct(claimId: string, action: string, body: Record<string, unknown>) {
    return this.write<unknown>('insuranceClaimAct', [claimId, action, body]);
  }
  branchSettlementAct(id: string, action: 'approve' | 'return' | 'validate' | 'paid', body: Record<string, unknown>) {
    return this.write<unknown>('branchSettlementAct', [id, action, body]);
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
  setCmsService(contractId: string, input: Parameters<Api['setCmsService']>[1]) {
    return this.write<unknown>('setCmsService', [contractId, input]);
  }
  recordCmsTest(contractId: string, version: number, service: CmsServiceKind, siteId: string, note: string) {
    return this.write<unknown>('recordCmsTest', [contractId, version, service, siteId, note]);
  }
  verifyCmsContact(contractId: string, index: number, version: number, note: string) {
    return this.write<unknown>('verifyCmsContact', [contractId, index, version, note]);
  }
  acceptCmsService(contractId: string, who: 'operator' | 'client', version: number, input: { note?: string; clientName?: string; ref?: string }) {
    return this.write<unknown>('acceptCmsService', [contractId, who, version, input]);
  }
  cmsCommissioning() {
    return this.read((s, u) => s.cmsCommissioning(u));
  }
  setMobItem(id: string, itemId: string, status: 'open' | 'done' | 'risk_accepted', note: string, acceptedUntil: string | null, proof: ProofInput[] = []) {
    return this.write<unknown>('setMobItem', [id, itemId, status, note, acceptedUntil, proof]);
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
  setFinPack(companyId: string, pack: FinPackKind, itemId: string, status: 'todo' | 'prepared' | 'reviewed' | 'sent', comment?: string) {
    return this.write<unknown>('setFinPack', [companyId, pack, itemId, status, comment]);
  }
  finDesk() {
    return this.read((s, u) => s.finance.desk(u));
  }
  financeToday() {
    return this.read((s, u) => s.financeToday(u));
  }
  finExceptionalCashEvidence(companyId: string, docId: string) {
    return this.read((s, u) => s.financeControls.exceptionalCashEvidence(u, companyId, docId));
  }
  finArrivalCashEvidence(companyId: string, docId: string) { return this.read((s,u)=>s.financeControls.arrivalCashEvidence(u,companyId,docId)); }
  finArrivalCash(companyId: string) { return this.read((s,u)=>s.financeControls.arrivalCashView(u,companyId)); }
  finExceptionalCash(companyId: string) {
    return this.read((s, u) => s.financeControls.exceptionalCashView(u, companyId));
  }
  finDailyCashMine() {
    return this.read((s, u) => s.financeControls.dailyCashMine(u));
  }
  finCashMine() {
    return this.read((s, u) => s.financeControls.cashMine(u));
  }
  finAdvancesOverdue() {
    return this.read((s, u) => s.financeControls.advancesForHr(u));
  }
  finCreatePayment(companyId: string, input: Record<string, unknown>) {
    return this.write<unknown>('finCreatePayment', [companyId, input]);
  }
  finSettings() {
    return this.read((s, u) => s.finance.settingsView(u));
  }
  finKpi(period?: string) {
    return this.read((s, u) => s.financeKpi.view(u, period));
  }
  finSetSettings(values: Record<string, unknown>, comment: string) {
    return this.write<unknown>('finSetSettings', [values, comment]);
  }
  finRequests() {
    return this.read((s, u) => s.financeRequests.list(u));
  }
  finCreateRequest(companyId: string, input: Record<string, unknown>) {
    return this.write<unknown>('finCreateRequest', [companyId, input]);
  }
  finRequestStep(companyId: string, requestId: string, action: FinRequestAction, input: Record<string, unknown>) {
    return this.write<unknown>('finRequestStep', [companyId, requestId, action, input]);
  }
  finCooDesk() {
    return this.read((s, u) => s.finance.cooDesk(u));
  }
  finCooStep(companyId: string, paymentId: string, action: 'approve' | 'return', input: Record<string, unknown>) {
    return this.write<unknown>('finCooStep', [companyId, paymentId, action, input]);
  }
  finPaymentStep(companyId: string, paymentId: string, action: FinPaymentAction, input: Record<string, unknown>) {
    return this.write<unknown>('finPaymentStep', [companyId, paymentId, action, input]);
  }
  finCloseStep(companyId: string, action: FinCloseAction, input: Record<string, unknown>) {
    return this.write<unknown>('finCloseStep', [companyId, action, input]);
  }
  finAddBankAccount(companyId: string, input: { bank: string; last4: string; purpose: string }) {
    return this.write<unknown>('finAddBankAccount', [companyId, input]);
  }
  finStartBooks(companyId: string, input: { team: number; fyEnd: string }) {
    return this.write<unknown>('finStartBooks', [companyId, input]);
  }
  finAddPaper(companyId: string, pack: 'audit' | 'tax', input: { label: string; dueOn: string }) {
    return this.write<unknown>('finAddPaper', [companyId, pack, input]);
  }
  finDashboard() {
    return this.read((s, u) => s.financeControls.dashboard(u));
  }
  finChecksTodo() {
    return this.read((s, u) => s.financeControls.checksTodo(u));
  }
  finPack(companyId: string, period?: string) {
    return this.read((s, u) => s.financeControls.pack(u, companyId, period));
  }
  finControls(companyId: string, billPeriod?: string) {
    return this.read((s, u) => s.financeControls.view(u, companyId, billPeriod));
  }
  finControlAction(companyId: string, area: FinControlArea, action: string, input: Record<string, unknown>) {
    return this.write<unknown>('finControlAction', [companyId, area, action, input]);
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
  myZakat() {
    return this.read((s, u) => s.myZakat(u));
  }
  setMyZakat(input: { body: string | null; percent?: number }) {
    return this.write<unknown>('setMyZakat', [input]);
  }
  statTables(period?: string) {
    return this.read((s, u) => s.statTables(u, period));
  }
  loadStatTable(input: Parameters<Api['loadStatTable']>[0]) {
    return this.write<Awaited<ReturnType<Api['loadStatTable']>>>('loadStatTable', [input]);
  }
  checkStatTable(input: Parameters<Api['checkStatTable']>[0]) {
    return this.write<unknown>('checkStatTable', [input]);
  }
  setEmployerNos(companyId: string, input: Parameters<Api['setEmployerNos']>[1]) {
    return this.write<unknown>('setEmployerNos', [companyId, input]);
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
  guardPayroll() {
    return this.read((s, u) => s.guardPayroll(u));
  }
  guardPayRun(runId: string) {
    return this.read((s, u) => s.guardPayRun(u, runId));
  }
  myGuardPayslips() {
    return this.read((s, u) => s.myGuardPayslips(u));
  }
  prepareGuardPay(companyId: string, period: string, holidays?: { date: string; label: string }[]) {
    return this.write<unknown>('prepareGuardPay', [companyId, period, holidays]);
  }
  setGuardPayLine(runId: string, personId: string, patch: Parameters<Api['setGuardPayLine']>[2]) {
    return this.write<unknown>('setGuardPayLine', [runId, personId, patch]);
  }
  guardPayStep(runId: string, action: Parameters<Api['guardPayStep']>[1], body: Parameters<Api['guardPayStep']>[2]) {
    return this.write<unknown>('guardPayStep', [runId, action, body]);
  }
  guardPayExport(runId: string, kind: Parameters<Api['guardPayExport']>[1]) {
    return this.write<Awaited<ReturnType<Api['guardPayExport']>>>('guardPayExport', [runId, kind]);
  }
  guardPayCash(runId: string, personId: string, action: Parameters<Api['guardPayCash']>[2], body: Parameters<Api['guardPayCash']>[3]) {
    return this.write<unknown>('guardPayCash', [runId, personId, action, body]);
  }
  recordPayConsent(personId: string, body: Parameters<Api['recordPayConsent']>[1]) {
    return this.write<unknown>('recordPayConsent', [personId, body]);
  }
  statutoryBoard() {
    return this.read((s, u) => s.statutoryBoard(u));
  }
  setStatutory(body: Parameters<Api['setStatutory']>[0]) {
    return this.write<unknown>('setStatutory', [body]);
  }
  payConsentsWaiting() {
    return this.read((s, u) => s.payConsentsWaiting(u));
  }
  approvePayConsent(personId: string, note: string) {
    return this.write<unknown>('approvePayConsent', [personId, note]);
  }
  guardAdvances(input: Parameters<Api['guardAdvances']>[0]) {
    return this.read((s, u) => s.guardAdvances(u, input));
  }
  setGuardAdvances(body: Parameters<Api['setGuardAdvances']>[0]) {
    return this.write<Awaited<ReturnType<Api['setGuardAdvances']>>>('setGuardAdvances', [body]);
  }
  changeGuardAdvance(id: string, body: Parameters<Api['changeGuardAdvance']>[1]) {
    return this.write<unknown>('changeGuardAdvance', [id, body]);
  }
  approveGuardAdvances(ids: string[], note: string) {
    return this.write<unknown>('approveGuardAdvances', [ids, note]);
  }
  payGuardAdvance(id: string, body: Parameters<Api['payGuardAdvance']>[1]) {
    return this.write<unknown>('payGuardAdvance', [id, body]);
  }
  guardLoans(input: Parameters<Api['guardLoans']>[0]) {
    return this.read((s, u) => s.guardLoans(u, input));
  }
  recordGuardLoan(body: Parameters<Api['recordGuardLoan']>[0]) {
    return this.write<unknown>('recordGuardLoan', [body]);
  }
  guardLoanStep(id: string, action: Parameters<Api['guardLoanStep']>[1], body: Parameters<Api['guardLoanStep']>[2]) {
    return this.write<unknown>('guardLoanStep', [id, action, body]);
  }
  submitStaffClaim(input: Parameters<Api['submitStaffClaim']>[0], proof: ProofInput[]) {
    return this.write<unknown>('submitStaffClaim', [input, proof]);
  }
  myReceipts() {
    return this.read((s, u) => s.myReceipts(u));
  }
  addReceipts(proof: ProofInput[]) {
    return this.write<unknown>('addReceipts', [proof]);
  }
  receiptAction(id: string, action: 'confirm' | 'remove', input: Parameters<Api['receiptAction']>[2]) {
    return this.write<unknown>('receiptAction', [id, action, input]);
  }
  headVerifyClaim(claimId: string, ok: boolean, note: string) {
    return this.write<unknown>('headVerifyClaim', [claimId, ok, note]);
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
  clientWorkAck(accountId: string, input: ClientWorkAckInput) {
    return this.write<unknown>('clientWorkAck', [accountId, input]);
  }
  setInvoicePortal(accountId: string, portal: string | null) {
    return this.write<unknown>('setInvoicePortal', [accountId, portal]);
  }
  // The test build has no server, so a link cannot be opened from outside: staff use Preview to see the client page.
  clientShareLinks(accountId: string) {
    return this.read(async (s, u) => ({ ...(await s.clientShareLinks(u, accountId)), linksOn: true }));
  }
  async createClientShareLink(accountId: string, input: { recipient: string; from: string; to: string; days: number }) {
    const r = await this.write<{ link: import('@prima/core').ClientShareLink }>('createClientShareLink', [accountId, input]);
    return { link: r.link, url: null };
  }
  revokeClientShareLink(accountId: string, linkId: string, reason: string) {
    return this.write<unknown>('revokeClientShareLink', [accountId, linkId, reason]);
  }
  previewClientShareLink(accountId: string, linkId: string) {
    return this.read((s, u) => s.clientShareReport(null, accountId, linkId, u));
  }
  expenseBoard() {
    return this.read((s, u) => s.expenseBoard(u));
  }
  prefillOfficeRequest(input: Parameters<Api['prefillOfficeRequest']>[0]) {
    return this.write<unknown>('prefillOfficeRequest', [input]);
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
  companyOffice(companyId: string) {
    return this.read((s, u) => s.companyOffice(u, companyId));
  }
  companyOffices() {
    return this.read((s, u) => s.companyOffices(u));
  }
  setOfficeDesks(companyId: string, desks: OfficeDeskInput[], note: string) {
    return this.write<unknown>('setOfficeDesks', [companyId, desks, note]);
  }
  setCompanyRunBy(companyId: string, runByCompanyId: string | null, reason: string) {
    return this.write<unknown>('setCompanyRunBy', [companyId, runByCompanyId, reason]);
  }
  clientBoard() {
    return this.read((s, u) => s.clientBoard(u));
  }
  clientStep(accountId: string, phase: 'onboarding' | 'offboarding', key: string, note: string, proof: ProofInput[]) {
    return this.write<unknown>('clientStep', [accountId, phase, key, note, proof]);
  }
  startOffboarding(accountId: string, reason: string, lost?: { reason: ClientLostReason; winBackOn?: string | null }) {
    return this.write<unknown>('startOffboarding', [accountId, reason, lost]);
  }
  crmBoard() {
    return this.read((s, u) => s.crmBoard(u));
  }
  clientDiligence(accountId: string) {
    return this.read((s, u) => s.clientQuality.diligence(u, accountId));
  }
  clientDiligenceAct(accountId: string, action: 'start' | 'check' | 'decide', body: Record<string, unknown>) {
    return this.write<Awaited<ReturnType<Api['clientDiligenceAct']>>>('clientDiligenceAct', [accountId, action, body]);
  }
  siteInstructions(siteId: string) {
    return this.read((s, u) => s.clientQuality.siteInstructions(u, siteId));
  }
  siteInstructionsAct(siteId: string, action: 'save' | 'client_signed', body: Record<string, unknown>) {
    return this.write<Awaited<ReturnType<Api['siteInstructionsAct']>>>('siteInstructionsAct', [siteId, action, body]);
  }
  crmClient(accountId: string) {
    return this.read((s, u) => s.crmClient(u, accountId));
  }
  setClientOwner(accountId: string, userId: string) {
    return this.write<unknown>('setClientOwner', [accountId, userId]);
  }
  addClientPerson(accountId: string, input: Parameters<Api['addClientPerson']>[1]) {
    return this.write<unknown>('addClientPerson', [accountId, input]);
  }
  updateClientPerson(accountId: string, personId: string, action: 'remove' | 'main') {
    return this.write<unknown>('updateClientPerson', [accountId, personId, action]);
  }
  addClientRequest(accountId: string, input: Parameters<Api['addClientRequest']>[1]) {
    return this.write<unknown>('addClientRequest', [accountId, input]);
  }
  closeClientRequest(accountId: string, requestId: string, input: Parameters<Api['closeClientRequest']>[2]) {
    return this.write<unknown>('closeClientRequest', [accountId, requestId, input]);
  }
  decideClientRenewal(accountId: string, input: Parameters<Api['decideClientRenewal']>[1]) {
    return this.write<unknown>('decideClientRenewal', [accountId, input]);
  }
  sendClientRenewalOffer(accountId: string, proof: ProofInput[]) {
    return this.write<unknown>('sendClientRenewalOffer', [accountId, proof]);
  }
  answerClientRenewal(accountId: string, input: Parameters<Api['answerClientRenewal']>[1]) {
    return this.write<unknown>('answerClientRenewal', [accountId, input]);
  }
  clientContact(accountId: string, kind: 'visit' | 'meeting' | 'call', note: string) {
    return this.write<unknown>('clientContact', [accountId, kind, note]);
  }
  clientReport(accountId: string, period: string, proof: ProofInput[]) {
    return this.write<unknown>('clientReport', [accountId, period, proof]);
  }
  clientRating(accountId: string, score: number, comment: string, input: { from: string; via: 'meeting' | 'visit' | 'call' | 'email' | 'form'; proof?: ProofInput[] }) {
    return this.write<unknown>('clientRating', [accountId, score, comment, input]);
  }
  clientComplaint(accountId: string, input: { from: string; via: 'meeting' | 'visit' | 'call' | 'email' | 'form'; what: string; siteId?: string | null; proof?: ProofInput[] }) {
    return this.write<unknown>('clientComplaint', [accountId, input]);
  }
  resolveClientComplaint(accountId: string, complaintId: string, resolution: string, proof: ProofInput[] = []) {
    return this.write<unknown>('resolveClientComplaint', [accountId, complaintId, resolution, proof]);
  }
  clientBilling(accountId: string, input: { invoicedTo: string | null; overdueAmount: number; overdueDays: number }) {
    return this.write<unknown>('clientBilling', [accountId, input]);
  }
  fleetBoard() {
    return this.read((s, u) => s.fleetBoard(u));
  }
  vehicleRentals(month?: string) {
    return this.read((s, u) => s.vehicleRentals(u, month));
  }
  recordVehicleRental(vehicleId: string, input: Parameters<Api['recordVehicleRental']>[1]) {
    return this.write<unknown>('recordVehicleRental', [vehicleId, input]);
  }
  endVehicleRental(vehicleId: string, input: Parameters<Api['endVehicleRental']>[1]) {
    return this.write<unknown>('endVehicleRental', [vehicleId, input]);
  }
  moveVehicleUse(vehicleId: string, input: Parameters<Api['moveVehicleUse']>[1]) {
    return this.write<unknown>('moveVehicleUse', [vehicleId, input]);
  }
  setVehicleRent(vehicleId: string, input: Parameters<Api['setVehicleRent']>[1]) {
    return this.write<unknown>('setVehicleRent', [vehicleId, input]);
  }
  vehicleUsage(month?: string) {
    return this.read((s, u) => s.vehicleUsage(u, month));
  }
  setVehicleFuel(vehicleId: string, input: Parameters<Api['setVehicleFuel']>[1]) {
    return this.write<unknown>('setVehicleFuel', [vehicleId, input]);
  }
  addVehicleCard(vehicleId: string, input: Parameters<Api['addVehicleCard']>[1]) {
    return this.write<unknown>('addVehicleCard', [vehicleId, input]);
  }
  endVehicleCard(vehicleId: string, cardId: string, input: { on: string; reason: string }) {
    return this.write<unknown>('endVehicleCard', [vehicleId, cardId, input]);
  }
  recordFuel(vehicleId: string, input: Parameters<Api['recordFuel']>[1], proof: ProofInput[]) {
    return this.write<unknown>('recordFuel', [vehicleId, input, proof]);
  }
  reviewFuel(vehicleId: string, fillId: string, input: Parameters<Api['reviewFuel']>[2]) {
    return this.write<unknown>('reviewFuel', [vehicleId, fillId, input]);
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
  // Guards' own phones: kept in this page only (not replayed), as the phone's own enrolment is.
  guardPhoneCode(personId: string) {
    return this.read((s, u) => s.guardPhone.issueCode(u, personId));
  }
  guardPhones(companyId: string) {
    return this.read((s, u) => s.guardPhone.phones(u, companyId));
  }
  revokeGuardPhone(phoneId: string, reason: string) {
    return this.read((s, u) => s.guardPhone.revoke(u, phoneId, reason));
  }
  cmsGuardPhones() {
    return this.read((s, u) => s.guardPhone.board(u));
  }
  /** For the guard phone client in the test version (api/guard-phone.ts). */
  guardHost(): import('./guard-phone').DemoGuardHost {
    return {
      svc: async () => {
        await this.ready();
        return this.svc;
      },
      user: async (id: string) => {
        await this.ready();
        return this.svc.user(id);
      },
      toApiError,
    };
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
  pdpaRegisterBoard() {
    return this.read((s, u) => s.pdpaRegisterBoard(u));
  }
  setPdpaSettings(input: { enabled?: boolean; keepYears?: number }, reason: string) {
    return this.write<unknown>('setPdpaSettings', [input, reason]);
  }
  savePdpaRegisterItem(id: string | null, input: Parameters<Api['savePdpaRegisterItem']>[1]) {
    return this.write<unknown>('savePdpaRegisterItem', [id, input]);
  }
  pdpaRegisterStep(id: string, step: 'review' | 'retire', note: string) {
    return this.write<unknown>('pdpaRegisterStep', [id, step, note]);
  }
  recordPdpaConsent(input: Parameters<Api['recordPdpaConsent']>[0], proof: ProofInput[]) {
    return this.write<unknown>('recordPdpaConsent', [input, proof]);
  }
  withdrawPdpaConsent(id: string, on: string, note: string) {
    return this.write<unknown>('withdrawPdpaConsent', [id, on, note]);
  }
  pdpaBreachDetails(caseId: string, input: Parameters<Api['pdpaBreachDetails']>[1]) {
    return this.write<unknown>('pdpaBreachDetails', [caseId, input]);
  }
  memos() {
    return this.read((s, u) => s.memos(u));
  }
  publishMemo(audience: 'STAFF' | 'FIELD' | 'TEAM', title: string, body: string, states: string[], opts: { readBy?: string | null; replaces?: string | null } = {}) {
    return this.write<unknown>('publishMemo', [audience, title, body, states, opts]);
  }
  memoReach(audience: 'STAFF' | 'FIELD' | 'TEAM', states: string[]) {
    return this.read((s, u) => s.memoReach(u, audience, states));
  }
  withdrawMemo(memoId: string, reason: string) {
    return this.write<unknown>('withdrawMemo', [memoId, reason]);
  }
  remindMemo(memoId: string) {
    return this.write<unknown>('remindMemo', [memoId]);
  }
  readMemo(memoId: string) {
    return this.write<unknown>('readMemo', [memoId]);
  }
  fwmDocs(ref: string) {
    return this.read((s, u) => s.fwmDocs(u, ref));
  }
  fwCostBoard() {
    return this.read((s, u) => s.fwCostBoard(u));
  }
  fwStatBoard() {
    return this.read((s, u) => s.fwStatBoard(u));
  }
  fwStatAct(action: Parameters<Api['fwStatAct']>[0], body: Record<string, unknown>) {
    // A draft only reads; everything else writes and is kept in the demo's own store.
    return action === 'draft' ? this.read((s, u) => s.fwStatAct(u, action, body)) : this.write<unknown>('fwStatAct', [action, body]);
  }
  fwCostDocs(ref: string) {
    return this.read((s, u) => s.fwCostDocs(u, ref));
  }
  recordFwPlacement(personId: string, input: Parameters<Api['recordFwPlacement']>[1], proof: ProofInput[]) {
    return this.write<unknown>('recordFwPlacement', [personId, input, proof]);
  }
  endFwPlacement(id: string, input: { to: string; note: string }) {
    return this.write<unknown>('endFwPlacement', [id, input]);
  }
  addFwCostLegalNote(input: Parameters<Api['addFwCostLegalNote']>[0]) {
    return this.write<unknown>('addFwCostLegalNote', [input]);
  }

  setFwCostRate(input: Parameters<Api['setFwCostRate']>[0]) {
    return this.write<unknown>('setFwCostRate', [input]);
  }
  draftFwCostMonth(month: string) {
    return this.write<unknown>('draftFwCostMonth', [month]);
  }
  decideFwCostCharges(input: Parameters<Api['decideFwCostCharges']>[0]) {
    return this.write<unknown>('decideFwCostCharges', [input]);
  }
  bookFwCostCharge(id: string, input: Parameters<Api['bookFwCostCharge']>[1], proof: ProofInput[]) {
    return this.write<unknown>('bookFwCostCharge', [id, input, proof]);
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
  recordFwPaper(personId: string, paper: FwPaper, input: FwPaperInput, proof: ProofInput[]) {
    return this.write<unknown>('recordFwPaper', [personId, paper, input, proof]);
  }
  ackFwPaper(credentialId: string, note: string) {
    return this.write<unknown>('ackFwPaper', [credentialId, note]);
  }
  addFwWorkerFromJa(jaRecordId: string, input: FwAddFromJaInput) {
    return this.write<unknown>('addFwWorkerFromJa', [jaRecordId, input]);
  }
  addFwWorker(input: Parameters<Api['addFwWorker']>[0]) {
    return this.write<unknown>('addFwWorker', [input]);
  }
  doneFwmTask(id: string, note: string, proof: ProofInput[]) {
    return this.write<unknown>('doneFwmTask', [id, note, proof]);
  }
  reviewFwmTask(id: string, accept: boolean, note: string) {
    return this.write<unknown>('reviewFwmTask', [id, accept, note]);
  }
  fwmWelfare() {
    return this.read((s, u) => s.fwmWelfare(u));
  }
  recordFwCheck(personId: string, input: Parameters<Api['recordFwCheck']>[1], proof: ProofInput[]) {
    return this.write<unknown>('recordFwCheck', [personId, input, proof]);
  }
  closeFwCheck(id: string, input: Parameters<Api['closeFwCheck']>[1], proof: ProofInput[]) {
    return this.write<unknown>('closeFwCheck', [id, input, proof]);
  }
  fwmRecruitment() {
    return this.read((s, u) => s.fwmRecruitment(u));
  }
  openFwRecruitFile(input: Parameters<Api['openFwRecruitFile']>[0]) {
    return this.write<unknown>('openFwRecruitFile', [input]);
  }
  setFwRecruitTravel(id: string, input: Parameters<Api['setFwRecruitTravel']>[1]) {
    return this.write<unknown>('setFwRecruitTravel', [id, input]);
  }
  recordFwRecruitStep(id: string, step: Parameters<Api['recordFwRecruitStep']>[1], input: Parameters<Api['recordFwRecruitStep']>[2], proof: ProofInput[]) {
    return this.write<unknown>('recordFwRecruitStep', [id, step, input, proof]);
  }
  clearFwRecruitFile(id: string, input: Parameters<Api['clearFwRecruitFile']>[1]) {
    return this.write<unknown>('clearFwRecruitFile', [id, input]);
  }
  recordFwRecruitArrival(id: string, input: Parameters<Api['recordFwRecruitArrival']>[1]) {
    return this.write<unknown>('recordFwRecruitArrival', [id, input]);
  }
  stopFwRecruitFile(id: string, input: Parameters<Api['stopFwRecruitFile']>[1]) {
    return this.write<unknown>('stopFwRecruitFile', [id, input]);
  }
  advanceSocsoClaim(id: string, to: Parameters<Api['advanceSocsoClaim']>[1], input: Parameters<Api['advanceSocsoClaim']>[2]) {
    return this.write<unknown>('advanceSocsoClaim', [id, to, input]);
  }
  // Cleaning planner, site fittings, Inventory and duty plans.
  cleaningBoard(date?: string) {
    return this.read((s, u) => s.cleaning.board(u, date));
  }
  cleaningSite(siteId: string, date?: string) {
    return this.read((s, u) => s.cleaning.site(u, siteId, date));
  }
  cleaningProof(siteId: string, docId: string) {
    return this.read((s, u) => s.cleaning.proof(u, siteId, docId));
  }
  cleaningSaveSetup(siteId: string, setup: CleaningSetupInput, expectedVersion: number | null) {
    return this.write<unknown>('cleaningOp', ['saveSetup', siteId, setup, expectedVersion]);
  }
  cleaningSetMap(siteId: string, input: { name: string; data: string }, expectedVersion: number) {
    return this.write<unknown>('cleaningOp', ['setMap', siteId, input, expectedVersion]);
  }
  cleaningPlan(siteId: string, date: string, absentIds: string[]) {
    return this.write<unknown>('cleaningOp', ['makePlan', siteId, date, absentIds]);
  }
  cleaningPublish(siteId: string, date: string) {
    return this.write<unknown>('cleaningOp', ['publish', siteId, date]);
  }
  cleaningRecord(siteId: string, date: string, input: CleaningRecordInput) {
    return this.write<unknown>('cleaningOp', ['recordTasks', siteId, date, input]);
  }
  cleaningDelivery(siteId: string, input: { date: string; supplies: StockLineInput[]; equipment: StockLineInput[]; note: string }) {
    return this.write<unknown>('cleaningOp', ['recordDelivery', siteId, input]);
  }
  cleaningReceive(siteId: string, entryId: string, input: { supplies: StockLineInput[]; equipment: StockLineInput[]; note: string; proof: CleaningProofInput }) {
    return this.write<unknown>('cleaningOp', ['receiveDelivery', siteId, entryId, input]);
  }
  cleaningStockCheck(siteId: string, input: { date: string; supplies: StockLineInput[]; equipment: StockLineInput[]; note: string; proof: CleaningProofInput }) {
    return this.write<unknown>('cleaningOp', ['stockCheck', siteId, input]);
  }
  cleaningClientSlip(siteId: string, input: CleaningSlipInput) {
    return this.write<unknown>('cleaningOp', ['recordClientAck', siteId, input]);
  }
  cleaningMonthly(siteId: string, month: string) {
    return this.read((s, u) => s.cleaning.monthly(u, siteId, month));
  }
  inventorySites() {
    return this.read((s, u) => s.cleaning.inventoryBoard(u));
  }
  siteKit(siteId: string) {
    return this.read((s, u) => s.cleaning.siteKit(u, siteId));
  }
  saveSiteKit(siteId: string, items: unknown[], expectedVersion: number | null) {
    return this.write<unknown>('cleaningOp', ['saveSiteKit', siteId, items, expectedVersion]);
  }
  recordSiteKit(siteId: string, input: { kind: 'install' | 'check'; date: string; lines: unknown[]; note: string; proof: CleaningProofInput }, expectedVersion: number) {
    return this.write<unknown>('cleaningOp', ['recordSiteKit', siteId, input, expectedVersion]);
  }
  approveSiteGift(siteId: string, input: { ref: string; qty: number; reason: string }) {
    return this.write<unknown>('cleaningOp', ['approveGift', siteId, input]);
  }
  closeOutList(siteId: string) {
    return this.read((s, u) => s.cleaning.closeOutList(u, siteId));
  }
  recordTakeBack(siteId: string, input: { date: string; lines: unknown[]; note: string; proof: CleaningProofInput }) {
    return this.write<unknown>('cleaningOp', ['recordTakeBack', siteId, input]);
  }
  dutyPosts(siteId: string, date: string) {
    return this.read((s, u) => s.duty.posts(u, siteId, date));
  }
  publishDutyPosts(siteId: string, date: string) {
    return this.write<unknown>('dutyOp', ['publishPosts', siteId, date]);
  }
  saveDutyTerms(siteId: string, terms: GuardTermsInput, expectedVersion: number | null) {
    return this.write<unknown>('dutyOp', ['saveTerms', siteId, terms, expectedVersion]);
  }
  dutyOfficers() {
    return this.read((s, u) => s.duty.officers(u));
  }
  dutyRoute(officerId: string, date: string, hours?: OfficerHoursInput | null) {
    return this.read((s, u) => s.duty.route(u, officerId, date, hours ?? undefined));
  }
  publishDutyRoute(officerId: string, date: string, expectPublishedAt: string | null, hours?: OfficerHoursInput | null) {
    return this.write<unknown>('dutyOp', ['publishRoute', officerId, date, expectPublishedAt, hours ?? null]);
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
  myAlerts() {
    // The test link has no Teams or email: the bell is the only place alerts show here.
    return this.read(async (s, u) => ({ items: await s.myAlerts(u), email: false, teamsChannel: false }));
  }
  home(companyId?: string) {
    return this.read((s, u) => s.home(u, companyId));
  }
  growth() {
    return this.read((s, u) => s.growth(u));
  }
  settingsHome() {
    return this.read((s, u) => s.settingsHome(u));
  }
  approvalLimits() {
    return this.read((s, u) => s.approvalLimits(u));
  }
  setApprovalLimits(body: { claimsMax: number | null; purchasesMax: number | null; comment: string }) {
    return this.write('setApprovalLimits', [body]);
  }
  growthMargin() {
    return this.read((s, u) => s.growthMargin(u));
  }
  regionalOps(region?: string) {
    return this.read((s, u) => s.regionalOps(u, region));
  }
  govOpsMonitor(month?: string) {
    return this.read((s, u) => s.govOpsMonitor(u, month));
  }
  privateOpsMonitor(month?: string) {
    return this.read((s, u) => s.privateOpsMonitor(u, month));
  }
  managementFees() {
    return this.read((s, u) => s.managementFees(u));
  }
  managementFeeBills(month?: string) {
    return this.read((s, u) => s.managementFeeBills(u, month));
  }
  setManagementFee(companyId: string, input: Parameters<Api['setManagementFee']>[1]) {
    return this.write<unknown>('setManagementFee', [companyId, input]);
  }


  insurance() {
    return this.read((s, u) => s.insurance(u));
  }
  recordInsurancePremium(policyId: string, input: { paidOn: string; ref: string }) {
    return this.write<unknown>('recordInsurancePremium', [policyId, input]);
  }
  renewInsurancePolicy(policyId: string, input: Parameters<Api['renewInsurancePolicy']>[1]) {
    return this.write<unknown>('renewInsurancePolicy', [policyId, input]);
  }
  cancelInsurancePolicy(policyId: string, input: { on: string; reason: string }) {
    return this.write<unknown>('cancelInsurancePolicy', [policyId, input]);
  }
  hrMonitor() {
    return this.read((s, u) => s.hrMonitor(u));
  }
  cms() {
    return this.read((s, u) => s.cms(u));
  }
  cmsReadiness() {
    return this.read((s, u) => s.cmsReadiness(u));
  }
  setCmsReadinessAnswer(siteId: string, key: string, input: Parameters<Api['setCmsReadinessAnswer']>[2]) {
    return this.write<Awaited<ReturnType<Api['setCmsReadinessAnswer']>>>('setCmsReadinessAnswer', [siteId, key, input]);
  }
  saveCmsReadinessDevice(siteId: string, input: Parameters<Api['saveCmsReadinessDevice']>[1]) {
    return this.write<Awaited<ReturnType<Api['saveCmsReadinessDevice']>>>('saveCmsReadinessDevice', [siteId, input]);
  }
  removeCmsReadinessDevice(siteId: string, deviceId: string, reason: string) {
    return this.write<Awaited<ReturnType<Api['removeCmsReadinessDevice']>>>('removeCmsReadinessDevice', [siteId, deviceId, reason]);
  }
  reviewCmsReadiness(siteId: string, input: Parameters<Api['reviewCmsReadiness']>[1]) {
    return this.write<Awaited<ReturnType<Api['reviewCmsReadiness']>>>('reviewCmsReadiness', [siteId, input]);
  }
  updateCmsSettings(patch: CmsSettingsPatch) {
    return this.write<unknown>('updateCmsSettings', [patch]);
  }
  planCmsRoster(days: number) {
    return this.write<unknown>('planCmsRoster', [days]);
  }
  recordCmsHandover(shiftId: string, note: string, agree = true) {
    return this.write<unknown>('recordCmsHandover', [shiftId, note, agree]);
  }
  giveCmsHandover(shiftId: string, note: string) {
    return this.write<unknown>('giveCmsHandover', [shiftId, note]);
  }
  cmsSeatClockIn(shiftId: string) {
    return this.write<unknown>('cmsSeatClockIn', [shiftId]);
  }
  cmsSeatClockOut(shiftId: string, note: string) {
    return this.write<unknown>('cmsSeatClockOut', [shiftId, note]);
  }
  releaseCmsSeat(shiftId: string, reason: string) {
    return this.write<unknown>('releaseCmsSeat', [shiftId, reason]);
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
  siteSurveySetup() {
    return this.read((s, u) => s.siteSurveys.setup(u));
  }
  siteSurveyBoard() {
    return this.read((s, u) => s.siteSurveys.board(u));
  }
  siteSurveyDetail(id: string) {
    return this.read((s, u) => s.siteSurveys.detail(u, id));
  }
  siteSurveyReceive(body: Record<string, unknown>) {
    return this.write<Awaited<ReturnType<Api['siteSurveyReceive']>>>('siteSurveyReceive', [body]);
  }
  siteSurveyPhoto(id: string, n: number, image: string) {
    return this.write<Awaited<ReturnType<Api['siteSurveyPhoto']>>>('siteSurveyPhoto', [id, n, image]);
  }
  siteSurveyReview(id: string, outcome: 'accepted' | 'returned', reason: string) {
    return this.write<unknown>('siteSurveyReview', [id, outcome, reason]);
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
  cmsDispatches() {
    return this.read((s, u) => s.cmsDispatches(u));
  }
  sendDispatch(input: DispatchInput) {
    return this.write<unknown>('sendDispatch', [input]);
  }
  closeDispatch(id: string, outcome: 'real' | 'nothing_found' | 'done', note: string) {
    return this.write<unknown>('closeDispatch', [id, outcome, note]);
  }
  cancelDispatch(id: string, note: string) {
    return this.write<unknown>('cancelDispatch', [id, note]);
  }
  simulateDetection(input: DetectionInput) {
    return this.write<unknown>('simulateDetection', [input]);
  }
  deviceDispatches() {
    return this.read((s, u) => s.deviceDispatches(u));
  }
  dispatchSeen(id: string) {
    return this.write<unknown>('dispatchSeen', [id]);
  }
  acknowledgeDispatch(id: string, input: { staffNo: string; pin: string }) {
    return this.write<unknown>('acknowledgeDispatch', [id, input]);
  }
  addDispatchPhoto(id: string, input: PhotoInput) {
    return this.write<unknown>('addDispatchPhoto', [id, input]);
  }
  addDispatchVideo(id: string, input: VideoInput) {
    return this.write<unknown>('addDispatchVideo', [id, input]);
  }
  replyDispatch(id: string, reply: string) {
    return this.write<unknown>('replyDispatch', [id, reply]);
  }
  dutyDevice() {
    return this.read((s, u) => s.dutyDevice(u));
  }
  siteTaskBoard(siteId: string) {
    return this.read((s, u) => s.siteTaskBoard(u, siteId));
  }
  saveNeedsReview(siteId: string, input: NeedsReviewInput) {
    return this.write<unknown>('saveNeedsReview', [siteId, input]);
  }
  setSiteTask(siteId: string, input: SiteTaskInput) {
    return this.write<unknown>('setSiteTask', [siteId, input]);
  }
  stopSiteTask(id: string, reason: string) {
    return this.write<unknown>('stopSiteTask', [id, reason]);
  }
  setGateLog(siteId: string, on: boolean, reason: string) {
    return this.write<unknown>('setGateLog', [siteId, on, reason]);
  }
  doSiteTask(id: string, input: DoSiteTaskInput) {
    return this.write<unknown>('doSiteTask', [id, input]);
  }
  clientCodeBoard(siteId: string) {
    return this.read((s, u) => s.clientCodeBoard(u, siteId));
  }
  saveClientCode(siteId: string, input: ClientCodeInput) {
    return this.write<unknown>('saveClientCode', [siteId, input]);
  }
  stopClientCode(id: string, reason: string) {
    return this.write<unknown>('stopClientCode', [id, reason]);
  }
  setClientReport(id: string, input: { send: boolean; how?: string; reason: string }) {
    return this.write<unknown>('setClientReport', [id, input]);
  }
  checkClientRequirement(id: string, input: ClientCheckInput) {
    return this.write<unknown>('checkClientRequirement', [id, input]);
  }
  saveClientInspection(id: string, input: ClientInspectionInput) {
    return this.write<unknown>('saveClientInspection', [id, input]);
  }
  fixInspectionLine(id: string, index: number, input: { note: string; proof?: ProofInput[] }) {
    return this.write<unknown>('fixInspectionLine', [id, index, input]);
  }
  selfAuditBoard(companyId: string) {
    return this.read((s, u) => s.selfAuditBoard(u, companyId));
  }
  saveSelfAudit(companyId: string, input: SelfAuditInput) {
    return this.write<unknown>('saveSelfAudit', [companyId, input]);
  }
  rbaBoard(companyId?: string | null) {
    return this.read((s, u) => s.rbaBoard(u, companyId ?? null));
  }
  nameRbaCommittee(input: RbaCommitteeInput) {
    return this.write<unknown>('nameRbaCommittee', [input]);
  }
  rbaTraceBoard(companyId: string) {
    return this.read((s, u) => s.rbaTraceBoard(u, companyId));
  }
  runRbaTrace(companyId: string, period: string) {
    return this.write<unknown>('runRbaTrace', [companyId, period]);
  }
  settleRbaTraceRow(reviewId: string, personId: string, input: { kind: 'explained' | 'corrected' | 'finding'; note: string }) {
    return this.write<unknown>('settleRbaTraceRow', [reviewId, personId, input]);
  }
  workerFiles(companyId: string) {
    return this.read((s, u) => s.workerFiles(u, companyId));
  }
  ethicsBoard(companyId?: string | null) {
    return this.read((s, u) => s.ethicsBoard(u, companyId ?? null));
  }
  signEthicsDeclaration(input: EthicsInput) {
    return this.write<unknown>('signEthicsDeclaration', [input]);
  }
  reviewEthicsInterests(id: string, input: { action: 'no_conflict' | 'managed'; note: string }) {
    return this.write<unknown>('reviewEthicsInterests', [id, input]);
  }
  fixSelfAuditLine(id: string, key: string, input: { note: string; proof?: ProofInput[] }) {
    return this.write<unknown>('fixSelfAuditLine', [id, key, input]);
  }
  addPostLog(input: PostLogInput) {
    return this.write<unknown>('addPostLog', [input]);
  }
  gateIn(input: GateInInput) {
    return this.write<Awaited<ReturnType<Api['gateIn']>>>('gateIn', [input]);
  }
  gateOut(id: string, input: Parameters<Api['gateOut']>[1]) {
    return this.write<unknown>('gateOut', [id, input]);
  }
  siteDutyLog(siteId: string, days?: number) {
    return this.read((s, u) => s.siteDutyLog(u, siteId, days));
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
  specialOpsLegalFlags() {
    return this.read((s, u) => s.specialOpsLegalFlags(u));
  }
  raiseArmsRequest(input: RaiseArmsRequestInput) {
    return this.write<unknown>('raiseArmsRequest', [input]);
  }
  armsRequestStep(id: string, action: ArmsRequestAction, reason: string, extra: ArmsRequestStepExtra = {}) {
    return this.write<unknown>('armsRequestStep', [id, action, reason, extra]);
  }
  armsTrading() {
    return this.read((s, u) => s.armsTrading(u));
  }
  setArmsTrading(on: boolean, reason: string) {
    return this.write<unknown>('setArmsTrading', [on, reason]);
  }
  transportBoard() {
    return this.read((s, u) => s.transportBoard(u));
  }
  amRentCheck() {
    return this.read((s, u) => s.amRentCheck(u));
  }
  amBuyRequest(input: AmBuyInput) {
    return this.write<unknown>('amBuyRequest', [input]);
  }
  amBuyDecide(id: string, approve: boolean, reason: string, seenEstCost?: number) {
    return this.write<unknown>('amBuyDecide', [id, approve, reason, seenEstCost]);
  }
  amBuyReceived(id: string, input: { tag: string; cost: number; boughtOn: string }) {
    return this.write<unknown>('amBuyReceived', [id, input]);
  }
  amBuyReprice(id: string, estCost: number, reason: string) {
    return this.write<unknown>('amBuyReprice', [id, estCost, reason]);
  }
  // The demo never sends a WhatsApp message: the connector always shows as not connected.
  amWhatsApp() {
    return this.read(async (s, u) => ({ ...(await s.amWhatsAppBoard(u)), connector: { configured: false, switchedOn: false, sending: false, missing: [] as string[] } }));
  }
  amWhatsAppConsent(unitId: string, on: boolean, how: string) {
    return this.write<unknown>('amWhatsAppConsent', [unitId, on, how]);
  }
  amWhatsAppSettle(unitId: string, reminderId: string, outcome: 'went' | 'resend' | 'drop', reason: string) {
    return this.write<unknown>('amWhatsAppSettle', [unitId, reminderId, outcome, reason]);
  }
  async amWhatsAppRun() {
    const r = await this.write<{ queued: number; cancelled: number }>('amQueueRentReminders', []);
    return { ...r, sent: 0, failed: 0, sending: false };
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
  addShifts(siteId: string, input: Parameters<Api['addShifts']>[1]) {
    return this.write<Awaited<ReturnType<Api['addShifts']>>>('addShifts', [siteId, input]);
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
  addTender(companyId: string, input: Parameters<Api['addTender']>[1]) {
    return this.write<Awaited<ReturnType<Api['addTender']>>>('addTender', [companyId, input]);
  }
  correctQuotation(id: string, input: Parameters<Api['correctQuotation']>[1]) {
    return this.write<Awaited<ReturnType<Api['correctQuotation']>>>('correctQuotation', [id, input]);
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
  addMinutes(meetingId: string, text: string, attendance?: Parameters<Api['addMinutes']>[2]) {
    return this.write('addMinutes', [meetingId, text, attendance]);
  }
  changeMeeting(meetingId: string, input: Parameters<Api['changeMeeting']>[1]) {
    return this.write('changeMeeting', [meetingId, input]);
  }
  cancelMeeting(meetingId: string, reason: string) {
    return this.write('cancelMeeting', [meetingId, reason]);
  }
  answerMeeting(meetingId: string, answer: 'yes' | 'no' | 'maybe', note: string) {
    return this.write('answerMeeting', [meetingId, answer, note]);
  }
  checkMeetingSummary(meetingId: string, input: Parameters<Api['checkMeetingSummary']>[1]) {
    return this.write('checkMeetingSummary', [meetingId, input]);
  }
  setMeetingAction(meetingId: string, index: number, done: boolean, note = '') {
    return this.write('setMeetingAction', [meetingId, index, done, note]);
  }
  addMeetingAction(meetingId: string, input: Parameters<Api['addMeetingAction']>[1]) {
    return this.write('addMeetingAction', [meetingId, input]);
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
  tenderCounter() {
    return this.read((s, u) => s.tenderCounter(u));
  }
  directorOfficeCounter() {
    return this.read((s, u) => s.directorOfficeCounter(u));
  }
  tenderOpportunities() {
    return this.read((s, u) => s.tenderOpportunities(u));
  }
  recordTenderOpportunity(input: OpportunityInput) {
    return this.write<unknown>('recordTenderOpportunity', [input]);
  }
  enterTenderOpportunity(id: string, companyIds: string[], note: string) {
    return this.write<unknown>('enterTenderOpportunity', [id, companyIds, note]);
  }
  tenderSources() {
    return this.read((s, u) => s.tenderSources(u));
  }
  addTenderSource(input: { buyer: string; urls: string[]; note: string }) {
    return this.write<unknown>('addTenderSource', [input]);
  }
  loadTenderSourceStarter() {
    return this.write<unknown>('loadTenderSourceStarter', []);
  }
  updateTenderSource(id: string, input: { urls?: string[]; note?: string; active?: boolean }) {
    return this.write<unknown>('updateTenderSource', [id, input]);
  }
  recordTenderSourceCheck(id: string, input: SourceCheckInput) {
    return this.write<unknown>('recordTenderSourceCheck', [id, input]);
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
  confirmTenderNa(tenderId: string, stepId: string, accept: boolean, note: string) {
    return this.write('confirmTenderNa', [tenderId, stepId, accept, note]);
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
  policeHelp() {
    return this.read((s, u) => s.policeHelp(u));
  }
  askPoliceHelp(input: Parameters<Api['askPoliceHelp']>[0]) {
    return this.write<{ ref: string }>('askPoliceHelp', [input]);
  }
  assignPoliceHelp(id: string, input: Parameters<Api['assignPoliceHelp']>[1]) {
    return this.write<unknown>('assignPoliceHelp', [id, input]);
  }
  recordPoliceHelpOutcome(id: string, input: Parameters<Api['recordPoliceHelpOutcome']>[1]) {
    return this.write<unknown>('recordPoliceHelpOutcome', [id, input]);
  }
  answerPoliceHelp(id: string, decision: 'confirm' | 'return', note: string) {
    return this.write<unknown>('answerPoliceHelp', [id, decision, note]);
  }
  withdrawPoliceHelp(id: string, note: string) {
    return this.write<unknown>('withdrawPoliceHelp', [id, note]);
  }
  recordLindung(id: string, input: Parameters<Api['recordLindung']>[1]) {
    return this.write<unknown>('recordLindung', [id, input]);
  }
  verifyLindung(id: string, answer: Parameters<Api['verifyLindung']>[1], note: string) {
    return this.write<unknown>('verifyLindung', [id, answer, note]);
  }
  addSocsoDependant(id: string, input: Parameters<Api['addSocsoDependant']>[1]) {
    return this.write<unknown>('addSocsoDependant', [id, input]);
  }
  addDependantPaper(id: string, dependantId: string, kind: 'relation' | 'translation', proof: ProofInput[]) {
    return this.write<unknown>('addDependantPaper', [id, dependantId, kind, proof]);
  }
  confirmDependantRoute(id: string, dependantId: string, input: Parameters<Api['confirmDependantRoute']>[2]) {
    return this.write<unknown>('confirmDependantRoute', [id, dependantId, input]);
  }
  recordDeathNotice(id: string, who: 'family' | 'embassy' | 'immigration', at: string) {
    return this.write<unknown>('recordDeathNotice', [id, who, at]);
  }
  addDependantPayment(id: string, input: Parameters<Api['addDependantPayment']>[1]) {
    return this.write<unknown>('addDependantPayment', [id, input]);
  }
  confirmDependantReceived(id: string, paymentId: string, input: { on: string; proof: ProofInput[] }) {
    return this.write<unknown>('confirmDependantReceived', [id, paymentId, input]);
  }
  assessDosh(id: string, kind: Parameters<Api['assessDosh']>[1], why: string) {
    return this.write<unknown>('assessDosh', [id, kind, why]);
  }
  recordDoshImmediate(id: string, input: Parameters<Api['recordDoshImmediate']>[1]) {
    return this.write<unknown>('recordDoshImmediate', [id, input]);
  }
  recordDoshForm(id: string, input: Parameters<Api['recordDoshForm']>[1]) {
    return this.write<unknown>('recordDoshForm', [id, input]);
  }
  recordDoshClientTold(id: string, at: string) {
    return this.write<unknown>('recordDoshClientTold', [id, at]);
  }
  doshRegister(year: number) {
    return this.read((svc, u) => svc.doshRegister(u, year));
  }
  contractProof(id: string) {
    return this.read((s, u) => s.contractProof(u, id));
  }
  addMobItem(id: string, input: Parameters<Api['addMobItem']>[1]) {
    return this.write<unknown>('addMobItem', [id, input]);
  }
  certifyContractRound(id: string, round: number, note: string) {
    return this.write<unknown>('certifyContractRound', [id, round, note]);
  }
  renewContract(id: string, input: Parameters<Api['renewContract']>[1]) {
    return this.write<unknown>('renewContract', [id, input]);
  }
  linkContractClient(id: string, accountId: string) {
    return this.write<unknown>('linkContractClient', [id, accountId]);
  }
  readContractPaper(input: { companyId: string; clientAccountId: string | null; text: string }) {
    // A read, not a logged write: the paper's text is never kept in this browser. The demo has no online reader.
    return this.read<PaperReadingResult>((s, u) => s.readContractPaper(u, input));
  }
  cmsHours(month?: string) {
    return this.read((s, u) => s.cmsHours(u, month));
  }
  qualityRegister(opts: { companyId?: string; standard?: 'ISO9001' | 'PIKM' } = {}) {
    return this.read((s, u) => s.quality.register(u, opts));
  }
  qualityMatrix(opts: { companyId?: string } = {}) {
    return this.read((s, u) => s.quality.matrix(u, opts));
  }
  qualityFoundation() {
    return this.read((s, u) => s.quality.foundation(u));
  }
  qualityAction(action: string, input: Record<string, unknown>) {
    return this.write<unknown>('qualityAction', [action, input]);
  }
  salaryCalcData() {
    return this.read((s, u) => s.salaryCalcData(u));
  }
  amExtras() {
    return this.read((s, u) => s.amExtras.board(u));
  }
  amExtrasAct(area: string, action: string, id: string, body: Record<string, unknown>) {
    return this.write<unknown>('amExtrasAct', [area, action, id, body]);
  }
  jaSwitchBoard() {
    return this.read((s, u) => s.jaSwitchBoard(u));
  }
  jaSwitchReport(companyId: string, area: string) {
    return this.read((s, u) => s.jaSwitchReport(u, companyId, area));
  }
  jaSwitchAct(companyId: string, area: string, action: Parameters<Api['jaSwitchAct']>[2], body: Record<string, unknown>) {
    return this.write<unknown>('jaSwitchAct', [companyId, area, action, body]);
  }
  jaSwitchSettings(body: Record<string, unknown>) {
    return this.write<unknown>('jaSwitchSettings', [body]);
  }
  jaImportStage(body: Record<string, unknown>) {
    return this.write<unknown>('jaImportStage', [body]);
  }
  jaImportDecide(id: string, body: Record<string, unknown>) {
    return this.write<unknown>('jaImportDecide', [id, body]);
  }
  jaGuardHistory(companyId: string, staffNo: string) {
    return this.read((s, u) => s.jaGuardHistory(u, companyId, staffNo));
  }
  qualityOps(opts: { companyId?: string } = {}) {
    return this.read((s, u) => s.qualityOps.board(u, opts));
  }
}

