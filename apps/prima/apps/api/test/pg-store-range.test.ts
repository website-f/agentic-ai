// PgStore date windows and company-index filters against a real local PostgreSQL (review, 3 Nov 2026): the same rows
// as filtering the full list in memory. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays, inRange, type Store } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('PgStore date windows and company filters', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('returns exactly the rows the full list would give after filtering, for dates, date-times and company lists', async () => {
    await db.asUser('u-fauzan', async (svc) => {
      const store = (svc as unknown as { store: Store }).store;
      const ids = (a: { id: string }[]) => a.map((r) => r.id).sort();
      const all = await store.list('attendance', { companyId: 'co-sasa' });
      const day = all.find((a) => a.clockIn)!.clockIn!.slice(0, 10);
      const win = { field: 'clockIn' as const, from: addDays(day, -1), before: addDays(day, 1) };
      const got = await store.list('attendance', { companyId: 'co-sasa' }, win);
      assert.ok(got.length > 0 && got.length < all.length, 'the window is a real subset');
      assert.deepEqual(ids(got), ids(all.filter((a) => inRange(a, win))));
      // A date field with only a lower bound, and a company list through the company index.
      const sAll = await store.list('shifts', { companyId: ['co-sasa', 'co-arsh'] });
      const sWin = { field: 'date' as const, from: day };
      assert.deepEqual(ids(await store.list('shifts', { companyId: ['co-sasa', 'co-arsh'] }, sWin)), ids(sAll.filter((s) => inRange(s, sWin))));
      assert.ok(sAll.every((s) => s.companyId === 'co-sasa' || s.companyId === 'co-arsh'));
      // Company filter plus another field (company index and containment together).
      const one = sAll.find((s) => s.companyId === 'co-sasa')!;
      assert.deepEqual(ids(await store.list('shifts', { companyId: 'co-sasa', date: one.date })), ids(sAll.filter((s) => s.companyId === 'co-sasa' && s.date === one.date)));
      // Person and site filters through their own btree indexes match the in-memory filter.
      const who = sAll.find((s) => s.personId)!;
      assert.deepEqual(ids(await store.list('shifts', { personId: who.personId! })), ids(sAll.filter((s) => s.personId === who.personId)));
      assert.deepEqual(ids(await store.list('shifts', { siteId: who.siteId, personId: who.personId! })), ids(sAll.filter((s) => s.personId === who.personId && s.siteId === who.siteId)));
      const att = all.find((a) => a.personId)!;
      assert.deepEqual(ids(await store.list('attendance', { personId: att.personId })), ids(all.filter((a) => a.personId === att.personId)));
      assert.deepEqual(await store.list('shifts', { personId: "x' OR '1'='1" }), []);
      // Rows by id on a company table (primary key) match the in-memory filter.
      const people = await store.list('people', { companyId: 'co-sasa' });
      const pick = people.slice(0, 3).map((p) => p.id);
      assert.deepEqual(ids(await store.list('people', { id: [...pick, 'pr-not-there'] })), [...pick].sort());
      assert.deepEqual(await store.list('people', { id: [] }), []);
      // An empty company list reads nothing; a made-up field name cannot inject SQL.
      assert.deepEqual(await store.list('shifts', { companyId: [] }), []);
      assert.deepEqual(await store.list('shifts', { companyId: 'co-sasa' }, { field: "date' OR '1'='1" as never, from: '9999' }), []);
    });
  });
});
