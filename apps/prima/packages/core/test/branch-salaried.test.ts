import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, managerSalaryCheck, myt, purchaseCounts, settlementTotals, type Dataset, type User } from '../src';

// Model B: salaried Branch Manager (V12: company-run, salary only, never a profit share; every matter company-approved
// first). br-sasa-1 is the synthetic Model B branch (signed salary RM7,500, mock). Synthetic data only.

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const B = 'br-sasa-1';

function financeFor(ds: Dataset, companyId: string): [User, User] {
  const team = ds.finStatus.find((f) => f.companyId === companyId)!.team;
  const members = ds.users.filter((u) => u.department === 'finance' && u.financeTeam === team);
  return [members[0], members[1] ?? ds.users.find((u) => u.leadership === 'finance_director')!];
}

async function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const [fin1, fin2] = financeFor(ds, 'co-sasa');
  const contract = ds.contracts.find((c) => c.state === 'active' && ds.sites.some((s) => s.branchId === B && c.siteIds.includes(s.id)))!;
  const site = ds.sites.find((s) => s.branchId === B && contract.siteIds.includes(s.id))!;
  return {
    ds,
    store,
    svc,
    fin1,
    fin2,
    site,
    cm: await svc.user('u-cm-sasa'),
    bm: await svc.user('u-bm-sasa-1'),
    bmA: await svc.user('u-bm-sasa-2'),
    ceo: await svc.user('u-fauzan'),
    fd: await svc.user('u-fd'),
  };
}

/** Put the Branch Manager on the company's September staff pay run with a synthetic gross. */
async function managerOnRun(store: MemoryStore, gross: number) {
  const run = (await store.get('staffPayRuns', 'sp-co-sasa-2026-09'))!;
  const line = { ...run.lines[0], personId: 'pr-sasa-1-bm', name: 'Synthetic Branch Manager', gross, epfEr: 975, socsoEr: 40, eisEr: 15, hrd: 75 };
  await store.update('staffPayRuns', run.id, { lines: [...run.lines.filter((l) => l.personId !== line.personId), line] });
}

const req = (over: Record<string, unknown> = {}) => ({ supplier: 'Synthetic Radio Supplier', item: 'Radios x 6', kind: 'equipment', amount: 4_200, quoteRef: 'QT-SYN-1', ...over });

describe('Model B agreement', () => {
  it('needs a monthly salary; an employee or a partner company may be the manager; the CEO fee does not apply', async () => {
    const { svc, cm, ceo } = await fresh();
    const base = { effectiveFrom: '2026-11-01', model: 'B' as const, managerName: 'Synthetic Manager', managerKind: 'employee' as const, pct: null, signedRef: 'AGR/SYN/2' };
    await expect(svc.addBranchAgreement(cm, B, { ...base, managerSalary: null })).rejects.toThrow(/salary/);
    await expect(svc.addBranchAgreement(cm, B, { ...base, managerSalary: 7_500.005 })).rejects.toThrow(/salary/);
    // Fauzan, 5 Nov 2026: "Create also if partner company is the manager".
    const a = await svc.addBranchAgreement(cm, B, { ...base, managerKind: 'partner_company', managerSalary: 8_000 });
    expect([a.model, a.managerKind, a.managerSalary, a.companyBillingSharePct, a.companyNetProfitSharePct]).toEqual(['B', 'partner_company', 8_000, null, null]);
    await expect(svc.branchAct(ceo, B, 'fee', { effectiveFrom: '2026-12-01', pct: 10, reason: 'Group fee review' })).rejects.toThrow(/Model B/);
  });
});

