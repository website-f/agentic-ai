// Offline branding regression: no provider/model calls or database access.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// Line endings differ between checkouts (Windows): the wording is compared with plain newlines.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const web = read('../apps/web/src/Arisha.tsx');
const itPlan = read('../apps/web/src/views/ItPlan.tsx');
const api = read('../apps/api/src/arisha.ts');
// P80: the web brief gained one line (Arisha consults everyone about Prima); its permission text is otherwise unchanged.
const policyHashes = {"web": "93a9107755ce5cc719245e11e0c022535c3cc663a4b937a1962125fe658fed4a", "itPlan": "d6dac0b58d3c63e65512bf058562f1c1b3a532fd1c7ec67b55eb7760f9c6b6ce", "api": "ce89f94e7f27c12c9e959f120e0ccf56cb19454337befa7a0f75daf103cdfe1e"};
const hash = value => createHash('sha256').update(value).digest('hex');
const prompt = (source, pattern) => { const result = source.match(pattern); assert.ok(result, 'prompt must exist'); return result[1]; };
const policyAfterIdentity = value => value.slice(value.indexOf('.') + 1);

test('title and launcher label say AI assistant in English and mixed language; Malay says pembantu AI', () => {
  for (const text of ["en: 'Arisha, your AI assistant'", "mix: 'Arisha, assistant AI anda'", "ms: 'Arisha, pembantu AI anda'", "'Open Arisha, your AI assistant'", "'Buka Arisha, assistant AI anda'", "'Buka Arisha, pembantu AI anda'"]) assert.ok(web.includes(text), text);
  const title = web.match(/  title: (.*),/)[1]; const open = web.match(/  open: (.*),/)[1];
  assert.doesNotMatch(title + open, /helper|pembantu anda/);
});
test('all three greetings identify Arisha as an AI assistant', () => {
  for (const text of ['Hi {name}, I am Arisha, your AI assistant.', 'Hai {name}, saya Arisha, pembantu AI anda.', 'Hai {name}, saya Arisha, assistant AI anda.']) assert.ok(web.includes(text), text);
});
test('both client prompts identify assistant while all following permission and workflow text stays byte-identical', () => {
  const brief = prompt(web, /    const brief = `([\s\S]*?)`;\n    const history/);
  const plan = prompt(itPlan, /    const prompt = `([\s\S]*?)`;\n    try \{/);
  assert.ok(brief.startsWith('You are Arisha, the AI assistant inside Prima Secure.'));
  assert.ok(plan.startsWith('You are Arisha, the AI assistant inside Prima Secure.'));
  assert.equal(hash(policyAfterIdentity(brief)), policyHashes.web);
  assert.equal(hash(policyAfterIdentity(plan)), policyHashes.itPlan);
});
test('server system identity says AI assistant without changing any remaining safety policy byte', () => {
  const system = prompt(api, /export const ARISHA_SYSTEM_RULES = `([\s\S]*?)`;/);
  assert.ok(system.startsWith('You are Arisha, the AI assistant in Prima Secure.'));
  assert.equal(hash(policyAfterIdentity(system)), policyHashes.api);
});
test('tool scope checks and explicit human submission remain present', () => {
  assert.ok(web.includes('const toolSpecs = arishaToolsFor(user);'));
  assert.ok(web.includes('arishaMayDraftRecord(user, d.kind)'));
  assert.ok(web.includes("api.arishaSubmit({ type: 'record'"));
  assert.ok(api.includes("if (!(input.toolSpecs ?? ARISHA_TOOLS).some((t) => t.name === c.function.name)) throw new Error('Tool not available.');"));
  assert.ok(api.includes("if (calls.length > 4 || toolCallsUsed + calls.length > 12)"));
});
