// Real PostgreSQL: two storekeepers acting on the same store record at once go one after the other (Government
// Operations and Procurement go-live readiness, 2 Nov 2026). Synthetic data only; DATABASE_URL is a throwaway local
// database that this test resets.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    const f = await db.asUser('u-fd', (svc, u) => svc.setManagementFee(u, site.company_id, { chargedBy: 'goodwill', kind: 'percent', value: 7.5, agreementRef: 'SYN-MA-PG', reason: 'Synthetic agreement signed' }));
    assert.equal(f.managementFees?.goodwill?.value, 7.5);
    const stored = (await owner.query(`SELECT data->'managementFees'->'goodwill' AS fee FROM prima.fin_status WHERE company_id = $1`, [site.company_id])).rows[0];
    assert.equal(stored.fee.agreementRef, 'SYN-MA-PG');
    const audit = (await owner.query(`SELECT data->>'summary' AS summary FROM prima.audit WHERE data->>'action' = 'fin.management_fee' ORDER BY seq DESC LIMIT 1`)).rows[0];
    assert.match(audit.summary, /Goodwill Empire Sdn Bhd bills .* set to 7\.5% of billing \(agreement SYN-MA-PG\), taken off site profit and loss, from \d{4}-\d{2}, was .*Reason: Synthetic agreement signed/);
    const log = (await owner.query(`SELECT data->'managementFeeLog' AS log FROM prima.fin_status WHERE company_id = $1`, [site.company_id])).rows[0].log;
    assert.equal(log.at(-1).reason, 'Synthetic agreement signed');
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.setManagementFee(u, site.company_id, { chargedBy: 'goodwill', kind: 'percent', value: 1, agreementRef: 'X', reason: 'Not allowed' })), /Finance Director/);
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
    assert.deepEqual(fd.totals.map((t) => t.chargedById), ['goodwill', 'sasateam']);
    const ogm = await db.asUser('u-ogm', (svc, u) => svc.managementFeeBills(u));
    assert.ok(ogm.bills.length > 0 && ogm.bills.every((b) => b.chargedById === 'goodwill'));
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.managementFeeBills(u)), /Finance, the COO/);
  });

  // Management fees between any group companies, with a reason, under the database walls (Fauzan, 5 Nov 2026).
  it('lets the Finance Director set a fee from PWVSB or any group company with a reason, kept and billed, and refuses the COO', async () => {
    const co = (await owner.query(`SELECT company_id FROM prima.fin_status WHERE company_id NOT IN ('pwvsb','merdeka','goodwill','sasateam') ORDER BY company_id LIMIT 1`)).rows[0].company_id;
    const m = (await db.asUser('u-fd', (svc, u) => svc.managementFees(u))).month;
    await db.asUser('u-fd', (svc, u) => svc.setManagementFee(u, co, { chargedBy: 'pwvsb', kind: 'fixed', value: 1234, agreementRef: 'SYN-PW-PG', reason: 'Synthetic group agreement', from: m }));
    await db.asUser('u-fd', (svc, u) => svc.setManagementFee(u, 'pwvsb', { chargedBy: 'merdeka', kind: 'fixed', value: 500, agreementRef: 'SYN-IT-PG', reason: 'Synthetic IT agreement', from: m }));
    const log = (await owner.query(`SELECT data->'managementFeeLog' AS log FROM prima.fin_status WHERE company_id = $1`, [co])).rows[0].log;
    assert.equal(log.at(-1).chargedBy, 'pwvsb');
    assert.equal(log.at(-1).reason, 'Synthetic group agreement');
    const bills = await db.asUser('u-fd', (svc, u) => svc.managementFeeBills(u, m));
    assert.ok(bills.bills.some((b) => b.chargedById === 'pwvsb' && b.companyId === co && b.fee?.value === 1234));
    assert.ok(bills.bills.some((b) => b.chargedById === 'merdeka' && b.companyId === 'pwvsb'));
    await assert.rejects(
      db.asUser('u-coo', (svc, u) => svc.setManagementFee(u, co, { chargedBy: 'pwvsb', kind: 'fixed', value: 1, agreementRef: 'X', reason: 'Not allowed' })),
      /Finance Director/,
    );
    await assert.rejects(db.asUser('u-fd', (svc, u) => svc.setManagementFee(u, co, { chargedBy: 'pwvsb', kind: 'fixed', value: 2, agreementRef: 'X', reason: '' })), /reason/);
    // A central company with no Finance record (Merdeka) is billed by Perfect Global Logistics: the record opens under the walls.
    await owner.query(`DELETE FROM prima.fin_status WHERE company_id = 'merdeka'`);
    await db.asUser('u-fd', (svc, u) => svc.setManagementFee(u, 'merdeka', { chargedBy: 'pgl', kind: 'fixed', value: 800, agreementRef: 'SYN-PGL-PG', reason: 'Synthetic vehicle rental', from: m }));
    const opened = (await owner.query(`SELECT data FROM prima.fin_status WHERE company_id = 'merdeka'`)).rows[0].data;
    assert.equal(opened.managementFees.pgl.value, 800);
    assert.equal(opened.managementFees.pgl.inSiteProfit, false);
    await db.asUser('u-fd', (svc, u) => svc.finBoard(u));
    // Perfect Global Logistics can be billed too (its Finance record opens on the first fee).
    await db.asUser('u-fd', (svc, u) => svc.setManagementFee(u, 'pgl', { chargedBy: 'pwvsb', kind: 'fixed', value: 300, agreementRef: 'SYN-PW-PGL', reason: 'Synthetic group fee', from: m }));
    assert.equal((await owner.query(`SELECT data->'managementFees'->'pwvsb'->>'value' AS v FROM prima.fin_status WHERE company_id = 'pgl'`)).rows[0].v, '300');
  });

  // Vehicles rented from Perfect Global Logistics under the database walls (Fauzan, 5 Nov 2026).
  it('lets Transport record a rented vehicle, the FD set its rent, the COO and OGM read bills, and refuses the COO a rent change', async () => {
    const v = (await owner.query(`SELECT id, data->>'plate' AS plate FROM prima.vehicles WHERE data->'rental' IS NULL OR data->>'rental' = 'null' ORDER BY id LIMIT 1`)).rows[0];
    assert.ok(v);
    const today = (await db.asUser('u-fd', (svc, u) => svc.vehicleRentals(u))).month;
    await db.asUser('u-transport', (svc, u) => svc.recordVehicleRental(u, v.id, { ownerId: 'pgl', since: `${today}-01`, reason: 'Synthetic PGL fleet' }));
    await db.asUser('u-fd', (svc, u) => svc.setVehicleRent(u, v.id, { monthly: 1800, agreementRef: 'SYN-PGL-PG', reason: 'Synthetic rental agreement', from: today }));
    const stored = (await owner.query(`SELECT data->'rental' AS r FROM prima.vehicles WHERE id = $1`, [v.id])).rows[0].r;
    assert.equal(stored.ownerId, 'pgl');
    assert.equal(stored.rates[0].monthly, 1800);
    assert.deepEqual(stored.changes.map((c: { reason: string }) => c.reason), ['Synthetic PGL fleet', 'Synthetic rental agreement']);
    for (const id of ['u-coo', 'u-ogm', 'u-transport']) {
      const r = await db.asUser(id, (svc, u) => svc.vehicleRentals(u));
      assert.ok(r.vehicles.some((x) => x.vehicleId === v.id && x.rent?.monthly === 1800), id);
    }
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.setVehicleRent(u, v.id, { monthly: 1, agreementRef: 'X', reason: 'Not allowed' })), /Finance Director/);
    const audit = (await owner.query(`SELECT data->>'action' AS a FROM prima.audit WHERE data->>'entityId' = $1 ORDER BY seq`, [v.id])).rows.map((x) => x.a);
    assert.deepEqual(audit.filter((a) => a.startsWith('fleet.ren')), ['fleet.rental', 'fleet.rent']);
    // Moved to another company's use: the owner row stays under its own company; the bill goes to the user.
    const vRow = (await owner.query(`SELECT data->>'companyId' AS company_id FROM prima.vehicles WHERE id = $1`, [v.id])).rows[0];
    const userCo = (await owner.query(`SELECT id FROM prima.companies WHERE id <> $1 ORDER BY id LIMIT 1`, [vRow.company_id])).rows[0].id;
    // E6 (11 Nov 2026): the move is asked for, approved by the COO and handed over (module vehicle-transfers-v1).
    await owner.query(readFileSync(resolve(__dirname, '../../../../db/modules/vehicle-transfers-v1.sql'), 'utf8'));
    const day1 = `${today}-01`;
    const vt = await db.asUser('u-transport', (svc, u) => svc.requestVehicleTransfer(u, { vehicleId: v.id, toCompanyId: userCo, wantedOn: day1, reason: 'Synthetic move' }));
    await db.asUser('u-coo', (svc, u) => svc.decideVehicleTransfer(u, vt.id, true, 'Synthetic approval'));
    await db.asUser('u-transport', (svc, u) => svc.handOverVehicleTransfer(u, vt.id, { on: day1, odometerKm: 1, handedBy: 'Synthetic A', receivedBy: 'Synthetic B', condition: 'Good', items: ['keys'] }));
    assert.equal((await owner.query(`SELECT data->>'companyId' AS c FROM prima.vehicles WHERE id = $1`, [v.id])).rows[0].c, vRow.company_id);
    const bills = await db.asUser('u-fd', (svc, u) => svc.vehicleRentals(u));
    assert.ok(bills.bills.some((b) => b.companyId === userCo && b.amount === 1800));
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.moveVehicleUse(u, v.id, { companyId: vRow.company_id, from: `${today}-02`, reason: 'Not allowed' })), /Transport department/);
    // The Transport head is employed by Perfect Global Logistics, inside the central-staff walls.
    const tp = (await owner.query(`SELECT p.company_id FROM prima.people p JOIN prima.users u ON u.data->>'personId' = p.id WHERE u.id = 'u-transport'`)).rows[0];
    assert.equal(tp?.company_id, 'pgl');
  });

  // Transport usage (Fauzan, 5 Nov 2026): cards, fill-ups with receipts, a driver's fill-up and a review, on PostgreSQL.
  it('keeps vehicle cards and fill-ups with receipts under the walls, lets the driver record, and refuses self-review', async () => {
    const receipt = [{ kind: 'document' as const, name: 'receipt.pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' }];
    const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
    const vid = (await owner.query(`SELECT id FROM prima.vehicles WHERE coalesce(data->'out', 'null'::jsonb) = 'null'::jsonb ORDER BY id LIMIT 1`)).rows[0].id as string;
    await db.asUser('u-transport', (svc, u) => svc.addVehicleCard(u, vid, { kind: 'FUEL', issuer: 'Syn PG Oil', last4: '5555', fuel: 'RON95', monthlyLimitRm: 50, holder: 'Office', since: at(0).slice(0, 10), reason: 'Synthetic PG card' }));
    const card = (await owner.query(`SELECT data->'cards' AS c FROM prima.vehicles WHERE id = $1`, [vid])).rows[0].c.at(-1);
    const r = await db.asUser('u-transport', (svc, u) =>
      svc.recordFuel(u, vid, { at: at(5), paidWith: 'FUEL_CARD', cardId: card.id, fuel: 'RON95', litres: 30, amountRm: 60, odometerKm: 999_000, station: 'Syn PG station', driver: 'Syn driver' }, receipt),
    );
    assert.ok(r.fill.flags.includes('OVER_LIMIT'));
    assert.ok(r.fill.docId);
    assert.equal((await owner.query(`SELECT count(*)::int AS n FROM prima.evidence_docs WHERE id = $1`, [r.fill.docId])).rows[0].n, 1);
    await assert.rejects(db.asUser('u-transport', (svc, u) => svc.reviewFuel(u, vid, r.fill.id, { outcome: 'EXPLAINED', reason: 'Mine' })), /Someone else/);
    await db.asUser('u-coo', (svc, u) => svc.reviewFuel(u, vid, r.fill.id, { outcome: 'EXPLAINED', reason: 'Synthetic: limit raised verbally' }));
    // A driver: the vehicle goes out with a company manager, who records a fill-up with the receipt.
    const now = Date.now();
    const rq = await db.asUser('u-cm-inas', (svc, u) => svc.requestVehicle(u, { purpose: 'Synthetic PG trip', from: new Date(now + 60_000).toISOString(), to: new Date(now + 3_600_000).toISOString() }));
    await db.asUser('u-transport', (svc, u) => svc.decideVehicleRequest(u, rq.id, true, vid, 'Synthetic trip and vehicle availability checked'));
    const odo = Number((await owner.query(`SELECT data->>'odometerKm' AS k FROM prima.vehicles WHERE id = $1`, [vid])).rows[0].k);
    await db.asUser('u-transport', (svc, u) => svc.vehicleOut(u, vid, rq.id, odo));
    const fill2 = { at: at(0), paidWith: 'CASH' as const, fuel: 'RON95' as const, litres: 10, amountRm: 20, odometerKm: 999_050, station: 'Syn PG station' };
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.recordFuel(u, vid, fill2, receipt)), /already on a fill-up/);
    const receipt2 = [{ kind: 'document' as const, name: 'receipt2.pdf', data: 'data:application/pdf;base64,JVBERi0xLjUK' }];
    const d = await db.asUser('u-cm-inas', (svc, u) => svc.recordFuel(u, vid, fill2, receipt2));
    assert.equal(d.fill.recordedById, 'u-cm-inas');
    assert.ok(d.fill.docId);
    await assert.rejects(db.asUser('u-om-klang', (svc, u) => svc.recordFuel(u, vid, { at: at(0), paidWith: 'CASH', fuel: 'RON95', litres: 1, amountRm: 2, odometerKm: 999_060, station: 'X station' }, receipt)), /driver/);
    const usage = await db.asUser('u-ogm', (svc, u) => svc.vehicleUsage(u));
    assert.equal(usage.role, 'monitor');
    assert.ok(usage.vehicles.find((v) => v.id === vid)!.fills.some((f) => f.id === d.fill.id));
    await db.asUser('u-transport', (svc, u) => svc.vehicleIn(u, vid, 999_100, 'Synthetic back'));
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
