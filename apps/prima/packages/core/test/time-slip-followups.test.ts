import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, addDays, generateDataset, myt, type StaffClock } from '../src';

// A10 (Fitri package, Fauzan 11 Nov 2026): time slip follow-ups. Synthetic mock data only.
const TODAY = '2026-10-26'; // a Monday
const shot = (day: string, t: string) => ({ image: '', sha256: '', capturedAt: myt(day, t), receivedAt: myt(day, t), lat: null, lng: null, accuracyM: null, distanceM: null, face: null, source: 'login' as const });
const clock = (userId: string, day: string, from: string, to: string): StaffClock => ({ id: `sc-a10-${userId}-${day}-${from}`, userId, userName: userId, companyId: null, in: shot(day, from), out: shot(day, to), flags: [], lastPingAt: null, pings: 0, mode: 'login' });

describe('A10: time slip follow-ups', () => {
  it('does not show approved slip time as a long break on the staff clock board', async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:30') });
    const at = { now: myt(TODAY, '10:30') };
    const svc = new PrimaService(new MemoryStore(ds), () => at.now);
    const ex = await svc.user('u-it-ex3');
    const s = await svc.requestTimeSlip(ex, { date: TODAY, from: '14:00', to: '16:00', reason: 'Bank appointment' });
    await svc.decideTimeSlip(await svc.user('u-it-mgr'), s.id, true, 'ok');
    ds.staffClocks = ds.staffClocks.filter((c) => !(c.userId === 'u-it-ex3' && c.in.receivedAt.startsWith(TODAY)));
    ds.staffClocks.push(clock('u-it-ex3', TODAY, '08:30', '13:55'), clock('u-it-ex3', TODAY, '16:05', '17:30'));
    at.now = myt(TODAY, '18:00');
    const board = await svc.staffClockBoard(await svc.user('u-fauzan'), TODAY);
    const row = board.rows.find((r) => r.userId === 'u-it-ex3')!;
    expect(row.hours!.breakMin).toBe(130);
    expect(row.hours!.slipMin).toBe(120);
    expect(row.hours!.longBreak).toBe(false);
  });

  it('settles due slips when HR prepares the staff pay run, so the leave taken is in the run', async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:30') });
    const at = { now: myt(TODAY, '10:30') };
    const svc = new PrimaService(new MemoryStore(ds), () => at.now);
    const ex = await svc.user('u-it-ex3');
    const s = await svc.requestTimeSlip(ex, { date: TODAY, from: '09:00', to: '12:00', reason: 'Car service' });
    await svc.decideTimeSlip(await svc.user('u-it-mgr'), s.id, true, 'ok');
    at.now = myt(addDays(TODAY, 33), '09:00');
    const hr = await svc.user('u-pwvsb-hr');
    const person = ds.people.find((p) => p.id === ex.personId)!;
    ds.staffPayRuns = ds.staffPayRuns.filter((r) => !(r.companyId === person.companyId && r.period === '2026-11'));
    const run = await svc.prepareStaffPay(hr, person.companyId, '2026-11');
    expect(run.lines.some((l) => l.personId === person.id)).toBe(true);
    expect(ds.timeSlips.find((x) => x.id === s.id)!.settlement).not.toBeNull();
    expect(ds.leaveRequests.some((l) => l.timeSlipId === s.id)).toBe(true);
  });
});
