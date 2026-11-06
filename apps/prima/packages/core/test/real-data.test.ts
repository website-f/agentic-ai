// P81: the real-data loader (real-data.ts). Synthetic companies and people only: the real staff list never comes here.
import { describe, expect, it } from 'vitest';
import {
  CENTRAL_EMPLOYER_IDS,
  GROUP_EMPLOYER_ID,
  IT_COMPANY_ID,
  MemoryStore,
  PWVSB_HQ_BRANCH,
  PrimaService,
  RealDataError,
  dataWalls,
  generateDataset,
  isForeign,
  isOwnerAdmin,
  missingStaffFacts,
  myt,
  parseRealData,
  realDataSummary,
  realDataset,
  staffPayGaps,
  tenantCompanyIds,
  visibleCompanyIds,
  type Dataset,
} from '../src';

const TODAY = '2026-11-06';
const NOW = myt(TODAY, '10:30');

const FILE = {
  format: 'prima-real-data',
  version: 1,
  builtAt: '2026-11-06T09:00:00Z',
  source: 'synthetic test list',
  companies: [
    { key: 'pwvsb', name: 'Central Example Sdn Bhd', role: 'central' },
    { key: 'goodwill', name: 'Gov Ops Example Sdn Bhd', role: 'gov_ops' },
    { key: 'sasateam', name: 'Private Ops Example Sdn Bhd', role: 'private_ops' },
    { key: 'merdeka', name: 'IT Example Sdn Bhd', role: 'it' },
    { key: 'co-alpha-guard', name: 'Alpha Guard Sdn Bhd', role: 'licensed', aliases: ['ALPHA GUARD SDN BHD'], registrationNo: '123456-A' },
    { key: 'co-beta-watch', name: 'Beta Watch Sdn Bhd', role: 'licensed' },
    { key: 'co-gamma-asset', name: 'Gamma Asset Sdn Bhd', role: 'asset' },
  ],
  staff: [
    { name: 'Test Person One', email: 'One@Example.test', company: 'pwvsb', unit: 'hr', roleHint: 'staff' },
    { name: 'Test Person Two', email: 'two@example.test', otherEmails: ['two.hq@example.test'], company: 'pwvsb', unit: 'finance', title: 'Team leader', roleHint: 'leader' },
    { name: 'Test Person Three', email: null, company: 'goodwill', unit: 'operations', area: 'kedah-perlis', roleHint: 'staff' },
    { name: 'Test Person Four', email: 'four@example.test', company: 'merdeka', unit: 'it', roleHint: 'staff' },
    { name: 'Test Person Five', email: 'five@example.test', company: 'co-alpha-guard', title: 'Management', roleHint: 'manager' },
    { name: 'Test Person Six', email: 'six@example.test', company: 'co-gamma-asset', unit: 'asset', roleHint: 'staff' },
  ],
};

function build(): Dataset {
  return realDataset(generateDataset({ today: TODAY, now: NOW }), parseRealData(FILE), { today: TODAY });
}

describe('real-data file', () => {
  it('reads a valid file, tidied: emails in lower case, other mailboxes kept', () => {
    const f = parseRealData(FILE);
    expect(f.companies).toHaveLength(7);
    expect(f.staff[0].email).toBe('one@example.test');
    expect(f.staff[1].otherEmails).toEqual(['two.hq@example.test']);
    expect(realDataSummary(f)).toBe('3 companies, 6 staff (5 with an email)');
  });

  it('refuses a wrong file, naming where, never echoing the personal value', () => {
    const bad = (patch: (f: typeof FILE) => unknown, why: RegExp) => {
      const f = structuredClone(FILE);
      const g = (patch(f) as typeof FILE | undefined) ?? f;
      expect(() => parseRealData(g)).toThrow(RealDataError);
      expect(() => parseRealData(g)).toThrow(why);
    };
    bad((f) => ({ ...f, format: 'other' }), /not a Prima real-data file/);
    bad((f) => ({ ...f, version: 2 }), /version 1/);
    bad((f) => void (f.companies[0].key = 'co-pwvsb'), /must be "pwvsb"/);
    bad((f) => void f.companies.splice(0, 1), /central company/);
    bad((f) => void (f.companies[4].key = 'Alpha Guard'), /co-<name>/);
    bad((f) => void f.companies.push({ ...f.companies[5] }), /listed twice/);
    bad((f) => void (f.staff[0].company = 'co-nowhere'), /staff\[0\]\.company names no company/);
    bad((f) => void (f.staff[3].email = 'one@example.test'), /staff\[3\] has the same email as staff\[0\]/);
    bad((f) => void (f.staff[0].email = 'not an email'), /staff\[0\]\.email is not an email address/);
    bad((f) => void ((f.staff[0] as { unit: string }).unit = 'sales'), /unit must be one of/);
    bad((f) => void ((f.staff[0] as { roleHint: string }).roleHint = 'boss'), /roleHint/);
    bad((f) => void (f.staff[0].name = 'A\u0000B'), /staff\[0\]\.name/);
    try {
      parseRealData({ ...FILE, staff: [{ ...FILE.staff[0], email: 'secret person' }] });
    } catch (e) {
      expect((e as Error).message).not.toContain('secret');
    }
  });
});

