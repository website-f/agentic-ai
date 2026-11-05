// Microsoft sign-in and the shared rollout switch, on PostgreSQL. Synthetic seeded users only.
// Review of the combined candidate (3 Nov 2026): a department's own pilot check left in userForEntra refused every
// other department's rollout. This walks every registered rollout through userForEntra itself, so a second gate
// anywhere in sign-in fails here.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, inPilot, registerRollout, registeredRollouts, rolloutAdmits, type User } from '@prima/core';
import { userForEntra } from '../src/auth';
import { Db } from '../src/db';
import { linkEntra } from '../src/entra-link';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

// A rule only this test registers, so the walk below is never empty on a branch with no department rollouts.
const testRule = (u: User) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'finance';
registerRollout('t_entra', 'Sign-in test', testRule);

const ENV_KEYS = ['PRIMA_ROLLOUTS', 'HR_ROLLOUT', 'CENTRAL_ADMIN_ROLLOUT', 'SPECIAL_OPS_ROLLOUT', 'FINANCE_ROLLOUT'];

describe('Microsoft sign-in admits each started rollout and nobody else (database)', () => {
  let db: Db;
  let users: User[] = [];
  const saved: Record<string, string | undefined> = {};
  before(async () => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    await resetDb(URL);
    db = new Db();
    users = (await db.pool.query<{ data: User }>('SELECT data FROM prima.users ORDER BY id')).rows.map((r) => r.data);
  });
  after(async () => {
    for (const k of ENV_KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    await db.onModuleDestroy();
  });

  it('runs with the IT pilot gate on', () => assert.equal(RULES.pilot.value.on, true));

  let n = 0;
  const link = async (u: User): Promise<string> => {
    const oid = `0e0e0e0e-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const c = await db.pool.connect();
    try { await linkEntra(c, u.id, oid, 'Test'); } finally { c.release(); }
    return oid;
  };

  it('every registered rollout: refused while not started, admitted once started, nobody from another rollout', async () => {
    const keys = registeredRollouts().map((r) => r.key);
    assert.ok(keys.includes('t_entra'));
    const checked: string[] = [];
    for (const key of keys) {
      const person = users.find((u) => !u.integration && !inPilot(u) && rolloutAdmits(u, new Set([key])));
      if (!person) continue; // a rule with nobody in the seeded data; the core tests cover the rule itself
      const oid = await link(person);
      delete process.env.PRIMA_ROLLOUTS;
      await assert.rejects(userForEntra(db, { oid, tid: 'x' } as never), /not part of the pilot/, `${key}: not started`);
      process.env.PRIMA_ROLLOUTS = key;
      const got = await userForEntra(db, { oid, tid: 'x' } as never);
      assert.equal(got.id, person.id, `${key}: started`);
      checked.push(key);
      const outsider = users.find((u) => !u.integration && !inPilot(u) && !rolloutAdmits(u, new Set([key])) && !u.accessClosedFrom);
      if (outsider) {
        const o2 = await link(outsider);
        await assert.rejects(userForEntra(db, { oid: o2, tid: 'x' } as never), /not part of the pilot/, `${key}: outsider`);
      }
      delete process.env.PRIMA_ROLLOUTS;
    }
    for (const k of ['t_entra', 'central_admin', 'company_office', 'finance', 'gov_ops', 'hr', 'private_ops', 'special_ops']) assert.ok(checked.includes(k), `${k} signs in once started (combined)`);
    process.env.ROLLOUTS_CHECKED_LOG && console.log(`rollouts checked through sign-in: ${checked.join(', ')}`);
  });
});
