import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, finFdInterest, finIsCharge, generateDataset, myt } from '../src';

// Fixed deposits and bank charges (Fauzan, 2 Nov 2026: suggestions 15 and 16). Dummy data only.
const C = 'co-09';

function setup(today: string) {
  const ds = generateDataset({ today: '2026-10-31', now: myt('2026-10-31', '10:00') });
  const store = new MemoryStore(ds);
  let now = myt(today, '10:00');
  const svc = new PrimaService(store, () => now);
  return { ds, store, svc, setDay: (d: string) => (now = myt(d, '10:00')) };
}

describe('Fixed deposits and bank charges', () => {
  it('checks a deposit, finds its placement and uplift on the statements, and warns before maturity', async () => {
    const { ds, store, svc, setDay } = setup('2026-11-03');
    const [de, dep, lead, fdir] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd'].map((id) => svc.user(id)));
    const bank = ds.finStatus.find((x) => x.companyId === C)!.banks[0];
    await expect(
      svc.financeControls.fdAction(de, C, 'add', {
        bank: 'Maybank',
        refMasked: '123456789',
        bankId: bank.id,
        amount: 100000,
        rate: 2.6,
        placedOn: '2026-10-05',
        maturesOn: '2027-01-05',
        doc: 'x.pdf',
      }),
    ).rejects.toThrow(/last 4/);
    const fd = (await svc.financeControls.fdAction(de, C, 'add', {
      bank: 'Maybank',
      refMasked: '6789',
      bankId: bank.id,
      amount: 100000,
      rate: 2.6,
      placedOn: '2026-10-05',
      maturesOn: '2027-01-05',
      doc: 'FD confirmation.pdf',
    })) as { id: string };
    await expect(svc.financeControls.fdAction(de, C, 'check', { fdId: fd.id, comment: 'Checked to confirmation' })).rejects.toThrow();
    await svc.financeControls.fdAction(dep, C, 'check', { fdId: fd.id, comment: 'Checked to the bank confirmation' });
    // October statement: the placement and the bank's charges.
    const csv =
      'date,description,ref,amount\n2026-10-05,FD PLACEMENT,6789,-100000.00\n2026-10-31,SERVICE CHARGE,SC,-45.00\n2026-10-31,IBG FEE,F1,-12.00\n2026-10-20,CLIENT,X,150000.00';
    await svc.financeControls.statementAction(fdir, C, 'load', { bankId: bank.id, period: '2026-10', opening: 0, closing: 49943, csv, source: 'oct.csv' });
    let row = (await store.get('finStatus', `fin-${C}`))!;
    expect(row.fixedDeposits![0].placedSeen?.date).toBe('2026-10-05');
    // Charges: RM57 against an agreed RM40 needs an explanation by a reviewer.
    let v = await svc.financeControls.view(de, C);
    expect(v.banking.charges.find((c) => c.bankId === bank.id)!.charges).toBe(57);
    await expect(svc.financeControls.chargeAction(de, C, 'terms', { bankId: bank.id, monthlyMax: 40, note: 'Tariff 2026' })).rejects.toThrow();
    await svc.financeControls.chargeAction(lead, C, 'terms', { bankId: bank.id, monthlyMax: 40, note: 'Maybank tariff 2026 (mock)' });
    expect((await svc.financeControls.home(dep)).some((t) => /charged more than the bank agreed/.test(t.title))).toBe(true);
    await svc.financeControls.chargeAction(dep, C, 'explain', { bankId: bank.id, period: '2026-10', comment: 'Asked the bank to reverse the IBG fee' });
    // Near maturity Prima asks for a decision; uplift; the money back is found on the January statement.
    setDay('2026-12-28');
    expect((await svc.financeControls.home(de)).some((t) => /maturing within/.test(t.title))).toBe(true);
    setDay('2027-01-05');
    await svc.financeControls.fdAction(de, C, 'uplift', { fdId: fd.id });
    setDay('2027-02-03');
    // Statements for Nov and Dec carry the balance on; January has the uplift.
    await expect(
      svc.financeControls.statementAction(fdir, C, 'load', {
        bankId: bank.id,
        period: '2026-11',
        opening: 1,
        closing: 101,
        csv: 'date,description,ref,amount\n2026-11-10,CLIENT,Y,100.00',
        source: 'nov.csv',
      }),
    ).rejects.toThrow(/not last month's closing/);
    await svc.financeControls.statementAction(fdir, C, 'load', {
      bankId: bank.id,
      period: '2026-11',
      opening: 49943,
      closing: 50043,
      csv: 'date,description,ref,amount\n2026-11-10,CLIENT,Y,100.00',
      source: 'nov.csv',
    });
    await svc.financeControls.statementAction(fdir, C, 'load', {
      bankId: bank.id,
      period: '2026-12',
      opening: 50043,
      closing: 50143,
      csv: 'date,description,ref,amount\n2026-12-10,CLIENT,Z,100.00',
      source: 'dec.csv',
    });
    const back = 100000 + finFdInterest(100000, 2.6, '2026-10-05', '2027-01-05');
    await svc.financeControls.statementAction(fdir, C, 'load', {
      bankId: bank.id,
      period: '2027-01',
      opening: 50143,
      closing: 50143 + back,
      csv: `date,description,ref,amount\n2027-01-05,FD UPLIFT 6789,6789,${back.toFixed(2)}`,
      source: 'jan.csv',
    });
    row = (await store.get('finStatus', `fin-${C}`))!;
    expect(row.fixedDeposits![0].upliftSeen?.amount).toBe(back);
    v = await svc.financeControls.view(de, C);
    expect(v.banking.placed).toBe(0);
  });

  it('interest is not counted as a charge, and FD interest is worked out on actual days', () => {
    expect(finIsCharge({ description: 'INTEREST CREDIT', ref: '', amount: 12 })).toBe(false);
    expect(finIsCharge({ description: 'SERVICE CHARGE', ref: '', amount: -5 })).toBe(true);
    expect(finFdInterest(100000, 2.6, '2026-10-05', '2027-01-05')).toBe(655.34);
  });
});
