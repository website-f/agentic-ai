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

  it('deducts it in payroll, lowers PCB by the same amount, totals it per body, and Finance pays exactly that', async () => {
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
    await svc.staffPayStep(hr, run.id, 'submit');
    await svc.staffPayStep(await svc.user('u-cos'), run.id, 'approve', { note: 'Checked (synthetic)' });
    await svc.staffPayStep(await svc.user('u-coo'), run.id, 'coo_approve', { note: 'Approved (synthetic)' });
    const fd = await svc.user('u-fd');
    expect((await svc.staffPayRun(fd, run.id)).totals.zakatByBody).toEqual({ 'Zakat Selangor': zakat });
    const list = await svc.staffPayExport(fd, run.id, 'zakat');
    expect(list.body).toContain(`Total Zakat Selangor,,,,,${zakat.toFixed(2)}`);
    expect((await svc.staffPayExport(fd, run.id, 'sql')).body).toContain(`Zakat payable to Zakat Selangor ${P}`);
    // Finance's payment to Zakat Selangor for this wage month must equal what payroll deducted.
    const [de1, dep] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep'].map((id) => svc.user(id)));
    const F = ds.finStatus.find((f) => f.companyId === GROUP_EMPLOYER_ID)!;
    const reg = (await svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'add', {
      kind: 'zakat', body: 'Zakat Selangor', zakatFor: 'staff', name: 'Staff zakat (mock)', payeeId: 'payee-pwvsb-001', reference: 'LZS majikan 1 (mock)', method: 'transfer', bankId: F.banks[0].id, every: 'monthly', dueDay: 15, firstDue: '2026-11-15',
    })) as { id: string };
    await svc.financeControls.regularAction(dep, GROUP_EMPLOYER_ID, 'check', { regularId: reg.id, comment: 'Agreed to LZS employer letter (mock)' });
    await expect(svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'bill', { regularId: reg.id, period: '2026-11', amount: zakat + 50, doc: 'LZS list.pdf' })).rejects.toThrow(/payroll deducted/);
    await svc.financeControls.regularAction(de1, GROUP_EMPLOYER_ID, 'bill', { regularId: reg.id, period: '2026-11', amount: zakat, doc: 'LZS list.pdf' });
  });
});
