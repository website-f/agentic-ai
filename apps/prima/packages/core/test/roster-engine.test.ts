// Part O guard roster, breaks and hybrid pay engine (Fauzan, 13 Nov 2026) and the v3 roster/pay pack (14 Nov 2026).
// Synthetic ids only (G-001, SITE-A ...); the IKEA and school figures are the drafts' example settings, not live values.
import { describe, expect, it } from 'vitest';
import {
  allowanceLines,
  allowanceLostDays,
  breakPlanProblems,
  checkRoster,
  evidenceCovers,
  hybridPay,
  hybridSettingsCheck,
  ledgerTotals,
  lumpSumConsentProblem,
  monthDates,
  ordinaryOtRate,
  requiredCoverage,
  rosterExceptions,
  rosterStepProblem,
  workedMinutes,
  type ComplianceEvidence,
  type GuardAllowance,
  type HybridSettings,
  type LumpSumAgreement,
  type RosterDay,
  type RosterPerson,
  type RosterStatus,
  type RosterVersion,
  type SiteCoverage,
} from '../src';

const IKEA: HybridSettings = {
  basicMonthly: 1700,
  normalHoursPerDay: 9,
  workDaysPerWeek: 5,
  otNormalRate: 1.5,
  otRestDayRate: 2,
  otPublicHolidayRate: 3,
  restDayDays: 1,
  publicHolidayDays: 2,
  otRateBase: 'fixed',
  otFixedBase: 8.72,
  otRateRounding: 'rate_to_sen_first',
  restDayExtraTreatment: 'same_as_rest_day',
  restDayNormalRateBase: 'fixed',
  restDayOtMultiplier: 2,
  normalWorkingDaysPerMonth: 22,
  incompleteMonthMethod: 'working_days',
};
const SCHOOL: HybridSettings = { ...IKEA, normalHoursPerDay: 7.5, workDaysPerWeek: 6, normalWorkingDaysPerMonth: 26 };

/** A month for one guard: `work` duties of `minutes` on the first dates, the rest OFF (every 7th date OFF-REST). */
function month(m: string, work: number, minutes: number, opts: { upl?: number; restDuty?: boolean } = {}) {
  const dates = monthDates(m);
  const days = dates.map((date, k) => {
    const planned: RosterStatus = k < work ? 'WORK_D' : k < work + (opts.upl ?? 0) ? 'UPL' : k % 7 === 0 ? 'OFF_REST' : 'OFF_ADD';
    return { date, planned, actual: null };
  });
  const duties = days.filter((d) => d.planned === 'WORK_D').map((d) => ({ date: d.date, siteId: 'SITE-A', planned: d.planned, workedMinutes: minutes, publicHoliday: false }));
  return { days, duties };
}
const pay = (s: HybridSettings, m: string, work: number, minutes: number, extra: Partial<Parameters<typeof hybridPay>[0]> = {}, opts: { upl?: number } = {}) => {
  const { days, duties } = month(m, work, minutes, opts);
  return hybridPay({ month: m, mode: 'roster_hybrid', settings: s, days, duties, absDecidedUnpaid: [], joinedOn: '2020-01-01', leftOn: null, ...extra });
};

describe('O7 overtime rate: the higher of the company and statutory rate', () => {
  it('IKEA 5 x 9 h: RM13.08 against statutory RM10.90, uses RM13.08', () => {
    const r = ordinaryOtRate(IKEA);
    expect(r.rate).toBe(13.08);
    expect(r.statutory).toBe(10.9);
    expect(r.used).toBe('company');
  });
  it('school 6 x 7.5 h: statutory 13.08 too, so RM13.08', () => {
    expect(ordinaryOtRate(SCHOOL).rate).toBe(13.08);
  });
  it('a divisor under 26 is a law flag, never a refusal; settings below the law are refused', () => {
    const c = hybridSettingsCheck(IKEA, 'roster_hybrid');
    expect(c.refuse).toEqual([]);
    expect(c.flags.join(' ')).toMatch(/under 26/);
    expect(hybridSettingsCheck({ ...IKEA, restDayOtMultiplier: 1.5 }, 'roster_hybrid').refuse.join(' ')).toMatch(/at least 2/);
    expect(hybridSettingsCheck({ ...IKEA, hourlyRate: 7 }, 'hourly').refuse.join(' ')).toMatch(/8\.72/);
  });
});