describe('Model B purchases: company manager consents, then FD or CEO approves', () => {
  it('the branch asks with a quotation, the company manager consents, the FD approves, then the invoice is recorded', async () => {
    const { store, svc, cm, bm, bmA, fd } = await fresh();
    // No buying on its own, and requests are not for a JV branch.
    await expect(svc.branchAct(bm, B, 'purchase', { ...req(), on: '2026-10-20', invoiceRef: 'INV-1' })).rejects.toThrow(/Only a JV branch/);
    await expect(svc.branchAct(bmA, 'br-sasa-2', 'purchase_request', req())).rejects.toThrow(/Model B/);
    // Another branch's manager cannot reach it; arms go through Arms Control.
    await expect(svc.branchAct(bmA, B, 'purchase_request', req())).rejects.toThrow(/not found/i);
    await expect(svc.branchAct(bm, B, 'purchase_request', req({ item: 'Pistol holsters and ammunition' }))).rejects.toThrow(/Arms Control/);
    const p = await svc.branchAct(bm, B, 'purchase_request', req());
    expect(p.approval!.status).toBe('awaiting');
    expect(purchaseCounts(p)).toBe(false);
    // The Branch Manager cannot consent or approve; nobody buys before approval; the FD waits for the consent.
    await expect(svc.branchAct(bm, B, 'purchase_consent', { purchaseId: p.id, consent: true, note: 'ok ok' })).rejects.toThrow();
    await expect(svc.branchAct(bm, B, 'purchase_decide', { purchaseId: p.id, approve: true, note: 'ok ok' })).rejects.toThrow();
    await expect(svc.branchAct(bm, B, 'purchase_bought', { purchaseId: p.id, on: '2026-10-26', amount: 4_200, invoiceRef: 'INV-1' })).rejects.toThrow(/not consented/);
    await expect(svc.branchAct(fd, B, 'purchase_decide', { purchaseId: p.id, approve: true, note: 'Approved' })).rejects.toThrow(/not consented/);
    await expect(svc.branchAct(cm, B, 'purchase_consent', { purchaseId: p.id, consent: true, note: '' })).rejects.toThrow(/comment/);
    await svc.branchAct(cm, B, 'purchase_consent', { purchaseId: p.id, consent: true, note: 'Radios needed for the new night post' });
    // The company manager only consents; the approval is the FD's or the CEO's.
    await expect(svc.branchAct(cm, B, 'purchase_decide', { purchaseId: p.id, approve: true, note: 'Approved' })).rejects.toThrow(/Finance Director or CEO approves/);
    await expect(svc.branchAct(bm, B, 'purchase_bought', { purchaseId: p.id, on: '2026-10-26', amount: 4_200, invoiceRef: 'INV-1' })).rejects.toThrow(/not approved/);
    await svc.branchAct(fd, B, 'purchase_decide', { purchaseId: p.id, approve: true, note: 'Within the branch budget' });
    await expect(svc.branchAct(fd, B, 'purchase_decide', { purchaseId: p.id, approve: false, note: 'changed my mind' })).rejects.toThrow(/already approved/);
    // Never above the approved amount, never before the request date.
    await expect(svc.branchAct(bm, B, 'purchase_bought', { purchaseId: p.id, on: '2026-10-26', amount: 4_300, invoiceRef: 'INV-1' })).rejects.toThrow(/above the approved/);
    await expect(svc.branchAct(bm, B, 'purchase_bought', { purchaseId: p.id, on: '2026-10-01', amount: 4_200, invoiceRef: 'INV-1' })).rejects.toThrow(/request date/);
    const done = await svc.branchAct(bm, B, 'purchase_bought', { purchaseId: p.id, on: '2026-10-26', amount: 4_150, invoiceRef: 'INV-SYN-RADIO' });
    expect([done.approval!.status, done.amount, done.invoiceRef]).toEqual(['bought', 4_150, 'INV-SYN-RADIO']);
    expect(purchaseCounts(done)).toBe(true);
    const audit = (await store.list('audit', {})).map((a) => a.action);
    for (const x of ['branch.purchase.request', 'branch.purchase.consent', 'branch.purchase.approve', 'branch.purchase.bought']) expect(audit).toContain(x);
  });

  it('the person who asked never consents; a declined or refused request is never bought; the CEO may approve', async () => {
    const { svc, cm, bm, ceo, fd } = await fresh();
    const own = await svc.branchAct(cm, B, 'purchase_request', req({ quoteRef: 'QT-SYN-2' }));
    await expect(svc.branchAct(cm, B, 'purchase_consent', { purchaseId: own.id, consent: true, note: 'Needed' })).rejects.toThrow(/another person/);
    const p = await svc.branchAct(bm, B, 'purchase_request', req({ quoteRef: 'QT-SYN-3' }));
    await svc.branchAct(cm, B, 'purchase_consent', { purchaseId: p.id, consent: false, note: 'Use the spare radios at head office' });
    await expect(svc.branchAct(fd, B, 'purchase_decide', { purchaseId: p.id, approve: true, note: 'ok ok' })).rejects.toThrow(/refused/);
    await expect(svc.branchAct(bm, B, 'purchase_bought', { purchaseId: p.id, on: '2026-10-26', amount: 4_200, invoiceRef: 'INV-2' })).rejects.toThrow(/refused/);
    const q = await svc.branchAct(bm, B, 'purchase_request', req({ quoteRef: 'QT-SYN-4' }));
    await svc.branchAct(cm, B, 'purchase_consent', { purchaseId: q.id, consent: true, note: 'Needed for the new post' });
    await svc.branchAct(ceo, B, 'purchase_decide', { purchaseId: q.id, approve: false, note: 'Wait for the new client contract' });
    await expect(svc.branchAct(bm, B, 'purchase_bought', { purchaseId: q.id, on: '2026-10-26', amount: 4_200, invoiceRef: 'INV-3' })).rejects.toThrow(/refused/);
    const view = await svc.branchJv(cm, B);
    expect([view.salaried, view.canConsent, view.canDecide, view.canSetPay, view.canBuy, view.awaiting]).toEqual([true, true, false, false, false, 1]);
    expect((await svc.branchJv(fd, B)).canDecide).toBe(true);
    const bmView = await svc.branchJv(bm, B);
    expect([bmView.canRequest, bmView.canConsent, bmView.canDecide]).toEqual([true, false, false]);
    expect((await svc.branchBoard(cm)).rows.find((r) => r.branch.id === B)!.purchasesAwaiting).toBe(1);
  });
});

