// Workflow KPIs across departments on PostgreSQL (Fauzan, 5 Nov 2026: start KPI timing now). Read-only: no table,
// column or migration is added; the view reads existing rows through each user's own database walls. Mock data only;
// uses the same throwaway local database as rls.test.ts and resets it.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { workKpiCoveredDepts } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
// Tables this branch's adapters read that live in a separately applied db/modules SQL file: missing after a plain reset.
const MODULE_ONLY = ['tenderOpportunities', 'cleaningDays'];

describe('work KPIs (database)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('gives the CEO every department through the database walls', async () => {
    const r = await db.asUser('u-fauzan', (svc, u) => svc.workKpi(u, '2026-11'));
    assert.equal(r.departments.length, workKpiCoveredDepts().length);
    assert.ok(r.departments.length >= 8);
    assert.deepEqual([...r.notInstalled].sort(), [...MODULE_ONLY].sort());
    assert.equal(r.provisional, false);
  });

  it('keeps a department head to their own department', async () => {
    const r = await db.asUser('u-it-mgr', (svc, u) => svc.workKpi(u));
    assert.deepEqual(r.departments.map((d) => d.dept), ['it']);
  });

  it('refuses an admin executive and an integration sign-in', async () => {
    await assert.rejects(db.asUser('u-ae-arsh', (svc, u) => svc.workKpi(u)), /workflow KPIs/);
    await assert.rejects(db.asUser('u-ja-sync', (svc, u) => svc.workKpi(u)), /workflow KPIs/);
  });

  it('skips a table that is not installed instead of failing the whole screen', async () => {
    const r = await db.asUser('u-fauzan', async (svc, u, store) => {
      assert.equal(await store.hasTable!('itTickets'), true);
      // A module table whose SQL is not applied yet: the store reports it missing.
      const real = store.hasTable!.bind(store);
      (store as { hasTable?: (t: never) => Promise<boolean> }).hasTable = async (t) => (t === ('cases' as never) ? false : real(t));
      return svc.workKpi(u, '2026-11');
    });
    assert.deepEqual([...r.notInstalled].sort(), [...MODULE_ONLY, 'cases'].sort());
    assert.ok(r.departments.some((d) => d.dept === 'operations'));
  });
});

describe('work KPIs once the module is applied (database)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    const { Client } = await import('pg');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const admin = new Client({ connectionString: URL });
    await admin.connect();
    try {
      for (const module of ['tender-opportunities-v1.sql', 'cleaning-ops-v1.sql']) await admin.query(readFileSync(join(__dirname, '../../../../db/modules', module), 'utf8'));
    } finally {
      await admin.end();
    }
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('reads the module tables through the database walls once they exist', async () => {
    const r = await db.asUser('u-fauzan', (svc, u) => svc.workKpi(u, '2026-11'));
    assert.deepEqual(r.notInstalled, []);
  });
});
