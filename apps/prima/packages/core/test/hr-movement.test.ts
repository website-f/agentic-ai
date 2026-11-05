import { afterEach, describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, PrimaService, RULES, generateDataset, type User } from '../src';

const TODAY = '2026-11-03';
const NOW = '2026-11-03T02:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const base = ds.users.find((u) => u.id === 'u-pwvsb-hr')!;
  // Synthetic Chief of Staff and Vice Chairman: the pilot persona list has neither.
  const cos = { ...base, id: 'u-cos-test', name: 'CoS (test)', department: 'chief_of_staff', leadership: 'cos' } as User;
  const vc = { ...base, id: 'u-vc-test', name: 'VC (test)', department: null, leadership: 'vice_chairman' } as unknown as User;
  ds.users.push(cos, vc);
  let t = Date.parse(NOW);
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => new Date((t += 1000)).toISOString());
  /** Move the test clock to a later day (the day a movement takes effect). */
  const setDay = (day: string) => {
    t = Date.parse(`${day}T02:00:00.000Z`);
  };
  const u = (id: string) => ds.users.find((x) => x.id === id)!;
  const staff = ds.users.find((x) => x.department === 'it' && x.personId && x.itRole !== 'manager' && x.itRole !== 'lead')!;
  const person = ds.people.find((p) => p.id === staff.personId)!;
  const sasaBranch = ds.branches.find((b) => b.companyId === 'co-sasa')!;
  return { ds, store, svc, setDay, hr: u('u-pwvsb-hr'), ceo: u('u-fauzan'), cm: u('u-cm-sasa'), cos, vc, staff, person, sasaBranch };
}

const pilot = RULES.pilot.value.on;
afterEach(() => {
  (RULES.pilot.value as { on: boolean }).on = pilot;
});

