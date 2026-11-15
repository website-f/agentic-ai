import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, carryCompletedDays, generateDataset, monthDates, rosterPayInput, rosterStepProblem, type Attendance, type RosterStatus } from '../src';

// Fixes from the review of PR #141 (14 Nov 2026), one test each. Synthetic mock data only.
const TODAY = '2026-11-14';
const NOW = '2026-11-14T02:00:00.000Z';
const SITE = 'st-sasa-001';
const MONTH = '2026-12';
const coverage = {
  effectiveFrom: '2026-11-01',
  calendar: { kind: 'every_day' as const },
  shifts: [{ code: 'D' as const, start: '08:00', end: '20:00', posts: 1 }],
  minActive: 1, armed: false, clientLimits: { maxDutyHours: 12 }, billing: 'fixed_monthly_post' as const,
  breakPermissionRef: null, reason: 'Signed contract schedule A', documentRef: 'CONTRACT-TEST-1',
};
const lines = (a: string, b: string) =>
  monthDates(MONTH).flatMap((date, i) => {
    const on = i % 2 === 0 ? a : b, off = i % 2 === 0 ? b : a;
    return [{ personId: on, date, planned: 'WORK_D' as RosterStatus, plannedStart: `${date}T08:00:00+08:00`, plannedEnd: `${date}T20:00:00+08:00` }, { personId: off, date, planned: 'OFF_REST' as RosterStatus }];
  });
const att = (id: string, personId: string, start: string, end: string): Attendance => ({ id, companyId: 'co-sasa', siteId: SITE, shiftId: null, personId, deviceId: 'dev', clockIn: start, clockOut: end, lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: true });

async function published() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const at = { now: NOW };
  const svc = new PrimaService(store, () => at.now);
  const om = await svc.user('u-om-klang'), od = await svc.user('u-opsdir');
  const a = (await svc.user('u-guard-sasa-1')).personId!;
  const b = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && p.id !== a)!.id;
  await svc.saveSiteCoverage(od, SITE, coverage);
  const v = await svc.saveRosterDraft(om, SITE, MONTH, { days: lines(a, b) });
  await svc.rosterStep(om, v.version.id, 'submit', 'Ready');
  await svc.rosterStep(od, v.version.id, 'publish', 'Checked');
  return { svc, store, at, om, od, a, b };
}

