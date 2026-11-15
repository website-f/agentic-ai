import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, SHARE_MAX_POSTS_PER_DAY, addDays, generateDataset, myt } from '../src';

// Client portal (A7, Fauzan 11 Nov 2026: managed by the OM, monitored by the company manager, the COO oversees).
// Synthetic data only: the generated mock dataset.
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

async function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  const cm = await svc.user('u-cm-sasa');
  const om = await svc.user('u-om-klang');
  // A co-sasa site in the Klang OM's area.
  const site = ds.sites.find((s) => s.companyId === 'co-sasa' && (s.sector ?? 'private') === 'private' && ['Selangor', 'Kuala Lumpur'].includes((s as { state?: string }).state ?? ''))
    ?? ds.sites.find((s) => s.companyId === 'co-sasa')!;
  const acct = await svc.addClientAccount(cm, { companyId: 'co-sasa', name: 'Synthetic Portal Client', siteIds: [site.id], contractEndsOn: null });
  return { ds, store, svc, cm, om, acct };
}
const input = { recipient: 'Facilities manager', from: addDays(TODAY, -30), to: TODAY, days: 7 };

describe('client portal (A7)', () => {
  it('the OM covering the client makes and revokes links; an OM elsewhere cannot; the COO oversees and may revoke', async () => {
    const { svc, om, acct } = await fresh();
    const covers = await svc['opsCovers'](om, acct.companyId, acct.siteIds);
    const elsewhere = await svc.user('u-om-johor');
    const coo = await svc.user('u-coo');
    expect(covers).toBe(true);
    {
      const { link } = await svc.createClientShareLink(om, acct.id, input);
      expect((await svc.clientShareLinks(om, acct.id)).canCreate).toBe(true);
      await expect(svc.createClientShareLink(coo, acct.id, input)).rejects.toThrow(/Not allowed/);
      await svc.revokeClientShareLink(coo, acct.id, link.id, 'Oversight: recipient left the client');
    }
    if (!(await svc['opsCovers'](elsewhere, acct.companyId, acct.siteIds))) await expect(svc.createClientShareLink(elsewhere, acct.id, input)).rejects.toThrow();
  });

  it('the client sends feedback and a request through the link, capped per day; a revoked link cannot send', async () => {
    const { svc, cm, acct } = await fresh();
    const { link } = await svc.createClientShareLink(cm, acct.id, input);
    await expect(svc.clientShareSend('co-sasa', acct.id, link.id, { kind: 'feedback', from: 'x', score: 4 })).rejects.toThrow(/name and position/);
    await expect(svc.clientShareSend('co-sasa', acct.id, link.id, { kind: 'feedback', from: 'Facilities manager', score: 1 })).rejects.toThrow(/improve/);
    await svc.clientShareSend('co-sasa', acct.id, link.id, { kind: 'feedback', from: 'Facilities manager', score: 4, comment: 'Good patrols' });
    await expect(svc.clientShareSend('co-sasa', acct.id, link.id, { kind: 'request', from: 'Facilities manager', requestKind: 'hack', what: 'x' })).rejects.toThrow(/what you are asking/);
    await svc.clientShareSend('co-sasa', acct.id, link.id, { kind: 'request', from: 'Facilities manager', requestKind: 'temporary', what: 'Two extra guards for the event on Saturday', neededBy: addDays(TODAY, 5) });
    // Another company's session cannot reach this client.
    await expect(svc.clientShareSend('co-inas', acct.id, link.id, { kind: 'feedback', from: 'Facilities manager', score: 5 })).rejects.toThrow(/not found/i);
    for (let i = 2; i < SHARE_MAX_POSTS_PER_DAY; i++) await svc.clientShareSend('co-sasa', acct.id, link.id, { kind: 'feedback', from: 'Facilities manager', score: 5 });
    await expect(svc.clientShareSend('co-sasa', acct.id, link.id, { kind: 'feedback', from: 'Facilities manager', score: 5 })).rejects.toThrow(/today's limit/);
    const seen = await svc.clientShareLinks(cm, acct.id);
    expect(seen.fromLink.ratings[0].via).toBe('link');
    expect(seen.fromLink.requests[0].what).toMatch(/extra guards/);
    const board = await svc.clientPortalBoard(cm);
    const row = board.rows.find((r) => r.clientId === acct.id)!;
    expect(row.openRequests).toBe(1);
    expect(board.role).toBe('company');
    const coo = await svc.clientPortalBoard(await svc.user('u-coo'));
    expect(coo.role).toBe('oversee');
    expect(coo.rows.some((r) => r.clientId === acct.id)).toBe(true);
    await svc.revokeClientShareLink(cm, acct.id, link.id, 'Recipient changed');
    await expect(svc.clientShareSend('co-sasa', acct.id, link.id, { kind: 'feedback', from: 'Facilities manager', score: 5 })).rejects.toThrow(/not found/i);
    const audit = await svc['store'].list('audit', {});
    expect(audit.some((x) => x.action === 'client.share.request')).toBe(true);
  });

  it('gives a report PDF only for a month inside the link period with a stored PDF', async () => {
    const { svc, store, cm, acct } = await fresh();
    const doc = { id: 'ev-rep-1', companyId: 'co-sasa', caseId: null, followUpId: null, name: 'report.pdf', mime: 'application/pdf' as const, bytes: 10, sha256: 'x', data: 'data:application/pdf;base64,JVBERi0=', caption: 'Report', uploadedBy: 'x', receivedAt: NOW };
    await store.transaction(async (tx) => {
      await tx.insert('evidenceDocs', doc);
      await tx.update('clientAccounts', acct.id, { reports: [{ period: '2026-09', at: NOW, by: 'x', docId: doc.id }, { period: '2026-07', at: NOW, by: 'x', docId: doc.id }] });
    });
    const { link } = await svc.createClientShareLink(cm, acct.id, { ...input, from: '2026-09-01', to: '2026-10-25' });
    const rep = await svc.clientShareReport('co-sasa', acct.id, link.id);
    expect(rep.reportFiles).toEqual(['2026-09']);
    expect(rep.canSend).toBe(true);
    const f = await svc.clientShareReportFile('co-sasa', acct.id, link.id, '2026-09');
    expect(f.name).toBe('service-report-2026-09.pdf');
    await expect(svc.clientShareReportFile('co-sasa', acct.id, link.id, '2026-07')).rejects.toThrow(/not found/i);
  });
});
