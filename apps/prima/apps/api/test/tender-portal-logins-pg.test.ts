// Tender portal logins on PostgreSQL (Marketing item AH10): under the shared login list's own row rule, a Tender
// Executive reads the company's tender login only once IT names them on it. Synthetic data only, no password.
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

describe('Tender portal logins (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    for (const m of ['accounts-access-v1.sql', 'shared-logins-v1.sql']) await admin(readFileSync(resolve(__dirname, '../../../../db/modules', m), 'utf8'));
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('shows the tender login on the bid only to an executive named on it', async () => {
    const exec = (await admin(`SELECT g.data->>'userId' AS id FROM prima.grants g JOIN prima.users u ON u.id = g.data->>'userId' WHERE g.data->>'companyId' = 'co-sasa' AND u.data->>'marketingRole' = 'executive' LIMIT 1`)).rows[0].id as string;
    const tenderId = (await admin(`SELECT id FROM prima.tenders WHERE company_id = 'co-sasa' LIMIT 1`)).rows[0].id as string;
    await admin(`UPDATE prima.tenders SET data = data || '{"desk":"MARKETING","status":"preparing"}'::jsonb WHERE id = $1`, [tenderId]);
    const login = { system: 'ePerolehan (synthetic)', kind: 'eperolehan', url: 'https://eperolehan.example.test/login', companyId: 'co-sasa', place: 'vault', ownerId: 'u-cm-sasa', backupId: 'u-ae-sasa', userIds: [] as string[], lastChanged: '2026-11-01' };
    const saved = await db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.save(u, login), () => NOW);
    const see = () => db.asUser(exec, (svc, u) => svc.tenderPortalLogins(u, tenderId), () => NOW);
    assert.deepEqual((await see()).logins, []);
    const board = await db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.board(u), () => NOW);
    assert.ok(board.coverage.find((c) => c.key === 'c:co-sasa')!.tenderStaffNotNamed.length > 0);
    await db.asUser('u-it-lead', (svc, u) => svc.sharedLogins.save(u, { ...login, id: saved.id, userIds: [exec] }), () => NOW);
    const got = await see();
    assert.equal(got.logins.length, 1);
    assert.equal(got.logins[0].named, true);
    assert.equal(got.logins[0].placeLabel, 'Password vault');
  });
});
