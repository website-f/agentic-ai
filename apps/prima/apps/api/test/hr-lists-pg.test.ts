// Part N17 on PostgreSQL (Fitri package, 14 Nov 2026): HR lists. Before module hr-lists-v1 the screens say not
// installed; after it only the HR Administrator inserts a version, every signed-in person reads it, and nothing is
// updated or deleted. Synthetic data only.
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
const NOW = myt('2026-11-14', '10:00');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('N17 HR lists (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('HR keys a version in; others read it; a non-HR insert is refused by the database', async () => {
    const input = { from: '2026-01-01', reason: 'Synthetic list', items: [{ name: 'Course A', needed: 'required', byWhen: 'within 1 year' }] };
    await assert.rejects(db.asUser('u-pwvsb-hr', (svc, u) => svc.hrLists.set(u, 'guard_courses', input), () => NOW), /hr-lists-v1/);
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/hr-lists-v1.sql'), 'utf8'));
    await db.asUser('u-pwvsb-hr', (svc, u) => svc.hrLists.set(u, 'guard_courses', input), () => NOW);
    const seen = await db.asUser('u-cm-sasa', (svc) => svc.hrLists.inForce('guard_courses', '2026-11-14'), () => NOW);
    assert.equal(seen.set, true);
    assert.equal(seen.items[0].name, 'Course A');
    await assert.rejects(
      db.asUser('u-cm-sasa', (svc) => (svc as any).store.insert('hrLists', { id: 'hrl-x', kind: 'guard_courses', from: '2026-01-01', items: [], reason: 'x', by: 'x', byId: 'u-cm-sasa', at: NOW }), () => NOW),
      /row-level security|permission denied/,
    );
    await assert.rejects(admin(`SET ROLE prima_app; UPDATE prima.hr_lists SET data = data`), /permission denied/);
  });
});
