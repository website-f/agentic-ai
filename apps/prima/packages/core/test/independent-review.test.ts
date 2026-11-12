import { afterEach, describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  RULES,
  buildGuardPayLine,
  guardSalaryCalc,
  guardPayTotals,
  generateDataset,
  myt,
  standardGuardAmounts,
  type Attendance,
  type PayFormula,
  type Person,
  type Shift,
} from '../src';
import { closeShortShifts } from './full-shifts';

// Prima's own guard pay run (Fauzan, 5 Nov 2026). Synthetic data only: made-up people, placeholder formula amounts.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = closeShortShifts(generateDataset({ today: TODAY, now: NOW, daysBack: 40 }));
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

describe('independent payroll review regressions', () => {
  afterEach(() => { RULES.guardPayroll.value.primaPays = false; });
  it('counts a worked holiday once in basic pay in both calculator and payroll', () => {
    const calc = guardSalaryCalc(standardGuardAmounts(2), { daysWorked: 25, publicHolidaysWorked: 1 });
    const pay = line(days(26), { holidays: ['2026-10-20'] });
    console.log('HOLIDAY_CALC', JSON.stringify({ calculatorGross: calc.gross, runGross: pay.gross, shortDays: calc.shortDays, runUnpaidDays: pay.unpaidDays }));
    expect(calc.shortDays).toBe(0);
    expect(calc.totalDays).toBe(26);
    expect(pay.unpaidDays).toBe(0);
    expect(pay.gross).toBe(calc.gross);
  });
  it('does not double-count leave which overlaps a public holiday', () => {
    const absent = line(days(24), { holidays: ['2026-10-27'] });
    const overlapping = line(days(24), { holidays: ['2026-10-27'], leaves: [{ id:'l', personId:'p1', companyId:'c1', kind:'ANNUAL', from:'2026-10-27', to:'2026-10-27', days:1, status:'approved' } as never] });
    console.log('HOLIDAY_LEAVE_OVERLAP', JSON.stringify({ withoutOverlapGross: absent.gross, withOverlapGross: overlapping.gross, withoutUnpaid: absent.unpaidDays, withUnpaid: overlapping.unpaidDays }));
    expect(absent.unpaidDays).toBe(1);
    expect(overlapping.unpaidDays).toBe(absent.unpaidDays);
    expect(overlapping.gross).toBe(absent.gross);
    expect(overlapping.paidLeaveDays).toBe(0);
  });
  it('blocks a secondary worked site with no formula', () => {
    const l = line([...days(20,'sA'), ...days(6,'sB',{from:21})], { formulaAt: (id) => id === 'sA' ? { formula: formula(), scope:'Site' } : null });
    console.log('SECOND_SITE', JSON.stringify({ gross:l.gross, noFormula:guardPayTotals([l]).noFormula, flags:l.flags }));
    expect(guardPayTotals([l]).noFormula).toBe(1);
    expect(l.missingFormulaSites).toEqual(['sB']);
    expect(l.holds?.join(' ')).toMatch(/sB/);
  });
  it('never deducts an approved advance that was never paid and is subsequently cancelled', async () => {
    RULES.guardPayroll.value.primaPays = true;
    const ds=closeShortShifts(generateDataset({ today: TODAY, now: NOW, daysBack: 40 }));
    for (const p of ds.people) if (!p.bank) p.bank={ bank:'Synthetic',accountMasked:'****9999' };
    let now = myt('2026-10-19','10:00');
    const svc=new PrimaService(new MemoryStore(ds), () => now);
    const om=await svc.user('u-om-klang'), hr=await svc.user('u-pwvsb-hr'), fin=await svc.user('u-fin-t1-lead'), coo=await svc.user('u-coo');
    const b=await svc.guardAdvances(om,{companyId:'co-arsh'});
    const target=b.choices.guards[0];
    await svc.setGuardAdvances(om,{companyId:'co-arsh',period:'2026-10',basis:'guard',ref:target.id,amount:100,payOn:'2026-10-20',reason:'Synthetic review advance'});
    const a=(await svc.guardAdvances(om,{companyId:'co-arsh',period:'2026-10'})).advances.find(x=>x.personId===target.id)!;
    const approver=await svc.user(a.approverTier==='ogm'?'u-ogm':'u-opsdir');
    await svc.approveGuardAdvances(approver,[a.id],'Synthetic approval');
    now=NOW;
    const run=await svc.prepareGuardPay(await svc.user('u-ae-arsh'),'co-arsh','2026-10');
    const l=run.lines.find(x=>x.personId===target.id)!;
    expect(l.advance).toBe(0);
    expect(l.advanceIds).toEqual([]);
    await svc.guardPayStep(await svc.user('u-ae-arsh'),run.id,'submit');
    await svc.guardPayStep(coo,run.id,'approve',{note:'Synthetic review approval'});
    await svc.changeGuardAdvance(om,a.id,{action:'cancel',reason:'Advance never paid'});
    const paid=await svc.guardPayStep(fin,run.id,'pay',{bankRef:'SYNTHETIC-NO-TRANSFER',paidOn:TODAY,pcbChecked:true});
    const cancelled=(await svc.guardAdvances(om,{companyId:'co-arsh',period:'2026-10'})).advances.find(x=>x.id===a.id)!;
    console.log('UNPAID_CANCELLED_ADVANCE',JSON.stringify({runStage:paid.stage,deducted:paid.lines.find(x=>x.personId===target.id)!.advance,advanceStatus:cancelled.status,advancePaid:cancelled.paid}));
    expect(paid.stage).toBe('paid'); expect(cancelled.status).toBe('cancelled'); expect(cancelled.paid).toBeNull();
    expect(paid.lines.find(x=>x.personId===target.id)!.advance).toBe(0);
  });
  it('blocks more than half gross pay in employer deductions before submission', async () => {
    const {svc,ds}=fresh();
    for (const p of ds.people) if (!p.bank) p.bank={bank:'Synthetic',accountMasked:'****9999'};
    const hr=await svc.user('u-pwvsb-hr'), coo=await svc.user('u-coo');
    const run=await svc.prepareGuardPay(await svc.user('u-ae-arsh'),'co-arsh','2026-10');
    const l=run.lines.find(x=>x.gross>1000)!;
    const deduction=Math.round(l.gross*0.6*100)/100;
    const changed=await svc.setGuardPayLine(await svc.user('u-ae-arsh'),run.id,l.personId,{extra:[{label:'Synthetic approved recovery',amount:-deduction}]});
    expect(changed.otherDeductions).toBeGreaterThan(changed.gross*0.5);
    expect(changed.net).toBeGreaterThan(0);
    await expect(svc.guardPayStep(await svc.user('u-ae-arsh'),run.id,'submit')).rejects.toThrow(/50%/);
    expect((await svc.guardPayRun(coo,run.id)).run.stage).toBe('draft');
  });
});

