// P81: camera and location permission help (apps/web/src/views/checkin-permissions.ts), and the check-in screens' wiring.
// Run: node --test scripts/checkin-permissions.test.mjs (from apps/prima). Synthetic user agents only.
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
const src = path.resolve(here, '../apps/web/src');
const read = (p) => fs.readFileSync(path.join(src, p), 'utf8');

function load(file) {
  const out = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(out, { exports, require: () => ({}) });
  return exports;
}
const P = load('views/checkin-permissions.ts');

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidEdge: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  androidWhatsApp: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 WhatsApp/2.24',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0 Mobile/15E148 Safari/605.1.15',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

test('knows the phone and browser, and their own steps come first', () => {
  const cases = [
    [UA.androidChrome, 0, 'android', 'chrome', 'android-chrome'],
    [UA.androidEdge, 0, 'android', 'edge', 'android-edge'],
    [UA.androidSamsung, 0, 'android', 'samsung', 'android-samsung'],
    [UA.iphoneSafari, 0, 'ios', 'safari', 'ios-safari'],
    [UA.iphoneChrome, 0, 'ios', 'chrome', 'ios-chrome'],
    [UA.iphoneEdge, 0, 'ios', 'edge', 'ios-edge'],
    [UA.ipadSafari, 5, 'ios', 'safari', 'ios-safari'],
    [UA.ipadSafari, 0, 'mac', 'safari', 'mac-safari'],
    [UA.windowsEdge, 0, 'windows', 'edge', 'desktop-edge'],
    [UA.windowsChrome, 0, 'windows', 'chrome', 'desktop-chrome'],
  ];
  for (const [ua, touch, os, browser, guide] of cases) {
    const p = P.detectPlatform(ua, touch);
    assert.equal(p.os, os, ua);
    assert.equal(p.browser, browser, ua);
    for (const kind of ['camera', 'location']) {
      const h = P.permissionHelp(kind, p);
      assert.equal(h.mine.id, guide);
      assert.ok(h.mine.steps.length >= 2);
      assert.ok(!h.others.includes(h.mine));
      assert.equal(h.others.length + 1, 9);
    }
  }
  assert.equal(P.detectPlatform(UA.androidChrome).inApp, false);
  const wa = P.permissionHelp('camera', P.detectPlatform(UA.androidWhatsApp));
  assert.match(wa.inAppNote, /Open it in Chrome, Edge or Safari/);
});

test('reads camera and location errors the way browsers report them', () => {
  assert.equal(P.cameraProblem({ name: 'NotAllowedError' }), 'denied');
  assert.equal(P.cameraProblem({ name: 'NotFoundError' }), 'missing');
  assert.equal(P.cameraProblem({ name: 'OverconstrainedError' }), 'missing');
  assert.equal(P.cameraProblem({ name: 'NotReadableError' }), 'busy');
  assert.equal(P.cameraProblem({ name: 'SecurityError' }), 'insecure');
  assert.equal(P.cameraProblem(null), 'other');
  for (const k of ['denied', 'missing', 'busy', 'insecure', 'unsupported', 'other']) assert.ok(P.CAMERA_PROBLEM_TEXT[k].length > 20);
  assert.equal(P.locationProblem({ code: 1 }), 'denied');
  assert.equal(P.locationProblem({ code: 2 }), 'unavailable');
  assert.equal(P.locationProblem({ code: 3 }), 'timeout');
  assert.equal(P.locationProblem(undefined), 'unsupported');
});

test('asks the Permissions API without ever throwing', async () => {
  const nav = (state) => ({ permissions: { query: async ({ name }) => ({ state: name === 'geolocation' ? state : 'prompt' }) } });
  assert.equal(await P.queryPermission('location', nav('denied')), 'denied');
  assert.equal(await P.queryPermission('location', nav('granted')), 'granted');
  assert.equal(await P.queryPermission('camera', nav('denied')), 'prompt');
  // Safari and Firefox throw for 'camera'; an old browser has no Permissions API at all.
  assert.equal(await P.queryPermission('camera', { permissions: { query: async () => Promise.reject(new TypeError('camera')) } }), 'unknown');
  assert.equal(await P.queryPermission('location', {}), 'unknown');
});

test('the check-in screens keep the rules the server enforces', () => {
  const flow = read('views/CheckIn.tsx');
  // Rough readings never become a check-in; the verdict comes from the server preview, not from the phone.
  assert.match(flow, /fix\.accuracyM > me\.maxAccuracyM/);
  assert.match(flow, /api\.checkinPreview\(fix\)/);
  assert.doesNotMatch(flow, /verdict:\s*['"]in_area['"]/);
  assert.match(flow, /<PermissionHelp kind="location" \/>/);
  assert.match(flow, /<PermissionHelp kind="camera" \/>/);
  const face = read('views/FaceCheck.tsx');
  assert.match(face, /cameraProblem\(e\)/);
  assert.match(face, /problem === 'denied'/);
  const map = read('views/GeoMap.tsx');
  // Tiles only from the host the CSP allows; addresses only through the API.
  assert.match(map, /https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  for (const f of ['views/GeoMap.tsx', 'views/CheckIn.tsx', 'views/CheckinPlaces.tsx']) assert.doesNotMatch(read(f), /nominatim\.openstreetmap|https?:\/\/\S*nominatim/i, f);
  assert.match(map, /prefers-reduced-motion/);
  const nginx = fs.readFileSync(path.resolve(here, '../../../deploy/nginx/web.conf'), 'utf8');
  const prima = nginx.slice(nginx.indexOf('location ^~ /prima/ {'));
  assert.match(prima.slice(0, prima.indexOf('}')), /img-src 'self' data: blob: https:\/\/tile\.openstreetmap\.org;/);
  assert.match(prima.slice(0, prima.indexOf('}')), /Permissions-Policy "camera=\(self\), geolocation=\(self\)/);
});
