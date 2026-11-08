// One scanner for every item screen (P85; paper section 10): the phone camera full screen, a USB or Bluetooth scanner
// in keyboard mode, an RFID reader that types, or the ID typed by hand. A typed ID asks for the reason and physical
// proof (the maker serial, or a tick that type and size match) and is marked manual. Each scan is checked by the
// server (items/scan-check) before the screen uses it, so the screen and the server judge it the same way. A link or
// anything that is not an item code is refused and never opened.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CameraIcon, CameraRotateIcon, CheckCircleIcon, KeyboardIcon, LightningIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { LABEL_REFUSAL, SCAN_OUTCOME_LABEL, parseScan, type ScanEntry, type ScanPurpose, type ScanSource } from '@prima/core';
import { api, type ItemScanVerdict } from '../../api';
import { Chip, ErrorNotice } from '../../ui';
import { makeDecoder, prewarmDecoder } from './decoder';
import { hasTorch, keepFocus, listCameras, openCamera, stopStream, whenIdle } from '../camera-stream';
import { CAMERA_PROBLEM_TEXT, cameraProblem, type CameraProblem } from '../checkin-permissions';
import { PermissionHelp } from '../PermissionHelp';
import { REPEAT_MS, classifyKeys, cleanScan } from './keys';
import '../../styles/camera.css';
import '../../styles/items.css';

export interface ScanResult {
  verdict: ItemScanVerdict;
  entry: ScanEntry;
}

const TONE: Record<ItemScanVerdict['outcome'], 'ok' | 'warn' | 'crit' | 'info'> = {
  ok: 'ok',
  duplicate: 'info',
  not_on_list: 'warn',
  wrong_sku: 'warn',
  not_available: 'warn',
  held_elsewhere: 'crit',
  superseded_label: 'crit',
  needs_manual_proof: 'warn',
  not_found: 'crit',
};

/** A short beep and a buzz: high for OK, low for anything else. Quietly skipped where the phone does not allow it. */
function feedback(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
  } catch {
    /* no vibration */
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1320 : 330;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    o.onended = () => void ctx.close();
  } catch {
    /* no sound */
  }
}

const REASONS = ['Label damaged', 'Label unreadable', 'Label missing', 'Printer or scanner fault'];

/**
 * The scanner. `onResult` gets every checked scan with its verdict; the screen decides what to do with it. With
 * `continuous`, the camera stays open for the next scan (pick lists, receipts, counts).
 */