describe('O8 roster_hybrid pay (Part O CHECKs, v3 UAT-02/03/09/12)', () => {
  it('22 verified 12 h duties: 1,700 + 66 h x 13.08 = 2,563.28', () => {
    const r = pay(IKEA, '2026-11', 22, 720);
    expect(r.otMinutes).toBe(66 * 60);
    expect(r.gross).toBe(2563.28);
  });
  it('20 / 21 / 23 duties: 2,484.80 / 2,524.04 / 2,602.52', () => {
    expect(pay(IKEA, '2026-11', 20, 720).gross).toBe(2484.8);
    expect(pay(IKEA, '2026-11', 21, 720).gross).toBe(2524.04);
    expect(pay(IKEA, '2026-11', 23, 720).gross).toBe(2602.52);
  });
  it('21 duties + 10 OFF in October: no deduction, OFF days shown as not absence (October error 1)', () => {
    const r = pay(IKEA, '2026-10', 21, 720);
    expect(r.items.find((x) => x.kind === 'unpaid')).toBeUndefined();
    expect(r.items.find((x) => x.kind === 'basic')!.amount).toBe(1700);
    expect(r.flags).toContain('OFF days: 10 (not absence)');
    expect(r.items.find((x) => x.kind === 'rest_day')).toBeUndefined();
  });
  it('1 unpaid day in November at the site divisor: IKEA 22 -> 1,622.73; 24 -> 1,629.17; 26 -> 1,634.62', () => {
    const basicAfter = (n: number) => {
      const r = pay({ ...IKEA, normalWorkingDaysPerMonth: n }, '2026-11', 21, 540, {}, { upl: 1 });
      return 1700 + (r.items.find((x) => x.kind === 'unpaid')?.amount ?? 0);
    };
    expect(basicAfter(22)).toBeCloseTo(1622.73, 2);
    expect(basicAfter(24)).toBeCloseTo(1629.17, 2);
    expect(basicAfter(26)).toBeCloseTo(1634.62, 2);
    expect(pay(IKEA, '2026-11', 21, 540, {}, { upl: 1 }).flags.join(' ')).toMatch(/law flag for the CEO/);
  });
  it('s.18A calendar days stays a second choice: 1 unpaid day in November = 1,643.33', () => {
    const r = pay({ ...IKEA, incompleteMonthMethod: 's18A_calendar' }, '2026-11', 21, 540, {}, { upl: 1 });
    expect(1700 + r.items.find((x) => x.kind === 'unpaid')!.amount).toBeCloseTo(1643.33, 2);
  });
  it('a 10 h 30 min duty has 1.5 h overtime, not 3 h', () => {
    const r = pay(IKEA, '2026-11', 1, 630);
    expect(r.otMinutes).toBe(90);
  });
  it('school 26 duties of 10 h: 2,550.20; 27 duties: 2,582.90, and the 27th is not rest-day work (October error 2)', () => {
    expect(pay(SCHOOL, '2026-12', 26, 600).gross).toBe(2550.2);
    const r = pay(SCHOOL, '2026-12', 27, 600);
    expect(r.gross).toBe(2582.9);
    expect(r.items.find((x) => x.kind === 'rest_day')).toBeUndefined();
  });
  it('a duty on an OFF day is rest-day work: IKEA 12 h = RM130.80 extra; school 10 h = RM109.00; no ordinary OT on it', () => {
    const run = (s: HybridSettings, minutes: number, status: RosterStatus) =>
      hybridPay({ month: '2026-11', mode: 'roster_hybrid', settings: s, days: [{ date: '2026-11-07', planned: status, actual: null }], duties: [{ date: '2026-11-07', siteId: 'SITE-A', planned: status, workedMinutes: minutes, publicHoliday: false }], absDecidedUnpaid: [], joinedOn: '2020-01-01', leftOn: null });
    const ikea = run(IKEA, 720, 'OFF_REST');
    // The day's pay and its overtime are separate items (EPF never counts overtime); together the same RM130.80.
    const restTotal = (r0) => r0.items.filter((x) => x.kind === 'rest_day' || x.label === 'Rest-day overtime').reduce((n, x) => n + x.amount, 0);
    expect(restTotal(ikea)).toBeCloseTo(130.8, 2);
    expect(ikea.items.find((x) => x.label === 'Rest-day overtime')!.kind).toBe('ot');
    expect(ikea.otMinutes).toBe(0);
    expect(restTotal(run(IKEA, 720, 'OFF_ADD'))).toBeCloseTo(130.8, 2);
    expect(restTotal(run(SCHOOL, 600, 'OFF_REST'))).toBeCloseTo(109, 2);
    // With the statutory base only, the statutory amount (about RM108.97) is paid.
    expect(restTotal(run({ ...IKEA, restDayNormalRateBase: 'statutory' }, 720, 'OFF_REST'))).toBeCloseTo(108.97, 2);
  });
  it('a public holiday worked is 2 extra days + 3x for hours above normal, never ordinary OT', () => {
    const r = hybridPay({ month: '2026-11', mode: 'roster_hybrid', settings: IKEA, days: [{ date: '2026-11-08', planned: 'WORK_D', actual: null }], duties: [{ date: '2026-11-08', siteId: 'SITE-A', planned: 'WORK_D', workedMinutes: 720, publicHoliday: true }], absDecidedUnpaid: [], joinedOn: '2020-01-01', leftOn: null });
    expect(r.otMinutes).toBe(0);
    expect(r.items.find((x) => x.kind === 'holiday')!.amount).toBeCloseTo((1700 / 26) * 2, 2);
    expect(r.items.find((x) => x.label === 'Public holiday overtime')!).toMatchObject({ kind: 'ot' });
    expect(r.items.find((x) => x.label === 'Public holiday overtime')!.amount).toBeCloseTo(3 * (1700 / 26 / 9) * 3, 2);
  });
  it('unverified duties wait (not paid yet) and ABS waits for the OD/OGM; verified wages are never held', () => {
    const { days, duties } = month('2026-11', 22, 720);
    duties[0].workedMinutes = null as never;
    days[25].planned = 'ABS';
    const r = hybridPay({ month: '2026-11', mode: 'roster_hybrid', settings: IKEA, days, duties, absDecidedUnpaid: [], joinedOn: '2020-01-01', leftOn: null });
    expect(r.unverified).toEqual(['2026-11-01']);
    expect(r.absPending).toEqual([days[25].date]);
    expect(r.gross).toBe(2524.04);
    const decided = hybridPay({ month: '2026-11', mode: 'roster_hybrid', settings: IKEA, days, duties, absDecidedUnpaid: [days[25].date], joinedOn: '2020-01-01', leftOn: null });
    expect(decided.unpaidDays).toBe(1);
  });
  it('paid annual leave never reduces basic or makes overtime (UAT-10)', () => {
    const { days, duties } = month('2026-11', 20, 720);
    days[21].planned = 'AL';
    const r = hybridPay({ month: '2026-11', mode: 'roster_hybrid', settings: IKEA, days, duties, absDecidedUnpaid: [], joinedOn: '2020-01-01', leftOn: null });
    expect(r.items.find((x) => x.kind === 'unpaid')).toBeUndefined();
    expect(r.otMinutes).toBe(20 * 180);
  });
  it('a guard joining mid-month is paid the working days employed at basic / site days', () => {
    const r = pay(IKEA, '2026-11', 22, 540, { joinedOn: '2026-11-21' });
    // Dates 21-30 November: 2 WORK dates (21, 22) and 8 OFF dates in this synthetic month -> 2 working days employed.
    expect(r.method).toMatch(/Part month: 2 normal working day/);
    expect(1700 + r.items.find((x) => x.kind === 'unpaid')!.amount).toBeCloseTo((2 * 1700) / 22, 2);
  });
  it('true hourly guard: hours x rate + OT at 1.5x (v3 hourly profile)', () => {
    const r = hybridPay({ month: '2026-11', mode: 'hourly', settings: { ...SCHOOL, hourlyRate: 8.72 }, ...month('2026-11', 2, 600), absDecidedUnpaid: [], joinedOn: '2020-01-01', leftOn: null });
    expect(r.items.find((x) => x.kind === 'hourly')!.amount).toBeCloseTo(15 * 8.72, 2);
    expect(r.items.find((x) => x.kind === 'ot')!.amount).toBeCloseTo(5 * 13.08, 2);
  });
});

