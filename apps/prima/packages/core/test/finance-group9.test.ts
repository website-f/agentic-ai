import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, finCloseCheck, finCreditStatus, finLastQuarter, generateDataset, myt, type FinPayee } from '../src';

// Three-way match link to Procurement (10), client credit limits warned to Operations (4) and the key numbers on the
// home screen (26, A17) (Fauzan, 2 Nov 2026). Dummy data only.
const C = 'co-sasa';

function setup(today = '2026-11-03') {
  const ds = generateDataset({ today: '2026-10-31', now: myt('2026-10-31', '10:00') });
  const store = new MemoryStore(ds);
  let now = myt(today, '10:00');
  const svc = new PrimaService(store, () => now);
  return { ds, store, svc, setDay: (d: string) => (now = myt(d, '10:00')) };
}

const payee = (id: string, name: string, last4: string): FinPayee =>
  ({
    id,
    name,
    kind: 'supplier',
    regNo: 'mock',
    bank: 'Maybank',
    accountLast4: last4,
    accountName: name.toUpperCase(),
    status: 'verified',
    entered: { by: 'Finance Deputy 1', byId: 'u-fin-t1-dep', at: '2026-09-23T22:00:00+08:00', comment: 'Supplier form (mock)' },
    verified: {
      by: 'Finance Director',
      byId: 'u-fd',
      at: '2026-09-24T08:00:00+08:00',
      comment: 'Confirmed by phone.',
      method: 'callback',
      contact: 'Accounts (mock)',
      numberSource: 'Supply contract (mock)',
    },
    history: [],
  }) as FinPayee;

describe('Purchases paid against the three-way match', () => {
  it('pays a posted, matched purchase once, for the invoice amount, to the account Procurement verified; Procurement sees it', async () => {
    const { store, svc } = setup();
    const f = (await store.get('finStatus', `fin-${C}`))!;
    await store.update('finStatus', f.id, {
      payees: [payee('payee-sasa-up', 'Uniform Pro Supplies Sdn Bhd (mock)', '7889'), payee('payee-sasa-x', 'Other Supplies (mock)', '1111')],
    });
    const lead = await svc.user('u-fin-t4-lead');
    const desk = await svc.finance.desk(lead);
    const co = desk.companies.find((c) => c.companyId === C)!;
    const pur = co.purchases.find((p) => p.id === 'pr-co-sasa-6')!;
    expect(pur).toMatchObject({ amount: 2800, payeeId: 'payee-sasa-up', accountLast4: '7889' });
    // A purchase whose match failed is never offered.
    expect(co.purchases.some((p) => p.id === 'pr-co-sasa-5')).toBe(false);
    expect((await svc.financeControls.home(lead)).some((t) => /purchase\(s\) matched and posted, ready to pay/.test(t.title))).toBe(true);
    const base = { purpose: 'Uniforms', dueOn: '2026-11-10', bankId: co.banks[0].id, sqlRef: 'PI-00991', purchaseId: pur.id };
    await expect(svc.finance.createPayment(lead, C, { ...base, payeeId: 'payee-sasa-up', amount: 2900 })).rejects.toThrow(/2800/);
    await expect(svc.finance.createPayment(lead, C, { ...base, payeeId: 'payee-sasa-x', amount: 2800 })).rejects.toThrow(/7889/);
    await expect(svc.finance.createPayment(lead, C, { ...base, purchaseId: 'pr-co-sasa-5', payeeId: 'payee-sasa-up', amount: 2760 })).rejects.toThrow(
      /not ready/,
    );
    const p = await svc.finance.createPayment(lead, C, { ...base, payeeId: 'payee-sasa-up', amount: 2800, subject: 'finance' });
    // Procurement & Inventory is the COO's department: the COO or the CEO approves, whatever the preparer chose.
    expect(p).toMatchObject({ purchaseId: pur.id, subject: 'inventory', needs: 'coo' });
    await expect(svc.finance.createPayment(lead, C, { ...base, payeeId: 'payee-sasa-up', amount: 2800, sqlRef: 'PI-00992' })).rejects.toThrow(
      /already being paid/,
    );
    const board = await svc.purBoard(await svc.user('u-fd'));
    expect(board.requests.find((r) => r.req.id === pur.id)!.paid).toMatchObject({ paymentId: p.id, status: 'prepared' });
  });
});

