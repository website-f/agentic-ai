import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  generateDataset,
  myt,
  payFormulaLawCheck,
  payFormulaPreview,
  resolvePayFormulaUse,
  standardDriverAmounts,
  standardGuardAmounts,
  type PayFormulaUse,
} from '../src';

// Pay formulas set by ACT (Fauzan, 5 Nov 2026). Synthetic data only; the amounts are placeholders, not real rates.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const guardInput = (over: Record<string, unknown> = {}) => ({
  code: null,
  kind: 'guard_shift' as const,
  name: 'UAT 12-hour shift',
  effectiveFrom: '2026-12',
  amounts: { ...standardGuardAmounts(2), ...over },
  reason: 'UAT synthetic formula',
});

describe('standard 12-hour full-month formulas', () => {
  it('counts 7.5 normal hours and the rest as unpaid only when the guard is relieved', () => {
    // 12 hours less 2, 2.5 or 3 hours rest: 10, 9.5 or 9 hours worked, so 2.5, 2 or 1.5 overtime hours a day.
    const want = { 2: 2.5, 2.5: 2, 3: 1.5 } as const;
    for (const rest of [2, 2.5, 3] as const) {
      const p = payFormulaPreview('guard_shift', standardGuardAmounts(rest));
      expect(p.otHours).toBe(want[rest] * 26);
      expect(p.dailyRate).toBe(65.38); // 1700 / 26
      expect(p.hourlyRate).toBe(8.72); // 65.38 / 7.5
      const ot = p.lines.find((l) => l.label === 'Overtime, working days')!;
      expect(ot.amount).toBeCloseTo(want[rest] * 26 * (1700 / 26 / 7.5) * 1.5, 2);
      expect(p.gross).toBeCloseTo(1700 + ot.amount, 2);
    }
    // Two hours rest: 65 overtime hours, RM850.00 overtime, RM2,550.00 gross (the blueprint's Structure C).
    const r2 = payFormulaPreview('guard_shift', standardGuardAmounts(2));
    expect(r2.lines.find((l) => l.label === 'Overtime, working days')!.amount).toBe(850);
    expect(r2.gross).toBe(2550);
    // Not relieved: the rest is paid as work, 4.5 overtime hours a day. Guards are exempt from the hours limits
    // (Fauzan, 5 Nov 2026), so only the rest-break rule is flagged.
    const stay = payFormulaPreview('guard_shift', { ...standardGuardAmounts(2), restRelieved: false });
    expect(stay.otHours).toBe(117);
    expect(stay.overOtCap).toBe(false);
    const flags = payFormulaLawCheck('guard_shift', { ...standardGuardAmounts(2), restRelieved: false }, '2026-12').flags;
    expect(flags.join(' ')).toMatch(/PAY-REST-BREAK/);
    expect(flags).toHaveLength(1);
  });

  it('pays rest days and public holidays on top, and takes off days not worked', () => {
    const p = payFormulaPreview('guard_shift', standardGuardAmounts(2), { daysWorked: 24, restDaysWorked: 2, publicHolidaysWorked: 1 });
    const line = (l: string) => p.lines.find((x) => x.label === l)!;
    expect(line('Days not worked (unpaid)').amount).toBeCloseTo(-2 * (1700 / 26), 2);
    expect(line('Rest day worked').amount).toBeCloseTo(2 * (1700 / 26), 2);
    expect(line('Overtime, rest days').rate).toBeCloseTo((1700 / 26 / 7.5) * 2, 2);
    expect(line('Public holiday worked').amount).toBeCloseTo(2 * (1700 / 26), 2);
    expect(line('Overtime, public holidays').rate).toBeCloseTo((1700 / 26 / 7.5) * 3, 2);
  });

  it('gives the standard guard formulas no flags: guards are exempt from the hours limits', () => {
    for (const rest of [2, 2.5, 3]) expect(payFormulaLawCheck('guard_shift', standardGuardAmounts(rest), '2026-12')).toEqual({ refuse: [], flags: [] });
  });
});

