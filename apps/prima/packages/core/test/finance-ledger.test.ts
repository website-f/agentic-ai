import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  finCoaFor,
  finFsFromFigures,
  finSqlFingerprint,
  generateDataset,
  myt,
  type FinSqlSnapshot,
  type SqlAccountReader,
} from '../src';

// The ledger side of Finance (Fauzan, 3 Nov 2026: "Yes build all not build"; masterplan section 08 items 71, 72, 76).
// Dummy data only; no SQL Account is called anywhere.
const C = 'co-09';

function setup() {
  const ds = generateDataset({ today: '2026-10-31', now: myt('2026-10-31', '10:00') });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => myt('2026-10-31', '10:00'));
  return { ds, store, svc };
}
const users = (svc: PrimaService) => Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fin-t1-lead', 'u-fd', 'u-fauzan', 'u-coo'].map((id) => svc.user(id)));

const figures = (period: string, over: Record<string, unknown> = {}) => ({
  period,
  source: 'SQL TB, BS, PL and CF reports Sept (demo).pdf',
  tb: { debit: 1_250_000, credit: 1_250_000 },
  bs: { assets: 900_000, liabilities: 500_000, equity: 400_000 },
  pl: { result: 35_000, reOpening: 120_000, reClosing: 155_000, dividends: 0 },
  cf: { opening: 80_000, operating: 40_000, investing: -10_000, financing: -5_000, closing: 105_000, bsCash: 105_000 },
  fa: { regCost: 300_000, regAccDep: 120_000, glCost: 300_000, glAccDep: 120_000 },
  stockNa: 'The company keeps no stock; equipment belongs to Goodwill Empire (demo).',
  schedules: [
    { kind: 'payroll_deductions', gl: 18_000, schedule: 18_000, doc: 'EPF and PERKESO schedule Sept (demo)' },
    { kind: 'sst', gl: 9_200, schedule: 9_200, doc: 'SST-02 working (demo)' },
  ],
  ...over,
});

describe('Statement agreement FS-01 to FS-12 (item 76)', () => {
  it('works out every test from the figures, including not applicable with a reason', () => {
    const t = finFsFromFigures({
      ...(figures('2026-09') as never),
      origin: 'typed',
      syncId: null,
      fa: null,
      faNa: 'none',
      stock: null,
      stockNa: 'no stock',
      note: '',
      prepared: null as never,
      reviewed: null,
      pl: { result: 35_000, reOpening: 120_000, reClosing: 150_000, dividends: 0, otherMovements: 0, otherNote: '' },
      cf: {
        opening: 80_000,
        operating: 40_000,
        investing: -10_000,
        financing: -5_000,
        fx: 0,
        closing: 105_000,
        bsCash: 104_000,
        adjustment: 0,
        adjustmentNote: '',
      },
    });
    const by = Object.fromEntries(t.map((x) => [x.id, x]));
    expect(by['FS-01'].diff).toBe(0);
    expect(by['FS-03'].diff).toBe(-5000);
    expect(by['FS-04'].diff).toBe(0);
    expect(by['FS-05'].diff).toBe(1000);
    expect([by['FS-09'].na, by['FS-10'].na]).toEqual(['none', 'no stock']);
  });

  it('records figures, refuses review by the recorder, and the close uses only reviewed figures', async () => {
    const { svc } = setup();
    const [de, dep, , , , coo] = await users(svc);
    const p = (await svc.financeControls.view(de, C)).ledger.period;
    await expect(svc.financeControls.figuresAction(coo, C, 'record', figures(p))).rejects.toThrow();
    // Retained earnings moved 30,000 but the result is 35,000: FS-03 is off by RM5,000 (seeded demo results said 0).
    const r = (await svc.financeControls.figuresAction(de, C, 'record', figures(p, { pl: { result: 35_000, reOpening: 120_000, reClosing: 150_000 } }))) as {
      tests: { id: string; diff: number | null }[];
    };
    expect(r.tests.find((t) => t.id === 'FS-03')!.diff).toBe(-5000);
    const check = async () => (await svc.finance.desk(de)).companies.find((c) => c.companyId === C)!.close.check;
    expect((await check()).exceptions.map((e) => e.key)).not.toContain('test:FS-03');
    await expect(svc.financeControls.figuresAction(de, C, 'review', { period: p, comment: 'ok' })).rejects.toThrow(/reviews the figures/);
    await svc.financeControls.figuresAction(dep, C, 'review', { period: p, comment: 'Agreed to the SQL reports' });
    const after = await check();
    expect(after.exceptions.find((e) => e.key === 'test:FS-03')!.text).toMatch(/off by RM-5000.00/);
    expect(after.done.join(' ')).toMatch(/FS-10 Stock agrees with the ledger: not applicable/);
    expect(after.done.join(' ')).toMatch(/FS-04 .* at RM0.00/);
    // A reviewed month is closed to a data entry executive; other movements need a reason.
    await expect(svc.financeControls.figuresAction(de, C, 'record', figures(p))).rejects.toThrow(/re-opens/);
  });

  it('a trial balance off in the reviewed figures blocks the close (FS-01 must be RM0.00)', async () => {
    const { svc } = setup();
    const [de, dep] = await users(svc);
    const p = (await svc.financeControls.view(de, C)).ledger.period;
    await svc.financeControls.figuresAction(de, C, 'record', figures(p, { tb: { debit: 1_250_000, credit: 1_249_990 } }));
    await svc.financeControls.figuresAction(dep, C, 'review', { period: p, comment: 'Seen' });
    const check = (await svc.finance.desk(de)).companies.find((c) => c.companyId === C)!.close.check;
    expect(check.blockers.join(' ')).toMatch(/FS-01 .* off by RM10.00/);
  });
});

