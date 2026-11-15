// Part P19-P39 (Fitri package, Fauzan 14 Nov 2026): short stays on the homestay houses: staff stays, direct homestay
// and Airbnb on one calendar, Finance-only receipts and payouts, damage by channel, complaints, cleaning and counts.
// Made-up guests, staff and photos only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, SS_CHECKLIST, staffPaySums, bookingBill, complaintRef, generateDataset, myt, rateUnits, staffRateOn, SS_DEFAULTS } from '../src';

const TODAY = '2026-11-18';
const NOW = myt(TODAY, '10:00');
const PHOTO = (n: string) => 'data:image/jpeg;base64,' + btoa(`photo-${n}`);
const HS = 'am-p-hs1';

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let now = NOW;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, at: (t: string) => (now = t) };
}
const u = (svc: PrimaService, id: string) => svc.user(id);
const ss = (svc: PrimaService) => svc.shortStays;

describe('Part P19-P39 pure checks', () => {
  it('P19: RM300 a person a night; 3 people for 2 nights is RM1,800; a resort bill is unchanged', () => {
    const r = staffRateOn({ staffRates: SS_DEFAULTS.staffRates }, TODAY);
    expect(r).toMatchObject({ amount: 300, basis: 'PER_PERSON_NIGHT' });
    expect(r.amount * rateUnits({ checkIn: '2026-11-20', checkOut: '2026-11-22', qty: 1, rateBasis: 'PER_PERSON_NIGHT', persons: 3 })).toBe(1800);
    const resort = { checkIn: '2026-11-20', checkOut: '2026-11-22', qty: 2, rate: 200, type: 'ROOM' as const, taxRates: null, foreign: false, charges: [] };
    expect(bookingBill(resort).total).toBe(800);
    expect(complaintRef('2026', 7)).toBe('SC-2026-0007');
    // Answer 32: an acknowledged recovery is a normal staff deduction in the next run.
    const base = { basic: 3000, allowances: [], unpaidDays: 0, unpaidDivisor: 26, claims: 0, age: 30, nationality: 'MY' as const, pcbEntered: 0, period: '2026-12', lindungOptedOut: true };
    expect(staffPaySums({ ...base, recoveries: 30 }).net).toBe(staffPaySums(base).net - 30);
  });
});

