import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
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

// P111 (Fitri, 17 Nov 2026): HR's bulk "Change designation" calls this once per person, on PostgreSQL with row level
// security (synthetic data). "Change company" uses the existing transfer movement, covered in hr-movement-pg.test.ts.
describe('change job title under PostgreSQL walls', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  const jobTitle = async (id: string) => (await admin<{ t: string | null }>(`SELECT data->>'jobTitle' AS t FROM prima.people WHERE id = $1`, [id]))[0].t;
  const audits = async (id: string) => admin<{ data: Record<string, any> }>(`SELECT data FROM prima.audit WHERE data->>'action' = 'hr.job_title_change' AND data->>'entityId' = $1`, [id]);

  it('HR changes it with a reason, written once with an audit line', async () => {
    const personId = await db.asUser('u-it-ex2', async (_svc, u) => u.personId!);
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.changeStaffJobTitle(u, personId, { jobTitle: 'IT Executive (PG P111)', reason: 'Carta organisasi baharu (synthetic)' }));
    assert.equal(await jobTitle(personId), 'IT Executive (PG P111)');
    const rows = await audits(personId);
    assert.equal(rows.length, 1);
    assert.match(rows[0].data.summary, /Carta organisasi baharu \(synthetic\)/);
    // The same title again is refused, and nothing more is logged.
    await assert.rejects(
      db.asUser('u-pwvsb-hr', (svc, u) => svc.changeStaffJobTitle(u, personId, { jobTitle: 'IT Executive (PG P111)', reason: 'Lagi sekali (synthetic)' })),
      /already their job title/,
    );
    assert.equal((await audits(personId)).length, 1);
  });

  it('refuses people outside HR: a company manager, the IT staff member themself, and Finance', async () => {
    const personId = await db.asUser('u-it-ex3', async (_svc, u) => u.personId!);
    const before = await jobTitle(personId);
    const finance = (await admin<{ id: string }>(`SELECT id FROM prima.users WHERE data->>'department' = 'finance' AND (data->>'integration') IS NULL LIMIT 1`))[0]?.id;
    for (const uid of ['u-cm-sasa', 'u-it-ex3', ...(finance ? [finance] : [])])
      await assert.rejects(db.asUser(uid, (svc, u) => svc.changeStaffJobTitle(u, personId, { jobTitle: 'Manager (PG P111)', reason: 'Bukan HR (synthetic)' })));
    assert.equal(await jobTitle(personId), before);
    assert.equal((await audits(personId)).length, 0);
  });

  it('refuses a short reason and a person with a staff movement waiting', async () => {
    const personId = await db.asUser('u-it-ex4', async (_svc, u) => u.personId!);
    const before = await jobTitle(personId);
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.changeStaffJobTitle(u, personId, { jobTitle: 'Lead (PG P111)', reason: 'abc' })), /reason/);
    await db.asUser('u-pwvsb-hr', (svc, u) =>
      svc.prepareStaffMovement(u, { personId, kind: 'promotion', toCompanyId: null, effectiveOn: '2026-12-31', reason: 'Naik pangkat (synthetic)', jobTitle: 'IT Lead (PG)' }),
    );
    await assert.rejects(
      db.asUser('u-pwvsb-hr', (svc, u) => svc.changeStaffJobTitle(u, personId, { jobTitle: 'Lead (PG P111)', reason: 'Carta organisasi (synthetic)' })),
      /movement waiting or approved/,
    );
    assert.equal(await jobTitle(personId), before);
  });
});