describe('Model B expenses: same steps as purchases', () => {
  it('an expense is requested, consented, approved by the FD or CEO and recorded with its receipt before it counts', async () => {
    const { store, svc, cm, bm, ceo } = await fresh();
    const exp = { category: 'expense', supplier: 'Synthetic Plumbing Works', item: 'Guard post toilet repair', kind: 'other', amount: 850, quoteRef: 'EST-SYN-1' };
    await expect(svc.branchAct(bm, B, 'purchase_request', { ...exp, category: 'gift' })).rejects.toThrow(/purchase or expense/);
    await expect(svc.branchAct(bm, 'br-sasa-2', 'purchase_request', exp)).rejects.toThrow();
    const e = await svc.branchAct(bm, B, 'purchase_request', exp);
    expect([e.category, e.approval!.status]).toEqual(['expense', 'awaiting']);
    await expect(svc.branchAct(ceo, B, 'purchase_decide', { purchaseId: e.id, approve: true, note: 'ok ok' })).rejects.toThrow(/not consented/);
    await expect(svc.branchAct(bm, B, 'purchase_bought', { purchaseId: e.id, on: '2026-10-26', amount: 850, invoiceRef: 'RCPT-1' })).rejects.toThrow(/not consented/);
    await svc.branchAct(cm, B, 'purchase_consent', { purchaseId: e.id, consent: true, note: 'Post toilet is broken' });
    await svc.branchAct(ceo, B, 'purchase_decide', { purchaseId: e.id, approve: true, note: 'Approved, within estimate' });
    await expect(svc.branchAct(bm, B, 'purchase_bought', { purchaseId: e.id, on: '2026-10-26', amount: 900, invoiceRef: 'RCPT-1' })).rejects.toThrow(/above the approved/);
    const paid = await svc.branchAct(bm, B, 'purchase_bought', { purchaseId: e.id, on: '2026-10-26', amount: 820, invoiceRef: 'RCPT-SYN-1' });
    expect([paid.category, paid.approval!.status, paid.amount]).toEqual(['expense', 'bought', 820]);
    const audit = (await store.list('audit', {})).filter((a) => a.entityId === B).map((a) => a.summary);
    expect(audit.some((x) => /asks to pay an expense, Guard post toilet repair/.test(x))).toBe(true);
    expect(audit.some((x) => /paid Guard post toilet repair to Synthetic Plumbing Works/.test(x))).toBe(true);
  });
});

