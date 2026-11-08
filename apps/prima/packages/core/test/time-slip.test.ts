import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  addDays,
  allocateMakeUp,
  generateDataset,
  myt,
  shortfallLeaveDays,
  type StaffClock,
  type TimeSlip,
} from '../src';

// Time slip (Fauzan, 4 Nov 2026, rule HR-TIME-SLIP). Synthetic mock data only.
const TODAY = '2026-10-26'; // a Monday
const NOW = myt(TODAY, '10:30');

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const at = { now: NOW };
  return { ds, store, at, svc: new PrimaService(store, () => at.now) };
}

/** A staff clock record from in to out (HH:MM) on a day, signed in and out normally unless flagged. */
function clock(userId: string, day: string, from: string, to: string, flags: StaffClock['flags'] = []): StaffClock {
  const shot = (t: string) => ({
    image: '',
    sha256: '',
    capturedAt: myt(day, t),
    receivedAt: myt(day, t),
    lat: null,
    lng: null,
    accuracyM: null,
    distanceM: null,
    face: null,
    source: 'login' as const,
  });
  return { id: `sc-test-${userId}-${day}-${from}`, userId, userName: userId, companyId: null, in: shot(from), out: shot(to), flags, lastPingAt: null, pings: 0, mode: 'login' };
}

const ask = { date: TODAY, from: '14:00', to: '16:00', reason: 'Bank appointment' };

