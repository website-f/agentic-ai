import assert from 'node:assert/strict';
import {it} from 'node:test';
import type {PoolClient} from 'pg';
import {PgStore} from '../src/pg-store';
for (const table of ['qmsFoundation','qmsRequirements','compProfiles','regRisks','regSettings'] as const) {
 it(`missing optional ${table} fails before querying absent relation`,async()=>{
  const calls:string[]=[];
  const client={query:async(sql:string)=>{calls.push(sql);assert.match(sql,/^SELECT to_regclass/);return {rows:[{ok:false}]};}} as unknown as PoolClient;
  const store=new PgStore(client);
  await assert.rejects(()=>store.list(table),/not installed/);
  await assert.rejects(()=>store.get(table,'x'),/not installed/);
  await assert.rejects(()=>store.lock(table,'x'),/not installed/);
  await assert.rejects(()=>store.insert(table, {id:'x'} as never),/not installed/);
  await assert.rejects(()=>store.update(table,'x', {}),/not installed/);
  assert.equal(calls.length,5);
 });
}
