import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArgumentsHost } from '@nestjs/common';
import { DomainErrors } from '../src/errors';
function run(error: unknown) {
  const logged: unknown[] = []; let status = 0, body: unknown;
  const filter = new DomainErrors();
  (filter as unknown as {log:{error:(x:unknown)=>void}}).log = {error:x=>logged.push(x)};
  const response = {status(n:number){status=n;return this;},json(v:unknown){body=v;}};
  filter.catch(error,{switchToHttp:()=>({getResponse:()=>response})} as unknown as ArgumentsHost);
  return {logged,status,body};
}
test('unknown PG errors never log private row details, messages, stack, cause or tokens',()=>{
  const sentinel='PRIVATE_EMAIL_BODY_ADDRESS_AND_TOKEN_CANARY';
  const error=Object.assign(new Error(sentinel),{code:'23514',detail:sentinel,where:sentinel,query:sentinel,cause:sentinel});
  const r=run(error);
  assert.equal(r.status,500);assert.deepEqual(r.body,{message:'Something went wrong on the server. It has been logged.'});
  assert.equal(r.logged.length,1);assert.match(String(r.logged[0]),/^server_error reference=[0-9a-f-]{36} category=database_constraint$/);
  assert.ok(!JSON.stringify(r).includes(sentinel));
});
test('logging only uses fixed classifications and never invokes arbitrary code accessors',()=>{
  let read=false;
  const error=Object.defineProperty({detail:'PRIVATE'},'code',{get(){read=true;throw Error('PRIVATE')}});
  const a=run(error),b=run({code:'PRIVATE',toString(){throw Error('PRIVATE')}});
  assert.equal(read,false);assert.equal(a.status,500);assert.equal(b.status,500);
  assert.match(String(a.logged[0]),/category=unexpected$/);assert.match(String(b.logged[0]),/category=unexpected$/);
  assert.notEqual(a.logged[0],b.logged[0]);assert.ok(!JSON.stringify([a,b]).includes('PRIVATE'));
});
test('a busy connection pool answers 503 "try again", logs a fixed category and leaks nothing', () => {
  const r = run(new Error('timeout exceeded when trying to connect'));
  assert.equal(r.status, 503);
  assert.match(String((r.body as { message: string }).message), /busy/);
  assert.match(String(r.logged[0]), /^server_busy reference=[0-9a-f-]{36} category=database_busy$/);
  // Anything else, even with similar words, stays a plain 500.
  assert.equal(run(new Error('timeout exceeded when trying to connect PRIVATE')).status, 500);
  assert.equal(run({ message: 'timeout exceeded when trying to connect' }).status, 500);
});