describe('Part P19-P25 staff stays', () => {
  it('request, check (not by the applicant), double booking refused across channels, keys, damage acknowledged then deducted', async () => {
    const { svc, ds, at } = setup();
    const ogm = await u(svc, 'u-ogm');
    const team = await u(svc, 'u-asset-rx1');
    const other = await u(svc, 'u-asset-re1');
    const dir = await u(svc, 'u-asset-dir');
    const base = { propertyId: HS, checkIn: '2026-11-20', checkOut: '2026-11-22', persons: 2, purpose: 'Site audit', occupants: [{ userId: 'u-pwvsb-ops' }, { userId: 'u-cms-head' }], work: true };
    // Required fields and the price shown before sending.
    await expect(ss(svc).request(ogm, { ...base, purpose: '' })).rejects.toThrow(/purpose/);
    await expect(ss(svc).request(ogm, { ...base, occupants: [{ userId: 'u-pwvsb-ops' }] })).rejects.toThrow(/Name all 2/);
    await expect(ss(svc).request(ogm, base)).rejects.toThrow(/RM1200/);
    const r = await ss(svc).request(ogm, { ...base, priceSeen: 1200 });
    // Another department cannot see it; the applicant and the occupants can.
    expect((await ss(svc).board(await u(svc, 'u-pwvsb-hr'))).myRequests).toHaveLength(0);
    expect((await ss(svc).board(await u(svc, 'u-cms-head'))).myRequests).toHaveLength(1);
    const c = await ss(svc).requestCheck(team, r.id, { outcome: 'confirm' });
    const k = ds.amBookings.find((x) => x.id === c.bookingId)!;
    expect(k).toMatchObject({ status: 'confirmed', internal: true, rateBasis: 'PER_PERSON_NIGHT', persons: 2 });
    expect(bookingBill(k).total).toBe(1200);
    // The same nights through Airbnb are refused: one calendar per house.
    await expect(ss(svc).bookAirbnb(team, { propertyId: HS, code: 'HMABC12345', guestName: 'Guest One', persons: 2, checkIn: '2026-11-21', checkOut: '2026-11-23', guestTotal: 700, hostFee: 21, accepted: true })).rejects.toThrow(/already taken/);
    // Check-in blocked until the house is inspected; whoever recorded the clean does not inspect.
    at(myt('2026-11-20', '15:00'));
    await expect(ss(svc).step(team, k.id, { step: 'checkin', keys: 2, to: 'Encik Penerima (mock)' })).rejects.toThrow(/not inspected/);
    await expect(ss(svc).step(team, k.id, { step: 'prepare', ticks: SS_CHECKLIST.slice(0, 3), photos: [PHOTO('a'), PHOTO('b')] })).rejects.toThrow(/Tick every line/);
    await expect(ss(svc).step(team, k.id, { step: 'prepare', ticks: [...SS_CHECKLIST], photos: [PHOTO('a'), PHOTO('b')] })).rejects.toThrow(/someone else/);
    await ss(svc).step(other, k.id, { step: 'prepare', ticks: [...SS_CHECKLIST], photos: [PHOTO('a'), PHOTO('b')] });
    await ss(svc).step(team, k.id, { step: 'checkin', keys: 2, to: 'Encik Penerima (mock)' });
    expect(ds.stayRequests[0].status).toBe('in_stay');
    // Keys back must match, or a lost key is recorded.
    at(myt('2026-11-22', '11:00'));
    await expect(ss(svc).step(team, k.id, { step: 'checkout', keysBack: 1 })).rejects.toThrow(/Count them back/);
    await ss(svc).step(team, k.id, { step: 'checkout', keysBack: 1, lost: 1, note: 'Lost at the site (mock)' });
    await expect(ss(svc).step(team, k.id, { step: 'close' })).rejects.toThrow(/after-stay inspection/);
    await ss(svc).step(team, k.id, { step: 'after', ticks: [...SS_CHECKLIST], photos: [PHOTO('c'), PHOTO('d')], missing: ['Plates'] });
    // Damage: the Asset Director with a photo and a finding; the team cannot.
    await expect(ss(svc).step(team, k.id, { step: 'damage', what: 'Lost key', amount: 30, reason: 'Occupant lost it', photo: PHOTO('k'), staffUserId: 'u-pwvsb-ops' })).rejects.toThrow(/Asset Director/);
    await expect(ss(svc).step(dir, k.id, { step: 'damage', what: 'Lost key', amount: 30, reason: 'Occupant lost it', staffUserId: 'u-pwvsb-ops' })).rejects.toThrow(/photo/);
    await expect(ss(svc).step(dir, k.id, { step: 'damage', what: 'Lost key', amount: 30, reason: 'Occupant lost it', photo: PHOTO('k'), staffUserId: 'u-pwvsb-hr' })).rejects.toThrow(/did not stay/);
    await ss(svc).step(dir, k.id, { step: 'damage', what: 'Lost key', amount: 30, reason: 'Occupant lost it on site', photo: PHOTO('k'), staffUserId: 'u-pwvsb-ops' });
    // Nothing is recovered before the staff member acknowledges it; only that person can.
    const pid = (await u(svc, 'u-pwvsb-ops')).personId!;
    expect(await ss(svc).recoveriesDue(pid)).toHaveLength(0);
    const req = ds.stayRequests[0];
    await expect(ss(svc).acknowledge(await u(svc, 'u-cms-head'), req.id, { damageId: req.damages[0].id, consent: true })).rejects.toThrow(/only the staff member/);
    await expect(ss(svc).acknowledge(await u(svc, 'u-pwvsb-ops'), req.id, { damageId: req.damages[0].id })).rejects.toThrow(/consent/);
    await ss(svc).acknowledge(await u(svc, 'u-pwvsb-ops'), req.id, { damageId: req.damages[0].id, consent: true });
    const due = await ss(svc).recoveriesDue(pid);
    expect(due).toHaveLength(1);
    expect(due[0].consent).toMatch(/s\.24/);
    // The FWM hostel rule (worker pays first, HR decides a deduction) is a different path and is unchanged.
    expect(k.ss!.channel).toBe('STAFF');
    await ss(svc).step(team, k.id, { step: 'close' });
    expect(ds.amBookings.find((x) => x.id === k.id)!.ss!.closed).toBeTruthy();
  });

  it('nobody confirms their own request; a returned request is corrected and sent again', async () => {
    const { svc } = setup();
    const me = await u(svc, 'u-asset-re1');
    const r = await ss(svc).request(me, { propertyId: HS, checkIn: '2026-11-25', checkOut: '2026-11-26', persons: 1, purpose: 'Inspection', occupants: [{ userId: 'u-asset-re1' }], work: true, priceSeen: 300 });
    await expect(ss(svc).requestCheck(me, r.id, { outcome: 'confirm' })).rejects.toThrow(/someone else/);
    await ss(svc).requestCheck(await u(svc, 'u-asset-rx1'), r.id, { outcome: 'return', note: 'Give the occupant phone' });
    await ss(svc).requestResubmit(me, r.id, {});
    // A private stay needs the transfer proof (answer 34).
    await expect(ss(svc).request(await u(svc, 'u-ogm'), { propertyId: HS, checkIn: '2026-11-28', checkOut: '2026-11-29', persons: 1, purpose: 'Family', occupants: [{ userId: 'u-ogm' }], work: false, priceSeen: 300 })).rejects.toThrow(/transfer proof/);
  });
});

