import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, fin3Compute, fin3Quarters, finOpenRevision, generateDataset, myt } from '../src';

// Budget revisions and three-statement forecasts (masterplan section 08, items 76 and 78; Fauzan, 3 Nov 2026: "proceed work";
// 1 Nov 2026: budget revisions are approved by the FD and the CEO). Dummy data only, never staging.
const TODAY = '2026-10-31'; // the last closed month is 2026-09
const NOW = myt(TODAY, '10:00');
const T1 = GROUP_EMPLOYER_ID;
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, F: () => ds.finStatus.find((x) => x.companyId === T1)! };
};
const who = (svc: PrimaService, ...ids: string[]) => Promise.all(ids.map((id) => svc.user(id)));
const months = (n: number) => Array(12).fill(n);

/** Reviewed SQL Account figures for September (mock): assets 350,000, liabilities 200,000, equity 150,000, cash 50,000. */
const reviewedSep = (bsCash = 50_000) => {
  const sig = { by: 'Mock reviewer', byId: 'u-mock', at: NOW, comment: 'ok' };
  return {
    period: '2026-09',
    origin: 'typed',
    syncId: null,
    source: 'SQL Account reports Sep 2026 (mock)',
    tb: { debit: 1, credit: 1 },
    bs: { assets: 350_000, liabilities: 200_000, equity: 150_000 },
    pl: { result: 0, reOpening: 0, reClosing: 0, dividends: 0, otherMovements: 0, otherNote: '' },
    cf: { opening: bsCash, operating: 0, investing: 0, financing: 0, fx: 0, closing: bsCash, bsCash, adjustment: 0, adjustmentNote: '' },
    fa: null,
    faNa: 'mock',
    stock: null,
    stockNa: 'mock',
    schedules: [],
    note: '',
    prepared: { ...sig, byId: 'u-mock-2' },
    reviewed: sig,
  } as never;
};

async function approvedBudget() {
  const env = fresh();
  const [de, dep, lead, fd, ceo] = await who(env.svc, 'u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd', 'u-fauzan');
  const plan = (u: typeof de, action: string, input: Record<string, unknown>) => env.svc.financeControls.planAction(u, T1, action, { year: 2026, ...input });
  await plan(dep, 'draft', { months: { revenue: months(100_000), guard_cost: months(70_000) }, assumptions: '120 guards at RM2,900; no new contracts' });
  await plan(dep, 'submit', {});
  await plan(fd, 'approve', { comment: 'Approved for 2026.' });
  return { ...env, de, dep, lead, fd, ceo, plan };
}

