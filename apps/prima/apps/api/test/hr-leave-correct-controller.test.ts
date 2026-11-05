import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AppController } from '../src/controllers';

// Arisha review, 3 Nov 2026: the leave route must forward correctsId, so the permitted MC reuse works over HTTP.
it('forwards a refused request to correct, bounded, and sends null when there is none', async () => {
  const calls: Record<string, unknown>[] = [];
  const actor = { id: 'staff' };
  const db = { asUser: async (id: string, fn: (svc: unknown, u: unknown) => unknown) => (assert.equal(id, actor.id), fn({ requestLeave: (_u: unknown, i: Record<string, unknown>) => calls.push(i) }, actor)) };
  const c = new AppController(db as never);
  const base = { kind: 'SICK', from: '2026-11-03', to: '2026-11-03', reason: 'Demam (sintetik)', illness: 'Demam', clinic: 'Klinik Ujian', mcNo: 'KU-1', proof: [] };
  await c.requestLeave('staff', { ...base, correctsId: 'lv-pr-test-1' });
  await c.requestLeave('staff', { ...base });
  await c.requestLeave('staff', { ...base, correctsId: '' });
  assert.deepEqual(calls.map((x) => x.correctsId), ['lv-pr-test-1', null, null]);
  assert.throws(() => c.requestLeave('staff', { ...base, correctsId: 42 }));
  assert.throws(() => c.requestLeave('staff', { ...base, correctsId: 'x'.repeat(101) }));
});
