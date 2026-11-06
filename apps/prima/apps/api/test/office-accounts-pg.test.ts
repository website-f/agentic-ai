// P75: office accounts against a real local PostgreSQL (the tests reset it). Run with DATABASE_URL pointing at a
// throwaway local database, as rls.test.ts.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { CENTRAL_EMPLOYER_IDS, verifyChain, type AuditEntry, type Person, type User } from '@prima/core';
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

  it('lists the companies for the office: id, name and other names, nothing else', async () => {
    const list = await new OfficeController(db).companies();
    const all = (await pool.query(`SELECT id FROM prima.companies`)).rows.map((r) => r.id as string);
    // P81: the central employers first (no company record), then every company record.
    assert.deepEqual(list.map((c) => c.id).sort(), [...CENTRAL_EMPLOYER_IDS, ...all].sort());
    assert.ok(list.length > 0);
    for (const c of list) assert.deepEqual(Object.keys(c).sort(), ['aliases', 'id', 'name']);
    assert.ok(list.some((c) => c.id === 'co-sasa' && /Sasa/.test(c.name)));
    assert.ok(list.some((c) => c.id === 'pwvsb' && /PW Venture/.test(c.name) && c.aliases.includes('Unit HR')));
    assert.ok(list.some((c) => c.id === 'goodwill' && c.aliases.includes('Operasi Johor')));
  });

  it('a new office account signs in through the office like any staff record', async () => {
    const u = await db.asUser('u-off-us_01jhttp', async (_svc, me) => me);
    assert.equal(u.id, 'u-off-us_01jhttp');
  });


  // P81: the real staff are loaded as office staff records; a sign-in the office makes is linked to its own record.
  describe('linking the account to the person', () => {
    const person = (id: string, companyId: string, name: string, extra: Partial<Person> = {}): Person => ({
      id,
      companyId,
      branchId: companyId === 'pwvsb' ? 'br-pwvsb-hq' : '',
      staffNo: '',
      name,
      nationality: '' as Person['nationality'],
      idMasked: '',
      dob: '',
      phone: '',
      role: 'office',
      status: 'active',
      hiredOn: '',
      faceEnrolledOn: null,
      ...extra,
    });
    const add = (p: Person) => pool.query(`INSERT INTO prima.people (id, company_id, data) VALUES ($1, $2, $3)`, [p.id, p.companyId, p]);

    before(async () => {
      await add(person('pr-p81-mail', 'pwvsb', 'Synthetic Mail Person', { email: 'mail.person@example.test', otherEmails: ['mail.hq@example.test'] }));
      await add(person('pr-p81-other', 'pwvsb', 'Synthetic Other Mailbox', { email: 'other.person@example.test', otherEmails: ['other.hq@example.test'] }));
      await add(person('pr-p81-name', 'co-sasa', 'Synthetic Name Only'));
      await add(person('pr-p81-twin1', 'co-arsh', 'Synthetic Twin'));
      await add(person('pr-p81-twin2', 'co-arsh', 'Synthetic Twin'));
      await add(person('pr-p81-inas', 'co-inas', 'Synthetic Inas Staff', { email: 'inas.staff@example.test' }));
      await add(person('pr-p81-left', 'pwvsb', 'Synthetic Leaver', { email: 'left@example.test', status: 'left' }));
      // A company's own office staff member whose facts HR has filled in, to use their own screens below.
      await add(
        person('pr-p81-hq', 'co-sasa', 'Synthetic Sasa HQ', {
          email: 'sasa.hq.staff@example.test',
          staffNo: 'SASAP81',
          nationality: 'MY',
          idMasked: '900101-**-***1',
          dob: '1990-01-01',
          phone: '012-000 0000',
          hiredOn: '2024-01-02',
          branchId: 'br-sasa-1',
          basicPay: 3000,
        }),
      );
    });

    it('links by email, any case, any of the person mailboxes; a central employer account is central staff', async () => {
      const got = await upsert({ officeUserId: 'us_p81mail', name: 'Mail Person', title: 'Branch manager', role: 'admin_exec', companyIds: ['pwvsb'], email: 'Mail.Person@Example.TEST' });
      assert.equal(got.personId, 'pr-p81-mail');
      assert.equal(got.role, 'pwvsb_officer');
      const u = await user('u-off-us_p81mail');
      assert.equal(u?.personId, 'pr-p81-mail');
      assert.equal(u?.role, 'pwvsb_officer');
      assert.equal((u as unknown as Record<string, unknown>).email, undefined, 'the email is never stored on the account');
      assert.match((await audits('u-off-us_p81mail'))[0].summary, /linked to staff record pr-p81-mail \(same email\)/);
      const other = await upsert({ officeUserId: 'us_p81other', name: 'Someone', title: 'Staff', role: 'pwvsb_officer', companyIds: ['pwvsb'], email: 'other.hq@example.test' });
      assert.equal(other.personId, 'pr-p81-other');
      // The linked sign-in reads its own record through the company wall.
      const mine = await db.asUser('u-off-us_p81mail', async (_svc, me, store) => (me.personId ? store.get('people', me.personId) : undefined));
      assert.equal(mine?.name, 'Synthetic Mail Person');
    });

    it('a licensed company office staff member becomes admin_exec of that one company, audited, once', async () => {
      const input = { officeUserId: 'us_p81inas', name: 'Inas Staff', title: 'Staff', role: 'pwvsb_officer', companyIds: ['co-inas'], email: 'inas.staff@example.test' };
      const got = await upsert(input);
      assert.deepEqual([got.personId, got.role, got.companyIds], ['pr-p81-inas', 'admin_exec', ['co-inas']]);
      const u = await user('u-off-us_p81inas');
      assert.deepEqual([u?.role, u?.companyIds, u?.personId], ['admin_exec', ['co-inas'], 'pr-p81-inas']);
      assert.match((await audits('u-off-us_p81inas'))[0].summary, /created: admin_exec for co-inas \(the office asked pwvsb_officer; their own staff record is in co-inas/);
      // Idempotent: the office's next call (still "staff") changes nothing.
      const again = await upsert(input);
      assert.deepEqual([again.role, again.companyIds, again.personId], ['admin_exec', ['co-inas'], 'pr-p81-inas']);
      const a = await audits('u-off-us_p81inas');
      assert.equal(a.length, 2);
      assert.doesNotMatch(a[1].summary, /\(was /);
      assert.deepEqual(await user('u-off-us_p81inas'), u);
    });

    it('links by the same name in the same company when the record has no email', async () => {
      const got = await upsert({ officeUserId: 'us_p81name', name: '  synthetic   NAME only ', title: 'Staff', role: 'pwvsb_officer', companyIds: ['co-sasa'] });
      assert.deepEqual([got.personId, got.role, got.companyIds], ['pr-p81-name', 'admin_exec', ['co-sasa']]);
      assert.match((await audits('u-off-us_p81name'))[0].summary, /\(same name\)/);
    });

    it('never guesses, never takes a held record, never a company the office did not name, never a leaver', async () => {
      const twin = await upsert({ officeUserId: 'us_p81twin', name: 'Synthetic Twin', title: '', role: 'pwvsb_officer', companyIds: ['co-arsh'] });
      assert.deepEqual([twin.personId, twin.role], [undefined, 'pwvsb_officer'], 'two records of that name: the owner links by hand');
      const held = await upsert({ officeUserId: 'us_p81held', name: 'X', title: '', role: 'pwvsb_officer', companyIds: ['pwvsb'], email: 'mail.person@example.test' });
      assert.equal(held.personId, undefined, 'already linked to another sign-in');
      // The office mapped this person to Sasa; their record is in Inas: no link and no Inas access.
      const elsewhere = await upsert({ officeUserId: 'us_p81else', name: 'X', title: '', role: 'admin_exec', companyIds: ['co-sasa'], email: 'inas.staff@example.test' });
      assert.deepEqual([elsewhere.personId, elsewhere.role, elsewhere.companyIds], [undefined, 'admin_exec', ['co-sasa']]);
      // A branch manager of a licensed company never reaches a central staff record.
      const bm = await upsert({ officeUserId: 'us_p81bm', name: 'Synthetic Other Mailbox', title: '', role: 'admin_exec', companyIds: ['co-arsh'], email: 'other.person@example.test' });
      assert.deepEqual([bm.personId, bm.role, bm.companyIds], [undefined, 'admin_exec', ['co-arsh']]);
      const left = await upsert({ officeUserId: 'us_p81left', name: 'Synthetic Leaver', title: '', role: 'pwvsb_officer', companyIds: ['pwvsb'], email: 'left@example.test' });
      assert.equal(left.personId, undefined);
      for (const id of ['u-off-us_p81twin', 'u-off-us_p81held', 'u-off-us_p81else', 'u-off-us_p81bm', 'u-off-us_p81left'])
        assert.equal((await user(id))?.personId, undefined, id);
    });

    it('links later: an account made before the record existed becomes the company office staff when it is found', async () => {
      const input = { officeUserId: 'us_p81later', name: 'Synthetic Later', title: 'Staff', role: 'pwvsb_officer', companyIds: ['co-arsh'], email: 'later@example.test' };
      const first = await upsert(input);
      assert.deepEqual([first.personId, first.role], [undefined, 'pwvsb_officer']);
      await add(person('pr-p81-later', 'co-arsh', 'Synthetic Later', { email: 'later@example.test' }));
      const second = await upsert(input);
      assert.deepEqual([second.personId, second.role, second.companyIds], ['pr-p81-later', 'admin_exec', ['co-arsh']]);
      assert.match((await audits('u-off-us_p81later'))[1].summary, /updated: admin_exec for co-arsh \(was pwvsb_officer for co-arsh\).*linked to staff record pr-p81-later/);
    });

    it('the company office staff member has their own details, clock, leave and claims', async () => {
      const got = await upsert({ officeUserId: 'us_p81hq', name: 'Sasa HQ', title: 'Staff', role: 'pwvsb_officer', companyIds: ['co-sasa'], email: 'sasa.hq.staff@example.test' });
      assert.deepEqual([got.personId, got.role, got.companyIds], ['pr-p81-hq', 'admin_exec', ['co-sasa']]);
      await db.asUser('u-off-us_p81hq', async (svc, me) => {
        assert.ok(JSON.stringify(await svc.myDuty(me)).includes('Synthetic Sasa HQ'), 'My details shows their own record');
        assert.equal((await svc.myStaffClock(me)).allowed, true, 'staff clock');
        assert.equal((await svc.staffClaims(me)).canClaim, true, 'claims');
        const leave = await svc.requestLeave(me, { personId: 'pr-p81-hq', kind: 'ANNUAL', from: '2099-01-05', to: '2099-01-05', reason: 'Family matter (synthetic)' } as never);
        assert.equal((leave as { personId: string }).personId, 'pr-p81-hq', 'leave');
      });
    });
  });
});
