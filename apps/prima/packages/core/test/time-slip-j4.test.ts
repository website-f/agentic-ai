import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, addDays, generateDataset, myt, type LeaveRequest, type StaffClock } from '../src';

// P100 J4 (Fauzan, 11 Nov 2026): time slip follow-ups. The staff clock stops flagging slip time as a long break, and the
// staff payroll reads the unpaid leave Prima takes for slip hours not worked back. Synthetic mock data only.
const TODAY = '2026-10-26'; // a Monday
const NOW = myt(TODAY, '18:00');

function clock(userId: string, day: string, from: string, to: string): StaffClock {
  const shot = (t: string) => ({ image: '', sha256: '', capturedAt: myt(day, t), receivedAt: myt(day, t), lat: null, lng: null, accuracyM: null, distanceM: null, face: null, source: 'login' as const });
  return { id: `sc-j4-${userId}-${day}-${from}`, userId, userName: userId, companyId: null, in: shot(from), out: shot(to), flags: [], lastPingAt: null, pings: 0, mode: 'login' };
}

describe('P100 J4: time slip follow-ups', () => {
  it('time away on an approved slip is not a long break; the same gap without a slip still is', async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:30') });
    let now = myt(TODAY, '10:30');
    const svc = new PrimaService(new MemoryStore(ds), () => now);
    const ex = await svc.user('u-it-ex3');
    const s = await svc.requestTimeSlip(ex, { date: TODAY, from: '14:00', to: '16:00', reason: 'Bank appointment (test)' });
    await svc.decideTimeSlip(await svc.user('u-it-mgr'), s.id, true, 'Fine (test)');
    now = NOW;
    ds.staffClocks = ds.staffClocks.filter((c) => !['u-it-ex3', 'u-it-ex2'].includes(c.userId) || !c.in.receivedAt.startsWith(TODAY));
    ds.staffClocks.push(clock('u-it-ex3', TODAY, '08:30', '14:00'), clock('u-it-ex3', TODAY, '16:00', '17:45'));
    ds.staffClocks.push(clock('u-it-ex2', TODAY, '08:30', '14:00'), clock('u-it-ex2', TODAY, '16:00', '17:45'));
    const board = await svc.staffClockBoard(await svc.user('u-pwvsb-hr'), TODAY);
    const withSlip = board.rows.find((r) => r.userId === 'u-it-ex3')!.hours!;
    const without = board.rows.find((r) => r.userId === 'u-it-ex2')!.hours!;
    expect(withSlip.longBreak).toBe(false);
    expect(withSlip.slipMin).toBe(120);
    expect(without.longBreak).toBe(true);
    expect(without.slipMin).toBe(0);
  });

  it('staff payroll settles slips past their make-up date first and names the unpaid leave they took', async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:30') });
    const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:30'));
    const hr = await svc.user('u-pwvsb-hr');
    const ex = await svc.user('u-it-ex3');
    const person = ds.people.find((p) => p.id === ex.personId)!;
    // A slip approved in September, never worked back; its make-up date is past.
    ds.timeSlips.push({ ...(ds.timeSlips[0] ?? {}), id: 'ts-j4', companyId: null, userId: ex.id, userName: ex.name, personId: person.id, date: '2026-09-20', from: '14:00', to: '16:00', minutes: 120, reason: 'Clinic (test)', status: 'approved', decidedBy: 'IT Manager (mock)', makeUpBy: addDays('2026-09-20', 30), settlement: null } as never);
    ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.companyId !== person.companyId);
    // And an unpaid day Prima already took this month for another slip.
    ds.leaveRequests.push({ id: 'lv-ts-j4-old-unpaid', companyId: person.companyId, personId: person.id, kind: 'UNPAID', from: '2026-10-05', to: '2026-10-05', days: 0.5, reason: 'Time slip (test)', proofIds: [], requestedAt: myt('2026-10-05', '09:00'), requestedBy: 'Prima (time slip)', via: 'company', status: 'approved', decidedBy: 'Prima (time slip rule)', decidedAt: myt('2026-10-05', '09:00'), decisionNote: 'test', timeSlipId: 'ts-j4-old' } as LeaveRequest);
    const run = await svc.prepareStaffPay(hr, person.companyId, '2026-10');
    expect(ds.timeSlips.find((s) => s.id === 'ts-j4')!.settlement).not.toBeNull();
    const line = run.lines.find((l) => l.personId === person.id)!;
    expect(line.unpaidDays).toBeGreaterThanOrEqual(0.5);
    expect(line.flags.join(' ')).toMatch(/time slip hours not worked back \(.*ts-j4-old/);
  });
});
