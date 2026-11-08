import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  addDays,
  compareAttendance,
  compareHostels,
  compareIncidents,
  comparePayroll,
  generateDataset,
  parseJaImportRows,
} from '../src';

// Synthetic data only: the generated mock dataset and made-up JA rows.
const TODAY = '2026-11-05';
const NOW = '2026-11-05T10:00:00+08:00';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

describe('JA export rows', () => {
  it('keeps only the columns Prima uses and refuses bad, duplicate and full-IC rows with their line', () => {
    const out = parseJaImportRows('attendance', [
      { staffNo: 'G1', date: '2026-10-01', status: 'present', hours: '12', siteCode: 'S1', phone: '012' },
      { staffNo: 'G1', date: '2026-10-01', status: 'present', hours: 12 },
      { staffNo: 'G2', date: '2026-02-30', status: 'present', hours: 12 },
      { staffNo: 'G3', date: '2026-10-01', status: 'sick', hours: 12 },
      { staffNo: '880101-14-5566', date: '2026-10-01', status: 'off' },
      { staffNo: 'G4', date: '2026-10-01', status: 'present' },
      { staffNo: 'G5', date: '2026-10-01', status: 'Absent' },
    ]);
    expect(out.rows.map((r) => (r.kind === 'attendance' ? `${r.staffNo}:${r.status}` : ''))).toEqual(['G1:present', 'G5:absent']);
    expect(out.lines).toEqual([1, 7]);
    expect(out.ignoredColumns).toEqual(['phone']);
    expect(out.refused.map((r) => r.line)).toEqual([2, 3, 4, 5, 6]);
    expect(out.refused.find((r) => r.line === 5)!.reason).toMatch(/full IC/);
  });

  it('checks payslip sums and incident fields', () => {
    const pay = parseJaImportRows('payslips', [
      { staffNo: 'G1', period: '2026-10', gross: 'RM1,900.00', net: 1700, epf: 209, socso: 9.75, eis: 3.9, pcb: 0 },
      { staffNo: 'G2', period: '2026-13', gross: 1, net: 1, epf: 0, socso: 0, eis: 0, pcb: 0 },
      { staffNo: 'G3', period: '2026-10', gross: 100, net: 200, epf: 0, socso: 0, eis: 0, pcb: 0 },
    ]);
    expect(pay.rows).toHaveLength(1);
    expect(pay.rows[0]).toMatchObject({ gross: 1900, net: 1700 });
    const inc = parseJaImportRows('incidents', [
      { externalId: 'A', occurredAt: '2026-10-01T02:00:00+08:00', siteCode: 'S1', category: 'Theft', severity: 'p2', status: 'open', summary: 'x' },
      { externalId: 'B', occurredAt: '2026-10-01', siteCode: 'S1', category: 'Theft', severity: 'P2', status: 'open', summary: 'x' },
      { externalId: 'C', occurredAt: '2026-10-01T02:00:00+08:00', category: 'Theft', severity: 'P9', status: 'open', summary: 'x' },
    ]);
    expect(inc.rows.map((r) => (r.kind === 'incidents' ? r.severity : ''))).toEqual(['P2']);
    expect(inc.refused).toHaveLength(2);
  });
});

