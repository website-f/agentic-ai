// Key-in helper service and the Azure call shape. A stand-in answers for Azure: no Microsoft service is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { KeyInField, KeyInOnlineInput, User } from '@prima/core';
import { AzureKeyInModel, KeyInService, keyInOnlineConfig, type KeyInAuditEvent, type KeyInModel } from '../src/key-in';

const TODAY = '2026-11-23';
const consent = 'key-in-v1';
const u = (over: Partial<User>): User => ({ id: 'u-syn', name: 'Synthetic', title: 'T', role: 'pwvsb_officer', companyIds: ['pwvsb'], siteIds: [], ...over }) as User;
const fin = u({ id: 'u-fin', department: 'finance' });
const hr = u({ id: 'u-hr', department: 'hr' });
const price = { usdPerMTokIn: 1, usdPerMTokOut: 4 };
// The rules find the date; the total is written in a sentence the rules do not read.
const PAPER = 'SYARIKAT CONTOH SDN BHD\nTarikh: 18/11/2026\nHarga keseluruhan kerja ialah RM 4,500.00 termasuk upah.\nIC wakil 900101-14-5678';
const ON = { DRAFT_HELP_ENABLED: 'true', AI_AGENT_KINDS: 'key-in', AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com', AZURE_OPENAI_DEPLOYMENT: 'd', AZURE_OPENAI_API_VERSION: '2024-10-21', AI_PRICE_USD_PER_MTOK_IN: '0.15', AI_PRICE_USD_PER_MTOK_OUT: '0.6' };

function setup(answer: (input: KeyInOnlineInput) => unknown = () => ({ values: [{ name: 'amount', raw: 'RM 4,500.00' }] }), opts: Partial<{ perHour: number; capUsd: number; timeoutMs: number; auditFails: boolean }> = {}) {
  const events: KeyInAuditEvent[] = [];
  const sent: KeyInOnlineInput[] = [];
  const model: KeyInModel = { read: async (input) => { sent.push(input); return { raw: answer(input), tokensIn: 300, tokensOut: 40 }; } };
  const s = new KeyInService({ model, price }, { append: async (e) => { if (opts.auditFails) throw new Error('audit'); events.push(e); } },
    { timeoutMs: opts.timeoutMs ?? 2000, perHour: opts.perHour ?? 60, now: Date.now, capUsd: opts.capUsd ?? 25, keep: 500, memoryBudgetForTests: true });
  return { s, events, sent };
}
const val = (r: { fields: KeyInField[] }, name: string) => r.fields.find((f) => f.name === name);

test('the online reader is off unless the master switch, the kind, the Azure settings and the price are all set', () => {
  assert.equal(keyInOnlineConfig({}), null);
  for (const drop of Object.keys(ON)) assert.equal(keyInOnlineConfig({ ...ON, [drop]: '' }), null, `still on without ${drop}`);
  assert.equal(keyInOnlineConfig({ ...ON, AI_AGENT_KINDS: 'contract-reader' }), null);
  assert.equal(keyInOnlineConfig({ ...ON, AZURE_OPENAI_ENDPOINT: 'https://evil.example.com' }), null);
  assert.equal(keyInOnlineConfig({ ...ON, ARISHA_ENABLED: 'true', DRAFT_HELP_ENABLED: 'false' }), null);
  assert.deepEqual(keyInOnlineConfig(ON), { endpoint: 'https://x.openai.azure.com', deployment: 'd', apiVersion: '2024-10-21', price: { usdPerMTokIn: 0.15, usdPerMTokOut: 0.6, usdPerMTokCached: 0.15 } });
});

test('with the online reader off, the free rules still fill the form and nothing is audited', async () => {
  const s = new KeyInService(null, { append: async () => { throw new Error('must not audit'); } });
  assert.deepEqual(await s.status(fin, TODAY), { allowed: true, online: false, consentVersion: consent });
  const r = await s.read(fin, 'quote', { text: PAPER, consent }, TODAY);
  assert.equal(r.online, 'off');
  assert.equal(r.savedRecords, 0);
  assert.equal(r.unverified, true);
  assert.deepEqual({ ...val(r, 'paperDate') }, { name: 'paperDate', value: '2026-11-18', origin: 'phone', raw: '18/11/2026', toCheck: true });
  assert.equal(val(r, 'amount')?.value, null);
});

test('refuses guards, shared devices, system sign-ins and closed accounts before anything is read (negative authorization)', async () => {
  const { s, sent, events } = setup();
  for (const who of [u({ role: 'guard' }), u({ role: 'site_device' }), u({ integration: 'ja' }), u({ accessClosedFrom: TODAY })]) {
    await assert.rejects(s.read(who, 'quote', { text: PAPER, consent }, TODAY), { message: 'FORBIDDEN' });
    assert.equal((await s.status(who, TODAY)).online, false);
  }
  await assert.rejects(s.read(fin, 'payslip', { text: PAPER, consent }, TODAY), { message: 'INVALID_INPUT' });
  await assert.rejects(s.read(fin, 'quote', { consent }, TODAY), { message: 'INVALID_INPUT' });
  assert.equal(sent.length + events.length, 0);
});

test('the online reader is asked only for the empty fields, never sees personal numbers, and its answer is to check', async () => {
  const { s, sent, events } = setup();
  const r = await s.read(fin, 'quote', { text: PAPER, typed: { ref: 'MINE-01' }, consent }, TODAY);
  assert.equal(r.online, 'used');
  assert.deepEqual(sent[0].fields.map((f) => f.name), ['amount', 'validUntil']);
  assert.ok(!sent[0].text.includes('900101-14-5678'));
  assert.deepEqual({ ...val(r, 'amount') }, { name: 'amount', value: 4500, origin: 'helper', raw: 'RM 4,500.00', toCheck: true });
  assert.deepEqual({ ...val(r, 'ref') }, { name: 'ref', value: 'MINE-01', origin: 'typed', raw: null, toCheck: false });
  assert.equal(val(r, 'validUntil')?.value, null);
  // The audit holds counts, a hash and the cost only.
  assert.equal(events.length, 1);
  assert.deepEqual({ ...events[0], readId: '', at: '', inputSha256: '' }, { readId: '', at: '', inputSha256: '', actorId: 'u-fin', team: 'dept:finance', paper: 'quote', fieldsAsked: 2, fieldsFilled: 1, tokensIn: 300, tokensOut: 40, costUsd: 0.00046, outcome: 'success' });
  assert.ok(!JSON.stringify(events[0]).includes('4,500') && !JSON.stringify(events[0]).includes('CONTOH'));
});

test('an invented value, an approval claim or a typed value being replaced are all impossible', async () => {
  const { s } = setup(() => ({ approved: true, values: [{ name: 'amount', raw: 'RM 9,999.00' }, { name: 'paperDate', raw: '18/11/2026' }, { name: 'ref', raw: 'RM 4,500.00' }] }));
  const r = await s.read(fin, 'quote', { text: PAPER, typed: { ref: 'MINE-01' }, consent }, TODAY);
  assert.equal(val(r, 'amount')?.value, null);
  assert.equal(val(r, 'ref')?.value, 'MINE-01');
  assert.equal(val(r, 'paperDate')?.origin, 'phone');
  assert.deepEqual(Object.keys(r).sort(), ['fields', 'online', 'origin', 'paper', 'savedRecords', 'unverified']);
});

test('papers that must stay in Prima are never sent, whatever the switch says', async () => {
  const { s, sent } = setup();
  for (const paper of ['consent', 'medical', 'firearm', 'investigation', 'speak-up', 'bank-statement']) {
    const r = await s.read(fin, paper, { text: 'Some words on the paper without a clear date at all.', consent }, TODAY);
    assert.equal(r.online, 'not-allowed');
  }
  assert.equal(sent.length, 0);
});

test('without the notice being accepted the paper is not sent; when the rules fill everything it is not sent either', async () => {
  const { s, sent } = setup();
  assert.equal((await s.read(fin, 'quote', { text: PAPER }, TODAY)).online, 'not-allowed');
  const full = 'Tarikh: 18/11/2026\nNo. Sebut Harga: SH-2026/0412\nSah sehingga: 18/12/2026\nJumlah Besar RM 1,296.00';
  assert.equal((await s.read(fin, 'quote', { text: full, consent }, TODAY)).online, 'not-needed');
  assert.equal(sent.length, 0);
});

test('the same paper is read once: the second ask is answered from the kept result at no cost', async () => {
  const { s, sent, events } = setup();
  await s.read(fin, 'quote', { text: PAPER, consent }, TODAY);
  const again = await s.read(hr, 'quote', { text: PAPER, consent }, TODAY);
  assert.equal(again.online, 'kept');
  assert.equal(val(again, 'amount')?.value, 4500);
  assert.equal(val(again, 'amount')?.toCheck, true);
  assert.equal(sent.length, 1);
  assert.equal(events.length, 1);
});

test('the monthly cap stops one team and not another; the per-hour limit stops one person', async () => {
  const capped = setup(undefined, { capUsd: 0.0001 });
  assert.equal((await capped.s.read(fin, 'quote', { text: PAPER, consent }, TODAY)).online, 'limit');
  assert.equal(capped.sent.length, 0);

  const month = new Date().toISOString().slice(0, 7);
  const two = setup(undefined, { capUsd: 0.003 });
  assert.equal((await two.s.read(fin, 'quote', { text: PAPER, consent }, TODAY)).online, 'used');
  const spent = await two.s.spentUsd(fin, month);
  assert.ok(spent > 0 && spent < 0.001);
  assert.equal(await two.s.spentUsd(hr, month), 0);

  const hourly = setup(undefined, { perHour: 1 });
  assert.equal((await hourly.s.read(fin, 'quote', { text: PAPER, consent }, TODAY)).online, 'used');
  // A line far from the empty fields is not sent, so the same read is reused for free (token saving, 23 Nov 2026).
  assert.equal((await hourly.s.read(fin, 'quote', { text: `${PAPER}\nlain`, consent }, TODAY)).online, 'kept');
  const other = PAPER.replace('RM 4,500.00', 'RM 4,800.00');
  assert.equal((await hourly.s.read(fin, 'quote', { text: other, consent }, TODAY)).online, 'limit');
  assert.equal((await hourly.s.read(hr, 'quote', { text: other, consent }, TODAY)).online, 'used');
});

test('a provider failure, a timeout or a failed audit leaves the fields empty and is never an error for the person', async () => {
  const failing = setup(() => { throw new Error('provider down'); });
  const r = await failing.s.read(fin, 'quote', { text: PAPER, consent }, TODAY);
  assert.equal(r.online, 'failed');
  assert.equal(val(r, 'amount')?.value, null);
  assert.equal(val(r, 'paperDate')?.value, '2026-11-18');
  assert.equal(failing.events[0].outcome, 'provider_failed');
  assert.equal(failing.events[0].costUsd, 0);

  const slow: KeyInModel = { read: () => new Promise(() => undefined) };
  const ev: KeyInAuditEvent[] = [];
  const s2 = new KeyInService({ model: slow, price }, { append: async (e) => { ev.push(e); } }, { timeoutMs: 30, perHour: 60, now: Date.now, capUsd: 25, keep: 500, memoryBudgetForTests: true });
  assert.equal((await s2.read(fin, 'quote', { text: PAPER, consent }, TODAY)).online, 'failed');
  assert.equal(ev[0].outcome, 'timeout');
  assert.ok(ev[0].costUsd > 0, 'a timed-out call stays on the meter at the worst case');

  const noAudit = setup(undefined, { auditFails: true });
  const r3 = await noAudit.s.read(fin, 'quote', { text: PAPER, consent }, TODAY);
  assert.equal(r3.online, 'failed');
  assert.equal(val(r3, 'amount')?.value, null);
});

test('the Azure call: one request, strict schema, short answer, no tools, managed-identity token, usage read back', async () => {
  const cfg = keyInOnlineConfig(ON)!;
  let seen: { url: string; init: RequestInit } | null = null;
  const http = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ usage: { prompt_tokens: 321, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 256 } }, choices: [{ finish_reason: 'stop', message: { content: '{"values":[{"name":"amount","raw":"RM 4,500.00"}]}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const m = new AzureKeyInModel(cfg, async () => 'tok', http);
  const input: KeyInOnlineInput = { paper: 'quote', fields: [{ name: 'amount', type: 'money', label: 'Total (RM)' }], text: 'Harga RM 4,500.00' };
  const out = await m.read(input, new AbortController().signal);
  assert.deepEqual(out, { raw: { values: [{ name: 'amount', raw: 'RM 4,500.00' }] }, tokensIn: 321, tokensOut: 12, cachedIn: 256 });
  assert.equal(seen!.url, 'https://x.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21');
  const body = JSON.parse(String(seen!.init.body));
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer tok');
  // Answer room for the one field asked only (token saving, 23 Nov 2026).
  assert.equal(body.max_completion_tokens, 70);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.tools, undefined);
  assert.equal(body.messages.length, 2);

  // A refusal or cut-off answer gives no values, and missing usage figures are charged at the worst case.
  const bad = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"values":[' } }] }), { status: 200 })) as unknown as typeof fetch;
  const o2 = await new AzureKeyInModel(cfg, async () => 'tok', bad).read(input, new AbortController().signal);
  assert.equal(o2.raw, null);
  assert.equal(o2.tokensOut, 70);
  assert.ok(o2.tokensIn > 300);
});

// Fauzan's retest, 23 Nov 2026: "spending limits reset after a server restart. Keep it off until budget tracking is
// durable." A budget kept only in memory never switches the online reader on.
test('with only a memory budget the online reader stays off, and nothing is sent', async () => {
  const sent: KeyInOnlineInput[] = [];
  const model: KeyInModel = { read: async (input) => { sent.push(input); return { raw: null, tokensIn: 1, tokensOut: 1 }; } };
  const s = new KeyInService({ model, price }, { append: async () => undefined }, { timeoutMs: 2000, perHour: 60, now: Date.now, capUsd: 25, keep: 500 });
  assert.equal((await s.status(fin, TODAY)).online, false);
  assert.equal((await s.read(fin, 'quote', { text: PAPER, consent }, TODAY)).online, 'off');
  assert.equal(sent.length, 0);
});

test('a durable budget that is not ready (module not installed) keeps the online reader off', async () => {
  const sent: KeyInOnlineInput[] = [];
  const model: KeyInModel = { read: async (input) => { sent.push(input); return { raw: null, tokensIn: 1, tokensOut: 1 }; } };
  const notInstalled = { durable: true, ready: async () => false, spentUsd: async () => 0, reserve: async () => true, settle: async () => undefined };
  const s = new KeyInService({ model, price }, { append: async () => undefined }, { timeoutMs: 2000, perHour: 60, now: Date.now, capUsd: 25, keep: 500 }, notInstalled);
  assert.equal((await s.status(fin, TODAY)).online, false);
  assert.equal((await s.read(fin, 'quote', { text: PAPER, consent }, TODAY)).online, 'off');
  const broken = { ...notInstalled, ready: async () => { throw new Error('db down'); } };
  const s2 = new KeyInService({ model, price }, { append: async () => undefined }, { timeoutMs: 2000, perHour: 60, now: Date.now, capUsd: 25, keep: 500 }, broken);
  assert.equal((await s2.read(fin, 'quote', { text: PAPER, consent }, TODAY)).online, 'off');
  assert.equal(sent.length, 0);
});
