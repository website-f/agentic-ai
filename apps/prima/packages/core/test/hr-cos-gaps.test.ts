// HR gaps from the 23 Nov 2026 study (Fauzan, 23 Nov 2026): B1 the Chief of Staff, Deputy or HR Administrator records
// the Vice Chairman's answer with proof; B2 the HR Director step names both and HR chases; D1 the Deputy covers the
// Chief of Staff on leave and the Chief of Staff hands items over; D2 office leave escalates in working hours; D3 HR
// staff's own leave and claims go to the HR Director. Mock data only, never staging.
import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, cosActs, cosCoverInForce, generateDataset, myt, workingHourDeadlines } from '../src';
import type { CosCoverRow, User } from '../src';

const TODAY = '2026-10-26'; // a Monday
const NOW = myt(TODAY, '10:30');
let n = 0;
const pdf = () => ({ kind: 'document' as const, name: `Answer ${++n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 vc ${n}`).toString('base64')}` });

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

async function staffLeaveAtVc() {
  const f = fresh();
  const asker = f.ds.users.find((u) => u.department === 'it' && u.personId && f.ds.people.some((p) => p.id === u.personId && p.status === 'active'))!;
  const q = await f.svc.requestLeave(asker, { personId: asker.personId!, kind: 'ANNUAL', from: '2026-11-10', to: '2026-11-11', reason: 'Family matter' });
  const hr = await f.svc.user('u-pwvsb-hr');
  await f.svc.decideLeave(hr, q.id, true, 'Cover arranged');
  return { ...f, q, asker, hr };
}

describe('B1: recording the Vice Chairman’s answer (Fauzan, 23 Nov 2026)', () => {
  it('lets the Chief of Staff record his consent to staff leave with a screenshot, and names him as the decider', async () => {
    const { svc, ds, q } = await staffLeaveAtVc();
    const cos = await svc.user('u-cos');
    const row = (await svc.leaveRequests(cos, { status: 'pending' })).rows.find((r) => r.request.id === q.id);
    expect(row?.canRecordVc).toBe(true);
    const done = await svc.recordVcConsent(cos, 'leave', q.id, { consent: true, how: 'app', givenOn: TODAY, note: 'OK by WhatsApp', proof: [pdf()] });
    expect(done.status).toBe('approved');
    const saved = ds.leaveRequests.find((r) => r.id === q.id)!;
    expect(saved.vcRecord).toMatchObject({ how: 'app', givenOn: TODAY, consent: true, recordedById: 'u-cos' });
    expect(saved.vcRecord!.proofIds.length).toBe(1);
    expect(saved.decidedBy).toContain('recorded by');
  });

  it('refuses the HR Administrator who approved the step before, the person on leave, and anyone outside HR leadership', async () => {
    const { svc, q, asker, hr } = await staffLeaveAtVc();
    const body = { consent: true, how: 'app', givenOn: TODAY, note: 'OK by WhatsApp', proof: [pdf()] };
    await expect(svc.recordVcConsent(hr, 'leave', q.id, body)).rejects.toThrow(/You approved/);
    await expect(svc.recordVcConsent(asker, 'leave', q.id, body)).rejects.toBeInstanceOf(AccessDenied);
    for (const id of ['u-fd', 'u-coo', 'u-cm-sasa']) await expect(svc.recordVcConsent(await svc.user(id), 'leave', q.id, body)).rejects.toBeInstanceOf(AccessDenied);
    // The Deputy may.
    await expect(svc.recordVcConsent(await svc.user('u-dcos'), 'leave', q.id, body)).resolves.toBeDefined();
  });

  it('needs a file for a message or letter, and a fuller note for a call with no file; no future day', async () => {
    const { svc, q } = await staffLeaveAtVc();
    const dcos = await svc.user('u-dcos');
    await expect(svc.recordVcConsent(dcos, 'leave', q.id, { consent: true, how: 'app', givenOn: TODAY, note: 'OK', proof: [] })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.recordVcConsent(dcos, 'leave', q.id, { consent: true, how: 'letter', givenOn: TODAY, note: 'Signed letter', proof: [] })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.recordVcConsent(dcos, 'leave', q.id, { consent: true, how: 'call', givenOn: TODAY, note: 'Said ok', proof: [] })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.recordVcConsent(dcos, 'leave', q.id, { consent: true, how: 'call', givenOn: '2026-10-27', note: 'Called him at 10 am, he agreed', proof: [] })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.recordVcConsent(dcos, 'leave', q.id, { consent: 'yes', how: 'call', givenOn: TODAY, note: 'Called him at 10 am, he agreed', proof: [] })).rejects.toBeInstanceOf(BadRequest);
    const done = await svc.recordVcConsent(dcos, 'leave', q.id, { consent: false, how: 'call', givenOn: TODAY, note: 'Called him at 10 am, he said no', proof: [] });
    expect(done.status).toBe('rejected');
  });

  it('records his consent to a salary amount, never by the HR Director who checked it', async () => {
    const f = fresh();
    const hr = await f.svc.user('u-pwvsb-hr');
    const staff = f.ds.users.find((u) => u.department === 'it' && u.personId)!;
    const values = (await f.svc.recordForm(hr, 'officeStaff', staff.personId!, null)).values;
    const before = Number(values.basicPay);
    await f.svc.saveRecord(hr, 'officeStaff', staff.personId!, null, { ...values, basicPay: before + 300, payReason: 'Yearly review' });
    const pc = f.ds.payChanges.find((c) => c.personId === staff.personId && c.kind === 'PAY' && c.status === 'pending')!;
    const [cos, dcos] = await Promise.all(['u-cos', 'u-dcos'].map((id) => f.svc.user(id)));
    const body = { consent: true, how: 'meeting', givenOn: TODAY, note: 'Agreed at the Monday meeting with the CEO', proof: [] };
    // Not before the HR Director has checked it.
    await expect(f.svc.recordVcConsent(dcos, 'pay', pc.id, body)).rejects.toThrow(/not waiting/);
    await f.svc.decidePayChange(cos, pc.id, true, 'Within the pay band');
    await expect(f.svc.recordVcConsent(cos, 'pay', pc.id, body)).rejects.toThrow(/You verified/);
    const rows = (await f.svc.payChanges(dcos)).rows;
    expect(rows.find((r) => r.change.id === pc.id)?.canRecordVc).toBe(true);
    // HR requested it, so HR cannot record either.
    await expect(f.svc.recordVcConsent(hr, 'pay', pc.id, body)).rejects.toThrow(/Someone else/);
    await f.svc.recordVcConsent(dcos, 'pay', pc.id, body);
    expect(f.ds.people.find((p) => p.id === staff.personId)!.basicPay).toBe(before + 300);
    expect(f.ds.payChanges.find((c) => c.id === pc.id)!.vcRecord).toMatchObject({ how: 'meeting', recordedById: 'u-dcos' });
  });

  it('puts the waiting answer on the recorder’s home', async () => {
    const { svc, q } = await staffLeaveAtVc();
    const home = await svc.home(await svc.user('u-cos'));
    expect(home.todo.some((t) => JSON.stringify(t).includes(q.id) || /Vice Chairman/.test(t.title))).toBe(true);
  });
});

describe('D1: Chief of Staff cover (Fauzan, 23 Nov 2026)', () => {
  const row = (item: CosCoverRow['item'], to: CosCoverRow['to'], at: string, until: string | null = null): CosCoverRow => ({
    id: `r-${at}`, item, to, until, reason: 'test', by: 'CoS', byId: 'u-cos', at,
  });
  const dcos = { role: 'pwvsb_officer', leadership: 'deputy_cos' } as User;
  const hrAdmin = { role: 'pwvsb_officer', department: 'hr' } as User;

  it('uses the latest row, ends it after the last day, and covers the Deputy on leave only', () => {
    const rows = [row('staff_memo', ['hr_admin'], '2026-10-20T00:00:00Z', '2026-10-25'), row('office_requests', ['dcos'], '2026-10-20T00:00:00Z')];
    expect(cosCoverInForce(rows, 'staff_memo', TODAY)).toBeNull();
    expect(cosActs(hrAdmin, 'staff_memo', rows, false, '2026-10-25').acts).toBe(true);
    expect(cosActs(hrAdmin, 'staff_memo', rows, false, TODAY).acts).toBe(false);
    expect(cosActs(dcos, 'office_requests', rows, false, TODAY)).toMatchObject({ acts: true, as: 'delegated' });
    expect(cosActs(dcos, 'staff_loans', rows, false, TODAY).acts).toBe(false);
    expect(cosActs(dcos, 'staff_loans', rows, true, TODAY)).toMatchObject({ acts: true, as: 'leave_cover' });
    expect(cosActs(hrAdmin, 'staff_loans', rows, true, TODAY).acts).toBe(false);
    // Taken back.
    const back = [...rows, row('office_requests', [], '2026-10-21T00:00:00Z')];
    expect(cosActs(dcos, 'office_requests', back, false, TODAY).acts).toBe(false);
  });

  it('lets only the Chief of Staff hand over, with a reason, and keeps PDPA and run-by for the Deputy', async () => {
    const { svc, ds } = fresh();
    const [cos, dcos, hr, ceo, fd] = await Promise.all(['u-cos', 'u-dcos', 'u-pwvsb-hr', 'u-fauzan', 'u-fd'].map((id) => svc.user(id)));
    await expect(svc.setCosCover(dcos, { item: 'staff_memo', to: ['dcos'], reason: 'Busy' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setCosCover(hr, { item: 'staff_memo', to: ['hr_admin'], reason: 'Busy' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setCosCover(cos, { item: 'staff_memo', to: ['dcos'], reason: '' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.setCosCover(cos, { item: 'pdpa_switch', to: ['hr_admin'], reason: 'Routine' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.setCosCover(cos, { item: 'office_run_by', to: ['hr_admin'], reason: 'Routine' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.setCosCover(cos, { item: 'staff_memo', to: ['dcos'], until: '2026-10-01', reason: 'Routine' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.setCosCover(cos, { item: 'nope', to: ['dcos'], reason: 'Routine' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.setCosCover(cos, { item: 'staff_memo', to: [], reason: 'Routine' })).rejects.toThrow(/Nothing to change/);
    await svc.setCosCover(cos, { item: 'staff_memo', to: ['dcos', 'hr_admin'], until: '2026-11-30', reason: 'Routine memos' });
    expect(ds.audit.some((e) => e.action === 'hr.cos_cover')).toBe(true);
    const view = await svc.cosCoverView(hr);
    expect(view.canSet).toBe(false);
    expect(view.items.find((i) => i.item === 'staff_memo')).toMatchObject({ to: ['dcos', 'hr_admin'], until: '2026-11-30', iAct: true });
    expect(view.items.find((i) => i.item === 'pdpa_switch')).toMatchObject({ dcosOnly: true, iAct: false });
    expect((await svc.cosCoverView(cos)).canSet).toBe(true);
    await expect(svc.cosCoverView(ceo)).resolves.toBeDefined();
    await expect(svc.cosCoverView(fd)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('lets the HR Administrator publish to all staff once the Chief of Staff hands memos over', async () => {
    const { svc } = fresh();
    const [cos, hr] = await Promise.all(['u-cos', 'u-pwvsb-hr'].map((id) => svc.user(id)));
    const before = (await svc.memos(hr)).canPublish;
    expect(before).not.toContain('STAFF');
    await svc.setCosCover(cos, { item: 'staff_memo', to: ['hr_admin'], reason: 'Routine memos' });
    expect((await svc.memos(hr)).canPublish).toContain('STAFF');
  });

  it('lets the Deputy switch PDPA and set which office runs a company while covering', async () => {
    const { svc } = fresh();
    const [cos, dcos] = await Promise.all(['u-cos', 'u-dcos'].map((id) => svc.user(id)));
    await expect(svc.setPdpaSettings(dcos, { enabled: false }, 'Consent forms collected')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.companyOffices(dcos)).canSetRunBy).toBe(false);
    await svc.setCosCover(cos, { item: 'pdpa_switch', to: ['dcos'], reason: 'On leave next week' });
    await svc.setCosCover(cos, { item: 'office_run_by', to: ['dcos'], reason: 'On leave next week' });
    await expect(svc.setPdpaSettings(dcos, { enabled: false }, 'Consent forms collected')).resolves.toBeDefined();
    // Only the switch moves: the keep period stays with the Chief of Staff and the PDPA officer.
    await expect(svc.setPdpaSettings(dcos, { keepYears: 3 }, 'Shorter')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.companyOffices(dcos)).canSetRunBy).toBe(true);
  });

  it('covers the Deputy on every item while the Chief of Staff is on approved leave, and not the HR Administrator', async () => {
    const { svc, ds } = fresh();
    const cosUser = ds.users.find((u) => u.id === 'u-cos')!;
    const person = ds.people.find((p) => p.role === 'office' && p.status === 'active' && !ds.users.some((u) => u.personId === p.id))!;
    cosUser.personId = person.id;
    ds.leaveRequests.push({ ...ds.leaveRequests[0], id: 'lv-cos-away', personId: person.id, status: 'approved', from: '2026-10-25', to: '2026-10-28' });
    const [dcos, hr] = await Promise.all(['u-dcos', 'u-pwvsb-hr'].map((id) => svc.user(id)));
    const view = await svc.cosCoverView(dcos);
    expect(view.cosOnLeave).toBe(true);
    expect(view.items.every((i) => i.iAct)).toBe(true);
    expect((await svc.cosCoverView(hr)).items.some((i) => i.iAct)).toBe(false);
    expect((await svc.memos(dcos)).canPublish).toContain('STAFF');
  });
});

describe('D2: office leave escalates in working hours (Fauzan, 23 Nov 2026)', () => {
  it('counts only 8.30 am to 5.30 pm on working days', () => {
    // Monday 10.00 am MYT + 12 working hours = 7.5 h Monday + 4.5 h Tuesday = Tuesday 1.00 pm MYT.
    const [first, second] = workingHourDeadlines(myt('2026-10-26', '10:00'), new Set(), 12, 2);
    expect(first).toBe(new Date(myt('2026-10-27', '13:00')).toISOString());
    // Then 4.5 h Tuesday + 7.5 h Wednesday... = Wednesday 4.00 pm.
    expect(second).toBe(new Date(myt('2026-10-28', '16:00')).toISOString());
    // Friday 4.00 pm: 1.5 h Friday, the weekend skipped, a holiday Monday skipped, 9 h Tuesday, 1.5 h Wednesday.
    const [fri] = workingHourDeadlines(myt('2026-10-30', '16:00'), new Set(['2026-11-02']), 12, 1);
    expect(fri).toBe(new Date(myt('2026-11-04', '10:00')).toISOString());
    // Sent at night: the clock starts at 8.30 next morning.
    const [night] = workingHourDeadlines(myt('2026-10-26', '22:00'), new Set(), 9, 1);
    expect(night).toBe(new Date(myt('2026-10-27', '17:30')).toISOString());
  });
});

describe('D3: HR staff’s own leave and claims go to the HR Director (Fauzan, 23 Nov 2026)', () => {
  it('sends an HR Administrator colleague’s leave to the Chief of Staff or Deputy, not to HR', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    // An office staff member who joins HR as a second HR Administrator applies; the first must not decide it.
    const colleague = ds.users.find((u) => u.department === 'it' && u.personId && ds.people.some((p) => p.id === u.personId && p.status === 'active'))!;
    colleague.department = 'hr';
    delete (colleague as { itRole?: unknown }).itRole;
    const q = await svc.requestLeave(colleague, { personId: colleague.personId!, kind: 'ANNUAL', from: '2026-11-10', to: '2026-11-10', reason: 'Family matter' });
    const row = (await svc.leaveRequests(hr, { status: 'pending' })).rows.find((r) => r.request.id === q.id)!;
    expect(row.waitingWith).toMatchObject({ level: 'HR_DIRECTOR' });
    await expect(svc.decideLeave(hr, q.id, true, 'Fine')).rejects.toBeInstanceOf(AccessDenied);
    const after = await svc.decideLeave(await svc.user('u-dcos'), q.id, true, 'Cover arranged');
    expect(after.hrApproval?.byId).toBe('u-dcos');
  });
});

describe('D3: HR staff’s own claims (Fauzan, 23 Nov 2026)', () => {
  it('lets the HR Director, not HR, check an HR Administrator’s own claim', async () => {
    const { svc, ds } = fresh();
    const colleague = ds.users.find((u) => u.department === 'it' && u.personId && ds.people.some((p) => p.id === u.personId && p.status === 'active'))!;
    colleague.department = 'hr';
    delete (colleague as { itRole?: unknown }).itRole;
    const claim = await svc.submitStaffClaim(colleague, { kind: 'MEDICAL', date: TODAY, amount: 80 }, [pdf()]);
    const [hr, cos] = await Promise.all(['u-pwvsb-hr', 'u-cos'].map((id) => svc.user(id)));
    const hrRow = (await svc.staffClaims(hr)).queue.find((r) => r.claim.id === claim.id);
    expect(hrRow?.canHr ?? false).toBe(false);
    await expect(svc.hrDecideClaim(hr, claim.id, true, 'Fine')).rejects.toThrow();
    const cosRow = (await svc.staffClaims(cos)).queue.find((r) => r.claim.id === claim.id);
    expect(cosRow?.canHr).toBe(true);
    await expect(svc.hrDecideClaim(cos, claim.id, true, 'Receipt checked')).resolves.toBeDefined();
  });
});
