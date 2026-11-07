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

describe('guard pay run: HR prepares, the COO approves, Finance pays', () => {
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
    await expect(svc.prepareGuardPay(hr, 'co-sasa', '2026-10', [{ date: '2026-10-20', label: 'x' }])).rejects.toThrow(/Operations Director or the OGM/);
    // A company with no yearly list: HR's dates must be real dates in the month.
    await expect(svc.prepareGuardPay(hr, 'co-arsh', '2026-10', [{ date: '2026-11-01', label: 'x' }])).rejects.toThrow(/in 2026-10/);
    await expect(svc.prepareGuardPay(hr, 'co-sasa', '2026-09')).rejects.toThrow(/last month/);
    const run = await svc.prepareGuardPay(hr, 'co-sasa', '2026-10');
    expect(run.holidaySource).toBe('yearly');
    expect(run.trial).toBe(true);
    expect(run.lines.length).toBeGreaterThan(250);
    expect(run.lines.filter((l) => l.daysWorked).every((l) => l.formulaCode)).toBe(true);
    // The seeded example site uses the 3-hour rest formula (PR #112).
    expect(run.lines.some((l) => l.formulaCode === 'STD-12H-R3')).toBe(true);
    expect(run.lines.some((l) => l.holidaysWorked > 0)).toBe(true);
    // A few guards have no salary account: HR cannot submit until fixed.
    await expect(svc.guardPayStep(hr, run.id, 'submit')).rejects.toThrow(/cannot be paid/);
    const store = (svc as unknown as { store: MemoryStore }).store;
    for (const l of run.lines.filter((x) => !x.bank)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    await svc.prepareGuardPay(hr, 'co-sasa', '2026-10');
    expect((await svc.guardPayRun(hr, run.id)).run.lines.some((l) => l.holidayDates?.includes('2026-10-20'))).toBe(true);
    // HR cannot approve, the COO cannot approve a draft.
    await expect(svc.guardPayStep(coo, run.id, 'approve', { note: 'ok' })).rejects.toThrow(/HR to submit/);
    await svc.guardPayStep(hr, run.id, 'submit');
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

  it('once Prima pays guards, Finance marks paid and the guard sees the payslip', async () => {
    RULES.guardPayroll.value.primaPays = true;
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    const guard = await svc.user('u-guard-sasa-1');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const run = await svc.prepareGuardPay(hr, 'co-sasa', '2026-10', []);
    expect(run.trial).toBe(false);
    await svc.guardPayStep(hr, run.id, 'submit');
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
    const cur = await svc.prepareGuardPay(hr, 'co-inas', '2026-11', []);
    await expect(svc.guardPayStep(hr, cur.id, 'submit')).rejects.toThrow(/not over/);
    const store = (svc as unknown as { store: MemoryStore }).store;
    const run = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10', []);
    for (const l of run.lines.filter((x) => !x.bank)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    await svc.prepareGuardPay(hr, 'co-arsh', '2026-10');
    await svc.guardPayStep(hr, run.id, 'submit');
    await expect(svc.prepareGuardPay(hr, 'co-arsh', '2026-10')).rejects.toThrow(/already submitted/);
    await expect(svc.guardPayStep(coo, run.id, 'return')).rejects.toThrow(/change/);
    const back = await svc.guardPayStep(coo, run.id, 'return', { note: 'Recheck the rest days' });
    expect(back.stage).toBe('draft');
    expect(back.returns).toHaveLength(1);
    // A one-off item needs a reason and is flagged for the COO.
    const pid = back.lines[0].personId;
    await expect(svc.setGuardPayLine(hr, run.id, pid, { extra: [{ label: '', amount: 50 }] })).rejects.toThrow(/reason/);
    // No salary deduction for uniforms (any set) or for lost or damaged items: Kertas Pelaksanaan Prima Uniform dan
    // Peralatan (6 Nov 2026), which replaces the earlier 4th or 5th uniform deduction.
    await expect(svc.setGuardPayLine(hr, run.id, pid, { extra: [{ label: 'Uniform deduction (test)', amount: -20 }] })).rejects.toThrow(/never deducted/);
    await expect(svc.setGuardPayLine(hr, run.id, pid, { extra: [{ label: 'Uniform', amount: -20, uniformNo: 2 }] })).rejects.toThrow(/never deducted/);
    await expect(svc.setGuardPayLine(hr, run.id, pid, { extra: [{ label: 'Uniform set (test)', amount: -20, uniformNo: 4 }] })).rejects.toThrow(/never deducted/);
    await expect(svc.setGuardPayLine(hr, run.id, pid, { extra: [{ label: 'Lost radio', amount: -50 }] })).rejects.toThrow(/never deducted/);
    await expect(svc.setGuardPayLine(hr, run.id, pid, { extra: [{ label: 'Damaged item (test)', amount: -30 }] })).rejects.toThrow(/never deducted/);
    // Another one-off deduction still goes through, flagged for the COO.
    const l = await svc.setGuardPayLine(hr, run.id, pid, { extra: [{ label: 'Overpayment last month (test)', amount: -20 }] });
    expect(l.items.some((x) => x.kind === 'extra' && x.amount === -20)).toBe(true);
    expect(l.flags.join(' ')).toMatch(/COO checks/);
  });

  it('keeps everyone else out, on the direct calls too', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const run = await svc.prepareGuardPay(hr, 'co-sasa', '2026-10', []);
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

  it('keeps nil lines out of the bank file and its control total; HR is not asked to act on an open month', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const idle = ds.people.find((p) => p.companyId === 'co-inas' && p.role === 'guard' && p.status === 'active')!;
    ds.attendance = ds.attendance.filter((a) => a.personId !== idle.id);
    await svc.prepareGuardPay(hr, 'co-inas', '2026-11', []);
    expect((await svc.guardPayroll(hr)).runs.find((r) => r.period === '2026-11')?.mineToAct).toBe(false);
    const run = await svc.prepareGuardPay(hr, 'co-inas', '2026-10', []);
    const nil = run.lines.find((l) => l.personId === idle.id)!;
    expect(nil.net).toBe(0);
    await svc.guardPayStep(hr, run.id, 'submit');
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
    const ded = line(days(26), { kept: { extra: [{ label: 'Overpayment correction (test)', amount: -50 }], pcb: null } });
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
    const run0 = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10', []);
    for (const l of run0.lines.filter((x) => !x.bank)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    const paid = run0.lines.find((l) => l.net > 0)!;
    const p = ds.people.find((x) => x.id === paid.personId)!;
    await store.update('people', p.id, { bank: { bank: 'Test Bank', accountMasked: '****1111', holder: 'relative', holderName: 'Test Sibling', relationship: 'brother' } });
    const run = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10');
    const line = run.lines.find((l) => l.personId === p.id)!;
    expect(line.accountProblem).toMatch(/no written consent/);
    await expect(svc.guardPayStep(hr, run.id, 'submit')).rejects.toThrow(/cannot be paid/);
    // Consent needs the form reference and the date signed.
    await expect(svc.recordPayConsent(hr, p.id, { holder: 'relative', holderName: 'Test Sibling', relationship: 'brother' })).rejects.toThrow(/consent form/);
    await expect(svc.recordPayConsent(await svc.user('u-cm-arsh'), p.id, { holder: 'own' })).rejects.toBeInstanceOf(AccessDenied);
    const letter = { holder: 'relative', holderName: 'Test Sibling', relationship: 'brother', docRef: 'CONSENT-T1', signedOn: '2026-10-01' };
    // The letter needs a Commissioner for Oaths stamp, then the COO's approval, before the account can be used.
    await expect(svc.recordPayConsent(hr, p.id, letter)).rejects.toThrow(/Commissioner for Oaths/);
    await svc.recordPayConsent(hr, p.id, { ...letter, commissioner: 'Test Commissioner', stampRef: 'PS-T-1', stampedOn: '2026-10-02' });
    const waiting = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10');
    expect(waiting.lines.find((l) => l.personId === p.id)!.accountProblem).toMatch(/waiting for the COO/);
    const coo = await svc.user('u-coo');
    expect((await svc.payConsentsWaiting(coo)).some((c) => c.personId === p.id && c.canApprove)).toBe(true);
    await expect(svc.approvePayConsent(hr, p.id, 'okay')).rejects.toBeInstanceOf(AccessDenied);
    // The COO approves; the CEO may stand in only through the pilot rule (Fauzan's review note 7 Nov 2026, item 2).
    const ceo = await svc.user('u-fauzan');
    expect((await svc.payConsentsWaiting(ceo)).some((c) => c.personId === p.id && c.canApprove)).toBe(RULES.pilot.value.on);
    await expect(svc.approvePayConsent(await svc.user('u-cos'), p.id, 'okay')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.approvePayConsent(coo, p.id, '')).rejects.toThrow(/reason/);
    await svc.approvePayConsent(coo, p.id, 'Letter stamped and checked');
    const again = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10');
    const l2 = again.lines.find((l) => l.personId === p.id)!;
    expect(l2.accountProblem).toBeNull();
    expect(l2.flags.join(' ')).toMatch(/EA s.25/);
    await svc.guardPayStep(hr, run.id, 'submit');
  });

  it('pays an e-wallet in its own file and cash only when the COO or CEO gives it, listed by the Director Office', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const fin = await svc.user('u-fin-t1-lead');
    const doa = await svc.user('u-pwvsb-doa');
    const store = (svc as unknown as { store: MemoryStore }).store;
    const run = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10', []);
    const noAcc = run.lines.filter((l) => !l.bank && l.net > 0);
    for (const l of noAcc.slice(1)) await store.update('people', l.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    const withPay = run.lines.filter((l) => l.bank && l.net > 0);
    const wallet = withPay[0];
    await store.update('people', wallet.personId, { bank: { bank: 'Test eWallet', accountMasked: '****2222', kind: 'ewallet' } });
    // One guard without an account: HR cannot submit until the Director Office lists them for cash.
    const cashGuard = noAcc[0] ?? withPay[1];
    if (!noAcc[0]) await store.update('people', cashGuard.personId, { bank: null });
    await svc.prepareGuardPay(hr, 'co-arsh', '2026-10');
    await expect(svc.guardPayStep(hr, run.id, 'submit')).rejects.toThrow(/cannot be paid/);
    await expect(svc.guardPayCash(hr, run.id, cashGuard.personId, 'list', { reason: 'No bank account yet' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.guardPayCash(doa, run.id, cashGuard.personId, 'list', { reason: '' })).rejects.toThrow(/why/);
    await svc.guardPayCash(doa, run.id, cashGuard.personId, 'list', { reason: 'Bank account not opened yet (test)' });
    await svc.guardPayStep(hr, run.id, 'submit');
    // The COO cannot approve the month while a cash listing waits; HR and Finance cannot decide it.
    await expect(svc.guardPayStep(coo, run.id, 'approve', { note: 'okay' })).rejects.toThrow(/listed for cash/);
    await expect(svc.guardPayCash(fin, run.id, cashGuard.personId, 'decide', { reason: 'ok', give: true })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.guardPayCash(coo, run.id, cashGuard.personId, 'decide', { give: true })).rejects.toThrow(/reason/);
    await svc.guardPayCash(coo, run.id, cashGuard.personId, 'decide', { reason: 'Give cash this month only', give: true });
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Checked' });
    const view = await svc.guardPayRun(fin, run.id);
    expect(view.pay.cash.count).toBe(1);
    expect(view.pay.ewallet.count).toBe(1);
    const bank = await svc.guardPayExport(fin, run.id, 'bank');
    expect(bank.body).not.toContain(cashGuard.staffNo + ',');
    expect(bank.body).not.toContain('****2222');
    const ew = await svc.guardPayExport(fin, run.id, 'ewallet');
    expect(ew.body).toContain('****2222');
    const cash = await svc.guardPayExport(doa, run.id, 'cash');
    expect(cash.body).toContain(cashGuard.staffNo);
    await expect(svc.guardPayExport(doa, run.id, 'bank')).rejects.toThrow();
    expect(ds.audit.some((a) => a.action === 'guardpay.cash.decide')).toBe(true);
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
    const run = await svc.prepareGuardPay(hr, companyId, '2026-11');
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

  it('cash list is per site with name and amount; the COO or CEO hands it out; the Director Office uploads the signed receipt', async () => {
    RULES.guardPayroll.value.primaPays = true;
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const doa = await svc.user('u-pwvsb-doa');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const run0 = await svc.prepareGuardPay(hr, 'co-sasa', '2026-10', []);
    const g = run0.lines.find((l) => l.net > 0)!;
    ds.people.find((x) => x.id === g.personId)!.bank = null;
    const run = await svc.prepareGuardPay(hr, 'co-sasa', '2026-10');
    const listed = await svc.guardPayCash(doa, run.id, g.personId, 'list', { reason: 'No bank account yet (test)' });
    const entry = listed.find((c) => c.personId === g.personId)!;
    expect(entry.siteName).toBe(g.mainSiteName);
    expect(entry.amount).toBe(run.lines.find((l) => l.personId === g.personId)!.net);
    await svc.guardPayCash(coo, run.id, g.personId, 'decide', { reason: 'Give cash this month', give: true });
    // Not before the month is approved, and the receipt not before the hand-out.
    await expect(svc.guardPayCash(coo, run.id, g.personId, 'handout', {})).rejects.toBeInstanceOf(AccessDenied);
    await svc.guardPayStep(hr, run.id, 'submit');
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Approved' });
    await expect(svc.guardPayCash(doa, run.id, g.personId, 'receipt', { proof: [{ kind: 'document', name: 'receipt.pdf', data: PDF, caption: '' }] })).rejects.toThrow(/handed out first/);
    await expect(svc.guardPayCash(doa, run.id, g.personId, 'handout', {})).rejects.toBeInstanceOf(AccessDenied);
    await svc.guardPayCash(coo, run.id, g.personId, 'handout', { on: '2026-11-05' });
    await expect(svc.guardPayCash(hr, run.id, g.personId, 'receipt', { proof: [{ kind: 'document', name: 'receipt.pdf', data: PDF, caption: '' }] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.guardPayCash(doa, run.id, g.personId, 'receipt', { proof: [] })).rejects.toThrow(/signed receipt/);
    const after = await svc.guardPayCash(doa, run.id, g.personId, 'receipt', { proof: [{ kind: 'document', name: 'receipt.pdf', data: PDF, caption: '' }] });
    expect(after.find((c) => c.personId === g.personId)!.receipt?.uploadedBy).toBe(doa.name);
    expect(ds.evidenceDocs.some((d) => d.guardPayRunId === run.id)).toBe(true);
    const view = await svc.guardPayRun(doa, run.id);
    expect(view.pay.cashBySite.length).toBe(1);
    expect(view.pay.cashReceipts).toBe(1);
    const file = await svc.guardPayExport(doa, run.id, 'cash');
    expect(file.body.split('\n').some((r) => r.startsWith('Site,'))).toBe(true);
    expect(file.body).toContain('Uploaded: receipt.pdf');
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
    const run = await svc.prepareGuardPay(hr, 'co-sasa', '2026-10', []);
    await expect(svc.setGuardPayLine(hr, run.id, guardId, { extra: [{ label: 'Loan repayment', amount: -50 }] })).rejects.toThrow(/approved record/);
    const line = run.lines.find((l) => l.personId === guardId)!;
    const taken = line.loan ?? 0;
    expect(taken).toBeLessThanOrEqual(100);
    if (line.gross >= 200) expect(taken).toBe(100);
    expect(taken).toBeLessThanOrEqual(line.gross * 0.5);
    // A paid month takes the repayment off the record.
    await svc.guardPayStep(hr, run.id, 'submit');
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
    const withOther = line(days(26), { kept: { extra: [{ label: 'Overpayment correction (test)', amount: -100 }], pcb: 0 }, loans: [{ id: 'gl-1', label: 'Loan', due: 5000 }] });
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
    const before = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10', []);
    const pick = before.lines.find((l) => l.nationality === 'MY' && l.gross > 0 && l.age < 60)!;
    const settings = { ...board.inForce, epf: { ...board.inForce.epf, eeRate: 0.09 }, others: [{ code: 'NEWFUND', name: 'New fund (test)', eeRate: 0.01, erRate: 0.02, wageCap: 3000, includeOt: false, appliesTo: 'all' as const, maxAge: null, payee: 'Test agency' }], lawRef: 'Test gazette 2026' };
    await expect(svc.setStatutory(hr, { effectiveFrom: '2026-10', settings, reason: 'Test change' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setStatutory(ceo, { effectiveFrom: '2026-10', settings, reason: '' })).rejects.toThrow(/why/);
    await expect(svc.setStatutory(ceo, { effectiveFrom: '2026-10', settings: { ...settings, epf: { ...settings.epf, eeRate: 0.9 } }, reason: 'Test change' })).rejects.toThrow(/EPF/);
    await svc.setStatutory(ceo, { effectiveFrom: '2026-10', settings, reason: 'New law from October (test)' });
    const after = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10');
    const l = after.lines.find((x) => x.personId === pick.personId)!;
    expect(l.epfEe).toBeLessThan(pick.epfEe);
    const nf = l.others!.find((o) => o.code === 'NEWFUND')!;
    expect(nf.er).toBeGreaterThan(0);
    // The journal still balances with the new contribution.
    const hrRun = after;
    const store = (svc as unknown as { store: MemoryStore }).store;
    for (const x of hrRun.lines) if (x.accountProblem) await store.update('people', x.personId, { bank: { bank: 'Test Bank', accountMasked: '****9999' } });
    await svc.prepareGuardPay(hr, 'co-arsh', '2026-10');
    await svc.guardPayStep(hr, hrRun.id, 'submit');
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
