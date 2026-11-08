// Offline sync against a real local PostgreSQL through the restricted app role. Run with DATABASE_URL pointing at a
// throwaway local database: it is reset.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { OfflineController, offlineConfig } from '../src/offline.controller';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function asOwner(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function asRole(userId: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.company_ids', '', true)`, [userId]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

const help = (title: string) => ({ title, category: 'DEVICE', priority: 'P2', detail: '' });
const op = (kind: string, payload: unknown, opId: string = crypto.randomUUID()) => ({ opId, kind, createdAt: '2026-10-31T09:00:00+08:00', payload });
/** Each operation carries the lease it was saved under (unless it already names one). */
const batch = (leaseId: string, ops: Record<string, unknown>[]) => ({ ops: ops.map((o) => ({ leaseId, ...o })) });

describe('offline sync on PostgreSQL', () => {
  let db: Db;
  let doer: string;
  let other: string;
  let third: string;
  let jobId: string;
  let jobLog: number;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    const j = (await asOwner(`SELECT id, data->>'assigneeId' AS doer, jsonb_array_length(data->'log') AS n FROM prima.it_jobs WHERE data->>'status' = 'doing' ORDER BY id LIMIT 1`)).rows[0];
    doer = j.doer;
    jobId = j.id;
    jobLog = j.n;
    [other, third] = ['u-it-ex2', 'u-it-ex3', 'u-it-ex4'].filter((x) => x !== doer);
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const as = <R>(id: string, fn: (o: ReturnType<import('@prima/core').PrimaService['offlineSync']>, u: import('@prima/core').User) => Promise<R>) =>
    db.asUser(id, (svc, u) => fn(svc.offlineSync([doer, other, third]), u));

  it('two sends of the same operation at once create one request and one receipt', async () => {
    const lease = await as(doer, (o, u) => o.lease(u, { deviceLabel: 'UAT phone' }));
    const one = op('helpRequest', help('UAT PG offline printer one'));
    const both = await Promise.all([0, 1].map(() => as(doer, (o, u) => o.sync(u, batch(lease.id, [JSON.parse(JSON.stringify(one))])))));
    const r = both.map((b) => b.receipts[0]);
    assert.deepEqual(r.map((x) => x.status), ['applied', 'applied']);
    assert.deepEqual(r.map((x) => x.replayed).sort(), [false, true]);
    assert.equal(r[0].resultId, r[1].resultId);
    assert.equal((await asOwner(`SELECT count(*)::int AS n FROM prima.it_tickets WHERE data->>'offlineOpId' = $1`, [one.opId])).rows[0].n, 1);
  });

  it('two different operations with the same title at once: one request, the other held as a likely duplicate', async () => {
    const [l1, l2] = [await as(doer, (o, u) => o.lease(u, { deviceLabel: 'UAT phone' })), await as(doer, (o, u) => o.lease(u, { deviceLabel: 'UAT laptop' }))];
    const title = 'UAT PG same title two devices';
    const both = await Promise.all([l1, l2].map((l) => as(doer, (o, u) => o.sync(u, batch(l.id, [op('helpRequest', help(title))])))));
    assert.deepEqual(both.map((b) => b.receipts[0].status).sort(), ['applied', 'needs_review']);
    assert.equal((await asOwner(`SELECT count(*)::int AS n FROM prima.it_tickets WHERE data->>'title' = $1`, [title])).rows[0].n, 1);
  });

  it('lease requests at once never go past the limit of open leases', async () => {
    const open = (await asOwner(`SELECT count(*)::int AS n FROM prima.offline_leases WHERE data->>'userId' = $1 AND (data->>'expiresAt')::timestamptz > now()`, [third])).rows[0].n;
    const tries = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => as(third, (o, u) => o.lease(u, { deviceLabel: `UAT device ${i}` }))));
    assert.equal(tries.filter((t) => t.status === 'fulfilled').length, 5 - open);
    assert.equal((await asOwner(`SELECT count(*)::int AS n FROM prima.offline_leases WHERE data->>'userId' = $1 AND (data->>'expiresAt')::timestamptz > now()`, [third])).rows[0].n, 5);
  });

  it('a failure part-way keeps what landed, keeps nothing of the failed one, and stops there', async () => {
    const lease = await as(doer, (o, u) => o.lease(u, { deviceLabel: 'UAT phone' }));
    // Stand-in for an unexpected database failure on this job only (test-only trigger, removed after).
    await asOwner(`CREATE OR REPLACE FUNCTION public.uat_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${jobId}' THEN RAISE EXCEPTION 'UAT failure'; END IF; RETURN NEW; END $$`);
    await asOwner(`CREATE TRIGGER uat_fail BEFORE UPDATE ON prima.it_jobs FOR EACH ROW EXECUTE FUNCTION public.uat_fail()`);
    const a = op('helpRequest', help('UAT PG offline first'));
    const b = op('jobNote', { targetId: jobId, baseVersion: jobLog, note: 'UAT note that fails' });
    const c = op('helpRequest', help('UAT PG offline third'));
    let out;
    try {
      out = await as(doer, (o, u) => o.sync(u, batch(lease.id, [a, b, c])));
    } finally {
      await asOwner('DROP TRIGGER uat_fail ON prima.it_jobs');
      await asOwner('DROP FUNCTION public.uat_fail()');
    }
    assert.deepEqual(out.receipts.map((r) => [r.opId, r.status]), [[a.opId, 'applied'], [b.opId, 'error']]);
    const kept = await asRole(doer, 'SELECT data->>\'opId\' AS id FROM prima.offline_ops WHERE data->>\'opId\' = ANY($1)', [[a.opId, b.opId, c.opId]]);
    assert.deepEqual(kept.rows.map((r) => r.id), [a.opId]);
    // Sent again once the fault is gone: the first is a replay, the others now land, in order.
    const again = await as(doer, (o, u) => o.sync(u, batch(lease.id, [a, b, c])));
    assert.deepEqual(again.receipts.map((r) => [r.status, r.replayed]), [['applied', true], ['applied', false], ['applied', false]]);
  });

  it('the database keeps each person to their own leases and operations, and keeps operations as sent', async () => {
    const lease = await as(doer, (o, u) => o.lease(u, { deviceLabel: 'UAT phone' }));
    const held = op('helpRequest', help('UAT PG offline first'));
    await as(doer, (o, u) => o.sync(u, batch(lease.id, [held])));
    assert.equal((await asRole(other, 'SELECT id FROM prima.offline_ops')).rowCount, 0);
    assert.equal((await asRole(other, 'SELECT id FROM prima.offline_leases')).rowCount, 0);
    assert.equal((await asRole(other, `UPDATE prima.offline_ops SET data = data || '{"status": "discarded"}'`)).rowCount, 0);
    await assert.rejects(asRole(doer, 'DELETE FROM prima.offline_ops'), /permission denied/);
    await assert.rejects(asRole(doer, `UPDATE prima.offline_leases SET data = data || '{"expiresAt": "2099-01-01T00:00:00Z"}'`), /permission denied/);
    const key = `${doer}:${held.opId}`;
    const row = (await asRole(doer, 'SELECT data FROM prima.offline_ops WHERE id = $1', [key])).rows[0].data;
    assert.equal(row.status, 'needs_review', 'a repeat of an open request of the same person is held');
    await assert.rejects(asRole(doer, `UPDATE prima.offline_ops SET data = data || '{"payloadHash": "${'0'.repeat(64)}"}' WHERE id = $1`, [key]), /keeps what was sent/);
    await assert.rejects(asRole(doer, `UPDATE prima.offline_ops SET data = data - 'leaseId' WHERE id = $1`, [key]), /keeps what was sent|check constraint/);
    await asRole(doer, `UPDATE prima.offline_ops SET data = data || '{"status": "discarded"}' WHERE id = $1`, [key]);
    await assert.rejects(asRole(doer, `UPDATE prima.offline_ops SET data = data || '{"status": "applied"}' WHERE id = $1`, [key]), /decided, once/);
    // Someone else's operation ID cannot be inserted under your name, and a lease cannot be longer than 72 hours.
    await assert.rejects(asRole(other, 'INSERT INTO prima.offline_ops (id, data) VALUES ($1, $2)', [key, { ...row, status: 'applied' }]), /row-level security/);
    const long = { id: crypto.randomUUID(), userId: doer, deviceLabel: 'UAT', issuedAt: '2026-10-31T10:00:00+08:00', expiresAt: '2026-11-04T10:00:00+08:00' };
    await assert.rejects(asRole(doer, 'INSERT INTO prima.offline_leases (id, data) VALUES ($1, $2)', [long.id, long]), /check constraint/);
  });

  it('stays off unless OFFLINE_SYNC_ENABLED is exactly true, and needs a Microsoft sign-in', () => {
    const was = { e: process.env.OFFLINE_SYNC_ENABLED, u: process.env.OFFLINE_SYNC_USERS };
    try {
      for (const v of [undefined, '', 'false', 'TRUE', '1']) {
        if (v === undefined) delete process.env.OFFLINE_SYNC_ENABLED;
        else process.env.OFFLINE_SYNC_ENABLED = v;
        const c = new OfflineController(db);
        for (const call of [() => c.lease({}, {}), () => c.sync({}, {}), () => c.receipts({}), () => c.resolve({}, 'x', {})])
          assert.throws(call, (e: { getStatus?: () => number }) => e.getStatus?.() === 503);
      }
      process.env.OFFLINE_SYNC_ENABLED = 'true';
      assert.throws(() => new OfflineController(db).sync({}, {}), (e: { getStatus?: () => number }) => e.getStatus?.() === 403);
      process.env.OFFLINE_SYNC_USERS = ' u-it-ex1, bad id!,u-it-ex2 ';
      assert.deepEqual(offlineConfig().users, ['u-it-ex1', 'u-it-ex2']);
      delete process.env.OFFLINE_SYNC_USERS;
      assert.deepEqual(offlineConfig().users, []);
    } finally {
      if (was.e === undefined) delete process.env.OFFLINE_SYNC_ENABLED;
      else process.env.OFFLINE_SYNC_ENABLED = was.e;
      if (was.u === undefined) delete process.env.OFFLINE_SYNC_USERS;
      else process.env.OFFLINE_SYNC_USERS = was.u;
    }
  });
});
