// J6 (P100, Fauzan 11 Nov 2026): each person's alert choices in the database itself: the module, a row the person only
// can read and write, the alert run honouring the choices and always sending urgent safety alerts. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type HomeItem } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { MemoryAlertLedger, runAlerts, type AlertsConfig } from '../src/alerts/alerts';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function asApp(sql: string, params: unknown[], userId: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

describe('J6 alert choices (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, myt('2026-11-12', '09:00'));
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says not installed before the module, then keeps each person\'s own row only', async () => {
    const pre = await db.asUser('u-transport', (svc, u) => svc.myAlertPrefs(u));
    assert.equal(pre.ready, false);
    await assert.rejects(db.asUser('u-transport', (svc, u) => svc.setMyAlertPrefs(u, { urgent: false, digest: true, muted: [] })), /not installed/);
    const c = new Client({ connectionString: URL });
    await c.connect();
    await c.query(readFileSync(resolve(__dirname, '../../../../db/modules/alert-prefs-v1.sql'), 'utf8'));
    await c.query(readFileSync(resolve(__dirname, '../../../../db/modules/alert-prefs-v1.sql'), 'utf8'));
    await c.end();
    await db.asUser('u-transport', (svc, u) => svc.setMyAlertPrefs(u, { urgent: false, digest: false, muted: ['Leave'] }));
    // Another person reads nothing and cannot write someone else's row.
    assert.equal((await asApp(`SELECT count(*)::int AS n FROM prima.alert_prefs`, [], 'u-coo')).rows[0].n, 0);
    await assert.rejects(
      asApp(`INSERT INTO prima.alert_prefs (id, data) VALUES ('u-transport', '{"id":"u-transport","userId":"u-transport","urgent":true,"digest":true,"muted":[]}'::jsonb)`, [], 'u-coo'),
      /row-level security/,
    );
    const row = await db.asUser('u-transport', (svc, u) => svc.alertPrefsRow(u));
    assert.deepEqual({ urgent: row?.urgent, digest: row?.digest, muted: row?.muted }, { urgent: false, digest: false, muted: ['Leave'] });
  });

  it('sends urgent safety alerts whatever the choices, and nothing else when urgent email is off', async () => {
    const sent: string[] = [];
    const items: HomeItem[] = [
      { tone: 'crit', tag: 'Leave', title: 'Leave to approve', detail: '', go: { view: 'leave' } } as unknown as HomeItem,
      { tone: 'crit', tag: 'Arms', title: 'Firearm not returned', detail: '', go: { view: 'arms' } } as unknown as HomeItem,
    ];
    const config: AlertsConfig = { runKey: 'k'.repeat(40), appUrl: null, mail: { tenantId: 't', clientId: 'c', clientSecret: 's', sender: 'alerts@example.test' }, teams: {} };
    const out = await runAlerts({
      config,
      mode: 'urgent',
      today: '2026-11-12',
      recipients: [{ id: 'u-transport', entraOid: '00000000-0000-0000-0000-000000000001', department: 'transport' }],
      itemsFor: async () => items,
      prefsFor: (id) => db.asUser(id, (svc, u) => svc.alertPrefsRow(u)),
      ledger: new MemoryAlertLedger(),
      mail: { addressOf: async () => 'someone@example.test', send: async (_to, m) => void sent.push(m.subject + '|' + ('html' in m ? m.html : '')) },
      http: fetch,
    });
    assert.equal(out.emails, 1);
    assert.match(sent[0], /Firearm not returned/);
    assert.ok(!sent[0].includes('Leave to approve'));
    const digest = await runAlerts({ config, mode: 'digest', today: '2026-11-12', recipients: [{ id: 'u-transport', entraOid: '00000000-0000-0000-0000-000000000001', department: null }], itemsFor: async () => items, prefsFor: (id) => db.asUser(id, (svc, u) => svc.alertPrefsRow(u)), ledger: new MemoryAlertLedger(), mail: { addressOf: async () => 'someone@example.test', send: async () => undefined }, http: fetch });
    assert.equal(digest.emails, 0);
  });
});
