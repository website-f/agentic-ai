import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finApproverFor, generateDataset, myt, type FinStatus } from '../src';

// Finance Phase 2 (Fauzan, 31 Oct 2026): payment control with separation of duties, the month-end close with evidence
// and the Finance Director's approval, the bank and payment packs. Every approval needs a comment; the CEO has full
// authority but is still bound by separation of duties. Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const T1 = GROUP_EMPLOYER_ID; // PWVSB's own books sit with Team 1.
const input = (svc: PrimaService, ds: ReturnType<typeof generateDataset>, over: Record<string, unknown> = {}) => {
  const f = ds.finStatus.find((x) => x.companyId === T1)!;
  void svc;
  return {
    payeeId: 'payee-pwvsb-001', // Syarikat Bekalan Pejabat (mock), verified, account ending 1000
    purpose: 'UAT stationery',
    amount: 1_250.75,
    dueOn: '2026-11-15',
    bankId: f.banks[0].id,
    sqlRef: 'PI-UAT-0001',
    evidence: ['UAT invoice 1.pdf'],
    ...over,
  };
};

describe('payments by subject: the COO approves for the departments he monitors (Fauzan, 1 Nov 2026)', () => {
  it('routes COO subjects to the COO or the CEO, never the Finance Director or a team leader', async () => {
    expect(['operations', 'it', 'fwm', 'inventory', 'transport', 'goodwill'].map((x) => finApproverFor(x as never))).toEqual(Array(6).fill('coo'));
    const { svc, ds } = fresh();
    const [de, dep, lead, de2, fd, coo] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fin-t1-de2', 'u-fd', 'u-coo'].map((id) => svc.user(id)));
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { subject: 'marketing' }))).rejects.toThrow(/Subject must be/);
    const p = await svc.finance.createPayment(de, T1, input(svc, ds, { subject: 'it', sqlRef: 'PV-UAT-IT1' }));
    expect(p).toMatchObject({ subject: 'it', needs: 'coo' });
    // The COO does not act before Finance has reviewed it.
    expect((await svc.finance.cooDesk(coo)).payments.find((x) => x.id === p.id)!.may).toEqual([]);
    await expect(svc.finance.cooStep(coo, T1, p.id, 'approve', { comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'Matches the IT quotation.' });
    // Not the Finance Director, not a team leader.
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/COO or the CEO/);
    await expect(svc.finance.paymentStep(lead, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/COO or the CEO/);
    expect((await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.payments.find((x) => x.id === p.id)!.may).not.toContain('approve');
    // The COO is reminded on home, needs a comment, and approves through his own queue only.
    expect((await svc.home(coo)).todo.some((t) => /payment.* to approve/.test(t.title))).toBe(true);
    await expect(svc.finance.cooStep(coo, T1, p.id, 'approve', { comment: ' ' })).rejects.toThrow(/comment/);
    await expect(svc.finance.cooStep(coo, T1, p.id, 'release' as never, { bankRef: 'X-1' })).rejects.toThrow(/approves or returns/);
    const ok = await svc.finance.cooStep(coo, T1, p.id, 'approve', { comment: 'Needed for the IT pilot.' });
    expect(ok.status).toBe('approved');
    // Finance releases it; the COO has no Finance desk and cannot release.
    expect(() => svc.finance.actor(coo)).toThrow(AccessDenied);
    await expect(svc.finance.paymentStep(coo, T1, p.id, 'release', { bankRef: 'X-1' })).rejects.toBeInstanceOf(AccessDenied);
    const done = await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-UAT-IT1', accountLast4: '1000', accountName: 'Syarikat Bekalan Pejabat' });
    expect(done.steps.map((s) => [s.step, s.byId])).toEqual([
      ['prepared', 'u-fin-t1-de1'],
      ['reviewed', 'u-fin-t1-dep'],
      ['approved', 'u-coo'],
      ['released', 'u-fin-t1-de2'],
    ]);
  });

  it('the CEO may approve a COO subject; the COO never approves a Finance payment; others have no COO queue', async () => {
    const { svc, ds } = fresh();
    const [de, dep, ceo, coo, fd, it] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fauzan', 'u-coo', 'u-fd', 'u-it-mgr'].map((id) => svc.user(id)));
    const ops = await svc.finance.createPayment(de, T1, input(svc, ds, { subject: 'transport', sqlRef: 'PV-UAT-TR1' }));
    await svc.finance.paymentStep(dep, T1, ops.id, 'review', { comment: 'checked' });
    expect((await svc.finance.paymentStep(ceo, T1, ops.id, 'approve', { comment: 'Approved.' })).status).toBe('approved');
    const fin = await svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'PV-UAT-FIN1', amount: 999 }));
    await svc.finance.paymentStep(dep, T1, fin.id, 'review', { comment: 'checked' });
    expect((await svc.finance.cooDesk(coo)).payments.some((x) => x.id === fin.id)).toBe(false);
    await expect(svc.finance.cooStep(coo, T1, fin.id, 'approve', { comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    // A return needs a reason; the preparer can resubmit and it goes back to the COO.
    const ops2 = await svc.finance.createPayment(de, T1, input(svc, ds, { subject: 'fwm', sqlRef: 'PV-UAT-FW1', amount: 321 }));
    await svc.finance.paymentStep(dep, T1, ops2.id, 'review', { comment: 'checked' });
    await expect(svc.finance.cooStep(coo, T1, ops2.id, 'return', { comment: 'no' })).rejects.toThrow();
    expect((await svc.finance.cooStep(coo, T1, ops2.id, 'return', { comment: 'Attach the FWM approval memo.' })).status).toBe('returned');
    // Only the COO has a COO queue.
    for (const u of [fd, ceo, it, de]) await expect(svc.finance.cooDesk(u)).rejects.toBeInstanceOf(AccessDenied);
    expect(await svc.finance.cooHome(fd)).toEqual([]);
  });
});

