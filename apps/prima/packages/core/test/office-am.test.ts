// Part S (Fitri package, Unit Penyelenggaraan circular and policies, Fauzan's answers S-X1..S-X35, 13-14 Nov 2026):
// office repairs, office inventory, office asset disposal, building purchase records, office rent and periodic visits.
// Made-up data only, in memory. PostgreSQL is tested apart in apps/api/test/office-am-pg.test.ts.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt, type AmUnit, type FinPayment, type FinRegular, type OfficeAmRec, type User } from '../src';

const TODAY = '2026-11-18';
const NOW = myt(TODAY, '10:00');
const PDF = (n: string, k = 1) => Array.from({ length: k }, (_, x) => ({ kind: 'document', name: `${n}-${x}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${n} ${x}`).toString('base64')}` }));

function fresh(now = NOW) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  let clock = now;
  const svc = new PrimaService(store, () => clock);
  const act = async (uid: string, op: string, i: Record<string, unknown>) => svc.officeAmAct(await svc.user(uid), op, i);
  const unit: AmUnit = { id: 'amu-test-1', code: 'T-OFF-1', type: 'COMMERCIAL', name: 'Test office block', town: 'Test town', state: 'Test state', ownerEntity: 'co-sasa', sizeSqft: 1000, askingRent: 0, status: 'vacant', vacantSince: TODAY, insuranceExpiry: '2027-12-31', assessmentDue: '2027-06-30', quitRentDue: '2027-05-31', meters: [], tenancy: null, use: 'OWN_USE', ownUse: { companyId: 'co-sasa', department: 'HQ' }, office: true };
  ds.amUnits.push(unit);
  const exec = ds.users.find((u) => u.role === 'admin_exec' && u.companyIds.includes('co-sasa'))!;
  const setClock = (t: string) => (clock = t);
  return { ds, svc, act, unit, exec, setClock };
}

describe('Part S office repairs (S1-S16, S43-S45)', () => {
  it('runs request, check, visit, three quotes, approvals, work, confirm, payment and close with four documents', async () => {
    const { ds, act, unit, exec } = fresh();
    const r = (await act(exec.id, 'repairRequest', { unitId: unit.id, damageType: 'door', example: 'Kunci pintu', description: 'Main door lock jammed', photos: PDF('door') })) as OfficeAmRec;
    expect(r.status).toBe('submitted');
    expect(r.d.level).toBe('MEDIUM');
    await act('u-asset-mm', 'repairCheck', { id: r.id, outcome: 'accept', reason: 'complete' });
    const wo = ds.amWorkOrders.find((w) => w.officeRepairId === r.id)!;
    expect(wo.status).toBe('open');
    expect(wo.source).toBe('staff');
    await act('u-asset-mm', 'repairVisit', { id: r.id, on: TODAY });
    await act('u-asset-mm', 'repairVisit', { id: r.id, found: 'Lock body broken', docs: PDF('insp') });
    await act('u-asset-mm', 'repairQuotes', { id: r.id, quotes: [{ contractor: 'Contractor A (test)', price: 800 }, { contractor: 'Contractor B (test)', price: 650 }, { contractor: 'Contractor C (test)', price: 900 }], docs: PDF('q', 3) });
    await expect(act('u-asset-mm', 'repairPick', { id: r.id, contractor: 'Contractor A (test)' })).rejects.toThrow(/why not the lowest/);
    const picked = (await act('u-asset-mm', 'repairPick', { id: r.id, contractor: 'Contractor B (test)', reason: 'lowest price' })) as OfficeAmRec;
    expect(picked.d.path).toBe('quote_only');
    // No work starts before final approval.
    await expect(act('u-asset-mm', 'repairStart', { id: r.id })).rejects.toThrow(/No work starts/);
    await expect(act('u-vchair', 'repairApprove', { id: r.id, reason: 'fine' })).rejects.toThrow(/Asset Director approves first/);
    await expect(act('u-asset-dir', 'repairApprove', { id: r.id })).rejects.toThrow(/reason/);
    await act('u-asset-dir', 'repairApprove', { id: r.id, reason: 'needed for security' });
    const ap = (await act('u-vchair', 'repairApprove', { id: r.id, reason: 'consent' })) as OfficeAmRec;
    expect(ap.status).toBe('approved');
    expect(ds.amWorkOrders.find((w) => w.id === wo.id)!.cost).toBe(650);
    await act('u-asset-mm', 'repairStart', { id: r.id });
    await act('u-asset-mm', 'repairDone', { id: r.id, photos: PDF('after') });
    // Only the requester confirms (the Asset Director only after day 5).
    await expect(act('u-asset-dir', 'repairConfirm', { id: r.id, reason: 'x' })).rejects.toThrow(/after day 5/);
    await expect(act('u-cm-arsh', 'repairConfirm', { id: r.id })).rejects.toThrow(AccessDenied);
    const conf = (await act(exec.id, 'repairConfirm', { id: r.id })) as OfficeAmRec;
    expect(conf.status).toBe('payment_requested');
    expect((conf.d.payRequest as { amount: number }).amount).toBe(650);
    // Finance links a payment, never above the approved amount, then the release closes the money side.
    const fin = ds.finStatus.find((f) => f.companyId === 'co-sasa')!;
    const pay = (amount: number, id: string): FinPayment => ({ ...(fin.payments?.[0] ?? ({} as FinPayment)), id, companyId: 'co-sasa', payee: 'Contractor B (test)', amount, bankRef: null, releasedOn: null } as FinPayment);
    fin.payments = [...(fin.payments ?? []), pay(700, 'finp-over'), pay(650, 'finp-ok')];
    await expect(act('u-asset-mm', 'payLink', { id: r.id, paymentId: 'finp-ok' })).rejects.toThrow(AccessDenied);
    await expect(act('u-finance-am', 'payLink', { id: r.id, paymentId: 'finp-over' })).rejects.toThrow(/Never more than the approved/);
    await act('u-finance-am', 'payLink', { id: r.id, paymentId: 'finp-ok' });
    await expect(act('u-finance-am', 'payReceipt', { id: r.id })).rejects.toThrow(/not released/);
    Object.assign(fin.payments.find((p) => p.id === 'finp-ok')!, { bankRef: 'BANKREF-TEST-1', releasedOn: TODAY });
    await act('u-finance-am', 'payReceipt', { id: r.id });
    await expect(act('u-asset-mm', 'repairClose', { id: r.id })).rejects.toThrow(/the repair report missing/);
    await act('u-asset-mm', 'repairReport', { id: r.id, what: 'Lock body replaced' });
    const closed = (await act('u-asset-mm', 'repairClose', { id: r.id })) as OfficeAmRec;
    expect(closed.status).toBe('closed');
    expect(ds.amWorkOrders.find((w) => w.id === wo.id)!.status).toBe('done');
  });

  it('review B3/B4: the payment request adds approved variation orders only, and one Finance payment pays one job', async () => {
    const { ds, act, unit, exec } = fresh();
    const toDone = async (desc: string) => {
      const r = (await act(exec.id, 'repairRequest', { unitId: unit.id, damageType: 'door', example: 'Kunci pintu', description: desc, photos: PDF(desc) })) as OfficeAmRec;
      await act('u-asset-mm', 'repairCheck', { id: r.id, outcome: 'accept', reason: 'complete' });
      await act('u-asset-mm', 'repairVisit', { id: r.id, on: TODAY });
      await act('u-asset-mm', 'repairVisit', { id: r.id, found: 'Lock body broken', docs: PDF(`${desc}-insp`) });
      await act('u-asset-mm', 'repairQuotes', { id: r.id, quotes: [{ contractor: 'Contractor B (test)', price: 650 }, { contractor: 'Contractor A (test)', price: 800 }, { contractor: 'Contractor C (test)', price: 900 }], docs: PDF(`${desc}-q`, 3) });
      await act('u-asset-mm', 'repairPick', { id: r.id, contractor: 'Contractor B (test)', reason: 'lowest price' });
      await act('u-asset-dir', 'repairApprove', { id: r.id, reason: 'needed' });
      await act('u-vchair', 'repairApprove', { id: r.id, reason: 'consent' });
      await act('u-asset-mm', 'repairStart', { id: r.id });
      await act('u-asset-mm', 'repairDone', { id: r.id, photos: PDF(`${desc}-after`) });
      return r;
    };
    const r1 = await toDone('Door one');
    const wo = ds.amWorkOrders.find((w) => w.officeRepairId === r1.id)!;
    const vo = (id: string, amount: number, final: boolean, withdrawn = false) => ({ id, reason: 'extra hinge', contractorRef: `VO-${id}`, lines: [], amount, askedBy: 'Team (test)', askedById: 'u-asset-mm', askedAt: NOW, director: null, coo: null, final, ...(withdrawn ? { withdrawn: { by: 'x', byId: 'x', at: NOW, reason: 'x' } } : {}) });
    wo.bq = { ...(wo.bq ?? {}), variations: [vo('1', 120, true), vo('2', 999, false), vo('3', 50, true, true)] } as never;
    const conf = (await act(exec.id, 'repairConfirm', { id: r1.id })) as OfficeAmRec;
    const pr = conf.d.payRequest as { amount: number; award: number; variations?: { id: string }[] };
    expect(pr.amount).toBe(770);
    expect(pr.award).toBe(650);
    expect(pr.variations?.map((x) => x.id)).toEqual(['1']);
    const r2 = await toDone('Door two');
    await act(exec.id, 'repairConfirm', { id: r2.id });
    const fin = ds.finStatus.find((f) => f.companyId === 'co-sasa')!;
    fin.payments = [...(fin.payments ?? []), { ...(fin.payments?.[0] ?? ({} as FinPayment)), id: 'finp-one', companyId: 'co-sasa', payee: 'Contractor B (test)', amount: 650, bankRef: null, releasedOn: null } as FinPayment];
    await act('u-finance-am', 'payLink', { id: r1.id, paymentId: 'finp-one' });
    await expect(act('u-finance-am', 'payLink', { id: r2.id, paymentId: 'finp-one' })).rejects.toThrow(/One payment pays one repair job/);
  });

  it('S2/S3/S45: minor needs no request, IT devices go to IT, shared areas go to the JMB; a level is never lowered', async () => {
    const { act, unit, exec } = fresh();
    const minor = (await act(exec.id, 'repairRequest', { unitId: unit.id, damageType: 'lights', example: 'Mentol lampu', description: 'Bulb out' })) as { minor: boolean };
    expect(minor.minor).toBe(true);
    const it = (await act(exec.id, 'repairRequest', { unitId: unit.id, damageType: 'laptop', description: 'Screen cracked' })) as { goesTo: string };
    expect(it.goesTo).toBe('IT');
    await expect(act(exec.id, 'repairRequest', { unitId: unit.id, damageType: 'door', example: 'Kunci pintu', level: 'MINOR', description: 'Lock jammed', photos: PDF('d') })).rejects.toThrow(/never lowered/);
    await expect(act(exec.id, 'repairRequest', { unitId: unit.id, damageType: 'door', example: 'Kunci pintu', description: 'Lock jammed' })).rejects.toThrow(/photo/);
    const j = (await act(exec.id, 'repairRequest', { unitId: unit.id, damageType: 'other', level: 'MEDIUM', area: 'lift', description: 'Lift door slow', photos: PDF('lift') })) as OfficeAmRec;
    expect(j.kind).toBe('jmb');
  });

  it('fewer than three quotes need the Asset Director; the CEO approves above RM50,000; nobody approves their own', async () => {
    const { act, unit } = fresh();
    const r = (await act('u-asset-re1', 'repairRequest', { unitId: unit.id, damageType: 'roof', level: 'CRITICAL', description: 'Roof leaking badly over the server room', photos: PDF('roof') })) as OfficeAmRec;
    await act('u-asset-mm', 'repairCheck', { id: r.id, outcome: 'accept', reason: 'critical' });
    await act('u-asset-mm', 'repairQuotes', { id: r.id, quotes: [{ contractor: 'Roofer A (test)', price: 60000 }], docs: PDF('q') });
    await expect(act('u-asset-mm', 'repairPick', { id: r.id, contractor: 'Roofer A (test)', reason: 'only one' })).rejects.toThrow(/Asset Director gives the reason/);
    await act('u-asset-dir', 'repairPick', { id: r.id, reason: 'only one licensed roofer can come this week' });
    await act('u-asset-mm', 'repairPick', { id: r.id, contractor: 'Roofer A (test)', reason: 'the only quote' });
    await act('u-asset-dir', 'repairApprove', { id: r.id, reason: 'urgent' });
    const vc = (await act('u-vchair', 'repairApprove', { id: r.id, reason: 'consent' })) as OfficeAmRec;
    expect(vc.status).toBe('for_approval');
    await expect(act('u-asset-mm', 'repairApprove', { id: r.id, reason: 'x' })).rejects.toThrow(/Nobody approves their own/);
    const ceo = (await act('u-fauzan', 'repairApprove', { id: r.id, reason: 'approved above limit' })) as OfficeAmRec;
    expect(ceo.status).toBe('approved');
  });
});

describe('Part S office inventory (S17-S31)', () => {
  it('update request, unit check, Asset Director confirm, filed; never checked by the sender; switched-off sender is refused', async () => {
    const { act, exec, svc } = fresh();
    await expect(act(exec.id, 'invSubmit', { companyId: 'co-sasa', lines: [{ name: 'Office chair', location: 'Room 1' }] })).rejects.toThrow(/photo/);
    const up = (await act(exec.id, 'invSubmit', { companyId: 'co-sasa', lines: [{ name: 'Office chair', location: 'Room 1', serial: 'SER-T-1', price: 300 }], docs: PDF('chair') })) as OfficeAmRec;
    await expect(act('u-asset-dir', 'invConfirm', { id: up.id, reason: 'fine' })).rejects.toThrow(/checks it first/);
    await act('u-asset-mm', 'invCheck', { id: up.id, reason: 'matches the photo' });
    await act('u-asset-dir', 'invConfirm', { id: up.id, reason: 'confirmed' });
    const filed = (await act('u-asset-mm', 'invFile', { id: up.id })) as OfficeAmRec;
    expect(filed.status).toBe('filed');
    // Duplicate serial is flagged on the next update.
    const dup = (await act(exec.id, 'invSubmit', { companyId: 'co-sasa', lines: [{ name: 'Chair again', location: 'Room 2', serial: 'SER-T-1' }], docs: PDF('c2') })) as OfficeAmRec;
    expect((dup.d.lines as { duplicateOf: string | null }[])[0].duplicateOf).toMatch(/^INV-/);
    // The unit switches the sender off; the next update is refused.
    await act('u-asset-mm', 'invAccess', { userId: exec.id, on: false, reason: 'left the office team' });
    await expect(act(exec.id, 'invSubmit', { companyId: 'co-sasa', lines: [{ name: 'Desk', location: 'Room 3' }], docs: PDF('desk') })).rejects.toThrow(AccessDenied);
    // Another company's head cannot send for this office.
    await expect(act('u-cm-arsh', 'invSubmit', { companyId: 'co-sasa', lines: [{ name: 'Desk', location: 'Room 3' }], docs: PDF('desk') })).rejects.toThrow(AccessDenied);
    // HR reads inventory without prices.
    const hr = (await svc.officeAmAct(await svc.user('u-pwvsb-hr'), 'board', {})) as { records: OfficeAmRec[] };
    const item = hr.records.find((x) => x.kind === 'invItem')!;
    expect(item).toBeTruthy();
    expect(item.d.price).toBeUndefined();
  });
});

describe('Part S office disposal (S32-S42, S47-S50)', () => {
  async function withItem() {
    const f = fresh();
    const up = (await f.act(f.exec.id, 'invSubmit', { companyId: 'co-sasa', lines: [{ name: 'Old cabinet', location: 'Store', price: 2000, boughtOn: '2015-01-10' }], docs: PDF('cab') })) as OfficeAmRec;
    await f.act('u-asset-mm', 'invCheck', { id: up.id, reason: 'fine' });
    await f.act('u-asset-dir', 'invConfirm', { id: up.id, reason: 'fine' });
    await f.act('u-asset-mm', 'invFile', { id: up.id });
    const item = f.ds.officeAmRecs.find((r) => r.kind === 'invItem')!;
    return { ...f, item };
  }
  it('needs three photos and the true tick; inspected by someone else; a sale needs the Vice Chairman and Finance records the money', async () => {
    const { act, exec, item, ds } = await withItem();
    await expect(act(exec.id, 'dispRequest', { itemId: item.id, criteria: ['obsolete'], method: 'sale', reason: 'not used', photos: PDF('p', 2), trueTick: true })).rejects.toThrow(/at least 3 photos/);
    await expect(act(exec.id, 'dispRequest', { itemId: item.id, criteria: ['obsolete'], method: 'sale', reason: 'not used', photos: PDF('p', 3) })).rejects.toThrow(/true/);
    const r = (await act(exec.id, 'dispRequest', { itemId: item.id, criteria: ['obsolete'], method: 'sale', reason: 'not used', photos: PDF('p', 3), trueTick: true })) as OfficeAmRec;
    await expect(act(exec.id, 'dispRequest', { itemId: item.id, criteria: ['obsolete'], method: 'sale', reason: 'again', photos: PDF('p', 3), trueTick: true })).rejects.toThrow(/already open/);
    await act('u-asset-mm', 'dispInspect', { id: r.id, outcome: 'fit', reason: 'worn out', photos: PDF('i') });
    expect(ds.officeAmRecs.find((x) => x.id === item.id)!.status).toBe('awaiting_disposal');
    await act('u-asset-mm', 'dispReport', { id: r.id, condition: 'broken hinges' });
    const ad = (await act('u-asset-dir', 'dispApprove', { id: r.id, reason: 'sell as scrap' })) as OfficeAmRec;
    expect(ad.status).toBe('for_approval');
    await act('u-vchair', 'dispApprove', { id: r.id, reason: 'consent' });
    await act('u-asset-mm', 'dispCarryOut', { id: r.id, witness: 'Another unit member', docs: PDF('ev'), marksRemoved: true });
    await expect(act('u-asset-mm', 'dispClose', { id: r.id })).rejects.toThrow(/Finance records the sale money/);
    await expect(act('u-asset-mm', 'dispCarryOut', { id: r.id, saleMoney: 50, receiptNo: 'OR-1' })).rejects.toThrow(AccessDenied);
    await act('u-finance-am', 'dispCarryOut', { id: r.id, saleMoney: 50, receiptNo: 'OR-TEST-1' });
    const closed = (await act('u-asset-mm', 'dispClose', { id: r.id })) as OfficeAmRec;
    expect(closed.status).toBe('closed');
    expect(ds.officeAmRecs.find((x) => x.id === item.id)!.status).toBe('disposed');
  });
  it('a refused disposal goes back with a photo and stays in the inventory', async () => {
    const { act, exec, item, ds } = await withItem();
    const r = (await act(exec.id, 'dispRequest', { itemId: item.id, criteria: ['not_used'], method: 'throw_away', reason: 'not used', photos: PDF('p', 3), trueTick: true })) as OfficeAmRec;
    await act('u-asset-mm', 'dispInspect', { id: r.id, outcome: 'fit', reason: 'fine', photos: PDF('i') });
    await act('u-asset-mm', 'dispReport', { id: r.id, condition: 'usable' });
    await act('u-asset-dir', 'dispApprove', { id: r.id, decision: 'refuse', reason: 'still usable elsewhere' });
    await act('u-asset-mm', 'dispPutBack', { id: r.id, photos: PDF('back') });
    expect(ds.officeAmRecs.find((x) => x.id === item.id)!.status).toBe('confirmed');
  });
});

describe('Part S building purchase records (S51-S62)', () => {
  it('waits for the leader, needs each document in order, refuses another company loan, registers the building', async () => {
    const { act, ds } = fresh();
    const b = (await act('u-asset-dir', 'bldInstruct', { givenBy: 'ceo', companyId: 'co-sasa', address: 'Lot 1, Test road', price: 1_000_000, docs: PDF('memo') })) as OfficeAmRec;
    expect(b.status).toBe('waiting_instruction');
    await expect(act('u-asset-mm', 'bldStage', { id: b.id, stage: 'documents', docs: PDF('ssm') })).rejects.toThrow(/before the instruction is approved/);
    await expect(act('u-vchair', 'bldApproveInstruction', { id: b.id, reason: 'fine' })).rejects.toThrow(/own sign-in/);
    await act('u-fauzan', 'bldApproveInstruction', { id: b.id, reason: 'go ahead' });
    await expect(act('u-asset-mm', 'bldStage', { id: b.id, stage: 'valuation', docs: PDF('v') })).rejects.toThrow(/Finish "documents"/);
    await act('u-asset-mm', 'bldStage', { id: b.id, stage: 'documents', docs: PDF('ssm') });
    await act('u-asset-mm', 'bldStage', { id: b.id, stage: 'sent_bank', docs: PDF('app') });
    await act('u-asset-mm', 'bldStage', { id: b.id, stage: 'valuation', docs: PDF('val') });
    await expect(act('u-asset-mm', 'bldStage', { id: b.id, stage: 'agreements', docs: PDF('spa') })).rejects.toThrow(/Finish "decision"|not approved/);
    const ok = (await act('u-asset-mm', 'bldDecision', { id: b.id, docs: PDF('letter'), loanAmount: 900_000, monthly: 4500, tenureMonths: 300, bank: 'Test Bank' })) as OfficeAmRec;
    expect((ok.d.gap as { amount: number }).amount).toBe(100_000);
    await expect(act('u-finance-am', 'bldDownPayment', { id: b.id, bankRef: 'R1', firstOn: '2027-01-01', lastOn: '2052-01-01' })).rejects.toThrow(/gap is not covered/);
    await act('u-finance-am', 'bldGap', { id: b.id, source: 'company reserves' });
    await act('u-finance-am', 'bldDownPayment', { id: b.id, bankRef: 'DP-TEST-1', firstOn: '2027-01-01', lastOn: '2052-01-01' });
    const fin = ds.finStatus.find((f) => f.companyId === 'co-arsh')!;
    fin.regular = [...(fin.regular ?? []), { id: 'reg-other-co', companyId: 'co-arsh', kind: 'loan' } as FinRegular];
    await expect(act('u-finance-am', 'bldLoanLink', { id: b.id, regularId: 'reg-other-co' })).rejects.toThrow(/buying company/);
    const own = ds.finStatus.find((f) => f.companyId === 'co-sasa')!;
    own.regular = [...(own.regular ?? []), { id: 'reg-sasa-loan', companyId: 'co-sasa', kind: 'loan' } as FinRegular];
    await act('u-finance-am', 'bldLoanLink', { id: b.id, regularId: 'reg-sasa-loan' });
    await act('u-asset-mm', 'bldStage', { id: b.id, stage: 'agreements', docs: PDF('spa') });
    await expect(act('u-cm-sasa', 'bldForm', { id: b.id, use: 'OWN_USE', department: 'Head office', spaRef: 'SPA-1', code: 'T-BLD-1', name: 'New HQ' })).rejects.toThrow(/Upload the SPA/);
    await expect(act('u-cm-sasa', 'bldForm', { id: b.id, use: 'RENTAL', paidTo: 'co-arsh', spa: PDF('spa'), spaRef: 'SPA-1', code: 'T-BLD-1', name: 'New HQ' })).rejects.toThrow(/management agreement/);
    await act('u-cm-sasa', 'bldForm', { id: b.id, use: 'OWN_USE', department: 'Head office', spa: PDF('spa'), spaRef: 'SPA-1', code: 'T-BLD-1', name: 'New HQ' });
    await act('u-asset-mm', 'bldRegister', { id: b.id });
    const u = ds.amUnits.find((x) => x.code === 'T-BLD-1')!;
    expect(u.use).toBe('OWN_USE');
    expect(u.purchase?.loanRegularId).toBe('reg-sasa-loan');
    // Another company's head reads nothing of the file.
    await expect(act('u-cm-arsh', 'bldBankLog', { id: b.id, officer: 'x', what: 'y' })).rejects.toThrow(AccessDenied);
  });
});

describe('Part S office rent (S63-S74)', () => {
  it('Finance numbers the invoice, cheque checks, two sign-ins, owner account only, paid only on Finance match by someone else', async () => {
    const { act, unit } = fresh();
    const t = (await act('u-asset-re1', 'tenancyOpen', { unitId: unit.id, tenant: 'Tenant Co (test)', ssm: 'SSM-T-1', invoiceEmail: 'accounts@example.test' })) as OfficeAmRec;
    await expect(act('u-asset-re1', 'tenancyTerms', { id: t.id, rent: 3000, startOn: '2026-12-01', endOn: '2027-11-30', account: 'Test Bank 1234' })).rejects.toThrow(/tenant check/);
    for (const line of ['ssm', 'kdnLicence', 'kdnAddress']) await act('u-asset-re1', 'tenancyCheck', { id: t.id, line, docs: PDF(line), expiresOn: '2027-10-01' });
    await act('u-asset-re1', 'tenancyCheck', { id: t.id, line: 'pbtLicence', state: 'not_needed', reason: 'inside an approved office block' });
    await act('u-asset-re1', 'tenancyTerms', { id: t.id, rent: 3000, startOn: '2026-12-01', endOn: '2027-11-30', account: 'Test Bank 1234' });
    await expect(act('u-asset-re1', 'rentInvoice', { tenancyId: t.id, period: '2026-12', invoiceNo: 'X', amount: 3000 })).rejects.toThrow(AccessDenied);
    const m = (await act('u-finance-am', 'rentInvoice', { tenancyId: t.id, period: '2026-12', invoiceNo: 'IV-TEST-1', amount: 3000 })) as OfficeAmRec;
    await act('u-asset-re1', 'rentInvoiceCheck', { id: m.id });
    await act('u-asset-re1', 'rentSent', { id: m.id, to: 'accounts@example.test', docs: PDF('inv') });
    await act('u-asset-re1', 'rentReceived', { id: m.id, method: 'CHEQUE', amount: 3000, chequeNo: '000123', bank: 'Test Bank', payee: 'Owner Co (test)', chequeDate: TODAY, photos: PDF('chq') });
    await act('u-finance-am', 'rentHandover', { id: m.id, step: 'give' });
    await act('u-asset-re1', 'rentHandover', { id: m.id, step: 'take' });
    const bad = (await act('u-asset-re1', 'rentChequeCheck', { id: m.id, checks: { payer: true, payee: false, spelling: true, amount: true, date: true, number: true, matches: true }, reason: 'payee spelled wrong', toldHow: 'email to the tenant' })) as OfficeAmRec;
    expect(bad.status).toBe('returned');
    await expect(act('u-asset-re1', 'rentDeposit', { id: m.id, photos: PDF('slip'), slipNo: 'S1' })).rejects.toThrow(/never banked/);
    // The replacement cheque.
    await act('u-asset-re1', 'rentReceived', { id: m.id, method: 'CHEQUE', amount: 3000, chequeNo: '000124', bank: 'Test Bank', payee: 'Owner Co (test)', chequeDate: TODAY, photos: PDF('chq2') });
    await act('u-finance-am', 'rentHandover', { id: m.id, step: 'give' });
    await act('u-asset-re1', 'rentHandover', { id: m.id, step: 'take' });
    await act('u-asset-re1', 'rentChequeCheck', { id: m.id, checks: { payer: true, payee: true, spelling: true, amount: true, date: true, number: true, matches: true } });
    await expect(act('u-asset-re1', 'rentDeposit', { id: m.id, photos: PDF('slip'), slipNo: 'S1', accountCompanyId: 'co-arsh' })).rejects.toThrow(/OWNER company/);
    await act('u-asset-re1', 'rentDeposit', { id: m.id, photos: PDF('slip'), slipNo: 'SLIP-T-1' });
    await expect(act('u-asset-re1', 'rentMatch', { id: m.id, statementRef: 'x', receiptNo: 'y' })).rejects.toThrow(AccessDenied);
    const paid = (await act('u-fd', 'rentMatch', { id: m.id, statementRef: 'STMT-1', receiptNo: 'OR-TEST-9' })) as OfficeAmRec;
    expect(paid.status).toBe('paid');
  });
  it('e-wallet only into the owner account; Finance who received cash cannot match it', async () => {
    const { act, unit } = fresh();
    const t = (await act('u-asset-re1', 'tenancyOpen', { unitId: unit.id, tenant: 'Tenant Co (test)', ssm: 'SSM-T-2', invoiceEmail: 'a@example.test' })) as OfficeAmRec;
    for (const line of ['ssm', 'kdnLicence', 'kdnAddress', 'pbtLicence']) await act('u-asset-re1', 'tenancyCheck', { id: t.id, line, state: 'not_needed', reason: 'test only' });
    await act('u-asset-re1', 'tenancyTerms', { id: t.id, rent: 1000, startOn: '2026-12-01', endOn: '2027-11-30', account: 'Test Bank 1234' });
    const m = (await act('u-finance-am', 'rentInvoice', { tenancyId: t.id, period: '2026-12', invoiceNo: 'IV-TEST-2', amount: 1000 })) as OfficeAmRec;
    await act('u-asset-re1', 'rentInvoiceCheck', { id: m.id });
    await act('u-asset-re1', 'rentSent', { id: m.id, to: 'a@example.test', docs: PDF('inv') });
    await expect(act('u-asset-re1', 'rentReceived', { id: m.id, method: 'EWALLET', amount: 1000, txnId: 'T1', photos: PDF('shot') })).rejects.toThrow(/never a personal wallet/);
    await act('u-finance-am', 'rentReceived', { id: m.id, method: 'CASH', amount: 1000, receiptNo: 'OR-CASH-1' });
    await act('u-finance-am', 'rentDeposit', { id: m.id, photos: PDF('slip'), slipNo: 'SLIP-T-2' });
    await expect(act('u-finance-am', 'rentMatch', { id: m.id, statementRef: 'x', receiptNo: 'y' })).rejects.toThrow(/cannot mark it paid/);
  });
});

describe('Part S periodic visits (S75-S84)', () => {
  it('approved schedule, office rep confirms, issues need a photo, critical marks unsafe and opens a repair, closes only when done', async () => {
    const { act, exec, unit } = fresh();
    const p = (await act('u-asset-mm', 'visitPlan', { place: 'Test office', placeKind: 'office', companyId: 'co-sasa', unitId: unit.id })) as OfficeAmRec;
    await expect(act('u-asset-mm', 'visitOpen', { planId: p.id, photos: PDF('in') })).rejects.toThrow(/not approved/);
    await act('u-asset-dir', 'visitPlanApprove', { id: p.id, reason: 'every 3 months' });
    const v = (await act('u-asset-mm', 'visitOpen', { planId: p.id, photos: PDF('in') })) as OfficeAmRec;
    await expect(act('u-cm-arsh', 'visitAccess', { id: v.id })).rejects.toThrow(AccessDenied);
    await act(exec.id, 'visitAccess', { id: v.id });
    await expect(act('u-asset-mm', 'visitRecord', { id: v.id, line: 'wiring', state: 'issue', note: 'loose' })).rejects.toThrow(/photo and a note/);
    const f = (await act('u-asset-mm', 'visitFinding', { id: v.id, line: 'wiring', level: 'CRITICAL', type: 'safety_risk', note: 'Exposed live wire', photos: PDF('wire') })) as OfficeAmRec;
    const finding = (f.d.findings as { outcome: string; unsafe: unknown }[])[0];
    expect(finding.outcome).toBe('repair');
    expect(finding.unsafe).toBeTruthy();
    for (const line of ['wiring', 'lightsSwitches', 'pipesWater', 'doorsWindows', 'ceilingWalls', 'equipment', 'facilities', 'other']) await act('u-asset-mm', 'visitRecord', { id: v.id, line, state: 'ok' });
    await expect(act('u-asset-mm', 'visitClose', { id: v.id })).rejects.toThrow(/still open/);
    await act('u-asset-mm', 'visitFollowUp', { id: v.id, finding: 0, cancel: true, reason: 'merged into an earlier job' });
    const closed = (await act('u-asset-mm', 'visitClose', { id: v.id })) as OfficeAmRec;
    expect(closed.status).toBe('closed');
  });
});

describe('Part S board and settings', () => {
  it('prices hidden from requesters; settings only by the unit with a reason; integrations refused', async () => {
    const { act, unit, exec, svc } = fresh();
    const r = (await act(exec.id, 'repairRequest', { unitId: unit.id, damageType: 'door', example: 'Kunci pintu', description: 'Lock jammed', photos: PDF('d') })) as OfficeAmRec;
    await act('u-asset-mm', 'repairCheck', { id: r.id, outcome: 'accept', reason: 'fine' });
    await act('u-asset-mm', 'repairQuotes', { id: r.id, quotes: [{ contractor: 'A (test)', price: 100 }, { contractor: 'B (test)', price: 120 }, { contractor: 'C (test)', price: 130 }], docs: PDF('q', 3) });
    const mine = (await act(exec.id, 'board', {})) as { records: OfficeAmRec[] };
    expect(mine.records.find((x) => x.id === r.id)!.d.quotes).toBeUndefined();
    const unitView = (await act('u-asset-mm', 'board', {})) as { records: OfficeAmRec[] };
    expect((unitView.records.find((x) => x.id === r.id)!.d.quotes as unknown[]).length).toBe(3);
    const other = (await act('u-cm-arsh', 'board', {})) as { records: OfficeAmRec[] };
    expect(other.records.find((x) => x.id === r.id)).toBeUndefined();
    await expect(act(exec.id, 'setSettings', { reason: 'x', repair: { quotesNeeded: 1 } })).rejects.toThrow(AccessDenied);
    await expect(act('u-asset-mm', 'setSettings', { repair: { quotesNeeded: 2 } })).rejects.toThrow(/reason/);
    await act('u-asset-mm', 'setSettings', { reason: 'policy review test', repair: { quotesNeeded: 2 } });
    const integ = { ...(await svc.user('u-asset-mm')), integration: true } as User;
    await expect(svc.officeAmAct(integ, 'board', {})).rejects.toThrow(AccessDenied);
  });
});
