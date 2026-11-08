import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, myt } from '../src';

// The COO may accept or return anyone's work, always with a reason, but only in the departments he directly monitors:
// IT, Operations, Foreign Worker Management, Inventory (Procurement & Inventory, with Goodwill Empire) and Transport
// (Fauzan, 31 Oct 2026). The person in charge of checking it is told in the app. Dummy data only.
const TODAY = '2026-10-31';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const at = { now: myt(TODAY, '10:00') };
  return { ds, at, svc: new PrimaService(new MemoryStore(ds), () => at.now) };
};
const pdf = (name: string) => ({ kind: 'document' as const, name, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString('base64')}` });

/** A task given by the line manager and finished by the owner, waiting for review. */
async function finishedTask(svc: PrimaService, giverId: string, ownerId: string, title: string) {
  const giver = await svc.user(giverId);
  const owner = await svc.user(ownerId);
  const t = await svc.workTaskAdd(giver, { userId: owner.id, title, doneMeans: 'UAT output attached with the reference number.', dueAt: myt(addDays(TODAY, 2), '17:00'), priority: 'normal' });
  await svc.workTaskDone(owner, t.id, { note: 'UAT output attached', ref: 'UAT-1' });
  return t;
}
const notices = async (svc: PrimaService, uid: string) => (await svc.myWork(await svc.user(uid))).cooNotices;

describe('COO checks staff tasks in the departments he monitors', () => {
  it('accepts an IT Executive task in place of the IT Lead only with a reason, and tells the IT Lead', async () => {
    const { svc, ds } = fresh();
    const coo = await svc.user('u-coo');
    const t = await finishedTask(svc, 'u-it-lead', 'u-it-ex1', 'UAT replace printer toner');
    expect((await svc.personWork(coo, 'u-it-ex1')).cooCheck).toBe('reason');
    await expect(svc.workTaskReview(coo, t.id, true, '')).rejects.toThrow(/Say why you are accepting/);
    await expect(svc.workTaskReview(coo, t.id, true, '   ')).rejects.toThrow(/Say why you are accepting/);
    // Every approval has a reason; a short one is fine (Fauzan, 31 Oct 2026).
    const done = await svc.workTaskReview(coo, t.id, true, 'Seen on site during my walk-round');
    expect(done.status).toBe('accepted');
    // Only the line manager in charge is told, not the IT Manager or the worker.
    const lead = await notices(svc, 'u-it-lead');
    expect(lead).toHaveLength(1);
    expect(lead[0]).toMatchObject({ kind: 'work', recId: t.id, what: 'accept', note: 'Seen on site during my walk-round', by: coo.name });
    expect(await notices(svc, 'u-it-mgr')).toHaveLength(0);
    expect(await notices(svc, 'u-it-ex1')).toHaveLength(0);
    const audit = ds.audit.at(-1)!;
    expect(audit.action).toBe('work.task_accept');
    expect(audit.summary).toMatch(/by the COO in place of .*told: u-it-lead/);
  });

  it('returns or accepts work in Operations and Inventory with a reason, telling each line manager', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    const om = await finishedTask(svc, 'u-rom-central', 'u-om-klang', 'UAT weekly site visit report');
    await expect(svc.workTaskReview(coo, om.id, false, '')).rejects.toThrow(/fix/);
    expect((await svc.workTaskReview(coo, om.id, false, 'Two site photos are missing from the report.')).status).toBe('returned');
    expect((await notices(svc, 'u-rom-central')).map((n) => n.recId)).toEqual([om.id]);
    const store = await finishedTask(svc, 'u-proc-exec', 'u-proc-store1', 'UAT walkie-talkie stock count');
    expect((await svc.workTaskReview(coo, store.id, true, 'Counted it with the storekeeper myself.')).status).toBe('accepted');
    expect((await notices(svc, 'u-proc-exec')).map((n) => n.recId)).toEqual([store.id]);
  });

  it('checks his own direct report as their line manager: still with a reason (a short one is fine), nobody else to tell', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    const t = await finishedTask(svc, 'u-coo', 'u-transport', 'UAT road tax renewals list');
    expect((await svc.personWork(coo, 'u-transport')).cooCheck).toBe('own');
    expect((await svc.personWork(await svc.user('u-it-lead'), 'u-it-ex1')).cooCheck).toBeNull();
    await expect(svc.workTaskReview(coo, t.id, true, '')).rejects.toThrow(/Say why you are accepting it \(a short/);
    expect((await svc.workTaskReview(coo, t.id, true, 'OK')).status).toBe('accepted');
    expect(await notices(svc, 'u-transport')).toHaveLength(0);
  });

  it('refuses the COO in a department he does not directly monitor, even with a reason, on the direct API too', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    const t = await finishedTask(svc, 'u-fin-t1-lead', 'u-fin-t1-de1', 'UAT bank reconciliation');
    expect((await svc.personWork(coo, 'u-fin-t1-de1')).cooCheck).toBe('not_monitored');
    await expect(svc.workTaskReview(coo, t.id, true, 'Looks right to me from the bank file.')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.workTaskReview(coo, t.id, false, 'Forged return from a direct call.')).rejects.toBeInstanceOf(AccessDenied);
    // The line manager still checks it as before.
    expect((await svc.workTaskReview(await svc.user('u-fin-t1-lead'), t.id, true, 'ok')).status).toBe('accepted');
    expect(await notices(svc, 'u-fin-t1-lead')).toHaveLength(0);
  });

  it('marks only the chosen notice seen; repeating changes nothing; strangers and unknown ids are refused', async () => {
    const { svc, ds } = fresh();
    const coo = await svc.user('u-coo');
    const lead = await svc.user('u-it-lead');
    const ex2 = await svc.user('u-it-ex2');
    const t = await finishedTask(svc, 'u-it-lead', 'u-it-ex2', 'UAT update the switch firmware');
    await svc.workTaskReview(coo, t.id, false, 'Attach the firmware version screenshot.');
    // The IT Lead's screen loads with the first notice; a second arrives before they press Seen.
    const shown = await notices(svc, 'u-it-lead');
    expect(shown).toHaveLength(1);
    await svc.workTaskDone(ex2, t.id, { note: 'Screenshot attached', ref: 'UAT-2' });
    await svc.workTaskReview(coo, t.id, true, 'Screenshot shows the new version.');
    await svc.seenCooNotice(lead, 'work', t.id, shown[0].noticeId);
    const left = await notices(svc, 'u-it-lead');
    expect(left).toHaveLength(1);
    expect(left[0].what).toBe('accept');
    expect(left[0].noticeId).not.toBe(shown[0].noticeId);
    // Pressing Seen again on the old one is a no-op, with no new audit row.
    const rows = ds.audit.length;
    await svc.seenCooNotice(lead, 'work', t.id, shown[0].noticeId);
    expect(ds.audit.length).toBe(rows);
    expect(await notices(svc, 'u-it-lead')).toHaveLength(1);
    await expect(svc.seenCooNotice(ex2, 'work', t.id, left[0].noticeId)).rejects.toThrow(/Notice/);
    await expect(svc.seenCooNotice(lead, 'work', t.id, 'forged-n9')).rejects.toThrow(/Notice/);
    await expect(svc.seenCooNotice(lead, 'fwm', t.id, left[0].noticeId)).rejects.toThrow(/Notice/);
    await svc.seenCooNotice(lead, 'work', t.id, left[0].noticeId);
    expect(await notices(svc, 'u-it-lead')).toHaveLength(0);
    expect(ds.audit.at(-1)!.action).toBe('work.task.notice.seen');
  });
});

describe('COO checks FWM tasks in place of FWM', () => {
  it('accepts or sends back an OM task only with a reason, and tells the FWM Manager, the Deputy and the officer who sent it', async () => {
    const { svc, ds } = fresh();
    const coo = await svc.user('u-coo');
    const fwm = await svc.user('u-fwm-ex2');
    const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard')!;
    const t = await svc.createFwmTask(fwm, np.id, { kind: 'JIM', what: 'UAT bring passport to JIM', place: 'JIM Shah Alam', dueOn: addDays(TODAY, 3) });
    const om = await svc.user(t.omUserId!);
    await svc.doneFwmTask(om, t.id, 'Endorsed', [pdf('uat-slip.pdf')]);
    const board = await svc.fwmBoard(coo);
    expect(board.reasonRequired).toBe(true);
    expect(board.tasks.find((r) => r.task.id === t.id)!.canReview).toBe(true);
    await expect(svc.reviewFwmTask(coo, t.id, true, '')).rejects.toThrow(/in place of FWM/);
    expect((await svc.reviewFwmTask(coo, t.id, false, 'The slip is not stamped by JIM.')).status).toBe('returned');
    await svc.doneFwmTask(om, t.id, 'Stamped slip', [pdf('uat-slip-2.pdf')]);
    expect((await svc.reviewFwmTask(coo, t.id, true, 'Stamp checked against the JIM list.')).status).toBe('accepted');
    const mgr = (await svc.fwmBoard(await svc.user('u-fwm-mgr'))).cooNotices;
    expect(mgr.map((n) => n.what)).toEqual(['return', 'accept']);
    expect((await svc.fwmBoard(await svc.user('u-fwm-dep'))).cooNotices).toHaveLength(2);
    expect(t.createdById).toBe('u-fwm-ex2');
    expect((await svc.fwmBoard(fwm)).cooNotices).toHaveLength(2);
    expect((await svc.fwmBoard(await svc.user('u-fwm-ex1'))).cooNotices).toHaveLength(0);
    expect((await svc.fwmBoard(fwm)).reasonRequired).toBe(false);
    const told = /told: ([^)]*)\)/.exec(ds.audit.at(-1)!.summary)![1].split(', ').sort();
    expect(told).toEqual(['u-fwm-dep', 'u-fwm-ex2', 'u-fwm-mgr']);
    // The Manager sees one; the Deputy's two stay.
    await svc.seenCooNotice(await svc.user('u-fwm-mgr'), 'fwm', t.id, mgr[0].noticeId);
    expect((await svc.fwmBoard(await svc.user('u-fwm-mgr'))).cooNotices.map((n) => n.what)).toEqual(['accept']);
    expect((await svc.fwmBoard(await svc.user('u-fwm-dep'))).cooNotices).toHaveLength(2);
  });

  it('still refuses other leaders and FWM despatch from checking FWM tasks', async () => {
    const { svc, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex2');
    const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard')!;
    const t = await svc.createFwmTask(fwm, np.id, { kind: 'FOMEMA', what: 'UAT FOMEMA check', place: 'Klang', dueOn: addDays(TODAY, 3) });
    await svc.doneFwmTask(await svc.user(t.omUserId!), t.id, 'Done', [pdf('uat-fomema.pdf')]);
    await expect(svc.reviewFwmTask(await svc.user('u-fd'), t.id, true, 'Finance check of the FOMEMA slip.')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.reviewFwmTask(await svc.user('u-fwm-desp'), t.id, true, 'Despatch says it is fine.')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.reviewFwmTask(fwm, t.id, true, 'ok')).status).toBe('accepted');
  });
});

describe('COO checks: whoever is in charge is always told', () => {
  it('tells both the line manager and the person who gave the task', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    // The IT Manager gives an IT Executive a task; the Executive's line manager is the IT Lead.
    const t = await finishedTask(svc, 'u-it-mgr', 'u-it-ex3', 'UAT label the new laptops');
    await svc.workTaskReview(coo, t.id, true, 'Labels checked in the store room.');
    expect((await notices(svc, 'u-it-lead')).map((n) => n.recId)).toEqual([t.id]);
    expect((await notices(svc, 'u-it-mgr')).map((n) => n.recId)).toEqual([t.id]);
    expect(await notices(svc, 'u-it-ex3')).toHaveLength(0);
  });

  it('refuses the COO when nobody in charge is set up to be told, instead of acting silently', async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
    // No FWM Manager or Deputy set up, and an older task with no recorded sender.
    for (const u of ds.users) if (u.fwmRole === 'manager' || u.fwmRole === 'deputy') u.fwmRole = 'executive';
    const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
    const fwm = await svc.user('u-fwm-ex2');
    const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard')!;
    const t = await svc.createFwmTask(fwm, np.id, { kind: 'JIM', what: 'UAT older task', place: 'JIM Shah Alam', dueOn: addDays(TODAY, 3) });
    delete ds.fwmTasks.find((x) => x.id === t.id)!.createdById;
    await svc.doneFwmTask(await svc.user(t.omUserId!), t.id, 'Endorsed', [pdf('uat-old.pdf')]);
    await expect(svc.reviewFwmTask(await svc.user('u-coo'), t.id, true, 'Checked the endorsement myself.')).rejects.toThrow(/Nobody in FWM is set up to be told/);
    // FWM itself still checks it as before.
    expect((await svc.reviewFwmTask(fwm, t.id, true, 'ok')).status).toBe('accepted');
  });
});

describe('The COO for anyone who reports up to him (Fauzan, 31 Oct 2026)', () => {
  it('checks CMS work outside the monitored departments because CMS reports up to him, with a reason and a notice', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    const t = await finishedTask(svc, 'u-pwvsb-arms', 'u-cms-head', 'UAT CMS shift report');
    expect((await svc.personWork(coo, 'u-cms-head')).cooCheck).toBe('reason');
    await expect(svc.workTaskReview(coo, t.id, true, '')).rejects.toThrow(/Say why/);
    expect((await svc.workTaskReview(coo, t.id, true, 'Checked')).status).toBe('accepted');
    expect((await notices(svc, 'u-pwvsb-arms')).map((n) => n.recId)).toEqual([t.id]);
  });
});

describe('The CEO has full authority, still with a reason (Fauzan, 31 Oct 2026)', () => {
  it('accepts work anywhere, Finance included, only with a reason, and tells the people in charge', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    const t = await finishedTask(svc, 'u-fin-t1-lead', 'u-fin-t1-de1', 'UAT CEO bank reconciliation');
    expect((await svc.personWork(ceo, 'u-fin-t1-de1')).cooCheck).toBe('reason');
    await expect(svc.workTaskReview(ceo, t.id, true, '')).rejects.toThrow(/Say why you are accepting/);
    expect((await svc.workTaskReview(ceo, t.id, true, 'OK')).status).toBe('accepted');
    expect((await notices(svc, 'u-fin-t1-lead')).map((n) => n.recId)).toEqual([t.id]);
    expect(ds.audit.at(-1)!.summary).toMatch(/by the CEO in place of/);
  });

  it('checks FWM tasks and IT jobs like the COO, with a reason', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    const fwm = await svc.user('u-fwm-ex2');
    const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard')!;
    const t = await svc.createFwmTask(fwm, np.id, { kind: 'JIM', what: 'UAT CEO check', place: 'JIM Shah Alam', dueOn: addDays(TODAY, 3) });
    await svc.doneFwmTask(await svc.user(t.omUserId!), t.id, 'Endorsed', [pdf('uat-ceo.pdf')]);
    expect((await svc.fwmBoard(ceo)).reasonRequired).toBe(true);
    await expect(svc.reviewFwmTask(ceo, t.id, true, '')).rejects.toThrow(/in place of FWM/);
    expect((await svc.reviewFwmTask(ceo, t.id, true, 'Seen')).status).toBe('accepted');
    expect((await svc.fwmBoard(await svc.user('u-fwm-mgr'))).cooNotices).toHaveLength(1);
    const job = await svc.giveItJob(await svc.user('u-it-mgr'), { kind: 'task', title: 'UAT CEO IT job', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: addDays(TODAY, 2) });
    const ex1 = await svc.user('u-it-ex1');
    await svc.itJobStep(ex1, job.id, 'submit', 'Done with proof', [pdf('uat-it-ceo.pdf')]);
    await expect(svc.itJobStep(ceo, job.id, 'accept', '')).rejects.toThrow(/Say why you are accepting/);
    expect((await svc.itJobStep(ceo, job.id, 'accept', 'ok')).status).toBe('accepted');
    expect(ds.audit.at(-1)!.summary).toMatch(/by the CEO; told: /);
  });
});

describe('Leadership notice and audit correctness', () => {
  it('records the actual CEO decision in both work and IT notice acknowledgement audits', async () => {
    const { svc, ds } = fresh();
    const ceo = await svc.user('u-fauzan');
    const lead = await svc.user('u-it-lead');
    const mgr = await svc.user('u-it-mgr');
    const t = await finishedTask(svc, lead.id, 'u-it-ex1', 'Audit identity work');
    await svc.workTaskReview(ceo, t.id, true, 'Verified');
    const n = (await notices(svc, lead.id)).find(x => x.recId === t.id)!;
    await svc.seenCooNotice(lead, 'work', t.id, n.noticeId);
    expect(ds.audit.at(-1)!.summary).toContain(`decision by ${ceo.name}`);
    expect(ds.audit.at(-1)!.summary).not.toContain("COO's");
    const j = await svc.giveItJob(mgr, { kind: 'task', title: 'Audit identity IT job', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: addDays(TODAY, 2) });
    await svc.itJobStep(await svc.user('u-it-ex1'), j.id, 'submit', 'Done with proof', [pdf('audit-ceo.pdf')]);
    await svc.itJobStep(ceo, j.id, 'accept', 'Verified');
    const notice = (await svc.itBoard(mgr)).myWork!.cooNotices.find(x => x.jobId === j.id)!;
    await svc.itAct(mgr, 'seenNotice', { id: j.id, noticeId: notice.noticeId });
    expect(ds.audit.at(-1)!.summary).toContain(`decision by ${ceo.name}`);
    expect(ds.audit.at(-1)!.summary).not.toContain("COO's");
  });

  it('refuses IT intervention with no checker to notify, without changing the job', async () => {
    const { svc, ds } = fresh();
    const j = await svc.giveItJob(await svc.user('u-it-mgr'), { kind: 'task', title: 'No checker IT job', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: addDays(TODAY, 2) });
    await svc.itJobStep(await svc.user('u-it-ex1'), j.id, 'submit', 'Done with proof', [pdf('no-checker.pdf')]);
    for (const u of ds.users) if (u.itRole === 'manager') u.itRole = 'executive';
    const before = JSON.stringify(ds.itJobs.find(x => x.id === j.id));
    const auditCount = ds.audit.length;
    for (const id of ['u-fauzan', 'u-coo']) {
      await expect(svc.itJobStep(await svc.user(id), j.id, 'accept', 'Verified')).rejects.toThrow(/Nobody in IT/);
      await expect(svc.itJobStep(await svc.user(id), j.id, 'return', 'Needs correction')).rejects.toThrow(/Nobody in IT/);
    }
    expect(JSON.stringify(ds.itJobs.find(x => x.id === j.id))).toBe(before);
    expect(ds.audit.length).toBe(auditCount);
  });

  it('includes the COO direct-report acceptance reason in the audit', async () => {
    const { svc, ds } = fresh();
    const t = await finishedTask(svc, 'u-coo', 'u-transport', 'Direct report audit');
    await svc.workTaskReview(await svc.user('u-coo'), t.id, true, 'Checked personally');
    expect(ds.audit.at(-1)!.summary).toContain('Checked personally');
  });
});
