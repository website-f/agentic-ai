// ACT fraud anomalies and investigations on the real PostgreSQL adapter (masterplan item 241, Fauzan 3 Nov 2026).
// Synthetic data only; run with DATABASE_URL pointing at a throwaway local database (the test resets it).
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const file = (t: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${t}`).toString('base64')}`;

describe('ACT fraud anomalies and investigations on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('reads the seeded duplicate claim through the walls, keeps evidence hashes and custody, and hides the file from others', async () => {
    const board = await db.asUser('u-audit', (svc, u) => svc.actBoard(u));
    const dup = board.anomalies.find((r) => r.key === 'duplicate_claim')!;
    assert.ok(dup.items.length >= 1, 'the seeded duplicate claim is found by the ACT Director through row-level security');
    const row = await db.asUser('u-act-aud1', (svc, u) => svc.openActInvestigation(u, { title: 'Duplicate claim', note: 'From the anomaly list', anomalyKey: dup.items[0].key }));
    const ev = await db.asUser('u-act-enf1', (svc, u) => svc.addActEvidence(u, row.id, { name: 'Receipt.pdf', data: file('receipt'), source: 'HR claim file' }));
    const seen = await db.asUser('u-audit', (svc, u) => svc.actEvidence(u, row.id, ev.id));
    assert.equal(seen.intact, true);
    // The other team and non-ACT staff are refused by the service; a company manager cannot even read the row.
    await assert.rejects(db.asUser('u-act-aud2', (svc, u) => svc.actEvidence(u, row.id, ev.id)), /Team 1/);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.actEvidence(u, row.id, ev.id)), /ACT only/);
    const raw = await db.asUser('u-cm-sasa', async (_svc, _u, store) => store.get('actAudits', row.id));
    assert.equal(raw, undefined);
    const custody = await db.asUser('u-audit', async (_svc, _u, store) => (await store.get('actAudits', row.id))!.investigation!.custody.map((c) => c.action));
    assert.deepEqual(custody, ['opened', 'evidence_added', 'evidence_viewed']);
  });

  // Arisha main round 3 (3 Nov 2026): each call below runs on its own connection and transaction, so only the
  // database row lock keeps them in order.
  it('keeps both files when two connections add evidence at once, and a racing add never reopens a closed file', async () => {
    const row = await db.asUser('u-audit', (svc, u) => svc.openActInvestigation(u, { title: 'PG race', team: 1, note: 'Synthetic race test' }));
    const adds = await Promise.allSettled(
      ['a', 'b', 'c', 'd'].map((t, i) =>
        db.asUser(i % 2 ? 'u-act-enf1' : 'u-audit', (svc, u) => svc.addActEvidence(u, row.id, { name: `${t}.pdf`, data: file(`race ${t}`), source: 'Synthetic file' })),
      ),
    );
    assert.deepEqual(adds.map((r) => r.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    const inv = await db.asUser('u-audit', async (_svc, _u, store) => (await store.get('actAudits', row.id))!.investigation!);
    assert.deepEqual(inv.evidence.map((e) => e.name).sort(), ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']);
    assert.equal(inv.custody.filter((c) => c.action === 'evidence_added').length, 4);
    assert.equal(new Set(inv.evidence.map((e) => e.id)).size, 4);

    const [close, late] = await Promise.allSettled([
      db.asUser('u-audit', (svc, u) => svc.actInvestigationStep(u, row.id, { action: 'close', outcome: 'not_substantiated', text: 'Synthetic records explained.' })),
      db.asUser('u-act-enf1', (svc, u) => svc.addActEvidence(u, row.id, { name: 'late.pdf', data: file('late'), source: 'Synthetic file' })),
    ]);
    assert.equal(close.status, 'fulfilled');
    const after = await db.asUser('u-audit', async (_svc, _u, store) => (await store.get('actAudits', row.id))!.investigation!);
    assert.equal(after.state, 'closed', 'the close stays closed whichever call won the lock');
    assert.equal(after.conclusion?.outcome, 'not_substantiated');
    // Either the add ran first (5 files, then closed) or it was refused after the close.
    if (late.status === 'fulfilled') assert.equal(after.evidence.length, 5);
    else assert.equal(after.evidence.length, 4);
  });

  it('refuses the same bytes under another type label, and numbers parallel opens once each', async () => {
    const row = await db.asUser('u-audit', (svc, u) => svc.openActInvestigation(u, { title: 'PG hash', team: 2, note: 'Synthetic hash test' }));
    const b64 = Buffer.from('%PDF-1.4 same bytes').toString('base64');
    const one = await db.asUser('u-audit', (svc, u) => svc.addActEvidence(u, row.id, { name: 'one.pdf', data: `data:application/pdf;base64,${b64}`, source: 'Synthetic file' }));
    await assert.rejects(
      db.asUser('u-audit', (svc, u) => svc.addActEvidence(u, row.id, { name: 'one.bin', data: `data:application/octet-stream;base64,${b64}`, source: 'Synthetic file' })),
      /already in/,
    );
    assert.equal(one.bytes, 19);
    const opened = await Promise.all([1, 2, 3].map((n) => db.asUser('u-audit', (svc, u) => svc.openActInvestigation(u, { title: `PG parallel ${n}`, team: 1, note: 'Synthetic race test' }))));
    assert.equal(new Set(opened.map((r) => r.investigation!.ref)).size, 3);
  });
});
