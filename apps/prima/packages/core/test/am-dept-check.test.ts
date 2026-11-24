import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, buildWorkKpi, generateDataset, myt, type Dataset, type WorkKpiScope } from '../src';

// Asset Management department check (Fauzan, 23 Nov 2026: "Do the gap"). Synthetic data only.
const TODAY = '2026-11-05';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  return { ds, svc };
};

describe('Asset Management extras on the home list (gap 1)', () => {
  it('the team sees an ended CIDB registration and statutory work; the Asset Director also sees approvals; outsiders see nothing', async () => {
    const { svc } = fresh();
    const team = await svc.amExtras.homeItems(await svc.user('u-asset-re1'));
    expect(team.some((x) => /Api Selamat.*CIDB registration has ended/.test(x.title) && x.tone === 'crit')).toBe(true);
    expect(team.every((x) => x.tag === 'Asset Management' && x.go.view === 'assets')).toBe(true);
    expect(team.some((x) => /waiting for your approval/.test(x.title))).toBe(false);
    const dir = await svc.amExtras.homeItems(await svc.user('u-asset-dir'));
    expect(dir.some((x) => /contractor\(s\) waiting for your approval/.test(x.title))).toBe(true);
    expect(await svc.amExtras.homeItems(await svc.user('u-it-ex1'))).toEqual([]);
    // Overseers outside Finance get no to-do items (they watch the tabs).
    expect(await svc.amExtras.homeItems(await svc.user('u-coo'))).toEqual([]);
  });

  it('a statutory planned job overdue is a red item for the team', async () => {
    const { ds, svc } = fresh();
    const p = ds.amPmPlans.find((x) => x.statutory)!;
    p.nextDueOn = '2026-10-01';
    p.paused = null;
    p.openWorkOrderId = null;
    const items = await svc.amExtras.homeItems(await svc.user('u-asset-mm'));
    expect(items.some((x) => x.tone === 'crit' && x.title.startsWith(`Required by law: ${p.task}`) && /overdue/.test(x.title))).toBe(true);
  });

  it('shows on the Asset Management screen for its staff (they have no home board), and to nobody outside the wall', async () => {
    const { svc } = fresh();
    const today = await svc.assetToday(await svc.user('u-asset-mm'));
    expect(today.some((t) => t.tag === 'Asset Management' && /CIDB/.test(t.title))).toBe(true);
    expect(today[0].tone).toBe('crit');
    await expect(svc.assetToday(await svc.user('u-it-ex1'))).rejects.toThrow();
  });
});

describe('Office repairs and staff house stays on Work KPIs (gap 2)', () => {
  const SCOPE: WorkKpiScope = { depts: ['asset'], companyIds: null, label: 'Asset Management' };
  it('times the check, the quotes, the repair against its days and the stay answer; never an approval', () => {
    const h = (at: string, action: string, by = 'AM Exec (mock)') => ({ at: `2026-11-${at}+08:00`, byId: 'u-am', by, action, note: '' });
    const data = {
      officeAmRecs: [
        {
          id: 'r1', kind: 'repair', ref: 'BPP-1', status: 'work_done', at: '2026-11-03T09:00:00+08:00', byId: 'u-req', by: 'Requester (mock)', version: 6, companyId: 'c1', d: {},
          history: [h('03T09:00:00', 'create', 'Requester (mock)'), h('03T09:30:00', 'accepted'), h('03T11:00:00', 'quotes'), h('03T15:00:00', 'approved', 'Asset Director (mock)'), h('04T09:00:00', 'start'), h('06T16:00:00', 'work_done')],
        },
      ],
      stayRequests: [
        { id: 's1', ref: 'SS-1', requester: 'Gov Ops Exec (mock)', at: '2026-11-03T10:00:00+08:00', history: [{ at: '2026-11-03T10:00:00+08:00', by: 'Gov Ops Exec (mock)', what: 'Asked for 2 occupant(s)' }, { at: '2026-11-03T10:08:00+08:00', by: 'Resort Exec (mock)', what: 'Confirmed at Homestay A (mock)' }] },
      ],
    } as unknown as Partial<Dataset>;
    const asset = buildWorkKpi(data, SCOPE, '2026-11').departments[0];
    const row = (wf: string, st: string) => asset.work.find((w) => w.workflow === wf && w.stage === st);
    expect(row('office_repair', 'check')).toMatchObject({ count: 1, medianMinutes: 30, onTimePct: 100 });
    expect(row('office_repair', 'quotes')).toMatchObject({ count: 1, medianMinutes: 90, onTimePct: 100 });
    expect(row('office_repair', 'repair')).toMatchObject({ count: 1, onTimePct: 100 });
    expect(row('staff_stay', 'answer')).toMatchObject({ count: 1, medianMinutes: 8, onTimePct: 100 });
    expect(asset.people.map((p) => p.name)).not.toContain('Asset Director (mock)');
  });
});

