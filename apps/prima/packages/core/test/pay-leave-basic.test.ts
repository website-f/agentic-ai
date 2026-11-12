import { describe, expect, it } from 'vitest';
import { buildGuardPayLine, guardSalaryCalc, myt, standardGuardAmounts, type Attendance, type LeaveRequest, type PayFormula, type Person, type Shift } from '../src';

// P100 C1b (Fauzan, 11 Nov 2026: "Guard leave paid basic only"). Synthetic data only.
const NOW = myt('2026-11-05', '10:00');
const f: PayFormula = { id: 'pf', code: 'T-ALW', version: 1, kind: 'guard_shift', name: 'Test with allowance', effectiveFrom: '2026-10', amounts: { ...standardGuardAmounts(2), fixedAllowances: [{ label: 'Site allowance', amount: 260 }] }, status: 'live', reason: 't', preparedBy: 't', preparedById: 't', preparedAt: NOW, decidedBy: 't', decidedById: 't', decidedAt: NOW, decisionNote: null, lawFlags: [] };
const person = { id: 'g1', companyId: 'c1', branchId: 'b1', staffNo: 'G1', name: 'Test Guard', nationality: 'MY', idMasked: '*', dob: '1990-01-01', phone: '', role: 'guard', status: 'active', hiredOn: '2025-01-01', faceEnrolledOn: null, lindungOptOut: false, bank: { bank: 'T', accountMasked: '*1' } } as Person;
const days = (n: number) =>
  Array.from({ length: n }, (_, k) => {
    const date = `2026-10-${String(1 + k).padStart(2, '0')}`;
    const s = { id: `sh-${date}`, companyId: 'c1', siteId: 's1', postId: 'x', personId: 'g1', date, start: myt(date, '07:00'), end: myt(date, '19:00'), status: 'published' } as Shift;
    return { a: { id: `a-${date}`, companyId: 'c1', siteId: 's1', shiftId: s.id, personId: 'g1', deviceId: 'd', clockIn: s.start, clockOut: s.end, lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: true } as Attendance, shift: s };
  });
const leave = { id: 'lv1', companyId: 'c1', personId: 'g1', kind: 'ANNUAL', from: '2026-10-27', to: '2026-10-28', days: 2, status: 'approved' } as LeaveRequest;
const line = (leaves: LeaveRequest[], n: number) => buildGuardPayLine({ person, period: '2026-10', attendance: days(n), leaves, holidays: [], formulaAt: () => ({ formula: f, scope: 'Group' }), siteName: (x) => x, utility: [] });

describe('P100 C1b: a guard on paid leave is paid basic only', () => {
  it('2 days of paid leave are paid at basic; the allowance is not paid for them, and no overtime', () => {
    const full = line([], 26);
    const withLeave = line([leave], 24);
    expect(withLeave.paidLeaveDays).toBe(2);
    expect(withLeave.unpaidDays).toBe(0);
    const off = withLeave.items.find((x) => x.label === 'Site allowance: not paid on leave days')!;
    expect(off.qty).toBe(2);
    expect(off.amount).toBe(-20); // 260 / 26 x 2
    // The basic is the whole month; the overtime is only for the 24 days worked.
    expect(withLeave.items.find((x) => x.kind === 'basic')?.amount).toBe(1700);
    expect(withLeave.otHours).toBe(60);
    expect(full.gross - withLeave.gross).toBeCloseTo(20 + 5 * (1700 / 26 / 7.5) * 1.5, 2);
    expect(withLeave.flags.join(' ')).toMatch(/2 paid leave days at basic pay only/);
  });

  it('the salary calculator shows the same: no allowance for leave days', () => {
    const c = guardSalaryCalc(f.amounts, { daysWorked: 24, annualLeaveDays: 2 });
    expect(c.lines.find((l) => l.label === 'Site allowance: not paid on leave days')?.amount).toBe(-20);
  });
});
