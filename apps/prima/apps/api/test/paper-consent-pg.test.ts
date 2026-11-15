// Part N18 on PostgreSQL (Fitri package, 14 Nov 2026): the paper consent gate works for the person under the database
// walls: the guard reads only the switch and their own company's gate lines, never the consent register; only the
// PDPA wall writes. Synthetic data only.
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

describe('N18 paper consent gate (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('gate off before the module; after it the guard is blocked until the PDPA officer records the paper consent', async () => {
    const guard = 'u-guard-sasa-1';
    const pid = (await admin(`SELECT data->>'personId' AS p FROM prima.users WHERE id = $1`, [guard])).rows[0].p as string;
    assert.equal(await db.asUser(guard, (svc, u) => svc.paperConsent.allowed(u.personId, 'face'), () => NOW), true);
    for (const m of ['pdpa-register-v1', 'paper-consent-v1']) await admin(readFileSync(resolve(__dirname, `../../../../db/modules/${m}.sql`), 'utf8'));
    await assert.rejects(db.asUser('u-cm-sasa', (svc, u) => svc.paperConsent.setGate(u, true, 'Synthetic'), () => NOW), /PDPA officer|Chief of Staff/);
    await db.asUser('u-pdpa', (svc, u) => svc.paperConsent.setGate(u, true, 'Paper round started (synthetic)'), () => NOW);
    assert.equal(await db.asUser(guard, (svc, u) => svc.paperConsent.allowed(u.personId, 'face'), () => NOW), false);
    const [c] = await db.asUser('u-pdpa', (svc, u) => svc.paperConsent.record(u, { personId: pid, scope: 'face', signedOn: '2026-11-14', paperRef: 'PDPA/SYN/PG1' }), () => NOW);
    assert.equal(await db.asUser(guard, (svc, u) => svc.paperConsent.allowed(u.personId, 'face'), () => NOW), true);
    assert.equal(await db.asUser(guard, (svc, u) => svc.paperConsent.allowed(u.personId, 'location'), () => NOW), false);
    // The guard never reads the consent register itself, and cannot write a gate line.
    const seen = (await db.asUser(guard, (svc) => (svc as any).store.list('pdpaConsents', {}), () => NOW).catch(() => [])) as unknown[];
    assert.equal(seen.length, 0);
    await assert.rejects(
      db.asUser(guard, (svc) => (svc as any).store.insert('consentGates', { id: `${pid}.location`, personId: pid, companyId: 'co-sasa', scope: 'location', on: true, consentId: null, by: 'x', at: NOW }), () => NOW),
      /row-level security|permission denied/,
    );
    await db.asUser('u-pdpa', (svc, u) => svc.withdrawPdpaConsent(u, c.id, '2026-11-14', 'Letter received (synthetic)'), () => NOW);
    assert.equal(await db.asUser(guard, (svc, u) => svc.paperConsent.allowed(u.personId, 'face'), () => NOW), false);
  });
});
