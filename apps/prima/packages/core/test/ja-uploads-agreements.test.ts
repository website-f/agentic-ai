import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, checkAssignment, generateDataset, hasSignedAgreement, myt } from '../src';
import type { Person, Shift } from '../src/types';

// JA salary and roster uploads (Fauzan, 23 Nov 2026: "OM uploads both", "Let company also can upload. Which ever") and
// guard employment agreements (Fauzan, 23 Nov 2026, decision card "Warn only, chase daily"). Synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  return { svc, store, cm: await svc.user('u-cm-sasa'), om: await svc.user('u-om-klang'), it: await svc.user('u-it-mgr'), otherCm: await svc.user('u-cm-arsh') };
}

async function siteWithGuards(store: MemoryStore, companyId: string) {
  const sites = (await store.list('sites', { companyId: [companyId] })).filter((s) => s.sector !== 'government');
  const posts = await store.list('posts', { companyId: [companyId] });
  const site = sites.find((s) => posts.filter((p) => p.siteId === s.id).length === 1)!;
  const guards = (await store.list('people', { companyId: [companyId] })).filter((p) => p.role !== 'office' && p.status === 'active');
  return { site, post: posts.find((p) => p.siteId === site.id)!, guards };
}

describe('JA salary upload', () => {
  it('the company office and the OM upload; another company and IT are refused', async () => {
    const { svc, cm, om, it: itMgr, otherCm, store } = await setup();
    const g = (await siteWithGuards(store, 'co-sasa')).guards;
    const rows = [
      { staffNo: g[0].staffNo, basic: '1700', otHours: '20', otPay: '200', allowances: '100', epf: '220', socso: '10', eis: '4', pcb: '', otherDeductions: '', gross: '2000', net: '1766', paidOn: '' },
      { staffNo: g[1].staffNo, basic: '1700', gross: '1700', net: '1700' },
      { staffNo: 'NOPE-1', basic: '1', gross: '1', net: '1' },
      { staffNo: g[0].staffNo, basic: '1', gross: '1', net: '1' },
      { staffNo: g[2].staffNo, basic: '1700', epf: '200', gross: '1700', net: '1700' },
    ];
    const r = await svc.jaUploadPay(cm, { companyId: 'co-sasa', period: '2026-10', fileName: 'oct.csv', rows });
    expect(r.accepted).toBe(2);
    expect(r.rejected.map((x) => x.line)).toEqual([4, 5, 6]);
    expect(r.rejected[2].reason).toMatch(/gross less deductions/);
    expect(r.totalNet).toBe(3466);
    const kept = (await store.list('jaRecords', { companyId: ['co-sasa'] })).filter((x) => x.dataset === 'paySummary' && x.externalId.startsWith('upload:2026-10:'));
    expect(kept).toHaveLength(2);
    // Uploading again replaces each guard's line for the month.
    await svc.jaUploadPay(om, { companyId: 'co-sasa', period: '2026-10', fileName: 'oct2.csv', rows: [{ staffNo: g[0].staffNo, basic: '1800', gross: '1800', net: '1800' }] });
    const again = (await store.list('jaRecords', { companyId: ['co-sasa'] })).filter((x) => x.externalId === `upload:2026-10:${g[0].staffNo.toUpperCase()}`);
    expect(again).toHaveLength(1);
    expect(again[0].paySummary?.net).toBe(1800);
    await expect(svc.jaUploadPay(otherCm, { companyId: 'co-sasa', period: '2026-10', rows })).rejects.toThrow();
    await expect(svc.jaUploadPay(itMgr, { companyId: 'co-sasa', period: '2026-10', rows })).rejects.toThrow();
    await expect(svc.jaUploadPay(cm, { companyId: 'co-sasa', period: '2027-01', rows })).rejects.toThrow(/future/);
    expect((await svc.jaUploadOptions(itMgr)).payCompanies).toEqual([]);
  });
});

