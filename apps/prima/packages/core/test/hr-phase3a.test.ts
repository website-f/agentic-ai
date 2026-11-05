// HR Phase 3, slice 3A (Fauzan, 1 Nov 2026): HR governs and companies monitor; staff leave needs HR then the Vice
// Chairman's consent; staff payroll needs the Chief of Staff then the COO; a salary amount needs the HR Director then
// the Vice Chairman's consent; every HR approval needs a comment. Mock data only, never staging.
import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, generateDataset, inHrRollout, isHrAdmin, myt } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
let n = 0;
const doc = () => ({ kind: 'document' as const, name: `Paper ${++n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 hr ${n}`).toString('base64')}` });

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

describe('HR governs, the company monitors (Fauzan, 1 Nov 2026)', () => {
  it("refuses the company manager and admin executive on an office staff member's HR file, and lets HR keep it", async () => {
    const { svc, ds } = fresh();
    const [cm, ae, hr] = await Promise.all(['u-cm-arsh', 'u-ae-arsh', 'u-pwvsb-hr'].map((id) => svc.user(id)));
    const staff = ds.people.find((p) => p.companyId === 'co-arsh' && p.role === 'office' && p.status === 'active' && p.id !== cm.personId && p.id !== ae.personId)!;
    // The company still sees the file, view only.
    const view = await svc.guardProfile(cm, staff.id);
    expect(view.hiring.canUpload).toBe(false);
    await expect(svc.uploadHiringDoc(cm, staff.id, 'AGREEMENT', [doc()])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.uploadHiringDoc(ae, staff.id, 'AGREEMENT', [doc()])).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.guardProfile(hr, staff.id)).hiring.canUpload).toBe(true);
    await svc.uploadHiringDoc(hr, staff.id, 'AGREEMENT', [doc()]);
    // Guards stay with their company (they come from the JA Group app).
    const guard = ds.people.find((p) => p.companyId === 'co-arsh' && p.role === 'guard' && p.status === 'active')!;
    expect((await svc.guardProfile(cm, guard.id)).hiring.canUpload).toBe(true);
  });

  it('refuses the company manager asking for an office staff member’s leave unless they are the line manager', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const staff = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'office' && p.status === 'active' && p.id !== cm.personId && (p.reportsTo ?? '').trim().toLowerCase() !== cm.name.trim().toLowerCase())!;
    await expect(
      svc.requestLeave(cm, { personId: staff.id, kind: 'ANNUAL', from: '2026-11-10', to: '2026-11-10', reason: 'Family matter' }),
    ).rejects.toBeInstanceOf(AccessDenied);
    staff.reportsTo = cm.name;
    await expect(svc.requestLeave(cm, { personId: staff.id, kind: 'ANNUAL', from: '2026-11-10', to: '2026-11-10', reason: 'Family matter' })).resolves.toBeDefined();
  });

  it('lets the company only view an office staff member’s SOCSO claims; HR starts them', async () => {
    const { svc, ds } = fresh();
    const [cm, hr] = await Promise.all(['u-cm-sasa', 'u-pwvsb-hr'].map((id) => svc.user(id)));
    const staff = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'office' && p.status === 'active' && p.nationality === 'MY' && p.id !== cm.personId)!;
    const input = { type: 'WORK_ACCIDENT' as const, incidentAt: '2026-10-25T09:00:00+08:00', toldAt: '2026-10-25T10:00:00+08:00', place: 'Office', description: 'Slipped on the stairs' };
    await expect(svc.startSocsoClaim(cm, staff.id, input)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.startSocsoClaim(hr, staff.id, input)).resolves.toBeDefined();
  });
});

describe('Staff leave: HR decides, the Vice Chairman consents (Fauzan, 1 Nov 2026)', () => {
  async function staffLeave() {
    const f = fresh();
    const staff = f.ds.people.find((p) => p.companyId === GROUP_EMPLOYER_ID && p.role === 'office' && p.status === 'active' && f.ds.users.some((u) => u.personId === p.id && u.department === 'it'))
      ?? f.ds.people.find((p) => p.role === 'office' && p.status === 'active' && f.ds.users.some((u) => u.personId === p.id && u.department === 'it'))!;
    const asker = f.ds.users.find((u) => u.personId === staff.id)!;
    const q = await f.svc.requestLeave(asker, { personId: staff.id, kind: 'ANNUAL', from: '2026-11-10', to: '2026-11-11', reason: 'Family matter' });
    return { ...f, q, asker };
  }

  it('needs a comment from HR, keeps the request pending, and lets only the Vice Chairman finish it', async () => {
    const { svc, ds, q, asker } = await staffLeave();
    const [hr, cos, coo, vc, fd, cm] = await Promise.all(['u-pwvsb-hr', 'u-cos', 'u-coo', 'u-vchair', 'u-fd', 'u-cm-sasa'].map((id) => svc.user(id)));
    await expect(svc.decideLeave(hr, q.id, true, '  ')).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.decideLeave(vc, q.id, true, 'Consent')).rejects.toBeInstanceOf(AccessDenied);
    const after = await svc.decideLeave(hr, q.id, true, 'Cover arranged');
    expect(after.status).toBe('pending');
    expect(after.hrApproval?.note).toBe('Cover arranged');
    // After HR's approval nobody but the Vice Chairman acts: not HR again, the HR Director, the COO, Finance or the company.
    for (const u of [hr, cos, coo, fd, cm, asker]) await expect(svc.decideLeave(u, q.id, true, 'x')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideLeave(vc, q.id, true, '')).rejects.toBeInstanceOf(BadRequest);
    // It is on the Vice Chairman's home to consent.
    const home = await svc.home(vc);
    expect(home.todo.some((t) => t.tag === 'Staff leave' && t.title.includes('to consent'))).toBe(true);
    const done = await svc.decideLeave(vc, q.id, true, 'Consent');
    expect(done.status).toBe('approved');
    expect(ds.audit.some((e) => e.action === 'leave.hr_approve')).toBe(true);
    expect(ds.audit.some((e) => e.action === 'leave.vc_consent')).toBe(true);
  });

  it('lets the Vice Chairman refuse with a reason, and HR reject outright', async () => {
    const { svc, q } = await staffLeave();
    const [hr, vc] = await Promise.all(['u-pwvsb-hr', 'u-vchair'].map((id) => svc.user(id)));
    await svc.decideLeave(hr, q.id, true, 'Cover arranged');
    await expect(svc.decideLeave(vc, q.id, false, '')).rejects.toBeInstanceOf(BadRequest);
    expect((await svc.decideLeave(vc, q.id, false, 'Busy month-end; take it next week')).status).toBe('rejected');
    const second = await staffLeave();
    const hr2 = await second.svc.user('u-pwvsb-hr');
    expect((await second.svc.decideLeave(hr2, second.q.id, false, 'Overlaps the audit')).status).toBe('rejected');
  });

  it('never lets the CEO, standing in for the Vice Chairman, consent to leave he approved for HR', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    const staff = ds.people.find((p) => p.companyId === GROUP_EMPLOYER_ID && p.role === 'office' && p.status === 'active' && ds.users.some((u) => u.personId === p.id))!;
    const asker = ds.users.find((u) => u.personId === staff.id)!;
    const q = await svc.requestLeave(asker, { personId: staff.id, kind: 'ANNUAL', from: '2026-11-12', to: '2026-11-12', reason: 'Errand' });
    await svc.decideLeave(ceo, q.id, true, 'OK');
    await expect(svc.decideLeave(ceo, q.id, true, 'Consent')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.decideLeave(await svc.user('u-vchair'), q.id, true, 'Consent')).status).toBe('approved');
  });

  it('leaves guard and officer leave unchanged: the OM decides in one step', async () => {
    const { svc, ds } = fresh();
    const q = ds.leaveRequests.find((r) => r.status === 'pending' && ds.people.find((p) => p.id === r.personId)!.role === 'guard' && r.kind === 'ANNUAL')!;
    const p = ds.people.find((x) => x.id === q.personId)!;
    const om = ds.users.find((u) => u.opsTier === 'om' && u.areaStates!.includes(ds.branches.find((b) => b.id === p.branchId)!.state))!;
    expect((await svc.decideLeave(om, q.id, true, '')).status).toBe('approved');
  });
});

describe('Salary amounts and the monthly payroll (Fauzan, 1 Nov 2026)', () => {
  async function payRise() {
    const f = fresh();
    const hr = await f.svc.user('u-pwvsb-hr');
    const staff = f.ds.users.find((u) => u.department === 'it' && u.personId)!;
    const values = (await f.svc.recordForm(hr, 'officeStaff', staff.personId!, null)).values;
    const before = Number(values.basicPay);
    await f.svc.saveRecord(hr, 'officeStaff', staff.personId!, null, { ...values, basicPay: before + 300, payReason: 'Yearly review' });
    const pc = f.ds.payChanges.find((c) => c.personId === staff.personId && c.kind === 'PAY' && c.status === 'pending')!;
    return { ...f, hr, staff, before, pc };
  }

  it('needs the HR Director with a comment, then the Vice Chairman’s consent, before the new pay applies', async () => {
    const { svc, ds, staff, before, pc } = await payRise();
    const [cos, dcos, vc, fd, coo] = await Promise.all(['u-cos', 'u-dcos', 'u-vchair', 'u-fd', 'u-coo'].map((id) => svc.user(id)));
    await expect(svc.decidePayChange(vc, pc.id, true, 'Consent')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decidePayChange(cos, pc.id, true, '')).rejects.toBeInstanceOf(BadRequest);
    await svc.decidePayChange(cos, pc.id, true, 'Within the pay band');
    const pending = ds.payChanges.find((c) => c.id === pc.id)!;
    expect(pending.status).toBe('pending');
    expect(pending.hrDirectorCheck?.note).toBe('Within the pay band');
    expect(ds.people.find((p) => p.id === staff.personId)!.basicPay).toBe(before);
    // Only the Vice Chairman consents now: not the Deputy, Finance or the COO.
    for (const u of [cos, dcos, fd, coo]) await expect(svc.decidePayChange(u, pc.id, true, 'x')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decidePayChange(vc, pc.id, true, '')).rejects.toBeInstanceOf(BadRequest);
    expect((await svc.home(vc)).todo.some((t) => t.tag === 'Salary' && t.title.includes('to consent'))).toBe(true);
    await svc.decidePayChange(vc, pc.id, true, 'Consent');
    expect(ds.people.find((p) => p.id === staff.personId)!.basicPay).toBe(before + 300);
    expect(ds.audit.some((e) => e.action === 'pay.change.consent')).toBe(true);
  });

  it('lets the Deputy Chief of Staff verify in place of the Chief of Staff', async () => {
    const { svc, ds, pc } = await payRise();
    await svc.decidePayChange(await svc.user('u-dcos'), pc.id, true, 'Checked');
    expect(ds.payChanges.find((c) => c.id === pc.id)!.hrDirectorCheck?.byId).toBe('u-dcos');
  });

  it('runs the month through the Chief of Staff and then the COO; the Vice Chairman and Finance Director cannot approve it', async () => {
    const { svc, ds } = fresh();
    const [hr, cos, dcos, coo, vc, fd] = await Promise.all(['u-pwvsb-hr', 'u-cos', 'u-dcos', 'u-coo', 'u-vchair', 'u-fd'].map((id) => svc.user(id)));
    const run = ds.staffPayRuns.find((r) => r.stage === 'submitted')!;
    expect((await svc.staffPayRun(dcos, run.id)).can.approve).toBe(true);
    expect((await svc.staffPayRun(vc, run.id)).can.approve).toBe(false);
    expect((await svc.staffPayRun(hr, run.id)).can.approve).toBe(false);
    await expect(svc.staffPayStep(vc, run.id, 'approve', { note: 'x' })).rejects.toBeInstanceOf(BadRequest);
    await svc.staffPayStep(cos, run.id, 'approve', { note: 'Checked' });
    for (const u of [cos, vc, fd, hr]) expect((await svc.staffPayRun(u, run.id)).can.cooApprove).toBe(false);
    expect((await svc.staffPayRun(coo, run.id)).can.cooApprove).toBe(true);
    const done = await svc.staffPayStep(coo, run.id, 'coo_approve', { note: 'Approved' });
    expect(done.stage).toBe('coo_approved');
    expect(done.approved?.note).toBe('Checked');
  });
});

describe('HR rollout switch (Fauzan, 1 Nov 2026)', () => {
  it('admits only the Chief of Staff, the Deputy and the Vice Chairman, and never a system feed', async () => {
    const { ds } = fresh();
    const u = (id: string) => ds.users.find((x) => x.id === id)!;
    expect(['u-cos', 'u-dcos', 'u-vchair'].every((id) => inHrRollout(u(id)))).toBe(true);
    for (const id of ['u-pwvsb-hr', 'u-fd', 'u-chair', 'u-cm-sasa', 'u-it-ex1', 'u-coo']) expect(inHrRollout(u(id))).toBe(false);
    expect(inHrRollout({ ...u('u-cos'), integration: 'ja' as const })).toBe(false);
    expect(isHrAdmin(u('u-pwvsb-hr'))).toBe(true);
    expect(isHrAdmin(u('u-cos'))).toBe(false);
  });
});
