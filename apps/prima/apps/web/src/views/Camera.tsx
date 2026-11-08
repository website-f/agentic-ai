import { useEffect, useRef, useState } from 'react';
import { EVIDENCE_PLACE_LABEL, EVIDENCE_TIME_LABEL, fromMs, type EvidencePhoto } from '@prima/core';
import { api, type PhotoInput } from '../api';
import { Chip, ErrorNotice, dateTimeLabel, useAction } from '../ui';
import { openCamera } from './camera-stream';

export type Fix = { lat: number | null; lng: number | null; accuracyM: number | null };
type TestPlace = 'site' | 'away' | 'none' | 'gps';

export const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function gps(): Promise<Fix> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null, accuracyM: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
      () => resolve({ lat: null, lng: null, accuracyM: null }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

/** Burns the time, GPS fix and reference into the bottom of the picture, so the stamp travels with the photo. */
export function stamp(ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]) {
  const size = Math.max(14, Math.round(w / 44));
  const bar = size * 1.35 * lines.length + size;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, h - bar, w, bar);
  ctx.fillStyle = '#fff';
  ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
  lines.forEach((l, i) => ctx.fillText(l, size * 0.6, h - bar + size * 1.35 * (i + 1)));
}

/**
 * In-app camera for incident reports and site visits (Fauzan, 25 Oct 2026). Pictures come only from the live
 * camera, never the gallery, and carry a burned-in time and GPS stamp. The server checks the location against
 * the site and keeps its own time and a SHA-256 of the image.
 */
