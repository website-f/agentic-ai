import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, addMinutes, generateDataset, myt, type Dataset } from '../src';

// Real-use PDPA registers and insurance policy register (5 Nov 2026). Synthetic seed data only.
const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

let n = 0;
function doc(): { kind: 'document'; name: string; data: string } {
  n += 1;
  return { kind: 'document', name: `Signed form ${n}.pdf`, data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 real use ${n}`).toString('base64')}` };
}

function fresh(): { ds: Dataset; svc: PrimaService; store: MemoryStore } {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  return { ds, store, svc: new PrimaService(store, () => NOW) };
}

const entry = {
  companyId: 'co-sasa',
  activity: 'Visitor log at client sites',
  system: 'Prima: Site visits',
  subjects: ['visitor' as const],
  dataKinds: 'Name, phone, vehicle plate',
  sensitive: false,
  purpose: 'Site security',
  basis: 'CONSENT' as const,
  retentionDays: null as number | null,
  disposal: '',
  sharedWith: '',
  outsideMalaysia: '',
  ownerDept: 'Operations',
  noticeGiven: false,
  dpia: 'not_needed' as const,
};

describe('PDPA personal data register', () => {
  it('lets only the PDPA officer keep it; the Operations Director views; others are refused', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-pdpa');
    const opsdir = await svc.user('u-opsdir');
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.pdpaRegisterBoard(hr)).rejects.toBeInstanceOf(AccessDenied);
    const mon = await svc.pdpaRegisterBoard(opsdir);
    expect(mon.role).toBe('monitor');
    await expect(svc.savePdpaRegisterItem(opsdir, null, entry)).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.pdpaRegisterStep(opsdir, 'pdr-seed-1', 'review', '')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.recordPdpaConsent(opsdir, { registerId: 'pdr-seed-1', subjectName: 'X', subjectRef: 'PW-9', subjectKind: 'staff', noticeVersion: 'v1', givenOn: TODAY }, [doc()])).rejects.toBeInstanceOf(AccessDenied);
    // Seeded: one reviewed 400 days ago is due; one with no retention and no impact assessment needs work.
    const board = await svc.pdpaRegisterBoard(officer);
    expect(board.rows.find((r) => r.item.id === 'pdr-seed-3')!.state).toBe('review_due');
    const dashcam = board.rows.find((r) => r.item.id === 'pdr-seed-4')!;
    expect(dashcam.state).toBe('incomplete');
    expect(dashcam.problems).toEqual(expect.arrayContaining(['No retention period', 'Sensitive data: impact assessment not done']));
    expect(board.rows.find((r) => r.item.id === 'pdr-seed-1')!.consentsGiven).toBe(1);
  });

  it('never marks an incomplete entry reviewed, and keeps a retired entry unchanged', async () => {
    const { svc, ds } = fresh();
    const officer = await svc.user('u-pdpa');
    const added = await svc.savePdpaRegisterItem(officer, null, entry);
    const row = (await svc.pdpaRegisterBoard(officer)).rows.find((r) => r.item.id === added.id)!;
    expect(row.state).toBe('incomplete');
    await expect(svc.pdpaRegisterStep(officer, added.id, 'review', '')).rejects.toThrow(/Fix these first/);
    await svc.savePdpaRegisterItem(officer, added.id, { ...entry, retentionDays: 30, disposal: 'Deleted after 30 days', noticeGiven: true });
    await svc.pdpaRegisterStep(officer, added.id, 'review', 'Checked with Operations');
    expect((await svc.pdpaRegisterBoard(officer)).rows.find((r) => r.item.id === added.id)!.state).toBe('ok');
    // Sensitive data on plain consent is refused as incomplete.
    const face = await svc.savePdpaRegisterItem(officer, null, { ...entry, activity: 'Face at gate', sensitive: true, retentionDays: 30, disposal: 'x', noticeGiven: true, dpia: 'done' });
    expect((await svc.pdpaRegisterBoard(officer)).rows.find((r) => r.item.id === face.id)!.problems).toContain(
      'Sensitive data needs explicit consent or another sensitive-data ground',
    );
    await expect(svc.pdpaRegisterStep(officer, added.id, 'retire', '')).rejects.toThrow(/why the entry is retired/);
    await svc.pdpaRegisterStep(officer, added.id, 'retire', 'Visitor log moved to the client system; our copies deleted');
    await expect(svc.savePdpaRegisterItem(officer, added.id, entry)).rejects.toThrow(/retired/);
    await expect(svc.pdpaRegisterStep(officer, added.id, 'review', '')).rejects.toThrow(/already retired/);
    const actions = ds.audit.filter((a) => a.entityId === added.id).map((a) => a.action);
    expect(actions).toEqual(['pdpa.register.add', 'pdpa.register.edit', 'pdpa.register.review', 'pdpa.register.retire']);
  });

  it('records consent only with the signed form, never by IC number, once per person, and keeps withdrawals', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-pdpa');
    const base = { registerId: 'pdr-seed-1', subjectName: 'Staff C (mock)', subjectRef: 'PW-0003', subjectKind: 'staff' as const, noticeVersion: 'v1 Oct 2026', givenOn: TODAY };
    await expect(svc.recordPdpaConsent(officer, base, [])).rejects.toThrow(/signed consent form/);
    await expect(svc.recordPdpaConsent(officer, { ...base, subjectRef: '900101-14-5678' }, [doc()])).rejects.toThrow(/not the IC number/);
    await expect(svc.recordPdpaConsent(officer, { ...base, givenOn: addDays(TODAY, 1) }, [doc()])).rejects.toThrow(/not in the future/);
    await expect(svc.recordPdpaConsent(officer, { ...base, registerId: 'pdr-seed-3', subjectKind: 'guard' }, [doc()])).rejects.toThrow(/does not rely on consent/);
    await expect(svc.recordPdpaConsent(officer, { ...base, subjectKind: 'guard' }, [doc()])).rejects.toThrow(/does not cover/);
    const c = await svc.recordPdpaConsent(officer, base, [doc()]);
    expect(c.docId).toBeTruthy();
    await expect(svc.recordPdpaConsent(officer, { ...base, subjectRef: 'pw-0003' }, [doc()])).rejects.toThrow(/already has a live consent/);
    await expect(svc.withdrawPdpaConsent(officer, c.id, TODAY, '')).rejects.toThrow(/how the person withdrew/);
    await svc.withdrawPdpaConsent(officer, c.id, TODAY, 'Email to the PDPA officer; location stops today');
    await expect(svc.withdrawPdpaConsent(officer, c.id, TODAY, 'again')).rejects.toThrow(/already withdrawn/);
    // Withdrawn stays on the register; the person may sign again later.
    const board = await svc.pdpaRegisterBoard(officer);
    expect(board.consents.find((x) => x.consent.id === c.id)!.consent.withdrawn!.on).toBe(TODAY);
    await svc.recordPdpaConsent(officer, base, [doc()]);
  });
});

