import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt, reportPeriods, type ReportDef } from '../src';

// Central Admin 5E (Fauzan, 2 Nov 2026): the Director Office lists every report and meeting itself, recurring or one
// time; toolbox talks every 2 weeks; CEO instructions tracked to done; a weekly digest nobody has to write. Dummy data.
const TODAY = '2026-11-02';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const clock = { now: NOW };
  return { ds, store, clock, svc: new PrimaService(store, () => clock.now) };
};
const def = (over: Partial<ReportDef>): ReportDef => ({
  id: 'x',
  name: 'X',
  detail: '',
  from: 'company',
  frequency: 'monthly',
  dueDay: 7,
  active: true,
  ...over,
});

describe('Director Office reports and meetings, recurring or one time (5E)', () => {
  it('works out periods for every repeat and for a one-time report', () => {
    expect(reportPeriods(def({ frequency: 'once', dueOn: '2026-12-15' }), TODAY, 4)).toEqual([
      { period: 'once-2026-12-15', label: 'One time', due: '2026-12-15' },
    ]);
    const q = reportPeriods(def({ frequency: 'quarterly', dueDay: 15 }), TODAY, 2);
    expect(q.map((p) => [p.period, p.due])).toEqual([
      ['2026-Q4', '2027-01-15'],
      ['2026-Q3', '2026-10-15'],
    ]);
    const y = reportPeriods(def({ frequency: 'yearly', dueOn: '2025-03-31' }), TODAY, 2);
    expect(y.map((p) => p.due)).toEqual(['2027-03-31', '2026-03-31']);
    const f = reportPeriods(def({ frequency: 'fortnightly', dueDay: 5 }), TODAY, 3);
    // Pairs of weeks from Monday 5 Jan 2026; due on the Friday of the second week.
    expect(f.map((p) => p.due)).toEqual(['2026-11-06', '2026-10-23', '2026-10-09']);
  });

  it('lets only the Director Office set the list, and checks a one-time report has a date', async () => {
    const { svc } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const keep = (await svc.reports(doa)).editList!;
    await expect(svc.setReportDefs(doa, [...keep, def({ id: '', name: 'Year-end pack', frequency: 'once' })], 'add')).rejects.toThrow(/date it is due/);
    const saved = await svc.setReportDefs(
      doa,
      [
        ...keep,
        def({
          id: '',
          name: 'Year-end pack',
          frequency: 'once',
          dueOn: '2026-12-31',
        }),
        def({
          id: '',
          name: 'Toolbox report',
          frequency: 'fortnightly',
          dueDay: 5,
        }),
      ],
      'Added the year-end pack and toolbox reports',
    );
    expect(saved.find((d) => d.name === 'Year-end pack')).toMatchObject({
      frequency: 'once',
      dueOn: '2026-12-31',
    });
    await expect(svc.setReportDefs(await svc.user('u-cm-sasa'), keep, 'x')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('sets toolbox talks every 2 weeks and carries the last meeting’s open actions into the next agenda', async () => {
    const { svc, clock } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const first = await svc.scheduleMeeting(cm, {
      companyId: 'co-sasa',
      kind: 'toolbox',
      title: 'Toolbox talk (mock)',
      start: myt('2026-11-03', '09:00'),
      end: myt('2026-11-03', '09:30'),
      location: 'Office',
      attendees: [],
      agenda: 'Safety topic',
      times: 4,
    });
    let rows = (await svc.meetings(cm)).rows.filter((r) => r.meeting.seriesId === first.id);
    expect(rows.map((r) => r.meeting.start.slice(0, 10)).sort()).toEqual(['2026-11-03', '2026-11-17', '2026-12-01', '2026-12-15']);
    expect(rows.every((r) => r.meeting.repeat === 'fortnightly')).toBe(true);
    clock.now = myt('2026-11-03', '10:00');
    await svc.addMinutes(cm, first.id, 'Discussed PPE. Action: Ali to replace torch batteries at gate by Friday.');
    rows = (await svc.meetings(cm)).rows.filter((r) => r.meeting.seriesId === first.id);
    const next = rows.find((r) => r.meeting.start.startsWith('2026-11-17'))!;
    const held = rows.find((r) => r.meeting.id === first.id)!;
    expect(next.carried).toEqual(held.meeting.summary!.actions.filter((a) => !a.done).map((a) => ({ text: a.text, owner: a.owner, due: a.due })));
    // A one-time meeting stays one meeting; a monthly one keeps its day, or the month's last day.
    const one = await svc.scheduleMeeting(cm, {
      companyId: 'co-sasa',
      kind: 'management',
      title: 'One-off',
      start: myt('2026-11-10', '09:00'),
      end: myt('2026-11-10', '10:00'),
      location: '',
      attendees: [],
      agenda: 'Item',
    });
    expect(one.seriesId).toBeNull();
    const monthly = await svc.scheduleMeeting(cm, {
      companyId: 'co-sasa',
      kind: 'management',
      title: 'Month end',
      start: myt('2027-01-31', '09:00'),
      end: myt('2027-01-31', '10:00'),
      location: '',
      attendees: [],
      agenda: 'Item',
      repeat: 'monthly',
      times: 3,
    });
    const m = (await svc.meetings(cm)).rows
      .filter((r) => r.meeting.seriesId === monthly.id)
      .map((r) => r.meeting.start.slice(0, 10))
      .sort();
    expect(m).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    await expect(
      svc.scheduleMeeting(cm, {
        companyId: 'co-sasa',
        kind: 'management',
        title: 'Too many',
        start: myt('2026-11-10', '09:00'),
        end: myt('2026-11-10', '10:00'),
        location: '',
        attendees: [],
        agenda: 'Item',
        repeat: 'weekly',
        times: 40,
      }),
    ).rejects.toThrow(/1 to 26/);
  });
});

describe('CEO instructions and the weekly digest (5E)', () => {
  it('tracks a CEO instruction to the owner, flags it overdue to the CEO, and lets only the CEO or Director Office give one', async () => {
    const { svc, clock } = fresh();
    const ceo = await svc.user('u-fauzan');
    const doa = await svc.user('u-pwvsb-doa');
    const due = myt('2026-11-04', '17:00');
    await expect(
      svc.ceoInstruct(await svc.user('u-cos'), {
        userId: 'u-cm-sasa',
        title: 'Send the report',
        doneMeans: 'Report sent to CEO',
        dueAt: due,
        priority: 'high',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.ceoInstruct(ceo, {
        userId: 'u-fauzan',
        title: 'Do it myself',
        doneMeans: 'Something done here',
        dueAt: due,
        priority: 'high',
      }),
    ).rejects.toThrow();
    const t = await svc.ceoInstruct(doa, {
      userId: 'u-cm-sasa',
      title: 'Close the Kedah site complaint',
      doneMeans: 'Client letter of closure on file',
      dueAt: due,
      priority: 'high',
    });
    expect(t).toMatchObject({ source: 'ceo', assignedById: 'u-fauzan' });
    expect(t.assignedBy).toMatch(/recorded by/);
    expect(JSON.stringify(await svc.home(await svc.user('u-cm-sasa'), 'co-sasa'))).toMatch(/Close the Kedah site complaint/);
    clock.now = myt('2026-11-05', '09:00');
    const list = await svc.ceoInstructions(ceo);
    expect(list.totals.overdue).toBe(1);
    const h = await svc.home(ceo);
    expect(JSON.stringify([...h.todo, ...(h.watch ?? [])])).toMatch(/CEO instruction overdue/);
    await expect(svc.ceoInstructions(await svc.user('u-cm-sasa'))).rejects.toBeInstanceOf(AccessDenied);
    // The owner finishes; the CEO accepts with a reason.
    await svc.workTaskDone(await svc.user('u-cm-sasa'), t.id, {
      note: 'Closure letter received',
      ref: 'LTR-1 (mock)',
    });
    await expect(svc.workTaskReview(ceo, t.id, true, '')).rejects.toThrow(/reason/);
    await svc.workTaskReview(ceo, t.id, true, 'Letter seen');
    expect((await svc.ceoInstructions(ceo)).totals.done).toBe(1);
  });

  it('puts the weekly digest together from what is keyed in, for the CEO and the Director Office only', async () => {
    const { svc } = fresh();
    const d = await svc.directorDigest(await svc.user('u-fauzan'));
    expect(d.lines.map((l) => l.key)).toEqual(expect.arrayContaining(['meetings', 'reports', 'actions', 'instructions', 'filings', 'renewals', 'owners']));
    const doa = await svc.directorDigest(await svc.user('u-pwvsb-doa'));
    expect(doa.lines.map((l) => l.key)).toEqual(expect.arrayContaining(['meetings', 'reports', 'instructions']));
    for (const id of ['u-cm-sasa', 'u-fwm-ex1', 'u-transport']) await expect(svc.directorDigest(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    // Monday: the digest is on the CEO's home.
    const h = await svc.home(await svc.user('u-fauzan'));
    expect(JSON.stringify([...h.todo, ...(h.watch ?? [])])).toMatch(/Weekly Director Office digest/);
  });
});
