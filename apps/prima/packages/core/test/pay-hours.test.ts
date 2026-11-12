import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  buildGuardPayLine,
  generateDataset,
  myt,
  standardGuardAmounts,
  type Attendance,
  type LeaveRequest,
  type PayFormula,
  type Person,
  type Shift,
} from '../src';

// P100 B1b (Fauzan, 11 Nov 2026: "Salary and total working hours must match"). Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const formula = (over: Partial<PayFormula['amounts']> = {}): PayFormula => ({
  id: 'pf-t',
  code: 'T-R2',
  version: 1,
  kind: 'guard_shift',
  name: 'Test 12-hour',
  effectiveFrom: '2026-10',
  amounts: { ...standardGuardAmounts(2), ...over },
  status: 'live',
  reason: 'test',
  preparedBy: 't',
  preparedById: 't',
  preparedAt: NOW,
  decidedBy: 't',
  decidedById: 't',
  decidedAt: NOW,
  decisionNote: null,
  lawFlags: [],
});
const person = (over: Partial<Person> = {}): Person =>
  ({ id: 'p1', companyId: 'c1', branchId: 'b1', staffNo: 'T001', name: 'Test Guard', nationality: 'MY', idMasked: '****', dob: '1990-01-01', phone: '', role: 'guard', status: 'active', hiredOn: '2025-01-01', faceEnrolledOn: null, lindungOptOut: false, bank: { bank: 'Test Bank', accountMasked: '****0001' }, ...over }) as Person;
/** One 07:00-19:00 shift on a day in October 2026, clocked in and out at the given times. */
const shift = (day: number, inAt = '07:00', outAt = '19:00', id = '') => {
  const date = `2026-10-${String(day).padStart(2, '0')}`;
  const s = { id: `sh-${date}${id}`, companyId: 'c1', siteId: 's1', postId: 'x', personId: 'p1', date, start: myt(date, '07:00'), end: myt(date, '19:00'), status: 'published' } as Shift;
  const a = { id: `at-${s.id}`, companyId: 'c1', siteId: 's1', shiftId: s.id, personId: 'p1', deviceId: 'd', clockIn: myt(date, inAt), clockOut: myt(date, outAt), lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: true } as Attendance;
  return { a, shift: s };
};
const days = (from: number, n: number) => Array.from({ length: n }, (_, k) => shift(from + k));
const line = (attendance: ReturnType<typeof shift>[], over: Partial<Parameters<typeof buildGuardPayLine>[0]> = {}, f = formula()) =>
  buildGuardPayLine({ person: person(), period: '2026-10', attendance, leaves: [], holidays: [], formulaAt: () => ({ formula: f, scope: 'Whole group' }), siteName: (id) => id, utility: [], grace: { late: 10, early: 10 }, ...over });

