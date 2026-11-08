// Attach an Outlook email to a job: synthetic only, Microsoft Graph mocked, no network.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { User } from '@prima/core';
import type { DelegatedActor } from '../src/connections-mail/delegated';
import { JobEmail, KEEP_DAYS, messageIdFromLink, snapshotFrom, type JobEmailAccess } from '../src/connections-mail/job-email';
import { MemoryJobEmailStore } from '../src/connections-mail/job-email-store';
import { jobEmailModule } from '../src/connections-mail/controllers';

const tenant = '11111111-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oid = '99999999-8888-7777-6666-555555555555';
const now = '2026-10-31T06:00:00.000Z';
const MSG = 'AAMkAGI2TG93AAA-synthetic_message_id_0001=';
const link = (id = MSG) => `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(id)}`;
const env: NodeJS.ProcessEnv = {
JOB_EMAIL_ENABLED: 'true',
ENTRA_TENANT_ID: tenant,
ENTRA_API_CLIENT_ID: client,
JOB_EMAIL_OBO_CLIENT_SECRET: 'CLIENT_SECRET_PRIVATE',
JOB_EMAIL_PREVIEW_SECRET: 'a1'.repeat(32)
};
const actor = (id = 'u-it-exec', o = oid): DelegatedActor => ({ user: { id, name: `Synthetic ${id}`, role: 'staff', entraOid: o } as unknown as User, visibleCompanyIds: [], assertion: { userId: id, oid: o, tenantId: tenant, accessToken: `ASSERTION_${id}_PRIVATE` } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = (scope = 'Mail.Read') => json({ token_type: 'Bearer', access_token: 'GRAPH_TOKEN_PRIVATE', scope });
const message = (over: Record<string, unknown> = {}) => ({
  id: MSG, internetMessageId: '<synthetic-1@example.com>', subject: 'Synthetic: printer contract renewal',
  from: { emailAddress: { name: 'Synthetic Vendor', address: 'sales@example.com' } },
  toRecipients: [{ emailAddress: { name: 'IT', address: 'it@example.org' } }], ccRecipients: [],
  sentDateTime: '2026-10-30T02:00:00Z', receivedDateTime: '2026-10-30T02:00:05Z',
  body: { contentType: 'text', content: 'Dummy quotation text.\nLine two.' }, hasAttachments: true,
  webLink: 'https://outlook.office365.com/owa/?ItemID=AAMkAAAAAAAAAAAAAAAA&exvsurl=1&viewmodel=ReadMessageItem', ...over,
});
/** Allows u-it-exec and u-it-lead on job j-1; u-coo may only view; everyone else nothing. */
const access: JobEmailAccess = {
  async canAttach(a, job) { return job === 'j-1' && ['u-it-exec', 'u-it-lead'].includes(a.user.id); },
  async canView(a, job) { return job === 'j-1' && ['u-it-exec', 'u-it-lead', 'u-coo'].includes(a.user.id); },
};

function fixture(responses: (Response | Error)[] = [], e = env, store = new MemoryJobEmailStore(true)) {
  const calls: { url: string; options: RequestInit }[] = [];
  let clock = Date.parse(now);
  const http = (async (url: string | URL | Request, options: RequestInit = {}) => {
    calls.push({ url: String(url), options });
    const r = responses.shift();
    if (!r) throw new Error('Unexpected request; no network permitted in test.');
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { service: new JobEmail(store, access, () => e, http, () => new Date(clock)), calls, store, advance: (ms: number) => { clock += ms; } };
}

it('rejects provider web links outside supported message-display shapes', () => {
  for (const webLink of ['https://outlook.office.com/arbitrary', 'https://outlook.office.com/mail/id/AAMk#fragment', 'https://outlook.office.com/mail/id/AAMk?redirect=https://example.com']) {
    assert.equal(snapshotFrom(message({ webLink })), null);
  }
});

describe('Attach an Outlook email to a job (Graph mocked)', () => {
  it('is NotConfigured by default, without credentials, on a non-durable store, and with the default deny-all job access', async () => {
    for (const [e, store] of [[{}, new MemoryJobEmailStore(true)], [{ ...env, JOB_EMAIL_ENABLED: 'false' }, new MemoryJobEmailStore(true)],
      [{ ...env, JOB_EMAIL_OBO_CLIENT_SECRET: ' ' }, new MemoryJobEmailStore(true)], [env, new MemoryJobEmailStore(false)]] as [NodeJS.ProcessEnv, MemoryJobEmailStore][]) {
      const f = fixture([], e, store);
      const status=await f.service.status(actor());
      assert.deepEqual(status, { serviceId: 'mail', userId: 'u-it-exec', status: 'NotConfigured', keepDays: 30, providerVerified:false, setupReason:e.JOB_EMAIL_ENABLED!=='true'?'FeatureDisabled':!e.JOB_EMAIL_OBO_CLIENT_SECRET?.trim()?'ServerConfigurationRequired':'StorageNotReady' });
      await assert.rejects(f.service.preview(actor(), 'j-1', { outlookLink: link() }), ServiceUnavailableException);
      assert.equal(f.calls.length, 0);
    }
    const module = jobEmailModule();
    const email = (module.providers[0].useFactory as () => JobEmail)();
    assert.equal((await email.status(actor())).status, 'NotConfigured');
    const denied = new JobEmail(new MemoryJobEmailStore(true), undefined, () => env, (async () => { throw new Error('no network'); }) as typeof fetch);
    await assert.rejects(denied.preview(actor(), 'j-1', { outlookLink: link() }), ForbiddenException);
    await assert.rejects(denied.list(actor(), 'j-1'), NotFoundException);
  });

  it('reads exactly one message from the person\'s own mailbox, plain text, with an explicit field list', async () => {
    const f = fixture([token(), json(message())]);
    const p = await f.service.preview(actor(), 'j-1', { outlookLink: link() });
    assert.equal(p.snapshot.subject, 'Synthetic: printer contract renewal');
    assert.equal(p.snapshot.hasAttachments, true);
    assert.match(p.previewToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    assert.equal(p.expiresAt, '2026-10-31T06:10:00.000Z');
    const tokenBody = new URLSearchParams(String(f.calls[0].options.body));
    assert.equal(tokenBody.get('scope'), 'https://graph.microsoft.com/Mail.Read');
    assert.equal(tokenBody.get('requested_token_use'), 'on_behalf_of');
    const read = new URL(f.calls[1].url);
    assert.equal(read.origin + read.pathname, `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(MSG)}`);
    assert.equal(read.searchParams.get('$select'), 'id,internetMessageId,subject,from,toRecipients,ccRecipients,sentDateTime,receivedDateTime,body,hasAttachments,webLink');
    assert.equal([...read.searchParams.keys()].length, 1, 'No $expand, $filter, $search or $top');
    assert.equal((f.calls[1].options.headers as Record<string, string>).Prefer, 'outlook.body-content-type="text", IdType="ImmutableId"');
    assert.equal(f.calls[1].options.method, 'GET');
    assert.equal((await f.service.list(actor(), 'j-1')).emails.length, 0, 'A preview stores nothing');
    assert.ok(!JSON.stringify(p).includes('PRIVATE'));
  });

  it('accepts only a link to one Outlook on the web message, never a list, folder, search or another host', () => {
    assert.equal(messageIdFromLink(link()), MSG);
    assert.equal(messageIdFromLink(`https://outlook.office365.com/owa/?ItemID=${encodeURIComponent(MSG)}&exvsurl=1`), MSG);
    for (const bad of [undefined, '', 'not a url', `http://outlook.office.com/mail/inbox/id/${MSG}`, `https://outlook.evil.invalid/mail/inbox/id/${MSG}`,
      `https://outlook.office.com.evil.invalid/mail/id/${MSG}`, 'https://outlook.office.com/mail/inbox', 'https://outlook.office.com/mail/search?q=salary',
      `https://user:pw@outlook.office.com/mail/id/${MSG}`, `https://outlook.office.com:8443/mail/id/${MSG}`, 'https://outlook.office.com/mail/id/..%2F..%2Fusers', 'https://outlook.office.com/mail/id/short',
      `https://graph.microsoft.com/v1.0/me/messages/${MSG}`, 'x'.repeat(3000), `javascript:alert(1)//outlook.office.com/mail/id/${MSG}`,
      `https://outlook.live.com/mail/0/inbox/id/${MSG}`, `https://pwvsb.sharepoint.com/sites/x?ItemID=${MSG}`, `https://outlook.office.com/mail/id/${MSG}/attachments`,
      `https://outlook.office.com/mail/?ItemID=${encodeURIComponent('a/../../me/mailFolders')}`]) {
      assert.equal(messageIdFromLink(bad), null, String(bad).slice(0, 80));
    }
  });

  it('attach stores the reviewed copy once; a changed email or a forged hash stores nothing', async () => {
    const f = fixture([token(), json(message()), token(), json(message()), token(), json(message()), token(), json(message({ subject: 'Edited after preview' })), token(), json(message())]);
    const p = await f.service.preview(actor(), 'j-1', { outlookLink: link() });
    const v = await f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken });
    assert.equal(v.state, 'Available'); assert.equal(v.canRemove, true);
    assert.equal(v.expiresAt, new Date(Date.parse(now) + KEEP_DAYS * 86_400_000).toISOString());
    await assert.rejects(f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken }), /already attached/);
    await assert.rejects(f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken }), ConflictException, 'Changed since the preview');
    await assert.rejects(f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: 'f'.repeat(64) }), ConflictException);
    await assert.rejects(f.service.attach(actor(), 'j-1', { outlookLink: link() }), BadRequestException);
    await assert.rejects(f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken, jobId: 'j-2' }), BadRequestException);
    assert.equal((await f.service.list(actor(), 'j-1')).emails.length, 1);
  });

  it('job access comes only from the job rules: viewers see, only attachers attach, others get nothing', async () => {
    const f = fixture([token(), json(message()), token(), json(message())]);
    const p = await f.service.preview(actor(), 'j-1', { outlookLink: link() });
    await f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken });
    const coo = await f.service.list(actor('u-coo'), 'j-1');
    assert.equal(coo.emails[0].snapshot?.body, 'Dummy quotation text.\nLine two.');
    assert.equal(coo.emails[0].canRemove, false);
    await assert.rejects(f.service.preview(actor('u-coo'), 'j-1', { outlookLink: link() }), ForbiddenException);
    for (const [who, job] of [['u-stranger', 'j-1'], ['u-it-exec', 'j-2']]) {
      await assert.rejects(f.service.list(actor(who), job), NotFoundException);
      await assert.rejects(f.service.preview(actor(who), job, { outlookLink: link() }), ForbiddenException);
    }
    await assert.rejects(f.service.list(actor(), '../j-1'), NotFoundException);
    const integration = { ...actor('u-it-lead'), user: { ...actor('u-it-lead').user, integration: true } as unknown as User };
    await assert.rejects(f.service.list(integration, 'j-1'), NotFoundException);
    assert.equal(f.calls.length, 4);
  });

  it('needs the person\'s own linked Microsoft sign-in, and refuses broader or extra scopes', async () => {
    const f = fixture([]);
    for (const a of [{ ...actor(), assertion: null }, actor('u-it-exec', '00000000-0000-0000-0000-000000000000') && { ...actor(), user: { ...actor().user, entraOid: '00000000-0000-0000-0000-000000000000' } as unknown as User }]) {
      await assert.rejects(f.service.preview(a, 'j-1', { outlookLink: link() }), ForbiddenException);
    }
    for (const scope of ['Mail.ReadWrite', 'Mail.Read Mail.Send', 'Mail.Read.Shared', '.default']) {
      const g = fixture([token(scope)]);
      await assert.rejects(g.service.preview(actor(), 'j-1', { outlookLink: link() }), ServiceUnavailableException, scope);
      assert.equal(g.calls.length, 1, 'No mailbox read after a wrong scope');
    }
  });

  it('a missing, malformed, HTML or oversized answer stores nothing; provider details never leak', async () => {
    const cases: Response[] = [json({}, 404), json({ error: { message: 'PRIVATE provider detail' } }, 500), json(message({ body: { contentType: 'html', content: '<b>x</b>' } })),
      json(message({ webLink: 'https://evil.invalid/x' })), json(message({ internetMessageId: undefined })), json(message({ toRecipients: 'everyone' })),
      new Response('x'.repeat(2 * 1024 * 1024), { headers: { 'content-type': 'application/json' } }), new Response('<html>', { headers: { 'content-type': 'text/html' } })];
    for (const r of cases) {
      const f = fixture([token(), r]);
      const e = await f.service.preview(actor(), 'j-1', { outlookLink: link() }).then(() => null, (x: Error) => x);
      assert.ok(e instanceof BadRequestException || e instanceof ServiceUnavailableException);
      assert.ok(!String(e.message).includes('PRIVATE'));
    }
    const long = fixture([token(), json(message({ body: { contentType: 'text', content: 'y'.repeat(60_000) } }))]);
    const p = await long.service.preview(actor(), 'j-1', { outlookLink: link() });
    assert.equal(p.snapshot.body.length, 50_000); assert.equal(p.snapshot.bodyTruncated, true);
  });

  it('keeps the copy 30 days, then shows only the stub, even before the retention job runs', async () => {
    const f = fixture([token(), json(message()), token(), json(message())]);
    const p = await f.service.preview(actor(), 'j-1', { outlookLink: link() });
    await f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken });
    f.advance(KEEP_DAYS * 86_400_000 - 1);
    assert.equal((await f.service.list(actor(), 'j-1')).emails[0].state, 'Available');
    f.advance(1);
    const [stub] = (await f.service.list(actor(), 'j-1')).emails;
    assert.equal(stub.state, 'Expired'); assert.equal(stub.snapshot, null);
    assert.equal(stub.webLink, message().webLink, 'The Outlook link stays so the person can open the original');
    f.store.expire(new Date(Date.parse(now) + KEEP_DAYS * 86_400_000));
    assert.equal((await f.store.list('u-it-exec', 'j-1', 50))[0].snapshot, null, 'The retention job erases the stored copy');
  });

  it('only the person who attached it may remove it, once; the copy is erased and the stub kept; Outlook is never called', async () => {
    const f = fixture([token(), json(message()), token(), json(message())]);
    const p = await f.service.preview(actor(), 'j-1', { outlookLink: link() });
    const v = await f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken });
    await assert.rejects(f.service.remove(actor('u-it-lead'), 'j-1', v.id), ForbiddenException);
    await assert.rejects(f.service.remove(actor('u-coo'), 'j-1', v.id), ForbiddenException);
    await assert.rejects(f.service.remove(actor(), 'j-1', 'not-a-uuid'), NotFoundException);
    const r = await f.service.remove(actor(), 'j-1', v.id);
    assert.equal(r.state, 'Removed'); assert.equal(r.snapshot, null); assert.equal(r.canRemove, false);
    assert.equal((await f.service.remove(actor(), 'j-1', v.id)).state, 'Removed', 'Idempotent');
    assert.equal((await f.store.get('u-it-exec', 'j-1', v.id))!.snapshot, null);
    assert.deepEqual((await f.store.get('u-it-exec', 'j-1', v.id))!.events.map(e => e.action), ['attached', 'removed']);
    assert.equal(f.calls.length, 4, 'Removing never calls Microsoft');
    // After removal the same email may be attached again (a fresh, reviewed copy).
    const g = fixture([token(), json(message()), token(), json(message())], env, f.store);
    const again = await g.service.preview(actor(), 'j-1', { outlookLink: link() });
    assert.equal((await g.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: again.previewToken })).state, 'Available');
  });

  it('never sends, lists, searches or reads attachments, and Arisha has no route to it', () => {
    const src = readFileSync(join(__dirname, '../../src/connections-mail/job-email.ts'), 'utf8');
    for (const forbidden of ['sendMail', '/mailFolders', '$search', '$filter', '$expand', '/attachments', 'messages?', 'delta', 'subscriptions']) assert.ok(!src.includes(forbidden), forbidden);
    const dir = join(__dirname, '../../src');
    for (const f of readdirSync(dir).filter(n => /^arisha.*\.ts$/.test(n))) assert.ok(!/connections-mail|job-email/.test(readFileSync(join(dir, f), 'utf8')), f);
  });
  it('requires a server proof bound to identity, job, input link and canonical message with a ten-minute expiry', async () => {
    const f = fixture([token(), json(message())]);
    const p = await f.service.preview(actor(), 'j-1', { outlookLink: link() });
    for (const a of [actor('u-it-lead'), actor('u-it-exec', '00000000-0000-0000-0000-000000000001')])
      await assert.rejects(f.service.attach(a, 'j-1', { outlookLink: link(), previewToken: p.previewToken }), ConflictException);
    await assert.rejects(f.service.attach(actor(), 'j-1', { outlookLink: link(MSG + 'x'), previewToken: p.previewToken }), ConflictException);
    const parts = p.previewToken.split('.');
    const forged = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); forged.expiresAt += 1000;
    await assert.rejects(f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: Buffer.from(JSON.stringify(forged)).toString('base64url') + '.' + parts[1] }), ConflictException);
    assert.equal(f.calls.length, 2, 'Invalid proof is refused before any provider read');
    f.advance(10 * 60 * 1000);
    await assert.rejects(f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken }), ConflictException);
    assert.equal(f.calls.length, 2);
    const changedId = fixture([token(), json(message()), token(), json(message({ id: MSG + 'other' }))]);
    const c = await changedId.service.preview(actor(), 'j-1', { outlookLink: link() });
    await assert.rejects(changedId.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: c.previewToken }), ConflictException);
    assert.equal((await changedId.service.list(actor(), 'j-1')).emails.length, 0);
  });

  it('deduplicates immutable mailbox message identity, not the spoofable Internet Message-ID header', async () => {
    const f = fixture([token(), json(message()), token(), json(message()), token(), json(message({ id: MSG + 'different' })), token(), json(message({ id: MSG + 'different' }))]);
    const p = await f.service.preview(actor(), 'j-1', { outlookLink: link() });
    await f.service.attach(actor(), 'j-1', { outlookLink: link(), previewToken: p.previewToken });
    const q = await f.service.preview(actor(), 'j-1', { outlookLink: link(MSG + 'different') });
    await f.service.attach(actor(), 'j-1', { outlookLink: link(MSG + 'different'), previewToken: q.previewToken });
    assert.equal((await f.service.list(actor(), 'j-1')).emails.length, 2);
  });

  it('refuses unsupported link formats without translation, searching or network access', async () => {
    const f = fixture();
    for (const bad of [link() + '#fragment', link() + '?search=secret', link() + '?ItemID=' + MSG,
      `https://outlook.office.com/arbitrary/?ItemID=${MSG}`, `https://outlook.office.com/owa/?ItemID=${MSG}&ItemID=${MSG}`]) {
      await assert.rejects(f.service.preview(actor(), 'j-1', { outlookLink: bad }), BadRequestException);
    }
    assert.equal(messageIdFromLink(`https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(MSG)}`), MSG);
    assert.equal(messageIdFromLink(`https://outlook.office.com/mail/u/0/inbox/id/${encodeURIComponent(MSG)}`), MSG);
    assert.equal(f.calls.length, 0);
  });

});

it('status is local readiness only and never verifies a mailbox or exposes credentials',async()=>{
 const f=fixture();const ready=await f.service.status(actor());assert.equal(ready.setupReason,'ReadyForSelectedPreview');assert.equal(ready.providerVerified,false);
 const missing=await f.service.status({...actor(),assertion:null});assert.equal(missing.setupReason,'MicrosoftSignInRequired');assert.equal(missing.providerVerified,false);assert.equal(f.calls.length,0);assert.ok(!JSON.stringify(ready).includes('PRIVATE'));
});
