import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppController } from '../src/controllers';
import type { Db } from '../src/db';
import type { PrimaService, User } from '@prima/core';

// No database or model calls: prove route wiring never substitutes caller identity or bypasses core authorization.
describe('Arisha draft route boundary', () => {
  it('authorizes direct prepare through the draft service without requiring a previous form call', async () => {
    const user = { id: 'u-coo', opsTier: 'coo' } as User;
    let passed: unknown;
    const svc = { arishaDrafts: { prepareRecord: async (u: User, input: unknown) => {
      assert.equal(u, user); passed = input; throw new Error('Unsupported or protected field.');
    } } } as unknown as PrimaService;
    const db = { asUser: async (uid: string, fn: (s: PrimaService, u: User) => Promise<unknown>) => {
      assert.equal(uid, 'authenticated-coo'); return fn(svc, user);
    } } as unknown as Db;
    const input = { kind: 'company', actorId: 'u-fauzan', values: { bank: 'forged' } };
    await assert.rejects(new AppController(db).arishaPrepare('authenticated-coo', input), /protected/);
    assert.equal(passed, input);
  });

  it('uses authenticated reviewer and submitted version, never an actor supplied in the body', async () => {
    const user = { id: 'u-it-mgr' } as User;
    const svc = { arishaDrafts: { commit: async (u: User, id: string, version: number) => {
      assert.equal(u, user); assert.equal(id, 'draft-1'); assert.equal(version, 1); return { status: 'committed' };
    } } } as unknown as PrimaService;
    const db = { asUser: async (_uid: string, fn: (s: PrimaService, u: User) => Promise<unknown>) => fn(svc, user) } as unknown as Db;
    assert.deepEqual(await new AppController(db).arishaCommitDraft('authenticated-reviewer', 'draft-1', { version: 1 }), { status: 'committed' });
  });
  it('resubmits only through the authenticated draft service and rejects a missing version', async () => {
    const user = { id: 'u-fd' } as User;
    const svc = { arishaDrafts: { resubmit: async (u: User, id: string, version: number) => {
      assert.equal(u, user); assert.equal(id, 'returned-1'); assert.equal(version, 2); return { status: 'submitted', version: 3 };
    } } } as unknown as PrimaService;
    const db = { asUser: async (_uid: string, fn: (s: PrimaService, u: User) => Promise<unknown>) => fn(svc, user) } as unknown as Db;
    const controller = new AppController(db);
    assert.throws(() => controller.arishaResubmitDraft('authenticated-author', 'returned-1', { version: 0 }), /version/);
    assert.deepEqual(await controller.arishaResubmitDraft('authenticated-author', 'returned-1', { version: 2 }), { status: 'submitted', version: 3 });
  });

  it('forwards summary and finance tools as the authenticated user and rejects forged extra arguments', async () => {
    const user = { id: 'u-fd', leadership: 'finance_director' } as User;
    const svc = { arishaContext: { summary: async (u: User, context: string, companyId: string|null) => {
      assert.equal(u, user); assert.equal(context, 'finance-papers'); assert.equal(companyId, null); return { observedAt: 'synthetic' };
    } }, arishaDrafts: { financeModelOptions: async (u: User, companyId: string|null) => { assert.equal(u, user); assert.equal(companyId, null); return {companyChoices:[{id:'co-1'}], papers:[]}; }, prepareFinance: async (u: User) => { assert.equal(u, user); throw new Error('Not permitted'); } } } as unknown as PrimaService;
    const db = { asUser: async (_uid: string, fn: (s: PrimaService, u: User) => Promise<unknown>) => fn(svc, user) } as unknown as Db;
    const controller = new AppController(db);
    assert.deepEqual(await controller.arishaSummary('authenticated', { context: 'finance-papers' }), { observedAt: 'synthetic' });
    assert.deepEqual(await controller.arishaFinanceOptions('authenticated', {}), {companyChoices:[{id:'co-1'}],papers:[]});
    assert.throws(() => controller.arishaPrepareFinance('authenticated', { companyId:'co-1',pack:'audit',itemId:'paper',status:'sent' }), /Unsupported/);
    assert.throws(() => controller.arishaSummary('authenticated', { context:'finance-papers',actorId:'u-fauzan' } as never), /Unsupported/);
    await assert.rejects(controller.arishaPrepareFinance('authenticated', {companyId:'co-1',pack:'audit',itemId:'paper'}), /Not permitted/);
  });

});


it('submission records unverified preparation and rejects extra origin claims before service calls', async () => {
  const user = {id:'u-fauzan'} as User;
  let calls = 0;
  const svc = {arishaDrafts:{submit:async (u:User, payload:unknown, company:unknown, origin:unknown) => {
    calls++; assert.equal(u,user); assert.equal(origin,'unverified'); return payload;
  }}} as unknown as PrimaService;
  const db = {asUser:async (_id:string, fn:(s:PrimaService,u:User)=>Promise<unknown>)=>fn(svc,user)} as unknown as Db;
  const controller = new AppController(db);
  for (const type of ['record','finance-paper']) await controller.arishaSubmitDraft('authenticated',{payload:{type},companyId:null} as never);
  assert.equal(calls,2);
  for (const key of ['origin','provenance','originProof','actorId']) {
    assert.throws(()=>controller.arishaSubmitDraft('authenticated',{payload:{type:'record'},companyId:null,[key]:'arisha'} as never),/Unsupported/);
  }
  assert.equal(calls,2);
});
