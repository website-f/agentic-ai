// Company paper library (Marketing Part AH7, Fauzan 23 Nov 2026): each company's papers that tenders need, with end
// dates and a 30-day warning. Synthetic records only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, accountYears, addDays, generateDataset, paperGaps, paperNeeds, statementMonths, type CompanyPaper, type Dataset, type User } from '../src';

const TODAY = '2026-11-23';
const NOW = '2026-11-23T03:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc };
}
let n = 0;
const proof = () => ({ kind: 'document' as const, name: `Paper ${++n}.pdf`, data: 'data:application/pdf;base64,' + btoa(`%PDF-1.4 synthetic paper ${n}\n%%EOF`) });

function execs(ds: Dataset, companyId: string) {
  const covers = (u: User) => ds.grants.some((g) => g.userId === u.id && g.companyId === companyId);
  const all = ds.users.filter((u) => u.marketingRole === 'executive');
  return { own: all.find(covers)!, other: all.find((u) => !covers(u))! };
}

const paper = (p: Partial<CompanyPaper> & Pick<CompanyPaper, 'kind'>): CompanyPaper => ({
  id: `pap-${++n}`, companyId: 'co-x', title: p.kind, period: null, issuedOn: null, expiresOn: null, docIds: ['d'], note: '', by: 'Test', byId: 'u-t', at: NOW, replacedBy: null, ...p,
});

