import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, mailboxFlags, mailFlags, mailHealthFromDns, myt, quarterOf, socialFlags, type Dataset, type IsoDateTime } from '../src';

// Group website management (Fauzan, 27 Oct 2026). Sample data only.

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh(extraCompanies = 0, now: IsoDateTime = NOW) {
  const ds: Dataset = generateDataset({ today: TODAY, now: NOW });
  for (let k = 0; k < extraCompanies; k++)
    ds.companies.push({ id: `co-x${k}`, code: `X${k}`, name: `Sample Company X${k}`, isPilot: false, headOfCompany: '(to be named)', state: 'Selangor', guardCount: 0, siteCount: 0 });
  let clock = now;
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => clock);
  return { ds, svc, store, setClock: (t: IsoDateTime) => (clock = t), web: svc.websites };
}

const as = async (svc: PrimaService, id: string) => svc.user(id);

describe('group website register', () => {
  it('counts companies from the company master, never a fixed number (50 companies)', async () => {
    const { svc, ds, web } = fresh(12);
    expect(ds.companies.length).toBe(50);
    const b = await web.board(await as(svc, 'u-it-mgr'));
    if (!b.allowed) throw new Error('not allowed');
    expect(b.coverage!.total).toBe(50);
    expect(b.companies.length).toBe(50);
    // The extra companies have no set-up: shown as incomplete, without domain or website.
    expect(b.coverage!.noDomain).toContain('co-x0');
    expect(b.coverage!.neither).toContain('co-x0');
    expect(b.coverage!.incomplete).toContain('co-x0');
    expect(b.coverage!.live.length).toBeGreaterThan(5);
    expect(b.coverage!.domainNoSite.length).toBeGreaterThan(0);
    expect(b.coverage!.notRequired.length).toBeGreaterThan(0);
    const nr = b.companies.find((c) => c.websiteStatus === 'not_required')!;
    expect(nr.notRequired?.reason).toBeTruthy();
    expect(nr.notRequired?.by).toBeTruthy();
  });

  it('handles multiple websites per company, multiple domains per website and a shared domain', async () => {
    const { svc, web } = fresh();
    const b = await web.board(await as(svc, 'u-it-mgr'));
    if (!b.allowed) throw new Error('not allowed');
    const sasa = b.companies.find((c) => c.company.id === 'co-sasa')!;
    expect(sasa.siteCount).toBe(2);
    expect(b.sites.find((s) => s.site.name === 'Sasa corporate website')!.domains.length).toBe(2);
    const shared = b.domains.find((d) => d.domain.companyIds.length === 2)!;
    expect(shared.companyNames.length).toBe(2);
    // A company with no website gets no fake review.
    const none = b.companies.filter((c) => c.siteCount === 0).map((c) => c.company.id);
    expect(b.reviews.some((r) => none.includes(r.review.companyId))).toBe(false);
  });

  it('a Head of Company over two companies sees both and nothing else; group data stays with leaders', async () => {
    const { svc, web } = fresh();
    const b = await web.board(await as(svc, 'u-hoc-01'));
    if (!b.allowed) throw new Error('not allowed');
    expect(new Set(b.companies.map((c) => c.company.id))).toEqual(new Set(['co-04', 'co-05']));
    expect(b.coverage).toBeNull();
    expect(b.sites.every((s) => s.site.vault === null)).toBe(true);
    // A domain shared by both shows once.
    expect(b.domains.filter((d) => d.domain.companyIds.length === 2).length).toBe(1);
    for (const id of ['u-coo', 'u-dcos', 'u-fauzan']) {
      const g = await web.board(await as(svc, id));
      if (!g.allowed) throw new Error('not allowed');
      expect(g.coverage).not.toBeNull();
    }
    // Other departments see nothing.
    expect((await web.board(await as(svc, 'u-cms-head'))).allowed).toBe(false);
    // An IT executive sees only assigned companies.
    const ex = await web.board(await as(svc, 'u-it-ex1'));
    if (!ex.allowed) throw new Error('not allowed');
    expect(ex.companies.length).toBeLessThan(38);
    expect(ex.coverage).toBeNull();
  });

  it('never stores passwords and blocks renewals without evidence', async () => {
    const { svc, web, ds } = fresh();
    const mgr = await as(svc, 'u-it-mgr');
    await expect(web.act(mgr, 'saveDomain', { name: 'new-co.com.my', companyIds: ['co-10'], password: 'x' })).rejects.toThrow(/password manager/);
    const d = ds.webDomains.find((x) => x.expiresOn && x.status === 'active')!;
    await expect(web.act(mgr, 'saveDomain', { ...d, expiresOn: '2030-01-01' })).rejects.toThrow(/Confirm renewal/);
    await expect(web.act(mgr, 'confirmRenewal', { domainId: d.id, newExpiry: '2030-01-01' })).rejects.toThrow(/evidence/);
    await expect(web.act(mgr, 'confirmRenewal', { domainId: d.id, newExpiry: d.expiresOn, evidence: 'INV-1' })).rejects.toThrow(/later/);
    // The renewal owner (Finance) confirms with the evidence.
    const fin = await as(svc, 'u-fin-t1-lead');
    const owned = ds.webDomains.find((x) => x.renewalOwnerId === 'u-fin-t1-lead' && x.expiresOn)!;
    const saved = (await web.act(fin, 'confirmRenewal', { domainId: owned.id, newExpiry: '2031-01-31', evidence: 'GoDaddy receipt 123' })) as { expiresOn: string; renewals: unknown[] };
    expect(saved.expiresOn).toBe('2031-01-31');
    expect(saved.renewals.length).toBe(1);
    expect(ds.audit.some((a) => a.action === 'web.domain.renewed' && a.entityId === owned.id)).toBe(true);
    // A company user cannot change domain details.
    await expect(web.act(await as(svc, 'u-cm-sasa'), 'saveDomain', { id: owned.id, name: owned.name })).rejects.toThrow();
  });

  it('raises domain reminders at 60/30/7 days and escalates an unconfirmed renewal to management', async () => {
    const { svc, web } = fresh();
    const fin = await web.board(await as(svc, 'u-fin-t1-lead'));
    if (!fin.allowed) throw new Error('not allowed');
    expect(fin.todo.some((t) => /expires in \d+ days/.test(t.text))).toBe(true);
    const coo = await web.board(await as(svc, 'u-coo'));
    if (!coo.allowed) throw new Error('not allowed');
    expect(coo.todo.some((t) => /renewal not confirmed/.test(t.text))).toBe(true);
    const near = coo.domains.find((d) => d.days != null && d.days >= 0 && d.days <= 7)!;
    expect(near.reminder).toBe(7);
    expect(near.escalate).toBe(true);
    expect(coo.domains.find((d) => d.domain.expiresOn === null)!.status).toBe('unknown');
  });
});

