import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, generateDataset, myt, withFinPayments } from '../src';

// B3 (Fauzan, 23 Nov 2026): Finance payments in their own table. The Finance code is unchanged; the wrapper keeps each
// payment as one row and the Finance status row stays small. Dummy data.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;

describe('B3: Finance payments in their own table', () => {
  it('reads payments still inside the status row, and moves them out on the next save', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(withFinPayments(new MemoryStore(ds)), () => NOW);
    const before = (ds.finStatus.find((x) => x.companyId === T1)!.payments ?? []).map((p) => p.id);
    const [de, lead, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd'].map((id) => svc.user(id)));
    const f = ds.finStatus.find((x) => x.companyId === T1)!;
    // Nothing moved yet: the old payments still read through the wrapper.
    const desk0 = await svc.finance.desk(fd);
    expect(desk0.companies.find((c) => c.companyId === T1)!.payments.map((p) => p.id)).toEqual(before);
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'UAT stationery', amount: 99.5, dueOn: '2026-12-01', bankId: f.banks[0].id, sqlRef: 'PI-B3-1', evidence: ['inv.pdf'] });
    // Every payment of the company is now a row of its own, in order; the status row holds none.
    expect(ds.finStatus.find((x) => x.companyId === T1)!.payments).toEqual([]);
    const rows = ds.finPayments.filter((r) => r.companyId === T1).sort((a, b) => a.seq - b.seq);
    expect(rows.map((r) => r.payment.id)).toEqual([...before, p.id]);
    expect(rows.every((r) => r.id === `${T1}:${r.payment.id}`)).toBe(true);
    // The steps work as before and change only that payment's row.
    const others = rows.filter((r) => r.payment.id !== p.id).map((r) => JSON.stringify(r));
    await svc.finance.paymentStep(lead, T1, p.id, 'review', { comment: 'Matches the quotation.' });
    const after = ds.finPayments.find((r) => r.id === `${T1}:${p.id}`)!;
    expect(after.payment.status).toBe('reviewed');
    expect(ds.finPayments.filter((r) => r.companyId === T1 && r.payment.id !== p.id).map((r) => JSON.stringify(r))).toEqual(others);
    const desk1 = await svc.finance.desk(fd);
    expect(desk1.companies.find((c) => c.companyId === T1)!.payments.find((x) => x.id === p.id)!.status).toBe('reviewed');
  });

  it('never deletes: a payment left out of a save is marked removed and hidden', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = withFinPayments(new MemoryStore(ds));
    const f = (await store.get('finStatus', `fin-${T1}`))!;
    const list = f.payments ?? [];
    expect(list.length).toBeGreaterThan(1);
    await store.update('finStatus', f.id, { payments: list });
    const saved = await store.update('finStatus', f.id, { payments: list.slice(1) });
    expect(saved.payments!.map((p) => p.id)).toEqual(list.slice(1).map((p) => p.id));
    expect(ds.finPayments.find((r) => r.payment.id === list[0].id)!.removed).toBe(true);
    expect(ds.finPayments.length).toBe(list.length + ds.finPayments.filter((r) => r.companyId !== T1).length);
  });
});