describe('review of PR #141', () => {
  it('P1: a replacement roster keeps the verified actuals and breaks of the version it replaced', async () => {
    const { svc, store, at, om, od, a, b } = await published();
    at.now = '2026-12-05T13:00:00.000Z';
    const board = await svc.rosterBoard(om, SITE, MONTH);
    const first = board.days.find((d) => d.personId === a && d.planned === 'WORK_D')!;
    await svc.recordRosterActual(om, first.id, 'WORK_D');
    await svc.recordRosterBreak(om, first.id, { slot: 'A', start: `${first.date}T12:00:00+08:00`, end: `${first.date}T13:00:00+08:00`, relieved: true, confirm: true });
    const attendance = [att('att-1', a, first.plannedStart!, first.plannedEnd!)];
    const read = async () => rosterPayInput({ personId: a, month: MONTH, versions: await store.list('rosterVersions', {}), days: await store.list('rosterDays', {}), attendance, breaks: await store.list('attendanceBreaks', {}), coverage: await store.list('siteCoverage', {}), allowances: [], lumpSums: [], armedUntil: null, employedDays: 31 })!;
    expect((await read()).duties.find((d) => d.date === first.date)!.workedMinutes).toBe(720);
    // A changed version (same lines) is published: the verified 720 minutes stay.
    const v2 = await svc.saveRosterDraft(om, SITE, MONTH, { days: lines(a, b), changeReason: 'Client asked to change late December cover' });
    await svc.rosterStep(om, v2.version.id, 'submit', 'Ready again');
    await svc.rosterStep(od, v2.version.id, 'publish', 'Checked again');
    const after = await read();
    expect(after.duties.find((d) => d.date === first.date)!.workedMinutes).toBe(720);
    const carried = (await store.list('rosterDays', { rosterVersionId: v2.version.id })).find((d) => d.personId === a && d.date === first.date)!;
    expect(carried.actual).toBe('WORK_D');
    expect(carried.actualById).toBe(om.id);
  });

  it('P1: a later coverage version (say a December break plan) never changes a duty dated before it', async () => {
    const { store, at, a, b } = await published();
    at.now = '2026-12-31T13:00:00.000Z';
    const days = (await store.list('rosterDays', {})).map((d) => (d.personId === b && d.planned === 'OFF_REST' ? { ...d, planned: 'WORK_D' as RosterStatus, plannedStart: `${d.date}T08:00:00+08:00`, plannedEnd: `${d.date}T20:00:00+08:00` } : d)).map((d) => (d.personId === a ? { ...d, actual: 'WORK_D' as RosterStatus } : d));
    const base = (await store.list('siteCoverage', {})).find((c) => c.siteId === SITE)!;
    const early = { ...base, breakPlan: null, breakPermissionRef: null };
    const late = { ...base, id: `${base.id}-dec16`, effectiveFrom: '2026-12-16', breakPlan: { minutesPerShift: 60, maxSegmentMinutes: 60, paid: false, permission: 'relief_required' as const }, breakPermissionRef: 'CLIENT-LETTER-TEST' };
    const aDays = days.filter((d) => d.personId === a && d.planned === 'WORK_D');
    const before = aDays.find((d) => d.date < '2026-12-16')!, afterDay = aDays.find((d) => d.date > '2026-12-16')!;
    const brk = (d: typeof before) => ({ id: `ab-${d.id}`, companyId: 'co-sasa', siteId: SITE, personId: a, rosterDayId: d.id, date: d.date, slot: 'A', start: `${d.date}T12:00:00+08:00`, end: `${d.date}T13:00:00+08:00`, relieved: true, interruptedMinutes: 0, recordedById: 'u-om-klang', recordedAt: NOW, confirmedById: 'u-om-klang', confirmedAt: NOW });
    const versions = await store.list('rosterVersions', {});
    const attendance = [att('a1', a, before.plannedStart!, before.plannedEnd!), att('a2', a, afterDay.plannedStart!, afterDay.plannedEnd!)];
    const run = (cov: (typeof base)[]) => rosterPayInput({ personId: a, month: MONTH, versions, days, attendance, breaks: [brk(before), brk(afterDay)], coverage: cov, allowances: [], lumpSums: [], armedUntil: null, employedDays: 31 })!;
    const only = run([early]);
    const both = run([early, late]);
    expect(only.duties.find((d) => d.date === before.date)!.workedMinutes).toBe(720);
    expect(both.duties.find((d) => d.date === before.date)!.workedMinutes).toBe(720);
    // From its own date the December plan applies: the relieved, confirmed hour is unpaid with two guards on post.
    expect(both.duties.find((d) => d.date === afterDay.date)!.workedMinutes).toBe(660);
    // Review S2: the two guards on different posts: each is alone on the post, so the break is not unpaid.
    const posted = days.map((d) => ({ ...d, postId: d.personId === a ? 'post-test-1' : 'post-test-2' }));
    const apart = rosterPayInput({ personId: a, month: MONTH, versions, days: posted, attendance, breaks: [brk(before), brk(afterDay)], coverage: [early, late], allowances: [], lumpSums: [], armedUntil: null, employedDays: 31 })!;
    expect(apart.duties.find((d) => d.date === afterDay.date)!.workedMinutes).toBe(720);
    const together = rosterPayInput({ personId: a, month: MONTH, versions, days: days.map((d) => ({ ...d, postId: 'post-test-1' })), attendance, breaks: [brk(before), brk(afterDay)], coverage: [early, late], allowances: [], lumpSums: [], armedUntil: null, employedDays: 31 })!;
    expect(together.duties.find((d) => d.date === afterDay.date)!.workedMinutes).toBe(660);
  });

  it('S1: an absence decided unpaid after last month was submitted is picked up in this month', async () => {
    const { store, a } = await published();
    const versions = (await store.list('rosterVersions', {})).map((v) => v);
    const dec = await store.list('rosterDays', {});
    // A made-up November version with one ABS day decided unpaid on 5 Jan, after November was submitted on 3 Dec.
    const nov = { ...versions[0], id: 'rv-test-nov', month: '2026-11' };
    const absDay = { ...dec.find((d) => d.personId === a)!, id: 'rd-test-nov-1', rosterVersionId: nov.id, date: '2026-11-20', planned: 'WORK_D' as RosterStatus, actual: 'ABS' as RosterStatus, absDecision: { unpaid: true, byId: 'u-opsdir', at: '2027-01-05T02:00:00.000Z', reason: 'No reason given (test)' } };
    const run = (lateCutoff: string | null) => rosterPayInput({ personId: a, month: MONTH, versions: [...versions, nov], days: [...dec, absDay], attendance: [], breaks: [], coverage: [], allowances: [], lumpSums: [], armedUntil: null, employedDays: 31, lateCutoff })!;
    expect(run('2026-12-03T02:00:00.000Z').lateUnpaid).toEqual(['2026-11-20']);
    // Decided before November was submitted (November's own run took it), or November still a draft: nothing here.
    expect(run('2027-01-06T02:00:00.000Z').lateUnpaid).toEqual([]);
    expect(run(null).lateUnpaid).toEqual([]);
  });

  it('P2: after a return and resubmission the same Area Supervisor can verify again', () => {
    const v = {
      status: 'submitted', preparedById: 'u-om', steps: [
        { action: 'submit', byId: 'u-om', role: 'om', at: NOW, reason: 'Ready' },
        { action: 'verify', byId: 'u-as', role: 'area_supervisor', at: NOW, reason: 'OK' },
        { action: 'return', byId: 'u-od', role: 'ops_director', at: NOW, reason: 'Fix the 24th' },
        { action: 'submit', byId: 'u-om', role: 'om', at: NOW, reason: 'Fixed' },
      ],
    } as never;
    const site = { sector: 'private' as const, hasAreaSupervisor: true };
    expect(rosterStepProblem(v, { action: 'verify', byId: 'u-as', role: 'area_supervisor', reason: 'Checked again' }, site, { canPublish: true })).toBeNull();
    // Within one round the rule still holds: the verifier cannot also publish.
    const v2 = { status: 'verified', preparedById: 'u-om', steps: [{ action: 'submit', byId: 'u-om', role: 'om', at: NOW, reason: 'Ready' }, { action: 'verify', byId: 'u-x', role: 'area_supervisor', at: NOW, reason: 'OK' }] } as never;
    expect(rosterStepProblem(v2, { action: 'publish', byId: 'u-x', role: 'ops_director', reason: 'Publish' }, site, { canPublish: true })).toMatch(/different person/);
  });

  // Independent review, batch 1 (14 Nov 2026).
  it('D3: the OM cannot record UPL, AL, MC or HOSP without the approved leave; pay reads the leave records', async () => {
    const { svc, store, at, om, a } = await published();
    at.now = '2026-12-05T13:00:00.000Z';
    const day = (await svc.rosterBoard(om, SITE, MONTH)).days.find((d) => d.personId === a && d.planned === 'WORK_D')!;
    await expect(svc.recordRosterActual(om, day.id, 'UPL')).rejects.toThrow(/No approved leave/);
    await expect(svc.recordRosterActual(om, day.id, 'AL')).rejects.toThrow(/No approved leave/);
    // HR's approved unpaid leave on that date: only UPL may be recorded.
    await store.insert('leaveRequests', { id: 'lv-test-upl', companyId: 'co-sasa', personId: a, kind: 'UNPAID', from: day.date, to: day.date, days: 1, reason: 'Urusan keluarga (test)', proofIds: [], requestedAt: NOW, requestedBy: 'Guard (test)', via: 'company', status: 'approved', decidedBy: 'HR (test)', decidedAt: NOW, decisionNote: 'ok' } as never);
    await expect(svc.recordRosterActual(om, day.id, 'AL')).rejects.toThrow(/is UPL/);
    await svc.recordRosterActual(om, day.id, 'UPL');
    // In pay, a roster UPL without a record becomes ABS waiting for the OD/OGM; with the record it stays UPL.
    const versions = await store.list('rosterVersions', {});
    const days = await store.list('rosterDays', {});
    const cov = await store.list('siteCoverage', {});
    const read = (leaveOn?: (d: string) => 'UPL' | 'AL' | 'MC' | 'HOSP' | null) =>
      rosterPayInput({ personId: a, month: MONTH, versions, days, attendance: [], breaks: [], coverage: cov, allowances: [], lumpSums: [], armedUntil: null, employedDays: 31, leaveOn })!;
    const none = read(() => null);
    expect(none.days.find((d) => d.date === day.date)!.actual).toBe('ABS');
    expect(none.absDecidedUnpaid).toEqual([]);
    expect(none.leaveMismatches.map((m) => m.date)).toEqual([day.date]);
    const withRec = read((d) => (d === day.date ? 'UPL' : null));
    expect(withRec.days.find((d) => d.date === day.date)!.actual).toBe('UPL');
    expect(withRec.siteId).toBe(SITE);
  });

  it('D4: once published, a replacement version cannot relabel or drop a past day', async () => {
    const { svc, at, om, a, b } = await published();
    at.now = '2026-12-20T02:00:00.000Z';
    const all = lines(a, b);
    const past = all.find((x) => x.personId === a && x.planned === 'WORK_D' && x.date === '2026-12-03')!;
    const relabel = all.map((x) => (x === past ? { personId: a, date: x.date, planned: 'OFF_REST' as RosterStatus } : x));
    await expect(svc.saveRosterDraft(om, SITE, MONTH, { days: relabel, changeReason: 'Relabel a past day (test)' })).rejects.toThrow(/has passed/);
    await expect(svc.saveRosterDraft(om, SITE, MONTH, { days: all.filter((x) => x !== past), changeReason: 'Drop a past day (test)' })).rejects.toThrow(/cannot be taken off/);
    // Future days may still change.
    const future = all.find((x) => x.personId === a && x.planned === 'WORK_D' && x.date > '2026-12-21')!;
    const ok = all.map((x) => (x === future ? { personId: a, date: x.date, planned: 'OFF_ADD' as RosterStatus } : x));
    await expect(svc.saveRosterDraft(om, SITE, MONTH, { days: ok, changeReason: 'Client asked for less cover late December' })).resolves.toBeTruthy();
  });
});