describe('quarterly review', () => {
  it('runs with changes: answer, verify, prepare, reject, amend, approve, publish, test, complete', async () => {
    const { svc, web, ds } = fresh();
    const it = await as(svc, 'u-it-mgr');
    const q = quarterOf(TODAY).key;
    const r = ds.webReviews.find((x) => x.quarter === q && x.siteId === ds.webSites.find((s) => s.name === 'Sasa careers site')!.id)!;
    const gm = await as(svc, 'u-gm-sasa');
    const cm = await as(svc, 'u-cm-sasa');
    // A stranger cannot answer.
    await expect(web.act(await as(svc, 'u-cm-arsh'), 'respond', { reviewId: r.id, outcome: 'no_changes', confirmed: true })).rejects.toThrow();
    await web.act(gm, 'respond', {
      reviewId: r.id,
      outcome: 'changes',
      changes: [{ page: 'Careers', existing: 'Old salary', proposed: 'New salary RM1,800', reason: 'Minimum wage', compliance: true }],
    });
    // The person who answered cannot verify their own answer.
    await expect(web.act(gm, 'verify', { reviewId: r.id })).rejects.toThrow();
    await web.act(cm, 'verify', { reviewId: r.id });
    expect((await svc.websites.board(it)).allowed).toBe(true);
    expect(ds.webReviews.find((x) => x.id === r.id)!.stage).toBe('compliance');
    await web.act(await as(svc, 'u-audit'), 'complianceDecide', { reviewId: r.id, index: 0, ok: true, note: 'KDN licence number matches' });
    expect(ds.webReviews.find((x) => x.id === r.id)!.stage).toBe('prepare');
    await expect(web.act(it, 'prepare', { reviewId: r.id, previewUrl: 'https://p.example', previousVersion: 'v1', desktopOk: true, mobileOk: false, summary: 'x' })).rejects.toThrow(/mobile/);
    await web.act(it, 'prepare', { reviewId: r.id, previewUrl: 'https://p.example', previousVersion: 'v1', desktopOk: true, mobileOk: true, summary: 'Salary updated' });
    // Nobody publishes before approval.
    await expect(web.act(it, 'publish', { reviewId: r.id, versionRef: 'v2', liveUrl: 'https://x' })).rejects.toThrow();
    // Only the designated approver decides.
    await expect(web.act(gm, 'approve', { reviewId: r.id, decision: 'approve' })).rejects.toThrow();
    await web.act(cm, 'approve', { reviewId: r.id, decision: 'amend', note: 'Say per month' });
    expect(ds.webReviews.find((x) => x.id === r.id)!.stage).toBe('prepare');
    await web.act(it, 'prepare', { reviewId: r.id, previewUrl: 'https://p2.example', previousVersion: 'v1', desktopOk: true, mobileOk: true, summary: 'Salary per month' });
    await expect(web.act(cm, 'approve', { reviewId: r.id, decision: 'approve' })).rejects.toThrow(/comment/);
    await web.act(cm, 'approve', { reviewId: r.id, decision: 'approve', note: 'Preview checked' });
    await web.act(it, 'publish', { reviewId: r.id, versionRef: 'deploy 15', liveUrl: 'https://jobs' });
    const pub = ds.webReviews.find((x) => x.id === r.id)!;
    expect(pub.publication?.method).toBe('manual');
    // One test fails: an issue opens; completion waits for every test.
    await web.act(it, 'test', { reviewId: r.id, results: [{ key: 'form', result: 'fail', note: 'No email arrived' }] });
    const fail = ds.webReviews.find((x) => x.id === r.id)!.tests.find((t) => t.key === 'form')!;
    expect(fail.issueId).toBeTruthy();
    expect(ds.webIssues.find((x) => x.id === fail.issueId)!.origin.kind).toBe('review');
    await expect(web.act(it, 'complete', { reviewId: r.id })).rejects.toThrow();
    // A failed item cannot become a pass without a recorded correction and retest.
    await expect(web.act(it, 'test', { reviewId: r.id, results: [{ key: 'form', result: 'pass' }] })).rejects.toThrow(/corrected/);
    const rest = ds.webReviews
      .find((x) => x.id === r.id)!
      .tests.filter((t) => t.key !== 'form')
      .map((t) => ({ key: t.key, result: t.key === 'm365' ? 'na' : 'pass', note: t.key === 'm365' ? 'No DNS change' : '' }));
    await web.act(it, 'test', { reviewId: r.id, results: rest });
    expect(ds.webReviews.find((x) => x.id === r.id)!.stage).toBe('complete');
    await web.act(it, 'complete', { reviewId: r.id });
    const done = ds.webReviews.find((x) => x.id === r.id)!;
    expect(done.stage).toBe('done');
    // The outstanding failure is shown, not hidden.
    expect(done.completed!.outstanding.length).toBe(1);
    expect(ds.audit.filter((a) => a.entityId === r.id && a.action.startsWith('web.review.')).length).toBeGreaterThanOrEqual(10);
  });

  it('runs with no changes and a rejection, and blocks self-approval', async () => {
    const { svc, web, ds } = fresh();
    const q = quarterOf(TODAY).key;
    const r = ds.webReviews.find((x) => x.quarter === q && x.companyId === 'co-arsh')!;
    expect(r.stage).toBe('verify');
    const cm = await as(svc, 'u-cm-arsh');
    await web.act(cm, 'verify', { reviewId: r.id });
    expect(ds.webReviews.find((x) => x.id === r.id)!.stage).toBe('approval');
    await web.act(cm, 'approve', { reviewId: r.id, decision: 'reject', note: 'Check the client logos again' });
    expect(ds.webReviews.find((x) => x.id === r.id)!.stage).toBe('request');
    // A no-change answer needs the confirmation and every item ticked.
    const ae = await as(svc, 'u-ae-arsh');
    await expect(web.act(ae, 'respond', { reviewId: r.id, outcome: 'no_changes' })).rejects.toThrow(/Confirm/);
    // The Head of Company answers and is also the approver: self-approval is refused.
    const topics = ['profile', 'services', 'address', 'phone', 'email', 'people', 'licences', 'clients', 'careers', 'news', 'privacy'];
    await web.act(cm, 'respond', { reviewId: r.id, outcome: 'no_changes', confirmed: true, topics });
    await web.act(ae, 'verify', { reviewId: r.id });
    await expect(web.act(cm, 'approve', { reviewId: r.id, decision: 'approve' })).rejects.toThrow(/someone else/);
    // Not complete just because nothing changed: still needs approval and tests.
    const it = await as(svc, 'u-it-mgr');
    await expect(web.act(it, 'complete', { reviewId: r.id })).rejects.toThrow();
  });

  it('reuses one answer for two websites of the same company, keeping separate records', async () => {
    const { svc, web, ds } = fresh();
    const q = quarterOf(TODAY).key;
    const corp = ds.webReviews.find((x) => x.quarter === q && x.siteId === ds.webSites.find((s) => s.name === 'Sasa corporate website')!.id)!;
    const jobs = ds.webReviews.find((x) => x.quarter === q && x.siteId === ds.webSites.find((s) => s.name === 'Sasa careers site')!.id)!;
    await web.act(await as(svc, 'u-gm-sasa'), 'respond', { reviewId: jobs.id, reuseFrom: corp.id });
    const j = ds.webReviews.find((x) => x.id === jobs.id)!;
    expect(j.response!.reusedFrom).toBe(corp.id);
    expect(j.changes.length).toBe(corp.changes.length);
    expect(j.id).not.toBe(corp.id);
  });

  it('shows an overdue review, escalates it to management, and opens reviews idempotently', async () => {
    const { svc, web, ds } = fresh();
    const it = await as(svc, 'u-it-mgr');
    const b = await web.board(it);
    if (!b.allowed) throw new Error('not allowed');
    const overdue = b.reviews.filter((r) => r.overdue);
    expect(overdue.some((r) => r.review.companyId === 'co-04')).toBe(true);
    expect(b.companies.find((c) => c.company.id === 'co-04')!.quarterStatus).toBe('overdue');
    const cos = await web.board(await as(svc, 'u-dcos'));
    if (!cos.allowed) throw new Error('not allowed');
    expect(cos.todo.some((t) => /has not answered/.test(t.text))).toBe(true);
    // Opening the next quarter makes one review per live website, then nothing more on a second run.
    const live = ds.webSites.filter((s) => s.status === 'live' && !s.reviewException).length;
    const first = (await web.act(it, 'openReviews', { quarter: '2027-Q1' })) as { opened: number };
    expect(first.opened).toBe(live);
    const again = (await web.act(it, 'openReviews', { quarter: '2027-Q1' })) as { opened: number };
    expect(again.opened).toBe(0);
    expect(ds.webNotices.some((n) => n.toUserId === 'u-hoc-01' && n.delivery.email === 'not_connected')).toBe(true);
    await expect(web.act(await as(svc, 'u-it-ex1'), 'openReviews', {})).rejects.toThrow();
  });
});

