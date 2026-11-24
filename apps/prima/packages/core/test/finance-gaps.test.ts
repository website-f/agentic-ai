import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finCloseCheck, generateDataset, myt } from '../src';
import { receivedSupplierBill } from './supplier-bill-helper';
import { finPayoutExceptions, finSettingsConfirmedNow } from '../src/finance-payouts';
import { sqlConfirmedBook, sqlSwitchOrderProblem } from '../src/sql-posting';

// Finance gaps (Fauzan, 23 Nov 2026, answering the Finance study): D1 the Account Manager does what the FD delegates;
// D2 a second Finance person records salary and claim payouts; B1 payouts on the bank statement; B2 payroll journals
// from real records; D3 the FD confirms thresholds and sets budget limits; D4 SQL posting switch-on order. Dummy data.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const T1 = GROUP_EMPLOYER_ID;

describe('D1: the Account Manager sits below the FD and does what the FD delegates', () => {
  it('looks only until delegated, then acts at the delegated level on the delegated companies, and never approves', async () => {
    const { svc, ds } = fresh();
    const [am, fd, lead, de, ceo] = await Promise.all(['u-fin-am', 'u-fd', 'u-fin-t1-lead', 'u-fin-t1-de1', 'u-fauzan'].map((id) => svc.user(id)));
    // Before any delegation: a viewer, every company visible, nothing to act on.
    expect((await svc.finance.actorFor(am)).kind).toBe('viewer');
    const f = ds.finStatus.find((x) => x.companyId === T1)!;
    const p = await svc.finance.createPayment(de, T1, { payeeId: 'payee-pwvsb-001', purpose: 'UAT stationery', amount: 99.5, dueOn: '2026-12-01', bankId: f.banks[0].id, sqlRef: 'PI-AM-1', evidence: ['inv.pdf'] });
    await expect(svc.finance.paymentStep(am, T1, p.id, 'review', { comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    // Only the FD or the CEO delegates, with a comment; a team leader cannot.
    await expect(svc.finance.delegateToAm(lead, { userId: am.id, level: 'leader', comment: 'x' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.finance.delegateToAm(fd, { userId: lead.id, level: 'leader', comment: 'Leads billing' })).rejects.toThrow(/Account Manager/);
    await expect(svc.finance.delegateToAm(fd, { userId: am.id, level: 'leader', comment: ' ' })).rejects.toThrow(/comment/);
    await svc.finance.delegateToAm(fd, { userId: am.id, level: 'deputy', companies: ['co-sasa'], comment: 'Covers Sasa billing while Team 2 is short' });
    // Delegated Sasa only: PWVSB's payment is still out of reach.
    expect((await svc.finance.actorFor(am)).kind).toBe('deputy');
    await expect(svc.finance.paymentStep(am, T1, p.id, 'review', { comment: 'ok' })).rejects.toThrow();
    // Widened to every company as a leader: reviews, but never approves.
    await svc.finance.delegateToAm(ceo, { userId: am.id, level: 'leader', companies: 'all', comment: 'Leads all collections' });
    const r = await svc.finance.paymentStep(am, T1, p.id, 'review', { comment: 'Matches the quotation.' });
    expect(r.status).toBe('reviewed');
    await expect(svc.finance.paymentStep(am, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow();
    const view = await svc.finance.settingsView(fd);
    expect(view.accountManagers.find((x) => x.userId === am.id)).toMatchObject({ level: 'leader', companies: null });
    expect(view.accountManagers.find((x) => x.userId === am.id)!.history.length).toBe(1);
  });
});

describe('D2, B1, B2: salary and claim payouts', () => {
  it('one Finance person prepares, another at leader level records paid, Prima finds it on the statement, the journal is checked', async () => {
    const { svc, ds } = fresh();
    const [fd, lead, de, dep, ceo] = await Promise.all(['u-fd', 'u-fin-t1-lead', 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fauzan'].map((id) => svc.user(id)));
    const run = ds.staffPayRuns.find((r) => r.stage === 'coo_approved')!;
    const co = run.companyId;
    // Put the company with Team 1 for the test.
    await svc.finance.setSettings(fd, { values: { teams: { [co]: 1 } }, comment: 'Team 1 covers it this year' });
    const f = () => ds.finStatus.find((x) => x.companyId === co)!;
    const bankId = f().banks[0].id;
    const amount = Math.round(run.lines.reduce((n, l) => n + l.net, 0) * 100) / 100;
    // Not prepared: nobody can record it paid.
    await expect(svc.recordPayout(fd, { source: 'staff_pay', sourceId: run.id, bankRef: 'SAL-1', paidOn: TODAY, pcbChecked: true })).rejects.toThrow(/prepares the payment first/);
    const view0 = await svc.financePayouts.view(de, co);
    expect(view0.waiting.find((w) => w.sourceId === run.id)).toMatchObject({ amount, mayPrepare: true, mayRecord: false });
    await svc.financePayouts.prepare(de, { source: 'staff_pay', sourceId: run.id, bankId, note: 'November salaries' });
    // The preparer cannot record it; a deputy is not at leader level.
    await expect(svc.recordPayout(de, { source: 'staff_pay', sourceId: run.id, bankRef: 'SAL-1', paidOn: TODAY, pcbChecked: true })).rejects.toThrow();
    await expect(svc.recordPayout(dep, { source: 'staff_pay', sourceId: run.id, bankRef: 'SAL-1', paidOn: TODAY, pcbChecked: true })).rejects.toThrow();
    expect((await svc.financePayouts.view(lead, co)).waiting.find((w) => w.sourceId === run.id)!.mayRecord).toBe(true);
    await svc.recordPayout(lead, { source: 'staff_pay', sourceId: run.id, bankRef: 'M2U-SAL-NOV', paidOn: '2026-10-31', pcbChecked: true });
    expect(ds.staffPayRuns.find((r) => r.id === run.id)!.stage).toBe('paid');
    const po = f().payouts!.find((x) => x.sourceId === run.id)!;
    expect(po).toMatchObject({ amount, bankId, prepared: { byId: de.id }, paid: { byId: lead.id, ref: 'M2U-SAL-NOV' }, seen: null });
    // B1 and B2: once the November statement is loaded without it, the close lists it; the journal line is there too.
    await svc.financeControls.statementAction(de, co, 'load', { bankId, period: '2026-10', opening: 1_000_000, closing: 999_990, csv: '2026-10-30,TRF,OTHER,-10', source: 'nov.csv' });
    const ex = finPayoutExceptions(f(), '2026-10').map((e) => e.key);
    expect(ex).toContain(`payout:${po.id}`);
    expect(ex).toContain(`journal:${po.id}`);
    // The right statement: found automatically.
    await svc.financeControls.statementAction(lead, co, 'load', { bankId, period: '2026-10', opening: 1_000_000, closing: 1_000_000 - amount, csv: `2026-10-31,TRF,M2U-SAL-NOV,-${amount.toFixed(2)}`, source: 'nov2.csv' });
    expect(f().payouts!.find((x) => x.id === po.id)!.seen).not.toBeNull();
    // The journal: entered by one, checked by another.
    await svc.financePayouts.journal(de, co, po.id, 'enter', { no: 'JV-2026-11-01' });
    await expect(svc.financePayouts.journal(de, co, po.id, 'check', { comment: 'Seen in SQL Account' })).rejects.toThrow(/Someone other/);
    await svc.financePayouts.journal(dep, co, po.id, 'check', { comment: 'Seen in SQL Account GL' });
    expect(finPayoutExceptions(f(), '2026-10')).toEqual([]);
    void ceo;
  });

  it('the claimant neither prepares nor records their own claim', async () => {
    const { svc, ds } = fresh();
    const [fd, ceo] = await Promise.all(['u-fd', 'u-fauzan'].map((id) => svc.user(id)));
    const c = ds.staffClaims[0];
    c.status = 'approved';
    c.userId = fd.id;
    const bankId = ds.finStatus.find((x) => x.companyId === c.companyId)!.banks[0].id;
    await expect(svc.financePayouts.prepare(fd, { source: 'staff_claim', sourceId: c.id, bankId })).rejects.toThrow(/own claim/);
    await svc.financePayouts.prepare(ceo, { source: 'staff_claim', sourceId: c.id, bankId });
    await expect(svc.recordPayout(fd, { source: 'staff_claim', sourceId: c.id, bankRef: 'CLM-1' })).rejects.toThrow();
  });
});

describe('B2: the close uses real records, not test figures', () => {
  it('no longer lists the seeded "billed" or payroll journal gaps', () => {
    const { ds } = fresh();
    const f = ds.finStatus.find((x) => x.companyId === T1)!;
    f.posting = { ...f.posting, period: '2026-10', billed: 5000, billedPosted: 0, staffPayPaid: true, staffPayPosted: false, guardPayPaid: true, guardPayPosted: false };
    const check = finCloseCheck(f, null, '2026-10', NOW, undefined, [], null, (x) => x);
    const keys = check.exceptions.map((e) => e.key);
    expect(keys).not.toContain('gap:billed');
    expect(keys).not.toContain('gap:staffpay');
    expect(keys).not.toContain('gap:guardpay');
  });

  it('lists each supplier bill received by the month end and not posted, from Procurement\'s records, and ignores the old typed count', async () => {
    const { ds, svc } = fresh();
    const f = ds.finStatus.find((x) => x.companyId === T1)!;
    f.posting = { ...f.posting, period: '2026-10', supplierBillsUnposted: 9 };
    ds.purRequests = ds.purRequests.filter((r) => r.companyId !== T1);
    const open = receivedSupplierBill(ds, T1, 1, myt('2026-10-20', '10:00'));
    receivedSupplierBill(ds, T1, 2, myt('2026-10-21', '10:00')).posted = { sqlRef: 'PI-TEST-2', by: 'Test Clerk', at: myt('2026-10-22', '10:00') };
    receivedSupplierBill(ds, T1, 3, myt('2026-11-02', '10:00'));
    const rejected = receivedSupplierBill(ds, T1, 4, myt('2026-10-05', '10:00'));
    rejected.status = 'rejected';
    receivedSupplierBill(ds, 'co-other-test', 5, myt('2026-10-05', '10:00'));
    const check = finCloseCheck(f, null, '2026-10', NOW, undefined, [], null, (x) => x, ds.purRequests);
    const lines = check.exceptions.filter((e) => e.key.startsWith('gap:supplier'));
    expect(lines.map((e) => e.key)).toEqual([`gap:supplier:${open.id}`]);
    expect(lines[0].text).toMatch(/INV-TEST-1 .*RM100\.00.*2026-10-20.*not posted in SQL Account/);
    // The Finance board counts the same real records (bills 1 and 3 are open today).
    const row = (await svc.finBoard(await svc.user('u-fd'))).rows.find((r) => r.status.companyId === T1)!;
    expect(row.status.posting.supplierBillsUnposted).toBe(2);
  });
});

describe('D3: the FD confirms the thresholds and sets budget limits', () => {
  it('reminds until confirmed; a change needs a new confirmation; a budget above the limit is the CEO\'s', async () => {
    const { svc, ds } = fresh();
    const [fd, lead] = await Promise.all(['u-fd', 'u-fin-t1-lead'].map((id) => svc.user(id)));
    expect((await svc.home(fd)).todo.some((t) => /Confirm the Finance limits/.test(t.title))).toBe(true);
    await expect(svc.finance.confirmSettings(lead, { comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.finance.confirmSettings(fd, { comment: 'Checked every value against our practice' });
    expect((await svc.finance.settingsView(fd)).confirmed).not.toBeNull();
    expect((await svc.home(fd)).todo.some((t) => /Confirm the Finance limits/.test(t.title))).toBe(false);
    await svc.finance.setSettings(fd, { values: { matchDays: 4 }, comment: 'Banks post a day later' });
    const row = ds.finStatus.find((x) => x.companyId === T1)!;
    expect(finSettingsConfirmedNow(row, await svc.finance.settings())).toBeNull();
    await expect(svc.finance.setBudgetLimit(lead, T1, { amount: 1000, comment: 'x' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.finance.setBudgetLimit(fd, T1, { amount: 1000, comment: 'Small office budget' });
    expect(ds.finStatus.find((x) => x.companyId === T1)!.budgetLimit?.amount).toBe(1000);
  });
});

describe('D4: SQL Account posting order', () => {
  it('copy book first, payment vouchers first, one company first', () => {
    const disc = { companyFile: 'ACC-PWVSB', copyBook: 'ACC-PWVSB-COPY', deployment: 'cloud', version: '5', modules: {}, partnerDoc: 'x', recorded: {}, confirmed: { by: 'FD' } } as never;
    const f = { companyId: 'pwvsb', sqlDiscovery: disc, sqlPosting: null };
    expect(sqlConfirmedBook(f)).toBe('ACC-PWVSB-COPY');
    expect(sqlConfirmedBook({ ...f, sqlPosting: { on: true, stage: 'live', docTypes: {}, changes: [] } })).toBe('ACC-PWVSB');
    expect(sqlSwitchOrderProblem({ ...f, sqlDiscovery: { ...(disc as object), copyBook: null } as never }, { on: true, stage: 'copy', docTypes: { GL_PV: true } }, [], [])).toMatch(/copy/);
    expect(sqlSwitchOrderProblem(f, { on: true, stage: 'copy', docTypes: { GL_PV: true } }, [], [])).toBeNull();
    expect(sqlSwitchOrderProblem(f, { on: true, stage: 'live', docTypes: { GL_PV: true } }, [], [])).toMatch(/copy book is read back/);
    const copyOk = [{ docType: 'GL_PV' as const, book: 'ACC-PWVSB-COPY', status: 'checked_ok' as const }];
    expect(sqlSwitchOrderProblem(f, { on: true, stage: 'live', docTypes: { GL_PV: true } }, copyOk, [])).toBeNull();
    expect(sqlSwitchOrderProblem(f, { on: true, stage: 'live', docTypes: { GL_PV: true, AR_PM: true } }, copyOk, [])).toMatch(/payment vouchers go first/);
    expect(sqlSwitchOrderProblem(f, { on: true, stage: 'copy', docTypes: { GL_PV: true } }, [], [{ companyId: 'co-sasa', on: true, proven: false }])).toMatch(/One company first/);
    expect(sqlSwitchOrderProblem(f, { on: true, stage: 'copy', docTypes: { GL_PV: true } }, [], [{ companyId: 'co-sasa', on: true, proven: true }])).toBeNull();
  });
});
