import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function admin<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

// The month of a mid-month transfer on PostgreSQL (synthetic data; Arisha main review of 598218f, 3 Nov 2026).
describe('transfer month payroll and login follow-through under PostgreSQL', () => {
  let db: Db;
  const today = () => nowMyt().slice(0, 10);
  const period = () => today().slice(0, 7);
  const dayAfter = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const HR = 'u-pwvsb-hr';
  before(async () => {
    await resetDb(URL);
    // Start from draft months: the synthetic data may hold this month already submitted.
    await admin(`UPDATE prima.staff_pay_runs SET data = jsonb_set(data, '{stage}', '"draft"') WHERE data->>'period' = $1`, [nowMyt().slice(0, 7)]);
    // Every office staff member gets a synthetic masked salary account, so only the checks under test can block.
    await admin(`UPDATE prima.people SET data = jsonb_set(data, '{bank}', '{"bank":"Test Bank","accountMasked":"****0000"}') WHERE data->>'role' = 'office' AND (data->'bank' IS NULL OR data->'bank' = 'null'::jsonb)`);
    // A synthetic Chief of Staff (the HR Director): the pilot persona list has none, and the CEO who applied a movement
    // may not also authorise its login move.
    await admin(
      `INSERT INTO prima.users (id, data) SELECT 'u-cos-pg', data || '{"id":"u-cos-pg","name":"CoS (synthetic)","department":"chief_of_staff","leadership":"cos","personId":null,"entraOid":null}'::jsonb FROM prima.users WHERE id = 'u-pwvsb-hr'`,
    );
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const transfer = async (uid: string, staffNo: string, effectiveOn: string) => {
    const personId = await db.asUser(uid, async (_svc, u) => u.personId!);
    const [{ company_id: fromCompany }] = await admin(`SELECT company_id FROM prima.people WHERE id = $1`, [personId]);
    const branchId = (await admin<{ id: string }>(`SELECT id FROM prima.branches WHERE company_id = 'co-sasa' LIMIT 1`))[0].id;
    const m = await db.asUser(HR, (svc, u) => svc.prepareStaffMovement(u, { personId, kind: 'transfer', toCompanyId: 'co-sasa', effectiveOn, reason: 'Diminta Sasa (synthetic)', branchId, staffNo }));
    await db.asUser('u-cm-sasa', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Kami terima (synthetic)'));
    await db.asUser('u-fauzan', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Untuk Pengarah HR (synthetic)'));
    return { personId, fromCompany: fromCompany as string, m };
  };
  const prepare = (companyId: string) => db.asUser(HR, (svc, u) => svc.prepareStaffPay(u, companyId, period()));
  const submit = (runId: string) => db.asUser(HR, (svc, u) => svc.staffPayStep(u, runId, 'submit', { note: 'Hantar (synthetic)' }));
  /** HR corrects every part-month line with a synthetic figure and a reason (P100 C1: Prima works it out first). */
  const enterPartPay = async (runId: string) => {
    const run = (await admin<{ data: any }>(`SELECT data FROM prima.staff_pay_runs WHERE id = $1`, [runId]))[0].data;
    for (const l of run.lines.filter((x: any) => x.partMonth && !x.partPay))
      await db.asUser(HR, (svc, u) => svc.setStaffPayLine(u, runId, l.personId, { partPay: { basic: 100, allowances: 0, note: 'Synthetic part-month figure' } }));
  };
  const linesFor = async (runId: string, personId: string) =>
    (await admin<{ data: any }>(`SELECT data FROM prima.staff_pay_runs WHERE id = $1`, [runId]))[0].data.lines.filter((l: any) => l.personId === personId);

  it('a transfer taking effect mid-month: the old employer pays up to the day before, the new one from the date, each waiting for HR\'s part-month figure', async () => {
    // Today is the effective date, so the last approval applies it (unless today is the 1st, when nothing is part-month).
    const { personId, fromCompany, m } = await transfer('u-it-ex2', 'SASA-PG-910', today());
    const done = (await admin<{ data: any }>(`SELECT data FROM prima.staff_movements WHERE id = $1`, [m.id]))[0].data;
    assert.equal(done.status, 'done');
    const newId = done.result.newPersonId;
    const oldRun = await prepare(fromCompany);
    const newRun = await prepare('co-sasa');
    // Neither employer drops the person; neither pays a full month to both.
    const oldLines = await linesFor(oldRun.id, personId);
    const newLines = await linesFor(newRun.id, newId);
    assert.equal(newLines.length, 1);
    assert.equal(newLines[0].partMonth?.from ?? null, today() === `${period()}-01` ? null : today());
    if (today() !== `${period()}-01`) {
      assert.equal(oldLines.length, 1);
      assert.equal(oldLines[0].partMonth.to, dayAfter(today(), -1));
      // P100 C1: no longer held for a hand-typed figure; the line shows the working-day count and daily rate.
      assert.equal(typeof oldLines[0].partAuto?.workingDays, 'number');
      assert.equal(oldLines[0].partAuto?.divisor, 26);
    } else assert.equal(oldLines.length, 0);
    await enterPartPay(oldRun.id);
    await enterPartPay(newRun.id);
    const paidOld = await linesFor(oldRun.id, personId);
    if (paidOld.length) assert.equal(paidOld[0].basic, 100);
    await submit(oldRun.id);
    await submit(newRun.id);
    // The login follow-through: authorised separately, and IT cannot confirm before the account really moved.
    const handover = async () => (await admin<{ data: any }>(`SELECT data FROM prima.login_handovers WHERE id = $1`, [`lh-${m.id}`]))[0]?.data;
    assert.equal((await handover()).status, 'to_authorise');
    // IT reads the handover, never the movement row: the service refuses and the database wall returns nothing.
    await assert.rejects(db.asUser('u-it-ex1', (svc, u) => svc.staffMovements(u)));
    const itView = await db.asUser('u-it-ex1', (svc, u) => svc.loginHandovers(u));
    const row = itView.rows.find((r) => r.movementId === m.id)!;
    assert.ok(row);
    assert.doesNotMatch(JSON.stringify(itView), /Diminta Sasa|basicPay|reason/);
    assert.equal(await db.asUser('u-it-ex1', async (_svc, _u, store) => (await (store as unknown as { client: { query: (q: string) => Promise<{ rows: { n: number }[] }> } }).client.query(`SELECT count(*)::int AS n FROM prima.staff_movements`)).rows[0].n), 0);
    await assert.rejects(db.asUser('u-fauzan', (svc, u) => svc.confirmMovementLogin(u, m.id, 'Siap (synthetic)')), /not authorised/);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.authoriseMovementLogin(u, m.id, true, 'Setuju (synthetic)')));
    // The CEO approved and applied it, so the CEO cannot also authorise the login move; the HR Director does.
    await assert.rejects(db.asUser('u-fauzan', (svc, u) => svc.authoriseMovementLogin(u, m.id, true, 'Pindah log masuk (synthetic)')), /did not prepare or apply/);
    await db.asUser('u-cos-pg', (svc, u) => svc.authoriseMovementLogin(u, m.id, true, 'Pindah log masuk (synthetic)'));
    await assert.rejects(db.asUser('u-fauzan', (svc, u) => svc.confirmMovementLogin(u, m.id, 'Siap (synthetic)')), /still points to the old record/);
    // Meanwhile the old login is told plainly why self-service leave is refused.
    await assert.rejects(
      db.asUser('u-it-ex2', (svc, u) => svc.requestLeave(u, { personId, kind: 'ANNUAL', from: dayAfter(today(), 10), to: dayAfter(today(), 10), reason: 'Cuti (synthetic)' })),
      today() === `${period()}-01` ? /./ : /transfer to another group company/,
    );
    // The account process (outside Prima, synthetic here) points the login at the new record; that alone is not enough
    // while the account still reaches the old company and not the new one.
    await admin(`UPDATE prima.users SET data = jsonb_set(data, '{personId}', to_jsonb($1::text)) WHERE id = 'u-it-ex2'`, [newId]);
    await assert.rejects(db.asUser('u-it-ex1', (svc, u) => svc.confirmMovementLogin(u, m.id, 'Siap (synthetic)')), /no access to|still has access to/);
    // Then the account is moved to the new company's office role with no group or old-company access.
    await admin(
      `UPDATE prima.users SET data = data || '{"role":"admin_exec","department":null,"itRole":null,"companyIds":["co-sasa"]}'::jsonb WHERE id = 'u-it-ex2'`,
    );
    await admin(`DELETE FROM prima.grants WHERE data->>'userId' = 'u-it-ex2'`);
    const confirmed = await db.asUser('u-it-ex1', (svc, u) => svc.confirmMovementLogin(u, m.id, 'Akaun dipindah (synthetic)'));
    assert.equal(confirmed.status, 'done');
    assert.equal((await handover()).done.byId, 'u-it-ex1');
  });

  it('a delayed apply blocks both months until it is applied and recalculated; a movement after submission waits with the reason', async () => {
    const { personId, fromCompany, m } = await transfer('u-it-ex3', 'SASA-PG-911', dayAfter(today(), 20));
    // HR returned last test's month for this case (synthetic).
    await admin(`UPDATE prima.staff_pay_runs SET data = jsonb_set(data, '{stage}', '"draft"') WHERE data->>'period' = $1`, [period()]);
    // The day comes (moved to today by the test) but nobody applies it yet.
    await admin(`UPDATE prima.staff_movements SET data = jsonb_set(data, '{effectiveOn}', to_jsonb($2::text)) WHERE id = $1`, [m.id, today()]);
    const oldRun = await prepare(fromCompany);
    await enterPartPay(oldRun.id);
    await assert.rejects(submit(oldRun.id), /approved but not applied/);
    // Applied late: the month is now stale until recalculated, then the part month shows.
    await db.asUser(HR, (svc, u) => svc.applyStaffMovement(u, m.id));
    await assert.rejects(submit(oldRun.id), /Recalculate/);
    const again = await prepare(fromCompany);
    if (today() !== `${period()}-01`) assert.equal((await linesFor(again.id, personId))[0].partMonth.to, dayAfter(today(), -1));
    await enterPartPay(again.id);
    await submit(again.id);

    // A second movement approved after that month was submitted is not applied: it waits with the reason.
    const ex = await transfer('u-it-ex4', 'SASA-PG-912', dayAfter(today(), 15));
    await admin(`UPDATE prima.staff_movements SET data = jsonb_set(data, '{effectiveOn}', to_jsonb($2::text)) WHERE id = $1`, [ex.m.id, today()]);
    assert.equal(ex.fromCompany, fromCompany);
    {
      const r = await db.asUser(HR, (svc, u) => svc.applyDueStaffMovements(u));
      assert.deepEqual(r.failed.map((f) => f.id), [ex.m.id]);
      assert.match(r.failed[0].message, /already submitted/);
      const row = (await admin<{ data: any }>(`SELECT data FROM prima.staff_movements WHERE id = $1`, [ex.m.id]))[0].data;
      assert.equal(row.status, 'approved');
      assert.equal((await admin(`SELECT 1 FROM prima.people WHERE data->'movedFrom'->>'movementId' = $1`, [ex.m.id])).length, 0);
    }
  });
});
