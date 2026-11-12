import { afterEach, describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  RULES,
  buildGuardPayLine,
  leaveDaysIn,
  generateDataset,
  myt,
  standardGuardAmounts,
  type Attendance,
  type PayFormula,
  type Person,
  type Shift,
} from '../src';

// Prima's own guard pay run (Fauzan, 5 Nov 2026). Synthetic data only: made-up people, placeholder formula amounts.
const TODAY = '2026-11-05';
const CEO = 'u-fauzan';
const NOW = myt(TODAY, '10:00');
// P100 B1: each company prepares its own month; the seed has each pilot company's manager name one admin executive.
const PREPARER: Record<string, string> = { 'co-sasa': 'u-ae-sasa', 'co-arsh': 'u-ae-arsh', 'co-inas': 'u-ae-inas' };
const prep = (svc: PrimaService, companyId: string) => svc.user(PREPARER[companyId] ?? `no-preparer-${companyId}`);
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW, daysBack: 40 });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};

const formula = (restHours = 2): PayFormula => ({
  id: 'pf-t',
  code: 'T-R2',
  version: 1,
  kind: 'guard_shift',
  name: 'Test 12-hour',
  effectiveFrom: '2026-10',
  amounts: standardGuardAmounts(restHours),
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
  ({
    id: 'p1',
    companyId: 'c1',
    branchId: 'b1',
    staffNo: 'T001',
    name: 'Test Guard',
    nationality: 'MY',
    idMasked: '****',
    dob: '1990-01-01',
    phone: '',
    role: 'guard',
    status: 'active',
    hiredOn: '2025-01-01',
    faceEnrolledOn: null,
    lindungOptOut: false,
    bank: { bank: 'Test Bank', accountMasked: '****0001' },
    ...over,
  }) as Person;
/** n days of completed, locked shifts in October 2026 at one site, from the 1st. */
const days = (n: number, site = 's1', opts: { locked?: boolean; from?: number } = {}) =>
  Array.from({ length: n }, (_, k) => {
    const date = `2026-10-${String((opts.from ?? 1) + k).padStart(2, '0')}`;
    const shift = { id: `sh-${site}-${date}`, companyId: 'c1', siteId: site, postId: 'x', personId: 'p1', date, start: myt(date, '07:00'), end: myt(date, '19:00'), status: 'published' } as Shift;
    const a = { id: `at-${shift.id}`, companyId: 'c1', siteId: site, shiftId: shift.id, personId: 'p1', deviceId: 'd', clockIn: shift.start, clockOut: shift.end, lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: opts.locked ?? true } as Attendance;
    return { a, shift };
  });
const line = (attendance: ReturnType<typeof days>, over: Partial<Parameters<typeof buildGuardPayLine>[0]> = {}) =>
  buildGuardPayLine({
    person: person(),
    period: '2026-10',
    attendance,
    leaves: [],
    holidays: [],
    formulaAt: () => ({ formula: formula(), scope: 'Whole group' }),
    siteName: (id) => id,
    utility: [],
    ...over,
  });

describe('guard pay line from attendance and the ACT formula', () => {
  it('pays a full month of 12-hour shifts with 2 hours rest at RM2,550 (blueprint Structure C)', () => {
    const l = line(days(26));
    expect(l.normalDays).toBe(26);
    expect(l.otHours).toBe(65);
    expect(l.gross).toBe(2550);
    // EPF is not charged on overtime: only the RM1,700 basic.
    expect(l.epfWages).toBe(1700);
    expect(l.epfEe).toBe(187);
    expect(l.socsoEe).toBe(12.75);
    expect(l.net).toBe(l.gross - l.deductions);
    expect(l.flags).toEqual([]);
  });

  it('counts days past the full month as rest days, holidays at the holiday rate, and deducts days short', () => {
    const rest = line(days(28));
    expect(rest.restDaysWorked).toBe(2);
    expect(rest.items.find((x) => x.kind === 'rest_day')?.amount).toBeCloseTo(130.77, 2);
    expect(rest.items.find((x) => x.label === 'Overtime, rest days')?.qty).toBe(5);
    const hol = line(days(26), { holidays: ['2026-10-20'] });
    expect(hol.holidaysWorked).toBe(1);
    expect(hol.normalDays).toBe(25);
    expect(hol.items.find((x) => x.kind === 'holiday')?.amount).toBeCloseTo(130.77, 2);
    // A holiday is a paid day worked or not: 25 ordinary days + 1 holiday is a full month, and 26 + 1 holiday off too.
    expect(hol.unpaidDays).toBe(0);
    expect(hol.restDaysWorked).toBe(0);
    const off = line(days(25), { holidays: ['2026-10-31'] });
    expect(off.unpaidDays).toBe(0);
    expect(off.holidaysWorked).toBe(0);
    const offRest = line(days(26), { holidays: ['2026-10-31'] });
    expect(offRest.restDaysWorked).toBe(1);
    const short = line(days(24));
    expect(short.unpaidDays).toBe(2);
    expect(short.items.find((x) => x.kind === 'unpaid')?.amount).toBeCloseTo(-130.77, 2);
    // Approved paid leave fills the month without overtime.
    const leave = line(days(24), {
      leaves: [{ id: 'l1', companyId: 'c1', personId: 'p1', kind: 'ANNUAL', from: '2026-10-27', to: '2026-10-28', days: 2, status: 'approved' } as never],
    });
    expect(leave.unpaidDays).toBe(0);
    expect(leave.otHours).toBe(60);
  });

  it('never counts a shift the supervisor has not locked, or one with no clock-out', () => {
    const open = days(3, 's1', { locked: false, from: 24 });
    const noOut = days(1, 's1', { from: 27 });
    noOut[0].a.clockOut = null;
    const l = line([...days(23), ...open, ...noOut]);
    expect(l.daysWorked).toBe(23);
    expect(l.unlockedShifts).toBe(3);
    expect(l.noClockOut).toBe(1);
    expect(l.flags.join(' ')).toMatch(/not locked/);
  });

  it('uses the main site formula, flags other sites on a different formula, and refuses no formula', () => {
    const l = line([...days(20, 'sA'), ...days(6, 'sB', { from: 21 })], {
      formulaAt: (s) => (s === 'sA' ? { formula: formula(), scope: 'Site' } : { formula: { ...formula(3), code: 'T-R3' }, scope: 'Site' }),
    });
    expect(l.formulaCode).toBe('T-R2');
    expect(l.flags.join(' ')).toMatch(/sB \(T-R3\)/);
    const none = line(days(26), { formulaAt: () => null });
    expect(none.formulaCode).toBeNull();
    expect(none.gross).toBe(0);
    expect(none.flags.join(' ')).toMatch(/No pay formula/);
  });

  it('foreign guards pay EPF at 2% and no EIS or HRD levy; hostel utility HR approved is deducted', () => {
    const l = line(days(26), {
      person: person({ nationality: 'NP' }),
      utility: [{ id: 'u1', personId: 'p1', decision: 'DEDUCTION', payrollMonth: '2026-10', share: 12.5 } as never],
    });
    expect(l.epfEe).toBe(34);
    expect(l.eisEe).toBe(0);
    expect(l.hrd).toBe(0);
    expect(l.utility).toBe(12.5);
    expect(l.net).toBeCloseTo(l.gross - l.epfEe - l.socsoEe - l.lindungEe - l.pcb - 12.5, 2);
  });
});

describe('guard pay run: the company preparer prepares, the COO approves, Finance pays', () => {
  afterEach(() => {
    RULES.guardPayroll.value.primaPays = false;
  });

  it('runs as a trial beside JA: the COO approves with a reason, Finance cannot pay, the bank file says do not upload', async () => {
    const { svc, ds } = fresh();
    // Sasa's guard holidays for the year come from the OD/OGM list; give this test a holiday in October.
    ds.publicHolidayLists[0].days.push({ date: '2026-10-20', label: 'Test holiday' });
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    const board = await svc.guardPayroll(hr);
    expect(board.role).toBe('hr');
    expect(board.rule.primaPays).toBe(false);
    expect(board.employers.map((e) => e.companyId)).toEqual(expect.arrayContaining(['co-sasa', 'co-arsh', 'co-inas']));
    // A company with a yearly guard list: HR does not enter holidays (staff holidays are separate and not read).
    await expect(svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-10', [{ date: '2026-10-20', label: 'x' }])).rejects.toThrow(/Operations Director or the OGM/);
    // A company with no yearly list: HR's dates must be real dates in the month.
    await expect(svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10', [{ date: '2026-11-01', label: 'x' }])).rejects.toThrow(/in 2026-10/);
    await expect(svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-09')).rejects.toThrow(/last month/);
    const run = await svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-10');
    expect(run.holidaySource).toBe('yearly');
    expect(run.trial).toBe(true);
    expect(run.lines.length).toBeGreaterThan(250);
    expect(run.lines.filter((l) => l.daysWorked).every((l) => l.formulaCode)).toBe(true);
    // The seeded example site uses the 3-hour rest formula (PR #112).
    expect(run.lines.some((l) => l.formulaCode === 'STD-12H-R3')).toBe(true);
    expect(run.lines.some((l) => l.holidaysWorked > 0)).toBe(true);
    // A few guards have no salary account: HR cannot submit until fixed.
    await expect(svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit')).rejects.toThrow(/cannot be paid/);
    const store = (svc as unknown as { store: MemoryStore }).store;
    for (const l of run.lines.filter((x) => !x.bank)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    await svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-10');
    expect((await svc.guardPayRun(hr, run.id)).run.lines.some((l) => l.holidayDates?.includes('2026-10-20'))).toBe(true);
    // HR cannot approve, the COO cannot approve a draft.
    await expect(svc.guardPayStep(coo, run.id, 'approve', { note: 'ok' })).rejects.toThrow(/preparer to submit/);
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await expect(svc.guardPayStep(hr, run.id, 'approve', { note: 'ok' })).rejects.toThrow(/COO to approve/);
    await expect(svc.guardPayStep(coo, run.id, 'approve')).rejects.toThrow(/reason/);
    const ok = await svc.guardPayStep(coo, run.id, 'approve', { note: 'Checked overtime against the roster' });
    expect(ok.stage).toBe('approved');
    expect(ok.approved?.note).toMatch(/roster/);
    await expect(svc.guardPayStep(fin, run.id, 'pay', { bankRef: 'X', pcbChecked: true })).rejects.toThrow(/JA Group app still pays/);
    const bank = await svc.guardPayExport(fin, run.id, 'bank');
    expect(bank.body.split('\n')[0]).toMatch(/TRIAL RUN.*DO NOT UPLOAD/);
    expect(bank.filename).toMatch(/TRIAL/);
    await expect(svc.guardPayExport(hr, run.id, 'bank')).rejects.toBeInstanceOf(AccessDenied);
    // The journal balances.
    const sql = await svc.guardPayExport(fin, run.id, 'sql');
    const rows = sql.body.trim().split('\n').slice(2).map((l) => l.split(','));
    const dr = rows.reduce((n, r) => n + Number(r[r.length - 2]), 0);
    const cr = rows.reduce((n, r) => n + Number(r[r.length - 1]), 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.05);
  });

  it('switches on 1 August 2027 (Fauzan, 8 Nov 2026): until then primaPays stays off and a run cannot be marked paid', async () => {
    expect(RULES.guardPayroll.value.switchDate).toBe('2027-08-01');
    expect(RULES.guardPayroll.value.primaPays).toBe(false);
    expect(RULES.guardPayroll.source).toMatch(/1 August 2027/);
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const board = await svc.guardPayroll(hr);
    expect(board.rule.switchDate).toBe('2027-08-01');
    // A month before the switch date: prepared, submitted and approved as a trial, never paid.
    const run = await svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-10', []);
    expect(`${run.period}-01` < RULES.guardPayroll.value.switchDate).toBe(true);
    expect(run.trial).toBe(true);
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Checked against the JA figures' });
    await expect(svc.guardPayStep(fin, run.id, 'pay', { bankRef: 'M2U-GUARD-1', pcbChecked: true, paidOn: '2026-11-05' })).rejects.toThrow(/JA Group app still pays/);
    expect((await svc.guardPayRun(fin, run.id)).run.stage).toBe('approved');
  });

  it('once Prima pays guards, Finance marks paid and the guard sees the payslip', async () => {
    RULES.guardPayroll.value.primaPays = true;
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    const guard = await svc.user('u-guard-sasa-1');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const run = await svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-10', []);
    expect(run.trial).toBe(false);
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Approved' });
    await expect(svc.guardPayStep(fin, run.id, 'pay', { bankRef: 'B1' })).rejects.toThrow(/PCB/);
    const paid = await svc.guardPayStep(fin, run.id, 'pay', { bankRef: 'M2U-GUARD-1', pcbChecked: true, paidOn: '2026-11-05' });
    expect(paid.stage).toBe('paid');
    const mine = await svc.myGuardPayslips(guard);
    expect(mine.payslips).toHaveLength(1);
    expect(mine.payslips[0].line.personId).toBe(guard.personId);
    // Nobody else's line comes back.
    expect(mine.payslips.every((p) => p.line.personId === guard.personId)).toBe(true);
  });

  it('a return needs a reason; this month cannot be submitted early; the preparer cannot approve', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const cur = await svc.prepareGuardPay(await prep(svc, 'co-inas'), 'co-inas', '2026-11', []);
    await expect(svc.guardPayStep(await prep(svc, cur.companyId), cur.id, 'submit')).rejects.toThrow(/not over/);
    const store = (svc as unknown as { store: MemoryStore }).store;
    const run = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10', []);
    for (const l of run.lines.filter((x) => !x.bank)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10');
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await expect(svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10')).rejects.toThrow(/already submitted/);
    await expect(svc.guardPayStep(coo, run.id, 'return')).rejects.toThrow(/change/);
    const back = await svc.guardPayStep(coo, run.id, 'return', { note: 'Recheck the rest days' });
    expect(back.stage).toBe('draft');
    expect(back.returns).toHaveLength(1);
    // A one-off item needs a reason and is flagged for the COO.
    const pid = back.lines[0].personId;
    await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: '', amount: 50 }] })).rejects.toThrow(/reason/);
    // Uniform and item deductions stay switched off until management and legal decide (Fauzan, 8 Nov 2026; rule PAY-GUARD
    // uniformDeduction 'awaiting_decision'). Equipment is never charged to the guard either way (EA s.24).
    await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Uniform deduction (test)', amount: -20 }] })).rejects.toThrow(/switched off until management and legal decide/);
    await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Uniform', amount: -20, uniformNo: 2 }] })).rejects.toThrow(/switched off/);
    await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Uniform set (test)', amount: -20, uniformNo: 4 }] })).rejects.toThrow(/switched off/);
    await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Lost radio', amount: -50 }] })).rejects.toThrow(/Equipment is never charged/);
    await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Damaged item (test)', amount: -30 }] })).rejects.toThrow(/switched off/);
    // Free to resign (RBA checklist A6): no fine, deposit, fee or penalty, and nothing for leaving, as a one-off item.
    for (const label of ['Late fine (test)', 'Resignation penalty', 'Deposit (test)', 'Agency fee', 'Short notice (test)'])
      await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label, amount: -30 }] })).rejects.toThrow(/fine, deposit|resigning or leaving/);
    // If management turns on PR #120's path, only a 4th or 5th uniform set is charged, flagged as a legal point for the CEO.
    const policy = RULES.guardPayroll.value as { uniformDeduction: string };
    policy.uniformDeduction = 'fourth_fifth_set';
    try {
      await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Uniform', amount: -20, uniformNo: 2 }] })).rejects.toThrow(/4th or 5th set/);
      await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Damaged item (test)', amount: -30 }] })).rejects.toThrow(/switched off/);
      const u = await svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Uniform set (test)', amount: -20, uniformNo: 4 }] });
      expect(u.flags.join(' ')).toMatch(/legal point for the CEO/);
    } finally {
      policy.uniformDeduction = 'awaiting_decision';
    }
    // Another one-off deduction still goes through, flagged for the COO.
    const l = await svc.setGuardPayLine(await prep(svc, run.companyId), run.id, pid, { extra: [{ label: 'Overpayment last month (test)', amount: -20 }] });
    expect(l.items.some((x) => x.kind === 'extra' && x.amount === -20)).toBe(true);
    expect(l.flags.join(' ')).toMatch(/COO checks/);
  });

  it('keeps everyone else out, on the direct calls too', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const run = await svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-10', []);
    for (const id of ['u-guard-sasa-1', 'u-fwm-mgr']) {
      const u = await svc.user(id);
      await expect(svc.guardPayroll(u)).rejects.toBeInstanceOf(AccessDenied);
      await expect(svc.guardPayRun(u, run.id)).rejects.toThrow();
    }
    // Another company's manager does not see Sasa's run; Sasa's manager sees it but cannot act.
    await expect(svc.guardPayRun(await svc.user('u-cm-arsh'), run.id)).rejects.toThrow(/not found/i);
    const cm = await svc.user('u-cm-sasa');
    const view = await svc.guardPayRun(cm, run.id);
    expect(Object.values(view.can).every((v) => v === false)).toBe(true);
    await expect(svc.prepareGuardPay(cm, 'co-sasa', '2026-10')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.guardPayStep(cm, run.id, 'submit')).rejects.toThrow();
    // Finance cannot prepare; the COO cannot change a line.
    await expect(svc.prepareGuardPay(await svc.user('u-fin-t1-lead'), 'co-sasa', '2026-10')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setGuardPayLine(await svc.user('u-coo'), run.id, run.lines[0].personId, { pcb: 0 })).rejects.toBeInstanceOf(AccessDenied);
    // A guard's own payslips only; office staff have none here.
    await expect(svc.myGuardPayslips(await svc.user('u-pwvsb-hr'))).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('pay run settings the ACT Director sets on the formula', () => {
  const withA = (over: Record<string, unknown>, code = 'T-R2'): PayFormula => ({ ...formula(), code, amounts: { ...standardGuardAmounts(2), ...over } });
  it('pays each day at its own site when the formula says so', () => {
    const r3 = { formula: withA({ restHours: 3, basicMonthly: 2000 }, 'T-R3'), scope: 'Site' };
    const att = [...days(20, 'sA'), ...days(6, 'sB', { from: 21 })];
    const main = line(att, { formulaAt: (s) => (s === 'sA' ? { formula: withA({}), scope: 'Site' } : r3) });
    expect(main.otHours).toBe(65);
    const per = line(att, { formulaAt: (s) => (s === 'sA' ? { formula: withA({ multiSite: 'per_site' }), scope: 'Site' } : r3) });
    // 20 days at 2.5 OT hours + 6 days at 1.5 OT hours (12h - 3h rest - 7.5 normal).
    expect(per.otHours).toBe(59);
    expect(per.items.map((x) => x.label)).toEqual(expect.arrayContaining(['Overtime, working days (T-R2)', 'Overtime, working days (T-R3)']));
    expect(per.items.find((x) => x.kind === 'basic')?.amount).toBe(1700);
  });

  it('follows the short-day, holiday and EPF settings', () => {
    const f = (over: Record<string, unknown>) => () => ({ formula: withA(over), scope: 'Group' });
    expect(line(days(24), { formulaAt: f({ deductShortDays: false }) }).unpaidDays).toBe(0);
    expect(line(days(25), { holidays: ['2026-10-31'], formulaAt: f({ holidaysArePaidDays: false }) }).unpaidDays).toBe(1);
    const epf = line(days(28), { formulaAt: f({ epfOnRestHolidayPay: false }) });
    expect(epf.epfWages).toBe(1700);
    expect(line(days(28)).epfWages).toBeCloseTo(1830.77, 2);
  });
});

describe('review fixes', () => {
  it('pays a month of paid leave with no shift on the company formula, and never pays a month with neither', () => {
    const leave = [{ id: 'l1', companyId: 'c1', personId: 'p1', kind: 'HOSPITAL', from: '2026-10-01', to: '2026-10-31', days: 26, status: 'approved' } as never];
    const onLeave = line([], { leaves: leave, formulaAt: () => null, formulaFallback: () => ({ formula: formula(), scope: 'Company' }) });
    expect(onLeave.formulaCode).toBe('T-R2');
    expect(onLeave.gross).toBe(1700);
    expect(onLeave.otHours).toBe(0);
    const nothing = line([], { formulaAt: () => null, formulaFallback: () => ({ formula: formula(), scope: 'Company' }) });
    expect(nothing.gross).toBe(0);
    // A nil line needs no salary account.
    expect(line([], { person: person({ bank: null }), formulaAt: () => null }).flags.join(' ')).not.toMatch(/salary account/);
  });

  it('keeps nil lines out of the bank file and its control total; the preparer is not asked to act on an open month', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const idle = ds.people.find((p) => p.companyId === 'co-inas' && p.role === 'guard' && p.status === 'active')!;
    ds.attendance = ds.attendance.filter((a) => a.personId !== idle.id);
    await svc.prepareGuardPay(await prep(svc, 'co-inas'), 'co-inas', '2026-11', []);
    expect((await svc.guardPayroll(await prep(svc, 'co-inas'))).runs.find((r) => r.period === '2026-11')?.mineToAct).toBe(false);
    const run = await svc.prepareGuardPay(await prep(svc, 'co-inas'), 'co-inas', '2026-10', []);
    const nil = run.lines.find((l) => l.personId === idle.id)!;
    expect(nil.net).toBe(0);
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Checked' });
    const view = await svc.guardPayRun(fin, run.id);
    expect(view.control.count).toBe(run.lines.filter((l) => l.net > 0).length);
    const bank = await svc.guardPayExport(fin, run.id, 'bank');
    expect(bank.body).not.toContain(nil.staffNo);
  });
});

