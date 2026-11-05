import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Cross-module (Fauzan, 2 Nov 2026: "hostel payment once key in in finance can be known in fwm that hostel bills has been
// paid with record"). Finance keys the payment in once; FWM and the company see it paid with the bank, day and
// reference, and Prima writes on the bill where it saw the money leave the account. Dummy data only.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const BILL = 'hb-hs-sasa-klang-rent-2026-09'; // co-sasa, approved by the COO on 18 Oct, RM3,200, Finance team 4
const C = 'co-sasa';

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  let now = NOW;
  const svc = new PrimaService(store, () => now);
  return { ds, store, svc, setDay: (d: string) => (now = myt(d, '10:00')) };
}

describe('Hostel bill paid in Finance is known in FWM', () => {
  it('records the payment once, shows it to FWM with the record, and needs no slip', async () => {
    const { ds, store, svc } = setup();
    const [lead, other, coo, fwm, cm] = await Promise.all(['u-fin-t4-lead', 'u-fin-t1-de1', 'u-coo', 'u-fwm-ex1', 'u-cm-sasa'].map((id) => svc.user(id)));
    const bank = ds.finStatus.find((x) => x.companyId === C)!.banks[0];
    const pay = (u: typeof lead, input: Record<string, unknown>) =>
      svc.financeControls.hostelAction(u, C, 'paid', { billId: BILL, bankId: bank.id, on: '2026-10-30', ref: 'IBG 3010-001', ...input });

    // Finance's view lists it first, ready to record.
    const v = await svc.financeControls.view(lead, C);
    expect(v.hostel[0]).toMatchObject({ id: BILL, mayRecord: true, status: 'coo_approved' });

    // Another team, the COO, a wrong amount, a day before the COO approved and a future day are refused.
    await expect(pay(other, {})).rejects.toThrow();
    await expect(pay(coo, {})).rejects.toThrow();
    await expect(pay(lead, { amount: 3000 })).rejects.toThrow(/exactly the approved RM3200.00/);
    await expect(pay(lead, { on: '2026-10-17' })).rejects.toThrow(/after the COO approves/);
    await expect(pay(lead, { on: '2026-11-01' })).rejects.toThrow(/future/);

    expect(await pay(lead, {})).toMatchObject({ ok: true, seen: false });
    const bill = await store.get('hostelBills', BILL);
    expect(bill).toMatchObject({
      status: 'paid',
      financePaid: { bankId: bank.id, on: '2026-10-30', ref: 'IBG 3010-001', amount: 3200, byId: 'u-fin-t4-lead' },
    });
    await expect(pay(lead, {})).rejects.toThrow(/already recorded/);

    // FWM sees it paid, recorded by Finance, with the record; the company is not asked for a slip.
    const board = await svc.hostelBoard(fwm);
    const row = board.hostels.flatMap((r) => r.bills).find((b) => b.bill.id === BILL)!;
    expect(row.waitingOn).toBe('Paid, recorded by Finance');
    expect(row.bill.financePaid?.ref).toBe('IBG 3010-001');
    const cmRow = (await svc.hostelBoard(cm)).hostels.flatMap((r) => r.bills).find((b) => b.bill.id === BILL)!;
    expect(cmRow.can.slip).toBe(false);
    await expect(svc.uploadHostelSlip(cm, BILL, '', [])).rejects.toThrow(/Finance has already recorded/);
  });

  it('writes on the bill where the money was seen on the bank statement, and takes it back when unmatched', async () => {
    const { ds, store, svc, setDay } = setup();
    const [lead, fwm] = await Promise.all(['u-fin-t4-lead', 'u-fwm-ex1'].map((id) => svc.user(id)));
    const bank = ds.finStatus.find((x) => x.companyId === C)!.banks[0];
    await svc.financeControls.hostelAction(lead, C, 'paid', { billId: BILL, bankId: bank.id, on: '2026-10-20', ref: 'IBG2010777' });
    // On 3 November, the October statement: the rent left on 21 Oct with the reference. Loaded by someone who did not pay from the account.
    const csv = 'date,description,ref,amount\n2026-10-21,IBG HOSTEL RENT,IBG2010777,-3200.00\n2026-10-25,CLIENT,X1,5000.00';
    setDay('2026-11-03');
    await svc.financeControls.statementAction(lead, C, 'load', {
      bankId: bank.id,
      period: '2026-10',
      opening: 10000,
      closing: 11800,
      csv,
      source: 'mock-oct.csv',
    });
    const bill = await store.get('hostelBills', BILL);
    expect(bill?.bankSeen).toMatchObject({ date: '2026-10-21', amount: 3200, bank: `${bank.bank} ${bank.accountMasked}` });
    const row = (await svc.hostelBoard(fwm)).hostels.flatMap((r) => r.bills).find((b) => b.bill.id === BILL)!;
    expect(row.waitingOn).toBe('Paid, recorded by Finance, seen in bank');
    // Unmatched by the team leader with a reason: the bill loses its bank record.
    const st = (await store.get('finStatus', `fin-${C}`))!.statements!.find((x) => x.period === '2026-10')!;
    const line = st.lines.find((l) => l.match?.kind === 'hostel')!;
    await svc.financeControls.statementAction(lead, C, 'unmatch', { statementId: st.id, lineId: line.id, comment: 'Wrong line, this was the deposit' });
    expect((await store.get('hostelBills', BILL))?.bankSeen ?? null).toBeNull();
  });
});

