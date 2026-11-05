import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  accountProblem,
  branchActivationGaps,
  cash13Summary,
  generateDataset,
  treasuryView,
  myt,
  settlementTotals,
  type Dataset,
  type User,
} from '../src';

// Masterplan chapter 03 (Fauzan, 3 Nov 2026 "build all not build"): branch lifecycle and month ledger. Synthetic data.

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

/** The Finance team that keeps a company's books, and two of its members. */
function financeFor(ds: Dataset, companyId: string): [User, User] {
  const team = ds.finStatus.find((f) => f.companyId === companyId)!.team;
  const members = ds.users.filter((u) => u.department === 'finance' && u.financeTeam === team);
  const extra = ds.users.find((u) => u.leadership === 'finance_director')!;
  return [members[0], members[1] ?? extra];
}

/** A Sasa branch with a site under a live contract, ready for a prepared month. */
async function readyBranch() {
  const f = fresh();
  const { ds, svc } = f;
  const cm = await svc.user('u-cm-sasa');
  const ae = await svc.user('u-bm-sasa-1');
  const contract = ds.contracts.find((c) => c.companyId === 'co-sasa' && c.state === 'active' && ds.sites.some((s) => c.siteIds.includes(s.id) && s.branchId))!;
  const site = ds.sites.find((s) => contract.siteIds.includes(s.id) && s.branchId)!;
  const branch = ds.branches.find((b) => b.id === site.branchId)!;
  const [fin1, fin2] = financeFor(ds, 'co-sasa');
  await svc.setBranchProjectCode(fin1, branch.id, 'BR-SEL-01');
  return { ...f, cm, ae, fin1, fin2, branch, site };
}

const lines = (siteId: string, ref = 'IV-10001') => [
  { kind: 'billing', ref, siteId, amount: 100_000 },
  { kind: 'wages', ref: 'PAY-2026-09', amount: 70_000 },
  { kind: 'statutory', ref: 'EPF-2026-09', amount: 8_000 },
  { kind: 'management_fee', ref: 'JV-0931', amount: 2_000 },
];

/** A synthetic business case: 13 weeks of made-up money in and out. */
const caseInput = (dip = false) => ({
  sites: 4,
  guards: 40,
  monthlyBilling: 120_000,
  monthlyCosts: 104_000,
  startupCost: 30_000,
  openingCash: 100_000,
  fundingSource: 'Company cash (test)',
  assumptions: 'Two clients signed, two in tender; start 1 Dec (test figures)',
  cash13: Array.from({ length: 13 }, (_, i) => ({ week: i + 1, inflow: i < 4 ? 0 : 28_000, outflow: dip && i === 2 ? 60_000 : 24_000 })),
});

