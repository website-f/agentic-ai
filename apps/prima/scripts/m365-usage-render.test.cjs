// Server-side render of the real Microsoft use board (rule M365-USE) with synthetic boards. No network.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const source = fs.readFileSync('apps/web/src/connections/m365/usage-panel.tsx', 'utf8');
const howto = [
  { id: 'authenticator', title: 'Microsoft Authenticator', bm: 'Pasang Authenticator', en: 'Install Authenticator', steps: [{ bm: 'Langkah satu', en: 'Step one' }, { bm: 'Langkah dua', en: 'Step two' }], link: { url: 'https://mysignins.microsoft.com/security-info', label: 'mysignins.microsoft.com' }, itHelps: 'IT sits with you for 15 minutes.' },
  { id: 'teams', title: 'Teams', bm: 'Guna Teams', en: 'Use Teams' },
  { id: 'sharepoint', title: 'SharePoint', bm: 'Buka fail bersama dalam SharePoint', en: 'Open shared files in SharePoint' },
  { id: 'labels', title: 'Labels', bm: 'Label', en: 'Label' },
];
function render(board, askIt) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const ui = { Chip: ({ children }) => React.createElement('span', { className: 'chip' }, children), Kpi: ({ label, value }) => React.createElement('div', null, `${label}: ${value}`) };
  vm.runInNewContext(code, { exports, require: (id) => (id === 'react' ? React : id === 'react/jsx-runtime' ? require('react/jsx-runtime') : id === '../../ui' ? ui : {}) });
  return renderToStaticMarkup(React.createElement(exports.UsageView, { board, askIt }));
}
const snap = { asOf: '2026-11-23', refreshed: '2026-11-21', namesHidden: false };

test('not installed and no reading say so; nothing is shown as done', () => {
  const html = render({ on: false, installed: false, snapshot: null, howto });
  assert.match(html, /Not installed yet/);
  assert.doesNotMatch(html, /Siap \/ Done/);
  assert.match(render({ on: true, installed: true, snapshot: null, howto }), /first daily reading has not run yet/);
});

test('own checklist: missing shows the BM and English how-to, Unknown is never Done', () => {
  const html = render({ on: true, installed: true, snapshot: snap, howto, mine: { userId: 'u', linked: true, managed: true, checks: { authenticator: 'missing', teams: 'ok', labels: 'unknown' }, idle: false, score: 50 }, people: [] });
  assert.match(html, /Pasang Authenticator/);
  assert.match(html, /Install Authenticator/);
  assert.doesNotMatch(html, /Guna Teams/);
  assert.match(html, /Tidak diketahui \/ Unknown/);
  assert.match(html, /bukan tindakan disiplin/);
});

test('names hidden warning, unlinked account, and staff rows are escaped', () => {
  const html = render({
    on: true, installed: true, snapshot: { ...snap, namesHidden: true }, howto, mine: { userId: 'u', linked: false, managed: null, checks: {}, idle: false, score: null }, seesAll: false,
    people: [{ id: 'p', name: '<script>x()</script>', title: 'Exec', companyIds: [], department: null, userId: 'p', linked: true, managed: false, checks: { teams: 'missing' }, idle: true, score: 0 }],
    summary: { companies: [{ key: 'co-a', people: 1, score: 0, setupMissing: 0, idle: 1 }], departments: [] },
  });
  assert.match(html, /Microsoft still hides names/);
  assert.match(html, /not linked to your Microsoft account/);
  assert.match(html, /&lt;script&gt;x\(\)&lt;\/script&gt;/);
  assert.match(html, /Unused 30 days/);
  assert.match(html, /Staf saya \/ My staff/);
});

