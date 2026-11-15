// Part Y (Fitri package, monthly JA Group meeting and duty checklists, Fauzan's answers Y-Q1..Y-Q10, 14 Nov 2026).
// Made-up data only, in memory. PostgreSQL is tested apart in apps/api/test/group-month-pg.test.ts.
import { describe, expect, it } from 'vitest';
import { AccessDenied, GROUP_EMPLOYER_ID, GroupMonthService, MemoryStore, PrimaService, RULES, generateDataset, myt, type User } from '../src';

const TODAY = '2026-11-20';

function fresh(today = TODAY) {
  const ds = generateDataset({ today, now: myt(today, '10:00') });
  const cm = ds.users.find((u) => u.id === 'u-cm-sasa')!;
  ds.users.push({ ...cm, id: 'u-dir-test', name: 'Director T (test)', role: 'director', title: 'Pengarah' } as User);
  const store = new MemoryStore(ds);
  const clock = { now: myt(today, '10:00') };
  const svc = new PrimaService(store, () => clock.now);
  const act = async (uid: string, op: string, i: Record<string, unknown> = {}) => svc.groupMonthAct(await svc.user(uid), op, i);
  const tbx = async (uid: string, op: string, i: Record<string, unknown>) => svc.toolboxAct(await svc.user(uid), op, i);
  const at = (d: string, t = '10:00') => (clock.now = myt(d, t));
  return { ds, svc, act, tbx, at, clock };
}
const SC = 'co:co-sasa';