describe('P100 B1b: hours recorded beside hours paid', () => {
  it('a full month of 12-hour shifts records and pays the same hours: 26 x 10 h (2 h relieved rest)', () => {
    const l = line(days(1, 26));
    expect(l.hours!.recorded.worked).toBe(260);
    expect(l.hours!.paid.normal).toBe(195);
    expect(l.hours!.paid.ot).toBe(65);
    expect(l.hours!.recorded.total).toBe(l.hours!.paid.total);
    expect(l.hours!.match).toBe(true);
    expect(l.holds).toEqual([]);
    expect(l.gross).toBe(2550);
  });

  it('within the grace counts the full shift; late past it pays only the overtime worked, so the hours still match', () => {
    const graceOk = line([...days(1, 25), shift(26, '07:09', '18:52')]);
    expect(graceOk.otHours).toBe(65);
    expect(graceOk.hours!.match).toBe(true);
    const late = line([...days(1, 25), shift(26, '07:30')]);
    expect(late.otHours).toBe(64.5);
    expect(late.hours!.recorded.worked).toBe(259.5);
    expect(late.hours!.paid.total).toBe(259.5);
    expect(late.hours!.match).toBe(true);
    expect(late.gross).toBeLessThan(2550);
  });

  it('holds a day worked shorter than the normal day it is paid for, and a second shift on the same day', () => {
    // Clocked 07:00-12:00: 5 h (the relieved rest comes only out of time past the normal day), but the basic pays a 7.5 h day.
    const short = line([...days(1, 25), shift(26, '07:00', '12:00')]);
    expect(short.hours!.match).toBe(false);
    expect(short.hours!.days).toEqual([{ date: '2026-10-26', recorded: 5, paid: 7.5, why: 'short' }]);
    expect(short.holds!.join(' ')).toMatch(/Hours do not match: .*Correct the attendance or leave record/);
    // Two shifts on one day: the second is not paid, so it is refused rather than lost.
    const twice = line([...days(1, 26), shift(26, '07:00', '19:00', '-b')]);
    expect(twice.hours!.match).toBe(false);
    expect(twice.hours!.days[0]).toMatchObject({ date: '2026-10-26', why: 'over' });
  });

  it('counts approved paid leave on both sides at the normal hours, and holds basic paid for days with nothing recorded', () => {
    const leave = { id: 'lv1', companyId: 'c1', personId: 'p1', kind: 'ANNUAL', from: '2026-10-27', to: '2026-10-28', days: 2, status: 'approved' } as LeaveRequest;
    const l = line(days(1, 24), { leaves: [leave] });
    expect(l.paidLeaveDays).toBe(2);
    expect(l.hours!.recorded.leave).toBe(15);
    expect(l.hours!.paid.leave).toBe(15);
    expect(l.hours!.match).toBe(true);
    // ACT's "do not deduct short days" pays 6 days of basic nobody recorded: refused, never paid silently.
    const off = line(days(1, 20), {}, formula({ deductShortDays: false }));
    expect(off.hours!.paid.notWorked).toBe(45);
    expect(off.hours!.match).toBe(false);
  });
});

describe('P100 B1b: a run with a line whose hours do not match cannot be changed, submitted or approved', () => {
  it('holds the run and refuses the line edit; the wrong role is refused too', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW, daysBack: 40 });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const prep = await svc.user('u-ae-arsh');
    // One guard leaves after 3 hours on a locked October shift.
    const guardRun = await svc.prepareGuardPay(prep, 'co-arsh', '2026-10', []);
    const target = guardRun.lines.find((l) => l.daysWorked > 3 && l.hours?.match)!;
    const rec = ds.attendance.find((a) => a.personId === target.personId && a.locked && a.clockIn && a.clockOut && a.clockIn.startsWith('2026-10'))!;
    rec.clockOut = new Date(Date.parse(rec.clockIn!) + 3 * 3_600_000).toISOString();
    const run = await svc.prepareGuardPay(prep, 'co-arsh', '2026-10', []);
    const held = run.lines.find((l) => l.personId === target.personId)!;
    expect(held.hours!.match).toBe(false);
    expect((await svc.guardPayRun(prep, run.id)).totals.hoursMismatch).toBeGreaterThan(0);
    await expect(svc.setGuardPayLine(prep, run.id, held.personId, { pcb: 0 })).rejects.toThrow(/hours recorded and paid do not match/i);
    await expect(svc.setGuardPayLine(await svc.user('u-pwvsb-hr'), run.id, held.personId, { pcb: 0 })).rejects.toBeInstanceOf(AccessDenied);
    const firstHeld = run.lines.find((l) => l.holds?.length)!;
    await expect(svc.guardPayStep(prep, run.id, 'submit')).rejects.toThrow(firstHeld.staffNo);
    expect(held.holds!.join(' ')).toMatch(/Hours do not match/);
    // The fix is the attendance record (a supervisor's correction), then a recalculation.
    rec.clockOut = new Date(Date.parse(rec.clockIn!) + 12 * 3_600_000).toISOString();
    const fixed = await svc.prepareGuardPay(prep, 'co-arsh', '2026-10', []);
    expect(fixed.lines.find((l) => l.personId === target.personId)!.hours!.match).toBe(true);
  });
});