describe('PDPA breach register', () => {
  it('needs the data involved and cause before closing, and keeps the entry 2 years after closing', async () => {
    const { svc } = fresh();
    const officer = await svc.user('u-pdpa');
    const opsdir = await svc.user('u-opsdir');
    const b = await svc.openPdpaCase(officer, { kind: 'BREACH', companyId: 'co-sasa', title: 'Payslips emailed to the wrong staff', detail: '', affected: 3, significantHarm: false });
    const b2 = await svc.openPdpaCase(officer, { kind: 'BREACH', companyId: 'co-sasa', title: 'Second breach the same minute', detail: '', affected: 1 });
    expect(b2.id).not.toBe(b.id);
    expect((await svc.pdpaBoard(officer)).counts.registerIncomplete).toBe(2);
    await svc.pdpaStep(officer, b.id, 'commissioner', 'Form sent', [doc()]);
    await expect(svc.pdpaStep(officer, b.id, 'close', 'Recalled')).rejects.toThrow(/breach register details/);
    await expect(svc.pdpaBreachDetails(opsdir, b.id, { dataKinds: 'x', cause: 'yyy', remedy: '' })).rejects.toBeInstanceOf(AccessDenied);
    await svc.pdpaBreachDetails(officer, b.id, { dataKinds: 'Names, pay', cause: 'Wrong mail merge list', remedy: 'Second person checks the list' });
    const closed = await svc.pdpaStep(officer, b.id, 'close', 'Recalled and deleted by the three staff');
    expect(closed.closedAt).toBe(NOW);
    expect(closed.keepUntil).toBe(addDays(TODAY, 731));
    await expect(svc.pdpaBreachDetails(officer, b.id, { dataKinds: 'changed', cause: 'changed', remedy: '' })).rejects.toThrow(/closed/);
    const board = await svc.pdpaBoard(opsdir);
    expect(board.rules.keepYears).toBe(2);
    expect(board.cases.find((c) => c.id === b.id)!.breach!.cause).toBe('Wrong mail merge list');
  });
});

