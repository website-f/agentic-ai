/**
 * Item register, both parts (U20): actual FORCE-RLS walls in a disposable localhost PostgreSQL. One company cannot read
 * another company's items even with the label in hand, through the service or by a direct query. Synthetic rows only.
 */
import assert from 'node:assert/strict';
import { before, after, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, type PoolClient } from 'pg';
import { ItemService, generateDataset, labelPayload, myt, type ItemAction, type PhysicalItem, type User } from '@prima/core';
import { PgStore } from '../src/pg-store';
import { migrationSql } from '../src/schema';
import { itemRegisterProblems, itemRegisterV2Problems } from '../src/item-register-readiness';
import { moduleCatalogProblems } from '../src/release-catalog';

const base = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(base).hostname)) throw Error('Disposable localhost database required');
const DB = 'prima_item_rls_test', OWNER = 'prima_item_rls_owner';
const url = new URL(base);
url.pathname = '/' + DB;
url.username = OWNER;
url.password = 'local-test-only';
const NOW = myt('2026-11-06', '10:30');
const ds = generateDataset({ today: '2026-11-06', now: NOW });
const store1 = ds.users.find((x) => x.id === 'u-proc-store1')!;
const arsh = ds.users.find((x) => x.id === 'u-cm-arsh')!;

async function connect(cs = url.toString()) {
  const c = new Client({ connectionString: cs });
  await c.connect();
  return c;
}
const moduleSql = (n: 1 | 2) => readFileSync(resolve(process.cwd(), process.cwd().replace(/\\/g, '/').endsWith('/apps/api') ? `../../db/modules/item-register-v${n}.sql` : `db/modules/item-register-v${n}.sql`), 'utf8');