describe('monthly checks, issues and DNS change control', () => {
  it('a failed monthly check opens an issue; batch assignment keeps one result per website', async () => {
    const { svc, web, ds } = fresh();
    const mgr = await as(svc, 'u-it-mgr');
    const res = (await web.act(mgr, 'openChecks', { month: '2026-11', assignToId: 'u-it-ex4' })) as { opened: number };
    expect(res.opened).toBe(ds.webSites.filter((s) => s.status === 'live').length);
    const c = ds.webChecks.find((x) => x.month === '2026-11' && !x.kind)!;
    const ex4 = await as(svc, 'u-it-ex4');
    await web.act(ex4, 'recordCheck', { checkId: c.id, results: [{ key: 'loads', result: 'fail', note: 'Timeout' }] });
    const saved = ds.webChecks.find((x) => x.id === c.id)!;
    const issue = ds.webIssues.find((x) => x.id === saved.items.find((i) => i.key === 'loads')!.issueId)!;
    expect(issue.severity).toBe('critical');
    expect(issue.escalateToId).toBe('u-coo');
    expect(ds.webNotices.some((n) => n.toUserId === 'u-it-mgr' && n.link.id === issue.id)).toBe(true);
    await expect(web.act(ex4, 'recordCheck', { checkId: c.id, finish: true })).rejects.toThrow(/every item/);
    // Current owner policy: Manager explicitly delegates before work; evidence still required.
    await svc.itAct(mgr,'assignTicket',{id:issue.itTicketId,toId:mgr.id});
    // Resolve needs evidence.
    await expect(web.act(mgr, 'issueStep', { issueId: issue.id, step: 'resolve', note: 'Fixed DNS' })).rejects.toThrow(/evidence/);
    await web.act(mgr, 'issueStep', { issueId: issue.id, step: 'resolve', note: 'Fixed DNS', evidence: 'Screenshot' });
  });

  it('records an urgent change approved by the company and published by IT', async () => {
    const { svc, web, ds } = fresh();
    const site = ds.webSites.find((s) => s.companyId === 'co-arsh')!;
    const issue = (await web.act(await as(svc, 'u-ae-arsh'), 'raiseIssue', { companyId: 'co-arsh', siteId: site.id, severity: 'high', category: 'CLAIM', description: 'Expired ISO claim shown' })) as { id: string };
    await expect(web.act(await as(svc, 'u-it-ex1'), 'urgentChange', { issueId: issue.id, reason: 'Misleading', changed: 'Remove ISO logo' })).rejects.toThrow();
    await web.act(await as(svc, 'u-cm-arsh'), 'urgentChange', { issueId: issue.id, reason: 'Misleading claim', changed: 'Remove ISO logo' });
    await web.act(await as(svc, 'u-it-mgr'), 'urgentChange', { issueId: issue.id, checks: 'Homepage and About checked on mobile and desktop' });
    const x = ds.webIssues.find((i) => i.id === issue.id)!;
    expect(x.urgent!.approvedById).toBe('u-cm-arsh');
    expect(x.urgent!.publishedAt).toBeTruthy();
  });

  it('a DNS change needs the pre-checks (incl. Microsoft 365 records) and approval by someone else', async () => {
    const { svc, web, ds } = fresh();
    const c = ds.webDnsChanges[0];
    const owner = await as(svc, c.ownerId);
    const mgr = await as(svc, 'u-it-mgr');
    await expect(web.act(await as(svc, 'u-fauzan'), 'dnsStep', { changeId: c.id, step: 'approve' })).rejects.toThrow(/pre-change/);
    await expect(web.act(owner, 'dnsStep', { changeId: c.id, step: 'pre', key: 'm365' })).rejects.toThrow(/recorded/);
    for (const key of ['m365', 'site', 'rollback']) await web.act(owner, 'dnsStep', { changeId: c.id, step: 'pre', key, note: 'Recorded in SharePoint' });
    // The IT Manager supervises and is not technical: the IT Lead (or the CEO, as owner) approves (Fauzan, 28 Oct 2026).
    await expect(web.act(mgr, 'dnsStep', { changeId: c.id, step: 'approve' })).rejects.toThrow(/IT Lead/);
    await web.act(await as(svc, c.raisedById === 'u-it-lead' ? 'u-fauzan' : 'u-it-lead'), 'dnsStep', { changeId: c.id, step: 'approve', note: 'Records and rollback checked' });
    for (const key of ['resolves', 'https', 'm365', 'others', 'final']) await web.act(owner, 'dnsStep', { changeId: c.id, step: 'post', key, result: 'pass' });
    await web.act(owner, 'dnsStep', { changeId: c.id, step: 'finish', finalConfig: 'Cloudflare NS, MX and autodiscover kept' });
    expect(ds.webDnsChanges[0].status).toBe('done');
  });

  it('works without any integration and says so', async () => {
    const { svc, web } = fresh();
    const b = await web.board(await as(svc, 'u-it-mgr'));
    if (!b.allowed) throw new Error('not allowed');
    expect(b.integrations.every((i) => !i.on && i.state === null)).toBe(true);
    expect('sample' in b).toBe(false);
    // Only the CEO, owner and master administrator of every system, changes settings (Fauzan, 28 Oct 2026).
    await expect(web.act(await as(svc, 'u-it-lead'), 'saveSettings', { responseDays: 20 })).rejects.toThrow();
    await expect(web.act(await as(svc, 'u-it-mgr'), 'saveSettings', { responseDays: 20 })).rejects.toThrow(/CEO/);
    const s = (await web.act(await as(svc, 'u-fauzan'), 'saveSettings', { responseDays: 20, domainReminderDays: [90, 30, 7, 0] })) as { responseDays: number };
    expect(s.responseDays).toBe(20);
  });
});