describe('review of PR #141, batch 3', () => {
  it('D6: a site supervisor sees the published roster only and no guard pay; the OM still sees the draft and the pay', async () => {
    const { svc, store, om, od, a } = await published();
    const sv = (await store.list('users', {})).find((u) => u.role === 'supervisor' && u.siteIds.includes(SITE))!;
    expect(sv).toBeTruthy();
    await svc.proposeGuardAllowance(om, SITE, { personId: a, type: 'transport', basis: 'per_duty', amount: 5, from: `${MONTH}-01`, reason: 'Synthetic approved memo' } as never);
    // A replacement draft (future days only change) is waiting.
    const pub = (await svc.rosterBoard(od, SITE, MONTH)).days;
    await svc.saveRosterDraft(om, SITE, MONTH, { days: pub.map((d) => ({ personId: d.personId, date: d.date, planned: d.planned, plannedStart: d.plannedStart, plannedEnd: d.plannedEnd })), changeReason: 'Synthetic change' });
    const svBoard = await svc.rosterBoard(sv, SITE, MONTH);
    expect(svBoard.role).toBe('view');
    expect(svBoard.versions.map((v) => v.status)).toEqual(['published']);
    expect(svBoard.current?.status).toBe('published');
    expect(svBoard.allowances).toEqual([]);
    expect(svBoard.lumpSums).toEqual([]);
    const omBoard = await svc.rosterBoard(om, SITE, MONTH);
    expect(omBoard.current?.status).toBe('draft');
    expect(omBoard.allowances.length).toBe(1);
  });
});

