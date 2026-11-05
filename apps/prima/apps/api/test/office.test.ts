// P66: the Agentic Office's signed calls (office.ts). No database: the signature checks only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOfficeCall, officePayload, officeSign, verifyOffice } from '../src/office';

const SECRET = 'o'.repeat(40);
const TENANT = '11111111-2222-3333-4444-555555555555';
const OID = '0a0a0a0a-0000-4000-8000-000000000001';
const TS = '2026-11-06T01:00:00.000Z';
const NOW = Date.parse(TS);
const env = { OFFICE_SIGNING_SECRET: SECRET } as NodeJS.ProcessEnv;
const call = { oid: OID, tid: TENANT, via: 'agent:Chief of Staff' };

function headers(over: Record<string, string> = {}, body = '{"a":1}', url = '/api/leave?x=1') {
  return {
    'x-office-ts': TS,
    'x-office-oid': OID,
    'x-office-tid': TENANT,
    'x-office-via': call.via,
    'x-office-signature': officeSign(SECRET, officePayload(TS, 'POST', url, call, body)),
    ...over,
  } as Record<string, unknown>;
}

describe('Agentic Office signed calls', () => {
  it('signs exactly as the office does (the same test vector as apps/api/tests/test_p66_prisma.py)', () => {
    assert.equal(
      officeSign(SECRET, officePayload(TS, 'POST', '/api/leave?x=1', call, '{"a":1}')),
      '8f4bc82cb2e354fd2c2737f3aa10b7ec011b91d3933ee4424eb0331eea3e8e21',
    );
  });

  it('accepts a call signed for this tenant, within five minutes', () => {
    const got = verifyOffice(headers(), 'POST', '/api/leave?x=1', Buffer.from('{"a":1}'), TENANT, NOW + 60_000, env);
    assert.deepEqual(got, call);
    assert.equal(isOfficeCall(headers()), true);
    assert.equal(isOfficeCall({ authorization: 'Bearer x' }), false);
  });

  it('refuses any change, an old call, another tenant, a short secret or none', () => {
    const body = Buffer.from('{"a":1}');
    const v = (h: Record<string, unknown>, o: { url?: string; body?: Buffer; now?: number; tenant?: string | null; e?: NodeJS.ProcessEnv } = {}) =>
      verifyOffice(h, 'POST', o.url ?? '/api/leave?x=1', o.body ?? body, o.tenant === undefined ? TENANT : o.tenant, o.now ?? NOW, o.e ?? env);
    assert.equal(v(headers(), { url: '/api/leave?x=2' }), null);
    assert.equal(v(headers(), { body: Buffer.from('{"a":2}') }), null);
    assert.equal(v(headers({ 'x-office-oid': '0a0a0a0a-0000-4000-8000-000000000002' })), null);
    assert.equal(v(headers({ 'x-office-via': 'person' })), null);
    assert.equal(v(headers(), { now: NOW + 5 * 60_000 + 1 }), null);
    assert.equal(v(headers(), { tenant: '22222222-2222-3333-4444-555555555555' }), null);
    assert.equal(v(headers(), { tenant: null }), null);
    assert.equal(v(headers(), { e: { OFFICE_SIGNING_SECRET: 'short' } as NodeJS.ProcessEnv }), null);
    assert.equal(v(headers(), { e: {} as NodeJS.ProcessEnv }), null);
    assert.equal(v(headers({ 'x-office-signature': '' })), null);
  });
});