describe('Insurance policy register', () => {
  it('records a premium paid only with a payment reference, for a company the person keeps', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const other = await svc.user('u-cm-arsh');
    const unpaid = ds.insurancePolicies.find((p) => p.companyId === 'co-sasa' && p.kind === 'MOTOR_FLEET')!;
    expect(unpaid.premiumPayment).toBeNull();
    await expect(svc.recordInsurancePremium(other, unpaid.id, { paidOn: TODAY, ref: 'PV-1234' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.recordInsurancePremium(cm, unpaid.id, { paidOn: TODAY, ref: '' })).rejects.toThrow(/payment reference/);
    await expect(svc.recordInsurancePremium(cm, unpaid.id, { paidOn: addDays(TODAY, 2), ref: 'PV-1234' })).rejects.toThrow(/not in the future/);
    await svc.recordInsurancePremium(cm, unpaid.id, { paidOn: TODAY, ref: 'PV-1234' });
    await expect(svc.recordInsurancePremium(cm, unpaid.id, { paidOn: TODAY, ref: 'PV-9999' })).rejects.toThrow(/already recorded/);
    const row = (await svc.insurance(cm)).policies.find((r) => r.policy.id === unpaid.id)!;
    expect(row.premium).toBe('paid');
    expect(row.paidWithoutRef).toBe(false);
    expect(ds.audit.some((a) => a.action === 'insurance.premium' && a.entityId === unpaid.id)).toBe(true);
  });

  it('renews into a new record so last year stays on the register, once per year', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const old = ds.insurancePolicies.find((p) => p.companyId === 'co-sasa' && p.kind === 'GROUP_PERSONAL_ACCIDENT')!;
    const start = addDays(old.expiresOn, 1);
    const input = { insurer: 'Mock Insurer', broker: null, policyNo: 'GPA-NEW-1', sumInsured: 500_000, premium: 9000, startsOn: start, expiresOn: addDays(start, 364), premiumDueOn: start, scheduleRef: 'SharePoint: Insurance/GPA 2027.pdf' };
    await expect(svc.renewInsurancePolicy(cm, old.id, { ...input, expiresOn: start })).rejects.toThrow(/expire after it starts/);
    const next = await svc.renewInsurancePolicy(cm, old.id, input);
    expect(next.renewsId).toBe(old.id);
    expect(next.premiumPayment).toBeNull();
    const stored = ds.insurancePolicies.find((p) => p.id === old.id)!;
    expect(stored.renewedById).toBe(next.id);
    expect(stored.policyNo).toBe(old.policyNo);
    await expect(svc.renewInsurancePolicy(cm, old.id, { ...input, policyNo: 'GPA-NEW-2' })).rejects.toThrow(/already renewed/);
    // The form can no longer overwrite a closed policy year.
    await expect(svc.saveRecord(cm, 'insurancePolicy', old.id, 'co-sasa', { ...old, expiresOn: addDays(old.expiresOn, 365) } as never)).rejects.toThrow(/kept as history/);
    const view = await svc.insurance(cm);
    const oldRow = view.policies.find((r) => r.policy.id === old.id)!;
    expect(oldRow.renewedBy!.id).toBe(next.id);
    expect(view.alerts.some((a) => a.kind === 'Renewal' && a.detail.includes(old.policyNo))).toBe(false);
    // Last year's renewed public liability (seeded) is history, not cover.
    expect(view.history.some((h) => h.why === 'renewed' && h.policy.id.endsWith('-prev'))).toBe(true);
    expect(view.policies.some((r) => r.policy.id.endsWith('-prev'))).toBe(false);
  });

  it('cancelling a renewal puts last year back on the register, so a gap in cover shows again', async () => {
    const { svc, ds } = fresh();
    const cm = await svc.user('u-cm-sasa');
    const old = ds.insurancePolicies.find((p) => p.companyId === 'co-sasa' && p.kind === 'GROUP_PERSONAL_ACCIDENT')!;
    const start = addDays(old.expiresOn, 1);
    const next = await svc.renewInsurancePolicy(cm, old.id, { insurer: 'Mock Insurer', broker: null, policyNo: 'GPA-NEW-1', sumInsured: 500_000, premium: 9000, startsOn: start, expiresOn: addDays(start, 364), premiumDueOn: start, scheduleRef: null });
    await expect(svc.cancelInsurancePolicy(cm, next.id, { on: addDays(TODAY, 1), reason: 'Insurer withdrew the quote' })).rejects.toThrow(/not in the future/);
    await svc.cancelInsurancePolicy(cm, next.id, { on: TODAY, reason: 'Insurer withdrew the quote' });
    const stored = ds.insurancePolicies.find((p) => p.id === old.id)!;
    expect(stored.renewedById).toBeNull();
    const view = await svc.insurance(cm);
    expect(view.policies.find((r) => r.policy.id === old.id)!.renewedBy).toBeNull();
    // It can be renewed again with the new insurer.
    await svc.renewInsurancePolicy(cm, old.id, { insurer: 'Second Mock Insurer', broker: null, policyNo: 'GPA-NEW-2', sumInsured: 500_000, premium: 9500, startsOn: start, expiresOn: addDays(start, 364), premiumDueOn: start, scheduleRef: null });
  });

  it('cancels with a reason and moves the policy to history', async () => {
    const { svc, ds } = fresh();
    const cos = await svc.user('u-cos');
    const cm = await svc.user('u-cm-sasa');
    const p = ds.insurancePolicies.find((x) => x.companyId === 'co-sasa' && x.kind === 'FIRE_OFFICE')!;
    await expect(svc.cancelInsurancePolicy(cm, p.id, { on: TODAY, reason: 'x' })).rejects.toThrow(/reason/);
    await svc.cancelInsurancePolicy(cos, p.id, { on: TODAY, reason: 'Office moved; new policy with the landlord' });
    await expect(svc.recordInsurancePremium(cm, p.id, { paidOn: TODAY, ref: 'PV-1' })).rejects.toThrow(/cancelled/);
    const view = await svc.insurance(cm);
    expect(view.policies.some((r) => r.policy.id === p.id)).toBe(false);
    expect(view.history.find((h) => h.policy.id === p.id)!.why).toBe('cancelled');
  });
});

