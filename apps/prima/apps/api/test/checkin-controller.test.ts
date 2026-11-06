// P81: the check-in routes (checkin.controller.ts) with a stand-in database and a mocked Nominatim. The address is looked
// up on the server; anything the phone says about the verdict or the address is never passed on.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RefusedAfterSave } from '@prima/core';
import { CheckinController } from '../src/checkin.controller';
import { Geocoder } from '../src/geocode';

function setup(answer: () => Promise<unknown>) {
  const seen: { method: string; args: unknown[] }[] = [];
  let refuse = false;
  const svc = new Proxy(
    {},
    {
      get: (_t, method: string) => async (_u: unknown, ...args: unknown[]) => {
        seen.push({ method, args });
        if (method === 'checkIn' && refuse) throw new RefusedAfterSave('refused');
        return method === 'checkIn' ? { event: { id: 'ev-1' }, blocked: false } : true;
      },
    },
  );
  const db = { asUser: (_uid: string, fn: (svc: unknown, u: unknown) => unknown) => Promise.resolve(fn(svc, { id: 'u1', role: 'admin_exec', companyIds: ['c1'] })) };
  CheckinController.geocoder = new Geocoder({ fetch: (async () => ({ ok: true, json: answer })) as unknown as typeof fetch, minIntervalMs: 0 });
  const c = new CheckinController(db as never);
  return { c, seen, refuseNext: () => (refuse = true) };
}
const body = { lat: 3.1579, lng: 101.7123, accuracyM: 9, capturedAt: '2026-11-06T08:30:00+08:00', verdict: 'in_area', address: 'Somewhere nice', reason: null };

describe('Check-in routes', () => {
  it('looks the address up on the server and drops what the phone claims', async () => {
    const { c, seen } = setup(async () => ({ display_name: 'Jalan Ampang, Kuala Lumpur' }));
    await c.checkIn('u1', body);
    const call = seen.find((s) => s.method === 'checkIn')!;
    assert.equal(call.args[0], 'in');
    const input = call.args[1] as Record<string, unknown>;
    assert.equal('verdict' in input, false);
    assert.equal('address' in input, false);
    assert.deepEqual(call.args[2], { status: 'found', text: 'Jalan Ampang, Kuala Lumpur' });
  });

  it('saves a slow address afterwards instead of holding the check-in up', async () => {
    let release: (v: unknown) => void = () => undefined;
    const { c, seen } = setup(() => new Promise((r) => (release = r)));
    const started = Date.now();
    await c.checkOut('u1', { ...body, lat: 3.2 });
    assert.ok(Date.now() - started < 4_000);
    assert.deepEqual(seen.find((s) => s.method === 'checkIn')!.args[2], { status: 'pending', text: null });
    release({ display_name: 'Later Street' });
    await new Promise((r) => setTimeout(r, 20));
    const fill = seen.find((s) => s.method === 'checkinSetAddress')!;
    assert.deepEqual(fill.args, ['ev-1', { status: 'found', text: 'Later Street' }]);
  });

  it('fills the address of a refused attempt too, by its point', async () => {
    let release: (v: unknown) => void = () => undefined;
    const { c, seen, refuseNext } = setup(() => new Promise((r) => (release = r)));
    refuseNext();
    await assert.rejects(c.checkIn('u1', { ...body, lat: 3.3 }), RefusedAfterSave);
    release({ display_name: 'Far Away Road' });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen.find((s) => s.method === 'checkinSetAddressAt')!.args, [3.3, 101.7123, { status: 'found', text: 'Far Away Road' }]);
  });

  it('refuses a body without a location', async () => {
    const { c } = setup(async () => ({}));
    await assert.rejects(c.checkIn('u1', { accuracyM: 5 }), /lat must be a number/);
  });
});
