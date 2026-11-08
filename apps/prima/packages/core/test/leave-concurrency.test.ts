import { describe, expect, it } from 'vitest';
import { generateDataset, MemoryStore, PrimaService, myt } from '../src';
import type { LeaveRequest } from '../src/types';
import { withLeavePersonLock } from '../src/leave-lock';
const today='2026-11-07', now=myt(today,'10:00');
function fixture() {
  const ds=generateDataset({today,now,daysBack:2});
  const person=ds.people.find(p=>p.companyId==='co-sasa'&&p.role==='guard'&&p.status==='active')!;
  person.hiredOn='2026-01-01';
  ds.leaveRequests=ds.leaveRequests.filter(q=>q.personId!==person.id);
  const add=(id:string,kind:LeaveRequest['kind'],days:number,from:string,to:string)=> {
    const q={id,personId:person.id,companyId:person.companyId,kind,days,from,to,status:'pending',proofIds:['synthetic-'+id],requestedAt:now,requestedBy:'Synthetic',reason:'Synthetic request',via:'company',decidedBy:null,decidedAt:null,decisionNote:null} as LeaveRequest;
    ds.leaveRequests.push(q);return q;
  };
  return {ds,person,add,actor:ds.users.find(u=>u.branchId===person.branchId)?.id??'u-fauzan',create:()=>{const store=new MemoryStore(ds);return {store,svc:new PrimaService(store,()=>now)}}};
}
describe('leave decisions serialize shared allowances',()=>{
  it('two different sick requests cannot jointly exceed14 days',async()=>{
    const f=fixture();f.add('a','SICK',8,'2026-11-01','2026-11-08');f.add('b','SICK',8,'2026-11-09','2026-11-16');
    const {svc,store}=f.create();const actor=await svc.user(f.actor);
    const r=await Promise.allSettled(['a','b'].map(id=>svc.decideLeave(actor,id,true,'Medical certificate reviewed')));
    expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect((await store.list('leaveRequests',{personId:f.person.id})).filter(q=>q.status==='approved')).toHaveLength(1);
  });
  it('hospital allowance stays independent while decisions serialize',async()=>{
    const f=fixture();f.add('s','SICK',14,'2026-01-01','2026-01-14');f.add('h','HOSPITAL',60,'2026-02-01','2026-04-01');
    const {svc}=f.create();const actor=await svc.user(f.actor);
    const r=await Promise.all(['s','h'].map(id=>svc.decideLeave(actor,id,true,'Medical certificate reviewed')));
    expect(r.every(q=>q.status==='approved')).toBe(true);
  });
  it('same-request approve/reject racing creates one decision and one audit',async()=>{
    const f=fixture();f.add('a','SICK',1,'2026-11-01','2026-11-01');
    const {svc,store}=f.create();const actor=await svc.user(f.actor);
    const before=(await store.list('audit')).length;
    const r=await Promise.allSettled([svc.decideLeave(actor,'a',true,'Medical certificate reviewed'),svc.decideLeave(actor,'a',false,'Certificate requires correction')]);
    expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect((await store.list('audit')).length-before).toBe(1);
  });
  it('denied decision neither consumes quota nor poisons the next lock',async()=>{
    const f=fixture();f.add('a','SICK',1,'2026-11-01','2026-11-01');
    const {svc,store}=f.create();await expect(svc.decideLeave(await svc.user('u-cm-inas'),'a',true,'Medical certificate reviewed')).rejects.toThrow();
    expect((await store.get('leaveRequests','a'))!.status).toBe('pending');
    expect((await svc.decideLeave(await svc.user(f.actor),'a',true,'Medical certificate reviewed')).status).toBe('approved');
  });
  it('annual and emergency decisions share one allowance',async()=>{
    const f=fixture();f.add('a','ANNUAL',6,'2026-11-01','2026-11-06');f.add('b','EMERGENCY',6,'2026-11-09','2026-11-14');
    const {svc}=f.create();const actor=await svc.user(f.actor);
    const r=await Promise.allSettled(['a','b'].map(id=>svc.decideLeave(actor,id,true,'Cover arranged')));
    expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  });
  it('concurrent HR approvals do not overwrite a stage or excuse absences before VC consent',async()=>{
    const ds=generateDataset({today,now,daysBack:2});
    const asker=ds.users.find(u=>u.department==='it'&&u.personId&&ds.people.some(p=>p.id===u.personId&&p.role==='office'))!;
    const store=new MemoryStore(ds),svc=new PrimaService(store,()=>now);
    const q=await svc.requestLeave(asker,{personId:asker.personId!,kind:'ANNUAL',from:'2026-11-10',to:'2026-11-11',reason:'Family matter'});
    const hr=await svc.user('u-pwvsb-hr'),vc=await svc.user('u-vchair');
    const before=(await store.list('attendanceFollowUps')).length;
    const r=await Promise.allSettled([svc.decideLeave(hr,q.id,true,'Cover arranged first'),svc.decideLeave(hr,q.id,true,'Cover arranged second')]);
    expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    const pending=await store.get('leaveRequests',q.id);expect(pending!.status).toBe('pending');expect(pending!.hrApproval).toBeTruthy();
    expect((await store.list('attendanceFollowUps')).length).toBe(before);
    expect((await svc.decideLeave(vc,q.id,true,'Consent after HR review')).status).toBe('approved');
  });
  it('different people queues remain independent and failed locks release',async()=>{
    const {store}=fixture().create();let release!:()=>void;const gate=new Promise<void>(r=>release=r);let second=false;
    const first=withLeavePersonLock(store,'a',async()=>{await gate;throw Error('synthetic');});
    await withLeavePersonLock(store,'b',async()=>{second=true;});expect(second).toBe(true);release();await expect(first).rejects.toThrow('synthetic');
    expect(await withLeavePersonLock(store,'a',async()=>42)).toBe(42);
  });
});
