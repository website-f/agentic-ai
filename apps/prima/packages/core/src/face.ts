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