describe('schedule (Phase 2)', () => {
  it('opens the quarter reviews and month checks once, and sends each reminder once', async () => {
    const { svc, web, ds, setClock } = fresh();
    const live = ds.webSites.filter((s) => s.status === 'live' && !s.reviewException);
    const mgr = await as(svc, 'u-it-mgr');
    const first = (await web.act(mgr, 'runSchedule', {})) as { ran: boolean; sent: number };
    expect(first.ran).toBe(true);
    const q = quarterOf(TODAY).key;
    for (const s of live) expect(ds.webReviews.some((r) => r.siteId === s.id && r.quarter === q)).toBe(true);
    expect(ds.webChecks.filter((c) => c.month === '2026-10' && !c.kind).length).toBe(ds.webSites.filter((s) => s.status === 'live').length);
    expect(first.sent).toBeGreaterThan(0);
    // Opening the module again within the hour does nothing; pressing Run now sends nothing twice.
    expect(((await web.act(mgr, 'runSchedule', {})) as { ran: boolean }).ran).toBe(false);
    const notices = ds.webNotices.length;
    const again = (await web.act(mgr, 'runSchedule', { force: true })) as { sent: number; reviews: number; checks: number };
    expect(again).toMatchObject({ sent: 0, reviews: 0, checks: 0 });
    expect(ds.webNotices.length).toBe(notices);
    setClock(myt('2026-10-27', '10:30'));
    expect(((await web.act(mgr, 'runSchedule', {})) as { ran: boolean }).ran).toBe(true);
    const keys = ds.webNotices.map((n) => n.key).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reminds the renewal owner at each step and escalates an unconfirmed renewal', async () => {
    const { svc, web, ds } = fresh();
    const x = ds.webDomains.find((d) => d.renewalOwnerId)!;
    x.expiresOn = '2026-10-30';
    x.status = 'active';
    await web.act(await as(svc, 'u-it-mgr'), 'runSchedule', {});
    const mine = ds.webNotices.filter((n) => n.link.id === x.id && n.key);
    expect(mine.some((n) => n.toUserId === x.renewalOwnerId && /expires in 4 days/.test(n.title))).toBe(true);
    expect(mine.some((n) => n.toUserId === 'u-coo' && /Escalated/.test(n.title))).toBe(true);
    expect(mine.every((n) => n.delivery.email === 'not_connected')).toBe(true);
  });

  it('late company answers go to the IT Manager; old open reviews escalate to management', async () => {
    const { svc, web, ds, setClock } = fresh();
    const mgr = await as(svc, 'u-it-mgr');
    await web.act(mgr, 'runSchedule', {});
    const r = ds.webReviews.find((x) => x.quarter === quarterOf(TODAY).key && x.stage === 'request')!;
    setClock(myt('2027-01-10', '09:00'));
    await web.act(mgr, 'runSchedule', {});
    expect(ds.webNotices.some((n) => n.link.id === r.id && n.toUserId === 'u-it-mgr' && /Late/.test(n.title))).toBe(true);
    expect(ds.webNotices.some((n) => n.link.id === r.id && n.toUserId === 'u-coo' && /Escalated/.test(n.title))).toBe(true);
  });

  it('only IT or group management runs it, and only the IT Head or CEO by hand; it can be switched off', async () => {
    const { svc, web } = fresh();
    await expect(web.act(await as(svc, 'u-cm-arsh'), 'runSchedule', {})).rejects.toThrow(/IT or group/);
    await expect(web.act(await as(svc, 'u-it-ex1'), 'runSchedule', { force: true })).rejects.toThrow(/by hand/);
    await web.act(await as(svc, 'u-fauzan'), 'saveSettings', { autoSchedule: false });
    expect(((await web.act(await as(svc, 'u-it-ex1'), 'runSchedule', {})) as { ran: boolean }).ran).toBe(false);
  });
});

