const assert = require('node:assert/strict');
const { test } = require('node:test');
const { openPersonaChooser } = require('./browser-persona.cjs');

function fixture(initial = 'loading') {
  let state = initial;
  let wake;
  const ready = new Promise(resolve => { wake = resolve; });
  const calls = [];
  const selectors = [];
  let waitError;
  const locator = kinds => ({
    first() { return this; },
    or(other) { return locator([...kinds, ...other.kinds]); },
    kinds,
    async waitFor(options) {
      assert.deepEqual(options, { state: 'visible' });
      calls.push(`wait:${kinds.join('|')}`);
      if (state === 'loading') await ready;
      if (waitError) throw waitError;
      assert(kinds.includes(state), `Expected ${kinds} while state is ${state}`);
    },
    async isVisible() { return kinds.includes(state); },
    async click() {
      calls.push(`click:${kinds.join('|')}`);
      assert(kinds.includes(state), 'Must not click a switch that does not exist during bootstrap');
      assert.equal(state, 'switch');
      state = 'chooser';
    },
  });
  return {
    calls, selectors,
    page: {
      locator(selector) { assert.equal(selector, '.persona'); return locator(['chooser']); },
      getByRole(role, options) {
        assert.equal(role, 'button');
        selectors.push(options);
        return locator(['switch']);
      },
    },
    show(next) { state = next; wake(); },
    fail(error) { waitError = error; wake(); },
  };
}

test('delayed initial chooser does not attempt to switch an unsigned-in user', async () => {
  const f = fixture();
  const pending = openPersonaChooser(f.page, 'Tukar user');
  await Promise.resolve();
  assert.deepEqual(f.calls, ['wait:chooser|switch']);
  f.show('chooser');
  await pending;
  assert.deepEqual(f.calls, ['wait:chooser|switch', 'wait:chooser']);
  assert.deepEqual(f.selectors, [{ name: 'Tukar user', exact: true }]);
});

test('already visible chooser requires no switch action', async () => {
  const f = fixture('chooser');
  await openPersonaChooser(f.page, 'Switch person');
  assert(!f.calls.some(call => call.startsWith('click:')));
});

test('signed-in screen opens chooser exactly once and waits for it', async () => {
  const f = fixture('switch');
  await openPersonaChooser(f.page, 'Switch person');
  assert.deepEqual(f.calls, ['wait:chooser|switch', 'click:switch', 'wait:chooser']);
  assert.deepEqual(f.selectors, [{ name: 'Switch person', exact: true }]);
});

test('a delayed signed-in screen still switches after the actual UI is ready', async () => {
  const f = fixture();
  const pending = openPersonaChooser(f.page, 'Tukar user');
  await Promise.resolve();
  assert(!f.calls.some(call => call.startsWith('click:')));
  f.show('switch');
  await pending;
  assert.equal(f.calls.filter(call => call.startsWith('click:')).length, 1);
});

test('readiness timeout is reported, never swallowed or treated as a pass', async () => {
  const f = fixture();
  const failure = new Error('UI readiness timed out');
  const pending = openPersonaChooser(f.page, 'Switch person');
  f.fail(failure);
  await assert.rejects(pending, error => {
    assert.match(error.message, /Persona UI readiness failed.*Switch person/);
    assert.equal(error.cause, failure);
    return true;
  });
  assert(!f.calls.some(call => call.startsWith('click:')));
});

// Regression for the combined CRM dictionary: mixed-locale Reason now correctly becomes Sebab.
// The leave journey is an English behavior test, so all its English selectors must use that locale.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
function sourceModule(file, overrides = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => Object.hasOwn(overrides, id) ? overrides[id] : require(id), module, module.exports);
  return module.exports;
}
const leaveScript = () => fs.readFileSync(path.join(__dirname, 'hr-leave-browser-uat.cjs'), 'utf8');

test('HR leave journey pins English before reload and uses its English account controls', async () => {
  const source = leaveScript();
  const setup = source.match(/await p\.evaluate\(\(\) => \{ localStorage\.clear\(\); localStorage\.setItem\('prima\.lang', 'en'\); \}\); await p\.reload\(\);/);
  assert(setup, 'English locale must be stored after clear and before reload');
  const state = new Map([['prima.lang', 'mix'], ['prima-demo-user', 'stale-user']]);
  const events = [];
  const localStorage = { clear() { events.push('clear'); state.clear(); }, setItem(k, v) { events.push(`set:${k}:${v}`); state.set(k, v); } };
  const p = { evaluate: async fn => fn(), reload: async () => { events.push('reload'); assert.equal(state.get('prima.lang'), 'en'); } };
  await new Function('p', 'localStorage', 'return (async()=>{' + setup[0] + '})()')(p, localStorage);
  assert.deepEqual(events, ['clear', 'set:prima.lang:en', 'reload']);
  assert.match(source, /openPersonaChooser\(p, 'Switch person'\)/);
  assert.match(source, /name: 'I agree and will keep it confidential'/);
  assert.doesNotMatch(source, /Tukar user|Saya setuju dan akan rahsiakan/);
});

