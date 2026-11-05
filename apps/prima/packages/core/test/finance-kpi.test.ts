import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, finOfficeMinutes, finSettingsAt, generateDataset, myt } from '../src';

// Finance KPIs (Fauzan, 1 Nov 2026: "for now we need speed and quality to be measured ... measured from work or task
// comes to them ... team leader, FD, CEO, COO, ACT director and HR department"). Dummy data only, never staging.
const T1 = GROUP_EMPLOYER_ID;
const at = (d: string, t: string) => myt(d, t);

function setup() {
  const ds = generateDataset({ today: '2026-11-30', now: at('2026-11-30', '10:00') });
  // Only this test's payments and closes count.
  for (const f of ds.finStatus) {
    f.payments = [];
    f.closes = [];
  }
  let now = at('2026-11-02', '09:00');
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  return { ds, svc, setNow: (x: string) => (now = x), F: () => ds.finStatus.find((x) => x.companyId === T1)! };
}

describe('Finance KPIs: speed from when the work reaches each person, and quality', () => {
  it('times each stage from the previous step, keeps staff and checkers apart, counts returns against the preparer, never ranks', async () => {
    const { svc, setNow, F } = setup();
    const [de, de2, dep, fd] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-fd'].map((id) => svc.user(id)));
    const base = { payeeId: 'payee-pwvsb-001', purpose: 'KPI', dueOn: '2026-11-30', bankId: F().banks[0].id, evidence: ['i.pdf'] };
    // Office minutes (Fauzan, 1 Nov 2026: targets in minutes). 2 Nov 2026 is a Monday.
    // A: reviewed 10 min after it was prepared (target 15), approved 40 min after review (not timed), released 15 min after approval.
    setNow(at('2026-11-02', '09:00'));
    const a = await svc.finance.createPayment(de, T1, { ...base, amount: 10, sqlRef: 'PI-KPI-A' });
    setNow(at('2026-11-02', '09:10'));
    await svc.finance.paymentStep(dep, T1, a.id, 'review', { comment: 'ok' });
    setNow(at('2026-11-02', '09:50'));
    await svc.finance.paymentStep(fd, T1, a.id, 'approve', { comment: 'ok' });
    setNow(at('2026-11-02', '10:05'));
    await svc.finance.paymentStep(de2, T1, a.id, 'release', { bankRef: 'M2U-KPI-A', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });
    // B: returned once (reason kept), reworked in 15 min, reviewed the next morning (500 office minutes: late), then quick.
    setNow(at('2026-11-04', '09:00'));
    const b = await svc.finance.createPayment(de, T1, { ...base, amount: 20, sqlRef: 'PI-KPI-B' });
    setNow(at('2026-11-04', '09:05'));
    await svc.finance.paymentStep(dep, T1, b.id, 'return', { comment: 'Attach the delivery order.' });
    setNow(at('2026-11-04', '09:20'));
    await svc.finance.paymentStep(de, T1, b.id, 'resubmit', { comment: 'Attached.' });
    setNow(at('2026-11-05', '08:40'));
    await svc.finance.paymentStep(dep, T1, b.id, 'review', { comment: 'ok' });
    setNow(at('2026-11-05', '08:50'));
    await svc.finance.paymentStep(fd, T1, b.id, 'approve', { comment: 'ok' });
    setNow(at('2026-11-05', '09:00'));
    await svc.finance.paymentStep(de2, T1, b.id, 'release', { bankRef: 'M2U-KPI-B', accountLast4: '1000', accountName: 'SYARIKAT BEKALAN PEJABAT' });

    const v = await svc.financeKpi.view(fd, '2026-11');
    expect(v.provisional).toBe(true);
    const st = Object.fromEntries(v.overall.stages.map((x) => [x.stage, x]));
    expect(st.review).toMatchObject({ count: 2, checking: true, medianMinutes: 255, targetMinutes: 15, onTimePct: 50 }); // 10 and 500
    expect(st.approve).toBeUndefined(); // approvals are not timed (Fauzan, 1 Nov 2026)
    expect(v.notTimed.join(' ')).toMatch(/Approvals/);
    expect(st.release).toMatchObject({ count: 2, medianMinutes: 12.5, onTimePct: 100 });
    expect(st.rework).toMatchObject({ count: 1, checking: false, medianMinutes: 15, targetMinutes: 20, onTimePct: 100 }); // staff work
    expect(v.overall.quality.payments).toEqual({ finished: 2, firstPassPct: 50, returnCycles: 1, lapses: 0 });
    expect(v.preparers).toEqual([{ id: 'u-fin-t1-de1', by: expect.any(String), team: 1, finished: 2, firstPassPct: 50, returns: 1, reasons: ['Attach the delivery order.'] }]);
    // The reviewer's figures are about checking; the return did not count against the reviewer's first pass.
    const rev = v.people.find((p) => p.id === 'u-fin-t1-dep')!;
    expect(rev.stages.map((x) => x.stage)).toEqual(['review']);
    expect(v.people.some((p) => p.id === 'u-fd')).toBe(false); // the approver is not timed
    expect(v.preparers.some((p) => p.id === 'u-fin-t1-dep')).toBe(false);
    // Listed by name, not by speed.
    expect(v.people.map((p) => p.name)).toEqual([...v.people.map((p) => p.name)].sort((x, y) => x.localeCompare(y)));
    expect(v.unknown.join(' ')).toMatch(/Time to prepare a payment/);
    expect(v.note).toMatch(/never used to grant access or for any automatic employment or pay decision/);
  });

  it('is seen by the team leader (own team), FD, CEO, COO, ACT Director and HR department only', async () => {
    const { svc } = setup();
    for (const id of ['u-fd', 'u-fauzan', 'u-coo', 'u-audit', 'u-pwvsb-hr', 'u-cos', 'u-dcos']) expect((await svc.financeKpi.view(await svc.user(id))).scope).toBe('all');
    expect((await svc.financeKpi.view(await svc.user('u-fin-t1-lead'))).scope).toBe('team 1');
    // No standing self-view: staff, including the people timed, are refused (they see results only in an HR review).
    for (const id of ['u-fin-t1-de1', 'u-fin-t1-de2', 'u-fin-t1-dep', 'u-it-mgr', 'u-chair']) await expect(svc.financeKpi.view(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('holds each step against the target version in force when it happened; targets are FD/CEO settings', async () => {
    const { svc, ds, setNow } = setup();
    const fd = await svc.user('u-fd');
    setNow(at('2026-11-10', '09:00'));
    await svc.finance.setSettings(fd, { values: { kpiReviewMinutes: 10 }, comment: 'Provisional, to calibrate in the pilot.' });
    await expect(svc.finance.setSettings(await svc.user('u-fin-t1-lead'), { values: { kpiReviewMinutes: 100 }, comment: 'x' })).rejects.toThrow(/Finance Director or the CEO/);
    const g = ds.finStatus.find((x) => x.companyId === T1)!;
    expect(finSettingsAt(g, at('2026-11-09', '09:00')).kpiReviewMinutes).toBe(15);
    expect(finSettingsAt(g, at('2026-11-11', '09:00')).kpiReviewMinutes).toBe(10);
  });

  it('counts office minutes only: Monday to Friday, 8.30 am to 5.30 pm', () => {
    expect(finOfficeMinutes(at('2026-11-02', '09:00'), at('2026-11-02', '09:20'))).toBe(20);
    expect(finOfficeMinutes(at('2026-11-02', '17:00'), at('2026-11-03', '09:00'))).toBe(60); // overnight
    expect(finOfficeMinutes(at('2026-11-06', '17:00'), at('2026-11-09', '09:00'))).toBe(60); // Friday to Monday
    expect(finOfficeMinutes(at('2026-11-07', '10:00'), at('2026-11-07', '12:00'))).toBe(0); // Saturday
    expect(finOfficeMinutes(at('2026-11-02', '07:00'), at('2026-11-02', '08:45'))).toBe(15);
  });
});