describe('Rumah sewa status for the Units tab (gap 5)', () => {
  it('lists only homes with Rumah sewa records, for the same viewers as the Rumah sewa board', async () => {
    const { ds, svc } = fresh();
    const home = ds.amUnits.find((x) => x.type === 'RESIDENTIAL' && !x.office && !x.tenancy)!;
    const rec = { id: 'rr-t1', kind: 'listing', unitId: home.id, ref: 'IKL-T1', status: 'DIIKLAN', d: {}, proof: [], by: 'Mock', byId: 'u-asset-re1', at: myt(TODAY, '09:00'), version: 1, history: [] };
    (ds as unknown as { amRentalRecs: unknown[] }).amRentalRecs.push(rec);
    const r = (await svc.amRentalAct(await svc.user('u-asset-re1'), 'unitLinks', {})) as { installed: boolean; units: { unitId: string; rentalStatus: string; unpaidMonths: number }[] };
    expect(r.installed).toBe(true);
    expect(r.units).toEqual([expect.objectContaining({ unitId: home.id, rentalStatus: 'DIIKLAN', unpaidMonths: 0 })]);
    // Finance and the Chairman see it too, as on the Rumah sewa board.
    expect(((await svc.amRentalAct(await svc.user('u-finance-am'), 'unitLinks', {})) as { units: unknown[] }).units).toHaveLength(1);
    await expect(svc.amRentalAct(await svc.user('u-it-ex1'), 'unitLinks', {})).rejects.toThrow();
  });
});

describe('Homes use Rumah sewa only (D1, D2)', () => {
  const link = (ds: Dataset, unitId: string) =>
    (ds as unknown as { amRentalRecs: unknown[] }).amRentalRecs.push({ id: `rr-${unitId}`, kind: 'listing', unitId, ref: 'IKL-T2', status: 'DIIKLAN', d: {}, proof: [], by: 'Mock', byId: 'u-asset-re1', at: myt(TODAY, '09:00'), version: 1, history: [] });

  it('a home handled in Rumah sewa takes no rent on the older unit ledger; other homes still do', async () => {
    const { ds, svc } = fresh();
    const re = await svc.user('u-asset-re1');
    const homes = ds.amUnits.filter((x) => x.type === 'RESIDENTIAL' && !x.office && x.tenancy);
    const [linked] = homes;
    link(ds, linked.id);
    await expect(svc.amRecordPayment(re, linked.id, { amount: 10, method: 'TRANSFER', on: TODAY, ref: 'IBG9' })).rejects.toThrow(/handled in Rumah sewa/);
    if (homes[1]) await expect(svc.amRecordPayment(re, homes[1].id, { amount: 10, method: 'TRANSFER', on: TODAY, ref: 'IBG9' })).rejects.not.toThrow(/Rumah sewa/);
  });

  it('a home handled in Rumah sewa leaves Finding tenants and cannot get an older letting file', async () => {
    const { ds, svc } = fresh();
    const home = ds.amUnits.find((x) => x.type === 'RESIDENTIAL' && !x.office && x.status === 'vacant')!;
    const re = await svc.user('u-asset-re1');
    expect((await svc.amExtras.board(re)).toLet.some((u: { unitId?: string; id?: string }) => (u.unitId ?? u.id) === home.id)).toBe(true);
    link(ds, home.id);
    expect((await svc.amExtras.board(re)).toLet.some((u: { unitId?: string; id?: string }) => (u.unitId ?? u.id) === home.id)).toBe(false);
    await expect(svc.amExtras.lettingAdvert(re, home.id, { channel: 'PORTAL', on: TODAY, ref: 'ad-1' })).rejects.toThrow(/handled in Rumah sewa/);
  });
});

describe('Purchases tab is for Asset Management stock only (D4)', () => {
  it('refuses a company office purchase with a pointer to Beli baru and keeps what it is for', async () => {
    const { svc } = fresh();
    const team = await svc.user('u-asset-re1');
    const base = { description: 'Chairs', category: 'FURNITURE' as const, qty: 2, estCost: 400, location: 'Resort 1', ownerEntity: 'PWVSB', reason: 'Dining hall chairs broken' };
    await expect(svc.amBuyRequest(team, { ...base, forUse: 'OFFICE' })).rejects.toThrow(/Beli baru/);
    await expect(svc.amBuyRequest(team, { ...base, forUse: 'CAR' })).rejects.toThrow(/Say what the purchase is for/);
    const ok = await svc.amBuyRequest(team, { ...base, forUse: 'RESORT' });
    expect(ok.purchase?.reason).toMatch(/^\[RESORT\]/);
  });
});

