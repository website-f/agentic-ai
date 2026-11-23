import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import type { User } from '@prima/core';
import { UsageController, UsageRuntime, usageBoard, usageRuntime } from '../src/m365-usage/controller';
import { GraphUsageReader, usageGraphConfiguration } from '../src/m365-usage/graph';
import { MemoryUsageStore, PgUsageStore } from '../src/m365-usage/pg-store';
import { m365LinkStates } from '../src/m365-usage/links';
import type { Db } from '../src/db';

// Microsoft use board (rule M365-USE). Synthetic identities and synthetic report files only; no provider is called.
const tenant = '11111111-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oidA = '99999999-8888-7777-6666-555555555551';
const oidB = '99999999-8888-7777-6666-555555555552';
const key = 'k'.repeat(40);
const PRIMA_APP = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  M365_USAGE_ENABLED: 'true',
  M365_USAGE_RUN_KEY: key,
  ENTRA_TENANT_ID: tenant,
  M365_USAGE_CLIENT_ID: client,
  M365_USAGE_CLIENT_SECRET: 'SECRET_PRIVATE',
  ...over,
});
const u = (id: string, over: Partial<User>): User => ({ id, name: `Name ${id}`, title: 't', role: 'admin_exec', companyIds: [], siteIds: [], ...over }) as User;
const manager = u('cm', { role: 'company_manager', companyIds: ['co-a'], entraOid: oidA });
const staff = u('ae', { role: 'admin_exec', companyIds: ['co-a'], entraOid: oidB });
const outsider = u('ae2', { role: 'admin_exec', companyIds: ['co-b'] });
const users = [manager, staff, outsider];

const ACTIVE_CSV = [
  'Report Refresh Date,User Principal Name,Display Name,Is Deleted,Deleted Date,Has Exchange License,Exchange Last Activity Date,OneDrive Last Activity Date,SharePoint Last Activity Date,Teams Last Activity Date,Assigned Products',
  '2026-11-21,cm@example.invalid,SHOULD NOT BE KEPT,False,,True,2026-11-20,2026-11-20,,2026-11-20,"MICROSOFT 365 BUSINESS PREMIUM"',
  '2026-11-21,ae@example.invalid,SHOULD NOT BE KEPT,False,,True,2026-08-01,,,,MICROSOFT 365 BUSINESS BASIC',
].join('\r\n');

