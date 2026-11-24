// Teams approvals reader schedule (Fauzan, 23 Nov 2026, Finance D5): stays off unless switched on and fully configured,
// signs in with client credentials and only GETs graph.microsoft.com. Fake fetch; nothing reaches Microsoft 365.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphReader, teamsReaderConfig } from '../src/teams-approvals-online';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';
const full = {
  TEAMS_APPROVALS_READ: 'true',
  ENTRA_TENANT_ID: G1,
  TEAMS_APPROVALS_CLIENT_ID: G2,
  TEAMS_APPROVALS_CLIENT_SECRET: 'synthetic-secret',
  TEAMS_APPROVALS_SITE_ID: 'site-1',
  TEAMS_APPROVALS_RESULTS_LIST_ID: 'results-1',
  TEAMS_APPROVALS_REQUESTS_LIST_ID: 'requests-1',
  TEAMS_FLOW_SERVICE_OID: 'oid-flow',
};

describe('Teams approvals reader schedule', () => {
  it('is off unless the switch is on and every value is set', () => {
    assert.equal(teamsReaderConfig({}), null);
    assert.equal(teamsReaderConfig({ ...full, TEAMS_APPROVALS_READ: 'yes' }), null);
    for (const k of Object.keys(full)) {
      const env = { ...full } as Record<string, string>;
      delete env[k];
      assert.equal(teamsReaderConfig(env), null, k);
    }
    assert.equal(teamsReaderConfig({ ...full, TEAMS_APPROVALS_SITE_ID: 'a/b' }), null);
    assert.equal(teamsReaderConfig(full)?.userId, 'u-teams-approvals');
  });

  it('signs in once with client credentials and only reads Graph', async () => {
    const seen: { url: string; method: string }[] = [];
    const http = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as typeof fetch;
    const get = graphReader(teamsReaderConfig(full)!, http, () => 0);
    await get('/sites/site-1/lists/results-1/items');
    await get('/sites/site-1/lists/results-1/items');
    await assert.rejects(get('https://evil.example/x'));
    assert.equal(seen.filter((s) => s.url.includes('login.microsoftonline.com')).length, 1);
    assert.ok(seen.filter((s) => !s.url.includes('login')).every((s) => s.method === 'GET' && s.url.startsWith('https://graph.microsoft.com/v1.0/')));
  });
});
