/**
 * Routes for guards' own phones (packages/core/src/guard-phone.ts). Everything here answers "switched off" unless
 * GUARD_PHONE=on (guard-phone.ts).
 *
 * Before sign-in, the phone proves itself with its device credential (guard sign-in id, phone id and the phone's own
 * secret, from enrolment). Each such call runs as that guard inside the database's company wall, and the service checks
 * the phone secret before anything else. After face plus PIN the phone gets a token for the rest.
 */
import { BadRequestException, Body, Controller, Get, HttpException, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { GuardDevice } from '@prima/core';
import { AuthGuard, GuardSession, UserId, guardPhoneAdmits, type AuthedRequest } from './auth';
import { faceSetup } from './controllers';
import { Db } from './db';
import { issueFaceChallenge, openFaceChallenge, type FaceEngine } from './face-engine';
import { GuardPhoneLimiter, guardPhoneConfig, issueGuardToken } from './guard-phone';

const limiter = new GuardPhoneLimiter();

function str(v: unknown, name: string, max = 2000): string {
  if (typeof v !== 'string' || !v || v.length > max) throw new BadRequestException(`${name} is missing or too long`);
  return v;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function device(v: unknown): GuardDevice {
  const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { userId: str(d.userId, 'device.userId', 120), phoneId: str(d.phoneId, 'device.phoneId', 80), secret: str(d.secret, 'device.secret', 200) };
}

/** The switch, checked on every route; a phone sees a plain answer when it is off. */
function on() {
  const cfg = guardPhoneConfig();
  if (!cfg.on || !cfg.secret) throw new NotFoundException('Guard phone sign-in is switched off on this server.');
  return cfg as { on: true; secret: string };
}

function limit(req: AuthedRequest, route: string) {
  if (!limiter.allow(`${req.ip ?? 'unknown'}:${route}`)) throw new HttpException('Too many tries. Wait a minute and try again.', 429);
}

/** Before sign-in: the phone's own credential. */
@Controller('api/guard-phone')
export class GuardPhoneOpenController {
  constructor(private db: Db) {}

  /** Enrol this phone with the one-time code from the company office and the guard's own staff number. */
  @Post('enrol')
  async enrol(@Req() req: AuthedRequest, @Body() b: Record<string, unknown>) {
    on();
    limit(req, 'enrol');
    const userId = str(b.userId, 'userId', 120);
    await guardPhoneAdmits(this.db, userId);
    const input = {
      phoneId: str(b.phoneId, 'phoneId', 80),
      code: str(b.code, 'code', 20),
      staffNo: str(b.staffNo, 'staffNo', 20),
      deviceLabel: typeof b.deviceLabel === 'string' ? b.deviceLabel.slice(0, 80) : null,
    };
    const r = await this.db.asUser(userId, (svc, u) => svc.guardPhone.enrol(u, input));
    if (!r.ok) throw new BadRequestException(r.message);
    return r.device;
  }

  /** What the phone needs to show before sign-in: the face status and any lock. */
  @Post('status')
  async status(@Req() req: AuthedRequest, @Body() b: Record<string, unknown>) {
    on();
    limit(req, 'status');
    const d = device(b.device);
    await guardPhoneAdmits(this.db, d.userId);
    const { cfg } = faceSetup();
    return { ...(await this.db.asUser(d.userId, (svc, u) => svc.guardPhone.status(u, d))), engine: cfg.mode };
  }

  /** Register the guard's face after their PIN; HR approves it. With FACE_ENGINE=server the server reads the photo. */
  @Post('face')
  async face(@Req() req: AuthedRequest, @Body() b: Record<string, unknown>) {
    on();
    limit(req, 'face');
    const d = device(b.device);
    await guardPhoneAdmits(this.db, d.userId);
    const pin = str(b.pin, 'pin', 10);
    const photo = str(b.photo, 'photo', 2_500_000);
    // Verify the active device before loading models or processing untrusted biometric images.
    // registerFace checks the credential again after computation, so revocation is not bypassed.
    const phone = await this.db.asUser(d.userId, (svc, u) => svc.guardPhone.status(u, d));
    if (phone.lockedUntil) throw new BadRequestException('This phone is locked. Try again after the lock expires.');
    const { engine } = faceSetup();
    let descriptor: number[];
    let by: 'phone' | 'server';
    if (engine) {
      const found = await engine.analyse(photo);
      if (!found) throw new BadRequestException('No face was found in the photo. Face the camera in good light and try again.');
      if (found.faces > 1) throw new BadRequestException('More than one face is in the photo. Register alone.');
      descriptor = found.descriptor;
      by = 'server';
    } else {
      if (!Array.isArray(b.descriptor) || b.descriptor.length !== 128 || !b.descriptor.every((x) => typeof x === 'number' && Number.isFinite(x)))
        throw new BadRequestException('descriptor must be 128 numbers');
      descriptor = b.descriptor as number[];
      by = 'phone';
    }
    const r = await this.db.asUser(d.userId, (svc, u) => svc.guardPhone.registerFace(u, d, { pin, photo, descriptor, descriptorBy: by }));
    if (!r.ok) throw new BadRequestException(r.message);
    return r;
  }

  /** The head-movement challenge for this sign-in try (FACE_ENGINE=server); with the phone engine, says so. */
  @Post('challenge')
  async challenge(@Req() req: AuthedRequest, @Body() b: Record<string, unknown>) {
    on();
    limit(req, 'challenge');
    const d = device(b.device);
    await guardPhoneAdmits(this.db, d.userId);
    const { cfg } = faceSetup();
    const bind = await this.db.asUser(d.userId, (svc, u) => svc.guardPhone.challengeBind(u, d));
    if (cfg.mode !== 'server' || !cfg.secret) return { engine: 'phone' as const };
    return { engine: 'server' as const, ...issueFaceChallenge(cfg.secret, d.userId, bind) };
  }

  /** Sign in with the PIN and the face. A refusal is written (and counts toward the lock) before the error goes back. */
  @Post('sign-in')
  async signIn(@Req() req: AuthedRequest, @Body() b: Record<string, unknown>) {
    const gp = on();
    limit(req, 'sign-in');
    const d = device(b.device);
    await guardPhoneAdmits(this.db, d.userId);
    const pin = str(b.pin, 'pin', 10);
    // Cheap credential/lock check first; signIn still repeats every check after face computation.
    const phone = await this.db.asUser(d.userId, (svc, u) => svc.guardPhone.status(u, d));
    if (phone.lockedUntil) throw new HttpException({ message: 'This phone is locked. Try again after the lock expires.', reason: 'locked', lockedUntil: phone.lockedUntil }, 423);
    const { cfg, engine } = faceSetup();
    let face: Parameters<import('@prima/core').GuardPhoneService['signIn']>[2]['face'];
    let analyse: ((img: string) => ReturnType<FaceEngine['analyse']>) | undefined;
    if (engine && cfg.secret) {
      const ch = openFaceChallenge(cfg.secret, b.token, d.userId);
      if (!ch) throw new BadRequestException('The face check timed out. Start it again.');
      if (!Array.isArray(b.frames) || b.frames.length !== ch.steps.length) throw new BadRequestException('Take one picture for each step.');
      const frames = b.frames.map((f) => str(f, 'frame', 700_000));
      for (const f of frames) if (!/^data:image\/jpeg;base64,/.test(f)) throw new BadRequestException('Take the pictures with the app camera.');
      // The pictures are read before the database work starts, as for the staff clock (PR #76).
      const found: Awaited<ReturnType<FaceEngine['analyse']>>[] = [];
      for (const f of frames) found.push(await engine.analyse(f));
      face = { engine: 'server', bind: ch.clockId, steps: ch.steps, frames, found };
      analyse = (img) => engine.analyse(img);
    } else {
      const dsc = b.descriptor;
      const ok = Array.isArray(dsc) && dsc.length === 128 && dsc.every((x) => typeof x === 'number' && Number.isFinite(x));
      face = { engine: 'phone', descriptor: ok ? (dsc as number[]) : null, live: b.live === true, photo: typeof b.photo === 'string' ? b.photo.slice(0, 700_000) : '' };
    }
    const r = await this.db.asUser(d.userId, (svc, u) => svc.guardPhone.signIn(u, d, { pin, face }, analyse));
    if (!r.ok) throw new HttpException({ message: r.message, reason: r.reason, lockedUntil: r.lockedUntil }, r.reason === 'locked' ? 423 : 401);
    const s = r.session;
    return { token: issueGuardToken(gp.secret, d.userId, s.id, Date.parse(s.expiresAt)), expiresAt: s.expiresAt, sessionId: s.id };
  }

  /**
   * SOS with the phone's own credential, for a guard who is not signed in (or whose sign-in ran out). Never held up for
   * a PIN or a face. A signed-in phone uses /api/guard-phone/me/sos instead.
   */
  @Post('sos')
  async sos(@Req() req: AuthedRequest, @Body() b: Record<string, unknown>) {
    on();
    limit(req, 'sos');
    const d = device(b.device);
    const loc = { lat: num(b.lat), lng: num(b.lng), accuracyM: num(b.accuracyM) };
    return this.db.asUser(d.userId, (svc, u) => svc.guardPhone.sos(u, { device: d }, loc));
  }
}

/** Signed in on the phone (its token), and the office and CMS screens (their usual sign-in). */
@Controller('api')
@UseGuards(AuthGuard)
export class GuardPhoneController {
  constructor(private db: Db) {}

  @Get('guard-phone/me')
  me(@UserId() uid: string, @GuardSession() sid: string) {
    on();
    return this.db.asUser(uid, (svc, u) => svc.guardPhone.me(u, sid));
  }

  @Post('guard-phone/me/heartbeat')
  heartbeat(@UserId() uid: string, @GuardSession() sid: string, @Body() b: Record<string, unknown>) {
    on();
    const input = { lat: num(b.lat), lng: num(b.lng), accuracyM: num(b.accuracyM), capturedAt: typeof b.capturedAt === 'string' ? b.capturedAt.slice(0, 40) : undefined, battery: num(b.battery) };
    return this.db.asUser(uid, (svc, u) => svc.guardPhone.heartbeat(u, sid, input));
  }

  @Post('guard-phone/me/sos')
  sos(@UserId() uid: string, @GuardSession() sid: string, @Body() b: Record<string, unknown>) {
    on();
    return this.db.asUser(uid, (svc, u) => svc.guardPhone.sos(u, { sessionId: sid }, { lat: num(b.lat), lng: num(b.lng), accuracyM: num(b.accuracyM) }));
  }

  @Post('guard-phone/me/sign-out')
  signOut(@UserId() uid: string, @GuardSession() sid: string) {
    on();
    return this.db.asUser(uid, (svc, u) => svc.guardPhone.signOut(u, sid));
  }

  // The company office and HR: enrol and retire phones.
  @Post('people/:id/guard-phone/code')
  issueCode(@UserId() uid: string, @Param('id') id: string) {
    on();
    return this.db.asUser(uid, (svc, u) => svc.guardPhone.issueCode(u, id.slice(0, 120)));
  }

  @Get('companies/:id/guard-phones')
  phones(@UserId() uid: string, @Param('id') id: string) {
    on();
    return this.db.asUser(uid, (svc, u) => svc.guardPhone.phones(u, id.slice(0, 120)));
  }

  @Post('guard-phones/:id/revoke')
  revoke(@UserId() uid: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    on();
    return this.db.asUser(uid, (svc, u) => svc.guardPhone.revoke(u, id.slice(0, 80), typeof b.reason === 'string' ? b.reason : ''));
  }

  // CMS: phones live, late or offline, and SOS from phones.
  @Get('cms/guard-phones')
  board(@UserId() uid: string) {
    on();
    return this.db.asUser(uid, (svc, u) => svc.guardPhone.board(u));
  }
}