describe('Part Y monthly group meeting', () => {
  it('Y1/Y2/Y3/Y8: report from the verified toolbox pack, own sections, verified by the company manager, SULIT cut, deadline and the board', async () => {
    const { svc, act, tbx, at } = fresh();
    // A verified Part X toolbox meeting in November (the pack the monthly report reuses).
    const m = await svc.scheduleMeeting(await svc.user('u-cm-sasa'), { companyId: null, kind: 'toolbox', title: 'Toolbox (test)', start: myt('2026-11-19', '09:00'), end: myt('2026-11-19', '10:00'), location: 'HQ', attendees: [], agenda: 'Standard', seriesKey: 'co-office:co-sasa', attendeeIds: [] });
    await tbx('u-ae-sasa', 'build', { meetingId: m.id });
    await tbx('u-ae-sasa', 'draft', { meetingId: m.id, text: 'Minit toolbox (test). Semua seksyen dibincang.', ticks: Object.fromEntries(RULES.toolbox.value.agenda.company.map((x) => [x.key, 'nochange'])) });
    await tbx('u-ae-sasa', 'submit', { meetingId: m.id });
    await tbx('u-cm-sasa', 'verify', { meetingId: m.id, comment: 'Disahkan (test)' });

    at('2026-12-02');
    // Unit HR sets the meeting date; it must be after the month reported.
    await expect(act('u-ae-sasa', 'setMeeting', { period: '2026-11', meetingOn: '2026-12-14' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(act('u-pwvsb-hr', 'setMeeting', { period: '2026-11', meetingOn: '2026-11-28' })).rejects.toThrow(/after that month/);
    await act('u-pwvsb-hr', 'setMeeting', { period: '2026-11', meetingOn: '2026-12-14' });
    await act('u-pwvsb-hr', 'logistics', { period: '2026-11', invitesSentOn: '2026-12-02', recorderIds: ['u-pwvsb-hr'] });
    // 3 working days before 14 Dec (Monday) = 9 Dec (Wednesday).
    expect(await svc.groupMonth.deadline('2026-11')).toBe('2026-12-09');

    // Own sections: pay method counts and a JTK complaint (staff number only, never a name).
    await expect(act('u-ae-sasa', 'jtk', { companyId: 'co-sasa', type: 'complaint', ref: 'JTK/T/1', receivedOn: '2026-11-10', staffNo: 'Ali Bin Abu' })).rejects.toThrow(/staff number/);
    await act('u-ae-sasa', 'jtk', { companyId: 'co-sasa', type: 'complaint', ref: 'JTK/T/1', receivedOn: '2026-11-10', staffNo: 'S-0001', amount: 1200, hearingOn: '2026-12-20' });
    await act('u-ae-sasa', 'payMethod', { companyId: 'co-sasa', period: '2026-11', transfer: 40, noAccount: 2, cash: 1 });
    await expect(act('u-pwvsb-hr', 'payMethod', { companyId: 'co-sasa', period: '2026-11', transfer: 1, noAccount: 0, cash: 0 })).rejects.toBeInstanceOf(AccessDenied);

    const built = (await act('u-ae-sasa', 'reportBuild', { scope: SC, period: '2026-11' })) as { d: { lines: Record<string, { text: string; red?: boolean }[]>; packMeetingId: string } };
    expect(built.d.packMeetingId).toBe(m.id);
    expect(built.d.lines['9'][0].text).toMatch(/Pindahan 40, tiada akaun bank 2, tunai 1/);
    expect(built.d.lines['10'].some((l) => /JTK\/T\/1/.test(l.text) && l.red)).toBe(true);
    expect(built.d.lines['3'].length).toBeGreaterThan(0);

    // Every item ticked; 13 and 14 need a status line; the preparer cannot verify.
    await expect(act('u-ae-sasa', 'reportSubmit', { scope: SC, period: '2026-11' })).rejects.toThrow(/every item/);
    const ticks = Object.fromEntries(RULES.groupMonthly.value.items.map((x) => [x.key, 'berubah']));
    await act('u-ae-sasa', 'reportSave', { scope: SC, period: '2026-11', ticks });
    await expect(act('u-ae-sasa', 'reportSubmit', { scope: SC, period: '2026-11' })).rejects.toThrow(/status line for item 13/);
    await act('u-ae-sasa', 'reportSave', { scope: SC, period: '2026-11', notes: { '1': 'Modal berbayar RM500,000 (test)', '13': 'Fail 2026 tersusun (test)', '14': 'Baik (test)' } });
    await act('u-ae-sasa', 'reportSubmit', { scope: SC, period: '2026-11' });
    await expect(act('u-ae-sasa', 'reportDecide', { scope: SC, period: '2026-11', verdict: 'verify', comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(act('u-cm-sasa', 'reportDecide', { scope: SC, period: '2026-11', verdict: 'verify' })).rejects.toThrow(/comment/);
    await act('u-cm-sasa', 'reportDecide', { scope: SC, period: '2026-11', verdict: 'verify', comment: 'Disahkan (test)' });
    await expect(act('u-ae-sasa', 'reportBuild', { scope: SC, period: '2026-11' })).rejects.toThrow(/cannot be rebuilt/);

    // The board: Sasa verified; other companies not sent; after the deadline they are late, on the day red.
    let b = (await act('u-pwvsb-hr', 'board', { period: '2026-11' })) as { rows: { scope: string; status: string; late: boolean; red: boolean }[]; bil: string };
    expect(b.rows.find((r) => r.scope === SC)!.status).toBe('verified');
    expect(b.rows.some((r) => r.status === 'none' && !r.late)).toBe(true);
    expect(b.bil).toBe('Bil 1/2026');
    at('2026-12-10');
    b = (await act('u-pwvsb-hr', 'board', { period: '2026-11' })) as typeof b;
    expect(b.rows.find((r) => r.scope !== SC && r.status === 'none')!.late).toBe(true);
    expect((await svc.groupMonth.homeItems(await svc.user('u-pwvsb-hr'))).some((h) => /lewat/.test(h.title))).toBe(true);
    at('2026-12-14');
    b = (await act('u-pwvsb-doa', 'board', { period: '2026-11' })) as typeof b;
    expect(b.rows.find((r) => r.scope !== SC && r.status === 'none')!.red).toBe(true);
    // Another company's manager does not read Sasa's report in full.
    const other = (await svc.store.list('users')).find((u) => u.role === 'company_manager' && !u.companyIds.includes('co-sasa'))!;
    await expect(act(other.id, 'reportView', { scope: SC, period: '2026-11' })).rejects.toBeInstanceOf(AccessDenied);
    // HR reads it; SULIT shows only as a count to HR.
    const v = (await act('u-pwvsb-hr', 'reportView', { scope: SC, period: '2026-11' })) as { status: string; lines: Record<string, { text: string }[]> };
    expect(v.status).toBe('verified');
    if (v.lines.sulit) expect(v.lines.sulit[0].text).toMatch(/^Sulit: \d+ perkara$/);

    // Next month: an item marked changed with the same note as last month is refused (no copy-forward).
    at('2027-01-05');
    await act('u-ae-sasa', 'reportBuild', { scope: SC, period: '2026-12' });
    await act('u-ae-sasa', 'reportSave', { scope: SC, period: '2026-12', ticks, notes: { '1': 'Modal berbayar RM500,000 (test)', '13': 'Fail 2026 tersusun (test)', '14': 'Baik (test)' } });
    await expect(act('u-ae-sasa', 'reportSubmit', { scope: SC, period: '2026-12' })).rejects.toThrow(/same as last month/);
  });

  it('Y9 / Y-Q10: minutes prepared by Unit HR and verified by the Director Office, never the preparer; AI notes checked first', async () => {
    const { act, at } = fresh('2026-12-01');
    await act('u-pwvsb-hr', 'setMeeting', { period: '2026-11', meetingOn: '2026-12-14' });
    await expect(act('u-pwvsb-hr', 'minutes', { period: '2026-11', step: 'draft', text: 'Minit mesyuarat bulanan JA Group (test) dengan keputusan.' })).rejects.toThrow(/after the meeting/);
    at('2026-12-15');
    await act('u-pwvsb-hr', 'minutes', { period: '2026-11', step: 'draft', text: 'Minit mesyuarat bulanan JA Group (test) dengan keputusan.', aiNotes: 'nota AI (test)' });
    await expect(act('u-pwvsb-hr', 'minutes', { period: '2026-11', step: 'submit' })).rejects.toThrow(/AI notes/);
    await act('u-pwvsb-hr', 'minutes', { period: '2026-11', step: 'draft', text: 'Minit mesyuarat bulanan JA Group (test) dengan keputusan.', aiNotes: 'nota AI (test)', aiChecked: true });
    await act('u-pwvsb-hr', 'minutes', { period: '2026-11', step: 'submit' });
    await expect(act('u-pwvsb-hr', 'minutes', { period: '2026-11', step: 'verify', comment: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-pwvsb-doa', 'minutes', { period: '2026-11', step: 'verify', comment: 'Disahkan (test)' });
    const b = (await act('u-cm-sasa', 'board', { period: '2026-11' })) as { minutesStatus: string; minutes: string };
    expect(b.minutesStatus).toBe('verified');
    expect(b.minutes).toMatch(/Minit/);
  });

  it('Y5: accounts report tracker (due the 28th of the next month), Internal Audit review (not the sender) and the Friday red/yellow/green report', async () => {
    const { act, at } = fresh('2026-11-04');
    await act('u-ae-sasa', 'acctSent', { companyId: 'co-sasa', period: '2026-09', sentOn: '2026-10-30', ref: 'Laporan akaun Sep (test).pdf' });
    await act('u-ae-sasa', 'acctSent', { companyId: 'co-sasa', period: '2026-10', sentOn: '2026-11-04', ref: 'Laporan akaun Okt (test).pdf' });
    await expect(act('u-ae-sasa', 'acctReview', { companyId: 'co-sasa', period: '2026-10', comment: 'x' })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-act-aud1', 'acctReview', { companyId: 'co-sasa', period: '2026-10', comment: 'Disemak (test)' });
    const t = (await act('u-audit', 'acctTracker', { year: '2026' })) as { rows: { companyId: string; cells: { period: string; state: string; lateDays: number | null }[] }[] };
    const sasa = t.rows.find((r) => r.companyId === 'co-sasa')!;
    expect(sasa.cells.find((c) => c.period === '2026-09')).toMatchObject({ state: 'late', lateDays: 2 });
    expect(sasa.cells.find((c) => c.period === '2026-10')!.state).toBe('reviewed');
    expect(sasa.cells.find((c) => c.period === '2026-08')!.state).toBe('missing');
    at('2026-11-06');
    const r = (await act('u-audit', 'ryg')) as { rows: { companyId: string; colour: string }[] };
    expect(r.rows.find((x) => x.companyId === 'co-sasa')!.colour).toBe('red');
    await act('u-audit', 'rygFreeze');
    await expect(act('u-audit', 'rygFreeze')).rejects.toThrow(/already sent/);
    await expect(act('u-cm-sasa', 'ryg')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('Y6/Y7/Y11: the company manager loads the template; the lines replace the playbook, open in their window, and count on time', async () => {
    const { svc, act, at } = fresh('2026-12-01');
    await expect(act('u-ae-sasa', 'dutyLoad', { scope: SC, role: 'admin_exec', picId: 'u-ae-sasa' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(act('u-cm-sasa', 'dutyLoad', { scope: SC, role: 'admin_exec', picId: 'u-ae-sasa', backupId: 'u-ae-sasa' })).rejects.toThrow(/another person/);
    const r = (await act('u-cm-sasa', 'dutyLoad', { scope: SC, role: 'admin_exec', picId: 'u-ae-sasa', backupId: 'u-ae-sasa-2' })) as { added: number };
    expect(r.added).toBe(RULES.groupDuties.value.template.admin_exec.length);
    expect(((await act('u-cm-sasa', 'dutyLoad', { scope: SC, role: 'admin_exec', picId: 'u-ae-sasa' })) as { added: number }).added).toBe(0);
    await expect(act('u-cm-sasa', 'dutyAdd', { scope: SC, text: 'Laporan khas', every: 'monthly', picId: 'u-ae-sasa' })).rejects.toThrow(/date window/);
    await expect(act('u-cm-sasa', 'dutyAdd', { scope: SC, text: 'Laporan khas', every: 'monthly', fromDay: 3, toDay: 3, picId: 'u-ae-arrow' })).rejects.toThrow();
    await act('u-cm-sasa', 'dutyAdd', { scope: SC, text: 'Laporan khas (test)', every: 'monthly', fromDay: 1, toDay: 3, picId: 'u-ae-sasa' });

    // On 1 Dec the daily lines and the 1-3hb line open; 5-15hb (contributions) does not yet; the playbook items do not.
    const ae = await svc.user('u-ae-sasa');
    const w = (await svc.myWork(ae)) as { open: { title: string; playbookItemId: string | null; dueAt: string }[] };
    const titles = w.open.filter((t) => t.playbookItemId?.startsWith('duty:')).map((t) => t.title);
    expect(titles).toContain('Laporan khas (test)');
    expect(titles.some((t) => /KWSP/.test(t))).toBe(false);
    expect(w.open.some((t) => t.playbookItemId && !t.playbookItemId.startsWith('duty:'))).toBe(false);
    const khas = w.open.find((t) => t.title === 'Laporan khas (test)')!;
    expect(khas.dueAt).toBe(myt('2026-12-03', '17:00'));
    expect(GroupMonthService.openOn({ every: 'yearly', month: 10, fromDay: 1, toDay: 31 }, '2026-12-01')).toBeNull();

    // Done inside the window is on time; KPI per person per month.
    await svc.workTaskDone(ae, (w.open.find((t) => t.title === 'Laporan khas (test)') as unknown as { id: string }).id, { note: 'Siap (test)', ref: 'fail (test)' });
    at('2026-12-31', '18:00');
    const k = (await act('u-cm-sasa', 'dutyKpi', { scope: SC, month: '2026-12' })) as { people: { userId: string; due: number; onTime: number }[] };
    const me = k.people.find((p) => p.userId === 'u-ae-sasa')!;
    expect(me.onTime).toBe(1);
    expect(me.due).toBeGreaterThanOrEqual(2);
    // Removing a line needs a reason.
    const lines = (await act('u-cm-sasa', 'duties', { scope: SC })) as { lines: { id: string; text: string }[] };
    await expect(act('u-cm-sasa', 'dutyEdit', { id: lines.lines[0].id, remove: true })).rejects.toThrow(/why/);
    await act('u-cm-sasa', 'dutyEdit', { id: lines.lines[0].id, remove: true, reason: 'Bukan tugas syarikat ini (test)' });
    expect(((await act('u-cm-sasa', 'duties', { scope: SC })) as { lines: unknown[] }).lines.length).toBe(lines.lines.length - 1);
  });
});

describe('Part Y Y8b: a payment is approved in Prima or in its SharePoint form, never both', () => {
  it('approves from the linked SharePoint request by the FD, refuses a Prima approval of it, and refuses SharePoint after a Prima approval', async () => {
    const ds = generateDataset({ today: '2026-10-31', now: myt('2026-10-31', '10:00') });
    const svc = new PrimaService(new MemoryStore(ds), () => myt('2026-10-31', '10:00'));
    const C = GROUP_EMPLOYER_ID;
    const F = () => ds.finStatus.find((x) => x.companyId === C)!;
    const [de, dep, fd, lead] = await Promise.all(['u-fin-t1-de1', 'u-fin-t1-dep', 'u-fd', 'u-fin-t1-lead'].map((id) => svc.user(id)));
    const sp = (over: Record<string, unknown> = {}) => ({ system: 'sharepoint', url: 'https://pwvsb.sharepoint.com/sites/finance/Lists/Approvals/9', requestRef: 'SP-9', decisions: [{ approver: fd.name, decision: 'approved', comment: 'Lulus (test)', decidedOn: '2026-10-31' }], ...over });
    const p = await svc.finance.createPayment(de, C, { payeeId: 'payee-pwvsb-003', purpose: 'Lease top-up', amount: 910, dueOn: '2026-11-20', bankId: F().banks[0].id, sqlRef: 'PI-Y8B-1', evidence: ['inv.pdf'], approvalMethod: 'sharepoint' });
    expect(p.approvalMethod).toBe('sharepoint');
    await svc.finance.paymentStep(dep, C, p.id, 'review', { comment: 'Semak (test)' });
    await expect(svc.finance.paymentStep(fd, C, p.id, 'approve', { comment: 'ok' })).rejects.toThrow(/SharePoint form/);
    // The approver named in SharePoint must be one who approves Finance payments.
    await expect(svc.finance.paymentStep(lead, C, p.id, 'link', sp({ decisions: [{ approver: de.name, decision: 'approved', comment: 'x', decidedOn: '2026-10-31' }] }))).rejects.toThrow(/Finance Director or the CEO/);
    await expect(svc.finance.paymentStep(dep, C, p.id, 'link', sp())).rejects.toBeInstanceOf(AccessDenied);
    const ok = await svc.finance.paymentStep(lead, C, p.id, 'link', sp());
    expect(ok.status).toBe('approved');
    expect(ok.steps.at(-1)).toMatchObject({ step: 'approved', byId: 'u-fd' });

    const q = await svc.finance.createPayment(de, C, { payeeId: 'payee-pwvsb-003', purpose: 'Lease top-up 2', amount: 920, dueOn: '2026-11-21', bankId: F().banks[0].id, sqlRef: 'PI-Y8B-2', evidence: ['inv.pdf'], approvalMethod: 'prima' });
    await svc.finance.paymentStep(dep, C, q.id, 'review', { comment: 'Semak (test)' });
    await svc.finance.paymentStep(fd, C, q.id, 'approve', { comment: 'Lulus (test)' });
    await expect(svc.finance.paymentStep(lead, C, q.id, 'link', sp({ requestRef: 'SP-10' }))).rejects.toThrow(/one place only/);
  });
});
