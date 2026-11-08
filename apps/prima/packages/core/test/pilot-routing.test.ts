import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset } from '../src';

const TODAY = '2026-10-28';
const NOW = '2026-10-28T03:00:00.000Z';
let n = 0;
const doc = (name = `Receipt ${++n}.pdf`) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 r${++n}`).toString('base64')}` });

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

/**
 * Fauzan, 28 Oct 2026: "Check if the person want to do it is the button ready." Each pilot workflow, step by step:
 * the person whose turn it is has the action, and nobody else in the pilot does.
 */
describe('pilot routing: the right person has the button at each step', () => {
  it('staff claim: HR enters for IT staff, HR checks, the COO approves, the Finance Director pays', async () => {
    const { svc, ds } = fresh();
    const [hr, coo, fd, mgr, ex1] = await Promise.all(['u-pwvsb-hr', 'u-coo', 'u-fd', 'u-it-mgr', 'u-it-ex1'].map((id) => svc.user(id)));
    const c = await svc.submitStaffClaim(hr, { forPersonId: ex1.personId!, kind: 'MEDICAL', date: '2026-10-20', amount: 80, note: 'Clinic' } as never, [doc()]);
    const row = async (u: typeof hr) => (await svc.staffClaims(u)).queue.find((r) => r.claim.id === c.id);
    expect((await row(hr))?.canHr).toBe(true);
    expect((await row(coo))?.canCoo ?? false).toBe(false);
    expect(await row(mgr)).toBeUndefined();
    await svc.hrDecideClaim(hr, c.id, true, 'Checked');
    // The company head verifies too (Fauzan, 2 Nov 2026); only then may the COO approve.
    expect((await row(coo))?.canCoo ?? false).toBe(false);
    const head = await svc.user(c.headIds![0]);
    expect((await row(head))?.canHead).toBe(true);
    await svc.headVerifyClaim(head, c.id, true, 'Clinic visit on a work day');
    expect((await row(coo))?.canCoo).toBe(true);
    await svc.cooDecideClaim(coo, c.id, true, 'OK');
    expect((await row(fd))?.canPay).toBe(true);
    expect((await row(hr))?.canPay ?? false).toBe(false);
    await svc.financePayClaim(fd, c.id, 'MN-PAY-1');
    expect(ds.staffClaims.find((x) => x.id === c.id)!.paid).toBeTruthy();
    // The staff member sees it paid, but not the queue.
    const mine = await svc.staffClaims(ex1);
    expect(mine.mine.some((x) => x.id === c.id)).toBe(true);
    expect(mine.queue).toEqual([]);
  });

  it('trip before travel: HR asks for IT staff, the CEO approves for the Chief of Staff, the Finance Director only pays', async () => {
    const { svc } = fresh();
    const [hr, ceo, fd, ex2] = await Promise.all(['u-pwvsb-hr', 'u-fauzan', 'u-fd', 'u-it-ex2'].map((id) => svc.user(id)));
    const t = await svc.requestTrip(hr, { date: '2026-11-03', destination: 'Arrow Shield office, Shah Alam', purpose: 'CCTV recorder set-up', forPersonId: ex2.personId! });
    expect((await svc.staffClaims(ceo)).tripQueue.some((x) => x.id === t.id && x.status === 'pending')).toBe(true);
    expect((await svc.staffClaims(hr)).tripQueue).toEqual([]);
    expect((await svc.staffClaims(fd)).tripQueue).toEqual([]);
    await svc.decideTrip(ceo, t.id, true, 'ok');
  });

  it('mileage rates: someone in the pilot can publish the month’s rates', async () => {
    const { svc } = fresh();
    const [ceo, fd] = await Promise.all(['u-fauzan', 'u-fd'].map((id) => svc.user(id)));
    expect((await svc.staffClaims(ceo)).canSetRates).toBe(true);
    expect((await svc.staffClaims(fd)).canSetRates).toBe(false);
    await svc.setClaimRate(ceo, '2026-11', 'CAR', 0.6);
  });

  it('leave: an IT staff member asks, HR decides, the CEO consents for the Vice Chairman (Fauzan, 1 Nov 2026)', async () => {
    const { svc } = fresh();
    const [hr, ex3, mgr, ceo] = await Promise.all(['u-pwvsb-hr', 'u-it-ex3', 'u-it-mgr', 'u-fauzan'].map((id) => svc.user(id)));
    const q = await svc.requestLeave(ex3, { personId: ex3.personId!, kind: 'ANNUAL', from: '2026-11-10', to: '2026-11-11', reason: 'Family matter' });
    const hrRow = (await svc.leaveRequests(hr)).rows.find((r) => r.request.id === q.id)!;
    expect(hrRow.canDecide).toBe(true);
    expect(hrRow.mine).toBe(true);
    await expect(svc.leaveRequests(mgr).then((r) => r.rows.some((x) => x.request.id === q.id && x.canDecide))).resolves.toBe(false);
    await expect(svc.decideLeave(hr, q.id, true, '')).rejects.toThrow(/comment/);
    await svc.decideLeave(hr, q.id, true, 'Cover arranged');
    expect((await svc.leaveRequests(hr)).rows.find((r) => r.request.id === q.id)!.canDecide).toBe(false);
    const ceoRow = (await svc.leaveRequests(ceo)).rows.find((r) => r.request.id === q.id)!;
    expect(ceoRow.canDecide).toBe(true);
    expect(ceoRow.waitingWith?.level).toBe('VC');
    const done = await svc.decideLeave(ceo, q.id, true, 'Consent');
    expect(done.status).toBe('approved');
  });

  it('IT staff payroll: HR submits, the CEO approves for the Chief of Staff, the COO approves, the Finance Director pays; IT sees only own payslip', async () => {
    const { svc, ds } = fresh();
    const [hr, fd, coo, mgr, ceo] = await Promise.all(['u-pwvsb-hr', 'u-fd', 'u-coo', 'u-it-mgr', 'u-fauzan'].map((id) => svc.user(id)));
    const run = ds.staffPayRuns.find((r) => r.companyId === 'merdeka' && r.stage === 'draft')!;
    for (const l of run.lines) l.bank = l.bank ?? { bank: 'Maybank', account: '1140 0000 0000' } as never;
    const can = async (u: typeof hr) => (await svc.staffPayRun(u, run.id)).can;
    expect((await can(hr)).submit).toBe(true);
    expect((await can(fd)).submit).toBe(false);
    await svc.staffPayStep(hr, run.id, 'submit');
    expect((await can(ceo)).approve).toBe(true);
    expect((await can(fd)).approve).toBe(false);
    expect((await can(coo)).approve).toBe(false);
    await svc.staffPayStep(ceo, run.id, 'approve', { note: 'Checked' });
    expect((await can(coo)).cooApprove).toBe(true);
    expect((await can(ceo)).cooApprove).toBe(false);
    expect((await can(fd)).cooApprove).toBe(false);
    await svc.staffPayStep(coo, run.id, 'coo_approve', { note: 'OK' });
    expect((await can(fd)).pay).toBe(true);
    await svc.staffPayStep(fd, run.id, 'pay', { bankRef: 'MN-SAL-10', paidOn: TODAY, pcbChecked: true });
    await expect(svc.staffPayRun(mgr, run.id)).rejects.toThrow();
    const mine = (await svc.staffPayroll(mgr)).mine;
    expect(mine.every((m) => m.line.personId === mgr.personId)).toBe(true);
    expect(mine[0].companyName).toBe('Merdeka Network Sdn Bhd');
  });

  it('system access: IT asks, only the CEO decides', async () => {
    const { svc, ds } = fresh();
    const [ex1, ceo, coo] = await Promise.all(['u-it-ex1', 'u-fauzan', 'u-coo'].map((id) => svc.user(id)));
    const acc = ds.itAccounts[0];
    const who = ds.users.find((u) => u.department === 'hr' && !acc.access.some((a) => a.userId === u.id))!;
    const r = await svc.askItAccess(ex1, { accountId: acc.id, action: 'grant', userId: who.id, level: 'operator', reason: 'New HR executive' });
    const rows = async (u: typeof ex1) => (await svc.itBoard(u)).accessRequests ?? [];
    expect((await rows(ceo)).find((x) => x.request.id === r.id)?.canDecide).toBe(true);
    expect((await rows(coo)).find((x) => x.request.id === r.id)?.canDecide ?? false).toBe(false);
    await expect(svc.decideItAccess(coo, r.id, true, 'ok')).rejects.toThrow(/Only the CEO/);
    await svc.decideItAccess(ceo, r.id, true, 'ok');
  });

  it('device rental: only the Finance Director bills and records payment', async () => {
    const { svc } = fresh();
    const [fd, mgr, ex1] = await Promise.all(['u-fd', 'u-it-mgr', 'u-it-ex1'].map((id) => svc.user(id)));
    const b = await svc.itBoard(fd);
    expect(b.role).toBe('finance');
    expect(b.rental).toBeTruthy();
    expect((await svc.itBoard(mgr)).role).not.toBe('finance');
    const row = b.rental!.rows.find((r) => !r.bill)!;
    await expect(svc.itRentBill(mgr, row.companyId, b.rental!.period, 'INV-X')).rejects.toThrow();
    await svc.itRentBill(fd, row.companyId, b.rental!.period, 'MN-INV-77');
    expect((await svc.itBoard(ex1)).rental ?? null).toBeNull();
  });
});

describe('clean slate: the CEO fills the records (Fauzan, 28 Oct 2026)', () => {
  it('lets the CEO add any record kind for a chosen company, logged under his name, and nobody else outside their desk', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    expect(svc.recordKindsFor(ceo).length).toBe(Object.keys((await import('../src')).RECORD_KINDS).length);
    const pick = await svc.recordForm(ceo, 'itDomain', null, null);
    expect(pick.chooseCompany).toBeNull();
    const ex = await svc.user('u-it-ex1');
    expect(svc.recordKindsFor(ex)).toEqual(['itDomain']);
    const fd = await svc.user('u-fd');
    expect(svc.recordKindsFor(fd)).toEqual([]);
    const before = ds.audit.length;
    const site = await svc.recordForm(ceo, 'site', null, null);
    expect(site.chooseCompany!.length).toBeGreaterThan(30);
    expect(ds.audit.length).toBe(before);
  });
});
