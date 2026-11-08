import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  RBA_REQUIREMENTS,
  RBA_SITE_FORM,
  clientCodeDefaults,
  generateDataset,
  myt,
  pickTraceSample,
  traceRow,
  wagesDueOn,
  workerFile,
  type Attendance,
  type GuardPayLine,
  type GuardPayRun,
  type Person,
  type Shift,
} from '../src';

// Synthetic data only. RBA readiness (Fauzan, 8 Nov 2026, "Yes" to the build order after the RBA v8.0 checklist).
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const png = (n: number) => `data:image/png;base64,${Buffer.from(`synthetic rba photo ${n}`).toString('base64')}`;

async function setup(extra?: (ds: ReturnType<typeof generateDataset>) => void) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  extra?.(ds);
  const svc = new PrimaService(new MemoryStore(ds), () => NOW);
  const dev = await svc.user('u-dev-sasa-001');
  const site = ds.sites.find((s) => s.id === dev.siteIds[0])!;
  const u = (id: string) => svc.user(id);
  const photo = (n: number) => ({ kind: 'photo' as const, image: png(n), lat: site.lat, lng: site.lng, accuracyM: 8 });
  return { ds, svc, site, photo, om: await u('u-om-klang'), act: await u('u-audit'), cm: await u('u-cm-sasa'), cmArsh: await u('u-cm-arsh'), cos: await u('u-cos'), coo: await u('u-coo'), hr: await u('u-pwvsb-hr'), fwm: await u('u-fwm-mgr'), od: await u('u-opsdir') };
}

