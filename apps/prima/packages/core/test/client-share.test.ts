import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, monthInsidePeriod, myt } from '../src';

// Client portal, first step (Fauzan, 3 Nov 2026: "Shared report links first"). Synthetic data only.

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

async function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const cm = await svc.user('u-cm-sasa');
  // The co-sasa site with the most cases, so the report has something to show.
  const count = new Map<string, number>();
  for (const c of ds.cases) if (c.companyId === 'co-sasa' && c.siteId) count.set(c.siteId, (count.get(c.siteId) ?? 0) + 1);
  const siteId = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const acct = await svc.addClientAccount(cm, { companyId: 'co-sasa', name: 'Synthetic Client Bhd', siteIds: [siteId], contractEndsOn: null });
  return { ds, store, svc, cm, acct, siteId };
}

describe('Client report links', () => {
  it('only the company manager makes a link; it is bounded and audited', async () => {
    const { svc, cm, acct } = await fresh();
    const ae = await svc.user('u-ae-arsh');
    const other = await svc.user('u-cm-inas');
    const input = { recipient: 'Facilities manager', from: addDays(TODAY, -30), to: TODAY, days: 7 };
    await expect(svc.createClientShareLink(other, acct.id, input)).rejects.toThrow();
    await expect(svc.createClientShareLink(ae, acct.id, input)).rejects.toThrow();
    await expect(svc.createClientShareLink(cm, acct.id, { ...input, days: 31 })).rejects.toThrow(/1 to 30/);
    await expect(svc.createClientShareLink(cm, acct.id, { ...input, to: addDays(TODAY, 1) })).rejects.toThrow(/up to today/);
    await expect(svc.createClientShareLink(cm, acct.id, { ...input, from: addDays(TODAY, -100) })).rejects.toThrow(/at most 92/);
    await expect(svc.createClientShareLink(cm, acct.id, { ...input, recipient: 'x' })).rejects.toThrow(/who at the client/);
    const r = await svc.createClientShareLink(cm, acct.id, input);
    expect(r.link.expiresOn).toBe(addDays(TODAY, 7));
    expect(r.companyId).toBe('co-sasa');
    for (let i = 0; i < 4; i++) await svc.createClientShareLink(cm, acct.id, input);
    await expect(svc.createClientShareLink(cm, acct.id, input)).rejects.toThrow(/5 open links/);
    const audit = await svc['store'].list('audit', {});
    expect(audit.filter((a) => a.action === 'client.share.create').length).toBe(5);
  });

  it('shows only the client own sites and client-facing cases, counts views, and stops when revoked or expired', async () => {
    const { ds, store, svc, cm, acct, siteId } = await fresh();
    const { link } = await svc.createClientShareLink(cm, acct.id, { recipient: 'Facilities manager', from: addDays(TODAY, -60), to: TODAY, days: 3 });
    const rep = await svc.clientShareReport('co-sasa', acct.id, link.id);
    expect(rep.sites.map((s) => s.name)).toEqual([ds.sites.find((s) => s.id === siteId)!.name]);
    for (const c of rep.incidents) expect(['Incident', 'Emergency alert', 'Complaint']).toContain(c.kind);
    const text = JSON.stringify(rep);
    for (const c of ds.cases.filter((x) => x.siteId === siteId)) if (c.description && c.description.length > 12) expect(text).not.toContain(c.description);
    for (const g of ds.people.slice(0, 200)) expect(text).not.toContain(g.name);
    expect(text).not.toMatch(/overdue|paid/i);
    // Wrong company in the link: not found.
    await expect(svc.clientShareReport('co-inas', acct.id, link.id)).rejects.toThrow(/not found/i);
    const cur = (await store.get('clientAccounts', acct.id))!;
    expect(cur.shareLinks![0].views).toBe(1);
    // A preview by staff does not count as a view.
    await svc.clientShareReport(null, acct.id, link.id, cm);
    expect((await store.get('clientAccounts', acct.id))!.shareLinks![0].views).toBe(1);
    // Revoke needs a reason and the company desk.
    const om = await svc.user('u-cm-inas');
    await expect(svc.revokeClientShareLink(om, acct.id, link.id, 'Not my company')).rejects.toThrow();
    await expect(svc.revokeClientShareLink(cm, acct.id, link.id, 'no')).rejects.toThrow();
    await svc.revokeClientShareLink(cm, acct.id, link.id, 'Recipient left the client');
    await expect(svc.clientShareReport('co-sasa', acct.id, link.id)).rejects.toThrow(/not found/i);
    // Expiry: a later clock refuses it.
    const { link: l2 } = await svc.createClientShareLink(cm, acct.id, { recipient: 'Facilities manager', from: addDays(TODAY, -10), to: TODAY, days: 1 });
    const later = new PrimaService(store, () => myt(addDays(TODAY, 2), '09:00'));
    await expect(later.clientShareReport('co-sasa', acct.id, l2.id)).rejects.toThrow(/not found/i);
    const list = await svc.clientShareLinks(cm, acct.id);
    expect(list.canCreate).toBe(true);
    expect(list.links.find((l) => l.id === link.id)!.live).toBe(false);
  });

  it('keeps other companies out of the list', async () => {
    const { svc, acct } = await fresh();
    const other = await svc.user('u-cm-inas');
    await expect(svc.clientShareLinks(other, acct.id)).rejects.toSatisfy((e: unknown) => e instanceof AccessDenied || /not found/i.test(String(e)));
  });
});

