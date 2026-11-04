import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { User } from '@prima/core';
import type { DelegatedActor } from '../src/connections-mail/delegated';
import { MemoryEmailLedger, type EmailDraft, type StaffEmailLedger } from '../src/connections-mail/ledger';
import { retryAfterMs, StaffEmail, staffEmailConfiguration } from '../src/connections-mail/staff-email';

const tenant = '11111111-2222-3333-4444-555555555555';
const client = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const oid = '99999999-8888-7777-6666-555555555555';
const now = '2026-10-31T06:00:00.000Z';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = () => json({ token_type: 'Bearer', access_token: 'GRAPH_TOKEN_PRIVATE', scope: 'Mail.Send' });
const accepted = () => new Response(null, { status: 202 });
const config = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ STAFF_EMAIL_ENABLED: 'true', ENTRA_TENANT_ID: tenant, ENTRA_API_CLIENT_ID: client, STAFF_EMAIL_OBO_CLIENT_SECRET: 'CLIENT_SECRET_PRIVATE', STAFF_EMAIL_ALLOWED_USER_IDS: 'u-it-lead,u-fauzan', STAFF_EMAIL_RECIPIENT_DOMAINS: 'example.com,example.org', ...over });
const actor = (id = 'u-it-lead', o = oid): DelegatedActor => ({ user: { id, role: 'staff', entraOid: o } as unknown as User, visibleCompanyIds: ['co-example'], assertion: { userId: id, oid: o, tenantId: tenant, accessToken: `ASSERTION_${id}_PRIVATE` } });
const message = { to: ['client@example.com'], cc: ['ops@example.org'], subject: 'Synthetic site visit summary', body: 'Dummy body.\nLine two.' };

