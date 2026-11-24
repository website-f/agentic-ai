// PDPA officer department check on PostgreSQL (Fauzan, 23 Nov 2026): the inbox under the database walls. A staff member
// writes and reads only their own questions and cannot mark one handled; the PDPA wall reads all and handles; a handled
// line never changes again; the clean-up OK only gains runs. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-20', '10:00');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('PDPA officer inbox and clean-up OK (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says not installed before the module, then keeps each question to its asker and the PDPA wall', async () => {
    const staffId = (await admin(`SELECT id FROM prima.users WHERE data->>'role' = 'pwvsb_officer' AND data->>'department' = 'finance' AND data->>'personId' IS NOT NULL LIMIT 1`)).rows[0].id as string;
    const otherId = (await admin(`SELECT id FROM prima.users WHERE data->>'role' = 'pwvsb_officer' AND data->>'department' = 'it' AND data->>'personId' IS NOT NULL LIMIT 1`)).rows[0].id as string;
    await assert.rejects(db.asUser(staffId, (svc, u) => svc.pdpaOfficer.ask(u, { kind: 'ACCESS', detail: 'Copy of my file (synthetic)' }), () => NOW), /not installed/);
    assert.equal((await db.asUser(staffId, (svc, u) => svc.pdpaOfficer.myAsks(u), () => NOW)).installed, false);
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/pdpa-officer-v1.sql'), 'utf8'));
    // Repeat-safe.
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/pdpa-officer-v1.sql'), 'utf8'));
    const q = await db.asUser(staffId, (svc, u) => svc.pdpaOfficer.ask(u, { kind: 'ACCESS', detail: 'Copy of my file (synthetic)' }), () => NOW);
    assert.equal((await db.asUser(staffId, (svc, u) => svc.pdpaOfficer.myAsks(u), () => NOW)).rows.length, 1);
    // Another staff member reads nothing and cannot write a line in someone else's name, or one already handled.
    const seen = (await db.asUser(otherId, (svc) => (svc as any).store.list('pdpaInbox', {}), () => NOW)) as unknown[];
    assert.equal(seen.length, 0);
    await assert.rejects(
      db.asUser(otherId, (svc) => (svc as any).store.insert('pdpaInbox', { ...q, id: 'pask-forged', userId: staffId }), () => NOW),
      /row-level security/,
    );
    await assert.rejects(
      db.asUser(otherId, (svc) => (svc as any).store.insert('pdpaInbox', { ...q, id: 'pask-forged2', userId: otherId, handled: { by: 'x', at: NOW, outcome: 'closed', ref: null, note: 'x' } }), () => NOW),
      /row-level security/,
    );
    // The asker cannot mark their own question handled.
    const upd = await db
      .asUser(staffId, (svc) => (svc as any).store.update('pdpaInbox', q.id, { handled: { by: 'x', at: NOW, outcome: 'closed', ref: null, note: 'self closed' } }), () => NOW)
      .then(() => 'updated', (e: Error) => e.message);
    assert.notEqual(upd, 'updated');
    // The PDPA officer reads it and logs it as a data request.
    const inbox = await db.asUser('u-pdpa', (svc, u) => svc.pdpaOfficer.inbox(u), () => NOW);
    assert.ok(inbox.rows.some((r) => r.id === q.id));
    await db.asUser('u-pdpa', (svc, u) => svc.pdpaOfficer.handle(u, { id: q.id, action: 'request', companyId: 'co-sasa' }), () => NOW);
    const row = (await admin(`SELECT data FROM prima.pdpa_inbox WHERE id = $1`, [q.id])).rows[0].data;
    assert.equal(row.handled.outcome, 'request');
    // A handled line never changes, even for the administrator.
    await assert.rejects(admin(`UPDATE prima.pdpa_inbox SET data = jsonb_set(data, '{detail}', '"changed"') WHERE id = $1`, [q.id]), /keeps who asked/);
    await assert.rejects(admin(`UPDATE prima.pdpa_inbox SET data = jsonb_set(data, '{handled,note}', '"changed"') WHERE id = $1`, [q.id]), /already handled/);
  });

  it('the clean-up OK is the PDPA wall’s alone and only gains runs', async () => {
    await assert.rejects(
      db.asUser('u-pwvsb-hr', (svc) => (svc as any).store.insert('pdpaPurgeOks', { id: 'pok-x', okOn: '2026-11-20', validUntil: '2026-11-26', by: 'x', at: NOW, reason: 'Synthetic reason here', runs: [] }), () => NOW),
      /row-level security/,
    );
    const ok = await db.asUser('u-pdpa', (svc, u) => svc.pdpaOfficer.okCleanUp(u, { reason: 'No open legal hold needs these (synthetic)' }), () => NOW);
    await assert.rejects(admin(`UPDATE prima.pdpa_purge_oks SET data = jsonb_set(data, '{validUntil}', '"2026-12-31"') WHERE id = $1`, [ok.id]), /only gains runs/);
    await admin(`UPDATE prima.pdpa_purge_oks SET data = jsonb_set(data, '{runs}', '[{"at":"x","by":"job","what":"0 rows"}]') WHERE id = $1`, [ok.id]);
    await assert.rejects(admin(`UPDATE prima.pdpa_purge_oks SET data = jsonb_set(data, '{runs}', '[]') WHERE id = $1`, [ok.id]), /only gains runs/);
    await assert.rejects(admin(`INSERT INTO prima.pdpa_purge_oks (id, data) VALUES ('pok-long', '{"id":"pok-long","okOn":"2026-11-20","validUntil":"2026-12-31","reason":"A long reason here"}')`), /check constraint/);
  });
});
