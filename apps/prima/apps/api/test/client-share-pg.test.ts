// Client report links (Fauzan, 3 Nov 2026: "Shared report links first") through the restricted login and the company
// wall, plus the public page's signature check and escaping. Synthetic seed data on a throwaway local PostgreSQL.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays } from '@prima/core';
import { Db, nowMyt } from '../src/db';
import { resetDb } from '../src/reset-db';
import { shareBase, shareCsp, shareReportPage, shareSecret, signShare, verifyShare } from '../src/share-links';

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:localdev@localhost:5432/prima_test';
process.env.DATABASE_URL = URL;

describe('client report link signing', () => {
  it('refuses forged, altered or extra-part tokens, and is off in production without a secret', () => {
    const s = 'k'.repeat(40);
    const t = signShare({ c: 'co-a', k: 'cl-1', l: 'csl-1' }, s);
    assert.deepEqual(verifyShare(t, s), { c: 'co-a', k: 'cl-1', l: 'csl-1' });
    assert.equal(verifyShare(t, 'z'.repeat(40)), null);
    const [p, sig] = t.split('.');
    const other = Buffer.from(JSON.stringify({ c: 'co-b', k: 'cl-1', l: 'csl-1' })).toString('base64url');
    assert.equal(verifyShare(`${other}.${sig}`, s), null);
    assert.equal(verifyShare(`${p}.${sig}.x`, s), null);
    assert.equal(verifyShare(t, null), null);
    assert.equal(shareSecret({ NODE_ENV: 'production' }), null);
    assert.equal(shareSecret({ NODE_ENV: 'production', SHARE_LINK_SECRET: 'short' }), null);
    assert.equal(shareBase({ NODE_ENV: 'production' }), null);
    assert.equal(shareBase({ NODE_ENV: 'production', SHARE_LINK_BASE: 'http://plain.example' }), null);
    assert.equal(shareBase({ NODE_ENV: 'production', SHARE_LINK_BASE: 'https://<staging-api-url>/' }), 'https://<staging-api-url>');
  });

  it('escapes every value and allows no scripts', () => {
    const html = shareReportPage({
      clientName: '<script>alert(1)</script>',
      companyName: 'A & B',
      from: '2026-10-01',
      to: '2026-10-26',
      expiresOn: '2026-10-30',
      generatedAt: '2026-10-26T10:00:00+08:00',
      sites: [{ name: '"><img src=x>', patrolScans: 3, visits: 1 }],
      incidents: [],
      invoices: [{ period: '2026-09', amount: 1000, sentOn: null }],
      reports: [],
    });
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.match(html, /does not show payments/);
    assert.match(shareCsp(), /default-src 'none'; style-src 'sha256-/);
    assert.ok(!shareCsp().includes('script-src'));
  });
});

describe('client report links on PostgreSQL', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('opens only inside its own company, counts views, and stops when revoked', async () => {
    const today = nowMyt().slice(0, 10);
    const siteId = await db.asUser('u-cm-sasa', async (svc, u) => (await svc.clientBoard(u)).canAdd.find((c) => c.companyId === 'co-sasa')!.sites[0].id);
    const acct = await db.asUser('u-cm-sasa', (svc, u) => svc.addClientAccount(u, { companyId: 'co-sasa', name: 'PG Synthetic Client', siteIds: [siteId], contractEndsOn: null }));
    const input = { recipient: 'Facilities manager', from: addDays(today, -30), to: today, days: 5 };
    await assert.rejects(db.asUser('u-cm-inas', (svc, u) => svc.createClientShareLink(u, acct.id, input)), /not found|denied|cannot/i);
    const { link } = await db.asUser('u-cm-sasa', (svc, u) => svc.createClientShareLink(u, acct.id, input));
    // The public path: a session limited to the link's company. Another company's session cannot see the client.
    const rep = await db.asShareLink('co-sasa', (svc) => svc.clientShareReport('co-sasa', acct.id, link.id));
    assert.equal(rep.clientName, 'PG Synthetic Client');
    assert.equal(rep.sites.length, 1);
    // client_accounts is a group table without row-level security (as before this change), so a session for another
    // company could read the account row; writing the view to the audit is refused by the audit wall, so it fails.
    await assert.rejects(db.asShareLink('co-inas', (svc) => svc.clientShareReport('co-sasa', acct.id, link.id)), /not found|row-level security/i);
    await assert.rejects(db.asShareLink('co-inas', (svc) => svc.clientShareReport('co-inas', acct.id, link.id)), /not found/i);
    // Row-level security, not only code, for the company tables the page reads: no other company's sites, cases or scans.
    const leak = await db.asShareLink('co-sasa', async (_svc, store) => {
      const rows = [...(await store.list('sites', {})), ...(await store.list('cases', {})), ...(await store.list('scans', {})), ...(await store.list('siteVisits', {}))];
      return rows.filter((r) => r.companyId !== 'co-sasa').length;
    });
    assert.equal(leak, 0);
    const views = await db.asUser('u-cm-sasa', async (_svc, _u, store) => (await store.get('clientAccounts', acct.id))!.shareLinks![0].views);
    assert.equal(views, 1);
    await db.asUser('u-cm-sasa', (svc, u) => svc.revokeClientShareLink(u, acct.id, link.id, 'Recipient changed'));
    await assert.rejects(db.asShareLink('co-sasa', (svc) => svc.clientShareReport('co-sasa', acct.id, link.id)), /not found/i);
    const actions = await db.asUser('u-fauzan', async (_svc, _u, store) => (await store.list('audit', {})).filter((a) => a.entityId === acct.id).map((a) => a.action));
    for (const a of ['client.share.create', 'client.share.view', 'client.share.revoke']) assert.ok(actions.includes(a), a);
  });
  it('keeps a revoke and a new link when views race them (Arisha main, 3 Nov 2026)', async () => {
    const today = nowMyt().slice(0, 10);
    const siteId = await db.asUser('u-cm-sasa', async (svc, u) => (await svc.clientBoard(u)).canAdd.find((c) => c.companyId === 'co-sasa')!.sites[0].id);
    const acct = await db.asUser('u-cm-sasa', (svc, u) => svc.addClientAccount(u, { companyId: 'co-sasa', name: 'PG Race Client', siteIds: [siteId], contractEndsOn: null }));
    const input = { recipient: 'Facilities manager', from: addDays(today, -30), to: today, days: 5 };
    const view = (id: string) => db.asShareLink('co-sasa', (svc) => svc.clientShareReport('co-sasa', acct.id, id));
    for (let round = 0; round < 3; round++) {
      const { link } = await db.asUser('u-cm-sasa', (svc, u) => svc.createClientShareLink(u, acct.id, input));
      await Promise.allSettled([view(link.id), view(link.id), db.asUser('u-cm-sasa', (svc, u) => svc.revokeClientShareLink(u, acct.id, link.id, 'Race test revoke')), view(link.id), view(link.id)]);
      const cur = await db.asUser('u-cm-sasa', async (_svc, _u, store) => (await store.get('clientAccounts', acct.id))!.shareLinks!.find((l) => l.id === link.id)!);
      assert.ok(cur.revokedAt, `round ${round}: revoke kept`);
      await assert.rejects(view(link.id), /not found/i);
    }
    // View versus create: the new link survives views of an older one.
    const { link: old } = await db.asUser('u-cm-sasa', (svc, u) => svc.createClientShareLink(u, acct.id, input));
    const made = await Promise.allSettled([view(old.id), db.asUser('u-cm-sasa', (svc, u) => svc.createClientShareLink(u, acct.id, input)), view(old.id)]);
    const fresh = (made[1] as PromiseFulfilledResult<{ link: { id: string } }>).value.link.id;
    const ids = await db.asUser('u-cm-sasa', async (_svc, _u, store) => (await store.get('clientAccounts', acct.id))!.shareLinks!.map((l) => l.id));
    assert.ok(ids.includes(fresh) && ids.includes(old.id));
  });
});

