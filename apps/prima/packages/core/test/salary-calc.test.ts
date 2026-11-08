import { describe, expect, it } from 'vitest';
import { guardSalaryCalc, standardGuardAmounts } from '../src';

// Salary calculator (Fauzan, 6 Nov 2026). Placeholder basic of RM1,700; not a real rate.
describe('guard salary calculator', () => {
  const a = standardGuardAmounts(2);
  it('full month of 12-hour shifts with 2 h rest = RM2,550 (blueprint Structure C)', () => {
    const r = guardSalaryCalc(a, { daysWorked: 26 });
    expect(r.dailyRate).toBe(65.38);
    expect(r.hourlyRate).toBe(8.72);
    expect(r.gross).toBe(2550);
    expect(r.dutyHours).toBe(260);
  });
  it('training, MC, annual leave and a holiday off are one normal day each, no overtime', () => {
    const r = guardSalaryCalc(a, { daysWorked: 22, trainingDays: 1, mcDays: 1, annualLeaveDays: 1, holidaysOff: 1 });
    expect(r.shortDays).toBe(0);
    expect(r.gross).toBe(2419.23);
    expect(r.lines.some((l) => /not paid/.test(l.label))).toBe(false);
  });
  it('unpaid short days come off at the daily rate; rest day and public holiday worked are added', () => {
    const r = guardSalaryCalc(a, { daysWorked: 24, restDaysWorked: 1, publicHolidaysWorked: 1 });
    const line = (re: RegExp) => r.lines.find((l) => re.test(l.label))!.amount;
    // The worked public holiday fills one of the two days short of the basic month.
    expect(line(/not paid/)).toBe(-65.38);
    expect(line(/^Rest day worked/)).toBe(65.38);
    expect(line(/^Overtime, rest days/)).toBe(43.59);
    expect(line(/^Public holiday worked/)).toBe(130.77);
    expect(line(/^Overtime, public holidays/)).toBe(65.38);
  });
  it('warns when the days add up to more than the month', () => {
    expect(guardSalaryCalc(a, { daysWorked: 26, annualLeaveDays: 2 }).notes[0]).toMatch(/more than the 26-day month/);
  });
});
