import 'reflect-metadata';
import assert from 'node:assert/strict';
import {after,before,describe,it} from 'node:test';
import {myt,type Dataset} from '@prima/core';
import {Db} from '../src/db';
import {resetDb} from '../src/reset-db';
import {Client} from 'pg';
const url=process.env.DATABASE_URL??'postgres://postgres:localdev@localhost:5432/prima_test';
const now=myt('2026-10-31','12:00'), doc=(s:string)=>({name:`${s}.pdf`,data:'data:application/pdf;base64,'+Buffer.from('SYNTHETIC ARRIVAL '+s).toString('base64')});
describe('arrival cash PostgreSQL authorization, receipt and replay',()=>{
 let db:Db,ds:Dataset,personId:string,siteId:string,id:string,fin:string;
 const companyId='co-sasa';
 const act=(uid:string,a:string,b:Record<string,unknown>)=>db.asUser(uid,(s,u)=>s.financeControls.arrivalCashAction(u,companyId,a,b),()=>now);
 before(async()=>{
  ds=await resetDb(url,now);db=new Db();
  const p=ds.people.find(p=>p.companyId===companyId&&p.nationality==='NP'&&p.role==='guard'&&p.status==='active')!;personId=p.id;siteId=ds.sites.find(s=>s.companyId===companyId)!.id;
  const team=ds.finStatus.find(f=>f.companyId===companyId)!.team;fin=ds.users.find(u=>u.financeTeam===team&&u.financeRole==='leader')!.id;
  const c=new Client({connectionString:url});await c.connect();try{await c.query("DELETE FROM prima.credentials WHERE data->>'personId'=$1 AND data->>'type'='PLKS_PERMIT'",[personId]);}finally{await c.end();}
 });
 after(async()=>{await db?.onModuleDestroy();});
 it('serializes duplicate FWM requests and rejects other roles',async()=>{
  const body={personId,siteId,arrivedOn:'2026-10-01',months:3,amount:120,requestId:'pg-request',purpose:'Synthetic arrival food',awaitingPlks:true,withoutWages:true,recentArrivalConfirmed:true};
  for(const uid of ['u-coo','u-fwm-dep',fin])await assert.rejects(act(uid,'request',body));
  const results=await Promise.allSettled([act('u-fwm-mgr','request',body),act('u-fwm-mgr','request',body)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(results));
  const v=await db.asUser(fin,(s,u)=>s.financeControls.arrivalCashView(u,companyId),()=>now);id=v.rows[0].id;assert.equal(v.rows[0].balance,0);
 });
 it('requires CEO and scoped review, then records exactly one genuine handover',async()=>{
  const decision={id,requestId:'pg-request',personId,amount:120,approved:true,reason:'Synthetic CEO approval'};
  await assert.rejects(act('u-coo','decide',decision));await act('u-fauzan','decide',decision);
  await act(fin,'review',{id,financeLegalConfirmed:true,basis:'gross-all-deductions',capPercent:30,recoveryAccount:'SYNTHETIC-RECEIVABLE',fromPeriod:'2026-10',toPeriod:'2027-10',financeRef:'synthetic-fin',legalRef:'synthetic-legal',evidence:doc('review')});
  const body={id,requestId:'pg-request',personId,signedByPersonId:personId,amount:120,on:'2026-10-31',reference:'pg-payment',actualDisbursementConfirmed:true,transactionSpecific:true,evidence:doc('receipt')};
  const results=await Promise.allSettled([act('u-fwm-mgr','handover',body),act('u-fwm-mgr','handover',body)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(results));
  const v=await db.asUser(fin,(s,u)=>s.financeControls.arrivalCashView(u,companyId),()=>now);assert.equal(v.rows[0].balance,120);assert.equal(v.rows[0].notices.filter(n=>n.event==='handover').length,1);
  await assert.rejects(db.asUser('u-cm-arsh',(s,u)=>s.financeControls.arrivalCashView(u,companyId),()=>now));
 });
});
