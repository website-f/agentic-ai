// Group employment history (Fauzan, 4 Nov 2026): one person across the group's companies, each company's employment
// record kept separate. Synthetic data only: made-up names, IC and passport numbers.
import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  BadRequest,
  MemoryStore,
  PrimaService,
  continuousSince,
  dataWalls,
  generateDataset,
  idLinker,
  myt,
  canMarkDoNotRehire,
  historyPopulation,
  normaliseIdNumber,
  rehireSuggestion,
  staffHistoryRole,
  timesJoined,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '09:00');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => new Date((t += 1000)).toISOString());
  return { ds, store, svc };
}

const IC = '880808-08-8888';

const guard = (code: string, over: Record<string, unknown> = {}) => ({
  company: code,
  externalId: `H-${code}-1`,
  updatedAt: '2026-10-26T10:00:00+08:00',
  staffNo: `JA-H-${code}-01`,
  name: 'Ujian Pengawal Satu',
  nationality: 'MY',
  role: 'guard',
  status: 'active',
  dob: '1988-08-08',
  hiredOn: '2026-10-01',
  state: 'Selangor',
  idFull: IC,
  ...over,
});

/** A guard who worked at company A from 2019 to 2022, left for years, and joined company B in 2026. */
async function returningGuard() {
  const f = fresh();
  const companies = await f.store.list('companies', {});
  const a = companies.find((c) => c.id === 'co-sasa')!;
  const b = companies.find((c) => c.id === 'co-inas')!;
  const feed = await f.svc.user('u-ja-sync');
  const left = await f.svc.jaIngest(feed, 'guard', [
    guard(a.code, { status: 'left', hiredOn: '2019-03-01', leftOn: '2022-06-30', leftHow: 'terminated', csg: { certificateNo: 'CSG-H-1', doneOn: '2019-09-01' } }),
  ]);
  expect(left.rejected).toEqual([]);
  // The number comes without dashes this time: it still matches.
  const back = await f.svc.jaIngest(feed, 'guard', [guard(b.code, { idFull: '880808088888', hiredOn: '2026-10-01' })]);
  expect(back.rejected).toEqual([]);
  const recA = await f.store.get('jaRecords', `ja:guard:co-sasa:H-${a.code}-1`);
  const recB = await f.store.get('jaRecords', `ja:guard:co-inas:H-${b.code}-1`);
  return { ...f, a, b, pa: recA!.guard!.personId!, pb: recB!.guard!.personId! };
}

