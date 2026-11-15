// Part R on PostgreSQL (arms, vault, licence and jacket policies, 14 Nov 2026): the arms_policy_recs walls. The arms wall
// and the company wall both apply; Finance and the CoS read nothing; another company's manager reads nothing; PWVSB HR
// reads licence applications and damage reports only; the store team reads jackets only; history is append-only and
// nothing is deleted. Synthetic data only.
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

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}
const mod = (f: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${f}`), 'utf8');

describe('Part R arms policy records (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    await admin(mod('special-ops-v1.sql'));
    await admin(mod('arms-policies-v1.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('arms and company walls, HR and stores views, append-only history and no delete', async () => {
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn as never, () => NOW) as Promise<T>;
    const pol = (uid: string, op: string, i: Record<string, unknown>) => as(uid, (svc, u) => svc.armsPolicyAct(u, op, i)) as Promise<any>;
    const list = async (uid: string) => (await as(uid, (svc) => svc.store.list('armsPolicyRecs', {}))) as { kind: string; companyId: string | null }[];
    const firearm = (await admin(`SELECT id FROM prima.firearms WHERE data->>'companyId'='co-sasa' AND data->>'status'='IN_VAULT' AND coalesce(data->>'ownership','OPERATIONAL')<>'TRADE' ORDER BY id LIMIT 1`)).rows[0].id as string;
    const dmg = await pol('u-cm-sasa', 'damageReport', { firearmId: firearm, what: 'Cracked grip (test)' });
    assert.equal(dmg.kind, 'damage');
    assert.equal((await admin(`SELECT data->>'status' AS s FROM prima.firearms WHERE id=$1`, [firearm])).rows[0].s, 'DAMAGED');
    const jacket = await pol('u-proc-store1', 'jacket', { serial: 'BV-PG-1', maker: 'Maker (test)', model: 'IIIA (test)' });
    assert.equal(jacket.companyId, 'goodwill');

    // The company and Arms Control read the damage report; Finance, the CoS and another company read nothing.
    assert.ok((await list('u-cm-sasa')).some((r) => r.kind === 'damage'));
    assert.ok((await list('u-pwvsb-arms')).some((r) => r.kind === 'damage'));
    for (const uid of ['u-fd', 'u-cos', 'u-cm-arsh', 'u-it-mgr']) assert.equal((await list(uid)).length, 0, uid);
    await assert.rejects(pol('u-fd', 'board', {}), /arms/i);
    // HR reads licence applications and damage reports only; the store team reads jackets only.
    const hr = await list('u-pwvsb-hr');
    assert.ok(hr.some((r) => r.kind === 'damage') && hr.every((r) => r.kind === 'damage' || r.kind === 'licenceApp'));
    const st = await list('u-proc-store1');
    assert.ok(st.length >= 1 && st.every((r) => r.kind.startsWith('jacket')));

    // Nobody writes a record for a company outside their wall.
    const fake = { id: 'arpol-fake', kind: 'damage', ref: 'X-1', status: 'open', at: NOW, byId: 'u-cm-sasa', by: 'x', version: 1, companyId: 'co-arsh', d: {}, history: [] };
    await assert.rejects(as('u-cm-sasa', (svc) => svc.store.insert('armsPolicyRecs', fake)), /row-level security|permission denied/);
    await assert.rejects(as('u-fd', (svc) => svc.store.insert('armsPolicyRecs', { ...fake, companyId: 'co-sasa' })), /row-level security|permission denied/);

    // History only grows, identity never changes, nothing is deleted (even by the owner role).
    await assert.rejects(admin(`UPDATE prima.arms_policy_recs SET data = jsonb_set(data,'{history}','[]'::jsonb) WHERE id=$1`, [dmg.id]), /append-only/);
    await assert.rejects(admin(`UPDATE prima.arms_policy_recs SET data = jsonb_set(data,'{companyId}','"co-arsh"'::jsonb) WHERE id=$1`, [dmg.id]), /immutable/);
    await assert.rejects(admin(`DELETE FROM prima.arms_policy_recs WHERE id=$1`, [dmg.id]), /never deleted/);
    const grants = (await admin(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='prima' AND table_name='arms_policy_recs' AND grantee='prima_app'`)).rows.map((r) => r.privilege_type).sort();
    assert.deepEqual(grants, ['INSERT', 'SELECT', 'UPDATE']);
  });
});
