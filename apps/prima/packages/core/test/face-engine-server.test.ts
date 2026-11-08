// Prima's own face engine on the server (FACE_ENGINE=server, Fauzan 5 Nov 2026): the phone sends only pictures for a
// random head-movement challenge; the server reads them. The engine is stubbed with synthetic numbers here (no real
// faces); the real engine is exercised in apps/api/test/face-engine.test.ts. Mock data only, never staging.
import { describe, expect, it } from 'vitest';
import {
  BadRequest,
  FACE_DESCRIPTOR_LEN,
  MemoryStore,
  PrimaService,
  faceChallengeSteps,
  generateDataset,
  judgeFaceFrames,
  myt,
  turnOf,
  type FaceFrame,
  type FaceStep,
} from '../src';

const TODAY = '2026-10-26';
const NOW = myt(TODAY, '08:40');
const me = Array.from({ length: FACE_DESCRIPTOR_LEN }, (_, i) => Math.sin(i + 1) / 10);
const other = me.map((x, i) => x + (i % 2 ? 0.12 : -0.12));
const pic = (name: string) => 'data:image/jpeg;base64,' + btoa(name);
const TURN: Record<FaceStep, number> = { centre: 0.02, left: 0.25, right: -0.25 };
const frame = (step: FaceStep, d = me): FaceFrame => ({ descriptor: d, turn: TURN[step], faces: 1 });

/** 68 synthetic landmark points with the nose tip (30) a given share of the jaw width (0..16) from the middle. */
function points(nose: number) {
  const p = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
  p[0] = { x: 100, y: 0 };
  p[16] = { x: 300, y: 0 };
  p[30] = { x: 200 + nose * 200, y: 0 };
  return p;
}

describe('Own face engine: challenge and judgement', () => {
  it('reads the head turn from the landmarks', () => {
    expect(turnOf(points(0))).toBe(0);
    expect(turnOf(points(0.3))).toBe(0.3);
    expect(turnOf(points(-0.2))).toBe(-0.2);
    expect(turnOf([])).toBe(0);
  });

  it('makes a challenge of facing, a turn, facing, a turn, in random order', () => {
    expect(faceChallengeSteps(() => 0.1)).toEqual(['centre', 'left', 'centre', 'left']);
    expect(faceChallengeSteps(() => 0.9)).toEqual(['centre', 'right', 'centre', 'right']);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(faceChallengeSteps(Math.random).join('-'));
    expect(seen.size).toBe(4);
  });

  const steps: FaceStep[] = ['centre', 'left', 'centre', 'right'];

  it('passes the right person who followed every step', () => {
    const v = judgeFaceFrames(steps, steps.map((s) => frame(s)), me);
    expect(v).toEqual({ score: 1, live: true, reasons: [] });
  });

  it('refuses a still photo, a wrong turn, a missing face, two faces and a swapped face', () => {
    expect(judgeFaceFrames(steps, steps.map(() => frame('centre')), me).live).toBe(false);
    const wrong = judgeFaceFrames(steps, [frame('centre'), frame('right'), frame('centre'), frame('right')], me);
    expect(wrong.reasons).toEqual(['picture 2 did not turn left']);
    expect(judgeFaceFrames(steps, [frame('centre'), null, frame('centre'), frame('right')], me).reasons).toEqual(['no face in picture 2']);
    expect(judgeFaceFrames(steps, [frame('centre'), { ...frame('left'), faces: 2 }, frame('centre'), frame('right')], me).live).toBe(false);
    const swapped = judgeFaceFrames(steps, [frame('centre'), frame('left', other), frame('centre'), frame('right')], me);
    expect(swapped.reasons).toContain('the pictures are not all the same person');
    expect(judgeFaceFrames(steps, steps.slice(0, 3).map((s) => frame(s)), me).live).toBe(false);
  });

  it('scores another person below the match line even when they follow the steps', () => {
    const v = judgeFaceFrames(steps, steps.map((s) => frame(s, other)), me);
    expect(v.live).toBe(true);
    expect(v.score).toBeLessThan(0.8);
  });
});

