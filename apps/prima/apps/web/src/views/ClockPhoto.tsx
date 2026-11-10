/**
 * P97 (Fitri, 11 Nov 2026: "In Prima clock-in I can clock in, but where is the face scan/snap?"): the face photo at each
 * check-in and check-out. It is the same camera and face check as the sign-in face check and the face registration
 * (FaceCheck.tsx FaceCapture: the free face engine on the phone finds the face, checks it moved between two looks, and
 * makes the numbers the server matches against the face HR approved). The photo is made smaller on the phone before it
 * is sent (about 480 px). Without a camera the person writes why and their manager or HR looks at it.
 */
import { useEffect, useState } from 'react';
import { ArrowClockwiseIcon, CameraIcon, CheckCircleIcon, ProhibitIcon, UserFocusIcon } from '@phosphor-icons/react';
import { api } from '../api';
import { Chip, useLoad } from '../ui';
import { FaceCapture, type FaceResult } from './FaceCheck';
import { PermissionHelp } from './PermissionHelp';
import { queryPermission, type PermState } from './checkin-permissions';

/** What a check-in or check-out sends: the photo, or no camera with the reason. */
export type ClockPhoto = { face: { image: string; descriptor: number[]; live: boolean }; noCamera: null } | { face: null; noCamera: { reason: string } };

/** The photo made smaller (longest side `max` px, JPEG): about 30-60 kB instead of up to 2.5 MB. */
export function compressPhoto(dataUrl: string, max = 480, quality = 0.72): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
      const w = Math.max(1, Math.round((img.naturalWidth || max) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || max) * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, w, h);
      const out = c.toDataURL('image/jpeg', quality);
      resolve(out.startsWith('data:image/jpeg') && out.length < dataUrl.length ? out : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Where the face engine runs here (the server's own setting); the phone engine when it cannot be read. */
function useFaceEngine(): 'phone' | 'server' {
  const { data } = useLoad(() => api.myFace().then((f) => f.engine ?? 'phone').catch(() => 'phone' as const), []);
  return data ?? 'phone';
}

/**
 * The face photo step: open the camera (with help when it is blocked), take the photo, see it, retake or go on. Or, with
 * no camera, write why. `kind` words the step for a check-in or a check-out.
 */
export function ClockPhotoStep({
  kind,
  reasonMin,
  value,
  onDone,
  onBack,
  test = false,
}: {
  kind: 'in' | 'out';
  reasonMin: number;
  value: ClockPhoto | null;
  onDone: (p: ClockPhoto) => void;
  onBack?: () => void;
  /** The owner's TEST check-in: never matched with a registered face. */
  test?: boolean;
}) {
  const [perm, setPerm] = useState<PermState>('unknown');
  const [noCam, setNoCam] = useState(!!value?.noCamera);
  const [reason, setReason] = useState(value?.noCamera?.reason ?? '');
  const [shot, setShot] = useState<{ image: string; descriptor: number[]; live: boolean } | null>(value?.face ?? null);
  const [working, setWorking] = useState(false);
  const engine = useFaceEngine();
  useEffect(() => {
    void queryPermission('camera').then(setPerm);
  }, []);
  const took = async (r: FaceResult) => {
    setWorking(true);
    try {
      setShot({ image: await compressPhoto(r.photo), descriptor: r.descriptor, live: r.live });
      setNoCam(false);
    } finally {
      setWorking(false);
    }
  };
  const word = kind === 'in' ? 'check-in' : 'check-out';
  const found = !!shot && shot.descriptor.length > 0;
  return (
    <section className="ci-step cph" aria-live="polite">
      {!shot && !noCam && (
        <div className="ci-ask">
          <span className="ci-ask-icon" aria-hidden="true">
            <UserFocusIcon size={28} />
          </span>
          <p className="ci-ask-title">Face photo</p>
          <p className="ci-ask-sub">
            {test
              ? 'Look at the camera: the photo is taken by itself once your face is in the oval. Test only: kept with this test, seen only by you.'
              : `Look at the camera: the photo is taken by itself once your face is in the oval. It is kept with your ${word} and seen only by you, your manager and HR.`}
          </p>
          {perm === 'denied' ? (
            <div className="ci-blocked">
              <p className="notice" data-tone="warn">
                The camera is blocked for Prima. Allow it with these steps, then open the camera.
              </p>
              <PermissionHelp kind="camera" />
            </div>
          ) : (
            perm !== 'granted' && <p className="ss-note">Your browser will ask to use the camera. Choose Allow.</p>
          )}
          <FaceCapture label={working ? 'Preparing the photo…' : 'Open the camera'} title={kind === 'in' ? 'Face photo for check-in' : 'Face photo for check-out'} busy={working} photoOnly={engine === 'server'} onCapture={(r) => void took(r)} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNoCam(true)}>
            Camera not working?
          </button>
        </div>
      )}

      {shot && (
        <div className="cph-done">
          <img className="cph-photo" src={shot.image} alt={`Your ${word} photo`} />
          <div className="cph-facts">
            <p className="ci-ask-title">
              <CheckCircleIcon size={20} weight="fill" aria-hidden="true" /> Photo taken
            </p>
            <div className="ss-chips">
              {engine === 'server' ? (
                <Chip tone="info">Checked on the server</Chip>
              ) : (
                <Chip tone={found ? 'ok' : 'warn'}>{found ? 'Face found' : 'No face found'}</Chip>
              )}
              {found && <Chip tone={shot.live ? 'ok' : 'warn'}>{shot.live ? 'Face moved: live' : 'Face did not move'}</Chip>}
            </div>
            {found && !shot.live && <p className="ss-note">A still face can be a photo held up. Your manager or HR will look at it; you can also retake it.</p>}
            {!found && engine !== 'server' && <p className="ss-note">The face check found no face. Retake it in good light, or go on: your manager or HR will look at it.</p>}
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => onDone({ face: shot, noCamera: null })}>
                Use this photo
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShot(null)}>
                <ArrowClockwiseIcon size={16} aria-hidden="true" /> Retake
              </button>
            </div>
          </div>
        </div>
      )}

      {!shot && noCam && (
        <div className="ci-blocked">
          <p className="ci-ask-title">
            <ProhibitIcon size={20} aria-hidden="true" /> No camera
          </p>
          <label className="field">
            <span className="label">Why can the camera not be used? (needed)</span>
            <textarea
              className="textarea"
              value={reason}
              maxLength={500}
              placeholder="For example: the phone's front camera is broken; I will fix it this week"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="ss-note">{test ? 'Test only: kept with this test.' : `Your ${word} is still recorded. Your manager or HR looks at it, with your reason.`}</p>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={reason.trim().length < reasonMin} onClick={() => onDone({ face: null, noCamera: { reason: reason.trim() } })}>
              Continue without a photo
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setNoCam(false)}>
              <CameraIcon size={16} aria-hidden="true" /> Try the camera
            </button>
          </div>
          {reason.trim().length > 0 && reason.trim().length < reasonMin && <p className="ss-note">{`At least ${reasonMin} characters.`}</p>}
        </div>
      )}

      {onBack && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          Back
        </button>
      )}
    </section>
  );
}

