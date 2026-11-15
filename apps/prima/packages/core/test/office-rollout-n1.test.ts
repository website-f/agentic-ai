// Part N1 (Fauzan, 13 Nov 2026): everyone in the office signs in from 18 Nov; guards and patrolling officers stay in
// the JA app. Synthetic users only.
import { describe, expect, it } from 'vitest';
import { generateDataset, myt, registeredRollouts, rolloutAdmits, rolloutsOn, unregisteredRollouts, type User } from '../src';

const ds = generateDataset({ today: '2026-11-14', now: myt('2026-11-14', '09:00') });
const by = (f: (u: User) => boolean) => ds.users.find(f)!;

describe('N1 sign-in switches', () => {
  it('FINANCE_ROLLOUT=true admits the Finance teams, not only the Finance Director', () => {
    const on = rolloutsOn({ FINANCE_ROLLOUT: 'true' });
    expect(unregisteredRollouts(on)).toEqual([]);
    expect(rolloutAdmits(by((u) => u.id === 'u-fin-t1-de1'), on)).toBe(true);
    expect(rolloutAdmits(by((u) => u.id === 'u-fd'), on)).toBe(true);
    expect(rolloutAdmits(by((u) => u.id === 'u-cm-sasa'), on)).toBe(false);
  });

  it('all_office admits the Chairman, FWM, Asset Management, ACT, company staff and supervisors; never guards, patrolling officers or devices', () => {
    const on = rolloutsOn({ PRIMA_ROLLOUTS: 'all_office' });
    expect(registeredRollouts().map((r) => r.key)).toEqual(expect.arrayContaining(['finance', 'all_office']));
    expect(unregisteredRollouts(on)).toEqual([]);
    const admitted = [
      by((u) => u.id === 'u-chair'),
      by((u) => u.department === 'fwm'),
      by((u) => u.department === 'audit' && u.actRole !== 'lead'),
      by((u) => u.role === 'company_manager'),
      by((u) => u.role === 'admin_exec'),
      by((u) => u.role === 'supervisor' && u.opsTier !== 'patrol'),
    ];
    for (const u of admitted) expect(rolloutAdmits(u, on), u.id).toBe(true);
    const refused = [by((u) => u.role === 'guard'), by((u) => u.role === 'site_device'), by((u) => u.role === 'supervisor' && u.opsTier === 'patrol')];
    for (const u of refused) expect(rolloutAdmits(u, on), u.id).toBe(false);
    expect(rolloutAdmits({ ...admitted[0], integration: 'ja' } as User, on)).toBe(false);
  });
});
