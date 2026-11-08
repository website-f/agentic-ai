/**
 * Prima's own face engine on the server (Fauzan, 5 Nov 2026: "create our own or find a low-cost one").
 *
 * Off unless FACE_ENGINE=server. It runs the same free engine the phone uses (face-api, MIT licence, the model files
 * already served at /face-models) inside the API with TensorFlow.js on WebAssembly: no paid service, no picture leaves
 * Prima. The phone only takes the pictures; the server finds the face, its 68 landmarks and its 128 numbers.
 *
 * A face check is a short random challenge (face.ts: facing, a turn, facing, a turn). The server signs the steps with
 * FACE_CHALLENGE_SECRET and bound to the user's open clock, so the phone cannot pick its own; the clock's FACE_PENDING
 * mark makes each check single use.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FACE_CHALLENGE_STEPS, FACE_CHALLENGE_TTL_S, faceChallengeSteps, turnOf } from '@prima/core';
import type { FaceEngineMode, FaceFrame, FaceStep } from '@prima/core';

export interface FaceEngineConfig {
  mode: FaceEngineMode;
  /** Signs challenges; required for 'server'. */
  secret: string | null;
  modelsDir: string;
}

/** The switch. Anything but 'server' keeps the 2 Nov 2026 behaviour (the phone makes the descriptor). */
export function faceEngineConfig(env: NodeJS.ProcessEnv = process.env): FaceEngineConfig {
  const mode: FaceEngineMode = env.FACE_ENGINE === 'server' ? 'server' : 'phone';
  const secret = env.FACE_CHALLENGE_SECRET && env.FACE_CHALLENGE_SECRET.length >= 32 ? env.FACE_CHALLENGE_SECRET : null;
  if (mode === 'server' && !secret) throw new Error('FACE_ENGINE=server needs FACE_CHALLENGE_SECRET (at least 32 characters).');
  return { mode, secret, modelsDir: env.FACE_MODELS_DIR || resolve(__dirname, '../../../web/public/face-models') };
}

export interface FaceChallenge {
  token: string;
  steps: FaceStep[];
  expiresAt: string;
}

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(`face-challenge.${body}`).digest('base64url');

/**
 * The challenge for this user's open clock: the steps come from the secret, the user and the clock, so asking again
 * gives the same steps and cannot be used to fish for an order that suits a recording. Open for FACE_CHALLENGE_TTL_S.
 */
export function issueFaceChallenge(secret: string, userId: string, clockId: string, now = Date.now()): FaceChallenge {
  const seed = createHmac('sha256', secret).update(`face-steps.${userId}.${clockId}`).digest();
  let i = 0;
  const steps = faceChallengeSteps(() => seed[i++ % seed.length] / 256);
  const exp = now + FACE_CHALLENGE_TTL_S * 1000;
  const body = Buffer.from(JSON.stringify({ u: userId, c: clockId, s: steps, e: exp, n: randomBytes(9).toString('base64url') })).toString('base64url');
  return { token: `${body}.${sign(secret, body)}`, steps, expiresAt: new Date(exp).toISOString() };
}

/** The steps and clock of a challenge this server signed for this user, still open; otherwise null. */
export function openFaceChallenge(secret: string, token: unknown, userId: string, now = Date.now()): { steps: FaceStep[]; clockId: string } | null {
  if (typeof token !== 'string' || token.length > 800) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const want = Buffer.from(sign(secret, body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { u?: unknown; c?: unknown; s?: unknown; e?: unknown };
    if (c.u !== userId || typeof c.c !== 'string' || typeof c.e !== 'number' || c.e < now) return null;
    const steps = c.s;
    if (!Array.isArray(steps) || steps.length !== FACE_CHALLENGE_STEPS || !steps.every((s) => s === 'centre' || s === 'left' || s === 'right')) return null;
    return { steps: steps as FaceStep[], clockId: c.c };
  } catch {
    return null;
  }
}

type FaceApi = typeof import('@vladmandic/face-api');

/** Loads the engine once, on the first face check (the API starts as fast as before). */
export class FaceEngine {
  private loading: Promise<FaceApi> | null = null;

  constructor(readonly modelsDir: string) {}

  private engine(): Promise<FaceApi> {
    this.loading ??= (async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js') as FaceApi;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const wasm = require('@tensorflow/tfjs-backend-wasm') as { setWasmPaths(p: string): void };
      wasm.setWasmPaths(`${dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json'))}/dist/`);
      // The same TensorFlow.js instance face-api's node-wasm build loads.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tf = require('@tensorflow/tfjs') as { setBackend(b: string): Promise<boolean>; ready(): Promise<void> };
      await tf.setBackend('wasm');
      await tf.ready();
      const load = (net: { loadFromWeightMap(m: unknown): void }, name: string) => {
        const manifest = JSON.parse(readFileSync(`${this.modelsDir}/${name}-weights_manifest.json`, 'utf8')) as { paths: string[]; weights: unknown[] }[];
        const buf = Buffer.concat(manifest.flatMap((g) => g.paths.map((p) => readFileSync(`${this.modelsDir}/${p}`))));
        const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        net.loadFromWeightMap(faceapi.tf.io.decodeWeights(data, manifest.flatMap((g) => g.weights) as never));
      };
      load(faceapi.nets.tinyFaceDetector, 'tiny_face_detector_model');
      load(faceapi.nets.faceLandmark68TinyNet, 'face_landmark_68_tiny_model');
      load(faceapi.nets.faceRecognitionNet, 'face_recognition_model');
      return faceapi;
    })();
    this.loading.catch(() => (this.loading = null));
    return this.loading;
  }

  /** Find the face in one JPEG picture (a data URL from the app camera). Null when there is no face. */
  async analyse(image: string): Promise<FaceFrame | null> {
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(image);
    if (!m) return null;
    const faceapi = await this.engine();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jpeg = require('jpeg-js') as typeof import('jpeg-js');
    let raw: { width: number; height: number; data: Uint8Array };
    try {
      raw = jpeg.decode(Buffer.from(m[1], 'base64'), { useTArray: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
    } catch {
      return null;
    }
    const rgb = new Uint8Array(raw.width * raw.height * 3);
    for (let i = 0, j = 0; i < raw.data.length; i += 4, j += 3) {
      rgb[j] = raw.data[i];
      rgb[j + 1] = raw.data[i + 1];
      rgb[j + 2] = raw.data[i + 2];
    }
    const t = faceapi.tf.tensor3d(rgb, [raw.height, raw.width, 3], 'int32');
    try {
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
      const all = await faceapi.detectAllFaces(t as never, opts).withFaceLandmarks(true).withFaceDescriptors();
      if (!all.length) return null;
      const best = all.reduce((a, b) => (b.detection.score > a.detection.score ? b : a));
      return { descriptor: Array.from(best.descriptor), turn: turnOf(best.landmarks.positions), faces: all.length };
    } finally {
      t.dispose();
    }
  }
}