/** A check-in or check-out photo on a record: the picture, or why there is none, and what was found. */
export function ClockPhotoCard({
  label,
  snap,
}: {
  label: string;
  snap: {
    image: string;
    kept?: boolean;
    mode: 'face' | 'photo' | 'none';
    faceFound: boolean;
    live: boolean;
    face: { score: number; matched: boolean } | null;
    reason: string | null;
    review: { status: 'open' | 'cleared' | 'upheld'; by: string | null; note: string } | null;
    at: string;
  };
}) {
  return (
    <div className="cph-card">
      <span className="label">{label}</span>
      {snap.image ? (
        <img className="cph-photo cph-photo-sm" src={snap.image} alt={label} />
      ) : (
        <span className="cph-nophoto" aria-hidden="true">
          <ProhibitIcon size={22} />
        </span>
      )}
      <span className="small mono">{snap.at.slice(11, 16)}</span>
      <div className="ss-chips">
        {snap.mode === 'none' ? (
          <Chip tone="warn">{snap.reason ? 'No camera' : 'No photo'}</Chip>
        ) : snap.mode === 'face' && snap.face ? (
          <Chip tone={snap.face.matched ? 'ok' : 'crit'}>{snap.face.matched ? `Face matched ${Math.round(snap.face.score * 100)}%` : `Face not matched ${Math.round(snap.face.score * 100)}%`}</Chip>
        ) : (
          <Chip tone={snap.faceFound ? 'neutral' : 'warn'}>{snap.faceFound ? 'Face photo, no registered face' : 'No face found'}</Chip>
        )}
        {snap.mode !== 'none' && snap.faceFound && <Chip tone={snap.live ? 'ok' : 'warn'}>{snap.live ? 'Live' : 'Face did not move'}</Chip>}
        {snap.review && <Chip tone={snap.review.status === 'open' ? 'warn' : snap.review.status === 'cleared' ? 'ok' : 'crit'}>{snap.review.status === 'open' ? 'To look at' : snap.review.status === 'cleared' ? 'Cleared' : 'Followed up'}</Chip>}
      </div>
      {snap.reason && <span className="small">“{snap.reason}”</span>}
      {!snap.image && snap.mode !== 'none' && <span className="small muted">The picture is no longer kept.</span>}
      {snap.review && snap.review.status !== 'open' && (
        <span className="small muted">
          {snap.review.by}: {snap.review.note}
        </span>
      )}
    </div>
  );
}