describe('Company paper library (AH7)', () => {
  it('works out the statement months and the latest audited year', () => {
    expect(statementMonths('2026-11-23')).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(statementMonths('2027-01-05')).toEqual(['2026-12', '2026-11', '2026-10']);
    expect(accountYears('2026-11-23')).toEqual(['2025']);
    expect(accountYears('2026-03-01')).toEqual(['2024']);
    expect(RULES.tenderPapers.value.warnDays).toBe(30);
    expect(RULES.tenderPapers.label).toBe('Policy');
  });

  it('marks each need OK, DUE, EXPIRED or MISSING, with licences read from the licence register', () => {
    const today = '2026-11-23';
    const papers = [
      paper({ kind: 'SSM_FORMS' }),
      paper({ kind: 'SSM_PROFILE', issuedOn: addDays(today, -100) }),
      paper({ kind: 'COMPANY_PROFILE' }),
      paper({ kind: 'BANK_STATEMENT', period: '2026-09' }),
      paper({ kind: 'BANK_STATEMENT', period: '2026-08' }),
      paper({ kind: 'AUDITED_ACCOUNTS', period: '2025' }),
      paper({ kind: 'EPF_REGISTRATION' }),
      paper({ kind: 'BANK_LETTER', expiresOn: addDays(today, 10) }),
    ];
    const licences = [{ id: 'l1', companyId: 'co-x', type: 'KDN_LICENCE', expiresOn: addDays(today, 200) }, { id: 'l2', companyId: 'co-x', type: 'MOF_REGISTRATION', expiresOn: addDays(today, -1) }] as never;
    const needs = paperNeeds(papers, licences, 'GOVERNMENT', today);
    const state = (k: string) => needs.find((x) => x.key === k)?.state;
    expect(state('lic-KDN_LICENCE')).toBe('OK');
    expect(state('lic-MOF_REGISTRATION')).toBe('EXPIRED');
    expect(state('lic-MOF_DIGITAL_CERT')).toBe('MISSING');
    expect(state('SSM_PROFILE')).toBe('EXPIRED'); // the search is older than 90 days
    expect(state('SOCSO_REGISTRATION')).toBe('MISSING');
    expect(state('AUDITED_ACCOUNTS')).toBe('OK'); // the latest year is enough (Fauzan, 23 Nov 2026)
    expect(paperNeeds(papers.filter((x) => x.kind !== 'AUDITED_ACCOUNTS').concat(paper({ kind: 'AUDITED_ACCOUNTS', period: '2024' })), licences, 'GOVERNMENT', today).find((x) => x.key === 'AUDITED_ACCOUNTS')?.state).toBe('MISSING');
    expect(state('BANK_STATEMENT')).not.toBe('OK'); // the newest month is missing
    expect(needs.some((x) => x.source === 'paper' && x.state === 'OK')).toBe(true);
    const gaps = paperGaps(needs);
    expect(gaps.length).toBeGreaterThan(3);
    // A private bid needs fewer papers.
    expect(paperNeeds(papers, licences, 'PRIVATE', today).length).toBeLessThan(needs.length);
  });

  it('lets the company office and the covering executive add papers; others only read or are refused', async () => {
    const { ds, svc } = fresh();
    const { own, other } = execs(ds, 'co-sasa');
    const ae = await svc.user('u-ae-sasa');
    const cm = await svc.user('u-cm-sasa');
    const doa = await svc.user('u-pwvsb-doa');
    const lib = await svc.companyPapers(ae, 'co-sasa');
    expect(lib.installed).toBe(true);
    expect(lib.canAdd).toBe(true);
    expect((await svc.companyPapers(own, 'co-sasa')).canAdd).toBe(true);
    await expect(svc.companyPapers(other, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addCompanyPaper(other, 'co-sasa', { kind: 'COMPANY_PROFILE' }, [proof()])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addCompanyPaper(doa, 'co-sasa', { kind: 'COMPANY_PROFILE' }, [proof()])).rejects.toBeInstanceOf(AccessDenied);
    // Another company's admin executive is walled off.
    const arshAe = ds.users.find((u) => u.role === 'admin_exec' && u.companyIds.includes('co-arsh') && !u.companyIds.includes('co-sasa'))!;
    await expect(svc.addCompanyPaper(arshAe, 'co-sasa', { kind: 'COMPANY_PROFILE' }, [proof()])).rejects.toBeInstanceOf(AccessDenied);
    void cm;
  });

  it('checks the input and replaces an older copy of the same paper, keeping it marked replaced', async () => {
    const { ds, svc } = fresh();
    const ae = await svc.user('u-ae-sasa');
    await expect(svc.addCompanyPaper(ae, 'co-sasa', { kind: 'NOPE' }, [proof()])).rejects.toThrow(/kind of paper/);
    await expect(svc.addCompanyPaper(ae, 'co-sasa', { kind: 'COMPANY_PROFILE' }, [])).rejects.toThrow(/Attach/);
    await expect(svc.addCompanyPaper(ae, 'co-sasa', { kind: 'BANK_STATEMENT', period: '2026-11' }, [proof()])).rejects.toThrow(/ended/);
    await expect(svc.addCompanyPaper(ae, 'co-sasa', { kind: 'AUDITED_ACCOUNTS', period: '2026' }, [proof()])).rejects.toThrow(/financial year/);
    await expect(svc.addCompanyPaper(ae, 'co-sasa', { kind: 'BANK_LETTER' }, [proof()])).rejects.toThrow(/end date/);
    await expect(svc.addCompanyPaper(ae, 'co-sasa', { kind: 'SSM_PROFILE' }, [proof()])).rejects.toThrow(/company search/);
    await expect(svc.addCompanyPaper(ae, 'co-sasa', { kind: 'PPKKM_MEMBERSHIP', issuedOn: '2026-11-01', expiresOn: '2026-10-01' }, [proof()])).rejects.toThrow(/after the issue/);

    const before = ds.companyPapers.find((p) => p.companyId === 'co-sasa' && p.kind === 'COMPANY_PROFILE' && !p.replacedBy)!;
    const added = await svc.addCompanyPaper(ae, 'co-sasa', { kind: 'COMPANY_PROFILE', title: 'Company profile 2026' }, [proof()]);
    expect(ds.companyPapers.find((p) => p.id === before.id)!.replacedBy).toBe(added.id);
    expect(ds.evidenceDocs.find((d) => d.id === added.docIds[0])!.paperId).toBe(added.id);
    expect(ds.audit.some((a) => a.action === 'company_paper.add' && a.entityId === added.id)).toBe(true);
    // Experience letters stack instead of replacing each other.
    const e1 = await svc.addCompanyPaper(ae, 'co-sasa', { kind: 'EXPERIENCE_LETTER', title: 'Letter A' }, [proof()]);
    await svc.addCompanyPaper(ae, 'co-sasa', { kind: 'EXPERIENCE_LETTER', title: 'Letter B' }, [proof()]);
    expect(ds.companyPapers.find((p) => p.id === e1.id)!.replacedBy).toBeNull();
    // The newest statement fills the gap on the government needs.
    const month = statementMonths(TODAY)[0];
    const gapBefore = (await svc.companyPapers(ae, 'co-sasa')).needs!.GOVERNMENT.filter((x) => x.state !== 'OK').length;
    await svc.addCompanyPaper(ae, 'co-sasa', { kind: 'BANK_STATEMENT', period: month }, [proof()]);
    expect((await svc.companyPapers(ae, 'co-sasa')).needs!.GOVERNMENT.filter((x) => x.state !== 'OK').length).toBe(gapBefore - 1);
  });

  it('warns the company home and shows gaps on the Marketing board and on open tenders', async () => {
    const { ds, svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const item = (await svc.home(cm, 'co-sasa')).todo.find((i) => i.tag === 'Papers');
    expect(item).toBeDefined();
    const board = await svc.marketingBoard(await svc.user('u-mkt-mgr'));
    const inas = board.rows.find((r) => r.companyId === 'co-inas')!;
    expect(inas.papers!.missing).toBeGreaterThan(3);
    const open = ds.tenders.find((t) => t.companyId === 'co-sasa' && (t.status === 'open' || t.status === 'preparing'));
    if (open) {
      const row = (await svc.commercial(cm, 'co-sasa')).tenders.find((r) => r.tender.id === open.id)!;
      expect(Array.isArray(row.paperGaps)).toBe(true);
    }
  });

  it('reports the library as not installed when the module table is missing', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    (store as unknown as { hasTable: (t: string) => Promise<boolean> }).hasTable = async (t) => t !== 'companyPapers';
    const svc = new PrimaService(store, () => NOW);
    const ae = await svc.user('u-ae-sasa');
    expect((await svc.companyPapers(ae, 'co-sasa')).installed).toBe(false);
    await expect(svc.addCompanyPaper(ae, 'co-sasa', { kind: 'COMPANY_PROFILE' }, [proof()])).rejects.toThrow(/not installed/);
    expect((await svc.home(await svc.user('u-cm-sasa'), 'co-sasa')).todo.some((i) => i.tag === 'Papers')).toBe(false);
  });
});
