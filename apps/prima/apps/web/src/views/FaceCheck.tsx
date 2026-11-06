import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CameraIcon, CameraRotateIcon, XIcon } from '@phosphor-icons/react';
import { FACE_DESCRIPTOR_LEN } from '@prima/core';
import '../styles/camera.css';

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
}: {
  label: string;
  busy?: boolean;
  onCapture: (r: FaceResult) => void;
  /** The heading on the camera screen; the button's label when not given. */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
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

function FaceCamera({ title, onClose, onCapture }: { title: string; onClose: () => void; onCapture: (r: FaceResult) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const oval = useRef<HTMLDivElement>(null);
  const shutter = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const steady = useRef(0);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [engineOk, setEngineOk] = useState(__DEMO__);
  const [busy, setBusy] = useState(false);
  const [mirrored, setMirrored] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ text: 'Opening the camera', tone: 'idle' });
  const close = useRef(onClose);
  close.current = onClose;

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  /** Front camera first (facingMode 'user'); a chosen camera after the switch button. */
  const start = useCallback(async (id: string | null) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (!__DEMO__) setBlocked('This browser cannot open the camera.');
      else setReady(true);
      return;
    }
    stop();
    setReady(false);
    try {
      const m = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, width: { ideal: 640 } } : { facingMode: 'user', width: { ideal: 640 } },
        audio: false,
      });
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
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      setCameras(all.filter((d) => d.kind === 'videoinput'));
    } catch {
      if (__DEMO__) setReady(true);
      else setBlocked('The camera is blocked. Allow the camera for this app in the phone or browser settings, then try again.');
    }
  }, []);

  // Open the camera and load the engine once; stop the camera when the screen closes.
  useEffect(() => {
    let live = true;
    alive.current = true;
    void start(null);
    if (!__DEMO__)
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
    if (__DEMO__) {
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
      if (v && o && v.readyState >= 2 && !working.current) {
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
    try {
      if (__DEMO__) return onCapture({ photo: snapshot(v), descriptor: testDescriptor(), live: true });
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
      onCapture({ photo: snapshot(v), descriptor: Array.from(first.descriptor), live: moved > 0.8 && moved < 40 });
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

  return createPortal(
    <div ref={dialog} className="cam" role="dialog" aria-modal="true" aria-label={title} data-tone={status.tone} tabIndex={-1}>
      <video ref={video} className="cam-video" data-mirror={mirrored ? 'yes' : undefined} playsInline muted autoPlay />
      <div className="cam-frame" aria-hidden="true">
        <div ref={oval} className="cam-oval" />
      </div>

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
        ) : (
          <>
            <p className="cam-status-text">{status.text}</p>
            {status.sub && <p className="cam-status-sub">{status.sub}</p>}
          </>
        )}
      </div>

      <div className="cam-bottom">
        {blocked ? (
          <div className="cam-sheet">
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
