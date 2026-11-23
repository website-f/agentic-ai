// Part S on PostgreSQL (office assets, 14 Nov 2026): the office_am_recs walls. The Asset Management walls read and write
// everything; a company's own office staff read their company's repairs and inventory; another company's manager reads
// nothing; HR reads inventory only; a non-asset user writes only their own new request; the requester confirms; history
// is append-only and nothing is deleted. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type OfficeAmRec } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-18', '10:00');
const PDF = (n: string, k = 1) => Array.from({ length: k }, (_, x) => ({ kind: 'document', name: `${n}-${x}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${n} ${x}`).toString('base64')}` }));

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}
const mod = (f: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${f}`), 'utf8');

describe('Part S office asset records (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    await admin(mod('office-am-v1.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('asset walls, company staff and HR views, own requests only, append-only history and no delete', async () => {
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn, () => NOW);
    const act = (uid: string, op: string, i: Record<string, unknown>) => as(uid, (svc, u) => svc.officeAmAct(u, op, i));
    const list = async (uid: string) => (await as(uid, (svc) => svc.store.list('officeAmRecs', {}))) as OfficeAmRec[];
    const exec = (await admin(`SELECT id FROM prima.users WHERE data->>'role'='admin_exec' AND data->'companyIds' ? 'co-sasa' ORDER BY id LIMIT 1`)).rows[0].id as string;
    const unit = (await admin(`SELECT id FROM prima.am_units ORDER BY id LIMIT 1`)).rows[0].id as string;

    const r = (await act(exec, 'repairRequest', { companyId: 'co-sasa', address: 'Level 2, test office', damageType: 'door', example: 'Kunci pintu', description: 'Lock jammed (test)', photos: PDF('door') })) as OfficeAmRec;
    assert.equal(r.status, 'submitted');
    await act('u-asset-mm', 'repairCheck', { id: r.id, outcome: 'accept', reason: 'complete', unitId: unit });
    assert.equal((await admin(`SELECT count(*)::int AS n FROM prima.am_work_orders WHERE data->>'officeRepairId'=$1`, [r.id])).rows[0].n, 1);
    const up = (await act(exec, 'invSubmit', { companyId: 'co-sasa', lines: [{ name: 'Chair (test)', location: 'Room 1', price: 300 }], docs: PDF('chair') })) as OfficeAmRec;
    await act('u-asset-mm', 'invCheck', { id: up.id, reason: 'matches' });
    await act('u-asset-dir', 'invConfirm', { id: up.id, reason: 'confirmed' });
    await act('u-asset-mm', 'invFile', { id: up.id });

    // The unit, the Asset Director and the requester read; another company's manager and an IT officer read nothing.
    assert.ok((await list('u-asset-mm')).some((x) => x.id === r.id));
    assert.ok((await list(exec)).some((x) => x.id === r.id));
    for (const uid of ['u-cm-arsh', 'u-it-mgr']) assert.equal((await list(uid)).filter((x) => x.companyId === 'co-sasa').length, 0, uid);
    // HR reads the inventory, never the repair; the board strips the price.
    const hr = await list('u-pwvsb-hr');
    assert.ok(hr.some((x) => x.kind === 'invItem') && hr.every((x) => ['invItem', 'invUpdate', 'disposal'].includes(x.kind)));
    const hb = (await act('u-pwvsb-hr', 'board', {})) as { records: OfficeAmRec[] };
    assert.equal(hb.records.find((x) => x.kind === 'invItem')!.d.price, undefined);

    // A non-asset user writes only their own new request for a company in their wall.
    const fake = { id: 'oam-fake', kind: 'repair', ref: 'X-1', status: 'submitted', at: NOW, byId: exec, by: 'x', version: 1, companyId: 'co-arsh', requesterId: exec, d: {}, history: [] };
    await assert.rejects(as(exec, (svc) => svc.store.insert('officeAmRecs', fake)), /row-level security|permission denied/);
    await assert.rejects(as(exec, (svc) => svc.store.insert('officeAmRecs', { ...fake, id: 'oam-fake2', companyId: 'co-sasa', requesterId: 'u-cm-sasa' })), /row-level security|permission denied/);
    await assert.rejects(as(exec, (svc) => svc.store.insert('officeAmRecs', { ...fake, id: 'oam-fake3', kind: 'invItem', companyId: 'co-sasa' })), /row-level security|permission denied/);
    await assert.rejects(as('u-cm-arsh', (svc) => svc.store.insert('officeAmRecs', { ...fake, id: 'oam-fake4', byId: 'u-cm-arsh', requesterId: 'u-cm-arsh', kind: 'buildingBuy', status: 'instructed' })), /row-level security|permission denied/);

    // History only grows, identity never changes, nothing is deleted (even by the owner role).
    await assert.rejects(admin(`UPDATE prima.office_am_recs SET data = jsonb_set(data,'{history}','[]'::jsonb) WHERE id=$1`, [r.id]), /append-only/);
    await assert.rejects(admin(`UPDATE prima.office_am_recs SET data = jsonb_set(data,'{companyId}','"co-arsh"'::jsonb) WHERE id=$1`, [r.id]), /immutable/);
    await assert.rejects(admin(`DELETE FROM prima.office_am_recs WHERE id=$1`, [r.id]), /never deleted/);
    // Buy new (module office-am-buy-v1): the named operations head reads and approves; another operations head does not.
    await admin(mod('office-am-buy-v1.sql'));
    const b = (await act('u-cm-sasa', 'buyRequest', { companyId: 'co-sasa', address: 'Level 2, test office', buyType: 'furniture', item: 'Desk (test)', qty: 1, estimate: 500, description: 'New staff joining (test)' })) as OfficeAmRec;
    assert.equal(b.d.hod, 'ops_director');
    await act('u-asset-mm', 'repairCheck', { id: b.id, outcome: 'accept', reason: 'no spare desk', unitId: unit });
    await act('u-asset-mm', 'repairQuotes', { id: b.id, quotes: [{ contractor: 'Shop A (test)', price: 500 }, { contractor: 'Shop B (test)', price: 520 }, { contractor: 'Shop C (test)', price: 540 }], online: [{ where: 'Online one (test)', price: 495 }, { where: 'Online two (test)', price: 510 }], docs: PDF('bq', 3) });
    await act('u-asset-mm', 'repairPick', { id: b.id, contractor: 'Shop A (test)', reason: 'lowest quote' });
    assert.equal((await list('u-ogm')).some((x) => x.id === b.id), false);
    await act('u-asset-dir', 'repairApprove', { id: b.id, reason: 'recommended' });
    assert.ok((await list('u-opsdir')).some((x) => x.id === b.id));
    await assert.rejects(act('u-ogm', 'repairApprove', { id: b.id, reason: 'approve it' }));
    const done = (await act('u-opsdir', 'repairApprove', { id: b.id, reason: 'approved for new staff' })) as OfficeAmRec;
    assert.equal(done.status, 'approved');
    assert.equal((await list('u-opsdir')).filter((x) => x.kind !== 'repair' || x.d.purpose !== 'buy').length, 0);

    const grants = (await admin(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='prima' AND table_name='office_am_recs' AND grantee='prima_app'`)).rows.map((x) => x.privilege_type).sort();
    assert.deepEqual(grants, ['INSERT', 'SELECT', 'UPDATE']);
  });
});
