import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, guardLoginsToCreate, locationCutoff, myt } from '../src';

// A12 (Fitri package, Fauzan 11 Nov 2026): guard sign-ins in bulk, phone codes in bulk, location readings kept 90 days.
// Synthetic data only.
const TODAY = '2026-10-26';

describe('A12: guard sign-ins and phone codes in bulk', () => {
  it('plans a sign-in for each active guard without one, never for office staff, leavers or patrol officers', () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '08:40') });
    const people = ds.people.filter((p) => p.companyId === 'co-sasa');
    const plan = guardLoginsToCreate(people, ds.users);
    expect(plan.create.length).toBeGreaterThan(0);
    expect(plan.create.every((u) => (u.role === 'guard' || u.role === 'supervisor') && u.companyIds.length === 1 && u.personId)).toBe(true);
    const ids = new Set(plan.create.map((u) => u.personId));
    expect(people.filter((p) => p.role === 'office' || p.status !== 'active').some((p) => ids.has(p.id))).toBe(false);
    // Those who already have one are left alone; running again plans nothing.
    expect(guardLoginsToCreate(people, [...ds.users, ...plan.create]).create).toHaveLength(0);
  });

  it('issues codes in bulk only for guards the office may enrol, and says why others were skipped', async () => {
    const ds = generateDataset({ today: TODAY, now: myt(TODAY, '08:40') });
    const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '08:40'));
    const cm = await svc.user('u-cm-sasa');
    const g = await svc.user('u-guard-sasa-1');
    await svc.setStaffPin(cm, g.personId!, '4826');
    const r = await svc.guardPhone.issueCodes(cm, 'co-sasa', [g.personId!, ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard' && p.id !== g.personId)!.id]);
    expect(r.codes).toHaveLength(1);
    expect(r.codes[0].code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(r.skipped).toHaveLength(1);
    await expect(svc.guardPhone.issueCodes(await svc.user('u-cm-sasa'), 'co-arrow')).rejects.toThrow();
  });

  it('cuts location readings at the set days, never under 30', () => {
    const now = Date.parse('2026-11-05T02:00:00Z');
    expect(locationCutoff(now, 90)).toBe('2026-08-07T02:00:00.000Z');
    expect(() => locationCutoff(now, 7)).toThrow(/30 days/);
  });
});
