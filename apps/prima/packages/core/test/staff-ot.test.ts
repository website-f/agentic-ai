import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, cmsOvertimeHours, generateDataset, myt } from '../src';

// P100 C12 + J3 (Fauzan, 11 Nov 2026): staff and CMS overtime inside the staff payroll, HR's on/off switch, approved
// overtime paid once, unapproved never. Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW, daysBack: 40 });
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const hr = await svc.user('u-pwvsb-hr');
  // A CMS control-room officer: the CMS staff record linked to an office sign-in with a staff record.
  const cmsUser = ds.users.find((u) => ds.cmsStaff.some((c) => c.userId === u.id) && u.personId && ds.people.find((p) => p.id === u.personId)?.role === 'office')!;
  const person = ds.people.find((p) => p.id === cmsUser.personId)!;
  person.basicPay = 2080; // hourly 2080 / 26 / 8 = RM10
  const cs = ds.cmsStaff.find((c) => c.userId === cmsUser.id)!;
  // One October day seat for this officer, clocked in and out (12 hours).
  const seat = ds.cmsShifts.find((s) => !s.cancelled && s.post === 'HEAD_CONTROL')!;
  const day = '2026-10-20';
  Object.assign(seat, { date: day, start: myt(day, '07:00'), end: myt(day, '19:00'), staffId: cs.id, staffName: cs.name, clockIn: myt(day, '07:00'), clockOut: myt(day, '19:00') });
  // Start the employer's October and November payroll afresh.
  ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.companyId !== person.companyId);
  return { ds, svc, hr, cmsUser, person, seat };
}

describe('P100 C12 + J3: overtime in the staff payroll', () => {
  it('counts hours past the 8-hour day on a completed CMS seat', () => {
    expect(cmsOvertimeHours({ start: myt('2026-10-01', '07:00'), end: myt('2026-10-01', '19:00'), clockIn: myt('2026-10-01', '06:50'), clockOut: myt('2026-10-01', '19:10') }, 8)).toBe(4);
    expect(cmsOvertimeHours({ start: myt('2026-10-01', '07:00'), end: myt('2026-10-01', '19:00'), clockIn: myt('2026-10-01', '07:00'), clockOut: null }, 8)).toBe(0);
  });

  it('switch off: nothing comes in; HR turns it on and names the officer; CMS overtime is approved with a reason and paid once', async () => {
    const x = await setup();
    await expect(x.svc.payAction(x.hr, 'ot-cms-import', { period: '2026-10' })).rejects.toThrow(/switched off/);
    await x.svc.setStaffOvertime(x.hr, { enabled: true, normal: 1.5, restDay: 2, publicHoliday: 3, personIds: [x.person.id], comment: 'CMS overtime into payroll (test)' });
    // Only HR brings it in and decides.
    await expect(x.svc.payAction(await x.svc.user('u-cms-head'), 'ot-cms-import', { period: '2026-10' })).rejects.toBeInstanceOf(AccessDenied);
    const made = (await x.svc.payAction(x.hr, 'ot-cms-import', { period: '2026-10' })) as { made: number };
    expect(made.made).toBeGreaterThan(0);
    // Bringing it in twice makes nothing new (one line per seat).
    expect(((await x.svc.payAction(x.hr, 'ot-cms-import', { period: '2026-10' })) as { made: number }).made).toBe(0);
    const board = (await x.svc.payView(x.hr, 'staff-ot', {})) as { lines: { id: string; status: string; personId: string; hours: number }[] };
    const line = board.lines.find((l) => l.id === `ot-cms-${x.seat.id}`)!;
    expect(line.hours).toBe(4);
    // Unapproved: the payroll does not pay it.
    const run0 = await x.svc.prepareStaffPay(x.hr, x.person.companyId, '2026-10');
    expect(run0.lines.find((l) => l.personId === x.person.id)?.overtime ?? null).toBeNull();
    // HR brought it in, so another HR keeper (the HR Director) approves it: nobody approves their own work.
    await expect(x.svc.payAction(x.hr, 'ot-decide', { id: line.id, decision: 'approve', note: 'Mine (test)' })).rejects.toThrow(/Someone else in HR/);
    const hrDirector = await x.svc.user('u-cos');
    await expect(x.svc.payAction(hrDirector, 'ot-decide', { id: line.id, decision: 'approve', note: '' })).rejects.toThrow(/comment/);
    await x.svc.payAction(hrDirector, 'ot-decide', { id: line.id, decision: 'approve', note: 'Matches the CMS roster (test)' });
    const run = await x.svc.prepareStaffPay(x.hr, x.person.companyId, '2026-10');
    const pay = run.lines.find((l) => l.personId === x.person.id)!;
    expect(pay.overtime?.ids).toContain(line.id);
    expect(pay.overtime?.hourly).toBe(10);
    const ot = pay.allowanceLines.find((a) => a.overtime)!;
    expect(ot.epf).toBe(false);
    // Appears once: next month's run does not pay it again.
    const nov = await x.svc.prepareStaffPay(x.hr, x.person.companyId, '2026-11');
    expect(nov.lines.find((l) => l.personId === x.person.id)?.overtime?.ids ?? []).not.toContain(line.id);
    // Switch off again: approved hours wait, flagged, never paid silently.
    await x.svc.setStaffOvertime(x.hr, { enabled: false, normal: 1.5, restDay: 2, publicHoliday: 3, personIds: [x.person.id], comment: 'Off for now (test)' });
    const off = await x.svc.prepareStaffPay(x.hr, x.person.companyId, '2026-11');
    expect(off.lines.find((l) => l.personId === x.person.id)?.overtime ?? null).toBeNull();
  });

  it('a staff member claims their own; HR decides; nobody decides their own; a refused line is never paid', async () => {
    const x = await setup();
    await x.svc.setStaffOvertime(x.hr, { enabled: true, normal: 1.5, restDay: 2, publicHoliday: 3, personIds: [x.person.id], comment: 'On (test)' });
    const me = x.cmsUser;
    await expect(x.svc.payAction(me, 'ot-claim', { date: '2026-10-20', hours: 2, kind: 'normal', reason: 'no' })).rejects.toThrow(/what the overtime was for/);
    const claim = (await x.svc.payAction(me, 'ot-claim', { date: '2026-10-20', hours: 2, kind: 'normal', reason: 'Stayed for a CCTV fault (test)' })) as { id: string };
    // The claimant cannot decide it (not HR); a guard cannot claim.
    await expect(x.svc.payAction(me, 'ot-decide', { id: claim.id, decision: 'approve', note: 'Mine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(x.svc.payAction(await x.svc.user('u-guard-sasa-1'), 'ot-claim', { date: '2026-10-20', hours: 2, kind: 'normal', reason: 'Guard (test)' })).rejects.toBeInstanceOf(AccessDenied);
    await x.svc.payAction(x.hr, 'ot-decide', { id: claim.id, decision: 'refuse', note: 'Not agreed beforehand (test)' });
    const run = await x.svc.prepareStaffPay(x.hr, x.person.companyId, '2026-10');
    expect(run.lines.find((l) => l.personId === x.person.id)?.overtime?.ids ?? []).not.toContain(claim.id);
    const mine = (await x.svc.payView(me, 'staff-ot', {})) as { mine: { id: string; status: string }[] };
    expect(mine.mine.find((l) => l.id === claim.id)?.status).toBe('refused');
  });
});
