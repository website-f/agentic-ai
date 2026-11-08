import { describe, expect, it } from 'vitest';
import { planPeople, dueJobs, kpmSchoolAreas, kpmWeek, minutesFor, nowAndNext, planCleaningDay, setupProblems, toMin, type CleaningSite, type PlanPerson } from '../src/cleaning';

// Synthetic school: 6 acres, 30 toilet cubicles, 5 workers (1 supervisor + 4 cleaners).
function school(over: Partial<CleaningSite> = {}): CleaningSite {
  const facts = { acres: 6, blocks: 6, floors: 12, toiletCubicles: 30 };
  const areas = kpmSchoolAreas(facts, false).map((a) =>
    a.id === 'floors' ? { ...a, size: 2400 } : a.id === 'drains' ? { ...a, size: 300 } : a.id === 'rubbish' ? { ...a, size: 25 } : a.id === 'pots' ? { ...a, size: 60 } : a,
  );
  return {
    id: 'cln-s1',
    companyId: 'co-x',
    siteId: 's1',
    template: 'kpm_school',
    contractRef: 'TEST-CONTRACT',
    requiredHeadcount: 5,
    facts,
    week: kpmWeek('sat_sun'),
    secondSession: null,
    closedDays: [],
    cycleStart: '2026-11-02',
    monthlyWage: 1700,
    map: null,
    crew: [
      { id: 'p-sup', name: 'Supervisor A', role: 'supervisor', session: 1, personId: null },
      { id: 'p-c1', name: 'Cleaner 1', role: 'cleaner', session: 1, personId: null },
      { id: 'p-c2', name: 'Cleaner 2', role: 'cleaner', session: 1, personId: null },
      { id: 'p-c3', name: 'Cleaner 3', role: 'cleaner', session: 1, personId: null },
      { id: 'p-c4', name: 'Cleaner 4', role: 'cleaner', session: 1, personId: null },
    ],
    areas,
    version: 1,
    updatedBy: 'test',
    updatedAt: '2026-11-01T00:00:00+08:00',
    equipment: [],
    supplies: [],
    ...over,
  };
}
const people = (s: CleaningSite): PlanPerson[] => planPeople(s);

