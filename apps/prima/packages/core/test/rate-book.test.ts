import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, RULES, generateDataset, myt, rateFor } from '../src';

// C5 (Fauzan, 11 Nov 2026): rates are entered in the app from a month, never preset; old months keep their rate; no
// rate is "rate not set", never zero. Synthetic data only.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  // Start from an empty rate book (the demo seed's sample rates are demo only).
  for (const f of ds.finStatus) f.rateLog = [];
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const fd = await svc.user('u-fd');
  const ceo = await svc.user('u-fauzan');
  const co = ds.companies.find((c) => ds.finStatus.some((f) => f.companyId === c.id))!;
  const other = ds.companies.find((c) => c.id !== co.id && ds.finStatus.some((f) => f.companyId === c.id))!;
  return { ds, store, svc, fd, ceo, co, other };
}
const fin = async (store: MemoryStore, companyId: string) => (await store.list('finStatus', { companyId: [companyId] }))[0];

describe('C5 rate book', () => {
  it('has no preset IT rental rates in the rule register', () => {
    expect((RULES.itRental.value as Record<string, unknown>).monthly).toBeUndefined();
    expect(RULES.itRental.label).toBe('Policy');
    expect(RULES.itRental.source).toMatch(/Approved by Fauzan, 11 Nov 2026/);
  });

  it('shows "rate not set" (null, never 0) until a rate is entered', async () => {
    const { svc, store, fd, co } = await setup();
    expect(rateFor(await fin(store, co.id), 'hostel_np', '2026-11')).toBeNull();
    const book = await svc.rateBook(fd);
    const row = book.companies.find((c) => c.companyId === co.id)!;
    expect(row.rates.every((r) => r.now === null)).toBe(true);
    expect(book.canSet).toBe(true);
  });

  it('keeps the old rate for old months when a new rate starts next month', async () => {
    const { svc, store, fd, ceo, co, other } = await setup();
    await svc.setRate(fd, { key: 'uniform', companyId: 'all', from: '2026-11', amount: 25, reason: 'Synthetic supplier quote A' });
    await svc.setRate(ceo, { key: 'uniform', companyId: 'all', from: '2026-12', amount: 30, reason: 'Synthetic supplier quote B' });
    const f = await fin(store, co.id);
    expect(rateFor(f, 'uniform', '2026-11')).toMatchObject({ amount: 25, scope: 'group', from: '2026-11' });
    expect(rateFor(f, 'uniform', '2026-12')).toMatchObject({ amount: 30, from: '2026-12' });
    expect(rateFor(f, 'uniform', '2026-10')).toBeNull();
    // A company rate overrides the group rate; clearing it goes back to the group rate.
    await svc.setRate(fd, { key: 'uniform', companyId: other.id, from: '2026-11', amount: 40, reason: 'Synthetic own uniform contract' });
    expect(rateFor(await fin(store, other.id), 'uniform', '2026-11')).toMatchObject({ amount: 40, scope: 'company' });
    await svc.setRate(fd, { key: 'uniform', companyId: other.id, from: '2026-12', amount: null, reason: 'Back to the group contract' });
    expect(rateFor(await fin(store, other.id), 'uniform', '2026-12')).toMatchObject({ amount: 30, scope: 'group' });
    expect(rateFor(await fin(store, other.id), 'uniform', '2026-11')).toMatchObject({ amount: 40 });
    const book = await svc.rateBook(fd);
    expect(book.history).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'uniform', amount: null, companyId: other.id, reason: 'Back to the group contract' })]));
    // A group rate shows once in the history, not once per company.
    expect(book.history.filter((h) => h.companyId === null && h.amount === 25)).toHaveLength(1);
    expect(book.companies.find((c) => c.companyId === co.id)!.rates.find((r) => r.key === 'uniform')!.later[0]).toMatchObject({ amount: 30, from: '2026-12' });
    const audit = (await store.list('audit', {})).filter((a) => a.action === 'fin.rate.set');
    expect(audit).toHaveLength(4);
    expect(audit[0].summary).toMatch(/Uniform, per guard RM25\.00 .* from 2026-11 for every company .*Reason: Synthetic supplier quote A/);
  });

  it('refuses a missing reason, a month too far back, a bad amount and the same rate twice', async () => {
    const { svc, fd, co } = await setup();
    const ok = { key: 'hostel_np', companyId: co.id, from: '2026-11', amount: 200, reason: 'Synthetic hostel agreement' };
    await expect(svc.setRate(fd, { ...ok, reason: ' ' })).rejects.toThrow(/reason/);
    await expect(svc.setRate(fd, { ...ok, from: '2026-09' })).rejects.toThrow(/last month at the earliest/);
    await expect(svc.setRate(fd, { ...ok, amount: -1 })).rejects.toThrow(/amount/);
    await expect(svc.setRate(fd, { ...ok, amount: 1.005 })).rejects.toThrow(/sen/);
    await expect(svc.setRate(fd, { ...ok, key: 'nope' })).rejects.toThrow(/which rate/);
    await svc.setRate(fd, ok);
    await expect(svc.setRate(fd, ok)).rejects.toThrow(/already the rate/);
  });

  it('refuses the wrong roles: only the FD or the CEO sets; others outside Finance cannot read', async () => {
    const { ds, svc, co } = await setup();
    const input = { key: 'equipment', companyId: co.id, from: '2026-11', amount: 10, reason: 'Synthetic' };
    const readers = ['u-coo', ds.users.find((u) => u.department === 'finance' && u.financeTeam != null && u.financeRole === 'leader')?.id].filter(Boolean) as string[];
    for (const id of readers) {
      const u = await svc.user(id);
      await expect(svc.rateBook(u)).resolves.toBeTruthy();
      await expect(svc.setRate(u, input), id).rejects.toThrow(/Finance Director or the CEO/);
    }
    const outsiders = ['u-ogm', 'u-om-klang', ds.users.find((u) => u.role === 'company_manager')?.id, ds.users.find((u) => u.role === 'guard')?.id].filter(Boolean) as string[];
    for (const id of outsiders) {
      const u = await svc.user(id).catch(() => null);
      if (!u) continue;
      await expect(svc.rateBook(u), id).rejects.toThrow();
      await expect(svc.setRate(u, input), id).rejects.toThrow();
    }
  });
});
