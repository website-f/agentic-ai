import { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { LABEL_REFUSAL, parseScan } from '@prima/core';

/**
 * QR code of the same P1- ID as the barcode (Fauzan, 6 Nov 2026: each company chooses barcode, QR or RFID). Only the
 * ID is encoded: no link, name, price or owner, so a phone camera that opens links has nothing to open.
 */
export function qrSvg(token: string): string {
  const q = qrcode(0, 'M');
  q.addData(token, 'Byte');
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (o: { formats: string[] }) => Detector;

/** The browser's own barcode reader, where there is one (Android Chrome). Elsewhere the ID is typed or a scanner is used. */
function detectorCtor(): DetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: DetectorCtor };
  return w.BarcodeDetector ?? null;
}

/**
 * One scan box for a printed barcode, a printed QR code or an RFID tag read. A handheld scanner or RFID reader that
 * types into the box works everywhere; the phone camera works where the browser can read codes.
 */
export function ScanBox({
  onScan,
  label = 'Scan the label or RFID tag, or type the ID',
  button = 'Open',
  busy = false,
  autoFocus = false,
}: {
  onScan: (value: string) => void | Promise<unknown>;
  label?: string;
  button?: string;
  busy?: boolean;
  autoFocus?: boolean;
}) {
  const [raw, setRaw] = useState('');
  const [camera, setCamera] = useState(false);
  const check = raw.trim() ? parseScan(raw) : null;
  const submit = async (v: string) => {
    const p = parseScan(v);
    if (!p.ok) return;
    await onScan(v.trim());
    setRaw('');
  };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <form
        className="row"
        style={{ gap: 6, flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(raw);
        }}
      >
        <input
          className="input"
          aria-label={label}
          placeholder="P1-XXXX-XXXX-XXXX-XXXX or RFID tag"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          maxLength={80}
          autoFocus={autoFocus}
          autoComplete="off"
        />
        <button className="btn" type="submit" disabled={busy || !check?.ok}>
          {button}
        </button>
        {detectorCtor() && (
          <button className="btn" type="button" onClick={() => setCamera((c) => !c)} aria-pressed={camera}>
            {camera ? 'Close camera' : 'Use camera'}
          </button>
        )}
      </form>
      {check && !check.ok && (
        <p className="notice" data-tone="warn">
          {LABEL_REFUSAL[check.reason]}
        </p>
      )}
      {check?.ok && check.by === 'rfid' && <span className="muted small">RFID tag read.</span>}
      {camera && (
        <CameraReader
          onRead={(v) => {
            setCamera(false);
            void submit(v);
          }}
        />
      )}
    </div>
  );
}

function CameraReader({ onRead }: { onRead: (v: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef(onRead);
  cb.current = onRead;
  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const det = new Ctor({ formats: ['code_128', 'qr_code'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop || !video.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const found = await det.detect(video.current).catch(() => []);
          if (stop || !video.current) return;
          const hit = found.map((f) => f.rawValue).find((v) => parseScan(v).ok);
          if (hit) {
            cb.current(hit);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        if (!stop) setErr('The camera could not be opened. Type the ID printed under the code instead.');
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div>
      {err ? (
        <p className="notice" data-tone="warn">
          {err}
        </p>
      ) : (
        <video ref={video} muted playsInline style={{ width: '100%', maxWidth: 360, borderRadius: 8 }} />
      )}
    </div>
  );
}

/** Many reads at once: an RFID handheld or gate reader's list pasted in, one per line (or separated by spaces). */
export function ReadsBox({ onSend, busy, button }: { onSend: (reads: string[]) => void | Promise<unknown>; busy: boolean; button: string }) {
  const [text, setText] = useState('');
  const reads = text.split(/[\s,;]+/).filter(Boolean);
  const ok = reads.filter((r) => parseScan(r).ok).length;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <textarea
        className="input"
        rows={4}
        aria-label="RFID reads or labels, one per line"
        placeholder="Paste the reader's list: one RFID tag or label per line"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn"
          disabled={busy || !ok}
          onClick={async () => {
            await onSend(reads);
            setText('');
          }}
        >
          {button}
        </button>
        <span className="muted small">
          {reads.length} read{reads.length === 1 ? '' : 's'}, {ok} readable
        </span>
      </div>
    </div>
  );
}

