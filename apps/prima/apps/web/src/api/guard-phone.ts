/**
 * The guard's own phone (third audit item 2, Fauzan 5 Nov 2026): its own small client, separate from the office
 * sign-in. The phone keeps its enrolment (guard sign-in id, phone id and its own secret) in this browser's storage, and
 * after face plus PIN a sign-in token. Server: /api/guard-phone (switched off unless GUARD_PHONE=on).
 */
import type { GuardDevice, GuardPhoneService, PrimaService, User } from '@prima/core';
import { ApiError } from './types';

type R<K extends keyof GuardPhoneService> = GuardPhoneService[K] extends (...args: never[]) => Promise<infer T> ? T : never;

export type GuardPhoneStatus = R<'status'> & { engine: 'phone' | 'server' };
export type GuardPhoneMe = R<'me'>;
export type GuardHeartbeat = R<'heartbeat'>;
export type GuardSos = R<'sos'>;
/** P93: the guard's own duty (roster, clock record, papers running out), the same view-only answer as /api/me/duty. */
export type GuardDuty = Awaited<ReturnType<PrimaService['myDuty']>>;
export type GuardChallenge = { engine: 'phone' } | { engine: 'server'; token: string; steps: ('centre' | 'left' | 'right')[]; expiresAt: string };
export type GuardSignInInput = { pin: string; descriptor?: number[]; live?: boolean; photo?: string; token?: string; frames?: string[] };
export type GuardFix = { lat: number | null; lng: number | null; accuracyM: number | null };

export interface GuardPhoneClient {
  readonly mode: 'server' | 'demo';
  device(): GuardDevice | null;
  /** Forget this phone's enrolment on this browser (a retired phone, or the guard asked). */
  forget(): void;
  signedIn(): boolean;
  enrol(input: { userId: string; phoneId: string; code: string; staffNo: string }): Promise<GuardDevice>;
  status(): Promise<GuardPhoneStatus>;
  registerFace(pin: string, photo: string, descriptor: number[] | null): Promise<unknown>;
  challenge(): Promise<GuardChallenge>;
  signIn(input: GuardSignInInput): Promise<void>;
  me(): Promise<GuardPhoneMe>;
  /** P93: own roster, clock-in record and reminders (papers running out), view only. */
  duty(): Promise<GuardDuty>;
  heartbeat(fix: GuardFix, battery: number | null): Promise<GuardHeartbeat>;
  sos(fix: GuardFix): Promise<GuardSos>;
  signOut(): Promise<void>;
  /** Test version only: the company office issues a code for the sample guard, so the whole path can be tried. */
  demoCode?(): Promise<{ userId: string; phoneId: string; code: string; staffNo: string; name: string }>;
}

const DEVICE_KEY = 'prima-guard-device';
const TOKEN_KEY = 'prima-guard-token';

function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, v: unknown | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private window: the phone enrols again next time */
  }
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : 'Browser';
  return `${os} phone`;
}

abstract class StoredDevice {
  protected dev: GuardDevice | null = load<GuardDevice>(DEVICE_KEY);
  protected token: string | null = load<string>(TOKEN_KEY);
  device() {
    return this.dev;
  }
  signedIn() {
    return !!this.token;
  }
  forget() {
    this.dev = null;
    this.token = null;
    save(DEVICE_KEY, null);
    save(TOKEN_KEY, null);
  }
  protected keep(d: GuardDevice) {
    this.dev = d;
    save(DEVICE_KEY, d);
  }
  protected setToken(t: string | null) {
    this.token = t;
    save(TOKEN_KEY, t);
  }
  protected need(): GuardDevice {
    if (!this.dev) throw new ApiError('This phone is not enrolled yet.', 401);
    return this.dev;
  }
}

export class HttpGuardPhone extends StoredDevice implements GuardPhoneClient {
  readonly mode = 'server' as const;
  constructor(private base = '') {
    super();
  }

