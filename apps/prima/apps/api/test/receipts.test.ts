// Staff receipt wallet against a real local PostgreSQL (throwaway database; the test resets it). Receipts are read on
// the phone (Fauzan, 2 Nov 2026); the server keeps what the phone read as a suggestion. Dummy data only, never staging.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
const file = (name: string) => ({
  name,
  mime: 'image/jpeg',
  data: `data:image/jpeg;base64,${Buffer.from(`jpeg ${name}`).toString('base64')}`,
});
const jpg = (name: string) => ({
  kind: 'document' as const,
  name,
  data: `data:image/jpeg;base64,${Buffer.from(`jpeg ${name}`).toString('base64')}`,
  caption: '',
});

describe('Receipt wallet on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('keeps, confirms and claims a receipt through the restricted login; only the owner sees it; the head verifies', async () => {
    const [r] = await db.asUser('u-it-ex1', (svc, u) => svc.addReceipts(u, [jpg('Klinik 28-10-2026 RM85.00.jpg')]));
    // Nothing read on the phone: the staff member types the figures.
    let w = await db.asUser('u-it-ex1', (svc, u) => svc.myReceipts(u));
    assert.equal(w.reader, 'phone');
    assert.equal(w.receipts.find((x) => x.id === r.id)?.readState, 'off');
    // What the phone read is kept as a suggestion, marked 'phone', with out-of-range parts dropped.
    const [r2] = await db.asUser('u-it-ex1', (svc, u) =>
      svc.addReceipts(u, [jpg('Phone photo 2.jpg')], [{ date: '2026-10-29', amount: 42.5, merchant: 'Farmasi Mock', kind: 'MEDICAL', by: 'azure', confidence: 0.99 }]),
    );
    const [r3] = await db.asUser('u-it-ex1', (svc, u) => svc.addReceipts(u, [jpg('Phone photo 3.jpg')], [{ date: '2999-01-01', amount: -5 }]));
    w = await db.asUser('u-it-ex1', (svc, u) => svc.myReceipts(u));
    assert.deepEqual(
      { ...w.receipts.find((x) => x.id === r2.id)?.read, at: undefined },
      { date: '2026-10-29', amount: 42.5, merchant: 'Farmasi Mock', kind: 'MEDICAL', by: 'phone', confidence: 0.5, at: undefined },
    );
    assert.equal(w.receipts.find((x) => x.id === r3.id)?.readState, 'off');
    assert.equal(
      (await db.asUser('u-it-ex2', (svc, u) => svc.myReceipts(u))).receipts.some((x) => x.id === r.id),
      false,
    );
    await assert.rejects(db.asUser('u-it-ex2', (svc, u) => svc.receiptAction(u, r.id, 'remove', {})));
    await db.asUser('u-it-ex1', (svc, u) =>
      svc.receiptAction(u, r.id, 'confirm', {
        date: '2026-10-28',
        amount: 85,
        merchant: 'Klinik Sejahtera',
        kind: 'MEDICAL',
      }),
    );
    const c = await db.asUser('u-it-ex1', (svc, u) => svc.submitStaffClaim(u, { kind: 'MEDICAL', date: '2026-10-28', amount: 85, walletIds: [r.id] }, []));
    w = await db.asUser('u-it-ex1', (svc, u) => svc.myReceipts(u));
    assert.equal(w.receipts.find((x) => x.id === r.id)?.claimId, c.id);
    assert.ok(c.headIds?.length);
    await assert.rejects(db.asUser('u-it-ex1', (svc, u) => svc.headVerifyClaim(u, c.id, true, 'Mine')));
    const v = await db.asUser(c.headIds![0], (svc, u) => svc.headVerifyClaim(u, c.id, true, 'Was on MC that day (API mock)'));
    assert.equal(v.headCheck?.userId, c.headIds![0]);
  });
});
