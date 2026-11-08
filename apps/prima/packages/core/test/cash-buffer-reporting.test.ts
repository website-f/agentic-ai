import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type User, type GuardPayRun, type StaffPayRun } from '../src';
import { buildStaffPayLine } from '../src/payroll';

// Cash-buffer amounts stay in the restricted Finance record. Actual hours and separately owed wages remain intact.
describe('special cash buffer reporting boundary (Fauzan, 7 Nov 2026)', () => {
  it.each(['u-coo', 'u-fauzan'])('keeps %s cash payout out of man-hours and both payslips without deleting evidence', async collectorId => {
    const today='2026-10-31', now=myt(today,'10:00'), ds=generateDataset({today,now});
    const svc=new PrimaService(new MemoryStore(ds),()=>now);
    const [finance,fd,doa,collector,ceo]=await Promise.all(['u-fin-t1-de1','u-fd','u-pwvsb-doa',collectorId,'u-fauzan'].map(id=>svc.user(id)));
    const guard=ds.people.find(p=>p.role==='guard')!;
    const office=ds.people.find(p=>p.role==='office')!;
    const guardUser={...collector,id:'test-guard',role:'guard',personId:guard.id,companyIds:[guard.companyId],opsTier:undefined} as User;
    const officeUser={...collector,id:'test-office',role:'pwvsb_officer',department:'it',itRole:'executive',personId:office.id,companyIds:[office.companyId],opsTier:undefined} as User;
    const staffLine=buildStaffPayLine({person:office,period:'2026-10',unpaidDivisor:26,leaves:[],claims:[]});
    ds.staffPayRuns.push({id:'privacy-staff',companyId:office.companyId,period:'2026-10',stage:'paid',lines:[staffLine],paid:{paidOn:today}} as StaffPayRun);
    ds.guardPayRuns.push({id:'privacy-guard',companyId:guard.companyId,period:'2026-10',stage:'paid',lines:[{personId:guard.id,name:guard.name,gross:1600,net:1500}],paid:{paidOn:today}} as GuardPayRun);
    const reports=async()=>({hours:await svc.siteHoursBoard(ceo,{companyId:guard.companyId,month:'2026-10'}),guard:await svc.myGuardPayslips(guardUser),staff:(await svc.staffPayroll(officeUser)).mine});
    const before=await reports();
    expect(before.guard.payslips).toHaveLength(1);expect(before.staff.length).toBeGreaterThan(0);
    const attendanceBefore=structuredClone(ds.attendance), wagesBefore=structuredClone([ds.guardPayRuns,ds.staffPayRuns]);
    const f=ds.finStatus.find(f=>f.companyId==='co-09')!;
    const l=await svc.financeControls.dailyCashAction(finance,'co-09','add',{period:'week',from:'2026-10-29',to:'2026-11-04',bankId:f.banks[0].id,purpose:'Special cash buffer paid through authorised collector',people:[{name:guard.name,idLast4:'1234',work:'Cash buffer special site',dailyRate:173,days:[today],pay:'cash'}]}) as {id:string;people:{id:string}[]};
    const personId=l.people[0].id;
    const action=(user:User,a:string,input:Record<string,unknown>={})=>svc.financeControls.dailyCashAction(user,'co-09',a,{listId:l.id,...input});
    await action(finance,'submit');
    await action(doa,'listCash',{personId,site:'Special site',amount:173,reason:'Special case cash buffer, approved separately'});
    await action(collector,'decideCash',{personId,give:true,comment:'Special cash payment for this person'});
    await action(fd,'approve',{comment:'Approved special buffer list and amount'});
    await action(finance,'withdraw',{on:today,amount:173,ref:'SPECIAL-CASH-173'});
    await action(finance,'handover',{toId:collector.id,amount:173});
    await action(collector,'received',{handoverId:'h1',counted:173});
    await action(collector,'pay',{personId,day:today,idLast4:'1234',proof:'Signed special cash receipt retained',amount:173});
    await action(doa,'receipt',{payoutId:'pay1',name:'signed-special-buffer.png',data:`data:image/png;base64,${Buffer.from('synthetic signed receipt').toString('base64')}`});
    expect(await reports()).toEqual(before);
    expect(ds.attendance).toEqual(attendanceBefore);expect([ds.guardPayRuns,ds.staffPayRuns]).toEqual(wagesBefore);
    const saved=ds.finStatus.find(x=>x.companyId==='co-09')!.dailyCash!.find(x=>x.id===l.id)!;
    expect(saved.payouts).toHaveLength(1);expect(saved.payouts[0].amount).toBe(173);
    expect(saved.approved?.byId).toBe(fd.id);expect(saved.log.length).toBeGreaterThan(0);
    expect(ds.audit.some(a=>a.summary.includes('173')||a.summary.includes('cash'))).toBe(true);
    await expect(svc.financeControls.dailyCashAction(guardUser,'co-09','pay',{listId:l.id,personId,day:today})).rejects.toThrow();
  });
});
