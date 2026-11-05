// Server-side render of the real Microsoft 365 Connections panel with synthetic state. No network.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const source = fs.readFileSync('apps/web/src/connections/m365/panel.tsx', 'utf8');
const at = '2026-11-03T01:00:00.000Z', until = '2026-11-03T09:00:00.000Z';
const svc = (service, patch = {}) => ({ service, state: 'configured', reason: 'NotChecked', resources: service === 'outlook' ? [] : [{ key: `${service}-a`, name: `Synthetic ${service}` }], actions: ['check'], ...patch });
function render(patch = {}) {
  const state = { owner: 'u1', phase: 'idle', status: { userId: 'u1', services: [svc('outlook'), svc('teams'), svc('sharepoint')], teamsApprovals: { state: 'not_built', canApplyApprovals: false } }, failure: false, busy: {}, selected: { teams: 'teams-a', sharepoint: '' }, linkInput: { teams: '', sharepoint: '' }, links: {}, message: {}, guidance: null, ...patch };
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Date, require: id => id === 'react' ? React : id === 'react/jsx-runtime' ? require('react/jsx-runtime') : id === './state' ? { M365Session: class { snapshot = () => state; subscribe = () => () => {}; start() {} dispose() {} } } : {} });
  return renderToStaticMarkup(React.createElement(exports.M365ConnectionsPanel, { userId: 'u1', client: {} }));
}
const services = list => ({ status: { userId: 'u1', services: list, teamsApprovals: { state: 'not_built', canApplyApprovals: false } } });

test('first view: configured but not checked, never connected; sign-in alone does not count', () => {
  const html = render();
  assert.match(html, /Configured, not checked/);
  assert.match(html, /Signing in to Prima does not prove access/);
  assert.doesNotMatch(html, />Connected</);
  assert.doesNotMatch(html, />Send<|Mail\.Send|access_token/);
  assert.match(html, /Teams Approvals evidence is not built/);
});
test('not configured hides actions and link boxes', () => {
  const html = render(services(['outlook', 'teams', 'sharepoint'].map(s => ({ service: s, state: 'not_configured', reason: 'FeatureDisabled', resources: [], actions: [] }))));
  assert.equal((html.match(/>Not configured</g) || []).length, 3);
  assert.doesNotMatch(html, /<button[^>]*>Check<|<input/);
});
test('connected shows when Microsoft answered and until when; disconnect offered', () => {
  const html = render(services([svc('outlook', { state: 'connected', reason: 'Verified', checkedAt: at, validUntil: until, actions: ['check', 'disconnect'] }), svc('teams'), svc('sharepoint')]));
  assert.match(html, />Connected</);
  assert.match(html, new RegExp(`dateTime="${until}"`));
  assert.match(html, /point-in-time check/);
  assert.match(html, />Disconnect</);
});
test('consent, expiry and throttling are explained with the right action', () => {
  const html = render(services([svc('outlook', { state: 'consent_needed', reason: 'ConsentRevoked', checkedAt: at, actions: ['reconnect', 'disconnect'] }), svc('teams', { state: 'expired_or_revoked', reason: 'SessionExpired', actions: ['reconnect', 'disconnect'] }), svc('sharepoint', { state: 'unavailable', reason: 'RateLimited', retryAfterSeconds: 120, actions: ['disconnect'] })]));
  assert.match(html, /Consent needed/); assert.match(html, /permission has been removed/);
  assert.match(html, /Expired or revoked/); assert.match(html, />Reconnect</);
  assert.match(html, /Try again in about 2 minute/);
});
test('link results: not-a-member is explained; verified Teams link opens in a new tab', () => {
  const html = render({ links: { teams: { service: 'teams', userId: 'u1', outcome: 'Verified', checkedAt: at, verifiedScope: 'channel', membershipType: 'private', openUrl: 'https://teams.microsoft.com/l/channel/x/channel?groupId=g&tenantId=t', status: svc('teams') }, sharepoint: { service: 'sharepoint', userId: 'u1', outcome: 'NotApprovedOrNoAccess', checkedAt: at, canonicalUrl: 'https://example.sharepoint.com/sites/X', status: svc('sharepoint') } } });
  assert.match(html, /Channel type: private/);
  assert.match(html, /this channel only \(not the whole team\)/);
  assert.match(html, /target="_blank" rel="noopener noreferrer">Open in Teams/);
  assert.match(html, /not approved for Prima yet, or you do not have access/);
});
test('status of another person is not rendered', () => {
  const html = render({ status: { userId: 'someone-else', services: [svc('outlook', { state: 'connected', reason: 'Verified', checkedAt: at, validUntil: until })], teamsApprovals: { state: 'not_built', canApplyApprovals: false } } });
  assert.doesNotMatch(html, />Connected</);
});
test('library link not approved: only the site is confirmed', () => {
  const html = render({ links: { sharepoint: { service: 'sharepoint', userId: 'u1', outcome: 'SiteVerifiedLibraryNotApproved', checkedAt: at, verifiedScope: 'site', canonicalUrl: 'https://example.sharepoint.com/sites/X/HR', status: svc('sharepoint') } } });
  assert.match(html, /Only the site is confirmed/);
  assert.doesNotMatch(html, /Microsoft confirmed you can open this\./);
});
test('not-a-team-member explains shared channels honestly; disconnect does not claim to revoke consent', () => {
  const html = render(services([svc('outlook'), svc('teams', { state: 'unavailable', reason: 'NotTeamMember', checkedAt: at, actions: ['check', 'disconnect'] }), svc('sharepoint')]));
  assert.match(html, /If you only belong to one shared channel/);
  assert.match(html, /it does not remove Microsoft permission/);
});