describe('insurance claim save versus notify on PostgreSQL (Arisha main, 3 Nov 2026)', () => {
  let db: Db;
  before(async () => {
    await resetDb(URL);
    db = new Db();
  });
  after(async () => {
    await db.onModuleDestroy();
  });

  it('never lets a record save overwrite a claim after the insurer was told', async () => {
    const today = nowMyt().slice(0, 10);
    const pol = await db.asUser('u-fauzan', async (_svc, _u, store) => (await store.list('insurancePolicies', { companyId: ['co-sasa'] })).find((p) => p.startsOn <= today && today <= p.expiresOn)!);
    for (let round = 0; round < 3; round++) {
      const ref = `CLM-RACE-${round}`;
      await db.asUser('u-bm-sasa-1', (svc, u) => svc.saveRecord(u, 'insuranceClaim', null, 'co-sasa', { policyId: pol.id, ref, what: 'PG race incident', incidentOn: today, amountClaimed: 1_000 }));
      const id = await db.asUser('u-bm-sasa-1', async (_svc, _u, store) => (await store.list('insuranceClaims', { companyId: ['co-sasa'] })).find((c) => c.ref === ref)!.id);
      const [save, notify] = await Promise.allSettled([
        db.asUser('u-bm-sasa-1', (svc, u) => svc.saveRecord(u, 'insuranceClaim', id, 'co-sasa', { policyId: pol.id, ref, what: 'Stale edit', incidentOn: today, amountClaimed: 5_000 })),
        db.asUser('u-bm-sasa-1', (svc, u) => svc.insuranceClaimAct(u, id, 'notify', { on: today, insurerRef: 'INS-RACE', how: 'Email' })),
      ]);
      assert.equal(notify.status, 'fulfilled');
      const audit = await db.asUser('u-fauzan', async (_svc, _u, store) => (await store.list('audit', {})).filter((a) => a.entityId === id));
      const editSeq = audit.find((a) => a.action === 'record.edit.insuranceClaim')?.seq;
      const notifySeq = audit.find((a) => a.action === 'insurance.claim.notify')!.seq;
      // A save that went through must have come before the insurer was told; otherwise it was refused.
      if (save.status === 'fulfilled') assert.ok(editSeq! < notifySeq);
      else assert.match(String((save as PromiseRejectedResult).reason), /only through its steps/);
    }
  });
});

