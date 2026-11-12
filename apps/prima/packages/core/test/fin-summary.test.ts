import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// F3 (Fauzan, 11 Nov 2026): the CEO's one-page monthly finance summary. Synthetic data only.
const TODAY = '2026-11-20';
const NOW = myt(TODAY, '10:00');
const P = '2026-10';

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  return { ds, store, svc };
}

describe('F3 monthly finance page', () => {
  it('shows every company with the group total, Unknown for a stale SQL figure, and counts that match F1 and F2', async () => {
    const { ds, svc } = setup();
    const f = ds.finStatus.find((x) => ds.sites.some((s) => s.companyId === x.companyId))!;
    const fresh = ds.finStatus.find((x) => x.companyId !== f.companyId)!;
    f.sqlLastAt = myt('2026-11-17', '09:00'); // 3 days old: Unknown
    fresh.sqlLastAt = myt('2026-11-20', '08:00');
    const ceo = await svc.user('u-fauzan');
    const page = await svc.finSummary(ceo, P);
    expect(page.period).toBe(P);
    expect(page.ready).toBe(true);
    expect(page.scope).toBe('group');
    const row = page.rows.find((r) => r.companyId === f.companyId)!;
    expect(row.cash).toEqual({ value: null, unknown: true });
    expect(row.over90.unknown).toBe(true);
    expect(page.rows.find((r) => r.companyId === fresh.companyId)!.cash.unknown).toBe(false);
    expect(page.group.row.company).toBe('Group total');
    expect(page.group.unknownCash).toBeGreaterThan(0);
    // The same counts as the unbilled-sites check (F1) and profit per site (F2) for the same data.
    const unb = await svc.unbilledSites(ceo, P);
    for (const c of unb.companies) expect(page.rows.find((r) => r.companyId === c.companyId)?.unbilled ?? 0, c.companyId).toBe(c.flagged);
    const mar = await svc.siteMargins(ceo, P);
    for (const r of page.rows) expect(r.belowTarget, r.companyId).toBe(mar.sites.filter((s) => s.companyId === r.companyId && s.belowTarget).length);
    // Red only for the listed conditions.
    for (const r of page.rows) expect(r.red).toBe(r.shortSoon || r.bankRec.late || r.closed.late || r.unbilled > 0 || r.belowTarget > 0);
  });

  it('tells the CEO the page is ready after the 15th, with a link', async () => {
    const { svc } = setup();
    const home = await svc.home(await svc.user('u-fauzan'));
    const all = [...home.todo, ...((home as { watch?: typeof home.todo }).watch ?? [])];
    expect(all.some((t) => t.go.view === 'finsummary' && /monthly finance page for 2026-10 is ready/.test(t.title))).toBe(true);
  });

  it('lets a Finance team see only its own companies and refuses an OM and a company manager', async () => {
    const { ds, svc } = setup();
    const lead = await svc.user('u-fin-t1-lead');
    const page = await svc.finSummary(lead, P);
    const t1 = ds.finStatus.filter((f) => f.team === 1).map((f) => f.companyId).sort();
    expect(page.rows.map((r) => r.companyId).sort()).toEqual(t1);
    expect(page.scope).toBe('team');
    for (const id of [ds.users.find((u) => u.opsTier === 'om')!.id, ds.users.find((u) => u.role === 'company_manager')!.id]) {
      await expect(svc.finSummary(await svc.user(id), P), id).rejects.toThrow(/monthly finance page/);
    }
  });
});
