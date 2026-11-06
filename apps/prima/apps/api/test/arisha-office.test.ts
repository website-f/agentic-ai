// P80: Arisha on the Agentic Office's AI. A stand-in for the office answers: no network is used.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arishaToolsFor } from '@prima/core';
import { ArishaBusy, ArishaUnavailable, ARISHA_SYSTEM_RULES, askArishaOn } from '../src/arisha';
import { OFFICE_MODEL_VIA, arishaProvider, officeModel, officeModelConfig } from '../src/arisha-office';
import { officePayload, officeSign } from '../src/office';

const SECRET = 'o'.repeat(40);
const URL_ = 'http://api:8501/internal/prima/model';
const AZURE = { ARISHA_ENABLED: 'true', AZURE_OPENAI_ENDPOINT: 'https://prima-ai.openai.azure.com', AZURE_OPENAI_DEPLOYMENT: 'arisha', AZURE_OPENAI_API_VERSION: '2024-10-21' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const input = (tools: (() => Promise<unknown>) | null = null) => ({
  history: [], brief: 'How do I apply for leave?', tools, toolSpecs: arishaToolsFor({ id: 'u-staff' }),
});

describe('Arisha on the office AI', () => {
  it('is chosen from the environment: the office when OFFICE_MODEL_URL and the signing secret are set, else Azure, else off', () => {
    assert.equal(arishaProvider({}), null);
    assert.equal(arishaProvider({ OFFICE_MODEL_URL: URL_ }), null); // no secret: off
    assert.equal(arishaProvider({ OFFICE_MODEL_URL: URL_, OFFICE_SIGNING_SECRET: 'short' }), null);
    assert.deepEqual(arishaProvider({ OFFICE_MODEL_URL: ` ${URL_} `, OFFICE_SIGNING_SECRET: SECRET }), { kind: 'office', office: { url: URL_, secret: SECRET } });
    // The office wins over Azure; Azure alone still works as before.
    assert.equal(arishaProvider({ ...AZURE, OFFICE_MODEL_URL: URL_, OFFICE_SIGNING_SECRET: SECRET })?.kind, 'office');
    assert.equal(arishaProvider(AZURE)?.kind, 'azure');
    for (const bad of ['ftp://api/x', 'http://u:p@api/x', 'http://api/x#frag', 'not a url'])
      assert.equal(officeModelConfig({ OFFICE_MODEL_URL: bad, OFFICE_SIGNING_SECRET: SECRET }), null, bad);
  });

  it('signs each turn for the staff record under its own headers, and returns the office answer to the same loop', async () => {
    const cfg = officeModelConfig({ OFFICE_MODEL_URL: URL_, OFFICE_SIGNING_SECRET: SECRET })!;
    const seen: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      const h = init.headers as Record<string, string>;
      // The office checks exactly this (agentic/prima/model.py verify).
      const want = officeSign(SECRET, officePayload(h['x-prima-ts'], 'POST', '/internal/prima/model', { user: 'u-staff', via: OFFICE_MODEL_VIA }, String(init.body)));
      assert.equal(h['x-prima-signature'], want);
      assert.equal(h['x-prima-via'], 'prima:arisha');
      assert.equal(h['x-prima-user'], 'u-staff');
      assert.ok(!Object.keys(h).some((k) => k.startsWith('x-office-')));
      assert.equal(init.redirect, 'error');
      const body = JSON.parse(String(init.body));
      assert.equal(body.messages[0].content, ARISHA_SYSTEM_RULES);
      assert.ok(body.max_tokens <= 2000);
      return seen.length === 1
        ? json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'task_guide', arguments: '{"cardId":"leave"}' } }] } }] })
        : json({ choices: [{ message: { role: 'assistant', content: 'Open Leave, then press Apply.' } }] });
    }) as typeof fetch;
    let ran = '';
    const answer = await askArishaOn(officeModel(cfg, 'u-staff', http), input(async () => { ran = 'task_guide'; return { cards: [] }; }));
    assert.equal(answer.text, 'Open Leave, then press Apply.');
    assert.equal(ran, 'task_guide');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].url, URL_);
    // Only the read-only guide was offered to a staff member.
    assert.deepEqual(JSON.parse(String(seen[0].init.body)).tools.map((t: { function: { name: string } }) => t.function.name), ['task_guide']);
    // The tool result went back as the tool's message, never as an instruction.
    const second = JSON.parse(String(seen[1].init.body));
    assert.equal(second.messages.at(-1).role, 'tool');
    assert.equal(second.messages.at(-1).tool_call_id, 'c1');
  });

  it('a tool outside this person\'s scope is never run, even if the model asks for it', async () => {
    const cfg = officeModelConfig({ OFFICE_MODEL_URL: URL_, OFFICE_SIGNING_SECRET: SECRET })!;
    let calls = 0;
    const http = (async () => json({ choices: [{ message: ++calls === 1
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'prepare_record', arguments: '{"kind":"site","values":{},"summary":"x"}' } }] }
      : { role: 'assistant', content: 'I cannot prepare records for you.' } }] })) as typeof fetch;
    let ran = false;
    const answer = await askArishaOn(officeModel(cfg, 'u-staff', http), input(async () => { ran = true; }));
    assert.equal(ran, false);
    assert.equal(answer.drafts.length, 0);
  });

  it('passes the office\'s plain refusal on: 429 as busy (allowance), anything else as unavailable', async () => {
    const cfg = officeModelConfig({ OFFICE_MODEL_URL: URL_, OFFICE_SIGNING_SECRET: SECRET })!;
    const allowance = 'Your AI allowance for today is used up (100 of 100 tokens). It resets at midnight, or a manager can give you more.';
    await assert.rejects(askArishaOn(officeModel(cfg, 'u-staff', (async () => json({ message: allowance }, 429)) as typeof fetch), input()),
      (e: unknown) => e instanceof ArishaBusy && e.message === allowance);
    await assert.rejects(askArishaOn(officeModel(cfg, 'u-staff', (async () => json({ message: 'Open Prima from the office to ask Arisha.' }, 403)) as typeof fetch), input()),
      (e: unknown) => e instanceof ArishaUnavailable && /from the office/.test(e.message));
    // A refusal without words (or a long one) gets our own plain line, never the raw body.
    await assert.rejects(askArishaOn(officeModel(cfg, 'u-staff', (async () => new Response('x'.repeat(500), { status: 502 })) as typeof fetch), input()),
      (e: unknown) => e instanceof ArishaUnavailable && /could not reach the office AI/.test(e.message));
  });
});
