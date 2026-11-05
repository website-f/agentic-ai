// HR slices 3G (guard records from JA) and 3D (payroll checks), Fauzan 2 Nov 2026. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, PrimaService, dataWalls, generateDataset, jaGuardParse, maskIdNumber, minimumWageFor, minimumWageShort, myt, overtimePay, RULES } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '09:00');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => new Date((t += 1000)).toISOString());
  return { ds, store, svc };
}

const guard = (code: string, over: Record<string, unknown> = {}) => ({
  company: code,
  externalId: 'G-T-1',
  updatedAt: '2026-10-26T10:00:00+08:00',
  staffNo: 'JA-T-0001',
  name: 'Test Guard One',
  nationality: 'MY',
  role: 'guard',
  status: 'active',
  dob: '1990-01-01',
  hiredOn: '2025-01-15',
  state: 'Selangor',
  idFull: '900101-10-1234',
  bankName: 'Test Bank',
  accountFull: '1122334455',
  basicPay: 1800,
  epfNo: 'EPF-T-1',
  socsoNo: 'SOC-T-1',
  kdnCard: { number: 'KDN-T-1', issuedOn: '2025-02-01', expiresOn: '2027-02-01' },
  vettingSubmittedOn: '2025-01-10',
  csg: { certificateNo: 'CSG-T-1', doneOn: '2025-06-01' },
  ...over,
});

