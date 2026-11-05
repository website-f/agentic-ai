// Company office desks against a real local PostgreSQL (Fauzan, 2 Nov 2026): the desk split is company data behind the
// company wall, only the company's head writes it, and two saves at once go one after the other. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

async function asApp(companyIds: string, sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true)`, [companyIds]);
    const res = await c.query(sql, params);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

describe('company office desks in PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('saves the head’s split behind the company wall', async () => {
    const r = await db.asUser('u-cm-arsh', (svc, u) =>
      svc.setOfficeDesks(u, 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-ae-arsh', backupUserId: 'u-ae-arsh-2' }], note: 'Synthetic test' }),
    );
    assert.equal(r.changed, 1);
    assert.equal((await asApp('co-arsh', "SELECT 1 FROM prima.company_desks WHERE company_id = 'co-arsh'")).rowCount, 1);
    // Another company's transaction cannot read or write Arrow Shield's desks.
    assert.equal((await asApp('co-inas', "SELECT 1 FROM prima.company_desks WHERE company_id = 'co-arsh'")).rowCount, 0);
    await assert.rejects(
      asApp('co-inas', "INSERT INTO prima.company_desks (id, company_id, data) VALUES ('desk-co-arsh-cases', 'co-arsh', $1)", [
        { id: 'desk-co-arsh-cases', companyId: 'co-arsh', desk: 'cases' },
      ]),
      /row-level security/,
    );
    const o = await db.asUser('u-cm-arsh', (svc, u) => svc.companyOffice(u, 'co-arsh'));
    assert.equal(o.desks.find((d) => d.desk === 'people')?.actingUserId, 'u-ae-arsh');
  });

  it('refuses an executive and another company’s head through the API path', async () => {
    const desks = [{ desk: 'cases', ownerUserId: 'u-ae-arsh' }];
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.setOfficeDesks(u, 'co-arsh', { desks })), /Not allowed/);
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.setOfficeDesks(u, 'co-arsh', { desks })), /Not allowed/);
  });

  it('serializes two saves of the first split so neither is lost', async () => {
    const save = (owner: string, backup: string) =>
      db.asUser('u-gm-sasa', (svc, u) => svc.setOfficeDesks(u, 'co-sasa', { desks: [{ desk: 'tenders', ownerUserId: owner, backupUserId: backup }] }));
    const results = await Promise.allSettled([save('u-ae-sasa', 'u-ae-sasa-2'), save('u-ae-sasa-2', 'u-ae-sasa-3')]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 2);
    const rows = await asApp('co-sasa', "SELECT data FROM prima.company_desks WHERE id = 'desk-co-sasa-tenders'");
    assert.equal(rows.rowCount, 1);
    const audit = await asApp('co-sasa', "SELECT data FROM prima.audit WHERE data->>'action' = 'office.desks' AND data->>'companyId' = 'co-sasa'");
    assert.equal(audit.rowCount, 2);
  });

  it('without the module applied, Home and the office still open and saving is refused', async () => {
    const owner = new Client({ connectionString: URL });
    await owner.connect();
    try {
      await owner.query('DROP TABLE prima.company_desks');
    } finally {
      await owner.end();
    }
    const o = await db.asUser('u-cm-arsh', (svc, u) => svc.companyOffice(u, 'co-arsh'));
    assert.equal(o.ready, false);
    assert.equal(o.canAssign, false);
    assert.ok(o.desks.every((d) => d.state === 'unassigned'));
    const home = await db.asUser('u-cm-arsh', (svc, u) => svc.home(u, 'co-arsh'));
    assert.ok(home.todo.some((t) => t.tag === 'Office'));
    await assert.rejects(
      db.asUser('u-cm-arsh', (svc, u) => svc.setOfficeDesks(u, 'co-arsh', { desks: [{ desk: 'people', ownerUserId: 'u-ae-arsh' }] })),
      /not switched on yet/,
    );
  });
});
