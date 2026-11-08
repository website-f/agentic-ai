import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  IWAY_REQUIREMENTS,
  MemoryStore,
  PrimaService,
  breakPlanCheck,
  generateDataset,
  hoursReport,
  myt,
  roomProblems,
  selfAuditDue,
  selfAuditItems,
  type Attendance,
  type Person,
} from '../src';

// Synthetic data only. Client requirements and the yearly self-audit (Fauzan, 6 Nov 2026, after the IKEA IWAY audit).
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');
const png = (n: number) => `data:image/png;base64,${Buffer.from(`synthetic inspection photo ${n}`).toString('base64')}`;
const doc = (n: number) => ({ kind: 'document' as const, name: `proof-${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`synthetic proof ${n}`).toString('base64')}` });

async function setup(now = NOW) {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  const dev = await svc.user('u-dev-sasa-001');
  const site = ds.sites.find((s) => s.id === dev.siteIds[0])!;
  const om = await svc.user('u-om-klang');
  const act = await svc.user('u-audit');
  const cm = await svc.user('u-cm-sasa');
  const ae = await svc.user('u-ae-arsh');
  const photo = (n: number) => ({ kind: 'photo' as const, image: png(n), lat: site.lat, lng: site.lng, accuracyM: 8 });
  return { ds, svc, site, om, act, cm, ae, photo };
}