describe('real-data dataset', () => {
  it('holds the real companies and people only: no mock company, sample person or sample sign-in', () => {
    const ds = build();
    expect(ds.companies.map((c) => c.id).sort()).toEqual(['co-alpha-guard', 'co-beta-watch', 'co-gamma-asset']);
    expect(ds.companies.some((c) => /mock/i.test(c.name))).toBe(false);
    expect(ds.companies.find((c) => c.id === 'co-gamma-asset')).toMatchObject({ groupRole: 'asset', verificationStatus: 'draft', guardCount: 0 });
    expect(ds.companies.find((c) => c.id === 'co-alpha-guard')).toMatchObject({ ssmNo: '123456-A', aliases: ['ALPHA GUARD SDN BHD'], headOfCompany: '' });
    // The central employers keep their structural ids and stay without a company record, as the code expects.
    for (const id of CENTRAL_EMPLOYER_IDS) expect(ds.companies.some((c) => c.id === id)).toBe(false);
    expect(ds.people).toHaveLength(6);
    expect(ds.users.map((u) => u.id).filter((id) => !ds.users.find((u) => u.id === id)!.integration)).toEqual(['u-fauzan']);
    expect(ds.users.every((u) => u.id === 'u-fauzan' || u.integration)).toBe(true);
    // Every other list is empty except the kept settings.
    const kept = new Set(['companies', 'users', 'grants', 'people', 'cmsSettings', 'itSettings', 'webSettings', 'tenderProtocols', 'reportDefs', 'claimRates']);
    for (const [k, v] of Object.entries(ds)) if (Array.isArray(v) && !kept.has(k)) expect(v, k).toEqual([]);
    expect(ds.cmsShifts).toEqual([]);
    expect(ds.reportDefs.length).toBeGreaterThan(0);
    expect(ds.claimRates.length).toBeGreaterThan(0);
    // Sample authors are taken off the settings.
    expect(JSON.stringify([ds.itSettings, ds.tenderProtocols, ds.claimRates, ds.cmsSettings])).not.toMatch(/mock|Nurul Huda/);
    expect(ds.itSettings[0].tenderExecId).toBeNull();
  });

  it('puts each person in their employer and department, with nothing invented', () => {
    const ds = build();
    const by = (name: string) => ds.people.find((p) => p.name === name)!;
    expect(by('Test Person One')).toMatchObject({ companyId: GROUP_EMPLOYER_ID, branchId: PWVSB_HQ_BRANCH, department: 'HR', email: 'one@example.test', role: 'office', status: 'active' });
    expect(by('Test Person Two')).toMatchObject({ department: 'Finance', jobTitle: 'Team leader', otherEmails: ['two.hq@example.test'] });
    expect(by('Test Person Three')).toMatchObject({ companyId: 'goodwill', department: 'Operations', area: { label: 'Kedah / Perlis', regionId: 'northern', states: ['Kedah', 'Perlis'] } });
    expect(by('Test Person Three').email).toBeUndefined();
    expect(by('Test Person Four').companyId).toBe(IT_COMPANY_ID);
    expect(by('Test Person Five')).toMatchObject({ companyId: 'co-alpha-guard', branchId: '', jobTitle: 'Management' });
    for (const p of ds.people) {
      expect(p).toMatchObject({ staffNo: '', idMasked: '', dob: '', hiredOn: '', phone: '', faceEnrolledOn: null });
      expect(p.basicPay).toBeUndefined();
      expect(missingStaffFacts(p)).toEqual(expect.arrayContaining(['staff number', 'nationality', 'IC or passport number', 'date of birth', 'date joined', 'phone']));
      expect(staffPayGaps(p)).toEqual(['nationality', 'date of birth', 'date joined']);
    }
    expect(missingStaffFacts(by('Test Person Five'))).toContain('branch');
    expect(missingStaffFacts(by('Test Person One'))).not.toContain('branch');
    expect(new Set(ds.people.map((p) => p.id)).size).toBe(6);
    // The same file gives the same ids (a rebuilt database keeps the office's links working).
    expect(build().people.map((p) => p.id)).toEqual(ds.people.map((p) => p.id));
  });

  it('the CEO sees every company and keeps the walls; the system feeds keep their grants', () => {
    const ds = build();
    const ceo = ds.users.find((u) => u.id === 'u-fauzan')!;
    const all = ds.companies.map((c) => c.id).sort();
    expect(visibleCompanyIds(ceo, ds.grants, TODAY).sort()).toEqual(all);
    expect(tenantCompanyIds(ceo, ds.grants, TODAY)).toEqual(expect.arrayContaining([...all, ...CENTRAL_EMPLOYER_IDS]));
    expect(isOwnerAdmin(ceo)).toBe(true);
    const generated = generateDataset({ today: TODAY, now: NOW }).users.find((u) => u.id === 'u-fauzan')!;
    expect(dataWalls(ceo)).toEqual(dataWalls(generated));
    for (const feed of ['u-cms-link', 'u-ja-sync']) expect(ds.grants.filter((g) => g.userId === feed).map((g) => g.companyId).sort()).toEqual(all);
    // No grant names a company that is not loaded, or a sign-in that is not loaded.
    for (const g of ds.grants) {
      expect(all).toContain(g.companyId);
      expect(ds.users.some((u) => u.id === g.userId)).toBe(true);
      expect(g.validFrom <= TODAY && TODAY <= g.validTo).toBe(true);
    }
  });

  it('payroll refuses to pay a record whose birth date, joining date or nationality is not recorded yet', async () => {
    const ds = build();
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const ceo = await svc.user('u-fauzan');
    const run = await svc.prepareStaffPay(ceo, GROUP_EMPLOYER_ID, TODAY.slice(0, 7));
    const view = await svc.staffPayRun(ceo, run.id);
    expect(view.blockers.join(' ')).toMatch(/Not recorded yet: .*Test Person One \(nationality, date of birth, date joined\)/);
  });
});

