import {describe,it,expect} from 'vitest';
import {generateDataset,MemoryStore,ItProcurementService,procurementPurchaseHash,InvoiceAssistService,MemoryWorkEventOutbox,SyntheticGateway,
  outboundBlockReason,workEventProblems,assistMoveAllowed,ASSIST_CONTRACT_VERSION,type GatewayRequest,type GatewayResponse} from '../src';

// Synthetic data only. The gateway is a deterministic stand-in; no provider is called.
let n=0;const uuid=()=>`33333333-3333-4333-8333-${String(++n).padStart(12,'0')}`;
let now='2026-11-02T08:00:00Z';
const usage={input_tokens:420,output_tokens:60,cached_tokens:0,cost_myr:0.01,price_version:'synthetic-2026-11'};
const goodDraft={ref:'INV-SYN-1',invoiceOn:'2026-11-02',supplier:'Aaa',amount:200,qty:[2],unitPrices:[100]};
const drafted=(draft:unknown=goodDraft)=>(r:GatewayRequest):GatewayResponse=>({status:'drafted',request_id:r.request_id,provider:'synthetic',model:'synthetic-extractor',policy_version:'gw-0.1',routing_reason:'synthetic test route',usage,draft});
const invoiceText='TAX INVOICE INV-SYN-1\nDate 2 Nov 2026\nFrom Aaa\nLine 0 Synthetic laptop 2 x RM100.00\nTotal RM200.00';

function fresh(answer:(r:GatewayRequest)=>GatewayResponse=drafted(),opts:{enabled?:boolean}={}){
  now='2026-11-02T08:00:00Z';
  const ds=generateDataset({today:'2026-11-02',now}),store=new MemoryStore(ds),clock=()=>now,proc=new ItProcurementService(store,clock);
  const it=ds.users.find(x=>x.id==='u-it-ex1')!,coo=ds.users.find(x=>x.opsTier==='coo')!,ceo=ds.users.find(x=>x.opsTier==='ceo')!,fin=ds.users.find(x=>x.department==='finance'&&x.financeRole==='leader')!;
  ds.itPurchaseFinanceAuthorities=[{id:'merdeka',version:1,financeTeam:fin.financeTeam!,configuredBy:'synthetic-admin',configuredAt:'2026-10-01T00:00:00Z'}];
  const proof=[{id:'proof',name:'synthetic evidence',mime:'application/pdf',size:1}] as any;
  const p:any={id:'synthetic-po',ref:'BUY-SYN',ownerId:'merdeka',requestedBy:it.name,requestedById:it.id,at:'2026-10-31T00:00:00Z',reason:'Synthetic equipment',items:[{kind:'LAPTOP',description:'Synthetic laptop',qty:2,unitPrice:100}],total:200,status:'finance',managerStep:{by:'Manager',at:now,note:'Need agreed'},cooStep:{by:coo.name,at:now,note:'Approved',decision:'approve',via:'prima'},ceoStep:{by:ceo.name,at:now,note:'Approved',decision:'approve',via:'prima'},quotes:['Aaa','Bbb','Ccc'].map(supplier=>({supplier,amount:200,ref:'Q',proof,by:it.name,at:now})),online:[{source:'synthetic',amount:200,ref:'https://example.test/listing',proof,by:it.name,at:now}],chosen:{index:0,reason:'Best'},finance:null,delivery:null,purRequestId:null,received:null};
  ds.itPurchases=[p];
  const gateway=new SyntheticGateway(answer),outbox=new MemoryWorkEventOutbox();
  const assist=new InvoiceAssistService(store,{enabled:opts.enabled??true,gateway,outbox,clock,ids:uuid,training:true});
  return {ds,store,proc,assist,gateway,outbox,it,fin,p};
}
async function ready(f:ReturnType<typeof fresh>){
  await f.proc.save(f.fin,'po',{requestId:uuid(),purchaseId:f.p.id,expectedVersion:0,purchaseHash:procurementPurchaseHash(f.p),poRef:'PO-SYN',issuedOn:'2026-11-02',evidence:'Synthetic approved PO'});
  await f.proc.save(f.it,'receipt',{requestId:uuid(),purchaseId:f.p.id,expectedVersion:1,ref:'DO-SYN',receivedOn:'2026-11-02',qty:[2],location:'Synthetic store',evidence:'Signed delivery evidence'});
}