describe('RBA as a client code with four grades', () => {
  it('the RBA list covers the five sections, numbers are unique and each says where proof is', () => {
    expect(new Set(RBA_REQUIREMENTS.map((r) => r.code)).size).toBe(RBA_REQUIREMENTS.length);
    expect(new Set(RBA_REQUIREMENTS.map((r) => r.area))).toEqual(new Set(['A. Labour', 'B. Health and safety', 'C. Environment', 'D. Ethics', 'E. Management system']));
    for (const r of RBA_REQUIREMENTS) expect(r.hint.length).toBeGreaterThan(3);
    const d = clientCodeDefaults('RBA');
    expect(d.hours).toEqual({ maxWeekHours: 60, maxDaysInRow: 6, breakAfterHours: 5, breakMinutes: 30 });
    expect(d.rooms).toBeNull();
    expect(d.siteInspectEveryDays).toBe(30);
    expect(d.siteForm).toEqual(RBA_SITE_FORM);
  });

  it('a gap needs a grade; met is green; red goes to ACT, the Chief of Staff and the COO the same day', async () => {
    const { svc, site, om, act, cm, cmArsh, cos, coo, photo } = await setup();
    const c = await svc.saveClientCode(om, site.id, { template: 'RBA' });
    expect(c.siteInspectEveryDays).toBe(30);
    await expect(svc.checkClientRequirement(om, c.id, { reqCode: 'A2', result: 'not_met', note: 'Two passports kept in the office safe' })).rejects.toThrow(/Grade the gap/);
    await expect(svc.checkClientRequirement(om, c.id, { reqCode: 'A2', result: 'met', note: 'Checked passports with each worker', grade: 'red' })).rejects.toThrow(/Only an item not met/);
    await expect(svc.checkClientRequirement(om, c.id, { reqCode: 'A2', result: 'not_met', note: 'x is wrong', grade: 'green' as never })).rejects.toThrow(/yellow, orange or red/);
    const met = await svc.checkClientRequirement(om, c.id, { reqCode: 'A8', result: 'met', note: 'Clock-in records for the month', proof: [photo(1)] });
    expect(met.grade).toBe('green');
    await svc.checkClientRequirement(om, c.id, { reqCode: 'A2', result: 'not_met', note: 'Two passports kept in the office safe without consent', grade: 'red' });
    await svc.checkClientRequirement(om, c.id, { reqCode: 'B4', result: 'not_met', note: 'No drill record this year', grade: 'yellow' });
    const board = await svc.clientCodeBoard(cm, site.id);
    const row = board.codes.find((x) => x.code.id === c.id)!;
    expect(row.counted).toMatchObject({ red: 1, yellow: 1, met: 1 });
    expect(row.siteCheck?.overdue).toBe(true);
    for (const who of [act, cos, coo]) {
      const h = await svc.home(who);
      expect(h.todo.some((t) => t.tag === 'RBA red' && t.title.includes('A2'))).toBe(true);
    }
    expect((await svc.home(cm)).todo.some((t) => t.tag === 'RBA red')).toBe(false);
    // The CEO's Do today keeps only his own steps (G6).
    expect((await svc.home(await svc.user('u-fauzan'))).todo.some((t) => t.tag === 'RBA red')).toBe(false);
    const rb = await svc.rbaBoard(act, site.companyId);
    expect(rb.red.map((x) => x.reqCode)).toEqual(['A2']);
    // The newest check wins: once fixed and met, red is gone.
    await svc.checkClientRequirement(act, c.id, { reqCode: 'A2', result: 'met', note: 'Passports returned; consent letters on file', proof: [photo(2)] });
    expect((await svc.rbaBoard(act, site.companyId)).red).toEqual([]);
    // A company head reads its own company only.
    expect((await svc.rbaBoard(cm, site.companyId)).dashboard).toHaveLength(9);
    await expect(svc.rbaBoard(cmArsh, site.companyId)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('the monthly site check is due until the OM does it; the dashboard counts it and the induction line', async () => {
    const { svc, site, om, act, photo } = await setup();
    const c = await svc.saveClientCode(om, site.id, { template: 'RBA' });
    expect((await svc.rbaBoard(om)).siteChecks.find((x) => x.codeId === c.id)?.overdue).toBe(true);
    const kpi = (await svc.rbaBoard(act, site.companyId)).dashboard;
    expect(kpi.find((k) => k.key === 'siteaudits')?.state).toBe('red');
    expect(kpi.find((k) => k.key === 'induction')?.state).toBe('red');
    await svc.saveClientInspection(om, c.id, { kind: 'site', lines: RBA_SITE_FORM.map((text) => ({ text, result: 'ok' as const })), proof: [photo(3)] });
    expect((await svc.rbaBoard(om)).siteChecks.find((x) => x.codeId === c.id)?.overdue).toBe(false);
    const after = (await svc.rbaBoard(act, site.companyId)).dashboard;
    expect(after.find((k) => k.key === 'siteaudits')).toMatchObject({ state: 'green', value: 100 });
    expect(after.find((k) => k.key === 'induction')?.state).toBe('green');
    // No trace review yet: payroll mismatches are unknown, never green.
    expect(after.find((k) => k.key === 'payroll')).toMatchObject({ state: 'unknown', value: null });
    // A site check every 7 to 92 days only, and only with a site form.
    await expect(svc.saveClientCode(om, site.id, { template: 'CUSTOM', name: 'Sample client code', requirements: [{ code: 'X1', text: 'Something the client wants' }], siteInspectEveryDays: 30 })).rejects.toThrow(/site inspection form/);
    await expect(svc.saveClientCode(om, site.id, { template: 'CUSTOM', name: 'Sample client code', requirements: [{ code: 'X1', text: 'Something the client wants' }], siteForm: ['Post is clean'], siteInspectEveryDays: 200 })).rejects.toThrow(/7 to 92/);
  });
});

const P = (over: Partial<Person> = {}): Person =>
  ({ id: 'p1', companyId: 'c1', branchId: 'b1', staffNo: 'T001', name: 'Test Guard', nationality: 'NP', idMasked: '****', dob: '1990-01-01', phone: '', role: 'guard', status: 'active', hiredOn: '2025-01-01', faceEnrolledOn: null, ...over }) as Person;
const shift = (date: string, h = 12): Shift => ({ id: `s-${date}`, companyId: 'c1', siteId: 's1', postId: 'post1', personId: 'p1', date, start: `${date}T00:00:00.000Z`, end: new Date(Date.parse(`${date}T00:00:00.000Z`) + h * 3_600_000).toISOString(), status: 'published' });
const clock = (date: string, h = 12, out = true): Attendance => ({ id: `a-${date}`, companyId: 'c1', siteId: 's1', shiftId: `s-${date}`, personId: 'p1', deviceId: 'd', clockIn: `${date}T00:00:00.000Z`, clockOut: out ? new Date(Date.parse(`${date}T00:00:00.000Z`) + h * 3_600_000).toISOString() : null, lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: true });
const line = (over: Partial<GuardPayLine> = {}): GuardPayLine => ({ personId: 'p1', daysWorked: 3, otHours: 12, net: 1500, accountProblem: null, ...over }) as GuardPayLine;
const run = (over: Partial<GuardPayRun> = {}): GuardPayRun => ({ id: 'r1', companyId: 'c1', period: '2026-10', stage: 'approved', trial: false, paid: null, lines: [], ...over }) as GuardPayRun;

describe('Trace review', () => {
  const base = { person: P(), period: '2026-10', today: '2026-11-03', normalHoursPerDay: 8, toleranceHours: 4 };
  const days = ['2026-10-01', '2026-10-02', '2026-10-03'];

  it('agrees when roster, clock, pay and bank say the same thing', () => {
    const row = traceRow({ ...base, shifts: days.map((d) => shift(d)), attendance: days.map((d) => clock(d)), run: run({ paid: { bankRef: 'BANK-1' } as never }), line: line() });
    expect(row).toMatchObject({ rosterHours: 36, clockedHours: 36, clockedDays: 3, clockedOtHours: 12, payDays: 3, payOtHours: 12, paid: 'paid', bankRef: 'BANK-1', mismatches: [] });
  });

  it('names every disagreement in plain words', () => {
    const row = traceRow({ ...base, today: '2026-11-10', shifts: days.map((d) => shift(d)), attendance: [clock(days[0]), clock(days[1], 8), clock(days[2], 12, false)], run: run(), line: line({ daysWorked: 3, otHours: 20, accountProblem: 'No account' }) });
    expect(row.mismatches.join(' ')).toMatch(/roster says 36 hours; the clock says 20 hours/);
    expect(row.mismatches.join(' ')).toMatch(/1 shift with no clock-out/);
    expect(row.mismatches.join(' ')).toMatch(/Clocked on 2 days; paid for 3/);
    expect(row.mismatches.join(' ')).toMatch(/Overtime clocked about 4 hours; overtime paid 20/);
    expect(row.mismatches.join(' ')).toMatch(/Not paid by 2026-11-07/);
    expect(row.mismatches.join(' ')).toMatch(/Pay account: No account/);
    expect(wagesDueOn('2026-12')).toBe('2027-01-07');
  });

  it('a trial run (JA pays) is not flagged as unpaid; a worked month with no run is', () => {
    expect(traceRow({ ...base, today: '2026-11-20', shifts: [], attendance: [], run: run({ trial: true }), line: line({ daysWorked: 0, otHours: 0 }) })).toMatchObject({ paid: 'trial', mismatches: [] });
    expect(traceRow({ ...base, shifts: [shift(days[0])], attendance: [clock(days[0])], run: null, line: null }).mismatches).toContain('Worked this month, but no pay run line.');
  });

  it('the sample is foreign workers first, never office staff or leavers, and steady for a month', () => {
    const people = [P({ id: 'a', nationality: 'MY' }), P({ id: 'b' }), P({ id: 'c', role: 'office' }), P({ id: 'd', status: 'left' }), P({ id: 'e' })];
    const s = pickTraceSample(people, '2026-10', 3);
    expect(s.map((x) => x.nationality)).toEqual(['NP', 'NP', 'MY']);
    expect(pickTraceSample(people, '2026-10', 3).map((x) => x.id)).toEqual(s.map((x) => x.id));
  });

  it('only ACT runs and settles it; a finding stays unsettled until corrected', async () => {
    const { svc, act, cm, hr } = await setup();
    await expect(svc.runRbaTrace(cm, 'co-sasa', '2026-10')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.runRbaTrace(hr, 'co-sasa', '2026-10')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.runRbaTrace(act, 'co-sasa', '2026-12')).rejects.toThrow(/earlier/);
    const t = await svc.runRbaTrace(act, 'co-sasa', '2026-10');
    expect(t.rows.length).toBeGreaterThan(0);
    expect(t.rows.length).toBeLessThanOrEqual(20);
    const bad = t.rows.find((x) => x.mismatches.length);
    expect(bad).toBeTruthy();
    const ok = t.rows.find((x) => !x.mismatches.length);
    if (ok) await expect(svc.settleRbaTraceRow(act, t.id, ok.personId, { kind: 'explained', note: 'Nothing to explain here' })).rejects.toThrow(/agree/);
    await expect(svc.settleRbaTraceRow(act, t.id, bad!.personId, { kind: 'explained', note: 'short' })).rejects.toThrow(/what was found/);
    await expect(svc.settleRbaTraceRow(cm, t.id, bad!.personId, { kind: 'explained', note: 'Company says it is fine' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.settleRbaTraceRow(act, t.id, bad!.personId, { kind: 'finding', note: 'Pay run missing for the month; Finance to run it' });
    const kpi = () => svc.rbaBoard(act, 'co-sasa').then((b) => b.dashboard.find((k) => k.key === 'payroll')!);
    const unsettled = t.rows.filter((x) => x.mismatches.length).length;
    expect((await kpi()).value).toBe(unsettled);
    await expect(svc.settleRbaTraceRow(act, t.id, bad!.personId, { kind: 'explained', note: 'Changed our mind about it' })).rejects.toThrow(/corrected/);
    await svc.settleRbaTraceRow(act, t.id, bad!.personId, { kind: 'corrected', note: 'Pay run prepared and paid with bank reference' });
    expect((await kpi()).value).toBe(unsettled - 1);
    await expect(svc.settleRbaTraceRow(act, t.id, bad!.personId, { kind: 'corrected', note: 'Again, just to be sure' })).rejects.toThrow(/Already settled/);
    // The company head reads the reviews of its own company.
    expect((await svc.rbaTraceBoard(cm, 'co-sasa')).canRun).toBe(false);
  });
});

describe('Worker master file', () => {
  it('shows missing records as missing, never as fine', () => {
    const folders = workerFile({ person: P(), today: '2026-10-26', renewals: [], recruit: null, pay: null, attendance30: 0, shifts30: 0, stays: [], hostelInspectedOn: null, training: [], credentials: [], welfare: [], disciplineCount: 0 });
    expect(folders.map((f) => f.label)).toEqual(['01 Identity', '02 Recruitment', '03 Employment', '04 Payroll', '05 Attendance', '06 Accommodation', '07 Training', '08 Grievance and discipline', '09 Exit']);
    expect(Object.fromEntries(folders.map((f) => [f.key, f.state]))).toMatchObject({ identity: 'missing', recruitment: 'missing', employment: 'missing', payroll: 'in_ja', attendance: 'in_ja', accommodation: 'na', training: 'missing', grievance: 'ok', exit: 'na' });
    const full = workerFile({
      person: P({ hiringDocs: [{ kind: 'AGREEMENT', docIds: ['d1'], by: 'x', at: NOW }] }),
      today: '2026-10-26',
      renewals: [{ paper: 'PASSPORT', expiresOn: '2030-01-01' }, { paper: 'PLKS_PERMIT', expiresOn: '2027-01-01' }] as never,
      recruit: { steps: Object.fromEntries(['AGENCY_LICENCE', 'EMBASSY', 'INTERVIEW', 'AGE', 'CONTRACT'].map((k) => [k, { passed: true, languages: k === 'CONTRACT' ? ['en', 'ne'] : undefined }])) } as never,
      pay: { period: '2026-09', line: line(), paid: true, trial: false },
      attendance30: 20,
      shifts30: 22,
      stays: [{ from: '2026-01-01', to: null }] as never,
      hostelInspectedOn: '2026-06-01',
      training: [],
      credentials: [{ type: 'CSG_TRAINING' }] as never,
      welfare: [{ kind: 'ARRIVAL_FEE', status: 'clear', checkedOn: '2026-01-05' }] as never,
      disciplineCount: 1,
    });
    expect(full.filter((f) => f.state === 'missing')).toEqual([]);
    expect(full.find((f) => f.key === 'employment')?.detail).toMatch(/en, ne/);
  });

  it('FWM sees foreign workers only; HR also sees missing contracts; the OM and other companies do not', async () => {
    const { svc, fwm, hr, om, cmArsh, ds } = await setup();
    const f = await svc.workerFiles(fwm, 'co-sasa');
    const np = ds.people.filter((p) => p.companyId === 'co-sasa' && p.nationality !== 'MY' && p.role !== 'office');
    expect(f.rows).toHaveLength(np.length);
    expect(f.contractsMissing).toBeNull();
    expect(Array.isArray((await svc.workerFiles(hr, 'co-sasa')).contractsMissing)).toBe(true);
    await expect(svc.workerFiles(om, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.workerFiles(cmArsh, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Yearly staff ethics declaration', () => {
  it('every statement ticked, interests declared or none, once a year; ACT reviews interests, never its own', async () => {
    const { svc, cm, act, hr, ds } = await setup();
    const keys = (await svc.ethicsBoard(cm)).statements.map((s) => s.key);
    expect((await svc.home(cm)).todo.some((t) => t.tag === 'Ethics')).toBe(true);
    await expect(svc.signEthicsDeclaration(cm, { statements: keys.slice(1), interestsNone: true })).rejects.toThrow(/tick every statement/);
    await expect(svc.signEthicsDeclaration(cm, { statements: keys })).rejects.toThrow(/Declare your interests/);
    await expect(svc.signEthicsDeclaration(cm, { statements: keys, interests: 'Brother runs a uniform supplier', interestsNone: true })).rejects.toThrow(/not both/);
    const d = await svc.signEthicsDeclaration(cm, { statements: keys, interests: 'Brother runs a uniform supplier (synthetic)' });
    await expect(svc.signEthicsDeclaration(cm, { statements: keys, interestsNone: true })).rejects.toThrow(/already signed/);
    expect((await svc.home(cm)).todo.some((t) => t.tag === 'Ethics')).toBe(false);
    await expect(svc.reviewEthicsInterests(hr, d.id, { action: 'managed', note: 'Brother excluded from uniform quotes' })).rejects.toBeInstanceOf(AccessDenied);
    const r = await svc.reviewEthicsInterests(act, d.id, { action: 'managed', note: 'Kept out of uniform supplier choice and quotes' });
    expect(r.review?.action).toBe('managed');
    const own = await svc.signEthicsDeclaration(act, { statements: keys, interests: 'Spouse works at an audit firm (synthetic)' });
    await expect(svc.reviewEthicsInterests(act, own.id, { action: 'no_conflict', note: 'Not a supplier of the group' })).rejects.toThrow(/Someone else/);
    // HR sees who signed and who has not, for the company.
    const list = (await svc.ethicsBoard(hr, 'co-sasa')).list!;
    expect(list.signed.map((x) => x.userId)).toContain(cm.id);
    expect(list.missing.length).toBe(ds.users.filter((u) => u.companyIds[0] === 'co-sasa' && !u.integration && !['guard', 'site_device'].includes(u.role)).length - 1);
  });
});

describe('The RBA committee', () => {
  it('only the Chief of Staff names the committee: the Operations Director and at least one company head', async () => {
    const { svc, cos, coo, od, cm, cmArsh } = await setup();
    expect((await svc.home(cos)).todo.some((t) => t.tag === 'RBA' && /committee/.test(t.title))).toBe(true);
    await expect(svc.nameRbaCommittee(coo, { memberUserIds: [od.id, cm.id] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.nameRbaCommittee(cos, { memberUserIds: [cm.id] })).rejects.toThrow(/Operations Director/);
    await expect(svc.nameRbaCommittee(cos, { memberUserIds: [od.id] })).rejects.toThrow(/company head/);
    const c1 = await svc.nameRbaCommittee(cos, { memberUserIds: [od.id, cm.id], note: 'First committee (synthetic)' });
    expect(c1.members.map((m) => m.seat)).toEqual(['ops_director', 'company_head']);
    expect((await svc.home(cos)).todo.some((t) => t.tag === 'RBA' && /committee/.test(t.title))).toBe(false);
    // A company head on the committee still reads only their own company; the Operations Director sees the group.
    const c2 = await svc.nameRbaCommittee(cos, { memberUserIds: [od.id, cm.id, cmArsh.id] });
    await expect(svc.rbaBoard(cmArsh, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.rbaBoard(cmArsh)).committee.current?.id).toBe(c2.id);
    expect((await svc.rbaBoard(od, 'co-sasa')).committee.current?.id).toBe(c2.id);
  });
});

describe('Speak-up reporter follow-up', () => {
  it('the handler and an anonymous reporter talk through the receipt code; retaliation reopens a closed report', async () => {
    const { svc, act, ds } = await setup();
    const staff = await svc.user('u-it-ex3');
    const chair = await svc.user('u-chair');
    const { code } = await svc.submitWhistle(staff, { anonymous: true, companyId: null, category: 'MISCONDUCT', summary: 'A supervisor asked guards for cash to get better shifts (synthetic report for testing).', implicatedUserIds: [] });
    const r = (await svc.grcBoard(act)).handled.find((h) => h.report.code === code)!;
    expect(r.report.reporterId).toBeNull();
    await expect(svc.whistleMessage(chair, r.report.id, 'Not the handler of this report')).rejects.toThrow();
    await svc.whistleMessage(act, r.report.id, 'Which site was this, and roughly when?');
    let st = await svc.whistleStatus(code);
    expect(st.status).toBe('acknowledged');
    expect(st.messages).toEqual([expect.objectContaining({ from: 'handler', text: 'Which site was this, and roughly when?' })]);
    await svc.whistleReply(staff, code, 'Port Klang site, the first week of October.', false);
    let h = (await svc.grcBoard(act)).handled.find((x) => x.report.code === code)!;
    expect(h.replyWaiting).toBe(true);
    expect((await svc.home(chair)).todo.some((t) => t.tag === 'Speak-up')).toBe(false);
    // Close with a second handler, then the reporter reports retaliation: it reopens and the handler is told.
    await svc.whistleStep(act, r.report.id, 'close', 'Supervisor warned and moved; guards repaid.');
    await svc.whistleReview(chair, r.report.id, true, 'Agreed, proof on file');
    st = await svc.whistleStatus(code);
    expect(st.status).toBe('closed');
    await expect(svc.whistleReply(staff, code, 'Another thought about the case', false)).rejects.toThrow(/closed/);
    await svc.whistleReply(staff, code, 'Since the report my shifts were cut to two a week.', true);
    st = await svc.whistleStatus(code);
    expect(st.status).toBe('investigating');
    h = (await svc.grcBoard(act)).handled.find((x) => x.report.code === code)!;
    expect(h.retaliation).toBe(true);
    // Nothing in the audit trail says who sent it or what it says.
    const lines = ds.audit.filter((x) => x.entityId === r.report.id);
    expect(lines.some((x) => /shifts were cut|Port Klang/.test(x.summary))).toBe(false);
    const ret = lines.filter((x) => x.action === 'grc.whistle.retaliation');
    expect(ret.length).toBe(1);
    expect(ret[0].actor).toBe('Speak-up channel');
  });
});
