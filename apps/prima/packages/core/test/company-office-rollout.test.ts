// Company office rollout (draft, 3 Nov 2026): who signs in when the CEO starts PRIMA_ROLLOUTS=company_office.
// Synthetic users only.
import { describe, expect, it } from 'vitest';
import { generateDataset, inCompanyOfficeRollout, myt, type User } from '../src';
import { registeredRollouts, rolloutAdmits, rolloutsOn } from '../src/rollouts';

const users = generateDataset({ today: '2026-11-02', now: myt('2026-11-02', '10:00') }).users;
const user = (id: string) => users.find((u) => u.id === id)!;

describe('company office rollout', () => {
  it('is registered under one key and admits nobody until it is started', () => {
    expect(registeredRollouts().map((r) => r.key)).toContain('company_office');
    expect(rolloutAdmits(user('u-gm-sasa'), rolloutsOn({}))).toBe(false);
    expect(rolloutAdmits(user('u-gm-sasa'), rolloutsOn({ PRIMA_ROLLOUTS: 'hr' }))).toBe(false);
  });

  it('when started, admits each company office head and admin executive', () => {
    const on = rolloutsOn({ PRIMA_ROLLOUTS: 'company_office' });
    for (const id of ['u-gm-sasa', 'u-cm-arsh', 'u-cm-inas', 'u-ae-sasa', 'u-ae-sasa-2', 'u-ae-arsh', 'u-ae-inas'])
      expect(rolloutAdmits(user(id), on), id).toBe(true);
  });

  it('never admits branch managers, guards, supervisors, site devices, group staff or system feeds', () => {
    const on = rolloutsOn({ PRIMA_ROLLOUTS: 'company_office' });
    const refused = users.filter(
      (u) =>
        !!u.integration ||
        !!u.branchId ||
        ['supervisor', 'site_device', 'director', 'pwvsb_officer'].includes(u.role) ||
        !['company_manager', 'admin_exec'].includes(u.role),
    );
    expect(refused.length).toBeGreaterThan(0);
    for (const u of refused) expect(rolloutAdmits(u, on), u.id).toBe(false);
    expect(inCompanyOfficeRollout({ id: 'x', name: 'X', role: 'admin_exec', companyIds: ['co-sasa'], siteIds: [], branchId: 'br-x' } as unknown as User)).toBe(
      false,
    );
    expect(inCompanyOfficeRollout({ id: 'x', name: 'X', role: 'company_manager', companyIds: [], siteIds: [] } as unknown as User)).toBe(false);
  });
});
