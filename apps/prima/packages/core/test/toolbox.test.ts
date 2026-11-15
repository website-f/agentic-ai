// Part X (Fitri package, company toolbox meeting papers, Fauzan's answers X-Q1..X-Q11, 14 Nov 2026): company and
// department toolbox meetings with the standard agenda, the frozen status pack, status lines, no copy-forward,
// prepared and verified, registers, SULIT, the central director's visit, AI notes and the OM's site talks.
// Made-up data only, in memory. PostgreSQL is tested apart in apps/api/test/toolbox-pg.test.ts.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, defaultMeetingPrep, generateDataset, myt, type User } from '../src';

const TODAY = '2026-11-18';
const NOW = myt(TODAY, '10:00');
const png = (n: number) => `data:image/png;base64,${Buffer.from(`synthetic toolbox photo ${n}`).toString('base64')}`;

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const cm = ds.users.find((u) => u.id === 'u-cm-sasa')!;
  ds.users.push({ ...cm, id: 'u-dir-test', name: 'Director T (test)', role: 'director', title: 'Pengarah' } as User);
  const store = new MemoryStore(ds);
  const clock = { now: NOW };
  const svc = new PrimaService(store, () => clock.now);
  const act = async (uid: string, op: string, i: Record<string, unknown>) => svc.toolboxAct(await svc.user(uid), op, i);
  const meet = async (start: string, seriesKey = 'co-office:co-sasa', uid = 'u-cm-sasa', attendeeIds: string[] = []) =>
    svc.scheduleMeeting(await svc.user(uid), { companyId: null, kind: 'toolbox', title: 'Toolbox (test)', start: myt(start, '09:00'), end: myt(start, '10:00'), location: 'HQ', attendees: [], agenda: 'Standard', seriesKey, attendeeIds });
  return { ds, svc, act, meet, clock };
}
const allTicks = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, 'nochange']));