describe('Training centre on the resort desk (D6)', () => {
  it('the Asset Director sets its rooms and rate; a group company course is booked and billed to the company', async () => {
    const { ds, svc } = fresh();
    const tc = ds.amProperties.find((p) => p.kind === 'TRAINING')!;
    const dir = await svc.user('u-asset-dir');
    const team = await svc.user('u-asset-rx1');
    await expect(svc.amExtras.resortRates(team, tc.id, { capacity: { ROOM: 30 }, rates: { ROOM: 60 } })).rejects.toThrow();
    await svc.amExtras.resortRates(dir, tc.id, { capacity: { ROOM: 30, HALL: 2 }, rates: { ROOM: 60, HALL: 400 } });
    const b = await svc.amExtras.bookingAdd(team, { propertyId: tc.id, type: 'ROOM', qty: 20, checkIn: '2026-11-10', checkOut: '2026-11-13', guest: 'CSG course intake 12', internal: true, billTo: 'Sasa Security Services (mock)' });
    expect(b).toMatchObject({ internal: true, status: 'confirmed', rate: 60 });
    const board = await svc.amExtras.board(team);
    const row = board.resorts.find((r) => r.id === tc.id)!;
    expect(row.training).toBe(true);
    expect(row.flags.some((f) => /MOTAC/.test(f))).toBe(false);
  });
});

describe('Acting Asset Director (D8)', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: 'dl-am-1', companyId: 'pwvsb', kind: 'LEAVE_COVER', post: 'Asset Director', holderId: 'u-asset-dir', holderName: 'Asset Director (mock)',
    delegateId: 'u-asset-mm', delegateName: 'Maintenance Manager (mock)', scope: 'Asset Director approvals while on leave', from: '2026-11-01', to: '2026-11-20',
    reason: 'Annual leave', by: 'CoS (mock)', byId: 'u-cos', at: myt('2026-10-30', '09:00'),
    approved: { by: 'CEO (mock)', byId: 'u-fauzan', at: myt('2026-10-31', '09:00'), note: 'OK' }, ended: null, ...over,
  });

  it('an approved line in force makes the team member acting Director for those dates only, never on their own work', async () => {
    const { ds, svc } = fresh();
    const mmBefore = await svc.user('u-asset-mm');
    expect(mmBefore.assetRole).toBeUndefined();
    (ds as unknown as { delegations: unknown[] }).delegations.push(line());
    const mm = await svc.user('u-asset-mm');
    expect(mm.assetRole).toBe('director');
    expect(mm.actingAssetDirector).toEqual({ holderName: 'Asset Director (mock)', to: '2026-11-20' });
    const today = await svc.assetToday(mm);
    expect(today.some((t) => /You are acting Asset Director/.test(t.title))).toBe(true);
    const ceoItems = await (svc as unknown as { delegationHome(u: unknown): Promise<{ title: string }[]> }).delegationHome(await svc.user('u-fauzan'));
    expect(ceoItems.some((t) => t.title === 'Maintenance Manager (mock) is acting Asset Director until 2026-11-20')).toBe(true);
    // Approves a contractor someone else added, but not one they added themselves.
    const re = await svc.user('u-asset-re1');
    const other = await svc.amExtras.contractorAdd(re, { name: 'Synthetic Builders', ssmNo: 'SSM-990001', trades: ['GENERAL'] });
    await expect(svc.amExtras.contractorDecide(mm, other.id, { status: 'active' })).resolves.toBeTruthy();
    const own = await svc.amExtras.contractorAdd(mm, { name: 'Synthetic Plumbing', ssmNo: 'SSM-990002', trades: ['GENERAL'] });
    await expect(svc.amExtras.contractorDecide(mm, own.id, { status: 'active' })).rejects.toThrow(/someone else approves/);
  });

  it('no approval, an ended line, a different post or someone outside the team gives nothing', async () => {
    for (const over of [{ approved: null }, { to: '2026-11-01' }, { post: 'Finance Director' }, { kind: 'SUCCESSION' }, { delegateId: 'u-it-ex1' }]) {
      const { ds, svc } = fresh();
      (ds as unknown as { delegations: unknown[] }).delegations.push(line(over));
      expect((await svc.user(String(over.delegateId ?? 'u-asset-mm'))).assetRole).toBeUndefined();
    }
  });
});
