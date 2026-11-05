import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finCloseCheck, generateDataset, myt } from '../src';
type HostelBill = import('../src').HostelBill;

// Regular payments and guarantees (Fauzan, 2 Nov 2026): hire purchase, bills, building loans, PCB, zakat, insurance,
// IG and BG, hostel bills. Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const F = () => ds.finStatus.find((x) => x.companyId === T1)!;
  const [de1, de2, dep, lead, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd'].map((id) => svc.user(id)));
  const C = svc.financeControls;
  const bankId = F().banks[0].id;
  const reg = (u: typeof de1, action: string, input: Record<string, unknown>) => C.regularAction(u, T1, action, input) as Promise<any>;
  const gte = (u: typeof de1, action: string, input: Record<string, unknown>) => C.guaranteeAction(u, T1, action, input) as Promise<any>;
  const load = (period: string, lines: [string, string, string, number][], opening = 100_000) =>
    C.statementAction(de2, T1, 'load', {
      bankId,
      period,
      opening,
      closing: Math.round((opening + lines.reduce((n, l) => n + l[3], 0)) * 100) / 100,
      csv: lines.map((l) => l.join(',')).join('\n'),
      source: `m2u-${period}.csv`,
    });
  return { ds, svc, F, de1, de2, dep, lead, fd, C, bankId, reg, gte, load };
}
const hp = (bankId: string) => ({
  kind: 'hire_purchase',
  name: 'Patrol van hire purchase (mock)',
  payeeId: 'payee-pwvsb-003',
  reference: 'HP-778812 (mock)',
  method: 'direct_debit',
  bankId,
  every: 'monthly',
  dueDay: 5,
  firstDue: '2026-08-05',
  lastDue: '2030-07-05',
  amount: 2150,
  principal: 98000,
  instalments: 48,
  security: 'Van VEX 1234 (mock)',
  subject: 'transport',
});