describe('website scheduling serialization and dedupe', () => {
  it('keeps one monthly summary when the overdue count falls', async () => {
    const {svc,web,ds}=fresh(); const mgr=await as(svc,'u-it-mgr');
    await web.act(mgr,'runSchedule',{});
    const summaries=()=>ds.webNotices.filter(n=>n.link.kind==='check'&&n.link.id==='2026-10'&&n.key?.startsWith('ck-'));
    const before=summaries().map(n=>n.id); expect(before.length).toBeGreaterThan(0);
    const unfinished=ds.webChecks.find(c=>c.month==='2026-10'&&!c.doneAt&&!c.na)!;
    unfinished.doneAt=NOW;
    await web.act(mgr,'runSchedule',{force:true});
    expect(summaries().map(n=>n.id)).toEqual(before);
  });
  it('authorizes before locking and shares the singleton lock with manual openings/settings',async()=>{
    const {svc,web,store}=fresh();const locks:string[]=[];
    Object.assign(store,{lock:async(table:string,id:string)=>{locks.push(`${table}:${id}`);}});
    await expect(web.act(await as(svc,'u-cm-arsh'),'runSchedule',{})).rejects.toThrow();expect(locks).toEqual([]);
    await web.act(await as(svc,'u-it-mgr'),'runSchedule',{});expect(locks[0]).toBe('webSettings:settings');
    locks.length=0;await web.act(await as(svc,'u-fauzan'),'saveSettings',{autoSchedule:true});expect(locks).toContain('webSettings:settings');
    locks.length=0;await web.act(await as(svc,'u-it-mgr'),'openReviews',{});expect(locks[0]).toBe('webSettings:settings');
    locks.length=0;await web.act(await as(svc,'u-it-mgr'),'openChecks',{assignToId:'u-it-ex1'});expect(locks[0]).toBe('webSettings:settings');
  });
});

describe('connectors (Fauzan, 31 Oct 2026)', () => {
  const on = async (svc: PrimaService, web: PrimaService['websites'], key: string) =>
    web.act(await as(svc, 'u-fauzan'), 'setConnector', { key, on: true, note: 'Approved by the CEO for testing' });

  it('switched-off connectors are ignored; only the CEO switches one on, with a comment', async () => {
    const { svc, web, ds } = fresh();
    const site = ds.webSites.find((s) => s.status === 'live')!;
    const mgr = await as(svc, 'u-it-mgr');
    const feed = { at: NOW, uptime: { ok: true as const, data: { monitors: [{ url: site.url, status: 'down' as const, since: NOW, sslExpiresOn: null }] } } };
    await web.syncFromFeed(mgr, feed);
    expect(ds.webIssues.some((i) => i.origin.kind === 'connector')).toBe(false);
    await expect(web.act(mgr, 'setConnector', { key: 'uptime', on: true, note: 'please' })).rejects.toThrow(/CEO/);
    await expect(web.act(await as(svc, 'u-fauzan'), 'setConnector', { key: 'uptime', on: true })).rejects.toThrow(/comment/);
    await on(svc, web, 'uptime');
    await web.syncFromFeed(mgr, feed);
    await web.syncFromFeed(mgr, feed);
    const down = ds.webIssues.filter((i) => i.origin.kind === 'connector' && i.siteId === site.id);
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ category: 'DOWN', severity: 'critical' });
    expect(ds.webSites.find((s) => s.id === site.id)!.observed?.uptime?.status).toBe('down');
    await expect(web.syncFromFeed(await as(svc, 'u-cm-arsh'), feed)).rejects.toThrow(/IT/);
  });

  it('a DNS change outside an approved change opens an issue; the IT Lead can accept it with a comment', async () => {
    const { svc, web, ds } = fresh();
    await on(svc, web, 'cloudflare');
    const dom = ds.webDomains[0];
    const mgr = await as(svc, 'u-it-mgr');
    const zone = (ip: string) => ({ at: NOW, cloudflare: { ok: true as const, data: { projects: [], zones: [{ name: dom.name, records: [{ type: 'A', name: dom.name, content: ip }] }] } } });
    await web.syncFromFeed(mgr, zone('1.1.1.1'));
    expect(ds.webDomains[0].observed?.dnsBaseline).toBeTruthy();
    expect(ds.webIssues.some((i) => i.domainId === dom.id && i.category === 'DOMAIN')).toBe(false);
    await web.syncFromFeed(mgr, zone('2.2.2.2'));
    expect(ds.webIssues.filter((i) => i.domainId === dom.id && i.category === 'DOMAIN')).toHaveLength(1);
    await expect(web.act(mgr, 'acceptDns', { domainId: dom.id, note: 'Looks fine' })).rejects.toThrow(/IT Lead/);
    await expect(web.act(await as(svc, 'u-it-lead'), 'acceptDns', { domainId: dom.id })).rejects.toThrow(/comment/);
    await web.act(await as(svc, 'u-it-lead'), 'acceptDns', { domainId: dom.id, note: 'Compared with the export: new host for the site' });
    await web.syncFromFeed(mgr, zone('2.2.2.2'));
    expect(ds.webIssues.filter((i) => i.domainId === dom.id && i.category === 'DOMAIN')).toHaveLength(1);
  });

  it('a registry expiry date that differs is flagged, never copied over the register', async () => {
    const { svc, web, ds } = fresh();
    await on(svc, web, 'registrar');
    const dom = ds.webDomains.find((d) => d.expiresOn && d.itAdminId)!;
    const before = dom.expiresOn;
    await web.syncFromFeed(await as(svc, 'u-it-mgr'), { at: NOW, registrar: { ok: true, data: { domains: [{ name: dom.name, expiresOn: '2030-01-01', registrar: 'Sample' }] } } });
    const after = ds.webDomains.find((d) => d.id === dom.id)!;
    expect(after.expiresOn).toBe(before);
    expect(after.observed?.registrar?.expiresOn).toBe('2030-01-01');
    expect(ds.webNotices.some((n) => n.link.id === dom.id && /registry shows/.test(n.title))).toBe(true);
  });

  it('a failed connector keeps what Prima already holds and records the error', async () => {
    const { svc, web, ds } = fresh();
    await on(svc, web, 'github');
    await web.syncFromFeed(await as(svc, 'u-it-mgr'), { at: NOW, github: { ok: false, error: '401 Bad credentials' } });
    const st = ds.webSettings[0].connectorState.github!;
    expect(st).toMatchObject({ ok: false, error: 'REQUEST_FAILED' });
  });

  it('SharePoint requests wait for the IT Manager; accepting with a comment opens an issue', async () => {
    const { svc, web, ds } = fresh();
    await on(svc, web, 'sharepoint');
    const site = ds.webSites.find((s) => s.status === 'live')!;
    const req = { id: 'sp-1', kind: 'change' as const, title: 'Update phone number', detail: 'New office line', siteUrl: site.url, requestedBy: 'Sample requester', at: NOW, link: 'https://example.invalid/sp-1' };
    const mgr = await as(svc, 'u-it-mgr');
    await web.syncFromFeed(mgr, { at: NOW, sharepoint: { ok: true, data: { requests: [req] } } });
    await web.syncFromFeed(mgr, { at: NOW, sharepoint: { ok: true, data: { requests: [req] } } });
    expect(ds.webSettings[0].spInbox).toHaveLength(1);
    await expect(web.act(await as(svc, 'u-it-lead'), 'spDecide', { id: 'sp-1', accept: true, note: 'ok' })).rejects.toThrow(/IT Manager/);
    await expect(web.act(mgr, 'spDecide', { id: 'sp-1', accept: true })).rejects.toThrow(/comment/);
    const res = (await web.act(mgr, 'spDecide', { id: 'sp-1', accept: true, note: 'Agreed with the company' })) as { issueId: string };
    expect(ds.webIssues.find((i) => i.id === res.issueId)).toMatchObject({ siteId: site.id, origin: { kind: 'sharepoint', id: 'sp-1' } });
  });

  it('website delivery remains unavailable even for legacy enabled settings', async () => {
    const {svc,web,ds}=fresh();const mgr=await as(svc,'u-it-mgr');
    await expect(on(svc,web,'m365')).rejects.toThrow(/unavailable/);
    await on(svc,web,'github');
    ds.webSettings[0].connectorsOn.m365=true;
    await web.act(mgr,'runSchedule',{});
    expect(await web.queuedDeliveries(mgr)).toEqual([]);
    expect(ds.webNotices.every(n=>n.delivery.email==='not_connected'&&n.delivery.teams==='not_connected')).toBe(true);
    await expect(web.markDeliveries(mgr,[])).rejects.toThrow(/unavailable/);
  });

  it('the Power BI feed is for group management and the IT Head only', async () => {
    const { svc, web, ds } = fresh();
    const feed = await web.powerBiFeed(await as(svc, 'u-coo'));
    expect(feed.sites).toHaveLength(ds.webSites.length);
    expect(JSON.stringify(feed)).not.toMatch(/vault/);
    await expect(web.powerBiFeed(await as(svc, 'u-it-ex1'))).rejects.toThrow(/group management/);
  });
});