/** A fake Microsoft: token, 302 report downloads, JSON lists. Records every address asked for. */
function fakeGraph(opts: { failDevices?: boolean; badRedirect?: boolean; failSignIns?: boolean } = {}) {
  const asked: { url: string; auth: string | null }[] = [];
  const http = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get('authorization');
    asked.push({ url, auth });
    if (url.includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'TOKEN', expires_in: 3600 }), { status: 200 });
    if (url.includes('/reports/get')) {
      const name = url.includes('ActiveUser') ? 'active' : url.includes('Mailbox') ? 'mailbox' : url.includes('SharePointActivity') ? 'sp' : url.includes('M365AppUserDetail') ? 'apps' : 'acts';
      const loc = opts.badRedirect ? 'https://evil.example.invalid/x' : `https://reports.office.com/data/download/${name}`;
      return new Response(null, { status: 302, headers: { location: loc } });
    }
    if (url === 'https://reports.office.com/data/download/active') return new Response(ACTIVE_CSV, { status: 200 });
    if (url === 'https://reports.office.com/data/download/mailbox')
      return new Response('User Principal Name,Is Deleted,Storage Used (Byte),Prohibit Send Quota (Byte)\ncm@example.invalid,False,10,100\n', { status: 200 });
    if (url === 'https://reports.office.com/data/download/apps')
      return new Response('Report Refresh Date,User Principal Name,Last Activation Date,Last Activity Date,Report Period,Windows,Mac,Mobile,Web,Outlook,Word,Excel,PowerPoint,OneNote,Teams\n2026-11-21,cm@example.invalid,,2026-11-20,30,Yes,No,No,No,Yes,No,No,No,Yes,Yes\n2026-11-21,ae@example.invalid,,,30,No,No,No,No,No,No,No,No,No,No\n', { status: 200 });
    if (url === 'https://reports.office.com/data/download/sp')
      return new Response('Report Refresh Date,User Principal Name,Is Deleted,Deleted Date,Last Activity Date,Viewed Or Edited File Count,Synced File Count,Shared Internally File Count,Shared Externally File Count,Visited Page Count,Assigned Products,Report Period\n2026-11-21,cm@example.invalid,False,,2026-11-20,3,0,0,0,2,MICROSOFT 365 BUSINESS PREMIUM,30\n', { status: 200 });
    if (url === 'https://reports.office.com/data/download/acts') return new Response('User Principal Name,Product Type,Windows,Mac\ncm@example.invalid,MICROSOFT 365 APPS FOR BUSINESS,0,0\n', { status: 200 });
    if (url.includes('userRegistrationDetails'))
      return new Response(
        JSON.stringify({
          value: [
            { id: oidA, userPrincipalName: 'cm@example.invalid', isMfaRegistered: true, isSsprRegistered: true },
            { id: oidB, userPrincipalName: 'ae@example.invalid', isMfaRegistered: false, isSsprRegistered: false },
          ],
          '@odata.nextLink': 'https://elsewhere.example.invalid/next',
        }),
        { status: 200 },
      );
    if (url.includes('/auditLogs/signIns'))
      return opts.failSignIns
        ? new Response('{"error":"SECRET_SIGNIN"}', { status: 403 })
        : new Response(
            JSON.stringify({
              value: [
                { userId: oidA, appId: '2793995e-0a7d-40d7-bd35-6968ba142197', createdDateTime: '2026-11-20T01:02:03Z', ipAddress: '198.51.100.7', location: { city: 'SHOULD NOT BE KEPT' }, status: { errorCode: 0 } },
                { userId: oidB, appId: '2793995e-0a7d-40d7-bd35-6968ba142197', createdDateTime: '2026-11-20T01:02:03Z', status: { errorCode: 50126 } },
                { userId: oidB, appId: PRIMA_APP, createdDateTime: '2026-11-21T08:00:00Z', status: { errorCode: 0 } },
              ],
            }),
            { status: 200 },
          );
    if (url.includes('managedDevices'))
      return opts.failDevices ? new Response('{"error":"SECRET_BODY"}', { status: 403 }) : new Response(JSON.stringify({ value: [{ userId: oidA, complianceState: 'compliant' }] }), { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { http, asked };
}

describe('Microsoft use board settings', () => {
  it('stays off unless every setting is present', () => {
    assert.equal(usageRuntime({}, new MemoryUsageStore()).reader, null);
    assert.equal(usageRuntime(env({ M365_USAGE_ENABLED: 'false' }), new MemoryUsageStore()).reader, null);
    assert.equal(usageRuntime(env({ M365_USAGE_RUN_KEY: 'short' }), new MemoryUsageStore()).reader, null);
    assert.equal(usageRuntime(env({ M365_USAGE_CLIENT_SECRET: '' }), new MemoryUsageStore()).reader, null);
    assert.equal(usageGraphConfiguration(env({ ENTRA_TENANT_ID: 'not-a-guid' })), null);
    assert.ok(usageRuntime(env(), new MemoryUsageStore()).reader);
  });
});

describe('reading Microsoft usage records', () => {
  it('reads reports and lists, follows only Microsoft download hosts and graph next pages, and drops display names', async () => {
    const g = fakeGraph();
    const { sources, failed } = await new GraphUsageReader(usageGraphConfiguration(env())!, g.http).read();
    assert.deepEqual(failed, []);
    assert.equal(sources.refreshed, '2026-11-21');
    assert.equal(sources.active?.length, 2);
    assert.deepEqual(sources.sharePoint, [{ upn: 'cm@example.invalid', last: '2026-11-20', viewedOrEdited: 3 }]);
    assert.ok(!JSON.stringify(sources).includes('SHOULD NOT BE KEPT'));
    assert.equal(sources.registrations?.length, 2);
    assert.ok(!g.asked.some((a) => a.url.includes('elsewhere.example.invalid')));
    // My Apps: only successful sign-ins, and only the account id and the day are kept.
    assert.deepEqual(sources.myApps, [{ oid: oidA, day: '2026-11-20' }]);
    assert.equal(sources.primaSignIns, null, 'no Prima sign-in app configured');
    assert.ok(!JSON.stringify(sources).includes('198.51.100.7'));
    const ask = g.asked.find((a) => a.url.includes('/auditLogs/signIns'))!.url;
    assert.ok(decodeURIComponent(ask).includes("appId eq '2793995e-0a7d-40d7-bd35-6968ba142197' and createdDateTime ge "));
    // The pre-signed download is fetched without the Graph token.
    assert.ok(g.asked.filter((a) => a.url.startsWith('https://reports.office.com/')).every((a) => a.auth === null));
  });

  it('a failed source is Unknown and its error body is never kept', async () => {
    const g = fakeGraph({ failDevices: true });
    const { sources, failed } = await new GraphUsageReader(usageGraphConfiguration(env())!, g.http).read();
    assert.deepEqual(failed, ['devices']);
    assert.equal(sources.devices, null);
    assert.ok(!JSON.stringify({ sources, failed }).includes('SECRET_BODY'));
  });

  it('counts sign-ins to Prima itself when its sign-in app is configured, in the same one read', async () => {
    const g = fakeGraph();
    const { sources } = await new GraphUsageReader(usageGraphConfiguration(env({ ENTRA_SPA_CLIENT_ID: PRIMA_APP }))!, g.http).read();
    assert.deepEqual(sources.primaSignIns, [{ oid: oidB, day: '2026-11-21' }]);
    assert.deepEqual(sources.myApps, [{ oid: oidA, day: '2026-11-20' }]);
    const asks = g.asked.filter((a) => a.url.includes('/auditLogs/signIns'));
    assert.equal(asks.length, 1);
    assert.ok(decodeURIComponent(asks[0].url).includes(`or appId eq '${PRIMA_APP}'`));
  });

  it('a sign-in log that cannot be read leaves My Apps Unknown', async () => {
    const g = fakeGraph({ failSignIns: true });
    const { sources, failed } = await new GraphUsageReader(usageGraphConfiguration(env())!, g.http).read();
    assert.deepEqual(failed, ['sign-in log']);
    assert.equal(sources.myApps, null);
    assert.ok(!JSON.stringify({ sources, failed }).includes('SECRET_SIGNIN'));
  });

  it('refuses a download address outside Microsoft', async () => {
    const g = fakeGraph({ badRedirect: true });
    const { sources, failed } = await new GraphUsageReader(usageGraphConfiguration(env())!, g.http).read();
    assert.deepEqual(failed, ['active users', 'mailbox', 'SharePoint activity', 'Microsoft 365 apps', 'Office activations']);
    assert.equal(sources.active, null);
    assert.ok(!g.asked.some((a) => a.url.includes('evil.example.invalid')));
  });
});

describe('run and board endpoints', () => {
  const db = (viewer: User) =>
    ({
      pool: { query: async () => ({ rows: users.map((data) => ({ data })) }) },
      asUser: async (_uid: string, fn: (svc: unknown, u: User) => unknown) => fn({}, viewer),
    }) as unknown as Db;

  it('run answers 503 while off or not installed, 401 to a wrong key, and stores counts only', async () => {
    await assert.rejects(new UsageController(db(manager), new UsageRuntime(null, null, new MemoryUsageStore())).run(key, {}), /switched off/);
    const store = new MemoryUsageStore();
    const rt = usageRuntime(env(), store, fakeGraph().http);
    const c = new UsageController(db(manager), rt);
    await assert.rejects(c.run('x'.repeat(40), {}), /key not valid/);
    await assert.rejects(c.run(undefined, {}), /key not valid/);
    await assert.rejects(new UsageController(db(manager), usageRuntime(env(), new MemoryUsageStore(false), fakeGraph().http)).run(key, {}), /not installed/);
    const out = await c.run(key, {});
    assert.equal(out.people, 3);
    assert.equal(out.linked, 2);
    const saved = JSON.stringify(await store.latest());
    assert.ok(!saved.includes('example.invalid'), 'sign-in names are never stored');
    assert.ok(!saved.includes('Name '), 'names are never stored');
  });

  it('the board keeps the walls: staff see themselves, the Company Manager sees own company only', async () => {
    const store = new MemoryUsageStore();
    const rt = usageRuntime(env(), store, fakeGraph().http);
    await new UsageController(db(manager), rt).run(key, {});
    const mine = await new UsageController(db(staff), rt).board('ae', {});
    assert.equal(mine.mine?.checks.authenticator, 'missing');
    assert.equal(mine.people?.length, 0);
    const cm = await new UsageController(db(manager), rt).board('cm', {});
    assert.deepEqual(cm.people?.map((p) => p.id), ['ae']);
    assert.equal(cm.mine?.checks.device, 'ok');
    assert.equal(cm.mine?.checks.labels, 'unknown');
    assert.equal(cm.mine?.checks.my_apps, 'ok');
    assert.equal(cm.mine?.checks.sharepoint, 'ok');
    assert.equal(cm.mine?.checks.onedrive, 'ok');
    assert.equal(mine.mine?.checks.sharepoint, 'missing');
    assert.equal(cm.mine?.checks.onenote, 'ok');
    assert.equal(mine.mine?.checks.onenote, 'missing');
    assert.equal(cm.mine?.checks.loop, 'unknown');
    assert.equal(mine.mine?.checks.my_apps, 'missing');
    assert.equal(cm.mine?.plan, 'premium');
    assert.match(cm.mine?.planGives?.en ?? '', /Business Premium/);
    assert.deepEqual(cm.summary?.plans, { premium: 1, basic_p1: 0, basic: 1, other: 0 });
  });

  it('a board with no stored day shows the how-to only', () => {
    const b = usageBoard(staff, users, null, '2026-11-23');
    assert.equal(b.snapshot, null);
    assert.equal(b.howto.length, 14);
  });
});

describe('Microsoft use store on PostgreSQL', { skip: !process.env.DATABASE_URL }, () => {
  it('is not ready before the module, then keeps one row per day with ids only', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query('DROP TABLE IF EXISTS prima.m365_usage_days');
      const store = new PgUsageStore(pool);
      assert.equal(await store.ready(), false);
      await pool.query(readFileSync(join(__dirname, '../../../../db/modules/m365-usage-v1.sql'), 'utf8'));
      assert.equal(await store.ready(), true);
      const day = { asOf: '2026-11-23', refreshed: '2026-11-21', namesHidden: false, people: [{ userId: 'ae', linked: true, managed: false, checks: { teams: 'ok' as const }, idle: false }] };
      await store.save(day);
      await store.save({ ...day, people: [] });
      assert.deepEqual((await store.latest())?.people, []);
      await store.save({ ...day, asOf: '2026-01-01' });
      await store.save(day);
      const n = await pool.query('SELECT count(*)::int AS n FROM prima.m365_usage_days');
      assert.equal(n.rows[0].n, 1, 'days older than 90 are removed');
    } finally {
      await pool.query('DROP TABLE IF EXISTS prima.m365_usage_days').catch(() => undefined);
      await pool.end();
    }
  });
});

