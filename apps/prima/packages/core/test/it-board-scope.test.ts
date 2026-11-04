import {describe,it,expect} from 'vitest';
import {generateDataset,MemoryStore,PrimaService} from '../src';
const now='2026-11-01T08:00:00Z';
describe('IT derived read models preserve role scope',()=>{
 for(const role of ['hr','finance'] as const) it(`${role}: hidden registers cannot affect counts, team summaries or plan`,async()=>{
  const ds=generateDataset({today:'2026-11-01',now}),u=ds.users.find(u=>role==='hr'?u.department==='hr':u.leadership==='finance_director')!;
  const svc=new PrimaService(new MemoryStore(ds),()=>now),before=await svc.itBoard(u),plan=await svc.itPlan(u,'year','2026-11-01');
  const hidden=['itAccounts','itOnboarding','itDomains','itTickets','itAccessRequests','itCodeHolders',...(role==='hr'?['itAssets','itPurchases']:['itJobs','itTenderTasks'])];
  const filtered=structuredClone(ds);for(const key of hidden)(filtered as any)[key]=[];
  const fs=new PrimaService(new MemoryStore(filtered),()=>now),after=await fs.itBoard(u);
  expect(before.kpis).toEqual(after.kpis);expect(before.teamRows).toEqual(after.teamRows);expect(before.byKind).toEqual(after.byKind);expect(before.codeCheck).toEqual(after.codeCheck);expect(plan).toEqual(await fs.itPlan(u,'year','2026-11-01'));
  expect(before.accounts).toEqual([]);expect(before.onboarding).toEqual([]);expect(before.kpis?.accessWaiting).toBe(0);expect(before.kpis?.accessReviewDue).toBe(0);expect(before.kpis?.onboardingLate).toBe(0);
  expect(plan.dues.some(d=>['access','domain','ssl','tender'].includes(d.what))).toBe(false);
  if(role==='hr'){expect(before.tenders).toEqual([]);expect(before.teamRows?.some(r=>r.tenderSteps>0)).toBe(true);expect(before.assets).toEqual([]);expect(before.kpis?.assets).toBe(0);expect(before.byKind).toEqual([]);expect(plan.dues).toEqual([]);}else{expect(before.jobs).toEqual([]);expect(plan.jobs).toEqual([]);expect(before.kpis?.jobsOpen).toBe(0);expect(before.assets?.length).toBeGreaterThan(0);}
 });
 it('IT and ACT retain register views; integration actors gain none',async()=>{
  const ds=generateDataset({today:'2026-11-01',now}),svc=new PrimaService(new MemoryStore(ds),()=>now);
  for(const id of ['u-it-mgr','u-audit']){const b=await svc.itBoard(ds.users.find(u=>u.id===id)!);expect(b.accounts?.length).toBeGreaterThan(0);expect(b.assets?.length).toBeGreaterThan(0);}
  const u={...ds.users.find(u=>u.id==='u-it-mgr')!,integration:{kind:'synthetic'}} as any;expect((await svc.itBoard(u)).kpis).toBeUndefined();await expect(svc.itPlan(u)).rejects.toThrow();
 });
});
