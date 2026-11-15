// Part N17 (Fitri package, 14 Nov 2026): Group HR lists keyed in by the HR Administrator, versioned by date. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, RULES, generateDataset, myt } from '../src';

const NOW = myt('2026-11-18', '10:00');

describe('N17 HR lists', () => {
  it('nothing preset: the profile says not set by HR until HR keys a list in', async () => {
    const ds = generateDataset({ today: '2026-11-18', now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    expect(RULES.claimsPolicy.value).toEqual([]);
    expect(RULES.claimsPolicy.label).toBe('Policy');
    const guard = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard')!;
    const p = await svc.guardProfile(await svc.user('u-cm-sasa'), guard.id);
    expect(p.courses).toMatchObject({ set: false, items: [], note: 'Not set by HR yet.' });
    expect(p.policies.claims.set).toBe(false);
    expect(p.policies.discipline.steps.set).toBe(false);
    expect(p.policies.discipline.principles.value.principles.length).toBeGreaterThan(0);
  });

  it('a 2027 list does not change a 2026 record; old versions are kept', async () => {
    const ds = generateDataset({ today: '2026-11-18', now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const hr = await svc.user('u-pwvsb-hr');
    await svc.hrLists.set(hr, 'guard_courses', { from: '2026-01-01', reason: 'Synthetic 2026 list', items: [{ name: 'Course A', needed: 'required', byWhen: 'within 1 year' }] });
    await svc.hrLists.set(hr, 'guard_courses', {
      from: '2027-01-01',
      reason: 'Synthetic 2027 list',
      items: [
        { name: 'Course A', needed: 'required', byWhen: 'within 6 months' },
        { name: 'Course B', needed: 'optional', byWhen: 'any time' },
      ],
    });
    const y26 = await svc.hrLists.inForce('guard_courses', '2026-12-31');
    expect(y26.items).toEqual([{ name: 'Course A', needed: 'required', byWhen: 'within 1 year' }]);
    const y27 = await svc.hrLists.inForce('guard_courses', '2027-03-01');
    expect(y27.items).toHaveLength(2);
    const guard = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard')!;
    const p = await svc.guardProfile(await svc.user('u-cm-sasa'), guard.id);
    expect(p.courses.from).toBe('2026-01-01');
    const view = await svc.hrLists.view(await svc.user('u-cos'));
    expect(view.canSet).toBe(false);
    expect(view.lists.find((l) => l.kind === 'guard_courses')!.versions).toHaveLength(2);
  });

  it('only the HR Administrator keys lists in; the HR Director views; others are refused; a reason and a date are needed', async () => {
    const ds = generateDataset({ today: '2026-11-18', now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const hr = await svc.user('u-pwvsb-hr');
    const item = { clause: '1.1', item: 'Clinic visit', covered: 'Yes', note: '' };
    for (const id of ['u-cm-sasa', 'u-cos']) {
      await expect(svc.hrLists.set(await svc.user(id), 'claim_clauses', { from: '2026-01-01', reason: 'x'.repeat(5), items: [item] }), id).rejects.toThrow(/Not allowed|HR Administrator/);
    }
    await expect(svc.hrLists.view(await svc.user('u-cm-sasa'))).rejects.toThrow();
    await expect(svc.hrLists.set(hr, 'claim_clauses', { from: '2026-01-01', reason: '', items: [item] })).rejects.toThrow(/reason/);
    await expect(svc.hrLists.set(hr, 'claim_clauses', { from: 'next year', reason: 'Synthetic', items: [item] })).rejects.toThrow(/date/);
    await expect(svc.hrLists.set(hr, 'discipline_steps', { from: '2026-01-01', reason: 'Synthetic', items: [] })).rejects.toThrow(/1 to 60/);
    await svc.hrLists.set(hr, 'claim_clauses', { from: '2026-01-01', reason: 'Synthetic', items: [item] });
    const guard = ds.people.find((p) => p.companyId === 'co-sasa' && p.role === 'guard')!;
    const p = await svc.guardProfile(await svc.user('u-cm-sasa'), guard.id);
    expect(p.policies.claims.items[0]).toMatchObject({ clause: '1.1', covered: 'Yes' });
  });
});