describe('side-by-side comparisons', () => {
  it('attendance: hours past the tolerance, present on one side only; both absent matches', () => {
    const r = compareAttendance(
      [
        { kind: 'attendance', staffNo: 'A', date: '2026-10-01', status: 'present', hours: 12, siteCode: null },
        { kind: 'attendance', staffNo: 'B', date: '2026-10-01', status: 'present', hours: 12, siteCode: null },
        { kind: 'attendance', staffNo: 'C', date: '2026-10-01', status: 'present', hours: 12, siteCode: null },
        { kind: 'attendance', staffNo: 'D', date: '2026-10-01', status: 'leave', hours: null, siteCode: null },
        { kind: 'attendance', staffNo: 'E', date: '2026-10-01', status: 'off', hours: null, siteCode: null },
      ],
      [
        { staffNo: 'A', date: '2026-10-01', present: true, hours: 12.2 },
        { staffNo: 'B', date: '2026-10-01', present: true, hours: 11 },
        { staffNo: 'D', date: '2026-10-01', present: true, hours: 12 },
        { staffNo: 'F', date: '2026-10-01', present: true, hours: 12 },
      ],
      0.25,
    );
    expect(r.matched).toBe(2);
    expect(r.differences.map((d) => [d.subject, d.what])).toEqual([
      ['B', 'Hours differ'],
      ['C', 'Present in JA, no clock-in in Prima'],
      ['D', 'JA says leave, Prima has a clock-in'],
      ['F', 'Clock-in in Prima, nothing in JA'],
    ]);
  });

  it('incidents match by site within the window, nearest first, and flag severity or state', () => {
    const ja = [
      { kind: 'incidents' as const, externalId: 'J1', occurredAt: '2026-10-01T10:00:00+08:00', siteCode: 'S1', category: 'x', severity: 'P2' as const, status: 'open' as const, summary: 'x' },
      { kind: 'incidents' as const, externalId: 'J2', occurredAt: '2026-10-01T10:30:00+08:00', siteCode: 'S1', category: 'x', severity: 'P3' as const, status: 'closed' as const, summary: 'x' },
      { kind: 'incidents' as const, externalId: 'J3', occurredAt: '2026-10-02T10:00:00+08:00', siteCode: 'S2', category: 'x', severity: 'P3' as const, status: 'open' as const, summary: 'x' },
    ];
    const prima = [
      { ref: 'C1', siteCode: 'S1', at: '2026-10-01T10:05:00+08:00', severity: 'P2' as const, closed: false },
      { ref: 'C2', siteCode: 'S1', at: '2026-10-01T10:31:00+08:00', severity: 'P2' as const, closed: true },
      { ref: 'C3', siteCode: 'S9', at: '2026-10-02T10:00:00+08:00', severity: 'P3' as const, closed: false },
    ];
    const r = compareIncidents(ja, prima, 60);
    expect(r.matched).toBe(1);
    expect(r.differences.map((d) => d.what)).toEqual(['Same incident, severity differ', 'In JA, not in Prima', 'In Prima, not in JA']);
  });

  it('pay matches to the sen; hostels compare by name, ignoring case and spaces', () => {
    const p = { staffNo: 'A', period: '2026-10', gross: 1900, net: 1700, epf: 209, socso: 9.75, eis: 3.9, pcb: 0 };
    expect(comparePayroll([{ kind: 'payslips', ...p }], [p]).matched).toBe(1);
    const off = comparePayroll([{ kind: 'payslips', ...p }], [{ ...p, net: 1699.99 }]);
    expect(off.differences[0].what).toBe('net differ for 2026-10');
    expect(comparePayroll([{ kind: 'payslips', ...p }], []).differences[0].what).toMatch(/no Prima payslip/);
    const h = compareHostels(
      [
        { kind: 'hostels', staffNo: 'A', month: '2026-10', hostel: 'Hostel  Sasa 1' },
        { kind: 'hostels', staffNo: 'B', month: '2026-10', hostel: 'Hostel Sasa 2' },
      ],
      [
        { staffNo: 'A', month: '2026-10', hostel: 'hostel sasa 1' },
        { staffNo: 'B', month: '2026-10', hostel: 'Hostel Sasa 3' },
      ],
    );
    expect([h.matched, h.differences.length]).toEqual([1, 1]);
  });
});