describe('labour law is a flag, the ACT Director\'s amounts stand (Fauzan, 5 Nov 2026)', () => {
  it('flags pay below the law instead of refusing it, and refuses only entries that cannot be counted', () => {
    const check = (over: Record<string, unknown>, kind: 'guard_shift' | 'staff_ot' = 'guard_shift') =>
      payFormulaLawCheck(kind, { ...(kind === 'guard_shift' ? standardGuardAmounts(2) : standardDriverAmounts()), ...over }, '2026-12');
    for (const [over, flag] of [
      [{ basicMonthly: 1699 }, /minimum wage/],
      [{ otNormalRate: 1.25 }, /1.5 times/],
      [{ otRestDayRate: 1.5 }, /2 times/],
      [{ otPublicHolidayRate: 2 }, /3 times/],
      [{ restDayDays: 0.5 }, /one extra day/],
      [{ publicHolidayDays: 1 }, /two extra days/],
    ] as const) {
      const c = check(over);
      expect(c.refuse).toEqual([]);
      expect(c.flags.join(' ')).toMatch(flag);
    }
    // Normal hours: flagged for staff, not for guards (exempt).
    expect(check({ normalHoursPerDay: 8 }).flags).toEqual([]);
    expect(check({ normalHoursPerDay: 9, workDaysPerWeek: 6 }, 'staff_ot').flags.join(' ')).toMatch(/more than 8 a day[\s\S]*45/);
    // Entries that cannot be counted are still refused.
    expect(check({ restHours: 12 }).refuse.join(' ')).toMatch(/shorter than the shift/);
    expect(check({ normalHoursPerDay: 0 }).refuse.join(' ')).toMatch(/more than 0/);
    expect(check({ basicMonthly: -1 }).refuse.join(' ')).toMatch(/number/);
    // The announced RM2,000 is flagged, not refused, until it is gazetted.
    const later = payFormulaLawCheck('guard_shift', standardGuardAmounts(2), '2027-06');
    expect(later.refuse).toEqual([]);
    expect(later.flags.join(' ')).toMatch(/RM2000/);
  });

  it('works out driver overtime from the hours entered', () => {
    const a = { ...standardDriverAmounts(), otMealAllowance: 10, outstationPerNight: 50 };
    expect(payFormulaLawCheck('driver_ot', a, '2026-12').refuse).toEqual([]);
    const p = payFormulaPreview('driver_ot', a, { otHoursNormal: 10, otHoursRestDay: 2, restDaysWorked: 1, mealDays: 3, outstationNights: 2 });
    const hourly = 1700 / 26 / 8;
    expect(p.lines.find((l) => l.label === 'Overtime, working days')!.amount).toBeCloseTo(10 * hourly * 1.5, 2);
    expect(p.lines.find((l) => l.label === 'Overtime, rest days')!.amount).toBeCloseTo(2 * hourly * 2, 2);
    expect(p.lines.find((l) => l.label === 'Overtime meal allowance')!.amount).toBe(30);
    expect(p.lines.find((l) => l.label === 'Outstation allowance')!.amount).toBe(100);
  });
});