describe('time slip (HR-TIME-SLIP)', () => {
  it('sends a central staff slip to the department head, needs a comment, refuses self-approval and tells HR', async () => {
    const { svc } = setup();
    const ex = await svc.user('u-it-ex3');
    const mine = await svc.myTimeSlips(ex);
    expect(mine.allowed).toBe(true);
    expect(mine.approver?.label).toBe('Department head');
    expect(mine.approver?.names).toEqual(['IT Manager (mock)']);
    const s = await svc.requestTimeSlip(ex, ask);
    expect(s.minutes).toBe(120);
    expect(s.status).toBe('pending');
    // Nobody approves their own, and someone who is not the approver cannot.
    await expect(svc.decideTimeSlip(ex, s.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideTimeSlip(await svc.user('u-pwvsb-hr'), s.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideTimeSlip(await svc.user('u-it-lead'), s.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const mgr = await svc.user('u-it-mgr');
    expect((await svc.myTimeSlips(mgr)).toDecide.map((w) => w.slip.id)).toEqual([s.id]);
    await expect(svc.decideTimeSlip(mgr, s.id, true, '')).rejects.toThrow(/comment/);
    await expect(svc.decideTimeSlip(mgr, s.id, false, 'no')).rejects.toThrow(/why/);
    const ok = (await svc.decideTimeSlip(mgr, s.id, true, 'Fine, go')) as TimeSlip;
    expect(ok.status).toBe('approved');
    expect(ok.makeUpBy).toBe(addDays(TODAY, 30));
    expect(ok.approverMode).toBe('head');
    expect(ok.hrNotice?.to).toContain('u-pwvsb-hr');
    // HR sees it as new and marks it seen.
    const hr = await svc.user('u-pwvsb-hr');
    const board = await svc.timeSlipBoard(hr);
    expect(board.rows.find((r) => r.slip.id === s.id)?.unseen).toBe(true);
    await svc.seenTimeSlip(hr, s.id);
    expect((await svc.timeSlipBoard(hr)).rows.find((r) => r.slip.id === s.id)?.unseen).toBe(false);
    await expect(svc.decideTimeSlip(mgr, s.id, true, 'again')).rejects.toThrow(/answered/);
  });

  it('keeps a slip within office hours, at most 4 hours, not in the past and not overlapping', async () => {
    const { svc } = setup();
    const ex = await svc.user('u-it-ex3');
    await expect(svc.requestTimeSlip(ex, { ...ask, from: '12:00', to: '16:30' })).rejects.toThrow(/at most 4 hours/);
    await expect(svc.requestTimeSlip(ex, { ...ask, from: '16:00', to: '18:00' })).rejects.toThrow(/office hours/);
    await expect(svc.requestTimeSlip(ex, { ...ask, from: '15:00', to: '14:00' })).rejects.toThrow(/return after/);
    await expect(svc.requestTimeSlip(ex, { ...ask, date: addDays(TODAY, -1) })).rejects.toThrow(/before the day/);
    await expect(svc.requestTimeSlip(ex, { ...ask, reason: 'x' })).rejects.toThrow(/reason/);
    await svc.requestTimeSlip(ex, ask);
    await expect(svc.requestTimeSlip(ex, { ...ask, from: '15:00', to: '17:00' })).rejects.toThrow(/already have/);
    // Guards do not use time slips.
    const guard = (await new MemoryStore(generateDataset({ today: TODAY, now: NOW })).list('users', {})).find((u) => u.role === 'guard');
    if (guard) await expect(svc.requestTimeSlip(guard, ask)).rejects.toThrow(/office staff/);
  });

  it('routes company staff to their own company head, and only HR changes who approves', async () => {
    const { svc } = setup();
    const ae = await svc.user('u-ae-arsh');
    expect((await svc.myTimeSlips(ae)).approver?.label).toBe('Company head');
    const s = await svc.requestTimeSlip(ae, ask);
    await expect(svc.decideTimeSlip(await svc.user('u-cm-sasa'), s.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    // A company manager's own slip goes to HR (no company head above them).
    expect((await svc.myTimeSlips(await svc.user('u-cm-arsh'))).approver?.label).toMatch(/^HR/);
    // Only HR sets it, with a reason.
    await expect(svc.setTimeSlipApprover(await svc.user('u-cm-arsh'), 'hr', 'Because')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setTimeSlipApprover(await svc.user('u-it-mgr'), 'hr', 'Because')).rejects.toBeInstanceOf(AccessDenied);
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.setTimeSlipApprover(hr, 'hr', '')).rejects.toThrow(/reason/);
    await svc.setTimeSlipApprover(hr, 'hr', 'Pilot: HR approves for now');
    expect((await svc.myTimeSlips(ae)).approver?.label).toBe('HR');
    // The waiting slip now goes to HR, not the company head.
    await expect(svc.decideTimeSlip(await svc.user('u-cm-arsh'), s.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const done = (await svc.decideTimeSlip(hr, s.id, true, 'Approved by HR')) as TimeSlip;
    expect(done.approverMode).toBe('hr');
    // HR's own slip goes to the HR Director, never to HR themselves.
    expect((await svc.myTimeSlips(hr)).approver?.label).toBe('HR Director');
    const b = await svc.timeSlipBoard(hr);
    expect(b.setting.approver).toBe('hr');
    expect(b.setting.history).toHaveLength(1);
    await svc.setTimeSlipApprover(hr, 'head', 'Back to the default');
    expect((await svc.myTimeSlips(ae)).approver?.label).toBe('Company head');
  });

  it('counts time after 5.30 pm as worked back and takes what is left from annual leave in half days after 30 days', async () => {
    const { svc, ds, at } = setup();
    const ex = await svc.user('u-it-ex3');
    const mgr = await svc.user('u-it-mgr');
    const hr = await svc.user('u-pwvsb-hr');
    const a = await svc.requestTimeSlip(ex, ask); // 2 hours
    const b = await svc.requestTimeSlip(ex, { ...ask, date: addDays(TODAY, 2), from: '09:00', to: '12:00', reason: 'Car service' }); // 3 hours
    await svc.decideTimeSlip(mgr, a.id, true, 'ok');
    await svc.decideTimeSlip(mgr, b.id, true, 'ok');
    // 1 h 30 after hours on day 1, and an auto-closed day that must not count.
    ds.staffClocks.push(clock('u-it-ex3', addDays(TODAY, 1), '08:30', '19:00'));
    ds.staffClocks.push(clock('u-it-ex3', addDays(TODAY, 3), '08:30', '23:59', ['NO_SIGN_OUT']));
    // 2 h after hours on day 4.
    ds.staffClocks.push(clock('u-it-ex3', addDays(TODAY, 4), '08:30', '19:30'));
    at.now = myt(addDays(TODAY, 5), '09:00');
    const mid = await svc.myTimeSlips(ex);
    const va = mid.mine.find((m) => m.slip.id === a.id)!.makeUp!;
    const vb = mid.mine.find((m) => m.slip.id === b.id)!.makeUp!;
    // Slip a (earliest last day) takes 1 h 30 from day 1 and 30 min from day 4; slip b gets the remaining 1 h 30.
    expect([va.madeUpMin, va.leftMin]).toEqual([120, 0]);
    expect([vb.madeUpMin, vb.leftMin]).toEqual([90, 90]);
    expect(vb.leaveDaysIfNotDone).toBe(0.5);
    // Before the period ends nothing is taken; the board totals the minutes still owed (90), not the slip count.
    const open = await svc.timeSlipBoard(hr);
    expect(open.settled).toBe(0);
    expect([open.counts.owing, open.counts.owingMin]).toEqual([1, 90]);
    const before = (await svc.guardProfile(hr, ex.personId!)).leave.balances.annual.taken;
    // After the 30 days for both, HR opening the board closes them.
    at.now = myt(addDays(TODAY, 33), '09:00');
    const board = await svc.timeSlipBoard(hr);
    expect(board.settled).toBe(2);
    const sa = board.rows.find((r) => r.slip.id === a.id)!.slip.settlement!;
    const sb = board.rows.find((r) => r.slip.id === b.id)!.slip.settlement!;
    expect([sa.shortfallMin, sa.annualDays, sa.leaveIds]).toEqual([0, 0, []]);
    expect([sb.shortfallMin, sb.annualDays, sb.unpaidDays]).toEqual([90, 0.5, 0]);
    const leave = ds.leaveRequests.find((l) => l.timeSlipId === b.id)!;
    expect([leave.kind, leave.days, leave.status]).toEqual(['ANNUAL', 0.5, 'approved']);
    expect((await svc.guardProfile(hr, ex.personId!)).leave.balances.annual.taken).toBe(before + 0.5);
    // HR is told again, and the board does not settle twice.
    expect(board.rows.find((r) => r.slip.id === b.id)!.unseen).toBe(true);
    expect((await svc.timeSlipBoard(hr)).settled).toBe(0);
    expect(ds.leaveRequests.filter((l) => l.timeSlipId === b.id)).toHaveLength(1);
  });

  it('lets the staff member cancel a waiting slip, and keeps others from seeing slips outside their line', async () => {
    const { svc } = setup();
    const ex = await svc.user('u-it-ex3');
    const s = await svc.requestTimeSlip(ex, ask);
    await expect(svc.cancelTimeSlip(await svc.user('u-it-ex1'), s.id)).rejects.toThrow(/not found|Time slip/i);
    await svc.cancelTimeSlip(ex, s.id);
    expect((await svc.myTimeSlips(ex)).mine[0].slip.status).toBe('cancelled');
    // A company manager sees only their own company's staff slips.
    const ae = await svc.user('u-ae-arsh');
    await svc.requestTimeSlip(ae, ask);
    expect((await svc.timeSlipBoard(await svc.user('u-cm-sasa'))).rows).toHaveLength(0);
    expect((await svc.timeSlipBoard(await svc.user('u-cm-arsh'))).rows.map((r) => r.slip.userId)).toEqual(['u-ae-arsh']);
  });

  it('never credits an open clock, even one left open from an earlier day (Arisha review 4 Nov)', async () => {
    const { svc, ds, at } = setup();
    const ex = await svc.user('u-it-ex3');
    const s = await svc.requestTimeSlip(ex, ask);
    await svc.decideTimeSlip(await svc.user('u-it-mgr'), s.id, true, 'ok');
    // Signed in on day 1 and never signed out: still open a month later.
    const open = clock('u-it-ex3', addDays(TODAY, 1), '08:30', '08:30');
    ds.staffClocks.push({ ...open, out: null });
    at.now = myt(addDays(TODAY, 31), '09:00');
    const mine = (await svc.myTimeSlips(ex)).mine.find((m) => m.slip.id === s.id)!.makeUp!;
    expect([mine.madeUpMin, mine.leftMin]).toEqual([0, 120]);
    const board = await svc.timeSlipBoard(await svc.user('u-pwvsb-hr'));
    const st = board.rows.find((r) => r.slip.id === s.id)!.slip.settlement!;
    expect([st.madeUpMin, st.shortfallMin, st.annualDays]).toEqual([0, 120, 0.5]);
  });

  it('settles once when two HR boards open at the same moment (Arisha review 4 Nov)', async () => {
    const { svc, ds, at } = setup();
    const ex = await svc.user('u-it-ex3');
    const s = await svc.requestTimeSlip(ex, ask);
    await svc.decideTimeSlip(await svc.user('u-it-mgr'), s.id, true, 'ok');
    at.now = myt(addDays(TODAY, 31), '09:00');
    const hr = await svc.user('u-pwvsb-hr');
    const cos = (await new MemoryStore(ds).list('users', {})).find((u) => u.leadership === 'cos')!;
    const [a, b] = await Promise.all([svc.timeSlipBoard(hr), svc.timeSlipBoard(cos)]);
    expect(a.settled + b.settled).toBe(1);
    expect(ds.leaveRequests.filter((l) => l.timeSlipId === s.id)).toHaveLength(1);
    // A second service on the same store (another request) also waits its turn.
    const other = new PrimaService(new MemoryStore(ds), () => at.now);
    expect((await other.timeSlipBoard(hr)).settled).toBe(0);
  });

  it('keeps an older slip still owing hours in the totals and the list behind 200 newer cancelled slips (Arisha review 4 Nov)', async () => {
    const { svc, ds, at } = setup();
    const ex = await svc.user('u-it-ex3');
    const hr = await svc.user('u-pwvsb-hr');
    const s = await svc.requestTimeSlip(ex, ask);
    await svc.decideTimeSlip(await svc.user('u-it-mgr'), s.id, true, 'ok');
    await svc.seenTimeSlip(hr, s.id);
    const base = ds.timeSlips.find((x) => x.id === s.id)!;
    for (let i = 0; i < 200; i++) {
      ds.timeSlips.push({
        ...base,
        id: `ts-test-cancelled-${i}`,
        date: addDays(TODAY, 1 + (i % 20)),
        status: 'cancelled',
        // All asked after the owing slip (10:30), so they are the newest 200.
        requestedAt: myt(TODAY, `11:${String(i % 60).padStart(2, '0')}`),
        hrNotice: null,
        settlement: null,
      } as TimeSlip);
    }
    at.now = myt(addDays(TODAY, 1), '09:00');
    const board = await svc.timeSlipBoard(hr);
    expect(board.total).toBe(201);
    expect(board.rows.length).toBeLessThanOrEqual(200);
    expect(board.rows.some((r) => r.slip.id === s.id)).toBe(true);
    expect([board.counts.owing, board.counts.owingMin]).toEqual([1, 120]);
  });

  it('helpers: half days rounded up and auto-closed clocks not counted', () => {
    expect(shortfallLeaveDays(0)).toBe(0);
    expect(shortfallLeaveDays(1)).toBe(0.5);
    expect(shortfallLeaveDays(240)).toBe(0.5);
    expect(shortfallLeaveDays(241)).toBe(1);
    const slip = { id: 's1', status: 'approved', date: TODAY, makeUpBy: addDays(TODAY, 30), minutes: 60, requestedAt: NOW } as TimeSlip;
    const flagged = [clock('u', TODAY, '08:30', '20:00', ['LEFT_BEFORE_SIGN_OUT'])];
    expect(allocateMakeUp([slip], flagged, myt(addDays(TODAY, 1), '09:00')).get('s1')).toEqual({ madeUpMin: 0, leftMin: 60, ended: false });
    // Time before the slip date does not count.
    const early = [clock('u', addDays(TODAY, -1), '08:30', '20:00')];
    expect(allocateMakeUp([slip], early, myt(addDays(TODAY, 1), '09:00')).get('s1')!.madeUpMin).toBe(0);
  });
});
