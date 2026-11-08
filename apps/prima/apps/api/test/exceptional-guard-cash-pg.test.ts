import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { myt, type Dataset } from '@prima/core';
import { Db } from '../src/db';
import { resetDb } from '../src/reset-db';
import { Client } from 'pg';
const url=process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
const now=myt('2026-10-31','12:00');
const doc=(s:string)=>({name:s+'.pdf',data:'data:application/pdf;base64,'+Buffer.from('SYNTHETIC '+s).toString('base64')});
describe('exceptional guard cash real PostgreSQL company lock and RLS',()=>{
 let db:Db,ds:Dataset,companyId:string,siteId:string,personId:string,financeId:string,id:string;
 let body:Record<string,unknown>;
 const act=(uid:string,action:string,input:Record<string,unknown>)=>db.asUser(uid,(s,u)=>s.financeControls.exceptionalCashAction(u,companyId,action,input),()=>now);
 before(async()=>{
   ds=await resetDb(url,now);db=new Db();
   const site=ds.sites.find(s=>s.companyId==='co-sasa' && ['Selangor','Kuala Lumpur'].includes(ds.branches.find(b=>b.id===s.branchId)?.state??s.state??'') && ds.shifts.some(sh=>sh.siteId===s.id&&sh.date==='2026-10-31'&&ds.people.some(p=>p.id===sh.personId&&p.role==='guard'&&p.status==='active')))!;
   siteId=site.id;companyId=site.companyId;personId=ds.shifts.find(sh=>sh.siteId===siteId&&sh.date==='2026-10-31'&&ds.people.some(p=>p.id===sh.personId&&p.role==='guard'&&p.status==='active'))!.personId!;
   const team=ds.finStatus.find(f=>f.companyId===companyId)!.team;financeId=ds.users.find(u=>u.financeTeam===team&&u.financeRole==='leader')!.id;
   body={version:1,batchId:'pg-batch',workbookRef:'Synthetic controlled workbook',evidenceChecked:true,rows:[{personId,siteId,occasion:'2026-10-31',amount:150,reason:'Additional payroll support',request:{byId:'u-om-klang',at:myt('2026-10-31','08:00'),evidence:doc('om')},approval:{id:'pg-approval',byId:'u-fauzan',at:myt('2026-10-31','09:00'),evidence:doc('approval')}}]};
 });
 after(async()=>{await db?.onModuleDestroy();});
 it('denies staff/OM/guard and other-company readers through Db.asUser',async()=>{
   for(const uid of ['u-om-klang','u-guard-sasa-1','u-pwvsb-hr',financeId]) await assert.rejects(act(uid,'submit',body));
   await assert.rejects(db.asUser('u-cm-arsh',(s,u)=>s.financeControls.exceptionalCashView(u,companyId),()=>now));
 });
 it('serializes concurrent duplicate handovers with no partial evidence',async()=>{
   const results=await Promise.allSettled([act('u-pwvsb-doa','submit',body),act('u-pwvsb-doa','submit',body)]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
   const view=await db.asUser('u-pwvsb-doa',(s,u)=>s.financeControls.exceptionalCashView(u,companyId),()=>now);assert.equal(view.rows.length,1);id=view.rows[0].id;
   const c=new Client({connectionString:url});await c.connect();try {
     const count=await c.query("SELECT count(*)::int AS n FROM prima.evidence_docs WHERE id LIKE 'doc-excash-%'");assert.equal(count.rows[0].n,2);
     await c.query('BEGIN');await c.query('SET LOCAL ROLE prima_app');await c.query("SELECT set_config('app.company_ids','co-arsh',true)");
     assert.equal((await c.query('SELECT id FROM prima.fin_status WHERE company_id=$1',[companyId])).rowCount,0);await c.query('ROLLBACK');
   } finally {await c.end();}
 });
 it('serializes payout replay and enforces receipt, independent reconciliation and payroll completion',async()=>{
   await act(financeId,'prepare',{id,ref:'withdrawal',custodianId:financeId});
   const pay={id,ref:'actual-payment',amount:120,atPaid:now,evidence:doc('payout')};
   const results=await Promise.allSettled([act(financeId,'pay',pay),act(financeId,'pay',pay)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   await assert.rejects(act('u-fd','complete',{id}));
   await assert.rejects(act('u-fd','reconcile',{id,returned:30,ref:'return',evidence:doc('reconcile')}));
   await act('u-pwvsb-doa','receipt',{id,signedAt:now,signedByPersonId:personId,paymentRef:'actual-payment',amount:120,transactionSpecific:true,evidence:doc('receipt')});
   await act('u-fd','reconcile',{id,returned:30,ref:'return',evidence:doc('reconcile')});
   const post={id,journalRef:'unique-journal-line',payrollRecordRef:'supplemental-record',additionalPayrollConfirmed:true,statutoryRecordsConfirmed:false,treatmentStatus:'pending',evidence:doc('accounting')};
   const posted=await Promise.allSettled([act('u-fd','post',post),act('u-fd','post',post)]);assert.equal(posted.filter(r=>r.status==='fulfilled').length,1);
   await assert.rejects(act('u-fd','complete',{id}),/pending/);
   const review={id,policyRef:'synthetic-finance-adviser-decision',recordRef:'completed-records',statutoryRecordsConfirmed:true,evidence:doc('treatment-review')};
   await assert.rejects(act('u-pwvsb-doa','reviewTreatment',review));
   const reviews=await Promise.allSettled([act('u-fd','reviewTreatment',review),act('u-fd','reviewTreatment',review)]);
   assert.equal(reviews.filter(r=>r.status==='fulfilled').length,1);
   await act('u-fd','complete',{id});await assert.rejects(act('u-fd','complete',{id}));
   const view=await db.asUser('u-fd',(s,u)=>s.financeControls.exceptionalCashView(u,companyId),()=>now);assert.equal(view.rows[0].accounting?.amount,120);assert.equal(view.rows[0].status,'complete');
   const evidenceId=view.rows[0].accounting!.evidence;
   const file=await db.asUser('u-fd',(s,u)=>s.financeControls.exceptionalCashEvidence(u,companyId,evidenceId),()=>now);assert.equal(file.data,doc('accounting').data);
   await assert.rejects(db.asUser('u-om-klang',(s,u)=>s.financeControls.exceptionalCashEvidence(u,companyId,evidenceId),()=>now));
   await assert.rejects(db.asUser('u-fd',(s,u)=>s.financeControls.exceptionalCashEvidence(u,'co-arsh',evidenceId),()=>now));
 });
 it('preserves completed evidence and accounting when correction/reversal is attempted directly',async()=>{
   const read=()=>db.asUser('u-fd',(s,u)=>s.financeControls.exceptionalCashView(u,companyId),()=>now);
   const before=await read();
   for(const action of ['cancel','correct','reverse']) await assert.rejects(act('u-fd',action,{id}),/gated/);
   await assert.rejects(act(financeId,'returnUnpaid',{id,returned:150,ref:'bad-return',evidence:doc('bad-return')}));
   assert.deepEqual((await read()).rows,before.rows);
   assert.ok(before.master.every(p=>Object.keys(p).sort().join(',')==='assignments,companyId,name,personId,staffNo'));
 });

});
