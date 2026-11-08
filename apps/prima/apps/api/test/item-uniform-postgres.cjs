// Uniform allowance on actual PostgreSQL (Fauzan, 6 Nov 2026). Explicit opt-in disposable localhost database only;
// synthetic data, no production or provider access. Runs every write through the API's own per-user transaction
// (Db.asUser: prima_app role, company wall), the same path a live request takes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { Client } = require('pg');
const url = process.env.ITEM_UNIFORM_DATABASE_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname) || new URL(url).pathname !== '/prima_uniform_items') throw Error('Explicit disposable localhost prima_uniform_items URL required');
process.env.DATABASE_URL = url;
const { resetDb } = require('../dist/src/reset-db');
const { Db } = require('../dist/src/db');
const root = path.resolve(__dirname, '../../..');
const CM = 'u-cm-sasa', OTHER = 'u-cm-arsh', GUARD_USER = 'u-guard-sasa-1';
let n = 0;
(async () => {
  const ds = await resetDb(url);
  const admin = new Client({ connectionString: url });
  await admin.connect();
  const db = new Db();
  try {
    await admin.query(fs.readFileSync(path.join(root, 'db/modules/item-register-v1.sql'), 'utf8'));
    for (const s of ds.itemSkus) await admin.query('INSERT INTO prima.item_skus(id,party_ids,data) VALUES($1,$2,$3)', [s.id, s.partyIds, s]);
    const act = (userId, a) => db.asUser(userId, async (svc, user) => (await svc.items.act(user, `pg-uni-${++n}`, a)).result);
    const board = (userId) => db.asUser(userId, async (svc, user) => svc.items.board(user));

    // Sasa's store registers six shirts and checks them in.
    const shirts = await act(CM, { kind: 'item.register', skuId: 'sku-shirt-l', partyId: 'co-sasa', count: 6 });
    for (const s of shirts) await act(CM, { kind: 'item.inspect', label: s.token, condition: 'new', note: '' });

    // A guard with no handovers; the manager records 2 past pieces for them.
    const rows = (await board(CM)).uniforms.rows;
    const g = rows.find((r) => r.pieces === 0 && r.personId !== ds.users.find((u) => u.id === GUARD_USER)?.personId);
    const today = (await board(CM)).today;
    const past = await act(CM, { kind: 'uniform.past', companyId: 'co-sasa', scope: { kind: 'person', id: g.staffNo }, on: today, pieces: 2, reason: 'Store issue book (synthetic)' });
    assert.equal(past.recorded, 1);

    // Two handovers to the same guard at the same moment: only one may take the 3rd free piece.
    const both = await Promise.allSettled([
      act(CM, { kind: 'issue', label: shirts[0].token, personId: g.personId, reason: 'Parallel test A (synthetic)' }),
      act(CM, { kind: 'issue', label: shirts[1].token, personId: g.personId, reason: 'Parallel test B (synthetic)' }),
    ]);
    const ok = both.filter((x) => x.status === 'fulfilled').length;
    const refused = both.filter((x) => x.status === 'rejected');
    assert.equal(ok, 1, 'exactly one parallel handover succeeds');
    assert.equal(refused.length, 1);
    assert.match(String(refused[0].reason?.message), /paid by the guard/);
    const loser = both[0].status === 'rejected' ? shirts[0] : shirts[1];

    // The 4th piece goes through only with the guard's receipt; the record is in the database.
    await assert.rejects(act(CM, { kind: 'issue', label: loser.token, personId: g.personId }), /receipt number/);
    await act(CM, { kind: 'issue', label: loser.token, personId: g.personId, paidByGuard: { receiptRef: 'RC-PG-01', amount: 45 } });
    const recs = (await admin.query("SELECT data FROM prima.item_uniform_records WHERE data->>'personId'=$1 ORDER BY data->>'kind'", [g.personId])).rows.map((r) => r.data);
    assert.deepEqual(recs.map((r) => [r.kind, r.pieces, r.receiptRef]), [['paid', 1, 'RC-PG-01'], ['past', 2, null]]);
    const after = (await board(CM)).uniforms.rows.find((r) => r.personId === g.personId);
    assert.deepEqual([after.free, after.paid, after.status], [3, 1, 'at_max']);

    // Bulk entry for a zone writes one row per guard checked.
    const zoned = rows.find((r) => r.zone && r.personId !== g.personId);
    const bulk = await act(CM, { kind: 'uniform.past', companyId: 'co-sasa', scope: { kind: 'zone', id: zoned.zone }, on: today, pieces: 1, reason: 'Store issue book (synthetic)' });
    assert.ok(bulk.recorded > 0);
    const batch = await admin.query("SELECT count(*)::int AS c FROM prima.item_uniform_records WHERE data->>'batchId'=$1", [bulk.batchId]);
    assert.equal(batch.rows[0].c, bulk.recorded);

    // The company wall: another company's manager reads none of Sasa's uniform records or guards.
    const seen = await db.asUser(OTHER, async (_svc, _user, store) => store.list('uniformRecords'));
    assert.equal(seen.filter((r) => r.companyId === 'co-sasa').length, 0);
    assert.equal((await board(OTHER)).uniforms.rows.filter((r) => r.companyId === 'co-sasa').length, 0);
    await assert.rejects(act(OTHER, { kind: 'uniform.past', companyId: 'co-sasa', scope: { kind: 'zone', id: zoned.zone }, on: today, pieces: 1, reason: 'Not my company (synthetic)' }), /manager/);

    // Records are append-only for the application role.
    await assert.rejects(db.asUser(CM, async (_s, _u, store) => store.update('uniformRecords', recs[0].id, { amount: 0 })), /permission denied|not allowed|cannot/i);

    // The guard sees their own count.
    const mine = await board(GUARD_USER);
    assert.ok(mine.myUniform && typeof mine.myUniform.free === 'number');
    console.log(`PASS actual PostgreSQL uniform allowance: parallel handovers serialised (1 of 2), guard-paid 4th with receipt, bulk zone entry (${bulk.recorded} guards), company wall on records and rows, append-only records. Synthetic disposable database only.`);
  } finally {
    await db.onModuleDestroy();
    await admin.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
