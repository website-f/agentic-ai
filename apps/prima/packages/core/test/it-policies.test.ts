// Part Q (Fitri package, Merdeka IT policies, Fauzan's answers 13-14 Nov 2026): tickets, device reports and IT claims.
// Made-up staff, devices, tickets and purchases only.
import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  addOfficeMinutes,
  generateDataset,
  itServiceReport,
  myt,
  receiptKindOf,
  ticketConfirmState,
  ticketResponse,
  type ItTicket,
} from '../src';

const TODAY = '2026-11-20'; // a Friday
const NOW = myt(TODAY, '10:00');

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let now = NOW;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, at: (t: string) => (now = t) };
}
const staffOf = (ds: ReturnType<typeof generateDataset>) => ds.users.find((u) => u.personId && u.role === 'pwvsb_officer' && u.department !== 'it' && !u.integration && !u.opsTier && u.department !== 'hr')!;
const T = (over: Partial<ItTicket>): ItTicket => ({
  id: 'x', ref: 'IT-9', raisedBy: 'Staff A (mock)', raisedById: 'u-x', category: 'DEVICE', priority: 'P1', title: 't', detail: '', at: NOW, assignedTo: null, status: 'open', resolvedAt: null, resolution: '', ...over,
});

describe('Q1 response targets (pure)', () => {
  it('P1 taken after 20 minutes is late; P4 raised Friday 5 pm and taken Monday 9 am is in time', () => {
    const none = new Set<string>();
    expect(ticketResponse(T({ firstResponseAt: myt(TODAY, '10:20') }), myt(TODAY, '11:00'), none).responseLabel).toBe('lewat');
    expect(ticketResponse(T({ firstResponseAt: myt(TODAY, '10:10') }), myt(TODAY, '11:00'), none).responseLabel).toBe('dalam masa');
    const p4 = T({ priority: 'P4', at: myt(TODAY, '17:00'), firstResponseAt: myt('2026-11-23', '09:00') });
    const r = ticketResponse(p4, myt('2026-11-23', '09:30'), none);
    expect(r.responseDue).toBe(myt('2026-11-23', '17:00'));
    expect(r.responseLabel).toBe('dalam masa');
    // A public holiday on Monday moves the P4 target to Tuesday.
    expect(addOfficeMinutes(myt(TODAY, '17:00'), 540, new Set(['2026-11-23']))).toBe(myt('2026-11-24', '17:00'));
  });
  it('Q-X2: no auto-confirm; reminders on day 3 and 5, then the IT Manager chases', () => {
    const t = T({ status: 'resolved', resolvedAt: myt('2026-11-10', '10:00') });
    expect(ticketConfirmState(t, '2026-11-11').state).toBe('waiting');
    expect(ticketConfirmState(t, '2026-11-13')).toMatchObject({ state: 'reminder', reminderDay: 3 });
    expect(ticketConfirmState(t, '2026-11-15')).toMatchObject({ state: 'reminder', reminderDay: 5 });
    expect(ticketConfirmState(t, '2026-11-20').state).toBe('chase');
    expect(ticketConfirmState({ ...t, confirmedAt: NOW }, '2026-11-20').state).toBe('confirmed');
  });
  it('Q5: a made-up month of 20 tickets gives the right counts', () => {
    const rows: ItTicket[] = Array.from({ length: 20 }, (_, i) =>
      T({
        id: `t${i}`,
        at: myt('2026-10-05', '09:00'),
        category: i < 12 ? 'DEVICE' : 'EMAIL',
        priority: i < 5 ? 'P1' : 'P3',
        firstResponseAt: i < 18 ? myt('2026-10-05', i < 3 ? '09:30' : '09:05') : null,
        status: i < 15 ? 'resolved' : 'open',
        resolvedAt: i < 15 ? myt('2026-10-06', '09:00') : null,
        confirmedAt: i < 10 ? myt('2026-10-07', '09:00') : null,
        reopened: i === 0 ? 1 : 0,
      }),
    );
    const r = itServiceReport(rows, '2026-10', myt('2026-11-01', '09:00'), new Set(), true);
    expect(r).toMatchObject({ opened: 20, resolved: 15, byCategory: { DEVICE: 12, EMAIL: 8 }, byPriority: { P1: 5, P3: 15 }, reopened: 1, openPastLimit: 2, waitingConfirmation: 5 });
    // 18 answered: the 3 P1 at 30 minutes are late (15 min); the rest in time.
    expect(r.respondedInTimePct).toBe(Math.round((15 / 18) * 1000) / 10);
    expect(r.confirmedPct).toBe(Math.round((10 / 15) * 1000) / 10);
    expect(r.csv.split('\n')[0]).toBe('measure,value');
  });
  it('Q15: receipts that look like IT equipment are guessed as such', () => {
    expect(receiptKindOf('Kedai Komputer ABC laptop RM3,200')).toBe('IT_EQUIPMENT');
    expect(receiptKindOf('USB mouse wireless')).toBe('IT_EQUIPMENT');
  });
});