describe('switch-over board and access', () => {
  it('shows the Sasa sample runs with real differences and keeps the JA feed screen unchanged', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const b = await svc.jaSwitchBoard(ceo);
    const sasa = b.rows.filter((r) => r.companyId === 'co-sasa');
    const att = sasa.find((r) => r.area === 'attendance')!;
    expect(att.state).toBe('side_by_side');
    // Other integrated modules add attendance samples; retain the original three discrepancies, never assume a closed seed count.
    expect(att.summary!.differences).toBeGreaterThanOrEqual(3);
    const report = await svc.jaSwitchReport(ceo, 'co-sasa', 'attendance');
    expect(att.summary!.differences).toBe(report.comparison!.differences.length);
    expect(att.summary!.explained).toBe(1);
    expect(att.summary!.jaMissingDays).toBe(0);
    expect(att.canSwitch).toBe(false);
    const inc = sasa.find((r) => r.area === 'incidents')!;
    expect(inc.summary!.differences).toBeGreaterThanOrEqual(1);
    expect(sasa.find((r) => r.area === 'payroll')!.state).toBe('ja');
    expect(b.imports.find((i) => i.kind === 'guards')!.decision).toBeNull();
    // The JA feed screen reads only its own datasets.
    const ja = await svc.jaBoard(ceo);
    expect(ja.incidents.every((i) => i.externalId.startsWith('INC-'))).toBe(true);
  });

  it('refuses guards, supervisors, admin executives and site devices; a company manager sees only their company', async () => {
    const { svc, ds } = fresh();
    for (const role of ['guard', 'supervisor', 'admin_exec', 'site_device'] as const) {
      const u = ds.users.find((x) => x.role === role)!;
      await expect(svc.jaSwitchBoard(await svc.user(u.id))).rejects.toThrow(/Not allowed/);
    }
    const cm = await svc.jaSwitchBoard(await svc.user('u-cm-sasa'));
    expect([...new Set(cm.rows.map((r) => r.companyId))]).toEqual(['co-sasa']);
    expect(cm.canStage).toBe(false);
    await expect(svc.jaImportStage(await svc.user('u-cm-sasa'), { companyId: 'co-sasa', kind: 'patrol', from: '2026-10-01', to: '2026-10-01', fileName: 'x.csv', rows: [{ siteCode: 'X', date: '2026-10-01', scans: 1 }] })).rejects.toThrow(/Not allowed/);
    await expect(svc.jaSwitchReport(await svc.user('u-cm-sasa'), 'co-arsh', 'incidents')).rejects.toThrow(/Not allowed/);
  });

  it('cannot compare or switch guard pay while Prima has no guard pay run', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    await svc.jaSwitchAct(coo, 'co-arsh', 'payroll', 'start', { from: addDays(TODAY, -40), note: 'Pay side by side' });
    const r = await svc.jaSwitchReport(await svc.user('u-audit'), 'co-arsh', 'payroll');
    expect(r.comparison!.primaReady).toBe(false);
    expect(r.comparison!.primaNote).toMatch(/No COO-approved Prima guard pay run yet for 2026-09, 2026-10/);
    await expect(svc.jaSwitchAct(await svc.user('u-audit'), 'co-arsh', 'payroll', 'check', { reportHash: r.reportHash })).rejects.toThrow(/guard pay run/);
  });
});

describe('the switch-over numbers', () => {
  it('only the ACT Director sets them, within limits and with a reason; a run keeps the numbers it started with', async () => {
    const { svc, ds } = fresh();
    const director = await svc.user('u-audit');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    expect((await svc.jaSwitchBoard(director)).canSetSettings).toBe(true);
    expect((await svc.jaSwitchBoard(ceo)).canSetSettings).toBe(false);
    for (const who of ['u-fauzan', 'u-coo', 'u-act-aud2', 'u-act-aud1'])
      await expect(svc.jaSwitchSettings(await svc.user(who), { values: { sideBySideDays: 20 }, reason: 'Shorter pilot please' })).rejects.toThrow(/Not allowed/);
    await expect(svc.jaSwitchSettings(director, { values: { sideBySideDays: 20 }, reason: 'short' })).rejects.toThrow(/reason/);
    await expect(svc.jaSwitchSettings(director, { values: { sideBySideDays: 3 }, reason: 'Shorter pilot please' })).rejects.toThrow(/from 7 to 92/);
    await expect(svc.jaSwitchSettings(director, { values: { jaReadOnlyDays: 45.5 }, reason: 'Shorter pilot please' })).rejects.toThrow(/whole number/);

    // A run started before the change keeps 30 days.
    await svc.jaSwitchAct(coo, 'co-arsh', 'attendance', 'start', { from: addDays(TODAY, -2), note: 'Before the change' });
    const set = await svc.jaSwitchSettings(director, { values: { sideBySideDays: 14, jaReadOnlyDays: 120, hoursTolerance: 0.5, payToleranceRm: 1 }, reason: 'Two weeks is enough for small companies' });
    expect(set).toMatchObject({ sideBySideDays: 14, jaReadOnlyDays: 120, hoursTolerance: 0.5, payToleranceRm: 1, incidentMatchMin: 60 });
    await svc.jaSwitchAct(coo, 'co-arsh', 'patrol', 'start', { from: addDays(TODAY, -2), note: 'After the change' });
    const old = await svc.jaSwitchReport(director, 'co-arsh', 'attendance');
    const fresh14 = await svc.jaSwitchReport(director, 'co-arsh', 'patrol');
    expect(old.run!.to).toBe(addDays(TODAY, 27));
    expect(fresh14.run!.to).toBe(addDays(TODAY, 11));
    expect(fresh14.run!.settings!.jaReadOnlyDays).toBe(120);
    const board = await svc.jaSwitchBoard(await svc.user('u-coo'));
    expect(board.settings.sideBySideDays).toBe(14);
    expect(board.canSetSettings).toBe(false);
    // A company sign-in does not read the group record; it sees each run's own numbers in the report instead.
    const cm = await svc.jaSwitchBoard(await svc.user('u-cm-sasa'));
    expect(cm.settingsShown).toBe(false);
    expect(cm.settingsHistory).toEqual([]);
    expect((await svc.jaSwitchBoard(director)).settingsHistory[0]).toMatchObject({ by: director.name, reason: 'Two weeks is enough for small companies' });
    expect(ds.audit.some((a) => a.action === 'ja.switch.settings')).toBe(true);
  });
});

