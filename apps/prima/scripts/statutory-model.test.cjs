// P98: the statutory rates screen was laid out again (Fitri, 11 Nov 2026). These checks prove the numbers did not move:
// an untouched form sends back exactly the rates in force, the same typing sends what the pre-P98 form sent, the screen
// never lets through what the server's check refuses, and core's own service stores and reads the result unchanged.
// Synthetic data only. Needs `npm run build -w @prima/core`. Run: node --test scripts/statutory-model.test.cjs (from apps/prima).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const core = require('../packages/core/dist/index.js');

const load = (file, req) => {
  const exports = {};
  const src = fs.readFileSync(path.join(__dirname, '../apps/web/src/views', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: req, document: { getElementById: () => null, querySelector: () => null } });
  return exports;
};
const raw = load('statutory-model.ts', (id) => {
  if (id === '@prima/core') return core;
  throw Error(id);
});
// The model runs in its own context: plain copies of what it returns, so deepEqual compares values, not realms.
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const m = Object.fromEntries(Object.entries(raw).map(([k, f]) => [k, typeof f !== 'function' || ['settingsOf', 'otherOf', 'fromPct', 'fromNum'].includes(k) ? f : (...a) => plain(f(...a))]));
const D = core.DEFAULT_STATUTORY;
const clone = (x) => JSON.parse(JSON.stringify(x));

const SAMPLE = {
  ...clone(D),
  epf: { ...D.epf, eeRate: 0.115, erRateLow: 0.135, erLimit: 5500, bands: false, olderAge: 61 },
  // Rates as the form makes them (typed percent / 100), as every stored version was made.
  socso: { ...D.socso, eeRate: Number('0.55') / 100, wageCap: 6500.5 },
  eis: { ...D.eis, maxAge: 61, malaysiansOnly: false },
  lindung: { rate: 0.0125, wageCap: 6000 },
  hrd: { rate: 0.005, malaysiansOnly: false },
  others: [
    { code: 'NEWFUND', name: 'Synthetic new fund', eeRate: 0.01, erRate: 0.015, wageCap: 4000, includeOt: true, appliesTo: 'malaysian', maxAge: 60, payee: 'Synthetic agency' },
    { code: 'LEVY2', name: 'Synthetic levy', eeRate: 0, erRate: 0.0025, wageCap: null, includeOt: false, appliesTo: 'all', maxAge: null, payee: 'Synthetic board' },
  ],
  lawRef: 'Synthetic gazette reference 2027',
};

test('an untouched form sends back exactly the settings it started from', () => {
  for (const s of [D, SAMPLE]) {
    const out = m.settingsOf(s, m.draftOf(s), s.others.map(m.otherDraftOf), s.lawRef);
    assert.deepEqual(clone(out), clone(s));
    assert.equal(core.statutoryProblem(out), null);
  }
});

test('every rate from 0% to 50% in 0.005% steps reads back to the same fraction', () => {
  for (let k = 0; k <= 10000; k++) {
    const typed = String(k / 200);
    const x = Number(typed) / 100;
    assert.equal(m.fromPct(m.pctInput(x)), x, typed);
  }
});