describe('JA roster upload', () => {
  it('publishes duties, refuses bad lines and takes off later duties left out of a new file', async () => {
    const { svc, cm, otherCm, store } = await setup();
    const { site, post, guards } = await siteWithGuards(store, 'co-sasa');
    const [a, b] = guards;
    const rows = [
      { staffNo: a.staffNo, date: '2026-11-25', start: '07:00', end: '19:00', post: '' },
      { staffNo: a.staffNo, date: '2026-11-26', start: '19:00', end: '07:00', post: post.name },
      { staffNo: b.staffNo, date: '2026-11-25', start: '07:00', end: '19:00', post: '' },
      { staffNo: a.staffNo, date: '2026-11-25', start: '08:00', end: '10:00', post: '' },
      { staffNo: a.staffNo, date: '2026-11-20', start: '07:00', end: '19:00', post: '' },
      { staffNo: a.staffNo, date: '2026-11-27', start: '7am', end: '19:00', post: '' },
      { staffNo: a.staffNo, date: '2026-11-28', start: '07:00', end: '19:00', post: 'No such post' },
    ];
    const r = await svc.jaUploadRoster(cm, { siteId: site.id, month: '2026-11', fileName: 'nov.csv', rows });
    expect(r.published).toBe(3);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/overlaps/),
      expect.stringMatching(/past day/),
      expect.stringMatching(/times like/),
      expect.stringMatching(/no post/),
    ]);
    const mine = (await store.list('shifts', { companyId: ['co-sasa'] })).filter((s) => s.id.startsWith(`jaroster:${site.id}:`));
    expect(mine.filter((s) => s.status === 'published')).toHaveLength(3);
    const night = mine.find((s) => s.date === '2026-11-26')!;
    expect(night.end).toBe(myt('2026-11-27', '07:00'));
    // A new file without guard B takes B's duty off (to draft), never deleting it.
    const r2 = await svc.jaUploadRoster(cm, { siteId: site.id, month: '2026-11', rows: rows.slice(0, 2) });
    expect(r2.removed).toBe(1);
    const bDuty = (await store.list('shifts', { companyId: ['co-sasa'] })).find((s) => s.id.startsWith(`jaroster:${site.id}:2026-11-25:${b.id}`))!;
    expect(bDuty.status).toBe('draft');
    await expect(svc.jaUploadRoster(otherCm, { siteId: site.id, month: '2026-11', rows })).rejects.toThrow();
  });
});

describe('Guard employment agreements', () => {
  it('lists guards with no signed agreement, tells the company office and warns on the roster without stopping duty', async () => {
    const { svc, cm, it: itMgr, store } = await setup();
    const { site, guards } = await siteWithGuards(store, 'co-sasa');
    const board = await svc.guardAgreements(cm);
    expect(board.rows.map((r) => r.companyId)).toEqual(['co-sasa']);
    const row = board.rows[0];
    const onBooks = (await store.list('people', { companyId: ['co-sasa'] })).filter((p) => p.role !== 'office' && p.status !== 'left');
    expect(row.guards).toBe(onBooks.length);
    expect(row.signed + row.missing.length).toBe(row.guards);
    expect(row.missing.every((m) => !hasSignedAgreement(onBooks.find((p) => p.id === m.personId) as Person))).toBe(true);
    await expect(svc.guardAgreements(itMgr)).rejects.toThrow();

    // An old guard with no agreement: overdue, on the company office's home, and a roster warning (not a block).
    const old = guards.find((p) => p.hiredOn < '2026-10-01')!;
    await store.update('people', old.id, { hiringDocs: [] });
    const after = await svc.guardAgreements(cm, 'co-sasa');
    expect(after.rows[0].missing.find((m) => m.personId === old.id)?.overdue).toBe(true);
    const home = await svc.home(cm, 'co-sasa');
    expect(home.todo.some((t) => t.tag === 'Agreements')).toBe(true);
    const shift: Shift = { id: 'x', companyId: 'co-sasa', siteId: site.id, postId: 'p', personId: old.id, date: '2026-11-25', start: myt('2026-11-25', '07:00'), end: myt('2026-11-25', '15:00'), status: 'draft' };
    const f = checkAssignment({ person: { ...old, hiringDocs: [] }, credentials: [], shift, site, otherShifts: [] }).find((x) => x.code === 'NO_AGREEMENT');
    expect(f?.level).toBe('warn');
    // A guard who joined within the grace days is not warned yet; once uploaded, no warning.
    expect(checkAssignment({ person: { ...old, hiringDocs: [], hiredOn: '2026-11-20' }, credentials: [], shift, site, otherShifts: [] }).some((x) => x.code === 'NO_AGREEMENT')).toBe(false);
    expect(
      checkAssignment({ person: { ...old, hiringDocs: [{ kind: 'AGREEMENT', docIds: ['d1'], by: 'HR', at: NOW }] }, credentials: [], shift, site, otherShifts: [] }).some((x) => x.code === 'NO_AGREEMENT'),
    ).toBe(false);
    // The people list carries the flag for the "No agreement" filter.
    const people = await svc.people(cm, 'co-sasa');
    expect(people.find((r) => r.person.id === old.id)?.agreement).toBe(false);
  });
});