describe('Slice 3G: guards keyed once in JA', () => {
  it('masks numbers and keeps the full ones off the JA record', () => {
    expect(maskIdNumber('900101-10-1234')).toBe('********1234');
    const g = jaGuardParse(guard('X'));
    expect(g.idFull).toBe('900101-10-1234');
    expect(g.guard.idMasked).toBe('********1234');
    expect(JSON.stringify(g.guard)).not.toContain('900101');
    expect(JSON.stringify(g.guard)).not.toContain('1122334455');
    expect(() => jaGuardParse(guard('X', { role: 'boss' }))).toThrow(BadRequest);
    expect(() => jaGuardParse(guard('X', { idFull: 'x' }))).toThrow(BadRequest);
  });

  it('files the guard as one person with numbers behind the HR wall and papers added once', async () => {
    const { svc, store } = fresh();
    const feed = await svc.user('u-ja-sync');
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    const r = await svc.jaIngest(feed, 'guard', [guard(sasa.code), guard(sasa.code, { externalId: 'G-T-2', staffNo: 'JA-T-2', nationality: 'US' })]);
    expect(r.accepted).toBe(1);
    expect(r.rejected[0].reason).toMatch(/Nationality/);
    const rec = await store.get('jaRecords', 'ja:guard:co-sasa:G-T-1');
    const pid = rec!.guard!.personId!;
    const p = await store.get('people', pid);
    expect(p).toMatchObject({ companyId: 'co-sasa', staffNo: 'JA-T-0001', role: 'guard', idMasked: '********1234', basicPay: 1800 });
    expect((await store.get('staffIds', pid))).toMatchObject({ idFull: '900101-10-1234', guard: true });
    expect((await store.get('staffAccounts', pid))).toMatchObject({ accountFull: '1122334455', guard: true });
    const papers = async () => (await store.list('credentials', { personId: pid })).map((c) => c.type).sort();
    expect(await papers()).toEqual(['CSG_TRAINING', 'KDN_GUARD_CARD', 'KDN_VETTING']);
    // A newer delivery updates the person; papers are not doubled.
    await svc.jaIngest(feed, 'guard', [guard(sasa.code, { updatedAt: '2026-10-26T11:00:00+08:00', basicPay: 1650 })]);
    expect((await store.get('people', pid))!.basicPay).toBe(1650);
    expect(await papers()).toEqual(['CSG_TRAINING', 'KDN_GUARD_CARD', 'KDN_VETTING']);
    // The guard training board now shows the guard to HR, from the same record.
    const before = (await svc.guardTraining(await svc.user('u-pwvsb-hr'))).total;
    expect(before).toBeGreaterThan(0);
    const people = await store.list('people', { companyId: 'co-sasa' });
    expect(people.filter((x) => x.staffNo === 'JA-T-0001').length).toBe(1);
  });

  it('shows guard counts to Operations and the below-minimum-wage list only to pay viewers', async () => {
    const { svc, store } = fresh();
    const feed = await svc.user('u-ja-sync');
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    await svc.jaIngest(feed, 'guard', [guard(sasa.code, { basicPay: 1500 })]);
    const hr = await svc.jaBoard(await svc.user('u-pwvsb-hr'));
    expect(hr.guards.find((g) => g.companyId === 'co-sasa')!.active).toBe(1);
    expect(hr.belowMinimumWage.map((g) => g.staffNo)).toEqual(['JA-T-0001']);
    const cm = await svc.jaBoard(await svc.user('u-cm-sasa'));
    expect(cm.belowMinimumWage.length).toBe(1);
    const od = await svc.jaBoard(await svc.user('u-opsdir'));
    expect(od.datasets).toContain('guard');
    expect(od.belowMinimumWage).toEqual([]);
  });

  it('never lets a JA row match, change or take over an office staff member (review, 2 Nov 2026)', async () => {
    const { svc, store, ds } = fresh();
    const feed = await svc.user('u-ja-sync');
    const office = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'office')!;
    expect(office).toBeTruthy();
    const before = JSON.stringify(await store.get('people', office.id));
    const idsBefore = JSON.stringify(await store.get('staffIds', office.id));
    const acctBefore = JSON.stringify(await store.get('staffAccounts', office.id));
    const credsBefore = (await store.list('credentials', { personId: office.id })).length;
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    const r = await svc.jaIngest(feed, 'guard', [guard(sasa.code, { staffNo: office.staffNo, externalId: 'G-COLLIDE' }), guard(sasa.code, { externalId: 'G-OK', staffNo: 'JA-T-OK' })]);
    expect(r.accepted).toBe(1);
    expect(r.rejected).toEqual([{ externalId: 'G-COLLIDE', reason: expect.stringMatching(/office staff/) }]);
    expect(JSON.stringify(await store.get('people', office.id))).toBe(before);
    expect(JSON.stringify(await store.get('staffIds', office.id))).toBe(idsBefore);
    expect(JSON.stringify(await store.get('staffAccounts', office.id))).toBe(acctBefore);
    expect((await store.list('credentials', { personId: office.id })).length).toBe(credsBefore);
    expect(await store.get('jaRecords', 'ja:guard:co-sasa:G-COLLIDE')).toBeFalsy();
    // A newer copy of the same refused row is still refused.
    const again = await svc.jaIngest(feed, 'guard', [guard(sasa.code, { staffNo: office.staffNo, externalId: 'G-COLLIDE', updatedAt: '2026-10-26T12:00:00+08:00' })]);
    expect(again.accepted).toBe(0);
    expect((await store.get('people', office.id))!.role).toBe('office');
  });

  it('refuses a full-number row not marked as a guard’s, before changing anything', async () => {
    const { svc, store } = fresh();
    const feed = await svc.user('u-ja-sync');
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    const pid = 'p-ja-co-sasa-JA-T-0001';
    await store.insert('staffIds', { id: pid, personId: pid, companyId: 'co-sasa', idFull: 'HR-KEPT-1', updatedAt: NOW, updatedBy: 'HR' });
    const r = await svc.jaIngest(feed, 'guard', [guard(sasa.code)]);
    expect(r.accepted).toBe(0);
    expect(r.rejected[0].reason).toMatch(/not marked as a guard/);
    expect(await store.get('people', pid)).toBeFalsy();
    expect((await store.get('staffIds', pid))!.idFull).toBe('HR-KEPT-1');
  });

  it('refuses a company the feed is not granted, and keeps a guard in its own company', async () => {
    const { svc, store } = fresh();
    const feed = await svc.user('u-ja-sync');
    const r = await svc.jaIngest(feed, 'guard', [guard('NO-SUCH-CO')]);
    expect(r.rejected[0].reason).toMatch(/not in Prima/);
    const [sasa, arsh] = ['co-sasa', 'co-arsh'].map((id) => store.list('companies', {}).then((cs) => cs.find((c) => c.id === id)!));
    await svc.jaIngest(feed, 'guard', [guard((await sasa).code)]);
    await svc.jaIngest(feed, 'guard', [guard((await arsh).code)]);
    const a = (await store.list('people', { companyId: 'co-sasa' })).filter((p) => p.staffNo === 'JA-T-0001');
    const b = (await store.list('people', { companyId: 'co-arsh' })).filter((p) => p.staffNo === 'JA-T-0001');
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('gives the JA feed its own guard wall and FWM the foreign passport wall', async () => {
    const { svc } = fresh();
    expect(dataWalls(await svc.user('u-ja-sync'))).toEqual(['guard_feed']);
    expect(dataWalls(await svc.user('u-fwm-mgr'))).toContain('fw_ids');
    expect(dataWalls(await svc.user('u-fwm-mgr'))).not.toContain('staff_ids');
    expect(dataWalls(await svc.user('u-cm-sasa'))).not.toContain('guard_feed');
  });
});

describe('Slice 3D: minimum wage, overtime, statutory files', () => {
  it('knows the minimum wage on the day and flags pay below it', () => {
    expect(minimumWageFor('2025-01-31')).toBe(1500);
    expect(minimumWageFor('2026-10')).toBe(1700);
    expect(minimumWageShort(1600, '2026-10-26')).toBe(100);
    expect(minimumWageShort(1800, '2026-10-26')).toBe(0);
    expect(minimumWageShort(null, '2026-10-26')).toBe(0);
  });

  it('works overtime at basic / 26 / 8 and the day rate', () => {
    const r = RULES.staffOvertime.value;
    const x = overtimePay(2600, 4, 'restDay', r);
    expect(x).toEqual({ hourly: 12.5, rate: 2, amount: 100, coveredByAct: true });
    expect(overtimePay(5000, 1, 'normal', r).coveredByAct).toBe(false);
  });

  it('keeps overtime off until HR turns it on with a reason, never below the Act', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const b = await svc.staffOvertime(hr);
    expect(b.setting.enabled).toBe(false);
    expect(b.canEdit).toBe(true);
    const staff = ds.people.find((p) => p.role === 'office' && p.status === 'active')!;
    const g = ds.people.find((p) => p.role === 'guard')!;
    const base = { enabled: true, normal: 1.5, restDay: 2, publicHoliday: 3, personIds: [staff.id], comment: 'Month end close' };
    await expect(svc.setStaffOvertime(await svc.user('u-fd'), base)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setStaffOvertime(hr, { ...base, comment: ' ' })).rejects.toThrow(/comment/);
    await expect(svc.setStaffOvertime(hr, { ...base, normal: 1.2 })).rejects.toThrow(/below 1.5/);
    await expect(svc.setStaffOvertime(hr, { ...base, personIds: [g.id] })).rejects.toThrow(/office staff/);
    await svc.setStaffOvertime(hr, base);
    const second = await svc.setStaffOvertime(hr, { ...base, normal: 2, comment: 'Raised' });
    expect(second.history[0].normal).toBe(1.5);
    const prev = await svc.overtimePreview(hr, { personId: staff.id, hours: 2, kind: 'normal' });
    expect(prev.eligible).toBe(true);
    expect(prev.rate).toBe(2);
    await expect(svc.overtimePreview(await svc.user('u-fd'), { personId: staff.id, hours: 2, kind: 'normal' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('puts the full IC on HR’s EPF and SOCSO files and a masked one on Finance’s', async () => {
    const { svc, store } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const run = 'sp-pwvsb-2026-10';
    await svc.staffPayStep(await svc.user('u-cos'), run, 'approve', { note: 'Checked' });
    await svc.staffPayStep(await svc.user('u-coo'), run, 'coo_approve', { note: 'Approved' });
    const line = (await store.get('staffPayRuns', run))!.lines[0];
    const full = (await store.get('staffIds', line.personId))?.idFull;
    const epfHr = await svc.staffPayExport(hr, run, 'epf');
    expect(epfHr.body.split('\n')[1]).toBe('Staff no,Name,IC / passport,EPF number,Wages,Employee,Employer,Table row');
    if (full) expect(epfHr.body).toContain(full);
    const fin = await svc.staffPayExport(await svc.user('u-fin-t1-lead'), run, 'socso');
    expect(fin.body.split('\n')[1]).toContain('IC / passport,SOCSO number');
    if (full) expect(fin.body).not.toContain(full);
  });
});

describe('HR legal points for the directors only (review, 2 Nov 2026)', () => {
  it('shows the points only to the HR Director and the CEO, all unresolved at first', async () => {
    const { svc } = fresh();
    for (const id of ['u-pwvsb-hr', 'u-cm-sasa', 'u-it-ex3', 'u-fd', 'u-coo', 'u-ja-sync'])
      await expect(svc.hrLegalChecks(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    const cos = await svc.hrLegalChecks(await svc.user('u-cos'));
    expect(cos.rows.length).toBeGreaterThanOrEqual(5);
    expect(cos.rows.every((r) => r.status === 'unresolved' && r.sources.length > 0)).toBe(true);
    expect(JSON.stringify(cos)).not.toMatch(/compliant/i);
    expect((await svc.hrLegalChecks(await svc.user('u-fauzan'))).rows.length).toBe(cos.rows.length);
    expect(dataWalls(await svc.user('u-cos'))).toContain('hr_legal');
    expect(dataWalls(await svc.user('u-pwvsb-hr'))).not.toContain('hr_legal');
  });

  it('keeps who, status and why for every change, and only a director is made responsible', async () => {
    const { svc, store } = fresh();
    const cos = await svc.user('u-cos');
    await expect(svc.updateHrLegalCheck(cos, 'face-data', { status: 'in_review', directorId: null, note: ' ' })).rejects.toThrow(/comment/);
    await expect(svc.updateHrLegalCheck(cos, 'face-data', { status: 'resolved', directorId: null, note: 'done' })).rejects.toThrow(/evidence/);
    await expect(svc.updateHrLegalCheck(cos, 'face-data', { status: 'in_review', directorId: 'u-pwvsb-hr', note: 'x' })).rejects.toThrow(/HR Director or the CEO/);
    await expect(svc.updateHrLegalCheck(cos, 'nope', { status: 'in_review', directorId: null, note: 'x' })).rejects.toThrow();
    await expect(svc.updateHrLegalCheck(await svc.user('u-pwvsb-hr'), 'face-data', { status: 'in_review', directorId: null, note: 'x' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.updateHrLegalCheck(cos, 'face-data', { status: 'in_review', directorId: 'u-cos', note: 'Checking with counsel' });
    const row = await svc.updateHrLegalCheck(await svc.user('u-fauzan'), 'face-data', { status: 'resolved', directorId: null, note: 'Notice issued by memo, kept in the HR file' });
    expect(row.director?.id).toBe('u-cos');
    expect(row.history.map((h) => h.status)).toEqual(['resolved', 'in_review']);
    const audit = (await store.list('audit', {})).filter((a) => a.action === 'hr.legal_point');
    expect(audit.length).toBe(2);
  });
});