describe('social media, email and IT tickets (Fauzan, 31 Oct 2026)', () => {
  it('flags weak social account set-ups and records an access review only with a comment', async () => {
    const { svc, web, ds } = fresh();
    const lead = await as(svc, 'u-it-lead');
    const b = await web.board(lead);
    if (!b.allowed) throw new Error('not allowed');
    const weak = b.social.find((a) => a.account.ownership === 'personal')!;
    expect(weak.flags).toEqual(expect.arrayContaining(['Fewer than two admins', 'An admin signs in with a personal email', 'Not held by a company business account', 'Recovery email is missing or personal']));
    await expect(web.act(lead, 'saveSocial', { companyId: weak.account.companyId, id: weak.account.id, platform: 'facebook', name: weak.account.name, note: 'password: abc123' })).rejects.toThrow(/password/);
    await expect(web.act(lead, 'reviewSocialAccess', { companyId: weak.account.companyId, id: weak.account.id })).rejects.toThrow(/comment/);
    await web.act(lead, 'saveSocial', {
      companyId: weak.account.companyId,
      id: weak.account.id,
      platform: 'facebook',
      name: weak.account.name,
      status: 'active',
      ownership: 'business_portfolio',
      holder: 'Company business portfolio (sample)',
      recoveryEmail: 'it@sample.com.my',
      lastPostOn: TODAY,
      admins: [
        { name: 'IT Lead (mock)', companyEmail: true, twoFactor: true },
        { name: 'Company admin (mock)', companyEmail: true, twoFactor: true },
      ],
    });
    await web.act(lead, 'reviewSocialAccess', { companyId: weak.account.companyId, id: weak.account.id, note: 'Former staff removed, two admins on company email', removed: 'Former marketing staff (mock)' });
    const after = ds.webCompanies.find((p) => p.companyId === weak.account.companyId)!.social!.find((a) => a.id === weak.account.id)!;
    expect(socialFlags(after, TODAY)).toEqual([]);
    await expect(web.act(await as(svc, 'u-cm-arsh'), 'saveSocial', { companyId: 'co-arsh', platform: 'facebook', name: 'x' })).rejects.toThrow(/IT/);
  });

  it('reads email health from DNS answers', () => {
    expect(mailHealthFromDns({ spf: 'v=spf1 include:spf.protection.outlook.com -all', dmarc: 'v=DMARC1; p=reject; rua=mailto:a@b.my', dkim: true, mx: ['x.mail.protection.outlook.com.'] })).toMatchObject({
      spf: 'unknown',
      dkim: 'unknown',
      dmarc: 'reject',
      dmarcReports: null,
      mx: 'm365',
    });
    expect(mailFlags(mailHealthFromDns({ spf: null, dmarc: 'v=DMARC1; p=none', dkim: false, mx: [] }))).toEqual(['No SPF record', 'DMARC only monitoring (p=none)', 'DMARC report collection not checked', 'No MX record', 'Some records not checked']);
  });

  it('the schedule opens social and email checks; a failed item opens an issue and an IT ticket, resolved together', async () => {
    const { svc, web, ds } = fresh();
    const mgr = await as(svc, 'u-it-mgr');
    await web.act(mgr, 'runSchedule', {});
    const social = ds.webChecks.find((c) => c.kind === 'social' && c.month === '2026-10')!;
    const mail = ds.webChecks.find((c) => c.kind === 'mail' && c.month === '2026-10')!;
    expect(social.items.map((i) => i.key)).toContain('twofa');
    expect(mail.items.map((i) => i.key)).toContain('dmarc');
    await web.act(mgr, 'recordCheck', { checkId: mail.id, results: [{ key: 'dmarc', result: 'fail', note: 'p=none only' }] });
    const issue = ds.webIssues.find((i) => i.origin.kind === 'check' && i.origin.id === mail.id)!;
    expect(issue).toMatchObject({ category: 'EMAIL', severity: 'high', domainId: mail.siteId });
    const ticket = ds.itTickets.find((t) => t.id === issue.itTicketId)!;
    expect(ticket).toMatchObject({ category: 'EMAIL', priority: 'P2', status: 'open', sourceRef: `web:${issue.id}` });
    await svc.itAct(mgr,'assignTicket',{id:issue.itTicketId,toId:mgr.id});
    await web.act(mgr, 'issueStep', { issueId: issue.id, step: 'resolve', note: 'DMARC moved to quarantine', evidence: 'DNS lookup screenshot' });
    expect(ds.itTickets.find((t) => t.id === ticket.id)!.status).toBe('resolved');
  });

  it('mailbox and email reviews need a comment; the IT Head sees one line for social and one for email', async () => {
    const { svc, web } = fresh();
    const mgr = await as(svc, 'u-it-mgr');
    await expect(web.act(mgr, 'saveMailboxes', { companyId: 'co-arsh', licensed: 5 })).rejects.toThrow(/comment/);
    await web.act(mgr, 'saveMailboxes', { companyId: 'co-arsh', licensed: 5, shared: 1, leaversPending: 0, nearFull: 0, forwardingOutside: 0, note: 'Checked in the Microsoft 365 admin centre' });
    const b = await web.board(mgr);
    if (!b.allowed) throw new Error('not allowed');
    expect(b.todo.filter((t) => /social media account/.test(t.text))).toHaveLength(1);
    expect(b.mailboxes.find((m) => m.companyId === 'co-arsh')?.flags ?? []).toEqual([]);
  });

  it('the email DNS connector updates email health and says what changed', async () => {
    const { svc, web, ds } = fresh();
    await web.act(await as(svc, 'u-fauzan'), 'setConnector', { key: 'maildns', on: true, note: 'Approved for testing' });
    const dom = ds.webDomains.find((x) => x.m365Email && x.mail?.spf === 'pass')!;
    await web.syncFromFeed(await as(svc, 'u-it-mgr'), { at: NOW, maildns: { ok: true, data: { domains: [{ name: dom.name, spf: null, dmarc: 'v=DMARC1; p=quarantine; rua=mailto:x@y.my', dkim: true, mx: ['a.mail.protection.outlook.com'] }] } } });
    expect(ds.webDomains.find((x) => x.id === dom.id)!.mail).toMatchObject({ spf: 'missing', source: 'dns' });
    expect(ds.webNotices.some((n) => n.link.id === dom.id && /No SPF record/.test(n.title))).toBe(true);
  });
});

