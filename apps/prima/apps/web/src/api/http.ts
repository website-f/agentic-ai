import { invalidateDutyContext } from '../duty/context';
import { type ExtractionStatus, type ExtractionRequest, type ExtractionPreview } from './it-extraction';
import { type SharePointStatus, type SharePointCheck, type SharePointLibraries, type SharePointItems } from './connections';
import { type Home, type User, type ClientLostReason, type EvidenceDoc, type ProofInput, type ReportDef, type FinCloseAction, type FinPackKind, type FinPaymentAction, type FinRequestAction, type CmsServiceKind, type GrowthMargin, type GrowthPanel, type FwPaper } from '@prima/core';
import type { DisciplineAppealDecision, DisciplineAppeals, PolicyCopyInput, StaffLangId } from './types';
import { type FinControlArea, ApiError, type Api, type WorkAdjustInput, type WorkReassignInput, type ClientAccountInput, type CrmBoard, type CrmClient, type CmsSettingsPatch, type ContractInput, type FollowUpInput, type FwAddFromJaInput, type FwPaperInput, type LeaveInput, type OfficeDeskInput, type Me, type PdpaCaseInput, type PdpaStepName, type VehicleRequestInput, type ExpenseInput, type ProductInput, type ProductCertInput, type VehicleWorkInput, type PhotoInput, type CmsDispatches, type DeviceDispatches, type DispatchInput, type VideoInput, type DutyDevice, type SiteDutyLog, type PostLogInput, type GateInInput, type SiteTaskBoard, type NeedsReviewInput, type SiteTaskInput, type DoSiteTaskInput, type ArmsRequestAction, type ArmsRequestStepExtra, type RaiseArmsRequestInput, type SpecialOpsLegalFlags, type ArmsTradingState, type TransportBoard, type AmRentCheck, type AmBuyInput, type AmWhatsAppBoard, type ApprovalLimitsView, type OfficerHoursInput, type CleaningRecordInput, type CleaningSetupInput, type CleaningProofInput, type StockLineInput, type CleaningSlipInput, type ClientWorkAckInput, type GuardTermsInput, type OpportunityInput, type SourceCheckInput, type AmBqActionInput, type PaperReadingResult, type ClientCodeBoard, type ClientCodeInput, type ClientCheckInput, type ClientInspectionInput, type SelfAuditBoard, type SelfAuditInput, type RbaBoard, type RbaTraceBoard, type WorkerFilesBoard, type EthicsBoard, type RbaCommitteeInput, type EthicsInput, type ItEwaste } from './types';
import { MicrosoftSignIn, type SignInConfig } from './microsoft';































































const TOKEN_KEY = 'prima-token';

/** The office's CSRF token (its agentic_csrf cookie), sent back as a header on every call. */
function officeCsrf(): string {
  const m = /(?:^|;\s*)agentic_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]) : '';
}
/** Sent on window when the server says the sign-in is no longer valid (HTTP 401). */
export const SESSION_ENDED = 'prima:session-ended';

/** Client for the Prima Secure API. Staff sign in with Microsoft 365; the development picker only when the server allows it. */
export class HttpApi implements Api {
  readonly mode = 'server' as const;
  private token: string | null = null;
  /** P99: the office gave this person Prima only (its /me says so): signing out signs out of the office. */
  private primaOnly = false;
  private setup: Promise<{ config: SignInConfig; ms: MicrosoftSignIn | null }> | null = null;

  /**
   * P66: inside the Agentic Office (/prima/), Prima opens with the office's own sign-in. The office signs each call
   * for the person signed in (apps/api/agentic/prima), so the browser holds no Prima token at all.
   */
  constructor(private base = '', readonly office = false) {
    try {
      this.token = sessionStorage.getItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Reads the sign-in settings once and, when Microsoft sign-in is on, finishes any return from the Microsoft page. */
  private ready() {
    this.setup ??= (async () => {
      if (this.office) return { config: { microsoft: null, devLogin: false } as SignInConfig, ms: null };
      const res = await fetch(`${this.base}/api/auth/config`);
      const config = (res.ok ? await res.json() : { microsoft: null, devLogin: false }) as SignInConfig;
      return { config, ms: config.microsoft ? await MicrosoftSignIn.start(config.microsoft) : null };
    })();
    // No signal when the app opened (offline site survey): try again on the next call instead of staying broken.
    const mine = this.setup;
    mine.catch(() => {
      if (this.setup === mine) this.setup = null;
    });
    return mine;
  }

  private async bearer(): Promise<string | null> {
    const { ms } = await this.ready();
    return (ms?.account() ? await ms.token() : null) ?? this.token;
  }

  /**
   * P78: the "receipt-checked" IT and HR screens, inside the office. The office signs every call for the person signed
   * in (there is no Microsoft token in the browser), so the same checks run over that transport: the person is still
   * the one the screen opened for, and the receipt names them and the service.
   */
  private async officeStrict(expectedUserId: string, method: 'GET' | 'POST', path: string, body: unknown, serviceId: string | null, label: string): Promise<unknown> {
    if (!expectedUserId) throw new ApiError(`Reopen ${label}.`, 401, []);
    const me = await this.call<Me>('GET', '/me');
    if (me.user.id !== expectedUserId || me.user.integration) throw new ApiError('Your identity no longer matches this screen.', 401, []);
    const result = await this.call<{ userId?: string; serviceId?: string } | null>(method, path, method === 'GET' ? undefined : body);
    if (serviceId && (!result || result.userId !== expectedUserId || result.serviceId !== serviceId))
      throw new ApiError(`${label} receipt identity did not match.`, 409, []);
    return result;
  }

  async signInOptions() {
    const { config } = await this.ready();
    return { microsoft: !!config.microsoft, devLogin: config.devLogin, guardPhone: !!config.guardPhone, office: this.office };
  }

  async signInMicrosoft() {
    invalidateDutyContext();
    const { ms } = await this.ready();
    if (!ms) throw new ApiError('Microsoft sign-in is not set up on this server.', 400, []);
    await ms.signIn();
  }

  async signOut() {
    invalidateDutyContext();
    // In the office, signing out of Prima is signing out of the office: back to it.
    if (this.office) {
      if (this.primaOnly) {
        // P99: Prima only: the office has nothing else to go back to, so signing out signs out of the office.
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': officeCsrf() },
          body: '{}',
        }).catch(() => undefined);
        window.top?.location.assign('/login');
        return;
      }
      window.top?.location.assign('/');
      return;
    }
    this.token = null;
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    const { ms } = await this.ready();
    if (ms?.account()) await ms.signOut();
  }

  readonly org: import('./types').OrgClient = {
    guide: () => this.call('GET', '/org/guide'),
    inbox: (offset = 0) => this.call('GET', `/org/inbox${offset ? `?offset=${offset}` : ''}`),
    close: (taskId, outcome, note) => this.call('POST', `/org/inbox/${encodeURIComponent(taskId)}/close`, { outcome, note }),
    read: (taskId) => this.call('POST', `/org/inbox/${encodeURIComponent(taskId)}/read`, {}),
    map: () => this.call('GET', '/org/map'),
    importTemplate: (kind) => this.call('GET', `/org/import/${encodeURIComponent(kind)}/template`),
    importPreview: (kind, companyId, csv, opts) => this.call('POST', `/org/import/${encodeURIComponent(kind)}/preview`, { companyId, csv, ...opts }),
    importCommit: (kind, companyId, csv, fingerprint, opts) =>
      this.call('POST', `/org/import/${encodeURIComponent(kind)}/commit`, { companyId, csv, fingerprint, ...opts }),
    importAiState: () => this.call('GET', '/org/import-ai'),
    importAiColumns: (kind, columns) => this.call('POST', `/org/import/${encodeURIComponent(kind)}/ai-columns`, { columns }),
  };

  /** P81: past attendance from the monthly PDF reports, sent in 1 MB pieces (the office signs JSON of at most 3 MB). */
  readonly attendanceReports: import('./attendance-reports').AttendanceReportsClient = {
    // Built here, not imported: the IT screens' test harnesses load this file with a fixed import list.
    overview: (f) => {
      const p = new URLSearchParams();
      if (f.month) p.set('month', f.month);
      if (f.companyId) p.set('companyId', f.companyId);
      if (f.department) p.set('department', f.department);
      if (f.q?.trim()) p.set('q', f.q.trim());
      const qs = p.toString();
      return this.call('GET', `/attendance-reports${qs ? `?${qs}` : ''}`);
    },
    person: (importId, key) => this.call('GET', `/attendance-reports/person?importId=${encodeURIComponent(importId)}&key=${encodeURIComponent(key)}`),
    unmatched: () => this.call('GET', '/attendance-reports/unmatched'),
    staff: (companyId, q) => this.call('GET', `/attendance-reports/staff?companyId=${encodeURIComponent(companyId)}&q=${encodeURIComponent(q)}`),
    match: (companyId, key, personId) => this.call('POST', '/attendance-reports/match', { companyId, key, personId }),
    start: (file) => this.call('POST', '/attendance-reports/uploads', file),
    chunk: (id, index, data) => this.call('POST', `/attendance-reports/uploads/${encodeURIComponent(id)}/chunk`, { index, data }),
    finish: (id) => this.call('POST', `/attendance-reports/uploads/${encodeURIComponent(id)}/finish`, {}),
    status: (id) => this.call('GET', `/attendance-reports/uploads/${encodeURIComponent(id)}`),
    preview: (id, companies) => this.call('POST', `/attendance-reports/uploads/${encodeURIComponent(id)}/preview`, { companies }),
    save: (id, companies, replace) => this.call('POST', `/attendance-reports/uploads/${encodeURIComponent(id)}/save`, { companies, replace }),
    cancel: (id) => this.call('POST', `/attendance-reports/uploads/${encodeURIComponent(id)}/cancel`, {}),
  };