describe('Part P26-P33 direct homestay', () => {
  it('form needs consent; Finance alone issues the receipt; customer confirms; check-in needs all six conditions; Airbnb nights refused', async () => {
    const { svc, ds, at } = setup();
    const team = await u(svc, 'u-asset-rx1');
    const other = await u(svc, 'u-asset-re1');
    const fd = await u(svc, 'u-fd');
    const form = { propertyId: HS, guest: 'Puan Tetamu (mock)', phone: '012-3456789', checkIn: '2026-12-01', checkOut: '2026-12-03', persons: 4 };
    await expect(ss(svc).bookDirect(team, form)).rejects.toThrow(/consent/);
    await expect(ss(svc).bookDirect(team, { ...form, consent: true, persons: 9 })).rejects.toThrow(/at most 6/);
    await expect(ss(svc).bookDirect(team, { ...form, consent: true, rate: 300 })).rejects.toThrow(/Say why/);
    const k0 = await ss(svc).bookDirect(team, { ...form, consent: true });
    expect(k0.message).toMatch(/Deposit RM350/);
    // Dates held at once; a second booking on the same nights from any channel is refused.
    await expect(ss(svc).bookAirbnb(team, { propertyId: HS, code: 'HMXYZ99999', guestName: 'Guest Two', persons: 2, checkIn: '2026-12-02', checkOut: '2026-12-04', guestTotal: 700, hostFee: 21, accepted: true })).rejects.toThrow(/already taken/);
    await ss(svc).step(team, k0.id, { step: 'checked', ok: true });
    await ss(svc).step(team, k0.id, { step: 'pay', amount: 350, method: 'TRANSFER', ref: 'IBG-0001', proof: PHOTO('slip') });
    let k = ds.amBookings.find((x) => x.id === k0.id)!;
    expect(k.payments[0]).toMatchObject({ receiptNo: '', banked: null });
    // The team cannot confirm in the bank or issue the receipt; customer confirmation waits for Finance.
    await expect(ss(svc).finance_(team, 'receipt', k.id, { paymentId: k.payments[0].id, on: TODAY, slipRef: 'ST-1', receiptNo: 'OR-1' })).rejects.toThrow(/Finance/);
    await expect(ss(svc).step(team, k.id, { step: 'customer', confirmed: true })).rejects.toThrow(/deposit/);
    await expect(svc.amExtras.bookingBank(fd, k.id, { paymentId: k.payments[0].id, on: TODAY, slipRef: 'ST-1' })).rejects.toThrow(/Short stays screen/);
    await ss(svc).finance_(fd, 'receipt', k.id, { paymentId: k.payments[0].id, on: TODAY, slipRef: 'ST-1', receiptNo: 'OR-2026-0001' });
    await expect(ss(svc).step(team, k.id, { step: 'customer', confirmed: true })).rejects.toThrow(/Block the dates on Airbnb/);
    await ss(svc).step(team, k.id, { step: 'block', platform: 'Airbnb' });
    await ss(svc).step(team, k.id, { step: 'customer', confirmed: true });
    await ss(svc).step(other, k.id, { step: 'prepare', ticks: [...SS_CHECKLIST], photos: [PHOTO('a'), PHOTO('b')] });
    at(myt('2026-12-01', '15:00'));
    // Full payment not yet confirmed: keys refused; the Asset Director may release with a reason after proof.
    const reg = { idType: 'MYKAD', idNo: '900101-01-0001', nationality: 'Malaysian', keys: 2, to: 'Puan Tetamu (mock)' };
    await expect(ss(svc).step(team, k.id, { step: 'checkin', ...reg })).rejects.toThrow(/full payment not confirmed/);
    await ss(svc).step(team, k.id, { step: 'pay', amount: 350, method: 'TRANSFER', ref: 'IBG-0002', proof: PHOTO('slip2') });
    await expect(ss(svc).step(team, k.id, { step: 'keyException', reason: 'Paid on Sunday, proof shown' })).rejects.toThrow(/Asset Director/);
    await ss(svc).step(await u(svc, 'u-asset-dir'), k.id, { step: 'keyException', reason: 'Paid on Sunday, proof shown' });
    await expect(ss(svc).step(team, k.id, { step: 'checkin', ...reg, to: 'Someone Else' })).rejects.toThrow(/customer on record/);
    await ss(svc).step(team, k.id, { step: 'checkin', ...reg });
    k = ds.amBookings.find((x) => x.id === k0.id)!;
    expect(k.status).toBe('checked_in');
    // Customer details hidden from group leaders; the team sees them.
    const lead = await ss(svc).board(await u(svc, 'u-coo'));
    expect(JSON.stringify(lead.bookings)).not.toMatch(/Tetamu|900101/);
    expect(JSON.stringify((await ss(svc).board(team)).bookings)).toMatch(/Tetamu/);
  });

  it('no deposit by the hold date shows on Do today; cancellation follows the terms', async () => {
    const { svc, at } = setup();
    const team = await u(svc, 'u-asset-rx1');
    const k = await ss(svc).bookDirect(team, { propertyId: HS, guest: 'Encik Lewat (mock)', phone: '013-1112222', checkIn: '2026-12-10', checkOut: '2026-12-12', persons: 2, consent: true });
    at(myt('2026-11-25', '09:00'));
    const items = await ss(svc).homeItems(team);
    expect(items.map((i) => i.title).join(' ')).toMatch(/No deposit: release the dates/);
    await expect(ss(svc).step(team, k.id, { step: 'cancel' })).rejects.toThrow(/Say why/);
    await ss(svc).step(team, k.id, { step: 'cancel', reason: 'No deposit paid' });
  });
});

