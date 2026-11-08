// Drafting help service and the Azure call shape. A stand-in answers for Azure: no Microsoft service is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from '@prima/core';
import { AzureDraftHelpModel, DraftHelpService, draftHelpConfig, draftHelpHttpStatus, type DraftHelpAuditEvent, type DraftHelpModel } from '../src/draft-help';

const TODAY = '2026-11-05';
const u = (over: Partial<User>): User => ({ id: 'u-syn', name: 'Synthetic', title: 'T', role: 'pwvsb_officer', companyIds: ['pwvsb'], siteIds: [], ...over }) as User;
const assetTeam = u({ id: 'u-am', department: 'asset' });
const hr = u({ id: 'u-hr', department: 'hr' });
const finance = u({ id: 'u-fin', department: 'finance', financeRole: 'data_entry', financeTeam: 1 });
const bqForm = { title: 'Ubahsuai bilik', jobKind: 'RENOVATION', details: { Scope: 'Naikkan siling ke 3.5m' }, measurements: { 'Panjang (m)': 7.2, 'Lebar (m)': 6 } };
const bqOut = { sections: [{ title: 'Kerja roboh', lines: [{ item: 'Buka siling sedia ada', qty: 43.2, unit: 'm2', working: '7.2 x 6.0', basis: 'measured', optional: false }] }], notes: ['Kuantiti anggaran.'] };
const consent = 'draft-help-v1';

function setup(answer: (calls: number) => unknown = () => bqOut, opts: Partial<{ perHour: number; timeoutMs: number }> = {}) {
  const events: DraftHelpAuditEvent[] = [];
  let calls = 0;
  const sent: unknown[] = [];
  const model: DraftHelpModel = { suggest: async (input) => { calls++; sent.push(input); return answer(calls); } };
  const s = new DraftHelpService(model, { append: async (e) => { events.push(e); } }, { timeoutMs: opts.timeoutMs ?? 2000, perHour: opts.perHour ?? 20, now: Date.now });
  return { s, events, sent, calls: () => calls };
}

