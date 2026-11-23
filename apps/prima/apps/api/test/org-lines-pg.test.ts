// Org chart lines and named unit heads on PostgreSQL (module org-lines-v1, Fauzan 23 Nov 2026). Before the module the
// chart shows the job lines and changes are refused in words; after it a head sets a line in their own line, the
// database refuses a forged row (someone placing themselves, or a head row from anyone but the CEO or HR Director), and
// a named head carries the mark into their own request. Synthetic data only.
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
const NOW = myt('2026-11-23', '10:00');

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

describe('Org chart lines (PostgreSQL)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL, NOW);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('before the module: job lines only, changes refused in words; after it: lines, heads and the database boundaries', async () => {
    const as = <T>(uid: string, fn: (svc: any, u: any) => Promise<T>) => db.asUser(uid, fn, () => NOW);
    const chart0 = (await as('u-fauzan', (svc, u) => svc.org.chart(u))) as { installed: boolean; people: { id: string }[] };
    assert.equal(chart0.installed, false);
    assert.ok(chart0.people.some((p) => p.id === 'u-it-ex1'));
    await assert.rejects(as('u-it-mgr', (svc, u) => svc.org.setLine(u, { userId: 'u-it-ex1', managerId: 'u-it-mgr', reason: 'Test line' })), /org-lines-v1/);

    await admin(mod('org-lines-v1.sql'));
    // Repeat-safe.
    await admin(mod('org-lines-v1.sql'));
    const t = (await admin(`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force, has_table_privilege('prima_app', c.oid, 'DELETE') AS del FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relname = 'org_lines'`)).rows[0];
    assert.deepEqual(t, { rls: true, force: true, del: false });

    await as('u-it-mgr', (svc, u) => svc.org.setLine(u, { userId: 'u-it-ex1', managerId: 'u-it-mgr', reason: 'Leads the roll-out with me' }));
    const team = (await as('u-it-mgr', (svc, u) => svc.teamWork(u))) as { people: { userId?: string; id?: string }[] };
    assert.ok(team.people.some((p) => (p.userId ?? p.id) === 'u-it-ex1'));
    const ex1 = (await as('u-it-ex1', (svc, u) => svc.myWork(u))) as { manager: { id: string } | null };
    assert.equal(ex1.manager?.id, 'u-it-mgr');

    // The database refuses a forged row: placing yourself, writing as someone else, a head row from a non-leader.
    const forge = (uid: string, row: Record<string, unknown>) => as(uid, (svc) => svc.store.insert('orgLines', row));
    await assert.rejects(forge('u-it-ex2', { id: 'line-u-it-ex2', kind: 'line', userId: 'u-it-ex2', managerId: 'u-it-mgr', reason: 'x', by: 'x', byId: 'u-it-ex2', at: NOW }), /row-level security/);
    await assert.rejects(forge('u-it-ex2', { id: 'line-u-it-ex3', kind: 'line', userId: 'u-it-ex3', managerId: 'u-it-ex2', reason: 'x', by: 'x', byId: 'u-it-mgr', at: NOW }), /row-level security/);
    await assert.rejects(forge('u-it-mgr', { id: 'head-d_legal', kind: 'head', unit: 'd_legal', headId: 'u-legal', deputyId: null, reason: 'x', by: 'x', byId: 'u-it-mgr', at: NOW }), /row-level security/);
    await assert.rejects(forge('u-cos', { id: 'head-d_hr', kind: 'head', unit: 'd_hr', headId: 'u-cos', deputyId: null, reason: 'x', by: 'x', byId: 'u-cos', at: NOW }), /row-level security/);

    // Two changes at the same time on two connections (Fauzan's retest, 23 Nov 2026): the chart lock makes them go one
    // after the other, so the second sees the first and is refused as a loop.
    // The first request writes and then stays open for a moment (not committed yet) while the second one starts.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const first = as('u-fauzan', async (svc, u) => {
      await svc.org.setLine(u, { userId: 'u-legal', managerId: 'u-transport', reason: 'Same time A' });
      await held;
    });
    await new Promise((r) => setTimeout(r, 200));
    const second = as('u-cos', (svc, u) => svc.org.setLine(u, { userId: 'u-transport', managerId: 'u-legal', reason: 'Same time B' }));
    setTimeout(release, 300);
    const both = await Promise.allSettled([first, second]);
    assert.deepEqual(both.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    assert.match(String((both.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason), /loop/);
    const loopRows = (await admin(`SELECT id FROM prima.org_lines WHERE id IN ('line-u-legal', 'line-u-transport')`)).rows;
    assert.equal(loopRows.length, 1);
    await admin(`DELETE FROM prima.org_lines WHERE id IN ('line-u-legal', 'line-u-transport')`);

    // The HR Director names the Legal head; the mark rides into the head's own request.
    await as('u-cos', (svc, u) => svc.org.setHead(u, { unit: 'd_legal', headId: 'u-legal', reason: 'Legal Counsel heads Legal' }));
    const headOf = (await as('u-legal', async (_svc, u) => u.headOf)) as string[];
    assert.deepEqual(headOf, ['d_legal']);
    const rows = (await admin(`SELECT id FROM prima.org_lines ORDER BY id`)).rows.map((r) => r.id);
    assert.deepEqual(rows, ['head-d_legal', 'line-u-it-ex1']);
  });
});
