// Job email store against a disposable PostgreSQL 16 (never staging). Graph is mocked; no network.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Pool } from 'pg';
import type { User } from '@prima/core';
import type { DelegatedActor } from '../src/connections-mail/delegated';
import { JobEmail, type JobEmailAccess } from '../src/connections-mail/job-email';
import type { JobEmailRecord } from '../src/connections-mail/job-email-store';
import { JOB_EMAIL_STORE_SHA256, jobEmailStoreSha256, jobEmailStoreSql, PgJobEmailStore } from '../src/connections-mail/pg-job-email-store';
import { itJobEmailAccess, itJobEmailRule } from '../src/connections-mail/it-job-access';
import { resetDb } from '../src/reset-db';

const URL_ = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
const tenant = '11111111-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oid = '99999999-8888-7777-6666-555555555555';
const env: NodeJS.ProcessEnv = { JOB_EMAIL_ENABLED: 'true', JOB_EMAIL_PREVIEW_SECRET: 'a'.repeat(64), ENTRA_TENANT_ID: tenant, ENTRA_API_CLIENT_ID: client, JOB_EMAIL_OBO_CLIENT_SECRET: 'synthetic' };
const actor = (id: string): DelegatedActor => ({ user: { id, name: id, entraOid: oid } as unknown as User, visibleCompanyIds: [], assertion: { userId: id, oid, tenantId: tenant, accessToken: `A_${id}` } });
const access: JobEmailAccess = { async canAttach(a) { return ['u-a', 'u-b'].includes(a.user.id); }, async canView() { return true; } };
const MSG = 'AAMkAGI2TG93AAA-synthetic_message_id_0001=';
const link = `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(MSG)}`;
const graphMessage = { id: MSG, internetMessageId: '<pg-1@example.com>', subject: 'Synthetic', from: { emailAddress: { name: 'V', address: 'v@example.com' } }, toRecipients: [], ccRecipients: [],
  sentDateTime: '2026-10-30T02:00:00Z', receivedDateTime: '2026-10-30T02:00:05Z', body: { contentType: 'text', content: 'Dummy' }, hasAttachments: false, webLink: 'https://outlook.office365.com/owa/?ItemID=AAMkAAAAAAAAAAAAAAAA' };
const graph = () => (async (url: string | URL | Request) => {
  if (String(url).includes('/oauth2/')) return new Response(JSON.stringify({ token_type: 'Bearer', access_token: 'T', scope: 'Mail.Read' }), { headers: { 'content-type': 'application/json' } });
  if (String(url).startsWith('https://graph.microsoft.com/v1.0/me/messages/')) return new Response(JSON.stringify(graphMessage), { headers: { 'content-type': 'application/json' } });
  throw new Error('Unexpected request; no network permitted in test.');
}) as typeof fetch;

