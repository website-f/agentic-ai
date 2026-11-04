import {it} from 'node:test';
import assert from 'node:assert/strict';
import type {PoolClient} from 'pg';
import {PgStore} from '../src/pg-store';
it('allocates under the common lock with one insert-returning and bounded numeric range',async()=>{
 const calls:{sql:string,params:unknown[]}[]=[];const row={id:'synthetic',ref:'IT-0042'};
 const c={query:async(sql:string,params:unknown[]=[])=>{calls.push({sql,params});return{rows:sql.includes('RETURNING')?[{data:row}]:[]};}} as unknown as PoolClient;
 const body={raisedBy:'Synthetic',raisedById:'u-test',category:'OTHER',priority:'P3',title:'Synthetic',detail:'',at:'2026-11-01T00:00:00Z',assignedTo:null,status:'open',resolvedAt:null,resolution:''} as const;
 assert.equal(await new PgStore(c).createItTicket(body),row);assert.match(calls[0].sql,/pg_advisory_xact_lock/);assert.match(calls[0].sql,/prima:it-ticket-reference/);assert.match(calls[1].sql,/INSERT INTO prima.it_tickets/);assert.match(calls[1].sql,/WHERE n <= 999999999999999999/);assert.match(String(calls[1].params[0]),/^it-t-[0-9a-f-]{36}$/);assert.equal(calls.length,2);
});
it('does not return an invented identity if allocator range is exhausted',async()=>{
 const c={query:async()=>({rows:[]})} as unknown as PoolClient;
 await assert.rejects(new PgStore(c).createItTicket({} as any),/exhausted/);
});
