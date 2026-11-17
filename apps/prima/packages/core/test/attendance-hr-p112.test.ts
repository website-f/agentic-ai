// P112 (Fitri, 17 Nov 2026): HR gets the Attendance day sheet (read-only), the monthly reports add up over a period of
// months, and each person's details over a period of days, with the KPI figures worked out here. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  addTotals,
  attendancePeriod,
  attendanceRates,
  dayStatus,
  employeeKey,
  generateDataset,
  myt,
  periodKpi,
  type ParsedAttendanceReport,
  type ReportDay,
  type ReportEmployee,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const user = (id: string) => ds.users.find((u) => u.id === id)!;
  return { ds, svc, user, ar: svc.attendanceReports };
}

const zero = { flat: 0, attendance: 0, shift: 0, meal: 0, transport: 0, other1: 0, other2: 0, health: 0 };
function day(date: string, o: Partial<ReportDay> = {}): ReportDay {
  const off = !!o.reason;
  return { date, clocks: [], in: off ? null : '08:00', out: off ? null : '17:00', shift: 'S1', normalH: off ? 0 : 8, lateH: 0, earlyH: 0, actualH: off ? 0 : 8, ot: [0, 0, 0, 0], allow: { ...zero }, reason: null, page: 1, ...o };
}
const month = (m: string, len: number, f: (d: number) => Partial<ReportDay> = () => ({})) =>
  Array.from({ length: len }, (_, i) => day(`${m}-${String(i + 1).padStart(2, '0')}`, f(i + 1)));
function emp(company: string, name: string, code: string | null, days: ReportDay[], m: string): ReportEmployee {
  const last = days[days.length - 1].date;
  return { company, empCode: code, name, designation: 'GUARD', department: null, periodFrom: `${m}-01`, periodTo: last, pages: [1], days, totals: null, monthly: null };
}
const report = (employees: ReportEmployee[]): ParsedAttendanceReport => ({ title: 'Individual Attendance Report', pages: 1, employees, unreadable: [], warnings: [] });

