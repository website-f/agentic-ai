// Data clean-up checker (Part AG, AG15): fixed rules, records by number only, who sees what. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { DATA_CLEANUP_RULES, MemoryStore, PrimaService, dataCleanupFindings, dataCleanupMaySee, generateDataset, myt, type CleanupInput, type Contract, type Person, type Site, type User } from '../src';

const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:30');
const co = (id: string, code: string) => ({ id, code, name: `${code} (mock)` }) as CleanupInput['companies'][number];
const person = (over: Partial<Person>): Person =>
  ({ id: 'p1', companyId: 'c1', branchId: '', staffNo: 'S001', name: 'Ali bin Abu', nationality: 'MY', idMasked: '900101-**-***1', dob: '1990-01-01', phone: '0100000000', role: 'guard', status: 'active', hiredOn: '2020-01-01', faceEnrolledOn: null, ...over }) as Person;
const site = (over: Partial<Site>): Site => ({ id: 's1', companyId: 'c1', branchId: '', code: 'ST-1', name: 'Site (mock)', client: 'Client (mock)', address: 'Jalan Contoh 1', lat: 3.1, lng: 101.6, risk: 'low', armed: false, geofenceM: 100, ...over }) as Site;
const contract = (over: Partial<Contract>): Contract => ({ id: 'k1', companyId: 'c1', clientAccountId: null, clientName: 'Client (mock)', siteIds: ['s1'], ref: 'CT-1', state: 'active', startOn: '2026-01-01', endOn: '2027-12-31', versions: [], mobilisation: [], rtoCert: null, reviews: [], history: [], ...over }) as Contract;
const base = (over: Partial<CleanupInput> = {}): CleanupInput => ({ companies: [co('c1', 'AAA'), co('c2', 'BBB')], people: [], sites: [site({})], posts: [{ id: 'po1', companyId: 'c1', siteId: 's1', name: 'Gate', shiftStructure: '2x12', guardsPerShift: 1 } as CleanupInput['posts'][number]], contracts: [contract({})], branches: [], today: TODAY, ...over });
const rules = (x: CleanupInput) => dataCleanupFindings(x).map((f) => `${f.rule} ${f.companyCode} ${f.record}${f.with.length ? ` [${f.with.join(',')}]` : ''}`).sort();

describe('data clean-up rules', () => {
  it('finds nothing in a clean set of records', () => {
    expect(rules(base({ people: [person({})] }))).toEqual([]);
  });

  it('finds the same person active in two companies at once, and in one company twice', () => {
    const a = person({});
    const b = person({ id: 'p2', companyId: 'c2', staffNo: 'B-77', name: 'ALI BIN ABU' });
    const c = person({ id: 'p3', staffNo: 'S009', name: 'Ali Abu' });
    expect(rules(base({ people: [a, b, c] }))).toEqual([
      'STAFF-TWICE AAA S001 [S009]',
      'STAFF-TWICE AAA S009 [S001]',
      'STAFF-TWO-COMPANIES AAA S001 [BBB B-77]',
      'STAFF-TWO-COMPANIES AAA S009 [BBB B-77]',
      'STAFF-TWO-COMPANIES BBB B-77 [AAA S001,AAA S009]',
    ]);
    // A person who left the old company is not a clash.
    expect(rules(base({ people: [{ ...a, status: 'left' }, b] }))).toEqual([]);
    // Same name and birthday but a different IC is a different person.
    expect(rules(base({ people: [a, { ...b, idMasked: '900101-**-***7' }] }))).toEqual([]);
  });

  it('finds two people with one staff number, and gaps in a person\'s record', () => {
    const got = rules(base({
      people: [
        person({}),
        person({ id: 'p2', name: 'Siti binti Ali', dob: '1995-05-05', idMasked: '950505-**-***2', staffNo: 's001 ' }),
        person({ id: 'p3', staffNo: 'S003', name: 'Chong Wei', dob: '2026-02-30', hiredOn: '', idMasked: '', phone: ' ' }),
        person({ id: 'p4', staffNo: 'S004', name: 'Raju', dob: '2000-06-01', hiredOn: '2017-01-01', idMasked: '000601-**-***3' }),
        person({ id: 'p5', staffNo: 'S005', name: 'Old Guard', dob: '1960-01-01', idMasked: '600101-**-***4' }),
      ],
    }));
    expect(got).toEqual([
      'STAFF-GUARD-OVER-AGE AAA S005',
      'STAFF-NO-BIRTH AAA S003',
      'STAFF-NO-ID AAA S003',
      'STAFF-NO-PHONE AAA S003',
      'STAFF-NO-START AAA S003',
      'STAFF-NUMBER-TWICE AAA S001',
      'STAFF-START-BEFORE-18 AAA S004',
    ]);
  });

  it('finds sites without a live contract, a post or a place, and doubled site codes', () => {
    const got = rules(base({
      sites: [site({}), site({ id: 's2', code: 'st-1 ' }), site({ id: 's3', code: 'ST-3', address: '', lat: 0, lng: 0 })],
      contracts: [contract({ siteIds: ['s1', 's2'] }), contract({ id: 'k2', ref: 'CT-2', siteIds: ['s3'], state: 'terminated' })],
    }));
    expect(got).toEqual(['SITE-CODE-TWICE AAA ST-1', 'SITE-NO-CONTRACT AAA ST-3', 'SITE-NO-PLACE AAA ST-3', 'SITE-NO-POST AAA ST-3', 'SITE-NO-POST AAA st-1 ']);
  });

  it('a renewal keeps a contract live; a lapsed one is flagged and its sites lose cover', () => {
    const renewed = contract({ endOn: '2026-06-30', renewals: [{ at: NOW, by: 'x', fromEndOn: '2026-06-30', toEndOn: '2027-06-30', signedRef: 'R1', docId: null, via: 'contracts' }] });
    expect(rules(base({ contracts: [renewed] }))).toEqual([]);
    expect(rules(base({ contracts: [contract({ endOn: '2026-10-31' })] }))).toEqual(['CONTRACT-PAST-END AAA CT-1', 'SITE-NO-CONTRACT AAA ST-1']);
  });

  it('finds contracts with wrong dates, no site, another company\'s site, or a doubled reference', () => {
    const got = rules(base({
      sites: [site({}), site({ id: 'sx', companyId: 'c2', code: 'OTHER-9' })],
      posts: [{ id: 'po1', companyId: 'c1', siteId: 's1' } as CleanupInput['posts'][number], { id: 'po2', companyId: 'c2', siteId: 'sx' } as CleanupInput['posts'][number]],
      contracts: [
        contract({}),
        contract({ id: 'k2', ref: 'ct-1', startOn: '2026-05-01', endOn: '2026-04-01', siteIds: [] }),
        contract({ id: 'k3', ref: 'CT-3', siteIds: ['s1', 'sx', 'gone'] }),
        contract({ id: 'k4', companyId: 'c2', ref: 'B-1', siteIds: ['sx'] }),
      ],
    }));
    expect(got).toEqual([
      'CONTRACT-END-BEFORE-START AAA ct-1',
      'CONTRACT-NO-SITE AAA ct-1',
      'CONTRACT-PAST-END AAA ct-1',
      'CONTRACT-REF-TWICE AAA CT-1',
      'CONTRACT-SITE-ELSEWHERE AAA CT-3 [OTHER-9,missing site]',
    ]);
  });

  it('never puts a name, IC, phone or date of birth in a finding', () => {
    const x = base({ people: [person({}), person({ id: 'p2', companyId: 'c2', staffNo: 'B-1' }), person({ id: 'p3', staffNo: 'S3', name: 'Zed', idMasked: '', phone: '' })] });
    const text = JSON.stringify(dataCleanupFindings(x));
    for (const secret of ['Ali', 'Zed', '900101', '0100000000', '1990-01-01']) expect(text).not.toContain(secret);
    for (const r of Object.values(DATA_CLEANUP_RULES)) expect(`${r.what} ${r.fix}`).not.toMatch(/\bAI\b|Claude|Foundry|OpenAI|model/i);
  });
});

