import { dutyOfflineContext } from './duty-offline-context';
import {releaseState} from './release-state';
import { companyOfficeProblems, companyRunLinkProblems } from './company-office-readiness';
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, Param, Post, Query, Req, ServiceUnavailableException, UseGuards, Res } from '@nestjs/common';
import type {
  AttendanceIssue,
  CorpChangeKind,
  CorpFilingKind,
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
  ClientLostReason,
  ClientPersonRole,
  ClientRenewalAnswer,
  ClientRenewalDecision,
  ClientRequestKind,
} from '@prima/core';
import { CENTRAL_ALIASES, CENTRAL_EMPLOYER_IDS, CENTRAL_FULL_NAMES, RECORD_KINDS, RULES, accessClosed, arishaFormView, arishaMayConsult, dataModeOf, dateOf, fromMs, arishaKind, arishaToolsFor, type ArishaTurn, type ArishaReviewDraft, isRealDate, CLIENT_VIA, inPilot, rebalanceAiNames, CLIENT_LOST_REASON, CLIENT_PERSON_ROLE, CLIENT_RENEWAL_ANSWER, CLIENT_RENEWAL_DECISION, CLIENT_REQUEST_KIND, type ItemAction, type DispatchLevel, type DispatchProof, type PostLogKind, type SealedBundle, type VisitorIdKind } from '@prima/core';
import { ArishaBusy, ArishaUnavailable, IdentityToken, askArisha, askArishaOn, type ArishaModel, arishaConfig } from './arisha';
import { arishaProvider, officeModel, type ArishaProvider } from './arisha-office';
import { AuthGuard, DoorFeedGuard, pilotAdmits, FeedGuard, OfficeSystemGuard, PlannerFeedGuard, UserId, devLoginOn, entraSetup, issueToken, pilotSignInOnly, type AuthedRequest, AnalyticsFeedGuard, InhouseFeedGuard } from './auth';
import { officeSecret } from './office';
import { arishaPilotAllowed } from './arisha-pilot';
import { Db, schemaState } from './db';
import { shareBase, shareCsp, shareGonePage, shareReportPage, shareSecret, signShare, verifyShare } from './share-links';
import type { Response } from 'express';
import { WebConnectors, webConnectorConfig } from './web-connectors';

const webConnectors = new WebConnectors();

const SEVERITIES: Severity[] = ['P1', 'P2', 'P3', 'P4'];
const CASE_TYPES: CaseType[] = ['INCIDENT', 'SOS', 'MISSED_CHECKIN', 'NO_SHOW', 'COMPLAINT', 'COMPLIANCE', 'IDENTITY_CHECK', 'ARMS'];
const CASE_ACTIONS = ['acknowledge', 'escalate', 'resolve', 'close', 'note'] as const;
const QUOTE_ACTIONS = ['submit', 'approve', 'return', 'sent', 'accepted', 'rejected'] as const;
const TENDER_STATUSES: TenderStatus[] = ['open', 'preparing', 'submitted', 'won', 'lost', 'no_bid'];
const ATT_ISSUES: AttendanceIssue[] = ['NO_SHOW', 'POST_EMPTY', 'LATE', 'OUTSIDE_GEOFENCE', 'EARLY_LEAVE', 'FACE_NOT_MATCHED', 'NOT_ROSTERED'];
const LEAVE_KINDS: LeaveKind[] = ['ANNUAL', 'SICK', 'HOSPITAL', 'EMERGENCY', 'UNPAID', 'ABSENCE_REASON', 'MATERNITY', 'PATERNITY'];
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
const FW_CHECK_KINDS = ['ARRIVAL_FEE', 'PASSPORT', 'WELFARE'] as const;
const FW_RECRUIT_STEPS = ['AGENCY_LICENCE', 'EMBASSY', 'INTERVIEW', 'AGE', 'CONTRACT'] as const;
const FW_CONTRACT_LANGUAGES = ['en', 'ms', 'ne', 'bn', 'my', 'id', 'other'] as const;
const FW_CONCERNS = ['PAY', 'HOURS', 'HOUSING', 'TREATMENT', 'FEES', 'DOCUMENTS', 'HEALTH', 'OTHER'] as const;
const HIRING_DOC_KINDS = ['AGREEMENT', 'AGREEMENT_STAMPED', 'VETTING_CERT'] as const;
const HOSPITAL_DOC_ITEMS = ['ADMISSION_LETTER', 'GUARANTEE_LETTER', 'MEDICAL_CERT', 'DISCHARGE_SUMMARY', 'ITEMISED_BILL', 'CLAIM_FORM'] as const;
const HOSPITAL_DOC_STATUSES = ['missing', 'received', 'not_needed'] as const;
const HOSPITAL_STAGES = ['collecting', 'submitted', 'approved', 'paid', 'rejected'] as const;

/** Where the phone said it was, if it allowed location; anything else is dropped. */
function placeOf(v: unknown): { lat: number; lng: number; accuracyM: number | null } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.lat !== 'number' || typeof o.lng !== 'number') return null;
  return { lat: o.lat, lng: o.lng, accuracyM: typeof o.accuracyM === 'number' ? o.accuracyM : null };
}

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
  if (typeof v !== 'string' || !DATE.test(v) || !isRealDate(v)) throw new BadRequestException(`${name} must be a real date like 2026-10-24`);
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

function walletIds(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (!Array.isArray(v) || v.length > 3 || v.some((x) => typeof x !== 'string')) throw new BadRequestException('walletIds must be a list of up to 3 receipt ids');
  return (v as string[]).map((x) => x.slice(0, 160));
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
    descriptor: descriptor(b.descriptor),
    source: 'in_app_camera',
  };
}

/** A face descriptor from the phone's free engine: 128 numbers (face.ts), or none. */
function descriptor(v: unknown): number[] | null {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length !== 128 || !v.every((x) => typeof x === 'number' && Number.isFinite(x)))
    throw new BadRequestException('descriptor must be 128 numbers');
  return v as number[];
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
/** Rebalance advice may also ask Arisha AI per case (Fauzan, 2 Nov 2026). Off by default; needs Arisha AI on too. */
const rebalanceAiOn = (env: NodeJS.ProcessEnv = process.env) => env.WORK_REBALANCE_AI_ENABLED?.trim() === 'true' && !!arishaProvider(env);

/**
 * P80: the model Arisha answers this person on. On the office's AI only for someone who opened Prima from the office
 * (a person's signed call): the office counts it against the person it linked to that staff record. null = not here.
 */
function arishaModelFor(provider: ArishaProvider, userId: string, req: AuthedRequest): ArishaModel | null {
  if (provider.kind === 'azure') return null;
  return req.office?.via === 'person' ? officeModel(provider.office, userId) : null;
}
function askArishaFor(provider: ArishaProvider, userId: string, req: AuthedRequest, input: Parameters<typeof askArisha>[2]) {
  if (provider.kind === 'azure') return askArisha(provider.azure, () => arishaToken.get(), input);
  const model = arishaModelFor(provider, userId, req);
  if (!model) throw new ForbiddenException('Open Prima from the office to ask Arisha.');
  return askArishaOn(model, input);
}

