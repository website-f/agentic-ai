// Asset Management BQ, quotes and award (Fauzan, 5 Nov 2026, rule AM-BQ) on the real database: the work order row
// carries the BQ under the Asset Management department wall, outsiders are refused, and every step is audited. No
// schema change. Uses the same throwaway local database as rls.test.ts and resets it. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, briefFields, buildingWorksDraft } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

describe('Asset Management BQ on PostgreSQL', () => {
  let db: Db;
  let woId: string;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    const [w] = await admin<{ id: string }>(`SELECT id FROM prima.am_work_orders WHERE data->>'status' <> 'done' ORDER BY id LIMIT 1`);
    woId = w.id;
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('refuses people outside Asset Management and its overseers', async () => {
    await assert.rejects(db.asUser('u-it-ex1', (svc, u) => svc.amBq(u, woId)), (e) => e instanceof AccessDenied || /not found|Asset Management/i.test(String(e)));
    await assert.rejects(
      db.asUser('u-finance-am', (svc, u) => svc.amBqSave(u, woId, { jobKind: 'OTHER', measurements: {}, lines: [{ item: 'x', unit: 'lot', qty: 1, rate: null }], version: 0 })),
      AccessDenied,
    );
  });

  it('runs BQ, quote and award through the department wall and keeps the rest of the work order', async () => {
    const [before] = await admin<{ title: string }>(`SELECT data->>'title' AS title FROM prima.am_work_orders WHERE id = $1`, [woId]);
    const answers = Object.fromEntries(briefFields('OTHER').map((f) => [f.key, f.kind === 'choice' ? f.options![0] : f.kind === 'yesno' ? 'no' : f.kind === 'date' ? '2026-11-20' : 'Synthetic answer (test)']));
    await db.asUser('u-asset-mm', (svc, u) => svc.amBqBrief(u, woId, { jobKind: 'OTHER', answers, measurements: {}, version: 0 }));
    await db.asUser('u-asset-mm', (svc, u) =>
      svc.amBqSave(u, woId, { jobKind: 'OTHER', measurements: {}, lines: [{ item: 'Repair work (test)', unit: 'lot', qty: 1, rate: 1200, note: 'Supplier call, mock' }], version: 1 }),
    );
    await db.asUser('u-asset-mm', (svc, u) => svc.amBqSubmit(u, woId));
    await assert.rejects(db.asUser('u-asset-mm', (svc, u) => svc.amBqDecide(u, woId, true, 'mine')), /another person decides/);
    await db.asUser('u-asset-dir', (svc, u) => svc.amBqDecide(u, woId, true, 'Matches the site visit'));
    await db.asUser('u-asset-mm', (svc, u) =>
      svc.amQuoteAdd(u, woId, { contractor: 'Mock Contractor PG', ref: 'MQ-1', receivedOn: '2026-01-02', validUntil: null, lines: [{ lineId: 'L1', rate: 1100 }], statedTotal: 1100 }),
    );
    await db.asUser('u-asset-mm', (svc, u) => svc.amAwardAsk(u, woId, 'Q1', ''));
    const done = await db.asUser('u-asset-dir', (svc, u) => svc.amAwardDecide(u, woId, true, 'Lowest complete quote'));
    assert.equal(done.award?.final, true);

    const [row] = await admin<{ title: string; contractor: string; cost: string; status: string; version: string }>(
      `SELECT data->>'title' AS title, data->>'contractor' AS contractor, data->>'cost' AS cost, data#>>'{bq,status}' AS status, data#>>'{bq,version}' AS version FROM prima.am_work_orders WHERE id = $1`,
      [woId],
    );
    assert.deepEqual(row, { title: before.title, contractor: 'Mock Contractor PG', cost: '1100', status: 'approved', version: '7' });
    const audit = await admin<{ action: string }>(`SELECT data->>'action' AS action FROM prima.audit WHERE data->>'entityId' = $1 ORDER BY seq`, [woId]);
    assert.deepEqual(
      audit.map((a) => a.action),
      ['asset.bq.brief', 'asset.bq.save', 'asset.bq.submit', 'asset.bq.approve', 'asset.bq.quote', 'asset.bq.award.ask', 'asset.bq.award.approve'],
    );
  });

  it('changes the price after the award only through a VO approved and consented by the CEO and the Chairman', async () => {
    await db.asUser('u-asset-mm', (svc, u) =>
      svc.amVoAsk(u, woId, { reason: 'Extra work found on site (test)', contractorRef: 'MVO-1', lines: [{ lineId: null, item: 'Extra repair (test)', unit: 'lot', qty: 1, rate: 100, note: 'Contractor letter, mock' }] }),
    );
    await assert.rejects(db.asUser('u-asset-mm', (svc, u) => svc.amVoDecide(u, woId, 'VO1', true, 'mine')), /another person decides/);
    await assert.rejects(db.asUser('u-it-ex1', (svc, u) => svc.amVoDecide(u, woId, 'VO1', true, 'x')));
    await db.asUser('u-asset-dir', (svc, u) => svc.amVoDecide(u, woId, 'VO1', true, 'Seen on the site visit'));
    const [mid] = await admin<{ cost: string }>(`SELECT data->>'cost' AS cost FROM prima.am_work_orders WHERE id = $1`, [woId]);
    assert.equal(mid.cost, '1100');
    await assert.rejects(db.asUser('u-chair', (svc, u) => svc.amVoDecide(u, woId, 'VO1', true, 'before the CEO')), AccessDenied);
    await db.asUser('u-fauzan', (svc, u) => svc.amVoDecide(u, woId, 'VO1', true, 'Consent (test)'));
    await db.asUser('u-chair', (svc, u) => svc.amVoDecide(u, woId, 'VO1', true, 'Consent (test)'));
    const home = await db.asUser('u-fauzan', (svc, u) => svc.home(u));
    assert.equal(home.todo.filter((t) => t.tag === 'Variation order').length, 0);
    const [row] = await admin<{ cost: string; final: string }>(`SELECT data->>'cost' AS cost, data#>>'{bq,variations,0,final}' AS final FROM prima.am_work_orders WHERE id = $1`, [woId]);
    assert.deepEqual(row, { cost: '1200', final: 'true' });
    const audit = await admin<{ action: string }>(`SELECT data->>'action' AS action FROM prima.audit WHERE data->>'entityId' = $1 AND data->>'action' LIKE 'asset.bq.vo%' ORDER BY seq`, [woId]);
    assert.deepEqual(audit.map((a) => a.action), ['asset.bq.vo.ask', 'asset.bq.vo.approve', 'asset.bq.vo.consent.ceo', 'asset.bq.vo.consent.chairman']);
  });

  it('stores a building BQ (sections, workings, contingency, notes, drawings) and routes it with the contingency', async () => {
    const rows = await admin<{ id: string }>(`SELECT id FROM prima.am_work_orders WHERE data->>'status' <> 'done' AND id <> $1 ORDER BY id DESC LIMIT 1`, [woId]);
    const id = rows[0].id;
    const m = { existLength: 7.2, existWidth: 6, wallHeight: 3.5, raiseHeight: 1.2, extLength: 4, extWidth: 6, roofRemove: 76, roofPitch: 18, eave: 0.6, lightPoints: 9 };
    const answers = Object.fromEntries(
      briefFields('BUILDING_WORKS').map((f) => [f.key, f.kind === 'choice' ? f.options![0] : f.kind === 'yesno' ? 'no' : f.kind === 'date' ? '2026-11-20' : 'Synthetic answer (test)']),
    );
    await db.asUser('u-asset-mm', (svc, u) => svc.amBqBrief(u, id, { jobKind: 'BUILDING_WORKS', answers, measurements: m, version: 0 }));
    const d = buildingWorksDraft(m);
    const lines = d.lines.map((l, i) => ({ ...l, rate: i === 0 ? 4_000 : null, note: i === 0 ? 'Supplier call, mock' : '' }));
    await assert.rejects(
      db.asUser('u-finance-am', (svc, u) => svc.amBqSave(u, id, { jobKind: 'BUILDING_WORKS', measurements: m, lines, version: 1, sections: d.sections })),
      AccessDenied,
    );
    await db.asUser('u-asset-mm', (svc, u) =>
      svc.amBqSave(u, id, { jobKind: 'BUILDING_WORKS', measurements: m, lines, version: 1, title: d.title, sections: d.sections, contingencyPct: 25 }).catch((e) => {
        assert.match(String(e), /0% to 20%/);
        return null;
      }),
    );
    await db.asUser('u-asset-mm', (svc, u) =>
      svc.amBqSave(u, id, { jobKind: 'BUILDING_WORKS', measurements: m, lines, version: 1, title: d.title, sections: d.sections, contingencyPct: 5, notes: d.notes, drawings: [{ ref: 'L-01', title: 'Pelan lantai (test)' }] }),
    );
    const sub = await db.asUser('u-asset-mm', (svc, u) => svc.amBqSubmit(u, id));
    // RM4,000 + 5% = RM4,200, with unpriced lines: three quotes.
    assert.equal(sub.estimate, 4200);
    assert.equal(sub.route, 'RFQ');
    const [row] = await admin<{ sections: string; pct: string; drawing: string; calc: string }>(
      `SELECT jsonb_array_length(data#>'{bq,sections}')::text AS sections, data#>>'{bq,contingencyPct}' AS pct, data#>>'{bq,drawings,0,ref}' AS drawing,
              (SELECT l->>'calc' FROM jsonb_array_elements(data#>'{bq,lines}') l WHERE l->>'item' LIKE 'Rabung%') AS calc
         FROM prima.am_work_orders WHERE id = $1`,
      [id],
    );
    assert.deepEqual(row, { sections: String(d.sections.length), pct: '5', drawing: 'L-01', calc: '11.2 + 2 x 0.6' });
  });

  it('keeps only one of two decisions made at the same moment', async () => {
    const [w] = await admin<{ id: string }>(`SELECT id FROM prima.am_work_orders WHERE data->>'status' <> 'done' AND id <> $1 ORDER BY id LIMIT 1`, [woId]);
    const answers = Object.fromEntries(briefFields('OTHER').map((f) => [f.key, f.kind === 'choice' ? f.options![0] : f.kind === 'yesno' ? 'no' : f.kind === 'date' ? '2026-11-20' : 'Synthetic answer (test)']));
    await db.asUser('u-asset-mm', (svc, u) => svc.amBqBrief(u, w.id, { jobKind: 'OTHER', answers, measurements: {}, version: 0 }));
    await db.asUser('u-asset-mm', (svc, u) =>
      svc.amBqSave(u, w.id, { jobKind: 'OTHER', measurements: {}, lines: [{ item: 'Repair work (test)', unit: 'lot', qty: 1, rate: 900, note: 'Supplier call, mock' }], version: 1 }),
    );
    await db.asUser('u-asset-mm', (svc, u) => svc.amBqSubmit(u, w.id));
    const results = await Promise.allSettled([
      db.asUser('u-asset-dir', (svc, u) => svc.amBqDecide(u, w.id, true, 'Approve (test)')),
      db.asUser('u-asset-dir', (svc, u) => svc.amBqDecide(u, w.id, false, 'Return (test)')),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const [row] = await admin<{ status: string; version: string }>(`SELECT data#>>'{bq,status}' AS status, data#>>'{bq,version}' AS version FROM prima.am_work_orders WHERE id = $1`, [w.id]);
    assert.ok(row.status === 'approved' || row.status === 'returned');
    assert.equal(row.version, '4');
  });
});
