import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, type HostelBill } from '../src';

// Arisha main review round 2 (2 Nov 2026): a guard's shared monthly costs are split over all their hours in the company
// before the list is cut to a sector or a region, so the government and private monitors (and each region's) add up to
// the company total; and a guard rostered with no clock-in is listed, not dropped. Synthetic data only.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const companyId = ds.sites.find((s) => s.sector === 'government')!.companyId;
  const own = ds.sites.filter((s) => s.companyId === companyId);
  expect(own.length).toBeGreaterThanOrEqual(3);
  // Three sites of one company: government in Selangor, private in Selangor, private in Johor.
  const [g, p1, p2] = own;
  await store.update('sites', g.id, { sector: 'government', state: 'Selangor' });
  await store.update('sites', p1.id, { sector: 'private', state: 'Selangor' });
  await store.update('sites', p2.id, { sector: 'private', state: 'Johor' });
  const guard = ds.people.find((p) => p.companyId === companyId && p.role === 'guard' && p.status === 'active')!;
  const idle = ds.people.find((p) => p.companyId === companyId && p.role === 'guard' && p.status === 'active' && p.id !== guard.id)!;
  await store.update('people', guard.id, { basicPay: 2080 });
  for (const who of [guard.id, idle.id]) {
    for (const a of ds.attendance.filter((a) => a.personId === who)) await store.update('attendance', a.id, { personId: 'p-elsewhere' });
    for (const x of ds.shifts.filter((x) => x.personId === who)) await store.update('shifts', x.id, { personId: null });
    for (const h of ds.hostelStays.filter((x) => x.personId === who)) await store.update('hostelStays', h.id, { personId: 'p-elsewhere' });
  }
  // Only our guard works these three sites: 10 days at each, 8 hours a day.
  for (const a of ds.attendance.filter((a) => [g.id, p1.id, p2.id].includes(a.siteId))) await store.update('attendance', a.id, { siteId: 'elsewhere' });
  let n = 0;
  for (const [i, site] of [g, p1, p2].entries())
    for (let d = 1; d <= 10; d++) {
      const day = `2026-10-${String(i * 10 + d).padStart(2, '0')}`;
      await store.insert('attendance', {
        id: `att-rec-${n++}`,
        companyId,
        siteId: site.id,
        shiftId: null,
        personId: guard.id,
        deviceId: 'synthetic',
        clockIn: myt(day, '08:00'),
        clockOut: myt(day, '16:00'),
        lat: null,
        lng: null,
        distanceM: null,
        photo: true,
        flags: [],
        locked: true,
      });
    }
  // One RM100 hostel bill for a hostel only this guard stayed in.
  await store.insert('hostelStays', { id: 'hs-rec', companyId, hostelId: 'h-rec', personId: guard.id, personName: 'Synthetic guard', from: '2026-01-01', to: null });
  const bill: HostelBill = {
    id: 'hb-rec',
    companyId,
    hostelId: 'h-rec',
    kind: 'RENT',
    period: '2026-10',
    amount: 100,
    dueOn: '2026-10-07',
    status: 'paid',
    billDocIds: [],
    request: null,
    fwmCheck: null,
    sectorApproval: null,
    cooApproval: null,
    slip: null,
    returned: null,
    createdBy: 'Synthetic',
    createdAt: NOW,
  };
  await store.insert('hostelBills', bill);
  // A second guard rostered at the government site in October who never clocked in.
  await store.insert('shifts', {
    id: 'sh-rec-idle',
    companyId,
    siteId: g.id,
    postId: 'post-syn',
    personId: idle.id,
    date: '2026-10-05',
    start: myt('2026-10-05', '08:00'),
    end: myt('2026-10-05', '16:00'),
    status: 'published',
  });
  return { svc, g, p1, p2, guard, idle };
}

const row = (r: { sites: { siteId: string; hostel: number; statutory: number }[] }, id: string) => r.sites.find((x) => x.siteId === id)!;

describe('Ops monitor allocation reconciles across sectors and regions', () => {
  it('splits one RM100 hostel bill and the employer costs across both sectors, never counting them twice', async () => {
    const { svc, g, p1, p2 } = await setup();
    const ceo = await svc.user('u-fauzan');
    const gov = await svc.govOpsMonitor(ceo, '2026-10');
    const priv = await svc.privateOpsMonitor(ceo, '2026-10');
    const hostel = row(gov, g.id).hostel + row(priv, p1.id).hostel + row(priv, p2.id).hostel;
    expect(hostel).toBeCloseTo(100, 1);
    expect(row(gov, g.id).hostel).toBeCloseTo(33.33, 2);
    const statutory = [row(gov, g.id), row(priv, p1.id), row(priv, p2.id)].map((x) => x.statutory);
    expect(statutory[0]).toBeGreaterThan(0);
    expect(statutory[1]).toBeCloseTo(statutory[0], 1);
    expect(statutory[2]).toBeCloseTo(statutory[0], 1);
  });

  it('shows the guard in both salary lists with their whole month, and the pay totals add up to it once', async () => {
    const { svc, guard } = await setup();
    const ceo = await svc.user('u-fauzan');
    const gov = await svc.govOpsMonitor(ceo, '2026-10');
    const priv = await svc.privateOpsMonitor(ceo, '2026-10');
    const a = gov.pay.find((x) => x.personId === guard.id)!;
    const b = priv.pay.find((x) => x.personId === guard.id)!;
    expect(a.normalHours).toBe(240);
    expect(b.normalHours).toBe(240);
    expect(a.hoursHere).toBe(80);
    expect(b.hoursHere).toBe(160);
    expect(a.expectedGross).toBe(2080);
    expect(a.payHere! + b.payHere!).toBeCloseTo(2080, 1);
  });

  it('gives a regional OM the same figures for their sites as the company-wide view', async () => {
    const { svc, p1, p2 } = await setup();
    const dir = await svc.privateOpsMonitor(await svc.user('u-opsdir'), '2026-10');
    const om = { ...(await svc.user('u-om-klang')), opsSector: 'private' as const };
    const mine = await svc.privateOpsMonitor(om, '2026-10');
    expect(mine.sites.some((x) => x.siteId === p2.id)).toBe(false);
    expect(row(mine, p1.id).hostel).toBe(row(dir, p1.id).hostel);
    expect(row(mine, p1.id).statutory).toBe(row(dir, p1.id).statutory);
    expect(row(mine, p1.id).hostel + row(dir, p2.id).hostel).toBeCloseTo(row(dir, p1.id).hostel * 2, 2);
  });

  it('lists a rostered guard with no clock-in and flags the missing attendance', async () => {
    const { svc, idle } = await setup();
    const gov = await svc.govOpsMonitor(await svc.user('u-fauzan'), '2026-10');
    const x = gov.pay.find((p) => p.personId === idle.id)!;
    expect(x).toBeTruthy();
    expect(x.noAttendance).toBe(true);
    expect(x.tone).toBe('warn');
    expect(x.flags.join(' ')).toMatch(/No clock-in at these sites/);
    expect(x.flags.join(' ')).toMatch(/1 rostered shift with no clock-in/);
    expect(gov.totals!.noAttendance).toBeGreaterThanOrEqual(1);
  });
});