describe('Arisha invoice assistance (first joint milestone, synthetic)',()=>{
  it('end to end: draft, deterministic check, confirm, scoped submit, events and cost',async()=>{
    const f=fresh();await ready(f);
    const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    expect(r.job.state).toBe('awaiting_approval');expect(r.job.draftOrigin).toBe('gateway_unverified');expect(r.comparison!.allMatch).toBe(true);
    // Minimised payload: no prices, totals, people or evidence leave Prima.
    const sent=JSON.stringify(f.gateway.calls[0].reference??f.gateway.calls[0].payload.reference);
    expect(sent).not.toMatch(/100|200|evidence|u-|Manager/);expect(f.gateway.calls[0].data_class).toBe('internal');
    const done=await f.assist.confirm(f.fin,r.job.id,{fields:goodDraft,confirmationHash:r.confirmationHash!,evidence:'Synthetic supplier invoice INV-SYN-1'});
    expect(done).toMatchObject({state:'succeeded',outcome:{terminal:'committed'},confirmation:{edited:false}});
    const packet=f.ds.itProcurementPackets[0];expect(packet.invoiceChecks).toHaveLength(1);expect(packet.invoiceChecks[0]).toMatchObject({matched:true,byId:f.fin.id});
    const ev=f.outbox.list({task_id:r.job.taskId});
    expect(ev.map(e=>e.event_type)).toEqual(['assist.requested','assist.gateway_decision','assist.draft_ready','assist.confirmed','assist.submitted']);
    expect(ev.every(e=>workEventProblems(e).length===0&&e.training)).toBe(true);
    expect(ev.find(e=>e.event_type==='assist.gateway_decision')!.detail.cost_myr).toBe(0.01);
    expect(ev.find(e=>e.event_type==='assist.confirmed')!.executor_id).toBe(f.fin.id);
  });
  it('switched off by default refuses before any gateway call',async()=>{
    const f=fresh(drafted(),{enabled:false});await ready(f);
    await expect(f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText})).rejects.toThrow(/switched off/);expect(f.gateway.calls).toHaveLength(0);
  });
  it('people without invoice-check authority are refused and nothing is sent',async()=>{
    const f=fresh();await ready(f);
    await expect(f.assist.prepare(f.it,{purchaseId:f.p.id,documentText:invoiceText})).rejects.toThrow();expect(f.gateway.calls).toHaveLength(0);
  });
  it('restricted text is blocked before the gateway (fail closed)',async()=>{
    const f=fresh();await ready(f);
    const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText+'\nPay to account 5123456789012'});
    expect(r.job.state).toBe('failed');expect(f.gateway.calls).toHaveLength(0);
    expect(outboundBlockReason('IC 900101-14-5555')).toBe('identity card number');expect(outboundBlockReason('api_key=abc')).toBe('credentials');expect(outboundBlockReason(invoiceText)).toBeNull();
  });
  it('malformed, mismatched-id, denied and over-budget gateway answers are discarded',async()=>{
    for(const answer of [drafted({...goodDraft,extra:1}),drafted({...goodDraft,qty:[2,1]}),
      (r:GatewayRequest):GatewayResponse=>({...drafted()(r),request_id:'other'} as GatewayResponse),
      (r:GatewayRequest):GatewayResponse=>({status:'denied',request_id:r.request_id,policy_version:'gw',reason:'no eligible endpoint',usage:null}),
      (r:GatewayRequest):GatewayResponse=>({...drafted()(r),usage:{...usage,cost_myr:5}} as GatewayResponse),
      ()=>{throw new Error('down');}]){
      const f=fresh(answer as any);await ready(f);
      const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
      expect(r.job.state).toBe('failed');expect(r.confirmationHash).toBeNull();expect(f.ds.itProcurementPackets[0].invoiceChecks).toHaveLength(0);
    }
  });
  it('a wrong model total is shown as a mismatch, and arithmetic is checked deterministically',async()=>{
    const f=fresh(drafted({...goodDraft,amount:210}));await ready(f);
    const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    expect(r.comparison).toMatchObject({allMatch:false,totalMatches:false,arithmeticMatches:false});
  });
  it('confirmation is bound to the exact values: edits need a fresh check, and the edit is recorded',async()=>{
    const f=fresh(drafted({...goodDraft,ref:'INV-SYN-X'}));await ready(f);
    const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    const corrected={...goodDraft};
    await expect(f.assist.confirm(f.fin,r.job.id,{fields:corrected,confirmationHash:r.confirmationHash!,evidence:'Synthetic invoice'})).rejects.toThrow(/exact values/);
    const c=await f.assist.check(f.fin,r.job.id,corrected);
    expect(await f.assist.confirm(f.fin,r.job.id,{fields:corrected,confirmationHash:c.confirmationHash,evidence:'Synthetic invoice'})).toMatchObject({state:'succeeded',confirmation:{edited:true}});
  });
  it('a packet change after the draft cancels it; nothing is submitted against the new version',async()=>{
    const f=fresh();await ready(f);
    const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    await f.proc.save(f.fin,'invoice',{requestId:uuid(),purchaseId:f.p.id,expectedVersion:2,...goodDraft,ref:'INV-HAND',evidence:'Entered by hand'});
    await expect(f.assist.confirm(f.fin,r.job.id,{fields:goodDraft,confirmationHash:r.confirmationHash!,evidence:'Synthetic invoice'})).rejects.toThrow(/changed/);
    expect((await f.assist.view(f.fin,r.job.id)).state).toBe('cancelled');expect(f.ds.itProcurementPackets[0].invoiceChecks).toHaveLength(1);
  });
  it('drafts expire after the confirmation window',async()=>{
    const f=fresh();await ready(f);const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    now='2026-11-02T08:20:00Z';
    await expect(f.assist.confirm(f.fin,r.job.id,{fields:goodDraft,confirmationHash:r.confirmationHash!,evidence:'Synthetic invoice'})).rejects.toThrow(/expired/);
  });
  it('another person cannot see or confirm the job',async()=>{
    const f=fresh();await ready(f);const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    await expect(f.assist.view(f.it,r.job.id)).rejects.toThrow();
    await expect(f.assist.confirm(f.it,r.job.id,{fields:goodDraft,confirmationHash:r.confirmationHash!,evidence:'Synthetic invoice'})).rejects.toThrow();
  });
  it('an uncertain submission is reconciled by the fixed request UUID, never retried blindly',async()=>{
    const f=fresh();await ready(f);const r=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    // Simulate a lost response: the write commits, then the connection fails before Prima sees the result.
    const save=f.proc.save.bind(f.proc);(f.assist as any).procurement.save=async(...a:any[])=>{await save(...(a as [any,any,any]));throw new Error('socket closed');};
    const u=await f.assist.confirm(f.fin,r.job.id,{fields:goodDraft,confirmationHash:r.confirmationHash!,evidence:'Synthetic invoice'});
    expect(u.state).toBe('outcome_unknown');
    await expect(f.assist.confirm(f.fin,r.job.id,{fields:goodDraft,confirmationHash:r.confirmationHash!,evidence:'Synthetic invoice'})).rejects.toThrow(/no longer waiting/);
    expect(await f.assist.reconcile(f.fin,r.job.id)).toMatchObject({state:'succeeded',outcome:{terminal:'committed'}});
    expect(f.ds.itProcurementPackets[0].invoiceChecks).toHaveLength(1);
  });
  it('event outbox stores one result per id and refuses a conflicting reuse',()=>{
    const o=new MemoryWorkEventOutbox();
    const e={event_id:'e1',schema_version:ASSIST_CONTRACT_VERSION,company_id:'merdeka',actor_id:'u1',executor_id:'svc:prima-assist',device_id:null,task_id:'t1',source:'prima' as const,event_type:'assist.requested',event_time:'2026-11-02T08:00:00Z',received_time:'2026-11-02T08:00:00Z',source_sequence:1,application:'prima-secure',result:'ok' as const,reason:null,evidence_ref:null,policy_version:null,training:true,detail:{}};
    expect(o.append(e)).toEqual({stored:true,replayed:false});expect(o.append({...e})).toEqual({stored:true,replayed:true});
    expect(o.append({...e,result:'failed'})).toMatchObject({stored:false});expect(o.append({...e,event_id:'e2',detail:{text:'x'.repeat(500)}})).toMatchObject({stored:false});
    expect(o.list()).toHaveLength(1);
  });
  it('job states follow the plan lifecycle',()=>{
    expect(assistMoveAllowed('running','outcome_unknown')).toBe(true);expect(assistMoveAllowed('outcome_unknown','running')).toBe(false);expect(assistMoveAllowed('succeeded','running')).toBe(false);
  });
});