// Edge and workflow coverage for the independent findings. All payment references are synthetic;
// these tests only record in-memory state and never contact a bank or change activation outside the test.
describe('payroll repair boundaries', () => {
  afterEach(() => { RULES.guardPayroll.value.primaPays = false; });

  it('respects ACT holiday and short-day settings in the calculator without changing day totals', () => {
    const a = standardGuardAmounts(2);
    const holidayOff = guardSalaryCalc(a, { daysWorked: 24, publicHolidaysWorked: 1, holidaysOff: 1 });
    expect(holidayOff.shortDays).toBe(0);
    expect(holidayOff.totalDays).toBe(26);
    const notPaid = guardSalaryCalc({ ...a, holidaysArePaidDays: false }, { daysWorked: 25, publicHolidaysWorked: 1 });
    expect(notPaid.shortDays).toBe(1);
    expect(notPaid.totalDays).toBe(26);
    expect(notPaid.gross).toBe(line(days(26), {
      holidays: ['2026-10-20'],
      formulaAt: () => ({ formula: { ...formula(), amounts: { ...a, holidaysArePaidDays: false } }, scope: 'Group' }),
    }).gross);
    expect(guardSalaryCalc({ ...a, deductShortDays: false }, { daysWorked: 24 }).shortDays).toBe(0);
  });

  it('counts dated leave once across worked days, duplicate leave records and holidays', () => {
    const leave = { id: 'l', companyId: 'c1', personId: 'p1', kind: 'ANNUAL', from: '2026-10-24', to: '2026-10-27', days: 4, status: 'approved' } as const;
    const result = line(days(24), { holidays: ['2026-10-27'], leaves: [leave, { ...leave, id: 'duplicate' }] as never });
    expect(result.paidLeaveDays).toBe(2); // Only 25th and 26th, each once.
    expect(result.unpaidDays).toBe(0);
    expect(result.holds).toEqual([]);
  });

  it('holds ambiguous partial-range and cross-month leave rather than choosing workdays', () => {
    const partial = { id: 'partial', companyId: 'c1', personId: 'p1', kind: 'ANNUAL', from: '2026-10-26', to: '2026-10-28', days: 2, status: 'approved' } as const;
    const overlap = line(days(24), { holidays: ['2026-10-27'], leaves: [partial] as never });
    expect(overlap.holds?.join(' ')).toMatch(/dates are unclear/);
    const split = line(days(24), { leaves: [{ ...partial, from: '2026-10-31', to: '2026-11-02', days: 1 }] as never });
    expect(split.holds?.join(' ')).toMatch(/dates are unclear/);
    const isolated = line(days(24), { leaves: [partial] as never });
    expect(isolated.paidLeaveDays).toBe(2);
    expect(isolated.holds).toEqual([]);
  });

  it('holds contradictory paid/unpaid leave but allows unrelated advisory law flags', () => {
    const leave = { id: 'paid', companyId: 'c1', personId: 'p1', kind: 'ANNUAL', from: '2026-10-26', to: '2026-10-26', days: 1, status: 'approved' } as const;
    const conflict = line(days(24), { leaves: [leave, { ...leave, id: 'unpaid', kind: 'UNPAID' }] as never });
    expect(conflict.holds?.join(' ')).toMatch(/Paid and unpaid leave overlap/);
    const advisory = line(days(26), { formulaAt: () => ({ formula: { ...formula(), lawFlags: ['Existing ACT legal review point'] as never }, scope: 'Site' }) });
    expect(advisory.holds).toEqual([]);
    expect(advisory.flags.join(' ')).toMatch(/labour law flag/);
  });

  it.each(['main_site', 'per_site'] as const)('holds a missing secondary formula under %s policy', (multiSite) => {
    const result = line([...days(20, 'sA'), ...days(6, 'sB', { from: 21 })], {
      formulaAt: (s) => s === 'sA' ? { formula: { ...formula(), amounts: { ...standardGuardAmounts(2), multiSite } }, scope: 'Site' } : null,
    });
    expect(guardPayTotals([result]).noFormula).toBe(1);
    expect(result.holds?.join(' ')).toMatch(/sB/);
    if (multiSite === 'per_site') expect(result.otHours).toBe(50); // Missing six days never inherit sA's rate.
  });

  it('deducts paid advances only, and includes utilities and advances in the existing employer cap', () => {
    const inputs = { advances: [
      { id: 'paid', amount: 100, payOn: '2026-10-20', paid: true },
      { id: 'not-paid', amount: 1000, payOn: '2026-10-20', paid: false },
    ] };
    const paid = line(days(26), inputs);
    expect(paid.advance).toBe(100);
    expect(paid.advanceIds).toEqual(['paid']);
    const cap = paid.gross / 2;
    const equal = line(days(26), { ...inputs, kept: { extra: [{ label: 'Recovery', amount: -(cap - 100) }], pcb: 0 } });
    expect(equal.holds).toEqual([]);
    const excess = line(days(26), { ...inputs, kept: { extra: [{ label: 'Recovery', amount: -(cap - 100) }], pcb: 0 }, utility: [{ id: 'u', personId: 'p1', decision: 'DEDUCTION', payrollMonth: '2026-10', share: 0.01 }] as never });
    expect(excess.holds?.join(' ')).toMatch(/half the wages/);
  });

  it.each(['missing formula', 'ambiguous leave', 'deduction cap', 'legacy snapshot'] as const)('rechecks %s at submit, approval, payment and export', async (problem) => {
    RULES.guardPayroll.value.primaPays = true;
    const { svc, ds } = fresh();
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Synthetic', accountMasked: '****9999' };
    const hr = await svc.user('u-pwvsb-hr'), coo = await svc.user('u-coo'), fin = await svc.user('u-fin-t1-lead');
    const run = await svc.prepareGuardPay(await svc.user('u-ae-arsh'), 'co-arsh', '2026-10');
    const bad = run.lines.find((l) => l.gross > 1000)!;
    const error = problem === 'missing formula' ? /no pay formula/ : problem === 'ambiguous leave' ? /dates are unclear/ : problem === 'deduction cap' ? /50%/ : /recalculate/;
    // Simulate stored submitted/approved snapshots produced before checks or stale stored data.
    if (problem === 'missing formula') bad.missingFormulaSites = ['unconfigured-secondary-site'];
    if (problem === 'ambiguous leave') bad.holds = ['Leave dates are unclear'];
    if (problem === 'deduction cap') { bad.otherDeductions = bad.gross * 0.6; bad.holds = []; }
    if (problem === 'legacy snapshot') delete bad.calculationVersion;
    await expect(svc.guardPayStep(await svc.user('u-ae-arsh'), run.id, 'submit')).rejects.toThrow(error);
    expect(run.stage).toBe('draft');
    run.stage = 'submitted';
    await expect(svc.guardPayStep(coo, run.id, 'approve', { note: 'Synthetic review' })).rejects.toThrow(error);
    expect(run.stage).toBe('submitted');
    run.stage = 'approved';
    await expect(svc.guardPayStep(fin, run.id, 'pay', { bankRef: 'NO-TRANSFER', paidOn: TODAY, pcbChecked: true })).rejects.toThrow(error);
    for (const kind of ['bank', 'ewallet', 'sql', 'epf', 'socso', 'pcb'] as const) await expect(svc.guardPayExport(fin, run.id, kind)).rejects.toThrow(error);
    expect(run.stage).toBe('approved');
    expect(run.paid).toBeNull();
  });

  it('requires recalculation after an advance is paid and refuses another payout after submission', async () => {
    RULES.guardPayroll.value.primaPays = true;
    const ds = closeShortShifts(generateDataset({ today: TODAY, now: NOW, daysBack: 40 }));
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Synthetic', accountMasked: '****9999' };
    let now = myt('2026-10-19', '10:00');
    const svc = new PrimaService(new MemoryStore(ds), () => now);
    const om = await svc.user('u-om-klang'), hr = await svc.user('u-pwvsb-hr'), coo = await svc.user('u-coo'), fin = await svc.user('u-fin-t1-lead');
    const board = await svc.guardAdvances(om, { companyId: 'co-arsh' });
    const chosen = board.choices.guards.slice(0, 2);
    for (const p of chosen) await svc.setGuardAdvances(om, { companyId: 'co-arsh', period: '2026-10', basis: 'guard', ref: p.id, amount: 100, payOn: '2026-10-20', reason: 'Synthetic advance' });
    const advances = (await svc.guardAdvances(om, { companyId: 'co-arsh', period: '2026-10' })).advances;
    for (const a of advances) await svc.approveGuardAdvances(await svc.user(a.approverTier === 'ogm' ? 'u-ogm' : 'u-opsdir'), [a.id], 'Synthetic approval');
    now = NOW;
    const run = await svc.prepareGuardPay(await svc.user('u-ae-arsh'), 'co-arsh', '2026-10');
    expect(run.lines.find((l) => l.personId === advances[0].personId)?.advance).toBe(0);
    await expect(svc.payGuardAdvance(fin, advances[0].id, { bankRef: 'NO-TRANSFER', paidOn: TODAY })).rejects.toThrow(/within the advance month/);
    await svc.payGuardAdvance(fin, advances[0].id, { bankRef: 'NO-TRANSFER', paidOn: '2026-10-20' });
    await expect(svc.guardPayStep(await svc.user('u-ae-arsh'), run.id, 'submit')).rejects.toThrow(/Paid advances have changed/);
    const recalculated = await svc.prepareGuardPay(await svc.user('u-ae-arsh'), 'co-arsh', '2026-10');
    expect(recalculated.lines.find((l) => l.personId === advances[0].personId)?.advance).toBe(100);
    await svc.guardPayStep(await svc.user('u-ae-arsh'), run.id, 'submit');
    await expect(svc.payGuardAdvance(fin, advances[1].id, { bankRef: 'NO-TRANSFER', paidOn: '2026-10-20' })).rejects.toThrow(/already submitted or paid/);
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Synthetic approval' });
    const paid = await svc.guardPayStep(fin, run.id, 'pay', { bankRef: 'NO-TRANSFER', paidOn: TODAY, pcbChecked: true });
    expect(paid.stage).toBe('paid');
    expect(paid.lines.find((l) => l.personId === advances[0].personId)?.advance).toBe(100);
    await expect(svc.payGuardAdvance(fin, advances[1].id, { bankRef: 'NO-TRANSFER', paidOn: '2026-10-20' })).rejects.toThrow(/already submitted or paid/);
  });
});

