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

// The model writes CSV with core's own toCsv (the same as the importer's templates).
const core = { toCsv: load('../../../packages/core/src/import-align.ts').toCsv };
const M = load('datatable-model.ts', { '@prima/core': core });

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
    Drawer: ({ title, children }) => React.createElement('aside', { className: 'drawer' }, React.createElement('h2', null, title), children),
    RefreshContext: React.createContext({ version: 0, bump() {} }),
    notify() {},
  },
  './drawer-focus': { activateDrawer: () => () => {} },
  './back-close': { useBackClose() {} },
  '@prima/core': core,
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

// ---------- P107b: export, the standard row actions, delete with confirmation ----------

const { DeleteDialog } = load('DataTable.tsx', stubs);

test('export: plain values per column (money with two decimals, dates as typed), opt-outs, headings and statuses in the screen language', () => {
  const ex = [
    { id: 'name', label: 'Name', value: (r) => r.name },
    { id: 'status', label: 'Status', value: (r) => r.status, translate: true },
    { id: 'joined', label: 'Joined', value: (r) => r.joined, sort: 'date' },
    { id: 'pay', label: 'Basic pay', value: (r) => r.pay, sort: 'money' },
    { id: 'chips', label: 'Chips', render: () => 'x' },
    { id: 'secret', label: 'IC', value: () => '900101-01-1234', exportValue: false },
    { id: 'count', label: 'Units', exportValue: (r) => r.companies.length, render: () => 'n' },
  ];
  const grid = M.exportGrid(people, ex);
  assert.deepEqual(grid[0], ['Name', 'Status', 'Joined', 'Basic pay', 'Units']);
  assert.deepEqual(grid[1], ['Aminah binti Ali', 'Active', '2024-03-01', '2500.00', '2']);
  assert.deepEqual(grid[3], ['Chong Wei', 'Active', '2025-07-20', '', '1']);
  const bm = M.exportGrid(people, ex, (s) => ({ Name: 'Nama', 'Basic pay': 'Gaji pokok', ...BM })[s] ?? s);
  assert.deepEqual(bm[0].slice(0, 4), ['Nama', 'Status', 'Joined', 'Gaji pokok']);
  assert.equal(bm[4][1], 'Bercuti');
  // Names are never translated, only columns marked translate.
  assert.equal(bm[1][0], 'Aminah binti Ali');
  assert.equal(M.exportCell(0, 'number'), '0');
  assert.equal(M.exportCell(NaN, 'money'), '');
});

test('export: CSV with a byte-order mark for Excel, quotes, commas, new lines and Malay text kept', () => {
  const text = M.csvText([
    ['Nama', 'Nota'],
    ['Siti "Ana" binti Ahmad', 'Tapak A, Shah Alam'],
    ['Pengawal', 'baris 1\nbaris 2'],
    ['Kedai Mamak Ré', ' ruang '],
  ]);
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.equal(
    text.slice(1),
    'Nama,Nota\r\n"Siti ""Ana"" binti Ahmad","Tapak A, Shah Alam"\r\nPengawal,"baris 1\nbaris 2"\r\nKedai Mamak Ré," ruang "\r\n',
  );
  assert.equal(M.csvName('Site list', new Date(2026, 10, 16)), 'site-list-2026-11-16.csv');
  assert.equal(M.csvName('Stock by owner, holder and condition', new Date(2026, 0, 5)), 'stock-by-owner-holder-and-condition-2026-01-05.csv');
  assert.equal(M.csvName('***', new Date(2026, 0, 5)), 'list-2026-01-05.csv');
});