describe('Model B month: salary through payroll, company keeps the result, nothing paid out', () => {
  it('carries the manager salary from payroll, approved purchases that were bought, and closes without a payout', async () => {
    const { store, svc, cm, bm, fin1, fin2, fd, site } = await fresh();
    await svc.setBranchProjectCode(fin1, B, 'BR-SYN-B1');
    // A purchase bought in September counts; one still waiting does not.
    const p = await svc.branchAct(bm, B, 'purchase_request', req({ quoteRef: 'QT-SYN-9' }));
    await svc.branchAct(cm, B, 'purchase_consent', { purchaseId: p.id, consent: true, note: 'Needed for the September post' });
    await svc.branchAct(fd, B, 'purchase_decide', { purchaseId: p.id, approve: true, note: 'Approved for the September post' });
    // Synthetic back-dating so the bought purchase falls in the finished month under test.
    const cur = (await store.get('branches', B))!;
    await store.update('branches', B, {
      purchases: cur.purchases!.map((x) => (x.id === p.id ? { ...x, approval: { ...x.approval!, requestedAt: '2026-09-02T09:00:00+08:00' } } : x)),
    });
    await svc.branchAct(bm, B, 'purchase_bought', { purchaseId: p.id, on: '2026-09-10', amount: 4_000, invoiceRef: 'INV-SYN-SEP' });
    await svc.branchAct(bm, B, 'purchase_request', req({ quoteRef: 'QT-SYN-10', amount: 999 }));
    const lines = [
      { kind: 'billing', ref: 'IV-SYN-B-09', siteId: site.id, amount: 100_000 },
      { kind: 'wages', ref: 'JA-PAY-2026-09', amount: 60_000 },
    ];
    const input = { period: '2026-09', payrollRef: 'JA-PAY-2026-09', lines };
    // The manager is not on the staff pay run yet: the month is incomplete without the salary.
    await expect(svc.prepareBranchSettlement(bm, B, input)).rejects.toThrow(/Branch Manager's salary/);
    // On the run, at a different amount from the signed RM7,500: a reason is needed.
    await managerOnRun(store, 7_000);
    await expect(svc.prepareBranchSettlement(bm, B, input)).rejects.toThrow(/differs from the signed salary/);
    const m = await svc.prepareBranchSettlement(bm, B, { ...input, salaryNote: 'Five days unpaid leave in September' });
    const mgr = m.lines!.filter((l) => l.kind === 'manager_salary');
    expect(mgr.map((l) => [l.ref, l.amount])).toEqual([['sp-co-sasa-2026-09-BM', 7_000]]);
    expect(m.lines!.some((l) => l.ref === 'sp-co-sasa-2026-09-BM-ER' && l.amount === 1_105)).toBe(true);
    // The manager's pay is not in the staff pay line too: never counted twice.
    const staff = m.lines!.find((l) => l.ref === 'sp-co-sasa-2026-09' && l.kind === 'wages')!;
    const run = (await store.get('staffPayRuns', 'sp-co-sasa-2026-09'))!;
    const officeIds = new Set(['pr-sasa-o1', 'pr-sasa-o2', 'pr-sasa-o3', 'pr-sasa-o4', 'pr-sasa-o5']);
    expect(staff.amount).toBeCloseTo(run.lines.filter((l) => officeIds.has(l.personId)).reduce((t, l) => t + l.gross, 0), 2);
    expect(m.lines!.some((l) => l.ref === 'INV-SYN-SEP' && l.amount === 4_000)).toBe(true);
    expect(m.lines!.some((l) => l.ref.startsWith('QT-'))).toBe(false);
    expect(m.managerSalary).toEqual({ signed: 7_500, paid: 7_000, note: 'Five days unpaid leave in September' });
    expect(m.costs.wages).toBe(settlementTotals(m.lines!).costs.wages);
    // The company manager approves; the company keeps the whole result and the manager has no share.
    const a = await svc.approveBranchSettlement(cm, m.id, 'Agrees to the SQL project report');
    expect(a.status).toBe('approved');
    const row = (await svc.branchBoard(cm)).rows.find((r) => r.branch.id === B)!;
    expect(row.split!.model).toBe('B');
    expect(row.split!.managerShare).toBe(0);
    expect(row.split!.companyShare).toBe(row.split!.net);
    await svc.validateBranchSettlement(fin1, m.id, 'Agreed to SQL project BR-SYN-B1');
    // The Finance Director determines and approves the payout (Fauzan, 5 Nov 2026); other Finance staff cannot.
    if (fin2.leadership !== 'finance_director') await expect(svc.recordBranchPayout(fin2, m.id, { bankRef: '', note: 'Closed', amount: 0 })).rejects.toThrow(/Finance Director/);
    await expect(svc.recordBranchPayout(fd, m.id, { bankRef: '', note: '', amount: 0 })).rejects.toThrow(/reason/);
    await expect(svc.recordBranchPayout(fd, m.id, { bankRef: '', note: 'Performance payout', amount: 500 })).rejects.toThrow(/bank reference/);
    const closed = await svc.recordBranchPayout(fd, m.id, { bankRef: '', note: 'Company keeps the September result', amount: 0 });
    expect([closed.status, closed.noPayout, closed.bankRef, closed.payout?.amount]).toEqual(['paid', true, null, 0]);
    expect(closed.steps!.at(-1)!.what).toMatch(/Finance Director, nothing paid out/);
    const audit = (await store.list('audit', {})).filter((x) => x.action === 'branch.closed' || x.action === 'branch.settlement');
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['branch.closed', 'branch.settlement']));
    expect(audit.find((x) => x.action === 'branch.settlement')!.summary).toMatch(/Model B\): company RM-?\d.*salary RM7000\.00 through payroll, no share/);
  });

  it('a hand-entered salary line replaces the payroll one; a salary line is refused on a Model A month', async () => {
    const { ds, store, svc, cm, bm, fin1, site } = await fresh();
    await svc.setBranchProjectCode(fin1, B, 'BR-SYN-B1');
    await managerOnRun(store, 7_500);
    const m = await svc.prepareBranchSettlement(cm, B, {
      period: '2026-09',
      payrollRef: 'PAY-SYN-09',
      lines: [
        { kind: 'billing', ref: 'IV-SYN-B-09', siteId: site.id, amount: 100_000 },
        { kind: 'manager_salary', ref: 'PAY-SYN-09-BM', amount: 7_500 },
      ],
    });
    expect(m.lines!.filter((l) => l.kind === 'manager_salary').map((l) => l.ref)).toEqual(['PAY-SYN-09-BM']);
    expect(m.lines!.some((l) => l.ref.endsWith('-BM-ER'))).toBe(false);
    expect(m.managerSalary).toEqual({ signed: 7_500, paid: 7_500, note: '' });
    expect(managerSalaryCheck(7_500, m.lines!).differs).toBe(false);
    void bm;
    // A Model A manager takes the rest of billing after costs, not a salary.
    const jvSite = ds.sites.find((s) => s.branchId === 'br-sasa-2' && ds.contracts.some((c) => c.state === 'active' && c.siteIds.includes(s.id)))!;
    await svc.setBranchProjectCode(fin1, 'br-sasa-2', 'BR-SYN-A2');
    await expect(
      svc.prepareBranchSettlement(cm, 'br-sasa-2', {
        period: '2026-09',
        payrollRef: 'PAY-SYN-09',
        lines: [
          { kind: 'billing', ref: 'IV-SYN-A-09', siteId: jvSite.id, amount: 50_000 },
          { kind: 'manager_salary', ref: 'PAY-SYN-09-BM2', amount: 5_000 },
        ],
      }),
    ).rejects.toThrow(/Model A manager/);
  });

  it('a partner company manager: its invoice is the salary line, and the FD pays it only into its verified account', async () => {
    const { store, svc, cm, bm, fin1, fd, site } = await fresh();
    await svc.setBranchProjectCode(fin1, B, 'BR-SYN-B1');
    const cur = (await store.get('branches', B))!;
    await store.update('branches', B, { agreements: cur.agreements!.map((a) => ({ ...a, managerKind: 'partner_company' as const })) });
    await managerOnRun(store, 7_500);
    const lines = [{ kind: 'billing', ref: 'IV-SYN-P-09', siteId: site.id, amount: 100_000 }];
    // Not on payroll: the payroll line is not used and the partner's invoice must be listed.
    await expect(svc.prepareBranchSettlement(bm, B, { period: '2026-09', payrollRef: 'PAY-SYN', lines })).rejects.toThrow(/partner's invoice/);
    const m = await svc.prepareBranchSettlement(bm, B, { period: '2026-09', payrollRef: 'PAY-SYN', lines: [...lines, { kind: 'manager_salary', ref: 'PARTNER-INV-09', amount: 7_500 }] });
    await svc.approveBranchSettlement(cm, m.id, 'Agrees to the partner invoice');
    await svc.validateBranchSettlement(fin1, m.id, 'Agreed to SQL');
    await expect(svc.recordBranchPayout(fd, m.id, { bankRef: 'TT-P-1', note: 'Partner fee for September', amount: 7_500 })).rejects.toThrow(/partner's own business account/);
    await store.update('branches', B, {
      accounts: [...((await store.get('branches', B))!.accounts ?? []), { id: 'acc-syn-p', kind: 'partner_entity', holder: 'Synthetic Partner Sdn Bhd', bank: 'Bank', last4: '9999', ssmRegNo: '202601000001', signatories: 'Director', addedBy: 'x', addedById: 'x', addedAt: NOW, verifiedBy: 'y', verifiedById: 'y', verifiedAt: NOW, verifyNote: 'ok', closedAt: null } as never],
    });
    const paid = await svc.recordBranchPayout(fd, m.id, { bankRef: 'TT-P-1', note: 'Partner fee for September', amount: 7_500 });
    expect([paid.status, paid.noPayout, paid.payout?.amount, paid.bankRef]).toEqual(['paid', false, 7_500, 'TT-P-1']);
  });
});

