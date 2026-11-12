import { describe, expect, it } from 'vitest';
import { RULES, guardPayOverDeductionCap, standardGuardAmounts, type GuardPayLine } from '../src';

// P100 E12 / E13 (Fauzan, 11 Nov 2026): confirmed as built; the rule register says so.
describe('P100 E12 / E13: confirmed in the rule register, code unchanged', () => {
  it('E12: EPF, SOCSO and PCB do not count toward the 50% deduction cap', () => {
    expect(RULES.guardPayroll.value.deductionCapExcludesStatutory).toBe(true);
    expect(RULES.guardPayroll.source).toMatch(/Approved by Fauzan, 11 Nov 2026 \(E12\)/);
    // Large statutory shares and PCB alone never put a line over the cap; the employer's own recoveries do.
    const line = { gross: 2000, utility: 0, otherDeductions: 0, advance: 0, loan: 0, epfEe: 900, socsoEe: 100, pcb: 300 } as unknown as GuardPayLine;
    expect(guardPayOverDeductionCap(line)).toBe(false);
    expect(guardPayOverDeductionCap({ ...line, otherDeductions: 1001 })).toBe(true);
  });
  it('E13: public holiday pay is 2 extra days on top of the normal day', () => {
    expect(standardGuardAmounts(2).publicHolidayDays).toBe(2);
    expect(RULES.payFormulas.source).toMatch(/Approved by Fauzan, 11 Nov 2026 \(E13\)/);
  });
});
