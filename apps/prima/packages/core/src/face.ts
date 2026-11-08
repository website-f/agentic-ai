/**
 * Face recognition for staff clock in (Fauzan, 2 Nov 2026: "use face recognition also for clock in"; engine choice:
 * the free engine on the phone).
 *
 * The phone runs the free face engine (face-api, in the browser) and turns each photo into a face descriptor: 128
 * numbers that describe the face. The registered descriptor stays on the server, behind the HR wall and the person's
 * own row; the phone never receives it. At each face check the phone sends the new descriptor and the photo, and the
 * server compares the two. Because the phone computes the descriptor, a determined person could fake it, so every
 * check photo is kept for HR to spot-check (the risk Fauzan accepted with this engine).
 */

/** Length of a face descriptor from the face engine. */
export const FACE_DESCRIPTOR_LEN = 128;

/** A face descriptor is 128 finite numbers, each within the engine's range. */
export function validFaceDescriptor(d: unknown): d is number[] {
  return Array.isArray(d) && d.length === FACE_DESCRIPTOR_LEN && d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 2);
}

/** Euclidean distance between two descriptors. The engine treats 0.6 or less as the same person. */
export function faceDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/**
 * Match score from 0 to 1. The engine's usual same-person distance (0.6) maps to 0.8, the match threshold in rule
 * OPS-FACE-MATCH, so a score of 0.8 or more is a match.
 */
export function faceScore(a: number[], b: number[]): number {
  return Math.max(0, Math.min(1, Math.round((1 - faceDistance(a, b) / 3) * 1000) / 1000));
}

// ---------- Own engine on Prima's server (Fauzan, 5 Nov 2026: "create our own or find a low-cost one") ----------
//
// Behind the FACE_ENGINE switch (API). With 'server', the phone only takes the pictures: Prima's own server runs the
// same free engine on them, so a phone cannot send a made-up descriptor. The phone is asked for a short random head
// movement (a challenge the server signs), and every picture must show the same person, so a printed photo or a
// pre-recorded video is refused. A deepfake played into a tampered phone, or a good mask, can still pass: stronger
// proof needs a paid liveness service or a native app with device attestation (docs/FACE_ENGINE.md).

/** 'phone': the phone makes the descriptor (2 Nov 2026 build). 'server': Prima's server makes it from the pictures. */
export type FaceEngineMode = 'phone' | 'server';

/** One step of the head-movement challenge. 'left' and 'right' are the person's own left and right. */
export type FaceStep = 'centre' | 'left' | 'right';

/** What the server's engine found in one picture. */
export interface FaceFrame {
  /** 128 numbers for the face in the picture. */
  descriptor: number[];
  /** Head turn from the landmarks: about 0 facing the camera, positive turned to the person's left (turnOf). */
  turn: number;
  /** How many faces the engine found; more than one is refused. */
  faces: number;
}

/** Pictures in a challenge: facing, a turn, facing, a turn. Four pictures, four possible orders. */
export const FACE_CHALLENGE_STEPS = 4;
/** Facing the camera: the nose within this share of the face width from the middle (proposal, to tune on real phones). */
export const FACE_TURN_CENTRE_MAX = 0.1;
/** A turn: the nose at least this share of the face width from the middle (proposal, to tune on real phones). */
export const FACE_TURN_MIN = 0.16;
/** Seconds a challenge stays open. */
export const FACE_CHALLENGE_TTL_S = 90;

/** A fresh random challenge: facing, a random turn, facing, a random turn. */
export function faceChallengeSteps(random: () => number): FaceStep[] {
  const turn = (): FaceStep => (random() < 0.5 ? 'left' : 'right');
  return ['centre', turn(), 'centre', turn()];
}

/**
 * Head turn from the 68 face landmarks of a picture as the camera took it (not mirrored): where the nose tip (point 30)
 * sits between the two sides of the jaw (points 0 and 16), from -0.5 to 0.5. When a person turns to their own left,
 * their nose moves to the right of the picture, so the value goes up.
 */
export function turnOf(points: { x: number; y: number }[]): number {
  if (points.length < 31) return 0;
  const a = points[0].x;
  const b = points[16].x;
  const w = b - a;
  if (!Number.isFinite(w) || Math.abs(w) < 1) return 0;
  return Math.round(((points[30].x - a) / w - 0.5) * 1000) / 1000;
}

function stepMet(step: FaceStep, turn: number): boolean {
  if (step === 'centre') return Math.abs(turn) <= FACE_TURN_CENTRE_MAX;
  return step === 'left' ? turn >= FACE_TURN_MIN : turn <= -FACE_TURN_MIN;
}

export interface FaceVerdict {
  /** Best match of the facing pictures with the registered face, 0 to 1 (faceScore). */
  score: number;
  /** Every picture had one face, followed its step, and showed the same person. */
  live: boolean;
  /** Why it is not live, in plain words, for HR. */
  reasons: string[];
}

/**
 * The server's judgement of a challenge. It never decides more than the flags: a face that does not match or does not
 * move is flagged for HR, as before; the clock itself is kept.
 */
export function judgeFaceFrames(steps: FaceStep[], frames: (FaceFrame | null)[], registered: number[]): FaceVerdict {
  const reasons: string[] = [];
  if (frames.length !== steps.length) reasons.push(`${frames.length} pictures for ${steps.length} steps`);
  const ok = frames.filter((f): f is FaceFrame => !!f && validFaceDescriptor(f.descriptor));
  frames.forEach((f, i) => {
    if (!f) reasons.push(`no face in picture ${i + 1}`);
    else if (f.faces > 1) reasons.push(`more than one face in picture ${i + 1}`);
    else if (i < steps.length && !stepMet(steps[i], f.turn)) reasons.push(`picture ${i + 1} did not ${steps[i] === 'centre' ? 'face the camera' : `turn ${steps[i]}`}`);
  });
  // Every picture must be the same person as the first one: no swapping a face in half way.
  if (ok.length > 1 && ok.some((f) => faceScore(ok[0].descriptor, f.descriptor) < 0.8)) reasons.push('the pictures are not all the same person');
  const facing = frames.filter((f, i): f is FaceFrame => !!f && steps[i] === 'centre' && validFaceDescriptor(f.descriptor));
  const score = validFaceDescriptor(registered) && facing.length ? Math.max(...facing.map((f) => faceScore(registered, f.descriptor))) : 0;
  return { score, live: reasons.length === 0, reasons };
}
