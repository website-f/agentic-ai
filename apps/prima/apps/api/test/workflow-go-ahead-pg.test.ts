// Workflow go-ahead items in PostgreSQL (Fitri package, Fauzan 11 Nov 2026): A9 office overtime claims module with its
// wall, A12 guard sign-ins in bulk and location readings deleted after the set days. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client, Pool } from 'pg';
import { GROUP_EMPLOYER_ID, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { createGuardLogins } from '../src/guard-logins';
import { purgeLocations } from '../src/purge-locations';
import { purgeRetention } from '../src/purge-retention';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('workflow go-ahead items (PostgreSQL)', () => {
  let db: Db;
  let pool: Pool;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    pool = new Pool({ connectionString: URL, max: 1 });
  });
  after(async () => {
    await db.onModuleDestroy();
    await pool.end();
  });

  it('A9: without the module the staff pay run is as before; with it, claims sit behind the time slip wall', async () => {
    await admin(`DELETE FROM prima.staff_pay_runs WHERE id = $1`, [`sp-${GROUP_EMPLOYER_ID}-2026-10`]);
    const before = await db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareStaffPay(u, GROUP_EMPLOYER_ID, '2026-10'), () => NOW);
    assert.ok(before.lines.length > 0);
    const none = await db.asUser('u-it-ex3', (svc, u) => svc.myOtClaims(u), () => NOW);
    assert.equal(none.allowed, false);
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/time-slip-v1.sql'), 'utf8'));
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/staff-ot-claims-v1.sql'), 'utf8'));
    const r = await admin(`SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'staff_ot_claims'`);
    assert.deepEqual([r.rows[0].relrowsecurity, r.rows[0].relforcerowsecurity, r.rows[0].del], [true, true, false]);
    const c = await db.asUser('u-it-ex3', (svc, u) => svc.requestOtClaim(u, { date: '2026-10-28', hours: 2, kind: 'normal', reason: 'Server move after hours' }), () => NOW);
    const mine = await db.asUser('u-it-ex3', (svc, u) => svc.myOtClaims(u), () => NOW);
    assert.ok(mine.mine.some((x) => x.id === c.id));
  });

  it('A12: makes guard sign-ins in bulk only on --apply, never twice, with one audit entry', async () => {
    const client = await pool.connect();
    try {
      const co = (await admin(`SELECT company_id FROM prima.people WHERE data->>'role' = 'guard' AND data->>'status' = 'active' GROUP BY company_id ORDER BY count(*) DESC LIMIT 1`)).rows[0].company_id as string;
      const dry = await createGuardLogins(client, co, 'Sample IT', false, Date.parse(NOW));
      assert.ok(dry.create.length > 0);
      const countUsers = async () => Number((await admin('SELECT count(*) FROM prima.users')).rows[0].count);
      const n0 = await countUsers();
      assert.equal(n0, await countUsers());
      const done = await createGuardLogins(client, co, 'Sample IT', true, Date.parse(NOW));
      assert.equal(await countUsers(), n0 + done.create.length);
      assert.equal((await createGuardLogins(client, co, 'Sample IT', true, Date.parse(NOW))).create.length, 0);
      const audit = await admin(`SELECT count(*) FROM prima.audit WHERE data->>'action' = 'GUARD_LOGINS_BULK'`);
      assert.equal(Number(audit.rows[0].count), 1);
      await assert.rejects(createGuardLogins(client, co, '', true), /--by/);
    } finally {
      client.release();
    }
  });

  it('A12: deletes guard phone and staff location readings older than the set days, only on --apply', async () => {
    const client = await pool.connect();
    try {
      const co = (await admin('SELECT id FROM prima.companies LIMIT 1')).rows[0].id as string;
      const old = new Date(Date.parse(NOW) - 120 * 86_400_000).toISOString();
      const fresh = new Date(Date.parse(NOW) - 5 * 86_400_000).toISOString();
      for (const [id, at] of [['gpg-a12-old', old], ['gpg-a12-new', fresh]])
        await admin('INSERT INTO prima.guard_pings (id, company_id, data) VALUES ($1, $2, $3)', [id, co, { id, companyId: co, sessionId: 's', userId: 'u', personId: 'p', siteId: null, shiftId: null, capturedAt: at, receivedAt: at, lat: 3.1, lng: 101.6, accuracyM: null }]);
      const dry = await purgeLocations(client, 'Daily job', false, Date.parse(NOW));
      assert.ok(dry.guard >= 1);
      assert.equal(Number((await admin(`SELECT count(*) FROM prima.guard_pings WHERE id = 'gpg-a12-old'`)).rows[0].count), 1);
      // D1 (Fauzan, 23 Nov 2026): deleting needs the PDPA officer's OK for the week; without the module nothing goes.
      await assert.rejects(purgeLocations(client, 'Daily job', true, Date.parse(NOW)), /not installed/);
      await admin(readFileSync(resolve(__dirname, '../../../../db/modules/pdpa-officer-v1.sql'), 'utf8'));
      await assert.rejects(purgeLocations(client, 'Daily job', true, Date.parse(NOW)), /No PDPA officer OK/);
      assert.equal(Number((await admin(`SELECT count(*) FROM prima.guard_pings WHERE id = 'gpg-a12-old'`)).rows[0].count), 1);
      await db.asUser('u-pdpa', (svc, u) => svc.pdpaOfficer.okCleanUp(u, { reason: 'No open legal hold needs these (synthetic)' }), () => NOW);
      await purgeLocations(client, 'Daily job', true, Date.parse(NOW));
      assert.equal(Number((await admin(`SELECT count(*) FROM prima.guard_pings WHERE id = 'gpg-a12-old'`)).rows[0].count), 0);
      assert.equal(Number((await admin(`SELECT count(*) FROM prima.guard_pings WHERE id = 'gpg-a12-new'`)).rows[0].count), 1);
    } finally {
      client.release();
    }
  });

  it('N16: deletes site gate records past 7 years and CMS clips past their keep date not on a case, only on --apply', async () => {
    const client = await pool.connect();
    try {
      const g = (await admin(`SELECT id, company_id, data FROM prima.gate_entries LIMIT 1`)).rows[0];
      assert.ok(g, 'the test data has a gate entry');
      const old = new Date(Date.parse(NOW) - 8 * 365 * 86_400_000).toISOString();
      await admin(`INSERT INTO prima.gate_entries (id, company_id, data) VALUES ('gate-n16-old', $1, $2)`, [g.company_id, { ...g.data, id: 'gate-n16-old', inAt: old, receivedAt: old }]);
      const dry = await purgeRetention(client, 'Daily job', false, Date.parse(NOW));
      assert.ok(dry.gate >= 1);
      assert.equal(Number((await admin(`SELECT count(*) FROM prima.gate_entries WHERE id = 'gate-n16-old'`)).rows[0].count), 1);
      await purgeRetention(client, 'Daily job', true, Date.parse(NOW));
      assert.equal(Number((await admin(`SELECT count(*) FROM prima.gate_entries WHERE id = 'gate-n16-old'`)).rows[0].count), 0);
      assert.equal(Number((await admin(`SELECT count(*) FROM prima.gate_entries WHERE id = $1`, [g.id])).rows[0].count), 1);
      assert.equal(Number((await admin(`SELECT count(*) FROM prima.audit WHERE data->>'action' = 'RETENTION_PURGE'`)).rows[0].count), 1);
      // Both runs are added to the officer's OK.
      const runs = (await admin(`SELECT data->'runs' AS runs FROM prima.pdpa_purge_oks LIMIT 1`)).rows[0].runs as unknown[];
      assert.equal(runs.length, 2);
      await assert.rejects(purgeRetention(client, '', true), /--by/);
    } finally {
      client.release();
    }
  });
});