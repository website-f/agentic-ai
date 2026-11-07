// Recruitment steps routes refuse malformed input before the service runs, and always act as the signed-in user.
// Synthetic data only.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AppController } from '../src/controllers';

function harness() {
  const calls: unknown[][] = [];
  const svc: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['fwmRecruitment', 'openFwRecruitFile', 'setFwRecruitTravel', 'recordFwRecruitStep', 'clearFwRecruitFile', 'recordFwRecruitArrival', 'stopFwRecruitFile'])
    svc[m] = async (...a: unknown[]) => calls.push([m, ...a]);
  const db = { asUser: async (id: string, fn: (s: unknown, u: unknown) => unknown) => fn(svc, { id }) };
  return { c: new AppController(db as never), calls };
}

it('step route refuses unknown steps, languages, types and dates, and binds the signed-in user', async () => {
  const { c, calls } = harness();
  const ok = { on: '2026-11-06', languages: ['en', 'ms'], note: 'UAT synthetic' };
  for (const [step, bad] of [
    ['OTHER', ok],
    ['CONTRACT', { ...ok, languages: 'en' }],
    ['CONTRACT', { ...ok, languages: ['en', 'xx'] }],
    ['CONTRACT', { ...ok, on: '6 Nov' }],
    ['CONTRACT', { ...ok, on: undefined }],
    ['INTERVIEW', { ...ok, passed: 'yes' }],
    ['AGE', { ...ok, dob: '1990/01/01' }],
    ['AGENCY_LICENCE', { ...ok, licenceExpiresOn: 'next year' }],
    ['AGENCY_LICENCE', { ...ok, licenceNo: 42 }],
    ['EMBASSY', { ...ok, reference: 'x'.repeat(81) }],
    ['EMBASSY', { ...ok, note: 'x'.repeat(501) }],
  ] as [string, Record<string, unknown>][]) {
    assert.throws(() => c.recordFwRecruitStep('u-signed-in', 'fwr-1', step, bad as never), JSON.stringify([step, bad]));
  }
  assert.equal(calls.length, 0);
  await assert.rejects(Promise.resolve().then(() => c.recordFwRecruitStep('u-signed-in', 'fwr-1', 'CONTRACT', { ...ok, proof: 'not-a-list' } as never)));
  assert.equal(calls.length, 0);
  await c.recordFwRecruitStep('u-signed-in', 'fwr-1', 'CONTRACT', { ...ok, byId: 'u-someone-else', passed: true, status: 'cleared' } as never);
  const [, user, id, step, input] = calls[0] as [string, { id: string }, string, string, Record<string, unknown>];
  assert.equal(user.id, 'u-signed-in');
  assert.deepEqual([id, step], ['fwr-1', 'CONTRACT']);
  assert.equal('byId' in input, false);
  assert.equal('status' in input, false);
});

it('open, travel, arrival and stop routes check their fields', async () => {
  const { c, calls } = harness();
  const ok = { companyId: 'co-sasa', candidateName: 'UAT Candidate', passportLast4: '1234', country: 'NP', agency: 'UAT Agency' };
  for (const bad of [{ ...ok, companyId: undefined }, { ...ok, country: 'NPL' }, { ...ok, plannedTravelOn: 'soon' }, { ...ok, agency: 7 }]) {
    assert.throws(() => c.openFwRecruitFile('u-signed-in', bad as never), JSON.stringify(bad));
  }
  await c.openFwRecruitFile('u-signed-in', { ...ok, status: 'cleared' } as never);
  assert.deepEqual(calls[0][2], { ...ok, plannedTravelOn: null });
  assert.throws(() => c.setFwRecruitTravel('u-signed-in', 'fwr-1', { plannedTravelOn: 'later' } as never));
  assert.throws(() => c.recordFwRecruitArrival('u-signed-in', 'fwr-1', { arrivedOn: '2026-11-06' } as never));
  assert.throws(() => c.stopFwRecruitFile('u-signed-in', 'fwr-1', {} as never));
  await c.recordFwRecruitArrival('u-signed-in', 'fwr-1', { arrivedOn: '2026-11-06', staffNo: 'SASA0003', personId: 'p-other' } as never);
  assert.deepEqual(calls[1].slice(2), ['fwr-1', { arrivedOn: '2026-11-06', staffNo: 'SASA0003' }]);
});
