// P122: the check-in location on a computer (owner, 21 Nov 2026: "Finding your location took too long" from the office
// computer). Readings that came are never "took too long"; rough ones are shown with their real accuracy and never sent;
// the help differs for a computer and a phone, in Malay too. Run: node --test scripts/location-fix-p122.test.mjs (from
// apps/prima). Synthetic coordinates and user agents only.
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

function load(file, stubs = {}) {
  const out = ts.transpileModule(fs.readFileSync(path.join(src, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(out, { exports, require: (m) => stubs[m] ?? {}, Math, Number, Infinity, Map, WeakMap, Set });
  return exports;
}
const L = load('views/location-fix.ts');
const P = load('views/checkin-permissions.ts');
const I = load('i18n.ts', { react: { createContext: () => ({}), useContext: () => ({}) } });

const TRUE = { lat: 3.139, lng: 101.6869 };
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((TRUE.lat * Math.PI) / 180));
const at = (north, east, accuracyM, t) => ({ lat: TRUE.lat + north * M_LAT, lng: TRUE.lng + east * M_LNG, accuracyM, at: t });
const T0 = 1_800_000_000_000;
const MAX = 100;

test('a computer with only a Wi-Fi guess ends "rough" with its real accuracy, never "took too long"', () => {
  // The owner's case: the browser answers, but kilometres wide (over WORST_M, so never fused).
  const rs = [at(1800, -900, 4200, T0 + 400), at(1500, -700, 3900, T0 + 1300)];
  assert.equal(L.fuse(L.usable(rs, T0)), null);
  const end = L.locateEnd(rs, T0, MAX, 3);
  assert.equal(end.kind, 'rough');
  assert.equal(end.accuracyM, 3900);
  // A rough end is never a fix, whatever the error code.
  for (const code of [null, 2, 3]) assert.equal(L.locateEnd(rs, T0, MAX, code).kind, 'rough');
});

test('a quick answer the browser already had (under a minute old) is shown, but never fused into a check-in', () => {
  const cached = at(5, 5, 40, T0 - 30_000);
  assert.equal(L.usable([cached], T0).length, 0);
  assert.equal(L.bestReading([cached], T0).accuracyM, 40);
  // Older than a minute: not even shown.
  assert.equal(L.bestReading([at(5, 5, 40, T0 - 90_000)], T0), null);
  const end = L.locateEnd([cached], T0, MAX, null);
  assert.equal(end.kind, 'rough', 'a cached 40 m reading is still not a check-in');
  const e = L.bestEstimate([cached], T0);
  assert.equal(e.fused, false);
  assert.equal(e.used, 0);
});

test('good readings still end as the P120 fused fix; the rough quick answer does not pull it', () => {
  const rs = [at(900, 600, 2400, T0 + 300), at(2, 1, 9, T0 + 3000), at(-1, 2, 9, T0 + 3500), at(1, -1, 9, T0 + 4000)];
  const end = L.locateEnd(rs, T0, MAX, null);
  assert.equal(end.kind, 'fix');
  assert.ok(L.distanceM(TRUE, end) < 4, String(L.distanceM(TRUE, end)));
  assert.ok(end.accuracyM >= 9 && end.accuracyM <= MAX);
  const e = L.bestEstimate(rs, T0);
  assert.equal(e.fused, true);
  assert.equal(e.used, 3);
});

test('fused but rougher than the limit is rough, never a fix', () => {
  const rs = [at(0, 0, 350, T0 + 1000), at(10, 5, 340, T0 + 2000)];
  const end = L.locateEnd(rs, T0, MAX, 3);
  assert.equal(end.kind, 'rough');
  assert.ok(end.accuracyM > MAX);
});

test('no reading at all: denied, switched off (unavailable) or no answer in time', () => {
  assert.deepEqual({ ...L.locateEnd([], T0, MAX, 1) }, { kind: 'none', problem: 'denied' });
  assert.deepEqual({ ...L.locateEnd([], T0, MAX, 2) }, { kind: 'none', problem: 'unavailable' });
  assert.deepEqual({ ...L.locateEnd([], T0, MAX, 3) }, { kind: 'none', problem: 'timeout' });
  assert.deepEqual({ ...L.locateEnd([], T0, MAX, null) }, { kind: 'none', problem: 'timeout' });
  // Denied wins even over readings that came before (the person took the permission back).
  assert.equal(L.locateEnd([at(0, 0, 9, T0 + 100)], T0, MAX, 1).kind, 'none');
  // Broken readings are not readings.
  assert.equal(L.bestReading([{ lat: 0, lng: 0, accuracyM: 50, at: T0 }, { lat: NaN, lng: 1, accuracyM: 5, at: T0 }, at(0, 0, 0, T0)], T0), null);
});

test('the nearest check-in place: by distance beyond its circle, then to its pin', () => {
  const places = [
    { label: 'Far', lat: TRUE.lat + 2000 * M_LAT, lng: TRUE.lng, radiusM: 100 },
    { label: 'Big', lat: TRUE.lat + 600 * M_LAT, lng: TRUE.lng, radiusM: 800 },
    { label: 'Near', lat: TRUE.lat + 300 * M_LAT, lng: TRUE.lng, radiusM: 100 },
  ];
  const n = L.nearestPlace(TRUE, places);
  assert.equal(n.place.label, 'Big');
  assert.equal(n.outsideByM, 0);
  assert.ok(Math.abs(n.distanceM - 600) < 1);
  assert.equal(L.nearestPlace(TRUE, []), null);
});

const UA = {
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

test('phone or computer', () => {
  assert.equal(P.deviceKind(P.detectPlatform(UA.winChrome)), 'computer');
  assert.equal(P.deviceKind(P.detectPlatform(UA.winEdge), true), 'computer', 'a Windows touch laptop still has no GPS');
  assert.equal(P.deviceKind(P.detectPlatform(UA.macSafari)), 'computer');
  assert.equal(P.deviceKind(P.detectPlatform(UA.ipad, 5)), 'phone');
  assert.equal(P.deviceKind(P.detectPlatform(UA.android)), 'phone');
  assert.equal(P.deviceKind(P.detectPlatform(UA.linux), false), 'computer');
  assert.equal(P.deviceKind(P.detectPlatform(UA.linux), true), 'phone');
});

test('a computer is told where its location switch is and to turn on Wi-Fi; a phone keeps its own help', () => {
  const win = P.locationProblemText('unavailable', 'computer', 'windows');
  assert.match(win, /Settings > Privacy & security > Location/);
  assert.match(win, /Wi-Fi/);
  assert.doesNotMatch(win, /took too long/);
  assert.match(P.locationProblemText('timeout', 'computer', 'mac'), /System Settings > Privacy & Security > Location Services/);
  assert.equal(P.locationProblemText('timeout', 'phone', 'android'), P.LOCATION_PROBLEM_TEXT.timeout);
  assert.equal(P.locationProblemText('denied', 'computer', 'windows'), P.LOCATION_PROBLEM_TEXT.denied);
  assert.match(P.roughTips('computer', 'windows').join(' '), /no GPS[\s\S]*Settings > Privacy & security > Location/);
  assert.match(P.roughTips('phone', 'ios').join(' '), /Precise Location/);
});

test('every new check-in sentence reads in Bahasa Melayu (and the mix)', () => {
  const texts = [
    P.locationProblemText('unavailable', 'computer', 'windows'),
    P.locationProblemText('timeout', 'computer', 'mac'),
    P.locationProblemText('timeout', 'computer', 'other'),
    ...Object.values(P.LOCATION_PROBLEM_TEXT),
    ...P.roughTips('computer', 'windows'),
    ...P.roughTips('computer', 'mac'),
    ...P.roughTips('phone', 'android'),
    'Use the phone instead',
    'Your phone has GPS and finds you to within a few metres. Open Prima on your phone and check in or out there.',
    'Asking this computer for its location. This takes a few seconds.',
    'Accurate to about 4.2 km so far; waiting for 100 m or better. A computer finds itself from Wi-Fi, so it may not get closer than this.',
    'Accurate to about 12 km so far; waiting for 100 m or better. Stay near a window or step outside.',
    'Accurate to about 350 m so far; waiting for 100 m or better. Stay near a window or step outside.',
    'Accurate to about 14 m so far. Hold still: a few more readings make it exact.',
    '3 readings combined',
    'Your location is only accurate to about 3.9 km; it must be within 100 m to check in.',
    'Looking up the address… · ±9 m · Nearest check-in place: HQ Kuala Lumpur, 12 m',
    'Finding your location on the map',
    'You (rough guess)',
    'Computer (Wi-Fi only)',
  ];
  for (const t of texts) {
    for (const lang of ['ms', 'mix']) {
      const out = I.tr(t, lang, true);
      assert.notEqual(out, t, `${lang}: ${t}`);
      // No English sentence left behind in the Malay.
      assert.doesNotMatch(out, /\b(Turn on|so far|Accurate to|Nearest|This computer|Your phone|Then tap)\b/, `${lang}: ${out}`);
    }
  }
  assert.equal(I.tr('Your location is only accurate to about 3.9 km; it must be within 100 m to check in.', 'ms', true), 'Lokasi anda hanya tepat kira-kira 3.9 km; ia mesti dalam lingkungan 100 m untuk daftar masuk.');
  assert.match(I.tr('Looking up the address… · ±9 m · Nearest check-in place: HQ Kuala Lumpur, 12 m', 'ms', true), /^Mencari alamat… · ±9 m · Tempat daftar masuk terdekat: HQ Kuala Lumpur, 12 m$/);
});

test('the check-in screen keeps rough readings out of a check-in and asks quickly in parallel', () => {
  const flow = fs.readFileSync(path.join(src, 'views/CheckIn.tsx'), 'utf8');
  assert.match(flow, /end\.kind === 'rough' \|\| fix\.accuracyM > me\.maxAccuracyM/);
  assert.match(flow, /getCurrentPosition\(take, .*\{ enableHighAccuracy: false, maximumAge: 60_000/);
  assert.match(flow, /watchPosition\(take, .*\{ enableHighAccuracy: true, maximumAge: 0/);
  // Only the 'ready' phase (a server preview of a fix within the limit) leads to the confirm step.
  assert.match(flow, /const preview = loc\.phase === 'ready' \? loc\.preview : null;/);
  assert.match(flow, /\{step === 'confirm' && preview && fix && \(/);
  const map = fs.readFileSync(path.join(src, 'views/GeoMap.tsx'), 'utf8');
  assert.match(map, /if \(fresh \|\| flying\.current \|\| !animatePoint \|\| reduced\(\)/);
  assert.match(map, /if \(flyTo && !reduced\(\)\) \{[^}]*m\.flyToBounds/);
  const css = fs.readFileSync(path.join(src, 'styles/checkin.css'), 'utf8');
  const still = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(still, /\.ci-drop,/);
  assert.match(still, /\.ci-you-halo/);
});