describe('guard pay side by side on test data', () => {
  it('compares the COO-approved Prima pay run with the JA payslips, to the tolerance the ACT Director set, then switches', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const stager = await svc.user('u-act-aud1');
    const lead = await svc.user('u-audit');
    const deputy = await svc.user('u-audit');
    for (const p of ds.people) if (!p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****9999' };
    const from = '2026-10-01';
    const to = '2026-10-30';
    await svc.jaSwitchSettings(lead, { values: { payToleranceRm: 0.5 }, reason: 'JA rounds net pay to 50 sen' });
    await svc.jaSwitchAct(coo, 'co-arsh', 'payroll', 'start', { from, note: 'Arrow Shield pay side by side' });

    // HR prepares October, the COO approves it.
    const run = await svc.prepareGuardPay(hr, 'co-arsh', '2026-10', []);
    let r = await svc.jaSwitchReport(lead, 'co-arsh', 'payroll');
    expect(r.comparison!.primaReady).toBe(false);
    await svc.guardPayStep(hr, run.id, 'submit');
    await svc.guardPayStep(coo, run.id, 'approve', { note: 'Side-by-side month checked' });

    // The JA payslips for the same guards: one RM0.30 rounding (inside the tolerance), one RM25 overtime gap, one guard JA does not pay.
    const lines = run.lines.filter((l) => l.gross > 0);
    expect(lines.length).toBeGreaterThan(3);
    const rows = lines.slice(1).map((l, i) => ({
      staffNo: l.staffNo,
      period: '2026-10',
      gross: i === 1 ? l.gross + 25 : l.gross,
      net: i === 0 ? Math.round((l.net + 0.3) * 100) / 100 : i === 1 ? l.net + 25 : l.net,
      epf: l.epfEe,
      socso: l.socsoEe,
      eis: l.eisEe,
      pcb: l.pcb,
    }));
    const staged = await svc.jaImportStage(stager, { companyId: 'co-arsh', kind: 'payslips', from, to, fileName: 'arsh-payslips-2026-10.csv', rows });
    await svc.jaImportDecide(deputy, staged.id, { decision: 'approve', fileHash: staged.fileHash, note: 'Matches the JA October payroll' });

    r = await svc.jaSwitchReport(lead, 'co-arsh', 'payroll');
    const c = r.comparison!;
    expect(c.primaReady).toBe(true);
    expect(c.jaMissingDays).toEqual([]);
    expect(c.differences.map((d) => d.key).sort()).toEqual([`payroll:${lines[0].staffNo}:2026-10`, `payroll:${lines[2].staffNo}:2026-10`].sort());
    expect(c.matched).toBe(lines.length - 2);
    for (const d of c.differences) await svc.jaSwitchAct(hr, 'co-arsh', 'payroll', 'explain', { key: d.key, kind: 'explained', note: 'JA missed a late overtime entry' });
    r = await svc.jaSwitchReport(lead, 'co-arsh', 'payroll');
    await svc.jaSwitchAct(lead, 'co-arsh', 'payroll', 'check', { reportHash: r.reportHash, note: 'Two pay differences explained' });
    const done = await svc.jaSwitchAct(ceo, 'co-arsh', 'payroll', 'switch', { reportHash: r.reportHash, reason: 'One month of guard pay matched' });
    expect(done.state).toBe('prima');

    // A later change to the tolerance does not move the checked report.
    await svc.jaSwitchSettings(lead, { values: { payToleranceRm: 0 }, reason: 'Pay must now match to the sen' });
    expect((await svc.jaSwitchReport(lead, 'co-arsh', 'payroll')).reportHash).toBe(r.reportHash);
  });
});

