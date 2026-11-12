// E6 (P100, Fauzan 11 Nov 2026): moving vehicles between group companies in the database itself: the repeat-safe module
// SQL, forced row-level security, who reads and writes a move, the database refusing a self-approval even past the app,
// and the full ask -> approve -> handover through the real store. Uses a throwaway local database and resets it.
// Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, myt, vehicleUserOn, type Vehicle } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');
const at = (t: string) => () => t;
const SQL = readFileSync(resolve(__dirname, '../../../../db/modules/vehicle-transfers-v1.sql'), 'utf8');

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

describe('E6 vehicle moves between companies (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    await admin(SQL);
    await admin(SQL); // repeat-safe
    await admin(`INSERT INTO prima.users (id, data) VALUES ('u-transport-2', $1)`, [
      { id: 'u-transport-2', name: 'Synthetic Transport Two', title: 'Transport executive', role: 'pwvsb_officer', department: 'transport', companyIds: [], siteIds: [] },
    ]);
    // The second Transport member holds the same company monitor grants as the head (as every Transport member must).
    await admin(
      `INSERT INTO prima.grants (id, company_id, data)
       SELECT replace(id, 'gr-transport-', 'gr-transport2-'), company_id, jsonb_set(jsonb_set(data, '{id}', to_jsonb(replace(id, 'gr-transport-', 'gr-transport2-'))), '{userId}', '"u-transport-2"')
       FROM prima.grants WHERE data->>'userId' = 'u-transport'`,
    );
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('installs the table with forced row-level security and no delete for the runtime role', async () => {
    const r = await admin(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'vehicle_transfers'`,
    );
    assert.deepEqual(r.rows[0], { relrowsecurity: true, relforcerowsecurity: true, del: false });
  });

  it('asks, approves by someone else and hands over through the real store; others read nothing', async () => {
    const vid = (await admin(`SELECT id FROM prima.vehicles WHERE data->>'companyId' LIKE 'co-%' ORDER BY id LIMIT 1`)).rows[0].id as string;
    const v0 = (await admin(`SELECT data FROM prima.vehicles WHERE id = $1`, [vid])).rows[0].data as Vehicle;
    const to = v0.companyId === 'pgl' ? 'goodwill' : 'pgl';
    const t = await db.asUser('u-transport', (svc, u) => svc.requestVehicleTransfer(u, { vehicleId: vid, toCompanyId: to, wantedOn: TODAY, reason: 'Synthetic: needed elsewhere' }), at(NOW));
    // The asker is refused by the app; a company manager and a guard read no row at the database.
    await assert.rejects(db.asUser('u-transport', (svc, u) => svc.decideVehicleTransfer(u, t.id, true, 'Mine'), at(NOW)), (e) => e instanceof AccessDenied);
    for (const who of ['u-cm-sasa', 'u-pdpa']) {
      const n = await asApp(`SELECT count(*)::int AS n FROM prima.vehicle_transfers`, [], who);
      assert.equal(n.rows[0].n, 0, who);
      await assert.rejects(db.asUser(who, (svc, u) => svc.vehicleTransferBoard(u), at(NOW)), (e) => e instanceof AccessDenied);
    }
    // Even past the app, the database refuses an approval in the asker's own name.
    await assert.rejects(
      asApp(
        `UPDATE prima.vehicle_transfers SET data = data || jsonb_build_object('status', 'approved', 'decision', jsonb_build_object('approve', true, 'note', 'self', 'byId', 'u-transport')) WHERE id = $1`,
        [t.id],
        'u-transport',
      ),
      /vt_shape/,
    );
    // The COO cannot write a request (Transport asks).
    await assert.rejects(
      asApp(`INSERT INTO prima.vehicle_transfers (id, company_id, data) VALUES ('vt-x', NULL, '{"id":"vt-x","status":"requested","vehicleId":"v","requestedById":"u-coo","reason":"forged one","fromCompanyId":"a","toCompanyId":"b"}'::jsonb)`, [], 'u-coo'),
      /row-level security/,
    );
    await db.asUser('u-transport-2', (svc, u) => svc.decideVehicleTransfer(u, t.id, true, 'Checked with both companies'), at(NOW));
    const board = await db.asUser('u-coo', (svc, u) => svc.vehicleTransferBoard(u), at(NOW));
    assert.equal(board.moves.find((m) => m.id === t.id)?.status, 'approved');
    await db.asUser(
      'u-transport',
      (svc, u) => svc.handOverVehicleTransfer(u, t.id, { on: TODAY, odometerKm: 12345, handedBy: 'Synthetic A', receivedBy: 'Synthetic B', condition: 'Good', items: ['keys', 'registration'] }),
      at(NOW),
    );
    const v = (await admin(`SELECT data FROM prima.vehicles WHERE id = $1`, [vid])).rows[0].data as Vehicle;
    assert.equal(v.companyId, v0.companyId);
    assert.equal(vehicleUserOn(v, TODAY), to);
    const row = (await admin(`SELECT data FROM prima.vehicle_transfers WHERE id = $1`, [t.id])).rows[0].data;
    assert.equal(row.status, 'handed_over');
    const audit = (await admin(`SELECT data->>'action' AS a FROM prima.audit WHERE data->>'entityId' = $1 ORDER BY seq`, [vid])).rows.map((x) => x.a);
    assert.deepEqual(audit.filter((a: string) => a.startsWith('fleet.transfer') || a === 'fleet.move'), ['fleet.transfer.request', 'fleet.transfer.approve', 'fleet.move']);
  });
});
