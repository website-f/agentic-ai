import { describe, expect, it } from 'vitest';
import {
  TimesheetError,
  attendanceChecks,
  attendanceFromTable,
  dateOrderOf,
  employeeTotals,
  parsedReportFromJson,
  timesheetColumns,
  timesheetDate,
  timesheetTime,
  weekdayOfIso,
  type ParsedAttendanceReport,
} from '../src';

// P90: Excel and CSV timesheets, the date order, and the checks before saving. Synthetic people only.
const HEAD = ['Emp Code', 'Name', 'Department', 'Date', 'Day', 'In', 'Out', 'Shift', 'Normal', 'Actual', 'Late', 'Early Out', 'OT 1.0', 'OT 1.5', 'OT 2.0', 'OT 3.0', 'Attd', 'Meal', 'Tran', 'Reason'];
const row = (code: string, name: string, date: string, day: string, tin: string, tout: string, extra: Partial<Record<'late' | 'ot15' | 'meal' | 'reason' | 'actual', string>> = {}) => [
  code, name, 'GUARDING', date, day, tin, tout, 'S01', '8.00', extra.actual ?? '8.00', extra.late ?? '0.00', '0.00', '0.00', extra.ot15 ?? '0.00', '0.00', '0.00', '0.00', extra.meal ?? '0.00', '0.00', extra.reason ?? '',
];