describe('a full switch of one area', () => {
  it('runs 30 days, needs JA data for every day, every difference explained, an ACT check, then only the CEO switches; undo works', async () => {
    const { svc, ds } = fresh();
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const stager = await svc.user('u-act-aud1');
    const lead = await svc.user('u-audit');
    const deputy = await svc.user('u-audit');
    const from = addDays(TODAY, -35);
    const to = addDays(from, 29);

    await expect(svc.jaSwitchAct(stager, 'co-arsh', 'incidents', 'start', { from })).rejects.toThrow(/Not allowed/);
    await expect(svc.jaSwitchAct(coo, 'co-arsh', 'incidents', 'start', { from: addDays(TODAY, -90) })).rejects.toThrow(/within 62 days/);
    await svc.jaSwitchAct(coo, 'co-arsh', 'incidents', 'start', { from, note: 'Arrow Shield incidents pilot' });
    await expect(svc.jaSwitchAct(coo, 'co-arsh', 'incidents', 'start', { from })).rejects.toThrow(/already going/);

    // No JA file yet: every day is unknown and ACT cannot check.
    let r = await svc.jaSwitchReport(lead, 'co-arsh', 'incidents');
    expect(r.comparison!.to).toBe(to);
    expect(r.comparison!.jaMissingDays).toHaveLength(30);
    await expect(svc.jaSwitchAct(lead, 'co-arsh', 'incidents', 'check', { reportHash: r.reportHash })).rejects.toThrow(/missing for 30 day/);

    // Stage the JA file; the stager and an assistant cannot approve it.
    const site = ds.sites.find((s) => s.companyId === 'co-arsh')!;
    const rows = [{ externalId: 'ARSH-1', occurredAt: `${addDays(from, 3)}T03:15:00+08:00`, siteCode: site.code, category: 'Theft', severity: 'P2', status: 'closed', summary: 'Cable missing', ic_full: 'not kept' }];
    const staged = await svc.jaImportStage(stager, { companyId: 'co-arsh', kind: 'incidents', from, to, fileName: 'arsh-incidents.csv', rows });
    expect(staged.ignoredColumns).toEqual(['ic_full']);
    await expect(svc.jaImportStage(stager, { companyId: 'co-arsh', kind: 'incidents', from, to, fileName: 'again.csv', rows })).rejects.toThrow(/already staged/);
    await expect(svc.jaImportDecide(stager, staged.id, { decision: 'approve', fileHash: staged.fileHash, note: 'ok' })).rejects.toThrow(/Not allowed/);
    await expect(svc.jaImportDecide(deputy, staged.id, { decision: 'approve', fileHash: 'wrong', note: 'ok' })).rejects.toThrow(/fingerprint/);
    expect(await svc.jaImportDecide(deputy, staged.id, { decision: 'approve', fileHash: staged.fileHash, note: 'Checked against JA' })).toEqual({ decision: 'approved', written: 1 });
    await expect(svc.jaImportDecide(lead, staged.id, { decision: 'approve', fileHash: staged.fileHash, note: 'again' })).rejects.toThrow(/already approved/);

    // Now one difference remains open.
    r = await svc.jaSwitchReport(lead, 'co-arsh', 'incidents');
    expect(r.comparison!.jaMissingDays).toEqual([]);
    expect(r.comparison!.total).toBe(1);
    expect(r.comparison!.differences[0].what).toBe('In JA, not in Prima');
    await expect(svc.jaSwitchAct(lead, 'co-arsh', 'incidents', 'check', { reportHash: r.reportHash })).rejects.toThrow(/not explained/);
    await expect(svc.jaSwitchAct(lead, 'co-arsh', 'incidents', 'explain', { key: r.comparison!.differences[0].key, kind: 'explained', note: 'Reported only in JA' })).rejects.toThrow(/Not allowed/);
    await expect(svc.jaSwitchAct(coo, 'co-arsh', 'incidents', 'explain', { key: 'incidents:nope', kind: 'explained', note: 'This does not exist' })).rejects.toThrow(/not in the current report/);
    await svc.jaSwitchAct(coo, 'co-arsh', 'incidents', 'explain', { key: r.comparison!.differences[0].key, kind: 'explained', note: 'Guard reported it in JA only; Prima case to be opened from now.' });

    // ACT checks the exact report; the CEO, not the COO, switches.
    r = await svc.jaSwitchReport(lead, 'co-arsh', 'incidents');
    expect(r.canCheck).toBe(true);
    await expect(svc.jaSwitchAct(ceo, 'co-arsh', 'incidents', 'switch', { reportHash: r.reportHash, reason: 'All differences explained' })).rejects.toThrow(/checked by ACT first/);
    await expect(svc.jaSwitchAct(lead, 'co-arsh', 'incidents', 'check', { reportHash: 'stale' })).rejects.toThrow(/changed since you opened/);
    await svc.jaSwitchAct(lead, 'co-arsh', 'incidents', 'check', { reportHash: r.reportHash, note: 'One JA-only incident, explained' });
    await expect(svc.jaSwitchAct(coo, 'co-arsh', 'incidents', 'switch', { reportHash: r.reportHash, reason: 'All differences explained' })).rejects.toThrow(/Not allowed/);

    // A later JA file changes the report, so the check no longer holds.
    const more = await svc.jaImportStage(stager, {
      companyId: 'co-arsh',
      kind: 'incidents',
      from,
      to,
      fileName: 'arsh-incidents-2.csv',
      rows: [...rows, { externalId: 'ARSH-2', occurredAt: `${addDays(from, 5)}T03:15:00+08:00`, siteCode: site.code, category: 'Fire', severity: 'P1', status: 'closed', summary: 'Bin fire' }],
    });
    expect(more.counts).toEqual({ new: 1, same: 1, changed: 0 });
    await svc.jaImportDecide(lead, more.id, { decision: 'approve', fileHash: more.fileHash, note: 'Second export' });
    await expect(svc.jaSwitchAct(ceo, 'co-arsh', 'incidents', 'switch', { reportHash: r.reportHash, reason: 'All differences explained' })).rejects.toThrow(/changed after ACT checked/);
    r = await svc.jaSwitchReport(lead, 'co-arsh', 'incidents');
    await svc.jaSwitchAct(coo, 'co-arsh', 'incidents', 'explain', { key: 'incidents:ARSH-2', kind: 'fixed', note: 'Case opened in Prima for the bin fire.' });
    r = await svc.jaSwitchReport(lead, 'co-arsh', 'incidents');
    await svc.jaSwitchAct(deputy, 'co-arsh', 'incidents', 'check', { reportHash: r.reportHash, note: 'Rechecked' });

    await expect(svc.jaSwitchAct(ceo, 'co-arsh', 'incidents', 'switch', { reportHash: r.reportHash, reason: 'short' })).rejects.toThrow(/reason/);
    const done = await svc.jaSwitchAct(ceo, 'co-arsh', 'incidents', 'switch', { reportHash: r.reportHash, reason: 'One month matched, all explained' });
    expect(done.state).toBe('prima');
    expect(done.switched!.jaReadOnlyUntil).toBe(addDays(TODAY, 92));
    expect(await svc.jaSystemOfRecord('co-arsh', 'incidents')).toBe('prima');
    expect(await svc.jaSystemOfRecord('co-arsh', 'attendance')).toBe('ja');
    expect(ds.audit.some((a) => a.action === 'ja.switch.switch' && a.companyId === 'co-arsh')).toBe(true);

    await expect(svc.jaSwitchAct(coo, 'co-arsh', 'incidents', 'undo', { reason: 'JA needed again' })).rejects.toThrow(/Not allowed/);
    const back = await svc.jaSwitchAct(ceo, 'co-arsh', 'incidents', 'undo', { reason: 'Prima incident screen needs more training first' });
    expect(back.state).toBe('ja');
    expect(await svc.jaSystemOfRecord('co-arsh', 'incidents')).toBe('ja');
    const hist = await svc.jaSwitchReport(ceo, 'co-arsh', 'incidents');
    expect(hist.history.map((h) => h.action)).toEqual(['start', 'check', 'check', 'switch', 'undo']);
  });

  it('an ACT checker who did not take part is needed, and a rejected file writes nothing', async () => {
    const { svc } = fresh();
    const stager = await svc.user('u-act-aud1');
    const lead = await svc.user('u-audit');
    const s = await svc.jaImportStage(stager, {
      companyId: 'co-arsh',
      kind: 'patrol',
      from: '2026-10-01',
      to: '2026-10-02',
      fileName: 'p.csv',
      rows: [
        { siteCode: 'X1', date: '2026-10-01', scans: '12' },
        { siteCode: 'X1', date: '2026-10-09', scans: '12' },
      ],
    });
    expect(s.kept).toBe(1);
    expect(s.refused).toBe(1);
    await expect(svc.jaImportDecide(lead, s.id, { decision: 'reject', fileHash: s.fileHash, note: 'short' })).rejects.toThrow(/note/);
    expect(await svc.jaImportDecide(lead, s.id, { decision: 'reject', fileHash: s.fileHash, note: 'Wrong site codes in this export' })).toEqual({ decision: 'rejected', written: 0 });
    const b = await svc.jaSwitchBoard(lead);
    expect(b.history.patrol).toBe(0);
  });
});