describe('Chart of accounts mapping (item 72)', () => {
  const accounts = (bankCodes: string[]) =>
    [
      '1000-000, Cash in hand, cash',
      ...bankCodes.map((c, i) => `${c}, Bank ${i + 1}, bank`),
      '1100-000, Trade debtors, trade_debtors',
      '2000-000, Trade creditors, trade_creditors',
      '2100-000, Wages accrued, wages_accrual',
      '2110-000, EPF payable, epf_liability',
      '2120-000, PERKESO payable, perkeso_liability',
      '2200-000, SST payable, sst',
      '1500-000, Equipment, fixed_assets',
      '1510-000, Equipment depreciation, accumulated_depreciation',
      '2300-000, Due to PWVSB, intercompany',
      '2400-000, Client deposits, customer_deposits',
      '3100-000, Retained earnings, retained_earnings',
      '5000-000, Guard wages, staff_costs',
    ].join('\n');

  it('needs every required group, a ledger code for each bank account, and FD or CEO approval (not the proposer)', async () => {
    const { svc } = setup();
    const [de, dep, lead, fd] = await users(svc);
    const v = (await svc.financeControls.view(de, C)).ledger;
    const banks = v.banks.map((b) => b.id);
    const codes = banks.map((_, i) => `1010-00${i}`);
    // Two bank accounts on one ledger line are refused.
    if (banks.length > 1)
      await expect(
        svc.financeControls.coaAction(de, C, 'propose', { from: '2026-11', accounts: accounts(codes), banks: banks.map((b) => `${b}, 1010-000`).join('\n') }),
      ).rejects.toThrow(/own ledger code/);
    const partial = (await svc.financeControls.coaAction(de, C, 'propose', { from: '2026-11', accounts: '1000-000, Cash, cash' })) as { gaps: string[] };
    expect(partial.gaps.join(' ')).toMatch(/inventory/);
    await expect(svc.financeControls.coaAction(fd, C, 'approve', { version: 1, comment: 'ok' })).rejects.toThrow(/Not complete/);
    await svc.financeControls.coaAction(fd, C, 'return', { version: 1, comment: 'Give the whole chart, please.' });
    await svc.financeControls.coaAction(de, C, 'propose', {
      from: '2026-11',
      accounts: accounts(codes),
      na: 'inventory, No stock: equipment belongs to Goodwill Empire (demo)',
      banks: banks.map((b, i) => `${b}, ${codes[i]}`).join('\n'),
    });
    for (const u of [de, dep, lead])
      await expect(svc.financeControls.coaAction(u, C, 'approve', { version: 2, comment: 'ok' })).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.financeControls.coaAction(fd, C, 'approve', { version: 2 })).rejects.toThrow(/comment/);
    await svc.financeControls.coaAction(fd, C, 'approve', { version: 2, comment: 'Matches the SQL chart (demo)' });
    const row = (await svc.financeControls.view(de, C)).ledger;
    expect(row.coaHistory.map((m) => [m.version, !!m.approved, !!m.returned])).toEqual([
      [1, false, true],
      [2, true, false],
    ]);
    // Not in force before its first month.
    const f = { coaMaps: [{ ...(row.coaPending ?? {}), version: 2, from: '2026-11', approved: { by: 'x', byId: 'x', at: '', comment: '' } } as never] };
    expect(finCoaFor(f, '2026-10')).toBeNull();
    expect(finCoaFor(f, '2026-12')).not.toBeNull();
  });

  it('the proposer cannot approve their own mapping, even as the FD', async () => {
    const { svc } = setup();
    const [, , , fd, ceo] = await users(svc);
    await svc.financeControls.coaAction(fd, C, 'propose', { from: '2026-11', accounts: '1000-000, Cash, cash' });
    await expect(svc.financeControls.coaAction(fd, C, 'approve', { version: 1, comment: 'ok' })).rejects.toThrow(/nobody approves/);
    await svc.financeControls.coaAction(ceo, C, 'return', { version: 1, comment: 'Incomplete, please finish it.' });
  });
});

