import assert from 'node:assert/strict';import {it} from 'node:test';import {AppController} from '../src/controllers';
it('approve and reject require bounded trimmed reason before dispatch; authenticated actor binding retained',async()=>{const calls:any[]=[],actor={id:'actor'},db={asUser:async(id:string,fn:any)=>{assert.equal(id,actor.id);return fn({itPurchaseStep:(...a:any[])=>calls.push(a)},actor);}},c=new AppController(db as any);
 for(const action of ['approve','reject']){for(const b of [undefined,null,[],{}, {note:''},{note:'  '},{note:'ab'},{note:3},{note:'x'.repeat(301)}])assert.throws(()=>c.itPurchaseStep('actor','purchase',action,b as any));await c.itPurchaseStep('actor','purchase',action,{note:' Verified need '});}
 assert.deepEqual(calls,[[actor,'purchase','approve',{note:'Verified need'}],[actor,'purchase','reject',{note:'Verified need'}]]);
 await c.itPurchaseStep('actor','purchase','receive',{});assert.equal(calls[2][2],'receive');assert.equal((calls[2][3] as {note:string}).note,'');
});