describe('reconstructed pilot safety and requester decision',()=>{
  it('keeps foreign-company inbox and connector metadata out of the entire scoped response',async()=>{
    const {svc,web,ds}=fresh();const ceo=await as(svc,'u-fauzan');
    await web.act(ceo,'setConnector',{key:'github',on:true,note:'Synthetic test only'});
    const sentinel='FOREIGN_PRIVATE_SENTINEL';
    ds.webSettings[0].spInbox=[{id:sentinel,title:sentinel,detail:sentinel,state:'new'} as any];
    ds.webSettings[0].connectorState.github={lastSync:NOW,ok:false,error:sentinel,matched:0,unmatched:[sentinel]};
    const b=await web.board(await as(svc,'u-cm-arsh'));
    expect(JSON.stringify(b)).not.toContain(sentinel);
    expect(JSON.stringify(await web.board(await as(svc,'u-it-mgr')))).toContain(sentinel);
  });
  it('refuses foreign and unrelated issue notes',async()=>{
    const {svc,web,ds}=fresh();const issue=await web.act(await as(svc,'u-it-mgr'),'raiseIssue',{companyId:'co-arsh',description:'Synthetic note boundary',severity:'normal',ownerId:'u-it-ex1'}) as {id:string};
    const before=JSON.stringify(ds.webIssues.find(x=>x.id===issue.id));
    for(const id of ['u-hoc-01','u-cms-head'])await expect(web.act(await as(svc,id),'issueStep',{issueId:issue.id,step:'note',note:'Forbidden note'})).rejects.toThrow();
    expect(JSON.stringify(ds.webIssues.find(x=>x.id===issue.id))).toBe(before);
  });
  it('keeps requester open/history visible and denies Manager/Lead confirmation substitution',async()=>{
    const {svc,web,ds}=fresh();const requester=await as(svc,'u-ae-arsh');const lead=await as(svc,'u-it-lead');
    const issue=await web.act(requester,'raiseIssue',{companyId:'co-arsh',description:'Synthetic requester-owned defect',severity:'normal'}) as {id:string;itTicketId:string};
    const mine=async()=> (await svc.itBoard(requester)).mine.find(t=>t.id===issue.itTicketId);
    expect(await mine()).toMatchObject({status:'open',canConfirm:false});
    await expect(svc.confirmItTicket(requester,issue.itTicketId,true)).rejects.toThrow(/checker/);
    await svc.itAct(await as(svc,'u-it-mgr'),'assignTicket',{id:issue.itTicketId,toId:lead.id});
    await svc.itTicketStep(lead,issue.itTicketId,'take');
    expect(ds.webIssues.find(x=>x.id===issue.id)?.status).toBe('in_progress');
    await svc.itTicketStep(lead,issue.itTicketId,'resolve','Synthetic fix');
    expect(await mine()).toMatchObject({status:'resolved',canConfirm:true});
    for(const id of ['u-it-mgr','u-it-lead'])await expect(svc.confirmItTicket(await as(svc,id),issue.itTicketId,true)).rejects.toThrow(/checker/);
    await svc.confirmItTicket(requester,issue.itTicketId,true,'Verified evidence',1);
    expect(await mine()).toMatchObject({confirmedAt:NOW,canConfirm:false});
    expect(ds.webIssues.find(x=>x.id===issue.id)?.status).toBe('closed');
    await expect(svc.confirmItTicket(requester,issue.itTicketId,true)).rejects.toThrow(/checker/);
  });
  it('clears old confirmations on explicit reopen and can confirm another fix',async()=>{
    const {svc,web,ds}=fresh();const reporter=await as(svc,'u-it-mgr'),fixer=await as(svc,'u-it-lead');
    const issue=await web.act(reporter,'raiseIssue',{companyId:'co-arsh',description:'Synthetic recurring defect',severity:'normal',ownerId:fixer.id}) as {id:string;itTicketId:string};
    const resolve=()=>web.act(fixer,'issueStep',{issueId:issue.id,step:'resolve',note:'Fixed again',evidence:'Synthetic proof'});
    await resolve();await svc.confirmItTicket(reporter,issue.itTicketId,true,'Verified evidence',ds.itTickets.find(t=>t.id===issue.itTicketId)!.webResolutionVersion);
    await expect(web.act(fixer,'issueStep',{issueId:issue.id,step:'start'})).rejects.toThrow(/open/);
    await web.act(reporter,'issueStep',{issueId:issue.id,step:'reopen',note:'Issue returned',expectedResolutionVersion:1});
    expect(ds.itTickets.find(x=>x.id===issue.itTicketId)).toMatchObject({status:'open',confirmedAt:null,confirmedVia:null,resolvedById:null,resolution:''});
    await resolve();await svc.confirmItTicket(reporter,issue.itTicketId,true,'Verified evidence',ds.itTickets.find(t=>t.id===issue.itTicketId)!.webResolutionVersion);
    expect(ds.webIssues.find(x=>x.id===issue.id)?.status).toBe('closed');
  });
  it('serializes parallel social additions and connector settings without lost updates',async()=>{
    const {svc,web,ds}=fresh();const mgr=await as(svc,'u-it-mgr'),ceo=await as(svc,'u-fauzan');
    await Promise.all(['First synthetic','Second synthetic'].map(name=>web.act(mgr,'saveSocial',{companyId:'co-arsh',platform:'facebook',name})));
    const rows=ds.webCompanies.find(x=>x.companyId==='co-arsh')!.social!.filter(x=>x.name.endsWith('synthetic'));
    expect(rows).toHaveLength(2);expect(new Set(rows.map(x=>x.id)).size).toBe(2);
    await Promise.all(['github','uptime'].map(key=>web.act(ceo,'setConnector',{key,on:true,note:'Synthetic enable'})));
    expect(ds.webSettings[0].connectorsOn).toMatchObject({github:true,uptime:true});
  });
  it('rejects group reads by scoped executives and integration identities',async()=>{
    const {svc,web}=fresh();await expect(web.syncFromFeed(await as(svc,'u-it-ex1'),{at:NOW})).rejects.toThrow(/IT Head/);
    const mgr=await as(svc,'u-it-mgr');await expect(web.powerBiFeed({...mgr,integration:true} as any)).rejects.toThrow(/connected app/);
  });
  it('treats unknown activity and mailbox evidence as unknown, not clean or inactive',()=>{
    const {ds}=fresh();const social=ds.webCompanies.flatMap(x=>x.social??[])[0];
    expect(socialFlags({...social,status:'active',lastPostOn:null},TODAY)).toContain('Last post date not recorded: verify activity');
    expect(socialFlags({...social,status:'active',lastPostOn:null},TODAY).join(' ')).not.toMatch(/90 days: post|180/);
    expect(mailFlags({spf:'pass',dkim:'on',dmarc:'reject',dmarcReports:null,mx:'m365',source:'manual',checkedAt:NOW,checkedBy:'Synthetic'})).toContain('DMARC report collection not checked');
    expect(mailboxFlags({licensed:null,shared:null,leaversPending:null,nearFull:null,forwardingOutside:null,reviewedAt:NOW,reviewedBy:'Synthetic',note:'Synthetic'},TODAY)).toContain('Some mailbox risk checks not checked');
  });
});

