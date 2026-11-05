// Special Operations Phase 4, slice 4A (Fauzan, 2 Nov 2026), proved in the database itself: the arms wall on top of the
// company wall, the walls on arms suppliers and the CMS roster, the forms that could not save before, and the
// shared rollout switch (special_ops). Uses the same throwaway local database as rls.test.ts and resets it. Mock data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from 'pg';
import type { User } from '@prima/core';
import { pilotAdmits } from '../src/auth';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { installSpecialOpsModule } from './special-ops-module';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

/** One statement as the API's runtime role, with the given companies and walls set for the transaction. */
async function asApp(companyIds: string, walls: string, sql: string) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query(`SELECT set_config('app.company_ids', $1, true)`, [companyIds]);
    await c.query(`SELECT set_config('app.walls', $1, true)`, [walls]);
    const res = await c.query(sql);
    await c.query('COMMIT');
    return res;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

const count = async (companyIds: string, walls: string, table: string) =>
  Number((await asApp(companyIds, walls, `SELECT count(*) AS n FROM prima.${table}`)).rows[0].n);

const ARMS_TABLES = ['vaults', 'firearms', 'arms_movements', 'armed_jobs', 'dealer_licences', 'vault_watches', 'vault_events', 'ammo_stocks', 'arms_agreements', 'arms_requests'];

describe('Special Ops walls (database)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    await installSpecialOpsModule(URL);
    // Repeat-safe: installing twice changes nothing.
    await installSpecialOpsModule(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('shows no arms row to a sign-in with the company but without the arms wall', async () => {
    const all = 'co-sasa,co-arsh,co-inas';
    for (const t of ARMS_TABLES) {
      assert.equal(await count(all, 'asset_read,act,pdpa,bcm,offboard,cms', t), 0, `${t} leaked without the arms wall`);
    }
    assert.ok((await count(all, 'arms', 'firearms')) > 0);
    // The arms wall never opens another company: the company wall still applies.
    assert.equal(await count('', 'arms', 'firearms'), 0);
  });

  it('refuses to write an arms row without the arms wall', async () => {
    await assert.rejects(
      asApp('co-sasa', '', `UPDATE prima.firearms SET data = data || '{"status":"LOST"}' WHERE company_id = 'co-sasa' RETURNING id`).then((r) => {
        if (r.rowCount === 0) throw new Error('no row visible');
      }),
    );
  });

  it('keeps arms suppliers, their price list, the CMS roster and CMS staff behind their walls', async () => {
    for (const t of ['arms_suppliers', 'supplier_items']) {
      assert.equal(await count('', 'cms', t), 0);
      assert.ok((await count('', 'arms', t)) > 0);
    }
    for (const t of ['cms_staff', 'cms_shifts']) {
      assert.equal(await count('', 'arms', t), 0);
      assert.ok((await count('', 'cms', t)) > 0);
    }
  });

  it('gives the Finance Director and the Chief of Staff no arms rows even with company grants', async () => {
    const fd = await db.asUser('u-fd', async (_svc, _u, store) => store.list('firearms'));
    assert.equal(fd.length, 0);
    const cos = await db.asUser('u-cos', (svc, user) => svc.insurance(user));
    assert.equal(cos.armedCoverOnArmsBoard, true);
    const coo = await db.asUser('u-coo', async (_svc, _u, store) => store.list('firearms'));
    assert.ok(coo.length > 0);
  });

  it('lets Arms Control save a supplier, a price list item and a CMS staff member (read-only before slice 4A)', async () => {
    const sup = await db.asUser('u-pwvsb-arms', (svc, user) =>
      svc.saveRecord(user, 'armsSupplier', null, null, { name: 'Test Arms Supply Sdn Bhd', supplies: 'Ammunition', contact: '03-0000 0000' }),
    );
    const supplierId = (sup as { id: string }).id;
    assert.ok(supplierId);
    const item = await db.asUser('u-pwvsb-arms', (svc, user) =>
      svc.saveRecord(user, 'supplierItem', null, null, { supplierId, category: 'Ammunition', name: 'Test round', unit: 'box', unitPrice: 100 }),
    );
    assert.ok((item as { id: string }).id);
    const staff = await db.asUser('u-pwvsb-arms', (svc, user) =>
      svc.saveRecord(user, 'cmsStaff', null, null, { name: 'Test Monitor Officer', post: 'MONITOR_OFFICER', ext: '9999' }),
    );
    assert.ok((staff as { id: string }).id);
  });

  it('admits Arms Control, CMS and Transport only when the special_ops rollout is started', async () => {
    const users = (await db.pool.query(`SELECT data FROM prima.users`)).rows.map((r) => r.data as User);
    const u = (id: string) => users.find((x) => x.id === id)!;
    for (const id of ['u-pwvsb-arms', 'u-cms-head', 'u-transport']) {
      assert.equal(pilotAdmits(u(id), {}), false, `${id} let in with the switch off`);
      assert.equal(pilotAdmits(u(id), { PRIMA_ROLLOUTS: 'special_ops' }), true, `${id} refused with the rollout on`);
      // The older flag still works through the shared switch.
      assert.equal(pilotAdmits(u(id), { SPECIAL_OPS_ROLLOUT: 'true' }), true, `${id} refused with the legacy flag`);
    }
    for (const id of ['u-cos', 'u-pdpa', 'u-cm-sasa', 'u-ae-arsh']) assert.equal(pilotAdmits(u(id), { PRIMA_ROLLOUTS: 'special_ops' }), false, `${id} let in`);
    // The IT pilot is unchanged.
    for (const id of ['u-it-ex1', 'u-coo', 'u-fauzan', 'u-fd']) assert.equal(pilotAdmits(u(id), {}), true);
  });
});
