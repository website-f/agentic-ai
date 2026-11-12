import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type User, type GuardPayRun, type StaffPayRun, type GuardLoan } from '../src';
import { buildStaffPayLine } from '../src/payroll';

import { evidence, fixture } from './cash-test-fixture';

describe('additional payroll cash reporting boundary (8 November correction)', () => {
  it.each(['u-fauzan'])('retains %s manual approval and payment evidence without changing ordinary hours or payslips', async approverId => {
    const x=await fixture();const {ds,svc,ceo,guard}=x;
    const office=ds.people.find(p=>p.role==='office')!;
    const guardUser={...ceo,id:'test-guard',role:'guard',personId:guard.id,companyIds:[guard.companyId],opsTier:undefined} as User;
    const officeUser={...ceo,id:'test-office',role:'pwvsb_officer',department:'it',itRole:'executive',personId:office.id,companyIds:[office.companyId],opsTier:undefined} as User;
    const staffLine=buildStaffPayLine({person:office,period:'2026-10',unpaidDivisor:26,leaves:[],claims:[]});
    ds.staffPayRuns.push({id:'privacy-staff',companyId:office.companyId,period:'2026-10',stage:'paid',lines:[staffLine],paid:{paidOn:'2026-10-31'}} as StaffPayRun);
    ds.guardPayRuns.push({id:'privacy-guard',companyId:guard.companyId,period:'2026-10',stage:'paid',lines:[{personId:guard.id,name:guard.name,gross:1600,net:1500}],paid:{paidOn:'2026-10-31'}} as GuardPayRun);
    const reports=async()=>({hours:await svc.siteHoursBoard(ceo,{companyId:guard.companyId,month:'2026-10'}),guard:await svc.myGuardPayslips(guardUser),staff:(await svc.staffPayroll(officeUser)).mine});
    const before=await reports();expect(before.guard.payslips).toHaveLength(1);expect(before.staff.length).toBeGreaterThan(0);
    const records=structuredClone([ds.attendance,ds.guardPayRuns,ds.staffPayRuns]);
    const body=x.body();body.rows[0].approval.byId=approverId;
    const [r]=await x.action(x.doa,'submit',body);
    await x.action(x.finance,'prepare',{id:r.id,ref:'prep',custodianId:x.finance.id});
    await x.action(x.finance,'pay',{id:r.id,ref:'paid',amount:150,atPaid:x.now(),evidence:evidence('paid')});
    await x.action(x.doa,'receipt',{id:r.id,amount:150,paymentRef:'paid',signedByPersonId:guard.id,signedAt:x.now(),transactionSpecific:true,evidence:evidence('signed')});
    await x.action(x.fd,'reconcile',{id:r.id,returned:0,ref:'reconciled',evidence:evidence('reconciled')});
    await x.action(x.fd,'post',{id:r.id,journalRef:'journal',payrollRecordRef:'supplemental',additionalPayrollConfirmed:true,statutoryRecordsConfirmed:true,evidence:evidence('accounted')});
    expect(await reports()).toEqual(before);expect([ds.attendance,ds.guardPayRuns,ds.staffPayRuns]).toEqual(records);
    const saved=(await svc.financeControls.exceptionalCashView(x.doa,x.companyId)).rows[0];
    expect(saved.approval.byId).toBe(approverId);expect(saved.accounting?.amount).toBe(150);expect(saved.receipt).not.toBeNull();
    expect(ds.evidenceDocs.filter(d=>d.id.startsWith('doc-excash-'))).toHaveLength(6);
  });
  it('does not create repayments or change ordinary payroll when a separate historical loan already exists',async()=>{
    const x=await fixture();const hr=x.user('u-pwvsb-hr');
    const sign={by:'Synthetic Finance',byId:x.fd.id,at:x.now(),note:'Historical synthetic record'};
    const loan:GuardLoan={id:'synthetic-existing-loan',companyId:x.companyId,personId:x.guard.id,staffNo:x.guard.staffNo,name:x.guard.name,kind:'loan',limit:300,amount:300,purpose:'Separate existing loan',months:3,instalment:100,firstPeriod:'2026-10',signature:{docRef:'synthetic-loan-agreement',signedOn:'2026-10-01',recordedBy:hr.name,recordedById:hr.id,recordedAt:x.now()},status:'paid_out',requested:sign,cos:sign,ceo:sign,rejected:null,paidOut:{...sign,bankRef:'synthetic-bank-loan',paidOn:'2026-10-01'},repaid:[],balance:300,financeNotices:[],flags:[]};
    x.ds.guardLoans.push(loan);
    const before=await x.svc.prepareGuardPay(x.preparer,x.companyId,'2026-10');
    expect(before.lines.some(l=>l.personId===x.guard.id)).toBe(true);
    const repayments=structuredClone(x.ds.guardLoans),advances=structuredClone(x.ds.guardPayAdvances);
    const r=await x.reconciled();await x.action(x.fd,'post',{id:r.id,journalRef:'separate-support-journal',payrollRecordRef:'pending-treatment-register',additionalPayrollConfirmed:true,treatmentStatus:'pending',evidence:evidence('separate-support')});
    const after=await x.svc.prepareGuardPay(x.preparer,x.companyId,'2026-10');
    expect(after.lines).toEqual(before.lines);expect(after.cash).toEqual([]);
    expect(x.ds.guardLoans).toEqual(repayments);expect(x.ds.guardPayAdvances).toEqual(advances);
  });

});