describe('Lump-sum agreement (v3 section 7, UAT-17..21)', () => {
  const agreement = (target: number): LumpSumAgreement => ({
    id: 'LS-1',
    personId: 'G-001',
    siteId: 'SITE-A',
    target,
    from: '2026-12',
    to: null,
    language: 'ms',
    consent: { signedAt: '2026-11-20T10:00:00+08:00', method: 'in_app', documentHash: 'a'.repeat(64), witnessId: null },
    proposedById: 'U-HR-1',
    approvedById: 'U-COO-1',
    withdrawnAt: null,
    status: 'signed',
  });
  it('target 2,300 against 2,550.20 due: shortfall 250.20 flagged, the full 2,550.20 is paid', () => {
    const r = pay(SCHOOL, '2026-12', 26, 600, { lumpSum: agreement(2300) });
    expect(r.lumpSum).toEqual({ target: 2300, topUp: 0, shortfall: 250.2 });
    expect(r.gross).toBe(2550.2);
    expect(r.flags.join(' ')).toMatch(/never waives/);
  });
  it('target 2,800: a separate top-up of 249.80', () => {
    const r = pay(SCHOOL, '2026-12', 26, 600, { lumpSum: agreement(2800) });
    expect(r.lumpSum!.topUp).toBe(249.8);
    expect(r.items.find((x) => x.kind === 'topup')!.amount).toBe(249.8);
    expect(r.gross).toBe(2800);
  });
  it('a refused, unsigned or withdrawn agreement pays the normal wages (UAT-19)', () => {
    for (const a of [{ ...agreement(2800), status: 'refused' as const }, { ...agreement(2800), consent: null }, { ...agreement(2800), withdrawnAt: '2026-11-30T00:00:00Z' }]) expect(pay(SCHOOL, '2026-12', 26, 600, { lumpSum: a }).gross).toBe(2550.2);
  });
  it('consent: only the guard, no reuse, no backdating (UAT-20)', () => {
    const proposed = { ...agreement(2300), status: 'proposed' as const, consent: null };
    const base = { signedAt: '2026-11-20T10:00:00+08:00', proposedAt: '2026-11-19T10:00:00+08:00', now: '2026-11-20T10:01:00+08:00', documentHash: 'b'.repeat(64), usedHashes: [], byPersonId: 'G-001' };
    expect(lumpSumConsentProblem(proposed, base)).toBeNull();
    expect(lumpSumConsentProblem(proposed, { ...base, byPersonId: 'U-HR-1' })).toMatch(/Only the guard/);
    expect(lumpSumConsentProblem(proposed, { ...base, usedHashes: ['b'.repeat(64)] })).toMatch(/already used/);
    expect(lumpSumConsentProblem(proposed, { ...base, signedAt: '2026-11-18T10:00:00+08:00' })).toMatch(/before the proposal/);
    expect(lumpSumConsentProblem(proposed, { ...base, signedAt: '2026-11-19T12:00:00+08:00' })).toMatch(/no backdating/);
  });
});

