// SAMPLE DATA ONLY for the group website module: made-up domains, websites and owners for testing. Not company records.
// The spread is deliberate: live sites, domains with no site, companies with neither, one company with two websites,
// one website with two domains, one domain shared by two companies, one Head of Company over two companies, renewals
// due, an expired and an unknown domain, an overdue review, a failed check and a pending DNS change.

import { GROUP_EMPLOYER_ID } from './access';
import { addDays, fromMs, toMs } from './time';
import type { Dataset, Id, IsoDate, IsoDateTime, User } from './types';
import { MONTHLY_ITEMS, REVIEW_TESTS, REVIEW_TOPICS, WEB_DEFAULTS, previousQuarter, quarterOf, type WebDomain, type WebReview, type WebSite, type WebTest } from './websites';

const IT = ['u-it-ex1', 'u-it-ex2', 'u-it-ex3', 'u-it-ex4', 'u-it-lead'];

/** Two sample business users: one Head of Company over two companies, and the content owner for both. Added with the
 * other sign-ins so they get their own staff record like everyone else. */
export function websiteSampleUsers(ds: Dataset): void {
  const two = ['co-04', 'co-05'].filter((id) => ds.companies.some((c) => c.id === id));
  const extra: User[] = [
    { id: 'u-hoc-01', name: 'Head of Company 01 (sample)', title: 'Company Manager, heads two companies (sample)', role: 'company_manager', companyIds: two, siteIds: [] },
    { id: 'u-web-owner-01', name: 'Content Owner 01 (sample)', title: 'Admin Executive, website content owner for two companies (sample)', role: 'admin_exec', companyIds: two, siteIds: [] },
  ];
  ds.users.push(...extra);
  for (const c of ds.companies) if (two.includes(c.id)) c.headOfCompany = 'Head of Company 01 (sample)';
  // Each sign-in has its own staff record (Fauzan, 26 Oct 2026). Someone heading two companies is kept on the
  // central PWVSB staff list rather than on one company's books (sample assumption).
  const home = GROUP_EMPLOYER_ID;
  const branchId = 'br-pwvsb-hq';
  extra.forEach((u, k) => {
    const id = `pr-pwvsb-web${k + 1}`;
    ds.people.push({
      id,
      companyId: home,
      branchId,
      staffNo: `PWVW${String(k + 1).padStart(2, '0')}`,
      name: u.name,
      nationality: 'MY',
      idMasked: `80010${k + 1}-**-***${k + 1}`,
      dob: `1980-01-0${k + 1}` as IsoDate,
      phone: '012-000 0000',
      role: 'office',
      status: 'active',
      hiredOn: '2020-01-02' as IsoDate,
      faceEnrolledOn: null,
      basicPay: k ? 3200 : 6500,
      jobTitle: k ? 'Admin Executive' : 'Company Manager',
    });
    u.personId = id;
  });
}

