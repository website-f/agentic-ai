// Real PostgreSQL: two storekeepers acting on the same store record at once go one after the other (Government
// Operations and Procurement go-live readiness, 2 Nov 2026). Synthetic data only; DATABASE_URL is a throwaway local
// database that this test resets.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

let n = 0;
const slip = () => ({
  kind: 'document' as const,
  name: 'Issue slip.jpg',
  data: `data:image/jpeg;base64,${Buffer.from(`synthetic slip ${++n} ${Date.now()}`).toString('base64')}`,
});

describe('procurement store locking on PostgreSQL', () => {
  let db: Db;
  let owner: Client;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    owner = new Client({ connectionString: URL });
    await owner.connect();
  });
  after(async () => {
    await owner.end();
    await db.onModuleDestroy();
  });

  async function guardWithoutAccount(companyId: string): Promise<string> {
    const r = await owner.query(
      `SELECT p.id FROM prima.people p
        WHERE p.data->>'companyId' = $1 AND p.data->>'status' = 'active'
          AND NOT EXISTS (SELECT 1 FROM prima.users u WHERE u.data->>'personId' = p.id)
        ORDER BY p.id LIMIT 1`,
      [companyId],
    );
    return r.rows[0].id as string;
  }

  it('never issues the last item twice when two storekeepers issue at the same moment', async () => {
    const itemId = 'stk-co-arsh-7';
    await owner.query(`UPDATE prima.stock_items SET data = data || '{"onHand":1}'::jsonb WHERE id = $1`, [itemId]);
    const personId = await guardWithoutAccount('co-arsh');
    const results = await Promise.allSettled([
      db.asUser('u-proc-store1', (svc, u) => svc.stockIssue(u, 'co-arsh', { itemId, personId, qty: 1, slip: [slip()] })),
      db.asUser('u-proc-store2', (svc, u) => svc.stockIssue(u, 'co-arsh', { itemId, personId, qty: 1, slip: [slip()] })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(refused.reason?.message), /Only 0 in the store/);
    const left = await owner.query(`SELECT (data->>'onHand')::int AS n FROM prima.stock_items WHERE id = $1`, [itemId]);
    assert.equal(left.rows[0].n, 0);
  });

  it('takes an item back only once when the return is sent twice at the same moment', async () => {
    const itemId = 'stk-co-arsh-8';
    const personId = await guardWithoutAccount('co-arsh');
    const before = (await owner.query(`SELECT (data->>'onHand')::int AS n FROM prima.stock_items WHERE id = $1`, [itemId])).rows[0].n as number;
    const issue = (await db.asUser('u-proc-store1', (svc, u) => svc.stockIssue(u, 'co-arsh', { itemId, personId, qty: 1, slip: [slip()] }))) as { id: string };
    const results = await Promise.allSettled([
      db.asUser('u-proc-store1', (svc, u) => svc.stockReturn(u, issue.id, 'good', '')),
      db.asUser('u-proc-store2', (svc, u) => svc.stockReturn(u, issue.id, 'good', '')),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const after = (await owner.query(`SELECT (data->>'onHand')::int AS n FROM prima.stock_items WHERE id = $1`, [itemId])).rows[0].n as number;
    assert.equal(after, before);
  });

  // A Goodwill item: store -> OM -> patrolling officer -> guard, each acknowledging (Fauzan, 2 Nov 2026).
  it('runs the Goodwill handover through the database company walls, once per step', async () => {
    const itemId = 'stk-goodwill-synthetic-radio';
    const item = { id: itemId, companyId: 'goodwill', sku: 'RAD-T', name: 'Synthetic radio', kind: 'DEVICE', size: null, onHand: 5, reorderAt: 1, charge: 'rental', rentalMonthly: 30 };
    await owner.query(`INSERT INTO prima.stock_items (id, company_id, data) VALUES ($1, 'goodwill', $2)`, [itemId, JSON.stringify(item)]);
    const personId = await guardWithoutAccount('co-arsh');
    const po = (
      await owner.query(`SELECT id FROM prima.people WHERE data->>'companyId' = 'co-arsh' AND data->>'status' = 'active' AND data->>'role' = 'patrol_officer' ORDER BY id LIMIT 1`)
    ).rows[0].id as string;
    const issue = (await db.asUser('u-proc-store1', (svc, u) =>
      svc.stockIssue(u, 'goodwill', { itemId, personId, qty: 1, omUserId: 'u-om-klang', patrolPersonId: po }),
    )) as { id: string };
    // The OM reads the Goodwill row under the walls; the company's own manager does not.
    const pass = await db.asUser('u-om-klang', (svc, u) => svc.myItems(u));
    assert.deepEqual(
      pass.toPassOn.map((r) => [r.issue.id, r.next]),
      [[issue.id, 'om']],
    );
    const mgr = (await owner.query(`SELECT id FROM prima.users WHERE data->>'role' = 'company_manager' AND data->'companyIds' ? 'co-arsh' LIMIT 1`)).rows[0]?.id as string | undefined;
    if (mgr) await assert.rejects(db.asUser(mgr, (svc, u) => svc.handoverStep(u, issue.id, 'om', { received: true })), /not found|named Operations Manager/i);
    // Two taps on the same step at once record it once.
    const twice = await Promise.allSettled([
      db.asUser('u-om-klang', (svc, u) => svc.handoverStep(u, issue.id, 'om', { received: true })),
      db.asUser('u-om-klang', (svc, u) => svc.handoverStep(u, issue.id, 'om', { received: true })),
    ]);
    assert.equal(twice.filter((r) => r.status === 'fulfilled').length, 1);
    await db.asUser('u-om-klang', (svc, u) => svc.handoverStep(u, issue.id, 'patrol', { received: true, signature: `data:image/png;base64,${Buffer.from('synthetic signature '.repeat(40)).toString('base64')}` }));
    await db.asUser('u-om-klang', (svc, u) => svc.handoverStep(u, issue.id, 'guard', { received: true, slip: [slip()], photo: [slip()] }));
    const row = (await owner.query(`SELECT data FROM prima.stock_issues WHERE id = $1`, [issue.id])).rows[0].data;
    assert.equal(row.acknowledged, true);
    assert.equal(row.billTo, 'co-arsh');
    assert.ok(row.handover.om && row.handover.patrol.step.signatureDocId && row.handover.guard.photoDocIds.length);
    const steps = (await owner.query(`SELECT data->>'action' AS a FROM prima.audit WHERE data->>'entityId' = $1 ORDER BY seq`, [issue.id])).rows.map(
      (r) => r.a,
    );
    assert.deepEqual(steps, ['store.issue', 'store.handover.om', 'store.handover.patrol', 'store.handover.guard']);
    // The proof reads back under the walls, with every file matching its recorded SHA-256.
    const proof = await db.asUser('u-om-klang', (svc, u) => svc.deliveryProof(u, issue.id));
    assert.equal(proof.allIntact, true);
    assert.equal(proof.audit.length, 4);
  });

  // Government Operations monitor under the company walls (Fauzan, 2 Nov 2026).
  it('shows the OM only government sites in their area, and refuses a storekeeper', async () => {
    const r = await db.asUser('u-om-klang', (svc, u) => svc.govOpsMonitor(u));
    assert.ok(r.totals && r.totals.sites > 0);
    const ids = r.sites.map((x) => x.siteId);
    const rows = (await owner.query(`SELECT id, data->>'sector' AS sector FROM prima.sites WHERE id = ANY($1)`, [ids])).rows;
    assert.ok(rows.length === ids.length && rows.every((x) => x.sector === 'government'));
    await assert.rejects(db.asUser('u-proc-store1', (svc, u) => svc.govOpsMonitor(u)), /Government Operations/);
  });

  // The management fee in the site P&L, entered by the Finance Director from the agreement (Fauzan, 2 Nov 2026).
  it('lets the Finance Director set a management fee under the company walls, audits it, and refuses an OM', async () => {
    const site = (await owner.query(`SELECT id, company_id FROM prima.sites WHERE data->>'sector' = 'government' LIMIT 1`)).rows[0];
    const f = await db.asUser('u-fd', (svc, u) => svc.setManagementFee(u, site.company_id, { opsCompany: 'goodwill', kind: 'percent', value: 7.5, agreementRef: 'SYN-MA-PG' }));
    assert.equal(f.managementFees?.goodwill?.value, 7.5);
    const stored = (await owner.query(`SELECT data->'managementFees'->'goodwill' AS fee FROM prima.fin_status WHERE company_id = $1`, [site.company_id])).rows[0];
    assert.equal(stored.fee.agreementRef, 'SYN-MA-PG');
    const audit = (await owner.query(`SELECT data->>'summary' AS summary FROM prima.audit WHERE data->>'action' = 'fin.management_fee' ORDER BY seq DESC LIMIT 1`)).rows[0];
    assert.match(audit.summary, /Goodwill Empire Sdn Bhd set to 7\.5% of billing \(agreement SYN-MA-PG\)/);
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.setManagementFee(u, site.company_id, { opsCompany: 'goodwill', kind: 'percent', value: 1, agreementRef: 'X' })), /Finance Director/);
    const r = await db.asUser('u-ogm', (svc, u) => svc.govOpsMonitor(u));
    const fees = r.sites.filter((x) => x.companyId === site.company_id).map((x) => x.managementFee);
    assert.ok(fees.length > 0 && fees.every((x) => x == null || x >= 0));
  });

  // Private Operations (Sasa Team) and the management fee bills under the company walls (Fauzan, 2 Nov 2026).
  it('shows the Operations Director only private sites, drafts fee bills by operations company, and refuses an OM', async () => {
    const r = await db.asUser('u-opsdir', (svc, u) => svc.privateOpsMonitor(u));
    const ids = r.sites.map((x) => x.siteId);
    assert.ok(ids.length > 0);
    const rows = (await owner.query(`SELECT id, data->>'sector' AS sector FROM prima.sites WHERE id = ANY($1)`, [ids])).rows;
    assert.ok(rows.length === ids.length && rows.every((x) => (x.sector ?? 'private') === 'private'));
    await assert.rejects(db.asUser('u-ogm', (svc, u) => svc.privateOpsMonitor(u)), /Private Operations/);
    const fd = await db.asUser('u-fd', (svc, u) => svc.managementFeeBills(u));
    assert.deepEqual(fd.totals.map((t) => t.opsCompanyId), ['goodwill', 'sasateam']);
    const ogm = await db.asUser('u-ogm', (svc, u) => svc.managementFeeBills(u));
    assert.ok(ogm.bills.length > 0 && ogm.bills.every((b) => b.opsCompanyId === 'goodwill'));
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.managementFeeBills(u)), /Finance, the COO/);
  });

  // Client satisfaction monitored (Fauzan, 2 Nov 2026): rating with who and how, complaint opened and closed under the walls.
  it('records a client rating and a complaint with a row lock, and shows them in the monitor', async () => {
    const acct = (await db.asUser('u-om-klang', (svc, u) => svc.clientBoard(u))).accounts.find((a) => a.canAct && a.stage === 'active')!;
    assert.ok(acct);
    await db.asUser('u-om-klang', (svc, u) => svc.clientRating(u, acct.id, 2, 'Slow response', { from: 'Synthetic PIC', via: 'meeting' }));
    await db.asUser('u-om-klang', (svc, u) => svc.clientComplaint(u, acct.id, { from: 'Synthetic PIC', via: 'call', what: 'Slow response at night' }));
    const stored = (await owner.query(`SELECT data FROM prima.client_accounts WHERE id = $1`, [acct.id])).rows[0].data;
    assert.equal(stored.ratings.at(-1).from, 'Synthetic PIC');
    const c = stored.complaints.at(-1);
    assert.equal(c.resolvedAt, null);
    await db.asUser('u-om-klang', (svc, u) => svc.resolveClientComplaint(u, acct.id, c.id, 'Night patrol added'));
    const after = (await owner.query(`SELECT data FROM prima.client_accounts WHERE id = $1`, [acct.id])).rows[0].data;
    assert.equal(after.complaints.at(-1).resolution, 'Night patrol added');
    const r = await db.asUser('u-fauzan', async (svc, u) => [...(await svc.govOpsMonitor(u)).clients, ...(await svc.privateOpsMonitor(u)).clients]);
    assert.equal(r.find((x) => x.id === acct.id)?.score, 2);
  });
  // A rejected purchase is corrected and sent again under the company walls (Arisha main review round 2, 2 Nov 2026).
  it('reopens a rejected purchase once, keeps the rejected round, audits it, and refuses the rejecter', async () => {
    const pr = await db.asUser('u-proc-exec', (svc, u) =>
      svc.raisePurRequest(u, 'co-sasa', { title: 'Synthetic torches PG', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: null, qty: 100, unitPrice: 30 }] }),
    );
    const rejected = { by: 'Synthetic COO', byId: 'u-coo', at: new Date().toISOString(), note: 'Quantity too high' };
    await owner.query(`UPDATE prima.pur_requests SET data = data || $2::jsonb WHERE id = $1`, [pr.id, JSON.stringify({ status: 'rejected', rejected })]);
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.purStep(u, pr.id, 'reopen', { note: 'x' })));
    const r = await db.asUser('u-proc-exec', (svc, u) => svc.purStep(u, pr.id, 'reopen', { note: 'Cut to 60', lines: [{ item: 'Torch', stockItemId: null, qty: 60, unitPrice: 30 }] }));
    assert.equal(r.status, 'quoting');
    const stored = (await owner.query(`SELECT data FROM prima.pur_requests WHERE id = $1`, [pr.id])).rows[0].data;
    assert.equal(stored.total, 1800);
    assert.equal(stored.rounds.length, 1);
    assert.equal(stored.rounds[0].rejected.note, 'Quantity too high');
    assert.equal(stored.rounds[0].total, 3000);
    const audit = (await owner.query(`SELECT data->>'summary' AS summary FROM prima.audit WHERE data->>'action' = 'pur.reopen' AND data->>'entityId' = $1`, [pr.id])).rows;
    assert.equal(audit.length, 1);
    await assert.rejects(db.asUser('u-proc-exec', (svc, u) => svc.purStep(u, pr.id, 'reopen', { note: 'again' })), /cannot reopen/);
  });
});
