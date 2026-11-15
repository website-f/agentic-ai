import { describe, expect, it } from 'vitest';
import { GROUP_EMPLOYER_ID, MemoryStore, PrimaService, cmsOvertimeHours, generateDataset, myt, type CmsShift } from '../src';

// C12 (Fauzan, 11 Nov 2026): CMS control-room overtime into the staff payroll. Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');
const PERIOD = '2026-10';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  // A synthetic PWVSB office person behind the CMS Head Control account, with two 12-hour seats worked in October.
  const hrPerson = ds.users.find((u) => u.id === 'u-pwvsb-hr')!.personId;
  const person = ds.people.find((p) => p.companyId === GROUP_EMPLOYER_ID && p.role === 'office' && p.status === 'active' && p.id !== hrPerson && (p.basicPay ?? 0) > 0)!;
  ds.users.find((u) => u.id === 'u-cms-head')!.personId = person.id;
  const seat = (d: string, extra: Partial<CmsShift> = {}): CmsShift => ({
    id: `cms-test-${d}`, date: d, start: `${d}T07:00:00+08:00`, end: `${d}T19:00:00+08:00`, post: 'HEAD_CONTROL', seat: 9, staffName: 'x', staffId: 'cms-st-01',
    clockIn: `${d}T06:55:00+08:00`, clockOut: `${d}T19:05:00+08:00`, ...extra,
  });
  ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.id !== `sp-${GROUP_EMPLOYER_ID}-${PERIOD}`);
  ds.cmsShifts = ds.cmsShifts.filter((s) => !(s.staffId === 'cms-st-01' && s.date.startsWith(PERIOD)));
  ds.cmsShifts.push(seat('2026-10-05'), seat('2026-10-06', { clockOut: '2026-10-06T17:00:00+08:00' }));
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  return { ds, svc, person };
}

describe('C12: CMS overtime into the staff payroll', () => {
  it('counts the time on a seat past 8 hours and a 1-hour break, inside the shift', () => {
    const { ds } = fresh();
    // 12 hours on the first seat (3 OT), 10 hours on the second (1 OT).
    expect(cmsOvertimeHours(ds.cmsShifts, 'cms-st-01', PERIOD)).toEqual({ hours: 4, seats: 2 });
  });

  it('pays only approved overtime, once, and only when HR has switched overtime on for the person', async () => {
    const { svc, person } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const arms = await svc.user('u-pwvsb-arms');
    const otLines = (run: { lines: { personId: string; allowanceLines: { typeId?: string; amount: number }[]; flags: string[] }[] }) =>
      run.lines.find((l) => l.personId === person.id)!.allowanceLines.filter((a) => a.typeId === 'cms-ot');
    // Not approved yet: nothing on the payslip.
    expect(otLines(await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, PERIOD))).toHaveLength(0);
    // Only Arms Control approves, with a reason, never their own.
    await expect(svc.approveCmsOvertime(hr, { period: PERIOD, staffId: 'cms-st-01', reason: 'ok' })).rejects.toThrow();
    await expect(svc.approveCmsOvertime(await svc.user('u-cms-head'), { period: PERIOD, staffId: 'cms-st-01', reason: 'Mine' })).rejects.toThrow();
    await expect(svc.approveCmsOvertime(arms, { period: PERIOD, staffId: 'cms-st-01', reason: '' })).rejects.toThrow();
    const a = await svc.approveCmsOvertime(arms, { period: PERIOD, staffId: 'cms-st-01', reason: 'Covered the seat of a sick officer' });
    expect(a.hours).toBe(4);
    await expect(svc.approveCmsOvertime(arms, { period: PERIOD, staffId: 'cms-st-01', reason: 'Again please' })).rejects.toThrow(/already approved/);
    // Approved, but HR's overtime (HR-OT) is off for this person: flagged, not paid.
    const off = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, PERIOD);
    expect(otLines(off)).toHaveLength(0);
    expect(off.lines.find((l) => l.personId === person.id)!.flags.join(' ')).toMatch(/CMS overtime 4 hours approved .* not paid/);
    // HR switches overtime on for the person: paid once at 1.5x of basic / 26 / 8, not EPF wages.
    await svc.setStaffOvertime(hr, { enabled: true, normal: 1.5, restDay: 2, publicHoliday: 3, personIds: [person.id], comment: 'CMS officers paid overtime' });
    const on = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, PERIOD);
    const lines = otLines(on);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBeCloseTo(((person.basicPay ?? 0) / 26 / 8) * 1.5 * 4, 2);
    // Recalculating or HR editing the line keeps it once.
    expect(otLines(await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, PERIOD))).toHaveLength(1);
    const edited = await svc.setStaffPayLine(hr, on.id, person.id, { extra: [{ label: 'Synthetic one-off', amount: 50 }] });
    expect(edited.allowanceLines.filter((x) => x.typeId === 'cms-ot')).toHaveLength(1);
    // The board shows it as approved.
    const board = await svc.cmsOvertime(arms, PERIOD);
    expect(board.rows.find((r) => r.staffId === 'cms-st-01')!.approved!.by).toBe(arms.name);
  });
});
