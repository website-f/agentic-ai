// P87: Arisha's screen guide covers every menu screen, its titles match the menu, and the brief carries it.
// Offline: reads source files only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('../apps/web/src/App.tsx');
const data = read('../apps/web/src/arisha-screens.data.ts');
const arisha = read('../apps/web/src/Arisha.tsx');

const navBlock = app.slice(app.indexOf('const NAV:'), app.indexOf('\n];', app.indexOf('const NAV:')));
const menu = new Map([...navBlock.matchAll(/view:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
const guides = JSON.parse(data.slice(data.indexOf('= [') + 2, data.lastIndexOf('];') + 1));

test('every menu screen has exactly one screen guide, titled as in the menu', () => {
  assert.ok(menu.size > 60, 'menu parsed');
  const views = guides.map((g) => g.view);
  assert.equal(new Set(views).size, views.length, 'no duplicate guides');
  for (const [view, label] of menu) {
    const g = guides.find((x) => x.view === view);
    assert.ok(g, `guide for ${view}`);
    assert.equal(g.title, label, `${view} title`);
  }
  for (const g of guides) assert.ok(menu.has(g.view), `${g.view} is a menu screen`);
});

test('each guide says what the screen is for, who uses it, and at least one how-to', () => {
  for (const g of guides) {
    assert.ok(g.what.length > 20 && g.who.length > 10, `${g.view} what/who`);
    assert.ok(g.tasks.length > 0 && g.tasks.every((t) => t.steps.length > 0), `${g.view} tasks`);
  }
});

test('the brief carries the open screen guide and the plain-words instruction', () => {
  assert.ok(arisha.includes('${screenGuideText(view, menu, lang)}'));
  assert.ok(arisha.includes('Many people asking are not used to computers.'));
});
