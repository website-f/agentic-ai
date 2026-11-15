// Part N4 on PostgreSQL (Fitri package, 13 Nov 2026): before the module the database refuses a new company even for
// the CEO; after module company-add-v1 only the CEO's draft insert gets through. Synthetic data only.
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

describe('N4 add a company (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('the CEO adds a draft only once the module is installed; nobody else can insert a company', async () => {
    const input = { code: 'SYNPG', name: 'Synthetic PG Guarding Sdn Bhd', ssmNo: '202601001111 (7654321-A)', state: 'Johor', sourceRef: 'SSM profile (mock)', reason: 'Joins the group (mock).' };
    await assert.rejects(db.asUser('u-fauzan', (svc, u) => svc.addCompany(u, input), () => NOW), /company-add-v1/);
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/company-add-v1.sql'), 'utf8'));
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.addCompany(u, input), () => NOW), /only the CEO/);
    const c = await db.asUser('u-fauzan', (svc, u) => svc.addCompany(u, input), () => NOW);
    assert.equal(c.id, 'co-synpg');
    const row = await admin(`SELECT data->>'verificationStatus' AS s FROM prima.companies WHERE id = 'co-synpg'`);
    assert.equal(row.rows[0].s, 'draft');
    // Straight into the table as a company manager: refused by the database wall.
    await assert.rejects(
      db.asUser('u-cm-sasa', (svc) => (svc as any).store.insert('companies', { id: 'co-x', code: 'X', name: 'X', verificationStatus: 'draft', draftById: 'u-cm-sasa' }), () => NOW),
      /row-level security|permission denied/,
    );
  });
});
