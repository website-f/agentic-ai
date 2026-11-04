import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Pool } from 'pg';
import { PgJobEmailStore } from '../src/connections-mail/pg-job-email-store';

for (const failAt of ['catalog', 'role', 'none']) it(`readiness uses a read-only restricted transaction and releases it: ${failAt}`, async () => {
  const calls:string[]=[];let released=false;
  const client={query:async(sql:string)=>{
    calls.push(sql);
    if(sql==='SET LOCAL ROLE prima_app'&&failAt==='role')throw new Error('synthetic denied role');
    if(sql.includes('WITH t AS')){
      if(failAt==='catalog')throw new Error('synthetic catalog error');
      return {rows:[]};
    }
    return {rows:[]};
  },release:()=>{released=true;}};
  const pool={connect:async()=>client} as unknown as Pool;
  const result=await new PgJobEmailStore(pool).readiness();
  assert.deepEqual(calls.slice(0,2),['BEGIN READ ONLY','SET LOCAL ROLE prima_app']);
  assert.equal(calls.at(-1),'ROLLBACK');assert.equal(released,true);
  if(failAt!=='role'){
    const sql=calls.find(x=>x.includes('WITH t AS'))!;
    assert.match(sql,/polcmd::text/);assert.doesNotMatch(sql,/\|\| polcmd \|\|/);
    assert.match(sql,/pg_has_role\(session_user, 'prima_app', 'SET'\)/);
  }else assert.equal(calls.some(x=>x.includes('WITH t AS')),false);
  assert.deepEqual(result, {ready:false,reason:failAt==='none'?'Job email table is not migrated.':'Job email readiness could not be checked.'});
});
it('discards the connection if rollback fails rather than returning a local role to the pool', async()=>{
  let released:Error|undefined;const failure=new Error('synthetic rollback failure');
  const pool={connect:async()=>({query:async(sql:string)=>{if(sql==='ROLLBACK')throw failure;return {rows:[]};},release:(error?:Error)=>{released=error;}})} as unknown as Pool;
  assert.deepEqual(await new PgJobEmailStore(pool).readiness(),{ready:false,reason:'Job email readiness could not be checked.'});
  assert.equal(released,failure);
});
