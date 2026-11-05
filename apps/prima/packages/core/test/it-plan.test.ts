import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, planPeriod } from '../src';

// The IT plan (Fauzan, 28 Oct 2026), the working hours and the IT team's clock.
const TODAY = '2026-10-28';
const NOW = myt(TODAY, '10:30');
const fresh = (now = NOW) => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => now) };
};

describe('IT work plan', () => {
  it('splits a week into days, a month into weeks and a year into months', () => {
    expect(planPeriod('week', TODAY).buckets.map((b) => b.from)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    const m = planPeriod('month', TODAY);
    expect([m.from, m.to, m.buckets[0].from, m.buckets.at(-1)!.to]).toEqual(['2026-10-01', '2026-10-31', '2026-10-01', '2026-10-31']);
    expect(planPeriod('year', TODAY).buckets).toHaveLength(12);
  });

  it('lays out the regular work, and a job given from the plan covers it once', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const year = await svc.itPlan(mgr, 'year');
    expect(year.canPlan).toBe(true);
    for (const w of ['service', 'check', 'access'] as const) expect(year.dues.some((d) => d.what === w)).toBe(true);
    const month = await svc.itPlan(mgr, 'month');
    const d = month.dues.find((x) => x.what !== 'tender' && !x.jobId)!;
    expect(d).toBeTruthy();
    const job = (await svc.itAct(mgr, 'giveJob', { kind: d.jobKind, title: d.title, detail: d.detail, priority: 'P3', technical: d.technical, assigneeId: 'u-it-ex1', dueOn: d.dueOn, planKey: d.key })) as { id: string };
    const after = await svc.itPlan(mgr, 'month');
    expect(after.dues.find((x) => x.key === d.key)!.jobId).toBe(job.id);
    expect(after.load.find((r) => r.id === 'u-it-ex1')!.total).toBeGreaterThan(0);
    await expect(svc.itAct(mgr, 'giveJob', { kind: d.jobKind, title: d.title, priority: 'P3', assigneeId: 'u-it-ex2', dueOn: d.dueOn, planKey: d.key })).rejects.toThrow(/already been given/);
  });

  it('lets the team, the COO, the CEO and ACT look, but only the IT Manager and IT Lead plan', async () => {
    const { svc } = fresh();
    for (const id of ['u-it-ex1', 'u-coo', 'u-fauzan', 'u-audit']) expect((await svc.itPlan(await svc.user(id), 'week')).canPlan).toBe(false);
    expect((await svc.itPlan(await svc.user('u-it-lead'), 'week')).canPlan).toBe(true);
  });
});

describe('Staff working hours and the IT team clock', () => {
  it('flags a late first clock-in and a break over one hour', async () => {
    const { svc, ds } = fresh(myt(TODAY, '08:45'));
    // The mock data has IT Executive 1 working from home and clocked in already; start the day clean.
    ds.staffClocks = ds.staffClocks.filter((c) => c.userId !== 'u-it-ex1' || c.in.receivedAt.slice(0, 10) !== TODAY);
    const ex = await svc.user('u-it-ex1');
    await svc.staffSessionStart(ex);
    const mgr = await svc.user('u-it-mgr');
    const board = await svc.staffClockBoard(mgr);
    expect(board.viewOnly).toBe(true);
    expect(board.rows.every((r) => r.userId.startsWith('u-it-'))).toBe(true);
    const row = board.rows.find((r) => r.userId === 'u-it-ex1')!;
    expect(row.hours?.late).toBe(true);
    expect(row.hours?.lateMin).toBe(15);
    expect(board.hours).toEqual({ start: '08:30', end: '17:30', breakMin: 60 });
  });

  it('keeps other staff out of the IT Manager view, and IT staff out of the board', async () => {
    const { svc } = fresh();
    await expect(svc.staffClockBoard(await svc.user('u-it-ex1'))).rejects.toThrow();
    const hr = await svc.staffClockBoard(await svc.user('u-pwvsb-hr'));
    expect(hr.viewOnly).toBe(false);
    expect(hr.rows.some((r) => !r.userId.startsWith('u-it-'))).toBe(true);
  });
});