describe('who sees which findings', () => {
  const u = (over: Partial<User>) => ({ id: 'u', name: 'U', title: 'T', role: 'company_manager', companyIds: ['c1'], siteIds: [], ...over }) as User;
  it('the company office sees its own companies; HR sees staff in every company; leaders and ACT see all', () => {
    const staffC2 = { area: 'staff' as const, companyId: 'c2' };
    const siteC1 = { area: 'site' as const, companyId: 'c1' };
    expect(dataCleanupMaySee(u({}), siteC1)).toBe(true);
    expect(dataCleanupMaySee(u({}), staffC2)).toBe(false);
    expect(dataCleanupMaySee(u({ role: 'pwvsb_officer', department: 'hr', companyIds: [] }), staffC2)).toBe(true);
    expect(dataCleanupMaySee(u({ role: 'pwvsb_officer', department: 'hr', companyIds: [] }), siteC1)).toBe(false);
    expect(dataCleanupMaySee(u({ role: 'pwvsb_officer', department: 'audit', companyIds: [] }), siteC1)).toBe(true);
    expect(dataCleanupMaySee(u({ role: 'pwvsb_officer', department: 'it', companyIds: ['c1'] }), siteC1)).toBe(false);
    expect(dataCleanupMaySee(u({ integration: true } as Partial<User>), siteC1)).toBe(false);
  });

  it('the service keeps each person to their findings, refuses others, and puts the count on the company office\'s Home', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const cm = await svc.user('u-cm-sasa');
    const mine = await svc.dataCleanup.board(cm);
    expect(mine.findings.every((f) => cm.companyIds.includes(f.companyId))).toBe(true);
    const hr = await svc.dataCleanup.board(await svc.user('u-pwvsb-hr'));
    expect(hr.findings.every((f) => f.area === 'staff')).toBe(true);
    const all = await svc.dataCleanup.board(await svc.user('u-fd'));
    expect(all.total).toBeGreaterThanOrEqual(mine.total);
    await expect(svc.dataCleanup.board(await svc.user('u-transport'))).rejects.toThrow(/data clean-up/);
    // A filter narrows the list but not the counts per company.
    const sites = await svc.dataCleanup.board(await svc.user('u-fd'), { area: 'site' });
    expect(sites.findings.every((f) => f.area === 'site')).toBe(true);
    expect(sites.total).toBe(all.total);
    const home = await svc.dataCleanup.homeItems(cm);
    const fix = mine.findings.filter((f) => f.level === 'fix').length;
    expect(home.length).toBe(fix ? 1 : 0);
    expect(await svc.dataCleanup.homeItems(await svc.user('u-fd'))).toEqual([]);
  });
});