describe('Operations standards duties', () => {
  it('lists ISO, PIKM and RBA duties for the sites an OM or company office covers, and refuses others', async () => {
    const { svc, cm, om, it: itMgr, store } = await setup();
    const asCm = await svc.opsStandardsDuties(cm);
    const keys = asCm.duties.map((d) => d.key);
    for (const k of ['instructions', 'roster-NO_AGREEMENT', 'roster-RISK_BRIEFING', 'deployable', 'client-visit', 'client-ack', 'cases']) expect(keys).toContain(k);
    expect(asCm.duties.every((d) => d.count === null || d.count >= 0)).toBe(true);
    // A site with no client-signed instructions is counted; signing them takes it off.
    const { site } = await siteWithGuards(store, 'co-sasa');
    await store.update('sites', site.id, { instructions: null });
    const before = (await svc.opsStandardsDuties(cm)).duties.find((d) => d.key === 'instructions')!.count!;
    await store.update('sites', site.id, {
      instructions: { version: 1, general: 'g', posts: [], emergency: 'e', reporting: 'r', by: 'x', byId: 'x', at: NOW, clientSigned: { name: 'Client', role: 'Manager', on: TODAY, ref: 'file', by: 'x', at: NOW }, history: [] },
    });
    expect((await svc.opsStandardsDuties(cm)).duties.find((d) => d.key === 'instructions')!.count).toBe(before - 1);
    const asOm = await svc.opsStandardsDuties(om);
    expect(asOm.sites).toBeGreaterThan(0);
    await expect(svc.opsStandardsDuties(itMgr)).rejects.toThrow();
  });
});

