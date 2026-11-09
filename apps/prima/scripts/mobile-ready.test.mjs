// P96: phone first and ready for the Android and iOS app wrapper (apps/prima/docs/P96_MOBILE_APP_READY.md).
// Run: node --test scripts/mobile-ready.test.mjs (from apps/prima). No browser: the history and the page are stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const web = (p) => new URL('../apps/web/' + p, import.meta.url);
const read = (p) => fs.readFileSync(web(p), 'utf8');

function load(file, globals = {}, modules = {}) {
  const code = ts.transpileModule(read('src/' + file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  const names = Object.keys(globals);
  new Function('require', 'module', 'exports', ...names, code)(
    (n) => {
      if (n in modules) return modules[n];
      throw Error('unexpected import ' + n);
    },
    module,
    module.exports,
    ...names.map((n) => globals[n]),
  );
  return module.exports;
}

/** A history with entries and a window that fires popstate when Back is pressed. */
function phone() {
  const listeners = [];
  const timers = [];
  const entries = [{ state: null }];
  let at = 0;
  const history = {
    get state() {
      return entries[at].state;
    },
    pushState(state) {
      entries.splice(at + 1);
      entries.push({ state });
      at++;
    },
    back() {
      if (at === 0) return;
      at--;
      const e = { type: 'popstate' };
      for (const f of listeners) f(e);
    },
  };
  const window = { addEventListener: (n, f) => n === 'popstate' && listeners.push(f) };
  const setTimeout = (f) => timers.push(f);
  const flush = () => {
    while (timers.length) timers.shift()();
  };
  return { history, window, setTimeout, flush, entries: () => entries.length, at: () => at, listeners };
}

function backClose() {
  const p = phone();
  const m = load('back-close.ts', { window: p.window, history: p.history, setTimeout: p.setTimeout }, { react: { useEffect() {}, useRef: (v) => ({ current: v }) } });
  return { ...p, ...m };
}

test("the phone's Back closes the open sheet and the screen stays", () => {
  const b = backClose();
  let closed = 0;
  b.holdBack(() => closed++);
  assert.equal(b.at(), 1);
  let screenSaw = null;
  b.window.addEventListener('popstate', (e) => (screenSaw = b.backClosedSheet(e)));
  b.history.back();
  assert.equal(closed, 1);
  assert.equal(screenSaw, true, 'App leaves the screen as it is');
});

test('closing a sheet with its own button takes its history entry off, so Back is never pressed twice', () => {
  const b = backClose();
  let closed = 0;
  const release = b.holdBack(() => closed++);
  release();
  b.flush();
  assert.equal(b.at(), 0);
  assert.equal(closed, 0, 'the sheet is not closed a second time');
  release();
  b.flush();
  assert.equal(b.at(), 0);
});

test('nested sheets: each Back closes only the top one', () => {
  const b = backClose();
  const shut = [];
  b.holdBack(() => shut.push('outer'));
  b.holdBack(() => shut.push('inner'));
  b.history.back();
  assert.deepEqual(shut, ['inner']);
  b.history.back();
  assert.deepEqual(shut, ['inner', 'outer']);
});

test('a screen change in the same tap replaces the entry: nothing extra is taken off', () => {
  const b = backClose();
  const release = b.holdBack(() => {});
  b.history.pushState({ screen: 'next' }); // the app moved to another screen
  release();
  b.flush();
  assert.equal(b.at(), 2);
});

test('list tables become cards on a phone; day and month grids keep scrolling', () => {
  const { cardable } = load('mobile.ts', {}, {});
  assert.equal(cardable(['Name', 'Company', 'Joined', 'Status'], false, [4, 4]), true);
  assert.equal(cardable(['Nama', 'Syarikat', 'Selesai', 'Jumlah'], false, [4]), true, 'Selesai and Jumlah are not days');
  assert.equal(cardable(['Site', 'Tue 10 Nov', 'Wed 11 Nov', 'Thu 12 Nov'], false, [4]), false);
  assert.equal(cardable(['Each month', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26'], false, [5]), false);
  assert.equal(cardable(['A', 'B'], false, [2]), false, 'two columns fit a phone');
  assert.equal(cardable(['Site', 'Income', 'Pay', 'EPF', 'Hostel', 'Items', 'Fee', 'Margin', 'Status', 'Note'], false, [10]), true);
  assert.equal(cardable(['A', 'B', 'C', 'D'], true, [4]), false, 'merged cells');
  assert.equal(cardable(['A', 'B', 'C', 'D'], false, [4, 2]), false, 'rows of another shape');
  assert.equal(cardable(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'], false, [13]), false);
});

test('inside the app wrapper printing and new windows fall back to saving a file', () => {
  const m = load('native.ts', {}, { './save': { saveFile: async () => null }, './ui': { notify() {} } });
  assert.equal(m.inAppShell({ Capacitor: { isNativePlatform: () => true } }), true);
  assert.equal(m.inAppShell({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/130 Mobile PrimaApp/1.0' } }), true);
  assert.equal(m.inAppShell({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36' } }), false);
  // No screen calls window.print() or opens a window itself any more, except the label sheet in a browser.
  for (const f of ['views/FinanceDashboard.tsx', 'views/Websites.tsx', 'views/ClientCodes.tsx', 'views/items/SalePapers.tsx']) {
    const s = read('src/' + f);
    assert.doesNotMatch(s, /window\.print\(\)|window\.open\(/, f);
  }
  assert.match(read('src/views/items/LabelSheet.tsx'), /if \(inAppShell\(\)\) void printPage\('Labels'\);\s+else window\.print\(\);/);
});

test('the page is ready to be wrapped: notch-aware viewport, keyboard resizing, icons, manifest, styles loaded last', () => {
  const html = read('index.html');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(html, /apple-touch-icon" sizes="180x180" href="%BASE_URL%apple-touch-icon-180\.png"/);
  const man = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(man.display, 'standalone');
  assert.equal(man.scope, './');
  assert.ok(man.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
  for (const i of man.icons) assert.ok(fs.existsSync(web('public/' + i.src)), i.src);
  assert.ok(fs.existsSync(web('public/apple-touch-icon-180.png')));
  const main = read('src/main.tsx');
  assert.ok(main.indexOf("import './styles/mobile.css'") > main.indexOf("import './styles/ux.css'"));
  assert.match(main, /startMobile\(\);/);
  const css = read('src/styles/mobile.css');
  assert.match(css, /--ctl-h-sm: 44px/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-top/);
  // Every sheet and dialog closes with the phone's Back.
  for (const [f, re] of [
    ['src/ui.tsx', /useBackClose\(true, \(\) => close\.current\(\)\)/],
    ['src/App.tsx', /useBackClose\(moreOpen/],
    ['src/App.tsx', /useBackClose\(appsOpen/],
    ['src/App.tsx', /if \(backClosedSheet\(e\)\) return;/],
    ['src/Spaces.tsx', /useBackClose\(open/],
    ['src/AlertBell.tsx', /useBackClose\(open/],
    ['src/Arisha.tsx', /useBackClose\(open, onClose\)/],
    ['src/SearchSelect.tsx', /useBackClose\(open && sheet/],
    ['src/views/FaceCheck.tsx', /useBackClose\(true/],
    ['src/views/items/Scanner.tsx', /useBackClose\(true/],
  ])
    assert.match(read(f), re, f);
});