export function EvidenceCamera({
  site,
  refText,
  onSend,
  onDone,
  collect,
}: {
  site: { code: string; lat: number; lng: number };
  refText: string;
  onSend: (p: PhotoInput) => Promise<unknown>;
  onDone?: () => void;
  /** Keep the photo as proof for a step that is sent later, instead of saving it now. */
  collect?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [shot, setShot] = useState<PhotoInput | null>(null);
  const [caption, setCaption] = useState('');
  const [where, setWhere] = useState<TestPlace>(api.mode === 'demo' ? 'site' : 'gps');
  const { run, busy, error } = useAction();

  useEffect(() => {
    let s: MediaStream | null = null;
    let live = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamErr('This browser cannot open the camera.');
      return;
    }
    // P90: the shared camera opener (sizes every phone has, with a plain fallback).
    openCamera('environment')
      .then((m) => {
        if (!live) return m.getTracks().forEach((t) => t.stop());
        s = m;
        setStream(m);
      })
      .catch(() => setCamErr('The camera is blocked. Allow the camera for this app in the phone settings.'));
    return () => {
      live = false;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => undefined);
    }
  }, [stream]);

  const fix = async (): Promise<Fix> => {
    if (where === 'site') return { lat: site.lat + 0.0001, lng: site.lng - 0.0001, accuracyM: 8 };
    if (where === 'away') return { lat: site.lat + 0.012, lng: site.lng, accuracyM: 12 };
    if (where === 'none') return { lat: null, lng: null, accuracyM: null };
    return gps();
  };

  const take = async () => {
    const f = await fix();
    const v = video.current;
    const useCamera = !!stream && !!v && v.videoWidth > 0;
    const w = useCamera ? Math.min(1280, v!.videoWidth) : 960;
    const h = useCamera ? Math.round((v!.videoHeight * w) / v!.videoWidth) : 640;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    if (useCamera) ctx.drawImage(v!, 0, 0, w, h);
    else {
      // Test version only: a drawn scene stands in for the camera, which the test page cannot open.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#6f8796');
      g.addColorStop(1, '#3d4a54');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `${Math.round(w / 18)}px sans-serif`;
      ctx.fillText('TEST PICTURE', w * 0.27, h * 0.45);
    }
    const now = Date.now();
    const t = TIME.format(now).replace(',', '');
    stamp(ctx, w, h, [
      `${site.code}  ${t} MYT`,
      f.lat == null ? 'NO GPS' : `${f.lat.toFixed(5)}, ${f.lng!.toFixed(5)}  ±${f.accuracyM ?? '?'} m`,
      `${refText}  ·  Prima Secure`,
    ]);
    setShot({
      image: canvas.toDataURL('image/jpeg', 0.72),
      capturedAt: fromMs(now),
      ...f,
      source: useCamera ? 'in_app_camera' : 'test_picture',
    });
  };

  const send = () =>
    run(
      async () => {
        await onSend({ ...shot!, caption });
        return true;
      },
      collect ? undefined : 'Photo saved with its time and location',
    ).then((r) => {
      if (r !== undefined) {
        setShot(null);
        setCaption('');
        onDone?.();
      }
    });

  const testOnly = !stream && api.mode === 'demo';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!shot && stream && <video ref={video} playsInline muted style={{ width: '100%', borderRadius: 8, background: '#000' }} />}
      {!shot && !stream && camErr && (
        <div className="notice" data-tone={testOnly ? 'info' : 'warn'}>
          {testOnly ? 'The test page cannot open the camera, so a test picture is used. The installed app uses the phone camera.' : camErr}
        </div>
      )}
      {shot && <img src={shot.image} alt="Photo to send, with time and location stamp" style={{ width: '100%', borderRadius: 8 }} />}
      {api.mode === 'demo' && !shot && (
        <div className="field">
          <span className="label">Test only: where the phone is</span>
          <div className="seg" style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}>
            <button aria-pressed={where === 'site'} onClick={() => setWhere('site')}>
              At the site
            </button>
            <button aria-pressed={where === 'away'} onClick={() => setWhere('away')}>
              1.3 km away
            </button>
            <button aria-pressed={where === 'none'} onClick={() => setWhere('none')}>
              GPS off
            </button>
            <button aria-pressed={where === 'gps'} onClick={() => setWhere('gps')}>
              This phone's GPS
            </button>
          </div>
        </div>
      )}
      {!shot ? (
        <div className="row">
          <button className="btn btn-primary" onClick={take} disabled={!stream && !testOnly}>
            Take photo
          </button>
          {collect && onDone && (
            <button className="btn btn-ghost" onClick={onDone}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <>
          <input className="input" aria-label="Photo caption" placeholder="What the photo shows" value={caption} onChange={(e) => setCaption(e.target.value)} />
          <ErrorNotice error={error} />
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={send}>
              {collect ? 'Use this photo' : 'Send photo'}
            </button>
            <button className="btn" disabled={busy} onClick={() => setShot(null)}>
              Retake
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** A saved photo with what the server checked: place, distance, time and fingerprint. */
export function PhotoCard({ p }: { p: EvidencePhoto }) {
  const tone = p.place === 'on_site' ? 'ok' : p.place === 'away' ? 'crit' : 'warn';
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {p.image && <img src={p.image} alt={p.caption || 'Evidence photo'} style={{ width: '100%', borderRadius: 8 }} loading="lazy" />}
      <figcaption className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="row" style={{ gap: 4 }}>
          <Chip tone={tone}>
            {EVIDENCE_PLACE_LABEL[p.place]} · {p.distanceM} m
          </Chip>
          <Chip tone={p.time === 'ok' ? 'ok' : 'warn'}>{EVIDENCE_TIME_LABEL[p.time]}</Chip>
          {p.source === 'test_picture' && <Chip tone="neutral">Test picture</Chip>}
        </div>
        {p.caption && <div>{p.caption}</div>}
        <div className="muted">
          Taken {dateTimeLabel(p.capturedAt)}, received {dateTimeLabel(p.receivedAt)} · {p.takenBy} · {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
          {p.accuracyM != null ? ` ±${p.accuracyM} m` : ''}
        </div>
        <div className="mono muted" title={p.sha256}>
          SHA-256 {p.sha256.slice(0, 16)}…
        </div>
      </figcaption>
    </figure>
  );
}