describe('O6 breaks (D4 T02-T06, D5 T05-T08, v3 UAT-04/05/06/27)', () => {
  const plan = { minutesPerShift: 120, maxSegmentMinutes: 60, paid: false, permission: 'staggered_no_extra_relief' as const };
  const t = (h: string) => `2026-12-01T${h}:00+08:00`;
  const duty = { plannedStart: t('07:00'), plannedEnd: t('19:00'), clockIn: t('07:00'), clockOut: t('19:00'), plan, guardsOnPost: 2, breakPermission: true };
  const brk = (s: string, e: string, extra: Partial<{ confirmedBySupervisor: boolean; relieved: boolean; interruptedMinutes: number }> = {}) => ({ start: t(s), end: t(e), confirmedBySupervisor: true, relieved: true, interruptedMinutes: 0, ...extra });
  it('12 h with two confirmed 60-minute breaks = 10 h worked', () => {
    expect(workedMinutes({ ...duty, breaks: [brk('09:00', '10:00'), brk('14:00', '15:00')] }).worked).toBe(600);
  });
  it('one break interrupted after 20 minutes = 10 h 40 min worked, with an alert', () => {
    const r = workedMinutes({ ...duty, breaks: [brk('09:00', '10:00', { interruptedMinutes: 40 }), brk('14:00', '15:00')] });
    expect(r.worked).toBe(640);
    expect(r.alerts.join(' ')).toMatch(/interrupted/);
  });
  it('single guard on the post, paid (IKEA) breaks, unconfirmed or unrelieved breaks: nothing deducted', () => {
    expect(workedMinutes({ ...duty, guardsOnPost: 1, breaks: [brk('09:00', '10:00')] }).worked).toBe(720);
    expect(workedMinutes({ ...duty, plan: { ...plan, paid: true }, breaks: [brk('09:00', '10:00')] }).worked).toBe(720);
    expect(workedMinutes({ ...duty, breaks: [brk('09:00', '10:00', { confirmedBySupervisor: false })] }).worked).toBe(720);
    expect(workedMinutes({ ...duty, breaks: [brk('09:00', '10:00', { relieved: false })] }).worked).toBe(720);
    expect(workedMinutes({ ...duty, breakPermission: false, breaks: [brk('09:00', '10:00')] }).worked).toBe(720);
  });
  it('early clock-in adds nothing unless the OM approved it', () => {
    expect(workedMinutes({ ...duty, clockIn: t('06:30'), breaks: [] }).worked).toBe(720);
    expect(workedMinutes({ ...duty, clockIn: t('06:30'), extraApproved: true, breaks: [] }).worked).toBe(750);
  });
  it('school slots A 09-10 / 14-15 and B 10-11 / 15-16 keep one guard active; overlap and 90-minute breaks are refused', () => {
    const shift = { start: t('07:00'), end: t('19:00'), guards: 2, minActive: 1 };
    const ok = [
      { slot: 'A', start: t('09:00'), end: t('10:00') },
      { slot: 'A', start: t('14:00'), end: t('15:00') },
      { slot: 'B', start: t('10:00'), end: t('11:00') },
      { slot: 'B', start: t('15:00'), end: t('16:00') },
    ];
    expect(breakPlanProblems(plan, shift, ok)).toEqual([]);
    expect(breakPlanProblems(plan, shift, [ok[0], { slot: 'B', start: t('09:30'), end: t('10:30') }]).join(' ')).toMatch(/fewer than 1/);
    expect(breakPlanProblems(plan, shift, [{ slot: 'A', start: t('09:00'), end: t('10:30') }]).join(' ')).toMatch(/60-minute limit/);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Coverage and roster checker
// ------------------------------------------------------------------------------------------------------------------

const cov = (over: Partial<SiteCoverage> = {}): SiteCoverage => ({
  siteId: 'SITE-A',
  effectiveFrom: '2026-01-01',
  sector: 'private',
  calendar: { kind: 'every_day' },
  shifts: [{ code: 'D', start: '07:00', end: '19:00', posts: 1 }],
  minActive: 1,
  armed: false,
  clientLimits: {},
  billing: 'fixed_monthly_post',
  breakPermissionRef: null,
  reason: 'Contract terms (synthetic)',
  documentRef: 'DOC-1',
  setById: 'U-OD-1',
  ...over,
});
const person = (id: string, over: Partial<RosterPerson> = {}): RosterPerson => ({ personId: id, joinedOn: '2020-01-01', leftOn: null, armedUntil: null, licenceUntil: '2030-01-01', home: { siteId: 'SITE-A', from: '2020-01-01' }, ...over });
const rday = (personId: string, date: string, planned: RosterStatus, hours = 12, site = 'SITE-A'): RosterDay => {
  const duty = planned.startsWith('WORK') || planned.startsWith('RELIEF');
  const start = planned.endsWith('_N') ? `${date}T19:00:00+08:00` : `${date}T07:00:00+08:00`;
  return { personId, siteId: site, postId: 'P-1', date, planned, actual: null, plannedStart: duty ? start : null, plannedEnd: duty ? new Date(Date.parse(start) + hours * 3_600_000).toISOString() : null };
};

describe('O2 coverage (D3 test 03/04, D4 T09, D5 T03, v3 UAT-01/07)', () => {
  it('IKEA 14 day + 12 night: November 780, December 806 position-shifts', () => {
    const c = cov({ shifts: [{ code: 'D', start: '07:00', end: '19:00', posts: 14 }, { code: 'N', start: '19:00', end: '07:00', posts: 12 }] });
    expect(requiredCoverage([c], 'SITE-A', '2026-11').total).toBe(780);
    expect(requiredCoverage([c], 'SITE-A', '2026-12').total).toBe(806);
  });
  it('nine schools x (2 day + 2 night): 1,080 in 30 days, 1,116 in 31 days', () => {
    const schools = Array.from({ length: 9 }, (_, k) => cov({ siteId: `SCH-${k + 1}`, sector: 'government', shifts: [{ code: 'D', start: '07:00', end: '19:00', posts: 2 }, { code: 'N', start: '19:00', end: '07:00', posts: 2 }] }));
    const total = (m: string) => schools.reduce((n, c) => n + requiredCoverage(schools, c.siteId, m).total, 0);
    expect(total('2026-11')).toBe(1080);
    expect(total('2026-12')).toBe(1116);
  });
  it('a 23-day office with one 11 h shift makes exactly 23 positions and no night shift', () => {
    const dates = monthDates('2026-12').filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
    const c = cov({ calendar: { kind: 'dates', dates }, shifts: [{ code: 'D', start: '07:00', end: '18:00', posts: 1 }] });
    const r = requiredCoverage([c], 'SITE-A', '2026-12');
    expect(r.total).toBe(23);
    expect(Object.values(r.byDate).every((x) => x.N === 0)).toBe(true);
  });
});

describe('O3 roster checker (PO-2: client limits block, law points flag)', () => {
  const input = (days: RosterDay[], over: Partial<Parameters<typeof checkRoster>[0]> = {}) =>
    checkRoster({ siteId: 'SITE-A', month: '2026-11', days, otherDays: [], coverage: [cov()], people: [person('G-001'), person('G-002')], normalHoursPerDay: 9, evidence: [], ...over });
  const pattern = (pid: string, workIdx: (k: number) => boolean) => monthDates('2026-11').map((d, k) => rday(pid, d, workIdx(k) ? 'WORK_D' : k % 7 === 6 ? 'OFF_REST' : 'OFF_ADD'));

  it('a remote single post worked all 31 days saves and shows RED for the weekly rest day (D5 T01/T02, UAT-08/34)', () => {
    const days = monthDates('2026-12').map((d) => rday('G-001', d, 'WORK_D'));
    const r = checkRoster({ siteId: 'SITE-A', month: '2026-12', days, otherDays: [], coverage: [cov()], people: [person('G-001')], normalHoursPerDay: 9, evidence: [] });
    expect(r.canPublish).toBe(true);
    expect(r.findings.some((f) => f.code === 'LAW_WEEKLY_REST' && f.level === 'red')).toBe(true);
    expect(r.findings.some((f) => f.code === 'LAW_NO_REST_DAY_MARKED')).toBe(true);
    // 31 x 3 h = 93 overtime hours: under 104, so no 104-hour flag; 14 h duties would pass it.
    expect(r.findings.some((f) => f.code === 'LAW_OT_104')).toBe(false);
    const long = checkRoster({ siteId: 'SITE-A', month: '2026-12', days: monthDates('2026-12').map((d) => rday('G-001', d, 'WORK_D', 14)), otherDays: [], coverage: [cov()], people: [person('G-001')], normalHoursPerDay: 9, evidence: [] });
    expect(long.findings.some((f) => f.code === 'LAW_OT_104' && f.level === 'red')).toBe(true);
    expect(long.findings.some((f) => f.code === 'LAW_DAILY_12H')).toBe(true);
  });
  it('an uncovered date and a duty above the contract both block publishing (D3 test 04)', () => {
    const g1 = pattern('G-001', () => true);
    const g2 = monthDates('2026-11').map((d, k) => rday('G-002', d, k === 3 ? 'WORK_D' : 'OFF_ADD'));
    const r = input([...g1.map((d, k) => (k === 10 ? { ...d, planned: 'OFF_REST' as RosterStatus, plannedStart: null, plannedEnd: null } : d)), ...g2]);
    expect(r.canPublish).toBe(false);
    expect(r.findings.some((f) => f.code === 'UNCOVERED' && f.date === '2026-11-11')).toBe(true);
    expect(r.findings.some((f) => f.code === 'OVER_COVERAGE' && f.date === '2026-11-04')).toBe(true);
  });
  it('IKEA: 6 duties of 12 h in 7 days blocks; 23 twelve-hour duties in November cannot fit 5 in any 7 (D3 tests 02/06)', () => {
    const lim = cov({ clientLimits: { maxDutyHours: 12, maxHours7d: 60, maxDaysInRow: 6, maxLongDuties7d: { hours: 12, max: 5 } } });
    const sixInSeven = pattern('G-001', (k) => k < 6);
    const r = checkRoster({ siteId: 'SITE-A', month: '2026-11', days: sixInSeven, otherDays: [], coverage: [lim], people: [person('G-001')], normalHoursPerDay: 9, evidence: [] });
    expect(r.findings.some((f) => f.code === 'CLIENT_LONG_DUTIES' && f.level === 'block')).toBe(true);
    expect(r.findings.some((f) => f.code === 'CLIENT_60H')).toBe(true);
    const twentyThree = pattern('G-001', (k) => k % 7 < 5 || k === 5);
    expect(twentyThree.filter((d) => d.planned === 'WORK_D').length).toBe(23);
    expect(checkRoster({ siteId: 'SITE-A', month: '2026-11', days: twentyThree, otherDays: [], coverage: [lim], people: [person('G-001')], normalHoursPerDay: 9, evidence: [] }).findings.some((f) => f.code === 'CLIENT_LONG_DUTIES')).toBe(true);
    const twentyTwo = pattern('G-001', (k) => k % 7 < 5 && k < 30);
    expect(checkRoster({ siteId: 'SITE-A', month: '2026-11', days: twentyTwo, otherDays: [], coverage: [lim], people: [person('G-001')], normalHoursPerDay: 9, evidence: [] }).findings.filter((f) => f.code.startsWith('CLIENT'))).toEqual([]);
  });
  it('a run across 30 Nov / 1 Dec is caught from the next month (D3 test 10, D4 T08)', () => {
    const lim = cov({ clientLimits: { maxDaysInRow: 6 } });
    const nov = monthDates('2026-11').map((d, k) => rday('G-001', d, k >= 26 ? 'WORK_D' : k % 7 === 6 ? 'OFF_REST' : 'OFF_ADD'));
    const dec = ['2026-12-01', '2026-12-02', '2026-12-03'].map((d) => rday('G-001', d, 'WORK_D'));
    const r = checkRoster({ siteId: 'SITE-A', month: '2026-11', days: nov, otherDays: dec, coverage: [lim], people: [person('G-001')], normalHoursPerDay: 9, evidence: [] });
    expect(r.findings.some((f) => f.code === 'CLIENT_DAYS_IN_ROW')).toBe(true);
  });
  it('double booking at another site, licence, armed post and joining date are blocks (D5 T17, UAT-23)', () => {
    const days = pattern('G-001', (k) => k === 2);
    const other = [rday('G-001', '2026-11-03', 'WORK_D', 12, 'SITE-B')];
    const r = checkRoster({ siteId: 'SITE-A', month: '2026-11', days, otherDays: other, coverage: [cov({ armed: true })], people: [person('G-001', { armedUntil: '2026-10-31', joinedOn: '2026-11-05' })], normalHoursPerDay: 9, evidence: [] });
    const codes = r.findings.filter((f) => f.level === 'block').map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['DOUBLE_BOOKED', 'ARMED_POST', 'BEFORE_JOIN']));
  });
  it('evidence for another site, another guard or past its dates never clears a law flag (UAT-15)', () => {
    const e: ComplianceEvidence = { id: 'E1', rule: 'weekly_rest', kind: 'jtk_permit', documentRef: 'JTK-1', siteId: 'SITE-A', personIds: ['G-001'], from: '2026-12-01', to: '2026-12-31', conditions: '', recordedById: 'U-OD-1' };
    expect(evidenceCovers(e, 'weekly_rest', 'SITE-A', 'G-001', '2026-12-15')).toBe(true);
    expect(evidenceCovers(e, 'weekly_rest', 'SITE-B', 'G-001', '2026-12-15')).toBe(false);
    expect(evidenceCovers(e, 'weekly_rest', 'SITE-A', 'G-002', '2026-12-15')).toBe(false);
    expect(evidenceCovers(e, 'weekly_rest', 'SITE-A', 'G-001', '2027-01-01')).toBe(false);
    expect(evidenceCovers({ ...e, kind: 'client_permission' }, 'weekly_rest', 'SITE-A', 'G-001', '2026-12-15')).toBe(false);
    const days = monthDates('2026-12').map((d) => rday('G-001', d, 'WORK_D'));
    const r = checkRoster({ siteId: 'SITE-A', month: '2026-12', days, otherDays: [], coverage: [cov()], people: [person('G-001')], normalHoursPerDay: 9, evidence: [e] });
    expect(r.findings.some((f) => f.code === 'LAW_WEEKLY_REST')).toBe(false);
  });
  it('findings become an exception list with owners (O11)', () => {
    const days = monthDates('2026-12').map((d) => rday('G-001', d, 'WORK_D'));
    const r = checkRoster({ siteId: 'SITE-A', month: '2026-12', days, otherDays: [], coverage: [cov()], people: [person('G-001')], normalHoursPerDay: 9, evidence: [] });
    const ex = rosterExceptions('SITE-A', '2026-12-01', r.findings);
    expect(ex.find((x) => x.kind === 'MISSING_REST_DAY')!.owner).toBe('OM');
    expect(ex.every((x) => x.due > '2026-12-01')).toBe(true);
  });
});

describe('O4 roster approval chain (PO-5)', () => {
  const v = (status: RosterVersion['status'], steps: RosterVersion['steps'] = []): RosterVersion => ({ id: 'RV-1', companyId: 'C-1', siteId: 'SITE-A', month: '2026-12', version: 1, status, preparedById: 'U-OM-1', steps, changeReason: null, replacesId: null });
  const priv = { sector: 'private' as const, hasAreaSupervisor: false };
  const gov = { sector: 'government' as const, hasAreaSupervisor: true };
  it('OM submits; the OD publishes a private site; the preparer cannot publish; a reason is required', () => {
    expect(rosterStepProblem(v('draft'), { action: 'submit', byId: 'U-OM-1', role: 'om', reason: 'December roster' }, priv, { canPublish: true })).toBeNull();
    expect(rosterStepProblem(v('submitted'), { action: 'publish', byId: 'U-OD-1', role: 'ops_director', reason: 'Checked' }, priv, { canPublish: true })).toBeNull();
    expect(rosterStepProblem(v('submitted'), { action: 'publish', byId: 'U-OM-1', role: 'ops_director', reason: 'Checked' }, priv, { canPublish: true })).toMatch(/own roster/);
    expect(rosterStepProblem(v('submitted'), { action: 'publish', byId: 'U-OD-1', role: 'ops_director', reason: ' ' }, priv, { canPublish: true })).toMatch(/reason/);
    expect(rosterStepProblem(v('submitted'), { action: 'publish', byId: 'U-OGM-1', role: 'ogm', reason: 'x' }, priv, { canPublish: true })).toMatch(/Operations Director/);
  });
  it('a government site with an Area Supervisor: verify first, then the OGM; client blocks stop publishing', () => {
    expect(rosterStepProblem(v('submitted'), { action: 'publish', byId: 'U-OGM-1', role: 'ogm', reason: 'x' }, gov, { canPublish: true })).toMatch(/verifies first/);
    expect(rosterStepProblem(v('submitted'), { action: 'verify', byId: 'U-AS-1', role: 'area_supervisor', reason: 'Seen on site' }, gov, { canPublish: true })).toBeNull();
    const verified = v('verified', [{ action: 'verify', byId: 'U-AS-1', role: 'area_supervisor', at: '2026-11-20T10:00:00Z', reason: 'ok' }]);
    expect(rosterStepProblem(verified, { action: 'publish', byId: 'U-AS-1', role: 'ogm', reason: 'x' }, gov, { canPublish: true })).toMatch(/different person/);
    expect(rosterStepProblem(verified, { action: 'publish', byId: 'U-OGM-1', role: 'ogm', reason: 'x' }, gov, { canPublish: false })).toMatch(/block publishing/);
    expect(rosterStepProblem(verified, { action: 'publish', byId: 'U-OGM-1', role: 'ogm', reason: 'x' }, gov, { canPublish: true })).toBeNull();
  });
});

describe('O9 allowances (PO-7, v3 UAT-22/23/24)', () => {
  const base: GuardAllowance = { id: 'AL-1', type: 'armed', label: 'Armed allowance', basis: 'per_duty', amount: 10, prorate: false, from: '2026-01-01', to: null, verifiedById: 'U-HRD-1', approvedById: 'U-COO-1', partOfWagesForOt: false, epf: true, socso: true, pcb: true };
  const duties = monthDates('2026-11').slice(0, 4).map((date, k) => ({ date, status: 'WORK_D' as RosterStatus, armedPost: true, companyTransport: k === 0, trips: 2 }));
  it('armed allowance only while the arms authorisation is in force', () => {
    const [l] = allowanceLines([base], duties, '2026-11', { armedUntil: '2026-11-02' }, 30);
    expect(l.qty).toBe(2);
    expect(l.flags.join(' ')).toMatch(/expired/);
  });
  it('transport: none on a company-transport day; per trip counts confirmed trips once', () => {
    expect(allowanceLines([{ ...base, type: 'transport', label: 'Transport' }], duties, '2026-11', { armedUntil: null }, 30)[0].qty).toBe(3);
    expect(allowanceLines([{ ...base, type: 'transport', label: 'Transport', basis: 'per_trip' }], duties, '2026-11', { armedUntil: null }, 30)[0].qty).toBe(6);
  });
  it('not paid until the HR Director verifies and a different COO approves', () => {
    expect(allowanceLines([{ ...base, approvedById: null }], duties, '2026-11', { armedUntil: '2030-01-01' }, 30)[0].amount).toBe(0);
    expect(allowanceLines([{ ...base, approvedById: 'U-HRD-1' }], duties, '2026-11', { armedUntil: '2030-01-01' }, 30)[0].amount).toBe(0);
  });
  it('a fixed monthly allowance is cut for unpaid leave, unpaid absence and unscheduled leave, never for MC (Fauzan, 14 Nov 2026)', () => {
    const monthly: GuardAllowance = { ...base, id: 'AL-M', type: 'supervisor', label: 'Supervisor allowance', basis: 'monthly', amount: 220 } as GuardAllowance;
    const days = [
      { date: '2026-11-02', planned: 'WORK_D' as RosterStatus, actual: 'UPL' as RosterStatus },
      { date: '2026-11-03', planned: 'WORK_D' as RosterStatus, actual: 'AL' as RosterStatus },
      { date: '2026-11-04', planned: 'AL' as RosterStatus, actual: 'AL' as RosterStatus },
      { date: '2026-11-05', planned: 'WORK_D' as RosterStatus, actual: 'MC' as RosterStatus },
      { date: '2026-11-06', planned: 'WORK_D' as RosterStatus, actual: 'ABS' as RosterStatus },
    ];
    const lost = allowanceLostDays(days, ['2026-11-06']);
    expect(lost).toEqual(['2026-11-02', '2026-11-03', '2026-11-06']);
    const [l] = allowanceLines([monthly], duties, '2026-11', { armedUntil: null }, 30, { days: lost, divisor: 22 });
    expect(l.amount).toBe(190);
    expect(l.flags.join(' ')).toMatch(/3 day\(s\).*RM30.00 less \(RM10.00 a day\)/);
    expect(allowanceLines([monthly], duties, '2026-11', { armedUntil: null }, 30)[0].amount).toBe(220);
  });
  it('allowances are their own payslip lines on top of what is due', () => {
    const lines = allowanceLines([base], duties, '2026-11', { armedUntil: '2030-01-01' }, 30);
    const r = pay(IKEA, '2026-11', 22, 720, { allowances: lines });
    expect(r.independentDue).toBe(2563.28);
    expect(r.gross).toBe(2603.28);
  });
});

describe('O10 duty ledger', () => {
  it('ledger minutes add up to the pay run minutes', () => {
    const r = pay(IKEA, '2026-11', 22, 720);
    const lines = month('2026-11', 22, 720).duties.map((d) => ({ personId: 'G-001', homeSiteId: 'SITE-A', costSiteId: 'SITE-A', date: d.date, shift: 'D' as const, plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null, workedMinutes: 720, unpaidBreakMinutes: 0, normalMinutes: 540, otMinutes: 180, status: 'WORK_D' as RosterStatus, restDayType: null, publicHoliday: false, rosterVersionId: 'RV-1', attendanceId: null, exceptions: [] }));
    const t = ledgerTotals(lines);
    expect(t.ot).toBe(r.otMinutes);
    expect(t.normal).toBe(r.normalMinutes);
  });
});
