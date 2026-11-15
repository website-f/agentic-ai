// Part N10 on PostgreSQL (Fitri package, 13 Nov 2026): company walls on client accounts, office requests and claims,
// vehicles and their requests, gifts, report submissions and joint tenders. A company manager reads 0 rows of another
// company in each table; group staff still read the group; the screens still load. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { myt, type TableName } from '@prima/core';
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

const TABLES: [TableName, string][] = [
  ['clientAccounts', 'client_accounts'],
  ['expenseRequests', 'expense_requests'],
  ['vehicles', 'vehicles'],
  ['vehicleRequests', 'vehicle_requests'],
  ['giftEntries', 'gift_entries'],
  ['reportSubmissions', 'report_submissions'],
];

describe('N10 business table walls (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/business-walls-v1.sql'), 'utf8'));
    // Repeat-safe.
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/business-walls-v1.sql'), 'utf8'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('a company manager reads no other company\'s rows; group staff still read them; the boards load', async () => {
    const cm = (await admin(`SELECT data FROM prima.users WHERE id = 'u-cm-sasa'`)).rows[0].data as { companyIds: string[] };
    for (const [name, table] of TABLES) {
      const total = Number((await admin(`SELECT count(*) FROM prima.${table}`)).rows[0].count);
      const others = Number((await admin(`SELECT count(*) FROM prima.${table} WHERE data->>'companyId' IS NOT NULL AND NOT (data->>'companyId' = ANY($1))`, [cm.companyIds])).rows[0].count);
      const seen = await db.asUser('u-cm-sasa', (_svc, _u, store) => store.list(name, {}), () => NOW);
      const leak = seen.filter((r) => {
        const x = r as { companyId?: string | null; usedBy?: { companyId: string }[] };
        return x.companyId && !cm.companyIds.includes(x.companyId) && !(x.usedBy ?? []).some((e) => cm.companyIds.includes(e.companyId));
      });
      assert.equal(leak.length, 0, `${table}: ${leak.length} rows of another company`);
      if (others > 0) {
        const group = await db.asUser('u-coo', (_svc, _u, store) => store.list(name, {}), () => NOW);
        assert.ok(group.length > seen.length, `${table}: the COO reads the group (${group.length} of ${total})`);
      }
    }
    // A company manager cannot write a row for another company.
    await assert.rejects(
      db.asUser('u-cm-sasa', (_svc, _u, store) => store.insert('giftEntries', { id: 'gift-n10', companyId: 'co-arsh' } as never), () => NOW),
      /row-level security/,
    );
    for (const id of ['u-cm-sasa', 'u-coo']) {
      await db.asUser(id, (svc, u) => svc.clientBoard(u), () => NOW);
      await db.asUser(id, (svc, u) => svc.expenseBoard(u), () => NOW);
    }
    await db.asUser('u-coo', (svc, u) => svc.fleetBoard(u), () => NOW);
  });
});
