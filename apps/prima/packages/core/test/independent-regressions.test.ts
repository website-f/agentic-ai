import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  generateDataset,
  labelDisplay,
  labelFromRandom,
  myt,
  parseLabel,
  parseRfid,
  parseScan,
  sampleLabelToken,
  type Dataset,
  type ItemAction,
  type ItemMovement,
  type PhysicalItem,
} from '../src';

// One item register (Fauzan, 6 Nov 2026; Fitri's paper v1.0). Synthetic data only. Test ids follow the paper (U01-U24).

const TODAY = '2026-11-06';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds: Dataset = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  let tick = 0;
  // Each call is a minute later, so event order is clear.
  const svc = new PrimaService(store, () => myt(TODAY, `11:${String(Math.min(59, Math.floor(tick++ / 4))).padStart(2, '0')}`));
  let rid = 0;
  const act = async (userId: string, a: ItemAction, requestId = `req-test-${++rid}`) => {
    const u = await svc.user(userId);
    const out = (await svc.items.act(u, requestId, a)) as { replay: boolean; result: unknown };
    // P85: registering is followed by printing each label and scanning it back (paper 3.1), as the register screen does.
    if (a.kind === 'item.register' && Array.isArray(out.result) && out.result.length) {
      const printed = (await svc.items.act(u, `${requestId}-print`, { kind: 'label.print', itemIds: (out.result as PhysicalItem[]).map((i) => i.id) })) as { result: { labels: { printId: string; payload: string }[] } };
      for (const l of printed.result.labels) await svc.items.act(u, `${requestId}-verify-${l.printId.slice(-8)}`, { kind: 'label.verify', printId: l.printId, scan: { code: l.payload, source: 'camera' } });
    }
    return out.result as never;
  };
  const board = async (userId: string) => svc.items.board(await svc.user(userId));
  return { ds, svc, store, act, board };
}

const STORE = 'u-proc-store1';
const PROC = 'u-proc-exec';
const SASA_CM = 'u-cm-sasa';
const SASA_GM = 'u-gm-sasa';
const SASA_SV = 'u-sv-sasa';
const GUARD = 'u-guard-sasa-1';
const FD = 'u-fd';

async function registerShirts(t: ReturnType<typeof fresh>, count: number) {
  const items = (await t.act(STORE, { kind: 'item.register', skuId: 'sku-shirt-l', partyId: 'goodwill', count })) as PhysicalItem[];
  for (const i of items) await t.act(STORE, { kind: 'item.inspect', label: i.token, condition: 'new', note: '' });
  return items;
}

async function saleOf(t: ReturnType<typeof fresh>, items: PhysicalItem[]) {
  const m = (await t.act(STORE, { kind: 'move.create', type: 'sale', fromPartyId: 'goodwill', toPartyId: 'co-sasa', purpose: 'Test sale' })) as ItemMovement;
  for (const i of items) await t.act(STORE, { kind: 'move.add', movementId: m.id, label: i.token });
  await t.act(STORE, { kind: 'move.dispatch', movementId: m.id, carrier: 'Test van' });
  return m;
}