describe('where a formula is used: site, then company, then region, then group', () => {
  const u = (id: string, scope: PayFormulaUse['scope'], scopeId: string | null, code: string | null, from = '2026-11', kind: PayFormulaUse['kind'] = 'guard_shift'): PayFormulaUse => ({
    id, kind, scope, scopeId, formulaCode: code, effectiveFrom: from, reason: 'x', setBy: 'x', setById: 'x', setAt: `${from}-01T00:00:00+08:00`, endedBy: null,
  });
  it('picks the narrowest choice in force for the month', () => {
    const uses = [u('g', 'group', null, 'G'), u('r', 'region', 'central', 'R'), u('c', 'company', 'co-1', 'C'), u('s', 'site', 'st-1', 'S', '2026-12')];
    const place = { siteId: 'st-1', companyId: 'co-1', regionId: 'central' };
    expect(resolvePayFormulaUse(uses, 'guard_shift', place, '2026-11')?.formulaCode).toBe('C');
    expect(resolvePayFormulaUse(uses, 'guard_shift', place, '2026-12')?.formulaCode).toBe('S');
    expect(resolvePayFormulaUse(uses, 'guard_shift', { companyId: 'co-2', regionId: 'central' }, '2026-11')?.formulaCode).toBe('R');
    expect(resolvePayFormulaUse(uses, 'guard_shift', { companyId: 'co-2', regionId: 'northern' }, '2026-11')?.formulaCode).toBe('G');
    // "None" on the site hands it back to the company.
    expect(resolvePayFormulaUse([...uses, u('s2', 'site', 'st-1', null, '2027-01')], 'guard_shift', place, '2027-01')?.formulaCode).toBe('C');
    // Drivers have no site choice.
    expect(resolvePayFormulaUse([u('ds', 'site', 'st-1', 'X', '2026-11', 'driver_ot')], 'driver_ot', place, '2026-11')).toBeNull();
  });
});

