// K9 / N2: the AI part of Arisha's training stays off until switched on, refuses before any database call when off,
// and what it would send to Azure OpenAI holds the role and the screen only: no person, no records, no tools, numbers
// masked, under the 20,000-character limit. No database or provider needed. Synthetic data only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trainerBrief } from '@prima/core';
import { askArisha } from '../src/arisha';
import { ArishaTrainerController, trainerAiOn } from '../src/arisha-trainer.controller';

describe('K9 Arisha trainer route', () => {
  it('is off unless switched on, and Arisha AI itself must be on too', async () => {
    assert.equal(trainerAiOn({}), false);
    assert.equal(trainerAiOn({ PRIMA_TRAINER_AI_ENABLED: 'true' }), false);
    const c = new ArishaTrainerController({ asUser: async () => assert.fail('no database call when off') } as never);
    assert.deepEqual(c.state(), { ai: false });
    await assert.rejects(c.ask('u-pwvsb-hr', { question: 'How do I add a person?', screen: 'HR monitor', guide: 'x' }, {} as never), /not switched on/);
  });

  it('the HTTP body sent to Azure OpenAI carries the role and screen, never the person, records or tools', async () => {
    const bodies: string[] = [];
    const http = (async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Langkah 1.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const cfg = { endpoint: 'https://synthetic.openai.azure.com', deployment: 'synthetic', apiVersion: '2024-10-21' };
    const input = trainerBrief({ role: 'hr', screen: 'HR monitor', guide: 'SCREEN OPEN NOW: HR monitor\n'.repeat(3000), question: 'Bagaimana tambah 900101-14-5678 dan 012-3456789?', lang: 'ms' });
    assert.ok(input.brief.length < 20_000);
    await askArisha(cfg, async () => 'synthetic-token', input, http);
    const body = bodies[0];
    for (const secret of ['900101', '3456789', 'u-pwvsb-hr']) assert.ok(!body.includes(secret), secret);
    assert.ok(body.includes('Role: HR.'));
    assert.ok(!JSON.parse(body).tools, 'no tools offered');
  });
});
