// Special Operations slices 4B-4H on PostgreSQL 16 with row-level security and the Special Ops add-on module
// installed: each feed writes only through its own system sign-in, the arms wall still applies, and the signed-call
// check refuses bad keys, old timestamps and changed bodies. Throwaway local database, mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { myt, TradingOff, type ArmsRequest } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { verifySpecialOpsFeed } from '../src/special-ops.controller';
import { installSpecialOpsModule } from './special-ops-module';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('Special Ops 4B-4H (database)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    await installSpecialOpsModule(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('runs an arms request to the legal check and lets PWVSB legal read and clear it, while Finance cannot see it', async () => {
    const f = await db.asUser('u-cm-sasa', async (_svc, _u, store) => (await store.list('firearms', { companyId: 'co-sasa' })).find((x) => x.status === 'IN_VAULT')!);
    const r = (await db.asUser('u-pwvsb-arms', (svc, u) => svc.raiseArmsRequest(u, { companyId: 'co-sasa', kind: 'DISPOSE', title: 'Dispose of a worn shotgun', note: 'Armourer report', firearmIds: [f.id] }))) as ArmsRequest;
    await db.asUser('u-pwvsb-arms-asst', (svc, u) => svc.armsRequestStep(u, r.id, 'pass', 'Report attached'));
    await db.asUser('u-cm-sasa', (svc, u) => svc.armsRequestStep(u, r.id, 'authorise', 'Agree'));
    const cleared = await db.asUser('u-legal', (svc, u) => svc.armsRequestStep(u, r.id, 'legal_ok', 'Through a licensed dealer only'));
    assert.equal(cleared.request.state, 'regulator_pending');
    const fd = await db.asUser('u-fd', async (_svc, _u, store) => store.get('armsRequests', r.id));
    assert.ok(!fd);
  });

  it('takes CMS app events through the CMS link sign-in, once, and closes the alarm as real with a case', async () => {
    const ev = { id: 'pg-evt-intrusion-1', kind: 'INTRUSION', companyId: 'co-sasa', siteId: 'st-sasa-003', deviceId: 'sys-st-sasa-003-cctv', source: 'test', occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), summary: 'Intrusion zone 3', detail: {} };
    const first = await db.asUser('u-cms-link', (svc, u) => svc.cmsIngest(u, { events: [ev], closedAlarms: [] }));
    assert.equal(first.raised, 1);
    const again = await db.asUser('u-cms-link', (svc, u) => svc.cmsIngest(u, { events: [ev], closedAlarms: [] }));
    assert.equal(again.duplicates, 1);
    const closed = await db.asUser('u-cms-link', (svc, u) => svc.cmsIngest(u, { events: [], closedAlarms: [{ outcome: 'real', eventIds: [ev.id], closingNote: 'Person seen at the fence', closedBy: 'Operator A' }] }));
    assert.equal(closed.closed, 1);
    const alarm = await db.asUser('u-cms-head', async (_svc, _u, store) => store.get('siteAlarms', `cms-${ev.id}`));
    assert.equal(alarm?.status, 'closed');
    assert.ok(alarm?.caseId);
    const dir = await db.asUser('u-cms-link', (svc, u) => svc.cmsDirectory(u));
    assert.ok(dir.sites.length > 0);
    await assert.rejects(db.asUser('u-cms-head', (svc, u) => svc.cmsDirectory(u)));
  });

  it('makes one case when the same alarm close arrives twice at the same moment (review defect 5)', async () => {
    const at = new Date().toISOString();
    const evs = ['pg-evt-d5-a', 'pg-evt-d5-b'].map((id) => ({ id, kind: 'INTRUSION', companyId: 'co-sasa', siteId: 'st-sasa-003', deviceId: 'sys-st-sasa-003-cctv', source: 'test', occurredAt: at, receivedAt: at, summary: 'Intrusion zone 4', detail: {} }));
    await db.asUser('u-cms-link', (svc, u) => svc.cmsIngest(u, { events: evs, closedAlarms: [] }));
    const close = { id: 'alarm-pg-d5', outcome: 'real', eventIds: evs.map((e) => e.id), closingNote: 'Person seen at the gate', closedBy: 'Operator B' };
    await Promise.all([1, 2].map(() => db.asUser('u-cms-link', (svc, u) => svc.cmsIngest(u, { events: [], closedAlarms: [close] }))));
    const rows = await db.asUser('u-cms-head', async (_svc, _u, store) => Promise.all(evs.map((e) => store.get('siteAlarms', `cms-${e.id}`))));
    assert.ok(rows.every((r) => r?.status === 'closed' && r.caseId));
    assert.equal(new Set(rows.map((r) => r!.caseId)).size, 1, 'both events point at one case');
    const cases = await db.asUser('u-cms-head', async (_svc, _u, store) => (await store.list('cases', { companyId: 'co-sasa' })).filter((c) => c.id === rows[0]!.caseId));
    assert.equal(cases.length, 1);
  });

  it('refuses a close whose events have not arrived, by id, and tells the CMS app how many items it read (round 2)', async () => {
    const close = { id: 'alarm-pg-early', outcome: 'real', eventIds: ['pg-evt-early-1'], closingNote: 'Seen on camera', closedBy: 'Operator C' };
    const r = await db.asUser('u-cms-link', (svc, u) => svc.cmsIngest(u, { events: [], closedAlarms: [close] }));
    assert.deepEqual(r.received, { events: 0, closedAlarms: 1 });
    assert.equal(r.closed, 0);
    assert.equal(r.refused[0].id, 'alarm-pg-early');
    assert.match(r.refused[0].reason, /events not received yet/);
    const at = new Date().toISOString();
    const ev = { id: 'pg-evt-early-1', kind: 'INTRUSION', companyId: 'co-sasa', siteId: 'st-sasa-003', deviceId: 'sys-st-sasa-003-cctv', source: 'test', occurredAt: at, receivedAt: at, summary: 'Intrusion zone 5', detail: {} };
    const ok = await db.asUser('u-cms-link', (svc, u) => svc.cmsIngest(u, { events: [ev], closedAlarms: [close] }));
    assert.deepEqual(ok.refused, []);
    assert.equal(ok.closed, 1);
  });

  it('refuses a receipt above the approved amount and needs a new decision at the new price (review defect 6)', async () => {
    const p = await db.asUser('u-asset-re1', (svc, u) => svc.amBuyRequest(u, { description: 'Office chairs', category: 'FURNITURE', qty: 6, estCost: 5000, location: 'Group office', ownerEntity: 'PWVSB', reason: 'Broken chairs replaced' }));
    await db.asUser('u-fd', (svc, u) => svc.amBuyDecide(u, p.id, true, 'Within the furniture budget', 5000));
    await assert.rejects(db.asUser('u-asset-re1', (svc, u) => svc.amBuyReceived(u, p.id, { tag: 'FUR-PG-0001', cost: 50000, boughtOn: '2026-11-02' })), /above the approved/);
    await db.asUser('u-asset-re1', (svc, u) => svc.amBuyReprice(u, p.id, 50000, 'Supplier price went up'));
    await assert.rejects(db.asUser('u-asset-re1', (svc, u) => svc.amBuyReceived(u, p.id, { tag: 'FUR-PG-0001', cost: 50000, boughtOn: '2026-11-02' })), /approved purchase/);
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.amBuyDecide(u, p.id, true, 'ok', 5000)), /now RM50000/);
    // Round 2: a receipt is not an inspection.
    await db.asUser('u-coo', (svc, u) => svc.amBuyDecide(u, p.id, true, 'Two quotes checked', 50000));
    const got = await db.asUser('u-asset-re1', (svc, u) => svc.amBuyReceived(u, p.id, { tag: 'FUR-PG-0001', cost: 50000, boughtOn: '2026-11-02' }));
    assert.equal(got.lastCheckedOn, null);
  });

  it('lets the company raise, get back, correct and resubmit an arms request; legal points are for the directors only', async () => {
    const r = (await db.asUser('u-gm-sasa', (svc, u) => svc.raiseArmsRequest(u, { companyId: 'co-sasa', kind: 'ACQUIRE', title: 'Buy cartridges (PG test)', note: 'Synthetic', quantity: 800, estCost: 2400 }))) as ArmsRequest;
    await db.asUser('u-pwvsb-arms-asst', (svc, u) => svc.armsRequestStep(u, r.id, 'return', 'Too many for two sessions'));
    const screen = await db.asUser('u-gm-sasa', (svc, u) => svc.arms(u, 'co-sasa'));
    const row = screen.requests.find((x) => x.request.id === r.id)!;
    assert.equal(row.request.state, 'draft');
    assert.match(row.last!.reason, /Too many/);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.armsRequestStep(u, r.id, 'resubmit', 'Fixed')));
    const again = await db.asUser('u-gm-sasa', (svc, u) => svc.armsRequestStep(u, r.id, 'resubmit', 'Cut to 400', { changes: { quantity: 400, estCost: 1200 } }));
    assert.equal(again.request.state, 'arms_review');
    const flags = await db.asUser('u-fauzan', (svc, u) => svc.specialOpsLegalFlags(u));
    assert.ok(flags.rows.every((f) => f.status === 'open'));
    await assert.rejects(db.asUser('u-pwvsb-arms', (svc, u) => svc.specialOpsLegalFlags(u)));
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.specialOpsLegalFlags(u)));
  });

  it('keeps tracker positions only on duty, and the Asset Management feed writes its own view beside the tenancy', async () => {
    const t = await db.asUser('u-tracker-feed', (svc, u) => svc.trackerIngest(u, [{ trackerId: 'TRK-0001', at: myt('2026-11-02', '09:00'), lat: 3.1, lng: 101.6, speedKmh: 20, ignition: true }]));
    assert.equal(t.seenOnly, 1);
    const am = await db.asUser('u-am-feed', (svc, u) => svc.amIngest(u, [{ unitCode: 'RES-001', status: 'let', tenant: 'Mr Lim (1)', rent: 1500, paid: [] }]));
    assert.equal(am.updated, 1);
    const check = await db.asUser('u-asset-dir', (svc, u) => svc.amRentCheck(u));
    assert.ok(check.differences.some((d) => d.code === 'RES-001' && d.issue === 'Rent differs'));
    // The AM feed holds the asset walls only: it reads no arms row.
    const arms = await db.asUser('u-am-feed', async (_svc, _u, store) => store.list('firearms'));
    assert.equal(arms.length, 0);
  });

  it('refuses trading while off, logs the refusal, and keeps the CEO switch in the CMS settings table', async () => {
    // The controller's route path: the refused action rolls back, then the refusal is logged in its own transaction.
    const refused = await db.asUser('u-pwvsb-arms', (svc, u) => svc.raiseArmsRequest(u, { companyId: 'co-sasa', kind: 'TRADE_BUY', title: 'Buy trade stock', note: '', quantity: 10 })).catch((e: unknown) => e);
    assert.ok(refused instanceof TradingOff);
    await db.asUser('u-pwvsb-arms', (svc, u) => svc.logTradeRefusal(u, refused));
    const audit = await db.pool.query(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' = 'arms.trade_refused'`);
    assert.ok(audit.rows[0].n >= 1);
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.setArmsTrading(u, true, 'Try')), /CEO/);
    const state = await db.asUser('u-pwvsb-arms', (svc, u) => svc.armsTrading(u));
    assert.equal(state.on, false);
  });
});

