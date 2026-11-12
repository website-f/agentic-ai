// J5 (P100, Fauzan 11 Nov 2026): guard sign-ins in bulk and the 90-day location deletion, in the database itself: the
// two repeat-safe modules, forced row-level security, only the database making sign-ins (and only for an approved batch,
// by its approver, never the preparer), wrong roles refused, and the retention job deleting only old readings.
// Throwaway local database, synthetic seed data.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { runLocationRetention } from '../src/location-retention';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const mod = (f: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${f}`), 'utf8');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function asApp(sql: string, params: unknown[], userId: string, companies: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true), set_config('app.user_id', $2, true), set_config('app.group_user', 'off', true)`, [companies, userId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

describe('J5 guard sign-ins and location retention (PostgreSQL)', () => {
  let db: Db;
  let cm = '';
  let companyId = '';
  before(async () => {
    await resetDb(URL, myt('2026-11-12', '10:00'));
    for (const f of ['guard-signins-v1.sql', 'location-retention-v1.sql']) {
      await admin(mod(f));
      await admin(mod(f)); // repeat-safe
    }
    const r = (await admin(`SELECT id, data->'companyIds'->>0 AS c FROM prima.users WHERE data->>'role' = 'company_manager' AND jsonb_array_length(data->'companyIds') = 1 ORDER BY id LIMIT 1`)).rows[0];
    cm = r.id;
    companyId = r.c;
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('installs with forced row-level security and no delete or user writes for the runtime role', async () => {
    const r = await admin(`SELECT relforcerowsecurity f, has_table_privilege('prima_app', oid, 'DELETE') d FROM pg_class WHERE oid = 'prima.guard_signin_batches'::regclass`);
    assert.deepEqual(r.rows[0], { f: true, d: false });
    const u = await admin(`SELECT has_table_privilege('prima_app', 'prima.users', 'INSERT') i, has_table_privilege('prima_app', 'prima.location_pings', 'DELETE') d`);
    assert.deepEqual(u.rows[0], { i: false, d: false });
  });

  it('prepares, refuses self-approval and wrong roles, and the approval makes the sign-ins in the database', async () => {
    const board = await db.asUser('u-pwvsb-hr', (svc, u) => svc.guardSignInBoard(u, companyId));
    assert.ok(board.candidates.length >= 2);
    const pick = board.candidates.slice(0, 2).map((c) => c.personId);
    const b = await db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareGuardSignIns(u, companyId, pick, 'Synthetic'));
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.decideGuardSignIns(u, b.id, true, 'Mine')), (e) => e instanceof AccessDenied);
    await assert.rejects(db.asUser('u-transport', (svc, u) => svc.decideGuardSignIns(u, b.id, true, 'Not mine')), (e) => e instanceof AccessDenied || /not found/i.test(String(e)));
    // The database itself refuses to make sign-ins for a batch that is not approved, or for its preparer.
    await assert.rejects(asApp(`SELECT prima.gsb_create($1)`, [b.id], 'u-pwvsb-hr', companyId), /not approved/);
    await assert.rejects(asApp(`INSERT INTO prima.users (id, data) VALUES ('u-x', '{}'::jsonb)`, [], 'u-pwvsb-hr', companyId), /permission denied/);
    const done = await db.asUser(cm, (svc, u) => svc.decideGuardSignIns(u, b.id, true, 'Checked against the list'));
    assert.equal(done.status, 'created');
    assert.equal(done.created?.count, 2);
    const users = (await admin(`SELECT data FROM prima.users WHERE id = ANY($1)`, [pick.map((p) => `u-g-${p}`)])).rows.map((x) => x.data);
    assert.equal(users.length, 2);
    for (const u of users) assert.deepEqual({ role: u.role, companyIds: u.companyIds, dept: u.department ?? null }, { role: 'guard', companyIds: [companyId], dept: null });
    // Running the function again changes nothing (the batch is no longer 'approved').
    await assert.rejects(asApp(`SELECT prima.gsb_create($1)`, [b.id], cm, companyId), /not approved/);
  });

  it('deletes only readings older than 90 days, only for the job, and keeps the rest', async () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
    for (const [id, at] of [['lp-old', old], ['lp-new', recent]])
      await admin(`INSERT INTO prima.location_pings (id, company_id, data) VALUES ($1, NULL, $2)`, [id, { id, clockId: 'c', userId: 'u-x', companyId: null, capturedAt: at, receivedAt: at, lat: 3, lng: 101, accuracyM: 5, distanceM: null }]);
    // A person's own session cannot call the purge.
    await assert.rejects(asApp(`SELECT prima.purge_location_readings(90)`, [], 'u-pwvsb-hr', ''), /retention job/);
    const c = await db.pool.connect();
    try {
      await assert.rejects(runLocationRetention(c, 7), /at least 30 days/);
      const r = await runLocationRetention(c, 90);
      assert.equal(r.installed, true);
      assert.ok(r.staff >= 1);
    } finally {
      c.release();
    }
    const left = (await admin(`SELECT id FROM prima.location_pings WHERE id IN ('lp-old', 'lp-new')`)).rows.map((x) => x.id);
    assert.deepEqual(left, ['lp-new']);
    const audit = (await admin(`SELECT data->>'summary' s FROM prima.audit WHERE data->>'action' = 'privacy.location_retention'`)).rows;
    assert.equal(audit.length, 1);
  });
});
