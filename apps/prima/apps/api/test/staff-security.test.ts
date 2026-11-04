// Security gates before real staff data, proved in the database itself (pre-publication review R1-R3, Fauzan
// 31 Oct 2026): department walls on group-wide tables, offboarding through prima.close_access only, and no PIN kept
// as typed. Uses the same throwaway local database as rls.test.ts and resets it. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessClosed, DEMO_PIN_KEY, activeGrants, type AuthorityGrant, type User } from '@prima/core';
import { userForEntra } from '../src/auth';
import { Db, apiPinKeeper } from '../src/db';
import { linkEntra } from '../src/entra-link';
import { hashPins } from '../src/hash-pins';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

/** One statement as the API's runtime role, with the given walls (and optionally a user) set for the transaction. */
async function asApp(walls: string, sql: string, params: unknown[] = [], userId = 'u-nobody') {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const count = async (walls: string, table: string, userId?: string) => Number((await asApp(walls, `SELECT count(*) AS n FROM prima.${table}`, [], userId)).rows[0].n);

describe('staff data security gates (database)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('keeps no PIN as typed in the database, only keyed hashes', async () => {
    const [r] = await admin<{ plain: string; hashed: string }>(
      `SELECT count(*) FILTER (WHERE data ? 'pin') AS plain, count(*) FILTER (WHERE data->>'pinHash' LIKE 'h1$%') AS hashed FROM prima.people`,
    );
    assert.equal(Number(r.plain), 0);
    assert.ok(Number(r.hashed) > 0);
  });

  it('refuses the test PIN key and a missing key in production, so PIN checks fail closed', () => {
    assert.equal(apiPinKeeper({ NODE_ENV: 'production' }).on, false);
    assert.equal(apiPinKeeper({ NODE_ENV: 'production', PIN_PEPPER: DEMO_PIN_KEY }).on, false);
    assert.equal(apiPinKeeper({ NODE_ENV: 'production', PIN_PEPPER: 'too-short' }).on, false);
    assert.equal(apiPinKeeper({ NODE_ENV: 'production', PIN_PEPPER: 'p'.repeat(40) }).on, true);
  });

  it('shows department tables only through their wall', async () => {
    for (const t of ['am_units', 'am_assets', 'am_depn_postings', 'pdpa_cases', 'pdpa_dpos', 'bcm_systems', 'act_audits', 'act_findings']) {
      assert.equal(await count('', t), 0, `${t} with no wall`);
      assert.equal(await count('offboard', t), 0, `${t} with only the HR wall`);
    }
    assert.ok((await count('asset_read', 'am_units')) > 0);
    assert.ok((await count('pdpa', 'pdpa_cases')) > 0);
    assert.ok((await count('bcm', 'bcm_systems')) > 0);
    assert.ok((await count('act', 'act_findings')) > 0);
    assert.equal(await count('asset_read,pdpa,bcm', 'act_findings'), 0, 'another wall does not open ACT');
  });

  it('lets ACT read Asset Management records but never change them', async () => {
    const [{ id }] = await admin<{ id: string }>('SELECT id FROM prima.am_units LIMIT 1');
    const upd = await asApp('asset_read,act', `UPDATE prima.am_units SET data = data || '{"note":"x"}' WHERE id = $1`, [id]);
    assert.equal(upd.rowCount, 0);
    await assert.rejects(
      asApp('asset_read,act', `INSERT INTO prima.am_units (id, data) VALUES ('am-test', '{"id":"am-test"}')`),
      /row-level security/,
    );
    const ok = await asApp('asset_read,asset_write', `UPDATE prima.am_units SET data = data || '{}' WHERE id = $1`, [id]);
    assert.equal(ok.rowCount, 1);
  });

  it("shows the owner of an ACT finding their own finding, and nobody else's", async () => {
    const [f] = await admin<{ id: string; owner: string }>(`SELECT id, data->>'ownerUserId' AS owner FROM prima.act_findings LIMIT 1`);
    const mine = await asApp('', `SELECT id FROM prima.act_findings`, [], f.owner);
    assert.ok(mine.rows.some((r) => r.id === f.id));
    assert.ok(mine.rows.every((r) => r.id !== undefined));
    const total = await count('act', 'act_findings');
    assert.ok(mine.rowCount! < total, 'an owner sees only their own');
  });

  it('sends each request the walls the person passes, so a department head reads only their department', async () => {
    const seen = (uid: string, table: string) => db.asUser(uid, async (svc) => (await (svc as unknown as { store: { list(t: string, f: object): Promise<unknown[]> } }).store.list(table, {})).length);
    assert.ok((await seen('u-asset-mm', 'amUnits')) > 0);
    assert.equal(await seen('u-asset-mm', 'pdpaCases'), 0);
    assert.equal(await seen('u-it-ex1', 'amUnits'), 0);
    assert.ok((await seen('u-it-ex1', 'bcmSystems')) > 0);
    assert.equal(await seen('u-pwvsb-hr', 'actAudits'), 0);
    assert.ok((await seen('u-fauzan', 'pdpaCases')) > 0);
  });

  it('never lets the API change accounts or grants directly', async () => {
    await assert.rejects(asApp('offboard', `UPDATE prima.users SET data = data || '{"accessClosedFrom":"2026-01-01"}' WHERE id = 'u-it-ex3'`), /permission denied/);
    await assert.rejects(asApp('offboard', `UPDATE prima.grants SET data = data WHERE id = 'x'`), /permission denied/);
  });

  it('closes access only for HR, the HR Director or the CEO, never your own, the CEO or a system feed', async () => {
    const closed = JSON.stringify({ by: 'Test', at: '2026-10-31T10:00:00+08:00', reason: 'Test' });
    const call = (walls: string, target: string, userId = 'u-pwvsb-hr') =>
      asApp(walls, `SELECT prima.close_access($1, $2::date, $3::jsonb) AS n`, [target, '2030-01-01', closed], userId);
    await assert.rejects(call('', 'u-it-ex3'), /Only HR/);
    await assert.rejects(call('asset_read,asset_write,act,pdpa,bcm', 'u-it-ex3'), /Only HR/);
    await assert.rejects(call('offboard', 'u-pwvsb-hr'), /own access/);
    await assert.rejects(call('offboard', 'u-fauzan'), /cannot be closed/);
    await assert.rejects(call('offboard', 'u-ja-sync'), /cannot be closed/);
    const [{ data }] = await admin<{ data: User }>(`SELECT data FROM prima.users WHERE id = 'u-it-ex3'`);
    assert.equal(data.accessClosedFrom, undefined, 'nothing changed by the refused calls');
  });

  it("refuses a leaver's every request and Microsoft sign-in once HR closes the access, and ends their grants", async () => {
    const oid = '0c0c0c0c-0000-4000-8000-0000000000a1';
    const c = await db.pool.connect();
    try {
      await linkEntra(c, 'u-om-klang', oid, 'Test');
    } finally {
      c.release();
    }
    const before = await db.asUser('u-om-klang', async (_svc, u) => u);
    assert.equal(before.id, 'u-om-klang');
    const r = await db.asUser('u-pwvsb-hr', (svc, hr) => svc.closeAccess(hr, 'u-om-klang', { reason: 'Resigned (test)' }));
    assert.ok(r.grantsEnded > 0);
    await assert.rejects(db.asUser('u-om-klang', async (_svc, u) => u), AccessClosed);
    await assert.rejects(userForEntra(db, { oid, tid: 'x' } as never), /closed from/);
    const today = r.from;
    const grants = (await admin<{ data: AuthorityGrant }>(`SELECT data FROM prima.grants WHERE data->>'userId' = 'u-om-klang'`)).map((g) => g.data);
    assert.deepEqual(activeGrants(before, grants, today), []);
    const [audit] = await admin<{ n: string }>(`SELECT count(*) AS n FROM prima.audit WHERE data->>'action' = 'user.access.close' AND data->>'entityId' = 'u-om-klang'`);
    assert.equal(Number(audit.n), 1);
    // Someone outside HR is refused by the service before the database is asked.
    await assert.rejects(db.asUser('u-it-mgr', (svc, u) => svc.closeAccess(u, 'u-it-ex4', { reason: 'Resigned' })), /closes access/);
  });

  it('sets a PIN through HR, keeps only its hash and never logs the PIN', async () => {
    const [p] = await admin<{ id: string }>(`SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' LIMIT 1`);
    await db.asUser('u-pwvsb-hr', (svc, hr) => svc.setStaffPin(hr, p.id, '5823'));
    const [row] = await admin<{ data: { pinHash: string } }>('SELECT data FROM prima.people WHERE id = $1', [p.id]);
    assert.match(row.data.pinHash, /^h1\$/);
    assert.ok(apiPinKeeper({}).matches(row.data.pinHash, '5823'));
    const logged = await admin<{ s: string }>(`SELECT data->>'summary' AS s FROM prima.audit WHERE data->>'action' = 'person.pin' AND data->>'entityId' = $1`, [p.id]);
    assert.equal(logged.length, 1);
    assert.doesNotMatch(logged[0].s, /5823/);
  });

  it('turns PINs kept as typed into hashes only when told to, with the real key, and never prints them', async () => {
    await admin(`UPDATE prima.people SET data = (data - 'pinHash') || '{"pin":"7391"}' WHERE id = (SELECT id FROM prima.people WHERE company_id = 'co-sasa' ORDER BY id LIMIT 1)`);
    await admin(`UPDATE prima.people SET data = (data - 'pinHash') || '{"pin":""}' WHERE id = (SELECT id FROM prima.people WHERE company_id = 'co-arsh' ORDER BY id LIMIT 1)`);
    // Review of PR #34: a person with an old typed PIN (A) whom HR then gives a new PIN (B). Only B may work afterwards,
    // and the conversion must keep B's hash, never bring back A.
    const [{ id: ab }] = await admin<{ id: string }>(`SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' ORDER BY id OFFSET 1 LIMIT 1`);
    await admin(`UPDATE prima.people SET data = (data - 'pinHash') || '{"pin":"6152"}' WHERE id = $1`, [ab]);
    await db.asUser('u-pwvsb-hr', (svc, hr) => svc.setStaffPin(hr, ab, '8274'));
    const [afterSet] = await admin<{ data: { pin?: string | null; pinHash: string } }>('SELECT data FROM prima.people WHERE id = $1', [ab]);
    assert.equal(afterSet.data.pin ?? null, null, 'setting a new PIN blanks the typed one at once');
    const key = { PIN_PEPPER: 'q'.repeat(40) };
    const c = await db.pool.connect();
    try {
      await assert.rejects(hashPins(c, 'Test', true, { PIN_PEPPER: DEMO_PIN_KEY }), /Nothing was changed/);
      await assert.rejects(hashPins(c, '', true, key), /--by/);
      assert.deepEqual(await hashPins(c, 'Test', false, key), { hashed: 1, kept: 1, cleared: 1, applied: false });
      assert.equal((await admin(`SELECT 1 FROM prima.people WHERE data ? 'pin'`)).length, 3, 'a dry run changes nothing');
      assert.deepEqual(await hashPins(c, 'Test', true, key), { hashed: 1, kept: 1, cleared: 1, applied: true });
    } finally {
      c.release();
    }
    assert.equal((await admin(`SELECT 1 FROM prima.people WHERE data ? 'pin'`)).length, 0);
    const [row] = await admin<{ data: { pinHash: string } }>(`SELECT data FROM prima.people WHERE company_id = 'co-sasa' ORDER BY id LIMIT 1`);
    assert.ok(apiPinKeeper({ NODE_ENV: 'production', ...key }).matches(row.data.pinHash, '7391'));
    const [abRow] = await admin<{ data: { pinHash: string } }>('SELECT data FROM prima.people WHERE id = $1', [ab]);
    assert.equal(abRow.data.pinHash, afterSet.data.pinHash, 'the conversion keeps the hash HR set');
    assert.ok(db.pins.matches(abRow.data.pinHash, '8274'));
    assert.equal(db.pins.matches(abRow.data.pinHash, '6152'), false);
    const [entry] = await admin<{ s: string }>(`SELECT data->>'summary' AS s FROM prima.audit WHERE data->>'action' = 'PIN_HASH'`);
    assert.match(entry.s, /1 hashed, 1 already reset by HR .*, 1 empty/);
    assert.doesNotMatch(entry.s, /7391/);
  });
});