  private async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, signal?: AbortSignal, microsoftOnly = false): Promise<T> {
    let token: string | null;
    if (microsoftOnly) {
      const { ms } = await this.ready();
      if (!ms?.account()) throw new ApiError('Sign in with Microsoft to review imports.', 403, []);
      token = await ms.token();
      if (!token) throw new ApiError('Microsoft sign-in is required.', 403, []);
    } else token = await this.bearer();
    const res = await fetch(`${this.base}/api${path}`, {
      method, signal,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        // The office's session cookie goes with the call; its CSRF token must match (double submit).
        ...(this.office ? { 'x-csrf-token': officeCsrf() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new ApiError(data.message ?? `Request failed (${res.status})`, res.status, data.findings ?? []);
      // P85: a scanned receipt's conflict names the lines that changed, so the phone can offer to scan them again.
      if (res.status === 409 && data.details && typeof data.details === 'object') (err as ApiError & { details?: unknown }).details = data.details;
      // The sign-in has ended (Microsoft session expired or was removed): the app goes back to the sign-in screen
      // instead of leaving every screen showing an error.
      if (res.status === 401) invalidateDutyContext();
      if (res.status === 401) window.dispatchEvent(new CustomEvent(SESSION_ENDED, { detail: err.message }));
      throw err;
    }
    return data as T;
  }

  /** Review routes never use development-token fallback; the server independently checks the linked CEO OID. */
  async itImportReviewAssertOwner(): Promise<void> {
    const { ms } = await this.ready();
    if (!ms?.account()) throw new ApiError('Sign in with Microsoft to review imports.', 403, []);
    const me = await this.call<Me>('GET', '/me', undefined, undefined, true);
    if (me.user.id !== 'u-fauzan' || me.user.opsTier !== 'ceo' || me.user.integration)
      throw new ApiError('Only the linked CEO account may review imports.', 403, []);
  }
  async itImportReviewRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    if (!/^\/api\/arisha\/it-import(?:\/reviews(?:\/[0-9a-f-]{36}(?:\/(?:refresh|approve|abandon))?)?)?$/.test(path))
      throw new ApiError('Unsupported review route.', 400, []);
    await this.itImportReviewAssertOwner();
    return this.call<unknown>(method, path.slice(4), body, undefined, true);
  }

  /** Narrow Microsoft-only transport: no development-token fallback or Mail Send route. */
  async m365Call(expectedUserId: string, method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const mail = method === 'GET' ? /^\/connections\/mail\/jobs\/(?:status|[A-Za-z0-9_-]+\/emails)$/ : /^\/connections\/mail\/jobs\/(?:setup|[A-Za-z0-9_-]+\/emails(?:\/preview|\/[A-Za-z0-9_-]+\/remove)?)$/;
    // Microsoft 365 Connections: status, matrix, check/disconnect and link checks only. No send or write route exists.
    const m365 = method === 'GET' ? /^\/connections\/m365\/(?:status|matrix)$/ : /^\/connections\/m365\/(?:(?:outlook|teams|sharepoint)\/(?:check|disconnect)|(?:teams|sharepoint)\/link)$/;
    if (!mail.test(path) && !m365.test(path)) throw new ApiError('Unsupported Microsoft integration operation.', 400, []);
    const { ms } = await this.ready();
    const accountKey = () => {const a=ms?.account();return a?.homeAccountId ? `${a.homeAccountId}:${a.tenantId}:${a.localAccountId}` : null;};
    const selected=accountKey();
    if (!ms || !selected || !expectedUserId) throw new ApiError('Sign in with your linked Microsoft account.', 401, []);
    const token = await ms.token(); if (!token || signal?.aborted) throw new ApiError('Microsoft session is unavailable.', 401, []);
    if(accountKey()!==selected)throw new ApiError('Microsoft account changed. Reopen this screen.',401,[]);
    const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',signal,credentials:'omit',headers});
    const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||accountKey()!==selected||signal?.aborted)throw new ApiError('Microsoft identity no longer matches this screen.',401,[]);
    const res = await fetch(`${this.base}/api${path}`, {method,signal,credentials:'omit',headers,body:body===undefined?undefined:JSON.stringify(body)});
    const data = await res.json().catch(()=>({}));
    if (!res.ok) { if(res.status===401) invalidateDutyContext(); if(res.status===401) window.dispatchEvent(new CustomEvent(SESSION_ENDED)); throw new ApiError('Microsoft operation could not be verified. Check your account and approved setup.',res.status,[]); }
    return data;
  }

  /** Sign in to Microsoft again for the Connections page, passing any claims challenge Microsoft sent. Leaves the page. */
  async m365Reauthenticate(claims?: string): Promise<void> {
    const { ms } = await this.ready();
    if (!ms?.account()) throw new ApiError('Sign in with your linked Microsoft account.', 401, []);
    await ms.reauthenticate(claims);
  }

  itExtractionStatus(signal?: AbortSignal) { return this.call<ExtractionStatus>('GET', '/arisha/it-extraction', undefined, signal); }
  itExtractionPreview(input: ExtractionRequest, signal?: AbortSignal) { return this.call<ExtractionPreview>('POST', '/arisha/it-extraction/preview', input, signal); }
  draftHelpStatus(signal?: AbortSignal) { return this.call<import('./draft-help').DraftHelpStatus>('GET', '/draft-help', undefined, signal); }
  draftHelpSuggest(kind: import('@prima/core').DraftHelpKind, form: unknown, signal?: AbortSignal) { return this.call<import('./draft-help').DraftHelpSuggestion>('POST', `/draft-help/${encodeURIComponent(kind)}`, { consent: 'draft-help-v1', form }, signal); }

  sharePointRequestPreview(url: string, signal?: AbortSignal) { return this.call<import('./connections').ConnectionRequestPreview>('POST', '/connections/sharepoint/requests/preview', {url}, signal); }
  async sharePointRequest(url: string, requestId: string, expectedUserId: string, signal?: AbortSignal): Promise<import('./connections').ConnectionRequestReceipt> {
    if (this.office) return (await this.officeStrict(expectedUserId, 'POST', '/connections/sharepoint/requests', { url, requestId }, null, 'setup')) as import('./connections').ConnectionRequestReceipt;
    const {ms}=await this.ready();const account=()=>ms?.account()?.homeAccountId??null;const selected=account();
    const token=await this.bearer();if(!token||!expectedUserId||selected!==account()||signal?.aborted)throw new ApiError('Sign-in changed. Reopen setup.',401,[]);
    const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',signal,credentials:'omit',headers});const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||selected!==account()||signal?.aborted)throw new ApiError('Setup identity no longer matches this screen.',401,[]);
    const res=await fetch(`${this.base}/api/connections/sharepoint/requests`,{method:'POST',signal,credentials:'omit',headers,body:JSON.stringify({url,requestId})});
    const data=await res.json().catch(()=>({}));if(!res.ok)throw new ApiError('Setup request outcome could not be verified.',res.status,[]);return data;
  }

  sharePointRequests(signal?: AbortSignal) { return this.call<Awaited<ReturnType<Api['sharePointRequests']>>>('GET', '/connections/sharepoint/requests', undefined, signal); }

  sharePointStatus(signal?: AbortSignal) {
    return this.call<SharePointStatus>('GET', '/connections/sharepoint', undefined, signal);
  }
  sharePointCheck(siteKey: string, signal?: AbortSignal) {
    return this.call<SharePointCheck>('POST', `/connections/sharepoint/${encodeURIComponent(siteKey)}/check`, {}, signal);
  }
  sharePointLibraries(siteKey: string, signal?: AbortSignal) {
    return this.call<SharePointLibraries>('GET', `/connections/sharepoint/${encodeURIComponent(siteKey)}/libraries`, undefined, signal);
  }
  sharePointItems(siteKey: string, libraryId: string, signal?: AbortSignal) {
    return this.call<SharePointItems>('GET', `/connections/sharepoint/${encodeURIComponent(siteKey)}/libraries/${encodeURIComponent(libraryId)}/items`, undefined, signal);
  }

  private q(params: Record<string, string | number | undefined>): string {
    const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
    return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
  }

  listUsers() {
    return this.call<User[]>('GET', '/auth/users');
  }
  async signIn(userId: string): Promise<Me> {
    invalidateDutyContext();
    const { token } = await this.call<{ token: string }>('POST', '/auth/dev-login', { userId });
    this.token = token;
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
    return this.me();
  }
  me() {
    return this.call<Me>('GET', '/me').then((m) => {
      this.primaOnly = m.office?.primaOnly === true;
      return m;
    });
  }
  overview() {
    return this.call<Awaited<ReturnType<Api['overview']>>>('GET', '/group/overview');
  }
  dashboard(id: string) {
    return this.call<Awaited<ReturnType<Api['dashboard']>>>('GET', `/companies/${id}/dashboard`);
  }
  sites(id: string) {
    return this.call<Awaited<ReturnType<Api['sites']>>>('GET', `/companies/${id}/sites`);
  }
  setPatrolInterval(id: string, input: Parameters<Api['setPatrolInterval']>[1]) {
    return this.call<Awaited<ReturnType<Api['setPatrolInterval']>>>('POST', `/sites/${id}/patrol-interval`, input);
  }
  site(id: string) {
    return this.call<Awaited<ReturnType<Api['site']>>>('GET', `/sites/${id}`);
  }
  people(id: string, q = '') {
    return this.call<Awaited<ReturnType<Api['people']>>>('GET', `/companies/${id}/people${this.q({ q })}`);
  }
  person(id: string) {
    return this.call<Awaited<ReturnType<Api['person']>>>('GET', `/people/${id}`);
  }
  myDuty() {
    return this.call<Awaited<ReturnType<Api['myDuty']>>>('GET', '/me/duty');
  }
  myStaffClock() {
    return this.call<Awaited<ReturnType<Api['myStaffClock']>>>('GET', '/me/clock');
  }
  confidentiality() {
    return this.call<Awaited<ReturnType<Api['confidentiality']>>>('GET', '/me/confidentiality');
  }
  acceptConfidentiality() {
    return this.call<unknown>('POST', '/me/confidentiality', {});
  }
  staffSessionStart() {
    return this.call<unknown>('POST', '/me/clock/session-start', {});
  }
  staffSessionEnd() {
    return this.call<unknown>('POST', '/me/clock/session-end', {});
  }
  myFace() {
    return this.call<Awaited<ReturnType<Api['myFace']>>>('GET', '/me/face');
  }
  registerFace(input: { photo: string; descriptor: number[] }) {
    return this.call('POST', '/me/face', input);
  }
  staffFaceCheck(input: Parameters<Api['staffFaceCheck']>[0]) {
    return this.call('POST', '/me/clock/face', input);
  }
  faceChallenge() {
    return this.call<Awaited<ReturnType<Api['faceChallenge']>>>('POST', '/me/face/challenge', {});
  }
  staffFaceCheckFrames(input: { token: string; frames: string[]; capturedAt: string }) {
    return this.call('POST', '/me/clock/face', input);
  }
  faceReviews() {
    return this.call<Awaited<ReturnType<Api['faceReviews']>>>('GET', '/hr/faces');
  }
  decideFace(personId: string, approve: boolean, note: string) {
    return this.call('POST', `/hr/faces/${encodeURIComponent(personId)}/decide`, { approve, note });
  }
  removeFace(personId: string, note: string) {
    return this.call('POST', `/hr/faces/${encodeURIComponent(personId)}/remove`, { note });
  }
  publicHolidays(year?: string) {
    return this.call<Awaited<ReturnType<Api['publicHolidays']>>>('GET', `/hr/holidays${year ? `?year=${encodeURIComponent(year)}` : ''}`);
  }
  addPublicHoliday(input: Parameters<Api['addPublicHoliday']>[0]) {
    return this.call('POST', '/hr/holidays', input);
  }
  removePublicHoliday(id: string, note: string) {
    return this.call('POST', `/hr/holidays/${encodeURIComponent(id)}/remove`, { note });
  }
  hrLeaveSettings() {
    return this.call<Awaited<ReturnType<Api['hrLeaveSettings']>>>('GET', '/hr/leave-settings');
  }
  setLeaveOverride(personId: string, kind: Parameters<Api['setLeaveOverride']>[1], days: number | null, note: string) {
    return this.call('POST', `/hr/people/${encodeURIComponent(personId)}/leave-days`, { kind, days, note });
  }
  setWfhAllowed(personId: string, allow: boolean, note: string) {
    return this.call('POST', `/hr/people/${encodeURIComponent(personId)}/wfh`, { allow, note });
  }
  flexRequests() {
    return this.call<Awaited<ReturnType<Api['flexRequests']>>>('GET', '/flex');
  }
  requestFlex(input: Parameters<Api['requestFlex']>[0]) {
    return this.call('POST', '/flex', input);
  }
  decideFlex(id: string, approve: boolean, note: string) {
    return this.call('POST', `/flex/${encodeURIComponent(id)}/decide`, { approve, note });
  }
  hrCases(personId?: string) {
    return this.call<Awaited<ReturnType<Api['hrCases']>>>('GET', `/hr/cases${personId ? `?personId=${encodeURIComponent(personId)}` : ''}`);
  }
  openHrCase(input: Parameters<Api['openHrCase']>[0]) {
    return this.call('POST', '/hr/cases', input);
  }
  hrCaseStep(id: string, input: Parameters<Api['hrCaseStep']>[1]) {
    return this.call('POST', `/hr/cases/${encodeURIComponent(id)}/steps`, input);
  }
  officeOsh() {
    return this.call<Awaited<ReturnType<Api['officeOsh']>>>('GET', '/hr/osh');
  }
  appointOshCoordinator(input: Parameters<Api['appointOshCoordinator']>[0]) {
    return this.call('POST', '/hr/osh/coordinator', input);
  }
  recordOfficeAssessment(input: Parameters<Api['recordOfficeAssessment']>[0]) {
    return this.call('POST', '/hr/osh/assessments', input);
  }
  reportOshIncident(input: Parameters<Api['reportOshIncident']>[0]) {
    return this.call('POST', '/hr/osh/incidents', input);
  }
  recordOshReport(id: string, input: Parameters<Api['recordOshReport']>[1]) {
    return this.call('POST', `/hr/osh/incidents/${encodeURIComponent(id)}/report`, input);
  }
  guardTraining() {
    return this.call<Awaited<ReturnType<Api['guardTraining']>>>('GET', '/hr/guard-training');
  }
  recordGuardPaper(input: Parameters<Api['recordGuardPaper']>[0]) {
    return this.call('POST', '/hr/guard-training/papers', input);
  }
  groupHistoryBoard() {
    return this.call<Awaited<ReturnType<Api['groupHistoryBoard']>>>('GET', '/hr/history/board');
  }
  groupHistory(personId: string) {
    return this.call<Awaited<ReturnType<Api['groupHistory']>>>('GET', `/hr/history/person/${encodeURIComponent(personId)}`);
  }
  historyLookup(input: Parameters<Api['historyLookup']>[0]) {
    return this.call<Awaited<ReturnType<Api['historyLookup']>>>('POST', '/hr/history/lookup', input);
  }
  markByLookup(input: Parameters<Api['markByLookup']>[0]) {
    return this.call<Awaited<ReturnType<Api['markByLookup']>>>('POST', '/hr/history/mark', input);
  }
  linkExistingRecords() {
    return this.call<Awaited<ReturnType<Api['linkExistingRecords']>>>('POST', '/hr/history/link-existing', {});
  }
  setRehire(input: Parameters<Api['setRehire']>[0]) {
    return this.call('POST', '/hr/history/rehire', input);
  }
  linkHistory(input: Parameters<Api['linkHistory']>[0]) {
    return this.call('POST', '/hr/history/link', input);
  }
  separateHistory(input: Parameters<Api['separateHistory']>[0]) {
    return this.call('POST', '/hr/history/separate', input);
  }
  addOldEmployment(input: Parameters<Api['addOldEmployment']>[0]) {
    return this.call('POST', '/hr/history/old-employment', input);
  }
  carryHistoryPaper(input: Parameters<Api['carryHistoryPaper']>[0]) {
    return this.call('POST', '/hr/history/carry-paper', input);
  }
  trainingRecords(personId?: string) {
    return this.call<Awaited<ReturnType<Api['trainingRecords']>>>('GET', `/hr/training${personId ? `?personId=${encodeURIComponent(personId)}` : ''}`);
  }
  recordTraining(input: Parameters<Api['recordTraining']>[0]) {
    return this.call('POST', '/hr/training', input);
  }
  appraisals() {
    return this.call<Awaited<ReturnType<Api['appraisals']>>>('GET', '/hr/appraisals');
  }
  openAppraisal(input: Parameters<Api['openAppraisal']>[0]) {
    return this.call('POST', '/hr/appraisals', input);
  }
  rateAppraisal(id: string, input: Parameters<Api['rateAppraisal']>[1]) {
    return this.call('POST', `/hr/appraisals/${encodeURIComponent(id)}/rate`, input);
  }
  commentAppraisal(id: string, comment: string) {
    return this.call('POST', `/hr/appraisals/${encodeURIComponent(id)}/comment`, { comment });
  }
  closeAppraisal(id: string, note: string) {
    return this.call('POST', `/hr/appraisals/${encodeURIComponent(id)}/close`, { note });
  }
  hrPolicies() {
    return this.call<Awaited<ReturnType<Api['hrPolicies']>>>('GET', '/hr/policies');
  }
  publishPolicy(input: Parameters<Api['publishPolicy']>[0]) {
    return this.call('POST', '/hr/policies', input);
  }
  acknowledgePolicy(id: string, lang?: StaffLangId | null) {
    return this.call('POST', `/hr/policies/${encodeURIComponent(id)}/acknowledge`, lang ? { lang } : {});
  }
  recordBriefingAcks(policyId: string, personIds: string[], ref: string, lang?: StaffLangId | null) {
    return this.call<{ recorded: number }>('POST', `/hr/policies/${encodeURIComponent(policyId)}/briefing`, { personIds, ref, ...(lang ? { lang } : {}) });
  }
  addPolicyCopy(policyId: string, input: PolicyCopyInput) {
    return this.call('POST', `/hr/policies/${encodeURIComponent(policyId)}/copies`, input);
  }
  setMotherTongue(personId: string, lang: StaffLangId) {
    return this.call('POST', `/hr/people/${encodeURIComponent(personId)}/mother-tongue`, { lang });
  }
  disciplineAppeals() {
    return this.call<DisciplineAppeals>('GET', '/discipline/appeals');
  }
  lodgeDisciplineAppeal(followUpId: string, input: { grounds: string; lang?: StaffLangId | null }) {
    return this.call('POST', `/discipline/${encodeURIComponent(followUpId)}/appeal`, input);
  }
  decideDisciplineAppeal(followUpId: string, input: DisciplineAppealDecision) {
    return this.call('POST', `/discipline/${encodeURIComponent(followUpId)}/appeal/decide`, input);
  }
  screening() {
    return this.call<Awaited<ReturnType<Api['screening']>>>('GET', '/hr/screening');
  }
  screeningAct(action: 'open' | 'check' | 'decide' | 'withdraw' | 'vettingResult' | 'employmentEnded', body: Record<string, unknown>) {
    return this.call('POST', `/hr/screening/${action}`, body);
  }
  screeningRepeat(id: string) {
    return this.call('POST', `/hr/screening/${encodeURIComponent(id)}/repeat`, {});
  }
  hrLegalChecks() {
    return this.call<Awaited<ReturnType<Api['hrLegalChecks']>>>('GET', '/hr/legal');
  }
  updateHrLegalCheck(id: string, input: Parameters<Api['updateHrLegalCheck']>[1]) {
    return this.call('POST', `/hr/legal/${encodeURIComponent(id)}`, input);
  }
  staffOvertime() {
    return this.call<Awaited<ReturnType<Api['staffOvertime']>>>('GET', '/hr/overtime');
  }
  setStaffOvertime(input: Parameters<Api['setStaffOvertime']>[0]) {
    return this.call('POST', '/hr/overtime', input);
  }
  overtimePreview(input: Parameters<Api['overtimePreview']>[0]) {
    return this.call<Awaited<ReturnType<Api['overtimePreview']>>>('POST', '/hr/overtime/preview', input);
  }
  hrJoinLeave() {
    return this.call<Awaited<ReturnType<Api['hrJoinLeave']>>>('GET', '/hr/join-leave');
  }
  recordHrFiling(input: Parameters<Api['recordHrFiling']>[0]) {
    return this.call('POST', '/hr/filings', input);
  }
  eaDraft(companyId: string, year: string) {
    return this.call<Awaited<ReturnType<Api['eaDraft']>>>('GET', `/hr/ea?companyId=${encodeURIComponent(companyId)}&year=${encodeURIComponent(year)}`);
  }
  employeeRegister(companyId: string) {
    return this.call<Awaited<ReturnType<Api['employeeRegister']>>>('GET', `/hr/register?companyId=${encodeURIComponent(companyId)}`);
  }
  decideProbation(personId: string, decision: 'confirm' | 'extend', newEndsOn: string | null, note: string) {
    return this.call('POST', `/hr/people/${encodeURIComponent(personId)}/probation`, { decision, newEndsOn, note });
  }
  leavingGuide(personId: string) {
    return this.call<Awaited<ReturnType<Api['leavingGuide']>>>('GET', `/hr/people/${encodeURIComponent(personId)}/leaving-guide`);
  }
  vacancies() {
    return this.call<Awaited<ReturnType<Api['vacancies']>>>('GET', '/vacancies');
  }
  staffMovements() {
    return this.call<Awaited<ReturnType<Api['staffMovements']>>>('GET', '/hr/movements');
  }
  prepareStaffMovement(input: Parameters<Api['prepareStaffMovement']>[0]) {
    return this.call('POST', '/hr/movements', input);
  }
  staffMovementStep(id: string, approve: boolean, note: string) {
    return this.call('POST', `/hr/movements/${encodeURIComponent(id)}/step`, { approve, note });
  }
  cancelStaffMovement(id: string, note: string) {
    return this.call('POST', `/hr/movements/${encodeURIComponent(id)}/cancel`, { note });
  }
  authoriseMovementLogin(id: string, approve: boolean, note: string) {
    return this.call('POST', `/hr/movements/${encodeURIComponent(id)}/login/authorise`, { approve, note });
  }
  loginHandovers() {
    return this.call<Awaited<ReturnType<Api['loginHandovers']>>>('GET', '/login-handovers');
  }
  confirmMovementLogin(id: string, note: string) {
    return this.call('POST', `/hr/movements/${encodeURIComponent(id)}/login/confirm`, { note });
  }
  applyStaffMovement(id: string) {
    return this.call('POST', `/hr/movements/${encodeURIComponent(id)}/apply`, {});
  }
  applyDueStaffMovements() {
    return this.call<Awaited<ReturnType<Api['applyDueStaffMovements']>>>('POST', '/hr/movements/apply-due', {});
  }
  allowanceTypes() {
    return this.call<Awaited<ReturnType<Api['allowanceTypes']>>>('GET', '/hr/allowances');
  }
  saveAllowanceType(input: Parameters<Api['saveAllowanceType']>[0]) {
    return this.call('POST', '/hr/allowances/types', input);
  }
  requestAllowanceChange(personId: string, input: Parameters<Api['requestAllowanceChange']>[1]) {
    return this.call('POST', `/hr/allowances/staff/${encodeURIComponent(personId)}`, input);
  }
  raiseVacancy(input: Parameters<Api['raiseVacancy']>[0]) {
    return this.call('POST', '/vacancies', input);
  }
  vacancyStep(id: string, action: Parameters<Api['vacancyStep']>[1], note: string) {
    return this.call('POST', `/vacancies/${encodeURIComponent(id)}/${action}`, { note });
  }
  advertStep(id: string, action: Parameters<Api['advertStep']>[1], input: Parameters<Api['advertStep']>[2]) {
    return this.call('POST', `/vacancies/${encodeURIComponent(id)}/advert/${action}`, input);
  }
  applicants(vacancyId: string) {
    return this.call<Awaited<ReturnType<Api['applicants']>>>('GET', `/vacancies/${encodeURIComponent(vacancyId)}/applicants`);
  }
  addApplicant(vacancyId: string, input: Parameters<Api['addApplicant']>[1]) {
    return this.call('POST', `/vacancies/${encodeURIComponent(vacancyId)}/applicants`, input);
  }
  applicantStep(id: string, status: Parameters<Api['applicantStep']>[1], note: string, interviewAt: string | null) {
    return this.call('POST', `/applicants/${encodeURIComponent(id)}/${status}`, { note, interviewAt });
  }
  staffClockIn(input: Parameters<Api['staffClockIn']>[0]) {
    return this.call('POST', '/me/clock/in', input);
  }
  staffClockOut(input: Parameters<Api['staffClockOut']>[0]) {
    return this.call('POST', '/me/clock/out', input);
  }
  staffPing(input: Parameters<Api['staffPing']>[0]) {
    return this.call('POST', '/me/clock/ping', input);
  }
  staffPings(readings: Parameters<Api['staffPings']>[0], notes?: Parameters<Api['staffPings']>[1]) {
    return this.call<{ accepted: number; skipped: number; notes?: number }>('POST', '/me/clock/pings', notes?.length ? { readings, notes } : { readings });
  }
  clockPhotoReviews() {
    return this.call<Awaited<ReturnType<Api['clockPhotoReviews']>>>('GET', '/staff-clock-photos');
  }
  decideClockPhoto(id: string, decision: 'cleared' | 'upheld', note: string) {
    return this.call('POST', `/staff-clock-photos/${encodeURIComponent(id)}`, { decision, note });
  }
  // P81: staff check-in by place (apps/api/src/checkin.controller.ts).
  // P90: the owner's test check-in (owner only; the server refuses anyone else).
  myTestCheckins() {
    return this.call<Awaited<ReturnType<Api['myTestCheckins']>>>('GET', '/me/test-checkin');
  }
  testCheckin(step: 'in' | 'ping' | 'out', fix: Parameters<Api['testCheckin']>[1]) {
    return this.call<unknown>('POST', `/me/test-checkin/${step}`, fix);
  }
  myCheckin() {
    return this.call<Awaited<ReturnType<Api['myCheckin']>>>('GET', '/me/checkin');
  }
  checkinPreview(fix: Parameters<Api['checkinPreview']>[0]) {
    return this.call<Awaited<ReturnType<Api['checkinPreview']>>>('POST', '/me/checkin/preview', fix);
  }
  checkIn(kind: 'in' | 'out', input: Parameters<Api['checkIn']>[1]) {
    return this.call<Awaited<ReturnType<Api['checkIn']>>>('POST', `/me/checkin/${kind}`, input);
  }
  checkinSetup() {
    return this.call<Awaited<ReturnType<Api['checkinSetup']>>>('GET', '/checkin/setup');
  }
  saveCheckinPlace(input: Parameters<Api['saveCheckinPlace']>[0]) {
    return this.call('POST', '/checkin/places', input);
  }
  setCheckinPlaceActive(id: string, active: boolean) {
    return this.call('POST', `/checkin/places/${encodeURIComponent(id)}/active`, { active });
  }
  setCheckinPolicy(companyId: string, outOfArea: Parameters<Api['setCheckinPolicy']>[1]) {
    return this.call('POST', '/checkin/policy', { companyId, outOfArea });
  }
  setCheckinRules(userIds: string[], rule: Parameters<Api['setCheckinRules']>[1]) {
    return this.call<{ updated: number }>('POST', '/checkin/rules', { userIds, rule });
  }
  checkinSites(companyId: string) {
    return this.call<Awaited<ReturnType<Api['checkinSites']>>>('GET', `/checkin/sites?companyId=${encodeURIComponent(companyId)}`);
  }
  checkinDay(date?: string) {
    return this.call<Awaited<ReturnType<Api['checkinDay']>>>('GET', `/checkin/day${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  }
  checkinReviews() {
    return this.call<Awaited<ReturnType<Api['checkinReviews']>>>('GET', '/checkin/reviews');
  }
  decideCheckin(id: string, decision: 'cleared' | 'upheld', note: string) {
    return this.call('POST', `/checkin/reviews/${encodeURIComponent(id)}`, { decision, note });
  }
  geoSearch(q: string) {
    return this.call<Awaited<ReturnType<Api['geoSearch']>>>('GET', `/geo/search?q=${encodeURIComponent(q)}`);
  }
  geoReverse(lat: number, lng: number) {
    return this.call<Awaited<ReturnType<Api['geoReverse']>>>('GET', `/geo/reverse?lat=${lat}&lng=${lng}`);
  }
  staffClockBoard(date?: string) {
    return this.call<Awaited<ReturnType<Api['staffClockBoard']>>>('GET', `/staff-clock${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  }
  myRemote() {
    return this.call<Awaited<ReturnType<Api['myRemote']>>>('GET', '/me/remote');
  }
  remoteApply(input: Parameters<Api['remoteApply']>[0]) {
    return this.call('POST', '/me/remote/apply', input);
  }
  remotePlan(tasks: string[]) {
    return this.call('POST', '/me/remote/plan', { tasks });
  }
  remoteTask(taskId: string, done: boolean, output: string) {
    return this.call('POST', `/me/remote/tasks/${encodeURIComponent(taskId)}`, { done, output });
  }
  remoteCheckIn(note: string) {
    return this.call('POST', '/me/remote/check-in', { note });
  }
  remoteReport(input: { summary: string; blockers: string }) {
    return this.call('POST', '/me/remote/report', input);
  }
  remoteBoard() {
    return this.call<Awaited<ReturnType<Api['remoteBoard']>>>('GET', '/remote');
  }
  remoteDecide(id: string, approve: boolean, note: string) {
    return this.call('POST', `/remote/${encodeURIComponent(id)}/decide`, { approve, note });
  }
  remoteEnd(id: string, note: string) {
    return this.call('POST', `/remote/${encodeURIComponent(id)}/end`, { note });
  }
  remoteReview(dayId: string, verdict: 'accepted' | 'queried', note: string) {
    return this.call('POST', `/remote-days/${encodeURIComponent(dayId)}/review`, { verdict, note });
  }
  myTimeSlips() {
    return this.call<Awaited<ReturnType<Api['myTimeSlips']>>>('GET', '/me/time-slips');
  }
  requestTimeSlip(input: { date: string; from: string; to: string; reason: string }) {
    return this.call('POST', '/me/time-slips', input);
  }
  cancelTimeSlip(id: string) {
    return this.call('POST', `/me/time-slips/${encodeURIComponent(id)}/cancel`, {});
  }
  timeSlipBoard() {
    return this.call<Awaited<ReturnType<Api['timeSlipBoard']>>>('GET', '/time-slips');
  }
  decideTimeSlip(id: string, approve: boolean, note: string) {
    return this.call('POST', `/time-slips/${encodeURIComponent(id)}/decide`, { approve, note });
  }
  seenTimeSlip(id: string) {
    return this.call('POST', `/time-slips/${encodeURIComponent(id)}/seen`, {});
  }
  setTimeSlipApprover(approver: 'head' | 'hr', note: string) {
    return this.call('POST', '/time-slips/settings', { approver, note });
  }
  myWork() {
    return this.call<Awaited<ReturnType<Api['myWork']>>>('GET', '/me/work');
  }
  workCheckIn(input: Parameters<Api['workCheckIn']>[0]) {
    return this.call('POST', '/me/work/check-in', input);
  }
  workTaskAdd(input: Parameters<Api['workTaskAdd']>[0]) {
    return this.call('POST', '/work/tasks', input);
  }
  workTaskDone(id: string, input: { note: string; ref: string }) {
    return this.call('POST', `/work/tasks/${encodeURIComponent(id)}/done`, input);
  }
  workTaskLate(id: string, input: { reason: string; newDueAt: string }) {
    return this.call('POST', `/work/tasks/${encodeURIComponent(id)}/more-time`, input);
  }
  workTaskReview(id: string, accept: boolean, note: string) {
    return this.call('POST', `/work/tasks/${encodeURIComponent(id)}/review`, { accept, note });
  }
  seenCooNotice(kind: 'work' | 'fwm', id: string, noticeId: string) {
    return this.call('POST', `/coo-notices/${kind}/${encodeURIComponent(id)}/seen`, { noticeId });
  }
  helpAsk(input: { text: string; taskId: string | null }) {
    return this.call('POST', '/me/work/help', input);
  }
  helpAnswer(id: string, text: string) {
    return this.call('POST', `/work/help/${encodeURIComponent(id)}/answer`, { text });
  }
  oneOnOneRecord(input: { userId: string; notes: string; agreed: string[] }) {
    return this.call('POST', '/work/one-on-ones', input);
  }
  playbookSignOff(userId: string) {
    return this.call('POST', `/work/people/${encodeURIComponent(userId)}/playbook-signoff`, {});
  }
  workRebalance() {
    return this.call<Awaited<ReturnType<Api['workRebalance']>>>('GET', '/work/rebalance');
  }
  workRebalanceAskAi(adviceId: string) {
    return this.call<{ text: string; source: string }>('POST', '/work/rebalance/ask-ai', { adviceId });
  }
  workTaskReassign(id: string, input: WorkReassignInput) {
    return this.call('POST', `/work/tasks/${encodeURIComponent(id)}/reassign`, input);
  }
  workTaskAdjust(id: string, input: WorkAdjustInput) {
    return this.call('POST', `/work/tasks/${encodeURIComponent(id)}/adjust`, input);
  }
  teamWork() {
    return this.call<Awaited<ReturnType<Api['teamWork']>>>('GET', '/work/team');
  }
  personWork(userId: string) {
    return this.call<Awaited<ReturnType<Api['personWork']>>>('GET', `/work/people/${encodeURIComponent(userId)}`);
  }
  workSummary() {
    return this.call<Awaited<ReturnType<Api['workSummary']>>>('GET', '/work/summary');
  }
  plannerSync() {
    return this.call('POST', '/work/planner/sync', {});
  }
  branchWork() {
    return this.call<Awaited<ReturnType<Api['branchWork']>>>('GET', '/branch-work');
  }
  branchCheckSubmit(branchId: string, input: Parameters<Api['branchCheckSubmit']>[1]) {
    return this.call('POST', `/branch-work/${encodeURIComponent(branchId)}/check`, input);
  }
  branchVisitRecord(branchId: string, input: Parameters<Api['branchVisitRecord']>[1]) {
    return this.call('POST', `/branch-work/${encodeURIComponent(branchId)}/visit`, input);
  }
  staffClockDetail(id: string) {
    return this.call<Awaited<ReturnType<Api['staffClockDetail']>>>('GET', `/staff-clock/${encodeURIComponent(id)}`);
  }
  guardProfile(id: string) {
    return this.call<Awaited<ReturnType<Api['guardProfile']>>>('GET', `/people/${id}/profile`);
  }
  leaveRequests(filter: { companyId?: string; waiting?: 'me'; status?: 'pending' | 'all' } = {}) {
    const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
    return this.call<Awaited<ReturnType<Api['leaveRequests']>>>('GET', `/leave${q ? `?${q}` : ''}`);
  }
  requestLeave(input: LeaveInput) {
    return this.call<unknown>('POST', '/leave', input);
  }
  decideLeave(id: string, approve: boolean, note: string) {
    return this.call<unknown>('POST', `/leave/${id}/decide`, { approve, note });
  }
  socsoClaims() {
    return this.call<Awaited<ReturnType<Api['socsoClaims']>>>('GET', '/socso');
  }
  socsoClaim(id: string) {
    return this.call<Awaited<ReturnType<Api['socsoClaim']>>>('GET', `/socso/${encodeURIComponent(id)}`);
  }
  startSocsoClaim(personId: string, input: Parameters<Api['startSocsoClaim']>[1]) {
    return this.call<{ id: string }>('POST', `/people/${encodeURIComponent(personId)}/socso`, input);
  }
  addSocsoDoc(id: string, item: string, proof: ProofInput[], mc?: { from: string; to: string }) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/documents`, { item, proof, mc });
  }
  overrideSocsoDoc(id: string, item: string, reason: string) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/override`, { item, reason });
  }
  setSocsoRehab(id: string, input: Parameters<Api['setSocsoRehab']>[1]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/rehab`, input);
  }
  addSocsoAppointment(id: string, input: { at: string; what: string }) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/appointments`, input);
  }
  addSocsoRestriction(id: string, input: Parameters<Api['addSocsoRestriction']>[1]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/restrictions`, input);
  }
  clearSocsoRestriction(id: string, restrictionId: string, note: string) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/restrictions/${encodeURIComponent(restrictionId)}/clear`, { note });
  }
  recordLindung(id: string, input: Parameters<Api['recordLindung']>[1]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/lindung`, input);
  }
  verifyLindung(id: string, answer: Parameters<Api['verifyLindung']>[1], note: string) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/lindung/verify`, { answer, note });
  }
  addSocsoDependant(id: string, input: Parameters<Api['addSocsoDependant']>[1]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dependants`, input);
  }
  addDependantPaper(id: string, dependantId: string, kind: 'relation' | 'translation', proof: ProofInput[]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dependants/${encodeURIComponent(dependantId)}/papers`, { kind, proof });
  }
  confirmDependantRoute(id: string, dependantId: string, input: Parameters<Api['confirmDependantRoute']>[2]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dependants/${encodeURIComponent(dependantId)}/route`, input);
  }
  recordDeathNotice(id: string, who: 'family' | 'embassy' | 'immigration', at: string) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/death-notices`, { who, at });
  }
  addDependantPayment(id: string, input: Parameters<Api['addDependantPayment']>[1]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dependant-payments`, input);
  }
  confirmDependantReceived(id: string, paymentId: string, input: { on: string; proof: ProofInput[] }) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dependant-payments/${encodeURIComponent(paymentId)}/received`, input);
  }
  assessDosh(id: string, kind: Parameters<Api['assessDosh']>[1], why: string) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dosh`, { kind, why });
  }
  recordDoshImmediate(id: string, input: Parameters<Api['recordDoshImmediate']>[1]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dosh/immediate`, input);
  }
  recordDoshForm(id: string, input: Parameters<Api['recordDoshForm']>[1]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dosh/form`, input);
  }
  recordDoshClientTold(id: string, at: string) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/dosh/client`, { at });
  }
  doshRegister(year: number) {
    return this.call<Awaited<ReturnType<Api['doshRegister']>>>('GET', `/dosh/register/${year}`);
  }
  addSocsoCheckIn(id: string, note: string) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/checkins`, { note });
  }
  workKpi(period?: string) {
    return this.call<Awaited<ReturnType<Api['workKpi']>>>('GET', `/kpi/work${period ? `?period=${encodeURIComponent(period)}` : ''}`);
  }
  fwmBoard() {
    return this.call<Awaited<ReturnType<Api['fwmBoard']>>>('GET', '/fwm');
  }
  hostelBoard() {
    return this.call<Awaited<ReturnType<Api['hostelBoard']>>>('GET', '/hostels');
  }
  addHostelBill(input: Parameters<Api['addHostelBill']>[0], proof: ProofInput[]) {
    return this.call<unknown>('POST', '/hostel-bills', { ...input, proof });
  }
  hostelBillStep(billId: string, step: 'request' | 'check' | 'approve' | 'slip', ok: boolean, note: string, proof: ProofInput[] = []) {
    return this.call<unknown>('POST', `/hostel-bills/${encodeURIComponent(billId)}/${step}`, { ok, note, proof });
  }
  decideUtilityCharge(chargeId: string, decision: 'NOTICE' | 'DEDUCTION', note: string) {
    return this.call<unknown>('POST', `/utility-charges/${encodeURIComponent(chargeId)}/decide`, { decision, note });
  }
  ackUtilityNotice(chargeId: string) {
    return this.call<unknown>('POST', `/utility-charges/${encodeURIComponent(chargeId)}/ack`, {});
  }
  fileUtilityPaper(personId: string, what: 'clause' | 'ack', proof: ProofInput[]) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/utility-paper`, { what, proof });
  }
  staffClaims() {
    return this.call<Awaited<ReturnType<Api['staffClaims']>>>('GET', '/claims');
  }
  submitStaffClaim(input: Parameters<Api['submitStaffClaim']>[0], proof: ProofInput[]) {
    return this.call<unknown>('POST', '/claims', { ...input, proof });
  }
  myReceipts() {
    return this.call<Awaited<ReturnType<Api['myReceipts']>>>('GET', '/claims/receipts');
  }
  addReceipts(proof: ProofInput[], reads: unknown[] = []) {
    return this.call<unknown>('POST', '/claims/receipts', { proof, reads });
  }
  receiptAction(id: string, action: 'confirm' | 'remove', input: Parameters<Api['receiptAction']>[2]) {
    return this.call<unknown>('POST', `/claims/receipts/${encodeURIComponent(id)}/${action}`, input);
  }
  headVerifyClaim(claimId: string, ok: boolean, note: string) {
    return this.call<unknown>('POST', `/claims/${encodeURIComponent(claimId)}/head`, { ok, note });
  }
  decideStaffClaim(claimId: string, by: 'cos' | 'hr' | 'coo' | 'finance', ok: boolean, note: string) {
    return this.call<unknown>('POST', `/claims/${encodeURIComponent(claimId)}/decide`, { by, ok, note });
  }
  setClaimRate(month: string, vehicle: 'CAR' | 'MOTORCYCLE' | 'COMPANY_CAR', perKm: number) {
    return this.call<unknown>('POST', '/claim-rates', { month, vehicle, perKm });
  }
  productBoard() {
    return this.call<Awaited<ReturnType<Api['productBoard']>>>('GET', '/products');
  }
  saveProduct(input: ProductInput) {
    return this.call<unknown>('POST', '/products', input);
  }
  saveProductCert(productId: string, input: ProductCertInput, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/products/${encodeURIComponent(productId)}/certs`, { ...input, proof });
  }
  proposalReadiness(productIds: string[]) {
    return this.call<Awaited<ReturnType<Api['proposalReadiness']>>>('POST', '/proposal-check', { productIds });
  }
  clientInvoice(accountId: string, period: string, channel: 'hand' | 'email' | 'portal', amount: number | null, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/invoice`, { period, channel, amount, proof });
  }
  clientWorkAck(accountId: string, input: ClientWorkAckInput) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/work-ack`, input);
  }
  setInvoicePortal(accountId: string, portal: string | null) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/portal`, { portal });
  }
  clientShareLinks(accountId: string) {
    return this.call<Awaited<ReturnType<Api['clientShareLinks']>>>('GET', `/clients/${encodeURIComponent(accountId)}/share-links`);
  }
  createClientShareLink(accountId: string, input: { recipient: string; from: string; to: string; days: number }) {
    return this.call<Awaited<ReturnType<Api['createClientShareLink']>>>('POST', `/clients/${encodeURIComponent(accountId)}/share-links`, input);
  }
  revokeClientShareLink(accountId: string, linkId: string, reason: string) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/share-links/${encodeURIComponent(linkId)}/revoke`, { reason });
  }
  previewClientShareLink(accountId: string, linkId: string) {
    return this.call<Awaited<ReturnType<Api['previewClientShareLink']>>>('GET', `/clients/${encodeURIComponent(accountId)}/share-links/${encodeURIComponent(linkId)}/preview`);
  }
  expenseBoard() {
    return this.call<Awaited<ReturnType<Api['expenseBoard']>>>('GET', '/requests');
  }
  prefillOfficeRequest(input: Parameters<Api['prefillOfficeRequest']>[0]) {
    return this.call<unknown>('POST', '/expenses/prefill', input);
  }
  saveExpense(input: ExpenseInput, proof: ProofInput[]) {
    return this.call<unknown>('POST', '/requests', { ...input, proof });
  }
  submitExpense(id: string) {
    return this.call<unknown>('POST', `/requests/${encodeURIComponent(id)}/submit`, {});
  }
  decideExpense(id: string, decision: 'approve' | 'return' | 'reject', note: string) {
    return this.call<unknown>('POST', `/requests/${encodeURIComponent(id)}/decide`, { decision, note });
  }
  expenseDocs(id: string) {
    return this.call<EvidenceDoc[]>('GET', `/requests/${encodeURIComponent(id)}/docs`);
  }
  amBoard() {
    return this.call<Awaited<ReturnType<Api['amBoard']>>>('GET', '/assets');
  }
  branchBoard() {
    return this.call<Awaited<ReturnType<Api['branchBoard']>>>('GET', '/branches');
  }
  branchJv(branchId: string) {
    return this.call<Awaited<ReturnType<Api['branchJv']>>>('GET', `/branches/${encodeURIComponent(branchId)}/jv`);
  }
  creditBoard() {
    return this.call<Awaited<ReturnType<Api['creditBoard']>>>('GET', '/credit');
  }
  runCreditCheck() {
    return this.call<{ opened: number; checkedOn: string }>('POST', '/credit/check', {});
  }
  creditDecide(id: string, action: Parameters<Api['creditDecide']>[1], note: string) {
    return this.call<unknown>('POST', `/credit/cases/${encodeURIComponent(id)}/${action}`, { note });
  }
  creditEnforcementStep(id: string, no: number, note: string) {
    return this.call<unknown>('POST', `/credit/cases/${encodeURIComponent(id)}/steps/${no}`, { note });
  }
  creditRepayment(loanId: string, no: number, amount: number, bankRef: string, paidOn: string) {
    return this.call<unknown>('POST', `/credit/loans/${encodeURIComponent(loanId)}/repayments`, { no, amount, bankRef, paidOn });
  }
  creditStamped(loanId: string, ref: string, on: string) {
    return this.call<unknown>('POST', `/credit/loans/${encodeURIComponent(loanId)}/stamped`, { ref, on });
  }
  creditCorrectCollateral(loanId: string, kind: Parameters<Api['creditCorrectCollateral']>[1], agreementRef: string | null, reason: string) {
    return this.call<unknown>('POST', `/credit/loans/${encodeURIComponent(loanId)}/collateral`, { kind, agreementRef, reason });
  }
  creditCorrectRecord(loanId: string, input: Parameters<Api['creditCorrectRecord']>[1]) {
    return this.call<unknown>('POST', `/credit/loans/${encodeURIComponent(loanId)}/correct`, input);
  }
  creditChargeLodged(loanId: string, ssmRef: string, lodgedOn: string) {
    return this.call<unknown>('POST', `/credit/loans/${encodeURIComponent(loanId)}/charge`, { ssmRef, lodgedOn });
  }
  creditDispute(loanId: string, action: 'raise' | 'close', note: string) {
    return this.call<unknown>('POST', `/credit/loans/${encodeURIComponent(loanId)}/dispute/${action}`, { note });
  }
  addCreditLoan(companyId: string, input: Parameters<Api['addCreditLoan']>[1]) {
    return this.call<unknown>('POST', `/credit/${encodeURIComponent(companyId)}/loans`, input);
  }
  actBoard() {
    return this.call<Awaited<ReturnType<Api['actBoard']>>>('GET', '/act');
  }
  raiseActFinding(input: Parameters<Api['raiseActFinding']>[0]) {
    return this.call<unknown>('POST', '/act/findings', input);
  }
  actFindingStep(id: string, action: Parameters<Api['actFindingStep']>[1], body: Parameters<Api['actFindingStep']>[2]) {
    return this.call<unknown>('POST', `/act/findings/${encodeURIComponent(id)}/${action}`, body);
  }
  recordActAudit(input: Parameters<Api['recordActAudit']>[0]) {
    return this.call<unknown>('POST', '/act/audits', input);
  }
  assignActWork(input: Parameters<Api['assignActWork']>[0]) {
    return this.call<unknown>('POST', '/act/work', input);
  }
  setActReportForm(input: Parameters<Api['setActReportForm']>[0]) {
    return this.call<unknown>('POST', '/act/report-form', input);
  }
  setActTiming(input: Parameters<Api['setActTiming']>[0]) {
    return this.call<unknown>('POST', '/act/timing', input);
  }
  recordActFieldCheck(input: Parameters<Api['recordActFieldCheck']>[0]) {
    return this.call<unknown>('POST', '/act/field-checks', input);
  }
  openActInvestigation(input: Parameters<Api['openActInvestigation']>[0]) {
    return this.call<unknown>('POST', '/act/investigations', input);
  }
  addActEvidence(id: string, input: Parameters<Api['addActEvidence']>[1]) {
    return this.call<unknown>('POST', `/act/investigations/${encodeURIComponent(id)}/evidence`, input);
  }
  actEvidence(id: string, evidenceId: string) {
    return this.call<Awaited<ReturnType<Api['actEvidence']>>>('GET', `/act/investigations/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}`);
  }
  actInvestigationStep(id: string, input: Parameters<Api['actInvestigationStep']>[1]) {
    return this.call<unknown>('POST', `/act/investigations/${encodeURIComponent(id)}/${input.action}`, input);
  }
  addActImprovement(input: Parameters<Api['addActImprovement']>[0]) {
    return this.call<unknown>('POST', '/act/improvements', input);
  }
  actImprovementStep(id: string, action: Parameters<Api['actImprovementStep']>[1], body: Parameters<Api['actImprovementStep']>[2]) {
    return this.call<unknown>('POST', `/act/improvements/${encodeURIComponent(id)}/${action}`, body);
  }
  fixedAssets() {
    return this.call<Awaited<ReturnType<Api['fixedAssets']>>>('GET', '/assets/fixed');
  }
  postDepreciation(ownerEntity: string, period: string, sqlRef: string) {
    return this.call<unknown>('POST', '/assets/depreciation', { ownerEntity, period, sqlRef });
  }
  amDisposalStep(id: string, action: Parameters<Api['amDisposalStep']>[1], body: Parameters<Api['amDisposalStep']>[2]) {
    return this.call<unknown>('POST', `/assets/${encodeURIComponent(id)}/disposal/${action}`, body);
  }
  payChanges() {
    return this.call<Awaited<ReturnType<Api['payChanges']>>>('GET', '/pay-changes');
  }
  decidePayChange(id: string, verify: boolean, note: string) {
    return this.call<unknown>('POST', `/pay-changes/${encodeURIComponent(id)}/${verify ? 'verify' : 'reject'}`, { note });
  }
  payFormulaBoard() {
    return this.call<Awaited<ReturnType<Api['payFormulaBoard']>>>('GET', '/pay-formulas');
  }
  payFormulaAt(input: Parameters<Api['payFormulaAt']>[0]) {
    const q = new URLSearchParams({ kind: input.kind });
    if (input.siteId) q.set('siteId', input.siteId);
    if (input.companyId) q.set('companyId', input.companyId);
    if (input.regionId) q.set('regionId', input.regionId);
    if (input.month) q.set('month', input.month);
    return this.call<Awaited<ReturnType<Api['payFormulaAt']>>>('GET', `/pay-formulas/at?${q.toString()}`);
  }
  savePayFormula(input: Parameters<Api['savePayFormula']>[0]) {
    return this.call<unknown>('POST', '/pay-formulas', input);
  }
  decidePayFormula(id: string, approve: boolean, note: string) {
    return this.call<unknown>('POST', `/pay-formulas/${encodeURIComponent(id)}/decide`, { approve, note });
  }
  withdrawPayFormula(id: string) {
    return this.call<unknown>('POST', `/pay-formulas/${encodeURIComponent(id)}/withdraw`, {});
  }
  setPayFormulaUse(input: Parameters<Api['setPayFormulaUse']>[0]) {
    return this.call<unknown>('POST', '/pay-formula-uses', input);
  }
  savePayLaw(input: Parameters<Api['savePayLaw']>[0]) {
    return this.call<unknown>('POST', '/pay-law', input);
  }
  siteHoursBoard(input: Parameters<Api['siteHoursBoard']>[0]) {
    const q = new URLSearchParams();
    if (input.companyId) q.set('companyId', input.companyId);
    if (input.month) q.set('month', input.month);
    return this.call<Awaited<ReturnType<Api['siteHoursBoard']>>>('GET', `/site-hours?${q.toString()}`);
  }
  approveSiteHours(input: Parameters<Api['approveSiteHours']>[0]) {
    return this.call<unknown>('POST', '/site-hours/approve', input);
  }
  publicHolidayBoard(input: Parameters<Api['publicHolidayBoard']>[0]) {
    const q = new URLSearchParams();
    if (input.companyId) q.set('companyId', input.companyId);
    if (input.year) q.set('year', String(input.year));
    return this.call<Awaited<ReturnType<Api['publicHolidayBoard']>>>('GET', `/public-holidays?${q.toString()}`);
  }
  setPublicHolidays(input: Parameters<Api['setPublicHolidays']>[0]) {
    return this.call<unknown>('POST', '/public-holidays', input);
  }
  recordKinds() {
    return this.call<Awaited<ReturnType<Api['recordKinds']>>>('GET', '/records/kinds');
  }
  arishaSummary(input: Parameters<Api['arishaSummary']>[0]) {
    return this.call<Awaited<ReturnType<Api['arishaSummary']>>>('POST', '/arisha/summary', input);
  }
  arishaFinanceOptions(companyId: string | null) {
    return this.call<Awaited<ReturnType<Api['arishaFinanceOptions']>>>('POST', '/arisha/finance-options', { companyId });
  }
  arishaPrepareFinance(input: Record<string, unknown>) {
    return this.call<Awaited<ReturnType<Api['arishaPrepareFinance']>>>('POST', '/arisha/prepare-finance', input);
  }
  arishaDraftForm(kind: Parameters<Api['arishaDraftForm']>[0], companyId: string | null) {
    return this.call<Awaited<ReturnType<Api['arishaDraftForm']>>>('GET', `/arisha/draft-form?${new URLSearchParams({ kind, ...(companyId ? { companyId } : {}) })}`);
  }
  arishaPrepare(input: Record<string, unknown>) {
    return this.call<Awaited<ReturnType<Api['arishaPrepare']>>>('POST', '/arisha/prepare', input);
  }
  arishaDrafts() { return this.call<Awaited<ReturnType<Api['arishaDrafts']>>>('GET', '/arisha/drafts'); }
  arishaFinancePapers(companyId: string) {
    return this.call<Awaited<ReturnType<Api['arishaFinancePapers']>>>('GET', `/arisha/finance-papers?${new URLSearchParams({ companyId })}`);
  }
  arishaSubmit(payload: Parameters<Api['arishaSubmit']>[0], companyId: string | null) {
    return this.call<Awaited<ReturnType<Api['arishaSubmit']>>>('POST', '/arisha/drafts', { payload, companyId });
  }
  arishaCommit(id: string, version: number) {
    return this.call<Awaited<ReturnType<Api['arishaCommit']>>>('POST', `/arisha/drafts/${encodeURIComponent(id)}/commit`, { version });
  }
  arishaResubmit(id: string, version: number) {
    return this.call<Awaited<ReturnType<Api['arishaResubmit']>>>('POST', `/arisha/drafts/${encodeURIComponent(id)}/resubmit`, { version });
  }
  arishaReturn(id: string, version: number) {
    return this.call<Awaited<ReturnType<Api['arishaReturn']>>>('POST', `/arisha/drafts/${encodeURIComponent(id)}/return`, { version });
  }
  arishaStatus() {
    return this.call<{ enabled: boolean }>('GET', '/arisha');
  }
  arisha(input: Parameters<Api['arisha']>[0], signal?: AbortSignal) {
    return this.call<Awaited<ReturnType<Api['arisha']>>>('POST', '/arisha', input, signal);
  }
  recordForm(kind: Parameters<Api['recordForm']>[0], id: string | null, companyId: string | null) {
    const q = new URLSearchParams();
    if (id) q.set('id', id);
    if (companyId) q.set('companyId', companyId);
    return this.call<Awaited<ReturnType<Api['recordForm']>>>('GET', `/records/${kind}/form?${q}`);
  }
  saveRecord(kind: Parameters<Api['saveRecord']>[0], id: string | null, companyId: string | null, values: Parameters<Api['saveRecord']>[3]) {
    return this.call<unknown>('POST', `/records/${kind}`, { id, companyId, values });
  }
  amRecordPayment(unitId: string, input: Parameters<Api['amRecordPayment']>[1]) {
    return this.call<unknown>('POST', `/asset-units/${encodeURIComponent(unitId)}/payments`, input);
  }
  amReversePayment(unitId: string, paymentId: string, reason: string) {
    return this.call<unknown>('POST', `/asset-units/${encodeURIComponent(unitId)}/payments/${encodeURIComponent(paymentId)}/reverse`, { reason });
  }
  amBankCash(unitId: string, paymentId: string, input: { on: string; slipRef: string }) {
    return this.call<unknown>('POST', `/asset-units/${encodeURIComponent(unitId)}/payments/${encodeURIComponent(paymentId)}/bank`, input);
  }
  amFollowUp(unitId: string, input: Parameters<Api['amFollowUp']>[1]) {
    return this.call<unknown>('POST', `/asset-units/${encodeURIComponent(unitId)}/follow-ups`, input);
  }
  amDecideLetter(unitId: string, followUpId: string, approve: boolean, note: string) {
    return this.call<unknown>(
      'POST',
      `/asset-units/${encodeURIComponent(unitId)}/follow-ups/${encodeURIComponent(followUpId)}/${approve ? 'approve' : 'stop'}`,
      { note },
    );
  }
  amBq(workOrderId: string) {
    return this.call<Awaited<ReturnType<Api['amBq']>>>('GET', `/assets/work-orders/${encodeURIComponent(workOrderId)}/bq`);
  }
  amBqAction(workOrderId: string, input: AmBqActionInput) {
    const base = `/assets/work-orders/${encodeURIComponent(workOrderId)}`;
    switch (input.kind) {
      case 'brief': {
        const { kind: _k, ...body } = input;
        return this.call<unknown>('POST', `${base}/bq/brief`, body);
      }
      case 'draft':
        return this.call<unknown>('POST', `${base}/bq/draft`, { jobKind: input.jobKind, measurements: input.measurements });
      case 'save': {
        const { kind: _k, ...body } = input;
        return this.call<unknown>('POST', `${base}/bq`, body);
      }
      case 'submit':
        return this.call<unknown>('POST', `${base}/bq/submit`, {});
      case 'reopen':
        return this.call<unknown>('POST', `${base}/bq/reopen`, { reason: input.reason });
      case 'decide':
        return this.call<unknown>('POST', `${base}/bq/${input.approve ? 'approve' : 'return'}`, { note: input.note });
      case 'quote':
        return this.call<unknown>('POST', `${base}/quotes`, input.quote);
      case 'award':
        return this.call<unknown>('POST', `${base}/award`, { quoteId: input.quoteId, reason: input.reason });
      case 'awardDecide':
        return this.call<unknown>('POST', `${base}/award/${input.approve ? 'approve' : 'reject'}`, { note: input.note });
      case 'vo': {
        const { kind: _k, ...body } = input;
        return this.call<unknown>('POST', `${base}/variations`, body);
      }
      case 'voWithdraw':
        return this.call<unknown>('POST', `${base}/variations/${encodeURIComponent(input.voId)}/withdraw`, { reason: input.reason });
      case 'voDecide':
        return this.call<unknown>('POST', `${base}/variations/${encodeURIComponent(input.voId)}/${input.approve ? 'approve' : 'reject'}`, { note: input.note });
    }
  }
  amLifeReview(id: string, decision: 'keep' | 'rehab', body: { note?: string; cost?: number }) {
    return this.call<unknown>('POST', `/assets/${encodeURIComponent(id)}/life/${decision}`, body);
  }
  amExtras() {
    return this.call<Awaited<ReturnType<Api['amExtras']>>>('GET', '/assets/extras');
  }
  amExtrasAct(area: string, action: string, id: string, body: Record<string, unknown>) {
    return this.call<unknown>('POST', `/assets/extras/${encodeURIComponent(area)}/${encodeURIComponent(action)}?id=${encodeURIComponent(id)}`, body);
  }
  salesLeads(companyId: string) {
    return this.call<Awaited<ReturnType<Api['salesLeads']>>>('GET', `/companies/${encodeURIComponent(companyId)}/leads`);
  }
  addSalesLead(companyId: string, input: Parameters<Api['addSalesLead']>[1]) {
    return this.call<unknown>('POST', `/companies/${encodeURIComponent(companyId)}/leads`, input);
  }
  salesLeadStep(id: string, action: Parameters<Api['salesLeadStep']>[1], body: Parameters<Api['salesLeadStep']>[2]) {
    return this.call<unknown>('POST', `/leads/${encodeURIComponent(id)}/${action}`, body);
  }
  corpAuditLegal() {
    return this.call<Awaited<ReturnType<Api['corpAuditLegal']>>>('GET', '/corporate/audit-legal');
  }
  corpAuditStep(id: string, action: Parameters<Api['corpAuditStep']>[1], body: Parameters<Api['corpAuditStep']>[2]) {
    return this.call<unknown>('POST', `/corporate/audits/${encodeURIComponent(id)}/${action}`, body);
  }
  addLegalMatter(companyId: string, input: Parameters<Api['addLegalMatter']>[1]) {
    return this.call<unknown>('POST', `/corporate/${encodeURIComponent(companyId)}/legal-matters`, input);
  }
  addCorpAudit(companyId: string, input: Parameters<Api['addCorpAudit']>[1]) {
    return this.call<unknown>('POST', `/corporate/${encodeURIComponent(companyId)}/audits`, input);
  }
  addBcmSystem(input: Parameters<Api['addBcmSystem']>[0]) {
    return this.call<unknown>('POST', '/continuity/systems', input);
  }
  addGrcObligation(companyId: string, input: Parameters<Api['addGrcObligation']>[1]) {
    return this.call<unknown>('POST', `/grc/companies/${encodeURIComponent(companyId)}/obligations`, input);
  }
  legalMatterStep(id: string, action: Parameters<Api['legalMatterStep']>[1], body: Parameters<Api['legalMatterStep']>[2]) {
    return this.call<unknown>('POST', `/corporate/legal-matters/${encodeURIComponent(id)}/${action}`, body);
  }
  bcmBoard() {
    return this.call<Awaited<ReturnType<Api['bcmBoard']>>>('GET', '/continuity');
  }
  bcmRecord(systemId: string, copy: number, kind: Parameters<Api['bcmRecord']>[2], input: Parameters<Api['bcmRecord']>[3]) {
    return this.call<unknown>('POST', `/continuity/systems/${encodeURIComponent(systemId)}/copies/${copy}/${kind}`, input);
  }
  bcmDrill(playbookId: string, input: Parameters<Api['bcmDrill']>[1]) {
    return this.call<unknown>('POST', `/continuity/playbooks/${encodeURIComponent(playbookId)}/drills`, input);
  }
  pdpaRights() {
    return this.call<Awaited<ReturnType<Api['pdpaRights']>>>('GET', '/pdpa/rights');
  }
  recordPdpaDpo(companyId: string, input: Parameters<Api['recordPdpaDpo']>[1]) {
    return this.call<unknown>('POST', `/pdpa/dpos/${encodeURIComponent(companyId)}`, input);
  }
  addPdpaRequest(input: Parameters<Api['addPdpaRequest']>[0]) {
    return this.call<unknown>('POST', '/pdpa/requests', input);
  }
  pdpaRequestStep(id: string, action: Parameters<Api['pdpaRequestStep']>[1], note: string) {
    return this.call<unknown>('POST', `/pdpa/requests/${encodeURIComponent(id)}/${action}`, { note });
  }
  grcBoard() {
    return this.call<Awaited<ReturnType<Api['grcBoard']>>>('GET', '/grc');
  }
  grcEvidence(id: string, on: string, ref: string) {
    return this.call<unknown>('POST', `/grc/obligations/${encodeURIComponent(id)}/evidence`, { on, ref });
  }
  grcCheck(id: string, ok: boolean, note: string) {
    return this.call<unknown>('POST', `/grc/obligations/${encodeURIComponent(id)}/check`, { ok, note });
  }
  recordOshAssessment(siteId: string, input: Parameters<Api['recordOshAssessment']>[1]) {
    return this.call<unknown>('POST', `/grc/sites/${encodeURIComponent(siteId)}/osh`, input);
  }
  submitWhistle(input: Parameters<Api['submitWhistle']>[0]) {
    return this.call<{ code: string; handledBy: string }>('POST', '/grc/speak-up', input);
  }
  whistleStatus(code: string) {
    return this.call<Awaited<ReturnType<Api['whistleStatus']>>>('GET', `/grc/speak-up/${encodeURIComponent(code)}`);
  }
  whistleReply(code: string, text: string, retaliation: boolean) {
    return this.call<unknown>('POST', `/grc/speak-up/${encodeURIComponent(code)}/reply`, { text, retaliation });
  }
  whistleMessage(id: string, text: string) {
    return this.call<unknown>('POST', `/grc/reports/${encodeURIComponent(id)}/message`, { text });
  }
  whistleStep(id: string, action: Parameters<Api['whistleStep']>[1], text: string) {
    return this.call<unknown>('POST', `/grc/reports/${encodeURIComponent(id)}/${action}`, { text });
  }
  declareGift(input: Parameters<Api['declareGift']>[0]) {
    return this.call<unknown>('POST', '/grc/gifts', input);
  }
  decideGift(id: string, outcome: Parameters<Api['decideGift']>[1], note: string) {
    return this.call<unknown>('POST', `/grc/gifts/${encodeURIComponent(id)}/decide`, { outcome, note });
  }
  govBoard() {
    return this.call<Awaited<ReturnType<Api['govBoard']>>>('GET', '/governance');
  }
  addGovMandate(companyId: string, input: Parameters<Api['addGovMandate']>[1]) {
    return this.call<unknown>('POST', `/governance/${encodeURIComponent(companyId)}/mandates`, input);
  }
  govMandateStep(id: string, action: Parameters<Api['govMandateStep']>[1], body: Parameters<Api['govMandateStep']>[2]) {
    return this.call<unknown>('POST', `/governance/mandates/${encodeURIComponent(id)}/${action}`, body);
  }
  purBoard() {
    return this.call<Awaited<ReturnType<Api['purBoard']>>>('GET', '/purchasing');
  }
  itemBoard() {
    return this.call<Awaited<ReturnType<Api['itemBoard']>>>('GET', '/items');
  }
  itemByLabel(label: string) {
    return this.call<Awaited<ReturnType<Api['itemByLabel']>>>('GET', `/items/label/${encodeURIComponent(label.slice(0, 80))}`);
  }
  itemPaper(id: string) {
    return this.call<Awaited<ReturnType<Api['itemPaper']>>>('GET', `/items/paper/${encodeURIComponent(id.slice(0, 40))}`);
  }
  itemDevicePending(staffNo: string, face: import('@prima/core').FaceCapture | null) {
    return this.call<Awaited<ReturnType<Api['itemDevicePending']>>>('POST', '/items/device/pending', { staffNo, face });
  }
  itemAct(requestId: string, action: Parameters<Api['itemAct']>[1]) {
    return this.call<Awaited<ReturnType<Api['itemAct']>>>('POST', '/items/act', { requestId, action });
  }
  itemScanCheck(purpose: Parameters<Api['itemScanCheck']>[0], contextId: string | null, entry: Parameters<Api['itemScanCheck']>[2]) {
    return this.call<Awaited<ReturnType<Api['itemScanCheck']>>>('POST', '/items/scan-check', { purpose, contextId, entry });
  }
  itemResolve(code: string) {
    return this.call<Awaited<ReturnType<Api['itemResolve']>>>('POST', '/items/resolve', { code: code.slice(0, 80) });
  }
  itemImportRead(data: string) {
    return this.call<Awaited<ReturnType<Api['itemImportRead']>>>('POST', '/items/import/read', { data });
  }
  itemPassport(itemId: string) {
    return this.call<Awaited<ReturnType<Api['itemPassport']>>>('GET', `/items/passport/${encodeURIComponent(itemId.slice(0, 80))}`);
  }
  itemLabels(batchId: string) {
    return this.call<Awaited<ReturnType<Api['itemLabels']>>>('GET', `/items/labels/${encodeURIComponent(batchId.slice(0, 80))}`);
  }
  itemSiteBoard(siteId: string) {
    return this.call<Awaited<ReturnType<Api['itemSiteBoard']>>>('GET', `/items/site/${encodeURIComponent(siteId.slice(0, 80))}`);
  }
  itemCount(countId: string) {
    return this.call<Awaited<ReturnType<Api['itemCount']>>>('GET', `/items/counts/${encodeURIComponent(countId.slice(0, 80))}`);
  }
  itemReport(kind: Parameters<Api['itemReport']>[0], partyId: string | null, format: 'json' | 'csv') {
    const q = new URLSearchParams({ format, ...(partyId ? { partyId } : {}) });
    return this.call<Awaited<ReturnType<Api['itemReport']>>>('GET', `/items/reports/${encodeURIComponent(kind)}?${q}`);
  }
  itemFinance(partyId: string | null) {
    return this.call<Awaited<ReturnType<Api['itemFinance']>>>('GET', `/items/finance${partyId ? `?partyId=${encodeURIComponent(partyId)}` : ''}`);
  }
  itemExportFile(batchId: string, name: string) {
    return this.call<Awaited<ReturnType<Api['itemExportFile']>>>('GET', `/items/finance/batches/${encodeURIComponent(batchId)}/files/${encodeURIComponent(name)}`);
  }
  raisePurRequest(companyId: string, input: Parameters<Api['raisePurRequest']>[1]) {
    return this.call<unknown>('POST', `/purchasing/${encodeURIComponent(companyId)}/requests`, input);
  }
  myItems() {
    return this.call<Awaited<ReturnType<Api['myItems']>>>('GET', '/me/items');
  }
  deliveryProof(issueId: string) {
    return this.call<Awaited<ReturnType<Api['deliveryProof']>>>('GET', `/purchasing/issues/${encodeURIComponent(issueId)}/proof`);
  }
  confirmMyItem(id: string, received: boolean, note: string) {
    return this.call<unknown>('POST', `/me/items/${encodeURIComponent(id)}/${received ? 'received' : 'not_received'}`, { note });
  }
  purStep(id: string, action: Parameters<Api['purStep']>[1], body: Parameters<Api['purStep']>[2]) {
    return this.call<unknown>('POST', `/purchasing/requests/${encodeURIComponent(id)}/${action}`, body);
  }
  addPurSupplier(companyId: string, input: Parameters<Api['addPurSupplier']>[1]) {
    return this.call<unknown>('POST', `/purchasing/${encodeURIComponent(companyId)}/suppliers`, input);
  }
  purSupplierStep(id: string, action: Parameters<Api['purSupplierStep']>[1], note: string) {
    return this.call<unknown>('POST', `/purchasing/suppliers/${encodeURIComponent(id)}/${action}`, { note });
  }
  stockIssue(companyId: string, input: Parameters<Api['stockIssue']>[1]) {
    return this.call<unknown>('POST', `/purchasing/${encodeURIComponent(companyId)}/issues`, input);
  }
  stockReturn(id: string, condition: Parameters<Api['stockReturn']>[1], note: string) {
    return this.call<unknown>('POST', `/purchasing/issues/${encodeURIComponent(id)}/return`, { condition, note });
  }
  ceoInstructions() {
    return this.call<Awaited<ReturnType<Api['ceoInstructions']>>>('GET', '/ceo/instructions');
  }
  ceoInstruct(input: Parameters<Api['ceoInstruct']>[0]) {
    return this.call<unknown>('POST', '/ceo/instructions', input);
  }
  directorLegalFlags() {
    return this.call<Awaited<ReturnType<Api['directorLegalFlags']>>>('GET', '/director/legal-flags');
  }
  directorDigest() {
    return this.call<Awaited<ReturnType<Api['directorDigest']>>>('GET', '/director/digest');
  }
  panelBoard() {
    return this.call<Awaited<ReturnType<Api['panelBoard']>>>('GET', '/corporate/panel');
  }
  addPanelFirm(input: Parameters<Api['addPanelFirm']>[0]) {
    return this.call<unknown>('POST', '/corporate/panel', input);
  }
  panelFirmStep(id: string, action: 'review' | 'remove', note: string) {
    return this.call<unknown>('POST', `/corporate/panel/${encodeURIComponent(id)}/${action}`, { note });
  }
  adviserMoneyStep(id: string, action: Parameters<Api['adviserMoneyStep']>[1], body: Parameters<Api['adviserMoneyStep']>[2]) {
    return this.call<unknown>('POST', `/corporate/panel/${encodeURIComponent(id)}/money/${action}`, body);
  }
  delegationBoard() {
    return this.call<Awaited<ReturnType<Api['delegationBoard']>>>('GET', '/delegations');
  }
  addDelegation(companyId: string, input: Parameters<Api['addDelegation']>[1]) {
    return this.call<unknown>('POST', `/delegations/${encodeURIComponent(companyId)}`, input);
  }
  delegationStep(id: string, action: Parameters<Api['delegationStep']>[1], note: string, body?: Parameters<Api['delegationStep']>[3]) {
    return this.call<unknown>('POST', `/delegations/item/${encodeURIComponent(id)}/${action}`, { ...(body ?? {}), note });
  }
  legalHoldBoard() {
    return this.call<Awaited<ReturnType<Api['legalHoldBoard']>>>('GET', '/legal-holds');
  }
  placeLegalHold(matterId: string, input: Parameters<Api['placeLegalHold']>[1]) {
    return this.call<unknown>('POST', `/legal-holds/${encodeURIComponent(matterId)}`, input);
  }
  releaseLegalHold(id: string, reason: string) {
    return this.call<unknown>('POST', `/legal-holds/item/${encodeURIComponent(id)}/release`, { reason });
  }
  addCriticalRole(companyId: string, input: Parameters<Api['addCriticalRole']>[1]) {
    return this.call<unknown>('POST', `/critical-roles/${encodeURIComponent(companyId)}`, input);
  }
  criticalRoleStep(id: string, action: 'review' | 'retire', body: Parameters<Api['criticalRoleStep']>[2]) {
    return this.call<unknown>('POST', `/critical-roles/item/${encodeURIComponent(id)}/${action}`, body);
  }
  creditCheckLenderLicence(loanId: string, input: Parameters<Api['creditCheckLenderLicence']>[1]) {
    return this.call<unknown>('POST', `/credit/loans/${encodeURIComponent(loanId)}/licence`, input);
  }
  companyFiles() {
    return this.call<Awaited<ReturnType<Api['companyFiles']>>>('GET', '/corporate/files');
  }
  saveCompanyFile(companyId: string, input: Parameters<Api['saveCompanyFile']>[1]) {
    return this.call<unknown>('POST', `/corporate/${encodeURIComponent(companyId)}/file`, input);
  }
  startCompanyFile(companyId: string, input: Parameters<Api['startCompanyFile']>[1]) {
    return this.call<unknown>('POST', `/corporate/${encodeURIComponent(companyId)}/file/start`, input);
  }
  checkCompanyFile(companyId: string, input: Parameters<Api['checkCompanyFile']>[1]) {
    return this.call<unknown>('POST', `/corporate/${encodeURIComponent(companyId)}/file/check`, input);
  }
  corpBoard() {
    return this.call<Awaited<ReturnType<Api['corpBoard']>>>('GET', '/corporate');
  }
  renewalBoard() {
    return this.call<Awaited<ReturnType<Api['renewalBoard']>>>('GET', '/renewals');
  }
  renewalStep(id: string, action: Parameters<Api['renewalStep']>[1], body: Parameters<Api['renewalStep']>[2] = {}) {
    return this.call<unknown>('POST', `/renewals/${encodeURIComponent(id)}/${action}`, body);
  }
  corpFilingStep(id: string, action: 'prepare' | 'lodge' | 'receipt', body: { ref?: string; on?: string }) {
    return this.call<unknown>('POST', `/corporate/filings/${encodeURIComponent(id)}/${action}`, body);
  }
  raiseCorpChange(companyId: string, input: Parameters<Api['raiseCorpChange']>[1]) {
    return this.call<unknown>('POST', `/corporate/${encodeURIComponent(companyId)}/changes`, input);
  }
  addCorpFiling(companyId: string, input: Parameters<Api['addCorpFiling']>[1]) {
    return this.call<unknown>('POST', `/corporate/${encodeURIComponent(companyId)}/filings`, input);
  }
  decideCorpChange(id: string, decision: 'approve' | 'reject', note: string, clauseRef: string) {
    return this.call<unknown>('POST', `/corporate/changes/${encodeURIComponent(id)}/decide`, { decision, note, clauseRef });
  }
  recordCorpBoard(id: string, resolutionRef: string, effectiveOn: string) {
    return this.call<unknown>('POST', `/corporate/changes/${encodeURIComponent(id)}/board`, { resolutionRef, effectiveOn });
  }
  staffDirectoryStatus() {
    return this.call<{ enabled: boolean; ready: boolean }>('GET', '/staff-directory/status');
  }
  staffDirectory() {
    return this.call<Awaited<ReturnType<Api['staffDirectory']>>>('GET', '/staff-directory');
  }
  staffDirectoryAct(action: 'preview' | 'submit' | 'decide' | 'addOne', input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/staff-directory/${encodeURIComponent(action)}`, input);
  }
  itBoard() {
    return this.call<Awaited<ReturnType<Api['itBoard']>>>('GET', '/it');
  }
  itPlan(span: 'week' | 'month' | 'year', from?: string) {
    return this.call<Awaited<ReturnType<Api['itPlan']>>>('GET', `/it/plan?span=${span}${from ? `&from=${encodeURIComponent(from)}` : ''}`);
  }
  websiteBoard() {
    return this.call<Awaited<ReturnType<Api['websiteBoard']>>>('GET', '/websites');
  }
  websiteSync() {
    return this.call<{ ran: string[]; issues: string[]; notices: number; delivered: number }>('POST', '/websites-sync', {});
  }
  registerBoard() {
    return this.call<Awaited<ReturnType<Api['registerBoard']>>>('GET', '/registers');
  }
  registerAction(action: string, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/registers/${encodeURIComponent(action)}`, input);
  }
  websiteAction(action: string, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/websites/${encodeURIComponent(action)}`, input);
  }
  raiseItTicket(input: Parameters<Api['raiseItTicket']>[0]) {
    return this.call<unknown>('POST', '/it/tickets', input);
  }
  itTicketStep(id: string, action: 'take' | 'resolve', note: string) {
    return this.call<unknown>('POST', `/it/tickets/${encodeURIComponent(id)}/${action}`, { note });
  }
  async itGuidanceBoard(expectedUserId: string): Promise<{userId:string;observedAt:string;board:Awaited<ReturnType<Api['itBoard']>>}> {
    if (this.office) {
      const board = (await this.officeStrict(expectedUserId, 'GET', '/it', undefined, null, 'your workflow guide')) as Awaited<ReturnType<Api['itBoard']>>;
      return { userId: expectedUserId, observedAt: new Date().toISOString(), board };
    }
    const {ms}=await this.ready();
    const account=()=>{const a=ms?.account();return a ? `${a.homeAccountId}:${a.tenantId}:${a.localAccountId}` : null;};
    const selected=account(),devToken=this.token,token=await this.bearer();
    const same=()=>account()===selected&&(selected!==null||this.token===devToken);
    if(!expectedUserId||!token||!same())throw new ApiError('Sign-in changed. Reopen your workflow guide.',401,[]);
    const headers={authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',credentials:'omit',headers});const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||me.user.integration||!same())throw new ApiError('Your identity no longer matches this guide.',401,[]);
    const response=await fetch(`${this.base}/api/it`,{method:'GET',credentials:'omit',headers});const board=await response.json().catch(()=>null);
    if(!response.ok||!board||!same())throw new ApiError('The authorized work snapshot could not be verified. Refresh after signing in.',409,[]);
    return {userId:expectedUserId,observedAt:new Date().toISOString(),board};
  }
  async itCleanupAct(expectedUserId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    if (!['cleanupBoard','cleanupReceipt','cleanupAbandon','cleanupNominate','cleanupDecide','cleanupRestore'].includes(action)) throw new ApiError('Unsupported Controlled cleanup action.',400,[]);
    if (this.office) return this.officeStrict(expectedUserId, 'POST', `/it/act/${action}`, input, 'it-cleanup', 'Controlled cleanup');
    const {ms}=await this.ready();
    const account=()=>{const a=ms?.account();return a ? `${a.homeAccountId}:${a.tenantId}:${a.localAccountId}` : null;};
    const selected=account(),devToken=this.token;
    const token=await this.bearer();
    const same=()=>account()===selected&&(selected!==null||this.token===devToken);
    if(!token||!expectedUserId||!same())throw new ApiError('Sign-in changed. Reopen Controlled cleanup work.',401,[]);
    const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',credentials:'omit',headers});const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||me.user.integration||!same())throw new ApiError('Your identity no longer matches this screen.',401,[]);
    const res=await fetch(`${this.base}/api/it/act/${action}`,{method:'POST',credentials:'omit',headers,body:JSON.stringify(input)});
    const result=await res.json().catch(()=>null);
    if(!res.ok)throw new ApiError(typeof result?.message==='string'?result.message:'Controlled cleanup result could not be verified.',res.status,[]);
    if(!same())throw new ApiError('Sign-in changed while the request was running. Its receipt must be checked with the original account.',409,[]);
    if(!result||result.userId!==expectedUserId||result.serviceId!=='it-cleanup')throw new ApiError('Controlled cleanup receipt identity did not match.',409,[]);
    return result;
  }
  async itMetricsAct(expectedUserId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    if (!['metricsChoices','metricsBoard','metricsTargets','metricsRecovery','metricsOpen','metricsCommand','metricsSync','metricsReconcile','metricsReviewTarget','metricsReceipt','metricsAbandon'].includes(action)) throw new ApiError('Unsupported Workflow timing action.',400,[]);
    if (this.office) return this.officeStrict(expectedUserId, 'POST', `/it/act/${action}`, input, 'it-workflow-metrics', 'Workflow timing');
    const {ms}=await this.ready();
    const account=()=>{const a=ms?.account();return a ? `${a.homeAccountId}:${a.tenantId}:${a.localAccountId}` : null;};
    const selected=account(),devToken=this.token;
    const token=await this.bearer();
    const same=()=>account()===selected&&(selected!==null||this.token===devToken);
    if(!token||!expectedUserId||!same())throw new ApiError('Sign-in changed. Reopen Workflow timing work.',401,[]);
    const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',credentials:'omit',headers});const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||me.user.integration||!same())throw new ApiError('Your identity no longer matches this screen.',401,[]);
    const res=await fetch(`${this.base}/api/it/act/${action}`,{method:'POST',credentials:'omit',headers,body:JSON.stringify(input)});
    const result=await res.json().catch(()=>null);
    if(!res.ok)throw new ApiError(typeof result?.message==='string'?result.message:'Workflow timing result could not be verified.',res.status,[]);
    if(!same())throw new ApiError('Sign-in changed while the request was running. Its receipt must be checked with the original account.',409,[]);
    if(!result||result.userId!==expectedUserId||result.serviceId!=='it-workflow-metrics')throw new ApiError('Workflow timing receipt identity did not match.',409,[]);
    return result;
  }
  async itProcurementAct(expectedUserId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    if (!['procurementBoard','procurementReceipt','procurementAbandon','issuePurchaseOrder','recordPurchaseReceipt','checkPurchaseInvoice','requestPurchaseAdvance','decidePurchaseAdvance','recordPurchasePayment'].includes(action)) throw new ApiError('Unsupported Procurement action.',400,[]);
    if (this.office) return this.officeStrict(expectedUserId, 'POST', `/it/act/${action}`, input, 'it-procurement', 'Procurement');
    const {ms}=await this.ready();
    const account=()=>{const a=ms?.account();return a ? `${a.homeAccountId}:${a.tenantId}:${a.localAccountId}` : null;};
    const selected=account(),devToken=this.token;
    const token=await this.bearer();
    const same=()=>account()===selected&&(selected!==null||this.token===devToken);
    if(!token||!expectedUserId||!same())throw new ApiError('Sign-in changed. Reopen Procurement work.',401,[]);
    const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',credentials:'omit',headers});const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||me.user.integration||!same())throw new ApiError('Your identity no longer matches this screen.',401,[]);
    const res=await fetch(`${this.base}/api/it/act/${action}`,{method:'POST',credentials:'omit',headers,body:JSON.stringify(input)});
    const result=await res.json().catch(()=>null);
    if(!res.ok)throw new ApiError(typeof result?.message==='string'?result.message:'Procurement result could not be verified.',res.status,[]);
    if(!same())throw new ApiError('Sign-in changed while the request was running. Its receipt must be checked with the original account.',409,[]);
    if(!result||result.userId!==expectedUserId||result.serviceId!=='it-procurement')throw new ApiError('Procurement receipt identity did not match.',409,[]);
    return result;
  }
  async itFinanceAct(expectedUserId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    if (!['rentalCorrectionBoard','rentalCorrectionReceipt','rentalCorrectionAbandon','rentalCorrectionPropose','rentalCorrectionManagerReview','rentalCorrectionFinanceReview','rentalCorrectionCancel','rentalCorrectionRecordPayment'].includes(action)) throw new ApiError('Unsupported Rental correction action.',400,[]);
    if (this.office) return this.officeStrict(expectedUserId, 'POST', `/it/act/${action}`, input, 'it-rental-correction', 'Rental correction');
    const {ms}=await this.ready();
    const account=()=>{const a=ms?.account();return a ? `${a.homeAccountId}:${a.tenantId}:${a.localAccountId}` : null;};
    const selected=account(),devToken=this.token;
    const token=await this.bearer();
    const same=()=>account()===selected&&(selected!==null||this.token===devToken);
    if(!token||!expectedUserId||!same())throw new ApiError('Sign-in changed. Reopen Rental correction work.',401,[]);
    const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',credentials:'omit',headers});const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||me.user.integration||!same())throw new ApiError('Your identity no longer matches this screen.',401,[]);
    const res=await fetch(`${this.base}/api/it/act/${action}`,{method:'POST',credentials:'omit',headers,body:JSON.stringify(input)});
    const result=await res.json().catch(()=>null);
    if(!res.ok)throw new ApiError(typeof result?.message==='string'?result.message:'Rental correction result could not be verified.',res.status,[]);
    if(!same())throw new ApiError('Sign-in changed while the request was running. Its receipt must be checked with the original account.',409,[]);
    if(!result||result.userId!==expectedUserId||result.serviceId!=='it-rental-correction')throw new ApiError('Rental correction receipt identity did not match.',409,[]);
    return result;
  }
  async hrItAct(expectedUserId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    if (!['hrItBoard','hrItReceipt','hrItAbandon','hrItCreate','hrItEditScope','hrItSubmit','hrItCancel','hrItTechnical','hrItCollectDetails','hrItSelfDetails','hrItReviewScope','hrItReviewHandoff','hrItRequestDelegation','hrItDecideDelegation'].includes(action)) throw new ApiError('Unsupported HR/IT coordination action.',400,[]);
    if (this.office) return this.officeStrict(expectedUserId, 'POST', `/it/act/${action}`, input, 'hr-it-intake', 'HR/IT coordination');
    const {ms}=await this.ready();
    const account=()=>{const a=ms?.account();return a ? `${a.homeAccountId}:${a.tenantId}:${a.localAccountId}` : null;};
    const selected=account(),devToken=this.token;
    const token=await this.bearer();
    const same=()=>account()===selected&&(selected!==null||this.token===devToken);
    if(!token||!expectedUserId||!same())throw new ApiError('Sign-in changed. Reopen HR/IT coordination work.',401,[]);
    const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',credentials:'omit',headers});const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||me.user.integration||!same())throw new ApiError('Your identity no longer matches this screen.',401,[]);
    const res=await fetch(`${this.base}/api/it/act/${action}`,{method:'POST',credentials:'omit',headers,body:JSON.stringify(input)});
    const result=await res.json().catch(()=>null);
    if(!res.ok)throw new ApiError(typeof result?.message==='string'?result.message:'HR/IT coordination result could not be verified.',res.status,[]);
    if(!same())throw new ApiError('Sign-in changed while the request was running. Its receipt must be checked with the original account.',409,[]);
    if(!result||result.userId!==expectedUserId||result.serviceId!=='hr-it-intake')throw new ApiError('HR/IT coordination receipt identity did not match.',409,[]);
    return result;
  }
  async itManualAct(expectedUserId: string, action: string, input: Record<string, unknown>): Promise<unknown> {
    if (!['correctionBoard','correctAsset','correctSystem','correctIntake','manualBoard','manualReceipt','manualAbandon','createIntake','createSystem','createGuidance','updateGuidance','createAsset','operationalBoard','operationalReceipt','operationalAbandon','setRentalRates','prepareRentalBill','recordRentalHistory','recordAssetInspection'].includes(action)) throw new ApiError('Unsupported manual IT action.',400,[]);
    if (this.office) return this.officeStrict(expectedUserId, 'POST', `/it/act/${action}`, input, 'it-manual', 'Manual IT');
    const {ms}=await this.ready();
    const account=()=>{const a=ms?.account();return a ? `${a.homeAccountId}:${a.tenantId}:${a.localAccountId}` : null;};
    const selected=account(),devToken=this.token;
    const token=await this.bearer();
    const same=()=>account()===selected&&(selected!==null||this.token===devToken);
    if(!token||!expectedUserId||!same())throw new ApiError('Sign-in changed. Reopen manual IT work.',401,[]);
    const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
    const identity=await fetch(`${this.base}/api/me`,{method:'GET',credentials:'omit',headers});const me=await identity.json().catch(()=>null);
    if(!identity.ok||me?.user?.id!==expectedUserId||me.user.integration||!same())throw new ApiError('Your identity no longer matches this screen.',401,[]);
    const res=await fetch(`${this.base}/api/it/act/${action}`,{method:'POST',credentials:'omit',headers,body:JSON.stringify(input)});
    const result=await res.json().catch(()=>null);
    if(!res.ok)throw new ApiError(typeof result?.message==='string'?result.message:'Manual IT result could not be verified.',res.status,[]);
    if(!same())throw new ApiError('Sign-in changed while the request was running. Its receipt must be checked with the original account.',409,[]);
    if(!result||result.userId!==expectedUserId||result.serviceId!=='it-manual')throw new ApiError('Manual IT receipt identity did not match.',409,[]);
    return result;
  }
  itAct(action: string, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/it/act/${encodeURIComponent(action)}`, input);
  }
  setItOnboardingStep(id: string, key: string, done: boolean, evidenceRef: string, expectedVersion: number) {
    return this.call<unknown>('POST', `/it/onboarding/${encodeURIComponent(id)}/${encodeURIComponent(key)}`, { done, evidenceRef, expectedVersion });
  }
  setItTenderItem(id: string, index: number, done: boolean) {
    return this.call<unknown>('POST', `/it/tenders/${encodeURIComponent(id)}/${index}`, { done });
  }
  setItAsset(id: string, status: Parameters<Api['setItAsset']>[1], assignedTo: string | null, note: string, ewaste?: ItEwaste | null) {
    return this.call<unknown>('POST', `/it/assets/${encodeURIComponent(id)}`, { status, assignedTo, note, ewaste: ewaste ?? null });
  }
  itMaintenance(id: string, kind: 'service' | 'repair', note: string, cost: number) {
    return this.call<unknown>('POST', `/it/assets/${encodeURIComponent(id)}/maintenance`, { kind, note, cost });
  }
  raiseItPurchase(input: Parameters<Api['raiseItPurchase']>[0]) {
    return this.call<unknown>('POST', '/it/purchases', input);
  }
  itPurchaseStep(id: string, action: Parameters<Api['itPurchaseStep']>[1], body: Parameters<Api['itPurchaseStep']>[2]) {
    return this.call<unknown>('POST', `/it/purchases/${encodeURIComponent(id)}/${action}`, body);
  }
  approveBranchSettlement(id: string, note: string) {
    return this.call<unknown>('POST', `/branch-settlements/${encodeURIComponent(id)}/approve`, { note });
  }
  addBranch(companyId: string, input: { name: string; state: string; model: 'A' | 'B' | 'C' }) {
    return this.call<unknown>('POST', `/companies/${encodeURIComponent(companyId)}/branches`, input);
  }
  branchLeadClaims(companyId: string) {
    return this.call<Awaited<ReturnType<Api['branchLeadClaims']>>>('GET', `/companies/${encodeURIComponent(companyId)}/branch-leads`);
  }
  branchAct(branchId: string, action: string, body: Record<string, unknown>) {
    return this.call<unknown>('POST', `/branches/${encodeURIComponent(branchId)}/act`, { ...body, action });
  }
  insuranceClaimAct(claimId: string, action: string, body: Record<string, unknown>) {
    return this.call<unknown>('POST', `/insurance-claims/${encodeURIComponent(claimId)}/act`, { ...body, action });
  }
  branchSettlementAct(id: string, action: 'approve' | 'return' | 'validate' | 'paid', body: Record<string, unknown>) {
    return this.call<unknown>('POST', `/branch-settlements/${encodeURIComponent(id)}/act`, { ...body, action });
  }
  reviewBranchAction(id: string, decision: 'accepted' | 'reversed', note: string) {
    return this.call<unknown>('POST', `/branch-actions/${encodeURIComponent(id)}/review`, { decision, note });
  }
  addBranchAgreement(branchId: string, input: Parameters<Api['addBranchAgreement']>[1]) {
    return this.call<unknown>('POST', `/branches/${encodeURIComponent(branchId)}/agreements`, input);
  }
  contracts() {
    return this.call<Awaited<ReturnType<Api['contracts']>>>('GET', '/contracts');
  }
  setCmsService(contractId: string, input: Parameters<Api['setCmsService']>[1]) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(contractId)}/cms-service`, input);
  }
  recordCmsTest(contractId: string, version: number, service: CmsServiceKind, siteId: string, note: string) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(contractId)}/cms-service/tests`, { version, service, siteId, note });
  }
  verifyCmsContact(contractId: string, index: number, version: number, note: string) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(contractId)}/cms-service/contacts/${index}/verify`, { version, note });
  }
  acceptCmsService(contractId: string, who: 'operator' | 'client', version: number, input: { note?: string; clientName?: string; ref?: string }) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(contractId)}/cms-service/accept/${who}`, { version, ...input });
  }
  cmsCommissioning() {
    return this.call<Awaited<ReturnType<Api['cmsCommissioning']>>>('GET', '/cms/commissioning');
  }
  setMobItem(id: string, itemId: string, status: 'open' | 'done' | 'risk_accepted', note: string, acceptedUntil: string | null, proof: ProofInput[] = []) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, { status, note, acceptedUntil, proof });
  }
  contractStep(id: string, action: Parameters<Api['contractStep']>[1], note: string) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(id)}/step/${action}`, { note });
  }
  contractReview(id: string, day: 1 | 7 | 14 | 30, note: string, invoiceChecked: boolean) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(id)}/reviews/${day}`, { note, invoiceChecked });
  }
  addContract(input: ContractInput) {
    return this.call<unknown>('POST', '/contracts', input);
  }
  addContractVariation(id: string, input: Parameters<Api['addContractVariation']>[1]) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(id)}/variations`, input);
  }
  finBoard() {
    return this.call<Awaited<ReturnType<Api['finBoard']>>>('GET', '/finance');
  }
  setFinPack(companyId: string, pack: FinPackKind, itemId: string, status: 'todo' | 'prepared' | 'reviewed' | 'sent', comment?: string) {
    return this.call<unknown>('POST', `/finance/${encodeURIComponent(companyId)}/${pack}/${encodeURIComponent(itemId)}`, { status, comment });
  }
  finExceptionalCashEvidence(companyId: string, docId: string) {
    return this.call<Awaited<ReturnType<Api['finExceptionalCashEvidence']>>>('GET', `/finance/exceptionalcash/${encodeURIComponent(companyId)}/evidence/${encodeURIComponent(docId)}`);
  }
  finArrivalCashEvidence(companyId: string, docId: string) { return this.call<Awaited<ReturnType<Api['finArrivalCashEvidence']>>>('GET', `/finance/arrivalcash/${encodeURIComponent(companyId)}/evidence/${encodeURIComponent(docId)}`); }
  finArrivalCash(companyId: string) { return this.call<Awaited<ReturnType<Api['finArrivalCash']>>>('GET', `/finance/arrivalcash/${encodeURIComponent(companyId)}`); }
  finExceptionalCash(companyId: string) {
    return this.call<Awaited<ReturnType<Api['finExceptionalCash']>>>('GET', `/finance/exceptionalcash/${encodeURIComponent(companyId)}`);
  }
  finDailyCashMine() {
    return this.call<Awaited<ReturnType<Api['finDailyCashMine']>>>('GET', '/finance/dailycash/mine');
  }
  finCashMine() {
    return this.call<Awaited<ReturnType<Api['finCashMine']>>>('GET', '/finance/cash/mine');
  }
  finAdvancesOverdue() {
    return this.call<Awaited<ReturnType<Api['finAdvancesOverdue']>>>('GET', '/finance/cash/advances-overdue');
  }
  financeToday() {
    return this.call<Awaited<ReturnType<Api['financeToday']>>>('GET', '/finance/today');
  }
  finDesk() {
    return this.call<Awaited<ReturnType<Api['finDesk']>>>('GET', '/finance/desk');
  }
  finSettings() {
    return this.call<Awaited<ReturnType<Api['finSettings']>>>('GET', '/finance/settings');
  }
  finKpi(period?: string) {
    return this.call<Awaited<ReturnType<Api['finKpi']>>>('GET', `/finance/kpi${period ? `?period=${encodeURIComponent(period)}` : ''}`);
  }
  finSetSettings(values: Record<string, unknown>, comment: string) {
    return this.call<unknown>('POST', '/finance/settings', { values, comment });
  }
  finRequests() {
    return this.call<Awaited<ReturnType<Api['finRequests']>>>('GET', '/finance/requests');
  }
  finCreateRequest(companyId: string, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/finance/requests/${encodeURIComponent(companyId)}`, input);
  }
  finRequestStep(companyId: string, requestId: string, action: FinRequestAction, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/finance/requests/${encodeURIComponent(companyId)}/${encodeURIComponent(requestId)}/${action}`, input);
  }
  finCooDesk() {
    return this.call<Awaited<ReturnType<Api['finCooDesk']>>>('GET', '/finance/coo');
  }
  finCooStep(companyId: string, paymentId: string, action: 'approve' | 'return', input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/finance/coo/${encodeURIComponent(companyId)}/${encodeURIComponent(paymentId)}/${action}`, input);
  }
  finCreatePayment(companyId: string, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/finance/${encodeURIComponent(companyId)}/payments`, input);
  }
  finPaymentStep(companyId: string, paymentId: string, action: FinPaymentAction, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/finance/${encodeURIComponent(companyId)}/payments/${encodeURIComponent(paymentId)}/${action}`, input);
  }
  finCloseStep(companyId: string, action: FinCloseAction, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/finance/${encodeURIComponent(companyId)}/close/${action}`, input);
  }
  finAddBankAccount(companyId: string, input: { bank: string; last4: string; purpose: string }) {
    return this.call<unknown>('POST', `/finance/${encodeURIComponent(companyId)}/banks`, input);
  }
  finStartBooks(companyId: string, input: { team: number; fyEnd: string }) {
    return this.call<unknown>('POST', `/finance/${encodeURIComponent(companyId)}/books`, input);
  }
  finAddPaper(companyId: string, pack: 'audit' | 'tax', input: { label: string; dueOn: string }) {
    return this.call<unknown>('POST', `/finance/${encodeURIComponent(companyId)}/papers/${pack}`, input);
  }
  finChecksTodo() {
    return this.call<Awaited<ReturnType<Api['finChecksTodo']>>>('GET', '/finance/checks-todo');
  }
  finDashboard() {
    return this.call<Awaited<ReturnType<Api['finDashboard']>>>('GET', '/finance/dashboard');
  }
  finPack(companyId: string, period?: string) {
    return this.call<Awaited<ReturnType<Api['finPack']>>>('GET', `/finance/${encodeURIComponent(companyId)}/pack${period ? `?period=${encodeURIComponent(period)}` : ''}`);
  }
  finControls(companyId: string, billPeriod?: string) {
    return this.call<Awaited<ReturnType<Api['finControls']>>>('GET', `/finance/${encodeURIComponent(companyId)}/controls${billPeriod ? `?billPeriod=${encodeURIComponent(billPeriod)}` : ''}`);
  }
  finControlAction(companyId: string, area: FinControlArea, action: string, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/finance/${encodeURIComponent(companyId)}/controls/${area}/${encodeURIComponent(action)}`, input);
  }
  staffPayroll() {
    return this.call<Awaited<ReturnType<Api['staffPayroll']>>>('GET', '/staff-pay');
  }
  staffPayRun(runId: string) {
    return this.call<Awaited<ReturnType<Api['staffPayRun']>>>('GET', `/staff-pay/${encodeURIComponent(runId)}`);
  }
  prepareStaffPay(companyId: string, period: string) {
    return this.call<unknown>('POST', '/staff-pay', { companyId, period });
  }
  myZakat() {
    return this.call<Awaited<ReturnType<Api['myZakat']>>>('GET', '/staff-pay/my-zakat');
  }
  setMyZakat(input: { body: string | null; percent?: number }) {
    return this.call<unknown>('POST', '/staff-pay/my-zakat', input);
  }
  statTables(period?: string) {
    return this.call<Awaited<ReturnType<Api['statTables']>>>('GET', `/staff-pay/stat-tables${period ? `?period=${encodeURIComponent(period)}` : ''}`);
  }
  loadStatTable(input: Parameters<Api['loadStatTable']>[0]) {
    return this.call<Awaited<ReturnType<Api['loadStatTable']>>>('POST', '/staff-pay/stat-tables', input);
  }
  checkStatTable(input: Parameters<Api['checkStatTable']>[0]) {
    return this.call<unknown>('POST', '/staff-pay/stat-tables/check', input);
  }
  setEmployerNos(companyId: string, input: Parameters<Api['setEmployerNos']>[1]) {
    return this.call<unknown>('POST', `/staff-pay/employer-nos/${encodeURIComponent(companyId)}`, input);
  }
  setStaffPayLine(runId: string, personId: string, patch: Parameters<Api['setStaffPayLine']>[2]) {
    return this.call<unknown>('POST', `/staff-pay/${encodeURIComponent(runId)}/lines/${encodeURIComponent(personId)}`, patch);
  }
  staffPayStep(runId: string, action: Parameters<Api['staffPayStep']>[1], body: Parameters<Api['staffPayStep']>[2]) {
    return this.call<unknown>('POST', `/staff-pay/${encodeURIComponent(runId)}/${action}`, body);
  }
  staffPayExport(runId: string, kind: Parameters<Api['staffPayExport']>[1]) {
    return this.call<Awaited<ReturnType<Api['staffPayExport']>>>('POST', `/staff-pay/${encodeURIComponent(runId)}/files/${kind}`, {});
  }
  guardPayroll() {
    return this.call<Awaited<ReturnType<Api['guardPayroll']>>>('GET', '/guard-pay');
  }
  guardPayRun(runId: string) {
    return this.call<Awaited<ReturnType<Api['guardPayRun']>>>('GET', `/guard-pay/${encodeURIComponent(runId)}`);
  }
  myGuardPayslips() {
    return this.call<Awaited<ReturnType<Api['myGuardPayslips']>>>('GET', '/guard-pay/mine');
  }
  prepareGuardPay(companyId: string, period: string, holidays?: { date: string; label: string }[]) {
    return this.call<unknown>('POST', '/guard-pay', { companyId, period, holidays });
  }
  setGuardPayLine(runId: string, personId: string, patch: Parameters<Api['setGuardPayLine']>[2]) {
    return this.call<unknown>('POST', `/guard-pay/${encodeURIComponent(runId)}/lines/${encodeURIComponent(personId)}`, patch);
  }
  guardPayStep(runId: string, action: Parameters<Api['guardPayStep']>[1], body: Parameters<Api['guardPayStep']>[2]) {
    return this.call<unknown>('POST', `/guard-pay/${encodeURIComponent(runId)}/${action}`, body);
  }
  guardPayExport(runId: string, kind: Parameters<Api['guardPayExport']>[1]) {
    return this.call<Awaited<ReturnType<Api['guardPayExport']>>>('POST', `/guard-pay/${encodeURIComponent(runId)}/files/${kind}`, {});
  }
  guardPayCash(runId: string, personId: string, action: Parameters<Api['guardPayCash']>[2], body: Parameters<Api['guardPayCash']>[3]) {
    return this.call<unknown>('POST', `/guard-pay/${encodeURIComponent(runId)}/cash/${encodeURIComponent(personId)}/${action}`, body);
  }
  recordPayConsent(personId: string, body: Parameters<Api['recordPayConsent']>[1]) {
    return this.call<unknown>('POST', `/guard-pay/consent/${encodeURIComponent(personId)}`, body);
  }
  statutoryBoard() {
    return this.call<Awaited<ReturnType<Api['statutoryBoard']>>>('GET', '/statutory');
  }
  setStatutory(body: Parameters<Api['setStatutory']>[0]) {
    return this.call<unknown>('POST', '/statutory', body);
  }
  payConsentsWaiting() {
    return this.call<Awaited<ReturnType<Api['payConsentsWaiting']>>>('GET', '/guard-pay/consents');
  }
  approvePayConsent(personId: string, note: string) {
    return this.call<unknown>('POST', `/guard-pay/consent/${encodeURIComponent(personId)}/approve`, { note });
  }
  guardAdvances(input: Parameters<Api['guardAdvances']>[0]) {
    const q = new URLSearchParams();
    if (input.companyId) q.set('companyId', input.companyId);
    if (input.period) q.set('period', input.period);
    return this.call<Awaited<ReturnType<Api['guardAdvances']>>>('GET', `/guard-pay/advances${q.size ? `?${q}` : ''}`);
  }
  setGuardAdvances(body: Parameters<Api['setGuardAdvances']>[0]) {
    return this.call<Awaited<ReturnType<Api['setGuardAdvances']>>>('POST', '/guard-pay/advances', body);
  }
  changeGuardAdvance(id: string, body: Parameters<Api['changeGuardAdvance']>[1]) {
    return this.call<unknown>('POST', `/guard-pay/advances/${encodeURIComponent(id)}`, body);
  }
  approveGuardAdvances(ids: string[], note: string) {
    return this.call<unknown>('POST', '/guard-pay/advances/approve', { ids, note });
  }
  payGuardAdvance(id: string, body: Parameters<Api['payGuardAdvance']>[1]) {
    return this.call<unknown>('POST', `/guard-pay/advances/${encodeURIComponent(id)}/pay`, body);
  }
  guardLoans(input: Parameters<Api['guardLoans']>[0]) {
    const q = new URLSearchParams();
    if (input.companyId) q.set('companyId', input.companyId);
    return this.call<Awaited<ReturnType<Api['guardLoans']>>>('GET', `/guard-pay/loans${q.size ? `?${q}` : ''}`);
  }
  recordGuardLoan(body: Parameters<Api['recordGuardLoan']>[0]) {
    return this.call<unknown>('POST', '/guard-pay/loans', body);
  }
  guardLoanStep(id: string, action: Parameters<Api['guardLoanStep']>[1], body: Parameters<Api['guardLoanStep']>[2]) {
    return this.call<unknown>('POST', `/guard-pay/loans/${encodeURIComponent(id)}/${action}`, body);
  }
  jaBoard() {
    return this.call<Awaited<ReturnType<Api['jaBoard']>>>('GET', '/ja');
  }
  companyOffice(companyId: string) {
    return this.call<Awaited<ReturnType<Api['companyOffice']>>>('GET', `/companies/${encodeURIComponent(companyId)}/office`);
  }
  companyOffices() {
    return this.call<Awaited<ReturnType<Api['companyOffices']>>>('GET', '/offices');
  }
  setOfficeDesks(companyId: string, desks: OfficeDeskInput[], note: string) {
    return this.call<unknown>('POST', `/companies/${encodeURIComponent(companyId)}/office/desks`, { desks, note });
  }
  setCompanyRunBy(companyId: string, runByCompanyId: string | null, reason: string) {
    return this.call<unknown>('POST', `/companies/${encodeURIComponent(companyId)}/office/run-by`, { runByCompanyId, reason });
  }
  clientBoard() {
    return this.call<Awaited<ReturnType<Api['clientBoard']>>>('GET', '/clients');
  }
  clientStep(accountId: string, phase: 'onboarding' | 'offboarding', key: string, note: string, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/step`, { phase, key, note, proof });
  }
  addClientAccount(input: ClientAccountInput) {
    return this.call<unknown>('POST', '/clients', input);
  }
  startOffboarding(accountId: string, reason: string, lost?: { reason: ClientLostReason; winBackOn?: string | null }) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/offboard`, { reason, ...(lost ? { lostReason: lost.reason, winBackOn: lost.winBackOn ?? null } : {}) });
  }
  crmBoard() {
    return this.call<CrmBoard>('GET', '/crm');
  }
  clientDiligence(accountId: string) {
    return this.call<Awaited<ReturnType<Api['clientDiligence']>>>('GET', `/crm/clients/${encodeURIComponent(accountId)}/diligence`);
  }
  clientDiligenceAct(accountId: string, action: 'start' | 'check' | 'decide', body: Record<string, unknown>) {
    return this.call<Awaited<ReturnType<Api['clientDiligenceAct']>>>('POST', `/crm/clients/${encodeURIComponent(accountId)}/diligence/${action}`, body);
  }
  siteInstructions(siteId: string) {
    return this.call<Awaited<ReturnType<Api['siteInstructions']>>>('GET', `/sites/${encodeURIComponent(siteId)}/instructions`);
  }
  siteInstructionsAct(siteId: string, action: 'save' | 'client_signed', body: Record<string, unknown>) {
    return this.call<Awaited<ReturnType<Api['siteInstructionsAct']>>>('POST', `/sites/${encodeURIComponent(siteId)}/instructions/${action}`, body);
  }
  crmClient(accountId: string) {
    return this.call<CrmClient>('GET', `/crm/clients/${encodeURIComponent(accountId)}`);
  }
  setClientOwner(accountId: string, userId: string) {
    return this.call<unknown>('POST', `/crm/clients/${encodeURIComponent(accountId)}/owner`, { userId });
  }
  addClientPerson(accountId: string, input: Parameters<Api['addClientPerson']>[1]) {
    return this.call<unknown>('POST', `/crm/clients/${encodeURIComponent(accountId)}/people`, input);
  }
  updateClientPerson(accountId: string, personId: string, action: 'remove' | 'main') {
    return this.call<unknown>('POST', `/crm/clients/${encodeURIComponent(accountId)}/people/${encodeURIComponent(personId)}`, { action });
  }
  addClientRequest(accountId: string, input: Parameters<Api['addClientRequest']>[1]) {
    return this.call<unknown>('POST', `/crm/clients/${encodeURIComponent(accountId)}/requests`, input);
  }
  closeClientRequest(accountId: string, requestId: string, input: Parameters<Api['closeClientRequest']>[2]) {
    return this.call<unknown>('POST', `/crm/clients/${encodeURIComponent(accountId)}/requests/${encodeURIComponent(requestId)}`, input);
  }
  decideClientRenewal(accountId: string, input: Parameters<Api['decideClientRenewal']>[1]) {
    return this.call<unknown>('POST', `/crm/clients/${encodeURIComponent(accountId)}/renewal/decide`, input);
  }
  sendClientRenewalOffer(accountId: string, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/crm/clients/${encodeURIComponent(accountId)}/renewal/offer`, { proof });
  }
  answerClientRenewal(accountId: string, input: Parameters<Api['answerClientRenewal']>[1]) {
    return this.call<unknown>('POST', `/crm/clients/${encodeURIComponent(accountId)}/renewal/answer`, input);
  }
  clientContact(accountId: string, kind: 'visit' | 'meeting' | 'call', note: string) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/contact`, { kind, note });
  }
  clientReport(accountId: string, period: string, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/report`, { period, proof });
  }
  clientRating(accountId: string, score: number, comment: string, input: { from: string; via: 'meeting' | 'visit' | 'call' | 'email' | 'form'; proof?: ProofInput[] }) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/rating`, { score, comment, ...input });
  }
  clientComplaint(accountId: string, input: { from: string; via: 'meeting' | 'visit' | 'call' | 'email' | 'form'; what: string; siteId?: string | null; proof?: ProofInput[] }) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/complaints`, input);
  }
  resolveClientComplaint(accountId: string, complaintId: string, resolution: string, proof: ProofInput[] = []) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/complaints/${encodeURIComponent(complaintId)}/resolve`, { resolution, proof });
  }
  clientBilling(accountId: string, input: { invoicedTo: string | null; overdueAmount: number; overdueDays: number }) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(accountId)}/billing`, input);
  }
  fleetBoard() {
    return this.call<Awaited<ReturnType<Api['fleetBoard']>>>('GET', '/fleet');
  }
  vehicleRentals(month?: string) {
    return this.call<Awaited<ReturnType<Api['vehicleRentals']>>>('GET', `/fleet/rentals${month ? `?month=${encodeURIComponent(month)}` : ''}`);
  }
  recordVehicleRental(vehicleId: string, input: Parameters<Api['recordVehicleRental']>[1]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/rental`, input);
  }
  endVehicleRental(vehicleId: string, input: Parameters<Api['endVehicleRental']>[1]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/rental/end`, input);
  }
  moveVehicleUse(vehicleId: string, input: Parameters<Api['moveVehicleUse']>[1]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/move`, input);
  }
  setVehicleRent(vehicleId: string, input: Parameters<Api['setVehicleRent']>[1]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/rent`, input);
  }
  vehicleUsage(month?: string) {
    return this.call<Awaited<ReturnType<Api['vehicleUsage']>>>('GET', `/fleet/usage${month ? `?month=${encodeURIComponent(month)}` : ''}`);
  }
  // P100 newb: E7 the CMS console opened with the Prima sign-in (apps/api/src/cms-signin.controller.ts).
  cmsConsole() {
    return this.call<Awaited<ReturnType<Api['cmsConsole']>>>('GET', '/cms/console');
  }
  cmsConsoleSignIn() {
    return this.call<Awaited<ReturnType<Api['cmsConsoleSignIn']>>>('POST', '/cms/console/sign-in', {});
  }
  // P100 newb: J6 each person's alert choices (apps/api/src/alerts/controller.ts).
  myAlertPrefs() {
    return this.call<Awaited<ReturnType<Api['myAlertPrefs']>>>('GET', '/alerts/prefs');
  }
  setMyAlertPrefs(input: Parameters<Api['setMyAlertPrefs']>[0]) {
    return this.call<unknown>('POST', '/alerts/prefs', input);
  }
  // P100 newb: J5 guard sign-ins in bulk (apps/api/src/guard-signins.controller.ts).
  guardSignInBoard(companyId?: string) {
    return this.call<Awaited<ReturnType<Api['guardSignInBoard']>>>('GET', `/guard-signins${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`);
  }
  prepareGuardSignIns(companyId: string, personIds: string[], note: string) {
    return this.call<unknown>('POST', '/guard-signins', { companyId, personIds, note });
  }
  decideGuardSignIns(id: string, approve: boolean, note: string) {
    return this.call<unknown>('POST', `/guard-signins/${encodeURIComponent(id)}/decide`, { approve, note });
  }
  cancelGuardSignIns(id: string, reason: string) {
    return this.call<unknown>('POST', `/guard-signins/${encodeURIComponent(id)}/cancel`, { reason });
  }
  // P100 newb: J1 the client portal (apps/api/src/client-portal.controller.ts).
  clientPortalDesk() {
    return this.call<Awaited<ReturnType<Api['clientPortalDesk']>>>('GET', '/client-portal');
  }
  openClientPortal(clientId: string, input: Parameters<Api['openClientPortal']>[1]) {
    return this.call<Awaited<ReturnType<Api['openClientPortal']>>>('POST', `/clients/${encodeURIComponent(clientId)}/client-portal`, input);
  }
  resetClientPortal(clientId: string, portalUserId: string, reason: string) {
    return this.call<Awaited<ReturnType<Api['resetClientPortal']>>>('POST', `/clients/${encodeURIComponent(clientId)}/client-portal/${encodeURIComponent(portalUserId)}/reset`, { reason });
  }
  closeClientPortal(clientId: string, portalUserId: string, reason: string) {
    return this.call<unknown>('POST', `/clients/${encodeURIComponent(clientId)}/client-portal/${encodeURIComponent(portalUserId)}/close`, { reason });
  }
  // P100 newb: E6 vehicle moves between companies (apps/api/src/vehicle-transfer.controller.ts).
  vehicleTransferBoard() {
    return this.call<Awaited<ReturnType<Api['vehicleTransferBoard']>>>('GET', '/fleet/transfers');
  }
  requestVehicleTransfer(input: Parameters<Api['requestVehicleTransfer']>[0]) {
    return this.call<unknown>('POST', '/fleet/transfers', input);
  }
  decideVehicleTransfer(id: string, approve: boolean, note: string) {
    return this.call<unknown>('POST', `/fleet/transfers/${encodeURIComponent(id)}/decide`, { approve, note });
  }
  handOverVehicleTransfer(id: string, input: Parameters<Api['handOverVehicleTransfer']>[1]) {
    return this.call<unknown>('POST', `/fleet/transfers/${encodeURIComponent(id)}/handover`, input);
  }
  cancelVehicleTransfer(id: string, reason: string) {
    return this.call<unknown>('POST', `/fleet/transfers/${encodeURIComponent(id)}/cancel`, { reason });
  }
  setVehicleFuel(vehicleId: string, input: Parameters<Api['setVehicleFuel']>[1]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/fuel-type`, input);
  }
  addVehicleCard(vehicleId: string, input: Parameters<Api['addVehicleCard']>[1]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/cards`, input);
  }
  endVehicleCard(vehicleId: string, cardId: string, input: { on: string; reason: string }) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/cards/${encodeURIComponent(cardId)}/end`, input);
  }
  recordFuel(vehicleId: string, input: Parameters<Api['recordFuel']>[1], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/fuel`, { ...input, proof });
  }
  reviewFuel(vehicleId: string, fillId: string, input: Parameters<Api['reviewFuel']>[2]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/fuel/${encodeURIComponent(fillId)}/review`, input);
  }
  requestVehicle(input: VehicleRequestInput) {
    return this.call<unknown>('POST', '/fleet/requests', input);
  }
  decideVehicleRequest(requestId: string, ok: boolean, vehicleId: string | null, note: string) {
    return this.call<unknown>('POST', `/fleet/requests/${encodeURIComponent(requestId)}/decide`, { ok, vehicleId, note });
  }
  vehicleOut(vehicleId: string, requestId: string | null, km: number, driver?: string) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/out`, { requestId, km, driver });
  }
  vehicleIn(vehicleId: string, km: number, note: string) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/in`, { km, note });
  }
  recordVehicleWork(vehicleId: string, input: VehicleWorkInput, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/fleet/vehicles/${encodeURIComponent(vehicleId)}/work`, { ...input, proof });
  }
  fileMonitoringConsent(personId: string, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/monitoring-consent`, { proof });
  }
  guardPhoneCode(personId: string) {
    return this.call<Awaited<ReturnType<Api['guardPhoneCode']>>>('POST', `/people/${encodeURIComponent(personId)}/guard-phone/code`, {});
  }
  guardPhones(companyId: string) {
    return this.call<Awaited<ReturnType<Api['guardPhones']>>>('GET', `/companies/${encodeURIComponent(companyId)}/guard-phones`);
  }
  revokeGuardPhone(phoneId: string, reason: string) {
    return this.call<unknown>('POST', `/guard-phones/${encodeURIComponent(phoneId)}/revoke`, { reason });
  }
  cmsGuardPhones() {
    return this.call<Awaited<ReturnType<Api['cmsGuardPhones']>>>('GET', '/cms/guard-phones');
  }
  setStaffPin(personId: string, pin: string) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/pin`, { pin });
  }
  closeAccess(userId: string, input: { from: string | null; reason: string }) {
    return this.call<Awaited<ReturnType<Api['closeAccess']>>>('POST', `/accounts/${encodeURIComponent(userId)}/close`, input);
  }
  pdpaBoard() {
    return this.call<Awaited<ReturnType<Api['pdpaBoard']>>>('GET', '/pdpa');
  }
  openPdpaCase(input: PdpaCaseInput) {
    return this.call<unknown>('POST', '/pdpa', input);
  }
  pdpaStep(caseId: string, step: PdpaStepName, note: string, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/pdpa/${encodeURIComponent(caseId)}/${step}`, { note, proof });
  }
  pdpaDocs(caseId: string) {
    return this.call<EvidenceDoc[]>('GET', `/pdpa/${encodeURIComponent(caseId)}/docs`);
  }
  pdpaRegisterBoard() {
    return this.call<Awaited<ReturnType<Api['pdpaRegisterBoard']>>>('GET', '/pdpa-register');
  }
  setPdpaSettings(input: { enabled?: boolean; keepYears?: number }, reason: string) {
    return this.call<unknown>('POST', '/pdpa-settings', { ...input, reason });
  }
  savePdpaRegisterItem(id: string | null, input: Parameters<Api['savePdpaRegisterItem']>[1]) {
    return this.call<unknown>('POST', id ? `/pdpa-register/${encodeURIComponent(id)}` : '/pdpa-register', input);
  }
  pdpaRegisterStep(id: string, step: 'review' | 'retire', note: string) {
    return this.call<unknown>('POST', `/pdpa-register/${encodeURIComponent(id)}/${step}`, { note });
  }
  recordPdpaConsent(input: Parameters<Api['recordPdpaConsent']>[0], proof: ProofInput[]) {
    return this.call<unknown>('POST', '/pdpa-consents', { ...input, proof });
  }
  withdrawPdpaConsent(id: string, on: string, note: string) {
    return this.call<unknown>('POST', `/pdpa-consents/${encodeURIComponent(id)}/withdraw`, { on, note });
  }
  pdpaBreachDetails(caseId: string, input: Parameters<Api['pdpaBreachDetails']>[1]) {
    return this.call<unknown>('POST', `/pdpa-breach/${encodeURIComponent(caseId)}/details`, input);
  }
  memos() {
    return this.call<Awaited<ReturnType<Api['memos']>>>('GET', '/memos');
  }
  publishMemo(audience: 'STAFF' | 'FIELD' | 'TEAM', title: string, body: string, states: string[], opts: { readBy?: string | null; replaces?: string | null } = {}) {
    return this.call<unknown>('POST', '/memos', { audience, title, body, states, readBy: opts.readBy ?? null, replaces: opts.replaces ?? null });
  }
  memoReach(audience: 'STAFF' | 'FIELD' | 'TEAM', states: string[]) {
    return this.call<{ count: number }>('POST', '/memos/reach', { audience, states });
  }
  withdrawMemo(memoId: string, reason: string) {
    return this.call<unknown>('POST', `/memos/${encodeURIComponent(memoId)}/withdraw`, { reason });
  }
  remindMemo(memoId: string) {
    return this.call<unknown>('POST', `/memos/${encodeURIComponent(memoId)}/remind`, {});
  }
  readMemo(memoId: string) {
    return this.call<unknown>('POST', `/memos/${encodeURIComponent(memoId)}/read`, {});
  }
  fwmDocs(ref: string) {
    return this.call<Awaited<ReturnType<Api['fwmDocs']>>>('GET', `/fwm/docs/${encodeURIComponent(ref)}`);
  }
  fwCostBoard() {
    return this.call<Awaited<ReturnType<Api['fwCostBoard']>>>('GET', '/fwm/cost');
  }
  fwStatBoard() {
    return this.call<Awaited<ReturnType<Api['fwStatBoard']>>>('GET', '/fwm/epf-socso');
  }
  fwStatAct(action: Parameters<Api['fwStatAct']>[0], body: Record<string, unknown>) {
    return this.call<unknown>('POST', `/fwm/epf-socso/${encodeURIComponent(action)}`, body);
  }
  fwCostDocs(ref: string) {
    return this.call<Awaited<ReturnType<Api['fwCostDocs']>>>('GET', `/fwm/cost/docs/${encodeURIComponent(ref)}`);
  }
  recordFwPlacement(personId: string, input: Parameters<Api['recordFwPlacement']>[1], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/fw-placements`, { ...input, proof });
  }
  endFwPlacement(id: string, input: { to: string; note: string }) {
    return this.call<unknown>('POST', `/fw-placements/${encodeURIComponent(id)}/end`, input);
  }
  setFwCostRate(input: Parameters<Api['setFwCostRate']>[0]) {
    return this.call<unknown>('POST', '/fwm/cost/rates', input);
  }
  addFwCostLegalNote(input: Parameters<Api['addFwCostLegalNote']>[0]) {
    return this.call<unknown>('POST', '/fwm/cost/legal-notes', input);
  }
  draftFwCostMonth(month: string) {
    return this.call<unknown>('POST', `/fwm/cost/months/${encodeURIComponent(month)}/draft`, {});
  }
  decideFwCostCharges(input: Parameters<Api['decideFwCostCharges']>[0]) {
    const { month, ...body } = input;
    return this.call<unknown>('POST', `/fwm/cost/months/${encodeURIComponent(month)}/decide`, body);
  }
  bookFwCostCharge(id: string, input: Parameters<Api['bookFwCostCharge']>[1], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/fw-cost-charges/${encodeURIComponent(id)}/book`, { ...input, proof });
  }
  personDocs(personId: string) {
    return this.call<Awaited<ReturnType<Api['personDocs']>>>('GET', `/people/${encodeURIComponent(personId)}/docs`);
  }
  uploadHiringDoc(personId: string, kind: Parameters<Api['uploadHiringDoc']>[1], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/hiring-docs`, { kind, proof });
  }
  updateHospitalClaim(leaveId: string, input: Parameters<Api['updateHospitalClaim']>[1], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/leave/${encodeURIComponent(leaveId)}/hospital-claim`, { ...input, proof });
  }
  submitFwRenewal(personId: string, paper: Parameters<Api['submitFwRenewal']>[1], input: Parameters<Api['submitFwRenewal']>[2], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/fw-renewals`, { paper, ...input, proof });
  }
  recordFwPaper(personId: string, paper: FwPaper, input: FwPaperInput, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/fw-papers`, { paper, ...input, proof });
  }
  ackFwPaper(credentialId: string, note: string) {
    return this.call<unknown>('POST', `/fw-papers/${encodeURIComponent(credentialId)}/ack`, { note });
  }
  addFwWorkerFromJa(jaRecordId: string, input: FwAddFromJaInput) {
    return this.call<unknown>('POST', `/fwm/ja-workers/${encodeURIComponent(jaRecordId)}/add`, input);
  }
  addFwWorker(input: Parameters<Api['addFwWorker']>[0]) {
    return this.call<unknown>('POST', '/fwm/workers', input);
  }
  createFwmTask(personId: string, input: Parameters<Api['createFwmTask']>[1]) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/fwm-tasks`, input);
  }
  doneFwmTask(id: string, note: string, proof: ProofInput[]) {
    return this.call<unknown>('POST', `/fwm-tasks/${encodeURIComponent(id)}/done`, { note, proof });
  }
  reviewFwmTask(id: string, accept: boolean, note: string) {
    return this.call<unknown>('POST', `/fwm-tasks/${encodeURIComponent(id)}/review`, { accept, note });
  }
  fwmWelfare() {
    return this.call<Awaited<ReturnType<Api['fwmWelfare']>>>('GET', '/fwm/welfare');
  }
  recordFwCheck(personId: string, input: Parameters<Api['recordFwCheck']>[1], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/people/${encodeURIComponent(personId)}/fw-checks`, { ...input, proof });
  }
  closeFwCheck(id: string, input: Parameters<Api['closeFwCheck']>[1], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/fw-checks/${encodeURIComponent(id)}/close`, { ...input, proof });
  }
  fwmRecruitment() {
    return this.call<Awaited<ReturnType<Api['fwmRecruitment']>>>('GET', '/fwm/recruitment');
  }
  openFwRecruitFile(input: Parameters<Api['openFwRecruitFile']>[0]) {
    return this.call<unknown>('POST', '/fwm/recruitment', input);
  }
  setFwRecruitTravel(id: string, input: Parameters<Api['setFwRecruitTravel']>[1]) {
    return this.call<unknown>('POST', `/fwm/recruitment/${encodeURIComponent(id)}/travel`, input);
  }
  recordFwRecruitStep(id: string, step: Parameters<Api['recordFwRecruitStep']>[1], input: Parameters<Api['recordFwRecruitStep']>[2], proof: ProofInput[]) {
    return this.call<unknown>('POST', `/fwm/recruitment/${encodeURIComponent(id)}/steps/${encodeURIComponent(step)}`, { ...input, proof });
  }
  clearFwRecruitFile(id: string, input: Parameters<Api['clearFwRecruitFile']>[1]) {
    return this.call<unknown>('POST', `/fwm/recruitment/${encodeURIComponent(id)}/clear`, input);
  }
  recordFwRecruitArrival(id: string, input: Parameters<Api['recordFwRecruitArrival']>[1]) {
    return this.call<unknown>('POST', `/fwm/recruitment/${encodeURIComponent(id)}/arrived`, input);
  }
  stopFwRecruitFile(id: string, input: Parameters<Api['stopFwRecruitFile']>[1]) {
    return this.call<unknown>('POST', `/fwm/recruitment/${encodeURIComponent(id)}/stop`, input);
  }
  advanceSocsoClaim(id: string, to: Parameters<Api['advanceSocsoClaim']>[1], input: Parameters<Api['advanceSocsoClaim']>[2]) {
    return this.call<unknown>('POST', `/socso/${encodeURIComponent(id)}/status`, { to, ...input });
  }
  // Cleaning planner, site fittings, Inventory and duty plans.
  cleaningBoard(date?: string) {
    return this.call<Awaited<ReturnType<Api['cleaningBoard']>>>('GET', `/cleaning/board${this.q({ date })}`);
  }
  cleaningSite(siteId: string, date?: string) {
    return this.call<Awaited<ReturnType<Api['cleaningSite']>>>('GET', `/cleaning/sites/${siteId}${this.q({ date })}`);
  }
  cleaningProof(siteId: string, docId: string) {
    return this.call<Awaited<ReturnType<Api['cleaningProof']>>>('GET', `/cleaning/sites/${siteId}/proof/${docId}`);
  }
  cleaningSaveSetup(siteId: string, setup: CleaningSetupInput, expectedVersion: number | null) {
    return this.call<unknown>('PUT', `/cleaning/sites/${siteId}/setup`, { setup, expectedVersion });
  }
  cleaningSetMap(siteId: string, input: { name: string; data: string }, expectedVersion: number) {
    return this.call<unknown>('POST', `/cleaning/sites/${siteId}/map`, { ...input, expectedVersion });
  }
  cleaningPlan(siteId: string, date: string, absentIds: string[]) {
    return this.call<unknown>('POST', `/cleaning/sites/${siteId}/days/${date}/plan`, { absentIds });
  }
  cleaningPublish(siteId: string, date: string) {
    return this.call<unknown>('POST', `/cleaning/sites/${siteId}/days/${date}/publish`, {});
  }
  cleaningRecord(siteId: string, date: string, input: CleaningRecordInput) {
    return this.call<unknown>('POST', `/cleaning/sites/${siteId}/days/${date}/record`, input);
  }
  cleaningDelivery(siteId: string, input: { date: string; supplies: StockLineInput[]; equipment: StockLineInput[]; note: string }) {
    return this.call<unknown>('POST', `/cleaning/sites/${siteId}/deliveries`, input);
  }
  cleaningReceive(siteId: string, entryId: string, input: { supplies: StockLineInput[]; equipment: StockLineInput[]; note: string; proof: CleaningProofInput }) {
    return this.call<unknown>('POST', `/cleaning/sites/${siteId}/deliveries/${entryId}/receive`, input);
  }
  cleaningStockCheck(siteId: string, input: { date: string; supplies: StockLineInput[]; equipment: StockLineInput[]; note: string; proof: CleaningProofInput }) {
    return this.call<unknown>('POST', `/cleaning/sites/${siteId}/stock-checks`, input);
  }
  cleaningClientSlip(siteId: string, input: CleaningSlipInput) {
    return this.call<unknown>('POST', `/cleaning/sites/${siteId}/client-slips`, input);
  }
  cleaningMonthly(siteId: string, month: string) {
    return this.call<Awaited<ReturnType<Api['cleaningMonthly']>>>('GET', `/cleaning/sites/${siteId}/monthly${this.q({ month })}`);
  }
  inventorySites() {
    return this.call<Awaited<ReturnType<Api['inventorySites']>>>('GET', '/inventory/sites');
  }
  siteKit(siteId: string) {
    return this.call<Awaited<ReturnType<Api['siteKit']>>>('GET', `/sites/${siteId}/kit`);
  }
  saveSiteKit(siteId: string, items: unknown[], expectedVersion: number | null) {
    return this.call<unknown>('PUT', `/sites/${siteId}/kit`, { items, expectedVersion });
  }
  recordSiteKit(siteId: string, input: { kind: 'install' | 'check'; date: string; lines: unknown[]; note: string; proof: CleaningProofInput }, expectedVersion: number) {
    return this.call<unknown>('POST', `/sites/${siteId}/kit/records`, { ...input, expectedVersion });
  }
  approveSiteGift(siteId: string, input: { ref: string; qty: number; reason: string }) {
    return this.call<unknown>('POST', `/sites/${siteId}/kit/gifts`, input);
  }
  closeOutList(siteId: string) {
    return this.call<Awaited<ReturnType<Api['closeOutList']>>>('GET', `/sites/${siteId}/close-out`);
  }
  recordTakeBack(siteId: string, input: { date: string; lines: unknown[]; note: string; proof: CleaningProofInput }) {
    return this.call<unknown>('POST', `/sites/${siteId}/close-out`, input);
  }
  dutyPosts(siteId: string, date: string) {
    return this.call<Awaited<ReturnType<Api['dutyPosts']>>>('GET', `/duty/sites/${siteId}${this.q({ date })}`);
  }
  publishDutyPosts(siteId: string, date: string) {
    return this.call<unknown>('POST', `/duty/sites/${siteId}/publish`, { date });
  }
  saveDutyTerms(siteId: string, terms: GuardTermsInput, expectedVersion: number | null) {
    return this.call<unknown>('PUT', `/duty/sites/${siteId}/terms`, { terms, expectedVersion });
  }
  dutyOfficers() {
    return this.call<Awaited<ReturnType<Api['dutyOfficers']>>>('GET', '/duty/officers');
  }
  dutyRoute(officerId: string, date: string, hours?: OfficerHoursInput | null) {
    return this.call<Awaited<ReturnType<Api['dutyRoute']>>>('GET', `/duty/officers/${officerId}${this.q({ date, start: hours?.start, end: hours?.end, meal: hours?.mealMin })}`);
  }
  publishDutyRoute(officerId: string, date: string, expectPublishedAt: string | null, hours?: OfficerHoursInput | null) {
    return this.call<unknown>('POST', `/duty/officers/${officerId}/publish`, { date, expectPublishedAt, hours: hours ?? null });
  }
  roster(siteId: string, from: string, days: number) {
    return this.call<Awaited<ReturnType<Api['roster']>>>('GET', `/sites/${siteId}/roster${this.q({ from, days })}`);
  }
  candidates(shiftId: string, q = '') {
    return this.call<Awaited<ReturnType<Api['candidates']>>>('GET', `/shifts/${shiftId}/candidates${this.q({ q })}`);
  }
  assign(shiftId: string, personId: string | null) {
    return this.call<{ warnings: { message: string }[] }>('POST', `/shifts/${shiftId}/assign`, { personId });
  }
  publish(siteId: string, from: string, to: string) {
    return this.call<{ published: number; unfilled: number }>('POST', `/sites/${siteId}/roster/publish`, { from, to });
  }
  addShifts(siteId: string, input: Parameters<Api['addShifts']>[1]) {
    return this.call<Awaited<ReturnType<Api['addShifts']>>>('POST', `/sites/${siteId}/roster/shifts`, input);
  }
  attendance(id: string, date: string) {
    return this.call<Awaited<ReturnType<Api['attendance']>>>('GET', `/companies/${id}/attendance${this.q({ date })}`);
  }
  lockAttendance(id: string, date: string) {
    return this.call<{ locked: number }>('POST', `/companies/${id}/attendance/lock`, { date });
  }
  clockIn(input: Parameters<Api['clockIn']>[0]) {
    return this.call<Awaited<ReturnType<Api['clockIn']>>>('POST', '/device/clock-in', input);
  }
  clockOut(input: Parameters<Api['clockOut']>[0]) {
    return this.call<Awaited<ReturnType<Api['clockOut']>>>('POST', '/device/clock-out', input);
  }
  scan(input: Parameters<Api['scan']>[0]) {
    return this.call<Awaited<ReturnType<Api['scan']>>>('POST', '/device/scan', input);
  }
  cases(filter: { companyId?: string; status?: 'active' | 'all'; waiting?: 'me' } = {}) {
    return this.call<Awaited<ReturnType<Api['cases']>>>('GET', `/cases${this.q(filter)}`);
  }
  caseDetail(id: string) {
    return this.call<Awaited<ReturnType<Api['caseDetail']>>>('GET', `/cases/${id}`);
  }
  addCasePhoto(id: string, input: PhotoInput) {
    return this.call<unknown>('POST', `/cases/${id}/photos`, input);
  }
  siteVisits(id: string) {
    return this.call<Awaited<ReturnType<Api['siteVisits']>>>('GET', `/sites/${id}/visits`);
  }
  startSiteVisit(id: string, input: Parameters<Api['startSiteVisit']>[1]) {
    return this.call<unknown>('POST', `/sites/${id}/visits`, input);
  }
  addVisitPhoto(id: string, input: PhotoInput) {
    return this.call<unknown>('POST', `/visits/${id}/photos`, input);
  }
  closeSiteVisit(id: string, findings: string) {
    return this.call<unknown>('POST', `/visits/${id}/close`, { findings });
  }
  siteSurveySetup() {
    return this.call<Awaited<ReturnType<Api['siteSurveySetup']>>>('GET', '/site-surveys/setup');
  }
  siteSurveyBoard() {
    return this.call<Awaited<ReturnType<Api['siteSurveyBoard']>>>('GET', '/site-surveys');
  }
  siteSurveyDetail(id: string) {
    return this.call<Awaited<ReturnType<Api['siteSurveyDetail']>>>('GET', `/site-surveys/${encodeURIComponent(id)}`);
  }
  siteSurveyReceive(body: Record<string, unknown>) {
    return this.call<Awaited<ReturnType<Api['siteSurveyReceive']>>>('POST', '/site-surveys', body);
  }
  siteSurveyPhoto(id: string, n: number, image: string) {
    return this.call<Awaited<ReturnType<Api['siteSurveyPhoto']>>>('POST', `/site-surveys/${encodeURIComponent(id)}/photos`, { n, image });
  }
  siteSurveyReview(id: string, outcome: 'accepted' | 'returned', reason: string) {
    return this.call<unknown>('POST', `/site-surveys/${encodeURIComponent(id)}/review`, { outcome, reason });
  }
  raiseCase(input: Parameters<Api['raiseCase']>[0]) {
    return this.call<Awaited<ReturnType<Api['raiseCase']>>>('POST', '/cases', input);
  }
  signOffCase(id: string, outcome: Parameters<Api['signOffCase']>[1], note: string, proof: ProofInput[] = []) {
    return this.call<Awaited<ReturnType<Api['signOffCase']>>>('POST', `/cases/${id}/signoff`, { outcome, note, proof });
  }
  updateCase(id: string, action: Parameters<Api['updateCase']>[1], note = '', proof: ProofInput[] = []) {
    return this.call<Awaited<ReturnType<Api['updateCase']>>>('POST', `/cases/${id}/${action}`, { note, proof });
  }
  myAlerts() {
    return this.call<Awaited<ReturnType<Api['myAlerts']>>>('GET', '/alerts/mine');
  }
  home(companyId?: string) {
    return this.call<Home>('GET', `/home${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`);
  }
  growth() {
    return this.call<GrowthPanel>('GET', '/growth');
  }
  approvalLimits() {
    return this.call<ApprovalLimitsView>('GET', '/approval-limits');
  }
  setApprovalLimits(body: { claimsMax: number | null; purchasesMax: number | null; comment: string }) {
    return this.call<unknown>('POST', '/approval-limits', body);
  }
  growthMargin() {
    return this.call<GrowthMargin>('GET', '/growth/margin');
  }
  regionalOps(region?: string) {
    return this.call<Awaited<ReturnType<Api['regionalOps']>>>('GET', `/ops/region${region ? `?region=${encodeURIComponent(region)}` : ''}`);
  }
  govOpsMonitor(month?: string) {
    return this.call<Awaited<ReturnType<Api['govOpsMonitor']>>>('GET', `/ops/government${month ? `?month=${encodeURIComponent(month)}` : ''}`);
  }
  privateOpsMonitor(month?: string) {
    return this.call<Awaited<ReturnType<Api['privateOpsMonitor']>>>('GET', `/ops/private${month ? `?month=${encodeURIComponent(month)}` : ''}`);
  }
  managementFeeBills(month?: string) {
    return this.call<Awaited<ReturnType<Api['managementFeeBills']>>>('GET', `/finance/management-fee-bills${month ? `?month=${encodeURIComponent(month)}` : ''}`);
  }
  managementFees() {
    return this.call<Awaited<ReturnType<Api['managementFees']>>>('GET', '/finance/management-fees');
  }
  setManagementFee(companyId: string, input: Parameters<Api['setManagementFee']>[1]) {
    return this.call<unknown>('POST', `/finance/management-fees/${encodeURIComponent(companyId)}`, input);
  }


  insurance() {
    return this.call<Awaited<ReturnType<Api['insurance']>>>('GET', '/insurance');
  }
  recordInsurancePremium(policyId: string, input: { paidOn: string; ref: string }) {
    return this.call<unknown>('POST', `/insurance/policies/${encodeURIComponent(policyId)}/premium`, input);
  }
  renewInsurancePolicy(policyId: string, input: Parameters<Api['renewInsurancePolicy']>[1]) {
    return this.call<unknown>('POST', `/insurance/policies/${encodeURIComponent(policyId)}/renew`, input);
  }
  cancelInsurancePolicy(policyId: string, input: { on: string; reason: string }) {
    return this.call<unknown>('POST', `/insurance/policies/${encodeURIComponent(policyId)}/cancel`, input);
  }
  hrMonitor() {
    return this.call<Awaited<ReturnType<Api['hrMonitor']>>>('GET', '/hr');
  }
  cms() {
    return this.call<Awaited<ReturnType<Api['cms']>>>('GET', '/cms');
  }
  cmsReadiness() {
    return this.call<Awaited<ReturnType<Api['cmsReadiness']>>>('GET', '/cms/readiness');
  }
  setCmsReadinessAnswer(siteId: string, key: string, input: Parameters<Api['setCmsReadinessAnswer']>[2]) {
    return this.call<Awaited<ReturnType<Api['setCmsReadinessAnswer']>>>('POST', `/cms/readiness/${encodeURIComponent(siteId)}/answers/${encodeURIComponent(key)}`, input);
  }
  saveCmsReadinessDevice(siteId: string, input: Parameters<Api['saveCmsReadinessDevice']>[1]) {
    return this.call<Awaited<ReturnType<Api['saveCmsReadinessDevice']>>>('POST', `/cms/readiness/${encodeURIComponent(siteId)}/devices`, input);
  }
  removeCmsReadinessDevice(siteId: string, deviceId: string, reason: string) {
    return this.call<Awaited<ReturnType<Api['removeCmsReadinessDevice']>>>(
      'POST',
      `/cms/readiness/${encodeURIComponent(siteId)}/devices/${encodeURIComponent(deviceId)}/remove`,
      { reason },
    );
  }
  reviewCmsReadiness(siteId: string, input: Parameters<Api['reviewCmsReadiness']>[1]) {
    return this.call<Awaited<ReturnType<Api['reviewCmsReadiness']>>>('POST', `/cms/readiness/${encodeURIComponent(siteId)}/review`, input);
  }
  updateCmsSettings(patch: CmsSettingsPatch) {
    return this.call<unknown>('POST', '/cms/settings', patch);
  }
  planCmsRoster(days: number) {
    return this.call<unknown>('POST', '/cms/roster/plan', { days });
  }
  recordCmsHandover(shiftId: string, note: string, agree = true) {
    return this.call<unknown>('POST', `/cms/shifts/${shiftId}/handover`, { note, agree });
  }
  giveCmsHandover(shiftId: string, note: string) {
    return this.call<unknown>('POST', `/cms/shifts/${shiftId}/handover-out`, { note });
  }
  cmsSeatClockIn(shiftId: string) {
    return this.call<unknown>('POST', `/cms/shifts/${shiftId}/clock-in`, {});
  }
  cmsSeatClockOut(shiftId: string, note: string) {
    return this.call<unknown>('POST', `/cms/shifts/${shiftId}/clock-out`, { note });
  }
  releaseCmsSeat(shiftId: string, reason: string) {
    return this.call<unknown>('POST', `/cms/shifts/${shiftId}/release`, { reason });
  }
  attendanceAlerts(id: string) {
    return this.call<Awaited<ReturnType<Api['attendanceAlerts']>>>('GET', `/companies/${id}/attendance/alerts`);
  }
  disciplineHistory(id: string, personId: string) {
    return this.call<Awaited<ReturnType<Api['disciplineHistory']>>>('GET', `/companies/${id}/people/${personId}/discipline`);
  }
  followUpAttendance(input: FollowUpInput) {
    return this.call<Awaited<ReturnType<Api['followUpAttendance']>>>('POST', '/attendance/follow-up', input);
  }
  acknowledgeAlarm(id: string) {
    return this.call<unknown>('POST', `/cms/alarms/${id}/ack`, {});
  }
  cmsDispatches() {
    return this.call<CmsDispatches>('GET', '/cms/dispatches');
  }
  sendDispatch(input: DispatchInput) {
    return this.call<unknown>('POST', '/cms/dispatches', input);
  }
  closeDispatch(id: string, outcome: 'real' | 'nothing_found' | 'done', note: string) {
    return this.call<unknown>('POST', `/cms/dispatches/${encodeURIComponent(id)}/close`, { outcome, note });
  }
  cancelDispatch(id: string, note: string) {
    return this.call<unknown>('POST', `/cms/dispatches/${encodeURIComponent(id)}/cancel`, { note });
  }
  deviceDispatches() {
    return this.call<DeviceDispatches>('GET', '/device/dispatches');
  }
  dispatchSeen(id: string) {
    return this.call<unknown>('POST', `/device/dispatches/${encodeURIComponent(id)}/seen`, {});
  }
  acknowledgeDispatch(id: string, input: { staffNo: string; pin: string }) {
    return this.call<unknown>('POST', `/device/dispatches/${encodeURIComponent(id)}/ack`, input);
  }
  addDispatchPhoto(id: string, input: PhotoInput) {
    return this.call<unknown>('POST', `/device/dispatches/${encodeURIComponent(id)}/photos`, input);
  }
  addDispatchVideo(id: string, input: VideoInput) {
    return this.call<unknown>('POST', `/device/dispatches/${encodeURIComponent(id)}/videos`, input);
  }
  replyDispatch(id: string, reply: string) {
    return this.call<unknown>('POST', `/device/dispatches/${encodeURIComponent(id)}/reply`, { reply });
  }
  dutyDevice() {
    return this.call<DutyDevice>('GET', '/device/duty');
  }
  addPostLog(input: PostLogInput) {
    return this.call<unknown>('POST', '/device/post-log', input);
  }
  gateIn(input: GateInInput) {
    return this.call<Awaited<ReturnType<Api['gateIn']>>>('POST', '/device/gate/in', input);
  }
  gateOut(id: string, input: Parameters<Api['gateOut']>[1]) {
    return this.call<unknown>('POST', `/device/gate/${encodeURIComponent(id)}/out`, input);
  }
  siteTaskBoard(siteId: string) {
    return this.call<SiteTaskBoard>('GET', `/sites/${encodeURIComponent(siteId)}/tasks`);
  }
  saveNeedsReview(siteId: string, input: NeedsReviewInput) {
    return this.call<unknown>('POST', `/sites/${encodeURIComponent(siteId)}/needs-reviews`, input);
  }
  setSiteTask(siteId: string, input: SiteTaskInput) {
    return this.call<unknown>('POST', `/sites/${encodeURIComponent(siteId)}/tasks`, input);
  }
  setGateLog(siteId: string, on: boolean, reason: string) {
    return this.call<unknown>('POST', `/sites/${encodeURIComponent(siteId)}/gate-log`, { on, reason });
  }
  stopSiteTask(id: string, reason: string) {
    return this.call<unknown>('POST', `/site-tasks/${encodeURIComponent(id)}/stop`, { reason });
  }
  doSiteTask(id: string, input: DoSiteTaskInput) {
    return this.call<unknown>('POST', `/device/tasks/${encodeURIComponent(id)}`, input);
  }
  clientCodeBoard(siteId: string) {
    return this.call<ClientCodeBoard>('GET', `/sites/${encodeURIComponent(siteId)}/client-codes`);
  }
  saveClientCode(siteId: string, input: ClientCodeInput) {
    return this.call<unknown>('POST', `/sites/${encodeURIComponent(siteId)}/client-codes`, input);
  }
  setClientReport(id: string, input: { send: boolean; how?: string; reason: string }) {
    return this.call<unknown>('POST', `/client-codes/${encodeURIComponent(id)}/report`, input);
  }
  stopClientCode(id: string, reason: string) {
    return this.call<unknown>('POST', `/client-codes/${encodeURIComponent(id)}/stop`, { reason });
  }
  checkClientRequirement(id: string, input: ClientCheckInput) {
    return this.call<unknown>('POST', `/client-codes/${encodeURIComponent(id)}/checks`, input);
  }
  saveClientInspection(id: string, input: ClientInspectionInput) {
    return this.call<unknown>('POST', `/client-codes/${encodeURIComponent(id)}/inspections`, input);
  }
  fixInspectionLine(id: string, index: number, input: { note: string; proof?: ProofInput[] }) {
    return this.call<unknown>('POST', `/client-inspections/${encodeURIComponent(id)}/fix`, { index, ...input });
  }
  selfAuditBoard(companyId: string) {
    return this.call<SelfAuditBoard>('GET', `/companies/${encodeURIComponent(companyId)}/self-audits`);
  }
  saveSelfAudit(companyId: string, input: SelfAuditInput) {
    return this.call<unknown>('POST', `/companies/${encodeURIComponent(companyId)}/self-audits`, input);
  }
  fixSelfAuditLine(id: string, key: string, input: { note: string; proof?: ProofInput[] }) {
    return this.call<unknown>('POST', `/self-audits/${encodeURIComponent(id)}/fix`, { key, ...input });
  }
  rbaBoard(companyId?: string | null) {
    return this.call<RbaBoard>('GET', `/rba${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`);
  }
  nameRbaCommittee(input: RbaCommitteeInput) {
    return this.call<unknown>('POST', '/rba/committee', input);
  }
  rbaTraceBoard(companyId: string) {
    return this.call<RbaTraceBoard>('GET', `/companies/${encodeURIComponent(companyId)}/rba-traces`);
  }
  runRbaTrace(companyId: string, period: string) {
    return this.call<unknown>('POST', `/companies/${encodeURIComponent(companyId)}/rba-traces`, { period });
  }
  settleRbaTraceRow(reviewId: string, personId: string, input: { kind: 'explained' | 'corrected' | 'finding'; note: string }) {
    return this.call<unknown>('POST', `/rba-traces/${encodeURIComponent(reviewId)}/settle`, { personId, ...input });
  }
  workerFiles(companyId: string) {
    return this.call<WorkerFilesBoard>('GET', `/companies/${encodeURIComponent(companyId)}/worker-files`);
  }
  ethicsBoard(companyId?: string | null) {
    return this.call<EthicsBoard>('GET', `/ethics${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`);
  }
  signEthicsDeclaration(input: EthicsInput) {
    return this.call<unknown>('POST', '/ethics', input);
  }
  reviewEthicsInterests(id: string, input: { action: 'no_conflict' | 'managed'; note: string }) {
    return this.call<unknown>('POST', `/ethics/${encodeURIComponent(id)}/review`, input);
  }
  siteDutyLog(siteId: string, days = 2) {
    return this.call<SiteDutyLog>('GET', `/sites/${encodeURIComponent(siteId)}/duty-log?days=${days}`);
  }
  requestTrip(input: { date: string; destination: string; purpose: string; forPersonId?: string }) {
    return this.call<unknown>('POST', '/claims/trips', input);
  }
  decideTrip(id: string, ok: boolean, note: string) {
    return this.call<unknown>('POST', `/claims/trips/${encodeURIComponent(id)}/decide`, { ok, note });
  }
  whistleReview(id: string, agree: boolean, note: string) {
    return this.call<unknown>('POST', `/grc/reports/${encodeURIComponent(id)}/review`, { agree, note });
  }
  confirmStockLoss(id: string, ok: boolean, note: string) {
    return this.call<unknown>('POST', `/purchasing/issues/${encodeURIComponent(id)}/confirm-loss`, { ok, note });
  }
  stockCount(itemId: string, counted: number, witness: { staffNo: string; pin: string }) {
    return this.call<unknown>('POST', `/purchasing/stock/${encodeURIComponent(itemId)}/count`, { counted, witness });
  }
  amDecideReversal(unitId: string, paymentId: string, approve: boolean, note: string) {
    return this.call<unknown>('POST', `/asset-units/${encodeURIComponent(unitId)}/payments/${encodeURIComponent(paymentId)}/reversal`, { approve, note });
  }
  reviewFalseAlarm(id: string, agree: boolean, note: string) {
    return this.call<unknown>('POST', `/cms/alarms/${id}/review`, { agree, note });
  }
  closeAlarm(id: string, verdict: 'real' | 'false', note: string) {
    return this.call<unknown>('POST', `/cms/alarms/${id}/close`, { verdict, note });
  }
  logCallback(callId: string, note: string) {
    return this.call<unknown>('POST', `/cms/calls/${callId}/callback`, { note });
  }
  assignCmsShift(id: string, staffName: string) {
    return this.call<unknown>('POST', `/cms/shifts/${id}/assign`, { staffName });
  }
  reviewArmsRequest(id: string, decision: 'pass' | 'return', note: string) {
    return this.call<unknown>('POST', `/arms/requests/${id}/review`, { decision, note });
  }
  specialOpsLegalFlags() {
    return this.call<SpecialOpsLegalFlags>('GET', '/arms/legal-flags');
  }
  raiseArmsRequest(input: RaiseArmsRequestInput) {
    return this.call<unknown>('POST', '/arms/requests', input);
  }
  armsRequestStep(id: string, action: ArmsRequestAction, reason: string, extra: ArmsRequestStepExtra = {}) {
    return this.call<unknown>('POST', `/arms/requests/${id}/step`, { action, reason, ...extra });
  }
  armsTrading() {
    return this.call<ArmsTradingState>('GET', '/arms/trading');
  }
  setArmsTrading(on: boolean, reason: string) {
    return this.call<unknown>('POST', '/arms/trading', { on, reason });
  }
  transportBoard() {
    return this.call<TransportBoard>('GET', '/transport/board');
  }
  amRentCheck() {
    return this.call<AmRentCheck>('GET', '/am/rent-check');
  }
  amBuyRequest(input: AmBuyInput) {
    return this.call<unknown>('POST', '/am/purchases', input);
  }
  amBuyDecide(id: string, approve: boolean, reason: string, seenEstCost?: number) {
    return this.call<unknown>('POST', `/am/purchases/${id}/decide`, { approve, reason, estCost: seenEstCost });
  }
  amBuyReceived(id: string, input: { tag: string; cost: number; boughtOn: string }) {
    return this.call<unknown>('POST', `/am/purchases/${id}/received`, input);
  }
  amBuyReprice(id: string, estCost: number, reason: string) {
    return this.call<unknown>('POST', `/am/purchases/${id}/reprice`, { estCost, reason });
  }
  amWhatsApp() {
    return this.call<AmWhatsAppBoard>('GET', '/am/whatsapp');
  }
  amWhatsAppConsent(unitId: string, on: boolean, how: string) {
    return this.call<unknown>('POST', `/am/whatsapp/units/${unitId}/consent`, { on, how });
  }
  amWhatsAppSettle(unitId: string, reminderId: string, outcome: 'went' | 'resend' | 'drop', reason: string) {
    return this.call<unknown>('POST', `/am/whatsapp/units/${encodeURIComponent(unitId)}/reminders/${encodeURIComponent(reminderId)}/settle`, { outcome, reason });
  }
  amWhatsAppRun() {
    return this.call<{ queued: number; cancelled: number; sent: number; failed: number; sending: boolean }>('POST', '/am/whatsapp/run');
  }
  armsControl() {
    return this.call<Awaited<ReturnType<Api['armsControl']>>>('GET', '/arms/control');
  }
  armsOverview() {
    return this.call<Awaited<ReturnType<Api['armsOverview']>>>('GET', '/arms');
  }
  arms(id: string) {
    return this.call<Awaited<ReturnType<Api['arms']>>>('GET', `/companies/${id}/arms`);
  }
  issueFirearm(input: Parameters<Api['issueFirearm']>[0]) {
    return this.call<unknown>('POST', '/arms/issue', input);
  }
  planArmedJob(input: Parameters<Api['planArmedJob']>[0]) {
    return this.call<unknown>('POST', '/arms/jobs', input);
  }
  updateArmedJob(id: string, status: Parameters<Api['updateArmedJob']>[1], note: string) {
    return this.call<unknown>('POST', `/arms/jobs/${encodeURIComponent(id)}/update`, { status, note });
  }
  returnFirearm(id: string, input: Parameters<Api['returnFirearm']>[1]) {
    return this.call<{ caseRef: string | null }>('POST', `/arms/movements/${id}/return`, input);
  }
  escalateFirearm(id: string) {
    return this.call<Awaited<ReturnType<Api['escalateFirearm']>>>('POST', `/arms/movements/${id}/escalate`);
  }
  countVault(id: string, input: Parameters<Api['countVault']>[1]) {
    return this.call<Awaited<ReturnType<Api['countVault']>>>('POST', `/vaults/${id}/count`, input);
  }
  commercial(id: string) {
    return this.call<Awaited<ReturnType<Api['commercial']>>>('GET', `/companies/${id}/commercial`);
  }
  createQuotation(id: string, input: Parameters<Api['createQuotation']>[1]) {
    return this.call<Awaited<ReturnType<Api['createQuotation']>>>('POST', `/companies/${id}/quotations`, input);
  }
  addTender(companyId: string, input: Parameters<Api['addTender']>[1]) {
    return this.call<Awaited<ReturnType<Api['addTender']>>>('POST', `/companies/${encodeURIComponent(companyId)}/tenders`, input);
  }
  correctQuotation(id: string, input: Parameters<Api['correctQuotation']>[1]) {
    return this.call<Awaited<ReturnType<Api['correctQuotation']>>>('POST', `/quotations/${encodeURIComponent(id)}/correct`, input);
  }
  quotationAction(id: string, action: Parameters<Api['quotationAction']>[1], note = '') {
    return this.call<Awaited<ReturnType<Api['quotationAction']>>>('POST', `/quotations/${id}/${action}`, { note });
  }
  addTenderPapers(tenderId: string, kind: Parameters<Api['addTenderPapers']>[1], proof: Parameters<Api['addTenderPapers']>[2]) {
    return this.call('POST', `/tenders/${tenderId}/papers`, { kind, proof });
  }
  draftTenderChecklist(tenderId: string) {
    return this.call('POST', `/tenders/${tenderId}/checklist/draft`, {});
  }
  setTenderBidFiles(tenderId: string, files: Parameters<Api['setTenderBidFiles']>[1]) {
    return this.call('POST', `/tenders/${tenderId}/files`, { files });
  }
  uploadTenderBidFile(tenderId: string, fileId: string, proof: ProofInput[]) {
    return this.call('POST', `/tenders/${tenderId}/files/${fileId}`, { proof });
  }
  confirmTenderBidFile(tenderId: string, fileId: string) {
    return this.call('POST', `/tenders/${tenderId}/files/${fileId}/check`, {});
  }
  reviewTenderChecklist(tenderId: string, input: Parameters<Api['reviewTenderChecklist']>[1]) {
    return this.call('POST', `/tenders/${tenderId}/checklist/review`, input);
  }
  verifyTender(tenderId: string, approve: boolean, note: string) {
    return this.call('POST', `/tenders/${tenderId}/verify`, { approve, note });
  }
  submitTender(tenderId: string, note: string, proof: Parameters<Api['submitTender']>[2]) {
    return this.call('POST', `/tenders/${tenderId}/submit`, { note, proof });
  }
  meetings() {
    return this.call<Awaited<ReturnType<Api['meetings']>>>('GET', '/meetings');
  }
  scheduleMeeting(input: Parameters<Api['scheduleMeeting']>[0]) {
    return this.call('POST', '/meetings', input);
  }
  addMinutes(meetingId: string, text: string, attendance?: Parameters<Api['addMinutes']>[2]) {
    return this.call('POST', `/meetings/${meetingId}/minutes`, { text, attendance });
  }
  changeMeeting(meetingId: string, input: Parameters<Api['changeMeeting']>[1]) {
    return this.call('POST', `/meetings/${encodeURIComponent(meetingId)}/change`, input);
  }
  cancelMeeting(meetingId: string, reason: string) {
    return this.call('POST', `/meetings/${encodeURIComponent(meetingId)}/cancel`, { reason });
  }
  answerMeeting(meetingId: string, answer: 'yes' | 'no' | 'maybe', note: string) {
    return this.call('POST', `/meetings/${encodeURIComponent(meetingId)}/answer`, { answer, note });
  }
  checkMeetingSummary(meetingId: string, input: Parameters<Api['checkMeetingSummary']>[1]) {
    return this.call('POST', `/meetings/${meetingId}/summary-check`, input);
  }
  setMeetingAction(meetingId: string, index: number, done: boolean, note = '') {
    return this.call('POST', `/meetings/${meetingId}/actions/${index}`, { done, note });
  }
  addMeetingAction(meetingId: string, input: Parameters<Api['addMeetingAction']>[1]) {
    return this.call('POST', `/meetings/${encodeURIComponent(meetingId)}/actions`, input);
  }
  setMeetingPrep(meetingId: string, input: { index?: number; done?: boolean; add?: string }) {
    return this.call('POST', `/meetings/${meetingId}/prep`, input);
  }
  reports() {
    return this.call<Awaited<ReturnType<Api['reports']>>>('GET', '/reports');
  }
  setReportDefs(defs: ReportDef[], note: string) {
    return this.call<unknown>('POST', '/reports/list', { defs, note });
  }
  submitReport(input: Parameters<Api['submitReport']>[0]) {
    return this.call('POST', '/reports', input);
  }
  tenderGroups() {
    return this.call<Awaited<ReturnType<Api['tenderGroups']>>>('GET', '/tender-groups');
  }
  createTenderGroup(sourceTenderId: string, companyIds: string[]) {
    return this.call<unknown>('POST', '/tender-groups', { sourceTenderId, companyIds });
  }
  tenderCounter() {
    return this.call<Awaited<ReturnType<Api['tenderCounter']>>>('GET', '/tender-counter');
  }
  directorOfficeCounter() {
    return this.call<Awaited<ReturnType<Api['directorOfficeCounter']>>>('GET', '/director-office-counter');
  }
  tenderOpportunities() {
    return this.call<Awaited<ReturnType<Api['tenderOpportunities']>>>('GET', '/tender-opportunities');
  }
  recordTenderOpportunity(input: OpportunityInput) {
    return this.call<unknown>('POST', '/tender-opportunities', input);
  }
  enterTenderOpportunity(id: string, companyIds: string[], note: string) {
    return this.call<unknown>('POST', `/tender-opportunities/${encodeURIComponent(id)}/enter`, { companyIds, note });
  }
  tenderSources() {
    return this.call<Awaited<ReturnType<Api['tenderSources']>>>('GET', '/tender-sources');
  }
  addTenderSource(input: { buyer: string; urls: string[]; note: string }) {
    return this.call<unknown>('POST', '/tender-sources', input);
  }
  loadTenderSourceStarter() {
    return this.call<unknown>('POST', '/tender-sources/starter', {});
  }
  updateTenderSource(id: string, input: { urls?: string[]; note?: string; active?: boolean }) {
    return this.call<unknown>('POST', `/tender-sources/${encodeURIComponent(id)}`, input);
  }
  recordTenderSourceCheck(id: string, input: SourceCheckInput) {
    return this.call<unknown>('POST', `/tender-sources/${encodeURIComponent(id)}/check`, input);
  }
  tenderBoard() {
    return this.call<Awaited<ReturnType<Api['tenderBoard']>>>('GET', '/tender-board');
  }
  tenderProtocol() {
    return this.call<Awaited<ReturnType<Api['tenderProtocol']>>>('GET', '/tender-protocol');
  }
  setTenderProtocol(input: Parameters<Api['setTenderProtocol']>[0]) {
    return this.call('POST', '/tender-protocol', input);
  }
  doTenderStep(tenderId: string, stepId: string, note: string, proof: Parameters<Api['doTenderStep']>[3], opts?: Parameters<Api['doTenderStep']>[4]) {
    return this.call('POST', `/tenders/${tenderId}/steps/${encodeURIComponent(stepId)}`, { note, proof, ...opts });
  }
  undoTenderStep(tenderId: string, stepId: string) {
    return this.call('POST', `/tenders/${tenderId}/steps/${encodeURIComponent(stepId)}/undo`, {});
  }
  confirmTenderNa(tenderId: string, stepId: string, accept: boolean, note: string) {
    return this.call('POST', `/tenders/${tenderId}/steps/${encodeURIComponent(stepId)}/na`, { accept, note });
  }
  planTenderStep(tenderId: string, stepId: string, pic: string, due: string | null) {
    return this.call('POST', `/tenders/${tenderId}/steps/${encodeURIComponent(stepId)}/plan`, { pic, due });
  }
  decideTender(tenderId: string, choice: Parameters<Api['decideTender']>[1], reason: string) {
    return this.call('POST', `/tenders/${tenderId}/decision`, { choice, reason });
  }
  setTenderRecord(tenderId: string, record: Parameters<Api['setTenderRecord']>[1], leadOnly?: boolean) {
    return this.call('POST', `/tenders/${tenderId}/record`, { record, leadOnly });
  }
  addTenderQuery(tenderId: string, text: string, ref: string) {
    return this.call('POST', `/tenders/${tenderId}/queries`, { text, ref });
  }
  setTenderQuery(tenderId: string, queryId: string, status: Parameters<Api['setTenderQuery']>[2], answer: string) {
    return this.call('POST', `/tenders/${tenderId}/queries/${encodeURIComponent(queryId)}`, { status, answer });
  }
  updateTender(id: string, status: Parameters<Api['updateTender']>[1]) {
    return this.call<Awaited<ReturnType<Api['updateTender']>>>('POST', `/tenders/${id}/status`, { status });
  }
  compliance() {
    return this.call<Awaited<ReturnType<Api['compliance']>>>('GET', '/compliance');
  }
  audit() {
    return this.call<Awaited<ReturnType<Api['audit']>>>('GET', '/audit');
  }
  handoverStep(id: string, step: Parameters<Api['handoverStep']>[1], input: Parameters<Api['handoverStep']>[2]) {
    return this.call<unknown>('POST', `/purchasing/issues/${encodeURIComponent(id)}/handover/${step}`, input);
  }
  policeHelp() {
    return this.call<Awaited<ReturnType<Api['policeHelp']>>>('GET', '/arms/police-help');
  }
  askPoliceHelp(input: Parameters<Api['askPoliceHelp']>[0]) {
    return this.call<{ ref: string }>('POST', '/arms/police-help', input);
  }
  assignPoliceHelp(id: string, input: Parameters<Api['assignPoliceHelp']>[1]) {
    return this.call<unknown>('POST', `/arms/police-help/${encodeURIComponent(id)}/assign`, input);
  }
  recordPoliceHelpOutcome(id: string, input: Parameters<Api['recordPoliceHelpOutcome']>[1]) {
    return this.call<unknown>('POST', `/arms/police-help/${encodeURIComponent(id)}/outcome`, input);
  }
  answerPoliceHelp(id: string, decision: 'confirm' | 'return', note: string) {
    return this.call<unknown>('POST', `/arms/police-help/${encodeURIComponent(id)}/answer`, { decision, note });
  }
  withdrawPoliceHelp(id: string, note: string) {
    return this.call<unknown>('POST', `/arms/police-help/${encodeURIComponent(id)}/withdraw`, { note });
  }
  contractProof(id: string) {
    return this.call<Awaited<ReturnType<Api['contractProof']>>>('GET', `/contracts/${encodeURIComponent(id)}/proof`);
  }
  addMobItem(id: string, input: Parameters<Api['addMobItem']>[1]) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(id)}/items`, input);
  }
  certifyContractRound(id: string, round: number, note: string) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(id)}/rounds/${round}/certify`, { note });
  }
  renewContract(id: string, input: Parameters<Api['renewContract']>[1]) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(id)}/renew`, input);
  }
  linkContractClient(id: string, accountId: string) {
    return this.call<unknown>('POST', `/contracts/${encodeURIComponent(id)}/client`, { accountId });
  }
  readContractPaper(input: { companyId: string; clientAccountId: string | null; text: string }) {
    return this.call<PaperReadingResult>('POST', '/contracts/read-paper', input);
  }
  cmsHours(month?: string) {
    return this.call<Awaited<ReturnType<Api['cmsHours']>>>('GET', `/cms/hours${month ? `?month=${encodeURIComponent(month)}` : ''}`);
  }
  qualityRegister(opts: { companyId?: string; standard?: 'ISO9001' | 'PIKM' } = {}) {
    const q = new URLSearchParams();
    if (opts.companyId) q.set('companyId', opts.companyId);
    if (opts.standard) q.set('standard', opts.standard);
    return this.call<Awaited<ReturnType<Api['qualityRegister']>>>('GET', `/quality/register${q.size ? `?${q}` : ''}`);
  }
  qualityMatrix(opts: { companyId?: string } = {}) {
    return this.call<Awaited<ReturnType<Api['qualityMatrix']>>>('GET', `/quality/matrix${opts.companyId ? `?companyId=${encodeURIComponent(opts.companyId)}` : ''}`);
  }
  qualityFoundation() {
    return this.call<Awaited<ReturnType<Api['qualityFoundation']>>>('GET', '/quality/foundation');
  }
  qualityAction(action: string, input: Record<string, unknown>) {
    return this.call<unknown>('POST', `/quality/${encodeURIComponent(action)}`, input);
  }
  salaryCalcData() {
    return this.call<Awaited<ReturnType<Api['salaryCalcData']>>>('GET', '/salary-calc');
  }
  jaSwitchBoard() {
    return this.call<Awaited<ReturnType<Api['jaSwitchBoard']>>>('GET', '/ja/switch');
  }
  jaSwitchReport(companyId: string, area: string) {
    return this.call<Awaited<ReturnType<Api['jaSwitchReport']>>>('GET', `/ja/switch/${encodeURIComponent(companyId)}/${encodeURIComponent(area)}`);
  }
  jaSwitchAct(companyId: string, area: string, action: Parameters<Api['jaSwitchAct']>[2], body: Record<string, unknown>) {
    return this.call<unknown>('POST', `/ja/switch/${encodeURIComponent(companyId)}/${encodeURIComponent(area)}/${action}`, body);
  }
  jaSwitchSettings(body: Record<string, unknown>) {
    return this.call<unknown>('POST', '/ja/switch-settings', body);
  }
  jaImportStage(body: Record<string, unknown>) {
    return this.call<unknown>('POST', '/ja/imports', body);
  }
  jaImportDecide(id: string, body: Record<string, unknown>) {
    return this.call<unknown>('POST', `/ja/imports/${encodeURIComponent(id)}/decide`, body);
  }
  jaGuardHistory(companyId: string, staffNo: string) {
    return this.call<Awaited<ReturnType<Api['jaGuardHistory']>>>('GET', `/ja/history/${encodeURIComponent(companyId)}/${encodeURIComponent(staffNo)}`);
  }
  qualityOps(opts: { companyId?: string } = {}) {
    return this.call<Awaited<ReturnType<Api['qualityOps']>>>('GET', `/quality/operations${opts.companyId ? `?companyId=${encodeURIComponent(opts.companyId)}` : ''}`);
  }
}