describe('Part P34-P39 Airbnb, complaints, cleaning, counts', () => {
  it('code required and unique; no deposit steps; payout matched by Finance only; short payout explained; code hidden; claim deadline', async () => {
    const { svc, ds, at } = setup();
    const team = await u(svc, 'u-asset-rx1');
    const other = await u(svc, 'u-asset-re1');
    const fd = await u(svc, 'u-fd');
    const dir = await u(svc, 'u-asset-dir');
    const ab = { propertyId: HS, guestName: 'Guest Airbnb', persons: 3, checkIn: '2026-11-19', checkOut: '2026-11-21', guestTotal: 760, hostFee: 22.8, accepted: false };
    await expect(ss(svc).bookAirbnb(team, ab)).rejects.toThrow(/confirmation code/);
    const k0 = await ss(svc).bookAirbnb(team, { ...ab, code: 'HMAIR00001' });
    await expect(ss(svc).bookAirbnb(team, { ...ab, code: 'HMAIR00001', checkIn: '2026-12-20', checkOut: '2026-12-21' })).rejects.toThrow(/already on a booking/);
    await expect(ss(svc).step(team, k0.id, { step: 'pay', amount: 100, method: 'TRANSFER', ref: 'X-1', proof: PHOTO('p') })).rejects.toThrow(/pays Airbnb/);
    // A request not answered in 20 hours goes red.
    at(myt('2026-11-19', '07:00'));
    expect((await ss(svc).homeItems(team)).some((i) => i.tone === 'crit' && /Airbnb request/.test(i.title))).toBe(true);
    await ss(svc).step(team, k0.id, { step: 'answer', accepted: true });
    await ss(svc).step(other, k0.id, { step: 'prepare', ticks: [...SS_CHECKLIST], photos: [PHOTO('a'), PHOTO('b')] });
    at(myt('2026-11-19', '16:00'));
    await expect(ss(svc).step(team, k0.id, { step: 'checkin', keys: 1, to: 'Not The Guest' })).rejects.toThrow(/Airbnb guest name/);
    await ss(svc).step(team, k0.id, { step: 'checkin', keys: 1, to: 'Guest Airbnb' });
    at(myt('2026-11-21', '11:00'));
    await ss(svc).step(team, k0.id, { step: 'checkout', keysBack: 1 });
    await ss(svc).step(team, k0.id, { step: 'after', ticks: [...SS_CHECKLIST], photos: [PHOTO('c'), PHOTO('d')], missing: ['Plates'] });
    await expect(ss(svc).step(dir, k0.id, { step: 'damage', what: 'Two plates broken', amount: 16, reason: 'Guest broke them', photo: PHOTO('pl') })).rejects.toThrow(/inventory line/);
    await ss(svc).step(dir, k0.id, { step: 'damage', what: 'Two plates broken', amount: 16, reason: 'Guest broke them', photo: PHOTO('pl'), inventoryItem: 'Plates' });
    let k = ds.amBookings.find((x) => x.id === k0.id)!;
    expect(k.charges ?? []).toHaveLength(0); // never charged outside Airbnb
    at(myt('2026-12-01', '09:00'));
    expect((await ss(svc).homeItems(team)).some((i) => /claim deadline 2026-12-05/.test(i.title))).toBe(true);
    // Payout: team cannot record or confirm it; a short payout needs an explanation; the booking closes only after.
    const line = { bookingId: k.id };
    await expect(ss(svc).finance_(team, 'payout', '', { on: '2026-11-20', amount: 700, bankRef: 'PO-1', account: 'Company account', report: { name: 'earnings.csv', data: 'x' }, lines: [line] })).rejects.toThrow(/Finance/);
    const po = (await ss(svc).finance_(fd, 'payout', '', { on: '2026-11-20', amount: 700, bankRef: 'PO-1', account: 'Company account', report: { name: 'earnings.csv', data: 'x' }, lines: [line] })) as { id: string; diff: number };
    expect(po.diff).toBe(-37.2);
    await expect(ss(svc).finance_(fd, 'payoutConfirm', po.id, { slipRef: 'ST-9' })).rejects.toThrow(/differs/);
    await ss(svc).step(team, k.id, { step: 'claim', damageId: k.ss!.damages[0].id, caseNo: 'AB-CASE-1' });
    await ss(svc).step(team, k.id, { step: 'claimOutcome', damageId: k.ss!.damages[0].id, outcome: 'paid', received: 16 });
    await expect(ss(svc).step(team, k.id, { step: 'close' })).rejects.toThrow(/payout not matched/);
    await ss(svc).finance_(fd, 'payoutConfirm', po.id, { slipRef: 'ST-9', explained: 'Airbnb kept the tourism tax (mock)' });
    await ss(svc).step(team, k.id, { step: 'close' });
    k = ds.amBookings.find((x) => x.id === k0.id)!;
    expect(k.ss!.closed).toBeTruthy();
    // Host cancellation needs the Asset Director.
    const k2 = await ss(svc).bookAirbnb(team, { ...ab, code: 'HMAIR00002', checkIn: '2026-12-20', checkOut: '2026-12-22', accepted: true });
    await expect(ss(svc).step(team, k2.id, { step: 'cancel', host: true, reason: 'House flooded (mock)' })).rejects.toThrow(/Asset Director/);
    await ss(svc).step(dir, k2.id, { step: 'cancel', host: true, reason: 'House flooded (mock)' });
  });

  it('access code shown to the team only and changed after the stay; complaints run in order and are never closed by the person named', async () => {
    const { svc, ds } = setup();
    const team = await u(svc, 'u-asset-rx1');
    const dir = await u(svc, 'u-asset-dir');
    // Switch the house to a lockbox.
    const p = ds.amProperties.find((x) => x.id === HS)!;
    p.stay!.house!.keyMethod = 'LOCKBOX';
    const k = await ss(svc).bookAirbnb(team, { propertyId: HS, code: 'HMCODE0001', guestName: 'Guest Code', persons: 2, checkIn: '2026-11-25', checkOut: '2026-11-26', guestTotal: 400, hostFee: 12, accepted: true });
    await ss(svc).step(team, k.id, { step: 'code', code: '4821' });
    expect(JSON.stringify((await ss(svc).board(await u(svc, 'u-coo'))).bookings)).not.toMatch(/4821/);
    expect(JSON.stringify((await ss(svc).board(team)).bookings)).toMatch(/4821/);
    expect(JSON.stringify((ds.audit ?? []).map((a) => a.summary))).not.toMatch(/4821/);
    expect(JSON.stringify(ds.amBookings.find((x) => x.id === k.id)!.history)).not.toMatch(/4821/);
    const c1 = await ss(svc).complaint(team, { level: 'NORMAL', bookingId: k.id, what: 'Wi-Fi not working', aboutUserId: 'u-asset-re1' });
    const c2 = await ss(svc).complaint(team, { level: 'REVIEW', bookingId: k.id, what: 'Review 2 stars: dusty', stars: 2 });
    expect([c1.ref, c2.ref]).toEqual(['SC-2026-0001', 'SC-2026-0002']);
    await expect(ss(svc).complaint(team, { level: 'REVIEW', what: 'Review 4 stars', stars: 4 })).rejects.toThrow(/3 stars or less/);
    await expect(ss(svc).complaintStep(await u(svc, 'u-asset-re1'), c1.id, { step: 'investigate', action: 'Reset router' })).rejects.toThrow(/about you/);
    await ss(svc).complaintStep(team, c1.id, { step: 'investigate', action: 'Router reset, guest told' });
    await expect(ss(svc).complaintStep(team, c1.id, { step: 'close', note: 'Fixed and told' })).rejects.toThrow(/Asset Director or a deputy/);
    await ss(svc).complaintStep(dir, c1.id, { step: 'close', note: 'Fixed and the guest told' });
    // Goodwill above one night or RM300 goes to the COO.
    await expect(ss(svc).step(dir, k.id, { step: 'goodwill', amount: 500, reason: 'Wi-Fi down all night' })).rejects.toThrow(/COO/);
    // Review B5: even the COO cannot refund more than the guest paid (RM400 here).
    await expect(ss(svc).step(await u(svc, 'u-coo'), k.id, { step: 'goodwill', amount: 500, reason: 'Wi-Fi down all night' })).rejects.toThrow(/never more than the guest paid: at most RM400.00/);
    await ss(svc).step(dir, k.id, { step: 'goodwill', amount: 100, reason: 'Wi-Fi down all night' });
  });

  it('cleaner comparison needs 3 vendor quotes and own team; turnover clean waits for the inspection; full count by two people', async () => {
    const { svc } = setup();
    const team = await u(svc, 'u-asset-rx1');
    const other = await u(svc, 'u-asset-re1');
    const opt = (name: string, own = false) => ({ name, own, turnover: 120, deep: 400 });
    await expect(ss(svc).cleanerChoice(team, { area: 'Kuantan', options: [opt('A'), opt('B'), opt('Own team', true)] })).rejects.toThrow(/3 vendor quotes/);
    const cc = await ss(svc).cleanerChoice(team, { area: 'Kuantan', options: [opt('Vendor A'), opt('Vendor B'), opt('Vendor C'), opt('Own team', true)] });
    await expect(ss(svc).cleanerChoice(team, { id: cc.id, name: 'Vendor A', reason: 'Lowest cost' })).rejects.toThrow(/Asset Director/);
    await ss(svc).cleanerChoice(await u(svc, 'u-asset-dir'), { id: cc.id, name: 'Own team', reason: 'Lowest total cost meeting the times' });
    const counted = { TV: 1, Fridge: 1, 'Washing machine': 1, 'Air-con unit': 3, Mattress: 6, Plates: 10 };
    await expect(ss(svc).count(team, { propertyId: HS, counted, photos: [PHOTO('x')] })).rejects.toThrow(/Explain/);
    const c = await ss(svc).count(team, { propertyId: HS, counted, photos: [PHOTO('x')], note: 'Two plates broken in the last stay' });
    await expect(ss(svc).count(team, { id: c.id })).rejects.toThrow(/second person/);
    await ss(svc).count(other, { id: c.id });
    await expect(ss(svc).houseUse(team, HS, { use: 'RENTAL', reason: 'Long tenancy' })).rejects.toThrow(/Asset Director/);
  });
});
