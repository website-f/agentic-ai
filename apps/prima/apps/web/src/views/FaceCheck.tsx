import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CameraIcon, CameraRotateIcon, XIcon } from '@phosphor-icons/react';
import { FACE_DESCRIPTOR_LEN } from '@prima/core';
import { PermissionHelp } from './PermissionHelp';
import { CAMERA_PROBLEM_TEXT, cameraProblem, type CameraProblem } from './checkin-permissions';
import { listCameras, openCamera, stopStream, whenIdle } from './camera-stream';
import '../styles/camera.css';
import '../styles/checkin.css';

declare const __DEMO__: boolean;

/**
 * Face recognition on the phone (Fauzan, 2 Nov 2026: the free engine on the phone). The phone finds the face, makes
 * its descriptor (128 numbers) and sends it with the photo; the server compares it with the face HR approved. The
 * engine files are served by Prima itself (/face-models), never from another site.
 */
type FaceApi = typeof import('@vladmandic/face-api');
let loading: Promise<FaceApi> | null = null;

async function engine(): Promise<FaceApi> {
  if (__DEMO__) throw new Error('The test version has no face engine.');
  loading ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    // Under the site's base path (the Agentic Office serves Prima at /prima/); the build copies the files (vite.config.ts).
    const url = `${import.meta.env.BASE_URL}face-models`;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(url),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
      faceapi.nets.faceRecognitionNet.loadFromUri(url),
    ]);
    return faceapi;
  })();
  return loading;
}

export interface FaceResult {
  photo: string;
  descriptor: number[];
  /** Basic movement check: the face moved a little between two frames, so it is less likely a still photo. */
  live: boolean;
}

/** The test version stands in for the engine: the same face every time. */
function testDescriptor(): number[] {
  return Array.from({ length: FACE_DESCRIPTOR_LEN }, (_, i) => Math.round(Math.sin(i + 1) * 1000) / 10000);
}

function snapshot(v: HTMLVideoElement): string {
  const w = Math.min(640, v.videoWidth || 640);
  const h = v.videoWidth ? Math.round((v.videoHeight * w) / v.videoWidth) : 480;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  if (v.videoWidth) ctx.drawImage(v, 0, 0, w, h);
  else {
    ctx.fillStyle = '#5b6b75';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(0, h - 26, w, 26);
  ctx.fillStyle = '#fff';
  ctx.font = '14px sans-serif';
  ctx.fillText(new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }), 8, h - 8);
  return c.toDataURL('image/jpeg', 0.8);
}

/**
 * The button that opens the camera. The camera itself is a full-screen view (P78): the front camera fills the screen,
 * an oval shows where the face goes, and live words say what to do. The photo and the face descriptor it makes are the
 * same as before; only the way it looks changed.
 */
