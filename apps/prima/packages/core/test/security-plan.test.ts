import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, guardCover, guardContractFlags, guardRuleClashes, KPM_GUARD_RULES, kpmGuardKit, kpmGuardTerms, planRoute, type GuardTerms } from '../src';

const TODAY = '2026-11-04';
const NOW = '2026-11-04T03:00:00.000Z';
function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}
const ms = (t: string) => Date.parse(t);

describe('guard duty and officer route plans (Fauzan, 4 Nov 2026)', () => {
  it('plans every rostered guard minute by minute: handover, rounds in turns, staggered meals, no gaps or overlaps', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const selangor = new Set(ds.branches.filter((b) => b.state === 'Selangor').map((b) => b.id));
    const site = ds.sites.find((s) => selangor.has(s.branchId) && ds.shifts.filter((x) => x.siteId === s.id && x.date === TODAY && x.personId).length >= 2)!;
    const r = await svc.duty.posts(om, site.id, TODAY);
    expect(r.access).toBe('manage');
    const shifts = ds.shifts.filter((x) => x.siteId === site.id && x.date === TODAY && x.personId);
    for (const sh of shifts) {
      const mine = r.preview.tasks.filter((t) => t.who === sh.personId && ms(t.start) >= ms(sh.start) && ms(t.end) <= ms(sh.end)).sort((a, b) => a.start.localeCompare(b.start));
      expect(mine[0].kind).toBe('handover');
      expect(mine.at(-1)!.kind).toBe('handover');
      // Covers the whole shift with no gap or overlap.
      expect(ms(mine[0].start)).toBe(ms(sh.start));
      expect(ms(mine.at(-1)!.end)).toBe(ms(sh.end));
      for (let i = 1; i < mine.length; i++) expect(ms(mine[i].start)).toBe(ms(mine[i - 1].end));
    }
    expect(r.preview.tasks.some((t) => t.kind === 'patrol')).toBe(true);
    // Company manager views, cannot publish; OM publishes; changing the roster marks it out of date.
    await expect(svc.duty.publishPosts(await svc.user('u-cm-arsh'), site.id, TODAY)).rejects.toThrow(/Not allowed/);
    const p = await svc.duty.publishPosts(om, site.id, TODAY);
    expect(p.tasks.length).toBe(r.preview.tasks.length);
    const sh = shifts[0];
    sh.personId = null;
    expect((await svc.duty.posts(om, site.id, TODAY)).outOfDate).toBe(true);
    await expect(svc.duty.posts(await svc.user('u-om-johor'), site.id, TODAY)).rejects.toThrow(/Not allowed/);
  });

  it('plans an officer day: urgent sites first, travel between sites, lunch, within hours', async () => {
    const { svc } = fresh();
    const om = await svc.user('u-om-klang');
    const officers = await svc.duty.officers(om);
    const o = officers.find((x) => x.access === 'manage')!;
    expect(o).toBeTruthy();
    const r = await svc.duty.route(om, o.id, TODAY);
    const t = r.preview.tasks;
    expect(t.some((x) => x.kind === 'visit')).toBe(true);
    expect(t.filter((x) => x.kind === 'lunch').length).toBeLessThanOrEqual(1);
    expect(t.every((x) => x.start >= `${TODAY}T08:00` && x.end <= `${TODAY}T17:00:00+08:00`)).toBe(true);
    for (let i = 1; i < t.length; i++) expect(ms(t[i].start)).toBe(ms(t[i - 1].end));
    const pub = await svc.duty.publishRoute(om, o.id, TODAY, null);
    await expect(svc.duty.publishRoute(om, o.id, TODAY, null)).rejects.toThrow(/already/);
    expect((await svc.duty.route(om, o.id, TODAY)).saved!.publishedAt).toBe(pub.publishedAt);
    await expect(svc.duty.publishRoute(await svc.user('u-cm-arsh'), o.id, TODAY, pub.publishedAt)).rejects.toThrow(/Not allowed/);
  });

  it('lets the OM set an officer night shift that runs past midnight (Fauzan, 4 Nov 2026: hours are flexible)', async () => {
    const { svc } = fresh();
    const om = await svc.user('u-om-klang');
    const o = (await svc.duty.officers(om)).find((x) => x.access === 'manage')!;
    const night = { start: '20:00', end: '06:00', mealMin: 30 };
    const r = await svc.duty.route(om, o.id, TODAY, night);
    const t = r.preview.tasks;
    expect(r.hours).toEqual(night);
    expect(ms(t[0].start)).toBe(ms(`${TODAY}T20:00:00+08:00`));
    expect(t.every((x) => ms(x.end) <= ms('2026-11-05T06:00:00+08:00'))).toBe(true);
    for (const m of t.filter((x) => x.kind === 'lunch')) expect(m.title).toBe('Meal break');
    for (let i = 1; i < t.length; i++) expect(ms(t[i].start)).toBe(ms(t[i - 1].end));
    await expect(svc.duty.route(om, o.id, TODAY, { start: '08:00', end: '08:00', mealMin: 30 })).rejects.toThrow(/HH:MM/);
    await expect(svc.duty.route(om, o.id, TODAY, { start: '06:00', end: '23:00', mealMin: 30 })).rejects.toThrow(/14 hours/);
    const pub = await svc.duty.publishRoute(om, o.id, TODAY, null, night);
    expect(pub.hours).toEqual(night);
    // Without hours given, the screen shows the published hours.
    expect((await svc.duty.route(om, o.id, TODAY)).hours).toEqual(night);
  });

  it('contract terms: guards per shift and rate per guard-hour give the cover check and deduction estimate (KPM SST, 4 Nov 2026)', async () => {
    // The KPM contract Fauzan shared: RM12.61 per guard-hour, one guard on each 12-hour shift = RM9,230.52 a month.
    const kpm: GuardTerms = { id: 'gterms-x', companyId: 'c', siteId: 'x', contractRef: 'SYNTHETIC', ratePerGuardHour: 12.61, ...kpmGuardTerms(1), version: 1, updatedBy: 'x', updatedAt: NOW };
    const none = guardCover(kpm, [], 'x', TODAY);
    expect(none.monthlyPrice).toBe(9230.52);
    expect(none.missedClockingCost).toBe(2.52);
    expect(none.shortGuardHours).toBe(24);
    expect(none.deduction).toBe(302.64);
    expect(guardCover(kpm, [{ siteId: 'x', date: TODAY, personId: 'g', start: `${TODAY}T07:00:00+08:00`, end: `${TODAY}T19:00:00+08:00` } as never], 'x', TODAY).offTimes).toEqual(['07:00-19:00']);

    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const selangor = new Set(ds.branches.filter((b) => b.state === 'Selangor').map((b) => b.id));
    const site = ds.sites.find((s) => selangor.has(s.branchId) && ds.shifts.filter((x) => x.siteId === s.id && x.date === TODAY && x.personId).length >= 1)!;
    const cm = await svc.user(ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(site.companyId))!.id);
    const sh = ds.shifts.filter((x) => x.siteId === site.id && x.date === TODAY && x.personId).sort((a, b) => a.start.localeCompare(b.start))[0];
    const start = new Date(Date.parse(sh.start) + 8 * 3600_000).toISOString().slice(11, 16);
    const end = new Date(Date.parse(sh.end) + 8 * 3600_000).toISOString().slice(11, 16);
    const rostered = ds.shifts.filter((x) => x.siteId === site.id && x.date === TODAY && x.personId && x.start === sh.start).length;
    const terms = { contractRef: 'SYNTHETIC-KPM', ratePerGuardHour: 12.61, shifts: [{ name: 'Day', start, end, guards: rostered + 1 }], minCheckpoints: 50, officerVisitDays: 7, dailyReportBy: '09:00' };
    await expect(svc.duty.saveTerms(cm, site.id, terms, null)).rejects.toThrow(/Not allowed/);
    await expect(svc.duty.saveTerms(om, site.id, { ...terms, shifts: [{ name: 'Long', start: '06:00', end: '20:00', guards: 1 }] }, null)).rejects.toThrow(/12 hours/);
    await expect(svc.duty.saveTerms(om, site.id, { ...terms, ratePerGuardHour: -1 }, null)).rejects.toThrow(/Rate/);
    const saved = await svc.duty.saveTerms(om, site.id, terms, null);
    await expect(svc.duty.saveTerms(om, site.id, terms, null)).rejects.toThrow(/changed/);
    const r = await svc.duty.posts(cm, site.id, TODAY);
    expect(r.terms!.version).toBe(saved.version);
    const hours = (Date.parse(sh.end) - Date.parse(sh.start)) / 3600_000;
    expect(r.cover!.cover[0]).toMatchObject({ required: rostered + 1, rostered, short: 1 });
    expect(r.cover!.deduction).toBeCloseTo(12.61 * hours, 2);
    expect(r.preview.warnings.some((w) => /needs \d+ guards?, \d+ on the roster: about RM/.test(w))).toBe(true);
    expect(r.preview.warnings.some((w) => /at least 50 guard tour points/.test(w))).toBe(true);
    expect(r.preview.tasks.some((t) => /Daily report for the premise administrator/.test(t.title))).toBe(true);
    expect(r.deductionRules.map((x) => x.key)).toContain('clocking');
  });

  it('puts a site whose contract visit is due first on the officer route, and warns when it does not fit', () => {
    const site = (id: string, lat: number, risk: 'high' | 'low') => ({ id, name: id, lat, lng: 101.6, risk, armed: false }) as never;
    const sites = [site('busy-high', 3.1, 'high'), site('quiet-low', 3.2, 'low')];
    const lastVisit = new Map([['quiet-low', '2026-10-20']]);
    const base = { officer: { id: 'o', name: 'Officer' }, date: TODAY, sites, openCases: new Map(), lastVisit };
    expect(planRoute(base).tasks.find((t) => t.kind === 'visit')!.siteId).toBe('busy-high');
    const due = planRoute({ ...base, visitEvery: new Map([['quiet-low', 7]]) });
    expect(due.tasks.find((t) => t.kind === 'visit')!.siteId).toBe('quiet-low');
    const short = planRoute({ ...base, visitEvery: new Map([['quiet-low', 7], ['busy-high', 1]]), hours: { start: '08:00', end: '08:40', mealMin: 0 } });
    expect(short.warnings.some((w) => /Contract visit due and not fitted today/.test(w))).toBe(true);
  });

  it('KPM guard equipment: no walkie-talkies for a lone guard; batons, raincoats and torches by the busiest shift', () => {
    const one = kpmGuardKit(1, 2);
    expect(one.some((x) => /Walkie/.test(x.name))).toBe(false);
    expect(one.find((x) => x.id === 'kpm-whistle')!.required).toBe(2);
    expect(one.find((x) => x.id === 'kpm-tour-points')!.required).toBe(4);
    const four = kpmGuardKit(4, 6);
    expect(four.find((x) => x.id === 'kpm-radio')!.required).toBe(4);
    expect(four.find((x) => x.id === 'kpm-baton')!.required).toBe(4);
    expect(four.find((x) => x.id === 'kpm-whistle')!.required).toBe(6);
  });

  it("our rules govern; the contract's guard rules are compared and flagged (Fauzan, 4 Nov 2026)", async () => {
    const clash = guardRuleClashes(KPM_GUARD_RULES);
    expect(clash.map((c) => c.topic)).toEqual(['Guard age', 'CSG course', 'Nationality', 'KDN vetting', 'Urine test', 'Relatives']);
    expect(clash[0].note).toMatch(/Our rule applies: no guard over 60/);
    expect(clash[1].note).toMatch(/breaches the contract/);
    expect(guardRuleClashes({ ...KPM_GUARD_RULES, maxAge: 55 })[0].note).toMatch(/contract is stricter/);
    const g = (id: string, nationality: 'MY' | 'NP', dob: string, hiredOn: string) => ({ id, name: id, nationality, dob, hiredOn }) as never;
    const flags = guardContractFlags(KPM_GUARD_RULES, [g('nepali', 'NP', '1990-01-01', '2026-10-01'), g('nocsg', 'MY', '1990-01-01', '2026-01-01'), g('fine', 'MY', '1990-01-01', '2026-01-01')], [{ personId: 'fine', type: 'CSG_TRAINING' } as never], TODAY);
    expect(flags).toHaveLength(2);
    expect(flags[0]).toMatch(/nepali is not Malaysian/);
    expect(flags[1]).toMatch(/nocsg has no CSG 6 months/);
    // Saved with the terms; the screen shows the clashes.
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const selangor = new Set(ds.branches.filter((b) => b.state === 'Selangor').map((b) => b.id));
    const site = ds.sites.find((s) => selangor.has(s.branchId))!;
    await expect(svc.duty.saveTerms(om, site.id, { ...kpmGuardTerms(1), contractRef: '', ratePerGuardHour: null, guardRules: { ...KPM_GUARD_RULES, maxAge: 200 } }, null)).rejects.toThrow(/age limit/);
    await svc.duty.saveTerms(om, site.id, { ...kpmGuardTerms(1), contractRef: '', ratePerGuardHour: null, guardRules: KPM_GUARD_RULES }, null);
    expect((await svc.duty.posts(om, site.id, TODAY)).ruleClashes).toHaveLength(6);
  });
});
