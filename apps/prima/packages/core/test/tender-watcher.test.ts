// The tender watcher (Marketing item AH11; Fauzan 22-23 Nov 2026). Fixed rules on synthetic pages, no network.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, closingDate, generateDataset, noticeRef, robotsAllows, watchPage } from '../src';

const TODAY = '2026-11-23';
const NOW = '2026-11-23T03:00:00.000Z';
const PAGE = 'https://buyer.example.gov.my/tender/senarai';
const HTML = `<html><head><title>Senarai tender</title><script>var x = "kawalan keselamatan";</script></head><body>
<table>
<tr><td>1</td><td><a href="/doc/T12.pdf">Perkhidmatan Kawalan Keselamatan di Ibu Pejabat (mock)</a></td><td>No. Tender: BEX/T/2026/12</td><td>Tarikh tutup: 15/12/2026</td></tr>
<tr><td>2</td><td>Perkhidmatan Pembersihan Bangunan (mock)</td><td>BEX/T/2026/13</td><td>16/12/2026</td></tr>
<tr><td>3</td><td><a href="https://buyer.example.gov.my/q/9">Sebut harga: khidmat kawalan &amp; pengawal keselamatan, Cawangan Utara</a></td><td>Ditutup 3 Januari 2027</td></tr>
</table>
<p>Security guard services for the warehouse (mock), closing date 2026-12-20</p>
<p>Security guard services for the warehouse (mock), closing date 2026-12-20</p>
</body></html>`;

describe('tender watcher rules (AH11)', () => {
  it('picks out the guarding notices on a page, with number, closing date and link', () => {
    const got = watchPage(HTML, PAGE);
    expect(got.map((g) => g.title.slice(0, 41))).toEqual([
      '1 Perkhidmatan Kawalan Keselamatan di Ibu',
      '3 Sebut harga: khidmat kawalan & pengawal',
      'Security guard services for the warehouse',
    ]);
    expect(got[0]).toMatchObject({ ref: 'BEX/T/2026/12', closesOn: '2026-12-15', link: 'https://buyer.example.gov.my/doc/T12.pdf' });
    expect(got[1]).toMatchObject({ closesOn: '2027-01-03', link: 'https://buyer.example.gov.my/q/9' });
    expect(got[2]).toMatchObject({ closesOn: '2026-12-20', link: null });
    // Scripts are never read; the same notice twice is listed once.
    expect(new Set(got.map((g) => g.key)).size).toBe(3);
    expect(noticeRef('Tender for something')).toBe('');
    expect(closingDate('Iklan 01/11/2026, tutup 30/11/2026, taklimat 10/11/2026')).toBe('2026-11-30');
  });

  it("follows the site's robots file", () => {
    const robots = `User-agent: *\nDisallow: /tender/\nAllow: /tender/public\n\nUser-agent: BadBot\nDisallow: /`;
    expect(robotsAllows(robots, '/tender/senarai')).toBe(false);
    expect(robotsAllows(robots, '/tender/public/list')).toBe(true);
    expect(robotsAllows(robots, '/about')).toBe(true);
    expect(robotsAllows('User-agent: PrimaTenderWatcher\nDisallow: /\n\nUser-agent: *\nDisallow:', '/x')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf?x')).toBe(true);
    expect(robotsAllows('', '/x')).toBe(true);
  });
});

describe('tender watcher flow (AH11)', () => {
  it('reads only sites Marketing allowed; new finds wait for Marketing, who record or drop them', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    await svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, 'Marketing does all from today');
    const mgr = await svc.user('u-mkt-mgr');
    const watcher = await svc.user('u-tender-watcher');
    const exec = ds.users.find((u) => u.marketingRole === 'executive')!;
    const site = await svc.addTenderSource(mgr, { buyer: 'Buyer Example (mock)', urls: [PAGE] });

    expect(await svc.tenderWatchPlan(watcher)).toEqual([]);
    await expect(svc.tenderWatchPlan(mgr)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setTenderSourceWatch(exec, site.id, { allowed: true, note: 'Terms read' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setTenderSourceWatch(mgr, site.id, { allowed: true, note: '' })).rejects.toThrow(/terms/);
    await expect(svc.recordTenderWatch(watcher, site.id, { pages: [{ url: PAGE, outcome: 'READ', note: '' }], finds: [] })).rejects.toThrow(/not allowed/);
    await svc.setTenderSourceWatch(mgr, site.id, { allowed: true, note: 'Terms of use page read 23 Nov: public notices, no ban on reading' });
    expect(await svc.tenderWatchPlan(watcher)).toEqual([{ id: site.id, buyer: 'Buyer Example (mock)', urls: [PAGE] }]);

    const finds = watchPage(HTML, PAGE);
    const r1 = await svc.recordTenderWatch(watcher, site.id, { pages: [{ url: PAGE, outcome: 'READ', note: '' }], finds });
    expect(r1).toMatchObject({ read: 1, found: 3, fresh: 3 });
    // A page not on the site's list is ignored; the same notices again are not new.
    const r2 = await svc.recordTenderWatch(watcher, site.id, {
      pages: [{ url: PAGE, outcome: 'READ', note: '' }, { url: 'https://elsewhere.example/x', outcome: 'READ', note: '' }],
      finds,
    });
    expect(r2).toMatchObject({ pages: 1, fresh: 0 });
    const list = await svc.tenderSources(mgr);
    const row = list.rows.find((r) => r.id === site.id)!;
    expect(row.checks[0]).toMatchObject({ status: 'CHECKED', by: 'Tender watcher' });
    expect(row.due).toBe(false);
    expect(list.summary.newFinds).toBe(3);
    expect((await svc.marketingBoard(mgr)).alerts.some((a) => a.tag === 'Watcher')).toBe(true);

    const [a, b] = row.watchFinds!;
    await expect(svc.answerTenderWatchFind(await svc.user('u-cm-sasa'), site.id, a.key, { action: 'NOT_FOR_US', note: 'Cleaning only' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.answerTenderWatchFind(mgr, site.id, a.key, { action: 'NOT_FOR_US', note: '' })).rejects.toThrow(/reason/);
    await svc.answerTenderWatchFind(exec, site.id, a.key, { action: 'NOT_FOR_US', note: 'Outside our areas' });
    await expect(svc.answerTenderWatchFind(mgr, site.id, a.key, { action: 'NOT_FOR_US', note: 'Again' })).rejects.toThrow(/already/);
    const done = await svc.answerTenderWatchFind(mgr, site.id, b.key, { action: 'RECORD', channel: 'GOVERNMENT', kind: 'TENDER', closesOn: b.closesOn ?? '2026-12-20' });
    const recorded = done.watchFinds!.find((f) => f.key === b.key)!;
    expect(recorded.state).toBe('RECORDED');
    const opp = ds.tenderOpportunities.find((o) => o.id === recorded.answer!.opportunityId)!;
    expect(opp).toMatchObject({ buyer: 'Buyer Example (mock)', origin: 'DOA' });
    expect(opp.source).toMatch(/^Tender watcher/);

    // A page the watcher could not read keeps the site due for a person.
    await svc.recordTenderWatch(watcher, site.id, { pages: [{ url: PAGE, outcome: 'NOT_ALLOWED', note: 'robots file' }], finds: [] });
    const again = (await svc.tenderSources(mgr)).rows.find((r) => r.id === site.id)!;
    expect(again.checks[0].status).toBe('ERROR');
    expect(again.due).toBe(true);
    // Marketing can stop it.
    await svc.setTenderSourceWatch(mgr, site.id, { allowed: false });
    expect(await svc.tenderWatchPlan(watcher)).toEqual([]);
  });
});
