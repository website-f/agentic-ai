import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finAfterPayment, generateDataset, myt } from '../src';
type FinStatusT = import('../src').FinStatus;

// Fauzan, 1 Nov 2026: "test it with mock data and work like the staff need to do. see the workflow on point of view as
// the staff who want to steal". Each test is one way a Finance staff member could try to take money, played on mock
// data through the same service calls the screens use. Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, F: () => ds.finStatus.find((x) => x.companyId === T1)! };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));
const PAYEE = 'payee-pwvsb-001';
const NAME = 'SYARIKAT BEKALAN PEJABAT';
const bankOf = (f: FinStatusT) => f.banks[0].id;
let n = 0;
const ref = () => `PI-THEFT-${++n}`;

/** Prepared by de1, reviewed by the deputy, approved by the FD: ready to release. */
async function approvedPayment(svc: PrimaService, f: FinStatusT, amount = 4321.5, payeeId = PAYEE) {
  const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
  const p = await svc.finance.createPayment(de, T1, { payeeId, purpose: 'Office supplies October', amount, dueOn: '2026-11-05', bankId: bankOf(f), sqlRef: ref(), evidence: ['bill.pdf'] });
  await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'Bill agrees.' });
  return svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'Pay the bill.' });
}

describe('Staff trying to steal: approving or releasing their own payment', () => {
  it('a data entry clerk cannot review, approve or release what they prepared', async () => {
    const { svc, F } = fresh();
    const [de] = await who(svc, 'u-fin-t1-de1');
    const p = await svc.finance.createPayment(de, T1, { payeeId: PAYEE, purpose: 'Electricity', amount: 900, dueOn: '2026-11-05', bankId: bankOf(F()), sqlRef: ref(), evidence: ['bill.pdf'] });
    for (const a of ['review', 'approve', 'release'] as const) await expect(svc.finance.paymentStep(de, T1, p.id, a, { comment: 'ok' })).rejects.toThrow(/Not allowed/);
  });

  it('the Finance Director cannot prepare and approve the same payment, nor release one she approved', async () => {
    const { svc, F } = fresh();
    const [fd, dep, de2] = await who(svc, 'u-fd', 'u-fin-t1-dep', 'u-fin-t1-de2');
    const p = await svc.finance.createPayment(fd, T1, { payeeId: PAYEE, purpose: 'Electricity', amount: 901, dueOn: '2026-11-05', bankId: bankOf(F()), sqlRef: ref(), evidence: ['bill.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/prepared/);
    const q = await approvedPayment(svc, F());
    await expect(svc.finance.paymentStep(fd, T1, q.id, 'release', { bankRef: 'M2U-1', accountLast4: '1000', accountName: NAME })).rejects.toThrow(/approved/);
    expect((await svc.finance.paymentStep(de2, T1, q.id, 'release', { bankRef: 'M2U-1', accountLast4: '1000', accountName: NAME })).status).toBe('released');
  });

  it('a team 2 leader cannot touch team 1 money', async () => {
    const { svc } = fresh();
    const [t2] = await who(svc, 'u-fin-t2-lead');
    await expect(svc.finance.createPayment(t2, T1, { payeeId: PAYEE, purpose: 'x x x', amount: 1, dueOn: '2026-11-05', bankId: 'b', sqlRef: ref(), evidence: ['a.pdf'] })).rejects.toThrow();
  });
});

describe('Staff trying to steal: paying their own bank account', () => {
  it('changing a supplier to their own account after approval holds the release', async () => {
    const { svc, F } = fresh();
    const [de2, dep] = await who(svc, 'u-fin-t1-de2', 'u-fin-t1-dep');
    const p = await approvedPayment(svc, F());
    await svc.financeControls.payeeAction(de2, T1, 'change', { payeeId: PAYEE, bank: 'Maybank', accountLast4: '7777', accountName: NAME, source: 'Letter from supplier (forged)' });
    // The changer cannot verify it; even after someone else verifies, the old approval no longer covers it.
    await expect(svc.financeControls.payeeAction(de2, T1, 'verify', { payeeId: PAYEE, method: 'callback', contact: 'x', numberSource: 'contract on file', comment: 'ok' })).rejects.toThrow(/Not allowed/);
    await svc.financeControls.payeeAction(dep, T1, 'verify', { payeeId: PAYEE, method: 'callback', contact: 'Accounts clerk', numberSource: 'Number on the signed contract', comment: 'Confirmed.' });
    const [de3] = await who(svc, 'u-fin-t1-lead');
    await expect(svc.finance.paymentStep(de3, T1, p.id, 'release', { bankRef: 'M2U-2', accountLast4: '7777', accountName: NAME })).rejects.toThrow(/changed after approval/);
  });

  it('typing the verified account at release while paying another account in the portal is caught on the statement', async () => {
    const { svc, F } = fresh();
    const [de2] = await who(svc, 'u-fin-t1-de2');
    const p = await approvedPayment(svc, F(), 4321.5);
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-555', releasedOn: TODAY, accountLast4: '1000', accountName: NAME });
    // The statement shows the money went to someone else (same amount and reference).
    const csv = ['Date,Description,Ref,Amount', `${TODAY},IBG AHMAD BIN ALI,M2U-555,-4321.50`].join('\n');
    // October's statement, as loaded by the leader (who did not pay from this account).
    const pay = F().payments!.find((x) => x.id === p.id)!;
    F().statements = [{ id: 'stmt-x', bankId: bankOf(F()), period: '2026-10', opening: 10000, closing: 5678.5, lines: [{ id: 'l1', date: TODAY, description: 'IBG AHMAD BIN ALI', ref: 'M2U-555', amount: -4321.5, match: null }], loaded: { by: 'Lead', byId: 'u-fin-t1-lead', at: NOW, source: csv } }];
    pay.cleared = { statementId: 'stmt-x', lineId: 'l1', date: TODAY };
    const chk = finAfterPayment(F(), pay);
    // Same amount and reference, but another name: a person must compare before the month can close.
    expect(chk.checks.find((c) => c.key === 'bankPayee')?.ok).toBeNull();
    expect(chk.status).not.toBe('pass');
  });

  it('a clerk who adds a payee cannot also prepare the payment to it', async () => {
    const { svc, F } = fresh();
    const [de1] = await who(svc, 'u-fin-t1-de1');
    const fake = (await svc.financeControls.payeeAction(de1, T1, 'add', { kind: 'supplier', name: 'Bekalan Ali Enterprise', regNo: 'SA0099999-X', bank: 'Maybank', accountLast4: '4242', accountName: 'BEKALAN ALI ENTERPRISE', source: 'Registration form' })) as { id: string };
    F().payees!.find((x) => x.id === fake.id)!.status = 'verified';
    await expect(svc.finance.createPayment(de1, T1, { payeeId: fake.id, purpose: 'Stationery', amount: 2500, dueOn: '2026-11-05', bankId: bankOf(F()), sqlRef: ref(), evidence: ['inv.pdf'] })).rejects.toThrow(/entered or changed/);
  });
});

describe('Staff trying to steal: hiding a rejection or a payment', () => {
  it('a rejection recorded from Teams cannot be wiped by linking the payment again', async () => {
    const { svc, F } = fresh();
    const [de2] = await who(svc, 'u-fin-t1-de2');
    const p = await approvedPayment(svc, F());
    const link = (decisions: unknown[]) => svc.finance.paymentStep(de2, T1, p.id, 'link', { system: 'teams', url: 'https://teams.microsoft.com/l/approvals/123', requestRef: 'REQ-123', decisions });
    await link([{ approver: 'Head of Department', decision: 'rejected', comment: 'Not ours.', decidedOn: TODAY }]);
    await expect(link([])).rejects.toThrow(/rejection/);
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-9', accountLast4: '1000', accountName: NAME })).rejects.toThrow(/rejected/);
  });

  it('a released payment cannot be cancelled to hide it, nor released twice', async () => {
    const { svc, F } = fresh();
    const [de1, de2, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-lead');
    const p = await approvedPayment(svc, F());
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-10', accountLast4: '1000', accountName: NAME });
    await expect(svc.finance.paymentStep(de1, T1, p.id, 'cancel', { comment: 'Cancelled by mistake, sorry' })).rejects.toThrow(/Not allowed/);
    await expect(svc.finance.paymentStep(lead, T1, p.id, 'release', { bankRef: 'M2U-11', accountLast4: '1000', accountName: NAME })).rejects.toThrow(/Not allowed/);
  });

  it('paying the same bill twice is refused, with the same document or the same payee and amount', async () => {
    const { svc, F } = fresh();
    const [de1, de2] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2');
    const p = await svc.finance.createPayment(de1, T1, { payeeId: PAYEE, purpose: 'Electricity', amount: 1888, dueOn: '2026-11-05', bankId: bankOf(F()), sqlRef: 'PI-DUP-1', evidence: ['bill.pdf'] });
    await expect(svc.finance.createPayment(de2, T1, { payeeId: PAYEE, purpose: 'Electricity', amount: 1888, dueOn: '2026-11-06', bankId: bankOf(F()), sqlRef: 'PI-DUP-1A', evidence: ['bill.pdf'] })).rejects.toThrow(/duplicate/);
    await expect(svc.finance.createPayment(de2, T1, { payeeId: PAYEE, purpose: 'Electricity', amount: 10, dueOn: '2026-11-06', bankId: bankOf(F()), sqlRef: 'pi-dup-1', evidence: ['bill.pdf'] })).rejects.toThrow(/duplicate/);
    void p;
  });

  it('whoever released from an account cannot load its statement or explain away its bank lines', async () => {
    const { svc, F } = fresh();
    const [dep, lead] = await who(svc, 'u-fin-t1-dep', 'u-fin-t1-lead');
    const [de1, fd] = await who(svc, 'u-fin-t1-de1', 'u-fd');
    // The deputy releases a payment the deputy did not review (de1 prepares, the CEO reviews, the FD approves).
    const [ceo] = await who(svc, 'u-fauzan');
    const p = await svc.finance.createPayment(de1, T1, { payeeId: PAYEE, purpose: 'Electricity', amount: 777, dueOn: '2026-09-20', bankId: bankOf(F()), sqlRef: ref(), evidence: ['bill.pdf'] });
    await svc.finance.paymentStep(ceo, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    F().payments!.find((x) => x.id === p.id)!.steps.find((x) => x.step === 'approved')!.at = myt('2026-09-10', '09:00');
    await svc.finance.paymentStep(dep, T1, p.id, 'release', { bankRef: 'M2U-77', releasedOn: '2026-09-11', accountLast4: '1000', accountName: NAME });
    // The bank also shows RM500 to the deputy's own account with no Prima payment behind it.
    const csv = ['Date,Description,Ref,Amount', '2026-09-11,IBG SYARIKAT BEKALAN PEJABAT,M2U-77,-777.00', '2026-09-12,DUITNOW TRANSFER,DN-88,-500.00'].join('\n');
    await expect(svc.financeControls.statementAction(dep, T1, 'load', { bankId: bankOf(F()), period: '2026-09', opening: 1000, closing: -277, csv, source: 'sep.csv' })).rejects.toThrow(/release/);
    const r = (await svc.financeControls.statementAction(lead, T1, 'load', { bankId: bankOf(F()), period: '2026-09', opening: 1000, closing: -277, csv, source: 'sep.csv' })) as { statement: { id: string; lines: { id: string; match: unknown }[] } };
    const line = r.statement.lines[1];
    expect(line.match).toBeNull();
    await expect(svc.financeControls.statementAction(dep, T1, 'explain', { statementId: r.statement.id, lineId: line.id, comment: 'Transfer between our own accounts' })).rejects.toThrow(/released/);
  });
});

describe('Staff trying to steal: changing the rules or the records', () => {
  it('only the FD or the CEO changes Finance settings, and a team leader cannot switch approvals to Teams', async () => {
    const { svc } = fresh();
    const [lead, de1] = await who(svc, 'u-fin-t1-lead', 'u-fin-t1-de1');
    await expect(svc.finance.setSettings(lead, { values: { approvalExpiryDays: 90 }, comment: 'Longer approvals' })).rejects.toThrow();
    await expect(svc.finance.setSettings(de1, { values: { approvalMethod: 'teams' }, comment: 'Teams please' })).rejects.toThrow();
  });

  it('a clerk cannot write off a customer invoice, unblock a payee or replace a loaded statement', async () => {
    const { svc, F } = fresh();
    const [de1, de2, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fd');
    const c = (await svc.financeControls.arAction(de1, T1, 'open', { invoiceNo: 'IV-STEAL-1', invoiceDate: '2026-03-01', customer: 'Client (mock)', amount: 5000, reason: 'refused', detail: 'Client refuses to pay.' })) as { id: string };
    await svc.financeControls.arAction(de1, T1, 'writeoff', { caseId: c.id, evidence: ['letter1.pdf', 'letter2.pdf'], steps: 'Two demand letters sent.', sqlRef: 'CN-1' });
    await expect(svc.financeControls.arAction(de1, T1, 'approve', { caseId: c.id, comment: 'ok' })).rejects.toThrow(/Not allowed/);
    await expect(svc.financeControls.arAction(fd, T1, 'approve', { caseId: c.id, comment: 'Approved after review of letters.' })).resolves.toBeTruthy();
    const blocked = F().payees![0];
    blocked.status = 'blocked';
    await expect(svc.financeControls.payeeAction(de2, T1, 'unblock', { payeeId: blocked.id, comment: 'Unblock please now' })).rejects.toThrow(/Not allowed/);
    await expect(svc.finance.createPayment(de2, T1, { payeeId: blocked.id, purpose: 'Electricity', amount: 5, dueOn: '2026-11-05', bankId: bankOf(F()), sqlRef: ref(), evidence: ['a.pdf'] })).rejects.toThrow(/blocked/);
  });

  it('a release cannot be dated before its approval, nor after the approval lapsed', async () => {
    const { svc, ds, F } = fresh();
    const p = await approvedPayment(svc, F());
    const [de2] = await who(svc, 'u-fin-t1-de2');
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-20', releasedOn: '2026-10-01', accountLast4: '1000', accountName: NAME })).rejects.toThrow(/before the approval/);
    const later = new PrimaService(new MemoryStore(ds), () => myt('2026-12-15', '09:00'));
    const [de2L] = await who(later, 'u-fin-t1-de2');
    await expect(later.finance.paymentStep(de2L, T1, p.id, 'release', { bankRef: 'M2U-21', releasedOn: '2026-11-01', accountLast4: '1000', accountName: NAME })).rejects.toThrow(/lapsed|gone back/);
  });
});

describe("Fauzan's answers to the insider test (1 Nov 2026: 'we try to automate any we can')", () => {
  it('1. the reviewer may release, and the FD and the CEO are shown it to watch', async () => {
    const { svc, F } = fresh();
    const [de1, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const p = await svc.finance.createPayment(de1, T1, { payeeId: PAYEE, purpose: 'Office supplies', amount: 345, dueOn: '2026-11-05', bankId: bankOf(F()), sqlRef: ref(), evidence: ['inv.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'Invoice agrees.' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'Pay.' });
    expect((await svc.finance.paymentStep(dep, T1, p.id, 'release', { bankRef: 'M2U-RR1', accountLast4: '1000', accountName: NAME })).status).toBe('released');
    const row = (await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.payments.find((x) => x.id === p.id)!;
    expect(row.watch).toEqual(['Reviewed and released by the same person']);
    const titles = (await svc.finance.home(fd)).map((t) => t.title);
    expect(titles.some((t) => /reviewed and released by the same person/.test(t))).toBe(true);
    // A data entry clerk is not shown the watch list.
    expect((await svc.finance.home(de1)).some((t) => /same person/.test(t.title))).toBe(false);
  });

  it('2. a customer receipt counts only when Prima finds the money on the bank statement', async () => {
    const { svc, F } = fresh();
    const [de1, de2, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-lead');
    const ar = svc.financeControls;
    const bankId = bankOf(F());
    const c = (await ar.arAction(de1, T1, 'open', { invoiceNo: 'IV-RC-1', invoiceDate: '2026-05-01', customer: 'Client (mock)', amount: 3000, reason: 'refused', detail: 'Client delayed payment.' })) as { id: string };
    // A clerk types a receipt for money that never arrived: the invoice stays unpaid.
    const typed = (await ar.arAction(de1, T1, 'payment', { caseId: c.id, amount: 3000, ref: 'OR-9001', on: '2026-09-15', bankId })) as { outstanding: number; status: string; receipts: { matched: unknown }[] };
    expect([typed.outstanding, typed.status, typed.receipts[0].matched]).toEqual([3000, 'open', null]);
    // A second receipt for more than is unpaid (counting the one waiting) is refused.
    await expect(ar.arAction(de1, T1, 'payment', { caseId: c.id, amount: 1, ref: 'OR-9002', on: '2026-09-15', bankId })).rejects.toThrow(/more than/);
    // The statement shows only RM1,000 coming in: nothing is matched, the case stays open.
    const csv1 = ['Date,Description,Ref,Amount', '2026-09-15,IBG CLIENT MOCK,OR-9001,1000.00'].join('\n');
    await ar.statementAction(lead, T1, 'load', { bankId, period: '2026-09', opening: 0, closing: 1000, csv: csv1, source: 'sep-a.csv' });
    expect(F().arCases!.find((x) => x.id === c.id)!.status).toBe('open');
    // The real statement shows the RM3,000: Prima matches it by itself and the invoice is recovered.
    const csv2 = ['Date,Description,Ref,Amount', '2026-09-16,IBG CLIENT MOCK,OR-9001,3000.00'].join('\n');
    await ar.statementAction(lead, T1, 'load', { bankId, period: '2026-09', opening: 0, closing: 3000, csv: csv2, source: 'sep-b.csv' });
    const done = F().arCases!.find((x) => x.id === c.id)!;
    expect([done.outstanding, done.status, done.receipts![0].matched?.date]).toEqual([0, 'recovered', '2026-09-16']);
    expect(done.log.at(-1)!.byId).toBe('prima:auto');
    // The leader unmatches the line (it was another customer): the invoice is unpaid again.
    const st = F().statements!.find((x) => x.bankId === bankId && x.period === '2026-09')!;
    await ar.statementAction(lead, T1, 'unmatch', { statementId: st.id, lineId: st.lines[0].id, comment: 'This money was from another customer.' });
    expect([F().arCases!.find((x) => x.id === c.id)!.outstanding, F().arCases!.find((x) => x.id === c.id)!.status]).toEqual([3000, 'open']);
    void de2;
  });

  it('6. a payment that fails the automatic bank statement check is flagged on home at once', async () => {
    const { svc, F } = fresh();
    const [de1, dep, fd, de2, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd', 'u-fin-t1-de2', 'u-fin-t1-lead');
    const bankId = bankOf(F());
    const p = await svc.finance.createPayment(de1, T1, { payeeId: PAYEE, purpose: 'Office supplies', amount: 610, dueOn: '2026-09-20', bankId, sqlRef: ref(), evidence: ['inv.pdf'], eInvoiceRef: 'UUID-MOCK-0001' });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    F().payments!.find((x) => x.id === p.id)!.steps.find((x) => x.step === 'approved')!.at = myt('2026-09-10', '09:00');
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-610', releasedOn: '2026-09-11', accountLast4: '1000', accountName: NAME });
    // The bank took RM610 on that day with another reference and another name.
    const csv = ['Date,Description,Ref,Amount', '2026-09-11,DUITNOW AHMAD,DN-1,-610.00'].join('\n');
    await svc.financeControls.statementAction(lead, T1, 'load', { bankId, period: '2026-09', opening: 1000, closing: 390, csv, source: 'sep.csv' });
    const titles = (await svc.financeControls.home(fd)).map((t) => `${t.title} | ${t.detail}`);
    expect(titles.some((t) => new RegExp(`failed the automatic check against the bank statement \\|.*${p.id}`).test(t))).toBe(true);
  });
});
