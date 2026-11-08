// One shared rollout switch (connect-departments, 2 Nov 2026). Synthetic users only.
import { describe, expect, it } from 'vitest';
import { registerRollout, registeredRollouts, rolloutAdmits, rolloutsAdmitting, rolloutsOn, type User } from '../src';

const u = (over: Partial<User>): User => ({ id: 'u-x', name: 'X', role: 'pwvsb_officer', companyIds: [], siteIds: [], ...over }) as User;
const hrRule = (x: User) => x.role === 'pwvsb_officer' && x.department === 'hr';
const finRule = (x: User) => x.department === 'finance';
registerRollout('t_hr', 'HR (test)', hrRule);
registerRollout('t_fin', 'Finance (test)', finRule);

describe('rollout switch', () => {
  it('reads the CEO list and legacy flags; junk keys are dropped', () => {
    expect([...rolloutsOn({ PRIMA_ROLLOUTS: ' t_hr , BAD KEY,;drop,t_fin' })].sort()).toEqual(['t_fin', 't_hr']);
    expect([...rolloutsOn({ HR_ROLLOUT: 'true', SPECIAL_OPS_ROLLOUT: 'yes' })]).toEqual(['hr']);
    expect(rolloutsOn({}).size).toBe(0);
  });

  it('admits only people of a started rollout', () => {
    const hr = u({ department: 'hr' });
    const fin = u({ department: 'finance' });
    expect(rolloutAdmits(hr, new Set())).toBe(false);
    expect(rolloutAdmits(hr, new Set(['t_hr']))).toBe(true);
    expect(rolloutAdmits(fin, new Set(['t_hr']))).toBe(false);
    expect(rolloutsAdmitting(fin, new Set(['t_hr', 't_fin']))).toEqual(['t_fin']);
  });

  it('never admits a system feed, an unknown key or an unregistered rollout', () => {
    expect(rolloutAdmits(u({ department: 'hr', integration: 'ja' } as Partial<User>), new Set(['t_hr']))).toBe(false);
    expect(rolloutAdmits(u({ department: 'hr' }), new Set(['nobody_registered']))).toBe(false);
  });

  it('refuses a second, different rule under the same key', () => {
    expect(() => registerRollout('t_hr', 'HR again', () => true)).toThrow(/already registered/);
    expect(() => registerRollout('t_hr', 'HR (test)', hrRule)).not.toThrow();
    expect(() => registerRollout('Bad Key', 'x', () => true)).toThrow();
    expect(registeredRollouts().map((r) => r.key)).toEqual(expect.arrayContaining(['t_fin', 't_hr']));
  });
});
// One shared rollout switch (connect-departments, 2 Nov 2026). Synthetic users only.