describe('payments: one person never authorises and pays the same payment', () => {
  it('walks prepare, review, approve and release, each by a different person, with comments', async () => {
    const { svc, ds } = fresh();
    const [de, dep, lead, de2, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fin-t1-de2', 'u-fd'].map((id) => svc.user(id)));
    const p = await svc.finance.createPayment(de, T1, input(svc, ds));
    expect(p).toMatchObject({ status: 'prepared', needs: 'director' });
    // The preparer cannot review; data entry never reviews; a comment is needed.
    await expect(svc.finance.paymentStep(de, T1, p.id, 'review', { comment: 'ok' })).rejects.toThrow(/prepared/);
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'review', { comment: 'ok' })).rejects.toThrow(/deputy or the team leader/);
    await expect(svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: '  ' })).rejects.toThrow(/comment/);
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'Matches the invoice.' });
    // The reviewer cannot also approve, even where the role would allow it.
    await expect(svc.finance.paymentStep(dep, T1, p.id, 'approve', { comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    // Fauzan, 1 Nov 2026: only the Finance Director, the CEO (and the COO by subject) approve; a team leader never does.
    await expect(svc.finance.paymentStep(lead, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: '' })).rejects.toThrow(/comment/);
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    // The approver never releases it.
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'release', { bankRef: 'M2U-UAT-1' })).rejects.toThrow(/approved/);
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', {})).rejects.toThrow(/reference/);
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-UAT-1', releasedOn: '2026-11-02', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' })).rejects.toThrow(/future/);
    // Paid to the right person: the releaser types what the bank portal shows; a different account or name stops it.
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-UAT-1', accountLast4: '9999', accountName: 'SYARIKAT BEKALAN PEJABAT' })).rejects.toThrow(/Do not release/);
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-UAT-1', accountLast4: '1000', accountName: 'ALI BIN ABU' })).rejects.toThrow(/Do not release/);
    const done = await svc.finance.paymentStep(de2, T1, p.id, 'release', { bankRef: 'M2U-UAT-1', accountLast4: '1000', accountName: 'Syarikat Bekalan Pejabat' });
    expect(done).toMatchObject({ status: 'released', bankRef: 'M2U-UAT-1', releasedOn: TODAY });
    expect(done.steps.map((s) => [s.step, s.byId])).toEqual([
      ['prepared', 'u-fin-t1-de1'],
      ['reviewed', 'u-fin-t1-dep'],
      ['approved', 'u-fd'],
      ['released', 'u-fin-t1-de2'],
    ]);
    expect(ds.audit.filter((e) => e.action.startsWith('finance.payment.') && e.summary.includes(p.id)).length).toBe(4);
  });

  it('only the Finance Director or the CEO approves, at any amount (Fauzan, 1 Nov 2026)', async () => {
    expect([finApproverFor(), finApproverFor('finance')]).toEqual(['director', 'director']);
    const { svc, ds } = fresh();
    const [de, dep, lead, fd, ceo] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd', 'u-fauzan'].map((id) => svc.user(id)));
    const big = await svc.finance.createPayment(de, T1, input(svc, ds, { amount: 600_000, sqlRef: 'PV-UAT-BIG', }));
    expect(big.needs).toBe('director');
    await svc.finance.paymentStep(dep, T1, big.id, 'review', { comment: 'checked' });
    await expect(svc.finance.paymentStep(lead, T1, big.id, 'approve', { comment: 'ok' })).rejects.toThrow(/Finance Director or the CEO/);
    expect((await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.payments.find((p) => p.id === big.id)!.may).toContain('approve');
    const ok = await svc.finance.paymentStep(ceo, T1, big.id, 'approve', { comment: 'Approved, see board paper.' });
    expect(ok.status).toBe('approved');
    // The CEO approved it, so the CEO cannot record its release either.
    await expect(svc.finance.paymentStep(ceo, T1, big.id, 'release', { bankRef: 'M2U-UAT-9' })).rejects.toThrow(/approved/);
  });

  it('the CEO and Finance Director are bound by separation of duties on what they prepare', async () => {
    const { svc, ds } = fresh();
    const [ceo, fd, dep] = await Promise.all(['u-fauzan', 'u-fd', 'u-fin-t1-dep'].map((id) => svc.user(id)));
    const p = await svc.finance.createPayment(ceo, T1, input(svc, ds, { amount: 70_000, sqlRef: 'PV-UAT-CEO' }));
    await expect(svc.finance.paymentStep(ceo, T1, p.id, 'review', { comment: 'ok' })).rejects.toThrow(/prepared/);
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'checked' });
    await expect(svc.finance.paymentStep(ceo, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/prepared/);
    expect((await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' })).status).toBe('approved');
  });

  it('a return needs a reason and goes back to the preparer, who resubmits; a resubmission re-routes by amount', async () => {
    const { svc, ds } = fresh();
    const [de, de2, dep, lead] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fin-t1-lead'].map((id) => svc.user(id)));
    const p = await svc.finance.createPayment(de, T1, input(svc, ds));
    await expect(svc.finance.paymentStep(dep, T1, p.id, 'return', { comment: 'no' })).rejects.toThrow(/at least 10/);
    await svc.finance.paymentStep(dep, T1, p.id, 'return', { comment: 'Invoice amount differs from the PO.' });
    await expect(svc.finance.paymentStep(de2, T1, p.id, 'resubmit', {})).rejects.toBeInstanceOf(AccessDenied);
    const again = await svc.finance.paymentStep(de, T1, p.id, 'resubmit', { amount: 80_000 });
    expect(again).toMatchObject({ status: 'prepared', needs: 'director', amount: 80_000 });
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok now' });
    await expect(svc.finance.paymentStep(lead, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/Finance Director or the CEO/);
  });

  it('refuses duplicates, missing evidence, bank numbers and passwords', async () => {
    const { svc, ds } = fresh();
    const de = await svc.user('u-fin-t1-de1');
    await svc.finance.createPayment(de, T1, input(svc, ds));
    await expect(svc.finance.createPayment(de, T1, input(svc, ds))).rejects.toThrow(/duplicate/);
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'PI-other', amount: 1_250.75 }))).rejects.toThrow(/duplicate/);
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'X2', evidence: [] }))).rejects.toThrow(/supporting document/);
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'X3', purpose: 'Pay to account no 5140 1234 5678' }))).rejects.toThrow(/account number/);
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'X8', payeeId: 'payee-unknown' }))).rejects.toThrow(/payee list/);
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'X4', purpose: 'TAC is 123456' }))).rejects.toThrow(/password/);
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'X5', amount: 10.005 }))).rejects.toThrow(/2 decimal/);
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'X6', amount: -1 }))).rejects.toThrow(/more than/);
    await expect(svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'X7', bankId: 'fb-other' }))).rejects.toThrow(/bank accounts/);
  });

  it('keeps teams apart and keeps viewers, other departments and system feeds out', async () => {
    const { svc, ds } = fresh();
    const other = ds.finStatus.find((f) => f.team === 2)!;
    const de = await svc.user('u-fin-t1-de1');
    await expect(svc.finance.createPayment(de, other.companyId, input(svc, ds, { bankId: other.banks[0].id }))).rejects.toThrow(/not found/);
    for (const id of ['u-chair', 'u-vchair', 'u-audit'])
      await expect(svc.finance.createPayment(await svc.user(id), T1, input(svc, ds))).rejects.toBeInstanceOf(AccessDenied);
    for (const id of ['u-coo', 'u-it-mgr', 'u-cos'])
      await expect(svc.finance.desk(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    const feed = { ...(await svc.user('u-fd')), integration: true } as never;
    await expect(svc.finance.desk(feed)).rejects.toBeInstanceOf(AccessDenied);
    // The ACT head sees everything to audit it, but has no buttons.
    const act = await svc.finance.desk(await svc.user('u-audit'));
    expect(act.companies.length).toBeGreaterThan(30);
    expect(act.companies.every((c) => !c.canAct && c.payments.every((p) => p.may.length === 0))).toBe(true);
    // A team member sees only their team's companies.
    const mine = await svc.finance.desk(de);
    expect(mine.companies.every((c) => c.team === 1)).toBe(true);
  });

  it('puts the waiting payments on each person’s home', async () => {
    const { svc } = fresh();
    const titles = async (id: string) => (await svc.home(await svc.user(id))).todo.filter((t) => t.tag === 'Finance').map((t) => t.title);
    expect((await titles('u-fd')).some((t) => /payments? to approve/.test(t))).toBe(true);
    expect((await titles('u-fauzan')).some((t) => /payments? to approve/.test(t))).toBe(true);
    // Finance team members have no group home; their reminders come from the Finance desk.
    const desk = async (id: string) => (await svc.finance.home(await svc.user(id))).map((t) => t.title);
    expect((await desk('u-fin-t1-lead')).some((t) => /payments? to approve/.test(t))).toBe(false);
    expect((await desk('u-fin-t1-dep')).some((t) => /to review/.test(t))).toBe(true);
    expect((await desk('u-fin-t1-de1')).length).toBe(0);
    // The CEO is reminded only of large payments (RM500,000 or more), in Do today.
    expect((await desk('u-fauzan'))).toEqual([expect.stringMatching(/^1 payment to approve, RM650,000/)]);
    expect((await desk('u-chair')).length).toBe(0);
  });
});

