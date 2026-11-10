// P97 (Fitri, 11 Nov 2026: "In Prima clock-in I can clock in, but where is the face scan/snap?"): a face photo at each
// check-in and check-out, taken on the person's own phone with the same face check the guards and the sign-in face check
// use (FaceCheck.tsx: the free face engine on the phone finds the face and checks it moved; the server scores it against
// the face HR approved). Without a camera the person says why and a manager or HR looks at it.
//
// Before P97 the check-in asked for a face only when the person had a face HR had approved AND their sign-in clock was
// still waiting for its face check (FACE_PENDING); most staff have no approved face yet, so they never saw a camera, and
// the owner's TEST check-in had none at all. Check-out never asked.
//
// The photo is kept in its own table (prima.clock_snaps, db/modules/clock-snaps-v1.sql), readable only by the person and
// the managers and HR who see that person's staff clock (row-level security says so too), never by colleagues. It is
// compressed on the phone (about 480 px, JPEG) and its picture is dropped after the location retention (HR-STAFF-KEEP).
// Like a guard's check-in, a missing or unmatched face never refuses the check-in: it is recorded and reviewed.
import type { Id, IsoDate, IsoDateTime } from './types';

/** How the face was taken: matched against the approved face, a face photo without a registered face, or no photo. */
export type SnapMode = 'face' | 'photo' | 'none';
/** Why a manager or HR looks at it. */
export type SnapWhy = 'no_camera' | 'no_photo' | 'not_matched' | 'not_live' | 'no_face';
export type SnapReviewStatus = 'open' | 'cleared' | 'upheld';

export interface ClockSnapReview {
  status: SnapReviewStatus;
  why: SnapWhy[];
  by: string | null;
  byId: Id | null;
  at: IsoDateTime | null;
  note: string;
}

export interface ClockSnap {
  id: Id;
  userId: Id;
  userName: string;
  /** The clock's company (the staff clock wall); null for PWVSB central staff. */
  companyId: Id | null;
  clockId: Id | null;
  /** The check-in or check-out it belongs to. */
  eventId: Id;
  kind: 'in' | 'out';
  /** Server time. */
  at: IsoDateTime;
  capturedAt: IsoDateTime;
  /** The compressed photo (data:image/jpeg); '' once the retention has passed or with no photo. */
  image: string;
  sha256: string;
  mode: SnapMode;
  /** The person had a face HR approved when this was taken. */
  enrolled: boolean;
  /** The phone's face engine found a face in the photo (it made a descriptor). */
  faceFound: boolean;
  /** The phone saw the face move between two looks (a basic check that it is not a photo held up). */
  live: boolean;
  /** Matched against the approved face (score 0 to 1), only when enrolled. */
  face: { score: number; matched: boolean } | null;
  /** Without a camera: what the person wrote. */
  reason: string | null;
  review: ClockSnapReview | null;
  /** Waiting for a manager or HR (kept beside review so the list can be read by it). */
  reviewOpen: boolean;
  /** The picture is kept until this day (HR-STAFF-KEEP), then blanked. */
  keepUntil: IsoDate;
}

/** What the phone sends with a check-in or check-out. */
export interface SnapInput {
  image: string;
  /** The phone engine's 128 numbers; empty when the photo was taken without the phone engine. */
  descriptor: number[];
  live: boolean;
}

/** A compressed photo is about 30-80 kB as text; old phones may send the 640 px photo. More than this is refused. */
export const SNAP_MAX_CHARS = 400_000;
export const SNAP_REASON_MIN = 10;

/** Why the photo cannot be kept, or null. */
export function snapImageProblem(image: unknown): string | null {
  if (typeof image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)) return 'Take the photo with the app camera.';
  if (image.length > SNAP_MAX_CHARS) return 'The photo is too large. Take it again.';
  return null;
}

/**
 * What a manager or HR looks at: no camera (with the person's reason), no photo at all (an older app, or nothing sent),
 * a registered face that did not match, a face that did not move, or a photo with no face in it.
 */
export function snapReviewWhy(s: Pick<ClockSnap, 'mode' | 'enrolled' | 'faceFound' | 'live' | 'face' | 'reason'>, engineOnPhone = true): SnapWhy[] {
  if (s.mode === 'none') return [s.reason ? 'no_camera' : 'no_photo'];
  const why: SnapWhy[] = [];
  // With Prima's own engine on the server the phone makes no face numbers: the photo is kept, not judged here.
  if (engineOnPhone && !s.faceFound) why.push('no_face');
  if (s.enrolled && s.face && !s.face.matched) why.push('not_matched');
  if (s.faceFound && !s.live) why.push('not_live');
  return why;
}

/** The snapshot as the screen gets it: the picture only while it is kept. */
export function snapView(s: ClockSnap, today: IsoDate): ClockSnap & { kept: boolean } {
  const kept = s.keepUntil >= today && !!s.image;
  return { ...s, image: kept ? s.image : '', kept };
}
