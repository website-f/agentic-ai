import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import type { PrimaService, User } from '@prima/core';
import { AuthGuard, entraSetup, issueToken, resetEntraSetup, verifiedEntraAssertion, type AuthedRequest } from '../src/auth';
import { JobEmailController, requestScopedJobEmailAccess, jobEmailRuntimeModule } from '../src/connections-mail/controllers';
import type { JobEmail } from '../src/connections-mail/job-email';
import type { Store, ItTicket } from '@prima/core';
import type { ConnectionsActor, SharePointConnections } from '../src/connections';
import type { Db } from '../src/db';

const tenant = '11111111-2222-3333-4444-555555555555';
const api = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const spa = 'cccccccc-1111-2222-3333-444444444444';
const oid = '99999999-8888-7777-6666-555555555555';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const user = { id: 'u-fauzan', name: 'Synthetic CEO', title: 'CEO', role: 'director', opsTier: 'ceo', companyIds: [], siteIds: [], entraOid: oid } as User;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(over: Record<string, unknown> = {}) {
  const sec = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'synthetic-key' });
  const body = b64({ ver: '2.0', iss: `https://login.microsoftonline.com/${tenant}/v2.0`, aud: `api://${api}`, azp: spa, tid: tenant, oid, scp: 'access_as_user', nbf: sec - 60, exp: sec + 3600, ...over });
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(pair.privateKey).toString('base64url')}`;
}
function context(request: AuthedRequest): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('Job email setup and runtime binding (synthetic)', () => {
  const keys = ['ENTRA_TENANT_ID','ENTRA_API_CLIENT_ID','ENTRA_SPA_CLIENT_ID','ENTRA_API_APP_ID_URI','ENTRA_SCOPE','ALLOW_DEV_LOGIN','DEV_TOKEN_SECRET','LEADERSHIP_ONBOARDING_ONLY'];
  const saved = new Map<string, string | undefined>();
  before(() => { for(const k of keys) { saved.set(k,process.env[k]); delete process.env[k]; }
    Object.assign(process.env,{ENTRA_TENANT_ID:tenant,ENTRA_API_CLIENT_ID:api,ENTRA_SPA_CLIENT_ID:spa,ALLOW_DEV_LOGIN:'true',DEV_TOKEN_SECRET:'synthetic-only'});
    resetEntraSetup(); entraSetup(async kid=>kid==='synthetic-key'?pair.publicKey:null);
  });
  after(() => { for(const k of keys) { const v=saved.get(k); if(v===undefined)delete process.env[k];else process.env[k]=v; } resetEntraSetup(); });
  it('setup stores only a generic request and replays the same request ID, never the copied email link', async () => {
    const rows: ItTicket[]=[]; const locks: string[]=[];
    const store={lock:async(_table:string,key:string)=>{locks.push(key);},list:async()=>rows,update:async(_t:string,id:string,patch:object)=>{const row=rows.find(r=>r.id===id)!;Object.assign(row,patch);return row;},audit:async()=>{}} as unknown as Store;
    const svc={visibleCompanies:async()=>[],raiseItTicket:async(_u:User,body:Record<string,unknown>)=>{const r={id:'ticket-1',ref:'IT-1',raisedById:user.id,status:'open',...body} as unknown as ItTicket;rows.push(r);return r;}} as unknown as PrimaService;
    const db={pool:{query:async()=>({rowCount:1,rows:[{data:user}]})},asUser:async(uid:string,fn:(s:PrimaService,u:User,t:Store)=>Promise<unknown>)=>{assert.equal(uid,user.id);return fn(svc,user,store);}} as unknown as Db;
    const req={headers:{authorization:`Bearer ${jwt()}`}} as AuthedRequest;
    await new AuthGuard(db).canActivate(context(req));
    const c=new JobEmailController(db,{status:async()=>({serviceId:'mail',userId:user.id,status:'NotConfigured',providerVerified:false,setupReason:'FeatureDisabled',keepDays:30})} as unknown as JobEmail); const requestId='11111111-1111-4111-8111-111111111111';
    const first=await c.setup(user.id,req,{}, {requestId}); const again=await c.setup(user.id,req,{}, {requestId});
    assert.equal(first.replayed,false);assert.equal(again.replayed,true);assert.equal(rows.length,1);assert.equal(locks.length,2);
    const nextId='22222222-2222-4222-8222-222222222222';
    const reused=await c.setup(user.id,req,{}, {requestId:nextId});assert.equal(reused.ticketId,first.ticketId);assert.equal(reused.replayed,true);assert.equal(rows.length,1);
    const status=await c.status(user.id,req,{});assert.deepEqual(status.setupRequest,{ticketId:first.ticketId,ticketRef:first.ticketRef,status:'open'});
    await assert.rejects(c.status(user.id,req,{userId:'other'}));
    rows[0].status='resolved';assert.equal((await c.status(user.id,req,{})).setupRequest,null);const recovered=await c.setup(user.id,req,{}, {requestId:nextId});assert.equal(recovered.ticketId,first.ticketId);assert.equal(rows.length,1);
    assert.equal(first.userId,user.id);assert.equal(first.serviceId,'mail');assert.ok(rows[0].detail.includes(requestId));
    await assert.rejects(c.setup(user.id,req,{}, {requestId,outlookLink:'https://outlook.office.com/mail/id/private'}));
    await assert.rejects(c.setup(user.id,req,{}, {requestId:'bad'}));
    await assert.rejects(c.setup(user.id,req,{url:'https://evil.invalid'}, {requestId}));
    assert.ok(!JSON.stringify(rows).includes('outlook.office.com'));assert.equal(rows.length,1);
    await assert.rejects(c.setup(user.id,{} as Request,{}, {requestId}), /Sign in/);
  });
  it('runtime registers only the job-email controller and refreshes user/job access on every check', async () => {
    assert.deepEqual(jobEmailRuntimeModule().controllers,[JobEmailController]);
    let current={...user}; let checks=0;
    const db={asUser:async(_id:string,fn:Function)=>{checks++;return fn({},current,{get:async()=>({assigneeId:user.id,givenById:'u-giver',status:'doing'})});}} as unknown as Db;
    const port=requestScopedJobEmailAccess(db); const actor={user,visibleCompanyIds:[],assertion:{userId:user.id,oid,tenantId:tenant,accessToken:'test'}};
    assert.equal(await port.canAttach(actor,'j-1'),true);
    current={...current,entraOid:'00000000-0000-0000-0000-000000000000'};
    assert.equal(await port.canAttach(actor,'j-1'),false);assert.equal(checks,2);
  });
});