describe('Q1-Q4 tickets in the service', () => {
  it('P4, new categories, SECURITY starts at P2, duplicate prompt, ticket number on save, response stamped on take', async () => {
    const { ds, svc, at } = setup();
    const staff = await svc.user(staffOf(ds).id);
    const t = await svc.raiseItTicket(staff, { category: 'SOFTWARE', priority: 'P4', title: 'Pasang perisian PDF', detail: '', contactPhone: '012-0000000 (mock)' });
    expect(t.ref).toMatch(/^IT-\d+/);
    expect(t.priority).toBe('P4');
    // Same person, same category, open, within 24 hours: the form asks "Ini masalah yang sama?".
    expect((await svc.itTicketDuplicate(staff, 'SOFTWARE'))?.id).toBe(t.id);
    expect(await svc.itTicketDuplicate(staff, 'NETWORK')).toBeNull();
    await svc.itTicketAddNote(staff, t.id, 'Masih perlu perisian itu');
    const sec = await svc.raiseItTicket(staff, { category: 'SECURITY', priority: 'P4', title: 'E-mel pancingan data', detail: '' });
    expect(sec.priority).toBe('P2');
    const ex = await svc.user('u-it-ex1');
    at(myt(TODAY, '10:20'));
    await svc.itTicketStep(ex, sec.id, 'take');
    const lead = await svc.user('u-it-lead');
    // Lowering a security request needs a reason.
    await expect(svc.itTicketStep(lead, sec.id, 'priority', '', undefined, { priority: 'P3' })).rejects.toThrow(/reason/);
    await svc.itTicketStep(lead, sec.id, 'priority', 'Satu pengguna, tiada klik pautan', undefined, { priority: 'P3' });
    // Vendor referral stays on IT's clock; root cause is required for SECURITY.
    await svc.itTicketStep(ex, sec.id, 'refer', '', undefined, { vendor: 'Vendor Mock Sdn Bhd', caseNo: 'VC-1' });
    await svc.itTicketStep(ex, sec.id, 'vendorAnswer', 'Pautan disekat oleh vendor');
    await expect(svc.itTicketStep(ex, sec.id, 'resolve', 'Disekat')).rejects.toThrow(/root cause/);
    const done = await svc.itTicketStep(ex, sec.id, 'resolve', 'Disekat', undefined, { rootCause: 'Pautan pancingan dalam e-mel luar' });
    expect(done.firstResponseAt).toBe(myt(TODAY, '10:20'));
    expect(done.rootCause).toMatch(/pancingan/);
    expect(done.vendorReferral?.answer).toMatch(/disekat/i);
    const board = await svc.itBoard(await svc.user('u-it-mgr'));
    const row = board.tickets!.find((r) => r.ticket.id === sec.id)!;
    expect(row.response.respondedAt).toBe(myt(TODAY, '10:20'));
    // The IT person who fixed it cannot confirm it; the person can, with no day limit.
    at(myt('2026-11-30', '10:00'));
    await expect(svc.confirmItTicket(ex, sec.id, true)).rejects.toThrow();
    const mine = (await svc.itBoard(staff)).mine.find((m) => m.id === sec.id)!;
    expect(mine.canConfirm).toBe(true);
    expect(mine.confirmState.state).toBe('chase');
    expect((await svc.itTicketHome(staff)).some((h) => h.title.includes(sec.ref))).toBe(true);
    expect((await svc.itTicketHome(await svc.user('u-it-mgr'))).some((h) => /menunggu pengesahan/.test(h.title))).toBe(true);
    await svc.confirmItTicket(staff, sec.id, true);
  });
  it('a P1 cannot be resolved without root cause; the service report is IT Manager, COO and CEO only', async () => {
    const { ds, svc } = setup();
    const staff = await svc.user(staffOf(ds).id);
    const t = await svc.raiseItTicket(staff, { category: 'NETWORK', priority: 'P1', title: 'Internet pejabat terputus', detail: '' });
    const ex = await svc.user('u-it-ex2');
    await expect(svc.itTicketStep(ex, t.id, 'resolve', 'Router dihidupkan semula')).rejects.toThrow(/root cause/);
    await expect(svc.itServiceReport(staff, '2026-11')).rejects.toThrow();
    await expect(svc.itServiceReport(ex, '2026-11')).rejects.toThrow();
    expect((await svc.itServiceReport(await svc.user('u-coo'), '2026-11')).opened).toBeGreaterThan(0);
  });
});