describe('Model C manager salary, set by the Finance Director', () => {
  it('only the FD sets it; then a Model C month carries it as a cost before the split', async () => {
    const { ds, store, svc, cm, ceo, fd, fin1 } = await fresh();
    const C = 'br-sasa-3';
    const input = { effectiveFrom: '2026-09-01', amount: 5_000, reason: 'Partner runs the branch full time' };
    for (const u of [cm, ceo, fin1]) await expect(svc.branchAct(u, C, 'manager_salary', input)).rejects.toThrow(/Finance Director/);
    await expect(svc.branchAct(fd, 'br-sasa-2', 'manager_salary', input)).rejects.toThrow(/Model A/);
    // The seed has settled earlier months; clear them so September is open (synthetic).
    for (const x of (await store.list('branchSettlements', { companyId: ['co-sasa'] })).filter((x) => x.branchId === C)) await store.update('branchSettlements', x.id, { status: 'draft' });
    const a = await svc.branchAct(fd, C, 'manager_salary', input);
    expect([a.model, a.managerSalary, a.companyNetProfitSharePct != null, a.fdSetting?.reason]).toEqual(['C', 5_000, true, 'Partner runs the branch full time']);
    const site = ds.sites.find((s) => s.branchId === C && ds.contracts.some((c) => c.state === 'active' && c.siteIds.includes(s.id)))!;
    await svc.setBranchProjectCode(fin1, C, 'BR-SYN-C3');
    const lines = [
      { kind: 'billing', ref: 'IV-SYN-C-09', siteId: site.id, amount: 100_000 },
      { kind: 'wages', ref: 'JA-SYN-09', amount: 50_000 },
    ];
    await expect(svc.prepareBranchSettlement(cm, C, { period: '2026-09', payrollRef: 'JA-SYN-09', lines })).rejects.toThrow(/salary/);
    const m = await svc.prepareBranchSettlement(cm, C, { period: '2026-09', payrollRef: 'JA-SYN-09', lines: [...lines, { kind: 'manager_salary', ref: 'PAY-SYN-C-BM', amount: 5_000 }] });
    expect(m.managerSalary).toEqual({ signed: 5_000, paid: 5_000, note: '' });
    expect(m.lines!.filter((l) => l.kind === 'manager_salary').length).toBe(1);
    const audit = (await store.list('audit', {})).map((x) => x.action);
    expect(audit).toContain('branch.salary.set');
  });
});

