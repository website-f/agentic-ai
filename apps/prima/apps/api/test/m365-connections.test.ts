/**
 * Microsoft 365 Connections: two synthetic identities against a stubbed Microsoft. No network, no real tenant data.
 * Covers allowed/denied, wrong company and tenant, private and shared channels, expired and revoked consent, claims
 * challenges, Retry-After, duplicate clicks, reconnect and disconnect, plus the read-only permission matrix.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { User } from '@prima/core';
import type { DelegatedActor } from '../src/connections-mail/delegated';
import { M365_CAPABILITIES, M365_CONTROL_OWNERSHIP } from '../src/connections-m365/capabilities';
import { teamsChannelLink } from '../src/connections-m365/links';
import { claimsFromChallenge, classifyTokenError, retryAfter } from '../src/connections-m365/provider';
import { approvedTeams, M365Connections, VERIFIED_FOR_MS, type M365Status, type ServiceStatus } from '../src/connections-m365/service';

const tenant = '11111111-2222-3333-4444-555555555555';
const otherTenant = '66666666-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oidA = 'a0000000-0000-4000-8000-00000000000a';
const oidB = 'b0000000-0000-4000-8000-00000000000b';
const teamSasa = 'c0000000-0000-4000-8000-000000000001';
const teamInas = 'c0000000-0000-4000-8000-000000000002';
const teamUnapproved = 'c0000000-0000-4000-8000-000000000003';
const host = 'example.sharepoint.com';
const siteSasa = `${host},d0000000-0000-4000-8000-000000000001,e0000000-0000-4000-8000-000000000001`;
const siteInas = `${host},d0000000-0000-4000-8000-000000000002,e0000000-0000-4000-8000-000000000002`;
const general = '19:general_sasa@thread.tacv2';
const privateCh = '19:private_sasa@thread.tacv2';
const sharedCh = '19:shared_sasa@thread.tacv2';

const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  M365_CONNECTIONS_ENABLED: 'true', M365_OUTLOOK_ENABLED: 'true', M365_TEAMS_ENABLED: 'true',
  ENTRA_TENANT_ID: tenant, ENTRA_API_CLIENT_ID: client, M365_OBO_CLIENT_SECRET: 'OBO_SECRET_PRIVATE',
  M365_TEAMS_APPROVED_JSON: JSON.stringify([
    { key: 'sasa-ops', name: 'Synthetic Sasa team', teamId: teamSasa, companyIds: ['co-sasa'] },
    { key: 'inas-ops', name: 'Synthetic Inas team', teamId: teamInas, companyIds: ['co-inas'] },
  ]),
  SHAREPOINT_CONNECTION_ENABLED: 'true', SHAREPOINT_OBO_CLIENT_SECRET: 'SP_SECRET_PRIVATE',
  SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify([
    { key: 'sasa-site', name: 'Synthetic Sasa site', siteId: siteSasa, host, companyIds: ['co-sasa'], allowedUserIds: ['u-alya', 'u-badri'], approvedDriveIds: ['b!drive_1'] },
    { key: 'inas-site', name: 'Synthetic Inas site', siteId: siteInas, host, companyIds: ['co-inas'], allowedUserIds: ['u-badri'], approvedDriveIds: [] },
  ]),
  ...over,
});

/** Identity A: Sasa admin executive. Identity B: Inas company manager. Both synthetic. */
const actorA = (): DelegatedActor => ({ user: { id: 'u-alya', role: 'admin_exec', entraOid: oidA, companyIds: ['co-sasa'] } as unknown as User, visibleCompanyIds: ['co-sasa'], assertion: { userId: 'u-alya', oid: oidA, tenantId: tenant, accessToken: 'INBOUND_A' } });
const actorB = (): DelegatedActor => ({ user: { id: 'u-badri', role: 'company_manager', entraOid: oidB, companyIds: ['co-inas'] } as unknown as User, visibleCompanyIds: ['co-inas'], assertion: { userId: 'u-badri', oid: oidB, tenantId: tenant, accessToken: 'INBOUND_B' } });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