describe("Fauzan's audit of 4b708ae: carrying completed days", () => {
  const row = (over: Record<string, unknown>) =>
    ({ id: 'rd-old-p1-2026-12-01', companyId: 'co-sasa', rosterVersionId: 'rv-old', personId: 'p1', siteId: SITE, postId: null, date: '2026-12-01', planned: 'WORK_D', actual: null, plannedStart: '2026-12-01T08:00:00+08:00', plannedEnd: '2026-12-01T20:00:00+08:00', removed: false, actualById: null, actualCorrection: null, absDecision: null, ...over }) as never;
  it('P1: a completed duty keeps the times it was recorded against; P2: a restore carries no identity fields', () => {
    const old = row({ actual: 'WORK_D', actualById: 'u-om-klang' });
    const shorter = row({ id: 'rd-new-p1-2026-12-01', rosterVersionId: 'rv-new', plannedEnd: '2026-12-01T16:00:00+08:00' });
    const c1 = carryCompletedDays([old], [shorter], 'rv-new');
    expect(c1.update).toHaveLength(1);
    expect(c1.update[0].patch).toMatchObject({ actual: 'WORK_D', plannedEnd: '2026-12-01T20:00:00+08:00' });
    const removed = row({ id: 'rd-rv-new-p1-2026-12-01', rosterVersionId: 'rv-new', removed: true });
    const c2 = carryCompletedDays([old], [removed], 'rv-new');
    expect(c2.update).toHaveLength(1);
    expect(c2.update[0].id).toBe('rd-rv-new-p1-2026-12-01');
    expect(c2.update[0].patch).not.toHaveProperty('id');
    expect(c2.update[0].patch).not.toHaveProperty('companyId');
    expect(c2.update[0].patch).toMatchObject({ removed: false, actual: 'WORK_D', rosterVersionId: 'rv-new' });
  });
});
