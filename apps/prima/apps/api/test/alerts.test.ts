import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { registerRollout, type HomeItem, type User } from '@prima/core';
import { GraphAlertMail, MemoryAlertLedger, alertsConfiguration, deliveryId, runAlerts, type AlertsConfig } from '../src/alerts/alerts';
import { AlertsController, AlertsRuntime, alertRecipients } from '../src/alerts/controller';
import { PgAlertLedger } from '../src/alerts/pg-alert-ledger';
import type { Db } from '../src/db';

// Alerts to Teams and email (staff usability rule 7). Synthetic identities and items only; no provider is called.
const tenant = '11111111-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oidA = '99999999-8888-7777-6666-555555555551';
const oidB = '99999999-8888-7777-6666-555555555552';
const key = 'k'.repeat(40);
const hook = 'https://prod-01.southeastasia.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=SYNTHETIC';
const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ALERTS_ENABLED: 'true',
  ALERTS_RUN_KEY: key,
  ENTRA_TENANT_ID: tenant,
  ALERTS_CLIENT_ID: client,
  ALERTS_CLIENT_SECRET: 'SECRET_PRIVATE',
  ALERTS_SENDER_MAILBOX: 'alerts@example.invalid',
  ALERTS_TEAMS_WEBHOOKS_JSON: JSON.stringify({ it: hook }),
  ALERTS_APP_URL: 'https://prima.example.invalid',
  ...over,
});
const crit = (title: string): HomeItem => ({ tone: 'crit', tag: 'IT job', title, detail: 'P1', go: { view: 'it' } });
const warn = (title: string): HomeItem => ({ tone: 'warn', tag: 'IT job', title, detail: 'P3', go: { view: 'it' } });

function fakes(items: Record<string, HomeItem[]>, opts: { failSendFor?: string; failTeams?: boolean } = {}) {
  const sent: { to: string; subject: string; html: string }[] = [];
  const posts: { url: string; body: string }[] = [];
  const mail = {
    addressOf: async (oid: string) => (oid === oidA ? 'a@example.invalid' : oid === oidB ? 'b@example.invalid' : null),
    send: async (to: string, m: { subject: string; html: string }) => {
      if (to === opts.failSendFor) throw new Error('synthetic failure');
      sent.push({ to, ...m });
    },
  };
  const http = (async (url: string | URL | Request, init: RequestInit = {}) => {
    posts.push({ url: String(url), body: String(init.body) });
    return new Response(null, { status: opts.failTeams ? 500 : 202 });
  }) as typeof fetch;
  return { sent, posts, mail, http, itemsFor: async (id: string) => items[id] ?? [] };
}
const recipients = [
  { id: 'u-a', entraOid: oidA, department: 'it' },
  { id: 'u-b', entraOid: oidB, department: 'it' },
];

describe('alert settings', () => {
  it('are off unless switched on with a long run key and a valid channel', () => {
    assert.equal(alertsConfiguration({}), null);
    assert.equal(alertsConfiguration(env({ ALERTS_ENABLED: 'false' })), null);
    assert.equal(alertsConfiguration(env({ ALERTS_RUN_KEY: 'short' })), null);
    assert.equal(alertsConfiguration(env({ ALERTS_CLIENT_SECRET: '', ALERTS_TEAMS_WEBHOOKS_JSON: '{}' })), null);
    const c = alertsConfiguration(env())!;
    assert.equal(c.mail?.sender, 'alerts@example.invalid');
    assert.deepEqual(Object.keys(c.teams), ['it']);
  });
  it('accept only Teams Workflows webhook addresses over https', () => {
    const c = alertsConfiguration(env({ ALERTS_TEAMS_WEBHOOKS_JSON: JSON.stringify({ it: 'https://evil.example.com/hook', hr: 'http://prod.logic.azure.com/x', finance: hook, 'Bad Dept': hook }) }))!;
    assert.deepEqual(Object.keys(c.teams), ['finance']);
  });
});