describe('staff movement (Fauzan, 3 Nov 2026)', () => {
  it('promotion: HR prepares, the HR Director, the CEO and the Vice Chairman approve with comments, then title and pay apply once', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, hr, ceo, cm, cos, vc, staff, person } = fresh();
    await expect(svc.prepareStaffMovement(cm, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: TODAY, reason: 'Naik pangkat (synthetic)', jobTitle: 'Senior IT Executive' })).rejects.toThrow();
    await expect(svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: TODAY, reason: 'Naik pangkat (synthetic)' })).rejects.toBeInstanceOf(BadRequest);
    const m = await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: TODAY, reason: 'Naik pangkat (synthetic)', jobTitle: 'Senior IT Executive', basicPay: 5123 });
    expect((await store.get('people', person.id))!.jobTitle).not.toBe('Senior IT Executive');
    // Order and people: the CEO cannot jump ahead; the preparer and the person moved never approve; a comment is needed.
    await expect(svc.staffMovementStep(ceo, m.id, true, 'Setuju (synthetic)')).rejects.toThrow(/not yours/);
    await expect(svc.staffMovementStep(staff, m.id, true, 'Setuju (synthetic)')).rejects.toThrow(/not yours/);
    await expect(svc.staffMovementStep(cos, m.id, true, '')).rejects.toThrow();
    await svc.staffMovementStep(cos, m.id, true, 'Prestasi baik (synthetic)');
    await expect(svc.staffMovementStep(cos, m.id, true, 'Lagi (synthetic)')).rejects.toThrow(/not yours/);
    await svc.staffMovementStep(ceo, m.id, true, 'Diluluskan (synthetic)');
    expect((await store.get('people', person.id))!.basicPay).not.toBe(5123);
    const done = await svc.staffMovementStep(vc, m.id, true, 'Setuju gaji (synthetic)');
    expect(done.status).toBe('done');
    const after = (await store.get('people', person.id))!;
    expect([after.jobTitle, after.basicPay]).toEqual(['Senior IT Executive', 5123]);
    const pay = (await store.list('payChanges', {})).find((c) => c.id === done.result!.payChangeId)!;
    expect([pay.status, pay.hrDirectorCheck?.by, pay.vcConsent?.by]).toEqual(['verified', 'CoS (test)', 'VC (test)']);
    await expect(svc.staffMovementStep(vc, m.id, true, 'Lagi (synthetic)')).rejects.toThrow(/already finished/);
  });

  it('transfer: approved now, applied on its date; new employment keeps the group start date and never overlaps the old one', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, hr, cm, cos, person, sasaBranch, ds, setDay } = fresh();
    const taken = ds.people.find((p) => p.companyId === 'co-sasa')!.staffNo;
    const input = { personId: person.id, kind: 'transfer' as const, toCompanyId: 'co-sasa', effectiveOn: '2026-12-01', reason: 'Diminta oleh syarikat penerima (synthetic)', branchId: sasaBranch.id, staffNo: 'SASA-T-900', jobTitle: 'Admin Executive' };
    await expect(svc.prepareStaffMovement(hr, { ...input, staffNo: taken })).rejects.toThrow(/already used/);
    const m = await svc.prepareStaffMovement(hr, input);
    await expect(svc.staffMovementStep(cos, m.id, true, 'Lulus (synthetic)')).rejects.toThrow(/not yours/);
    await svc.staffMovementStep(cm, m.id, true, 'Kami terima (synthetic)');
    const approved = await svc.staffMovementStep(cos, m.id, true, 'Lulus (synthetic)');
    // Approved on 3 Nov for 1 Dec: nothing on any record changes yet, and it cannot be applied early.
    expect([approved.status, approved.result]).toEqual(['approved', null]);
    expect((await store.get('people', person.id))!).toMatchObject({ status: 'active' });
    expect((await store.get('people', person.id))!.leaving ?? null).toBeNull();
    expect((await store.list('people', { companyId: 'co-sasa' })).some((p) => p.staffNo === 'SASA-T-900')).toBe(false);
    await expect(svc.applyStaffMovement(hr, m.id)).rejects.toThrow(/takes effect on 2026-12-01/);
    expect(await svc.applyDueStaffMovements(hr)).toEqual({ applied: [], failed: [] });
    await expect(svc.prepareStaffMovement(hr, { ...input, staffNo: 'SASA-T-901' })).rejects.toThrow(/waiting or approved/);
    // On the day: applied once; a replay returns the same result and creates nothing more.
    setDay('2026-12-01');
    await expect(svc.applyStaffMovement(cm, m.id)).rejects.toThrow();
    expect((await svc.applyDueStaffMovements(hr)).applied).toEqual([m.id]);
    const done = await svc.applyStaffMovement(hr, m.id);
    expect(done.status).toBe('done');
    expect((await store.list('people', {})).filter((p) => p.movedFrom?.movementId === m.id)).toHaveLength(1);
    const old = (await store.get('people', person.id))!;
    const moved = (await store.get('people', done.result!.newPersonId!))!;
    expect(old.leaving).toMatchObject({ kind: 'transferred', lastDayOn: '2026-11-30' });
    expect(old.status).toBe('left');
    expect(old.movedTo?.personId).toBe(moved.id);
    expect([moved.companyId, moved.staffNo, moved.hiredOn, moved.groupJoinedOn, moved.jobTitle, moved.status]).toEqual(['co-sasa', 'SASA-T-900', '2026-12-01', old.hiredOn, 'Admin Executive', 'active']);
    expect(moved.leaving ?? null).toBeNull();
    expect(old.leaving!.lastDayOn < moved.hiredOn).toBe(true);
  });

  it('a future promotion changes nothing until its date; a failed apply is recorded and retried; a corrected one replaces a cancelled one', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, hr, ceo, cos, vc, person, setDay } = fresh();
    const promo = async (effectiveOn: string, jobTitle: string) => {
      const m = await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn, reason: 'Naik pangkat (synthetic)', jobTitle, basicPay: 6222 });
      await svc.staffMovementStep(cos, m.id, true, 'Setuju (synthetic)');
      await svc.staffMovementStep(ceo, m.id, true, 'Setuju (synthetic)');
      return svc.staffMovementStep(vc, m.id, true, 'Setuju gaji (synthetic)');
    };
    // Corrected: an approved movement with the wrong date is cancelled before it applies and prepared again.
    const wrong = await promo('2027-02-01', 'Senior IT Executive');
    expect(wrong.status).toBe('approved');
    await svc.cancelStaffMovement(hr, wrong.id, 'Tarikh salah (synthetic)');
    const m = await promo('2027-01-01', 'Senior IT Executive');
    expect((await store.get('people', person.id))!.jobTitle).toBe(person.jobTitle);
    expect((await store.list('payChanges', {})).some((c) => c.id === `pay-${m.id}`)).toBe(false);
    // Failure: a basic pay change keyed meanwhile blocks it; it stays approved with the reason, then applies after.
    await store.insert('payChanges', { id: 'pay-block-test', companyId: person.companyId, personId: person.id, from: person.basicPay ?? null, to: 9999, reason: 'synthetic', effectiveOn: '2027-01-01', requestedBy: 'x', requestedById: 'x', requestedAt: '2026-12-01T00:00:00Z', status: 'pending', decidedBy: null, decidedAt: null, note: null, kind: 'PAY' });
    setDay('2027-01-01');
    const r1 = await svc.applyDueStaffMovements(hr);
    expect(r1.failed.map((f) => f.id)).toEqual([m.id]);
    const after1 = (await store.get('staffMovements', m.id))!;
    expect([after1.status, after1.applyError?.message]).toEqual(['approved', expect.stringMatching(/basic pay change/)]);
    expect((await store.get('people', person.id))!.jobTitle).toBe(person.jobTitle);
    await store.update('payChanges', 'pay-block-test', { status: 'rejected' });
    expect((await svc.applyDueStaffMovements(hr)).applied).toEqual([m.id]);
    const after2 = (await store.get('staffMovements', m.id))!;
    expect([after2.status, after2.applyError ?? null, after2.applied?.by]).toEqual(['done', null, hr.name]);
    expect((await store.get('people', person.id))!).toMatchObject({ jobTitle: 'Senior IT Executive', basicPay: 6222 });
    expect((await store.get('staffMovements', wrong.id))!.status).toBe('cancelled');
  });

  it('secondment needs the host head, the HR Director and the CEO; the employer does not change', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, hr, ceo, cm, cos, person } = fresh();
    await expect(svc.prepareStaffMovement(hr, { personId: person.id, kind: 'secondment', toCompanyId: 'co-sasa', effectiveOn: TODAY, reason: 'Bantu projek (synthetic)', until: '2026-10-01' })).rejects.toThrow(/last day/);
    const m = await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'secondment', toCompanyId: 'co-sasa', effectiveOn: TODAY, reason: 'Bantu projek (synthetic)', until: '2027-01-31' });
    await svc.staffMovementStep(cm, m.id, true, 'Setuju (synthetic)');
    await svc.staffMovementStep(cos, m.id, true, 'Setuju (synthetic)');
    await svc.staffMovementStep(ceo, m.id, true, 'Setuju (synthetic)');
    const p = (await store.get('people', person.id))!;
    expect([p.companyId, p.secondment?.toCompanyId, p.secondment?.until]).toEqual([person.companyId, 'co-sasa', '2027-01-31']);
  });

  it('a refusal ends it with the reason; nothing on the record changes', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, hr, cos, person } = fresh();
    const m = await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: TODAY, reason: 'Naik pangkat (synthetic)', jobTitle: 'IT Lead' });
    const r = await svc.staffMovementStep(cos, m.id, false, 'Belum cukup tempoh (synthetic)');
    expect([r.status, r.steps[0].note]).toEqual(['refused', 'Belum cukup tempoh (synthetic)']);
    expect((await store.get('people', person.id))!.jobTitle).toBe(person.jobTitle);
  });

  it('pilot: the CEO stands in for the HR Director and the Vice Chairman, and each stand-in is labelled', async () => {
    (RULES.pilot.value as { on: boolean }).on = true;
    const { svc, hr, ceo, person } = fresh();
    const m = await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: TODAY, reason: 'Naik pangkat (synthetic)', jobTitle: 'Senior IT Executive' });
    await svc.staffMovementStep(ceo, m.id, true, 'Untuk Pengarah HR (synthetic)');
    await svc.staffMovementStep(ceo, m.id, true, 'Sebagai CEO (synthetic)');
    const done = await svc.staffMovementStep(ceo, m.id, true, 'Untuk Naib Pengerusi (synthetic)');
    expect(done.status).toBe('done');
    expect(done.steps.map((x) => [x.role, !!x.standIn])).toEqual([['hr_director', true], ['ceo', false], ['vice_chairman', true]]);
  });
});

