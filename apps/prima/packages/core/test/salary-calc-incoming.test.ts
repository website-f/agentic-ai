import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, dataWalls, generateDataset, guardSalaryCalc, myt, standardGuardAmounts, type User } from '../src';

// Salary calculator (Fauzan, 6 Nov 2026). Placeholder basic of RM1,700; not a real rate.
describe('guard salary calculator', () => {
  const a = standardGuardAmounts(2);
  it('full month of 12-hour shifts with 2 h rest = RM2,550 (blueprint Structure C)', () => {
    const r = guardSalaryCalc(a, { daysWorked: 26 });
    expect(r.dailyRate).toBe(65.38);
    expect(r.hourlyRate).toBe(8.72);
    expect(r.gross).toBe(2550);
    expect(r.dutyHours).toBe(260);
  });
  it('training, MC, annual leave and a holiday off are one normal day each, no overtime', () => {
    const r = guardSalaryCalc(a, { daysWorked: 22, trainingDays: 1, mcDays: 1, annualLeaveDays: 1, holidaysOff: 1 });
    expect(r.shortDays).toBe(0);
    expect(r.gross).toBe(2419.23);
    expect(r.lines.some((l) => /not paid/.test(l.label))).toBe(false);
  });
  it('unpaid short days come off at the daily rate; rest day and public holiday worked are added', () => {
    const r = guardSalaryCalc(a, { daysWorked: 24, restDaysWorked: 1, publicHolidaysWorked: 1 });
    const line = (re: RegExp) => r.lines.find((l) => re.test(l.label))!.amount;
    // The worked paid holiday fills one basic-paid day; rest-day work does not.
    expect(r.shortDays).toBe(1);
    expect(line(/not paid/)).toBe(-65.38);
    expect(line(/^Rest day worked/)).toBe(65.38);
    expect(line(/^Overtime, rest days/)).toBe(43.59);
    expect(line(/^Public holiday worked/)).toBe(130.77);
    expect(line(/^Overtime, public holidays/)).toBe(65.38);
  });
  it('warns when the days add up to more than the month', () => {
    expect(guardSalaryCalc(a, { daysWorked: 26, annualLeaveDays: 2 }).notes[0]).toMatch(/more than the 26-day month/);
  });
});

describe('salary calculator data (OM and above, read only)', () => {
  const TODAY = '2026-11-06';
  const fresh = () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
    return { ds, svc: new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00')) };
  };
  it('the OM, ROM, OGM, OD, COO and CEO get the live guard formulas and the pay law; nobody else', async () => {
    const { ds, svc } = fresh();
    const tiers = ['om', 'regional', 'ogm', 'ops_director', 'coo', 'ceo'];
    for (const t of tiers) {
      const u = ds.users.find((x) => x.opsTier === t && !x.integration) as User;
      const d = await svc.salaryCalcData(u);
      expect(d.formulas.every((f) => f.amounts.basicMonthly > 0)).toBe(true);
      expect(d.formulas.map((f) => f.code)).toContain('STD-12H-R2');
      expect(d.law.ordinaryRateDivisor).toBe(26);
      expect(dataWalls(u)).toContain('pay_read');
    }
    for (const role of ['guard', 'site_device', 'supervisor'] as const) {
      const u = ds.users.find((x) => x.role === role && !x.opsTier);
      if (u) {
        await expect(svc.salaryCalcData(u)).rejects.toThrow(/Not allowed/);
        expect(dataWalls(u)).not.toContain('pay_read');
      }
    }
    const patrol = ds.users.find((x) => x.opsTier === 'patrol');
    if (patrol) await expect(svc.salaryCalcData(patrol)).rejects.toThrow(/Not allowed/);
  });
  it('follows the CEO pay law for the month', async () => {
    const { ds, svc } = fresh();
    const ceo = ds.users.find((x) => x.id === 'u-fauzan') as User;
    await svc.savePayLaw(ceo, { effectiveFrom: '2026-11', settings: { minimumWage: 1900 }, reason: 'Synthetic law change' });
    const om = ds.users.find((x) => x.id === 'u-om-klang') as User;
    expect((await svc.salaryCalcData(om)).law.minimumWage).toBe(1900);
  });
});
