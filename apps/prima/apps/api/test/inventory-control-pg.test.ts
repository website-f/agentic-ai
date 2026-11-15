// Real PostgreSQL: Part U inventory control (Fitri package, 14 Nov 2026). Synthetic data only; DATABASE_URL is a
// throwaway local database that this test resets. Installs the proposed module db/modules/inventory-control-v1.sql
// (NOT on the release list; the CEO runs it) and uniform-requests-v1.sql (stock_requests, for reserved stock).
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { demoPin } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const ITEM = 'stk-goodwill-radio-test';
const mod = (f: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${f}`), 'utf8');

describe('inventory control on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  let witness = { staffNo: '', pin: '' };
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
    const it = { id: ITEM, companyId: 'goodwill', sku: 'DEV-T', name: 'Synthetic radio', kind: 'DEVICE', size: null, onHand: 6, reorderAt: 0, salePrice: 300 };
    await owner.query(`INSERT INTO prima.stock_items (id, company_id, data) VALUES ($1, 'goodwill', $2)`, [ITEM, it]);
    // A Goodwill witness with a PIN (synthetic): the store's own company.
    const p = (await owner.query(`SELECT data FROM prima.people WHERE company_id = 'goodwill' AND data->>'status' = 'active' AND data ? 'pinHash' LIMIT 1`)).rows[0]?.data;
    if (p) witness = { staffNo: p.staffNo, pin: demoPin(p.staffNo) };
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('says in words that the module is not installed yet', async () => {
    await assert.rejects(db.asUser('u-proc-store1', (svc, u) => svc.inventoryAct(u, 'countStart', { kind: 'major' })), /not installed/);
  });

  it('a major count freezes the store behind the company wall; one urgent pass; history is append-only; nothing is deleted', async () => {
    await owner.query(mod('uniform-requests-v1.sql'));
    await owner.query(mod('inventory-control-v1.sql'));
    const c = (await db.asUser('u-proc-store1', (svc, u) => svc.inventoryAct(u, 'countStart', { kind: 'major' }))) as { id: string; d: unknown };
    const guard = (await owner.query(`SELECT id, company_id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' LIMIT 1`)).rows[0];
    const po = (await owner.query(`SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'role' = 'patrol_officer' AND data->>'status' = 'active' LIMIT 1`)).rows[0];
    const issue = () => db.asUser('u-proc-store1', (svc, u) => svc.stockIssue(u, 'goodwill', { itemId: ITEM, personId: guard.id, qty: 1, omUserId: 'u-om-klang', patrolPersonId: po.id }));
    await assert.rejects(issue(), /Kiraan stok sedang berjalan/);
    await db.asUser('u-ogm', (svc, u) => svc.inventoryAct(u, 'urgent', { itemId: ITEM, qty: 1, reason: 'Synthetic urgent replacement' }));
    await issue();
    await assert.rejects(issue(), /Kiraan stok sedang berjalan/);
    // The trigger: a rewrite of history and a delete are refused at the database.
    await assert.rejects(owner.query(`UPDATE prima.inventory_recs SET data = jsonb_set(data, '{history}', '[]'::jsonb) WHERE id = $1`, [c.id]), /append-only/);
    await assert.rejects(owner.query(`DELETE FROM prima.inventory_recs WHERE id = $1`, [c.id]), /never deleted/);
    // The wall: a company that does not see Goodwill reads no inventory rows.
    await owner.query('BEGIN');
    await owner.query(`SET LOCAL ROLE prima_app`);
    await owner.query(`SELECT set_config('app.company_ids', 'co-inas', true)`);
    const n = (await owner.query(`SELECT count(*)::int AS n FROM prima.inventory_recs`)).rows[0].n;
    await owner.query('ROLLBACK');
    assert.equal(n, 0);
    if (witness.staffNo) {
      const done = (await db.asUser('u-proc-store1', (svc, u) =>
        svc.inventoryAct(u, 'countLine', { id: c.id, lines: (c as unknown as { d: { lines: { itemId: string; system: number }[] } }).d.lines.map((l) => ({ itemId: l.itemId, physical: l.itemId === ITEM ? 5 : l.system })) }).then(() => svc.inventoryAct(u, 'countFinish', { id: c.id, witness })),
      )) as { status: string };
      assert.equal(done.status, 'closed');
      await issue();
    }
  });

  it('negligence on a RM300 radio becomes a due charge on the person’s employer with an HR review', async () => {
    const guard = (await owner.query(`SELECT id FROM prima.people WHERE company_id = 'co-sasa' AND data->>'role' = 'guard' AND data->>'status' = 'active' LIMIT 1`)).rows[0];
    const iss = (await owner.query(`SELECT id FROM prima.stock_issues WHERE data->>'itemId' = $1 AND data->>'personId' = $2 LIMIT 1`, [ITEM, guard.id])).rows[0];
    await db.asUser('u-proc-store1', (svc, u) => svc.stockReturn(u, iss.id, 'damaged', 'Synthetic: dropped'));
    const photo = [{ kind: 'document' as const, name: 'synthetic.png', data: `data:image/png;base64,${Buffer.from('synthetic photo '.repeat(30)).toString('base64')}` }];
    const mgr = await db.asUser('u-proc-exec', async (svc, u) => ({ ...u, procRole: 'manager' as const }));
    await owner.query(`UPDATE prima.users SET data = jsonb_set(data, '{procRole}', '"manager"') WHERE id = 'u-proc-exec'`);
    void mgr;
    await db.asUser('u-proc-exec', (svc, u) => svc.confirmStockLoss(u, iss.id, true, 'Left on the motorcycle seat', { cause: 'NEGLIGENCE', photo }));
    const rows = (await owner.query(`SELECT company_id, data FROM prima.inventory_recs WHERE data->>'kind' = 'charge'`)).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].company_id, 'co-sasa');
    assert.equal(rows[0].data.status, 'due');
    assert.equal(Number(rows[0].data.d.amount), 300);
    const hr = await db.asUser('u-pwvsb-hr', (svc, u) => svc.inventoryAct(u, 'chargeHr', { id: rows[0].data.id, decision: 'cancel', note: 'Synthetic: no written agreement' }));
    assert.equal((hr as { status: string }).status, 'cancelled');
  });
});
