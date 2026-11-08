import { describe, expect, it } from 'vitest';
import { medicalLeavePolicy, medicalLeaveUsage, medicalSickDays } from '../src/medical-leave';
import { generateDataset, MemoryStore, PrimaService, myt } from '../src';
import type { LeaveRequest } from '../src/types';
const q = (id: string, kind: 'SICK' | 'HOSPITAL', days: number, from: string, to: string, status: LeaveRequest['status'] = 'approved') => ({ id, kind, days, from, to, status, proofIds: [], requestedAt: '2026-01-01T00:00:00Z', requestedBy: 'Test', reason: 'Synthetic medical record', via: 'company', decidedBy: null, decidedAt: null, decisionNote: null } as LeaveRequest);
describe('date-effective separate medical leave allowances', () => {
  it.each(['Selangor', 'Labuan', 'Sabah', 'Sarawak'])('%s: ordinary14 leaves hospital60 and hospital10 leaves50', state => {
    const a = q('s','SICK',14,'2026-01-01','2026-01-14');
    expect(medicalLeaveUsage([a],'2026-11-07',state).hospitalConsumed).toBe(0);
    const b = medicalLeaveUsage([a,q('h','HOSPITAL',10,'2026-02-01','2026-02-10')],'2026-11-07',state);
    expect(b.sickTaken).toBe(14); expect(60-b.hospitalConsumed).toBe(50); expect(b.policy.reviewRequired).toBe(false);
  });
  it('hospital60 consumes no ordinary sick days', () => {
    const r=medicalLeaveUsage([q('h','HOSPITAL',60,'2026-01-01','2026-03-01')],'2026-11-07','Sabah');
    expect(r.sickTaken).toBe(0);expect(r.hospitalConsumed).toBe(60);
  });
  it('uses exact service anniversaries', () => {
    expect(medicalSickDays('2024-11-07','2026-11-06')).toBe(14);
    expect(medicalSickDays('2024-11-07','2026-11-07')).toBe(18);
    expect(medicalSickDays('2021-11-07','2026-11-06')).toBe(18);
    expect(medicalSickDays('2021-11-07','2026-11-07')).toBe(22);
  });
  it('preserves historical regime and gates East Malaysia transition year rather than resetting60', () => {
    expect(medicalLeavePolicy('2022-11-07','Labuan').independent).toBe(false);
    expect(medicalLeavePolicy('2023-01-01','Labuan').independent).toBe(true);
    expect(medicalLeavePolicy('2024-11-07','Sabah').independent).toBe(false);
    for(const state of ['Sabah','Sarawak']) for(const day of ['2025-04-30','2025-05-01','2025-12-31']) expect(medicalLeavePolicy(day,state).reviewRequired).toBe(true);
    expect(medicalLeavePolicy('2026-01-01','Sarawak').independent).toBe(true);
    expect(medicalLeavePolicy('2024-11-07',null).reviewRequired).toBe(true);
  });
  it('never mutates approved historic decisions and distinguishes pending/refused corrections', () => {
    const rows=[q('s','SICK',4,'2026-01-01','2026-01-04'),q('p','HOSPITAL',3,'2026-02-01','2026-02-03','pending'),q('r','HOSPITAL',3,'2026-03-01','2026-03-03','rejected')];
    const before=JSON.stringify(rows);const r=medicalLeaveUsage([...rows,rows[0]],'2026-11-07','Selangor');
    expect(r.sickTaken).toBe(4);expect(r.hospitalConsumed).toBe(0);expect(r.hospitalPending).toBe(3);expect(JSON.stringify(rows)).toBe(before);
  });
  it('gates cross-year allocation and overlapping approvals instead of guessing/double counting', () => {
    expect(medicalLeaveUsage([q('x','HOSPITAL',4,'2025-12-30','2026-01-02')],'2026-11-07','Sabah').policy.reviewRequired).toBe(true);
    expect(medicalLeaveUsage([q('a','SICK',2,'2026-01-01','2026-01-02'),q('b','HOSPITAL',2,'2026-01-02','2026-01-03')],'2026-11-07','Selangor').policy.reviewRequired).toBe(true);
  });
  it('shows current separate balances through the actual authorised service without changing records', async () => {
    const now=myt('2026-11-07','10:00');const ds=generateDataset({today:'2026-11-07',now,daysBack:2});
    const p=ds.people.find(p=>p.companyId==='co-sasa'&&p.role==='guard'&&p.status==='active')!;
    ds.leaveRequests=ds.leaveRequests.filter(q=>q.personId!==p.id);
    const row={...q('test-sick','SICK',14,'2026-01-01','2026-01-14'),personId:p.id,companyId:p.companyId};ds.leaveRequests.push(row);
    const before=JSON.stringify(row);const svc=new PrimaService(new MemoryStore(ds),()=>now);
    const result=await svc.guardProfile(await svc.user('u-cm-sasa'),p.id);
    expect(result.leave.balances.hospital.left).toBe(60);expect(result.leave.balances.hospital.taken).toBe(0);expect(result.leave.balances.medicalPolicy.independent).toBe(true);
    expect(JSON.stringify(row)).toBe(before);
    await expect(svc.guardProfile(await svc.user('u-cm-inas'),p.id)).rejects.toThrow();
  });
  it('records applied policy on new approval and refuses cross-year approval without rewriting old records', async () => {
    const now=myt('2026-11-07','10:00');const ds=generateDataset({today:'2026-11-07',now,daysBack:2});
    const p=ds.people.find(p=>p.companyId==='co-sasa'&&p.role==='guard'&&p.status==='active')!;
    ds.leaveRequests=ds.leaveRequests.filter(q=>q.personId!==p.id);
    const old={...q('old','SICK',14,'2026-01-01','2026-01-14'),personId:p.id,companyId:p.companyId};
    const pending={...q('new','HOSPITAL',10,'2026-11-01','2026-11-10','pending'),proofIds:['synthetic-mc'],requestedAt:now,personId:p.id,companyId:p.companyId};
    ds.leaveRequests.push(old,pending);const before=JSON.stringify(old);const svc=new PrimaService(new MemoryStore(ds),()=>now);
    const approved=await svc.decideLeave(await svc.user(ds.users.find(u=>u.branchId===p.branchId)?.id??'u-fauzan'),pending.id,true,'MC reviewed');
    expect(approved.status).toBe('approved');expect(approved.medicalPolicy?.independent).toBe(true);expect(approved.medicalPolicy?.year).toBe('2026');expect(JSON.stringify(old)).toBe(before);
    const cross={...q('cross','HOSPITAL',4,'2026-12-30','2027-01-02','pending'),proofIds:['synthetic-mc2'],requestedAt:now,personId:p.id,companyId:p.companyId};ds.leaveRequests.push(cross);
    const crossSvc = new PrimaService(new MemoryStore(ds),()=>now);
    await expect(crossSvc.decideLeave(await crossSvc.user(ds.users.find(u=>u.branchId===p.branchId)?.id??'u-fauzan'),'cross',true,'Review')).rejects.toThrow(/HR\/legal review|Cross-year/);
    expect(cross.status).toBe('pending');
  });

});
