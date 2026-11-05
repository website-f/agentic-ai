import { useEffect, useRef, useState } from 'react';
import { FACE_DESCRIPTOR_LEN } from '@prima/core';

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

/** Front camera, one button: takes the photo and makes the face descriptor on the phone. */
export function FaceCapture({ label, busy, onCapture }: { label: string; busy?: boolean; onCapture: (r: FaceResult) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let s: MediaStream | null = null;
    let live = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      if (!__DEMO__) setErr('This browser cannot open the camera.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      .then((m) => {
        if (!live) return m.getTracks().forEach((t) => t.stop());
        s = m;
        if (video.current) {
          video.current.srcObject = m;
          void video.current.play().catch(() => undefined);
        }
      })
      .catch(() => !__DEMO__ && setErr('The camera is blocked. Allow the camera for this app in the phone settings.'));
    if (!__DEMO__) void engine().catch(() => setErr('The face engine did not load. Check the connection and try again.'));
    return () => {
      live = false;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const take = async () => {
    const v = video.current!;
    setErr(null);
    setWorking(true);
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
      onCapture({ photo: snapshot(v), descriptor: Array.from(first.descriptor), live: moved > 0.8 && moved < 40 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <video ref={video} playsInline muted style={{ width: '100%', maxWidth: 320, borderRadius: 8, background: '#222', transform: 'scaleX(-1)' }} />
      {__DEMO__ && <div className="muted small">Test version: the face check always matches.</div>}
      {err && (
        <div className="notice small" data-tone="warn">
          {err}
        </div>
      )}
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || working} onClick={() => void take()}>
        {working ? 'Checking your face…' : label}
      </button>
    </div>
  );
}