describe('Excel and CSV timesheets (P90)', () => {
  it('finds the columns by their headings, in English and Malay', () => {
    const en = timesheetColumns(HEAD).map((c) => c.field);
    expect(en).toEqual(['empCode', 'name', 'department', 'date', 'weekday', 'in', 'out', 'shift', 'normal', 'actual', 'late', 'early', 'ot10', 'ot15', 'ot20', 'ot30', 'attendance', 'meal', 'transport', 'reason']);
    const ms = timesheetColumns(['No Pekerja', 'Nama', 'Tarikh', 'Hari', 'Masuk', 'Keluar', 'Catatan', 'Late (min)', 'Shift allowance']).map((c) => c.field);
    expect(ms).toEqual(['empCode', 'name', 'date', 'weekday', 'in', 'out', 'reason', 'late', 'shiftAllowance']);
  });

  it('works out the date order from the whole column, never row by row', () => {
    expect(dateOrderOf(['01-02-2026', '13-02-2026'])).toEqual({ order: 'dmy', assumed: false });
    expect(dateOrderOf(['02/01/2026', '02/13/2026'])).toEqual({ order: 'mdy', assumed: false });
    expect(dateOrderOf(['01-02-2026', '03-04-2026'])).toEqual({ order: 'dmy', assumed: true });
    expect(dateOrderOf(['13-02-2026', '02/13/2026']).order).toBe('mixed');
    expect(timesheetDate('03-04-2026', 'dmy')).toBe('2026-04-03');
    expect(timesheetDate('03-04-2026', 'mdy')).toBe('2026-03-04');
    expect(timesheetDate('2026-02-28', 'mdy')).toBe('2026-02-28');
    expect(timesheetDate('30-02-2026', 'dmy')).toBeNull();
    expect(timesheetDate('5 Feb 2026', 'dmy')).toBe('2026-02-05');
    expect(timesheetDate('05-Ogos-2026', 'dmy')).toBe('2026-08-05');
    expect(timesheetDate('46054', 'dmy')).toBe('2026-02-01');
  });

  it('reads clock times as the reports and spreadsheets write them', () => {
    expect(timesheetTime('8.28')).toBe('08:28');
    expect(timesheetTime('08:28')).toBe('08:28');
    expect(timesheetTime('7:05 PM')).toBe('19:05');
    expect(timesheetTime('0.00')).toBeNull();
    expect(timesheetTime('')).toBeNull();
    expect(timesheetTime('0.375')).toBe('09:00');
    expect(timesheetTime('2026-02-01 18:30')).toBe('18:30');
    expect(timesheetTime('25.10')).toBeUndefined();
    expect(timesheetTime('abc')).toBeUndefined();
  });

  it('reads a month of a day-first export into people and days, with the right dates', () => {
    const grid = [
      ['SYNTHETIC GUARD SDN BHD'],
      ['Timesheet export'],
      HEAD,
      ...Array.from({ length: 28 }, (_, i) => {
        const d = i + 1;
        const iso = `2026-02-${String(d).padStart(2, '0')}`;
        const dd = `${String(d).padStart(2, '0')}-02-2026`;
        const wd = weekdayOfIso(iso);
        return wd === 'SUN' ? row('SYN0001', 'SYNTHETIC ALICE', dd, 'Sun', '0.00', '0.00', { reason: 'RES', actual: '0.00' }) : row('SYN0001', 'SYNTHETIC ALICE', dd, wd[0] + wd.slice(1).toLowerCase(), d === 10 ? '8.30' : '8.00', '17.00', d === 10 ? { late: '0.50' } : d === 12 ? { ot15: '2.00', meal: '5.00' } : {});
      }),
      row('SYN0002', 'SYNTHETIC BOB', '13-02-2026', 'Fri', '19.00', '7.00'),
      ['Total', '', '', '', '', '', '', '', '224.00'],
    ];
    const r = attendanceFromTable(grid, { company: 'SYNTHETIC GUARD SDN BHD' });
    expect(r.headerRow).toBe(3);
    expect(r.dateOrder).toBe('dmy');
    expect(r.dateOrderAssumed).toBe(false);
    expect(r.skippedCount).toBe(0);
    const [a, b] = r.report.employees;
    expect(a.company).toBe('SYNTHETIC GUARD SDN BHD');
    expect(a.empCode).toBe('SYN0001');
    expect(a.days).toHaveLength(28);
    expect(a.periodFrom).toBe('2026-02-01');
    expect(a.periodTo).toBe('2026-02-28');
    const d10 = a.days.find((d) => d.date === '2026-02-10')!;
    expect(d10.in).toBe('08:30');
    expect(d10.lateH).toBe(0.5);
    const d12 = a.days.find((d) => d.date === '2026-02-12')!;
    expect(d12.ot).toEqual([0, 2, 0, 0]);
    expect(d12.allow.meal).toBe(5);
    const t = employeeTotals(a);
    expect(t.rest).toBe(4);
    expect(t.present).toBe(24);
    expect(t.lateMin).toBe(30);
    expect(b.days[0].date).toBe('2026-02-13');
    const checks = attendanceChecks(r.report);
    expect(checks.counts.weekday_mismatch).toBe(0);
    expect(checks.counts.overnight).toBe(1);
    expect(checks.counts.missing_days).toBe(1);
    expect(checks.clean).toBe(true);
    expect(checks.from).toBe('2026-02-01');
    expect(checks.to).toBe('2026-02-28');
  });

  it('reads a month-first export with the right dates, and says when the order was assumed', () => {
    const us = attendanceFromTable([HEAD, row('S1', 'SYN ONE', '02/13/2026', 'Fri', '8.00', '17.00'), row('S1', 'SYN ONE', '02/03/2026', 'Tue', '8.00', '17.00')]);
    expect(us.dateOrder).toBe('mdy');
    expect(us.report.employees[0].days.map((d) => d.date)).toEqual(['2026-02-03', '2026-02-13']);
    expect(attendanceChecks(us.report).counts.weekday_mismatch).toBe(0);
    const unsure = attendanceFromTable([HEAD, row('S1', 'SYN ONE', '03-02-2026', 'Tue', '8.00', '17.00')]);
    expect(unsure.dateOrderAssumed).toBe(true);
    expect(unsure.report.employees[0].days[0].date).toBe('2026-02-03');
  });

  it('refuses a file whose date column mixes both orders, and one with no headings', () => {
    expect(() => attendanceFromTable([HEAD, row('S1', 'A', '13-02-2026', 'Fri', '8.00', '17.00'), row('S1', 'A', '02/14/2026', 'Sat', '8.00', '17.00')])).toThrow(TimesheetError);
    expect(() => attendanceFromTable([['a', 'b'], ['1', '2']])).toThrow(/heading row/);
  });

  it('leaves out rows it cannot read and says which', () => {
    const r = attendanceFromTable([HEAD, row('S1', 'A', '31-02-2026', 'Tue', '8.00', '17.00'), row('S1', 'A', '01-02-2026', 'Sun', '8.00', '17.00'), row('S1', 'A', '02-02-2026', 'Mon', '8.00', 'late')]);
    expect(r.report.employees[0].days).toHaveLength(1);
    expect(r.skippedCount).toBe(2);
    expect(r.skipped.map((s) => s.row)).toEqual([2, 4]);
  });

  it('flags a weekday that is not the date, the same day twice and a date outside the period', () => {
    const r = attendanceFromTable([HEAD, row('S1', 'A', '01-02-2026', 'Mon', '8.00', '17.00'), row('S1', 'A', '01-02-2026', 'Sun', '8.00', '17.00')]);
    const report: ParsedAttendanceReport = { ...r.report, employees: r.report.employees.map((e) => ({ ...e, periodFrom: '2026-02-02', periodTo: '2026-02-28' })) };
    const c = attendanceChecks(report);
    expect(c.counts.weekday_mismatch).toBe(1);
    expect(c.counts.duplicate_day).toBe(1);
    expect(c.counts.outside_period).toBe(2);
    expect(c.clean).toBe(false);
    expect(c.examples.find((x) => x.kind === 'weekday_mismatch')?.detail).toMatch(/SUN/);
  });

  it('the server takes the rows read on the device only in the exact shape, and refuses anything else', () => {
    const r = attendanceFromTable([HEAD, row('S1', 'SYN ONE', '13-02-2026', 'Fri', '8.00', '17.00')], { company: 'SYNTHETIC CO' });
    const back = parsedReportFromJson(JSON.parse(JSON.stringify(r.report)));
    expect(back.employees[0].days[0]).toMatchObject({ date: '2026-02-13', in: '08:00', out: '17:00' });
    const bad = (f: (x: any) => void) => {
      const x = JSON.parse(JSON.stringify(r.report));
      f(x);
      return () => parsedReportFromJson(x);
    };
    expect(bad((x) => (x.employees[0].days[0].date = '2026-02-30'))).toThrow(TimesheetError);
    expect(bad((x) => (x.employees[0].days[0].date = '13-02-2026'))).toThrow(TimesheetError);
    expect(bad((x) => (x.employees[0].days[0].in = '25:00'))).toThrow(TimesheetError);
    expect(bad((x) => (x.employees[0].days[0].ot = [1, 2]))).toThrow(TimesheetError);
    expect(bad((x) => (x.employees[0].days[0].normalH = 'eight'))).toThrow(TimesheetError);
    expect(bad((x) => (x.employees[0].name = 'x'.repeat(500)))).toThrow(TimesheetError);
    expect(() => parsedReportFromJson({})).toThrow(TimesheetError);
    expect(() => parsedReportFromJson(null)).toThrow(TimesheetError);
  });
});