/** One request as a user: the app role, the user's companies, the group flag and the user id, as the API sets them. */
async function as<T>(user: User, companies: string, group: boolean, fn: (c: Client) => Promise<T>) {
  const c = await connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE prima_app');
    await c.query("SELECT set_config('app.company_ids',$1,true), set_config('app.group_user',$2,true), set_config('app.user_id',$3,true)", [companies, group ? 'on' : 'off', user.id]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}
const svcAct = (user: User, companies: string, group: boolean, rid: string, a: ItemAction) =>
  as(user, companies, group, async (c) => ((await new ItemService(new PgStore(c as unknown as PoolClient), () => NOW, async () => []).act(user, rid, a)) as { result: unknown }).result);

before(async () => {
  const c = await connect(base);
  try {
    await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
    if (!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [OWNER])).rowCount) await c.query(`CREATE ROLE ${OWNER} LOGIN CREATEDB CREATEROLE PASSWORD 'local-test-only'`);
    if ((await c.query("SELECT 1 FROM pg_roles WHERE rolname='prima_app'")).rowCount) await c.query(`GRANT prima_app TO ${OWNER} WITH ADMIN OPTION`);
    await c.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
  } finally {
    await c.end();
  }
  const a = await connect();
  try {
    assert.equal((await a.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
    await a.query(migrationSql());
    await a.query(`GRANT prima_app TO ${OWNER}`);
    assert.equal((await a.query("SELECT to_regclass('prima.item_units') IS NULL AS missing")).rows[0].missing, true, 'base schema stays unchanged');
    // Repeat-safe: each part twice, the second part after the first.
    await a.query(moduleSql(1));
    await a.query(moduleSql(1));
    await a.query(moduleSql(2));
    await a.query(moduleSql(2));
    for (const s of ds.itemSkus) await a.query('INSERT INTO prima.item_skus(id,party_ids,data) VALUES($1,$2,$3)', [s.id, s.partyIds, s]);
  } finally {
    await a.end();
  }
});
after(async () => {
  const c = await connect(base);
  try {
    await c.query(`DROP DATABASE IF EXISTS ${DB} WITH(FORCE)`);
  } finally {
    await c.end();
  }
});

it('both parts pass their catalogue checks and the release catalogue as the app role', async () => {
  await as(store1, 'goodwill', true, async (c) => {
    assert.deepEqual(await itemRegisterProblems(c), []);
    assert.deepEqual(await itemRegisterV2Problems(c), []);
    assert.deepEqual(await moduleCatalogProblems(c, 'item_register_v2'), []);
  });
});

it('U20: a Goodwill unit, printed, scanned back and checked, cannot be read by another company even with its label', async () => {
  const items = (await svcAct(store1, 'goodwill', true, 'rls-register-0001', { kind: 'item.register', skuId: 'sku-shirt-l', partyId: 'goodwill', count: 2 })) as PhysicalItem[];
  const printed = (await svcAct(store1, 'goodwill', true, 'rls-print-0001', { kind: 'label.print', itemIds: items.map((i) => i.id) })) as { labels: { printId: string; payload: string }[] };
  for (const [k, l] of printed.labels.entries()) await svcAct(store1, 'goodwill', true, `rls-verify-000${k}`, { kind: 'label.verify', printId: l.printId, scan: { code: l.payload, source: 'camera' } });
  await svcAct(store1, 'goodwill', true, 'rls-inspect-0001', { kind: 'item.inspect', label: items[0].token, condition: 'new', note: '' });
  // Through the service: unknown and not-visible look the same, and the miss is kept (fingerprint only) in the limiter.
  await as(arsh, 'co-arsh', false, async (c) => {
    const svc = new ItemService(new PgStore(c as unknown as PoolClient), () => NOW, async () => []);
    const v = await svc.scanCheck(arsh, 'view', null, { code: labelPayload(items[0].token, 1), source: 'camera' });
    assert.equal(v.outcome, 'not_found');
    assert.equal(v.itemId, undefined);
    // Directly by the label: no row of any item table, print log or event is visible.
    assert.equal((await c.query("SELECT 1 FROM prima.item_units WHERE data->>'token'=$1", [items[0].token])).rowCount, 0);
    for (const t of ['item_units', 'item_events', 'item_label_prints', 'item_cases']) assert.equal((await c.query(`SELECT 1 FROM prima.${t} WHERE party_ids && ARRAY['goodwill']`)).rowCount, 0, t);
    const lim = (await c.query('SELECT data FROM prima.item_scan_denials')).rows;
    assert.equal(lim.length, 1);
    assert.ok(!JSON.stringify(lim[0].data).includes(items[0].token.slice(3)), 'the limiter keeps fingerprints, never the label');
  });
  // The limiter of one person is invisible to everyone else, including the item's own store.
  await as(store1, 'goodwill', true, async (c) => {
    assert.equal((await c.query('SELECT 1 FROM prima.item_scan_denials')).rowCount, 0);
    assert.equal((await c.query('SELECT 1 FROM prima.item_label_prints')).rowCount, 2);
    const u = (await c.query("SELECT data FROM prima.item_units WHERE id=$1", [items[0].id])).rows[0].data;
    assert.equal(u.state, 'available');
    assert.equal(u.labelGen, 1);
  });
});

it('the SQL book, export files and SQL exports stay behind their company wall; no DELETE; SQL exports are append-only', async () => {
  const book = { id: 'goodwill', partyId: 'goodwill', legalName: 'Synthetic', regNo: 'SYN-1', sqlBookId: 'GW-SYN', currency: 'MYR', timeZone: 'Asia/Kuala_Lumpur', channel: 'export_only', counterparties: [], periodLockedThrough: null, setBy: 'x', setById: 'x', setAt: NOW, verified: null, version: 1, partyIds: ['goodwill'] };
  await as(store1, 'goodwill', true, (c) => new PgStore(c as unknown as PoolClient).insert('itemSqlBooks', book as never));
  const snap = { id: 'isnap-1', partyId: 'goodwill', book: 'GW-SYN', kind: 'stock_balance', asOf: '2026-11-06', sha256: 'x', rows: [], by: 'x', byId: 'x', at: NOW, partyIds: ['goodwill'] };
  await as(store1, 'goodwill', true, (c) => new PgStore(c as unknown as PoolClient).insert('itemSqlSnapshots', snap as never));
  await as(arsh, 'co-arsh', false, async (c) => {
    assert.equal((await c.query('SELECT 1 FROM prima.item_sql_books')).rowCount, 0);
    assert.equal((await c.query('SELECT 1 FROM prima.item_sql_snapshots')).rowCount, 0);
    await assert.rejects(c.query("INSERT INTO prima.item_sql_books(id,party_ids,data) VALUES('goodwill',ARRAY['goodwill'],$1)", [book]));
  });
  for (const sql of ["DELETE FROM prima.item_sql_books", "DELETE FROM prima.item_label_prints", "UPDATE prima.item_sql_snapshots SET data=data", "DELETE FROM prima.item_scan_denials"])
    await assert.rejects(as(store1, 'goodwill', true, (c) => c.query(sql)), /permission denied/, sql);
});

it('table checks: export only, a SQL number for every acknowledged document and only once per book, whole sen, laundry state', async () => {
  const bad = (table: string, id: string, parties: string[], data: unknown) => assert.rejects(as(store1, 'goodwill', true, (c) => c.query(`INSERT INTO prima.${table}(id,party_ids,data) VALUES($1,$2,$3)`, [id, parties, data])));
  await bad('item_sql_books', 'pwvsb', ['pwvsb'], { id: 'pwvsb', partyId: 'pwvsb', channel: 'api', currency: 'MYR', timeZone: 'Asia/Kuala_Lumpur' });
  const job = (id: string, status: string, docNo: string | null) => ({ id, partyId: 'goodwill', status, book: 'GW-SYN', docType: 'sales_delivery', revisionAction: 'insert', key: `k-${id}`, dest: docNo ? { docNo } : null });
  await bad('item_sync_jobs', 'j0', ['goodwill'], job('j0', 'acknowledged', null));
  await bad('item_sync_jobs', 'jx', ['goodwill'], { ...job('jx', 'posted', null) });
  await as(store1, 'goodwill', true, (c) => c.query('INSERT INTO prima.item_sync_jobs(id,party_ids,data) VALUES($1,$2,$3)', ['j1', ['goodwill'], job('j1', 'acknowledged', 'DO-1')]));
  await bad('item_sync_jobs', 'j2', ['goodwill'], job('j2', 'acknowledged', 'do-1'));
  await bad('item_uniform_records', 'u1', ['co-sasa'], { id: 'u1', kind: 'paid', pieces: 1, amountSen: '45.5' });
  await as(store1, 'goodwill', true, async (c) => {
    const id = (await c.query("SELECT id FROM prima.item_units LIMIT 1")).rows[0].id;
    await c.query(`UPDATE prima.item_units SET data = jsonb_set(data,'{state}','"laundry"') WHERE id=$1`, [id]);
    await assert.rejects(c.query(`UPDATE prima.item_units SET data = jsonb_set(data,'{labelGen}','40') WHERE id=$1`, [id]));
  });
});

it('the second part fails closed on drift', async () => {
  const a = await connect();
  try {
    for (const ddl of [
      'ALTER TABLE prima.item_sql_books NO FORCE ROW LEVEL SECURITY',
      'DROP POLICY item_wall ON prima.item_label_prints',
      'GRANT DELETE ON prima.item_sync_batches TO prima_app',
      'GRANT UPDATE ON prima.item_sql_snapshots TO prima_app',
      'CREATE POLICY extra ON prima.item_counters USING (true)',
      'DROP INDEX prima.item_sync_jobs_docno_unique',
      'ALTER TABLE prima.item_sql_books DROP CONSTRAINT item_sql_books_shape',
      "ALTER TABLE prima.item_units DROP CONSTRAINT item_units_state",
    ]) {
      await a.query('BEGIN');
      try {
        await a.query(ddl);
        assert.notDeepEqual(await itemRegisterV2Problems(a), [], ddl);
      } finally {
        await a.query('ROLLBACK');
      }
    }
    assert.deepEqual(await itemRegisterV2Problems(a), []);
  } finally {
    await a.end();
  }
});
