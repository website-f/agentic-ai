import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, demoPin, generateDataset, myt, type Dataset } from '../src';

// Go-live readiness for Government Operations and Procurement (Fauzan, 2 Nov 2026). Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

let slipN = 0;
const slip = () => ({ kind: 'document' as const, name: 'Issue slip.jpg', data: `data:image/jpeg;base64,${Buffer.from(`synthetic slip ${++slipN}`).toString('base64')}` });

const photo = () => ({ kind: 'document' as const, name: 'Guard with item.jpg', data: `data:image/jpeg;base64,${Buffer.from(`synthetic photo ${++slipN}`).toString('base64')}` });

// A synthetic PNG large enough to count as a drawn signature (the size check only; the screen checks the ink).
const sig = (n: number) => `data:image/png;base64,${Buffer.from(`synthetic signature ${n} `.repeat(40)).toString('base64')}`;

function witness(ds: Dataset, companyId: string, notIds: (string | null | undefined)[] = []) {
  const p = ds.people.find((x) => x.companyId === companyId && x.status === 'active' && x.pinHash && !notIds.includes(x.id))!;
  return { staffNo: p.staffNo, pin: demoPin(p.staffNo) };
}

const patrolOf = (ds: Dataset, companyId: string) => ds.people.find((p) => p.companyId === companyId && p.status === 'active' && p.role === 'patrol_officer')!;

const site = (over: Record<string, unknown>) => ({
  code: 'GOV-T1',
  name: 'Synthetic government office',
  client: 'Synthetic ministry',
  address: 'Synthetic address',
  lat: 3.07,
  lng: 101.5,
  geofenceM: 150,
  risk: 'low',
  sector: 'government',
  armed: false,
  ...over,
});

describe('Government Operations go-live: sites without a branch', () => {
  it('lets a site be saved with its state instead of a branch, and the OM, Regional OM and OGM for that state see it', async () => {
    const { svc, store } = fresh();
    const ceo = await svc.user('u-fauzan');
    await expect(svc.saveRecord(ceo, 'site', null, 'co-sasa', site({}))).rejects.toThrow(/branch, or the state/);
    const saved = (await svc.saveRecord(ceo, 'site', null, 'co-sasa', site({ state: 'Selangor' }))) as { id: string };
    const row = (await store.list('sites', { companyId: 'co-sasa' })).find((s) => s.code === 'GOV-T1')!;
    expect(row.branchId).toBe('');
    expect(row.state).toBe('Selangor');
    const sees = async (uid: string) => (await svc.sites(await svc.user(uid), 'co-sasa')).some((s) => s.site.id === row.id);
    expect(await sees('u-om-klang')).toBe(true);
    expect(await sees('u-rom-central')).toBe(true);
    expect(await sees('u-ogm')).toBe(true);
    expect(await sees('u-om-johor')).toBe(false);
    expect(await sees('u-opsdir')).toBe(false);
    expect(saved).toBeTruthy();
  });
});

describe('Government Operations go-live: the OGM keeps government sites, seven regions', () => {
  it('lets the OGM add and edit government sites only, and keeps it out of private sites', async () => {
    const { svc, store } = fresh();
    const ogm = await svc.user('u-ogm');
    await svc.saveRecord(ogm, 'site', null, 'co-sasa', site({ state: 'Perak', code: 'GOV-OGM1' }));
    const row = (await store.list('sites', { companyId: 'co-sasa' })).find((s) => s.code === 'GOV-OGM1')!;
    expect(row.sector).toBe('government');
    await svc.saveRecord(ogm, 'site', row.id, 'co-sasa', site({ state: 'Perak', code: 'GOV-OGM1', name: 'Renamed synthetic office' }));
    expect((await store.get('sites', row.id))!.name).toBe('Renamed synthetic office');
    await expect(svc.saveRecord(ogm, 'site', null, 'co-sasa', site({ state: 'Perak', code: 'PRV-1', sector: 'private' }))).rejects.toThrow(/government sites only/);
    const priv = (await store.list('sites', { companyId: 'co-sasa' })).find((s) => (s.sector ?? 'private') === 'private')!;
    await expect(svc.saveRecord(ogm, 'site', priv.id, 'co-sasa', site({ state: 'Perak', sector: 'government' }))).rejects.toThrow(/government sites only/);
    // Neither the Operations Director nor an OM gets the site form.
    await expect(svc.saveRecord(await svc.user('u-opsdir'), 'site', null, 'co-sasa', site({ state: 'Perak', code: 'X1' }))).rejects.toThrow();
    await expect(svc.saveRecord(await svc.user('u-om-klang'), 'site', null, 'co-sasa', site({ state: 'Selangor', code: 'X2' }))).rejects.toThrow();
  });

  it('has seven regions with Perak, Sarawak and Sabah on their own', async () => {
    const { REGIONS, regionOfState } = await import('../src');
    expect(REGIONS.map((r) => r.name)).toEqual(['Northern', 'Perak', 'Central', 'Southern', 'Eastern', 'Sarawak', 'Sabah']);
    expect(regionOfState('Perak')!.id).toBe('perak');
    expect(regionOfState('Kedah')!.id).toBe('northern');
    expect(regionOfState('Labuan')!.id).toBe('sabah');
    expect(new Set(REGIONS.flatMap((r) => r.states)).size).toBe(REGIONS.flatMap((r) => r.states).length);
  });
});

