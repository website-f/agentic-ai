// Part P1-P18 on PostgreSQL (Fitri package, 14 Nov 2026): hostel needs under the database walls. The OM of the area
// raises a need; an OM of another area and the FWM despatch officer see nothing; Asset Management sees the need only
// once it is approved, without residents or worker names, and cannot write a need it does not hold. Synthetic data only.
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
const NOW = myt('2026-11-14', '10:00');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('P1-P18 hostel needs (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/fw-moves-v1.sql'), 'utf8'));
    // Post every Klang hostel resident to one Selangor site, so only the Klang OM covers them (P2 rule).
    const covers = async (uid: string) => db.asUser(uid, (svc, u) => svc.omSiteIdsOf(u), () => NOW);
    assert.equal((await covers('u-om-klang')).has('st-sasa-001'), true);
    assert.equal((await covers('u-om-johor')).has('st-sasa-001'), false);
    await admin(`UPDATE prima.people SET data = data || '{"workSiteId":"st-sasa-001"}'::jsonb WHERE id IN (SELECT data->>'personId' FROM prima.hostel_stays WHERE data->>'hostelId' = 'hs-sasa-klang')`);
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('OM raises, FWM verifies, OD approves; walls hold for another OM, despatch and Asset Management', async () => {
    const n = await db.asUser('u-om-klang', (svc, u) => svc.fwMoves.raiseNeed(u, 'hs-sasa-klang', { items: [{ name: 'Single mattress', qty: 4 }], reason: 'MORE_WORKERS', justification: 'Four more workers (synthetic)', neededBy: '2026-12-10' }), () => NOW);
    assert.equal(n.seen.residents > 0, true);
    const needsOf = async (uid: string) => ((await db.asUser(uid, (svc, u) => svc.fwMoves.board(u), () => NOW).catch(() => ({ needs: [] }))) as { needs: { id: string }[] }).needs.filter((x) => x.id === n.id);
    // Another area's OM and the despatch officer never see it.
    assert.equal((await needsOf('u-om-johor')).length, 0);
    await assert.rejects(db.asUser('u-fwm-desp', (svc, u) => svc.fwMoves.board(u), () => NOW));
    // Asset Management: nothing before approval.
    assert.equal((await needsOf('u-asset-mm')).length, 0);
    assert.equal(((await db.asUser('u-asset-mm', (svc) => (svc as any).store.list('hostelNeeds', {}), () => NOW)) as unknown[]).length, 0);
    await db.asUser('u-fwm-ex1', (svc, u) => svc.fwMoves.decideNeed(u, n.id, 'fwm', 'Verified on the visit (synthetic)'), () => NOW);
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.fwMoves.decideNeed(u, n.id, 'approve', 'Self'), () => NOW));
    await db.asUser('u-opsdir', (svc, u) => svc.fwMoves.decideNeed(u, n.id, 'approve', 'Real need (synthetic)'), () => NOW);
    const am = await needsOf('u-asset-mm');
    assert.equal(am.length, 1);
    assert.equal('seen' in am[0], false);
    // Asset Management cannot push a need back to submitted under the wall.
    await assert.rejects(
      db.asUser('u-asset-mm', async (svc) => {
        const [row] = (await (svc as any).store.list('hostelNeeds', {})) as { id: string }[];
        await (svc as any).store.update('hostelNeeds', row.id, { status: 'submitted' });
      }, () => NOW),
      /row-level security|permission denied/,
    );
  });
});
