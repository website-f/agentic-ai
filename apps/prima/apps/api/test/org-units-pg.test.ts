// Department names and added departments on PostgreSQL (module org-units-v1, office P141, Fitri 27 Nov 2026). Before the
// module the chart shows Prima's own names and changes are refused in words; after it the CEO or the HR Director adds and
// renames departments, and the database refuses a row from anyone else or written as someone else. Synthetic data only.
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
const NOW = myt('2026-11-27', '15:00');

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

describe('Departments added and renamed in the org chart (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('refused before the module; after it the CEO or HR Director adds and renames; forged rows refused', async () => {
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn, () => NOW);
    await admin(mod('org-lines-v1.sql'));
    const c0 = (await as('u-fauzan', (svc, u) => svc.org.chart(u))) as { canEditUnits: boolean; units: { key: string; label: string }[] };
    assert.equal(c0.canEditUnits, false);
    assert.equal(c0.units.find((u) => u.key === 'd_hr')?.label, 'Human Resources');
    await assert.rejects(as('u-fauzan', (svc, u) => svc.org.setUnit(u, { action: 'add', label: 'Corporate Communications' })), /org-units-v1/);

    await admin(mod('org-units-v1.sql'));
    await admin(mod('org-units-v1.sql')); // repeat-safe
    const t = (await admin(`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force, has_table_privilege('prima_app', c.oid, 'DELETE') AS del FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'org_units'`)).rows[0];
    assert.deepEqual(t, { rls: true, force: true, del: false });

    await as('u-fauzan', (svc, u) => svc.org.setUnit(u, { action: 'rename', unit: 'd_hr', label: 'People and Culture' }));
    await as('u-fauzan', (svc, u) => svc.org.setUnit(u, { action: 'rename', unit: 'd_hr', label: 'People Team' }));
    const added = (await as('u-cos', (svc, u) => svc.org.setUnit(u, { action: 'add', label: 'Corporate Communications' }))) as { key: string };
    await as('u-cos', (svc, u) => svc.org.setUnit(u, { action: 'members', unit: added.key, add: ['u-it-ex1'] }));
    await as('u-fauzan', (svc, u) => svc.org.setHead(u, { unit: added.key, headId: 'u-it-mgr', deputyId: null, reason: 'Leads the new team' }));
    const c1 = (await as('u-fauzan', (svc, u) => svc.org.chart(u))) as { canEditUnits: boolean; units: { key: string; label: string; memberIds: string[] | null; heads: { id: string }[] }[] };
    assert.equal(c1.canEditUnits, true);
    assert.equal(c1.units.find((u) => u.key === 'd_hr')?.label, 'People Team');
    const cc = c1.units.find((u) => u.key === added.key)!;
    assert.deepEqual(cc.memberIds, ['u-it-ex1']);
    assert.deepEqual(cc.heads.map((h) => h.id), ['u-it-mgr']);

    // Anyone else is refused by the service, and a forged row by the database.
    await assert.rejects(as('u-it-mgr', (svc, u) => svc.org.setUnit(u, { action: 'add', label: 'Shadow team' })));
    const forge = (uid: string, row: Record<string, unknown>) => as(uid, (svc) => svc.store.insert('orgUnits', row));
    await assert.rejects(forge('u-it-mgr', { id: 'unit-x_shadow', key: 'x_shadow', label: 'Shadow', custom: true, memberIds: [], reason: 'x', by: 'x', byId: 'u-it-mgr', at: NOW }), /row-level security/);
    await assert.rejects(forge('u-it-mgr', { id: 'unit-x_shadow', key: 'x_shadow', label: 'Shadow', custom: true, memberIds: [], reason: 'x', by: 'x', byId: 'u-fauzan', at: NOW }), /row-level security/);
  });
});
