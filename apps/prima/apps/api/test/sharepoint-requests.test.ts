import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sharePointRequestUrl, connectionRequestInput } from '../src/sharepoint-requests';
const root='https://example.sharepoint.com/sites/IT';
test('SharePoint direct site and library links normalize without provider calls',()=>{
 assert.deepEqual(sharePointRequestUrl(root+'/'),{canonicalUrl:root,host:'example.sharepoint.com',kind:'site'});
 for(const input of [root+'/Shared%20Documents',root+'/Shared%20Documents/Forms/AllItems.aspx',root+'/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FIT%2FShared%20Documents%2FFolder&viewid=11111111-1111-1111-1111-111111111111']) assert.equal(sharePointRequestUrl(input).canonicalUrl,root+'/Shared%20Documents');
 assert.equal(sharePointRequestUrl('https://example.sharepoint.com/teams/Help/Documents').kind,'library');
});
test('SharePoint request parsing rejects external, token, sharing, ambiguous and cross-site destinations',()=>{
 for(const input of ['https://evil.invalid/sites/IT','http://example.sharepoint.com/sites/IT','https://user@example.sharepoint.com/sites/IT','https://example.sharepoint.com:443/sites/IT?token=secret',root+'?token=secret',root+'#token',root+'/_layouts/15/redirect.aspx','https://example.sharepoint.com/:f:/s/IT/secret','https://example-my.sharepoint.com/personal/user',root+'/Docs/Forms/AllItems.aspx?id=%2Fsites%2FOTHER%2FDocs',root+'/Docs/Forms/AllItems.aspx?id=%2Fsites%2FIT%2FDocs&id=other',root+'/%0afoo',root+'/%5cother',root+'/%ZZ',root+'/Docs/Forms/AllItems.aspx?authkey=secret',root+'/Docs/Forms/AllItems.aspx?id=https%3A%2F%2Fevil.invalid']) assert.throws(()=>sharePointRequestUrl(input),input);
});
test('setup request requires explicit UUID identity and exact harmless fields',()=>{
 const requestId='12345678-1234-4123-8123-123456789abc';assert.equal(connectionRequestInput({url:root,requestId}).requestId,requestId);
 for(const input of [{url:root},{url:root,requestId:'bad'},{url:root,requestId,grant:true},{url:root,requestId,token:'private'}]) assert.throws(()=>connectionRequestInput(input));
});

import { ConnectionsController } from '../src/connections.controller';
import type { Db } from '../src/db';
import { SharePointConnections } from '../src/connections';
test('setup ticket is user-bound, independent of provider configuration and never grants access',async()=>{
 const tickets:any[]=[];const events:string[]=[];const user={id:'synthetic-user'};
 const svc={itBoard:async()=>{events.push('list');return {mine:tickets};},raiseItTicket:async(_u:unknown,input:any)=>{events.push('ticket');const t={...input,id:'it-1',ref:'IT-0001',status:'open',at:'2026-10-31T00:00:00Z'};tickets.push(t);return t;}};
 const db={asUser:async(uid:string,fn:any)=>{assert.equal(uid,user.id);return fn(svc,user,{lock:async(table:string,id:string)=>{assert.equal(table,'itTickets');assert.equal(id,'sharepoint-setup:synthetic-user');events.push('lock');}});}} as unknown as Db;
 const controller=new ConnectionsController(db,new SharePointConnections(()=>({}),async()=>{throw Error('No provider calls permitted');}));
 const requestId='12345678-1234-4123-8123-123456789abc';
 const preview=await controller.previewRequest(user.id,{}, {url:root+'/Docs/Forms/AllItems.aspx'});assert.equal(preview.status,'RequestPreview');assert.equal(preview.canonicalUrl,root+'/Docs');assert.equal(tickets.length,0);
 const first=await controller.request(user.id,{}, {url:root+'/Docs',requestId});assert.equal(first.reference,'IT-0001');assert.equal(first.userId,user.id);assert.deepEqual(events,['lock','list','ticket']);
 const again=await controller.request(user.id,{}, {url:root+'/Docs',requestId});assert.equal(again.id,first.id);assert.equal(tickets.length,1);
 await assert.rejects(controller.request(user.id,{}, {url:root+'/Other',requestId}));
 const list=await controller.requests(user.id,{});assert.equal(list.requests[0].requestId,requestId);assert.equal(list.userId,user.id);assert.equal(JSON.stringify(list).includes('Requested URL'),false);
 assert.equal(tickets[0].title,'SharePoint connection request');assert.ok(tickets[0].detail.length<=1000);assert.match(tickets[0].detail,/does not grant access/);
});
