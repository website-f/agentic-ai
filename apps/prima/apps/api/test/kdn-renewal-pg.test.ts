// Part W on PostgreSQL (KDN licence renewal 2027, 14 Nov 2026): the kdn_recs walls. The company opens its renewal and
// files its pledge; FWM marks Nepali guards in eSIMS; Finance ticks SST; Central Admin saves the template; nobody else
// writes those rows; another company does not read this company's pledge; history is append-only and nothing is
// deleted. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type KdnRec } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-18', '10:00');
const LIC = 'lic-co-sasa-kdn_licence';
const PDF = (n: string) => [{ kind: 'document', name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${n}`).toString('base64')}` }];

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

describe('Part W KDN renewal records (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    await admin(mod('kdn-renewal-v1.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('company, FWM, Finance and Central Admin walls, append-only history and no delete', async () => {
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn, () => NOW);
    const act = (uid: string, op: string, i: Record<string, unknown>) => as(uid, (svc, u) => svc.kdnAct(u, op, i));
    const list = async (uid: string) => (await as(uid, (svc) => svc.store.list('kdnRecs', {}))) as KdnRec[];

    await act('u-ae-sasa', 'open', { licenceId: LIC });
    await act('u-ae-sasa', 'paper', { licenceId: LIC, item: '1.2', docs: PDF('insolvency'), docDate: '2026-10-05' });
    await act('u-ae-sasa', 'paper', { licenceId: LIC, item: '1.4', docs: PDF('pledge'), signer: 'Director T (test)' });
    const pledge = (await list('u-ae-sasa')).find((x) => x.kind === 'pledge')!;
    assert.equal(pledge.companyId, 'co-sasa');
    // Another company's manager does not read it; ACT, Finance and Central Admin do.
    assert.equal((await list('u-cm-arsh')).filter((x) => x.kind === 'pledge').length, 0);
    assert.equal((await list('u-dcos')).filter((x) => x.kind === 'pledge').length, 1);

    const np = (await admin(`SELECT id FROM prima.people WHERE data->>'companyId'='co-sasa' AND data->>'nationality'='NP' AND data->>'status'='active' LIMIT 1`)).rows[0].id as string;
    await act('u-fwm-mgr', 'fwEsims', { personId: np, on: '2026-11-17' });
    await act('u-fd', 'sst', { companyId: 'co-sasa', ref: 'MYSST-TEST-1', on: '2026-11-17' });
    // A second tick updates the same row (history grows).
    await act('u-fd', 'sst', { companyId: 'co-sasa', ref: 'MYSST-TEST-2', on: '2026-11-17' });
    await act('u-dcos', 'setSetting', { kind: 'window', year: 2028, reason: 'Test window (test)', value: { opens: '2027-09-27', closes: '2027-12-31', sessions: [{ no: 1, from: '2027-10-04', to: '2027-10-08' }], returnOnlySessions: [] } });
    const all = await list('u-dcos');
    assert.deepEqual([...new Set(all.map((x) => x.kind))].sort(), ['esims', 'pledge', 'sst', 'window']);
    // The company sees its own rows and the window; not another company's.
    assert.ok((await list('u-cm-sasa')).some((x) => x.kind === 'window'));

    // Direct writes outside the wall are refused by the database.
    const fake = (kind: string, companyId: string | null, id: string): KdnRec => ({ id, kind: kind as KdnRec['kind'], companyId, year: 2027, d: {}, by: 'x', byId: 'x', at: NOW, history: [] });
    await assert.rejects(as('u-cm-sasa', (svc) => svc.store.insert('kdnRecs', fake('sst', 'co-sasa', 'kdn-fake-1'))), /row-level security|permission denied/);
    await assert.rejects(as('u-cm-sasa', (svc) => svc.store.insert('kdnRecs', fake('template', null, 'kdn-fake-2'))), /row-level security|permission denied/);
    await assert.rejects(as('u-fd', (svc) => svc.store.insert('kdnRecs', fake('esims', 'co-sasa', 'kdn-fake-3'))), /row-level security|permission denied/);
    await assert.rejects(as('u-cm-arsh', (svc) => svc.store.insert('kdnRecs', fake('pledge', 'co-sasa', 'kdn-fake-4'))), /row-level security|permission denied/);

    await assert.rejects(admin(`UPDATE prima.kdn_recs SET data = jsonb_set(data,'{history}','[]'::jsonb) WHERE id=$1`, [pledge.id]), /append-only/);
    await assert.rejects(admin(`UPDATE prima.kdn_recs SET data = jsonb_set(data,'{companyId}','"co-arsh"'::jsonb) WHERE id=$1`, [pledge.id]), /immutable/);
    await assert.rejects(admin(`DELETE FROM prima.kdn_recs WHERE id=$1`, [pledge.id]), /never deleted/);
    const grants = (await admin(`SELECT privilege_type FROM information_schema.role_table_grants WHERE table_schema='prima' AND table_name='kdn_recs' AND grantee='prima_app'`)).rows.map((x) => x.privilege_type).sort();
    assert.deepEqual(grants, ['INSERT', 'SELECT', 'UPDATE']);
  });
});
