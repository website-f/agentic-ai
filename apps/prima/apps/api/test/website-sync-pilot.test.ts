import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AppController } from '../src/controllers';
import { WebConnectors } from '../src/web-connectors';

it('actual website sync controller reads only and never invokes legacy outgoing delivery',async()=>{
  const original=WebConnectors.prototype.feed,send=WebConnectors.prototype.deliver;let reads=0,sends=0;
  WebConnectors.prototype.feed=async()=>{reads++;return {at:'2026-11-01T00:00:00Z'};};
  WebConnectors.prototype.deliver=async()=>{sends++;throw new Error('Must not send');};
  const svc={websites:{board:async()=>({allowed:true,canSync:true,role:{it:true},integrations:[],domains:[]}),syncFromFeed:async()=>({ran:[],issues:[],notices:0,state:{}}),queuedDeliveries:()=>{throw new Error('Must not read outgoing queue');}}};
  try {
    const c=new AppController({asUser:async(_id:string,fn:any)=>fn(svc,{id:'synthetic'})} as any);
    const result=await c.websiteSync('synthetic');assert.equal(result.delivered,0);assert.equal(result.deliveryAvailable,false);assert.equal(reads,1);assert.equal(sends,0);
  }finally{WebConnectors.prototype.feed=original;WebConnectors.prototype.deliver=send;}
});
it('scoped IT role cannot bypass explicit group connector authorization',async()=>{
  const original=WebConnectors.prototype.feed;let reads=0;WebConnectors.prototype.feed=async()=>{reads++;throw new Error('Must not read');};
  try {
    const svc={websites:{board:async()=>({allowed:true,canSync:false,role:{it:true}})}};
    const c=new AppController({asUser:async(_id:string,fn:any)=>fn(svc,{id:'synthetic'})} as any);
    await assert.rejects(c.websiteSync('synthetic'),/Only IT/);assert.equal(reads,0);
  }finally{WebConnectors.prototype.feed=original;}
});