describe('SQL Account connector (item 71): read-only and switched off', () => {
  const snap = (period: string, codes: string[], over: Partial<FinSqlSnapshot> = {}): FinSqlSnapshot => ({
    externalId: 'SQLREAD-0001',
    companyFile: 'DEMO-CO09',
    period,
    readAt: '2026-10-31T02:00:00.000Z',
    accounts: [
      { code: codes[0], debit: 1_250_000, credit: 0 },
      { code: codes[1], debit: 0, credit: 1_250_000 },
    ],
    figures: figures(period, { source: 'x' }),
    ...over,
  });

  it('refuses a pull while switched off, and the set-up needs a second person to confirm', async () => {
    const { svc } = setup();
    const [de, , lead, fd] = await users(svc);
    await expect(svc.financeControls.sqlAction(de, C, 'pull', {})).rejects.toThrow(/switched off/);
    const setup1 = {
      companyFile: 'DEMO-CO09',
      deployment: 'cloud',
      version: '5.2 (demo)',
      modules: { restApi: 'yes', asset: 'no', project: 'yes', consolidation: 'no', bankFeed: 'unknown' },
      partnerDoc: 'Partner letter (demo).pdf',
    };
    await expect(svc.financeControls.sqlAction(de, C, 'record', setup1)).rejects.toThrow(/team leader/);
    await svc.financeControls.sqlAction(lead, C, 'record', setup1);
    await expect(svc.financeControls.sqlAction(lead, C, 'confirm', { comment: 'ok' })).rejects.toThrow(/Finance Director or the CEO/);
    await svc.financeControls.sqlAction(fd, C, 'confirm', { comment: 'Checked with the partner (demo)' });
    // Still off: no mapping, connector not switched on, no reader.
    const b = (await svc.financeControls.view(de, C)).ledger.sql.blockers.join(' ');
    expect(b).toMatch(/switched off/);
    expect(b).toMatch(/No SQL Account reader/);
    expect(b).toMatch(/chart of accounts mapping/);
  });

  it('with a test reader: unmapped accounts are rejected, a read is taken once, and figures still need review', async () => {
    const { svc } = setup();
    // One service instance: Prima builds a new one per request, always switched off, so only this test object turns on.
    const fc = svc.financeControls;
    const [de, dep, lead, fd] = await users(svc);
    const p = (await fc.view(de, C)).ledger.period;
    await fc.sqlAction(lead, C, 'record', {
      companyFile: 'DEMO-CO09',
      deployment: 'cloud',
      version: '5.2',
      modules: { restApi: 'yes', asset: 'no', project: 'no', consolidation: 'no', bankFeed: 'no' },
      partnerDoc: 'Partner letter (demo).pdf',
    });
    await fc.sqlAction(fd, C, 'confirm', { comment: 'Checked (demo)' });
    const banks = (await fc.view(de, C)).ledger.banks.map((b) => b.id);
    const codes = banks.map((_, i) => `1010-00${i}`);
    const required = [
      'cash',
      'trade_debtors',
      'trade_creditors',
      'wages_accrual',
      'epf_liability',
      'perkeso_liability',
      'sst',
      'fixed_assets',
      'accumulated_depreciation',
      'intercompany',
      'customer_deposits',
      'retained_earnings',
    ];
    await fc.coaAction(de, C, 'propose', {
      from: p,
      accounts: [...required.map((c, i) => `9${String(i).padStart(3, '0')}, ${c} (demo), ${c}`), ...codes.map((c) => `${c}, Bank (demo), bank`)].join('\n'),
      na: 'inventory, No stock held by this company (demo)',
      banks: banks.map((b, i) => `${b}, ${codes[i]}`).join('\n'),
    });
    await fc.coaAction(fd, C, 'approve', { version: 1, comment: 'Demo mapping' });
    let next = snap(p, ['9000', 'UNMAPPED-1']);
    const reader: SqlAccountReader = { readPeriod: async () => next };
    fc.sqlReader = reader;
    await expect(fc.sqlAction(de, C, 'pull', {})).rejects.toThrow(/switched off/);
    fc.sqlConnectorOn = true;
    const rej = (await fc.sqlAction(de, C, 'pull', {})) as { status: string; reasons: string[] };
    expect(rej.status).toBe('rejected');
    expect(rej.reasons.join(' ')).toMatch(/not in the approved mapping: UNMAPPED-1/);
    next = snap(p, ['9000', '9001'], { externalId: 'SQLREAD-0002' });
    const ok = (await fc.sqlAction(de, C, 'pull', {})) as { status: string };
    expect(ok.status).toBe('accepted');
    const v = (await fc.view(de, C)).ledger;
    expect(v.figures!.origin).toBe('connector');
    expect(v.figures!.reviewed).toBeNull();
    // The same figures under a new identity are not taken again.
    next = snap(p, ['9000', '9001'], { externalId: 'SQLREAD-0003' });
    expect(finSqlFingerprint(next)).toBe(finSqlFingerprint(snap(p, ['9000', '9001'])));
    const dup = (await fc.sqlAction(de, C, 'pull', {})) as { status: string; reasons: string[] };
    expect(dup.reasons.join(' ')).toMatch(/already taken/);
    expect(v.sql.syncs.map((s) => s.status)).toEqual(['rejected', 'accepted']);
    await fc.figuresAction(dep, C, 'review', { period: p, comment: 'Connector figures agree with the reports' });
    // Every other request builds a new service, switched off.
    expect([svc.financeControls.sqlConnectorOn, svc.financeControls.sqlReader]).toEqual([false, null]);
  });
});
