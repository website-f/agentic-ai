// Part W (Fitri package, KDN licence renewal 2027, Fauzan's answers W-X1..W-X13, 14 Nov 2026): the KDN checklist,
// date checks, eSIMS, the Hari Bertemu Pelanggan appointment and result, counts, Nepali eSIMS, SST, director signature,
// the pendrive pack and the group board. Made-up data only, in memory. PostgreSQL is tested apart in
// apps/api/test/kdn-renewal-pg.test.ts.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, generateDataset, myt, RULES, type CompanyLicence, type User } from '../src';

const TODAY = '2026-11-18';
const NOW = myt(TODAY, '10:00');
const LIC = 'lic-co-sasa-kdn_licence';
const PDF = (n: string) => [{ kind: 'document', name: `${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${n}`).toString('base64')}` }];

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const cm = ds.users.find((u) => u.id === 'u-cm-sasa')!;
  // A synthetic director sign-in of the company (the seed has none; real director sign-ins are set up by IT).
  ds.users.push({ ...cm, id: 'u-dir-test', name: 'Director T (test)', role: 'director', title: 'Pengarah', leadership: undefined } as User);
  const pl = ds.insurancePolicies.find((x) => x.companyId === 'co-sasa' && x.kind === 'PUBLIC_LIABILITY' && x.expiresOn > '2027-01-01')!;
  const store = new MemoryStore(ds);
  let clock = NOW;
  const svc = new PrimaService(store, () => clock);
  const act = async (uid: string, op: string, i: Record<string, unknown>) => svc.kdnAct(await svc.user(uid), op, i);
  const lic = () => ds.licences.find((l) => l.id === LIC)! as CompanyLicence;
  const addPi = () => ds.insurancePolicies.push({ ...pl, id: 'ins-test-pi', kind: 'PROFESSIONAL_INDEMNITY', policyNo: 'PI-TEST' });
  return { ds, svc, act, lic, addPi, setClock: (t: string) => (clock = t) };
}
const paper = (act: ReturnType<typeof fresh>['act'], item: string, extra: Record<string, unknown> = {}) => act('u-ae-sasa', 'paper', { licenceId: LIC, item, docs: PDF(`p${item}`), ...extra });

describe('Part W KDN licence renewal 2027', () => {
  it('W1: opening copies the KDN checklist of the year; a later template change does not touch it', async () => {
    const { act, lic } = fresh();
    await expect(act('u-dcos', 'open', { licenceId: LIC })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-ae-sasa', 'open', { licenceId: LIC });
    const r = lic().renewal!;
    expect(r.kdn!.year).toBe(2027);
    expect(r.papers.map((p) => p.kdn!.item)).toEqual(RULES.kdnRenewal.value.template.lines.map((l) => l.item));
    expect(r.papers.length).toBe(15);
    // Central Admin loads a new template with a reason; the open renewal keeps its own copy.
    await expect(act('u-dcos', 'setSetting', { kind: 'template', year: 2027, value: { lines: [{ item: '9.9', label: '1', name: 'X', form: 'softcopy' }] } })).rejects.toThrow(/reason/);
    await act('u-dcos', 'setSetting', { kind: 'template', year: 2027, reason: 'KDN letter update (test)', value: { lines: [{ item: '9.9', label: '1', name: 'New paper', form: 'softcopy' }] } });
    expect(lic().renewal!.papers.length).toBe(15);
    await expect(act('u-cm-sasa', 'setSetting', { kind: 'template', year: 2027, reason: 'try', value: {} })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('W2: each paper needs its file and passes its date check; not applicable needs a reason', async () => {
    const { act, lic, addPi } = fresh();
    await act('u-ae-sasa', 'open', { licenceId: LIC });
    await expect(act('u-ae-sasa', 'paper', { licenceId: LIC, item: '1.2', docDate: '2026-10-01' })).rejects.toThrow(/PDF/);
    await expect(paper(act, '1.2', { docDate: '2026-08-15' })).rejects.toThrow(/2026-09-01/);
    await paper(act, '1.2', { docDate: '2026-10-01' });
    await expect(paper(act, '3.1', { from: '2026-02', to: '2026-07' })).rejects.toThrow(/Januari|Jan/);
    await paper(act, '3.1', { from: '2026-01', to: '2026-07' });
    await expect(paper(act, '3.3', { year: 2026 })).rejects.toThrow(/CP204/);
    await paper(act, '3.3', { year: 2026, both: true });
    await expect(paper(act, '3.5', { year: 2024 })).rejects.toThrow(/2025/);
    await expect(paper(act, '3.7', { month: '2026-08' })).rejects.toThrow(/terlalu lama/);
    await paper(act, '3.7', { month: '2026-10' });
    // Insurance: Professional Indemnity must be in force too (W4).
    await expect(paper(act, '3.6')).rejects.toThrow(/Indemniti Profesional/);
    addPi();
    await paper(act, '3.6');
    // Counts must be confirmed by the company head first.
    await expect(paper(act, '4.1')).rejects.toThrow(/Ketua syarikat/);
    // 2.1 may be not applicable, with a reason; 1.2 may not.
    await expect(act('u-ae-sasa', 'paper', { licenceId: LIC, item: '1.2', na: true, reason: 'none' })).rejects.toThrow(/every company/);
    await expect(act('u-ae-sasa', 'paper', { licenceId: LIC, item: '2.1', na: true })).rejects.toThrow(/why/);
    await act('u-ae-sasa', 'paper', { licenceId: LIC, item: '2.1', na: true, reason: 'No firearm licence (test)' });
    const r = lic().renewal!;
    expect(r.papers.find((p) => p.kdn!.item === '2.1')!.kdn!.na).toMatch(/No firearm/);
    expect(r.papers.find((p) => p.kdn!.item === '1.2')!.kdn!.docIds.length).toBe(1);
    // Another company's staff cannot touch this company's papers.
    await expect(act('u-cm-arsh', 'paper', { licenceId: LIC, item: '1.3', docs: PDF('x'), docDate: '2026-10-01' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('W5-W13: appointment, counts, Nepali eSIMS, SST, check, director signature, pack and accepted result', async () => {
    const { ds, act, lic, addPi, svc } = fresh();
    addPi();
    await act('u-ae-sasa', 'open', { licenceId: LIC });
    // Appointment: inside a session, a weekday, session 7 only after papers lacking, an eSIMS reference.
    await expect(act('u-ae-sasa', 'appointment', { licenceId: LIC, session: 5, on: '2026-11-28', ref: 'JT-1', attendee: 'Admin (test)' })).rejects.toThrow(/sesi 5/);
    await expect(act('u-ae-sasa', 'appointment', { licenceId: LIC, session: 7, on: '2026-12-14', ref: 'JT-1', attendee: 'Admin (test)' })).rejects.toThrow(/dikembalikan/);
    await act('u-ae-sasa', 'appointment', { licenceId: LIC, session: 6, on: '2026-12-08', time: '09:00', ref: 'JT-1', attendee: 'Admin (test)' });
    await expect(act('u-ae-sasa', 'appointment', { licenceId: LIC, session: 6, on: '2026-12-09', ref: 'JT-2', attendee: 'Admin (test)' })).rejects.toThrow(/reason/);
    await act('u-ae-sasa', 'appointment', { licenceId: LIC, session: 5, on: '2026-11-24', ref: 'JT-2', attendee: 'Admin (test)', reason: 'earlier slot (test)' });
    expect(lic().renewal!.kdn!.appointmentChanges.length).toBe(1);
    // Counts: only the company head confirms, with a reason; local guards only.
    await expect(act('u-ae-sasa', 'counts', { licenceId: LIC, reason: 'checked' })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-cm-sasa', 'counts', { licenceId: LIC, reason: 'checked against JA (test)' });
    const c = lic().renewal!.kdn!.counts!;
    expect(c.local + c.nepali).toBe(ds.people.filter((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role !== 'office').length);
    expect(c.nepali).toBeGreaterThan(0);
    // Papers.
    for (const it of ['1.2', '1.3']) await paper(act, it, { docDate: '2026-10-05' });
    await paper(act, '1.4', { signer: 'Director T (test)' });
    await act('u-ae-sasa', 'paper', { licenceId: LIC, item: '2.1', na: true, reason: 'No firearm licence (test)' });
    for (const it of ['3.1', '3.2']) await paper(act, it, { from: '2026-01', to: '2026-07' });
    await paper(act, '3.3', { year: 2026, both: true });
    await paper(act, '3.4', { year: 2026 });
    await paper(act, '3.5', { year: 2025 });
    await paper(act, '3.6');
    await paper(act, '3.7', { month: '2026-10' });
    await paper(act, '4.1');
    await paper(act, '4.2');
    // Pledge filed for ACT.
    expect(ds.kdnRecs.some((x) => x.kind === 'pledge' && x.companyId === 'co-sasa' && x.year === 2027)).toBe(true);
    // What still blocks the director.
    const blocks = await svc.kdn.signBlocks(lic());
    expect(blocks.join('|')).toMatch(/eSIMS update/);
    expect(blocks.join('|')).toMatch(/investigators/);
    expect(blocks.join('|')).toMatch(/Nepal/);
    expect(blocks.join('|')).toMatch(/SST/);
    expect(blocks.join('|')).toMatch(/checked/);
    await act('u-ae-sasa', 'esims', { licenceId: LIC, on: TODAY });
    await act('u-ae-sasa', 'esims', { licenceId: LIC, what: 'investigators', on: TODAY });
    // Nepali guards: FWM only.
    const np = ds.people.filter((p) => p.companyId === 'co-sasa' && p.status === 'active' && p.role !== 'office' && p.nationality === 'NP');
    await expect(act('u-cm-sasa', 'fwEsims', { personId: np[0].id })).rejects.toBeInstanceOf(AccessDenied);
    for (const p of np) await act('u-fwm-mgr', 'fwEsims', { personId: p.id, on: TODAY });
    // SST: Finance only, with the MySST reference.
    await expect(act('u-cm-sasa', 'sst', { companyId: 'co-sasa', ref: 'MYSST-1' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(act('u-fd', 'sst', { companyId: 'co-sasa' })).rejects.toThrow(/MySST/);
    await act('u-fd', 'sst', { companyId: 'co-sasa', ref: 'MYSST-TEST-1', on: TODAY });
    // The company manager checks; an admin executive cannot.
    await expect(act('u-ae-sasa', 'check', { licenceId: LIC })).rejects.toBeInstanceOf(AccessDenied);
    await act('u-cm-sasa', 'check', { licenceId: LIC });
    expect(await svc.kdn.signBlocks(lic())).toEqual([]);
    // Only a director signs; the checker or a company manager without a director seat cannot; the declaration is ticked.
    await expect(act('u-cm-sasa', 'sign', { licenceId: LIC, declaration: true })).rejects.toBeInstanceOf(AccessDenied);
    await expect(act('u-dir-test', 'sign', { licenceId: LIC })).rejects.toThrow(/declaration/);
    await act('u-dir-test', 'sign', { licenceId: LIC, declaration: true });
    expect(lic().renewal!.kdn!.director!.name).toBe('Director T (test)');
    // Pack: own company docs only, renamed by KDN label, with the cover list.
    await expect(act('u-cm-arsh', 'pack', { licenceId: LIC })).rejects.toBeInstanceOf(AccessDenied);
    const pack = (await act('u-ae-sasa', 'pack', { licenceId: LIC })) as { name: string; base64: string; files: string[] };
    expect(pack.files[0]).toBe('00_Senarai_semak.txt');
    expect(pack.files).toContain('01_1.2_' + pack.files.find((f) => f.startsWith('01_1.2_'))!.slice(7));
    expect(pack.files.some((f) => f.startsWith('10_3.6_'))).toBe(true);
    expect(pack.files.some((f) => f.includes('2.1'))).toBe(false);
    expect(Buffer.from(pack.base64, 'base64').subarray(0, 2).toString()).toBe('PK');
    // Old-style submit is refused for KDN; the result of the day records it.
    const cmU = await svc.user('u-cm-sasa');
    await expect(svc.renewalStep(cmU, LIC, 'submit', { ref: 'x' })).rejects.toThrow(/session result/);
    await expect(act('u-ae-sasa', 'result', { licenceId: LIC, kind: 'accepted', on: TODAY })).rejects.toThrow(/fee/);
    await svc.renewalStep(cmU, LIC, 'fee', { ref: 'FIN-TEST-1', amount: 1000 });
    await act('u-ae-sasa', 'result', { licenceId: LIC, kind: 'accepted', on: TODAY, ref: 'KDN-ACK-1' });
    expect(lic().renewal!.submitted).toBeTruthy();
    const board = (await act('u-dcos', 'board', {})) as { rows: { companyId: string; stage: string; hints: unknown }[]; pledges: { filed: number } };
    const row = board.rows.find((x) => x.companyId === 'co-sasa')!;
    expect(row.stage).toBe('accepted');
    // Central Admin monitors; company-only hints are not shown to it.
    expect(row.hints).toBeNull();
    expect(board.pledges.filed).toBe(1);
  });

  it('W5c: papers lacking reopen the named papers, clear the signature and allow session 7', async () => {
    const { act, lic, addPi } = fresh();
    addPi();
    await act('u-ae-sasa', 'open', { licenceId: LIC });
    await act('u-ae-sasa', 'appointment', { licenceId: LIC, session: 5, on: '2026-11-24', ref: 'JT-1', attendee: 'Admin (test)' });
    await paper(act, '1.2', { docDate: '2026-10-05' });
    await expect(act('u-ae-sasa', 'result', { licenceId: LIC, kind: 'lacking', on: TODAY })).rejects.toThrow(/asked for/);
    await act('u-ae-sasa', 'result', { licenceId: LIC, kind: 'lacking', on: TODAY, lacking: ['1.2'], note: 'Old print (test)' });
    const r = lic().renewal!;
    expect(r.papers.find((p) => p.kdn!.item === '1.2')!.done).toBeNull();
    expect(r.kdn!.appointment).toBeNull();
    // Session 7 is now open to this company.
    await act('u-ae-sasa', 'appointment', { licenceId: LIC, session: 7, on: '2026-12-15', ref: 'JT-7', attendee: 'Admin (test)' });
    expect(lic().renewal!.kdn!.appointment!.session).toBe(7);
  });

  it('W11 and W14: 2(b) off needs Central Admin and a reason; the ladder flags late companies to DCoS, CoS and CEO', async () => {
    const { act, lic, setClock, svc } = fresh();
    await act('u-ae-sasa', 'open', { licenceId: LIC });
    await expect(act('u-cm-sasa', 'twoB', { licenceId: LIC, on: false, reason: 'no investigators' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(act('u-dcos', 'twoB', { licenceId: LIC, on: false })).rejects.toThrow(/reason/);
    await act('u-dcos', 'twoB', { licenceId: LIC, on: false, reason: 'Company has no 2(b) line (test)' });
    expect(lic().renewal!.kdn!.twoB).toBe(false);
    expect((await svc.kdn.signBlocks(lic())).join('|')).not.toMatch(/investigators/);
    // After the 23 Nov booking date with no appointment: the CoS rung; after 11 Dec: the CEO.
    setClock(myt('2026-11-25', '09:00'));
    let b = (await act('u-dcos', 'board', {})) as { rows: { companyId: string; late: string | null }[] };
    expect(b.rows.find((x) => x.companyId === 'co-sasa')!.late).toBe('CoS');
    setClock(myt('2026-12-12', '09:00'));
    b = (await act('u-dcos', 'board', {})) as { rows: { companyId: string; late: string | null }[] };
    expect(b.rows.find((x) => x.companyId === 'co-sasa')!.late).toBe('CEO');
    const home = await svc.kdn.homeItems(await svc.user('u-fauzan'));
    expect(home.some((h) => h.tag === 'KDN')).toBe(true);
  });
});
