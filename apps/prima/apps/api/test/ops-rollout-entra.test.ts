// Microsoft sign-in for the Government and Private Operations rollouts, on PostgreSQL. Synthetic seeded users only.
// Arisha main's review of the combined build (3 Nov 2026): Gov Ops staff could not sign in because #54 had no rollout.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, inPilot, type User } from '@prima/core';
import { userForEntra } from '../src/auth';
import { Db } from '../src/db';
import { linkEntra } from '../src/entra-link';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('Operations rollouts through Microsoft sign-in (database)', () => {
  let db: Db;
  let users: User[] = [];
  const saved = process.env.PRIMA_ROLLOUTS;
  before(async () => {
    delete process.env.PRIMA_ROLLOUTS;
    await resetDb(URL);
    db = new Db();
    users = (await db.pool.query<{ data: User }>('SELECT data FROM prima.users ORDER BY id')).rows.map((r) => r.data);
  });
  after(async () => {
    if (saved === undefined) delete process.env.PRIMA_ROLLOUTS;
    else process.env.PRIMA_ROLLOUTS = saved;
    await db.onModuleDestroy();
  });

  let n = 0;
  const link = async (id: string): Promise<string> => {
    const oid = `0f0f0f0f-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const c = await db.pool.connect();
    try {
      await linkEntra(c, id, oid, 'Test');
    } finally {
      c.release();
    }
    return oid;
  };
  const signIn = (oid: string) => userForEntra(db, { oid, tid: 'x' } as never);

  it('the OGM and the store sign in only once gov_ops is started; the Operations Director only with private_ops', async () => {
    assert.equal(RULES.pilot.value.on, true);
    const ids = ['u-ogm', 'u-proc-store1', 'u-opsdir'];
    for (const id of ids) assert.ok(!inPilot(users.find((u) => u.id === id)!), `${id} is not an IT pilot user`);
    const [ogm, store, dir] = await Promise.all(ids.map(link));
    for (const oid of [ogm, store, dir]) await assert.rejects(signIn(oid), /not part of the pilot/);
    process.env.PRIMA_ROLLOUTS = 'gov_ops';
    assert.equal((await signIn(ogm)).id, 'u-ogm');
    assert.equal((await signIn(store)).id, 'u-proc-store1');
    await assert.rejects(signIn(dir), /not part of the pilot/);
    process.env.PRIMA_ROLLOUTS = 'private_ops';
    assert.equal((await signIn(dir)).id, 'u-opsdir');
    await assert.rejects(signIn(ogm), /not part of the pilot/);
    delete process.env.PRIMA_ROLLOUTS;
  });
});
