import { describe, expect, it } from 'vitest';
import { RULES } from '../src/rules';
import { holidayYearCheck } from '../src/hr-leave';

describe('combined office-HR and guard-pay holiday policies', () => {
  it('keeps separate rule identities and both contract shapes', () => {
    expect(RULES.publicHolidays.id).toBe('EA-PUBLIC-HOLIDAY');
    expect(RULES.publicHolidays.value.minPerYear).toBe(11);
    expect(RULES.publicHolidays.value.compulsory).toHaveLength(5);
    expect(RULES.guardPublicHolidays.id).toBe('PAY-PUBLIC-HOLIDAYS');
    expect(RULES.guardPublicHolidays.value).toMatchObject({ perYear: 11, dueDay: 10, remindFrom: 1 });
  });
  it('office-HR can still evaluate an incomplete gazetted list after guard pay is integrated', () => {
    const check = holidayYearCheck([], null, '2027');
    expect(check).toMatchObject({ min: 11, count: 0, ok: false });
    expect(check.missing).toHaveLength(5);
  });
});