describe('who sets pay formulas', () => {
  it('lets the ACT Director set a formula live and use it for a site; the screen shows the right one', async () => {
    const { svc, ds } = fresh();
    const dir = await svc.user('u-audit');
    const f = await svc.savePayFormula(dir, guardInput({ restHours: 3, fixedAllowances: [{ label: 'UAT shift allowance', amount: 100 }] }));
    expect(f.status).toBe('live');
    expect(f.code).toMatch(/^GRD-\d{3}$/);
    const site = ds.sites.find((s) => s.companyId === 'co-arrow') ?? ds.sites[1];
    await svc.setPayFormulaUse(dir, { kind: 'guard_shift', scope: 'site', scopeId: site.id, formulaCode: f.code, effectiveFrom: '2026-12', reason: 'UAT site has a relief guard' });
    const at = await svc.payFormulaAt(dir, { kind: 'guard_shift', siteId: site.id, month: '2026-12' });
    expect(at.formula?.code).toBe(f.code);
    expect(at.example?.lines.find((l) => l.label === 'UAT shift allowance')?.amount).toBe(100);
    // November still uses the group default.
    expect((await svc.payFormulaAt(dir, { kind: 'guard_shift', siteId: site.id, month: '2026-11' })).formula?.code).toBe('STD-12H-R2');
    expect(ds.audit.some((a) => a.action === 'pay.formula.set' && a.entityId === f.id)).toBe(true);
    expect(ds.audit.some((a) => a.action === 'pay.formula.use')).toBe(true);
  });

  it('keeps an ACT team change as a draft for the Director, who decides with a reason', async () => {
    const { svc } = fresh();
    const dep = await svc.user('u-act-aud1');
    const dir = await svc.user('u-audit');
    const d = await svc.savePayFormula(dep, { ...guardInput({ basicMonthly: 1800 }), code: 'STD-12H-R2', name: '12-hour shift, 2 hours rest, full month' });
    expect(d.status).toBe('draft');
    expect(d.version).toBe(2);
    await expect(svc.decidePayFormula(dep, d.id, true, 'ok')).rejects.toThrow(/ACT Director/);
    await expect(svc.setPayFormulaUse(dep, { kind: 'guard_shift', scope: 'group', formulaCode: 'STD-12H-R2', effectiveFrom: '2026-12', reason: 'UAT try' })).rejects.toThrow(/ACT Director/);
    await expect(svc.decidePayFormula(dir, d.id, true, '')).rejects.toThrow(/reason/);
    const live = await svc.decidePayFormula(dir, d.id, true, 'UAT agreed');
    expect(live.status).toBe('live');
    await expect(svc.decidePayFormula(dir, d.id, false, 'again')).rejects.toThrow(/already decided/);
    // December pays the new version, November the old one.
    expect((await svc.payFormulaAt(dir, { kind: 'guard_shift', companyId: 'co-sasa', month: '2026-12' })).formula?.amounts.basicMonthly).toBe(1800);
    expect((await svc.payFormulaAt(dir, { kind: 'guard_shift', companyId: 'co-sasa', month: '2026-11' })).formula?.amounts.basicMonthly).toBe(1700);
  });

  it('refuses everyone outside ACT, pay below the law and past months, on the direct calls too', async () => {
    const { svc } = fresh();
    // The CEO (u-fauzan) sets formulas like the ACT Director since 6 Nov 2026; see the CEO tests below.
    for (const id of ['u-coo', 'u-fd', 'u-pwvsb-hr', 'u-cm-sasa']) {
      const who = await svc.user(id);
      await expect(svc.savePayFormula(who, guardInput())).rejects.toThrow(/ACT/);
      await expect(svc.setPayFormulaUse(who, { kind: 'guard_shift', scope: 'group', formulaCode: 'STD-12H-R2', effectiveFrom: '2026-12', reason: 'UAT try' })).rejects.toThrow(/ACT Director/);
    }
    // Leadership sees the board; HR and the company manager do not.
    expect((await svc.payFormulaBoard(await svc.user('u-coo'))).role).toBe('leader');
    await expect(svc.payFormulaBoard(await svc.user('u-pwvsb-hr'))).rejects.toThrow();
    await expect(svc.payFormulaBoard(await svc.user('u-cm-sasa'))).rejects.toThrow();
    await expect(svc.payFormulaAt(await svc.user('u-cm-sasa'), { kind: 'guard_shift' })).rejects.toThrow();
    const dir = await svc.user('u-audit');
    // The ACT Director's amounts are saved even below the law, with the flags kept on the formula.
    const low = await svc.savePayFormula(dir, guardInput({ basicMonthly: 1500, otNormalRate: 1 }));
    expect(low.status).toBe('live');
    expect(low.lawFlags.join(' ')).toMatch(/minimum wage[\s\S]*1.5 times/);
    await expect(svc.savePayFormula(dir, guardInput({ restHours: 13 }))).rejects.toThrow(/shorter than the shift/);
    await expect(svc.savePayFormula(dir, { ...guardInput(), effectiveFrom: '2026-10' })).rejects.toThrow(/past month/);
    await expect(svc.savePayFormula(dir, { ...guardInput(), reason: '' })).rejects.toThrow(/Say why/);
    await expect(svc.savePayFormula(dir, { ...guardInput(), kind: 'driver_ot', code: 'STD-12H-R2' })).rejects.toThrow(/kind/);
    await expect(svc.setPayFormulaUse(dir, { kind: 'driver_ot', scope: 'site', scopeId: 'x', formulaCode: 'DRV-OT', effectiveFrom: '2026-12', reason: 'UAT try' })).rejects.toThrow(/drivers and staff/);
    await expect(svc.setPayFormulaUse(dir, { kind: 'staff_ot', scope: 'company', scopeId: 'co-sasa', formulaCode: 'DRV-OT', effectiveFrom: '2026-12', reason: 'UAT try' })).rejects.toThrow(/different kind/);
    await expect(svc.setPayFormulaUse(dir, { kind: 'guard_shift', scope: 'group', formulaCode: 'DRV-OT', effectiveFrom: '2026-12', reason: 'UAT try' })).rejects.toThrow(/different kind/);
    await expect(svc.setPayFormulaUse(dir, { kind: 'guard_shift', scope: 'group', formulaCode: null, effectiveFrom: '2026-12', reason: 'UAT try' })).rejects.toThrow(/always has a formula/);
    await expect(svc.setPayFormulaUse(dir, { kind: 'guard_shift', scope: 'company', scopeId: 'co-nope', formulaCode: 'STD-12H-R3', effectiveFrom: '2026-12', reason: 'UAT try' })).rejects.toThrow(/Company/);
  });

  it('lets only the preparer withdraw a draft', async () => {
    const { svc } = fresh();
    const la = await svc.user('u-act-aud1');
    const da = await svc.user('u-act-enf1');
    const d = await svc.savePayFormula(la, { ...guardInput(), kind: 'driver_ot', amounts: standardDriverAmounts(), name: 'UAT driver' });
    await expect(svc.withdrawPayFormula(da, d.id)).rejects.toThrow(/prepared it/);
    expect((await svc.withdrawPayFormula(la, d.id)).status).toBe('withdrawn');
  });

  it('seeds the three standard guard formulas and the driver overtime formula for the whole group', async () => {
    const { svc } = fresh();
    const b = await svc.payFormulaBoard(await svc.user('u-audit'));
    expect(b.role).toBe('director');
    const codes = b.formulas.filter((r) => r.inForce).map((r) => r.formula.code).sort();
    expect(codes).toEqual(['DRV-OT', 'STAFF-OT', 'STD-12H-R2', 'STD-12H-R2.5', 'STD-12H-R3']);
    expect(b.uses.filter((u) => u.current && u.use.scope === 'group').map((u) => u.use.formulaCode).sort()).toEqual(['DRV-OT', 'STAFF-OT', 'STD-12H-R2']);
    for (const r of b.formulas) expect(r.check.refuse).toEqual([]);
  });

  it('lets ACT set the overtime formula for all other staff, per company', async () => {
    const { svc } = fresh();
    const dir = await svc.user('u-audit');
    const f = await svc.savePayFormula(dir, { ...guardInput(), kind: 'staff_ot', name: 'UAT office overtime', amounts: { ...standardDriverAmounts(), otNormalRate: 2 } });
    expect(f.code).toMatch(/^STF-\d{3}$/);
    await svc.setPayFormulaUse(dir, { kind: 'staff_ot', scope: 'company', scopeId: 'co-sasa', formulaCode: f.code, effectiveFrom: '2026-12', reason: 'UAT Sasa office' });
    expect((await svc.payFormulaAt(dir, { kind: 'staff_ot', companyId: 'co-sasa', month: '2026-12' })).formula?.code).toBe(f.code);
    expect((await svc.payFormulaAt(dir, { kind: 'staff_ot', companyId: 'co-inas', month: '2026-12' })).formula?.code).toBe('STAFF-OT');
  });

  it('shows labour law flags on the CEO home, and drafts to the ACT Director', async () => {
    const { svc } = fresh();
    const dir = await svc.user('u-audit');
    const dep = await svc.user('u-act-aud1');
    const ceo = await svc.user('u-fauzan');
    const items = async (uid: string) => {
      const h = await svc.home(await svc.user(uid));
      return [...h.todo, ...(h.watch ?? [])].filter((i) => i.go.view === 'payformulas');
    };
    expect(await items('u-fauzan')).toEqual([]);
    await svc.savePayFormula(dir, guardInput({ basicMonthly: 1500 }));
    const d = await svc.savePayFormula(dep, { ...guardInput(), name: 'UAT draft' });
    const ceoItems = await items('u-fauzan');
    expect(ceoItems.some((i) => i.tag === 'Labour law' && /minimum wage/.test(i.detail))).toBe(true);
    expect((await items('u-audit')).some((i) => i.title.includes(d.code))).toBe(true);
    expect(await items('u-coo')).toEqual([]);
    expect(ceo.opsTier).toBe('ceo');
  });
});

