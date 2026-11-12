// E4 SOCSO extras (Fauzan, 11 Nov 2026) through the real store as the runtime role: the LINDUNG form and a payment
// abroad live in the existing socso_claims record under the company wall; the wrong role is refused; the board for the
// Finance Director shows no family papers. Throwaway local database, reset. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { AccessDenied, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');
const at = (t: string) => () => t;
const paper = (n: number) => ({ kind: 'document' as const, name: `Letter ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 socso-pg ${n}`).toString('base64')}` });

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('E4 SOCSO extras (database, row-level security)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('runs the LINDUNG form and a payment abroad through the real store, with the wrong role refused', async () => {
    const lindung = (await admin(`SELECT id FROM prima.socso_claims WHERE data->>'type' = 'NON_WORK_ACCIDENT' AND company_id = 'co-sasa' LIMIT 1`)).rows[0].id as string;
    const form = { claimId: lindung, how: 'Fell from a motorcycle on a rest day (test)', injury: 'Knee', treatedAt: 'Klinik Ujian (test)', policeReportNo: '' };
    await db.asUser('u-cm-sasa', (svc, u) => svc.socsoExtras.act(u, 'lindung_form', form), at(NOW));
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.socsoExtras.act(u, 'lindung_check', { claimId: lindung, note: 'Mine' }), at(NOW)), (e) => e instanceof AccessDenied);
    // Another company's manager does not even find the claim.
    await assert.rejects(db.asUser('u-cm-arsh', (svc, u) => svc.socsoExtras.act(u, 'lindung_check', { claimId: lindung, note: 'ok then' }), at(NOW)), /not found|Not allowed/i);
    const checked = await db.asUser('u-ae-sasa', (svc, u) => svc.socsoExtras.act(u, 'lindung_check', { claimId: lindung, note: 'Matches the papers' }), at(NOW));
    assert.equal(checked.socsoExtras?.lindungForm?.checked?.by.length ? true : false, true);

    const death = (await admin(`SELECT id, company_id FROM prima.socso_claims WHERE data->>'type' = 'DEATH' LIMIT 1`)).rows[0];
    const raised = await db.asUser('u-ae-arsh', (svc, u) => svc.socsoExtras.act(u, 'pay_raise', { claimId: death.id, dependantId: 'dp-seed-1', what: 'FINAL_WAGES', route: 'BANK_ABROAD', amount: 1200, payTo: 'Nepal Test Bank, ending 4321', reason: 'Final wages (test)', proof: [paper(1)] }), at(NOW));
    const pid = raised.socsoExtras!.payAbroad![0].id;
    await assert.rejects(db.asUser('u-fin-t1-lead', (svc, u) => svc.socsoExtras.act(u, 'pay_decide', { claimId: death.id, paymentId: pid, approve: true, note: 'ok then' }), at(NOW)), (e) => e instanceof AccessDenied);
    const board = await db.asUser('u-fd', (svc, u) => svc.socsoExtras.board(u), at(NOW));
    assert.equal(board.rows.length, 1);
    assert.deepEqual(board.rows[0].payment.docIds, []);
    await db.asUser('u-fd', (svc, u) => svc.socsoExtras.act(u, 'pay_decide', { claimId: death.id, paymentId: pid, approve: true, note: 'Owed under the contract' }), at(NOW));
    const paid = await db.asUser('u-fin-t1-lead', (svc, u) => svc.socsoExtras.act(u, 'pay_paid', { claimId: death.id, paymentId: pid, on: TODAY, ref: 'TT-PG-1', proof: [paper(2)] }), at(NOW));
    assert.equal(paid.socsoExtras!.payAbroad![0].status, 'paid');
    const audit = await admin(`SELECT count(*)::int AS n FROM prima.audit WHERE data->>'action' LIKE 'socso.pay_abroad.%'`);
    assert.equal(audit.rows[0].n, 3);
  });
});
