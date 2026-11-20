// P120: the check-in location made from many readings (apps/web/src/views/location-fix.ts).
// Run: node --test scripts/location-fix.test.mjs (from apps/prima). Synthetic coordinates only.
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
const file = path.resolve(here, '../apps/web/src/views/location-fix.ts');
const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const L = {};
vm.runInNewContext(out, { exports: L, Math, Number, Infinity });

// A made-up spot and a way to place readings a few metres from it.
const TRUE = { lat: 3.139, lng: 101.6869 };
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((TRUE.lat * Math.PI) / 180));
const at = (north, east, accuracyM, t) => ({ lat: TRUE.lat + north * M_LAT, lng: TRUE.lng + east * M_LNG, accuracyM, at: t });
const T0 = 1_800_000_000_000;

test('distance is in metres', () => {
  const d = L.distanceM(TRUE, at(100, 0, 5, T0));
  assert.ok(Math.abs(d - 100) < 0.5, String(d));
});

test('cached, broken and jumping readings are dropped', () => {
  const rs = [
    at(0, 0, 10, T0 - 60_000), // before the search: cached
    at(0, 0, 0, T0 + 1000), // no accuracy
    { lat: 0, lng: 0, accuracyM: 10, at: T0 + 1500 }, // null island
    at(2, 1, 9, T0 + 2000),
    at(5000, 0, 8, T0 + 3000), // 5 km in a second: a glitch or a fake
    at(1, 2, 8, T0 + 4000),
  ];
  const kept = L.usable(rs, T0);
  assert.equal(kept.length, 2);
  assert.ok(kept.every((r) => L.distanceM(TRUE, r) < 5));
});

test('a Wi-Fi guess and a stray reading do not pull the point; accuracy stays honest', () => {
  const rs = [
    at(180, -150, 350, T0 + 500), // Wi-Fi / cell guess first
    at(3, -2, 12, T0 + 2000),
    at(-2, 3, 10, T0 + 3000),
    at(1, 1, 8, T0 + 4000),
    at(-1, -2, 9, T0 + 5000),
    at(22, 18, 11, T0 + 6000), // multipath jump inside the cluster's accuracy band
    at(0, 2, 8, T0 + 7000),
  ];
  const f = L.fuse(L.usable(rs, T0));
  assert.ok(L.distanceM(TRUE, f) < 3, `off by ${L.distanceM(TRUE, f)} m`);
  // Every single reading here is 8 m or worse: the combined point never claims better than 8.
  assert.ok(f.accuracyM >= 8, String(f.accuracyM));
  assert.ok(f.used >= 4 && f.used <= 5, String(f.used));
  // The best single reading alone is further off than the combined point.
  const best = rs.filter((r) => r.accuracyM === 8);
  assert.ok(L.distanceM(TRUE, f) <= Math.max(...best.map((r) => L.distanceM(TRUE, r))));
});

test('waits for a precise and steady reading, takes a sharp one at once, and the best at the limit', () => {
  const rules = { goodM: 20, maxM: 100, warmMs: 3000, waitMs: 15_000 };
  // One rough reading in the warm-up: wait.
  assert.equal(L.settled([at(0, 0, 60, T0)], 1000, rules), false);
  // Two very sharp readings: take them even in the warm-up.
  assert.equal(L.settled([at(0, 0, 5, T0), at(1, 0, 6, T0 + 500)], 1200, rules), true);
  // Three good, steady readings after the warm-up: take them.
  const steady = [at(0, 0, 15, T0), at(1, 1, 14, T0 + 1000), at(0, 1, 15, T0 + 2000)];
  assert.equal(L.settled(steady, 4000, rules), true);
  // Good but the newest moved the point a lot: still settling.
  const moving = [at(0, 0, 15, T0), at(1, 1, 15, T0 + 1000), at(25, 25, 15, T0 + 2000)];
  assert.equal(L.settled(moving, 4000, rules), false);
  // Only 60 m readings: not before the time limit, then yes (within the server's 100 m).
  const rough = [at(0, 0, 60, T0), at(5, 5, 62, T0 + 2000), at(3, 1, 61, T0 + 4000)];
  assert.equal(L.settled(rough, 8000, rules), false);
  assert.equal(L.settled(rough, 16_000, rules), true);
  // Nothing within the server's limit: never "settled" (the screen then asks to move and try again).
  assert.equal(L.settled([at(0, 0, 400, T0)], 40_000, rules), false);
});
