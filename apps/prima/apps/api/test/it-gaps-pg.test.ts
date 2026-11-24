// IT department gaps on PostgreSQL (Fauzan, 23 Nov 2026: "Do the gap"). Before module it-gaps-v1 a company manager sees
// no rented devices; after it, prima.it_company_rentals gives only their own company's devices and bills, and nothing to
// anyone else. The IT tables keep their own row rules unchanged. Synthetic data only.
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
const NOW = myt('2026-11-23', '09:00');

async function admin(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}
let db: Db;
const rentals = (id: string) => db.asUser(id, async (svc, u) => (await svc.itBoard(u)).companyRentals, () => NOW);

describe('IT gaps (PostgreSQL)', () => {
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('the IT board still loads for IT and Finance before the optional modules are installed', async () => {
    const b = await db.asUser('u-it-mgr', (svc, u) => svc.itBoard(u), () => NOW);
    assert.equal(b.role, 'manager');
    assert.deepEqual(b.fromHr, []);
    const fin = (await admin(`SELECT id FROM prima.users WHERE data->>'department' = 'finance' AND data ? 'financeTeam' LIMIT 1`)).rows[0].id as string;
    assert.equal((await db.asUser(fin, (svc, u) => svc.itBoard(u), () => NOW)).role, null);
  });

  it('before the module the company manager sees an empty list, never an error', async () => {
    const r = await rentals('u-cm-sasa');
    assert.ok(Array.isArray(r));
    assert.ok(r!.every((c) => c.devices.length === 0 && c.bills.length === 0));
  });

  it('after the module: own company only, and nobody else gets rows from the function', async () => {
    await admin(readFileSync(resolve(__dirname, '../../../../db/modules/it-gaps-v1.sql'), 'utf8'));
    const own = (await admin(`SELECT data->'companyIds'->>0 AS c FROM prima.users WHERE id = 'u-cm-sasa'`)).rows[0].c as string;
    const asset = (await admin(`SELECT id, data FROM prima.it_assets WHERE data->>'status' = 'in_use' LIMIT 2`)).rows;
    await admin(`UPDATE prima.it_assets SET data = jsonb_set(data, '{ownerId}', to_jsonb($2::text)) WHERE id = $1`, [asset[0].id, own]);
    await admin(`UPDATE prima.it_assets SET data = jsonb_set(data, '{ownerId}', '"co-elsewhere"') WHERE id = $1`, [asset[1].id]);
    const r = await rentals('u-cm-sasa');
    const mine = r!.find((c) => c.companyId === own)!;
    assert.ok(mine.devices.some((d) => d.tag === asset[0].data.tag));
    assert.ok(!mine.devices.some((d) => d.tag === asset[1].data.tag));
    // Another company's manager, IT staff and the bare function for a company not held: nothing.
    const other = (await admin(`SELECT id FROM prima.users WHERE data->>'role' = 'company_manager' AND NOT (data->'companyIds' ? $1) LIMIT 1`, [own])).rows[0].id as string;
    const otherRows = await rentals(other);
    assert.ok(!otherRows!.some((c) => c.devices.some((d) => d.tag === asset[0].data.tag)));
    const direct = await db.asUser(other, (svc) => (svc as any).store.companyItRentals(own), () => NOW);
    assert.deepEqual(direct, { companyId: own, devices: [], bills: [] });
    const itView = (await db.asUser('u-it-lead', (svc) => (svc as any).store.companyItRentals(own), () => NOW)) as { devices: unknown[] };
    assert.deepEqual(itView.devices, []);
  });
});
