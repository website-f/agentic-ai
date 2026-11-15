import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, attendedHours, generateDataset, myt, type Attendance, type Shift } from '../src';
import { guardPayPrep } from './guard-pay-preparer';

// B1b (Fauzan, 11 Nov 2026): "Salary and total working hours must match". Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW, daysBack: 40 });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
};
const shift = { start: '2026-10-01T07:00:00+08:00', end: '2026-10-01T19:00:00+08:00' } as Shift;
const att = (inAt: string, outAt: string) => ({ clockIn: `2026-10-01T${inAt}:00+08:00`, clockOut: `2026-10-01T${outAt}:00+08:00` }) as Attendance;

describe('hours paid must match hours recorded (B1b)', () => {
  it('counts a shift inside its times, with a 10-minute grace, less the unpaid rest', () => {
    expect(attendedHours(att('06:45', '19:20'), shift, 2)).toBe(10);
    expect(attendedHours(att('07:08', '18:55'), shift, 2)).toBe(10);
    expect(attendedHours(att('07:30', '19:00'), shift, 2)).toBe(9.5);
    expect(attendedHours(att('07:00', '17:00'), shift, 2)).toBe(8);
    // Excused by the company with a reason and proof: counted in full.
    expect(attendedHours(att('07:30', '17:00'), shift, 2, { late: true, early: true })).toBe(10);
  });

  it('shows hours recorded beside hours paid, holds a guard paid for more hours than attendance shows, and refuses saving', async () => {
    const { svc, store } = fresh();
    const prep = await guardPayPrep(svc, ['co-arsh']);
    const run0 = await svc.prepareGuardPay(prep, 'co-arsh', '2026-10', []);
    const ok = run0.lines.find((l) => l.daysWorked > 5 && l.hours && !l.hours.notCompared)!;
    expect(ok.hours!.match).toBe(true);
    expect(ok.hours!.paid).toBe(ok.hours!.recorded);
    expect(ok.hours!.normal + ok.hours!.ot + ok.hours!.restDay + ok.hours!.publicHoliday + ok.hours!.leave + ok.hours!.holiday).toBeCloseTo(ok.hours!.paid, 2);
    // The guard leaves two hours early on one locked shift.
    const a = (await store.list('attendance', { companyId: 'co-arsh' })).find((x) => x.personId === ok.personId && x.shiftId && x.locked && (x.clockIn ?? '').startsWith('2026-10'))!;
    await store.update('attendance', a.id, { clockOut: new Date(Date.parse(a.clockOut!) - 2 * 3_600_000).toISOString() });
    const run = await svc.prepareGuardPay(prep, 'co-arsh', '2026-10');
    const held = run.lines.find((l) => l.personId === ok.personId)!;
    expect(held.hours!.match).toBe(false);
    expect(held.hours!.recorded).toBe(ok.hours!.recorded - 2);
    expect(held.holds!.join(' ')).toMatch(/more than the hours recorded.*never paid for hours/);
    await expect(svc.setGuardPayLine(prep, run.id, held.personId, { pcb: 0 })).rejects.toThrow(/do not match hours recorded/);
    await expect(svc.guardPayStep(prep, run.id, 'submit')).rejects.toThrow(/Hours paid/);
    // The company excuses the early leave (its own record, reason and proof): the hours match again.
    await store.insert('attendanceFollowUps', {
      id: 'fu-test-early', companyId: 'co-arsh', siteId: a.siteId, postId: null, shiftId: a.shiftId, attendanceId: a.id, personId: a.personId, date: '2026-10-01',
      issue: 'EARLY_LEAVE', kind: 'EXCUSED', note: 'Synthetic: sent to hospital, letter attached', by: 'Test', byId: 'u-cm-arsh', at: NOW,
    } as never);
    const fixed = (await svc.prepareGuardPay(prep, 'co-arsh', '2026-10')).lines.find((l) => l.personId === ok.personId)!;
    expect(fixed.hours!.match).toBe(true);
  });
});