interface World {
  /** Per identity: the token-endpoint answer override, or null for a normal grant. */
  tokenError: Record<string, Response | null>;
  joined: Record<string, string[]>;
  channels: Record<string, Record<string, 'standard' | 'private' | 'shared'>>;
  sites: Record<string, string[]>;
  graphError: Record<string, Response | null>;
  delayMs: number;
}
function microsoft(world: Partial<World> = {}) {
  const w: World = {
    tokenError: { A: null, B: null },
    joined: { A: [teamSasa], B: [teamInas] },
    channels: { A: { [general]: 'standard', [privateCh]: 'private' }, B: {} },
    sites: { A: [siteSasa], B: [siteInas, siteSasa] },
    graphError: { A: null, B: null },
    delayMs: 0,
    ...world,
  };
  const calls: { url: string; who?: string; scope?: string }[] = [];
  const http = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (w.delayMs) await new Promise(r => setTimeout(r, w.delayMs));
    if (url.startsWith('https://login.microsoftonline.com/')) {
      assert.equal(url, `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`);
      const form = new URLSearchParams(String(init.body));
      const who = form.get('assertion') === 'INBOUND_A' ? 'A' : form.get('assertion') === 'INBOUND_B' ? 'B' : '?';
      const scope = form.get('scope')!.replace('https://graph.microsoft.com/', '');
      calls.push({ url, who, scope });
      assert.equal(form.get('requested_token_use'), 'on_behalf_of');
      if (w.tokenError[who]) return w.tokenError[who]!.clone();
      return json({ token_type: 'Bearer', access_token: `GRAPH_${who}_${scope}`, scope: `https://graph.microsoft.com/${scope}` });
    }
    assert.ok(url.startsWith('https://graph.microsoft.com/v1.0/'), `unexpected host ${url}`);
    const token = String((init.headers as Record<string, string>).Authorization).replace('Bearer ', '');
    const [, who, scope] = token.split('_');
    calls.push({ url, who, scope });
    if (w.graphError[who]) return w.graphError[who]!.clone();
    const path = decodeURIComponent(url.slice('https://graph.microsoft.com/v1.0'.length));
    if (path === '/me/mailFolders/inbox?$select=id') { assert.equal(scope, 'Mail.ReadBasic'); return json({ id: `inbox-${who}` }); }
    if (path === '/me/joinedTeams') { assert.equal(scope, 'Team.ReadBasic.All'); return json({ value: w.joined[who].map(id => ({ id, displayName: 'not used' })) }); }
    const ch = path.match(/^\/teams\/([0-9a-f-]+)\/channels\/(.+)\?\$select=id,membershipType$/);
    if (ch) {
      assert.equal(scope, 'Channel.ReadBasic.All');
      const type = w.channels[who][ch[2]];
      // Microsoft answers for channel membership itself: a shared-channel member need not be a team member.
      return type ? json({ id: ch[2], membershipType: type }) : json({ error: { code: 'Forbidden' } }, 403);
    }
    const drives = path.match(/^\/sites\/([^/?]+)\/drives\?\$select=id,webUrl&\$top=50$/);
    if (drives) {
      assert.equal(scope, 'Sites.Selected');
      if (!w.sites[who].includes(drives[1])) return json({}, 403);
      const name = drives[1] === siteSasa ? 'Sasa' : 'Inas';
      return json({ value: [{ id: 'b!drive_1', webUrl: `https://${host}/sites/${name}/Shared%20Documents` }, { id: 'b!drive_hr', webUrl: `https://${host}/sites/${name}/HR%20Private` }] });
    }
    const byId = path.match(/^\/sites\/([^?:]+)\?\$select=id$/);
    if (byId) { assert.equal(scope, 'Sites.Selected'); return w.sites[who].includes(byId[1]) ? json({ id: byId[1] }) : json({}, 403); }
    const byPath = path.match(/^\/sites\/example\.sharepoint\.com:\/sites\/([^?]+)\?\$select=id$/);
    if (byPath) {
      const id = byPath[1] === 'Sasa' ? siteSasa : byPath[1] === 'Inas' ? siteInas : null;
      return id && w.sites[who].includes(id) ? json({ id }) : json({}, 403);
    }
    throw new Error(`no route for ${path}`);
  }) as typeof fetch;
  return { http, calls, world: w };
}

function setup(over: NodeJS.ProcessEnv = {}, world: Partial<World> = {}) {
  let now = Date.parse('2026-11-03T01:00:00Z');
  const ms = microsoft(world);
  const svc = new M365Connections(() => env(over), ms.http, () => new Date(now));
  return { svc, ...ms, advance: (n: number) => { now += n; } };
}
const byService = (s: M365Status, service: string): ServiceStatus => s.services.find(x => x.service === service)!;

