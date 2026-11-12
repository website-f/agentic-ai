import { MemoryStore, PrimaService, generateDataset, myt, type User } from '../src';
import { siteStateOf } from '../src/service';
import { onOpsSide } from '../src/ops-access';
import { finActor } from '../src/finance';
export const evidence = (tag: string) => ({ name: `${tag}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`SYNTHETIC DOCUMENT ONLY ${tag}`).toString('base64')}` });
export async function fixture() {
  const today = '2026-10-31'; let now = myt(today, '12:00');
  const ds = generateDataset({ today, now }); const svc = new PrimaService(new MemoryStore(ds), () => now);
  const branchStates = new Map(ds.branches.map(b => [b.id,b.state]));
  const om = ds.users.find(u => u.id === 'u-om-klang')!;
  const site = ds.sites.find(s => om.areaStates!.includes(siteStateOf(s, branchStates)) && onOpsSide(om,s.sector) && ds.shifts.some(sh => sh.siteId===s.id && sh.date===today && sh.status==='published' && ds.people.some(p=>p.id===sh.personId && p.role==='guard' && p.status==='active')))!;
  const shift=ds.shifts.find(sh=>sh.siteId===site.id && sh.date===today && ds.people.some(p=>p.id===sh.personId&&p.role==='guard'&&p.status==='active'))!;
  const guard=ds.people.find(p=>p.id===shift.personId)!;
  const companyId=site.companyId, f=ds.finStatus.find(f=>f.companyId===companyId)!;
  const user=(id:string)=>ds.users.find(u=>u.id===id)!;
  const doa=user('u-pwvsb-doa'), fd=user('u-fd'), ceo=user('u-fauzan');
  // P100 B1: the company's guard pay preparer, named by its Company Manager (a synthetic one when the seed has none).
  const named=ds.guardPayPreparers.find(p=>p.companyId===companyId && p.active);
  if (!named) {
    ds.users.push({id:'u-test-preparer',name:'Test Preparer (synthetic)',title:'Admin Executive (test)',role:'admin_exec',companyIds:[companyId],siteIds:[]} as User);
    ds.guardPayPreparers.push({id:`gpp-${companyId}-u-test-preparer`,companyId,userId:'u-test-preparer',userName:'Test Preparer (synthetic)',title:'Admin Executive (test)',active:true,named:{by:'Test Manager',byId:'u-test-cm',at:now,reason:'Synthetic preparer for the test'},removed:null,history:[]});
  }
  const preparer=user(named?.userId ?? 'u-test-preparer');
  const finance=ds.users.find(u=>u.department==='finance' && u.financeTeam===f.team && u.financeRole==='leader')!;
  const body=(tag='one')=>({version:1,batchId:`batch-${tag}`,workbookRef:'Controlled workbook v1',evidenceChecked:true,rows:[{personId:guard.id,siteId:site.id,occasion:today,amount:150,reason:'New guard needs additional support to attend work',request:{byId:om.id,at:myt(today,'08:00'),evidence:evidence(`om-${tag}`)},approval:{id:`approval-${tag}`,byId:ceo.id,at:myt(today,'09:00'),evidence:evidence(`approval-${tag}`)}}]});
  const action=(u:User,a:string,b:Record<string,unknown>)=>svc.financeControls.exceptionalCashAction(u,companyId,a,b);
  const submit=async()=> (await action(doa,'submit',body()))[0];
  const paid=async()=>{
    const r=await submit();await action(finance,'prepare',{id:r.id,ref:'withdrawal-1',custodianId:finance.id});
    await action(finance,'pay',{id:r.id,amount:120,atPaid:now,ref:'payment-1',evidence:evidence('payment')});return r;
  };
  const receipted=async()=>{const r=await paid();await action(doa,'receipt',{id:r.id,signedAt:now,transactionSpecific:true,signedByPersonId:guard.id,paymentRef:'payment-1',amount:120,evidence:evidence('receipt')});return r;};
  const reconciled=async()=>{const r=await receipted();await action(fd,'reconcile',{id:r.id,returned:30,ref:'deposit-1',evidence:evidence('reconciliation')});return r;};
  return {ds,svc,site,guard,om,companyId,f,doa,fd,ceo,finance,preparer,body,action,submit,paid,receipted,reconciled,user,now:()=>now,setNow:(v:string)=>{now=v;}};
}