export function FaceCapture({
  label,
  busy,
  onCapture,
  title,
  photoOnly = false,
}: {
  label: string;
  busy?: boolean;
  onCapture: (r: FaceResult) => void;
  /** The heading on the camera screen; the button's label when not given. */
  title?: string;
  /** Prima's own engine reads the photo on the server (FACE_ENGINE=server): take the photo only, load no phone engine. */
  photoOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // P90: the face engine loads while the button waits, so the camera screen is ready as soon as it opens.
  useEffect(() => (__DEMO__ || photoOnly ? undefined : whenIdle(() => void engine().catch(() => undefined), 2500)), [photoOnly]);
  return (
    <div className="cam-launch-wrap">
      <button type="button" className="btn btn-primary cam-launch" disabled={busy} onClick={() => setOpen(true)}>
        <CameraIcon size={18} aria-hidden="true" />
        {busy ? 'Sending…' : label}
      </button>
      {__DEMO__ && <div className="muted small">Test version: the face check always matches.</div>}
      {open && (
        <FaceCamera
          title={title ?? label}
          photoOnly={photoOnly}
          onClose={() => setOpen(false)}
          onCapture={(r) => {
            setOpen(false);
            onCapture(r);
          }}
        />
      )}
    </div>
  );
}

type Tone = 'idle' | 'adjust' | 'ok';
interface Status {
  text: string;
  sub?: string;
  tone: Tone;
}

const READY: Status = { text: 'Face found', sub: 'Tap the button to take the photo', tone: 'ok' };

/**
 * Where the face sits against the oval. The video fills the screen (object-fit: cover), so the engine's box is scaled
 * and, for the front camera, mirrored before it is compared with the oval on screen.
 */
function judge(
  box: { x: number; y: number; width: number; height: number } | null,
  v: HTMLVideoElement,
  oval: DOMRect,
  mirrored: boolean,
): Status {
  if (!box) return { text: 'Show your face', sub: 'Look at the screen in good light', tone: 'adjust' };
  const r = v.getBoundingClientRect();
  const vw = v.videoWidth || 1;
  const vh = v.videoHeight || 1;
  const scale = Math.max(r.width / vw, r.height / vh);
  const dx = r.left + (r.width - vw * scale) / 2;
  const dy = r.top + (r.height - vh * scale) / 2;
  const w = box.width * scale;
  const left = mirrored ? r.left + r.width - (dx - r.left + (box.x + box.width) * scale) : dx + box.x * scale;
  const cx = left + w / 2;
  const cy = dy + (box.y + box.height / 2) * scale;
  const ox = oval.left + oval.width / 2;
  const oy = oval.top + oval.height / 2;
  const size = w / oval.width;
  if (size < 0.45) return { text: 'Move closer', sub: 'Fill the oval with your face', tone: 'adjust' };
  if (size > 1.05) return { text: 'Move back a little', sub: 'Keep your whole face inside the oval', tone: 'adjust' };
  if (Math.abs(cx - ox) > oval.width * 0.2 || Math.abs(cy - oy) > oval.height * 0.2)
    return { text: 'Centre your face', sub: 'Line your face up with the oval', tone: 'adjust' };
  return { text: 'Hold still', sub: 'Checking the light and position', tone: 'idle' };
}

function FaceCamera({
  title,
  photoOnly,
  onClose,
  onCapture,
}: {
  title: string;
  photoOnly: boolean;
  onClose: () => void;
  onCapture: (r: FaceResult) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const oval = useRef<HTMLDivElement>(null);
  const shutter = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const reviewing = useRef(false);
  const steady = useRef(0);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  // P81: why the camera did not open (NotAllowedError, NotFoundError ...), to show the right help.
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [engineOk, setEngineOk] = useState(__DEMO__ || photoOnly);
  const [busy, setBusy] = useState(false);
  const [mirrored, setMirrored] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ text: 'Opening the camera', tone: 'idle' });
  // P90: a countdown once the face is in place, a flash when the photo is taken, and the photo shown to keep or retake.
  const [count, setCount] = useState<number | null>(null);
  const [flash, setFlash] = useState(0);
  const [review, setReview] = useState<FaceResult | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const stop = () => {
    stopStream(stream.current);
    stream.current = null;
  };

  /** Front camera first (facingMode 'user'); a chosen camera after the switch button. */
  const start = useCallback(async (id: string | null) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (__DEMO__) setReady(true);
      else {
        // No camera API at all: an insecure address (http) or an old browser.
        const p: CameraProblem = window.isSecureContext === false ? 'insecure' : 'unsupported';
        setProblem(p);
        setBlocked(CAMERA_PROBLEM_TEXT[p]);
      }
      return;
    }
    stop();
    setReady(false);
    try {
      const m = await openCamera('user', id);
      // Closed while the camera was opening: let it go at once.
      if (!alive.current) return m.getTracks().forEach((t) => t.stop());
      stream.current = m;
      const settings = m.getVideoTracks()[0]?.getSettings() ?? {};
      // Mirror the front camera, as a phone does; a desktop webcam says nothing and is a front camera too.
      setMirrored(settings.facingMode !== 'environment');
      setDeviceId(settings.deviceId ?? id);
      if (video.current) {
        video.current.srcObject = m;
        await video.current.play().catch(() => undefined);
      }
      setReady(true);
      setBlocked(null);
      setProblem(null);
      setCameras(await listCameras());
    } catch (e) {
      if (__DEMO__) setReady(true);
      else {
        const p = cameraProblem(e);
        setProblem(p);
        setBlocked(CAMERA_PROBLEM_TEXT[p]);
      }
    }
  }, []);

  // Open the camera and load the engine once; stop the camera when the screen closes.
  useEffect(() => {
    let live = true;
    alive.current = true;
    void start(null);
    if (!__DEMO__ && !photoOnly)
      engine().then(
        () => live && setEngineOk(true),
        () => live && setBlocked('The face check did not load. Check the connection and try again.'),
      );
    return () => {
      live = false;
      alive.current = false;
      stop();
    };
  }, [start]);

  // A full-screen view: no page scroll behind it, Escape closes it, and focus starts on the shutter.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrom = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    // Escape closes the camera only, not a drawer it was opened from (the drawer skips a handled Escape).
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', key, true);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', key, true);
      focusFrom?.focus?.();
    };
  }, []);

  // Live guidance: a light face search a few times a second, paused while the photo is being checked.
  useEffect(() => {
    if (!ready) return;
    if (__DEMO__ || photoOnly) {
      setStatus({ text: 'Centre your face', sub: 'Then tap the button', tone: 'idle' });
      return;
    }
    if (!engineOk) {
      setStatus({ text: 'Getting ready', sub: 'Loading the face check', tone: 'idle' });
      return;
    }
    let off = false;
    let timer = 0;
    const tick = async () => {
      if (off) return;
      const v = video.current;
      const o = oval.current;
      if (v && o && v.readyState >= 2 && !working.current && !reviewing.current) {
        try {
          const faceapi = await engine();
          const d = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }));
          if (!off && !working.current) {
            const s = judge(d?.box ?? null, v, o.getBoundingClientRect(), mirrored);
            steady.current = s.tone === 'idle' ? steady.current + 1 : 0;
            setStatus(steady.current >= 2 ? READY : s);
          }
        } catch {
          // A missed frame is fine; the next one tries again.
        }
      }
      timer = window.setTimeout(() => void tick(), 300);
    };
    void tick();
    return () => {
      off = true;
      window.clearTimeout(timer);
    };
  }, [ready, engineOk, mirrored]);

  // The capture itself is unchanged: one face with its descriptor, a second look 0.7 s later for movement, the photo.
  const take = async () => {
    const v = video.current!;
    working.current = true;
    setBusy(true);
    setStatus({ text: 'Hold still', sub: 'Checking your face', tone: 'idle' });
    setCount(null);
    try {
      if (__DEMO__ || photoOnly) {
        setFlash((n) => n + 1);
        return setReview({ photo: snapshot(v), descriptor: __DEMO__ ? testDescriptor() : [], live: __DEMO__ });
      }
      const faceapi = await engine();
      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
      const first = await faceapi.detectSingleFace(v, opts).withFaceLandmarks(true).withFaceDescriptor();
      if (!first) throw new Error('No face found. Face the camera in good light and try again.');
      await new Promise((r) => setTimeout(r, 700));
      const second = await faceapi.detectSingleFace(v, opts).withFaceLandmarks(true);
      const a = first.landmarks.positions;
      const b = second?.landmarks.positions ?? [];
      const moved = b.length === a.length ? a.reduce((n, p, i) => n + Math.hypot(p.x - b[i].x, p.y - b[i].y), 0) / a.length : 0;
      setStatus({ text: 'Face found', sub: 'Photo taken', tone: 'ok' });
      setFlash((n) => n + 1);
      setReview({ photo: snapshot(v), descriptor: Array.from(first.descriptor), live: moved > 0.8 && moved < 40 });
    } catch (e) {
      steady.current = 0;
      setStatus({ text: 'Try again', sub: e instanceof Error ? e.message : String(e), tone: 'adjust' });
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const flip = () => {
    if (cameras.length < 2) return;
    const at = cameras.findIndex((c) => c.deviceId === deviceId);
    const next = cameras[(at + 1) % cameras.length];
    steady.current = 0;
    void start(next.deviceId || null);
  };

  // P90: while the photo is shown for review, the face search rests.
  useEffect(() => {
    reviewing.current = !!review;
  }, [review]);
  // Face in place and steady: count 3, 2, 1 and take the photo (the button still takes it at once).
  const auto = status === READY && !review && !busy && !blocked;
  useEffect(() => {
    if (!auto) return setCount(null);
    let n = 3;
    setCount(n);
    const t = window.setInterval(() => {
      n -= 1;
      if (n > 0) return setCount(n);
      window.clearInterval(t);
      setCount(null);
      void take();
    }, 700);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);
  const retake = () => {
    steady.current = 0;
    setReview(null);
    setStatus({ text: 'Centre your face', sub: __DEMO__ || photoOnly ? 'Then tap the button' : 'Look at the screen in good light', tone: 'idle' });
  };
  const waiting = !blocked && !review && (!ready || (!__DEMO__ && !photoOnly && !engineOk));

  return createPortal(
    <div ref={dialog} className="cam" role="dialog" aria-modal="true" aria-label={title} data-tone={review ? 'ok' : status.tone} tabIndex={-1}>
      <video ref={video} className="cam-video" data-mirror={mirrored ? 'yes' : undefined} playsInline muted autoPlay />
      {review && <img className="cam-review" src={review.photo} alt="The photo you took" />}
      <div className="cam-frame" aria-hidden="true">
        <div ref={oval} className="cam-oval">
          {waiting && <span className="cam-spinner" />}
          {count !== null && (
            <span key={count} className="cam-count">
              {count}
            </span>
          )}
        </div>
      </div>
      {flash > 0 && <div key={flash} className="cam-flash" aria-hidden="true" />}

      <div className="cam-top">
        <button type="button" className="cam-icon" onClick={onClose} aria-label="Close the camera">
          <XIcon size={24} weight="bold" />
        </button>
        <span className="cam-title">{title}</span>
        {cameras.length > 1 ? (
          <button type="button" className="cam-icon" onClick={flip} disabled={busy} aria-label="Switch camera">
            <CameraRotateIcon size={24} weight="bold" />
          </button>
        ) : (
          <span className="cam-icon-gap" aria-hidden="true" />
        )}
      </div>

      <div className="cam-status" role="status" aria-live="polite">
        {blocked ? (
          <>
            <p className="cam-status-text">Camera not available</p>
            <p className="cam-status-sub">{blocked}</p>
          </>
        ) : review ? (
          <>
            <p className="cam-status-text">Keep this photo?</p>
            <p className="cam-status-sub">Use it, or take it again.</p>
          </>
        ) : (
          <>
            <p className="cam-status-text">{count !== null ? 'Hold still' : status.text}</p>
            {(count !== null || status.sub) && <p className="cam-status-sub">{count !== null ? 'The photo is taken on its own' : status.sub}</p>}
          </>
        )}
      </div>

      <div className="cam-bottom">
        {review ? (
          <div className="cam-review-actions">
            <button type="button" className="btn" onClick={retake}>
              Retake
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onCapture(review)}>
              Use photo
            </button>
          </div>
        ) : blocked ? (
          <div className="cam-sheet">
            {problem === 'denied' && (
              <div className="cam-help">
                <PermissionHelp kind="camera" compact />
              </div>
            )}
            <button type="button" className="btn btn-primary" onClick={() => {
                setBlocked(null);
                void start(deviceId);
              }}>
              Try again
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <button
            ref={shutter}
            type="button"
            className="cam-shutter"
            data-ready={status === READY ? 'yes' : undefined}
            disabled={busy || !ready || (!__DEMO__ && !engineOk)}
            onClick={() => void take()}
            aria-label={busy ? 'Checking your face' : 'Take the photo'}
          >
            <span className="cam-shutter-dot" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

type Step = 'centre' | 'left' | 'right';
const STEP_TEXT: Record<Step, { bm: string; en: string }> = {
  centre: { bm: 'Pandang terus ke kamera', en: 'Look straight at the camera' },
  left: { bm: 'Pusing kepala ke KIRI anda', en: 'Turn your head to YOUR LEFT' },
  right: { bm: 'Pusing kepala ke KANAN anda', en: 'Turn your head to YOUR RIGHT' },
};
/** Time to follow each step before the picture is taken. */
const STEP_MS = 1600;

/**
 * Face check with Prima's own engine (FACE_ENGINE=server, 5 Nov 2026). The server sends a random set of steps (look,
 * turn, look, turn); the phone shows each one, takes a picture and sends the pictures only. The server finds the faces,
 * checks the steps were followed and compares the face. The phone makes no face numbers and no score. The camera is the
 * same full-screen view as FaceCapture.
 */
export function FaceChallengeCapture({
  label,
  busy,
  start,
  onFrames,
}: {
  label: string;
  busy?: boolean;
  start: () => Promise<{ token: string; steps: Step[] }>;
  onFrames: (r: { token: string; frames: string[] }) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cam-launch-wrap">
      <button type="button" className="btn btn-primary cam-launch" disabled={busy} onClick={() => setOpen(true)}>
        <CameraIcon size={18} aria-hidden="true" />
        {busy ? 'Sending…' : label}
      </button>
      {open && (
        <ChallengeCamera
          title={label}
          start={start}
          onClose={() => setOpen(false)}
          onFrames={(r) => {
            setOpen(false);
            onFrames(r);
          }}
        />
      )}
    </div>
  );
}

function ChallengeCamera({
  title,
  start,
  onClose,
  onFrames,
}: {
  title: string;
  start: () => Promise<{ token: string; steps: Step[] }>;
  onClose: () => void;
  onFrames: (r: { token: string; frames: string[] }) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<{ n: number; of: number; kind: Step } | null>(null);
  const [shots, setShots] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;

  // The front camera, opened once and stopped when the screen closes.
  useEffect(() => {
    let s: MediaStream | null = null;
    alive.current = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      const p: CameraProblem = window.isSecureContext === false ? 'insecure' : 'unsupported';
      setProblem(p);
      setBlocked(CAMERA_PROBLEM_TEXT[p]);
      return;
    }
    openCamera('user')
      .then(async (m) => {
        if (!alive.current) return m.getTracks().forEach((t) => t.stop());
        s = m;
        if (video.current) {
          video.current.srcObject = m;
          await video.current.play().catch(() => undefined);
        }
        setReady(true);
      })
      .catch((e) => {
        const p = cameraProblem(e);
        setProblem(p);
        setBlocked(CAMERA_PROBLEM_TEXT[p]);
      });
    return () => {
      alive.current = false;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // A full-screen view: no page scroll behind it, and Escape closes it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrom = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', key, true);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', key, true);
      focusFrom?.focus?.();
    };
  }, []);

  const run = async () => {
    setErr(null);
    try {
      const c = await start();
      const frames: string[] = [];
      for (let i = 0; i < c.steps.length; i++) {
        if (!alive.current) return;
        setStep({ n: i + 1, of: c.steps.length, kind: c.steps[i] });
        await new Promise((r) => setTimeout(r, STEP_MS));
        // The picture as the camera took it (the preview is mirrored, the picture is not).
        frames.push(snapshot(video.current!));
        setShots((n) => n + 1);
      }
      setStep(null);
      if (alive.current) onFrames({ token: c.token, frames });
    } catch (e) {
      setStep(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return createPortal(
    <div ref={dialog} className="cam" role="dialog" aria-modal="true" aria-label={title} data-tone={step ? 'ok' : err ? 'adjust' : 'idle'} tabIndex={-1}>
      <video ref={video} className="cam-video" data-mirror="yes" playsInline muted autoPlay />
      <div className="cam-frame" aria-hidden="true">
        <div className="cam-oval">{!ready && !blocked && <span className="cam-spinner" />}</div>
      </div>
      {shots > 0 && <div key={shots} className="cam-flash" aria-hidden="true" />}

      <div className="cam-top">
        <button type="button" className="cam-icon" onClick={onClose} aria-label="Close the camera">
          <XIcon size={24} weight="bold" />
        </button>
        <span className="cam-title">{title}</span>
        <span className="cam-icon-gap" aria-hidden="true" />
      </div>

      <div className="cam-status" role="status" aria-live="assertive">
        {blocked ? (
          <>
            <p className="cam-status-text">Camera not available</p>
            <p className="cam-status-sub">{blocked}</p>
          </>
        ) : step ? (
          <>
            <p className="cam-status-text">{STEP_TEXT[step.kind].bm}</p>
            <p className="cam-status-sub">
              {STEP_TEXT[step.kind].en} · {step.n}/{step.of}
            </p>
            <div className="cam-steps" aria-hidden="true">
              {Array.from({ length: step.of }, (_, i) => (
                <span key={i} data-done={i < step.n - 1 ? 'yes' : undefined} />
              ))}
            </div>
          </>
        ) : err ? (
          <>
            <p className="cam-status-text">Try again</p>
            <p className="cam-status-sub">{err}</p>
          </>
        ) : (
          <>
            <p className="cam-status-text">{ready ? 'Centre your face' : 'Opening the camera'}</p>
            <p className="cam-status-sub">Tap the button, then follow each step on the screen</p>
          </>
        )}
      </div>

      <div className="cam-bottom">
        {blocked ? (
          <div className="cam-sheet">
            {problem === 'denied' && (
              <div className="cam-help">
                <PermissionHelp kind="camera" compact />
              </div>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="cam-shutter"
            data-ready={ready && !step ? 'yes' : undefined}
            disabled={!ready || !!step}
            onClick={() => void run()}
            aria-label={step ? 'Follow the steps' : 'Start the face check'}
          >
            <span className="cam-shutter-dot" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