describe('Branch rules (masterplan 145, 148, 163-165)', () => {
  it('totals lines into billing and the three cost buckets, with credit notes reducing billing', () => {
    const t = settlementTotals([
      { kind: 'billing', ref: 'a', siteId: 's', amount: 100_000, note: '' },
      { kind: 'credit_note', ref: 'b', siteId: null, amount: -5_000, note: '' },
      { kind: 'wages', ref: 'c', siteId: null, amount: 60_000, note: '' },
      { kind: 'statutory', ref: 'd', siteId: null, amount: 7_000, note: '' },
      { kind: 'bad_debt', ref: 'e', siteId: null, amount: 1_000, note: '' },
      { kind: 'shared_cost', ref: 'f', siteId: null, amount: 2_000, note: '' },
    ]);
    expect(t.billing).toBe(95_000);
    expect(t.costs).toEqual({ wages: 60_000, statutory: 7_000, other: 3_000 });
  });

  it("accepts a branch bank account only in the company's own name and a partner account only with an SSM number", () => {
    const co = { name: 'Sasa Security Services Sdn Bhd' };
    expect(accountProblem('company_branch_bank', 'Ali bin Abu', null, co)).toMatch(/company's own name/);
    expect(accountProblem('company_branch_bank', 'sasa security services sdn bhd', null, co)).toBeNull();
    expect(accountProblem('partner_entity', 'Ali bin Abu', null, co)).toMatch(/SSM/);
    expect(accountProblem('partner_entity', 'Ali Ventures', '202401000123', co)).toBeNull();
  });

  it('lists every missing paper before a proposed branch can be activated', () => {
    const gaps = branchActivationGaps({ id: 'b', companyId: 'c', name: 'N', model: 'A', state: 'Johor', status: 'proposed' }, { name: 'Co' }, TODAY);
    expect(gaps.length).toBe(8);
    expect(gaps).toContain('No business case with a 13-week cash forecast');
  });
});

describe('Branch lifecycle (masterplan 145, 146.1, 157)', () => {
  it('proposes, records papers, verifies the account by another person and activates only when nothing is missing', async () => {
    const { ds, svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-bm-sasa-1');
    const [fin1] = financeFor(ds, 'co-sasa');
    await expect(svc.addBranch(ae, 'co-sasa', { name: 'Kuantan', state: 'Pahang', model: 'C' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addBranch(cm, 'co-arsh', { name: 'Kuantan', state: 'Pahang', model: 'C' })).rejects.toBeInstanceOf(AccessDenied);
    const b = await svc.addBranch(cm, 'co-sasa', { name: 'Kuantan', state: 'Pahang', model: 'C' });
    expect(b.status).toBe('proposed');
    await expect(svc.activateBranch(cm, b.id, 'Ready')).rejects.toThrow(/Not ready/);
    await svc.addBranchAgreement(cm, b.id, {
      effectiveFrom: '2026-11-01',
      model: 'C',
      managerName: 'Partner (mock)',
      managerKind: 'partner_company',
      pct: 55,
      managerSalary: null,
      signedRef: 'AGR/KTN/1',
    });
    await svc.setBranchSetup(ae, b.id, { kdnRef: 'KDN-TEST-1', premisesRef: 'MPK-TEST-1', insuranceRef: 'POL-TEST-1' });
    await expect(svc.setBranchSetup(ae, b.id, { legalEmployerConfirmed: true })).rejects.toBeInstanceOf(AccessDenied);
    await svc.setBranchSetup(cm, b.id, { legalEmployerConfirmed: true });
    await expect(svc.setBranchProjectCode(cm, b.id, 'BR-KTN')).rejects.toBeInstanceOf(AccessDenied);
    await svc.setBranchProjectCode(fin1, b.id, 'BR-KTN');
    const co = ds.companies.find((c) => c.id === 'co-sasa')!;
    await expect(
      svc.addBranchAccount(ae, b.id, { kind: 'company_branch_bank', holder: 'Partner (mock)', bank: 'Bank', last4: '1234', signatories: 'Two officers' }),
    ).rejects.toThrow(/own name/);
    await expect(
      svc.addBranchAccount(ae, b.id, { kind: 'company_branch_bank', holder: co.name, bank: 'Bank', last4: '123456', signatories: 'Two officers' }),
    ).rejects.toThrow(/last 4/);
    const acct = await svc.addBranchAccount(ae, b.id, { kind: 'company_branch_bank', holder: co.name, bank: 'Bank', last4: '1234', signatories: 'Two officers' });
    await expect(svc.verifyBranchAccount(ae, b.id, acct.id, 'letter')).rejects.toBeInstanceOf(AccessDenied);
    // The agreement starts in November, so on 26 Oct it is not yet in force.
    await svc.verifyBranchAccount(fin1, b.id, acct.id, 'Bank letter 2026-10-20');
    await expect(svc.activateBranch(cm, b.id, 'Ready')).rejects.toThrow(/agreement/);
    // A proposed branch does not originate leads.
    await expect(
      svc.addSalesLead(ae, 'co-sasa', { prospect: 'X', sector: 'OTHER', source: 'branch', guardsEst: 2, estMonthly: null, nextOn: null, nextWhat: '', branchId: b.id }),
    ).rejects.toThrow(/proposed/);
  });

  it('activates a fully papered branch, steps in with a reason and closes in order', async () => {
    const { ds, store, svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-bm-sasa-1');
    const [fin1] = financeFor(ds, 'co-sasa');
    const co = ds.companies.find((c) => c.id === 'co-sasa')!;
    const b = await svc.addBranch(cm, 'co-sasa', { name: 'Kuantan', state: 'Pahang', model: 'A' });
    await store.update('branches', b.id, {
      agreements: [
        {
          version: 1,
          effectiveFrom: '2026-10-01',
          model: 'A',
          managerName: 'Partner (mock)',
          managerKind: 'partner_company',
          companyBillingSharePct: 7.5,
          companyNetProfitSharePct: null,
          managerSalary: null,
          signedRef: 'AGR/KTN/1',
          by: 'test',
          at: NOW,
        },
      ],
    });
    await svc.setBranchSetup(ae, b.id, { kdnRef: 'KDN-TEST-1', premisesRef: 'MPK-TEST-1', insuranceRef: 'POL-TEST-1' });
    await svc.setBranchSetup(cm, b.id, { legalEmployerConfirmed: true });
    await svc.setBranchProjectCode(fin1, b.id, 'BR-KTN');
    const acct = await svc.addBranchAccount(ae, b.id, { kind: 'company_branch_bank', holder: co.name, bank: 'Bank', last4: '1234', signatories: 'Two officers' });
    await svc.verifyBranchAccount(fin1, b.id, acct.id, 'Bank letter');
    await expect(svc.activateBranch(cm, b.id, 'Ready')).rejects.toThrow(/business case/);
    await svc.setBranchBusinessCase(ae, b.id, caseInput());
    await expect(svc.activateBranch(cm, b.id, 'Ready')).rejects.toThrow(/reviewed by Finance/);
    await svc.reviewBranchBusinessCase(fin1, b.id, 'Figures agree to the tender schedule');
    await expect(svc.activateBranch(cm, b.id, '')).rejects.toThrow(/comment/);
    expect((await svc.activateBranch(cm, b.id, 'All papers checked')).status).toBe('active');
    expect((await svc.branchStepIn(cm, b.id, 'start', 'Client complaints unresolved')).status).toBe('step_in');
    expect((await svc.branchStepIn(cm, b.id, 'end', 'Issues fixed, handed back')).status).toBe('active');
    await expect(svc.branchTerminationStep(cm, b.id, 'clients_moved', 'x x x')).rejects.toThrow(/next step is notice_given/);
    for (const step of ['notice_given', 'clients_moved', 'guards_moved', 'assets_returned', 'final_settlement', 'closed'] as const)
      await svc.branchTerminationStep(cm, b.id, step, `Done: ${step}`);
    expect((await store.get('branches', b.id))!.status).toBe('closed');
    await expect(svc.setBranchSetup(ae, b.id, { kdnRef: 'x' })).rejects.toThrow(/closed/);
  });
});

describe('Branch month ledger (masterplan 163.1, 165.1, 167, 169, 149)', () => {
  it('prepares from SQL lines, then approve, Finance validate and a different Finance person records payment', async () => {
    const { svc, ae, cm, fin1, fin2, branch, site } = await readyBranch();
    const m = await svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'JA-PAY-2026-09', lines: lines(site.id) });
    expect(m.status).toBe('draft');
    expect(m.billing).toBe(100_000);
    expect(m.costs).toEqual({ wages: 70_000, statutory: 8_000, other: 2_000 });
    await expect(svc.approveBranchSettlement(cm, m.id, '')).rejects.toThrow(/comment/);
    const a = await svc.approveBranchSettlement(cm, m.id, 'Checked against the SQL project report');
    expect(a.status).toBe('approved');
    await expect(svc.validateBranchSettlement(ae, m.id, 'Agreed to SQL')).rejects.toThrow(/not found/i);
    const v = await svc.validateBranchSettlement(fin1, m.id, 'Agreed to SQL project BR-SEL-01');
    expect(v.status).toBe('validated');
    await expect(svc.recordBranchPayout(fin1, m.id, { bankRef: 'TT-1', note: 'Paid' })).rejects.toThrow(/another person/);
    const p = await svc.recordBranchPayout(fin2, m.id, { bankRef: 'TT-1', note: 'Paid to partner account' });
    expect(p.status).toBe('paid');
    expect(p.steps!.map((x) => x.what)).toEqual(['prepared', 'approved', 'validated', 'paid']);
  });

  it('returns with a reason, keeps history, and accepts the corrected resubmission', async () => {
    const { svc, ae, cm, fin1, branch, site } = await readyBranch();
    const m = await svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'JA-PAY-2026-09', lines: lines(site.id) });
    await expect(svc.returnBranchSettlement(cm, m.id, '')).rejects.toThrow(/correcting/);
    const r = await svc.returnBranchSettlement(cm, m.id, 'Wages do not match the payroll run');
    expect(r.status).toBe('returned');
    await expect(svc.approveBranchSettlement(cm, m.id, 'ok ok')).rejects.toThrow(/returned/);
    const fixed = lines(site.id).map((l) => (l.kind === 'wages' ? { ...l, amount: 69_500 } : l));
    const again = await svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'JA-PAY-2026-09', lines: fixed });
    expect(again.status).toBe('draft');
    expect(again.costs.wages).toBe(69_500);
    expect(again.steps!.map((x) => x.what)).toEqual(['prepared', 'returned', 'corrected']);
    await svc.approveBranchSettlement(cm, m.id, 'Corrected wages agree');
    // Finance may also send an approved month back.
    expect((await svc.returnBranchSettlement(fin1, m.id, 'Credit note missing from the month')).status).toBe('returned');
  });

  it('refuses unsigned work, double-claimed invoices, missing references and self-approval', async () => {
    const { ds, store, svc, ae, cm, branch, site } = await readyBranch();
    const other = ds.sites.find((s) => s.companyId === 'co-sasa' && s.branchId && s.branchId !== branch.id)!;
    await expect(svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'PAY', lines: lines(other.id) })).rejects.toThrow(/site of this branch/);
    await expect(
      svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'PAY', lines: [{ kind: 'wages', ref: 'PAY', amount: 1 }] }),
    ).rejects.toThrow(/billing line/);
    await expect(
      svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'PAY', lines: [{ kind: 'billing', ref: '', siteId: site.id, amount: 1 }] }),
    ).rejects.toThrow(/reference/);
    await expect(svc.prepareBranchSettlement(ae, branch.id, { period: '2026-10', payrollRef: 'PAY', lines: lines(site.id) })).rejects.toThrow(/finished month/);
    await expect(
      svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'PAY', lines: [...lines(site.id), { kind: 'billing', ref: 'iv-10001', siteId: site.id, amount: 5 }] }),
    ).rejects.toThrow(/twice/);
    await svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'PAY', lines: lines(site.id) });
    await expect(svc.prepareBranchSettlement(ae, branch.id, { period: '2026-08', payrollRef: 'PAY', lines: lines(site.id) })).rejects.toThrow(/already in 2026-09/);
    // A site whose contract is not signed yet is not billed to a branch.
    const c = ds.contracts.find((x) => x.siteIds.includes(site.id) && x.state === 'active')!;
    await store.update('contracts', c.id, { state: 'awarded' });
    await expect(svc.prepareBranchSettlement(ae, branch.id, { period: '2026-07', payrollRef: 'PAY', lines: lines(site.id, 'IV-7') })).rejects.toThrow(/signed contract/);
    await store.update('contracts', c.id, { state: 'active' });
    // The manager who prepares a month does not approve it.
    const own = await svc.prepareBranchSettlement(cm, branch.id, { period: '2026-07', payrollRef: 'PAY', lines: lines(site.id, 'IV-7') });
    await expect(svc.approveBranchSettlement(cm, own.id, 'Looks right')).rejects.toThrow(/another person/);
    // Another company's manager cannot touch it.
    await expect(svc.approveBranchSettlement(await svc.user('u-cm-inas'), own.id, 'ok ok')).rejects.toThrow(/not found/i);
  });

  it('needs the project code first and pays a partner only into a verified partner account', async () => {
    const { ds, store, svc, ae, cm, fin1, fin2, branch, site } = await readyBranch();
    const noCode = ds.branches.find((b) => b.companyId === 'co-sasa' && b.id !== branch.id)!;
    await expect(svc.prepareBranchSettlement(ae, noCode.id, { period: '2026-09', payrollRef: 'P', lines: [] })).rejects.toThrow(/project code/);
    const b = (await store.get('branches', branch.id))!;
    const ag = b.agreements!.at(-1)!;
    await store.update('branches', branch.id, { agreements: [{ ...ag, managerKind: 'partner_company' }] });
    const m = await svc.prepareBranchSettlement(ae, branch.id, { period: '2026-09', payrollRef: 'PAY', lines: lines(site.id) });
    await svc.approveBranchSettlement(cm, m.id, 'Checked');
    await svc.validateBranchSettlement(fin1, m.id, 'Agreed to SQL');
    await expect(svc.recordBranchPayout(fin2, m.id, { bankRef: 'TT-1', note: 'Paid' })).rejects.toThrow(/partner's own business account/);
  });
});

