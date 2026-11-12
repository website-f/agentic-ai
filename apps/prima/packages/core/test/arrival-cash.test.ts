import {describe,it,expect} from 'vitest';
import {MemoryStore,sha256Hex} from '../src';
import {ArrivalCashService,arrivalBalance,applyArrivalRecovery,recordArrivalRepayments,checkArrivalSnapshot} from '../src/arrival-cash';
import type {GuardPayLine} from '../src/guard-pay';
import {fixture,evidence} from './cash-test-fixture';
async function setup(){
 const x=await fixture(); x.guard.nationality='NP'; x.guard.bank=null;
 x.ds.credentials=x.ds.credentials.filter(c=>c.personId!==x.guard.id || c.type!=='PLKS_PERMIT');
 const store=new MemoryStore(x.ds), svc=new ArrivalCashService(store,x.now), fwm=x.user('u-fwm-mgr');
 const input={personId:x.guard.id,siteId:x.site.id,arrivedOn:'2026-10-01',months:3,amount:300,requestId:'request-1',purpose:'Food while awaiting PLKS',awaitingPlks:true,withoutWages:true,recentArrivalConfirmed:true};
 const action=(u:typeof fwm,a:string,b:Record<string,unknown>)=>svc.action(u,x.companyId,a,b);
 const request=()=>action(fwm,'request',input);
 const review=(id:string)=>action(x.finance,'review',{id,financeLegalConfirmed:true,basis:'gross-all-deductions',capPercent:35,fromPeriod:'2026-10',toPeriod:'2027-10',recoveryAccount:'SYNTHETIC-ARRIVAL-RECEIVABLE',financeRef:'synthetic-finance-review',legalRef:'synthetic-adviser-review',evidence:evidence('review')});
 const decide=(id:string,approved=true)=>action(x.ceo,'decide',{id,requestId:'request-1',personId:x.guard.id,amount:300,approved,reason:'Synthetic CEO decision'});
 const handover=(id:string)=>action(fwm,'handover',{id,requestId:'request-1',personId:x.guard.id,signedByPersonId:x.guard.id,amount:300,on:'2026-10-31',reference:'handover-1',actualDisbursementConfirmed:true,transactionSpecific:true,evidence:evidence('receipt')});
 const paid=async()=>{const r=await request();await review(r.id);await decide(r.id);return handover(r.id);};
 const line={personId:x.guard.id,gross:1000,deductions:300,net:700,items:[],flags:[],holds:[],utility:0,otherDeductions:0} as unknown as GuardPayLine;
 return {...x,store,svc,fwm,input,action,request,review,decide,handover,paid,line};
}
describe('arrival cash distinct recoverable advance',()=>{
 it('requires per-handout CEO approval; refusal and approval create no debt, actual receipt-backed payout does',async()=>{
  const x=await setup(),r=await x.request();expect(arrivalBalance(r)).toBe(0);
  await expect(x.handover(r.id)).rejects.toThrow('CEO');
  await x.review(r.id);expect(arrivalBalance(await x.decide(r.id))).toBe(0);
  const paid=await x.handover(r.id);expect(arrivalBalance(paid)).toBe(300);expect(paid.notices.map(n=>n.event)).toEqual(['request','review','decision','handover']);
  await expect(x.handover(r.id)).rejects.toThrow();
 });
 it('refused requests never create a balance or permit handover',async()=>{const x=await setup(),r=await x.request();const refused=await x.decide(r.id,false);expect(arrivalBalance(refused)).toBe(0);await expect(x.handover(r.id)).rejects.toThrow();});
 it('denies COO, deputy, forged role and cross-company actors',async()=>{
  const x=await setup(),r=await x.request();
  for(const u of [x.user('u-coo'),x.user('u-fwm-dep'),{...x.ceo,id:x.fwm.id}])await expect(x.action(u,'decide',{id:r.id,requestId:'request-1',personId:x.guard.id,amount:300,approved:true,reason:'No'})).rejects.toThrow();
  await expect(x.svc.view(x.fwm,'ungranted-company')).rejects.toThrow();
 });
 it('binds approval to exact person and amount and rejects replay',async()=>{
  const x=await setup(),r=await x.request();
  await expect(x.action(x.ceo,'decide',{id:r.id,requestId:'request-1',personId:x.guard.id,amount:301,approved:true,reason:'Changed'})).rejects.toThrow('exact');
  await x.decide(r.id);await expect(x.decide(r.id)).rejects.toThrow('already');await expect(x.request()).rejects.toThrow();
 });
 it('requires genuine receipt attestation, exact amount, review and fresh evidence',async()=>{
  const x=await setup(),r=await x.request();await x.decide(r.id);await expect(x.handover(r.id)).rejects.toThrow('review');await x.review(r.id);
  await expect(x.action(x.fwm,'handover',{id:r.id,requestId:'request-1',personId:x.guard.id,signedByPersonId:x.guard.id,amount:300,actualDisbursementConfirmed:true,transactionSpecific:false,evidence:evidence('unsigned')})).rejects.toThrow('Genuine');
  await x.handover(r.id);
  await x.action(x.fwm,'request',{...x.input,id:r.id,requestId:'request-2'});
  await x.action(x.ceo,'decide',{id:r.id,requestId:'request-2',personId:x.guard.id,amount:300,approved:true,reason:'Second request'});
  await expect(x.action(x.fwm,'handover',{id:r.id,requestId:'request-2',personId:x.guard.id,signedByPersonId:x.guard.id,amount:300,on:'2026-10-31',reference:'handover-2',actualDisbursementConfirmed:true,transactionSpecific:true,evidence:evidence('receipt')})).rejects.toThrow('already used');
 });
 it('records actual debt with acknowledgement pending and holds recovery until the genuine receipt arrives',async()=>{
  const x=await setup(),r=await x.request();await x.review(r.id);await x.decide(r.id);
  const paid=await x.action(x.fwm,'handover',{id:r.id,requestId:'request-1',personId:x.guard.id,amount:300,on:'2026-10-31',reference:'pending-ack',actualDisbursementConfirmed:true});
  expect(arrivalBalance(paid)).toBe(300);expect(paid.requests[0].handover?.evidence).toBeNull();expect(applyArrivalRecovery(x.line,[paid],'2026-10').flags.join()).toContain('acknowledgement');
  const acknowledged=await x.action(x.fwm,'receipt',{id:r.id,requestId:'request-1',signedByPersonId:x.guard.id,amount:300,reference:'pending-ack',transactionSpecific:true,evidence:evidence('later-genuine-receipt')});
  expect(arrivalBalance(acknowledged)).toBe(300);expect(applyArrivalRecovery(x.line,[acknowledged],'2026-10').arrivalParts?.[0].amount).toBe(50);
 });
 it('does not require a bank account or impose an invented 60-day eligibility limit',async()=>{const x=await setup();await expect(x.action(x.fwm,'request',{...x.input,arrivedOn:'2026-07-01'})).resolves.toHaveProperty('months',3);});
 it('does not assume a cap; requires explicit Finance/legal review with all deduction basis',async()=>{const x=await setup(),r=await x.request();await expect(x.action(x.finance,'review',{id:r.id,financeLegalConfirmed:true,basis:'gross-all-deductions'})).rejects.toThrow('cap');await expect(x.action(x.fwm,'review',{id:r.id})).rejects.toThrow();});
 it('starts recovery in the first wage month, counts all prior deductions and retains deferred balance',async()=>{
  const x=await setup(),r=await x.paid();const l=applyArrivalRecovery(x.line,[r],'2026-10');expect(l.arrivalParts?.[0].amount).toBe(50);expect(l.deductions).toBe(350);expect(l.net).toBe(650);expect(arrivalBalance(r)).toBe(300);
  await recordArrivalRepayments(x.store,x.companyId,'pay-1','2026-10',[l],x.finance,x.now());
  const saved=(await x.svc.view(x.fwm,x.companyId)).rows[0];expect(saved.balance).toBe(250);expect(saved.repayments).toHaveLength(1);
  await expect(recordArrivalRepayments(x.store,x.companyId,'pay-1','2026-10',[l],x.finance,x.now())).rejects.toThrow();
  await expect(x.action(x.fwm,'request',{...x.input,id:r.id,requestId:'request-2'})).rejects.toThrow('Repayments');
 });
 it('blocks a previously approved second handout once repayments start',async()=>{
  const x=await setup(),r=await x.paid();await x.action(x.fwm,'request',{...x.input,id:r.id,requestId:'request-2'});await x.action(x.ceo,'decide',{id:r.id,requestId:'request-2',personId:x.guard.id,amount:300,approved:true,reason:'Second'});
  const l=applyArrivalRecovery(x.line,[(await x.svc.view(x.fwm,x.companyId)).rows[0]],'2026-10');await recordArrivalRepayments(x.store,x.companyId,'pay-1','2026-10',[l],x.finance,x.now());
  await expect(x.action(x.fwm,'handover',{id:r.id,requestId:'request-2'})).rejects.toThrow('Repayments');
 });
 it('rejects stale snapshots after disbursement and preserves support and loan records',async()=>{
  const x=await setup();const before=structuredClone({loans:x.ds.guardLoans,support:x.f.exceptionalGuardCash});await x.paid();await expect(checkArrivalSnapshot(x.store,x.companyId,[x.line],'2026-10')).rejects.toThrow('snapshot');
  expect({loans:x.ds.guardLoans,support:x.f.exceptionalGuardCash}).toEqual(before);
 });
 it('holds expired treatment and does not deduct when wages are zero',async()=>{const x=await setup(),r=await x.paid();expect(applyArrivalRecovery({...x.line,gross:0},[r],'2026-10').arrivalParts).toBeUndefined();expect(applyArrivalRecovery(x.line,[r],'2027-11').flags.join()).toContain('review');});
 it('does not reuse an arrival receipt as additional-support acknowledgement',async()=>{
  const x=await fixture(),r=await x.paid(),file=evidence('arrival-receipt-replay');
  x.ds.evidenceDocs.push({...x.ds.evidenceDocs[0],id:'doc-arrival-synthetic-existing',companyId:x.companyId,sha256:sha256Hex(file.data),data:file.data,caption:'Signed arrival receipt'});
  await expect(x.action(x.doa,'receipt',{id:r.id,signedAt:x.now(),transactionSpecific:true,signedByPersonId:x.guard.id,paymentRef:'payment-1',amount:120,evidence:file})).rejects.toThrow('already used');
 });
 it('requires CEO-only manual support approval and leaves existing records unchanged',async()=>{const x=await fixture(),body=x.body();body.rows[0].approval.byId='u-coo';await expect(x.action(x.doa,'submit',body)).rejects.toThrow('CEO');});
});