// The pre-P98 form's save, copied verbatim from GuardPay.tsx at 96e868f (StatForm), with its own pct and fromPct.
const pct = (n) => (n == null ? '' : String(Math.round(n * 100000) / 1000));
const fromPctOld = (v) => (v.trim() === '' ? NaN : Number(v) / 100);
function beforeP98(start, f, others, lawRef) {
  return {
    ...start,
    epf: { ...start.epf, eeRate: fromPctOld(f.epfEe), erRateLow: fromPctOld(f.epfErLow), erRateHigh: fromPctOld(f.epfErHigh), erLimit: Number(f.epfLimit), foreignEeRate: fromPctOld(f.epfForeignEe), foreignErRate: fromPctOld(f.epfForeignEr) },
    socso: { ...start.socso, eeRate: fromPctOld(f.socsoEe), erRate: fromPctOld(f.socsoEr), wageCap: Number(f.socsoCap) },
    eis: { ...start.eis, eeRate: fromPctOld(f.eisEe), erRate: fromPctOld(f.eisEr), wageCap: Number(f.eisCap) },
    lindung: { ...start.lindung, rate: f.lindung.trim() === '' ? null : fromPctOld(f.lindung) },
    hrd: { ...start.hrd, rate: fromPctOld(f.hrd) },
    others,
    lawRef,
  };
}
const OLD_KEYS = { epfEe: 'epf.eeRate', epfErLow: 'epf.erRateLow', epfErHigh: 'epf.erRateHigh', epfLimit: 'epf.erLimit', epfForeignEe: 'epf.foreignEeRate', epfForeignEr: 'epf.foreignErRate', socsoEe: 'socso.eeRate', socsoEr: 'socso.erRate', socsoCap: 'socso.wageCap', eisEe: 'eis.eeRate', eisEr: 'eis.erRate', eisCap: 'eis.wageCap', lindung: 'lindung.rate', hrd: 'hrd.rate' };
const oldStart = (s) => ({ epfEe: pct(s.epf.eeRate), epfErLow: pct(s.epf.erRateLow), epfErHigh: pct(s.epf.erRateHigh), epfLimit: String(s.epf.erLimit), epfForeignEe: pct(s.epf.foreignEeRate), epfForeignEr: pct(s.epf.foreignErRate), socsoEe: pct(s.socso.eeRate), socsoEr: pct(s.socso.erRate), socsoCap: String(s.socso.wageCap), eisEe: pct(s.eis.eeRate), eisEr: pct(s.eis.erRate), eisCap: String(s.eis.wageCap), lindung: pct(s.lindung.rate), hrd: pct(s.hrd.rate) });

const typings = [
  ['nothing typed', {}],
  ['the 2027 style EPF change', { epfEe: '12', epfErLow: '14', epfErHigh: '13', epfLimit: '6000' }],
  ['SOCSO and EIS caps raised', { socsoCap: '7000', eisCap: '7000', socsoEr: '1.85' }],
  ['LINDUNG set by the CEO', { lindung: '1' }],
  ['LINDUNG back to the rule', { lindung: '' }],
  ['foreign workers and HRD', { epfForeignEe: '2.5', epfForeignEr: '3', hrd: '0.5' }],
  ['spaces around the numbers', { epfEe: ' 11 ', socsoCap: ' 6000 ' }],
  ['thousandths of a percent', { socsoEe: '0.525', eisEr: '0.215' }],
  ['a box emptied', { eisEe: '' }],
  ['letters typed', { hrd: 'abc', epfLimit: 'x' }],
];
for (const [name, typed] of typings)
  for (const [startName, start] of [['the law as at November 2026', D], ['a later version', SAMPLE]])
    test(`same settings sent as before P98: ${name}, from ${startName}`, () => {
      const f = { ...oldStart(start), ...typed };
      const d = m.draftOf(start);
      for (const [k, v] of Object.entries(typed)) d[OLD_KEYS[k]] = v;
      const others = start.others.map(m.otherDraftOf);
      assert.deepEqual(clone(m.settingsOf(start, d, others, 'Synthetic law ref')), clone(beforeP98(start, f, start.others, 'Synthetic law ref')));
      // NaN does not survive JSON: compare the numbers one by one too.
      const a = m.settingsOf(start, d, others, 'Synthetic law ref');
      const b = beforeP98(start, f, start.others, 'Synthetic law ref');
      for (const k of Object.values(OLD_KEYS)) {
        const [s, p] = k.split('.');
        assert.ok(Object.is(a[s][p], b[s][p]), `${k}: ${a[s][p]} vs ${b[s][p]}`);
      }
    });

test('only typing the old form refused is read differently, and only to be checked: commas in ringgit, a % sign', () => {
  const d = m.draftOf(D);
  d['epf.erLimit'] = 'RM 6,000';
  d['epf.eeRate'] = '12%';
  const out = m.settingsOf(D, d, [], 'x');
  assert.equal(out.epf.erLimit, 6000);
  assert.equal(out.epf.eeRate, 0.12);
  // A comma is never read as a decimal point in a rate: "1,75" is refused, not 175%.
  assert.ok(Number.isNaN(m.fromPct('1,75')));
  assert.match(m.fieldProblem(m.FIELDS.find((f) => f.key === 'socso.erRate'), '1,75'), /rate in percent/);
});