describe('stale advance recovery snapshots', () => {
  afterEach(() => { RULES.guardPayroll.value.primaPays = false; });
  it.each(['approve', 'pay', 'export'] as const)('rejects a nonexistent or cancelled recovery at %s without changing the run', async (boundary) => {
    RULES.guardPayroll.value.primaPays = true;
    const { svc, ds } = fresh();
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Synthetic', accountMasked: '****9999' };
    const hr = await svc.user('u-pwvsb-hr'), coo = await svc.user('u-coo'), fin = await svc.user('u-fin-t1-lead');
    const run = await svc.prepareGuardPay(await svc.user('u-ae-arsh'), 'co-arsh', '2026-10');
    const l = run.lines.find((x) => x.gross > 1000)!;
    l.advance = 100;
    l.advanceIds = ['cancelled-or-removed-advance'];
    run.stage = boundary === 'approve' ? 'submitted' : 'approved';
    const stage = run.stage;
    const action = boundary === 'approve'
      ? svc.guardPayStep(coo, run.id, 'approve', { note: 'Synthetic approval' })
      : boundary === 'pay'
        ? svc.guardPayStep(fin, run.id, 'pay', { bankRef: 'NO-TRANSFER', paidOn: TODAY, pcbChecked: true })
        : svc.guardPayExport(fin, run.id, 'bank');
    await expect(action).rejects.toThrow(/Paid advances have changed/);
    expect(run.stage).toBe(stage);
    expect(run.paid).toBeNull();
  });
});