describe('Durable job email store (disposable database only)', () => {
  const admin = new Pool({ connectionString: URL_ });
  const pools: Pool[] = [];
  const pool = (url = URL_) => { const p = new Pool({ connectionString: url, max: 4 }); pools.push(p); return p; };
  const service = (p: Pool) => new JobEmail(new PgJobEmailStore(p), access, () => env, graph(), () => new Date());
  const attach = async (p: Pool, who = 'u-a', job = 'j-1') => {
    const s = service(p); const pv = await s.preview(actor(who), job, { outlookLink: link });
    return s.attach(actor(who), job, { outlookLink: link, previewToken: pv.previewToken });
  };
  const asApp = async (user: string, job: string | null, sql: string, params: unknown[] = []) => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE prima_app');
      await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.job_email_job', $2, true)`, [user, job ?? '']);
      return await c.query(sql, params).then(r => r.rowCount, (e: Error) => e);
    } finally { await c.query('ROLLBACK'); c.release(); }
  };

  // Synthetic people and IT jobs for the database's own job rule (never real records).
  const closed = '2026-01-01';
  const PEOPLE: Record<string, Record<string, unknown>> = {
    'u-a': { department: 'it', itRole: 'executive' }, 'u-b': { department: 'it', itRole: 'manager' }, 'u-lead': { department: 'it', itRole: 'lead' },
    'u-giver': { department: 'finance' }, 'u-coo': { opsTier: 'coo' }, 'u-ceo': { opsTier: 'ceo' }, 'u-act': { department: 'audit' },
    'u-hr': { department: 'hr' }, 'u-cos': { department: 'chief_of_staff' }, 'u-other': { department: 'it', itRole: 'executive' },
    'u-sales': { department: 'sales' }, 'u-closed': { department: 'it', itRole: 'manager', accessClosedFrom: closed }, 'u-feed': { department: 'it', itRole: 'manager', integration: 'planner' },
  };
  const JOBS: Record<string, Record<string, unknown>> = {
    'j-1': { assigneeId: 'u-a', givenById: 'u-giver', status: 'doing' }, 'j-2': { assigneeId: 'u-a', givenById: 'u-b', status: 'todo' },
    'j-x': { assigneeId: 'u-a', givenById: 'u-b', status: 'cancelled' },
  };
  before(async () => {
    if ((await admin.query(`SELECT to_regclass('prima.it_jobs') IS NULL AS missing`)).rows[0].missing) await resetDb(URL_);
    for (const [id, d] of Object.entries(PEOPLE)) await admin.query('INSERT INTO prima.users (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [id, JSON.stringify({ id, name: id, ...d })]);
    for (const [id, d] of Object.entries(JOBS)) await admin.query('INSERT INTO prima.it_jobs (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [id, JSON.stringify({ id, ...d })]);
    await admin.query('DROP TABLE IF EXISTS prima.job_email_attachments');
    await admin.query(jobEmailStoreSql());
  });
  beforeEach(async () => { await admin.query('TRUNCATE prima.job_email_attachments'); });
  after(async () => { await Promise.all(pools.map(p => p.end())); await admin.end(); });

  it('pins the version 2 migration file', () => {
    assert.equal(jobEmailStoreSha256(), JOB_EMAIL_STORE_SHA256);
    assert.match(jobEmailStoreSql(), /COMMENT ON TABLE prima\.job_email_attachments IS 'prima-job-email-attachments v2'/);
  });

  it('is durable across restarts, and one email attaches once per job even under concurrent presses', async () => {
    const v = await attach(pool());
    const restarted = service(pool());
    assert.equal((await restarted.list(actor('u-b'), 'j-1')).emails[0].id, v.id);
    await assert.rejects(attach(pool()), /already attached/);
    await admin.query('TRUNCATE prima.job_email_attachments');
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => attach(pool())));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM prima.job_email_attachments')).rows[0].n, 1);
  });

  it('RLS shows only the job the API authorised, and only the attacher can remove', async () => {
    const v = await attach(pool(), 'u-a', 'j-1');
    await attach(pool(), 'u-a', 'j-2');
    assert.equal(await asApp('u-a', 'j-1', 'SELECT * FROM prima.job_email_attachments'), 1);
    assert.equal(await asApp('u-a', null, 'SELECT * FROM prima.job_email_attachments'), 0, 'No job set: nothing visible');
    assert.equal(await asApp('u-b', 'j-3', 'SELECT * FROM prima.job_email_attachments'), 0);
    const store = new PgJobEmailStore(pool());
    const row = (await store.get('u-b', 'j-1', v.id))!;
    assert.equal(await store.remove('u-b', 'j-1', v.id, { ...row, attachedBy: 'u-b', removedAt: new Date().toISOString(), snapshot: null }), null);
    assert.ok((await asApp('u-b', 'j-1', `UPDATE prima.job_email_attachments SET removed_at = now(), data = jsonb_set(data, '{snapshot}', 'null') WHERE id = $1`, [v.id])) === 0);
    const spoof: JobEmailRecord = { ...row, id: crypto.randomUUID(), attachedBy: 'u-a', internetMessageId: '<other@example.com>' };
    assert.ok(await asApp('u-b', 'j-1', `INSERT INTO prima.job_email_attachments (id, job_id, attached_by, internet_message_id, attached_at, expires_at, data) VALUES ($1, 'j-1', 'u-a', $2, now(), now(), $3)`,
      [spoof.id, spoof.internetMessageId, JSON.stringify(spoof)]) instanceof Error, 'Cannot insert as someone else');
    assert.ok(await asApp('u-a', 'j-1', 'DELETE FROM prima.job_email_attachments') instanceof Error, 'No DELETE for the app');
    assert.equal((await service(pool()).remove(actor('u-a'), 'j-1', v.id)).state, 'Removed');
  });

  it('deduplicates canonical mailbox messages, not spoofable Internet Message-ID headers', async () => {
    const v = await attach(pool());
    const store = new PgJobEmailStore(pool());
    const row = (await store.get('u-a', 'j-1', v.id))!;
    assert.equal(await store.insert('u-a', { ...row, id: crypto.randomUUID(), internetMessageId: '<different-header@example.com>' }), 'duplicate');
    assert.equal(await store.insert('u-a', { ...row, id: crypto.randomUUID(), canonicalMessageId: MSG + 'different' }), 'ok');
    assert.equal(await store.insert('u-a', { ...row, id: crypto.randomUUID(), attachedByOid: 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb' }), 'ok');
  });

  it('refuses null/missing keys, JSON lifecycle divergence, and metadata changes disguised as removal', async () => {
    const v = await attach(pool());
    const row = (await new PgJobEmailStore(pool()).get('u-a', 'j-1', v.id))!;
    const insert = async (d: Record<string, unknown>) => asApp('u-a', 'j-1',
      `INSERT INTO prima.job_email_attachments (id,job_id,attached_by,tenant_id,mailbox_oid,canonical_message_id,internet_message_id,attached_at,expires_at,removed_at,data)
       VALUES ($1,'j-1','u-a',$2,$3,$4,$5,$6,$7,NULL,$8)`,
      [d.id,tenant,oid,MSG+'new',row.internetMessageId,row.attachedAt,row.expiresAt,JSON.stringify(d)]);
    for (const key of Object.keys(row)) {
      if (key === 'id') continue;
      const base = { ...row, id: crypto.randomUUID(), canonicalMessageId: MSG+'new' };
      const absent: Record<string, unknown> = { ...base }; delete absent[key];
      assert.ok(await insert(absent) instanceof Error, `missing ${key}`);
      if (key !== 'removedAt') assert.ok(await insert({ ...base, [key]: null }) instanceof Error, `null ${key}`);
    }
    for (const patch of [
      { expiresAt: new Date(Date.parse(row.expiresAt)+1000).toISOString() },
      { attachedAt: new Date(Date.parse(row.attachedAt)-1000).toISOString() },
      { removedAt: new Date().toISOString() },
      { canonicalMessageId: null },
    ]) assert.ok(await insert({ ...row, id: crypto.randomUUID(), canonicalMessageId: MSG+'new', ...patch }) instanceof Error);
    const removedAt = new Date().toISOString();
    const removal = { ...row, removedAt, snapshot: null, events: [...row.events,{at:removedAt,by:'u-a',action:'removed'}] };
    for (const patch of [{ webLink: 'https://outlook.office.com/mail/forged' }, { attachedByName: 'forged' }, { events: [] }]) {
      assert.ok(await asApp('u-a','j-1','UPDATE prima.job_email_attachments SET removed_at=$2,data=$3 WHERE id=$1',
        [row.id,removedAt,JSON.stringify({...removal,...patch})]) instanceof Error);
    }
  });

  it('the database checks the IT job rule itself: an API that wrongly says yes still cannot read or attach', async () => {
    await attach(pool(), 'u-a', 'j-1');
    const allowAll: JobEmailAccess = { async canAttach() { return true; }, async canView() { return true; } };
    const loose = new JobEmail(new PgJobEmailStore(pool()), allowAll, () => env, graph(), () => new Date());
    for (const who of ['u-other', 'u-sales', 'u-closed', 'u-feed', 'u-nobody']) {
      assert.equal(await asApp(who, 'j-1', 'SELECT * FROM prima.job_email_attachments'), 0, `${who} reads nothing`);
      assert.deepEqual((await loose.list(actor(who), 'j-1')).emails, [], `${who}: list through a too-loose API is empty`);
      const pv = await loose.preview(actor(who), 'j-1', { outlookLink: link });
      await admin.query('TRUNCATE prima.job_email_attachments');
      await assert.rejects(loose.attach(actor(who), 'j-1', { outlookLink: link, previewToken: pv.previewToken }), /row-level security/, `${who} cannot attach`);
      await attach(pool(), 'u-a', 'j-1');
    }
    for (const who of ['u-ceo', 'u-act', 'u-hr', 'u-cos']) {
      assert.equal(await asApp(who, 'j-1', 'SELECT * FROM prima.job_email_attachments'), 1, `${who} may look`);
      const pv = await loose.preview(actor(who), 'j-2', { outlookLink: link });
      await assert.rejects(loose.attach(actor(who), 'j-2', { outlookLink: link, previewToken: pv.previewToken }), /row-level security/, `${who} only looks`);
    }
    for (const who of ['u-giver', 'u-coo', 'u-lead', 'u-b']) {
      await admin.query('TRUNCATE prima.job_email_attachments');
      const pv = await loose.preview(actor(who), 'j-1', { outlookLink: link });
      assert.equal((await loose.attach(actor(who), 'j-1', { outlookLink: link, previewToken: pv.previewToken })).state, 'Available', `${who} attaches`);
    }
    const giverPv = await loose.preview(actor('u-giver'), 'j-2', { outlookLink: link });
    await assert.rejects(loose.attach(actor('u-giver'), 'j-2', { outlookLink: link, previewToken: giverPv.previewToken }), /row-level security/, 'Giver of another job: no');
    const pv = await loose.preview(actor('u-a'), 'j-x', { outlookLink: link });
    await assert.rejects(loose.attach(actor('u-a'), 'j-x', { outlookLink: link, previewToken: pv.previewToken }), /row-level security/, 'Cancelled job: no attaching');
    assert.equal(await asApp('u-a', 'j-404', 'SELECT * FROM prima.job_email_attachments'), 0, 'Unknown job: nothing');
  });

  it('the API rule and the database rule agree for every synthetic person, job and need', async () => {
    const now = new Date();
    const getJob = async (id: string) => (JOBS[id] ? { id, ...JOBS[id] } : null) as never;
    const api = itJobEmailAccess(getJob, () => now);
    let checked = 0;
    for (const who of [...Object.keys(PEOPLE), 'u-nobody']) for (const job of [...Object.keys(JOBS), 'j-404']) for (const need of ['view', 'attach'] as const) {
      const c = await admin.connect();
      let db: boolean;
      try {
        await c.query('BEGIN'); await c.query('SET LOCAL ROLE prima_app'); await c.query(`SELECT set_config('app.user_id', $1, true)`, [who]);
        db = (await c.query('SELECT prima.job_email_job_access($1, $2) AS ok', [job, need])).rows[0].ok;
      } finally { await c.query('ROLLBACK'); c.release(); }
      const user = { id: who, ...(PEOPLE[who] ?? {}) } as unknown as User;
      const fromApi = PEOPLE[who] ? await (need === 'view' ? api.canView : api.canAttach)({ ...actor(who), user }, job) : false;
      assert.equal(fromApi, db, `${who} ${need} ${job}`);
      if (PEOPLE[who]) assert.equal(itJobEmailRule(user, JOBS[job] as never ?? null, need, now), db);
      checked++;
    }
    assert.equal(checked, 14 * 4 * 2);
  });

  it('the guard allows only removal or post-expiry erasure: no edits, no restore, no un-remove', async () => {
    const v = await attach(pool());
    for (const sql of [
      `UPDATE prima.job_email_attachments SET data = jsonb_set(data, '{snapshot,subject}', '"forged"')`,
      `UPDATE prima.job_email_attachments SET expires_at = expires_at - interval '1 day'`,
      `UPDATE prima.job_email_attachments SET attached_at = attached_at - interval '1 day'`,
      `UPDATE prima.job_email_attachments SET data = jsonb_set(data, '{snapshot}', 'null')`,
    ]) assert.ok(await asApp('u-a', 'j-1', sql) instanceof Error, sql);
    await service(pool()).remove(actor('u-a'), 'j-1', v.id);
    assert.ok(await asApp('u-a', 'j-1', `UPDATE prima.job_email_attachments SET removed_at = NULL, data = jsonb_set(data, '{snapshot}', '{"subject":"back"}')`) instanceof Error);
    assert.ok(await admin.query(`UPDATE prima.job_email_attachments SET removed_at = NULL`).then(() => null, (e: Error) => e) instanceof Error, 'Even the owner role cannot un-remove');
    const store = new PgJobEmailStore(pool());
    const removed = (await store.get('u-a','j-1',v.id))!;
    const at = new Date();
    const overlong: JobEmailRecord = { ...removed, id: crypto.randomUUID(), canonicalMessageId: MSG+'overlong',
      attachedAt: at.toISOString(), expiresAt: new Date(at.getTime()+31*86_400_000).toISOString(), removedAt: null,
      snapshot: { subject:'S',from:null,to:[],cc:[],sentAt:null,receivedAt:null,body:'B',bodyTruncated:false,hasAttachments:false,webLink:graphMessage.webLink,internetMessageId:removed.internetMessageId },
      events:[{at:at.toISOString(),by:'u-a',action:'attached'}] };
    await assert.rejects(store.insert('u-a',overlong), (e: unknown) => (e as {code?:string}).code === '23514', 'Keep period constraint, not missing columns, must reject 31 days');
  });

  it('retention erases copies older than 30 days and keeps the stub; newer and removed rows are untouched', async () => {
    const store = new PgJobEmailStore(pool());
    const old = new Date(Date.now() - 31 * 86_400_000);
    const make = (msgId: string, at: Date): JobEmailRecord => ({ id: crypto.randomUUID(), jobId: 'j-1', attachedBy: 'u-a', attachedByName: 'u-a', attachedByTenantId: tenant, attachedByOid: oid,
      attachedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 30 * 86_400_000).toISOString(), removedAt: null, canonicalMessageId: 'A'.repeat(20) + msgId.replace(/[^a-zA-Z0-9]/g, ''), internetMessageId: msgId, webLink: graphMessage.webLink,
      snapshotHash: 'a'.repeat(64), snapshot: { subject: 'S', from: null, to: [], cc: [], sentAt: null, receivedAt: null, body: 'B', bodyTruncated: false, hasAttachments: false, webLink: graphMessage.webLink, internetMessageId: msgId },
      events: [{ at: at.toISOString(), by: 'u-a', action: 'attached' }] });
    const expired = make('<old@example.com>', old); const fresh = make('<new@example.com>', new Date());
    assert.equal(await store.insert('u-a', expired), 'ok'); assert.equal(await store.insert('u-a', fresh), 'ok');
    // A superuser-only test masks FORCE RLS failures on Azure. Exercise a real
    // NOSUPERUSER/NOBYPASSRLS table owner, with no app.user_id/job context.
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('CREATE ROLE job_email_test_owner NOSUPERUSER NOBYPASSRLS NOLOGIN');
      await c.query('GRANT USAGE, CREATE ON SCHEMA prima TO job_email_test_owner');
      await c.query('ALTER FUNCTION prima.job_email_row_valid(uuid,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb) OWNER TO job_email_test_owner');
      await c.query('ALTER FUNCTION prima.job_email_job_access(text,text) OWNER TO job_email_test_owner');
      await c.query('ALTER FUNCTION prima.job_email_attachments_guard() OWNER TO job_email_test_owner');
      await c.query('GRANT SELECT ON prima.users, prima.it_jobs TO job_email_test_owner');
      await c.query('ALTER TABLE prima.job_email_attachments OWNER TO job_email_test_owner');
      await c.query('ALTER POLICY job_retention_read ON prima.job_email_attachments TO job_email_test_owner');
      await c.query('ALTER POLICY job_retention_update ON prima.job_email_attachments TO job_email_test_owner');
      await c.query('SET LOCAL ROLE job_email_test_owner');
      const role = (await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
      await c.query("SELECT set_config('app.user_id','',true),set_config('app.job_email_job','',true)");
      assert.equal((await c.query('SELECT count(*)::int n FROM prima.job_email_attachments')).rows[0].n, 1, 'Owner maintenance sees expired rows only');
      const maintenance = { query: c.query.bind(c) } as unknown as Pool;
      assert.equal(await PgJobEmailStore.eraseExpired(maintenance, new Date()), 1);
      assert.equal(await PgJobEmailStore.eraseExpired(maintenance, new Date()), 0, 'Idempotent');
      const kept = (await c.query('SELECT data FROM prima.job_email_attachments WHERE id=$1',[expired.id])).rows[0].data as JobEmailRecord;
      assert.equal(kept.snapshot, null); assert.equal(kept.webLink, graphMessage.webLink);
      assert.deepEqual(kept.events.map(e => e.action), ['attached', 'expired']);
      await c.query('RESET ROLE');
      assert.equal((await c.query('SELECT data FROM prima.job_email_attachments WHERE id=$1',[fresh.id])).rows[0].data.snapshot.body, 'B');
    } finally { await c.query('ROLLBACK'); c.release(); }

  });

  it('readiness gate: ready only with the migrated v2 table, guard, unique index, exact policies and least privilege', async () => {
    const store = new PgJobEmailStore(pool());
    assert.deepEqual(await store.readiness(), { ready: true });
    const broken: [string, RegExp][] = [
      [`COMMENT ON TABLE prima.job_email_attachments IS 'prima-job-email-attachments v0'`, /marker/],
      [`ALTER TABLE prima.job_email_attachments ADD COLUMN extra text`, /Columns/],
      [`ALTER TABLE prima.job_email_attachments NO FORCE ROW LEVEL SECURITY`, /Row-level/],
      [`ALTER POLICY job_retention_read ON prima.job_email_attachments TO PUBLIC`, /Policies/],
      [`ALTER POLICY job_retention_update ON prima.job_email_attachments USING (true)`, /Policies/],
      [`CREATE POLICY open_all ON prima.job_email_attachments FOR SELECT USING (true)`, /Policies/],
      [`DROP POLICY job_read ON prima.job_email_attachments; CREATE POLICY job_read ON prima.job_email_attachments FOR SELECT USING (true)`, /Policies/],
      [`ALTER TABLE prima.job_email_attachments DISABLE TRIGGER job_email_attachments_guard`, /guard/],
      [`DROP INDEX prima.job_email_attachments_once`, /index/],
      [`DROP INDEX prima.job_email_attachments_once; CREATE UNIQUE INDEX job_email_attachments_once ON prima.job_email_attachments (id)`, /index/],
      [`ALTER TABLE prima.job_email_attachments ALTER COLUMN canonical_message_id DROP NOT NULL`, /Columns/],
      [`ALTER TABLE prima.job_email_attachments DROP CONSTRAINT job_email_row_valid_check`, /CHECK/],
      [`ALTER TABLE prima.job_email_attachments DROP CONSTRAINT job_email_attachments_pkey`, /primary key/],
      [`CREATE OR REPLACE FUNCTION prima.job_email_attachments_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN RETURN NEW; END $$`, /guard/],
      [`ALTER FUNCTION prima.job_email_row_valid(uuid,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb) SECURITY DEFINER`, /validation/],
      [`GRANT EXECUTE ON FUNCTION prima.job_email_job_access(text, text) TO PUBLIC`, /job rule/],
      [`CREATE OR REPLACE FUNCTION prima.job_email_job_access(job text, need text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = prima, pg_temp AS $$ SELECT true $$`, /job rule/],
      [`ALTER FUNCTION prima.job_email_job_access(text, text) SECURITY INVOKER`, /job rule/],
      [`GRANT DELETE ON prima.job_email_attachments TO prima_app`, /more than/],
      [`REVOKE INSERT ON prima.job_email_attachments FROM prima_app`, /lacks/],
      [`DROP TABLE prima.job_email_attachments`, /not migrated/],
    ];
    const mail = service(pool());
    for (const [sql, why] of broken) {
      await admin.query(sql);
      const r = await store.readiness();
      assert.equal(r.ready, false, sql); assert.match((r as { reason: string }).reason, why, sql);
      assert.equal((await mail.status(actor('u-a'))).status, 'NotConfigured', sql);
      await assert.rejects(mail.preview(actor('u-a'), 'j-1', { outlookLink: link }), /not configured/, sql);
      await admin.query('DROP TABLE IF EXISTS prima.job_email_attachments'); await admin.query(jobEmailStoreSql());
      assert.deepEqual(await store.readiness(), { ready: true }, `restored after: ${sql}`);
    }
  });

  it('works through the restricted API login and allows nothing more', async () => {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_mail_test_login') THEN
      CREATE ROLE prima_mail_test_login LOGIN PASSWORD 'synthetic-test-only' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END $$`);
    await admin.query(`GRANT prima_app TO prima_mail_test_login WITH INHERIT FALSE, SET TRUE`);
    const url = new URL(URL_); url.username = 'prima_mail_test_login'; url.password = 'synthetic-test-only';
    const restricted = pool(url.toString());
    assert.deepEqual(await new PgJobEmailStore(restricted).readiness(), { ready: true });
    const v = await attach(restricted);
    assert.equal((await service(restricted).list(actor('u-b'), 'j-1')).emails[0].id, v.id);
    assert.equal((await service(restricted).remove(actor('u-a'), 'j-1', v.id)).state, 'Removed');
    const c = await restricted.connect();
    try {
      for (const sql of ['SELECT count(*) FROM prima.job_email_attachments', 'DELETE FROM prima.job_email_attachments', 'ALTER TABLE prima.job_email_attachments DISABLE ROW LEVEL SECURITY',
        'ALTER TABLE prima.job_email_attachments DISABLE TRIGGER job_email_attachments_guard', 'DROP TABLE prima.job_email_attachments', 'SET ROLE postgres']) {
        for (const role of sql.startsWith('SELECT') ? [false] : [false, true]) {
          await c.query('BEGIN');
          if (role) { await c.query('SET LOCAL ROLE prima_app'); await c.query(`SELECT set_config('app.user_id', 'u-a', true), set_config('app.job_email_job', 'j-1', true)`); }
          const result = await c.query(sql).then(() => null, (e: Error) => e);
          await c.query('ROLLBACK');
          assert.ok(result instanceof Error, `${role ? 'prima_app' : 'login'}: ${sql}`);
        }
      }
    } finally { c.release(); }
  });
});
