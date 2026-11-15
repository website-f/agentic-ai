import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// A9 (Fitri package, Fauzan 11 Nov 2026): office overtime claims inside the staff payroll run, behind HR's switch.
// Synthetic data only: the generated mock dataset.
const TODAY = '2026-11-05';
const PERIOD = '2026-10';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.id !== `sp-${GROUP_EMPLOYER_ID}-${PERIOD}`);
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  const staff = ds.users.find((u) => {
    const p = ds.people.find((x) => x.id === u.personId);
    return !!p && p.companyId === GROUP_EMPLOYER_ID && p.role === 'office' && p.status === 'active' && (p.basicPay ?? 0) > 0 && u.department !== 'hr' && u.department !== 'chief_of_staff' && !u.opsTier;
  })!;
  return { ds, svc, staff };
}

describe('A9: office overtime claims', () => {
  it('claims, is approved by the head with a comment (never self), and is paid only while HR has overtime on', async () => {
    const { ds, svc, staff } = fresh();
    const me = await svc.user(staff.id);
    await expect(svc.requestOtClaim(me, { date: '2026-09-01', hours: 2, kind: 'normal', reason: 'Month-end close' })).rejects.toThrow(/last 30 days/);
    await expect(svc.requestOtClaim(me, { date: '2026-10-20', hours: 6, kind: 'normal', reason: 'Month-end close' })).rejects.toThrow(/0.5 to 4 hours/);
    const c = await svc.requestOtClaim(me, { date: '2026-10-20', hours: 2, kind: 'normal', reason: 'Month-end close' });
    await expect(svc.requestOtClaim(me, { date: '2026-10-20', hours: 1, kind: 'normal', reason: 'Again same day' })).rejects.toThrow(/already have/);
    await expect(svc.decideOtClaim(me, c.id, true, 'mine')).rejects.toBeInstanceOf(AccessDenied);
    let approver = null as null | Awaited<ReturnType<typeof svc.user>>;
    for (const u of ds.users) {
      if (u.id === staff.id) continue;
      const v = await svc.myOtClaims(await svc.user(u.id)).catch(() => null);
      if (v?.toDecide.some((x) => x.id === c.id)) {
        approver = await svc.user(u.id);
        break;
      }
    }
    expect(approver).not.toBeNull();
    await expect(svc.decideOtClaim(approver!, c.id, true, '')).rejects.toThrow(/comment/);
    await svc.decideOtClaim(approver!, c.id, true, 'Agreed, month-end');
    const hr = await svc.user('u-pwvsb-hr');
    const line = async () => (await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, PERIOD)).lines.find((l) => l.personId === staff.personId)!;
    const off = await line();
    expect(off.allowanceLines.some((a) => /Overtime 2026-10-20/.test(a.label))).toBe(false);
    expect(off.flags.join(' ')).toMatch(/Overtime claim 2026-10-20 .* not paid/);
    await svc.setStaffOvertime(hr, { enabled: true, normal: 1.5, restDay: 2, publicHoliday: 3, personIds: [staff.personId!], comment: 'Finance month-end overtime' });
    const on = await line();
    const ot = on.allowanceLines.find((a) => /Overtime 2026-10-20/.test(a.label))!;
    const basic = ds.people.find((p) => p.id === staff.personId)!.basicPay!;
    expect(ot.amount).toBeCloseTo(Math.round(((basic / 26 / 8) * 1.5 * 2) * 100) / 100, 2);
  });
});
