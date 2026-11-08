// P90 (Fitri, 9 Nov 2026: Arisha answers too slowly): screen questions are answered at once from the screen guide
// (apps/web/src/arisha-local.ts) in English and Malay, questions about records go to the AI, and the AI's brief carries
// only the guides the question matches. Offline: the module is bundled with esbuild (already installed for Vite);
// no provider calls and no data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
const esbuild = createRequire(`${web}package.json`)('esbuild');
const load = async (entry) => {
  const out = esbuild.buildSync({ entryPoints: [`${web}src/${entry}`], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error', absWorkingDir: web });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
};
const local = await load('arisha-local.ts');
const screens = await load('arisha-screens.ts');
const menu = screens.SCREEN_GUIDES.map((g) => g.title);
const ask = (view, lang, q, quick) => local.localAnswer(q, { view, menu, lang, quick });

test('the three quick buttons are answered from the guide on every screen, in every language', () => {
  for (const g of screens.SCREEN_GUIDES)
    for (const lang of ['en', 'ms', 'mix'])
      for (const quick of ['q1', 'q2', 'q3']) {
        const a = ask(g.view, lang, 'x', quick);
        assert.ok(a && a.text.length > 20, `${g.view} ${lang} ${quick}`);
      }
  const teach = ask('roster', 'en', 'Teach me this screen', 'q1');
  assert.match(teach.text, /Roster/);
  assert.ok(teach.chips.some((c) => /add shifts/i.test(c.label)), 'how-tos offered as buttons');
});

test('clear how-to questions find the right steps in English and Malay, at once', () => {
  const cases = [
    ['roster', 'en', 'How do I add shifts?', /How to add shifts/],
    ['roster', 'ms', 'macam mana nak tambah syif', /How to add shifts/],
    ['roster', 'ms', 'cara terbitkan jadual minggu ini', /How to publish the week/],
    ['roster', 'en', 'what does draft mean', /Draft/],
    ['roster', 'ms', 'apa maksud draf', /Draft/],
    ['roster', 'en', 'where do I find leave requests', /Leave requests/],
    ['attendance', 'ms', 'kunci hari', /How to lock a day/],
    ['items', 'en', 'print labels', /print labels/],
    ['sites', 'en', 'assign guard to shift', /How to assign a guard/],
    ['roster', 'ms', 'apa skrin ini', /Jadual tugas/],
  ];
  local.warmGuideIndex(); // built once, while the panel opens
  for (const [view, lang, q, want] of cases) {
    const t0 = performance.now();
    const a = ask(view, lang, q);
    assert.ok(a, `${view}: ${q} answered locally`);
    assert.match(a.text, want, `${view}: ${q}`);
    assert.ok(performance.now() - t0 < 250, `${q} is instant`);
  }
  // A how-to on another screen says where to open it first; in Malay the frame and the menu name are Malay.
  assert.match(ask('sites', 'ms', 'assign guard to shift').text, /^Ini di skrin \*\*Jadual tugas\*\*/);
});

test('questions about the person\'s records, numbers or drafts, and unrelated chat, still go to the AI', () => {
  for (const q of ['how many guards are unfilled this week', 'prepare a new site draft', 'berapa jumlah tuntutan bulan ini', 'tell me a joke'])
    assert.equal(ask('roster', 'en', q), null, q);
  const focus = local.guideFocus('how many guards are unfilled this week', 'roster', menu);
  assert.equal(local.guideOnly('how many guards are unfilled this week', focus, 'roster'), false, 'record questions keep their tools');
  assert.equal(local.guideOnly('how do I give a job', local.guideFocus('how do I give a job', 'it', menu), 'it'), true);
});

test('the AI brief carries the open screen and only the matched guides: far smaller than the whole menu', () => {
  let before = 0;
  let after = 0;
  for (const g of screens.SCREEN_GUIDES) {
    const old = screens.screenGuideText(g.view, menu, 'ms', 12_000);
    const focus = local.guideFocus('where do I find leave requests', g.view, menu);
    const now = screens.screenGuideText(g.view, menu, 'ms', 7_000, focus);
    assert.ok(now.includes(`SCREEN OPEN NOW: ${g.title}`), `${g.view} open screen guide reaches the AI`);
    assert.ok(now.length <= 7_000, `${g.view} within room`);
    before += old.length;
    after += now.length;
  }
  assert.ok(after < before * 0.6, `focused guides ${after} vs whole menu ${before}`);
});
