// Part Q6-Q23 on PostgreSQL (Merdeka IT policies, 14 Nov 2026): the it_policy_recs walls. A person reads only their own
// request; another department sees nothing; nobody inserts another person's request or an IT-only record; the PDPA officer
// reads the wipe log only; history is append-only and nothing is deleted. Synthetic data only.
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
const NOW = myt('2026-11-18', '10:00');
const PDF = (n: string) => [{ kind: 'document', name: `${n}.pdf`, data: 'data:application/pdf;base64,' + Buffer.from(`%PDF-1.4 ${n}`).toString('base64') }];

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('Q6-Q23 IT policy records (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/it-policies-v1.sql'), 'utf8'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('walls, own requests, PDPA wipe log, append-only history and no delete', async () => {
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn as never, () => NOW) as Promise<T>;
    const pol = (uid: string, op: string, i: Record<string, unknown>) => as(uid, (svc, u) => svc.itPolicies.act(u, op, i)) as Promise<any>;
    const staff = (await admin(`SELECT id FROM prima.users WHERE data->>'role'='pwvsb_officer' AND coalesce(data->>'department','') NOT IN ('it','hr','pdpa','finance') AND data->>'personId' IS NOT NULL AND data->'integration' IS NULL AND data->'opsTier' IS NULL ORDER BY id LIMIT 1`)).rows[0].id as string;
    const req = await pol(staff, 'request', { item: 'Monitor 24 inch', qty: 1, purpose: 'Second screen for reports' });
    assert.equal(req.status, 'submitted');
    // The requester reads their own; another department and a company manager read nothing.
    assert.equal(((await as(staff, (svc) => svc.store.list('itPolicyRecs', {}))) as unknown[]).length, 1);
    assert.equal(((await as('u-pwvsb-hr', (svc) => svc.store.list('itPolicyRecs', {}))) as unknown[]).length, 0);
    assert.equal(((await as('u-cm-arsh', (svc) => svc.store.list('itPolicyRecs', {}))) as unknown[]).length, 0);
    // Nobody inserts a request in someone else's name, nor an IT-only record.
    const fake = (kind: string, extra: Record<string, unknown>) => ({ id: `fake-${kind}`, kind, ref: 'X-1', status: 'submitted', at: NOW, byId: staff, by: 'x', version: 1, d: {}, history: [], ...extra });
    await assert.rejects(as(staff, (svc) => svc.store.insert('itPolicyRecs', fake('request', { requesterId: 'u-cos' }))), /row-level security|permission denied/);
    await assert.rejects(as(staff, (svc) => svc.store.insert('itPolicyRecs', fake('wipe', { requesterId: staff }))), /row-level security|permission denied/);
    // IT reads and answers it.
    assert.ok(((await as('u-it-ex1', (svc) => svc.store.list('itPolicyRecs', {}))) as unknown[]).length >= 1);
    const declined = await pol('u-it-ex1', 'requestDecline', { id: req.id, reason: 'A spare monitor is in the store' });
    assert.equal(declined.status, 'declined');
    // The requester cannot change it back.
    await assert.rejects(as(staff, (svc) => svc.store.update('itPolicyRecs', req.id, { status: 'submitted' })), /row-level security|permission denied|not found|No row/i);
    // The wipe log: the PDPA officer reads it, and only it.
    const assetId = (await admin(`SELECT id FROM prima.it_assets ORDER BY id LIMIT 1`)).rows[0].id as string;
    const w = await pol('u-it-ex1', 'wipe', { assetId, reason: 'reissue', method: 'secure_erase', evidence: PDF('wipe') });
    const pdpaUser = (await admin(`SELECT id FROM prima.users WHERE data->>'department'='pdpa' ORDER BY id LIMIT 1`)).rows[0].id as string;
    const seen = (await as(pdpaUser, (svc) => svc.store.list('itPolicyRecs', {}))) as { kind: string }[];
    assert.ok(seen.length >= 1 && seen.every((r) => r.kind === 'wipe'));
    // A different IT person checks it; the doer cannot.
    await assert.rejects(pol('u-it-ex1', 'wipeCheck', { id: w.id, reason: 'Checked myself' }), /different IT person/);
    assert.equal((await pol('u-it-lead', 'wipeCheck', { id: w.id, reason: 'Erase report checked' })).status, 'checked');
    // History only grows, identity never changes, nothing is deleted (even by the owner role).
    await assert.rejects(admin(`UPDATE prima.it_policy_recs SET data = jsonb_set(data,'{history}','[]'::jsonb) WHERE id=$1`, [w.id]), /append-only/);
    await assert.rejects(admin(`UPDATE prima.it_policy_recs SET data = jsonb_set(data,'{kind}','"request"'::jsonb) WHERE id=$1`, [w.id]), /immutable/);
    await assert.rejects(admin(`DELETE FROM prima.it_policy_recs WHERE id=$1`, [w.id]), /never deleted/);
    const grants = (await admin(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='prima' AND table_name='it_policy_recs' AND grantee='prima_app'`)).rows.map((r) => r.privilege_type).sort();
    assert.deepEqual(grants, ['INSERT', 'SELECT', 'UPDATE']);
  });
});
