// Nepali EPF and SOCSO recharge (Fauzan, 5 Nov 2026, rule FW-RECHARGE) through the restricted login and the company
// wall: each company reads only its own copy of a debit note, a Branch Manager only their branch, the owner's copy moves
// only when the owner's Finance checks the money in, and one live debit note per user and month holds in the database.
// The module SQL is applied to the throwaway local database only (it is not part of the release). Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';
const mod = (f: string) => readFileSync(resolve(process.cwd(), process.cwd().endsWith('/apps/api') ? `../../db/modules/${f}` : `db/modules/${f}`), 'utf8');

describe('Nepali EPF and SOCSO recharge on PostgreSQL', () => {
  let db: Db;
  let workers: string[];
  let last: string;
  let sasaFin: string;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    await db.pool.query(mod('fw-recruitment-cost-v1.sql'));
    await db.pool.query(mod('fw-epf-socso-recharge-v1.sql'));
    // Idempotent: applying it again changes nothing.
    await db.pool.query(mod('fw-epf-socso-recharge-v1.sql'));
    workers = (await db.pool.query("SELECT id FROM prima.people WHERE company_id='co-sasa' AND data->>'nationality'='NP' AND data->>'status'='active' AND data->>'role'='guard' ORDER BY id LIMIT 3")).rows.map((r) => r.id);
    const team = (await db.pool.query("SELECT data->>'team' AS t FROM prima.fin_status WHERE company_id='co-sasa'")).rows[0].t;
    sasaFin = (await db.pool.query("SELECT id FROM prima.users WHERE data->>'department'='finance' AND data->>'financeTeam'=$1 ORDER BY id LIMIT 1", [team])).rows[0].id;
    const today = await db.asUser('u-fd', async (svc) => svc.today());
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    await db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwPlacement(u, workers[0], { hostCompanyId: 'co-arsh', from: `${last}-01` }, []));
    await db.asUser('u-fwm-ex1', (svc, u) => svc.recordFwPlacement(u, workers[1], { hostCompanyId: 'co-inas', hostBranchId: 'br-inas-2', from: `${last}-01` }, []));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const issue = (userCompanyId: string, userBranchId: string | null) =>
    db.asUser(sasaFin, async (svc, u) => {
      const draft = await svc.fwStatDraft(u, { ownerCompanyId: 'co-sasa', userCompanyId, userBranchId, period: last });
      const lines = draft.map((w) => ({ personId: w.personId, wage: w.wage, paid: w.expected, kwspRef: `KWSP-PG-${last}`, perkesoRef: `PERKESO-PG-${last}` }));
      return svc.issueFwStatCharge(u, { ownerCompanyId: 'co-sasa', userCompanyId, userBranchId, period: last, lines });
    });

  it('each company reads only its own copy; the Branch Manager repays; the owner copy moves on check-in', async () => {
    const toArsh = await issue('co-arsh', null);
    const toInas = await issue('co-inas', 'br-inas-2');
    const copies = (await db.pool.query('SELECT id, company_id FROM prima.fw_stat_charges ORDER BY id')).rows.map((r) => `${r.id}@${r.company_id}`);
    assert.deepEqual(copies, [`${toArsh.pairId}-o@co-sasa`, `${toArsh.pairId}-u@co-arsh`, `${toInas.pairId}-o@co-sasa`, `${toInas.pairId}-u@co-inas`]);
    // Arrow Shield sees its own debit note only; Inas's Branch Manager of another branch sees none.
    const arsh = await db.asUser('u-cm-arsh', (svc, u) => svc.fwStatBoard(u));
    assert.deepEqual(arsh.charges.map((c) => [c.ref, c.side]), [[toArsh.ref, 'user']]);
    assert.deepEqual((await db.asUser('u-bm-inas-1', (svc, u) => svc.fwStatBoard(u))).charges, []);
    const raw = await db.asUser('u-cm-arsh', async (_s, _u, store) => (await store.list('fwStatCharges', {})).map((c) => c.id));
    assert.deepEqual(raw, [`${toArsh.pairId}-u`]);
    await assert.rejects(
      db.asUser('u-cm-arsh', (svc, u) => svc.recordFwStatRepayment(u, toInas.pairId, { bankRef: 'IBG-PG-X', paidOn: toInas.issued.at.slice(0, 10), amount: toInas.total })),
      /not found|denied/i,
    );

    // The Branch Manager repays: only Inas's copy changes; Sasa's copy waits for Sasa's Finance.
    const paidOn = await db.asUser('u-fd', async (svc) => svc.today());
    await db.asUser('u-bm-inas-2', (svc, u) => svc.recordFwStatRepayment(u, toInas.pairId, { bankRef: 'IBG-PG-B2', paidOn, amount: toInas.total }));
    const status = async () => (await db.pool.query("SELECT id, data->>'status' AS s FROM prima.fw_stat_charges WHERE data->>'pairId'=$1 ORDER BY id", [toInas.pairId])).rows.map((r) => r.s);
    assert.deepEqual(await status(), ['issued', 'paid']);
    // Sasa's company manager cannot check it in; Sasa's Finance can.
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.confirmFwStatRepayment(u, toInas.pairId, 'Statement line 9')), /Finance/);
    await db.asUser(sasaFin, (svc, u) => svc.confirmFwStatRepayment(u, toInas.pairId, 'Sasa statement line 9'));
    assert.deepEqual(await status(), ['received', 'received']);
    const audit = await db.asUser('u-fauzan', async (_s, _u, store) => (await store.list('audit', {})).filter((a) => a.entityId === toInas.pairId).map((a) => `${a.action}@${a.companyId}`));
    for (const a of ['fw.epf_socso.issue@co-sasa', 'fw.epf_socso.issue@co-inas', 'fw.epf_socso.repaid@co-inas', 'fw.epf_socso.received@co-sasa']) assert.ok(audit.includes(a), a);
  });

  it('one live debit note per user and month, in the database too; two issues at once give exactly one', async () => {
    await assert.rejects(issue('co-arsh', null), /already charges/);
    const row = (await db.pool.query("SELECT data FROM prima.fw_stat_charges WHERE company_id='co-arsh'")).rows[0].data;
    const dup = { ...row, id: `${row.pairId}-x-u`, pairId: `${row.pairId}-x` };
    await assert.rejects(db.pool.query('INSERT INTO prima.fw_stat_charges (id, company_id, data) VALUES ($1, $2, $3)', [dup.id, 'co-arsh', dup]), /fw_stat_charges_one_live/);
    // A copy filed under the wrong company, or a received note checked in by the payer, is refused by the shape check.
    await assert.rejects(db.pool.query('INSERT INTO prima.fw_stat_charges (id, company_id, data) VALUES ($1, $2, $3)', ['bad-1', 'co-inas', { ...row, id: 'bad-1', companyId: 'co-inas', status: 'cancelled' }]), /fw_stat_charges_shape/);
    const by = { by: 'X', byId: 'u-x', at: row.issued.at };
    await assert.rejects(
      db.pool.query('INSERT INTO prima.fw_stat_charges (id, company_id, data) VALUES ($1, $2, $3)', ['bad-2', 'co-arsh', { ...row, id: 'bad-2', status: 'received', paid: { ...by, bankRef: 'R', paidOn: '2026-01-01', amount: row.total }, received: { ...by, note: 'n' } }]),
      /fw_stat_charges_shape/,
    );
    // An issued note is never rewritten, and its steps only move forward.
    await assert.rejects(db.pool.query("UPDATE prima.fw_stat_charges SET data = jsonb_set(data, '{total}', '1') WHERE id = $1", [row.id]), /not changed/);
    const done = (await db.pool.query("SELECT id FROM prima.fw_stat_charges WHERE data->>'status' = 'received' LIMIT 1")).rows[0].id;
    await assert.rejects(db.pool.query("UPDATE prima.fw_stat_charges SET data = jsonb_set(data, '{status}', '\"issued\"') WHERE id = $1", [done]), /cannot become/);
    await assert.rejects(db.pool.query("UPDATE prima.fw_stat_charges SET data = jsonb_set(data, '{paid,bankRef}', '\"OTHER\"') WHERE id = $1", [done]), /not rewritten|cannot become/);
    // Cancel, then two Finance people issue the same month at the same moment: exactly one goes through.
    await db.asUser('u-fd', (svc, u) => svc.cancelFwStatCharge(u, row.pairId, 'Correcting the wage'));
    const r = await Promise.allSettled([issue('co-arsh', null), db.asUser('u-fd', async (svc, u) => {
      const draft = await svc.fwStatDraft(u, { ownerCompanyId: 'co-sasa', userCompanyId: 'co-arsh', userBranchId: null, period: last });
      return svc.issueFwStatCharge(u, { ownerCompanyId: 'co-sasa', userCompanyId: 'co-arsh', period: last, lines: draft.map((w) => ({ personId: w.personId, wage: w.wage, paid: w.expected, kwspRef: 'KWSP-PG-FD', perkesoRef: 'PERKESO-PG-FD' })) });
    })]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    const live = (await db.pool.query("SELECT count(*)::int AS n FROM prima.fw_stat_charges WHERE company_id='co-arsh' AND data->>'status'<>'cancelled'")).rows[0].n;
    assert.equal(live, 1);
  });

  it('a recharged month locks the placement: it cannot be cut short', async () => {
    const p = (await db.pool.query("SELECT id FROM prima.fw_placements WHERE data->>'personId'=$1", [workers[0]])).rows[0].id;
    await assert.rejects(db.asUser('u-fwm-ex1', (svc, u) => svc.endFwPlacement(u, p, { to: `${last}-10`, note: 'Back to Sasa' })), /already recharged/);
  });
});