test('plans we buy: own plan and what it gives, Premium not used, plan counts', () => {
  const html = render({
    on: true, installed: true, snapshot: snap, howto, seesAll: true,
    mine: { userId: 'u', linked: true, managed: true, plan: 'premium', premiumUnused: true, checks: { teams: 'ok' }, idle: false, score: 100, planGives: { bm: 'Pelan anda: Business Premium.', en: 'Your plan: Business Premium.' } },
    people: [
      { id: 'a', name: 'A', title: 'Exec', companyIds: [], department: null, userId: 'a', linked: true, managed: false, plan: 'basic_p1', checks: {}, idle: false, score: null },
      { id: 'b', name: 'B', title: 'Exec', companyIds: [], department: null, userId: 'b', linked: true, managed: true, plan: 'premium', premiumUnused: true, checks: {}, idle: false, score: null },
    ],
    summary: { companies: [{ key: 'co-a', people: 3, score: 50, setupMissing: 0, idle: 0, premiumUnused: 2 }], departments: [], plans: { premium: 2, basic_p1: 1, basic: 0, other: 0 } },
  });
  assert.match(html, /Pelan anda: Business Premium/);
  assert.match(html, /belum guna laptop diurus IT/);
  assert.match(html, /Basic \+ P1/);
  assert.match(html, /Premium not used/);
  assert.match(html, /Premium not used: 2/);
  assert.match(html, /Plans: Premium 2, Basic \+ P1 1/);
});

test('SharePoint not yet: own how-to, and listed for the manager', () => {
  const html = render({
    on: true, installed: true, snapshot: snap, howto, seesAll: false,
    mine: { userId: 'u', linked: true, managed: false, checks: { sharepoint: 'missing', teams: 'ok' }, idle: false, score: 50 },
    people: [{ id: 'p', name: 'P', title: 'Exec', companyIds: [], department: null, userId: 'p', linked: true, managed: false, checks: { sharepoint: 'missing' }, idle: false, score: 0 }],
  });
  assert.match(html, /Buka fail bersama dalam SharePoint/);
  assert.match(html, /<td class="small">SharePoint<\/td>/);
});

test('Prima and Microsoft links: state, what staff get, what is still needed, and measured use', () => {
  const links = [
    { id: 'entra_signin', title: 'Sign in with Microsoft', bm: 'Masuk dengan Microsoft', en: 'Sign in with Microsoft account', needs: 'App registrations', doc: 'docs/MICROSOFT_SIGN_IN.md', state: 'on' },
    { id: 'alerts', title: 'Alerts to Teams', bm: 'Amaran', en: 'Alerts', needs: 'Shared mailbox and Teams workflows', doc: null, state: 'off' },
  ];
  const html = render({ on: true, installed: true, snapshot: snap, howto, seesAll: true, mine: null, people: [], links, linkUse: { people: 10, linked: 8, primaSignIn: 5, myApps: 2, sharePoint: 4, teams: 9 } });
  assert.match(html, /1 of 2 on/);
  assert.match(html, /Hidup \/ On/);
  assert.match(html, /Belum \/ Off/);
  assert.match(html, /Shared mailbox and Teams workflows/);
  assert.doesNotMatch(html, /App registrations/); // nothing still needed once on
  assert.match(html, /5 signed in to Prima with Microsoft \(50%\)/);
  assert.doesNotMatch(render({ on: true, installed: true, snapshot: snap, howto, mine: null, people: [] }), /Prima and Microsoft links/);
});

test('how to do it: numbered steps, the Microsoft page, Ask IT to help, and the no-password promise', () => {
  const board = { on: true, installed: true, snapshot: snap, howto, mine: { userId: 'u', linked: true, managed: false, checks: { authenticator: 'missing', teams: 'ok' }, idle: false, score: 50 }, people: [] };
  const html = render(board, async () => 'IT-0001');
  assert.match(html, /Cara buat \/ How to do it/);
  assert.match(html, /<li>Langkah satu/);
  assert.match(html, /href="https:\/\/mysignins\.microsoft\.com\/security-info"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /Minta IT bantu \/ Ask IT to help/);
  assert.match(html, /IT never asks for your password/);
  assert.doesNotMatch(render(board), /Minta IT bantu/); // no button without the request path
});
