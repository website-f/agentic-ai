// WhatsApp rent reminders: the connector's pieces, and one full pass on PostgreSQL 16 with row-level security against a
// fake WhatsApp (no call leaves this machine). Mock data only; the number and tenant are made up.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { myt } from '@prima/core';
import { Db } from '../src/db';
import { createApp } from '../src/main';
import { resetDb } from '../src/reset-db';
import { parseWhatsAppWebhook, runRentReminders, sendOne, templateRequest, verifyWhatsAppSignature, whatsAppConfig, whatsAppState } from '../src/whatsapp';

const URL_ = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL_;

const ENV = {
  WHATSAPP_RENT_REMINDERS: 'on',
  WHATSAPP_GRAPH_VERSION: 'v1.0',
  WHATSAPP_PHONE_NUMBER_ID: '1000000001',
  WHATSAPP_ACCESS_TOKEN: 'test-token-not-real',
  WHATSAPP_APP_SECRET: 'test-app-secret-not-real',
  WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  WHATSAPP_TEMPLATE_BEFORE: 'rent_before',
  WHATSAPP_TEMPLATE_DUE: 'rent_due',
  WHATSAPP_TEMPLATE_LATE: 'rent_late',
};

describe('WhatsApp connector pieces', () => {
  it('stays off and names the missing settings until every one is set, and never with a malformed version', () => {
    const off = whatsAppState({});
    assert.equal(off.sending, false);
    assert.ok(off.missing.includes('WHATSAPP_ACCESS_TOKEN'));
    assert.equal(whatsAppState({ ...ENV, WHATSAPP_RENT_REMINDERS: 'off' }).sending, false);
    assert.equal(whatsAppState(ENV).sending, true);
    assert.equal(whatsAppConfig({}), null);
    assert.throws(() => whatsAppConfig({ ...ENV, WHATSAPP_GRAPH_VERSION: 'latest' }));
  });

  it('builds the template message with the five values and no line breaks', () => {
    const cfg = whatsAppConfig(ENV)!;
    const req = templateRequest({ claimId: 'c', reminderIds: ['r'], to: '60123456789', stage: 'late', params: { tenant: 'A\nB', unit: 'RES-001 Flat', amount: 'RM1,500.00', period: '2026-11', dueOn: '2026-11-01' } }, cfg);
    assert.equal(req.url, 'https://graph.facebook.com/v1.0/1000000001/messages');
    const body = JSON.parse(req.init.body);
    assert.equal(body.template.name, 'rent_late');
    assert.equal(body.template.language.code, 'ms');
    assert.deepEqual(body.template.components[0].parameters.map((p: { text: string }) => p.text), ['A B', 'RES-001 Flat', 'RM1,500.00', '2026-11', '2026-11-01']);
  });

  it('round 2: only a clear refusal (4xx) may be retried; no answer, a 5xx or a success without an id is uncertain', async () => {
    const cfg = whatsAppConfig(ENV)!;
    const item = { claimId: 'c1', reminderIds: ['r'], to: '60123456789', stage: 'due' as const, params: { tenant: 'T', unit: 'U', amount: 'RM1.00', period: '2026-11', dueOn: '2026-11-01' } };
    const answer = (status: number, body: unknown) => async () => ({ ok: status < 300, status, json: async () => body });
    assert.deepEqual(await sendOne(item, cfg, answer(200, { messages: [{ id: 'wamid.X' }] })), { claimId: 'c1', ok: true, providerId: 'wamid.X' });
    assert.equal((await sendOne(item, cfg, answer(400, { error: { code: 131030 } }))).uncertain, false);
    assert.equal((await sendOne(item, cfg, answer(503, {}))).uncertain, true);
    assert.equal((await sendOne(item, cfg, answer(200, {}))).uncertain, true);
    assert.equal((await sendOne(item, cfg, async () => { throw new Error('socket hang up'); })).uncertain, true);
  });

  it('checks Meta’s signature and reads receipts and text replies only', () => {
    const raw = Buffer.from('{"x":1}');
    const sig = `sha256=${createHmac('sha256', 's3cret').update(raw).digest('hex')}`;
    assert.equal(verifyWhatsAppSignature(sig, raw, 's3cret'), true);
    assert.equal(verifyWhatsAppSignature(sig, Buffer.from('{"x":2}'), 's3cret'), false);
    assert.equal(verifyWhatsAppSignature(sig, raw, undefined), false);
    const parsed = parseWhatsAppWebhook({
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.A', status: 'failed', errors: [{ code: 131026, title: 'Undeliverable' }] }], messages: [{ from: '60123456789', type: 'text', text: { body: 'ok' } }, { from: '60123456789', type: 'image' }] } }] }],
    });
    assert.deepEqual(parsed, { statuses: [{ providerId: 'wamid.A', status: 'failed', error: '131026 Undeliverable' }], replies: [{ from: '60123456789', text: 'ok' }] });
  });
});

