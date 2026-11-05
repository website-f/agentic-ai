// P66/P67: the Agentic Office's signed calls (office.ts). No database: the signature checks only.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOfficeCall, officePayload, officeSign, verifyOffice, type OfficeCall } from '../src/office';

const SECRET = 'o'.repeat(40);
const TS = '2026-11-06T01:00:00.000Z';
const NOW = Date.parse(TS);
const env = { OFFICE_SIGNING_SECRET: SECRET } as NodeJS.ProcessEnv;
const call: OfficeCall = { user: 'u-it-lead', via: 'agent:Chief of Staff' };

function headers(c: OfficeCall = call, over: Record<string, string> = {}, body = '{"a":1}', url = '/api/leave?x=1') {
  return {
    'x-office-ts': TS,
    'x-office-user': c.user,
    'x-office-via': c.via,
    'x-office-signature': officeSign(SECRET, officePayload(TS, 'POST', url, c, body)),
    ...over,
  } as Record<string, unknown>;
}

describe('Agentic Office signed calls', () => {
  it('signs exactly as the office does (the same test vector as apps/api/tests/test_p66_prima.py)', () => {
    assert.equal(
      officeSign(SECRET, officePayload(TS, 'POST', '/api/leave?x=1', call, '{"a":1}')),
      '14c37adaea8d43fab8a6148b0e1dc0d7b9d30d778830b813ac1421e39c621b60',
    );
  });

  it('accepts a call naming a staff record, and a system call naming none, within five minutes', () => {
    const body = Buffer.from('{"a":1}');
    assert.deepEqual(verifyOffice(headers(), 'POST', '/api/leave?x=1', body, NOW + 60_000, env), call);
    const sys: OfficeCall = { user: '', via: 'system' };
    assert.deepEqual(verifyOffice(headers(sys), 'POST', '/api/leave?x=1', body, NOW, env), sys);
    assert.equal(isOfficeCall(headers()), true);
    assert.equal(isOfficeCall({ authorization: 'Bearer x' }), false);
  });

  it('refuses any change, an old call, a system call naming someone, a short secret or none', () => {
    const body = Buffer.from('{"a":1}');
    const v = (h: Record<string, unknown>, o: { url?: string; body?: Buffer; now?: number; e?: NodeJS.ProcessEnv } = {}) =>
      verifyOffice(h, 'POST', o.url ?? '/api/leave?x=1', o.body ?? body, o.now ?? NOW, o.e ?? env);
    assert.equal(v(headers(), { url: '/api/leave?x=2' }), null);
    assert.equal(v(headers(), { body: Buffer.from('{"a":2}') }), null);
    assert.equal(v(headers(call, { 'x-office-user': 'u-fauzan' })), null);
    assert.equal(v(headers(call, { 'x-office-via': 'person' })), null);
    assert.equal(v(headers({ user: 'u-fauzan', via: 'system' })), null);
    assert.equal(v(headers({ user: '', via: 'person' })), null);
    assert.equal(v(headers({ user: 'u-x', via: 'root' })), null);
    assert.equal(v(headers(), { now: NOW + 5 * 60_000 + 1 }), null);
    assert.equal(v(headers(), { e: { OFFICE_SIGNING_SECRET: 'short' } as NodeJS.ProcessEnv }), null);
    assert.equal(v(headers(), { e: {} as NodeJS.ProcessEnv }), null);
    assert.equal(v(headers(call, { 'x-office-signature': '' })), null);
  });
});