  private async call<T>(path: string, body?: unknown, auth = false): Promise<T> {
    const res = await fetch(`${this.base}/api/guard-phone${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(auth && this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (auth && res.status === 401) this.setToken(null);
      // A retired phone: forget it, so the screen offers enrolment again.
      if (!auth && res.status === 403 && /not enrolled/.test(String(data.message))) this.forget();
      throw new ApiError(data.message ?? `Request failed (${res.status})`, res.status, []);
    }
    return data as T;
  }

  async enrol(input: { userId: string; phoneId: string; code: string; staffNo: string }) {
    const d = await this.call<GuardDevice>('/enrol', { ...input, deviceLabel: deviceLabel() });
    this.keep(d);
    return d;
  }
  status() {
    return this.call<GuardPhoneStatus>('/status', { device: this.need() });
  }
  registerFace(pin: string, photo: string, descriptor: number[] | null) {
    return this.call('/face', { device: this.need(), pin, photo, ...(descriptor ? { descriptor } : {}) });
  }
  challenge() {
    return this.call<GuardChallenge>('/challenge', { device: this.need() });
  }
  async signIn(input: GuardSignInInput) {
    const r = await this.call<{ token: string }>('/sign-in', { device: this.need(), ...input });
    this.setToken(r.token);
  }
  me() {
    return this.call<GuardPhoneMe>('/me', undefined, true);
  }
  async duty() {
    // The guard's own view, signed in with the phone's token (the same route the guard's own sign-in uses).
    const res = await fetch(`${this.base}/api/me/duty`, { headers: this.token ? { authorization: `Bearer ${this.token}` } : {} });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) this.setToken(null);
      throw new ApiError(data.message ?? `Request failed (${res.status})`, res.status, []);
    }
    return data as GuardDuty;
  }
  heartbeat(fix: GuardFix, battery: number | null) {
    return this.call<GuardHeartbeat>('/me/heartbeat', { ...fix, capturedAt: new Date().toISOString(), battery }, true);
  }
  sos(fix: GuardFix) {
    // Signed in: the session. Not signed in (or it ran out): the phone's own secret. Never held up for a PIN or face.
    if (this.token) return this.call<GuardSos>('/me/sos', fix, true).catch(() => this.call<GuardSos>('/sos', { device: this.need(), ...fix }));
    return this.call<GuardSos>('/sos', { device: this.need(), ...fix });
  }
  async signOut() {
    await this.call('/me/sign-out', {}, true).catch(() => undefined);
    this.setToken(null);
  }
}

/** What the test version gives this client: the in-browser service and a way to act as a sample person. */
export interface DemoGuardHost {
  svc(): Promise<PrimaService>;
  user(id: string): Promise<User>;
  toApiError(e: unknown): never;
}

/** The test version: the same service in the browser, with made-up data. Enrolments last until the page is reloaded. */
export class DemoGuardPhone extends StoredDevice implements GuardPhoneClient {
  readonly mode = 'demo' as const;
  constructor(private host: DemoGuardHost) {
    super();
    // The test data is made fresh on each visit, so an enrolment from an earlier visit is gone.
    this.forget();
  }
  private async run<T>(userId: string, fn: (g: GuardPhoneService, u: User) => Promise<T>): Promise<T> {
    try {
      const svc = await this.host.svc();
      return await fn(svc.guardPhone, await this.host.user(userId));
    } catch (e) {
      return this.host.toApiError(e);
    }
  }
  private session(): string {
    if (!this.token) throw new ApiError('Sign in again on your phone.', 401);
    return this.token;
  }

  async demoCode() {
    const guard = await this.host.user('u-guard-sasa-1');
    return this.run('u-cm-sasa', async (g, cm) => {
      const c = await g.issueCode(cm, guard.personId!);
      return { userId: c.userId, phoneId: c.phoneId, code: c.code, staffNo: c.staffNo, name: c.name };
    });
  }
  async enrol(input: { userId: string; phoneId: string; code: string; staffNo: string }) {
    const r = await this.run(input.userId, (g, u) => g.enrol(u, { ...input, deviceLabel: deviceLabel() }));
    if (!r.ok) throw new ApiError(r.message, 400);
    this.keep(r.device);
    return r.device;
  }
  async status() {
    const d = this.need();
    return { ...(await this.run(d.userId, (g, u) => g.status(u, d))), engine: 'phone' as const };
  }
  async registerFace(pin: string, photo: string, descriptor: number[] | null) {
    const d = this.need();
    const r = await this.run(d.userId, (g, u) => g.registerFace(u, d, { pin, photo, descriptor: descriptor ?? [], descriptorBy: 'phone' }));
    if (!r.ok) throw new ApiError(r.message, 400);
    // The test version: HR approves straight away, so the sign-in can be tried at once.
    const svc = await this.host.svc();
    const hr = await this.host.user('u-pwvsb-hr');
    const u = await this.host.user(d.userId);
    await svc.decideFace(hr, u.personId!, true, 'Test version: approved automatically').catch(() => undefined);
    return r;
  }
  async challenge(): Promise<GuardChallenge> {
    return { engine: 'phone' };
  }
  async signIn(input: GuardSignInInput) {
    const d = this.need();
    const r = await this.run(d.userId, (g, u) => g.signIn(u, d, { pin: input.pin, face: { engine: 'phone', descriptor: input.descriptor ?? null, live: input.live === true, photo: input.photo ?? '' } }));
    if (!r.ok) throw new ApiError(r.message, r.reason === 'locked' ? 423 : 401);
    this.setToken(r.session.id);
  }
  me() {
    return this.run(this.need().userId, (g, u) => g.me(u, this.session()));
  }
  async duty() {
    const d = this.need();
    this.session();
    try {
      const svc = await this.host.svc();
      return await svc.myDuty(await this.host.user(d.userId));
    } catch (e) {
      return this.host.toApiError(e);
    }
  }
  heartbeat(fix: GuardFix, battery: number | null) {
    return this.run(this.need().userId, (g, u) => g.heartbeat(u, this.session(), { ...fix, battery }));
  }
  sos(fix: GuardFix) {
    const d = this.need();
    return this.run(d.userId, (g, u) => g.sos(u, this.token ? { sessionId: this.token } : { device: d }, fix));
  }
  async signOut() {
    const d = this.dev;
    if (d && this.token) await this.run(d.userId, (g, u) => g.signOut(u, this.token!)).catch(() => undefined);
    this.setToken(null);
  }
}
