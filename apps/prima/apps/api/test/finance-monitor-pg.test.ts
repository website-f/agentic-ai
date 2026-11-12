// P100 fin against a real local PostgreSQL (throwaway database; the tests reset it): the rate book (C5) saves through
// the restricted database login on each company's Finance record, a company's own people read its rates under the
// company wall, and the wrong roles are refused. Synthetic data only, never staging.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
process.env.DEV_TOKEN_SECRET = process.env.DEV_TOKEN_SECRET ?? 'test-secret';

async function q<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, args)).rows as T[];
  } finally {
    await c.end();
  }
}

describe('P100 fin on PostgreSQL', () => {
  let db: Db;
  let co: string;
  let other: string;
  let manager: string;
  before(async () => {
    await resetDb(URL);
    db = new Db();
    // A company manager and their company, and another company with books.
    const m = (await q<{ id: string; co: string }>(
      `SELECT u.id, u.data->'companyIds'->>0 AS co FROM prima.users u
        WHERE u.data->>'role' = 'company_manager' AND EXISTS (SELECT 1 FROM prima.fin_status f WHERE f.company_id = u.data->'companyIds'->>0)
        ORDER BY u.id LIMIT 1`,
    ))[0];
    manager = m.id;
    co = m.co;
    other = (await q<{ company_id: string }>(`SELECT company_id FROM prima.fin_status WHERE company_id <> $1 AND company_id <> 'pwvsb' ORDER BY company_id LIMIT 1`, [co]))[0].company_id;
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('C5: the FD sets a rate for every company and one company, saved on each Finance record through the restricted login', async () => {
    await db.asUser('u-fd', (svc, u) => svc.setRate(u, { key: 'transport_np', companyId: 'all', from: '2026-11', amount: 95, reason: 'Synthetic bus contract' }));
    await db.asUser('u-fauzan', (svc, u) => svc.setRate(u, { key: 'transport_np', companyId: other, from: '2026-11', amount: 120, reason: 'Synthetic own van' }));
    const rows = await q<{ company_id: string; log: { key: string; scope: string; amount: number }[] }>(`SELECT company_id, data->'rateLog' AS log FROM prima.fin_status`);
    for (const r of rows) assert.ok(r.log.some((e) => e.key === 'transport_np' && e.scope === 'group' && e.amount === 95), r.company_id);
    assert.ok(rows.find((r) => r.company_id === other)!.log.some((e) => e.scope === 'company' && e.amount === 120));
    const audit = await q<{ data: { action: string } }>(`SELECT data FROM prima.audit WHERE data->>'action' = 'fin.rate.set'`);
    assert.equal(audit.length, 2);
  });

  it('C5: a company manager is refused the rate book; the COO and a Finance team read it', async () => {
    await assert.rejects(db.asUser(manager, (svc, u) => svc.rateBook(u)), /rate book/);
    await assert.rejects(
      db.asUser(manager, (svc, u) => svc.setRate(u, { key: 'uniform', companyId: co, from: '2026-11', amount: 1, reason: 'Synthetic' })),
      /Finance Director or the CEO/,
    );
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.setRate(u, { key: 'uniform', companyId: 'all', from: '2026-11', amount: 1, reason: 'Synthetic' })), /Finance Director or the CEO/);
    const book = await db.asUser('u-coo', (svc, u) => svc.rateBook(u));
    assert.ok(book.companies.length > 1);
    assert.equal(book.canSet, false);
    const lead = await db.asUser('u-fin-t1-lead', (svc, u) => svc.rateBook(u));
    const t1 = await q<{ company_id: string }>(`SELECT company_id FROM prima.fin_status WHERE (data->>'team')::int = 1`);
    assert.deepEqual(lead.companies.map((c) => c.companyId).sort(), t1.map((r) => r.company_id).sort());
  });

  it('C10: a quotation made through the restricted login reads its company rate book under the company wall and flags below cost', async () => {
    const exec = (await q<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'role' = 'admin_exec' AND data->'companyIds' ? $1 ORDER BY id LIMIT 1`, [co]))[0];
    assert.ok(exec, 'an admin executive of the company');
    const made = await db.asUser(exec.id, (svc, u) =>
      svc.createQuotation(u, co, { client: 'Synthetic Client Sdn Bhd', siteName: 'Synthetic site', tenderId: null, guards: 2, nepaliGuards: 1, hoursPerDay: 12, ratePerGuard: 1500, validDays: 30 }),
    );
    assert.equal(made.costCheck?.status !== 'ok', true);
    const transport = made.costCheck!.lines.find((l) => l.key === 'transport_np')!;
    assert.deepEqual([transport.guards, transport.amount], [1, 95]);
    await assert.rejects(
      db.asUser(manager, (svc, u) => svc.quotationAction(u, made.id, 'approve', 'not submitted')),
      /awaiting|cannot/,
    );
  });

  it('F1: the unbilled-sites check runs through the restricted login; a manager sees only their company, an OM is refused', async () => {
    const all = await db.asUser('u-fd', (svc, u) => svc.unbilledSites(u));
    assert.ok(all.companies.length >= 1);
    const mine = await db.asUser(manager, (svc, u) => svc.unbilledSites(u));
    assert.deepEqual(mine.companies.map((c) => c.companyId), [co]);
    const om = (await q<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'opsTier' = 'om' ORDER BY id LIMIT 1`))[0];
    await assert.rejects(db.asUser(om.id, (svc, u) => svc.unbilledSites(u)), /unbilled sites/);
    await assert.rejects(db.asUser(manager, (svc, u) => svc.clearUnbilledFlag(u, co, { key: '2026-10|x|no_contract|', reason: 'Synthetic reason' })), /Finance reviewer/);
  });

  it('F2: profit per site runs through the restricted login for the FD and the COO; a manager and an OM are refused; the target needs the FD', async () => {
    await db.asUser('u-fd', (svc, u) => svc.setRate(u, { key: 'target_margin', companyId: 'all', from: '2026-11', amount: 15, reason: 'Synthetic group target' }));
    const fd = await db.asUser('u-fd', (svc, u) => svc.siteMargins(u));
    assert.ok(fd.sites.length > 0);
    assert.ok(fd.sites.every((s) => s.targetPct === 15));
    const coo = await db.asUser('u-coo', (svc, u) => svc.siteMargins(u));
    assert.equal(coo.sites.length, fd.sites.length);
    await assert.rejects(db.asUser('u-coo', (svc, u) => svc.setRate(u, { key: 'target_margin', companyId: 'all', from: '2026-11', amount: 1, reason: 'Synthetic' })), /Finance Director or the CEO/);
    await assert.rejects(db.asUser(manager, (svc, u) => svc.siteMargins(u)), /profit per site/);
    const om = (await q<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'opsTier' = 'om' ORDER BY id LIMIT 1`))[0];
    await assert.rejects(db.asUser(om.id, (svc, u) => svc.siteMargins(u)), /profit per site/);
  });

  it('F3: the monthly finance page for the CEO and a Finance team through the restricted login; a manager and an OM are refused', async () => {
    const ceo = await db.asUser('u-fauzan', (svc, u) => svc.finSummary(u));
    assert.equal(ceo.scope, 'group');
    assert.ok(ceo.rows.length > 1);
    assert.equal(ceo.group.row.company, 'Group total');
    const team = await db.asUser('u-fin-t1-lead', (svc, u) => svc.finSummary(u));
    const t1 = await q<{ company_id: string }>(`SELECT company_id FROM prima.fin_status WHERE (data->>'team')::int = 1`);
    assert.deepEqual(team.rows.map((r) => r.companyId).sort(), t1.map((r) => r.company_id).sort());
    await assert.rejects(db.asUser(manager, (svc, u) => svc.finSummary(u)), /monthly finance page/);
    const om = (await q<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'opsTier' = 'om' ORDER BY id LIMIT 1`))[0];
    await assert.rejects(db.asUser(om.id, (svc, u) => svc.finSummary(u)), /monthly finance page/);
  });

  it('C4: the FD changes a confirmed finance number with a reason, now or from a later day; a team leader is refused', async () => {
    await db.asUser('u-fd', (svc, u) => svc.finance.setSettings(u, { values: { icExplainMax: 1200 }, comment: 'Synthetic: auditor agreed' }));
    await db.asUser('u-fd', (svc, u) => svc.finance.setSettings(u, { values: { ceoNoticeFrom: 300000 }, comment: 'Synthetic: board paper', from: '2027-06-01' }));
    const row = (await q<{ s: { values: Record<string, number>; scheduled: { from: string; values: Record<string, number> }[] } }>(`SELECT data->'settings' AS s FROM prima.fin_status WHERE id = 'fin-pwvsb'`))[0].s;
    assert.equal(row.values.icExplainMax, 1200);
    assert.equal(row.values.ceoNoticeFrom, undefined);
    assert.deepEqual(row.scheduled.map((x) => [x.from, x.values.ceoNoticeFrom]), [['2027-06-01', 300000]]);
    const view = await db.asUser('u-fin-t1-lead', (svc, u) => svc.finance.settingsView(u));
    assert.equal(view.values.ceoNoticeFrom, 200000);
    await assert.rejects(db.asUser('u-fin-t1-lead', (svc, u) => svc.finance.setSettings(u, { values: { icExplainMax: 1 }, comment: 'Synthetic' })), /Finance Director or the CEO/);
  });
});