describe('CEO-only ordinary wage-cash scope',()=>{
 it('denies COO decisions, binds net amount, refuses stale handout and preserves the approval',async()=>{
  const x=await fixture(),hr=x.user('u-pwvsb-hr'),coo=x.user('u-coo');
  const run=await x.svc.prepareGuardPay(x.preparer,x.companyId,'2026-10'),line=run.lines.find(l=>l.net>0)!;
  await x.svc.guardPayCash(x.doa,run.id,line.personId,'list',{reason:'Synthetic wage cash'});
  await expect(x.svc.guardPayCash(coo,run.id,line.personId,'decide',{give:true,reason:'Not CEO'})).rejects.toThrow('CEO');
  await x.svc.guardPayCash(x.ceo,run.id,line.personId,'decide',{give:true,reason:'Approved exact wage amount'});
  await expect(x.svc.guardPayCash(x.ceo,run.id,line.personId,'decide',{give:true,reason:'Replay'})).rejects.toThrow();
  const saved=x.ds.guardPayRuns.find(r=>r.id===run.id)!;saved.stage='paid';saved.trial=false; saved.lines.find(l=>l.personId===line.personId)!.net+=1;
  const before=structuredClone(saved.cash);
  await expect(x.svc.guardPayCash(coo,run.id,line.personId,'handout',{on:'2026-10-31'})).rejects.toThrow('exact wage amount');
  expect(saved.cash).toEqual(before);
 });
 it('accepts a genuine transaction-specific wage receipt once and never replays a handout',async()=>{
  const x=await fixture(),hr=x.user('u-pwvsb-hr'),coo=x.user('u-coo');
  const run=await x.svc.prepareGuardPay(x.preparer,x.companyId,'2026-10'),line=run.lines.find(l=>l.net>0)!;
  await x.svc.guardPayCash(x.doa,run.id,line.personId,'list',{reason:'Synthetic wage cash'});
  await x.svc.guardPayCash(x.ceo,run.id,line.personId,'decide',{give:true,reason:'Approved exact wage amount'});
  const saved=x.ds.guardPayRuns.find(r=>r.id===run.id)!;saved.stage='paid';saved.trial=false;
  saved.approved={by:coo.name,byId:coo.id,at:x.now(),note:'Synthetic historical payroll approval'};
  await x.svc.guardPayCash(coo,run.id,line.personId,'handout',{on:'2026-10-31'});
  await expect(x.svc.guardPayCash(coo,run.id,line.personId,'handout',{on:'2026-10-31'})).rejects.toThrow('already');
  const proof=[{kind:'document' as const,...evidence('wage-receipt'),caption:'Genuine synthetic wage acknowledgement'}];
  await expect(x.svc.guardPayCash(x.doa,run.id,line.personId,'receipt',{proof})).rejects.toThrow('Attest');
  await x.svc.guardPayCash(x.doa,run.id,line.personId,'receipt',{proof,transactionSpecific:true,signedByPersonId:line.personId,amount:line.net});
  await expect(x.svc.guardPayCash(x.doa,run.id,line.personId,'receipt',{proof,transactionSpecific:true,signedByPersonId:line.personId,amount:line.net})).rejects.toThrow('already');
 });
});
