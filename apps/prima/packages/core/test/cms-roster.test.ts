// CMS duty roster and shift handover in real use (Fauzan, 25 Oct and 5 Nov 2026). Mock data only, in memory.
// Seats go by the person's own Prima account; the handover has two steps (outgoing writes, incoming takes); rest,
// rest-day and leave checks on rostering; clock-out is the hours record; the CMS desk's handover lands on the same seat.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, generateDataset, myt, type Dataset, type User } from '../src';

const TODAY = '2026-10-26';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:30') });
  let now = myt(TODAY, '10:30');
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  const at = (hhmm: string, date = TODAY) => (now = myt(date, hhmm));
  return { ds, svc, at };
}

const seat = (ds: Dataset, date: string, hhmm: string, post: 'hc' | 'mo' = 'hc') => ds.cmsShifts.find((s) => s.id === `cms-${date}-${hhmm}-12h-${post}-1`)!;

/** Today's day shift is Hafiz's (on the desk, no handover written yet); tonight's is Siti's (not clocked in). */
function twoShifts(ds: Dataset) {
  const day = seat(ds, TODAY, '0700');
  Object.assign(day, { staffName: 'Hafiz bin Rahman', staffId: 'cms-st-01', clockIn: myt(TODAY, '06:55'), clockOut: null, handoverOut: null });
  const night = seat(ds, TODAY, '1900');
  Object.assign(night, { staffName: 'Siti Aishah binti Omar', staffId: 'cms-st-02', clockIn: null, handoverAt: null, handoverNote: null });
  return { day, night };
}

