// One scanner for every item screen (P85; paper section 10): the phone camera full screen, a USB or Bluetooth scanner
// in keyboard mode, an RFID reader that types, or the ID typed by hand. A typed ID asks for the reason and physical
// proof (the maker serial, or a tick that type and size match) and is marked manual. Each scan is checked by the
// server (items/scan-check) before the screen uses it, so the screen and the server judge it the same way. A link or
// anything that is not an item code is refused and never opened.
import { useEffect, useRef, useState } from 'react';
import { CameraIcon, KeyboardIcon, XIcon, LightningIcon } from '@phosphor-icons/react';
import { LABEL_REFUSAL, SCAN_OUTCOME_LABEL, parseScan, type ScanEntry, type ScanPurpose, type ScanSource } from '@prima/core';
import { api, type ItemScanVerdict } from '../../api';
import { Chip, ErrorNotice } from '../../ui';
import { makeDecoder, type Decoder } from './decoder';
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
 * The camera, full screen as on a phone (like the face camera). The back camera, a frame to aim with, a torch where
 * the phone has one, and the last result in large words. The stream is stopped as soon as the screen closes.
 */
export function CameraScan({ title, last, error, onRead, onClose }: { title: string; last: ItemScanVerdict | null; error: string | null; onRead: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'live' | 'none' | 'denied'>('starting');
  const [torch, setTorch] = useState<{ on: boolean; track: MediaStreamTrack } | null>(null);
  const cb = useRef(onRead);
  cb.current = onRead;
  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let decoder: Decoder | null = null;
    (async () => {
      try {
        decoder = await makeDecoder();
        if (stop) return;
        if (!decoder) {
          setState('none');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        if (stop || !video.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch({ on: false, track });
        setState('live');
        while (!stop) {
          const found = video.current ? await decoder.detect(video.current).catch(() => [] as string[]) : [];
          if (stop || !video.current) return;
          const hit = found.map(cleanScan).find((v) => parseScan(v).ok);
          if (hit) cb.current(hit);
          await new Promise((r) => setTimeout(r, decoder?.kind === 'native' ? 120 : 160));
        }
      } catch {
        if (!stop) setState('denied');
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const tone = last ? (last.outcome === 'ok' ? 'ok' : 'adjust') : undefined;
  const words =
    state === 'none'
      ? 'This phone cannot read codes here'
      : state === 'denied'
        ? 'The camera could not be opened'
        : last
          ? SCAN_OUTCOME_LABEL[last.outcome]
          : 'Point at the code';
  const sub =
    state === 'none' || state === 'denied'
      ? 'Close this and type the ID printed under the code, or use a handheld scanner.'
      : error ?? (last ? `${last.label ?? ''}${last.sku ? ` · ${last.sku}` : ''}${last.outcome !== 'ok' ? ` · ${last.message}` : ''}` : 'Hold the label inside the frame. It reads on its own.');
  return (
    <div className="cam isc-cam-screen" data-tone={tone} role="dialog" aria-modal="true" aria-label={title}>
      <video ref={video} className="cam-video" muted playsInline />
      <div className="isc-frame-wrap" aria-hidden="true">
        <div className="isc-frame" />
      </div>
      <div className="cam-top">
        <button className="cam-icon" type="button" onClick={onClose} aria-label="Close the camera">
          <XIcon size={24} />
        </button>
        <div className="cam-title">{title}</div>
        {torch ? (
          <button
            className="cam-icon"
            type="button"
            aria-pressed={torch.on}
            aria-label="Torch"
            onClick={() => {
              const on = !torch.on;
              void torch.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).then(() => setTorch({ ...torch, on }), () => undefined);
            }}
          >
            <LightningIcon size={22} weight={torch.on ? 'fill' : 'regular'} />
          </button>
        ) : (
          <span className="cam-icon-gap" />
        )}
      </div>
      <div className="cam-status" aria-live="polite">
        <p className="cam-status-text">{words}</p>
        <p className="cam-status-sub">{sub}</p>
      </div>
      <div className="cam-bottom">
        <button className="btn isc-cam-done" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
