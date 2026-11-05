// Central Admin 5A sign-in switch. No database: checks who the pilot gate admits with CENTRAL_ADMIN_ROLLOUT on or off.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateDataset } from '@prima/core';
import { pilotAdmits } from '../src/auth';

const ds = generateDataset({ today: '2026-11-01' });
const user = (id: string) => {
  const u = ds.users.find((x) => x.id === id);
  assert.ok(u, id);
  return u;
};
const TEAM = ['u-cos', 'u-dcos', 'u-pwvsb-doa', 'u-cosec'];

describe('Central Admin rollout sign-in', () => {
  it('admits nobody new while the switch is off (the default)', () => {
    for (const id of TEAM.filter((x) => x !== 'u-pwvsb-doa')) {
      assert.equal(pilotAdmits(user(id), {}), false, id);
      assert.equal(pilotAdmits(user(id), { CENTRAL_ADMIN_ROLLOUT: 'yes' }), false, id);
    }
  });

  it('admits the Central Admin team, and only them, when CENTRAL_ADMIN_ROLLOUT=true', () => {
    const on = { CENTRAL_ADMIN_ROLLOUT: 'true' };
    for (const id of TEAM) assert.equal(pilotAdmits(user(id), on), true, id);
    for (const id of ['u-cm-sasa', 'u-legal', 'u-vchair']) assert.equal(pilotAdmits(user(id), on), false, id);
    // A system feed or a spoofed flag on a company manager is never admitted.
    assert.equal(pilotAdmits({ ...user('u-cosec'), integration: 'ja' }, on), false);
    assert.equal(pilotAdmits({ ...user('u-cm-sasa'), corpSecretary: true }, on), false);
  });
});