describe('Goodwill regional teams cover government sites only', () => {
  it('keeps a government-side OM and Regional OM to government sites in their area', async () => {
    const { ds, svc, store } = fresh();
    for (const id of ['u-om-klang', 'u-rom-central']) ds.users.find((u) => u.id === id)!.opsSector = 'government';
    const ceo = await svc.user('u-fauzan');
    await svc.saveRecord(ceo, 'site', null, 'co-sasa', site({ state: 'Selangor', code: 'GOV-S1' }));
    await svc.saveRecord(ceo, 'site', null, 'co-sasa', site({ state: 'Selangor', code: 'PRV-S1', sector: 'private' }));
    const rows = await store.list('sites', { companyId: 'co-sasa' });
    const gov = rows.find((s) => s.code === 'GOV-S1')!;
    const prv = rows.find((s) => s.code === 'PRV-S1')!;
    for (const id of ['u-om-klang', 'u-rom-central']) {
      const seen = (await svc.sites(await svc.user(id), 'co-sasa')).map((r) => r.site.id);
      expect(seen).toContain(gov.id);
      expect(seen).not.toContain(prv.id);
      expect(seen.every((sid) => rows.find((s) => s.id === sid)!.sector === 'government')).toBe(true);
    }
  });
});

describe('Goodwill Empire Sdn Bhd employs the Government Operations team', () => {
  it('employs the OGM and the store team, and HR can add Goodwill staff', async () => {
    const { ds, svc } = fresh();
    const { GOV_OPS_COMPANY_ID, centralStaffName, tenantCompanyIds } = await import('../src');
    for (const id of ['u-ogm', 'u-proc-exec', 'u-proc-store1', 'u-proc-store2']) {
      const u = ds.users.find((x) => x.id === id)!;
      expect(ds.people.find((p) => p.id === u.personId)!.companyId).toBe(GOV_OPS_COMPANY_ID);
    }
    const hr = ds.users.find((u) => u.role === 'pwvsb_officer' && u.department === 'hr')!;
    const form = await svc.recordForm(hr, 'officeStaff', null, null);
    expect(form.chooseCompany!.some(([id, name]) => id === GOV_OPS_COMPANY_ID && name === centralStaffName(GOV_OPS_COMPANY_ID))).toBe(true);
    expect(centralStaffName(GOV_OPS_COMPANY_ID)).toMatch(/Goodwill Empire Sdn Bhd/);
    expect(tenantCompanyIds(hr, ds.grants, TODAY)).toContain(GOV_OPS_COMPANY_ID);
  });
});

