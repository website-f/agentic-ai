// P83: per-request read snapshots (read-cache.ts). A fake store and a fake database client: what each read costs,
// that answers match the database's own filter rules, and that nothing stale is ever read after a change.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Store } from '@prima/core';
import { MAX_ROWS, SNAPSHOT_AFTER, exact, forgetCatalog, pgMatches, withReadSnapshots } from '../src/read-cache';

type R = Record<string, unknown>;

function harness(rows: Record<string, R[]>) {
  const sql: string[] = [];
  const direct: string[] = [];
  const data = structuredClone(rows);
  const base = {
    async list(table: string, filter?: R) {
      direct.push(`list ${table}`);
      return data[table].filter((r) => Object.entries(filter ?? {}).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v))).map((r) => structuredClone(r));
    },
    async get(table: string, id: string) {
      direct.push(`get ${table}`);
      const r = data[table].find((x) => x.id === id);
      return r ? structuredClone(r) : undefined;
    },
    async insert(table: string, row: R) {
      data[table].push(row);
    },
    async update(table: string, id: string, patch: R) {
      const r = data[table].find((x) => x.id === id)!;
      Object.assign(r, patch);
      return r;
    },
    hrItTrustedTenant() {
      return 'tenant';
    },
  };
  const client = {
    async query(text: string) {
      sql.push(text);
      const table = /FROM (\S+)/.exec(text)![1];
      return { rows: data[table].slice(0, MAX_ROWS + 1).map((d) => ({ data: structuredClone(d) })) };
    },
  };
  const store = withReadSnapshots(base as unknown as Store, client as never, (t) => t) as unknown as typeof base;
  return { store, sql, direct, data };
}

const people = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, companyId: `co-${i % 3}`, name: `Person ${i}`, joined: `2026-0${(i % 9) + 1}-01`, active: i % 2 === 0, note: i === 0 ? null : 'x' }));

describe('per-request read snapshots', () => {
  it('reads the table once after a few reads, then answers from memory', async () => {
    const h = harness({ people });
    for (let c = 0; c < 3; c++) await h.store.list('people', { companyId: `co-${c}` });
    for (let i = 0; i < 20; i++) await h.store.get('people', `p${i}`);
    assert.equal(h.direct.length, SNAPSHOT_AFTER - 1, 'only the first reads go to the database one by one');
    assert.equal(h.sql.length, 1, 'then one query for the whole table');
    assert.deepEqual((await h.store.list('people', { companyId: 'co-1' })).map((p: R) => p.id), people.filter((p) => p.companyId === 'co-1').map((p) => p.id));
  });

  it('applies the database rules: arrays as text, single values exactly, null only when present, ranges on strings', () => {
    const row = { id: 'a', n: 5, flag: true, empty: null, d: '2026-03-01', tags: ['x'] };
    assert.ok(pgMatches(row, { n: ['5', '6'] }));
    assert.ok(!pgMatches(row, { missing: ['5'] }));
    assert.ok(pgMatches(row, { flag: true }) && !pgMatches(row, { flag: false }));
    assert.ok(pgMatches(row, { empty: null }) && !pgMatches(row, { missing: null }));
    assert.ok(pgMatches(row, {}, { field: 'd', from: '2026-03-01', before: '2026-04-01' }));
    assert.ok(!pgMatches(row, {}, { field: 'd', before: '2026-03-01' }));
    assert.ok(!pgMatches(row, {}, { field: 'n', from: '1' }), 'a range needs a string field');
    assert.ok(!pgMatches(row, { tags: 'x' }), 'containment of a single value in an array field does not match');
    assert.ok(!exact({ tags: ['x', { a: 1 }] }) && !exact({ obj: { a: 1 } }), 'object values go to the database');
    assert.ok(exact({ a: 'x', b: [1, 'y'], c: null }));
  });

  it('never answers from a snapshot after a change, so a read after a write sees the write', async () => {
    const h = harness({ people });
    for (let i = 0; i < 4; i++) await h.store.list('people', { companyId: 'co-0' });
    await h.store.update('people', 'p0', { name: 'Changed' });
    const after = await h.store.get('people', 'p0');
    assert.equal((after as R).name, 'Changed');
    await h.store.insert('people', { id: 'new', companyId: 'co-0', name: 'New' });
    for (let i = 0; i < 4; i++) await h.store.list('people', { companyId: 'co-0' });
    assert.ok((await h.store.list('people', { companyId: 'co-0' })).some((p: R) => p.id === 'new'));
  });

  it('keeps a big table on plain queries', async () => {
    const big = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ id: `b${i}`, companyId: 'co-0' }));
    const h = harness({ big });
    for (let i = 0; i < 10; i++) await h.store.list('big', { companyId: 'co-0' });
    assert.equal(h.sql.length, 1, 'tried once');
    assert.equal(h.direct.length, 10, 'every read went to the database');
  });

  it('hands out copies, and synchronous methods stay synchronous', async () => {
    const h = harness({ people });
    for (let i = 0; i < 4; i++) await h.store.list('people', {});
    const one = (await h.store.list('people', { companyId: 'co-2' }))[0] as R;
    one.name = 'Mutated by a caller';
    const again = (await h.store.list('people', { companyId: 'co-2' }))[0] as R;
    assert.notEqual(again.name, 'Mutated by a caller');
    assert.equal(h.store.hrItTrustedTenant(), 'tenant');
  });

  it('keeps a passing schema check for a while, never a failing one, and never the HR/IT tenant check', async () => {
    forgetCatalog();
    let runs = 0, hr = 0, answer: string[] = [];
    const base = {
      async rentalCorrectionProblems() { runs++; return [...answer]; },
      async hrItProblems() { hr++; return []; },
      async list() { return []; },
    };
    const fake = { query: async () => ({ rows: [] }) };
    const a = withReadSnapshots(base as unknown as Store, fake as never, (t) => t) as unknown as typeof base;
    answer = ['missing_policy'];
    await a.rentalCorrectionProblems();
    await a.rentalCorrectionProblems();
    assert.equal(runs, 2, 'a failing answer is checked again every time');
    answer = [];
    await a.rentalCorrectionProblems();
    const b = withReadSnapshots(base as unknown as Store, fake as never, (t) => t) as unknown as typeof base;
    await b.rentalCorrectionProblems();
    assert.equal(runs, 3, 'a passing answer is kept across requests');
    await a.hrItProblems();
    await b.hrItProblems();
    assert.equal(hr, 2, 'the HR/IT check sets the tenant for its transaction: always run');
    forgetCatalog();
  });
});