describe('second review fixes', () => {
  it('counts leave across two months in each month for its own days', () => {
    const l = { from: '2026-10-29', to: '2026-11-03', days: 6 } as never;
    expect(leaveDaysIn(l, '2026-10')).toBe(3);
    expect(leaveDaysIn(l, '2026-11')).toBe(3);
    expect(leaveDaysIn({ from: '2026-10-05', to: '2026-10-07', days: 3 } as never, '2026-10')).toBe(3);
    expect(leaveDaysIn({ from: '2026-10-05', to: '2026-10-07', days: 3 } as never, '2026-11')).toBe(0);
  });

  it('takes a one-off deduction from net pay without lowering EPF, SOCSO or tax wages', () => {
    const plain = line(days(26));
    const ded = line(days(26), { kept: { extra: [{ label: 'Uniform (test)', amount: -50 }], pcb: null } });
    expect(ded.gross).toBe(plain.gross);
    expect(ded.epfWages).toBe(plain.epfWages);
    expect(ded.socsoEe).toBe(plain.socsoEe);
    expect(ded.otherDeductions).toBe(50);
    expect(ded.net).toBe(plain.net - 50);
    const bonus = line(days(26), { kept: { extra: [{ label: 'Attendance bonus (test)', amount: 100 }], pcb: null } });
    expect(bonus.gross).toBe(plain.gross + 100);
  });
});