/** A form kind from the request; an unknown or missing kind is an input error (400), never a server error. */
export function formKind(v: unknown) {
  try {
    return arishaKind(v);
  } catch {
    throw new BadRequestException(`No form called ${String(v ?? '').slice(0, 40) || '(none)'}.`);
  }
}

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
  /** Names only: what is missing or drifted for the company office module (empty when installed as reviewed). */
  @Get('health/company-office')
  async companyOffice() {
    const problems = await companyOfficeProblems(this.db.pool);
    // Companies run by another office: a separate optional module. Missing is not a fault (the feature is simply off).
    const runLinks = await companyRunLinkProblems(this.db.pool);
    const runLinksInstalled = !runLinks.some((p) => p.startsWith('Table prima.company_run_links is missing'));
    return { ok: problems.length === 0, problems, runLinks: { installed: runLinksInstalled, ok: runLinksInstalled && runLinks.length === 0, problems: runLinks } };
  }

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
    return RULES.pilot.value.on ? all.filter((u) => pilotAdmits(u)) : all;
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
        // P74: the office opens Prima for its owner as Prima's top record (CEO, else COO).
        top: u.opsTier === 'ceo' ? 'ceo' : u.opsTier === 'coo' ? 'coo' : null,
        canSignIn: !accessClosed(u, today) && (!pilotSignInOnly() || pilotAdmits(u)),
      };
    });
  }

  /**
   * P75: the group's companies (id and name only), so the office's owner can say which Prima company each office branch
   * is; office accounts (office-accounts.ts) are made in that company. Companies sit behind the company wall, so the
   * read runs as prima_app with the wall opened for the companies the group knows: every company a grant or a staff
   * record names (each company has its grants from the first setup on).
   */
  @Get('companies')
  async companies() {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const named = await client.query(
        `SELECT company_id AS id FROM prima.grants
         UNION SELECT jsonb_array_elements_text(data->'companyIds') FROM prima.users WHERE jsonb_typeof(data->'companyIds') = 'array'`,
      );
      await client.query('SET LOCAL ROLE prima_app');
      await client.query(`SELECT set_config('app.company_ids', $1, true)`, [named.rows.map((r) => String(r.id)).join(',')]);
      await client.query(`SELECT set_config('app.user_id', '', true)`);
      await client.query(`SELECT set_config('app.group_user', 'off', true)`);
      await client.query(`SELECT set_config('app.walls', '', true)`);
      const res = await client.query(`SELECT id, data->>'name' AS name, data->'aliases' AS aliases FROM prima.companies ORDER BY data->>'name', id`);
      await client.query('COMMIT');
      // P81: the central employers too (no company record, but they employ the office's HQ units), and each company's
      // other names from the staff list, so the office's branch-to-company suggestion finds "UNIT HR" or "OPERASI JOHOR".
      const aliases = (v: unknown) => (Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string').slice(0, 20) : []);
      return [
        ...CENTRAL_EMPLOYER_IDS.map((id) => ({ id, name: CENTRAL_FULL_NAMES[id] ?? id, aliases: [...(CENTRAL_ALIASES[id] ?? [])] })),
        ...res.rows.map((r) => ({ id: String(r.id), name: String(r.name ?? r.id), aliases: aliases(r.aliases) })),
      ];
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

@Controller('api')
@UseGuards(AuthGuard)
export class AppController {
  constructor(private db: Db) {}

  /** Whether Arisha is switched on here, for this person (P80: everyone who opens Prima from the office). */
  @Get('arisha')
  async arishaStatus(@UserId() uid: string, @Req() req: AuthedRequest) {
    const user = await this.db.asUser(uid, async (_svc, u) => u);
    const provider = arishaProvider();
    const reachable = !!provider && (provider.kind === 'azure' || !!arishaModelFor(provider, user.id, req));
    return { enabled: reachable && arishaMayConsult(user), on: provider?.kind ?? null };
  }

  @Get('arisha/draft-form')
  arishaDraftForm(@UserId() uid: string, @Query('kind') kind: string, @Query('companyId') companyId?: string) {
    return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.form(u, formKind(kind), companyId || null));
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

  /** Arisha's chat (P80: everyone may consult her); preparation is independently scoped and never saves records. */
  @Post('arisha')
  async arisha(@UserId() uid: string, @Body() b: { brief?: unknown; history?: unknown }, @Req() req: AuthedRequest) {
    // Integration logins never reach the AI service; the tools below are scoped per person.
    const user = await this.db.asUser(uid, async (_svc, u) => u);
    if (!arishaMayConsult(user)) throw new ForbiddenException('Arisha is not available to integration logins.');
    const provider = arishaProvider();
    if (!provider) throw new ServiceUnavailableException('Arisha is not switched on.');
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
        const kind = formKind(input.kind);
        const companyId = input.companyId == null ? null : str(input.companyId, 'companyId', 60);
        return arishaFormView(await this.db.asUser(uid, (svc, u) => svc.arishaDrafts.form(u, kind, companyId)));
      }
      if (name === 'prepare_record') return this.db.asUser(uid, (svc, u) => svc.arishaDrafts.prepareRecord(u, input));
      if (name === 'task_guide') {
        this.arishaToolInput(input, ['cardId']);
        const cardId = input.cardId == null ? undefined : str(input.cardId, 'cardId', 80);
        return this.db.asUser(uid, async (svc, u) => svc.arishaGuide(u, cardId));
      }
      throw new BadRequestException('Unknown tool.');
    };
    try {
      return await askArishaFor(provider, user.id, req, { history, brief, tools, toolSpecs });
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      if (e instanceof ArishaBusy) throw new HttpException(e.message, 429);
      if (e instanceof ArishaUnavailable) throw new ServiceUnavailableException(e.message);
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

  /** Workflow KPIs across departments (speed from arrival, quality), for the KPI keepers only. Read-only. */
  @Get('kpi/work')
  workKpi(@UserId() uid: string, @Query('period') period?: string) {
    return this.db.asUser(uid, (svc, u) => svc.workKpi(u, typeof period === 'string' ? period.slice(0, 7) : undefined));
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

  // ----- Responsible recruitment and worker welfare (masterplan §240, Fauzan 3 Nov 2026) -----
  @Get('fwm/welfare')
  fwmWelfare(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.fwmWelfare(u));
  }

  @Post('people/:id/fw-checks')
  fwCheck(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const kind = FW_CHECK_KINDS.find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('unknown check');
    if (b.concerns != null && !Array.isArray(b.concerns)) throw new BadRequestException('concerns must be a list');
    const concerns = ((b.concerns as unknown[] | undefined) ?? []).slice(0, 8).map((c) => {
      const k = FW_CONCERNS.find((x) => x === c);
      if (!k) throw new BadRequestException('unknown concern');
      return k;
    });
    if (b.paidAnything != null && typeof b.paidAnything !== 'boolean') throw new BadRequestException('paidAnything must be true or false');
    if (b.amount != null && typeof b.amount !== 'number') throw new BadRequestException('amount must be a number');
    if (b.heldBy != null && b.heldBy !== 'worker' && b.heldBy !== 'company') throw new BadRequestException('heldBy must be worker or company');
    const input = {
      kind,
      checkedOn: date(b.checkedOn, 'checkedOn'),
      agency: b.agency == null ? undefined : str(b.agency, 'agency', 120),
      paidAnything: b.paidAnything as boolean | undefined,
      amount: b.amount as number | undefined,
      paidTo: b.paidTo == null ? undefined : str(b.paidTo, 'paidTo', 120),
      heldBy: b.heldBy as 'worker' | 'company' | undefined,
      concerns,
      note: b.note == null ? '' : str(b.note, 'note', 500),
    };
    return this.db.asUser(uid, (svc, u) => svc.recordFwCheck(u, id.slice(0, 120), input, b.proof == null ? [] : proofList(b.proof)));
  }

  @Post('fw-checks/:id/close')
  fwCheckClose(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (b.repaid != null && typeof b.repaid !== 'number') throw new BadRequestException('repaid must be a number');
    if (b.custody != null && b.custody !== 'worker' && b.custody !== 'company') throw new BadRequestException('custody must be worker or company');
    const input = { note: str(b.note, 'note', 500), repaid: (b.repaid as number | undefined) ?? null, custody: (b.custody as 'worker' | 'company' | undefined) ?? null };
    return this.db.asUser(uid, (svc, u) => svc.closeFwCheck(u, id.slice(0, 120), input, b.proof == null ? [] : proofList(b.proof)));
  }

  // ----- Foreign worker recruitment steps (Fauzan, 6 Nov 2026, IWAY answer 7) -----
  @Get('fwm/recruitment')
  fwmRecruitment(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.fwmRecruitment(u));
  }

  @Post('fwm/recruitment')
  openFwRecruitFile(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const input = {
      companyId: str(b.companyId, 'companyId', 120),
      candidateName: str(b.candidateName, 'candidateName', 120),
      passportLast4: str(b.passportLast4, 'passportLast4', 20),
      country: str(b.country, 'country', 2),
      agency: str(b.agency, 'agency', 120),
      plannedTravelOn: b.plannedTravelOn == null || b.plannedTravelOn === '' ? null : date(b.plannedTravelOn, 'plannedTravelOn'),
    };
    return this.db.asUser(uid, (svc, u) => svc.openFwRecruitFile(u, input));
  }

  @Post('fwm/recruitment/:id/travel')
  setFwRecruitTravel(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = { plannedTravelOn: date(b.plannedTravelOn, 'plannedTravelOn'), reason: b.reason == null ? '' : str(b.reason, 'reason', 300) };
    return this.db.asUser(uid, (svc, u) => svc.setFwRecruitTravel(u, id.slice(0, 120), input));
  }

  @Post('fwm/recruitment/:id/steps/:step')
  recordFwRecruitStep(@UserId() uid: string, @Param('id') id: string, @Param('step') stepParam: string, @Body() b: Record<string, unknown>) {
    const step = FW_RECRUIT_STEPS.find((k) => k === stepParam);
    if (!step) throw new BadRequestException('unknown step');
    if (b.passed != null && typeof b.passed !== 'boolean') throw new BadRequestException('passed must be true or false');
    if (b.languages != null && !Array.isArray(b.languages)) throw new BadRequestException('languages must be a list');
    const languages = ((b.languages as unknown[] | undefined) ?? []).slice(0, 7).map((l) => {
      const k = FW_CONTRACT_LANGUAGES.find((x) => x === l);
      if (!k) throw new BadRequestException('unknown language');
      return k;
    });
    const input = {
      on: date(b.on, 'on'),
      licenceNo: b.licenceNo == null ? undefined : str(b.licenceNo, 'licenceNo', 60),
      licenceExpiresOn: b.licenceExpiresOn == null ? undefined : date(b.licenceExpiresOn, 'licenceExpiresOn'),
      reference: b.reference == null ? undefined : str(b.reference, 'reference', 80),
      interviewer: b.interviewer == null ? undefined : str(b.interviewer, 'interviewer', 120),
      passed: b.passed as boolean | undefined,
      dob: b.dob == null ? undefined : date(b.dob, 'dob'),
      languages,
      note: b.note == null ? '' : str(b.note, 'note', 500),
      reason: b.reason == null ? '' : str(b.reason, 'reason', 300),
    };
    return this.db.asUser(uid, (svc, u) => svc.recordFwRecruitStep(u, id.slice(0, 120), step, input, b.proof == null ? [] : proofList(b.proof)));
  }

  @Post('fwm/recruitment/:id/clear')
  clearFwRecruitFile(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = { note: b.note == null ? '' : str(b.note, 'note', 300) };
    return this.db.asUser(uid, (svc, u) => svc.clearFwRecruitFile(u, id.slice(0, 120), input));
  }

  @Post('fwm/recruitment/:id/arrived')
  recordFwRecruitArrival(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = { arrivedOn: date(b.arrivedOn, 'arrivedOn'), staffNo: str(b.staffNo, 'staffNo', 40) };
    return this.db.asUser(uid, (svc, u) => svc.recordFwRecruitArrival(u, id.slice(0, 120), input));
  }

  @Post('fwm/recruitment/:id/stop')
  stopFwRecruitFile(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = { reason: str(b.reason, 'reason', 300) };
    return this.db.asUser(uid, (svc, u) => svc.stopFwRecruitFile(u, id.slice(0, 120), input));
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
          walletIds: walletIds(b.walletIds),
        },
        proofList(b.proof),
      ),
    );
  }

  // Staff receipt wallet (Fauzan, 2 Nov 2026): keep receipts when they come, read automatically, claim now or later.
  @Get('claims/receipts')
  myReceipts(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myReceipts(u));
  }

  @Post('claims/receipts')
  async addReceipts(@UserId() uid: string, @Body() b: { proof?: unknown; reads?: unknown }) {
    // What the phone read (Fauzan, 2 Nov 2026: read on the phone) comes with each photo; the service cleans it and keeps
    // it as a suggestion the staff member confirms.
    if (b.reads != null && (!Array.isArray(b.reads) || b.reads.length > 3)) throw new BadRequestException('reads must be a list of up to 3 items');
    await this.db.asUser(uid, (svc, u) => svc.addReceipts(u, proofList(b.proof), (b.reads as unknown[] | undefined) ?? []));
    return this.db.asUser(uid, (svc, u) => svc.myReceipts(u));
  }

  @Post('claims/receipts/:id/:action')
  receiptAction(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const act = (['confirm', 'remove'] as const).find((a) => a === action);
    if (!act) throw new BadRequestException('action must be confirm or remove');
    return this.db.asUser(uid, (svc, u) =>
      svc.receiptAction(u, id.slice(0, 160), act, {
        date: b.date == null ? undefined : date(b.date, 'date'),
        amount: typeof b.amount === 'number' ? b.amount : undefined,
        merchant: b.merchant == null ? undefined : str(b.merchant, 'merchant', 80),
        kind: typeof b.kind === 'string' ? (b.kind.slice(0, 20) as never) : undefined,
        why: b.why == null ? undefined : str(b.why, 'why', 200),
      }),
    );
  }

  @Post('claims/:id/head')
  headVerifyClaim(@UserId() uid: string, @Param('id') id: string, @Body() b: { ok?: unknown; note?: unknown }) {
    if (typeof b.ok !== 'boolean') throw new BadRequestException('ok must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.headVerifyClaim(u, id.slice(0, 160), b.ok as boolean, b.note == null ? '' : str(b.note, 'note', 300)));
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
        branchId: b.branchId ? str(b.branchId, 'branchId', 80) : null,
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

  // P78: register a year's statutory audit (the company, or the owner as master administrator).
  @Post('corporate/:companyId/audits')
  addCorpAudit(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    const pbc = Array.isArray(b.pbc) ? b.pbc.filter((x): x is string => typeof x === 'string').slice(0, 30).map((x) => x.slice(0, 120)) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.addCorpAudit(u, companyId.slice(0, 40), {
        fyEnd: date(b.fyEnd, 'fyEnd'),
        auditorFirm: str(b.auditorFirm ?? '', 'auditorFirm', 120),
        fee: b.fee == null || b.fee === '' ? null : Number(b.fee),
        pbc,
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

  // P78: list a system to protect (IT, or the owner as master administrator).
  @Post('continuity/systems')
  addBcmSystem(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const copies = Array.isArray(b.copies)
      ? b.copies.slice(0, 6).map((c) => {
          const x = (c ?? {}) as Record<string, unknown>;
          return { site: str(x.site ?? '', 'site', 20), where: str(x.where ?? '', 'where', 160), inMalaysia: x.inMalaysia === true };
        })
      : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.addBcmSystem(u, {
        name: str(b.name ?? '', 'name', 120),
        impact: str(b.impact ?? '', 'impact', 300),
        rtoHours: Number(b.rtoHours),
        rpoHours: Number(b.rpoHours),
        copies,
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

  // P78: add an obligation a company must prove (the company, internal audit, or the owner).
  @Post('grc/companies/:companyId/obligations')
  addGrcObligation(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addGrcObligation(u, companyId.slice(0, 40), {
        stream: str(b.stream ?? '', 'stream', 30) as never,
        title: str(b.title ?? '', 'title', 160),
        basis: str(b.basis ?? '', 'basis', 200),
        everyMonths: Number(b.everyMonths),
      }),
    );
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
    const a = (['quote', 'online', 'submit', 'approve', 'reject', 'reopen', 'order', 'receive', 'invoice', 'post'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown purchasing step');
    const opt = (k: string, max: number) => (b[k] == null ? undefined : str(b[k], k, max));
    if (b.qty != null && (!Array.isArray(b.qty) || b.qty.length > 30)) throw new BadRequestException('qty must be a list');
    if (b.lines != null && (!Array.isArray(b.lines) || b.lines.length > 30)) throw new BadRequestException('lines must be a list');
    const lines = Array.isArray(b.lines)
      ? b.lines.map((l: { item?: unknown; stockItemId?: unknown; qty?: unknown; unitPrice?: unknown }) => ({
          item: str(l?.item ?? '', 'item', 80),
          stockItemId: typeof l?.stockItemId === 'string' ? l.stockItemId.slice(0, 160) : null,
          qty: Number(l?.qty),
          unitPrice: Number(l?.unitPrice),
        }))
      : undefined;
    return this.db.asUser(uid, (svc, u) =>
      svc.purStep(u, id.slice(0, 160), a, {
        title: opt('title', 120),
        lines,
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

  /** One item register for the whole group (Fauzan, 6 Nov 2026). The core checks every field, role and state. */
  @Get('items')
  itemBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.items.board(u));
  }

  @Get('items/label/:label')
  itemByLabel(@UserId() uid: string, @Param('label') label: string) {
    return this.db.asUser(uid, (svc, u) => svc.items.resolve(u, label.slice(0, 80)));
  }

  /** A scanned sale paper (invoice, payment slip, signed letter), for the seller and the buyer only. */
  @Get('items/paper/:id')
  itemPaper(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.items.paperDocument(u, id.slice(0, 40)));
  }

  /** Shared post device: what is waiting for this guard, shown only after the face check passes. */
  @Post('items/device/pending')
  itemDevicePending(@UserId() uid: string, @Body() b: { staffNo?: unknown; face?: unknown }) {
    const staffNo = str(b.staffNo ?? '', 'staffNo', 30);
    return this.db.asUser(uid, (svc, u) => svc.items.devicePending(u, staffNo, face(b.face)));
  }

  @Post('items/act')
  itemAct(@UserId() uid: string, @Body() b: { requestId?: unknown; action?: unknown }) {
    if (!b.action || typeof b.action !== 'object' || Array.isArray(b.action)) throw new BadRequestException('action must be an object');
    const requestId = str(b.requestId ?? '', 'requestId', 80);
    return this.db.asUser(uid, (svc, u) => svc.items.act(u, requestId, b.action as ItemAction));
  }

  @Post('purchasing/:companyId/issues')
  stockIssue(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.stockIssue(u, companyId.slice(0, 40), {
        itemId: str(b.itemId ?? '', 'itemId', 160),
        personId: str(b.personId ?? '', 'personId', 160),
        qty: Number(b.qty),
        serial: b.serial == null ? undefined : str(b.serial, 'serial', 60),
        slip: b.slip == null ? undefined : proofList(b.slip),
        omUserId: b.omUserId == null ? undefined : str(b.omUserId, 'omUserId', 160),
        patrolPersonId: b.patrolPersonId == null ? undefined : str(b.patrolPersonId, 'patrolPersonId', 160),
      }),
    );
  }

  // Proof that a Goodwill item reached the guard, with each file checked against its recorded SHA-256 (Fauzan, 2 Nov 2026).
  @Get('purchasing/issues/:id/proof')
  deliveryProof(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.deliveryProof(u, id.slice(0, 160)));
  }

  // A Goodwill item's handover: the OM, then the patrolling officer, then the guard (Fauzan, 2 Nov 2026).
  @Post('purchasing/issues/:id/handover/:step')
  handoverStep(@UserId() uid: string, @Param('id') id: string, @Param('step') step: string, @Body() b: Record<string, unknown>) {
    const s = (['om', 'patrol', 'guard'] as const).find((x) => x === step);
    if (!s) throw new BadRequestException('step must be om, patrol or guard');
    if (typeof b.received !== 'boolean') throw new BadRequestException('received must be true or false');
    return this.db.asUser(uid, (svc, u) =>
      svc.handoverStep(u, id.slice(0, 160), s, {
        received: b.received as boolean,
        note: str(b.note ?? '', 'note', 300),
        slip: b.slip == null ? undefined : proofList(b.slip),
        photo: b.photo == null ? undefined : proofList(b.photo),
        signature: b.signature == null ? undefined : str(b.signature, 'signature', 210_000),
        place: placeOf(b.place),
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

  @Post('credit/loans/:id/stamped')
  creditStamped(@UserId() uid: string, @Param('id') id: string, @Body() b: { ref?: unknown; on?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.creditStamped(u, id.slice(0, 160), str(b.ref ?? '', 'ref', 60), date(b.on, 'on')));
  }

  @Post('credit/loans/:id/collateral')
  creditCorrectCollateral(@UserId() uid: string, @Param('id') id: string, @Body() b: { kind?: unknown; agreementRef?: unknown; reason?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.creditCorrectCollateral(u, id.slice(0, 160), {
        kind: str(b.kind ?? '', 'kind', 30) as 'NONE',
        agreementRef: b.agreementRef == null ? null : str(b.agreementRef, 'agreementRef', 80),
        reason: str(b.reason ?? '', 'reason', 300),
      }),
    );
  }

  /** Masterplan §103: the Deputy Chief of Staff records the KPKT moneylending licence check for a loan. */
  @Post('credit/loans/:id/licence')
  creditCheckLenderLicence(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.creditCheckLenderLicence(u, id.slice(0, 160), { ref: str(b.ref ?? '', 'ref', 60), validTo: date(b.validTo, 'validTo'), note: str(b.note ?? '', 'note', 300) }),
    );
  }

  /** Audited correction of a stamp, charge lodgement or signing date already on the loan (credit officer, with a reason). */
  @Post('credit/loans/:id/correct')
  creditCorrectRecord(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const opt = (v: unknown, name: string) => (v == null || v === '' ? null : date(v, name));
    const reason = str(b.reason ?? '', 'reason', 300);
    const input =
      b.field === 'stamp'
        ? { field: 'stamp' as const, ref: b.ref == null ? null : str(b.ref, 'ref', 60), on: opt(b.on, 'on'), reason }
        : b.field === 'charge'
          ? {
              field: 'charge' as const,
              createdOn: date(b.createdOn, 'createdOn'),
              ssmRef: b.ssmRef == null ? null : str(b.ssmRef, 'ssmRef', 60),
              lodgedOn: opt(b.lodgedOn, 'lodgedOn'),
              reason,
            }
          : b.field === 'signedOn'
            ? { field: 'signedOn' as const, signedOn: opt(b.signedOn, 'signedOn'), reason }
            : null;
    if (!input) throw new BadRequestException('field must be stamp, charge or signedOn');
    return this.db.asUser(uid, (svc, u) => svc.creditCorrectRecord(u, id.slice(0, 160), input));
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
        signedOn: b.signedOn == null || b.signedOn === '' ? null : date(b.signedOn, 'signedOn'),
        termMonths: Number(b.termMonths),
        agreementRef: str(b.agreementRef ?? '', 'agreementRef', 80),
        templateId: str(b.templateId ?? '', 'templateId', 40),
        collateral,
        collateralRef: b.collateralRef == null ? null : str(b.collateralRef, 'collateralRef', 80),
        chargeCreatedOn: b.chargeCreatedOn == null ? null : date(b.chargeCreatedOn, 'chargeCreatedOn'),
      }),
    );
  }

  // ----- Renewals and compliance calendar (Central Admin 5C) -----
  @Get('renewals')
  renewalBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.renewalBoard(u));
  }

  @Post('renewals/:id/:action')
  renewalStep(
    @UserId() uid: string,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() b: { index?: unknown; name?: unknown; ref?: unknown; amount?: unknown; on?: unknown; note?: unknown; newExpiresOn?: unknown; ok?: unknown },
  ) {
    const a = (['open', 'paper', 'addPaper', 'sign', 'fee', 'submit', 'agency', 'return', 'renewed', 'confirm'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown renewal step');
    const amount = b.amount == null || b.amount === '' ? null : Number(b.amount);
    if (amount !== null && !Number.isFinite(amount)) throw new BadRequestException('amount must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.renewalStep(u, id.slice(0, 160), a, {
        index: typeof b.index === 'number' ? b.index : undefined,
        name: b.name == null ? undefined : str(b.name, 'name', 120),
        ref: b.ref == null ? undefined : str(b.ref, 'ref', 120),
        amount,
        on: b.on == null ? undefined : date(b.on, 'on'),
        note: b.note == null ? undefined : str(b.note, 'note', 300),
        newExpiresOn: b.newExpiresOn == null ? undefined : date(b.newExpiresOn, 'newExpiresOn'),
        ok: typeof b.ok === 'boolean' ? b.ok : undefined,
      }),
    );
  }

  // ----- Company secretary (V9) -----
  @Get('corporate')
  corpBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.corpBoard(u));
  }

  // P78: Corporate Admin or the owner adds a filing (annual return, financial statements, other SSM lodgement).
  @Post('corporate/:companyId/filings')
  addCorpFiling(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addCorpFiling(u, companyId.slice(0, 40), {
        kind: str(b.kind, 'kind', 30) as CorpFilingKind,
        title: str(b.title ?? '', 'title', 160),
        dueOn: date(b.dueOn, 'dueOn'),
        basis: str(b.basis ?? '', 'basis', 200),
      }),
    );
  }

  @Post('corporate/filings/:id/:action')
  corpFilingStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { ref?: unknown; on?: unknown }) {
    const a = (['prepare', 'lodge', 'receipt'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be prepare, lodge or receipt');
    return this.db.asUser(uid, (svc, u) =>
      svc.corpFilingStep(u, id.slice(0, 160), a, { ref: b.ref == null ? '' : str(b.ref, 'ref', 60), on: b.on == null ? undefined : date(b.on, 'on') }),
    );
  }

  // Central Admin 5B company file: the service validates every field and enforces who may draft and who may check.
  @Get('corporate/files')
  companyFiles(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.companyFiles(u));
  }

  @Post('corporate/:companyId/file')
  saveCompanyFile(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the company file fields.');
    const keys = ['directors', 'shareholders', 'beneficialOwners', 'constitution', 'papers', 'secretaryFirm', 'secretaryLicence', 'auditor'] as const;
    const input = Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
    return this.db.asUser(uid, (svc, u) => svc.saveCompanyFile(u, companyId.slice(0, 40), input as Parameters<typeof svc.saveCompanyFile>[2]));
  }

  // P78: start the company file for a company with none yet; the service validates and checks who keeps the file.
  @Post('corporate/:companyId/file/start')
  startCompanyFile(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the company file fields.');
    const directors = Array.isArray(b.directors)
      ? b.directors.slice(0, 30).map((d: Record<string, unknown>) => ({ name: str(d?.name ?? '', 'name', 120), appointedOn: str(d?.appointedOn ?? '', 'appointedOn', 10) }))
      : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.startCompanyFile(u, companyId.slice(0, 40), {
        regNo: b.regNo == null ? undefined : str(b.regNo, 'regNo', 40),
        incorporatedOn: str(b.incorporatedOn ?? '', 'incorporatedOn', 10),
        fyeMonth: Number(b.fyeMonth),
        secretaryFirm: str(b.secretaryFirm ?? '', 'secretaryFirm', 120),
        secretaryLicence: str(b.secretaryLicence ?? '', 'secretaryLicence', 40),
        auditor: str(b.auditor ?? '', 'auditor', 120),
        directors,
      }),
    );
  }

  @Post('corporate/:companyId/file/check')
  checkCompanyFile(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    if (typeof b?.ok !== 'boolean') throw new BadRequestException('Say whether the file matches SSM.');
    const mismatches = b.mismatches === undefined ? [] : b.mismatches;
    if (!Array.isArray(mismatches) || mismatches.some((m) => typeof m !== 'string')) throw new BadRequestException('List the differences as text.');
    return this.db.asUser(uid, (svc, u) =>
      svc.checkCompanyFile(u, companyId.slice(0, 40), { ok: b.ok as boolean, ssmRef: str(b.ssmRef ?? '', 'ssmRef', 80), mismatches: mismatches as string[], note: str(b.note ?? '', 'note', 500) }),
    );
  }

  // Central Admin 5D panel firms: Central Admin keeps audit and secretary firms, PWVSB legal keeps law firms.
  @Get('corporate/panel')
  panelBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.panelBoard(u));
  }

  @Post('corporate/panel')
  addPanelFirm(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['AUDIT', 'LAW', 'SECRETARY'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('Choose audit, law or secretary firm.');
    return this.db.asUser(uid, (svc, u) =>
      svc.addPanelFirm(u, {
        kind,
        name: str(b.name, 'name', 120),
        regNo: str(b.regNo, 'regNo', 40),
        contact: str(b.contact ?? '', 'contact', 120),
        feeBasis: str(b.feeBasis ?? '', 'feeBasis', 200),
        appointedOn: str(b.appointedOn, 'appointedOn', 10),
      }),
    );
  }

  @Post('corporate/panel/:id/:action')
  panelFirmStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    if (action !== 'review' && action !== 'remove') throw new BadRequestException('unknown action');
    return this.db.asUser(uid, (svc, u) => svc.panelFirmStep(u, id.slice(0, 80), action, str(b.note ?? '', 'note', 500)));
  }

  /** Masterplan §126: adviser budgets (keeper proposes, Finance Director agrees) and audit/secretary invoices. */
  @Post('corporate/panel/:id/money/:action')
  adviserMoneyStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['budget', 'agree', 'invoice', 'check', 'resubmit', 'accept', 'ap'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown action');
    const opt = (v: unknown, name: string, max: number) => (v == null || v === '' ? undefined : str(v, name, max));
    return this.db.asUser(uid, (svc, u) =>
      svc.adviserMoneyStep(u, id.slice(0, 80), a, {
        year: opt(b.year, 'year', 4),
        amount: b.amount == null ? undefined : Number(b.amount),
        reason: opt(b.reason, 'reason', 300),
        note: opt(b.note, 'note', 300),
        no: opt(b.no, 'no', 40),
        on: b.on == null || b.on === '' ? undefined : date(b.on, 'on'),
        companyId: b.companyId == null || b.companyId === '' ? null : str(b.companyId, 'companyId', 40),
        forWhat: opt(b.forWhat, 'forWhat', 200),
        invoiceId: opt(b.invoiceId, 'invoiceId', 80),
        result: b.result === 'passed' || b.result === 'queried' ? b.result : undefined,
        evidenceRef: opt(b.evidenceRef, 'evidenceRef', 120),
        entityId: opt(b.entityId, 'entityId', 40),
        apRef: opt(b.apRef, 'apRef', 40),
        postedOn: b.postedOn == null || b.postedOn === '' ? undefined : date(b.postedOn, 'postedOn'),
      }),
    );
  }

  /** Masterplan §243: the emergency delegation and succession register. A register only; it grants nothing. */
  @Get('delegations')
  delegationBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.delegationBoard(u));
  }

  @Post('delegations/:companyId')
  addDelegation(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    const kind = (['EMERGENCY', 'SUCCESSION', 'LEAVE_COVER'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('Choose emergency, succession or leave cover.');
    return this.db.asUser(uid, (svc, u) =>
      svc.addDelegation(u, companyId.slice(0, 40), {
        kind,
        post: str(b.post ?? '', 'post', 80),
        holderId: b.holderId == null || b.holderId === '' ? null : str(b.holderId, 'holderId', 80),
        holderName: str(b.holderName ?? '', 'holderName', 80),
        criticalRoleId: b.criticalRoleId == null || b.criticalRoleId === '' ? null : str(b.criticalRoleId, 'criticalRoleId', 120),
        delegateId: str(b.delegateId ?? '', 'delegateId', 80),
        scope: str(b.scope ?? '', 'scope', 300),
        from: date(b.from, 'from'),
        to: b.to == null || b.to === '' ? null : date(b.to, 'to'),
        reason: str(b.reason ?? '', 'reason', 300),
      }),
    );
  }

  @Post('delegations/item/:id/:action')
  delegationStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['approve', 'end', 'revoke', 'evidence', 'access', 'access-remove', 'transfer', 'handback'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown action');
    const opt = (v: unknown, name: string, max: number) => (v == null ? undefined : str(v, name, max));
    const ck = b.competencyKind;
    return this.db.asUser(uid, (svc, u) =>
      svc.delegationStep(u, id.slice(0, 120), a, str(b.note ?? '', 'note', 300), {
        competencyKind: ck === 'hr_training' || ck === 'hr_appraisal' || ck === 'document' ? ck : undefined,
        competencyRef: opt(b.competencyRef, 'competencyRef', 120),
        boardRef: opt(b.boardRef, 'boardRef', 120),
        boardOn: b.boardOn == null || b.boardOn === '' ? undefined : date(b.boardOn, 'boardOn'),
        systems: opt(b.systems, 'systems', 300),
        until: b.until == null || b.until === '' ? undefined : date(b.until, 'until'),
        taskIds: Array.isArray(b.taskIds) ? b.taskIds.slice(0, 50).map((x) => str(x, 'taskIds', 80)) : undefined,
      }),
    );
  }

  /** Masterplan §125 legal hold: PWVSB legal or the Deputy Chief of Staff; group leaders read. */
  @Get('legal-holds')
  legalHoldBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.legalHoldBoard(u));
  }

  @Post('legal-holds/:matterId')
  placeLegalHold(@UserId() uid: string, @Param('matterId') matterId: string, @Body() b: Record<string, unknown>) {
    const tbl = (['evidence_docs', 'evidence_photos', 'cases', 'contracts', 'corp_profiles', 'people', 'insurance_claims'] as const).find((t) => t === b.tbl);
    if (!tbl) throw new BadRequestException('Choose what kind of record to hold.');
    return this.db.asUser(uid, (svc, u) =>
      svc.placeLegalHold(u, matterId.slice(0, 80), { tbl, refId: str(b.refId ?? '', 'refId', 120), reason: str(b.reason ?? '', 'reason', 300) }),
    );
  }

  @Post('legal-holds/item/:id/release')
  releaseLegalHold(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.releaseLegalHold(u, id.slice(0, 80), str(b.reason ?? '', 'reason', 300)));
  }

  /** Masterplan §243 critical-role inventory (Arisha main round 5). */
  @Post('critical-roles/:companyId')
  addCriticalRole(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addCriticalRole(u, companyId.slice(0, 40), {
        post: str(b.post ?? '', 'post', 80),
        holderId: b.holderId == null || b.holderId === '' ? null : str(b.holderId, 'holderId', 80),
        holderName: str(b.holderName ?? '', 'holderName', 80),
        whyCritical: str(b.whyCritical ?? '', 'whyCritical', 300),
        successors: successorsOf(b.successors),
      }),
    );
  }

  @Post('critical-roles/item/:id/:action')
  criticalRoleStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    if (action !== 'review' && action !== 'retire') throw new BadRequestException('unknown action');
    return this.db.asUser(uid, (svc, u) =>
      svc.criticalRoleStep(u, id.slice(0, 120), action, { note: str(b.note ?? '', 'note', 300), successors: b.successors == null ? undefined : successorsOf(b.successors) }),
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
  approveBranchSettlement(@UserId() uid: string, @Param('id') id: string, @Body() b: { note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.approveBranchSettlement(u, id.slice(0, 120), b?.note == null ? '' : str(b.note, 'note', 300)));
  }

  // Masterplan chapter 03 (Fauzan, 3 Nov 2026): branch lifecycle and month ledger.
  @Post('companies/:companyId/branches')
  addBranch(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    const model = (['A', 'B', 'C'] as const).find((x) => x === b?.model);
    if (!model) throw new BadRequestException('model must be A, B or C');
    return this.db.asUser(uid, (svc, u) =>
      svc.addBranch(u, companyId.slice(0, 40), { name: str(b.name ?? '', 'name', 80), state: str(b.state ?? '', 'state', 40), model }),
    );
  }

  @Get('companies/:companyId/branch-leads')
  branchLeadClaims(@UserId() uid: string, @Param('companyId') companyId: string) {
    return this.db.asUser(uid, (svc, u) => svc.branchLeadClaims(u, companyId.slice(0, 40)));
  }

  @Post('branches/:id/act')
  branchAct(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    const action = str(b.action ?? '', 'action', 30);
    if (Array.isArray(b.lines) && b.lines.length > 300) throw new BadRequestException('At most 300 lines');
    if (Array.isArray(b.cash13) && b.cash13.length > 13) throw new BadRequestException('At most 13 weeks');
    return this.db.asUser(uid, (svc, u) => svc.branchAct(u, id.slice(0, 120), action, b));
  }

  @Post('branch-settlements/:id/act')
  branchSettlementAct(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    const action = str(b.action ?? '', 'action', 30);
    return this.db.asUser(uid, (svc, u) => svc.branchSettlementAct(u, id.slice(0, 120), action, b));
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

  // ----- CMS commissioning (masterplan §191): signed scope, contact test calls, operator and client acceptance -----
  @Post('contracts/:id/cms-service')
  setCmsService(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const sites = Array.isArray(b.sites) ? b.sites.slice(0, 50) : [];
    const services = Array.isArray(b.services) ? b.services.slice(0, 10) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.setCmsService(u, id.slice(0, 120), {
        sites: sites.map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return { siteId: str(o.siteId, 'siteId', 120), from: str(o.from, 'from', 5), to: str(o.to, 'to', 5) };
        }),
        services: services.map((x) => str(x, 'service', 20)) as never,
        signedRef: str(b.signedRef, 'signedRef', 120),
        clientSignatory: str(b.clientSignatory, 'clientSignatory', 120),
        signedOn: date(b.signedOn, 'signedOn'),
      }),
    );
  }

  @Post('contracts/:id/cms-service/contacts/:index/verify')
  verifyCmsContact(@UserId() uid: string, @Param('id') id: string, @Param('index') index: string, @Body() b: Record<string, unknown>) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i > 200) throw new BadRequestException('index');
    if (typeof b.version !== 'number' || !Number.isInteger(b.version)) throw new BadRequestException('version');
    return this.db.asUser(uid, (svc, u) => svc.verifyCmsContact(u, id.slice(0, 120), i, b.version as number, str(b.note, 'note', 300)));
  }

  @Post('contracts/:id/cms-service/tests')
  recordCmsTest(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.version !== 'number' || !Number.isInteger(b.version)) throw new BadRequestException('version');
    const service = (['cctv', 'alarm', 'attendance', 'patrol'] as const).find((x) => x === b.service);
    if (!service) throw new BadRequestException('service');
    return this.db.asUser(uid, (svc, u) => svc.recordCmsTest(u, id.slice(0, 120), b.version as number, service, str(b.siteId, 'siteId', 120), str(b.note, 'note', 300)));
  }

  @Post('contracts/:id/cms-service/accept/:who')
  acceptCmsService(@UserId() uid: string, @Param('id') id: string, @Param('who') who: string, @Body() b: Record<string, unknown>) {
    const w = (['operator', 'client'] as const).find((x) => x === who);
    if (!w) throw new BadRequestException('who must be operator or client');
    if (typeof b.version !== 'number' || !Number.isInteger(b.version)) throw new BadRequestException('version');
    const opt = (v: unknown, n: string) => (v == null ? undefined : str(v, n, 300));
    return this.db.asUser(uid, (svc, u) =>
      svc.acceptCmsService(u, id.slice(0, 120), w, b.version as number, { note: opt(b.note, 'note'), clientName: opt(b.clientName, 'clientName'), ref: opt(b.ref, 'ref') }),
    );
  }

  @Get('cms/commissioning')
  cmsCommissioning(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.cmsCommissioning(u));
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

  // ----- Finance Phase 2 (31 Oct 2026): payments, the month-end close, bank and payment packs -----
  // Prima approves and records; SQL Account keeps the books and the bank portal moves the money.
  @Get('finance/today')
  financeToday(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeToday(u));
  }

  // Advances, cards and petty cash that belong to the signed-in person (anyone, Finance or not), and overdue advances for HR.
  @Get('finance/cash/mine')
  finCashMine(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeControls.cashMine(u));
  }

  // Daily cash held by the signed-in COO or CEO (Fauzan, 2 Nov 2026).
  @Get('finance/dailycash/mine')
  finDailyCashMine(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeControls.dailyCashMine(u));
  }

  @Get('finance/cash/advances-overdue')
  finAdvancesOverdue(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeControls.advancesForHr(u));
  }

  @Get('finance/desk')
  finDesk(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.finance.desk(u));
  }

  @Post('finance/:companyId/payments')
  finCreatePayment(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the payment as an object');
    return this.db.asUser(uid, (svc, u) => svc.finance.createPayment(u, companyId.slice(0, 120), b));
  }

  @Post('finance/:companyId/payments/:paymentId/:action')
  finPaymentStep(
    @UserId() uid: string,
    @Param('companyId') companyId: string,
    @Param('paymentId') paymentId: string,
    @Param('action') action: string,
    @Body() b: Record<string, unknown>,
  ) {
    const a = (['review', 'approve', 'return', 'resubmit', 'release', 'cancel', 'link'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be review, approve, return, resubmit, release, cancel or link');
    if (b != null && (typeof b !== 'object' || Array.isArray(b))) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.finance.paymentStep(u, companyId.slice(0, 120), paymentId.slice(0, 160), a, b ?? {}));
  }

  // Group Finance settings (Fauzan, 1 Nov 2026): every Finance person reads them; the FD or the CEO sets them.
  @Get('finance/settings')
  finSettings(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.finance.settingsView(u));
  }

  @Post('finance/settings')
  finSetSettings(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the settings as an object');
    return this.db.asUser(uid, (svc, u) => svc.finance.setSettings(u, b));
  }

  // Finance KPIs (Fauzan, 1 Nov 2026): speed and quality; team leader, FD, CEO, COO, ACT Director and HR department.
  @Get('finance/kpi')
  finKpi(@UserId() uid: string, @Query('period') period?: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeKpi.view(u, period));
  }

  // Payment requests (Fauzan, 1 Nov 2026): the company head creates, the department head approves, Finance checks the
  // calculation, the COO (or the FD for Finance) approves, then Finance pays it.
  @Get('finance/requests')
  finRequests(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeRequests.list(u));
  }

  @Post('finance/requests/:companyId')
  finCreateRequest(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the request as an object');
    return this.db.asUser(uid, (svc, u) => svc.financeRequests.create(u, companyId.slice(0, 120), b));
  }

  @Post('finance/requests/:companyId/:requestId/:action')
  finRequestStep(
    @UserId() uid: string,
    @Param('companyId') companyId: string,
    @Param('requestId') requestId: string,
    @Param('action') action: string,
    @Body() b: Record<string, unknown>,
  ) {
    const a = (['head', 'verify', 'approve', 'return', 'resubmit', 'cancel'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be head, verify, approve, return, resubmit or cancel');
    if (b != null && (typeof b !== 'object' || Array.isArray(b))) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.financeRequests.step(u, companyId.slice(0, 120), requestId.slice(0, 160), a, b ?? {}));
  }

  // The COO approves payments for the departments he monitors (Fauzan, 1 Nov 2026); only approve or return.
  @Get('finance/coo')
  finCooDesk(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.finance.cooDesk(u));
  }

  @Post('finance/coo/:companyId/:paymentId/:action')
  finCooStep(
    @UserId() uid: string,
    @Param('companyId') companyId: string,
    @Param('paymentId') paymentId: string,
    @Param('action') action: string,
    @Body() b: Record<string, unknown>,
  ) {
    const a = (['approve', 'return'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be approve or return');
    if (b != null && (typeof b !== 'object' || Array.isArray(b))) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.finance.cooStep(u, companyId.slice(0, 120), paymentId.slice(0, 160), a, b ?? {}));
  }

  // The Finance dashboard and each company's monthly pack (Fauzan, 2 Nov 2026).
  @Get('finance/dashboard')
  finDashboard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeControls.dashboard(u));
  }

  // What waits for the person in each company and Checks section (staff-eye review, Fauzan 2 Nov 2026).
  @Get('finance/checks-todo')
  finChecksTodo(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeControls.checksTodo(u));
  }

  @Get('finance/:companyId/pack')
  finPack(@UserId() uid: string, @Param('companyId') companyId: string, @Query('period') period?: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeControls.pack(u, companyId.slice(0, 120), typeof period === 'string' ? period.slice(0, 7) : undefined));
  }

  // Part 2 (31 Oct 2026): payees, bank statements, ageing, SST, budget and forecast.
  @Get('finance/:companyId/controls')
  finControls(@UserId() uid: string, @Param('companyId') companyId: string, @Query('billPeriod') billPeriod?: string) {
    return this.db.asUser(uid, (svc, u) => svc.financeControls.view(u, companyId.slice(0, 120), typeof billPeriod === 'string' ? billPeriod.slice(0, 7) : undefined));
  }

  @Post('finance/:companyId/controls/:area/:action')
  finControlAction(
    @UserId() uid: string,
    @Param('companyId') companyId: string,
    @Param('area') area: string,
    @Param('action') action: string,
    @Body() b: Record<string, unknown>,
  ) {
    if (!/^[a-zA-Z]{2,20}$/.test(action)) throw new BadRequestException('Unknown action');
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    const cid = companyId.slice(0, 120);
    return this.db.asUser(uid, (svc, u) => {
      const c = svc.financeControls;
      if (area === 'payees') return c.payeeAction(u, cid, action, b);
      if (area === 'statements') return c.statementAction(u, cid, action, b);
      if (area === 'ageing') return c.ageingAction(u, cid, action, b);
      if (area === 'figures') return c.figuresAction(u, cid, action, b);
      if (area === 'coa') return c.coaAction(u, cid, action, b);
      if (area === 'sql') return c.sqlAction(u, cid, action, b);
      if (area === 'sst') return c.sstAction(u, cid, action, b);
      if (area === 'plan') return c.planAction(u, cid, action, b);
      if (area === 'einvoice') return c.einvoiceAction(u, cid, action, b);
      if (area === 'ar') return c.arAction(u, cid, action, b);
      if (area === 'bankrec') return c.bankRecAction(u, cid, action, b);
      if (area === 'regular') return c.regularAction(u, cid, action, b);
      if (area === 'guarantees') return c.guaranteeAction(u, cid, action, b);
      if (area === 'tax') return c.taxAction(u, cid, action, b);
      if (area === 'mandates') return c.mandateAction(u, cid, action, b);
      if (area === 'advances') return c.advanceAction(u, cid, action, b);
      if (area === 'petty') return c.pettyAction(u, cid, action, b);
      if (area === 'cards') return c.cardAction(u, cid, action, b);
      if (area === 'billing') return c.billingAction(u, cid, action, b);
      if (area === 'govt') return c.govtAction(u, cid, action, b);
      if (area === 'moneyin') return c.moneyInAction(u, cid, action, b);
      if (area === 'stamp') return c.stampAction(u, cid, action, b);
      if (area === 'dailycash') return c.dailyCashAction(u, cid, action, b);
      if (area === 'intercompany') return c.icAction(u, cid, action, b);
      if (area === 'cash13') return c.cash13Action(u, cid, action, b);
      if (area === 'pack') return c.packAction(u, cid, action, b);
      if (area === 'hostel') return c.hostelAction(u, cid, action, b);
      if (area === 'deposits') return c.depositAction(u, cid, action, b);
      if (area === 'fd') return c.fdAction(u, cid, action, b);
      if (area === 'charges') return c.chargeAction(u, cid, action, b);
      if (area === 'wht') return c.whtAction(u, cid, action, b);
      if (area === 'schedules') return c.scheduleAction(u, cid, action, b);
      if (area === 'assets') return c.assetAction(u, cid, action, b);
      if (area === 'audit') return c.auditAction(u, cid, action, b);
      if (area === 'credit') return c.creditAction(u, cid, action, b);
      if (area === 'supstatements') return c.supplierStatementAction(u, cid, action, b);
      throw new BadRequestException('area must be payees, statements, ageing, sst, plan, einvoice, ar, bankrec, regular, guarantees, tax, mandates, advances, petty, cards, billing, govt, moneyin, stamp, dailycash, intercompany, cash13, pack, hostel, deposits, fd, charges, wht, schedules, assets, audit, credit or supstatements');
    });
  }

  @Post('finance/:companyId/close/:action')
  finCloseStep(@UserId() uid: string, @Param('companyId') companyId: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['evidence', 'explain', 'prepare', 'review', 'approve', 'return', 'reopen'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('action must be evidence, explain, prepare, review, approve, return or reopen');
    if (b != null && (typeof b !== 'object' || Array.isArray(b))) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.finance.closeStep(u, companyId.slice(0, 120), a, b ?? {}));
  }

  // P78: a company bank account added to the books (team leader, FD or CEO), and books started for a new company (FD or CEO).
  @Post('finance/:companyId/banks')
  finAddBankAccount(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.finance.addBankAccount(u, companyId.slice(0, 120), b));
  }

  @Post('finance/:companyId/books')
  finStartBooks(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.finance.startBooks(u, companyId.slice(0, 120), b));
  }

  // P78: a paper for the auditor or the tax agent added (declared before finance/:companyId/:pack/:itemId on purpose).
  @Post('finance/:companyId/papers/:pack')
  finAddPaper(@UserId() uid: string, @Param('companyId') companyId: string, @Param('pack') pack: string, @Body() b: { label?: unknown; dueOn?: unknown }) {
    const p = (['audit', 'tax'] as const).find((x) => x === pack);
    if (!p) throw new BadRequestException('pack must be audit or tax');
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    return this.db.asUser(uid, (svc, u) => svc.addFinPaper(u, companyId.slice(0, 120), p, b));
  }

  @Post('finance/:companyId/:pack/:itemId')
  setFinPack(
    @UserId() uid: string,
    @Param('companyId') companyId: string,
    @Param('pack') pack: string,
    @Param('itemId') itemId: string,
    @Body() b: { status?: unknown; comment?: unknown },
  ) {
    const p = (['audit', 'tax', 'bank', 'payment', 'monthly'] as const).find((x) => x === pack);
    const st = (['todo', 'prepared', 'reviewed', 'sent'] as const).find((x) => x === b.status);
    if (!p || !st) throw new BadRequestException('pack must be audit, tax, bank, payment or monthly; status todo, prepared, reviewed or sent');
    const comment = typeof b.comment === 'string' ? b.comment.slice(0, 500) : undefined;
    return this.db.asUser(uid, (svc, u) => svc.setFinPack(u, companyId.slice(0, 120), p, itemId.slice(0, 80), st, comment));
  }

  // ----- Guard pay run: HR prepares, the COO approves, Finance pays (Fauzan, 5 Nov 2026) -----
  @Get('guard-pay')
  guardPayroll(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.guardPayroll(u));
  }

  // Wage advances (Fauzan, 6 Nov 2026): the OM sets, the OD or OGM approves, Finance pays.
  @Get('guard-pay/advances')
  guardAdvances(@UserId() uid: string, @Query('companyId') companyId?: string, @Query('period') period?: string) {
    return this.db.asUser(uid, (svc, u) => svc.guardAdvances(u, { companyId: companyId?.slice(0, 120) || null, period: period?.slice(0, 7) || null }));
  }

  @Post('guard-pay/advances')
  setGuardAdvances(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.setGuardAdvances(u, {
        companyId: str(b.companyId, 'companyId', 120),
        period: b.period == null ? undefined : str(b.period, 'period', 7),
        basis: str(b.basis, 'basis', 10),
        ref: str(b.ref, 'ref', 120),
        amount: Number(b.amount),
        payOn: b.payOn == null || b.payOn === '' ? undefined : date(b.payOn, 'payOn'),
        reason: b.reason == null ? '' : str(b.reason, 'reason', 300),
      }),
    );
  }

  // Advance and loan scheme (Fauzan, 6 Nov 2026): HR records with the signed agreement, CoS then CEO approve, Finance pays out.
  @Get('guard-pay/loans')
  guardLoans(@UserId() uid: string, @Query('companyId') companyId?: string) {
    return this.db.asUser(uid, (svc, u) => svc.guardLoans(u, { companyId: companyId?.slice(0, 120) || null }));
  }

  @Post('guard-pay/loans')
  recordGuardLoan(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.recordGuardLoan(u, {
        companyId: str(b.companyId, 'companyId', 120),
        personId: str(b.personId, 'personId', 120),
        kind: str(b.kind, 'kind', 10),
        limit: Number(b.limit),
        amount: b.amount == null || b.amount === '' ? undefined : Number(b.amount),
        purpose: b.purpose == null ? '' : str(b.purpose, 'purpose', 200),
        months: Number(b.months),
        firstPeriod: b.firstPeriod == null || b.firstPeriod === '' ? undefined : str(b.firstPeriod, 'firstPeriod', 7),
        docRef: b.docRef == null ? '' : str(b.docRef, 'docRef', 80),
        signedOn: b.signedOn == null || b.signedOn === '' ? '' : date(b.signedOn, 'signedOn'),
      }),
    );
  }

  @Post('guard-pay/loans/:id/:action')
  guardLoanStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const lid = id.slice(0, 200);
    if (action === 'decide')
      return this.db.asUser(uid, (svc, u) => svc.decideGuardLoan(u, lid, { decision: str(b.decision, 'decision', 10), note: b.note == null ? '' : str(b.note, 'note', 300) }));
    if (action === 'payout')
      return this.db.asUser(uid, (svc, u) => svc.payOutGuardLoan(u, lid, { bankRef: b.bankRef == null ? '' : str(b.bankRef, 'bankRef', 60), paidOn: b.paidOn == null ? undefined : date(b.paidOn, 'paidOn') }));
    if (action === 'cancel') return this.db.asUser(uid, (svc, u) => svc.cancelGuardLoan(u, lid, b.note == null ? '' : str(b.note, 'note', 300)));
    throw new BadRequestException('unknown loan action');
  }

  @Post('guard-pay/advances/approve')
  approveGuardAdvances(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const ids = Array.isArray(b.ids) ? b.ids.slice(0, 500).map((x) => String(x).slice(0, 200)) : [];
    return this.db.asUser(uid, (svc, u) => svc.approveGuardAdvances(u, ids, b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Post('guard-pay/advances/:id/pay')
  payGuardAdvance(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.payGuardAdvance(u, id.slice(0, 200), { bankRef: b.bankRef == null ? '' : str(b.bankRef, 'bankRef', 60), paidOn: b.paidOn == null ? undefined : date(b.paidOn, 'paidOn') }),
    );
  }

  @Post('guard-pay/advances/:id')
  changeGuardAdvance(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.changeGuardAdvance(u, id.slice(0, 200), {
        action: b.action === 'cancel' ? 'cancel' : 'change',
        amount: b.amount == null ? undefined : Number(b.amount),
        payOn: b.payOn == null || b.payOn === '' ? undefined : date(b.payOn, 'payOn'),
        reason: b.reason == null ? '' : str(b.reason, 'reason', 300),
      }),
    );
  }

  // HR records a guard's written consent to be paid into a relative's or friend's account (Fauzan, 6 Nov 2026).
  @Post('guard-pay/consent/:personId')
  recordPayConsent(@UserId() uid: string, @Param('personId') personId: string, @Body() b: Record<string, unknown>) {
    const s = (k: string, n: number) => (b[k] == null ? undefined : str(b[k], k, n));
    return this.db.asUser(uid, (svc, u) =>
      svc.recordPayConsent(u, personId.slice(0, 120), {
        holder: s('holder', 10),
        holderName: s('holderName', 80),
        relationship: s('relationship', 40),
        docRef: s('docRef', 60),
        signedOn: s('signedOn', 10),
        kind: s('kind', 10),
        commissioner: s('commissioner', 80),
        stampRef: s('stampRef', 40),
        stampedOn: s('stampedOn', 10),
      }),
    );
  }

  // Statutory rates and new contribution types: the CEO sets them by month (Fauzan, 6 Nov 2026).
  @Get('statutory')
  statutoryBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.statutoryBoard(u));
  }

  @Post('statutory')
  setStatutory(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (JSON.stringify(b ?? {}).length > 20000) throw new BadRequestException('too large');
    return this.db.asUser(uid, (svc, u) =>
      svc.setStatutory(u, {
        effectiveFrom: str(b.effectiveFrom, 'effectiveFrom', 7),
        settings: b.settings as Parameters<typeof svc.setStatutory>[1]['settings'],
        reason: b.reason == null ? '' : str(b.reason, 'reason', 500),
      }),
    );
  }

  // The COO approves a stamped consent letter (Fauzan, 6 Nov 2026).
  @Get('guard-pay/consents')
  payConsentsWaiting(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.payConsentsWaiting(u));
  }

  @Post('guard-pay/consent/:personId/approve')
  approvePayConsent(@UserId() uid: string, @Param('personId') personId: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.approvePayConsent(u, personId.slice(0, 120), b.note == null ? '' : str(b.note, 'note', 300)));
  }

  @Get('guard-pay/mine')
  myGuardPayslips(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myGuardPayslips(u));
  }

  @Get('guard-pay/:id')
  guardPayRun(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.guardPayRun(u, id.slice(0, 120)));
  }

  @Post('guard-pay')
  prepareGuardPay(@UserId() uid: string, @Body() b: { companyId?: unknown; period?: unknown; holidays?: unknown }) {
    const holidays = b.holidays === undefined ? undefined : Array.isArray(b.holidays) ? b.holidays.slice(0, 11) : b.holidays;
    return this.db.asUser(uid, (svc, u) => svc.prepareGuardPay(u, str(b.companyId, 'companyId', 120), str(b.period, 'period', 7), holidays));
  }

  @Post('guard-pay/:id/lines/:personId')
  setGuardPayLine(@UserId() uid: string, @Param('id') id: string, @Param('personId') personId: string, @Body() b: Record<string, unknown>) {
    const pcb = b.pcb === undefined ? undefined : b.pcb === null ? null : Number(b.pcb);
    const extra = Array.isArray(b.extra)
      ? b.extra.slice(0, 6).map((a: Record<string, unknown>) => ({ label: String(a?.label ?? '').slice(0, 80), amount: Number(a?.amount), uniformNo: a?.uniformNo == null ? undefined : Number(a.uniformNo) }))
      : undefined;
    return this.db.asUser(uid, (svc, u) => svc.setGuardPayLine(u, id.slice(0, 120), personId.slice(0, 120), { pcb, extra }));
  }

  @Post('guard-pay/:id/files/:kind')
  guardPayExport(@UserId() uid: string, @Param('id') id: string, @Param('kind') kind: string) {
    const k = (['bank', 'ewallet', 'cash', 'sql', 'epf', 'socso', 'pcb'] as const).find((x) => x === kind);
    if (!k) throw new BadRequestException('unknown file');
    return this.db.asUser(uid, (svc, u) => svc.guardPayExport(u, id.slice(0, 120), k));
  }

  // Cash only when the COO or CEO gives it; the Director Office lists the guard (Fauzan, 6 Nov 2026).
  @Post('guard-pay/:id/cash/:personId/:action')
  guardPayCash(@UserId() uid: string, @Param('id') id: string, @Param('personId') personId: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['list', 'unlist', 'decide', 'handout', 'receipt'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown cash action');
    return this.db.asUser(uid, (svc, u) =>
      svc.guardPayCash(u, id.slice(0, 120), personId.slice(0, 120), a, {
        reason: b.reason == null ? '' : str(b.reason, 'reason', 300),
        give: b.give === true,
        on: b.on == null || b.on === '' ? undefined : date(b.on, 'on'),
        proof: a === 'receipt' ? proofList(b.proof) : undefined,
      }),
    );
  }

  @Post('guard-pay/:id/:action')
  guardPayStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['submit', 'approve', 'pay', 'return'] as const).find((x) => x === action);
    if (!a) throw new BadRequestException('unknown step');
    return this.db.asUser(uid, (svc, u) =>
      svc.guardPayStep(u, id.slice(0, 120), a, {
        note: b.note == null ? '' : str(b.note, 'note', 500),
        bankRef: b.bankRef == null ? undefined : str(b.bankRef, 'bankRef', 60),
        paidOn: b.paidOn == null ? undefined : date(b.paidOn, 'paidOn'),
        pcbChecked: b.pcbChecked === true,
      }),
    );
  }

  // ----- Staff payroll (Fauzan, 27 Oct 2026) -----
  @Get('staff-pay')
  staffPayroll(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffPayroll(u));
  }

  // Zakat by salary deduction, chosen by the staff member (Fauzan, 2 Nov 2026). Before 'staff-pay/:id'.
  @Get('staff-pay/my-zakat')
  myZakat(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myZakat(u));
  }

  @Post('staff-pay/my-zakat')
  setMyZakat(@UserId() uid: string, @Body() b: { body?: unknown; percent?: unknown }) {
    if (!b || typeof b !== 'object') throw new BadRequestException('Send the choice as an object');
    return this.db.asUser(uid, (svc, u) => svc.setMyZakat(u, { body: b.body == null ? null : str(b.body, 'body', 60), percent: b.percent }));
  }

  // EPF and PERKESO contribution tables kept row by row (Fauzan, 2 Nov 2026). Before 'staff-pay/:id'.
  @Get('staff-pay/stat-tables')
  statTables(@UserId() uid: string, @Query('period') period?: string) {
    return this.db.asUser(uid, (svc, u) => svc.statTables(u, typeof period === 'string' ? period.slice(0, 7) : undefined));
  }

  @Post('staff-pay/stat-tables')
  loadStatTable(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object') throw new BadRequestException('Send the table as an object');
    if (typeof b.rows !== 'string' || b.rows.length > 200_000) throw new BadRequestException('Paste the rows as text (at most 200,000 characters)');
    return this.db.asUser(uid, (svc, u) =>
      svc.loadStatTable(u, { id: str(b.id, 'id', 10), from: str(b.from, 'from', 7), source: str(b.source, 'source', 300), doc: str(b.doc, 'doc', 160), rows: b.rows, above: b.above }),
    );
  }

  @Post('staff-pay/stat-tables/check')
  checkStatTable(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.checkStatTable(u, { id: str(b.id, 'id', 10), version: str(b.version, 'version', 12), decision: str(b.decision, 'decision', 10), comment: str(b.comment, 'comment', 500) }),
    );
  }

  @Post('staff-pay/employer-nos/:companyId')
  setEmployerNos(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    const v = (x: unknown, k: string) => (x == null || x === '' ? null : str(x, k, 30));
    return this.db.asUser(uid, (svc, u) => svc.setEmployerNos(u, companyId.slice(0, 120), { epf: v(b.epf, 'epf'), socso: v(b.socso, 'socso'), lhdnE: v(b.lhdnE, 'lhdnE'), hrd: v(b.hrd, 'hrd') }));
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
      ? b.extra.slice(0, 10).map((a: Record<string, unknown>) => ({
          label: String(a?.label ?? '').slice(0, 60),
          amount: Number(a?.amount),
          typeId: typeof a?.typeId === 'string' && a.typeId ? a.typeId.slice(0, 100) : null,
        }))
      : undefined;
    const pp = b.partPay as Record<string, unknown> | null | undefined;
    const partPay =
      pp === undefined ? undefined : pp === null ? null : { basic: Number(pp.basic), allowances: Number(pp.allowances ?? 0), note: str(pp.note ?? '', 'note', 300) };
    return this.db.asUser(uid, (svc, u) => svc.setStaffPayLine(u, id.slice(0, 120), personId.slice(0, 120), { pcb, extra, partPay }));
  }

  @Post('staff-pay/:id/files/:kind')
  staffPayExport(@UserId() uid: string, @Param('id') id: string, @Param('kind') kind: string) {
    const k = (['bank', 'sql', 'epf', 'socso', 'pcb', 'zakat'] as const).find((x) => x === kind);
    if (!k) throw new BadRequestException('unknown file');
    return this.db.asUser(uid, (svc, u) => svc.staffPayExport(u, id.slice(0, 120), k));
  }

  @Post('staff-pay/:id/:action')
  staffPayStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['submit', 'approve', 'coo_approve', 'pay', 'return'] as const).find((x) => x === action);
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
        signalKey: b.signalKey ? str(b.signalKey, 'signalKey', 40) : null,
      }),
    );
  }

  @Post('act/findings/:id/:action')
  actFindingStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    const a = (['plan', 'fixed', 'check', 'follow_up', 'assign'] as const).find((x) => x === action);
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
        method: opt('method', 20),
        nextOn: b.nextOn == null || b.nextOn === '' ? undefined : date(b.nextOn, 'nextOn'),
        team: b.team == null ? undefined : Number(b.team),
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
        assignmentId: b.assignmentId ? str(b.assignmentId, 'assignmentId', 80) : null,
      }),
    );
  }

  /** The ACT Director sets a workflow's timing, step by step, after reviewing it (Fauzan, 2 Nov 2026). */
  @Post('act/timing')
  setActTiming(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const segs = Array.isArray(b.segments) ? (b.segments as Record<string, unknown>[]).slice(0, 20) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.setActTiming(u, {
        area: str(b.area ?? '', 'area', 20),
        auditMonths: Number(b.auditMonths),
        reviewId: str(b.reviewId ?? '', 'reviewId', 80),
        reason: str(b.reason ?? '', 'reason', 300),
        segments: segs.map((x) => ({
          step: str(x?.step ?? '', 'step', 120),
          target: Number(x?.target),
          unit: str(x?.unit ?? '', 'unit', 10),
          key: x?.key ? str(x.key, 'key', 60) : null,
        })),
      }),
    );
  }

  /** ACT records what it saw in the field at each step of a workflow, every 6 months (Fauzan, 2 Nov 2026). */
  @Post('act/field-checks')
  recordActFieldCheck(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const obs = Array.isArray(b.observed) ? (b.observed as Record<string, unknown>[]).slice(0, 20) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.recordActFieldCheck(u, {
        area: str(b.area ?? '', 'area', 20),
        doneOn: date(b.doneOn, 'doneOn'),
        where: str(b.where ?? '', 'where', 160),
        result: b.result === 'findings' ? 'findings' : 'clean',
        note: str(b.note ?? '', 'note', 500),
        observed: obs.map((x) => ({ step: str(x?.step ?? '', 'step', 120), actual: Number(x?.actual), unit: str(x?.unit ?? '', 'unit', 10), note: x?.note ? str(x.note, 'note', 200) : '' })),
      }),
    );
  }

  /** ACT investigations (masterplan item 241, Fauzan 3 Nov 2026): ACT only; the service checks job and team. */
  @Post('act/investigations')
  openActInvestigation(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.openActInvestigation(u, {
        title: str(b.title ?? '', 'title', 160),
        note: str(b.note ?? '', 'note', 1000),
        team: b.team === 1 || b.team === 2 ? b.team : null,
        anomalyKey: b.anomalyKey ? str(b.anomalyKey, 'anomalyKey', 200) : null,
        findingId: b.findingId ? str(b.findingId, 'findingId', 80) : null,
      }),
    );
  }

  @Post('act/investigations/:id/evidence')
  addActEvidence(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.data !== 'string' || b.data.length > 2_100_000) throw new BadRequestException('Attach the file (at most 1.5 MB).');
    const data = b.data;
    return this.db.asUser(uid, (svc, u) => svc.addActEvidence(u, id, { name: str(b.name ?? '', 'name', 120), source: str(b.source ?? '', 'source', 300), data }));
  }

  @Get('act/investigations/:id/evidence/:eid')
  actEvidence(@UserId() uid: string, @Param('id') id: string, @Param('eid') eid: string) {
    return this.db.asUser(uid, (svc, u) => svc.actEvidence(u, id, eid));
  }

  @Post('act/investigations/:id/:action')
  actInvestigationStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    if (action !== 'note' && action !== 'assign' && action !== 'close') throw new BadRequestException('Unknown step.');
    const outcome = b.outcome === 'substantiated' || b.outcome === 'not_substantiated' || b.outcome === 'referred' ? b.outcome : undefined;
    return this.db.asUser(uid, (svc, u) =>
      svc.actInvestigationStep(u, id, {
        action,
        text: b.text ? str(b.text, 'text', 1500) : '',
        team: b.team === 1 || b.team === 2 ? b.team : undefined,
        outcome,
        referredTo: b.referredTo ? str(b.referredTo, 'referredTo', 120) : null,
      }),
    );
  }

  /** The ACT Director sets what a department's monthly report must cover (Fauzan, 2 Nov 2026). */
  @Post('act/report-form')
  setActReportForm(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const list = (k: string, n: number) => (Array.isArray(b[k]) ? (b[k] as unknown[]).slice(0, n).map((x) => str(x, k, 160)) : []);
    return this.db.asUser(uid, (svc, u) =>
      svc.setActReportForm(u, { department: str(b.department ?? '', 'department', 40), sections: list('sections', 20), checks: list('checks', 12), note: str(b.note ?? '', 'note', 300) }),
    );
  }

  /** The ACT Director gives a workflow audit or a monthly report review to a team (Fauzan, 2 Nov 2026). */
  @Post('act/work')
  assignActWork(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.assignActWork(u, {
        kind: b.kind === 'report_review' ? 'report_review' : 'workflow',
        team: Number(b.team),
        area: b.area == null ? undefined : str(b.area, 'area', 20),
        companyId: b.companyId ? str(b.companyId, 'companyId', 40) : null,
        defId: b.defId ? str(b.defId, 'defId', 60) : null,
        period: b.period ? str(b.period, 'period', 7) : null,
        dueOn: b.dueOn ? date(b.dueOn, 'dueOn') : null,
        note: b.note == null ? undefined : str(b.note, 'note', 300),
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

  // ----- Allowances: HR keeps the list and sets each staff member's monthly allowances (Fauzan, 3 Nov 2026) -----
  @Get('hr/allowances')
  allowanceTypes(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.allowanceTypes(u));
  }

  @Post('hr/allowances/types')
  saveAllowanceType(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const money = (k: string) => (b[k] == null || b[k] === '' ? null : Number(b[k]));
    const flag = (k: string) => {
      if (typeof b[k] !== 'boolean') throw new BadRequestException(`${k} must be true or false`);
      return b[k] as boolean;
    };
    const frequency = (['monthly', 'one_off', 'both'] as const).find((x) => x === b.frequency);
    if (!frequency) throw new BadRequestException('frequency must be monthly, one_off or both');
    return this.db.asUser(uid, (svc, u) =>
      svc.saveAllowanceType(u, {
        id: typeof b.id === 'string' && b.id ? b.id.slice(0, 100) : null,
        name: str(b.name, 'name', 60),
        frequency,
        usualAmount: money('usualAmount'),
        cap: money('cap'),
        epf: flag('epf'),
        socso: flag('socso'),
        pcb: flag('pcb'),
        hrd: flag('hrd'),
        active: flag('active'),
        basis: str(b.basis, 'basis', 300),
        note: b.note == null ? '' : str(b.note, 'note', 300),
      }),
    );
  }

  @Post('hr/allowances/staff/:personId')
  requestAllowanceChange(@UserId() uid: string, @Param('personId') personId: string, @Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.allowances) || b.allowances.length > 20) throw new BadRequestException('allowances must be a list of up to 20');
    const allowances = b.allowances.map((a: Record<string, unknown>) => ({ typeId: str(a?.typeId, 'typeId', 100), amount: Number(a?.amount) }));
    return this.db.asUser(uid, (svc, u) =>
      svc.requestAllowanceChange(u, personId.slice(0, 120), { allowances, effectiveOn: date(b.effectiveOn, 'effectiveOn'), reason: str(b.reason, 'reason', 500) }),
    );
  }

  // ----- Pay formulas: ACT sets the guard salary and driver overtime formulas and where each is used (Fauzan, 5 Nov 2026) -----
  @Get('pay-formulas')
  payFormulaBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.payFormulaBoard(u));
  }

  @Get('salary-calc')
  salaryCalcData(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.salaryCalcData(u));
  }

  @Get('pay-formulas/at')
  payFormulaAt(@UserId() uid: string, @Query('kind') kind?: string, @Query('siteId') siteId?: string, @Query('companyId') companyId?: string, @Query('regionId') regionId?: string, @Query('month') month?: string) {
    const k = (['guard_shift', 'driver_ot', 'staff_ot'] as const).find((x) => x === kind);
    if (!k) throw new BadRequestException('kind must be guard_shift, driver_ot or staff_ot');
    const id = (v?: string) => (v ? v.slice(0, 80) : null);
    return this.db.asUser(uid, (svc, u) => svc.payFormulaAt(u, { kind: k, siteId: id(siteId), companyId: id(companyId), regionId: id(regionId), month: month?.slice(0, 7) }));
  }

  @Post('pay-formulas')
  savePayFormula(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['guard_shift', 'driver_ot', 'staff_ot'] as const).find((x) => x === b.kind);
    if (!kind) throw new BadRequestException('kind must be guard_shift, driver_ot or staff_ot');
    if (b.amounts == null || typeof b.amounts !== 'object' || Array.isArray(b.amounts)) throw new BadRequestException('amounts is missing');
    return this.db.asUser(uid, (svc, u) =>
      svc.savePayFormula(u, {
        code: b.code == null || b.code === '' ? null : str(b.code, 'code', 30),
        kind,
        name: str(b.name, 'name', 100),
        effectiveFrom: str(b.effectiveFrom, 'effectiveFrom', 7),
        amounts: b.amounts,
        reason: str(b.reason, 'reason', 500),
      }),
    );
  }

  @Post('pay-formulas/:id/decide')
  decidePayFormula(@UserId() uid: string, @Param('id') id: string, @Body() b: { approve?: unknown; note?: unknown }) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    const approve = b.approve;
    return this.db.asUser(uid, (svc, u) => svc.decidePayFormula(u, id.slice(0, 80), approve, str(b.note, 'note', 500)));
  }

  @Post('pay-formulas/:id/withdraw')
  withdrawPayFormula(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.withdrawPayFormula(u, id.slice(0, 80)));
  }

  @Post('pay-law')
  savePayLaw(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (b.settings == null || typeof b.settings !== 'object' || Array.isArray(b.settings)) throw new BadRequestException('settings is missing');
    const settings = b.settings as Record<string, unknown>;
    return this.db.asUser(uid, (svc, u) => svc.savePayLaw(u, { effectiveFrom: str(b.effectiveFrom, 'effectiveFrom', 7), settings, reason: str(b.reason, 'reason', 500) }));
  }

  @Post('pay-formula-uses')
  setPayFormulaUse(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['guard_shift', 'driver_ot', 'staff_ot'] as const).find((x) => x === b.kind);
    const scope = (['group', 'region', 'company', 'site'] as const).find((x) => x === b.scope);
    if (!kind || !scope) throw new BadRequestException('kind and scope are required');
    return this.db.asUser(uid, (svc, u) =>
      svc.setPayFormulaUse(u, {
        kind,
        scope,
        scopeId: b.scopeId == null || b.scopeId === '' ? null : str(b.scopeId, 'scopeId', 80),
        formulaCode: b.formulaCode == null || b.formulaCode === '' ? null : str(b.formulaCode, 'formulaCode', 30),
        effectiveFrom: str(b.effectiveFrom, 'effectiveFrom', 7),
        reason: str(b.reason, 'reason', 500),
      }),
    );
  }

  // ----- Site man-hours: allowed hours per site per month, OD/OGM approve hours over it (Fauzan, 6 Nov 2026) -----
  @Get('site-hours')
  siteHoursBoard(@UserId() uid: string, @Query('companyId') companyId?: string, @Query('month') month?: string) {
    return this.db.asUser(uid, (svc, u) => svc.siteHoursBoard(u, { companyId: companyId ? companyId.slice(0, 80) : null, month: month ? month.slice(0, 7) : null }));
  }

  @Post('site-hours/approve')
  approveSiteHours(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const cause = (['training', 'annual_leave', 'on_job_training', 'client_extra', 'other'] as const).find((x) => x === b.cause);
    if (!cause) throw new BadRequestException('cause must be training, annual_leave, on_job_training, client_extra or other');
    const extraHours = Number(b.extraHours);
    if (!Number.isFinite(extraHours)) throw new BadRequestException('extraHours must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.approveSiteHours(u, { siteId: str(b.siteId, 'siteId', 80), month: str(b.month, 'month', 7), extraHours, cause, reason: str(b.reason, 'reason', 500) }),
    );
  }

  // ----- Public holidays: the OM or OGM sets each company's 11 days for a year (Fauzan, 6 Nov 2026) -----
  @Get('public-holidays')
  publicHolidayBoard(@UserId() uid: string, @Query('companyId') companyId?: string, @Query('year') year?: string) {
    return this.db.asUser(uid, (svc, u) => svc.publicHolidayBoard(u, { companyId: companyId ? companyId.slice(0, 80) : null, year: year ? Number(year.slice(0, 4)) : null }));
  }

  @Post('public-holidays')
  setPublicHolidays(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.days) || b.days.length > 20) throw new BadRequestException('days must be a list of up to 20 holidays');
    const days = b.days.map((d: unknown) => {
      const x = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
      return { date: str(x.date, 'date', 10), label: str(x.label, 'label', 80) };
    });
    return this.db.asUser(uid, (svc, u) =>
      svc.setPublicHolidays(u, {
        companyId: str(b.companyId, 'companyId', 80),
        year: Number(b.year),
        state: b.state == null || b.state === '' ? null : str(b.state, 'state', 40),
        days,
        reason: str(b.reason, 'reason', 500),
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

  // ----- Company office (Fauzan, 2 Nov 2026): 1 Company Manager or GM and 2 to 8 executives per company -----
  @Get('offices')
  companyOffices(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.companyOffices(u));
  }

  @Get('companies/:id/office')
  companyOffice(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.companyOffice(u, id));
  }

  @Post('companies/:id/office/desks')
  setOfficeDesks(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.desks) || b.desks.length < 1 || b.desks.length > 12) throw new BadRequestException('desks must be a list of 1 to 12 desks');
    const optId = (v: unknown, name: string) => (v === undefined || v === null || v === '' ? null : str(v, name, 80));
    const desks = b.desks.map((d: unknown) => {
      const r = (d ?? {}) as Record<string, unknown>;
      return { desk: str(r.desk, 'desk', 40), ownerUserId: optId(r.ownerUserId, 'ownerUserId'), backupUserId: optId(r.backupUserId, 'backupUserId') };
    });
    const note = b.note === undefined || b.note === null ? '' : str(b.note, 'note', 300);
    return this.db.asUser(uid, (svc, u) => svc.setOfficeDesks(u, id, { desks, note }));
  }

  /** CEO only: which licensed company's office runs this company (Fauzan, 3 Nov 2026). Reason required, audited. */
  @Post('companies/:id/office/run-by')
  setCompanyRunBy(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const runByCompanyId = b.runByCompanyId === undefined || b.runByCompanyId === null || b.runByCompanyId === '' ? null : str(b.runByCompanyId, 'runByCompanyId', 80);
    const reason = str(b.reason, 'reason', 300);
    return this.db.asUser(uid, (svc, u) => svc.setCompanyRunBy(u, id, { runByCompanyId, reason }));
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
  addClientAccount(@UserId() uid: string, @Body() b: { companyId?: unknown; name?: unknown; siteIds?: unknown; contractEndsOn?: unknown; leadId?: unknown }) {
    const sites = Array.isArray(b.siteIds) ? (b.siteIds as unknown[]).slice(0, 50).map((x) => String(x).slice(0, 120)) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.addClientAccount(u, {
        companyId: str(b.companyId, 'companyId', 120),
        name: str(b.name, 'name', 120),
        siteIds: sites,
        contractEndsOn: b.contractEndsOn == null || b.contractEndsOn === '' ? null : date(b.contractEndsOn, 'contractEndsOn'),
        leadId: b.leadId == null || b.leadId === '' ? null : str(b.leadId, 'leadId', 120),
      }),
    );
  }

  @Post('clients/:id/offboard')
  startOffboarding(@UserId() uid: string, @Param('id') id: string, @Body() b: { reason?: unknown; lostReason?: unknown; winBackOn?: unknown }) {
    const lostReason = b.lostReason == null ? null : (Object.keys(CLIENT_LOST_REASON) as ClientLostReason[]).find((k) => k === b.lostReason);
    if (b.lostReason != null && !lostReason) throw new BadRequestException('lostReason is not valid');
    const winBackOn = b.winBackOn == null || b.winBackOn === '' ? null : date(b.winBackOn, 'winBackOn');
    return this.db.asUser(uid, (svc, u) => svc.startOffboarding(u, id.slice(0, 120), str(b.reason, 'reason', 300), lostReason ? { reason: lostReason, winBackOn } : undefined));
  }

  // ----- Client CRM (Fauzan, 4 Nov 2026: "We want complete") -----
  @Get('crm')
  crmBoard(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.crmBoard(u));
  }

  @Get('crm/clients/:id')
  crmClient(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.crmClient(u, id.slice(0, 120)));
  }

  @Post('crm/clients/:id/owner')
  setClientOwner(@UserId() uid: string, @Param('id') id: string, @Body() b: { userId?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.setClientOwner(u, id.slice(0, 120), str(b.userId, 'userId', 80)));
  }

  @Post('crm/clients/:id/people')
  addClientPerson(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const role = (Object.keys(CLIENT_PERSON_ROLE) as ClientPersonRole[]).find((k) => k === b.role);
    if (!role) throw new BadRequestException('role is not valid');
    return this.db.asUser(uid, (svc, u) =>
      svc.addClientPerson(u, id.slice(0, 120), {
        name: str(b.name, 'name', 120),
        position: str(b.position, 'position', 80),
        role,
        phone: b.phone == null ? '' : str(b.phone, 'phone', 24),
        email: b.email == null ? '' : str(b.email, 'email', 120),
        main: b.main === true,
      }),
    );
  }

  @Post('crm/clients/:id/people/:personId')
  updateClientPerson(@UserId() uid: string, @Param('id') id: string, @Param('personId') personId: string, @Body() b: { action?: unknown }) {
    if (b.action !== 'remove' && b.action !== 'main') throw new BadRequestException('action must be remove or main');
    const action = b.action;
    return this.db.asUser(uid, (svc, u) => svc.updateClientPerson(u, id.slice(0, 120), personId.slice(0, 80), action));
  }

  @Post('crm/clients/:id/requests')
  addClientRequest(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const kind = (Object.keys(CLIENT_REQUEST_KIND) as ClientRequestKind[]).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('kind is not valid');
    return this.db.asUser(uid, (svc, u) =>
      svc.addClientRequest(u, id.slice(0, 120), {
        kind,
        what: str(b.what, 'what', 500),
        from: str(b.from, 'from', 120),
        neededBy: b.neededBy == null || b.neededBy === '' ? null : date(b.neededBy, 'neededBy'),
      }),
    );
  }

  @Post('crm/clients/:id/requests/:requestId')
  closeClientRequest(@UserId() uid: string, @Param('id') id: string, @Param('requestId') requestId: string, @Body() b: Record<string, unknown>) {
    if (b.status !== 'done' && b.status !== 'declined') throw new BadRequestException('status must be done or declined');
    const status = b.status;
    return this.db.asUser(uid, (svc, u) =>
      svc.closeClientRequest(u, id.slice(0, 120), requestId.slice(0, 80), {
        status,
        outcome: str(b.outcome, 'outcome', 500),
        variationRef: b.variationRef == null || b.variationRef === '' ? null : str(b.variationRef, 'variationRef', 60),
      }),
    );
  }

  @Post('crm/clients/:id/renewal/decide')
  decideClientRenewal(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const choice = (Object.keys(CLIENT_RENEWAL_DECISION) as ClientRenewalDecision[]).find((k) => k === b.choice);
    if (!choice) throw new BadRequestException('choice is not valid');
    if (b.pricePct != null && typeof b.pricePct !== 'number') throw new BadRequestException('pricePct must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.decideClientRenewal(u, id.slice(0, 120), { choice, pricePct: (b.pricePct as number | undefined) ?? 0, reason: str(b.reason, 'reason', 500) }),
    );
  }

  @Post('crm/clients/:id/renewal/offer')
  sendClientRenewalOffer(@UserId() uid: string, @Param('id') id: string, @Body() b: { proof?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.sendClientRenewalOffer(u, id.slice(0, 120), proofList(b.proof)));
  }

  @Post('crm/clients/:id/renewal/answer')
  answerClientRenewal(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const choice = (Object.keys(CLIENT_RENEWAL_ANSWER) as ClientRenewalAnswer[]).find((k) => k === b.choice);
    if (!choice) throw new BadRequestException('choice is not valid');
    return this.db.asUser(uid, (svc, u) =>
      svc.answerClientRenewal(u, id.slice(0, 120), {
        choice,
        note: b.note == null ? '' : str(b.note, 'note', 500),
        newEndsOn: b.newEndsOn == null || b.newEndsOn === '' ? null : date(b.newEndsOn, 'newEndsOn'),
        proof: b.proof == null ? [] : proofList(b.proof),
      }),
    );
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
  clientRating(
    @UserId() uid: string,
    @Param('id') id: string,
    @Body() b: { score?: unknown; comment?: unknown; from?: unknown; via?: unknown; proof?: unknown },
  ) {
    if (typeof b.score !== 'number') throw new BadRequestException('score must be a number');
    const via = CLIENT_VIA.find((v) => v === b.via);
    if (!via) throw new BadRequestException(`via must be one of ${CLIENT_VIA.join(', ')}`);
    return this.db.asUser(uid, (svc, u) =>
      svc.clientRating(u, id.slice(0, 120), b.score as number, b.comment == null ? '' : str(b.comment, 'comment', 500), {
        from: str(b.from, 'from', 120),
        via,
        proof: b.proof == null ? [] : proofList(b.proof),
      }),
    );
  }

  // Client complaints, open until what was done is recorded (Fauzan, 2 Nov 2026: client satisfaction monitored).
  @Post('clients/:id/complaints')
  clientComplaint(
    @UserId() uid: string,
    @Param('id') id: string,
    @Body() b: { from?: unknown; via?: unknown; what?: unknown; siteId?: unknown; proof?: unknown },
  ) {
    const via = CLIENT_VIA.find((v) => v === b.via);
    if (!via) throw new BadRequestException(`via must be one of ${CLIENT_VIA.join(', ')}`);
    return this.db.asUser(uid, (svc, u) =>
      svc.clientComplaint(u, id.slice(0, 120), {
        from: str(b.from, 'from', 120),
        via,
        what: str(b.what, 'what', 500),
        siteId: b.siteId == null ? null : str(b.siteId, 'siteId', 120),
        proof: b.proof == null ? [] : proofList(b.proof),
      }),
    );
  }

  @Post('clients/:id/complaints/:complaintId/resolve')
  resolveClientComplaint(
    @UserId() uid: string,
    @Param('id') id: string,
    @Param('complaintId') complaintId: string,
    @Body() b: { resolution?: unknown; proof?: unknown },
  ) {
    return this.db.asUser(uid, (svc, u) =>
      svc.resolveClientComplaint(u, id.slice(0, 120), complaintId.slice(0, 80), str(b.resolution, 'resolution', 500), b.proof == null ? [] : proofList(b.proof)),
    );
  }

  @Post('clients/:id/invoice')
  clientInvoice(@UserId() uid: string, @Param('id') id: string, @Body() b: { period?: unknown; channel?: unknown; amount?: unknown; proof?: unknown }) {
    const channel = (['hand', 'email', 'portal'] as const).find((c) => c === b.channel);
    if (!channel) throw new BadRequestException('channel must be hand, email or portal');
    const amount = typeof b.amount === 'number' ? b.amount : null;
    return this.db.asUser(uid, (svc, u) => svc.clientInvoice(u, id.slice(0, 120), str(b.period, 'period', 7), channel, amount, proofList(b.proof)));
  }

  // ----- Client report links (Fauzan, 3 Nov 2026: "Shared report links first") -----
  @Get('clients/:id/share-links')
  clientShareLinks(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, async (svc, u) => {
      const out = await svc.clientShareLinks(u, id.slice(0, 120));
      return { ...out, linksOn: shareSecret() !== null && shareBase() !== null };
    });
  }

  @Post('clients/:id/share-links')
  createClientShareLink(@UserId() uid: string, @Param('id') id: string, @Body() b: { recipient?: unknown; from?: unknown; to?: unknown; days?: unknown }) {
    const secret = shareSecret();
    const base = shareBase();
    if (secret === null || base === null) throw new ServiceUnavailableException('Client report links are switched off on this server.');
    if (typeof b.days !== 'number') throw new BadRequestException('days must be a number');
    return this.db.asUser(uid, async (svc, u) => {
      const r = await svc.createClientShareLink(u, id.slice(0, 120), { recipient: str(b.recipient, 'recipient', 120), from: date(b.from, 'from'), to: date(b.to, 'to'), days: b.days as number });
      return { link: r.link, url: `${base}/api/share/${signShare({ c: r.companyId, k: r.clientId, l: r.link.id }, secret)}` };
    });
  }

  @Post('clients/:id/share-links/:linkId/revoke')
  revokeClientShareLink(@UserId() uid: string, @Param('id') id: string, @Param('linkId') linkId: string, @Body() b: { reason?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.revokeClientShareLink(u, id.slice(0, 120), linkId.slice(0, 120), str(b.reason, 'reason', 300)));
  }

  @Get('clients/:id/share-links/:linkId/preview')
  previewClientShareLink(@UserId() uid: string, @Param('id') id: string, @Param('linkId') linkId: string) {
    return this.db.asUser(uid, (svc, u) => svc.clientShareReport(null, id.slice(0, 120), linkId.slice(0, 120), u));
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

  // Central Admin 5F: start this month's rent or utilities request from the last approved one (a draft; nothing is sent).
  @Post('expenses/prefill')
  prefillOfficeRequest(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const category = (['RENT', 'UTILITIES'] as const).find((c) => c === b.category);
    if (!category) throw new BadRequestException('Rent or utilities.');
    return this.db.asUser(uid, (svc, u) =>
      svc.prefillOfficeRequest(u, { companyId: str(b.companyId, 'companyId', 60), category, period: b.period == null ? undefined : str(b.period, 'period', 7) }),
    );
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

  // Face recognition for clock in (Fauzan, 2 Nov 2026; free engine on the phone).
  @Get('me/face')
  myFace(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.myFace(u));
  }

  @Post('me/face')
  registerFace(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const d = descriptor(b.descriptor);
    if (!d) throw new BadRequestException('descriptor is needed');
    return this.db.asUser(uid, (svc, u) => svc.registerFace(u, { photo: str(b.photo, 'photo', 2_500_000), descriptor: d }));
  }

  @Post('me/clock/face')
  staffFaceCheck(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.staffFaceCheck(u, staffShot(b)));
  }

  @Get('hr/faces')
  faceReviews(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.faceReviews(u));
  }

  @Post('hr/faces/:personId/decide')
  decideFace(@UserId() uid: string, @Param('personId') personId: string, @Body() b: { approve?: unknown; note?: unknown }) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.decideFace(u, personId.slice(0, 80), b.approve as boolean, b.note == null ? '' : str(b.note, 'note', 500)));
  }

  @Post('hr/faces/:personId/remove')
  removeFace(@UserId() uid: string, @Param('personId') personId: string, @Body() b: { note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.removeFace(u, personId.slice(0, 80), b.note == null ? '' : str(b.note, 'note', 500)));
  }

  // HR Phase 3, slice 3C (Fauzan, 2 Nov 2026): public holidays, leave days above the Act, working from home, flexible work.
  @Get('hr/holidays')
  publicHolidays(@UserId() uid: string, @Query('year') year?: string) {
    return this.db.asUser(uid, (svc, u) => svc.publicHolidays(u, year ? str(year, 'year', 4) : undefined));
  }

  @Post('hr/holidays')
  addPublicHoliday(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const states = b.states == null ? null : Array.isArray(b.states) ? b.states.slice(0, 20).map((x) => str(x, 'states', 40)) : null;
    if (b.states != null && !Array.isArray(b.states)) throw new BadRequestException('states must be a list or null');
    return this.db.asUser(uid, (svc, u) =>
      svc.addPublicHoliday(u, {
        date: date(b.date, 'date'),
        name: str(b.name, 'name', 80),
        states,
        compulsory: b.compulsory == null ? null : (str(b.compulsory, 'compulsory', 20) as never),
        note: b.note == null ? '' : str(b.note, 'note', 300),
      }),
    );
  }

  @Post('hr/holidays/:id/remove')
  removePublicHoliday(@UserId() uid: string, @Param('id') id: string, @Body() b: { note?: unknown }) {
    return this.db.asUser(uid, (svc, u) => svc.removePublicHoliday(u, id.slice(0, 80), b.note == null ? '' : str(b.note, 'note', 500)));
  }

  @Get('hr/leave-settings')
  hrLeaveSettings(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.hrLeaveSettings(u));
  }

  @Post('hr/people/:personId/leave-days')
  setLeaveOverride(@UserId() uid: string, @Param('personId') personId: string, @Body() b: Record<string, unknown>) {
    if (b.days !== null && typeof b.days !== 'number') throw new BadRequestException('days must be a number or null');
    return this.db.asUser(uid, (svc, u) =>
      svc.setLeaveOverride(u, personId.slice(0, 80), str(b.kind, 'kind', 20) as never, b.days as number | null, b.note == null ? '' : str(b.note, 'note', 500)),
    );
  }

  @Post('hr/people/:personId/wfh')
  setWfhAllowed(@UserId() uid: string, @Param('personId') personId: string, @Body() b: { allow?: unknown; note?: unknown }) {
    if (typeof b.allow !== 'boolean') throw new BadRequestException('allow must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.setWfhAllowed(u, personId.slice(0, 80), b.allow as boolean, b.note == null ? '' : str(b.note, 'note', 500)));
  }

  @Get('flex')
  flexRequests(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.flexRequests(u));
  }

  @Post('flex')
  requestFlex(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.requestFlex(u, {
        kind: str(b.kind, 'kind', 10) as never,
        detail: str(b.detail, 'detail', 300),
        reason: str(b.reason, 'reason', 500),
        from: date(b.from, 'from'),
        to: b.to == null ? null : date(b.to, 'to'),
      }),
    );
  }

  @Post('flex/:id/decide')
  decideFlex(@UserId() uid: string, @Param('id') id: string, @Body() b: { approve?: unknown; note?: unknown }) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.decideFlex(u, id.slice(0, 80), b.approve as boolean, b.note == null ? '' : str(b.note, 'note', 1000)));
  }

  // HR Phase 3, slice 3B (Fauzan, 2 Nov 2026): joining and leaving, statutory filings, vacancies.
  @Get('hr/join-leave')
  hrJoinLeave(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.hrJoinLeave(u));
  }

  @Post('hr/filings')
  recordHrFiling(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.recordHrFiling(u, {
        kind: str(b.kind, 'kind', 20) as never,
        companyId: str(b.companyId, 'companyId', 80),
        personId: b.personId == null ? null : str(b.personId, 'personId', 80),
        period: str(b.period, 'period', 20),
        ref: str(b.ref, 'ref', 80),
        filedOn: date(b.filedOn, 'filedOn'),
      }),
    );
  }

  @Get('hr/ea')
  eaDraft(@UserId() uid: string, @Query('companyId') companyId: string, @Query('year') year: string) {
    return this.db.asUser(uid, (svc, u) => svc.eaDraft(u, str(companyId, 'companyId', 80), str(year, 'year', 4)));
  }

  @Get('hr/register')
  employeeRegister(@UserId() uid: string, @Query('companyId') companyId: string) {
    return this.db.asUser(uid, (svc, u) => svc.employeeRegister(u, str(companyId, 'companyId', 80)));
  }

  @Post('hr/people/:personId/probation')
  decideProbation(@UserId() uid: string, @Param('personId') personId: string, @Body() b: Record<string, unknown>) {
    const decision = str(b.decision, 'decision', 10);
    if (decision !== 'confirm' && decision !== 'extend') throw new BadRequestException('decision must be confirm or extend');
    return this.db.asUser(uid, (svc, u) =>
      svc.decideProbation(u, personId.slice(0, 80), decision, b.newEndsOn == null ? null : date(b.newEndsOn, 'newEndsOn'), b.note == null ? '' : str(b.note, 'note', 500)),
    );
  }

  @Get('hr/people/:personId/leaving-guide')
  leavingGuide(@UserId() uid: string, @Param('personId') personId: string) {
    return this.db.asUser(uid, (svc, u) => svc.leavingGuide(u, personId.slice(0, 80)));
  }

  // Staff movement (Fauzan, 3 Nov 2026): promotion, transfer to another group company, secondment.
  @Get('hr/movements')
  staffMovements(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffMovements(u));
  }

  @Post('hr/movements')
  prepareStaffMovement(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = b.kind;
    if (kind !== 'promotion' && kind !== 'transfer' && kind !== 'secondment') throw new BadRequestException('kind is not valid');
    const opt = (v: unknown, n: string, max: number) => (v == null || v === '' ? null : str(v, n, max));
    if (b.basicPay != null && typeof b.basicPay !== 'number') throw new BadRequestException('basicPay must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.prepareStaffMovement(u, {
        personId: str(b.personId, 'personId', 100),
        kind,
        toCompanyId: opt(b.toCompanyId, 'toCompanyId', 80),
        effectiveOn: str(b.effectiveOn, 'effectiveOn', 10),
        reason: str(b.reason, 'reason', 500),
        jobTitle: opt(b.jobTitle, 'jobTitle', 80),
        department: opt(b.department, 'department', 60),
        reportsTo: opt(b.reportsTo, 'reportsTo', 80),
        basicPay: (b.basicPay as number | null | undefined) ?? null,
        branchId: opt(b.branchId, 'branchId', 80),
        staffNo: opt(b.staffNo, 'staffNo', 20),
        until: opt(b.until, 'until', 10),
      }),
    );
  }

  @Post('hr/movements/:id/step')
  staffMovementStep(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.staffMovementStep(u, id.slice(0, 120), b.approve as boolean, str(b.note ?? '', 'note', 500)));
  }

  /** Apply approved movements whose date has come (HR or the CEO); each applies once, failures are kept for a retry. */
  @Post('hr/movements/apply-due')
  applyDueStaffMovements(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.applyDueStaffMovements(u));
  }

  /** Login handovers after a transfer: no pay or reasons (IT, HR, the HR Director and the CEO). */
  @Get('login-handovers')
  loginHandovers(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.loginHandovers(u));
  }

  @Post('hr/movements/:id/login/authorise')
  authoriseMovementLogin(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.approve !== 'boolean') throw new BadRequestException('approve must be true or false');
    return this.db.asUser(uid, (svc, u) => svc.authoriseMovementLogin(u, id.slice(0, 120), b.approve as boolean, str(b.note ?? '', 'note', 300)));
  }

  @Post('hr/movements/:id/login/confirm')
  confirmMovementLogin(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.confirmMovementLogin(u, id.slice(0, 120), str(b.note ?? '', 'note', 300)));
  }

  @Post('hr/movements/:id/apply')
  applyStaffMovement(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.applyStaffMovement(u, id.slice(0, 120)));
  }

  @Post('hr/movements/:id/cancel')
  cancelStaffMovement(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.cancelStaffMovement(u, id.slice(0, 120), str(b.note ?? '', 'note', 500)));
  }

  @Get('vacancies')
  vacancies(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.vacancies(u));
  }

  @Post('vacancies')
  raiseVacancy(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const num = (v: unknown, n: string) => {
      if (v == null) return null;
      if (typeof v !== 'number') throw new BadRequestException(`${n} must be a number`);
      return v;
    };
    if (typeof b.headcount !== 'number') throw new BadRequestException('headcount must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.raiseVacancy(u, {
        companyId: str(b.companyId, 'companyId', 80),
        title: str(b.title, 'title', 80),
        department: b.department == null ? '' : str(b.department, 'department', 60),
        headcount: b.headcount as number,
        reason: str(b.reason, 'reason', 500),
        payFrom: num(b.payFrom, 'payFrom'),
        payTo: num(b.payTo, 'payTo'),
        category: b.category == null ? undefined : (str(b.category, 'category', 10) as never),
        state: b.state == null ? null : str(b.state, 'state', 40),
      }),
    );
  }

  // Applicants for a vacancy (Fauzan, 5 Nov 2026): HR only, behind the applicants wall.
  @Get('vacancies/:id/applicants')
  applicants(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.applicants(u, id.slice(0, 80)));
  }

  @Post('vacancies/:id/applicants')
  addApplicant(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addApplicant(u, id.slice(0, 80), {
        name: str(b.name, 'name', 80),
        phone: b.phone == null ? '' : str(b.phone, 'phone', 20),
        email: b.email == null ? '' : str(b.email, 'email', 120),
        source: str(b.source, 'source', 20) as never,
        appliedOn: str(b.appliedOn, 'appliedOn', 10),
      }),
    );
  }

  @Post('applicants/:id/:status')
  applicantStep(@UserId() uid: string, @Param('id') id: string, @Param('status') status: string, @Body() b: Record<string, unknown>) {
    if (!['shortlisted', 'interview', 'offered', 'hired', 'rejected', 'withdrawn'].includes(status)) throw new BadRequestException('Unknown step');
    return this.db.asUser(uid, (svc, u) =>
      svc.applicantStep(u, id.slice(0, 120), status as never, b.note == null ? '' : str(b.note, 'note', 300), b.interviewAt == null ? null : str(b.interviewAt, 'interviewAt', 40)),
    );
  }

  // Job posts for open vacancies (rule HR-JOB-ADVERT, Fauzan 5 Nov 2026). Social publishing is switched off.
  @Post('vacancies/:id/advert/:action')
  advertStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: Record<string, unknown>) {
    if (!['draft', 'submit', 'approve', 'return', 'record_posted', 'withdraw'].includes(action)) throw new BadRequestException('Unknown step');
    const opt = (v: unknown, n: string, max: number) => (v == null ? undefined : str(v, n, max));
    if (b.version != null && (typeof b.version !== 'number' || !Number.isInteger(b.version))) throw new BadRequestException('version must be a whole number');
    if (b.channels != null && (!Array.isArray(b.channels) || b.channels.length > 10 || b.channels.some((c) => typeof c !== 'string' || c.length > 20))) {
      throw new BadRequestException('channels must be a list of channel names');
    }
    return this.db.asUser(uid, (svc, u) =>
      svc.advertStep(u, id.slice(0, 80), action as never, {
        text: opt(b.text, 'text', 3000),
        channels: b.channels as string[] | undefined,
        applyHow: opt(b.applyHow, 'applyHow', 200),
        closingDate: b.closingDate == null ? null : str(b.closingDate, 'closingDate', 10),
        note: opt(b.note, 'note', 500),
        channel: opt(b.channel, 'channel', 20),
        link: opt(b.link, 'link', 300),
        where: opt(b.where, 'where', 120),
        version: b.version as number | undefined,
      }),
    );
  }

  @Post('vacancies/:id/:action')
  vacancyStep(@UserId() uid: string, @Param('id') id: string, @Param('action') action: string, @Body() b: { note?: unknown }) {
    if (!['ceo_approve', 'ceo_refuse', 'sign', 'close'].includes(action)) throw new BadRequestException('Unknown step');
    return this.db.asUser(uid, (svc, u) => svc.vacancyStep(u, id.slice(0, 80), action as never, b.note == null ? '' : str(b.note, 'note', 500)));
  }

  // HR Phase 3, slice 3E (Fauzan, 2 Nov 2026): each staff member's HR file, discipline and sexual harassment inquiry.
  @Get('hr/cases')
  hrCases(@UserId() uid: string, @Query('personId') personId?: string) {
    return this.db.asUser(uid, (svc, u) => svc.hrCases(u, personId ? str(personId, 'personId', 80) : undefined));
  }

  @Post('hr/cases')
  openHrCase(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.openHrCase(u, {
        personId: str(b.personId, 'personId', 80),
        kind: str(b.kind, 'kind', 30) as never,
        title: str(b.title, 'title', 120),
        complainantId: b.complainantId == null ? null : str(b.complainantId, 'complainantId', 80),
        receivedOn: date(b.receivedOn, 'receivedOn'),
        note: b.note == null ? '' : str(b.note, 'note', 2000),
      }),
    );
  }

  @Post('hr/cases/:id/steps')
  hrCaseStep(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const panelIds = b.panelIds == null ? undefined : Array.isArray(b.panelIds) ? b.panelIds.slice(0, 10).map((x) => str(x, 'panelIds', 80)) : undefined;
    if (b.proven != null && typeof b.proven !== 'boolean') throw new BadRequestException('proven must be true or false');
    if (b.suspensionDays != null && typeof b.suspensionDays !== 'number') throw new BadRequestException('suspensionDays must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.hrCaseStep(u, id.slice(0, 80), {
        kind: str(b.kind, 'kind', 40) as never,
        note: b.note == null ? '' : str(b.note, 'note', 2000),
        replyDue: b.replyDue == null ? null : date(b.replyDue, 'replyDue'),
        panelIds,
        hearingOn: b.hearingOn == null ? null : date(b.hearingOn, 'hearingOn'),
        proven: (b.proven as boolean | undefined) ?? null,
        outcome: b.outcome == null ? null : (str(b.outcome, 'outcome', 20) as never),
        suspensionDays: (b.suspensionDays as number | undefined) ?? null,
      }),
    );
  }

  // HR Phase 3, office OSH (Fauzan, 2 Nov 2026): the OSH coordinator, office risk assessments and DOSH reports.
  @Get('hr/osh')
  officeOsh(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.officeOsh(u));
  }

  @Post('hr/osh/coordinator')
  appointOshCoordinator(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.appointOshCoordinator(u, {
        companyId: str(b.companyId, 'companyId', 80),
        personId: str(b.personId, 'personId', 80),
        appointedOn: date(b.appointedOn, 'appointedOn'),
        trainingRef: b.trainingRef == null ? null : str(b.trainingRef, 'trainingRef', 120),
        note: b.note == null ? '' : str(b.note, 'note', 500),
      }),
    );
  }

  @Post('hr/osh/assessments')
  recordOfficeAssessment(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (typeof b.hazards !== 'number' || typeof b.highRisks !== 'number') throw new BadRequestException('hazards and highRisks must be numbers');
    return this.db.asUser(uid, (svc, u) =>
      svc.recordOfficeAssessment(u, {
        companyId: str(b.companyId, 'companyId', 80),
        workplace: str(b.workplace, 'workplace', 120),
        assessedOn: date(b.assessedOn, 'assessedOn'),
        hazards: b.hazards as number,
        highRisks: b.highRisks as number,
        controls: b.controls == null ? '' : str(b.controls, 'controls', 1000),
      }),
    );
  }

  @Post('hr/osh/incidents')
  reportOshIncident(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (typeof b.serious !== 'boolean') throw new BadRequestException('serious must be true or false');
    return this.db.asUser(uid, (svc, u) =>
      svc.reportOshIncident(u, {
        companyId: str(b.companyId, 'companyId', 80),
        incident: str(b.incident, 'incident', 30) as never,
        occurredOn: date(b.occurredOn, 'occurredOn'),
        personId: b.personId == null ? null : str(b.personId, 'personId', 80),
        serious: b.serious as boolean,
        description: str(b.description, 'description', 1500),
      }),
    );
  }

  @Post('hr/osh/incidents/:id/report')
  recordOshReport(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.recordOshReport(u, id.slice(0, 80), { reportedOn: date(b.reportedOn, 'reportedOn'), ref: str(b.ref, 'ref', 80) }));
  }

  // HR Phase 3, slice 3F (Fauzan, 2 Nov 2026): training, appraisals, policy acknowledgements.
  // Guard training and legal papers: HR and the guard's company head (Fauzan, 2 Nov 2026).
  @Get('hr/guard-training')
  guardTraining(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.guardTraining(u));
  }

  @Post('hr/guard-training/papers')
  recordGuardPaper(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.recordGuardPaper(u, {
        personId: str(b.personId, 'personId', 80),
        type: str(b.type, 'type', 30) as never,
        number: str(b.number, 'number', 60),
        issuedOn: date(b.issuedOn, 'issuedOn'),
        expiresOn: b.expiresOn == null ? null : date(b.expiresOn, 'expiresOn'),
      }),
    );
  }

  @Get('hr/training')
  trainingRecords(@UserId() uid: string, @Query('personId') personId?: string) {
    return this.db.asUser(uid, (svc, u) => svc.trainingRecords(u, personId ? str(personId, 'personId', 80) : undefined));
  }

  @Post('hr/training')
  recordTraining(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (typeof b.hours !== 'number') throw new BadRequestException('hours must be a number');
    if (b.cost != null && typeof b.cost !== 'number') throw new BadRequestException('cost must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.recordTraining(u, {
        personId: str(b.personId, 'personId', 80),
        course: str(b.course, 'course', 160),
        provider: b.provider == null ? '' : str(b.provider, 'provider', 120),
        from: date(b.from, 'from'),
        to: date(b.to, 'to'),
        hours: b.hours as number,
        cost: (b.cost as number | undefined) ?? null,
        hrdRef: b.hrdRef == null ? null : str(b.hrdRef, 'hrdRef', 80),
        certificateRef: b.certificateRef == null ? null : str(b.certificateRef, 'certificateRef', 80),
      }),
    );
  }

  @Get('hr/appraisals')
  appraisals(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.appraisals(u));
  }

  @Post('hr/appraisals')
  openAppraisal(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.openAppraisal(u, { personId: str(b.personId, 'personId', 80), year: str(b.year, 'year', 4), appraiserId: str(b.appraiserId, 'appraiserId', 80) }));
  }

  @Post('hr/appraisals/:id/rate')
  rateAppraisal(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.rating !== 'number') throw new BadRequestException('rating must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.rateAppraisal(u, id.slice(0, 80), {
        rating: b.rating as number,
        strengths: b.strengths == null ? '' : str(b.strengths, 'strengths', 2000),
        improve: b.improve == null ? '' : str(b.improve, 'improve', 2000),
        trainingNeeds: b.trainingNeeds == null ? '' : str(b.trainingNeeds, 'trainingNeeds', 1000),
      }),
    );
  }

  @Post('hr/appraisals/:id/comment')
  commentAppraisal(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.commentAppraisal(u, id.slice(0, 80), b.comment == null ? '' : str(b.comment, 'comment', 2000)));
  }

  @Post('hr/appraisals/:id/close')
  closeAppraisal(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.closeAppraisal(u, id.slice(0, 80), b.note == null ? '' : str(b.note, 'note', 1000)));
  }

  @Get('hr/policies')
  hrPolicies(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.hrPolicies(u));
  }

  @Post('hr/policies')
  publishPolicy(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.publishPolicy(u, { id: b.id == null ? null : str(b.id, 'id', 80), kind: str(b.kind, 'kind', 20) as never, title: str(b.title, 'title', 160), body: str(b.body, 'body', 20000) }),
    );
  }

  @Get('hr/legal')
  hrLegalChecks(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.hrLegalChecks(u));
  }

  @Post('hr/legal/:id')
  updateHrLegalCheck(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.updateHrLegalCheck(u, id.slice(0, 60), { status: str(b.status, 'status', 20) as never, directorId: b.directorId == null ? null : str(b.directorId, 'directorId', 80), note: b.note == null ? '' : str(b.note, 'note', 1000) }),
    );
  }

  @Get('hr/overtime')
  staffOvertime(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.staffOvertime(u));
  }

  @Post('hr/overtime')
  setStaffOvertime(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const ids = Array.isArray(b.personIds) ? b.personIds.slice(0, 2000).map((x, i) => str(x, `personIds[${i}]`, 80)) : [];
    return this.db.asUser(uid, (svc, u) =>
      svc.setStaffOvertime(u, { enabled: b.enabled === true, normal: Number(b.normal), restDay: Number(b.restDay), publicHoliday: Number(b.publicHoliday), personIds: ids, comment: b.comment == null ? '' : str(b.comment, 'comment', 500) }),
    );
  }

  @Post('hr/overtime/preview')
  overtimePreview(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) => svc.overtimePreview(u, { personId: str(b.personId, 'personId', 80), hours: Number(b.hours), kind: str(b.kind, 'kind', 20) as never }));
  }

  @Post('hr/policies/:id/acknowledge')
  acknowledgePolicy(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.acknowledgePolicy(u, id.slice(0, 80)));
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

  // Central Admin 5E: CEO instructions become tracked tasks; the weekly Director Office digest.
  @Get('ceo/instructions')
  ceoInstructions(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.ceoInstructions(u));
  }

  @Post('ceo/instructions')
  ceoInstruct(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    return this.db.asUser(uid, (svc, u) =>
      svc.ceoInstruct(u, {
        userId: str(b.userId, 'userId', 80),
        title: str(b.title, 'title', 200),
        doneMeans: str(b.doneMeans, 'doneMeans', 500),
        dueAt: str(b.dueAt, 'dueAt', 40),
        priority: b.priority === 'normal' ? 'normal' : 'high',
      }),
    );
  }

  @Get('director/legal-flags')
  directorLegalFlags(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.directorLegalFlags(u));
  }

  @Get('director/digest')
  directorDigest(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.directorDigest(u));
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

  /** Arisha's advice to the manager on moving or readjusting the team's work (Fauzan, 2 Nov 2026). Read only. */
  @Get('work/rebalance')
  async workRebalance(@UserId() uid: string) {
    const r = await this.db.asUser(uid, (svc, u) => svc.workRebalance(u));
    return { ...r, ai: rebalanceAiOn() && r.people.length > 0 };
  }

  /**
   * Ask Arisha AI about one rebalance case (Fauzan, 2 Nov 2026: "Use ai when needed. We use it in case basis").
   * Off unless WORK_REBALANCE_AI_ENABLED=true and Arisha AI itself is on. The service checks the manager, recomputes
   * the case, counts the daily cap and builds a pseudonymised brief; no tools are offered to the model, so it can only
   * answer in words. Names are put back only in the answer returned to the manager.
   */
  @Post('work/rebalance/ask-ai')
  async workRebalanceAskAi(@UserId() uid: string, @Body() b: { adviceId?: unknown }, @Req() req: AuthedRequest) {
    const provider = arishaProvider();
    if (!provider || !rebalanceAiOn()) throw new ServiceUnavailableException('Arisha AI is not switched on for rebalancing.');
    const adviceId = str(b?.adviceId, 'adviceId', 200);
    const { brief, labels } = await this.db.asUser(uid, (svc, u) => svc.workRebalanceAiCase(u, adviceId));
    try {
      const answer = await askArishaFor(provider, uid, req, { history: [], brief, tools: null });
      return { text: rebalanceAiNames(answer.text, labels).slice(0, 4000), source: 'Arisha AI (advice only; names were not sent)' };
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      if (e instanceof ArishaBusy) throw new HttpException(e.message, 429);
      if (e instanceof ArishaUnavailable) throw new ServiceUnavailableException(e.message);
      console.error('Rebalance AI request failed'); // Never log the brief or the answer.
      throw new ServiceUnavailableException('Arisha AI could not answer. The rule-based advice is still on the screen.');
    }
  }

  /** Delegate: the manager moves an open task to someone else in their line, with a reason. */
  @Post('work/tasks/:id/reassign')
  workTaskReassign(
    @UserId() uid: string,
    @Param('id') id: string,
    @Body() b: { toUserId?: unknown; reason?: unknown; dueAt?: unknown; adviceId?: unknown; expectedVersion?: unknown },
  ) {
    return this.db.asUser(uid, (svc, u) =>
      svc.workTaskReassign(u, id.slice(0, 160), {
        toUserId: str(b.toUserId, 'toUserId', 80),
        reason: str(b.reason, 'reason', 300),
        dueAt: b.dueAt == null || b.dueAt === '' ? null : str(b.dueAt, 'dueAt', 40),
        adviceId: b.adviceId == null ? null : str(b.adviceId, 'adviceId', 200),
        expectedVersion: b.expectedVersion == null ? null : str(b.expectedVersion, 'expectedVersion', 80),
      }),
    );
  }

  /** Readjust: the manager gives a new due time or priority on an open task, with a reason. */
  @Post('work/tasks/:id/adjust')
  workTaskAdjust(
    @UserId() uid: string,
    @Param('id') id: string,
    @Body() b: { dueAt?: unknown; priority?: unknown; reason?: unknown; adviceId?: unknown; expectedVersion?: unknown },
  ) {
    return this.db.asUser(uid, (svc, u) =>
      svc.workTaskAdjust(u, id.slice(0, 160), {
        dueAt: b.dueAt == null || b.dueAt === '' ? null : str(b.dueAt, 'dueAt', 40),
        priority: b.priority === 'high' ? 'high' : b.priority === 'normal' ? 'normal' : null,
        reason: str(b.reason, 'reason', 300),
        adviceId: b.adviceId == null ? null : str(b.adviceId, 'adviceId', 200),
        expectedVersion: b.expectedVersion == null ? null : str(b.expectedVersion, 'expectedVersion', 80),
      }),
    );
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
      // Correcting the caller's own refused request (Arisha review, 3 Nov 2026); the service checks it is theirs, refused, once.
      correctsId: b.correctsId == null || b.correctsId === '' ? null : str(b.correctsId, 'correctsId', 100),
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

  @Post('sites/:id/roster/shifts')
  addShifts(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = {
      postId: str(b.postId, 'postId', 100),
      from: date(b.from, 'from'),
      days: Number(b.days),
      // No times: the post's own shift pattern.
      start: b.start == null || b.start === '' ? null : str(b.start, 'start', 5),
      end: b.end == null || b.end === '' ? null : str(b.end, 'end', 5),
      guards: b.guards == null || b.guards === '' ? null : Number(b.guards),
      skipSundays: typeof b.skipSundays === 'boolean' ? b.skipSundays : undefined,
    };
    return this.db.asUser(uid, (svc, u) => svc.addShifts(u, id, input));
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

  // ---------- CMS messages to site shared devices (Fauzan, 6 Nov 2026) ----------

  @Get('device/dispatches')
  deviceDispatches(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.deviceDispatches(u));
  }

  @Post('device/dispatches/:id/seen')
  dispatchSeen(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.dispatchSeen(u, id));
  }

  @Post('device/dispatches/:id/ack')
  ackDispatch(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = { staffNo: str(b.staffNo, 'staffNo', 20), pin: str(b.pin, 'pin', 10) };
    return this.db.asUser(uid, (svc, u) => svc.acknowledgeDispatch(u, id, input));
  }

  @Post('device/dispatches/:id/photos')
  dispatchPhoto(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const bodycam = b.source === 'bodycam';
    const input = { ...evidence(b), source: bodycam ? ('bodycam' as const) : ('in_app_camera' as const), bodycamId: bodycam ? str(b.bodycamId, 'bodycamId', 120) : null };
    return this.db.asUser(uid, (svc, u) => svc.addDispatchPhoto(u, id, input));
  }

  @Post('device/dispatches/:id/videos')
  dispatchVideo(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    // Test clips exist only in the browser test version; the live API takes the device camera or a linked bodycam.
    if (b.source === 'test_clip') throw new BadRequestException('Record the video with the in-app camera.');
    const bodycam = b.source === 'bodycam';
    const input = {
      video: str(b.video, 'video', 2_800_000),
      durationSec: typeof b.durationSec === 'number' ? b.durationSec : NaN,
      lat: coord(b.lat),
      lng: coord(b.lng),
      accuracyM: coord(b.accuracyM),
      capturedAt: typeof b.capturedAt === 'string' && b.capturedAt.length < 40 ? b.capturedAt : null,
      caption: typeof b.caption === 'string' ? b.caption.slice(0, 200) : '',
      source: bodycam ? ('bodycam' as const) : ('device_camera' as const),
      bodycamId: bodycam ? str(b.bodycamId, 'bodycamId', 120) : null,
    };
    return this.db.asUser(uid, (svc, u) => svc.addDispatchVideo(u, id, input));
  }

  @Post('device/dispatches/:id/reply')
  replyDispatch(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const reply = str(b.reply, 'reply', 500);
    return this.db.asUser(uid, (svc, u) => svc.replyDispatch(u, id, reply));
  }

  // ---------- One-stop guard duty device: post log, visitors and vehicles (Fauzan, 6 Nov 2026) ----------

  @Get('device/duty')
  dutyDevice(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.dutyDevice(u));
  }

  @Post('device/post-log')
  addPostLog(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = str(b.kind, 'kind', 20) as PostLogKind;
    const input = {
      offlineContext: dutyOfflineContext(b.offlineContext),
      staffNo: str(b.staffNo, 'staffNo', 20),
      pin: str(b.pin, 'pin', 10),
      kind,
      text: str(b.text, 'text', 1000),
      correctsId: b.correctsId == null ? null : str(b.correctsId, 'correctsId', 200),
      photo: b.photo && typeof b.photo === 'object' ? evidence(b.photo as Record<string, unknown>) : null,
      // Written offline: the device's own reference and time.
      clientRef: b.clientRef == null ? undefined : str(b.clientRef, 'clientRef', 64),
      recordedAt: b.recordedAt == null ? null : str(b.recordedAt, 'recordedAt', 40),
    };
    return this.db.asUser(uid, (svc, u) => svc.addPostLog(u, input));
  }

  @Post('device/gate/in')
  gateIn(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (b.kind !== 'visitor' && b.kind !== 'vehicle' && b.kind !== 'paper_log') throw new BadRequestException('kind must be visitor, vehicle or paper_log');
    if (b.kind !== 'paper_log' && (!b.photo || typeof b.photo !== 'object')) throw new BadRequestException('photo is missing');
    const v = b.visitor && typeof b.visitor === 'object' ? (b.visitor as Record<string, unknown>) : null;
    const veh = b.vehicle && typeof b.vehicle === 'object' ? (b.vehicle as Record<string, unknown>) : null;
    const pp = b.paper && typeof b.paper === 'object' ? (b.paper as Record<string, unknown>) : null;
    const read = (x: unknown): 'photo' | 'scan' | 'typed' => (x === 'scan' || x === 'photo' ? x : 'typed');
    const input = {
      offlineContext: dutyOfflineContext(b.offlineContext),
      staffNo: str(b.staffNo, 'staffNo', 20),
      pin: str(b.pin, 'pin', 10),
      kind: b.kind as 'visitor' | 'vehicle' | 'paper_log',
      clientRef: b.clientRef == null ? undefined : str(b.clientRef, 'clientRef', 64),
      recordedAt: b.recordedAt == null ? null : str(b.recordedAt, 'recordedAt', 40),
      visitor: v
        ? {
            name: str(v.name, 'visitor.name', 120),
            idKind: str(v.idKind, 'visitor.idKind', 20) as VisitorIdKind,
            // Prima keeps the last 4 characters; the full number travels only inside the sealed bundle.
            idLast4: typeof v.idLast4 === 'string' ? v.idLast4.slice(0, 8) : undefined,
            idNumber: typeof v.idNumber === 'string' ? v.idNumber.slice(0, 30) : undefined,
            idRead: read(v.idRead),
            company: typeof v.company === 'string' ? v.company.slice(0, 120) : '',
            host: str(v.host, 'visitor.host', 120),
            purpose: str(v.purpose, 'visitor.purpose', 200),
            face: face(v.face),
          }
        : null,
      vehicle: veh ? { plate: str(veh.plate, 'vehicle.plate', 20), plateRead: read(veh.plateRead) } : null,
      paper: pp ? { coversDate: str(pp.coversDate, 'paper.coversDate', 10), lines: Number(pp.lines), note: typeof pp.note === 'string' ? pp.note.slice(0, 300) : '' } : null,
      // Checked for shape by the service; its contents cannot be read here.
      sealed: b.sealed && typeof b.sealed === 'object' ? (b.sealed as SealedBundle) : null,
      photo: b.photo && typeof b.photo === 'object' ? evidence(b.photo as Record<string, unknown>) : null,
    };
    return this.db.asUser(uid, (svc, u) => svc.gateIn(u, input));
  }

  @Post('device/gate/:id/out')
  gateOut(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = {
      offlineContext: dutyOfflineContext(b.offlineContext),
      staffNo: str(b.staffNo, 'staffNo', 20),
      pin: str(b.pin, 'pin', 10),
      recordedAt: b.recordedAt == null ? null : str(b.recordedAt, 'recordedAt', 40),
    };
    return this.db.asUser(uid, (svc, u) => svc.gateOut(u, id, input));
  }

  // ---------- Client needs and site tasks (Fauzan, 6 Nov 2026) ----------

  @Get('sites/:id/tasks')
  siteTaskBoard(@UserId() uid: string, @Param('id') id: string) {
    return this.db.asUser(uid, (svc, u) => svc.siteTaskBoard(u, id));
  }

  @Post('sites/:id/needs-reviews')
  saveNeedsReview(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const raw = b.answers && typeof b.answers === 'object' ? (b.answers as Record<string, unknown>) : {};
    if (Object.keys(raw).length > 60) throw new BadRequestException('Too many topics.');
    const answers: Record<string, { answer: string; concern: 'none' | 'low' | 'medium' | 'high' }> = {};
    for (const [k, v] of Object.entries(raw)) {
      const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
      const c = o.concern;
      answers[k.slice(0, 60)] = { answer: typeof o.answer === 'string' ? o.answer.slice(0, 600) : '', concern: c === 'low' || c === 'medium' || c === 'high' ? c : 'none' };
    }
    const input = { clientContact: str(b.clientContact, 'clientContact', 160), answers, agreed: str(b.agreed, 'agreed', 2000) };
    return this.db.asUser(uid, (svc, u) => svc.saveNeedsReview(u, id, input));
  }

  @Post('sites/:id/tasks')
  setSiteTask(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const forRole = b.forRole;
    if (forRole !== 'guard' && forRole !== 'officer' && forRole !== 'patrol_officer') throw new BadRequestException('forRole must be guard, officer or patrol_officer');
    const input = {
      title: str(b.title, 'title', 120),
      detail: typeof b.detail === 'string' ? b.detail.slice(0, 600) : '',
      forRole: forRole as 'guard' | 'officer' | 'patrol_officer',
      days: Array.isArray(b.days) ? b.days.slice(0, 7).map(Number) : [],
      onDate: b.onDate == null || b.onDate === '' ? null : str(b.onDate, 'onDate', 10),
      byTime: b.byTime == null || b.byTime === '' ? null : str(b.byTime, 'byTime', 5),
      proof: b.proof === 'photo' ? ('photo' as const) : ('none' as const),
      needTopic: b.needTopic == null || b.needTopic === '' ? null : str(b.needTopic, 'needTopic', 60),
      until: b.until == null || b.until === '' ? null : str(b.until, 'until', 10),
    };
    return this.db.asUser(uid, (svc, u) => svc.setSiteTask(u, id, input));
  }

  @Post('sites/:id/gate-log')
  setGateLog(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (typeof b.on !== 'boolean') throw new BadRequestException('on must be true or false');
    const on = b.on;
    const reason = str(b.reason, 'reason', 300);
    return this.db.asUser(uid, (svc, u) => svc.setGateLog(u, id, on, reason));
  }

  @Post('site-tasks/:id/stop')
  stopSiteTask(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const reason = str(b.reason, 'reason', 300);
    return this.db.asUser(uid, (svc, u) => svc.stopSiteTask(u, id, reason));
  }

  @Post('device/tasks/:id')
  doSiteTask(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const input = {
      offlineContext: dutyOfflineContext(b.offlineContext),
      staffNo: str(b.staffNo, 'staffNo', 20),
      pin: str(b.pin, 'pin', 10),
      result: b.result === 'not_done' ? ('not_done' as const) : ('done' as const),
      note: typeof b.note === 'string' ? b.note.slice(0, 500) : '',
      photo: b.photo && typeof b.photo === 'object' ? evidence(b.photo as Record<string, unknown>) : null,
      recordedAt: b.recordedAt == null ? null : str(b.recordedAt, 'recordedAt', 40),
    };
    return this.db.asUser(uid, (svc, u) => svc.doSiteTask(u, id, input));
  }

  @Get('sites/:id/duty-log')
  siteDutyLog(@UserId() uid: string, @Param('id') id: string, @Query('days') days?: string) {
    return this.db.asUser(uid, (svc, u) => svc.siteDutyLog(u, id, days ? Number(days) || 2 : 2));
  }

  @Get('cms/dispatches')
  cmsDispatches(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.cmsDispatches(u));
  }

  @Post('cms/dispatches')
  sendDispatch(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const level = b.level;
    const proof = b.proof;
    if (level !== 'instruction' && level !== 'alert' && level !== 'urgent') throw new BadRequestException('level must be instruction, alert or urgent');
    if (proof !== 'none' && proof !== 'photo' && proof !== 'video' && proof !== 'photo_or_video') throw new BadRequestException('proof must be none, photo, video or photo_or_video');
    const input = {
      siteId: str(b.siteId, 'siteId', 120),
      level: level as DispatchLevel,
      proof: proof as DispatchProof,
      title: str(b.title, 'title', 120),
      message: str(b.message, 'message', 600),
      alarmId: b.alarmId == null ? null : str(b.alarmId, 'alarmId', 160),
    };
    return this.db.asUser(uid, (svc, u) => svc.sendDispatch(u, input));
  }

  @Post('cms/dispatches/:id/close')
  closeDispatch(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const outcome = b.outcome;
    if (outcome !== 'real' && outcome !== 'nothing_found' && outcome !== 'done') throw new BadRequestException('outcome must be real, nothing_found or done');
    const note = str(b.note, 'note', 600);
    return this.db.asUser(uid, (svc, u) => svc.closeDispatch(u, id, outcome, note));
  }

  @Post('cms/dispatches/:id/cancel')
  cancelDispatch(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const note = str(b.note, 'note', 300);
    return this.db.asUser(uid, (svc, u) => svc.cancelDispatch(u, id, note));
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

  /** Growth panel for group leadership (Fauzan, 3 Nov 2026): read only, Unknown is never zero. */
  @Get('growth')
  growth(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.growth(u));
  }

  /** Site margin for the Growth panel, from the Operations monitors' site profit and loss (loaded on its own). */
  // The CEO's approval value limits (Fauzan, 3 Nov 2026).
  @Get('approval-limits')
  approvalLimits(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.approvalLimits(u));
  }

  @Post('approval-limits')
  setApprovalLimits(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the limits as an object');
    return this.db.asUser(uid, (svc, u) => svc.setApprovalLimits(u, b));
  }

  @Get('growth/margin')
  growthMargin(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.growthMargin(u));
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

  // Management fees from the signed agreements, entered by the Finance Director or the CEO (Fauzan, 2 Nov 2026).
  @Get('finance/management-fees')
  managementFees(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.managementFees(u));
  }

  @Post('finance/management-fees/:companyId')
  setManagementFee(@UserId() uid: string, @Param('companyId') companyId: string, @Body() b: Record<string, unknown>) {
    const kind = (['percent', 'fixed'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('kind must be percent or fixed');
    const opsCompany = (['goodwill', 'sasateam'] as const).find((k) => k === b.opsCompany);
    if (!opsCompany) throw new BadRequestException('opsCompany must be goodwill or sasateam');
    if (typeof b.value !== 'number') throw new BadRequestException('value must be a number');
    return this.db.asUser(uid, (svc, u) =>
      svc.setManagementFee(u, companyId.slice(0, 40), { opsCompany, kind, value: b.value as number, agreementRef: str(b.agreementRef ?? '', 'agreementRef', 120) }),
    );
  }

  // The month's management fee bills from Goodwill Empire and Sasa Team to each company (draft, not an invoice).
  @Get('finance/management-fee-bills')
  managementFeeBills(@UserId() uid: string, @Query('month') month?: string) {
    if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
    return this.db.asUser(uid, (svc, u) => svc.managementFeeBills(u, month));
  }

  // Government Operations: site profit and loss, salary check and guards on leave (Fauzan, 2 Nov 2026).
  @Get('ops/government')
  govOpsMonitor(@UserId() uid: string, @Query('month') month?: string) {
    if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
    return this.db.asUser(uid, (svc, u) => svc.govOpsMonitor(u, month));
  }

  // Private Operations (Sasa Team): the same for private-sector sites (Fauzan, 2 Nov 2026).
  @Get('ops/private')
  privateOpsMonitor(@UserId() uid: string, @Query('month') month?: string) {
    if (month !== undefined && !/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
    return this.db.asUser(uid, (svc, u) => svc.privateOpsMonitor(u, month));
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

  @Post('insurance-claims/:id/act')
  insuranceClaimAct(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the details as an object');
    const action = str(b.action ?? '', 'action', 30);
    return this.db.asUser(uid, (svc, u) => svc.insuranceClaimAct(u, id.slice(0, 120), action, b));
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

  // P78: enter a new tender on the company's own screen (admin team, the owner, or the Director Office Administrator).
  @Post('companies/:id/tenders')
  addTender(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const num = (v: unknown, name: string) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadRequestException(`${name} must be a number`);
      return v;
    };
    if (b.channel !== 'GOVERNMENT' && b.channel !== 'PRIVATE') throw new BadRequestException('channel must be GOVERNMENT or PRIVATE');
    const input = {
      ref: str(b.ref, 'ref', 60),
      title: str(b.title, 'title', 160),
      buyer: str(b.buyer, 'buyer', 120),
      channel: b.channel as 'GOVERNMENT' | 'PRIVATE',
      source: b.source == null ? '' : str(b.source, 'source', 80),
      owner: b.owner == null ? '' : str(b.owner, 'owner', 80),
      closesOn: str(b.closesOn, 'closesOn', 10),
      guards: num(b.guards, 'guards'),
      sites: b.sites == null ? 1 : num(b.sites, 'sites'),
      estMonthly: b.estMonthly == null ? null : num(b.estMonthly, 'estMonthly'),
      armed: b.armed === true,
    };
    return this.db.asUser(uid, (svc, u) => svc.addTender(u, id, input));
  }

  // Correct a draft or returned quotation's numbers, with a reason (review finding, 2 Nov 2026). Before :action so it matches first.
  @Post('quotations/:id/correct')
  correctQuotation(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const num = (v: unknown, name: string) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadRequestException(`${name} must be a number`);
      return v;
    };
    const hours = num(b.hoursPerDay, 'hoursPerDay');
    if (hours !== 8 && hours !== 12) throw new BadRequestException('hoursPerDay must be 8 or 12');
    const input = {
      guards: num(b.guards, 'guards'),
      hoursPerDay: hours as 8 | 12,
      ratePerGuard: num(b.ratePerGuard, 'ratePerGuard'),
      validUntil: date(b.validUntil, 'validUntil'),
      reason: str(b.reason, 'reason', 500),
    };
    return this.db.asUser(uid, (svc, u) => svc.correctQuotation(u, id, input));
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
        sections: Array.isArray((b as { sections?: unknown }).sections)
          ? ((b as { sections: unknown[] }).sections.slice(0, 20).map((x) => str(x, 'sections', 160)))
          : undefined,
      }),
    );
  }

  @Get('meetings')
  meetings(@UserId() uid: string) {
    return this.db.asUser(uid, (svc, u) => svc.meetings(u));
  }

  @Post('meetings')
  scheduleMeeting(@UserId() uid: string, @Body() b: Record<string, unknown>) {
    const kind = (['board', 'management', 'operations', 'department', 'client', 'toolbox', 'other'] as const).find((k) => k === b.kind);
    if (!kind) throw new BadRequestException('unknown kind of meeting');
    const every = b.repeat == null ? null : (['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'] as const).find((k) => k === b.repeat);
    if (b.repeat != null && !every) throw new BadRequestException('unknown repeat');
    const times = b.times == null ? undefined : Number(b.times);
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
        repeat: every,
        times,
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

  // P78: add an action item the minutes reader missed; the service checks who runs the meeting.
  @Post('meetings/:id/actions')
  addMeetingAction(@UserId() uid: string, @Param('id') id: string, @Body() b: { text?: unknown; owner?: unknown; due?: unknown }) {
    return this.db.asUser(uid, (svc, u) =>
      svc.addMeetingAction(u, id.slice(0, 120), {
        text: str(b?.text ?? '', 'text', 300),
        owner: str(b?.owner ?? '', 'owner', 80),
        due: b?.due == null || b.due === '' ? null : date(b.due, 'due'),
      }),
    );
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
const JA_DATASETS = { payroll: 'payroll', 'foreign-workers': 'worker', incidents: 'incident', guards: 'guard', 'pay-summary': 'paySummary' } as const;

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

/**
 * Where the CCTV and sensor analytics system sends what it detects (Fauzan, 6 Nov 2026). Off until ANALYTICS_API_KEY and
 * ANALYTICS_SIGNING_SECRET are set; same signed-call rules as the other feeds. A detection is never verified by itself.
 */
@Controller('api/integrations/analytics/v1')
@UseGuards(AnalyticsFeedGuard)
export class AnalyticsFeedController {
  constructor(private db: Db) {}

  @Post('detections')
  ingest(@Body() b: Record<string, unknown>) {
    if (b.system !== 'cctv' && b.system !== 'sensor') throw new BadRequestException('system must be cctv or sensor');
    const system = b.system;
    const input = {
      siteId: str(b.siteId, 'siteId', 120),
      system: system as 'cctv' | 'sensor',
      device: str(b.device, 'device', 60),
      label: str(b.label, 'label', 120),
      confidence: typeof b.confidence === 'number' ? b.confidence : NaN,
    };
    return this.db.asUser(process.env.ANALYTICS_FEED_USER_ID ?? 'u-analytics-feed', (svc, u) => svc.recordAnalyticsDetection(u, input));
  }
}

/**
 * The company's in-house records server collects the sealed gate details (full identity number, IC picture, written
 * book pages) and confirms it holds them (Fauzan, 6 Nov 2026: police need the full data, kept 2 to 7 years). Off until
 * INHOUSE_API_KEY and INHOUSE_SIGNING_SECRET are set; same signed-call rules as the other feeds.
 */
@Controller('api/integrations/inhouse/v1')
@UseGuards(InhouseFeedGuard)
export class InhouseFeedController {
  constructor(private db: Db) {}

  @Post('gate-records/collect')
  collect(@Body() b: Record<string, unknown>) {
    const limit = typeof b.limit === 'number' ? b.limit : 100;
    return this.db.asUser(process.env.INHOUSE_FEED_USER_ID ?? 'u-inhouse-server', (svc, u) => svc.inhouseQueue(u, limit));
  }

  @Post('gate-records/confirm')
  confirm(@Body() b: Record<string, unknown>) {
    if (!Array.isArray(b.ids) || b.ids.some((x) => typeof x !== 'string')) throw new BadRequestException('Send { "ids": ["..."] }.');
    return this.db.asUser(process.env.INHOUSE_FEED_USER_ID ?? 'u-inhouse-server', (svc, u) => svc.inhouseConfirm(u, b.ids as string[]));
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

/** Successors on a critical post: up to five staff ids, each with how ready they are. */
function successorsOf(v: unknown): { userId: string; readiness: 'ready_now' | 'ready_later' | 'not_ready' }[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 5).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const readiness = r.readiness === 'ready_now' || r.readiness === 'ready_later' || r.readiness === 'not_ready' ? r.readiness : null;
    if (!readiness) throw new BadRequestException('Say how ready each successor is.');
    return { userId: str(r.userId ?? '', 'userId', 80), readiness };
  });
}
/**
 * The page a client opens from a report link. No Prima sign-in: the signed link names one company, client and link,
 * the database session is limited to that company (Db.asShareLink), and the service re-checks the link is open. The
 * page is plain escaped HTML with no scripts; every failure gives the same "not available" page.
 */
@Controller('api/share')
export class ShareController {
  constructor(private db: Db) {}

  @Get(':token')
  async open(@Param('token') token: string, @Res() res: Response) {
    res.setHeader('Content-Security-Policy', shareCsp());
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.type('html');
    const ref = shareBase() === null ? null : verifyShare(token, shareSecret());
    if (!ref) return res.status(404).send(shareGonePage());
    try {
      const report = await this.db.asShareLink(ref.c, (svc) => svc.clientShareReport(ref.c, ref.k, ref.l));
      return res.status(200).send(shareReportPage(report));
    } catch {
      return res.status(404).send(shareGonePage());
    }
  }
}
