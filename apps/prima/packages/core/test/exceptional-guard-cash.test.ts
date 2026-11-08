import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, type User } from '../src';
import { evidence, fixture } from './cash-test-fixture';
describe('manual exceptional guard cash boundary',()=>{
  it('accepts only DOA handover, authoritative guard identity and manual named evidence; approval is not payout',async()=>{
    const x=await fixture(); const r=await x.submit();
    expect(r.name).toBe(x.guard.name);expect(r.siteId).toBe(x.site.id);expect(r.amount).toBe(150);expect(r.payout).toBeNull();
    expect(r.classification).toBe('payroll');expect(r.budgetCategory).toBe('Miscellaneous payroll expenses');
    expect(x.ds.evidenceDocs.filter(d=>d.id.startsWith('doc-excash-'))).toHaveLength(2); expect(x.ds.audit.some(a=>a.action==='finance.exceptionalcash.submit')).toBe(true);
  });
  it('denies guards, OMs, CEO, other staff and forged caller roles for direct requests',async()=>{
    const x=await fixture();for(const u of [x.om,x.ceo,x.finance,x.user('u-pwvsb-hr'),{...x.om,department:'director_office'} as User]) await expect(x.action(u,'submit',x.body())).rejects.toThrow();
    const g=x.ds.users.find(u=>u.role==='guard')!;if(g) await expect(x.action(g,'submit',x.body())).rejects.toThrow();
    await expect(x.svc.financeControls.exceptionalCashView(x.om,x.companyId)).rejects.toThrow();
  });
  it('denies cross-company, non-guard, inactive guard, wrong site/occasion and wrong OM',async()=>{
    const x=await fixture();
    const bads=[{personId:x.ds.people.find(p=>p.companyId!==x.companyId)!.id},{personId:x.ds.people.find(p=>p.role==='office')!.id},{siteId:x.ds.sites.find(s=>s.companyId!==x.companyId)!.id},{occasion:'2026-02-30'},{occasion:'2025-10-31'}];
    for(const patch of bads){const b=x.body();Object.assign(b.rows[0],patch);await expect(x.action(x.doa,'submit',b)).rejects.toThrow();}
    const b=x.body();b.rows[0].request.byId=x.fd.id;await expect(x.action(x.doa,'submit',b)).rejects.toThrow(/Operations Manager/);
    x.guard.status='left';await expect(x.submit()).rejects.toThrow(/active guard/);
  });
  it('enforces company grants, Finance teams and site restrictions',async()=>{
    const x=await fixture(); const other=x.ds.users.find(u=>u.department==='finance' && u.financeTeam!==x.f.team && u.financeRole==='data_entry')!;
    await expect(x.svc.financeControls.exceptionalCashView(other,x.companyId)).rejects.toThrow();
    x.doa.siteIds=[x.ds.sites.find(s=>s.id!==x.site.id)!.id];await expect(x.submit()).rejects.toThrow(/Site/);
    x.doa.siteIds=[];x.ds.grants=x.ds.grants.filter(g=>g.userId!==x.doa.id || g.companyId!==x.companyId);
    // MemoryStore holds the original array: remove its records in place instead.
    const store=new MemoryStore(x.ds);const svc=new PrimaService(store,()=>x.now());await expect(svc.financeControls.exceptionalCashView(x.doa,x.companyId)).rejects.toThrow();
  });
  it('rejects missing evidence, missing attestation, invalid approval role/timing and unsafe amounts atomically',async()=>{
    const x=await fixture();
    for(const mutate of [
      (b:any)=>b.evidenceChecked=false,(b:any)=>b.rows[0].request.evidence=null,(b:any)=>b.rows[0].approval.evidence=null,
      (b:any)=>b.rows[0].approval.byId=x.fd.id,(b:any)=>b.rows[0].approval.at='2026-11-01T10:00:00+08:00',
      (b:any)=>b.rows[0].approval.at='2026-10-31T07:00:00+08:00',
      ...[0,-1,NaN,Infinity,1.001].map(n=>(b:any)=>b.rows[0].amount=n),
    ]) {const b=x.body();mutate(b);await expect(x.action(x.doa,'submit',b)).rejects.toThrow();expect(x.ds.finStatus.find(f=>f.companyId===x.companyId)!.exceptionalGuardCash??[]).toHaveLength(0);expect(x.ds.evidenceDocs.filter(d=>d.id.startsWith('doc-excash-'))).toHaveLength(0);}
  });
  it('rejects duplicate batch/approval/guard-occasion and mixed valid-invalid batches without partial writes',async()=>{
    const x=await fixture();const b=x.body();b.rows.push({...b.rows[0],personId:'missing'});await expect(x.action(x.doa,'submit',b)).rejects.toThrow();expect(x.ds.evidenceDocs.filter(d=>d.id.startsWith('doc-excash-'))).toHaveLength(0);
    await x.submit(); await expect(x.action(x.doa,'submit',x.body())).rejects.toThrow(/Batch/);
    await expect(x.action(x.doa,'submit',x.body('two'))).rejects.toThrow(/occasion/);expect(x.ds.finStatus.find(f=>f.companyId===x.companyId)!.exceptionalGuardCash).toHaveLength(1);
  });
  it('allows a changed amount only under a fresh manual approval before preparation',async()=>{
    const x=await fixture(),r=await x.submit();await expect(x.action(x.finance,'prepare',{id:r.id,ref:'prep',custodianId:x.finance.id,amount:160})).rejects.toThrow(/approved amount/);
    const b=x.body('two');Object.assign(b.rows[0],{supersedes:r.id,amount:200});const [next]=await x.action(x.doa,'submit',b);
    expect(x.ds.finStatus.find(f=>f.companyId===x.companyId)!.exceptionalGuardCash![0].status).toBe('superseded');expect(next.amount).toBe(200);
    await expect(x.action(x.finance,'prepare',{id:r.id,ref:'prep',custodianId:x.finance.id})).rejects.toThrow();
    await x.action(x.finance,'prepare',{id:next.id,ref:'prep',custodianId:x.finance.id});
    const c=x.body('three');Object.assign(c.rows[0],{supersedes:next.id,amount:250});await expect(x.action(x.doa,'submit',c)).rejects.toThrow(/unprepared/);
  });
  it('rejects reused approval evidence for a replacement and recipient changes through lifecycle actions',async()=>{
    const x=await fixture(),r=await x.submit();const b=x.body('two');Object.assign(b.rows[0],{supersedes:r.id,amount:250});b.rows[0].approval.evidence=x.body().rows[0].approval.evidence;
    await expect(x.action(x.doa,'submit',b)).rejects.toThrow(/new approval evidence/);
    await expect(x.action(x.finance,'prepare',{id:r.id,ref:'prep',custodianId:x.finance.id,personId:'other'})).rejects.toThrow(/immutable/);
  });
  it('requires preparation and correct custodian, prevents amount increases and duplicate payouts',async()=>{
    const x=await fixture(),r=await x.submit();const p={id:r.id,amount:150,atPaid:x.now(),ref:'payment',evidence:evidence('pay')};
    await expect(x.action(x.finance,'pay',p)).rejects.toThrow(/Prepare/);
    await x.action(x.finance,'prepare',{id:r.id,ref:'prep',custodianId:x.finance.id});
    await expect(x.action(x.fd,'pay',p)).rejects.toThrow(/custodian/);
    await expect(x.action(x.finance,'pay',{...p,amount:151})).rejects.toThrow(/exceeds/);
    await x.action(x.finance,'pay',p);await expect(x.action(x.finance,'pay',p)).rejects.toThrow();
    await expect(x.action(x.finance,'complete',{id:r.id})).rejects.toThrow(/evidence/);
  });
  it('requires a new transaction-specific signed receipt after payment, collected only by DOA',async()=>{
    const x=await fixture(),r=await x.paid();const p={id:r.id,amount:120,signedByPersonId:x.guard.id,paymentRef:'payment-1',signedAt:x.now(),transactionSpecific:true,evidence:evidence('signed')};
    await expect(x.action(x.finance,'receipt',p)).rejects.toThrow();
    for(const patch of [{transactionSpecific:false},{signedByPersonId:'wrong'},{paymentRef:'wrong'},{amount:119},{signedAt:'2026-10-31T09:00:00+08:00'}]) await expect(x.action(x.doa,'receipt',{...p,...patch})).rejects.toThrow();
    await expect(x.action(x.fd,'reconcile',{id:r.id,returned:30,ref:'return',evidence:evidence('return')})).rejects.toThrow(/signed receipt/);
    await x.action(x.doa,'receipt',p);await expect(x.action(x.doa,'receipt',p)).rejects.toThrow(/only once/);
  });
  it('requires separate Finance return count, exact reconciliation and statutory/accounting evidence before completion',async()=>{
    const x=await fixture(),r=await x.receipted();const p={id:r.id,returned:30,ref:'return',evidence:evidence('return')};
    await expect(x.action(x.finance,'reconcile',p)).rejects.toThrow(/different Finance/);
    await expect(x.action(x.fd,'reconcile',{...p,returned:29})).rejects.toThrow(/Paid plus returned/);
    await x.action(x.fd,'reconcile',p);
    await expect(x.action(x.fd,'post',{id:r.id})).rejects.toThrow(/Confirm/);
    await expect(x.action(x.fd,'complete',{id:r.id})).rejects.toThrow();
    const post={id:r.id,journalRef:'journal-line-1',payrollRecordRef:'supplemental-pay-1',additionalPayrollConfirmed:true,statutoryRecordsConfirmed:true,evidence:evidence('accounting')};
    await x.action(x.fd,'post',post);await expect(x.action(x.fd,'post',post)).rejects.toThrow(/once/);
    await x.action(x.fd,'complete',{id:r.id});await expect(x.action(x.fd,'complete',{id:r.id})).rejects.toThrow();
    expect(x.ds.finStatus.find(f=>f.companyId===x.companyId)!.exceptionalGuardCash![0].accounting?.amount).toBe(120);
  });
  it('adds additional payroll exactly once to the correct site P&L without changing attendance or ordinary wages',async()=>{
    const x=await fixture();const monitor=()=>x.site.sector==='government'?x.svc.govOpsMonitor(x.ceo,'2026-10'):x.svc.privateOpsMonitor(x.ceo,'2026-10');
    const before=await monitor();const hours=await x.svc.siteHoursBoard(x.ceo,{companyId:x.companyId,month:'2026-10'});
    const unchanged=structuredClone([x.ds.attendance,x.ds.shifts,x.ds.guardPayRuns,x.ds.staffPayRuns,x.ds.people]);
    const r=await x.reconciled();const pending=await monitor();expect(pending.sites.find(s=>s.siteId===x.site.id)!.cashPayrollPending).toBe(120);
    await x.action(x.fd,'post',{id:r.id,journalRef:'journal',payrollRecordRef:'supplemental',additionalPayrollConfirmed:true,statutoryRecordsConfirmed:true,evidence:evidence('accounting')});
    await x.action(x.fd,'complete',{id:r.id});const after=await monitor();
    const a=after.sites.find(s=>s.siteId===x.site.id)!,b=before.sites.find(s=>s.siteId===x.site.id)!;
    expect(a.cashPayroll).toBe(120);expect(a.cashPayrollPending).toBe(0);expect(a.cashPayrollTrace).toHaveLength(1);expect(a.guardCost).toBe(b.guardCost);expect(a.clockedHours).toBe(b.clockedHours);
    if(b.margin!==null) expect(a.margin).toBeCloseTo(b.margin-120,2);
    expect(after.sites.filter(s=>s.siteId!==x.site.id)).toEqual(before.sites.filter(s=>s.siteId!==x.site.id));
    expect(await x.svc.siteHoursBoard(x.ceo,{companyId:x.companyId,month:'2026-10'})).toEqual(hours);
    expect([x.ds.attendance,x.ds.shifts,x.ds.guardPayRuns,x.ds.staffPayRuns,x.ds.people]).toEqual(unchanged);
  });
  it('keeps legacy daily cash closed and refuses nonexistent wage cash records',async()=>{
    const x=await fixture();for(const u of [x.doa,x.fd,x.ceo,x.om,x.finance]) {
      for(const a of ['add','edit','submit','approve','listCash','decideCash','withdraw','pay','transfer']) await expect(x.svc.financeControls.dailyCashAction(u,x.companyId,a,{})).rejects.toThrow(/Legacy/);
      for(const a of ['list','unlist','decide','handout'] as const) await expect(x.svc.guardPayCash(u,'none','none',a,{})).rejects.toThrow();
    }
  });
  it('returns wholly unpaid cash without inventing a payout, receipt or payroll expense',async()=>{
    const x=await fixture(),r=await x.submit();await x.action(x.finance,'prepare',{id:r.id,ref:'withdrawal',custodianId:x.finance.id});
    await expect(x.action(x.finance,'returnUnpaid',{id:r.id,returned:150,ref:'return',evidence:evidence('return')})).rejects.toThrow(/different Finance/);
    await expect(x.action(x.fd,'returnUnpaid',{id:r.id,returned:149,ref:'return',evidence:evidence('return')})).rejects.toThrow(/entire/);
    await x.action(x.fd,'returnUnpaid',{id:r.id,returned:150,ref:'return',evidence:evidence('return')});await x.action(x.fd,'complete',{id:r.id});
    const saved=(await x.svc.financeControls.exceptionalCashView(x.fd,x.companyId)).rows[0];expect(saved.status).toBe('complete');expect(saved.payout).toBeNull();expect(saved.accounting).toBeNull();
  });
  it('allows evidence downloads only for authorized company/site rows; master omits bank, pay and identity secrets',async()=>{
    const x=await fixture(),r=await x.submit();
    const doc=await x.svc.financeControls.exceptionalCashEvidence(x.doa,x.companyId,r.approval.evidence);expect(doc.data).toBe(x.body().rows[0].approval.evidence.data);
    await expect(x.svc.financeControls.exceptionalCashEvidence(x.om,x.companyId,r.approval.evidence)).rejects.toThrow();
    await expect(x.svc.financeControls.exceptionalCashEvidence(x.doa,x.companyId,x.ds.evidenceDocs.find(d=>!d.id.startsWith('doc-excash-'))!.id)).rejects.toThrow();
    const master=(await x.svc.financeControls.exceptionalCashView(x.doa,x.companyId)).master;expect(master.length).toBeGreaterThan(0);expect(Object.keys(master[0]).sort()).toEqual(['assignments','companyId','name','personId','staffNo']);
    x.doa.siteIds=[x.ds.sites.find(s=>s.id!==x.site.id)!.id];await expect(x.svc.financeControls.exceptionalCashEvidence(x.doa,x.companyId,r.approval.evidence)).rejects.toThrow();
  });

  it('accepts a named approved day-off occasion using the current or next site assignment without inventing hours',async()=>{
    const x=await fixture(),b=x.body();b.rows[0].occasion='2026-11-01';
    const shifts=structuredClone(x.ds.shifts),attendance=structuredClone(x.ds.attendance);
    const [r]=await x.action(x.doa,'submit',b);expect(r.occasion).toBe('2026-11-01');
    x.setNow('2026-11-01T00:30:00+08:00');await x.action(x.finance,'prepare',{id:r.id,ref:'night-prep',custodianId:x.finance.id});
    await x.action(x.finance,'pay',{id:r.id,ref:'night-paid',amount:150,atPaid:'2026-10-31T16:30:00Z',evidence:evidence('night-payment')});
    expect(x.ds.shifts).toEqual(shifts);expect(x.ds.attendance).toEqual(attendance);
  });

  it('accepts a shared manual approval list while binding each named row and approval line separately',async()=>{
    const x=await fixture(),b=x.body();
    const other=x.ds.people.find(p=>p.id!==x.guard.id&&p.role==='guard'&&p.status==='active'&&p.companyId===x.companyId&&x.ds.shifts.some(sh=>sh.personId===p.id&&sh.siteId===x.site.id&&sh.date==='2026-10-31'&&sh.status==='published'))!;
    expect(other).toBeTruthy();b.rows.push({...b.rows[0],personId:other.id,approval:{...b.rows[0].approval,id:'approval-one-row2'}});
    const rows=await x.action(x.doa,'submit',b);expect(rows).toHaveLength(2);expect(rows[0].approval.evidence).toBe(rows[1].approval.evidence);expect(x.ds.evidenceDocs.filter(d=>d.id.startsWith('doc-excash-'))).toHaveLength(2);
  });

  it('exports only scoped published guard assignments and excludes unpublished draft rosters',async()=>{
    const x=await fixture();
    const shift=x.ds.shifts.find(sh=>sh.personId===x.guard.id&&sh.siteId===x.site.id)!;
    x.ds.shifts.push({...shift,id:'synthetic-unpublished',date:'2027-01-19',status:'draft'});
    const view=await x.svc.financeControls.exceptionalCashView(x.doa,x.companyId);
    expect(view.master.flatMap(p=>p.assignments).some(a=>a.date==='2027-01-19')).toBe(false);
    x.doa.siteIds=[x.site.id];const scoped=await x.svc.financeControls.exceptionalCashView(x.doa,x.companyId);
    expect(scoped.master.flatMap(p=>p.assignments).every(a=>a.siteId===x.site.id)).toBe(true);
  });
  it('gates destructive cancellation/correction/reversal while preserving posted evidence and site accounting',async()=>{
    const x=await fixture(),r=await x.reconciled();
    await x.action(x.fd,'post',{id:r.id,journalRef:'correction-gate-journal',payrollRecordRef:'correction-gate-payroll',additionalPayrollConfirmed:true,statutoryRecordsConfirmed:true,evidence:evidence('correction-gate-accounting')});
    await x.action(x.fd,'complete',{id:r.id});
    const before=structuredClone([x.ds.finStatus,x.ds.evidenceDocs,x.ds.audit,x.ds.guardPayRuns,x.ds.attendance]);
    for(const action of ['cancel','correct','reverse']) await expect(x.action(x.fd,action,{id:r.id})).rejects.toThrow(/gated/);
    await expect(x.action(x.fd,'returnUnpaid',{id:r.id,returned:150,ref:'invalid',evidence:evidence('invalid')})).rejects.toThrow(/wholly unpaid/);
    await expect(x.action(x.doa,'submit',{...x.body('replacement'),rows:[{...x.body('replacement').rows[0],supersedes:r.id}]})).rejects.toThrow(/unprepared/);
    expect([x.ds.finStatus,x.ds.evidenceDocs,x.ds.audit,x.ds.guardPayRuns,x.ds.attendance]).toEqual(before);
  });

  it('includes unrostered buffer guards for company-wide readers but never expands site-limited access or payment eligibility',async()=>{
    const x=await fixture(); const buffer={...x.guard,id:'synthetic-buffer',staffNo:'BUFFER',name:'Synthetic buffer'};
    x.ds.people.push(buffer);
    const read=()=>x.svc.financeControls.exceptionalCashView(x.doa,x.companyId);
    expect((await read()).master.find(p=>p.personId===buffer.id)?.assignments).toEqual([]);
    const b=x.body();b.rows[0].personId=buffer.id;await expect(x.action(x.doa,'submit',b)).rejects.toThrow(/roster/);
    x.doa.siteIds=[x.site.id];expect((await read()).master.some(p=>p.personId===buffer.id)).toBe(false);
    x.doa.siteIds=[];buffer.status='left';expect((await read()).master.some(p=>p.personId===buffer.id)).toBe(false);
  });
  it('records actual site expense while treatment is pending, then appends a scoped review without reposting or changing wages',async()=>{
    const x=await fixture(),r=await x.reconciled();
    const wages=structuredClone([x.ds.guardPayRuns,x.ds.staffPayRuns,x.ds.people,x.ds.attendance]);
    const p={id:r.id,journalRef:'pending-journal',payrollRecordRef:'pending-register',additionalPayrollConfirmed:true,statutoryRecordsConfirmed:false,treatmentStatus:'pending',evidence:evidence('pending-accounting')};
    await expect(x.action(x.fd,'post',{...p,statutoryRecordsConfirmed:true})).rejects.toThrow(/Pending/);
    await x.action(x.fd,'post',p);await expect(x.action(x.fd,'post',p)).rejects.toThrow(/once/);
    await expect(x.action(x.fd,'complete',{id:r.id})).rejects.toThrow(/pending/);
    const read=()=>x.svc.financeControls.exceptionalCashView(x.fd,x.companyId);
    const accounting=structuredClone((await read()).rows[0].accounting);
    const monitor=()=>x.site.sector==='government'?x.svc.govOpsMonitor(x.ceo,'2026-10'):x.svc.privateOpsMonitor(x.ceo,'2026-10');
    const before=(await monitor()).sites.find(s=>s.siteId===x.site.id)!;expect(before.cashPayroll).toBe(120);expect(before.cashPayrollTrace).toHaveLength(1);
    const review={id:r.id,policyRef:'synthetic-adviser-treatment-decision',recordRef:'synthetic-required-records',statutoryRecordsConfirmed:true,evidence:evidence('treatment-review')};
    for(const u of [x.doa,x.om,x.ceo]) await expect(x.action(u,'reviewTreatment',review)).rejects.toThrow();
    await expect(x.action(x.fd,'reviewTreatment',{...review,statutoryRecordsConfirmed:false})).rejects.toThrow(/Confirm/);
    await x.action(x.fd,'reviewTreatment',review);await expect(x.action(x.fd,'reviewTreatment',review)).rejects.toThrow(/once/);
    const saved=(await read()).rows[0];expect(saved.accounting).toEqual(accounting);
    if(saved.treatment?.status==='reviewed') expect((await x.svc.financeControls.exceptionalCashEvidence(x.doa,x.companyId,saved.treatment.evidence)).data).toBe(review.evidence.data);
    await x.action(x.fd,'complete',{id:r.id});
    expect((await monitor()).sites.find(s=>s.siteId===x.site.id)).toEqual(before);
    expect([x.ds.guardPayRuns,x.ds.staffPayRuns,x.ds.people,x.ds.attendance]).toEqual(wages);
  });
  it.each(['application/pdf','image/png','image/jpeg'])('accepts a genuine transaction acknowledgement supplied as %s and keeps missing evidence pending',async(mime)=>{
    const x=await fixture(),r=await x.paid();
    await expect(x.action(x.fd,'post',{id:r.id})).rejects.toThrow(/receipt/);
    await x.action(x.doa,'receipt',{id:r.id,signedAt:x.now(),transactionSpecific:true,signedByPersonId:x.guard.id,paymentRef:'payment-1',amount:120,evidence:{name:'remote-ack',data:`data:${mime};base64,${Buffer.from('SYNTHETIC transaction acknowledgement').toString('base64')}`}});
    expect((await x.svc.financeControls.exceptionalCashView(x.doa,x.companyId)).rows[0].receipt).toBeTruthy();
  });

});
