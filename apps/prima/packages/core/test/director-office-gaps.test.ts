import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, generateDataset, myt } from '../src';
import { corpProfileFromCompany, dueYearlyAudit, dueYearlyFilings, fsReadiness, latestYearEnd } from '../src/corp-year';
import type { Company, LeaveRequest, User } from '../src';

// Director Office study gaps (Fauzan, 23 Nov 2026: "Do the gap"). Synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
const RULE = RULES.corporate.value;
const fresh = (mut?: (ds: ReturnType<typeof generateDataset>) => void) => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  mut?.(ds);
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};
const company = (over: Partial<Company> = {}): Company =>
  ({ id: 'co-new', code: 'NEW', name: 'New Co (mock)', isPilot: false, headOfCompany: '', state: 'Selangor', guardCount: 0, siteCount: 0, ...over }) as Company;
const officeExec = (id: string): User => ({ id, name: `CoS office ${id} (mock)`, title: 'Corporate Admin executive', role: 'pwvsb_officer', department: 'chief_of_staff', companyIds: [], siteIds: [] }) as User;

describe('B1-B3: what Prima opens by itself each year', () => {
  it('makes a company file from the company record, December year end by default, inventing nothing', () => {
    const p = corpProfileFromCompany(company({ ssmNo: '202001000001 (1234567-A)', registeredOn: '2020-03-15' }));
    expect(p).toMatchObject({ id: 'cp-co-new', regNo: '202001000001 (1234567-A)', incorporatedOn: '2020-03-15', fyeMonth: 12, auditor: '', directors: [] });
  });

  it('opens the annual return 90 days ahead, the financial statements from the year end, never twice', () => {
    const c = company({ registeredOn: '2020-12-20' });
    const p = corpProfileFromCompany(c);
    const due = dueYearlyFilings(p, c, TODAY, new Set(), RULE);
    const ar = due.find((f) => f.kind === 'ANNUAL_RETURN')!;
    expect(ar).toMatchObject({ id: 'cf-co-new-ar-2027', dueOn: '2027-01-19', status: 'open' });
    const fs = due.find((f) => f.kind === 'FINANCIAL_STATEMENTS')!;
    // Year ended 31 Dec 2025: circulate by 30 Jun 2026, lodge within 30 days. Already past by more than 60 days, so not reopened.
    expect(fs).toBeUndefined();
    expect(dueYearlyFilings(p, c, TODAY, new Set([ar.id]), RULE).some((f) => f.kind === 'ANNUAL_RETURN')).toBe(false);
    // A June year end: year ended 30 Jun 2026, circulate by 31 Dec 2026, lodge by 30 Jan 2027.
    const june = dueYearlyFilings({ ...p, fyeMonth: 6 }, c, TODAY, new Set(), RULE).find((f) => f.kind === 'FINANCIAL_STATEMENTS')!;
    expect(june).toMatchObject({ dueOn: '2027-01-30', fyEnd: '2026-06-30' });
  });

  it('opens no annual return without an incorporation date, and an anniversary far ahead waits', () => {
    const c = company();
    expect(dueYearlyFilings(corpProfileFromCompany(c), c, TODAY, new Set(), RULE).some((f) => f.kind === 'ANNUAL_RETURN')).toBe(false);
    const later = company({ registeredOn: '2019-07-01' });
    expect(dueYearlyFilings(corpProfileFromCompany(later), later, TODAY, new Set(), RULE).some((f) => f.kind === 'ANNUAL_RETURN')).toBe(false);
  });

  it('opens the audit of the latest year end with the auditor on file, and marks the statements ready once signed', () => {
    const c = company({ registeredOn: '2020-01-01' });
    const p = { ...corpProfileFromCompany(c), fyeMonth: 9, auditor: 'Audit firm 1 (mock)' };
    expect(latestYearEnd(9, TODAY)).toBe('2026-09-30');
    const a = dueYearlyAudit(p, c, TODAY, new Set(), RULE)!;
    expect(a).toMatchObject({ id: 'audit-co-new-2026', fyEnd: '2026-09-30', auditorFirm: 'Audit firm 1 (mock)', signed: null });
    expect(dueYearlyAudit(p, c, TODAY, new Set([a.id]), RULE)).toBeNull();
    const fs = dueYearlyFilings(p, c, TODAY, new Set(), RULE).find((f) => f.kind === 'FINANCIAL_STATEMENTS')!;
    expect(fsReadiness(fs, [a])).toEqual({ auditSigned: false, auditSignedOn: null });
    expect(fsReadiness(fs, [{ ...a, signed: { on: '2027-02-01', opinion: 'unmodified', ref: 'X' } }])).toEqual({ auditSigned: true, auditSignedOn: '2027-02-01' });
  });

  it('opens a company file and its year for a company that has none when Corporate Admin opens the board', async () => {
    const { svc, store } = fresh((ds) => {
      ds.corpProfiles = ds.corpProfiles.filter((p) => p.companyId !== 'co-sasa');
      ds.corpFilings = ds.corpFilings.filter((f) => f.companyId !== 'co-sasa');
      ds.corpAudits = ds.corpAudits.filter((a) => a.companyId !== 'co-sasa');
      const c = ds.companies.find((x) => x.id === 'co-sasa')!;
      c.registeredOn = '2015-01-10';
      c.ssmNo = '201501000010 (mock)';
    });
    const dcos = await svc.user('u-dcos');
    const b = await svc.corpBoard(dcos);
    const profile = (await store.list('corpProfiles', { companyId: ['co-sasa'] }))[0];
    expect(profile).toMatchObject({ regNo: '201501000010 (mock)', incorporatedOn: '2015-01-10', fyeMonth: 12 });
    const sasa = b.filings.filter((f) => f.filing.companyId === 'co-sasa');
    // Anniversary 10 Jan: the 2026 return (due 9 Feb 2026) went before Prima; the 2027 one is due within 90 days.
    expect(sasa.map((f) => f.filing.id)).toContain('cf-co-sasa-ar-2027');
    expect(sasa.map((f) => f.filing.id)).not.toContain('cf-co-sasa-ar-2026');
    expect(sasa.find((f) => f.filing.id === 'cf-co-sasa-ar-2027')!.filing.openedBy?.by).toBe('Prima');
    // The year ended 31 Dec 2025 was audited before Prima; the 2026 audit opens on 31 Dec 2026.
    expect((await store.list('corpAudits', { companyId: ['co-sasa'] })).length).toBe(0);
    // Opening the board again adds nothing.
    const n = (await store.list('corpFilings', {})).length;
    await svc.corpBoard(dcos);
    expect((await store.list('corpFilings', {})).length).toBe(n);
  });

  it('lets the company key in the incorporation date and year end month on its file', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const p = await svc.saveCompanyFile(cm, 'co-sasa', { incorporatedOn: '2012-05-05', fyeMonth: 6 });
    expect(p).toMatchObject({ incorporatedOn: '2012-05-05', fyeMonth: 6 });
    await expect(svc.saveCompanyFile(cm, 'co-sasa', { fyeMonth: 13 })).rejects.toThrow(/1 to 12/);
  });
});