describe("Fauzan's usual guard rules (6 Nov 2026) are the standard default", () => {
  it('45 hours a week, 1.5x working-day overtime, rest day 1 day + 2x, public holiday 2 days + 3x', () => {
    const a = standardGuardAmounts(2);
    // 45 hours a week over 6 days with one rest day: 7.5 hours a day.
    expect(a.normalHoursPerDay * a.workDaysPerWeek).toBe(45);
    // Hourly by days (basic / 26 / 7.5) equals hourly by weeks (basic x 12 / 52 / 45).
    expect(1700 / 26 / a.normalHoursPerDay).toBeCloseTo((1700 * 12) / 52 / 45, 10);
    const hourly = 1700 / 195;
    const daily = 1700 / 26;
    const p = payFormulaPreview('guard_shift', a, { restDaysWorked: 1, publicHolidaysWorked: 1 });
    const line = (l: string) => p.lines.find((x) => x.label === l)!;
    // 12-hour shift less 2 hours rest = 10 hours: 7.5 normal + 2.5 overtime.
    expect(line('Overtime, working days').amount).toBeCloseTo(26 * 2.5 * hourly * 1.5, 2);
    // Rest day: the 7.5 normal hours are one day's pay, the 2.5 hours past them 2x.
    expect(line('Rest day worked').amount).toBeCloseTo(daily, 2);
    expect(line('Overtime, rest days').amount).toBeCloseTo(2.5 * hourly * 2, 2);
    // Public holiday: 2 days' pay for the normal hours, overtime 3x.
    expect(line('Public holiday worked').amount).toBeCloseTo(2 * daily, 2);
    expect(line('Overtime, public holidays').amount).toBeCloseTo(2.5 * hourly * 3, 2);
  });
});

