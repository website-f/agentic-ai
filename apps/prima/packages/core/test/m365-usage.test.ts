// Microsoft use board (rule M365-USE, Fauzan 23 Nov 2026). Synthetic people and synthetic report rows only.
import { describe, expect, it } from 'vitest';
import { M365_GUIDE_CARDS, USE_CHECKS, USE_STEPS, allGuideCards, guideCardProblems, guideCardsFor, buildUsage, parseReportCsv, usagePlan, usagePlanCounts, usageScore, usageSeesAll, usageSummary, usageVisible, type UsageSources, type User } from '../src';

const TODAY = '2026-11-23';
const oid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const u = (id: string, over: Partial<User>): User => ({ id, name: id, title: 't', role: 'admin_exec', companyIds: [], siteIds: [], ...over }) as User;

const premium = u('p1', { role: 'company_manager', companyIds: ['co-a'], entraOid: oid(1) });
const basic = u('b1', { role: 'admin_exec', companyIds: ['co-a'], entraOid: oid(2) });
const otherCo = u('b2', { role: 'admin_exec', companyIds: ['co-b'], entraOid: oid(3) });
const unlinked = u('n1', { role: 'admin_exec', companyIds: ['co-a'] });
const itExec = u('it1', { role: 'pwvsb_officer', department: 'it', itRole: 'executive', entraOid: oid(4) });
const finLead = u('f1', { role: 'pwvsb_officer', department: 'finance', financeRole: 'leader', financeTeam: 1, entraOid: oid(5) });
const finT1 = u('f2', { role: 'pwvsb_officer', department: 'finance', financeRole: 'data_entry', financeTeam: 1, entraOid: oid(6) });
const finT2 = u('f3', { role: 'pwvsb_officer', department: 'finance', financeRole: 'data_entry', financeTeam: 2, entraOid: oid(7) });
const ceo = u('ceo', { role: 'pwvsb_officer', opsTier: 'ceo', entraOid: oid(8) });
const guard = u('g1', { role: 'guard', entraOid: oid(9) });
const closed = u('c1', { role: 'admin_exec', entraOid: oid(10), accessClosedFrom: '2026-11-01' });
const people = [premium, basic, otherCo, unlinked, itExec, finLead, finT1, finT2, ceo, guard, closed];

const src = (over: Partial<UsageSources> = {}): UsageSources => ({
  refreshed: '2026-11-21',
  registrations: [
    { oid: oid(1), upn: 'p1@example.invalid', mfa: true, sspr: true },
    { oid: oid(2), upn: 'b1@example.invalid', mfa: false, sspr: true },
  ],
  active: [
    { upn: 'P1@example.invalid', products: 'MICROSOFT 365 BUSINESS PREMIUM', exchange: '2026-11-20', oneDrive: null, sharePoint: '2026-11-19', teams: '2026-11-20' },
    { upn: 'b1@example.invalid', products: 'MICROSOFT 365 BUSINESS BASIC', exchange: '2026-09-01', oneDrive: null, sharePoint: null, teams: null },
  ],
  mailbox: [{ upn: 'p1@example.invalid', used: 95, prohibitSend: 100 }],
  activations: [{ upn: 'p1@example.invalid', productType: 'MICROSOFT 365 APPS FOR BUSINESS', windows: 1, mac: 0 }],
  devices: [{ oid: oid(1), compliant: false }],
  ...over,
});

