import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// P141 (office, Fitri 27 Nov 2026): add departments and rename any department in the org chart (module org-units-v1).
const NOW = myt('2026-11-27', '15:10');

function setup() {
  const ds = generateDataset({ today: '2026-11-27', now: NOW });
  const store = new MemoryStore(ds);
  const real = store.transaction.bind(store);
  // As strict as the PostgreSQL store about the id in an update.
  (store as unknown as { transaction: typeof real }).transaction = (fn) =>
    real(async (tx) => {
      const update = tx.update.bind(tx);
      tx.update = (async (table: string, id: string, patch: Record<string, unknown>) => {
        if ('id' in patch) throw new Error('id and companyId cannot be changed');
        return update(table as never, id, patch as never);
      }) as typeof tx.update;
      return fn(tx);
    });
  return new PrimaService(store, () => NOW);
}

describe('P141: departments added and renamed in the org chart', () => {
  it('renames a department Prima comes with; its people and head stay', async () => {
    const svc = setup();
    const ceo = await svc.user('u-fauzan');
    const before = (await svc.org.chart(ceo)).units.find((u) => u.key === 'd_hr')!;
    await svc.org.setUnit(ceo, { action: 'rename', unit: 'd_hr', label: 'People and Culture' });
    const c = await svc.org.chart(ceo);
    const hr = c.units.find((u) => u.key === 'd_hr')!;
    expect(hr.label).toBe('People and Culture');
    expect(hr.standardLabel).toBe('Human Resources');
    expect(hr.members).toBe(before.members);
    expect(hr.heads.map((h) => h.id)).toEqual(before.heads.map((h) => h.id));
    expect(c.canEditUnits).toBe(true);
    // Renaming again updates the same row (no id in the patch).
    await svc.org.setUnit(ceo, { action: 'rename', unit: 'd_hr', label: 'People Team' });
    expect((await svc.org.chart(ceo)).units.find((u) => u.key === 'd_hr')!.label).toBe('People Team');
  });

  it('adds a department, puts people in it, names its head, then takes it away', async () => {
    const svc = setup();
    const ceo = await svc.user('u-fauzan');
    const row = await svc.org.setUnit(ceo, { action: 'add', label: 'Corporate Communications' });
    expect(row.key).toBe('x_corporate_communications');
    await svc.org.setUnit(ceo, { action: 'members', unit: row.key, add: ['u-it-ex1', 'u-it-mgr', 'nobody'] });
    let unit = (await svc.org.chart(ceo)).units.find((u) => u.key === row.key)!;
    expect(unit.custom).toBe(true);
    expect(unit.members).toBe(2);
    expect(unit.memberIds).toEqual(['u-it-ex1', 'u-it-mgr']);
    await svc.org.setHead(ceo, { unit: row.key, headId: 'u-it-mgr', deputyId: null, reason: 'Leads the new team' });
    unit = (await svc.org.chart(ceo)).units.find((u) => u.key === row.key)!;
    expect(unit.heads.map((h) => h.id)).toEqual(['u-it-mgr']);
    await svc.org.setUnit(ceo, { action: 'members', unit: row.key, remove: ['u-it-ex1'] });
    expect((await svc.org.chart(ceo)).units.find((u) => u.key === row.key)!.memberIds).toEqual(['u-it-mgr']);
    // The head sees the department they head even without the whole chart.
    const mgr = await svc.user('u-it-mgr');
    expect((await svc.org.chart(mgr)).units.some((u) => u.key === row.key)).toBe(true);
    await svc.org.setUnit(ceo, { action: 'remove', unit: row.key });
    expect((await svc.org.chart(ceo)).units.some((u) => u.key === row.key)).toBe(false);
  });

  it('refuses a name already used, a built-in removal, and anyone but the CEO or the HR Director', async () => {
    const svc = setup();
    const ceo = await svc.user('u-fauzan');
    await expect(svc.org.setUnit(ceo, { action: 'add', label: 'finance' })).rejects.toThrow(/already a department/);
    await expect(svc.org.setUnit(ceo, { action: 'remove', unit: 'd_it' })).rejects.toThrow(/cannot be taken away/);
    await expect(svc.org.setUnit(ceo, { action: 'add', label: 'x' })).rejects.toThrow(/2 to 80/);
    const staff = await svc.user('u-it-ex1');
    await expect(svc.org.setUnit(staff, { action: 'add', label: 'Shadow team' })).rejects.toThrow();
    const cos = await svc.user('u-cos');
    const r = await svc.org.setUnit(cos, { action: 'add', label: 'Special Projects' });
    expect(r.custom).toBe(true);
  });
});