test('export rows: every row found (all pages, in the order shown); only the ticked ones when some are ticked', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: String(i + 1), name: `Guard ${i + 1}`, status: i % 2 ? 'Active' : 'Left' }));
  const c = [{ id: 'name', value: (r) => r.name }];
  const f = [{ id: 'status', value: (r) => r.status }];
  const v = M.viewRows(many, c, f, { ...M.DEFAULT_STATE, f: { status: 'Active' }, size: 10, page: 2 }, (r) => M.haystack(r, c, null));
  assert.equal(v.rows.length, 10);
  const key = (r) => r.id;
  assert.equal(M.exportRows(v.all, many, null, key).length, 30);
  assert.equal(M.exportRows(v.all, many, new Set(), key).length, 30);
  // Ticked: the found ones in their order, then a ticked row the filter now hides.
  assert.deepEqual(M.exportRows(v.all, many, new Set(['6', '2', '1']), key).map(key), ['2', '6', '1']);
});

test("row actions: View, Edit, the screen's own, then Delete last; Edit and Delete only where the row allows", () => {
  const calls = [];
  const opts = {
    view: (r) => calls.push(['view', r.id]),
    edit: (r) => calls.push(['edit', r.id]),
    editLabel: 'Edit site',
    canEdit: (r) => r.status !== 'Left',
    remove: (r) => calls.push(['del', r.id]),
    deleteLabel: 'Close site',
    canDelete: (r) => r.id === '1',
    extra: [{ label: 'Fittings', onClick() {} }, { label: 'Hidden', onClick() {}, hidden: true }],
  };
  const a1 = M.standardActions(people[0], opts);
  assert.deepEqual(a1.map((a) => a.label), ['View', 'Edit site', 'Fittings', 'Close site']);
  assert.equal(a1.at(-1).tone, 'danger');
  a1[0].onClick();
  a1[3].onClick();
  assert.deepEqual(calls, [['view', '1'], ['del', '1']]);
  assert.deepEqual(M.standardActions(people[1], opts).map((a) => a.label), ['View', 'Fittings']);
  assert.deepEqual(M.standardActions(people[0], {}), []);
  // Drawn: one allowed action is a plain button (Delete in red); several make the menu.
  const html = draw({ layout: 'table', exportable: false, onEdit() {}, canEdit: (r) => r.id === '3', onDelete: async () => {}, canDelete: (r) => r.id === '2' });
  const rowsHtml = html.match(/<tbody>.*<\/tbody>/s)[0].split('<tr').slice(1);
  assert.match(rowsHtml.find((r) => r.includes('Badrul')), /class="btn btn-sm dt-act dt-danger"[^>]*>Delete</);
  assert.match(rowsHtml.find((r) => r.includes('Chong')), />Edit<\/button>/);
  assert.doesNotMatch(rowsHtml.find((r) => r.includes('Aminah')), /class="btn btn-sm dt-act|More actions/);
  const both = draw({ layout: 'cards', onView() {}, onEdit() {}, onDelete: async () => {} });
  assert.equal((both.match(/aria-label="More actions"/g) ?? []).length, 4);
  // A screen with no detail view gets the read-only drawer: the row opens it (clickable), View is the one action.
  const det = draw({ layout: 'table', details: true });
  assert.match(det, /<tr class="clickable" tabindex="0">/);
  assert.match(det, /class="btn btn-sm dt-act"[^>]*>View</);
});

test('toolbar: Export on by default (off with exportable={false}), Add and Import when the screen gives them; ticks show Export ticked and Delete ticked', () => {
  const plain = draw({ layout: 'table' });
  assert.match(plain, /class="btn dt-export"[^>]*>Export<\/button>/);
  assert.doesNotMatch(draw({ layout: 'table', exportable: false }), /dt-export/);
  assert.doesNotMatch(draw({ rows: [] }), /dt-export/);
  const tools = draw({ layout: 'table', onAdd() {}, addLabel: 'Add site', onImport() {}, importLabel: 'Import item list (Excel, CSV, PDF)' });
  assert.match(tools, /class="btn btn-primary"[^>]*>Add site<\/button>/);
  assert.match(tools, />Import item list \(Excel, CSV, PDF\)<\/button>/);
  // Add shows even on an empty list (the first record).
  assert.match(draw({ rows: [], onAdd() {}, addLabel: 'Add site' }), />Add site</);
  const ticked = draw({ layout: 'table', selection: { selected: new Set(['1', '2']), onChange() {} }, onDelete: async () => {}, canDelete: (r) => r.id !== '2' });
  assert.match(ticked, />2 ticked</);
  assert.match(ticked, />Export ticked</);
  assert.match(ticked, />Delete ticked</);
  assert.match(ticked, />Untick all</);
  // Selectable without a delete: the table keeps its own ticks (none yet, so no bar), boxes are drawn.
  const own = draw({ layout: 'table', selectable: true });
  assert.equal((own.match(/type="checkbox"/g) ?? []).length, 5);
  assert.doesNotMatch(own, /dt-bulk/);
});

test('delete dialog: names the record, asks for a reason when the screen needs one, the confirm waits for it; several say how many', () => {
  const one = renderToStaticMarkup(React.createElement(DeleteDialog, { names: ['Tapak Bangsar'], label: 'Close site', reasonRequired: true, run: async () => ({ done: [], failed: [] }), onClose() {} }));
  assert.match(one, /role="alertdialog"/);
  assert.match(one, /<span>Close site<\/span> <q data-no-translate="true">Tapak Bangsar<\/q>\?/);
  assert.match(one, /Reason \(needed, 5 characters or more\)/);
  assert.match(one, /<button type="button" class="btn btn-danger" disabled=""/);
  const many = renderToStaticMarkup(
    React.createElement(DeleteDialog, { names: Array.from({ length: 12 }, (_, i) => `Item ${i + 1}`), label: 'Delete', reasonRequired: false, run: async () => ({ done: [], failed: [] }), onClose() {} }),
  );
  assert.match(many, /Delete 12 records\?/);
  assert.equal((many.match(/<li>Item/g) ?? []).length, 5);
  assert.match(many, /and 7 more/);
  assert.doesNotMatch(many, /Reason/);
  assert.match(many, /<button type="button" class="btn btn-danger">/);
  assert.equal(M.reasonOk('ok', true), false);
  assert.equal(M.reasonOk('  wrong site  ', true), true);
  assert.equal(M.reasonOk('', false), true);
});

test("bulk delete: each row through the screen's own action, refusals counted and named, one refusal does not stop the rest", async () => {
  const seen = [];
  const out = await M.runEach(
    people,
    async (r) => {
      seen.push(r.id);
      if (r.status === 'Active') throw new Error(`${r.name} has open shifts`);
    },
    (r) => r.id,
    (r) => r.name,
  );
  assert.deepEqual(seen, ['1', '2', '3', '4']);
  assert.deepEqual(out.done, ['2', '4']);
  assert.deepEqual(out.failed, [
    { key: '1', name: 'Aminah binti Ali', error: 'Aminah binti Ali has open shifts' },
    { key: '3', name: 'Chong Wei', error: 'Chong Wei has open shifts' },
  ]);
  // The screen's own call for many: its { done, failed }, nothing (all done), or a refusal of the lot.
  const key = (r) => r.id;
  const name = (r) => r.name;
  assert.deepEqual(await M.runBulk(people, async () => ({ done: ['1', '2', '3'], failed: [{ key: '4', error: 'Locked' }] }), key, name), {
    done: ['1', '2', '3'],
    failed: [{ key: '4', name: 'Dewi Sartika', error: 'Locked' }],
  });
  assert.deepEqual((await M.runBulk(people, async () => undefined, key, name)).done, ['1', '2', '3', '4']);
  const refused = await M.runBulk(people, async () => {
    throw new Error('Not allowed');
  }, key, name);
  assert.equal(refused.done.length, 0);
  assert.equal(refused.failed.length, 4);
  assert.equal(refused.failed[2].error, 'Not allowed');
});
