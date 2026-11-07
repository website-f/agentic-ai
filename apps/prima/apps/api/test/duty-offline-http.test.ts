/** Synthetic fixtures on a disposable local PostgreSQL only. Actual HTTP AuthGuard/controller/service/RLS path. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { demoPin, type DutyOfflineContext, type User } from '@prima/core';
import { AppController } from '../src/controllers';
import { AuthGuard, issueToken } from '../src/auth';
import { Db } from '../src/db';
import { DomainErrors } from '../src/errors';
import { resetDb } from '../src/reset-db';

test('offline replay context survives real HTTP DTOs and restricted PostgreSQL transactions', { skip: !process.env.DUTY_TEST_ADMIN_URL }, async () => {
  const url = process.env.DUTY_TEST_ADMIN_URL;
  if (!url) throw new Error('Explicit isolated DUTY_TEST_ADMIN_URL is required.');
  const adminUrl = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(adminUrl.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname) || adminUrl.pathname !== '/prima_offline_test') throw new Error('A disposable local prima_offline_test database is required.');
  const runtimeRole = process.env.DUTY_TEST_ROLE ?? 'duty_test_api';
  if (!/^duty_test_api(?:_[0-9a-f]{16})?$/.test(runtimeRole)) throw new Error('Invalid synthetic runtime role.');
  const admin = new Client({ connectionString: url });
  const saved = { DATABASE_URL: process.env.DATABASE_URL, ALLOW_DEV_LOGIN: process.env.ALLOW_DEV_LOGIN, DEV_TOKEN_SECRET: process.env.DEV_TOKEN_SECRET, LEADERSHIP_ONBOARDING_ONLY: process.env.LEADERSHIP_ONBOARDING_ONLY };
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    await resetDb(url);
    await admin.connect();
    await admin.query(`CREATE ROLE ${runtimeRole} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD 'synthetic-duty-api-ci-only'`);
    await admin.query(`GRANT prima_app TO ${runtimeRole}`);
    await admin.query(`GRANT USAGE ON SCHEMA prima TO ${runtimeRole}`);
    await admin.query(`GRANT SELECT ON prima.users, prima.grants TO ${runtimeRole}`);
    const runtimeUrl = new URL(adminUrl);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = 'synthetic-duty-api-ci-only';
    process.env.DATABASE_URL = runtimeUrl.toString();
    process.env.ALLOW_DEV_LOGIN = 'true';
    process.env.DEV_TOKEN_SECRET = 'synthetic-offline-http-test-key-only';
    delete process.env.LEADERSHIP_ONBOARDING_ONLY;
    const dev = (await admin.query("SELECT data FROM prima.users WHERE id='u-dev-sasa-001'")).rows[0].data as User;
    dev.dutyEnrollment = { deviceId: 'synthetic-device', enrollmentId: 'synthetic-enrollment' };
    await admin.query('UPDATE prima.users SET data=$2::jsonb WHERE id=$1', [dev.id, JSON.stringify(dev)]);
    const site = (await admin.query('SELECT data FROM prima.sites WHERE id=$1', [dev.siteIds[0]])).rows[0].data;
    const guard = (await admin.query("SELECT data FROM prima.people WHERE data->>'companyId'=$1 AND data->>'role'='guard' AND data->>'status'='active' AND data->>'pinHash' IS NOT NULL LIMIT 1", [site.companyId])).rows[0].data;
    const sign = { staffNo: guard.staffNo, pin: demoPin(guard.staffNo) };
    @Module({ controllers: [AppController], providers: [Db, AuthGuard] }) class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false });
    app.useGlobalFilters(new DomainErrors());
    await app.listen(0, '127.0.0.1');
    const db = app.get(Db);
    const role = (await db.pool.query('SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.equal(role.current_user, runtimeRole); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
    const base = await app.getUrl(); const token = issueToken(dev.id);
    const send = (route: string, body?: unknown, bearer = token) => fetch(base + '/api' + route, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const duty = await send('/device/duty'); assert.equal(duty.status, 200);
    const origin = ((await duty.json()) as { offlineContext: DutyOfflineContext }).offlineContext;
    assert.deepEqual(origin, { accountId: dev.id, companyId: site.companyId, siteId: site.id, ...dev.dutyEnrollment });
    const post = { ...sign, kind: 'routine', text: 'Synthetic original context', clientRef: 'http-offline-post-0001', offlineContext: origin };
    let res = await send('/device/post-log', post); assert.equal(res.status, 201, await res.text());
    const photo = { image: 'data:image/jpeg;base64,c3ludGhldGljIG9mZmxpbmU=', lat: site.lat, lng: site.lng, accuracyM: 8 };
    const gate = { ...sign, kind: 'vehicle', clientRef: 'http-offline-gate-0001', vehicle: { plate: 'SYNTHETIC1', plateRead: 'typed' }, photo, offlineContext: origin };
    res = await send('/device/gate/in', gate); assert.equal(res.status, 201);
    const gateId = ((await res.json()) as { entry: { id: string } }).entry.id;
    res = await send(`/device/gate/${gateId}/out`, { ...sign, offlineContext: origin }); assert.equal(res.status, 201, await res.text());
    const task = await db.asUser('u-om-klang', (svc, u) => svc.setSiteTask(u, site.id, { title: 'Synthetic offline task', forRole: 'guard', days: [0,1,2,3,4,5,6], proof: 'none' }));
    res = await send(`/device/tasks/${task.id}`, { ...sign, result: 'done', offlineContext: origin }); assert.equal(res.status, 201, await res.text());
    for (const field of Object.keys(origin) as (keyof DutyOfflineContext)[]) {
      const wrong = { ...origin, [field]: 'synthetic-wrong' };
      for (const [route, body] of [ ['/device/post-log', post], ['/device/gate/in', gate], [`/device/gate/${gateId}/out`, sign], [`/device/tasks/${task.id}`, { ...sign, result: 'done' }] ] as const) {
        res = await send(route, { ...body, offlineContext: wrong }); assert.equal(res.status, 403, `${route}: ${field}: ${await res.text()}`);
      }
    }
    for (const invalid of [null, {}, { ...origin, siteId: '' }]) { res = await send('/device/post-log', { ...post, offlineContext: invalid }); assert.equal(res.status, 400); }
    res = await send('/device/post-log', post, 'invalid-token'); assert.equal(res.status, 401);
    dev.dutyEnrollment.enrollmentId = 'synthetic-reenrolled';
    await admin.query('UPDATE prima.users SET data=$2::jsonb WHERE id=$1', [dev.id, JSON.stringify(dev)]);
    res = await send('/device/post-log', post); assert.equal(res.status, 403, 'idempotent replay must not bypass re-enrollment');
    const other = (await admin.query('SELECT data FROM prima.sites WHERE company_id=$1 AND id<>$2 LIMIT 1', [site.companyId, site.id])).rows[0].data;
    dev.dutyEnrollment.enrollmentId = origin.enrollmentId;
    dev.siteIds = [other.id];
    await admin.query('UPDATE prima.users SET data=$2::jsonb WHERE id=$1', [dev.id, JSON.stringify(dev)]);
    res = await send('/device/post-log', post); assert.equal(res.status, 403, 'site reassignment must not misattribute an old body');
    const foreign = await db.asUser('u-cm-inas', (_svc, _u, store) => store.list('postLogs', { companyId: site.companyId }));
    assert.deepEqual(foreign, [], 'RLS refuses the foreign company record');
    const rows = await admin.query("SELECT data FROM prima.post_logs WHERE data->>'clientRef'=$1", [post.clientRef]);
    assert.equal(rows.rowCount, 1); assert.equal(rows.rows[0].data.siteId, site.id);
  } finally {
    if (app) await app.close();
    await admin.end();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