describe('Pilot phase 1: HR enters for IT staff, Finance pays, Merdeka Network', () => {
  it('lets HR enter a claim for an IT staff member, and the Finance Director pays it after the COO', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const ex = await svc.user('u-it-ex2');
    const board = await svc.staffClaims(hr);
    expect(board.enterFor.map((p) => p.id)).toContain(ex.personId);
    const pdf = [{ kind: 'document' as const, name: 'receipt.pdf', data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 r1').toString('base64')}` }];
    const c = await svc.submitStaffClaim(hr, { forPersonId: ex.personId!, kind: 'MEDICAL', date: TODAY, amount: 80 }, pdf);
    expect(c.personName).toBe(ex.name);
    expect(c.enteredBy?.userId).toBe('u-pwvsb-hr');
    expect(c.companyId).toBe('merdeka');
    // Not for staff outside the IT team during the pilot.
    const other = ds.users.find((u) => u.department === 'finance' && u.personId)!;
    await expect(svc.submitStaffClaim(hr, { forPersonId: other.personId!, kind: 'MEDICAL', date: TODAY, amount: 80 }, pdf)).rejects.toThrow(/IT team only/);
    await svc.hrDecideClaim(hr, c.id, true, '');
    await svc.headVerifyClaim(await svc.user(c.headIds![0]), c.id, true, 'Verified');
    await svc.cooDecideClaim(await svc.user('u-coo'), c.id, true, '');
    const fd = await svc.user('u-fd');
    expect((await svc.staffClaims(fd)).queue.find((r) => r.claim.id === c.id)!.canPay).toBe(true);
    await svc.financePayClaim(fd, c.id, 'TRF-0001');
    await expect(svc.financePayClaim(fd, c.id, 'TRF-0002')).rejects.toThrow(/already paid/);
  });

  it('bills each company its device rent from Merdeka, issued and paid by the Finance Director', async () => {
    const { svc } = fresh();
    const fd = await svc.user('u-fd');
    const b = await svc.itBoard(fd);
    const row = b.rental!.rows.find((r) => !r.bill)!;
    expect(b.rental!.owner).toBe('Merdeka Network Sdn Bhd');
    expect(b.rental!.bills.length).toBeGreaterThan(0);
    const bill = (await svc.itAct(fd, 'rentBill', { companyId: row.companyId, period: b.rental!.period, invoiceRef: 'MN-INV-TEST' })) as { id: string; total: number };
    expect(bill.total).toBe(row.total);
    await expect(svc.itAct(fd, 'rentBill', { companyId: row.companyId, period: b.rental!.period, invoiceRef: 'MN-INV-TEST2' })).rejects.toThrow(/already billed/);
    await expect(svc.itAct(fd, 'rentPaid', { id: bill.id, ref: 'TRF-9' })).rejects.toThrow(/scoped/);
    fd.companyIds = [row.companyId]; // Explicit synthetic assignment; production scope is not auto-granted.
    await svc.itAct(fd, 'rentPaid', { id: bill.id, ref: 'TRF-9' });
    await expect(svc.itAct(await svc.user('u-it-mgr'), 'rentBill', { companyId: row.companyId, period: b.rental!.period, invoiceRef: 'X123' })).rejects.toThrow();
  });
});

describe('Leaders comment on IT jobs', () => {
  it('lets the COO, the CEO and the ACT head add a note to an open job, but not HR', async () => {
    const { svc } = fresh();
    const b = await svc.itBoard(await svc.user('u-coo'));
    const job = b.jobs!.find((r) => r.open)!;
    expect(job.can.note).toBe(true);
    for (const id of ['u-coo', 'u-fauzan', 'u-audit']) await svc.itAct(await svc.user(id), 'jobStep', { id: job.job.id, step: 'note', note: `Comment from ${id}` });
    await expect(svc.itAct(await svc.user('u-pwvsb-hr'), 'jobStep', { id: job.job.id, step: 'note', note: 'HR note' })).rejects.toThrow();
    await expect(svc.itAct(await svc.user('u-audit'), 'jobStep', { id: job.job.id, step: 'accept' })).rejects.toThrow();
  });
});
