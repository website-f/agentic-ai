import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, hybridPay, monthDates, rosterPayInput, sha256Hex, type Attendance, type RosterStatus } from '../src';

// Guard roster screens (Part O, Fauzan 13-14 Nov 2026): the approval chain, frozen versions, corrections, absences,
// breaks, evidence, allowances and the guard's own lump-sum signature. Synthetic mock data only.
const TODAY = '2026-11-14';
const NOW = '2026-11-14T02:00:00.000Z';
const SITE = 'st-sasa-001'; // private site
const MONTH = '2026-12';

function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const at = { now: NOW };
  const svc = new PrimaService(store, () => at.now);
  return { ds, store, at, svc };
}

const coverage = {
  effectiveFrom: '2026-11-01',
  calendar: { kind: 'every_day' as const },
  shifts: [{ code: 'D' as const, start: '08:00', end: '20:00', posts: 1 }],
  minActive: 1,
  armed: false,
  clientLimits: { maxDutyHours: 12 },
  billing: 'fixed_monthly_post' as const,
  breakPermissionRef: null,
  reason: 'Signed contract schedule A',
  documentRef: 'CONTRACT-TEST-1',
};

/** Two guards alternating day duties, so every day is covered by one guard. */
function lines(a: string, b: string, month = MONTH) {
  return monthDates(month).flatMap((date, i) => {
    const on = i % 2 === 0 ? a : b;
    const off = i % 2 === 0 ? b : a;
    const duty = { personId: on, date, planned: 'WORK_D' as RosterStatus, plannedStart: `${date}T08:00:00+08:00`, plannedEnd: `${date}T20:00:00+08:00` };
    return [duty, { personId: off, date, planned: 'OFF_REST' as RosterStatus }];
  });
}

async function people(svc: PrimaService, ds: ReturnType<typeof generateDataset>) {
  const guard = await svc.user('u-guard-sasa-1');
  const a = guard.personId!;
  const b = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && p.id !== a)!.id;
  return { guard, a, b };
}

