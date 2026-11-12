// J2 Equipment warranty claims (Fauzan, 11 Nov 2026) in the database itself: the separate module SQL (after the item
// register modules) installs one table with forced row-level security and no delete; claims run through the real store
// as the runtime role with the wrong role refused; another company does not read them. Throwaway local database, reset.
// Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, addDays, generateDataset, myt, type PhysicalItem } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');
const at = (t: string) => () => t;
const sql = (f: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${f}`), 'utf8');
const paper = (n: number) => ({ kind: 'document' as const, name: `Card ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 warranty-pg ${n}`).toString('base64')}` });

async function asApp(q: string, params: unknown[], s: { userId: string; group: boolean; companies?: string }) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true)`, [s.companies ?? '']);
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [s.userId]);
    await c.query(`SELECT set_config('app.group_user', $1, true)`, [s.group ? 'on' : 'off']);
    const r = await c.query(q, params);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

describe('J2 warranty claims (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says in words that it is not installed before the CEO-run migration', async () => {
    const b = await db.asUser('u-proc-exec', (svc, u) => svc.warranty.board(u), at(NOW));
    assert.equal(b.ready, false);
  });

  it('installs after the item register with forced row-level security and no delete, and runs a claim end to end', async () => {
    await db.pool.query(sql('item-register-v1.sql'));
    await db.pool.query(sql('item-register-v2.sql'));
    await db.pool.query(sql('item-warranty-v1.sql'));
    await db.pool.query(sql('item-warranty-v1.sql'));
    const t = await db.pool.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity, has_table_privilege('prima_app', c.oid, 'DELETE') AS del
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'item_warranty_claims'`,
    );
    assert.deepEqual(t.rows, [{ relrowsecurity: true, relforcerowsecurity: true, del: false }]);
    // The shared catalogue row the test item is registered against (synthetic seed).
    const sku = generateDataset({ today: TODAY, now: NOW }).itemSkus.find((s) => s.id === 'sku-shirt-l')!;
    await db.pool.query(`INSERT INTO prima.item_skus (id, party_ids, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [sku.id, sku.partyIds, sku]);
    const reg = (await db.asUser('u-proc-store1', (svc, u) => svc.items.act(u, 'req-wc-pg-1', { kind: 'item.register', skuId: sku.id, partyId: 'goodwill', count: 1 }), at(NOW))) as { result: PhysicalItem[] };
    const item = reg.result[0];
    const c = await db.asUser('u-proc-store1', (svc, u) => svc.warranty.act(u, 'raise', { itemId: item.id, supplier: 'Supplier Test Sdn Bhd', fault: 'Seam split on first wash (test)', warrantyTo: addDays(TODAY, 90), proof: [paper(1)] }), at(NOW));
    assert.equal(c.companyId, 'goodwill');
    await assert.rejects(db.asUser('u-proc-store1', (svc, u) => svc.warranty.act(u, 'decide', { id: c.id, approve: true, note: 'Mine' }), at(NOW)), (e) => e instanceof AccessDenied);
    await db.asUser('u-proc-exec', (svc, u) => svc.warranty.act(u, 'decide', { id: c.id, approve: true, note: 'In warranty' }), at(NOW));
    await db.asUser('u-proc-store1', (svc, u) => svc.warranty.act(u, 'sent', { id: c.id, on: TODAY, supplierRef: 'RMA-PG-1', proof: [paper(2)] }), at(NOW));
    await db.asUser('u-proc-store1', (svc, u) => svc.warranty.act(u, 'outcome', { id: c.id, result: 'repaired', on: TODAY, proof: [paper(3)] }), at(NOW));
    const closed = await db.asUser('u-proc-exec', (svc, u) => svc.warranty.act(u, 'close', { id: c.id, note: 'Repaired and back in stock' }), at(NOW));
    assert.equal(closed.status, 'closed');
    // A company that is not a party of the item reads nothing, and nobody deletes.
    const other = await asApp('SELECT count(*)::int AS n FROM prima.item_warranty_claims', [], { userId: 'u-cm-sasa', group: false, companies: 'co-sasa' });
    assert.equal(other.rows[0].n, 0);
    await assert.rejects(asApp('DELETE FROM prima.item_warranty_claims', [], { userId: 'u-proc-exec', group: true, companies: '' }), /permission denied/);
  });
});