test('every literal HR leave role/label locator stays unchanged in English, including the Reason regression', () => {
  const { tr } = sourceModule('apps/web/src/i18n.ts');
  assert.equal(tr('Reason', 'mix'), 'Sebab');
  assert.equal(tr('Reason', 'en'), 'Reason');
  const source = leaveScript();
  const labels = [...source.matchAll(/getByLabel\('([^']+)'/g)].map(m => m[1]);
  const roles = [...source.matchAll(/getByRole\('[^']+', \{ name: '([^']+)'/g)].map(m => m[1]);
  const names = new Set([...labels, ...roles, 'My details', 'HR monitor', 'HR', 'Clock', 'Approve', 'Consent', 'Switch person']);
  assert(names.size >= 20);
  for (const name of names) assert.equal(tr(name, 'en'), name, `English locator translated: ${name}`);
});

function leaveComponents(openDecision = false) {
  const ui = {
    Chip: ({ children }) => React.createElement('span', null, children),
    ErrorNotice: () => null,
    Loading: () => null,
    notify: () => { throw Error('No effects in render contract'); },
    dateLabel: x => x,
    dateTimeLabel: x => x,
    useAction: () => ({ busy: false, error: null, run: () => { throw Error('No actions in render contract'); } }),
    useLoad: () => ({ data: { rule: { id: 'test', value: 12 }, rows: [{
      request: { id: 'synthetic', kind: 'ANNUAL', from: '2026-11-16', to: '2026-11-17', days: 2, reason: 'Synthetic', requestedAt: '2026-11-06', requestedBy: 'Synthetic', proofIds: [] },
      person: { name: 'Synthetic', staffNo: 'TEST' }, companyName: 'Synthetic', canDecide: true, staffLeave: true,
    }] }, error: null }),
  };
  const proof = sourceModule('apps/web/src/views/Proof.tsx', { '../api': { api: { mode: 'demo' } }, '../save': { saveFile: () => {} }, '../ui': ui, './Camera': { EvidenceCamera: () => null } });
  return sourceModule('apps/web/src/views/Leave.tsx', {
    '../api': { api: {} }, '../ui': ui, './Proof': proof,
    react: openDecision ? { ...React, useState: initial => React.useState(initial === false ? true : initial) } : React,
  });
}

test('annual, sick, corrected sick and HR decision renders expose every leave label and required controls', () => {
  const { LeaveForm } = leaveComponents();
  const prefill = { kind: 'ANNUAL', from: '2026-11-16', to: '2026-11-17', reason: 'Synthetic' };
  const annual = renderToStaticMarkup(React.createElement(LeaveForm, { personId: 'synthetic', prefill, onDone() {} }));
  const sick = renderToStaticMarkup(React.createElement(LeaveForm, { personId: 'synthetic', prefill: { ...prefill, kind: 'SICK' }, onDone() {} }));
  const correction = renderToStaticMarkup(React.createElement(LeaveForm, { personId: 'synthetic', prefill: { ...prefill, kind: 'SICK', correctsId: 'refused', reusedDocs: 1, clinic: 'Synthetic Clinic', illness: 'Synthetic illness', mcNo: 'MC-TEST' }, onDone() {} }));
  const { LeavePanel } = leaveComponents(true);
  const decision = renderToStaticMarkup(React.createElement(LeavePanel));
  const rendered = annual + sick + correction + decision;
  const labels = new Set([...leaveScript().matchAll(/getByLabel\('([^']+)'/g)].map(m => m[1]));
  for (const label of labels) assert(rendered.includes(`aria-label="${label}"`), `Missing rendered accessible label: ${label}`);
  assert.match(sick, /type="file"/);
  assert.match(sick, />Send request<\/button>/);
  assert.match(correction, /from the refused request is kept with this one/);
  assert.match(correction, /value="Synthetic Clinic"/);
  assert.match(correction, /value="Synthetic illness"/);
  assert.match(correction, /value="MC-TEST"/);
  assert.match(decision, />Approve<\/button>/);
  assert.match(decision, />Reject<\/button>/);
});