describe('Staff-eye review: work per company and section', () => {
  it('counts what waits for the person per company and Checks section, and each home item opens there', async () => {
    const { svc } = setup();
    const lead = await svc.user('u-fin-t4-lead');
    const todo = await svc.financeControls.checksTodo(lead);
    // The approved hostel bill waits for payment in co-sasa's "Paying out" section once overdue.
    expect(Object.keys(todo).length).toBeGreaterThan(0);
    for (const sections of Object.values(todo)) for (const k of Object.keys(sections)) expect(['out', 'bank', 'in', 'cash', 'tax']).toContain(k);
    const items = await svc.financeControls.home(lead);
    expect(items.length).toBeGreaterThan(0);
    for (const t of items) {
      // Purchases ready to pay open New payment on the Payments tab (suggestion 10); everything else opens its Checks section.
      if (t.go.tab === 'payments') {
        expect(t.title).toMatch(/ready to pay/);
        continue;
      }
      expect(t.go).toMatchObject({ view: 'finance', tab: 'checks' });
      expect(['out', 'bank', 'in', 'cash', 'tax']).toContain(t.go.section);
      if (t.go.companyId) expect(todo[t.go.companyId]?.[t.go.section!]).toBeGreaterThan(0);
    }
    // Another team's lead sees none of team 4's companies.
    const other = await svc.financeControls.checksTodo(await svc.user('u-fin-t1-lead'));
    expect(other['co-sasa']).toBeUndefined();
  });
});

describe('Payroll sees its contributions paid by Finance', () => {
  it('lists EPF, PERKESO, PCB, HRD and staff zakat for the month with where they stand in Finance', async () => {
    const { ds } = setup();
    const { finPayrollRemittances } = await import('../src/finance-regular');
    const f = ds.finStatus.find((x) => x.companyId === 'co-09')!;
    const before = finPayrollRemittances(f, '2026-09', TODAY);
    const epf = before.find((x) => x.body === 'EPF')!;
    expect(epf.dueOn).toBe('2026-10-15');
    expect(epf.state).not.toBe('paid');
    // Paid: the direct debit or the released payment is what HR and the Chief of Staff then see.
    const r = f.regular!.find((x) => x.body === 'EPF')!;
    r.dues = [
      ...r.dues.filter((d) => d.period !== '2026-10'),
      { period: '2026-10', dueOn: '2026-10-15', bill: null, paymentId: null, debited: { statementId: 's', lineId: 'l', date: '2026-10-15' } },
    ];
    expect(finPayrollRemittances(f, '2026-09', TODAY).find((x) => x.body === 'EPF')).toMatchObject({ state: 'paid', paidOn: '2026-10-15', seenInBank: true });
  });
});
