import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addMonths, generateDataset, myt, pmEffective, type AmPmPlan } from '../src';

// Asset Management extras (Fauzan, 5 Nov 2026, rule AM-EXTRAS). Synthetic data only: mock contractors, tenants,
// guests, buyers and prices.
const TODAY = '2026-11-05';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  return { ds, svc };
};
const as = async (svc: PrimaService, id: string) => svc.user(id);

describe('Asset Management extras: who sees and who acts', () => {
  it('only the team, leadership and the finance staff who oversee it see the board; phones are hidden from overseers', async () => {
    const { svc } = fresh();
    const team = await svc.amExtras.board(await as(svc, 'u-asset-re1'));
    expect(team.can.act).toBe(true);
    expect(team.contractors.length).toBeGreaterThan(5);
    expect(team.meters.length).toBeGreaterThan(100);
    expect(team.resorts.length).toBe(2);
    const fin = await svc.amExtras.board(await as(svc, 'u-finance-am'));
    expect(fin.can.act).toBe(false);
    expect(fin.can.bank).toBe(true);
    const enq = fin.toLet.flatMap((u) => u.enquiries)[0];
    expect(enq.phone).toContain('•');
    expect(team.toLet.flatMap((u) => u.enquiries)[0].phone).not.toContain('•');
    await expect(svc.amExtras.board(await as(svc, 'u-it-ex1'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('overseers and outsiders cannot write', async () => {
    const { svc } = fresh();
    await expect(svc.amExtras.act(await as(svc, 'u-finance-am'), 'contractor', 'add', '', { name: 'X Sdn Bhd (test)', ssmNo: '123456-T', trades: ['GENERAL'] })).rejects.toBeInstanceOf(
      AccessDenied,
    );
    await expect(svc.amExtras.act(await as(svc, 'u-it-ex1'), 'pm', 'raise', '', {})).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Contractors', () => {
  it('the team adds, the Asset Director approves (not their own), duplicates refused, ratings only on finished jobs by that contractor', async () => {
    const { svc, ds } = fresh();
    const mm = await as(svc, 'u-asset-mm');
    const dir = await as(svc, 'u-asset-dir');
    const c = await svc.amExtras.act(mm, 'contractor', 'add', '', { name: 'Test Renovation Sdn Bhd (test)', ssmNo: '202601999999 (test)', trades: ['CIVIL', 'NOPE'], cidbGrade: 'G2', cidbExpiry: '2027-06-30' });
    await expect(svc.amExtras.act(mm, 'contractor', 'add', '', { name: 'Copy (test)', ssmNo: '202601-999999 (TEST)', trades: ['CIVIL'] })).rejects.toThrow(/already on the list/);
    await expect(svc.amExtras.act(mm, 'contractor', 'decide', c.id, { status: 'active' })).rejects.toBeInstanceOf(AccessDenied);
    const ok = (await svc.amExtras.act(dir, 'contractor', 'decide', c.id, { status: 'active', version: 1 })) as { status: string; trades: string[] };
    expect(ok.status).toBe('active');
    expect(ok.trades).toEqual(['CIVIL']);
    await expect(svc.amExtras.act(dir, 'contractor', 'decide', c.id, { status: 'suspended', version: 2 })).rejects.toThrow(/Say why/);
    await expect(svc.amExtras.act(dir, 'contractor', 'decide', c.id, { status: 'active', version: 1 })).rejects.toThrow(/changed this record/);

    // The director cannot approve one they added.
    const own = await svc.amExtras.act(dir, 'contractor', 'add', '', { name: 'Director Pick (test)', ssmNo: '777777-D (test)', trades: ['PAINTING'] });
    await expect(svc.amExtras.act(dir, 'contractor', 'decide', own.id, { status: 'active' })).rejects.toThrow(/someone else approves/);

    const wo = ds.amWorkOrders.find((w) => w.status === 'done' && w.contractor === 'Paip & Air Sdn Bhd (mock)' )!;
    const paip = ds.amContractors.find((x) => x.name === wo.contractor)!;
    const already = paip.ratings.some((r) => r.workOrderId === wo.id);
    if (!already) {
      await expect(svc.amExtras.act(mm, 'contractor', 'rate', paip.id, { workOrderId: wo.id, quality: 2, onTime: false })).rejects.toThrow(/what was wrong/);
      await svc.amExtras.act(mm, 'contractor', 'rate', paip.id, { workOrderId: wo.id, quality: 4, onTime: true });
    }
    await expect(svc.amExtras.act(mm, 'contractor', 'rate', paip.id, { workOrderId: wo.id, quality: 5, onTime: true })).rejects.toThrow(/already rated/);
    const other = ds.amContractors.find((x) => x.id === 'am-c-5')!;
    await expect(svc.amExtras.act(mm, 'contractor', 'rate', other.id, { workOrderId: wo.id, quality: 5, onTime: true })).rejects.toThrow(/not done by this contractor/);
  });

  it('flags a CIDB registration that has ended or ends soon', async () => {
    const { svc } = fresh();
    const b = await svc.amExtras.board(await as(svc, 'u-asset-dir'));
    expect(b.contractors.find((c) => c.id === 'am-c-6')!.flags.join()).toMatch(/has ended/);
    expect(b.contractors.find((c) => c.id === 'am-c-2')!.flags.join()).toMatch(/ends in 18 days/);
  });
});

describe('Finding tenants', () => {
  it('runs an enquiry from viewing to an approved offer and signing, with no self-approval and a reason under the asking rent', async () => {
    const { svc, ds } = fresh();
    const re = await as(svc, 'u-asset-re1');
    const dir = await as(svc, 'u-asset-dir');
    const unit = ds.amUnits.filter((u) => u.status === 'vacant').at(-1)!;
    await svc.amExtras.act(re, 'letting', 'advert', unit.id, { channel: 'PORTAL', ref: 'Listing 1 (test)' });
    let l = (await svc.amExtras.act(re, 'letting', 'enquiry', unit.id, { name: 'Test Tenant A (test)', phone: '012-000 0001', source: 'PORTAL' })) as { enquiries: { id: string }[]; version: number };
    await svc.amExtras.act(re, 'letting', 'enquiry', unit.id, { name: 'Test Tenant B (test)', phone: '012-000 0002', source: 'SIGNBOARD' });
    const a = l.enquiries[0].id;
    await svc.amExtras.act(re, 'letting', 'step', unit.id, { step: 'viewing', enquiryId: a, on: '2026-11-07' });
    await expect(svc.amExtras.act(re, 'letting', 'step', unit.id, { step: 'offer', enquiryId: a, rent: unit.askingRent - 50, startOn: '2026-12-01', months: 24, depositMonths: 2 })).rejects.toThrow(
      /under the asking rent/,
    );
    await svc.amExtras.act(re, 'letting', 'step', unit.id, { step: 'offer', enquiryId: a, rent: unit.askingRent - 50, startOn: '2026-12-01', months: 24, depositMonths: 2, reason: 'Long empty, tenant pays 2 years (test)' });
    await expect(svc.amExtras.act(re, 'letting', 'step', unit.id, { step: 'signed', enquiryId: a, agreementRef: 'TA-1', on: TODAY })).rejects.toThrow(/approves the offer/);
    await expect(svc.amExtras.act(re, 'letting', 'step', unit.id, { step: 'decide', enquiryId: a, approve: true, note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.amExtras.act(dir, 'letting', 'step', unit.id, { step: 'decide', enquiryId: a, approve: true, note: 'Fair for the condition (test)' });
    l = (await svc.amExtras.act(re, 'letting', 'step', unit.id, { step: 'signed', enquiryId: a, agreementRef: 'TA-2026-001 (test)', on: TODAY })) as typeof l;
    const all = (l as unknown as { enquiries: { status: string; lost: { reason: string } | null }[] }).enquiries;
    expect(all.map((e) => e.status)).toEqual(['signed', 'lost']);
    expect(all[1].lost?.reason).toBe('UNIT_LET');
  });

  it('refuses a unit that is let and not ending soon', async () => {
    const { svc, ds } = fresh();
    const u = ds.amUnits.find((x) => x.status === 'let' && x.tenancy && x.tenancy.endOn > '2027-06-01')!;
    await expect(svc.amExtras.act(await as(svc, 'u-asset-re1'), 'letting', 'advert', u.id, { channel: 'PORTAL', ref: 'x (test)' })).rejects.toThrow(/not empty/);
  });
});

describe('Utility meters', () => {
  it('needs a photo, refuses a lower number unless the meter was changed, and flags a jump', async () => {
    const { svc, ds } = fresh();
    const re = await as(svc, 'u-asset-re1');
    const m = ds.amMeters.find((x) => x.unitId && x.readings.length >= 3 && x.readings.every((r) => r.on <= TODAY))!;
    const last = m.readings.at(-1)!;
    await expect(svc.amExtras.act(re, 'meter', 'read', m.id, { reading: last.reading + 10 })).rejects.toThrow(/photo/);
    await expect(svc.amExtras.act(re, 'meter', 'read', m.id, { reading: last.reading - 1, photoRef: 'IMG-1 (test)' })).rejects.toThrow(/lower than the last/);
    const usual = m.readings.slice(-3).filter((r) => r.usage != null).reduce((n, r, _, xs) => n + r.usage! / xs.length, 0);
    await svc.amExtras.act(re, 'meter', 'read', m.id, { reading: last.reading + Math.round(usual * 5) + 10, photoRef: 'IMG-2 (test)' });
    const b = await svc.amExtras.board(re);
    expect(b.meters.find((x) => x.id === m.id)!.flags.join()).toMatch(/the usual/);
    await svc.amExtras.act(re, 'meter', 'read', m.id, { reading: 5, photoRef: 'IMG-3 (test)', newMeter: true, note: 'TNB replaced the meter (test)' });
  });

  it('records a bill only for meters the group pays, once a month', async () => {
    const { svc, ds } = fresh();
    const re = await as(svc, 'u-asset-re1');
    const tenantPays = ds.amMeters.find((x) => x.payer === 'tenant')!;
    await expect(svc.amExtras.act(re, 'meter', 'bill', tenantPays.id, { period: '2026-10', amount: 100, billRef: 'B-1 (test)' })).rejects.toThrow(/tenant pays/);
    const own = ds.amMeters.find((x) => x.payer === 'owner' && x.unitId)!;
    await svc.amExtras.act(re, 'meter', 'bill', own.id, { period: '2026-10', amount: 88.5, billRef: 'B-2 (test)' });
    await expect(svc.amExtras.act(re, 'meter', 'bill', own.id, { period: '2026-10', amount: 88.5, billRef: 'B-2 (test)' })).rejects.toThrow(/already recorded/);
  });
});

describe('Resort bookings', () => {
  it('never sells more rooms than there are, needs a deposit to confirm, a reason under the price list, and full payment to check out', async () => {
    const { svc, ds } = fresh();
    const rx = await as(svc, 'u-asset-rx1');
    const fin = await as(svc, 'u-finance-am');
    const p = ds.amProperties.find((x) => x.id === 'am-p-2')!;
    const cap = p.stay!.capacity.CHALET!;
    await expect(svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: p.id, type: 'CHALET', qty: cap + 1, checkIn: '2026-12-20', checkOut: '2026-12-22', guest: 'Big group (test)', phone: '013-111 2222' })).rejects.toThrow(
      /Not enough/,
    );
    await expect(svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: p.id, type: 'CHALET', qty: 1, checkIn: '2026-12-20', checkOut: '2026-12-22', guest: 'Guest (test)', phone: '013-111 2222', rate: 1 })).rejects.toThrow(
      /under the price list/,
    );
    const bk = await svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: p.id, type: 'CHALET', qty: cap, checkIn: '2026-12-20', checkOut: '2026-12-22', guest: 'Guest (test)', phone: '013-111 2222' });
    await expect(svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: p.id, type: 'CHALET', qty: 1, checkIn: '2026-12-21', checkOut: '2026-12-23', guest: 'Guest 2 (test)', phone: '013-111 3333' })).rejects.toThrow(
      /Not enough/,
    );
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'confirm' })).rejects.toThrow(/deposit/);
    const board = await svc.amExtras.board(rx);
    const row = board.resorts.find((r) => r.id === p.id)!.bookings.find((x) => x.id === bk.id)!;
    // 8% service tax, plus the RM3 state fee per chalet-night (a Malaysian guest pays no tourism tax).
    expect(row.bill).toMatchObject({ room: p.stay!.rates.CHALET! * cap * 2, tourism: 0, stateFee: 3 * cap * 2 });
    const total = row.total;
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'pay', amount: total + 1, method: 'CASH' })).rejects.toThrow(/more than/);
    const paid = (await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'pay', amount: Math.ceil(total * 0.3), method: 'TRANSFER', ref: 'IBG-1 (test)' })) as unknown as { payments: { id: string }[] };
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'confirm' });
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkin' })).rejects.toThrow(/from 2026-12-20/);
    await expect(svc.amExtras.act(rx, 'booking', 'bank', bk.id, { paymentId: paid.payments[0].id, on: TODAY, slipRef: 'STMT-1' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.amExtras.act(fin, 'booking', 'bank', bk.id, { paymentId: paid.payments[0].id, on: TODAY, slipRef: 'STMT-1 (test)' });
  });

  it('only the Asset Director sets the price list', async () => {
    const { svc } = fresh();
    await expect(svc.amExtras.act(await as(svc, 'u-asset-rx1'), 'resort', 'rates', 'am-p-1', { capacity: { ROOM: 10 }, rates: { ROOM: 1 } })).rejects.toBeInstanceOf(AccessDenied);
    const p = (await svc.amExtras.act(await as(svc, 'u-asset-dir'), 'resort', 'rates', 'am-p-1', { capacity: { ROOM: 30, CHALET: 12, HALL: 1 }, rates: { ROOM: 230, CHALET: 390, HALL: 2600 } })) as unknown as {
      stay: { rates: Record<string, number> };
    };
    expect(p.stay.rates).toEqual({ ROOM: 230, CHALET: 390, HALL: 2600 });
  });
});