describe('Q12 lost, stolen or damaged device', () => {
  it('the person reports their device; the linked ticket opens; police fields are optional; IT sets the register', async () => {
    const { ds, svc } = setup();
    const s = staffOf(ds);
    const asset = ds.itAssets.find((a) => a.status === 'in_use')!;
    ds.physicalItems.push({
      id: 'pi-mock-it-1', token: 'P1-MOCK0001', skuId: ds.itemSkus[0]?.id ?? 'sku-x', serial: 'SN-MOCK-1', ownerPartyId: 'merdeka',
      custody: { kind: 'person', partyId: 'pwvsb', ref: s.personId!, label: 'Staff (mock)', since: NOW },
      state: 'with_person', condition: 'good', version: 1, labelPrints: 1, registeredBy: 'IT (mock)', registeredAt: NOW, legacyUnverified: false,
      replacesId: null, replacedById: null, itAssetId: asset.id, kitId: null, componentIds: [], pendingAck: null, reservedFor: null, dueBack: null,
    } as unknown as (typeof ds.physicalItems)[number]);
    const staff = await svc.user(s.id);
    const mine = await svc.myItDevices(staff);
    expect(mine.map((d) => d.assetId)).toContain(asset.id);
    // No police number, no photo: still accepted, no deadline and no flag.
    const t = await svc.reportItDevice(staff, { assetId: asset.id, kind: 'stolen', detail: 'Dicuri dari kereta (mock)' });
    expect(t).toMatchObject({ category: 'DEVICE', priority: 'P2', deviceReport: { assetId: asset.id, kind: 'stolen' } });
    await expect(svc.reportItDevice(staff, { assetId: asset.id, kind: 'lost', detail: '' })).rejects.toThrow(/Already reported/);
    // Someone else cannot report a device they do not hold.
    const other = ds.users.find((u) => u.personId && u.id !== s.id && u.role === 'pwvsb_officer' && u.department !== 'it')!;
    await expect(svc.reportItDevice(await svc.user(other.id), { assetId: asset.id, kind: 'lost', detail: '' })).rejects.toThrow();
    // The IT Lead is reminded to block sign-ins; staff cannot set the register; IT can, with a reason.
    expect((await svc.itTicketHome(await svc.user('u-it-lead'))).some((h) => /Sekat log masuk/.test(h.title))).toBe(true);
    await expect(svc.itDeviceReportApply(staff, t.id, 'mock')).rejects.toThrow();
    const a = await svc.itDeviceReportApply(await svc.user('u-it-ex1'), t.id, 'Dilaporkan dicuri oleh pemegang');
    expect(a.status).toBe('stolen');
  });
});