describe('B7, D1, D3: who records filings', () => {
  it('B7: Corporate Admin opens another filing with a due date and basis; the company cannot', async () => {
    const { svc } = fresh();
    const dcos = await svc.user('u-dcos');
    const f = await svc.openCorpFiling(dcos, { companyId: 'co-sasa', title: 'Change of registered address', dueOn: '2026-12-07', basis: 'Companies Act 2016 s.46, 14 days' });
    expect(f).toMatchObject({ kind: 'OTHER', status: 'open', openedBy: { by: dcos.name } });
    await expect(svc.openCorpFiling(dcos, { companyId: 'co-sasa', title: 'x', dueOn: '2026-12-07', basis: 'b' })).rejects.toThrow(/Say what/);
    await expect(svc.openCorpFiling(await svc.user('u-cm-sasa'), { companyId: 'co-sasa', title: 'Change of address', dueOn: '2026-12-07', basis: 's.46' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('D3: the secretary firm keys in its lodgement and the SSM receipt, but does not mark papers ready', async () => {
    const { svc, ds } = fresh();
    const sec = await svc.user('u-cosec');
    const b = await svc.corpBoard(sec);
    const open = b.filings.find((f) => f.filing.status === 'open')!;
    expect(open.can).toMatchObject({ prepare: false, lodge: true });
    await expect(svc.corpFilingStep(sec, open.filing.id, 'prepare')).rejects.toBeInstanceOf(AccessDenied);
    const lodged = await svc.corpFilingStep(sec, open.filing.id, 'lodge', { ref: 'MBRS-1 (mock)' });
    expect(lodged.status).toBe('lodged');
    const done = await svc.corpFilingStep(sec, open.filing.id, 'receipt', { ref: 'SSM-1 (mock)' });
    expect(done.status).toBe('acknowledged');
    expect(ds.audit.some((a) => a.entityId === open.filing.id && /company secretary firm/.test(a.summary))).toBe(true);
  });

  it('D1: the Chief of Staff monitors, and stands in only while the Deputy is on approved leave', async () => {
    const leave = (status: LeaveRequest['status']) => (ds: ReturnType<typeof generateDataset>) => {
      ds.users.find((u) => u.id === 'u-dcos')!.personId = 'p-dcos-mock';
      ds.leaveRequests.push({ id: 'lv-dcos', companyId: 'co-pwvsb', personId: 'p-dcos-mock', kind: 'annual', from: '2026-11-20', to: '2026-11-27', days: 6, reason: 'Leave (mock)', proofIds: [], requestedAt: NOW, requestedBy: 'x', via: 'company', status, decidedBy: null, decidedAt: null, decisionNote: null } as unknown as LeaveRequest);
    };
    const pending = fresh(leave('pending'));
    const cos = await pending.svc.user('u-cos');
    const waiting = pending.ds.corpChanges.find((c) => c.status === 'awaiting_pwvsb')!;
    await expect(pending.svc.decideCorpChange(cos, waiting.id, 'approve', 'ok', 'cl. 7.2')).rejects.toBeInstanceOf(AccessDenied);
    expect((await pending.svc.corpBoard(cos)).cover).toBe(false);

    const away = fresh(leave('approved'));
    const cos2 = await away.svc.user('u-cos');
    expect((await away.svc.corpBoard(cos2)).cover).toBe(true);
    const w = away.ds.corpChanges.find((c) => c.status === 'awaiting_pwvsb')!;
    const d = await away.svc.decideCorpChange(cos2, w.id, 'approve', 'Signed clause checked', 'cl. 7.2 (mock)');
    expect(d.status).toBe('approved');
    expect(away.ds.audit.some((a) => a.entityId === w.id && /standing in for the Deputy/.test(a.summary))).toBe(true);
  });

  it('D1: the Deputy names a Chief of Staff office executive who records steps for that company only, never approves', async () => {
    const { svc, ds } = fresh((ds) => {
      ds.users.push(officeExec('u-cos-exec'), officeExec('u-cos-other'));
      ds.grants.push({ id: 'grant-cos-exec', companyId: 'co-sasa', userId: 'u-cos-exec', validFrom: '2026-01-01', validTo: '2027-12-31', scope: 'act', basis: 'synthetic' } as never);
    });
    const dcos = await svc.user('u-dcos');
    const exec = await svc.user('u-cos-exec');
    await expect(svc.corpBoard(exec)).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.corpFilingExecChoices(dcos)).map((p) => p.id)).toEqual(expect.arrayContaining(['u-cos-exec', 'u-cos-other']));
    await expect(svc.setCorpFilingExec(dcos, { companyId: 'co-sasa', userId: 'u-cos-exec', reason: '' })).rejects.toThrow(/reason/);
    await expect(svc.setCorpFilingExec(dcos, { companyId: 'co-sasa', userId: 'u-cosec', reason: 'x' })).rejects.toThrow(/Chief of Staff office/);
    await svc.setCorpFilingExec(dcos, { companyId: 'co-sasa', userId: 'u-cos-exec', reason: 'Handles Sasa filings' });
    const b = await svc.corpBoard(exec);
    expect(new Set(b.filings.map((f) => f.filing.companyId))).toEqual(new Set(['co-sasa']));
    const open = b.filings.find((f) => f.filing.status === 'open')!;
    expect((await svc.corpFilingStep(exec, open.filing.id, 'prepare')).status).toBe('prepared');
    const w = ds.corpChanges.find((c) => c.status === 'awaiting_pwvsb' && c.companyId === 'co-sasa');
    if (w) await expect(svc.decideCorpChange(exec, w.id, 'approve', 'ok', 'cl')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.openCorpFiling(exec, { companyId: 'co-sasa', title: 'Change of address', dueOn: '2026-12-07', basis: 's.46' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setCorpFilingExec(exec, { companyId: 'co-sasa', userId: null, reason: 'x' })).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('D2, B5: reports to the Director Office', () => {
  it('D2: the Director Office Administrator and the CEO change the report list; a director sign-in does not', async () => {
    const { svc, ds } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    expect((await svc.reports(doa)).canEdit).toBe(true);
    const ceo = ds.users.find((u) => u.opsTier === 'ceo' && !u.integration)!;
    expect((await svc.reports(await svc.user(ceo.id))).canEdit).toBe(true);
    const director = ds.users.find((u) => u.role === 'director' && u.opsTier !== 'ceo');
    if (director) {
      expect((await svc.reports(await svc.user(director.id))).canEdit).toBe(false);
      await expect(svc.setReportDefs(await svc.user(director.id), [], 'x')).rejects.toBeInstanceOf(AccessDenied);
    }
  });

  it('D2: once a head of the Director Office is named, other Director Office staff stop changing the list', async () => {
    const { svc } = fresh((ds) => {
      ds.users.push({ id: 'u-do-2', name: 'DO staff (mock)', role: 'pwvsb_officer', department: 'director_office', companyIds: [], siteIds: [] } as User);
      ds.users.find((u) => u.id === 'u-pwvsb-doa')!.headOf = ['d_director_office'];
    });
    expect((await svc.reports(await svc.user('u-pwvsb-doa'))).canEdit).toBe(true);
    expect((await svc.reports(await svc.user('u-do-2'))).canEdit).toBe(false);
  });

  it('B5: a company with an open company office sign-in counts as on the app, pilot mark or not', async () => {
    const { svc } = fresh((ds) => {
      for (const c of ds.companies) c.isPilot = false;
    });
    const doa = await svc.user('u-pwvsb-doa');
    const board = (await svc.reports(doa)).board!;
    const company = board.find((b) => b.def.from === 'company')!;
    const sasa = company.rows.find((r) => r.key === 'co-sasa')!;
    expect(sasa.status).not.toBe('unknown');
  });
});