const PDF = (n: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 synthetic ${n}`).toString('base64')}`;

/** Invoice (seller Finance), payment slip (buyer Finance) and the buyer manager's signed acknowledgement letter. */
async function salePapers(t: ReturnType<typeof fresh>, movementId: string, tag = 'a') {
  await t.act(FD, { kind: 'move.paper', movementId, paper: 'invoice', ref: `INV-MOCK-${tag}`, date: TODAY, doc: { name: 'invoice.pdf', data: PDF(`inv ${tag} ${movementId}`) } });
  await t.act(FD, { kind: 'move.paper', movementId, paper: 'payment_slip', ref: `PAY-MOCK-${tag}`, date: TODAY, doc: { name: 'slip.pdf', data: PDF(`pay ${tag} ${movementId}`) } });
  await t.act(SASA_GM, { kind: 'move.acknowledge', movementId, ref: `ACK-MOCK-${tag}`, date: TODAY, signedBy: 'General Manager (mock)' });
}

describe('Independent review regressions on f26a3f8', () => {
  it('approving a 3-unit bulk sale must not transfer 7 units from another unapproved sale', async () => {
    const t = fresh();
    const sku = await t.act(STORE,{kind:'sku.add',code:'INDEP-BULK',name:'Independent bulk test stock',category:'cleaning',tracking:'BULK',uom:'PCS',consumable:true}) as any;
    const lot = await t.act(STORE, {kind:'lot.add', skuId:sku.id, partyId:'goodwill', qty:10, note:'Independent test stock'}) as any;
    async function send(qty:number) {
      const m = await t.act(STORE, {kind:'move.create',type:'sale',fromPartyId:'goodwill',toPartyId:'co-sasa',purpose:'Independent bulk test'}) as any;
      await t.act(STORE, {kind:'move.addLot',movementId:m.id,lotId:lot.id,qty});
      await t.act(STORE, {kind:'move.dispatch',movementId:m.id,carrier:'Test van'});
      await t.act(SASA_CM, {kind:'move.receive',movementId:m.id,lines:[],lotLines:[{lotId:lot.id,qty}]});
      return m;
    }
    const first = await send(3); const other = await send(7);
    await salePapers(t,first.id);
    await t.act(FD,{kind:'move.ownership',movementId:first.id,effectiveOn:TODAY,basis:'Only first sale approved'});
    const lots = (await t.store.list('itemLots')).filter(x=>x.custody.partyId==='co-sasa' && x.skuId===lot.skuId);
    console.log('Bulk ownership after approving 3-unit sale:',lots.map(x=>({qty:x.qty,owner:x.ownerPartyId})), 'Other sale ownership:',(await t.store.get('itemMovements',other.id))!.ownership);
    expect(lots.filter(x=>x.ownerPartyId==='goodwill').reduce((n,x)=>n+x.qty,0)).toBe(7);
  });

  it('receiving one kit component must not allow handing over its still-in-transit second component', async () => {
    const t = fresh();
    const [shirt] = await registerShirts(t,1);
    const [trouser] = await t.act(STORE,{kind:'item.register',skuId:'sku-trouser-32',partyId:'goodwill',count:1}) as PhysicalItem[];
    await t.act(STORE,{kind:'item.inspect',label:trouser.token,condition:'new',note:''});
    const kit = await t.act(STORE,{kind:'kit.assemble',skuId:'sku-uniset-l',partyId:'goodwill',labels:[shirt.token,trouser.token]}) as PhysicalItem;
    const m = await saleOf(t,[kit]);
    await t.act(SASA_CM,{kind:'move.receive',movementId:m.id,lines:[{itemId:shirt.id,result:'received'}]});
    const siteId = (await t.svc.user(SASA_SV)).siteIds[0];
    await expect(t.act(SASA_CM,{kind:'issue',label:kit.token,siteId})).rejects.toThrow();
    const missing = (await t.store.get('physicalItems',trouser.id))!;
    console.log('Unreceived kit component after handover:',{state:missing.state,custody:missing.custody},'Receipt line:',(await t.store.get('itemMovements',m.id))!.lines.find(x=>x.itemId===trouser.id));
    expect(missing.state).toBe('in_transit');
  });

  it('taking back and reissuing the same free uniform must not require a fourth-piece payment', async () => {
    const t = fresh();
    const items = await registerShirts(t,3); const m=await saleOf(t,items);
    await t.act(SASA_CM,{kind:'move.receive',movementId:m.id,lines:items.map(i=>({itemId:i.id,result:'received'}))});
    const busy=new Set(t.ds.itemEvents.filter(e=>e.to?.kind==='person').map(e=>e.to!.ref));
    const g=t.ds.people.find(p=>p.companyId==='co-sasa'&&p.role==='guard'&&p.status==='active'&&!busy.has(p.id))!;
    for (const i of items) await t.act(SASA_CM,{kind:'issue',label:i.token,personId:g.id,reason:'Test extra approved'});
    await t.act(SASA_CM,{kind:'return',label:items[0].token,condition:'good',note:'Same item returned briefly'});
    await t.act(SASA_CM,{kind:'item.inspect',label:items[0].token,condition:'good',note:'Same item checked'});
    await expect(t.act(SASA_CM,{kind:'issue',label:items[0].token,personId:g.id,reason:'Returning the same garment'})).resolves.toBeTruthy();
  });

  it('seller lifecycle view must hide buyer employee identities, including event actor fields', async () => {
    const t = fresh(); t.ds.grants=t.ds.grants.filter(g=>g.userId!==STORE);
    const [item]=await registerShirts(t,1); const m=await saleOf(t,[item]);
    await t.act(SASA_CM,{kind:'move.receive',movementId:m.id,lines:[{itemId:item.id,result:'received'}]});
    await salePapers(t,m.id);await t.act(FD,{kind:'move.ownership',movementId:m.id,effectiveOn:TODAY,basis:'Test ownership terms'});
    await t.act(SASA_CM,{kind:'issue',label:item.token,siteId:(await t.svc.user(SASA_SV)).siteIds[0]});
    const view=await t.svc.items.resolve(await t.svc.user(STORE),item.token);
    const event=view.events.find(e=>e.kind==='issue')!;
    console.log('Seller can read buyer event actor:',event.by,event.byId,event.partyIds);
    expect(event.byId).toBe('(hidden)');
  });
});

describe('Controlled concurrency interleaving, not a PostgreSQL run', () => {
  it('stock add must reread quantity after a prior transaction commits while it awaits lock', async () => {
    const t=fresh();
    const lot=await t.act(STORE,{kind:'lot.add',skuId:'sku-floor-5l',partyId:'goodwill',qty:10,note:'Test stock'}) as any;
    const before=lot.qty;
    let once=true;
    (t.store as any).lock=async (table:string,id:string)=>{
      if(once && table==='itemLots' && id===lot.id){
        once=false;
        const current=(await t.store.get('itemLots',lot.id))!;
        await t.store.update('itemLots',lot.id,{qty:current.qty+5,version:current.version+1});
      }
    };
    await t.act(STORE,{kind:'lot.add',skuId:'sku-floor-5l',partyId:'goodwill',qty:3,note:'Second stock receipt'});
    const after=(await t.store.get('itemLots',lot.id))!.qty;
    console.log('Controlled lost update: before',before,'concurrent +5 then +3, expected',before+8,'actual',after);
    expect(after).toBe(before+8);
  });
});

describe('Receipt and privacy repair boundaries', () => {
  it('keeps rental and other-owner stock separate from an approved sale, and refuses unallocated legacy receipts', async () => {
    const t = fresh();
    const sku = await t.act(STORE, {kind:'sku.add',code:'ISOLATED-BULK',name:'Allocation stock',category:'cleaning',tracking:'BULK',uom:'PCS',consumable:true}) as any;
    const lot = await t.act(STORE, {kind:'lot.add',skuId:sku.id,partyId:'goodwill',qty:20,note:'Test delivery'}) as any;
    async function send(type: 'sale'|'rental', qty: number) {
      const m = await t.act(STORE, {kind:'move.create',type,fromPartyId:'goodwill',toPartyId:'co-sasa',purpose:'Allocation regression',dueBackOn:'2026-12-01',commercialRef:'Mock terms'}) as any;
      await t.act(STORE,{kind:'move.addLot',movementId:m.id,lotId:lot.id,qty});
      await t.act(STORE,{kind:'move.dispatch',movementId:m.id,carrier:'Mock van'});
      await t.act(SASA_CM,{kind:'move.receive',movementId:m.id,lotLines:[{lotId:lot.id,qty}]});
      return (await t.store.get('itemMovements',m.id))!;
    }
    const sale = await send('sale',3), rental = await send('rental',7);
    await t.store.insert('itemLots',{id:'other-owner-lot',skuId:sku.id,ownerPartyId:'co-arsh',custody:{kind:'store',partyId:'co-sasa',ref:'store:co-sasa',label:'Test store',since:NOW},qty:4,version:1,partyIds:['co-arsh','co-sasa']});
    await salePapers(t,sale.id);
    await t.act(FD,{kind:'move.ownership',movementId:sale.id,effectiveOn:TODAY,basis:'Test sale allocation only'});
    expect((await t.store.get('itemLots','other-owner-lot'))!.ownerPartyId).toBe('co-arsh');
    expect((await t.store.get('itemLots',rental.lotLines[0].receivedLotId!))!.ownerPartyId).toBe('goodwill');
    const legacy = await send('sale',2);
    await salePapers(t,legacy.id,'legacy');
    await t.store.update('itemMovements',legacy.id,{lotLines:legacy.lotLines.map(({receivedLotId,...l})=>l)});
    await expect(t.act(FD,{kind:'move.ownership',movementId:legacy.id,effectiveOn:TODAY,basis:'Legacy needs reconciliation'})).rejects.toThrow(/allocation/);
  });

  it('accepts a complete kit but refuses an independently quarantined component at issue', async () => {
    const t=fresh(); const [shirt]=await registerShirts(t,1);
    const [trouser]=await t.act(STORE,{kind:'item.register',skuId:'sku-trouser-32',partyId:'goodwill',count:1}) as PhysicalItem[];
    await t.act(STORE,{kind:'item.inspect',label:trouser.token,condition:'new',note:''});
    const kit=await t.act(STORE,{kind:'kit.assemble',skuId:'sku-uniset-l',partyId:'goodwill',labels:[shirt.token,trouser.token]}) as PhysicalItem;
    const m=await saleOf(t,[kit]);
    await t.act(SASA_CM,{kind:'move.receive',movementId:m.id,lines:[{itemId:shirt.id,result:'received'},{itemId:trouser.id,result:'received'}]});
    expect((await t.store.get('physicalItems',kit.id))!.state).toBe('available');
    await t.store.update('physicalItems',trouser.id,{state:'quarantine'});
    await expect(t.act(SASA_CM,{kind:'issue',label:kit.token,siteId:(await t.svc.user(SASA_SV)).siteIds[0]})).rejects.toThrow(/component/);
    expect((await t.store.get('physicalItems',shirt.id))!.state).toBe('available');
  });

  it('redacts event notes, case authors and independent resolution authors on resolve and board', async () => {
    const t=fresh(); t.ds.grants=t.ds.grants.filter(g=>g.userId!==STORE);
    const [item]=await registerShirts(t,1), m=await saleOf(t,[item]);
    await t.act(SASA_CM,{kind:'move.receive',movementId:m.id,lines:[{itemId:item.id,result:'received',note:'Private Buyer Employee'}]});
    await salePapers(t,m.id);
    await t.act(FD,{kind:'move.ownership',movementId:m.id,effectiveOn:TODAY,basis:'Privacy test completed sale'});
    const c=await t.act(SASA_CM,{kind:'service.request',label:item.token,note:'Private Buyer Employee requests service'}) as any;
    await t.store.update('itemCases',c.id,{status:'resolved',resolution:{actorPartyIds:['co-sasa'],by:'Private Resolver',byId:'private-resolver-id',at:NOW,outcome:'serviced',note:'Private Resolution Note'}});
    const view=await t.svc.items.resolve(await t.svc.user(STORE),item.token);
    const masked=view.cases.find(x=>x.id===c.id)!;
    expect(masked.openedById).toBe('(hidden)');expect(masked.resolution!.byId).toBe('(hidden)');
    expect(JSON.stringify(view)).not.toContain('Private Buyer Employee');
    expect(JSON.stringify(view)).not.toContain('Private Resolver');
    expect(JSON.stringify(view)).not.toContain('Private Resolution Note');
    expect((await t.board(STORE)).cases.find(x=>x.id===c.id)!.openedById).toBe('(hidden)');
    const own=await t.svc.items.resolve(await t.svc.user(SASA_CM),item.token);
    expect(own.cases.find(x=>x.id===c.id)!.openedById).toBe(SASA_CM);
  });
});
