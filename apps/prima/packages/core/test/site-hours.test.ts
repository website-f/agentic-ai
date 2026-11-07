import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, attendanceHours, generateDataset, myt, siteAllowedHours, siteHoursCheck, type User } from '../src';

// Site man-hours (Fauzan, 6 Nov 2026). Synthetic data only.
const TODAY = '2026-11-06';
const NOW = myt(TODAY, '10:00');
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};
const user = (ds: ReturnType<typeof generateDataset>, id: string) => ds.users.find((u) => u.id === id) as User;
const post = (shiftStructure: 'A' | 'B' | 'C' | 'D' | 'E', guardsPerShift: number) => ({ id: `p-${shiftStructure}`, name: 'Post', shiftStructure, guardsPerShift });

describe('site man-hours (rule SITE-HOURS)', () => {
  it("Fauzan's example: 2 guards per 12-hour shift, 30-day month = 4 people, 1,440 hours", () => {
    const a = siteAllowedHours([post('A', 2)], '2026-11');
    expect(a.days).toBe(30);
    expect(a.people).toBe(4);
    expect(a.allowedHours).toBe(1440);
    // A 31-day month allows 1,488; posts add up; office hours count 9 h a day.
    expect(siteAllowedHours([post('A', 2)], '2026-12').allowedHours).toBe(1488);
    expect(siteAllowedHours([post('A', 2), post('E', 1)], '2026-11')).toMatchObject({ people: 5, allowedHours: 1440 + 270 });
    expect(siteAllowedHours([post('B', 1)], '2026-11')).toMatchObject({ people: 3, allowedHours: 720 });
  });

  it('flags hours over the total; an OD/OGM approval raises the ceiling', () => {
    const base = { allowedHours: 1440, hoursPerDay: 48, month: '2026-10', now: myt('2026-11-06', '10:00'), rosteredHours: 1440, approvals: [] as { extraHours: number }[] };
    expect(siteHoursCheck({ ...base, workedHours: 1440 }).status).toBe('within');
    const over = siteHoursCheck({ ...base, workedHours: 1476 });
    expect(over).toMatchObject({ status: 'over', overBy: 36, needsApproval: 36 });
    const ok = siteHoursCheck({ ...base, workedHours: 1476, approvals: [{ extraHours: 24 }, { extraHours: 12 }] });
    expect(ok).toMatchObject({ status: 'approved', ceiling: 1476, overBy: 0 });
    // The roster going over is flagged before the hours are worked.
    expect(siteHoursCheck({ ...base, workedHours: 600, rosteredHours: 1500 })).toMatchObject({ status: 'roster_over', rosterOverBy: 60 });
  });

  it('a month still running is checked against the hours allowed so far', () => {
    // 5 Nov 2026 at 00:00 Malaysia time: 4 full days so far, 48 h a day = 192 h allowed so far.
    const base = { allowedHours: 1440, hoursPerDay: 48, month: '2026-11', now: myt('2026-11-05', '00:00'), rosteredHours: 1000, approvals: [] as { extraHours: number }[] };
    expect(siteHoursCheck({ ...base, workedHours: 190 })).toMatchObject({ status: 'within', allowedSoFar: 192 });
    expect(siteHoursCheck({ ...base, workedHours: 216 })).toMatchObject({ status: 'pace', paceOverBy: 24, needsApproval: 24 });
    expect(siteHoursCheck({ ...base, workedHours: 216, approvals: [{ extraHours: 24 }] }).status).toBe('approved');
  });

  it('counts clocked time inside the shift; unrostered time counts in full', () => {
    const shift = { start: myt(TODAY, '07:00'), end: myt(TODAY, '19:00') };
    expect(attendanceHours({ clockIn: myt(TODAY, '06:40'), clockOut: myt(TODAY, '19:10') }, shift, NOW)).toBe(12);
    expect(attendanceHours({ clockIn: myt(TODAY, '07:30'), clockOut: myt(TODAY, '18:00') }, shift, NOW)).toBe(10.5);
    expect(attendanceHours({ clockIn: myt(TODAY, '07:00'), clockOut: null }, shift, NOW)).toBe(3);
    expect(attendanceHours({ clockIn: myt(TODAY, '06:00'), clockOut: myt(TODAY, '19:00') }, null, NOW)).toBe(13);
  });

  it('the board flags the demo site with on-the-job training hours; the approved one is not flagged', async () => {
    const { ds, svc } = fresh();
    const board = await svc.siteHoursBoard(user(ds, 'u-opsdir'), { companyId: 'co-sasa' });
    expect(board.month).toBe('2026-11');
    const ojt = ds.attendance.filter((a) => a.id.startsWith('at-ojt-a-'));
    expect(ojt.length).toBeGreaterThan(0);
    const flagged = board.rows.find((r) => r.siteId === ojt[0].siteId)!;
    expect(flagged.notRosteredHours).toBe(ojt.length * 12);
    expect(flagged.check.status).toBe('pace');
    expect(flagged.canApprove).toBe(true);
    const approvedSite = board.rows.find((r) => r.approvals.length)!;
    expect(['approved', 'within']).toContain(approvedSite.check.status);
    expect(board.totals.allowedHours).toBeGreaterThan(0);
  });

  it('only the OD approves a private site, only the OGM a government site, always with a reason', async () => {
    const { ds, svc } = fresh();
    const site = ds.sites.find((s) => s.companyId === 'co-sasa' && s.sector !== 'government')!;
    const input = { siteId: site.id, month: '2026-11', extraHours: 36, cause: 'annual_leave' as const, reason: 'Relief for two guards on annual leave' };
    await expect(svc.approveSiteHours(user(ds, 'u-ogm'), input)).rejects.toThrow(/Operations Director/);
    await expect(svc.approveSiteHours(user(ds, 'u-coo'), input)).rejects.toThrow(/Not allowed/);
    await expect(svc.approveSiteHours(user(ds, 'u-opsdir'), { ...input, reason: '' })).rejects.toThrow(/reason/);
    await expect(svc.approveSiteHours(user(ds, 'u-opsdir'), { ...input, extraHours: 0 })).rejects.toThrow(/extra hours/);
    await expect(svc.approveSiteHours(user(ds, 'u-opsdir'), { ...input, month: '2027-03' })).rejects.toThrow(/month/);
    const row = await svc.approveSiteHours(user(ds, 'u-opsdir'), input);
    expect(row).toMatchObject({ approverTier: 'ops_director', extraHours: 36, cause: 'annual_leave' });
    expect(ds.audit.some((a) => a.action === 'ops.site_hours.approve' && a.entityId === row.id)).toBe(true);
    const again = await svc.approveSiteHours(user(ds, 'u-opsdir'), { ...input, extraHours: 12 });
    expect(again.id).not.toBe(row.id);
    const board = await svc.siteHoursBoard(user(ds, 'u-opsdir'), { companyId: 'co-sasa' });
    expect(board.rows.find((r) => r.siteId === site.id)!.check.approvedExtra).toBe(48);

    const gov = ds.sites.find((s) => s.sector === 'government');
    if (gov) {
      const g = { ...input, siteId: gov.id };
      await expect(svc.approveSiteHours(user(ds, 'u-opsdir'), g)).rejects.toThrow(/OGM/);
      await expect(svc.approveSiteHours(user(ds, 'u-ogm'), g)).resolves.toMatchObject({ approverTier: 'ogm' });
    }
  });

  it('guards and site devices do not see the board; HR and ACT can, without approving', async () => {
    const { ds, svc } = fresh();
    const guard = ds.users.find((u) => u.role === 'guard');
    if (guard) await expect(svc.siteHoursBoard(guard)).rejects.toThrow(/Not allowed/);
    const device = ds.users.find((u) => u.role === 'site_device');
    if (device) await expect(svc.siteHoursBoard(device)).rejects.toThrow(/Not allowed/);
    for (const id of ['u-audit', 'u-coo']) {
      const u = ds.users.find((x) => x.id === id);
      if (!u) continue;
      const b = await svc.siteHoursBoard(u, { companyId: 'co-sasa' });
      expect(b.rows.every((r) => !r.canApprove)).toBe(true);
    }
    const hr = ds.users.find((u) => u.role === 'pwvsb_officer' && u.department === 'hr');
    if (hr) await expect(svc.siteHoursBoard(hr, { companyId: 'co-sasa' })).resolves.toBeTruthy();
  });
});