describe('Branch-originated leads (masterplan 147)', () => {
  it('records the branch and shows the same prospect worked by two branches', async () => {
    const { ds, svc } = fresh();
    const ae = await svc.user('u-bm-sasa-1');
    const cm = await svc.user('u-cm-sasa');
    const [b1, b2] = ds.branches.filter((b) => b.companyId === 'co-sasa');
    const base = { sector: 'COMMERCIAL' as const, source: 'branch', guardsEst: 4, estMonthly: null, nextOn: null, nextWhat: '' };
    const l1 = await svc.addSalesLead(ae, 'co-sasa', { ...base, prospect: 'Mock Mall Sdn Bhd', branchId: b1.id });
    expect(l1.branchId).toBe(b1.id);
    await svc.addSalesLead(ae, 'co-sasa', { ...base, prospect: 'Mock Mall Sdn. Bhd.', branchId: b2.id });
    await expect(svc.addSalesLead(ae, 'co-sasa', { ...base, prospect: 'Y', branchId: ds.branches.find((b) => b.companyId === 'co-arsh')!.id })).rejects.toThrow(
      /not in this company/,
    );
    const claims = await svc.branchLeadClaims(cm, 'co-sasa');
    expect(claims.clashes.find((c) => c.prospect.startsWith('Mock Mall'))!.leads.length).toBe(2);
    await expect(svc.branchLeadClaims(await svc.user('u-cm-inas'), 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Branch business case and treasury (masterplan 145, branch treasury)', () => {
  it('forecasts 13 weeks, needs a different Finance reviewer, and asks how a shortfall is covered', async () => {
    const { ds, svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-bm-sasa-1');
    const [fin1] = financeFor(ds, 'co-sasa');
    const b = await svc.addBranch(cm, 'co-sasa', { name: 'Temerloh', state: 'Pahang', model: 'C' });
    await expect(svc.setBranchBusinessCase(ae, b.id, { ...caseInput(), cash13: caseInput().cash13.slice(0, 12) })).rejects.toThrow(/13 weeks/);
    await expect(svc.setBranchBusinessCase(ae, b.id, { ...caseInput(), openingCash: 10.005 })).rejects.toThrow(/2 decimals/);
    await expect(svc.setBranchBusinessCase(fin1, b.id, caseInput())).rejects.toBeInstanceOf(AccessDenied);
    const other = await svc.user('u-cm-inas');
    await expect(svc.setBranchBusinessCase(other, b.id, caseInput())).rejects.toThrow(/not found/i);
    await svc.setBranchBusinessCase(ae, b.id, caseInput(true));
    const sum = cash13Summary({ openingCash: 100_000, cash13: caseInput(true).cash13 });
    expect(sum.firstShortWeek).toBe(3);
    await expect(svc.reviewBranchBusinessCase(ae, b.id, 'Looks fine to me')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.reviewBranchBusinessCase(fin1, b.id, 'Fine')).rejects.toThrow(/short from week 3/);
    await svc.reviewBranchBusinessCase(fin1, b.id, 'Week 3 covered by company cash top-up (test)');
    // A new version needs a fresh review; the old one stays as history.
    expect(cash13Summary({ openingCash: 100_000, cash13: caseInput().cash13 }).firstShortWeek).toBeNull();
    const v2 = await svc.setBranchBusinessCase(ae, b.id, caseInput());
    expect(v2.businessCases!.length).toBe(2);
    const row = (await svc.branchBoard(cm)).rows.find((r) => r.branch.id === b.id)!;
    expect(row.businessCase!.version).toBe(2);
    expect(row.activationGaps).toContain('Business case not yet reviewed by Finance');
    expect(row.treasury).toBeNull();
  });

  it('records treasury from the statement, shows Unknown when old, and flags payroll shortfall and float over limit', async () => {
    const { ds, svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-bm-sasa-1');
    const [fin1] = financeFor(ds, 'co-sasa');
    const branch = ds.branches.find((b) => b.companyId === 'co-sasa' && !b.status)!;
    let row = (await svc.branchBoard(cm)).rows.find((r) => r.branch.id === branch.id)!;
    expect(row.treasury!.state).toBe('unknown');
    await expect(
      svc.recordBranchTreasury(ae, branch.id, { on: TODAY, bankBalance: 1, statementRef: 'ST-1', floatHeld: 0, paymentsDue7d: 0 }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.recordBranchTreasury(fin1, branch.id, { on: '2026-10-27', bankBalance: 1, statementRef: 'ST-1', floatHeld: 0, paymentsDue7d: 0 }),
    ).rejects.toThrow(/today or earlier/);
    await expect(
      svc.recordBranchTreasury(fin1, branch.id, { on: TODAY, bankBalance: 1, statementRef: 'ST-1', floatHeld: 0, paymentsDue7d: 0, payrollDueOn: '2026-10-30', payrollDueAmount: 5 }),
    ).rejects.toThrow(/payroll run/);
    await expect(svc.setBranchFloatLimit(ae, branch.id, 2_000, 'Site petty cash')).rejects.toBeInstanceOf(AccessDenied);
    await svc.setBranchFloatLimit(cm, branch.id, 2_000, 'Site petty cash for four sites');
    const v = await svc.recordBranchTreasury(fin1, branch.id, {
      on: TODAY,
      bankBalance: 50_000,
      statementRef: 'ST-2026-10-26',
      floatHeld: 2_500,
      payrollDueOn: '2026-10-31',
      payrollDueAmount: 48_000,
      payrollRef: 'JA-PAY-OCT',
      paymentsDue7d: 4_000,
    });
    expect(v.state).toBe('attention');
    expect(v.flags.join(' ')).toMatch(/below what is due in 7 days \(RM52000\.00\)/);
    expect(v.flags.join(' ')).toMatch(/over the limit/);
    // Four days later with no new figure, the branch is Unknown, never fine.
    const later = treasuryView(v.recent, 2_000, '2026-10-30');
    expect(later.state).toBe('unknown');
    row = (await svc.branchBoard(cm)).rows.find((r) => r.branch.id === branch.id)!;
    expect(row.treasury!.latest!.statementRef).toBe('ST-2026-10-26');
  });
});