describe('Procurement go-live: opening stock and issue slips', () => {
  it('holds a typed opening stock until another storekeeper counts it with a witness', async () => {
    const { ds, svc, store } = fresh();
    const { GOV_OPS_COMPANY_ID } = await import('../src');
    const ex = await svc.user('u-proc-exec');
    const sk = await svc.user('u-proc-store1');
    // Store items belong to Goodwill Empire's store only.
    await expect(svc.saveRecord(ex, 'stockItem', null, 'co-arsh', { sku: 'UNI-X', name: 'Synthetic shirt', kind: 'UNIFORM', reorderAt: 5, onHand: 1 })).rejects.toThrow();
    await svc.saveRecord(ex, 'stockItem', null, GOV_OPS_COMPANY_ID, { sku: 'UNI-T1', name: 'Synthetic shirt', kind: 'UNIFORM', size: 'M', consumable: false, reorderAt: 5, onHand: 20 });
    const item = (await store.list('stockItems', { companyId: [GOV_OPS_COMPANY_ID] })).find((i) => i.sku === 'UNI-T1')!;
    expect(item.opening).toMatchObject({ qty: 20, byId: 'u-proc-exec', confirmed: null });
    const person = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active')!;
    await expect(svc.stockIssue(sk, GOV_OPS_COMPANY_ID, { itemId: item.id, personId: person.id, qty: 1, slip: [slip()] })).rejects.toThrow(/opening stock is not confirmed/);
    await expect(svc.stockCount(ex, item.id, 20, witness(ds, GOV_OPS_COMPANY_ID, [ex.personId]))).rejects.toThrow(/another storekeeper/);
    const counted = await svc.stockCount(sk, item.id, 18, witness(ds, GOV_OPS_COMPANY_ID, [sk.personId]));
    expect(counted.onHand).toBe(18);
    expect(counted.opening!.confirmed).toMatchObject({ counted: 18, by: sk.name });
    // After confirmation a difference is shown, never written into the stock.
    const again = await svc.stockCount(sk, item.id, 17, witness(ds, GOV_OPS_COMPANY_ID, [sk.personId]));
    expect(again.onHand).toBe(18);
    expect(ds.audit.some((a) => a.action === 'store.opening.confirm' && a.entityId === item.id)).toBe(true);
  });

  it('needs a signed slip for someone with no Prima account, and keeps own confirmation for account holders', async () => {
    const { ds, svc } = fresh();
    const sk = await svc.user('u-proc-store2');
    const withAccount = new Set(ds.users.map((u) => u.personId).filter(Boolean));
    const guard = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active' && !withAccount.has(p.id))!;
    await expect(svc.stockIssue(sk, 'co-arsh', { itemId: 'stk-co-arsh-7', personId: guard.id, qty: 1 })).rejects.toThrow(/no Prima account/);
    const i = await svc.stockIssue(sk, 'co-arsh', { itemId: 'stk-co-arsh-7', personId: guard.id, qty: 1, slip: [slip()] });
    expect(i.acknowledged).toBe(true);
    expect(i.slipDocIds).toHaveLength(1);
    expect(ds.evidenceDocs.some((d) => d.id === i.slipDocIds![0])).toBe(true);
    const staff = ds.users.find((u) => u.personId && ds.people.some((p) => p.id === u.personId && p.companyId === 'co-arsh' && p.status === 'active'))!;
    const j = await svc.stockIssue(sk, 'co-arsh', { itemId: 'stk-co-arsh-7', personId: staff.personId!, qty: 1, slip: [slip()] });
    expect(j.acknowledged).toBe(false);
  });

  it('refuses issuing more than the store holds after an earlier issue in the same moment', async () => {
    const { ds, svc } = fresh();
    const sk = await svc.user('u-proc-store1');
    const item = ds.stockItems.find((x) => x.id === 'stk-co-arsh-7')!;
    const withAccount = new Set(ds.users.map((u) => u.personId).filter(Boolean));
    const guard = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active' && !withAccount.has(p.id))!;
    item.onHand = 1;
    await svc.stockIssue(sk, 'co-arsh', { itemId: item.id, personId: guard.id, qty: 1, slip: [slip()] });
    await expect(svc.stockIssue(sk, 'co-arsh', { itemId: item.id, personId: guard.id, qty: 1, slip: [slip()] })).rejects.toThrow(/Only 0 in the store/);
  });

  it("bills each company from Goodwill's store: rental for items held at month end, sale in the month, never a guessed price", async () => {
    const { ds, svc, store } = fresh();
    const { GOV_OPS_COMPANY_ID } = await import('../src');
    const mgr = { ...(await svc.user('u-proc-exec')), procRole: 'manager' as const };
    const ex = await svc.user('u-proc-exec');
    const sk = await svc.user('u-proc-store1');
    // Only the Inventory Manager sets prices.
    await expect(
      svc.saveRecord(ex, 'stockItem', null, GOV_OPS_COMPANY_ID, { sku: 'RAD-1', name: 'Synthetic radio', kind: 'DEVICE', reorderAt: 1, onHand: 0, charge: 'rental', rentalMonthly: 30 }),
    ).rejects.toThrow(/Inventory Manager/);
    await svc.saveRecord(mgr, 'stockItem', null, GOV_OPS_COMPANY_ID, { sku: 'RAD-1', name: 'Synthetic radio', kind: 'DEVICE', reorderAt: 1, onHand: 0, charge: 'rental', rentalMonthly: 30 });
    await svc.saveRecord(mgr, 'stockItem', null, GOV_OPS_COMPANY_ID, { sku: 'UNI-2', name: 'Synthetic cap', kind: 'UNIFORM', reorderAt: 1, onHand: 0, charge: 'sale', salePrice: 12.5 });
    await svc.saveRecord(mgr, 'stockItem', null, GOV_OPS_COMPANY_ID, { sku: 'UNI-3', name: 'Synthetic belt', kind: 'UNIFORM', reorderAt: 1, onHand: 0, charge: 'sale' });
    const items = await store.list('stockItems', { companyId: [GOV_OPS_COMPANY_ID] });
    for (const it of items) it.onHand = 10;
    const byName = (n: string) => items.find((i) => i.name === n)!;
    const withAccount = new Set(ds.users.map((u) => u.personId).filter(Boolean));
    const guardA = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active' && !withAccount.has(p.id))!;
    const guardS = ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active' && !withAccount.has(p.id))!;
    const om = await svc.user('u-om-klang');
    const via = (personId: string) => ({ omUserId: om.id, patrolPersonId: patrolOf(ds, ds.people.find((p) => p.id === personId)!.companyId).id });
    const deliver = async (id: string) => {
      await svc.handoverStep(om, id, 'om', { received: true });
      await svc.handoverStep(om, id, 'patrol', { received: true, slip: [slip()] });
      return svc.handoverStep(om, id, 'guard', { received: true, slip: [slip()], photo: [photo()] });
    };
    const i1 = await svc.stockIssue(sk, GOV_OPS_COMPANY_ID, { itemId: byName('Synthetic radio').id, personId: guardA.id, qty: 2, ...via(guardA.id) });
    expect(i1.billTo).toBe('co-arsh');
    const i2 = await svc.stockIssue(sk, GOV_OPS_COMPANY_ID, { itemId: byName('Synthetic cap').id, personId: guardS.id, qty: 3, ...via(guardS.id) });
    const i3 = await svc.stockIssue(sk, GOV_OPS_COMPANY_ID, { itemId: byName('Synthetic belt').id, personId: guardS.id, qty: 1, ...via(guardS.id) });
    // Still on its way to the guard: not billed yet.
    await svc.stockIssue(sk, GOV_OPS_COMPANY_ID, { itemId: byName('Synthetic radio').id, personId: guardS.id, qty: 1, ...via(guardS.id) });
    for (const i of [i1, i2, i3]) await deliver(i.id);
    // A Goodwill staff member is not a company guard to bill.
    const staff = ds.people.find((p) => p.companyId === GOV_OPS_COMPANY_ID)!;
    await expect(svc.stockIssue(sk, GOV_OPS_COMPANY_ID, { itemId: byName('Synthetic cap').id, personId: staff.id, qty: 1, omUserId: om.id })).rejects.toThrow(
      /company Goodwill serves/,
    );
    const board = await svc.purBoard(ex);
    const now = board.billing.find((b) => b.month === TODAY.slice(0, 7))!;
    const arsh = now.companies.find((c) => c.companyId === 'co-arsh')!;
    expect(arsh.total).toBe(60);
    const sasa = now.companies.find((c) => c.companyId === 'co-sasa')!;
    expect(sasa.total).toBe(37.5);
    expect(sasa.missingPrices).toBe(1);
    expect(sasa.notYetReceived).toBe(1);
    // Last month nothing was held yet.
    expect(board.billing[1].companies).toEqual([]);
    // Storekeepers do not see the billing; the company guard's employer is billed, not Goodwill.
    expect((await svc.purBoard(sk)).billing).toEqual([]);
  });
});