describe('cleaning planner (Fauzan, 4 Nov 2026)', () => {
  it('turns sizes into minutes with the default or the area rate', () => {
    expect(minutesFor({ work: 'sweep', size: 400, ratePerHour: null })).toBe(60);
    expect(minutesFor({ work: 'sweep', size: 400, ratePerHour: 200 })).toBe(120);
    expect(minutesFor({ work: 'toilet', size: 30, ratePerHour: null })).toBe(180);
  });

  it('plans a weekday minute by minute with no overlaps, breaks in turns and a check after every job', () => {
    const s = school();
    const out = planCleaningDay({ site: s, date: '2026-11-04', people: people(s), absentIds: [] });
    expect(out.hours?.start).toBe('07:00');
    // No person is in two places at once.
    for (const p of s.crew) {
      const mine = out.tasks.filter((t) => t.crewId === p.id).sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < mine.length; i++) expect(toMin(mine[i].start)).toBeGreaterThanOrEqual(toMin(mine[i - 1].end));
      // Within the working day.
      for (const t of mine) expect(t.start >= '07:00' && t.end <= '16:00').toBe(true);
    }
    // Breaks in two turns.
    const breaks = new Set(out.tasks.filter((t) => t.type === 'break').map((t) => t.start));
    expect([...breaks].sort()).toEqual(['12:00', '13:00']);
    // Toilets twice a day; every work task is checked by the supervisor after it ends.
    const work = out.tasks.filter((t) => t.type === 'work');
    expect(work.filter((t) => t.areaId === 'toilets').length).toBeGreaterThanOrEqual(2);
    for (const w of work) {
      const check = out.tasks.find((t) => t.type === 'inspect' && t.checksTaskId === w.id);
      if (check) expect(check.start >= w.end).toBe(true);
      else expect(out.uncovered.some((u) => u.jobKey === `check:${w.jobKey}`)).toBe(true);
    }
    expect(out.tasks.some((t) => t.type === 'report' && t.crewId === 'p-sup')).toBe(true);
    expect(out.summary.headcountShort).toBe(0);
    // Rest day: nothing planned.
    expect(planCleaningDay({ site: s, date: '2026-11-08', people: people(s), absentIds: [] }).tasks).toEqual([]);
  });

  it('spreads grass over the working days of the first 15 days of each 2-week round', () => {
    const s = school();
    let total = 0;
    const days: string[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.parse('2026-11-02T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
      const hours = s.week[new Date(`${d}T00:00:00Z`).getUTCDay()];
      if (!hours) continue;
      const g = dueJobs(s, d, hours).filter((j) => j.area.id === 'grass');
      if (g.length) days.push(d);
      total += g.reduce((n, j) => n + j.size, 0);
    }
    expect(Math.round(total)).toBe(s.areas.find((a) => a.id === 'grass')!.size);
    expect(days.length).toBe(12); // Mon-Sat for two weeks
    // Carpets twice a week, drains once a week.
    const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
    const count = (id: string) => week.filter((d) => dueJobs(s, d, s.week[new Date(`${d}T00:00:00Z`).getUTCDay()]!).some((j) => j.area.id === id)).length;
    expect(count('drains')).toBe(1);
    expect(count('carpets')).toBe(0); // carpets not measured yet: size 0 is left out
  });

  it('flags missing workers, the contract deduction and work that cannot fit', () => {
    const s = school();
    const out = planCleaningDay({ site: s, date: '2026-11-04', people: people(s), absentIds: ['p-c1', 'p-c2', 'p-c3'] });
    expect(out.summary.headcountShort).toBe(3);
    expect(out.summary.deductionEstimate).toBeCloseTo((1700 / 30.5) * 3, 1);
    expect(out.uncovered.length).toBeGreaterThan(0);
    expect(out.summary.cleanersNeeded).toBeGreaterThan(1);
    expect(out.tasks.some((t) => t.crewId === 'p-c1')).toBe(false);
  });

  it('re-plans from a time, keeping what is done', () => {
    const s = school();
    const first = planCleaningDay({ site: s, date: '2026-11-04', people: people(s), absentIds: [] });
    const done = first.tasks.filter((t) => t.type === 'work' && t.end <= '10:00').map((t) => ({ ...t, status: 'done' as const }));
    const again = planCleaningDay({ site: s, date: '2026-11-04', people: people(s), absentIds: ['p-c4'], keep: done, fromTime: '10:00' });
    for (const d of done) expect(again.tasks.find((t) => t.id === d.id)?.status).toBe('done');
    const fresh = again.tasks.filter((t) => t.type === 'work' && t.status === 'planned');
    for (const t of fresh) expect(t.start >= '10:00').toBe(true);
    expect(fresh.some((t) => done.some((d) => d.jobKey === t.jobKey))).toBe(false);
    expect(again.tasks.some((t) => t.crewId === 'p-c4' && t.status === 'planned')).toBe(false);
  });

  it('two-session schools: session 2 works 9-6; 4 toilet rounds; 60:40 checked', () => {
    const s = school({ secondSession: { start: '09:00', end: '18:00' } });
    s.areas = kpmSchoolAreas(s.facts, true).map((a) => (a.id === 'floors' ? { ...a, size: 2400 } : a));
    const out = planCleaningDay({ site: s, date: '2026-11-04', people: people(s).map((p, i) => (i >= 4 ? { ...p, session: 2 as const } : p)), absentIds: [] });
    expect(out.tasks.filter((t) => t.crewId === 'p-c4').every((t) => t.start >= '09:00' && t.end <= '18:00')).toBe(true);
    expect(new Set([...out.tasks.filter((t) => t.areaId === 'toilets' && t.type === 'work').map((t) => t.jobKey!), ...out.uncovered.filter((u) => u.areaId === 'toilets' && !u.jobKey.startsWith('check:')).map((u) => u.jobKey)].map((k) => k.split(':')[1])).size).toBe(4);
    expect(setupProblems({ ...s, crew: s.crew.map((c) => ({ ...c, session: 1 })) }).some((p) => /60:40/.test(p))).toBe(true);
    const { now } = nowAndNext(out.tasks, 'p-c1', '07:05');
    expect(now?.type).toBe('briefing');
  });

  it("uses the OM's own timings for a site (Fauzan, 4 Nov 2026)", () => {
    const date = '2026-11-04';
    const base = planCleaningDay({ site: school(), date, people: planPeople(school()), absentIds: [] });
    const own = school({ timings: { briefingMin: 20, reportMin: 30, breakFrom: '12:30' } });
    const p = planCleaningDay({ site: own, date, people: planPeople(own), absentIds: [] });
    const brief = p.tasks.find((t) => t.type === 'briefing')!;
    expect(toMin(brief.end) - toMin(brief.start)).toBe(20);
    const report = p.tasks.find((t) => t.type === 'report')!;
    expect(toMin(report.end) - toMin(report.start)).toBe(30);
    expect(p.tasks.filter((t) => t.type === 'break').map((t) => t.start).sort()[0]).toBe('12:30');
    expect(base.tasks.find((t) => t.type === 'briefing')!.end).not.toBe(brief.end);
  });
});