describe("JA's Monthly Salary Type 2 report", () => {
  it('is recognised by its report boxes and read into salary lines that balance', async () => {
    const { fromJaSalaryType2, isJaSalaryType2, JA_SALARY_TYPE2: b } = await import('../src');
    const { svc, cm, store } = await setup();
    const g = (await siteWithGuards(store, 'co-sasa')).guards[0];
    // Synthetic line in the report's shape: basic 1700 + allowance 100 + OT 800 + extra OT 50 + off-day 100 = 2750 gross;
    // 2750 - EPF 187 - SOCSO 12 - EIS 5 - SKBBK 19 - deduction 10 - advance 500 - absence 60 = 1957 net.
    const row: Record<string, string> = { textBox8: 'Note', textBox1: 'Synthetic Guard', [b.staffNo]: g.staffNo, [b.basic]: '1700.00', [b.allowances]: '100.00', [b.otPay]: '800.00', [b.extraOt]: '50.00', [b.offDayPay]: '100.00', [b.holidayPay]: '0.00', [b.day31Pay]: '0.00', [b.epf]: '187.00', [b.socso]: '12.00', [b.eis]: '5.00', [b.socsoSkbbk]: '19.00', [b.deduction]: '10.00', [b.advance]: '500.00', [b.absenceDeduction]: '60.00', [b.gross]: '2750.00', [b.net]: '1957.00' };
    expect(isJaSalaryType2(Object.keys(row))).toBe(true);
    expect(isJaSalaryType2(['staffNo', 'gross', 'net'])).toBe(false);
    const lines = fromJaSalaryType2([row, { textBox8: 'Note' }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ otPay: '950', socso: '31', otherDeductions: '570', gross: '2750', net: '1957' });
    const r = await svc.jaUploadPay(cm, { companyId: 'co-sasa', period: '2026-10', fileName: 'MonthlySalaryType2.csv', rows: lines });
    expect(r.accepted).toBe(1);
    expect(r.rejected).toEqual([]);
  });
});

describe('Age exception 61 to 65', () => {
  it('blocks over 60 unless the HR Director or CEO gives an exception with a valid yearly medical; over 65 always', async () => {
    const { deployability } = await import('../src');
    const { svc, store, cm } = await setup();
    const cos = await svc.user('u-cos');
    const ceo = await svc.user('u-fauzan');
    const g = (await siteWithGuards(store, 'co-sasa')).guards[0];
    await store.update('people', g.id, { dob: '1963-06-01', ageException: null }); // 63 on 23 Nov 2026
    const codes = async () => {
      const p = (await store.get('people', g.id))!;
      return deployability(p, await store.list('credentials', { companyId: ['co-sasa'] }), TODAY, false).filter((f) => f.code === 'OVER_AGE' || f.code === 'AGE_EXCEPTION').map((f) => `${f.level}:${f.code}`);
    };
    expect(await codes()).toEqual(['block:OVER_AGE']);
    // No medical yet: refused. The company manager may not decide.
    await expect(svc.decideAgeException(cos, g.id, { until: '2027-05-31', reason: 'Experienced guard, client asked to keep him' })).rejects.toThrow(/medical/);
    await expect(svc.decideAgeException(cm, g.id, { until: '2027-05-31', reason: 'Experienced guard, client asked to keep him' })).rejects.toThrow();
    await store.insert('credentials', { id: 'med-x', companyId: 'co-sasa', personId: g.id, type: 'MEDICAL_CHECK', number: 'MED-1', issuedOn: '2026-11-01', expiresOn: '2027-10-31' });
    // More than 12 months, or no reason: refused.
    await expect(svc.decideAgeException(cos, g.id, { until: '2027-12-31', reason: 'Experienced guard, client asked to keep him' })).rejects.toThrow(/12 months/);
    await expect(svc.decideAgeException(cos, g.id, { until: '2027-05-31', reason: 'ok' })).rejects.toThrow(/reason/);
    await svc.decideAgeException(cos, g.id, { until: '2027-05-31', reason: 'Experienced guard, client asked to keep him' });
    expect(await codes()).toEqual(['warn:AGE_EXCEPTION']);
    // The CEO may end it early with a reason.
    await svc.decideAgeException(ceo, g.id, { action: 'end', reason: 'Medical advice received, stop deployment' });
    expect(await codes()).toEqual(['block:OVER_AGE']);
    // Over 65: always blocked and no exception possible.
    await store.update('people', g.id, { dob: '1960-01-01', ageException: { until: '2027-01-01', reason: 'x'.repeat(12), by: 'x', byId: 'x', at: NOW } });
    expect(await codes()).toEqual(['block:OVER_AGE']);
    await expect(svc.decideAgeException(cos, g.id, { until: '2027-01-01', reason: 'Experienced guard, client asked to keep him' })).rejects.toThrow(/over 65/);
  });
});