describe('Part X toolbox meetings', () => {
  it('X1/X2: the standing company and department toolbox use kind toolbox, the new checklist and the standard agenda', async () => {
    const { svc, meet, act } = fresh();
    expect(defaultMeetingPrep('toolbox').map((p) => p.label).slice(-3)).toEqual(['Status pack built (Bina pek status)', 'Open lines from the last meeting listed', 'Attendance confirmed']);
    expect(defaultMeetingPrep('toolbox').some((p) => /Safety topic/.test(p.label))).toBe(false);
    const m = await meet('2026-11-17');
    expect(m.kind).toBe('toolbox');
    const v = (await act('u-ae-sasa', 'view', { meetingId: m.id })) as { agenda: { key: string }[]; bil: string };
    expect(v.agenda.map((x) => x.key)).toEqual(RULES.toolbox.value.agenda.company.map((x) => x.key));
    expect(v.bil).toBe('Bil 1/2026');
    const plan = (await svc.meetings(await svc.user('u-it-mgr'))).plan.find((p) => p.seriesKey === 'dept-toolbox:it')!;
    expect(plan.kind).toBe('toolbox');
    // Central Admin may not drop a standard section; a company may add its own but not drop one.
    await expect(act('u-dcos', 'setSetting', { reason: 'test change', agenda: { company: RULES.toolbox.value.agenda.company.filter((x) => x.key !== 'f') } })).rejects.toThrow(/cannot be dropped: f/);
    await expect(act('u-cm-sasa', 'addSection', { scope: 'co:co-sasa', drop: 'f', title: 'x' })).rejects.toThrow(/cannot be dropped/);
    await act('u-cm-sasa', 'addSection', { scope: 'co:co-sasa', title: 'Projek khas (test)' });
    expect(((await act('u-ae-sasa', 'view', { meetingId: m.id })) as { agenda: { key: string }[] }).agenda.at(-1)!.key).toBe('x1');
    // The old minutes path is closed for the standing toolbox series.
    await expect(svc.addMinutes(await svc.user('u-cm-sasa'), m.id, 'x'.repeat(40))).rejects.toThrow(/toolbox screen/);
  });

  it('X3/X9/X10/X12/X18: the pack is the company’s own, frozen, honest about missing records and cut per reader', async () => {
    const { ds, act, meet } = fresh();
    const m = await meet('2026-11-17');
    const acc = ds.clientAccounts.find((a) => a.companyId === 'co-sasa')!;
    acc.startedOn = '2026-01-01';
    acc.invoices = [{ period: '2026-02', amount: 10000, at: NOW, by: 'x', hand: null, email: null, portal: null }];
    await act('u-fd', 'receipt', { companyId: 'co-sasa', accountId: acc.id, period: '2026-02', amount: 9000, deductions: [{ kind: 'factoring', amount: 500 }] });
    await expect(act('u-cm-sasa', 'receipt', { companyId: 'co-sasa', accountId: acc.id, period: '2026-02', amount: 1 })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-fd', 'personal', { companyId: 'co-sasa', what: 'Pinjaman kenderaan', name: 'Director A (test)', amount: 1200, paidOn: '2026-11-05' });
    await act('u-fd', 'personal', { companyId: 'co-sasa', what: 'Zakat', name: 'Director A (test)', amount: 300 });
    await act('u-ae-sasa', 'build', { meetingId: m.id });
    const v = (await act('u-ae-sasa', 'view', { meetingId: m.id })) as { pack: Record<string, { text: string; source: string; red?: boolean }[]>; packAt: string };
    expect(v.packAt).toBe(NOW);
    expect(v.pack.d.some((l) => l.text.includes('Jan: belum invois') && l.red)).toBe(true);
    expect(v.pack.d.some((l) => /Feb: RM10000 diterima RM9000 potongan RM500 baki RM500/.test(l.text))).toBe(true);
    expect(v.pack.d.some((l) => /factoring RM500/.test(l.text))).toBe(true);
    expect(v.pack.f.length).toBeGreaterThan(0);
    expect(v.pack.j[0].text).toBe('tiada rekod');
    // Admin executive sees "Sulit: 2 perkara"; the FD sees the lines and the opening is logged; a director too.
    expect(v.pack.sulit).toEqual([{ text: 'Sulit: 2 perkara', source: 'Kewangan (SULIT)' }]);
    const fd = (await act('u-fd', 'view', { meetingId: m.id })) as { pack: Record<string, { text: string }[]>; text: string | null };
    expect(fd.pack.sulit.length).toBe(2);
    expect(fd.pack.c[0].text).toMatch(/terhad/);
    expect(fd.text).toBeNull();
    expect(ds.audit.some((a) => a.action === 'toolbox.sulit_open' && a.actor === ds.users.find((u) => u.id === 'u-fd')!.name)).toBe(true);
    expect(((await act('u-dir-test', 'view', { meetingId: m.id })) as { pack: Record<string, unknown[]> }).pack.sulit.length).toBe(2);
    // Another company's staff cannot open it; another company's records never appear.
    await expect(act('u-cm-arsh', 'view', { meetingId: m.id })).rejects.toBeInstanceOf(AccessDenied);
    expect(JSON.stringify(v.pack)).not.toMatch(/co-arsh/);
  });

  it('X4/X5/X6/X7: lines carry forward, no copy-forward minutes, prepared and verified, locked, numbered and held', async () => {
    const { ds, act, meet, clock } = fresh();
    const m1 = await meet('2026-11-03', 'co-office:co-sasa', 'u-cm-sasa', ['u-dir-test']);
    const keys = RULES.toolbox.value.agenda.company.map((x) => x.key);
    clock.now = myt('2026-11-03', '11:00');
    await act('u-ae-sasa', 'build', { meetingId: m1.id });
    const line = (await act('u-ae-sasa', 'line', { scope: 'co:co-sasa', section: 'b', matter: 'Cawangan Kedah perlu alamat baharu (test)', status: 'dalam_proses', ownerId: 'u-ae-sasa', target: '2026-11-30' })) as { id: string };
    await expect(act('u-ae-sasa', 'submit', { meetingId: m1.id })).rejects.toThrow(/tiada perubahan/);
    await act('u-ae-sasa', 'draft', { meetingId: m1.id, text: 'Minit mesyuarat toolbox pertama (test). Semua seksyen dibincang.', ticks: allTicks(keys) });
    await act('u-ae-sasa', 'submit', { meetingId: m1.id });
    // The preparer cannot verify; the company manager cannot while a director attended; a comment is required.
    await expect(act('u-ae-sasa', 'verify', { meetingId: m1.id, comment: 'ok fine' })).rejects.toThrow(/someone else/);
    await expect(act('u-cm-sasa', 'verify', { meetingId: m1.id, comment: 'ok fine' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(act('u-dir-test', 'verify', { meetingId: m1.id })).rejects.toThrow(/comment/);
    await act('u-dir-test', 'verify', { meetingId: m1.id, comment: 'Disahkan (test)' });
    expect(ds.meetings.find((x) => x.id === m1.id)!.status).toBe('held');
    expect(ds.meetings.find((x) => x.id === m1.id)!.summary!.actions[0].ownerId).toBe('u-ae-sasa');
    await expect(act('u-ae-sasa', 'draft', { meetingId: m1.id, text: 'changed after verify' })).rejects.toThrow(/cannot change/);
    await expect(act('u-ae-sasa', 'build', { meetingId: m1.id })).rejects.toThrow(/cannot change/);
    // Meeting 2: the open line carries with its age; the same text as last time needs a reason.
    const m2 = await meet('2026-11-17');
    clock.now = myt('2026-11-17', '11:00');
    await act('u-ae-sasa', 'build', { meetingId: m2.id });
    let v = (await act('u-ae-sasa', 'view', { meetingId: m2.id })) as { lines: { id: string; stale: number }[]; bil: string; pack: Record<string, { text: string }[]> };
    expect(v.bil).toBe('Bil 2/2026');
    expect(v.lines.find((l) => l.id === line.id)!.stale).toBe(1);
    expect(v.pack.b.some((l) => l.text.includes('Cawangan Kedah'))).toBe(true);
    await act('u-ae-sasa', 'draft', { meetingId: m2.id, text: 'Minit mesyuarat toolbox pertama (test). Semua seksyen dibincang.', ticks: allTicks(keys) });
    await expect(act('u-ae-sasa', 'submit', { meetingId: m2.id })).rejects.toThrow(/Sama seperti mesyuarat lepas/);
    await act('u-ae-sasa', 'line', { scope: 'co:co-sasa', id: line.id, status: 'selesai', note: 'Alamat baharu diperoleh (test)' });
    await act('u-ae-sasa', 'draft', { meetingId: m2.id, text: 'Minit kedua (test): cawangan Kedah selesai pada 2026-12-01.' });
    await expect(act('u-ae-sasa', 'submit', { meetingId: m2.id })).rejects.toThrow(/dates after the meeting/);
    await act('u-ae-sasa', 'draft', { meetingId: m2.id, text: 'Minit kedua (test): cawangan Kedah selesai.' });
    await act('u-ae-sasa', 'submit', { meetingId: m2.id });
    // No director invited this time: the company manager verifies.
    await act('u-cm-sasa', 'verify', { meetingId: m2.id, comment: 'Disahkan (test)' });
    // Meeting 3: the done line shows once more, then drops.
    const m3 = await meet('2026-12-01');
    clock.now = myt('2026-12-01', '11:00');
    await act('u-ae-sasa', 'build', { meetingId: m3.id });
    v = (await act('u-ae-sasa', 'view', { meetingId: m3.id })) as never;
    expect(v.lines.find((l) => l.id === line.id)).toBeTruthy();
    await act('u-ae-sasa', 'draft', { meetingId: m3.id, text: 'Minit ketiga (test): tiada perkara baharu.', ticks: allTicks(keys) });
    await act('u-ae-sasa', 'submit', { meetingId: m3.id });
    await act('u-cm-sasa', 'verify', { meetingId: m3.id, comment: 'Disahkan (test)' });
    expect(ds.toolboxRecs.find((r) => r.id === line.id)!.status).toBe('closed');
    // Correction = new version with the reason; PDF export of verified minutes.
    const pdf = (await act('u-ae-sasa', 'pdf', { meetingId: m1.id })) as { name: string; base64: string };
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    await expect(act('u-ae-sasa', 'correct', { meetingId: m1.id })).rejects.toThrow(/reason/);
    await act('u-ae-sasa', 'correct', { meetingId: m1.id, reason: 'Typo in section b (test)' });
    expect(((await act('u-ae-sasa', 'view', { meetingId: m1.id })) as { versions: number; status: string }).versions).toBe(1);
  });

  it('X8: registers stay behind the company wall and never hold an IC number; one chosen branch per zone', async () => {
    const { act } = fresh();
    await act('u-ae-sasa', 'branch', { companyId: 'co-sasa', state: 'Kedah', zone: 'Utara', kdnStatus: 'lulus', vault: true, chosen: true, chosenOn: '2026-10-01', chosenReason: 'Employer choice (test)' });
    await expect(act('u-ae-sasa', 'branch', { companyId: 'co-sasa', state: 'Perlis', zone: 'Utara', kdnStatus: 'lulus', chosen: true, chosenOn: '2026-10-01', chosenReason: 'x choice' })).rejects.toThrow(/already has a chosen branch/);
    await expect(act('u-ae-sasa', 'nominee', { companyId: 'co-sasa', name: 'Nominee 800101-01-1234', position: 'Pengarah', addedOn: '2026-01-01' })).rejects.toThrow(/IC number/);
    await act('u-ae-sasa', 'nominee', { companyId: 'co-sasa', name: 'Nominee A (test)', position: 'Pengarah', addedOn: '2026-01-01' });
    await act('u-ae-sasa', 'pgm', { companyId: 'co-sasa', contractRef: 'KPM-1 (test)', pgmYear: 2025, zone: 'Utara', approvedOn: '2026-03-01', approvedAmount: 5000, receivedAmount: 2000 });
    await expect(act('u-cm-arsh', 'branch', { companyId: 'co-sasa', state: 'Johor', kdnStatus: 'lulus' })).rejects.toBeInstanceOf(AccessDenied);
    const regs = (await act('u-cm-sasa', 'registers', { companyId: 'co-sasa' })) as { kind: string }[];
    expect(regs.map((r) => r.kind).sort()).toEqual(['branch', 'nominee', 'pgm']);
    await expect(act('u-cm-arsh', 'registers', { companyId: 'co-sasa' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('X11/X15/X16: the group board for leaders, one row for a company, late departments and the director visit', async () => {
    const { act, meet, svc } = fresh();
    await meet('2026-11-17');
    const ceo = (await act('u-fauzan', 'board', {})) as { rows: { scope: string; late: boolean; directorMissed: boolean }[] };
    expect(ceo.rows.length).toBeGreaterThan(5);
    expect(ceo.rows.find((r) => r.scope === 'dept:it')!.late).toBe(true);
    expect(ceo.rows.find((r) => r.scope === 'co:co-sasa')!.directorMissed).toBe(true);
    const cm = (await act('u-cm-sasa', 'board', {})) as { rows: { scope: string }[] };
    expect(cm.rows.map((r) => r.scope)).toEqual(['co:co-sasa']);
    await expect(act('u-cm-sasa', 'rotation', { scope: 'co:co-sasa', directorId: 'u-coo', reason: 'rotation' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(act('u-dcos', 'rotation', { scope: 'co:co-sasa', directorId: 'u-cm-sasa', reason: 'rotation' })).rejects.toThrow(/central management director/);
    await act('u-dcos', 'rotation', { scope: 'co:co-sasa', directorId: 'u-coo', reason: 'Nov-Dec rotation (test)' });
    expect(((await act('u-fauzan', 'board', {})) as { rows: { scope: string; director: string | null }[] }).rows.find((r) => r.scope === 'co:co-sasa')!.director).toBeTruthy();
    const home = await svc.toolbox.homeItems(await svc.user('u-fauzan'));
    expect(home.some((h) => /Lawatan pengarah pusat: tiada/.test(h.title))).toBe(true);
  });

  it('X17: AI notes stay "belum disemak" until the preparer ticks them', async () => {
    const { act, meet, clock } = fresh();
    const m = await meet('2026-11-17', 'dept-toolbox:it', 'u-it-mgr');
    clock.now = myt('2026-11-17', '11:00');
    await act('u-it-ex1', 'build', { meetingId: m.id });
    const keys = RULES.toolbox.value.agenda.department.map((x) => x.key);
    await act('u-it-ex1', 'draft', { meetingId: m.id, aiText: 'Loop AI notes (test): items 1-8 discussed.', ticks: allTicks(keys) });
    await expect(act('u-it-ex1', 'submit', { meetingId: m.id })).rejects.toThrow(/belum disemak/);
    await act('u-it-ex1', 'draft', { meetingId: m.id, aiChecked: true });
    await act('u-it-ex1', 'submit', { meetingId: m.id });
    await expect(act('u-it-ex2', 'verify', { meetingId: m.id, comment: 'ok fine' })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-it-mgr', 'verify', { meetingId: m.id, comment: 'Disahkan ketua jabatan (test)' });
  });

  it('X19: the OM records a site talk with a stamped photo; sites without one this month are due', async () => {
    const { ds, act } = fresh();
    const site = ds.sites.find((x) => x.companyId === 'co-sasa' && (x.state ?? ds.branches.find((b) => b.id === x.branchId)?.state) === 'Selangor')!;
    const photo = { kind: 'photo', image: png(1), lat: site.lat, lng: site.lng, accuracyM: 8 };
    await expect(act('u-om-klang', 'siteTalk', { siteId: site.id, safety: 'Kebakaran (test)', headcount: 4 })).rejects.toThrow(/photo/);
    await expect(act('u-cm-sasa', 'siteTalk', { siteId: site.id, safety: 'x test', headcount: 4, photos: [photo] })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-om-klang', 'siteTalk', { siteId: site.id, safety: 'Kebakaran (test)', ops: ['Post orders (test)'], headcount: 4, photos: [photo] });
    const list = (await act('u-om-klang', 'siteTalks', {})) as { rows: { siteId: string; due: boolean }[] };
    expect(list.rows.find((r) => r.siteId === site.id)!.due).toBe(false);
    expect(list.rows.some((r) => r.due)).toBe(true);
  });
});
