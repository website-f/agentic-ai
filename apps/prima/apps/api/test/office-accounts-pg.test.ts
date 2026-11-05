// P75: office accounts against a real local PostgreSQL (the tests reset it). Run with DATABASE_URL pointing at a
// throwaway local database, as rls.test.ts.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { verifyChain, type AuditEntry, type User } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { OfficeController } from '../src/controllers';
import { linkEntra } from '../src/entra-link';
import { officePayload, officeSign, type OfficeCall } from '../src/office';
import { AccountRefused, accountsHandler, upsertOfficeAccount } from '../src/office-accounts';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
const SECRET = 'o'.repeat(40);
const OID = '0a0a0a0a-0000-4000-8000-0000000000f1';

describe('office accounts in the database', () => {
  let pool: Pool;
  let db: Db;
  const user = async (id: string) => (await pool.query('SELECT data FROM prima.users WHERE id = $1', [id])).rows[0]?.data as User | undefined;
  const audits = async (id: string) =>
    (await pool.query(`SELECT data FROM prima.audit WHERE data->>'action' = 'OFFICE_ACCOUNT' AND data->>'entityId' = $1 ORDER BY seq`, [id])).rows.map((r) => r.data as AuditEntry);
  const upsert = async (input: unknown, by = 'Agentic Office') => {
    const c = await pool.connect();
    try {
      return await upsertOfficeAccount(c, input, by);
    } finally {
      c.release();
    }
  };

  before(async () => {
    await resetDb(URL);
    pool = new Pool({ connectionString: URL, max: 2 });
    db = new Db();
  });
  after(async () => {
    await pool.end();
    await db.onModuleDestroy();
  });

  it('creates the person their own u-off- account, audited, and nothing else', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM prima.users')).rows[0].n as number;
    const got = await upsert({ officeUserId: 'us_01jstaff', name: 'Siti Aminah', title: 'Staff', role: 'pwvsb_officer', companyIds: ['co-sasa'] });
    assert.deepEqual(got, { id: 'u-off-us_01jstaff', name: 'Siti Aminah', role: 'pwvsb_officer', companyIds: ['co-sasa'], created: true, closed: false });
    assert.deepEqual(await user('u-off-us_01jstaff'), { id: 'u-off-us_01jstaff', name: 'Siti Aminah', title: 'Staff', role: 'pwvsb_officer', companyIds: ['co-sasa'], siteIds: [] });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM prima.users')).rows[0].n, before + 1);
    const a = await audits('u-off-us_01jstaff');
    assert.equal(a.length, 1);
    assert.equal(a[0].actor, 'Agentic Office');
    assert.equal(a[0].companyId, 'co-sasa');
    assert.match(a[0].summary, /created: pwvsb_officer for co-sasa/);
    const chain = (await pool.query('SELECT data FROM prima.audit ORDER BY seq')).rows.map((r) => r.data as AuditEntry);
    assert.equal(verifyChain(chain), null);
  });

  it('updates only the allowed fields; what IT recorded stays', async () => {
    const c = await pool.connect();
    try {
      await linkEntra(c, 'u-off-us_01jstaff', OID, 'IT Manager');
    } finally {
      c.release();
    }
    const got = await upsert({ officeUserId: 'us_01jstaff', name: 'Siti Aminah binti Ali', title: 'Branch manager', role: 'admin_exec', companyIds: ['co-arsh'] });
    assert.equal(got.created, false);
    const u = await user('u-off-us_01jstaff');
    assert.deepEqual(u, { id: 'u-off-us_01jstaff', name: 'Siti Aminah binti Ali', title: 'Branch manager', role: 'admin_exec', companyIds: ['co-arsh'], siteIds: [], entraOid: OID });
    assert.match((await audits('u-off-us_01jstaff'))[1].summary, /updated: admin_exec for co-arsh \(was pwvsb_officer for co-sasa\)/);
  });

  it('refuses other records, unknown companies, roles and fields, and changes nothing', async () => {
    const fauzan = await user('u-fauzan');
    const n = (await pool.query(`SELECT count(*)::int AS n FROM prima.audit`)).rows[0].n as number;
    const tries: [unknown, RegExp][] = [
      [{ id: 'u-fauzan', officeUserId: 'us_01jstaff', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'] }, /cannot set id/],
      [{ officeUserId: 'u-fauzan;', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'] }, /office user id/],
      [{ officeUserId: 'us_01jother', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-nowhere'] }, /No Prima company co-nowhere/],
      [{ officeUserId: 'us_01jother', name: 'X', title: '', role: 'company_manager', companyIds: ['co-sasa'] }, /role must be one of/],
      [{ officeUserId: 'us_01jother', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'], opsTier: 'ceo' }, /cannot set opsTier/],
      [{ officeUserId: 'us_01jother', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'], leadership: 'cos' }, /cannot set leadership/],
      [{ officeUserId: 'us_01jother', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'], integration: 'ja' }, /cannot set integration/],
      [{ officeUserId: 'us_01jother', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'], entraOid: OID }, /cannot set entraOid/],
      [{ officeUserId: 'us_01jother', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'], department: 'hr' }, /department must be one of/],
    ];
    for (const [input, why] of tries) await assert.rejects(upsert(input), (e: Error) => e instanceof AccountRefused && why.test(e.message));
    await assert.rejects(upsert({ officeUserId: 'us_01jother', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'] }, ' '), /who is making/);
    assert.deepEqual(await user('u-fauzan'), fauzan);
    assert.equal(await user('u-off-us_01jother'), undefined);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM prima.audit`)).rows[0].n, n);
  });

  it('leaves a closed account as it is', async () => {
    await pool.query(`UPDATE prima.users SET data = data || '{"accessClosedFrom":"2026-01-01"}'::jsonb WHERE id = 'u-off-us_01jstaff'`);
    const was = await user('u-off-us_01jstaff');
    const got = await upsert({ officeUserId: 'us_01jstaff', name: 'Someone Else', title: '', role: 'pwvsb_officer', companyIds: ['co-sasa'] });
    assert.equal(got.closed, true);
    assert.deepEqual(await user('u-off-us_01jstaff'), was);
    assert.equal((await audits('u-off-us_01jstaff')).length, 2);
  });

  it('serves the office system call over HTTP, and refuses a person-signed one', async () => {
    const env = { OFFICE_SIGNING_SECRET: SECRET } as NodeJS.ProcessEnv;
    const server = createServer((req, res) => void accountsHandler(pool, env)(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (call: OfficeCall, body: string) => {
      const ts = new Date().toISOString();
      return fetch(`${base}/accounts`, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-office-ts': ts, 'x-office-user': call.user, 'x-office-via': call.via, 'x-office-signature': officeSign(SECRET, officePayload(ts, 'POST', '/accounts', call, body)) },
      });
    };
    try {
      const body = JSON.stringify({ officeUserId: 'us_01jhttp', name: 'Ali bin Abu', title: 'Supervisor', role: 'pwvsb_officer', companyIds: ['co-sasa'] });
      const no = await post({ user: 'u-fauzan', via: 'person' }, body);
      assert.equal(no.status, 401);
      assert.equal(await user('u-off-us_01jhttp'), undefined);
      const r = await post({ user: '', via: 'system' }, body);
      assert.equal(r.status, 200);
      assert.equal(((await r.json()) as { id: string }).id, 'u-off-us_01jhttp');
      assert.equal((await user('u-off-us_01jhttp'))?.role, 'pwvsb_officer');
      const bad = await post({ user: '', via: 'system' }, JSON.stringify({ officeUserId: 'us_01jhttp2', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['co-nowhere'] }));
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), { message: 'No Prima company co-nowhere.' });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('lists the companies for the office: id and name, nothing else', async () => {
    const list = await new OfficeController(db).companies();
    const all = (await pool.query(`SELECT id FROM prima.companies`)).rows.map((r) => r.id as string).sort();
    assert.deepEqual(list.map((c) => c.id).sort(), all);
    assert.ok(list.length > 0);
    for (const c of list) assert.deepEqual(Object.keys(c).sort(), ['id', 'name']);
    assert.ok(list.some((c) => c.id === 'co-sasa' && /Sasa/.test(c.name)));
  });

  it('a new office account signs in through the office like any staff record', async () => {
    const u = await db.asUser('u-off-us_01jhttp', async (_svc, me) => me);
    assert.equal(u.id, 'u-off-us_01jhttp');
  });
});