describe('alert runs', () => {
  const config = alertsConfiguration(env())!;
  it('emails each person only their own new red items, once, and posts each department item once', async () => {
    const f = fakes({ 'u-a': [crit('ITJ-1: Server down'), warn('ITJ-2: Laptop')], 'u-b': [crit('ITJ-1: Server down')] });
    const ledger = new MemoryAlertLedger();
    const run = () => runAlerts({ config, mode: 'urgent', today: '2026-11-05', recipients, itemsFor: f.itemsFor, ledger, mail: f.mail, http: f.http });
    const first = await run();
    assert.equal(first.emails, 2);
    assert.equal(first.teamsPosts, 1);
    assert.deepEqual(f.sent.map((s) => s.to).sort(), ['a@example.invalid', 'b@example.invalid']);
    assert.match(f.sent[0].subject, /SEGERA/);
    assert.doesNotMatch(f.sent.find((s) => s.to === 'a@example.invalid')!.html, /ITJ-2/);
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].url, hook);
    const again = await run();
    assert.equal(again.emails + again.teamsPosts, 0);
    assert.equal(f.sent.length, 2);
  });

  it('sends the digest once a day with everything still waiting', async () => {
    const f = fakes({ 'u-a': [crit('ITJ-1: Server down'), warn('ITJ-2: Laptop')] });
    const ledger = new MemoryAlertLedger();
    const run = (today: string) => runAlerts({ config, mode: 'digest', today, recipients, itemsFor: f.itemsFor, ledger, mail: f.mail, http: f.http });
    assert.equal((await run('2026-11-05')).emails, 1);
    assert.equal((await run('2026-11-05')).emails, 0);
    assert.equal((await run('2026-11-06')).emails, 1);
    assert.match(f.sent[0].html, /ITJ-2/);
    assert.equal(f.posts.length, 0);
  });

  it('gives a claim back when a send fails, so the next run tries again', async () => {
    const f = fakes({ 'u-a': [crit('ITJ-1: Server down')] }, { failSendFor: 'a@example.invalid', failTeams: true });
    const ledger = new MemoryAlertLedger();
    const r = await runAlerts({ config, mode: 'urgent', today: '2026-11-05', recipients: [recipients[0]], itemsFor: f.itemsFor, ledger, mail: f.mail, http: f.http });
    assert.equal(r.failed, 2);
    assert.equal(ledger.ids.size, 0);
  });

  it('skips a person whose Microsoft account has no mailbox, and keeps no claim', async () => {
    const f = fakes({ 'u-x': [crit('ITJ-1: Server down')] });
    const ledger = new MemoryAlertLedger();
    const r = await runAlerts({ config, mode: 'urgent', today: '2026-11-05', recipients: [{ id: 'u-x', entraOid: '99999999-8888-7777-6666-000000000000', department: null }], itemsFor: f.itemsFor, ledger, mail: f.mail, http: f.http });
    assert.equal(r.noAddress, 1);
    assert.equal(ledger.ids.size, 0);
  });

  it('uses shared rollout admission and leadership-only boundary before selecting any recipient', () => {
    const staff = { id: 'synthetic-alert-rollout', name: 'Synthetic', title: 'Synthetic staff', role: 'admin_exec', companyIds: [], siteIds: [], department: 'finance', entraOid: oidA } as User;
    registerRollout('test_alert_recipients', 'Synthetic alerts test', u => u.id === staff.id);
    assert.equal(alertRecipients([staff], '2026-11-05', { PRIMA_ROLLOUTS: 'test_alert_recipients' }).length, 1);
    assert.equal(alertRecipients([staff], '2026-11-05', { PRIMA_ROLLOUTS: 'test_alert_recipients', LEADERSHIP_ONBOARDING_ONLY: 'true' }).length, 0);
    assert.equal(alertRecipients([{ ...staff, accessClosedFrom: '2026-11-01' }], '2026-11-05', { PRIMA_ROLLOUTS: 'test_alert_recipients' }).length, 0);
  });

  it('chooses recipients: linked office staff only, never guards, systems or closed accounts', () => {
    const u = (over: Partial<User>) => ({ id: 'u', role: 'admin_exec', entraOid: oidA, ...over }) as User;
    const r = alertRecipients([u({ id: 'u1' }), u({ id: 'u2', entraOid: undefined }), u({ id: 'u3', role: 'guard' }), u({ id: 'u4', integration: 'ja' } as Partial<User>), u({ id: 'u5', accessClosedFrom: '2026-11-01' } as Partial<User>)], '2026-11-05');
    // The pilot rule may further limit who receives alerts; never anyone outside the first list.
    assert.ok(r.every((x) => x.id === 'u1'));
  });
});