describe('guard roster desk (Part O screens)', () => {
  it('runs OM prepare -> Operations Director publish, refuses wrong roles and self-approval, freezes the published version', async () => {
    const { svc, ds } = setup();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    const ogm = await svc.user('u-ogm');
    const coo = await svc.user('u-coo');
    const { a, b } = await people(svc, ds);

    // Coverage is set by the Operations Director (private site), not the OM or the OGM.
    await expect(svc.saveSiteCoverage(om, SITE, coverage)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveSiteCoverage(ogm, SITE, coverage)).rejects.toThrow();
    await svc.saveSiteCoverage(od, SITE, coverage);

    // Only the OM prepares.
    await expect(svc.saveRosterDraft(od, SITE, MONTH, { days: lines(a, b) })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveRosterDraft(om, SITE, MONTH, { days: [...lines(a, b), lines(a, b)[0]] })).rejects.toThrow(/twice/);
    const saved = await svc.saveRosterDraft(om, SITE, MONTH, { days: lines(a, b) });
    expect(saved.findings.filter((f) => f.level === 'block')).toEqual([]);
    const v1 = saved.version.id;

    await expect(svc.rosterStep(od, v1, 'publish', 'ok')).rejects.toThrow(/Only a submitted roster/);
    await svc.rosterStep(om, v1, 'submit', 'December roster ready');
    await expect(svc.rosterStep(om, v1, 'publish', 'mine')).rejects.toThrow();
    await expect(svc.rosterStep(coo, v1, 'publish', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.rosterStep(od, v1, 'publish', '')).rejects.toThrow(/reason/);
    const pub = await svc.rosterStep(od, v1, 'publish', 'Checked against contract');
    expect(pub.status).toBe('published');

    // A change after publishing is a new version with a reason; the old one is replaced on publishing the new one.
    await expect(svc.saveRosterDraft(om, SITE, MONTH, { days: lines(b, a) })).rejects.toThrow(/reason/);
    const v2 = await svc.saveRosterDraft(om, SITE, MONTH, { days: lines(b, a), changeReason: 'Guard swap requested' });
    expect(v2.version.version).toBe(2);
    expect(v2.version.replacesId).toBe(v1);
    await svc.rosterStep(om, v2.version.id, 'submit', 'Swap');
    await svc.rosterStep(od, v2.version.id, 'return', 'Please check night cover');
    const board = await svc.rosterBoard(om, SITE, MONTH);
    expect(board.current?.id).toBe(v2.version.id);
    expect(board.current?.status).toBe('draft');
    expect(board.versions.find((v) => v.id === v1)?.status).toBe('published');
    await svc.rosterStep(om, v2.version.id, 'submit', 'Checked again');
    await svc.rosterStep(od, v2.version.id, 'publish', 'Approved swap');
    const after = await svc.rosterBoard(od, SITE, MONTH);
    expect(after.versions.find((v) => v.id === v1)?.status).toBe('replaced');
    expect(after.can.coverage).toBe(true);
    expect(after.can.prepare).toBe(false);
  });

  it('publishing is refused while a post is uncovered', async () => {
    const { svc, ds } = setup();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    const { a, b } = await people(svc, ds);
    await svc.saveSiteCoverage(od, SITE, coverage);
    const gap = lines(a, b).filter((l) => !(l.date === `${MONTH}-10` && l.planned === 'WORK_D'));
    const saved = await svc.saveRosterDraft(om, SITE, MONTH, { days: gap });
    expect(saved.canPublish).toBe(false);
    await svc.rosterStep(om, saved.version.id, 'submit', 'Draft');
    await expect(svc.rosterStep(od, saved.version.id, 'publish', 'Go')).rejects.toThrow(/block publishing/);
  });

  it('records the actual day once; a correction needs evidence and a different approver; ABS is decided once', async () => {
    const { svc, ds, at } = setup();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    const { a, b } = await people(svc, ds);
    await svc.saveSiteCoverage(od, SITE, coverage);
    const v = await svc.saveRosterDraft(om, SITE, MONTH, { days: lines(a, b) });
    await svc.rosterStep(om, v.version.id, 'submit', 'Ready');
    await svc.rosterStep(od, v.version.id, 'publish', 'Checked');
    const board = await svc.rosterBoard(om, SITE, MONTH);
    const day = board.days.find((d) => d.date === `${MONTH}-01` && d.planned === 'WORK_D')!;
    await expect(svc.recordRosterActual(om, day.id, 'WORK_D')).rejects.toThrow(/not come yet/);
    at.now = '2026-12-01T13:00:00.000Z';
    await svc.recordRosterActual(om, day.id, 'ABS');
    await expect(svc.recordRosterActual(om, day.id, 'WORK_D')).rejects.toThrow(/already recorded/);
    await expect(svc.decideRosterAbsence(om, day.id, true, 'No call no show, checked')).rejects.toBeInstanceOf(AccessDenied);
    await svc.decideRosterAbsence(od, day.id, true, 'No call, no show, no reason given');
    await expect(svc.decideRosterAbsence(od, day.id, false, 'Changed my mind on this')).rejects.toThrow(/already decided/);

    await expect(svc.proposeRosterCorrection(om, day.id, { to: 'WORK_D', evidence: '', reason: 'Clocked in' })).rejects.toThrow(/evidence/);
    await svc.proposeRosterCorrection(om, day.id, { to: 'WORK_D', evidence: 'ATT-TEST-1', reason: 'Clocked in, device was offline' });
    await expect(svc.decideRosterCorrection(om, day.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const fixed = await svc.decideRosterCorrection(od, day.id, true, 'Evidence checked');
    expect(fixed.actual).toBe('WORK_D');
    expect(fixed.planned).toBe('WORK_D');
  });

  it('breaks: inside the duty, no overlap, never confirmed by the guard; evidence needs a document', async () => {
    const { svc, ds, at } = setup();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    const { a, b, guard } = await people(svc, ds);
    await svc.saveSiteCoverage(od, SITE, { ...coverage, breakPlan: { minutesPerShift: 120, maxSegmentMinutes: 60, paid: false, permission: 'relief_required' }, breakPermissionRef: 'CLIENT-LETTER-TEST' });
    const v = await svc.saveRosterDraft(om, SITE, MONTH, { days: lines(a, b) });
    await svc.rosterStep(om, v.version.id, 'submit', 'Ready');
    await svc.rosterStep(od, v.version.id, 'publish', 'Checked');
    at.now = '2026-12-01T13:00:00.000Z';
    const day = (await svc.rosterBoard(om, SITE, MONTH)).days.find((d) => d.date === `${MONTH}-01` && d.planned === 'WORK_D')!;
    const brk = { slot: 'A', start: '2026-12-01T09:00:00+08:00', end: '2026-12-01T10:00:00+08:00', relieved: true, confirm: true };
    await expect(svc.recordRosterBreak(guard, day.id, brk)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.recordRosterBreak(om, day.id, { ...brk, end: '2026-12-01T10:30:00+08:00' })).rejects.toThrow(/at most 60/);
    await expect(svc.recordRosterBreak(om, day.id, { ...brk, start: '2026-12-01T07:00:00+08:00', end: '2026-12-01T07:30:00+08:00' })).rejects.toThrow(/outside/);
    const r = await svc.recordRosterBreak(om, day.id, brk);
    expect(r.confirmedById).toBe(om.id);
    await expect(svc.recordRosterBreak(om, day.id, { ...brk, start: '2026-12-01T09:30:00+08:00', end: '2026-12-01T10:15:00+08:00' })).rejects.toThrow(/overlaps/);

    await expect(svc.recordRosterEvidence(od, SITE, { rule: 'weekly_rest', kind: 'jtk_permit', documentRef: '', from: '2026-12-01', to: '2026-12-31' })).rejects.toThrow(/document/);
    await expect(svc.recordRosterEvidence(om, SITE, { rule: 'weekly_rest', kind: 'jtk_permit', documentRef: 'JTK-TEST', from: '2026-12-01', to: '2026-12-31' })).rejects.toBeInstanceOf(AccessDenied);
    const e = await svc.recordRosterEvidence(od, SITE, { rule: 'weekly_rest', kind: 'jtk_permit', documentRef: 'JTK-TEST', from: '2026-12-01', to: '2026-12-31' });
    expect(e.recordedById).toBe(od.id);
  });

  it('allowances: Operations proposes, the HR Director verifies, the COO approves; nobody does two steps', async () => {
    const { svc, ds } = setup();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    const cos = await svc.user('u-cos');
    const coo = await svc.user('u-coo');
    const { a } = await people(svc, ds);
    await svc.saveSiteCoverage(od, SITE, coverage);
    const al = await svc.proposeGuardAllowance(om, SITE, { personId: a, type: 'transport', basis: 'per_duty', amount: 5, from: '2026-12-01', reason: 'Approved transport memo TEST' });
    await expect(svc.decideGuardAllowance(coo, al.id, 'approve', true, 'ok')).rejects.toThrow(/verifies first/);
    await expect(svc.decideGuardAllowance(om, al.id, 'verify', true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.decideGuardAllowance(cos, al.id, 'verify', true, 'Checked against memo');
    await expect(svc.decideGuardAllowance(cos, al.id, 'approve', true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const ok = await svc.decideGuardAllowance(coo, al.id, 'approve', true, 'Approved');
    expect(ok.approvedById).toBe(coo.id);
  });

  it('lump sum: OD proposes, COO approves, only the named guard signs (hash of the text), CEO alone switches it on', async () => {
    const { svc, ds } = setup();
    const od = await svc.user('u-opsdir');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const { a, guard } = await people(svc, ds);
    const other = await svc.user('u-guard-sasa-2');
    await svc.saveSiteCoverage(od, SITE, coverage);
    await expect(svc.proposeLumpSum(od, SITE, { personId: a, target: 1500, from: '2026-12' })).rejects.toThrow(/minimum/);
    const ls = await svc.proposeLumpSum(od, SITE, { personId: a, target: 2300, from: '2026-12' });
    expect(ls.text).toMatch(/RM2300\.00/);
    await expect(svc.decideMyLumpSum(guard, ls.id, 'sign')).rejects.toThrow(/not approved/);
    await expect(svc.approveLumpSum(od, ls.id, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.approveLumpSum(coo, ls.id, 'Within the site budget');
    await expect(svc.decideMyLumpSum(other, ls.id, 'sign')).rejects.toThrow(/not found/i);
    await expect(svc.decideMyLumpSum(od, ls.id, 'sign')).rejects.toBeInstanceOf(AccessDenied);
    const signed = await svc.decideMyLumpSum(guard, ls.id, 'sign');
    expect(signed.status).toBe('signed');
    expect(signed.consent?.documentHash).toBe(sha256Hex(`${ls.id}\n${ls.text}`));
    await expect(svc.decideMyLumpSum(guard, ls.id, 'refuse')).rejects.toThrow();
    const mine = await svc.myRoster(guard, MONTH);
    expect(mine.agreements[0].status).toBe('signed');

    await expect(svc.setLumpSumSwitch(od, SITE, true, 'Go ahead given')).rejects.toBeInstanceOf(AccessDenied);
    const sw = await svc.setLumpSumSwitch(ceo, SITE, true, 'Pilot at this site');
    expect(sw.lumpSumSwitch?.on).toBe(true);
    const w = await svc.decideMyLumpSum(guard, ls.id, 'withdraw');
    expect(w.status).toBe('withdrawn');
  });

  it('a guard sees only the published roster; wrong roles cannot open a site board', async () => {
    const { svc, ds } = setup();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    const { a, b, guard } = await people(svc, ds);
    await svc.saveSiteCoverage(od, SITE, coverage);
    const v = await svc.saveRosterDraft(om, SITE, MONTH, { days: lines(a, b) });
    expect((await svc.myRoster(guard, MONTH)).days).toEqual([]);
    await expect(svc.rosterBoard(guard, SITE, MONTH)).rejects.toThrow();
    await expect(svc.rosterBoard(await svc.user('u-om-johor'), SITE, MONTH)).rejects.toThrow();
    await svc.rosterStep(om, v.version.id, 'submit', 'Ready');
    await svc.rosterStep(od, v.version.id, 'publish', 'Checked');
    const mine = await svc.myRoster(guard, MONTH);
    expect(mine.days.length).toBe(31);
    expect(mine.days.filter((d) => d.planned === 'WORK_D').length).toBe(16);
  });

  it('feeds the pay engine: published days only, verified minutes from clocking and confirmed breaks, ABS decisions, lump sum only when switched on', async () => {
    const { svc, ds, store, at } = setup();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const { a, b, guard } = await people(svc, ds);
    await svc.saveSiteCoverage(od, SITE, { ...coverage, breakPlan: { minutesPerShift: 60, maxSegmentMinutes: 60, paid: false, permission: 'relief_required' }, breakPermissionRef: 'CLIENT-LETTER-TEST' });
    const v = await svc.saveRosterDraft(om, SITE, MONTH, { days: lines(a, b) });
    await svc.rosterStep(om, v.version.id, 'submit', 'Ready');
    await svc.rosterStep(od, v.version.id, 'publish', 'Checked');
    at.now = '2026-12-31T13:00:00.000Z';
    const board = await svc.rosterBoard(om, SITE, MONTH);
    const duties = board.days.filter((d) => d.personId === a && d.planned === 'WORK_D');
    const attendance: Attendance[] = [];
    for (const d of duties) {
      await svc.recordRosterActual(om, d.id, 'WORK_D');
      attendance.push({ id: `att-${d.id}`, companyId: 'co-sasa', siteId: SITE, shiftId: null, personId: a, deviceId: 'dev', clockIn: d.plannedStart, clockOut: d.plannedEnd, lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: true });
    }
    // One confirmed, relieved 60-minute break on the first duty. Only one guard is on the post, so no unpaid break is
    // deducted (D4 T05): the whole 12 hours are paid.
    await svc.recordRosterBreak(om, duties[0].id, { slot: 'A', start: `${duties[0].date}T12:00:00+08:00`, end: `${duties[0].date}T13:00:00+08:00`, relieved: true, confirm: true });
    const ls = await svc.proposeLumpSum(od, SITE, { personId: a, target: 3500, from: MONTH });
    await svc.approveLumpSum(coo, ls.id, 'ok');
    at.now = '2026-12-31T13:01:00.000Z';
    await svc.decideMyLumpSum(guard, ls.id, 'sign');
    const read = async () =>
      rosterPayInput({
        personId: a, month: MONTH,
        versions: await store.list('rosterVersions', {}), days: await store.list('rosterDays', {}), attendance,
        breaks: await store.list('attendanceBreaks', {}), coverage: await store.list('siteCoverage', {}),
        allowances: [], lumpSums: await store.list('lumpSumAgreements', {}), armedUntil: null, employedDays: 31,
      })!;
    const input = await read();
    expect(input.duties.length).toBe(16);
    expect(input.duties[0].workedMinutes).toBe(720);
    expect(input.duties[1].workedMinutes).toBe(720);
    expect(input.lumpSum).toBeNull(); // signed, but the CEO has not switched it on at the site
    await svc.setLumpSumSwitch(ceo, SITE, true, 'Pilot at this site');
    expect((await read()).lumpSum?.target).toBe(3500);
    const pay = hybridPay({ month: MONTH, mode: 'roster_hybrid', settings: { basicMonthly: 1700, normalHoursPerDay: 8, workDaysPerWeek: 6, otNormalRate: 1.5, otRestDayRate: 2, otPublicHolidayRate: 3, restDayDays: 1, publicHolidayDays: 2, otRateBase: 'statutory', otRateRounding: 'exact', restDayExtraTreatment: 'same_as_rest_day', restDayNormalRateBase: 'statutory', restDayOtMultiplier: 2, normalWorkingDaysPerMonth: 26, incompleteMonthMethod: 'working_days' }, days: input.days, duties: input.duties, absDecidedUnpaid: input.absDecidedUnpaid, joinedOn: '2020-01-01', leftOn: null, lumpSum: (await read()).lumpSum });
    expect(pay.lumpSum?.target).toBe(3500);
    expect(pay.gross).toBeGreaterThanOrEqual(3500);
  });

  it('auto-roster proposes a staggered 5-on/2-off month that covers every post, saves nothing, and only for the OM', async () => {
    const { svc, ds, store } = setup();
    const om = await svc.user('u-om-klang');
    const od = await svc.user('u-opsdir');
    await svc.saveSiteCoverage(od, SITE, { ...coverage, shifts: [{ code: 'D', start: '08:00', end: '20:00', posts: 2 }, { code: 'N', start: '20:00', end: '08:00', posts: 2 }], clientLimits: { maxDutyHours: 12, maxDaysInRow: 6 } });
    const ids = ds.people.filter((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && p.hiredOn < '2026-11-01').slice(0, 6).map((p) => p.id);
    await expect(svc.proposeRosterMonth(od, SITE, MONTH, { pattern: '5on2off', personIds: ids })).rejects.toBeInstanceOf(AccessDenied);
    const p = await svc.proposeRosterMonth(om, SITE, MONTH, { pattern: '5on2off', personIds: ids });
    expect(p.uncovered).toEqual([]);
    expect(p.findings.filter((f) => f.level === 'block')).toEqual([]);
    for (const id of ids) {
      const mine = p.lines.filter((l) => l.personId === id);
      expect(mine.length).toBe(31);
      expect(mine.some((l) => l.planned === 'OFF_REST')).toBe(true);
    }
    // Every day has exactly 2 day and 2 night duties.
    for (const d of monthDates(MONTH)) {
      expect(p.lines.filter((l) => l.date === d && l.planned === 'WORK_D').length).toBe(2);
      expect(p.lines.filter((l) => l.date === d && l.planned === 'WORK_N').length).toBe(2);
    }
    expect(await store.list('rosterVersions', {})).toEqual([]);
  });

  it('ACT checks evidence once; nobody else does', async () => {
    const { svc } = setup();
    const od = await svc.user('u-opsdir');
    const act = await svc.user('u-act-aud1');
    await svc.saveSiteCoverage(od, SITE, coverage);
    const e = await svc.recordRosterEvidence(od, SITE, { rule: 'weekly_rest', kind: 'jtk_permit', documentRef: 'JTK-TEST', from: '2026-12-01', to: '2026-12-31' });
    await expect(svc.checkRosterEvidence(od, e.id, 'ok', 'fine')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.checkRosterEvidence(act, e.id, 'query', 'short')).rejects.toThrow(/reason/);
    const c = await svc.checkRosterEvidence(act, e.id, 'ok', 'Permit seen, dates match');
    expect(c.actCheck?.result).toBe('ok');
    await expect(svc.checkRosterEvidence(act, e.id, 'query', 'Second look at this')).rejects.toThrow(/Already/);
  });
});