describe('Resort front desk (hotel practice)', () => {
  const walkIn = async (svc: PrimaService, rx: Awaited<ReturnType<typeof as>>, extra: Record<string, unknown> = {}) => {
    const bk = await svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: 'am-p-2', type: 'ROOM', qty: 1, checkIn: TODAY, checkOut: '2026-11-07', guest: 'Walk-in (test)', phone: '013-111 4444', ...extra });
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'pay', amount: 200, method: 'CASH' });
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'confirm' });
    return bk;
  };
  const row = async (svc: PrimaService, user: Awaited<ReturnType<typeof as>>, id: string) =>
    (await svc.amExtras.board(user)).resorts.find((r) => r.id === 'am-p-2')!.bookings.find((x) => x.id === id)!;

  it('checks in only with the guest register and a clean, free room; a foreign guest pays tourism tax', async () => {
    const { svc } = fresh();
    const rx = await as(svc, 'u-asset-rx1');
    const bk = await walkIn(svc, rx);
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkin', roomNos: 'R01' })).rejects.toThrow(/ID/);
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkin', idType: 'MYKAD', idNo: 'X1234567 (test)', nationality: 'Singapore', roomNos: 'R01' })).rejects.toThrow(/MyKad/);
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkin', idType: 'PASSPORT', idNo: 'X1234567 (test)', nationality: 'Singapore', roomNos: 'R02' })).rejects.toThrow(/not cleaned/);
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkin', idType: 'PASSPORT', idNo: 'X1234567 (test)', nationality: 'Singapore', roomNos: 'R99' })).rejects.toThrow(/not a room/);
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkin', idType: 'PASSPORT', idNo: 'X1234567 (test)', nationality: 'Singapore', roomNos: 'R01,R03' })).rejects.toThrow(/Give 1/);
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkin', idType: 'PASSPORT', idNo: 'X1234567 (test)', nationality: 'Singapore', roomNos: 'R01' });
    const r = await row(svc, rx, bk.id);
    expect(r.roomNos).toEqual(['R01']);
    expect(r.foreign).toBe(true);
    // 2 nights x RM180 = 360; 8% = 28.80; tourism RM10 x 2; Pahang fee RM3 x 2.
    expect(r.bill).toEqual({ room: 360, extras: 0, sst: 28.8, tourism: 20, stateFee: 6, total: 414.8 });
    // A second guest cannot be put in the same room.
    const bk2 = await walkIn(svc, rx, { guest: 'Walk-in 2 (test)' });
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk2.id, { step: 'checkin', idType: 'MYKAD', idNo: '900101-06-0000 (test)', nationality: 'Malaysia', roomNos: 'R01' })).rejects.toThrow(/already has a guest/);
    // Overseers never see the ID number.
    const fd = (await svc.amExtras.board(await as(svc, 'u-finance-am'))).resorts.find((x) => x.id === 'am-p-2')!.bookings.find((x) => x.id === bk.id)!;
    expect(fd.register?.idNo).not.toBe('X1234567 (test)');
  });

  it('puts extras on the bill, refuses check-out until paid, and leaves the room dirty', async () => {
    const { svc } = fresh();
    const rx = await as(svc, 'u-asset-rx1');
    const bk = await walkIn(svc, rx);
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkin', idType: 'MYKAD', idNo: '900101-06-0000 (test)', nationality: 'Malaysia', roomNos: ['R01'] });
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'charge', what: 'Dinner (test)', amount: 50 });
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'charge', what: 'Dinner (test)', amount: -50 })).rejects.toThrow(/Say why/);
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'charge', what: 'Dinner (test)', amount: -20, reason: 'Charged one meal too many (test)' });
    let r = await row(svc, rx, bk.id);
    // Malaysian guest: no tourism tax. (360 + 30) x 8% = 31.20; fee 6.
    expect(r.bill).toEqual({ room: 360, extras: 30, sst: 31.2, tourism: 0, stateFee: 6, total: 427.2 });
    await expect(svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkout' })).rejects.toThrow(/still due/);
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'pay', amount: r.balance, method: 'CARD', ref: 'CARD-1 (test)' });
    await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'checkout' });
    const res = (await svc.amExtras.board(rx)).resorts.find((x) => x.id === 'am-p-2')!;
    expect(res.rooms.find((x) => x.no === 'R01')!.hk).toBe('dirty');
    r = res.bookings.find((x) => x.id === bk.id)!;
    expect(r.status).toBe('checked_out');
  });

  it('the person who cleaned a room does not inspect it, and an out-of-order room is not sold', async () => {
    const { svc, ds } = fresh();
    const rx = await as(svc, 'u-asset-rx1');
    const re = await as(svc, 'u-asset-re1');
    await expect(svc.amExtras.act(rx, 'room', 'step', 'am-p-2', { step: 'status', roomNo: 'R02', hk: 'inspected' })).rejects.toThrow(/Clean the room/);
    await svc.amExtras.act(rx, 'room', 'step', 'am-p-2', { step: 'status', roomNo: 'R02', hk: 'clean' });
    await expect(svc.amExtras.act(rx, 'room', 'step', 'am-p-2', { step: 'status', roomNo: 'R02', hk: 'inspected' })).rejects.toThrow(/someone else/);
    await svc.amExtras.act(re, 'room', 'step', 'am-p-2', { step: 'status', roomNo: 'R02', hk: 'inspected' });
    await expect(svc.amExtras.act(await as(svc, 'u-finance-am'), 'room', 'step', 'am-p-2', { step: 'status', roomNo: 'R02', hk: 'dirty' })).rejects.toBeInstanceOf(AccessDenied);

    // Fill every chalet but one on a far night, then take two chalets out: refused, because it would oversell.
    const p = ds.amProperties.find((x) => x.id === 'am-p-2')!;
    const cap = p.stay!.capacity.CHALET!;
    await svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: p.id, type: 'CHALET', qty: cap - 1, checkIn: '2026-12-01', checkOut: '2026-12-02', guest: 'Group (test)', phone: '013-111 5555' });
    await svc.amExtras.act(rx, 'room', 'step', p.id, { step: 'out', roomNo: 'C01', from: '2026-11-30', until: '2026-12-02', reason: 'Aircond broken (test)' });
    await expect(svc.amExtras.act(rx, 'room', 'step', p.id, { step: 'out', roomNo: 'C02', from: '2026-11-30', until: '2026-12-02', reason: 'Aircond broken (test)' })).rejects.toThrow(/too few/);
    // And no new booking can take the room that is out.
    await expect(svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: p.id, type: 'CHALET', qty: 1, checkIn: '2026-12-01', checkOut: '2026-12-02', guest: 'One more (test)', phone: '013-111 6666' })).rejects.toThrow(/Not enough/);
    const night = (await svc.amExtras.board(rx)).resorts.find((x) => x.id === p.id)!.grid.find((g) => g.type === 'CHALET')!;
    expect(night.capacity).toBe(cap);
  });

  it('gives a daily report like a night audit: occupancy, ADR, RevPAR, arrivals, departures and taxes to file', async () => {
    const { svc } = fresh();
    const rep = (await svc.amExtras.board(await as(svc, 'u-asset-rx1'))).resorts.find((x) => x.id === 'am-p-1')!.report;
    // Resort 1 tonight: 30 rooms + 12 chalets, one chalet out of order; 6 rooms in house.
    expect(rep.roomsAvailable).toBe(41);
    expect(rep.roomsSold).toBe(6);
    expect(rep.occupancyPct).toBe(14.6);
    expect(rep.adr).toBe(220);
    expect(rep.revpar).toBe(round(220 * 6 / 41));
    expect(rep.inHouse).toBe(1);
    expect(rep.monthToDate.stateFeeName).toBe('Pahang Lestari fee');
  });
});