describe('Graph alert mail', () => {
  it('uses app sign-in, finds the address from the linked account, sends from the shared mailbox, and leaks no provider text', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const replies = [
      new Response(JSON.stringify({ access_token: 'TOKEN_PRIVATE', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ mail: 'a@example.invalid' }), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response(null, { status: 202 }),
      new Response('provider says SECRET_DETAIL', { status: 403 }),
    ];
    const http = (async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return replies.shift()!;
    }) as typeof fetch;
    const m = new GraphAlertMail(alertsConfiguration(env())!.mail!, http);
    assert.equal(await m.addressOf(oidA), 'a@example.invalid');
    await m.send('a@example.invalid', { subject: 'S', html: '<p>x</p>' });
    assert.match(calls[0].url, new RegExp(`login.microsoftonline.com/${tenant}/oauth2/v2.0/token`));
    assert.equal(calls[1].url, `https://graph.microsoft.com/v1.0/users/${oidA}?$select=mail`);
    assert.equal(calls[2].url, 'https://graph.microsoft.com/v1.0/users/alerts%40example.invalid/sendMail');
    assert.equal(JSON.parse(String(calls[2].init.body)).saveToSentItems, false);
    await assert.rejects(m.send('a@example.invalid', { subject: 'S', html: 'x' }), (e: Error) => !/SECRET|TOKEN/.test(e.message));
    assert.equal(calls.length, 4, 'the token is reused');
  });
});

describe('alerts endpoint', () => {
  const db = { pool: { query: async () => ({ rows: [] }) }, asUser: async () => [] } as unknown as Db;
  it('answers 503 while alerts are switched off, and 401 to a wrong key', async () => {
    await assert.rejects(new AlertsController(db, new AlertsRuntime(null, null, null)).run(key, 'urgent'), /switched off/);
    const ledger = Object.assign(new MemoryAlertLedger(), { ready: async () => true });
    const c = new AlertsController(db, new AlertsRuntime(alertsConfiguration(env()) as AlertsConfig, ledger, null));
    await assert.rejects(c.run('x'.repeat(40), 'urgent'), /key not valid/);
    await assert.rejects(c.run(undefined, 'urgent'), /key not valid/);
    await assert.rejects(c.run(key, 'all'), /mode must be/);
    const notReady = new AlertsController(db, new AlertsRuntime(alertsConfiguration(env()) as AlertsConfig, Object.assign(new MemoryAlertLedger(), { ready: async () => false }), null));
    await assert.rejects(notReady.run(key, 'urgent'), /not installed/);
    assert.deepEqual(await c.run(key, 'digest'), { mode: 'digest', people: 0, emails: 0, teamsPosts: 0, nothingToSend: 0, noAddress: 0, failed: 0 });
  });
});

describe('in-app bell', () => {
  it('returns only the signed-in person\'s own alerts and sends nothing', async () => {
    const asked: string[] = [];
    const db = { asUser: async (uid: string, fn: (svc: unknown, u: unknown) => unknown) => { asked.push(uid); return fn({ myAlerts: async () => [{ key: 'k', tone: 'crit', tag: 'IT job', title: 'ITJ-1', detail: '', view: 'it' }] }, { id: uid, department: 'it' }); } } as unknown as Db;
    const off = await new AlertsController(db, new AlertsRuntime(null, null, null)).mine('u-a');
    assert.deepEqual(asked, ['u-a']);
    assert.equal(off.items.length, 1);
    assert.equal(off.email, false);
    assert.equal(off.teamsChannel, false);
    const on = await new AlertsController(db, new AlertsRuntime(alertsConfiguration(env()) as AlertsConfig, null, null)).mine('u-a');
    assert.equal(on.email, true);
    assert.equal(on.teamsChannel, true);
  });
});

describe('alert sent-record on PostgreSQL', { skip: !process.env.DATABASE_URL }, () => {
  it('claims once, gives back, holds only hashes, and is not ready before the migration', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query('DROP TABLE IF EXISTS prima.alert_deliveries');
      const ledger = new PgAlertLedger(pool);
      assert.equal(await ledger.ready(), false);
      await pool.query(readFileSync(join(__dirname, '../../src/alerts/alerts-ledger-v1.sql'), 'utf8'));
      assert.equal(await ledger.ready(), true);
      const id = deliveryId('email', 'u-a', 'item');
      assert.equal(await ledger.claim(id, 'email'), true);
      assert.equal(await ledger.claim(id, 'email'), false);
      await ledger.release(id);
      assert.equal(await ledger.claim(id, 'email'), true);
      await assert.rejects(ledger.claim('not-a-hash', 'email'));
    } finally {
      await pool.query('DROP TABLE IF EXISTS prima.alert_deliveries').catch(() => undefined);
      await pool.end();
    }
  });
});