describe('Q15 IT claim without an approved IT purchase', () => {
  it('a laptop claim with no IT purchase ref cannot be approved; with an approved ref it can', async () => {
    const { ds, svc } = setup();
    const s = staffOf(ds);
    const p = ds.itPurchases[0];
    p.status = 'finance';
    p.ceoStep = { by: 'CEO (mock)', at: NOW, note: 'Approved (mock)', decision: 'approve' };
    const staff = await svc.user(s.id);
    const proof = (n: string) => [{ kind: 'document', name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 ' + n).toString('base64')}` }];
    const bad = await svc.submitStaffClaim(staff, { kind: 'IT_EQUIPMENT', date: TODAY, amount: 120, note: 'Tetikus (mock)' }, proof('r1') as never);
    const good = await svc.submitStaffClaim(staff, { kind: 'IT_EQUIPMENT', date: '2026-11-19', amount: 3200, note: 'Laptop (mock)', itPurchaseRef: p.ref }, proof('r2') as never);
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.hrDecideClaim(hr, bad.id, true, 'Semak resit')).rejects.toThrow(/Tiada PO IT yang diluluskan/);
    const ok = await svc.hrDecideClaim(hr, good.id, true, 'Semak resit dan PO');
    expect(ok.status === 'hr_checked' || ok.status === 'approved').toBe(true);
    // Rejecting is still allowed.
    expect((await svc.hrDecideClaim(hr, bad.id, false, 'Tiada PO IT')).status).toBe('rejected');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Q6-Q23 records (one table, append-only history)
// ---------------------------------------------------------------------------------------------------------------
import { agreementBillPeriods, missingAccessories, quoteCheck, ItPolicyService, looksLikePerson } from '../src';

const PDF = (n: string) => [{ kind: 'document', name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 ' + n).toString('base64')}` }];
const pol = (svc: PrimaService, uid: string, op: string, i: Record<string, unknown> = {}) => svc.user(uid).then((u) => svc.itPolicies.act(u, op, i)) as Promise<Record<string, any>>;

describe('Q8, Q19, Q22 pure checks', () => {
  it('quote counts follow IT-BUY (3 + 1), expired quotes flagged; quarterly billing gives 4 bills; accessories; registrant', () => {
    const q = (type: 'physical' | 'online', expiresOn: string | null = null) => ({ type, expiresOn });
    expect(quoteCheck([q('physical'), q('physical'), q('online')], TODAY).enough).toBe(false);
    const ok = quoteCheck([q('physical'), q('physical'), q('physical', '2026-11-01'), q('online'), q('online')], TODAY);
    expect(ok).toMatchObject({ physical: 3, online: 2, expired: 1, enough: true });
    expect(agreementBillPeriods('quarterly', 2027).map((p) => p.period)).toEqual(['2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4']);
    expect(agreementBillPeriods('monthly', 2027)).toHaveLength(12);
    expect(missingAccessories(['adapter', 'bag'], { bag: true })).toEqual(['adapter']);
    expect(looksLikePerson('Ali bin Abu')).toBe(true);
    expect(looksLikePerson('Mock Company Sdn Bhd')).toBe(false);
    expect(ItPolicyService.domainTone('unknown', 'yes')).toBe('warn');
    expect(ItPolicyService.domainTone('yes', 'yes')).toBe('ok');
  });
});

describe('Q6-Q11 purchase request, assessment, quotes, budget, GRN, handover', () => {
  it('any department asks; IT assesses with spare stock; quotes compared; Finance budget; failed GRN quarantines; no handover without label', async () => {
    const { ds, svc } = setup();
    const staff = staffOf(ds);
    const req = await pol(svc, staff.id, 'request', { item: 'Laptop for new admin executive (mock)', qty: 1, purpose: 'New joiner', justification: 'operational' });
    expect(req).toMatchObject({ kind: 'request', status: 'submitted', requesterId: staff.id });
    await expect(pol(svc, staff.id, 'requestToPurchase', { id: req.id, unitPrice: 3000 })).rejects.toThrow();
    const linked = await pol(svc, 'u-it-ex1', 'requestToPurchase', { id: req.id, kind: 'LAPTOP', unitPrice: 3200 });
    expect(linked.status).toBe('purchase');
    const pid = linked.purchaseId as string;
    expect((await svc.itPolicies.board(await svc.user(staff.id))).mine.some((r) => r.id === req.id)).toBe(true);
    // Q7: spare laptops exist, so a reason to buy anyway; the IT Manager does not assess.
    await expect(pol(svc, 'u-it-mgr', 'assess', { purchaseId: pid, brandModel: 'X', spec: 'Y' })).rejects.toThrow();
    await expect(pol(svc, 'u-it-lead', 'assess', { purchaseId: pid, brandModel: 'Mock Book 14', spec: 'i5, 16 GB, 512 GB' })).rejects.toThrow(/Ada stok ganti/);
    await pol(svc, 'u-it-lead', 'assess', { purchaseId: pid, brandModel: 'Mock Book 14', spec: 'i5, 16 GB, 512 GB', compatible: 'yes', buyAnywayReason: 'Spares are reserved for repairs' });
    // Q8: quotes with the policy fields; recommendation by the IT Lead, not the IT Manager.
    const quotes = ['A', 'B', 'C'].map((x, i) => ({ supplier: `Supplier ${x} (mock)`, type: 'physical', price: 3100 + i * 50, warrantyMonths: 12, leadDays: 3, expiresOn: i === 2 ? '2026-11-01' : '2026-12-31' }));
    await pol(svc, 'u-it-ex1', 'quoteInfo', { purchaseId: pid, quotes: [...quotes, { supplier: 'Online Store (mock)', type: 'online', price: 3050, payFirst: true, payFirstTerms: 'Pay on order (mock)' }] });
    await expect(pol(svc, 'u-it-mgr', 'recommend', { purchaseId: pid, supplier: 'Supplier A (mock)', reason: 'Cheapest' })).rejects.toThrow();
    await pol(svc, 'u-it-lead', 'recommend', { purchaseId: pid, supplier: 'Online Store (mock)', reason: 'Lowest price, in stock' });
    let view = (await svc.itPolicies.board(await svc.user('u-it-mgr'))).purchases!.find((p) => p.purchaseId === pid)!;
    expect(view.quotes).toMatchObject({ physical: 3, online: 1, expired: 1, enough: true });
    expect(view.route).toBe('b');
    expect(view.docsMissing).toContain('warrantyCertificate');
    // Q9: Finance records the budget; IT cannot.
    await expect(pol(svc, 'u-it-ex1', 'budget', { purchaseId: pid, available: 'yes', comment: 'ok' })).rejects.toThrow();
    await pol(svc, 'u-fd', 'budget', { purchaseId: pid, available: 'yes', allocation: 'IT capex 2026 (mock)', comment: 'Within budget' });
    // Q13: a purchase left 4 working days at "review" shows late.
    const p = ds.itPurchases.find((x) => x.id === pid)!;
    p.at = myt('2026-11-13', '09:00');
    view = (await svc.itPolicies.board(await svc.user('u-it-mgr'))).purchases!.find((x) => x.purchaseId === pid)!;
    expect(view).toMatchObject({ stage: 'review', late: true });
    // Q10: a failed function test keeps the unit in quarantine.
    const unit = ds.itAssets.find((a) => a.status === 'spare' && a.kind === 'LAPTOP')!;
    const g = await pol(svc, 'u-it-ex2', 'grn', { purchaseId: pid, doNo: 'DO-MOCK-1', invoiceNo: 'INV-MOCK-1', qty: 1, packageOk: 'yes', specOk: 'yes', physicalOk: 'yes', functionOk: 'no', accessoriesOk: 'yes', note: 'Does not power on', failedAssetIds: [unit.id] });
    expect(g.ref).toMatch(/^GRN-2026-/);
    expect(g.status).toBe('mismatch');
    await expect(svc.setItAsset(await svc.user('u-it-ex2'), unit.id, 'in_use', 'Staff (mock)')).rejects.toThrow(/quarantine/);
    expect((await svc.itPolicies.homeItems(await svc.user('u-fd'))).some((h) => /mismatch/.test(h.title))).toBe(true);
    await pol(svc, 'u-it-lead', 'grnRelease', { id: g.id, assetId: unit.id, reason: 'Replaced by the supplier, tested' });
    // Q11: no handover without the label and register details; old assets marked "maklumat pembelian tiada".
    await expect(svc.setItAsset(await svc.user('u-it-ex2'), unit.id, 'in_use', 'Staff (mock)')).rejects.toThrow(/label/);
    ds.physicalItems.push({ id: 'pi-mock-2', token: 'P1-MOCK0002', skuId: 'sku-x', serial: unit.serial, ownerPartyId: 'merdeka', custody: { kind: 'store', partyId: 'merdeka', ref: 'it', label: 'IT store', since: NOW }, state: 'available', condition: 'good', version: 1, labelPrints: 1, registeredBy: 'IT (mock)', registeredAt: NOW, legacyUnverified: false, replacesId: null, replacedById: null, itAssetId: unit.id, kitId: null, componentIds: [], pendingAck: null, reservedFor: null, dueBack: null } as never);
    await expect(svc.setItAsset(await svc.user('u-it-ex2'), unit.id, 'in_use', 'Staff (mock)')).rejects.toThrow(/register details/);
    await pol(svc, 'u-it-ex2', 'assetDetail', { assetId: unit.id, brand: 'Mock', purchaseUnknown: true, custodianName: 'Staff (mock)', location: 'HQ (mock)' });
    const a = await svc.setItAsset(await svc.user('u-it-ex2'), unit.id, 'in_use', 'Staff (mock)');
    expect(a.status).toBe('in_use');
    // Q17: reissue to another person needs a checked wipe.
    await svc.setItAsset(await svc.user('u-it-ex2'), unit.id, 'spare', null);
    await expect(svc.setItAsset(await svc.user('u-it-ex2'), unit.id, 'in_use', 'Another staff (mock)')).rejects.toThrow(/data wipe/);
    const w = await pol(svc, 'u-it-ex2', 'wipe', { assetId: unit.id, reason: 'reissue', method: 'secure_erase', evidence: PDF('wipe') });
    await expect(pol(svc, 'u-it-ex2', 'wipeCheck', { id: w.id, reason: 'Own check' })).rejects.toThrow(/different IT person/);
    await pol(svc, 'u-it-lead', 'wipeCheck', { id: w.id, reason: 'Tool report checked' });
    expect((await svc.setItAsset(await svc.user('u-it-ex2'), unit.id, 'in_use', 'Another staff (mock)')).assignedTo).toBe('Another staff (mock)');
    // The PDPA officer reads the wipe log only.
    const pdpaBoard = await svc.itPolicies.board(await svc.user('u-pdpa'));
    expect(pdpaBoard.records!.every((r) => r.kind === 'wipe')).toBe(true);
    await expect(pol(svc, 'u-pdpa', 'wipeCheck', { id: w.id, reason: 'x' })).rejects.toThrow();
  });
});

describe('Q16-Q18 disposal, refurbishment and end of life', () => {
  it('repairable stays active; otherwise IT Manager, company head and COO approve, then certificate, photos and wipe; label retires', async () => {
    const { ds, svc } = setup();
    const a = ds.itAssets.find((x) => x.status === 'in_use' && x.ownerId === 'co-sasa' && x.kind === 'LAPTOP')!;
    ds.physicalItems.push({ id: 'pi-mock-3', token: 'P1-MOCK0003', skuId: 'sku-x', serial: a.serial, ownerPartyId: 'merdeka', custody: { kind: 'store', partyId: 'merdeka', ref: 'it', label: 'IT store', since: NOW }, state: 'available', condition: 'good', version: 1, labelPrints: 1, registeredBy: 'IT (mock)', registeredAt: NOW, legacyUnverified: false, replacesId: null, replacedById: null, itAssetId: a.id, kitId: null, componentIds: [], pendingAck: null, reservedFor: null, dueBack: null } as never);
    const r1 = await pol(svc, 'u-it-ex1', 'disposalAsk', { assetId: a.id, reason: 'physical_damage', condition: 'Cracked hinge (mock)' });
    await expect(pol(svc, 'u-it-ex1', 'disposalInspect', { id: r1.id, repairable: true, repairOptions: 'Hinge', photos: PDF('p') })).rejects.toThrow(/other than/);
    const fixed = await pol(svc, 'u-it-ex2', 'disposalInspect', { id: r1.id, repairable: true, repairOptions: 'Replace hinge', repairCost: 80, photos: PDF('p') });
    expect(fixed.status).toBe('repaired');
    expect(ds.itAssets.find((x) => x.id === a.id)!.status).toBe('in_use');
    const r = await pol(svc, 'u-it-ex1', 'disposalAsk', { assetId: a.id, reason: 'beyond_repair', condition: 'Board failure (mock)' });
    await pol(svc, 'u-it-ex2', 'disposalInspect', { id: r.id, repairable: false, repairOptions: 'Board replacement more than unit value', photos: PDF('p2') });
    await expect(pol(svc, 'u-it-ex1', 'disposalDecide', { id: r.id, reason: 'not right' })).rejects.toThrow(/asked for or inspected/);
    await expect(pol(svc, 'u-coo', 'disposalDecide', { id: r.id, reason: 'not right' })).rejects.toThrow(/IT Manager approves first/);
    await pol(svc, 'u-it-mgr', 'disposalDecide', { id: r.id, reason: 'Not economical to repair' });
    await expect(pol(svc, 'u-cm-arsh', 'disposalDecide', { id: r.id, reason: 'not right' })).rejects.toThrow(/head of the company/);
    await pol(svc, 'u-cm-sasa', 'disposalDecide', { id: r.id, reason: 'Our office agrees' });
    expect((await pol(svc, 'u-coo', 'disposalDecide', { id: r.id, reason: 'HQ agrees' })).status).toBe('approved');
    const done = { id: r.id, method: 'ewaste', vendor: 'Mock E-Waste Sdn Bhd', certNo: 'CERT-MOCK-1', certificate: PDF('c'), photos: PDF('ph'), vendorAck: 'Received 1 unit (mock)', value: 0 };
    await expect(pol(svc, 'u-it-mgr', 'disposalDone', done)).rejects.toThrow(/data wipe/);
    const w = await pol(svc, 'u-it-ex1', 'wipe', { assetId: a.id, reason: 'dispose', method: 'disk_destroyed', evidence: PDF('w') });
    await pol(svc, 'u-it-lead', 'wipeCheck', { id: w.id, reason: 'Disk destroyed, photo checked' });
    await expect(pol(svc, 'u-it-mgr', 'disposalDone', { ...done, certificate: [] })).rejects.toThrow(/certificate/);
    const out = await pol(svc, 'u-it-mgr', 'disposalDone', done);
    expect(out.status).toBe('disposed');
    expect(ds.itAssets.find((x) => x.id === a.id)!.status).toBe('disposed');
    expect(ds.physicalItems.find((x) => x.id === 'pi-mock-3')!.state).toBe('disposed');
    expect((await svc.itPolicies.homeItems(await svc.user('u-fd'))).some((h) => /write-off/.test(h.title))).toBe(true);
    // History is kept on the record, one line per step.
    expect(out.history.length).toBeGreaterThanOrEqual(6);
  });
  it('a central device (not rented to a company): the CoS or DCoS gives the head approval, never a company manager (Fauzan, 14 Nov 2026)', async () => {
    const { ds, svc } = setup();
    const a = ds.itAssets.find((x) => x.status === 'in_use' && x.kind === 'LAPTOP')!;
    a.ownerId = 'merdeka';
    const r = await pol(svc, 'u-it-ex1', 'disposalAsk', { assetId: a.id, reason: 'beyond_repair', condition: 'Board failure (test)' });
    await pol(svc, 'u-it-ex2', 'disposalInspect', { id: r.id, repairable: false, repairOptions: 'Not economical (test)', photos: PDF('p3') });
    await pol(svc, 'u-it-mgr', 'disposalDecide', { id: r.id, reason: 'Not economical to repair (test)' });
    await expect(pol(svc, 'u-cm-sasa', 'disposalDecide', { id: r.id, reason: 'not mine (test)' })).rejects.toThrow(/head of the company/);
    const head = await pol(svc, 'u-dcos', 'disposalDecide', { id: r.id, reason: 'Central device, agreed (test)' });
    expect(head.status).toBe('head');
  });
  it('a laptop bought 49 months ago appears as "penilaian akhir hayat"; refurbishment and end-of-life records', async () => {
    const { ds, svc } = setup();
    const a = ds.itAssets.find((x) => x.status === 'in_use' && x.kind === 'LAPTOP')!;
    a.boughtOn = '2022-10-01';
    const dues = (await svc.itPolicies.board(await svc.user('u-it-mgr'))).dues!.filter((d) => d.assetId === a.id);
    expect(dues.map((d) => d.label)).toEqual(expect.arrayContaining(['penilaian akhir hayat', 'baik pulih']));
    await pol(svc, 'u-it-ex1', 'eol', { assetId: a.id, outcome: 'refurbish', reason: 'Still fast enough after a battery swap' });
    const rf = await pol(svc, 'u-it-ex1', 'refurb', { assetId: a.id, checks: { hardware: true, cleaning: true } });
    expect(rf.status).toBe('partial');
    const after = (await svc.itPolicies.board(await svc.user('u-it-mgr'))).dues!.filter((d) => d.assetId === a.id).map((d) => d.label);
    expect(after).not.toContain('penilaian akhir hayat');
  });
});

describe('Q19-Q23 agreement, M365 accounts, domains, IP register', () => {
  it('agreement with quarterly billing and a return missing its adapter; unsigned companies flagged', async () => {
    const { ds, svc } = setup();
    const ag = await pol(svc, 'u-it-mgr', 'agreement', { companyId: 'co-sasa', agreementNo: 'ITRA-MOCK-1', start: '2026-12-01', billing: 'quarterly' });
    expect(ag.d).toMatchObject({ billing: 'quarterly', noticeDays: 30, cureDays: 14, defectDays: 5, licencesSeparate: true });
    expect((await svc.itPolicies.board(await svc.user('u-it-mgr'))).noAgreement).toContain('co-sasa');
    await expect(pol(svc, 'u-it-mgr', 'agreementSigned', { id: ag.id, link: 'http://x', signedOn: TODAY, forA: 'Pihak A (mock)', forB: 'Pihak B (mock)' })).rejects.toThrow(/SharePoint/);
    await pol(svc, 'u-it-mgr', 'agreementSigned', { id: ag.id, link: 'https://example.sharepoint.com/mock', signedOn: TODAY, forA: 'Pihak A signatory (mock)', forB: 'Pihak B signatory (mock)' });
    expect((await svc.itPolicies.board(await svc.user('u-it-mgr'))).noAgreement).not.toContain('co-sasa');
    const a = ds.itAssets.find((x) => x.ownerId === 'co-sasa' && x.kind === 'LAPTOP')!;
    await pol(svc, 'u-it-ex1', 'assetDetail', { assetId: a.id, accessories: ['adapter', 'bag'] });
    const ret = await pol(svc, 'u-it-ex1', 'rentalReturn', { assetId: a.id, returned: { bag: true }, condition: 'Scratches (mock)' });
    expect(ret.d.missing).toEqual(['adapter']);
    // The company manager reads its own agreement; another company's manager does not.
    expect((await svc.itPolicies.board(await svc.user('u-cm-sasa'))).records!.some((r) => r.id === ag.id)).toBe(true);
    expect((await svc.itPolicies.board(await svc.user('u-cm-arsh'))).records!.some((r) => r.id === ag.id)).toBe(false);
  });
  it('M365 register: guest needs expiry, joiner step needs MFA yes, licence count, request supported, verified and CoS approved', async () => {
    const { ds, svc } = setup();
    await pol(svc, 'u-it-mgr', 'setSettings', { licences: ['Business Basic'], licencesBought: { 'Business Basic': 15 }, registrars: ['Mock Registrar'], reason: 'From the Microsoft invoice (mock)' });
    await expect(pol(svc, 'u-it-ex1', 'm365', { type: 'guest', email: 'guest@example.com', ownerName: 'Staff A (mock)' })).rejects.toThrow(/expiry/);
    for (let k = 0; k < 12; k++) await pol(svc, 'u-it-ex1', 'm365', { type: 'licensed', email: `user${k}@example.com`, ownerName: `User ${k} (mock)`, licence: 'Business Basic', mfa: 'yes' });
    const b = await svc.itPolicies.board(await svc.user('u-it-mgr'));
    expect(b.licenceUse).toContainEqual({ licence: 'Business Basic', used: 12, bought: 15 });
    const join = ds.itOnboarding.find((o) => o.kind === 'join' && o.steps.some((st) => st.key === 'm365' && !st.doneAt))!;
    const step = join.steps.find((st) => st.key === 'm365')!;
    const ex = await svc.user('u-it-lead');
    await expect(svc.setItOnboardingStep(ex, join.id, 'm365', true, 'Mailbox made (mock)', step.version ?? 0)).rejects.toThrow(/Register the Microsoft 365 account/);
    await pol(svc, 'u-it-ex1', 'm365', { type: 'licensed', email: 'joiner@example.com', ownerName: 'Joiner (mock)', licence: 'Business Basic', mfa: 'no', onboardingId: join.id });
    await expect(svc.setItOnboardingStep(ex, join.id, 'm365', true, 'Mailbox made (mock)', step.version ?? 0)).rejects.toThrow(/MFA/);
    await pol(svc, 'u-it-ex1', 'm365', { type: 'licensed', email: 'joiner@example.com', ownerName: 'Joiner (mock)', licence: 'Business Basic', mfa: 'yes', onboardingId: join.id });
    await svc.setItOnboardingStep(ex, join.id, 'm365', true, 'Mailbox made (mock)', step.version ?? 0);
    // A guest past expiry is listed first in the review.
    await pol(svc, 'u-it-ex1', 'm365', { type: 'guest', email: 'old-guest@example.com', ownerName: 'Staff A (mock)', guestExpiry: '2026-10-01', mfa: 'unknown' });
    expect((await svc.itPolicies.board(await svc.user('u-it-mgr'))).m365Review![0].problems).toContain('guest past expiry');
    // Q21: the line manager cannot support their own request; IT verifies; the CoS approves.
    const staff = staffOf(ds);
    await expect(pol(svc, staff.id, 'acctReq', { kind: 'shared', fullName: 'Shared mailbox (mock)', justification: 'Team inbox', lineManagerId: staff.id })).rejects.toThrow(/own/);
    const req = await pol(svc, staff.id, 'acctReq', { kind: 'shared', fullName: 'Shared mailbox (mock)', justification: 'Team inbox', lineManagerId: 'u-coo' });
    await expect(pol(svc, 'u-cos', 'acctStep', { id: req.id, step: 'support', reason: 'not right' })).rejects.toThrow(/line manager/);
    await pol(svc, 'u-coo', 'acctStep', { id: req.id, step: 'support', reason: 'Needed for the team' });
    await expect(pol(svc, 'u-cos', 'acctStep', { id: req.id, step: 'cos', reason: 'not right' })).rejects.toThrow(/IT verifies first/);
    await pol(svc, 'u-it-ex1', 'acctStep', { id: req.id, step: 'verify', reason: 'Licence free', licenceFree: 'yes', duplicate: 'no' });
    const ok = await pol(svc, 'u-cos', 'acctStep', { id: req.id, step: 'cos', reason: 'Approved' });
    expect(ok.status).toBe('approved');
  });
  it('domain: CEO approves, approved registrar, person registrant flagged, verification proof needed; lock unknown is amber; IP decommission needs the CEO', async () => {
    const { ds, svc } = setup();
    void ds;
    await pol(svc, 'u-it-mgr', 'setSettings', { registrars: ['Mock Registrar'], reason: 'Approved list (mock)' });
    const staff = staffOf(setup().ds);
    void staff;
    const dr = await pol(svc, 'u-it-ex1', 'domainReq', { name: 'mock-new.example', purpose: 'Campaign site', justification: 'New service line' });
    await expect(pol(svc, 'u-coo', 'domainStep', { id: dr.id, step: 'ceo', reason: 'not right' })).rejects.toThrow(/CEO/);
    await pol(svc, 'u-fauzan', 'domainStep', { id: dr.id, step: 'ceo', reason: 'Approved for the campaign' });
    await expect(pol(svc, 'u-it-ex1', 'domainStep', { id: dr.id, step: 'bought', registrar: 'Other', registrant: 'Mock Co Sdn Bhd' })).rejects.toThrow(/approved list/);
    const bought = await pol(svc, 'u-it-ex1', 'domainStep', { id: dr.id, step: 'bought', registrar: 'Mock Registrar', registrant: 'Ali bin Abu', lock: 'yes', twoFa: 'unknown' });
    expect(bought.d.registrantFlag).toMatch(/person/);
    await expect(pol(svc, 'u-it-ex1', 'domainStep', { id: dr.id, step: 'active' })).rejects.toThrow(/verification proof/);
    await pol(svc, 'u-it-ex1', 'domainStep', { id: dr.id, step: 'active', verification: PDF('verify') });
    await pol(svc, 'u-it-ex1', 'domainSec', { domain: 'mock-new.example', lock: 'unknown', twoFa: 'yes' });
    expect((await svc.itPolicies.board(await svc.user('u-it-mgr'))).domainSecurity!.find((d) => d.domain === 'mock-new.example')!.tone).toBe('warn');
    // Q23: a logo row with a SharePoint link; never a password; decommission needs the CEO.
    await expect(pol(svc, 'u-it-ex1', 'ip', { name: 'Logo (mock)', type: 'logo', companyId: 'co-sasa', accessWhere: 'password: abc' })).rejects.toThrow(/never the password/);
    const ip = await pol(svc, 'u-it-ex1', 'ip', { name: 'Logo (mock)', type: 'logo', companyId: 'co-sasa', storageLink: 'https://example.sharepoint.com/logo', accessWhere: 'Brand folder, IT SharePoint' });
    await pol(svc, 'u-it-ex1', 'ipDecommission', { id: ip.id, step: 'ask', reason: 'Rebrand' });
    await expect(pol(svc, 'u-it-mgr', 'ipDecommission', { id: ip.id, step: 'ceo', reason: 'not right' })).rejects.toThrow(/CEO/);
    expect((await pol(svc, 'u-fauzan', 'ipDecommission', { id: ip.id, step: 'ceo', reason: 'Rebrand approved' })).status).toBe('decommissioned');
    expect((await svc.itPolicies.board(await svc.user('u-cm-sasa'))).records!.some((r) => r.id === ip.id)).toBe(true);
    expect((await svc.itPolicies.board(await svc.user('u-cm-arsh'))).records!.some((r) => r.id === ip.id)).toBe(false);
    // Staff cannot write the IP register or agreements.
    await expect(pol(svc, staffOf(ds).id, 'ip', { name: 'x', type: 'logo', companyId: 'co-sasa' })).rejects.toThrow();
  });
});
