// Model B (salaried Branch Manager, V12) through the restricted login and the company wall: the company manager approves
// purchases first, two decisions at once never both apply, and other companies stay out. Synthetic seed data on a
// throwaway local PostgreSQL; DATABASE_URL must point at it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('Model B branches on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const req = (quoteRef: string) => ({ supplier: 'Synthetic Radio Supplier', item: 'Radios x 4', kind: 'equipment', amount: 2_800, quoteRef });

  it('company manager consents, then the FD approves; other companies cannot reach it', async () => {
    await assert.rejects(
      db.asUser('u-bm-sasa-1', (svc, u) => svc.branchAct(u, 'br-sasa-1', 'purchase', { ...req('X'), on: nowMyt().slice(0, 10), invoiceRef: 'INV-PG-B0' })),
      /Only a JV branch/,
    );
    const p = await db.asUser('u-bm-sasa-1', (svc, u) => svc.requestBranchPurchase(u, 'br-sasa-1', req('QT-PG-B1')));
    await assert.rejects(db.asUser('u-bm-sasa-1', (svc, u) => svc.decideBranchPurchase(u, 'br-sasa-1', p.id, true, 'ok ok')));
    await assert.rejects(
      db.asUser('u-cm-inas', (svc, u) => svc.decideBranchPurchase(u, 'br-sasa-1', p.id, true, 'ok ok')),
      /not found|denied/i,
    );
    await assert.rejects(db.asUser('u-bm-inas-2', (svc, u) => svc.requestBranchPurchase(u, 'br-sasa-1', req('QT-PG-B2'))), /not found|denied/i);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.decideBranchPurchase(u, 'br-sasa-1', p.id, true, 'Needed')), /Finance Director or CEO approves/);
    await db.asUser('u-cm-sasa', (svc, u) => svc.consentBranchPurchase(u, 'br-sasa-1', p.id, true, 'Needed for the night post'));
    await db.asUser('u-fd', (svc, u) => svc.decideBranchPurchase(u, 'br-sasa-1', p.id, true, 'Within the branch budget'));
    const done = await db.asUser('u-bm-sasa-1', (svc, u) =>
      svc.recordBranchPurchaseBought(u, 'br-sasa-1', p.id, { on: nowMyt().slice(0, 10), amount: 2_750, invoiceRef: 'INV-PG-B1' }),
    );
    assert.equal(done.approval!.status, 'bought');
    const actions = await db.asUser('u-fauzan', async (_s, _u, store) =>
      (await store.list('audit', {})).filter((a) => a.entityId === 'br-sasa-1').map((a) => a.action),
    );
    for (const a of ['branch.purchase.request', 'branch.purchase.consent', 'branch.purchase.approve', 'branch.purchase.bought']) assert.ok(actions.includes(a), a);
  });

  it('the FD and the CEO decide one request at once: exactly one applies', async () => {
    const p = await db.asUser('u-bm-sasa-1', (svc, u) => svc.requestBranchPurchase(u, 'br-sasa-1', req('QT-PG-B3')));
    await db.asUser('u-cm-sasa', (svc, u) => svc.consentBranchPurchase(u, 'br-sasa-1', p.id, true, 'Consent for the night post'));
    // The FD and the CEO decide at the same moment.
    const r = await Promise.allSettled([
      db.asUser('u-fd', (svc, u) => svc.decideBranchPurchase(u, 'br-sasa-1', p.id, true, 'Approved, first')),
      db.asUser('u-fauzan', (svc, u) => svc.decideBranchPurchase(u, 'br-sasa-1', p.id, false, 'Refused, second')),
    ]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.match(String((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason), /already/);
    const b = await db.asUser('u-cm-sasa', (svc, u) => svc.branchJv(u, 'br-sasa-1'));
    const row = b.purchases.find((x) => x.id === p.id)!;
    assert.ok(['approved', 'refused'].includes(row.approval!.status));
    const decided = await db.asUser('u-fauzan', async (_s, _u, store) =>
      (await store.list('audit', {})).filter((a) => a.entityId === 'br-sasa-1' && /branch\.purchase\.(approve|refuse)/.test(a.action) && a.summary.includes('Radios x 4')),
    );
    assert.equal(decided.length, 2); // the first test's approval plus exactly one here
  });
});
