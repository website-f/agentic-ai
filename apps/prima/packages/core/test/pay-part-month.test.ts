import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  buildGuardPayLine,
  buildStaffPayLine,
  generateDataset,
  myt,
  staffPartMonthPay,
  staffWorkingDays,
  standardGuardAmounts,
  type Attendance,
  type PayFormula,
  type Person,
  type Shift,
} from '../src';

// P100 C1 (Fauzan, 11 Nov 2026): part-month pay. Office staff: monthly / 26 (the pay law divisor) x working days employed;
// guards: the hours actually worked. Synthetic data only.
const NOW = myt('2026-11-05', '10:00');
const staff = (over: Partial<Person> = {}): Person =>
  ({ id: 'ps1', companyId: 'c1', branchId: 'b1', staffNo: 'S001', name: 'Test Staff', nationality: 'MY', idMasked: '****', dob: '1990-01-01', phone: '', role: 'office', status: 'active', hiredOn: '2026-10-15', faceEnrolledOn: null, lindungOptOut: false, basicPay: 2600, allowances: [{ label: 'Travel', amount: 260 }], bank: { bank: 'Test Bank', accountMasked: '****0001' }, epfNo: 'x', socsoNo: 'x', taxNo: 'x', ...over }) as Person;

describe('P100 C1: office staff part month = monthly / 26 x working days employed', () => {
  it('counts Monday to Friday: 15 to 31 October 2026 is 12 working days', () => {
    expect(staffWorkingDays('2026-10-15', '2026-10-31')).toBe(12);
    expect(staffWorkingDays('2026-10-03', '2026-10-04')).toBe(0);
  });

  it('a staff member joining on the 15th gets the daily rate times the working days left, shown on the line', () => {
    const l = buildStaffPayLine({ person: staff(), period: '2026-10', unpaidDivisor: 26, leaves: [], claims: [] });
    expect(l.partAuto).toMatchObject({ workingDays: 12, divisor: 26, dailyBasic: 100, basic: 1200, dailyAllowances: 10, allowances: 120 });
    expect(l.basic).toBe(1200);
    expect(l.allowanceLines.reduce((n, a) => n + a.amount, 0)).toBe(120);
    expect(l.flags.join(' ')).toMatch(/12 working days x RM100\.00 a day \(basic \/ 26\) = RM1200\.00/);
    // Never more than the full month.
    expect(staffPartMonthPay(2600, 0, '2026-10-01', '2026-10-30', 20).basic).toBe(2600);
  });

  it('HR may still correct the line, with a reason; the working stays beside it', () => {
    const l = buildStaffPayLine({ person: staff(), period: '2026-10', unpaidDivisor: 26, leaves: [], claims: [], kept: { extra: [], pcb: null, partPay: { basic: 1250, allowances: 125, note: 'Started at noon on the 15th (test)', by: 'HR (test)', at: NOW } } });
    expect(l.basic).toBe(1250);
    expect(l.partAuto?.basic).toBe(1200);
    expect(l.partPay?.note).toMatch(/noon/);
  });

  it('through the service: HR prepares, a correction needs a reason, and a guard is refused', async () => {
    const ds = generateDataset({ today: '2026-11-05', now: NOW, daysBack: 40 });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const hr = await svc.user('u-pwvsb-hr');
    const p = ds.people.find((x) => x.role === 'office' && x.status === 'active' && (x.basicPay ?? 0) > 0 && x.companyId === 'co-sasa')!;
    p.hiredOn = '2026-10-15';
    ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.companyId !== p.companyId);
    const run = await svc.prepareStaffPay(hr, p.companyId, '2026-10');
    const line = run.lines.find((l) => l.personId === p.id)!;
    expect(line.partAuto?.workingDays).toBe(12);
    expect((await svc.staffPayRun(hr, run.id)).blockers.join(' ')).not.toMatch(/part-month/);
    await expect(svc.setStaffPayLine(hr, run.id, p.id, { partPay: { basic: 100, allowances: 0, note: 'no' } })).rejects.toThrow(/worked out/);
    const fixed = await svc.setStaffPayLine(hr, run.id, p.id, { partPay: { basic: 100, allowances: 0, note: 'Unpaid start day agreed (test)' } });
    expect(fixed.partPay?.basic).toBe(100);
    await expect(svc.setStaffPayLine(await svc.user('u-guard-sasa-1'), run.id, p.id, { partPay: null })).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('P100 C1: a guard who joins mid-month is paid only for the hours worked', () => {
  it('no share of the month: the days before joining are not paid, and the hours match', () => {
    const f: PayFormula = { id: 'pf', code: 'T', version: 1, kind: 'guard_shift', name: 'T', effectiveFrom: '2026-10', amounts: standardGuardAmounts(2), status: 'live', reason: 't', preparedBy: 't', preparedById: 't', preparedAt: NOW, decidedBy: 't', decidedById: 't', decidedAt: NOW, decisionNote: null, lawFlags: [] };
    const att = Array.from({ length: 13 }, (_, k) => {
      const date = `2026-10-${String(15 + k).padStart(2, '0')}`;
      const s = { id: `sh-${date}`, companyId: 'c1', siteId: 's1', postId: 'x', personId: 'g1', date, start: myt(date, '07:00'), end: myt(date, '19:00'), status: 'published' } as Shift;
      return { a: { id: `a-${date}`, companyId: 'c1', siteId: 's1', shiftId: s.id, personId: 'g1', deviceId: 'd', clockIn: s.start, clockOut: s.end, lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: true } as Attendance, shift: s };
    });
    const l = buildGuardPayLine({ person: { ...staff({ id: 'g1', role: 'guard', staffNo: 'G1' }), basicPay: undefined } as Person, period: '2026-10', attendance: att, leaves: [], holidays: [], formulaAt: () => ({ formula: f, scope: 'Group' }), siteName: (x) => x, utility: [] });
    expect(l.daysWorked).toBe(13);
    expect(l.unpaidDays).toBe(13);
    expect(l.hours!.match).toBe(true);
    expect(l.hours!.paid.total).toBe(130);
    expect(l.flags.join(' ')).toMatch(/Joined 2026-10-15: paid for the hours worked/);
  });
});