describe('Model B approval style, set by the Finance Director', () => {
  const style = {
    purchase: { consent: 'none', approver: 'company_manager', noApprovalUpTo: 500 },
    expense: { consent: 'company_manager', approver: 'ceo', noApprovalUpTo: 0 },
    payout: 'fd_or_ceo',
    reason: 'Routine branch spending sits with the company manager',
  };

  it('only the FD sets it, with a reason; a company manager approver needs no separate consent step', async () => {
    const { store, svc, cm, ceo, fd } = await fresh();
    for (const u of [cm, ceo]) await expect(svc.branchAct(u, B, 'approval_style', style)).rejects.toThrow(/Finance Director/);
    await expect(svc.branchAct(fd, B, 'approval_style', { ...style, reason: 'x' })).rejects.toThrow(/reason/);
    await expect(
      svc.branchAct(fd, B, 'approval_style', { ...style, purchase: { consent: 'company_manager', approver: 'company_manager', noApprovalUpTo: 0 } }),
    ).rejects.toThrow(/no separate consent/);
    await expect(svc.branchAct(fd, B, 'approval_style', { ...style, payout: 'cm' })).rejects.toThrow(/payout/);
    await expect(svc.branchAct(fd, B, 'approval_style', { ...style, expense: { ...style.expense, noApprovalUpTo: -1 } })).rejects.toThrow(/limit/);
    // A JV branch (Model A, br-sasa-2) buys under its agreement; no approval style there.
    await expect(svc.branchAct(fd, 'br-sasa-2', 'approval_style', style)).rejects.toThrow(/salaried branch/);
    await svc.branchAct(fd, B, 'approval_style', style);
    const b = (await store.get('branches', B))!;
    expect([b.approvalPolicy?.purchase.approver, b.approvalPolicy?.payout, b.approvalPolicyLog?.length]).toEqual(['company_manager', 'fd_or_ceo', 1]);
    expect((await store.list('audit', {})).some((a) => a.action === 'branch.approval.set')).toBe(true);
  });

  it('applies the style to new requests; requests already sent keep theirs; payout by FD or CEO', async () => {
    const { svc, cm, bm, ceo, fd } = await fresh();
    const req = (over: Record<string, unknown>) => ({ supplier: 'Synthetic Supplier', item: 'Torchlights', kind: 'equipment', amount: 300, quoteRef: `QT-${Math.random()}`, ...over });
    const before = await svc.branchAct(bm, B, 'purchase_request', req({ amount: 300 }));
    await svc.branchAct(fd, B, 'approval_style', style);
    // Under the limit: approved with nobody acting. Above it: no consent step, the company manager approves.
    const small = await svc.branchAct(bm, B, 'purchase_request', req({ amount: 300 }));
    expect(small.approval!.status).toBe('approved');
    const big = await svc.branchAct(bm, B, 'purchase_request', req({ amount: 1_000 }));
    expect(big.approval!.status).toBe('consented');
    await expect(svc.branchAct(fd, B, 'purchase_decide', { purchaseId: big.id, approve: true, note: 'ok ok' })).rejects.toThrow(/Company manager approves/);
    await svc.branchAct(cm, B, 'purchase_decide', { purchaseId: big.id, approve: true, note: 'Needed for the new post' });
    // Expenses: company manager consents, then only the CEO.
    const e = await svc.branchAct(bm, B, 'purchase_request', req({ category: 'expense', kind: 'other', item: 'Repairs', amount: 200 }));
    expect(e.approval!.status).toBe('awaiting');
    await svc.branchAct(cm, B, 'purchase_consent', { purchaseId: e.id, consent: true, note: 'Post repair needed' });
    expect((await svc.branchJv(fd, B)).actionFor[e.id]).toBeUndefined();
    expect((await svc.branchJv(ceo, B)).actionFor[e.id]).toBe('decide');
    await expect(svc.branchAct(fd, B, 'purchase_decide', { purchaseId: e.id, approve: true, note: 'ok ok' })).rejects.toThrow(/CEO approves/);
    await svc.branchAct(ceo, B, 'purchase_decide', { purchaseId: e.id, approve: true, note: 'Approved' });
    // The request sent before the setting keeps the old style: company manager consent, then FD or CEO.
    expect(before.approval!.status).toBe('awaiting');
    expect((await svc.branchJv(cm, B)).actionFor[before.id]).toBe('consent');
    // The CEO may now decide a payout.
    const row = (await svc.branchBoard(ceo)).rows.find((r) => r.branch.id === B)!;
    expect(row.canDecidePayout).toBe(true);
  });
});
