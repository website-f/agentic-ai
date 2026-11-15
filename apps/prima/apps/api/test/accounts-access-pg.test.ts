// Accounts and Access on PostgreSQL (Fauzan, 15 Nov 2026). Before module accounts-access-v1 nothing works; after it,
// only an approved request applied by its approver writes accounts and grants, and the database checks the rules again
// when the application is bypassed. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { ACCOUNT_TEMPLATES, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-15', '10:00');
const OID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('Accounts and Access (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('says it is not installed before the module', async () => {
    await assert.rejects(db.asUser('u-it-lead', (svc, u) => svc.accounts.board(u), () => NOW), /accounts-access-v1/);
  });

  it('the database kinds of account equal the application list', async () => {
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/accounts-access-v1.sql'), 'utf8'));
    const rows = (await admin('SELECT key, shape FROM prima.acc_templates() ORDER BY key')).rows;
    const want = ACCOUNT_TEMPLATES.map((t) => ({ key: t.key, shape: t.shape })).sort((a, b) => a.key.localeCompare(b.key));
    assert.deepEqual(rows, want);
  });

  it('IT prepares, the Chief of Staff approves, and the account and access are written', async () => {
    const items = [
      { op: 'create', template: 'admin_exec', name: 'Synthetic Office Person', title: 'Admin Executive', companyId: 'co-arsh', entraOid: OID },
      { op: 'create', template: 'it_executive', name: 'Synthetic IT Person', title: 'IT Executive', access: [{ companyId: 'co-sasa', scope: 'act' }] },
    ];
    const r = await db.asUser('u-it-lead', (svc, u) => svc.accounts.submit(u, { items, reason: 'Synthetic start list' }), () => NOW);
    // Straight into the accounts table as the app role: refused.
    await assert.rejects(
      db.asUser('u-it-lead', (svc) => (svc as any).store.insert('users', { id: 'u-x', name: 'X', title: 'X', role: 'admin_exec', companyIds: [], siteIds: [] }), () => NOW),
      /permission denied|row-level security/,
    );
    // The preparer cannot apply it, nor can anyone before approval.
    await assert.rejects(db.asUser('u-it-lead', (svc) => (svc as any).store.applyAccountRequest(r.id), () => NOW), /approver applies/);
    await assert.rejects(db.asUser('u-cos', (svc) => (svc as any).store.applyAccountRequest(r.id), () => NOW), /approver applies/);
    const d = await db.asUser('u-cos', (svc, u) => svc.accounts.decide(u, { requestId: r.id, approve: true, comment: 'Checked (synthetic).' }), () => NOW);
    assert.equal(d.applied!.users.length, 2);
    const u = (await admin(`SELECT data FROM prima.users WHERE data->>'entraOid' = $1`, [OID])).rows[0].data;
    assert.equal(u.role, 'admin_exec');
    assert.deepEqual(u.companyIds, ['co-arsh']);
    const g = (await admin(`SELECT data FROM prima.grants WHERE data->>'userId' = $1`, [d.applied!.users[1]])).rows.map((x) => x.data);
    assert.deepEqual(g.map((x) => [x.companyId, x.scope]), [['co-sasa', 'act']]);
    const applied = (await admin('SELECT data->\'applied\' AS a FROM prima.account_requests WHERE id = $1', [r.id])).rows[0].a;
    assert.deepEqual(applied.users, d.applied!.users);
    // Applying again is refused.
    await assert.rejects(db.asUser('u-cos', (svc) => (svc as any).store.applyAccountRequest(r.id), () => NOW), /approver applies/);
  });

  it('the database refuses a leader change approved without the CEO and a changed request at approval', async () => {
    const r = await db.asUser('u-it-lead', (svc, u) => svc.accounts.submit(u, { items: [{ op: 'update', userId: 'u-coo', name: 'Synthetic Real COO' }], reason: 'Leader name (synthetic)' }), () => NOW);
    // Bypass the application's check: the Chief of Staff marks it approved and calls the database function directly.
    await assert.rejects(
      db.asUser('u-cos', async (svc) => {
        const store = (svc as any).store;
        await store.update('accountRequests', r.id, { status: 'approved', decidedById: 'u-cos', decidedBy: 'x', decidedAt: NOW, comment: 'bypass' });
        return store.applyAccountRequest(r.id);
      }, () => NOW),
      /needs the CEO/,
    );
    // Changing the lines while approving is refused by the database.
    await assert.rejects(
      db.asUser('u-fauzan', (svc) => (svc as any).store.update('accountRequests', r.id, { status: 'approved', decidedById: 'u-fauzan', decidedBy: 'x', decidedAt: NOW, comment: 'x', items: [{ op: 'update', userId: 'u-chair', name: 'Other' }] }), () => NOW),
      /decision of a waiting request/,
    );
    const d = await db.asUser('u-fauzan', (svc, u) => svc.accounts.decide(u, { requestId: r.id, approve: true, comment: 'CEO confirms (synthetic).' }), () => NOW);
    assert.equal(d.status, 'approved');
    assert.equal((await admin(`SELECT data->>'name' AS n FROM prima.users WHERE id = 'u-coo'`)).rows[0].n, 'Synthetic Real COO');
  });

  it('a company manager cannot read or send requests', async () => {
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.accounts.board(u), () => NOW), /IT, HR/);
    const n: unknown[] = await db.asUser('u-cm-sasa', (svc) => (svc as any).store.list('accountRequests', {}), () => NOW);
    assert.equal(n.length, 0);
  });
});
