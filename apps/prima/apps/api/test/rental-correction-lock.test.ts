import assert from 'node:assert/strict';
import {it} from 'node:test';
import {PgStore} from '../src/pg-store';

for (const table of ['itRentalCorrectionRequests', 'itRentalReplacements'] as const) {
  it(`${table} uses shared admission lock without requiring append-only UPDATE`, async () => {
    const calls: Array<{sql: string; params: unknown[]}> = [];
    const store = new PgStore({query: async (sql: string, params: unknown[]) => {
      calls.push({sql, params});
      assert.doesNotMatch(sql, /FOR UPDATE|GRANT|UPDATE prima\./i);
      return {rows: []};
    }} as never);
    await store.lock(table, 'synthetic-record');
    assert.deepEqual(calls, [{sql: 'SELECT pg_advisory_xact_lock(hashtext($1))', params: ['it-manual:create']}]);
  });
}

it('ordinary mutable asset row locking is unchanged', async () => {
  const calls: Array<{sql: string; params: unknown[]}> = [];
  const store = new PgStore({query: async (sql: string, params: unknown[]) => {
    calls.push({sql, params}); return {rows: []};
  }} as never);
  await store.lock('itAssets', 'synthetic-asset');
  assert.deepEqual(calls, [{sql: 'SELECT 1 FROM prima.it_assets WHERE id = $1 FOR UPDATE', params: ['synthetic-asset']}]);
});

it('rental lock failure propagates rather than continuing without serialization', async () => {
  const store = new PgStore({query: async () => {throw new Error('synthetic lock unavailable');}} as never);
  await assert.rejects(store.lock('itRentalCorrectionRequests', 'synthetic-record'), /synthetic lock unavailable/);
});