// A small seeded random source, so the run is the same every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
test('the screen never lets through settings the server check refuses (2,000 random forms)', () => {
  const r = rng(98);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const RATE = ['0', '11', '1.75', '50', '50.5', '-1', '', 'x', '0.2', '1,5', '12%'];
  const MONEY = ['6000', '0', '-5', '', '1000000', '1000001', 'RM 5,000', 'abc', '4000.50'];
  const AGE = ['60', '14', '13', '100', '101', '60.5', '', '18', '61'];
  let passed = 0;
  for (let k = 0; k < 2000; k++) {
    const d = m.draftOf(D);
    for (const f of m.FIELDS) {
      if (r() < 0.85) continue;
      d[f.key] = f.kind === 'flag' ? pick(['yes', 'no']) : f.kind === 'money' ? pick(MONEY) : f.kind === 'age' ? pick(AGE) : pick(RATE);
    }
    const others = r() < 0.3 ? [{ ...m.BLANK_OTHER, code: pick(['NEWFUND', 'EPF', 'x', '']), name: pick(['Synthetic fund', 'ab']), eeRate: pick(RATE), erRate: pick(RATE), wageCap: pick(MONEY), maxAge: pick(AGE), payee: pick(['Synthetic agency', '']) }] : [];
    const problems = m.draftProblems(D, d, others, 'Synthetic law ref', 'Synthetic reason', '2026-11', '2026-10');
    const server = core.statutoryProblem(m.settingsOf(D, d, others, 'Synthetic law ref'));
    if (server) assert.ok(problems.length > 0, `server refuses (${server}) but the screen had nothing to fix`);
    if (!problems.length) {
      assert.equal(server, null);
      passed++;
    }
  }
  assert.ok(passed > 50, `some random forms were good (${passed})`);
});

test('the month, the law reference and the reason are checked as the server does', () => {
  const d = m.draftOf(D);
  const t = (args) => m.draftProblems(D, d, [], ...args).map((p) => p.text);
  assert.deepEqual(t(['Synthetic law ref', 'Synthetic reason', '2026-11', '2026-10']), []);
  assert.ok(t(['Synthetic law ref', 'Synthetic reason', '2026-09', '2026-10']).includes('A change can start from last month at the earliest.'));
  assert.ok(t(['Synthetic law ref', 'Synthetic reason', '2026-13', '2026-10']).includes('Pick the month the change starts.'));
  assert.ok(t(['abc', 'Synthetic reason', '2026-11', '2026-10']).includes('Give the law or gazette reference.'));
  assert.ok(t(['Synthetic law ref', 'no', '2026-11', '2026-10']).includes('Say why the rates change.'));
});

test('rates read as 11% and 1.75%, money as RM 5,000 or RM 6,500.50', () => {
  assert.equal(m.pctText(0.11), '11%');
  assert.equal(m.pctText(0.0175), '1.75%');
  assert.equal(m.pctText(0.005), '0.5%');
  assert.equal(m.pctText(0), '0%');
  assert.equal(m.pctText(null), '');
  assert.equal(m.rmText(5000), 'RM 5,000');
  assert.equal(m.rmText(6500.5), 'RM 6,500.50');
  assert.equal(m.monthText('2027-01'), 'Jan 2027');
  assert.equal(m.prevMonth('2027-01'), '2026-12');
});

