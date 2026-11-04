import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppController } from '../src/controllers';
import type { Db } from '../src/db';
test('maintenance route rejects malformed costs before entering a database callback', () => {
  let calls = 0;
  const c = new AppController({ asUser: () => { calls++; } } as unknown as Db);
  for (const cost of [null, '10', true, 'not-a-number', NaN, Infinity, -1, Number.MAX_SAFE_INTEGER])
    assert.throws(() => c.itMaintenance('actor', 'asset', {kind:'repair',note:'Synthetic',cost}), /finite nonnegative/);
  assert.throws(() => c.itMaintenance('actor','asset',{kind:'unknown',note:'Synthetic',cost:0}), /kind/);
  assert.equal(calls, 0);
});
test('maintenance route keeps omitted-cost zero and valid numeric inputs', () => {
  const costs: number[] = [];
  const svc = { itMaintenance: (_u: unknown,_id:string,_k:string,_n:string,c:number) => costs.push(c) };
  const c = new AppController({ asUser: (_id:string,fn:(s:typeof svc,u:unknown)=>unknown) => fn(svc,{id:'actor'}) } as unknown as Db);
  c.itMaintenance('actor','asset',{kind:'service',note:'Synthetic'});
  c.itMaintenance('actor','asset',{kind:'repair',note:'Synthetic',cost:1_000_001.25});
  assert.deepEqual(costs,[0,1_000_001.25]);
});