describe('guard history from JA', () => {
  it('imports guard records and pay; unknown staff are listed, never created; pay is shown only to those who may see it', async () => {
    const { svc, ds } = fresh();
    const it = await svc.user('u-act-aud1');
    await expect(svc.jaSwitchBoard(await svc.user('u-it-lead'))).rejects.toThrow(/Not allowed/);
    const deputy = await svc.user('u-audit');
    const guard = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard')!;
    const peopleBefore = ds.people.length;
    const g = await svc.jaImportStage(it, {
      companyId: 'co-sasa',
      kind: 'guards',
      from: '2025-01-01',
      to: '2026-10-31',
      fileName: 'guards.csv',
      rows: [
        { staffNo: guard.staffNo, name: guard.name, nationality: 'Malaysia', status: 'active', joinedOn: '2024-01-02', rank: 'Guard' },
        { staffNo: 'GONE-1', name: 'Left guard (mock)', nationality: 'Malaysia', status: 'left', joinedOn: '2023-01-02', leftOn: '2024-06-30' },
      ],
    });
    expect(g.unknownStaff).toBe(1);
    await svc.jaImportDecide(deputy, g.id, { decision: 'approve', fileHash: g.fileHash, note: 'Checked' });
    const p = await svc.jaImportStage(it, {
      companyId: 'co-sasa',
      kind: 'payslips',
      from: '2026-09-01',
      to: '2026-10-31',
      fileName: 'pay.csv',
      rows: [
        { staffNo: guard.staffNo, period: '2026-09', gross: 1900, net: 1700, epf: 209, socso: 9.75, eis: 3.9, pcb: 0 },
        { staffNo: guard.staffNo, period: '2026-10', gross: 2000, net: 1790, epf: 220, socso: 9.75, eis: 3.9, pcb: 0 },
      ],
    });
    await svc.jaImportDecide(deputy, p.id, { decision: 'approve', fileHash: p.fileHash, note: 'Checked' });
    expect(ds.people.length).toBe(peopleBefore);
    const hr = await svc.jaGuardHistory(await svc.user('u-pwvsb-hr'), 'co-sasa', guard.staffNo);
    expect(hr.guard!.name).toBe(guard.name);
    expect(hr.payslips!.map((x) => x.period)).toEqual(['2026-10', '2026-09']);
    const omView = await svc.jaGuardHistory(await svc.user('u-om-klang'), 'co-sasa', guard.staffNo);
    expect(omView.guard!.staffNo).toBe(guard.staffNo);
    expect(omView.payslips).toBeNull();
    expect((await svc.jaGuardHistory(await svc.user('u-cm-sasa'), 'co-sasa', guard.staffNo)).payslips).toHaveLength(2);
    expect(ds.audit.filter((a) => a.action === 'ja.import.approve').length).toBeGreaterThanOrEqual(2);
  });
});