test('the tables show the law as at November 2026 as the pay run counts it', () => {
  const v = Object.fromEntries(m.schemeViews(D, '2026-11').map((x) => [x.id, x]));
  assert.deepEqual(
    v.epf.rows.map((r) => [r.who, r.note, r.ee, r.er]),
    [
      ['Malaysian workers', 'Wages up to RM 5,000', '11%', '13%'],
      ['Malaysian workers', 'Wages above RM 5,000', '11%', '12%'],
      ['Aged 60 and over', 'Malaysian workers', '0%', '4%'],
      ['Foreign workers', 'All ages', '2%', '2%'],
    ],
  );
  assert.deepEqual(v.socso.rows.map((r) => [r.who, r.ee, r.er]), [['Under 60', '0.5%', '1.75%'], ['Aged 60 and over', '0%', '1.25%']]);
  assert.deepEqual(v.eis.rows.map((r) => [r.who, r.note, r.ee, r.er]), [['Ages 18 to 59', 'Malaysians only', '0.2%', '0.2%']]);
  // LINDUNG: the dated rule, with the rate core's lindungShare uses this month marked.
  const now = v.lindung.rows.find((r) => r.now);
  assert.equal(now.ee, m.pctText(core.lindungShare(1000, '2026-11', 'MY', false).rate));
  assert.equal(v.lindung.rows.length, core.RULES.lindung.value.rates.length);
  assert.deepEqual(v.hrd.rows.map((r) => [r.who, r.ee, r.er]), [['Malaysian employees', 'None', '1%']]);
  // The CEO's own LINDUNG rate replaces the rule's rows.
  const set = m.schemeViews(SAMPLE, '2026-11').find((x) => x.id === 'lindung');
  assert.deepEqual(set.rows.map((r) => r.ee), ['1.25%']);
  // The glance agrees with the tables.
  assert.deepEqual(m.glance(D, '2026-11').slice(0, 5).map((g) => [g.label, g.ee, g.er]), [['EPF', '11%', '13%'], ['SOCSO', '0.5%', '1.75%'], ['EIS', '0.2%', '0.2%'], ['LINDUNG', '0.75%', 'None'], ['HRD', 'None', '1%']]);
});

const ver = (id, from, settings, at, replacedBy = null) => ({ id, effectiveFrom: from, settings, reason: 'Synthetic reason', setBy: 'Synthetic CEO', setById: 'u-x', setAt: at, replacedBy });
test('the history marks what is in force, what is coming and what was replaced, and what each one changed', () => {
  const a = ver('a', '2026-10', { ...clone(D), epf: { ...D.epf, eeRate: 0.12 } }, '2026-10-01T01:00:00Z');
  const b0 = ver('b0', '2027-01', { ...clone(D), epf: { ...D.epf, eeRate: 0.13 } }, '2026-11-01T01:00:00Z', 'b1');
  const b1 = ver('b1', '2027-01', { ...clone(D), epf: { ...D.epf, eeRate: 0.12 }, socso: { ...D.socso, wageCap: 7000 } }, '2026-11-02T01:00:00Z');
  const versions = [b1, b0, a];
  const h = m.history(versions, '2026-11');
  assert.deepEqual(h.map((x) => [x.v.id, x.state]), [['b1', 'scheduled'], ['b0', 'replaced'], ['a', 'in_force']]);
  assert.deepEqual(h[2].changes.map((c) => [c.key, c.before, c.after]), [['epf.eeRate', '11%', '12%']]);
  assert.deepEqual(h[0].changes.map((c) => [c.key, c.before, c.after]), [['socso.wageCap', 'RM 6,000', 'RM 7,000']]);
  assert.equal(m.versionFor(versions, '2026-11').id, 'a');
  assert.equal(m.nextChange(versions, '2026-11').id, 'b1');
  // A change from January starts from what January would use (b1), as the pay run would read it.
  assert.deepEqual(clone(m.startFor(versions, '2027-01')), clone(core.statutoryFor(versions, '2027-01')));
  // New contributions: added, changed and removed are all listed.
  const ch = m.changes(D, SAMPLE).filter((c) => c.key.startsWith('other.'));
  assert.deepEqual(ch.map((c) => [c.key, c.before]), [['other.NEWFUND', 'None'], ['other.LEVY2', 'None']]);
  assert.deepEqual(m.changes(SAMPLE, D).filter((c) => c.key.startsWith('other.')).map((c) => c.after), ['Removed', 'Removed']);
});

