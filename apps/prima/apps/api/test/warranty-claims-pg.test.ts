// A8 equipment warranty claims in PostgreSQL (Fitri package, Fauzan 11 Nov 2026): the module is separate, the table
// has row-level security and no DELETE, and an IT claim runs through the IT register under the IT walls. Synthetic data.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const doc = [{ kind: 'document' as const, name: 'fault.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic fault photo').toString('base64')}` }];

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('equipment warranty claims (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('is off until the module is installed, then runs report, check, send and close on an IT asset', async () => {
    const off = await db.asUser('u-it-ex1', (svc, u) => svc.warrantyBoard(u), () => NOW);
    assert.equal(off.installed, false);
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/warranty-claims-v1.sql'), 'utf8'));
    const r = await admin(`SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'warranty_claims'`);
    assert.deepEqual([r.rows[0].relrowsecurity, r.rows[0].relforcerowsecurity, r.rows[0].del], [true, true, false]);
    const board = await db.asUser('u-it-ex1', (svc, u) => svc.warrantyBoard(u), () => NOW);
    assert.equal(board.installed, true);
    const asset = (await admin(`SELECT id FROM prima.it_assets WHERE data->>'status' = 'in_use' AND data->>'warrantyTo' >= $1 LIMIT 1`, [TODAY])).rows[0].id as string;
    const c = await db.asUser('u-it-ex1', (svc, u) => svc.reportWarrantyFault(u, { source: 'it_asset', itemId: asset, fault: 'Battery swells', faultOn: TODAY, proof: doc }), () => NOW);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.checkWarrantyClaim(u, c.id, { supplier: 'Sample Supplier' }), () => NOW), /not found|not allowed/i);
    await db.asUser('u-it-lead', (svc, u) => svc.checkWarrantyClaim(u, c.id, { supplier: 'Sample Supplier' }), () => NOW);
    await db.asUser('u-it-lead', (svc, u) => svc.sendWarrantyClaim(u, c.id, { on: TODAY, supplierRef: 'RMA-PG-1' }), () => NOW);
    await db.asUser('u-it-lead', (svc, u) => svc.closeWarrantyClaim(u, c.id, { result: 'repaired', note: 'Battery replaced by the supplier' }), () => NOW);
    const row = (await admin(`SELECT data FROM prima.warranty_claims WHERE id = $1`, [c.id])).rows[0].data;
    assert.equal(row.status, 'closed');
    const a = (await admin(`SELECT data FROM prima.it_assets WHERE id = $1`, [asset])).rows[0].data;
    assert.equal(a.status, 'in_use');
    assert.match(a.maintenance.at(-1).note, /repaired/);
    const audit = await admin(`SELECT data->>'action' AS a FROM prima.audit WHERE data->>'entityId' = $1`, [c.id]);
    assert.deepEqual(audit.rows.map((x) => x.a).sort(), ['warranty.check', 'warranty.close', 'warranty.report', 'warranty.send']);
  });
});