/** Puts one company's books in order for the close month, as SQL Account would show them. */
function booksInOrder(f: FinStatus, period: string, end: string) {
  f.sqlLastAt = myt(TODAY, '08:00');
  f.closedTo = end;
  f.banks.forEach((b) => (b.reconciledTo = end));
  f.tests.forEach((t) => (t.diff = 0));
  f.posting = { ...f.posting, period, billedPosted: f.posting.billed, staffPayPosted: f.posting.staffPayPaid, guardPayPosted: f.posting.guardPayPaid, supplierBillsUnposted: 0 };
  // Part 2: the month's ageing recorded and reviewed, and each bank statement loaded (no payments out that month).
  const sign = (byId: string) => ({ by: byId, byId, at: myt(TODAY, '08:00'), comment: 'ok' });
  const zero = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 };
  f.ageing = [{ period, ar: zero, ap: zero, glAr: 0, glAp: 0, source: 'aging.pdf', note: '', prepared: sign('u-fin-t1-de1'), reviewed: sign('u-fin-t1-dep') }];
  if (f.einvoice?.setup?.required)
    f.einvoice.months = [
      {
        period, issued: 3, valid: 3, invalid: 0, submitting: 0, notSubmitted: 0, consolidatedNeeded: false, consolidated: null, largeInConsolidated: 0,
        selfBilledNeeded: 0, selfBilledValid: 0, suppliersWithout: 0, lateCancels: 0, source: 'myinvois.xlsx', note: '', prepared: sign('u-fin-t1-de1'), reviewed: sign('u-fin-t1-dep'),
      },
    ];
  f.arCases = []; // no stuck invoices this month
  f.statements = f.banks.map((b) => ({ id: `stmt-${b.id}-${period}`, bankId: b.id, period, opening: 0, closing: 0, lines: [], loaded: { ...sign('u-fin-t1-de1'), source: 'stmt.csv' } }));
}

