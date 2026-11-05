// P75: the office accounts service (office-accounts.ts). No database: what it accepts, and who may ask it.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AccountRefused, accountsHandler, checkAccountInput, officeAccountId } from '../src/office-accounts';
import { officePayload, officeSign, type OfficeCall } from '../src/office';

const SECRET = 'o'.repeat(40);
const env = { OFFICE_SIGNING_SECRET: SECRET } as NodeJS.ProcessEnv;
const GOOD = { officeUserId: 'us_01jabc', name: 'Siti Aminah', title: 'Staff', role: 'pwvsb_officer', companyIds: ['co-sasa'] };

describe('office accounts: what an office account can be', () => {
  it('is always u-off- and a plain office user id', () => {
    assert.equal(officeAccountId('us_01jabc'), 'u-off-us_01jabc');
    for (const bad of ['', 'u', 'US_01', '../u-fauzan', 'u-fauzan;', 'a b c', 'x'.repeat(65), 42, null]) {
      assert.throws(() => officeAccountId(bad), AccountRefused, String(bad));
    }
  });

  it('accepts the allowed fields, tidied', () => {
    const got = checkAccountInput({ ...GOOD, name: '  Siti   Aminah ', companyIds: ['co-sasa', 'co-sasa'], department: 'transport' });
    assert.deepEqual(got, { ...GOOD, companyIds: ['co-sasa'], department: 'transport' });
    assert.equal(checkAccountInput({ ...GOOD, role: 'admin_exec' }).role, 'admin_exec');
  });

  it('refuses a role, department or field it never sets, and another record id', () => {
    for (const role of ['director', 'company_manager', 'supervisor', 'guard', 'site_device', 'owner']) {
      assert.throws(() => checkAccountInput({ ...GOOD, role }), /role must be one of/, role);
    }
    for (const department of ['hr', 'finance', 'it', 'audit', 'legal', 'director_office', 'arms_control']) {
      assert.throws(() => checkAccountInput({ ...GOOD, department }), /department must be one of/, department);
    }
    for (const field of ['id', 'leadership', 'opsTier', 'integration', 'entraOid', 'accessClosedFrom', 'siteIds', 'personId', 'actRole']) {
      assert.throws(() => checkAccountInput({ ...GOOD, [field]: 'x' }), /cannot set/, field);
    }
    assert.throws(() => checkAccountInput({ ...GOOD, companyIds: [] }), /one to five/);
    assert.throws(() => checkAccountInput({ ...GOOD, companyIds: ["co'1"] }), /company id/);
    assert.throws(() => checkAccountInput({ ...GOOD, name: '' }), /name/);
    assert.throws(() => checkAccountInput({ ...GOOD, name: 'a\u0000b' }), /name/);
    assert.throws(() => checkAccountInput([GOOD]), /JSON object/);
  });
});

describe('office accounts: the service', () => {
  let server: Server;
  let base = '';
  let connects = 0;
  const pool = {
    connect: async () => {
      connects += 1;
      return { query: async () => assert.fail('no database in this test'), release: () => undefined };
    },
  };
  before(async () => {
    server = createServer((req, res) => void accountsHandler(pool as never, env)(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  function signed(call: OfficeCall, body: string, url = '/accounts', secret = SECRET): Record<string, string> {
    const ts = new Date().toISOString();
    return {
      'content-type': 'application/json',
      'x-office-ts': ts,
      'x-office-user': call.user,
      'x-office-via': call.via,
      'x-office-signature': officeSign(secret, officePayload(ts, 'POST', url, call, body)),
    };
  }
  const system: OfficeCall = { user: '', via: 'system' };

  it('answers its health check', async () => {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });

  it('refuses unsigned, person-signed, agent-signed and wrongly signed calls before any database work', async () => {
    const body = JSON.stringify(GOOD);
    const tries: Record<string, string>[] = [
      { 'content-type': 'application/json' },
      signed({ user: 'u-it-lead', via: 'person' }, body),
      signed({ user: 'u-it-lead', via: 'agent:Chief of Staff' }, body),
      signed(system, body, '/accounts', 'x'.repeat(40)),
      signed(system, body, '/other'),
      signed(system, '{}'),
    ];
    for (const headers of tries) {
      const r = await fetch(`${base}/accounts`, { method: 'POST', headers, body });
      assert.equal(r.status, 401);
      assert.match(((await r.json()) as { message: string }).message, /Only the Agentic Office/);
    }
    assert.equal(connects, 0);
  });

  it('takes the office system call, and refuses what an office account cannot be', async () => {
    const body = JSON.stringify({ ...GOOD, leadership: 'chairman' });
    const r = await fetch(`${base}/accounts`, { method: 'POST', headers: signed(system, body), body });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { message: string }).message, /cannot set leadership/);
    const bad = await fetch(`${base}/accounts`, { method: 'POST', headers: signed(system, 'nope'), body: 'nope' });
    assert.equal(bad.status, 400);
  });

  it('serves nothing else, and nothing large', async () => {
    assert.equal((await fetch(`${base}/api/office/staff`)).status, 404);
    assert.equal((await fetch(`${base}/accounts`)).status, 405);
    const big = JSON.stringify({ ...GOOD, title: 'x'.repeat(20_000) });
    const r = await fetch(`${base}/accounts`, { method: 'POST', headers: signed(system, big), body: big });
    assert.equal(r.status, 413);
  });
});