export function seedWebsites(ds: Dataset, today: IsoDate, now: IsoDateTime): void {
  const nowMs = toMs(now);
  const ago = (days: number) => fromMs(nowMs - days * 86_400_000);
  const q = quarterOf(today);
  const prevKey = previousQuarter(q.key);
  const prev = quarterOf(addDays(q.start, -1));
  const month = today.slice(0, 7);

  const two = ['co-04', 'co-05'].filter((id) => ds.companies.some((c) => c.id === id));

  const owners: Record<Id, { content: Id | null; approver: Id | null }> = {
    'co-sasa': { content: 'u-gm-sasa', approver: 'u-cm-sasa' },
    'co-arsh': { content: 'u-ae-arsh', approver: 'u-cm-arsh' },
    'co-inas': { content: null, approver: 'u-cm-inas' },
    'co-04': { content: 'u-web-owner-01', approver: 'u-hoc-01' },
    'co-05': { content: 'u-web-owner-01', approver: 'u-hoc-01' },
  };

  let domainNo = 0;
  const addDomain = (name: string, companyIds: Id[], days: number | null, extraFields: Partial<WebDomain> = {}): WebDomain => {
    domainNo += 1;
    const itAdminId = IT[domainNo % 4];
    const d: WebDomain = {
      id: `wd-${domainNo}`,
      name,
      companyIds,
      primary: true,
      registrar: domainNo % 3 === 0 ? 'MYNIC via Exabytes' : 'GoDaddy',
      status: days == null ? 'unknown' : days < 0 ? 'expired' : 'active',
      registeredOn: days == null ? null : addDays(today, -365 * (1 + (domainNo % 4)) + days),
      expiresOn: days == null ? null : addDays(today, days),
      renewOn: days == null ? null : addDays(today, Math.max(days - 14, -1)),
      autoRenew: domainNo % 4 === 0 ? 'on' : domainNo % 4 === 1 ? 'off' : 'unknown',
      renewalAmount: domainNo % 5 === 0 ? null : name.endsWith('.my') ? 90 : 75,
      currency: 'MYR',
      renewalOwnerId: domainNo % 6 === 5 ? null : 'u-fin-t1-lead',
      accountOwner: 'CEO (owner and master administrator); IT Department operates it',
      dnsProvider: domainNo % 2 ? 'Cloudflare' : 'GoDaddy',
      nameservers: domainNo % 2 ? ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'] : ['ns51.domaincontrol.com', 'ns52.domaincontrol.com'],
      m365Email: domainNo % 3 !== 2,
      itAdminId,
      backupId: domainNo % 7 === 3 ? null : IT[(domainNo + 1) % 4],
      lastVerifiedOn: days == null ? null : addDays(today, -(domainNo % 40)),
      vault: { manager: 'Company password manager (to be named)', entry: `Registrar / ${name}`, access: 'IT Manager and IT Lead' },
      receiptRef: days == null ? '' : `Sample receipt ${name}`,
      note: 'Sample data',
      renewals: [],
      payment: days != null && days <= 60 ? { status: 'unpaid', ref: '', by: 'Finance Team Leader 1', at: ago(3) } : null,
      ...extraFields,
    };
    ds.webDomains.push(d);
    return d;
  };

  let siteNo = 0;
  const addSite = (companyId: Id, name: string, url: string, domainIds: Id[], status: WebSite['status'], extraFields: Partial<WebSite> = {}): WebSite => {
    siteNo += 1;
    const s: WebSite = {
      id: `ws-${siteNo}`,
      name,
      companyId,
      purpose: 'Company profile and enquiries',
      status,
      url,
      domainIds,
      hosting: { provider: 'Cloudflare Pages', project: url.replace(/^https?:\/\//, '').replace(/\./g, '-'), plan: 'Free', free: true, customDomain: true },
      deploy: siteNo % 3 === 0 ? 'direct_upload' : 'github',
      repoRef: siteNo % 3 === 0 ? '' : `GitHub (group IT organisation) / site-${siteNo}`,
      sourceRef: 'SharePoint > IT > Websites',
      itAdminId: null,
      backupId: null,
      contentOwnerId: null,
      approverId: null,
      contact: { phone: '+60 3-0000 0000 (sample)', email: 'enquiry@example.invalid', whatsapp: siteNo % 2 ? '+60 12-000 0000 (sample)' : '' },
      form: siteNo % 2 ? { present: true, provider: 'Formspree (free tier)', recipient: 'enquiry mailbox (sample)' } : { present: false, provider: '', recipient: '' },
      https: { ok: status === 'live' ? true : null, checkedOn: status === 'live' ? addDays(today, -(siteNo % 20)) : null },
      claims: 'KDN licence number and ISO 9001 claim shown on the About page',
      cost: { hosting: 0, extras: siteNo % 2 ? 'Contact form service (free tier, limits apply)' : '', ownerId: null },
      recovery: { lastGoodVersion: `v${siteNo}.0 (sample)`, instructionsRef: 'SharePoint > IT > Websites > Recovery' },
      vault: { manager: 'Company password manager (to be named)', entry: `Cloudflare / ${name}`, access: 'IT Manager and IT Lead' },
      reviewException: null,
      note: 'Sample data',
      ...extraFields,
    };
    ds.webSites.push(s);
    return s;
  };

  // Company set-up and records.
  ds.companies.forEach((c, n) => {
    const code = c.id.replace('co-', '');
    const o = owners[c.id] ?? { content: null, approver: null };
    const pattern = c.isPilot || two.includes(c.id) ? 'live' : n % 5 === 0 ? 'none' : n % 5 === 1 ? 'domain_only' : 'live';
    ds.webCompanies.push({
      id: `wc-${c.id}`,
      companyId: c.id,
      websiteRequired: pattern === 'none' ? (n % 10 === 0 ? 'no' : 'under_review') : 'yes',
      notRequired: pattern === 'none' && n % 10 === 0 ? { reason: 'Dormant for tenders; uses the group website (sample)', by: 'Ahmad Faisal bin Zainal', byId: 'u-coo', at: ago(40) } : null,
      itAdminId: pattern === 'none' ? null : IT[n % 4],
      backupId: pattern === 'none' || n % 7 === 3 ? null : IT[(n + 1) % 4],
      contentOwnerId: o.content,
      approverId: o.approver,
      note: 'Sample data',
    });
    if (pattern === 'none') return;
    const days = n === 8 ? -4 : n === 6 ? 5 : n === 11 ? 25 : n === 13 ? 50 : n === 16 ? null : 90 + ((n * 37) % 600);
    const dom = addDomain(`${code}-security.com.my`, [c.id], days);
    if (pattern === 'domain_only') {
      if (n % 2) addSite(c.id, `${c.name} website`, `https://www.${dom.name}`, [dom.id], 'development', { itAdminId: IT[n % 4] });
      return;
    }
    if (c.id === 'co-sasa') {
      const second = addDomain('sasa.my', [c.id], 210, { primary: false });
      addSite(c.id, 'Sasa corporate website', `https://www.${dom.name}`, [dom.id, second.id], 'live');
      const careers = addDomain('jobs-sasa-security.com.my', [c.id], 320);
      addSite(c.id, 'Sasa careers site', `https://${careers.name}`, [careers.id], 'live', { purpose: 'Recruitment of guards' });
      return;
    }
    addSite(c.id, `${c.name} website`, `https://www.${dom.name}`, [dom.id], n === 9 ? 'offline' : 'live');
  });
  // One domain shared by the two companies under the same Head of Company.
  if (two.length === 2) addDomain('pwvsb-guarding.com.my', two, 140, { primary: false, note: 'Shared by two companies under one group arrangement (sample)' });

  // Quarterly reviews: last quarter mostly completed, one left unanswered (overdue); this quarter at every stage.
  const tests = (all: 'pass' | null, fail?: string, issueId?: Id): WebTest[] =>
    REVIEW_TESTS.map(([key]) => ({
      key,
      result: key === fail ? 'fail' : all,
      note: key === fail ? 'Test enquiry not received (sample)' : '',
      evidence: all ? 'Screenshot in SharePoint (sample)' : '',
      by: all ? 'IT Executive 1 (mock)' : null,
      at: all ? ago(2) : null,
      issueId: key === fail ? (issueId ?? null) : null,
      correction: '',
    }));
  const review = (site: WebSite, quarter: string, stage: WebReview['stage'], at: IsoDateTime, patch: Partial<WebReview> = {}): WebReview => {
    const qq = quarter === q.key ? q : prev;
    const r: WebReview = {
      id: `wr-${quarter}-${site.id}`,
      siteId: site.id,
      companyId: site.companyId,
      quarter,
      openedAt: at,
      openedBy: 'IT Manager (mock)',
      responseDue: addDays(qq.start, WEB_DEFAULTS.responseDays),
      approvalDue: addDays(qq.start, WEB_DEFAULTS.approvalDays),
      completeDue: qq.end,
      stage,
      needsHelp: false,
      response: null,
      changes: [],
      verified: null,
      preparation: null,
      approvals: [],
      publication: null,
      tests: tests(null),
      completed: null,
      history: [{ at, by: 'IT Manager (mock)', text: 'Review opened' }],
      ...patch,
    };
    ds.webReviews.push(r);
    return r;
  };
  const prevOpen = fromMs(toMs(`${prev.start}T09:00:00+08:00` as IsoDateTime));
  const curOpen = (`${q.start}T09:00:00+08:00` as IsoDateTime) > now ? now : (`${q.start}T09:00:00+08:00` as IsoDateTime);
  const respondedNoChange = (byId: Id, by: string, at: IsoDateTime) => ({
    outcome: 'no_changes' as const,
    topics: REVIEW_TOPICS.map(([k]) => k),
    note: '',
    by,
    byId,
    at,
    reusedFrom: null,
  });
  const nameOf = (id: Id | null) => ds.users.find((u) => u.id === id)?.name ?? 'Sample user';

  const live = ds.webSites.filter((s) => s.status === 'live');
  for (const s of live) {
    const o = owners[s.companyId];
    // Last quarter.
    if (s.companyId === 'co-04') review(s, prevKey, 'request', prevOpen);
    else if (o || live.indexOf(s) % 3 === 0) {
      const doneAt = fromMs(toMs(`${prev.end}T15:00:00+08:00` as IsoDateTime) - 5 * 86_400_000);
      review(s, prevKey, 'done', prevOpen, {
        response: respondedNoChange(o?.content ?? 'u-it-mgr', nameOf(o?.content ?? null), prevOpen),
        verified: { by: nameOf(o?.approver ?? null), byId: o?.approver ?? 'u-it-mgr', at: prevOpen },
        approvals: [{ decision: 'approve', note: '', by: nameOf(o?.approver ?? null), byId: o?.approver ?? 'u-it-mgr', at: prevOpen }],
        tests: tests('pass'),
        completed: { by: 'IT Executive 1 (mock)', at: doneAt, outstanding: [] },
      });
    }
  }

  const sasaCorp = ds.webSites.find((s) => s.name === 'Sasa corporate website');
  const sasaJobs = ds.webSites.find((s) => s.name === 'Sasa careers site');
  const arsh = live.find((s) => s.companyId === 'co-arsh');
  const co05 = live.find((s) => s.companyId === 'co-05');
  // This quarter.
  for (const s of live) {
    if (s === sasaCorp)
      review(s, q.key, 'approval', curOpen, {
        response: { outcome: 'changes', topics: ['address'], note: '', by: nameOf('u-gm-sasa'), byId: 'u-gm-sasa', at: ago(4), reusedFrom: null },
        changes: [
          {
            page: 'Contact us',
            existing: 'Old office address in Shah Alam (sample)',
            proposed: 'New office address in Petaling Jaya (sample)',
            reason: 'Office moved',
            docRef: 'Tenancy agreement (sample)',
            verifiedBy: 'Hamdan bin Yusof',
            compliance: false,
            complianceDecision: null,
          },
        ],
        verified: { by: nameOf('u-cm-sasa'), byId: 'u-cm-sasa', at: ago(3) },
        preparation: {
          previewUrl: 'https://preview-123.sasa-security.pages.dev (sample)',
          previousVersion: 'Deployment v14 (sample)',
          desktopOk: true,
          mobileOk: true,
          summary: 'Office address updated on Contact us and footer',
          by: 'IT Executive 1 (mock)',
          at: ago(1),
        },
        history: [
          { at: curOpen, by: 'IT Manager (mock)', text: 'Review opened' },
          { at: ago(4), by: nameOf('u-gm-sasa'), text: '1 change asked' },
          { at: ago(3), by: nameOf('u-cm-sasa'), text: 'Content verified as accurate' },
          { at: ago(1), by: 'IT Executive 1 (mock)', text: 'Preview ready' },
        ],
      });
    else if (s === sasaJobs) review(s, q.key, 'request', curOpen);
    else if (s === arsh)
      review(s, q.key, 'verify', curOpen, {
        response: respondedNoChange('u-ae-arsh', nameOf('u-ae-arsh'), ago(2)),
        history: [
          { at: curOpen, by: 'IT Manager (mock)', text: 'Review opened' },
          { at: ago(2), by: nameOf('u-ae-arsh'), text: 'Reviewed, no changes' },
        ],
      });
    else if (s === co05) {
      const issueId = 'wi-seed-form';
      review(s, q.key, 'test', curOpen, {
        response: respondedNoChange('u-web-owner-01', nameOf('u-web-owner-01'), ago(6)),
        verified: { by: nameOf('u-hoc-01'), byId: 'u-hoc-01', at: ago(5) },
        approvals: [{ decision: 'approve', note: '', by: nameOf('u-hoc-01'), byId: 'u-hoc-01', at: ago(5) }],
        tests: tests('pass', 'recipient', issueId).map((t) => (t.key === 'm365' ? { ...t, result: 'na', note: 'No DNS change this quarter' } : t.key === 'form' ? { ...t, result: null, by: null, at: null } : t)),
      });
      ds.webIssues.push({
        id: issueId,
        ref: 'WEB-0001',
        companyId: s.companyId,
        siteId: s.id,
        domainId: null,
        category: 'FORM',
        description: `Contact form enquiries not reaching the company mailbox (${s.name})`,
        severity: 'high',
        reportedBy: 'IT Executive 1 (mock)',
        reportedById: 'u-it-ex1',
        at: ago(2),
        ownerId: 'u-it-ex1',
        impact: 'Client enquiries may be lost',
        immediateAction: 'Phone number shown more prominently',
        escalateToId: null,
        targetOn: addDays(today, 1),
        status: 'in_progress',
        resolution: null,
        origin: { kind: 'review', id: `wr-${q.key}-${s.id}` },
        urgent: null,
        history: [{ at: ago(2), by: 'IT Executive 1 (mock)', text: 'Reported' }],
      });
    } else if (live.indexOf(s) % 4 === 1) {
      const o = owners[s.companyId];
      review(s, q.key, 'done', curOpen, {
        response: respondedNoChange(o?.content ?? 'u-it-mgr', nameOf(o?.content ?? null), ago(10)),
        verified: { by: 'IT Manager (mock)', byId: 'u-it-mgr', at: ago(9) },
        approvals: [{ decision: 'approve', note: '', by: 'IT Manager (mock)', byId: 'u-it-mgr', at: ago(9) }],
        tests: tests('pass'),
        completed: { by: 'IT Executive 2 (mock)', at: ago(8), outstanding: [] },
      });
    } else review(s, q.key, 'request', curOpen);
  }

  // Monthly checks for this month: some done, one failed, the rest waiting.
  const monthly = (s: WebSite, k: number) => {
    const done = k % 3 !== 2;
    const fail = k === 3;
    ds.webChecks.push({
      id: `wk-${month}-${s.id}`,
      siteId: s.id,
      companyId: s.companyId,
      month,
      assignedToId: null,
      items: MONTHLY_ITEMS.map(([key]) => ({
        key,
        result: done ? (fail && key === 'tel' ? 'fail' : key === 'whatsapp' && !s.contact.whatsapp ? 'na' : 'pass') : null,
        note: fail && key === 'tel' ? 'Phone link dials an old number (sample)' : '',
        issueId: fail && key === 'tel' ? 'wi-seed-tel' : null,
      })),
      na: null,
      doneBy: done ? 'IT Executive 2 (mock)' : null,
      doneAt: done ? ago(1) : null,
      source: 'manual',
    });
    if (fail)
      ds.webIssues.push({
        id: 'wi-seed-tel',
        ref: 'WEB-0002',
        companyId: s.companyId,
        siteId: s.id,
        domainId: null,
        category: 'WRONG_INFO',
        description: `Telephone link dials an old number (${s.name})`,
        severity: 'normal',
        reportedBy: 'IT Executive 2 (mock)',
        reportedById: 'u-it-ex2',
        at: ago(1),
        ownerId: null,
        impact: 'Callers reach a number no longer used',
        immediateAction: '',
        escalateToId: null,
        targetOn: addDays(today, 4),
        status: 'open',
        resolution: null,
        origin: { kind: 'check', id: `wk-${month}-${s.id}` },
        urgent: null,
        history: [{ at: ago(1), by: 'IT Executive 2 (mock)', text: 'Reported' }],
      });
  };
  live.forEach((s, k) => monthly(s, k));

  // An offline website with a critical issue, and an expired domain.
  const offline = ds.webSites.find((s) => s.status === 'offline');
  if (offline)
    ds.webIssues.push({
      id: 'wi-seed-down',
      ref: 'WEB-0003',
      companyId: offline.companyId,
      siteId: offline.id,
      domainId: null,
      category: 'DOWN',
      description: `Website not loading (${offline.name})`,
      severity: 'critical',
      reportedBy: 'IT Executive 3 (mock)',
      reportedById: 'u-it-ex3',
      at: fromMs(nowMs - 3 * 3_600_000),
      ownerId: 'u-it-ex3',
      impact: 'Clients and tender evaluators cannot see the company profile',
      immediateAction: 'Checking the Cloudflare project and DNS records',
      escalateToId: 'u-coo',
      targetOn: today,
      status: 'open',
      resolution: null,
      origin: { kind: 'manual', id: null },
      urgent: null,
      history: [{ at: fromMs(nowMs - 3 * 3_600_000), by: 'IT Executive 3 (mock)', text: 'Reported' }],
    });
  const expired = ds.webDomains.find((d) => d.status === 'expired');
  if (expired)
    ds.webIssues.push({
      id: 'wi-seed-expired',
      ref: 'WEB-0004',
      companyId: expired.companyIds[0],
      siteId: null,
      domainId: expired.id,
      category: 'DOMAIN',
      description: `Domain ${expired.name} expired; renewal not confirmed`,
      severity: 'high',
      reportedBy: 'IT Manager (mock)',
      reportedById: 'u-it-mgr',
      at: ago(1),
      ownerId: expired.itAdminId,
      impact: 'Website and company email on this domain may stop',
      immediateAction: 'Finance asked to pay the renewal today',
      escalateToId: 'u-coo',
      targetOn: today,
      status: 'open',
      resolution: null,
      origin: { kind: 'manual', id: null },
      urgent: null,
      history: [{ at: ago(1), by: 'IT Manager (mock)', text: 'Reported' }],
    });

  // DNS change control: one waiting for checks and approval on a domain with Microsoft 365 email, one done.
  const m365 = ds.webDomains.find((d) => d.m365Email && d.dnsProvider === 'GoDaddy' && d.status === 'active');
  if (m365)
    ds.webDnsChanges.push({
      id: 'wdns-seed-1',
      ref: 'DNS-001',
      domainId: m365.id,
      reason: 'Move nameservers from GoDaddy to Cloudflare for the new Cloudflare Pages website (sample)',
      windowFrom: `${addDays(today, 5)}T22:00:00+08:00` as IsoDateTime,
      windowTo: `${addDays(today, 5)}T23:59:00+08:00` as IsoDateTime,
      ownerId: m365.itAdminId ?? 'u-it-ex1',
      raisedBy: 'IT Executive (mock)',
      raisedById: m365.itAdminId ?? 'u-it-ex1',
      at: ago(1),
      pre: [
        { key: 'current', doneAt: ago(1), by: 'IT Executive (mock)', note: 'GoDaddy, ns51/ns52.domaincontrol.com' },
        { key: 'export', doneAt: ago(1), by: 'IT Executive (mock)', note: 'Zone file saved in SharePoint > IT > DNS (sample)' },
        { key: 'm365', doneAt: null, by: null, note: '' },
        { key: 'site', doneAt: null, by: null, note: '' },
        { key: 'rollback', doneAt: null, by: null, note: '' },
        { key: 'owner', doneAt: ago(1), by: 'IT Executive (mock)', note: '' },
        { key: 'window', doneAt: ago(1), by: 'IT Executive (mock)', note: '' },
      ],
      approval: null,
      post: [
        { key: 'resolves', result: null, note: '', by: null, at: null },
        { key: 'https', result: null, note: '', by: null, at: null },
        { key: 'm365', result: null, note: '', by: null, at: null },
        { key: 'others', result: null, note: '', by: null, at: null },
        { key: 'final', result: null, note: '', by: null, at: null },
      ],
      status: 'draft',
      finalConfig: '',
      incident: '',
    });
  // Social media, online listings and email health (Fauzan, 31 Oct 2026). Sample accounts only, no real pages.
  const profiles = ds.webCompanies.slice(0, 6);
  profiles.forEach((p, n) => {
    const co = ds.companies.find((c) => c.id === p.companyId);
    const short = (co?.name ?? p.companyId).replace(/ Sdn Bhd$/, '');
    const ok = n % 3 === 0;
    p.social = [
      {
        id: `ws-${p.companyId}-fb`,
        companyId: p.companyId,
        platform: 'facebook',
        name: `${short} (sample page)`,
        url: `https://www.facebook.com/sample-${n + 1}`,
        status: 'active',
        ownership: ok ? 'business_portfolio' : n % 3 === 1 ? 'personal' : 'unknown',
        holder: ok ? `${short} business portfolio (sample)` : '',
        admins: ok
          ? [
              { name: 'IT Lead (mock)', companyEmail: true, twoFactor: true },
              { name: 'Company admin (mock)', companyEmail: true, twoFactor: true },
            ]
          : [{ name: 'Former marketing staff (mock)', companyEmail: false, twoFactor: null }],
        recoveryEmail: ok ? `it@sample-${n + 1}.invalid` : '',
        itAdminId: p.itAdminId ?? 'u-it-lead',
        contentOwnerId: p.contentOwnerId,
        approverId: p.approverId,
        lastPostOn: ok ? addDays(today, -12) : addDays(today, -200),
        vault: ok ? { manager: 'Company password manager', entry: `Facebook ${short} (sample)`, access: 'IT Lead, IT Manager' } : null,
        accessReview: ok ? { at: ago(30), by: 'IT Lead (mock)', note: 'Two admins, both on company email with two-step sign-in (sample)', removed: '' } : null,
        note: '',
      },
      ...(n % 2 === 0
        ? [
            {
              id: `ws-${p.companyId}-gbp`,
              companyId: p.companyId,
              platform: 'google_business' as const,
              name: `${short} office (sample listing)`,
              url: '',
              status: 'active' as const,
              ownership: 'company_page' as const,
              holder: 'Company Google account (sample)',
              admins: [
                { name: 'IT Lead (mock)', companyEmail: true, twoFactor: true },
                { name: 'IT Manager (mock)', companyEmail: true, twoFactor: true },
              ],
              recoveryEmail: `it@sample-${n + 1}.invalid`,
              itAdminId: 'u-it-lead',
              contentOwnerId: p.contentOwnerId,
              approverId: p.approverId,
              lastPostOn: addDays(today, -40),
              vault: null,
              accessReview: { at: ago(120), by: 'IT Lead (mock)', note: 'Checked owners (sample)', removed: '' },
              note: 'Address and phone shown on Google Maps',
            },
          ]
        : []),
    ];
    if (n < 4)
      p.mailboxes = {
        licensed: 6 + n,
        shared: 2,
        leaversPending: n === 1 ? 1 : 0,
        nearFull: n === 2 ? 1 : 0,
        forwardingOutside: n === 3 ? 1 : 0,
        reviewedAt: n === 0 ? ago(20) : null,
        reviewedBy: n === 0 ? 'IT Manager (mock)' : null,
        note: 'Sample figures',
      };
  });
  ds.webDomains
    .filter((x) => x.m365Email)
    .slice(0, 6)
    .forEach((x, n) => {
      x.mail = {
        spf: n === 2 ? 'missing' : 'pass',
        dkim: n % 2 ? 'off' : 'on',
        dmarc: n === 0 ? 'quarantine' : n === 1 ? 'none' : n === 3 ? 'missing' : 'unknown',
        dmarcReports: n === 0 ? true : n === 1 ? false : null,
        mx: 'm365',
        source: 'manual',
        checkedAt: ago(10),
        checkedBy: 'IT Executive (mock)',
      };
    });
}
