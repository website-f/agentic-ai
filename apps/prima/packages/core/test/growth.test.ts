// Growth panel for group leadership (Fauzan, 3 Nov 2026, "Recommended set"). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, growthPanel, myt, type Contract, type FinAgeing } from '../src';

const TODAY = '2026-11-03';
const NOW = myt(TODAY, '10:30');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};

const contract = (over: Partial<Contract> & { rate?: number; method?: 'M1' | 'M3' }): Contract => ({
  id: over.id ?? 'ct-syn',
  companyId: over.companyId ?? 'co-a',
  clientAccountId: over.clientAccountId ?? null,
  clientName: 'Synthetic client',
  siteIds: [],
  ref: 'SYN/1',
  state: over.state ?? 'active',
  startOn: over.startOn ?? '2026-01-01',
  endOn: over.endOn ?? '2027-12-31',
  endedOn: over.endedOn ?? null,
  versions: [
    {
      version: 1,
      effectiveFrom: over.startOn ?? '2026-01-01',
      billingMethod: over.method ?? 'M1',
      posts: [{ label: 'Gate', guards: 1, hoursPerDay: 12, rate: over.rate ?? 10, contractedHours: null }],
      fixedFee: null,
    } as Contract['versions'][number],
  ],
  mobilisation: [],
  rtoCert: null,
  reviews: [],
  history: [],
});

const age = (period: string, total: number): FinAgeing =>
  ({ period, ar: { current: total, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 }, ap: { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 }, glAr: total, glAp: 0, source: 'syn.xlsx', note: '', prepared: { by: 'x', at: NOW }, reviewed: { by: 'y', at: NOW } }) as FinAgeing;

const base = {
  today: TODAY,
  companies: [
    { id: 'co-a', name: 'A' },
    { id: 'co-b', name: 'B' },
  ],
  accounts: [] as { id: string; companyId: string; invoices?: { period: string; amount: number }[] }[],
  leads: [],
  shifts7: [],
  rosterCompanies: new Set<string>(),
  ageing: new Map(),
  daysPerMonthM1: 30.5,
};

