import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, generateDataset, myt, parseStatementCsv, sstPenalty, sstPeriodOf } from '../src';
type FinStatusT = import('../src').FinStatus;

// Finance Phase 2, part 2 (Fauzan, 31 Oct 2026): Teams and SharePoint approvals linked with every approver's comment,
// paid to the right person, bank statements matched to payments, monthly ageing, SST and the budget and forecast.
// Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, F: () => ds.finStatus.find((x) => x.companyId === T1)!, CO: () => ds.finStatus.find((x) => x.team === 1 && x.companyId !== T1)! };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));
// Test data: treat a payment approved today as approved on an earlier day, so a September release date is possible
// (a release can never be dated before its approval).
const approvedOn = (f: FinStatusT, id: string, day: string) => {
  const st = f.payments!.find((x) => x.id === id)!.steps.find((x) => x.step === 'approved')!;
  st.at = myt(day, '09:00');
};

describe('Teams and SharePoint approvals linked to payments', () => {
  it('accepts only SharePoint or Teams links, needs every approver’s comment, and a Teams rejection stops approval', async () => {
    const { svc, F } = fresh();
    const [de, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-003', purpose: 'Lease top-up', amount: 900, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: 'PI-T-1', evidence: ['inv.pdf'] });
    const link = (over: Record<string, unknown>) => ({
      system: 'teams',
      url: 'https://teams.microsoft.com/l/approvals/abc',
      requestRef: 'REQ-77',
      decisions: [{ approver: 'Finance Team Leader 1', decision: 'approved', comment: 'OK per contract', decidedOn: TODAY }],
      ...over,
    });
    await expect(svc.finance.paymentStep(de, T1, p.id, 'link', link({ url: 'https://evil.example.com/approve' }))).rejects.toThrow(/SharePoint/);
    await expect(svc.finance.paymentStep(de, T1, p.id, 'link', link({ url: 'http://pwvsb.sharepoint.com/x' }))).rejects.toThrow(/https/);
    await expect(
      svc.finance.paymentStep(de, T1, p.id, 'link', link({ decisions: [{ approver: 'A', decision: 'approved', comment: ' ', decidedOn: TODAY }] })),
    ).rejects.toThrow(/no comment/);
    const linked = await svc.finance.paymentStep(de, T1, p.id, 'link', link({ system: 'sharepoint', url: 'https://pwvsb.sharepoint.com/sites/finance/Lists/Requests/77', decisions: [{ approver: 'COO (mock)', decision: 'rejected', comment: 'Wrong cost centre', decidedOn: TODAY }] }));
    expect(linked.external).toMatchObject({ system: 'sharepoint', requestRef: 'REQ-77' });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await expect(svc.finance.paymentStep(lead, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/rejected this request in SharePoint: Wrong cost centre/);
    // Insider test (1 Nov 2026): linking again with no decisions no longer wipes the rejection.
    await expect(svc.finance.paymentStep(de, T1, p.id, 'link', link({}))).rejects.toThrow(/rejection .* stays/);
    await expect(svc.finance.paymentStep(lead, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/rejected/);
  });
});

describe('paid to the right person', () => {
  it('a new payee is verified by someone else by call-back, never on the number in the request', async () => {
    const { svc } = fresh();
    const [de, dep] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep');
    const add = (over: Record<string, unknown> = {}) =>
      svc.financeControls.payeeAction(de, T1, 'add', { name: 'UAT Cleaner (mock)', kind: 'supplier', regNo: '202001099999', bank: 'RHB Bank', accountLast4: '4321', accountName: 'UAT CLEANER', ...over });
    await expect(add({ accountLast4: '1234567890' })).rejects.toThrow(/last 4 digits/);
    await expect(add({ regNo: '201901000001 (mock)' })).rejects.toThrow(/already on the list/);
    const p = (await add()) as { id: string; status: string };
    expect(p.status).toBe('pending');
    const v = { payeeId: p.id, method: 'callback', contact: 'Puan Aminah, accounts', numberSource: 'Number on the signed contract', comment: 'Confirmed account 4321' };
    await expect(svc.financeControls.payeeAction(de, T1, 'verify', v)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.financeControls.payeeAction(dep, T1, 'verify', { ...v, numberSource: 'number in the email request' })).rejects.toThrow(/never the number in the request/);
    await expect(svc.financeControls.payeeAction(dep, T1, 'verify', { ...v, comment: '' })).rejects.toThrow(/comment/);
    expect(((await svc.financeControls.payeeAction(dep, T1, 'verify', v)) as { status: string }).status).toBe('verified');
  });

  it('a bank detail change holds the payment: no approval, no release, until verified again and re-approved', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    // Seed: payment 2 to Uniform Maju waits for approval, but Uniform Maju's account just changed.
    const held = F().payments!.find((p) => p.payee.startsWith('Uniform Maju'))!;
    await expect(svc.finance.paymentStep(lead, T1, held.id, 'approve', { comment: 'ok' })).rejects.toThrow(/not verified/);
    // An approved payment whose payee changes after approval cannot be released.
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-003', purpose: 'Lease', amount: 700, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: 'PI-H-1', evidence: ['i.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(lead, T1, p.id, 'approve', { comment: 'ok' });
    const changed = (await svc.financeControls.payeeAction(de, T1, 'change', { payeeId: 'payee-pwvsb-003', bank: 'Ambank', accountLast4: '8888', accountName: 'KENDERAAN RONDA', source: 'Email from supplier asking to change account' })) as { held: number };
    expect(changed.held).toBe(2); // this one and the seeded quarter-4 lease payment
    const rel = { bankRef: 'M2U-H-1', accountLast4: '8888', accountName: 'KENDERAAN RONDA' };
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', rel)).rejects.toThrow(/verified again/);
    await svc.financeControls.payeeAction(dep, T1, 'verify', { payeeId: 'payee-pwvsb-003', method: 'callback', contact: 'Encik Rahman', numberSource: 'Number on 2025 supply contract', comment: 'Real change, confirmed' });
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', rel)).rejects.toThrow(/changed after approval/);
  });
});

describe('bank statements matched to payments', () => {
  it('parses CSV in both layouts and refuses a statement that does not add up', async () => {
    expect(parseStatementCsv('Date,Description,Ref,Amount\n2026-09-03,TRF,ABC,-10.50\n05/09/2026,"Deposit, cash",X,100')).toEqual([
      { date: '2026-09-03', description: 'TRF', ref: 'ABC', amount: -10.5 },
      { date: '2026-09-05', description: 'Deposit, cash', ref: 'X', amount: 100 },
    ]);
    expect(parseStatementCsv('2026-09-03,TRF,ABC,10.50,')[0].amount).toBe(-10.5);
    const { svc, F } = fresh();
    const de = await svc.user('u-fin-t1-de1');
    await expect(
      svc.financeControls.statementAction(de, T1, 'load', { bankId: F().banks[0].id, period: '2026-09', opening: 100, closing: 50, csv: '2026-09-03,TRF,ABC,-10', source: 'm2u.csv' }),
    ).rejects.toThrow(/does not add up/);
    await expect(
      svc.financeControls.statementAction(de, T1, 'load', { bankId: F().banks[0].id, period: '2026-09', opening: 100, closing: 90, csv: '2026-10-03,TRF,ABC,-10', source: 'm2u.csv' }),
    ).rejects.toThrow(/not in 2026-09/);
  });

  it('matches released payments by amount and bank reference; money out with no payment is an exception for the close', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    // A September payment, released in September (dates set as if it happened then).
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Sept supplies', amount: 1234.56, dueOn: '2026-09-20', bankId: F().banks[0].id, sqlRef: 'PI-S-1', evidence: ['i.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(lead, T1, p.id, 'approve', { comment: 'ok' });
    approvedOn(F(), p.id, '2026-09-18');
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U778899', releasedOn: '2026-09-18', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    const csv = ['Date,Description,Ref,Amount', '2026-09-18,IBG SYARIKAT BEKALAN,M2U778899,-1234.56', '2026-09-25,UNKNOWN TRANSFER,X1,-5000', '2026-09-30,BANK CHARGES,,-12'].join('\n');
    const r = (await svc.financeControls.statementAction(de, T1, 'load', { bankId: F().banks[0].id, period: '2026-09', opening: 10000, closing: 3753.44, csv, source: 'm2u-sep.csv' })) as { matched: number; out: number };
    expect([r.matched, r.out]).toEqual([1, 3]);
    expect(F().payments!.find((x) => x.id === p.id)!.cleared).toMatchObject({ date: '2026-09-18' });
    const view = await svc.financeControls.view(de, T1);
    const lines = view.statements[0].lines;
    expect(lines.find((l) => l.amount === -1234.56)).toMatchObject({ payee: 'Syarikat Bekalan Pejabat (mock)', nameSeen: true });
    const close = (await svc.finance.desk(de)).companies.find((c) => c.companyId === T1)!.close.check;
    expect(close.exceptions.map((e) => e.text).join(' ')).toMatch(/RM5000.00 left the bank on 2026-09-25 with no approved Prima payment/);
    // Bank charges are explained by a reviewer, never by data entry.
    const st = F().statements![0];
    const charge = st.lines.find((l) => l.amount === -12)!;
    await expect(svc.financeControls.statementAction(de, T1, 'explain', { statementId: st.id, lineId: charge.id, comment: 'Monthly bank charges' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.statementAction(dep, T1, 'explain', { statementId: st.id, lineId: charge.id, comment: 'Monthly bank charges' });
    const after = (await svc.finance.desk(de)).companies.find((c) => c.companyId === T1)!.close.check;
    expect(after.exceptions.some((e) => e.text.includes('RM12.00'))).toBe(false);
  });
});

describe('monthly ageing', () => {
  it('is recorded from SQL Account, reviewed by someone else, and blocks the close until done; a ledger difference must be explained', async () => {
    const { svc } = fresh();
    const [de, dep] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep');
    const before = (await svc.finance.desk(de)).companies.find((c) => c.companyId === T1)!.close.check;
    expect(before.blockers.join(' ')).toMatch(/Record the customer and supplier ageing for 2026-09/);
    const age = { period: '2026-09', ar: { current: 100, d1to30: 50, over90: 25 }, ap: { current: 40 }, glAr: 170, glAp: 40, source: 'SQL Aging Sep.pdf' };
    await expect(svc.financeControls.ageingAction(de, T1, 'record', { ...age, period: '2026-11' })).rejects.toThrow(/ended/);
    await svc.financeControls.ageingAction(de, T1, 'record', age);
    await expect(svc.financeControls.ageingAction(de, T1, 'review', { period: '2026-09', comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.ageingAction(dep, T1, 'review', { period: '2026-09', comment: 'Agrees except RM5 unapplied' });
    const check = (await svc.finance.desk(de)).companies.find((c) => c.companyId === T1)!.close.check;
    expect(check.blockers.join(' ')).not.toMatch(/ageing/);
    expect(check.exceptions.find((e) => e.key === 'age:ar')!.text).toMatch(/differs from the ledger by RM5.00/);
  });
});

describe('e-Invoice (LHDN MyInvois from SQL Account)', () => {
  it('needs every sales document validated, the consolidated e-Invoice in by the 7th, and a review by someone else before the close', async () => {
    const { svc, CO, F } = fresh();
    const co = CO().companyId;
    F().einvoice = undefined; // a company not set up for e-Invoice
    const [de, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead');
    const check = async () => (await svc.finance.desk(de)).companies.find((c) => c.companyId === co)!.close.check;
    // Seeded as required through the group's related-company rule; a company not set up has no e-Invoice blocker.
    expect((await check()).blockers.join(' ')).toMatch(/Record the 2026-09 e-Invoice check/);
    expect((await svc.finance.desk(de)).companies.find((c) => c.companyId === T1)!.close.check.blockers.join(' ')).not.toMatch(/e-Invoice/);
    await expect(svc.financeControls.einvoiceAction(de, co, 'setup', { required: true, basis: 'Tax agent advice 2026', startOn: '2024-08-01', revenue: 4_000_000 })).rejects.toBeInstanceOf(AccessDenied);
    // Each company is its own entity (Fauzan, 1 Nov 2026): RM3 million of its own turnover makes e-Invoice compulsory.
    // Switching the check off is the FD's or the CEO's decision (standards review, 1 Nov 2026).
    await expect(svc.financeControls.einvoiceAction(lead, T1, 'setup', { required: false, basis: 'Own turnover below RM3 million', revenue: 2_400_000 })).rejects.toThrow(/Finance Director or the CEO/);
    const [fdU] = await who(svc, 'u-fd');
    await expect(svc.financeControls.einvoiceAction(fdU, co, 'setup', { required: false, basis: 'Small company in the group', revenue: 3_000_000 })).rejects.toThrow(/must issue e-Invoices/);
    expect(((await svc.financeControls.einvoiceAction(fdU, T1, 'setup', { required: false, basis: 'Own turnover below RM3 million', revenue: 2_400_000 })) as { setup: { required: boolean } }).setup.required).toBe(false);
    F().einvoice = undefined;
    await expect(svc.financeControls.einvoiceAction(de, T1, 'record', { period: '2026-09', source: 'x.xlsx' })).rejects.toThrow(/Set the company up/);
    const rec = { period: '2026-09', issued: 40, valid: 37, invalid: 2, submitting: 1, notSubmitted: 0, consolidatedNeeded: true, selfBilledNeeded: 2, selfBilledValid: 1, source: 'MyInvois Transaction Sep.xlsx' };
    await expect(svc.financeControls.einvoiceAction(de, co, 'record', { ...rec, valid: 30 })).rejects.toThrow(/must equal the documents issued/);
    await expect(svc.financeControls.einvoiceAction(de, co, 'record', { ...rec, period: '2026-10' })).rejects.toThrow(/ended/);
    await svc.financeControls.einvoiceAction(de, co, 'record', rec);
    let c = await check();
    expect(c.blockers.join(' ')).toMatch(/3 sales document\(s\) for 2026-09 are not validated by LHDN/);
    expect(c.blockers.join(' ')).toMatch(/Submit the 2026-09 consolidated e-Invoice/);
    expect(c.blockers.join(' ')).toMatch(/waiting for review/);
    // Fixed in SQL Account and counted again; consolidated late and one big sale inside it.
    await svc.financeControls.einvoiceAction(de, co, 'record', {
      ...rec, valid: 40, invalid: 0, submitting: 0, consolidatedUuid: 'F9D425P6DS7D8IUQWERTY12345', consolidatedOn: '2026-10-09', largeInConsolidated: 1,
    });
    await expect(svc.financeControls.einvoiceAction(de, co, 'review', { period: '2026-09', comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.financeControls.einvoiceAction(dep, co, 'review', { period: '2026-09', rev: 2 })).rejects.toThrow(/comment/);
    await svc.financeControls.einvoiceAction(dep, co, 'review', { period: '2026-09', rev: 2, comment: 'Agrees to MyInvois portal.' });
    c = await check();
    expect(c.blockers.join(' ')).not.toMatch(/e-Invoice|LHDN/);
    const keys = c.exceptions.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(['einv:late', 'einv:large', 'einv:self']));
    // A supplier payment carries the supplier's e-Invoice UUID; one without it is listed.
    const f = svc.financeControls;
    const banks = (await svc.finance.desk(de)).companies.find((x) => x.companyId === co)!.banks;
    const payee = (await f.view(de, co)).payees.find((x) => x.kind === 'supplier' && x.status === 'verified')!;
    const p = await svc.finance.createPayment(de, co, { payeeId: payee.id, purpose: 'Stationery', amount: 120, dueOn: '2026-11-20', bankId: banks[0].id, sqlRef: 'PI-EI-1', evidence: ['inv.pdf'], eInvoiceRef: 'ABCDEFGHIJ0123456789XYZABC' });
    expect(p.eInvoiceRef).toBe('ABCDEFGHIJ0123456789XYZABC');
    const v = (await f.view(lead, co)).einvoice;
    expect(v.setup?.required).toBe(true);
    expect(v.record?.reviewed?.byId).toBe('u-fin-t1-dep');
    expect(v.paymentsWithout.some((x) => x.id === p.id)).toBe(false);
    expect(v.paymentsWithout.length).toBeGreaterThan(0);
  });
});

describe('invoice problems and bad debt', () => {
  it('re-issues a wrong-payer invoice by credit note and new invoice, never back in the audited year, approved by someone else', async () => {
    const { svc, CO } = fresh();
    const co = CO().companyId;
    const [de, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead');
    const ar = svc.financeControls;
    const f = svc.financeControls;
    const open = await ar.arAction(de, co, 'open', { invoiceNo: 'IV-T-100', invoiceDate: '2026-07-31', customer: 'Old Agent (mock)', amount: 10_000, reason: 'site_changed', detail: 'Site taken over by a new owner in July.' }) as { id: string };
    await expect(ar.arAction(de, co, 'open', { invoiceNo: 'IV-T-100', invoiceDate: '2026-07-31', customer: 'X', amount: 1, reason: 'other', detail: 'duplicate case here' })).rejects.toThrow(/already has an open case/);
    const base = { caseId: open.id, creditNoteNo: 'CN-T-1', newInvoiceNo: 'IV-T-101', newCustomer: 'New Owner (mock)', newAmount: 10_000, note: 'Billed to the new owner per their PO.' };
    // The year to 31 Dec 2025 is audited: a credit note cannot be dated back into it.
    await expect(ar.arAction(de, co, 'reissue', { ...base, creditNoteDate: '2025-12-31' })).rejects.toThrow(/audited and signed/);
    await expect(ar.arAction(de, co, 'reissue', { ...base, method: 'cancel72h' })).rejects.toThrow(/validated e-Invoice/);
    await ar.arAction(de, co, 'reissue', { ...base, creditNoteDate: TODAY });
    await expect(ar.arAction(de, co, 'approve', { caseId: open.id, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    // Only the FD or the CEO approves (Fauzan, 1 Nov 2026); the deputy and the team leader are refused.
    await expect(ar.arAction(dep, co, 'approve', { caseId: open.id, comment: 'ok' })).rejects.toThrow(/Finance Director or the CEO/);
    const fd0 = await svc.user('u-fd');
    await expect(ar.arAction(fd0, co, 'approve', { caseId: open.id })).rejects.toThrow(/comment/);
    const done = (await ar.arAction(fd0, co, 'approve', { caseId: open.id, comment: 'PO from the new owner checked.' })) as { status: string; outstanding: number };
    expect(done).toMatchObject({ status: 'reissued', outstanding: 0 });
    // The seeded audited-year insolvent invoice: write-off needs evidence and the FD or CEO, never the requester.
    const v = (await ar.view(lead, co)).ar;
    const old = v.cases.find((c) => c.reason === 'insolvent')!;
    expect(old.priorYear).toBe(true);
    await expect(ar.arAction(lead, co, 'writeoff', { caseId: old.id, evidence: ['demand letter.pdf'], steps: 'Demand letter and proof of debt.', sqlRef: 'JV-BD-1' })).rejects.toThrow(/at least 2/);
    await ar.arAction(lead, co, 'writeoff', { caseId: old.id, evidence: ['demand letter.pdf', 'liquidator notice.pdf'], steps: 'Demand letter, proof of debt filed.', sqlRef: 'JV-BD-1', sstPaid: 1_640 });
    await expect(ar.arAction(dep, co, 'approve', { caseId: old.id, comment: 'ok' })).rejects.toThrow(/Finance Director or the CEO/);
    const fd = await svc.user('u-fd');
    await expect(ar.arAction(fd, co, 'sstRelief', { caseId: old.id, ref: 'CUS-1' })).rejects.toThrow(/after the write-off/);
    const w = (await ar.arAction(fd, co, 'approve', { caseId: old.id, comment: 'Liquidation confirmed; write off.' })) as { status: string };
    expect(w.status).toBe('written_off');
    // SST bad debt relief (Fauzan, 1 Nov 2026): a full document pack goes to Customs, submitted by someone else; Customs decides.
    await expect(ar.arAction(lead, co, 'sstRelief', { caseId: old.id, documents: ['invoice.pdf'] })).rejects.toThrow(/full documents/);
    await ar.arAction(lead, co, 'sstRelief', { caseId: old.id, documents: ['invoice and credit note.pdf', 'SST-02 and Customs receipt.pdf', 'write-off approval and liquidator notice.pdf'] });
    const claim = (await ar.view(fd, co)).sst!.claims[0];
    expect(claim).toMatchObject({ kind: 'bad_debt_relief', amount: 1_640, caseId: old.id });
    await expect(f.sstAction(lead, co, 'claimSubmit', { claimId: claim.id, ref: 'CUS-1', comment: 'sent' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(f.sstAction(fd, co, 'claimResult', { claimId: claim.id, outcome: 'approved', amount: 1, comment: 'x' })).rejects.toThrow(/Submit the claim first/);
    await f.sstAction(fd, co, 'claimSubmit', { claimId: claim.id, ref: 'CUS-BDR-2026-01', comment: 'Pack checked and lodged.' });
    await expect(f.sstAction(fd, co, 'claimResult', { claimId: claim.id, outcome: 'approved', amount: 5_000, comment: 'x' })).rejects.toThrow(/more than was claimed/);
    const r = (await f.sstAction(lead, co, 'claimResult', { claimId: claim.id, outcome: 'rejected', comment: 'Customs refused: no proof of recovery steps.' })) as { result: { outcome: string } };
    expect(r.result.outcome).toBe('rejected');
    // A young invoice is not written off unless the customer is insolvent.
    const young = (await ar.arAction(de, co, 'open', { invoiceNo: 'IV-T-200', invoiceDate: '2026-09-30', customer: 'Y (mock)', amount: 500, reason: 'refused', detail: 'Refuses to pay, says service poor.' })) as { id: string };
    await expect(ar.arAction(lead, co, 'writeoff', { caseId: young.id, evidence: ['a.pdf', 'b.pdf'], steps: 'Two reminders sent.', sqlRef: 'JV-2' })).rejects.toThrow(/180 days/);
  });

  it('tells the Finance Director every month about invoices over 90 days and records the FD sign-off', async () => {
    const { svc, CO } = fresh();
    const co = CO().companyId;
    const [de, lead, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-lead', 'u-fd');
    const home = (await svc.financeControls.home(fd)).map((i) => i.title).join(' | ');
    expect(home).toMatch(/invoice\(s\) over 90 days with no follow-up this month/);
    expect(home).toMatch(/Review overdue invoices for \d+ company/);
    const v = (await svc.financeControls.view(fd, co)).ar;
    expect(v.over90.cases).toBe(3); // wrong payer 100 days, government 210 days, insolvent
    expect(v.cases.find((c) => c.reason === 'govt_late')!.stale).toBe(false);
    await expect(svc.financeControls.arAction(lead, co, 'fdReview', { comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.financeControls.arAction(fd, co, 'fdReview', { comment: 'ok' })).rejects.toThrow(/no follow-up this month/);
    await svc.financeControls.arAction(fd, co, 'fdReview', { comment: 'Told Team 1 to chase the managing agent this week.' });
    expect((await svc.financeControls.view(de, co)).ar.fdReview?.sign.byId).toBe('u-fd');
  });

  it('flags over-90-day invoices with no case and cases with no follow-up in the close', async () => {
    const { svc, CO } = fresh();
    const co = CO().companyId;
    const [de, dep] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep');
    const check = async () => (await svc.finance.desk(de)).companies.find((c) => c.companyId === co)!.close.check;
    // The seeded wrong-payer case is past its follow-up date.
    expect((await check()).exceptions.some((e) => e.key.startsWith('ar:stale:'))).toBe(true);
    await svc.financeControls.ageingAction(de, co, 'record', { period: '2026-09', ar: { over90: 250_000 }, ap: {}, glAr: 250_000, glAp: 0, source: 'aging.pdf' });
    await svc.financeControls.ageingAction(dep, co, 'review', { period: '2026-09', comment: 'ok' });
    const gap = (await check()).exceptions.find((e) => e.key === 'ar:uncovered')!;
    expect(gap.text).toMatch(/RM42460.00 of customer invoices over 90 days has no invoice case/);
    const v = (await svc.financeControls.view(de, co)).ar;
    expect(v.uncovered).toBe(42_460);
  });
});

describe('service tax (SST)', () => {
  it('works out the two-month taxable period, the due date and the late payment penalty', () => {
    expect(sstPeriodOf('2026-10', 1)).toEqual({ from: '2026-09', to: '2026-10', dueOn: '2026-11-30' });
    expect(sstPeriodOf('2026-09', 1)).toEqual({ from: '2026-09', to: '2026-10', dueOn: '2026-11-30' });
    expect(sstPeriodOf('2026-12', 2)).toEqual({ from: '2026-12', to: '2027-01', dueOn: '2027-02-28' });
    expect(sstPenalty(10_000, '2026-09-30', '2026-09-30')).toBe(0);
    expect(sstPenalty(10_000, '2026-09-30', '2026-10-15')).toBe(1_000);
    expect(sstPenalty(10_000, '2026-09-30', '2026-11-20')).toBe(2_500);
    expect(sstPenalty(10_000, '2026-09-30', '2027-03-01')).toBe(4_000);
  });

  it('checks 8%, separates prepare, review and file, and pays Customs exactly the declared tax through an approved payment', async () => {
    const { svc, CO, ds } = fresh();
    const co = CO().companyId;
    const [de, dep, lead, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd');
    await expect(svc.financeControls.sstAction(de, co, 'setup', { registered: true, sstNo: 'W10-1', cycleStartMonth: 1 })).rejects.toBeInstanceOf(AccessDenied);
    // Fauzan, 1 Nov 2026: SST is 8/108 of the money received (RM1,080,000 received = RM80,000 tax on RM1,000,000).
    const base = { month: '2026-08', received: 1_080_000, invoiceSst: 80_000, source: 'SQL SST listing Jul-Aug.pdf' };
    await expect(svc.financeControls.sstAction(de, co, 'prepare', { ...base, month: '2026-10' })).rejects.toThrow(/not ended/);
    await expect(svc.financeControls.sstAction(de, co, 'prepare', { ...base, declared: 60_000 })).rejects.toThrow(/not 8\/108 of the RM1080000.00 received/);
    const ret = (await svc.financeControls.sstAction(de, co, 'prepare', { ...base, declared: 79_200, differenceNote: 'Credit note CN-12 RM10,000 for July' })) as { id: string; dueOn: string };
    expect(ret.dueOn).toBe('2026-09-30');
    await expect(svc.financeControls.sstAction(de, co, 'review', { returnId: ret.id, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.sstAction(dep, co, 'review', { returnId: ret.id, comment: 'Agrees to SST listing' });
    await expect(svc.financeControls.sstAction(lead, co, 'file', { returnId: ret.id, comment: 'filed', ackRef: '' })).rejects.toThrow(/acknowledgement/);
    await svc.financeControls.sstAction(lead, co, 'file', { returnId: ret.id, comment: 'Filed in MySST', ackRef: 'MYSST-ACK-001', filedOn: '2026-09-29' });
    // Paying Customs: a normal payment to the verified Customs payee for exactly the declared amount.
    const kastam = ds.finStatus.find((f) => f.companyId === co)!.payees!.find((p) => p.name.startsWith('Jabatan Kastam'))!;
    const bankId = CO().banks[0].id;
    const wrong = await svc.finance.createPayment(de, co, { payeeId: kastam.id, purpose: 'SST Jul-Aug', amount: 79_000, dueOn: '2026-09-30', bankId, sqlRef: 'PV-SST-1', evidence: ['SST-02.pdf'] });
    await expect(svc.financeControls.sstAction(de, co, 'linkPayment', { returnId: ret.id, paymentId: wrong.id })).rejects.toThrow(/exactly the declared tax/);
    const office = await svc.finance.createPayment(de, co, { payeeId: CO().payees![0].id, purpose: 'Not tax', amount: 79_200, dueOn: '2026-09-30', bankId, sqlRef: 'PV-NT-1', evidence: ['x.pdf'] });
    await expect(svc.financeControls.sstAction(de, co, 'linkPayment', { returnId: ret.id, paymentId: office.id })).rejects.toThrow(/tax payee/);
    await svc.finance.paymentStep(de, co, wrong.id, 'cancel', { comment: 'Wrong amount keyed' });
    const pay = await svc.finance.createPayment(de, co, { payeeId: kastam.id, purpose: 'SST Jul-Aug', amount: 79_200, dueOn: '2026-09-30', bankId, sqlRef: 'PV-SST-2', evidence: ['SST-02.pdf'] });
    await svc.financeControls.sstAction(de, co, 'linkPayment', { returnId: ret.id, paymentId: pay.id });
    let view = (await svc.financeControls.view(fd, co)).sst!;
    const row = view.returns.find((r) => r.from === '2026-07')!;
    expect(row.problems).toContain('Payment prepared');
    expect(row.tone).toBe('crit'); // due 30 Sept, today 31 Oct, still unpaid
    expect(row.penalty).toBe(19_800); // 31 days late: 10% + 15% of RM79,200
    await svc.finance.paymentStep(dep, co, pay.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, co, pay.id, 'approve', { comment: 'Pay now' });
    // The leader entered the payees in the mock data, so someone else in the team records the release.
    await svc.finance.paymentStep(await svc.user('u-fin-t1-de2'), co, pay.id, 'release', { bankRef: 'FPX-RMCD-1', accountLast4: kastam.accountLast4, accountName: kastam.accountName });
    view = (await svc.financeControls.view(fd, co)).sst!;
    expect(view.returns.find((r) => r.from === '2026-07')!.problems).toEqual(['Paid late']);
  });
});

describe('budget and forecast', () => {
  const months = (n: number) => Array(12).fill(n);
  it('the Finance Director or the CEO approves a budget prepared by someone else; months off the budget need an explanation', async () => {
    const { svc } = fresh();
    const [de, dep, fd, ceo, chair] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd', 'u-fauzan', 'u-chair');
    const draft = { year: 2026, months: { revenue: months(100_000), guard_cost: months(70_000) }, assumptions: '120 guards at RM2,900; no new contracts' };
    await expect(svc.financeControls.planAction(de, T1, 'draft', draft)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.financeControls.planAction(dep, T1, 'draft', { ...draft, months: { revenue: [1, 2] } })).rejects.toThrow(/12 monthly amounts/);
    await svc.financeControls.planAction(dep, T1, 'draft', draft);
    await svc.financeControls.planAction(dep, T1, 'submit', { year: 2026, seq: 1 });
    await expect(svc.financeControls.planAction(ceo, T1, 'approve', { year: 2026, seq: 2, comment: '' })).rejects.toThrow(/comment/);
    await expect(svc.financeControls.planAction(chair, T1, 'approve', { year: 2026, seq: 2, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.planAction(fd, T1, 'approve', { year: 2026, seq: 2, comment: 'Approved with 5% contingency' });
    await expect(svc.financeControls.planAction(dep, T1, 'draft', draft)).rejects.toThrow(/use the forecast/);
    await svc.financeControls.planAction(de, T1, 'actuals', { year: 2026, month: '2026-09', values: { revenue: 85_000, guard_cost: 70_500 }, source: 'SQL P&L Sep.pdf' });
    await expect(svc.financeControls.planAction(de, T1, 'actuals', { year: 2026, month: '2026-10', values: { revenue: 1 }, source: 'x.pdf' })).rejects.toThrow(/ended/);
    let plan = (await svc.financeControls.view(fd, T1)).plan;
    expect(plan.toExplain.map((x) => x.key)).toEqual(['2026-09:revenue']); // 15% and RM15,000 under; guard cost within limits
    expect(plan.forecastDue).toBe(true);
    await expect(svc.financeControls.planAction(dep, T1, 'forecast', { year: 2026, asOf: '2026-09', months: draft.months, note: 'x' })).rejects.toThrow(/at least 10/);
    await svc.financeControls.planAction(dep, T1, 'forecast', { year: 2026, asOf: '2026-09', months: { revenue: months(90_000) }, note: 'Site Kepong lost from October' });
    await svc.financeControls.planAction(de, T1, 'explain', { year: 2026, key: '2026-09:revenue', text: 'Kepong client terminated mid-September' });
    plan = (await svc.financeControls.view(fd, T1)).plan;
    expect([plan.toExplain.length, plan.forecastDue, plan.latestForecast]).toEqual([0, false, '2026-09']);
  });

  it('forecasts are quarterly and yearly (Fauzan, 1 Nov 2026)', async () => {
    const { svc } = fresh();
    const [dep, fd] = await who(svc, 'u-fin-t1-dep', 'u-fd');
    const figs = { revenue: months(100_000) };
    await svc.financeControls.planAction(dep, T1, 'draft', { year: 2026, months: figs, assumptions: '120 guards at RM2,900; no new contracts' });
    await svc.financeControls.planAction(dep, T1, 'submit', { year: 2026, seq: 1 });
    await svc.financeControls.planAction(fd, T1, 'approve', { year: 2026, seq: 2, comment: 'Approved.' });
    let plan = (await svc.financeControls.view(fd, T1)).plan;
    expect([plan.forecastDue, plan.yearlyDue, plan.quarterEnd]).toEqual([true, true, true]); // September closed = Q3
    const f = (x: Record<string, unknown>) => svc.financeControls.planAction(dep, T1, 'forecast', { year: 2026, months: figs, note: 'Q3 outlook after Kepong loss', ...x });
    await expect(f({ asOf: '2026-08' })).rejects.toThrow(/quarter end/);
    await expect(f({ asOf: '2026-10' })).rejects.toThrow(/closed/);
    await expect(f({ asOf: '2026-09', kind: 'monthly' })).rejects.toThrow(/quarterly or yearly/);
    await expect(f({ year: 2027, asOf: '2026-09' })).rejects.toThrow(/after a 2027 quarter closes/);
    await f({ asOf: '2026-09' });
    plan = (await svc.financeControls.view(fd, T1)).plan;
    expect([plan.forecastDue, plan.yearlyDue, plan.latestKind]).toEqual([false, true, 'quarterly']);
    await f({ asOf: '2026-09', kind: 'yearly', note: 'Full year 2026 outlook' });
    plan = (await svc.financeControls.view(fd, T1)).plan;
    expect(plan.yearlyDue).toBe(false);
    // Next year's yearly forecast can be made before it starts.
    await svc.financeControls.planAction(dep, T1, 'draft', { year: 2027, months: figs, assumptions: '130 guards; two renewals' });
    await svc.financeControls.planAction(dep, T1, 'forecast', { year: 2027, kind: 'yearly', asOf: '2026-09', months: figs, note: '2027 outlook before the year' });
  });
});

describe('check after payment (Fauzan, 1 Nov 2026)', () => {
  it('checks every released payment against its record and the bank statement; a failure is an exception for the close', async () => {
    const { svc, F, ds } = fresh();
    const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const bankId = F().banks[0].id;
    const make = async (sqlRef: string, amount: number) => {
      const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Stationery', amount, dueOn: '2026-11-20', bankId, sqlRef, evidence: ['inv.pdf'], eInvoiceRef: 'ABCDEFGHIJ0123456789XYZABC' });
      await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'Agrees to invoice.' });
      await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'Approved.' });
      return p;
    };
    const good = await make('PI-AP-1', 61.5);
    const bad = await make('PI-AP-2', 70);
    const nov = new PrimaService(new MemoryStore(ds), () => myt('2026-11-05', '10:00'));
    const [de2, dep1, fd1] = await who(nov, 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    const portal = { accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT', releasedOn: '2026-10-31' };
    await nov.finance.paymentStep(de2, T1, good.id, 'release', { ...portal, bankRef: 'REF-AP-0001' });
    await nov.finance.paymentStep(de2, T1, bad.id, 'release', { ...portal, bankRef: 'REF-AP-0002' });
    const view = async () => (await nov.financeControls.view(fd1, T1)).afterPayment;
    expect((await view()).filter((x) => [good.id, bad.id].includes(x.id)).map((x) => x.status)).toEqual(['waiting', 'waiting']);
    // The October statement: the first payment as released; the second shows a different reference and an earlier date.
    const csv = ['2026-10-31,IBG SYARIKAT BEKALAN,REF-AP-0001,-61.50', '2026-10-20,IBG UNKNOWN,ZZZ999,-70.00'].join('\n');
    await nov.financeControls.statementAction(dep1, T1, 'load', { bankId, period: '2026-10', opening: 1000, closing: 868.5, csv, source: 'm2u-oct.csv' });
    const st = F().statements!.find((x) => x.id === `stmt-${bankId}-2026-10`)!;
    const zzz = st.lines.find((l) => l.ref === 'ZZZ999')!;
    if (!zzz.match) await nov.financeControls.statementAction(dep1, T1, 'match', { statementId: st.id, lineId: zzz.id, paymentId: bad.id, comment: 'Same amount, bank shows another reference.' });
    const v = await view();
    const g = v.find((x) => x.id === good.id)!;
    const b = v.find((x) => x.id === bad.id)!;
    expect(g.status).toBe('pass');
    expect(b.status).toBe('fail');
    expect(b.checks.filter((c) => c.ok === false).map((c) => c.key).sort()).toEqual(['bankDate', 'bankRef']);
    const keys = (await nov.finance.desk(fd1)).companies.find((c) => c.companyId === T1)!.close.check.exceptions.map((e) => e.key);
    expect(keys).toContain(`afterpay:${bad.id}`);
    expect(keys).not.toContain(`afterpay:${good.id}`);
  });

  it('a release dated before its approval, or without the portal check, fails the check', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Stationery', amount: 40, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: 'PI-AP-3', evidence: ['inv.pdf'], eInvoiceRef: 'ABCDEFGHIJ0123456789XYZABC' });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'REF-AP-0003', releasedOn: '2026-10-01', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' })).rejects.toThrow(/before the approval/);
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'REF-AP-0003', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    // The stored record is later changed (the record is checked again, not trusted): release date moved earlier, portal check removed.
    const saved = F().payments!.find((x) => x.id === p.id)!;
    saved.releasedOn = '2026-10-01';
    saved.releaseCheck = null;
    const x = (await svc.financeControls.view(fd, T1)).afterPayment.find((y) => y.id === p.id)!;
    expect(x.checks.filter((c) => c.ok === false).map((c) => c.key).sort()).toEqual(['order', 'payee']);
    expect(x.status).toBe('fail');
  });
});

describe('walls', () => {
  it('another team, viewers and people outside Finance are kept out', async () => {
    const { svc, ds } = fresh();
    const other = ds.finStatus.find((f) => f.team === 2)!.companyId;
    const de = await svc.user('u-fin-t1-de1');
    await expect(svc.financeControls.view(de, other)).rejects.toThrow(/not found/);
    await expect(svc.financeControls.ageingAction(de, other, 'record', {})).rejects.toThrow(/not found/);
    await expect(svc.financeControls.planAction(await svc.user('u-audit'), T1, 'draft', {})).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.financeControls.view(await svc.user('u-audit'), T1)).companyId).toBe(T1);
    for (const id of ['u-coo', 'u-it-mgr', 'u-cos']) await expect(svc.financeControls.view(await svc.user(id), T1)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('review findings (Arisha main, 1 Nov 2026)', () => {
  it('a punctuation-only or partial account name at release does not match the verified payee', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Paper', amount: 77.7, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: 'PI-RF-1', evidence: ['inv.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    for (const accountName of ['**', '  -- ', 'SYA', 'SYARIKAT'])
      await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'REF-RF-1', accountLast4: '1000', accountName })).rejects.toThrow(/Do not release|account name/);
    // A bank's truncated display name of 8+ characters that is a prefix of the verified name is accepted.
    expect((await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'REF-RF-1', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJ' })).status).toBe('released');
  });

  it('the financials are not approved while an exception that appeared after review is unexplained', async () => {
    const { svc, ds } = fresh();
    const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const F = () => ds.finStatus.find((x) => x.companyId === T1)!;
    const f = F();
    f.sqlLastAt = myt(TODAY, '08:00');
    f.closedTo = '2026-09-30';
    f.banks.forEach((b) => (b.reconciledTo = '2026-09-30'));
    f.tests.forEach((t) => (t.diff = 0));
    f.posting = { ...f.posting, period: '2026-09', billedPosted: f.posting.billed, staffPayPosted: f.posting.staffPayPaid, guardPayPosted: f.posting.guardPayPaid, supplierBillsUnposted: 0 };
    const sign = (byId: string) => ({ by: byId, byId, at: myt(TODAY, '08:00'), comment: 'ok' });
    const zero = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 };
    f.ageing = [{ period: '2026-09', ar: zero, ap: zero, glAr: 0, glAp: 0, source: 'a.pdf', note: '', prepared: sign('u-fin-t1-de1'), reviewed: sign('u-fin-t1-dep') }];
    f.statements = f.banks.map((b) => ({ id: `s-${b.id}`, bankId: b.id, period: '2026-09', opening: 0, closing: 0, lines: [], loaded: { ...sign('u-fin-t1-de1'), source: 's.csv' } }));
    f.arCases = [];
    if (f.einvoice) f.einvoice.setup = null;
    for (const b of F().banks) await svc.finance.closeStep(de, T1, 'evidence', { bankId: b.id, ref: `rec ${b.id}.pdf` });
    await svc.finance.closeStep(de, T1, 'prepare');
    await svc.finance.closeStep(dep, T1, 'review', { comment: 'Recs agree.' });
    for (const i of (await svc.finance.desk(de)).companies.find((c) => c.companyId === T1)!.bank) {
      await svc.setFinPack(de, T1, 'bank', i.id, 'prepared');
      await svc.setFinPack(dep, T1, 'bank', i.id, 'reviewed', 'ok');
    }
    // After review, a new exception appears (a supplier bill found unposted).
    F().posting = { ...F().posting, supplierBillsUnposted: 1 };
    expect((await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.close.may).not.toContain('approve');
    await expect(svc.finance.closeStep(fd, T1, 'approve', { comment: 'ok' })).rejects.toThrow(/Explain: 1 supplier bill/);
  });

  it('nobody who drafted or submitted a budget approves it, even after someone else submits', async () => {
    const { svc } = fresh();
    const [dep, fd, ceo] = await who(svc, 'u-fin-t1-dep', 'u-fd', 'u-fauzan');
    const draft = { year: 2027, months: { revenue: Array(12).fill(1_000) }, assumptions: 'Flat revenue for the test year' };
    await svc.financeControls.planAction(fd, T1, 'draft', draft);
    await svc.financeControls.planAction(dep, T1, 'submit', { year: 2027, seq: 1 });
    await expect(svc.financeControls.planAction(fd, T1, 'approve', { year: 2027, seq: 2, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.financeControls.planAction(ceo, T1, 'approve', { year: 2027, seq: 2, comment: 'Approved.' })) as { budget: { status: string } }).toMatchObject({ budget: { status: 'approved' } });
  });
});

describe('standards review (1 Nov 2026): gaps closed', () => {
  const pay = async (svc: PrimaService, F: () => FinStatusT, de: Awaited<ReturnType<PrimaService['user']>>, over: Record<string, unknown> = {}) =>
    svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Standards test', amount: 777, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: `PI-STD-${Math.random()}`, evidence: ['inv.pdf'], ...over });

  it('the preparer never records the release of their own payment', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    const p = await pay(svc, F, de);
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    await expect(svc.finance.paymentStep(de, T1, p.id, 'release', { bankRef: 'M2U-1', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' })).rejects.toThrow(/they prepared/);
    expect((await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-1', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' })).status).toBe('released');
  });

  it('whoever changed a payee’s bank details does not review, approve or release payments to it', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, lead, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd');
    // The deputy changes the bank details; the leader verifies by call-back.
    await svc.financeControls.payeeAction(dep, T1, 'change', { payeeId: 'payee-pwvsb-001', bank: 'RHB Bank', accountLast4: '4321', accountName: 'SYARIKAT BEKALAN PEJABAT', source: 'Supplier letter dated 30 Oct (mock)' });
    await svc.financeControls.payeeAction(lead, T1, 'verify', { payeeId: 'payee-pwvsb-001', method: 'callback', contact: 'Accounts clerk', numberSource: 'Number on the signed contract', comment: 'Confirmed.' });
    const p = await pay(svc, F, de);
    await expect(svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' })).rejects.toThrow(/bank details they entered or changed/);
    await svc.finance.paymentStep(lead, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    await expect(svc.finance.paymentStep(dep, T1, p.id, 'release', { bankRef: 'M2U-2', accountLast4: '4321', accountName: 'SYARIKAT BEKALAN PEJABAT' })).rejects.toThrow(/bank details they entered or changed/);
    expect((await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-2', accountLast4: '4321', accountName: 'SYARIKAT BEKALAN PEJABAT' })).status).toBe('released');
  });

  it('the person who paid from an account does not load or hand-match its statement', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    const p = await pay(svc, F, de);
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    approvedOn(F(), p.id, '2026-09-29');
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'XYZ-9', releasedOn: '2026-09-29', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    const load = { bankId: F().banks[0].id, period: '2026-09', opening: 1000, closing: 223, csv: '2026-09-03,TRF,NO REF,-777', source: 'm2u-sep.csv' };
    await expect(svc.financeControls.statementAction(de2, T1, 'load', load)).rejects.toThrow(/someone who did not pay/);
    const st = (await svc.financeControls.statementAction(de, T1, 'load', load)) as { statement: { id: string; lines: { id: string; match: unknown }[] } };
    const line = st.statement.lines[0];
    expect(line.match).toBeNull(); // too far from the release date to match automatically
    // The preparer and the approver cannot match the payment by hand; the deputy (who only reviewed) can.
    await expect(svc.financeControls.statementAction(de, T1, 'match', { statementId: st.statement.id, lineId: line.id, paymentId: p.id, comment: 'same amount' })).rejects.toThrow(/prepared, approved or released/);
    await expect(svc.financeControls.statementAction(fd, T1, 'match', { statementId: st.statement.id, lineId: line.id, paymentId: p.id, comment: 'same amount' })).rejects.toThrow(/prepared, approved or released/);
    await svc.financeControls.statementAction(dep, T1, 'match', { statementId: st.statement.id, lineId: line.id, paymentId: p.id, comment: 'Same amount, payee on bank advice.' });
  });

  it('only the FD or the CEO switches a tax check off or records the signed audit', async () => {
    const { svc } = fresh();
    const [lead, fd, ceo] = await who(svc, 'u-fin-t1-lead', 'u-fd', 'u-fauzan');
    await expect(svc.financeControls.sstAction(lead, T1, 'setup', { registered: false, cycleStartMonth: 1 })).rejects.toThrow(/Finance Director or the CEO/);
    await svc.financeControls.sstAction(fd, T1, 'setup', { registered: false, cycleStartMonth: 1 });
    // Fauzan, 1 Nov 2026: the FD sets each company's SST and e-Invoice set-up; a team leader no longer does.
    await expect(svc.financeControls.sstAction(lead, T1, 'setup', { registered: true, sstNo: 'W10-1808-31000001', cycleStartMonth: 1 })).rejects.toThrow(/Finance Director or the CEO/);
    await svc.financeControls.sstAction(fd, T1, 'setup', { registered: true, sstNo: 'W10-1808-31000001', cycleStartMonth: 3 });
    await expect(svc.financeControls.einvoiceAction(lead, T1, 'setup', { required: true, basis: 'Own turnover above RM3 million', startOn: '2024-08-01', revenue: 12_000_000 })).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.financeControls.arAction(lead, T1, 'auditedTo', { date: '2025-12-31', comment: 'Signed by auditor (mock).' })).rejects.toThrow(/Finance Director or the CEO/);
    await svc.financeControls.arAction(ceo, T1, 'auditedTo', { date: '2025-12-31', comment: 'Signed by auditor (mock).' });
  });
});

describe('automatic bank reconciliation with SQL Account (Fauzan, 1 Nov 2026)', () => {
  const STMT = ['Date,Description,Reference,Amount', '2026-09-03,IBG UNIFORM MAJU PV-1001,M2U001,-4200.00', '2026-09-10,SALARY BATCH,M2U002,-3000.00', '2026-09-15,DEPOSIT CLIENT A,CDM88,5000.00', '2026-09-30,SERVICE CHARGE,,-12.50'].join('\n');
  const LEDGER = [
    'Date,Doc No,Description,Debit,Credit',
    '2026-09-02,PV-1001,Uniform Maju,0,4200.00',
    '2026-09-09,PV-1002,Salary staff A,0,1800.00',
    '2026-09-09,PV-1003,Salary staff B,0,1200.00',
    '2026-09-14,OR-200,Receipt client A,5000.00,0',
    '2026-09-28,PV-1004,Cheque 000123 Kenderaan,0,650.00',
    '2026-09-30,OR-201,Receipt client B,900.00,0',
  ].join('\n');

  it('matches by reference, amount and date, and batches; proves the balance; someone else reviews; it then stands for the SQL report at the close', async () => {
    const { svc, F } = fresh();
    const [de, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead');
    const bankId = F().banks[0].id;
    await svc.financeControls.statementAction(de, T1, 'load', { bankId, period: '2026-09', opening: 10000, closing: 7787.5, csv: STMT, source: 'm2u-sep.csv' });
    await expect(svc.financeControls.bankRecAction(dep, T1, 'run', { bankId, period: '2026-09', ledgerOpening: 10000, ledgerClosing: 9999, ledgerCsv: LEDGER, source: 'sql.csv' })).rejects.toThrow(/does not add up/);
    const out = (await svc.financeControls.bankRecAction(dep, T1, 'run', { bankId, period: '2026-09', ledgerOpening: 10000, ledgerClosing: 8050, ledgerCsv: LEDGER, source: 'SQL GL 310-000 Sep.csv' })) as {
      rec: { id: string; pairs: { how: string; ledgerIds: string[] }[] };
      result: { matchedLines: number; outstanding: { docNo: string }[]; inTransit: { docNo: string }[]; bankOnly: { id: string }[]; difference: number; adjustedBank: number };
    };
    expect(out.result.matchedLines).toBe(3);
    expect(out.rec.pairs.map((p) => p.how).sort()).toEqual(['amount_date', 'amount_date', 'reference']);
    expect(out.rec.pairs.some((p) => p.ledgerIds.length === 2)).toBe(true); // the salary batch
    expect(out.result.outstanding.map((g) => g.docNo)).toEqual(['PV-1004']);
    expect(out.result.inTransit.map((g) => g.docNo)).toEqual(['OR-201']);
    expect(out.result.bankOnly.length).toBe(1);
    expect(out.result.difference).toBe(0);
    expect(out.result.adjustedBank).toBe(8037.5);
    const blockers = async () => (await svc.finance.desk(de)).companies.find((c) => c.companyId === T1)!.close.check.blockers.join(' ');
    expect(await blockers()).toMatch(/1 bank item\(s\) not in SQL Account need posting or explaining/);
    await expect(svc.financeControls.bankRecAction(lead, T1, 'review', { recId: out.rec.id, comment: 'ok' })).rejects.toThrow(/need posting or explaining/);
    await svc.financeControls.bankRecAction(de, T1, 'explain', { recId: out.rec.id, lineId: out.result.bankOnly[0].id, comment: 'Bank service charge, posted JV-0930' });
    expect(await blockers()).toMatch(/reconciliation is waiting for review/);
    await expect(svc.financeControls.bankRecAction(dep, T1, 'review', { recId: out.rec.id, comment: 'ok' })).rejects.toThrow(/ran/);
    await expect(svc.financeControls.bankRecAction(de, T1, 'review', { recId: out.rec.id, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.financeControls.bankRecAction(lead, T1, 'review', { recId: out.rec.id, rev: 2, comment: 'Agrees to bank and SQL.' });
    const b = await blockers();
    expect(b).not.toMatch(new RegExp(`${F().banks[0].accountMasked.replace(/[*]/g, '\\*')}.*(reconcil|report)`));
    // A reviewed reconciliation is only redone by the FD or the CEO.
    await expect(svc.financeControls.bankRecAction(dep, T1, 'run', { bankId, period: '2026-09', ledgerOpening: 10000, ledgerClosing: 8050, ledgerCsv: LEDGER, source: 'again.csv' })).rejects.toThrow(/Finance Director or the CEO/);
  });

  it('a hand match must agree in amount and has a comment; the person who paid from the account does not reconcile it', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    const bankId = F().banks[0].id;
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Rec test', amount: 50, dueOn: '2026-11-20', bankId, sqlRef: 'PI-REC-1', evidence: ['inv.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    approvedOn(F(), p.id, '2026-09-20');
    await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'REC-0001', releasedOn: '2026-09-20', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    await svc.financeControls.statementAction(de, T1, 'load', { bankId, period: '2026-09', opening: 10000, closing: 7787.5, csv: STMT, source: 'm2u-sep.csv' });
    const run = { bankId, period: '2026-09', ledgerOpening: 10000, ledgerClosing: 8050, ledgerCsv: LEDGER, source: 'sql.csv' };
    await expect(svc.financeControls.bankRecAction(de2, T1, 'run', run)).rejects.toThrow(/someone who did not pay/);
    const out = (await svc.financeControls.bankRecAction(dep, T1, 'run', run)) as { rec: { id: string; ledger: { id: string; docNo: string }[] }; result: { bankOnly: { id: string }[] } };
    const charge = out.result.bankOnly[0].id;
    const pv4 = out.rec.ledger.find((g) => g.docNo === 'PV-1004')!.id;
    await expect(svc.financeControls.bankRecAction(de, T1, 'match', { recId: out.rec.id, lineIds: [charge], ledgerIds: [pv4], comment: 'same' })).rejects.toThrow(/do not agree/);
    await expect(svc.financeControls.bankRecAction(de, T1, 'explain', { recId: out.rec.id, lineId: charge, comment: 'short' })).rejects.toThrow();
  });

  it('carries last month’s outstanding items forward so they clear the next month', async () => {
    const { svc, F, ds } = fresh();
    const [de, dep] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep');
    const bankId = F().banks[0].id;
    await svc.financeControls.statementAction(de, T1, 'load', { bankId, period: '2026-09', opening: 10000, closing: 7787.5, csv: STMT, source: 'm2u-sep.csv' });
    await svc.financeControls.bankRecAction(dep, T1, 'run', { bankId, period: '2026-09', ledgerOpening: 10000, ledgerClosing: 8050, ledgerCsv: LEDGER, source: 'sql-sep.csv' });
    const nov = new PrimaService(new MemoryStore(ds), () => myt('2026-11-05', '10:00'));
    const [de1, dep1] = await who(nov, 'u-fin-t1-de1', 'u-fin-t1-dep');
    // October: the cheque and the deposit clear; one new payment in SQL Account and at the bank.
    const octStmt = ['2026-10-02,CHQ 000123,000123,-650.00', '2026-10-01,CASH DEPOSIT,CDM90,900.00', '2026-10-20,IBG SUPPLIER PV-1010,M2U050,-300.00'].join('\n');
    await nov.financeControls.statementAction(de1, T1, 'load', { bankId, period: '2026-10', opening: 7787.5, closing: 7737.5, csv: octStmt, source: 'm2u-oct.csv' });
    const r = (await nov.financeControls.bankRecAction(dep1, T1, 'run', {
      bankId,
      period: '2026-10',
      ledgerOpening: 8050,
      ledgerClosing: 7750,
      ledgerCsv: '2026-10-19,PV-1010,Supplier,0,300.00',
      source: 'sql-oct.csv',
    })) as { rec: { ledger: { carriedFrom?: string }[] }; result: { matchedLines: number; outstanding: unknown[]; inTransit: unknown[]; bankOnly: unknown[]; difference: number } };
    expect(r.rec.ledger.filter((g) => g.carriedFrom === '2026-09').length).toBe(2);
    // Last month's bank charge is still not in SQL Account: it stays listed (with last month's explanation) and the balance proves.
    expect(r.result).toMatchObject({ matchedLines: 3, outstanding: [], inTransit: [], difference: 0 });
    expect((r.result.bankOnly as { explained: { note: string } | null }[]).map((x) => x.explained?.note ?? null)).toEqual([null]);
    // Once SQL Account has the charge (posted in October), it matches the carried bank line.
    const r2 = (await nov.financeControls.bankRecAction(await nov.user('u-fd'), T1, 'run', {
      bankId,
      period: '2026-10',
      ledgerOpening: 8050,
      ledgerClosing: 7737.5,
      ledgerCsv: ['2026-10-19,PV-1010,Supplier,0,300.00', '2026-10-31,JV-0930,Bank charge Sep,0,12.50'].join('\n'),
      source: 'sql-oct-2.csv',
    })) as { result: { matchedLines: number; bankOnly: unknown[]; outstanding: unknown[]; difference: number } };
    expect(r2.result).toMatchObject({ matchedLines: 4, bankOnly: [], outstanding: [], difference: 0 });
  });
});

// Arisha main's dummy-data probes on e75b843 (1 Nov 2026): each sequence below failed before the fix.
describe('review findings on e75b843 (Arisha main, 1 Nov 2026)', () => {
  const approved = async (svc: PrimaService, F: () => FinStatusT, sqlRef: string) => {
    const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Probe', amount: 61.5, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef, evidence: ['inv.pdf'] });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    return p;
  };
  const release = { bankRef: 'REF-PROBE-1', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' };

  it('1. a Teams rejection linked after approval stops the release', async () => {
    const { svc, F } = fresh();
    const [de, de2] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2');
    const p = await approved(svc, F, 'PI-PR-1');
    await svc.finance.paymentStep(de, T1, p.id, 'link', {
      system: 'teams',
      url: 'https://teams.microsoft.com/l/approvals/p1',
      requestRef: 'REQ-P1',
      decisions: [{ approver: 'Finance Team Leader 1', decision: 'rejected', comment: 'Not in budget', decidedOn: TODAY }],
    });
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', release)).rejects.toThrow(/rejected the request in Teams/);
    expect(F().payments!.find((x) => x.id === p.id)!.status).toBe('approved');
  });

  it('3. changing only the payee account name after approval holds the release, even after a call-back', async () => {
    const { svc, F } = fresh();
    const [de, de2, dep] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep');
    const p = await approved(svc, F, 'PI-PR-3');
    const payee = F().payees!.find((x) => x.id === 'payee-pwvsb-001')!;
    const newName = 'SYARIKAT BEKALAN PEJABAT BARU SDN BHD';
    await svc.financeControls.payeeAction(de, T1, 'change', { payeeId: payee.id, bank: payee.bank, accountLast4: payee.accountLast4, accountName: newName, source: 'Supplier letter 2026-10-30' });
    await svc.financeControls.payeeAction(dep, T1, 'verify', { payeeId: payee.id, method: 'callback', contact: 'Puan Aminah, accounts', numberSource: 'Phone number in the 2025 contract', comment: 'Confirmed by phone.' });
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', { ...release, accountName: newName })).rejects.toThrow(/changed after approval/);
  });

  it('9. raising the approval validity does not revive a lapsed approval', async () => {
    const { svc, F, ds } = fresh();
    const p = await approved(svc, F, 'PI-PR-9');
    expect(F().payments!.find((x) => x.id === p.id)!.expiresOn).toBe('2026-11-30');
    const dec = new PrimaService(new MemoryStore(ds), () => myt('2026-12-05', '10:00'));
    const [de2, fd] = await who(dec, 'u-fin-t1-de2', 'u-fd');
    await expect(dec.finance.paymentStep(de2, T1, p.id, 'release', release)).rejects.toThrow(/lapsed on 2026-11-30/);
    await dec.finance.setSettings(fd, { values: { approvalExpiryDays: 60 }, comment: 'Longer validity agreed.' });
    await expect(dec.finance.paymentStep(de2, T1, p.id, 'release', release)).rejects.toThrow(/lapsed on 2026-11-30/);
    // An older approval saved before the day was fixed never gets more than the rule's 30 days either.
    delete F().payments!.find((x) => x.id === p.id)!.expiresOn;
    await expect(dec.finance.paymentStep(de2, T1, p.id, 'release', release)).rejects.toThrow(/lapsed on 2026-11-30/);
  });

  const month = { period: '2026-09', issued: 40, valid: 40, invalid: 0, submitting: 0, notSubmitted: 0, consolidatedNeeded: false, source: 'MyInvois Transaction Sep.xlsx' };

  it('2 and 4. the e-Invoice review signs the counts read; a late identical retry keeps the review; new counts need a reopen', async () => {
    const { svc, CO } = fresh();
    const co = CO().companyId;
    const [de, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead');
    const m1 = (await svc.financeControls.einvoiceAction(de, co, 'record', month)) as { rev: number };
    expect(m1.rev).toBe(1);
    // The reviewer opened revision 1; the counts are then changed (3 became 999).
    await svc.financeControls.einvoiceAction(de, co, 'record', { ...month, issued: 999, valid: 999 });
    await expect(svc.financeControls.einvoiceAction(dep, co, 'review', { period: '2026-09', rev: 1, comment: 'Agrees.' })).rejects.toThrow(/changed after you opened/);
    await expect(svc.financeControls.einvoiceAction(dep, co, 'review', { period: '2026-09', comment: 'Agrees.' })).rejects.toThrow(/changed after you opened/);
    await svc.financeControls.einvoiceAction(dep, co, 'review', { period: '2026-09', rev: 2, comment: 'Agrees to MyInvois.' });
    // The same counts arriving again late change nothing, and the review stays.
    const again = (await svc.financeControls.einvoiceAction(de, co, 'record', { ...month, issued: 999, valid: 999 })) as { reviewed: unknown; rev: number };
    expect(again.reviewed).toBeTruthy();
    expect(again.rev).toBe(2);
    // Different counts for a reviewed month: reopened first, by a senior, with a reason.
    await expect(svc.financeControls.einvoiceAction(de, co, 'record', month)).rejects.toThrow(/reopens it/);
    await expect(svc.financeControls.einvoiceAction(dep, co, 'reopen', { period: '2026-09', comment: 'Recount needed' })).rejects.toBeInstanceOf(AccessDenied);
    const re = (await svc.financeControls.einvoiceAction(lead, co, 'reopen', { period: '2026-09', comment: 'LHDN rejected two after review.' })) as { rev: number; reviewed: unknown; reopened: unknown[] };
    expect(re).toMatchObject({ rev: 3, reviewed: null });
    expect(re.reopened.length).toBe(1);
    expect(((await svc.financeControls.einvoiceAction(de, co, 'record', month)) as { rev: number }).rev).toBe(4);
  });

  it('5 and 6. e-Invoice set-up takes only a real yes/no; the consolidated UUID and date are checked for form', async () => {
    const { svc, CO } = fresh();
    const co = CO().companyId;
    const [de, fd] = await who(svc, 'u-fin-t1-de1', 'u-fd');
    await expect(svc.financeControls.einvoiceAction(fd, T1, 'setup', { required: 'true', basis: 'Own turnover above RM3 million', startOn: '2024-08-01', revenue: 12_000_000 })).rejects.toThrow(/yes or no/);
    await expect(svc.financeControls.einvoiceAction(fd, T1, 'setup', { basis: 'Own turnover above RM3 million', startOn: '2024-08-01', revenue: 12_000_000 })).rejects.toThrow(/yes or no/);
    const withC = { ...month, consolidatedNeeded: true };
    await expect(svc.financeControls.einvoiceAction(de, co, 'record', { ...withC, consolidatedUuid: 'not-a-uuid-123', consolidatedOn: '2026-10-05' })).rejects.toThrow(/26-character/);
    await expect(svc.financeControls.einvoiceAction(de, co, 'record', { ...withC, consolidatedUuid: 'F9D425P6DS7D8IUQWERTY12345', consolidatedOn: '2026-11-15' })).rejects.toThrow(/future/);
    await expect(svc.financeControls.einvoiceAction(de, co, 'record', { ...withC, consolidatedUuid: 'F9D425P6DS7D8IUQWERTY12345', consolidatedOn: '2026-08-31' })).rejects.toThrow(/before the month/);
    await expect(svc.financeControls.einvoiceAction(de, co, 'record', { ...withC, consolidatedOn: '2026-10-05' })).rejects.toThrow(/UUID with its submission date/);
    const ok = (await svc.financeControls.einvoiceAction(de, co, 'record', { ...withC, consolidatedUuid: 'F9D425P6DS7D8IUQWERTY12345', consolidatedOn: '2026-10-05' })) as { consolidated: { uuid: string } };
    expect(ok.consolidated.uuid).toBe('F9D425P6DS7D8IUQWERTY12345');
  });

  const STMT = ['2026-09-03,IBG UNIFORM MAJU PV-1001,M2U001,-4200.00', '2026-09-10,SALARY BATCH,M2U002,-3000.00', '2026-09-15,DEPOSIT CLIENT A,CDM88,5000.00', '2026-09-30,SERVICE CHARGE,,-12.50'].join('\n');
  const LEDGER = ['2026-09-02,PV-1001,Uniform Maju,0,4200.00', '2026-09-09,PV-1002,Salary staff A,0,1800.00', '2026-09-09,PV-1003,Salary staff B,0,1200.00', '2026-09-14,OR-200,Receipt client A,5000.00,0', '2026-09-28,PV-1004,Cheque 000123 Kenderaan,0,650.00', '2026-09-30,OR-201,Receipt client B,900.00,0'].join('\n');

  it('7. a replacement statement with the same total makes the reviewed reconciliation stale; the same file again changes nothing', async () => {
    const { svc, F } = fresh();
    const [de, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead');
    const bankId = F().banks[0].id;
    const load = { bankId, period: '2026-09', opening: 10000, closing: 7787.5, csv: STMT, source: 'm2u-sep.csv' };
    await svc.financeControls.statementAction(de, T1, 'load', load);
    const run = { bankId, period: '2026-09', ledgerOpening: 10000, ledgerClosing: 8050, ledgerCsv: LEDGER, source: 'sql.csv' };
    const out = (await svc.financeControls.bankRecAction(dep, T1, 'run', run)) as { rec: { id: string }; result: { bankOnly: { id: string }[] } };
    await svc.financeControls.bankRecAction(de, T1, 'explain', { recId: out.rec.id, lineId: out.result.bankOnly[0].id, comment: 'Bank service charge, posted JV-0930' });
    await svc.financeControls.bankRecAction(lead, T1, 'review', { recId: out.rec.id, rev: 2, comment: 'Agrees to bank and SQL.' });
    const blockers = async () => (await svc.finance.desk(de)).companies.find((c) => c.companyId === T1)!.close.check.blockers.join(' ');
    // The same statement loaded again: nothing changes, the reviewed reconciliation still stands.
    await svc.financeControls.statementAction(lead, T1, 'load', load);
    expect(F().statements!.find((x) => x.id === `stmt-${bankId}-2026-09`)!.version ?? 1).toBe(1);
    expect(await blockers()).not.toMatch(/statement was replaced/);
    // A different statement with the same total: a new version with new line ids; the old reconciliation is stale.
    await svc.financeControls.statementAction(lead, T1, 'load', { ...load, csv: STMT.replace('SALARY BATCH,M2U002', 'IBG OTHER PAYEE,M2U777'), source: 'm2u-sep-v2.csv' });
    const st = F().statements!.find((x) => x.id === `stmt-${bankId}-2026-09`)!;
    expect(st.version).toBe(2);
    expect(st.lines.every((l) => l.id.includes('-v2-'))).toBe(true);
    expect(await blockers()).toMatch(/run the 2026-09 reconciliation again \(the 2026-09 statement was replaced/);
    await expect(svc.financeControls.bankRecAction(de, T1, 'explain', { recId: out.rec.id, lineId: out.result.bankOnly[0].id, comment: 'Bank service charge, posted JV-0930' })).rejects.toThrow(/replaced/);
    // Run again on the new version (no FD needed: the reviewed one no longer stands).
    const again = (await svc.financeControls.bankRecAction(dep, T1, 'run', { ...run, source: 'sql-v2.csv' })) as { rec: { statementVersion: number; reviewed: unknown } };
    expect(again.rec).toMatchObject({ statementVersion: 2, reviewed: null });
  });

  it('8. nobody who matched, unmatched or explained reviews the reconciliation, and the review signs the revision read', async () => {
    const { svc, F } = fresh();
    const [de, dep, lead, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd');
    const bankId = F().banks[0].id;
    // A bank line and a SQL entry 20 days apart with different references: no automatic match.
    await svc.financeControls.statementAction(de, T1, 'load', { bankId, period: '2026-09', opening: 1000, closing: 900, csv: '2026-09-05,IBG SUPPLIER,XX1,-100.00', source: 'm2u.csv' });
    const out = (await svc.financeControls.bankRecAction(dep, T1, 'run', { bankId, period: '2026-09', ledgerOpening: 1000, ledgerClosing: 900, ledgerCsv: '2026-09-25,PV-9,Supplier,0,100.00', source: 'sql.csv' })) as {
      rec: { id: string; ledger: { id: string }[] };
      result: { bankOnly: { id: string }[]; matchedLines: number };
    };
    expect(out.result.matchedLines).toBe(0);
    await svc.financeControls.bankRecAction(lead, T1, 'match', { recId: out.rec.id, lineIds: [out.result.bankOnly[0].id], ledgerIds: [out.rec.ledger[0].id], comment: 'Same supplier payment, bank posted early.' });
    await expect(svc.financeControls.bankRecAction(lead, T1, 'review', { recId: out.rec.id, rev: 2, comment: 'Agrees.' })).rejects.toThrow(/reconciliation they changed/);
    await expect(svc.financeControls.bankRecAction(fd, T1, 'review', { recId: out.rec.id, rev: 1, comment: 'Agrees.' })).rejects.toThrow(/changed after you opened/);
    const done = (await svc.financeControls.bankRecAction(fd, T1, 'review', { recId: out.rec.id, rev: 2, comment: 'Agrees.' })) as { rec: { reviewed: { byId: string }; contributors: string[] } };
    expect(done.rec.reviewed.byId).toBe('u-fd');
    expect(done.rec.contributors).toEqual(['u-fin-t1-dep', 'u-fin-t1-lead']);
  });

  it('re-test on e2cf887: the next month does not carry items from a previous month that no longer stands', async () => {
    const { svc, F, ds } = fresh();
    const [de, dep, lead] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead');
    const bankId = F().banks[0].id;
    const sepLoad = { bankId, period: '2026-09', opening: 10000, closing: 7787.5, csv: STMT, source: 'm2u-sep.csv' };
    const sepRun = { bankId, period: '2026-09', ledgerOpening: 10000, ledgerClosing: 8050, ledgerCsv: LEDGER, source: 'sql-sep.csv' };
    await svc.financeControls.statementAction(de, T1, 'load', sepLoad);
    await svc.financeControls.bankRecAction(dep, T1, 'run', sepRun);
    // September's statement is replaced (same total, different line): its reconciliation goes stale.
    await svc.financeControls.statementAction(lead, T1, 'load', { ...sepLoad, csv: STMT.replace('SALARY BATCH,M2U002', 'IBG OTHER PAYEE,M2U777'), source: 'm2u-sep-v2.csv' });
    const nov = new PrimaService(new MemoryStore(ds), () => myt('2026-11-05', '10:00'));
    const [de1, dep1, lead1] = await who(nov, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead');
    const octStmt = ['2026-10-02,CHQ 000123,000123,-650.00', '2026-10-01,CASH DEPOSIT,CDM90,900.00', '2026-10-20,IBG SUPPLIER PV-1010,M2U050,-300.00'].join('\n');
    await nov.financeControls.statementAction(de1, T1, 'load', { bankId, period: '2026-10', opening: 7787.5, closing: 7737.5, csv: octStmt, source: 'm2u-oct.csv' });
    const octRun = { bankId, period: '2026-10', ledgerOpening: 8050, ledgerClosing: 7750, ledgerCsv: '2026-10-19,PV-1010,Supplier,0,300.00', source: 'sql-oct.csv' };
    await expect(nov.financeControls.bankRecAction(dep1, T1, 'run', octRun)).rejects.toThrow(/Run the 2026-09 reconciliation again first: the 2026-09 statement was replaced/);
    // September run again on the new statement: October now runs, bound to September's revision and statement version.
    const sepAgain = (await nov.financeControls.bankRecAction(dep1, T1, 'run', { ...sepRun, source: 'sql-sep-2.csv' })) as { result: { bankOnly: { id: string }[] } };
    const oct = (await nov.financeControls.bankRecAction(dep1, T1, 'run', octRun)) as { rec: { id: string; carriedFromRec: unknown }; result: { difference: number; bankOnly: { id: string }[] } };
    expect(oct.rec.carriedFromRec).toEqual({ id: `rec-${bankId}-2026-09`, rev: 2, statementVersion: 2 });
    expect(oct.result.difference).toBe(0);
    // September changes again after October was run (a charge explained): October no longer stands until run again.
    const octBlockers = async () => (await nov.finance.desk(de1)).companies.find((c) => c.companyId === T1)!.close.check.blockers.join(' ');
    await nov.financeControls.bankRecAction(de1, T1, 'explain', { recId: `rec-${bankId}-2026-09`, lineId: sepAgain.result.bankOnly[0].id, comment: 'Bank service charge, posted JV-0930' });
    await expect(nov.financeControls.bankRecAction(lead1, T1, 'review', { recId: oct.rec.id, rev: 1, comment: 'Agrees.' })).rejects.toThrow(/Run the 2026-10 reconciliation again: the 2026-09 reconciliation it carries items from changed/);
    expect(await octBlockers()).toMatch(/run the 2026-10 reconciliation again/);
    await nov.financeControls.bankRecAction(dep1, T1, 'run', { ...octRun, source: 'sql-oct-2.csv' });
    expect(await octBlockers()).not.toMatch(/run the 2026-10 reconciliation again/);
  });
});

// Arisha main's re-test on 4f07420 (1 Nov 2026).
describe('review findings on 4f07420 (Arisha main, 1 Nov 2026)', () => {
  it('a bank reference only partly the same never passes the check after payment; it waits for a person to compare', async () => {
    const { svc, F, ds } = fresh();
    const [de, dep, fd] = await who(svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd');
    const bankId = F().banks[0].id;
    const make = async (sqlRef: string, amount: number) => {
      const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'Stationery', amount, dueOn: '2026-11-20', bankId, sqlRef, evidence: ['inv.pdf'], eInvoiceRef: 'ABCDEFGHIJ0123456789XYZABC' });
      await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
      await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
      return p;
    };
    const one = await make('PI-RR-1', 11);
    const two = await make('PI-RR-2', 22);
    const three = await make('PI-RR-3', 33);
    const nov = new PrimaService(new MemoryStore(ds), () => myt('2026-11-05', '10:00'));
    const [de2, dep1, fd1] = await who(nov, 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd');
    const portal = { accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT', releasedOn: '2026-10-31' };
    await nov.finance.paymentStep(de2, T1, one.id, 'release', { ...portal, bankRef: 'BANKREF9' });
    await nov.finance.paymentStep(de2, T1, two.id, 'release', { ...portal, bankRef: 'REF-AP-0001' });
    await nov.finance.paymentStep(de2, T1, three.id, 'release', { ...portal, bankRef: 'M2U-555123' });
    // The stored reference of the first is later cut to "1" (a release itself needs 4+ characters).
    F().payments!.find((x) => x.id === one.id)!.bankRef = '1';
    const csv = ['2026-10-31,IBG SUPPLIER,BANK-REFERENCE-123456,-11.00', '2026-10-31,IBG SUPPLIER,REF-AP-00011,-22.00', '2026-10-31,IBG SYARIKAT BEKALAN PEJABAT M2U-555123,XX,-33.00'].join('\n');
    await nov.financeControls.statementAction(dep1, T1, 'load', { bankId, period: '2026-10', opening: 1000, closing: 934, csv, source: 'm2u-oct.csv' });
    const st = F().statements!.find((x) => x.id === `stmt-${bankId}-2026-10`)!;
    for (const [p, i] of [[one, 0], [two, 1], [three, 2]] as const)
      if (!F().payments!.find((x) => x.id === p.id)!.cleared)
        await nov.financeControls.statementAction(dep1, T1, 'match', { statementId: st.id, lineId: st.lines[i].id, paymentId: p.id, comment: 'Same amount and day.' });
    const v = (await nov.financeControls.view(fd1, T1)).afterPayment;
    const ref = (id: string) => v.find((x) => x.id === id)!;
    expect(ref(one.id).status).toBe('review');
    expect(ref(one.id).checks.find((c) => c.key === 'bankRef')!.ok).toBeNull();
    expect(ref(two.id).status).toBe('review');
    // A whole word of the bank's description that equals the reference passes.
    expect(ref(three.id).status).toBe('pass');
    const keys = (await nov.finance.desk(fd1)).companies.find((c) => c.companyId === T1)!.close.check.exceptions.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining([`afterpay:${one.id}`, `afterpay:${two.id}`]));
    expect(keys).not.toContain(`afterpay:${three.id}`);
  });

  it('a missed quarterly forecast stays owed in later months until it is saved', async () => {
    const { svc, ds } = fresh();
    const [dep, fd] = await who(svc, 'u-fin-t1-dep', 'u-fd');
    const figs = { revenue: Array(12).fill(100_000) };
    await svc.financeControls.planAction(dep, T1, 'draft', { year: 2026, months: figs, assumptions: '120 guards at RM2,900; no new contracts' });
    await svc.financeControls.planAction(dep, T1, 'submit', { year: 2026, seq: 1 });
    await svc.financeControls.planAction(fd, T1, 'approve', { year: 2026, seq: 2, comment: 'Approved.' });
    const at = async (day: string) => {
      const s2 = new PrimaService(new MemoryStore(ds), () => myt(day, '10:00'));
      return { s2, plan: (await s2.financeControls.view(await s2.user('u-fd'), T1)).plan };
    };
    // Q1 and Q2 closed before the budget was approved (end October): only September is owed.
    let { plan } = await at('2026-10-31');
    expect(plan.forecastsOwed.map((q) => q.asOf)).toEqual(['2026-09']);
    // November: October closed, the September forecast is still not done and still overdue.
    ({ plan } = await at('2026-12-05'));
    expect(plan.forecastsOwed).toEqual([{ asOf: '2026-09', dueOn: '2026-10-20', overdue: true }]);
    expect(plan.forecastDue).toBe(true);
    // January: December has closed too; both are owed.
    const jan = await at('2027-01-25');
    expect(jan.plan.forecastsOwed.map((q) => q.asOf)).toEqual(['2026-09', '2026-12']);
    await jan.s2.financeControls.planAction(await jan.s2.user('u-fin-t1-dep'), T1, 'forecast', { year: 2026, kind: 'quarterly', asOf: '2026-09', months: figs, note: 'Late Q3 forecast, Kepong lost' });
    ({ plan } = await at('2027-01-25'));
    expect(plan.forecastsOwed.map((q) => q.asOf)).toEqual(['2026-12']);
  });
});