describe('M365 Connections: off by default and truthful', () => {
  it('reports not_configured and calls nobody until switched on', async () => {
    const { svc, calls } = setup({ M365_CONNECTIONS_ENABLED: undefined });
    const status = svc.status(actorA());
    assert.deepEqual(status.services.map(s => [s.service, s.state, s.reason]), [['outlook', 'not_configured', 'FeatureDisabled'], ['teams', 'not_configured', 'FeatureDisabled'], ['sharepoint', 'not_configured', 'FeatureDisabled']]);
    assert.equal((await svc.check(actorA(), 'outlook')).state, 'not_configured');
    assert.equal(calls.length, 0);
    assert.deepEqual(status.teamsApprovals, { state: 'not_built', canApplyApprovals: false });
  });

  it('a Prima sign-in alone is never "connected": first status is configured / not checked', () => {
    const { svc, calls } = setup();
    for (const s of svc.status(actorA()).services) { assert.equal(s.state, 'configured'); assert.equal(s.reason, 'NotChecked'); }
    assert.equal(calls.length, 0);
  });

  it('missing secret, bad team list or Outlook switch off are reported per service', () => {
    assert.equal(byService(setup({ M365_OBO_CLIENT_SECRET: '' }).svc.status(actorA()), 'outlook').reason, 'ServerConfigurationRequired');
    assert.equal(byService(setup({ M365_OUTLOOK_ENABLED: 'false' }).svc.status(actorA()), 'outlook').reason, 'FeatureDisabled');
    assert.equal(byService(setup({ M365_TEAMS_APPROVED_JSON: '[{"key":"x","name":"x","teamId":"not-a-guid","companyIds":["co-sasa"]}]' }).svc.status(actorA()), 'teams').reason, 'ServerConfigurationRequired');
    assert.equal(byService(setup({ M365_TEAMS_APPROVED_JSON: '' }).svc.status(actorA()), 'teams').reason, 'NoApprovedResources');
  });

  it('guards, site devices and system feeds are not eligible; Prima-only (dev) sign-in needs Microsoft', async () => {
    const { svc, calls } = setup();
    for (const role of ['guard', 'supervisor', 'site_device']) {
      const a = actorA(); (a.user as { role: string }).role = role;
      assert.equal(byService(svc.status(a), 'outlook').reason, 'RoleNotEligible');
    }
    const feed = actorA(); (feed.user as { integration?: string }).integration = 'ja';
    assert.equal((await svc.check(feed, 'outlook')).reason, 'RoleNotEligible');
    assert.equal((await svc.check({ ...actorA(), assertion: null }, 'outlook')).reason, 'MicrosoftSignInRequired');
    assert.equal((await svc.check({ ...actorA(), assertion: { ...actorA().assertion!, tenantId: otherTenant } }, 'outlook')).reason, 'MicrosoftSignInRequired');
    assert.equal((await svc.check({ ...actorA(), assertion: { ...actorA().assertion!, oid: oidB } }, 'outlook')).reason, 'MicrosoftSignInRequired');
    assert.equal(calls.length, 0);
  });
});