describe('CMS shift handover: two people, two steps', () => {
  it('the outgoing Head Control writes it in the last hour, the incoming one takes it, then the outgoing one may clock out', async () => {
    const { ds, svc, at } = fresh();
    const { day, night } = twoShifts(ds);
    const hafiz = await svc.user('u-cms-head');
    const siti = await svc.user('u-cms-head-b');
    await expect(svc.giveCmsHandover(hafiz, day.id, 'nothing open')).rejects.toThrow(/last hour/);
    await expect(svc.giveCmsHandover(siti, day.id, 'nothing open')).rejects.toThrow(/not your seat/);
    at('18:15');
    const written = await svc.giveCmsHandover(hafiz, day.id, 'Arms out at two posts, one call to return');
    expect(written.handoverOut!.by).toBe('Hafiz bin Rahman');
    expect(Array.isArray(written.handoverOut!.openItems)).toBe(true);
    expect(JSON.stringify(written.handoverOut)).not.toMatch(/clip|https?:/);
    await expect(svc.giveCmsHandover(hafiz, day.id, 'again')).rejects.toThrow(/already written/);
    // Head Control may not leave the desk before the next one takes over.
    at('18:20');
    await expect(svc.cmsSeatClockOut(hafiz, day.id, 'going home')).rejects.toThrow(/Stay on the desk/);
    at('18:35');
    await expect(svc.recordCmsHandover(siti, night.id, 'checked')).rejects.toThrow(/Clock in first/);
    await svc.cmsSeatClockIn(siti, night.id);
    await expect(svc.recordCmsHandover(hafiz, night.id, 'checked the board')).rejects.toThrow(/not your seat/);
    const taken = await svc.recordCmsHandover(siti, night.id, 'Board checked, arms out confirmed');
    expect(taken.handoverFrom).toEqual({ by: 'Hafiz bin Rahman', at: myt(TODAY, '18:15') });
    expect(taken.handoverVia).toBe('prima');
    at('19:05');
    const out = await svc.cmsSeatClockOut(hafiz, day.id);
    expect(out.clockOut).toBe(myt(TODAY, '19:05'));
    // The hours record: Arms Control sees it; it counts from clock-in to clock-out.
    const board = await svc.cms(await svc.user('u-pwvsb-arms'));
    const row = board.hours!.find((h) => h.name === 'Hafiz bin Rahman')!;
    expect(row.worked).toBeGreaterThanOrEqual(1);
    expect(row.hours).toBeGreaterThanOrEqual(12);
    expect((await svc.cms(siti)).hours).toBeNull();
    expect(ds.audit.some((a) => a.action === 'arms.cms_handover_out')).toBe(true);
    expect(ds.audit.some((a) => a.action === 'cms.clock_out')).toBe(true);
  });

  it('an incoming Head Control who does not agree still takes over, and the board raises it for Arms Control', async () => {
    const { ds, svc, at } = fresh();
    const { day, night } = twoShifts(ds);
    at('18:30');
    await svc.giveCmsHandover(await svc.user('u-cms-head'), day.id, 'nothing open');
    at('18:50');
    const siti = await svc.user('u-cms-head-b');
    await svc.cmsSeatClockIn(siti, night.id);
    await expect(svc.recordCmsHandover(siti, night.id, 'no', false)).rejects.toThrow(/do not agree/);
    await svc.recordCmsHandover(siti, night.id, 'Vault camera offline was not listed', false);
    at('19:10');
    const b = await svc.cms(await svc.user('u-pwvsb-arms'));
    expect(b.current!.handover!.disputed).toMatch(/Vault camera/);
    expect(b.alerts.some((a) => a.title.includes('did not agree'))).toBe(true);
  });

  it('with nobody on the desk before, the handover is taken without one; nobody hands over to themselves', async () => {
    const { ds, svc, at } = fresh();
    const { day, night } = twoShifts(ds);
    Object.assign(day, { clockIn: null });
    at('18:45');
    const siti = await svc.user('u-cms-head-b');
    await svc.cmsSeatClockIn(siti, night.id);
    const t = await svc.recordCmsHandover(siti, night.id, 'Day Head Control did not come; board checked');
    expect(t.handoverFrom).toBeNull();
    // Same person on both seats (only possible if rostered by hand): refused.
    const { ds: ds2, svc: svc2, at: at2 } = fresh();
    const s2 = twoShifts(ds2);
    Object.assign(s2.night, { staffName: 'Hafiz bin Rahman', staffId: 'cms-st-01' });
    at2('18:45');
    const hafiz = await svc2.user('u-cms-head');
    await svc2.cmsSeatClockIn(hafiz, s2.night.id).catch(() => undefined);
    ds2.cmsShifts.find((x) => x.id === s2.night.id)!.clockIn = myt(TODAY, '18:45');
    await expect(svc2.recordCmsHandover(hafiz, s2.night.id, 'checked the board')).rejects.toThrow(/from yourself/);
  });

  it('Arms Control can clock a person out with a reason; leaving early needs a reason', async () => {
    const { ds, svc, at } = fresh();
    const { day } = twoShifts(ds);
    const arms = await svc.user('u-pwvsb-arms');
    at('12:00');
    await expect(svc.cmsSeatClockOut(arms, day.id)).rejects.toThrow(/Say why/);
    await expect(svc.cmsSeatClockOut(await svc.user('u-cms-head-b'), day.id, 'not mine')).rejects.toThrow(/not yours/);
    const out = await svc.cmsSeatClockOut(arms, day.id, 'Taken ill at the desk, sent to clinic');
    expect(out.clockOutBy).toBe(arms.name);
    const mo = seat(ds, TODAY, '0700', 'mo');
    expect(mo).toBeTruthy();
  });
});