describe('Resort house rules, set in the app by the Asset Director', () => {
  const rules = { sstRegistered: false, motacNo: 'MOTAC/PHG/9999 (test)', motacExpiresOn: '2027-12-31', checkInTime: '14:00', checkOutTime: '11:00', freeCancelDays: 3, lateCancelKeepPct: 30, noShowKeepPct: 50 };

  it('only the Asset Director sets them; bad values are refused; not registered for service tax means none is charged', async () => {
    const { svc } = fresh();
    const rx = await as(svc, 'u-asset-rx1');
    const dir = await as(svc, 'u-asset-dir');
    let b = await svc.amExtras.board(rx);
    expect(b.resorts.find((r) => r.id === 'am-p-2')!.flags.join()).toMatch(/House rules not set/);
    expect(b.resorts.find((r) => r.id === 'am-p-1')!.flags.join()).toMatch(/MOTAC registration ends/);
    await expect(svc.amExtras.act(rx, 'resort', 'policy', 'am-p-2', rules)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.amExtras.act(dir, 'resort', 'policy', 'am-p-2', { ...rules, checkInTime: '3pm' })).rejects.toThrow(/HH:MM/);
    await expect(svc.amExtras.act(dir, 'resort', 'policy', 'am-p-2', { ...rules, noShowKeepPct: 120 })).rejects.toThrow(/0 to 100/);
    await expect(svc.amExtras.act(dir, 'resort', 'policy', 'am-p-2', { ...rules, sstRegistered: undefined })).rejects.toThrow(/service tax/);
    await svc.amExtras.act(dir, 'resort', 'policy', 'am-p-2', rules);
    b = await svc.amExtras.board(rx);
    expect(b.resorts.find((r) => r.id === 'am-p-2')!.flags).toEqual([]);
    const bk = await svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: 'am-p-2', type: 'ROOM', qty: 1, checkIn: '2026-12-01', checkOut: '2026-12-02', guest: 'No SST (test)', phone: '013-111 7777' });
    const row = (await svc.amExtras.board(rx)).resorts.find((r) => r.id === 'am-p-2')!.bookings.find((x) => x.id === bk.id)!;
    expect(row.bill.sst).toBe(0);
    expect(row.terms).toMatchObject({ checkInTime: '14:00', checkOutTime: '11:00', freeCancelDays: 3 });
  });

  it('cancellation and no-show follow the terms agreed at booking, and a refund is recorded for Finance to confirm', async () => {
    const { svc } = fresh();
    const rx = await as(svc, 'u-asset-rx1');
    const dir = await as(svc, 'u-asset-dir');
    const book = async (checkIn: string, checkOut: string, guest: string) => {
      const bk = await svc.amExtras.act(rx, 'booking', 'add', '', { propertyId: 'am-p-1', type: 'ROOM', qty: 1, checkIn, checkOut, guest, phone: '013-111 8888' });
      await svc.amExtras.act(rx, 'booking', 'step', bk.id, { step: 'pay', amount: 100, method: 'CASH' });
      return bk;
    };
    const get = async (id: string) => (await svc.amExtras.board(rx)).resorts.find((r) => r.id === 'am-p-1')!.bookings.find((x) => x.id === id)!;
    // Resort 1 terms (mock): free cancellation 7 days ahead, 50% kept after that, 100% on a no-show.
    const early = await book('2026-11-10', '2026-11-11', 'Cancel 5 days ahead (test)');
    // A later change of rules does not alter terms already agreed.
    await svc.amExtras.act(dir, 'resort', 'policy', 'am-p-1', { ...rules, sstRegistered: true });
    await svc.amExtras.act(rx, 'booking', 'step', early.id, { step: 'cancel', reason: 'Plans changed (test)' });
    // 5 days ahead: free under the new rules (3 days), but this booking was made under the old ones (7 days, 50% kept).
    expect((await get(early.id)).settlement).toEqual({ keepPct: 50, keep: 50, refundDue: 50, refunded: 0 });
    await expect(svc.amExtras.act(rx, 'booking', 'step', early.id, { step: 'refund', amount: 150, method: 'CASH' })).rejects.toThrow(/Only RM50/);
    await expect(svc.amExtras.act(rx, 'booking', 'step', early.id, { step: 'refund', amount: 30, method: 'TRANSFER' })).rejects.toThrow(/reference/);
    await svc.amExtras.act(rx, 'booking', 'step', early.id, { step: 'refund', amount: 30, method: 'TRANSFER', ref: 'IBG-R1 (test)' });
    let r = await get(early.id);
    expect(r.paid).toBe(70);
    expect(r.flags.join()).toMatch(/RM20 to pay back/);
    expect((await svc.amExtras.board(rx)).toBank.some((x) => x.amount === -30)).toBe(true);

    // Bookings made after the change use the new rules: 3 free days, 30% kept after that, 50% on a no-show.
    const late = await book('2026-11-07', '2026-11-08', 'Late cancel (test)');
    await svc.amExtras.act(rx, 'booking', 'step', late.id, { step: 'cancel', reason: 'Plans changed (test)' });
    expect((await get(late.id)).settlement).toEqual({ keepPct: 30, keep: 30, refundDue: 70, refunded: 0 });

    const ns = await book(TODAY, '2026-11-06', 'No-show (test)');
    await svc.amExtras.act(rx, 'booking', 'step', ns.id, { step: 'confirm' }).catch(() => undefined);
    await svc.amExtras.act(rx, 'booking', 'step', ns.id, { step: 'noshow', reason: 'Did not arrive (test)' });
    r = await get(ns.id);
    expect(r.settlement).toMatchObject({ keepPct: 50, keep: 50, refundDue: 50 });
    await expect(svc.amExtras.act(rx, 'booking', 'step', ns.id, { step: 'pay', amount: 10, method: 'CASH' })).rejects.toThrow(/closed/);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;

describe('Orchard harvest', () => {
  it('accounts for every kg, needs a weighing slip and flags a price drop', async () => {
    const { svc } = fresh();
    const mm = await as(svc, 'u-asset-mm');
    const h = await svc.amExtras.act(mm, 'harvest', 'add', '', { propertyId: 'am-p-3', crop: 'Durian', pickedKg: 1000, photoRef: 'IMG-H (test)' });
    await expect(svc.amExtras.act(mm, 'harvest', 'step', h.id, { step: 'sale', kg: 900, buyer: 'Buyer (test)', pricePerKg: 25, method: 'CASH' })).rejects.toThrow(/weighing slip/);
    await svc.amExtras.act(mm, 'harvest', 'step', h.id, { step: 'sale', kg: 900, buyer: 'Buyer (test)', pricePerKg: 5, method: 'CASH', slipRef: 'WS-T1' });
    await expect(svc.amExtras.act(mm, 'harvest', 'step', h.id, { step: 'spoiled', kg: 200, note: 'rotten' })).rejects.toThrow(/Only 100 kg/);
    await expect(svc.amExtras.act(mm, 'harvest', 'step', h.id, { step: 'kept', kg: 60, note: 'x' })).rejects.toThrow(/who it went to/);
    await svc.amExtras.act(mm, 'harvest', 'step', h.id, { step: 'kept', kg: 60, note: 'Open day visitors (test)' });
    const b = await svc.amExtras.board(mm);
    const row = b.harvests.find((x) => x.id === h.id)!;
    expect(row.left).toBe(40);
    expect(row.flags.join()).toMatch(/under the recent/);
    expect(row.flags.join()).toMatch(/6% kept/);
  });
});

describe('Planned maintenance', () => {
  it('raises a work order once for each job due within 14 days, moves the plan on when done, and only the Asset Director pauses statutory work', async () => {
    const { svc, ds } = fresh();
    const mm = await as(svc, 'u-asset-mm');
    const dir = await as(svc, 'u-asset-dir');
    const before = ds.amWorkOrders.length;
    const first = await svc.amExtras.pmRaise(mm);
    expect(first.raised.length).toBeGreaterThan(0);
    expect(ds.amWorkOrders.length).toBe(before + first.raised.length);
    const again = await svc.amExtras.pmRaise(mm);
    expect(again.raised.length).toBe(0);
    // Finish one; the next raise moves its plan on.
    const { planId, workOrderId } = first.raised[0];
    const wo = ds.amWorkOrders.find((w) => w.id === workOrderId)!;
    wo.status = 'done';
    wo.doneOn = TODAY;
    const plan = ds.amPmPlans.find((p) => p.id === planId)!;
    const dueBefore = plan.nextDueOn;
    const third = await svc.amExtras.pmRaise(mm);
    expect(third.rolled).toContain(planId);
    const after = ds.amPmPlans.find((p) => p.id === planId)!;
    expect(after.lastDoneOn).toBe(TODAY);
    expect(after.nextDueOn > dueBefore).toBe(true);
    const statutory = ds.amPmPlans.find((p) => p.statutory && !p.openWorkOrderId)!;
    await expect(svc.amExtras.act(mm, 'pm', 'pause', statutory.id, { reason: 'Contractor busy (test)' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.amExtras.act(dir, 'pm', 'pause', statutory.id, { reason: 'Building closed for renovation (test)' });
  });

  it('keeps the rhythm from the due date unless the job was done late', () => {
    const p: AmPmPlan = {
      id: 'x', unitId: null, propertyId: 'p', task: 't', trade: 'FIRE', everyMonths: 12, nextDueOn: '2026-11-10', lastDoneOn: null, statutory: true,
      openWorkOrderId: 'w', paused: null, by: 'b', at: '2026-01-01T00:00:00+08:00', history: [], version: 1,
    };
    expect(pmEffective(p, [{ id: 'w', status: 'done', doneOn: '2026-11-08' }]).nextDueOn).toBe('2027-11-10');
    expect(pmEffective(p, [{ id: 'w', status: 'done', doneOn: '2028-01-05' }]).nextDueOn).toBe('2029-01-05');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});

describe('Review fixes (5 Nov 2026)', () => {
  it('refuses a payment on a lapsed hold, and lowering a room count below rooms already sold', async () => {
    const { svc, ds } = fresh();
    const rx = await as(svc, 'u-asset-rx1');
    const lapsed = ds.amBookings.find((b) => b.status === 'held' && b.holdUntil < TODAY)!;
    await expect(svc.amExtras.act(rx, 'booking', 'step', lapsed.id, { step: 'pay', amount: 10, method: 'CASH' })).rejects.toThrow(/hold has lapsed/);
    // Resort 1 has 20 rooms booked on one night by the group retreat.
    await expect(
      svc.amExtras.act(await as(svc, 'u-asset-dir'), 'resort', 'rates', 'am-p-1', { capacity: { ROOM: 10, CHALET: 12, HALL: 1 }, rates: { ROOM: 220, CHALET: 380, HALL: 2500 } }),
    ).rejects.toThrow(/already booked/);
  });

  it('takes no new enquiry or offer once a unit is signed', async () => {
    const { svc, ds } = fresh();
    const re = await as(svc, 'u-asset-re1');
    const dir = await as(svc, 'u-asset-dir');
    const unit = ds.amUnits.filter((u) => u.status === 'vacant').at(-2)!;
    const l = (await svc.amExtras.act(re, 'letting', 'enquiry', unit.id, { name: 'Tenant (test)', phone: '012-000 0003', source: 'AGENT' })) as unknown as { enquiries: { id: string }[] };
    const e = l.enquiries.at(-1)!.id;
    await svc.amExtras.act(re, 'letting', 'step', unit.id, { step: 'offer', enquiryId: e, rent: unit.askingRent, startOn: '2026-12-01', months: 12, depositMonths: 2 });
    await svc.amExtras.act(dir, 'letting', 'step', unit.id, { step: 'decide', enquiryId: e, approve: true, note: 'Asking rent (test)' });
    await svc.amExtras.act(re, 'letting', 'step', unit.id, { step: 'signed', enquiryId: e, agreementRef: 'TA-9 (test)', on: TODAY });
    await expect(svc.amExtras.act(re, 'letting', 'enquiry', unit.id, { name: 'Late (test)', phone: '012-000 0004', source: 'AGENT' })).rejects.toThrow(/already let/);
  });
});