describe('Client credit limits', () => {
  it('warns Operations before a new post for a client over its limit; the post can be added with a reason Finance sees', async () => {
    const { store, svc } = setup();
    const [lead, cm, fd] = await Promise.all(['u-fin-t4-lead', 'u-cm-sasa', 'u-fd'].map((id) => svc.user(id)));
    const client = (await store.get('clientAccounts', 'cl-st-sasa-002'))!;
    const post = { siteId: client.siteIds[0], name: 'Gate B (mock)', shiftStructure: 'A', guardsPerShift: 1 };
    // No limit and nothing overdue: no warning.
    await svc.saveRecord(cm, 'post', null, C, post);
    await expect(svc.financeControls.creditAction(cm, C, 'limit', { clientAccountId: client.id, limit: 1, comment: 'x' })).rejects.toThrow();
    await expect(svc.financeControls.creditAction(lead, C, 'balance', { clientAccountId: client.id, owed: 1 })).rejects.toThrow(/limit first/);
    await svc.financeControls.creditAction(fd, C, 'limit', { clientAccountId: client.id, limit: 50000, comment: 'Two months of billing' });
    await svc.financeControls.creditAction(lead, C, 'balance', { clientAccountId: client.id, owed: 62000, oldestUnpaidOn: '2026-09-15' });
    const f = (await store.get('finStatus', `fin-${C}`))!;
    expect(finCreditStatus(f, client, '2026-11-03').reasons[0]).toMatch(/over its credit limit/);
    await expect(svc.saveRecord(cm, 'post', null, C, { ...post, name: 'Gate C (mock)' })).rejects.toThrow(/Finance warning/);
    await svc.saveRecord(cm, 'post', null, C, { ...post, name: 'Gate C (mock)', creditReason: 'Client signed a variation order for the new gate (mock)' });
    expect((await svc.financeControls.home(fd)).some((t) => /post\(s\) added for clients Finance warned about/.test(t.title))).toBe(true);
    const o = (await store.get('finStatus', `fin-${C}`))!.creditOverrides![0];
    await svc.financeControls.creditAction(lead, C, 'seen', { overrideId: o.id, comment: 'Chasing the September invoice with the client' });
    expect((await store.get('finStatus', `fin-${C}`))!.creditOverrides![0].seen).toBeTruthy();
  });

  it('warns on an invoice unpaid over 90 days from the billing the company keeps, even with no limit', async () => {
    const { store } = setup();
    const client = (await store.get('clientAccounts', 'cl-st-sasa-001'))!;
    const f = (await store.get('finStatus', `fin-${C}`))!;
    expect(finCreditStatus(f, client, '2026-11-03').warn).toBe(false);
    expect(finCreditStatus(f, { ...client, billing: { ...client.billing!, overdueDays: 100 } }, '2026-11-03').reasons[0]).toMatch(/unpaid for 1\d\d days/);
  });
});

describe('Key numbers on the home screen', () => {
  it('shows cash, payments due, invoices over 90 days and companies not closed to the Finance Director', async () => {
    const { svc } = setup();
    const fd = await svc.user('u-fd');
    const tiles = await svc.financeControls.keyTiles(fd);
    expect(tiles.map((t) => t.label)).toEqual(
      expect.arrayContaining(['Cash in the banks (RM thousand)', 'Payments due in 7 days (RM thousand)', 'Invoices over 90 days (RM thousand)']),
    );
    const home = await svc.home(fd);
    expect(home.tiles.some((t) => t.label === 'Cash in the banks (RM thousand)')).toBe(true);
    expect(await svc.financeControls.keyTiles(await svc.user('u-cm-sasa'))).toEqual([]);
  });
});

describe('Supplier statements', () => {
  it('lists last quarter’s biggest suppliers, needs a reason for a difference and someone else to review', async () => {
    expect(finLastQuarter('2026-11-03')).toEqual({ quarter: '2026-Q3', endOn: '2026-09-30' });
    expect(finLastQuarter('2026-02-10')).toEqual({ quarter: '2025-Q4', endOn: '2025-12-31' });
    const { store, svc } = setup('2026-10-05');
    const f = (await store.get('finStatus', 'fin-co-09'))!;
    const pay = (id: string, payeeId: string, amount: number, on: string) => ({
      ...f.payments![0],
      id,
      payeeId,
      payee: payeeId,
      payeeKind: 'supplier' as const,
      amount,
      status: 'released' as const,
      releasedOn: on,
    });
    await store.update('finStatus', f.id, {
      payees: [...(f.payees ?? []), payee('payee-big', 'Big Supplier (mock)', '2222'), payee('payee-small', 'Small Supplier (mock)', '3333')],
      payments: [...(f.payments ?? []), pay('pay-x1', 'payee-big', 90000, '2026-08-01'), pay('pay-x2', 'payee-small', 500, '2026-08-02')],
    });
    const [de, dep] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep'].map((id) => svc.user(id)));
    let v = (await svc.financeControls.view(de, 'co-09')).supplierStatements;
    expect(v.quarter).toBe('2026-Q3');
    expect(v.rows[0]).toMatchObject({ payeeId: 'payee-big', paid12m: 90000 });
    expect((await svc.financeControls.home(de)).some((t) => /big supplier statement\(s\) to agree/.test(t.title))).toBe(true);
    await expect(
      svc.financeControls.supplierStatementAction(de, 'co-09', 'record', {
        payeeId: 'payee-big',
        statementBalance: 12000,
        ledgerBalance: 10000,
        doc: 'Big Q3.pdf',
      }),
    ).rejects.toThrow(/difference/);
    const c = (await svc.financeControls.supplierStatementAction(de, 'co-09', 'record', {
      payeeId: 'payee-big',
      statementBalance: 12000,
      ledgerBalance: 10000,
      doc: 'Big Q3.pdf',
      comment: 'Invoice INV-77 dated 30 Sep not yet received by us',
    })) as { id: string; diff: number };
    expect(c.diff).toBe(2000);
    await expect(svc.financeControls.supplierStatementAction(de, 'co-09', 'review', { checkId: c.id, comment: 'Looked at INV-77' })).rejects.toThrow();
    await svc.financeControls.supplierStatementAction(dep, 'co-09', 'review', { checkId: c.id, comment: 'Saw INV-77 in the supplier statement' });
    v = (await svc.financeControls.view(de, 'co-09')).supplierStatements;
    expect(v.rows.find((r) => r.payeeId === 'payee-big')!.check!.reviewed).toBeTruthy();
    // After the due day, the ones not done keep the close open.
    const row = (await store.get('finStatus', 'fin-co-09'))!;
    const ex = finCloseCheck(row, null, '2026-10', myt('2026-11-03', '10:00'))
      .exceptions.map((e) => e.text)
      .join('\n');
    expect(ex).toMatch(/Small Supplier \(mock\): 2026-Q3 supplier statement not checked/);
    expect(ex).not.toMatch(/Big Supplier/);
  });
});
