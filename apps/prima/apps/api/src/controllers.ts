import {releaseState} from './release-state';
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Param, Post, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type {
  AttendanceIssue,
  CorpChangeKind,
  ItAsset,
  ItAssetKind,
  ItTicketCategory,
  CaseType,
  DisciplineStep,
  FaceCapture,
  FollowUpKind,
  LeaveKind,
  Severity,
  TenderRecord,
  TenderStatus,
  RecordKind,
  ReportDef,
  RecordValues,
  User,
} from '@prima/core';
import { RECORD_KINDS, RULES, accessClosed, arishaFormView, dataModeOf, dateOf, fromMs, arishaKind, arishaToolsFor, inPilot, type ArishaTurn, type ArishaReviewDraft } from '@prima/core';
import { ArishaBusy, IdentityToken, arishaConfig, askArisha } from './arisha';
import { arishaPilotAllowed } from './arisha-pilot';
import { AuthGuard, DoorFeedGuard, FeedGuard, OfficeSystemGuard, PlannerFeedGuard, UserId, devLoginOn, entraSetup, issueToken } from './auth';
import { officeSecret } from './office';
import { Db, schemaState } from './db';
import { WebConnectors, webConnectorConfig } from './web-connectors';

const webConnectors = new WebConnectors();

const SEVERITIES: Severity[] = ['P1', 'P2', 'P3', 'P4'];
const CASE_TYPES: CaseType[] = ['INCIDENT', 'SOS', 'MISSED_CHECKIN', 'NO_SHOW', 'COMPLAINT', 'COMPLIANCE', 'IDENTITY_CHECK', 'ARMS'];
const CASE_ACTIONS = ['acknowledge', 'escalate', 'resolve', 'close', 'note'] as const;
const QUOTE_ACTIONS = ['submit', 'approve', 'return', 'sent', 'accepted', 'rejected'] as const;
const TENDER_STATUSES: TenderStatus[] = ['open', 'preparing', 'submitted', 'won', 'lost', 'no_bid'];
const ATT_ISSUES: AttendanceIssue[] = ['NO_SHOW', 'POST_EMPTY', 'LATE', 'OUTSIDE_GEOFENCE', 'EARLY_LEAVE', 'FACE_NOT_MATCHED', 'NOT_ROSTERED'];
const LEAVE_KINDS: LeaveKind[] = ['ANNUAL', 'SICK', 'HOSPITAL', 'EMERGENCY', 'UNPAID', 'ABSENCE_REASON'];
const FOLLOW_UPS: FollowUpKind[] = ['STAFF_ALERTED', 'REPLACEMENT', 'DISCIPLINE', 'EXCUSED'];
const DISCIPLINE: DisciplineStep[] = [
  'VERBAL_WARNING',
  'WRITTEN_WARNING',
  'FINAL_WARNING',
  'SHOW_CAUSE',
  'DOMESTIC_INQUIRY',
  'SUSPENSION',
  'DOWNGRADE',
  'DISMISSAL',
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOCSO_TYPES = ['WORK_ACCIDENT', 'COMMUTING', 'EMERGENCY', 'OCCUPATIONAL_DISEASE', 'NON_WORK_ACCIDENT', 'INVALIDITY', 'DEATH'] as const;
const SOCSO_STATUSES = ['REPORTED', 'DOCS_COMPLETE', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'APPEAL', 'CLOSED'] as const;
const SOCSO_RESTRICTIONS = ['NO_DUTY', 'NO_PATROL', 'NO_ARMED', 'NO_NIGHT'] as const;
const FW_PAPERS = ['PLKS_PERMIT', 'PASSPORT', 'FOMEMA', 'FW_INSURANCE'] as const;
const FWM_TASK_KINDS = ['FOMEMA', 'JIM', 'TNG', 'BIOMETRIC', 'OTHER'] as const;
const HIRING_DOC_KINDS = ['AGREEMENT', 'AGREEMENT_STAMPED', 'VETTING_CERT'] as const;
const HOSPITAL_DOC_ITEMS = ['ADMISSION_LETTER', 'GUARANTEE_LETTER', 'MEDICAL_CERT', 'DISCHARGE_SUMMARY', 'ITEMISED_BILL', 'CLAIM_FORM'] as const;
const HOSPITAL_DOC_STATUSES = ['missing', 'received', 'not_needed'] as const;
const HOSPITAL_STAGES = ['collecting', 'submitted', 'approved', 'paid', 'rejected'] as const;

function str(v: unknown, name: string, max = 2000): string {
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${name} is missing or too long`);
  return v;
}

/** A stamped photo from the in-app camera, sent with a branch checklist or visit. */
function proofOf(v: unknown): { image: string; capturedAt?: string; lat?: number | null; lng?: number | null } | null {
  if (v == null) return null;
  const p = v as Record<string, unknown>;
  if (typeof p.image !== 'string' || p.image.length > 3_000_000) throw new BadRequestException('proof.image must be a photo from the in-app camera');
  return {
    image: p.image,
    capturedAt: typeof p.capturedAt === 'string' ? p.capturedAt.slice(0, 40) : undefined,
    lat: typeof p.lat === 'number' ? p.lat : null,
    lng: typeof p.lng === 'number' ? p.lng : null,
  };
}
function date(v: unknown, name: string): string {
  if (typeof v !== 'string' || !DATE.test(v)) throw new BadRequestException(`${name} must be a date like 2026-10-24`);
  return v;
}
function coord(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Wave 1 accepts the face result from the device so the flow can be tested end to end.
 * Before go-live the device sends the capture and the face engine scores it here; a
 * device-supplied score must not be trusted (master plan open item: face engine).
 */
/** Proof items for a case step (rule CASE-PROOF): in-app camera photos or PDF/JPEG/PNG documents. */
function badStepStage(): never {
  throw new BadRequestException('Each step must be due before preparing or before submitting.');
}

function proofList(v: unknown) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 3) throw new BadRequestException('proof must be a list of up to 3 items');
  return v.map((x) => {
    const b = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (b.kind === 'photo') return { kind: 'photo' as const, ...evidence(b) };
    if (b.kind === 'document')
      return {
        kind: 'document' as const,
        name: str(b.name, 'proof.name', 120),
        data: str(b.data, 'proof.data', 1_000_000),
        caption: typeof b.caption === 'string' ? b.caption.slice(0, 200) : '',
      };
    throw new BadRequestException('proof.kind must be photo or document');
  });
}

function evidence(b: Record<string, unknown>) {
  // Test pictures exist only in the browser test version; the live API takes the in-app camera only.
  if (b.source === 'test_picture') throw new BadRequestException('Take the photo with the in-app camera.');
  return {
    image: str(b.image, 'image', 1_000_000),
    lat: coord(b.lat),
    lng: coord(b.lng),
    accuracyM: coord(b.accuracyM),
    capturedAt: typeof b.capturedAt === 'string' && b.capturedAt.length < 40 ? b.capturedAt : null,
    caption: typeof b.caption === 'string' ? b.caption.slice(0, 200) : '',
    source: 'in_app_camera' as const,
  };
}
/** A staff clock photo. The live API takes the in-app camera only. */
function staffShot(b: Record<string, unknown>) {
  if (b.source === 'test_picture') throw new BadRequestException('Take the photo with the in-app camera.');
  return {
    image: str(b.image, 'image', 2_500_000),
    capturedAt: str(b.capturedAt, 'capturedAt', 40),
    lat: coord(b.lat),
    lng: coord(b.lng),
    accuracyM: coord(b.accuracyM),
    face: face(b.face),
    source: 'in_app_camera',
  };
}

/** A witness signs in with their own staff number and PIN, never a typed name (insider abuse audit, 27 Oct 2026). */
function witness(v: unknown): { staffNo: string; pin: string } {
  const w = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { staffNo: str(w.staffNo ?? '', 'witness.staffNo', 20), pin: str(w.pin ?? '', 'witness.pin', 12) };
}

function face(v: unknown): FaceCapture | null {
  if (!v || typeof v !== 'object') return null;
  const { score, live } = v as Record<string, unknown>;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return { score: Math.min(1, Math.max(0, score)), live: live === true };
}

const CMS_SETTING_KEYS = [
  'shiftPattern',
  'firstShiftStart',
  'headControlPerShift',
  'monitorOfficersPerShift',
  'clockInGraceMin',
  'handoverWithinMin',
  'vaultWatchCheckMin',
  'forwardAfterSec',
  'answerTargetSec',
  'callbackWithinMin',
  'alarmAckSec',
] as const;

/** Arisha's access to Azure OpenAI, from this server's managed identity. */
const arishaToken = new IdentityToken();

@Controller('api')
export class HealthController {
  constructor(private db: Db) {}

  /** Heavy read-only complete-release diagnostic; no provider/authority readiness claim. */
  @Get('health/release')
  release(){return releaseState(this.db.pool);}

  /** Ready only when the database answers, the schema is in place and the API's own login may read staff accounts. */
  @Get('health')
  async health() {
    await this.db.pool.query('SELECT 1 FROM prima.users LIMIT 1');
    return { ok: true };
  }

  /**
   * Which schema version the database holds (a fingerprint of db/migrations, nothing about the data). The deploy
   * workflow compares it with the version it is about to ship and stops when the CEO must run a migration first.
   */
  @Get('health/schema')
  schema() {
    return schemaState(this.db.pool);
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(private db: Db) {}

  private devOnly(): void {
    if (!devLoginOn()) throw new ForbiddenException('Development sign-in is turned off.');
  }

  /** How the web app signs people in: the web app's client ID and the API scope. Public identifiers, never secrets. */
  @Get('config')
  config() {
    const e = entraSetup();
    return {
      microsoft: e ? { tenantId: e.cfg.tenantId, clientId: e.cfg.spaClientId, scope: `${e.cfg.apiAppIdUri}/${e.cfg.scope}` } : null,
      devLogin: devLoginOn(),
      // P66: the Agentic Office may sign people in (office.ts). A yes/no only; the secret never leaves the server.
      office: !!officeSecret(),
    };
  }

  /** Lists demo users for the development sign-in screen. */
  @Get('users')
  async users() {
    this.devOnly();
    const res = await this.db.pool.query(`SELECT data FROM prima.users WHERE NOT (data ? 'integration') ORDER BY id`);
    const all = res.rows.map((r) => r.data as User);
    // Pilot phase: only IT, the COO and the CEO sign in (Fauzan, 28 Oct 2026).
    return RULES.pilot.value.on ? all.filter(inPilot) : all;
  }

  @Post('dev-login')
  async devLogin(@Body() body: { userId?: unknown }) {
    this.devOnly();
    const userId = str(body.userId, 'userId', 100);
    const user = await this.db.asUser(userId, async (_svc, u) => u);
    if (user.integration) throw new ForbiddenException('A system feed cannot sign in to screens.');
    return { token: issueToken(userId), user };
  }
}

/**
 * P67: the Agentic Office links its people to staff records (office.ts). It reads the list here with a signed system
 * call: who each record is (name, title, role), whether IT recorded a Microsoft account (the office links that person
 * automatically) and whether the record may sign in now. Nothing else of a person is shown.
 */
@Controller('api/office')
@UseGuards(OfficeSystemGuard)
export class OfficeController {
  constructor(private db: Db) {}

  @Get('staff')
  async staff() {
    const res = await this.db.pool.query(`SELECT data FROM prima.users WHERE NOT (data ? 'integration') ORDER BY data->>'name', id`);
    const today = dateOf(fromMs(Date.now()));
    return res.rows.map((r) => {
      const u = r.data as User;
      return {
        id: u.id,
        name: u.name,
        title: u.title,
        role: u.role,
        entraOid: u.entraOid ? u.entraOid.toLowerCase() : null,
        canSignIn: !accessClosed(u, today) && (!RULES.pilot.value.on || inPilot(u)),
      };
    });
  }
}

@Controller('api')
@UseGuards(AuthGuard)
export class AppController {
  constructor(private db: Db) {}

  /** Whether Arisha is switched on here (the CEO approves it; off by default). */
  @Get('arisha')
  async arishaStatus(@UserId() uid: string) {
    const user = await this.db.asUser(uid, async (_svc, u) => u);
    return { enabled: !!arishaConfig() && arishaPilotAllowed(user) };
  }

  @Get('arisha/draft-form')
  arishaDraftForm(@UserId() uid: string, @Query('kind') kind: string, @Query('companyId') companyId?: string) {
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.form(u, arishaKind(kind), companyId || null));
  }

  @Post('arisha/prepare')
  arishaPrepare(@UserId() uid: string, @Body() input: Record<string, unknown>) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Supply draft fields.');
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.prepareRecord(u, input));
  }

  @Get('arisha/finance-papers')
  arishaFinancePapers(@UserId() uid: string, @Query('companyId') companyId: string) {
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.financePapers(u, str(companyId, 'companyId', 60)));
  }

  @Post('arisha/summary')
  arishaSummary(@UserId() uid: string, @Body() input: { context: string; companyId?: string | null }) {
    this.arishaToolInput(input, ['context', 'companyId']);
    if (typeof input.context !== 'string') throw new BadRequestException('Choose a supported summary context.');
    const companyId = input.companyId == null ? null : str(input.companyId, 'companyId', 60);
    return this.db.asUser(uid, (svc, u) => svc.arishaContext.summary(u, input.context, companyId));
  }

  @Post('arisha/finance-options')
  arishaFinanceOptions(@UserId() uid: string, @Body() input: { companyId?: string | null }) {
    this.arishaToolInput(input, ['companyId']);
    const companyId = input.companyId == null ? null : str(input.companyId, 'companyId', 60);
    // Core returns only scoped IDs and statuses, never human-entered labels or balances.
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.financeModelOptions(u, companyId));
  }

  @Post('arisha/prepare-finance')
  arishaPrepareFinance(@UserId() uid: string, @Body() input: Record<string, unknown>) {
    this.arishaToolInput(input, ['companyId', 'pack', 'itemId']);
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.prepareFinance(u, input));
  }

  private arishaToolInput(input: unknown, keys: string[]): void {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !keys.includes(k)))
      throw new BadRequestException('Unsupported tool arguments.');
  }

  @Get('arisha/drafts')
  arishaDrafts(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.list(u));
  }

  @Post('arisha/drafts')
  arishaSubmitDraft(@UserId() uid: string, @Body() b: { payload: ArishaReviewDraft['payload']; companyId: string | null }) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Supply a draft proposal.');
    // Human submission does not establish who prepared the content. No client origin claims.
    this.arishaToolInput(b, ['payload', 'companyId']);
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.submit(u, b.payload, b.companyId, 'unverified'));
  }

  @Post('arisha/drafts/:id/commit')
  arishaCommitDraft(@UserId() uid: string, @Param('id') id: string, @Body() b: { version: number }) {
    if (!b || !Number.isSafeInteger(b.version) || b.version < 1) throw new BadRequestException('Supply the draft version.');
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.commit(u, id, b.version));
  }

  @Post('arisha/drafts/:id/resubmit')
  arishaResubmitDraft(@UserId() uid: string, @Param('id') id: string, @Body() b: { version: number }) {
    if (!b || !Number.isSafeInteger(b.version) || b.version < 1) throw new BadRequestException('Supply the draft version.');
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.resubmit(u, id, b.version));
  }

  @Post('arisha/drafts/:id/return')
  arishaReturnDraft(@UserId() uid: string, @Param('id') id: string, @Body() b: { version: number }) {
    if (!b || !Number.isSafeInteger(b.version) || b.version < 1) throw new BadRequestException('Supply the draft version.');
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.returnDraft(u, id, b.version));
  }

  /** Leadership pilot AI chat; preparation is independently scoped and never saves records. */
  @Post('arisha')
  async arisha(@UserId() uid: string, @Body() b: { brief?: unknown; history?: unknown }) {
    // Four-person leadership pilot: reject all other callers BEFORE contacting the AI service.
    const user = await this.db.asUser(uid, async (_svc, u) => u);
    if (!arishaPilotAllowed(user)) throw new ForbiddenException('Arisha is restricted to the approved leadership pilot.');
    const cfg = arishaConfig();
    if (!cfg) throw new ServiceUnavailableException('Arisha is not switched on.');
    const brief = str(b.brief, 'brief', 20_000);
    const history: ArishaTurn[] = (Array.isArray(b.history) ? b.history : [])
      .slice(-8)
      .filter((t): t is ArishaTurn => !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      .map((t) => ({ role: t.role, content: t.content.slice(0, 20_000) }));
    const toolSpecs = arishaToolsFor(user);
    const tools = async (name: string, input: Record<string, unknown>) => {
      if (!toolSpecs.some((t) => t.name === name)) throw new ForbiddenException('This tool is not available to your role.');
      if (name === 'executive_summary') return this.arishaSummary(uid, input as { context: string; companyId?: string | null });
      if (name === 'finance_papers') return this.arishaFinanceOptions(uid, input as { companyId: string });
      if (name === 'prepare_finance_paper') return this.arishaPrepareFinance(uid, input);
      if (name === 'record_form') {
        this.arishaToolInput(input, ['kind', 'companyId']);
        const kind = arishaKind(input.kind);
        const companyId = input.companyId == null ? null : str(input.companyId, 'companyId', 60);
        return arishaFormView(await this.db.asUser(uid, (svc, u) => svc.arishaDrafts.form(u, kind, companyId)));
      }
      if (name === 'prepare_record') return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.prepareRecord(u, input));
      throw new BadRequestException('Unknown tool.');
    };
    try {
      return await askArisha(cfg, () => arishaToken.get(), { history, brief, tools, toolSpecs });
    } catch (e) {
      if (e instanceof ArishaBusy) throw new HttpException(e.message, 429);
      console.error('Arisha request failed'); // Do not log prompts, model output, or submitted values.
      throw new ServiceUnavailableException('Arisha could not answer.');
    }
  }

  @Get('me')
  me(@UserId() uid: string) {
    return this.db.asUser(uid, async (svc, user) => ({
      user,
      companies: await svc.visibleCompanies(user),
      now: svc.now(),
      dataMode: dataModeOf(process.env.PRIMA_DATA_MODE),
    }));
  }

  @Get('group/overview')
  overview(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.groupOverview(u));
  }

  @Get('companies/:id/dashboard')
  dashboard(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.companyDashboard(u, id));
  }

  @Get('companies/:id/sites')
  sites(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.sites(u, id));
  }

  @Get('sites/:id')
  site(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.siteDetail(u, id));
  }

  @Get('companies/:id/people')
  people(@UserId() uid: string, @Param('id') id: string, @Query('q') q = '') {
    return this.db.asUser(uid, (svc, u) => svc.people(u, id, String(q).slice(0, 100)));
  }

  @Get('people/:id')
  person(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.personDetail(u, id));
  }

  /** HR or the company office sets a staff member's PIN; only its hash is kept and it is never sent back. */
  @Post('people/:id/pin')
  setStaffPin(@UserId() uid: string, @Param('id') id: string, @Body() b: { pin?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.setStaffPin(u, id.slice(0, 120), str(b.pin, 'pin', 6)));
  }

  /** Offboarding: HR, the HR Director or the CEO closes a person's Prima access from today or a later day. */
  @Post('accounts/:id/close')
  closeAccess(@UserId() uid: string, @Param('id') id: string, @Body() b: { from?: unknown; reason?: unknown }) {
    const from = b.from == null || b.from === '' ? null : date(b.from, 'from');
    return this.db.asUser(uid, (svc, u) => svc.closeAccess(u, id.slice(0, 100), { from, reason: str(b.reason, 'reason', 300) }));
  }

  /** A guard's own sign-in: their details, reminders, roster, clock record and patrol rounds (view only). */
  @Get('me/duty')
  myDuty(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myDuty(u));
  }

  @Get('socso')
  socsoClaims(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.socsoClaims(u));
  }

  @Get('socso/:id')
  socsoClaim(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.socsoClaimDetail(u, id.slice(0, 80)));
  }

  @Post('people/:id/socso')
  startSocso(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const type = SOCSO_TYPES.find((t) => t === b.type);
    if (!type) throw new BadRequestException('unknown case type');
    return this.db.asUser(uid, (svc, u) =>
      svc.startSocsoClaim(u, id, {
        type,
        incidentAt: str(b.incidentAt, 'incidentAt', 40),
        toldAt: str(b.toldAt, 'toldAt', 40),
        place: b.place == null ? '' : str(b.place, 'place', 200),
        description: str(b.description, 'description', 1000),
        witnesses: b.witnesses == null ? '' : str(b.witnesses, 'witnesses', 300),
        caseId: b.caseId == null ? null : str(b.caseId, 'caseId', 80),
      }),
    );
  }

  @Post('socso/:id/documents')
  socsoDoc(@UserId() uid: string, @Param('id') id: string, @Body() b: { item?: unknown; proof?: unknown; mc?: { from?: unknown; to?: unknown } }) {
    const mc = b.mc ? { from: date(b.mc.from, 'mc.from'), to: date(b.mc.to, 'mc.to') } : undefined;
    return this.db.asUser(uid, (svc, u) => svc.addSocsoDoc(u, id, str(b.item, 'item', 20), proofList(b.proof), mc));
  }

  @Post('socso/:id/override')
  socsoOverride(@UserId() uid: string, @Param('id') id: string, @Body() b: { item?: unknown; reason?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.overrideSocsoDoc(u, id, str(b.item, 'item', 20), str(b.reason, 'reason', 300)));
  }

  @Get('fwm')
  fwmBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.fwmBoard(u));
  }

  @Get('fwm/docs/:ref')
  fwmDocs(@UserId() uid: string, @Param('ref') ref: string) {
    return this.db.asUser(uid, (svc, u) => svc.fwmDocs(u, ref.slice(0, 120)));
  }

  @Post('people/:id/hiring-docs')
  hiringDoc(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const kind = HIRING_DOC_KINDS.find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('unknown paper');
    return this.db.asUser(uid, (svc, u) => svc.uploadHiringDoc(u, id, kind, proofList(b.proof)));
  }

  @Get('people/:id/docs')
  personDocs(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.personDocs(u, id));
  }

  @Post('leave/:id/hospital-claim')
  hospitalClaim(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const item = b.item == null ? null : HOSPITAL_DOC_ITEMS.find((k) => k === b.item);
    if (item === undefined) throw new BadRequestException('unknown paper');
    const status = b.status == null ? null : HOSPITAL_DOC_STATUSES.find((k) => k === b.status);
    if (status === undefined) throw new BadRequestException('unknown status');
    const stage = b.stage == null ? null : HOSPITAL_STAGES.find((k) => k === b.stage);
    if (stage === undefined) throw new BadRequestException('unknown stage');
    const input = {
      item,
      status,
      stage,
      insurer: b.insurer == null ? null : str(b.insurer, 'insurer', 80),
      note: b.note == null ? null : str(b.note, 'note', 300),
    };
    return this.db.asUser(uid, (svc, u) => svc.updateHospitalClaim(u, id, input, b.proof == null ? [] : proofList(b.proof)));
  }

  @Post('people/:id/fw-renewals')
  fwRenewal(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const paper = FW_PAPERS.find((p) => p === b.paper);
    if (!paper) throw new BadRequestException('unknown paper');
    return this.db.asUser(uid, (svc, u) =>
      svc.submitFwRenewal(
        u,
        id,
        paper,
        { submittedOn: date(b.submittedOn, 'submittedOn'), channel: str(b.channel, 'channel', 60), note: b.note == null ? '' : str(b.note, 'note', 300) },
        proofList(b.proof),
      ),
    );
  }

  @Post('people/:id/fwm-tasks')
  fwmTask(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const kind = FWM_TASK_KINDS.find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('unknown task kind');
    return this.db.asUser(uid, (svc, u) =>
      svc.createFwmTask(u, id, {
        kind,
        what: str(b.what, 'what', 300),
        place: b.place == null ? '' : str(b.place, 'place', 200),
        dueOn: date(b.dueOn, 'dueOn'),
      }),
    );
  }

  // ----- Hostels and utility excess (Fauzan, 26 Oct 2026) -----
  @Get('hostels')
  hostelBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.hostelBoard(u));
  }

  @Post('hostel-bills')
  addHostelBill(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['RENT', 'ELECTRICITY', 'WATER', 'MAINTENANCE'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('kind must be RENT, ELECTRICITY, WATER or MAINTENANCE');
    if (typeof b.amount !== 'number') throw new BadRequestException('amount must be a number');
    if (typeof b.period !== 'string' || !/^\d{4}-\d{2}$/.test(b.period)) throw new BadRequestException('period must be like 2026-10');
    return this.db.asUser(uid, (svc, u) =>
      svc.addHostelBill(
        u,
        { hostelId: str(b.hostelId, 'hostelId', 120), kind, period: b.period as string, amount: b.amount as number, dueOn: date(b.dueOn, 'dueOn') },
        proofList(b.proof),
      ),
    );
  }

  @Post('hostel-bills/:id/:step')
  hostelBillStep(@UserId() uid: string, @Param('id') id: string, @Param('step') step: string, @Body() b: { ok?: unknown; note?: unknown; proof?: unknown }) {
    const note = b.note == null ? '' : str(b.note, 'note', 300);
    const ok = b.ok !== false;
    const billId = id.slice(0, 160);
    return this.db.asUser(uid, (svc, u) => {
      if (step === 'request') return svc.requestHostelPayment(u, billId, note);
      if (step === 'check') return svc.checkHostelBill(u, billId, ok, note);
      if (step === 'approve') return svc.approveHostelBill(u, billId, ok, note);
      if (step === 'slip') return svc.uploadHostelSlip(u, billId, note, proofList(b.proof));
      throw new BadRequestException('unknown step');
    });
  }

  @Post('utility-charges/:id/decide')
  decideUtility(@UserId() uid: string, @Param('id') id: string, @Body() b: { decision?: unknown; note?: unknown }) {
    const decision = (['NOTICE', 'DEDUCTION'] as const).find((d) => d === b.decision);
    if (!decision) throw new BadRequestException('decision must be NOTICE or DEDUCTION');
    return this.db.asUser(uid, (svc, u) => svc.decideUtilityCharge(u, id.slice(0, 200), decision, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('utility-charges/:id/ack')
  ackUtility(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.ackUtilityNotice(u, id.slice(0, 200)));
  }

  @Post('people/:id/utility-paper')
  utilityPaper(@UserId() uid: string, @Param('id') id: string, @Body() b: { what?: unknown; proof?: unknown }) {
    const what = (['clause', 'ack'] as const).find((w) => w === b.what);
    if (!what) throw new BadRequestException('what must be clause or ack');
    return this.db.asUser(uid, (svc, u) => svc.fileUtilityPaper(u, id.slice(0, 120), what, proofList(b.proof)));
  }

  // ----- Staff claims (Fauzan, 26 Oct 2026) -----
  @Get('claims')
  staffClaims(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffClaims(u));
  }

  @Post('claims')
  submitClaim(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['MEDICAL', 'DENTAL', 'OPTICAL', 'CHECKUP', 'TRAVEL'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('unknown claim kind');
    const t = b.travel as Record<string, unknown> | undefined;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const vehicle = (['CAR', 'MOTORCYCLE', 'COMPANY_CAR'] as const).find((v) => v === t?.vehicle);
    const travel =
      kind === 'TRAVEL' && t
        ? {
            destination: str(t.destination, 'travel.destination', 120),
            tripId: t.tripId == null ? null : str(t.tripId, 'tripId', 160),
            vehicle: vehicle ?? 'CAR',
            kmClaimed: n(t.kmClaimed),
            toll: n(t.toll),
            parking: n(t.parking),
            overnightNights: n(t.overnightNights),
            hotel: n(t.hotel),
            valet: t.valet === true,
          }
        : undefined;
    return this.db.asUser(uid, (svc, u) =>
      svc.submitStaffClaim(
        u,
        {
          kind,
          date: date(b.date, 'date'),
          amount: n(b.amount),
          note: b.note == null ? '' : str(b.note, 'note', 300),
          travel,
          forPersonId: b.forPersonId == null ? null : str(b.forPersonId, 'forPersonId', 120),
        },
        proofList(b.proof),
      ),
    );
  }

  @Post('claims/:id/decide')
  decideClaim(@UserId() uid: string, @Param('id') id: string, @Body() b: { by?: unknown; ok?: unknown; note?: unknown }) {
    if (typeof b.ok !== 'boolean') throw new BadRequestException('ok must be true or false');
    const note = b.note == null ? '' : str(b.note, 'note', 300);
    return this.db.asUser(uid, (svc, u) =>
      b.by === 'finance'
        ? svc.financePayClaim(u, id.slice(0, 160), note)
        : b.by === 'cos'
        ? svc.cosDecideClaim(u, id.slice(0, 160), b.ok as boolean, note)
        : b.by === 'coo'
          ? svc.cooDecideClaim(u, id.slice(0, 160), b.ok as boolean, note)
          : svc.hrDecideClaim(u, id.slice(0, 160), b.ok as boolean, note),
    );
  }

  @Post('claims/trips')
  requestTrip(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.requestTrip(u, {
        date: date(b.date, 'date'),
        destination: str(b.destination ?? '', 'destination', 120),
        purpose: str(b.purpose ?? '', 'purpose', 300),
        forPersonId: b.forPersonId == null ? null : str(b.forPersonId, 'forPersonId', 120),
      }),
    );
  }

  @Post('claims/trips/:id/decide')
  decideTrip(@UserId() uid: string, @Param('id') id: string, @Body() b: { ok?: unknown; note?: unknown }) {
    if (typeof b.ok !== 'boolean') throw new BadRequestException('ok must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.decideTrip(u, id.slice(0, 160), b.ok as boolean, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('claim-rates')
  setClaimRate(@UserId() uid: string, @Body() b: { month?: unknown; vehicle?: unknown; perKm?: unknown }) {
    const vehicle = (['CAR', 'MOTORCYCLE', 'COMPANY_CAR'] as const).find((v) => v === b.vehicle);
    if (!vehicle) throw new BadRequestException('vehicle must be CAR, MOTORCYCLE or COMPANY_CAR');
    if (typeof b.perKm !== 'number') throw new BadRequestException('perKm must be a number');
    return this.db.asUser(uid, (svc, u) => svc.setClaimRate(u, str(b.month, 'month', 7), vehicle, b.perKm as number));
  }

  // ----- Sales leads before quoting (V3 CRM) -----
  @Get('companies/:companyId/leads')
  salesLeads(@UserId() uid: string, @Param('companyId') companyId: string) {
    return this.db.asUser(uid, (svc, u) => svc.salesLeads(u, companyId.slice(0, 40)));
  }

  @Post('companies/:companyId/leads')
  addSalesLead(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addSalesLead(u, companyId.slice(0, 40), {
        prospect: str(b.prospect ?? '', 'prospect', 160),
        sector: str(b.sector ?? 'OTHER', 'sector', 20) as never,
        source: str(b.source ?? '', 'source', 80),
        guardsEst: Number(b.guardsEst),
        estMonthly: b.estMonthly == null || b.estMonthly === '' ? null : Number(b.estMonthly),
        nextOn: b.nextOn ? date(b.nextOn, 'nextOn') : null,
        nextWhat: str(b.nextWhat ?? '', 'nextWhat', 120),
      }),
    );
  }

  @Post('leads/:id/:action')
  salesLeadStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['research', 'survey', 'accept_risk', 'quotation', 'won', 'lost', 'dropped', 'note'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown lead step');
    const opt = (k: string, max: number) => (b[k] == null ? undefined : str(b[k], k, max));
    return this.db.asUser(uid, (svc, u) =>
      svc.salesLeadStep(u, id.slice(0, 160), a, {
        ssmRegNo: opt('ssmRegNo', 40),
        ssmActive: b.ssmActive == null ? undefined : b.ssmActive === true,
        ssmCheckedOn: b.ssmCheckedOn == null ? undefined : date(b.ssmCheckedOn, 'ssmCheckedOn'),
        payment: (['good', 'slow', 'unknown'] as const).find((x) => x === b.payment),
        currentProvider: opt('currentProvider', 120),
        risks: opt('risks', 500),
        armed: b.armed === true,
        on: b.on == null ? undefined : date(b.on, 'on'),
        guardsNeeded: b.guardsNeeded == null ? undefined : Number(b.guardsNeeded),
        hoursPerDay: b.hoursPerDay === 8 ? 8 : 12,
        note: opt('note', 500),
        quotationId: opt('quotationId', 160),
        text: opt('text', 500),
        nextOn: b.nextOn === null ? null : b.nextOn == null || b.nextOn === '' ? undefined : date(b.nextOn, 'nextOn'),
        nextWhat: opt('nextWhat', 120),
      }),
    );
  }

  // ----- Statutory audit and legal matters (V9) -----
  @Get('corporate/audit-legal')
  corpAuditLegal(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.corpAuditLegal(u));
  }

  @Post('corporate/audits/:id/:action')
  corpAuditStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['planning', 'pbc_received', 'add_adjustment', 'agree_adjustment', 'signed'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown audit step');
    const opinion = (['unmodified', 'qualified', 'adverse', 'disclaimer'] as const).find((x) => x === b.opinion);
    return this.db.asUser(uid, (svc, u) =>
      svc.corpAuditStep(u, id.slice(0, 160), a, {
        on: b.on == null ? undefined : date(b.on, 'on'),
        index: b.index == null ? undefined : Number(b.index),
        desc: b.desc == null ? undefined : str(b.desc, 'desc', 200),
        amount: b.amount == null ? undefined : Number(b.amount),
        opinion,
        ref: b.ref == null ? undefined : str(b.ref, 'ref', 60),
      }),
    );
  }

  @Post('corporate/:companyId/legal-matters')
  addLegalMatter(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addLegalMatter(u, companyId.slice(0, 40), {
        title: str(b.title ?? '', 'title', 160),
        kind: str(b.kind ?? 'OTHER', 'kind', 20) as never,
        counterparty: str(b.counterparty ?? '', 'counterparty', 120),
        side: b.side === 'claimant' ? 'claimant' : 'respondent',
        exposure: b.exposure == null || b.exposure === '' ? null : Number(b.exposure),
        lawyer: str(b.lawyer ?? '', 'lawyer', 120),
        nextOn: b.nextOn == null || b.nextOn === '' ? null : date(b.nextOn, 'nextOn'),
        nextWhat: str(b.nextWhat ?? '', 'nextWhat', 120),
      }),
    );
  }

  @Post('corporate/legal-matters/:id/:action')
  legalMatterStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['update', 'fee', 'close'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be update, fee or close');
    return this.db.asUser(uid, (svc, u) =>
      svc.legalMatterStep(u, id.slice(0, 160), a, {
        text: b.text == null ? undefined : str(b.text, 'text', 1000),
        nextOn: b.nextOn == null || b.nextOn === '' ? undefined : date(b.nextOn, 'nextOn'),
        nextWhat: b.nextWhat == null ? undefined : str(b.nextWhat, 'nextWhat', 120),
        amount: b.amount == null ? undefined : Number(b.amount),
        invoiceRef: b.invoiceRef == null ? undefined : str(b.invoiceRef, 'invoiceRef', 40),
        on: b.on == null ? undefined : date(b.on, 'on'),
      }),
    );
  }

  // ----- Business continuity -----
  @Get('continuity')
  bcmBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.bcmBoard(u));
  }

  @Post('continuity/systems/:id/copies/:copy/:kind')
  bcmRecord(@UserId() uid: string, @Param('id') id: string, @Param('copy') copy: string, @Param('kind') kind: string, @Body() b: Record<string, unknown>) {
    const k = (['backup', 'restore'] as const).find((x) => x === kind);
    if (!k) throw new BadRequestException('kind must be backup or restore');
    return this.db.asUser(uid, (svc, u) =>
      svc.bcmRecord(u, id.slice(0, 80), Number(copy) || 0, k, {
        on: b.on == null ? undefined : date(b.on, 'on'),
        ok: b.ok === true,
        hours: b.hours == null ? undefined : Number(b.hours),
        dataLossMinutes: b.dataLossMinutes == null ? undefined : Number(b.dataLossMinutes),
        note: b.note == null ? undefined : str(b.note, 'note', 300),
      }),
    );
  }

  @Post('continuity/playbooks/:id/drills')
  bcmDrill(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.bcmDrill(u, id.slice(0, 40), { on: date(b.on, 'on'), findings: str(b.findings ?? '', 'findings', 1000), actionsOpen: Number(b.actionsOpen) || 0 }),
    );
  }

  // ----- PDPA rights: DPO register and data requests -----
  @Get('pdpa/rights')
  pdpaRights(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.pdpaRights(u));
  }

  @Post('pdpa/dpos/:companyId')
  recordPdpaDpo(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.recordPdpaDpo(u, companyId.slice(0, 40), {
        name: str(b.name ?? '', 'name', 100),
        email: str(b.email ?? '', 'email', 120),
        appointedOn: date(b.appointedOn, 'appointedOn'),
        notifiedOn: b.notifiedOn == null ? null : date(b.notifiedOn, 'notifiedOn'),
        notifyRef: b.notifyRef == null ? null : str(b.notifyRef, 'notifyRef', 60),
        published: b.published === true,
      }),
    );
  }

  @Post('pdpa/requests')
  addPdpaRequest(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addPdpaRequest(u, {
        companyId: str(b.companyId ?? '', 'companyId', 40),
        kind: str(b.kind ?? '', 'kind', 20) as never,
        subjectName: str(b.subjectName ?? '', 'subjectName', 100),
        subjectKind: str(b.subjectKind ?? 'other', 'subjectKind', 10) as never,
        detail: str(b.detail ?? '', 'detail', 500),
        receivedOn: date(b.receivedOn, 'receivedOn'),
      }),
    );
  }

  @Post('pdpa/requests/:id/:action')
  pdpaRequestStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown }) {
    const a = (['verify', 'done', 'refuse'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be verify, done or refuse');
    return this.db.asUser(uid, (svc, u) => svc.pdpaRequestStep(u, id.slice(0, 160), a, str(b.note ?? '', 'note', 300)));
  }

  // ----- Assurance: obligations, OSH, speak up, gifts (V15) -----
  @Get('grc')
  grcBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.grcBoard(u));
  }

  @Post('grc/obligations/:id/evidence')
  grcEvidence(@UserId() uid: string, @Param('id') id: string, @Body() b: { on?: unknown; ref?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.grcEvidence(u, id.slice(0, 160), date(b.on, 'on'), str(b.ref ?? '', 'ref', 120)));
  }

  @Post('grc/obligations/:id/check')
  grcCheck(@UserId() uid: string, @Param('id') id: string, @Body() b: { ok?: unknown; note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.grcCheck(u, id.slice(0, 160), b.ok === true, str(b.note ?? '', 'note', 300)));
  }

  @Post('grc/sites/:siteId/osh')
  recordOshAssessment(@UserId() uid: string, @Param('siteId') siteId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.recordOshAssessment(u, siteId.slice(0, 160), {
        assessedOn: date(b.assessedOn, 'assessedOn'),
        hazards: Number(b.hazards),
        highRisks: Number(b.highRisks),
        controlsRef: str(b.controlsRef ?? '', 'controlsRef', 120),
      }),
    );
  }

  @Post('grc/speak-up')
  submitWhistle(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const implicated = Array.isArray(b.implicatedUserIds) ? b.implicatedUserIds.filter((x) => typeof x === 'string').slice(0, 10) : [];
    const category = (['BRIBERY', 'FRAUD', 'SAFETY', 'HARASSMENT', 'MISCONDUCT', 'OTHER'] as const).find((x) => x === b.category) ?? 'OTHER';
    return this.db.asUser(uid, (svc, u) =>
      svc.submitWhistle(u, {
        anonymous: b.anonymous === true,
        companyId: b.companyId == null ? null : str(b.companyId, 'companyId', 40),
        category,
        summary: str(b.summary ?? '', 'summary', 3000),
        implicatedUserIds: implicated as string[],
      }),
    );
  }

  @Get('grc/speak-up/:code')
  whistleStatus(@UserId() uid: string, @Param('code') code: string) {
    return this.db.asUser(uid, (svc) => svc.whistleStatus(code.slice(0, 20)));
  }

  @Post('grc/reports/:id/:action')
  whistleStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { text?: unknown }) {
    const a = (['acknowledge', 'investigate', 'note', 'close'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be acknowledge, investigate, note or close');
    return this.db.asUser(uid, (svc, u) => svc.whistleStep(u, id.slice(0, 160), a, str(b.text ?? '', 'text', 1000)));
  }

  @Post('grc/reports/:id/review')
  whistleReview(@UserId() uid: string, @Param('id') id: string, @Body() b: { agree?: unknown; note?: unknown }) {
    if (typeof b.agree !== 'boolean') throw new BadRequestException('agree must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.whistleReview(u, id.slice(0, 160), b.agree as boolean, str(b.note ?? '', 'note', 1000)));
  }

  @Post('grc/gifts')
  declareGift(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['CLIENT', 'SUPPLIER', 'PUBLIC_OFFICIAL', 'OTHER'] as const).find((x) => x === b.counterpartyKind) ?? 'OTHER';
    return this.db.asUser(uid, (svc, u) =>
      svc.declareGift(u, {
        companyId: b.companyId == null ? null : str(b.companyId, 'companyId', 40),
        direction: b.direction === 'given' ? 'given' : 'received',
        counterparty: str(b.counterparty ?? '', 'counterparty', 120),
        counterpartyKind: kind,
        description: str(b.description ?? '', 'description', 300),
        value: Number(b.value),
        on: date(b.on, 'on'),
        cash: b.cash === true,
      }),
    );
  }

  @Post('grc/gifts/:id/decide')
  decideGift(@UserId() uid: string, @Param('id') id: string, @Body() b: { outcome?: unknown; note?: unknown }) {
    const o = (['approved', 'return', 'donate', 'refused'] as const).find((x) => x === b.outcome);
    if (!o) throw new BadRequestException('outcome must be approved, return, donate or refused');
    return this.db.asUser(uid, (svc, u) => svc.decideGift(u, id.slice(0, 160), o, str(b.note ?? '', 'note', 300)));
  }

  // ----- Governance and authority (V7, V8, V12) -----
  @Get('governance')
  govBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.govBoard(u));
  }

  @Post('governance/:companyId/mandates')
  addGovMandate(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.powers) || b.powers.length > 20) throw new BadRequestException('powers must be a list');
    const powers = (b.powers as Record<string, unknown>[]).map((p) => ({
      area: str(p?.area ?? '', 'area', 20) as never,
      scope: p?.scope === 'act' ? ('act' as const) : ('monitor' as const),
      limit: p?.limit == null ? null : Number(p.limit),
    }));
    return this.db.asUser(uid, (svc, u) =>
      svc.addGovMandate(u, companyId.slice(0, 40), {
        kind: b.kind === 'BOARD_MANDATE' ? 'BOARD_MANDATE' : 'MANAGEMENT_AGREEMENT',
        ref: str(b.ref ?? '', 'ref', 60),
        title: str(b.title ?? '', 'title', 160),
        signedOn: date(b.signedOn, 'signedOn'),
        validFrom: date(b.validFrom, 'validFrom'),
        validTo: b.validTo == null ? null : date(b.validTo, 'validTo'),
        powers,
      }),
    );
  }

  @Post('governance/mandates/:id/:action')
  govMandateStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { resolutionRef?: unknown; note?: unknown }) {
    const a = (['confirm', 'verify', 'terminate'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be confirm, verify or terminate');
    return this.db.asUser(uid, (svc, u) =>
      svc.govMandateStep(u, id.slice(0, 160), a, {
        resolutionRef: b.resolutionRef == null ? undefined : str(b.resolutionRef, 'resolutionRef', 60),
        note: b.note == null ? undefined : str(b.note, 'note', 300),
      }),
    );
  }

  // ----- Procurement, warehouse and uniforms (V5) -----
  @Get('purchasing')
  purBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.purBoard(u));
  }

  @Post('purchasing/:companyId/requests')
  raisePurRequest(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: { title?: unknown; category?: unknown; lines?: unknown }) {
    if (!Array.isArray(b.lines) || b.lines.length > 30) throw new BadRequestException('lines must be a list of up to 30');
    const lines = (b.lines as Record<string, unknown>[]).map((l) => ({
      item: str(l?.item ?? '', 'item', 80),
      stockItemId: l?.stockItemId == null ? null : str(l.stockItemId, 'stockItemId', 160),
      qty: Number(l?.qty),
      unitPrice: Number(l?.unitPrice),
    }));
    const category = (['UNIFORM', 'GUARD_EQUIPMENT', 'PATROL_DEVICE', 'SERVICES', 'OTHER'] as const).find((x) => x === b.category) ?? 'OTHER';
    return this.db.asUser(uid, (svc, u) => svc.raisePurRequest(u, companyId.slice(0, 40), { title: str(b.title ?? '', 'title', 120), category, lines }));
  }

  @Post('purchasing/requests/:id/:action')
  purStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['quote', 'online', 'submit', 'approve', 'reject', 'order', 'receive', 'invoice', 'post'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown purchasing step');
    const opt = (k: string, max: number) => (b[k] == null ? undefined : str(b[k], k, max));
    if (b.qty != null && (!Array.isArray(b.qty) || b.qty.length > 30)) throw new BadRequestException('qty must be a list');
    return this.db.asUser(uid, (svc, u) =>
      svc.purStep(u, id.slice(0, 160), a, {
        supplierId: opt('supplierId', 160),
        amount: b.amount == null ? undefined : Number(b.amount),
        ref: opt('ref', 60),
        note: opt('note', 300),
        qty: Array.isArray(b.qty) ? b.qty.map(Number) : undefined,
        eInvoiceUuid: opt('eInvoiceUuid', 64),
        number: opt('number', 40),
        sqlRef: opt('sqlRef', 40),
        source: opt('source', 60),
        onlineReason: opt('onlineReason', 300),
        proof: b.proof == null ? undefined : proofList(b.proof),
      }),
    );
  }

  @Post('purchasing/:companyId/suppliers')
  addPurSupplier(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    const categories = Array.isArray(b.categories) ? (b.categories.filter((c) => typeof c === 'string').slice(0, 5) as never[]) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.addPurSupplier(u, companyId.slice(0, 40), {
        name: str(b.name ?? '', 'name', 100),
        ssmNo: str(b.ssmNo ?? '', 'ssmNo', 30),
        categories,
        bankName: str(b.bankName ?? '', 'bankName', 60),
        bankAccount: str(b.bankAccount ?? '', 'bankAccount', 30),
        coiDeclared: b.coiDeclared === true,
        abcAck: b.abcAck === true,
      }),
    );
  }

  @Post('purchasing/suppliers/:id/:action')
  purSupplierStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown }) {
    const a = (['verify_bank', 'review', 'coi', 'abc', 'block', 'unblock'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be verify_bank, review, coi, abc, block or unblock');
    return this.db.asUser(uid, (svc, u) => svc.purSupplierStep(u, id.slice(0, 160), a, str(b.note ?? '', 'note', 300)));
  }

  @Post('purchasing/:companyId/issues')
  stockIssue(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.stockIssue(u, companyId.slice(0, 40), {
        itemId: str(b.itemId ?? '', 'itemId', 160),
        personId: str(b.personId ?? '', 'personId', 160),
        qty: Number(b.qty),
        serial: b.serial == null ? undefined : str(b.serial, 'serial', 60),
      }),
    );
  }

  @Post('purchasing/issues/:id/return')
  stockReturn(@UserId() uid: string, @Param('id') id: string, @Body() b: { condition?: unknown; note?: unknown }) {
    const c = (['good', 'worn', 'damaged', 'lost'] as const).find((x) => x === b.condition);
    if (!c) throw new BadRequestException('condition must be good, worn, damaged or lost');
    return this.db.asUser(uid, (svc, u) => svc.stockReturn(u, id.slice(0, 160), c, str(b.note ?? '', 'note', 300)));
  }

  @Post('purchasing/issues/:id/confirm-loss')
  confirmStockLoss(@UserId() uid: string, @Param('id') id: string, @Body() b: { ok?: unknown; note?: unknown }) {
    if (typeof b.ok !== 'boolean') throw new BadRequestException('ok must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.confirmStockLoss(u, id.slice(0, 160), b.ok as boolean, str(b.note ?? '', 'note', 300)));
  }

  @Post('purchasing/stock/:id/count')
  stockCount(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.stockCount(u, id.slice(0, 160), Number(b.counted), witness(b.witness)));
  }

  // Items issued to me, to confirm in my own details (Fauzan, 27 Oct 2026).
  @Get('me/items')
  myItems(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myItems(u));
  }

  @Post('me/items/:id/:answer')
  confirmMyItem(@UserId() uid: string, @Param('id') id: string, @Param('answer') answer: string, @Body() b: { note?: unknown }) {
    if (answer !== 'received' && answer !== 'not_received') throw new BadRequestException('answer must be received or not_received');
    return this.db.asUser(uid, (svc, u) => svc.confirmMyItem(u, id.slice(0, 160), answer === 'received', str(b.note ?? '', 'note', 300)));
  }

  // ----- PWVSB credit and collateral (V8, V10) -----
  @Get('credit')
  creditBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.creditBoard(u));
  }

  @Post('credit/check')
  runCreditCheck(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.runCreditCheck(u));
  }

  @Post('credit/cases/:id/:action')
  creditDecide(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown }) {
    const a = (['reconciled', 'confirm', 'clear', 'suspend', 'resume'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be reconciled, confirm, clear, suspend or resume');
    return this.db.asUser(uid, (svc, u) => svc.creditDecide(u, id.slice(0, 160), a, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('credit/cases/:id/steps/:no')
  creditEnforcementStep(@UserId() uid: string, @Param('id') id: string, @Param('no') no: string, @Body() b: { note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.creditEnforcementStep(u, id.slice(0, 160), Number(no) || 0, str(b.note ?? '', 'note', 300)));
  }

  @Post('credit/loans/:id/repayments')
  creditRepayment(@UserId() uid: string, @Param('id') id: string, @Body() b: { no?: unknown; amount?: unknown; bankRef?: unknown; paidOn?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.creditRepayment(u, id.slice(0, 160), Number(b.no) || 0, Number(b.amount), str(b.bankRef ?? '', 'bankRef', 60), date(b.paidOn, 'paidOn')),
    );
  }

  @Post('credit/loans/:id/charge')
  creditChargeLodged(@UserId() uid: string, @Param('id') id: string, @Body() b: { ssmRef?: unknown; lodgedOn?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.creditChargeLodged(u, id.slice(0, 160), str(b.ssmRef ?? '', 'ssmRef', 60), date(b.lodgedOn, 'lodgedOn')));
  }

  @Post('credit/loans/:id/dispute/:action')
  creditDispute(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown }) {
    const a = (['raise', 'close'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be raise or close');
    return this.db.asUser(uid, (svc, u) => svc.creditDispute(u, id.slice(0, 160), a, str(b.note ?? '', 'note', 300)));
  }

  @Post('credit/:companyId/loans')
  addCreditLoan(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    const kind = b.kind === 'PAID_ON_BEHALF' ? 'PAID_ON_BEHALF' : 'LOAN';
    const collateral = (['BENEFICIAL_INTEREST', 'ASSET_CHARGE', 'GUARANTEE', 'NONE'] as const).find((x) => x === b.collateral) ?? 'NONE';
    return this.db.asUser(uid, (svc, u) =>
      svc.addCreditLoan(u, companyId.slice(0, 40), {
        kind,
        purpose: str(b.purpose ?? '', 'purpose', 200),
        secured: b.secured === true,
        principal: Number(b.principal),
        ratePct: Number(b.ratePct),
        startOn: date(b.startOn, 'startOn'),
        termMonths: Number(b.termMonths),
        agreementRef: str(b.agreementRef ?? '', 'agreementRef', 80),
        templateId: str(b.templateId ?? '', 'templateId', 40),
        collateral,
        collateralRef: b.collateralRef == null ? null : str(b.collateralRef, 'collateralRef', 80),
        chargeCreatedOn: b.chargeCreatedOn == null ? null : date(b.chargeCreatedOn, 'chargeCreatedOn'),
      }),
    );
  }

  // ----- Company secretary (V9) -----
  @Get('corporate')
  corpBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.corpBoard(u));
  }

  @Post('corporate/filings/:id/:action')
  corpFilingStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { ref?: unknown; on?: unknown }) {
    const a = (['prepare', 'lodge', 'receipt'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be prepare, lodge or receipt');
    return this.db.asUser(uid, (svc, u) =>
      svc.corpFilingStep(u, id.slice(0, 160), a, { ref: b.ref == null ? '' : str(b.ref, 'ref', 60), on: b.on == null ? undefined : date(b.on, 'on') }),
    );
  }

  @Post('corporate/:companyId/changes')
  raiseCorpChange(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.raiseCorpChange(u, companyId.slice(0, 40), {
        kind: str(b.kind, 'kind', 30) as CorpChangeKind,
        title: str(b.title ?? '', 'title', 120),
        detail: str(b.detail ?? '', 'detail', 1000),
      }),
    );
  }

  @Post('corporate/changes/:id/decide')
  decideCorpChange(@UserId() uid: string, @Param('id') id: string, @Body() b: { decision?: unknown; note?: unknown; clauseRef?: unknown }) {
    const d = (['approve', 'reject'] as const).find((x) => x === b.decision);
    if (!d) throw new BadRequestException('decision must be approve or reject');
    return this.db.asUser(uid, (svc, u) =>
      svc.decideCorpChange(
        u,
        id.slice(0, 160),
        d,
        b.note == null ? '' : str(b.note, 'note', 300),
        b.clauseRef == null ? '' : str(b.clauseRef, 'clauseRef', 120),
      ),
    );
  }

  @Post('corporate/changes/:id/board')
  recordCorpBoard(@UserId() uid: string, @Param('id') id: string, @Body() b: { resolutionRef?: unknown; effectiveOn?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.recordCorpBoard(u, id.slice(0, 160), str(b.resolutionRef ?? '', 'resolutionRef', 80), date(b.effectiveOn, 'effectiveOn')),
    );
  }

  // ----- Group website management (Fauzan, 27 Oct 2026) -----
  @Get('websites')
  websiteBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.websites.board(u));
  }

  /**
   * Website connectors (Fauzan, 31 Oct 2026): reads each switched-on, configured service, applies it to the register,
   * never sends mail or Teams notices. IT Head only; the read happens between two short database turns.
   */
  @Post('websites-sync')
  async websiteSync(@UserId() uid: string) {
    const board = await this.db.asUser(uid, (svc, u) => svc.websites.board(u));
    if (!board.allowed || !board.canSync) throw new ForbiddenException('Only IT runs the website connectors.');
    const on = Object.fromEntries(board.integrations.map((i) => [i.key, i.on])) as Record<(typeof board.integrations)[number]['key'], boolean>;
    const feed = await webConnectors.feed(on, board.domains.map((x) => x.domain.name));
    const result = await this.db.asUser(uid, (svc, u) => svc.websites.syncFromFeed(u, feed));
    return { ...result, delivered: 0, deliveryAvailable: false, configured: webConnectorConfig(process.env) };
  }

  /** Flat website tables for the Power BI dashboard (group management and the IT Head, signed in). */
  @Get('websites-powerbi')
  websitePowerBi(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.websites.powerBiFeed(u));
  }

  @Post('websites/:action')
  websiteAction(@UserId() uid: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    if (!/^[a-zA-Z]{2,30}$/.test(action)) throw new BadRequestException('Unknown website action');
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.websites.act(u, action, b));
  }

  // ----- IT department (Fauzan, 27 Oct 2026) -----
  @Get('it')
  itBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.itBoard(u));
  }

  @Get('it/plan')
  itPlan(@UserId() uid: string, @Query('span') span = 'week', @Query('from') from?: string) {
    return this.db.asUser(uid, (svc, u) => svc.itPlan(u, span as 'week' | 'month' | 'year', from));
  }

  @Post('it/tickets')
  raiseItTicket(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.raiseItTicket(u, {
        category: str(b.category, 'category', 10) as ItTicketCategory,
        priority: str(b.priority, 'priority', 2) as 'P1' | 'P2' | 'P3',
        title: str(b.title ?? '', 'title', 120),
        detail: str(b.detail ?? '', 'detail', 1000),
      }),
    );
  }

  @Post('it/tickets/:id/:action')
  itTicketStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown }) {
    const a = (['take', 'resolve'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be take or resolve');
    return this.db.asUser(uid, (svc, u) => svc.itTicketStep(u, id.slice(0, 120), a, b.note == null ? '' : str(b.note, 'note', 500)));
  }

  @Post('it/onboarding/:id/:key')
  setItOnboardingStep(@UserId() uid: string, @Param('id') id: string, @Param('key') key: string, @Body() b: { done?: unknown; evidenceRef?: unknown; expectedVersion?: unknown }) {
    if (!b || typeof b.done !== 'boolean') throw new BadRequestException('Choose record or reopen explicitly.');
    const done = b.done;
    return this.db.asUser(uid, (svc, u) => svc.setItOnboardingStep(u, id.slice(0, 120), key.slice(0, 40), done, typeof b.evidenceRef === 'string' ? b.evidenceRef : '', typeof b.expectedVersion === 'number' ? b.expectedVersion : NaN));
  }

  @Post('it/tenders/:id/:index')
  setItTenderItem(@UserId() uid: string, @Param('id') id: string, @Param('index') index: string, @Body() b: { done?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.setItTenderItem(u, id.slice(0, 120), Number(index) || 0, b.done === true));
  }

  @Post('it/assets/:id')
  setItAsset(@UserId() uid: string, @Param('id') id: string, @Body() b: { status?: unknown; assignedTo?: unknown; note?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.setItAsset(
        u,
        id.slice(0, 120),
        str(b.status, 'status', 20) as ItAsset['status'],
        b.assignedTo == null ? null : str(b.assignedTo, 'assignedTo', 80),
        b.note == null ? '' : str(b.note, 'note', 300),
      ),
    );
  }

  @Post('it/assets/:id/maintenance')
  itMaintenance(@UserId() uid: string, @Param('id') id: string, @Body() b: { kind?: unknown; note?: unknown; cost?: unknown }) {
    const kind = (['service', 'repair'] as const).find((x) => x === b.kind);
    if (!kind) throw new BadRequestException('kind must be service or repair');
    const cost = b.cost === undefined ? 0 : b.cost;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > Number.MAX_SAFE_INTEGER / 100)
      throw new BadRequestException('cost must be a finite nonnegative number representable in cents');
    return this.db.asUser(uid, (svc, u) => svc.itMaintenance(u, id.slice(0, 120), kind, str(b.note ?? '', 'note', 300), cost));
  }

  @Post('it/purchases')
  raiseItPurchase(@UserId() uid: string, @Body() b: { ownerId?: unknown; reason?: unknown; items?: unknown }) {
    if (!Array.isArray(b.items)) throw new BadRequestException('items must be a list');
    return this.db.asUser(uid, (svc, u) =>
      svc.raiseItPurchase(u, {
        ownerId: str(b.ownerId ?? 'pwvsb', 'ownerId', 40),
        reason: str(b.reason ?? '', 'reason', 300),
        items: (b.items as Record<string, unknown>[]).slice(0, 20).map((i) => ({
          kind: String(i.kind) as ItAssetKind,
          description: String(i.description ?? '').slice(0, 80),
          qty: Number(i.qty),
          unitPrice: Number(i.unitPrice),
        })),
      }),
    );
  }

  @Post('it/act/:action')
  itAct(@UserId() uid: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    if (!/^[a-zA-Z]{2,30}$/.test(action)) throw new BadRequestException('Unknown IT action');
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    if (b.proof != null) b.proof = proofList(b.proof);
    return this.db.asUser(uid, (svc, u) => svc.itAct(u, action, b));
  }

  @Post('it/purchases/:id/:action')
  itPurchaseStep(
    @UserId() uid: string,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() b: { note?: unknown },
  ) {
    const a = (['approve', 'reject', 'receive'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be approve, reject or receive');
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    const note = b.note == null ? '' : str(b.note, 'note', 300).trim();
    if ((a === 'approve' || a === 'reject') && note.length < 3) throw new BadRequestException('Give a reason of at least 3 characters to approve or reject.');
    return this.db.asUser(uid, (svc, u) => svc.itPurchaseStep(u, id.slice(0, 120), a, { note }));
  }

  // ----- Branches (V11, V12, V12.1) -----
  @Get('branches')
  branchBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.branchBoard(u));
  }

  @Post('branch-settlements/:id/approve')
  approveBranchSettlement(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.approveBranchSettlement(u, id.slice(0, 120)));
  }

  @Post('branch-actions/:id/review')
  reviewBranchAction(@UserId() uid: string, @Param('id') id: string, @Body() b: { decision?: unknown; note?: unknown }) {
    const d = (['accepted', 'reversed'] as const).find((x) => x === b.decision);
    if (!d) throw new BadRequestException('decision must be accepted or reversed');
    return this.db.asUser(uid, (svc, u) => svc.reviewBranchAction(u, id.slice(0, 120), d, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('branches/:id/agreements')
  addBranchAgreement(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const model = (['A', 'B', 'C'] as const).find((x) => x === b.model);
    if (!model) throw new BadRequestException('model must be A, B or C');
    return this.db.asUser(uid, (svc, u) =>
      svc.addBranchAgreement(u, id.slice(0, 120), {
        effectiveFrom: date(b.effectiveFrom, 'effectiveFrom'),
        model,
        managerName: str(b.managerName ?? '', 'managerName', 80),
        managerKind: b.managerKind === 'partner_company' ? 'partner_company' : 'employee',
        pct: b.pct == null ? null : Number(b.pct),
        managerSalary: b.managerSalary == null ? null : Number(b.managerSalary),
        signedRef: str(b.signedRef ?? '', 'signedRef', 80),
      }),
    );
  }

  // ----- Contracts and site mobilisation (V6 amendment) -----
  @Get('contracts')
  contracts(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.contracts(u));
  }

  @Post('contracts/:id/items/:itemId')
  setMobItem(@UserId() uid: string, @Param('id') id: string, @Param('itemId') itemId: string, @Body() b: Record<string, unknown>) {
    const st = (['open', 'done', 'risk_accepted'] as const).find((x) => x === b.status);
    if (!st) throw new BadRequestException('status must be open, done or risk_accepted');
    return this.db.asUser(uid, (svc, u) =>
      svc.setMobItem(
        u,
        id.slice(0, 120),
        itemId.slice(0, 40),
        st,
        b.note == null ? '' : str(b.note, 'note', 300),
        b.acceptedUntil == null ? null : date(b.acceptedUntil, 'acceptedUntil'),
      ),
    );
  }

  @Post('contracts/:id/step/:action')
  contractStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown }) {
    const a = (['mobilise', 'certify', 'activate', 'suspend', 'resume', 'terminate'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown step');
    return this.db.asUser(uid, (svc, u) => svc.contractStep(u, id.slice(0, 120), a, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('contracts/:id/reviews/:day')
  contractReview(@UserId() uid: string, @Param('id') id: string, @Param('day') day: string, @Body() b: { note?: unknown; invoiceChecked?: unknown }) {
    const d = ([1, 7, 14, 30] as const).find((x) => String(x) === day);
    if (!d) throw new BadRequestException('day must be 1, 7, 14 or 30');
    return this.db.asUser(uid, (svc, u) => svc.contractReview(u, id.slice(0, 120), d, str(b.note, 'note', 500), b.invoiceChecked === true));
  }

  @Post('contracts/:id/variations')
  addContractVariation(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const m = (['M1', 'M2', 'M3', 'FIXED'] as const).find((x) => x === b.billingMethod);
    if (!m) throw new BadRequestException('unknown billing method');
    const posts = Array.isArray(b.posts) ? (b.posts as Record<string, unknown>[]).slice(0, 50) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.addContractVariation(u, id.slice(0, 120), {
        effectiveFrom: date(b.effectiveFrom, 'effectiveFrom'),
        billingMethod: m,
        posts: posts.map((p) => ({
          postId: null,
          label: String(p?.label ?? '').slice(0, 60),
          guards: Number(p?.guards),
          hoursPerDay: Number(p?.hoursPerDay),
          armed: p?.armed === true,
          rate: Number(p?.rate),
          contractedHours: p?.contractedHours == null ? undefined : Number(p.contractedHours),
        })),
        fixedFee: b.fixedFee == null ? null : Number(b.fixedFee),
        signedRef: str(b.signedRef ?? '', 'signedRef', 80),
        reason: str(b.reason ?? '', 'reason', 300),
      }),
    );
  }

  @Post('contracts')
  addContract(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const m = (['M1', 'M2', 'M3', 'FIXED'] as const).find((x) => x === b.billingMethod);
    if (!m) throw new BadRequestException('unknown billing method');
    const sites = Array.isArray(b.siteIds) ? (b.siteIds as unknown[]).slice(0, 50).map((x) => String(x).slice(0, 120)) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.addContract(u, {
        companyId: str(b.companyId, 'companyId', 120),
        clientAccountId: b.clientAccountId == null || b.clientAccountId === '' ? null : str(b.clientAccountId, 'clientAccountId', 120),
        clientName: str(b.clientName ?? '', 'clientName', 120),
        siteIds: sites,
        startOn: date(b.startOn, 'startOn'),
        endOn: date(b.endOn, 'endOn'),
        billingMethod: m,
        rate: Number(b.rate ?? 0),
        fixedFee: b.fixedFee == null ? null : Number(b.fixedFee),
        contractedHours: b.contractedHours == null ? null : Number(b.contractedHours),
        signedRef: str(b.signedRef ?? '', 'signedRef', 80),
      }),
    );
  }

  // ----- Finance monitor over SQL Account (Fauzan, 27 Oct 2026) -----
  @Get('finance')
  finBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.finBoard(u));
  }

  @Post('finance/:companyId/:pack/:itemId')
  setFinPack(
    @UserId() uid: string,
    @Param('companyId') companyId: string,
    @Param('pack') pack: string,
    @Param('itemId') itemId: string,
    @Body() b: { status?: unknown },
  ) {
    const p = (['audit', 'tax'] as const).find((x) => x === pack);
    const st = (['todo', 'prepared', 'reviewed', 'sent'] as const).find((x) => x === b.status);
    if (!p || !st) throw new BadRequestException('pack must be audit or tax; status todo, prepared, reviewed or sent');
    return this.db.asUser(uid, (svc, u) => svc.setFinPack(u, companyId.slice(0, 120), p, itemId.slice(0, 60), st));
  }

  // ----- Staff payroll (Fauzan, 27 Oct 2026) -----
  @Get('staff-pay')
  staffPayroll(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffPayroll(u));
  }

  @Get('staff-pay/:id')
  staffPayRun(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffPayRun(u, id.slice(0, 120)));
  }

  @Post('staff-pay')
  prepareStaffPay(@UserId() uid: string, @Body() b: { companyId?: unknown; period?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.prepareStaffPay(u, str(b.companyId, 'companyId', 120), str(b.period, 'period', 7)));
  }

  @Post('staff-pay/:id/lines/:personId')
  setStaffPayLine(@UserId() uid: string, @Param('id') id: string, @Param('personId') personId: string, @Body() b: Record<string, unknown>) {
    const pcb = b.pcb === undefined ? undefined : b.pcb === null ? null : Number(b.pcb);
    const extra = Array.isArray(b.extra)
      ? b.extra.slice(0, 10).map((a: Record<string, unknown>) => ({ label: String(a?.label ?? '').slice(0, 60), amount: Number(a?.amount) }))
      : undefined;
    return this.db.asUser(uid, (svc, u) => svc.setStaffPayLine(u, id.slice(0, 120), personId.slice(0, 120), { pcb, extra }));
  }

  @Post('staff-pay/:id/files/:kind')
  staffPayExport(@UserId() uid: string, @Param('id') id: string, @Param('kind') kind: string) {
    const k = (['bank', 'sql', 'epf', 'socso', 'pcb'] as const).find((x) => x === kind);
    if (!k) throw new BadRequestException('unknown file');
    return this.db.asUser(uid, (svc, u) => svc.staffPayExport(u, id.slice(0, 120), k));
  }

  @Post('staff-pay/:id/:action')
  staffPayStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['submit', 'approve', 'consent', 'pay', 'return'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown step');
    return this.db.asUser(uid, (svc, u) =>
      svc.staffPayStep(u, id.slice(0, 120), a, {
        note: b.note == null ? '' : str(b.note, 'note', 500),
        bankRef: b.bankRef == null ? undefined : str(b.bankRef, 'bankRef', 60),
        paidOn: b.paidOn == null ? undefined : date(b.paidOn, 'paidOn'),
        pcbChecked: b.pcbChecked === true,
      }),
    );
  }

  // ----- Asset Management, read-only model for the developer (Fauzan, 26 Oct 2026) -----
  @Get('assets')
  amBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.amBoard(u));
  }

  // ----- ACT: Audit, Compliance and Transformation (Fauzan, 27 Oct 2026) -----
  @Get('act')
  actBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.actBoard(u));
  }

  @Post('act/findings')
  raiseActFinding(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.raiseActFinding(u, {
        companyId: b.companyId ? str(b.companyId, 'companyId', 40) : null,
        area: str(b.area ?? '', 'area', 20),
        source: str(b.source ?? 'manual', 'source', 20) as never,
        title: str(b.title ?? '', 'title', 160),
        detail: str(b.detail ?? '', 'detail', 1000),
        severity: str(b.severity ?? 'medium', 'severity', 10) as never,
        evidence: str(b.evidence ?? '', 'evidence', 500),
        ownerUserId: str(b.ownerUserId ?? '', 'ownerUserId', 80),
      }),
    );
  }

  @Post('act/findings/:id/:action')
  actFindingStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['plan', 'fixed', 'check'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown finding step');
    const opt = (k: string, max: number) => (b[k] == null ? undefined : str(b[k], k, max));
    return this.db.asUser(uid, (svc, u) =>
      svc.actFindingStep(u, id.slice(0, 80), a, {
        rootCause: opt('rootCause', 500),
        solution: opt('solution', 500),
        targetOn: b.targetOn == null ? undefined : date(b.targetOn, 'targetOn'),
        proof: opt('proof', 500),
        ok: b.ok === true,
        note: opt('note', 500),
      }),
    );
  }

  @Post('act/audits')
  recordActAudit(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.recordActAudit(u, {
        area: str(b.area ?? '', 'area', 20),
        companyId: b.companyId ? str(b.companyId, 'companyId', 40) : null,
        doneOn: date(b.doneOn, 'doneOn'),
        result: b.result === 'findings' ? 'findings' : 'clean',
        note: str(b.note ?? '', 'note', 500),
      }),
    );
  }

  @Post('act/improvements')
  addActImprovement(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addActImprovement(u, {
        title: str(b.title ?? '', 'title', 160),
        benefit: str(b.benefit ?? '', 'benefit', 300),
        findingIds: Array.isArray(b.findingIds) ? b.findingIds.slice(0, 20).map((x) => str(x, 'findingIds', 80)) : [],
        ownerUserId: str(b.ownerUserId ?? '', 'ownerUserId', 80),
        targetOn: date(b.targetOn, 'targetOn'),
        steps: Array.isArray(b.steps) ? b.steps.slice(0, 12).map((x) => str(x, 'steps', 200)) : [],
      }),
    );
  }

  @Post('act/improvements/:id/:action')
  actImprovementStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['approve', 'step', 'result'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown improvement step');
    return this.db.asUser(uid, (svc, u) =>
      svc.actImprovementStep(u, id.slice(0, 80), a, {
        index: b.index == null ? undefined : Number(b.index),
        note: b.note == null ? undefined : str(b.note, 'note', 500),
      }),
    );
  }

  // ----- Fixed assets: depreciation journals and disposals (V5) -----
  @Get('assets/fixed')
  fixedAssets(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.fixedAssets(u));
  }

  @Post('assets/depreciation')
  postDepreciation(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.postDepreciation(u, str(b.ownerEntity ?? '', 'ownerEntity', 120), str(b.period ?? '', 'period', 7), str(b.sqlRef ?? '', 'sqlRef', 40)),
    );
  }

  @Post('assets/:id/disposal/:action')
  amDisposalStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['ask', 'approve', 'reject', 'done', 'post'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown disposal step');
    const opt = (k: string, max: number) => (b[k] == null ? undefined : str(b[k], k, max));
    return this.db.asUser(uid, (svc, u) =>
      svc.amDisposalStep(u, id.slice(0, 80), a, {
        reason: opt('reason', 300),
        method: (['SALE', 'SCRAP', 'DONATE', 'WRITE_OFF', 'TRADE_IN'] as const).find((x) => x === b.method),
        estProceeds: b.estProceeds == null ? undefined : Number(b.estProceeds),
        note: opt('note', 300),
        on: b.on == null ? undefined : date(b.on, 'on'),
        proceeds: b.proceeds == null ? undefined : Number(b.proceeds),
        party: opt('party', 120),
        proofRef: opt('proofRef', 60),
        sqlRef: opt('sqlRef', 40),
      }),
    );
  }

  // ----- Staff pay changes: HR proposes, the Chief of Staff or Deputy verifies (Fauzan, 27 Oct 2026) -----
  @Get('pay-changes')
  payChanges(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.payChanges(u));
  }

  @Post('pay-changes/:id/:decision')
  decidePayChange(@UserId() uid: string, @Param('id') id: string, @Param('decision') decision: string, @Body() b: { note?: unknown }) {
    if (decision !== 'verify' && decision !== 'reject') throw new BadRequestException('verify or reject');
    return this.db.asUser(uid, (svc, u) => svc.decidePayChange(u, id.slice(0, 80), decision === 'verify', b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Get('records/kinds')
  recordKinds(@UserId() uid: string) {
    return this.db.asUser(uid, async (svc, u) => svc.recordKindsFor(u));
  }

  @Get('records/:kind/form')
  recordForm(@UserId() uid: string, @Param('kind') kind: string, @Query('id') id?: string, @Query('companyId') companyId?: string) {
    if (!(kind in RECORD_KINDS)) throw new BadRequestException('unknown kind of record');
    return this.db.asUser(uid, (svc, u) => svc.recordForm(u, kind as RecordKind, id ? id.slice(0, 120) : null, companyId ? companyId.slice(0, 60) : null));
  }

  @Post('records/:kind')
  saveRecord(@UserId() uid: string, @Param('kind') kind: string, @Body() b: { id?: unknown; companyId?: unknown; values?: unknown }) {
    if (!(kind in RECORD_KINDS)) throw new BadRequestException('unknown kind of record');
    const values = b.values && typeof b.values === 'object' && !Array.isArray(b.values) ? (b.values as RecordValues) : {};
    if (Object.keys(values).length > 40) throw new BadRequestException('too many values');
    for (const v of Object.values(values))
      if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw new BadRequestException('values must be text, numbers or yes/no');
    return this.db.asUser(uid, (svc, u) =>
      svc.saveRecord(u, kind as RecordKind, b.id == null ? null : str(b.id, 'id', 120), b.companyId == null ? null : str(b.companyId, 'companyId', 60), values),
    );
  }

  @Post('asset-units/:id/payments')
  amRecordPayment(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const method = (['CASH', 'TRANSFER', 'CHEQUE', 'ONLINE'] as const).find((x) => x === b.method);
    if (!method) throw new BadRequestException('method');
    return this.db.asUser(uid, (svc, u) =>
      svc.amRecordPayment(u, id.slice(0, 80), {
        amount: Number(b.amount),
        method,
        on: date(b.on, 'on'),
        ref: b.ref == null ? '' : str(b.ref, 'ref', 60),
      }),
    );
  }

  @Post('asset-units/:id/payments/:pid/reverse')
  amReversePayment(@UserId() uid: string, @Param('id') id: string, @Param('pid') pid: string, @Body() b: { reason?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.amReversePayment(u, id.slice(0, 80), pid.slice(0, 120), str(b.reason, 'reason', 300)));
  }

  @Post('asset-units/:id/payments/:pid/reversal')
  amDecideReversal(@UserId() uid: string, @Param('id') id: string, @Param('pid') pid: string, @Body() b: { approve?: unknown; note?: unknown }) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.amDecideReversal(u, id.slice(0, 80), pid.slice(0, 120), b.approve as boolean, str(b.note ?? '', 'note', 300)));
  }

  @Post('asset-units/:id/payments/:pid/bank')
  amBankCash(@UserId() uid: string, @Param('id') id: string, @Param('pid') pid: string, @Body() b: { on?: unknown; slipRef?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.amBankCash(u, id.slice(0, 80), pid.slice(0, 120), { on: date(b.on, 'on'), slipRef: str(b.slipRef, 'slipRef', 40) }),
    );
  }

  @Post('asset-units/:id/follow-ups')
  amFollowUp(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const action = (['CALL', 'MESSAGE', 'VISIT', 'PROMISE', 'LETTER', 'NOTICE', 'NOTE'] as const).find((x) => x === b.action);
    if (!action) throw new BadRequestException('action');
    return this.db.asUser(uid, (svc, u) =>
      svc.amFollowUp(u, id.slice(0, 80), { action, note: str(b.note, 'note', 400), promiseOn: b.promiseOn == null ? null : date(b.promiseOn, 'promiseOn') }),
    );
  }

  @Post('asset-units/:id/follow-ups/:fid/:decision')
  amDecideLetter(
    @UserId() uid: string,
    @Param('id') id: string,
    @Param('fid') fid: string,
    @Param('decision') decision: string,
    @Body() b: { note?: unknown },
  ) {
    if (decision !== 'approve' && decision !== 'stop') throw new BadRequestException('approve or stop');
    return this.db.asUser(uid, (svc, u) =>
      svc.amDecideLetter(u, id.slice(0, 80), fid.slice(0, 120), decision === 'approve', b.note == null ? '' : str(b.note, 'note', 300)),
    );
  }

  @Post('assets/:id/life/:decision')
  amLifeReview(@UserId() uid: string, @Param('id') id: string, @Param('decision') decision: string, @Body() b: { note?: unknown; cost?: unknown }) {
    const d = (['keep', 'rehab'] as const).find((x) => x === decision);
    if (!d) throw new BadRequestException('keep or rehab');
    return this.db.asUser(uid, (svc, u) =>
      svc.amLifeReview(u, id.slice(0, 80), d, { note: b.note == null ? '' : str(b.note, 'note', 300), cost: b.cost == null ? undefined : Number(b.cost) }),
    );
  }

  // ----- JA Group app data, read-only (Fauzan, 26 Oct 2026) -----
  @Get('ja')
  jaBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.jaBoard(u));
  }

  // ----- Client board (Fauzan, 26 Oct 2026) -----
  @Get('clients')
  clientBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.clientBoard(u));
  }

  @Post('clients/:id/step')
  clientStep(@UserId() uid: string, @Param('id') id: string, @Body() b: { phase?: unknown; key?: unknown; note?: unknown; proof?: unknown }) {
    const phase = (['onboarding', 'offboarding'] as const).find((p) => p === b.phase);
    if (!phase) throw new BadRequestException('phase must be onboarding or offboarding');
    return this.db.asUser(uid, (svc, u) =>
      svc.clientStep(u, id.slice(0, 120), phase, str(b.key, 'key', 30), b.note == null ? '' : str(b.note, 'note', 300), proofList(b.proof)),
    );
  }

  @Post('clients')
  addClientAccount(@UserId() uid: string, @Body() b: { companyId?: unknown; name?: unknown; siteIds?: unknown; contractEndsOn?: unknown }) {
    const sites = Array.isArray(b.siteIds) ? (b.siteIds as unknown[]).slice(0, 50).map((x) => String(x).slice(0, 120)) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.addClientAccount(u, {
        companyId: str(b.companyId, 'companyId', 120),
        name: str(b.name, 'name', 120),
        siteIds: sites,
        contractEndsOn: b.contractEndsOn == null || b.contractEndsOn === '' ? null : date(b.contractEndsOn, 'contractEndsOn'),
      }),
    );
  }

  @Post('clients/:id/offboard')
  startOffboarding(@UserId() uid: string, @Param('id') id: string, @Body() b: { reason?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.startOffboarding(u, id.slice(0, 120), str(b.reason, 'reason', 300)));
  }

  @Post('clients/:id/contact')
  clientContact(@UserId() uid: string, @Param('id') id: string, @Body() b: { kind?: unknown; note?: unknown }) {
    const kind = (['visit', 'meeting', 'call'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('kind must be visit, meeting or call');
    return this.db.asUser(uid, (svc, u) => svc.clientContact(u, id.slice(0, 120), kind, str(b.note, 'note', 500)));
  }

  @Post('clients/:id/report')
  clientReport(@UserId() uid: string, @Param('id') id: string, @Body() b: { period?: unknown; proof?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.clientReport(u, id.slice(0, 120), str(b.period, 'period', 7), proofList(b.proof)));
  }

  @Post('clients/:id/rating')
  clientRating(@UserId() uid: string, @Param('id') id: string, @Body() b: { score?: unknown; comment?: unknown }) {
    if (typeof b.score !== 'number') throw new BadRequestException('score must be a number');
    return this.db.asUser(uid, (svc, u) => svc.clientRating(u, id.slice(0, 120), b.score as number, b.comment == null ? '' : str(b.comment, 'comment', 500)));
  }

  @Post('clients/:id/invoice')
  clientInvoice(@UserId() uid: string, @Param('id') id: string, @Body() b: { period?: unknown; channel?: unknown; amount?: unknown; proof?: unknown }) {
    const channel = (['hand', 'email', 'portal'] as const).find((c) => c === b.channel);
    if (!channel) throw new BadRequestException('channel must be hand, email or portal');
    const amount = typeof b.amount === 'number' ? b.amount : null;
    return this.db.asUser(uid, (svc, u) => svc.clientInvoice(u, id.slice(0, 120), str(b.period, 'period', 7), channel, amount, proofList(b.proof)));
  }

  @Post('clients/:id/portal')
  setInvoicePortal(@UserId() uid: string, @Param('id') id: string, @Body() b: { portal?: unknown }) {
    const portal = b.portal == null || b.portal === '' ? null : str(b.portal, 'portal', 60);
    return this.db.asUser(uid, (svc, u) => svc.setInvoicePortal(u, id.slice(0, 120), portal));
  }

  // ----- Operation claims and office requests (Fauzan, 26 Oct 2026) -----
  @Get('requests')
  expenseBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.expenseBoard(u));
  }

  @Post('requests')
  saveExpense(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['OPS_CLAIM', 'OFFICE'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('kind must be OPS_CLAIM or OFFICE');
    const category = (['SUPPLIES', 'UTILITIES', 'RENT'] as const).find((k) => k === b.category) ?? null;
    if (!Array.isArray(b.lines) || b.lines.length > 50) throw new BadRequestException('lines must be a list');
    const lines = (b.lines as Record<string, unknown>[]).map((l, i) => ({
      item: str(l?.item, `lines[${i}].item`, 120),
      amount: typeof l?.amount === 'number' ? l.amount : 0,
      note: l?.note == null ? '' : str(l.note, `lines[${i}].note`, 200),
    }));
    return this.db.asUser(uid, (svc, u) =>
      svc.saveExpense(
        u,
        {
          id: b.id == null || b.id === '' ? null : str(b.id, 'id', 120),
          kind,
          companyId: str(b.companyId, 'companyId', 60),
          period: str(b.period, 'period', 7),
          category,
          lines,
          notAsset: b.notAsset === true,
        },
        proofList(b.proof),
      ),
    );
  }

  @Post('requests/:id/submit')
  submitExpense(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.submitExpense(u, id.slice(0, 120)));
  }

  @Post('requests/:id/decide')
  decideExpense(@UserId() uid: string, @Param('id') id: string, @Body() b: { decision?: unknown; note?: unknown }) {
    const decision = (['approve', 'return', 'reject'] as const).find((d) => d === b.decision);
    if (!decision) throw new BadRequestException('decision must be approve, return or reject');
    return this.db.asUser(uid, (svc, u) => svc.decideExpense(u, id.slice(0, 120), decision, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Get('requests/:id/docs')
  expenseDocs(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.expenseDocs(u, id.slice(0, 120)));
  }

  @Post('clients/:id/billing')
  clientBilling(@UserId() uid: string, @Param('id') id: string, @Body() b: { invoicedTo?: unknown; overdueAmount?: unknown; overdueDays?: unknown }) {
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return this.db.asUser(uid, (svc, u) =>
      svc.clientBilling(u, id.slice(0, 120), {
        invoicedTo: b.invoicedTo == null || b.invoicedTo === '' ? null : str(b.invoicedTo, 'invoicedTo', 7),
        overdueAmount: n(b.overdueAmount),
        overdueDays: n(b.overdueDays),
      }),
    );
  }

  // ----- Fleet (Fauzan, 26 Oct 2026) -----
  @Get('fleet')
  fleetBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.fleetBoard(u));
  }

  @Post('fleet/requests')
  requestVehicle(@UserId() uid: string, @Body() b: { vehicleId?: unknown; purpose?: unknown; from?: unknown; to?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.requestVehicle(u, {
        vehicleId: b.vehicleId == null || b.vehicleId === '' ? null : str(b.vehicleId, 'vehicleId', 60),
        purpose: str(b.purpose, 'purpose', 200),
        from: str(b.from, 'from', 40),
        to: str(b.to, 'to', 40),
      }),
    );
  }

  @Post('fleet/requests/:id/decide')
  decideVehicleRequest(@UserId() uid: string, @Param('id') id: string, @Body() b: { ok?: unknown; vehicleId?: unknown; note?: unknown }) {
    if (typeof b.ok !== 'boolean') throw new BadRequestException('ok must be true or false');
    const vehicleId = b.vehicleId == null || b.vehicleId === '' ? null : str(b.vehicleId, 'vehicleId', 60);
    return this.db.asUser(uid, (svc, u) =>
      svc.decideVehicleRequest(u, id.slice(0, 120), b.ok as boolean, vehicleId, b.note == null ? '' : str(b.note, 'note', 300)),
    );
  }

  @Post('fleet/vehicles/:id/out')
  vehicleOut(@UserId() uid: string, @Param('id') id: string, @Body() b: { requestId?: unknown; km?: unknown; driver?: unknown }) {
    if (typeof b.km !== 'number') throw new BadRequestException('km must be a number');
    const requestId = b.requestId == null || b.requestId === '' ? null : str(b.requestId, 'requestId', 120);
    const driver = b.driver == null ? undefined : str(b.driver, 'driver', 80);
    return this.db.asUser(uid, (svc, u) => svc.vehicleOut(u, id.slice(0, 60), requestId, b.km as number, driver));
  }

  @Post('fleet/vehicles/:id/in')
  vehicleIn(@UserId() uid: string, @Param('id') id: string, @Body() b: { km?: unknown; note?: unknown }) {
    if (typeof b.km !== 'number') throw new BadRequestException('km must be a number');
    return this.db.asUser(uid, (svc, u) => svc.vehicleIn(u, id.slice(0, 60), b.km as number, b.note == null ? '' : str(b.note, 'note', 200)));
  }

  @Post('fleet/vehicles/:id/work')
  vehicleWork(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const kind = (['RENEWAL', 'SERVICE', 'PAYMENT'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('kind must be RENEWAL, SERVICE or PAYMENT');
    const renewal = (['ROAD_TAX', 'INSURANCE', 'PUSPAKOM', 'PERMIT'] as const).find((k) => k === b.renewal);
    return this.db.asUser(uid, (svc, u) =>
      svc.recordVehicleWork(
        u,
        id.slice(0, 60),
        {
          kind,
          renewal,
          nextDue: b.nextDue == null ? undefined : date(b.nextDue, 'nextDue'),
          nextDueKm: typeof b.nextDueKm === 'number' ? b.nextDueKm : undefined,
          period: b.period == null ? undefined : str(b.period, 'period', 7),
          note: b.note == null ? undefined : str(b.note, 'note', 200),
        },
        proofList(b.proof),
      ),
    );
  }

  @Post('people/:id/monitoring-consent')
  monitoringConsent(@UserId() uid: string, @Param('id') id: string, @Body() b: { proof?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.fileMonitoringConsent(u, id.slice(0, 120), proofList(b.proof)));
  }

  // ----- Products and certificates (Fauzan, 26 Oct 2026) -----
  @Get('products')
  productBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.productBoard(u));
  }

  @Post('products')
  saveProduct(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const mode = (['SALE', 'RENTAL', 'BOTH'] as const).find((m) => m === b.mode);
    if (!mode) throw new BadRequestException('mode must be SALE, RENTAL or BOTH');
    if (b.personalData != null && (!Array.isArray(b.personalData) || b.personalData.length > 20)) throw new BadRequestException('personalData must be a list');
    return this.db.asUser(uid, (svc, u) =>
      svc.saveProduct(u, {
        id: b.id == null || b.id === '' ? null : str(b.id, 'id', 120),
        name: str(b.name, 'name', 120),
        category: b.category == null ? '' : str(b.category, 'category', 60),
        mode,
        supplier: b.supplier == null ? '' : str(b.supplier, 'supplier', 120),
        personalData: ((b.personalData as unknown[] | undefined) ?? []).map((x, i) => str(x, `personalData[${i}]`, 80)),
        retentionDays: typeof b.retentionDays === 'number' ? b.retentionDays : null,
        clientConsent: b.clientConsent === true,
        notes: b.notes == null ? '' : str(b.notes, 'notes', 1000),
      }),
    );
  }

  @Post('products/:id/certs')
  saveProductCert(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const body = (['MySTI', 'SIRIM', 'MCMC', 'OTHER'] as const).find((x) => x === b.body);
    const status = (['valid', 'applying', 'not_started'] as const).find((x) => x === b.status);
    if (!body || !status) throw new BadRequestException('body and status are required');
    return this.db.asUser(uid, (svc, u) =>
      svc.saveProductCert(
        u,
        id.slice(0, 120),
        {
          certId: b.certId == null || b.certId === '' ? null : str(b.certId, 'certId', 120),
          body,
          scheme: b.scheme == null ? '' : str(b.scheme, 'scheme', 120),
          ref: b.ref == null ? '' : str(b.ref, 'ref', 80),
          status,
          expiresOn: b.expiresOn == null || b.expiresOn === '' ? null : date(b.expiresOn, 'expiresOn'),
          procedure: b.procedure == null ? '' : str(b.procedure, 'procedure', 2000),
        },
        proofList(b.proof),
      ),
    );
  }

  @Post('proposal-check')
  proposalReadiness(@UserId() uid: string, @Body() b: { productIds?: unknown }) {
    if (!Array.isArray(b.productIds) || b.productIds.length > 50) throw new BadRequestException('productIds must be a list');
    const ids = (b.productIds as unknown[]).map((x, i) => str(x, `productIds[${i}]`, 120));
    return this.db.asUser(uid, (svc, u) => svc.proposalReadiness(u, ids));
  }

  // ----- PDPA (Fauzan, 26 Oct 2026) -----
  @Get('pdpa')
  pdpaBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.pdpaBoard(u));
  }

  @Post('pdpa')
  openPdpaCase(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['BREACH', 'CLIENT_CONSENT', 'SOCIAL'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('kind must be BREACH, CLIENT_CONSENT or SOCIAL');
    const opt = (v: unknown, name: string, max: number) => (v == null || v === '' ? undefined : str(v, name, max));
    const risk = (['low', 'medium', 'high'] as const).find((r) => r === b.risk);
    return this.db.asUser(uid, (svc, u) =>
      svc.openPdpaCase(u, {
        kind,
        companyId: opt(b.companyId, 'companyId', 60) ?? null,
        title: str(b.title, 'title', 160),
        detail: opt(b.detail, 'detail', 2000) ?? '',
        detectedAt: opt(b.detectedAt, 'detectedAt', 40),
        affected: typeof b.affected === 'number' ? b.affected : undefined,
        significantHarm: b.significantHarm === true,
        client: opt(b.client, 'client', 120),
        product: opt(b.product, 'product', 120),
        platform: opt(b.platform, 'platform', 40),
        link: opt(b.link, 'link', 300),
        risk,
      }),
    );
  }

  @Post('pdpa/:id/:step')
  pdpaStep(@UserId() uid: string, @Param('id') id: string, @Param('step') step: string, @Body() b: { note?: unknown; proof?: unknown }) {
    const s = (['note', 'contained', 'commissioner', 'subjects', 'advised', 'consent_given', 'consent_refused', 'close'] as const).find((x) => x === step);
    if (!s) throw new BadRequestException('unknown PDPA step');
    return this.db.asUser(uid, (svc, u) => svc.pdpaStep(u, id.slice(0, 120), s, b.note == null ? '' : str(b.note, 'note', 500), proofList(b.proof)));
  }

  @Get('pdpa/:id/docs')
  pdpaDocs(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.pdpaDocs(u, id.slice(0, 120)));
  }

  // ----- Memos (Fauzan, 26 Oct 2026) -----
  @Get('memos')
  memos(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.memos(u));
  }

  @Post('memos')
  publishMemo(@UserId() uid: string, @Body() b: { audience?: unknown; title?: unknown; body?: unknown; states?: unknown }) {
    const audience = (['STAFF', 'FIELD'] as const).find((a) => a === b.audience);
    if (!audience) throw new BadRequestException('audience must be STAFF or FIELD');
    if (b.states != null && (!Array.isArray(b.states) || b.states.length > 20)) throw new BadRequestException('states must be a list');
    const states = ((b.states as unknown[] | undefined) ?? []).map((s, i) => str(s, `states[${i}]`, 40));
    return this.db.asUser(uid, (svc, u) => svc.publishMemo(u, audience, str(b.title, 'title', 120), str(b.body, 'body', 5000), states));
  }

  @Post('memos/:id/read')
  readMemo(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.readMemo(u, id.slice(0, 120)));
  }

  @Post('fwm-tasks/:id/done')
  fwmTaskDone(@UserId() uid: string, @Param('id') id: string, @Body() b: { note?: unknown; proof?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.doneFwmTask(u, id.slice(0, 120), b.note == null ? '' : str(b.note, 'note', 300), proofList(b.proof)));
  }

  @Post('fwm-tasks/:id/review')
  fwmTaskReview(@UserId() uid: string, @Param('id') id: string, @Body() b: { accept?: unknown; note?: unknown }) {
    if (typeof b.accept !== 'boolean') throw new BadRequestException('accept must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.reviewFwmTask(u, id.slice(0, 120), b.accept as boolean, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('socso/:id/rehab')
  socsoRehab(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const opt = (v: unknown, name: string) => (v === undefined ? undefined : v === null || v === '' ? null : date(v, name));
    const cm = b.caseManager as { name?: unknown; phone?: unknown } | null | undefined;
    return this.db.asUser(uid, (svc, u) =>
      svc.setSocsoRehab(u, id, {
        rtwRequestedOn: opt(b.rtwRequestedOn, 'rtwRequestedOn'),
        referralOn: opt(b.referralOn, 'referralOn'),
        targetReturn: opt(b.targetReturn, 'targetReturn'),
        plan: b.plan === undefined ? undefined : str(b.plan ?? '', 'plan', 1000),
        caseManager:
          cm === undefined
            ? undefined
            : cm === null
              ? null
              : { name: str(cm.name ?? '', 'caseManager.name', 100), phone: str(cm.phone ?? '', 'caseManager.phone', 30) },
      }),
    );
  }

  @Post('socso/:id/appointments')
  socsoAppointment(@UserId() uid: string, @Param('id') id: string, @Body() b: { at?: unknown; what?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.addSocsoAppointment(u, id, { at: str(b.at, 'at', 40), what: str(b.what, 'what', 200) }));
  }

  @Post('socso/:id/restrictions')
  socsoRestriction(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const kind = SOCSO_RESTRICTIONS.find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('unknown restriction');
    return this.db.asUser(uid, (svc, u) =>
      svc.addSocsoRestriction(u, id, {
        kind,
        note: b.note == null ? '' : str(b.note, 'note', 200),
        from: date(b.from, 'from'),
        until: b.until == null || b.until === '' ? null : date(b.until, 'until'),
      }),
    );
  }

  @Post('socso/:id/restrictions/:rid/clear')
  socsoClear(@UserId() uid: string, @Param('id') id: string, @Param('rid') rid: string, @Body() b: { note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.clearSocsoRestriction(u, id, rid.slice(0, 80), str(b.note, 'note', 300)));
  }

  @Post('socso/:id/checkins')
  socsoCheckIn(@UserId() uid: string, @Param('id') id: string, @Body() b: { note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.addSocsoCheckIn(u, id, str(b.note, 'note', 300)));
  }

  @Post('socso/:id/status')
  socsoStatus(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const to = SOCSO_STATUSES.find((t) => t === b.to);
    if (!to) throw new BadRequestException('unknown status');
    return this.db.asUser(uid, (svc, u) =>
      svc.advanceSocsoClaim(u, id, to, {
        perkesoRef: b.perkesoRef == null ? undefined : str(b.perkesoRef, 'perkesoRef', 40),
        note: b.note == null ? undefined : str(b.note, 'note', 500),
        on: b.on == null ? undefined : date(b.on, 'on'),
        amountPaid: typeof b.amountPaid === 'number' && Number.isFinite(b.amountPaid) ? b.amountPaid : null,
        returnToWork: b.returnToWork == null || b.returnToWork === '' ? null : date(b.returnToWork, 'returnToWork'),
      }),
    );
  }

  @Get('me/clock')
  myClock(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myStaffClock(u));
  }

  @Get('me/confidentiality')
  confidentiality(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.confidentiality(u));
  }

  @Post('me/confidentiality')
  acceptConfidentiality(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.acceptConfidentiality(u));
  }

  @Post('me/clock/session-start')
  staffSessionStart(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffSessionStart(u));
  }

  @Post('me/clock/session-end')
  staffSessionEnd(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffSessionEnd(u));
  }

  @Post('me/clock/in')
  staffClockIn(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.staffClockIn(u, staffShot(b)));
  }

  @Post('me/clock/out')
  staffClockOut(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.staffClockOut(u, staffShot(b)));
  }

  @Post('me/clock/ping')
  staffPing(@UserId() uid: string, @Body() b: { lat?: unknown; lng?: unknown; accuracyM?: unknown; capturedAt?: unknown }) {
    const lat = coord(b.lat);
    const lng = coord(b.lng);
    if (lat === null || lng === null) throw new BadRequestException('lat and lng are required');
    return this.db.asUser(uid, (svc, u) =>
      svc.staffPing(u, { lat, lng, accuracyM: coord(b.accuracyM), capturedAt: b.capturedAt == null ? undefined : str(b.capturedAt, 'capturedAt', 40) }),
    );
  }

  @Get('staff-clock')
  staffClockBoard(@UserId() uid: string, @Query('date') d?: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffClockBoard(u, d ? date(d, 'date') : undefined));
  }

  @Get('staff-clock/:id')
  staffClockDetail(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffClockDetail(u, id.slice(0, 80)));
  }

  // Working from home (Fauzan, 27 Oct 2026)
  @Get('me/remote')
  myRemote(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myRemote(u));
  }

  @Post('me/remote/apply')
  remoteApply(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const p = (b.place ?? {}) as Record<string, unknown>;
    const lat = coord(p.lat);
    const lng = coord(p.lng);
    if (lat === null || lng === null) throw new BadRequestException('place lat and lng are required');
    const list: unknown = b.days;
    if (!Array.isArray(list)) throw new BadRequestException('days must be a list');
    const days = list.filter((d): d is number => typeof d === 'number').slice(0, 7);
    return this.db.asUser(uid, (svc, u) =>
      svc.remoteApply(u, {
        days,
        from: date(b.from, 'from'),
        to: b.to == null || b.to === '' ? null : date(b.to, 'to'),
        reason: str(b.reason, 'reason', 500),
        place: { label: p.label == null ? '' : str(p.label, 'label', 80), lat, lng },
        noticeAccepted: b.noticeAccepted === true,
      }),
    );
  }

  @Post('me/remote/plan')
  remotePlan(@UserId() uid: string, @Body() b: { tasks?: unknown }) {
    if (!Array.isArray(b.tasks)) throw new BadRequestException('tasks must be a list');
    const tasks = b.tasks.slice(0, 20).map((t, i) => str(t, `tasks[${i}]`, 200));
    return this.db.asUser(uid, (svc, u) => svc.remotePlan(u, tasks));
  }

  @Post('me/remote/tasks/:id')
  remoteTask(@UserId() uid: string, @Param('id') id: string, @Body() b: { done?: unknown; output?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.remoteTask(u, id.slice(0, 20), b.done === true, b.output == null ? '' : str(b.output, 'output', 300)));
  }

  @Post('me/remote/check-in')
  remoteCheckIn(@UserId() uid: string, @Body() b: { note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.remoteCheckIn(u, str(b.note, 'note', 300)));
  }

  @Post('me/remote/report')
  remoteReport(@UserId() uid: string, @Body() b: { summary?: unknown; blockers?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.remoteReport(u, { summary: str(b.summary, 'summary', 2000), blockers: b.blockers == null ? '' : str(b.blockers, 'blockers', 1000) }),
    );
  }

  @Get('remote')
  remoteBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.remoteBoard(u));
  }

  @Post('remote/:id/decide')
  remoteDecide(@UserId() uid: string, @Param('id') id: string, @Body() b: { approve?: unknown; note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.remoteDecide(u, id.slice(0, 80), b.approve === true, b.note == null ? '' : str(b.note, 'note', 1000)));
  }

  @Post('remote/:id/end')
  remoteEnd(@UserId() uid: string, @Param('id') id: string, @Body() b: { note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.remoteEnd(u, id.slice(0, 80), b.note == null ? '' : str(b.note, 'note', 1000)));
  }

  @Post('remote-days/:id/review')
  remoteReview(@UserId() uid: string, @Param('id') id: string, @Body() b: { verdict?: unknown; note?: unknown }) {
    if (b.verdict !== 'accepted' && b.verdict !== 'queried') throw new BadRequestException('verdict must be accepted or queried');
    const verdict = b.verdict;
    return this.db.asUser(uid, (svc, u) => svc.remoteReview(u, id.slice(0, 80), verdict, b.note == null ? '' : str(b.note, 'note', 1000)));
  }

  // Remote and branch work plan (Fauzan, 27 Oct 2026).
  @Get('me/work')
  myWork(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myWork(u));
  }

  @Post('me/work/check-in')
  workCheckIn(@UserId() uid: string, @Body() b: { where?: unknown; hours?: unknown; priorities?: unknown; support?: unknown }) {
    const where = b.where;
    if (where !== 'office' && where !== 'home' && where !== 'branch' && where !== 'field') throw new BadRequestException('where must be office, home, branch or field');
    if (!Array.isArray(b.priorities) || b.priorities.length > 3) throw new BadRequestException('priorities must be a list of up to 3');
    const priorities = b.priorities.map((x, i) => str(x, `priorities[${i}]`, 160));
    return this.db.asUser(uid, (svc, u) =>
      svc.workCheckIn(u, { where, hours: str(b.hours, 'hours', 20), priorities, support: b.support == null ? '' : str(b.support, 'support', 300) }),
    );
  }

  @Post('work/tasks')
  workTaskAdd(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.workTaskAdd(u, {
        userId: str(b.userId, 'userId', 80),
        title: str(b.title, 'title', 200),
        doneMeans: b.doneMeans == null ? '' : str(b.doneMeans, 'doneMeans', 500),
        dueAt: str(b.dueAt, 'dueAt', 40),
        priority: b.priority === 'high' ? 'high' : 'normal',
        source: b.source === 'meeting' ? 'meeting' : undefined,
      }),
    );
  }

  @Post('work/tasks/:id/done')
  workTaskDone(@UserId() uid: string, @Param('id') id: string, @Body() b: { note?: unknown; ref?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.workTaskDone(u, id.slice(0, 160), { note: str(b.note, 'note', 500), ref: b.ref == null ? '' : str(b.ref, 'ref', 120) }));
  }

  @Post('work/tasks/:id/more-time')
  workTaskLate(@UserId() uid: string, @Param('id') id: string, @Body() b: { reason?: unknown; newDueAt?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.workTaskLate(u, id.slice(0, 160), { reason: str(b.reason, 'reason', 300), newDueAt: str(b.newDueAt, 'newDueAt', 40) }));
  }

  @Post('work/tasks/:id/review')
  workTaskReview(@UserId() uid: string, @Param('id') id: string, @Body() b: { accept?: unknown; note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.workTaskReview(u, id.slice(0, 160), b.accept === true, b.note == null ? '' : str(b.note, 'note', 500)));
  }

  /** The person told about one COO accept or return marks that one notice seen (Fauzan, 31 Oct 2026). */
  @Post('coo-notices/:kind/:id/seen')
  seenCooNotice(@UserId() uid: string, @Param('kind') kind: string, @Param('id') id: string, @Body() b: { noticeId?: unknown }) {
    if (kind !== 'work' && kind !== 'fwm') throw new BadRequestException('Unknown kind of notice.');
    return this.db.asUser(uid, (svc, u) => svc.seenCooNotice(u, kind, id.slice(0, 160), str(b.noticeId, 'noticeId', 200)));
  }

  @Post('me/work/help')
  helpAsk(@UserId() uid: string, @Body() b: { text?: unknown; taskId?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.helpAsk(u, { text: str(b.text, 'text', 500), taskId: b.taskId == null ? null : str(b.taskId, 'taskId', 160) }));
  }

  @Post('work/help/:id/answer')
  helpAnswer(@UserId() uid: string, @Param('id') id: string, @Body() b: { text?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.helpAnswer(u, id.slice(0, 160), str(b.text, 'text', 500)));
  }

  @Post('work/one-on-ones')
  oneOnOne(@UserId() uid: string, @Body() b: { userId?: unknown; notes?: unknown; agreed?: unknown }) {
    const agreed = Array.isArray(b.agreed) ? b.agreed.slice(0, 10).map((x, i) => str(x, `agreed[${i}]`, 200)) : [];
    return this.db.asUser(uid, (svc, u) => svc.oneOnOneRecord(u, { userId: str(b.userId, 'userId', 80), notes: str(b.notes, 'notes', 2000), agreed }));
  }

  @Post('work/people/:id/playbook-signoff')
  playbookSignOff(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.playbookSignOff(u, id.slice(0, 80)));
  }

  @Get('work/team')
  teamWork(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.teamWork(u));
  }

  @Get('work/people/:id')
  personWork(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.personWork(u, id.slice(0, 80)));
  }

  @Get('work/summary')
  workSummary(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.workSummary(u));
  }

  @Post('work/planner/sync')
  plannerSync(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.plannerSync(u));
  }

  @Get('branch-work')
  branchWork(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.branchWork(u));
  }

  @Post('branch-work/:id/check')
  branchCheck(@UserId() uid: string, @Param('id') id: string, @Body() b: { kind?: unknown; items?: unknown; proof?: unknown }) {
    const kind = b.kind;
    if (kind !== 'daily' && kind !== 'weekly' && kind !== 'monthly') throw new BadRequestException('kind must be daily, weekly or monthly');
    if (!Array.isArray(b.items) || b.items.length > 20) throw new BadRequestException('items must be a list');
    const items = b.items.map((x: Record<string, unknown>, i) => ({ key: str(x?.key, `items[${i}].key`, 40), ok: x?.ok === true, note: x?.note == null ? '' : str(x.note, `items[${i}].note`, 300) }));
    return this.db.asUser(uid, (svc, u) => svc.branchCheckSubmit(u, id.slice(0, 80), { kind, items, proof: proofOf(b.proof) }));
  }

  @Post('branch-work/:id/visit')
  branchVisit(@UserId() uid: string, @Param('id') id: string, @Body() b: { kind?: unknown; result?: unknown; findings?: unknown; proof?: unknown }) {
    const kind = b.kind;
    if (kind !== 'om' && kind !== 'rom' && kind !== 'act' && kind !== 'spot') throw new BadRequestException('kind must be om, rom, act or spot');
    return this.db.asUser(uid, (svc, u) =>
      svc.branchVisitRecord(u, id.slice(0, 80), { kind, result: b.result === 'issues' ? 'issues' : 'ok', findings: str(b.findings, 'findings', 2000), proof: proofOf(b.proof) }),
    );
  }

  @Get('people/:id/profile')
  profile(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.guardProfile(u, id));
  }

  @Get('leave')
  leave(@UserId() uid: string, @Query('companyId') companyId?: string, @Query('waiting') waiting?: string, @Query('status') status?: string) {
    if (companyId !== undefined && !/^[a-z0-9-]{1,40}$/.test(companyId)) throw new BadRequestException('companyId is not valid');
    return this.db.asUser(uid, (svc, u) =>
      svc.leaveRequests(u, { companyId, waiting: waiting === 'me' ? 'me' : undefined, status: status === 'all' ? 'all' : 'pending' }),
    );
  }

  @Post('leave')
  requestLeave(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = b.kind as LeaveKind;
    if (!LEAVE_KINDS.includes(kind)) throw new BadRequestException('kind is not valid');
    const input = {
      personId: b.personId == null ? null : str(b.personId, 'personId', 100),
      staffNo: b.staffNo == null ? null : str(b.staffNo, 'staffNo', 20),
      face: face(b.face),
      kind,
      from: str(b.from, 'from', 10),
      to: str(b.to, 'to', 10),
      reason: str(b.reason ?? '', 'reason', 1000),
      illness: b.illness == null ? null : str(b.illness, 'illness', 120),
      clinic: b.clinic == null ? null : str(b.clinic, 'clinic', 120),
      mcNo: b.mcNo == null ? null : str(b.mcNo, 'mcNo', 40),
      proof: proofList(b.proof),
    };
    return this.db.asUser(uid, (svc, u) => svc.requestLeave(u, input));
  }

  @Post('leave/:id/decide')
  decideLeave(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    const approve = b.approve;
    const note = str(b.note ?? '', 'note', 1000);
    return this.db.asUser(uid, (svc, u) => svc.decideLeave(u, id, approve, note));
  }

  @Post('sites/:id/patrol-interval')
  patrolInterval(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const minutes = b.minutes === null ? null : Number(b.minutes);
    if (minutes !== null && !Number.isFinite(minutes)) throw new BadRequestException('minutes must be a number or null');
    const note = b.note === undefined || b.note === null ? '' : str(b.note, 'note', 200);
    return this.db.asUser(uid, (svc, u) => svc.setPatrolInterval(u, id, { minutes, note }));
  }

  @Get('sites/:id/roster')
  roster(@UserId() uid: string, @Param('id') id: string, @Query('from') from: string, @Query('days') days = '7') {
    const n = Math.min(Math.max(Number(days) || 7, 1), 31);
    return this.db.asUser(uid, (svc, u) => svc.roster(u, id, date(from, 'from'), n));
  }

  @Post('sites/:id/roster/publish')
  publish(@UserId() uid: string, @Param('id') id: string, @Body() b: { from?: unknown; to?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.publishRoster(u, id, date(b.from, 'from'), date(b.to, 'to')));
  }

  @Get('shifts/:id/candidates')
  candidates(@UserId() uid: string, @Param('id') id: string, @Query('q') q = '') {
    return this.db.asUser(uid, (svc, u) => svc.candidates(u, id, String(q).slice(0, 100)));
  }

  @Post('shifts/:id/assign')
  assign(@UserId() uid: string, @Param('id') id: string, @Body() b: { personId?: unknown }) {
    const personId = b.personId === null ? null : str(b.personId, 'personId', 100);
    return this.db.asUser(uid, (svc, u) => svc.assignShift(u, id, personId));
  }

  @Get('companies/:id/attendance')
  attendance(@UserId() uid: string, @Param('id') id: string, @Query('date') d: string) {
    return this.db.asUser(uid, (svc, u) => svc.attendance(u, id, date(d, 'date')));
  }

  @Post('companies/:id/attendance/lock')
  lock(@UserId() uid: string, @Param('id') id: string, @Body() b: { date?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.lockAttendance(u, id, date(b.date, 'date')));
  }

  @Get('companies/:id/attendance/alerts')
  attendanceAlerts(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.attendanceAlerts(u, id));
  }

  @Post('attendance/follow-up')
  followUp(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const issue = b.issue as AttendanceIssue;
    const kind = b.kind as FollowUpKind;
    if (!ATT_ISSUES.includes(issue)) throw new BadRequestException('issue is not valid');
    if (!FOLLOW_UPS.includes(kind)) throw new BadRequestException('kind is not valid');
    const discipline = b.discipline == null ? null : (b.discipline as DisciplineStep);
    if (discipline && !DISCIPLINE.includes(discipline)) throw new BadRequestException('discipline is not valid');
    const input = {
      shiftId: b.shiftId == null ? null : str(b.shiftId, 'shiftId', 100),
      attendanceId: b.attendanceId == null ? null : str(b.attendanceId, 'attendanceId', 100),
      issue,
      kind,
      note: str(b.note ?? '', 'note', 1000),
      replacementPersonId: b.replacementPersonId == null ? null : str(b.replacementPersonId, 'replacementPersonId', 100),
      discipline,
      suspensionDays: typeof b.suspensionDays === 'number' ? b.suspensionDays : null,
      proof: proofList(b.proof),
    };
    return this.db.asUser(uid, (svc, u) => svc.followUpAttendance(u, input));
  }

  @Post('cases/:id/photos')
  casePhoto(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = evidence(b);
    return this.db.asUser(uid, (svc, u) => svc.addCasePhoto(u, id, input));
  }

  @Get('sites/:id/visits')
  siteVisits(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.siteVisits(u, id));
  }

  @Post('sites/:id/visits')
  startVisit(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = { lat: coord(b.lat), lng: coord(b.lng), accuracyM: coord(b.accuracyM), purpose: str(b.purpose, 'purpose', 300) };
    return this.db.asUser(uid, (svc, u) => svc.startSiteVisit(u, id, input));
  }

  @Post('visits/:id/photos')
  visitPhoto(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = evidence(b);
    return this.db.asUser(uid, (svc, u) => svc.addVisitPhoto(u, id, input));
  }

  @Post('visits/:id/close')
  closeVisit(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const findings = str(b.findings, 'findings', 2000);
    return this.db.asUser(uid, (svc, u) => svc.closeSiteVisit(u, id, findings));
  }

  @Get('companies/:id/people/:pid/discipline')
  discipline(@UserId() uid: string, @Param('id') id: string, @Param('pid') pid: string) {
    return this.db.asUser(uid, (svc, u) => svc.disciplineHistory(u, id, pid));
  }

  @Post('device/clock-in')
  clockIn(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const input = { staffNo: str(b.staffNo, 'staffNo', 20), face: face(b.face), lat: coord(b.lat), lng: coord(b.lng) };
    return this.db.asUser(uid, (svc, u) => svc.clockIn(u, input));
  }

  @Post('device/clock-out')
  clockOut(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const input = { staffNo: str(b.staffNo, 'staffNo', 20), face: face(b.face) };
    return this.db.asUser(uid, (svc, u) => svc.clockOut(u, input));
  }

  @Post('device/scan')
  scan(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    // Patrols are recorded by NFC tag only; QR codes can be photographed and scanned away from the post.
    if (b.method !== undefined && b.method !== 'NFC') throw new BadRequestException('Patrol checkpoints are recorded by tapping the NFC tag only.');
    const tagSerial = typeof b.tagSerial === 'string' ? b.tagSerial.slice(0, 64) : null;
    const input = { staffNo: str(b.staffNo, 'staffNo', 20), pin: str(b.pin, 'pin', 10), tagCode: str(b.tagCode, 'tagCode', 40), tagSerial };
    return this.db.asUser(uid, (svc, u) => svc.scanCheckpoint(u, input));
  }

  @Get('cases')
  cases(@UserId() uid: string, @Query('companyId') companyId?: string, @Query('status') status?: string, @Query('waiting') waiting?: string) {
    return this.db.asUser(uid, (svc, u) =>
      svc.cases(u, { companyId: companyId || undefined, status: status === 'all' ? 'all' : 'active', waiting: waiting === 'me' ? 'me' : undefined }),
    );
  }

  @Post('cases/:id/signoff')
  signOff(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const outcome = b.outcome as 'verified' | 'resolved' | 'sent_back' | 'confirmed' | 'escalated';
    if (!['verified', 'resolved', 'sent_back', 'confirmed', 'escalated'].includes(outcome)) throw new BadRequestException('outcome is not valid');
    const note = str(b.note, 'note', 2000);
    const proof = proofList(b.proof);
    return this.db.asUser(uid, (svc, u) => svc.signOffCase(u, id, outcome, note, proof));
  }

  @Get('cases/:id')
  caseDetail(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.caseDetail(u, id));
  }

  @Post('cases')
  raise(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const severity = b.severity as Severity;
    const type = b.type as CaseType;
    if (!SEVERITIES.includes(severity)) throw new BadRequestException('severity must be P1 to P4');
    if (!CASE_TYPES.includes(type)) throw new BadRequestException('unknown case type');
    const input = {
      companyId: str(b.companyId, 'companyId', 100),
      siteId: b.siteId == null ? null : str(b.siteId, 'siteId', 100),
      type,
      severity,
      title: str(b.title, 'title', 200),
      description: str(b.description ?? '', 'description', 4000),
      reporter:
        b.reporter && typeof b.reporter === 'object'
          ? { staffNo: str((b.reporter as Record<string, unknown>).staffNo, 'reporter.staffNo', 20), face: face((b.reporter as Record<string, unknown>).face) }
          : null,
      proof: proofList(b.proof),
    };
    return this.db.asUser(uid, (svc, u) => svc.raiseCase(u, input));
  }

  @Post('cases/:id/:action')
  updateCase(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown; proof?: unknown }) {
    const a = CASE_ACTIONS.find((x) => x === action);
    if (!a) throw new BadRequestException('unknown action');
    const note = b.note == null ? '' : str(b.note, 'note', 4000);
    const proof = proofList(b.proof);
    return this.db.asUser(uid, (svc, u) => svc.updateCase(u, id, a, note, proof));
  }

  @Get('home')
  home(@UserId() uid: string, @Query('companyId') companyId?: string) {
    if (companyId !== undefined && !/^[a-z0-9-]{1,40}$/.test(companyId)) throw new BadRequestException('companyId is not valid');
    return this.db.asUser(uid, (svc, u) => svc.home(u, companyId));
  }

  @Get('arms/control')
  armsControl(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.armsControl(u));
  }

  @Get('cms')
  cms(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.cms(u));
  }

  @Post('cms/settings')
  cmsSettings(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const patch: Record<string, unknown> = {};
    for (const k of CMS_SETTING_KEYS) if (b[k] !== undefined) patch[k] = b[k];
    return this.db.asUser(uid, (svc, u) => svc.updateCmsSettings(u, patch));
  }

  @Post('cms/roster/plan')
  planCms(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const days = b.days === undefined ? 7 : Number(b.days);
    return this.db.asUser(uid, (svc, u) => svc.planCmsRoster(u, days));
  }

  @Post('cms/shifts/:id/handover')
  cmsHandover(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const note = str(b.note, 'note', 1000);
    return this.db.asUser(uid, (svc, u) => svc.recordCmsHandover(u, id, note));
  }

  @Post('cms/calls/:id/callback')
  cmsCallback(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const note = str(b.note, 'note', 500);
    return this.db.asUser(uid, (svc, u) => svc.logCallback(u, id, note));
  }

  @Post('cms/alarms/:id/ack')
  ackAlarm(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.acknowledgeAlarm(u, id));
  }

  @Post('cms/alarms/:id/close')
  closeAlarm(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (b.verdict !== 'real' && b.verdict !== 'false') throw new BadRequestException('verdict must be real or false');
    const verdict = b.verdict;
    const note = str(b.note, 'note', 1000);
    return this.db.asUser(uid, (svc, u) => svc.closeAlarm(u, id, verdict, note));
  }

  @Post('cms/alarms/:id/review')
  reviewFalseAlarm(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.agree !== 'boolean') throw new BadRequestException('agree must be true or false');
    const agree = b.agree;
    return this.db.asUser(uid, (svc, u) => svc.reviewFalseAlarm(u, id, agree, str(b.note ?? '', 'note', 300)));
  }

  @Post('cms/shifts/:id/assign')
  assignCms(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const name = str(b.staffName, 'staffName', 120);
    return this.db.asUser(uid, (svc, u) => svc.assignCmsShift(u, id, name));
  }

  @Post('arms/requests/:id/review')
  reviewArmsRequest(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (b.decision !== 'pass' && b.decision !== 'return') throw new BadRequestException('decision must be pass or return');
    const decision = b.decision;
    const note = b.note === undefined ? '' : str(b.note, 'note', 500);
    return this.db.asUser(uid, (svc, u) => svc.reviewArmsRequest(u, id, decision, note));
  }

  @Get('ops/region')
  regionalOps(@UserId() uid: string, @Query('region') region?: string) {
    if (region !== undefined && !/^[a-z_]{1,32}$/.test(region)) throw new BadRequestException('region is not valid');
    return this.db.asUser(uid, (svc, u) => svc.regionalOps(u, region));
  }

  @Get('hr')
  hr(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.hrMonitor(u));
  }

  @Get('insurance')
  insurance(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.insurance(u));
  }

  @Get('arms')
  armsOverview(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.armsOverview(u));
  }

  @Get('companies/:id/arms')
  arms(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.arms(u, id));
  }

  @Post('arms/issue')
  issueFirearm(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const input = {
      shiftId: str(b.shiftId, 'shiftId', 80),
      firearmId: str(b.firearmId, 'firearmId', 80),
      rounds: Number(b.rounds),
      witness: witness(b.witness),
      rfidScan: b.rfidScan ? str(b.rfidScan, 'rfidScan', 64) : null,
    };
    return this.db.asUser(uid, (svc, u) => svc.issueFirearm(u, input));
  }

  @Post('arms/jobs')
  planArmedJob(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['BODYGUARD', 'CIT', 'CDM', 'CASH_VAULT'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('kind must be BODYGUARD, CIT, CDM or CASH_VAULT');
    const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, 20).map((x) => String(x).slice(0, max)) : []);
    const police = b.policeApproval as { ref?: unknown; on?: unknown } | null | undefined;
    return this.db.asUser(uid, (svc, u) =>
      svc.planArmedJob(u, {
        companyId: str(b.companyId, 'companyId', 120),
        kind,
        client: str(b.client, 'client', 120),
        detail: b.detail == null ? '' : str(b.detail, 'detail', 300),
        start: str(b.start, 'start', 30),
        end: str(b.end, 'end', 30),
        crew: list(b.crew, 120),
        vehicle: b.vehicle == null || b.vehicle === '' ? null : str(b.vehicle, 'vehicle', 60),
        states: list(b.states, 40),
        policeApproval: police && police.ref ? { ref: str(police.ref, 'policeApproval.ref', 60), on: date(police.on, 'policeApproval.on') } : null,
      }),
    );
  }

  @Post('arms/jobs/:id/update')
  updateArmedJob(@UserId() uid: string, @Param('id') id: string, @Body() b: { status?: unknown; note?: unknown }) {
    const status = (['in_progress', 'completed', 'delayed', 'incident'] as const).find((k) => k === b.status);
    if (!status) throw new BadRequestException('status must be in_progress, completed, delayed or incident');
    return this.db.asUser(uid, (svc, u) => svc.updateArmedJob(u, id.slice(0, 120), status, str(b.note, 'note', 300)));
  }

  @Post('arms/movements/:id/return')
  returnFirearm(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = {
      movementId: id,
      roundsReturned: Number(b.roundsReturned),
      witness: witness(b.witness),
      rfidScan: b.rfidScan ? str(b.rfidScan, 'rfidScan', 64) : null,
    };
    return this.db.asUser(uid, (svc, u) => svc.returnFirearm(u, input));
  }

  @Post('arms/movements/:id/escalate')
  escalateFirearm(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.escalateFirearm(u, id));
  }

  @Post('vaults/:id/count')
  countVault(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = { counted: Number(b.counted), witness: witness(b.witness) };
    return this.db.asUser(uid, (svc, u) => svc.countVault(u, id, input));
  }

  @Get('companies/:id/commercial')
  commercial(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.commercial(u, id));
  }

  @Post('companies/:id/quotations')
  createQuotation(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const num = (v: unknown, name: string) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadRequestException(`${name} must be a number`);
      return v;
    };
    const input = {
      client: str(b.client, 'client', 200),
      siteName: b.siteName == null ? '' : str(b.siteName, 'siteName', 200),
      tenderId: b.tenderId == null || b.tenderId === '' ? null : str(b.tenderId, 'tenderId', 80),
      guards: num(b.guards, 'guards'),
      hoursPerDay: b.hoursPerDay === 8 ? (8 as const) : (12 as const),
      ratePerGuard: num(b.ratePerGuard, 'ratePerGuard'),
      validDays: b.validDays == null ? 30 : num(b.validDays, 'validDays'),
      note: b.note == null ? '' : str(b.note, 'note', 2000),
    };
    return this.db.asUser(uid, (svc, u) => svc.createQuotation(u, id, input));
  }

  @Post('quotations/:id/:action')
  quotationAction(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown }) {
    const a = QUOTE_ACTIONS.find((x) => x === action);
    if (!a) throw new BadRequestException('unknown action');
    const note = b.note == null ? '' : str(b.note, 'note', 2000);
    return this.db.asUser(uid, (svc, u) => svc.quotationAction(u, id, a, note));
  }

  @Post('tenders/:id/status')
  updateTender(@UserId() uid: string, @Param('id') id: string, @Body() b: { status?: unknown }) {
    const st = TENDER_STATUSES.find((x) => x === b.status);
    if (!st) throw new BadRequestException('unknown status');
    return this.db.asUser(uid, (svc, u) => svc.updateTender(u, id, st));
  }

  @Get('tender-protocol')
  tenderProtocol(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.tenderProtocol(u));
  }

  @Post('tender-protocol')
  setTenderProtocol(@UserId() uid: string, @Body() b: { steps?: unknown; note?: unknown }) {
    if (!Array.isArray(b.steps) || b.steps.length > 60) throw new BadRequestException('steps must be a list of up to 60');
    const steps = b.steps.map((x: Record<string, unknown>) => ({
      id: x?.id == null ? undefined : str(x.id, 'id', 40),
      label: str(x?.label, 'label', 120),
      detail: x?.detail == null ? '' : str(x.detail, 'detail', 400),
      before: (['preparing', 'submitted'] as const).find((v) => v === x?.before) ?? badStepStage(),
      needsDocument: x?.needsDocument === true,
      section: x?.section == null ? undefined : str(x.section, 'section', 60),
      code: x?.code == null ? undefined : str(x.code, 'code', 10),
      managerOnly: x?.managerOnly === true,
      auto: (['MANAGER', 'SLIP'] as const).find((v) => v === x?.auto),
    }));
    return this.db.asUser(uid, (svc, u) => svc.setTenderProtocol(u, { steps, note: str(b.note, 'note', 300) }));
  }

  @Post('tenders/:id/steps/:stepId')
  doTenderStep(
    @UserId() uid: string,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() b: { note?: unknown; proof?: unknown; status?: unknown; ref?: unknown },
  ) {
    const opts = { status: b.status === 'na' ? ('na' as const) : ('done' as const), ref: b.ref == null ? '' : str(b.ref, 'ref', 60) };
    return this.db.asUser(uid, (svc, u) =>
      svc.doTenderStep(u, id, stepId.slice(0, 40), b.note == null ? '' : str(b.note, 'note', 300), proofList(b.proof), opts),
    );
  }

  @Post('tenders/:id/steps/:stepId/undo')
  undoTenderStep(@UserId() uid: string, @Param('id') id: string, @Param('stepId') stepId: string) {
    return this.db.asUser(uid, (svc, u) => svc.undoTenderStep(u, id, stepId.slice(0, 40)));
  }

  @Post('tenders/:id/steps/:stepId/na')
  confirmTenderNa(@UserId() uid: string, @Param('id') id: string, @Param('stepId') stepId: string, @Body() b: { accept?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.confirmTenderNa(u, id, stepId.slice(0, 40), b.accept === true));
  }

  @Post('tenders/:id/steps/:stepId/plan')
  planTenderStep(@UserId() uid: string, @Param('id') id: string, @Param('stepId') stepId: string, @Body() b: { pic?: unknown; due?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.planTenderStep(u, id, stepId.slice(0, 40), str(b.pic, 'pic', 80), b.due == null || b.due === '' ? null : str(b.due, 'due', 10)),
    );
  }

  @Post('tenders/:id/decision')
  decideTender(@UserId() uid: string, @Param('id') id: string, @Body() b: { choice?: unknown; reason?: unknown }) {
    const choice = (['TERUSKAN', 'TANGGUH', 'TIDAK_BIDA'] as const).find((c) => c === b.choice);
    if (!choice) throw new BadRequestException('choice must be TERUSKAN, TANGGUH or TIDAK_BIDA');
    return this.db.asUser(uid, (svc, u) => svc.decideTender(u, id, choice, b.reason == null ? '' : str(b.reason, 'reason', 300)));
  }

  @Post('tenders/:id/record')
  tenderRecord(@UserId() uid: string, @Param('id') id: string, @Body() b: { record?: unknown; leadOnly?: unknown }) {
    if (!b.record || typeof b.record !== 'object' || Array.isArray(b.record)) throw new BadRequestException('record must be an object');
    if (JSON.stringify(b.record).length > 20_000) throw new BadRequestException('record is too large');
    const leadOnly = typeof b.leadOnly === 'boolean' ? b.leadOnly : undefined;
    return this.db.asUser(uid, (svc, u) => svc.setTenderRecord(u, id, b.record as TenderRecord, leadOnly));
  }

  @Post('tenders/:id/queries')
  addTenderQuery(@UserId() uid: string, @Param('id') id: string, @Body() b: { text?: unknown; ref?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.addTenderQuery(u, id, str(b.text, 'text', 500), b.ref == null ? '' : str(b.ref, 'ref', 60)));
  }

  @Post('tenders/:id/queries/:queryId')
  setTenderQuery(@UserId() uid: string, @Param('id') id: string, @Param('queryId') qid: string, @Body() b: { status?: unknown; answer?: unknown }) {
    const status = (['open', 'sent', 'answered'] as const).find((x) => x === b.status);
    if (!status) throw new BadRequestException('status must be open, sent or answered');
    return this.db.asUser(uid, (svc, u) => svc.setTenderQuery(u, id, qid.slice(0, 20), status, b.answer == null ? '' : str(b.answer, 'answer', 500)));
  }

  @Post('tenders/:id/papers')
  tenderPapers(@UserId() uid: string, @Param('id') id: string, @Body() b: { kind?: unknown; proof?: unknown }) {
    const kind = (['IKLAN', 'ARAHAN', 'TEKNIKAL', 'KEWANGAN', 'HARGA', 'TAKLIMAT', 'PINDAAN', 'PENGHANTARAN'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('unknown kind of paper');
    return this.db.asUser(uid, (svc, u) => svc.addTenderPapers(u, id, kind, proofList(b.proof)));
  }

  @Post('tenders/:id/files')
  tenderBidFiles(@UserId() uid: string, @Param('id') id: string, @Body() b: { files?: unknown }) {
    if (!Array.isArray(b.files) || b.files.length > 30) throw new BadRequestException('files must be a list of at most 30');
    const parts = ['TEKNIKAL', 'KEWANGAN', 'HARGA', 'LAIN'] as const;
    const files = b.files.map((f: { id?: unknown; part?: unknown; required?: unknown }) => {
      const part = parts.find((p) => p === f?.part);
      if (!part) throw new BadRequestException('part must be TEKNIKAL, KEWANGAN, HARGA or LAIN');
      return { ...(typeof f.id === 'string' ? { id: f.id.slice(0, 20) } : {}), part, required: str(f.required, 'required', 120) };
    });
    return this.db.asUser(uid, (svc, u) => svc.setTenderBidFiles(u, id, files));
  }

  @Post('tenders/:id/files/:fileId')
  uploadTenderBidFile(@UserId() uid: string, @Param('id') id: string, @Param('fileId') fileId: string, @Body() b: { proof?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.uploadTenderBidFile(u, id, fileId.slice(0, 20), proofList(b.proof)));
  }

  @Post('tenders/:id/files/:fileId/check')
  confirmTenderBidFile(@UserId() uid: string, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.db.asUser(uid, (svc, u) => svc.confirmTenderBidFile(u, id, fileId.slice(0, 20)));
  }

  @Post('tenders/:id/checklist/draft')
  draftChecklist(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.draftTenderChecklist(u, id));
  }

  @Post('tenders/:id/checklist/review')
  reviewChecklist(@UserId() uid: string, @Param('id') id: string, @Body() b: { remove?: unknown; add?: unknown; note?: unknown }) {
    const remove = Array.isArray(b.remove) ? b.remove.slice(0, 50).map((x) => str(x, 'remove', 40)) : [];
    const add = Array.isArray(b.add)
      ? b.add.slice(0, 20).map((x: Record<string, unknown>) => ({
          label: str(x?.label, 'label', 120),
          detail: x?.detail == null ? '' : str(x.detail, 'detail', 400),
          ref: x?.ref == null ? '' : str(x.ref, 'ref', 60),
          needsDocument: x?.needsDocument === true,
        }))
      : [];
    return this.db.asUser(uid, (svc, u) => svc.reviewTenderChecklist(u, id, { remove, add, note: str(b.note, 'note', 300) }));
  }

  @Post('tenders/:id/verify')
  verifyTender(@UserId() uid: string, @Param('id') id: string, @Body() b: { approve?: unknown; note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.verifyTender(u, id, b.approve === true, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('tenders/:id/submit')
  submitTender(@UserId() uid: string, @Param('id') id: string, @Body() b: { note?: unknown; proof?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.submitTender(u, id, b.note == null ? '' : str(b.note, 'note', 300), proofList(b.proof)));
  }

  @Get('reports')
  reports(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.reports(u));
  }

  @Post('reports/list')
  setReportDefs(@UserId() uid: string, @Body() b: { defs?: unknown; note?: unknown }) {
    if (!Array.isArray(b.defs)) throw new BadRequestException('defs must be a list');
    const defs = (b.defs as Record<string, unknown>[]).slice(0, 40).map((d) => ({
      id: String(d?.id ?? '').slice(0, 40),
      name: String(d?.name ?? '').slice(0, 80),
      detail: String(d?.detail ?? '').slice(0, 300),
      from: d?.from === 'department' ? ('department' as const) : ('company' as const),
      department: d?.department == null ? undefined : (String(d.department).slice(0, 30) as ReportDef['department']),
      frequency: d?.frequency === 'monthly' ? ('monthly' as const) : ('weekly' as const),
      dueDay: Number(d?.dueDay),
      active: d?.active !== false,
    }));
    return this.db.asUser(uid, (svc, u) => svc.setReportDefs(u, defs, str(b.note, 'note', 300)));
  }

  @Post('reports')
  submitReport(@UserId() uid: string, @Body() b: { defId?: unknown; period?: unknown; companyId?: unknown; note?: unknown; proof?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.submitReport(u, {
        defId: str(b.defId, 'defId', 40),
        period: str(b.period, 'period', 10),
        companyId: b.companyId == null ? null : str(b.companyId, 'companyId', 60),
        note: b.note == null ? '' : str(b.note, 'note', 300),
        proof: proofList(b.proof),
      }),
    );
  }

  @Get('meetings')
  meetings(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.meetings(u));
  }

  @Post('meetings')
  scheduleMeeting(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['board', 'management', 'operations', 'department', 'client', 'other'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('unknown kind of meeting');
    return this.db.asUser(uid, (svc, u) =>
      svc.scheduleMeeting(u, {
        companyId: b.companyId == null ? null : str(b.companyId, 'companyId', 60),
        kind,
        title: str(b.title, 'title', 120),
        start: str(b.start, 'start', 40),
        end: str(b.end, 'end', 40),
        location: b.location == null ? '' : str(b.location, 'location', 120),
        attendees: Array.isArray(b.attendees) ? b.attendees.slice(0, 40).map((a) => str(a, 'attendee', 80)) : [],
        agenda: b.agenda == null ? '' : str(b.agenda, 'agenda', 2000),
      }),
    );
  }

  @Post('meetings/:id/minutes')
  addMinutes(@UserId() uid: string, @Param('id') id: string, @Body() b: { text?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.addMinutes(u, id, str(b.text, 'text', 20_000)));
  }

  @Post('meetings/:id/summary-check')
  checkSummary(@UserId() uid: string, @Param('id') id: string, @Body() b: { text?: unknown; actions?: unknown }) {
    const actions = Array.isArray(b.actions)
      ? b.actions.slice(0, 40).map((a: Record<string, unknown>) => ({
          text: str(a?.text, 'text', 300),
          owner: a?.owner == null ? '' : str(a.owner, 'owner', 80),
          due: a?.due == null ? null : str(a.due, 'due', 10),
        }))
      : undefined;
    return this.db.asUser(uid, (svc, u) => svc.checkMeetingSummary(u, id, { text: b.text == null ? undefined : str(b.text, 'text', 2000), actions }));
  }

  @Post('meetings/:id/actions/:index')
  setAction(@UserId() uid: string, @Param('id') id: string, @Param('index') index: string, @Body() b: { done?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.setMeetingAction(u, id, Number.parseInt(index, 10), b.done === true));
  }

  @Post('meetings/:id/prep')
  setPrep(@UserId() uid: string, @Param('id') id: string, @Body() b: { index?: unknown; done?: unknown; add?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.setMeetingPrep(u, id, {
        index: b.index == null ? undefined : Number(b.index),
        done: b.done === true,
        add: b.add == null ? undefined : str(b.add, 'add', 160),
      }),
    );
  }

  @Get('tender-groups')
  tenderGroups(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.tenderGroups(u));
  }

  @Post('tender-groups')
  createTenderGroup(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.companyIds) || b.companyIds.length > 9) throw new BadRequestException('companyIds must be a list of up to 9');
    const ids = b.companyIds.map((x, i) => str(x, `companyIds[${i}]`, 40));
    return this.db.asUser(uid, (svc, u) => svc.createTenderGroup(u, str(b.sourceTenderId, 'sourceTenderId', 120), ids));
  }

  @Get('tender-board')
  tenderBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.tenderBoard(u));
  }

  @Get('compliance')
  compliance(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.compliance(u));
  }

  @Get('audit')
  audit(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.auditLog(u));
  }
}

/** Where the JA Group app sends its data (Fauzan, 26 Oct 2026). It runs as the feed's own system sign-in, so row-level security still applies. */
const JA_DATASETS = { payroll: 'payroll', 'foreign-workers': 'worker', incidents: 'incident' } as const;

@Controller('api/integrations/ja/v1')
@UseGuards(FeedGuard)
export class JaFeedController {
  constructor(private db: Db) {}

  @Post(':dataset')
  ingest(@Param('dataset') dataset: string, @Body() body: { records?: unknown; covered?: unknown }) {
    const ds = JA_DATASETS[dataset as keyof typeof JA_DATASETS];
    if (!ds) throw new BadRequestException(`Unknown dataset. Use one of: ${Object.keys(JA_DATASETS).join(', ')}.`);
    if (!Array.isArray(body?.records)) throw new BadRequestException('Send { "records": [...] }.');
    return this.db.asUser(process.env.JA_FEED_USER_ID ?? 'u-ja-sync', (svc, u) =>
      svc.jaIngest(u, ds, body.records as unknown[], Array.isArray(body.covered) ? body.covered : []),
    );
  }
}

/** Where the office door system sends its readings through CMS (Fauzan, 27 Oct 2026). Same signed-call rules as the JA feed, with its own secrets. */
@Controller('api/integrations/door/v1')
@UseGuards(DoorFeedGuard)
export class DoorFeedController {
  constructor(private db: Db) {}

  @Post('events')
  ingest(@Body() body: { records?: unknown }) {
    if (!Array.isArray(body?.records)) throw new BadRequestException('Send { "records": [...] }.');
    return this.db.asUser(process.env.DOOR_FEED_USER_ID ?? 'u-door-sync', (svc, u) => svc.doorIngest(u, body.records as unknown[]));
  }
}

/** Where Microsoft Planner changes come back (P1: Planner preferred). Same signed-call rules as the other feeds, with PLANNER_API_KEY and PLANNER_SIGNING_SECRET. */
@Controller('api/integrations/planner/v1')
@UseGuards(PlannerFeedGuard)
export class PlannerFeedController {
  constructor(private db: Db) {}

  @Post('tasks')
  ingest(@Body() body: { records?: unknown }) {
    if (!Array.isArray(body?.records)) throw new BadRequestException('Send { "records": [...] }.');
    return this.db.asUser(process.env.PLANNER_FEED_USER_ID ?? 'u-planner-sync', (svc, u) => svc.plannerIngest(u, body.records as unknown[]));
  }
}