describe('Special Ops feed signatures', () => {
  const env = { CMS_FEED_API_KEY: 'k-test-cms-0123456789', CMS_FEED_SIGNING_SECRET: 's-test-cms-0123456789' };
  const sign = (body: string, ts: string, secret = env.CMS_FEED_SIGNING_SECRET) => createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');
  it('accepts a fresh signed call and refuses a wrong key, an old timestamp, a changed body or an unset feed', () => {
    const now = Date.parse('2026-11-02T05:00:00Z');
    const ts = new Date(now).toISOString();
    const body = Buffer.from('{"events":[]}');
    const h = { 'x-api-key': env.CMS_FEED_API_KEY, 'x-timestamp': ts, 'x-signature': sign(body.toString(), ts) };
    assert.equal(verifySpecialOpsFeed(h, body, 'CMS_FEED', now, env), true);
    assert.equal(verifySpecialOpsFeed({ ...h, 'x-api-key': 'wrong' }, body, 'CMS_FEED', now, env), false);
    assert.equal(verifySpecialOpsFeed(h, body, 'CMS_FEED', now + 6 * 60_000, env), false);
    assert.equal(verifySpecialOpsFeed(h, Buffer.from('{"events":[1]}'), 'CMS_FEED', now, env), false);
    assert.equal(verifySpecialOpsFeed(h, body, 'TRACKER_FEED', now, env), false);
  });
});
