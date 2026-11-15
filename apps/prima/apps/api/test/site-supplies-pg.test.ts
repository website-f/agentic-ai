// Real PostgreSQL: Part T site supplies requests (Fitri package, 13 Nov 2026). Synthetic data only; DATABASE_URL is a
// throwaway local database that this test resets. Installs the proposed module db/modules/uniform-requests-v1.sql
// (the same prima.stock_requests table; Part T adds no table).
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { kpmSchoolStock, kpmWeek } from '@prima/core';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const ITEM = 'stk-goodwill-cln-test';
let SITE = '';

describe('site supplies requests on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
    const it = { id: ITEM, companyId: 'goodwill', sku: 'CLN-T', name: 'Synthetic floor cleaner', kind: 'CLEANING', size: null, onHand: 6, reorderAt: 0 };
    await owner.query(`INSERT INTO prima.stock_items (id, company_id, data) VALUES ($1, 'goodwill', $2)`, [ITEM, it]);
    // A government cleaning site the OM covers, with a synthetic KPM set-up (cleaning-ops-v1 module).
    const board0 = await db.asUser('u-om-klang', (svc, u) => svc.cleaning.board(u));
    SITE = board0.startable[0].siteId;
    await owner.query(`UPDATE prima.sites SET data = jsonb_set(data, '{sector}', '"government"') WHERE id = $1`, [SITE]);
    await owner.query(readFileSync(resolve(__dirname, '../../../../db/modules/cleaning-ops-v1.sql'), 'utf8'));
    const stock = kpmSchoolStock();
    await db.asUser('u-om-klang', (svc, u) =>
      svc.cleaning.saveSetup(
        u,
        SITE,
        {
          template: 'kpm_school',
          contractRef: 'SYNTHETIC',
          requiredHeadcount: 1,
          facts: { acres: 1, blocks: 1, floors: 1, toiletCubicles: 2 },
          week: kpmWeek('sat_sun'),
          secondSession: null,
          closedDays: [],
          cycleStart: '2026-11-02',
          monthlyWage: 1700,
          crew: [{ id: 'w1', name: 'Synthetic supervisor', role: 'supervisor', session: 1, personId: null }],
          areas: [],
          equipment: stock.equipment,
          supplies: stock.supplies.map((x) => ({ ...x, perDay: 1 })),
        } as never,
        null,
      ),
    );
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  it('says in words that the module is not installed yet', async () => {
    await assert.rejects(
      db.asUser('u-om-klang', (svc, u) => svc.siteSuppliesAct(u, 'request', { siteId: SITE, startedByName: 'Synthetic supervisor', lines: [{ stockItemId: ITEM, supplyId: 'floor-cleaner', qty: 2 }] })),
      /not installed/,
    );
  });

  it('runs a KBK request behind the company wall; two storekeepers issue once; the store stock goes down with the delivery', async () => {
    await owner.query(readFileSync(resolve(__dirname, '../../../../db/modules/uniform-requests-v1.sql'), 'utf8'));
    const r = (await db.asUser('u-om-klang', (svc, u) =>
      svc.siteSuppliesAct(u, 'request', { siteId: SITE, startedByName: 'Synthetic supervisor', lines: [{ stockItemId: ITEM, supplyId: 'floor-cleaner', qty: 5, area: 'Blok A' }] }),
    )) as { id: string; ref: string; status: string };
    assert.match(r.ref, /^KBK-\d{8}-001$/);
    assert.equal(r.status, 'kelulusan');
    // Nobody confirms their own request; the OGM confirms.
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.siteSuppliesAct(u, 'confirm', { id: r.id })), /OGM/);
    await db.asUser('u-ogm', (svc, u) => svc.siteSuppliesAct(u, 'confirm', { id: r.id }));
    await db.asUser('u-proc-store1', (svc, u) => svc.siteSuppliesAct(u, 'stockCheck', { id: r.id }));
    const dec = (await db.asUser('u-proc-exec', (svc, u) => svc.siteSuppliesAct(u, 'decide', { id: r.id, lines: [{ n: 1, decision: 'issue' }] }))) as { lines: { confirmedQty: number }[] };
    assert.equal(dec.lines[0].confirmedQty, 5);
    // Part U6: prepared, checked by a second store person (PIC), ready for delivery.
    await db.asUser('u-proc-store1', (svc, u) => svc.siteSuppliesAct(u, 'stage', { id: r.id, stage: 'prepared' }));
    await assert.rejects(db.asUser('u-proc-store1', (svc, u) => svc.siteSuppliesAct(u, 'stage', { id: r.id, stage: 'pic' })), /second store person/);
    await db.asUser('u-proc-store2', (svc, u) => svc.siteSuppliesAct(u, 'stage', { id: r.id, stage: 'pic' }));
    await db.asUser('u-proc-store1', (svc, u) => svc.siteSuppliesAct(u, 'stage', { id: r.id, stage: 'ready' }));
    const results = await Promise.allSettled([
      db.asUser('u-proc-store1', (svc, u) => svc.siteSuppliesAct(u, 'issue', { id: r.id })),
      db.asUser('u-proc-store2', (svc, u) => svc.siteSuppliesAct(u, 'issue', { id: r.id })),
    ]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1, JSON.stringify(results.map((x) => (x.status === 'rejected' ? String(x.reason?.message) : 'ok'))));
    const left = await owner.query(`SELECT (data->>'onHand')::int AS n FROM prima.stock_items WHERE id = $1`, [ITEM]);
    assert.equal(left.rows[0].n, 1);
    const del = await owner.query(`SELECT company_id, data FROM prima.cleaning_stock WHERE data->>'requestId' = $1`, [r.id]);
    assert.equal(del.rows.length, 1);
    assert.equal(del.rows[0].company_id, (await owner.query(`SELECT company_id FROM prima.sites WHERE id = $1`, [SITE])).rows[0].company_id);
    assert.equal(del.rows[0].data.supplies[0].stockItemId, ITEM);
    // The company wall: a company that does not see Goodwill's store reads no request rows.
    const outsider = await owner.query(`BEGIN; SET LOCAL ROLE prima_app; SELECT set_config('app.company_ids', 'co-inas', true); SELECT count(*)::int AS n FROM prima.stock_requests; `);
    await owner.query('ROLLBACK');
    const last = Array.isArray(outsider) ? outsider[outsider.length - 1] : outsider;
    assert.equal(last.rows[0].n, 0);
    const cm = (await db.asUser('u-cm-inas', (svc, u) => svc.siteSuppliesAct(u, 'board', {}))) as { rows: unknown[] };
    assert.equal(cm.rows.length, 0);
    // The store Min/Max is set by the Procurement executive on the row (ids stay unchanged).
    await db.asUser('u-proc-exec', (svc, u) => svc.siteSuppliesAct(u, 'storeMinMax', { stockItemId: ITEM, min: 2, max: 10, reason: 'Synthetic usage' }));
    const mm = await owner.query(`SELECT (data->>'reorderAt')::int AS min, (data->>'maxAt')::int AS max FROM prima.stock_items WHERE id = $1`, [ITEM]);
    assert.deepEqual(mm.rows[0], { min: 2, max: 10 });
  });
});