describe('guard pay: bank or e-wallet only, cash by the COO or CEO, advances (Fauzan, 6 Nov 2026)', () => {
  afterEach(() => {
    RULES.guardPayroll.value.primaPays = false;
  });

  it("refuses someone else's account without written consent, and HR records the consent", async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const store = (svc as unknown as { store: MemoryStore }).store;
    const run0 = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10', []);
    for (const l of run0.lines.filter((x) => !x.bank)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    const paid = run0.lines.find((l) => l.net > 0)!;
    const p = ds.people.find((x) => x.id === paid.personId)!;
    await store.update('people', p.id, { bank: { bank: 'Test Bank', accountMasked: '****1111', holder: 'relative', holderName: 'Test Sibling', relationship: 'brother' } });
    const run = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10');
    const line = run.lines.find((l) => l.personId === p.id)!;
    expect(line.accountProblem).toMatch(/no written consent/);
    await expect(svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit')).rejects.toThrow(/cannot be paid/);
    // Consent needs the form reference and the date signed.
    await expect(svc.recordPayConsent(hr, p.id, { holder: 'relative', holderName: 'Test Sibling', relationship: 'brother' })).rejects.toThrow(/consent form/);
    await expect(svc.recordPayConsent(await svc.user('u-cm-arsh'), p.id, { holder: 'own' })).rejects.toBeInstanceOf(AccessDenied);
    const letter = { holder: 'relative', holderName: 'Test Sibling', relationship: 'brother', docRef: 'CONSENT-T1', signedOn: '2026-10-01' };
    // The letter needs a Commissioner for Oaths stamp, then the COO's approval, before the account can be used.
    await expect(svc.recordPayConsent(hr, p.id, letter)).rejects.toThrow(/Commissioner for Oaths/);
    await svc.recordPayConsent(hr, p.id, { ...letter, commissioner: 'Test Commissioner', stampRef: 'PS-T-1', stampedOn: '2026-10-02' });
    const waiting = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10');
    expect(waiting.lines.find((l) => l.personId === p.id)!.accountProblem).toMatch(/waiting for the COO/);
    const coo = await svc.user('u-coo');
    expect((await svc.payConsentsWaiting(coo)).some((c) => c.personId === p.id && c.canApprove)).toBe(true);
    await expect(svc.approvePayConsent(hr, p.id, 'okay')).rejects.toBeInstanceOf(AccessDenied);
    // COO only: the CEO does not stand in for consent letters, even during the pilot (Fauzan, 6 Nov 2026).
    await expect(svc.approvePayConsent(await svc.user('u-fauzan'), p.id, 'okay')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.approvePayConsent(coo, p.id, '')).rejects.toThrow(/reason/);
    await svc.approvePayConsent(coo, p.id, 'Letter stamped and checked');
    const again = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10');
    const l2 = again.lines.find((l) => l.personId === p.id)!;
    expect(l2.accountProblem).toBeNull();
    expect(l2.flags.join(' ')).toMatch(/EA s.25/);
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
  });

  it('pays an e-wallet separately and requires CEO approval for wage cash', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    const doa = await svc.user('u-pwvsb-doa');
    const store = (svc as unknown as { store: MemoryStore }).store;
    const run = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10', []);
    const noAcc = run.lines.filter((l) => !l.bank && l.net > 0);
    for (const l of noAcc.slice(1)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    const withPay = run.lines.filter((l) => l.bank && l.net > 0);
    const wallet = withPay[0];
    await store.update('people', wallet.personId, { bank: { bank: 'Test eWallet', accountMasked: '****2222', kind: 'ewallet' } });
    // One guard without an account: HR cannot submit until the Director Office lists them for cash.
    const cashGuard = noAcc[0] ?? withPay[1];
    if (!noAcc[0]) await store.update('people', cashGuard.personId, { bank: null });
    await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10');
    await expect(svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit')).rejects.toThrow(/cannot be paid/);
    await svc.guardPayCash(doa, run.id, cashGuard.personId, 'list', { reason: 'Cash requested' });
    await expect(svc.guardPayCash(coo, run.id, cashGuard.personId, 'decide', {give:true,reason:'COO cannot approve'})).rejects.toThrow(/CEO/);
    await svc.guardPayCash(await svc.user(CEO), run.id, cashGuard.personId, 'decide', {give:true,reason:'CEO approved named amount'});
    await store.update('people', cashGuard.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10');
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Checked' });
    const ew = await svc.guardPayExport(fin, run.id, 'ewallet');
    expect(ew.body).toContain('****2222');
    const view = await svc.guardPayRun(doa, run.id);
    expect(view.can.listCash).toBe(false);expect(view.can.decideCash).toBe(false);expect(view.can.handOutCash).toBe(false);

  });

  it('advances: the OM sets them in bulk, the OD or OGM approves, a change needs one more approval, the pay run takes them back', async () => {
    const { svc } = fresh();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    const ogm = await svc.user('u-ogm');
    const hr = await svc.user('u-pwvsb-hr');
    const board = await svc.guardAdvances(om, {});
    const companyId = board.companyId;
    const site = board.choices.sites[0];
    await expect(svc.setGuardAdvances(hr, { companyId, basis: 'site', ref: site.id, amount: 100 })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setGuardAdvances(om, { companyId, basis: 'site', ref: site.id, amount: 0 })).rejects.toThrow(/RM/);
    await expect(svc.setGuardAdvances(om, { companyId, basis: 'site', ref: site.id, amount: 100, payOn: '2026-12-20' })).rejects.toThrow(/pay date|this month or next/);
    // Bulk by zone: everyone whose latest site is in the branch.
    const zone = board.choices.zones[0];
    const set = await svc.setGuardAdvances(om, { companyId, basis: 'zone', ref: zone.id, amount: 200, payOn: '2026-11-20', reason: 'Monthly advance (test)' });
    expect(set.made).toBeGreaterThan(0);
    const after = await svc.guardAdvances(om, { companyId });
    const a = after.advances.find((x) => x.status === 'pending')!;
    expect(a.payOn).toBe('2026-11-20');
    // The OM cannot approve; the wrong tier cannot approve; a reason is needed.
    await expect(svc.approveGuardAdvances(om, [a.id], 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const right = a.approverTier === 'ogm' ? ogm : od;
    const wrong = a.approverTier === 'ogm' ? od : ogm;
    await expect(svc.approveGuardAdvances(wrong, [a.id], 'okay')).rejects.toThrow(/approved by the/);
    await expect(svc.approveGuardAdvances(right, [a.id], '')).rejects.toThrow(/reason/);
    await svc.approveGuardAdvances(right, [a.id], 'Approved for the 20th');
    // A change after approval goes back for one more approval.
    const changed = await svc.changeGuardAdvance(om, a.id, { amount: 150, reason: 'Guard asked for less' });
    expect(changed.status).toBe('pending');
    expect(changed.version).toBe(2);
    await svc.approveGuardAdvances(right, [a.id], 'Change approved');
    // Approval alone is not payment: the current month must not recover money never paid.
    const run = await svc.prepareGuardPay(await prep(svc, companyId), companyId, '2026-11');
    const line = run.lines.find((l) => l.personId === a.personId)!;
    expect(line.advance).toBe(0);
    expect(line.items.some((x) => x.kind === 'advance')).toBe(false);
    // Finance cannot pay an advance while the JA Group app still pays guards.
    await expect(svc.payGuardAdvance(await svc.user('u-fin-t1-lead'), a.id, { bankRef: 'X' })).rejects.toThrow(/JA Group app/);
  });

  it('loses a public holiday for absence without leave the working day before or after (EA s.60D(2))', () => {
    const dayOf = (d: string) => days(1, 's1', { from: Number(d.slice(8)) })[0];
    const ws = Array.from({ length: 10 }, (_, k) => `2026-10-${String(k + 10).padStart(2, '0')}`).filter((d) => d !== '2026-10-15' && d !== '2026-10-16');
    const base = line(ws.map(dayOf), { holidays: ['2026-10-15'], rostered: [...ws, '2026-10-16'] });
    expect(base.holidaysLost).toEqual(['2026-10-15']);
    expect(base.flags.join(' ')).toMatch(/s.60D\(2\)/);
    const ok = line(ws.map(dayOf), { holidays: ['2026-10-15'], rostered: ws });
    expect(ok.holidaysLost).toEqual([]);
  });
});

describe('cash by exception and the advance and loan scheme (Fauzan, 6 Nov 2026)', () => {
  afterEach(() => {
    RULES.guardPayroll.value.primaPays = false;
  });
  const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 signed cash receipt (synthetic)').toString('base64');

  async function approvedCash() {
    RULES.guardPayroll.value.primaPays = true;
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr'), doa = await svc.user('u-pwvsb-doa');
    const ceo = await svc.user(CEO), coo = await svc.user('u-coo'), fin = await svc.user('u-fin-t1-lead');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const run = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10', []);
    const guard = run.lines.find(l => l.net > 100)!;
    await svc.guardPayCash(doa, run.id, guard.personId, 'list', { reason: 'Synthetic cash request' });
    await svc.guardPayCash(ceo, run.id, guard.personId, 'decide', { give: true, reason: 'Named wage approved' });
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Payroll checked' });
    return { svc, ds, hr, doa, ceo, coo, fin, run, guard };
  }

  it('supersedes an unpaid stale wage-cash approval with an audited fresh CEO decision', async () => {
    const { svc, ds, hr, doa, ceo, coo, fin, run, guard } = await approvedCash();
    const original = structuredClone(ds.guardPayRuns.find(r => r.id === run.id)!.cash![0]);
    await svc.guardPayStep(fin, run.id, 'return', { note: 'Correct PCB before paying' });
    const changed = await svc.setGuardPayLine(await prep(svc, run.companyId), run.id, guard.personId, { pcb: guard.pcb + 1 });
    await expect(svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit')).rejects.toThrow(/stale/);
    await expect(svc.guardPayCash(ceo, run.id, guard.personId, 'supersede', { reason: 'Corrected amount' })).rejects.toThrow(/Director Office/);
    await expect(svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: '' })).rejects.toThrow(/why|reason/i);
    await svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: 'Corrected PCB; seek new CEO approval' });
    const stored = ds.guardPayRuns.find(r => r.id === run.id)!;
    expect(stored.cashHistory).toHaveLength(1);
    expect(stored.cashHistory![0].entry).toEqual(original);
    expect(stored.cashHistory![0].superseded.byId).toBe(doa.id);
    expect(stored.cash![0].amount).toBe(changed.net);
    expect(stored.cash![0].decision).toBeNull();
    await expect(svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: 'Replayed correction' })).rejects.toThrow(/fresh|pending/);
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await expect(svc.guardPayStep(coo, run.id, 'approve', { note: 'Checked' })).rejects.toThrow(/CEO/);
    await svc.guardPayCash(ceo, run.id, guard.personId, 'decide', { give: true, reason: 'Corrected amount checked' });
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Revised payroll checked' });
    await svc.guardPayCash(coo, run.id, guard.personId, 'handout', { on: TODAY });
    await svc.guardPayStep(fin, run.id, 'return', { note: 'Synthetic return must preserve cash history' });
    await expect(svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: 'Must not erase handover' })).rejects.toThrow(/handed|receipt|reconciliation/);
    const handed = ds.guardPayRuns.find(r => r.id === run.id)!;
    expect(handed.cashHistory).toHaveLength(1);
    expect(handed.cash![0].handedOut).toBeTruthy();
    expect(ds.audit.some(a => a.action === 'guardpay.cash.supersede' && a.entityId === run.id)).toBe(true);
    handed.stage = 'paid';
    await expect(svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: 'Must not alter paid run' })).rejects.toThrow();
  });

  it('rejects impossible dates and handovers before either cash or payroll approval', async () => {
    const { svc, ds, coo, run, guard } = await approvedCash();
    const stored = ds.guardPayRuns.find(r => r.id === run.id)!;
    for (const on of ['2026-10-32', '2026-11-04', '2026-11-06']) {
      await expect(svc.guardPayCash(coo, run.id, guard.personId, 'handout', { on })).rejects.toThrow(/date|approval/i);
      expect(stored.cash![0].handedOut).toBeNull();
    }
    stored.cash![0].decision!.at = myt('2026-11-03', '10:00');
    await expect(svc.guardPayCash(coo, run.id, guard.personId, 'handout', { on: '2026-11-04' })).rejects.toThrow(/approval/i);
    stored.approved!.at = myt('2026-11-02', '10:00');
    stored.cash![0].decision!.at = NOW;
    await expect(svc.guardPayCash(coo, run.id, guard.personId, 'handout', { on: '2026-11-04' })).rejects.toThrow(/approval/i);
    await svc.guardPayCash(coo, run.id, guard.personId, 'handout', { on: TODAY });
    expect(ds.guardPayRuns.find(r => r.id === run.id)!.cash![0].handedOut!.on).toBe(TODAY);
  });

  it('retains site changes and zero-pay approvals in history without authorizing another handout', async () => {
    const { svc, ds, hr, doa, fin, run, guard } = await approvedCash();
    await svc.guardPayStep(fin, run.id, 'return', { note: 'Correct site and wages' });
    const stored = ds.guardPayRuns.find(r => r.id === run.id)!;
    const line = stored.lines.find(l => l.personId === guard.personId)!;
    const oldSite = line.mainSiteId;
    line.mainSiteId = ds.sites.find(s => s.companyId === run.companyId && s.id !== oldSite)!.id;
    await svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: 'Corrected site requires new approval' });
    let current = ds.guardPayRuns.find(r => r.id === run.id)!;
    expect(current.cashHistory![0].entry.approvedSiteId).toBe(oldSite);
    expect(current.cash![0].approvedSiteId).toBe(line.mainSiteId);
    expect(current.cash![0].decision).toBeNull();
    await svc.setGuardPayLine(await prep(svc, run.companyId), run.id, guard.personId, { pcb: guard.pcb + guard.net });
    await svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: 'Corrected wages leave no cash payable' });
    current = ds.guardPayRuns.find(r => r.id === run.id)!;
    expect(current.cash).toHaveLength(0);
    expect(current.cashHistory).toHaveLength(2);
  });

  it('does not supersede an unpaid receipt or a historically paid run', async () => {
    const { svc, ds, doa, fin, run, guard } = await approvedCash();
    await svc.guardPayStep(fin, run.id, 'return', { note: 'Preserve historical evidence' });
    const stored = ds.guardPayRuns.find(r => r.id === run.id)!;
    stored.cash![0].receipt = { docId: 'historical', name: 'receipt.pdf', sha256: 'historical', uploadedBy: doa.name, uploadedById: doa.id, uploadedAt: NOW };
    await expect(svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: 'Must preserve receipt' })).rejects.toThrow(/receipt/);
    stored.cash![0].receipt = null;
    stored.paid = { by: fin.name, byId: fin.id, at: NOW, note: 'Historical', bankRef: 'HISTORY', paidOn: TODAY, pcbChecked: true };
    await expect(svc.guardPayCash(doa, run.id, guard.personId, 'supersede', { reason: 'Must preserve payment' })).rejects.toThrow(/unpaid/);
    expect(stored.cashHistory ?? []).toHaveLength(0);
  });

  it('retains legacy signed receipts while rejecting replayed historical handouts', async () => {
    const { svc, ds } = fresh(); const hr=await svc.user('u-pwvsb-hr'), doa=await svc.user('u-pwvsb-doa'), coo=await svc.user('u-coo');
    const run=await svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa','2026-10',[]); const g=run.lines.find(l=>l.net>0)!;
    const stored=ds.guardPayRuns.find(r=>r.id===run.id)!;
    stored.cash=[{personId:g.personId,staffNo:g.staffNo,name:g.name,siteName:g.mainSiteName,amount:g.net,reason:'Historical fixture only',listedBy:doa.name,listedById:doa.id,listedAt:NOW,decision:{by:coo.name,byId:coo.id,at:NOW,note:'Historical',give:true,tier:'coo'},handedOut:{by:coo.name,byId:coo.id,at:NOW,note:'Historical',on:TODAY,tier:'coo'},receipt:null}];
    await expect(svc.guardPayCash(coo,run.id,g.personId,'handout',{})).rejects.toThrow();
    const after=await svc.guardPayCash(doa,run.id,g.personId,'receipt',{transactionSpecific:true,signedByPersonId:g.personId,amount:g.net,proof:[{kind:'document',name:'receipt.pdf',data:PDF,caption:''}]});
    expect(after[0].receipt?.uploadedBy).toBe(doa.name);
    await expect(svc.guardPayStep(coo,run.id,'approve',{note:'Again'})).rejects.toThrow(/reconciliation/);
  });

  it('a loan needs a limit, purpose, period and signature; CoS then CEO approve; Finance pays out and is told; the pay run takes it back', async () => {
    RULES.guardPayroll.value.primaPays = true;
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const ceo = await svc.user(CEO);
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const board = await svc.guardLoans(hr, { companyId: 'co-sasa' });
    const guardId = board.guards[0].id;
    const base = { companyId: 'co-sasa', personId: guardId, kind: 'loan', limit: 1000, amount: 600, purpose: 'Family emergency (test)', months: 6, firstPeriod: '2026-11', docRef: 'LOAN-T1', signedOn: '2026-11-04' };
    await expect(svc.recordGuardLoan(coo, base)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.recordGuardLoan(hr, { ...base, docRef: '' })).rejects.toThrow(/signed agreement/);
    await expect(svc.recordGuardLoan(hr, { ...base, purpose: '' })).rejects.toThrow(/purpose/);
    await expect(svc.recordGuardLoan(hr, { ...base, months: 0 })).rejects.toThrow(/repayment period/);
    await expect(svc.recordGuardLoan(hr, { ...base, amount: 1200 })).rejects.toThrow(/limit/);
    const rec = await svc.recordGuardLoan(hr, base);
    expect(rec.status).toBe('pending_cos');
    expect(rec.instalment).toBe(100);
    expect(rec.financeNotices).toHaveLength(1);
    // The CEO cannot go first; the CoS cannot decide twice; a reason is needed.
    await expect(svc.decideGuardLoan(ceo, rec.id, { decision: 'approve', note: 'okay' })).rejects.toThrow(/Chief of Staff first/);
    await expect(svc.decideGuardLoan(cos, rec.id, { decision: 'approve', note: '' })).rejects.toThrow(/reason/);
    await svc.decideGuardLoan(cos, rec.id, { decision: 'approve', note: 'Within the scheme' });
    await expect(svc.decideGuardLoan(cos, rec.id, { decision: 'approve', note: 'again' })).rejects.toThrow(/waits for the CEO/);
    await expect(svc.payOutGuardLoan(fin, rec.id, { bankRef: 'B1' })).rejects.toThrow(/approved by the Chief of Staff and the CEO/);
    const approved = await svc.decideGuardLoan(ceo, rec.id, { decision: 'approve', note: 'Approved' });
    expect(approved.status).toBe('approved');
    expect(approved.financeNotices.at(-1)!.text).toMatch(/Finance: ready to pay out/);
    await expect(svc.payOutGuardLoan(hr, rec.id, { bankRef: 'B1' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.payOutGuardLoan(fin, rec.id, { bankRef: 'LOAN-BANK-1', paidOn: '2026-11-05' });
    const finBoard = await svc.guardLoans(fin, { companyId: 'co-sasa' });
    expect(finBoard.totals.owed).toBe(600);
    // No loan or advance as a one-off item: only against the record. (Test shortcut: start repayments from October,
    // a closed month, so the run can be paid today.)
    await (svc as unknown as { store: MemoryStore }).store.update('guardLoans', rec.id, { firstPeriod: '2026-10' });
    const run = await svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-10', []);
    await expect(svc.setGuardPayLine(await prep(svc, run.companyId), run.id, guardId, { extra: [{ label: 'Loan repayment', amount: -50 }] })).rejects.toThrow(/approved record/);
    const line = run.lines.find((l) => l.personId === guardId)!;
    const taken = line.loan ?? 0;
    expect(taken).toBeLessThanOrEqual(100);
    if (line.gross >= 200) expect(taken).toBe(100);
    expect(taken).toBeLessThanOrEqual(line.gross * 0.5);
    // A paid month takes the repayment off the record.
    await svc.guardPayStep(await prep(svc, run.companyId), run.id, 'submit');
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Approved' });
    await svc.guardPayStep(fin, run.id, 'pay', { bankRef: 'M2U-1', pcbChecked: true, paidOn: '2026-11-05' });
    // The SQL journal still balances with the repayment in it.
    const sqlFile = await svc.guardPayExport(fin, run.id, 'sql');
    expect(sqlFile.body).toContain('130-600');
    const jr = sqlFile.body.split('\n').filter((r) => /^\d{4}-\d{2}-\d{2},/.test(r)).map((r) => r.split(','));
    expect(jr.length).toBeGreaterThan(5);
    const dr = jr.reduce((n, r) => n + Number(r[r.length - 2]), 0);
    const cr = jr.reduce((n, r) => n + Number(r[r.length - 1]), 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.05);
    const after = (await svc.guardLoans(fin, { companyId: 'co-sasa' })).loans.find((l) => l.id === rec.id)!;
    expect(after.balance).toBe(Math.round((600 - taken) * 100) / 100);
    expect(taken).toBeGreaterThan(0);
    expect(after.repaid).toEqual([{ period: '2026-10', runId: run.id, amount: taken }]);
    expect(after.financeNotices.at(-1)!.text).toMatch(/taken back in the 2026-10 pay/);
  });

  it('keeps all deductions within half the wages: the loan waits, the balance stays', () => {
    const l = line(days(26), { loans: [{ id: 'gl-1', label: 'Loan repayment: test', due: 5000 }] });
    expect(l.loan).toBe(Math.round(l.gross * 0.5 * 100) / 100);
    expect(l.flags.join(' ')).toMatch(/not taken this month/);
    const withOther = line(days(26), { kept: { extra: [{ label: 'Uniform (uniform no. 4, paid by the guard)', amount: -100 }], pcb: 0 }, loans: [{ id: 'gl-1', label: 'Loan', due: 5000 }] });
    expect(withOther.loan! + withOther.otherDeductions).toBeCloseTo(withOther.gross * 0.5, 1);
  });
});

describe('the CEO sets statutory rates and new contributions by month (Fauzan, 6 Nov 2026)', () => {
  it('keeps the law as at Nov 2026 by default, and a CEO change applies from its month with a reason', async () => {
    const { svc } = fresh();
    const ceo = await svc.user(CEO);
    const hr = await svc.user('u-pwvsb-hr');
    const board = await svc.statutoryBoard(hr);
    expect(board.canSet).toBe(false);
    expect(board.inForce.epf.eeRate).toBe(0.11);
    const before = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10', []);
    const pick = before.lines.find((l) => l.nationality === 'MY' && l.gross > 0 && l.age < 60)!;
    const settings = { ...board.inForce, epf: { ...board.inForce.epf, eeRate: 0.09 }, others: [{ code: 'NEWFUND', name: 'New fund (test)', eeRate: 0.01, erRate: 0.02, wageCap: 3000, includeOt: false, appliesTo: 'all' as const, maxAge: null, payee: 'Test agency' }], lawRef: 'Test gazette 2026' };
    await expect(svc.setStatutory(hr, { effectiveFrom: '2026-10', settings, reason: 'Test change' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setStatutory(ceo, { effectiveFrom: '2026-10', settings, reason: '' })).rejects.toThrow(/why/);
    await expect(svc.setStatutory(ceo, { effectiveFrom: '2026-10', settings: { ...settings, epf: { ...settings.epf, eeRate: 0.9 } }, reason: 'Test change' })).rejects.toThrow(/EPF/);
    await svc.setStatutory(ceo, { effectiveFrom: '2026-10', settings, reason: 'New law from October (test)' });
    const after = await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10');
    const l = after.lines.find((x) => x.personId === pick.personId)!;
    expect(l.epfEe).toBeLessThan(pick.epfEe);
    const nf = l.others!.find((o) => o.code === 'NEWFUND')!;
    expect(nf.er).toBeGreaterThan(0);
    // The journal still balances with the new contribution.
    const hrRun = after;
    const store = (svc as unknown as { store: MemoryStore }).store;
    for (const x of hrRun.lines) if (x.accountProblem) await store.update('people', x.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    await svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-arsh', '2026-10');
    await svc.guardPayStep(await prep(svc, hrRun.companyId), hrRun.id, 'submit');
    await svc.guardPayStep(await svc.user('u-coo'), hrRun.id, 'approve', { note: 'Checked' });
    const sql = await svc.guardPayExport(await svc.user('u-fin-t1-lead'), hrRun.id, 'sql');
    expect(sql.body).toContain('NEWFUND');
    const rows = sql.body.trim().split('\n').slice(2).map((r) => r.split(','));
    const dr = rows.reduce((n, r) => n + Number(r[r.length - 2]), 0);
    const cr = rows.reduce((n, r) => n + Number(r[r.length - 1]), 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.05);
    expect(l.deductions).toBeCloseTo(l.epfEe + l.socsoEe + l.lindungEe + l.eisEe + l.pcb + l.utility + l.otherDeductions + (l.advance ?? 0) + nf.ee, 2);
    // One version, recorded with its reason.
    expect((await svc.statutoryBoard(ceo)).versions).toHaveLength(1);
  });
});

describe('P100 B1: each company prepares its own guard pay run (Fauzan, 11 Nov 2026)', () => {
  it('refuses HR and the OMs; a named preparer prepares and submits their own company only', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const om = await svc.user('u-om-klang');
    const sasaPrep = await prep(svc, 'co-sasa');
    await expect(svc.prepareGuardPay(hr, 'co-sasa', '2026-10', [])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.prepareGuardPay(om, 'co-sasa', '2026-10', [])).rejects.toBeInstanceOf(AccessDenied);
    // Another company's preparer neither prepares nor sees Sasa's month.
    await expect(svc.prepareGuardPay(await prep(svc, 'co-arsh'), 'co-sasa', '2026-10', [])).rejects.toBeInstanceOf(AccessDenied);
    const board = await svc.guardPayroll(sasaPrep);
    expect(board.role).toBe('preparer');
    expect(board.preparing).toEqual(['co-sasa']);
    expect(board.employers.find((e) => e.companyId === 'co-sasa')?.prepares).toBe(true);
    const run = await svc.prepareGuardPay(sasaPrep, 'co-sasa', '2026-10', []);
    expect(run.prepared.byId).toBe('u-ae-sasa');
    expect(run.trial).toBe(true);
    await expect(svc.guardPayRun(await prep(svc, 'co-arsh'), run.id)).rejects.toThrow(/not found/i);
    // HR still sees the run but has no step in it; nor does the company manager.
    const hrView = await svc.guardPayRun(hr, run.id);
    expect(hrView.can.prepare || hrView.can.submit).toBe(false);
    await expect(svc.setGuardPayLine(hr, run.id, run.lines[0].personId, { pcb: 0 })).rejects.toBeInstanceOf(AccessDenied);
    const cm = await svc.guardPayRun(await svc.user('u-cm-sasa'), run.id);
    expect(cm.can.prepare || cm.can.submit || cm.can.approve).toBe(false);
    expect((await svc.guardPayRun(sasaPrep, run.id)).can.prepare).toBe(true);
  });

  it('the Company Manager names and removes preparers with a reason, never themself, an OM, HR or another company', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const other = await svc.user('u-cm-arsh');
    const hr = await svc.user('u-pwvsb-hr');
    const name = (u: Awaited<ReturnType<typeof svc.user>>, userId: string, reason = 'Keeps the site rosters (test)', action = 'name') =>
      svc.payAction(u, 'guard-pay-preparer', { companyId: 'co-sasa', userId, action, reason });
    await expect(name(hr, 'u-ae-sasa-2')).rejects.toBeInstanceOf(AccessDenied);
    await expect(name(other, 'u-ae-sasa-2')).rejects.toBeInstanceOf(AccessDenied);
    await expect(name(await svc.user('u-ae-sasa'), 'u-ae-sasa-2')).rejects.toBeInstanceOf(AccessDenied);
    await expect(name(cm, 'u-ae-sasa-2', 'ok')).rejects.toThrow(/reason/);
    await expect(name(cm, 'u-cm-sasa')).rejects.toThrow(/name someone else/);
    await expect(name(cm, 'u-om-klang')).rejects.toThrow(/cannot prepare/);
    await expect(name(cm, 'u-pwvsb-hr')).rejects.toThrow(/cannot prepare/);
    await expect(name(cm, 'u-ae-arsh')).rejects.toThrow(/cannot prepare/);
    await expect(name(cm, 'u-ae-sasa')).rejects.toThrow(/already prepares/);
    const board0 = await svc.guardPayroll(cm);
    const mine = board0.preparers.find((c) => c.companyId === 'co-sasa')!;
    expect(mine.canName).toBe(true);
    expect(mine.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(['u-ae-sasa-2', 'u-gm-sasa']));
    expect(mine.candidates.some((c) => c.id === 'u-cm-sasa' || c.id === 'u-om-klang' || c.id === 'u-pwvsb-hr')).toBe(false);
    // Another company's manager does not see Sasa's preparers.
    expect((await svc.guardPayroll(other)).preparers.some((c) => c.companyId === 'co-sasa')).toBe(false);
    await name(cm, 'u-ae-sasa-2', 'Second preparer while the first is on leave (test)');
    const second = await svc.user('u-ae-sasa-2');
    expect((await svc.guardPayroll(second)).preparing).toEqual(['co-sasa']);
    await svc.prepareGuardPay(second, 'co-sasa', '2026-10', []);
    // Removed with a reason: the first preparer can no longer prepare; the change is kept.
    await expect(name(cm, 'u-ae-sasa', 'no', 'remove')).rejects.toThrow(/reason/);
    const gone = (await name(cm, 'u-ae-sasa', 'Moved to the front desk (test)', 'remove')) as { active: boolean; removed: { reason: string } };
    expect(gone.active).toBe(false);
    expect(gone.removed.reason).toMatch(/front desk/);
    await expect(svc.prepareGuardPay(await svc.user('u-ae-sasa'), 'co-sasa', '2026-10', [])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.guardPayroll(await svc.user('u-ae-sasa'))).rejects.toBeInstanceOf(AccessDenied);
    // Named again later: the earlier naming and removal stay in the history.
    const back = (await name(cm, 'u-ae-sasa', 'Back from the front desk (test)')) as { history: { what: string }[] };
    expect(back.history.map((h) => h.what)).toEqual(['removed', 'named']);
    expect(ds.audit.filter((a) => a.action === 'guardpay.preparer_named' || a.action === 'guardpay.preparer_removed').length).toBe(3);
  });

  it('the Company Manager sees every run of their company; nobody approves a month they prepared; the COO approves with a reason', async () => {
    const { svc, ds } = fresh();
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const p = await prep(svc, 'co-arsh');
    const run = await svc.prepareGuardPay(p, 'co-arsh', '2026-10', []);
    const cur = await svc.prepareGuardPay(p, 'co-arsh', '2026-11', []);
    const cmBoard = await svc.guardPayroll(await svc.user('u-cm-arsh'));
    expect(cmBoard.runs.map((r) => r.id).sort()).toEqual([run.id, cur.id].sort());
    await svc.guardPayStep(p, run.id, 'submit');
    await expect(svc.guardPayStep(p, run.id, 'approve', { note: 'Approving my own month' })).rejects.toThrow(/COO to approve/);
    const coo = await svc.user('u-coo');
    await expect(svc.guardPayStep(coo, run.id, 'approve', { note: '' })).rejects.toThrow(/reason/);
    const ok = await svc.guardPayStep(coo, run.id, 'approve', { note: 'Checked against JA (test)' });
    expect(ok.stage).toBe('approved');
    expect(ok.trial).toBe(true);
    const run2 = await svc.prepareGuardPay(await prep(svc, 'co-sasa'), 'co-sasa', '2026-10', []);
    const ceoView = await svc.guardPayRun(await svc.user(CEO), run2.id);
    expect(ceoView.can.prepare).toBe(false);
  });
});