describe('WhatsApp rent reminders on PostgreSQL', () => {
  let db: Db;
  let unitId = '';
  const saved: Record<string, string | undefined> = {};
  before(async () => {
    await resetDb(URL_);
    db = new Db();
    for (const k of Object.keys(ENV)) saved[k] = process.env[k];
    Object.assign(process.env, ENV);
  });
  after(async () => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    await db.onModuleDestroy();
  });

  it('queues, sends through the WhatsApp sign-in with the asset walls only, and records the receipt and a STOP reply', async () => {
    const clock = () => myt('2026-11-01', '10:00');
    // One made-up tenant owing November, everyone else paid up.
    await db.asUser('u-asset-re1', async (_svc, _u, store) => {
      const units = await store.list('amUnits', {});
      const let_ = units.filter((u) => u.tenancy && !u.tenancy.internal);
      unitId = let_[0].id;
      await store.transaction(async (tx) => {
        for (const u of let_)
          await tx.update('amUnits', u.id, {
            tenancy: u.id === unitId
              ? { ...u.tenancy!, tenant: 'Test Tenant Sdn Bhd', tenantPhone: '012-345 6789', invoices: [{ period: '2026-11', amount: 1500, paid: 0, paidOn: null }], followUps: [], whatsapp: null }
              : { ...u.tenancy!, invoices: u.tenancy!.invoices.map((i) => ({ ...i, paid: i.amount })) },
          });
      });
    });
    await db.asUser('u-asset-re1', (svc, u) => svc.amWhatsAppConsent(u, unitId, true, 'Signed the reminder consent form'), clock);
    const calls: { url: string; body: string }[] = [];
    const fake = async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.PG1' }] }) };
    };
    const r = await runRentReminders(db, whatsAppConfig(), fake, clock);
    assert.deepEqual({ queued: r.queued, sent: r.sent, failed: r.failed }, { queued: 1, sent: 1, failed: 0 });
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].body).to, '60123456789');
    // A second pass the same day sends nothing more.
    const again = await runRentReminders(db, whatsAppConfig(), fake, clock);
    assert.equal(again.sent, 0);
    assert.equal(calls.length, 1);
    // The WhatsApp sign-in reads no arms or HR rows.
    const firearms = await db.asUser('u-whatsapp-link', async (_s, _u, store) => store.list('firearms'));
    assert.equal(firearms.length, 0);
    await db.asUser('u-whatsapp-link', (svc, u) => svc.amWhatsAppEvents(u, { statuses: [{ providerId: 'wamid.PG1', status: 'delivered' }], replies: [{ from: '60123456789', text: 'STOP' }] }), clock);
    const board = await db.asUser('u-asset-re1', (svc, u) => svc.amWhatsAppBoard(u), clock);
    assert.equal(board.recent[0].status, 'delivered');
    assert.equal(board.agreed, 0);
    // Finance oversees Asset Management but cannot read tenants' numbers through the sender's outbox.
    await assert.rejects(db.asUser('u-fd', (svc, u) => svc.amWhatsAppOutbox(u), clock));
  });

  it('sends one message when two passes run at the same time (claimed rows), covering every unit of the tenant', async () => {
    const clock = () => myt('2026-11-01', '11:00');
    const ids: string[] = [];
    await db.asUser('u-asset-re1', async (_svc, _u, store) => {
      const units = (await store.list('amUnits', {})).filter((u) => u.tenancy && !u.tenancy.internal && u.id !== unitId).slice(0, 2);
      assert.equal(units.length, 2);
      await store.transaction(async (tx) => {
        for (const u of units) {
          ids.push(u.id);
          await tx.update('amUnits', u.id, {
            tenancy: { ...u.tenancy!, tenant: 'Second Test Tenant', tenantPhone: '013-555 0101', invoices: [{ period: '2026-11', amount: 800, paid: 0, paidOn: null }], followUps: [], whatsapp: null },
          });
        }
      });
    });
    for (const id of ids) await db.asUser('u-asset-re1', (svc, u) => svc.amWhatsAppConsent(u, id, true, 'Signed the reminder consent form'), clock);
    const calls: string[] = [];
    let n = 0;
    const slow = async (_url: string, init: { body: string }) => {
      calls.push(init.body);
      await new Promise((r) => setTimeout(r, 150));
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.CC${++n}` }] }) };
    };
    const [a, b] = await Promise.all([runRentReminders(db, whatsAppConfig(), slow, clock), runRentReminders(db, whatsAppConfig(), slow, clock)]);
    assert.equal(calls.length, 1, 'only one message leaves for the tenant');
    assert.equal(a.sent + b.sent, 1);
    const params = JSON.parse(calls[0]).template.components[0].parameters.map((p: { text: string }) => p.text);
    assert.equal(params[2], 'RM1,600.00', 'the amount is both units, as owed now');
    // STOP from that number ends reminders for both units.
    await db.asUser('u-whatsapp-link', (svc, u) => svc.amWhatsAppEvents(u, { statuses: [], replies: [{ from: '60135550101', text: 'stop' }] }), clock);
    const after_ = await db.asUser('u-asset-re1', async (_s, _u, store) => Promise.all(ids.map((id) => store.get('amUnits', id))));
    for (const u of after_) assert.equal(u!.tenancy!.whatsapp!.consent!.on, false);
  });

  it('round 2: a send with no clear answer is not sent again until the team settles it; only the team may', async () => {
    const clock = () => myt('2026-11-01', '12:00');
    let id = '';
    await db.asUser('u-asset-re1', async (_svc, _u, store) => {
      const u = (await store.list('amUnits', {})).find((x) => x.tenancy && !x.tenancy.internal && x.id !== unitId && !['013-555 0101'].includes(x.tenancy.tenantPhone ?? ''))!;
      id = u.id;
      await store.transaction(async (tx) => {
        await tx.update('amUnits', u.id, { tenancy: { ...u.tenancy!, tenant: 'Third Test Tenant', tenantPhone: '014-555 0202', invoices: [{ period: '2026-11', amount: 900, paid: 0, paidOn: null }], followUps: [], whatsapp: null } });
      });
    });
    await db.asUser('u-asset-re1', (svc, u) => svc.amWhatsAppConsent(u, id, true, 'Signed the reminder consent form'), clock);
    let calls = 0;
    const timeout = async () => {
      calls++;
      throw new Error('timeout');
    };
    const first = await runRentReminders(db, whatsAppConfig(), timeout, clock);
    assert.equal(calls, 1);
    assert.equal((first as { uncertain?: number }).uncertain, 1);
    // Later passes do not send it again.
    await runRentReminders(db, whatsAppConfig(), timeout, () => myt('2026-11-01', '15:00'));
    assert.equal(calls, 1);
    const rid = await db.asUser('u-asset-re1', async (_s, _u, store) => (await store.get('amUnits', id))!.tenancy!.whatsapp!.reminders.find((r) => r.status === 'uncertain')!.id);
    await assert.rejects(db.asUser('u-whatsapp-link', (svc, u) => svc.amWhatsAppSettle(u, id, rid, 'resend', 'Checked the inbox'), clock));
    await assert.rejects(db.asUser('u-fd', (svc, u) => svc.amWhatsAppSettle(u, id, rid, 'resend', 'Checked the inbox'), clock));
    await db.asUser('u-asset-re1', (svc, u) => svc.amWhatsAppSettle(u, id, rid, 'resend', 'Not in the WhatsApp Business inbox'), clock);
    let sent = 0;
    const ok = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.SETTLED${++sent}` }] }) });
    const again = await runRentReminders(db, whatsAppConfig(), ok, () => myt('2026-11-02', '10:00'));
    assert.equal(again.sent, 1);
  });

  it('answers Meta’s webhook check only with the right token, and refuses an unsigned webhook call', async () => {
    const app: NestExpressApplication = await createApp();
    await app.listen(0, '127.0.0.1');
    try {
      const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/integrations/whatsapp/v1/webhook`;
      const ok = await fetch(`${base}?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345`);
      assert.equal(ok.status, 200);
      assert.equal(await ok.text(), '12345');
      assert.equal((await fetch(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status, 403);
      const body = JSON.stringify({ entry: [] });
      assert.equal((await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
      const sig = `sha256=${createHmac('sha256', ENV.WHATSAPP_APP_SECRET).update(body).digest('hex')}`;
      const signed = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });
      assert.equal(signed.status, 201);
    } finally {
      await app.close();
    }
  });
});
