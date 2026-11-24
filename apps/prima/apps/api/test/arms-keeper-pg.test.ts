// Vault keepers on PostgreSQL (Fauzan, 23 Nov 2026, Arms Control check B1): db/modules/arms-keeper-v1.sql. An admin
// executive holds no arms wall; once named a vault's Amra (or put on its written authorised list) they read and write
// that vault's rows only. Other vaults, other companies and other admin executives stay closed. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import { demoPin, myt } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;
const NOW = myt('2026-11-18', '10:00');

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

describe('Vault keepers (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
    await admin(mod('special-ops-v1.sql'));
    await admin(mod('arms-keeper-v1.sql'));
    // Repeat-safe.
    await admin(mod('arms-keeper-v1.sql'));
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('the Amra reads and counts only their own vault; nobody else gains anything', async () => {
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn as never, () => NOW) as Promise<T>;
    const vaultsSeen = async (uid: string) => ((await as(uid, (svc) => svc.store.list('vaults', {}))) as { id: string }[]).map((v) => v.id).sort();
    const firearmsSeen = async (uid: string) => (await as(uid, (svc) => svc.store.list('firearms', {}))) as { id: string; vaultId: string; status: string }[];
    const vaults = (await admin(`SELECT id FROM prima.vaults WHERE company_id='co-sasa' ORDER BY id`)).rows.map((r) => r.id as string);
    assert.ok(vaults.length >= 2, 'two Sasa vaults in the mock data');
    const [mine, other] = vaults;
    const ae = (await admin(`SELECT data->>'personId' AS p FROM prima.users WHERE id='u-ae-sasa'`)).rows[0].p as string;
    assert.ok(ae);

    // Before being named: nothing.
    assert.deepEqual(await vaultsSeen('u-ae-sasa'), []);
    assert.equal((await firearmsSeen('u-ae-sasa')).length, 0);

    await admin(`UPDATE prima.vaults SET data = jsonb_set(data, '{custodianPersonId}', to_jsonb($2::text)) WHERE id=$1`, [mine, ae]);
    assert.deepEqual(await vaultsSeen('u-ae-sasa'), [mine]);
    const fs = await firearmsSeen('u-ae-sasa');
    assert.ok(fs.length > 0 && fs.every((f) => f.vaultId === mine));
    // Another admin executive of the same company, and another company's, see nothing.
    assert.deepEqual(await vaultsSeen('u-ae-sasa-2'), []);
    assert.deepEqual(await vaultsSeen('u-ae-inas'), []);
    // The company manager keeps every vault through the arms wall, as before.
    assert.ok((await vaultsSeen('u-cm-sasa')).includes(other));

    // The count at the Amra's vault saves (vault and case rows); another vault is refused by the service.
    const witness = (await admin(`SELECT data->>'staffNo' AS s FROM prima.people WHERE company_id='co-sasa' AND data->>'status'='active' AND data ? 'pinHash' AND id <> $1 ORDER BY id LIMIT 1`, [ae])).rows[0].s as string;
    const expected = fs.filter((f) => f.status === 'IN_VAULT').length;
    const r = (await as('u-ae-sasa', (svc, u) => svc.countVault(u, mine, { counted: expected, witness: { staffNo: witness, pin: demoPin(witness) } }))) as { ok: boolean };
    assert.equal(r.ok, true);
    await assert.rejects(as('u-ae-sasa', (svc, u) => svc.countVault(u, other, { counted: 0, witness: { staffNo: witness, pin: demoPin(witness) } })));

    // Removing the Amra closes it again.
    await admin(`UPDATE prima.vaults SET data = data - 'custodianPersonId' WHERE id=$1`, [mine]);
    assert.deepEqual(await vaultsSeen('u-ae-sasa'), []);
    // A written authorisation (not removed) opens it; a removed one does not.
    await admin(`UPDATE prima.vaults SET data = jsonb_set(data, '{authorisedStaff}', $2::jsonb) WHERE id=$1`, [mine, JSON.stringify([{ personId: ae, name: 'x', letterRef: 'L', letterOn: '2026-11-18', givenBy: 'CM', givenById: 'u-cm-sasa', reason: 'r', removedOn: null }])]);
    assert.deepEqual(await vaultsSeen('u-ae-sasa'), [mine]);
    await admin(`UPDATE prima.vaults SET data = jsonb_set(data, '{authorisedStaff,0,removedOn}', '"2026-11-18"') WHERE id=$1`, [mine]);
    assert.deepEqual(await vaultsSeen('u-ae-sasa'), []);
  });
});