describe('reconstructed DNS and stale lifecycle regressions',()=>{
  it('does not accept unrelated DNS drift merely because a newer plan was approved',async()=>{
    const {svc,web,ds}=fresh();const ceo=await as(svc,'u-fauzan'),mgr=await as(svc,'u-it-mgr');
    await web.act(ceo,'setConnector',{key:'cloudflare',on:true,note:'Synthetic feed only'});
    const dom=ds.webDomains[0];const at=(hour:string)=>myt(TODAY,hour);
    const feed=(time:string,ip:string)=>({at:at(time),cloudflare:{ok:true as const,data:{projects:[],zones:[{name:dom.name,records:[{type:'A',name:dom.name,content:ip}]}]}}});
    await web.syncFromFeed(mgr,feed('10:30','1.1.1.1'));
    const baseline=ds.webDomains.find(x=>x.id===dom.id)!.observed!.dnsBaseline!;
    ds.webDnsChanges.push({id:'synthetic-approved-unrelated',domainId:dom.id,status:'approved',approval:{at:at('11:00')}} as any);
    expect(Date.parse(at('11:00'))).toBeGreaterThan(Date.parse(baseline.at));
    await web.syncFromFeed(mgr,feed('11:30','2.2.2.2'));
    expect(ds.webDomains.find(x=>x.id===dom.id)!.observed!.dnsBaseline).toEqual(baseline);
    expect(ds.webIssues.some(x=>x.domainId===dom.id&&x.category==='DOMAIN')).toBe(true);
    await web.syncFromFeed(mgr,feed('10:45','3.3.3.3'));
    expect(ds.webDomains.find(x=>x.id===dom.id)!.observed!.dns!.at).toBe(at('11:30'));
  });
  it('legacy resolved ticket mismatch cannot preserve the old resolver or confirmation',async()=>{
    const {svc,web,ds}=fresh();const mgr=await as(svc,'u-it-mgr'),lead=await as(svc,'u-it-lead');
    const issue=await web.act(mgr,'raiseIssue',{companyId:'co-arsh',description:'Synthetic legacy mismatch',severity:'normal',ownerId:lead.id}) as {id:string;itTicketId:string};
    const ticket=ds.itTickets.find(x=>x.id===issue.itTicketId)!;
    Object.assign(ticket,{status:'resolved',confirmedAt:NOW,confirmedVia:'Old confirmation',resolvedById:mgr.id,resolvedBy:mgr.name,resolvedAt:NOW,resolution:'Old fix'});
    await expect(web.act(lead,'issueStep',{issueId:issue.id,step:'resolve',note:'Cannot bypass legacy reopen',evidence:'Proof'})).rejects.toThrow();
    await web.act(mgr,'issueStep',{issueId:issue.id,step:'reopen',note:'Explicit legacy evidence review',expectedResolutionVersion:0});
    await web.act(lead,'issueStep',{issueId:issue.id,step:'resolve',note:'New real fix',evidence:'Synthetic fresh evidence'});
    expect(ds.itTickets.find(x=>x.id===issue.itTicketId)).toMatchObject({resolvedById:lead.id,confirmedAt:null,confirmedVia:null});
    await svc.confirmItTicket(mgr,issue.itTicketId,true,'Verified new evidence',1);
    expect(ds.webIssues.find(x=>x.id===issue.id)?.status).toBe('closed');
  });
});
