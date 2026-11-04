import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, addDays, generateDataset, myt } from '../src';

// Who checks IT work (Fauzan via Arisha main, 31 Oct 2026): the IT Manager checks and accepts or returns all IT work,
// including the IT Lead's technical jobs; nobody checks their own work; the person who logged and fixed a help request
// never confirms it. Dummy data only.
const TODAY = '2026-10-31';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
let n = 0;
const proof = () => [{ kind: 'document' as const, name: `UAT proof ${++n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 uat ${n}`).toString('base64')}` }];
const due = (d: number) => addDays(TODAY, d);
type Row = { job: { id: string }; nextCheck: string | null; can: { accept: boolean; back: boolean; check: boolean } };
const rowOf = async (svc: PrimaService, uid: string, id: string) => ((await svc.itBoard(await svc.user(uid))).jobs as Row[]).find((r) => r.job.id === id)!;

describe('IT help requests: the fixer never confirms their own fix', () => {
  it('refuses the IT person who logged and fixed a request for someone else, on the direct API too', async () => {
    const { svc, ds } = fresh();
    const ex2 = await svc.user('u-it-ex2');
    const ex3 = await svc.user('u-it-ex3');
    const t = await svc.logItTicket(ex2, { raisedFor: 'UAT Staff A (mock)', channel: 'teams', category: 'M365', priority: 'P3', title: 'UAT Outlook asks for password', detail: '' });
    await svc.itTicketStep(ex2, t.id, 'take');
    await svc.itTicketStep(ex2, t.id, 'resolve', 'Cleared the cached password');
    // The old bypass: the logger is the raiser on record, so the generic confirm used to accept their own fix.
    await expect(svc.confirmItTicket(ex2, t.id, true)).rejects.toThrow(/logged this for someone else/);
    await expect(svc.itAct(ex2, 'confirmTicket', { id: t.id, fixed: true })).rejects.toThrow(/logged this for someone else/);
    await expect(svc.itAct(ex2, 'confirmTicket', { id: t.id, fixed: false, note: 'forged reopen' })).rejects.toThrow(/logged this for someone else/);
    expect(ds.itTickets.find((x) => x.id === t.id)!.confirmedAt).toBeFalsy();
    // The screen offers no confirm button and says who answers.
    const mine = (await svc.itBoard(ex2)).mine.find((x) => x.id === t.id)!;
    expect(mine.canConfirm).toBe(false);
    expect(mine.confirmNote).toMatch(/other than the person who fixed it/);
    // The person's answer is still recorded, by someone else in IT, and kept in the audit trail.
    await expect(svc.itAct(ex2, 'recordConfirm', { id: t.id, fixed: true, via: 'Teams chat 10:40' })).rejects.toThrow(/other than the person who fixed/);
    const ok = (await svc.itAct(ex3, 'recordConfirm', { id: t.id, fixed: true, via: 'Teams chat 10:40' })) as { confirmedAt: string; confirmedVia: string };
    expect(ok.confirmedAt).toBeTruthy();
    expect(ok.confirmedVia).toMatch(/recorded by IT Executive 3/);
    expect(ds.audit.some((a) => a.action === 'it.confirm' && a.entityId === t.id && a.actor === ex3.name)).toBe(true);
  });

  it('keeps the requester’s own confirmation, but not for a request IT raised and fixed itself', async () => {
    const { svc } = fresh();
    const staff = await svc.user('u-cm-inas');
    const ex1 = await svc.user('u-it-ex1');
    const asked = await svc.raiseItTicket(staff, { category: 'DEVICE', priority: 'P2', title: 'UAT printer jam', detail: '' });
    await svc.itTicketStep(ex1, asked.id, 'take');
    await svc.itTicketStep(ex1, asked.id, 'resolve', 'Cleared the jam');
    await expect(svc.itAct(ex1, 'confirmTicket', { id: asked.id, fixed: true })).rejects.toThrow(/Help request/);
    expect((await svc.itBoard(staff)).mine.find((x) => x.id === asked.id)!.canConfirm).toBe(true);
    expect(((await svc.itAct(staff, 'confirmTicket', { id: asked.id, fixed: true })) as { confirmedAt: string }).confirmedAt).toBeTruthy();

    const own = await svc.raiseItTicket(ex1, { category: 'DEVICE', priority: 'P3', title: 'UAT my laptop fan', detail: '' });
    await svc.itTicketStep(ex1, own.id, 'take');
    await svc.itTicketStep(ex1, own.id, 'resolve', 'Cleaned the fan');
    await expect(svc.itAct(ex1, 'confirmTicket', { id: own.id, fixed: true })).rejects.toThrow(/fixed this yourself/);
    const row = (await svc.itBoard(ex1)).mine.find((x) => x.id === own.id)!;
    expect(row.canConfirm).toBe(false);
    expect(row.confirmNote).toMatch(/fixed this yourself/);
  });
});

describe('IT help requests: the signed-in resolver is kept and refused (Arisha main review, 31 Oct 2026)', () => {
  it('the IT Lead resolves an executive’s logged request: the Lead cannot record the answer', async () => {
    const { svc, ds } = fresh();
    const lead = await svc.user('u-it-lead');
    const ex2 = await svc.user('u-it-ex2');
    const ex3 = await svc.user('u-it-ex3');
    const t = await svc.logItTicket(ex2, { raisedFor: 'UAT Staff B (mock)', channel: 'phone', category: 'DEVICE', priority: 'P2', title: 'UAT docking station', detail: '' });
    await svc.itTicketStep(ex2, t.id, 'take');
    const done = await svc.itTicketStep(lead, t.id, 'resolve', 'Replaced the dock');
    // Still assigned to the executive, but the Lead is recorded as the fixer.
    expect(done).toMatchObject({ assignedToId: 'u-it-ex2', resolvedById: 'u-it-lead', resolvedBy: lead.name });
    await expect(svc.itAct(lead, 'recordConfirm', { id: t.id, fixed: true, via: 'Phone call 11:05' })).rejects.toThrow(/other than the person who fixed/);
    await expect(svc.itAct(lead, 'recordConfirm', { id: t.id, fixed: false, via: 'Phone call 11:05', note: 'forged' })).rejects.toThrow(/other than the person who fixed/);
    const rows = (await svc.itBoard(lead)).tickets as { ticket: { id: string }; canRecord: boolean }[];
    expect(rows.find((r) => r.ticket.id === t.id)!.canRecord).toBe(false);
    // The assignee did not fix it, so they may record the answer.
    expect(((await svc.itBoard(ex3)).tickets as { ticket: { id: string }; canRecord: boolean }[]).find((r) => r.ticket.id === t.id)!.canRecord).toBe(true);
    expect(((await svc.itAct(ex2, 'recordConfirm', { id: t.id, fixed: true, via: 'Phone call 11:05' })) as { confirmedAt: string }).confirmedAt).toBeTruthy();
    expect(ds.audit.some((a) => a.action === 'it.resolve' && a.entityId === t.id && a.actor === lead.name)).toBe(true);
  });

  it('the IT Lead resolves their own request assigned to an executive: the Lead cannot confirm it', async () => {
    const { svc } = fresh();
    const lead = await svc.user('u-it-lead');
    const ex1 = await svc.user('u-it-ex1');
    const t = await svc.raiseItTicket(lead, { category: 'M365', priority: 'P3', title: 'UAT my mailbox rule', detail: '' });
    await svc.itTicketStep(lead, t.id, 'assign', '', 'u-it-ex1');
    await svc.itTicketStep(ex1, t.id, 'take');
    await svc.itTicketStep(lead, t.id, 'resolve', 'Fixed the rule myself');
    await expect(svc.itAct(lead, 'confirmTicket', { id: t.id, fixed: true })).rejects.toThrow(/fixed this yourself/);
    const mine = (await svc.itBoard(lead)).mine.find((x) => x.id === t.id)!;
    expect(mine.canConfirm).toBe(false);
    expect(mine.confirmNote).toMatch(/fixed this yourself/);
    // Saying it is not fixed is still allowed: it reopens and clears the resolver.
    const back = (await svc.itAct(lead, 'confirmTicket', { id: t.id, fixed: false, note: 'Rule stopped again' })) as { status: string; resolvedById: string | null };
    expect(back).toMatchObject({ status: 'in_progress', resolvedById: null });
  });

  it('treats older resolved requests with no recorded resolver cautiously', async () => {
    const { svc, ds } = fresh();
    const lead = await svc.user('u-it-lead');
    const ex2 = await svc.user('u-it-ex2');
    const ex3 = await svc.user('u-it-ex3');
    const t = await svc.logItTicket(ex2, { raisedFor: 'UAT Staff C (mock)', channel: 'email', category: 'M365', priority: 'P3', title: 'UAT old request', detail: '' });
    await svc.itTicketStep(ex2, t.id, 'take');
    await svc.itTicketStep(ex2, t.id, 'resolve', 'Done');
    const row = ds.itTickets.find((x) => x.id === t.id)!;
    delete row.resolvedById;
    delete row.resolvedBy;
    // Whoever may have fixed it (the assignee, or the IT Lead, who may resolve anyone's request) is refused.
    await expect(svc.recordItConfirm(ex2, t.id, true, 'Email 09:00')).rejects.toThrow(/other than the person who fixed/);
    await expect(svc.recordItConfirm(lead, t.id, true, 'Email 09:00')).rejects.toThrow(/other than the person who fixed/);
    expect((await svc.recordItConfirm(ex3, t.id, true, 'Email 09:00')).confirmedAt).toBeTruthy();
    // An older request the IT Lead raised for themselves: the Lead may have fixed it, so cannot confirm.
    const own = await svc.raiseItTicket(lead, { category: 'DEVICE', priority: 'P3', title: 'UAT old own request', detail: '' });
    await svc.itTicketStep(ex3, own.id, 'take');
    await svc.itTicketStep(ex3, own.id, 'resolve', 'Done');
    const o = ds.itTickets.find((x) => x.id === own.id)!;
    delete o.resolvedById;
    await expect(svc.confirmItTicket(lead, own.id, true)).rejects.toThrow(/fixed this yourself/);
  });
});

describe('IT jobs: the IT Manager checks and accepts all IT work', () => {
  it('an IT Executive’s job: only the IT Manager accepts or returns it, never the doer or the IT Lead', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    const ex = await svc.user('u-it-ex1');
    const j = await svc.giveItJob(mgr, { kind: 'task', title: 'UAT label 10 laptops', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: due(2) });
    await svc.itJobStep(ex, j.id, 'submit', 'Labelled all ten', proof());
    expect((await rowOf(svc, 'u-it-mgr', j.id)).nextCheck).toMatch(/IT Manager to check the proof/);
    await expect(svc.itAct(ex, 'jobStep', { id: j.id, step: 'accept' })).rejects.toThrow(/own work/);
    await expect(svc.itAct(lead, 'jobStep', { id: j.id, step: 'accept' })).rejects.toThrow(/IT Manager accepts/);
    await expect(svc.itAct(lead, 'jobStep', { id: j.id, step: 'return', note: 'Not good enough' })).rejects.toThrow(/IT Manager/);
    expect((await svc.itJobStep(mgr, j.id, 'return', 'Photo of the labels is missing')).status).toBe('returned');
    await svc.itJobStep(ex, j.id, 'submit', 'Photo attached', proof());
    expect(await svc.itJobStep(mgr, j.id, 'accept')).toMatchObject({ status: 'accepted', acceptedBy: mgr.name });
    expect(ds.audit.filter((a) => a.entityId === j.id).map((a) => a.action)).toEqual(['it.job.give', 'it.job.submit', 'it.job.return', 'it.job.submit', 'it.job.accept']);
  });

  it('an IT Executive’s technical job: the IT Lead checks, then the IT Manager accepts', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    const ex = await svc.user('u-it-ex2');
    const j = await svc.giveItJob(mgr, { kind: 'install', title: 'UAT install NVR', detail: '', priority: 'P2', technical: true, assigneeId: 'u-it-ex2', dueOn: due(3) });
    await svc.itJobStep(ex, j.id, 'submit', 'Installed and recording', proof());
    expect((await rowOf(svc, 'u-it-mgr', j.id)).nextCheck).toMatch(/IT Lead's technical check, then the IT Manager/);
    await expect(svc.itJobStep(mgr, j.id, 'accept')).rejects.toThrow(/IT Lead checks it first/);
    await svc.itJobStep(lead, j.id, 'check', 'Footage plays back');
    expect((await svc.itJobStep(mgr, j.id, 'accept')).status).toBe('accepted');
  });

  it('the IT Lead receives technical jobs; the IT Manager checks the proof and accepts or returns them', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    const ex = await svc.user('u-it-ex3');
    const j = await svc.giveItJob(mgr, { kind: 'install', title: 'UAT firewall rule review', detail: '', priority: 'P2', technical: true, assigneeId: 'u-it-lead', dueOn: due(4) });
    expect(j.assigneeId).toBe('u-it-lead');
    await svc.itJobStep(lead, j.id, 'submit', 'Rules reviewed, export attached', proof());
    // The IT Lead never checks or accepts their own work; an executive cannot either.
    await expect(svc.itJobStep(lead, j.id, 'check')).rejects.toThrow(/own work/);
    await expect(svc.itAct(lead, 'jobStep', { id: j.id, step: 'accept' })).rejects.toThrow(/own work/);
    await expect(svc.itAct(lead, 'jobStep', { id: j.id, step: 'return', note: 'self return' })).rejects.toThrow(/own work/);
    await expect(svc.itAct(ex, 'jobStep', { id: j.id, step: 'accept' })).rejects.toThrow(/IT Manager checks the IT Lead/);
    const r = await rowOf(svc, 'u-it-mgr', j.id);
    expect(r.nextCheck).toMatch(/IT Lead did this job, so the IT Manager checks the proof/);
    expect(r.can).toMatchObject({ accept: true, back: true, check: false });
    expect((await rowOf(svc, 'u-it-lead', j.id)).can).toMatchObject({ accept: false, back: false, check: false });
    // The IT Manager opens the proof, returns it, then accepts the new proof.
    expect((await svc.itJobProof(mgr, j.id, ds.itJobs.find((x) => x.id === j.id)!.proof[0].sha256)).data).toMatch(/^data:application\/pdf/);
    expect((await svc.itJobStep(mgr, j.id, 'return', 'Add the change ticket numbers')).status).toBe('returned');
    await svc.itJobStep(lead, j.id, 'submit', 'Ticket numbers added', proof());
    const ok = await svc.itJobStep(mgr, j.id, 'accept', 'Proof checked');
    expect(ok).toMatchObject({ status: 'accepted', acceptedBy: mgr.name, checkedBy: mgr.name });
    expect(ds.audit.some((a) => a.action === 'it.job.accept' && a.entityId === j.id && a.actor === mgr.name)).toBe(true);
  });

  it('the COO may accept or return anyone’s job at any time, and whoever was in charge is told (Fauzan, 31 Oct 2026)', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    const coo = await svc.user('u-coo');
    const ex = await svc.user('u-it-ex1');
    // The IT Lead's technical job, with the IT Manager at work: the COO returns it, then accepts it.
    const j = await svc.giveItJob(mgr, { kind: 'install', title: 'UAT VPN setup', detail: '', priority: 'P2', technical: true, assigneeId: 'u-it-lead', dueOn: due(4) });
    await svc.itJobStep(lead, j.id, 'submit', 'VPN works', proof());
    expect((await rowOf(svc, 'u-coo', j.id)).can).toMatchObject({ accept: true, back: true });
    expect((await svc.itJobStep(coo, j.id, 'return', 'Add the VPN client screenshot')).status).toBe('returned');
    let w = (await svc.itBoard(mgr)).myWork!;
    expect(w.cooNotices).toEqual([expect.objectContaining({ jobId: j.id, by: coo.name, what: 'return', note: 'Add the VPN client screenshot' })]);
    // The IT Lead did the job; they are not the one told.
    expect((await svc.itBoard(lead)).myWork!.cooNotices).toEqual([]);
    await svc.itJobStep(lead, j.id, 'submit', 'Screenshot attached', proof());
    await expect(svc.itJobStep(coo, j.id, 'accept')).rejects.toThrow(/Say why/);
    expect(await svc.itJobStep(coo, j.id, 'accept', 'Client handover today; proof checked')).toMatchObject({ status: 'accepted', acceptedBy: coo.name, checkedBy: coo.name });
    expect(ds.audit.some((a) => a.action === 'it.job.accept' && a.entityId === j.id && a.actor === coo.name && /told: u-it-mgr/.test(a.summary))).toBe(true);
    w = (await svc.itBoard(mgr)).myWork!;
    expect(w.cooNotices).toHaveLength(2);
    // An executive's technical job before the IT Lead's check: the COO accepts it; the IT Lead and the IT Manager are told.
    const t = await svc.giveItJob(mgr, { kind: 'install', title: 'UAT switch config', detail: '', priority: 'P2', technical: true, assigneeId: 'u-it-ex1', dueOn: due(4) });
    await svc.itJobStep(ex, t.id, 'submit', 'Configured', proof());
    await svc.itAct(coo, 'jobStep', { id: t.id, step: 'accept', note: 'Urgent for the site; config checked' });
    expect((await svc.itBoard(lead)).myWork!.cooNotices).toEqual([expect.objectContaining({ jobId: t.id, what: 'accept' })]);
    // Seen clears it for that person only; someone not told cannot mark it.
    const leadNotice = (await svc.itBoard(lead)).myWork!.cooNotices[0].noticeId;
    await expect(svc.itAct(ex, 'seenNotice', { id: t.id, noticeId: leadNotice })).rejects.toThrow(/Notice/);
    await expect(svc.itAct(lead, 'seenNotice', { id: t.id })).rejects.toThrow(/Notice/);
    await svc.itAct(lead, 'seenNotice', { id: t.id, noticeId: leadNotice });
    expect((await svc.itBoard(lead)).myWork!.cooNotices).toEqual([]);
    expect((await svc.itBoard(mgr)).myWork!.cooNotices.some((n) => n.jobId === t.id)).toBe(true);
    // Ordinary roles are unchanged: the IT Lead still cannot accept.
    const e = await svc.giveItJob(mgr, { kind: 'task', title: 'UAT tidy cables', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: due(2) });
    await svc.itJobStep(ex, e.id, 'submit', 'Tidied', proof());
    await expect(svc.itJobStep(lead, e.id, 'accept')).rejects.toThrow(/IT Manager accepts/);
  });

  it('marks only the chosen COO notice seen: a newer one stays, and repeating is harmless (Arisha main review)', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const coo = await svc.user('u-coo');
    const ex = await svc.user('u-it-ex2');
    const j = await svc.giveItJob(mgr, { kind: 'task', title: 'UAT printer setup', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex2', dueOn: due(3) });
    await svc.itJobStep(ex, j.id, 'submit', 'Installed', proof());
    await svc.itJobStep(coo, j.id, 'return', 'Need the test page photo');
    // The IT Manager's screen loads with the first notice.
    const shown = (await svc.itBoard(mgr)).myWork!.cooNotices;
    expect(shown).toHaveLength(1);
    // A second notice arrives between display and click.
    await svc.itJobStep(ex, j.id, 'submit', 'Photo attached', proof());
    await svc.itJobStep(coo, j.id, 'accept', 'Site opens tomorrow; proof checked');
    await svc.itAct(mgr, 'seenNotice', { id: j.id, noticeId: shown[0].noticeId });
    const left = (await svc.itBoard(mgr)).myWork!.cooNotices;
    expect(left).toEqual([expect.objectContaining({ what: 'accept', note: 'Site opens tomorrow; proof checked' })]);
    expect(left[0].noticeId).not.toBe(shown[0].noticeId);
    // Marking the old one again changes nothing and writes no second audit entry.
    const audits = () => ds.audit.filter((a) => a.action === 'it.job.notice.seen' && a.entityId === j.id).length;
    expect(audits()).toBe(1);
    await svc.itAct(mgr, 'seenNotice', { id: j.id, noticeId: shown[0].noticeId });
    expect(audits()).toBe(1);
    expect((await svc.itBoard(mgr)).myWork!.cooNotices).toHaveLength(1);
    // An unknown notice id is refused.
    await expect(svc.itAct(mgr, 'seenNotice', { id: j.id, noticeId: `${j.id}-n99` })).rejects.toThrow(/Notice/);
    await svc.itAct(mgr, 'seenNotice', { id: j.id, noticeId: left[0].noticeId });
    expect((await svc.itBoard(mgr)).myWork!.cooNotices).toEqual([]);
    expect(audits()).toBe(2);
  });

  it('a job the IT Manager did waits for the COO; nobody else approves it', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    const coo = await svc.user('u-coo');
    // The IT Manager is never given jobs, so this row is forged straight into the data.
    const base = ds.itJobs[0];
    const forged = { ...base, id: 'itj-uat-forged', ref: 'ITJ-9999', assigneeId: 'u-it-mgr', assignee: mgr.name, givenById: 'u-it-lead', givenBy: lead.name, status: 'submitted' as const, technical: false, proof: [], log: [], cooNotices: [] };
    ds.itJobs.push(forged);
    await expect(svc.itJobStep(mgr, forged.id, 'accept')).rejects.toThrow(/own work/);
    await expect(svc.itAct(lead, 'jobStep', { id: forged.id, step: 'accept' })).rejects.toThrow();
    await expect(svc.itAct(lead, 'jobStep', { id: forged.id, step: 'return', note: 'Send it back' })).rejects.toThrow();
    expect((await rowOf(svc, 'u-coo', forged.id)).nextCheck).toMatch(/Waiting for the COO/);
    expect((await rowOf(svc, 'u-it-mgr', forged.id)).can).toMatchObject({ accept: false, back: false });
    await expect(svc.itAct(coo, 'jobStep', { id: forged.id, step: 'accept' })).rejects.toThrow(/Say why/);
    expect((await svc.itAct(coo, 'jobStep', { id: forged.id, step: 'accept', note: 'IT Manager’s own job; proof checked' })) as { status: string }).toMatchObject({ status: 'accepted', acceptedBy: coo.name });
  });

  it('refuses forged accept requests from people outside the IT check', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const ex = await svc.user('u-it-ex4');
    const j = await svc.giveItJob(mgr, { kind: 'task', title: 'UAT patch printers', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex4', dueOn: due(2) });
    await svc.itJobStep(ex, j.id, 'submit', 'Patched', proof());
    for (const uid of ['u-audit', 'u-pwvsb-hr', 'u-fd', 'u-it-ex1', 'u-fauzan']) {
      await expect(svc.itAct(await svc.user(uid), 'jobStep', { id: j.id, step: 'accept' }), uid).rejects.toThrow();
    }
    expect((await svc.itJobStep(mgr, j.id, 'accept')).status).toBe('accepted');
  });
});