describe('Microsoft use board', () => {
  it('covers open office staff only, never guards or closed accounts', () => {
    const s = buildUsage(people, src(), TODAY);
    const ids = s.people.map((p) => p.userId);
    expect(ids).toContain('p1');
    expect(ids).not.toContain('g1');
    expect(ids).not.toContain('c1');
  });

  it('builds each checklist from the records, Unknown when not measurable, never green', () => {
    const s = buildUsage(people, src(), TODAY);
    const p = s.people.find((x) => x.userId === 'p1')!;
    expect(p.managed).toBe(true);
    expect(p.checks).toMatchObject({ authenticator: 'ok', password_reset: 'ok', teams: 'ok', outlook: 'ok', onedrive: 'missing', sharepoint: 'ok', mailbox: 'missing', device: 'missing', desktop_office: 'ok', labels: 'unknown', my_apps: 'unknown' });
    expect(p.idle).toBe(false);
    const b = s.people.find((x) => x.userId === 'b1')!;
    expect(b.managed).toBe(false);
    expect(b.checks.authenticator).toBe('missing');
    expect(b.checks.teams).toBe('missing');
    expect(b.checks.device).toBeUndefined();
    expect(b.idle).toBe(true);
    const n = s.people.find((x) => x.userId === 'n1')!;
    expect(n).toMatchObject({ linked: false, checks: {} });
    expect(s.people.find((x) => x.userId === 'b2')!.checks.teams).toBe('unknown');
  });

  it('a source that could not be read leaves its checks Unknown', () => {
    const s = buildUsage(people, src({ registrations: null, devices: null }), TODAY);
    const p = s.people.find((x) => x.userId === 'p1')!;
    expect(p.checks.authenticator).toBe('unknown');
    expect(p.checks.teams).toBe('unknown'); // no registration means no sign-in name to match the reports
  });

  it('says when Microsoft still hides names in its reports', () => {
    const hidden = src({ active: [{ upn: '5f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c', products: '', exchange: TODAY, oneDrive: null, sharePoint: null, teams: TODAY }] });
    expect(buildUsage(people, hidden, TODAY).namesHidden).toBe(true);
    expect(buildUsage(people, src(), TODAY).namesHidden).toBe(false);
  });

  it('reads My Apps use from the sign-in log: recent is done, old or none is not yet', () => {
    const s = buildUsage(people, src({ myApps: [{ oid: oid(1), day: '2026-11-20' }, { oid: oid(2), day: '2026-09-01' }] }), TODAY);
    expect(s.people.find((x) => x.userId === 'p1')!.checks.my_apps).toBe('ok');
    expect(s.people.find((x) => x.userId === 'b1')!.checks.my_apps).toBe('missing');
    expect(buildUsage(people, src({ myApps: null }), TODAY).people.find((x) => x.userId === 'p1')!.checks.my_apps).toBe('unknown');
  });

  it('knows every plan we buy and flags a Premium licence whose Premium features are unused', () => {
    expect(usagePlan('MICROSOFT 365 BUSINESS PREMIUM')).toBe('premium');
    expect(usagePlan('MICROSOFT 365 BUSINESS BASIC+MICROSOFT ENTRA ID P1')).toBe('basic_p1');
    expect(usagePlan('MICROSOFT 365 BUSINESS BASIC+AZURE ACTIVE DIRECTORY PREMIUM P1')).toBe('basic_p1');
    expect(usagePlan('MICROSOFT 365 BUSINESS BASIC')).toBe('basic');
    expect(usagePlan('EXCHANGE ONLINE (PLAN 1)')).toBe('other');
    const s = buildUsage(people, src(), TODAY);
    expect(s.people.find((x) => x.userId === 'p1')).toMatchObject({ plan: 'premium', premiumUnused: false });
    expect(s.people.find((x) => x.userId === 'b1')).toMatchObject({ plan: 'basic', premiumUnused: false });
    const unused = buildUsage(people, src({ activations: [] }), TODAY).people.find((x) => x.userId === 'p1')!;
    expect(unused.premiumUnused).toBe(true);
    expect(usagePlanCounts(s.people)).toEqual({ premium: 1, basic_p1: 0, basic: 1, other: 0 });
  });

  it('counts sign-ins to Prima with Microsoft, Unknown when the log was not read', () => {
    const s = buildUsage(people, src({ primaSignIns: [{ oid: oid(2), day: '2026-11-22' }] }), TODAY);
    expect(s.people.find((x) => x.userId === 'b1')!.checks.prima_signin).toBe('ok');
    expect(s.people.find((x) => x.userId === 'p1')!.checks.prima_signin).toBe('missing');
    expect(buildUsage(people, src(), TODAY).people.find((x) => x.userId === 'p1')!.checks.prima_signin).toBe('unknown');
  });

  it('OneNote from the Microsoft 365 apps report; Loop stays Unknown until Microsoft reports it', () => {
    const s = buildUsage(people, src({ apps: [{ upn: 'p1@example.invalid', oneNote: true }, { upn: 'b1@example.invalid', oneNote: false }] }), TODAY);
    expect(s.people.find((x) => x.userId === 'p1')!.checks).toMatchObject({ onenote: 'ok', loop: 'unknown' });
    expect(s.people.find((x) => x.userId === 'b1')!.checks.onenote).toBe('missing');
    expect(buildUsage(people, src(), TODAY).people.find((x) => x.userId === 'p1')!.checks.onenote).toBe('unknown');
  });

  it('SharePoint is its own check: shared files opened or edited, from the activity report when it is read', () => {
    const withSp = (sharePoint: UsageSources['sharePoint']) => buildUsage(people, src({ sharePoint }), TODAY).people.find((x) => x.userId === 'p1')!.checks.sharepoint;
    expect(withSp([{ upn: 'p1@example.invalid', last: '2026-11-19', viewedOrEdited: 4 }])).toBe('ok');
    expect(withSp([{ upn: 'p1@example.invalid', last: '2026-11-19', viewedOrEdited: 0 }])).toBe('missing');
    expect(withSp([{ upn: 'p1@example.invalid', last: '2026-09-01', viewedOrEdited: 9 }])).toBe('missing');
    expect(withSp([])).toBe('missing');
    expect(withSp(null)).toBe('ok'); // falls back to the active users report (SharePoint on 19 Nov)
    expect(buildUsage(people, src(), TODAY).people.find((x) => x.userId === 'b1')!.checks.sharepoint).toBe('missing');
  });

  it('every check has numbered BM and English steps, an official Microsoft page or none, and never asks for a password', () => {
    for (const id of USE_CHECKS) {
      const h = USE_STEPS[id];
      expect(h.steps.length, id).toBeGreaterThanOrEqual(2);
      for (const s of h.steps) expect(s.bm.trim() && s.en.trim(), id).toBeTruthy();
      if (h.link) expect(new URL(h.link.url).hostname, id).toMatch(/(^|\.)(microsoft\.com|office\.com|onenote\.com|cloud\.microsoft)$/);
      expect(h.itHelps.trim(), id).toBeTruthy();
      expect(JSON.stringify(h).toLowerCase(), id).not.toMatch(/(send|give|tell|share|beri|hantar).{0,30}(password|kata laluan|code|kod)/);
    }
  });

  it('the guide has Microsoft cards for office staff only, and they pass the guide checks', () => {
    const views = allGuideCards().filter((c) => c.id.startsWith('m365.'));
    expect(views.map((c) => c.id)).toEqual(M365_GUIDE_CARDS.map((c) => c.id));
    for (const v of views) expect(guideCardProblems(v)).toEqual([]);
    expect(guideCardsFor(basic, []).cards.map((c) => c.id)).toContain('m365.checklist');
    expect(guideCardsFor(guard, []).cards.map((c) => c.id)).not.toContain('m365.checklist');
  });

  it('scores leave Unknown out', () => {
    expect(usageScore({ userId: 'x', linked: true, managed: false, checks: { teams: 'ok', outlook: 'missing', my_apps: 'unknown' }, idle: false })).toBe(50);
    expect(usageScore({ userId: 'x', linked: false, managed: null, checks: {}, idle: false })).toBeNull();
  });

  it('keeps the walls: self, own company, own department or team, IT and leaders see all', () => {
    expect(usageSeesAll(ceo)).toBe(true);
    expect(usageSeesAll(itExec)).toBe(true);
    expect(usageSeesAll(basic)).toBe(false);
    expect(usageVisible(basic, basic)).toBe(true);
    expect(usageVisible(basic, premium)).toBe(false);
    expect(usageVisible(premium, basic)).toBe(true);
    expect(usageVisible(premium, otherCo)).toBe(false);
    expect(usageVisible(premium, itExec)).toBe(false);
    expect(usageVisible(finLead, finT1)).toBe(true);
    expect(usageVisible(finLead, finT2)).toBe(false);
    expect(usageVisible(finT1, finT2)).toBe(false);
    expect(usageVisible(u('sys', { integration: 'ja', role: 'pwvsb_officer', department: 'it' }), basic)).toBe(false);
  });

  it('sums scores per company and department', () => {
    const s = buildUsage(people, src(), TODAY);
    const byId = new Map(people.map((p) => [p.id, p]));
    const sum = usageSummary(s.people.map((usage) => ({ person: byId.get(usage.userId)!, usage })));
    const coA = sum.companies.find((c) => c.key === 'co-a')!;
    expect(coA.people).toBe(3);
    expect(coA.idle).toBe(1);
    expect(coA.setupMissing).toBe(2); // b1 has no Authenticator, n1 is not linked
    expect(sum.departments.map((d) => d.key)).toEqual(['finance', 'it']);
  });

  it('reads Microsoft report CSV with quotes, commas, a BOM and CRLF', () => {
    const rows = parseReportCsv('﻿User Principal Name,Assigned Products\r\na@example.invalid,"MICROSOFT 365 BUSINESS PREMIUM+""X"", Y"\r\n\r\n');
    expect(rows).toEqual([{ 'User Principal Name': 'a@example.invalid', 'Assigned Products': 'MICROSOFT 365 BUSINESS PREMIUM+"X", Y' }]);
    expect(parseReportCsv('')).toEqual([]);
  });
});