describe('Own face engine: the clock-in face check', () => {
  function fresh() {
    const ds = generateDataset({ today: TODAY, now: NOW });
    let now = NOW;
    const svc = new PrimaService(new MemoryStore(ds), () => now);
    return { ds, svc, later: (min: number) => (now = new Date(Date.parse(now) + min * 60_000).toISOString()) };
  }
  /** A stub engine: each synthetic picture name stands for what the real engine would find in it. */
  const engine = (map: Record<string, FaceFrame | null>) => async (img: string) => map[atob(img.split(',')[1])] ?? null;

  async function ready(descriptorBy: 'phone' | 'server', registered = me) {
    const f = fresh();
    const u = await f.svc.user('u-cm-inas');
    await f.svc.registerFace(u, { photo: pic('reg'), descriptor: registered, descriptorBy });
    await f.svc.decideFace(await f.svc.user('u-pwvsb-hr'), u.personId!, true, 'Matches the staff photo');
    await f.svc.staffSessionStart(u);
    return { ...f, u };
  }
  const steps: FaceStep[] = ['centre', 'right', 'centre', 'left'];
  const frames = steps.map((_, i) => pic(`f${i}`));
  /** What the API passes: the clock the challenge was for, and what the engine found in each picture. */
  const check = async (svc: PrimaService, u: Awaited<ReturnType<PrimaService['user']>>, map: Record<string, FaceFrame | null>, pics = frames) => {
    const found = await Promise.all(pics.map(engine(map)));
    return svc.staffFaceCheckFrames(u, { clockId: await svc.faceCheckClock(u), steps, frames: pics, found, capturedAt: NOW }, engine(map));
  };
  const good = { reg: frame('centre'), f0: frame('centre'), f1: frame('right'), f2: frame('centre'), f3: frame('left') };

  it('clears the face check for the right person and keeps the first facing picture for HR', async () => {
    const { svc, u, ds } = await ready('server');
    const done = await check(svc, u, good);
    expect(done.flags).toEqual([]);
    expect(done.faceCheck!.face).toEqual({ score: 1, live: true });
    expect(done.faceCheck!.image).toBe(frames[0]);
    expect(ds.audit.at(-1)!.summary).toContain('Prima engine, steps centre-right-centre-left');
    await expect(check(svc, u, good)).rejects.toThrow(/already done/);
  });

  it('reads a face registered with the phone engine again from its approved photo, never from the phone numbers', async () => {
    // The phone sent made-up numbers at registration that match the impostor; the approved photo is the real person.
    const { svc, u } = await ready('phone', other);
    const impostor = { reg: frame('centre', me), f0: frame('centre', other), f1: frame('right', other), f2: frame('centre', other), f3: frame('left', other) };
    const done = await check(svc, u, impostor);
    expect(done.flags).toContain('FACE_NOT_MATCHED');
    expect(done.flags).not.toContain('FACE_PENDING');
  });

  it('flags a held-up photo as not live but keeps the clock', async () => {
    const { svc, u, ds } = await ready('server');
    const still = { f0: frame('centre'), f1: frame('centre'), f2: frame('centre'), f3: frame('centre') };
    const done = await check(svc, u, still);
    expect(done.flags).toEqual(['NO_LIVENESS']);
    expect(done.out).toBeNull();
    expect(ds.audit.at(-1)!.summary).toContain('picture 2 did not turn right');
  });

  it('refuses a challenge made for another clock in', async () => {
    const { svc, u } = await ready('server');
    const found = await Promise.all(frames.map(engine(good)));
    await expect(svc.staffFaceCheckFrames(u, { clockId: 'sc-old', steps, frames, found, capturedAt: NOW }, engine(good))).rejects.toThrow(/another clock in/);
  });

  it('tells HR when the approved registration photo has no readable face', async () => {
    const { svc, u, ds } = await ready('phone');
    const { reg: _reg, ...noReg } = good;
    const done = await check(svc, u, noReg);
    expect(done.flags).toEqual(['FACE_NOT_MATCHED']);
    expect(ds.audit.at(-1)!.summary).toContain('registration photo has no readable face');
  });

  it('refuses gallery pictures, the wrong number of pictures, and anyone without an approved face', async () => {
    const { svc, u } = await ready('server');
    await expect(check(svc, u, good, frames.slice(1))).rejects.toThrow(/one picture for each step/);
    await expect(check(svc, u, good, ['data:image/png;base64,AA', ...frames.slice(1)])).rejects.toBeInstanceOf(BadRequest);
    const f = fresh();
    const plain = await f.svc.user('u-cm-sasa');
    await f.svc.staffSessionStart(plain);
    await expect(f.svc.faceCheckClock(plain)).rejects.toThrow(/already done|not clocked in/);
    await expect(f.svc.staffFaceCheckFrames(plain, { clockId: 'x', steps, frames, found: [], capturedAt: NOW }, engine(good))).rejects.toThrow();
  });
});