describe('PDPA settings (Fauzan, 5 Nov 2026)', () => {
  it('only the Chief of Staff switches PDPA on or off; switching off hides leader alerts but keeps records', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const ceo = await svc.user('u-fauzan');
    const officer = await svc.user('u-pdpa');
    const opsdir = await svc.user('u-opsdir');
    // A breach found 80 hours ago is late for the Commissioner and shows on the CEO's Monitor.
    await svc.openPdpaCase(officer, { kind: 'BREACH', companyId: 'co-sasa', title: 'Lost phone', detail: '', detectedAt: addMinutes(NOW, -80 * 60), affected: 4 });
    expect((await svc.home(ceo)).watch!.some((i) => i.tag === 'PDPA breach')).toBe(true);
    await expect(svc.setPdpaSettings(officer, { enabled: false }, 'Testing')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setPdpaSettings(ceo, { enabled: false }, 'Testing')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setPdpaSettings(cos, { enabled: false }, '')).rejects.toThrow(/reason/);
    await svc.setPdpaSettings(cos, { enabled: false }, 'Pause for the pilot');
    expect((await svc.home(ceo)).watch!.some((i) => i.tag === 'PDPA breach')).toBe(false);
    const board = await svc.pdpaBoard(opsdir);
    expect(board.settings.enabled).toBe(false);
    expect(board.cases.length).toBeGreaterThan(0);
    expect(board.settings.history.at(-1)!.what).toMatch(/PDPA switched off: Pause for the pilot/);
    await expect(svc.setPdpaSettings(cos, { enabled: false }, 'Again')).rejects.toThrow(/Nothing changed/);
    await svc.setPdpaSettings(cos, { enabled: true }, 'Pilot over');
    expect((await svc.home(ceo)).watch!.some((i) => i.tag === 'PDPA breach')).toBe(true);
  });

  it('the PDPA officer or the Chief of Staff sets the breach keep period, never under 2 years, and closing uses it', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const officer = await svc.user('u-pdpa');
    const opsdir = await svc.user('u-opsdir');
    await expect(svc.setPdpaSettings(opsdir, { keepYears: 3 }, 'Longer')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.setPdpaSettings(officer, { keepYears: 1 }, 'Shorter')).rejects.toThrow(/legal minimum/);
    await expect(svc.setPdpaSettings(officer, { keepYears: 2.5 }, 'Half')).rejects.toThrow(/legal minimum/);
    await svc.setPdpaSettings(officer, { keepYears: 3 }, 'Insurer asks for 3 years');
    expect((await svc.pdpaBoard(cos)).rules.keepYears).toBe(3);
    const b = await svc.openPdpaCase(officer, { kind: 'BREACH', companyId: 'co-sasa', title: 'Laptop lost', detail: '', affected: 2 });
    await svc.pdpaStep(officer, b.id, 'commissioner', 'Form sent', [doc()]);
    await svc.pdpaBreachDetails(officer, b.id, { dataKinds: 'Names', cause: 'Left in a taxi', remedy: 'Disk encryption' });
    const closed = await svc.pdpaStep(officer, b.id, 'close', 'Done');
    expect(closed.keepUntil).toBe(addDays(TODAY, Math.round(3 * 365.25)));
    await svc.setPdpaSettings(cos, { keepYears: 2 }, 'Back to the legal minimum');
    expect((await svc.pdpaBoard(officer)).settings.keepYears).toBe(2);
  });

  it('lets the CEO and the Chief of Staff keep the data register with the PDPA officer; consents stay with the officer', async () => {
    const { svc } = fresh();
    const cos = await svc.user('u-cos');
    const ceo = await svc.user('u-fauzan');
    expect((await svc.pdpaRegisterBoard(cos)).canKeep).toBe(true);
    expect((await svc.pdpaRegisterBoard(await svc.user('u-opsdir'))).canKeep).toBe(false);
    const added = await svc.savePdpaRegisterItem(cos, null, { ...entry, retentionDays: 365, disposal: 'Shredded', noticeGiven: true });
    await svc.pdpaRegisterStep(ceo, added.id, 'review', 'Checked with the PDPA officer');
    await expect(
      svc.recordPdpaConsent(ceo, { registerId: added.id, subjectName: 'X', subjectRef: 'PW-9', subjectKind: 'staff', noticeVersion: 'v1', givenOn: TODAY }, [doc()]),
    ).rejects.toBeInstanceOf(AccessDenied);
  });
});