describe('Client code checklist on the client needs page', () => {
  it('IWAY list has unique numbers and every item says where proof is', () => {
    expect(IWAY_REQUIREMENTS.length).toBeGreaterThan(40);
    expect(new Set(IWAY_REQUIREMENTS.map((r) => r.code)).size).toBe(IWAY_REQUIREMENTS.length);
    for (const r of IWAY_REQUIREMENTS) expect(r.hint.length).toBeGreaterThan(3);
  });

  it('the covering OM or ACT switches IWAY on; the company manager and an OM elsewhere cannot', async () => {
    const { svc, site, om, act, cm } = await setup();
    const c = await svc.saveClientCode(om, site.id, { template: 'IWAY' });
    expect(c.name).toBe('IKEA IWAY');
    expect(c.hours?.maxWeekHours).toBe(60);
    expect(c.setBy.desk).toBe('ops');
    await expect(svc.saveClientCode(om, site.id, { template: 'IWAY' })).rejects.toThrow(/already on/);
    await expect(svc.saveClientCode(cm, site.id, { template: 'CUSTOM', name: 'Other client code', requirements: [{ code: 'X1', text: 'Something the client wants' }] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveClientCode(await svc.user('u-om-johor'), site.id, { template: 'IWAY' })).rejects.toBeInstanceOf(AccessDenied);
    const own = await svc.saveClientCode(act, site.id, { template: 'CUSTOM', name: 'Bank supplier code (sample)', requirements: [{ code: 'B1', text: 'Guards vetted every year' }], siteForm: ['Vetting letters on file at the post'] });
    expect(own.setBy.desk).toBe('act');
    expect(own.hours).toBeNull();
    expect(own.hostelForm).toEqual([]);
    // The company manager can read it; nothing is shown as met until checked.
    const b = await svc.clientCodeBoard(cm, site.id);
    expect(b.canKeep).toBe(false);
    const iway = b.codes.find((x) => x.code.id === c.id)!;
    expect(iway.counted.unknown).toBe(c.requirements.length);
    expect(iway.counted.met).toBe(0);
    // No hours check for a client that did not ask for one.
    expect(b.codes.find((x) => x.code.id === own.id)!.hours).toBeNull();
  });

  it('a check needs proof or where it is kept; not met needs what is wrong; history is kept', async () => {
    const { svc, site, om, act, photo } = await setup();
    const c = await svc.saveClientCode(om, site.id, { template: 'IWAY' });
    await expect(svc.checkClientRequirement(om, c.id, { reqCode: 'G4.4', result: 'met', note: '' })).rejects.toThrow(/proof/);
    await expect(svc.checkClientRequirement(om, c.id, { reqCode: 'G4.4', result: 'not_met', note: '' })).rejects.toThrow(/not met/);
    await expect(svc.checkClientRequirement(om, c.id, { reqCode: 'ZZ9', result: 'na', note: 'nothing' })).rejects.toThrow(/Unknown requirement/);
    await svc.checkClientRequirement(om, c.id, { reqCode: 'G4.4', result: 'not_met', note: 'No QR poster in Nepali at the hostel' });
    await svc.checkClientRequirement(act, c.id, { reqCode: 'G4.4', result: 'met', note: 'QR poster in Nepali, English and BM', proof: [photo(1)] });
    await svc.checkClientRequirement(om, c.id, { reqCode: 'G5.1', result: 'met', note: 'Attendance records in Prima, monthly recap' });
    const b = await svc.clientCodeBoard(om, site.id);
    const row = b.codes[0].rows.find((r) => r.code === 'G4.4')!;
    expect(row.check?.result).toBe('met');
    expect(row.check?.by.desk).toBe('act');
    expect(row.history).toBe(2);
    expect(b.codes[0].counted.met).toBe(2);
    expect(b.codes[0].counted.noProof).toBe(1);
  });

  it('changing a code needs a reason; a stopped code takes no more checks', async () => {
    const { svc, site, om } = await setup();
    const c = await svc.saveClientCode(om, site.id, { template: 'IWAY' });
    await expect(svc.saveClientCode(om, site.id, { codeId: c.id, template: 'IWAY', breakPlan: { count: 2, minutes: 30 } })).rejects.toThrow(/what changed/);
    const u = await svc.saveClientCode(om, site.id, { codeId: c.id, template: 'IWAY', breakPlan: { count: 2, minutes: 30 }, note: 'Two 30-minute breaks agreed with the client' });
    expect(u.breakPlan).toEqual({ count: 2, minutes: 30 });
    expect(u.changed).toHaveLength(1);
    await svc.stopClientCode(om, c.id, 'Contract ended');
    await expect(svc.checkClientRequirement(om, c.id, { reqCode: 'G5.1', result: 'met', note: 'Attendance records in Prima' })).rejects.toThrow(/stopped/);
  });
});

describe('Hours and break checks (only where the client asks)', () => {
  const person = (id: string): Person => ({ id, staffNo: id.toUpperCase(), name: `Guard ${id}` }) as Person;
  const day = (i: number) => `2026-10-${String(10 + i).padStart(2, '0')}`;
  const shift = (pid: string, d: string, hours: number, site = 's1'): Attendance =>
    ({ id: `${pid}-${d}-${site}`, companyId: 'c', siteId: site, shiftId: null, personId: pid, deviceId: 'd', clockIn: `${d}T07:00:00+08:00`, clockOut: new Date(Date.parse(`${d}T07:00:00+08:00`) + hours * 3_600_000).toISOString(), lat: null, lng: null, distanceM: null, photo: true, flags: [], locked: false }) as Attendance;
  const rule = { maxWeekHours: 60, maxDaysInRow: 6, breakAfterHours: 4.5, breakMinutes: 30 };

  it('flags more than 60 hours in 7 days, counting work at other sites too, and more than 6 days in a row', () => {
    const att = [
      ...[0, 1, 2, 3, 4].map((i) => shift('a', day(i), 12)), // 60 hours: allowed
      ...[0, 1, 2, 3, 4].map((i) => shift('b', day(i), 12)),
      shift('b', day(5), 4, 's2'), // 64 hours, the last day at another site
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => shift('c', day(i), 8)), // 7 days in a row
    ];
    const r = hoursReport(rule, 's1', [person('a'), person('b'), person('c')], att, [], '2026-10-20', '2026-10-20T10:00:00+08:00');
    expect(r.checked).toBe(3);
    expect(r.flags.filter((f) => f.personId === 'a')).toHaveLength(0);
    expect(r.flags.find((f) => f.personId === 'b' && f.kind === 'week_hours')?.value).toBe(64);
    expect(r.flags.find((f) => f.personId === 'c' && f.kind === 'days_in_row')?.value).toBe(7);
  });

  it('checks the break plan against the longest shift', () => {
    expect(breakPlanCheck(rule, null, 12).ok).toBeNull();
    expect(breakPlanCheck(rule, { count: 1, minutes: 30 }, 12).ok).toBe(false);
    expect(breakPlanCheck(rule, { count: 2, minutes: 20 }, 12).ok).toBe(false);
    expect(breakPlanCheck(rule, { count: 2, minutes: 30 }, 12).ok).toBe(true);
    expect(breakPlanCheck(rule, null, 4).ok).toBe(true);
  });

  it('the site board shows the hours check for an IWAY site', async () => {
    const { svc, site, om } = await setup();
    await svc.saveClientCode(om, site.id, { template: 'IWAY' });
    const b = await svc.clientCodeBoard(om, site.id);
    expect(b.codes[0].hours).not.toBeNull();
    expect(b.codes[0].hours!.breaks.needed).toBeGreaterThanOrEqual(0);
  });
});

describe('Site and hostel inspections from the client form', () => {
  it('room space follows the client rule', () => {
    const rule = { m2PerPerson: 3.8, minCeilingM: 2.1, maxPerRoom: 8 };
    expect(roomProblems(rule, [{ name: 'Master', areaM2: 16, ceilingM: 2.6, residents: 4 }])).toEqual([]);
    expect(roomProblems(rule, [{ name: 'Room 2', areaM2: 7, ceilingM: 2.0, residents: 2 }])[0].why).toMatch(/needs 7.6 m2.*ceiling 2/);
    expect(roomProblems(rule, [{ name: 'Hall', areaM2: 50, ceilingM: 3, residents: 9 }])[0].why).toMatch(/most is 8/);
  });

  it('every item is answered; items not right need a photo and stay open until fixed with proof', async () => {
    const { svc, site, om, cm, photo } = await setup();
    const c = await svc.saveClientCode(om, site.id, { template: 'IWAY' });
    const lines = (bad: number[]) => c.hostelForm.map((text, i) => ({ text, result: bad.includes(i) ? ('not_ok' as const) : ('ok' as const), note: bad.includes(i) ? 'Lock broken on room 2' : '' }));
    const rooms = [
      { name: 'Master', areaM2: 16, ceilingM: 2.6, residents: 4 },
      { name: 'Room 2', areaM2: 6, ceilingM: 2.6, residents: 2 },
    ];
    await expect(svc.saveClientInspection(om, c.id, { kind: 'hostel', place: 'Hostel A (sample)', lines: lines([]).slice(1), rooms })).rejects.toThrow(/Answer every item/);
    await expect(svc.saveClientInspection(om, c.id, { kind: 'hostel', place: 'Hostel A (sample)', lines: lines([]) })).rejects.toThrow(/Measure the rooms/);
    await expect(svc.saveClientInspection(om, c.id, { kind: 'hostel', place: 'Hostel A (sample)', lines: lines([7]), rooms })).rejects.toThrow(/photo/);
    const i = await svc.saveClientInspection(om, c.id, { kind: 'hostel', place: 'Hostel A (sample)', lines: lines([7]), rooms, proof: [photo(2)] });
    // The small room is added as an open item.
    expect(i.lines.filter((l) => l.result === 'not_ok')).toHaveLength(2);
    expect(i.ref).toMatch(/-HI001$/);
    await expect(svc.fixInspectionLine(cm, i.id, 7, { note: 'Lock replaced', proof: [photo(3)] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.fixInspectionLine(om, i.id, 7, { note: 'Lock replaced' })).rejects.toThrow(/Attach/);
    await svc.fixInspectionLine(om, i.id, 7, { note: 'Lock replaced', proof: [photo(3)] });
    await expect(svc.fixInspectionLine(om, i.id, 0, { note: 'Nothing', proof: [photo(4)] })).rejects.toThrow(/not marked/);
    const b = await svc.clientCodeBoard(om, site.id);
    expect(b.codes[0].inspections[0].open).toBe(1);
    expect(b.codes[0].lastHostelInspection).toBe(TODAY);
  });

  it('a client with no hostel form has no hostel inspection', async () => {
    const { svc, site, om } = await setup();
    const c = await svc.saveClientCode(om, site.id, { template: 'CUSTOM', name: 'Mall code (sample)', requirements: [{ code: 'M1', text: 'Guards trained in crowd control' }], siteForm: ['Crowd control plan at the post'] });
    await expect(svc.saveClientInspection(om, c.id, { kind: 'hostel', place: 'Hostel B', lines: [] })).rejects.toThrow(/no hostel inspection form/);
    const i = await svc.saveClientInspection(om, c.id, { kind: 'site', lines: [{ text: 'Crowd control plan at the post', result: 'ok' }] });
    expect(i.place).toContain(site.code);
  });
});

describe('Yearly self-audit by every company', () => {
  it('due dates and reminder states', () => {
    const r = [60, 30, 7];
    expect(selfAuditDue(null, '2026-10-26', 12, r).state).toBe('not_done');
    expect(selfAuditDue('2025-12-15', '2026-10-26', 12, r)).toMatchObject({ dueOn: '2026-12-15', daysLeft: 50, state: 'soon' });
    expect(selfAuditDue('2025-10-30', '2026-10-26', 12, r).state).toBe('due');
    expect(selfAuditDue('2025-10-01', '2026-10-26', 12, r).state).toBe('overdue');
    expect(selfAuditDue('2026-03-01', '2026-10-26', 12, r).state).toBe('ok');
  });

  it('the company does it; ACT watches; OM cannot; every item answered; reminders leave the home once done', async () => {
    const { svc, site, cm, ae, act, om } = await setup();
    const company = site.companyId;
    const before = await svc.home(cm, company);
    expect(before.todo.some((t) => t.tag === 'Self-audit' && /not done yet/.test(t.title))).toBe(true);
    const all = selfAuditItems('all');
    const answers = all.map((it) => ({ key: it.key, result: it.key === 'c.grievance' ? ('not_ok' as const) : ('ok' as const), note: it.key === 'c.grievance' ? 'No complaint form in Nepali' : '' }));
    await expect(svc.saveSelfAudit(om, company, { scope: 'all', lines: answers })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveSelfAudit(act, company, { scope: 'all', lines: answers })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.saveSelfAudit(cm, company, { scope: 'all', lines: answers.slice(1) })).rejects.toThrow(/Answer every item/);
    await expect(svc.saveSelfAudit(cm, company, { scope: 'site', lines: [] })).rejects.toThrow(/Choose the site/);
    // An admin executive of another company cannot do this company's self-audit.
    await expect(svc.saveSelfAudit(ae, company, { scope: 'all', lines: answers })).rejects.toBeInstanceOf(AccessDenied);
    const a = await svc.saveSelfAudit(cm, company, { scope: 'all', lines: answers, proof: [doc(1)] });
    expect(a.lines.find((l) => l.key === 'c.grievance')?.result).toBe('not_ok');
    const after = await svc.home(cm, company);
    expect(after.todo.some((t) => t.tag === 'Self-audit')).toBe(false);
    const b = await svc.selfAuditBoard(act, company);
    expect(b.canDo).toBe(false);
    expect(b.status.every((r) => r.state === 'ok')).toBe(true);
    expect(b.audits[0].open).toBe(1);
    await expect(svc.selfAuditBoard(om, company)).rejects.toBeInstanceOf(AccessDenied);
    await svc.fixSelfAuditLine(cm, a.id, 'c.grievance', { note: 'QR complaint form posted in Nepali, BM and English' });
    expect((await svc.selfAuditBoard(cm, company)).audits[0].open).toBe(0);
  });

  it('a self-audit of one site covers only that site', async () => {
    const { svc, site, cm, ds } = await setup();
    const lines = selfAuditItems('site').map((it) => ({ key: it.key, result: 'ok' as const }));
    await svc.saveSelfAudit(cm, site.companyId, { scope: 'site', siteId: site.id, lines });
    const b = await svc.selfAuditBoard(cm, site.companyId);
    expect(b.status.find((r) => r.siteId === site.id)?.state).toBe('ok');
    expect(b.status.find((r) => r.siteId === null)?.state).toBe('not_done');
    const other = ds.sites.find((s) => s.companyId === site.companyId && s.id !== site.id);
    if (other) expect(b.status.find((r) => r.siteId === other.id)?.state).toBe('not_done');
  });
});

describe('Whether a client gets a report (Fauzan, 8 Nov 2026: OD or OGM decides per client)', () => {
  it('the Operations Director decides for private sites, the OGM for government sites; nobody else', async () => {
    const { ds, svc, act, om, cm } = await setup();
    const od = await svc.user('u-opsdir');
    const ogm = await svc.user('u-ogm');
    const sasa = ds.sites.filter((s) => s.companyId === cm.companyIds[0]);
    const priv = sasa.find((s) => (s.sector ?? 'private') === 'private')!;
    const gov = sasa.find((s) => s.sector === 'government')!;
    const pc = await svc.saveClientCode(act, priv.id, { template: 'IWAY' });
    const gc = await svc.saveClientCode(act, gov.id, { template: 'IWAY' });
    expect(pc.clientReport).toBeNull();
    expect((await svc.clientCodeBoard(od, priv.id)).canDecideReport).toBe(true);
    expect((await svc.clientCodeBoard(od, gov.id)).canDecideReport).toBe(false);
    expect((await svc.clientCodeBoard(om, priv.id)).canDecideReport).toBe(false);
    // The wrong side, the code keepers and the company manager are refused.
    for (const [u, id] of [[ogm, pc.id], [od, gc.id], [om, pc.id], [act, pc.id], [cm, pc.id]] as const) {
      await expect(svc.setClientReport(u, id, { send: true, how: 'Monthly with the client report', reason: 'Client asked for it' })).rejects.toThrow();
    }
    // A reason is needed, and how it goes when it is sent.
    await expect(svc.setClientReport(od, pc.id, { send: true, how: '', reason: 'Client asked for it' })).rejects.toThrow(/how/i);
    await expect(svc.setClientReport(od, pc.id, { send: false, reason: '' })).rejects.toThrow(/reason/i);
    const sent = await svc.setClientReport(od, pc.id, { send: true, how: 'Monthly with the client report', reason: 'IKEA asks for the IWAY status each month' });
    expect(sent.clientReport).toMatchObject({ send: true, how: 'Monthly with the client report', byId: 'u-opsdir' });
    const kept = await svc.setClientReport(ogm, gc.id, { send: false, reason: 'Internal check only for this ministry site' });
    expect(kept.clientReport).toMatchObject({ send: false, how: '', byId: 'u-ogm' });
    // A later change to the code keeps the decision.
    const changed = await svc.saveClientCode(act, priv.id, { template: 'IWAY', codeId: pc.id, note: 'Client sent version 6.1' });
    expect(changed.clientReport?.send).toBe(true);
    const board = await svc.clientCodeBoard(cm, priv.id);
    expect(board.codes[0].code.clientReport?.send).toBe(true);
  });
});
