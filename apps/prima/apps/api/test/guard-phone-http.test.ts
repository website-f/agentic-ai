// Guards on their own phones over real HTTP and the real database wall (third audit item 2, Fauzan 5 Nov 2026):
// the switch, enrolment, face plus PIN sign-in, the phone token, heartbeat, SOS, retiring a phone, and that a guard
// cannot read another guard's phone rows. Uses the throwaway local test database and resets it. Synthetic faces only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { RULES } from '@prima/core';
import { issueToken } from '../src/auth';
import { Db } from '../src/db';
import { issueGuardToken, verifyGuardToken } from '../src/guard-phone';
import { createApp } from '../src/main';
import { resetDb } from '../src/reset-db';

const URL_ = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL_;

const SECRET = 'guard-phone-test-secret-0123456789abcdef';
const me = Array.from({ length: 128 }, (_, i) => Math.sin(i + 1) / 10);
const other = me.map((x, i) => x + (i % 2 ? 0.12 : -0.12));
const photo = 'data:image/jpeg;base64,' + Buffer.from('synthetic').toString('base64');
const PIN = '4826';

describe('Guard phone over HTTP', () => {
  let app: INestApplication;
  let base: string;
  let db: Db;
  const saved = { ...process.env };
  const pilotWas = RULES.pilot.value.on;

  async function call(path: string, init: { method?: string; body?: unknown; as?: string } = {}) {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (init.as) headers.set('authorization', `Bearer ${init.as}`);
    const res = await fetch(`${base}${path}`, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers, body: init.body ? JSON.stringify(init.body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function start(env: Record<string, string | undefined>) {
    if (app) await app.close();
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }

  before(async () => {
    await resetDb(URL_);
    // Guards are outside the IT pilot; this test switches the pilot rule off for itself only.
    (RULES.pilot.value as { on: boolean }).on = false;
    Object.assign(process.env, { ALLOW_DEV_LOGIN: 'true', DEV_TOKEN_SECRET: 'dev-secret-for-tests-only-0123456789' });
    delete process.env.FACE_ENGINE;
    db = new Db();
    const person = await db.asUser('u-guard-sasa-1', async (_s, u) => u.personId!);
    await db.asUser('u-cm-sasa', (svc, u) => svc.setStaffPin(u, person, PIN));
    await start({ GUARD_PHONE: undefined, GUARD_PHONE_SECRET: undefined });
  });

  after(async () => {
    (RULES.pilot.value as { on: boolean }).on = pilotWas;
    await app?.close();
    await db?.onModuleDestroy();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it('is switched off unless GUARD_PHONE=on, and refuses to start without its own secret', async () => {
    const r = await call('/api/guard-phone/enrol', { body: { userId: 'u-guard-sasa-1', phoneId: 'x', code: 'x', staffNo: 'x' } });
    assert.equal(r.status, 404);
    const cm = issueToken('u-cm-sasa');
    assert.equal((await call('/api/cms/guard-phones', { as: cm })).status, 404);
    process.env.GUARD_PHONE = 'on';
    delete process.env.GUARD_PHONE_SECRET;
    await assert.rejects(createApp(), /GUARD_PHONE_SECRET/);
    await start({ GUARD_PHONE: 'on', GUARD_PHONE_SECRET: SECRET });
  });

  let device: { userId: string; phoneId: string; secret: string };
  let token = '';

  it('enrols with the office code and the staff number', async () => {
    const cm = issueToken('u-cm-sasa');
    const person = await db.asUser('u-guard-sasa-1', async (svc, u) => (await svc.myDuty(u)) && u.personId!);
    const code = await call(`/api/people/${person}/guard-phone/code`, { as: cm, body: {} });
    assert.equal(code.status, 201, JSON.stringify(code.body));
    // A guard cannot issue codes.
    const staffNo = code.body.staffNo;
    const wrong = await call('/api/guard-phone/enrol', { body: { userId: code.body.userId, phoneId: code.body.phoneId, code: 'AAAA-AAAA', staffNo } });
    assert.equal(wrong.status, 400);
    const ok = await call('/api/guard-phone/enrol', { body: { userId: code.body.userId, phoneId: code.body.phoneId, code: code.body.code, staffNo, deviceLabel: 'test' } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    device = ok.body;
    assert.equal(typeof device.secret, 'string');
    // Only the hash is in the database.
    const raw = await db.pool.query('SELECT data::text AS t FROM prima.guard_phones WHERE id = $1', [device.phoneId]);
    assert.ok(!raw.rows[0].t.includes(device.secret));
  });

  it('registers the face after the PIN, waits for HR, then signs in only with PIN AND face', async () => {
    assert.equal((await call('/api/guard-phone/face', { body: { device, pin: '0000', photo, descriptor: me } })).status, 400);
    const reg = await call('/api/guard-phone/face', { body: { device, pin: PIN, photo, descriptor: me } });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const waiting = await call('/api/guard-phone/sign-in', { body: { device, pin: PIN, descriptor: me, live: true, photo } });
    assert.equal(waiting.status, 401);
    const person = device.userId && (await db.pool.query(`SELECT data->>'personId' AS p FROM prima.users WHERE id = $1`, [device.userId])).rows[0].p;
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.decideFace(u, person, true, 'Matches the guard card'));
    assert.equal((await call('/api/guard-phone/sign-in', { body: { device, pin: '9999', descriptor: me, live: true, photo } })).status, 401, 'face alone is not enough');
    assert.equal((await call('/api/guard-phone/sign-in', { body: { device, pin: PIN, descriptor: other, live: true, photo } })).status, 401, 'PIN alone is not enough');
    assert.equal((await call('/api/guard-phone/sign-in', { body: { device, pin: PIN } })).status, 401, 'PIN without any face');
    const refused = await db.pool.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' = 'guard_phone.sign_in_refused'`);
    assert.ok(refused.rows[0].n >= 3, 'refusals are kept although the sign-in failed');
    const ok = await call('/api/guard-phone/sign-in', { body: { device, pin: PIN, descriptor: me, live: true, photo } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    token = ok.body.token;
    assert.ok(token.startsWith('gp1.'));
  });

  it('the phone token opens only the guard\'s own phone screens; a forged or foreign token is refused', async () => {
    const mine = await call('/api/guard-phone/me', { as: token });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.equal((await call('/api/guard-phone/me/heartbeat', { as: token, body: { lat: 3.1, lng: 101.6, battery: 80 } })).status, 201);
    // Office and CMS routes refuse the guard.
    assert.equal((await call('/api/cms/guard-phones', { as: token })).status, 403);
    const person = (await db.pool.query(`SELECT data->>'personId' AS p FROM prima.users WHERE id = 'u-guard-sasa-2'`)).rows[0].p;
    assert.equal((await call(`/api/people/${person}/guard-phone/code`, { as: token, body: {} })).status, 403);
    // A token signed with another secret, or a development token on the phone routes.
    const t = verifyGuardToken(SECRET, token)!;
    assert.equal((await call('/api/guard-phone/me', { as: issueGuardToken('another-secret-0123456789abcdef-xyz', t.userId, t.sessionId, Date.now() + 60_000) })).status, 401);
    assert.equal((await call('/api/guard-phone/me', { as: issueToken('u-guard-sasa-1') })).status, 403);
  });

  it('SOS reaches the CMS alarm queue and the CMS board', async () => {
    const sos = await call('/api/guard-phone/me/sos', { as: token, body: { lat: 3.2, lng: 101.7 } });
    assert.equal(sos.status, 201, JSON.stringify(sos.body));
    assert.equal(sos.body.alarm.kind, 'GUARD_SOS');
    const board = await call('/api/cms/guard-phones', { as: issueToken('u-cms-head') });
    assert.equal(board.status, 200, JSON.stringify(board.body));
    assert.ok(board.body.sos.some((a: { id: string }) => a.id === sos.body.alarm.id));
    assert.ok(board.body.phones.some((p: { sessionId: string }) => p.sessionId === verifyGuardToken(SECRET, token)!.sessionId));
    // SOS with the phone's own secret, no sign-in.
    const bare = await call('/api/guard-phone/sos', { body: { device } });
    assert.equal(bare.status, 201);
    assert.equal(bare.body.repeated, true);
  });

  it('the database wall: another guard sees no phone rows; the company office sees its own company only', async () => {
    const other = await db.asUser('u-guard-sasa-2', (_s, _u, store) => store.list('guardPhones'));
    assert.equal(other.length, 0);
    const sessions = await db.asUser('u-guard-sasa-2', (_s, _u, store) => store.list('guardPhoneSessions'));
    assert.equal(sessions.length, 0);
    const cm = await db.asUser('u-cm-sasa', (_s, _u, store) => store.list('guardPhones'));
    assert.ok(cm.length >= 1);
    const inas = await db.asUser('u-cm-inas', (_s, _u, store) => store.list('guardPhones'));
    assert.equal(inas.length, 0);
    // A guard cannot write a row for another guard even with raw access to the store.
    await assert.rejects(
      db.asUser('u-guard-sasa-2', (_s, _u, store) => store.update('guardPhones', device.phoneId, { status: 'revoked' })),
      /Not found|row-level security|no rows/i,
    );
  });

  it('signing out ends the token at once; a retired phone can neither sign in nor send SOS', async () => {
    assert.equal((await call('/api/guard-phone/me/sign-out', { as: token, body: {} })).status, 201);
    assert.equal((await call('/api/guard-phone/me', { as: token })).status, 401);
    const cm = issueToken('u-cm-sasa');
    assert.equal((await call(`/api/guard-phones/${device.phoneId}/revoke`, { as: cm, body: { reason: 'Phone lost' } })).status, 201);
    assert.equal((await call('/api/guard-phone/sign-in', { body: { device, pin: PIN, descriptor: me, live: true, photo } })).status, 403);
    assert.equal((await call('/api/guard-phone/sos', { body: { device } })).status, 403);
  });
});
