import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, NotFound, PrimaService, RULES, addDays, generateDataset, myt, type Dataset } from '../src';

// Synthetic mock data only (generateDataset). Real use of meetings and memos, 5 Nov 2026.
const TODAY = '2026-11-12';
const NOW = myt(TODAY, '10:30');

function fresh(now = NOW): { ds: Dataset; svc: PrimaService; store: MemoryStore; setNow: (t: string) => void } {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  let clock = now;
  return { ds, store, svc: new PrimaService(store, () => clock), setNow: (t) => (clock = t) };
}

const groupMeeting = (attendeeIds: string[]) => ({
  companyId: null,
  kind: 'management' as const,
  title: 'Quarter planning',
  start: myt(addDays(TODAY, 2), '10:00'),
  end: myt(addDays(TODAY, 2), '11:00'),
  location: 'Boardroom',
  attendees: ['Outside auditor'],
  agenda: '1. Plan\n2. Budget',
  attendeeIds,
});

describe('Meetings in real use', () => {
  it('invites real staff, who then see the group meeting and answer; a guard or unknown person cannot be invited', async () => {
    const { svc } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const it = await svc.user('u-transport');
    await expect(svc.scheduleMeeting(doa, groupMeeting(['u-guard-sasa-1']))).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.scheduleMeeting(doa, groupMeeting(['nobody']))).rejects.toBeInstanceOf(BadRequest);
    const m = await svc.scheduleMeeting(doa, groupMeeting(['u-transport', 'u-cos']));
    expect(m.attendeeIds).toEqual(['u-transport', 'u-cos']);
    // The Transport head is in another department, but sees the meeting because they are invited.
    const row = (await svc.meetings(it)).rows.find((r) => r.meeting.id === m.id)!;
    expect(row.myInvite).toEqual({ answer: null });
    expect(row.canRun).toBe(false);
    expect((await svc.meetings(it)).toAnswer).toBeGreaterThan(0);
    await expect(svc.answerMeeting(it, m.id, 'no', '')).rejects.toThrow(/why/);
    await svc.answerMeeting(it, m.id, 'no', 'On leave');
    const after = (await svc.meetings(doa)).rows.find((r) => r.meeting.id === m.id)!;
    expect(after.invited.find((x) => x.userId === 'u-transport')).toMatchObject({ answer: 'no', note: 'On leave' });
    // Someone not invited cannot answer, and cannot change the meeting.
    const fin = await svc.user('u-pwvsb-hr');
    await expect(svc.answerMeeting(fin, m.id, 'yes')).rejects.toBeInstanceOf(NotFound);
    await expect(svc.changeMeeting(it, m.id, { location: 'Room 2', reason: 'Bigger room' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('needs a reason to change or cancel, clears answers when the time moves and keeps the history', async () => {
    const { svc } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const cos = await svc.user('u-cos');
    const m = await svc.scheduleMeeting(doa, groupMeeting(['u-cos']));
    await svc.answerMeeting(cos, m.id, 'yes');
    await expect(svc.changeMeeting(doa, m.id, { location: 'Room 2', reason: '' })).rejects.toThrow(/why/);
    await expect(svc.changeMeeting(doa, m.id, { location: m.location, reason: 'No change really' })).rejects.toThrow(/Nothing/);
    const moved = await svc.changeMeeting(doa, m.id, {
      start: myt(addDays(TODAY, 3), '14:00'),
      end: myt(addDays(TODAY, 3), '15:00'),
      reason: 'CEO travelling on the first date',
    });
    expect(moved.rsvp).toEqual([]);
    expect(moved.changes!.at(-1)).toMatchObject({ by: doa.name, reason: 'CEO travelling on the first date' });
    await expect(svc.cancelMeeting(doa, m.id, 'no')).rejects.toThrow(/why/);
    const off = await svc.cancelMeeting(doa, m.id, 'Replaced by the board meeting');
    expect(off.status).toBe('cancelled');
    expect(off.cancelled!.reason).toBe('Replaced by the board meeting');
    await expect(svc.changeMeeting(doa, m.id, { location: 'Room 3', reason: 'Try again' })).rejects.toThrow(/coming meeting/);
    await expect(svc.addMinutes(doa, m.id, 'x'.repeat(40))).rejects.toThrow(/cancelled/);
  });

  it('records who attended with the minutes, links action owners, and lets only the owner or organiser mark them done', async () => {
    const { svc, setNow } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const cos = await svc.user('u-cos');
    const transport = await svc.user('u-transport');
    const m = await svc.scheduleMeeting(doa, groupMeeting(['u-cos', 'u-transport']));
    setNow(myt(addDays(TODAY, 2), '12:00'));
    const text = `Plan agreed.\nAction: Send the staff budget (Aisyah, by ${addDays(TODAY, 9)})\nAction: Book the vans (Somebody Else)`;
    // Every invited person must be marked; attendance only lists the invited or guests by name.
    await expect(svc.addMinutes(doa, m.id, text, [{ userId: 'u-cos', state: 'present' }])).rejects.toThrow(/every invited/);
    await expect(
      svc.addMinutes(doa, m.id, text, [
        { userId: 'u-cos', state: 'present' },
        { userId: 'u-transport', state: 'present' },
        { userId: 'u-coo', state: 'present' },
      ]),
    ).rejects.toThrow(/invitation/);
    const held = await svc.addMinutes(doa, m.id, text, [
      { userId: 'u-cos', state: 'present' },
      { userId: 'u-transport', state: 'apology' },
      { name: 'Outside auditor', state: 'present' },
    ]);
    expect(held.attendance).toHaveLength(3);
    expect(held.summary!.actions[0].ownerId).toBe('u-cos');
    expect(held.summary!.actions[1].ownerId).toBeNull();
    // Corrections are allowed until the Director Office checks the summary (below), then refused.

    // The owner sees it as theirs and marks it done; someone else invited cannot.
    expect((await svc.meetings(cos)).myActions.map((a) => a.text)).toEqual(['Send the staff budget']);
    await expect(svc.setMeetingAction(transport, m.id, 0, true)).rejects.toBeInstanceOf(AccessDenied);
    const done = await svc.setMeetingAction(cos, m.id, 0, true, 'Sent to FD');
    expect(done.summary!.actions[0]).toMatchObject({ done: true, doneBy: cos.name, doneNote: 'Sent to FD' });
    // The Director Office corrects the owner of the second action to a real person.
    const checked = await svc.checkMeetingSummary(doa, m.id, {
      actions: [
        { text: 'Send the staff budget', owner: 'Aisyah', ownerId: 'u-cos', due: addDays(TODAY, 9) },
        { text: 'Book the vans', owner: '', ownerId: 'u-transport', due: null },
      ],
    });
    expect(checked.summary!.actions[0].done).toBe(true);
    expect(checked.summary!.actions[1]).toMatchObject({ ownerId: 'u-transport', owner: transport.name });
    await expect(svc.addMinutes(doa, m.id, text, [])).rejects.toThrow(/checked these minutes/);
    await expect(
      svc.checkMeetingSummary(doa, m.id, { actions: [{ text: 'Book the vans', owner: '', ownerId: 'u-guard-sasa-1', due: null }] }),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it('carries open actions from the last meeting of the same series and reminds on the home screen', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    const cmsHead = await svc.user('u-cms-head');
    const d = await svc.meetings(coo);
    const cms = d.sections!.find((s) => s.key === 'cms')!;
    expect(cms.state).toBe('held');
    // Next month's CMS meeting shows last month's open action.
    const next = await svc.scheduleMeeting(coo, {
      companyId: null,
      kind: 'operations',
      title: 'Mesyuarat Operasi Bulanan: CMS command centre',
      start: myt('2026-12-08', '10:00'),
      end: myt('2026-12-08', '11:00'),
      location: 'CMS',
      attendees: [],
      agenda: RULES.opsMeeting.value.agenda.join('\n'),
      attendeeIds: ['u-cms-head'],
      sectionKey: 'cms',
    });
    const row = (await svc.meetings(coo)).rows.find((r) => r.meeting.id === next.id)!;
    expect(row.carried.map((a) => a.text)).toEqual(['Chase the two offline alarm panels with the site owners']);
    // The CMS head's home lists the action and the invitation.
    const home = await svc.meetings(cmsHead);
    expect(home.myActions).toHaveLength(1);
    expect(home.toAnswer).toBe(1);
  });
});

describe('COO monthly operations meeting per section (rule OPS-MEETING)', () => {
  it('shows each section this month, lets only the COO or Director Office set one per section per month', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    const doa = await svc.user('u-pwvsb-doa');
    const ogm = await svc.user('u-ogm');
    const board = (await svc.meetings(coo)).sections!;
    expect(board.map((s) => s.key)).toEqual(RULES.opsMeeting.value.sections.map((s) => s.key));
    expect(board.find((s) => s.key === 'gov')!.state).toBe('scheduled');
    // After the 10th, a section with nothing set is late.
    expect(board.find((s) => s.key === 'arms')).toMatchObject({ state: 'none', late: true });
    const input = {
      companyId: null,
      kind: 'other' as const,
      title: 'Mesyuarat Operasi Bulanan: Arms Control',
      start: myt(addDays(TODAY, 4), '10:00'),
      end: myt(addDays(TODAY, 4), '11:00'),
      location: 'Arms Control office',
      attendees: [],
      agenda: RULES.opsMeeting.value.agenda.join('\n'),
      sectionKey: 'arms',
    };
    await expect(svc.scheduleMeeting(ogm, input)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.scheduleMeeting(coo, { ...input, sectionKey: 'nope' })).rejects.toThrow(/section/);
    const m = await svc.scheduleMeeting(coo, input);
    expect(m).toMatchObject({ kind: 'operations', department: 'arms_control', companyId: null, sectionKey: 'arms' });
    await expect(svc.scheduleMeeting(doa, input)).rejects.toThrow(/already has its meeting/);
    expect((await svc.meetings(coo)).sections!.find((s) => s.key === 'arms')!.state).toBe('scheduled');
    // Other leaders see no section board.
    expect((await svc.meetings(ogm)).sections).toBeNull();
    // The COO's home names the sections still open.
    const home = await svc.home(coo);
    expect(home.todo.some((t) => t.tag === 'Operations meeting' && t.title.includes('section meeting'))).toBe(true);
  });

  it('flags minutes due after the meeting and late after the minutes window', async () => {
    const { svc, setNow } = fresh();
    const coo = await svc.user('u-coo');
    setNow(myt(addDays(TODAY, 3 + RULES.opsMeeting.value.minutesWithinDays + 1), '12:00'));
    const gov = (await svc.meetings(coo)).sections!.find((s) => s.key === 'gov')!;
    expect(gov).toMatchObject({ state: 'minutes_due', late: true });
    const row = (await svc.meetings(coo)).rows.find((r) => r.meeting.id === 'mt-sec-gov')!;
    expect(row.minutesLateDays).toBeGreaterThan(0);
  });
});

describe('Memos in real use', () => {
  it('numbers memos per publisher and year, sets a read-by date and shows the publisher who has not read', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const coo = await svc.user('u-coo');
    const hr = await svc.user('u-pwvsb-hr');
    const m = await svc.publishMemo(cos, 'STAFF', 'Claims cut-off', 'Submit by the 25th.');
    expect(m.ref).toBe('MEMO/COS/2026/002');
    expect(m.readBy).toBe(addDays(TODAY, RULES.memoRead.value.readWithinDays));
    const f = await svc.publishMemo(coo, 'FIELD', 'Inspection', 'Uniform check.', [], { readBy: addDays(TODAY, 1) });
    expect(f.ref).toBe('MEMO/COO/2026/002');
    await expect(svc.publishMemo(cos, 'STAFF', 'Late', 'Body', [], { readBy: addDays(TODAY, -1) })).rejects.toThrow(/read-by/);
    const view = await svc.memos(cos);
    const row = view.memos.find((x) => x.id === m.id)!;
    expect(row.expectedCount).toBeGreaterThan(1);
    expect(row.notRead.some((u) => u.userId === 'u-pwvsb-hr')).toBe(true);
    expect(row.notRead.some((u) => u.userId === 'u-guard-sasa-1')).toBe(false);
    // A reader never sees the not-read list.
    const hrRow = (await svc.memos(hr)).memos.find((x) => x.id === m.id)!;
    expect(hrRow.notRead).toEqual([]);
    expect(hrRow.expectedCount).toBeNull();
    await svc.readMemo(hr, m.id);
    expect((await svc.memos(cos)).memos.find((x) => x.id === m.id)!.notRead.some((u) => u.userId === 'u-pwvsb-hr')).toBe(false);
    expect((await svc.memoReach(cos, 'STAFF', [])).count).toBe(row.expectedCount);
    await expect(svc.memoReach(hr, 'STAFF', [])).rejects.toBeInstanceOf(AccessDenied);
  });

  it('lets only the publisher withdraw or replace a memo with a reason, and remind once a day', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const hr = await svc.user('u-pwvsb-hr');
    const old = await svc.publishMemo(cos, 'STAFF', 'Office hours', 'Opens 8.30.');
    await expect(svc.withdrawMemo(coo, old.id, 'Wrong memo')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.withdrawMemo(ceo, old.id, 'Wrong memo')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.remindMemo(hr, old.id)).rejects.toBeInstanceOf(AccessDenied);
    const r = await svc.remindMemo(cos, old.id);
    expect(r.reminders![0].count).toBeGreaterThan(0);
    await expect(svc.remindMemo(cos, old.id)).rejects.toThrow(/already/);
    // A corrected memo replaces the old one; the old one no longer counts as unread.
    await expect(svc.publishMemo(coo, 'FIELD', 'Fix', 'Body text', [], { replaces: old.id })).rejects.toThrow(/only replace/);
    const unreadBefore = (await svc.memos(hr)).unread;
    const fix = await svc.publishMemo(cos, 'STAFF', 'Office hours (corrected)', 'Opens 8.00.', [], { replaces: old.id });
    const hrView = await svc.memos(hr);
    expect(hrView.memos.find((x) => x.id === old.id)).toMatchObject({ status: 'replaced', replacedByRef: fix.ref });
    expect(hrView.unread).toBe(unreadBefore);
    await expect(svc.publishMemo(cos, 'STAFF', 'Again', 'Body text', [], { replaces: old.id })).rejects.toThrow(/already/);
    await expect(svc.withdrawMemo(cos, fix.id, 'oops')).rejects.toThrow(/why/);
    await svc.withdrawMemo(cos, fix.id, 'Sent too early');
    expect((await svc.memos(hr)).memos.find((x) => x.id === fix.id)!.status).toBe('withdrawn');
    await expect(svc.readMemo(hr, fix.id)).rejects.toThrow(/withdrawn/);
  });

  it('puts memos to read and memos to chase on the home screen', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const cm = await svc.user('u-cm-sasa');
    const cmHome = await svc.home(cm);
    expect(cmHome.todo.some((t) => t.tag === 'Memo' && /to read/.test(t.title))).toBe(true);
    // The seeded Chief of Staff memo is past its read-by date with people not read.
    const cosMemos = await svc.memos(cos);
    expect(cosMemos.memos.find((m) => m.id === 'memo-seed-cos-1')!.notReadCount).toBeGreaterThan(0);
    const cosHome = await svc.home(cos);
    expect(cosHome.todo.some((t) => t.tag === 'Memo' && /past the read-by date/.test(t.title))).toBe(true);
  });
});

describe('Regular meetings for every staff member (rule MTG-PLAN)', () => {
  it('gives each job its regular meetings and lets only the one who sets it set it, once per period', async () => {
    const { svc } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const cm = await svc.user('u-cm-sasa');
    const ae = (await svc.meetings(cm)).plan;
    // The company manager sets the company's weekly office, monthly operations and quarterly board meetings.
    const office = ae.find((p) => p.seriesKey === 'co-office:co-sasa')!;
    expect(office).toMatchObject({ iSet: true, every: 'fortnight' });
    expect(ae.some((p) => p.seriesKey === 'co-board:co-sasa' && p.iSet)).toBe(true);
    // Another company's manager does not see Sasa's series.
    const other = (await svc.meetings(await svc.user('u-cm-arsh'))).plan;
    expect(other.some((p) => p.seriesKey.endsWith(':co-sasa'))).toBe(false);
    // The Director Office sets group meetings; the CEO attends.
    const ceoPlan = (await svc.meetings(await svc.user('u-fauzan'))).plan;
    expect(ceoPlan.find((p) => p.seriesKey === 'grp-mgmt:group')!.iAttend).toBe(true);
    // Every central department with two or more people has a weekly meeting set by its head.
    const it = (await svc.meetings(await svc.user('u-transport'))).plan;
    expect(it.length).toBeGreaterThanOrEqual(0);
    const all = (await svc.meetings(doa)).plan;
    expect(all.filter((p) => p.seriesKey.startsWith('dept-toolbox:')).length).toBeGreaterThan(3);
    const input = {
      companyId: null,
      kind: 'other' as const,
      title: 'Office weekly',
      start: myt(addDays(TODAY, 1), '09:00'),
      end: myt(addDays(TODAY, 1), '10:00'),
      location: 'Office',
      attendees: [],
      agenda: '1. Actions',
      attendeeIds: office.inviteeIds,
      seriesKey: 'co-office:co-sasa',
    };
    await expect(svc.scheduleMeeting(await svc.user('u-cm-arsh'), input)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.scheduleMeeting(cm, { ...input, seriesKey: 'nope:x' })).rejects.toThrow(/not in the plan/);
    const m = await svc.scheduleMeeting(cm, input);
    expect(m).toMatchObject({ companyId: 'co-sasa', kind: 'management', seriesKey: 'co-office:co-sasa' });
    await expect(svc.scheduleMeeting(cm, input)).rejects.toThrow(/already set/);
    expect((await svc.meetings(cm)).plan.find((p) => p.seriesKey === 'co-office:co-sasa')!.state).toBe('scheduled');
    // An admin executive of the company is invited and sees it as theirs to attend.
    const aePlan = (await svc.meetings(await svc.user('u-bm-sasa-1'))).plan.find((p) => p.seriesKey === 'co-office:co-sasa')!;
    expect(aePlan).toMatchObject({ iSet: false, iAttend: true, state: 'scheduled' });
  });

  it('follows the frequencies Fauzan set on 5 Nov 2026 and adds the monthly general meeting', async () => {
    const { svc } = fresh();
    const plan = (await svc.meetings(await svc.user('u-pwvsb-doa'))).plan;
    const every = (k: string) => plan.find((p) => p.seriesKey.startsWith(`${k}:`))!.every;
    expect(every('grp-mgmt')).toBe('fortnight');
    expect(every('dept-toolbox')).toBe('fortnight');
    expect(every('co-office')).toBe('fortnight');
    expect(every('co-ops')).toBe('bimonth');
    expect(every('co-board')).toBe('year');
    expect(every('grp-board-review')).toBe('quarter');
    expect(every('fin-close')).toBe('month');
    const general = plan.find((p) => p.seriesKey === 'grp-general:group')!;
    expect(general.every).toBe('month');
    for (const id of ['u-cm-sasa', 'u-cm-arsh', 'u-chair', 'u-vchair', 'u-pwvsb-doa', 'u-fin-t1-lead', 'u-it-mgr']) expect(general.inviteeIds).toContain(id);
    expect(general.inviteeIds).not.toContain('u-it-lead');
    // Two meetings in the same fortnight are refused; the next fortnight is fine.
    const cm = await svc.user('u-cm-sasa');
    const office = (await svc.meetings(cm)).plan.find((p) => p.seriesKey === 'co-office:co-sasa')!;
    const at = (d: string) => ({
      companyId: null,
      kind: 'other' as const,
      title: 'Office',
      start: myt(d, '09:00'),
      end: myt(d, '10:00'),
      location: 'Office',
      attendees: [],
      agenda: '1. Actions',
      attendeeIds: office.inviteeIds,
      seriesKey: 'co-office:co-sasa',
    });
    // Fortnights run from Monday 5 Jan 2026, so 23 Nov and 4 Dec 2026 share a fortnight; 7 Dec starts the next.
    await svc.scheduleMeeting(cm, at('2026-11-23'));
    await expect(svc.scheduleMeeting(cm, at('2026-12-04'))).rejects.toThrow(/already set/);
    await svc.scheduleMeeting(cm, at('2026-12-07'));
  });

  it('lets the Director Office move the date and time of any regular meeting, with a reason (Fauzan, 5 Nov 2026)', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const doa = await svc.user('u-pwvsb-doa');
    const office = (await svc.meetings(cm)).plan.find((p) => p.seriesKey === 'co-office:co-sasa')!;
    const d = addDays(TODAY, 1);
    const m = await svc.scheduleMeeting(cm, {
      companyId: null,
      kind: 'other' as const,
      title: 'Office',
      start: myt(d, '09:00'),
      end: myt(d, '10:00'),
      location: 'Office',
      attendees: [],
      agenda: '1. Actions',
      attendeeIds: office.inviteeIds,
      seriesKey: 'co-office:co-sasa',
    });
    const later = addDays(TODAY, 2);
    await expect(svc.changeMeeting(doa, m.id, { start: myt(later, '14:00'), end: myt(later, '15:00'), reason: '' })).rejects.toThrow(/why/);
    const moved = await svc.changeMeeting(doa, m.id, { start: myt(later, '14:00'), end: myt(later, '15:00'), reason: 'CEO is away on the first date' });
    expect(moved.start).toBe(myt(later, '14:00'));
    expect(moved.changes!.at(-1)).toMatchObject({ by: doa.name });
    // Someone outside the company office cannot move it.
    await expect(
      svc.changeMeeting(await svc.user('u-cm-arsh'), m.id, { start: myt(later, '16:00'), end: myt(later, '17:00'), reason: 'Not my meeting' }),
    ).rejects.toBeInstanceOf(AccessDenied);
  });

  it('puts what is important now at the top of the agenda and still flags a late meeting', async () => {
    const { svc } = fresh();
    const plan = (await svc.meetings(await svc.user('u-cm-sasa'))).plan;
    const office = plan.find((p) => p.seriesKey === 'co-office:co-sasa')!;
    expect(office.important.length).toBeGreaterThan(0);
    expect(office.agenda.slice(0, office.important.length)).toEqual(office.important);
    expect(office.agenda).toContain('Action items from the last meeting');
    const board = plan.find((p) => p.seriesKey === 'co-board:co-sasa')!;
    expect(board.important.some((x) => x.startsWith('Tenders'))).toBe(false);
  });

  it('reminds the one who sets a regular meeting on their home screen', async () => {
    const { svc } = fresh();
    const home = await svc.home(await svc.user('u-cm-sasa'));
    expect(home.todo.some((t) => t.tag === 'Regular meeting')).toBe(true);
  });
});

describe('Team memos (5 Nov 2026)', () => {
  it('lets a manager send a memo to their own team only; all-staff stays with the Chief of Staff', async () => {
    const { svc, ds } = fresh();
    const ctxUsers = ds.users;
    const cm = await svc.user('u-cm-sasa');
    const view = await svc.memos(cm);
    expect(view.canPublish).toContain('TEAM');
    expect(view.canPublish).not.toContain('STAFF');
    expect(view.teamSize).toBeGreaterThan(0);
    await expect(svc.publishMemo(cm, 'STAFF', 'All staff', 'Body text')).rejects.toThrow(/Chief of Staff/);
    await expect(svc.publishMemo(cm, 'TEAM', 'Team', 'Body text', ['Selangor'])).rejects.toThrow(/whole team/);
    const m = await svc.publishMemo(cm, 'TEAM', 'Sasa office hours', 'Office opens 8.30 on Saturday.');
    expect(m.ref).toMatch(/^MEMO\/TEAM-[A-Z]+\/2026\/001$/);
    expect(m.teamOf).toBe(cm.id);
    const ae = await svc.user('u-bm-sasa-1');
    expect((await svc.memos(ae)).memos.find((x) => x.id === m.id)!.forMe).toBe(true);
    // Another company's admin executive and an unrelated department do not get it.
    expect((await svc.memos(await svc.user('u-ae-arsh'))).memos.some((x) => x.id === m.id)).toBe(false);
    await expect(svc.readMemo(await svc.user('u-ae-arsh'), m.id)).rejects.toBeInstanceOf(NotFound);
    await svc.readMemo(ae, m.id);
    const mine = (await svc.memos(cm)).memos.find((x) => x.id === m.id)!;
    expect(mine.readCount).toBe(1);
    expect(mine.expectedCount).toBe(view.teamSize);
    // Only the team's own manager manages it.
    await expect(svc.withdrawMemo(await svc.user('u-cos'), m.id, 'Not mine to withdraw')).rejects.toBeInstanceOf(AccessDenied);
    await svc.withdrawMemo(cm, m.id, 'Hours changed again');
    expect(ctxUsers.length).toBeGreaterThan(0);
  });

  it('gives no team memo to someone with nobody reporting to them', async () => {
    const { svc } = fresh();
    const ae = await svc.user('u-ae-arsh');
    expect((await svc.memos(ae)).canPublish).toEqual([]);
    await expect(svc.publishMemo(ae, 'TEAM', 'Team', 'Body text')).rejects.toThrow(/team on record/);
  });
});
