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


describe('Independent PR124 adversarial review',()=>{
  it('gates restricted PO reference fields before any outbound call', async()=>{
    const f=fresh();await ready(f);
    f.ds.itProcurementPackets[0].po.items[0].description='password: synthetic-review-marker';
    await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    expect(f.gateway.calls).toHaveLength(0);
  });
  it('rejects a drafted gateway response with missing usage accounting',async()=>{
    const f=fresh((r:any)=>({...drafted()(r),usage:null}) as any);await ready(f);
    const out=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    expect(out.job.state).toBe('failed');
  });
  it('rejects non-finite gateway cost rather than treating it as within budget',async()=>{
    const f=fresh((r:any)=>({...drafted()(r),usage:{...usage,cost_myr:NaN}}) as any);await ready(f);
    const out=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    expect(out.job.state).toBe('failed');
  });
  it('rechecks current procurement authority before returning a saved invoice draft',async()=>{
    const f=fresh();await ready(f);
    const out=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    const revoked={...f.it,id:f.fin.id}; Object.assign(f.fin,revoked);
    await expect(f.assist.check(revoked,out.job.id,goodDraft)).rejects.toThrow();
    await expect(f.assist.view(revoked,out.job.id)).rejects.toThrow();
  });

  it.each(['ref', 'supplier', 'description'])('blocks restricted PO %s text in the final minimized request', async field => {
    const f=fresh(); await ready(f);
    const po=f.ds.itProcurementPackets[0].po;
    if(field==='description') po.items[0].description='secret: synthetic-only';
    else (po as any)[field]='secret: synthetic-only';
    const out=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    expect(out.job.state).toBe('failed'); expect(f.gateway.calls).toHaveLength(0);
    expect(out.job.draft).toBeNull(); expect(out.confirmationHash).toBeNull();
  });

  it.each([
    null, undefined, [], {status:'other'},
    ...['input_tokens','output_tokens','cached_tokens','cost_myr'].flatMap(field =>
      [NaN,Infinity,-Infinity,-1,'0',null,undefined].map(value => ({usage:{...usage,[field]:value}}))),
    ...['input_tokens','output_tokens','cached_tokens'].flatMap(field =>
      [0.5,Number.MAX_SAFE_INTEGER+1].map(value => ({usage:{...usage,[field]:value}}))),
    {usage:undefined},{usage:[]},{usage:{...usage,price_version:''}},
    {provider:null},{model:''},{policy_version:42},{routing_reason:[]},
  ])('fails closed on malformed response/accounting %#', async patch => {
    const f=fresh(r => (patch && !Array.isArray(patch) ? {...drafted()(r),...patch} : patch) as any); await ready(f);
    const out=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    expect(out.job.state).toBe('failed'); expect(out.job.draft).toBeNull();
    expect(out.job.usage).toBeNull(); expect(out.confirmationHash).toBeNull();
    expect(f.outbox.list().some(e=>e.event_type==='assist.draft_ready')).toBe(false);
    expect(f.outbox.list().every(e=>workEventProblems(e).length===0)).toBe(true);
  });

  it('accepts complete zero-cost accounting and returns an isolated authorized view', async()=>{
    const f=fresh(r=>({...drafted()(r),usage:{...usage,input_tokens:0,output_tokens:0,cached_tokens:0,cost_myr:0}})); await ready(f);
    const out=await f.assist.prepare(f.fin,{purchaseId:f.p.id,documentText:invoiceText});
    expect(out.job.state).toBe('awaiting_approval');
    const view=await f.assist.view(f.fin,out.job.id); view.draft!.supplier='Changed';
    expect((await f.assist.view(f.fin,out.job.id)).draft!.supplier).toBe('Aaa');
  });

  it.each(['role','closed','integration','missing','team','authority','company'])('checks stored authority after %s changes despite stale caller claims',async change=>{
    const f=fresh(); await ready(f);
    const stale=structuredClone(f.fin);
    const out=await f.assist.prepare(stale,{purchaseId:f.p.id,documentText:invoiceText});
    if(change==='role') f.fin.department='it';
    if(change==='closed') f.fin.accessClosedFrom='2026-11-02';
    if(change==='integration') f.fin.integration='ja';
    if(change==='missing') f.ds.users=[];
    if(change==='team') f.fin.financeTeam=999;
    if(change==='authority') f.ds.itPurchaseFinanceAuthorities[0].version++;
    if(change==='company') await f.store.update('itPurchases',f.p.id,{ownerId:'pwvsb'});
    await expect(f.assist.view(stale,out.job.id)).rejects.toThrow();
  });
});
