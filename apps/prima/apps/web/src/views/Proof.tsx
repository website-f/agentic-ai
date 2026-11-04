import { api } from '../api';
import { saveFile } from '../save';
import { useState } from 'react';
import { type EvidenceDoc, type ProofInput } from '@prima/core';
import { Chip, notify, dateTimeLabel } from '../ui';
import { EvidenceCamera } from './Camera';

const MAX_BYTES = 700_000;
let testFiles = 0;
const MAX_ITEMS = 3;

function readAsDataUrl(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(f);
  });
}

/** Pictures of a letter or certificate are scaled down to a JPEG that fits the limit. */
async function shrinkImage(dataUrl: string): Promise<string> {
  const img = new Image();
  await new Promise((ok, bad) => {
    img.onload = ok;
    img.onerror = bad;
    img.src = dataUrl;
  });
  for (const width of [1600, 1200, 900]) {
    const w = Math.min(width, img.naturalWidth);
    const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const out = c.toDataURL('image/jpeg', 0.75);
    if (out.length * 0.75 < MAX_BYTES) return out;
  }
  throw new Error('The picture is too large even after shrinking.');
}

/**
 * Proof for a case step (Fauzan, 25 Oct 2026: "must verify by proof, must done with proof, whether photo or
 * document"). A photo comes from the in-app camera with its time and GPS stamp; a document is a PDF or a picture of
 * a letter, report or certificate.
 */
export function ProofPicker({
  site,
  refText,
  items,
  onChange,
  documentsOnly,
  required,
}: {
  site: { code: string; lat: number; lng: number } | null;
  refText: string;
  items: ProofInput[];
  onChange: (items: ProofInput[]) => void;
  documentsOnly?: boolean;
  required?: boolean;
}) {
  const [camera, setCamera] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const full = items.length >= MAX_ITEMS;
  const addFile = async (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    try {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) throw new Error('Attach a PDF, JPEG or PNG file.');
      let data = await readAsDataUrl(f);
      if (f.size > MAX_BYTES) {
        if (f.type === 'application/pdf') throw new Error(`The PDF is over ${MAX_BYTES / 1000} KB. Scan it smaller.`);
        data = await shrinkImage(data);
      }
      onChange([...items, { kind: 'document', name: f.name, data }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The file could not be attached.');
    }
  };
  return (
    <div className="field" style={{ gap: 8 }}>
      <span className="label">
        Proof{required ? ' (required)' : ''}: {documentsOnly ? 'a document' : site ? 'a photo or a document' : 'a document (no site, so no photo check)'}
      </span>
      {items.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {items.map((it, i) => (
            <Chip key={i} tone="ok">
              {it.kind === 'photo' ? 'Photo' : it.name}{' '}
              <button
                className="btn btn-ghost btn-sm"
                aria-label="Remove proof"
                style={{ padding: '0 4px', minHeight: 0 }}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </Chip>
          ))}
        </div>
      )}
      {camera && site && !documentsOnly && (
        <EvidenceCamera
          site={site}
          refText={refText}
          collect
          onSend={async (p) => onChange([...items, { kind: 'photo', ...p, lat: p.lat, lng: p.lng }])}
          onDone={() => setCamera(false)}
        />
      )}
      {!camera && !full && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {site && !documentsOnly && (
            <button className="btn btn-sm" type="button" onClick={() => setCamera(true)}>
              Take photo
            </button>
          )}
          <label className="btn btn-sm" style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
            Attach document
            {/* Kept on the page but invisible: some phone app views do not open a hidden (display: none) file picker. */}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              aria-label="Attach document"
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
              onChange={(e) => {
                void addFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {api.mode === 'demo' && (
            // The test link may open where the phone cannot pick a file; a made-up file lets the step be tried.
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                testFiles += 1;
                const body = `%PDF-1.4\n% Test proof ${testFiles} for ${refText.replace(/[^\x20-\x7e]/g, "")}, ${new Date().toISOString()}\n`;
                onChange([...items, { kind: 'document', name: `Test proof ${testFiles}.pdf`, data: `data:application/pdf;base64,${btoa(body)}` }]);
              }}
            >
              Use a test file
            </button>
          )}
        </div>
      )}
      {err && (
        <div className="notice" data-tone="warn">
          {err}
        </div>
      )}
    </div>
  );
}

/** Supporting documents on a case, with who gave them and the fingerprint kept in the audit trail. */
export function DocList({ docs }: { docs: EvidenceDoc[] }) {
  if (!docs.length) return null;
  return (
    <div className="list">
      {docs.map((d) => (
        <div key={d.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
          <button className="link-button" style={{ fontWeight: 600 }} onClick={() => saveFile(d.name, d.data).then((m) => m && notify(m))}>
            {d.name}
          </button>
          <div className="muted small">
            {d.mime === 'application/pdf' ? 'PDF' : 'Picture'} · {Math.round(d.bytes / 1000)} KB · {d.uploadedBy}, {dateTimeLabel(d.receivedAt)}
          </div>
          <div className="mono muted small" title={d.sha256}>
            SHA-256 {d.sha256.slice(0, 16)}…
          </div>
        </div>
      ))}
    </div>
  );
}
