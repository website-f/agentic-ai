// J7 (Fauzan, 11 Nov 2026): the Settings home on a real local PostgreSQL. A setting whose database part is not installed
// reads "Not installed" without breaking the request, the walls still decide what each person can count, and the wrong
// roles are refused. Synthetic data only; the test resets the throwaway database.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('Settings home (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('reads every setting for the CEO in one request; an uninstalled part is "Not installed" and the request carries on', async () => {
    const out = await db.asUser('u-fauzan', async (svc, u) => {
      const h = await svc.settingsHome(u);
      // The same transaction still works after a read of a missing table.
      const again = await svc.approvalLimits(u);
      return { h, again };
    });
    const by = new Map(out.h.rows.map((r) => [r.id, r]));
    assert.equal(by.get('rates.fwcost')!.state, 'not_installed', 'the recruitment cost module is not installed by resetDb');
    assert.equal(by.get('pay.formulas')!.state === 'not_installed', false, 'resetDb installs the pay formulas module');
    assert.equal(by.get('limits.approval')!.state, 'later');
    assert.ok(out.again);
    for (const r of out.h.rows) assert.ok(!/RM\s?\d/.test(r.detail), `${r.id} shows no amount`);
  });

  it('HR sees the state of its own settings and only the owner of the others', async () => {
    const h = await db.asUser('u-pwvsb-hr', (svc, u) => svc.settingsHome(u));
    const by = new Map(h.rows.map((r) => [r.id, r]));
    assert.notEqual(by.get('pay.allowances')!.state, 'owner_only');
    assert.equal(by.get('rates.it')!.state, 'owner_only');
  });

  it('refuses a guard sign-in and a site device', async () => {
    for (const id of ['u-guard-sasa-1', 'u-dev-sasa-001'])
      await assert.rejects(db.asUser(id, (svc, u) => svc.settingsHome(u)), (e: Error) => /settings|denied|not allowed|cannot/i.test(e.message) || e.name === 'AccessDenied', id);
  });
});
