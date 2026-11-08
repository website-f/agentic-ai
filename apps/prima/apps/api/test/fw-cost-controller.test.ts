// Recruitment cost routes refuse malformed input before the service runs and act as the signed-in user. Synthetic.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AppController } from '../src/controllers';

function harness() {
  const calls: unknown[][] = [];
  const svc = new Proxy({}, { get: (_t, name) => async (...a: unknown[]) => calls.push([String(name), ...a]) });
  const db = { asUser: async (id: string, fn: (svc: unknown, u: unknown) => unknown) => fn(svc, { id }) };
  return { c: new AppController(db as never), calls };
}

it('rate, draft, decide and book routes validate input and bind the signed-in user', async () => {
  const { c, calls } = harness();
  for (const bad of [{ kind: 'bonus', monthlyPerWorker: 1, from: '2026-11', note: 'Synthetic' }, { kind: 'charge', monthlyPerWorker: '100', from: '2026-11', note: 'Synthetic' }, { kind: 'charge', monthlyPerWorker: 100, from: '2026-13', note: 'Synthetic' }, { kind: 'charge', monthlyPerWorker: 100, from: '2026-11' }]) {
    assert.throws(() => c.fwCostRate('u-in', bad as never), JSON.stringify(bad));
  }
  assert.throws(() => c.fwCostDraft('u-in', '2026-1'));
  assert.throws(() => c.fwCostDecide('u-in', '2026-11', { approve: 'yes', note: 'Synthetic' } as never));
  assert.throws(() => c.fwCostDecide('u-in', '2026-11', { approve: true, note: 'Synthetic', chargeIds: [1] } as never));
  assert.throws(() => c.fwCostBook('u-in', 'fwcc-1', { step: 'refund', ref: 'X-1', on: '2026-11-03' } as never));
  assert.throws(() => c.fwPlacement('u-in', 'p-1', { hostCompanyId: 'co-a', from: 'tomorrow' } as never));
  assert.throws(() => c.fwPlacementEnd('u-in', 'fwp-1', { to: '2026-11-03' } as never));
  assert.equal(calls.length, 0);
  await c.fwCostRate('u-in', { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: 'Synthetic', byId: 'u-other' } as never);
  await c.fwCostDecide('u-in', '2026-11', { approve: true, note: 'Synthetic' } as never);
  await c.fwPlacement('u-in', 'p-1', { hostCompanyId: 'co-a', hostBranchId: '', from: '2026-11-03' } as never);
  assert.deepEqual(calls[0], ['setFwCostRate', { id: 'u-in' }, { kind: 'charge', monthlyPerWorker: 100, from: '2026-11', note: 'Synthetic' }]);
  assert.deepEqual((calls[1] as unknown[])[2], { month: '2026-11', approve: true, note: 'Synthetic', chargeIds: undefined });
  assert.deepEqual((calls[2] as unknown[]).slice(2, 4), ['p-1', { hostCompanyId: 'co-a', hostBranchId: null, from: '2026-11-03', note: '', salaryPaidBy: null }]);
});

it('CEO log route takes only a note string and binds the signed-in user', async () => {
  const { c, calls } = harness();
  assert.throws(() => c.fwCostLegalNote('u-in', { note: 42 } as never));
  assert.equal(calls.length, 0);
  await c.fwCostLegalNote('u-in', { note: 'Synthetic counsel view', byId: 'u-other', status: 'closed' } as never);
  assert.deepEqual(calls[0], ['addFwCostLegalNote', { id: 'u-in' }, { note: 'Synthetic counsel view' }]);
});
