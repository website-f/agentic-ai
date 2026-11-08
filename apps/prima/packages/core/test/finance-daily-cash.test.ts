import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';
import type { FinDailyCashList } from '../src/finance-daily-cash';
import { evidence } from './cash-test-fixture';

// Existing history survives the 8 November correction. No new list or cash salary can be initiated.
describe('legacy daily cash preservation',()=>{
  it('retains paid history and requires its signed receipt before independent Finance settlement',async()=>{
    const today='2026-10-31',now=myt(today,'12:00'),ds=generateDataset({today,now});const svc=new PrimaService(new MemoryStore(ds),()=>now);
    const [de1,de2,fd,coo,doa]=await Promise.all(['u-fin-t1-de1','u-fin-t1-de2','u-fd','u-coo','u-pwvsb-doa'].map(id=>svc.user(id)));
    const sign=(u:typeof doa)=>({byId:u.id,by:u.name,at:now,comment:'Historical synthetic evidence'});
    const f=ds.finStatus.find(f=>f.companyId==='co-09')!;
    const list:FinDailyCashList={id:'historical',period:'week',from:today,to:today,purpose:'Historical only',bankId:f.banks[0].id,status:'returned',people:[{id:'p1',name:'Historical recipient',idLast4:'1234',work:'Historical site',dailyRate:100,days:[today],amount:100,pay:'cash',cash:{reason:'Historical',listed:sign(doa),decision:{...sign(coo),give:true,tier:'coo'}}}],total:100,prepared:sign(de1),submitted:sign(de1),approved:sign(fd),returnedForChange:null,withdrawals:[{id:'w1',on:today,amount:100,ref:'old-withdrawal',sign:sign(de1),statement:null}],handovers:[{id:'h1',on:today,amount:100,toId:coo.id,toName:coo.name,sign:sign(de1),received:{...sign(coo),counted:100}}],payouts:[{id:'payout1',personId:'p1',day:today,amount:100,proof:['Historical payment'],sign:sign(coo)}],giveBack:{...sign(coo),amount:0},settled:null,differenceAccepted:null,log:[]};
    f.dailyCash=[list];
    await expect(svc.financeControls.dailyCashAction(de2,'co-09','settle',{listId:list.id,counted:0})).rejects.toThrow(/signed receipt/);
    expect((await svc.financeControls.dailyCashMine(doa)).receipts).toHaveLength(1);
    await svc.financeControls.dailyCashAction(doa,'co-09','receipt',{listId:list.id,payoutId:'payout1',...evidence('historical-receipt')});
    await expect(svc.financeControls.dailyCashAction(de1,'co-09','settle',{listId:list.id,counted:0})).rejects.toThrow(/does not count/);
    await svc.financeControls.dailyCashAction(de2,'co-09','settle',{listId:list.id,counted:0});
    const saved=ds.finStatus.find(f=>f.companyId==='co-09')!.dailyCash![0];expect(saved.status).toBe('settled');expect(saved.payouts[0].amount).toBe(100);expect(saved.payouts[0].receipt).toBeTruthy();
    await expect(svc.financeControls.dailyCashAction(coo,'co-09','pay',{listId:list.id})).rejects.toThrow(/Legacy/);
  });
});
