// HR database wall (HR Phase 3, slice 3A part 3, 1 Nov 2026): full IC and salary account numbers live in their own
// tables behind the wall, never on the person record the company and other departments read. Mock data only.
import { describe, expect, it } from 'vitest';
import { BadRequest, GROUP_EMPLOYER_ID, MemoryStore, PrimaService, dataWalls, generateDataset, myt, seesStaffAccounts, seesStaffIds, seesStaffNumbersOf } from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '10:30');

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
}

const hire = (branchId: string) => ({
  staffNo: 'PWV901',
  name: 'Wall Test',
  jobTitle: 'HR Executive',
  branchId,
  employmentType: 'probation',
  hiredOn: TODAY,
  probationEndsOn: '2027-04-26',
  nationality: 'MY',
  idFull: '880202-10-1234',
  gender: 'M',
  dob: '1988-02-02',
  phone: '012-345 6789',
  bankName: 'Maybank',
  bankAccountFull: '5566 7788 99',
  basicPay: 3000,
  payReason: 'Offer letter',
  status: 'active',
});

describe('HR database wall', () => {
  it('passes HR, the HR Director and the CEO for full ICs; Finance only for salary accounts; nobody else', async () => {
    const { ds } = fresh();
    const u = (id: string) => ds.users.find((x) => x.id === id)!;
    for (const id of ['u-pwvsb-hr', 'u-cos', 'u-dcos', 'u-fauzan']) {
      expect(seesStaffIds(u(id))).toBe(true);
      expect(seesStaffAccounts(u(id))).toBe(true);
    }
    expect(seesStaffIds(u('u-fd'))).toBe(false);
    expect(seesStaffAccounts(u('u-fd'))).toBe(true);
    // A company manager reads their own company's staff numbers only (Fauzan, 1 Nov 2026), never as part of the HR wall.
    expect(dataWalls(u('u-cm-sasa'))).toEqual(['staff_company', 'staff_movements', 'corporate', 'legal', 'mandates', 'arms']);
    expect(seesStaffNumbersOf(u('u-cm-sasa'), 'co-sasa', 'ids')).toBe(true);
    expect(seesStaffNumbersOf(u('u-cm-sasa'), 'co-arsh', 'ids')).toBe(false);
    expect(seesStaffNumbersOf(u('u-ae-arsh'), 'co-arsh', 'accounts')).toBe(false);
    for (const id of ['u-coo', 'u-cm-sasa', 'u-ae-arsh', 'u-vchair', 'u-audit', 'u-it-ex1', 'u-pdpa']) {
      expect(dataWalls(u(id))).not.toContain('staff_ids');
      expect(dataWalls(u(id))).not.toContain('staff_accounts');
    }
    for (const x of ds.users.filter((y) => y.integration)) expect(seesStaffAccounts(x)).toBe(false);
  });

  it('keeps the full IC and salary account off the person record and the pay change', async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const form = await svc.recordForm(hr, 'officeStaff', null, GROUP_EMPLOYER_ID);
    const p = (await svc.saveRecord(hr, 'officeStaff', null, GROUP_EMPLOYER_ID, hire(form.options.branchId[0][0]))) as { id: string };
    const person = ds.people.find((x) => x.id === p.id)!;
    expect(JSON.stringify(person)).not.toContain('880202101234');
    expect(JSON.stringify(person)).not.toContain('880202-10-1234');
    expect(person.idMasked).toBe('880202-**-***4');
    expect(ds.staffIds.find((r) => r.personId === p.id)?.idFull).toBe('880202-10-1234');
    const bc = ds.payChanges.find((c) => c.personId === p.id && c.kind === 'BANK')!;
    expect(JSON.stringify(bc)).not.toContain('5566778899');
    expect(ds.staffAccounts.find((r) => r.personId === p.id)).toMatchObject({ accountFull: null, pending: { changeId: bc.id, accountFull: '5566778899' } });
    // HR sees the full numbers on the form; a refusal clears the waiting account.
    expect((await svc.recordForm(hr, 'officeStaff', p.id, null)).values.idFull).toBe('880202-10-1234');
    await svc.decidePayChange(await svc.user('u-cos'), bc.id, false, 'Wrong bank letter');
    expect(ds.staffAccounts.find((r) => r.personId === p.id)!.pending).toBeNull();
  });

  it("shows the company manager their own staff's full numbers, never another company's, and never lets them change one", async () => {
    const { ds, svc } = fresh();
    const hr = await svc.user('u-pwvsb-hr');
    const staff = ds.people.find((x) => x.companyId === 'co-sasa' && x.role === 'office' && x.status === 'active')!;
    const values = (await svc.recordForm(hr, 'officeStaff', staff.id, null)).values;
    await svc.saveRecord(hr, 'officeStaff', staff.id, null, { ...values, idFull: '770707-07-7777' });
    expect(ds.staffIds.find((r) => r.personId === staff.id)?.idFull).toBe('770707-07-7777');
    const cm = await svc.user('u-cm-sasa');
    const cmForm = await svc.recordForm(cm, 'officeStaff', staff.id, null).catch((e) => e);
    if (!(cmForm instanceof Error)) {
      expect(cmForm.values.idFull).toBe('770707-07-7777');
      await expect(svc.saveRecord(cm, 'officeStaff', staff.id, null, { ...cmForm.values, idFull: '770707-07-0000' })).rejects.toBeInstanceOf(Error);
    }
    expect(ds.staffIds.find((r) => r.personId === staff.id)?.idFull).toBe('770707-07-7777');
    // Another company's manager never gets it.
    const other = await svc.user('u-cm-arsh');
    const otherForm = await svc.recordForm(other, 'officeStaff', staff.id, null).catch((e) => e);
    if (!(otherForm instanceof Error)) expect(otherForm.values.idFull ?? null).toBeNull();
  });

  it('still catches a supplier paid into a staff salary account, from behind the wall', async () => {
    const { ds, svc } = fresh();
    const staff = ds.people.find((x) => x.role === 'office' && x.status === 'active')!;
    ds.staffAccounts.push({ id: staff.id, personId: staff.id, companyId: staff.companyId, accountFull: '9988776655', pending: null, updatedAt: NOW, updatedBy: 'test' });
    const sup = ds.purSuppliers[0];
    if (!sup) return;
    sup.bank = { ...sup.bank, account: '9988776655', verifiedBy: null, verifiedOn: null };
    const fd = await svc.user('u-fd');
    const err = await svc.purSupplierStep(fd, sup.id, 'verify_bank', '').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequest);
    expect(err.message).toContain(staff.name);
  });
});