test('off by default: no switch, no Azure settings, or a non-Azure endpoint all mean off', () => {
  assert.equal(draftHelpConfig({}), null);
  assert.equal(draftHelpConfig({ AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com', AZURE_OPENAI_DEPLOYMENT: 'd', AZURE_OPENAI_API_VERSION: 'v' }), null);
  assert.equal(draftHelpConfig({ DRAFT_HELP_ENABLED: 'true', AZURE_OPENAI_ENDPOINT: 'https://evil.example.com', AZURE_OPENAI_DEPLOYMENT: 'd', AZURE_OPENAI_API_VERSION: 'v' }), null);
  // Arisha's switch does not turn drafting help on.
  assert.equal(draftHelpConfig({ ARISHA_ENABLED: 'true', AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com', AZURE_OPENAI_DEPLOYMENT: 'd', AZURE_OPENAI_API_VERSION: 'v' }), null);
  assert.deepEqual(draftHelpConfig({ DRAFT_HELP_ENABLED: 'true', AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com/', AZURE_OPENAI_DEPLOYMENT: 'a', DRAFT_HELP_DEPLOYMENT: 'drafts', AZURE_OPENAI_API_VERSION: '2024-10-21' }),
    { endpoint: 'https://x.openai.azure.com', deployment: 'drafts', apiVersion: '2024-10-21' });
});

test('when off, status says so and a direct call is refused without reaching any model', async () => {
  const s = new DraftHelpService(null, { append: async () => { throw new Error('must not audit'); } });
  assert.deepEqual(s.status(assetTeam, TODAY), { on: false, kinds: [], consentVersion: consent });
  await assert.rejects(s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY), { message: 'OFF' });
});

test('refuses people who do not write that record, before anything is sent (negative authorization)', async () => {
  const { s, calls, events } = setup();
  for (const [who, kind] of [[hr, 'bq'], [assetTeam, 'bill'], [finance, 'job-post'], [u({ opsTier: 'ceo' }), 'bq'], [u({ role: 'guard' }), 'job-post'], [u({ department: 'asset', integration: 'ja' }), 'bq']] as const) {
    await assert.rejects(s.suggest(who, kind, { consent, form: bqForm }, TODAY), { message: 'FORBIDDEN' });
  }
  await assert.rejects(s.suggest(u({ department: 'asset', accessClosedFrom: TODAY }), 'bq', { consent, form: bqForm }, TODAY), { message: 'FORBIDDEN' });
  await assert.rejects(s.suggest(assetTeam, 'contract', { consent, form: bqForm }, TODAY), { message: 'INVALID_INPUT' });
  assert.equal(calls(), 0);
  assert.equal(events.length, 0);
});

test('needs the consent line and a valid form', async () => {
  const { s, calls } = setup();
  await assert.rejects(s.suggest(assetTeam, 'bq', { form: bqForm }, TODAY), { message: 'CONSENT_REQUIRED' });
  await assert.rejects(s.suggest(assetTeam, 'bq', { consent, form: { title: 'x' } }, TODAY), { message: 'INVALID_INPUT' });
  assert.equal(calls(), 0);
});

test('a BQ suggestion comes back unverified with no rates, and the audit holds only a hash', async () => {
  const { s, events, sent } = setup();
  const r = await s.suggest(assetTeam, 'bq', { consent, form: { ...bqForm, details: { Contact: 'Ali 012-345 6789' } } }, TODAY);
  assert.equal(r.origin, 'suggestion');
  assert.equal(r.unverified, true);
  assert.equal(r.savedRecords, 0);
  assert.ok(r.warnings.includes('NO_RATES_FROM_HELPER'));
  assert.ok(!JSON.stringify(sent).includes('345 6789'), 'mobile number removed before sending');
  assert.deepEqual(events.map((e) => `${e.phase}:${e.outcome}`), ['started:started', 'terminal:success']);
  assert.ok(events.every((e) => /^[0-9a-f]{64}$/.test(e.inputSha256)));
  assert.ok(!JSON.stringify(events).includes('siling'), 'no form text in the audit');
});

test('a suggestion with a price, an invented bill figure or a pay outside the range is refused, and audited as such', async () => {
  const priced = setup(() => ({ ...bqOut, sections: [{ title: 'X', lines: [{ ...bqOut.sections[0].lines[0], item: 'Siling RM45 semeter' }] }] }));
  await assert.rejects(priced.s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY), { message: 'INVALID_OUTPUT' });
  assert.equal(priced.events.at(-1)?.outcome, 'invalid_output');

  const bill = 'SYARIKAT AIR CONTOH BHD\nJumlah RM88.00';
  const none = { raw: null };
  const invented = setup(() => ({ fields: { billerName: none, accountNo: none, billNo: none, billDate: none, dueDate: none, periodFrom: none, periodTo: none, amountDue: { raw: 'RM99.00' } } }));
  await assert.rejects(invented.s.suggest(finance, 'bill', { consent, form: { text: bill } }, TODAY), { message: 'INVALID_OUTPUT' });

  const post = setup(() => ({ bm: 'Pengawal Keselamatan, gaji RM3,000', en: 'Security Guard' }));
  await assert.rejects(post.s.suggest(hr, 'job-post', { consent, form: { title: 'Pengawal Keselamatan', employer: 'Syarikat Contoh', payFrom: 1700, payTo: 1900 } }, TODAY), { message: 'INVALID_OUTPUT' });
});

test('one ask at a time per person, a per-hour limit, and a timeout that is audited', async () => {
  let release: () => void = () => {};
  const slow = setup(() => new Promise((res) => { release = () => res(bqOut); }));
  const first = slow.s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(slow.s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY), { message: 'BUSY' });
  release();
  await first;

  const limited = setup(() => bqOut, { perHour: 2 });
  await limited.s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY);
  await limited.s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY);
  await assert.rejects(limited.s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY), { message: 'LIMIT' });

  const hung = setup(() => new Promise(() => {}), { timeoutMs: 30 });
  await assert.rejects(hung.s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY), { message: 'UNAVAILABLE' });
  assert.equal(hung.events.at(-1)?.outcome, 'timeout');
});

test('no suggestion is returned when the audit cannot be written', async () => {
  let calls = 0;
  const s = new DraftHelpService({ suggest: async () => { calls++; return bqOut; } }, { append: async () => { throw new Error('db down'); } });
  await assert.rejects(s.suggest(assetTeam, 'bq', { consent, form: bqForm }, TODAY), { message: 'UNAVAILABLE' });
  assert.equal(calls, 0);
});

test('the Azure call: managed-identity token, strict JSON schema, no tools, only the form fields', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(bqOut) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const m = new AzureDraftHelpModel({ endpoint: 'https://synthetic.openai.azure.com', deployment: 'drafts', apiVersion: '2024-10-21' }, async () => 'tok', http);
  const out = await m.suggest({ kind: 'bq', input: { title: 'T', jobKind: 'OTHER', details: {}, measurements: { a: 1 }, notes: '' } }, new AbortController().signal);
  assert.deepEqual(out, bqOut);
  assert.equal(seen[0].url, 'https://synthetic.openai.azure.com/openai/deployments/drafts/chat/completions?api-version=2024-10-21');
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
  assert.equal(seen[0].init.redirect, 'error');
  const body = JSON.parse(String(seen[0].init.body));
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.tools, undefined);
  assert.equal(body.messages.length, 2);
  assert.deepEqual(JSON.parse(body.messages[1].content), { title: 'T', jobKind: 'OTHER', details: {}, measurements: { a: 1 }, notes: '' });
  assert.match(body.messages[0].content, /NEVER give any rate, price/);

  const refusing = new AzureDraftHelpModel({ endpoint: 'https://synthetic.openai.azure.com', deployment: 'd', apiVersion: 'v' }, async () => 'tok',
    (async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{' } }] }), { status: 200 })) as unknown as typeof fetch);
  await assert.rejects(refusing.suggest({ kind: 'bill', input: { text: 'x' } }, new AbortController().signal), { message: 'INVALID_OUTPUT' });
  const busy = new AzureDraftHelpModel({ endpoint: 'https://synthetic.openai.azure.com', deployment: 'd', apiVersion: 'v' }, async () => 'tok',
    (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch);
  await assert.rejects(busy.suggest({ kind: 'bill', input: { text: 'x' } }, new AbortController().signal), { message: 'BUSY' });
});

test('HTTP statuses', () => {
  assert.equal(draftHelpHttpStatus('FORBIDDEN'), 403);
  assert.equal(draftHelpHttpStatus('OFF'), 503);
  assert.equal(draftHelpHttpStatus('LIMIT'), 429);
  assert.equal(draftHelpHttpStatus('INVALID_OUTPUT'), 502);
  assert.equal(draftHelpHttpStatus('CONSENT_REQUIRED'), 400);
});