describe('growth panel', () => {
  it('values contracts at the monthly run-rate, so a 30-day month is not a fall against a 31-day month', () => {
    const g = growthPanel({ ...base, contracts: [contract({ method: 'M3', rate: 10 })] } as never);
    const a = g.rows.find((r) => r.companyId === 'co-a')!;
    expect(a.contractValue).toBe(3660); // 12 h x 30.5 days x RM10
    expect(a.contractValuePrev).toBe(3660);
    expect(a.changePct).toBe(0);
  });

  it('shows a company with no contracts as Unknown, never zero, and counts who is known', () => {
    const g = growthPanel({ ...base, contracts: [contract({})] } as never);
    const b = g.rows.find((r) => r.companyId === 'co-b')!;
    expect(b.contractValue).toBeNull();
    expect(b.ending90).toBeNull();
    expect(b.unfilled7).toBeNull();
    expect(g.group.known).toEqual({ contracts: 1, pipeline: 0, billing: 1, roster: 0, collection: 0, of: 2 });
  });

  it('counts a contract that ended last month as a fall, and one ending within 90 days as revenue at risk', () => {
    const g = growthPanel({
      ...base,
      contracts: [contract({ id: 'c1' }), contract({ id: 'c2', state: 'terminated', endedOn: '2026-10-20' }), contract({ id: 'c3', endOn: '2027-01-15' })],
    } as never);
    const a = g.rows.find((r) => r.companyId === 'co-a')!;
    expect(a.contractValuePrev).toBe(3660 * 3);
    expect(a.contractValue).toBe(3660 * 2);
    expect(a.changePct).toBe(-33.3);
    expect(a.ending90).toEqual({ count: 1, monthly: 3660 });
  });

  it('finds last month under-billed and missing invoices with the Contracts screen rule', () => {
    const g = growthPanel({
      ...base,
      contracts: [contract({ id: 'c1', clientAccountId: 'acc1' }), contract({ id: 'c2', clientAccountId: 'acc2' }), contract({ id: 'c3', clientAccountId: 'acc3' })],
      accounts: [
        { id: 'acc1', companyId: 'co-a', invoices: [{ period: '2026-10', amount: 3000 }] },
        { id: 'acc2', companyId: 'co-a', invoices: [{ period: '2026-10', amount: 3660 }] },
        { id: 'acc3', companyId: 'co-a', invoices: [] },
      ],
    } as never);
    const a = g.rows.find((r) => r.companyId === 'co-a')!;
    expect(a.billing).toEqual({ period: '2026-10', underBilled: 660, underContracts: 1, missing: 1, checked: 3 });
  });

  it('gives collection days only from a recorded ageing', () => {
    const g = growthPanel({ ...base, contracts: [contract({})], ageing: new Map([['co-a', [age('2026-10', 7320)]]]) } as never);
    const a = g.rows.find((r) => r.companyId === 'co-a')!;
    expect(a.collectionDays).toBe(60); // RM7,320 debtors over RM3,660 billed = 2 months
    expect(g.group.collectionDays).toBe(60);
    expect(g.rows.find((r) => r.companyId === 'co-b')!.collectionDays).toBeNull();
  });

  it('adds group collection days by the ageing month billing, so a company whose contracts ended still counts (Arisha review)', () => {
    // A: 60 days on October billing. B: 0 days on October billing, and its only contract ended on 31 October.
    const g = growthPanel({
      ...base,
      contracts: [contract({ id: 'ca', companyId: 'co-a' }), contract({ id: 'cb', companyId: 'co-b', endOn: '2026-10-31' })],
      ageing: new Map([
        ['co-a', [age('2026-10', 7320)]],
        ['co-b', [age('2026-10', 0)]],
      ]),
    } as never);
    expect(g.rows.map((r) => r.collectionDays)).toEqual([60, 0]);
    expect(g.rows.find((r) => r.companyId === 'co-b')!.contractValue).toBe(0);
    expect(g.group.collectionDays).toBe(30); // (7,320 + 0) / (3,660 + 3,660) x 30, not 60
    expect(g.group.known.collection).toBe(2);
  });

  it('shows Unknown, not a green zero, for group figures no company has recorded', () => {
    const none = growthPanel({ ...base, contracts: [] } as never).group;
    expect([none.ending90Count, none.ending90Monthly, none.pipelineCount, none.pipelineMonthly, none.underBilled, none.underContracts, none.missingInvoices, none.collectionDays, none.unfilled7]).toEqual(
      Array(9).fill(null),
    );
    expect(none.known).toEqual({ contracts: 0, pipeline: 0, billing: 0, roster: 0, collection: 0, of: 2 });
    // Contracts recorded but none billed the whole of last month: billing is still Unknown, with its own coverage.
    const fresh = growthPanel({ ...base, contracts: [contract({ startOn: '2026-11-01' })] } as never).group;
    expect(fresh.ending90Count).toBe(0);
    expect(fresh.underBilled).toBeNull();
    expect(fresh.known.billing).toBe(0);
    expect(fresh.known.contracts).toBe(1);
  });

  it('is for group leadership only; company and department staff are refused', async () => {
    const { svc } = fresh();
    for (const id of ['u-fauzan', 'u-coo', 'u-fd', 'u-cos', 'u-chair']) {
      const g = await svc.growth(await svc.user(id));
      expect(g.rows.length).toBe(38);
      expect(g.group.known.contracts).toBeGreaterThan(0);
    }
    for (const id of ['u-cm-sasa', 'u-ae-sasa', 'u-it-ex1', 'u-om-klang', 'u-pwvsb-hr']) {
      await expect(svc.growth(await svc.user(id))).rejects.toThrow(/leadership/);
      await expect(svc.growthMargin(await svc.user(id))).rejects.toThrow(/leadership/);
    }
  });

  it('site margin counts only sites with a complete profit and loss', async () => {
    const { svc } = fresh();
    const m = await svc.growthMargin(await svc.user('u-fauzan'));
    expect(m.sectors.map((s) => s.sector)).toEqual(['government', 'private']);
    for (const s of m.sectors) expect(s.known).toBeLessThanOrEqual(s.sites);
  });
});
