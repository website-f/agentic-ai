// P90: the camera opens fast (apps/web/src/views/camera-stream.ts) and the item scanner no longer waits for the code
// reader before asking for the camera. Run: node --test scripts/camera-stream.test.mjs (from apps/prima). No browser.
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

function load(file, sandbox = {}) {
  const out = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(out, { exports, require: () => ({}), ...sandbox });
  return exports;
}

const C = load('views/camera-stream.ts', { window: { isSecureContext: true }, navigator: {} });

test('asks for sizes every phone has, never exact ones', () => {
  const back = C.cameraConstraints('environment');
  assert.deepEqual(JSON.parse(JSON.stringify(back.video.facingMode)), { ideal: 'environment' });
  assert.deepEqual(JSON.parse(JSON.stringify(back.video.width)), { ideal: 1280 });
  assert.deepEqual(JSON.parse(JSON.stringify(back.video.height)), { ideal: 720 });
  assert.equal(back.audio, false);
  const front = C.cameraConstraints('user');
  assert.deepEqual(JSON.parse(JSON.stringify(front.video.width)), { ideal: 640 });
  const chosen = C.cameraConstraints('environment', 'cam-2');
  assert.deepEqual(JSON.parse(JSON.stringify(chosen.video.deviceId)), { exact: 'cam-2' });
  assert.equal(chosen.video.facingMode, undefined);
  for (const c of [back, front, chosen]) assert.ok(!/"exact":\d/.test(JSON.stringify(c)), 'no exact sizes');
});

test('falls back to any camera of that side when the phone refuses the settings, but never past a refusal of permission', async () => {
  const calls = [];
  const md = (fail) => ({
    getUserMedia: async (c) => {
      calls.push(c);
      if (calls.length === 1 && fail) throw Object.assign(new Error('x'), { name: fail });
      return { ok: true };
    },
  });
  assert.deepEqual(await C.openCamera('environment', null, md('OverconstrainedError')), { ok: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { video: { facingMode: { ideal: 'environment' } }, audio: false });
  calls.length = 0;
  await assert.rejects(C.openCamera('environment', null, md('NotAllowedError')), (e) => e.name === 'NotAllowedError');
  assert.equal(calls.length, 1, 'a refused permission is not asked again');
  calls.length = 0;
  // A chosen camera that went away: any back camera instead.
  assert.deepEqual(await C.openCamera('environment', 'gone', md('NotFoundError')), { ok: true });
  assert.equal(calls.length, 2);
});

test('the scanner asks for the camera before waiting for the code reader, and stops it on close', () => {
  const s = read('views/items/Scanner.tsx');
  const body = s.slice(s.indexOf('export function CameraScan'));
  const reader = body.indexOf('const reader = makeDecoder()');
  const open = body.indexOf("await openCamera('environment'");
  const wait = body.indexOf('await reader');
  assert.ok(reader > 0 && open > reader && wait > open, 'the reader loads beside the camera, and is waited for only after it is open');
  assert.ok(/stopStream\(stream\.current\)/.test(body), 'tracks stopped on close');
  assert.ok(/whenIdle\(prewarmDecoder\)/.test(s), 'the reader is prepared before the camera is opened');
  assert.ok(/PermissionHelp kind="camera"/.test(body), 'help when the camera is blocked');
  const d = read('views/items/decoder.ts');
  assert.ok(/best \?\?=/.test(d), 'the reader is prepared once and kept');
});

test('the face camera loads its engine early and offers retake', () => {
  const f = read('views/FaceCheck.tsx');
  assert.ok(/whenIdle\(\(\) => void engine\(\)/.test(f), 'engine prewarmed from the button');
  assert.ok(/Retake/.test(f) && /Use photo/.test(f), 'photo shown to keep or retake');
  assert.ok(/openCamera\('user'/.test(f), 'front camera through the shared opener');
});