// Arisha main retest of 84b056e (3 Nov 2026): IT gets only the login handover, completion checks the accounts' company
// access, and a payroll draft is stale once pay, allowances or unpaid leave change.
describe('login handover and stale payroll drafts', () => {
  it('IT sees a minimal handover (no pay, no reason), cannot read movements, and confirms only when access really moved', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, ds, hr, cm, cos, staff, person, sasaBranch, setDay } = fresh();
    const it2 = ds.users.find((x) => x.department === 'it' && x.id !== staff.id && x.itRole !== 'manager' && x.itRole !== 'lead')!;
    const m = await svc.prepareStaffMovement(hr, {
      personId: person.id, kind: 'transfer', toCompanyId: 'co-sasa', effectiveOn: '2026-12-01', reason: 'Private reason (synthetic)', branchId: sasaBranch.id, staffNo: 'SASA-T-950', jobTitle: 'Admin Executive', basicPay: 7777,
    });
    await svc.staffMovementStep(cm, m.id, true, 'Kami terima (synthetic)');
    await svc.staffMovementStep(cos, m.id, true, 'Lulus (synthetic)');
    setDay('2026-12-01');
    const done = await svc.applyStaffMovement(hr, m.id);
    // IT never reads the movement row, by the service or the wall.
    await expect(svc.staffMovements(it2)).rejects.toBeInstanceOf(AccessDenied);
    const view = await svc.loginHandovers(it2);
    expect(view.rows).toHaveLength(1);
    const text = JSON.stringify(view);
    for (const secret of ['7777', 'Private reason', 'basicPay', 'reason', 'steps']) expect(text).not.toContain(secret);
    expect(view.rows[0]).toMatchObject({ personName: person.name, toCompanyName: expect.any(String), status: 'to_authorise', canConfirm: false });
    // Ordinary staff outside IT and HR see no handovers.
    await expect(svc.loginHandovers(ds.users.find((x) => x.id === 'u-pdpa')!)).rejects.toBeInstanceOf(AccessDenied);
    // HR applied it, so the HR Director may authorise the login move; IT may not.
    await expect(svc.authoriseMovementLogin(it2, m.id, true, 'Setuju (synthetic)')).rejects.toBeInstanceOf(AccessDenied);
    await svc.authoriseMovementLogin(cos, m.id, true, 'Pindah log masuk (synthetic)');
    // The person moved cannot confirm their own move.
    await expect(svc.confirmMovementLogin(staff, m.id, 'Siap (synthetic)')).rejects.toThrow(/your own/);
    // Pointing the login at the new record is not enough: the account must reach the new company and not the old one.
    const acct = ds.users.find((x) => x.id === staff.id)!;
    acct.personId = done.result!.newPersonId!;
    await expect(svc.confirmMovementLogin(it2, m.id, 'Siap (synthetic)')).rejects.toThrow(/no access to|still has access to/);
    Object.assign(acct, { role: 'admin_exec', department: null, itRole: null, companyIds: ['co-sasa'] });
    const ok = await svc.confirmMovementLogin(it2, m.id, 'Akaun dipindah (synthetic)');
    expect(ok.status).toBe('done');
    await expect(svc.confirmMovementLogin(it2, m.id, 'Lagi (synthetic)')).rejects.toThrow(/already done/);
    expect((await store.list('audit', {})).filter((a) => a.action.startsWith('user.login_move')).map((a) => a.action)).toEqual(['user.login_move.authorise', 'user.login_move.confirm']);
  });

  it('a draft calculated before a promotion or an allowance consent cannot be submitted; a retry after recalculation goes', async () => {
    (RULES.pilot.value as { on: boolean }).on = false;
    const { svc, store, ds, hr, ceo, cos, vc, person } = fresh();
    for (const p of ds.people) if (p.companyId === person.companyId && p.role === 'office' && !p.bank) p.bank = { bank: 'Test Bank', accountMasked: '****0000' } as never;
    const period = TODAY.slice(0, 7);
    const runId = `sp-${person.companyId}-${period}`;
    const run0 = await store.get('staffPayRuns', runId);
    if (run0 && run0.stage !== 'draft') await store.update('staffPayRuns', runId, { stage: 'draft' });
    const prepare = () => svc.prepareStaffPay(hr, person.companyId, period);
    const submit = () => svc.staffPayStep(hr, runId, 'submit', { note: 'Hantar (synthetic)' });
    await prepare();
    // A promotion with new basic pay, applied today after the draft.
    const m = await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: TODAY, reason: 'Naik pangkat (synthetic)', basicPay: 6321 });
    await svc.staffMovementStep(cos, m.id, true, 'OK (synthetic)');
    await svc.staffMovementStep(ceo, m.id, true, 'OK (synthetic)');
    expect((await svc.staffMovementStep(vc, m.id, true, 'Setuju (synthetic)')).status).toBe('done');
    await expect(submit()).rejects.toThrow(/Pay, allowances or unpaid leave changed for .*Recalculate/);
    // Retrying without recalculating is refused the same way.
    await expect(submit()).rejects.toThrow(/Recalculate/);
    await prepare();
    expect((await store.get('staffPayRuns', runId))!.lines.find((l) => l.personId === person.id)!.basic).toBe(6321);
    // An allowance consented after the recalculation makes it stale again.
    const c = await svc.requestAllowanceChange(hr, person.id, { allowances: [{ typeId: 'alw-phone', amount: 120 }], effectiveOn: TODAY, reason: 'Telefon (synthetic)' });
    await svc.decidePayChange(cos, c.id, true, 'Semak (synthetic)');
    await svc.decidePayChange(vc, c.id, true, 'Setuju (synthetic)');
    await expect(submit()).rejects.toThrow(/Pay, allowances or unpaid leave changed/);
    await prepare();
    const done = await submit();
    expect(done.stage).toBe('submitted');
  });
});
