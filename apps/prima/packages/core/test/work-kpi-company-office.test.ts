import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, buildWorkKpi, generateDataset, myt, registerWorkKpiAdapter, unregisterWorkKpiAdapter, workKpiScope, type Dataset } from '../src';

// Company offices on the Work KPIs screen. Synthetic data only.
const TODAY = '2026-11-05';
const NOW = myt(TODAY, '10:00');

describe('company office work KPI adapter', () => {
  it('gives the company head their own company office, and never another company’s', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const cm = await svc.user('u-cm-sasa');
    const scope = workKpiScope(cm, [], TODAY)!;
    expect(scope.depts).toEqual(['operations', 'client_relations', 'company_office']);
    // A module's company-office step, for this company and another.
    registerWorkKpiAdapter({
      id: 'test-office-step',
      depts: ['company_office'],
      tables: [],
      collect: (_d, put) => {
        for (const companyId of [cm.companyIds[0], 'not-my-company'])
          put.step({ dept: 'company_office', workflow: 'renewal', stage: 'submit', kind: 'work', recordId: companyId, companyId, byId: null, by: 'Exec (mock)', arrivedAt: '2026-11-05T09:00:00+08:00', doneAt: '2026-11-05T10:00:00+08:00' });
      },
    });
    try {
      const office = buildWorkKpi({} as Partial<Dataset>, scope, '2026-11').departments.find((d) => d.dept === 'company_office')!;
      expect(office.work).toEqual([expect.objectContaining({ stage: 'submit', count: 1, medianMinutes: 60 })]);
      expect(office.notTimed.join(' ')).toMatch(/desk owners/);
      const fromService = await svc.workKpi(cm, '2026-11');
      expect(fromService.departments.map((d) => d.dept)).toContain('company_office');
    } finally {
      unregisterWorkKpiAdapter('test-office-step');
    }
  });

  it('keeps an admin executive out', async () => {
    const ds = generateDataset({ today: TODAY, now: NOW });
    const svc = new PrimaService(new MemoryStore(ds), () => NOW);
    const ae = ds.users.find((u) => u.role === 'admin_exec')!;
    await expect(svc.workKpi(await svc.user(ae.id))).rejects.toThrow(/workflow KPIs/);
  });
});
