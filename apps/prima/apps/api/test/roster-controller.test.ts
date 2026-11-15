// Guard roster routes refuse malformed input before the service runs and act as the signed-in user. Synthetic.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { RosterController } from '../src/roster.controller';

function harness() {
  const calls: unknown[][] = [];
  const svc = new Proxy({}, { get: (_t, name) => async (...a: unknown[]) => calls.push([String(name), ...a]) });
  const db = { asUser: async (id: string, fn: (svc: unknown, u: unknown) => unknown) => fn(svc, { id }) };
  return { c: new RosterController(db as never), calls };
}

it('roster routes validate input and bind the signed-in user', async () => {
  const { c, calls } = harness();
  await assert.rejects(async () => c.board('u-in', 'st-1', '2026-1'));
  await assert.rejects(async () => c.draft('u-in', 'st-1', '2026-12', { days: [{ personId: 'p-1', date: '2026-12-01', planned: 'WORK_X' }] }));
  await assert.rejects(async () => c.draft('u-in', 'st-1', '2026-12', { days: 'all' }));
  await assert.rejects(async () => c.step('u-in', 'rv-1', { action: 'approve_all', reason: 'x' }));
  await assert.rejects(async () => c.absence('u-in', 'rd-1', { unpaid: 'yes', reason: 'x' }));
  await assert.rejects(async () => c.myLumpSum('u-in', 'ls-1', { decision: 'sign_for_guard' }));
  await assert.rejects(async () => c.lumpSumSwitch('u-in', 'st-1', { on: 'on', reason: 'x' }));
  await assert.rejects(async () => c.addBreak('u-in', 'rd-1', { slot: 'A', start: 'soon', end: 'later' }));
  await assert.rejects(async () => c.checkEvidence('u-in', 'rev-1', { result: 'fine', note: 'x' }));
  await assert.rejects(async () => c.proposal('u-in', 'st-1', '2026-12', { pattern: '4on3off', personIds: [] }));
  assert.equal(calls.length, 0);
  await c.step('u-in', 'rv-1', { action: 'publish', reason: 'Checked', byId: 'u-other' } as never);
  await c.myLumpSum('u-in', 'ls-1', { decision: 'sign' });
  await c.draft('u-in', 'st-1', '2026-12', { days: [{ personId: 'p-1', date: '2026-12-01', planned: 'WORK_D', plannedStart: '2026-12-01T08:00:00+08:00', plannedEnd: '2026-12-01T20:00:00+08:00' }] });
  assert.deepEqual(calls[0], ['rosterStep', { id: 'u-in' }, 'rv-1', 'publish', 'Checked']);
  assert.deepEqual(calls[1], ['decideMyLumpSum', { id: 'u-in' }, 'ls-1', 'sign']);
  assert.equal((calls[2] as unknown[])[0], 'saveRosterDraft');
});