describe('month-end close: evidence, exceptions, review and the Finance Director’s approval', () => {
  it('reconciles one complete period with evidence and separation of duties (the Phase 2 gate)', async () => {
    const { svc, ds } = fresh();
    const [de, dep, lead, fd, ceo] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd', 'u-fauzan'].map((id) => svc.user(id)));
    const F = () => ds.finStatus.find((x) => x.companyId === T1)!;
    booksInOrder(F(), '2026-09', '2026-09-30');
    F().posting.supplierBillsUnposted = 2;
    F().tests.find((t) => t.id === 'FS-07')!.diff = 120;
    // Not ready: no reconciliation reports attached and two exceptions unexplained.
    await expect(svc.finance.closeStep(de, T1, 'prepare')).rejects.toThrow(/Attach the SQL Account bank reconciliation report/);
    for (const b of F().banks) await svc.finance.closeStep(de, T1, 'evidence', { bankId: b.id, ref: `SharePoint/Finance/Bank rec ${b.id} Sep.pdf` });
    await expect(svc.finance.closeStep(de, T1, 'prepare')).rejects.toThrow(/Explain: 2 supplier bill/);
    await expect(svc.finance.closeStep(de, T1, 'explain', { key: 'gap:supplier', text: 'late' })).rejects.toThrow(/at least 10/);
    await svc.finance.closeStep(de, T1, 'explain', { key: 'gap:supplier', text: 'Bills arrived 3 Oct; posted in October.' });
    await svc.finance.closeStep(de, T1, 'explain', { key: 'test:FS-07', text: 'Unapplied receipt RM120, allocated 2 Oct.' });
    expect((await svc.finance.closeStep(de, T1, 'prepare')).status).toBe('prepared');
    // The preparer cannot review; review needs a comment.
    await expect(svc.finance.closeStep(de, T1, 'review', { comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.finance.closeStep(dep, T1, 'review', {})).rejects.toThrow(/comment/);
    await svc.finance.closeStep(dep, T1, 'review', { comment: 'Recs agree to statements.' });
    // Only the Finance Director or the CEO approves, and only with the bank pack reviewed.
    await expect(svc.finance.closeStep(lead, T1, 'approve', { comment: 'ok' })).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.finance.closeStep(fd, T1, 'approve', { comment: 'ok' })).rejects.toThrow(/bank pack item/);
    const desk = await svc.finance.desk(de);
    for (const i of desk.companies.find((c) => c.companyId === T1)!.bank) {
      await svc.setFinPack(de, T1, 'bank', i.id, 'prepared');
      await svc.setFinPack(dep, T1, 'bank', i.id, 'reviewed', 'Agrees to the statement.');
    }
    await expect(svc.finance.closeStep(fd, T1, 'approve', { comment: '' })).rejects.toThrow(/comment/);
    const approved = await svc.finance.closeStep(fd, T1, 'approve', { comment: 'Approved financials for September.' });
    expect(approved.status).toBe('approved');
    expect(ds.audit.some((e) => e.action === 'finance.close.approve' && /APPROVED FINANCIALS/.test(e.summary))).toBe(true);
    // Reopening needs a reason, by the Finance Director or the CEO.
    await expect(svc.finance.closeStep(lead, T1, 'reopen', { comment: 'Need to adjust accruals.' })).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.finance.closeStep(ceo, T1, 'reopen', { comment: 'Auditor adjustment to accruals.' })).status).toBe('open');
  });

  it('never approves while a bank account is unreconciled, SQL figures are stale or FS-01/02/06 are not RM0.00', async () => {
    const { svc, ds } = fresh();
    const de = await svc.user('u-fin-t1-de1');
    const F = () => ds.finStatus.find((x) => x.companyId === T1)!;
    booksInOrder(F(), '2026-09', '2026-09-30');
    for (const b of F().banks) await svc.finance.closeStep(de, T1, 'evidence', { bankId: b.id, ref: `rec ${b.id}.pdf` });
    F().banks[0].reconciledTo = '2026-08-31';
    await expect(svc.finance.closeStep(de, T1, 'prepare')).rejects.toThrow(/not reconciled to 2026-09-30/);
    F().banks[0].reconciledTo = '2026-09-30';
    F().tests.find((t) => t.id === 'FS-06')!.diff = 0.01;
    await expect(svc.finance.closeStep(de, T1, 'prepare')).rejects.toThrow(/FS-06.*RM0.00/);
    F().tests.find((t) => t.id === 'FS-06')!.diff = 0;
    F().sqlLastAt = myt('2026-10-28', '08:00');
    await expect(svc.finance.closeStep(de, T1, 'prepare')).rejects.toThrow(/Unknown/);
    await expect(svc.finance.closeStep(de, T1, 'prepare', { period: '2026-08' })).rejects.toThrow(/Only 2026-09/);
  });
});

