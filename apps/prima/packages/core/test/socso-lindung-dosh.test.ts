import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  addDays,
  dependantShareGuide,
  dependantsAbroadGaps,
  doshClock,
  doshSuggest,
  generateDataset,
  lindungChecks,
  myt,
  socsoDocItems,
  socsoForm34Clock,
} from '../src';

// Synthetic data only: the generated mock dataset (5 Nov 2026 build of LINDUNG, dependants abroad and the DOSH notice).
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

let n = 0;
function proof() {
  n += 1;
  return { kind: 'document' as const, name: `Paper ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 socso ${n}`).toString('base64')}` };
}

describe('LINDUNG 24 Jam claims', () => {
  it('has its own papers and no 48-hour Form 34 clock, because the worker applies', () => {
    const items = socsoDocItems('NON_WORK_ACCIDENT', 'MY').map((i) => i.id);
    expect(items).toContain('APPLICATION');
    expect(items).not.toContain('FORM34');
    expect(socsoDocItems('NON_WORK_ACCIDENT', 'NP').find((i) => i.id === 'BANK')!.required).toBe(true);
    expect(socsoForm34Clock({ toldAt: myt(TODAY, '08:00'), reportedAt: null, type: 'NON_WORK_ACCIDENT' }, myt('2026-11-09', '08:00')).state).toBe('not_needed');
    expect(socsoForm34Clock({ toldAt: myt(TODAY, '08:00'), reportedAt: null, type: 'WORK_ACCIDENT' }, myt('2026-11-09', '08:00')).state).toBe('overdue');
  });

  it('warns when the work pass had expired or the worker was on duty', () => {
    const base = { nationality: 'NP' as const, incidentOn: TODAY, onDuty: false, unpaidLeave: false, status: 'active' };
    expect(lindungChecks({ ...base, plksExpiresOn: '2026-10-01' }).some((x) => x.level === 'warn' && /expired/.test(x.text))).toBe(true);
    expect(lindungChecks({ ...base, plksExpiresOn: null }).some((x) => /No work pass/.test(x.text))).toBe(true);
    expect(lindungChecks({ ...base, plksExpiresOn: '2027-01-01', onDuty: true }).some((x) => /work accident/.test(x.text))).toBe(true);
    expect(lindungChecks({ ...base, nationality: 'MY', lindungOptOut: true, plksExpiresOn: null })[0].level).toBe('block');
  });

  it('records the application and the employment answer; only HR answers PERKESO', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-cm-sasa');
    const seeded = ds.socsoClaims.find((c) => c.type === 'NON_WORK_ACCIDENT')!;
    const d = await svc.socsoClaimDetail(hr, seeded.id);
    expect(d.form34.state).toBe('not_needed');
    expect(d.lindung!.verifyClock).not.toBeNull();
    expect(d.lindungChecks!.length).toBeGreaterThan(0);
    const sup = ds.users.find((u) => u.role === 'supervisor' && u.companyIds.includes('co-sasa') && !u.opsTier)!;
    await expect(svc.verifyLindung(sup, seeded.id, 'EMPLOYED', '')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.verifyLindung(hr, seeded.id, 'NOT_EMPLOYED', '')).rejects.toThrow(/why/);
    await svc.verifyLindung(hr, seeded.id, 'EMPLOYED', '');
    await expect(svc.verifyLindung(hr, seeded.id, 'EMPLOYED', '')).rejects.toThrow(/already/);
    const after = await svc.socsoClaimDetail(hr, seeded.id);
    expect(after.lindung!.record.verify!.answer).toBe('EMPLOYED');
    expect(after.lindung!.verifyClock).toBeNull();
    const reported = await svc.advanceSocsoClaim(hr, seeded.id, 'REPORTED', { perkesoRef: 'LF-TEST-1' });
    expect(reported.history.at(-1)!.what).toMatch(/LINDUNG application/);
    // The steps are only for a LINDUNG claim.
    const work = ds.socsoClaims.find((c) => c.type === 'WORK_ACCIDENT' && c.companyId === 'co-sasa')!;
    await expect(svc.recordLindung(hr, work.id, { channel: 'PORTAL' })).rejects.toThrow(/not for this kind/);
  });

  it('refuses "employed" while the app shows unpaid leave, unless HR explains', async () => {
    const { svc, ds, store } = fresh();
    const hr = await svc.user('u-cm-sasa');
    const seeded = ds.socsoClaims.find((c) => c.type === 'NON_WORK_ACCIDENT')!;
    const day = seeded.incidentAt.slice(0, 10);
    await store.insert('leaveRequests', {
      id: 'lv-test-unpaid',
      companyId: seeded.companyId,
      personId: seeded.personId,
      kind: 'UNPAID',
      from: day,
      to: day,
      days: 1,
      reason: 'test',
      proofIds: [],
      requestedAt: NOW,
      requestedBy: 'test',
      via: 'company',
      status: 'approved',
      decidedBy: 'test',
      decidedAt: NOW,
      decisionNote: null,
    });
    await expect(svc.verifyLindung(hr, seeded.id, 'EMPLOYED', '')).rejects.toThrow(/unpaid leave/);
    await svc.verifyLindung(hr, seeded.id, 'UNPAID_LEAVE', 'Approved unpaid leave that day');
  });
});

describe("Dependants of a foreign worker who died", () => {
  it('shows PERKESO’s published shares only as a guide, and the gaps before payment abroad', () => {
    const s = dependantShareGuide([
      { id: 'a', relation: 'SPOUSE' },
      { id: 'b', relation: 'CHILD' },
      { id: 'c', relation: 'CHILD' },
    ]);
    expect(s.map((x) => x.share)).toEqual([0.6, 0.2, 0.2]);
    expect(dependantShareGuide([{ id: 'p', relation: 'PARENT' }])[0].share).toBeNull();
    const gaps = dependantsAbroadGaps({ people: [], embassyToldAt: null, immigrationToldAt: null }, 'NP');
    expect(gaps.join(' ')).toMatch(/embassy/);
  });

  it('keeps dependants and payments for HR, with proof, and hides them from others', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-ae-arsh');
    const death = ds.socsoClaims.find((c) => c.type === 'DEATH')!;
    const v = await svc.socsoClaimDetail(hr, death.id);
    expect(v.dependants!.record.people.length).toBe(2);
    expect(v.dependants!.gaps.join(' ')).toMatch(/route not yet confirmed/);
    await expect(svc.addDependantPayment(hr, death.id, { kind: 'FUNERAL', amount: 3000, paidOn: TODAY, perkesoRef: 'PAY-2', proof: [] })).rejects.toThrow(/Attach/);
    await expect(svc.addDependantPayment(hr, death.id, { kind: 'FUNERAL', amount: -1, paidOn: TODAY, perkesoRef: 'PAY-2', proof: [proof()] })).rejects.toThrow(/amount/);
    const paid = await svc.addDependantPayment(hr, death.id, { dependantId: 'dp-seed-1', kind: 'FUNERAL', amount: 3000, paidOn: TODAY, perkesoRef: 'PAY-2', proof: [proof()] });
    const pay = paid.dependants!.payments.find((p) => p.perkesoRef === 'PAY-2')!;
    await expect(svc.addDependantPayment(hr, death.id, { dependantId: 'dp-seed-1', kind: 'FUNERAL', amount: 3000, paidOn: TODAY, perkesoRef: 'PAY-2', proof: [proof()] })).rejects.toThrow(/already/);
    await expect(svc.confirmDependantReceived(hr, death.id, pay.id, { on: addDays(TODAY, -1), proof: [proof()] })).rejects.toThrow(/on or after/);
    await svc.confirmDependantReceived(hr, death.id, pay.id, { on: TODAY, proof: [proof()] });
    await expect(svc.confirmDependantRoute(hr, death.id, 'dp-seed-1', { route: 'PERKESO_OVERSEAS_BANK', perkesoOfficer: '', on: TODAY })).rejects.toThrow(/officer/);
    await svc.confirmDependantRoute(hr, death.id, 'dp-seed-1', { route: 'PERKESO_OVERSEAS_BANK', perkesoOfficer: 'Counter officer (test)', on: TODAY });
    await svc.addDependantPaper(hr, death.id, 'dp-seed-1', 'translation', [proof()]);
    await svc.recordDeathNotice(hr, death.id, 'immigration', NOW);
    const after = await svc.socsoClaimDetail(hr, death.id);
    expect(after.dependants!.gaps.some((g) => g.startsWith('Wife'))).toBe(false);
    expect(after.dependants!.totalPaid).toBe(7500);
    // Operations may follow the claim but never see the family's details.
    const om = ds.users.find((u) => u.department === 'operations' && u.opsTier === 'om' && u.companyIds.includes('co-arsh'));
    if (om) {
      const seen = await svc.socsoClaimDetail(om, death.id).catch(() => null);
      if (seen) expect(seen.dependants).toBeNull();
      await expect(svc.addSocsoDependant(om, death.id, { name: 'X Y', relation: 'CHILD', country: 'Nepal' })).rejects.toBeInstanceOf(AccessDenied);
    }
  });
});

describe('DOSH accident notice (OSHA 1994 s.32, NADOPOD 2004)', () => {
  it('suggests the level and counts 7 working days for the form', () => {
    expect(doshSuggest({ type: 'WORK_ACCIDENT', mcs: [{ from: '2026-11-02', to: '2026-11-06' }] })).toBe('OVER_4_DAYS');
    expect(doshSuggest({ type: 'WORK_ACCIDENT', mcs: [{ from: '2026-11-02', to: '2026-11-05' }] })).toBeNull();
    expect(doshSuggest({ type: 'COMMUTING', mcs: [{ from: '2026-11-02', to: '2026-11-20' }] })).toBeNull();
    expect(doshSuggest({ type: 'OCCUPATIONAL_DISEASE', mcs: [] })).toBe('DISEASE');
    const c = doshClock({ kind: 'SERIOUS', from: '2026-11-06', immediate: null, form: null }, '2026-11-06');
    expect(c.formDue).toBe('2026-11-17'); // Friday + 7 working days, weekends skipped
    expect(c.overdue).toBe(true); // the immediate notice is owed at once
    expect(doshClock({ kind: 'MINOR', from: TODAY, immediate: null, form: null }, TODAY).form).toBeNull();
    expect(doshClock({ kind: 'DISEASE', from: TODAY, immediate: null, form: null }, TODAY).form).toBe('JKKP7');
  });

  it('runs the notice: assess, tell DOSH at once for serious cases, send JKKP 6, then the register', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-cm-sasa');
    const work = ds.socsoClaims.find((c) => c.type === 'WORK_ACCIDENT' && c.companyId === 'co-sasa')!;
    await expect(svc.assessDosh(hr, work.id, 'MINOR', 'ok')).rejects.toThrow(/reason|more detail/);
    await expect(svc.assessDosh(hr, work.id, 'MINOR', 'short MC')).rejects.toThrow(/more detail/);
    await svc.assessDosh(hr, work.id, 'SERIOUS', 'Clinic X-ray shows an ankle fracture');
    await expect(svc.recordDoshForm(hr, work.id, { on: TODAY, ref: 'JKKP-1', proof: [proof()] })).rejects.toThrow(/immediate notice/);
    await expect(svc.recordDoshImmediate(hr, work.id, { at: NOW, means: 'Phone', office: 'DOSH Selangor (test)', ref: '' })).rejects.toThrow(/officer/);
    await svc.recordDoshImmediate(hr, work.id, { at: NOW, means: 'Phone', office: 'DOSH Selangor (test)', ref: 'Duty officer (test)' });
    await expect(svc.assessDosh(hr, work.id, 'OVER_4_DAYS', 'Lower it after all')).rejects.toThrow(/already been told/);
    const sent = await svc.recordDoshForm(hr, work.id, { on: TODAY, ref: 'JKKP-1', proof: [proof()] });
    expect(sent.dosh!.form!.form).toBe('JKKP6');
    await svc.recordDoshClientTold(hr, work.id, NOW);
    const reg = await svc.doshRegister(hr, 2026);
    expect(reg.due).toBe('2027-01-31');
    const row = reg.rows.find((r) => r.claimId === work.id)!;
    expect(row.clock!.owed).toEqual([]);
    // Commuting cases are not workplace accidents for DOSH.
    const commute = ds.socsoClaims.find((c) => c.type === 'COMMUTING')!;
    await expect(svc.assessDosh(await svc.user('u-ae-arsh'), commute.id, 'MINOR', 'Road graze only')).rejects.toThrow(/not workplace accidents/);
    expect(reg.rows.some((r) => r.claimId === commute.id)).toBe(false);
  });

  it('flags the seeded death as overdue for JKKP 6 and keeps operations out of the DOSH steps', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-ae-arsh');
    const death = ds.socsoClaims.find((c) => c.type === 'DEATH')!;
    const v = await svc.socsoClaimDetail(hr, death.id);
    expect(v.dosh!.clock!.immediateDone).toBe(true);
    expect(v.dosh!.clock!.overdue).toBe(true);
    const guard = await svc.user('u-guard-sasa-1');
    await expect(svc.assessDosh(guard, death.id, 'MINOR', 'not allowed here')).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('Review fixes (5 Nov 2026)', () => {
  it('never shows the family details to a viewer who is not HR, in the claim or the list', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-cm-sasa');
    const viewer = ds.users.find((u) => u.role === 'supervisor' && u.companyIds.includes('co-sasa') && !u.opsTier)!;
    const guard = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.status === 'active' && !ds.socsoClaims.some((c) => c.personId === p.id))!;
    const c = await svc.startSocsoClaim(hr, guard.id, {
      type: 'DEATH',
      incidentAt: myt(TODAY, '03:10'),
      toldAt: myt(TODAY, '04:00'),
      place: 'Site (test)',
      description: 'Died on duty at the site (synthetic test record).',
    });
    await svc.addSocsoDependant(hr, c.id, { name: 'Wife (synthetic)', relation: 'SPOUSE', country: 'Malaysia', relationProof: [proof()] });
    const v = await svc.socsoClaimDetail(viewer, c.id);
    expect(v.can.manage).toBe(false);
    expect(v.dependants).toBeNull();
    expect((v.claim as { dependants?: unknown }).dependants).toBeUndefined();
    expect(v.extraDocs.length).toBe(0);
    const list = await svc.socsoClaims(viewer);
    const row = list.rows.find((r) => r.claim.id === c.id)!;
    expect(JSON.stringify(row)).not.toMatch(/Wife \(synthetic\)/);
    await expect(svc.addSocsoDependant(viewer, c.id, { name: 'X Y', relation: 'CHILD', country: 'Malaysia' })).rejects.toBeInstanceOf(AccessDenied);
    // HR still sees them.
    expect((await svc.socsoClaimDetail(hr, c.id)).dependants!.record.people.length).toBe(1);
  });

  it('does not let an HR person run the PERKESO and DOSH steps on their own claim', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-ae-arsh');
    const own = ds.people.find((p) => p.id === hr.personId)!;
    own.lindungOptOut = false;
    // Office-staff claims belong to central HR; the company manager monitors only.
    const c = await svc.startSocsoClaim(await svc.user('u-pwvsb-hr'), own.id, {
      type: 'NON_WORK_ACCIDENT',
      incidentAt: myt(TODAY, '07:10'),
      toldAt: myt(TODAY, '08:00'),
      place: 'Road (test)',
      description: 'Road accident on a rest day, wrist sprain (test).',
    });
    await expect(svc.recordLindung(hr, c.id, { channel: 'PORTAL' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.recordLindung(await svc.user('u-pwvsb-hr'), c.id, { channel: 'PORTAL', verifyAskedAt: NOW });
  });

  it('refuses a second notice, a client notice before the accident, and a changed request time after the answer', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-ae-arsh');
    const death = ds.socsoClaims.find((c) => c.type === 'DEATH')!;
    await expect(svc.recordDeathNotice(hr, death.id, 'embassy', NOW)).rejects.toThrow(/already recorded/);
    const sasa = await svc.user('u-cm-sasa');
    const work = ds.socsoClaims.find((c) => c.type === 'WORK_ACCIDENT' && c.companyId === 'co-sasa')!;
    await expect(svc.recordDoshClientTold(sasa, work.id, myt('2026-10-01', '08:00'))).rejects.toThrow(/before the accident/);
    await svc.recordDoshClientTold(sasa, work.id, NOW);
    await expect(svc.recordDoshClientTold(sasa, work.id, NOW)).rejects.toThrow(/Already/);
    await expect(svc.recordDoshImmediate(hr, death.id, { at: NOW, means: 'Email', office: 'DOSH (test)', ref: 'Officer (test)' })).rejects.toThrow(/already recorded/);
    const l = ds.socsoClaims.find((c) => c.type === 'NON_WORK_ACCIDENT')!;
    await svc.verifyLindung(sasa, l.id, 'EMPLOYED', '');
    await expect(svc.recordLindung(sasa, l.id, { verifyAskedAt: null })).rejects.toThrow(/already confirmed/);
  });

  it('keeps both changes when two HR steps land on the same claim', async () => {
    const { svc, ds } = fresh();
    const hr = await svc.user('u-ae-arsh');
    const death = ds.socsoClaims.find((c) => c.type === 'DEATH')!;
    await Promise.all([
      svc.addSocsoDependant(hr, death.id, { name: 'Daughter (test)', relation: 'CHILD', country: 'Nepal' }),
      svc.recordDeathNotice(hr, death.id, 'immigration', NOW),
    ]);
    const v = await svc.socsoClaimDetail(hr, death.id);
    expect(v.dependants!.record.people.some((p) => p.name === 'Daughter (test)')).toBe(true);
    expect(v.dependants!.record.immigrationToldAt).not.toBeNull();
  });
});