describe('regular payments: hire purchase, loans, bills, statutory, zakat (Fauzan, 2 Nov 2026)', () => {
  it('a direct debit is checked by a second person and then found on the bank statement by Prima; a missing one is flagged', async () => {
    const { F, de1, dep, lead, reg, load, bankId, C } = await setup();
    const r = await reg(de1, 'add', hp(bankId));
    expect(r.status).toBe('pending');
    // Nobody checks their own entry; a data entry clerk does not check at all.
    await expect(reg(de1, 'check', { regularId: r.id, comment: 'Agreement page 2' })).rejects.toThrow();
    await reg(dep, 'check', { regularId: r.id, comment: 'Agreed to the HP agreement page 2 (mock)' });
    // September: the bank took it a day late; Prima finds it. August: the statement is loaded and it is not there.
    await load('2026-09', [['2026-09-06', 'DD KENDERAAN RONDA HP-778812', 'DD0906', -2150], ['2026-09-10', 'TRF', 'X1', -10]]);
    await load('2026-08', [['2026-08-12', 'TRF', 'X2', -10]]);
    const v = await C.view(lead, T1);
    const row = v.regular.find((x) => x.id === r.id)!;
    const state = Object.fromEntries(row.next.map((d) => [d.period, d.state]));
    expect(state['2026-09']).toBe('paid');
    expect(state['2026-08']).toBe('not_seen');
    expect(F().statements!.find((s) => s.period === '2026-09')!.lines[0].match).toMatchObject({ kind: 'regular', regularId: r.id, period: '2026-09' });
    // The month-end close lists the missing debit; the found one is no longer "money left the bank with no payment".
    const aug = finCloseCheck(F(), null, '2026-08', NOW).exceptions.map((x) => x.text).join('\n');
    expect(aug).toMatch(/Direct debit Patrol van hire purchase.*not on the bank statement/);
    const sep = finCloseCheck(F(), null, '2026-09', NOW).exceptions.map((x) => x.text).join('\n');
    expect(sep).not.toMatch(/2150\.00 left the bank/);
    expect((await C.home(lead)).map((x) => x.title)).toContain('1 direct debit(s) not on the bank statement');
    // The instalments left are counted.
    expect(row.remaining).toBe(47);
  });

  it('a bill that varies is paid only for the amount on the recorded bill, to the listed payee, once; an unusual bill needs an explanation', async () => {
    const { F, de1, de2, dep, reg, svc, bankId } = await setup();
    const r = await reg(de1, 'add', { kind: 'bill', name: 'Office electricity (mock)', payeeId: 'payee-pwvsb-004', reference: 'TNB 2200-1234 (mock)', method: 'transfer', bankId, every: 'monthly', dueDay: 20, firstDue: '2026-09-20' });
    await reg(dep, 'check', { regularId: r.id, comment: 'Agreed to the TNB account letter (mock)' });
    const pay = (amount: number, period = '2026-10', who = de2) =>
      svc.finance.createPayment(who, T1, { regularId: r.id, regularPeriod: period, payeeId: 'payee-pwvsb-001', purpose: 'Electricity October', amount, dueOn: '2026-10-20', bankId, sqlRef: `PV-TNB-${period}`, evidence: ['tnb-oct.pdf'], subject: 'operations' });
    await expect(pay(800)).rejects.toThrow(/Record the 2026-10 bill/);
    await reg(de1, 'bill', { regularId: r.id, period: '2026-10', amount: 812.4, doc: 'TNB bill Oct (mock).pdf' });
    await expect(pay(900)).rejects.toThrow(/must be the RM812.40/);
    // Whoever typed the bill amount does not also prepare its payment.
    await expect(pay(812.4, '2026-10', de1)).rejects.toThrow(/someone else prepares/);
    const p = await pay(812.4);
    // The payee and the approver come from the list, whatever the preparer chose.
    expect([p.payeeId, p.subject, p.needs, p.regularId, p.regularPeriod]).toEqual(['payee-pwvsb-004', 'finance', 'director', r.id, '2026-10']);
    await expect(pay(812.4)).rejects.toThrow(/already being paid/);
    // Once it is being paid the bill cannot be changed underneath it.
    await expect(reg(de1, 'bill', { regularId: r.id, period: '2026-10', amount: 9000, doc: 'x.pdf' })).rejects.toThrow(/already being paid/);
    // Cancelling frees the due date again.
    await svc.finance.paymentStep(de2, T1, p.id, 'cancel', { comment: 'Wrong SQL Account voucher.' });
    expect(F().regular![0].dues.find((d) => d.period === '2026-10')!.paymentId).toBeNull();
    // November's bill at almost three times October's needs a reason.
    await expect(reg(de1, 'bill', { regularId: r.id, period: '2026-11', amount: 2300, doc: 'TNB Nov.pdf' })).rejects.toThrow(/explain why/);
    const ok = await reg(de1, 'bill', { regularId: r.id, period: '2026-11', amount: 2300, doc: 'TNB Nov.pdf', unusual: 'Back-billing for 3 months after meter change (mock).' });
    expect(ok.dues.find((d: any) => d.period === '2026-11').bill.unusual).toMatch(/Back-billing/);
  });

  it('statutory and zakat are always Finance payments approved by the FD or CEO; a change goes back for checking and blocks payment', async () => {
    const { de1, de2, dep, reg, svc, bankId } = await setup();
    const epf = await reg(de1, 'add', { kind: 'statutory', body: 'EPF', name: 'EPF October (mock)', payeeId: 'payee-pwvsb-006', reference: 'Employer no 12345678 (mock)', method: 'transfer', bankId, every: 'monthly', dueDay: 15, firstDue: '2026-09-15', subject: 'operations' });
    expect(epf.subject).toBe('finance');
    await expect(reg(de1, 'add', { kind: 'zakat', body: 'Zakat Johor', name: 'Zakat', payeeId: 'payee-pwvsb-001', reference: 'Z-1 (mock)', method: 'transfer', bankId, every: 'monthly', dueDay: 15, firstDue: '2026-09-15', zakatFor: 'staff' })).rejects.toThrow(/zakat body/);
    const z = await reg(de1, 'add', { kind: 'zakat', body: 'Zakat Selangor', zakatFor: 'staff', name: 'Staff zakat deductions (mock)', payeeId: 'payee-pwvsb-001', reference: 'LZS majikan 778 (mock)', method: 'transfer', bankId, every: 'monthly', dueDay: 15, firstDue: '2026-09-15' });
    expect([z.subject, z.body, z.zakatFor]).toEqual(['finance', 'Zakat Selangor', 'staff']);
    await reg(dep, 'check', { regularId: epf.id, comment: 'Agreed to KWSP employer letter (mock)' });
    await reg(de1, 'bill', { regularId: epf.id, period: '2026-10', amount: 15000, doc: 'KWSP Borang A Oct (mock).pdf' });
    // An insider changes the payee on the list: it goes back to pending, and nothing can be paid from it until someone else checks.
    await reg(de2, 'change', { regularId: epf.id, payeeId: 'payee-pwvsb-001', comment: 'Payee changed per new letter (mock).' });
    await expect(svc.finance.createPayment(de1, T1, { regularId: epf.id, regularPeriod: '2026-10', purpose: 'EPF', amount: 15000, dueOn: '2026-10-15', bankId, sqlRef: 'PV-EPF', evidence: ['a.pdf'] })).rejects.toThrow(/waiting to be checked/);
    await expect(reg(de2, 'check', { regularId: epf.id, comment: 'Looks fine' })).rejects.toThrow();
  });

  it('IG: collateral is claimed only after release or expiry, and the refund is found on the bank statement', async () => {
    const { de1, de2, dep, lead, gte, load, bankId, C } = await setup();
    const g = await gte(de1, 'add', { kind: 'IG', issuer: 'Insurans Jaminan (mock)', number: 'IG-2025-0091', beneficiary: 'Hospital client (mock)', purpose: 'Guarding contract 2025-2026 (mock)', amount: 50000, collateral: 15000, bankId, issuedOn: '2025-09-01', expiresOn: '2026-12-31', doc: 'IG letter (mock).pdf' });
    await expect(gte(de1, 'check', { guaranteeId: g.id, comment: 'ok ok' })).rejects.toThrow();
    await gte(dep, 'check', { guaranteeId: g.id, comment: 'Agreed to the insurer letter (mock)' });
    await expect(gte(de1, 'claim', { guaranteeId: g.id, ref: 'CLM-1', docs: ['a.pdf'] })).rejects.toThrow(/released.*or it expired/);
    const claims = async () => Number((await C.home(lead)).find((x) => /IG\/BG released or expired/.test(x.title))?.title.split(' ')[0] ?? 0);
    const before = await claims();
    await gte(de1, 'release', { guaranteeId: g.id, on: '2026-09-02', doc: 'Client release letter (mock).pdf' });
    // Two weeks after the release and no claim: Finance is told to claim it back.
    expect(await claims()).toBe(before + 1);
    await gte(de2, 'claim', { guaranteeId: g.id, on: '2026-09-05', ref: 'CLM-0091', docs: ['Release letter.pdf', 'Claim form.pdf'] });
    await expect(gte(lead, 'end', { guaranteeId: g.id, comment: 'Collateral returned.' })).rejects.toThrow(/not been seen/);
    await load('2026-09', [['2026-09-25', 'IBG INSURANS JAMINAN IG-2025-0091', 'R1', 15000]]);
    const v = await C.view(lead, T1);
    expect(v.guarantees[0]).toMatchObject({ status: 'refunded', refund: { amount: 15000 } });
    expect(v.collateralHeld).toBe(0);
    await gte(lead, 'end', { guaranteeId: g.id, comment: 'Collateral back in the bank.' });
  });

  it('hostel bills the company paid itself are found on its bank statement; one marked paid but not seen is flagged to Finance', async () => {
    const { ds, F, lead, de2, load, C } = await setup();
    const bill = (id: string, amount: number, day: string): HostelBill => ({
      id, companyId: T1, hostelId: 'hostel-x', kind: 'RENT', period: '2026-09', amount, dueOn: '2026-09-07', status: 'paid', billDocIds: [],
      request: null, fwmCheck: null, sectorApproval: null, cooApproval: null,
      slip: { userId: 'u-x', by: 'Company admin (mock)', at: myt(day, '11:00'), note: '', docIds: ['slip.pdf'] }, returned: null, createdBy: 'mock', createdAt: myt('2026-09-01', '09:00'),
    });
    ds.hostelBills.push(bill('hb-1', 4000, '2026-09-08'), bill('hb-2', 1250, '2026-09-09'));
    // Every account's September statement is loaded, so a paid bill not seen on any of them is a real gap.
    for (const b of F().banks.slice(1))
      await C.statementAction(de2, T1, 'load', { bankId: b.id, period: '2026-09', opening: 0, closing: 1, csv: '2026-09-30,PROFIT,P1,1', source: 'x.csv' });
    await load('2026-09', [['2026-09-08', 'TRF HOSTEL RENT', 'H1', -4000]]);
    expect(F().statements!.find((s) => s.period === '2026-09' && s.bankId === F().banks[0].id)!.lines[0].match).toMatchObject({ kind: 'hostel', hostelBillId: 'hb-1' });
    const v = await C.view(lead, T1);
    expect(v.hostel.find((x) => x.id === 'hb-1')).toMatchObject({ onStatement: true, unseen: false });
    expect(v.hostel.find((x) => x.id === 'hb-2')).toMatchObject({ onStatement: false, unseen: true });
    expect((await C.home(lead)).map((x) => x.title)).toContain("1 hostel bill(s) marked paid but not on the company's bank statement");
  });
});