describe('Government Operations go-live: every Goodwill item is acknowledged by the OM, the patrolling officer and the guard', () => {
  async function setup() {
    const { ds, store, svc } = fresh();
    const { GOV_OPS_COMPANY_ID } = await import('../src');
    const mgr = { ...(await svc.user('u-proc-exec')), procRole: 'manager' as const };
    await svc.saveRecord(mgr, 'stockItem', null, GOV_OPS_COMPANY_ID, { sku: 'RAD-9', name: 'Synthetic radio', kind: 'DEVICE', reorderAt: 1, onHand: 0, charge: 'rental', rentalMonthly: 30 });
    const item = (await store.list('stockItems', { companyId: [GOV_OPS_COMPANY_ID] })).find((i) => i.name === 'Synthetic radio')!;
    item.onHand = 10;
    const withAccount = new Set(ds.users.map((u) => u.personId).filter(Boolean));
    const guard = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active' && p.role === 'guard' && !withAccount.has(p.id))!;
    const po = patrolOf(ds, 'co-arsh');
    return {
      ds,
      store,
      svc,
      G: GOV_OPS_COMPANY_ID,
      item,
      guard,
      po,
      sk: await svc.user('u-proc-store1'),
      om: await svc.user('u-om-klang'),
      otherOm: await svc.user('u-om-johor'),
      ogm: await svc.user('u-ogm'),
    };
  }

  it('makes the storekeeper name a government OM and the patrolling officer of the guard\'s company', async () => {
    const { ds, svc, G, item, guard, po, sk, om } = await setup();
    const base = { itemId: item.id, personId: guard.id, qty: 1 };
    await expect(svc.stockIssue(sk, G, base)).rejects.toThrow(/government Operations Manager/);
    await expect(svc.stockIssue(sk, G, { ...base, omUserId: 'u-fauzan', patrolPersonId: po.id })).rejects.toThrow(/government Operations Manager/);
    // A private-side OM does not carry Goodwill items.
    const priv = await svc.user('u-om-johor');
    (priv as { opsSector?: string }).opsSector = 'private';
    await svc['store'].update('users', priv.id, { opsSector: 'private' });
    await expect(svc.stockIssue(sk, G, { ...base, omUserId: priv.id, patrolPersonId: po.id })).rejects.toThrow(/government Operations Manager/);
    await expect(svc.stockIssue(sk, G, { ...base, omUserId: om.id })).rejects.toThrow(/patrolling officer of/);
    const otherPo = patrolOf(ds, 'co-sasa');
    await expect(svc.stockIssue(sk, G, { ...base, omUserId: om.id, patrolPersonId: otherPo.id })).rejects.toThrow(/patrolling officer of/);
    await expect(svc.stockIssue(sk, G, { ...base, omUserId: om.id, patrolPersonId: guard.id })).rejects.toThrow(/patrolling officer of/);
    const i = await svc.stockIssue(sk, G, { ...base, omUserId: om.id, patrolPersonId: po.id });
    expect(i.acknowledged).toBe(false);
    expect(i.handover).toMatchObject({ omUserId: om.id, om: null, patrol: { personId: po.id, step: null } });
  });

  it('keeps the order OM -> patrolling officer -> guard, only the named OM confirms their own receipt, and slips are required', async () => {
    const { svc, store, G, item, guard, po, sk, om, otherOm, ogm } = await setup();
    const i = await svc.stockIssue(sk, G, { itemId: item.id, personId: guard.id, qty: 1, omUserId: om.id, patrolPersonId: po.id });
    const pass = await svc.myItems(om);
    expect(pass.toPassOn.map((r) => [r.issue.id, r.next, r.canAct])).toEqual([[i.id, 'om', true]]);
    expect((await svc.myItems(otherOm)).toPassOn).toEqual([]);
    // Out of order.
    await expect(svc.handoverStep(om, i.id, 'patrol', { received: true, slip: [slip()] })).rejects.toThrow(/confirms receiving the item from the store first/);
    await expect(svc.handoverStep(om, i.id, 'guard', { received: true, slip: [slip()] })).rejects.toThrow(/from the store first/);
    // Nobody else confirms the OM's receipt: not another OM, not the OGM, not the storekeeper.
    await expect(svc.handoverStep(otherOm, i.id, 'om', { received: true })).rejects.toThrow(/named Operations Manager/);
    await expect(svc.handoverStep(ogm, i.id, 'om', { received: true })).rejects.toThrow(/named Operations Manager/);
    await expect(svc.handoverStep(sk, i.id, 'om', { received: true })).rejects.toThrow(/named Operations Manager/);
    await svc.handoverStep(om, i.id, 'om', { received: true });
    await expect(svc.handoverStep(om, i.id, 'om', { received: true })).rejects.toThrow(/already confirmed/);
    await expect(svc.handoverStep(om, i.id, 'guard', { received: true, slip: [slip()] })).rejects.toThrow(/acknowledges the item before it reaches/);
    await expect(svc.handoverStep(om, i.id, 'patrol', { received: true })).rejects.toThrow(/signs on the screen, or attach the slip/);
    await svc.handoverStep(om, i.id, 'patrol', { received: true, slip: [slip()] });
    await expect(svc.handoverStep(om, i.id, 'patrol', { received: true, slip: [slip()] })).rejects.toThrow(/already acknowledged/);
    // The guard's own confirmation screen does not bypass the chain.
    const guardUser = { ...(await svc.user('u-fauzan')), personId: guard.id };
    await expect(svc.confirmMyItem(guardUser, i.id, true)).rejects.toThrow(/records your receipt/);
    await expect(svc.handoverStep(om, i.id, 'guard', { received: true })).rejects.toThrow(/signs on the screen, or attach the slip/);
    // The guard's receipt also needs a photo of the guard holding the item: a picture, not the slip again (Fauzan, 2 Nov 2026).
    await expect(svc.handoverStep(om, i.id, 'guard', { received: true, slip: [slip()] })).rejects.toThrow(/photo of .* holding the item/);
    const pdf = { kind: 'document' as const, name: 'x.pdf', data: `data:application/pdf;base64,${Buffer.from('synthetic pdf').toString('base64')}` };
    await expect(svc.handoverStep(om, i.id, 'guard', { received: true, slip: [slip()], photo: [pdf] })).rejects.toThrow(/JPEG or PNG/);
    const same = slip();
    await expect(svc.handoverStep(om, i.id, 'guard', { received: true, slip: [same], photo: [same] })).rejects.toThrow(/different picture/);
    // The OGM can record the guard's signed slip when the OM is away, and the audit says so.
    expect((await svc.myItems(ogm)).toPassOn.find((r) => r.issue.id === i.id)).toMatchObject({ next: 'guard', canAct: true });
    const done = await svc.handoverStep(ogm, i.id, 'guard', { received: true, slip: [slip()], photo: [photo()] });
    expect(done.acknowledged).toBe(true);
    expect(done.slipDocIds?.length).toBe(1);
    expect(done.photoDocIds?.length).toBe(1);
    expect((await svc.myItems(om)).toPassOn).toEqual([]);
    await expect(svc.handoverStep(om, i.id, 'guard', { received: true, slip: [slip()] })).rejects.toThrow(/already acknowledged/);
    const audit = (await store.list('audit', {})).filter((a) => a.entityId === i.id).map((a) => a.action);
    expect(audit).toEqual(['store.issue', 'store.handover.om', 'store.handover.patrol', 'store.handover.guard']);
    expect((await store.list('audit', {})).find((a) => a.entityId === i.id && a.action === 'store.handover.guard')!.summary).toMatch(/recorded by/);
  });

  it('records a problem at any step for the store, and an item for a patrolling officer skips the patrol step', async () => {
    const { svc, G, item, po, sk, om } = await setup();
    const i = await svc.stockIssue(sk, G, { itemId: item.id, personId: po.id, qty: 1, omUserId: om.id });
    expect(i.handover!.patrol).toBeNull();
    await expect(svc.handoverStep(om, i.id, 'om', { received: false })).rejects.toThrow(/Say what is wrong/);
    const d = await svc.handoverStep(om, i.id, 'om', { received: false, note: 'Box arrived empty' });
    expect(d.disputed?.note).toMatch(/Box arrived empty/);
    expect((await svc.purBoard(await svc.user('u-proc-exec'))).kpis.disputed).toBe(1);
    await svc.handoverStep(om, i.id, 'om', { received: true });
    await expect(svc.handoverStep(om, i.id, 'patrol', { received: true, slip: [slip()] })).rejects.toThrow(/straight to the patrolling officer/);
    const done = await svc.handoverStep(om, i.id, 'guard', { received: true, slip: [slip()], photo: [photo()] });
    expect(done.acknowledged).toBe(true);
    expect(done.disputed).toBeNull();
  });

  it('reminds the OM on their home screen and shows the stage to the store', async () => {
    const { svc, G, item, guard, po, sk, om } = await setup();
    await svc.stockIssue(sk, G, { itemId: item.id, personId: guard.id, qty: 1, omUserId: om.id, patrolPersonId: po.id });
    const home = await svc['purHome'](om);
    expect(home[0]).toMatchObject({ tag: 'Goodwill items', go: { view: 'mine' } });
    const board = await svc.purBoard(sk);
    expect(board.govOms.map((u) => u.id)).toContain(om.id);
    expect(board.people.find((p) => p.id === po.id)?.role).toBe('patrol_officer');
  });

  it('accepts a signature drawn on the OM\'s screen instead of the slip and photo', async () => {
    const { svc, store, G, item, guard, po, sk, om } = await setup();
    const i = await svc.stockIssue(sk, G, { itemId: item.id, personId: guard.id, qty: 1, omUserId: om.id, patrolPersonId: po.id });
    await svc.handoverStep(om, i.id, 'om', { received: true });
    await expect(svc.handoverStep(om, i.id, 'patrol', { received: true, signature: 'data:image/jpeg;base64,AAAA' })).rejects.toThrow(/did not come through/);
    await expect(svc.handoverStep(om, i.id, 'patrol', { received: true, signature: 'data:image/png;base64,AAAA' })).rejects.toThrow(/signature is empty/);
    const p = await svc.handoverStep(om, i.id, 'patrol', { received: true, signature: sig(1) });
    expect(p.handover!.patrol!.step!.signatureDocId).toMatch(/^doc-/);
    // The same signature image cannot be reused for the guard.
    await expect(svc.handoverStep(om, i.id, 'guard', { received: true, signature: sig(1) })).rejects.toThrow(/already given as proof/);
    const g = await svc.handoverStep(om, i.id, 'guard', { received: true, signature: sig(2) });
    expect(g.acknowledged).toBe(true);
    expect(g.handover!.guard!.signatureDocId).toMatch(/^doc-/);
    const doc = await store.get('evidenceDocs', g.handover!.guard!.signatureDocId!);
    expect(doc).toMatchObject({ mime: 'image/png', companyId: G, name: `Signature of ${guard.name}` });
    const audit = (await store.list('audit', {})).filter((a) => a.entityId === i.id).map((a) => a.summary);
    expect(audit.at(-1)).toMatch(/signed on the OM's screen/);
  });

  it('keeps proof of delivery: hashes in the audit log, a tamper check, phone place, and only Goodwill roles see it', async () => {
    const { svc, store, G, item, guard, po, sk, om, otherOm, ogm } = await setup();
    const i = await svc.stockIssue(sk, G, { itemId: item.id, personId: guard.id, qty: 1, omUserId: om.id, patrolPersonId: po.id });
    await svc.handoverStep(om, i.id, 'om', { received: true });
    await svc.handoverStep(om, i.id, 'patrol', { received: true, signature: sig(11), place: { lat: 3.1234567, lng: 101.7, accuracyM: 12.4 } });
    const g = await svc.handoverStep(om, i.id, 'guard', { received: true, signature: sig(12), place: { lat: 999, lng: 0 } });
    expect(g.handover!.patrol!.step!.place).toEqual({ lat: 3.123457, lng: 101.7, accuracyM: 12 });
    expect(g.handover!.guard!.place).toBeUndefined();
    const sigId = g.handover!.guard!.signatureDocId!;
    const sha = g.handover!.guard!.sha256![sigId];
    const audit = (await store.list('audit', {})).find((a) => a.entityId === i.id && a.action === 'store.handover.guard')!;
    expect(audit.summary).toContain(sha);
    let p = await svc.deliveryProof(sk, i.id);
    expect(p.delivered).toBe(true);
    expect(p.allIntact).toBe(true);
    expect(p.steps.map((s) => [s.step, s.done])).toEqual([['om', true], ['patrol', true], ['guard', true]]);
    expect(p.audit.map((a) => a.action)).toEqual(['store.issue', 'store.handover.om', 'store.handover.patrol', 'store.handover.guard']);
    // The OGM and the OM who carried it see it; another OM and a company manager do not.
    await svc.deliveryProof(ogm, i.id);
    await svc.deliveryProof(om, i.id);
    await expect(svc.deliveryProof(otherOm, i.id)).rejects.toThrow(/Goodwill store/);
    const cm = (await store.list('users', {})).find((u) => u.role === 'company_manager')!;
    await expect(svc.deliveryProof(cm, i.id)).rejects.toThrow();
    // A signature changed after the fact no longer matches what the audit log recorded.
    await store.update('evidenceDocs', sigId, { data: sig(99), sha256: 'f'.repeat(64) });
    p = await svc.deliveryProof(sk, i.id);
    expect(p.allIntact).toBe(false);
    expect(p.steps[2].done && p.steps[2].files[0].intact).toBe(false);
  });
});
