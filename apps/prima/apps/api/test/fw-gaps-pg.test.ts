// FWM department check gaps on PostgreSQL (Fauzan, 23 Nov 2026): the fw_gap_recs walls. FWM loads paper dates from its
// list and records exits and quotas; a company manager raises a missing worker in their own company only and reads
// nothing of another company; the despatch is refused; history is append-only, identity is fixed, the caseload row
// cannot be posed as, and nothing is deleted. Synthetic data only.
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
const NOW = myt('2026-11-23', '10:00');

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
const pdf = (name: string) => ({ kind: 'document', name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name} ${Math.random()}`).toString('base64')}` });

describe('FWM check gaps (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });
  const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn, () => NOW);
  const fw = (uid: string, op: string, i: Record<string, unknown> = {}) => as(uid, (svc, u) => svc.fwGapsAct(u, op, i));
  const rows = async (uid: string) => (await as(uid, (svc) => svc.store.list('fwGapRecs', {}))) as { id: string; kind: string; companyId: string }[];

  it('loads list dates without the module, and refuses the module records with a clear message before it is installed', async () => {
    const np = (await admin(`SELECT data FROM prima.people WHERE company_id = 'co-sasa' AND data->>'nationality' = 'NP' AND data->>'status' <> 'left' ORDER BY id LIMIT 1`)).rows[0].data;
    const r = (await fw('u-fwm-ex1', 'bulkSave', { rows: [{ company: 'SASA', staffNo: np.staffNo, paper: 'SPIKPA', number: 'SP-1', issuedOn: '22/11/2026', expiresOn: '21/11/2031' }] })) as { loaded: number };
    assert.equal(r.loaded, 1);
    const saved = await admin(`SELECT data->>'source' AS s FROM prima.credentials WHERE data->>'personId' = $1 AND data->>'type' = 'SPIKPA' AND data->>'source' = 'list'`, [np.id]);
    assert.equal(saved.rows.length, 1);
    await assert.rejects(fw('u-fwm-ex1', 'addQuota', { companyId: 'co-sasa', ref: 'KESUMA-PG', appliedOn: '2026-11-01', placesAsked: 5 }), /fw-gaps-v1/);
    const b = (await fw('u-fwm-ex1', 'board')) as { installed: boolean };
    assert.equal(b.installed, false);
  });

  it('company wall, roles, append-only history, fixed identity, caseload row and no delete', async () => {
    await admin(mod('fw-gaps-v1.sql'));
    const np = (await admin(`SELECT data FROM prima.people WHERE company_id = 'co-sasa' AND data->>'nationality' = 'NP' AND data->>'status' <> 'left' ORDER BY id LIMIT 1 OFFSET 1`)).rows[0].data;
    const q = (await fw('u-fwm-ex1', 'addQuota', { companyId: 'co-sasa', ref: 'KESUMA-PG', appliedOn: '2026-11-01', placesAsked: 5 })) as { id: string };
    await fw('u-fwm-ex1', 'quotaStep', { id: q.id, step: 'approve', approvedOn: '2026-11-10', places: 5, proof: [pdf('letter.pdf')] });
    const c = (await fw('u-cm-sasa', 'raiseAbscond', { personId: np.id, lastSeenOn: '2026-11-18', contactTried: 'Called and checked the hostel twice' })) as { id: string };
    await assert.rejects(fw('u-cm-arsh', 'raiseAbscond', { personId: np.id, lastSeenOn: '2026-11-18', contactTried: 'Called and checked the hostel twice' }));
    await assert.rejects(fw('u-fwm-desp', 'board'));
    await fw('u-fwm-mgr', 'setCaseload', { companyId: 'co-sasa', execId: 'u-fwm-ex1' });
    await assert.rejects(fw('u-fwm-ex2', 'setCaseload', { companyId: 'co-sasa', execId: 'u-fwm-ex2' }));

    assert.ok((await rows('u-cm-sasa')).some((x) => x.id === c.id), 'own company reads the case');
    assert.equal((await rows('u-cm-arsh')).filter((x) => x.companyId === 'co-sasa').length, 0, 'another company reads none of Sasa');
    assert.ok((await rows('u-fwm-ex2')).some((x) => x.id === q.id), 'FWM reads every company');

    await assert.rejects(admin(`INSERT INTO prima.fw_gap_recs (id, company_id, data) VALUES ('fwcl-fake', 'co-sasa', '{"id":"fwcl-fake","companyId":"co-sasa","kind":"caseload","history":[]}')`), /check/i);
    await assert.rejects(admin(`DELETE FROM prima.fw_gap_recs WHERE id = $1`, [q.id]), /never deleted/);
    await assert.rejects(admin(`UPDATE prima.fw_gap_recs SET data = jsonb_set(data, '{history}', '[]'::jsonb) WHERE id = $1`, [q.id]), /append-only/);
    await assert.rejects(
      admin(`UPDATE prima.fw_gap_recs SET data = jsonb_set(jsonb_set(data, '{kind}', '"exit"'), '{history}', data->'history' || '[{"note":"x"}]'::jsonb) WHERE id = $1`, [q.id]),
      /immutable/,
    );
  });
});