function fixture(responses: (Response | Error)[] = [], env = config(), ledger: StaffEmailLedger = new MemoryEmailLedger(true)) {
  const calls: { url: string; options: RequestInit }[] = [];
  let clock = Date.parse(now);
  const http = (async (url: string | URL | Request, options: RequestInit = {}) => {
    calls.push({ url: String(url), options });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected request; no network permitted in test.');
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  const service = new StaffEmail(ledger, () => env, http, () => new Date(clock));
  return { service, calls, responses, ledger, advance: (ms: number) => { clock += ms; },
    events: async (id: string) => (await ledger.get('u-it-lead', id))!.events.map(e => e.action) as string[] };
}

describe('Staff email: compose, review, explicit Send from own mailbox (Graph mocked)', () => {
  it('is NotConfigured by default, on bad config, and on a non-durable ledger, with no provider calls', async () => {
    for (const [env, ledger] of [
      [{}, new MemoryEmailLedger(true)], [config({ STAFF_EMAIL_ENABLED: 'false' }), new MemoryEmailLedger(true)],
      [config({ STAFF_EMAIL_OBO_CLIENT_SECRET: ' ' }), new MemoryEmailLedger(true)], [config({ STAFF_EMAIL_ALLOWED_USER_IDS: '' }), new MemoryEmailLedger(true)],
      [config({ STAFF_EMAIL_ALLOWED_USER_IDS: '*' }), new MemoryEmailLedger(true)], [config({ ENTRA_TENANT_ID: 'common' }), new MemoryEmailLedger(true)],
      [config({ STAFF_EMAIL_RECIPIENT_DOMAINS: undefined }), new MemoryEmailLedger(true)], [config({ STAFF_EMAIL_RECIPIENT_DOMAINS: '' }), new MemoryEmailLedger(true)],
      [config({ STAFF_EMAIL_RECIPIENT_DOMAINS: ' , ' }), new MemoryEmailLedger(true)], [config({ STAFF_EMAIL_RECIPIENT_DOMAINS: '*,example.com' }), new MemoryEmailLedger(true)],
      [config({ STAFF_EMAIL_RECIPIENT_DOMAINS: '*.example.com' }), new MemoryEmailLedger(true)], [config({ STAFF_EMAIL_RECIPIENT_DOMAINS: 'https://evil.invalid' }), new MemoryEmailLedger(true)],
      [config({ STAFF_EMAIL_RECIPIENT_DOMAINS: 'example.com,example.com' }), new MemoryEmailLedger(true)],
      [config(), new MemoryEmailLedger(false)],
    ] as [NodeJS.ProcessEnv, StaffEmailLedger][]) {
      const { service, calls } = fixture([], env, ledger);
      assert.deepEqual(await service.status(actor()), { serviceId: 'mail', userId: 'u-it-lead', status: 'NotConfigured', canCompose: false, resources: [], recipientDomains: [] });
      await assert.rejects(service.create(actor(), message), ServiceUnavailableException);
      await assert.rejects(service.check(actor(), 'own-mailbox'), ServiceUnavailableException);
      assert.equal(calls.length, 0);
    }
    assert.deepEqual(staffEmailConfiguration(config({ STAFF_EMAIL_RECIPIENT_DOMAINS: 'org.example, Example.com' }))?.recipientDomains, ['org.example', 'example.com']);
  });

  it('refuses users who are not allowlisted, integration identities and dev/unlinked sign-in', async () => {
    const { service, calls } = fixture();
    assert.deepEqual(await service.status(actor()), { serviceId: 'mail', userId: 'u-it-lead', status: 'ConfiguredNotVerified', canCompose: true, resources: [{ key: 'own-mailbox', name: 'Your own mailbox (send only)' }], recipientDomains: ['example.com', 'example.org'] });
    const outsider = actor('u-guard-fifth');
    assert.equal((await service.status(outsider)).canCompose, false);
    assert.deepEqual((await service.status(outsider)).resources, []);
    await assert.rejects(service.create(outsider, message), ForbiddenException);
    const feed = { ...actor(), user: { ...actor().user, integration: 'feed' } } as unknown as DelegatedActor;
    await assert.rejects(service.create(feed, message), ForbiddenException);
    const draft = await service.create(actor(), message);
    for (const who of [{ ...actor(), assertion: null }, { ...actor(), assertion: { ...actor().assertion!, oid: client } }, { ...actor(), assertion: { ...actor().assertion!, tenantId: client } }, { ...actor(), user: { ...actor().user, entraOid: undefined } }]) {
      await assert.rejects(service.send(who as DelegatedActor, draft.id, { reviewedHash: draft.contentHash }), /Sign in with your linked Microsoft account/);
    }
    assert.equal(calls.length, 0);
    assert.equal((await service.get(actor(), draft.id)).state, 'Draft');
  });

  it('unset recipient domains gives NotConfigured', async () => {
    const env = config(); delete env.STAFF_EMAIL_RECIPIENT_DOMAINS;
    assert.equal(staffEmailConfiguration(env), null);
    assert.equal((await fixture([], env).service.status(actor())).status, 'NotConfigured');
  });

  it('allows any domain only with the explicit value "*" on its own', async () => {
    assert.deepEqual(staffEmailConfiguration(config({ STAFF_EMAIL_RECIPIENT_DOMAINS: ' * ' }))?.recipientDomains, ['*']);
    const { service } = fixture([], config({ STAFF_EMAIL_RECIPIENT_DOMAINS: '*' }));
    assert.equal((await service.create(actor(), { ...message, to: ['anyone@outside.invalid'], cc: [] })).state, 'Draft');
    await assert.rejects(service.create(actor(), { ...message, to: ['not-an-email'] }), BadRequestException);
  });

  it('denies recipients outside the approved domains by default, including look-alike and subdomains', async () => {
    const { service, calls } = fixture([], config({ STAFF_EMAIL_RECIPIENT_DOMAINS: 'org.example' }));
    for (const to of [['someone@example.com'], ['ceo@org.example.evil.invalid'], ['x@mail.org.example'], ['x@org.invalid'], ['x@evilorg.example']]) {
      await assert.rejects(service.create(actor(), { ...message, to, cc: [] }), /approved domains/);
    }
    await assert.rejects(service.create(actor(), { ...message, to: ['ok@org.example'], cc: ['leak@example.com'] }), /approved domains/);
    const ok = await service.create(actor(), { ...message, to: ['OK@ORG.example'], cc: [] });
    assert.equal(ok.state, 'Draft');
    // Editing cannot route around the allowlist either.
    await assert.rejects(service.edit(actor(), ok.id, { ...message, to: ['someone@example.com'], cc: [] }), /approved domains/);
    assert.equal(calls.length, 0);
  });

  it('validates content strictly: no attachments, bcc, HTML, header injection or oversize input', async () => {
    const { service } = fixture([], config({ STAFF_EMAIL_RECIPIENT_DOMAINS: 'example.com,example.org' }));
    for (const bad of [
      null, [], 'text', { ...message, attachments: [] }, { ...message, bcc: ['x@example.com'] }, { ...message, contentType: 'HTML' },
      { ...message, to: [] }, { ...message, to: ['not-an-email'] }, { ...message, to: ['a@example.com\r\nBcc: b@example.com'] },
      { ...message, to: ['someone@outside.invalid'] }, { ...message, cc: ['client@example.com'] }, { ...message, to: Array.from({ length: 11 }, (_, i) => `a${i}@example.com`) },
      { ...message, subject: 'Hi\r\nBcc: x@example.com' }, { ...message, subject: '' }, { ...message, subject: 'x'.repeat(201) },
      { ...message, body: '' }, { ...message, body: 'x'.repeat(20_001) }, { ...message, body: 'bad\u0000byte' },
    ]) await assert.rejects(service.create(actor(), bad), BadRequestException);
  });

  it('is Accepted (not delivered) once from /me/sendMail with only Mail.Send, the reviewed content and a traceable header', async () => {
    const { service, calls, ledger } = fixture([token(), accepted()]);
    const draft = await service.create(actor(), message);
    const { draft: sent, alreadyHandled } = await service.send(actor(), draft.id, { reviewedHash: draft.contentHash });
    assert.equal(alreadyHandled, false);
    assert.equal(sent.state, 'Accepted');
    assert.deepEqual((await ledger.get('u-it-lead', draft.id))!.events.map(e => e.action), ['created', 'send-pressed', 'accepted']);
    assert.equal('events' in sent || 'ownerOid' in sent || 'ownerTenantId' in sent, false, 'The screen never gets the identity binding or event trail');
    assert.equal(calls.length, 2);
    const form = calls[0].options.body as URLSearchParams;
    assert.equal(calls[0].url, `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`);
    assert.equal(form.get('scope'), 'https://graph.microsoft.com/Mail.Send');
    assert.equal(form.get('requested_token_use'), 'on_behalf_of');
    assert.equal(form.get('assertion'), 'ASSERTION_u-it-lead_PRIVATE');
    assert.equal(calls[1].url, 'https://graph.microsoft.com/v1.0/me/sendMail', 'Own mailbox only, never /users/{other}');
    assert.equal(calls[1].options.method, 'POST');
    const payload = JSON.parse(calls[1].options.body as string);
    assert.deepEqual(payload, {
      message: {
        subject: message.subject, body: { contentType: 'Text', content: message.body },
        toRecipients: [{ emailAddress: { address: 'client@example.com' } }], ccRecipients: [{ emailAddress: { address: 'ops@example.org' } }],
        internetMessageHeaders: [{ name: 'X-Prima-Draft-Id', value: draft.id }],
      },
      saveToSentItems: true,
    });
    for (const call of calls) { assert.equal(call.options.redirect, 'error'); assert.ok(call.options.signal instanceof AbortSignal); }
    assert.ok(calls.every(c => !/\/messages|\/mailFolders|\/inbox/i.test(c.url)), 'No mailbox reading');
    assert.doesNotMatch(JSON.stringify(sent), /PRIVATE|token|secret/i);
  });

  it('never sends twice: repeat press, double click and edits after Send are refused without provider calls', async () => {
    const { service, calls } = fixture([token(), accepted()]);
    const draft = await service.create(actor(), message);
    const press = { reviewedHash: draft.contentHash };
    await service.send(actor(), draft.id, press);
    const again = await service.send(actor(), draft.id, press);
    assert.equal(again.alreadyHandled, true);
    assert.equal(again.draft.state, 'Accepted');
    await assert.rejects(service.edit(actor(), draft.id, message), ConflictException);
    await assert.rejects(service.discard(actor(), draft.id), ConflictException);
    assert.equal(calls.length, 2);

    // Two concurrent presses on a fresh draft: exactly one reaches Microsoft.
    const c = fixture([token(), accepted()]);
    const d = await c.service.create(actor(), message);
    const results = await Promise.all([c.service.send(actor(), d.id, { reviewedHash: d.contentHash }), c.service.send(actor(), d.id, { reviewedHash: d.contentHash })]);
    assert.equal(results.filter(r => r.alreadyHandled).length, 1);
    assert.equal(c.calls.filter(x => x.url.endsWith('/sendMail')).length, 1);
  });

  it('Send must quote the reviewed hash, so changed content needs a fresh review', async () => {
    const { service, calls } = fixture([token(), accepted()]);
    const draft = await service.create(actor(), message);
    const edited = await service.edit(actor(), draft.id, { ...message, subject: 'Changed subject' });
    await assert.rejects(service.send(actor(), draft.id, { reviewedHash: draft.contentHash }), /changed after you reviewed/);
    for (const body of [undefined, {}, { reviewedHash: 'abc' }, { reviewedHash: edited.contentHash, to: ['x@example.com'] }]) {
      await assert.rejects(service.send(actor(), draft.id, body), BadRequestException);
    }
    assert.equal(calls.length, 0);
    assert.equal((await service.send(actor(), draft.id, { reviewedHash: edited.contentHash })).draft.state, 'Accepted');
  });

  it('a definite refusal is Failed (may press Send again); timeout or 5xx is Uncertain and never retried', async () => {
    const refused = fixture([token(), json({ error: { message: 'PRIVATE_PROVIDER_BODY' } }, 403)]);
    const d1 = await refused.service.create(actor(), message);
    const r1 = await refused.service.send(actor(), d1.id, { reviewedHash: d1.contentHash });
    assert.equal(r1.draft.state, 'Failed');
    assert.doesNotMatch(JSON.stringify(r1), /PRIVATE/);

    const noToken = fixture([json({ error: 'PRIVATE' }, 400)]);
    const d2 = await noToken.service.create(actor(), message);
    assert.equal((await noToken.service.send(actor(), d2.id, { reviewedHash: d2.contentHash })).draft.state, 'Failed');
    assert.equal(noToken.calls.length, 1, 'No send request when the token exchange fails');

    for (const outcome of [new Error('socket hang up PRIVATE'), json({}, 503), json({}, 504), new Response(null, { status: 200 })]) {
      const f = fixture([token(), outcome]);
      const d = await f.service.create(actor(), message);
      const r = await f.service.send(actor(), d.id, { reviewedHash: d.contentHash });
      assert.equal(r.draft.state, 'Uncertain');
      const again = await f.service.send(actor(), d.id, { reviewedHash: d.contentHash });
      assert.equal(again.alreadyHandled, true);
      assert.equal(f.calls.length, 2, 'Uncertain is never retried');
      await assert.rejects(f.service.edit(actor(), d.id, message), ConflictException);
    }
  });

  it('an uncertain send stays locked when not found in Sent Items; only found settles it, and resending needs a new draft', async () => {
    const f = fixture([token(), new Error('timeout'), token(), accepted()]);
    const d = await f.service.create(actor(), message);
    await f.service.send(actor(), d.id, { reviewedHash: d.contentHash });
    await assert.rejects(f.service.resolveUncertain(actor(), d.id, { sentItems: 'maybe' }), BadRequestException);
    await assert.rejects(f.service.resolveUncertain(actor('u-fauzan'), d.id, { sentItems: 'not-found' }), ForbiddenException);
    // Not in Sent Items is not proof: the original request may still complete, so the lock holds.
    const still = await f.service.resolveUncertain(actor(), d.id, { sentItems: 'not-found' });
    assert.equal(still.state, 'Uncertain');
    assert.equal((await f.service.send(actor(), d.id, { reviewedHash: d.contentHash })).alreadyHandled, true);
    await assert.rejects(f.service.edit(actor(), d.id, message), ConflictException);
    assert.equal((await f.service.resolveUncertain(actor(), d.id, { sentItems: 'not-found' })).state, 'Uncertain', 'Repeated reports never unlock');
    assert.equal(f.calls.length, 2, 'Reporting never sends');
    assert.deepEqual((await f.events(d.id)).slice(-2), ['reported-not-in-sent-items', 'reported-not-in-sent-items']);
    // Sending again is a deliberate new draft with its own review; the locked one is untouched.
    const fresh = await f.service.create(actor(), message);
    assert.notEqual(fresh.id, d.id);
    assert.equal((await f.service.send(actor(), fresh.id, { reviewedHash: fresh.contentHash })).draft.state, 'Accepted');
    assert.equal((await f.service.get(actor(), d.id)).state, 'Uncertain');
    // Finding it later still settles it as Accepted.
    assert.equal((await f.service.resolveUncertain(actor(), d.id, { sentItems: 'found' })).state, 'Accepted');

    const g = fixture([token(), new Error('timeout')]);
    const e = await g.service.create(actor(), message);
    await g.service.send(actor(), e.id, { reviewedHash: e.contentHash });
    assert.equal((await g.service.resolveUncertain(actor(), e.id, { sentItems: 'found' })).state, 'Accepted');
  });

  it('a send whose outcome could not be recorded stays blocked, then can be reported after five minutes but stays locked unless found', async () => {
    class LosesOutcome extends MemoryEmailLedger {
      lose = false;
      override async transition(owner: string, id: string, v: number, next: EmailDraft) {
        if (this.lose && next.events.at(-1)?.action === 'accepted') return null;
        return super.transition(owner, id, v, next);
      }
    }
    const ledger = new LosesOutcome(true);
    const f = fixture([token(), accepted()], config(), ledger);
    const d = await f.service.create(actor(), message);
    ledger.lose = true;
    await f.service.send(actor(), d.id, { reviewedHash: d.contentHash });
    assert.equal((await f.service.get(actor(), d.id)).state, 'Sending');
    assert.equal((await f.service.send(actor(), d.id, { reviewedHash: d.contentHash })).alreadyHandled, true);
    await assert.rejects(f.service.resolveUncertain(actor(), d.id, { sentItems: 'found' }), ConflictException);
    await assert.rejects(f.service.resolveUncertain(actor(), d.id, { sentItems: 'not-found' }), ConflictException);
    f.advance(5 * 60_000 + 1);
    // A stale Sending reported as not found becomes Uncertain (still locked), never Failed.
    assert.equal((await f.service.resolveUncertain(actor(), d.id, { sentItems: 'not-found' })).state, 'Uncertain');
    assert.equal((await f.service.send(actor(), d.id, { reviewedHash: d.contentHash })).alreadyHandled, true);
    assert.equal((await f.service.resolveUncertain(actor(), d.id, { sentItems: 'found' })).state, 'Accepted');
    assert.equal(f.calls.length, 2);
  });

  it('checks ledger readiness on every call: a failing or throwing check keeps Mail NotConfigured and blocks Send', async () => {
    class Gate extends MemoryEmailLedger {
      state: 'ready' | 'not' | 'throws' = 'ready';
      override async readiness() {
        if (this.state === 'throws') throw new Error('catalog unreachable');
        return this.state === 'ready' ? { ready: true as const } : { ready: false as const, reason: 'Ledger version marker missing.' };
      }
    }
    const ledger = new Gate();
    const f = fixture([token(), accepted()], config(), ledger);
    assert.equal((await f.service.status(actor())).status, 'ConfiguredNotVerified');
    const d = await f.service.create(actor(), message);
    for (const state of ['not', 'throws'] as const) {
      ledger.state = state;
      assert.equal((await f.service.status(actor())).status, 'NotConfigured');
      await assert.rejects(f.service.send(actor(), d.id, { reviewedHash: d.contentHash }), ServiceUnavailableException);
      await assert.rejects(f.service.create(actor(), message), ServiceUnavailableException);
    }
    assert.equal(f.calls.length, 0, 'No provider call while the ledger is not ready');
    ledger.state = 'ready';
    assert.equal((await f.service.send(actor(), d.id, { reviewedHash: d.contentHash })).draft.state, 'Accepted');
  });

  it('drafts are private to their author and unknown IDs reveal nothing', async () => {
    const { service } = fixture();
    const draft = await service.create(actor(), message);
    for (const call of [() => service.get(actor('u-fauzan'), draft.id), () => service.edit(actor('u-fauzan'), draft.id, message),
      () => service.send(actor('u-fauzan'), draft.id, { reviewedHash: draft.contentHash }), () => service.get(actor(), '../etc'), () => service.get(actor(), crypto.randomUUID())]) {
      await assert.rejects(call(), /not available/);
    }
  });

  it('binds each draft and its review hash to the tenant, Microsoft account and sender', async () => {
    const other = '77777777-6666-5555-4444-333333333333';
    const relinked = (): DelegatedActor => ({ ...actor(), user: { ...actor().user, entraOid: other }, assertion: { ...actor().assertion!, oid: other } });
    const { service, calls } = fixture([token(), accepted()]);
    const draft = await service.create(actor(), message);
    assert.equal(draft.identityMatches, true);
    assert.notEqual((await service.create(actor('u-fauzan'), message)).contentHash, draft.contentHash, 'Same content, different sender, different hash');
    const seen = await service.get(relinked(), draft.id);
    assert.equal(seen.identityMatches, false);
    await assert.rejects(service.send(relinked(), draft.id, { reviewedHash: draft.contentHash }), /different Microsoft account/);
    await assert.rejects(service.resolveUncertain(relinked(), draft.id, { sentItems: 'found' }), ConflictException);
    const rebound = await service.edit(relinked(), draft.id, message);
    assert.equal(rebound.identityMatches, true);
    assert.notEqual(rebound.contentHash, draft.contentHash, 'Saving under the new account needs a fresh review');
    await assert.rejects(service.send(relinked(), draft.id, { reviewedHash: draft.contentHash }), /changed after you reviewed/);
    assert.equal(calls.length, 0);
    assert.equal((await service.send(relinked(), draft.id, { reviewedHash: rebound.contentHash })).draft.state, 'Accepted');
  });

  it('rechecks the recipient-domain policy at Send', async () => {
    const env = config();
    const { service, calls } = fixture([], env);
    const draft = await service.create(actor(), message); // cc ops@example.org
    env.STAFF_EMAIL_RECIPIENT_DOMAINS = 'example.com';
    await assert.rejects(service.send(actor(), draft.id, { reviewedHash: draft.contentHash }), /approved domains/);
    assert.equal(calls.length, 0);
    assert.equal((await service.get(actor(), draft.id)).state, 'Draft');
  });

  it('honours 429 Retry-After: Failed, and Send is refused until the wait has passed', async () => {
    const throttled = () => new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    const f = fixture([token(), throttled(), token(), accepted()]);
    const d = await f.service.create(actor(), message);
    const r = await f.service.send(actor(), d.id, { reviewedHash: d.contentHash });
    assert.equal(r.draft.state, 'Failed');
    assert.equal(r.draft.retryNotBefore, new Date(Date.parse(now) + 120_000).toISOString());
    await assert.rejects(f.service.send(actor(), d.id, { reviewedHash: d.contentHash }), /wait/);
    assert.equal(f.calls.length, 2);
    f.advance(120_001);
    const later = await f.service.send(actor(), d.id, { reviewedHash: d.contentHash });
    assert.equal(later.draft.state, 'Accepted');
    assert.equal(later.draft.retryNotBefore, null);
    const at = new Date(now);
    assert.equal(retryAfterMs('30', at), 30_000);
    assert.equal(retryAfterMs(new Date(at.getTime() + 90_000).toUTCString(), at), 90_000);
    assert.equal(retryAfterMs(null, at), 60_000);
    assert.equal(retryAfterMs('garbage', at), 60_000);
    assert.equal(retryAfterMs('7200', at), 7_200_000, 'Two hours honoured, not capped');
    assert.equal(retryAfterMs('999999', at), 999_999_000, 'Long valid waits honoured in full');
    assert.equal(retryAfterMs(new Date(at.getTime() + 3 * 86_400_000).toUTCString(), at), 3 * 86_400_000, 'HTTP date days ahead honoured');
    assert.equal(retryAfterMs('-5', at), 60_000);
    assert.equal(retryAfterMs('12345678901', at), 60_000, 'Absurd length is not a valid value');
  });

  it('lists the signed-in user\'s own recent drafts for recovery, newest first, without discarded ones', async () => {
    const f = fixture([token(), new Error('lost response')]);
    const a = await f.service.create(actor(), message);
    f.advance(1000);
    const b = await f.service.create(actor(), { ...message, subject: 'Second' });
    f.advance(1000);
    await f.service.send(actor(), a.id, { reviewedHash: a.contentHash }); // Uncertain: must be findable after a reload
    await f.service.discard(actor(), b.id);
    await f.service.create(actor('u-fauzan'), message);
    const mine = await f.service.list(actor());
    assert.equal(mine.userId, 'u-it-lead');
    assert.deepEqual(mine.drafts.map(d => [d.id, d.state]), [[a.id, 'Uncertain']]);
    await assert.rejects(f.service.list({ ...actor(), assertion: null }), /Sign in/);
  });

  it('rejects a broader or extra delegated scope (no Mail.Read, no Mail.Send.Shared)', async () => {
    for (const scope of [undefined, '', 'Mail.Read', 'Mail.Send Mail.Read', 'Mail.Send.Shared', 'Mail.ReadWrite', '.default']) {
      const { service, calls } = fixture([json({ token_type: 'Bearer', access_token: 'PRIVATE', scope })]);
      await assert.rejects(service.check(actor(), 'own-mailbox'), ServiceUnavailableException);
      assert.equal(calls.length, 1);
    }
    const ok = fixture([json({ token_type: 'Bearer', access_token: 'SAFE', scope: 'https://graph.microsoft.com/Mail.Send' })]);
    assert.equal((await ok.service.check(actor(), 'own-mailbox')).status, 'VerifiedForCurrentUser');
  });

  it('Arisha has no route to email or Power BI: no Arisha module references them', () => {
    const dir = join(__dirname, '..', 'src');
    const arisha = readdirSync(dir).filter(f => f.startsWith('arisha') && f.endsWith('.js'));
    assert.ok(arisha.length > 0);
    for (const file of arisha) assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /staff-email|sendMail|power-bi|powerbi|connections-mail|connections-powerbi/i, file);
  });
});