describe('CEO pay law settings (Fauzan, 6 Nov 2026)', () => {
  const ceoOf = (ds: ReturnType<typeof generateDataset>) => ds.users.find((u) => u.opsTier === 'ceo')!;
  it('the CEO sets formulas live like the ACT Director', async () => {
    const { ds, svc } = fresh();
    const row = await svc.savePayFormula(ceoOf(ds), guardInput());
    expect(row.status).toBe('live');
    const coo = ds.users.find((u) => u.opsTier === 'coo')!;
    await expect(svc.savePayFormula(coo, guardInput())).rejects.toThrow(/Not allowed/);
  });

  it('only the CEO changes the law settings; formulas, flags and the calculator follow them from that month', async () => {
    const { ds, svc } = fresh();
    const input = { effectiveFrom: '2026-12', settings: { ordinaryRateDivisor: 30, minimumWage: 2000, nextMinimumWage: null, lawNote: 'UAT synthetic new law' }, reason: 'UAT synthetic law change' };
    const actHead = ds.users.find((u) => u.id === 'u-audit')!;
    await expect(svc.savePayLaw(actHead, input)).rejects.toThrow(/Not allowed/);
    await expect(svc.savePayLaw(ceoOf(ds), { ...input, effectiveFrom: '2026-01' })).rejects.toThrow(/past month/);
    await expect(svc.savePayLaw(ceoOf(ds), { ...input, settings: { ordinaryRateDivisor: 0 } })).rejects.toThrow(/divisor/);
    await expect(svc.savePayLaw(ceoOf(ds), { ...input, reason: '' })).rejects.toThrow(/law or gazette/);
    const v = await svc.savePayLaw(ceoOf(ds), input);
    expect(v.settings).toMatchObject({ ordinaryRateDivisor: 30, minimumWage: 2000, otMinNormal: 1.5 });
    expect(ds.audit.some((a) => a.action === 'pay.law.set')).toBe(true);
    // This month still counts by 26; December by 30 and flags a RM1,700 basic under the new minimum.
    const now = await svc.payFormulaBoard(ceoOf(ds));
    expect(now.law.ordinaryRateDivisor).toBe(26);
    const dec = await svc.savePayFormula(actHead, guardInput({ basicMonthly: 1800 }));
    expect(dec.lawFlags.join(' ')).toMatch(/below the minimum wage of RM2000/);
    const r = payFormulaPreview('guard_shift', standardGuardAmounts(2), {}, { ...v.settings });
    expect(r.dailyRate).toBe(56.67);
  });
});