describe('Client report links: review fixes (Arisha main, 3 Nov 2026)', () => {
  it('a revoke that lands while a view is being counted stays revoked and the page is refused', async () => {
    const { store, svc, cm, acct } = await fresh();
    const { link } = await svc.createClientShareLink(cm, acct.id, { recipient: 'Facilities manager', from: addDays(TODAY, -20), to: TODAY, days: 5 });
    // The view reads the link as open; the revoke commits just as the view takes its hold.
    store.lock = async (table, id) => {
      if (table === 'clientAccounts' && id === acct.id) {
        store.lock = undefined;
        await svc.revokeClientShareLink(cm, acct.id, link.id, 'Recipient left the client');
      }
    };
    await expect(svc.clientShareReport('co-sasa', acct.id, link.id)).rejects.toThrow(/not found/i);
    const cur = (await store.get('clientAccounts', acct.id))!.shareLinks!.find((l) => l.id === link.id)!;
    expect(cur.revokedAt).not.toBeNull();
    expect(cur.views).toBe(0);
    await expect(svc.clientShareReport('co-sasa', acct.id, link.id)).rejects.toThrow(/not found/i);
  });

  it('lists an invoice or monthly report only when its whole month is inside the link period', async () => {
    expect(monthInsidePeriod('2026-09', '2026-09-01', '2026-09-30')).toBe(true);
    expect(monthInsidePeriod('2026-09', '2026-09-02', '2026-10-26')).toBe(false);
    expect(monthInsidePeriod('2026-10', '2026-10-20', '2026-10-26')).toBe(false);
    expect(monthInsidePeriod('2024-02', '2024-02-01', '2024-02-29')).toBe(true);
    expect(monthInsidePeriod('2026-9', '2026-09-01', '2026-09-30')).toBe(false);
    const { store, svc, cm, acct } = await fresh();
    const proof = { at: NOW, by: 'Test', docId: 'doc-x' };
    await store.update('clientAccounts', acct.id, {
      invoices: [
        { period: '2026-09', amount: 1000, at: NOW, by: 'Test', hand: proof, email: null, portal: null },
        { period: '2026-10', amount: 2000, at: NOW, by: 'Test', hand: proof, email: null, portal: null },
      ],
      reports: [
        { period: '2026-09', at: NOW, by: 'Test', docId: 'doc-r' },
        { period: '2026-10', at: NOW, by: 'Test', docId: 'doc-r2' },
      ],
    });
    const part = await svc.createClientShareLink(cm, acct.id, { recipient: 'Facilities manager', from: '2026-10-20', to: TODAY, days: 5 });
    const r1 = await svc.clientShareReport('co-sasa', acct.id, part.link.id);
    expect(r1.invoices).toEqual([]);
    expect(r1.reports).toEqual([]);
    const whole = await svc.createClientShareLink(cm, acct.id, { recipient: 'Facilities manager', from: '2026-09-01', to: TODAY, days: 5 });
    const r2 = await svc.clientShareReport('co-sasa', acct.id, whole.link.id);
    expect(r2.invoices.map((x) => x.period)).toEqual(['2026-09']);
    expect(r2.reports).toEqual(['2026-09']);
  });
});
