// P90: the menu's sections and groups hold every menu screen exactly once, each screen has a one-line description, and
// every section, group and description has a Malay row. Offline: reads source files only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = read('../apps/web/src/App.tsx');
const cat = read('../apps/web/src/nav-catalog.ts');
const i18n = read('../apps/web/src/i18n.ts');

const navBlock = app.slice(app.indexOf('const NAV:'), app.indexOf('\n];', app.indexOf('const NAV:')));
const menu = [...navBlock.matchAll(/view:\s*'([^']+)',\s*label:\s*'([^']+)'/g)].map((m) => m[1]);
const secBlock = cat.slice(cat.indexOf('export const NAV_SECTIONS'), cat.indexOf('\n];', cat.indexOf('export const NAV_SECTIONS')));
const grouped = [...secBlock.matchAll(/views: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
const titles = [...secBlock.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
const infoBlock = cat.slice(cat.indexOf('export const NAV_INFO'), cat.indexOf('\n};', cat.indexOf('export const NAV_INFO')));
const blurbs = new Map([...infoBlock.matchAll(/^\s*'?([\w-]+)'?: \{ blurb: (['"])(.*?)\2, words: '([^']*)' \}/gm)].map((m) => [m[1], { blurb: m[3], words: m[4] }]));
const rows = new Set([...i18n.matchAll(/^\s*\[(['"])(.*?)\1, /gm)].map((m) => m[2]));

test('every menu screen sits in exactly one group, and no group names a screen outside the menu', () => {
  assert.ok(menu.length > 60, 'menu parsed');
  for (const v of menu) assert.equal(grouped.filter((g) => g === v).length, 1, `${v} placed once`);
  for (const g of grouped) assert.ok(menu.includes(g), `${g} is a menu screen`);
  assert.equal(new Set(grouped).size, grouped.length, 'no screen twice');
});

test('every menu screen has a plain one-line description and search words', () => {
  for (const v of menu) {
    const b = blurbs.get(v);
    assert.ok(b, `description for ${v}`);
    assert.ok(b.blurb.length > 10 && b.blurb.length <= 70, `${v} description is one short line`);
    assert.ok(b.words.split(' ').length >= 2, `${v} search words`);
  }
});

test('section names, group names and descriptions have a Malay row', () => {
  for (const t of titles) assert.ok(rows.has(t), `row for "${t}"`);
  for (const [v, b] of blurbs) assert.ok(rows.has(b.blurb), `row for ${v} description`);
  for (const t of ['Search the menu', 'All your screens', 'Find a screen', 'Recently opened', 'No screen in your menu matches this.']) assert.ok(rows.has(t), `row for "${t}"`);
});

test('search words cover the everyday words staff use', () => {
  const find = (word) => [...blurbs].filter(([, b]) => ` ${b.words} `.includes(` ${word} `)).map(([v]) => v);
  for (const v of ['staffpay', 'guardpay']) assert.ok(find('gaji').includes(v) && find('salary').includes(v), `gaji/salary find ${v}`);
  assert.ok(find('cuti').length && find('leave').length, 'leave/cuti');
  for (const w of ['fw', 'pekerja', 'asing']) assert.ok(find(w).includes('fwm'), `${w} finds foreign workers`);
});

// P91 (Fitri, 9 Nov 2026): Prima as apps. The home space holds the everyday screens; every other space is an app card with
// a one-line description, both with a Malay row; the shell's labels have rows too.
test('the menu is a home space and apps, each with a short line and a Malay row', () => {
  const spaces = [...secBlock.matchAll(/id: '([^']+)',\s*title: '([^']+)',\s*blurb: '([^']+)',(\s*home: true,)?/g)].map((m) => ({ id: m[1], title: m[2], blurb: m[3], home: !!m[4] }));
  assert.equal(spaces.filter((s) => s.home).length, 1, 'one home space');
  assert.equal(spaces[0].id, 'home', 'home first');
  assert.ok(spaces.length >= 10, `${spaces.length} apps`);
  for (const s of spaces) {
    assert.ok(s.blurb.length > 10 && s.blurb.length <= 60, `${s.id} line is short`);
    assert.ok(rows.has(s.title) && rows.has(s.blurb), `rows for ${s.id}`);
  }
  const homeBlock = secBlock.slice(secBlock.indexOf("id: 'home'"), secBlock.indexOf("id: 'ops'"));
  for (const v of ['home', 'mine', 'clock', 'work']) assert.ok(homeBlock.includes(`'${v}'`), `${v} is an everyday screen`);
  for (const t of ['Apps', 'All apps', 'Switch app', 'Search apps and screens', 'Waiting for you', 'Good morning', 'Good afternoon', 'Good evening']) assert.ok(rows.has(t), `row for "${t}"`);
});