describe('staff-history helpers', () => {
  it('keys numbers without keeping them, the same however they are written, and only with a key', () => {
    const on = idLinker('a-test-key-that-is-long-enough-for-hmac-123');
    const k = on.key('880808-08-8888', 'MY')!;
    expect(k).toMatch(/^k1\$[0-9a-f]{64}$/);
    expect(k).not.toContain('880808');
    expect(on.key('880808 08 8888', 'MY')).toBe(k);
    expect(on.key('880808-08-8888', 'NP')).not.toBe(k);
    expect(idLinker('another-test-key-that-is-long-enough-for-hmac').key('880808-08-8888', 'MY')).not.toBe(k);
    expect(idLinker('short').on).toBe(false);
    expect(idLinker(null).key('880808-08-8888', 'MY')).toBeNull();
    expect(normaliseIdNumber('pa 12-34/56')).toBe('PA123456');
  });

  it('counts a transfer as continuous service and a gap of years as a new joining', () => {
    const rows = [
      { from: '2015-01-01', to: '2018-12-31', status: 'left' as const },
      { from: '2021-03-01', to: '2023-05-31', status: 'left' as const },
      { from: '2023-06-01', to: null, status: 'active' as const },
    ];
    expect(continuousSince(rows, '2026-10-26')).toBe('2021-03-01');
    expect(timesJoined(rows)).toBe(2);
    expect(continuousSince(rows.slice(0, 2), '2026-10-26')).toBeNull();
    expect(timesJoined([{ from: '2020-01-01', to: null, status: 'left' }, { from: '2024-01-01', to: null, status: 'active' }])).toBe(2);
  });

  it('suggests HR looks before a rehire, never decides', () => {
    expect(rehireSuggestion({ endings: ['resigned'], provenCharges: 0, dismissals: 0 })).toBeNull();
    expect(rehireSuggestion({ endings: ['terminated'], provenCharges: 0, dismissals: 0 })!.status).toBe('check_first');
    expect(rehireSuggestion({ endings: [], provenCharges: 0, dismissals: 1 })!.why).toMatch(/dismissal/);
  });

  it('gives each role its history wall (Fauzan, 4 Nov 2026: ROM and above, FWM management, by number only)', async () => {
    const { svc } = fresh();
    const role = async (id: string) => staffHistoryRole(await svc.user(id));
    expect(await role('u-pwvsb-hr')).toBe('hr');
    expect(await role('u-cos')).toBe('hr');
    expect(await role('u-fauzan')).toBe('hr');
    expect(await role('u-fwm-mgr')).toBe('fwm');
    expect(await role('u-fwm-dep')).toBe('fwm');
    expect(await role('u-fwm-ex1')).toBeNull();
    expect(await role('u-fwm-desp')).toBeNull();
    expect(await role('u-rom-central')).toBe('lookup');
    expect(await role('u-ogm')).toBe('lookup');
    expect(await role('u-opsdir')).toBe('lookup');
    expect(await role('u-coo')).toBe('lookup');
    expect(await role('u-chair')).toBe('lookup');
    expect(await role('u-om-klang')).toBeNull();
    expect(await role('u-cm-sasa')).toBeNull();
    expect(await role('u-ae-arsh')).toBeNull();
    expect(await role('u-ja-sync')).toBeNull();
    expect(dataWalls(await svc.user('u-pwvsb-hr'))).toEqual(expect.arrayContaining(['staff_history', 'history_lookup']));
    expect(dataWalls(await svc.user('u-pwvsb-hr'))).not.toContain('history_mark');
    expect(dataWalls(await svc.user('u-rom-central'))).toContain('history_lookup');
    expect(dataWalls(await svc.user('u-rom-central'))).not.toContain('history_mark');
    expect(dataWalls(await svc.user('u-coo'))).toEqual(expect.arrayContaining(['history_lookup', 'history_mark']));
    expect(dataWalls(await svc.user('u-ogm'))).toContain('history_mark');
    expect(dataWalls(await svc.user('u-opsdir'))).toContain('history_mark');
    expect(dataWalls(await svc.user('u-chair'))).not.toContain('history_mark');
    expect(dataWalls(await svc.user('u-cm-sasa')).filter((w) => /history/.test(w))).toEqual([]);
    expect(dataWalls(await svc.user('u-om-klang')).filter((w) => /history/.test(w))).toEqual([]);
    expect(dataWalls(await svc.user('u-fwm-mgr'))).toEqual(expect.arrayContaining(['fw_history', 'history_lookup']));
    expect(canMarkDoNotRehire(await svc.user('u-cos'))).toBe(true);
    expect(canMarkDoNotRehire(await svc.user('u-fauzan'))).toBe(true);
    expect(canMarkDoNotRehire(await svc.user('u-pwvsb-hr'))).toBe(false);
    expect(canMarkDoNotRehire(await svc.user('u-rom-central'))).toBe(false);
  });
});

