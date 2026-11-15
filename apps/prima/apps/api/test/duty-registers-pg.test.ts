// Part Z on PostgreSQL (duty map registers, 14 Nov 2026): the duty_register_recs walls. The company office records,
// the company manager checks; another company reads none of it; the confidential PTPTN and absconder lists stay with
// their keepers, HR / FWM, Internal Audit and the CEO; only the CoS sets the welfare approver and nothing can pose as the
// settings row; history is append-only, identity is fixed and nothing is deleted. Synthetic data only.
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
const mod = (f: string) => readFileSync(resolve(__dirname, `../../../../db/modules/${f}`), 'utf8');

describe('Part Z duty registers (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });
  const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn, () => NOW);
  const reg = (uid: string, op: string, i: Record<string, unknown> = {}) => as(uid, (svc, u) => svc.registerAct(u, op, i));
  const rows = async (uid: string) => (await as(uid, (svc) => svc.store.list('dutyRegisterRecs', {}))) as { id: string; kind: string; companyId: string | null }[];

  it('refuses with a clear message before the module is installed', async () => {
    await assert.rejects(reg('u-ae-sasa', 'put', { kind: 'smeCorp', companyId: 'co-sasa', ref: 'SME-T', status: 'applied' }), /duty-registers-v1/);
  });

  it('company wall, manager check, confidential lists, settings row, append-only history and no delete', async () => {
    await admin(mod('duty-registers-v1.sql'));
    const r = (await reg('u-ae-sasa', 'put', { kind: 'smeCorp', companyId: 'co-sasa', ref: 'SME-T-1', status: 'applied' })) as { id: string };
    await assert.rejects(reg('u-ae-arsh', 'put', { kind: 'smeCorp', companyId: 'co-sasa', ref: 'SME-T-2', status: 'applied' }));
    await assert.rejects(reg('u-ae-sasa', 'check', { id: r.id, verdict: 'check', comment: 'ok' }));
    await reg('u-cm-sasa', 'check', { id: r.id, verdict: 'check', comment: 'Disemak (test)' });
    assert.equal((await rows('u-ae-arsh')).filter((x) => x.companyId === 'co-sasa').length, 0, 'another company reads none of Sasa');
    assert.ok((await rows('u-audit')).some((x) => x.id === r.id), 'Internal Audit reads');

    await reg('u-ae-sasa', 'put', { kind: 'ptptn', companyId: 'co-sasa', staffNo: 'S-PG-1', monthly: 50, from: '2026-01-01' });
    assert.ok((await rows('u-pwvsb-hr')).some((x) => x.kind === 'ptptn'), 'HR reads PTPTN');
    assert.ok(!(await rows('u-fd')).some((x) => x.kind === 'ptptn'), 'Finance does not read PTPTN');
    await reg('u-fwm-ex1', 'put', { kind: 'fwBlacklist', workerRef: 'FW-PG-1', reportedOn: '2026-11-10' });
    assert.ok(!(await rows('u-pwvsb-hr')).some((x) => x.kind === 'fwBlacklist'), 'HR does not read the absconder list');
    assert.ok((await rows('u-audit')).some((x) => x.kind === 'fwBlacklist'));

    await assert.rejects(reg('u-pwvsb-hr', 'setApprover', { userId: 'u-dcos', reason: 'test' }));
    await reg('u-cos', 'setApprover', { userId: 'u-dcos', reason: 'Pelulus (test)' });
    await assert.rejects(admin(`INSERT INTO prima.duty_register_recs (id, data) VALUES ('reg-fake', '{"id":"reg-fake","kind":"settings","status":"settings","history":[]}')`), /check/i);
    await assert.rejects(admin(`DELETE FROM prima.duty_register_recs WHERE data->>'kind' = 'smeCorp'`), /never deleted/);
    await assert.rejects(admin(`UPDATE prima.duty_register_recs SET data = jsonb_set(data, '{history}', '[]'::jsonb) WHERE data->>'kind' = 'smeCorp'`), /append-only/);
    await assert.rejects(admin(`UPDATE prima.duty_register_recs SET data = jsonb_set(jsonb_set(data, '{companyId}', '"co-arsh"'), '{history}', data->'history' || '[{"note":"x"}]'::jsonb) WHERE data->>'kind' = 'smeCorp'`), /immutable/);
  });
});