describe('Prima and Microsoft links', () => {
  it('everything is Off with no settings, proof links Partly until the group host is set, and invalid settings stay Off', () => {
    const s = m365LinkStates({});
    assert.equal(s.entra_signin, 'off');
    assert.equal(s.alerts, 'off');
    assert.equal(s.connections, 'off');
    assert.equal(s.sharepoint_proof, 'partly');
    assert.equal(s.usage_board, 'off');
    assert.equal(m365LinkStates({ SHAREPOINT_PROOF_HOSTS: 'contoso.sharepoint.com' }).sharepoint_proof, 'on');
    assert.equal(m365LinkStates({ ENTRA_TENANT_ID: 'not-a-guid', ENTRA_CLIENT_ID: 'x' }).entra_signin, 'off');
    assert.equal(m365LinkStates({ ENTRA_TENANT_ID: tenant, ENTRA_CLIENT_ID: client }).entra_signin, 'on');
    assert.equal(m365LinkStates(env()).usage_board, 'on');
    assert.equal(m365LinkStates({ TEAMS_APPROVALS_READ: 'true' }).teams_approvals, 'on');
    // Sending to Planner is still a stand-in, so Planner never shows fully On.
    assert.equal(s.planner, 'off');
    assert.equal(m365LinkStates({ PLANNER_API_KEY: 'p'.repeat(40), PLANNER_SIGNING_SECRET: 's'.repeat(40) }).planner, 'partly');
  });

  it('only IT and group leaders get the list, and it never carries a setting value', async () => {
    const store = new MemoryUsageStore();
    const rt = usageRuntime(env({ ENTRA_SPA_CLIENT_ID: PRIMA_APP }), store, fakeGraph().http);
    const it = u('it', { role: 'pwvsb_officer', department: 'it', itRole: 'executive', entraOid: oidA });
    const all = [...users, it];
    const dbFor = (viewer: User) =>
      ({ pool: { query: async () => ({ rows: all.map((data) => ({ data })) }) }, asUser: async (_u: string, fn: (s: unknown, v: User) => unknown) => fn({}, viewer) }) as unknown as Db;
    await new UsageController(dbFor(it), rt).run(key, {});
    const itBoard = await new UsageController(dbFor(it), rt).board('it', {});
    assert.equal(itBoard.links?.length, 10);
    assert.equal(itBoard.links?.find((l) => l.id === 'usage_board')?.state, 'on');
    assert.ok(itBoard.linkUse && itBoard.linkUse.primaSignIn >= 1);
    assert.ok(!JSON.stringify(itBoard.links).includes('SECRET_PRIVATE') && !JSON.stringify(itBoard.links).includes(client));
    const cm = await new UsageController(dbFor(manager), rt).board('cm', {});
    assert.equal(cm.links, undefined);
    assert.equal(cm.linkUse, undefined);
  });
});