describe('group employment history', () => {
  it('links a guard who left company A and came back years later at company B, keeping both records', async () => {
    const { svc, store, pa, pb } = await returningGuard();
    expect(pa).not.toBe(pb);
    const [ra, rb] = await Promise.all([store.get('people', pa), store.get('people', pb)]);
    expect(ra!.companyId).toBe('co-sasa');
    expect(rb!.companyId).toBe('co-inas');
    expect(ra!.status).toBe('left');
    expect(ra!.leaving).toMatchObject({ kind: 'terminated', lastDayOn: '2022-06-30', by: 'JA Group app' });
    const [la, lb] = await Promise.all([store.get('personLinks', pa), store.get('personLinks', pb)]);
    expect(la!.groupPersonId).toBe(lb!.groupPersonId);
    expect(JSON.stringify(await store.list('personLinks', {}))).not.toContain('880808');
    expect(JSON.stringify(await store.list('groupPeople', {}))).not.toContain('880808');

    const hr = await svc.groupHistory(await svc.user('u-pwvsb-hr'), pb);
    expect(hr.linked).toBe(true);
    if (!hr.linked) return;
    expect(hr.shape).toBe('hr');
    expect(hr.employments.map((e) => [e.companyId, e.from, e.to])).toEqual([
      ['co-sasa', '2019-03-01', '2022-06-30'],
      ['co-inas', '2026-10-01', null],
    ]);
    expect(hr.timesJoined).toBe(2);
    expect(hr.continuousSince).toBe('2026-10-01');
    expect(hr.firstJoinedOn).toBe('2019-03-01');
    expect(hr.employments[0].ended).toBe('terminated');
    expect(hr.detail!.suggestion!.status).toBe('check_first');
    expect(hr.detail!.papers.some((x) => x.type === 'CSG_TRAINING' && !x.onThisRecord)).toBe(true);
    expect(hr.can.carryPaper).toBe(true);
    expect(hr.can.setDoNotRehire).toBe(false);
  });

  it('ROM and above see one person only by typing the number: a summary, no reasons, discipline or staff numbers; company heads and OMs see nothing', async () => {
    const { svc, store, pa, pb } = await returningGuard();
    const rom = await svc.user('u-rom-south');
    // No profile tab and no list: only the lookup.
    await expect(svc.groupHistory(rom, pb)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.groupHistoryBoard(rom)).rejects.toBeInstanceOf(AccessDenied);
    const r = await svc.historyLookup(rom, { idFull: IC, nationality: 'MY' });
    expect(r).toMatchObject({ known: true, doNotRehire: false, idMasked: '********8888', record: null, rehireNotes: null });
    expect(r.summary!.employments.map((e) => [e.companyName, e.from, e.to])).toEqual([
      ['Sasa Security Services Sdn Bhd', '2019-03-01', '2022-06-30'],
      [expect.stringMatching(/Inas/), '2026-10-01', null],
    ]);
    expect(r.summary).toMatchObject({ timesJoined: 2, employedNow: true, lastLeftOn: '2022-06-30', firstJoinedOn: '2019-03-01' });
    expect(r.summary!.papers.map((x) => x.type)).toContain('CSG_TRAINING');
    expect(JSON.stringify(r)).not.toMatch(/terminated|880808|JA-H-|Ujian Pengawal/);
    expect(r.can.mark).toBe(false);
    // Company heads, OMs, admin executives, FWM executives and the despatch: nothing, not even by number.
    for (const id of ['u-cm-inas', 'u-cm-sasa', 'u-om-klang', 'u-ae-arsh', 'u-fwm-ex1', 'u-fwm-desp']) {
      const u = await svc.user(id);
      await expect(svc.historyLookup(u, { idFull: IC, nationality: 'MY' })).rejects.toBeInstanceOf(AccessDenied);
      await expect(svc.groupHistory(u, pb)).rejects.toBeInstanceOf(AccessDenied);
      await expect(svc.groupHistory(u, pa)).rejects.toBeInstanceOf(AccessDenied);
    }
    // FWM management looks up foreign workers only, and opens a record only after typing its number.
    await expect(svc.historyLookup(await svc.user('u-fwm-mgr'), { idFull: IC, nationality: 'MY' })).rejects.toThrow(/foreign workers/);
    await expect(svc.groupHistory(await svc.user('u-fwm-mgr'), pb)).rejects.toBeInstanceOf(AccessDenied);
    // Each lookup is audited with the masked number; nothing keeps the number itself.
    const none = await svc.historyLookup(rom, { idFull: '770707-07-7777', nationality: 'MY' });
    expect(none.known).toBe(false);
    expect(none.summary).toBeNull();
    const checks = await store.list('hireChecks', { userId: rom.id });
    expect(checks).toHaveLength(2);
    expect(JSON.stringify(checks)).not.toContain('880808');
    expect((await store.list('audit', {})).filter((a) => a.action === 'history.lookup')).toHaveLength(2);
    await expect(svc.historyLookup(rom, { idFull: '12', nationality: 'MY' })).rejects.toBeInstanceOf(BadRequest);
    for (let i = 0; i < 28; i++) await svc.historyLookup(rom, { idFull: `770707-07-${String(1000 + i)}`, nationality: 'MY' });
    await expect(svc.historyLookup(rom, { idFull: IC, nationality: 'MY' })).rejects.toThrow(/30 lookups today/);
  });

  it('do not hire again: the HR Director, COO, OGM, Operations Director or CEO decides, with a reason; a red notice shows on lookup', async () => {
    const { svc, store, pb } = await returningGuard();
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.setRehire(hr, { personId: pb, status: 'check_first', reason: '' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.setRehire(hr, { personId: pb, status: 'do_not_rehire', reason: 'Ditamatkan selepas siasatan dalaman (ujian)' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.setRehire(hr, { personId: pb, status: 'check_first', reason: 'Semak sebab penamatan 2022 (ujian)' });
    await svc.setRehire(await svc.user('u-cos'), { personId: pb, status: 'do_not_rehire', reason: 'Ditamatkan selepas siasatan dalaman 2022 (ujian)' });
    // An HR officer cannot lift it.
    await expect(svc.setRehire(hr, { personId: pb, status: 'eligible', reason: 'Boleh diambil semula (ujian)' })).rejects.toBeInstanceOf(AccessDenied);
    const full = await svc.groupHistory(hr, pb);
    if (!full.linked) throw new Error('not linked');
    expect(full.doNotRehire).toBe(true);
    expect(full.can.setRehire).toBe(false);
    expect(full.detail!.rehireHistory.map((r) => r.status)).toEqual(['check_first', 'do_not_rehire']);
    // The ROM sees the red notice, never the reason.
    const r = await svc.historyLookup(await svc.user('u-rom-south'), { idFull: IC, nationality: 'MY' });
    expect(r.doNotRehire).toBe(true);
    expect(r.advice).toMatch(/DO NOT HIRE AGAIN/);
    expect(JSON.stringify(r)).not.toContain('siasatan');
    // The COO looks up, reads the reasons, and may lift it with a reason; only after a lookup.
    const coo = await svc.user('u-coo');
    await expect(svc.markByLookup(coo, { idFull: IC, nationality: 'MY', status: 'check_first', reason: 'Disemak semula oleh COO (ujian)' })).rejects.toThrow(/Look the person up/);
    const c = await svc.historyLookup(coo, { idFull: IC, nationality: 'MY' });
    expect(c.can.mark).toBe(true);
    expect(c.rehireNotes!.map((n) => n.reason)).toContain('Ditamatkan selepas siasatan dalaman 2022 (ujian)');
    await expect(svc.markByLookup(coo, { idFull: IC, nationality: 'MY', status: 'check_first', reason: 'x' })).rejects.toBeInstanceOf(BadRequest);
    await svc.markByLookup(coo, { idFull: IC, nationality: 'MY', status: 'check_first', reason: 'Disemak semula oleh COO (ujian)' });
    expect((await svc.historyLookup(coo, { idFull: IC, nationality: 'MY' })).doNotRehire).toBe(false);
    // The OGM marks do not hire again by lookup; the ROM and the Chairman may not decide.
    const ogm = await svc.user('u-ogm');
    await svc.historyLookup(ogm, { idFull: IC, nationality: 'MY' });
    await svc.markByLookup(ogm, { idFull: IC, nationality: 'MY', status: 'do_not_rehire', reason: 'Salah laku serius di tapak kerajaan (ujian)' });
    await expect(svc.markByLookup(await svc.user('u-rom-south'), { idFull: IC, nationality: 'MY', status: 'do_not_rehire', reason: 'Salah laku serius di tapak (ujian)' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.markByLookup(await svc.user('u-chair'), { idFull: IC, nationality: 'MY', status: 'do_not_rehire', reason: 'Salah laku serius di tapak (ujian)' })).rejects.toBeInstanceOf(AccessDenied);
    const after = await svc.groupHistory(hr, pb);
    if (!after.linked) throw new Error('not linked');
    expect(after.detail!.rehireHistory.map((x) => [x.status, x.by])).toEqual([
      ['check_first', hr.name],
      ['do_not_rehire', expect.any(String)],
      ['check_first', coo.name],
      ['do_not_rehire', ogm.name],
    ]);
    // HR is told on Home, in red, that a do-not-hire person is on a company's books; company heads are not.
    const home = await svc.home(await svc.user('u-cos'));
    expect(home.todo.some((i) => i.tag === 'HISTORY' && i.tone === 'crit')).toBe(true);
    expect((await svc.home(await svc.user('u-cm-inas'))).todo.some((i) => i.tag === 'HISTORY')).toBe(false);
    expect((await store.list('audit', {})).filter((x) => x.action === 'history.rehire')).toHaveLength(4);
  });

  it('HR links a renewed passport by hand with a reason, and can separate a wrong hand link', async () => {
    const { svc, store } = fresh();
    const companies = await store.list('companies', {});
    const a = companies.find((c) => c.id === 'co-sasa')!;
    const b = companies.find((c) => c.id === 'co-arsh')!;
    const feed = await svc.user('u-ja-sync');
    const np = { nationality: 'NP', name: 'Test Nepali Guard', dob: '1995-05-05' };
    await svc.jaIngest(feed, 'guard', [guard(a.code, { ...np, idFull: 'PA1111111', status: 'left', hiredOn: '2020-01-01', leftOn: '2024-12-31', leftHow: 'contract_end' })]);
    await svc.jaIngest(feed, 'guard', [guard(b.code, { ...np, idFull: 'PA2222222', hiredOn: '2026-06-01' })]);
    const pa = (await store.get('jaRecords', `ja:guard:co-sasa:H-${a.code}-1`))!.guard!.personId!;
    const pb = (await store.get('jaRecords', `ja:guard:co-arsh:H-${b.code}-1`))!.guard!.personId!;
    expect((await store.get('personLinks', pa))!.groupPersonId).not.toBe((await store.get('personLinks', pb))!.groupPersonId);
    // Foreign workers: FWM management links, HR officers do not; the reason is needed. FWM opens only what it looked up.
    const fwm = await svc.user('u-fwm-mgr');
    await expect(svc.linkHistory(await svc.user('u-pwvsb-hr'), { personId: pb, toPersonId: pa, reason: 'Pasport baharu (ujian)' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.linkHistory(fwm, { personId: pb, toPersonId: pa, reason: 'Pasport baharu PA2222222 menggantikan yang lama (ujian)' })).rejects.toBeInstanceOf(AccessDenied);
    const lookB = await svc.historyLookup(fwm, { idFull: 'PA2222222', nationality: 'NP' });
    expect(lookB.record).toMatchObject({ personId: pb });
    await svc.historyLookup(fwm, { idFull: 'PA1111111', nationality: 'NP' });
    await expect(svc.linkHistory(fwm, { personId: pb, toPersonId: pa, reason: 'x' })).rejects.toBeInstanceOf(BadRequest);
    await svc.linkHistory(fwm, { personId: pb, toPersonId: pa, reason: 'Pasport baharu PA2222222 menggantikan yang lama (ujian)' });
    const h = await svc.groupHistory(fwm, pb);
    if (!h.linked) throw new Error('not linked');
    expect(h.employments.map((e) => e.companyId)).toEqual(['co-sasa', 'co-arsh']);
    expect(h.detail!.links.find((l) => l.personId === pb)!.method).toBe('hr_link');
    // A later record with the new passport still finds the same person.
    const c = companies.find((x) => x.id === 'co-inas')!;
    await svc.jaIngest(feed, 'guard', [guard(c.code, { ...np, idFull: 'PA2222222', hiredOn: '2026-09-01', externalId: 'H-3' })]);
    const pc = (await store.get('jaRecords', `ja:guard:co-inas:H-3`))!.guard!.personId!;
    expect((await store.get('personLinks', pc))!.groupPersonId).toBe((await store.get('personLinks', pa))!.groupPersonId);
    // Separating takes the hand-linked record and the one sharing its number away together.
    await expect(svc.separateHistory(fwm, { personId: pa, reason: 'Bukan orang yang sama (ujian)' })).rejects.toThrow(/same IC or passport/);
    await svc.separateHistory(fwm, { personId: pb, reason: 'Salah pautan, orang lain (ujian)' });
    const gb = (await store.get('personLinks', pb))!.groupPersonId;
    expect((await store.get('personLinks', pc))!.groupPersonId).toBe(gb);
    expect((await store.get('personLinks', pa))!.groupPersonId).not.toBe(gb);
    // Different dates of birth are refused.
    await svc.jaIngest(feed, 'guard', [guard(c.code, { ...np, dob: '1999-01-01', idFull: 'PA3333333', hiredOn: '2026-09-01', externalId: 'H-4', staffNo: 'JA-H-4' })]);
    const pd = (await store.get('jaRecords', `ja:guard:co-inas:H-4`))!.guard!.personId!;
    await svc.historyLookup(fwm, { idFull: 'PA3333333', nationality: 'NP' });
    await expect(svc.linkHistory(fwm, { personId: pd, toPersonId: pa, reason: 'Ujian tarikh lahir berbeza' })).rejects.toThrow(/dates of birth/);
  });

  it('HR adds an employment from an old paper file, and carries a CSG certificate, never the KDN card', async () => {
    const { svc, store, pa, pb } = await returningGuard();
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.addOldEmployment(hr, { personId: pb, companyId: 'co-arsh', role: 'guard', from: '2012-01-01', to: '2011-01-01', ended: 'resigned', sourceRef: 'Fail lama 12/A' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.addOldEmployment(await svc.user('u-cm-inas'), { personId: pb, companyId: 'co-arsh', role: 'guard', from: '2012-01-01', to: '2014-01-01', ended: 'resigned', sourceRef: 'Fail lama 12/A' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.addOldEmployment(hr, { personId: pb, companyId: 'co-arsh', role: 'guard', from: '2012-01-01', to: '2014-12-31', ended: 'resigned', sourceRef: 'Fail lama 12/A (ujian)' });
    const cm = await svc.historyLookup(await svc.user('u-rom-central'), { idFull: IC, nationality: 'MY' });
    expect(cm.summary!.employments.map((e) => e.source)).toEqual(['old_file', 'prima', 'prima']);
    expect(cm.summary!.employments[0].companyName).toMatch(/Arrow/);
    expect(cm.summary!.timesJoined).toBe(3);
    expect(JSON.stringify(cm)).not.toContain('Fail lama');
    // A later JA delivery (which cannot read HR's notes) keeps the old-file line.
    await svc.jaIngest(await svc.user('u-ja-sync'), 'guard', [guard((await store.get('companies', 'co-inas'))!.code, { updatedAt: '2026-10-26T11:00:00+08:00', phone: '012-000 0000' })]);
    expect((await store.get('groupPeople', (await store.get('personLinks', pb))!.groupPersonId))!.employments.some((e) => e.source === 'old_file')).toBe(true);
    // CSG carries from the earlier employment; a KDN card does not.
    const csg = (await store.list('credentials', { personId: pa })).find((c) => c.type === 'CSG_TRAINING')!;
    await expect(svc.carryHistoryPaper(await svc.user('u-cm-inas'), { personId: pb, credentialId: csg.id })).rejects.toBeInstanceOf(AccessDenied);
    const row = await svc.carryHistoryPaper(hr, { personId: pb, credentialId: csg.id });
    expect(row).toMatchObject({ personId: pb, companyId: 'co-inas', type: 'CSG_TRAINING', number: 'CSG-H-1', issuedOn: '2019-09-01' });
    await expect(svc.carryHistoryPaper(hr, { personId: pb, credentialId: csg.id })).rejects.toThrow(/already has/);
    const after = await svc.groupHistory(hr, pb);
    expect(after.linked && after.can.carryPaper).toBe(false);
    await store.insert('credentials', { id: 'cred-kdn-h', companyId: 'co-sasa', personId: pa, type: 'KDN_GUARD_CARD', number: 'KDN-H-1', issuedOn: '2019-04-01', expiresOn: '2021-04-01' });
    await expect(svc.carryHistoryPaper(hr, { personId: pb, credentialId: 'cred-kdn-h' })).rejects.toThrow(/KDN card/);
  });

  it('links existing records once, and the HR board lists returning people for HR; FWM management sees counts only', async () => {
    const { svc, store, pb } = await returningGuard();
    // A record filed before the history existed: an IC behind the wall but no link yet.
    const someone = (await store.list('people', { companyId: 'co-sasa' })).find((p) => p.role === 'guard' && p.nationality === 'MY' && p.status === 'active')!;
    await store.insert('staffIds', { id: someone.id, personId: someone.id, companyId: someone.companyId, idFull: '660606-06-6666', guard: true, updatedAt: NOW, updatedBy: 'test' });
    const hr = await svc.user('u-pwvsb-hr');
    const before = await svc.groupHistoryBoard(hr);
    expect(before.counts.unlinked).toBeGreaterThan(0);
    expect(before.canLinkExisting).toBe(true);
    expect(before.returning.map((r) => r.personId)).toContain(pb);
    const r = await svc.linkExistingRecords(hr);
    expect(r.linked).toBeGreaterThan(0);
    expect(await store.get('personLinks', someone.id)).toBeTruthy();
    expect((await svc.groupHistoryBoard(hr)).counts.unlinked).toBe(0);
    await expect(svc.groupHistoryBoard(await svc.user('u-cm-inas'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.linkExistingRecords(await svc.user('u-cm-inas'))).rejects.toBeInstanceOf(AccessDenied);
    const fwmBoard = await svc.groupHistoryBoard(await svc.user('u-fwm-mgr'));
    expect(fwmBoard.lists).toBe(false);
    expect(fwmBoard.returning).toEqual([]);
    expect(fwmBoard.marked).toEqual([]);
    await expect(svc.groupHistoryBoard(await svc.user('u-rom-central'))).rejects.toBeInstanceOf(AccessDenied);
    // HR finds by the number; nothing about it is kept but the masked form in the audit.
    const found = await svc.historyLookup(hr, { idFull: IC, nationality: 'MY' });
    expect(found.record).toMatchObject({ personId: pb });
    expect(JSON.stringify(await store.list('audit', {}))).not.toContain('880808');
  });

  it('with no key, linking is off and says so; nothing falls back to the plain number', async () => {
    const { svc, store } = fresh();
    svc.idLinks = idLinker(null);
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    await svc.jaIngest(await svc.user('u-ja-sync'), 'guard', [guard(sasa.code)]);
    const pid = (await store.get('jaRecords', `ja:guard:co-sasa:H-${sasa.code}-1`))!.guard!.personId!;
    expect(await store.get('personLinks', pid)).toBeUndefined();
    const h = await svc.groupHistory(await svc.user('u-pwvsb-hr'), pid);
    expect(h.linked).toBe(false);
    expect(h.linkingOn).toBe(false);
    await expect(svc.historyLookup(await svc.user('u-rom-central'), { idFull: IC, nationality: 'MY' })).rejects.toThrow(/off/);
  });

  // Arisha main review of e854efa (4 Nov 2026), findings 1-4.
  it('a do-not-hire mark follows the records when a marked person is linked by hand to a new passport', async () => {
    const { svc, store } = fresh();
    const companies = await store.list('companies', {});
    const a = companies.find((c) => c.id === 'co-sasa')!;
    const b = companies.find((c) => c.id === 'co-arsh')!;
    const feed = await svc.user('u-ja-sync');
    const np = { nationality: 'NP', name: 'Test Nepali Guard', dob: '1995-05-05' };
    await svc.jaIngest(feed, 'guard', [guard(a.code, { ...np, idFull: 'PA1111111', status: 'left', hiredOn: '2020-01-01', leftOn: '2024-12-31', leftHow: 'terminated' })]);
    await svc.jaIngest(feed, 'guard', [guard(b.code, { ...np, idFull: 'PA2222222', hiredOn: '2026-06-01' })]);
    const pa = (await store.get('jaRecords', `ja:guard:co-sasa:H-${a.code}-1`))!.guard!.personId!;
    const pb = (await store.get('jaRecords', `ja:guard:co-arsh:H-${b.code}-1`))!.guard!.personId!;
    await svc.setRehire(await svc.user('u-cos'), { personId: pa, status: 'do_not_rehire', reason: 'Dibuang kerja selepas siasatan (ujian)' });
    const fwm = await svc.user('u-fwm-mgr');
    await svc.historyLookup(fwm, { idFull: 'PA1111111', nationality: 'NP' });
    await svc.historyLookup(fwm, { idFull: 'PA2222222', nationality: 'NP' });
    // The marked old record moves to the new passport's person; its old person empties.
    await svc.linkHistory(fwm, { personId: pa, toPersonId: pb, reason: 'Pasport baharu PA2222222 orang yang sama (ujian)' });
    const rom = await svc.user('u-rom-central');
    const byNew = await svc.historyLookup(rom, { idFull: 'PA2222222', nationality: 'NP' });
    expect(byNew.doNotRehire).toBe(true);
    expect(byNew.summary!.employments).toHaveLength(2);
    const byOld = await svc.historyLookup(rom, { idFull: 'PA1111111', nationality: 'NP' });
    expect(byOld.doNotRehire).toBe(true);
    const gid = (await store.get('personLinks', pb))!.groupPersonId;
    expect((await store.get('groupPersonNotes', gid))!.rehire.some((r) => /carried from linked records/.test(r.reason))).toBe(true);
    expect((await store.list('audit', {})).some((x) => x.action === 'history.mark_carried')).toBe(true);
  });

  it('a decision by lookup binds to the exact keyed number looked up, not the last digits, within 30 minutes', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const clock = { t: Date.parse(NOW) };
    const svc = new PrimaService(store, () => new Date((clock.t += 1000)).toISOString());
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    const feed = await svc.user('u-ja-sync');
    await svc.jaIngest(feed, 'guard', [guard(sasa.code)]);
    // Another person whose number ends in the same four digits.
    await svc.jaIngest(feed, 'guard', [guard(sasa.code, { externalId: 'H-OTHER', staffNo: 'JA-H-OTHER', name: 'Ujian Orang Lain', dob: '1990-01-01', idFull: '900101-01-8888' })]);
    const coo = await svc.user('u-coo');
    await svc.historyLookup(coo, { idFull: IC, nationality: 'MY' });
    await expect(svc.markByLookup(coo, { idFull: '900101-01-8888', nationality: 'MY', status: 'do_not_rehire', reason: 'Salah orang, akhiran sama (ujian)' })).rejects.toThrow(/Look the person up/);
    // Past the window, even the right number needs a fresh lookup.
    clock.t += 31 * 60_000;
    await expect(svc.markByLookup(coo, { idFull: IC, nationality: 'MY', status: 'do_not_rehire', reason: 'Salah laku serius di tapak (ujian)' })).rejects.toThrow(/30 minutes/);
    await svc.historyLookup(coo, { idFull: IC, nationality: 'MY' });
    await svc.markByLookup(coo, { idFull: IC, nationality: 'MY', status: 'do_not_rehire', reason: 'Salah laku serius di tapak (ujian)' });
    expect((await svc.historyLookup(coo, { idFull: '900101-01-8888', nationality: 'MY' })).doNotRehire).toBe(false);
  });

  it('nobody decides about their own history by lookup, even without reading the links', async () => {
    const { svc, store, pb } = await returningGuard();
    for (const id of ['u-coo', 'u-ogm', 'u-opsdir']) {
      await store.update('users', id, { personId: pb });
      const u = await svc.user(id);
      await svc.historyLookup(u, { idFull: IC, nationality: 'MY' });
      await expect(svc.markByLookup(u, { idFull: IC, nationality: 'MY', status: 'eligible', reason: 'Boleh diambil semula (ujian)' })).rejects.toThrow(/your own history/);
      await store.update('users', id, { personId: undefined });
    }
  });

  it('HR officers look up Malaysians only and FWM foreign workers only, before any summary is returned', async () => {
    const { svc, store } = fresh();
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    const feed = await svc.user('u-ja-sync');
    await svc.jaIngest(feed, 'guard', [guard(sasa.code, { nationality: 'NP', name: 'Test Nepali Guard', dob: '1995-05-05', idFull: 'PA5555555' })]);
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.historyLookup(hr, { idFull: 'PA5555555', nationality: 'NP' })).rejects.toThrow(/Malaysians/);
    // Even a foreign group reached under a Malaysian-looking request is not returned to an HR officer.
    const key = svc.idLinks.key('PA5555555', 'NP')!;
    const link = (await store.list('personLinks', { idKey: key }))[0];
    const asLocal = await svc.idLinks.key('PA5555555', 'MY');
    expect(asLocal).not.toBe(key);
    expect(link).toBeTruthy();
    // The HR Director, FWM management and the ROM see the foreign worker.
    expect((await svc.historyLookup(await svc.user('u-cos'), { idFull: 'PA5555555', nationality: 'NP' })).known).toBe(true);
    expect((await svc.historyLookup(await svc.user('u-fwm-mgr'), { idFull: 'PA5555555', nationality: 'NP' })).known).toBe(true);
    expect((await svc.historyLookup(await svc.user('u-rom-central'), { idFull: 'PA5555555', nationality: 'NP' })).known).toBe(true);
    expect(historyPopulation(hr)).toBe('local');
    expect(dataWalls(hr)).toContain('history_local');
    expect(dataWalls(await svc.user('u-cos'))).not.toContain('history_local');
  });

  it('refuses JA leaving fields that do not fit', async () => {
    const { svc, store } = fresh();
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    const feed = await svc.user('u-ja-sync');
    const r = await svc.jaIngest(feed, 'guard', [
      guard(sasa.code, { leftOn: '2026-01-01', leftHow: 'resigned' }),
      guard(sasa.code, { externalId: 'x2', staffNo: 'X2', status: 'left', hiredOn: '2020-01-01', leftOn: '2026-01-01' }),
      guard(sasa.code, { externalId: 'x3', staffNo: 'X3', status: 'left', leftOn: '2020-01-01', leftHow: 'resigned' }),
      guard(sasa.code, { externalId: 'x4', staffNo: 'X4', status: 'left', leftOn: '2026-02-01', leftHow: 'fired' }),
    ]);
    expect(r.accepted).toBe(0);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/only with status left/),
      expect.stringMatching(/together/),
      expect.stringMatching(/after hiredOn/),
      expect.stringMatching(/leftHow must be/),
    ]);
  });
});
