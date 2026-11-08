import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, generateDataset, myt } from '../src';

// Zakat by salary deduction, the staff member's own choice (Fauzan, 2 Nov 2026: "staff can choose what they want and
// how much the percentage of it"). Dummy data only, never staging.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const P = TODAY.slice(0, 7);

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.id !== `sp-${GROUP_EMPLOYER_ID}-${P}`);
  for (const p of ds.people.filter((x) => x.companyId === GROUP_EMPLOYER_ID && !x.bank)) p.bank = { bank: 'Maybank', accountMasked: '****0001' };
  // A central staff member who is not in HR, Finance or an approver.
  const staff = ds.users.find((u) => {
    const p = u.personId && ds.people.find((x) => x.id === u.personId);
    return p && p.role === 'office' && p.status === 'active' && p.companyId === GROUP_EMPLOYER_ID && !['u-pwvsb-hr', 'u-cos', 'u-vchair', 'u-fd', 'u-fauzan'].includes(u.id) && !u.financeRole && (p.basicPay ?? 0) > 3000;
  })!;
  return { ds, svc, staffId: staff.id, personId: staff.personId! };
}

describe('zakat by salary deduction, chosen by the staff member', () => {
  it('lets only the staff member choose the body and percentage, within the limits, and keeps every change', async () => {
    const { svc, ds, staffId, personId } = fresh();
    const me = await svc.user(staffId);
    await expect(svc.setMyZakat(me, { body: 'Zakat Johor', percent: 2.5 })).rejects.toThrow(/Choose one of/);
    await expect(svc.setMyZakat(me, { body: 'Zakat Selangor', percent: 40 })).rejects.toThrow(/0.5% to 25%/);
    await expect(svc.setMyZakat(me, { body: 'Zakat Selangor', percent: 2.555 })).rejects.toThrow(/2 decimal/);
    await svc.setMyZakat(me, { body: 'Zakat Selangor', percent: 2.5 });
    expect(ds.people.find((p) => p.id === personId)!.zakat).toMatchObject({ body: 'Zakat Selangor', percent: 2.5, set: { byId: staffId } });
    // HR's own call changes HR's own record only; guards have no staff payroll.
    const hr = await svc.user('u-pwvsb-hr');
    await svc.setMyZakat(hr, { body: 'Zakat Kedah', percent: 3 });
    expect(ds.people.find((p) => p.id === personId)!.zakat!.body).toBe('Zakat Selangor');
    await expect(svc.setMyZakat(await svc.user('u-guard-sasa-1'), { body: 'Zakat Kedah', percent: 3 })).rejects.toBeInstanceOf(AccessDenied);
    await svc.setMyZakat(me, { body: null });
    const v = await svc.myZakat(me);
    expect(v.choice).toBeNull();
    expect(v.history.map((h) => h.body)).toEqual([null, 'Zakat Selangor']);
  });

  it('previews and binds the election but blocks final payroll and exports pending verified policy', async () => {
    const { svc, ds, staffId, personId } = fresh();
    const me = await svc.user(staffId);
    const hr = await svc.user('u-pwvsb-hr');
    const before = (await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, P)).lines.find((l) => l.personId === personId)!;
    await svc.setMyZakat(me, { body: 'Zakat Selangor', percent: 2.5 });
    const run = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, P);
    const l = run.lines.find((x) => x.personId === personId)!;
    const zakat = Math.round(l.gross * 2.5) / 100;
    expect([l.zakat, l.zakatBody, l.zakatPercent]).toEqual([zakat, 'Zakat Selangor', 2.5]);
    expect(l.pcbBeforeZakat).toBe(before.pcb);
    expect(l.pcb).toBeCloseTo(Math.max(0, before.pcb - zakat), 2);
    // Net pay goes down only by the part of the zakat not covered by the PCB rebate.
    expect(l.net).toBeCloseTo(before.net - zakat + (before.pcb - l.pcb), 2);
    expect(l.inputs).not.toBe(before.inputs);
    await expect(svc.staffPayStep(hr, run.id, 'submit')).rejects.toThrow(/draft-only/);
    const fd = await svc.user('u-fd');
    expect((await svc.staffPayRun(fd, run.id)).totals.zakatByBody).toEqual({ 'Zakat Selangor': zakat });
    for (const kind of ['zakat', 'sql', 'bank', 'epf', 'socso', 'pcb'] as const)
      await expect(svc.staffPayExport(fd, run.id, kind)).rejects.toThrow(/draft-only/);
    const stored = ds.staffPayRuns.find(r => r.id === run.id)!;
    expect(stored.stage).toBe('draft');
    // An old/imported advanced stage cannot bypass the policy gate.
    stored.stage = 'submitted';
    await expect(svc.staffPayStep(await svc.user('u-cos'), run.id, 'approve', {note:'Reviewed draft'})).rejects.toThrow(/draft-only/);
    stored.stage = 'approved';
    await expect(svc.staffPayStep(await svc.user('u-coo'), run.id, 'coo_approve', {note:'Reviewed draft'})).rejects.toThrow(/draft-only/);
    stored.stage = 'coo_approved';
    await expect(svc.staffPayStep(await svc.user('u-fin-t1-de1'), run.id, 'pay', {bankRef:'MUST-NOT-PAY',pcbChecked:true,paidOn:TODAY})).rejects.toThrow(/draft-only/);
    expect(stored.paid).toBeNull();
    stored.stage = 'draft';

  });
});
