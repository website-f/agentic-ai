// Section 240 routes refuse malformed input before the service runs, and always act as the signed-in user. Synthetic.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AppController } from '../src/controllers';

function harness() {
  const calls: unknown[][] = [];
  const db = {
    asUser: async (id: string, fn: (svc: unknown, u: unknown) => unknown) =>
      fn(
        {
          recordFwCheck: async (...a: unknown[]) => calls.push(['record', ...a]),
          closeFwCheck: async (...a: unknown[]) => calls.push(['close', ...a]),
          fwmWelfare: async (...a: unknown[]) => calls.push(['board', ...a]),
        },
        { id },
      ),
  };
  return { c: new AppController(db as never), calls };
}

it('record route refuses unknown kinds, concerns, types and dates, and binds the signed-in user', async () => {
  const { c, calls } = harness();
  const ok = { kind: 'WELFARE', checkedOn: '2026-11-03', concerns: ['PAY'], note: 'UAT synthetic note' };
  for (const bad of [
    { ...ok, kind: 'OTHER' },
    { ...ok, kind: undefined },
    { ...ok, concerns: 'PAY' },
    { ...ok, concerns: ['PAY', 'BRIBE'] },
    { ...ok, checkedOn: '3 Nov' },
    { ...ok, checkedOn: undefined },
    { ...ok, kind: 'ARRIVAL_FEE', paidAnything: 'yes' },
    { ...ok, kind: 'ARRIVAL_FEE', amount: '4000' },
    { ...ok, kind: 'PASSPORT', heldBy: 'agent' },
    { ...ok, note: 'x'.repeat(501) },
    { ...ok, agency: 'x'.repeat(121) },
    { ...ok, agency: 42 },
  ]) {
    assert.throws(() => c.fwCheck('u-signed-in', 'p-1', bad as never), JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
  await assert.rejects(Promise.resolve().then(() => c.fwCheck('u-signed-in', 'p-1', { ...ok, proof: 'not-a-list' } as never)));
  assert.equal(calls.length, 0);
  await c.fwCheck('u-signed-in', 'p-1', { ...ok, byId: 'u-someone-else', status: 'closed' } as never);
  const [, user, person, input] = calls[0] as [string, { id: string }, string, Record<string, unknown>];
  assert.equal(user.id, 'u-signed-in');
  assert.equal(person, 'p-1');
  // Fields the client may not set never reach the service.
  assert.equal('byId' in input, false);
  assert.equal('status' in input, false);
});

it('close route needs a note and a numeric repaid amount', async () => {
  const { c, calls } = harness();
  for (const bad of [{}, { note: 5 }, { note: 'Paid back', repaid: '100' }, { note: 'x'.repeat(501) }, { note: 'Given back', custody: 'agent' }]) {
    assert.throws(() => c.fwCheckClose('u-signed-in', 'fwc-1', bad as never), JSON.stringify(bad));
  }
  await c.fwCheckClose('u-signed-in', 'fwc-1', { note: 'Paid back in full', repaid: 100 } as never);
  assert.deepEqual((calls[0] as unknown[]).slice(2, 4), ['fwc-1', { note: 'Paid back in full', repaid: 100, custody: null }]);
  await c.fwCheckClose('u-signed-in', 'fwc-2', { note: 'Given back to the worker', custody: 'worker' } as never);
  assert.deepEqual((calls[1] as unknown[]).slice(2, 4), ['fwc-2', { note: 'Given back to the worker', repaid: null, custody: 'worker' }]);
});