export function Scanner({
  purpose,
  contextId = null,
  onResult,
  title = 'Scan a label',
  continuous = false,
  allowManual = true,
  busy = false,
  autoFocus = false,
}: {
  purpose: ScanPurpose;
  contextId?: string | null;
  onResult: (r: ScanResult) => unknown;
  title?: string;
  continuous?: boolean;
  allowManual?: boolean;
  busy?: boolean;
  autoFocus?: boolean;
}) {
  const [raw, setRaw] = useState('');
  const [camera, setCamera] = useState(false);
  const [last, setLast] = useState<ItemScanVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<{ code: string; hasSerial: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const keyTimes = useRef<number[]>([]);
  const recent = useRef(new Map<string, number>());
  const input = useRef<HTMLInputElement>(null);
  const cb = useRef(onResult);
  cb.current = onResult;
  // P90: the code reader gets ready while the screen is idle, so the camera opens without waiting for it.
  useEffect(() => whenIdle(prewarmDecoder), []);

  async function check(code: string, source: ScanSource, man: ScanEntry['manual'] = null) {
    const v = cleanScan(code);
    const p = parseScan(v);
    if (!p.ok) {
      setError(LABEL_REFUSAL[p.reason]);
      feedback(false);
      return;
    }
    const key = p.by === 'label' ? `${p.token}:${p.gen ?? ''}` : p.tag;
    const now = Date.now();
    if (!man && (recent.current.get(key) ?? 0) > now - REPEAT_MS) return;
    recent.current.set(key, now);
    setError(null);
    setChecking(true);
    try {
      const entry: ScanEntry = { code: v, source, manual: man, deviceAt: new Date().toISOString() };
      const verdict = await api.itemScanCheck(purpose, contextId, entry);
      if (verdict.outcome === 'needs_manual_proof' && source === 'typed') {
        setManual({ code: v, hasSerial: !!verdict.hasSerial, message: verdict.message });
        return;
      }
      setLast(verdict);
      feedback(verdict.outcome === 'ok');
      setRaw('');
      await cb.current({ verdict, entry: { ...entry, baseVersion: verdict.version ?? null } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      feedback(false);
    } finally {
      setChecking(false);
    }
  }

  // A scanner in keyboard mode while no field has focus (scan screens): catch the burst on the page itself.
  useEffect(() => {
    if (!continuous) return;
    let buf = '';
    let times: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && el !== document.body && el.tagName !== 'BUTTON') return;
      if (manual) return;
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buf && classifyKeys(times, buf.length, true) === 'wedge') {
          e.preventDefault();
          void check(buf, 'wedge');
        }
        buf = '';
        times = [];
      } else if (e.key.length === 1) {
        buf += e.key;
        times.push(performance.now());
        if (buf.length > 80) buf = buf.slice(-80);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous, manual, purpose, contextId]);

  const submitTyped = (terminated: boolean) => {
    const source = classifyKeys(keyTimes.current, raw.length, terminated);
    keyTimes.current = [];
    if (source === 'typed' && !allowManual) {
      setError('Scan the label; typing the ID is not allowed here.');
      return;
    }
    void check(raw, source);
  };

  return (
    <div className="isc">
      <form
        className="isc-row"
        onSubmit={(e) => {
          e.preventDefault();
          submitTyped(true);
        }}
      >
        <input
          ref={input}
          className="input isc-input"
          aria-label={title}
          placeholder="Scan, or type the ID under the code (P1-...)"
          value={raw}
          maxLength={80}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="go"
          onKeyDown={(e) => {
            if (e.key === 'Tab' && raw && classifyKeys(keyTimes.current, raw.length, true) === 'wedge') {
              e.preventDefault();
              submitTyped(true);
              return;
            }
            if (e.key.length === 1) keyTimes.current.push(performance.now());
          }}
          onChange={(e) => {
            if (!e.target.value) keyTimes.current = [];
            setRaw(e.target.value);
          }}
        />
        <button className="btn isc-go" type="submit" disabled={busy || checking || !raw.trim()} aria-label="Check this ID">
          <KeyboardIcon size={20} aria-hidden="true" /> <span>Enter</span>
        </button>
        <button className="btn btn-primary isc-cam" type="button" onClick={() => setCamera(true)} disabled={busy}>
          <CameraIcon size={22} aria-hidden="true" /> <span>Camera</span>
        </button>
      </form>
      {last && (
        <div className="isc-last" aria-live="polite">
          <Chip tone={TONE[last.outcome]}>{SCAN_OUTCOME_LABEL[last.outcome]}</Chip>
          <span>
            {last.label ? <span className="mono">{last.label}</span> : null}
            {last.sku ? ` · ${last.sku}${last.size ? ` ${last.size}` : ''}` : ''}
            {last.outcome !== 'ok' ? ` · ${last.message}` : ''}
            {last.manual ? ' · typed (manual)' : ''}
          </span>
        </div>
      )}
      <ErrorNotice error={error} />
      {manual && (
        <ManualDialog
          info={manual}
          onCancel={() => setManual(null)}
          onSubmit={(m) => {
            const code = manual.code;
            setManual(null);
            void check(code, 'typed', m);
          }}
        />
      )}
      {camera && (
        <CameraScan
          title={title}
          last={last}
          error={error}
          onRead={(code) => {
            if (!continuous) setCamera(false);
            void check(code, 'camera');
          }}
          onClose={() => {
            setCamera(false);
            setTimeout(() => input.current?.focus(), 50);
          }}
        />
      )}
    </div>
  );
}

/** A typed ID: the reason and the physical proof the server checks (paper section 10). */
function ManualDialog({ info, onCancel, onSubmit }: { info: { code: string; hasSerial: boolean; message: string }; onCancel: () => void; onSubmit: (m: NonNullable<ScanEntry['manual']>) => void }) {
  const [why, setWhy] = useState(REASONS[0]);
  const [more, setMore] = useState('');
  const [serial, setSerial] = useState('');
  const [tick, setTick] = useState(false);
  const reason = `${why}${more.trim() ? `: ${more.trim()}` : ''}`;
  const ready = reason.length >= 5 && (info.hasSerial ? serial.trim().length > 0 : tick);
  return (
    <div className="isc-dialog" role="dialog" aria-modal="true" aria-label="Typed ID">
      <div className="isc-dialog-box">
        <h3>The label could not be scanned</h3>
        <p className="muted">
          <span className="mono">{info.code}</span> was typed in. Say why, and check the item itself. A typed ID is marked in the history and asks for a new label.
        </p>
        <fieldset className="isc-reasons">
          <legend>Why</legend>
          {REASONS.map((r) => (
            <label key={r} className="isc-choice">
              <input type="radio" name="why" checked={why === r} onChange={() => setWhy(r)} /> {r}
            </label>
          ))}
        </fieldset>
        <input className="input" placeholder="More detail (optional)" value={more} maxLength={150} onChange={(e) => setMore(e.target.value)} />
        {info.hasSerial ? (
          <label className="isc-field">
            Maker serial you can see on the item
            <input className="input mono" value={serial} maxLength={60} autoCapitalize="characters" onChange={(e) => setSerial(e.target.value)} />
          </label>
        ) : (
          <label className="isc-choice isc-tick">
            <input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} /> The item type and size match the ID I typed
          </label>
        )}
        <div className="isc-actions">
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={!ready} onClick={() => onSubmit(info.hasSerial ? { reason, serialSeen: serial.trim() } : { reason, skuSizeConfirmed: true })}>
            Use this ID
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The camera, full screen as on a phone (like the face camera). P90: the camera is asked for at once and the code reader
 * loads beside it (it used to load first, so the "Allow camera" question came late); the back camera with sizes every
 * phone has; an aiming frame with corners and a moving scan line; the torch and a camera switch where the phone has them;
 * a flash and buzz on each read; the result in a large card; and help when the camera is blocked. The stream stays open
 * while this screen is open (continuous scanning) and every track is stopped as soon as it closes.
 */
export function CameraScan({ title, last, error, onRead, onClose }: { title: string; last: ItemScanVerdict | null; error: string | null; onRead: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'starting' | 'live' | 'none' | 'problem'>('starting');
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [torch, setTorch] = useState<{ on: boolean; track: MediaStreamTrack } | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [hit, setHit] = useState(0);
  const [flash, setFlash] = useState(false);
  const cb = useRef(onRead);
  cb.current = onRead;
  const close = useRef(onClose);
  close.current = onClose;
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    let stop = false;
    // The reader loads while the camera opens, never before it.
    const reader = makeDecoder();
    setState('starting');
    setTorch(null);
    (async () => {
      let s: MediaStream;
      try {
        s = await openCamera('environment', chosen.current);
      } catch (e) {
        if (stop) return;
        setProblem(cameraProblem(e));
        setState('problem');
        return;
      }
      if (stop || !video.current) return stopStream(s);
      stream.current = s;
      const track = s.getVideoTracks()[0];
      keepFocus(track);
      video.current.srcObject = s;
      await video.current.play().catch(() => undefined);
      if (stop) return;
      if (hasTorch(track)) setTorch({ on: false, track });
      setDeviceId(track?.getSettings?.().deviceId ?? chosen.current);
      void listCameras().then((all) => !stop && setCameras(all));
      setProblem(null);
      setState('live');
      const decoder = await reader;
      if (stop) return;
      if (!decoder) {
        stopStream(s);
        stream.current = null;
        setState('none');
        return;
      }
      while (!stop) {
        if (document.visibilityState === 'visible' && video.current && video.current.readyState >= 2) {
          const found = await decoder.detect(video.current).catch(() => [] as string[]);
          if (stop) return;
          const code = found.map(cleanScan).find((v) => parseScan(v).ok);
          if (code) {
            setHit((n) => n + 1);
            cb.current(code);
          }
        }
        await new Promise((r) => setTimeout(r, decoder.kind === 'native' ? 100 : 150));
      }
    })();
    return () => {
      stop = true;
      stopStream(stream.current);
      stream.current = null;
    };
  }, [attempt]);

  // Full screen: no page scroll behind it, Escape closes it, focus starts on it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const from = document.activeElement as HTMLElement | null;
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
      from?.focus?.();
    };
  }, []);

  // A short flash of the frame on each read.
  useEffect(() => {
    if (!hit) return;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 450);
    return () => window.clearTimeout(t);
  }, [hit]);

  const flip = () => {
    if (cameras.length < 2) return;
    const at = cameras.findIndex((c) => c.deviceId === deviceId);
    chosen.current = cameras[(at + 1) % cameras.length].deviceId || null;
    setAttempt((n) => n + 1);
  };

  const tone = last ? (last.outcome === 'ok' ? 'ok' : 'adjust') : undefined;
  const blocked = state === 'none' || state === 'problem';
  const words = state === 'none' ? 'This phone cannot read codes here' : state === 'problem' ? 'Camera not available' : state === 'starting' ? 'Opening the camera' : 'Point at the code';
  const sub =
    state === 'none'
      ? 'Close this and type the ID printed under the code, or use a handheld scanner.'
      : state === 'problem'
        ? CAMERA_PROBLEM_TEXT[problem ?? 'other']
        : 'Hold the label inside the frame. It reads on its own.';
  const canFlip = cameras.length > 1 && state === 'live';
  return createPortal(
    <div
      ref={dialog}
      className="cam isc-cam-screen"
      data-tone={tone}
      data-state={state}
      data-flash={flash ? 'yes' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      <video ref={video} className="cam-video" muted playsInline autoPlay />
      <div className="isc-frame-wrap" aria-hidden="true">
        <div className="isc-frame cam-scan-frame">
          <span className="cam-corner" data-c="tl" />
          <span className="cam-corner" data-c="tr" />
          <span className="cam-corner" data-c="bl" />
          <span className="cam-corner" data-c="br" />
          {state === 'live' && <span className="cam-scan-line" />}
          {state === 'starting' && <span className="cam-spinner" />}
        </div>
      </div>
      <div className="cam-top">
        <button className="cam-icon" type="button" onClick={onClose} aria-label="Close the camera">
          <XIcon size={24} weight="bold" />
        </button>
        <div className="cam-title">{title}</div>
        <div className="cam-tools">
          {torch && (
            <button
              className="cam-icon"
              type="button"
              aria-pressed={torch.on}
              aria-label={torch.on ? 'Torch off' : 'Torch on'}
              onClick={() => {
                const on = !torch.on;
                void torch.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).then(
                  () => setTorch({ ...torch, on }),
                  () => undefined,
                );
              }}
            >
              <LightningIcon size={22} weight={torch.on ? 'fill' : 'bold'} />
            </button>
          )}
          {canFlip && (
            <button className="cam-icon" type="button" onClick={flip} aria-label="Switch camera">
              <CameraRotateIcon size={22} weight="bold" />
            </button>
          )}
          {!torch && !canFlip && <span className="cam-icon-gap" />}
        </div>
      </div>
      {last && !blocked ? (
        <div className="cam-result" data-tone={TONE[last.outcome]} aria-live="polite">
          <span className="cam-result-icon" aria-hidden="true">
            {last.outcome === 'ok' ? <CheckCircleIcon size={30} weight="fill" /> : <WarningCircleIcon size={30} weight="fill" />}
          </span>
          <span className="cam-result-main">
            <span className="cam-result-title">{SCAN_OUTCOME_LABEL[last.outcome]}</span>
            {last.label && <span className="cam-result-code mono">{last.label}</span>}
            <span className="cam-result-sub">
              {[last.sku ? `${last.sku}${last.size ? ` ${last.size}` : ''}` : '', last.outcome !== 'ok' ? last.message : ''].filter(Boolean).join(' · ') || 'Ready for the next label'}
            </span>
            {error && <span className="cam-result-sub">{error}</span>}
          </span>
        </div>
      ) : (
        <div className="cam-status" aria-live="polite">
          <p className="cam-status-text">{words}</p>
          <p className="cam-status-sub">{error ?? sub}</p>
        </div>
      )}
      <div className="cam-bottom">
        {state === 'problem' ? (
          <div className="cam-sheet">
            {problem === 'denied' && (
              <div className="cam-help">
                <PermissionHelp kind="camera" compact />
              </div>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <button className="btn isc-cam-done" type="button" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