describe('P83: screens on staff whose facts are not recorded yet', () => {
  it('a nationality not recorded is not foreign, and stays with HR, not the foreign worker team', () => {
    expect(isForeign({ nationality: null as never })).toBe(false);
    expect(isForeign({ nationality: 'MY' })).toBe(false);
    expect(isForeign({ nationality: 'NP' as never })).toBe(true);
  });

  it("the CEO's home, the group overview and staff 'My details' load (no invalid date from a missing joining date)", async () => {
    const ds = build();
    const person = ds.people.find((p) => p.companyId === 'pwvsb')!;
    expect(person.hiredOn || null).toBeNull(); // not recorded yet
    ds.users.push({ id: 'u-staff-test', name: person.name, role: 'pwvsb_officer', department: 'hr', companyIds: ['pwvsb'], siteIds: [], personId: person.id } as never);
    ds.grants.push({ id: 'g-staff-test', userId: 'u-staff-test', companyId: 'pwvsb', scope: 'act', validFrom: TODAY, validTo: '2027-11-06' } as never);
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const ceo = await svc.user('u-fauzan');
    await expect(svc.home(ceo)).resolves.toBeTruthy();
    await expect(svc.groupOverview(ceo)).resolves.toBeTruthy();
    const staff = await svc.user('u-staff-test');
    const duty = await svc.myDuty(staff);
    expect(JSON.stringify(duty)).toMatch(/Joining date not recorded yet/);
  });
});