describe('rates, periods and day status (pure)', () => {
  it('rates present out of present plus absent; leave never counts against; punctuality is present days not late', () => {
    expect(attendanceRates({ present: 18, absent: 2, leave: 3, lateCount: 3 })).toEqual({ workingDays: 23, rate: 90, punctuality: 83.3 });
    expect(attendanceRates({ present: 0, absent: 0, leave: 5, lateCount: 0 })).toEqual({ workingDays: 5, rate: null, punctuality: null });
  });

  it('turns the period chips into first and last days, across a year end', () => {
    expect(attendancePeriod('this_month', '2026-11-17')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(attendancePeriod('last_month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(attendancePeriod('this_year', '2026-11-17')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(attendancePeriod('last_12', '2026-11-17')).toEqual({ from: '2025-12-01', to: '2026-11-30' });
    expect(attendancePeriod('last_month', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(attendancePeriod('custom', '2026-11-17', { from: '2026-02-03', to: '2026-04-05' })).toEqual({ from: '2026-02-03', to: '2026-04-05' });
    expect(() => attendancePeriod('custom', '2026-11-17')).toThrow(/first and the last day/);
  });

  it('reads each saved day: late before early, MC apart from other leave, and adds a period up', () => {
    const base = { lateMin: 0, earlyMin: 0, reason: null, ot: [0, 0, 0, 0] as [number, number, number, number], normalH: 8, actualH: 8 };
    const rows = [
      { ...base, kind: 'present' as const },
      { ...base, kind: 'present' as const, lateMin: 20, earlyMin: 10 },
      { ...base, kind: 'present' as const, earlyMin: 30, ot: [0, 1.5, 0, 0] as [number, number, number, number] },
      { ...base, kind: 'absent' as const, normalH: 0, actualH: 0, reason: 'ABS' },
      { ...base, kind: 'leave' as const, normalH: 0, actualH: 0, reason: 'MC' },
      { ...base, kind: 'leave' as const, normalH: 0, actualH: 0, reason: 'AL' },
      { ...base, kind: 'rest' as const, normalH: 0, actualH: 0, reason: 'RES' },
      { ...base, kind: 'holiday' as const, normalH: 0, actualH: 0, reason: 'PH' },
    ];
    expect(rows.map(dayStatus)).toEqual(['present', 'late', 'early', 'absent', 'mc', 'leave', 'rest', 'holiday']);
    expect(periodKpi(rows)).toMatchObject({
      days: 8,
      workingDays: 6,
      present: 3,
      absent: 1,
      lateCount: 1,
      lateMin: 20,
      earlyCount: 2,
      earlyMin: 40,
      leave: 1,
      mc: 1,
      rest: 1,
      holiday: 1,
      otHours: 1.5,
      actualH: 24,
      rate: 75,
      punctuality: 66.7,
    });
    expect(periodKpi([])).toMatchObject({ days: 0, rate: null, punctuality: null });
  });

  it('adds two months of totals', () => {
    const t = { days: 30, present: 20, absent: 1, rest: 8, leave: 1, holiday: 0, lateCount: 2, lateMin: 30, earlyCount: 0, earlyMin: 0, ot: [0, 1, 0, 0] as [number, number, number, number], dayAllowances: 10, monthlyAllowances: null, normalH: 160, actualH: 160 };
    expect(addTotals(t, { ...t, monthlyAllowances: 50 })).toMatchObject({ days: 60, present: 40, lateMin: 60, ot: [0, 2, 0, 0], dayAllowances: 20, monthlyAllowances: 50 });
    expect(addTotals(t, t).monthlyAllowances).toBeNull();
  });
});

describe('the reports over a period', () => {
  async function setup() {
    const f = fresh();
    const co = f.ds.companies.find((c) => c.id === 'co-sasa')!;
    const staff = f.ds.people.filter((p) => p.companyId === co.id);
    const p1 = staff.find((p) => p.staffNo && staff.filter((q) => q.staffNo === p.staffNo).length === 1)!;
    const hr = f.user('u-pwvsb-hr');
    // September: late on the 9th (30 min), absent on the 10th, MC on the 15th, rest on Sundays-ish (6, 13).
    const sept = month('2026-09', 30, (d) => (d === 6 || d === 13 ? { reason: 'RES' } : d === 9 ? { lateH: 0.5 } : d === 10 ? { reason: 'ABS' } : d === 15 ? { reason: 'MC' } : {}));
    // October: late on the 2nd and the 20th (15 min each), annual leave on the 5th, 2 h OT at 1.5 on the 7th.
    const oct = month('2026-10', 31, (d) => (d === 2 || d === 20 ? { lateH: 0.25 } : d === 5 ? { reason: 'AL' } : d === 7 ? { ot: [0, 2, 0, 0] } : {}));
    await f.ar.save(hr, report([emp(co.name, 'Printed Name', p1.staffNo, sept, '2026-09'), emp(co.name, 'Synthetic Stranger', 'NOPE-9', month('2026-09', 30), '2026-09')]), { name: 'sep.pdf', size: 1, sha256: 'c'.repeat(64) }, {}, false);
    await f.ar.save(hr, report([emp(co.name, 'Printed Name', p1.staffNo, oct, '2026-10')]), { name: 'oct.pdf', size: 1, sha256: 'd'.repeat(64) }, {}, false);
    return { ...f, co, p1, hr };
  }

  it('one month as before; a period of months adds each person up, with rates', async () => {
    const { ar, hr, p1 } = await setup();
    const one = await ar.overview(hr, {});
    expect(one).toMatchObject({ month: '2026-10', period: null });
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0]).toMatchObject({ personId: p1.id, staffNo: p1.staffNo, months: 1 });

    const both = await ar.overview(hr, { from: '2026-09', to: '2026-10' });
    expect(both.period).toEqual({ from: '2026-09', to: '2026-10' });
    expect(both.filters).toMatchObject({ from: '2026-09', to: '2026-10' });
    const mine = both.rows.find((r) => r.personId === p1.id)!;
    expect(mine).toMatchObject({ months: 2, strip: '', importId: one.rows[0].importId });
    expect(mine.totals).toMatchObject({ present: 26 + 30, absent: 1, leave: 2, lateCount: 3, lateMin: 60, ot: [0, 2, 0, 0] });
    expect(mine.rate).toBe(Math.round((56 / 57) * 1000) / 10);
    expect(both.kpi).toMatchObject({ employees: 2, absent: 1 });
    expect(both.kpi.rate).not.toBeNull();
    expect(both.imports).toHaveLength(2);
    // A period with no report: nothing, and no error.
    expect((await ar.overview(hr, { from: '2026-11', to: '2026-11' })).rows).toHaveLength(0);
    await expect(ar.overview(hr, { from: '2026-10', to: '2026-09' })).rejects.toMatchObject({ status: 400, code: 'bad_period' });
    await expect(ar.overview(hr, { from: '2026-13', to: '2026-13' })).rejects.toMatchObject({ status: 400 });
  });

  it("one person's details over days: tiles, month by month and each day, across two reports", async () => {
    const { ar, hr, p1 } = await setup();
    const row = (await ar.overview(hr, {})).rows[0];
    const v = await ar.personPeriod(hr, row.importId, row.key, '2026-09-08', '2026-10-07');
    expect(v.person).toMatchObject({ id: p1.id, staffNo: p1.staffNo, companyId: 'co-sasa', role: p1.role });
    expect(v.reportMonths).toEqual(['2026-09', '2026-10']);
    expect(v.days).toHaveLength(23 + 7);
    expect(v.months.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(v.kpi).toMatchObject({ absent: 1, mc: 1, leave: 1, lateCount: 2, lateMin: 45, rest: 1, otHours: 2 });
    expect(v.kpi.present).toBe(30 - 1 - 1 - 1 - 1);
    expect(v.days.find((d) => d.date === '2026-09-15')).toMatchObject({ status: 'mc', reasonLabel: 'Medical leave' });
    expect(v.days.find((d) => d.date === '2026-09-09')).toMatchObject({ status: 'late', lateMin: 30 });
    // The same person opened from September's import gives the same figures.
    const sep = (await ar.overview(hr, { from: '2026-09', to: '2026-09' })).rows.find((r) => r.personId === p1.id)!;
    expect((await ar.personPeriod(hr, sep.importId, sep.key, '2026-09-08', '2026-10-07')).kpi).toEqual(v.kpi);
    // An unmatched person: no staff record, still their days.
    const stranger = (await ar.overview(hr, { from: '2026-09', to: '2026-09' })).rows.find((r) => !r.personId)!;
    const s = await ar.personPeriod(hr, stranger.importId, stranger.key, '2026-09-01', '2026-09-30');
    expect(s.person).toBeNull();
    expect(s.kpi.present).toBe(30);
    // A period with nothing: empty, not an error.
    expect((await ar.personPeriod(hr, row.importId, row.key, '2026-01-01', '2026-01-31')).kpi.days).toBe(0);
  });

  it('refuses a bad or too long period, and anyone who does not see that company: Finance, a guard, a supervisor, another manager, HR without a grant', async () => {
    const { ar, hr, user, ds, co } = await setup();
    const row = (await ar.overview(hr, {})).rows[0];
    await expect(ar.personPeriod(hr, row.importId, row.key, '2026-10-07', '2026-09-08')).rejects.toMatchObject({ status: 400 });
    await expect(ar.personPeriod(hr, row.importId, row.key, '2026-9-1', '2026-10-01')).rejects.toMatchObject({ status: 400 });
    await expect(ar.personPeriod(hr, row.importId, row.key, '2024-01-01', '2026-10-01')).rejects.toMatchObject({ status: 400, message: /two years/ });
    await expect(ar.personPeriod(hr, row.importId, 'code:NOBODY', '2026-09-01', '2026-09-30')).rejects.toMatchObject({ status: 404 });
    const guard = ds.users.find((u) => u.role === 'guard' && u.companyIds.includes(co.id))!;
    for (const u of [user('u-fin-t1-lead'), guard, user('u-sv-sasa'), user('u-cm-arsh')]) {
      await expect(ar.personPeriod(u, row.importId, row.key, '2026-09-01', '2026-09-30')).rejects.toMatchObject({ status: 404 });
      expect((await ar.overview(u, { from: '2026-09', to: '2026-10' })).rows).toHaveLength(0);
    }
    // The company manager of that company sees it; HR loses it with the grant.
    expect((await ar.personPeriod(user('u-cm-sasa'), row.importId, row.key, '2026-09-01', '2026-09-30')).kpi.days).toBe(30);
    ds.grants = ds.grants.filter((g) => !(g.userId === hr.id && g.companyId === co.id));
    const fresher = new PrimaService(new MemoryStore(ds), () => NOW).attendanceReports;
    await expect(fresher.personPeriod(hr, row.importId, row.key, '2026-09-01', '2026-09-30')).rejects.toMatchObject({ status: 404 });
    expect(employeeKey({ empCode: null, name: 'x' })).toBe('name:X');
  });
});

describe('Fitri, 17 Nov 2026: HR gets the Attendance day sheet', () => {
  it('HR opens the day sheet and its alerts for a company it sees, read-only', async () => {
    const { svc, user } = fresh();
    const hr = user('u-pwvsb-hr');
    const sheet = await svc.attendance(hr, 'co-sasa', TODAY);
    expect(sheet.rows.length).toBeGreaterThan(0);
    expect(sheet).toMatchObject({ canLock: false, canFollowUp: false, canDiscipline: false, canReplace: false });
    const alerts = await svc.attendanceAlerts(hr, 'co-sasa');
    expect(alerts).toMatchObject({ canFollowUp: false, canDiscipline: false, canReplace: false, stepIn: null });
    // The HR Director (Chief of Staff) already could, and still can.
    await expect(svc.attendance(user('u-cos'), 'co-sasa', TODAY)).resolves.toBeTruthy();
    // Read-only: HR cannot lock a day or act on an alert.
    await expect(svc.lockAttendance(hr, 'co-sasa', '2026-10-25')).rejects.toBeInstanceOf(AccessDenied);
    const issue = alerts.open[0] ?? alerts.absences[0];
    if (issue)
      await expect(
        svc.followUpAttendance(hr, { shiftId: issue.shiftId, attendanceId: issue.attendanceId, issue: issue.issue, kind: 'CALLED', note: 'HR should not act here (synthetic)' }),
      ).rejects.toThrow();
  });

  it('Finance, IT, a guard and HR without a grant for the company are refused; nothing else is widened', async () => {
    const { svc, user, ds } = fresh();
    const guard = ds.users.find((u) => u.role === 'guard')!;
    for (const u of [user('u-fin-t1-lead'), user('u-finance-am'), user('u-it-mgr'), guard]) {
      await expect(svc.attendance(u, 'co-sasa', TODAY)).rejects.toBeInstanceOf(AccessDenied);
      await expect(svc.attendanceAlerts(u, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    }
    const hr = user('u-pwvsb-hr');
    ds.grants = ds.grants.filter((g) => !(g.userId === hr.id && g.companyId === 'co-arsh'));
    const svc2 = new PrimaService(new MemoryStore(ds), () => NOW);
    await expect(svc2.attendance(hr, 'co-arsh', TODAY)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc2.attendanceAlerts(hr, 'co-arsh')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc2.attendance(hr, 'co-sasa', TODAY)).resolves.toBeTruthy();
    // Sites (the operations screen) stay with operations.
    await expect(svc.sites(hr, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
  });
});