describe('Budget revisions: versioned, from an open month, approved by the FD or the CEO (either is enough)', () => {
  it('keeps the approved budget, applies the revision from its month once the FD or the CEO approves, never by its author', async () => {
    const { svc, de, dep, lead, fd, ceo, plan } = await approvedBudget();
    const rev = { fromMonth: '2026-11', months: { revenue: months(120_000) }, reason: 'Two new hospital contracts from November (mock).' };
    // Data entry does not draft; a closed month, no change or no reason is refused.
    await expect(plan(de, 'revise', rev)).rejects.toBeInstanceOf(AccessDenied);
    await expect(plan(lead, 'revise', { ...rev, fromMonth: '2026-09' })).rejects.toThrow(/has closed/);
    await expect(plan(lead, 'revise', { ...rev, months: { revenue: months(100_000) } })).rejects.toThrow(/Nothing differs/);
    await expect(plan(lead, 'revise', { ...rev, reason: 'more' })).rejects.toThrow(/Say why/);
    const r1 = (await plan(lead, 'revise', rev)) as { no: number; months: { revenue: number[] } };
    // Months before the revision keep the budget in force.
    expect(r1.months.revenue.slice(0, 10)).toEqual(months(100_000).slice(0, 10));
    expect(r1.months.revenue.slice(10)).toEqual([120_000, 120_000]);
    await plan(dep, 'submitRevision', {});
    // Authors never approve; the team leader and deputy are not approvers; a comment is needed.
    for (const u of [lead, dep]) await expect(plan(u, 'approveRevision', { no: 1, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(plan(fd, 'approveRevision', { no: 1, comment: ' ' })).rejects.toThrow(/comment/);
    let view = (await svc.financeControls.view(fd, T1)).plan;
    expect(view.inForce!.revenue![10]).toBe(100_000);
    // One approval, by the FD, is enough (Fauzan, 3 Nov 2026).
    const done = (await plan(fd, 'approveRevision', { no: 1, comment: 'New contracts signed.' })) as { status: string };
    expect(done.status).toBe('approved');
    await expect(plan(ceo, 'approveRevision', { no: 1, comment: 'again' })).rejects.toThrow(/not waiting/);
    view = (await svc.financeControls.view(fd, T1)).plan;
    expect(view.plan!.budget.months.revenue![10]).toBe(100_000); // the approved budget itself is never changed
    expect(view.inForce!.revenue![10]).toBe(120_000);
    expect(view.inForce!.revenue![9]).toBe(100_000);
    expect(view.months[10].rows.find((r) => r.line === 'revenue')!.budget).toBe(120_000);
    expect(view.revisions).toHaveLength(1);
  });

  it('lets the FD draft and the CEO approve, but never the drafter; a return needs a reason and the revision is redrafted', async () => {
    const { lead, fd, ceo, plan } = await approvedBudget();
    await plan(fd, 'revise', { fromMonth: '2026-12', months: { guard_cost: months(75_000) }, reason: 'Minimum wage change in December (mock).' });
    await plan(fd, 'submitRevision', {});
    await expect(plan(fd, 'revise', { fromMonth: '2026-12', months: { guard_cost: months(77_000) }, reason: 'Another change (mock).' })).rejects.toThrow(
      /waiting for approval/,
    );
    await expect(plan(fd, 'approveRevision', { no: 1, comment: 'mine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(plan(ceo, 'returnRevision', { no: 1, comment: 'no' })).rejects.toThrow(/Say why/);
    const back = (await plan(ceo, 'returnRevision', { no: 1, comment: 'Wait for the gazette before revising.' })) as { status: string };
    expect(back.status).toBe('returned');
    await expect(plan(fd, 'submitRevision', {})).rejects.toThrow(/Change the returned revision/);
    await plan(lead, 'revise', { fromMonth: '2026-12', months: { guard_cost: months(75_500) }, reason: 'Gazetted rate used (mock data).' });
    await plan(lead, 'submitRevision', {});
    // The FD helped draft it, so the CEO approves.
    await expect(plan(fd, 'approveRevision', { no: 1, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    expect(((await plan(ceo, 'approveRevision', { no: 1, comment: 'Gazetted rate.' })) as { status: string }).status).toBe('approved');
  });
});

describe('Three-statement forecasts: P&L, balance sheet and cash flow linked, reviewed and approved', () => {
  const opening = {
    cash: 50_000,
    receivables: 200_000,
    inventory: 10_000,
    fixedAssets: 90_000,
    otherAssets: 0,
    payables: 60_000,
    borrowings: 100_000,
    otherLiabilities: 40_000,
    equity: 150_000,
  };
  const q = (over: Record<string, number> = {}) => ({
    revenue: 300_000,
    operatingCosts: 260_000,
    depreciation: 6_000,
    financeCost: 2_000,
    tax: 7_000,
    capex: 12_000,
    disposals: 0,
    receivables: 220_000,
    inventory: 10_000,
    otherAssets: 0,
    payables: 65_000,
    otherLiabilities: 40_000,
    borrowingsIn: 0,
    borrowingsRepaid: 9_000,
    dividends: 0,
    equityIn: 0,
    ...over,
  });

  it('works out the cash flow from the profit and the balance sheet movements, and the closing cash ties', () => {
    const r = fin3Compute({ asOf: '2026-09', opening, periods: [q(), q({ receivables: 210_000 })] });
    expect(fin3Quarters('2026-09', 2)).toEqual(['2026-12', '2027-03']);
    expect(r.problems).toEqual([]);
    const [a] = r.rows;
    expect(a.pl.profit).toBe(25_000); // 300,000 - 260,000 - 6,000 - 2,000 - 7,000
    expect(a.cf.operating).toBe(25_000 + 6_000 - 20_000 + 5_000); // profit + depreciation - more receivables + more payables
    expect(a.cf.investing).toBe(-12_000);
    expect(a.cf.financing).toBe(-9_000);
    expect(a.bs.cash).toBe(50_000 + 16_000 - 12_000 - 9_000);
    expect(a.bs.fixedAssets).toBe(96_000);
    expect(a.bs.borrowings).toBe(91_000);
    expect(a.bs.equity).toBe(175_000);
    expect(a.bs.difference).toBe(0);
    expect(r.rows[1].cf.opening).toBe(a.bs.cash);
    // An opening that does not balance, too much depreciation or over-repaid loans are refused; a shortfall is shown.
    expect(fin3Compute({ asOf: '2026-09', opening: { ...opening, equity: 149_000 }, periods: [q()] }).problems[0]).toMatch(/does not balance/);
    expect(fin3Compute({ asOf: '2026-09', opening, periods: [q({ depreciation: 200_000 })] }).problems.join(' ')).toMatch(/more than the fixed assets/);
    expect(fin3Compute({ asOf: '2026-09', opening, periods: [q({ borrowingsRepaid: 200_000 })] }).problems.join(' ')).toMatch(/more borrowings repaid/);
    expect(fin3Compute({ asOf: '2026-09', opening, periods: [q({ receivables: 400_000 })] }).shortfalls).toEqual(['2026-12']);
  });

  it('is prepared by Finance, approved by the FD or the CEO (not the preparer), versioned, and ties to the reviewed SQL figures', async () => {
    const { svc, F, de, dep, lead, fd, ceo, plan } = await approvedBudget();
    F().ledgerFigures = [];
    const fc = {
      kind: 'quarterly',
      asOf: '2026-09',
      scenario: 'base',
      assumptions: '120 guards, collections 75 days, one vehicle bought (mock)',
      openingSource: 'SQL Account balance sheet Sep 2026 (mock).pdf',
      opening,
      periods: [q(), q()],
    };
    await expect(plan(de, 'fc3Save', fc)).rejects.toBeInstanceOf(AccessDenied);
    await expect(plan(dep, 'fc3Save', { ...fc, asOf: '2026-08' })).rejects.toThrow(/quarter end/);
    await expect(plan(dep, 'fc3Save', { ...fc, asOf: '2026-12' })).rejects.toThrow(/closed/);
    await expect(plan(dep, 'fc3Save', { ...fc, scenario: 'best' })).rejects.toThrow(/scenario/);
    // A draft with an unbalanced opening is saved but cannot be sent.
    const bad = (await plan(dep, 'fc3Save', { ...fc, opening: { ...opening, equity: 1 } })) as { id: string; computed: { problems: string[] } };
    expect(bad.computed.problems.length).toBeGreaterThan(0);
    await expect(plan(dep, 'fc3Submit', { id: bad.id })).rejects.toThrow(/Fix the checks/);
    const v1 = (await plan(dep, 'fc3Save', fc)) as { id: string; version: number };
    expect(v1).toMatchObject({ id: bad.id, version: 1 });
    await plan(lead, 'fc3Submit', { id: v1.id });
    for (const u of [dep, lead]) await expect(plan(u, 'fc3Approve', { id: v1.id, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(plan(fd, 'fc3Approve', { id: v1.id, comment: ' ' })).rejects.toThrow(/comment/);
    expect(((await plan(fd, 'fc3Approve', { id: v1.id, comment: 'Base case agreed.' })) as { status: string }).status).toBe('approved');
    // A new version for the same start and scenario; approving it supersedes the first.
    const v2 = (await plan(lead, 'fc3Save', { ...fc, periods: [q({ revenue: 310_000 }), q()] })) as { id: string; version: number };
    expect(v2.version).toBe(2);
    await plan(lead, 'fc3Submit', { id: v2.id });
    await expect(plan(ceo, 'fc3Return', { id: v2.id, comment: 'x' })).rejects.toThrow(/Say why/);
    await plan(ceo, 'fc3Approve', { id: v2.id, comment: 'Revenue uplift agreed.' });
    let view = (await svc.financeControls.view(fd, T1)).plan;
    expect(view.threeStatements.map((x) => [x.version, x.status])).toEqual([
      [2, 'approved'],
      [1, 'superseded'],
    ]);
    // Once reviewed SQL Account figures exist for the opening month, the opening must agree to them.
    F().ledgerFigures = [reviewedSep()];
    const down = (await plan(dep, 'fc3Save', { ...fc, scenario: 'downside', opening: { ...opening, cash: 40_000, equity: 140_000 } })) as {
      id: string;
      computed: { problems: string[] };
    };
    expect(down.computed.problems.join(' ')).toMatch(/reviewed SQL Account balance sheet/);
    await expect(plan(dep, 'fc3Submit', { id: down.id })).rejects.toThrow(/reviewed SQL Account/);
    await plan(dep, 'fc3Save', { ...fc, scenario: 'downside', periods: [q({ revenue: 280_000 }), q({ revenue: 270_000 })] });
    await plan(dep, 'fc3Submit', { id: down.id });
    await plan(fd, 'fc3Approve', { id: down.id, comment: 'Downside agreed.' });
    view = (await svc.financeControls.view(fd, T1)).plan;
    const d = view.threeStatements.find((x) => x.id === down.id)!;
    expect(d.computed.ledger).toMatchObject({ period: '2026-09', cash: 50_000, differences: { cash: 0, assets: 0, liabilities: 0, equity: 0 } });
  });
  it('ties the opening cash to the reviewed SQL Account cash, not only the totals, at sending and at approval (Arisha main, 3 Nov 2026)', async () => {
    const { F, dep, lead, fd, plan } = await approvedBudget();
    // Reviewed cash RM50,000; entered RM60,000 with RM10,000 taken off fixed assets, so every total still agrees.
    F().ledgerFigures = [reviewedSep(50_000)];
    const shifted = { ...opening, cash: 60_000, fixedAssets: 80_000 };
    const fc = {
      kind: 'quarterly',
      asOf: '2026-09',
      scenario: 'base',
      assumptions: 'Large supplier payment in Q4 (mock data)',
      openingSource: 'SQL Account balance sheet Sep 2026 (mock).pdf',
      opening: shifted,
      periods: [
        q({
          operatingCosts: 315_000,
          receivables: 200_000,
          payables: 60_000,
          capex: 0,
          borrowingsRepaid: 0,
          tax: 0,
          depreciation: 0,
          financeCost: 0,
          revenue: 260_000,
        }),
      ],
    };
    const saved = (await plan(dep, 'fc3Save', fc)) as { id: string; computed: { problems: string[]; rows: { bs: { cash: number } }[] } };
    // A RM55,000 outflow would show RM5,000 left; the reviewed baseline means minus RM5,000. It is refused.
    expect(saved.computed.rows[0].bs.cash).toBe(5_000);
    expect(saved.computed.problems.join(' ')).toMatch(/opening cash RM60000.00 does not agree .*RM50000.00/);
    await expect(plan(lead, 'fc3Submit', { id: saved.id })).rejects.toThrow(/opening cash/);
    // Sent before the reviewed figures arrived, it still cannot be approved once they show a different cash.
    F().ledgerFigures = [];
    await plan(lead, 'fc3Submit', { id: saved.id });
    F().ledgerFigures = [reviewedSep(50_000)];
    await expect(plan(fd, 'fc3Approve', { id: saved.id, comment: 'ok' })).rejects.toThrow(/opening cash/);
    await plan(fd, 'fc3Return', { id: saved.id, comment: 'Use the reviewed September cash.' });
    const fixed = (await plan(dep, 'fc3Save', { ...fc, opening })) as {
      computed: { problems: string[]; shortfalls: string[]; rows: { bs: { cash: number } }[] };
    };
    expect(fixed.computed.problems).toEqual([]);
    expect(fixed.computed.rows[0].bs.cash).toBe(-5_000);
    expect(fixed.computed.shortfalls).toEqual(['2026-12']);
  });
});

describe('No two-author deadlock: the FD and the CEO never both write one record (Arisha main, 3 Nov 2026)', () => {
  it('refuses the second approver as co-author of a revision, keeps it approvable, and lets an author withdraw a stuck one', async () => {
    const { F, dep, lead, fd, ceo, plan } = await approvedBudget();
    const rev = { fromMonth: '2026-12', months: { revenue: months(110_000) }, reason: 'New contract from December (mock data).' };
    // Her case: the FD drafts, then the CEO edits before it is sent. Refused, so the CEO can still approve it.
    await plan(fd, 'revise', rev);
    await expect(plan(ceo, 'revise', { ...rev, months: { revenue: months(115_000) } })).rejects.toThrow(
      /neither the Finance Director nor the CEO could approve/,
    );
    await expect(plan(ceo, 'submitRevision', {})).rejects.toThrow(/already wrote this revision/);
    await plan(lead, 'submitRevision', {});
    expect(((await plan(ceo, 'approveRevision', { no: 1, comment: 'Agreed (mock).' })) as { status: string }).status).toBe('approved');
    // Recovery for a revision written by both before this rule: neither can approve, an author withdraws it with a reason.
    await plan(dep, 'revise', { ...rev, months: { revenue: months(120_000) } });
    await plan(dep, 'submitRevision', {});
    const stuck = F()
      .plans!.find((x) => x.year === 2026)!
      .revisions!.find((x) => x.no === 2)!;
    stuck.authorIds.push(fd.id, ceo.id);
    stuck.leadAuthors = undefined;
    for (const u of [fd, ceo]) await expect(plan(u, 'approveRevision', { no: 2, comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(plan(lead, 'withdrawRevision', { no: 2, comment: 'Not mine to withdraw' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(plan(fd, 'withdrawRevision', { no: 2, comment: 'no' })).rejects.toThrow(/Say why/);
    const gone = (await plan(fd, 'withdrawRevision', { no: 2, comment: 'Written by both of us; redrafting.' })) as { status: string };
    expect(gone.status).toBe('withdrawn');
    await expect(plan(fd, 'approveRevision', { no: 2, comment: 'ok' })).rejects.toThrow(/not waiting/);
    const fresh3 = (await plan(lead, 'revise', { ...rev, months: { revenue: months(125_000) } })) as { no: number };
    expect(fresh3.no).toBe(3);
    await plan(lead, 'submitRevision', {});
    expect(((await plan(fd, 'approveRevision', { no: 3, comment: 'Agreed (mock).' })) as { status: string }).status).toBe('approved');
  });

  it('applies the same rule to the yearly budget and to three-statement forecasts', async () => {
    const env = fresh();
    const [lead, fd, ceo] = await who(env.svc, 'u-fin-t1-lead', 'u-fd', 'u-fauzan');
    const plan = (u: typeof fd, action: string, input: Record<string, unknown>) => env.svc.financeControls.planAction(u, T1, action, { year: 2026, ...input });
    await plan(fd, 'draft', { months: { revenue: months(100_000) }, assumptions: 'Drafted by the FD (mock data)' });
    await expect(plan(ceo, 'draft', { months: { revenue: months(90_000) }, assumptions: 'Changed by the CEO (mock data)' })).rejects.toThrow(
      /already wrote this budget/,
    );
    await expect(plan(ceo, 'submit', {})).rejects.toThrow(/already wrote this budget/);
    await plan(lead, 'submit', {});
    await plan(ceo, 'approve', { comment: 'Approved (mock).' });
    const opening = {
      cash: 50_000,
      receivables: 200_000,
      inventory: 10_000,
      fixedAssets: 90_000,
      otherAssets: 0,
      payables: 60_000,
      borrowings: 100_000,
      otherLiabilities: 40_000,
      equity: 150_000,
    };
    const fc = {
      kind: 'quarterly',
      asOf: '2026-09',
      scenario: 'base',
      assumptions: 'Forecast by the CEO (mock data)',
      openingSource: 'SQL Account Sep (mock)',
      opening,
      periods: [{ revenue: 1 }],
    };
    const x = (await plan(ceo, 'fc3Save', fc)) as { id: string };
    await expect(plan(fd, 'fc3Save', fc)).rejects.toThrow(/already wrote this forecast/);
    await expect(plan(fd, 'fc3Submit', { id: x.id })).rejects.toThrow(/already wrote this forecast/);
    await plan(lead, 'fc3Submit', { id: x.id });
    expect(((await plan(fd, 'fc3Approve', { id: x.id, comment: 'Agreed (mock).' })) as { status: string }).status).toBe('approved');
    // An author withdraws a forecast not yet approved.
    const y = (await plan(lead, 'fc3Save', { ...fc, scenario: 'downside' })) as { id: string };
    await expect(plan(fd, 'fc3Withdraw', { id: y.id, comment: 'Not mine to withdraw' })).rejects.toBeInstanceOf(AccessDenied);
    expect(((await plan(lead, 'fc3Withdraw', { id: y.id, comment: 'Wrong scenario figures.' })) as { status: string }).status).toBe('withdrawn');
  });
});

describe('the open revision (screen and server share one rule)', () => {
  it('skips withdrawn, superseded and approved revisions, so a new draft after a withdrawal is the one acted on', () => {
    const r = (no: number, status: string) => ({ no, status });
    expect(finOpenRevision([r(1, 'withdrawn'), r(2, 'draft')])?.no).toBe(2);
    expect(finOpenRevision([r(1, 'approved'), r(2, 'withdrawn'), r(3, 'submitted')])?.no).toBe(3);
    expect(finOpenRevision([r(1, 'returned')])?.no).toBe(1);
    expect(finOpenRevision([r(1, 'withdrawn'), r(2, 'superseded'), r(3, 'approved')])).toBeNull();
  });
});
