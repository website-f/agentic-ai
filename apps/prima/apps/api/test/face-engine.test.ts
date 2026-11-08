// Prima's own face engine on the server (FACE_ENGINE=server, Fauzan 5 Nov 2026): the switch, the signed challenge and
// the real engine on synthetic pictures. No real faces are used, so recognition quality is NOT proved here; see
// docs/FACE_ENGINE.md for the phone trial still needed. No database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FaceEngine, faceEngineConfig, issueFaceChallenge, openFaceChallenge } from '../src/face-engine';

const SECRET = 'x'.repeat(40);

describe('Face engine switch', () => {
  it('stays on the phone engine unless FACE_ENGINE=server', () => {
    assert.equal(faceEngineConfig({}).mode, 'phone');
    assert.equal(faceEngineConfig({ FACE_ENGINE: 'Server' }).mode, 'phone');
    assert.equal(faceEngineConfig({ FACE_ENGINE: 'server', FACE_CHALLENGE_SECRET: SECRET }).mode, 'server');
  });

  it('refuses to start the server engine without a long enough challenge secret', () => {
    assert.throws(() => faceEngineConfig({ FACE_ENGINE: 'server' }), /FACE_CHALLENGE_SECRET/);
    assert.throws(() => faceEngineConfig({ FACE_ENGINE: 'server', FACE_CHALLENGE_SECRET: 'short' }), /FACE_CHALLENGE_SECRET/);
  });
});

describe('Signed face challenge', () => {
  const now = Date.parse('2026-11-05T01:00:00Z');

  it('opens only for the same user, unchanged and in time, and names its clock', () => {
    const c = issueFaceChallenge(SECRET, 'u-a', 'sc-1', now);
    assert.equal(c.steps.length, 4);
    assert.deepEqual(openFaceChallenge(SECRET, c.token, 'u-a', now + 60_000), { steps: c.steps, clockId: 'sc-1' });
    assert.equal(openFaceChallenge(SECRET, c.token, 'u-b', now), null, 'another user');
    assert.equal(openFaceChallenge(SECRET, c.token, 'u-a', now + 91_000), null, 'expired');
    assert.equal(openFaceChallenge('y'.repeat(40), c.token, 'u-a', now), null, 'another secret');
    assert.equal(openFaceChallenge(SECRET, 42, 'u-a', now), null);
    assert.equal(openFaceChallenge(SECRET, `${c.token}.x`, 'u-a', now), null);
  });

  it('gives the same steps when asked again for the same clock, so nobody can fish for an order', () => {
    const first = issueFaceChallenge(SECRET, 'u-a', 'sc-1', now).steps;
    for (let i = 0; i < 20; i++) assert.deepEqual(issueFaceChallenge(SECRET, 'u-a', 'sc-1', now + i).steps, first);
    const orders = new Set(Array.from({ length: 60 }, (_, i) => issueFaceChallenge(SECRET, 'u-a', `sc-${i}`, now).steps.join('-')));
    assert.equal(orders.size, 4, 'different clocks get all four orders');
  });

  it('refuses steps the phone picked for itself', () => {
    const c = issueFaceChallenge(SECRET, 'u-a', 'sc-1', now);
    const [body, mac] = c.token.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    claims.s = ['centre', 'centre', 'centre', 'centre'];
    const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`;
    assert.equal(openFaceChallenge(SECRET, forged, 'u-a', now), null);
  });
});

describe('Engine on the server (TensorFlow.js on WebAssembly, synthetic pictures)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jpeg = require('jpeg-js') as typeof import('jpeg-js');
  const picture = (fill: (x: number, y: number) => [number, number, number]) => {
    const width = 320;
    const height = 240;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const [r, g, b] = fill(x, y);
        data.set([r, g, b, 255], (y * width + x) * 4);
      }
    return 'data:image/jpeg;base64,' + jpeg.encode({ width, height, data }, 80).data.toString('base64');
  };
  const engine = new FaceEngine(faceEngineConfig({}).modelsDir);

  it('loads the models served at /face-models and finds no face in a plain or striped picture', async () => {
    const t = Date.now();
    assert.equal(await engine.analyse(picture(() => [90, 100, 110])), null);
    assert.equal(await engine.analyse(picture((x) => (x % 40 < 20 ? [240, 240, 240] : [20, 20, 20]))), null);
    assert.ok(Date.now() - t < 30_000, 'loads and reads within 30 seconds');
  });

  it('refuses anything that is not a camera JPEG', async () => {
    assert.equal(await engine.analyse('data:image/png;base64,AAAA'), null);
    assert.equal(await engine.analyse('data:image/jpeg;base64,bm90IGEganBlZw=='), null);
  });
});
