// Durable Mail ledger against a disposable PostgreSQL 16 (never staging). Graph is mocked; no network.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Pool } from 'pg';
import type { User } from '@prima/core';
import type { DelegatedActor } from '../src/connections-mail/delegated';
import type { EmailDraft } from '../src/connections-mail/ledger';
import { PgEmailLedger, STAFF_EMAIL_LEDGER_SHA256, staffEmailLedgerSha256, staffEmailLedgerSql } from '../src/connections-mail/pg-ledger';
import { StaffEmail } from '../src/connections-mail/staff-email';

const URL_ = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
const tenant = '11111111-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oid = '99999999-8888-7777-6666-555555555555';
const now = '2026-10-31T06:00:00.000Z';
const env: NodeJS.ProcessEnv = { STAFF_EMAIL_ENABLED: 'true', ENTRA_TENANT_ID: tenant, ENTRA_API_CLIENT_ID: client, STAFF_EMAIL_OBO_CLIENT_SECRET: 'synthetic', STAFF_EMAIL_ALLOWED_USER_IDS: 'u-a,u-b', STAFF_EMAIL_RECIPIENT_DOMAINS: 'example.com' };
const actor = (id: string): DelegatedActor => ({ user: { id, entraOid: oid } as unknown as User, visibleCompanyIds: [], assertion: { userId: id, oid, tenantId: tenant, accessToken: `ASSERTION_${id}` } });
const message = { to: ['client@example.com'], subject: 'Synthetic', body: 'Dummy' };
const token = () => new Response(JSON.stringify({ token_type: 'Bearer', access_token: 'T', scope: 'Mail.Send' }), { headers: { 'content-type': 'application/json' } });

/** Counts real send attempts across every "worker" sharing it. */
function graph(onSend: () => Promise<Response> = async () => new Response(null, { status: 202 })) {
  const counter = { sends: 0 };
  const http = (async (url: string | URL | Request) => {
    if (String(url).includes('/oauth2/')) return token();
    if (String(url).endsWith('/me/sendMail')) { counter.sends++; return onSend(); }
    throw new Error('Unexpected request; no network permitted in test.');
  }) as typeof fetch;
  return { http, counter };
}

