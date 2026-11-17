import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, PrimaService, generateDataset } from '../src';

// P111 (Fitri, 17 Nov 2026): HR changes office staff job titles (designation) from the staff list, one person per call.
const TODAY = '2026-11-17';
const NOW = '2026-11-17T02:00:00.000Z';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let t = Date.parse(NOW);
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => new Date((t += 1000)).toISOString());
  const u = (id: string) => ds.users.find((x) => x.id === id)!;
  const hr = u('u-pwvsb-hr');
  // Office staff with their own sign-in (the IT team), and a guard.
  const staffUser = ds.users.find((x) => x.department === 'it' && x.personId && x.itRole !== 'manager' && x.itRole !== 'lead')!;
  const person = ds.people.find((p) => p.id === staffUser.personId)!;
  const guard = ds.people.find((p) => p.role !== 'office' && p.status === 'active')!;
  return { ds, store, svc, hr, cm: u('u-cm-sasa'), staffUser, person, guard };
}

describe('change job title (P111)', () => {
  it('HR changes it with a reason; the change and the reason are in the audit log', async () => {
    const { svc, store, hr, person } = fresh();
    const r = await svc.changeStaffJobTitle(hr, person.id, { jobTitle: '  Senior   IT Executive ', reason: 'Carta organisasi baharu (synthetic)' });
    expect(r).toEqual({ personId: person.id, jobTitle: 'Senior IT Executive' });
    expect((await store.get('people', person.id))!.jobTitle).toBe('Senior IT Executive');
    const audit = (await store.list('audit', {})).filter((a) => a.action === 'hr.job_title_change' && a.entityId === person.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).toContain('Senior IT Executive');
    expect(audit[0].summary).toContain('Carta organisasi baharu (synthetic)');
    expect(audit[0].actor).toBe(hr.name);
  });

  it('refuses anyone outside HR: a company manager, the staff member themself, and other office staff', async () => {
    const { svc, store, cm, staffUser, person, ds } = fresh();
    const before = (await store.get('people', person.id))!.jobTitle;
    await expect(svc.changeStaffJobTitle(cm, person.id, { jobTitle: 'Manager', reason: 'Bukan HR (synthetic)' })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.changeStaffJobTitle(staffUser, person.id, { jobTitle: 'Manager', reason: 'Diri sendiri (synthetic)' })).rejects.toBeInstanceOf(AccessDenied);
    const finance = ds.users.find((x) => x.department === 'finance' && !x.integration)!;
    await expect(svc.changeStaffJobTitle(finance, person.id, { jobTitle: 'Manager', reason: 'Bukan HR (synthetic)' })).rejects.toBeInstanceOf(AccessDenied);
    const feed = ds.users.find((x) => x.integration)!;
    expect(feed).toBeTruthy();
    await expect(svc.changeStaffJobTitle(feed, person.id, { jobTitle: 'Manager', reason: 'Suapan sistem (synthetic)' })).rejects.toBeInstanceOf(AccessDenied);
    expect((await store.get('people', person.id))!.jobTitle).toBe(before);
    expect((await store.list('audit', {})).some((a) => a.action === 'hr.job_title_change')).toBe(false);
  });

  it('refuses guards, a missing reason or title, the same title, HR changing their own, and anyone with a movement open', async () => {
    const { svc, store, hr, person, guard, ds } = fresh();
    await expect(svc.changeStaffJobTitle(hr, guard.id, { jobTitle: 'Supervisor', reason: 'Pengawal (synthetic)' })).rejects.toThrow(/JA Group app/);
    await expect(svc.changeStaffJobTitle(hr, person.id, { jobTitle: 'Senior IT Executive', reason: 'abc' })).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.changeStaffJobTitle(hr, person.id, { jobTitle: ' ', reason: 'Carta organisasi (synthetic)' })).rejects.toThrow(/new job title/);
    await expect(svc.changeStaffJobTitle(hr, 'pr-none', { jobTitle: 'X Y', reason: 'Carta organisasi (synthetic)' })).rejects.toThrow(/not found/);
    const same = (await store.get('people', person.id))!.jobTitle ?? '';
    expect(same).toBeTruthy();
    await expect(svc.changeStaffJobTitle(hr, person.id, { jobTitle: same, reason: 'Carta organisasi (synthetic)' })).rejects.toThrow(/already their job title/);
    // HR's own record goes through someone else in HR.
    expect(hr.personId).toBeTruthy();
    await expect(svc.changeStaffJobTitle(hr, hr.personId!, { jobTitle: 'HR Lead', reason: 'Diri sendiri (synthetic)' })).rejects.toThrow(/Someone else in HR/);
    // A promotion or transfer waiting for approval decides the post; the bulk change leaves that person to it.
    await svc.prepareStaffMovement(hr, { personId: person.id, kind: 'promotion', toCompanyId: null, effectiveOn: '2026-12-01', reason: 'Naik pangkat (synthetic)', jobTitle: 'IT Lead' });
    await expect(svc.changeStaffJobTitle(hr, person.id, { jobTitle: 'Senior IT Executive', reason: 'Carta organisasi (synthetic)' })).rejects.toThrow(/movement waiting or approved/);
    expect((await store.get('people', person.id))!.jobTitle).toBe(same);
  });

  it('a bulk change is one call per person: a refused person does not stop or undo the others', async () => {
    const { svc, store, hr, person, guard, ds } = fresh();
    const other = ds.people.find((p) => p.role === 'office' && p.status === 'active' && p.id !== person.id && p.id !== hr.personId && p.companyId === person.companyId)!;
    const results = [];
    for (const id of [person.id, guard.id, other.id])
      results.push(
        await svc.changeStaffJobTitle(hr, id, { jobTitle: 'Admin Executive (P111)', reason: 'Susun semula data (synthetic)' }).then(
          () => 'done',
          (e: Error) => `refused: ${e.message}`,
        ),
      );
    expect(results[0]).toBe('done');
    expect(results[1]).toMatch(/^refused: Guards and officers/);
    expect(results[2]).toBe('done');
    expect((await store.get('people', person.id))!.jobTitle).toBe('Admin Executive (P111)');
    expect((await store.get('people', other.id))!.jobTitle).toBe('Admin Executive (P111)');
  });
});
