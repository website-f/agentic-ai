import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

// Staff movement on PostgreSQL with row level security (synthetic data; Fauzan, 3 Nov 2026).
describe('staff movement under PostgreSQL walls', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    // The synthetic data may hold this month already submitted; a movement would then rightly wait for it to be returned
    // (covered in hr-transfer-payroll-pg.test.ts). Here the months start as drafts.
    await admin(`UPDATE prima.staff_pay_runs SET data = jsonb_set(data, '{stage}', '"draft"') WHERE data->>'period' = $1`, [nowMyt().slice(0, 7)]);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const today = () => nowMyt().slice(0, 10);
  const dayAfter = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  /** The day a movement takes effect arrives: the test moves its date to today instead of waiting (the server clock is real). */
  const arrive = (id: string) => admin(`UPDATE prima.staff_movements SET data = jsonb_set(data, '{effectiveOn}', to_jsonb($2::text)) WHERE id = $1`, [id, today()]);
  const person = async (id: string) => (await admin<{ company_id: string; data: Record<string, any> }>(`SELECT company_id, data FROM prima.people WHERE id = $1`, [id]))[0];
  const movement = async (id: string) => (await admin<{ data: Record<string, any> }>(`SELECT data FROM prima.staff_movements WHERE id = $1`, [id]))[0].data;
  const transfer = async (uid: string, staffNo: string, effectiveOn: string) => {
    const personId = await db.asUser(uid, async (_svc, u) => u.personId!);
    const branchId = (await admin<{ id: string }>(`SELECT id FROM prima.branches WHERE company_id = 'co-sasa' LIMIT 1`))[0].id;
    const m = await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.prepareStaffMovement(u, { personId, kind: 'transfer', toCompanyId: 'co-sasa', effectiveOn, reason: 'Diminta Sasa (synthetic)', branchId, staffNo }),
    );
    return { personId, m };
  };

  it('future transfer: approved by the Sasa head and the HR Director (CEO standing in), nothing changes until the date, then applies once under replay', async () => {
    const { personId, m } = await transfer('u-it-ex2', 'SASA-PG-900', dayAfter(today(), 28));
    // The receiving head reads it through the receiving policy; another company's head does not.
    const sasa = await db.asUser('u-cm-sasa', (svc, u) => svc.staffMovements(u));
    assert.ok(sasa.rows.some((r) => r.id === m.id && r.canAct));
    const inas = await db.asUser('u-cm-inas', (svc, u) => svc.staffMovements(u));
    assert.equal(inas.rows.some((r) => r.id === m.id), false);
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Bukan saya (synthetic)')));
    await db.asUser('u-cm-sasa', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Kami terima (synthetic)'));
    const approved = await db.asUser('u-fauzan', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Untuk Pengarah HR (synthetic)'));
    assert.equal(approved.status, 'approved');
    assert.equal(approved.steps[1].standIn, true);
    // Before the date: the old employment is untouched and no new one exists.
    const before = await person(personId);
    assert.equal(before.data.status, 'active');
    assert.equal(before.data.leaving ?? null, null);
    assert.equal((await admin(`SELECT 1 FROM prima.people WHERE data->'movedFrom'->>'movementId' = $1`, [m.id])).length, 0);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.applyStaffMovement(u, m.id)), /takes effect on/);
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.applyStaffMovement(u, m.id)));
    // The day comes; three applies at once give one new employment.
    await arrive(m.id);
    const runs = await Promise.allSettled([1, 2, 3].map(() => db.asUser('u-pwvsb-hr', (svc, u) => svc.applyStaffMovement(u, m.id))));
    assert.ok(runs.some((r) => r.status === 'fulfilled'));
    const created = await admin<{ id: string }>(`SELECT id FROM prima.people WHERE data->'movedFrom'->>'movementId' = $1`, [m.id]);
    assert.equal(created.length, 1);
    const again = await db.asUser('u-pwvsb-hr', (svc, u) => svc.applyStaffMovement(u, m.id));
    assert.equal(again.status, 'done');
    assert.equal(again.result!.newPersonId, created[0].id);
    const old = await person(personId);
    const moved = await person(created[0].id);
    assert.equal(moved.company_id, 'co-sasa');
    assert.deepEqual([moved.data.staffNo, moved.data.hiredOn, moved.data.status, moved.data.groupJoinedOn], ['SASA-PG-900', today(), 'active', old.data.hiredOn]);
    // No overlap: the old employment ended the day before and is closed.
    assert.deepEqual([old.data.status, old.data.leaving.kind, old.data.leaving.lastDayOn], ['left', 'transferred', dayAfter(today(), -1)]);
    // The full IC follows behind the HR wall; it is never on the person row.
    const ids = await admin<{ n: number }>(`SELECT count(*)::int AS n FROM prima.staff_ids WHERE id = $1`, [created[0].id]);
    assert.equal(ids[0].n, (await admin<{ n: number }>(`SELECT count(*)::int AS n FROM prima.staff_ids WHERE id = $1`, [personId]))[0].n);
    assert.equal(moved.data.idFull ?? null, null);
  });

  it('current promotion: the last approval on the effective date applies it at once with a verified pay change', async () => {
    const personId = await db.asUser('u-it-ex4', async (_svc, u) => u.personId!);
    const m = await db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareStaffMovement(u, { personId, kind: 'promotion', toCompanyId: null, effectiveOn: today(), reason: 'Naik pangkat (synthetic)', jobTitle: 'Senior IT Executive (PG)', basicPay: 6333 }));
    // Pilot: the CEO stands in for the HR Director and the Vice Chairman and approves as CEO, each step labelled.
    for (const note of ['Untuk Pengarah HR (synthetic)', 'Sebagai CEO (synthetic)', 'Untuk Naib Pengerusi (synthetic)'])
      await db.asUser('u-fauzan', (svc, u) => svc.staffMovementStep(u, m.id, true, note));
    const done = await movement(m.id);
    assert.equal(done.status, 'done');
    const p = await person(personId);
    assert.deepEqual([p.data.jobTitle, p.data.basicPay], ['Senior IT Executive (PG)', 6333]);
    const [pay] = await admin<{ data: Record<string, any> }>(`SELECT data FROM prima.pay_changes WHERE id = $1`, [`pay-${m.id}`]);
    assert.equal(pay.data.status, 'verified');
  });

  it('a failed apply is recorded and the movement stays approved; the retry applies it; a corrected movement replaces a cancelled one', async () => {
    const { personId, m } = await transfer('u-it-ex3', 'SASA-PG-901', dayAfter(today(), 14));
    await db.asUser('u-cm-sasa', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Kami terima (synthetic)'));
    await db.asUser('u-fauzan', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Untuk Pengarah HR (synthetic)'));
    // Corrected: a second movement with the wrong date is refused while this one is approved; HR cancels and prepares again.
    await assert.rejects(transfer('u-it-ex3', 'SASA-PG-902', dayAfter(today(), 20)), /waiting or approved/);
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.cancelStaffMovement(u, m.id, 'Tarikh salah (synthetic)'));
    assert.equal((await movement(m.id)).status, 'cancelled');
    const fixed = (await transfer('u-it-ex3', 'SASA-PG-901', dayAfter(today(), 7))).m;
    await db.asUser('u-cm-sasa', (svc, u) => svc.staffMovementStep(u, fixed.id, true, 'Kami terima (synthetic)'));
    await db.asUser('u-fauzan', (svc, u) => svc.staffMovementStep(u, fixed.id, true, 'Untuk Pengarah HR (synthetic)'));
    // Failure: the staff number is taken at Sasa before the day (a synthetic clash keyed directly).
    await admin(
      `INSERT INTO prima.people (id, company_id, data) SELECT 'pr-clash-pg', company_id, jsonb_set(jsonb_set(data, '{id}', '"pr-clash-pg"'), '{staffNo}', '"SASA-PG-901"') FROM prima.people WHERE company_id = 'co-sasa' LIMIT 1`,
    );
    await arrive(fixed.id);
    await arrive(m.id);
    const r1 = await db.asUser('u-pwvsb-hr', (svc, u) => svc.applyDueStaffMovements(u));
    assert.deepEqual(r1.applied, []);
    assert.deepEqual(r1.failed.map((f) => f.id), [fixed.id]);
    const failed = await movement(fixed.id);
    assert.equal(failed.status, 'approved');
    assert.match(failed.applyError.message, /SASA-PG-901/);
    assert.equal((await person(personId)).data.status, 'active');
    assert.equal((await admin(`SELECT 1 FROM prima.people WHERE data->'movedFrom'->>'movementId' = $1`, [fixed.id])).length, 0);
    // Cleared, then retried: applied once; the cancelled movement never applies.
    await admin(`DELETE FROM prima.people WHERE id = 'pr-clash-pg'`);
    const r2 = await db.asUser('u-pwvsb-hr', (svc, u) => svc.applyDueStaffMovements(u));
    assert.deepEqual(r2.applied, [fixed.id]);
    const ok = await movement(fixed.id);
    assert.deepEqual([ok.status, ok.applyError ?? null], ['done', null]);
    assert.equal((await movement(m.id)).status, 'cancelled');
    assert.equal((await admin(`SELECT 1 FROM prima.people WHERE data->'movedFrom'->>'movementId' = $1`, [m.id])).length, 0);
  });

  it('refuses a movement step from the person moved and from the preparer', async () => {
    const personId = await db.asUser('u-it-ex1', async (_svc, u) => u.personId!);
    const m = await db.asUser('u-pwvsb-hr', (svc, u) => svc.prepareStaffMovement(u, { personId, kind: 'promotion', toCompanyId: null, effectiveOn: '2026-12-01', reason: 'Naik pangkat (synthetic)', jobTitle: 'Senior IT Executive' }));
    await assert.rejects(db.asUser('u-it-ex1', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Saya setuju (synthetic)')));
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.staffMovementStep(u, m.id, true, 'Saya setuju (synthetic)')));
  });
});
