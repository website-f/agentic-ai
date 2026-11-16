// P107: Prima's DataTable (apps/web/src/DataTable.tsx and datatable-model.ts): search, filters, sort, pages, the state
// kept per screen, and the phone cards. Run: node --test scripts/datatable.test.mjs (from apps/prima). No browser: the
// rules are tested on their own, and the component is drawn to HTML with React's server renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const src = (p) => new URL('../apps/web/src/' + p, import.meta.url);

function load(file, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(src(file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (n) => {
      if (n in modules) return modules[n];
      if (n.endsWith('.css')) return {};
      throw Error('unexpected import ' + n);
    },
    module,
    module.exports,
  );
  return module.exports;
}

const M = load('datatable-model.ts');

const people = [
  { id: '1', name: 'Aminah binti Ali', company: 'pwvsb', status: 'Active', joined: '2024-03-01', pay: 2500, companies: ['pwvsb', 'act'] },
  { id: '2', name: 'Badrul Hisham', company: 'act', status: 'Left', joined: '2021-11-15', pay: 1800, companies: ['act'] },
  { id: '3', name: 'Chong Wei', company: 'pwvsb', status: 'Active', joined: '2025-07-20', pay: null, companies: ['pwvsb'] },
  { id: '4', name: 'Dewi Sartika', company: 'merdeka', status: 'On leave', joined: '', pay: 3200, companies: ['merdeka'] },
];
const cols = [
  { id: 'name', value: (r) => r.name },
  { id: 'status', value: (r) => r.status, translate: true },
  { id: 'joined', value: (r) => r.joined, sort: 'date' },
  { id: 'pay', value: (r) => r.pay, sort: 'money', search: false },
];
const BM = { Active: 'Aktif', Left: 'Berhenti', 'On leave': 'Bercuti' };
const hayOf = (lang) => (r) => M.haystack(r, cols, lang === 'en' ? null : (s) => BM[s] ?? s);

test('search: every word, any order, ignoring case, accents and punctuation', () => {
  const hay = hayOf('en');
  assert.deepEqual(M.searchRows(people, 'ali aminah', hay).map((r) => r.id), ['1']);
  assert.deepEqual(M.searchRows(people, '  CHONG  ', hay).map((r) => r.id), ['3']);
  assert.deepEqual(M.searchRows(people, 'binti-ali', hay).map((r) => r.id), ['1']);
  assert.equal(M.searchRows(people, '', hay).length, 4);
  assert.equal(M.searchRows(people, 'nobody', hay).length, 0);
  // A column marked search: false (pay) is not searched.
  assert.equal(M.searchRows(people, '2500', hay).length, 0);
});

test('search finds a status by its English or its Malay wording (BM/EN either way)', () => {
  const bm = hayOf('ms');
  assert.deepEqual(M.searchRows(people, 'aktif', bm).map((r) => r.id), ['1', '3']);
  assert.deepEqual(M.searchRows(people, 'active', bm).map((r) => r.id), ['1', '3']);
  assert.deepEqual(M.searchRows(people, 'bercuti', bm).map((r) => r.id), ['4']);
  // In English the Malay is not looked up.
  assert.equal(M.searchRows(people, 'aktif', hayOf('en')).length, 0);
  // The screen's own extra text (a staff number) is searched too.
  const extra = (r) => M.haystack(r, cols, null, (x) => `S-00${x.id}`);
  assert.deepEqual(M.searchRows(people, 's 002', extra).map((r) => r.id), ['2']);
});

test('filters: each chosen filter must match; a row with several values matches any of them', () => {
  const filters = [
    { id: 'company', value: (r) => r.companies },
    { id: 'status', value: (r) => r.status },
  ];
  assert.deepEqual(M.filterRows(people, filters, { company: 'act' }).map((r) => r.id), ['1', '2']);
  assert.deepEqual(M.filterRows(people, filters, { company: 'act', status: 'Active' }).map((r) => r.id), ['1']);
  assert.equal(M.filterRows(people, filters, { company: '', status: '' }).length, 4);
  assert.deepEqual(
    M.deriveOptions(people, filters[0]),
    [
      { value: 'act', count: 2 },
      { value: 'merdeka', count: 1 },
      { value: 'pwvsb', count: 2 },
    ],
  );
});

test('sort: text A to Z, money and dates by value, blanks last either way, ties keep order', () => {
  const by = (id, dir) => M.sortRows(people, cols.find((c) => c.id === id), dir).map((r) => r.id);
  assert.deepEqual(by('name', 'desc'), ['4', '3', '2', '1']);
  assert.deepEqual(by('pay', 'asc'), ['2', '1', '4', '3']);
  assert.deepEqual(by('pay', 'desc'), ['4', '1', '2', '3']);
  assert.deepEqual(by('joined', 'desc'), ['3', '1', '2', '4']);
  assert.deepEqual(by('joined', 'asc'), ['2', '1', '3', '4']);
  assert.deepEqual(by('status', 'asc'), ['1', '3', '2', '4']);
  // A heading clicked: text starts A to Z, numbers and dates largest first; the same heading turns round.
  assert.deepEqual(M.nextSort({ sort: '', dir: 'asc' }, 'name', 'text'), { sort: 'name', dir: 'asc' });
  assert.deepEqual(M.nextSort({ sort: '', dir: 'asc' }, 'pay', 'money'), { sort: 'pay', dir: 'desc' });
  assert.deepEqual(M.nextSort({ sort: 'pay', dir: 'desc' }, 'pay', 'money'), { sort: 'pay', dir: 'asc' });
  assert.equal(M.sortKey('RM1,234.50', 'money'), 1234.5);
  assert.equal(M.sortKey('2026-11', 'date'), Date.parse('2026-11-01'));
});

test('paging: ranges, numbered buttons with gaps, the count line, and changes going back to page 1', () => {
  assert.deepEqual(M.pageRange(1, 25, 245), { pages: 10, page: 1, from: 1, to: 25 });
  assert.deepEqual(M.pageRange(10, 25, 245), { pages: 10, page: 10, from: 226, to: 245 });
  assert.deepEqual(M.pageRange(99, 25, 245).page, 10);
  assert.deepEqual(M.pageRange(1, 25, 0), { pages: 1, page: 1, from: 0, to: 0 });
  assert.deepEqual(M.pageButtons(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(M.pageButtons(1, 10), [1, 2, 3, 4, '…', 10]);
  assert.deepEqual(M.pageButtons(6, 10), [1, '…', 5, 6, 7, '…', 10]);
  assert.deepEqual(M.pageButtons(10, 10), [1, '…', 7, 8, 9, 10]);
  assert.deepEqual(M.pageButtons(3, 9), [1, 2, 3, 4, '…', 9]);
  assert.equal(M.countLine(1, 25, 245), '1–25 of 245');
  assert.equal(M.countLine(1001, 1025, 1245), '1,001–1,025 of 1,245');
  assert.equal(M.countLine(0, 0, 0), '');
  const s = { ...M.DEFAULT_STATE, page: 4 };
  assert.equal(M.changeState(s, { q: 'x' }).page, 1);
  assert.equal(M.changeState(s, { f: { company: 'act' } }).page, 1);
  assert.equal(M.changeState(s, { page: 5 }).page, 5);
  assert.deepEqual(M.changeState({ ...s, f: { a: '1' } }, { f: { b: '2' } }).f, { a: '1', b: '2' });

  const many = Array.from({ length: 245 }, (_, i) => ({ id: String(i + 1), name: `Guard ${i + 1}`, status: i % 5 ? 'Active' : 'Left' }));
  const c = [{ id: 'name', value: (r) => r.name }, { id: 'status', value: (r) => r.status }];
  const hay = (r) => M.haystack(r, c, null);
  const v = M.viewRows(many, c, [{ id: 'status', value: (r) => r.status }], { ...M.DEFAULT_STATE, f: { status: 'Left' }, size: 10, page: 3 }, hay);
  assert.equal(v.matched, 49);
  assert.deepEqual(v.page, { pages: 5, page: 3, from: 21, to: 30 });
  assert.equal(v.rows.length, 10);
  assert.equal(v.rows[0].name, 'Guard 101');
});

test('state per screen: saved and read back; broken or missing storage falls back', () => {
  const box = new Map();
  const store = { getItem: (k) => box.get(k) ?? null, setItem: (k, v) => box.set(k, v) };
  const st = { q: 'ali', f: { company: 'act' }, sort: 'pay', dir: 'desc', page: 3, size: 50 };
  M.saveState('hr.staff', st, store);
  assert.deepEqual(M.loadState('hr.staff', M.DEFAULT_STATE, store), st);
  assert.deepEqual(M.loadState('other', M.DEFAULT_STATE, store), M.DEFAULT_STATE);
  box.set('prima.table.bad', '{not json');
  assert.deepEqual(M.loadState('bad', M.DEFAULT_STATE, store), M.DEFAULT_STATE);
  box.set('prima.table.odd', JSON.stringify({ q: 5, page: -2, size: 'x', dir: 'up', f: { a: 1, b: 'ok' } }));
  assert.deepEqual(M.loadState('odd', M.DEFAULT_STATE, store), { ...M.DEFAULT_STATE, f: { b: 'ok' } });
  const throwing = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.deepEqual(M.loadState('x', M.DEFAULT_STATE, throwing), M.DEFAULT_STATE);
  assert.doesNotThrow(() => M.saveState('x', st, throwing));
});

// ---------- The component, drawn to HTML ----------

const icon = () => null;
const stubs = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@phosphor-icons/react': new Proxy({}, { get: () => icon }),
  './datatable-model': M,
  './i18n': { tr: (s) => s, useLang: () => ({ lang: 'en', setLang() {} }) },
  './ui': {
    ErrorNotice: ({ error }) => (error ? React.createElement('div', { role: 'alert' }, String(error)) : null),
    Loading: ({ what }) => React.createElement('div', { className: 'empty is-loading' }, `Loading ${what}…`),
    money: (v) => (v == null || !Number.isFinite(v) ? '–' : `RM${v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
    dateLabel: (d) => d,
  },
  './SearchSelect': {
    SearchSelect: ({ value, options, ...rest }) =>
      React.createElement('select', { value, 'aria-label': rest['aria-label'], onChange() {} }, options.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label))),
  },
};
stubs['./kit'] = load('kit.tsx', stubs);
const { DataTable } = load('DataTable.tsx', stubs);

const columns = [
  { id: 'name', label: 'Name', value: (r) => r.name, phone: 'title' },
  { id: 'company', label: 'Company', value: (r) => r.company, phone: 'sub' },
  { id: 'status', label: 'Status', value: (r) => r.status, render: (r) => React.createElement('span', { className: 'chip' }, r.status) },
  { id: 'joined', label: 'Joined', value: (r) => r.joined, sort: 'date' },
  { id: 'pay', label: 'Basic pay', value: (r) => r.pay, sort: 'money', hideBelow: 1600 },
  { id: 'note', label: 'Note', value: () => 'x', phone: 'hidden' },
];
const draw = (props) => renderToStaticMarkup(React.createElement(DataTable, { label: 'Staff', rowKey: (r) => r.id, columns, rows: people, ...props }));

test('computer table: sortable headings, right-aligned money as RM, narrow screens drop hideBelow columns, counts', () => {
  const html = draw({ layout: 'table', defaults: { sort: 'pay', dir: 'desc' } });
  assert.match(html, /<table class="dt-table"/);
  assert.match(html, /<caption[^>]*>Staff<\/caption>/);
  // Sorted by a column narrow screens leave out: the rows still follow it.
  assert.doesNotMatch(html, /aria-sort=/);
  assert.match(draw({ layout: 'table', defaults: { sort: 'joined', dir: 'desc' } }), /aria-sort="descending"><button type="button" class="dt-sort" data-on="true"><span>Joined/);
  // 1366 px (the default width without a window): the pay column (hideBelow 1600) is left out.
  assert.doesNotMatch(html, /Basic pay/);
  assert.match(html, />1–4 of 4</);
  const order = [...html.matchAll(/<tr[^>]*><td[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(order, ['Dewi Sartika', 'Aminah binti Ali', 'Badrul Hisham', 'Chong Wei']);
  const wide = renderToStaticMarkup(React.createElement(DataTable, { label: 'Staff', rowKey: (r) => r.id, columns: columns.map((c) => ({ ...c, hideBelow: undefined })), rows: people, layout: 'table' }));
  assert.match(wide, /<td data-align="right">RM2,500.00<\/td>/);
  assert.match(wide, /<td data-align="right">–<\/td>/);
});

test('filters show only when there is a choice; search and filters narrow the rows; nothing found offers Clear', () => {
  const filters = [
    { id: 'company', label: 'Company', value: (r) => r.company, optionLabel: (v) => v.toUpperCase() },
    { id: 'one', label: 'Only one', value: () => 'same' },
  ];
  const html = draw({ layout: 'table', filters, defaults: { f: { company: 'pwvsb' } } });
  assert.match(html, /<select[^>]*aria-label="Company"/);
  assert.doesNotMatch(html, /Only one/);
  assert.match(html, /<option value="pwvsb" selected="">PWVSB<\/option>/);
  assert.match(html, />1–2 of 2</);
  assert.match(html, />Clear</);
  const none = draw({ layout: 'table', filters, defaults: { q: 'zzz' } });
  assert.match(none, /Nothing matches your search or filters\./);
  assert.match(none, /Clear search and filters/);
});

test('paging controls: page size and numbered pages appear once the rows outgrow the smallest page', () => {
  const many = Array.from({ length: 245 }, (_, i) => ({ ...people[i % 4], id: String(i), name: `Guard ${String(i).padStart(3, '0')}` }));
  const html = draw({ layout: 'table', rows: many, defaults: { page: 2, sort: 'name' } });
  assert.match(html, />26–50 of 245</);
  assert.match(html, /aria-current="page"[^>]*>2</);
  assert.match(html, /aria-label="Rows per page"/);
  assert.match(html, />10<\/button>/);
  assert.equal((html.match(/<tbody>.*<\/tbody>/s)[0].match(/<tr/g) ?? []).length, 25);
  const few = draw({ layout: 'table' });
  assert.doesNotMatch(few, /Rows per page/);
});

test('phone cards: title, grey sub line, up to four facts, hidden columns left out, actions, no table', () => {
  const html = draw({
    layout: 'cards',
    onRowClick() {},
    actions: (r) => [
      { label: 'Edit', onClick() {} },
      { label: 'Remove', tone: 'danger', onClick() {}, hidden: r.id === '2' },
    ],
  });
  assert.doesNotMatch(html, /<table/);
  assert.equal((html.match(/<li class="dt-card"/g) ?? []).length, 4);
  assert.match(html, /<button type="button" class="dt-card-open"><span class="dt-card-line">Aminah binti Ali<\/span><\/button><span class="dt-card-sub">pwvsb<\/span>/);
  const first = html.split('<li ')[1];
  assert.deepEqual([...first.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]), ['Status', 'Joined', 'Basic pay']);
  assert.doesNotMatch(first, /Note/);
  // Two actions: a menu button; one action left (the second row): a plain button.
  assert.match(first, /aria-label="More actions"/);
  const second = html.split('<li ')[2];
  assert.match(second, />Edit<\/button>/);
  assert.doesNotMatch(second, /More actions/);
  // Phones sort from a pick-list (there are no headings to tap).
  assert.match(html, /aria-label="Sort by"/);
  assert.match(html, /data-layout="cards"/);
  const capped = draw({ layout: 'cards', phoneFacts: 2 });
  assert.deepEqual([...capped.split('<li ')[1].matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]), ['Status', 'Joined']);
});

test('loading, error and empty states; row ticks only with a selection', () => {
  assert.match(draw({ rows: null, loading: true, loadingWhat: 'staff' }), /Loading staff…/);
  assert.match(draw({ rows: [], error: 'Server down' }), /role="alert">Server down/);
  assert.match(draw({ rows: [] }), /Nothing here yet\./);
  assert.match(draw({ rows: [], empty: React.createElement('p', null, 'No staff yet.') }), /No staff yet\./);
  assert.doesNotMatch(draw({ layout: 'table' }), /type="checkbox"/);
  const ticks = draw({ layout: 'table', selection: { selected: new Set(['1']), onChange() {}, canSelect: (r) => r.id !== '4' }, bulk: React.createElement('button', null, 'Approve ticked') });
  assert.equal((ticks.match(/type="checkbox"/g) ?? []).length, 4);
  assert.match(ticks, />1 ticked</);
  assert.match(ticks, /Approve ticked/);
});