describe('Durable PostgreSQL Mail ledger (disposable database only)', () => {
  const admin = new Pool({ connectionString: URL_ });
  const pools: Pool[] = [];
  const pool = () => { const p = new Pool({ connectionString: URL_, max: 4 }); pools.push(p); return p; };
  let clock = Date.parse(now);
  const service = (p: Pool, http: typeof fetch) => new StaffEmail(new PgEmailLedger(p), () => env, http, () => new Date(clock));

  before(async () => { await admin.query(staffEmailLedgerSql()); });
  beforeEach(async () => { clock = Date.parse(now); await admin.query('TRUNCATE prima.staff_email_drafts'); });
  after(async () => { await Promise.all(pools.map(p => p.end())); await admin.end(); });

  it('is durable: a restarted API (new pool, new ledger) sees the same state', async () => {
    const g = graph();
    const first = pool();
    const d = await service(first, g.http).create(actor('u-a'), message);
    await first.end(); pools.splice(pools.indexOf(first), 1);
    const restarted = service(pool(), g.http);
    assert.equal((await restarted.get(actor('u-a'), d.id)).state, 'Draft');
    assert.equal((await restarted.send(actor('u-a'), d.id, { reviewedHash: d.contentHash })).draft.state, 'Accepted');
    assert.equal((await service(pool(), g.http).send(actor('u-a'), d.id, { reviewedHash: d.contentHash })).alreadyHandled, true);
    assert.equal(g.counter.sends, 1);
  });

  it('isolates owners with row-level security, and the API role cannot delete or spoof an owner', async () => {
    const ledger = new PgEmailLedger(pool());
    const d = await service(pool(), graph().http).create(actor('u-a'), message);
    assert.equal(await ledger.get('u-b', d.id), null);
    assert.deepEqual(await ledger.list('u-b', 20), []);
    const row = (await ledger.get('u-a', d.id))!;
    assert.equal(await ledger.transition('u-b', d.id, row.version, { ...row, ownerUserId: 'u-b', version: row.version + 1 }), null);
    await assert.rejects(service(pool(), graph().http).get(actor('u-b'), d.id), /not available/);
    const c = await admin.connect();
    try {
      for (const sql of [
        `INSERT INTO prima.staff_email_drafts (id, owner_user_id, state, version, updated_at, data) VALUES (gen_random_uuid(), 'u-a', 'Draft', 1, now(), '{}')`,
        `UPDATE prima.staff_email_drafts SET owner_user_id = 'u-b'`,
        `DELETE FROM prima.staff_email_drafts`,
      ]) {
        await c.query('BEGIN'); await c.query('SET LOCAL ROLE prima_app'); await c.query(`SELECT set_config('app.user_id', 'u-b', true)`);
        const result = await c.query(sql).then(r => r.rowCount, (e: Error) => e);
        await c.query('ROLLBACK');
        assert.ok(result instanceof Error || result === 0, sql);
      }
    } finally { c.release(); }
    assert.equal((await ledger.get('u-a', d.id))!.state, 'Draft');
  });

  it('lets exactly one of many concurrent workers send, across separate pools', async () => {
    const g = graph();
    const d = await service(pool(), g.http).create(actor('u-a'), message);
    const workers = Array.from({ length: 6 }, () => service(pool(), g.http));
    const results = await Promise.all(workers.map(w => w.send(actor('u-a'), d.id, { reviewedHash: d.contentHash })));
    assert.equal(g.counter.sends, 1);
    assert.equal(results.filter(r => !r.alreadyHandled).length, 1);
    assert.ok(results.every(r => ['Sending', 'Accepted'].includes(r.draft.state)));
  });

  it('a crash after the claim keeps the draft locked; no retry sends it again until the sender settles it', async () => {
    const g = graph();
    const d = await service(pool(), g.http).create(actor('u-a'), message);
    // Simulate a worker that claimed the send and died before recording the outcome.
    const ledger = new PgEmailLedger(pool());
    const row = (await ledger.get('u-a', d.id))!;
    assert.ok(await ledger.transition('u-a', d.id, row.version, { ...row, state: 'Sending', version: row.version + 1, updatedAt: now, events: [...row.events, { at: now, action: 'send-pressed' }] }));
    for (let i = 0; i < 3; i++) assert.equal((await service(pool(), g.http).send(actor('u-a'), d.id, { reviewedHash: d.contentHash })).alreadyHandled, true);
    await assert.rejects(service(pool(), g.http).resolveUncertain(actor('u-a'), d.id, { sentItems: 'not-found' }), /Only an uncertain send/);
    clock += 5 * 60_000 + 1;
    // Not found in Sent Items is not proof: the dead worker's request may still complete. It stays locked.
    assert.equal((await service(pool(), g.http).resolveUncertain(actor('u-a'), d.id, { sentItems: 'not-found' })).state, 'Uncertain');
    for (let i = 0; i < 3; i++) assert.equal((await service(pool(), g.http).send(actor('u-a'), d.id, { reviewedHash: d.contentHash })).alreadyHandled, true);
    assert.equal(g.counter.sends, 0, 'Nothing reached Microsoft during the lock or after the report');
  });

  it('an Uncertain send survives restarts and is never retried automatically', async () => {
    const g = graph(async () => { throw new Error('connection reset'); });
    const d = await service(pool(), g.http).create(actor('u-a'), message);
    assert.equal((await service(pool(), g.http).send(actor('u-a'), d.id, { reviewedHash: d.contentHash })).draft.state, 'Uncertain');
    for (let i = 0; i < 3; i++) assert.equal((await service(pool(), g.http).send(actor('u-a'), d.id, { reviewedHash: d.contentHash })).alreadyHandled, true);
    assert.equal(g.counter.sends, 1);
    const listed = await service(pool(), g.http).list(actor('u-a'));
    assert.deepEqual(listed.drafts.map(x => x.state), ['Uncertain']);
  });

  it('pins the version 1 migration file: any SQL change must become a new version', () => {
    assert.equal(staffEmailLedgerSha256(), STAFF_EMAIL_LEDGER_SHA256);
    assert.match(staffEmailLedgerSql(), /COMMENT ON TABLE prima\.staff_email_drafts IS 'prima-staff-email-ledger v1'/);
  });

  it('readiness gate: ready only with the migrated v1 table, forced RLS, exact policy and least privilege', async () => {
    const ledger = new PgEmailLedger(pool());
    const mail = service(pool(), graph().http);
    assert.deepEqual(await ledger.readiness(), { ready: true });
    assert.equal((await mail.status(actor('u-a'))).status, 'ConfiguredNotVerified');
    const broken: [string, RegExp][] = [
      [`COMMENT ON TABLE prima.staff_email_drafts IS 'prima-staff-email-ledger v0'`, /version marker/],
      [`COMMENT ON TABLE prima.staff_email_drafts IS NULL`, /version marker/],
      [`ALTER TABLE prima.staff_email_drafts ADD COLUMN extra text`, /columns/],
      [`ALTER TABLE prima.staff_email_drafts NO FORCE ROW LEVEL SECURITY`, /row-level security/],
      [`ALTER TABLE prima.staff_email_drafts DISABLE ROW LEVEL SECURITY`, /row-level security/],
      [`CREATE POLICY open_all ON prima.staff_email_drafts USING (true)`, /policy/],
      [`DROP POLICY own_drafts ON prima.staff_email_drafts; CREATE POLICY own_drafts ON prima.staff_email_drafts USING (true) WITH CHECK (true)`, /policy/],
      [`GRANT DELETE ON prima.staff_email_drafts TO prima_app`, /more than/],
      [`GRANT TRUNCATE ON prima.staff_email_drafts TO prima_app`, /more than/],
      [`REVOKE UPDATE ON prima.staff_email_drafts FROM prima_app`, /lacks/],
      [`DROP TABLE prima.staff_email_drafts`, /not migrated/],
    ];
    for (const [sql, why] of broken) {
      await admin.query(sql);
      const r = await ledger.readiness();
      assert.equal(r.ready, false, sql); assert.match((r as { reason: string }).reason, why, sql);
      assert.equal((await mail.status(actor('u-a'))).status, 'NotConfigured', sql);
      await assert.rejects(mail.create(actor('u-a'), message), /not configured/, sql);
      await admin.query('DROP TABLE IF EXISTS prima.staff_email_drafts'); await admin.query(staffEmailLedgerSql());
      assert.deepEqual(await ledger.readiness(), { ready: true }, `restored after: ${sql}`);
    }
    const down = new Pool({ connectionString: 'postgres://nobody:none@127.0.0.1:1/none', connectionTimeoutMillis: 500 }); pools.push(down);
    assert.equal((await new PgEmailLedger(down).readiness()).ready, false, 'An unreachable database is never ready');
  });

  it('through the restricted API login (no superuser, prima_app by SET only): full flow works, nothing more is allowed', async () => {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_mail_test_login') THEN
      CREATE ROLE prima_mail_test_login LOGIN PASSWORD 'synthetic-test-only' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END $$`);
    await admin.query(`GRANT prima_app TO prima_mail_test_login WITH INHERIT FALSE, SET TRUE`);
    const url = new URL(URL_); url.username = 'prima_mail_test_login'; url.password = 'synthetic-test-only';
    const restricted = new Pool({ connectionString: url.toString(), max: 4 }); pools.push(restricted);
    try {
      assert.deepEqual(await new PgEmailLedger(restricted).readiness(), { ready: true });
      // 429 with a two-hour Retry-After is honoured in full through the restricted login, across a restart.
      const throttled = graph(async () => new Response(null, { status: 429, headers: { 'retry-after': '7200' } }));
      const d = await service(restricted, throttled.http).create(actor('u-a'), message);
      const r = await service(restricted, throttled.http).send(actor('u-a'), d.id, { reviewedHash: d.contentHash });
      assert.equal(r.draft.state, 'Failed');
      assert.equal(r.draft.retryNotBefore, new Date(Date.parse(now) + 7_200_000).toISOString());
      clock += 3_600_000 + 1;
      await assert.rejects(service(restricted, throttled.http).send(actor('u-a'), d.id, { reviewedHash: d.contentHash }), /wait/, 'Still waiting after one hour');
      clock += 3_600_000;
      const ok = graph();
      assert.equal((await service(restricted, ok.http).send(actor('u-a'), d.id, { reviewedHash: d.contentHash })).draft.state, 'Accepted');
      assert.equal(throttled.counter.sends + ok.counter.sends, 2);
      // Another user sees nothing; the login itself (before SET ROLE) reads nothing; no delete, DDL or escalation.
      assert.equal(await new PgEmailLedger(restricted).get('u-b', d.id), null);
      const c = await restricted.connect();
      try {
        for (const sql of [
          'SELECT count(*) FROM prima.staff_email_drafts',
          'DELETE FROM prima.staff_email_drafts',
          'ALTER TABLE prima.staff_email_drafts DISABLE ROW LEVEL SECURITY',
          'DROP TABLE prima.staff_email_drafts',
          'SET ROLE postgres',
        ]) {
          for (const asApp of sql.startsWith('SELECT') ? [false] : [false, true]) {
            await c.query('BEGIN');
            if (asApp) { await c.query('SET LOCAL ROLE prima_app'); await c.query(`SELECT set_config('app.user_id', 'u-a', true)`); }
            const result = await c.query(sql).then(x => x.rowCount, (e: Error) => e);
            await c.query('ROLLBACK');
            assert.ok(result instanceof Error, `${asApp ? 'prima_app' : 'login'}: ${sql}`);
          }
        }
      } finally { c.release(); }
      assert.equal((await new PgEmailLedger(restricted).get('u-a', d.id))!.state, 'Accepted');
    } finally {
      await restricted.end(); pools.splice(pools.indexOf(restricted), 1);
    }
  });

  it('retention removes old settled drafts but never a Sending or Uncertain lock', async () => {
    const ledger = new PgEmailLedger(pool());
    const old = '2026-01-01T00:00:00.000Z';
    const ids: Record<string, string> = {};
    for (const state of ['Draft', 'Accepted', 'Failed', 'Discarded', 'Sending', 'Uncertain'] as const) {
      const id = crypto.randomUUID(); ids[state] = id;
      const draft: EmailDraft = { id, ownerUserId: 'u-a', ownerTenantId: tenant, ownerOid: oid, state, ...message, cc: [], contentHash: 'x'.repeat(64), version: 1, createdAt: old, updatedAt: old, events: [] };
      await ledger.create(draft);
    }
    const fresh = await service(pool(), graph().http).create(actor('u-a'), message);
    assert.equal(await PgEmailLedger.purge(admin, new Date('2026-06-01T00:00:00Z')), 4);
    const left = (await admin.query('SELECT id, state FROM prima.staff_email_drafts ORDER BY state')).rows.map(r => r.id);
    assert.deepEqual(new Set(left), new Set([ids.Sending, ids.Uncertain, fresh.id]));
  });
});