test('core stores what the screen sends and reads it back for that month unchanged', async () => {
  const now = core.myt('2026-11-11', '10:00');
  const ds = core.generateDataset({ today: '2026-11-11', now });
  const store = new core.MemoryStore(ds);
  const svc = new core.PrimaService(store, () => now);
  const ceo = ds.users.find((u) => u.opsTier === 'ceo' && !u.integration);
  const board = await svc.statutoryBoard(ceo);
  assert.equal(board.canSet, true);
  const d = m.draftOf(board.inForce);
  d['epf.eeRate'] = '12';
  d['socso.wageCap'] = 'RM 7,000';
  d['lindung.rate'] = '1';
  const others = [{ ...m.otherDraftOf(SAMPLE.others[0]) }];
  const settings = m.settingsOf(board.inForce, d, others, 'Synthetic gazette 2027');
  assert.deepEqual(m.draftProblems(board.inForce, d, others, 'Synthetic gazette 2027', 'Synthetic reason', '2027-01', '2026-10'), []);
  await svc.setStatutory(ceo, { effectiveFrom: '2027-01', reason: 'Synthetic reason', settings });
  const after = await svc.statutoryBoard(ceo);
  assert.deepEqual(clone(after.inForce), clone(board.inForce), 'this month is unchanged');
  const jan = core.statutoryFor(after.versions, '2027-01');
  assert.deepEqual(clone(jan), clone(settings));
  assert.equal(jan.epf.eeRate, 0.12);
  assert.equal(jan.socso.wageCap, 7000);
  assert.equal(jan.lindung.rate, 0.01);
  const h = m.history(after.versions, after.month);
  assert.equal(h[0].state, 'scheduled');
  assert.deepEqual(h[0].changes.map((c) => c.key), ['epf.eeRate', 'socso.wageCap', 'lindung.rate', 'other.NEWFUND']);
  // Who may set is unchanged: only the CEO.
  const hr = ds.users.find((u) => u.department === 'hr' && !u.opsTier);
  assert.ok(hr, 'an HR user in the synthetic data');
  await assert.rejects(() => svc.setStatutory(hr, { effectiveFrom: '2027-01', reason: 'Synthetic reason', settings }), /CEO/);
});

// The screen itself: a stand-in React draws the board once from the one read; only the CEO sees "Change rates".
function render(board) {
  let cursor = 0;
  const state = [];
  const jsx = (type, props) => ({ type, props: props || {} });
  const view = load('StatutoryRates.tsx', (id) => {
    if (id === 'react')
      return {
        useState: (v) => {
          const i = cursor++;
          if (!(i in state)) state[i] = typeof v === 'function' ? v() : v;
          return [state[i], (x) => (state[i] = typeof x === 'function' ? x(state[i]) : x)];
        },
      };
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (id === '@prima/core') return core;
    if (id === '../api') return { api: { statutoryBoard: () => Promise.resolve(board) } };
    if (id === '../ui') return { Chip: (p) => jsx('span', p), ErrorNotice: () => null, Loading: () => 'Loading', dateTimeLabel: (t) => t, useAction: () => ({ run: async () => undefined, busy: false, error: null }), useLoad: () => ({ data: board, error: null, reload() {} }) };
    if (id === '../i18n') return { tr: (s) => s, useLang: () => ({ lang: 'en' }) };
    if (id === './statutory-model') return m;
    if (id.endsWith('.css')) return {};
    throw Error(id);
  });
  const text = (x) => (Array.isArray(x) ? x.map(text).join(' ') : x == null || typeof x === 'boolean' ? '' : typeof x === 'object' ? (typeof x.type === 'function' ? text(x.type(x.props)) : text(x.props?.children)) : String(x));
  return text(view.StatutoryRatesView());
}
test('the board shows every scheme and the history; only the CEO sees Change rates', async () => {
  const now = core.myt('2026-11-11', '10:00');
  const ds = core.generateDataset({ today: '2026-11-11', now });
  const svc = new core.PrimaService(new core.MemoryStore(ds), () => now);
  const ceo = ds.users.find((u) => u.opsTier === 'ceo' && !u.integration);
  const board = await svc.statutoryBoard(ceo);
  const t = render(board);
  for (const w of ['EPF', 'SOCSO', 'EIS', 'LINDUNG 24 Jam', 'HRD levy', 'Employee pays', 'Employer pays', 'No change yet', 'Set on other screens', 'Change rates']) assert.ok(t.includes(w), w);
  assert.doesNotMatch(render({ ...board, canSet: false }), /Change rates/);
});