describe('CMS roster in real use', () => {
  it('a seat is clocked in by its own account only: a staff member with no account linked cannot clock in', async () => {
    const { ds, svc, at } = fresh();
    ds.users.push({ id: 'u-cms-imposter', name: 'Siti Aishah binti Omar', role: 'pwvsb_officer', department: 'cms', companyIds: [], siteIds: [] } as unknown as User);
    const { night } = twoShifts(ds);
    ds.cmsStaff.find((s) => s.id === 'cms-st-02')!.userId = null;
    at('18:45');
    await expect(svc.cmsSeatClockIn(await svc.user('u-cms-head-b'), night.id)).rejects.toThrow(/not yours/);
    // Same name on another account does not count either.
    await expect(svc.cmsSeatClockIn(await svc.user('u-cms-imposter'), night.id)).rejects.toThrow(/not yours/);
  });

  it('the staff form links a CMS account once, and offers only command-centre accounts', async () => {
    const { svc } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const form = await svc.recordForm(arms, 'cmsStaff', null, null);
    expect(form.options.userId.map(([id]) => id).sort()).toEqual(['u-cms-head', 'u-cms-head-b']);
    await expect(svc.saveRecord(arms, 'cmsStaff', null, null, { name: 'New Officer (mock)', post: 'MONITOR_OFFICER', ext: '950', active: true, userId: 'u-cms-head' })).rejects.toThrow(/already linked/);
    await expect(svc.saveRecord(arms, 'cmsStaff', null, null, { name: 'New Officer (mock)', post: 'MONITOR_OFFICER', ext: '950', active: true, userId: 'u-coo' })).rejects.toThrow(/from the list/);
  });

  it('rostering refuses short rest, a 7th day in a row and approved leave', async () => {
    const { ds, svc } = fresh();
    ds.users.push({ id: 'u-cms-r', name: 'Sample Officer R (mock)', personId: 'p-cms-r', role: 'pwvsb_officer', department: 'cms', companyIds: [], siteIds: [] } as unknown as User);
    const arms = await svc.user('u-pwvsb-arms');
    const D = addDays(TODAY, 3);
    const add = (name: string, staffId: string, date: string, s: string, e: string, id: string) =>
      ds.cmsShifts.push({ id, date, start: myt(date, s), end: e < s ? myt(addDays(date, 1), e) : myt(date, e), post: 'MONITOR_OFFICER', seat: 9, staffName: name, staffId, clockIn: null });
    ds.cmsStaff.push(
      { id: 'cms-st-q', name: 'Sample Officer Q (mock)', posts: ['MONITOR_OFFICER'], ext: '961', active: true, userId: null },
      { id: 'cms-st-r', name: 'Sample Officer R (mock)', posts: ['MONITOR_OFFICER'], ext: '962', active: true, userId: 'u-cms-r' },
      { id: 'cms-st-s', name: 'Sample Officer S (mock)', posts: ['MONITOR_OFFICER'], ext: '963', active: true, userId: null },
    );
    const target = seat(ds, D, '0700', 'mo');
    target.staffName = null;
    // Q: six days in a row before D.
    for (let i = 1; i <= 6; i++) add('Sample Officer Q (mock)', 'cms-st-q', addDays(D, -i), '07:00', '19:00', `fake-q-${i}`);
    await expect(svc.assignCmsShift(arms, target.id, 'Sample Officer Q (mock)')).rejects.toThrow(/7 days in a row/);
    // S: a short extra stretch ending at 01:00 on D, six hours before the 07:00 seat.
    add('Sample Officer S (mock)', 'cms-st-s', addDays(D, -1), '21:00', '01:00', 'fake-s-1');
    await expect(svc.assignCmsShift(arms, target.id, 'Sample Officer S (mock)')).rejects.toThrow(/hours' rest/);
    // R: on approved leave that day.
    ds.leaveRequests.push({ id: 'lv-cms-r', companyId: 'co-pwvsb', personId: 'p-cms-r', kind: 'ANNUAL', from: D, to: D, days: 1, reason: 'Family (mock)', proofIds: [], requestedAt: myt(TODAY, '09:00'), requestedBy: 'Sample Officer R (mock)', via: 'company', status: 'approved', decidedBy: 'HR (mock)', decidedAt: myt(TODAY, '09:30'), decisionNote: null });
    await expect(svc.assignCmsShift(arms, target.id, 'Sample Officer R (mock)')).rejects.toThrow(/approved leave/);
    // Once S has had the rest, S is put on, by staff record.
    ds.cmsShifts.splice(ds.cmsShifts.findIndex((x) => x.id === 'fake-s-1'), 1);
    const put = await svc.assignCmsShift(arms, target.id, 'Sample Officer S (mock)');
    expect(put.staffId).toBe('cms-st-s');
  });

  it('Arms Control takes a person off a seat with the reason; the seat shows empty; not after clock-in, not by others', async () => {
    const { ds, svc } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const later = seat(ds, addDays(TODAY, 1), '0700', 'mo');
    expect(later.staffName).toBeTruthy();
    await expect(svc.releaseCmsSeat(await svc.user('u-cms-head'), later.id, 'sick')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.releaseCmsSeat(arms, later.id, '')).rejects.toThrow(/Say why/);
    const name = later.staffName;
    const r = await svc.releaseCmsSeat(arms, later.id, 'MC 2 days (mock)');
    expect(r.staffName).toBeNull();
    expect(r.released!.at(-1)).toMatchObject({ name, reason: 'MC 2 days (mock)' });
    const b = await svc.cms(arms);
    expect(b.alerts.some((a) => a.kind === 'Roster' && a.title.includes('Monitor Officer'))).toBe(true);
    const onNow = ds.cmsShifts.find((s) => s.clockIn && !s.clockOut && s.start <= myt(TODAY, '10:30') && s.end > myt(TODAY, '10:30'))!;
    await expect(svc.releaseCmsSeat(arms, onNow.id, 'sick')).rejects.toThrow(/clocked in/);
  });
});

describe('Rest hours: Arms Control sets them, HR views (Fauzan, 5 Nov 2026)', () => {
  it('Arms Control changes the rest between shifts and rostering follows it; HR sees the hours and the setting but cannot change them', async () => {
    const { ds, svc } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const hr = await svc.user('u-pwvsb-hr');
    const D = addDays(TODAY, 3);
    ds.cmsStaff.push({ id: 'cms-st-t', name: 'Sample Officer T (mock)', posts: ['MONITOR_OFFICER'], ext: '964', active: true, userId: null });
    // T ends a stretch at 21:00 the day before: 10 hours before the 07:00 seat.
    ds.cmsShifts.push({ id: 'fake-t-1', date: addDays(D, -1), start: myt(addDays(D, -1), '13:00'), end: myt(addDays(D, -1), '21:00'), post: 'MONITOR_OFFICER', seat: 9, staffName: 'Sample Officer T (mock)', staffId: 'cms-st-t', clockIn: null });
    const target = seat(ds, D, '0700', 'mo');
    target.staffName = null;
    await expect(svc.updateCmsSettings(hr, { minRestHours: 12 })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.updateCmsSettings(arms, { minRestHours: 0 })).rejects.toThrow(/from 1 to 24/);
    await svc.updateCmsSettings(arms, { minRestHours: 12 });
    await expect(svc.assignCmsShift(arms, target.id, 'Sample Officer T (mock)')).rejects.toThrow(/less than 12 hours' rest/);
    await svc.updateCmsSettings(arms, { minRestHours: 10 });
    expect((await svc.assignCmsShift(arms, target.id, 'Sample Officer T (mock)')).staffId).toBe('cms-st-t');
    const view = await svc.cmsHours(hr);
    expect(view.restRules.minRestHours).toBe(10);
    expect(view.canChange).toBe(false);
    expect(view.rows.length).toBeGreaterThan(0);
    await expect(svc.cms(hr)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.cmsHours(await svc.user('u-cms-head'))).rejects.toBeInstanceOf(AccessDenied);
    expect(ds.audit.some((a) => a.action === 'arms.cms_settings' && a.summary.includes('Rest between shifts (h)'))).toBe(true);
  });
});

describe('CMS desk handover reaches Prima as the company record', () => {
  it('lands on the roster seats when the operators are the people rostered; repeats count once; wrong people are refused', async () => {
    const { ds, svc, at } = fresh();
    const { day, night } = twoShifts(ds);
    at('19:00');
    const link = await svc.user('u-cms-link');
    const h = {
      id: 'handover-abc12345',
      fromShiftId: day.id,
      shiftId: night.id,
      outgoing: { operator: 'Hafiz bin Rahman', at: '2026-10-26T10:40:00.000Z', note: 'Intrusion at plaza open', openAlarms: [{ id: 'alarm-1', kind: 'INTRUSION', siteId: 'site-x', summary: 'Zone 3', state: 'acknowledged' }] },
      incoming: { operator: 'Siti Aishah binti Omar', at: '2026-10-26T10:45:00.000Z', agree: true, note: 'Board checked, OM on the way' },
    };
    const wrong = { ...h, id: 'handover-wrong123', incoming: { ...h.incoming, operator: 'Someone Else' } };
    const r = await svc.cmsIngest(link, { events: [], closedAlarms: [], handovers: [wrong, h] });
    expect(r.received.handovers).toBe(2);
    expect(r.handovers).toBe(1);
    expect(r.refused).toEqual([expect.objectContaining({ list: 'handovers', id: 'handover-wrong123' })]);
    const n = ds.cmsShifts.find((x) => x.id === night.id)!;
    expect(n.handoverVia).toBe('cms_app');
    expect(n.handoverFrom!.by).toBe('Hafiz bin Rahman');
    expect(ds.cmsShifts.find((x) => x.id === day.id)!.handoverOut!.openItems[0].ref).toBe('alarm-1');
    const again = await svc.cmsIngest(link, { events: [], handovers: [h] });
    expect(again.duplicates).toBe(1);
    // A handover already taken on Prima's board is not overwritten by a different one from the desk.
    const other = await svc.cmsIngest(link, { events: [], handovers: [{ ...h, id: 'handover-other123' }] });
    expect(other.refused[0].reason).toMatch(/already taken/);
    // Only the CMS app link sends this.
    await expect(svc.cmsIngest(await svc.user('u-cms-head'), { handovers: [h] })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('the directory sends the desk roster to the CMS app, names only', async () => {
    const { svc } = fresh();
    const dir = await svc.cmsDirectory(await svc.user('u-cms-link'));
    expect(dir.desk.length).toBeGreaterThan(0);
    expect(Object.keys(dir.desk[0]).sort()).toEqual(['end', 'id', 'onDesk', 'post', 'staffName', 'start']);
  });

  it('refuses a desk handover outside the seat time, or one with no written step while the outgoing Head Control is on the desk', async () => {
    const { ds, svc, at } = fresh();
    const { day, night } = twoShifts(ds);
    at('19:00');
    const link = await svc.user('u-cms-link');
    const inc = { operator: 'Siti Aishah binti Omar', at: '2026-10-26T10:45:00.000Z', agree: true, note: 'Board checked' };
    const base = { fromShiftId: day.id, shiftId: night.id };
    const early = await svc.cmsIngest(link, { handovers: [{ ...base, id: 'handover-early123', outgoing: null, incoming: { ...inc, at: '2026-10-26T09:00:00.000Z' } }] });
    expect(early.refused[0].reason).toMatch(/outside that seat/);
    const junk = await svc.cmsIngest(link, { handovers: [{ ...base, id: 'handover-junk1234', outgoing: null, incoming: { ...inc, at: 'not a time' } }] });
    expect(junk.refused[0].reason).toMatch(/needs id, shiftId/);
    const noOut = await svc.cmsIngest(link, { handovers: [{ ...base, id: 'handover-noout123', outgoing: null, incoming: inc }] });
    expect(noOut.refused[0].reason).toMatch(/written handover is needed/);
    expect(ds.cmsShifts.find((x) => x.id === night.id)!.handoverAt).toBeFalsy();
  });
});

describe('A seat someone clocked in on', () => {
  it('keeps their hours: Arms Control cannot give it to someone else', async () => {
    const { ds, svc, at } = fresh();
    const { night } = twoShifts(ds);
    at('18:35');
    await svc.cmsSeatClockIn(await svc.user('u-cms-head-b'), night.id);
    await expect(svc.assignCmsShift(await svc.user('u-pwvsb-arms'), night.id, 'cms-st-01')).rejects.toThrow(/clocked in on this seat/);
    expect(ds.cmsShifts.find((x) => x.id === night.id)!.staffId).toBe('cms-st-02');
  });
});

describe('Rostering picks the person by staff record', () => {
  it('two people with the same name: the name alone is refused, the staff record is accepted', async () => {
    const { ds, svc } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const D = addDays(TODAY, 3);
    ds.cmsStaff.push(
      { id: 'cms-st-u1', name: 'Sample Officer U (mock)', posts: ['MONITOR_OFFICER'], ext: '965', active: true, userId: null },
      { id: 'cms-st-u2', name: 'Sample Officer U (mock)', posts: ['MONITOR_OFFICER'], ext: '966', active: true, userId: null },
    );
    // The first U works the night before: only that U would run straight on into the 07:00 seat.
    ds.cmsShifts.push({ id: 'fake-u1', date: addDays(D, -1), start: myt(addDays(D, -1), '19:00'), end: myt(D, '07:00'), post: 'MONITOR_OFFICER', seat: 9, staffName: 'Sample Officer U (mock)', staffId: 'cms-st-u1', clockIn: null });
    const target = seat(ds, D, '0700', 'mo');
    target.staffName = null;
    await expect(svc.assignCmsShift(arms, target.id, 'Sample Officer U (mock)')).rejects.toThrow(/More than one/);
    await expect(svc.assignCmsShift(arms, target.id, 'cms-st-u1')).rejects.toThrow(/would work 24/);
    const put = await svc.assignCmsShift(arms, target.id, 'cms-st-u2');
    expect(put.staffId).toBe('cms-st-u2');
    expect(put.staffName).toBe('Sample Officer U (mock)');
  });
});
