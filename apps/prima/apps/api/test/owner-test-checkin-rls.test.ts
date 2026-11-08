// P90: the owner's TEST check-in in the database itself: the repeat-safe module SQL, forced row-level security, the
// owner-only insert, each person reading only their own rows, and nothing written to the clock or check-in tables.
// Uses the same throwaway local database as rls.test.ts and resets it. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { BadRequest, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-09';
const NOW = myt(TODAY, '09:00');
const OWNER = 'u-fauzan';
const SQL = readFileSync(resolve(__dirname, '../../../../db/modules/owner-test-checkin-v1.sql'), 'utf8');
const KL = { lat: 3.1478, lng: 101.6953, accuracyM: 8 };

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

async function asApp(sql: string, params: unknown[], userId: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', '', true), set_config('app.user_id', $1, true), set_config('app.group_user', 'on', true)`, [userId]);
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

const counts = async () =>
  (await admin(`SELECT (SELECT count(*) FROM prima.staff_clocks)::int AS clocks, (SELECT count(*) FROM prima.checkin_events)::int AS events,
     (SELECT count(*) FROM prima.location_pings)::int AS pings, (SELECT count(*) FROM prima.attendance_days)::int AS days`)).rows[0];

describe('owner test check-in (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    await admin(SQL);
    // Repeat-safe: the office's prima-setup runs it on every start.
    await admin(SQL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('installs one table with forced row-level security and no delete for the runtime role', async () => {
    const r = await admin(`SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'owner_test_checkins'`);
    assert.deepEqual(r.rows, [{ relrowsecurity: true, relforcerowsecurity: true, del: false }]);
  });

  it('lets the owner check in, move and check out, and changes nothing else', async () => {
    const before = await counts();
    const t = { now: NOW };
    const at = () => t.now;
    await db.asUser(OWNER, (svc, u) => svc.ownerTestCheckins.start(u, KL), at);
    t.now = myt(TODAY, '09:01');
    const p = await db.asUser(OWNER, (svc, u) => svc.ownerTestCheckins.ping(u, { ...KL, lat: KL.lat + 0.001 }), at);
    assert.equal(p.accepted, true);
    t.now = myt(TODAY, '09:20');
    const done = await db.asUser(OWNER, (svc, u) => svc.ownerTestCheckins.end(u, { ...KL, lat: KL.lat + 0.002 }), at);
    assert.equal(done.trail.length, 3);
    const mine = await db.asUser(OWNER, (svc, u) => svc.ownerTestCheckins.mine(u), at);
    assert.equal(mine.sessions.length, 1);
    assert.deepEqual(await counts(), before);
  });

  it('refuses everyone else in the service and in the database', async () => {
    await assert.rejects(
      db.asUser('u-pwvsb-hr', (svc, u) => svc.ownerTestCheckins.start(u, KL), () => NOW),
      (e) => e instanceof BadRequest,
    );
    // Straight at the table as another sign-in: not the owner, so the insert is refused.
    const row = { id: 'otc-x', userId: 'u-pwvsb-hr', purpose: 'test' };
    await assert.rejects(asApp(`INSERT INTO prima.owner_test_checkins (id, data) VALUES ('otc-x', $1)`, [row], 'u-pwvsb-hr'), /row-level security/);
    // Nor can anyone write a row in the owner's name.
    await assert.rejects(asApp(`INSERT INTO prima.owner_test_checkins (id, data) VALUES ('otc-y', $1)`, [{ ...row, id: 'otc-y', userId: OWNER }], 'u-pwvsb-hr'), /row-level security/);
    // Nobody else reads or changes the owner's tests.
    const seen = await asApp('SELECT count(*)::int AS n FROM prima.owner_test_checkins', [], 'u-pwvsb-hr');
    assert.equal(seen.rows[0].n, 0);
    const upd = await asApp(`UPDATE prima.owner_test_checkins SET data = data || '{"note":"x"}'::jsonb`, [], 'u-pwvsb-hr');
    assert.equal(upd.rowCount, 0);
    const own = await asApp('SELECT count(*)::int AS n FROM prima.owner_test_checkins', [], OWNER);
    assert.equal(own.rows[0].n, 1);
    // A row must say it is a test.
    await assert.rejects(asApp(`INSERT INTO prima.owner_test_checkins (id, data) VALUES ('otc-z', $1)`, [{ id: 'otc-z', userId: OWNER, purpose: 'clock' }], OWNER), /otc_test_only/);
  });
});