describe('packs: bank and payment packs join the auditor and tax agent papers', () => {
  it('preparer never reviews or sends; review and send need a comment; the CEO may act as the Finance Director', async () => {
    const { svc, ds } = fresh();
    const [de, dep, lead, ceo] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fauzan'].map((id) => svc.user(id)));
    const desk = await svc.finance.desk(de);
    const pay = desk.companies.find((c) => c.companyId === T1)!.payment[0];
    expect(pay.label).toMatch(/Payment voucher listing/);
    await svc.setFinPack(lead, T1, 'payment', pay.id, 'prepared');
    await expect(svc.setFinPack(lead, T1, 'payment', pay.id, 'reviewed', 'ok')).rejects.toThrow(/prepared/);
    await expect(svc.setFinPack(dep, T1, 'payment', pay.id, 'reviewed')).rejects.toThrow(/comment/);
    await svc.setFinPack(dep, T1, 'payment', pay.id, 'reviewed', 'All vouchers have approvals.');
    const sent = await svc.setFinPack(ceo, T1, 'payment', pay.id, 'sent', 'Filed for the auditor.');
    expect(sent).toMatchObject({ status: 'sent', preparedById: 'u-fin-t1-lead', reviewedById: 'u-fin-t1-dep', comment: 'Filed for the auditor.' });
    expect(ds.finStatus.find((x) => x.companyId === T1)!.payment!.some((i) => i.id === pay.id && i.status === 'sent')).toBe(true);
  });
});

