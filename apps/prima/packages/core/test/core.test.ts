import { describe, expect, it, onTestFinished } from 'vitest';
import {
  DEMO_PIN_KEEPER,
  demoPin,
  MemoryStore,
  accumulatedDepn,
  monthDepn,
  type AmAsset,
  PrimaService,
  RuleBlocked,
  AccessDenied,
  GROUP_EMPLOYER_ID,
  jaOwns,
  type JaArea,
  epfShare,
  socsoShare,
  eisShare,
  pcbEstimate,
  lindungShare,
  contractBilling,
  branchSplit,
  BadRequest,
  RULES,
  itTenderClock,
  isGroupLeader,
  fwStage,
  fwDeadline,
  fwServicePlan,
  can,
  addDays,
  BRANCH_CHECKS,
  addMinutes,
  ageOn,
  appendAudit,
  checkAssignment,
  deployability,
  distanceM,
  evaluateClockIn,
  evaluateFace,
  expiryStatus,
  generateDataset,
  myt,
  toMs,
  sha256Hex,
  slaDue,
  tenderEligibility,
  tenderHourly,
  socsoTriage,
  socsoForm34Clock,
  socsoPayrollTreatment,
  socsoDocItems,
  socsoDutyFindings,
  socsoCheckIn,
  tenderPriority,
  armsOverdueState,
  armsIssueCheck,
  verifyChain,
  worst,
  type AuditEntry,
  type Dataset,
  type Person,
  type Shift,
  type Site,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

const daysBetweenDates = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
let proofN = 0;
/** A unique test document as case proof (rule CASE-PROOF). */
function proof(): { kind: 'document'; name: string; data: string } {
  proofN += 1;
  return { kind: 'document', name: `Report ${proofN}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 proof ${proofN}`).toString('base64')}` };
}

/** A second person of the company who signs in as witness with staff number and PIN (insider abuse audit, 27 Oct 2026). */
function witnessIn(ds: Dataset, companyId: string, notIds: (string | null | undefined)[] = []): { staffNo: string; pin: string } {
  const p = ds.people.find((x) => x.companyId === companyId && x.status === 'active' && x.pinHash && !notIds.includes(x.id))!;
  return { staffNo: p.staffNo, pin: demoPin(p.staffNo) };
}

function fresh(): { ds: Dataset; svc: PrimaService; store: MemoryStore } {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

/**
 * Prima's own screens stay on until the JA Group app's API is live (Fauzan, 27 Oct 2026). These tests hand an area to
 * the JA app for one call, to prove the switch works when a feed goes live.
 */
async function withJaOwns<T>(areas: JaArea[], fn: () => Promise<T>): Promise<T> {
  const owns = RULES.jaGroupApp.value.owns;
  const saved = [...owns];
  owns.splice(0, owns.length, ...areas);
  try {
    return await fn();
  } finally {
    owns.splice(0, owns.length, ...saved);
  }
}

describe('sha256 and audit chain', () => {
  it('matches known SHA-256 vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('detects a tampered entry', () => {
    const log: AuditEntry[] = [];
    for (let i = 0; i < 5; i++) {
      appendAudit(log, { at: NOW, actor: 'test', companyId: 'co-x', action: 'a', entity: 'e', entityId: String(i), summary: `entry ${i}` });
    }
    expect(verifyChain(log)).toBeNull();
    log[2] = { ...log[2], summary: 'changed' };
    expect(verifyChain(log)).toBe(3);
  });
});

describe('time and expiry', () => {
  it('computes age on a date', () => {
    expect(ageOn('1966-10-27', '2026-10-26')).toBe(59);
    expect(ageOn('1966-10-26', '2026-10-26')).toBe(60);
  });

  it('never shows a missing record as OK', () => {
    expect(expiryStatus(undefined, TODAY, 90).status).toBe('UNKNOWN');
    expect(worst(['OK', 'UNKNOWN', 'DUE'])).toBe('UNKNOWN');
    expect(worst(['OK', 'OVERDUE', 'UNKNOWN'])).toBe('OVERDUE');
  });

  it('applies lead times', () => {
    expect(expiryStatus(addDays(TODAY, 100), TODAY, 120).status).toBe('DUE');
    expect(expiryStatus(addDays(TODAY, 121), TODAY, 120).status).toBe('OK');
    expect(expiryStatus(addDays(TODAY, -1), TODAY, 120).status).toBe('OVERDUE');
  });

  it('sets SLA due times by severity', () => {
    expect(slaDue('P1', NOW)).toBe(myt(TODAY, '10:35'));
    expect(slaDue('P2', NOW)).toBe(myt(TODAY, '11:00'));
    expect(slaDue('P3', NOW)).toBe(myt(TODAY, '23:59'));
    // Monday + 2 working days = Wednesday
    expect(slaDue('P4', NOW)).toBe(myt('2026-10-28', '18:00'));
  });
});

const basePerson: Person = {
  id: 'p1',
  companyId: 'co-a',
  branchId: 'b1',
  staffNo: 'A0001',
  name: 'Test Guard',
  nationality: 'MY',
  idMasked: '',
  dob: '1990-01-01',
  phone: '',
  role: 'guard',
  status: 'active',
  hiredOn: '2020-01-01',
  pinHash: DEMO_PIN_KEEPER.hash('1234'),
  faceEnrolledOn: '2020-01-03',
};
const site: Site = {
  id: 's1',
  companyId: 'co-a',
  branchId: 'b1',
  code: 'A-001',
  name: 'Site',
  client: '',
  address: '',
  lat: 3.1,
  lng: 101.6,
  risk: 'low',
  armed: false,
  geofenceM: 150,
};
const goodCreds = [
  { id: 'c1', companyId: 'co-a', personId: 'p1', type: 'KDN_GUARD_CARD' as const, number: '', issuedOn: '2025-01-01', expiresOn: '2027-12-31' },
  { id: 'c2', companyId: 'co-a', personId: 'p1', type: 'CSG_TRAINING' as const, number: '', issuedOn: '2024-01-01', expiresOn: null },
];
function shift(id: string, date: string, start: string, end: string, endDate = date): Shift {
  return { id, companyId: 'co-a', siteId: 's1', postId: 'po1', personId: null, date, start: myt(date, start), end: myt(endDate, end), status: 'draft' };
}

describe('deployability', () => {
  it('clears a guard with valid papers', () => {
    expect(deployability(basePerson, goodCreds, TODAY, false)).toEqual([]);
  });

  it('blocks guards over 60', () => {
    const f = deployability({ ...basePerson, dob: '1965-01-01' }, goodCreds, TODAY, false);
    expect(f.map((x) => x.code)).toContain('OVER_AGE');
  });

  it('requires foreign worker papers for Nepali guards', () => {
    const f = deployability({ ...basePerson, nationality: 'NP' }, goodCreds, TODAY, false);
    expect(f.filter((x) => x.level === 'block').map((x) => x.code)).toEqual(
      expect.arrayContaining(['MISSING_PLKS_PERMIT', 'MISSING_PASSPORT', 'MISSING_FOMEMA', 'MISSING_FW_INSURANCE']),
    );
  });

  it('requires a firearm permit only for armed posts', () => {
    expect(deployability(basePerson, goodCreds, TODAY, true).map((x) => x.code)).toContain('MISSING_FIREARM_PERMIT');
  });
});

describe('roster checks', () => {
  it('blocks more than 12 hours in a day and overlaps', () => {
    const existing = { ...shift('a', TODAY, '07:00', '15:00'), personId: 'p1' };
    const f = checkAssignment({ person: basePerson, credentials: goodCreds, shift: shift('b', TODAY, '13:00', '19:00'), site, otherShifts: [existing] });
    expect(f.map((x) => x.code)).toEqual(expect.arrayContaining(['OVER_12_HOURS', 'OVERLAP']));
  });

  it('blocks deploying another company’s guard', () => {
    const f = checkAssignment({
      person: { ...basePerson, companyId: 'co-b' },
      credentials: goodCreds,
      shift: shift('b', TODAY, '07:00', '19:00'),
      site,
      otherShifts: [],
    });
    expect(f[0].code).toBe('OTHER_COMPANY');
  });

  it('warns on a seventh day in a row', () => {
    const others = [1, 2, 3, 4, 5, 6].map((i) => ({ ...shift(`d${i}`, addDays(TODAY, -i), '07:00', '19:00'), personId: 'p1' }));
    const f = checkAssignment({ person: basePerson, credentials: goodCreds, shift: shift('n', TODAY, '07:00', '19:00'), site, otherShifts: others });
    expect(f.find((x) => x.code === 'NO_REST_DAY')?.level).toBe('warn');
  });
});

describe('attendance', () => {
  it('flags late, outside geofence, no photo and offline', () => {
    const s = shift('s', TODAY, '07:00', '19:00');
    const r = evaluateClockIn({
      shift: s,
      site,
      at: myt(TODAY, '07:30'),
      receivedAt: myt(TODAY, '08:30'),
      lat: 3.2,
      lng: 101.6,
      face: null,
      faceEnrolled: true,
    });
    expect(r.flags).toEqual(['LATE', 'OUTSIDE_GEOFENCE', 'NO_PHOTO', 'OFFLINE_SYNC']);
    expect(r.distanceM).toBeGreaterThan(10_000);
  });

  it('checks the face 1:1 against the enrolled face', () => {
    expect(evaluateFace({ score: 0.93, live: true }, true)).toEqual([]);
    expect(evaluateFace({ score: 0.5, live: true }, true)).toEqual(['FACE_NOT_MATCHED']);
    expect(evaluateFace({ score: 0.95, live: false }, true)).toEqual(['NO_LIVENESS']);
    expect(evaluateFace({ score: 0.95, live: true }, false)).toEqual(['NO_FACE_ENROLMENT']);
    expect(evaluateFace(null, true)).toEqual(['NO_PHOTO']);
  });

  it('computes distance in metres', () => {
    expect(distanceM(3.1, 101.6, 3.1, 101.6)).toBe(0);
    expect(Math.abs(distanceM(3.1, 101.6, 3.101, 101.6) - 111)).toBeLessThan(2);
  });
});

describe('mock data', () => {
  it('is deterministic and shaped like the group', () => {
    const a = generateDataset({ today: TODAY, now: NOW });
    const b = generateDataset({ today: TODAY, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.companies).toHaveLength(38);
    expect(a.companies.filter((c) => c.isPilot).map((c) => c.name)).toEqual([
      'Sasa Security Services Sdn Bhd',
      'Arrow Shield Security Sdn Bhd',
      'Inas Security and Consultancy Sdn Bhd',
    ]);
    const nepali = a.people.filter((p) => p.nationality === 'NP').length / a.people.length;
    expect(nepali).toBeGreaterThan(0.18);
    expect(nepali).toBeLessThan(0.32);
    expect(verifyChain(a.audit)).toBeNull();
  });

  it('never gives a shift to two companies', () => {
    const { ds } = fresh();
    const personCompany = new Map(ds.people.map((p) => [p.id, p.companyId]));
    for (const s of ds.shifts) if (s.personId) expect(personCompany.get(s.personId)).toBe(s.companyId);
  });
});

describe('service: company walls', () => {
  it('shows a company manager only their own company', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    expect((await svc.visibleCompanies(cm)).map((c) => c.id)).toEqual(['co-sasa']);
    await expect(svc.companyDashboard(cm, 'co-arsh')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('lets the Director Office monitor all 38 but act only on pilots', async () => {
    const { svc } = fresh();
    const d = await svc.user('u-fauzan');
    const rows = await svc.groupOverview(d);
    expect(rows).toHaveLength(38);
    expect(rows.filter((r) => r.canAct)).toHaveLength(3);
    // Companies with no detailed data show UNKNOWN, never zero or green.
    expect(rows.find((r) => !r.company.isPilot)!.guards).toBe('UNKNOWN');
  });

  it('PWVSB monitoring cannot change a roster', async () => {
    const { svc, ds } = fresh();
    const ops = await svc.user('u-pwvsb-ops');
    const future = ds.shifts.find((s) => s.companyId === 'co-sasa' && s.date === addDays(TODAY, 3))!;
    await expect(svc.assignShift(ops, future.id, null)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('HR monitoring and arms control', () => {
  it('lets PWVSB HR monitor every company but not change anything', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const r = await svc.hrMonitor(hr);
    expect(r.rows.length).toBe(38);
    const sasa = r.rows.find((x) => x.company.id === 'co-sasa')!;
    expect(sasa.hasDetail).toBe(true);
    expect(r.rows.find((x) => !x.company.isPilot)!.hasDetail).toBe(false);
    await expect(svc.hrMonitor(await svc.user('u-pwvsb-arms'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.hrMonitor(await svc.user('u-cm-sasa'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.arms(hr, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('shows a Regional Operations Manager every company with sites in the region', async () => {
    const { svc, ds } = fresh();
    const rom = await svc.user('u-rom-central');
    const r = await svc.regionalOps(rom);
    expect(r.region.id).toBe('central');
    // Sasa (Selangor, KL), Arrow Shield (Selangor) and Inas (KL, Negeri Sembilan) all have central sites.
    const pilots = r.rows
      .filter((x) => x.hasDetail)
      .map((x) => x.company.id)
      .sort();
    expect(pilots).toEqual(['co-arsh', 'co-inas', 'co-sasa']);
    const sasa = r.rows.find((x) => x.company.id === 'co-sasa')!;
    const central = ds.sites.filter(
      (s) => s.companyId === 'co-sasa' && ['Selangor', 'Kuala Lumpur'].includes(ds.branches.find((b) => b.id === s.branchId)!.state),
    );
    expect(sasa.hasDetail && sasa.sites).toBe(central.length);
    // Johor sites are not in the central board.
    expect(r.attention.every((a) => !a.siteName || central.some((s) => s.name === a.siteName) || a.companyId !== 'co-sasa')).toBe(true);
    // Patrol gaps follow rule OPS-PATROL-GAP, and every item names its company.
    expect(r.attention.some((a) => a.kind === 'patrol')).toBe(true);
    expect(r.attention.every((a) => a.companyName.length > 0)).toBe(true);
    // A non-pilot company based in the region shows as unknown, never as fine.
    expect(r.rows.some((x) => !x.hasDetail)).toBe(true);
    // Their own region only.
    await expect(svc.regionalOps(rom, 'northern')).rejects.toBeInstanceOf(AccessDenied);
    const north = await svc.regionalOps(await svc.user('u-rom-north'));
    expect(north.rows.filter((x) => x.hasDetail).map((x) => x.company.id)).toEqual(['co-arsh']);
    // Since 27 Oct 2026 a Regional Operations Manager may publish the roster for sites in the region, and no others.
    await expect(svc.publishRoster(rom, central[0].id, TODAY, addDays(TODAY, 6))).rejects.not.toBeInstanceOf(AccessDenied);
    await expect(svc.publishRoster(await svc.user('u-rom-north'), central[0].id, TODAY, addDays(TODAY, 6))).rejects.toBeInstanceOf(AccessDenied);
    // HR and company managers do not get the regional board.
    await expect(svc.regionalOps(await svc.user('u-pwvsb-hr'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.regionalOps(await svc.user('u-cm-sasa'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('lets the Regional Operations Manager set a site patrol time to follow the client', async () => {
    const { svc, ds } = fresh();
    const rom = await svc.user('u-rom-central');
    const site = ds.sites.find((s) => s.companyId === 'co-sasa' && !s.armed && ds.branches.find((b) => b.id === s.branchId)!.state === 'Selangor')!;
    expect((await svc.siteDetail(rom, site.id)).patrol).toMatchObject({ intervalMin: 120, clientSet: false, canSet: true });
    await expect(svc.setPatrolInterval(rom, site.id, { minutes: 5, note: 'x' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.setPatrolInterval(rom, site.id, { minutes: 60, note: ' ' })).rejects.toBeInstanceOf(BadRequest);
    await svc.setPatrolInterval(rom, site.id, { minutes: 60, note: 'Client email 25 Oct: hourly rounds' });
    expect((await svc.siteDetail(rom, site.id)).patrol).toMatchObject({ intervalMin: 60, clientSet: true });
    expect(ds.audit.at(-1)!.summary).toContain('to 60 min');
    // A checkpoint last tapped 90 minutes ago is now a gap at this site.
    const v = (await svc.siteDetail(rom, site.id)).shifts.find((x) => x.state === 'on_duty' || x.state === 'late_on_duty');
    if (v) {
      for (const sc of ds.scans.filter((x) => x.siteId === site.id)) sc.at = myt(TODAY, '09:00');
      const r = await svc.regionalOps(rom);
      expect(r.attention.some((a) => a.kind === 'patrol' && a.siteId === site.id && a.title.includes('1 hour'))).toBe(true);
    }
    await svc.setPatrolInterval(rom, site.id, { minutes: null, note: '' });
    expect((await svc.siteDetail(rom, site.id)).patrol.intervalMin).toBe(120);
    // Other regions and HR cannot change it.
    const johor = ds.sites.find((s) => s.companyId === 'co-sasa' && ds.branches.find((b) => b.id === s.branchId)!.state === 'Johor')!;
    await expect(svc.setPatrolInterval(rom, johor.id, { minutes: 60, note: 'x' })).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.siteDetail(rom, johor.id)).patrol.canSet).toBe(false);
    await expect(svc.setPatrolInterval(await svc.user('u-rom-north'), johor.id, { minutes: 60, note: 'x' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setPatrolInterval(await svc.user('u-pwvsb-hr'), site.id, { minutes: 60, note: 'x' })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('gives every pilot an armed site and a vault on any date', () => {
    for (let i = 0; i < 40; i++) {
      const day = addDays('2026-10-01', i);
      const ds = generateDataset({ today: day, now: myt(day, '10:30') });
      for (const c of ['co-sasa', 'co-arsh', 'co-inas']) expect(ds.vaults.some((v) => v.companyId === c)).toBe(true);
    }
    // Builds the full mock group 40 times; the CI runner needs more than the 5-second default.
  }, 30_000);

  it('gives Arms Control an arms-only board across every company', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const b = await svc.armsControl(arms);
    expect(new Set(b.jobs.map((j) => j.job.kind))).toEqual(new Set(['CIT', 'CDM', 'BODYGUARD', 'CASH_VAULT']));
    expect(new Set(b.jobs.map((j) => j.job.companyId)).size).toBe(3);
    expect(b.tenders.length).toBeGreaterThan(0);
    expect(b.tenders.every((t) => t.tender.armed)).toBe(true);
    expect(b.alerts.some((a) => a.kind === 'Cash-in-transit')).toBe(true); // the delayed CIT run
    expect(b.renewals.some((r) => r.what === 'Armourer service' && r.tone === 'crit')).toBe(true);
    expect(b.log.some((l) => l.dir === 'out') && b.log.some((l) => l.dir === 'in')).toBe(true);
    expect(b.cms.length).toBeGreaterThan(0);
    expect(b.cms.some((c) => c.shift.post === 'HEAD_CONTROL')).toBe(true);
    // Every armed job firearm that is out has a movement record.
    for (const j of ds.armedJobs.filter((x) => x.status === 'in_progress' || x.status === 'delayed')) {
      for (const f of j.firearmIds) expect(ds.armsMovements.some((m) => m.firearmId === f && !m.returnedAt)).toBe(true);
    }
    // Need-to-know: no general screens, and only arms cases and arms audit entries.
    await expect(svc.groupOverview(arms)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.people(arms, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.companyDashboard(arms, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.commercial(arms, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.cases(arms)).every((c) => c.type === 'ARMS')).toBe(true);
    expect((await svc.auditLog(arms)).entries.every((e) => e.action.startsWith('arms.'))).toBe(true);
    // Others do not get this board.
    await expect(svc.armsControl(await svc.user('u-pwvsb-hr'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.armsControl(await svc.user('u-cm-sasa'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('lets Arms Control staff the CMS, track suppliers and keep trade stock apart', async () => {
    const { svc, ds } = fresh();
    const asst = await svc.user('u-pwvsb-arms-asst');
    const b = await svc.armsControl(asst);
    // Supplier catalogue with spec and price.
    expect(b.suppliers.flatMap((x) => x.items).every((i) => i.item.spec && i.item.unitPrice > 0)).toBe(true);
    expect(b.renewals.some((r) => r.what === 'Supplier licence')).toBe(true);
    // Supply tenders are blocked until the company holds an arms dealer licence.
    const supply = b.tenders.filter((t) => t.tender.kind === 'ARMS_SUPPLY');
    expect(supply.length).toBe(2);
    expect(supply.every((t) => t.findings.some((f) => f.code === 'NO_DEALER_LICENCE'))).toBe(true);
    expect(b.dealer.rows.map((r) => r.companyName).sort()).toEqual([
      'Jaguar Force Sdn Bhd',
      'Splendid Tactic Sdn Bhd',
      'Tiara Force Security Services Sdn Bhd',
    ]);
    Object.assign(ds.dealerLicences.find((d) => d.companyId === 'co-04')!, { status: 'approved', reference: 'PDRM/DL/0001', expiresOn: '2027-12-31' });
    const after = await svc.armsControl(asst);
    expect(after.tenders.find((t) => t.tender.id === 'td-c04-s1')!.findings.some((f) => f.code === 'NO_DEALER_LICENCE')).toBe(false);
    // Filling a CMS gap, audited; a person cannot sit two seats at once.
    const gap = b.cms.find((c) => c.state === 'uncovered')!;
    await expect(svc.assignCmsShift(await svc.user('u-pwvsb-hr'), gap.shift.id, 'Tan Mei Ling')).rejects.toBeInstanceOf(AccessDenied);
    const busy = ds.cmsShifts.find((x) => x.staffName && x.start === gap.shift.start)!;
    await expect(svc.assignCmsShift(asst, gap.shift.id, busy.staffName!)).rejects.toBeInstanceOf(BadRequest);
    const near = (n: string) => ds.cmsShifts.some((x) => x.staffName === n && !x.cancelled && x.start <= gap.shift.end && gap.shift.start <= x.end);
    const free = ds.cmsStaff.find((p) => p.posts.includes(gap.shift.post) && !near(p.name))!.name;
    await svc.assignCmsShift(asst, gap.shift.id, free);
    expect(ds.cmsShifts.find((x) => x.id === gap.shift.id)!.staffName).toBe(free);
    expect(ds.audit.at(-1)!.action).toBe('arms.cms_roster');
  });

  it('shows each vault with its A licence holder, Amra and day and night watch', async () => {
    const { svc } = fresh();
    const b = await svc.armsControl(await svc.user('u-pwvsb-arms'));
    expect(b.vaults.filter((v) => (v.vault.kind ?? 'COMPANY_ARMOURY') === 'COMPANY_ARMOURY').length).toBe(3);
    // Police-station and client-safe storage, each with police approval; the police station is not CMS-monitored.
    expect(b.vaults.some((v) => v.vault.kind === 'POLICE_STATION' && v.vault.approvalRef)).toBe(true);
    expect(b.vaults.some((v) => v.vault.kind === 'CLIENT_SAFE' && v.vault.siteId && v.vault.authorisedUsers?.length)).toBe(true);
    expect(b.alerts.some((a) => a.title.startsWith('Balai Polis'))).toBe(false);
    for (const v of b.vaults.filter((x) => (x.vault.kind ?? 'COMPANY_ARMOURY') === 'COMPANY_ARMOURY')) {
      expect(v.vault.aLicenceHolder).toBeTruthy();
      expect(v.vault.custodian).toBeTruthy();
      expect(v.current).not.toBeNull();
    }
    const inas = b.vaults.find((v) => v.vault.companyId === 'co-inas')!;
    expect(inas.watchState).toBe('check_late');
    expect(b.alerts.some((a) => a.kind === 'Vault watch' && a.companyId === 'co-inas')).toBe(true);
  });

  it('covers the V14 arms checks: CCTV, door events, ammunition, readiness, agreements and requests', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const b = await svc.armsControl(arms);
    // CCTV: a live camera that cannot prove recording, and an unconnected camera, are never green.
    expect(b.alerts.some((a) => a.kind === 'Vault CCTV' && a.companyId === 'co-arsh' && a.tone === 'crit')).toBe(true);
    expect(b.alerts.some((a) => a.kind === 'Vault CCTV' && a.companyId === 'co-inas')).toBe(true);
    // Door opened with no issue, return or count is flagged; ordinary openings match.
    expect(b.doors.some((d) => !d.matched && d.event.kind === 'DOOR_OPEN' && d.event.companyId === 'co-sasa')).toBe(true);
    expect(b.doors.filter((d) => d.event.kind === 'DOOR_OPEN' && d.matched).length).toBeGreaterThan(0);
    // Ammunition: short count, same person counting and checking, rounds not returned.
    expect(b.ammo.some((a) => a.difference === -2 && a.stock.companyId === 'co-inas')).toBe(true);
    expect(b.ammo.some((a) => a.sameCounter && a.stock.companyId === 'co-arsh')).toBe(true);
    expect(b.roundsShort.length).toBe(1);
    // Readiness: the Sasa armed site with no client agreement is not cleared.
    expect(b.readiness.length).toBeGreaterThan(0);
    expect(b.readiness.some((r) => r.verdict === 'no_go' && r.checks.some((c) => c.label === 'Client arms agreement' && c.state === 'block'))).toBe(true);
    expect(b.sitesWithoutAgreement.some((x) => x.site.companyId === 'co-sasa')).toBe(true);
    expect(b.renewals.some((r) => r.what === 'Range practice')).toBe(true);
    expect(b.renewals.some((r) => r.what === 'Armed-service insurance')).toBe(true);
    // Requests: Arms Control passes its own step to the company, never further.
    const review = b.requests.find((r) => r.request.state === 'arms_review')!;
    await expect(svc.reviewArmsRequest(await svc.user('u-cm-sasa'), review.request.id, 'pass', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.reviewArmsRequest(arms, review.request.id, 'return', ' ')).rejects.toBeInstanceOf(BadRequest);
    await svc.reviewArmsRequest(arms, review.request.id, 'pass', 'Checked');
    expect(ds.armsRequests.find((r) => r.id === review.request.id)!.state).toBe('company_auth');
    expect(ds.audit.at(-1)!.action).toBe('arms.request_review');
    await expect(svc.reviewArmsRequest(arms, review.request.id, 'pass', 'ok')).rejects.toBeInstanceOf(BadRequest);
  });

  it('tracks the police fundamentals: 14-day loss report, deposit on expiry, permit limit, annual return', async () => {
    const { svc, ds } = fresh();
    const b = await svc.armsControl(await svc.user('u-pwvsb-arms'));
    const inas = b.police.reports.find((r) => r.firearm.companyId === 'co-inas')!;
    expect(inas.daysLeft).toBe(3);
    expect(b.alerts.some((a) => a.kind === 'Police report' && a.companyId === 'co-inas')).toBe(true);
    expect(b.police.deposits.some((d) => d.firearm.companyId === 'co-arsh' && !d.deposited)).toBe(true);
    expect(b.police.kdnReturn.length).toBe(3);
    // Once reported, the alert stops.
    ds.firearms.find((f) => f.id === inas.firearm.id)!.policeReport = { ref: 'RPT/123', on: ds.firearms[0].licenceExpiresOn! };
    const after = await svc.armsControl(await svc.user('u-pwvsb-arms'));
    expect(after.alerts.some((a) => a.kind === 'Police report' && a.companyId === 'co-inas')).toBe(false);
  });

  it('never issues dealer trade stock to a guard', () => {
    const { ds } = fresh();
    const f = { ...ds.firearms.find((x) => x.companyId === 'co-sasa')!, ownership: 'TRADE' as const, status: 'IN_VAULT' as const };
    const site = ds.sites.find((s) => s.companyId === 'co-sasa' && s.armed)!;
    const holder = ds.credentials.find((c) => c.companyId === 'co-sasa' && c.type === 'FIREARM_PERMIT')!.personId;
    const person = ds.people.find((p) => p.id === holder)!;
    const findings = armsIssueCheck({
      person,
      credentials: ds.credentials,
      firearm: f,
      vault: ds.vaults.find((v) => v.id === f.vaultId)!,
      site,
      shift: null,
      issuer: 'A',
      witness: 'B',
      today: TODAY,
      firearmBusy: false,
    });
    expect(findings.some((x) => x.code === 'TRADE_STOCK')).toBe(true);
  });

  it('needs the police notified once per armed set-up, an approved site vault, and approval to leave the home state', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    const b = await svc.armsControl(arms);
    expect(b.agreements.find((a) => a.agreement.id === 'aa-sasa-sepang')!.setupStep).toBe('install');
    expect(b.agreements.find((a) => a.agreement.companyId === 'co-arsh' && a.agreement.jobKind === 'CDM')!.setupStep).toBe('notify');
    expect(b.agreements.some((a) => a.agreement.setup?.siteVaultId && a.setupStep === 'live')).toBe(true);
    expect(b.alerts.some((a) => a.kind === 'Register book' && a.companyId === 'co-arsh')).toBe(true);
    const bg = b.jobs.find((j) => j.job.ref === 'SASA-BODYGUARD-006');
    // Police paperwork is a legal point for the directors only (Fauzan, 2 Nov 2026): never an alert on the staff board.
    expect(b.alerts.some((a) => a.kind === 'Interstate' || a.kind === 'Police notice')).toBe(false);
    const ceo = await svc.user('u-fauzan');
    if (bg && bg.job.status !== 'completed') expect((await svc.specialOpsLegalFlags(ceo)).rows.some((f) => f.kind === 'ARMED_JOB_CROSS_STATE' && f.title.startsWith('SASA-BODYGUARD-006'))).toBe(true);
    const cit = b.jobs.find((j) => j.job.ref === 'SASA-CIT-001');
    if (cit) expect(cit.police.needsApproval && !!cit.police.approval).toBe(true);
    // A move that reaches the physical step with no police notice is flagged.
    Object.assign(ds.armsRequests.find((r) => r.kind === 'MOVE')!, { state: 'approved' });
    const after = await svc.armsControl(arms);
    expect(after.alerts.some((a) => a.kind === 'Police notice')).toBe(false);
    const flag = (await svc.specialOpsLegalFlags(ceo)).rows.find((f) => f.kind === 'ARMS_MOVE_POLICE' && f.title.startsWith('AR-0001'));
    expect(flag?.status).toBe('open');
    expect(flag?.records[0].entity).toBe('arms_request');
    await expect(svc.specialOpsLegalFlags(arms)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('lets only authorised company staff issue from a client-site safe', () => {
    const { ds } = fresh();
    const safe = ds.vaults.find((v) => v.kind === 'CLIENT_SAFE')!;
    const f = ds.firearms.find((x) => x.vaultId === safe.id)!;
    const site = ds.sites.find((s) => s.id === safe.siteId)!;
    const holder = ds.credentials.find((c) => c.companyId === 'co-sasa' && c.type === 'FIREARM_PERMIT')!.personId;
    const args = {
      person: ds.people.find((p) => p.id === holder)!,
      credentials: ds.credentials,
      firearm: f,
      vault: safe,
      site,
      shift: null,
      witness: 'Duty witness',
      today: TODAY,
      firearmBusy: false,
    };
    expect(armsIssueCheck({ ...args, issuer: 'Client bank staff' }).some((x) => x.code === 'NOT_AUTHORISED_USER')).toBe(true);
    expect(armsIssueCheck({ ...args, issuer: safe.authorisedUsers![0] }).some((x) => x.code === 'NOT_AUTHORISED_USER')).toBe(false);
  });

  it('gives each job a home dashboard with what it must watch', async () => {
    const { svc } = fresh();
    const dir = await svc.home(await svc.user('u-fauzan'));
    expect(dir.tiles.map((t) => t.label)).toContain('Firearms overdue or unverified');
    const cm = await svc.home(await svc.user('u-cm-sasa'));
    expect(cm.tiles.map((t) => t.label)).toEqual(expect.arrayContaining(['Waiting for your approval', 'Firearms out now', 'Licences to renew']));
    expect(cm.todo.some((t) => t.tag === 'Approve')).toBe(true);
    const ae = await svc.home(await svc.user('u-ae-arsh'));
    expect(ae.tiles.map((t) => t.label)).toContain('Your quotations to fix');
    expect(ae.tiles.map((t) => t.label)).not.toContain('Firearms out now');
    const svUser = await svc.user('u-sv-sasa');
    const sv = await svc.home(svUser);
    expect(sv.title).toContain('My sites');
    // A supervisor only sees items for their own sites.
    expect(sv.todo.filter((t) => t.go.siteId).every((t) => svUser.siteIds.includes(t.go.siteId!))).toBe(true);
    // Every item links to a screen.
    for (const h of [dir, cm, ae, sv]) expect([...h.tiles, ...h.todo].every((x) => x.go.view)).toBe(true);
    await expect(svc.home(await svc.user('u-pwvsb-hr'))).rejects.toBeInstanceOf(BadRequest);
  });

  it("keeps the worker's HR file: hiring papers, MC with illness, hospital claim tracker, pay workings (Shahirah)", async () => {
    const { svc, ds } = fresh();
    const guardUser = await svc.user('u-guard-sasa-1');
    const me = await svc.guardProfile(guardUser, guardUser.personId!);
    // The worker sees how pay is worked out and hours day by day.
    expect(me.pay!.workings.map((w) => w.label)).toEqual(expect.arrayContaining(['Daily rate', 'Hourly rate', 'Overtime rate', 'Gross so far']));
    expect(me.hours.days.every((d) => d.normal + d.overtime === d.hours || Math.abs(d.normal + d.overtime - d.hours) < 0.11)).toBe(true);
    expect(me.hiring.items.every((i) => i.done)).toBe(true);
    expect(me.hiring.canUpload).toBe(false);
    expect(me.medical!.some((m) => m.illness === 'Dengue fever')).toBe(true);
    expect(me.policies.discipline.value.steps.length).toBeGreaterThan(3);
    const duty = await svc.myDuty(guardUser);
    expect(duty.reminders.every((r) => !/Tell your office/.test(r.text))).toBe(true);

    // The company uploads a hiring paper; operations cannot, and does not see the illness.
    const cm = await svc.user('u-cm-sasa');
    const other = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && !p.hiringDocs)!;
    await svc.uploadHiringDoc(cm, other.id, 'AGREEMENT_STAMPED', [proof()]);
    expect((await svc.guardProfile(cm, other.id)).hiring.items.find((i) => i.kind === 'AGREEMENT_STAMPED')!.done).toBe(true);
    const om = await svc.user('u-om-klang');
    await expect(svc.uploadHiringDoc(om, other.id, 'AGREEMENT', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    const omView = await svc.guardProfile(om, guardUser.personId!);
    expect(omView.leave.requests.every((q) => q.illness === undefined)).toBe(true);
    expect(omView.medical).toBeNull();

    // Sick leave needs the illness and clinic as well as the MC.
    await expect(svc.requestLeave(cm, { personId: other.id, kind: 'SICK', from: TODAY, to: TODAY, reason: 'Fever', proof: [proof()] })).rejects.toThrow(
      /illness/,
    );

    // Hospital claim: cannot be submitted while papers are missing; moves one step at a time.
    const stay = ds.leaveRequests.find((q) => q.personId === guardUser.personId && q.hospitalClaim)!;
    await expect(svc.updateHospitalClaim(cm, stay.id, { stage: 'submitted', insurer: 'SPIKPA' })).rejects.toThrow(/Still missing/);
    await expect(svc.updateHospitalClaim(cm, stay.id, { item: 'DISCHARGE_SUMMARY', status: 'not_needed' })).rejects.toThrow(/always needed/);
    await svc.updateHospitalClaim(cm, stay.id, { item: 'GUARANTEE_LETTER', status: 'not_needed' });
    for (const item of ['DISCHARGE_SUMMARY', 'ITEMISED_BILL', 'CLAIM_FORM'] as const)
      await svc.updateHospitalClaim(cm, stay.id, { item, status: 'received' }, [proof()]);
    await expect(svc.updateHospitalClaim(cm, stay.id, { stage: 'paid' })).rejects.toThrow(/one step at a time/);
    const sent = await svc.updateHospitalClaim(cm, stay.id, { stage: 'submitted', insurer: 'Group hospitalisation insurer' });
    expect(sent.hospitalClaim!.stage).toBe('submitted');
    expect((await svc.personDocs(cm, guardUser.personId!)).length).toBeGreaterThan(5);
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('caps a Nepali guard at 12 days of annual leave, as in the contract, and has a General Manager at Sasa', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const np = ds.people.find((p) => p.nationality === 'NP' && p.companyId === 'co-sasa' && p.status === 'active')!;
    np.hiredOn = addDays(TODAY, -365 * 7);
    const b = (await svc.guardProfile(cm, np.id)).leave.balances;
    expect(b.annual.entitled).toBe(12);
    expect(b.note).toMatch(/12 days at most/);
    const my = ds.people.find((p) => p.nationality === 'MY' && p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active')!;
    my.hiredOn = addDays(TODAY, -365 * 7);
    expect((await svc.guardProfile(cm, my.id)).leave.balances.annual.entitled).toBe(16);
    const gm = await svc.user('u-gm-sasa');
    expect(gm.role).toBe('company_manager');
    expect(ds.users.filter((u) => u.opsTier === 'ceo').length).toBe(1);
    expect(ds.users.filter((u) => u.opsTier === 'coo').length).toBe(1);
  });

  it('shows arms detail only to CMS, Arms Control, the COO or higher, the company manager, and a supervisor for their own people', async () => {
    const { svc, ds } = fresh();
    for (const id of ['u-fauzan', 'u-coo', 'u-chair', 'u-cms-head', 'u-pwvsb-arms']) await expect(svc.armsControl(await svc.user(id))).resolves.toBeDefined();
    for (const id of ['u-fd', 'u-cos', 'u-dcos', 'u-pwvsb-hr', 'u-om-klang'])
      await expect(svc.armsControl(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.arms(await svc.user('u-fd'), 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    // The Finance Director's home still loads, without arms.
    expect((await svc.home(await svc.user('u-fd'))).todo.some((t) => t.tag === 'Arms')).toBe(false);
    const cm = await svc.arms(await svc.user('u-cm-sasa'), 'co-sasa');
    const sv = await svc.user('u-sv-sasa');
    const mine = await svc.arms(sv, 'co-sasa');
    expect([...mine.open, ...mine.recent].every((o) => sv.siteIds.includes(o.movement.siteId))).toBe(true);
    expect(mine.vaults.every((v) => !!v.vault.siteId && sv.siteIds.includes(v.vault.siteId))).toBe(true);
    expect(mine.firearms.length).toBeLessThan(cm.firearms.length);
    expect(ds.firearms.length).toBeGreaterThan(0);
  });

  it('gives the CEO an executive view: decisions today, then what to monitor', async () => {
    const { svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    expect(ceo.opsTier).toBe('ceo');
    const h = await svc.home(ceo);
    // Foreign worker papers that reached the CEO step come as one line per paper, not one per worker.
    expect(h.todo.filter((t) => t.tag === 'Foreign workers').length).toBeLessThanOrEqual(6); // six papers since SPIKPA and the KDN letter joined (5 Nov 2026)
    expect(h.title).toBe('Executive view');
    expect(h.todoTitle).toBe('Do today');
    expect(h.watch).toBeDefined();
    expect(h.tiles[0].value).toBe(h.todo.length);
    // Group tiles still shown; the old Director Office list moves to Monitor.
    expect(h.tiles.map((t) => t.label)).toContain('Firearms overdue or unverified');
    // Other group leaders keep the group board without the decision split.
    const coo = await svc.home(await svc.user('u-coo'));
    expect(coo.watch).toBeUndefined();
  });

  it('issues a firearm only with every check passed and only by the company', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const view = await svc.arms(cm, 'co-sasa');
    const free = view.firearms.find((f) => f.firearm.status === 'IN_VAULT' && f.firearm.licenceExpiresOn)!.firearm;
    const armedSite = ds.sites.find((s) => s.companyId === 'co-sasa' && s.armed)!;
    const holder = ds.credentials.find((c) => c.companyId === 'co-sasa' && c.type === 'FIREARM_PERMIT')!.personId;
    const shift = ds.shifts.find((s) => s.siteId === armedSite.id && s.date === addDays(TODAY, 1))!;
    shift.personId = holder;
    const W = witnessIn(ds, 'co-sasa', [holder]);
    const holderP = ds.people.find((p) => p.id === holder)!;
    // The witness signs in: a typed name, a wrong PIN or the guard themselves is refused.
    await expect(svc.issueFirearm(cm, { shiftId: shift.id, firearmId: free.id, rounds: 5, witness: { staffNo: W.staffNo, pin: '' } })).rejects.toThrow(/staff number and PIN/);
    await expect(svc.issueFirearm(cm, { shiftId: shift.id, firearmId: free.id, rounds: 5, witness: { staffNo: W.staffNo, pin: '0' } })).rejects.toThrow(/PIN is wrong/);
    await expect(
      svc.issueFirearm(cm, { shiftId: shift.id, firearmId: free.id, rounds: 5, witness: { staffNo: holderP.staffNo, pin: demoPin(holderP.staffNo) } }),
    ).rejects.toThrow(/second person/);
    const m = await svc.issueFirearm(cm, { shiftId: shift.id, firearmId: free.id, rounds: 5, witness: W });
    expect(m.issueWitness).toContain(W.staffNo);
    expect(ds.firearms.find((f) => f.id === free.id)!.status).toBe('ISSUED');
    // Same firearm cannot go out twice.
    await expect(svc.issueFirearm(cm, { shiftId: shift.id, firearmId: free.id, rounds: 5, witness: W })).rejects.toBeInstanceOf(RuleBlocked);
    // Arms Control monitors but never handles.
    const arms = await svc.user('u-pwvsb-arms');
    expect((await svc.armsOverview(arms)).rows.find((r) => r.company.id === 'co-sasa')!.hasDetail).toBe(true);
    await expect(svc.returnFirearm(arms, { movementId: m.id, roundsReturned: 5, witness: W })).rejects.toBeInstanceOf(AccessDenied);
    // A missing round opens a P1 case and leaves the firearm unverified.
    const r = await svc.returnFirearm(cm, { movementId: m.id, roundsReturned: 4, witness: W });
    expect(ds.cases.find((c) => c.ref === r.caseRef)!.severity).toBe('P1');
    expect(ds.firearms.find((f) => f.id === free.id)!.status).toBe('UNVERIFIED');
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('refuses a person without a firearm permit and a firearm of another company', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const armedSite = ds.sites.find((s) => s.companyId === 'co-sasa' && s.armed)!;
    const holders = new Set(ds.credentials.filter((c) => c.type === 'FIREARM_PERMIT').map((c) => c.personId));
    const noPermit = ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active' && !holders.has(p.id))!;
    const shift = ds.shifts.find((s) => s.siteId === armedSite.id && s.date === addDays(TODAY, 2))!;
    shift.personId = noPermit.id;
    const own = ds.firearms.find((f) => f.companyId === 'co-sasa' && f.status === 'IN_VAULT')!;
    const W = witnessIn(ds, 'co-sasa', [noPermit.id]);
    await expect(svc.issueFirearm(cm, { shiftId: shift.id, firearmId: own.id, rounds: 5, witness: W })).rejects.toThrow(/no valid firearm permit/);
    const other = ds.firearms.find((f) => f.companyId === 'co-inas' && f.status === 'IN_VAULT')!;
    await expect(svc.issueFirearm(cm, { shiftId: shift.id, firearmId: other.id, rounds: 5, witness: witnessIn(ds, 'co-inas') })).rejects.toThrow(/another company/);
  });

  it('climbs the overdue ladder and opens a case on a vault count difference', async () => {
    const m = { returnedAt: null, dueBack: myt(TODAY, '19:00') } as never;
    expect(armsOverdueState(m, myt(TODAY, '19:10'))).toBe('out');
    expect(armsOverdueState(m, myt(TODAY, '19:16'))).toBe('alert');
    expect(armsOverdueState(m, myt(TODAY, '19:31'))).toBe('escalate');
    expect(armsOverdueState(m, myt(TODAY, '21:00'))).toBe('loss_case');
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const v = ds.vaults.find((x) => x.companyId === 'co-sasa')!;
    const expected = ds.firearms.filter((f) => f.vaultId === v.id && f.status === 'IN_VAULT').length;
    const W = witnessIn(ds, 'co-sasa');
    expect((await svc.countVault(cm, v.id, { counted: expected, witness: W })).ok).toBe(true);
    const bad = await svc.countVault(cm, v.id, { counted: expected - 1, witness: W });
    expect(bad.caseRef).not.toBeNull();
    expect(ds.vaults.find((x) => x.id === v.id)!.lastCountOk).toBe(false);
  });
});

describe('tenders and quotations', () => {
  const lic = (type: 'KDN_LICENCE' | 'MOF_REGISTRATION' | 'INSURANCE', expiresOn: string | null) => ({
    id: type,
    companyId: 'co-a',
    type,
    reference: '',
    expiresOn,
  });

  it('needs MOF for government tenders only and treats a missing record as a block', () => {
    const papers = [lic('KDN_LICENCE', '2027-12-31'), lic('INSURANCE', '2027-12-31'), lic('MOF_REGISTRATION', '2026-01-01')];
    expect(tenderEligibility('PRIVATE', papers, TODAY, addDays(TODAY, 14))).toEqual([]);
    expect(tenderEligibility('GOVERNMENT', papers, TODAY, addDays(TODAY, 14)).map((f) => f.code)).toEqual(['EXPIRED_MOF_REGISTRATION']);
    const noInsurance = [lic('KDN_LICENCE', '2027-12-31'), lic('INSURANCE', null)];
    expect(tenderEligibility('PRIVATE', noInsurance, TODAY, addDays(TODAY, 14))[0].level).toBe('block');
    const kdnEndsSoon = [lic('KDN_LICENCE', addDays(TODAY, 5)), lic('INSURANCE', '2027-12-31')];
    expect(tenderEligibility('PRIVATE', kdnEndsSoon, TODAY, addDays(TODAY, 14))[0].code).toBe('EXPIRES_BEFORE_CLOSING_KDN_LICENCE');
  });

  it('lets the admin prepare a quotation and only another person approve it', async () => {
    const { svc, ds } = fresh();
    const ae = await svc.user('u-ae-arsh');
    const cm = await svc.user('u-cm-arsh');
    const view = await svc.commercial(ae, 'co-arsh');
    // P78: whoever prepares also enters new tenders.
    expect(view.can).toEqual({ prepare: true, approve: false, addTender: true });
    expect(view.tenders.every((t) => t.tender.companyId === 'co-arsh')).toBe(true);
    await expect(svc.commercial(ae, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);

    const q = await svc.createQuotation(ae, 'co-arsh', {
      client: 'Test JMB',
      siteName: 'Tower A',
      tenderId: null,
      guards: 4,
      hoursPerDay: 12,
      ratePerGuard: 3200,
      validDays: 30,
    });
    expect(q.monthlyTotal).toBe(12800);
    await expect(svc.quotationAction(ae, q.id, 'approve', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.quotationAction(ae, q.id, 'submit');
    await expect(svc.quotationAction(cm, q.id, 'return')).rejects.toThrow(/what needs changing/);
    const ok = await svc.quotationAction(cm, q.id, 'approve', 'ok');
    expect(ok.status).toBe('approved');
    expect(ok.approvedBy).toBe(cm.name);

    const own = ds.quotations.find((x) => x.companyId === 'co-arsh' && x.preparedById === 'u-cm-arsh' && x.status === 'awaiting_approval')!;
    await expect(svc.quotationAction(cm, own.id, 'approve', 'ok')).rejects.toThrow(/another person/);
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('lets the Director Office enter several companies in one tender, each verified by its own manager (Fauzan)', async () => {
    const { svc, ds } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const cm = await svc.user('u-cm-sasa');
    const arshCm = await svc.user('u-cm-arsh');
    const t = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.verifications?.length)!;
    await expect(svc.createTenderGroup(cm, t.id, ['co-arsh'])).rejects.toBeInstanceOf(AccessDenied);
    // The Director Office makes and checks the checklist before it goes to the companies.
    const unchecked = ds.tenders.find((x) => x.companyId === 'co-inas' && x.status === 'open' && !x.checklistReview)!;
    await expect(svc.createTenderGroup(doa, unchecked.id, ['co-arsh'])).rejects.toThrow(/checklist first/);
    const g = await svc.createTenderGroup(doa, t.id, ['co-arsh']);
    expect(g.entries.map((e) => e.companyId)).toEqual(['co-sasa', 'co-arsh']);
    // Arrow Shield gets its own copy, papers and checklist included, behind its own wall.
    const copy = ds.tenders.find((x) => x.companyId === 'co-arsh' && x.groupId === g.id)!;
    expect(copy.ref).toBe(t.ref);
    expect(copy.checklist!.length).toBe(t.checklist!.length);
    expect(ds.evidenceDocs.filter((d) => d.tenderId === copy.id).every((d) => d.companyId === 'co-arsh')).toBe(true);
    await expect(svc.createTenderGroup(doa, t.id, ['co-inas'])).rejects.toThrow(/already/);
    // Sasa finishes: second check, CEO check, slip.
    for (const l of ds.licences.filter((x) => x.companyId === 'co-sasa')) l.expiresOn = addDays(TODAY, 400);
    // Sasa's bid is already signed by the preparer and the manager; it only needs the slip.
    await svc.submitTender(cm, t.id, 'Lodged', [proof()]);
    // The Director Office holds the proof: steps, document names and the slip, never the price or the files.
    const board = (await svc.tenderGroups(doa)).find((x) => x.id === g.id)!;
    // The Director Office sees how many companies entered, filled the tender and followed the guide.
    expect([board.entered, board.filledCount, board.followedCount]).toEqual([2, 1, 1]);
    const sasa = board.entries.find((e) => e.companyId === 'co-sasa')!;
    expect(sasa.followedGuide).toBe(true);
    expect(sasa.proof!.slip).not.toBeNull();
    expect(JSON.stringify(sasa)).not.toMatch(/monthly|estMonthly|RM\s?\d|data:application/i);
    expect(board.entries.find((e) => e.companyId === 'co-arsh')!.proof).toBeNull();
    // Each company sees only its own entry.
    const view = (await svc.tenderGroups(arshCm)).find((x) => x.id === g.id)!;
    expect(view.entries.map((e) => e.companyId)).toEqual(['co-arsh']);
    // 24 hours after closing, the CEO's home carries the report of how many companies entered.
    const ceo = await svc.user('u-fauzan');
    const title = (h: Awaited<ReturnType<typeof svc.home>>) => [...h.todo, ...(h.watch ?? [])].map((i) => i.title).join(' | ');
    expect(title(await svc.home(ceo))).not.toMatch(/companies entered with the slip/);
    ds.tenderGroups.find((x) => x.id === g.id)!.closesOn = addDays(TODAY, -1);
    expect(title(await svc.home(ceo))).toMatch(/1 of 2 companies entered with the slip/);
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('refuses to mark a tender submitted while the company papers block it, and needs the checks and the slip', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-ae-sasa').catch(() => cm);
    const t = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.verifications?.length)!;
    await expect(svc.updateTender(cm, t.id, 'submitted')).rejects.toThrow(/submission slip/);
    const mof = ds.licences.find((l) => l.companyId === 'co-sasa' && l.type === 'MOF_REGISTRATION')!;
    mof.expiresOn = addDays(TODAY, -3);
    await expect(svc.submitTender(cm, t.id, 'Lodged', [proof()])).rejects.toBeInstanceOf(RuleBlocked);
    for (const l of ds.licences.filter((x) => x.companyId === 'co-sasa')) l.expiresOn = addDays(TODAY, 400);
    // Fauzan, 26 Oct 2026: tick each item, the preparer signs, the company manager signs, then the slip.
    const gm = await svc.user('u-gm-sasa');
    await expect(svc.verifyTender(await svc.user('u-pwvsb-doa'), t.id, false, 'Redo the price')).rejects.toBeInstanceOf(AccessDenied);
    await svc.verifyTender(cm, t.id, false, 'Recheck the price schedule');
    expect(ds.tenders.find((x) => x.id === t.id)!.verifications).toEqual([]);
    await expect(svc.submitTender(cm, t.id, 'Lodged', [proof()])).rejects.toThrow(/both sign/);
    // The person who prepared it signs first; the same person never signs again as the manager.
    await svc.verifyTender(cm, t.id, true, 'ok');
    await expect(svc.verifyTender(cm, t.id, true, 'again')).rejects.toBeInstanceOf(AccessDenied);
    await svc.verifyTender(gm, t.id, true, 'All verified by the guidelines');
    expect(ds.tenders.find((x) => x.id === t.id)!.verifications!.map((v) => v.level)).toEqual(['PREPARER', 'MANAGER']);
    await expect(svc.submitTender(ae, t.id, 'Lodged', [])).rejects.toThrow(/submission slip/);
    const done = await svc.submitTender(ae, t.id, 'Lodged at the tender box', [proof()]);
    expect(done.status).toBe('submitted');
    expect(done.submission!.proofIds).toHaveLength(1);
    const arshT = ds.tenders.find((x) => x.companyId === 'co-arsh' && x.status === 'open')!;
    await expect(svc.updateTender(await svc.user('u-ae-arsh'), arshT.id, 'no_bid')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('takes the papers, drafts the checklist from the arahan, and has the Director Office check it', async () => {
    const { svc, ds } = fresh();
    const ae = await svc.user('u-ae-arsh');
    const doa = await svc.user('u-pwvsb-doa');
    const t = ds.tenders.find((x) => x.companyId === 'co-arsh' && x.status === 'open' && x.channel === 'GOVERNMENT')!;
    await expect(svc.draftTenderChecklist(ae, t.id)).rejects.toThrow(/arahan petender first/);
    await svc.addTenderPapers(ae, t.id, 'ARAHAN', [proof()]);
    const drafted = await svc.draftTenderChecklist(ae, t.id);
    expect(drafted.checklist!.length).toBeGreaterThan(3);
    expect(drafted.checklist!.every((c) => c.source === 'ai')).toBe(true);
    await expect(svc.reviewTenderChecklist(ae, t.id, { note: 'ok' })).rejects.toBeInstanceOf(AccessDenied);
    const reviewed = await svc.reviewTenderChecklist(doa, t.id, {
      remove: [drafted.checklist![1].id],
      add: [{ label: 'Bid validity 120 days', needsDocument: false }],
      note: 'Bumiputera rule does not apply; added validity',
    });
    expect(reviewed.checklistReview!.by).toBe(doa.name);
    expect(reviewed.checklist!.some((c) => c.source === 'doa')).toBe(true);
    const board = await svc.tenderBoard(doa);
    expect(board.rows.some((r) => r.tender.id === t.id)).toBe(true);
    expect(board.reader.readsFiles).toBe(false);
    await expect(svc.tenderBoard(ae)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Tender protocol (Fauzan, 25 Oct 2026)', () => {
  it('lets only the Director Office set the protocol, and holds a tender until its steps are done', async () => {
    const { svc, ds } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const ae = await svc.user('u-ae-arsh');
    expect((await svc.tenderProtocol(ae)).canEdit).toBe(false);
    expect((await svc.tenderProtocol(doa)).canEdit).toBe(true);
    const steps = [
      { label: 'Check eligibility', detail: '', before: 'preparing' as const, needsDocument: false },
      { label: 'Checklist signed', detail: 'Attach it', before: 'submitted' as const, needsDocument: true },
    ];
    await expect(svc.setTenderProtocol(ae, { steps, note: 'try' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setTenderProtocol(await svc.user('u-cm-sasa'), { steps, note: 'try' })).rejects.toBeInstanceOf(AccessDenied);
    const p = await svc.setTenderProtocol(doa, { steps, note: 'Group protocol from the Director Office' });
    expect(p.version).toBe(2);
    expect(p.placeholder).toBe(false);
    expect(ds.audit.at(-1)!.action).toBe('tender.protocol');

    const t = ds.tenders.find((x) => x.companyId === 'co-arsh' && x.status === 'open')!;
    await expect(svc.updateTender(ae, t.id, 'preparing')).rejects.toThrow(/Check eligibility/);
    await svc.doTenderStep(ae, t.id, 'check_eligibility', 'KDN and MOF valid to closing');
    await expect(svc.updateTender(ae, t.id, 'preparing')).rejects.toThrow(/Decision to teruskan/);
    await expect(svc.decideTender(ae, t.id, 'TERUSKAN', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.decideTender(await svc.user('u-cm-arsh'), t.id, 'TERUSKAN', 'ok');
    expect((await svc.updateTender(ae, t.id, 'preparing')).status).toBe('preparing');
    // Just a tick; a tick made by mistake can be taken back before the bid is signed.
    await svc.doTenderStep(ae, t.id, 'checklist_signed', '');
    await svc.undoTenderStep(ae, t.id, 'checklist_signed');
    await svc.doTenderStep(ae, t.id, 'checklist_signed', 'Signed by the manager', [proof()]);
    await expect(svc.doTenderStep(ae, t.id, 'checklist_signed', 'again', [proof()])).rejects.toThrow(/already done/);
    const view = await svc.commercial(ae, 'co-arsh');
    const row = view.tenders.find((r) => r.tender.id === t.id)!;
    expect(row.protocol.every((x) => x.done)).toBe(true);
    expect(row.protocol[1].docs).toHaveLength(1);
  });
});

describe('Reports to the Director Office (Fauzan, 25 Oct 2026)', () => {
  it('shows each sender what is due and the Director Office every report, with Unknown for companies not on the app', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const mine = await svc.reports(cm);
    expect(mine.board).toBeNull();
    expect(mine.mine.every((m) => m.companyId === 'co-sasa')).toBe(true);
    const open = mine.mine.flatMap((m) => m.periods.map((p) => ({ m, p }))).find((x) => !x.p.sent)!;
    await expect(svc.submitReport(cm, { defId: open.m.def.id, period: open.p.period, companyId: 'co-sasa', note: '', proof: [] })).rejects.toThrow(/Attach/);
    await expect(
      svc.submitReport(cm, { defId: open.m.def.id, period: open.p.period, companyId: 'co-inas', note: '', proof: [proof()] }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const sent = await svc.submitReport(cm, { defId: open.m.def.id, period: open.p.period, companyId: 'co-sasa', note: 'Week done', proof: [proof()] });
    expect(sent.docIds).toHaveLength(1);
    await expect(svc.submitReport(cm, { defId: open.m.def.id, period: open.p.period, companyId: 'co-sasa', note: '', proof: [proof()] })).rejects.toThrow(
      /already sent/,
    );

    const hr = await svc.user('u-pwvsb-hr');
    const hrMine = await svc.reports(hr);
    expect(hrMine.mine.length).toBeGreaterThan(0);
    expect(hrMine.mine.every((m) => m.def.department === 'hr')).toBe(true);

    const doa = await svc.reports(await svc.user('u-pwvsb-doa'));
    const ops = doa.board!.find((b) => b.def.id === 'ops-weekly')!;
    expect(ops.rows.length).toBe(ds.companies.length);
    expect(ops.rows.filter((r) => r.status === 'unknown').length).toBe(ds.companies.filter((c) => !c.isPilot).length);
    expect(ops.rows.some((r) => r.status === 'on_time' || r.status === 'late')).toBe(true);
    expect(doa.canEdit).toBe(true);
    await expect(svc.setReportDefs(cm, [], 'x')).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Meetings, minutes and deadlines (Fauzan, 25 Oct 2026)', () => {
  it('keeps company meetings behind the wall, drafts the summary from the minutes and lists deadlines', async () => {
    const { svc } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const all = await svc.meetings(doa);
    expect(all.rows.some((r) => r.meeting.companyId === 'co-sasa')).toBe(true);
    expect(all.rows.some((r) => r.meeting.companyId === null)).toBe(true);
    expect(all.deadlines.some((d) => d.kind === 'tender')).toBe(true);
    expect(all.deadlines.some((d) => d.kind === 'meeting')).toBe(true);
    const cmA = await svc.user('u-cm-arsh');
    const arsh = await svc.meetings(cmA);
    expect(arsh.rows.every((r) => r.meeting.companyId === 'co-arsh')).toBe(true);
    const hr = await svc.meetings(await svc.user('u-pwvsb-hr'));
    expect(hr.rows.every((r) => r.meeting.department === 'hr')).toBe(true);
    await expect(svc.addMinutes(await svc.user('u-cm-sasa'), 'mt-arsh-ops', 'x'.repeat(30))).rejects.toBeInstanceOf(AccessDenied);
    const held = await svc.addMinutes(cmA, 'mt-arsh-ops', 'Night patrols improved.\nAction: Fix the gate lock (Site officer, by 2026-10-30)');
    expect(held.summary!.actions).toEqual([{ text: 'Fix the gate lock', owner: 'Site officer', ownerId: null, due: '2026-10-30', done: false }]);
    expect(held.summary!.checkedBy).toBeNull();
    await expect(svc.checkMeetingSummary(cmA, 'mt-arsh-ops', {})).rejects.toBeInstanceOf(AccessDenied);
    const checked = await svc.checkMeetingSummary(doa, 'mt-arsh-ops', {});
    expect(checked.summary!.checkedBy).toBe(doa.name);
    const done = await svc.setMeetingAction(cmA, 'mt-arsh-ops', 0, true);
    expect(done.summary!.actions[0].done).toBe(true);
    const m = await svc
      .scheduleMeeting(cmA, {
        companyId: 'co-arsh',
        kind: 'client',
        title: 'Client review',
        start: myt(addDays(TODAY, 3), '10:00'),
        end: myt(addDays(TODAY, 3), '11:00'),
        location: 'Client office',
        attendees: [],
        agenda: '',
      })
      .catch((e) => e);
    expect(m).toBeInstanceOf(BadRequest);
    const m2 = await svc.scheduleMeeting(cmA, {
      companyId: 'co-arsh',
      kind: 'client',
      title: 'Client review',
      start: myt(addDays(TODAY, 3), '10:00'),
      end: myt(addDays(TODAY, 3), '11:00'),
      location: 'Client office',
      attendees: [],
      agenda: '1. Service report\n2. Billing',
    });
    expect(m2.organiser).toBe(cmA.name);
    // Fauzan, 27 Oct 2026: every meeting gets a pre-briefing checklist by kind, ticked by the organiser's side.
    expect(m2.prep!.some((x) => x.label.startsWith('Client contract'))).toBe(true);
    const ticked = await svc.setMeetingPrep(cmA, m2.id, { index: 0, done: true });
    expect(ticked.prep![0]).toMatchObject({ done: true, by: cmA.name });
    const added = await svc.setMeetingPrep(cmA, m2.id, { add: 'Bring the incident photos' });
    expect(added.prep!.at(-1)!.label).toBe('Bring the incident photos');
    const row = (await svc.meetings(cmA)).rows.find((r) => r.meeting.id === m2.id)!;
    expect(row.agendaItems).toEqual(['Service report', 'Billing']);
    expect(row.prepState).toBe('due');
    await expect(svc.meetings(await svc.user('u-guard-sasa-1'))).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('service: workflows', () => {
  it('assigns a valid guard, writes audit, and refuses a blocked one', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const target = ds.shifts.find((s) => s.companyId === 'co-sasa' && s.date === addDays(TODAY, 5) && !ds.sites.find((x) => x.id === s.siteId)!.armed)!;
    const { candidates } = await svc.candidates(cm, target.id);
    const ok = candidates.find((c) => !c.blocked)!;
    const before = ds.audit.length;
    await svc.assignShift(cm, target.id, ok.person.id);
    expect(ds.shifts.find((s) => s.id === target.id)!.personId).toBe(ok.person.id);
    expect(ds.audit.length).toBe(before + 1);
    expect(verifyChain(ds.audit)).toBeNull();

    const overAge = ds.people.filter((p) => p.companyId === 'co-sasa')[11];
    await expect(svc.assignShift(cm, target.id, overAge.id)).rejects.toBeInstanceOf(RuleBlocked);
  });

  it('clocks a guard in and out by face on the site device and flags a wrong location', async () => {
    const { svc, ds } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const siteId = dev.siteIds[0];
    const site = ds.sites.find((s) => s.id === siteId)!;
    const person = ds.people.find(
      (p) => p.companyId === 'co-sasa' && p.status === 'active' && p.faceEnrolledOn && !ds.attendance.some((a) => a.personId === p.id && !a.clockOut),
    )!;
    const good = { score: 0.94, live: true };
    await expect(svc.clockIn(dev, { staffNo: 'SASA9999', face: good, lat: site.lat, lng: site.lng })).rejects.toBeInstanceOf(BadRequest);
    const res = await svc.clockIn(dev, { staffNo: person.staffNo, face: good, lat: site.lat + 0.02, lng: site.lng });
    expect(res.attendance.flags).toContain('OUTSIDE_GEOFENCE');
    expect(res.attendance.flags).not.toContain('FACE_NOT_MATCHED');
    expect(res.attendance.photo).toBe(true);
    expect(res.identityCaseRef).toBeNull();
    await expect(svc.clockIn(dev, { staffNo: person.staffNo, face: good, lat: site.lat, lng: site.lng })).rejects.toThrow(/already clocked in/);
    const out = await svc.clockOut(dev, { staffNo: person.staffNo, face: good });
    expect(out.attendance.clockOut).toBe(NOW);
    expect(out.identityCaseRef).toBeNull();
    expect(out.outFlags).not.toContain('FACE_NOT_MATCHED');
  });

  it('records a failed face check and asks the supervisor to confirm, without turning the guard away', async () => {
    const { svc, ds } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const site = ds.sites.find((s) => s.id === dev.siteIds[0])!;
    const free = ds.people.filter((p) => p.companyId === 'co-sasa' && p.status === 'active' && !ds.attendance.some((a) => a.personId === p.id && !a.clockOut));
    const enrolled = free.find((p) => p.faceEnrolledOn)!;
    const res = await svc.clockIn(dev, { staffNo: enrolled.staffNo, face: { score: 0.41, live: true }, lat: site.lat, lng: site.lng });
    expect(res.attendance.flags).toContain('FACE_NOT_MATCHED');
    const c = ds.cases.find((x) => x.ref === res.identityCaseRef)!;
    expect(c.type).toBe('IDENTITY_CHECK');
    expect(c.severity).toBe('P3');

    const notEnrolled = free.find((p) => !p.faceEnrolledOn)!;
    const r2 = await svc.clockIn(dev, { staffNo: notEnrolled.staffNo, face: { score: 0, live: true }, lat: site.lat, lng: site.lng });
    expect(r2.attendance.flags).toContain('NO_FACE_ENROLMENT');
    expect(r2.identityCaseRef).not.toBeNull();
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('records a patrol by NFC tag and refuses a tag from another site', async () => {
    const { svc, ds } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const person = ds.people.find((p) => p.companyId === 'co-sasa' && p.status === 'active')!;
    const cp = ds.checkpoints.find((c) => c.siteId === dev.siteIds[0])!;
    const other = ds.checkpoints.find((c) => c.companyId === 'co-sasa' && c.siteId !== dev.siteIds[0])!;
    const r = await svc.scanCheckpoint(dev, { staffNo: person.staffNo, pin: demoPin(person.staffNo), tagCode: cp.tagCode, tagSerial: '04:A1:B2:C3' });
    expect(r.scan.method).toBe('NFC');
    expect(r.scan.tagSerial).toBe('04:A1:B2:C3');
    await expect(svc.scanCheckpoint(dev, { staffNo: person.staffNo, pin: demoPin(person.staffNo), tagCode: other.tagCode })).rejects.toThrow(/does not belong/);
    await expect(svc.scanCheckpoint(dev, { staffNo: person.staffNo, pin: '0000', tagCode: cp.tagCode })).rejects.toBeInstanceOf(BadRequest);
  });

  it('climbs officer, patrolling officer, OM, Regional OM until fully resolved; only the company closes', async () => {
    const { svc } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    // An SOS is never held up for a face check.
    const c = await svc.raiseCase(dev, {
      companyId: 'co-sasa',
      siteId: dev.siteIds[0],
      type: 'SOS',
      severity: 'P1',
      title: 'SOS pressed',
      description: 'Test',
    });
    expect(c.slaDueAt).toBe(myt(TODAY, '10:35'));
    // An officer is stationed at this site, so the case starts with them.
    expect(c.level).toBe('OFFICER');
    const fauzan = await svc.user('u-fauzan');
    const officer = await svc.user('u-sv-sasa');
    const patrol = await svc.user('u-po-sasa-1');
    const om = await svc.user('u-om-klang');
    const rom = await svc.user('u-rom-central');
    const head = await svc.user('u-opsdir');
    const cm = await svc.user('u-cm-sasa');
    await svc.updateCase(fauzan, c.id, 'acknowledge');
    // A site case is not resolved in one step, and the OM cannot jump in before the lower levels' time is up.
    await expect(svc.updateCase(cm, c.id, 'resolve', 'Done')).rejects.toThrow(/escalation steps/);
    await expect(svc.signOffCase(om, c.id, 'verified', 'Checked', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.signOffCase(officer, c.id, 'resolved', '', [proof()])).rejects.toThrow(/what was done/);
    await svc.signOffCase(officer, c.id, 'resolved', 'False alarm, guard confirmed safe.', [proof()]);
    await svc.signOffCase(patrol, c.id, 'verified', 'Visited on patrol, guard safe', [proof()]);
    // The ROM cannot confirm until the OM has signed.
    await expect(svc.signOffCase(rom, c.id, 'confirmed', 'ok', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    await svc.signOffCase(om, c.id, 'sent_back', 'Need the guard statement first');
    expect((await svc.caseDetail(officer, c.id)).case.ladder!.level).toBe('PATROL');
    await svc.signOffCase(patrol, c.id, 'resolved', 'Statement taken and attached', [proof()]);
    await svc.signOffCase(om, c.id, 'verified', 'Statement read, guard safe', [proof()]);
    expect((await svc.caseDetail(rom, c.id)).ladder!.actions).toEqual(['confirmed', 'escalated', 'sent_back']);
    // Nothing goes above the ROM by time: the head of operations cannot step in.
    await expect(svc.signOffCase(head, c.id, 'confirmed', 'ok', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.updateCase(cm, c.id, 'close', 'Reviewed.')).rejects.toThrow(/Regional Operations Manager/);
    const done = await svc.signOffCase(rom, c.id, 'confirmed', 'All resolved', [proof()]);
    expect(done.status).toBe('resolved');
    expect(done.level).toBe('DONE');
    await expect(svc.updateCase(rom, c.id, 'close', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const closed = await svc.updateCase(cm, c.id, 'close', 'Reviewed.');
    expect(closed.status).toBe('closed');
  });

  it('goes above the Regional OM only when escalated: head of operations by sector, then COO, then CEO', async () => {
    const { svc, ds } = fresh();
    const rom = await svc.user('u-rom-central');
    const ogm = await svc.user('u-ogm');
    const opsdir = await svc.user('u-opsdir');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const site = ds.sites.find(
      (s) =>
        s.companyId === 'co-sasa' &&
        s.sector === 'government' &&
        rom.regionIds!.length &&
        ['Selangor', 'Kuala Lumpur'].includes(ds.branches.find((b) => b.id === s.branchId)!.state) &&
        !ds.users.some((u) => u.role === 'supervisor' && !u.opsTier && u.siteIds.includes(s.id)),
    )!;
    const c = await svc.raiseCase(await svc.user('u-cm-sasa'), {
      companyId: 'co-sasa',
      siteId: site.id,
      type: 'COMPLAINT',
      severity: 'P2',
      title: 'Client complaint',
      description: '',
      proof: [proof()],
    });
    expect(c.level).toBe('PATROL');
    const po = ds.users.find((u) => u.opsTier === 'patrol' && u.siteIds.includes(site.id))!;
    await svc.signOffCase(po, c.id, 'verified', 'Client unhappy with the guard', [proof()]);
    await svc.signOffCase(await svc.user('u-om-klang'), c.id, 'verified', 'Met the client', [proof()]);
    await expect(svc.signOffCase(rom, c.id, 'escalated', '')).rejects.toThrow(/higher level/);
    await svc.signOffCase(rom, c.id, 'escalated', 'Client threatens to end the contract');
    // A government site goes to the OGM, not the Operations Director.
    expect((await svc.caseDetail(ogm, c.id)).ladder!.myLevel).toBe('HEAD');
    await expect(svc.signOffCase(opsdir, c.id, 'resolved', 'ok', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.signOffCase(coo, c.id, 'resolved', 'ok', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    await svc.signOffCase(ogm, c.id, 'escalated', 'Could not resolve at OGM level');
    await svc.signOffCase(coo, c.id, 'escalated', 'Needs the CEO to meet the client');
    expect((await svc.caseDetail(ceo, c.id)).ladder!.actions).toEqual(['resolved', 'sent_back']);
    const done = await svc.signOffCase(ceo, c.id, 'resolved', 'Met the client; contract kept', [proof()]);
    expect(done.level).toBe('DONE');
  });

  it("counts guards per patrolling officer against the limit of 60, and splits a shared officer's salary by guards", async () => {
    const { svc, ds } = fresh();
    const lent = ds.users.find((u) => u.opsTier === 'patrol' && u.companyIds.length > 1)!;
    expect(lent.homeCompanyId).toBe('co-sasa');
    const inasSite = lent.siteIds.find((id) => ds.sites.find((s) => s.id === id)!.companyId === 'co-inas')!;
    const otherInas = ds.sites.find((s) => s.companyId === 'co-inas' && !lent.siteIds.includes(s.id))!;
    // Works at their own Inas sites only, never Inas company-wide lists.
    expect(can(lent, ds.grants, TODAY, 'view', 'co-inas', inasSite)).toBe(true);
    expect(can(lent, ds.grants, TODAY, 'view', 'co-inas', otherInas.id)).toBe(false);
    expect(can(lent, ds.grants, TODAY, 'view', 'co-inas')).toBe(false);
    const home = await svc.home(lent);
    const tile = home.tiles.find((t) => t.label === 'Guards under your command')!;
    expect(tile.value).toBeGreaterThan(RULES.patrolSpan.value);
    expect(home.todo.some((t) => t.tag === 'Patrol size')).toBe(true);
    const board = await svc.regionalOps(await svc.user('u-rom-central'));
    const row = board.patrolOfficers.find((p) => p.userId === lent.id)!;
    expect(row.over).toBe(true);
    expect(row.alsoFor[0]).toMatch(/Inas/);
    expect(board.patrolOfficers.filter((p) => p.userId !== lent.id).every((p) => !p.over)).toBe(true);
    // Each company pays its share of RM4,000 by its guards; the Regional OM sees the split but not the amounts.
    expect(row.shares.map((x) => x.companyId)).toEqual(['co-sasa', 'co-inas']);
    expect(row.shares.every((x) => x.amount === null)).toBe(true);
    const own = (await svc.home(lent)).tiles.find((t) => t.label === 'Salary shared by')!;
    expect(own.note).toMatch(/RM/);
    const hr = (await svc.regionalOps(await svc.user('u-fauzan'), 'central')).patrolOfficers.find((p) => p.userId === lent.id)!;
    const sum = hr.shares.reduce((n, x) => n + x.amount!, 0);
    expect(Math.round(sum * 100) / 100).toBe(4000);
    const guards = hr.shares.reduce((n, x) => n + x.guards, 0);
    expect(hr.shares[0].amount).toBeCloseTo((4000 * hr.shares[0].guards) / guards, 1);
  });

  it('lets the next level step in when a level waits past its time, and lists cases waiting for me', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const rom = await svc.user('u-rom-central');
    // Seeded: Sasa cases waiting with the OM, the Regional OM and one escalated to the head of operations.
    expect((await svc.cases(rom, { waiting: 'me' })).some((c) => c.ladder?.level === 'ROM')).toBe(true);
    const heads = [...(await svc.cases(await svc.user('u-ogm'), { waiting: 'me' })), ...(await svc.cases(await svc.user('u-opsdir'), { waiting: 'me' }))];
    expect(heads.some((c) => c.ladder?.level === 'HEAD')).toBe(true);
    let atPatrol = ds.cases[0];
    for (const c of ds.cases.filter((x) => x.companyId === 'co-sasa' && x.level === 'PATROL' && x.status !== 'closed' && x.status !== 'resolved')) {
      const d = await svc.caseDetail(om, c.id);
      if (d.ladder?.myLevel === 'OM' && d.case.ladder?.overdue) {
        atPatrol = c;
        break;
      }
    }
    const v = (await svc.caseDetail(om, atPatrol.id)).case;
    expect(v.ladder!.overdue).toBe(true);
    await svc.signOffCase(om, atPatrol.id, 'verified', 'Patrolling officer did not respond; checked by phone', [proof()]);
    expect(ds.cases.find((c) => c.id === atPatrol.id)!.signOffs!.at(-1)!.stepIn).toBe(true);
    expect((await svc.cases(om, { waiting: 'me' })).every((c) => c.mine)).toBe(true);
  });

  it('needs proof to report, verify, resolve and confirm a case; an SOS is never held up (rule CASE-PROOF)', async () => {
    const { svc, ds } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const site = ds.sites.find((s) => s.id === dev.siteIds[0])!;
    const cm = await svc.user('u-cm-sasa');
    const base = { companyId: 'co-sasa', siteId: site.id, type: 'COMPLAINT' as const, severity: 'P3' as const, title: 'Broken gate', description: '' };
    await expect(svc.raiseCase(cm, base)).rejects.toThrow(/Add proof/);
    // A photo from the in-app camera counts, checked against the site.
    const photo = {
      kind: 'photo' as const,
      image: `data:image/jpeg;base64,${Buffer.from('gate photo').toString('base64')}`,
      lat: site.lat,
      lng: site.lng,
      accuracyM: 8,
      capturedAt: NOW,
    };
    const c = await svc.raiseCase(cm, { ...base, proof: [photo] });
    expect(ds.evidencePhotos.some((p) => p.caseId === c.id && p.place === 'on_site')).toBe(true);
    // The same picture cannot be given twice, and a document must be a real PDF or picture.
    await expect(svc.raiseCase(cm, { ...base, proof: [photo] })).rejects.toThrow(/already given/);
    await expect(
      svc.raiseCase(cm, { ...base, proof: [{ kind: 'document', name: 'x.exe', data: 'data:application/x-msdownload;base64,AAAA' }] }),
    ).rejects.toThrow(/PDF, JPEG or PNG/);
    const officer = await svc.user('u-sv-sasa');
    await expect(svc.signOffCase(officer, c.id, 'resolved', 'Gate repaired')).rejects.toThrow(/proof that it is done/);
    const doc = proof();
    await svc.signOffCase(officer, c.id, 'resolved', 'Gate repaired', [doc]);
    const signed = ds.cases.find((x) => x.id === c.id)!.signOffs!.at(-1)!;
    expect(signed.proofIds).toHaveLength(1);
    expect(ds.evidenceDocs.find((d) => d.id === signed.proofIds![0])!.name).toBe(doc.name);
    // Sending back or escalating needs a reason, not proof.
    const patrol = ds.users.find((u) => u.opsTier === 'patrol' && u.siteIds.includes(site.id))!;
    await svc.signOffCase(patrol, c.id, 'sent_back', 'Photo of the repaired gate is missing');
    // An SOS goes out at once, without proof; proof comes with the first sign-off.
    const sos = await svc.raiseCase(dev, { ...base, type: 'SOS', severity: 'P1', title: 'SOS' });
    expect(sos.status).toBe('open');
    await expect(svc.signOffCase(officer, sos.id, 'verified', 'Guard safe')).rejects.toThrow(/proof of what you checked/);
    // A case without a site takes a document, not a photo.
    const hq = await svc.raiseCase(cm, { ...base, siteId: null, type: 'COMPLAINT', proof: [proof()] });
    await expect(svc.updateCase(cm, hq.id, 'resolve', 'Settled')).rejects.toThrow(/proof/);
    await expect(svc.updateCase(cm, hq.id, 'resolve', 'Settled', [photo])).rejects.toThrow(/no site/);
    expect((await svc.updateCase(cm, hq.id, 'resolve', 'Settled', [proof()])).status).toBe('resolved');
    expect((await svc.caseDetail(cm, hq.id)).docs).toHaveLength(2);
  });

  it('signs a guard report from the site device with a face check', async () => {
    const { svc } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const base = { companyId: 'co-sasa', siteId: dev.siteIds[0], type: 'COMPLAINT' as const, severity: 'P3' as const, title: 'Broken fence', description: '' };
    await expect(svc.raiseCase(dev, { ...base, proof: [proof()] })).rejects.toThrow(/staff number/);
    const ok = await svc.raiseCase(dev, { ...base, proof: [proof()], reporter: { staffNo: 'SASA0002', face: { score: 0.94, live: true } } });
    expect(ok.reporter!.face).toBe('confirmed');
    const bad = await svc.raiseCase(dev, { ...base, proof: [proof()], reporter: { staffNo: 'SASA0002', face: { score: 0.4, live: true } } });
    expect(bad.reporter!.face).toBe('not_confirmed');
    expect(bad.events.at(-1)!.note).toMatch(/NOT confirmed/);
  });
});

describe('Guard profile and leave (Fauzan, 25 Oct 2026)', () => {
  it('shows the profile to the company, HR and operations; pay and benefits only to the company and HR', async () => {
    const { svc, ds } = fresh();
    const g = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && p.nationality === 'NP')!;
    const cm = await svc.user('u-cm-sasa');
    const full = await svc.guardProfile(cm, g.id);
    expect(full.pay!.basic).toBeGreaterThanOrEqual(1700);
    expect(full.benefits!.some((b) => b.name.includes('SPIKPA') && b.status === 'unknown')).toBe(true);
    expect(full.leave.balances.annual.entitled).toBeGreaterThan(0);
    expect(full.leave.balances.hospital.entitled).toBe(60);
    expect(full.upgrades.find((u) => u.id === 'ARMED')!.eligible).toBe(false);
    expect(full.hours.lastMonth.days + full.hours.thisMonth.days).toBeGreaterThan(0);
    // A foreign worker's record and payslip: FWM, not central HR (Fauzan, 26 Oct 2026).
    const fwm = await svc.guardProfile(await svc.user('u-fwm-mgr'), g.id);
    expect(fwm.access.pay).toBe(true);
    await expect(svc.guardProfile(await svc.user('u-pwvsb-hr'), g.id)).rejects.toBeInstanceOf(AccessDenied);
    const ops = await svc.guardProfile(await svc.user('u-rom-central'), g.id);
    expect(ops.access.pay).toBe(false);
    expect(ops.benefits).toBeNull();
    expect(ops.leave.balances.sick.entitled).toBeGreaterThan(0);
    await expect(svc.guardProfile(await svc.user('u-cms-head'), g.id)).rejects.toBeInstanceOf(AccessDenied);
    // Group leadership sees group data (Fauzan, 26 Oct 2026); the Director Office administrator's line is tenders.
    expect((await svc.guardProfile(await svc.user('u-cos'), g.id)).access.pay).toBe(true);
    await expect(svc.guardProfile(await svc.user('u-pwvsb-doa'), g.id)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.guardProfile(await svc.user('u-cm-inas'), g.id)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('gives leave by the Employment Act: 8, 12 or 16 annual days and 14, 18 or 22 sick days by service', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const guards = ds.people.filter((p) => p.companyId === 'co-sasa' && p.role === 'guard');
    const at = (years: number) => guards.find((p) => Math.floor(daysBetweenDates(p.hiredOn, TODAY) / 365.25) === years)!;
    expect((await svc.guardProfile(cm, at(1).id)).leave.balances.sick.entitled).toBe(14);
    expect((await svc.guardProfile(cm, at(3).id)).leave.balances.annual.entitled).toBe(12);
    expect((await svc.guardProfile(cm, at(6).id)).leave.balances.sick.entitled).toBe(22);
  });

  it('takes a leave request on the site device; only the OM or higher decides, and it moves up after 12 hours', async () => {
    const { svc, ds } = fresh();
    const dev = await svc.user('u-dev-sasa-001');
    const site = ds.sites.find((s) => s.id === dev.siteIds[0])!;
    const g = ds.people.find((p) => p.companyId === 'co-sasa' && p.branchId === site.branchId && p.role === 'guard' && p.status === 'active')!;
    const base = { staffNo: g.staffNo, face: { score: 0.93, live: true }, from: addDays(TODAY, 3), to: addDays(TODAY, 4), reason: 'Family wedding' };
    await expect(svc.requestLeave(dev, { ...base, kind: 'SICK' })).rejects.toThrow(/medical certificate/);
    // Insider abuse item 16: another guard's staff number with a face that does not match, or no face, is refused.
    await expect(svc.requestLeave(dev, { ...base, face: { score: 0.2, live: true }, kind: 'ANNUAL' })).rejects.toThrow(/face was not confirmed/);
    await expect(svc.requestLeave(dev, { ...base, face: null, kind: 'ANNUAL' })).rejects.toThrow(/face was not confirmed/);
    expect((await svc.leaveRequests(await svc.user('u-fauzan'))).rows.some((r) => r.request.personId === g.id && r.request.from === base.from)).toBe(false);
    const q = await svc.requestLeave(dev, { ...base, kind: 'ANNUAL' });
    expect(q.status).toBe('pending');
    expect(q.days).toBe(2);
    // The company and HR cannot approve a guard's leave; the area OM can.
    await expect(svc.decideLeave(await svc.user('u-cm-sasa'), q.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideLeave(await svc.user('u-pwvsb-hr'), q.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const om = ds.users.find((u) => u.opsTier === 'om' && u.areaStates!.includes(ds.branches.find((b) => b.id === g.branchId)!.state))!;
    const list = await svc.leaveRequests(om, { waiting: 'me' });
    expect(list.rows.find((r) => r.request.id === q.id)!.waitingWith!.level).toBe('OM');
    await expect(svc.decideLeave(om, q.id, false, '')).rejects.toThrow(/why/);
    expect((await svc.decideLeave(om, q.id, true, 'Covered by buffer guard')).status).toBe('approved');
    // The seeded request waiting 15 hours has moved up to the Regional OM.
    const rom = await svc.user('u-rom-central');
    const waiting = (await svc.leaveRequests(await svc.user('u-fauzan'))).rows.find((r) => r.request.kind === 'EMERGENCY')!;
    expect(waiting.waitingWith!.level).toBe('ROM');
    expect(waiting.waitingWith!.label).toBe('Regional Operations Manager');
    void rom;
    // Approved leave blocks the roster.
    const shift = ds.shifts.find((s) => s.companyId === 'co-sasa' && s.date === addDays(TODAY, 3))!;
    const cands = await svc.candidates(await svc.user('u-cm-sasa'), shift.id, g.staffNo);
    const c = cands.candidates.find((x) => x.person.id === g.id);
    if (c) expect(c.findings.some((f) => f.code === 'ON_LEAVE')).toBe(true);
  });

  it('sends other staff to the HR administrator; an approved reason with an MC excuses the absence', async () => {
    const { svc, ds } = fresh();
    const office = ds.leaveRequests.find((q) => q.status === 'pending' && ds.people.find((p) => p.id === q.personId)!.role === 'office')!;
    await expect(svc.decideLeave(await svc.user('u-rom-central'), office.id, true, '')).rejects.toBeInstanceOf(AccessDenied);
    // Fauzan, 3 Nov 2026: the Company Manager authorises first (licensed company staff); HR cannot act before that,
    // and a manager of another company cannot authorise.
    const cm = ds.users.find((u) => u.role === 'company_manager' && u.companyIds.includes(office.companyId) && u.personId !== office.personId)!;
    const otherCm = ds.users.find((u) => u.role === 'company_manager' && !u.companyIds.includes(office.companyId))!;
    await expect(svc.decideLeave(await svc.user('u-pwvsb-hr'), office.id, true, 'Cover arranged')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideLeave(otherCm, office.id, true, 'Not mine')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideLeave(cm, office.id, true, '')).rejects.toThrow();
    const auth = await svc.decideLeave(cm, office.id, true, 'Desk covered by the backup');
    expect(auth.status).toBe('pending');
    expect(auth.managerAuthorised?.byId).toBe(cm.id);
    await expect(svc.decideLeave(cm, office.id, true, 'Again')).rejects.toBeInstanceOf(AccessDenied);
    // HR Phase 3 (Fauzan, 1 Nov 2026): HR approves with a comment, then the Vice Chairman consents.
    expect((await svc.decideLeave(await svc.user('u-pwvsb-hr'), office.id, true, 'Cover arranged')).status).toBe('pending');
    expect((await svc.decideLeave(await svc.user('u-vchair'), office.id, true, 'Consent')).status).toBe('approved');
    const reason = ds.leaveRequests.find((q) => q.kind === 'ABSENCE_REASON' && q.status === 'pending')!;
    const before = (await svc.attendanceIssues(['co-sasa'], reason.from, reason.from)).find((i) => i.personId === reason.personId && i.issue === 'NO_SHOW');
    const p = ds.people.find((x) => x.id === reason.personId)!;
    const om = ds.users.find((u) => u.opsTier === 'om' && u.areaStates!.includes(ds.branches.find((b) => b.id === p.branchId)!.state))!;
    await svc.decideLeave(om, reason.id, true, 'MC checked');
    if (before?.open) {
      const after = (await svc.attendanceIssues(['co-sasa'], reason.from, reason.from)).find((i) => i.shiftId === before.shiftId && i.issue === 'NO_SHOW')!;
      expect(after.open).toBe(false);
    }
  });
});

describe('KDN vetting and CSG first-year rules (Fauzan, 24 Oct 2026)', () => {
  const csg = goodCreds[1];
  const vetting = (daysAgo: number) => ({
    id: 'v1',
    companyId: 'co-a',
    personId: 'p1',
    type: 'KDN_VETTING' as const,
    number: 'eSIMS-1',
    issuedOn: addDays(TODAY, -daysAgo),
    expiresOn: null,
  });

  it('allows work while KDN vetting is pending if submitted in eSIMS', () => {
    const f = deployability(basePerson, [csg, vetting(5)], TODAY, false);
    expect(f.map((x) => [x.level, x.code])).toEqual([['warn', 'KDN_VETTING_PENDING']]);
  });

  it('asks for follow-up when vetting takes longer than 3 weeks, but still allows work', () => {
    const f = deployability(basePerson, [csg, vetting(25)], TODAY, false);
    expect(f[0].level).toBe('warn');
    expect(f[0].message).toMatch(/longer than the usual 3 weeks/);
  });

  it('blocks when there is no card and nothing submitted in eSIMS', () => {
    const f = deployability(basePerson, [csg], TODAY, false);
    expect(f[0]).toMatchObject({ level: 'block', code: 'MISSING_KDN_GUARD_CARD' });
  });

  it('ignores a submission older than an expired card (it was for that card)', () => {
    const expired = { ...goodCreds[0], issuedOn: addDays(TODAY, -400), expiresOn: addDays(TODAY, -10) };
    const old = { ...vetting(500) };
    const f = deployability(basePerson, [expired, csg, old], TODAY, false);
    expect(f[0]).toMatchObject({ level: 'block', code: 'EXPIRED_KDN_GUARD_CARD' });
    const renewal = vetting(3);
    expect(deployability(basePerson, [expired, csg, renewal], TODAY, false)[0].code).toBe('KDN_VETTING_PENDING');
  });

  it('allows a new guard without CSG during the first year, then blocks', () => {
    const newGuard = { ...basePerson, hiredOn: addDays(TODAY, -100) };
    const f = deployability(newGuard, [goodCreds[0]], TODAY, false);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: 'warn', code: 'CSG_DUE_FIRST_YEAR' });
    const oldGuard = { ...basePerson, hiredOn: addDays(TODAY, -400) };
    expect(deployability(oldGuard, [goodCreds[0]], TODAY, false)[0]).toMatchObject({ level: 'block', code: 'CSG_PAST_FIRST_YEAR' });
  });

  it('counts the first year to the same date a year later', () => {
    const g = { ...basePerson, hiredOn: '2025-10-26' };
    expect(deployability(g, [goodCreds[0]], TODAY, false)[0].code).toBe('CSG_DUE_FIRST_YEAR');
    const h = { ...basePerson, hiredOn: '2025-10-25' };
    expect(deployability(h, [goodCreds[0]], TODAY, false)[0].code).toBe('CSG_PAST_FIRST_YEAR');
  });

  it('mock data includes guards working on pending vetting and first-year CSG', () => {
    const { ds } = fresh();
    expect(ds.credentials.some((c) => c.type === 'KDN_VETTING')).toBe(true);
    const firstYearNoCsg = ds.people.filter(
      (p) => p.hiredOn > addDays(TODAY, -365) && !ds.credentials.some((c) => c.personId === p.id && c.type === 'CSG_TRAINING'),
    );
    expect(firstYearNoCsg.length).toBeGreaterThan(0);
  });
});

describe('Chief of Staff insurance section (Fauzan, 25 Oct 2026)', () => {
  it('flags premiums, lapsed cover, late claims and guarantees, and shows companies without records as unknown', async () => {
    const { svc } = fresh();
    const b = await svc.insurance(await svc.user('u-cos'));
    expect(b.rows).toHaveLength(38);
    expect(b.tiles.unknown).toBe(35);
    const kinds = new Set(b.alerts.map((a) => `${a.tone}:${a.kind}`));
    for (const k of ['crit:Premium', 'crit:Cover lapsed', 'crit:Claim', 'crit:Guarantee', 'crit:No cover', 'warn:Renewal', 'info:Guarantee'])
      expect(kinds).toContain(k);
    const arsh = b.rows.find((r) => r.company.id === 'co-arsh');
    expect(arsh?.hasDetail && arsh.missing.map((m) => m.kind)).toEqual(['FIDELITY_GUARANTEE']);
    expect(b.guarantees.find((g) => g.guarantee.id === 'gt-inas-1')?.state).toBe('lapsed');
    expect(b.guarantees.find((g) => g.guarantee.id === 'gt-arsh-1')?.state).toBe('release');
    expect(b.claims.find((c) => c.claim.id === 'cl-sasa-2')).toMatchObject({ open: true });
  });

  it('lets a company see only its own insurance and keeps other departments out', async () => {
    const { svc } = fresh();
    const own = await svc.insurance(await svc.user('u-ae-arsh'));
    expect(new Set(own.policies.map((p) => p.policy.companyId))).toEqual(new Set(['co-arsh']));
    await expect(svc.insurance(await svc.user('u-pwvsb-arms'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.insurance(await svc.user('u-sv-sasa'))).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('CMS management (Fauzan, 25 Oct 2026)', () => {
  it('staffs every shift with 1 Head Control and 1 Monitor Officer and shows the gaps', async () => {
    const { svc, ds } = fresh();
    const b = await svc.cms(await svc.user('u-pwvsb-arms'));
    for (const r of b.roster) {
      expect(r.seats.filter((s) => s.shift.post === 'HEAD_CONTROL')).toHaveLength(1);
      expect(r.seats.filter((s) => s.shift.post === 'MONITOR_OFFICER')).toHaveLength(1);
    }
    expect(b.tiles.rosterGaps).toBe(2);
    expect(b.alerts.some((a) => a.kind === 'No-show')).toBe(true);
    expect(b.canManage).toBe(true);
    // A Monitor Officer cannot sit as Head Control, and nobody works more than 12 hours in a row.
    const asst = await svc.user('u-pwvsb-arms-asst');
    const hcGap = b.roster.flatMap((r) => r.seats).find((s) => s.shift.post === 'HEAD_CONTROL' && s.state === 'uncovered')!;
    await expect(svc.assignCmsShift(asst, hcGap.shift.id, 'Arjun Thapa')).rejects.toThrow(/not qualified/);
    const before = ds.cmsShifts.find((x) => x.staffName && x.end === hcGap.shift.start && x.post === 'HEAD_CONTROL')!;
    await expect(svc.assignCmsShift(asst, hcGap.shift.id, before.staffName!)).rejects.toThrow(/24 hours in a row/);
  });

  it('lets only Arms Control change the CMS settings, never below the minimum, and re-plans from tomorrow', async () => {
    const { svc, ds } = fresh();
    const arms = await svc.user('u-pwvsb-arms');
    await expect(svc.updateCmsSettings(await svc.user('u-cms-head'), { forwardAfterSec: 30 })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.updateCmsSettings(arms, { monitorOfficersPerShift: 0 })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.updateCmsSettings(arms, { firstShiftStart: '07:15' })).rejects.toBeInstanceOf(BadRequest);
    const r = await svc.updateCmsSettings(arms, { shiftPattern: '3x8', monitorOfficersPerShift: 2 });
    expect(r.replanned?.from).toBe(addDays(TODAY, 1));
    const tomorrow = ds.cmsShifts.filter((x) => x.date === addDays(TODAY, 1) && !x.cancelled);
    expect(new Set(tomorrow.map((x) => x.start)).size).toBe(3);
    expect(tomorrow.filter((x) => x.post === 'MONITOR_OFFICER')).toHaveLength(6);
    // Today's shifts stay as rostered.
    expect(ds.cmsShifts.filter((x) => x.date === TODAY && !x.cancelled).every((x) => x.end.slice(11, 16) === '19:00' || x.end.slice(11, 16) === '07:00')).toBe(
      true,
    );
    expect(ds.audit.some((a) => a.action === 'arms.cms_settings')).toBe(true);
    const plan = await svc.planCmsRoster(arms, 7);
    expect(plan.added).toBe(7 * 3 * 3);
  });

  it('runs the IP phone desk: forwarded calls, call-backs and extension problems, behind the company wall', async () => {
    const { svc } = fresh();
    const head = await svc.user('u-cms-head');
    const b = await svc.cms(head);
    expect(b.callbacks.length).toBe(2);
    expect(b.callbacks.some((c) => c.late)).toBe(true);
    expect(new Set(b.extensions.filter((x) => x.issue).map((x) => x.issue))).toEqual(new Set(['ring_mismatch', 'not_forwarding', 'offline', 'unknown']));
    await expect(svc.logCallback(head, b.callbacks[0].call.id, '')).rejects.toBeInstanceOf(BadRequest);
    await svc.logCallback(head, b.callbacks[0].call.id, 'Client asked for a relief guard; passed to Sasa ops');
    expect((await svc.cms(head)).callbacks.length).toBe(1);
    // CMS staff work the desk only, never a company's own screens.
    await expect(svc.people(head, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.cms(await svc.user('u-pwvsb-hr'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('watches every site: attendance, patrols, CCTV, emergencies and incidents, and passes real events to the company', async () => {
    const { svc, ds } = fresh();
    const head = await svc.user('u-cms-head');
    const b = await svc.cms(head);
    const o = b.ops;
    expect(o.tiles.sites).toBe(ds.sites.length);
    expect(o.tiles.alarmsNotAcked).toBe(2);
    expect(o.tiles.cctvLinked + o.tiles.notLinked).toBe(ds.sites.length);
    expect(o.tiles.cctvFaults).toBeGreaterThan(0);
    expect(o.byCompany.length).toBeGreaterThan(0);
    // A site without a linked CCTV is never shown as live.
    expect(o.sites.some((s) => s.monitoring === 'not_linked')).toBe(true);
    expect(o.tiles.cctvLive).toBeLessThan(o.tiles.cctvLinked);
    expect(b.alerts.some((a) => a.kind === 'Emergency')).toBe(true);
    const sos = ds.siteAlarms.find((a) => a.kind === 'GUARD_SOS' && a.status === 'new')!;
    await expect(svc.closeAlarm(head, sos.id, 'real', '')).rejects.toBeInstanceOf(BadRequest);
    await svc.acknowledgeAlarm(head, sos.id);
    await expect(svc.acknowledgeAlarm(head, sos.id)).rejects.toBeInstanceOf(BadRequest);
    const closed = await svc.closeAlarm(head, sos.id, 'real', 'Guard confirmed by radio, intruder at back gate');
    // The company decides the response: CMS opens the company's case, it does not act for them.
    const c = ds.cases.find((x) => x.id === closed.caseId)!;
    expect(c.companyId).toBe(sos.companyId);
    expect(c.severity).toBe('P1');
    const tamper = ds.siteAlarms.find((a) => a.kind === 'CAMERA_TAMPER' && a.status === 'new')!;
    const f = await svc.closeAlarm(head, tamper.id, 'false', 'Cleaner moved the camera, checked live view');
    expect(f.caseId).toBeNull();
    expect((await svc.cms(head)).ops.tiles.alarmsNotAcked).toBe(0);
    expect(ds.audit.filter((a) => a.action === 'arms.cms_alarm').length).toBeGreaterThanOrEqual(3);
    // Only the CMS desk handles alarms.
    const other = ds.siteAlarms.find((a) => a.status !== 'closed')!;
    await expect(svc.acknowledgeAlarm(await svc.user('u-pwvsb-hr'), other.id)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Attendance alerts to the PIC (Shahirah, 25 Oct 2026)', () => {
  it('alerts the PIC every 5 minutes until a replacement is sent, and shows the replacement under the post', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const a = await svc.attendanceAlerts(cm, 'co-sasa');
    const ns = a.open.find((i) => i.issue === 'NO_SHOW')!;
    expect(ns.repeating).toBe(true);
    expect(ns.alertsSent).toBe(Math.floor((toMs(NOW) - toMs(ns.raisedAt)) / 300_000) + 1);
    expect(ns.pic.name).toBeTruthy();
    const home = await svc.home(cm);
    expect(home.todo.some((t) => t.go.view === 'attendance' && t.tag.startsWith('Alert'))).toBe(true);
    // CMS can tell the guard, but that alone does not stop an absence alert.
    await svc.followUpAttendance(await svc.user('u-cms-head'), { shiftId: ns.shiftId, issue: 'NO_SHOW', kind: 'STAFF_ALERTED', note: 'Called, no answer' });
    let again = (await svc.attendanceAlerts(cm, 'co-sasa')).open.find((i) => i.key === ns.key)!;
    expect(again.repeating).toBe(true);
    expect(again.actions[0].byDesk).toBe('cms');
    // CMS cannot send a replacement or record discipline: the company decides.
    await expect(
      svc.followUpAttendance(await svc.user('u-cms-head'), { shiftId: ns.shiftId, issue: 'NO_SHOW', kind: 'EXCUSED', proof: [proof()], note: 'MC' }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const cands = await svc.candidates(cm, ns.shiftId!);
    const sub = cands.candidates.find((c) => !c.blocked && c.person.id !== ns.personId)!;
    const r = await svc.followUpAttendance(cm, {
      shiftId: ns.shiftId,
      issue: 'NO_SHOW',
      kind: 'REPLACEMENT',
      note: 'Buffer guard',
      replacementPersonId: sub.person.id,
    });
    expect(r.replacement!.postId).toBe(ds.shifts.find((x) => x.id === ns.shiftId)!.postId);
    expect(r.replacement!.start).toBe(NOW);
    again = (await svc.attendanceAlerts(cm, 'co-sasa')).absences.find((i) => i.key === ns.key)!;
    expect(again.open).toBe(false);
    expect(again.repeating).toBe(false);
    const day = await svc.attendance(cm, 'co-sasa', TODAY);
    expect(day.replacementFor[r.replacement!.id]).toBe(ns.shiftId);
    expect(ds.audit.at(-1)!.action).toBe('attendance.followup');
  });

  it('records discipline only when the company decides it, with a reason, and keeps it in the absence list', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ns = (await svc.attendanceAlerts(cm, 'co-sasa')).open.find((i) => i.issue === 'NO_SHOW')!;
    await expect(
      svc.followUpAttendance(cm, { shiftId: ns.shiftId, issue: 'NO_SHOW', kind: 'DISCIPLINE', proof: [proof()], note: '', discipline: 'VERBAL_WARNING' }),
    ).rejects.toBeInstanceOf(BadRequest);
    // Admin executives can contact the guard but not discipline.
    const ae = await svc.user('u-ae-arsh');
    const arsh = (await svc.attendanceAlerts(ae, 'co-arsh')).open[0];
    await expect(
      svc.followUpAttendance(ae, {
        shiftId: arsh.shiftId,
        attendanceId: arsh.attendanceId,
        issue: arsh.issue,
        kind: 'DISCIPLINE',
        proof: [proof()],
        note: 'Late again',
        discipline: 'VERBAL_WARNING',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await svc.followUpAttendance(cm, {
      shiftId: ns.shiftId,
      issue: 'NO_SHOW',
      kind: 'DISCIPLINE',
      proof: [proof()],
      note: 'Absent without notice',
      discipline: 'VERBAL_WARNING',
    });
    // Discipline is a record, not cover: the post is still empty, so the alert keeps going.
    const a = await svc.attendanceAlerts(cm, 'co-sasa');
    expect(a.open.some((i) => i.key === ns.key)).toBe(true);
    expect(a.discipline.some((d) => d.record.shiftId === ns.shiftId && d.record.discipline === 'VERBAL_WARNING')).toBe(true);
    expect(ds.audit.at(-1)!.action).toBe('attendance.discipline');
    // An excuse needs a reason and closes the absence.
    await expect(svc.followUpAttendance(cm, { shiftId: ns.shiftId, issue: 'NO_SHOW', kind: 'EXCUSED', proof: [proof()], note: '' })).rejects.toBeInstanceOf(
      BadRequest,
    );
    await svc.followUpAttendance(cm, { shiftId: ns.shiftId, issue: 'NO_SHOW', kind: 'EXCUSED', proof: [proof()], note: 'Medical certificate received' });
    expect((await svc.attendanceAlerts(cm, 'co-sasa')).open.some((i) => i.key === ns.key)).toBe(false);
    // Yesterday's seeded records show in the list; another company never sees them.
    expect(a.records.length).toBeGreaterThan(3);
    expect((await svc.attendanceAlerts(await svc.user('u-cm-inas'), 'co-inas')).records.every((x) => x.record.companyId === 'co-inas')).toBe(true);
  });

  it('follows one group handbook for every guard and the Employment Act: heard first, inquiry before punishment', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ns = (await svc.attendanceAlerts(cm, 'co-sasa')).absences.find((i) => i.issue === 'NO_SHOW')!;
    ds.users.find((x) => x.id === 'u-sv-sasa')!.siteIds.push(ns.siteId);
    const sv = await svc.user('u-sv-sasa');
    const act = (u: typeof cm, discipline: 'VERBAL_WARNING' | 'FINAL_WARNING' | 'SHOW_CAUSE' | 'DOMESTIC_INQUIRY' | 'SUSPENSION' | 'DISMISSAL', extra = {}) =>
      svc.followUpAttendance(u, {
        shiftId: ns.shiftId,
        issue: 'NO_SHOW',
        kind: 'DISCIPLINE',
        proof: [proof()],
        note: 'Absent without notice',
        discipline,
        ...extra,
      });
    // Same ladder in every company; the supervisor gives warnings only.
    await expect(act(sv, 'FINAL_WARNING')).rejects.toThrow(/Company Manager/);
    // No punishment without an inquiry, and no inquiry before the guard has answered a show-cause letter.
    await expect(act(cm, 'DISMISSAL')).rejects.toThrow(/domestic inquiry/);
    await expect(act(cm, 'DOMESTIC_INQUIRY')).rejects.toThrow(/show-cause/);
    const sc = await act(cm, 'SHOW_CAUSE');
    expect(sc.record.replyDue).toBe(addDays(TODAY, 3));
    await expect(act(cm, 'DOMESTIC_INQUIRY')).rejects.toThrow(/reply, due/);
    const h = await svc.disciplineHistory(cm, 'co-sasa', ns.personId!);
    expect(h.suggested).toBe('DOMESTIC_INQUIRY');
    expect(h.law.label).toBe('Law');
    // Arrow Shield guard absent 3 working days running is flagged for HR, never acted on by the app.
    const arsh = await svc.attendanceAlerts(await svc.user('u-cm-arsh'), 'co-arsh');
    expect(arsh.s15.some((x) => x.days >= 3)).toBe(true);
  });
});

describe('Photo evidence and site visits (Fauzan, 25 Oct 2026)', () => {
  const jpeg = (n: number) => 'data:image/jpeg;base64,' + Buffer.from(`test-photo-${n}`.repeat(20)).toString('base64');

  it('stamps incident photos with server time, checks GPS against the site and fingerprints the image', async () => {
    const { svc, ds } = fresh();
    const c = ds.cases.find((x) => x.companyId === 'co-sasa' && x.siteId && x.status === 'open')!;
    const site = ds.sites.find((x) => x.id === c.siteId)!;
    const cm = await svc.user('u-cm-sasa');
    const before = ds.evidencePhotos.filter((p) => p.caseId === c.id).length;
    // No GPS, no photo; gallery files or anything that is not a camera image are refused.
    await expect(svc.addCasePhoto(cm, c.id, { image: jpeg(1), lat: null, lng: null })).rejects.toThrow(/geo-tagged/);
    await expect(svc.addCasePhoto(cm, c.id, { image: 'https://example.com/x.jpg', lat: site.lat, lng: site.lng })).rejects.toBeInstanceOf(BadRequest);
    const on = await svc.addCasePhoto(cm, c.id, { image: jpeg(1), lat: site.lat, lng: site.lng, accuracyM: 6, capturedAt: myt(TODAY, '10:28') });
    expect(on.place).toBe('on_site');
    expect(on.receivedAt).toBe(NOW);
    expect(on.time).toBe('ok');
    expect(on.sha256).toHaveLength(64);
    const away = await svc.addCasePhoto(cm, c.id, { image: jpeg(2), lat: site.lat + 0.02, lng: site.lng, accuracyM: 6, capturedAt: myt(TODAY, '09:00') });
    expect(away.place).toBe('away');
    expect(away.time).toBe('sent_later');
    const weak = await svc.addCasePhoto(cm, c.id, { image: jpeg(3), lat: site.lat, lng: site.lng, accuracyM: 400, capturedAt: myt(TODAY, '10:45') });
    expect(weak.place).toBe('weak_gps');
    expect(weak.time).toBe('clock_wrong');
    await expect(svc.addCasePhoto(cm, c.id, { image: jpeg(1), lat: site.lat, lng: site.lng })).rejects.toThrow(/already attached/);
    const d = await svc.caseDetail(cm, c.id);
    expect(d.photos).toHaveLength(before + 3);
    expect(d.case.events.filter((e) => e.action === 'photo')).toHaveLength(3);
    expect(ds.audit.at(-1)!.summary).toContain('SHA-256');
    // Another company cannot add evidence.
    await expect(svc.addCasePhoto(await svc.user('u-cm-inas'), c.id, { image: jpeg(4), lat: site.lat, lng: site.lng })).rejects.toBeInstanceOf(AccessDenied);
  });

  it('checks a site visit in by GPS and closes it only with a photo and findings', async () => {
    const { svc, ds } = fresh();
    const sv = await svc.user('u-sv-sasa');
    const site = ds.sites.find((x) => x.id === sv.siteIds[1])!;
    await expect(svc.startSiteVisit(sv, site.id, { lat: null, lng: null, purpose: 'Routine' })).rejects.toThrow(/geo-tagged/);
    await expect(svc.startSiteVisit(sv, 'st-sasa-050', { lat: 3, lng: 101, purpose: 'Routine' })).rejects.toBeInstanceOf(AccessDenied);
    const v = await svc.startSiteVisit(sv, site.id, { lat: site.lat, lng: site.lng, accuracyM: 5, purpose: 'Routine check' });
    expect(v.place).toBe('on_site');
    expect(v.startedAt).toBe(NOW);
    await expect(svc.startSiteVisit(sv, site.id, { lat: site.lat, lng: site.lng, purpose: 'Again' })).rejects.toThrow(/Close your open/);
    await expect(svc.closeSiteVisit(sv, v.id, 'All fine')).rejects.toThrow(/at least one photo/);
    await svc.addVisitPhoto(sv, v.id, { image: jpeg(9), lat: site.lat, lng: site.lng, accuracyM: 5 });
    await expect(svc.addVisitPhoto(await svc.user('u-cm-sasa'), v.id, { image: jpeg(10), lat: site.lat, lng: site.lng })).rejects.toThrow(/Only the person/);
    const closed = await svc.closeSiteVisit(sv, v.id, 'Guard alert, logbook complete');
    expect(closed.status).toBe('closed');
    const list = await svc.siteVisits(sv, site.id);
    expect(list.visits[0].photos).toHaveLength(1);
    // The seeded visit checked in 1.3 km away is flagged, not hidden.
    expect(ds.siteVisits.some((x) => x.place === 'away')).toBe(true);
    // PWVSB operations may visit with a grant; HR may not.
    await expect(svc.startSiteVisit(await svc.user('u-pwvsb-hr'), site.id, { lat: site.lat, lng: site.lng, purpose: 'Look' })).rejects.toBeInstanceOf(
      AccessDenied,
    );
  });
});

describe("Guard's own view (Fauzan, 25 Oct 2026)", () => {
  it('shows a guard their own details, roster, clock record and patrol rounds, view only', async () => {
    const { svc, ds } = fresh();
    const me = await svc.user('u-guard-sasa-1');
    const d = await svc.myDuty(me);
    expect(d.person.id).toBe(me.personId);
    expect(d.profile.pay!.basic).toBeGreaterThan(0);
    expect(d.profile.access.requestLeave).toBe(false);
    expect(d.roster.length).toBeGreaterThan(0);
    expect(d.roster.every((r) => r.date >= addDays(TODAY, -1))).toBe(true);
    expect(d.clockRecord.length).toBeGreaterThan(0);
    expect(d.patrols.length).toBeGreaterThan(0);
    expect(d.patrols.flatMap((p) => p.rounds).every((r) => ['done', 'partly', 'colleague', 'missed', 'now'].includes(r.status))).toBe(true);
    expect(d.reminders.length).toBeGreaterThan(0);
    // Only published shifts show.
    const draft = ds.shifts.find((s) => s.personId === me.personId && s.status === 'draft');
    if (draft) expect(d.roster.some((r) => r.id === draft.id)).toBe(false);
  });

  it('opens nothing else: no company screen and no other guard', async () => {
    const { svc, ds } = fresh();
    const me = await svc.user('u-guard-sasa-1');
    const other = ds.people.find((p) => p.companyId === 'co-sasa' && p.id !== me.personId)!;
    const site = ds.sites.find((s) => s.companyId === 'co-sasa')!;
    const denied = [
      () => svc.companyDashboard(me, 'co-sasa'),
      () => svc.sites(me, 'co-sasa'),
      () => svc.siteDetail(me, site.id),
      () => svc.people(me, 'co-sasa'),
      () => svc.personDetail(me, other.id),
      () => svc.guardProfile(me, other.id),
      () => svc.attendance(me, 'co-sasa', TODAY),
      () => svc.attendanceAlerts(me, 'co-sasa'),
      () => svc.regionalOps(me),
      () => svc.requestLeave(me, { personId: me.personId!, kind: 'ANNUAL', from: addDays(TODAY, 5), to: addDays(TODAY, 5), reason: 'Trip home', proof: [] }),
    ];
    for (const f of denied) await expect(f()).rejects.toThrow();
    expect((await svc.leaveRequests(me)).rows).toHaveLength(0);
    expect(await svc.cases(me).catch(() => [])).toHaveLength(0);
    await expect(svc.cases(me, { companyId: 'co-sasa' }).then((r) => r.length)).resolves.toBe(0);
    expect((await svc.groupOverview(me)).length).toBe(0);
    // Every staff member now has their own record; the CEO, Chairman and Vice Chairman do not (Fauzan, 26 Oct 2026).
    await expect(svc.myDuty(await svc.user('u-cm-sasa'))).resolves.toBeDefined();
    await expect(svc.myDuty(await svc.user('u-fauzan'))).rejects.toBeInstanceOf(BadRequest);
  });

  it('gives every staff sign-in their own details and clock, except the CEO, Chairman and Vice Chairman', async () => {
    const { svc, ds } = fresh();
    for (const u of ds.users.filter((x) => !['guard', 'site_device'].includes(x.role) && x.integration !== 'planner')) {
      const exempt = u.opsTier === 'ceo' || u.leadership === 'chairman' || u.leadership === 'vice_chairman';
      expect(!!u.personId, u.id).toBe(!exempt);
      if (!exempt) {
        const d = await svc.myDuty(u);
        expect(d.person.name).toBe(u.name);
      }
    }
    // Central staff ask for their own leave; HR decides; nobody decides their own.
    const doa = await svc.user('u-pwvsb-doa');
    const q = await svc.requestLeave(doa, { personId: doa.personId!, kind: 'ANNUAL', from: addDays(TODAY, 10), to: addDays(TODAY, 11), reason: 'Family trip' });
    expect(q.companyId).toBe('pwvsb');
    const hr = await svc.user('u-pwvsb-hr');
    expect((await svc.leaveRequests(hr)).rows.some((r) => r.request.id === q.id && r.canDecide)).toBe(true);
    await expect(svc.decideLeave(hr, q.id, true, 'OK')).resolves.toBeDefined();
    const own = await svc.requestLeave(hr, { personId: hr.personId!, kind: 'ANNUAL', from: addDays(TODAY, 14), to: addDays(TODAY, 14), reason: 'Errand' });
    await expect(svc.decideLeave(hr, own.id, true, '')).rejects.toBeInstanceOf(AccessDenied);
    // Another person's record stays closed.
    await expect(svc.guardProfile(doa, hr.personId!)).rejects.toThrow();
    // The CEO has no staff clock.
    expect((await svc.myStaffClock(await svc.user('u-fauzan'))).allowed).toBe(false);
    expect((await svc.myStaffClock(doa)).allowed).toBe(true);
  });

  it('lets officers see their own record as well, besides their work screens', async () => {
    const { svc, ds } = fresh();
    for (const id of ['u-sv-sasa', 'u-po-sasa-3']) {
      const u = await svc.user(id);
      const d = await svc.myDuty(u);
      expect(d.person.name).toBe(u.name);
      expect(d.profile.pay!.basic).toBeGreaterThan(0);
    }
    const sv = await svc.user('u-sv-sasa');
    const other = ds.people.find((p) => p.companyId === 'co-inas')!;
    await expect(svc.guardProfile(sv, other.id)).rejects.toThrow();
  });
});

describe('Tender guide V1.0 and the JKR checklist (Director Office, 11 Oct 2026)', () => {
  it('loads the guide as the protocol and handles T/B, the manager-only price approval and the steps the app ticks', async () => {
    const { svc, ds } = fresh();
    const ae = await svc.user('u-ae-arsh');
    const cm = await svc.user('u-cm-arsh');
    const doa = await svc.user('u-pwvsb-doa');
    const p = (await svc.tenderProtocol(ae)).protocol;
    expect(p.steps).toHaveLength(36);
    expect(p.placeholder).toBe(false);
    expect(p.steps.filter((s) => s.before === 'preparing').map((s) => s.code)).toEqual([
      '02.01',
      '02.02',
      '02.03',
      '02.04',
      '02.05',
      '02.06',
      '02.07',
      '02.08',
      '02.09',
    ]);
    const t = ds.tenders.find((x) => x.companyId === 'co-arsh' && x.status === 'open')!;
    await expect(svc.doTenderStep(ae, t.id, 'g02_07', 'Tiada taklimat', [], { status: 'na' })).rejects.toThrow(/reference/);
    await svc.doTenderStep(ae, t.id, 'g02_07', 'Tiada taklimat dalam notis', [], { status: 'na', ref: 'Notis para 4' });
    await expect(svc.confirmTenderNa(ae, t.id, 'g02_07', true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.decideTender(cm, t.id, 'TERUSKAN', 'ok');
    for (const s of p.steps.filter((x) => x.before === 'preparing' && x.id !== 'g02_07'))
      await svc.doTenderStep(ae, t.id, s.id, 'Disemak', s.needsDocument ? [proof()] : []);
    await expect(svc.updateTender(ae, t.id, 'preparing')).rejects.toThrow(/T\/B waiting for a supervisor/);
    await svc.confirmTenderNa(doa, t.id, 'g02_07', true, 'ok');
    expect((await svc.updateTender(ae, t.id, 'preparing')).status).toBe('preparing');
    await expect(svc.doTenderStep(ae, t.id, 'g04_09', 'Harga diluluskan', [proof()])).rejects.toThrow(/company manager/);
    await svc.doTenderStep(cm, t.id, 'g04_09', 'Harga versi 1 diluluskan', [proof()]);
    await expect(svc.doTenderStep(ae, t.id, 'g05_06', 'Disemak')).rejects.toThrow(/check is given/);
    await svc.planTenderStep(ae, t.id, 'g03_01', 'Siti Hajar', addDays(TODAY, 1));
    const row = (await svc.commercial(ae, 'co-arsh')).tenders.find((r) => r.tender.id === t.id)!;
    expect(row.protocol.find((x) => x.step.id === 'g03_01')!.plan!.pic).toBe('Siti Hajar');
    expect(row.protocol.find((x) => x.step.id === 'g02_07')!.finished).toBe(true);
    expect(row.protocol.find((x) => x.step.id === 'g05_06')!.done).toBeNull();
  });

  it('works out the hourly price check and the priority, and seeds the JKR tender without the officer contact', async () => {
    expect(tenderHourly({ indicativeTotal: 3999999, contractMonths: 60 }).ok).toBe(false);
    const h = tenderHourly({ indicativeTotal: 3999999, contractMonths: 60, dayPosts: 10, nightPosts: 6, shiftHours: 12 });
    if (!h.ok) throw new Error('expected a result');
    expect(h.hourly).toBeCloseTo(11.384, 3);
    expect(h.scenarios.map((x) => x.cut)).toEqual([0, 3, 4.99, 9.99]);
    expect(h.scenarios[3].hourly).toBeCloseTo(11.384 * 0.9001, 2);
    const { svc, ds } = fresh();
    const jkr = ds.tenders.find((x) => x.ref === 'QT260000000027957')!;
    expect(tenderPriority(jkr, TODAY)).toMatchObject({ level: 'SHORT', days: 5 });
    expect(jkr.queries).toHaveLength(6);
    expect(jkr.record!.priceLines!.reduce((a, l) => a + l.monthly * l.months, 0)).toBeCloseTo(3999999, 2);
    expect(JSON.stringify(jkr)).not.toMatch(/fareez|26107029/i);
    const board = await svc.tenderBoard(await svc.user('u-pwvsb-doa'));
    const r = board.rows.find((x) => x.tender.id === jkr.id)!;
    expect(r.naWaiting).toBe(1);
    expect(r.mine).toBe(true);
    expect(r.openQueries).toBe(6);
  });
});

describe('Staff clock (Fauzan, 26 Oct 2026)', () => {
  const img = 'data:image/jpeg;base64,' + btoa('test');
  it('clocks staff in with a stamped photo and location, follows them only while clocked in, and shows silence as Unknown', async () => {
    const { svc } = fresh();
    const ae = await svc.user('u-cm-inas');
    expect((await svc.myStaffClock(await svc.user('u-guard-sasa-1'))).allowed).toBe(false);
    await expect(svc.staffPing(ae, { lat: 3.0567, lng: 101.5851, accuracyM: 10 })).rejects.toThrow(/only while you are clocked in/);
    await expect(svc.staffClockIn(ae, { image: 'x', capturedAt: NOW, lat: 3, lng: 101, accuracyM: 5, face: null })).rejects.toThrow(/camera/);
    const rec = await svc.staffClockIn(ae, { image: img, capturedAt: NOW, lat: 3.0568, lng: 101.5851, accuracyM: 8, face: null });
    expect(rec.flags).toEqual(['PHOTO_ONLY']);
    expect(rec.in.distanceM).toBeLessThan(200);
    // P93: clocking in again returns the open clock instead of an error.
    expect((await svc.staffClockIn(ae, { image: img, capturedAt: NOW, lat: null, lng: null, accuracyM: null, face: null })).id).toBe(rec.id);
    const mine = await svc.myStaffClock(ae);
    expect(mine.open!.id).toBe(rec.id);
    expect(mine.state).toBe('tracked');
    // Insider abuse item 13: a clock photo is used once; the same picture again is refused.
    await expect(svc.staffClockOut(ae, { image: img, capturedAt: NOW, lat: null, lng: null, accuracyM: null, face: null })).rejects.toThrow(/already used/);
    const out = await svc.staffClockOut(ae, { image: img + 'Zg', capturedAt: NOW, lat: null, lng: null, accuracyM: null, face: null });
    expect(out.flags).toContain('NO_GPS');
    await expect(svc.staffPing(ae, { lat: 3, lng: 101, accuracyM: 10 })).rejects.toThrow(/only while/);
  });

  it('lets the company manager see only their staff, and central HR everyone, with the silent phone as Unknown', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const board = await svc.staffClockBoard(cm);
    expect(board.rows.every((r) => r.company.startsWith('Arrow Shield'))).toBe(true);
    expect(board.rows.find((r) => r.userId === 'u-cm-arsh')!.location).toBe('unknown');
    expect(board.rows.find((r) => r.userId === 'u-ae-arsh')!.location).toBe('away');
    const hr = await svc.staffClockBoard(await svc.user('u-pwvsb-hr'));
    expect(hr.rows.some((r) => r.userId === 'u-cm-sasa' && r.status === 'in')).toBe(true);
    expect(hr.rows.some((r) => r.company === 'PWVSB (central)')).toBe(true);
    await expect(svc.staffClockBoard(await svc.user('u-ae-arsh'))).rejects.toBeInstanceOf(AccessDenied);
    const sasaClock = hr.rows.find((r) => r.userId === 'u-cm-sasa')!.clock!;
    await expect(svc.staffClockDetail(cm, sasaClock.id)).rejects.toBeInstanceOf(AccessDenied);
    const d = await svc.staffClockDetail(await svc.user('u-cm-arsh'), hr.rows.find((r) => r.userId === 'u-cm-arsh')!.clock!.id);
    expect(d.gaps.length).toBe(1);
  });
});

describe('SOCSO claims (Fauzan, 26 Oct 2026)', () => {
  it('picks the case from the four questions and works out the deadlines and MC pay', () => {
    expect(socsoTriage({ onDuty: true, commuting: false, outsideWorkInMalaysia: false, illness: false }, 'MY').type).toBe('WORK_ACCIDENT');
    expect(socsoTriage({ onDuty: false, commuting: false, outsideWorkInMalaysia: false, illness: true }, 'NP').advice).toMatch(/RM200/);
    expect(socsoTriage({ onDuty: false, commuting: false, outsideWorkInMalaysia: false, illness: true, permanent: true }, 'MY').type).toBe('INVALIDITY');
    expect(socsoForm34Clock({ toldAt: myt(TODAY, '08:00'), reportedAt: null }, myt(addDays(TODAY, 1), '09:00')).state).toBe('reminder');
    expect(socsoForm34Clock({ toldAt: myt(TODAY, '08:00'), reportedAt: null }, myt(addDays(TODAY, 2), '09:00')).state).toBe('overdue');
    const mcs = [{ from: TODAY, to: addDays(TODAY, 1), docId: null }];
    expect(socsoPayrollTreatment({ mcs, status: 'REPORTED', decision: null }).treatment).toBe('sick_leave');
    const long = [{ from: TODAY, to: addDays(TODAY, 4), docId: null }];
    expect(socsoPayrollTreatment({ mcs: long, status: 'REPORTED', decision: null }).treatment).toBe('held');
    expect(socsoPayrollTreatment({ mcs: long, status: 'APPROVED', decision: { outcome: 'APPROVED', on: TODAY, note: 'ok', by: 'HR' } }).treatment).toBe(
      'perkeso',
    );
    expect(socsoDocItems('COMMUTING', 'NP').map((i) => i.id)).toEqual(expect.arrayContaining(['POLICE', 'SKETCH', 'ID']));
  });

  it('keeps a guard on injury MC or under a work restriction off the roster until HR clears it', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-cm-sasa');
    const seeded = ds.socsoClaims.find((x) => x.companyId === 'co-sasa')!;
    const d1 = seeded.mcs[0].from;
    const shiftOn = (date: string, start = '07:00', end = '19:00') => ({ date, start: myt(date, start), end: myt(date, end) });
    expect(socsoDutyFindings([seeded], shiftOn(d1), { armed: false }, false).map((f) => f.code)).toContain('ON_INJURY_MC');
    const after = addDays(seeded.mcs[0].to, 1);
    expect(socsoDutyFindings([seeded], shiftOn(after), { armed: false }, true).map((f) => f.code)).toEqual(['WORK_RESTRICTION']);
    expect(socsoDutyFindings([seeded], shiftOn(after), { armed: false }, false)).toEqual([]);
    // The officer's weekly check-in falls due while the guard is off.
    expect(socsoCheckIn(seeded, addDays(d1, 8))?.overdue).toBe(true);
    const sup = ds.users.find((u) => u.role === 'supervisor' && u.companyIds.includes('co-sasa') && !u.opsTier)!;
    await svc.addSocsoCheckIn(sup, seeded.id, 'Called him, ankle better, walking with support.');
    await expect(svc.addSocsoRestriction(sup, seeded.id, { kind: 'NO_DUTY', note: '', from: d1 })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.clearSocsoRestriction(hr, seeded.id, 'rs-seed-1', 'ok')).rejects.toThrow(/why/);
    const cleared = await svc.clearSocsoRestriction(hr, seeded.id, 'rs-seed-1', 'Fitness to work certificate from the panel clinic');
    expect(socsoDutyFindings([cleared], shiftOn(after), { armed: false }, true)).toEqual([]);
    await svc.addSocsoRestriction(hr, seeded.id, { kind: 'NO_NIGHT', note: 'Light duty', from: after });
    const v = await svc.socsoClaimDetail(hr, seeded.id);
    expect(v.rehab.restrictions.filter((r) => !r.clearedAt).map((r) => r.kind)).toEqual(['NO_NIGHT']);
    expect(v.rtwOffered).toBe(true);
    // Foreign workers: appliances only, no Return to Work referral.
    const np = ds.socsoClaims.find((x) => x.companyId === 'co-arsh')!;
    await expect(svc.setSocsoRehab(await svc.user('u-ae-arsh'), np.id, { rtwRequestedOn: TODAY })).rejects.toThrow(/appliances only/);
  });

  it('lets the officer start a claim without medical papers, HR run it to closed, and the guard only read it', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ae = await svc.user('u-ae-arsh');
    const guard = ds.people.find((p) => p.companyId === 'co-arsh' && p.role === 'guard' && p.nationality === 'MY')!;
    const input = {
      type: 'WORK_ACCIDENT' as const,
      incidentAt: myt(TODAY, '07:10'),
      toldAt: myt(TODAY, '07:30'),
      place: 'Car park',
      description: 'Struck by a reversing car while directing traffic at the gate.',
    };
    await expect(svc.startSocsoClaim(cm, guard.id, { ...input, description: 'hurt' })).rejects.toThrow(/Describe/);
    const c = await svc.startSocsoClaim(ae, guard.id, input);
    expect(c.status).toBe('DRAFT');
    await expect(svc.advanceSocsoClaim(ae, c.id, 'REPORTED', { perkesoRef: '' })).rejects.toThrow(/reference/);
    await svc.advanceSocsoClaim(ae, c.id, 'REPORTED', { perkesoRef: 'ASSIST-123456' });
    await expect(svc.advanceSocsoClaim(ae, c.id, 'DOCS_COMPLETE')).rejects.toThrow(/Still missing/);
    await expect(svc.addSocsoDoc(ae, c.id, 'MC', [proof()])).rejects.toThrow(/first and last day/);
    for (const item of ['FORM34', 'ID', 'INCIDENT', 'DOCTOR', 'BANK']) await svc.addSocsoDoc(ae, c.id, item, [proof()]);
    await svc.addSocsoDoc(ae, c.id, 'MC', [proof()], { from: TODAY, to: addDays(TODAY, 5) });
    await svc.advanceSocsoClaim(ae, c.id, 'DOCS_COMPLETE');
    await svc.advanceSocsoClaim(ae, c.id, 'UNDER_REVIEW');
    const held = await svc.socsoClaimDetail(ae, c.id);
    expect(held.payroll!.treatment).toBe('held');
    expect(held.form34.state).toBe('done');
    await svc.advanceSocsoClaim(ae, c.id, 'APPROVED', { note: 'Temporary disablement approved' });
    await expect(svc.advanceSocsoClaim(ae, c.id, 'CLOSED', {})).rejects.toThrow(/amount/);
    const closed = await svc.advanceSocsoClaim(ae, c.id, 'CLOSED', { amountPaid: 512.4, returnToWork: addDays(TODAY, 6) });
    expect(closed.status).toBe('CLOSED');
    expect(ds.audit.filter((a) => a.entityId === c.id).length).toBeGreaterThanOrEqual(10);

    // The Sasa officer may start a claim and add the incident report, but sees no medical papers or amounts.
    const seeded = ds.socsoClaims.find((x) => x.companyId === 'co-sasa')!;
    const sup = ds.users.find((u) => u.role === 'supervisor' && u.companyIds.includes('co-sasa') && !u.opsTier)!;
    const v = await svc.socsoClaimDetail(sup, seeded.id);
    expect(v.can.manage).toBe(false);
    expect(v.items.some((i) => i.medical)).toBe(false);
    expect(v.claim.mcs).toEqual([]);
    expect(v.payroll).toBeNull();
    expect(v.claim.history.some((h) => /certificate|\d{4}-\d{2}-\d{2} to /.test(h.what))).toBe(false);
    await expect(svc.startSocsoClaim(sup, seeded.personId, { ...input, incidentAt: `${TODAY}T07:10` })).rejects.toThrow(/when it happened/);
    await expect(svc.addSocsoDoc(sup, seeded.id, 'BANK', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    // The guard sees their own claim on their own view, read-only.
    const me = await svc.user('u-guard-sasa-1');
    const duty = await svc.myDuty(me);
    expect(duty.profile.socso.claims[0].perkesoRef).toBe('ASSIST-TEST-0001');
    expect(duty.profile.socso.canStart).toBe(false);
    await expect(svc.advanceSocsoClaim(me, seeded.id, 'DOCS_COMPLETE')).rejects.toBeInstanceOf(AccessDenied);
    // An opted-out Malaysian is not covered for an accident outside work.
    const out = ds.people.find((p) => p.lindungOptOut === true)!;
    await expect(
      svc.startSocsoClaim(await svc.user('u-cm-sasa'), out.id, { ...input, type: 'NON_WORK_ACCIDENT', description: 'Road accident on a rest day in Klang.' }),
    ).rejects.toThrow(/opted out of LINDUNG/);
  });
});

describe('Foreign Worker Management (Fauzan, 26 Oct 2026)', () => {
  it('runs the reminder ladder 120/90/60/30/15 days, CEO at 7, and pauses on a submitted renewal', () => {
    expect(fwStage(150, false).step).toBeNull();
    expect(fwStage(100, false)).toMatchObject({ step: 120, alerted: ['FWM'], urgent: false });
    expect(fwStage(45, false).alerted).toEqual(['FWM']);
    expect(fwStage(20, false)).toMatchObject({ step: 30, alerted: ['FWM', 'CHIEF_OF_STAFF'], priority: 'P2' });
    expect(fwStage(10, false)).toMatchObject({ step: 15, alerted: ['FWM', 'CHIEF_OF_STAFF', 'COO'], urgent: true, priority: 'P1' });
    expect(fwStage(7, false).alerted).toContain('CEO');
    expect(fwStage(8, false).alerted).not.toContain('CEO');
    expect(fwStage(-1, false)).toMatchObject({ step: 0, label: 'Expired' });
    expect(fwStage(5, true)).toMatchObject({ paused: true, alerted: ['FWM'], urgent: false });
    // A passport must have 12 months left at the PLKS renewal.
    expect(fwDeadline('PASSPORT', '2028-01-01') < '2027-01-05').toBe(true);
    const plan = fwServicePlan('2017-01-01', '2026-10-26');
    expect(plan).toMatchObject({ year: 10, finalYear: true });
    expect(plan.applyFrom > plan.leaveBy && plan.backFrom > plan.applyFrom).toBe(true);
  });

  it('keeps Nepali guards to private-sector sites', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const gov = ds.sites.find((x) => x.companyId === 'co-sasa' && x.sector === 'government')!;
    const shift = ds.shifts.find((x) => x.siteId === gov.id && x.date > addDays(TODAY, 1))!;
    const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard' && p.status === 'active')!;
    await expect(svc.assignShift(cm, shift.id, np.id)).rejects.toThrow(/private-sector/);
    expect(ds.shifts.some((x) => x.personId === np.id && ds.sites.find((y) => y.id === x.siteId)?.sector === 'government')).toBe(false);
  });

  it('lets FWM see foreign workers, HR local staff, and the company manager everyone in the company', async () => {
    const { svc, ds } = fresh();
    const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard')!;
    const my = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'MY' && p.role === 'guard')!;
    const office = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'office');
    const fwm = await svc.user('u-fwm-ex1');
    const hr = await svc.user('u-pwvsb-hr');
    const cm = await svc.user('u-cm-sasa');
    expect((await svc.guardProfile(fwm, np.id)).access.pay).toBe(true);
    await expect(svc.guardProfile(fwm, my.id)).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.guardProfile(hr, my.id)).access.pay).toBe(true);
    await expect(svc.guardProfile(hr, np.id)).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.guardProfile(cm, np.id)).access.pay).toBe(true);
    if (office) expect((await svc.guardProfile(cm, office.id)).access.pay).toBe(true);
    // The despatch runs errands; he does not open records.
    await expect(svc.guardProfile(await svc.user('u-fwm-desp'), np.id)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('sends a dated task to the OM, who reports it done with proof, and FWM accepts or sends it back', async () => {
    const { svc, ds } = fresh();
    const fwm = await svc.user('u-fwm-ex2');
    const board = await svc.fwmBoard(fwm);
    expect(board.canWork).toBe(true);
    expect(board.items.length).toBeGreaterThan(0);
    expect(board.counts.submitted).toBeGreaterThanOrEqual(ds.fwRenewals.length ? 1 : 0);
    const np = ds.people.find((p) => p.companyId === 'co-sasa' && p.nationality === 'NP' && p.role === 'guard')!;
    const t = await svc.createFwmTask(fwm, np.id, {
      kind: 'JIM',
      what: 'Bring passport to JIM for endorsement',
      place: 'JIM Shah Alam',
      dueOn: addDays(TODAY, 3),
    });
    // The task goes to the Operations Manager whose area holds the guard's branch.
    const om = await svc.user(t.omUserId!);
    expect(om.opsTier).toBe('om');
    expect(om.areaStates).toContain(ds.branches.find((b) => b.id === np.branchId)!.state);
    await expect(svc.createFwmTask(om, np.id, { kind: 'FOMEMA', what: 'Bring for FOMEMA', place: 'Klang', dueOn: TODAY })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.doneFwmTask(om, t.id, 'Done', [])).rejects.toThrow(/proof/);
    await svc.doneFwmTask(om, t.id, 'Endorsed', [proof()]);
    await expect(svc.reviewFwmTask(fwm, t.id, false, 'no')).rejects.toThrow(/why/);
    const back = await svc.reviewFwmTask(fwm, t.id, false, 'Slip is unreadable, scan again');
    expect(back.status).toBe('returned');
    await svc.doneFwmTask(om, t.id, 'Rescanned', [{ ...proof(), name: 'slip2.pdf', data: 'data:application/pdf;base64,' + btoa('%PDF-1.1 slip 2') }]);
    expect((await svc.reviewFwmTask(fwm, t.id, true, 'ok')).status).toBe('accepted');
    const omBoard = await svc.fwmBoard(om);
    expect(omBoard.items).toEqual([]);
    expect(omBoard.tasks.some((x) => x.task.id === t.id)).toBe(true);
    // The COO sees what reached the COO.
    const coo = await svc.fwmBoard(await svc.user('u-coo'));
    expect(coo.role).toBe('escalation');
    expect(coo.items.filter((i) => i.forMe).every((i) => i.stage?.alerted.includes('COO'))).toBe(true);
  });
});

describe('Group data for group leadership only (Fauzan, 26 Oct 2026)', () => {
  it('shows the group to the CEO, COO, Finance Director, CoS, Deputy CoS, Chairman and Vice Chairman, and others their own line', async () => {
    const { svc } = fresh();
    for (const id of ['u-fauzan', 'u-coo', 'u-fd', 'u-cos', 'u-dcos', 'u-chair', 'u-vchair']) {
      const u = await svc.user(id);
      expect(isGroupLeader(u)).toBe(true);
      expect(await svc.groupOverview(u)).toHaveLength(38);
    }
    for (const id of ['u-pwvsb-hr', 'u-fwm-mgr', 'u-pwvsb-doa', 'u-rom-central', 'u-om-klang', 'u-pwvsb-ops']) {
      const u = await svc.user(id);
      expect(isGroupLeader(u)).toBe(false);
      await expect(svc.groupOverview(u)).rejects.toBeInstanceOf(AccessDenied);
      await expect(svc.compliance(u)).rejects.toBeInstanceOf(AccessDenied);
    }
    // Their own line still works.
    const hr = await svc.user('u-pwvsb-hr');
    expect((await svc.hrMonitor(hr)).rows.length).toBeGreaterThan(0);
    expect((await svc.fwmBoard(await svc.user('u-fwm-mgr'))).canWork).toBe(true);
    const fwm = await svc.user('u-fwm-mgr');
    expect((await svc.people(fwm, 'co-sasa')).every((r) => r.person.nationality !== 'MY')).toBe(true);
    expect((await svc.people(hr, 'co-sasa')).every((r) => r.person.nationality === 'MY')).toBe(true);
    expect((await svc.socsoClaims(fwm)).rows).toHaveLength(0);
    await expect(svc.tenderBoard(fwm)).rejects.toThrow();
    // Company screens outside the line are refused at the server, not only hidden.
    await expect(svc.companyDashboard(hr, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.sites(fwm, 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.cases(await svc.user('u-pwvsb-doa'))).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.sites(await svc.user('u-rom-central'), 'co-sasa')).length).toBeGreaterThan(0);
    await expect(svc.insurance(await svc.user('u-pwvsb-hr'))).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.insurance(await svc.user('u-fd'))).alerts).toBeDefined();
    // The audit trail: leadership sees everything; others only what they did themselves.
    expect((await svc.auditLog(hr)).entries.every((e) => e.actor === hr.name)).toBe(true);
    expect((await svc.auditLog(await svc.user('u-chair'))).entries.length).toBeGreaterThan(0);
  });
});

describe('Company overview (Fauzan, 26 Oct 2026)', () => {
  it('shows the company total overview only to group leadership and the company manager and admin executives', async () => {
    const { svc } = fresh();
    for (const id of ['u-fd', 'u-fauzan', 'u-cm-sasa', 'u-gm-sasa'])
      expect((await svc.companyDashboard(await svc.user(id), 'co-sasa')).company.id).toBe('co-sasa');
    expect((await svc.companyDashboard(await svc.user('u-ae-arsh'), 'co-arsh')).company.id).toBe('co-arsh');
    for (const id of ['u-sv-sasa', 'u-om-klang', 'u-rom-central', 'u-pwvsb-doa'])
      await expect(svc.companyDashboard(await svc.user(id), 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
    // A company manager still sees only their own company.
    await expect(svc.companyDashboard(await svc.user('u-cm-arsh'), 'co-sasa')).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Hostel bills and utility excess (Fauzan, 26 Oct 2026)', () => {
  it('runs a hostel bill from the company through FWM, the Operations Director and the COO to the slip', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const fwm = await svc.user('u-fwm-ex1');
    const od = await svc.user('u-opsdir');
    const ogm = await svc.user('u-ogm');
    const coo = await svc.user('u-coo');
    const rent = ds.hostelBills.find((b) => b.kind === 'RENT' && b.status === 'due')!;
    // The company is reminded before the due date.
    expect((await svc.home(cm, 'co-sasa')).todo.some((i) => i.tag === 'Hostel bill' && /rent/.test(i.title))).toBe(true);
    await expect(svc.requestHostelPayment(fwm, rent.id, '')).rejects.toBeInstanceOf(AccessDenied);
    await svc.requestHostelPayment(cm, rent.id, 'Monthly rent');
    await expect(svc.approveHostelBill(od, rent.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.checkHostelBill(fwm, rent.id, false, '')).rejects.toThrow(/what is wrong/);
    await svc.checkHostelBill(fwm, rent.id, true, 'Matches the tenancy');
    // Private-sector hostel: the Operations Director approves, not the OGM.
    await expect(svc.approveHostelBill(ogm, rent.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.approveHostelBill(coo, rent.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.approveHostelBill(od, rent.id, true, 'ok');
    await expect(svc.uploadHostelSlip(cm, rent.id, '', [proof()])).rejects.toThrow(/COO approves/);
    await svc.approveHostelBill(coo, rent.id, true, 'ok');
    await expect(svc.uploadHostelSlip(cm, rent.id, '', [])).rejects.toThrow(/payment slip/);
    const paid = await svc.uploadHostelSlip(cm, rent.id, 'Online transfer', [proof()]);
    expect(paid.status).toBe('paid');
    // FWM keeps the approvals and the slip, by hostel and month.
    const board = await svc.hostelBoard(fwm);
    const row = board.hostels[0].bills.find((b) => b.bill.id === rent.id)!;
    expect([row.bill.request, row.bill.fwmCheck, row.bill.sectorApproval, row.bill.cooApproval, row.bill.slip].every(Boolean)).toBe(true);
    expect(board.hostels[0].history.length).toBe(6);
    // A guard supervisor or OM has no hostel screen.
    await expect(svc.hostelBoard(await svc.user('u-om-klang'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('works out the utility excess by bed-days and allows a deduction only from the 3rd time with the contract clause', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const fwm = await svc.user('u-fwm-ex1');
    const cm = await svc.user('u-cm-sasa');
    // A new electricity bill: 8 residents x RM30 = RM240 allowance for a full month.
    const month = addDays(TODAY, 40).slice(0, 7);
    const hostel = ds.hostels[0];
    for (const s of ds.hostelStays) s.to = null;
    const { charges } = await svc.addHostelBill(cm, { hostelId: hostel.id, kind: 'ELECTRICITY', period: month, amount: 280, dueOn: addDays(TODAY, 60) }, [
      proof(),
    ]);
    expect(charges).toHaveLength(8);
    expect(charges[0].excess).toBe(40);
    expect(charges[0].share).toBe(5);
    // The count never resets: the seed has 3 earlier excesses, so this is the 4th.
    expect(charges[0].count).toBe(4);
    const water = await svc.addHostelBill(cm, { hostelId: hostel.id, kind: 'WATER', period: month, amount: 150, dueOn: addDays(TODAY, 60) }, [proof()]);
    expect(water.charges).toHaveLength(0);
    // The seeded 3rd excess: deduction only where the clause is on file.
    const third = ds.utilityCharges.filter((c) => c.count === 3);
    const withClause = third.find((c) => ds.people.find((p) => p.id === c.personId)!.utilityClause)!;
    const without = third.find((c) => !ds.people.find((p) => p.id === c.personId)!.utilityClause)!;
    await expect(svc.decideUtilityCharge(fwm, withClause.id, 'DEDUCTION', '')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideUtilityCharge(hr, without.id, 'DEDUCTION', '')).rejects.toThrow(/no utility clause/);
    await svc.decideUtilityCharge(hr, without.id, 'NOTICE', 'Third notice');
    expect(ds.fwmTasks.some((t) => t.personId === without.personId && t.kind === 'UTILITY_CLAUSE' && t.status === 'open')).toBe(true);
    await svc.decideUtilityCharge(hr, withClause.id, 'DEDUCTION', '');
    // The deduction shows on the payslip workings with how it is worked out.
    const fauzan = await svc.user('u-fauzan');
    const profile = await svc.guardProfile(fauzan, withClause.personId);
    expect(profile.pay!.workings.some((w) => /electricity deduction/i.test(w.label) && w.amount === -withClause.share)).toBe(true);
    // A 1st or 2nd excess is a notice only, even with the clause.
    const second = charges.find((c) => c.personId === withClause.personId)!;
    ds.utilityCharges.find((c) => c.id === second.id)!.count = 2;
    await expect(svc.decideUtilityCharge(hr, second.id, 'DEDUCTION', '')).rejects.toThrow(/notices only/);
    // FWM files the clause; the task closes.
    await svc.fileUtilityPaper(fwm, without.personId, 'clause', [proof()]);
    expect(ds.fwmTasks.find((t) => t.personId === without.personId && t.kind === 'UTILITY_CLAUSE')!.status).toBe('accepted');
  });
});

describe('Staff claims (Fauzan, 26 Oct 2026)', () => {
  const img = 'data:image/jpeg;base64,' + btoa('test');
  it('caps medical with dental at RM1,000 a year, keeps the check-up separate, and refuses guards', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-inas');
    await expect(svc.submitStaffClaim(await svc.user('u-guard-sasa-1'), { kind: 'MEDICAL', date: TODAY, amount: 50 }, [proof()])).rejects.toThrow(
      /office and management staff/,
    );
    await expect(svc.submitStaffClaim(cm, { kind: 'MEDICAL', date: TODAY, amount: 50 }, [])).rejects.toThrow(/receipt/);
    await svc.submitStaffClaim(cm, { kind: 'MEDICAL', date: TODAY, amount: 700 }, [proof()]);
    const dental = await svc.submitStaffClaim(cm, { kind: 'DENTAL', date: TODAY, amount: 500 }, [proof()]);
    expect(dental.allowed).toBe(300);
    await expect(svc.submitStaffClaim(cm, { kind: 'MEDICAL', date: TODAY, amount: 20 }, [proof()])).rejects.toThrow(/used up/);
    const checkup = await svc.submitStaffClaim(cm, { kind: 'CHECKUP', date: TODAY, amount: 250 }, [proof()]);
    expect(checkup.allowed).toBe(250);
    const optical = await svc.submitStaffClaim(cm, { kind: 'OPTICAL', date: TODAY, amount: 650 }, [proof()]);
    expect(optical.allowed).toBe(500);
  });

  it('pays travel by the published rate, checks km against the location pings, and sends gaps to the Chief of Staff', async () => {
    const { store } = fresh();
    let clock = NOW;
    const svc = new PrimaService(store, () => clock);
    const cm = await svc.user('u-cm-inas');
    const cos = await svc.user('u-cos');
    const hr = await svc.user('u-pwvsb-hr');
    // The Chief of Staff publishes the month's rates and is reminded until then.
    expect((await svc.staffClaims(cos)).missingRates).toEqual(['CAR', 'MOTORCYCLE', 'COMPANY_CAR']);
    // The trip is approved by the Chief of Staff before it is made (insider abuse audit, 27 Oct 2026).
    const asked = await svc.requestTrip(cm, { date: TODAY, destination: 'Client site, Seremban', purpose: 'Quarterly client review' });
    await svc.decideTrip(cos, asked.id, true, 'ok');
    const trip = { destination: 'Client site, Seremban', tripId: asked.id, vehicle: 'CAR' as const, kmClaimed: 130, toll: 12, parking: 5 };
    await expect(svc.submitStaffClaim(cm, { kind: 'TRAVEL', date: TODAY, travel: trip }, [proof()])).rejects.toThrow(/not published/);
    await expect(svc.setClaimRate(hr, TODAY.slice(0, 7), 'CAR', 0.6)).rejects.toBeInstanceOf(AccessDenied);
    await svc.setClaimRate(cos, TODAY.slice(0, 7), 'CAR', 0.6);
    expect((await svc.staffClaims(cos)).missingRates).toEqual(['MOTORCYCLE', 'COMPANY_CAR']);
    await expect(svc.submitStaffClaim(cm, { kind: 'TRAVEL', date: TODAY, travel: { ...trip, valet: true } }, [proof()])).rejects.toThrow(/Valet/);
    // About 50 km out from the clock-in point: system km = 2 x 50 x 1.3 = about 130.
    await svc.staffClockIn(cm, { image: img, capturedAt: NOW, lat: 3.0568, lng: 101.5851, accuracyM: 8, face: null });
    clock = addMinutes(NOW, 90);
    await svc.staffPing(cm, { lat: 3.0568 - 0.4497, lng: 101.5851, accuracyM: 10 });
    const ok = await svc.submitStaffClaim(cm, { kind: 'TRAVEL', date: TODAY, travel: trip }, [proof()]);
    expect(ok.travel!.kmSystem).toBeCloseTo(130, 0);
    expect(ok.travel!.cosReasons).toEqual([]);
    expect(ok.travel!.food).toBe(0);
    expect(ok.allowed).toBe(Math.round((130 * 0.6 + 12 + 5) * 100) / 100);
    // Over 10% off and not pre-approved: the Chief of Staff first, then HR.
    const far = await svc.submitStaffClaim(cm, { kind: 'TRAVEL', date: TODAY, travel: { ...trip, destination: 'Port Dickson', tripId: null, kmClaimed: 200 } }, [proof()]);
    expect(far.travel!.cosReasons).toHaveLength(2);
    expect(far.travel!.food).toBe(25);
    await expect(svc.hrDecideClaim(hr, far.id, true, 'ok')).rejects.toThrow(/Chief of Staff/);
    await svc.cosDecideClaim(cos, far.id, true, 'Client visit agreed');
    // HR checks, then the COO approves every claim (Fauzan, 26 Oct 2026).
    const coo = await svc.user('u-coo');
    await expect(svc.cooDecideClaim(coo, far.id, true, '')).rejects.toThrow(/HR checks/);
    expect((await svc.hrDecideClaim(hr, far.id, true, 'HR checked travel evidence')).status).toBe('hr_checked');
    // The company head verifies too (Fauzan, 2 Nov 2026).
    await expect(svc.cooDecideClaim(await svc.user('u-coo'), far.id, true, '')).rejects.toThrow(/company head/);
    await svc.headVerifyClaim(await svc.user(far.headIds![0]), far.id, true, 'Client visit confirmed');
    await expect(svc.cooDecideClaim(hr, far.id, true, '')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.home(coo)).todo.some((i) => i.tag === 'Claims')).toBe(true);
    expect((await svc.staffClaims(coo)).queue.find((r) => r.claim.id === far.id)!.canCoo).toBe(true);
    expect((await svc.cooDecideClaim(coo, far.id, true, 'ok')).status).toBe('approved');
    // Overnight: RM50 a night instead of RM25, hotel capped at RM200 a night.
    const night = await svc.submitStaffClaim(
      cm,
      { kind: 'TRAVEL', date: TODAY, travel: { ...trip, destination: 'Melaka', tripId: null, kmClaimed: 130, overnightNights: 2, hotel: 500 } },
      [proof()],
    );
    expect(night.travel!.food).toBe(100);
    expect(night.travel!.hotel).toBe(400);
  });
});

describe('Chief of Staff reminders (Fauzan, 26 Oct 2026)', () => {
  it('reminds the Chief of Staff to publish the month mileage rates and shows trips to approve', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const home = await svc.home(cos);
    expect(home.todo[0].tag).toBe('Mileage rates');
    expect(home.todo.some((i) => i.tag === 'Travel claim')).toBe(true);
    for (const v of ['CAR', 'MOTORCYCLE', 'COMPANY_CAR'] as const) await svc.setClaimRate(cos, TODAY.slice(0, 7), v, 0.5);
    expect((await svc.home(cos)).todo.some((i) => i.tag === 'Mileage rates')).toBe(false);
  });

  it('lets only the Chief of Staff memo all staff and only the COO memo all guards and officers', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const dcos = await svc.user('u-dcos');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const hr = await svc.user('u-pwvsb-hr');
    const guard = await svc.user('u-guard-sasa-1');
    await expect(svc.publishMemo(dcos, 'STAFF', 'Test memo', 'Body text')).rejects.toThrow(/Only the Chief of Staff/);
    await expect(svc.publishMemo(cos, 'FIELD', 'Test memo', 'Body text')).rejects.toThrow(/Only the COO/);
    // P78: the owner (the CEO record) is master administrator and may publish to either audience.
    expect((await svc.memos(ceo)).canPublish).toEqual(expect.arrayContaining(['STAFF', 'FIELD']));
    await expect(svc.publishMemo(hr, 'FIELD', 'Test memo', 'Body text')).rejects.toThrow(/Only the COO/);
    const staffMemo = await svc.publishMemo(cos, 'STAFF', 'Claims cut-off', 'Submit by the 25th.');
    const fieldMemo = await svc.publishMemo(coo, 'FIELD', 'Inspection', 'Uniform check this week.');
    // Staff see staff memos only; guards see field memos only.
    const hrView = await svc.memos(hr);
    expect(hrView.memos.some((m) => m.id === staffMemo.id)).toBe(true);
    expect(hrView.memos.some((m) => m.id === fieldMemo.id)).toBe(false);
    expect(hrView.canPublish).not.toContain('STAFF');
    const gView = await svc.memos(guard);
    expect(gView.memos.some((m) => m.id === fieldMemo.id)).toBe(true);
    expect(gView.memos.some((m) => m.audience === 'STAFF')).toBe(false);
    const unread = gView.unread;
    await svc.readMemo(guard, fieldMemo.id);
    expect((await svc.memos(guard)).unread).toBe(unread - 1);
    await expect(svc.readMemo(guard, staffMemo.id)).rejects.toThrow(/not found/);
    // The COO sees who read it; the CEO sees every memo.
    expect((await svc.memos(coo)).memos.find((m) => m.id === fieldMemo.id)!.reads.map((r) => r.userId)).toEqual(['u-guard-sasa-1']);
    expect((await svc.memos(ceo)).memos.filter((m) => [staffMemo.id, fieldMemo.id].includes(m.id))).toHaveLength(2);
  });

  it('runs PDPA through the PDPA officer: 72-hour and 7-day breach notices, client consent, monitored by the Operations Director', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-pdpa');
    const opsdir = await svc.user('u-opsdir');
    const ceo = await svc.user('u-fauzan');
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.pdpaBoard(hr)).rejects.toBeInstanceOf(AccessDenied);
    const mon = await svc.pdpaBoard(opsdir);
    expect(mon.role).toBe('monitor');
    // The seeded breach was found 52 hours ago: 20 hours left to tell the Commissioner.
    const seeded = mon.cases.find((c) => c.id === 'pdpa-seed-breach-1')!;
    expect(seeded.clock!.hoursLeft).toBe(20);
    expect(seeded.clock!.commissionerLate).toBe(false);
    await expect(svc.pdpaStep(opsdir, seeded.id, 'note', 'x')).rejects.toBeInstanceOf(AccessDenied);
    // A breach found 80 hours ago is already late for the Commissioner and shows on the CEO's Monitor.
    const late = await svc.openPdpaCase(officer, {
      kind: 'BREACH',
      companyId: 'co-sasa',
      title: 'Lost phone with guard files',
      detail: 'Admin phone lost.',
      detectedAt: addMinutes(NOW, -80 * 60),
      affected: 40,
      significantHarm: true,
    });
    expect((await svc.pdpaBoard(officer)).counts.late).toBe(1);
    expect((await svc.home(ceo)).watch!.some((i) => i.tag === 'PDPA breach')).toBe(true);
    await expect(svc.pdpaStep(officer, late.id, 'close', 'Done')).rejects.toThrow(/Commissioner/);
    await expect(svc.pdpaStep(officer, late.id, 'commissioner', 'Form sent')).rejects.toThrow(/Attach the proof/);
    await svc.pdpaStep(officer, late.id, 'commissioner', 'Form sent', [proof()]);
    const after = (await svc.pdpaBoard(officer)).cases.find((c) => c.id === late.id)!;
    expect(after.clock!.commissionerLate).toBe(true);
    expect(after.clock!.subjectsDue).toBe('2026-11-02');
    await expect(svc.pdpaStep(officer, late.id, 'close', 'Done')).rejects.toThrow(/affected people/);
    await svc.pdpaStep(officer, late.id, 'subjects', 'Letters sent', [proof()]);
    // The breach register needs the data involved and the cause before closing (PDPA-BREACH-REGISTER, 5 Nov 2026).
    await expect(svc.pdpaStep(officer, late.id, 'close', 'Phone wiped remotely; access reset.')).rejects.toThrow(/breach register details/);
    await svc.pdpaBreachDetails(officer, late.id, { dataKinds: 'Guard files: names, IC numbers', cause: 'Admin phone lost', remedy: 'Remote wipe' });
    await svc.pdpaStep(officer, late.id, 'close', 'Phone wiped remotely; access reset.');
    expect((await svc.pdpaDocs(officer, late.id)).length).toBe(2);
    // Client consent: advise first, then the signed consent.
    const cc = await svc.openPdpaCase(officer, {
      kind: 'CLIENT_CONSENT',
      companyId: 'co-inas',
      title: 'CCTV at the gate',
      detail: '',
      client: 'Mock client',
      product: 'CCTV',
    });
    await expect(svc.pdpaStep(officer, cc.id, 'consent_given', 'Signed', [proof()])).rejects.toThrow(/Advise the client first/);
    await svc.pdpaStep(officer, cc.id, 'advised', 'Explained notices and retention');
    const given = await svc.pdpaStep(officer, cc.id, 'consent_given', 'Signed', [proof()]);
    expect(given.consent!.decision).toBe('given');
  });

  it('sends a memo only to the states it names, so a Penang memo reaches people based in Penang', async () => {
    const { svc, ds } = fresh();
    const coo = await svc.user('u-coo');
    const penangOfficer = ds.users.find((u) => u.opsTier === 'patrol' && u.title.includes('(Pulau Pinang)'))!;
    const guard = await svc.user('u-guard-sasa-1');
    expect(penangOfficer).toBeTruthy();
    await expect(svc.publishMemo(coo, 'FIELD', 'Penang', 'Body text', ['Penang City'])).rejects.toThrow(/states from the list/);
    const m = await svc.publishMemo(coo, 'FIELD', 'Penang flood route', 'Use the inland road to the bridge sites.', ['Pulau Pinang']);
    expect((await svc.memos(await svc.user(penangOfficer.id))).memos.find((x) => x.id === m.id)?.forMe).toBe(true);
    expect((await svc.memos(guard)).memos.some((x) => x.id === m.id)).toBe(false);
    await expect(svc.readMemo(guard, m.id)).rejects.toThrow(/not found/);
    await svc.readMemo(await svc.user(penangOfficer.id), m.id);
    expect((await svc.memos(coo)).memos.find((x) => x.id === m.id)!.readCount).toBe(1);
  });

  it('runs the fleet: Transport head reminders, staff requests, in-and-out log, CMS sees unknown devices, PDPA consent before monitored driving', async () => {
    const { svc } = fresh();
    const head = await svc.user('u-transport');
    const cms = await svc.user('u-cms-head');
    const pdpa = await svc.user('u-pdpa');
    const cm = await svc.user('u-cm-inas');
    const guard = await svc.user('u-guard-sasa-1');
    await expect(svc.fleetBoard(guard)).rejects.toBeInstanceOf(AccessDenied);
    const b = await svc.fleetBoard(head);
    const sasa = b.board.find((v) => v.id === 'veh-sasa-1')!;
    expect(sasa.reminders!.map((r) => r.what)).toEqual(expect.arrayContaining(['Road tax due', 'Insurance due']));
    expect(sasa.reminders!.some((r) => r.what.includes('instalment'))).toBe(true);
    expect(b.reminders.some((r) => r.plate === 'PKM 5678' && r.what === 'Insurance expired' && r.tone === 'crit')).toBe(true);
    expect(b.reminders.some((r) => r.plate === 'BNH 902' && r.what.startsWith('Service due') && r.tone === 'crit')).toBe(true);
    // CMS sees devices only; never-connected or silent devices are unknown, not fine.
    const c = await svc.fleetBoard(cms);
    const cs = c.board.find((v) => v.id === 'veh-sasa-1')!;
    expect(cs.tracker).toBe('live');
    expect(cs.dashcam).toBe('unknown');
    expect(cs.reminders).toBeUndefined();
    expect(c.board.find((v) => v.id === 'veh-arsh-1')!.tracker).toBe('unknown');
    // The request waits; the CM needs consent filed before driving the monitored patrol car.
    const rq = b.requests.find((r) => r.id === 'vr-seed-1')!;
    await expect(svc.decideVehicleRequest(cm, rq.id, true, 'veh-sasa-1', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.decideVehicleRequest(head, rq.id, true, 'veh-sasa-1', 'ok');
    await expect(svc.vehicleOut(head, 'veh-sasa-1', rq.id, 84_250)).rejects.toThrow(/PDPA officer must file/);
    const need = (await svc.fleetBoard(pdpa)).consentNeeded;
    expect(need.map((n) => n.name)).toContain(cm.name);
    await svc.fileMonitoringConsent(pdpa, need.find((n) => n.name === cm.name)!.personId, [proof()]);
    await expect(svc.vehicleOut(head, 'veh-sasa-1', rq.id, 84_000)).rejects.toThrow(/odometer/);
    await svc.vehicleOut(head, 'veh-sasa-1', rq.id, 84_250);
    expect((await svc.fleetBoard(cm)).mine.find((r) => r.id === rq.id)!.status).toBe('out');
    const back = await svc.vehicleIn(head, 'veh-sasa-1', 84_390, 'Clean');
    expect(back.odometerKm).toBe(84_390);
    expect(back.log.at(-1)!.what).toContain('140 km');
    // Paying the instalment and renewing the road tax clears those reminders.
    await expect(svc.recordVehicleWork(head, 'veh-sasa-1', { kind: 'PAYMENT' }, [])).rejects.toThrow(/receipt/);
    await svc.recordVehicleWork(head, 'veh-sasa-1', { kind: 'PAYMENT' }, [proof()]);
    await svc.recordVehicleWork(head, 'veh-sasa-1', { kind: 'RENEWAL', renewal: 'ROAD_TAX', nextDue: '2027-10-26' }, [proof()]);
    const after = (await svc.fleetBoard(head)).board.find((v) => v.id === 'veh-sasa-1')!;
    expect(after.reminders!.map((r) => r.what)).toEqual(['Insurance due']);
    // Staff ask for a vehicle; a clash with an approved booking is refused.
    const mine = await svc.requestVehicle(cm, { purpose: 'Tender submission', from: addMinutes(NOW, 60 * 21), to: addMinutes(NOW, 60 * 22) });
    await expect(svc.decideVehicleRequest(head, mine.id, true, 'veh-pwvsb-1', 'ok')).resolves.toBeTruthy();
    const other = await svc.requestVehicle(cm, { purpose: 'Bank', from: addMinutes(NOW, 60 * 21.5), to: addMinutes(NOW, 60 * 23) });
    await expect(svc.decideVehicleRequest(head, other.id, true, 'veh-pwvsb-1', 'ok')).rejects.toThrow(/already booked/);
  });

  it('keeps products with personal data and MySTI, SIRIM and MCMC certificates, and checks a proposal is ready before it goes out', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-pdpa');
    const opsdir = await svc.user('u-opsdir');
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.productBoard(hr)).rejects.toBeInstanceOf(AccessDenied);
    const b = await svc.productBoard(opsdir);
    expect(b.role).toBe('monitor');
    // The tracker's MCMC certificate expires in 20 days: urgent on the officer's list.
    expect(b.certsDue.some((d) => d.productId === 'prod-tour' && d.cert.state === 'urgent')).toBe(true);
    // CCTV is ready (with client consent to arrange); the body camera has no MCMC certificate; the kiosk has no retention period.
    const r = await svc.proposalReadiness(opsdir, ['prod-cctv', 'prod-bodycam', 'prod-visitor']);
    expect(r.ready).toBe(false);
    expect(r.products.find((p) => p.id === 'prod-cctv')!.ready).toBe(true);
    expect(r.products.find((p) => p.id === 'prod-cctv')!.actions.join(' ')).toMatch(/client must agree/);
    expect(r.products.find((p) => p.id === 'prod-bodycam')!.blockers.join(' ')).toMatch(/MCMC certificate not obtained/);
    expect(r.products.find((p) => p.id === 'prod-visitor')!.blockers.join(' ')).toMatch(/kept is not set/);
    expect((await svc.proposalReadiness(opsdir, ['prod-tour'])).ready).toBe(false);
    // Only the officer edits; a valid certificate needs the certificate attached.
    await expect(
      svc.saveProductCert(opsdir, 'prod-bodycam', {
        certId: 'c4',
        body: 'MCMC',
        scheme: '',
        ref: 'X',
        status: 'valid',
        expiresOn: '2028-01-01',
        procedure: '',
      }),
    ).rejects.toBeInstanceOf(AccessDenied);
    await expect(
      svc.saveProductCert(officer, 'prod-bodycam', {
        certId: 'c4',
        body: 'MCMC',
        scheme: '',
        ref: 'X',
        status: 'valid',
        expiresOn: '2028-01-01',
        procedure: '',
      }),
    ).rejects.toThrow(/Attach the certificate/);
    await svc.saveProductCert(
      officer,
      'prod-bodycam',
      { certId: 'c4', body: 'MCMC', scheme: 'via SIRIM QAS', ref: 'RAXX/12', status: 'valid', expiresOn: '2028-01-01', procedure: 'Renew via SIRIM QAS' },
      [proof()],
    );
    const p = await svc.productBoard(officer);
    const kiosk = p.products.find((x) => x.id === 'prod-visitor')!;
    await svc.saveProduct(officer, { ...kiosk, retentionDays: 60 });
    expect((await svc.proposalReadiness(opsdir, ['prod-cctv', 'prod-bodycam', 'prod-visitor'])).ready).toBe(true);
    const added = await svc.saveProduct(officer, {
      name: 'Alarm panel',
      category: 'Alarm',
      mode: 'SALE',
      supplier: 'X',
      personalData: [],
      retentionDays: null,
      clientConsent: false,
      notes: '',
    });
    expect((await svc.proposalReadiness(opsdir, [added.id])).ready).toBe(true);
  });

  it('gives the COO and company managers a client board, with Operations Managers and officers acting and the monthly operations meetings tracked', async () => {
    const { svc } = fresh();
    const coo = await svc.user('u-coo');
    const om = await svc.user('u-om-klang');
    const cm = await svc.user('u-cm-inas');
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.clientBoard(hr)).rejects.toBeInstanceOf(AccessDenied);
    const b = await svc.clientBoard(coo);
    expect(b.role).toBe('monitor');
    expect(b.byCompany.map((c) => c.companyId).sort()).toEqual(['co-arsh', 'co-inas', 'co-sasa']);
    expect(b.opsMeetings.find((m) => m.companyId === 'co-sasa')!.state).toBe('held');
    expect(b.opsMeetings.find((m) => m.companyId === 'co-inas')!.state).toBe('none');
    const home = await svc.home(coo);
    expect(home.todo.some((i) => i.tag === 'Operations meeting')).toBe(true);
    // Unknown is never fine: no billing on record shows as unknown, not ok.
    const noBill = b.accounts.find((a) => !a.billing && a.stage === 'active')!;
    expect(noBill.issues.some((i) => i.tone === 'unknown' && /Billing not known/.test(i.what))).toBe(true);
    expect(noBill.tone).not.toBe('ok');
    // The Inas manager sees only Inas clients and cannot act; the OM acts.
    const mine = await svc.clientBoard(cm);
    expect(new Set(mine.accounts.map((a) => a.companyId))).toEqual(new Set(['co-inas']));
    const acct = (await svc.clientBoard(om)).accounts.find((a) => a.stage === 'onboarding')!;
    expect(acct).toBeTruthy();
    await expect(svc.clientContact(cm, acct.id, 'visit', 'Met the PIC')).rejects.toBeInstanceOf(AccessDenied);
    for (const s of acct.onboarding.filter((x) => !x.doneAt)) await svc.clientStep(om, acct.id, 'onboarding', s.key, 'Done', [proof()]);
    expect((await svc.clientBoard(om)).accounts.find((a) => a.id === acct.id)!.stage).toBe('active');
    await expect(svc.clientRating(om, acct.id, 2, '', { from: 'Synthetic PIC', via: 'meeting' })).rejects.toThrow(/unhappy/);
    await svc.clientRating(om, acct.id, 2, 'Late shift change', { from: 'Synthetic PIC', via: 'meeting' });
    expect((await svc.clientBoard(coo)).accounts.find((a) => a.id === acct.id)!.issues.some((i) => /Unhappy client/.test(i.what))).toBe(true);
    // Offboarding: the notice needs the paper; all steps done ends the account.
    await svc.startOffboarding(om, acct.id, 'Contract not renewed');
    await expect(svc.clientStep(om, acct.id, 'offboarding', 'notice', '')).rejects.toThrow(/Attach the signed paper/);
    for (const k of ['notice', 'handover', 'equipment', 'redeploy', 'final_bill']) await svc.clientStep(om, acct.id, 'offboarding', k, 'Done', [proof()]);
    expect((await svc.clientBoard(coo)).accounts.find((a) => a.id === acct.id)!.stage).toBe('ended');
    // Invoices are recorded with proof by the 10th; a missing one is flagged (Fauzan, 26 Oct 2026).
    // Every invoice goes by hand and by email, plus the client's system when needed, each with proof.
    const noInv = (await svc.clientBoard(cm)).accounts.find(
      (a) => a.stage === 'active' && !a.invoicePortal && a.issues.some((i) => /invoice not sent by hand, by email/.test(i.what)),
    )!;
    expect(noInv).toBeTruthy();
    await expect(svc.clientInvoice(cm, noInv.id, '2026-09', 'email', 12000, [])).rejects.toThrow(/Attach proof/);
    await expect(svc.clientInvoice(cm, noInv.id, '2026-10', 'email', 12000, [proof()])).rejects.toThrow(/finished month/);
    await expect(svc.clientInvoice(cm, noInv.id, '2026-09', 'portal', 12000, [proof()])).rejects.toThrow(/no invoicing system/);
    await svc.clientInvoice(cm, noInv.id, '2026-09', 'email', 12000, [proof()]);
    const half = (await svc.clientBoard(cm)).accounts.find((a) => a.id === noInv.id)!;
    expect(half.issues.find((i) => /invoice/.test(i.what))!.what).toMatch(/not sent by hand \(/);
    await svc.setInvoicePortal(cm, noInv.id, 'ePerolehan');
    await svc.clientInvoice(cm, noInv.id, '2026-09', 'hand', null, [proof()]);
    expect((await svc.clientBoard(cm)).accounts.find((a) => a.id === noInv.id)!.issues.find((i) => /invoice/.test(i.what))!.what).toMatch(/in ePerolehan/);
    await svc.clientInvoice(cm, noInv.id, '2026-09', 'portal', null, [proof()]);
    expect((await svc.clientBoard(cm)).accounts.find((a) => a.id === noInv.id)!.issues.some((i) => /invoice/.test(i.what))).toBe(false);
    // The client's signed acknowledgement of the month's work, with their comment, by the 10th (Fauzan, 4 Nov 2026).
    const ackDue = (id: string) => svc.clientBoard(cm).then((b) => b.accounts.find((a) => a.id === id)!.issues.filter((i) => /acknowledgement and comment/.test(i.what)));
    expect((await ackDue(noInv.id)).map((i) => i.what)).toEqual(["2026-09 client's signed acknowledgement and comment on the work not uploaded (due by the 10th)"]);
    const wa = { period: '2026-09', signedOn: '2026-10-03', signer: 'Synthetic school head', outcome: 'satisfied' as const, comment: 'Good work', action: '', proof: [proof()] };
    await expect(svc.clientWorkAck(cm, noInv.id, { ...wa, comment: '' })).rejects.toThrow(/comment/);
    await expect(svc.clientWorkAck(cm, noInv.id, { ...wa, proof: [] })).rejects.toThrow(/signed acknowledgement/);
    await expect(svc.clientWorkAck(cm, noInv.id, { ...wa, period: '2026-10' })).rejects.toThrow(/finished month/);
    await expect(svc.clientWorkAck(cm, noInv.id, { ...wa, outcome: 'complaints', comment: 'Grass edges left' })).rejects.toThrow(/done about the complaint/);
    await svc.clientWorkAck(cm, noInv.id, { ...wa, outcome: 'complaints', comment: 'Grass edges left', action: 'Redo edges by 6 Nov' });
    expect(await ackDue(noInv.id)).toEqual([]);
    expect((await svc.clientBoard(cm)).accounts.find((a) => a.id === noInv.id)!.issues.some((i) => /complained about the work: Grass edges left/.test(i.what))).toBe(true);
    await expect(svc.clientWorkAck(cm, noInv.id, wa)).rejects.toThrow(/already recorded/);
    // Billing can be recorded by the company manager of that company.
    const inas = mine.accounts.find((a) => a.stage === 'active')!;
    await svc.clientBilling(cm, inas.id, { invoicedTo: '2026-09', overdueAmount: 0, overdueDays: 0 });
  });

  it('routes operation claims OM to COO, and office needs company manager to Chief of Staff to COO', async () => {
    const { svc } = fresh();
    const om = await svc.user('u-om-klang');
    const cm = await svc.user('u-cm-sasa');
    const cos = await svc.user('u-cos');
    const dcos = await svc.user('u-dcos');
    const coo = await svc.user('u-coo');
    // The OM's monthly claim goes straight to the COO.
    const claim = await svc.saveExpense(om, { kind: 'OPS_CLAIM', companyId: 'co-sasa', period: '2026-08', lines: [{ item: 'Fuel', amount: 100 }] });
    await expect(svc.submitExpense(om, claim.id)).rejects.toThrow(/Attach/);
    await svc.saveExpense(
      om,
      {
        id: claim.id,
        kind: 'OPS_CLAIM',
        companyId: 'co-sasa',
        period: '2026-08',
        lines: [
          { item: 'Fuel', amount: 100 },
          { item: 'Toll', amount: 20 },
        ],
      },
      [proof()],
    );
    await svc.submitExpense(om, claim.id);
    await expect(svc.decideExpense(cos, claim.id, 'approve', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.home(coo)).todo.some((i) => i.tag === 'Requests')).toBe(true);
    await svc.decideExpense(coo, claim.id, 'return', 'Split the toll by site');
    await expect(svc.decideExpense(coo, claim.id, 'approve', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.submitExpense(om, claim.id);
    // Every approval carries a reason (Fauzan, 31 Oct 2026).
    await expect(svc.decideExpense(coo, claim.id, 'approve', '  ')).rejects.toThrow(/reason/);
    expect((await svc.decideExpense(coo, claim.id, 'approve', 'Receipts match')).status).toBe('approved');
    await expect(svc.saveExpense(cm, { kind: 'OPS_CLAIM', companyId: 'co-sasa', period: '2026-08', lines: [{ item: 'X', amount: 1 }] })).rejects.toBeInstanceOf(
      AccessDenied,
    );
    // Office supplies: confirm not IT or assets; CoS approves, then the COO.
    await expect(
      svc.saveExpense(cm, { kind: 'OFFICE', companyId: 'co-sasa', period: '2026-10', category: 'SUPPLIES', lines: [{ item: 'Pens', amount: 30 }] }),
    ).rejects.toThrow(/not IT or asset/);
    const off = await svc.saveExpense(
      cm,
      { kind: 'OFFICE', companyId: 'co-sasa', period: '2026-10', category: 'SUPPLIES', notAsset: true, lines: [{ item: 'Pens', amount: 30 }] },
      [proof()],
    );
    await svc.submitExpense(cm, off.id);
    await expect(svc.decideExpense(coo, off.id, 'approve', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideExpense(dcos, off.id, 'approve', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.home(cos)).todo.some((i) => i.tag === 'Office request')).toBe(true);
    await expect(svc.decideExpense(cos, off.id, 'approve', '')).rejects.toThrow(/reason/);
    expect((await svc.decideExpense(cos, off.id, 'approve', 'Needed for the office')).status).toBe('cos_approved');
    expect((await svc.decideExpense(coo, off.id, 'approve', 'OK')).status).toBe('approved');
    // Rent needs no asset confirmation.
    const rent = await svc.saveExpense(
      cm,
      { kind: 'OFFICE', companyId: 'co-sasa', period: '2026-11', category: 'RENT', lines: [{ item: 'Office rent', amount: 3500 }] },
      [proof()],
    );
    expect(rent.total).toBe(3500);
    expect((await svc.expenseBoard(cm)).requests.some((r) => r.id === rent.id && r.canEdit)).toBe(true);
  });
});

describe('JA Group app feed (Fauzan, 26 Oct 2026)', () => {
  it('shows JA data read-only by role, flags late payroll and treats a silent feed as unknown', async () => {
    const { svc } = fresh();
    const ceo = await svc.jaBoard(await svc.user('u-fauzan'));
    expect(ceo.datasets.sort()).toEqual(['guard', 'incident', 'payroll', 'worker']);
    expect(ceo.payroll.some((p) => p.companyId === 'co-arsh' && p.late)).toBe(true);
    const inas = ceo.feeds.find((f) => f.dataset === 'worker')!.companies.find((c) => c.companyId === 'co-inas')!;
    expect(inas.state).toBe('stale');
    expect(ceo.papers.filter((p) => p.companyId === 'co-inas').every((p) => p.stale)).toBe(true);
    expect(ceo.syncs.length).toBeGreaterThan(0);
    // A company manager sees only their own company and no feed log; FWM sees workers only; a guard sees nothing.
    const cm = await svc.jaBoard(await svc.user('u-cm-sasa'));
    expect(new Set(cm.payroll.map((p) => p.companyId))).toEqual(new Set(['co-sasa']));
    expect(cm.syncs).toEqual([]);
    expect((await svc.jaBoard(await svc.user('u-fwm-mgr'))).datasets).toEqual(['worker']);
    await expect(svc.jaBoard(await svc.user('u-guard-sasa-1'))).rejects.toBeInstanceOf(AccessDenied);
    // The CEO's home carries the JA watch lines once the JA app owns those areas, and not before.
    const before = await svc.home(await svc.user('u-fauzan'));
    expect(before.watch!.some((w) => w.tag === 'Payroll')).toBe(false);
    const home = await withJaOwns(['payroll', 'fwm', 'incidents'], async () => svc.home(await svc.user('u-fauzan')));
    expect(home.watch!.some((w) => w.tag === 'Payroll')).toBe(true);
    expect(home.watch!.some((w) => w.tag === 'JA app feed')).toBe(true);
  });

  it('takes records only from the feed, keeps the newest and lists every refusal', async () => {
    const { svc, store } = fresh();
    const feed = await svc.user('u-ja-sync');
    expect((await svc.users()).some((u) => u.id === 'u-ja-sync')).toBe(false);
    await expect(svc.jaIngest(await svc.user('u-fauzan'), 'incident', [])).rejects.toBeInstanceOf(AccessDenied);
    const inc = {
      company: 'SASA',
      externalId: 'INC-T-1',
      updatedAt: '2026-10-26T10:00:00+08:00',
      occurredAt: '2026-10-26T09:50:00+08:00',
      category: 'Trespass',
      severity: 'P1',
      status: 'open',
      summary: 'Test',
    };
    const sasa = (await store.list('companies', {})).find((c) => c.id === 'co-sasa')!;
    inc.company = sasa.code;
    const r1 = await svc.jaIngest(feed, 'incident', [
      inc,
      { ...inc, externalId: 'INC-T-2', severity: 'P9' },
      { ...inc, externalId: 'INC-T-3', company: 'NOPE' },
    ]);
    expect(r1.accepted).toBe(1);
    expect(r1.rejected.map((x) => x.externalId)).toEqual(['INC-T-2', 'INC-T-3']);
    // An older copy does not overwrite; a newer one does; sending twice changes nothing.
    await svc.jaIngest(feed, 'incident', [{ ...inc, updatedAt: '2026-10-26T09:00:00+08:00', status: 'closed' }]);
    let row = await store.get('jaRecords', `ja:incident:co-sasa:INC-T-1`);
    expect(row!.incident!.status).toBe('open');
    await svc.jaIngest(feed, 'incident', [{ ...inc, updatedAt: '2026-10-26T10:20:00+08:00', status: 'closed' }]);
    await svc.jaIngest(feed, 'incident', [{ ...inc, updatedAt: '2026-10-26T10:20:00+08:00', status: 'closed' }]);
    row = await store.get('jaRecords', `ja:incident:co-sasa:INC-T-1`);
    expect(row!.incident!.status).toBe('closed');
  });

  it('keeps Prima screens on until the JA feed is live, then switches each area off', async () => {
    const { svc } = fresh();
    expect(RULES.jaGroupApp.value.owns).toEqual([]);
    expect(jaOwns('incidents')).toBe(false);
    const me = await svc.user('u-guard-sasa-1');
    expect((await svc.guardProfile(me, me.personId!)).pay).not.toBeNull();
    await withJaOwns(['payroll', 'incidents', 'hostels'], async () => {
      expect((await svc.guardProfile(me, me.personId!)).pay).toBeNull();
      await expect(
        svc.raiseCase(await svc.user('u-cm-sasa'), {
          companyId: 'co-sasa',
          siteId: null,
          type: 'INCIDENT',
          severity: 'P3',
          title: 'x',
          description: '',
          proof: [],
        }),
      ).rejects.toThrow(/JA Group app/);
      await expect(svc.hostelBoard(await svc.user('u-fauzan'))).rejects.toBeInstanceOf(AccessDenied);
    });
  });
});

describe('Asset Management (Fauzan, 26 Oct 2026)', () => {
  it('shows the 450 units, rent, assets and properties only to the asset team, group leadership and finance', async () => {
    const { svc } = fresh();
    const b = await svc.amBoard(await svc.user('u-fauzan'));
    expect(b.kpis.units).toBe(450);
    expect(b.byType.map((t) => t.units)).toEqual([180, 150, 80, 40]);
    expect(b.properties.filter((p) => p.kind === 'RESORT').length).toBe(2);
    expect(b.properties.filter((p) => p.kind === 'ORCHARD').length).toBe(6);
    expect(b.properties.filter((p) => p.kind === 'TRAINING').length).toBe(1);
    // The group office and state branches rent and pay like any tenant.
    expect(b.internal.some((u) => u.tenant === 'PWVSB group office')).toBe(true);
    expect(b.arrears.every((a) => a.owed > 0)).toBe(true);
    expect(b.monthly.length).toBe(6);
    for (const id of ['u-asset-dir', 'u-finance-am', 'u-coo', 'u-cos']) expect((await svc.amBoard(await svc.user(id))).kpis.units).toBe(450);
    for (const id of ['u-cm-sasa', 'u-ae-arsh', 'u-pwvsb-doa', 'u-pwvsb-hr', 'u-fwm-mgr', 'u-guard-sasa-1'])
      await expect(svc.amBoard(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Staff payroll (Fauzan, 27 Oct 2026)', () => {
  it('calculates the configured statutory-settings preview without silently applying review-only tables', () => {
    expect(epfShare(3000, 35, 'MY')).toMatchObject({ ee: 330, er: 390 });
    // RM20 bands up to RM5,000: RM3,010 is worked on RM3,020 and rounded up to the ringgit.
    expect(epfShare(3010, 35, 'MY')).toMatchObject({ ee: 333, er: 393 });
    expect(epfShare(6500, 35, 'MY')).toMatchObject({ ee: 715, er: 780 });
    expect(epfShare(3000, 61, 'MY')).toMatchObject({ ee: 0, er: 120 });
    expect(epfShare(3000, 35, 'NP')).toMatchObject({ ee: 60, er: 60 });
    // Month-effective CEO settings remain authoritative. This tests configured preview behavior, not statutory-table certification.
    expect(socsoShare(3000, 35)).toMatchObject({ ee: 15, er: 52.5 });
    expect(socsoShare(8000, 35)).toMatchObject({ ee: 30, er: 105 });
    expect(eisShare(3000, 35, 'MY')).toEqual({ ee: 6, er: 6 });
    expect(eisShare(3000, 60, 'MY')).toEqual({ ee: 0, er: 0 });
    // Low pay: the RM400 rebate wipes the tax out, and PCB under RM10 is not deducted.
    expect(pcbEstimate(3000, 330, 21)).toBe(0);
    expect(pcbEstimate(10900, 1199, 42)).toBeCloseTo(1146.88, 1);
  });

  it('runs HR, then the Chief of Staff, then the COO, then Finance, and nobody skips a step (approvals changed 1 Nov 2026)', async () => {
    const { svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const coo = await svc.user('u-coo');
    const vc = await svc.user('u-vchair');
    const fin = await svc.user('u-fin-t1-lead');
    const board = await svc.staffPayroll(hr);
    expect(board.role).toBe('hr');
    expect(board.employers.map((e) => e.companyId)).toEqual(expect.arrayContaining(['pwvsb', 'co-sasa', 'co-arsh', 'co-inas']));
    expect(board.employers.every((e) => !e.lastLate)).toBe(true);
    const id = (c: string) => `sp-${c}-2026-10`;
    // The COO cannot approve before the Chief of Staff; the Vice Chairman no longer has a monthly step.
    await expect(svc.staffPayStep(coo, id('pwvsb'), 'coo_approve', { note: 'OK' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.staffPayStep(cos, id('pwvsb'), 'approve')).rejects.toThrow(/comment/);
    await svc.staffPayStep(cos, id('pwvsb'), 'approve', { note: 'Checked against the staff list' });
    await expect(svc.staffPayStep(vc, id('pwvsb'), 'coo_approve', { note: 'OK' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.staffPayStep(coo, id('pwvsb'), 'coo_approve')).rejects.toThrow(/comment/);
    const second = await svc.staffPayStep(coo, id('pwvsb'), 'coo_approve', { note: 'Approved' });
    expect(second.cooApproved?.note).toBe('Approved');
    // Files only once the COO has approved; Finance pays with the bank reference and the PCB checked.
    const bank = await svc.staffPayExport(fin, id('pwvsb'), 'bank');
    expect(bank.body.split('\n')[0]).toBe('Staff no,Name,Bank,Account,Amount,Reference');
    const sql = await svc.staffPayExport(fin, id('pwvsb'), 'sql');
    const rows = sql.body
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(','));
    const dr = rows.reduce((n, r) => n + Number(r[r.length - 2]), 0);
    const cr = rows.reduce((n, r) => n + Number(r[r.length - 1]), 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.05);
    await expect(svc.staffPayStep(fin, id('pwvsb'), 'pay', { bankRef: 'X1' })).rejects.toThrow(/PCB/);
    const paid = await svc.staffPayStep(fin, id('pwvsb'), 'pay', { bankRef: 'M2U-TEST-1', pcbChecked: true });
    expect(paid.stage).toBe('paid');
    // A return needs a reason and clears the approvals.
    await expect(svc.staffPayStep(coo, id('co-sasa'), 'return')).rejects.toThrow(/change/);
    const back = await svc.staffPayStep(coo, id('co-sasa'), 'return', { note: 'Check the car allowance.' });
    expect(back.stage).toBe('draft');
    expect(back.approved).toBeNull();
    // HR cannot submit a month with a staff member who has no salary account.
    await expect(svc.staffPayStep(hr, id('co-inas'), 'submit')).rejects.toThrow(/salary account/);
    // HR enters the PCB from LHDN's calculator in a draft only.
    const line = (await svc.staffPayRun(hr, id('co-sasa'))).run.lines[0];
    const fixed = await svc.setStaffPayLine(hr, id('co-sasa'), line.personId, { pcb: 55, extra: [{ label: 'Festive bonus', amount: 500 }] });
    expect(fixed.pcbSource).toBe('entered');
    expect(fixed.gross).toBeCloseTo(line.gross + 500, 2);
    await expect(svc.setStaffPayLine(hr, id('co-arsh'), (await svc.staffPayRun(hr, id('co-arsh'))).run.lines[0].personId, { pcb: 1 })).rejects.toThrow(/draft/);
    // Recalculating keeps HR's entries.
    const again = await svc.prepareStaffPay(hr, 'co-sasa', '2026-10');
    expect(again.lines.find((l) => l.personId === line.personId)!.pcb).toBe(55);
    // Only HR prepares; only Finance pays.
    await expect(svc.prepareStaffPay(cos, 'co-sasa', '2026-10')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.staffPayStep(hr, id('co-arsh'), 'pay', { bankRef: 'x', pcbChecked: true })).rejects.toBeInstanceOf(BadRequest);
  });

  it('shows a company manager only their own company, staff only their own payslips, and guards nothing', async () => {
    const { svc } = fresh();
    const cm = await svc.staffPayroll(await svc.user('u-cm-sasa'));
    expect(cm.role).toBe('view');
    expect(new Set(cm.runs.map((r) => r.companyId))).toEqual(new Set(['co-sasa']));
    await expect(svc.staffPayRun(await svc.user('u-cm-sasa'), 'sp-co-arsh-2026-10')).rejects.toThrow(/not found/);
    const ae = await svc.staffPayroll(await svc.user('u-ae-arsh'));
    expect(ae.role).toBeNull();
    expect(ae.runs).toEqual([]);
    expect(ae.mine.length).toBe(1);
    expect(ae.mine[0].period).toBe('2026-09');
    await expect(svc.staffPayRun(await svc.user('u-ae-arsh'), 'sp-co-arsh-2026-10')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.staffPayroll(await svc.user('u-guard-sasa-1'))).rejects.toBeInstanceOf(AccessDenied);
    // The asset finance executive is not on a Finance team, so does not pay salaries.
    expect((await svc.staffPayroll(await svc.user('u-finance-am'))).role).toBeNull();
  });

  it("puts each approver's turn on their home, and last month unpaid after the 7th in front of the CEO", async () => {
    const { svc, store } = fresh();
    const tags = async (id: string) => {
      const h = await svc.home(await svc.user(id));
      return [...h.todo, ...(h.watch ?? [])].filter((t) => t.tag === 'Staff payroll').map((t) => t.title);
    };
    expect((await tags('u-cos')).some((t) => t.includes('approve'))).toBe(true);
    expect((await tags('u-coo')).some((t) => t.includes('approve as COO'))).toBe(true);
    expect((await tags('u-vchair')).length).toBe(0);
    expect((await tags('u-fd')).some((t) => t.includes('pay through the bank'))).toBe(true);
    // In the pilot the CEO approves for the Chief of Staff, so that turn shows too.
    expect((await tags('u-fauzan')).some((t) => t.includes('not paid by the 7th'))).toBe(false);
    await store.update('staffPayRuns', 'sp-co-inas-2026-09', { stage: 'coo_approved', paid: null });
    expect((await tags('u-fauzan')).some((t) => t.includes('not paid by the 7th'))).toBe(true);
  });
});

describe('Finance monitor (Fauzan, 27 Oct 2026)', () => {
  it('shows every company to the Finance Director and the CEO, and each team only its own companies', async () => {
    const { svc } = fresh();
    const fd = await svc.finBoard(await svc.user('u-fd'));
    expect(fd.rows.length).toBe(39);
    expect(fd.teams.map((t) => t.team)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(fd.teams[0].members.map((m) => m.role).sort()).toEqual(['data_entry', 'data_entry', 'deputy', 'leader']);
    expect((await svc.finBoard(await svc.user('u-fauzan'))).rows.length).toBe(39);
    const t1 = await svc.finBoard(await svc.user('u-fin-t1-de1'));
    expect(t1.rows.length).toBeGreaterThan(0);
    expect(t1.rows.every((r) => r.status.team === 1)).toBe(true);
    for (const id of ['u-coo', 'u-cos', 'u-pwvsb-hr', 'u-finance-am', 'u-cm-sasa'])
      await expect(svc.finBoard(await svc.user(id))).rejects.toBeInstanceOf(AccessDenied);
    // The Finance Director's home carries the companies in trouble.
    const home = await svc.home(await svc.user('u-fd'));
    expect(home.todo.some((t) => t.tag === 'Finance')).toBe(true);
  });

  it('treats silent SQL Account figures as unknown, never as fine', async () => {
    const { svc, store } = fresh();
    const ok = (await svc.finBoard(await svc.user('u-fd'))).rows.find((r) => r.tone === 'ok')!;
    await store.update('finStatus', ok.status.id, { sqlLastAt: null });
    const again = (await svc.finBoard(await svc.user('u-fd'))).rows.find((r) => r.status.id === ok.status.id)!;
    expect(again.tone).toBe('unknown');
  });

  it('lets data entry prepare, the leader or deputy review, and only the leader or Finance Director send', async () => {
    const { svc, store } = fresh();
    const row = (await svc.finBoard(await svc.user('u-fin-t1-lead'))).rows[0];
    const cid = row.status.companyId;
    await store.update('finStatus', row.status.id, { tax: row.status.tax.map((i) => (i.id === 'tax-ea' ? { ...i, status: 'todo' as const } : i)) });
    const de = await svc.user('u-fin-t1-de1');
    await expect(svc.setFinPack(de, cid, 'tax', 'tax-ea', 'reviewed')).rejects.toThrow(/team leader or deputy/);
    await svc.setFinPack(de, cid, 'tax', 'tax-ea', 'prepared');
    await expect(svc.setFinPack(await svc.user('u-fin-t1-dep'), cid, 'tax', 'tax-ea', 'sent')).rejects.toThrow(/sends/);
    // Phase 2 (31 Oct 2026): reviewing and sending need a comment.
    await expect(svc.setFinPack(await svc.user('u-fin-t1-dep'), cid, 'tax', 'tax-ea', 'reviewed')).rejects.toThrow(/comment/);
    await svc.setFinPack(await svc.user('u-fin-t1-dep'), cid, 'tax', 'tax-ea', 'reviewed', 'Checked against the payroll.');
    const sent = await svc.setFinPack(await svc.user('u-fin-t1-lead'), cid, 'tax', 'tax-ea', 'sent', 'Sent to the tax agent.');
    expect(sent.status).toBe('sent');
    // No skipping a step and no other team's books. Phase 2 (31 Oct 2026): the CEO has full authority alongside the
    // Finance Director, so the CEO may move a paper; the Chairman still only watches.
    await store.update('finStatus', row.status.id, { tax: row.status.tax.map((i) => (i.id === 'tax-forme' ? { ...i, status: 'todo' as const } : i)) });
    await expect(svc.setFinPack(await svc.user('u-fin-t1-lead'), cid, 'tax', 'tax-forme', 'reviewed')).rejects.toThrow(/prepared first/);
    await expect(svc.setFinPack(await svc.user('u-fin-t2-lead'), cid, 'tax', 'tax-forme', 'prepared')).rejects.toThrow(/not found/);
    expect((await svc.setFinPack(await svc.user('u-fauzan'), cid, 'tax', 'tax-forme', 'prepared')).status).toBe('prepared');
    await expect(svc.setFinPack(await svc.user('u-chair'), cid, 'tax', 'tax-forme', 'reviewed', 'ok')).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Contracts and site mobilisation (V6 amendment)', () => {
  it('bills by Method 1, 2, 3 or a fixed fee', () => {
    const v = {
      version: 1,
      effectiveFrom: '2026-01-01',
      billingMethod: 'M1' as const,
      posts: [{ postId: null, label: 'Gate', guards: 2, hoursPerDay: 12, armed: false, rate: 10, contractedHours: 300 }],
      fixedFee: null,
      sla: { replaceAbsentMinutes: 60, incidentReportHours: 24, monthlyReportByDay: 7 },
      penalties: '',
      signedRef: 'x',
      reason: '',
      by: '',
      at: '',
    };
    expect(contractBilling(v, '2026-02').total).toBe(7320);
    expect(contractBilling({ ...v, billingMethod: 'M2' }, '2026-02').total).toBe(6000);
    expect(contractBilling({ ...v, billingMethod: 'M3' }, '2026-02').total).toBe(6720);
    expect(contractBilling({ ...v, billingMethod: 'M3' }, '2026-03').total).toBe(7440);
    expect(contractBilling({ ...v, billingMethod: 'FIXED', fixedFee: 9000 }, '2026-02').total).toBe(9000);
  });

  it('will not certify a site ready while a critical item is open, and never risk-accepts a critical item', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ae = await svc.user('u-ae-arsh');
    const id = 'ct-co-arsh-new1';
    await expect(svc.contractStep(cm, id, 'certify')).rejects.toThrow(/Not ready/);
    const c = (await svc.contracts(cm)).rows.find((r) => r.contract.id === id)!;
    const crit = c.contract.mobilisation.find((i) => i.critical)!;
    await expect(svc.setMobItem(cm, id, crit.id, 'risk_accepted', 'later', addDays(TODAY, 10))).rejects.toThrow(/critical/);
    // The admin executive works the items with proof; only the company manager accepts a risk or certifies.
    await expect(svc.setMobItem(ae, id, c.contract.mobilisation.find((x) => x.critical && !x.auto && x.status === 'open')!.id, 'done', '')).rejects.toThrow(/proof/);
    for (const i of c.contract.mobilisation.filter((x) => x.critical && x.status !== 'done')) {
      if (i.auto) await expect(svc.setMobItem(ae, id, i.id, 'done', '')).rejects.toThrow(/Not yet/);
      else await svc.setMobItem(ae, id, i.id, 'done', '', null, [proof()]);
    }
    // The system's own checks (roster, guard clearance) cannot pass on a contract with no site: simulate them done.
    const cur = (await store.get('contracts', id))!;
    await store.update('contracts', id, { mobilisation: cur.mobilisation.map((i) => (i.auto && i.critical ? { ...i, status: 'done' as const } : i)) });
    const major = c.contract.mobilisation.find((i) => !i.critical && i.offset <= 0 && i.status === 'open')!;
    await expect(svc.setMobItem(ae, id, major.id, 'risk_accepted', 'x', addDays(TODAY, 5))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setMobItem(cm, id, major.id, 'risk_accepted', 'x', addDays(TODAY, 45))).rejects.toThrow(/no later than/);
    for (const i of c.contract.mobilisation.filter((x) => !x.critical && x.offset <= 0 && x.status === 'open'))
      await svc.setMobItem(cm, id, i.id, 'risk_accepted', 'Radios arrive day 2', addDays(TODAY, 10));
    await expect(svc.contractStep(ae, id, 'certify')).rejects.toBeInstanceOf(AccessDenied);
    // The checks are run again at certification: they still fail, so the site is not ready.
    await expect(svc.contractStep(cm, id, 'certify', 'Checked on site')).rejects.toThrow(/Not ready any more/);
  });

  it('runs the day 30 review only with the invoice checked, and changes billing only by a signed variation', async () => {
    const { svc, store } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const row = (await svc.contracts(cm)).rows.find((r) => r.reviewsDue.length)!;
    await svc.contractReview(cm, row.contract.id, row.reviewsDue[0].day, 'All posts manned; client happy.');
    const c = row.contract;
    await store.update('contracts', c.id, { reviews: c.reviews.map((r) => (r.day === 30 ? { ...r, dueOn: TODAY, doneAt: null } : r)) });
    await expect(svc.contractReview(cm, c.id, 30, 'ok')).rejects.toThrow(/invoice/);
    await svc.contractReview(cm, c.id, 30, 'Invoice matches', true);
    const input = { effectiveFrom: addDays(TODAY, 5), billingMethod: 'FIXED' as const, posts: [], fixedFee: 25000, signedRef: '', reason: 'Fixed fee agreed' };
    await expect(svc.addContractVariation(cm, c.id, input)).rejects.toThrow(/signed variation/);
    await expect(svc.addContractVariation(await svc.user('u-ae-arsh'), c.id, { ...input, signedRef: 'V1' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.addContractVariation(cm, c.id, { ...input, signedRef: 'ARSH/CT/V9' })).rejects.toThrow(/copy of the signed variation/);
    const v = await svc.addContractVariation(cm, c.id, { ...input, signedRef: 'ARSH/CT/V9', proof: [proof()] });
    expect(v.versions.at(-1)!.billingMethod).toBe('FIXED');
    // Group leadership watches; another company's manager sees nothing.
    expect((await svc.contracts(await svc.user('u-fauzan'))).rows.length).toBeGreaterThan(100);
    expect((await svc.contracts(await svc.user('u-cm-sasa'))).rows.every((r) => r.contract.companyId === 'co-sasa')).toBe(true);
    // Group leadership other than the owner only watches (P78: the owner works contracts as the company manager does).
    await expect(svc.contractStep(await svc.user('u-coo'), c.id, 'suspend', 'x')).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Branches (V11, V12, V12.1)', () => {
  const ag = (model: 'A' | 'B' | 'C', pct: number | null, salary: number | null = null) => ({
    version: 1,
    effectiveFrom: '2026-01-01',
    model,
    managerName: 'x',
    managerKind: 'partner_company' as const,
    companyBillingSharePct: model === 'A' ? pct : null,
    companyNetProfitSharePct: model === 'C' ? pct : null,
    managerSalary: salary,
    signedRef: 'x',
    by: 'x',
    at: 'x',
  });
  const month = { billing: 100_000, costs: { wages: 70_000, statutory: 8_000, other: 2_000 } };

  it('splits by the signed agreement only, and holds a month with a missing term', () => {
    expect(branchSplit(ag('A', 8), month)).toMatchObject({ companyShare: 8000, managerShare: 12000, shortfall: 0 });
    // Model A: the company keeps its share of billing even when costs eat the rest; the shortfall is recorded.
    expect(branchSplit(ag('A', 8), { ...month, costs: { wages: 90_000, statutory: 8_000, other: 2_000 } })).toMatchObject({
      companyShare: 8000,
      managerShare: 0,
      shortfall: 8000,
    });
    expect(branchSplit(ag('B', null, 7500), month)).toMatchObject({ companyShare: 20000, managerShare: 0 });
    expect(branchSplit(ag('C', 55), month)).toMatchObject({ companyShare: 11000, managerShare: 9000 });
    expect(branchSplit(ag('C', 62.5), month)).toMatchObject({ companyShare: 12500, managerShare: 7500 });
    expect(branchSplit(ag('C', null), month).missingTerm).toBe(true);
    expect(branchSplit(null, month).missingTerm).toBe(true);
  });

  it('lets only the company manager approve, review and change agreements, and never back-dates into a settled month', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-inas');
    const board = await svc.branchBoard(cm);
    const held = board.rows.find((r) => r.branch.id === 'br-inas-3')!;
    expect(held.holds[0]).toMatch(/CONTRACT REVIEW/);
    await expect(svc.approveBranchSettlement(cm, held.settlement!.id, 'Checked the month')).rejects.toThrow(/Held/);
    const sasa = await svc.user('u-cm-sasa');
    const ok = (await svc.branchBoard(sasa)).rows.find((r) => r.canApprove)!;
    const approved = await svc.approveBranchSettlement(sasa, ok.settlement!.id, 'Checked the month');
    expect(approved.status).toBe('approved');
    const q = ok.queue[0];
    await expect(svc.reviewBranchAction(sasa, q.action.id, 'reversed', '')).rejects.toThrow(/why/);
    expect((await svc.reviewBranchAction(sasa, q.action.id, 'reversed', 'Not within the limit')).status).toBe('reversed');
    const input = {
      effectiveFrom: `${ok.settlement!.period}-01`,
      model: 'C' as const,
      managerName: 'New',
      managerKind: 'partner_company' as const,
      pct: 60,
      managerSalary: null,
      signedRef: 'AGR/2',
    };
    await expect(svc.addBranchAgreement(sasa, ok.branch.id, input)).rejects.toThrow(/already settled/);
    await expect(svc.addBranchAgreement(sasa, ok.branch.id, { ...input, effectiveFrom: '2026-11-01', pct: null })).rejects.toThrow(/percentage/);
    const v2 = await svc.addBranchAgreement(sasa, ok.branch.id, { ...input, effectiveFrom: '2026-11-01' });
    expect(v2.version).toBe(2);
    // An admin executive sees the branch but cannot decide; another company's manager does not see it.
    await expect(svc.reviewBranchAction(await svc.user('u-ae-arsh'), 'ba-br-arsh-1-1', 'accepted', '')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.approveBranchSettlement(cm, ok.settlement!.id, 'Checked the month')).rejects.toThrow(/not found/);
    // PWVSB sees what the companies leave unreviewed past 7 days.
    const home = await svc.home(await svc.user('u-fauzan'));
    expect([...home.todo, ...(home.watch ?? [])].some((t) => t.tag === 'Branch')).toBe(true);
  });
});

describe('IT department (Fauzan, 27 Oct 2026)', () => {
  it('shows the full board to IT, the COO and the CEO only; everyone else sees their own help requests', async () => {
    const { svc } = fresh();
    for (const id of ['u-it-mgr', 'u-it-ex1', 'u-coo', 'u-fauzan']) {
      const b = await svc.itBoard(await svc.user(id));
      expect(b.assets?.length).toBeGreaterThan(250);
      expect(b.kpis!.purchasesWaiting).toBeGreaterThan(0);
    }
    for (const id of ['u-cm-sasa', 'u-chair']) {
      const b = await svc.itBoard(await svc.user(id));
      expect(b.role).toBeNull();
      expect(b.assets).toBeUndefined();
    }
    const cm = await svc.user('u-cm-sasa');
    const t = await svc.raiseItTicket(cm, { category: 'M365', priority: 'P2', title: 'Outlook keeps asking for password', detail: '' });
    expect((await svc.itBoard(cm)).mine.map((x) => x.id)).toContain(t.id);
    await expect(svc.itTicketStep(cm, t.id, 'take')).rejects.toBeInstanceOf(AccessDenied);
    const ex = await svc.user('u-it-ex1');
    await svc.itTicketStep(ex, t.id, 'take');
    await expect(svc.itTicketStep(ex, t.id, 'resolve', '')).rejects.toThrow(/fixed/);
    expect((await svc.itTicketStep(ex, t.id, 'resolve', 'Reset the sign-in')).status).toBe('resolved');
  });

  it('agrees the need in IT, buys through Procurement, and tags only what the storekeeper received (Fauzan, 27 Oct 2026)', async () => {
    const { svc, ds } = fresh();
    const ex = await svc.user('u-it-ex2');
    const mgr = await svc.user('u-it-mgr');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const proc = await svc.user('u-proc-exec');
    // This route is for after the pilot; during the pilot IT buys with three quotes and Teams approvals (rule IT-BUY).
    RULES.pilot.value.on = false;
    onTestFinished(() => void (RULES.pilot.value.on = true));
    const sk = await svc.user('u-proc-store1');
    const p = await svc.raiseItPurchase(ex, { ownerId: 'co-sasa', reason: 'New site', items: [{ kind: 'CCTV', description: 'NVR', qty: 2, unitPrice: 1500 }] });
    expect(p.total).toBe(3000);
    await expect(svc.itPurchaseStep(coo, p.id, 'approve')).rejects.toThrow(/IT Manager agrees/);
    await expect(svc.itPurchaseStep(ex, p.id, 'approve')).rejects.toThrow(/cannot approve/);
    // IT can no longer order or receive by itself: the need goes to Procurement.
    await expect(svc.itPurchaseStep(ex, p.id, 'receive')).rejects.toThrow(/cannot receive/);
    const agreed = await svc.itPurchaseStep(mgr, p.id, 'approve', { note: 'Site requirement verified' });
    expect(agreed.status).toBe('procurement');
    const pr = ds.purRequests.find((r) => r.id === agreed.purRequestId)!;
    expect(pr).toMatchObject({ companyId: 'co-sasa', category: 'IT', status: 'quoting', raisedById: ex.id, total: 3000 });
    await expect(svc.itPurchaseStep(ex, p.id, 'receive')).rejects.toThrow(/still with Procurement/);
    // Procurement: three documented quotes, the online price, COO then CEO, the storekeeper receives.
    for (const [k, amount] of [[1, 3100], [2, 2990], [3, 3050]] as const)
      await svc.purStep(proc, pr.id, 'quote', { supplierId: `sup-co-sasa-${k}`, amount, ref: `Q${k}`, proof: [proof()] });
    await svc.purStep(proc, pr.id, 'online', { source: 'Lazada', ref: 'listing', amount: 2950, proof: [proof()] });
    await svc.purStep(proc, pr.id, 'submit', { supplierId: 'sup-co-sasa-2' });
    await svc.purStep(coo, pr.id, 'approve', { note: 'ok' });
    await svc.purStep(ceo, pr.id, 'approve', { note: 'ok' });
    await svc.purStep(proc, pr.id, 'order', { ref: 'PO-IT-1' });
    await svc.purStep(sk, pr.id, 'receive', { qty: [1] });
    const done = await svc.itPurchaseStep(ex, p.id, 'receive');
    expect(done.received!.assetIds).toHaveLength(1);
    const a = (await svc.itBoard(mgr)).assets!.find((x) => x.asset.id === done.received!.assetIds[0])!.asset;
    expect(a).toMatchObject({ status: 'spare', kind: 'CCTV', ownerId: 'co-sasa', purchaseId: p.id });
    expect(a.nextServiceOn).not.toBeNull();
    // The IT Manager's own request: the COO agrees the need, never the IT Manager (it used to get stuck).
    const own = await svc.raiseItPurchase(mgr, { ownerId: 'pwvsb', reason: 'x', items: [{ kind: 'LAPTOP', description: 'L', qty: 1, unitPrice: 3000 }] });
    await expect(svc.itPurchaseStep(mgr, own.id, 'approve')).rejects.toThrow(/asked for/);
    expect((await svc.itBoard(coo)).purchases!.find((r) => r.purchase.id === own.id)!.canApprove).toBe(true);
    expect((await svc.home(coo)).todo.some((t) => t.tag === 'IT purchase' && t.title.startsWith(own.ref))).toBe(true);
    const ownPr = await svc.itPurchaseStep(coo, own.id, 'approve', { note: 'Manager need independently verified' });
    // PWVSB's own purchase shows on the Procurement board.
    expect((await svc.purBoard(proc)).requests.some((r) => r.req.id === ownPr.purRequestId && r.companyName === 'PWVSB (central)')).toBe(true);
  });

  it('lets only the IT Manager dispose, after a reasoned request, and keeps the record', async () => {
    const { svc } = fresh();
    const ex = await svc.user('u-it-ex1');
    const mgr = await svc.user('u-it-mgr');
    const a = (await svc.itBoard(mgr)).assets!.find((x) => x.asset.status === 'in_use')!.asset;
    await expect(svc.setItAsset(mgr, a.id, 'disposed', null)).rejects.toThrow(/Ask for disposal/);
    await expect(svc.setItAsset(ex, a.id, 'disposal_pending', null, '')).rejects.toThrow(/why/);
    await svc.setItAsset(ex, a.id, 'disposal_pending', null, 'Screen broken, not worth repair');
    await expect(svc.setItAsset(ex, a.id, 'disposed', null)).rejects.toBeInstanceOf(AccessDenied);
    // E-waste (RBA checklist C1): the licensed contractor and its consignment note are needed to dispose.
    await expect(svc.setItAsset(mgr, a.id, 'disposed', null)).rejects.toThrow(/e-waste contractor/);
    const gone = await svc.setItAsset(mgr, a.id, 'disposed', null, '', { contractor: 'Synthetic E-Waste Recycler', noteRef: 'CN-TEST-001' });
    expect(gone.disposal).toMatchObject({ reason: 'Screen broken, not worth repair', doneBy: mgr.name, ewaste: { contractor: 'Synthetic E-Waste Recycler', noteRef: 'CN-TEST-001' } });
    const s = await svc.itMaintenance(
      ex,
      (await svc.itBoard(mgr)).assets!.find((x) => x.asset.kind === 'PRINTER')!.asset.id,
      'service',
      'Cleaned and tested',
      80,
    );
    expect(s.nextServiceOn! > addDays(s.lastCheckedOn!, 150)).toBe(true);
  });

  it('never shows an unchecked domain as fine, and flags late help requests', async () => {
    const { svc } = fresh();
    const b = await svc.itBoard(await svc.user('u-it-mgr'));
    const unchecked = b.domains!.filter((d) => d.domain.lastCheckAt === null);
    expect(unchecked.length).toBeGreaterThan(0);
    expect(unchecked.every((d) => d.tone !== 'ok' && d.tone !== 'warn')).toBe(true);
    expect(b.domains!.filter((d) => d.domain.expiresOn === null).every((d) => d.tone === 'unknown' || d.tone === 'crit')).toBe(true);
    expect(b.kpis!.domainsCrit).toBeGreaterThan(0);
    expect(b.tickets!.some((t) => t.breached)).toBe(true);
  });
});

describe('IT pilot: jobs, proof, oversight and system ownership (Fauzan, 28 Oct 2026)', () => {
  const due = (d: number) => addDays(TODAY, d);

  it('the IT Manager gives a job; the doer submits it only with proof; nobody accepts their own work', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    const ex = await svc.user('u-it-ex3');
    const ex4 = await svc.user('u-it-ex4');
    // Executives do not give jobs; the IT Manager is not given jobs (she supervises).
    await expect(svc.giveItJob(ex, { kind: 'task', title: 'Fix it', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex4', dueOn: due(2) })).rejects.toThrow();
    await expect(svc.giveItJob(lead, { kind: 'task', title: 'Report', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-mgr', dueOn: due(2) })).rejects.toThrow(/IT Lead or an IT Executive/);
    await expect(svc.giveItJob(mgr, { kind: 'task', title: 'Old', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex3', dueOn: due(-1) })).rejects.toThrow(/due date/);
    const j = await svc.giveItJob(mgr, { kind: 'training', title: 'Teams training for Sasa admin', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex3', dueOn: due(3) });
    await expect(svc.itJobStep(ex4, j.id, 'start')).rejects.toThrow(/Only IT Executive 3/);
    await svc.itJobStep(ex, j.id, 'start');
    await expect(svc.itJobStep(ex, j.id, 'submit', 'Trained 6 people')).rejects.toThrow(/proof/);
    const p = proof();
    const sub = await svc.itJobStep(ex, j.id, 'submit', 'Trained 6 people', [p]);
    expect(sub.status).toBe('submitted');
    expect(sub.proof).toHaveLength(1);
    // The IT Lead does not accept: the IT Manager supervises and accepts.
    await expect(svc.itJobStep(lead, j.id, 'accept')).rejects.toThrow(/IT Manager accepts/);
    await expect(svc.itJobStep(mgr, j.id, 'return', 'no')).rejects.toThrow(/missing/);
    const back = await svc.itJobStep(mgr, j.id, 'return', 'Attach the signed attendance sheet');
    expect(back).toMatchObject({ status: 'returned', returns: 1 });
    // The same file again is refused; new proof is needed.
    await expect(svc.itJobStep(ex, j.id, 'submit', 'Again', [p])).rejects.toThrow(/already given/);
    await svc.itJobStep(ex, j.id, 'submit', 'Signed sheet attached', [proof()]);
    const ok = await svc.itJobStep(mgr, j.id, 'accept', 'Proof checked');
    expect(ok).toMatchObject({ status: 'accepted', acceptedBy: mgr.name });
    expect(ok.log.map((l) => l.what)).toEqual(['start', 'submit', 'return', 'submit', 'accept']);
    // The proof file can be opened by the COO, who monitors.
    expect((await svc.itJobProof(await svc.user('u-coo'), j.id, ok.proof[0].sha256)).data).toMatch(/^data:application\/pdf/);
    // The IT Lead's own job is accepted by the IT Manager, never by the IT Lead.
    const own = await svc.giveItJob(mgr, { kind: 'task', title: 'Licence renewals', detail: '', priority: 'P2', technical: false, assigneeId: 'u-it-lead', dueOn: due(1) });
    await svc.itJobStep(lead, own.id, 'submit', 'Renewed all 120', [proof()]);
    await expect(svc.itJobStep(lead, own.id, 'accept')).rejects.toThrow(/own work/);
  });

  it('a technical job is checked by the IT Lead before the IT Manager accepts it', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    const ex = await svc.user('u-it-ex2');
    const j = await svc.giveItJob(lead, { kind: 'install', title: 'Install NVR at the Inas office', detail: '', priority: 'P2', technical: true, assigneeId: 'u-it-ex2', dueOn: due(5) });
    await svc.itJobStep(ex, j.id, 'submit', 'Installed and recording', [proof()]);
    await expect(svc.itJobStep(mgr, j.id, 'accept', 'Proof checked')).rejects.toThrow(/IT Lead checks it first/);
    await expect(svc.itJobStep(mgr, j.id, 'check')).rejects.toThrow(/IT Lead does the technical check/);
    expect((await svc.itJobStep(lead, j.id, 'check', 'Footage plays back')).status).toBe('checked');
    expect((await svc.itJobStep(mgr, j.id, 'accept', 'Proof checked')).status).toBe('accepted');
  });

  it('a job is changed only with a reason, and the change is kept', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const ex = await svc.user('u-it-ex1');
    const j = await svc.giveItJob(mgr, { kind: 'check', title: 'Check laptops', detail: '', priority: 'P3', technical: false, assigneeId: 'u-it-ex1', dueOn: due(2) });
    await expect(svc.editItJob(ex, j.id, { dueOn: due(9) }, 'More time')).rejects.toThrow(/IT Manager or the IT Lead/);
    await expect(svc.editItJob(mgr, j.id, { dueOn: due(9) }, '')).rejects.toThrow(/why/);
    const e = await svc.editItJob(mgr, j.id, { dueOn: due(9), assigneeId: 'u-it-ex4' }, 'IT Executive 1 on leave');
    expect(e).toMatchObject({ dueOn: due(9), assigneeId: 'u-it-ex4' });
    expect(e.log.at(-1)!.note).toMatch(/IT Executive 1 on leave/);
    expect(ds.audit.some((a) => a.action === 'it.job.edit' && a.entityId === j.id)).toBe(true);
  });

  it('late jobs go up: IT Manager, then the COO after 3 days, then the CEO after 7', async () => {
    const { svc } = fresh();
    const b = await svc.itBoard(await svc.user('u-it-mgr'));
    const late = b.jobs!.filter((r) => r.lateDays > 0);
    expect(late.map((r) => r.level).sort()).toEqual(expect.arrayContaining(['ceo', 'coo', 'manager']));
    const coo = await svc.home(await svc.user('u-coo'));
    const ceo = await svc.home(await svc.user('u-fauzan'));
    const all = (h: typeof coo) => [...h.todo, ...(h.watch ?? [])];
    expect(all(coo).find((t) => t.tag === 'IT jobs late')!.detail).toMatch(/ITJ-0002/); // 4 days late
    expect(all(ceo).find((t) => t.tag === 'IT jobs late')!.detail).not.toMatch(/ITJ-0002/);
    expect(all(ceo).find((t) => t.tag === 'IT jobs late')!.detail).toMatch(/ITJ-0001/); // 9 days late
    // Each person's record is there for the COO and the CEO; the IT Manager is not scored on jobs.
    const team = (await svc.itBoard(await svc.user('u-coo'))).teamRows!;
    expect(team.find((r) => r.id === 'u-it-ex2')!.jobsLate).toBeGreaterThan(0);
    expect(team.find((r) => r.id === 'u-it-ex4')!.onTimePct).not.toBeNull();
    expect(team.find((r) => r.id === 'u-it-mgr')!.jobsOpen).toBe(0);
  });

  it('help requests: given to one person, confirmed by the person who asked, reopened when not fixed', async () => {
    const { svc } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const ex1 = await svc.user('u-it-ex1');
    const ex2 = await svc.user('u-it-ex2');
    const cm = await svc.user('u-cm-inas');
    const t = await svc.raiseItTicket(cm, { category: 'DEVICE', priority: 'P2', title: 'Printer jams', detail: '' });
    await expect(svc.itTicketStep(ex1, t.id, 'assign', '', 'u-it-ex2')).rejects.toThrow(/assigns/);
    await svc.itTicketStep(mgr, t.id, 'assign', '', 'u-it-ex2');
    await expect(svc.itTicketStep(ex1, t.id, 'resolve', 'Fixed')).rejects.toThrow(/with IT Executive 2/);
    await svc.itTicketStep(ex2, t.id, 'resolve', 'Cleared the roller');
    expect((await svc.itBoard(cm)).mine.find((x) => x.id === t.id)!.canConfirm).toBe(true);
    await expect(svc.confirmItTicket(cm, t.id, false, '')).rejects.toThrow(/still wrong/);
    const re = await svc.confirmItTicket(cm, t.id, false, 'Jams again after 10 pages');
    expect(re).toMatchObject({ status: 'in_progress', reopened: 1, assignedToId: 'u-it-ex2' });
    await svc.itTicketStep(ex2, t.id, 'resolve', 'Replaced the roller');
    expect((await svc.confirmItTicket(cm, t.id, true)).confirmedAt).toBeTruthy();
    // Someone else cannot confirm for them.
    await expect(svc.confirmItTicket(mgr, t.id, true)).rejects.toThrow();
  });

  it('the CEO owns every system: IT asks, only the CEO grants or removes access', async () => {
    const { svc, ds } = fresh();
    const lead = await svc.user('u-it-lead');
    const mgr = await svc.user('u-it-mgr');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    expect(ds.itAccounts.every((a) => a.ownerId === 'u-fauzan')).toBe(true);
    const r = await svc.askItAccess(lead, { accountId: 'itac-5', action: 'grant', userId: 'u-it-ex1', level: 'operator', reason: 'Backup for website deployments' });
    await expect(svc.askItAccess(lead, { accountId: 'itac-5', action: 'grant', userId: 'u-it-ex1', level: 'operator', reason: 'Again please' })).rejects.toThrow(/already with the CEO/);
    for (const u of [lead, mgr, coo]) await expect(svc.decideItAccess(u, r.id, true, 'ok')).rejects.toThrow(/Only the CEO/);
    expect((await svc.home(ceo)).todo.concat((await svc.home(ceo)).watch ?? []).some((t) => t.tag === 'System access')).toBe(true);
    await svc.decideItAccess(ceo, r.id, true, 'ok');
    expect(ds.itAccounts.find((a) => a.id === 'itac-5')!.access.some((x) => x.userId === 'u-it-ex1')).toBe(true);
    await expect(svc.reviewItAccount(mgr, 'itac-5', 'ok')).rejects.toThrow(/CEO/);
    expect((await svc.reviewItAccount(ceo, 'itac-5', 'ok')).reviewedOn).toBe(TODAY);
    // Website settings belong to the CEO now, not the IT Manager.
    await expect(svc.websites.act(mgr, 'saveSettings', { responseDays: 20 })).rejects.toThrow(/CEO/);
  });

  it('a joiner or a tender part given to one person is ticked by that person (or the IT Manager or IT Lead)', async () => {
    const { svc, ds } = fresh();
    const lead = await svc.user('u-it-lead');
    const o = ds.itOnboarding.find((x) => x.ownerStaffId === 'u-it-ex1') ?? ds.itOnboarding[0];
    await svc.setItOwner(lead, 'onboarding', o.id, 'u-it-ex1');
    const step = ds.itOnboarding.find((x) => x.id === o.id)!.steps.find((s) => !s.doneAt)!;
    await expect(svc.setItOnboardingStep(await svc.user('u-it-ex3'), o.id, step.key, true, 'Synthetic checklist evidence', 0)).rejects.toThrow(/someone else/);
    expect((await svc.setItOnboardingStep(await svc.user('u-it-ex1'), o.id, step.key, true, 'Synthetic checklist evidence', 0)).steps.find((s) => s.key === step.key)!.doneAt).toBeTruthy();
    await expect(svc.setItOwner(await svc.user('u-it-ex2'), 'onboarding', o.id, 'u-it-ex2')).rejects.toThrow(/gives out/);
  });
});

describe('Company secretary (V9)', () => {
  it('needs PWVSB approval with a cited clause before the board acts, then opens a 14-day SSM filing', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const dcos = await svc.user('u-dcos');
    const c = await svc.raiseCorpChange(cm, 'co-sasa', { kind: 'DIRECTOR', title: 'Appoint director X', detail: '' });
    await expect(svc.raiseCorpChange(await svc.user('u-ae-arsh'), 'co-arsh', { kind: 'DIRECTOR', title: 'x', detail: '' })).rejects.toBeInstanceOf(
      AccessDenied,
    );
    await expect(svc.recordCorpBoard(cm, c.id, 'BR/1', '2026-11-01')).rejects.toThrow(/not approved/);
    await expect(svc.decideCorpChange(cm, c.id, 'approve', '', 'cl. 7')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideCorpChange(dcos, c.id, 'approve', '', '')).rejects.toThrow(/clause/);
    await expect(svc.decideCorpChange(await svc.user('u-fauzan'), c.id, 'approve', '', 'cl. 7')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.decideCorpChange(dcos, c.id, 'approve', '', 'Management agreement cl. 7.2')).rejects.toThrow(/reason/);
    await svc.decideCorpChange(dcos, c.id, 'approve', 'Board seat agreed', 'Management agreement cl. 7.2');
    expect((await svc.home(cm)).todo.some((t) => t.tag === 'Company secretary' && t.detail.includes('board resolution'))).toBe(true);
    const done = await svc.recordCorpBoard(cm, c.id, 'BR/1', '2026-11-01');
    const f = (await svc.corpBoard(cm)).filings.find((x) => x.filing.id === done.filingId)!;
    expect(f.filing).toMatchObject({ kind: 'DIRECTOR_CHANGE', dueOn: '2026-11-15', status: 'open' });
  });

  it('keeps a lodged filing awaiting acknowledgement until the SSM receipt is recorded', async () => {
    const { svc } = fresh();
    const ae = await svc.user('u-ae-arsh');
    const dcos = await svc.user('u-dcos');
    const b = await svc.corpBoard(ae);
    expect(b.filings.every((f) => f.filing.companyId === 'co-arsh')).toBe(true);
    const f = b.filings.find((x) => x.filing.status === 'open')!;
    // Head office Corporate Admin records filings (Central Admin 5A, Fauzan 1 Nov 2026); the company only views.
    await expect(svc.corpFilingStep(ae, f.filing.id, 'prepare')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.corpFilingStep(dcos, f.filing.id, 'lodge', {})).rejects.toThrow(/MBRS/);
    await expect(svc.corpFilingStep(dcos, f.filing.id, 'receipt', { ref: 'R1' })).rejects.toThrow(/open/);
    await svc.corpFilingStep(dcos, f.filing.id, 'lodge', { ref: 'MBRS-1' });
    const after = (await svc.corpBoard(ae)).filings.find((x) => x.filing.id === f.filing.id)!;
    expect(after.label).toBe('Awaiting SSM acknowledgement');
    expect(after.tone).not.toBe('ok');
    await svc.corpFilingStep(dcos, f.filing.id, 'receipt', { ref: 'SSM-1' });
    expect((await svc.corpBoard(ae)).filings.find((x) => x.filing.id === f.filing.id)!.tone).toBe('ok');
    const ceo = await svc.corpBoard(await svc.user('u-fauzan'));
    expect(ceo.kpis.overdue).toBeGreaterThan(0);
  });
});

describe('LINDUNG 24 Jam kept apart from SOCSO (Fauzan, 27 Oct 2026)', () => {
  it('charges the employee only, by the wage month, never for an opted-out Malaysian, always for a foreign worker', () => {
    expect(lindungShare(2550, '2026-10', 'NP', true)).toEqual({ ee: 19.15, rate: 0.0075, status: 'deducted' });
    expect(lindungShare(2550, '2026-10', 'MY', true)).toMatchObject({ ee: 0, status: 'opted_out' });
    expect(lindungShare(2550, '2026-05', 'MY', false)).toMatchObject({ ee: 0, status: 'not_started' });
    expect(lindungShare(9000, '2028-06', 'MY', false)).toMatchObject({ ee: 60, rate: 0.01 });
  });

  it('shows LINDUNG in its own payroll column and total, outside normal SOCSO', async () => {
    const { ds } = fresh();
    const run = ds.staffPayRuns.find((r) => r.companyId === 'co-sasa' && r.period === TODAY.slice(0, 7))!;
    const out = run.lines.find((l) => l.lindungStatus === 'opted_out')!;
    const inn = run.lines.find((l) => l.lindungStatus === 'deducted')!;
    expect(out.lindungEe).toBe(0);
    expect(inn.lindungEe).toBeGreaterThan(0);
    expect(inn.deductions).toBeCloseTo(inn.epfEe + inn.socsoEe + inn.lindungEe + inn.eisEe + inn.pcb, 2);
    expect(run.lines.some((l) => l.flags.some((f) => f.includes('LINDUNG')))).toBe(true);
  });
});

describe('PWVSB credit and collateral (V8, V10)', () => {
  it('opens an investigation, never a default, and confirms only with checks and two people, then opens enforcement with steps 7 to 9 off', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-credit');
    const fd = await svc.user('u-fd');
    const b = await svc.creditBoard(officer);
    const c = b.cases.find((x) => x.item.companyId === 'co-arsh' && x.item.stage === 'investigating')!;
    expect(c.waiting).toBe('Credit officer');
    await expect(svc.creditDecide(fd, c.item.id, 'confirm', 'ok')).rejects.toThrow(/Credit officer/);
    await svc.creditDecide(officer, c.item.id, 'confirm', 'ok');
    await expect(svc.creditDecide(officer, c.item.id, 'confirm', 'ok')).rejects.toThrow(/Finance Director/);
    const done = await svc.creditDecide(fd, c.item.id, 'confirm', 'ok');
    expect(done.stage).toBe('confirmed');
    expect(done.enforcement!.steps.filter((s) => s.status === 'off').map((s) => s.no)).toEqual([7, 8, 9]);
    await expect(svc.creditEnforcementStep(officer, done.id, 2, 'x')).rejects.toThrow(/earlier/);
    await svc.creditEnforcementStep(officer, done.id, 1, 'Notice sent');
    // Steps 7 to 9 never run while counsel has not approved the template.
    const inas = (await svc.creditBoard(officer)).cases.find((x) => x.item.companyId === 'co-inas')!;
    for (const no of [3, 4, 5, 6]) await svc.creditEnforcementStep(officer, inas.item.id, no, 'done');
    await expect(svc.creditEnforcementStep(officer, inas.item.id, 7, 'decide')).rejects.toThrow(/switched off/);
  });

  it('blocks a confirmation while a dispute is open, and blocks a rate above the Moneylenders Act cap', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-credit');
    const cm = await svc.user('u-cm-arsh');
    const loan = (await svc.creditBoard(cm)).rows.find((r) => r.overdue.length)!.loan;
    await svc.creditDispute(cm, loan.id, 'raise', 'Paid on 2 Oct, see bank slip');
    const c = (await svc.creditBoard(officer)).cases.find((x) => x.item.loanId === loan.id)!;
    expect(c.ready).toBe(false);
    await expect(svc.creditDecide(officer, c.item.id, 'confirm', 'ok')).rejects.toThrow(/dispute/);
    const input = {
      kind: 'LOAN' as const,
      purpose: 'x',
      secured: false,
      principal: 10_000,
      ratePct: 19,
      startOn: '2026-11-01',
      termMonths: 12,
      agreementRef: 'A1',
      templateId: 'T',
      collateral: 'NONE' as const,
      collateralRef: null,
      chargeCreatedOn: null,
    };
    await expect(svc.addCreditLoan(officer, 'co-sasa', input)).rejects.toThrow(/18%/);
    await expect(svc.addCreditLoan(cm, 'co-arsh', { ...input, ratePct: 8 })).rejects.toBeInstanceOf(AccessDenied);
    const l = await svc.addCreditLoan(officer, 'co-sasa', { ...input, ratePct: 18 });
    expect(l.schedule).toHaveLength(12);
    expect(l.schedule.reduce((n, i) => n + i.amount, 0)).toBeCloseTo(11_800, 1);
    // Another company's manager does not see this company's loans.
    expect((await svc.creditBoard(cm)).rows.every((r) => r.loan.companyId === 'co-arsh')).toBe(true);
  });
});

describe('Procurement and Inventory (V5; Fauzan, 27 Oct 2026)', () => {
  it('needs 3 quotes and an online price check, COO then CEO approval, and keeps the approver off the goods receipt', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ex = await svc.user('u-proc-exec');
    const sk = await svc.user('u-proc-store1');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const fd = await svc.user('u-fd');
    // The company raises what it needs; Procurement sources it.
    const r = await svc.raisePurRequest(cm, 'co-arsh', {
      title: 'Boots',
      category: 'UNIFORM',
      lines: [{ item: 'Safety boots', stockItemId: 'stk-co-arsh-7', qty: 150, unitPrice: 90 }],
    });
    await expect(svc.purStep(cm, r.id, 'quote', { supplierId: 'sup-co-arsh-1', amount: 1, ref: 'Q' })).rejects.toThrow(/cannot quote/);
    await expect(svc.purStep(ex, r.id, 'quote', { supplierId: 'sup-co-arsh-4', amount: 13000, ref: 'Q1' })).rejects.toThrow(/not an approved supplier/);
    await svc.purStep(ex, r.id, 'quote', { supplierId: 'sup-co-arsh-1', amount: 13500, ref: 'Q1' , proof: [proof()] });
    await expect(svc.purStep(ex, r.id, 'submit', { supplierId: 'sup-co-arsh-1' })).rejects.toThrow(/3 quotes/);
    await svc.purStep(ex, r.id, 'quote', { supplierId: 'sup-co-arsh-2', amount: 13200, ref: 'Q2' , proof: [proof()] });
    await svc.purStep(ex, r.id, 'quote', { supplierId: 'sup-co-arsh-3', amount: 14000, ref: 'Q3' , proof: [proof()] });
    await expect(svc.purStep(ex, r.id, 'submit', { supplierId: 'sup-co-arsh-2' })).rejects.toThrow(/online/);
    await svc.purStep(ex, r.id, 'online', { source: 'Shopee', ref: 'listing 1', amount: 11000, proof: [proof()] });
    await expect(svc.purStep(ex, r.id, 'submit', { supplierId: 'sup-co-arsh-2' })).rejects.toThrow(/above the online price/);
    const sub = await svc.purStep(ex, r.id, 'submit', { supplierId: 'sup-co-arsh-2', onlineReason: 'Online seller has no SST invoice or warranty' });
    expect(sub.tiers).toEqual(['coo', 'ceo']);
    await expect(svc.purStep(ceo, r.id, 'approve', { note: 'ok' })).rejects.toThrow(/cannot approve/);
    await svc.purStep(coo, r.id, 'approve', { note: 'ok' });
    expect((await svc.purStep(ceo, r.id, 'approve', { note: 'ok' })).status).toBe('approved');
    await svc.purStep(ex, r.id, 'order', { ref: 'PO-1' });
    await expect(svc.purStep(ex, r.id, 'receive', { qty: [150] })).rejects.toThrow(/cannot receive/);
    const before = (await svc.purBoard(sk)).stock.find((s) => s.item.id === 'stk-co-arsh-7')!.item.onHand;
    await svc.purStep(sk, r.id, 'receive', { qty: [150] });
    const row = (await svc.purBoard(sk)).stock.find((s) => s.item.id === 'stk-co-arsh-7')!;
    expect(row.item.onHand).toBe(before + 150);
    expect(row.life.received).toBeGreaterThanOrEqual(150);
    const bad = await svc.purStep(fd, r.id, 'invoice', { number: 'INV-1', amount: 13200 });
    expect(bad.match!.ok).toBe(false);
    await expect(svc.purStep(fd, r.id, 'post', { sqlRef: 'PI-1' })).rejects.toThrow(/three-way match/);
    const good = await svc.purStep(fd, r.id, 'invoice', { number: 'INV-1', amount: 13200, eInvoiceUuid: 'UUID1' });
    expect(good.match!.ok).toBe(true);
    expect((await svc.purStep(fd, r.id, 'post', { sqlRef: 'PI-1' })).status).toBe('posted');
  });

  it('issues items that the person confirms in their own details, never charges them, and lists items held by leavers', async () => {
    const { svc, ds } = fresh();
    const sk = await svc.user('u-proc-store2');
    const b = await svc.purBoard(sk);
    expect(b.toCollect.length).toBeGreaterThan(0);
    const staff = ds.users.find((u) => u.personId && ds.people.find((p) => p.id === u.personId && p.companyId === 'co-arsh' && p.status === 'active'))!;
    await expect(svc.stockIssue(await svc.user('u-ae-arsh'), 'co-arsh', { itemId: 'stk-co-arsh-8', personId: staff.personId!, qty: 1 })).rejects.toThrow(
      /storekeepers/,
    );
    const i = await svc.stockIssue(sk, 'co-arsh', { itemId: 'stk-co-arsh-12', personId: staff.personId!, qty: 1, serial: 'BC-0091' });
    expect(i.acknowledged).toBe(false);
    const mine = await svc.myItems(staff);
    expect(mine.items.find((x) => x.issue.id === i.id)!.itemName).toMatch(/Body camera/);
    await expect(svc.confirmMyItem(await svc.user('u-cm-sasa'), i.id, true)).rejects.toThrow();
    await expect(svc.confirmMyItem(staff, i.id, false)).rejects.toThrow(/what is wrong/);
    expect((await svc.confirmMyItem(staff, i.id, true)).acknowledged).toBe(true);
    await expect(svc.stockReturn(sk, i.id, 'lost', '')).rejects.toThrow(/Nothing is charged/);
    expect((await svc.stockReturn(sk, i.id, 'lost', 'Left on the bus')).returned!.condition).toBe('lost');
    const sasa = await svc.purBoard(await svc.user('u-cm-sasa'));
    expect(sasa.requests.every((r) => r.req.companyId === 'co-sasa')).toBe(true);
  });
});

describe('Governance and authority (V7, V8, V12)', () => {
  it('gives PWVSB power to act only under a mandate the company confirmed and legal verified', async () => {
    const { svc } = fresh();
    const legal = await svc.user('u-legal');
    const cos = await svc.user('u-cos');
    const cm = await svc.user('u-cm-inas');
    let b = await svc.govBoard(legal);
    const inas = () => b.coverage.find((c) => c.companyId === 'co-inas')!;
    expect(inas().liveMandates).toBe(0);
    expect(inas().areas.every((a) => a.status === 'unknown')).toBe(true);
    await expect(svc.govMandateStep(legal, 'gm-co-inas-1', 'verify', {})).rejects.toThrow(/reason/);
    await svc.govMandateStep(legal, 'gm-co-inas-1', 'verify', { note: 'Signed copy matches' });
    b = await svc.govBoard(legal);
    expect(inas().areas.find((a) => a.area === 'OPERATIONS')!.status).toBe('act');
    expect(inas().areas.find((a) => a.area === 'ARMS')!.status).toBe('unknown');
    // A new mandate needs the company's board first, and someone other than the registrar verifies it.
    const m = await svc.addGovMandate(legal, 'co-inas', {
      kind: 'BOARD_MANDATE',
      ref: 'BM-1',
      title: 'Arms coordination',
      signedOn: '2026-10-20',
      validFrom: '2026-10-21',
      validTo: null,
      powers: [{ area: 'ARMS', scope: 'monitor', limit: null }],
    });
    await expect(svc.govMandateStep(legal, m.id, 'verify', { note: 'ok' })).rejects.toThrow(/not confirmed/);
    await expect(svc.govMandateStep(cm, m.id, 'confirm', {})).rejects.toThrow(/resolution/);
    await svc.govMandateStep(cm, m.id, 'confirm', { resolutionRef: 'BR/INAS/2026/07' });
    await expect(svc.govMandateStep(legal, m.id, 'verify', { note: 'x' })).rejects.toThrow(/other than/);
    await expect(svc.govMandateStep(cos, m.id, 'verify', {})).rejects.toThrow();
  });

  it('flags mandates ending within 60 days and acting grants that rest on no live mandate', async () => {
    const { svc } = fresh();
    const b = await svc.govBoard(await svc.user('u-fauzan'));
    expect(b.rows.find((r) => r.mandate.id === 'gm-co-arsh-1')!.state).toBe('expiring');
    expect(b.kpis.expired).toBeGreaterThan(0);
    expect(b.coverage.filter((c) => !c.liveMandates).length).toBeGreaterThan(0);
    // A company manager sees only their own company.
    const own = await svc.govBoard(await svc.user('u-cm-sasa'));
    expect(own.coverage.map((c) => c.companyId)).toEqual(['co-sasa']);
  });
});

describe('Test data', () => {
  it('gives every row a unique id within its table', () => {
    const ds = generateDataset({ today: TODAY, now: NOW }) as unknown as Record<string, { id?: string }[]>;
    for (const [table, rows] of Object.entries(ds)) {
      if (!Array.isArray(rows) || !rows.length || rows[0]?.id === undefined) continue;
      const ids = rows.map((r) => r.id);
      expect(new Set(ids).size, table).toBe(ids.length);
    }
  });
});

describe('Assurance: obligations, whistleblowing and gifts (V15)', () => {
  it('shows an obligation with no proof as unknown, and needs a different person to check the proof', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const auditor = await svc.user('u-audit');
    const b = await svc.grcBoard(cm);
    expect(b.obligations.some((o) => o.state === 'unknown')).toBe(true);
    expect(b.obligations.filter((o) => !o.item.evidence).every((o) => o.state === 'unknown')).toBe(true);
    const o = b.obligations.find((x) => x.state === 'unknown')!;
    const done = await svc.grcEvidence(cm, o.item.id, '2026-10-20', 'Minutes ref 12');
    expect(done.checked).toBeNull();
    let after = (await svc.grcBoard(cm)).obligations.find((x) => x.item.id === o.item.id)!;
    expect(after.state).not.toBe('ok');
    await expect(svc.grcCheck(cm, o.item.id, true, 'ok')).rejects.toThrow(/internal audit/);
    await expect(svc.grcCheck(auditor, o.item.id, false, '')).rejects.toThrow(/what is wrong/);
    await svc.grcCheck(auditor, o.item.id, true, 'ok');
    after = (await svc.grcBoard(cm)).obligations.find((x) => x.item.id === o.item.id)!;
    expect(['ok', 'due_soon']).toContain(after.state);
  });

  it('never routes a report to someone it names, keeps anonymous reporters unknown, and never approves cash gifts', async () => {
    const { svc } = fresh();
    const guardUser = await svc.user('u-ae-arsh');
    const res = await svc.submitWhistle(guardUser, {
      anonymous: true,
      companyId: 'co-arsh',
      category: 'BRIBERY',
      summary: 'The internal audit head asked a supplier for money in return for passing their review last month.',
      implicatedUserIds: ['u-audit'],
    });
    expect(res.handledBy).not.toMatch(/Internal Audit/);
    const chair = await svc.user('u-chair');
    const handled = (await svc.grcBoard(chair)).handled.find((h) => h.report.code === res.code)!;
    expect(handled.report.reporterId).toBeNull();
    expect((await svc.grcBoard(await svc.user('u-audit'))).handled.some((h) => h.report.code === res.code)).toBe(false);
    expect((await svc.whistleStatus(res.code)).status).toBe('received');
    const cos = await svc.user('u-cos');
    await expect(svc.decideGift(cos, 'gift-3', 'approved', 'ok')).rejects.toThrow(/Cash/);
    expect((await svc.decideGift(cos, 'gift-3', 'return', 'Returned with a letter')).decision!.outcome).toBe('return');
  });
});

describe('PDPA rights: DPO register and data requests', () => {
  it('shows companies with no DPO as unknown, flags late Commissioner notice, and answers requests only after identity checks', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-pdpa');
    const b = await svc.pdpaRights(officer);
    expect(b.dpos.find((d) => d.companyId === 'co-arsh')!.state).toBe('notify_late');
    expect(b.dpos.find((d) => d.companyId === 'co-inas')!.state).toBe('to_notify');
    expect(b.counts.noDpo).toBeGreaterThan(0);
    expect(b.requests.find((r) => r.request.id === 'dsr-1')!.late).toBe(true);
    await expect(svc.pdpaRequestStep(officer, 'dsr-2', 'done', 'Corrected')).rejects.toThrow(/Verify/);
    await expect(svc.pdpaRequestStep(officer, 'dsr-2', 'refuse', 'Too busy')).rejects.toThrow(/grounds/);
    await svc.pdpaRequestStep(officer, 'dsr-2', 'verify', 'ok');
    expect((await svc.pdpaRequestStep(officer, 'dsr-2', 'done', 'IC corrected in HR and payroll')).status).toBe('done');
    await expect(svc.pdpaRights(await svc.user('u-cm-sasa'))).rejects.toThrow();
  });
});

describe('Business continuity', () => {
  it('shows a copy with no backup or restore test as unknown, a copy outside Malaysia as red, and lets only IT record', async () => {
    const { svc } = fresh();
    const it = await svc.user('u-it-lead');
    const b = await svc.bcmBoard(await svc.user('u-fauzan'));
    const prima = b.systems.find((s) => s.system.id === 'bcm-prima')!;
    expect(prima.copies[2].state).toBe('unknown');
    expect(prima.state).toBe('unknown');
    expect(b.systems.find((s) => s.system.id === 'bcm-sql')!.copies[1].problems).toContain('Data held outside Malaysia');
    await expect(svc.bcmRecord(await svc.user('u-coo'), 'bcm-prima', 2, 'backup', {})).rejects.toThrow(/IT records/);
    await svc.bcmRecord(it, 'bcm-prima', 2, 'backup', {});
    await expect(svc.bcmRecord(it, 'bcm-prima', 2, 'restore', { on: '2026-10-26', ok: false, hours: 3, dataLossMinutes: 10 })).rejects.toThrow(/what failed/);
    await svc.bcmRecord(it, 'bcm-prima', 2, 'restore', { on: '2026-10-26', ok: true, hours: 3, dataLossMinutes: 10 });
    const after = (await svc.bcmBoard(it)).systems.find((s) => s.system.id === 'bcm-prima')!;
    expect(after.copies[2].state).toBe('ok');
  });
});

describe('Statutory audit and legal matters (V9)', () => {
  it('signs an audit only after every document is handed over and every adjustment agreed', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ae = await svc.user('u-ae-arsh');
    const a = (await svc.corpAuditLegal(cm)).audits.find((x) => !x.audit.signed)!;
    expect(a.stage).not.toBe('to_sign');
    await expect(svc.corpAuditStep(cm, a.audit.id, 'signed', { on: '2026-10-26', opinion: 'unmodified', ref: 'AR1' })).rejects.toThrow(/Hand over/);
    if (!a.audit.planningOn) await svc.corpAuditStep(ae, a.audit.id, 'planning', { on: '2026-10-20' });
    for (const [i, p] of a.audit.pbc.entries()) if (!p.receivedOn) await svc.corpAuditStep(ae, a.audit.id, 'pbc_received', { index: i, on: '2026-10-25' });
    await svc.corpAuditStep(ae, a.audit.id, 'add_adjustment', { desc: 'Bonus accrual', amount: 5000 });
    const adj = (await svc.corpAuditLegal(cm)).audits.find((x) => x.audit.id === a.audit.id)!.audit.adjustments;
    await expect(svc.corpAuditStep(ae, a.audit.id, 'agree_adjustment', { index: adj.length - 1 })).rejects.toThrow(/company manager/);
    for (const [i, x] of adj.entries()) if (!x.agreedBy) await svc.corpAuditStep(cm, a.audit.id, 'agree_adjustment', { index: i });
    const done = await svc.corpAuditStep(cm, a.audit.id, 'signed', { on: '2026-10-26', opinion: 'unmodified', ref: 'AR1' });
    expect(done.signed!.opinion).toBe('unmodified');
  });

  it('keeps legal matters to the company and PWVSB legal, and flags a missed date', async () => {
    const { svc } = fresh();
    const legal = await svc.user('u-legal');
    const b = await svc.corpAuditLegal(legal);
    expect(b.matters.find((m) => m.matter.id === 'lm-co-sasa-2')!.missed).toBe(true);
    const arsh = await svc.corpAuditLegal(await svc.user('u-cm-arsh'));
    expect(arsh.matters.every((m) => m.matter.companyId === 'co-arsh')).toBe(true);
    await expect(svc.legalMatterStep(await svc.user('u-ae-arsh'), 'lm-co-arsh-1', 'update', { text: 'x' })).rejects.toThrow();
    const m = await svc.legalMatterStep(legal, 'lm-co-sasa-2', 'update', { text: 'Reply sent', nextOn: '2026-11-20', nextWhat: 'Payment deadline' });
    expect(m.nextDate!.on).toBe('2026-11-20');
  });
});

describe('Sales leads before quoting (V3 CRM)', () => {
  it('shows a lead another group company is chasing as a conflict', async () => {
    const { svc } = fresh();
    const b = await svc.salesLeads(await svc.user('u-cm-arsh'), 'co-arsh');
    const r = b.leads.find((x) => x.lead.id === 'lead-co-arsh-1')!;
    expect(r.conflicts.length).toBe(1);
    expect(b.leads.find((x) => x.lead.id === 'lead-co-arsh-2')!.open).toBe(false);
    await expect(svc.salesLeads(await svc.user('u-cm-arsh'), 'co-sasa')).rejects.toThrow();
  });

  it('needs research, a survey and the manager accepting a slow payer before the quotation, and won only on acceptance', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const id = 'lead-co-sasa-2';
    await svc.salesLeadStep(cm, id, 'survey', { on: '2026-10-26', guardsNeeded: 10, hoursPerDay: 12 });
    const b = await svc.salesLeads(cm, 'co-sasa');
    const q = b.quotations.find((x) => x.status !== 'accepted')!;
    await expect(svc.salesLeadStep(cm, id, 'quotation', { quotationId: q.id })).rejects.toThrow(/accept the risk/);
    await expect(svc.salesLeadStep(cm, id, 'accept_risk', {})).rejects.toThrow(/why/);
    await svc.salesLeadStep(cm, id, 'accept_risk', { text: 'One month deposit' });
    const l = await svc.salesLeadStep(cm, id, 'quotation', { quotationId: q.id });
    expect(l.stage).toBe('proposal');
    await expect(svc.salesLeadStep(cm, id, 'won', {})).rejects.toThrow(/accepted/);
    const lost = await svc.salesLeadStep(cm, id, 'lost', { text: 'Client chose a cheaper provider' });
    expect(lost.closed!.reason).toMatch(/cheaper/);
    await expect(svc.salesLeadStep(cm, 'lead-co-sasa-1', 'survey', { on: '2026-10-26', guardsNeeded: 4 })).rejects.toThrow(/Research/);
  });
});

describe('Fixed assets: depreciation and disposal (V5)', () => {
  it('depreciates straight line from the month after purchase and stops at disposal', () => {
    const a = { category: 'FURNITURE', cost: 1200, boughtOn: '2026-01-15', disposal: null } as unknown as AmAsset;
    expect(accumulatedDepn(a, '2026-01')).toBe(0);
    expect(monthDepn(a, '2026-02')).toBe(10);
    expect(accumulatedDepn(a, '2026-12')).toBe(110);
    expect(accumulatedDepn(a, '2040-01')).toBe(1200);
    const d = { ...a, disposal: { done: { on: '2026-06-10' } } } as unknown as AmAsset;
    expect(monthDepn(d, '2026-08')).toBe(0);
  });

  it('lets only Finance record the SQL journal, and routes a disposal by book value', async () => {
    const { svc, ds } = fresh();
    const team = await svc.user('u-asset-mm');
    const fd = await svc.user('u-fd');
    const b = await svc.fixedAssets(fd);
    const due = b.entities.flatMap((e) => e.months.filter((m) => !m.posting && m.amount > 0).map((m) => ({ e: e.ownerEntity, p: m.period })))[0];
    expect(due).toBeTruthy();
    await expect(svc.postDepreciation(team, due.e, due.p, 'JV1')).rejects.toThrow();
    await svc.postDepreciation(fd, due.e, due.p, 'JV1');
    await expect(svc.postDepreciation(fd, due.e, due.p, 'JV2')).rejects.toThrow(/already/);
    const asset = ds.amAssets.find((x) => x.status === 'in_use' && x.cost < 1000 && x.boughtOn > addDays(TODAY, -3000))!;
    await expect(svc.amDisposalStep(fd, asset.id, 'ask', { reason: 'x', method: 'SCRAP', estProceeds: 0 })).rejects.toThrow();
    await svc.amDisposalStep(team, asset.id, 'ask', { reason: 'Broken', method: 'SCRAP', estProceeds: 0 });
    await expect(svc.amDisposalStep(await svc.user('u-coo'), asset.id, 'approve', {})).rejects.toThrow(/Finance Director/);
    await svc.amDisposalStep(fd, asset.id, 'approve', { note: 'ok' });
    const done = await svc.amDisposalStep(team, asset.id, 'done', { on: '2026-10-26', proceeds: 0, party: 'Scrap dealer', proofRef: 'SN1' });
    expect(done.status).toBe('disposed');
    const posted = await svc.amDisposalStep(fd, asset.id, 'post', { sqlRef: 'JV-D1' });
    expect(posted.disposal!.sqlRef).toBe('JV-D1');
  });

  it('keeps a written-off asset that still works in use or refurbishes it, never disposes of it while good (Fauzan, 27 Oct 2026)', async () => {
    const { svc, ds } = fresh();
    const team = await svc.user('u-asset-mm');
    const b = await svc.fixedAssets(team);
    expect(b.endOfLife.length).toBeGreaterThan(10);
    expect(b.endOfLife.some((x) => x.state === 'rehab')).toBe(true);
    const row = b.endOfLife.find((x) => x.state === 'to_review')!;
    ds.amAssets.find((a) => a.id === row.asset.id)!.condition = 'good';
    await expect(svc.amDisposalStep(team, row.asset.id, 'ask', { reason: 'Old', method: 'SCRAP', estProceeds: 0 })).rejects.toThrow(
      /keep using it or refurbish/,
    );
    await expect(svc.amLifeReview(team, row.asset.id, 'rehab', { note: 'New top', cost: 0 })).rejects.toThrow(/cost/);
    await expect(svc.amLifeReview(await svc.user('u-fd'), row.asset.id, 'keep', { note: 'Fine' })).rejects.toThrow();
    const kept = await svc.amLifeReview(team, row.asset.id, 'rehab', { note: 'New top and legs', cost: 220 });
    expect(kept.lifeReviews!.at(-1)).toMatchObject({ decision: 'rehab', cost: 220 });
    expect((await svc.fixedAssets(team)).endOfLife.find((x) => x.asset.id === row.asset.id)!.state).toBe('rehab');
  });
});

describe('Rent paid and unpaid (Fauzan, 27 Oct 2026)', () => {
  it('records rent against the oldest month, banks cash through Finance, and sends letters to the Asset Director', async () => {
    const { svc, ds } = fresh();
    const re = await svc.user('u-asset-re1');
    const b = await svc.amBoard(re);
    expect(b.can.record).toBe(true);
    // Monthly paid / not paid list: every let unit has its months.
    const letUnit = b.units.find((u) => u.tenant)!;
    expect(letUnit.months.length).toBeGreaterThan(0);
    expect(letUnit.months.every((m) => m.paid <= m.amount)).toBe(true);
    expect(b.lettersToApprove.length).toBe(1);
    expect(b.kpis.brokenPromises).toBe(1);
    const a = b.arrears.find((x) => !x.internal && x.owed > 0 && !ds.amUnits.find((u) => u.id === x.id)!.tenancy!.payments)!;
    await expect(svc.amRecordPayment(await svc.user('u-fd'), a.id, { amount: 10, method: 'CASH', on: TODAY, receiptNo: 'OR-1' })).rejects.toThrow();
    await expect(svc.amRecordPayment(re, a.id, { amount: a.due + 1, method: 'CASH', on: TODAY, receiptNo: 'OR-1' })).rejects.toThrow(/more than/);
    const paid = await svc.amRecordPayment(re, a.id, { amount: 10, method: 'CASH', on: TODAY, receiptNo: 'OR-1' });
    const pay = paid.tenancy!.payments!.at(-1)!;
    expect(pay.applied[0].period).toBe(a.owedSince);
    // Prima numbers the receipt; a typed number is ignored (insider abuse audit, 27 Oct 2026).
    expect(pay.receiptNo).toMatch(/^OR-.+-0001$/);
    await expect(svc.amBankCash(re, a.id, pay.id, { on: TODAY, slipRef: 'S1' })).rejects.toThrow();
    const banked = await svc.amBankCash(await svc.user('u-finance-am'), a.id, pay.id, { on: TODAY, slipRef: 'S1' });
    expect(banked.tenancy!.payments!.at(-1)!.banked!.slipRef).toBe('S1');
    await expect(svc.amReversePayment(re, a.id, pay.id, 'Wrong tenant')).rejects.toThrow(/in the bank/);
    const two = await svc.amRecordPayment(re, a.id, { amount: 5, method: 'TRANSFER', on: TODAY, ref: 'IBG1' });
    const twoPay = two.tenancy!.payments!.at(-1)!;
    expect(twoPay.receiptNo).toMatch(/-0002$/);
    // The team only asks; the Asset Director reverses (insider abuse audit, 27 Oct 2026).
    const askedBack = await svc.amReversePayment(re, a.id, twoPay.id, 'Wrong amount');
    expect(askedBack.tenancy!.invoices.reduce((n, i) => n + i.paid, 0)).toBe(two.tenancy!.invoices.reduce((n, i) => n + i.paid, 0));
    await expect(svc.amDecideReversal(re, a.id, twoPay.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const dir = await svc.user('u-asset-dir');
    expect((await svc.amBoard(dir)).reversalsToApprove.some((p) => p.id === twoPay.id)).toBe(true);
    const back = await svc.amDecideReversal(dir, a.id, twoPay.id, true, 'Checked with the tenant');
    expect(back.tenancy!.invoices.reduce((n, i) => n + i.paid, 0)).toBe(paid.tenancy!.invoices.reduce((n, i) => n + i.paid, 0));
    // The next receipt never reuses a number.
    const three = await svc.amRecordPayment(re, a.id, { amount: 5, method: 'TRANSFER', on: TODAY, ref: 'IBG2' });
    expect(three.tenancy!.payments!.at(-1)!.receiptNo).toMatch(/-0003$/);
    // Every payment, not only cash, waits for Finance to see it in the bank.
    expect((await svc.amBoard(re)).cashToBank.some((p) => p.receiptNo.endsWith('-0003'))).toBe(true);
    await svc.amBankCash(await svc.user('u-finance-am'), a.id, three.tenancy!.payments!.at(-1)!.id, { on: TODAY, slipRef: 'STMT-27' });
    expect((await svc.amBoard(re)).cashToBank.some((p) => p.receiptNo.endsWith('-0003'))).toBe(false);
    const asked = await svc.amFollowUp(re, a.id, { action: 'LETTER', note: 'First reminder' });
    const f = asked.tenancy!.followUps!.at(-1)!;
    await expect(svc.amDecideLetter(re, a.id, f.id, true, 'ok')).rejects.toThrow();
    const ok = await svc.amDecideLetter(await svc.user('u-asset-dir'), a.id, f.id, true, 'ok');
    expect(ok.tenancy!.followUps!.at(-1)!.approval!.approve).toBe(true);

    // Every 10 days until paid: an unpaid unit not updated for 10 days shows as due; an email follow-up clears it.
    const b2 = await svc.amBoard(re);
    expect(b2.kpis.updatesDue).toBe(b2.units.filter((u) => u.update?.due).length);
    expect((await svc.amBoard(await svc.user('u-asset-dir'))).lateUpdates.length).toBe(b2.kpis.updatesDue);
    const late = b2.units.find((u) => u.update?.due)!;
    expect(late.update!.nextOn <= TODAY).toBe(true);
    await svc.amFollowUp(re, late.id, { action: 'EMAIL', note: 'Reminder emailed' });
    const after = (await svc.amBoard(re)).units.find((u) => u.id === late.id)!;
    expect(after.update!.due).toBe(false);
    expect(after.update!.nextOn).toBe(addDays(TODAY, 10));
    expect(b2.units.find((u) => u.tenant && !u.update)!.months.every((m) => m.paid >= m.amount || m.period > TODAY.slice(0, 7))).toBe(true);
    await expect(
      svc.saveRecord(re, 'amTenancy', late.id, null, { ...(await svc.recordForm(re, 'amTenancy', late.id, null)).values, tenantPhone: 'call me' }),
    ).rejects.toThrow(/phone/);
  });
});

describe('Staff clock from sign-in to sign-out (Fauzan, 27 Oct 2026)', () => {
  it('clocks in at sign-in, keeps one clock per day, and clocks out at sign-out', async () => {
    const { svc } = fresh();
    const u = await svc.user('u-cm-arsh');
    await svc.staffSessionEnd(u);
    const a = await svc.staffSessionStart(u);
    expect(a!.mode).toBe('login');
    const b = await svc.staffSessionStart(u);
    expect(b!.id).toBe(a!.id);
    const out = await svc.staffSessionEnd(u);
    expect(out!.out!.source).toBe('login');
    expect((await svc.myStaffClock(u)).open).toBeNull();
  });

  it('closes a clock left open from an earlier day at the end of that day, flagged for HR', async () => {
    const { svc, store } = fresh();
    const u = await svc.user('u-cm-arsh');
    await svc.staffSessionEnd(u);
    const old = (await svc.staffSessionStart(u))!;
    await store.update('staffClocks', old.id, { in: { ...old.in, receivedAt: '2026-10-25T09:00:00+08:00' } });
    const fresh2 = (await svc.staffSessionStart(u))!;
    expect(fresh2.id).not.toBe(old.id);
    const closed = (await store.get('staffClocks', old.id))!;
    expect(closed.flags).toContain('NO_SIGN_OUT');
    expect(closed.out!.receivedAt.slice(0, 16)).toBe('2026-10-25T23:59');
  });

  it('closes a clock never signed out at the last office door exit (Fauzan, 27 Oct 2026)', async () => {
    const { svc, store } = fresh();
    const u = await svc.user('u-proc-exec');
    const before = (await store.list('staffClocks', { userId: u.id })).find((c) => !c.out)!;
    expect(before.in.receivedAt.slice(0, 10)).toBe(addDays(TODAY, -1));
    await svc.staffSessionStart(u);
    const closed = (await store.get('staffClocks', before.id))!;
    expect(closed.flags).toContain('NO_SIGN_OUT');
    expect(closed.out!.source).toBe('door');
    expect(closed.out!.receivedAt).toBe(myt(addDays(TODAY, -1), '17:52'));
  });

  it('flags signing out long after the door shows the person left, and shows them to HR as left but signed in', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const board = await svc.staffClockBoard(await svc.user('u-pwvsb-hr'));
    expect(board.leftStillSignedIn).toBeGreaterThanOrEqual(1);
    expect(board.rows.find((r) => r.userId === cm.id)!.door.left).toBe(true);
    const out = await svc.staffSessionEnd(cm);
    expect(out!.flags).toContain('LEFT_BEFORE_SIGN_OUT');
    await expect(svc.doorIngest(cm, [])).rejects.toThrow();
    const res = await svc.doorIngest(await svc.user('u-door-sync'), [
      { userId: cm.id, at: myt(TODAY, '09:00'), direction: 'in' },
      { userId: 'nobody', at: 'x', direction: 'sideways' },
    ]);
    expect(res).toEqual({ accepted: 1, rejected: [{ index: 1, reason: 'needs userId, at and direction in or out' }] });
  });

  it('does not clock guards from sign-in', async () => {
    const { svc, ds } = fresh();
    const g = ds.users.find((x) => x.role === 'guard')!;
    expect(await svc.staffSessionStart(g)).toBeNull();
  });
});

describe('ACT: Audit, Compliance and Transformation (Fauzan, 27 Oct 2026)', () => {
  it('has 1 Director and 2 teams of 1 Auditor and 1 Enforcement officer, watching every company (Fauzan, 2 Nov 2026)', async () => {
    const { svc, ds } = fresh();
    const act = ds.users.filter((u) => u.department === 'audit');
    // C6 (Fauzan, 11 Nov 2026): plus the ACT Manager, who leads the work and gives the second check.
    expect(act.map((u) => `${u.actRole}${u.actTeam ?? ''}`).sort()).toEqual(['auditor1', 'auditor2', 'enforcement1', 'enforcement2', 'lead', 'manager']);
    const b = await svc.actBoard(await svc.user('u-act-enf2'));
    expect(b.job).toBe('enforcement');
    expect(b.myTeam).toBe(2);
    expect(b.structure!.teams.map((t) => [t.auditor?.id, t.enforcement?.id])).toEqual([
      ['u-act-aud1', 'u-act-enf1'],
      ['u-act-aud2', 'u-act-enf2'],
    ]);
    expect(b.structure!.director?.id).toBe('u-audit');
    // Both teams cover every workflow (Fauzan, 2 Nov 2026): no workflow is tied to a team.
    expect(b.rule.areas.every((a) => !('team' in a))).toBe(true);
    expect(b.signals.length).toBeGreaterThan(15);
    for (const s of b.signals) expect(b.rule.areas.some((a) => a.id === s.area)).toBe(true);
    expect(b.plan.find((p) => p.area.id === 'ROSTER')!.state).toBe('never');
    // C6: each team sees its own work; act-f-1 is Team 1's, so Team 2 does not see it and the Director does.
    expect(b.findings.some((f) => f.finding.id === 'act-f-1')).toBe(false);
    expect((await svc.actBoard(await svc.user('u-audit'))).findings.find((f) => f.finding.id === 'act-f-1')!.escalatedTo).toBe('Chief of Staff');
    expect(b.canCheck).toBe(false);
    expect((await svc.actBoard(await svc.user('u-act-aud1'))).canCheck).toBe(true);
  });

  it('lets the owner plan and fix, the Auditor give the first check, and a second checker close a high finding (C6)', async () => {
    const { svc } = fresh();
    const aud = await svc.user('u-act-aud1');
    const enf = await svc.user('u-act-enf1');
    const cm = await svc.user('u-cm-arsh');
    const f = await svc.raiseActFinding(enf, {
      companyId: 'co-arsh',
      area: 'ARMS',
      source: 'workflow_audit',
      title: 'Vault key log not signed',
      detail: '',
      severity: 'high',
      evidence: 'Log pages 4-6 (spot check)',
      ownerUserId: cm.id,
    });
    expect(f.team).toBe(1); // the raiser's team keeps it
    await expect(svc.actFindingStep(await svc.user('u-cm-sasa'), f.id, 'plan', { rootCause: 'x', solution: 'y', targetOn: '2026-11-01' })).rejects.toThrow();
    await expect(svc.actFindingStep(cm, f.id, 'fixed', { proof: 'p' })).rejects.toThrow(/cause/);
    await svc.actFindingStep(cm, f.id, 'plan', { rootCause: 'No second signer', solution: 'Two signatures per opening', targetOn: '2026-11-01' });
    await svc.actFindingStep(cm, f.id, 'fixed', { proof: 'Log with two signatures since 1 Nov' });
    await expect(svc.actFindingStep(enf, f.id, 'check', { ok: true, note: 'Seen' })).rejects.toThrow(/Only an ACT Auditor, the ACT Manager or the ACT Director can check a fix/);
    const failed = await svc.actFindingStep(aud, f.id, 'check', { ok: false, note: 'One opening unsigned' });
    expect(failed.status).toBe('planned');
    await svc.actFindingStep(cm, f.id, 'fixed', { proof: 'Corrected' });
    // C6 (Fauzan, 11 Nov 2026): the Auditor's check is the first check; a high finding waits for the second check.
    const first = await svc.actFindingStep(aud, f.id, 'check', { ok: true, note: 'Seen' });
    expect(first.status).toBe('fixed');
    await expect(svc.actFindingStep(aud, f.id, 'check', { ok: true, note: 'Seen again' })).rejects.toThrow(/ACT Manager gives the second check/);
    const closed = await svc.actFindingStep(await svc.user('u-audit'), f.id, 'check', { ok: true, note: 'Seen' });
    expect(closed.status).toBe('closed');
    const mine = await svc.actBoard(cm);
    expect(mine.findings.every((r) => r.finding.ownerUserId === cm.id)).toBe(true);
    await expect(svc.actBoard(await svc.user('u-cm-inas').then((u) => ({ ...u, id: 'nobody' })))).rejects.toThrow();
  });

  it('raises a finding from a monitor signal with server-filled evidence, once', async () => {
    const { svc } = fresh();
    const aud = await svc.user('u-act-aud2');
    const b = await svc.actBoard(aud);
    const s = b.signals.find((x) => x.count > 0 && !x.coveredBy.length)!;
    expect(s).toBeTruthy();
    const f = await svc.raiseActFinding(aud, {
      companyId: null,
      area: 'IT', // ignored: the signal decides the workflow
      source: 'manual',
      title: s.label,
      detail: '',
      severity: 'medium',
      evidence: '',
      ownerUserId: 'u-cos',
      signalKey: s.key,
    });
    expect(f.area).toBe(s.area);
    expect(f.source).toBe('monitor');
    expect(f.evidence).toContain(`${s.count} ×`);
    expect(f.team).toBe(2);
    // The Director's own findings wait for the Director to give them to a team; only the Director can.
    const dir = await svc.user('u-audit');
    const d = await svc.raiseActFinding(dir, { companyId: null, area: 'IT', source: 'manual', title: 'Backup test missing', detail: '', severity: 'low', evidence: 'No restore test record', ownerUserId: 'u-cos' });
    expect(d.team).toBeNull();
    expect((await svc.actBoard(dir)).kpis.toAssign).toBeGreaterThan(0);
    await expect(svc.actFindingStep(aud, d.id, 'assign', { team: 1 })).rejects.toThrow(/Director/);
    expect((await svc.actFindingStep(dir, d.id, 'assign', { team: 1 })).team).toBe(1);
    await expect(
      svc.raiseActFinding(aud, { companyId: null, area: s.area, source: 'monitor', title: 'again', detail: '', severity: 'low', evidence: '', ownerUserId: 'u-cos', signalKey: s.key }),
    ).rejects.toThrow(/already covers/);
    const after = await svc.actBoard(aud);
    expect(after.signals.find((x) => x.key === s.key)!.coveredBy).toEqual([f.ref]);
    await expect(
      svc.raiseActFinding(aud, { companyId: null, area: 'IT', source: 'monitor', title: 'x', detail: '', severity: 'low', evidence: '', ownerUserId: 'u-cos', signalKey: 'nope' }),
    ).rejects.toThrow(/Unknown monitor signal/);
    await expect(
      svc.raiseActFinding(await svc.user('u-cm-arsh'), { companyId: null, area: 'IT', source: 'manual', title: 'x', detail: '', severity: 'low', evidence: 'e', ownerUserId: 'u-cos' }),
    ).rejects.toThrow();
  });

  it('queues follow-ups for Enforcement when an owner is late, and records each chase', async () => {
    const { svc, store } = fresh();
    const enf = await svc.user('u-act-enf1');
    const f = await svc.raiseActFinding(await svc.user('u-act-aud1'), {
      companyId: 'co-sasa',
      area: 'ATTENDANCE',
      source: 'workflow_audit',
      title: 'Late sign-outs not explained',
      detail: '',
      severity: 'low',
      evidence: 'Sample of 20 days',
      ownerUserId: 'u-cm-sasa',
    });
    // Not yet: the owner has the plan window.
    expect((await svc.actBoard(enf)).findings.find((r) => r.finding.id === f.id)!.followUp).toBeNull();
    await store.update('actFindings', f.id, { raisedAt: '2026-10-01T02:00:00.000Z', dueOn: '2026-10-20' });
    const row = (await svc.actBoard(enf)).findings.find((r) => r.finding.id === f.id)!;
    expect(row.followUp).toBe('overdue');
    // ACT staff have no general home board; their to-do list comes from the ACT feed.
    const todo = await (svc as unknown as { actHome: (u: typeof enf) => Promise<{ detail: string }[]> }).actHome(enf);
    expect(todo.some((i) => i.detail.includes('follow up'))).toBe(true);
    await expect(svc.actFindingStep(enf, f.id, 'follow_up', { method: 'fax', note: 'x' })).rejects.toThrow(/how you followed up/);
    await expect(svc.actFindingStep(await svc.user('u-cm-sasa'), f.id, 'follow_up', { method: 'call', note: 'x' })).rejects.toThrow();
    const done = await svc.actFindingStep(enf, f.id, 'follow_up', { method: 'visit', note: 'OM promised plan by Friday', nextOn: '2026-12-01' });
    expect(done.followUps).toHaveLength(1);
    expect((await svc.actBoard(enf)).findings.find((r) => r.finding.id === f.id)!.followUp).toBeNull();
    // The owner never sees ACT's chase log.
    expect((await svc.actBoard(await svc.user('u-cm-sasa'))).findings.find((r) => r.finding.id === f.id)!.finding.followUps).toBeUndefined();
    // Enforcement does not record workflow audits; the Auditor does.
    await expect(svc.recordActAudit(enf, { area: 'ATTENDANCE', companyId: null, doneOn: '2026-11-01', result: 'clean', note: 'x' })).rejects.toThrow();
  });

  it('lets the Director distribute audits and monthly report reviews, and monitors every department report (Fauzan, 2 Nov 2026)', async () => {
    const { svc } = fresh();
    const dir = await svc.user('u-audit');
    const aud1 = await svc.user('u-act-aud1');
    const aud2 = await svc.user('u-act-aud2');
    const b = await svc.actBoard(dir);
    expect(b.canAssign).toBe(true);
    // Every department shows up; one with no monthly report set is never green.
    const depts = new Set(b.reports.filter((r) => r.senderKind === 'department').map((r) => r.department));
    expect(depts.has('it')).toBe(true);
    // Every department sends a monthly report on the standard form, due on the 25th of the next month.
    const deptRows = b.reports.filter((r) => r.senderKind === 'department');
    expect(deptRows.every((r) => r.status !== 'no_report')).toBe(true);
    expect(b.reportForms.every((f) => f.dueDay === 25 && f.sections.length >= 3)).toBe(true);
    expect(b.signals.find((x) => x.key === 'reports_late')!.count).toBeGreaterThan(0);
    // Only the Director gives work out.
    await expect(svc.assignActWork(aud1, { kind: 'workflow', team: 1, area: 'PAYROLL' })).rejects.toThrow(/Director/);
    await expect(svc.assignActWork(dir, { kind: 'workflow', team: 3, area: 'PAYROLL' })).rejects.toThrow(/Team 1 or Team 2/);
    const w = await svc.assignActWork(dir, { kind: 'workflow', team: 1, area: 'PAYROLL', note: 'Check October EPF' });
    await expect(svc.assignActWork(dir, { kind: 'workflow', team: 2, area: 'PAYROLL' })).rejects.toThrow(/already given/);
    const rep = b.reports.find((r) => r.senderKind === 'department' && r.defId && r.period)!;
    const rw = await svc.assignActWork(dir, { kind: 'report_review', team: 2, defId: rep.defId, period: rep.period });
    expect(rw.area).toBe('REPORTING');
    const after = await svc.actBoard(aud2);
    // C6 (Fauzan, 11 Nov 2026): each team sees its own work; the Director sees both teams' work.
    expect(after.work.map((x) => x.audit.id)).toEqual([rw.id]);
    expect((await svc.actBoard(dir)).work.map((x) => x.audit.id).sort()).toEqual([rw.id, w.id].sort());
    expect(after.reports.find((r) => r.key === rep.key)!.review!.status).toBe('assigned');
    // Team 2 cannot record Team 1's audit; Team 1's Auditor can, and the plan then counts it.
    await expect(svc.recordActAudit(aud2, { area: 'PAYROLL', companyId: null, doneOn: '2026-10-25', result: 'clean', note: 'x', assignmentId: w.id })).rejects.toThrow(/Team 1/);
    await svc.recordActAudit(aud1, { area: 'PAYROLL', companyId: null, doneOn: '2026-10-25', result: 'clean', note: 'EPF matched the bank file', assignmentId: w.id });
    await svc.recordActAudit(aud2, { area: 'REPORTING', companyId: null, doneOn: '2026-10-25', result: 'findings', note: 'Headcount differs from HR records', assignmentId: rw.id });
    const done = await svc.actBoard(dir);
    expect(done.work).toHaveLength(0);
    expect(done.plan.find((p) => p.area.id === 'PAYROLL')!.last!.by).toBe(aud1.name);
    expect(done.reports.find((r) => r.key === rep.key)!.review!.result).toBe('findings');
    await expect(svc.recordActAudit(aud1, { area: 'PAYROLL', companyId: null, doneOn: '2026-10-25', result: 'clean', note: 'again', assignmentId: w.id })).rejects.toThrow(/not open/);
  });

  it('lets only the ACT Director set each monthly report form, and shows the sections a report leaves out (Fauzan, 2 Nov 2026)', async () => {
    const { svc, store } = fresh();
    const dir = await svc.user('u-audit');
    const form = { department: 'it', sections: ['Summary', 'Tickets and speed', 'Devices and rentals', 'Help needed'], checks: ['Tickets against the IT board'], note: 'IT pilot form' };
    await expect(svc.setActReportForm(await svc.user('u-act-aud1'), form)).rejects.toThrow(/Director/);
    await expect(svc.setActReportForm(dir, { ...form, sections: ['One'] })).rejects.toThrow(/three sections/);
    await expect(svc.setActReportForm(dir, { ...form, department: 'nowhere' })).rejects.toThrow(/department/);
    const def = await svc.setActReportForm(dir, form);
    expect(def.sections).toEqual(form.sections);
    expect(def.dueDay).toBe(25);
    expect(def.formBy!.by).toBe(dir.name);
    // A department report that leaves out sections shows the gap to ACT.
    const period = (await svc.actBoard(dir)).reports.find((r) => r.defId === def.id)!.period!;
    const subs = await store.list('reportSubmissions', { defId: def.id, period });
    for (const x of subs) await store.update('reportSubmissions', x.id, { sectionsCovered: ['Summary'] });
    if (!subs.length)
      await store.insert('reportSubmissions', { id: 'rs-test-it', defId: def.id, period, companyId: null, department: 'it', by: 'IT (synthetic)', at: NOW, note: '', docIds: [], file: null, sectionsCovered: ['Summary'] });
    const row = (await svc.actBoard(dir)).reports.find((r) => r.defId === def.id)!;
    expect(row.form).toEqual({ total: 4, covered: 1, missing: ['Tickets and speed', 'Devices and rentals', 'Help needed'] });
  });

  it('refuses owners from another company and ACT staff from the other team (Arisha main review, 2 Nov 2026)', async () => {
    const { svc } = fresh();
    const aud1 = await svc.user('u-act-aud1');
    const base = { area: 'BILLING', source: 'workflow_audit' as const, title: 'Invoice sent late', detail: '', severity: 'medium' as const, evidence: 'Invoices for October' };
    // Wrong company: Sasa's manager cannot own an Arsh finding; a company manager cannot own a PWVSB department finding.
    await expect(svc.raiseActFinding(aud1, { ...base, companyId: 'co-arsh', ownerUserId: 'u-cm-sasa' })).rejects.toThrow(/works in that company/);
    await expect(svc.raiseActFinding(aud1, { ...base, companyId: null, ownerUserId: 'u-cm-sasa' })).rejects.toThrow(/PWVSB owner/);
    // A PWVSB central owner fits any company; the company's own manager fits it.
    await svc.raiseActFinding(aud1, { ...base, companyId: 'co-arsh', ownerUserId: 'u-cos' });
    const f = await svc.raiseActFinding(aud1, { ...base, companyId: 'co-arsh', ownerUserId: 'u-cm-arsh' });
    expect(f.team).toBe(1);
    // Wrong team: Team 2 cannot follow up or check Team 1's finding; the Director can.
    const cm = await svc.user('u-cm-arsh');
    await expect(svc.actFindingStep(await svc.user('u-act-enf2'), f.id, 'follow_up', { method: 'call', note: 'x' })).rejects.toThrow(/with Team 1/);
    await svc.actFindingStep(await svc.user('u-act-enf1'), f.id, 'follow_up', { method: 'call', note: 'Manager will plan by Friday' });
    await svc.actFindingStep(cm, f.id, 'plan', { rootCause: 'No billing calendar', solution: 'Calendar by the 5th', targetOn: '2026-11-20' });
    await svc.actFindingStep(cm, f.id, 'fixed', { proof: 'November invoices sent on the 5th' });
    await expect(svc.actFindingStep(await svc.user('u-act-aud2'), f.id, 'check', { ok: true, note: 'x' })).rejects.toThrow(/with Team 1/);
    // An unassigned finding (raised by the Director) waits for the Director before any team acts.
    const dir = await svc.user('u-audit');
    const d = await svc.raiseActFinding(dir, { ...base, companyId: 'co-arsh', ownerUserId: 'u-cm-arsh' });
    await expect(svc.actFindingStep(await svc.user('u-act-enf1'), d.id, 'follow_up', { method: 'call', note: 'x' })).rejects.toThrow(/not given this finding to a team/);
    // Refusals read as plain reasons, not as a missing company grant.
    await expect(svc.actFindingStep(await svc.user('u-act-enf1'), f.id, 'check', { ok: true, note: 'x' })).rejects.toThrow(/^Only an ACT Auditor/);
    const closed = await svc.actFindingStep(aud1, f.id, 'check', { ok: true, note: 'Seen the November invoices' });
    expect(closed.status).toBe('closed');
  });

  it('lets the team Auditor send a high finding back or give the first check, and the ACT Manager close it (C6)', async () => {
    const { svc } = fresh();
    const aud1 = await svc.user('u-act-aud1');
    const dir = await svc.user('u-audit');
    const cm = await svc.user('u-cm-arsh');
    const f = await svc.raiseActFinding(aud1, { companyId: 'co-arsh', area: 'ARMS', source: 'workflow_audit', title: 'Rounds not counted', detail: '', severity: 'high', evidence: 'Vault log 3 Nov', ownerUserId: cm.id });
    await svc.actFindingStep(cm, f.id, 'plan', { rootCause: 'No count sheet', solution: 'Count sheet each shift', targetOn: '2026-11-10' });
    await svc.actFindingStep(cm, f.id, 'fixed', { proof: 'Count sheets' });
    expect((await svc.actFindingStep(aud1, f.id, 'check', { ok: false, note: 'Two shifts missing' })).status).toBe('planned');
    await svc.actFindingStep(cm, f.id, 'fixed', { proof: 'All shifts counted' });
    expect((await svc.actFindingStep(aud1, f.id, 'check', { ok: true, note: 'ok' })).status).toBe('fixed');
    const board = await svc.actBoard(aud1);
    expect(board.canCloseHigh).toBe(false);
    expect((await svc.actBoard(dir)).canCloseHigh).toBe(true);
    const mgr = await svc.user('u-act-mgr');
    expect((await svc.actBoard(mgr)).canCloseHigh).toBe(true);
    const done = await svc.actFindingStep(mgr, f.id, 'check', { ok: true, note: 'Counted 7 days of sheets' });
    expect(done.status).toBe('closed');
    expect(done.checks.map((c) => c.ok)).toEqual([false, true, true]);
    expect(done.checks.map((c) => c.stage ?? null)).toEqual(['first', 'first', 'second']);
  });

  it('never shows a monthly report as on time when sections of its form are missing', async () => {
    const { svc, store } = fresh();
    const dir = await svc.user('u-audit');
    const b0 = await svc.actBoard(dir);
    const row0 = b0.reports.find((r) => r.defId === 'dept-finance-monthly')!;
    const def = (await store.get('reportDefs', 'dept-finance-monthly'))!;
    for (const x of await store.list('reportSubmissions', { defId: def.id, period: row0.period! })) await store.delete('reportSubmissions', x.id);
    await store.insert('reportSubmissions', { id: 'rs-test-fin', defId: def.id, period: row0.period!, companyId: null, department: 'finance', by: 'Finance (synthetic)', at: NOW, note: '', docIds: [], file: null, sectionsCovered: def.sections!.slice(0, 2) });
    let row = (await svc.actBoard(dir)).reports.find((r) => r.defId === def.id)!;
    expect(row.status).toBe('incomplete');
    expect(row.form!.covered).toBe(2);
    // An old submission with no sections ticked is incomplete too, never green.
    await store.update('reportSubmissions', 'rs-test-fin', { sectionsCovered: undefined } as never);
    row = (await svc.actBoard(dir)).reports.find((r) => r.defId === def.id)!;
    expect(row.status).toBe('incomplete');
    await store.update('reportSubmissions', 'rs-test-fin', { sectionsCovered: def.sections });
    row = (await svc.actBoard(dir)).reports.find((r) => r.defId === def.id)!;
    expect(['on_time', 'late']).toContain(row.status);
  });

  it('lets only the ACT Director time a workflow step by step after a review, walks it through, and checks it in the field every 6 months (Fauzan, 2 Nov 2026)', async () => {
    const { svc } = fresh();
    const dir = await svc.user('u-audit');
    const aud1 = await svc.user('u-act-aud1');
    const enf2 = await svc.user('u-act-enf2');
    const segments = [
      { step: 'Ticket reaches IT Executive', target: 2, unit: 'hours', key: 'it-ex-queue' },
      { step: 'Fix done', target: 1, unit: 'days', key: null },
    ];
    // No review yet: the timing must rest on a finished ACT audit of that workflow.
    await expect(svc.setActTiming(dir, { area: 'IT', auditMonths: 6, segments, reviewId: 'nope', reason: 'From review' })).rejects.toThrow(/Review the workflow first/);
    const review = await svc.recordActAudit(aud1, { area: 'IT', companyId: null, doneOn: '2026-10-20', result: 'clean', note: 'Walked 20 tickets' });
    await expect(svc.setActTiming(aud1, { area: 'IT', auditMonths: 6, segments, reviewId: review.id, reason: 'x' })).rejects.toThrow(/Only the ACT Director/);
    await expect(svc.setActTiming(dir, { area: 'IT', auditMonths: 6, segments: [{ step: 'x', target: 0, unit: 'hours' }], reviewId: review.id, reason: 'x y' })).rejects.toThrow(/Step 1/);
    // Unset timing never reads as zero.
    expect(await svc.workStandardHours()).toEqual({});
    await svc.setActTiming(dir, { area: 'IT', auditMonths: 6, segments, reviewId: review.id, reason: 'Review showed 2 hours is enough' });
    expect(await svc.workStandardHours()).toEqual({ 'it-ex-queue': 2 });
    const b = await svc.actBoard(enf2);
    const it = b.plan.find((p) => p.area.id === 'IT')!;
    expect(it.area.months).toBe(6);
    expect(it.timing!.defaultMonths).toBe(12);
    expect(it.walkthrough.map((w) => w.step)).toEqual(['Ticket reaches IT Executive', 'Fix done']);
    expect(it.field.state).toBe('never');
    expect(b.kpis.fieldChecksDue).toBeGreaterThan(0);
    // Any ACT job checks in the field; a slower step shows against its timing.
    await expect(svc.recordActFieldCheck(await svc.user('u-cm-sasa'), { area: 'IT', doneOn: '2026-10-25', where: 'HQ', observed: [], result: 'clean', note: 'x' })).rejects.toThrow(/Only ACT staff/);
    const fc = await svc.recordActFieldCheck(enf2, {
      area: 'IT',
      doneOn: '2026-10-25',
      where: 'PWVSB HQ IT desk',
      observed: [{ step: 'Ticket reaches IT Executive', actual: 3, unit: 'hours', note: 'Queue not watched after lunch' }],
      result: 'findings',
      note: 'First step slower than timed',
    });
    expect(fc.field!.observed[0].target).toBe(2);
    const after = (await svc.actBoard(dir)).plan.find((p) => p.area.id === 'IT')!;
    expect(after.field.state).toBe('ok');
    expect(after.field.dueOn).toBe('2027-04-26'); // 6 months as 183 days, like the audit plan
  });

  it('walks a timing through working hours only', async () => {
    const { simulateWorkflow } = await import('../src/reports');
    // Friday 16:30 + 2 hours: 1 hour Friday, 1 hour Monday morning; then 1 working day ends Tuesday 09:30.
    const w = simulateWorkflow(
      [
        { step: 'a', target: 2, unit: 'hours' },
        { step: 'b', target: 1, unit: 'days' },
      ],
      '2026-10-30T16:30',
    );
    expect(w).toEqual([
      { step: 'a', target: 2, unit: 'hours', startsAt: '2026-10-30T16:30', dueAt: '2026-11-02T09:30' },
      { step: 'b', target: 1, unit: 'days', startsAt: '2026-11-02T09:30', dueAt: '2026-11-03T09:30' },
    ]);
  });

  it('needs the COO or CEO to approve an improvement before steps are ticked', async () => {
    const { svc } = fresh();
    const lead = await svc.user('u-audit');
    const i = await svc.addActImprovement(lead, {
      title: 'Monthly billing calendar',
      benefit: 'Invoices by the 10th',
      findingIds: ['act-f-2'],
      ownerUserId: 'u-cm-arsh',
      targetOn: '2026-12-01',
      steps: ['Set dates', 'Train admin'],
    });
    await expect(svc.actImprovementStep(await svc.user('u-cm-arsh'), i.id, 'step', { index: 0 })).rejects.toThrow(/approve/);
    await expect(svc.actImprovementStep(lead, i.id, 'approve', { note: 'ok' })).rejects.toThrow();
    await svc.actImprovementStep(await svc.user('u-coo'), i.id, 'approve', { note: 'ok' });
    await svc.actImprovementStep(await svc.user('u-cm-arsh'), i.id, 'step', { index: 0 });
    await expect(svc.actImprovementStep(lead, i.id, 'result', { note: 'ok' })).rejects.toThrow(/every step/);
  });
});

describe('Add and edit forms for plain records (Fauzan, 27 Oct 2026)', () => {
  it('lets only the keeper add or edit, checks the values, and logs every change', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    expect(svc.recordKindsFor(cm)).toEqual(expect.arrayContaining(['site', 'post', 'checkpoint', 'licence']));
    expect(svc.recordKindsFor(cm)).not.toContain('vehicle');
    await expect(svc.recordForm(cm, 'site', null, 'co-sasa')).rejects.toThrow();
    const branch = ds.branches.find((b) => b.companyId === 'co-arsh')!;
    const site = {
      code: 'ARSH-T1',
      name: 'Test Tower',
      client: 'Test Client',
      address: '1 Jalan Ujian',
      branchId: branch.id,
      lat: 3.1,
      lng: 101.6,
      geofenceM: 150,
      risk: 'low',
      sector: 'private',
      armed: false,
    };
    await expect(svc.saveRecord(cm, 'site', null, 'co-arsh', { ...site, geofenceM: 5 })).rejects.toThrow();
    const added = (await svc.saveRecord(cm, 'site', null, 'co-arsh', site)) as { id: string };
    expect(ds.sites.find((s) => s.id === added.id)!.companyId).toBe('co-arsh');
    await svc.saveRecord(cm, 'site', added.id, null, { ...site, name: 'Test Tower 2' });
    expect(ds.sites.find((s) => s.id === added.id)!.name).toBe('Test Tower 2');
    const logged = ds.audit.find((e) => e.action === 'record.edit.site' && e.entityId === added.id)!;
    expect(logged.summary).toContain('Site name: Test Tower → Test Tower 2');
    expect(logged.summary).not.toContain('Client:');

    // Central keepers choose the company first.
    const arms = await svc.user('u-pwvsb-arms');
    const pickCo = await svc.recordForm(arms, 'vault', null, null);
    expect(pickCo.chooseCompany!.length).toBeGreaterThan(1);
    await expect(svc.saveRecord(arms, 'vault', null, null, {})).rejects.toThrow(/company/);
    const sup = (await svc.saveRecord(arms, 'armsSupplier', null, null, {
      name: 'Test Arms Sdn Bhd',
      supplies: 'Firearms, Servicing',
      contact: '03-0000 0000',
    })) as {
      id: string;
    };
    expect(ds.armsSuppliers.find((s) => s.id === sup.id)!.supplies).toEqual(['Firearms', 'Servicing']);

    // A tenancy starts on a vacant unit and ends from the same form.
    const team = await svc.user('u-asset-re1');
    const vacant = ds.amUnits.find((u) => !u.tenancy)!;
    await svc.saveRecord(team, 'amTenancy', vacant.id, null, {
      tenant: 'Test Tenant',
      internal: false,
      startOn: TODAY,
      endOn: '2027-10-25',
      rent: 900,
      deposit: 1800,
      utilityDeposit: 300,
      stamped: true,
    });
    expect(ds.amUnits.find((u) => u.id === vacant.id)!.tenancy!.tenant).toBe('Test Tenant');
    await svc.saveRecord(team, 'amTenancy', vacant.id, null, { ended: true });
    expect(ds.amUnits.find((u) => u.id === vacant.id)!.tenancy).toBeNull();
  });
});

describe('Firearm serial numbers and RFID tags (Fauzan, 27 Oct 2026)', () => {
  it('keeps the full serial for Arms Control only, keeps serial and tag unique, and checks the tag at issue and return', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const view = await svc.arms(cm, 'co-sasa');
    expect(view.firearms.every((f) => f.firearm.serial === undefined)).toBe(true);
    const free = ds.firearms.find((f) => f.companyId === 'co-sasa' && f.status === 'IN_VAULT' && f.rfidTag && f.licenceExpiresOn && f.ownership !== 'TRADE')!;
    const other = ds.firearms.find((f) => f.id !== free.id && f.rfidTag)!;

    // The form: Arms Control sees the full serial; it is set once and unique, and so is the tag.
    const arms = await svc.user('u-pwvsb-arms');
    const form = await svc.recordForm(arms, 'firearm', free.id, null);
    expect(form.values.serial).toBe(free.serial);
    const base = { ...form.values };
    await expect(svc.saveRecord(arms, 'firearm', free.id, null, { ...base, serial: 'ZZ99990000' })).rejects.toThrow(/set once/);
    await expect(svc.saveRecord(arms, 'firearm', free.id, null, { ...base, rfidTag: other.rfidTag })).rejects.toThrow(/already on/);
    await svc.saveRecord(arms, 'firearm', free.id, null, { ...base, rfidTag: 'e2:80:11:aa:bb:cc' });
    expect(ds.firearms.find((f) => f.id === free.id)!.rfidTag).toBe('E28011AABBCC');
    const logged = ds.audit.at(-1)!;
    expect(logged.summary).toContain('RFID tag:');
    expect(logged.summary).not.toContain(free.serial!);
    const added = (await svc.saveRecord(arms, 'firearm', null, 'co-sasa', {
      ...base,
      tag: 'SASA-NEW1',
      serial: 'ab 12345678',
      rfidTag: null,
    })) as { id: string };
    const neu = ds.firearms.find((f) => f.id === added.id)!;
    expect([neu.serial, neu.serialMasked]).toEqual(['AB12345678', '****5678']);
    await expect(svc.saveRecord(arms, 'firearm', null, 'co-sasa', { ...base, tag: 'SASA-NEW2', serial: 'AB12345678' })).rejects.toThrow(/already recorded/);

    // Issue and return: a wrong tag stops it; no scan is recorded as not scanned.
    const armedSite = ds.sites.find((s) => s.companyId === 'co-sasa' && s.armed)!;
    const holder = ds.credentials.find((c) => c.companyId === 'co-sasa' && c.type === 'FIREARM_PERMIT')!.personId;
    const shift = ds.shifts.find((s) => s.siteId === armedSite.id && s.date === addDays(TODAY, 1))!;
    shift.personId = holder;
    const W = witnessIn(ds, 'co-sasa', [holder]);
    await expect(svc.issueFirearm(cm, { shiftId: shift.id, firearmId: free.id, rounds: 5, witness: W, rfidScan: other.rfidTag })).rejects.toThrow(
      /not SASA|not .*’s/,
    );
    const m = await svc.issueFirearm(cm, { shiftId: shift.id, firearmId: free.id, rounds: 5, witness: W, rfidScan: 'E2-80-11-AA-BB-CC' });
    expect(m.issueCheck).toBe('rfid');
    await expect(svc.returnFirearm(cm, { movementId: m.id, roundsReturned: 5, witness: W, rfidScan: other.rfidTag })).rejects.toBeInstanceOf(
      RuleBlocked,
    );
    const r = await svc.returnFirearm(cm, { movementId: m.id, roundsReturned: 5, witness: W });
    expect(r.movement.returnCheck).toBe('manual');
    expect((await svc.arms(cm, 'co-sasa')).rfid.notScannedWeek).toBeGreaterThan(0);
    expect(verifyChain(ds.audit)).toBeNull();
  });
});

describe('HR and operations retest fixes (Fauzan, 27 Oct 2026)', () => {
  it('lets the Chief of Staff and Deputy act as HR Director on staff leave, after the HR Admin', async () => {
    const { svc, ds } = fresh();
    const cos = await svc.user('u-cos');
    const dcos = await svc.user('u-dcos');
    const staff = ds.people.find((p) => p.companyId === GROUP_EMPLOYER_ID && p.role === 'office' && p.id !== cos.personId && p.id !== dcos.personId)!;
    const asker = ds.users.find((u) => u.personId === staff.id)!;
    await svc.requestLeave(asker, { personId: staff.id, kind: 'ANNUAL', from: '2026-11-10', to: '2026-11-10', reason: 'Family matter' });
    const q = ds.leaveRequests.find((r) => r.personId === staff.id && r.status === 'pending')!;
    const forCos = (await svc.leaveRequests(cos, {})).rows.find((r) => r.request.id === q.id)!;
    expect(forCos.canDecide).toBe(true);
    expect(forCos.waitingWith!.label).toBe('HR Admin');
    await svc.decideLeave(dcos, q.id, true, 'Cover arranged');
    // The Deputy stands in as HR Director (Fauzan, 1 Nov 2026); the Vice Chairman then consents.
    expect(ds.leaveRequests.find((r) => r.id === q.id)!.status).toBe('pending');
    await svc.decideLeave(await svc.user('u-vchair'), q.id, true, 'Consent');
    expect(ds.leaveRequests.find((r) => r.id === q.id)!.status).toBe('approved');
  });

  it('keeps the pay until the Chief of Staff verifies it, and adds central staff with the full HR record', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    // PWVSB central staff are in the company picker and open like any company's staff.
    const pick = await svc.recordForm(hr, 'officeStaff', null, null);
    expect(pick.chooseCompany![0]).toEqual([GROUP_EMPLOYER_ID, 'PWVSB (central staff)']);
    expect((await svc.people(hr, GROUP_EMPLOYER_ID)).length).toBeGreaterThan(20);
    const form = await svc.recordForm(hr, 'officeStaff', null, GROUP_EMPLOYER_ID);
    const hire = {
      staffNo: 'PWV900',
      name: 'Test Hire',
      jobTitle: 'HR Executive',
      branchId: form.options.branchId[0][0],
      employmentType: 'probation',
      hiredOn: TODAY,
      probationEndsOn: '2027-04-26',
      nationality: 'MY',
      idFull: '900101-14-5678',
      gender: 'F',
      dob: '1990-01-01',
      phone: '012-345 6789',
      email: 'test.hire@example.com',
      bankName: 'Maybank',
      bankAccountFull: '1122 3344 5566',
      basicPay: 3500,
      status: 'active',
    };
    await expect(svc.saveRecord(hr, 'officeStaff', null, GROUP_EMPLOYER_ID, hire)).rejects.toThrow(/reason for the pay/);
    const added = (await svc.saveRecord(hr, 'officeStaff', null, GROUP_EMPLOYER_ID, { ...hire, payReason: 'Offer letter' })) as Person;
    const p = ds.people.find((x) => x.id === added.id)!;
    expect(p.basicPay).toBeUndefined();
    expect(p.idMasked).toBe('900101-**-***8');
    // The salary account waits for the HR Director and Finance (insider abuse audit, 27 Oct 2026).
    expect(p.bank).toBeNull();
    const add = ds.audit.find((e) => e.action === 'record.add.officeStaff' && e.entityId === p.id)!;
    expect(add.summary).not.toContain('5566 ');
    // HR cannot verify; the Chief of Staff can.
    const pc = ds.payChanges.find((c) => c.personId === p.id && c.kind === 'PAY')!;
    const bc = ds.payChanges.find((c) => c.personId === p.id && c.kind === 'BANK')!;
    await svc.decidePayChange(cos, bc.id, true, 'Bank letter seen');
    await svc.decidePayChange(await svc.user('u-fd'), bc.id, true, 'Account checked');
    expect(ds.people.find((x) => x.id === p.id)!.bank).toEqual({ bank: 'Maybank', accountMasked: '****5566' });
    await expect(svc.decidePayChange(hr, pc.id, true, 'ok')).rejects.toThrow(/Someone else/);
    expect((await svc.payChanges(cos)).rows.find((r) => r.change.id === pc.id)!.mine).toBe(true);
    await svc.decidePayChange(cos, pc.id, true, 'Matches the offer letter');
    // The salary amount then needs the Vice Chairman's consent (Fauzan, 1 Nov 2026).
    expect(ds.people.find((x) => x.id === p.id)!.basicPay).toBeUndefined();
    await svc.decidePayChange(await svc.user('u-vchair'), pc.id, true, 'Consent');
    expect(ds.people.find((x) => x.id === p.id)!.basicPay).toBe(3500);
    // A raise waits again; the old pay stays meanwhile.
    const values = (await svc.recordForm(hr, 'officeStaff', p.id, null)).values;
    expect(values.idFull).toBe('900101-14-5678');
    await svc.saveRecord(hr, 'officeStaff', p.id, null, { ...values, basicPay: 3800, payReason: 'Confirmed after probation' });
    expect(ds.people.find((x) => x.id === p.id)!.basicPay).toBe(3500);
    await expect(svc.saveRecord(hr, 'officeStaff', p.id, null, { ...values, basicPay: 3900, payReason: 'Again' })).rejects.toThrow(/already waiting/);
    // Leaving needs the reason and last day; status turns to left from the last day.
    await expect(svc.saveRecord(hr, 'officeStaff', p.id, null, { ...values, status: 'left' })).rejects.toThrow(/last working day/);
    await svc.saveRecord(hr, 'officeStaff', p.id, null, {
      ...values,
      leavingKind: 'resigned',
      noticeOn: TODAY,
      lastDayOn: '2026-11-25',
      leavingReason: 'New job',
    });
    expect(ds.people.find((x) => x.id === p.id)!.status).toBe('active');
    expect(ds.people.find((x) => x.id === p.id)!.leaving!.lastDayOn).toBe('2026-11-25');
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('shows the OM only their own states, and the Operations Director and OGM a nationwide board by sector', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const board = await svc.regionalOps(om);
    expect(board.region.states.sort()).toEqual(['Kuala Lumpur', 'Selangor']);
    const branchState = new Map(ds.branches.map((b) => [b.id, b.state]));
    const sites = await svc.sites(om, 'co-sasa');
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => ['Selangor', 'Kuala Lumpur'].includes(branchState.get(s.site.branchId)!))).toBe(true);
    const od = await svc.regionalOps(await svc.user('u-opsdir'));
    expect(od.region.id).toBe('all');
    expect(od.sector).toBe('private');
    const ogm = await svc.regionalOps(await svc.user('u-ogm'));
    expect(ogm.sector).toBe('government');
    expect(od.totals.sites + ogm.totals.sites).toBe((await svc.regionalOps(await svc.user('u-coo'))).totals.sites);
  });

  it('lets the OM act on an absence for the company once the PIC has not acted for 15 minutes', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const a = await svc.attendanceAlerts(om, 'co-sasa');
    expect(a.stepIn!.afterMin).toBe(RULES.opsStepIn.value);
    const late = a.open.find((i) => i.issue === 'NO_SHOW' && toMs(NOW) - toMs(i.raisedAt) >= 15 * 60_000 && a.stepIn!.siteIds.includes(i.siteId))!;
    expect(late).toBeTruthy();
    await expect(
      svc.followUpAttendance(om, { shiftId: late.shiftId, issue: 'NO_SHOW', kind: 'DISCIPLINE', discipline: 'VERBAL_WARNING', note: 'No', proof: [proof()] }),
    ).rejects.toBeInstanceOf(AccessDenied);
    const sub = (await svc.candidates(om, late.shiftId!)).candidates.find((c) => !c.blocked && c.person.id !== late.personId)!;
    const r = await svc.followUpAttendance(om, {
      shiftId: late.shiftId,
      issue: 'NO_SHOW',
      kind: 'REPLACEMENT',
      note: 'PIC not answering, sent buffer',
      replacementPersonId: sub.person.id,
    });
    expect(r.record.byDesk).toBe('operations');
    expect(ds.audit.some((e) => e.action === 'attendance.followup' && e.actor.includes('operations, for the company'))).toBe(true);
    // Outside the OM's states: watch only.
    const johor = a.stepIn!.siteIds.length;
    expect(johor).toBeLessThan(ds.sites.filter((s) => s.companyId === 'co-sasa').length);
  });
});

describe('Working from home (Fauzan, 27 Oct 2026)', () => {
  function clocked() {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const at = { now: NOW };
    return { ds, store, at, svc: new PrimaService(store, () => at.now) };
  }

  it('shows the manager who is home today, how their day stands and who to talk to, never as an automatic finding', async () => {
    const { svc } = clocked();
    const hr = await svc.remoteBoard(await svc.user('u-pwvsb-hr'));
    const good = hr.people.find((p) => p.arrangement.userId === 'u-it-ex1')!;
    const poor = hr.people.find((p) => p.arrangement.userId === 'u-fin-t1-de2')!;
    expect(good.homeToday && poor.homeToday).toBe(true);
    expect(good.today!.status.plan).toBe('done');
    expect(good.today!.work.actions).toBeGreaterThan(0);
    expect(poor.today!.status.plan).toBe('missed');
    expect(good.talk).toBe(false);
    expect(poor.talk).toBe(true);
    // Only HR answers applications, for central and company staff alike (Fauzan, 2 Nov 2026).
    expect(hr.applications.find((a) => a.arrangement.userId === 'u-fin-t1-de1')!.canDecide).toBe(true);
    expect(hr.applications.find((a) => a.arrangement.userId === 'u-ae-arsh')!.canDecide).toBe(true);
    const cm = await svc.remoteBoard(await svc.user('u-cm-arsh'));
    expect(cm.people).toHaveLength(0);
    expect(cm.applications.map((a) => [a.arrangement.userId, a.canDecide])).toEqual([['u-ae-arsh', false]]);
    await expect(svc.remoteBoard(await svc.user('u-ae-arsh'))).rejects.toBeInstanceOf(AccessDenied);
    // The board shows a home worker as working from home, not as an unknown location.
    const clock = await svc.staffClockBoard(await svc.user('u-pwvsb-hr'));
    expect(clock.rows.find((r) => r.userId === 'u-fin-t1-de2')!.location).toBe('remote');
  });

  it('takes a written application, answers it in writing within 60 days, and lets nobody answer their own', async () => {
    const { svc } = clocked();
    await expect(
      svc.remoteApply(await svc.user('u-rom-central'), {
        days: [1],
        from: TODAY,
        to: null,
        reason: 'Some reason',
        place: { label: 'Home', lat: 3, lng: 101 },
        noticeAccepted: true,
      }),
    ).rejects.toThrow(/field/);
    const ex = await svc.user('u-it-ex3');
    const input = {
      days: [2, 4, 6],
      from: '2026-11-02',
      to: null,
      reason: 'Long commute',
      place: { label: 'Home', lat: 3.2, lng: 101.7 },
      noticeAccepted: false,
    };
    // Blocked until HR opens working from home for this staff member (Fauzan, 2 Nov 2026).
    await expect(svc.remoteApply(ex, { ...input, noticeAccepted: true })).rejects.toThrow(/HR has not opened/);
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.setWfhAllowed(ex, ex.personId!, true, 'Long commute')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setWfhAllowed(hr, ex.personId!, true, '')).rejects.toThrow(/reason|comment/i);
    await svc.setWfhAllowed(hr, ex.personId!, true, 'Desk work, can be done from home.');
    await expect(svc.remoteApply(ex, input)).rejects.toThrow(/notice/);
    const a = await svc.remoteApply(ex, { ...input, noticeAccepted: true });
    expect(a.days).toEqual([2, 4]);
    expect(a.answerBy).toBe(addDays(TODAY, 60));
    await expect(svc.remoteApply(ex, { ...input, noticeAccepted: true })).rejects.toThrow(/waiting/);
    await expect(svc.remoteDecide(ex, a.id, true, '')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.remoteDecide(hr, a.id, false, 'no')).rejects.toThrow(/grounds/);
    // Approving someone not yet ready (D5) needs a written exception.
    expect((await svc.remoteDecide(hr, a.id, true, 'Approved: long commute, reviewed in one month.')).status).toBe('approved');
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.remoteDecide(cm, 'wfh-u-ae-arsh-1', true, '')).rejects.toBeInstanceOf(AccessDenied);
    // The company manager no longer answers; HR does.
    await expect(svc.remoteDecide(await svc.user('u-cm-arsh'), 'wfh-u-ae-arsh-1', true, 'Approved for Wednesdays.')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.remoteDecide(hr, 'wfh-u-ae-arsh-1', true, 'Approved for Wednesdays.')).decidedBy).toBeTruthy();
    // A manager ends an arrangement only in writing.
    await expect(svc.remoteEnd(hr, a.id, '')).rejects.toThrow(/writing/);
    expect((await svc.remoteEnd(ex, a.id, '')).status).toBe('ended');
  });

  it('runs a home day: one place check, the plan, check-ins at fixed times, the report and the review', async () => {
    const { svc, store, at } = clocked();
    const me = await svc.user('u-fin-t1-de2');
    const home = (await store.get('remoteArrangements', 'wfh-u-fin-t1-de2-1'))!.place;
    const pings = (await store.list('locationPings', { userId: me.id })).length;
    const first = await svc.staffPing(me, { lat: home.lat, lng: home.lng, accuracyM: 10 });
    expect(first).toMatchObject({ accepted: true, remote: true });
    at.now = myt(TODAY, '10:40');
    expect(await svc.staffPing(me, { lat: 3, lng: 101, accuracyM: 10 })).toMatchObject({ accepted: false, remote: true });
    // Only the distance is kept; the location is not followed at home.
    expect((await store.list('locationPings', { userId: me.id })).length).toBe(pings);
    expect((await svc.myStaffClock(me)).state).toBe('remote');
    await svc.remotePlan(me, ['Key in invoices', 'Reconcile Team 1 bank']);
    let mine = await svc.myRemote(me);
    expect(mine.today!.day!.start!.atPlace).toBe(true);
    expect(mine.today!.status.plan).toBe('late');
    await expect(svc.remoteCheckIn(me, 'On invoices')).rejects.toThrow(/No check-in is due/);
    at.now = myt(TODAY, '11:10');
    await svc.remoteCheckIn(me, 'On invoices');
    const t = mine.today!.day!.plan!.tasks[0];
    await expect(svc.remoteTask(me, t.id, true, '')).rejects.toThrow(/came out/);
    await svc.remoteTask(me, t.id, true, 'Batch INV-2210 keyed in');
    at.now = myt(TODAY, '17:05');
    await expect(svc.remoteReport(me, { summary: 'short', blockers: '' })).rejects.toThrow(/finished/);
    const r = await svc.remoteReport(me, { summary: 'Keyed in the October invoice batch.', blockers: 'Bank statement not in yet' });
    expect(r.plan!.tasks.map((x) => x.status)).toEqual(['done', 'carried']);
    mine = await svc.myRemote(me);
    expect(mine.today!.status.checkIns.map((c) => c.state)).toEqual(['done', 'missed']);
    await expect(svc.remoteReview(me, r.id, 'accepted', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.remoteReview(hr, r.id, 'queried', '')).rejects.toThrow(/asking/);
    expect((await svc.remoteReview(hr, r.id, 'accepted', 'ok')).review!.verdict).toBe('accepted');
    // Not a home day for office staff without an arrangement.
    await expect(svc.remotePlan(await svc.user('u-pwvsb-doa'), ['x'])).rejects.toThrow(/not a home day/);
  });
});

describe('Bug sweep (27 Oct 2026)', () => {
  it('opens every screen the menu offers, and saves every record form unchanged', async () => {
    const { svc, ds } = fresh();
    for (const id of ['u-chair', 'u-vchair', 'u-coo']) expect((await svc.cms(await svc.user(id))).canDesk).toBe(false);
    for (const id of ['u-chair', 'u-fd', 'u-cos']) expect((await svc.tenderBoard(await svc.user(id))).rows).toBeDefined();
    expect(await svc.purBoard(await svc.user('u-opsdir'))).toBeDefined();
    expect(await svc.purBoard(await svc.user('u-finance-am'))).toBeDefined();
    expect((await svc.arms(await svc.user('u-cms-head'), 'co-sasa')).company.id).toBe('co-sasa');
    const hr = await svc.user('u-pwvsb-hr');
    const office = ds.people.find((p) => p.role === 'office' && p.status === 'left') ?? ds.people.find((p) => p.role === 'office')!;
    const f = await svc.recordForm(hr, 'officeStaff', office.id, null);
    await svc.saveRecord(hr, 'officeStaff', office.id, null, f.values);
    const arms = await svc.user('u-pwvsb-arms');
    const vault = ds.vaults.find((v) => !v.kind)!;
    const vf = await svc.recordForm(arms, 'vault', vault.id, null);
    expect(vf.values.kind).toBe('COMPANY_ARMOURY');
    await svc.saveRecord(arms, 'vault', vault.id, null, vf.values);
  });
});

describe('Insider abuse audit fixes (Fauzan, 27 Oct 2026)', () => {
  it('uses a new salary account only after the HR Director and Finance both verify it, and tells the staff member', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const fd = await svc.user('u-fd');
    const staff = ds.users.find((u) => u.department === 'it' && u.personId)!;
    const person = ds.people.find((p) => p.id === staff.personId)!;
    const before = person.bank ?? null;
    const values = (await svc.recordForm(hr, 'officeStaff', person.id, null)).values;
    await svc.saveRecord(hr, 'officeStaff', person.id, null, { ...values, bankName: 'CIMB', bankAccountFull: '8001 2345 6789' });
    // The record keeps the old account; the change waits.
    expect(ds.people.find((p) => p.id === person.id)!.bank ?? null).toEqual(before);
    const bc = ds.payChanges.find((c) => c.personId === person.id && c.kind === 'BANK' && c.status === 'pending')!;
    expect(bc.bankTo!.accountMasked).toBe('****6789');
    // The list never sends the full number.
    expect((await svc.payChanges(fd)).rows.find((r) => r.change.id === bc.id)!.change.bankTo!.accountFull).toBe('');
    // The staff member is told at once.
    expect((await svc.myDuty(staff)).reminders.some((r) => /salary account/.test(r.text) && r.text.includes('****6789'))).toBe(true);
    await expect(svc.decidePayChange(hr, bc.id, true, '')).rejects.toThrow(/Someone else/);
    await expect(svc.decidePayChange(staff, bc.id, true, '')).rejects.toThrow(/your own/);
    await svc.decidePayChange(cos, bc.id, true, 'Bank letter seen');
    await expect(svc.decidePayChange(cos, bc.id, true, 'Again')).rejects.toBeInstanceOf(AccessDenied);
    expect(ds.people.find((p) => p.id === person.id)!.bank ?? null).toEqual(before);
    await svc.decidePayChange(fd, bc.id, true, 'Bank letter seen');
    const after = ds.people.find((p) => p.id === person.id)!;
    expect(after.bank).toEqual({ bank: 'CIMB', accountMasked: '****6789' });
    // The full number sits behind the HR wall, never on the person record or the change.
    expect(after.bankAccountFull ?? null).toBeNull();
    expect(ds.staffAccounts.find((a) => a.personId === person.id)).toMatchObject({ accountFull: '800123456789', pending: null });
    expect(JSON.stringify(ds.payChanges.find((c) => c.id === bc.id))).not.toContain('800123456789');
    expect(after.bankChangedOn).toBe(TODAY);
    expect(ds.audit.some((e) => e.action === 'pay.bank.verify' && e.summary.includes('now in use'))).toBe(true);
    expect(verifyChain(ds.audit)).toBeNull();
  });

  it('never lets the Chief of Staff or Deputy verify their own pay rise: it goes to the Vice Chairman', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const cos = await svc.user('u-cos');
    const dcos = await svc.user('u-dcos');
    const vc = await svc.user('u-vchair');
    const values = (await svc.recordForm(hr, 'officeStaff', cos.personId!, null)).values;
    await svc.saveRecord(hr, 'officeStaff', cos.personId!, null, { ...values, basicPay: Number(values.basicPay) + 2000, payReason: 'Yearly increment' });
    const pc = ds.payChanges.find((c) => c.personId === cos.personId && c.status === 'pending')!;
    await expect(svc.decidePayChange(cos, pc.id, true, 'ok')).rejects.toThrow(/your own/);
    await expect(svc.decidePayChange(dcos, pc.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    const row = (await svc.payChanges(vc)).rows.find((r) => r.change.id === pc.id)!;
    expect(row.waitingOn).toBe('Vice Chairman (consent)');
    expect(row.mine).toBe(true);
    await svc.decidePayChange(vc, pc.id, true, 'Board approved');
    expect(ds.people.find((p) => p.id === cos.personId)!.basicPay).toBe(Number(values.basicPay) + 2000);
  });

  it('flags big one-off allowances and the preparer’s own line, and gives the bank file to Finance only', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const period = TODAY.slice(0, 7);
    ds.staffPayRuns = ds.staffPayRuns.filter((r) => r.id !== `sp-${GROUP_EMPLOYER_ID}-${period}`);
    const run = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, period);
    const other = run.lines.find((l) => l.personId !== hr.personId)!;
    const big = await svc.setStaffPayLine(hr, run.id, other.personId, { extra: [{ label: 'Special bonus', amount: 900 }] });
    expect(big.flags.some((f) => /above RM500/.test(f))).toBe(true);
    const own = await svc.setStaffPayLine(hr, run.id, hr.personId!, { extra: [{ label: 'Travel top-up', amount: 100 }] });
    expect(own.flags.some((f) => /preparer's own line/.test(f))).toBe(true);
    // Recalculating keeps the flag.
    const again = await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, period);
    expect(again.lines.find((l) => l.personId === hr.personId)!.flags.some((f) => /preparer's own line/.test(f))).toBe(true);
    // Through the approvals, then only Finance takes the bank file, with its control total.
    for (const p of ds.people.filter((x) => x.companyId === GROUP_EMPLOYER_ID && !x.bank)) p.bank = { bank: 'Maybank', accountMasked: '****0001' };
    await svc.prepareStaffPay(hr, GROUP_EMPLOYER_ID, period);
    await svc.staffPayStep(hr, run.id, 'submit');
    await svc.staffPayStep(await svc.user('u-cos'), run.id, 'approve', { note: 'Checked' });
    await svc.staffPayStep(await svc.user('u-coo'), run.id, 'coo_approve', { note: 'OK' });
    await expect(svc.staffPayExport(hr, run.id, 'bank')).rejects.toBeInstanceOf(AccessDenied);
    const fd = await svc.user('u-fd');
    const view = await svc.staffPayRun(fd, run.id);
    expect(view.can.bankFile).toBe(true);
    expect(view.control.code).toMatch(/^[0-9A-F]{12}$/);
    // The bank needs full account numbers: Finance's file reads them from behind the HR wall (1 Nov 2026).
    const lines = (await svc.staffPayRun(fd, run.id)).run.lines;
    const [l1, l2] = lines;
    ds.staffAccounts.push({ id: l1.personId, personId: l1.personId, companyId: GROUP_EMPLOYER_ID, accountFull: `1234567${l1.bank!.accountMasked.slice(-4)}`, pending: null, updatedAt: NOW, updatedBy: 'test' });
    const file = await svc.staffPayExport(fd, run.id, 'bank');
    expect(JSON.stringify(file)).toContain(`check ${view.control.code}`);
    expect(file.body).toContain(`1234567${l1.bank!.accountMasked.slice(-4)}`);
    // A line without a verified full number is marked, never paid blind.
    expect(file.body.split('\n').find((r) => r.startsWith(l2.staffNo))).toContain('MISSING: ask HR');
  });

  it('refuses old, double and self-approved claims, and trips not approved before they were made', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-inas');
    const cos = await svc.user('u-cos');
    await expect(svc.submitStaffClaim(cm, { kind: 'MEDICAL', date: addDays(TODAY, -61), amount: 80 }, [proof()])).rejects.toThrow(/within 60 days/);
    await expect(svc.submitStaffClaim(cm, { kind: 'MEDICAL', date: '2025-03-01', amount: 80 }, [proof()])).rejects.toThrow(/within 60 days/);
    await svc.submitStaffClaim(cm, { kind: 'MEDICAL', date: addDays(TODAY, -3), amount: 80 }, [proof()]);
    await expect(svc.submitStaffClaim(cm, { kind: 'MEDICAL', date: addDays(TODAY, -3), amount: 80 }, [proof()])).rejects.toThrow(/twice/);
    await svc.setClaimRate(cos, TODAY.slice(0, 7), 'CAR', 0.6);
    // Ticking pre-approved does nothing now; toll and parking need receipts.
    const t = { destination: 'Kuantan', preApproved: true, vehicle: 'CAR' as const, kmClaimed: 500, toll: 40 };
    await expect(svc.submitStaffClaim(cm, { kind: 'TRAVEL', date: TODAY, travel: t })).rejects.toThrow(/receipts/);
    const c = await svc.submitStaffClaim(cm, { kind: 'TRAVEL', date: TODAY, travel: t }, [proof()]);
    expect(c.travel!.preApproved).toBe(false);
    expect(c.travel!.cosReasons).toContain('Trip not approved before it was made');
    await expect(svc.submitStaffClaim(cm, { kind: 'TRAVEL', date: TODAY, travel: t }, [proof()])).rejects.toThrow(/already claimed/);
    // A trip is asked before the day, approved by someone else, and used once by its owner only.
    await expect(svc.requestTrip(cm, { date: addDays(TODAY, -1), destination: 'Ipoh', purpose: 'Site visit' })).rejects.toThrow(/before the trip/);
    const trip = await svc.requestTrip(cm, { date: TODAY, destination: 'Ipoh', purpose: 'Site visit' });
    expect((await svc.staffClaims(cos)).tripQueue.some((x) => x.id === trip.id)).toBe(true);
    await svc.decideTrip(cos, trip.id, true, 'ok');
    const other = await svc.user('u-cm-sasa');
    await expect(
      svc.submitStaffClaim(other, { kind: 'TRAVEL', date: TODAY, travel: { destination: 'Ipoh', tripId: trip.id, vehicle: 'CAR', kmClaimed: 400 } }),
    ).rejects.toBeInstanceOf(Error);
    const used = await svc.submitStaffClaim(cm, { kind: 'TRAVEL', date: TODAY, travel: { destination: 'Ipoh', tripId: trip.id, vehicle: 'CAR', kmClaimed: 400 } });
    expect(used.travel!.preApproved).toBe(true);
    expect(ds.tripApprovals.find((x) => x.id === trip.id)!.claimId).toBe(used.id);
    // The Chief of Staff's own trip and claim go to someone else.
    const ownTrip = await svc.requestTrip(cos, { date: TODAY, destination: 'Johor Bahru', purpose: 'Board meeting' });
    await expect(svc.decideTrip(cos, ownTrip.id, true, 'ok')).rejects.toThrow(/your own/);
    await svc.decideTrip(await svc.user('u-dcos'), ownTrip.id, true, 'ok');
    const ownClaim = await svc.submitStaffClaim(cos, { kind: 'TRAVEL', date: TODAY, travel: { destination: 'Melaka', vehicle: 'CAR', kmClaimed: 300 } });
    await expect(svc.cosDecideClaim(cos, ownClaim.id, true, 'ok')).rejects.toThrow(/your own/);
  });

  it('needs the supplier documents, keeps the supplier review with Finance, and catches a supplier paid into a staff account', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ex = await svc.user('u-proc-exec');
    const fd = await svc.user('u-fd');
    const r = await svc.raisePurRequest(cm, 'co-arsh', { title: 'Torches', category: 'GUARD_EQUIPMENT', lines: [{ item: 'Torch', stockItemId: 'stk-co-arsh-7', qty: 10, unitPrice: 50 }] });
    await expect(svc.purStep(ex, r.id, 'quote', { supplierId: 'sup-co-arsh-1', amount: 500, ref: 'Q1' })).rejects.toThrow(/quotation/);
    await expect(svc.purStep(ex, r.id, 'online', { source: 'Shopee', ref: 'x', amount: 480 })).rejects.toThrow(/screenshot/);
    const q = await svc.purStep(ex, r.id, 'quote', { supplierId: 'sup-co-arsh-1', amount: 500, ref: 'Q1', proof: [proof()] });
    expect(q.quotes[0].docIds).toHaveLength(1);
    // A new supplier: Procurement records the declarations; only Finance (or ACT) reviews and verifies the bank.
    const staff = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active')!;
    staff.bankAccountFull = '5566778899';
    const s = await svc.addPurSupplier(ex, 'co-arsh', { name: 'Shell Trading', ssmNo: 'SSM-1', categories: ['OTHER'], bankName: 'Maybank', bankAccount: '5566778899', coiDeclared: true, abcAck: true });
    expect(s.reviewedOn).toBeNull();
    await expect(svc.purSupplierStep(ex, s.id, 'review', 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.purSupplierStep(fd, s.id, 'verify_bank', 'ok')).rejects.toThrow(/salary account/);
    expect((await svc.purSupplierStep(fd, s.id, 'review', 'ok')).reviewedOn).toBe(TODAY);
  });

  it('never receives more than ordered, sends losses to the company manager, and counts the store with a signed-in witness', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-arsh');
    const ex = await svc.user('u-proc-exec');
    const sk = await svc.user('u-proc-store1');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const r = await svc.raisePurRequest(cm, 'co-arsh', { title: 'Boots', category: 'UNIFORM', lines: [{ item: 'Boots', stockItemId: 'stk-co-arsh-7', qty: 10, unitPrice: 90 }] });
    for (const k of [1, 2, 3]) await svc.purStep(ex, r.id, 'quote', { supplierId: `sup-co-arsh-${k}`, amount: 900 + k, ref: `Q${k}`, proof: [proof()] });
    await svc.purStep(ex, r.id, 'online', { source: 'Shopee', ref: 'x', amount: 900, proof: [proof()] });
    await svc.purStep(ex, r.id, 'submit', { supplierId: 'sup-co-arsh-1' });
    await svc.purStep(coo, r.id, 'approve', { note: 'ok' });
    await svc.purStep(ceo, r.id, 'approve', { note: 'ok' });
    await svc.purStep(ex, r.id, 'order', { ref: 'PO-9' });
    await expect(svc.purStep(sk, r.id, 'receive', { qty: [12] })).rejects.toThrow(/only 10 ordered/);
    await svc.purStep(sk, r.id, 'receive', { qty: [10] });
    // A loss waits for the company manager.
    const person = ds.people.find((p) => p.companyId === 'co-arsh' && p.status === 'active')!;
    const i = await svc.stockIssue(sk, 'co-arsh', { itemId: 'stk-co-arsh-7', personId: person.id, qty: 1 });
    await svc.stockReturn(sk, i.id, 'lost', 'Says it was stolen');
    expect((await svc.purBoard(cm)).losses.find((l) => l.issue.id === i.id)!.canConfirm).toBe(true);
    await expect(svc.confirmStockLoss(sk, i.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.confirmStockLoss(cm, i.id, false, '')).rejects.toThrow(/Say why/);
    await svc.confirmStockLoss(cm, i.id, false, 'Police report needed first');
    expect(ds.stockIssues.find((x) => x.id === i.id)!.returned).toBeNull();
    // The count needs a second person by PIN and never changes the book figure.
    const item = ds.stockItems.find((x) => x.id === 'stk-co-arsh-7')!;
    const book = item.onHand;
    await expect(svc.stockCount(sk, item.id, book - 1, { staffNo: person.staffNo, pin: 'nope' })).rejects.toThrow(/PIN is wrong/);
    const counted = await svc.stockCount(sk, item.id, book - 1, witnessIn(ds, 'co-arsh'));
    expect(counted.onHand).toBe(book);
    expect((await svc.purBoard(sk)).stock.find((s) => s.item.id === item.id)!.countDiff).toBe(-1);
  });

  it('has Head Control review a false alarm closed by another operator, and opens the incident if it was real', async () => {
    const { svc, ds } = fresh();
    const head = await svc.user('u-cms-head');
    const arms = await svc.user('u-pwvsb-arms');
    const tamper = ds.siteAlarms.find((a) => a.kind === 'CAMERA_TAMPER' && a.status === 'new')!;
    await svc.closeAlarm(head, tamper.id, 'false', 'Cleaner moved the camera');
    expect((await svc.cms(head)).ops.falseToReview.some((x) => x.alarm.id === tamper.id)).toBe(true);
    await expect(svc.reviewFalseAlarm(head, tamper.id, true, 'ok')).rejects.toThrow(/Another person/);
    const reviewed = await svc.reviewFalseAlarm(arms, tamper.id, false, 'Camera shows a person at the fence before it moved');
    expect(reviewed.verdict).toBe('real');
    expect(ds.cases.find((c) => c.id === reviewed.caseId)!.companyId).toBe(tamper.companyId);
  });

  it('closes a whistleblowing report only when a second handler agrees, and never a resolved case by the same person', async () => {
    const { svc, ds } = fresh();
    const staff = await svc.user('u-cm-sasa');
    const { code } = await svc.submitWhistle(staff, { anonymous: true, companyId: 'co-sasa', category: 'FRAUD', summary: 'Supplier invoices look inflated every month at the Sasa office.', implicatedUserIds: [] });
    const r = ds.whistleReports.find((x) => x.code === code)!;
    const handler = await svc.user(r.handlerId);
    await svc.whistleStep(handler, r.id, 'close', 'No evidence found');
    expect((await svc.whistleStatus(code)).status).toBe('closing');
    expect((await svc.whistleStatus(code)).outcome).toBeNull();
    await expect(svc.whistleReview(handler, r.id, true, 'ok')).rejects.toBeInstanceOf(Error);
    const second = await svc.user(RULES.assurance.value.whistleHandlers.find((id) => id !== r.handlerId)!);
    expect((await svc.grcBoard(second)).toReview.some((x) => x.report.id === r.id)).toBe(true);
    await svc.whistleReview(second, r.id, false, 'Check the last 3 invoices against the POs');
    expect(ds.whistleReports.find((x) => x.id === r.id)!.status).toBe('investigating');
    await svc.whistleStep(handler, r.id, 'close', 'Invoices match the POs');
    await svc.whistleReview(second, r.id, true, 'ok');
    expect(await svc.whistleStatus(code)).toMatchObject({ status: 'closed', outcome: 'Invoices match the POs' });

    // A company case: whoever resolved it does not close it.
    const cm = await svc.user('u-cm-sasa');
    const c = await svc.raiseCase(cm, { companyId: 'co-sasa', siteId: null, type: 'COMPLAINT', severity: 'P3', title: 'Billing complaint', description: '', proof: [proof()] });
    await svc.updateCase(cm, c.id, 'resolve', 'Credit note issued', [proof()]);
    await expect(svc.updateCase(cm, c.id, 'close', 'Done')).rejects.toThrow(/Another person/);
  });

  it('records the MC serial and refuses it twice, and lets only the person, their manager or HR ask for staff leave', async () => {
    const { svc, ds } = fresh();
    const me = ds.users.find((u) => u.department === 'it' && u.personId)!;
    const colleague = ds.users.find((u) => u.department === 'it' && u.personId && u.id !== me.id)!;
    const base = { personId: me.personId!, kind: 'SICK' as const, from: TODAY, to: TODAY, reason: 'Fever', illness: 'Fever', clinic: 'Klinik Mesra' };
    await expect(svc.requestLeave(me, { ...base, proof: [proof()] })).rejects.toThrow(/serial number/);
    await svc.requestLeave(me, { ...base, mcNo: 'km 00123', proof: [proof()] });
    await expect(svc.requestLeave(me, { ...base, from: addDays(TODAY, 1), to: addDays(TODAY, 1), mcNo: 'KM00123', proof: [proof()] })).rejects.toThrow(/already been used/);
    await expect(
      svc.requestLeave(colleague, { personId: me.personId!, kind: 'ANNUAL', from: addDays(TODAY, 9), to: addDays(TODAY, 9), reason: 'Holiday' }),
    ).rejects.toThrow(/their manager or HR/);
  });
});

describe('IT pilot: buying, eP tenders in minutes, stand-in and logged requests (Fauzan, 28 Oct 2026)', () => {
  it('signs in IT, the COO, the CEO, the ACT head, the HR administrator and the Finance Director during the pilot', async () => {
    const { svc } = fresh();
    const users = await svc.users();
    const ids = users.filter((u) => u.department !== 'it').map((u) => u.id).sort();
    expect(ids).toEqual(['u-audit', 'u-coo', 'u-fauzan', 'u-fd', 'u-pwvsb-hr']);
    expect(users.filter((u) => u.department === 'it').length).toBe(6);
  });

  it('has the CEO approve for the Chief of Staff and Vice Chairman, the Finance Director only pay, and shows the ACT head everything', async () => {
    const { svc, ds } = fresh();
    const fd = await svc.user('u-fauzan');
    const act = await svc.user('u-audit');
    const hr = await svc.user('u-pwvsb-hr');
    // Staff payroll: HR submits; the CEO approves for the Chief of Staff (Fauzan, 28 Oct 2026); the COO approves second
    // and the CEO cannot take that step too (Fauzan, 1 Nov 2026).
    const run = ds.staffPayRuns.find((r) => r.stage === 'draft' && r.lines.length && r.lines.every((l) => l.bank));
    if (run) {
      await svc.staffPayStep(hr, run.id, 'submit');
      await svc.staffPayStep(fd, run.id, 'approve', { note: 'Checked' });
      await expect(svc.staffPayStep(fd, run.id, 'coo_approve', { note: 'OK' })).rejects.toBeInstanceOf(BadRequest);
      expect((await svc.staffPayStep(await svc.user('u-coo'), run.id, 'coo_approve', { note: 'OK' })).stage).toBe('coo_approved');
      expect(ds.audit.some((e) => /CEO for the Chief of Staff \(pilot\)/.test(e.summary))).toBe(true);
    }
    expect(isGroupLeader(act)).toBe(true);
    expect((await svc.groupOverview(act)).length).toBeGreaterThan(30);
  });

  it('keeps Finance Director oversight but denies retired payment-first recording', async () => {
    const { svc, ds } = fresh();
    const fd = await svc.user('u-fd');
    const ex = await svc.user('u-it-ex2');
    const p = ds.itPurchases.find((x) => x.status === 'finance')!;
    const board = await svc.itBoard(fd);
    expect(board.role).toBe('finance');
    if (!p.finance) {
      await expect(svc.itAct(fd, 'buy', { id: p.id, step: 'finance', ref: 'x' })).rejects.toThrow(/to Finance first/);
      await svc.itBuyStep(ex, p.id, 'finance', { ref: 'Teams Approvals: test' });
    }
    expect((await svc.itBoard(fd)).purchases!.find((r) => r.purchase.id === p.id)!.canPay).toBe(false);
    await expect(svc.itAct(fd, 'buy', { id: p.id, step: 'finance', paidRef: '', paidOn: '2026-10-26' })).rejects.toThrow(/assigned Finance PO/);
    await expect(svc.itAct(fd, 'buy', { id: p.id, step: 'finance', paidRef: 'PV-77', paidOn: '2026-10-26' })).rejects.toThrow(/assigned Finance PO/);
    expect((await svc.itBoard(fd)).purchases!.find(r=>r.purchase.id===p.id)!.purchase.status).toBe('finance');
    await expect(svc.itAct(fd, 'buy', { id: p.id, step: 'receive', ref: 'DO' })).rejects.toThrow(/Not allowed/);
    await expect(svc.itAct(fd, 'giveJob', {})).rejects.toThrow(/Not allowed/);
  });

  it('retains three quotes and one evidenced comparison plus COO then CEO, then requires the new PO workflow', async () => {
    const { svc, ds } = fresh();
    const ex = await svc.user('u-it-ex2');
    const coo = await svc.user('u-coo');
    const ceo = await svc.user('u-fauzan');
    const p = ds.itPurchases.find((x) => x.status === 'quoting')!;
    expect(p.purRequestId).toBeNull();
    expect(RULES.itBuy.value.onlineTolerancePct).toBe(5);
    expect(RULES.itBuy.value.onlineChecksNeeded).toBe(1);
    const id = p.id;
    await expect(svc.itBuyStep(ex, id, 'submit', { index: 0 })).rejects.toThrow(/quotes from different suppliers/);
    await expect(svc.itBuyStep(ex, id, 'quote', { supplier: p.quotes![0].supplier, amount: 100, proof: [proof()] })).rejects.toThrow(/already quoted/);
    await expect(svc.itBuyStep(ex, id, 'quote', { supplier: 'Supplier D (mock)', amount: 100 })).rejects.toThrow(/quotation/);
    await svc.itBuyStep(ex, id, 'quote', { supplier: 'Supplier D (mock)', amount: p.total * 2, proof: [proof()] });
    await expect(svc.itBuyStep(ex, id, 'submit', { index: 0 })).rejects.toThrow(/online/);
    await svc.itBuyStep(ex, id, 'online', { source: 'Marketplace A (mock)', ref: 'https://market-a.example/item', amount: p.total, proof: [proof()] });
    await expect(svc.itBuyStep(ex, id, 'submit', { index: 2 })).rejects.toThrow(/not the lowest/);
    expect((await svc.itBuyStep(ex, id, 'submit', { index: 0 })).status).toBe('coo');
    // The CEO does not jump the COO; IT does not decide in Prima.
    await expect(svc.itBuyStep(ceo, id, 'decide', {})).rejects.toThrow(/Only the COO/);
    await expect(svc.itBuyStep(ex, id, 'decide', {})).rejects.toThrow(/Only the COO/);
    await expect(svc.itBuyStep(coo, id, 'decide', { decision: 'approve' })).rejects.toThrow(/Write a comment to approve/);
    expect((await svc.itBuyStep(coo, id, 'decide', { decision: 'approve', note: 'Within the IT plan' })).status).toBe('ceo');
    // The CEO approved in Teams: IT records it, with the Teams reference and a screenshot.
    await expect(svc.itBuyStep(ex, id, 'teams', { teamsRef: 'Approvals: laptops' })).rejects.toThrow(/screenshot/);
    const fin = await svc.itBuyStep(ex, id, 'teams', { teamsRef: 'Approvals: laptops', proof: [proof()] });
    expect(fin).toMatchObject({ status: 'finance', ceoStep: { via: 'teams', recordedBy: ex.name, by: ceo.name } });
    const before = ds.itAssets.length;
    await expect(svc.itBuyStep(ex, id, 'receive', { ref: 'DO-1', proof: [proof()] })).rejects.toThrow(/purchase packet/);
    await svc.itBuyStep(ex, id, 'finance', { ref: 'Teams Approvals: laptops' });
    await expect(svc.itBuyStep(ex,id,'finance',{paidRef:'PV-1',paidOn:TODAY})).rejects.toThrow(/assigned Finance PO/);
    expect(ds.itAssets.length).toBe(before);
    // Full new normal/advance receipt flows and duplicate-safe stock are covered by it-procurement.test.ts.

  });

  it('a rejection needs a reason and stops the purchase', async () => {
    const { svc, ds } = fresh();
    const coo = await svc.user('u-coo');
    const p = ds.itPurchases.find((x) => x.status === 'coo')!;
    await expect(svc.itBuyStep(coo, p.id, 'decide', { decision: 'reject' })).rejects.toThrow(/why/);
    expect((await svc.itBuyStep(coo, p.id, 'decide', { decision: 'reject', note: 'Not this year' })).status).toBe('rejected');
  });

  it('runs an eP tender with its paired executive, in the name of a company holding the codes, step by step against minutes', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const ex1 = await svc.user('u-it-ex1');
    const ex2 = await svc.user('u-it-ex2');
    const lead = await svc.user('u-it-lead');
    const base = { title: 'Supply of CCTV (test)', buyer: 'Test agency', source: 'eP', closesOn: addDays(TODAY, 14), codes: ['210104'], items: ['Technical proposal'], docs: ['MOF certificate'] };
    await expect(svc.setItTenderExec(mgr, 'u-it-lead')).rejects.toThrow(/IT Executive/);
    await expect(svc.setItTenderExec(lead, 'u-it-ex2')).rejects.toThrow(/IT Manager/);
    // Bid only by a company checked to hold the codes, with a MOF certificate in force; PWVSB holds none.
    await expect(svc.addItTender(mgr, { ...base, companyId: 'pwvsb' })).rejects.toThrow(/holds no IT code/);
    await expect(svc.addItTender(mgr, { ...base, companyId: 'co-06' })).rejects.toThrow(/holds no IT code/);
    await expect(svc.addItTender(mgr, { ...base, companyId: 'co-04', codes: ['210101'] })).rejects.toThrow(/MOF certificate/);
    await expect(svc.addItTender(mgr, { ...base, companyId: 'co-inas', codes: ['210102'], closesOn: addDays(TODAY, 40) })).rejects.toThrow(/MOF certificate/);
    await expect(svc.addItTender(mgr, { ...base, companyId: 'co-sasa', codes: ['210103'] })).rejects.toThrow(/does not hold code 210103/);
    const t = await svc.addItTender(mgr, { ...base, companyId: 'co-sasa' });
    expect(t.items.every((x) => x.assigneeId === 'u-it-ex1')).toBe(true);
    expect(t.steps!.find((s) => s.key === 'briefing')).toBeUndefined();
    expect(t.steps!.every((s) => s.key === 'result' || s.minutes === null || s.minutes > 0)).toBe(true);
    const step = (u: typeof mgr, key: string, i: Record<string, unknown> = {}) => svc.itTenderStep(u, t.id, 'step', { key, ...i });
    await expect(step(ex1, 'found')).rejects.toThrow(/for the IT Manager/);
    await step(mgr, 'found');
    await expect(step(ex1, 'download')).rejects.toThrow(/first finish/);
    await step(mgr, 'go');
    await expect(step(ex2, 'download')).rejects.toThrow(/IT tender executive/);
    await step(ex1, 'download');
    await step(mgr, 'askdocs');
    await step(ex1, 'read');
    await expect(step(ex1, 'draft')).rejects.toThrow(/every IT part/);
    // Fauzan, 28 Oct 2026: the file is named as the tender asks, never by the company name, and the technical part
    // carries no company name anywhere.
    await expect(svc.itTenderStep(ex1, t.id, 'done', { index: 0, proof: [proof()] })).rejects.toThrow(/file name the tender asks for first/);
    await expect(svc.itTenderStep(ex1, t.id, 'fileName', { index: 0, fileName: 'Lampiran A' })).rejects.toThrow(/IT Manager writes/);
    await expect(svc.itTenderStep(mgr, t.id, 'fileName', { index: 0, fileName: 'Sasa Security Services - Teknikal' })).rejects.toThrow(/company name/);
    await svc.itTenderStep(mgr, t.id, 'fileName', { index: 0, fileName: 'Lampiran A' });
    await expect(svc.itTenderStep(ex1, t.id, 'done', { index: 0 })).rejects.toThrow(/Attach/);
    await expect(svc.itTenderStep(ex1, t.id, 'done', { index: 0, proof: [proof()], checked: true })).rejects.toThrow(/Rename the file to "Lampiran A"/);
    await expect(svc.itTenderStep(ex1, t.id, 'done', { index: 0, proof: [{ ...proof(), name: 'Lampiran A.pdf' }] })).rejects.toThrow(/checked every page/);
    const part = await svc.itTenderStep(ex1, t.id, 'done', { index: 0, proof: [{ ...proof(), name: 'Lampiran A.pdf' }], checked: true });
    expect(part.items[0].noNameCheck?.by).toBe(ex1.name);
    await step(ex1, 'draft');
    await expect(step(ex1, 'check')).rejects.toThrow(/IT Lead/);
    await step(lead, 'check');
    await step(mgr, 'price');
    // The COO or the CEO sees the price before handover.
    await expect(step(mgr, 'leaders')).rejects.toThrow(/COO or the CEO/);
    expect((await svc.home(await svc.user('u-coo'))).todo.concat((await svc.home(await svc.user('u-coo'))).watch ?? []).some((x) => x.tag === 'IT tender price')).toBe(true);
    await step(await svc.user('u-coo'), 'leaders', { note: 'Price fine' });
    await expect(step(mgr, 'handover', { note: 'Admin exec' })).rejects.toThrow(/company papers received/);
    await svc.itTenderStep(mgr, t.id, 'gotDoc', { index: 0, proof: [proof()] });
    await step(mgr, 'gotdocs');
    await expect(step(mgr, 'handover')).rejects.toThrow(/who in the company/);
    expect((await step(mgr, 'handover', { note: 'Sasa admin executive' })).stage).toBe('handed_over');
    await expect(step(ex1, 'submit')).rejects.toThrow(/slip/);
    let sub = await step(ex1, 'submit', { proof: [proof()] });
    expect(sub.stage).toBe('submitted');
    // The company then checks in eP that the bid is in.
    await expect(step(mgr, 'result', { outcome: 'won' })).rejects.toThrow(/first finish/);
    sub = await step(mgr, 'confirm', { note: 'Company admin saw it in eP' });
    const clock = itTenderClock(sub, NOW);
    expect(clock.totalMin).toBe(0);
    expect(clock.targetMin).toBeGreaterThan(0);
    // A step's clock starts when the step before it is done; past its minutes it is late.
    const fresh2 = await svc.addItTender(mgr, { ...base, companyId: 'co-sasa' });
    const c2 = itTenderClock(fresh2, myt(TODAY, '11:30'));
    const found = c2.rows.find((r) => r.step.key === 'found')!;
    expect(found).toMatchObject({ ready: true, late: true, lateMin: 30 });
    expect(c2.rows.find((r) => r.step.key === 'go')!.ready).toBe(false);
    const board = await svc.itBoard(ex1);
    expect(board.myWork!.tenderSteps!.every((x) => x.step.owner === 'exec')).toBe(true);
    expect((await svc.itBoard(mgr)).myWork!.tenderSteps!.some((x) => x.tenderId === fresh2.id && x.step.key === 'found')).toBe(true);
    expect((await svc.itBoard(ex2)).myWork!.tenderSteps!).toHaveLength(0);
    expect(ds.itTenderTasks.filter((x) => x.kind).length).toBeGreaterThan(2);
    // The COO or CEO opens the price schedule itself; the board carries no file.
    const file = ds.itTenderTasks.find((x) => x.id === t.id)!.items[0].proof![0];
    expect((await svc.itJobProof(await svc.user('u-fauzan'), t.id, file.sha256)).data).toMatch(/^data:/);
  });

  it('the IT Manager records which companies hold IT codes, from the MOF certificate; PWVSB holds none', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const lead = await svc.user('u-it-lead');
    const input = { companyId: 'co-arsh', codes: [{ code: '210104', label: 'Network and CCTV' }], expiresOn: addDays(TODAY, 200), certNo: 'MOF-1', note: '', proof: [proof()] };
    await expect(svc.saveItCodeHolder(lead, input)).rejects.toThrow(/IT Manager/);
    await expect(svc.saveItCodeHolder(mgr, { ...input, companyId: 'pwvsb' })).rejects.toThrow(/group company/);
    await expect(svc.saveItCodeHolder(mgr, { ...input, codes: [{ code: '2101', label: '' }] })).rejects.toThrow(/6 digits/);
    await expect(svc.saveItCodeHolder(mgr, { ...input, proof: [] })).rejects.toThrow(/MOF certificate/);
    await expect(svc.saveItCodeHolder(mgr, { ...input, codes: [], note: '' })).rejects.toThrow(/what was checked/);
    const before = (await svc.itBoard(mgr)).codeCheck!.checked;
    await svc.saveItCodeHolder(mgr, input);
    expect((await svc.itBoard(mgr)).codeCheck!.checked).toBe(before + 1);
    expect(ds.itCodeHolders.find((h) => h.companyId === 'co-arsh')).toMatchObject({ checkedBy: mgr.name, certNo: 'MOF-1' });
    const t = await svc.addItTender(mgr, { title: 'CCTV for a council', buyer: 'Council', source: 'eP', closesOn: addDays(TODAY, 20), companyId: 'co-arsh', codes: ['210104'], items: [], docs: [] });
    expect(t.companyId).toBe('co-arsh');
  });

  it('ACT audits the IT work and HR reads each person’s record; neither can change anything', async () => {
    const { svc, ds } = fresh();
    const act = await svc.user('u-audit');
    const hr = await svc.user('u-pwvsb-hr');
    const a = await svc.itBoard(act);
    expect(a.role).toBe('audit');
    expect(a.audit!.controls.every((c) => c.breaks === 0)).toBe(true);
    expect(a.audit!.exceptions.length).toBeGreaterThan(5);
    expect(a.audit!.exceptions.some((e) => e.area === 'Buying')).toBe(true);
    const h = await svc.itBoard(hr);
    expect(h.role).toBe('hr');
    expect(h.audit).toBeNull();
    expect(h.teamRows!.length).toBe(6);
    expect(h.teamRows!.some((r) => r.tenderSteps > 0)).toBe(true);
    const j = ds.itJobs.find((x) => x.status === 'submitted')!;
    for (const u of [act, hr]) {
      await expect(svc.itAct(u, 'jobStep', { id: j.id, step: 'accept' })).rejects.toThrow();
      await expect(svc.itAct(u, 'logTicket', { raisedFor: 'Someone', channel: 'teams', category: 'M365', priority: 'P3', title: 'x' })).rejects.toThrow();
    }
    const withProof = ds.itJobs.find((x) => x.proof.length)!;
    expect((await svc.itAct(act, 'jobProof', { id: withProof.id, sha256: withProof.proof[0].sha256 }) as { data: string }).data).toBeTruthy();
    // A break in a control shows: someone accepted their own job.
    const acc = ds.itJobs.find((x) => x.status === 'accepted')!;
    acc.acceptedBy = acc.assignee;
    expect((await svc.itBoard(act)).audit!.controls.find((c) => /own job/.test(c.what))!.breaks).toBe(1);
  });

  it('lets the COO, who monitors IT, accept finished work, and records when the IT Manager is away', async () => {
    const { svc, ds } = fresh();
    const mgr = await svc.user('u-it-mgr');
    const coo = await svc.user('u-coo');
    const j = ds.itJobs.find((x) => x.status === 'submitted' && !x.technical)!;
    // Fauzan, 31 Oct 2026: the COO may accept or return any IT job, not only while the IT Manager is away.
    await expect(svc.itJobStep(coo, j.id, 'accept')).rejects.toThrow(/Say why/);
    expect((await svc.itJobStep(coo, j.id, 'accept', 'Proof checked, needed today')).status).toBe('accepted');
    await expect(svc.setItAway(await svc.user('u-it-ex1'), TODAY, TODAY)).rejects.toThrow(/IT Manager or the COO/);
    await svc.setItAway(mgr, addDays(TODAY, -1), addDays(TODAY, 2));
    expect((await svc.itBoard(coo)).away).toBe(true);
    await svc.setItAway(mgr, null, null);
  });

  it('logs a request for someone not on the system, and someone other than the fixer records their answer', async () => {
    const { svc } = fresh();
    const ex2 = await svc.user('u-it-ex2');
    const ex3 = await svc.user('u-it-ex3');
    const input = { raisedFor: 'Sasa admin executive (mock)', channel: 'teams' as const, category: 'M365' as const, priority: 'P3' as const, title: 'Outlook keeps asking for password', detail: '' };
    await expect(svc.logItTicket(ex2, { ...input, raisedFor: '' })).rejects.toThrow(/who asked/);
    const t = await svc.logItTicket(ex2, input);
    expect(t).toMatchObject({ raisedFor: input.raisedFor, channel: 'teams' });
    await svc.itTicketStep(ex2, t.id, 'take');
    await svc.itTicketStep(ex2, t.id, 'resolve', 'Re-signed in and cleared the cached password');
    await expect(svc.recordItConfirm(ex2, t.id, true, 'Teams chat 10:40')).rejects.toThrow(/other than the person who fixed/);
    await expect(svc.recordItConfirm(ex3, t.id, false, 'Teams chat 10:40')).rejects.toThrow(/still wrong/);
    const ok = await svc.recordItConfirm(ex3, t.id, true, 'Teams chat 10:40');
    expect(ok.confirmedAt).toBeTruthy();
    expect(ok.confirmedVia).toMatch(/recorded by/);
  });

  it('lets the IT Manager stand in for company people on the website flow during the pilot', async () => {
    const { svc } = fresh();
    const b = (await svc.websites.board(await svc.user('u-it-mgr'))) as { role: { proxy: boolean } };
    expect(b.role.proxy).toBe(true);
  });
});

describe('staff login retest (27 Oct 2026): work no role could start', () => {
  it('lets the company manager and Operations open a new client, and nobody else', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-inas');
    const om = await svc.user('u-om-klang');
    const hr = await svc.user('u-pwvsb-hr');
    const ae = await svc.user('u-ae-arsh');
    const board = await svc.clientBoard(cm);
    expect(board.canAdd.map((c) => c.companyId)).toEqual(['co-inas']);
    expect((await svc.clientBoard(ae)).canAdd).toEqual([]);
    const site = board.canAdd[0].sites[0];
    const a = await svc.addClientAccount(cm, { companyId: 'co-inas', name: 'Hospital Baru Seremban', siteIds: [site.id], contractEndsOn: '2028-10-31' });
    expect(a.stage).toBe('onboarding');
    expect(a.onboarding.every((s) => !s.doneAt)).toBe(true);
    expect((await svc.clientBoard(om)).accounts.some((x) => x.id === a.id)).toBe(true);
    await expect(svc.addClientAccount(cm, { companyId: 'co-inas', name: 'hospital baru seremban', siteIds: [], contractEndsOn: null })).rejects.toThrow(
      /already a client/,
    );
    await expect(svc.addClientAccount(cm, { companyId: 'co-sasa', name: 'Other company client', siteIds: [], contractEndsOn: null })).rejects.toBeInstanceOf(
      AccessDenied,
    );
    await expect(svc.addClientAccount(hr, { companyId: 'co-inas', name: 'HR cannot add', siteIds: [], contractEndsOn: null })).rejects.toBeInstanceOf(
      AccessDenied,
    );
    const sasaSite = (await svc.clientBoard(om)).canAdd.find((c) => c.companyId === 'co-sasa')!.sites[0];
    await expect(svc.addClientAccount(cm, { companyId: 'co-inas', name: 'Wrong site client', siteIds: [sasaSite.id], contractEndsOn: null })).rejects.toThrow(
      /this company only/,
    );
    const byOm = await svc.addClientAccount(om, { companyId: 'co-sasa', name: 'Kilang Baru Shah Alam', siteIds: [sasaSite.id], contractEndsOn: null });
    expect(byOm.companyId).toBe('co-sasa');
  });

  it('lets the company manager record a signed contract, which opens mobilisation', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const ae = await svc.user('u-ae-arsh');
    const board = await svc.contracts(cm);
    expect(board.canAdd.map((c) => c.companyId)).toEqual(['co-sasa']);
    expect((await svc.contracts(ae)).canAdd).toEqual([]);
    const opt = board.canAdd[0];
    const base = {
      companyId: 'co-sasa',
      clientAccountId: null,
      clientName: 'Pusat Data Cyberjaya',
      siteIds: [opt.sites[0].id],
      startOn: '2026-11-15',
      endOn: '2028-11-14',
      billingMethod: 'M1' as const,
      rate: 11.5,
      fixedFee: null,
      signedRef: 'SASA/CT/NEW-1',
      proof: [proof()],
    };
    await expect(svc.addContract(cm, { ...base, proof: [] })).rejects.toThrow(/copy of the signed contract/);
    await expect(svc.addContract(cm, { ...base, endOn: '2026-11-01' })).rejects.toThrow(/end after it starts/);
    await expect(svc.addContract(cm, { ...base, billingMethod: 'M2' })).rejects.toThrow(/contracted hours/);
    await expect(svc.addContract(ae, { ...base, companyId: 'co-arsh' })).rejects.toBeInstanceOf(AccessDenied);
    const c = await svc.addContract(cm, base);
    expect(c.state).toBe('awarded');
    expect(c.mobilisation.length).toBeGreaterThan(10);
    // The signed paper is the proof of the first item; the rest are open.
    expect(c.mobilisation[0].status).toBe('done');
    expect(c.mobilisation.slice(1).every((i) => i.status === 'open')).toBe(true);
    expect(c.versions[0].posts.every((p) => p.rate === 11.5)).toBe(true);
    await expect(svc.addContract(cm, base)).rejects.toThrow(/already recorded/);
    expect((await svc.contracts(cm)).rows.some((r) => r.contract.id === c.id)).toBe(true);
    await svc.contractStep(cm, c.id, 'mobilise');
    const fixed = await svc.addContract(cm, { ...base, signedRef: 'SASA/CT/NEW-2', billingMethod: 'FIXED', rate: 0, fixedFee: 25000, proof: [proof()] });
    expect(fixed.versions[0].fixedFee).toBe(25000);
  });

  it('gives only the Director Office the report list to change', async () => {
    const { svc } = fresh();
    const doa = await svc.user('u-pwvsb-doa');
    const cm = await svc.user('u-cm-sasa');
    const r = await svc.reports(doa);
    expect(r.canEdit).toBe(true);
    expect(r.editList!.length).toBeGreaterThan(0);
    expect(r.departments.some((d) => d.id === 'finance')).toBe(true);
    const cmView = await svc.reports(cm);
    expect(cmView.editList).toBeNull();
    const kept = r.editList!.slice(1);
    await svc.setReportDefs(
      doa,
      [
        ...kept,
        {
          id: '',
          name: 'IT monthly report',
          detail: 'Tickets and assets',
          from: 'department',
          department: 'it',
          frequency: 'monthly',
          dueDay: 5,
          active: true,
        },
      ],
      'Add the IT report, drop the first',
    );
    const after = await svc.reports(doa);
    expect(after.editList!.some((d) => d.name === 'IT monthly report')).toBe(true);
    expect(after.editList!.some((d) => d.id === r.editList![0].id)).toBe(false);
  });

  it('lets FWM file the utility clause and acknowledgement from the hostel charges', async () => {
    const { svc } = fresh();
    const fwm = await svc.user('u-fwm-mgr');
    const hr = await svc.user('u-pwvsb-hr');
    const b = await svc.hostelBoard(fwm);
    expect(b.charges.length).toBeGreaterThan(0);
    expect(b.charges.every((c) => c.canFilePapers)).toBe(true);
    expect((await svc.hostelBoard(hr)).charges.every((c) => !c.canFilePapers)).toBe(true);
    const row = b.charges.find((c) => !c.clause)!;
    await svc.fileUtilityPaper(fwm, row.charge.personId, 'clause', [proof()]);
    expect((await svc.hostelBoard(fwm)).charges.find((c) => c.charge.id === row.charge.id)!.clause).toBe(true);
  });

  it('lets the company plan and update its armed jobs, with permits and police approval checked', async () => {
    const { svc } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const sv = await svc.user('u-sv-sasa');
    const arms = await svc.arms(cm, 'co-sasa');
    expect(arms.jobs.length).toBeGreaterThan(0);
    expect(arms.crewChoices.length).toBeGreaterThan(1);
    const crew = arms.crewChoices.slice(-2).map((p) => p.id);
    const job = {
      companyId: 'co-sasa',
      kind: 'CIT' as const,
      client: 'Bank Test Berhad',
      detail: 'Branch run, Petaling Jaya to Klang',
      start: myt('2026-10-29', '08:00'),
      end: myt('2026-10-29', '12:00'),
      crew,
      vehicle: 'Armoured van WXX1234',
      states: [arms.homeState ?? 'Selangor'],
      policeApproval: null,
    };
    await expect(svc.planArmedJob(sv, job)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.planArmedJob(cm, { ...job, detail: 'Carrying RM 500000' })).rejects.toThrow(/cash amounts/);
    // No police approval yet is a directors' legal point, not a block on booking (Fauzan, 2 Nov 2026); see special-ops-4b-4h.
    const planned = await svc.planArmedJob(cm, job);
    expect(planned.status).toBe('scheduled');
    await expect(svc.planArmedJob(cm, { ...job, client: 'Another bank' })).rejects.toThrow(/Already on another armed job/);
    const away = await svc.planArmedJob(cm, {
      ...job,
      start: myt('2026-10-30', '08:00'),
      end: myt('2026-10-30', '18:00'),
      states: [arms.homeState ?? 'Selangor', 'Johor'],
      policeApproval: { ref: 'PDRM/APP/1', on: '2026-10-20' },
    });
    expect(away.policeApproval!.ref).toBe('PDRM/APP/1');
    await expect(svc.updateArmedJob(cm, planned.id, 'completed', '')).rejects.toThrow(/Say what happened/);
    // Slice 4D: the job cannot start while it is a no-go (here: no client agreement, police notice or cover on file).
    await expect(svc.updateArmedJob(cm, planned.id, 'in_progress', 'Left the base on time')).rejects.toThrow(/Client agreement/);
    await svc.updateArmedJob(cm, planned.id, 'completed', 'All drops done, firearms back');
    await expect(svc.updateArmedJob(cm, planned.id, 'delayed', 'Late')).rejects.toThrow(/already completed/);
    expect((await svc.arms(cm, 'co-sasa')).jobs.find((j) => j.job.id === planned.id)!.job.status).toBe('completed');
  });
});

describe('roster editing by Operations (Fauzan, 27 Oct 2026)', () => {
  it('lets an Operations Manager assign and publish shifts for the sites they cover, and no others', async () => {
    const { svc, ds } = fresh();
    const om = await svc.user('u-om-klang');
    const hr = await svc.user('u-pwvsb-hr');
    const future = (siteId: string) => ds.shifts.find((s) => s.siteId === siteId && s.status === 'draft' && s.start > '2026-10-28')!;
    // st-inas-001 is in Kuala Lumpur (inside the OM's area); st-inas-002 is in Negeri Sembilan (outside it).
    const inArea = await svc.roster(om, 'st-inas-001', '2026-10-26', 14);
    expect(inArea.canEdit && inArea.canPublish).toBe(true);
    const outside = await svc.roster(om, 'st-inas-002', '2026-10-26', 14);
    expect(outside.canEdit || outside.canPublish).toBe(false);
    const mine = future('st-inas-001');
    expect((await svc.assignShift(om, mine.id, null)).shift.personId).toBeNull();
    const pub = await svc.publishRoster(om, 'st-inas-001', '2026-10-28', '2026-11-08');
    expect(pub.published).toBeGreaterThan(0);
    await expect(svc.assignShift(om, future('st-inas-002').id, null)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.publishRoster(om, 'st-inas-002', '2026-10-28', '2026-11-08')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.assignShift(hr, mine.id, null)).rejects.toThrow();
  });
});

describe('client and contract work goes to the Operations Manager for the area (27 Oct 2026)', () => {
  it('lets only Operations in the client site area act, and marks each row', async () => {
    const { svc, ds } = fresh();
    const klang = await svc.user('u-om-klang');
    const johor = await svc.user('u-om-johor');
    const state = (siteId: string) => ds.branches.find((b) => b.id === ds.sites.find((s) => s.id === siteId)!.branchId)!.state;
    const acct = ds.clientAccounts.find(
      (a) => a.companyId === 'co-sasa' && a.stage === 'onboarding' && a.siteIds.length && ['Selangor', 'Kuala Lumpur'].includes(state(a.siteIds[0])),
    )!;
    const step = acct.onboarding.find((s) => !s.doneAt && !['contract', 'notice', 'handover'].includes(s.key))!;
    expect((await svc.clientBoard(johor)).accounts.find((a) => a.id === acct.id)!.canAct).toBe(false);
    expect((await svc.clientBoard(klang)).accounts.find((a) => a.id === acct.id)!.canAct).toBe(true);
    await expect(svc.clientStep(johor, acct.id, 'onboarding', step.key, 'Done')).rejects.toBeInstanceOf(AccessDenied);
    await svc.clientStep(klang, acct.id, 'onboarding', step.key, 'Done');
    // New clients: only sites in the manager's own area are offered and accepted.
    const offer = (await svc.clientBoard(johor)).canAdd.find((c) => c.companyId === 'co-sasa')!;
    expect(offer.sites.every((s) => state(s.id) === 'Johor')).toBe(true);
    await expect(svc.addClientAccount(johor, { companyId: 'co-sasa', name: 'Outside area', siteIds: [acct.siteIds[0]], contractEndsOn: null })).rejects.toThrow(
      /own area/,
    );
    // Contracts: the Johor OM watches a Klang-area contract; the Klang OM works it.
    const k = ds.contracts.find((c) => c.companyId === 'co-sasa' && c.siteIds.length && ['Selangor', 'Kuala Lumpur'].includes(state(c.siteIds[0])))!;
    expect((await svc.contracts(johor)).rows.find((r) => r.contract.id === k.id)!.role).toBe('view');
    expect((await svc.contracts(klang)).rows.find((r) => r.contract.id === k.id)!.role).toBe('staff');
  });
});

describe('SOCSO claims are view-only for the Chairman, Vice Chairman and Finance Director (27 Oct 2026)', () => {
  it('shows them the claims without the HR buttons or medical papers', async () => {
    const { svc, ds } = fresh();
    const c = ds.socsoClaims.find((x) => x.status === 'DRAFT')!;
    for (const id of ['u-chair', 'u-vchair', 'u-fd']) {
      const u = await svc.user(id);
      const row = (await svc.socsoClaims(u)).rows.find((r) => r.claim.id === c.id)!;
      expect(row.canManage).toBe(false);
      expect((await svc.socsoClaimDetail(u, c.id)).claim.id).toBe(c.id);
      await expect(svc.advanceSocsoClaim(u, c.id, 'REPORTED', { perkesoRef: 'A1234567' })).rejects.toBeInstanceOf(AccessDenied);
      await expect(svc.addSocsoDoc(u, c.id, 'BANK', [proof()])).rejects.toBeInstanceOf(AccessDenied);
    }
    // The COO, Chief of Staff and company still act.
    await svc.advanceSocsoClaim(await svc.user('u-cos'), c.id, 'REPORTED', { perkesoRef: 'A1234567' });
  });
});

describe('Remote and branch work plan (Fauzan, 27 Oct 2026)', () => {
  function clocked() {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const store = new MemoryStore(ds);
    const at = { now: NOW };
    return { ds, store, at, svc: new PrimaService(store, () => at.now) };
  }
  const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

  it('gives each person their playbook duties, tasks from their managers with what done means, and proof before done', async () => {
    const { svc, at } = clocked();
    const me = await svc.user('u-it-ex3');
    const mine = await svc.myWork(me);
    expect(mine.manager!.id).toBe('u-it-lead');
    expect(mine.playbook.key).toBe('it:executive');
    // Today's daily duties are opened once, with their definition of done.
    const queue = mine.open.find((t) => t.playbookItemId === 'it-ex-queue' && t.period === TODAY)!;
    expect(queue.doneMeans).toMatch(/1 working day/);
    expect((await svc.myWork(me)).open.filter((t) => t.playbookItemId === 'it-ex-queue' && t.period === TODAY)).toHaveLength(1);
    // Only someone in their line gives them work.
    const input = { userId: me.id, title: 'Replace the CMS room UPS battery', doneMeans: 'New battery fitted and the UPS self-test passed, photo in the ticket.', dueAt: myt(addDays(TODAY, 2), '17:00'), priority: 'high' as const };
    await expect(svc.workTaskAdd(await svc.user('u-fin-t1-lead'), input)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.workTaskAdd(await svc.user('u-it-lead'), { ...input, doneMeans: 'ok' })).rejects.toThrow(/done/);
    const t = await svc.workTaskAdd(await svc.user('u-it-lead'), input);
    expect(t.source).toBe('assigned');
    expect(t.planner!.state).toBe('pending');
    expect((await svc.workTaskAdd(await svc.user('u-it-mgr'), { ...input, title: 'Check the second UPS' })).assignedBy).toBeTruthy();
    // More time is asked before the time, once, with a reason.
    await expect(svc.workTaskLate(me, t.id, { reason: 'short', newDueAt: myt(addDays(TODAY, 3), '17:00') })).rejects.toThrow(/reason/);
    await svc.workTaskLate(me, t.id, { reason: 'Battery arrives on Wednesday from the supplier.', newDueAt: myt(addDays(TODAY, 3), '17:00') });
    await expect(svc.workTaskDone(me, t.id, { note: '', ref: '' })).rejects.toThrow(/came out/);
    at.now = myt(addDays(TODAY, 3), '15:00');
    const done = await svc.workTaskDone(me, t.id, { note: 'Battery fitted, self-test passed', ref: 'IT-2231' });
    expect(done.onTime).toBe(true);
    await expect(svc.workTaskReview(me, t.id, true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.workTaskReview(await svc.user('u-it-lead'), t.id, false, 'no')).rejects.toThrow(/fix/);
    const back = await svc.workTaskReview(await svc.user('u-it-lead'), t.id, false, 'No photo of the self-test in the ticket.');
    expect(back.status).toBe('returned');
    expect(back.state).toBe('returned');
    await svc.workTaskDone(me, t.id, { note: 'Photo added to the ticket', ref: 'IT-2231' });
    expect((await svc.workTaskReview(await svc.user('u-it-lead'), t.id, true, 'ok')).status).toBe('accepted');
  });

  it('fills the home day plan from the morning check-in, escalates unanswered help after 30 minutes, and records the 1:1', async () => {
    const { svc, at } = clocked();
    const poor = await svc.user('u-fin-t1-de2');
    await expect(svc.workCheckIn(poor, { where: 'home', hours: 'all day', priorities: ['x'], support: '' })).rejects.toThrow(/hours/);
    await svc.workCheckIn(poor, { where: 'home', hours: '09:00-18:00', priorities: ['Key in invoices', 'Team 1 bank reconciliation'], support: '' });
    await expect(svc.workCheckIn(poor, { where: 'home', hours: '09:00-18:00', priorities: ['Again'], support: '' })).rejects.toThrow(/already/);
    const home = await svc.myRemote(poor);
    expect(home.today!.day!.plan!.tasks.map((x) => x.text)).toEqual(['Key in invoices', 'Team 1 bank reconciliation']);
    // Help goes to the team leader; after 30 minutes it shows to the Finance Director too.
    const me = await svc.user('u-fin-t1-de2');
    const h = await svc.helpAsk(me, { text: 'The bank statement file will not open in SQL Account.', taskId: null });
    expect(h.managerId).toBe('u-fin-t1-lead');
    expect((await svc.teamWork(await svc.user('u-fd'))).help.some((x) => x.id === h.id)).toBe(false);
    at.now = myt(TODAY, '11:05');
    expect((await svc.teamWork(await svc.user('u-fd'))).help.find((x) => x.id === h.id)!.escalatedTo).toBe((await svc.user('u-fd')).name);
    await expect(svc.helpAnswer(await svc.user('u-it-lead'), h.id, 'Try again')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.helpAnswer(await svc.user('u-fd'), h.id, 'Ask IT for the converter; use the PDF meanwhile.')).answer!.by).toBeTruthy();
    // The weekly 1:1 is the manager's record.
    await expect(svc.oneOnOneRecord(me, { userId: me.id, notes: 'Talked about the week', agreed: [] })).rejects.toBeInstanceOf(AccessDenied);
    const lead = await svc.user('u-fin-t1-lead');
    const row = (await svc.teamWork(lead)).people.find((p) => p.userId === me.id)!;
    expect(row.oneOnOneDue).toBe(true);
    expect(row.talk.length).toBeGreaterThan(0);
    await svc.oneOnOneRecord(lead, { userId: me.id, notes: 'Went through the missed reports and what blocks them.', agreed: ['Send the report by 17:30 daily'] });
    expect((await svc.teamWork(lead)).people.find((p) => p.userId === me.id)!.oneOnOneDue).toBe(false);
  });

  it('lets working from home start only after probation, playbook sign-off and results at standard, or by written exception', async () => {
    const { svc } = clocked();
    const hr = await svc.user('u-pwvsb-hr');
    const board = await svc.remoteBoard(hr);
    const waiting = board.applications.find((a) => a.arrangement.userId === 'u-fin-t1-de1')!;
    expect(waiting.readiness.ready).toBe(false);
    expect(waiting.readiness.checks.find((c) => c.key === 'probation')!.ok).toBe(false);
    await expect(svc.remoteDecide(hr, waiting.arrangement.id, true, 'ok')).rejects.toThrow(/Not ready/);
    expect((await svc.remoteDecide(hr, waiting.arrangement.id, true, 'Exception: house move, for one month only.')).status).toBe('approved');
    const good = await svc.myWork(await svc.user('u-it-ex1'));
    expect(good.readiness.ready).toBe(true);
    // The manager signs off the playbook; nobody signs off their own.
    const ex4 = await svc.user('u-it-ex4');
    await expect(svc.playbookSignOff(ex4, ex4.id)).rejects.toBeInstanceOf(AccessDenied);
    if (!(await svc.myWork(ex4)).signoff) expect((await svc.playbookSignOff(await svc.user('u-it-lead'), ex4.id)).by).toBeTruthy();
    // The CEO's Monday summary is for group leadership only.
    const sum = await svc.workSummary(await svc.user('u-fauzan'));
    expect(sum.departments.find((d) => d.name === 'IT')!.people).toBeGreaterThan(0);
    expect(sum.branches).toHaveLength(9);
    await expect(svc.workSummary(await svc.user('u-it-lead'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('runs far branches on checklists with photo proof, a scorecard where unknown is never green, and the visit cycle', async () => {
    const { svc } = clocked();
    const bm = await svc.user('u-bm-arsh-2');
    const board = await svc.branchWork(bm);
    expect(board.branches.map((b) => b.id)).toEqual(['br-arsh-2']);
    const penang = board.branches[0];
    expect(penang.score.find((s) => s.key === 'om')!.state).toBe('unknown');
    expect(penang.overall).toBe('red');
    const items = BRANCH_CHECKS.daily.items.map((i) => ({ key: i.key, ok: true, note: '' }));
    await expect(svc.branchCheckSubmit(bm, 'br-arsh-2', { kind: 'daily', items: items.slice(1), proof: { image: PHOTO } })).rejects.toThrow(/every line/);
    await expect(svc.branchCheckSubmit(bm, 'br-arsh-2', { kind: 'daily', items: [{ ...items[0], ok: false }, ...items.slice(1)], proof: { image: PHOTO } })).rejects.toThrow(/wrong/);
    await expect(svc.branchCheckSubmit(bm, 'br-arsh-2', { kind: 'daily', items, proof: null })).rejects.toThrow(/photo/);
    await expect(svc.branchCheckSubmit(bm, 'br-sasa-3', { kind: 'daily', items, proof: { image: PHOTO } })).rejects.toBeInstanceOf(AccessDenied);
    const sent = await svc.branchCheckSubmit(bm, 'br-arsh-2', { kind: 'daily', items, proof: { image: PHOTO, lat: 5.41, lng: 100.33 } });
    expect(sent.proof!.sha256).toHaveLength(64);
    await expect(svc.branchCheckSubmit(bm, 'br-arsh-2', { kind: 'daily', items, proof: { image: PHOTO } })).rejects.toThrow(/already/);
    // Visits: the OM for the state, the Regional OM for the region, ACT unannounced, and at most 2 spot checks a month.
    const findings = { result: 'ok' as const, findings: 'Three sites visited, posts covered.', proof: { image: PHOTO } };
    await expect(svc.branchVisitRecord(await svc.user('u-om-johor'), 'br-arsh-2', { kind: 'om', ...findings })).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.branchVisitRecord(await svc.user('u-om-johor'), 'br-sasa-3', { kind: 'om', ...findings })).announced).toBe(true);
    expect((await svc.branchVisitRecord(await svc.user('u-rom-north'), 'br-arsh-2', { kind: 'rom', ...findings })).kind).toBe('rom');
    expect((await svc.branchVisitRecord(await svc.user('u-act-aud1'), 'br-arsh-2', { kind: 'act', ...findings })).announced).toBe(false);
    const cms = await svc.user('u-cms-head');
    const spot = { kind: 'spot' as const, result: 'issues' as const, findings: 'Video call: guard not at post at 02:10.', proof: null };
    const month = (await svc.branchWork(cms)).branches.find((b) => b.id === 'br-inas-3')!.spotsThisMonth;
    for (let k = month; k < 2; k++) await svc.branchVisitRecord(cms, 'br-inas-3', spot);
    await expect(svc.branchVisitRecord(cms, 'br-inas-3', spot)).rejects.toThrow(/2 spot checks/);
  });

  it('keeps tasks in both Prima and Microsoft Planner, with the newer Planner change winning', async () => {
    const { svc, at } = clocked();
    const ex = await svc.user('u-it-ex2');
    const t = await svc.workTaskAdd(await svc.user('u-it-lead'), {
      userId: ex.id,
      title: 'Renew the sasa.com.my SSL certificate',
      doneMeans: 'New certificate installed, expiry date shown in the asset record.',
      dueAt: myt(addDays(TODAY, 2), '17:00'),
      priority: 'normal',
    });
    await expect(svc.plannerSync(ex)).rejects.toBeInstanceOf(AccessDenied);
    const r = await svc.plannerSync(await svc.user('u-it-mgr'));
    expect(r.mode).toBe('mock');
    expect(r.sent).toBeGreaterThan(0);
    const feed = await svc.user('u-planner-sync');
    await expect(svc.plannerIngest(ex, [])).rejects.toBeInstanceOf(AccessDenied);
    const taskId = `mock-planner-${t.id}`;
    at.now = myt(TODAY, '11:00');
    const older = await svc.plannerIngest(feed, [{ id: taskId, percentComplete: 100, lastModifiedDateTime: myt(TODAY, '09:00') }]);
    expect(older.older).toBe(1);
    const newer = await svc.plannerIngest(feed, [{ id: taskId, percentComplete: 100, lastModifiedDateTime: myt(TODAY, '10:55') }, { id: 'nope' }]);
    expect(newer.applied).toBe(1);
    expect(newer.rejected).toHaveLength(1);
    const after = (await svc.myWork(ex)).waitingReview.find((x) => x.id === t.id)!;
    expect(after.evidence!.ref).toBe(`planner:${taskId}`);
    // The line manager still accepts it in Prima.
    expect((await svc.workTaskReview(await svc.user('u-it-lead'), t.id, true, 'ok')).status).toBe('accepted');
  });
});