describe('M365 Connections: two identities', () => {
  it('Outlook: each person is verified with their own token; status never crosses identities', async () => {
    const { svc, calls } = setup();
    const a = await svc.check(actorA(), 'outlook');
    assert.equal(a.state, 'connected');
    assert.equal(a.reason, 'Verified');
    assert.equal(byService(svc.status(actorB()), 'outlook').state, 'configured');
    assert.deepEqual(calls.map(c => [c.who, c.scope]), [['A', 'Mail.ReadBasic'], ['A', 'Mail.ReadBasic']]);
    // The same Prima user signed in with another Microsoft account does not inherit A's status.
    const relinked = { ...actorA(), user: { ...actorA().user, entraOid: oidB }, assertion: { ...actorA().assertion!, oid: oidB } };
    assert.equal(byService(svc.status(relinked), 'outlook').state, 'configured');
    assert.ok(!JSON.stringify(a).includes('GRAPH_') && !JSON.stringify(a).includes('INBOUND') && !JSON.stringify(a).includes('SECRET'));
  });

  it('Teams: resources are limited to the person\'s company; wrong company is refused before any call', async () => {
    const { svc, calls } = setup();
    assert.deepEqual(byService(svc.status(actorA()), 'teams').resources, [{ key: 'sasa-ops', name: 'Synthetic Sasa team' }]);
    assert.deepEqual(byService(svc.status(actorB()), 'teams').resources, [{ key: 'inas-ops', name: 'Synthetic Inas team' }]);
    await assert.rejects(svc.check(actorA(), 'teams', 'inas-ops'), ForbiddenException);
    await assert.rejects(svc.check(actorB(), 'teams', 'sasa-ops'), ForbiddenException);
    assert.equal(calls.length, 0);
    assert.equal((await svc.check(actorA(), 'teams', 'sasa-ops')).state, 'connected');
    assert.equal((await svc.check(actorB(), 'teams', 'inas-ops')).state, 'connected');
  });

  it('Teams: Microsoft saying "not a member" is unavailable / access denied, not connected', async () => {
    const { svc } = setup({}, { joined: { A: [], B: [teamInas] } });
    const s = await svc.check(actorA(), 'teams', 'sasa-ops');
    assert.deepEqual([s.state, s.reason], ['unavailable', 'NotTeamMember']);
  });

  it('Teams channel links: private channel for a member, refused for a non-member; wrong tenant and company refused without a call', async () => {
    const { svc, calls } = setup();
    const link = (team: string, ch: string, tid = tenant) => `https://teams.microsoft.com/l/channel/${encodeURIComponent(ch)}/Name?groupId=${team}&tenantId=${tid}`;
    const priv = await svc.teamsLink(actorA(), link(teamSasa, privateCh));
    assert.equal(priv.outcome, 'Verified');
    assert.equal(priv.membershipType, 'private');
    assert.ok(priv.openUrl!.startsWith('https://teams.microsoft.com/l/channel/'));
    assert.equal(priv.verifiedScope, 'channel');
    // A channel link answers for that channel only; it never marks the whole team connected.
    assert.equal(priv.status.state, 'configured');
    assert.equal((await svc.teamsLink(actorA(), link(teamSasa, sharedCh))).outcome, 'NotAMember');
    const before = calls.length;
    assert.equal((await svc.teamsLink(actorA(), link(teamSasa, general, otherTenant))).outcome, 'WrongOrganization');
    assert.equal((await svc.teamsLink(actorA(), link(teamInas, general))).outcome, 'WrongCompany');
    assert.equal((await svc.teamsLink(actorA(), link(teamUnapproved, general))).outcome, 'NotApproved');
    assert.equal(calls.length, before);
  });

  it('Teams channel links: a shared channel member is verified; B cannot see A\'s company channel', async () => {
    const { svc } = setup({}, { channels: { A: { [sharedCh]: 'shared' }, B: {} } });
    const r = await svc.teamsLink(actorA(), `https://teams.microsoft.com/l/channel/${encodeURIComponent(sharedCh)}/x?groupId=${teamSasa}&tenantId=${tenant}`);
    assert.equal(r.membershipType, 'shared');
    assert.equal((await svc.teamsLink(actorB(), `https://teams.microsoft.com/l/channel/${encodeURIComponent(sharedCh)}/x?groupId=${teamSasa}&tenantId=${tenant}`)).outcome, 'WrongCompany');
  });

  it('Teams: a shared-channel-only member is told so honestly; channel verified, team not connected', async () => {
    const { svc } = setup({}, { joined: { A: [], B: [teamInas] }, channels: { A: { [sharedCh]: 'shared' }, B: {} } });
    const team = await svc.check(actorA(), 'teams', 'sasa-ops');
    assert.deepEqual([team.state, team.reason], ['unavailable', 'NotTeamMember']);
    const ch = await svc.teamsLink(actorA(), `https://teams.microsoft.com/l/channel/${encodeURIComponent(sharedCh)}/x?groupId=${teamSasa}&tenantId=${tenant}`);
    assert.deepEqual([ch.outcome, ch.membershipType, ch.verifiedScope, ch.status.state, ch.status.reason], ['Verified', 'shared', 'channel', 'unavailable', 'NotTeamMember']);
  });

  it('SharePoint library links are checked as the library, never inferred from the parent site', async () => {
    const { svc, calls } = setup();
    const before = byService(svc.status(actorA()), 'sharepoint').state;
    // Approved library (drive b!drive_1) verified as a library.
    assert.equal((await svc.sharePointLink(actorA(), `https://${host}/sites/Sasa/Shared%20Documents`)).verifiedScope, 'library');
    // A library Microsoft lists but IT has not approved: only the parent site is confirmed.
    const hr = await svc.sharePointLink(actorA(), `https://${host}/sites/Sasa/HR%20Private`);
    assert.deepEqual([hr.outcome, hr.verifiedScope], ['SiteVerifiedLibraryNotApproved', 'site']);
    // A library Microsoft does not list for this person: only the parent site is confirmed.
    const gone = await svc.sharePointLink(actorA(), `https://${host}/sites/Sasa/Board%20Papers`);
    assert.deepEqual([gone.outcome, gone.verifiedScope], ['SiteVerifiedLibraryNotFound', 'site']);
    // A site link says site, and no link check changes the connection status.
    assert.equal((await svc.sharePointLink(actorA(), `https://${host}/sites/Sasa`)).verifiedScope, 'site');
    assert.equal(byService(svc.status(actorA()), 'sharepoint').state, before);
    assert.ok(calls.some(c => c.url.includes('/drives?$select=id,webUrl')));
  });

  it('replacing a team or site ID under the same key does not inherit the old Connected status', async () => {
    let over: NodeJS.ProcessEnv = {};
    const ms = microsoft({ joined: { A: [teamSasa, teamUnapproved], B: [teamInas] }, sites: { A: [siteSasa, siteInas], B: [siteInas] } });
    const svc = new M365Connections(() => env(over), ms.http, () => new Date('2026-11-03T01:00:00Z'));
    assert.equal((await svc.check(actorA(), 'teams', 'sasa-ops')).state, 'connected');
    assert.equal((await svc.check(actorA(), 'sharepoint', 'sasa-site')).state, 'connected');
    const teams = JSON.parse(env().M365_TEAMS_APPROVED_JSON!); teams[0].teamId = teamUnapproved;
    const sites = JSON.parse(env().SHAREPOINT_APPROVED_SITES_JSON!); sites[0].siteId = siteInas.replace('d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000009');
    over = { M365_TEAMS_APPROVED_JSON: JSON.stringify(teams), SHAREPOINT_APPROVED_SITES_JSON: JSON.stringify(sites) };
    const s = svc.status(actorA());
    assert.deepEqual([byService(s, 'teams').state, byService(s, 'teams').reason], ['configured', 'NotChecked']);
    assert.deepEqual([byService(s, 'sharepoint').state, byService(s, 'sharepoint').reason], ['configured', 'NotChecked']);
    // A changed app registration also invalidates the Outlook check.
    over = {};
    assert.equal((await svc.check(actorA(), 'outlook')).state, 'connected');
    over = { ENTRA_API_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff' };
    assert.equal(byService(svc.status(actorA()), 'outlook').state, 'configured');
  });

  it('an ID replaced while Microsoft is still answering does not get the late result', async () => {
    let over: NodeJS.ProcessEnv = {};
    const ms = microsoft({ delayMs: 5 });
    const svc = new M365Connections(() => env(over), ms.http, () => new Date('2026-11-03T01:00:00Z'));
    const running = svc.check(actorA(), 'teams', 'sasa-ops');
    const teams = JSON.parse(env().M365_TEAMS_APPROVED_JSON!); teams[0].teamId = teamUnapproved;
    over = { M365_TEAMS_APPROVED_JSON: JSON.stringify(teams) };
    assert.equal((await running).state, 'configured');
    assert.equal(byService(svc.status(actorA()), 'teams').state, 'configured');
  });

  it('SharePoint: approved site for A; B sees only sites approved for B and all its companies', async () => {
    const { svc, calls } = setup();
    assert.deepEqual(byService(svc.status(actorA()), 'sharepoint').resources.map(r => r.key), ['sasa-site']);
    // B is listed on the Sasa site but cannot see the Sasa company: not offered.
    assert.deepEqual(byService(svc.status(actorB()), 'sharepoint').resources.map(r => r.key), ['inas-site']);
    await assert.rejects(svc.check(actorB(), 'sharepoint', 'sasa-site'), ForbiddenException);
    assert.equal(calls.length, 0);
    assert.equal((await svc.check(actorA(), 'sharepoint', 'sasa-site')).state, 'connected');
  });

  it('SharePoint links: own approved site verified, other company refused, other organization refused without a call, sharing links refused', async () => {
    const { svc, calls } = setup();
    const ok = await svc.sharePointLink(actorA(), `https://${host}/sites/Sasa/Shared%20Documents/Forms/AllItems.aspx`);
    assert.deepEqual([ok.outcome, ok.resourceKey, ok.canonicalUrl, ok.verifiedScope], ['Verified', 'sasa-site', `https://${host}/sites/Sasa/Shared%20Documents`, 'library']);
    // A can open the Inas site in Microsoft? No: Microsoft refuses A, and Prima says so without guessing why.
    assert.equal((await svc.sharePointLink(actorA(), `https://${host}/sites/Inas`)).outcome, 'NotApprovedOrNoAccess');
    // B can open the Sasa site in Microsoft, but it belongs to a company B cannot see in Prima.
    assert.equal((await svc.sharePointLink(actorB(), `https://${host}/sites/Sasa`)).outcome, 'WrongCompany');
    const before = calls.length;
    assert.equal((await svc.sharePointLink(actorA(), 'https://othertenant.sharepoint.com/sites/Sasa')).outcome, 'WrongOrganization');
    assert.equal(calls.length, before);
    for (const bad of ['https://example.sharepoint.com/:w:/s/Sasa/EabcToken?e=xyz', 'http://example.sharepoint.com/sites/Sasa', 'https://evil.example/sites/Sasa', 'https://example.sharepoint.com/sites/Sasa/_api/web'])
      await assert.rejects(svc.sharePointLink(actorA(), bad), BadRequestException);
  });

  it('duplicate clicks share one Microsoft call per person; two people still get their own', async () => {
    const { svc, calls } = setup({}, { delayMs: 5 });
    const [a1, a2, b1] = await Promise.all([svc.check(actorA(), 'outlook'), svc.check(actorA(), 'outlook'), svc.check(actorB(), 'outlook')]);
    assert.deepEqual([a1.state, a2.state, b1.state], ['connected', 'connected', 'connected']);
    assert.equal(calls.filter(c => c.who === 'A').length, 2); // one token exchange + one Graph read
    assert.equal(calls.filter(c => c.who === 'B').length, 2);
  });

  it('disconnect forgets the check and a late result from a running check is discarded', async () => {
    const { svc } = setup({}, { delayMs: 5 });
    const running = svc.check(actorA(), 'outlook');
    const off = await svc.disconnect(actorA(), 'outlook');
    assert.deepEqual([off.state, off.reason], ['configured', 'Disconnected']);
    await running;
    assert.deepEqual([byService(svc.status(actorA()), 'outlook').state, byService(svc.status(actorA()), 'outlook').reason], ['configured', 'Disconnected']);
    // Reconnect = a fresh check.
    assert.equal((await svc.check(actorA(), 'outlook')).state, 'connected');
    // B's disconnect never touches A.
    await svc.disconnect(actorB(), 'outlook');
    assert.equal(byService(svc.status(actorA()), 'outlook').state, 'connected');
  });

  it('verified status expires after 8 hours and asks for a fresh check', async () => {
    const { svc, advance } = setup();
    await svc.check(actorA(), 'outlook');
    advance(VERIFIED_FOR_MS);
    const s = byService(svc.status(actorA()), 'outlook');
    assert.deepEqual([s.state, s.reason], ['configured', 'CheckExpired']);
  });

  it('an approved team removed from the list is not shown as connected', async () => {
    let list = env().M365_TEAMS_APPROVED_JSON!;
    const ms = microsoft();
    const svc = new M365Connections(() => env({ M365_TEAMS_APPROVED_JSON: list }), ms.http, () => new Date('2026-11-03T01:00:00Z'));
    await svc.check(actorA(), 'teams', 'sasa-ops');
    list = JSON.stringify([{ key: 'sasa-new', name: 'Replacement', teamId: teamSasa.replace('1', '9'), companyIds: ['co-sasa'] }]);
    assert.equal(byService(svc.status(actorA()), 'teams').state, 'configured');
  });
});

describe('M365 Connections: consent, expiry, claims and throttling', () => {
  const tokenErr = (body: unknown, status = 400, headers: Record<string, string> = {}) => json(body, status, headers);

  it('consent needed for a new person; consent revoked after a previous success', async () => {
    const t = setup();
    assert.equal((await t.svc.check(actorA(), 'outlook')).state, 'connected');
    t.world.tokenError.A = tokenErr({ error: 'invalid_grant', error_codes: [65001], suberror: 'consent_required', error_description: 'PRIVATE DESCRIPTION' });
    t.world.tokenError.B = tokenErr({ error: 'invalid_grant', error_codes: [65001] });
    const a = await t.svc.check(actorA(), 'outlook');
    const b = await t.svc.check(actorB(), 'outlook');
    assert.deepEqual([a.state, a.reason, a.actions], ['consent_needed', 'ConsentRevoked', ['reconnect', 'disconnect']]);
    assert.deepEqual([b.state, b.reason], ['consent_needed', 'ConsentRequired']);
    assert.ok(!JSON.stringify(a).includes('PRIVATE'));
  });

  it('expired session and claims challenges ask to reconnect; claims go back only to the same person', async () => {
    const t = setup();
    t.world.tokenError.A = tokenErr({ error: 'invalid_grant', error_codes: [50173] });
    assert.deepEqual([(await t.svc.check(actorA(), 'outlook')).state, (await t.svc.check(actorA(), 'outlook')).reason], ['expired_or_revoked', 'SessionExpired']);
    const claims = '{"access_token":{"polids":{"essential":true,"values":["synthetic"]}}}';
    t.world.tokenError.A = tokenErr({ error: 'interaction_required', error_codes: [50076], claims });
    const s = await t.svc.check(actorA(), 'outlook');
    assert.deepEqual([s.state, s.reason, s.claims], ['expired_or_revoked', 'ReauthenticationRequired', claims]);
    assert.equal(byService(t.svc.status(actorB()), 'outlook').claims, undefined);
    // Continuous access evaluation from Graph.
    t.world.tokenError.A = null;
    t.world.graphError.A = json({}, 401, { 'www-authenticate': `Bearer error="insufficient_claims", claims="${Buffer.from(claims).toString('base64')}"` });
    assert.equal((await t.svc.check(actorA(), 'outlook')).claims, claims);
    // Reconnect after signing in again.
    t.world.graphError.A = null;
    assert.equal((await t.svc.check(actorA(), 'outlook')).state, 'connected');
  });

  it('429 Retry-After: no further Microsoft call until it passes', async () => {
    const t = setup();
    t.world.graphError.A = json({}, 429, { 'retry-after': '120' });
    const s = await t.svc.check(actorA(), 'outlook');
    assert.deepEqual([s.state, s.reason, s.retryAfterSeconds, s.actions], ['unavailable', 'RateLimited', 120, ['disconnect']]);
    const n = t.calls.length;
    await t.svc.check(actorA(), 'outlook');
    assert.equal(t.calls.length, n);
    t.advance(121_000);
    t.world.graphError.A = null;
    assert.equal((await t.svc.check(actorA(), 'outlook')).state, 'connected');
  });

  it('a broader granted scope fails closed instead of widening access', async () => {
    const t = setup();
    t.world.tokenError.A = json({ token_type: 'Bearer', access_token: 'GRAPH_A_Mail.ReadBasic', scope: 'Mail.ReadBasic Mail.Send' });
    const s = await t.svc.check(actorA(), 'outlook');
    assert.deepEqual([s.state, s.reason], ['unavailable', 'UnexpectedScopes']);
  });

  it('classifies identity platform errors and parses Retry-After and claims defensively', () => {
    assert.equal(classifyTokenError(400, { error: 'invalid_grant', error_codes: [700082] }).reason, 'SessionExpired');
    assert.equal(classifyTokenError(400, { error: 'invalid_grant', error_codes: [53003] }).reason, 'AccessDenied');
    assert.equal(classifyTokenError(400, { error: 'invalid_client' }).reason, 'ProviderUnavailable');
    assert.equal(classifyTokenError(503, null, 5).retryAfterSeconds, 5);
    assert.equal(retryAfter('999999', 0), 3600);
    assert.equal(retryAfter('soon', 0), undefined);
    assert.equal(claimsFromChallenge('Bearer error="invalid_token"'), undefined);
    assert.equal(claimsFromChallenge(`Bearer error="insufficient_claims", claims="${Buffer.from('not json').toString('base64')}"`), undefined);
  });
});

describe('M365 Connections: link parsing and configuration', () => {
  it('accepts only Teams channel links with tenant and team IDs', () => {
    const ok = teamsChannelLink(`https://teams.microsoft.com/l/channel/${encodeURIComponent(general)}/General?groupId=${teamSasa}&tenantId=${tenant}`);
    assert.deepEqual(ok, { tenantId: tenant, teamId: teamSasa, channelId: general });
    for (const bad of [
      `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent(general)}/0?context=x`,
      `https://teams.evil.example/l/channel/${encodeURIComponent(general)}/G?groupId=${teamSasa}&tenantId=${tenant}`,
      `https://teams.microsoft.com/l/channel/${encodeURIComponent(general)}/G?groupId=${teamSasa}`,
      `https://teams.microsoft.com/l/channel/not-a-channel/G?groupId=${teamSasa}&tenantId=${tenant}`,
      `https://teams.microsoft.com/l/channel/${encodeURIComponent(general)}/G?groupId=${teamSasa}&tenantId=${tenant}&redirect=https://evil.example`,
      `https://user:pw@teams.microsoft.com/l/channel/${encodeURIComponent(general)}/G?groupId=${teamSasa}&tenantId=${tenant}`,
    ]) assert.throws(() => teamsChannelLink(bad), BadRequestException);
  });

  it('rejects duplicate, wildcard or extra-field team lists', () => {
    const t = { key: 'a', name: 'A', teamId: teamSasa, companyIds: ['co-sasa'] };
    for (const bad of [[t, t], [{ ...t, companyIds: ['*'] }], [{ ...t, extra: 1 }], [{ ...t, companyIds: [] }], []]) assert.equal(approvedTeams(JSON.stringify(bad)), null);
    assert.equal(approvedTeams(JSON.stringify([t]))?.length, 1);
  });

  it('unknown service and unexpected input are refused', async () => {
    const { svc } = setup();
    await assert.rejects(svc.check(actorA(), 'powerbi'), BadRequestException);
    await assert.rejects(svc.check(actorA(), 'outlook', 'anything'), ForbiddenException);
  });
});

describe('M365 capability and permission matrix', () => {
  const scopes = Object.values(M365_CAPABILITIES).flatMap(c => c.delegatedScopes.map(s => s.scope));
  it('is delegated and read-only: no send, write or broad site scope', () => {
    assert.deepEqual(scopes, ['Mail.ReadBasic', 'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'Sites.Selected']);
    for (const s of scopes) assert.ok(!/Send|Write|Manage|FullControl|Sites\.Read\.All|Files\./.test(s), s);
  });
  it('the service only ever asks Microsoft for scopes in the matrix', async () => {
    const t = setup();
    await t.svc.check(actorA(), 'outlook');
    await t.svc.check(actorA(), 'teams', 'sasa-ops');
    await t.svc.check(actorA(), 'sharepoint', 'sasa-site');
    await t.svc.teamsLink(actorA(), `https://teams.microsoft.com/l/channel/${encodeURIComponent(general)}/G?groupId=${teamSasa}&tenantId=${tenant}`);
    await t.svc.sharePointLink(actorA(), `https://${host}/sites/Sasa`);
    const asked = new Set(t.calls.filter(c => c.url.includes('login.microsoftonline.com')).map(c => c.scope));
    assert.deepEqual([...asked].sort(), [...scopes].sort());
    assert.ok(t.calls.every(c => c.url.startsWith('https://login.microsoftonline.com/') || c.url.startsWith('https://graph.microsoft.com/v1.0/')));
    assert.ok(t.calls.every(c => !c.url.includes('/shares/') && !c.url.includes('downloadUrl')));
  });
  it('every service has bilingual guidance and the control-ownership matrix names CEO approval for tenant changes', () => {
    for (const c of Object.values(M365_CAPABILITIES)) for (const g of [c.why, c.data, c.whereToGetLink, c.whoHelps]) assert.ok(g.bm && g.en);
    assert.ok(M365_CONTROL_OWNERSHIP.some(r => r.owner === 'CEO (Fauzan)' && /consent/i.test(r.control)));
    assert.ok(!JSON.stringify(M365_CAPABILITIES).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/));
  });
});
