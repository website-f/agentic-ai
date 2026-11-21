// P121: the SOP and workflow guide (apps/web/src/sop). Every flow is complete in English and Malay, points only at real
// menu screens, every tab it links to is one that screen accepts from a link (useRouteTab with that tab), and every
// source document exists. Run: node --test scripts/sop-catalog.test.mjs (from apps/prima). Offline: source files only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../apps/web/src');
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

// Load every area file (they import only types).
const areasDir = path.join(web, 'sop/areas');
const SOPS = [];
for (const f of fs.readdirSync(areasDir).filter((x) => x.endsWith('.ts')).sort()) {
  const out = ts.transpileModule(read(path.join(areasDir, f)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(out, { exports: mod.exports, module: mod, require: () => ({}) });
  for (const v of Object.values(mod.exports)) if (Array.isArray(v)) SOPS.push(...v.map((s) => ({ ...s, file: f })));
}

const app = read(path.join(web, 'App.tsx'));
const navBlock = app.slice(app.indexOf('const NAV:'), app.indexOf('\n];', app.indexOf('const NAV:')));
const menu = new Set([...navBlock.matchAll(/view:\s*'([^']+)',\s*label:/g)].map((m) => m[1]));
const cat = read(path.join(web, 'nav-catalog.ts'));
const appIds = new Set([...cat.slice(cat.indexOf('export const NAV_SECTIONS')).matchAll(/^\s{4}id: '([\w-]+)'/gm)].map((m) => m[1]));
appIds.delete('home');

// The file each menu screen is drawn from: the case in App.tsx renders a component loaded with lazyView from a view file.
const fileOfComponent = new Map([...app.matchAll(/const (\w+) = lazyView\(\(\) => import\('\.\/views\/([\w/]+)'\)/g)].map((m) => [m[1], m[2]]));
// Screens App.tsx imports directly: import { A, B as C } from './views/X'.
for (const m of app.matchAll(/^import \{([^}]+)\} from '\.\/views\/([\w/]+)';/gm))
  for (const part of m[1].split(','))
    {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && !name.startsWith('type ')) fileOfComponent.set(name, m[2]);
    }
const caseBlock = (view) => {
  const at = app.indexOf(`case '${view}':`);
  if (at < 0) return '';
  const next = app.indexOf('case ', at + 6);
  return app.slice(at, next < 0 ? at + 600 : next);
};
/** Every source file reachable (one import level deep) from a screen's view file: tabs often live in a sub-panel file. */
function screenSources(view) {
  const files = new Set();
  for (const [comp, file] of fileOfComponent) if (new RegExp(`<${comp}[\\s/>]`).test(caseBlock(view))) files.add(file);
  const seen = new Set();
  const out = [];
  for (const f of files) {
    const p = path.join(web, 'views', `${f}.tsx`);
    if (!fs.existsSync(p) || seen.has(p)) continue;
    seen.add(p);
    const src = read(p);
    out.push(src);
    for (const m of src.matchAll(/from '\.\/([\w/]+)'/g)) {
      const q = path.join(web, 'views', `${m[1]}.tsx`);
      if (fs.existsSync(q) && !seen.has(q)) {
        seen.add(q);
        out.push(read(q));
      }
    }
  }
  return out.join('\n');
}

const texts = (s) => [
  ['title', s.title],
  ['purpose', s.purpose],
  ['starter', s.starter],
  ...(s.statusNote ? [['statusNote', s.statusNote]] : []),
  ...(s.start ? [['start.label', s.start.label]] : []),
  ...s.steps.flatMap((x, i) => [
    [`step ${i + 1} who`, x.who],
    [`step ${i + 1} does`, x.does],
    ...(x.where ? [[`step ${i + 1} where.label`, x.where.label]] : []),
  ]),
  ...s.rules.map((r, i) => [`rule ${i + 1}`, r]),
];
const places = (s) => [...(s.start ? [['start', s.start]] : []), ...s.steps.filter((x) => x.where).map((x, i) => [`step ${i + 1}`, x.where])];

test('the guide has flows and every id is unique, kebab-case and prefixed by its app', () => {
  assert.ok(SOPS.length >= 2, `flows loaded: ${SOPS.length}`);
  const ids = SOPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  for (const s of SOPS) {
    assert.match(s.id, /^[a-z]+(-[a-z0-9]+)+$/, `${s.id} kebab-case`);
    assert.ok(appIds.has(s.app), `${s.id}: app ${s.app} is one of the home screen's apps`);
    assert.ok(!appIds.has(s.id) && s.id !== 'rules', `${s.id} does not clash with an app filter`);
    assert.ok(['in_force', 'trial', 'off', 'draft'].includes(s.status), `${s.id} status`);
    assert.ok(s.steps.length >= 2, `${s.id} has steps`);
  }
});

test('every text is written in English and Malay', () => {
  for (const s of SOPS)
    for (const [k, t] of texts(s)) {
      assert.ok(t && typeof t.en === 'string' && t.en.trim().length > 1, `${s.id} ${k} English`);
      assert.ok(typeof t.ms === 'string' && t.ms.trim().length > 1, `${s.id} ${k} Malay`);
    }
});

test('every link goes to a menu screen, and a tab only where that screen accepts it from a link', () => {
  for (const s of SOPS)
    for (const [k, p] of places(s)) {
      assert.ok(menu.has(p.view), `${s.id} ${k}: ${p.view} is a menu screen`);
      if (!p.tab || p.view === 'sop') continue;
      const src = screenSources(p.view);
      assert.ok(/useRouteTab</.test(src), `${s.id} ${k}: ${p.view} reads its tab from the link (useRouteTab)`);
      assert.ok(src.includes(`'${p.tab}'`), `${s.id} ${k}: ${p.view} has a tab '${p.tab}'`);
    }
});

test('every source document exists', () => {
  for (const s of SOPS) {
    const doc = s.source.doc.split('#')[0];
    assert.ok(fs.existsSync(path.resolve(here, '..', doc)), `${s.id}: ${doc} exists in apps/prima`);
  }
});