describe('Fauzan, 1 Nov 2026: approvals lapse after 30 days; the Finance Director sets the Finance settings', () => {
  it('an approval not released in time cannot be released and goes back for a fresh approval', async () => {
    const { svc, ds } = fresh();
    const [de, de2, dep, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd'].map((id) => svc.user(id)));
    const p = await svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'PV-UAT-EXP' }));
    await svc.finance.paymentStep(dep, T1, p.id, 'review', { comment: 'ok' });
    await svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' });
    // Thirty-one days later the approval has lapsed.
    const later = new PrimaService(new MemoryStore(ds), () => myt('2026-12-01', '10:00'));
    const [de2L, depL, deL] = await Promise.all(['u-fin-t1-de2', 'u-fin-t1-dep', 'u-fin-t1-de1'].map((id) => later.user(id)));
    // Automation (Fauzan, 1 Nov 2026: "2. Ok"): it goes back to the preparer by itself, nobody presses Return.
    const row = (await later.finance.desk(de2L)).companies.find((c) => c.companyId === T1)!.payments.find((x) => x.id === p.id)!;
    expect(row.status).toBe('returned');
    expect(row.steps.at(-1)).toMatchObject({ step: 'returned', byId: 'prima:auto', comment: expect.stringMatching(/lapsed on 2026-11-30/) });
    expect(row.may).not.toContain('release');
    await expect(later.finance.paymentStep(de2L, T1, p.id, 'release', { bankRef: 'M2U-X', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' })).rejects.toThrow(/lapsed on 2026-11-30.*back to the preparer/);
    await expect(later.finance.paymentStep(depL, T1, p.id, 'return', { comment: 'Approval lapsed, please re-approve.' })).rejects.toThrow(/back to the preparer/);
    expect((await later.finance.home(deL)).some((t) => /lapsed and came back to you/.test(t.title))).toBe(true);
    expect((await later.finance.paymentStep(deL, T1, p.id, 'resubmit', { comment: 'Still due.' })).status).toBe('prepared');
    // Saved and logged once, by Prima, the first time someone acted on the books.
    expect(ds.audit.filter((e) => e.action === 'finance.payment.lapsed' && e.summary.includes(p.id)).length).toBe(1);
    void de2;
  });

  it('only the FD or the CEO changes the settings, with a comment, inside limits, and the change takes effect and is kept', async () => {
    const { svc, ds } = fresh();
    const [lead, fd, ceo, de] = await Promise.all(['u-fin-t1-lead', 'u-fd', 'u-fauzan', 'u-fin-t1-de1'].map((id) => svc.user(id)));
    const v = await svc.finance.settingsView(de);
    expect(v).toMatchObject({ canSet: false, values: { approvalExpiryDays: 30, bankPackByDay: 10, sstThreshold: 500_000 } });
    await expect(svc.finance.setSettings(lead, { values: { approvalExpiryDays: 14 }, comment: 'x' })).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.finance.setSettings(fd, { values: { approvalExpiryDays: 14 } })).rejects.toThrow(/comment/);
    await expect(svc.finance.setSettings(fd, { values: { approvalExpiryDays: 400 }, comment: 'x' })).rejects.toThrow(/1 to 180/);
    await expect(svc.finance.setSettings(fd, { values: { bankPackByDay: 7.5 }, comment: 'x' })).rejects.toThrow(/whole number/);
    await expect(svc.finance.setSettings(fd, { values: { leaderMax: 1 }, comment: 'x' })).rejects.toThrow(/Unknown setting/);
    await svc.finance.setSettings(fd, { values: { approvalExpiryDays: 14, bankPackByDay: 7, selfBilledBy: 'Team leader of each company, checked by the FD' }, comment: 'Agreed at Finance meeting.' });
    await svc.finance.setSettings(ceo, { values: { sstThreshold: 500_000 }, comment: 'Confirmed with tax agent.' });
    const after = await svc.finance.settingsView(fd);
    expect(after.values).toMatchObject({ approvalExpiryDays: 14, bankPackByDay: 7, selfBilledBy: 'Team leader of each company, checked by the FD' });
    expect(after.history.length).toBe(1);
    expect(after.set!.byId).toBe('u-fauzan');
    // The bank pack for a new month is now due on the 7th.
    const desk = await svc.finance.desk(de);
    expect(desk.companies[0].bank[0].dueOn.slice(8)).toBe('07');
    expect(ds.audit.filter((e) => e.action === 'finance.settings.set').length).toBe(2);
    // Viewers and others outside Finance see nothing.
    await expect(svc.finance.settingsView(await svc.user('u-coo'))).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Fauzan, 1 Nov 2026: both approval ways exist; the FD or the CEO chooses Prima or Teams, never both', () => {
  it('stays in Prima while the Teams connection is off, and only the FD or the CEO changes it, with a comment', async () => {
    const { svc } = fresh();
    const [lead, fd, ceo, de] = await Promise.all(['u-fin-t1-lead', 'u-fd', 'u-fauzan', 'u-fin-t1-de1'].map((id) => svc.user(id)));
    expect(await svc.finance.settingsView(de)).toMatchObject({ teamsReady: false, values: { approvalMethod: 'prima' } });
    await expect(svc.finance.setSettings(fd, { values: { approvalMethod: 'teams' }, comment: 'Try Teams.' })).rejects.toThrow(/not switched on/);
    await expect(svc.finance.setSettings(ceo, { values: { approvalMethod: 'email' }, comment: 'x' })).rejects.toThrow(/'prima' or 'teams'/);
    svc.teamsApprovals = true;
    await expect(svc.finance.setSettings(lead, { values: { approvalMethod: 'teams' }, comment: 'x' })).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.finance.setSettings(fd, { values: { approvalMethod: 'teams' } })).rejects.toThrow(/comment/);
  });

  it('a Teams payment is never approved in Prima; a Prima payment keeps its way; switching the connection off goes back to Prima', async () => {
    const { svc, ds } = fresh();
    svc.teamsApprovals = true;
    const [de, dep, fd, ceo, coo] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd', 'u-fauzan', 'u-coo'].map((id) => svc.user(id)));
    const before = await svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'PV-UAT-M1' }));
    expect(before.approvalMethod).toBe('prima');
    await svc.finance.setSettings(ceo, { values: { approvalMethod: 'teams' }, comment: 'FD and CEO agreed to approve in Teams.' });
    const p = await svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'PV-UAT-M2', amount: 200 }));
    const it = await svc.finance.createPayment(de, T1, input(svc, ds, { sqlRef: 'PV-UAT-M3', amount: 300, subject: 'it' }));
    expect([p.approvalMethod, it.approvalMethod]).toEqual(['teams', 'teams']);
    for (const x of [before, p, it]) await svc.finance.paymentStep(dep, T1, x.id, 'review', { comment: 'Checked.' });
    // Teams payments: no Prima approve for the FD, the CEO or the COO; return is still open.
    const row = (await svc.finance.desk(fd)).companies.find((c) => c.companyId === T1)!.payments.find((x) => x.id === p.id)!;
    expect(row.may).not.toContain('approve');
    expect(row.may).toContain('return');
    await expect(svc.finance.paymentStep(fd, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/approved in Teams/);
    await expect(svc.finance.paymentStep(ceo, T1, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/approved in Teams/);
    await expect(svc.finance.cooStep(coo, T1, it.id, 'approve', { comment: 'ok' })).rejects.toThrow(/approved in Teams/);
    expect((await svc.finance.cooDesk(coo)).payments.find((x) => x.id === it.id)!.may).toEqual(['return']);
    // The payment prepared before the change is still approved in Prima, once.
    expect((await svc.finance.paymentStep(fd, T1, before.id, 'approve', { comment: 'Approved.' })).status).toBe('approved');
    // With the connection switched off, new and resubmitted payments go back to Prima even though the setting says Teams.
    const off = new PrimaService(new MemoryStore(ds), () => NOW);
    const [deO, fdO] = await Promise.all(['u-fin-t1-de1', 'u-fd'].map((id) => off.user(id)));
    await off.finance.paymentStep(fdO, T1, p.id, 'return', { comment: 'Teams is off, approve again in Prima.' });
    expect((await off.finance.paymentStep(deO, T1, p.id, 'resubmit', { comment: 'Again.' })).approvalMethod).toBe('prima');
    expect((await off.finance.createPayment(deO, T1, input(off, ds, { sqlRef: 'PV-UAT-M4', amount: 400 }))).approvalMethod).toBe('prima');
  });
});
