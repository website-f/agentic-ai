import { api } from '../api';
import { openProofItem } from '../save';
import { useState } from 'react';
import { type EvidenceDoc, type ProofInput, parseSharePointProofLink, PROOF_LINK_MIME } from '@prima/core';
import { Chip, notify, dateTimeLabel } from '../ui';
import { EvidenceCamera } from './Camera';

const MAX_BYTES = 700_000;
let testFiles = 0;
let testLinks = 0;
/** Only a cleaned https SharePoint link becomes a clickable address. */
const SAFE_LINK = /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.sharepoint\.com\//;
const MAX_ITEMS = 3;

export function readAsDataUrl(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(f);
  });
}

/** Pictures of a letter or certificate are scaled down to a JPEG that fits the limit. */
export async function shrinkImage(dataUrl: string): Promise<string> {
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
  noLinks,
}: {
  site: { code: string; lat: number; lng: number } | null;
  refText: string;
  items: ProofInput[];
  onChange: (items: ProofInput[]) => void;
  documentsOnly?: boolean;
  required?: boolean;
  /** The step needs the file itself (for example a tender file that is checked for the company name). */
  noLinks?: boolean;
}) {
  const [camera, setCamera] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [url, setUrl] = useState('');
  /**
   * SharePoint file by link (staff usability rule 6, 4 Nov 2026: files by link, no copies). Checked here for a quick
   * answer and checked again by the server; nothing is fetched from SharePoint.
   */
  const addLink = (raw: string) => {
    setErr(null);
    const got = parseSharePointProofLink(raw);
    if (!got.ok) return setErr(got.reason);
    if (items.some((it) => it.kind === 'link' && it.url === got.link.url))
      return setErr('This link is already added.');
    onChange([...items, { kind: 'link', url: got.link.url }]);
    setUrl('');
    setPasting(false);
  };
  const label = (it: ProofInput) => {
    if (it.kind === 'photo') return 'Photo';
    if (it.kind === 'document') return it.name;
    const got = parseSharePointProofLink(it.url);
    return got.ok ? `SharePoint: ${got.link.name}` : 'SharePoint link';
  };
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
        {!noLinks && <span> or a SharePoint link</span>}
      </span>
      {items.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {items.map((it, i) => (
            <Chip key={i} tone="ok">
              <span data-no-translate={it.kind === 'photo' ? undefined : true}>{label(it)}</span>{' '}
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
      {pasting && !full && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <input
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            aria-label="SharePoint link of the file"
            placeholder="https://…sharepoint.com/sites/…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLink(url);
              }
            }}
            style={{ flex: '1 1 240px', minWidth: 0 }}
          />
          <button className="btn btn-sm" type="button" disabled={!url.trim()} onClick={() => addLink(url)}>
            Add link
          </button>
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={() => {
              setPasting(false);
              setUrl('');
              setErr(null);
            }}
          >
            Cancel
          </button>
          <div className="muted small" style={{ flexBasis: '100%' }}>
            The file stays in SharePoint. Prima keeps only the link; whoever opens it needs access to the file in SharePoint.
          </div>
        </div>
      )}
      {!camera && !full && !pasting && (
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
          {!noLinks && (
            <button className="btn btn-sm" type="button" onClick={() => setPasting(true)}>
              Paste SharePoint link
            </button>
          )}
          {api.mode === 'demo' && !noLinks && (
            // A made-up SharePoint address so the link step can be tried on the test link; it opens nothing real.
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                testLinks += 1;
                addLink(`https://example.sharepoint.com/sites/TestSite/Shared%20Documents/Test%20link%20proof%20${testLinks}-${Date.now() % 100000}.pdf`);
              }}
            >
              Use a test SharePoint link
            </button>
          )}
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
          {d.link && SAFE_LINK.test(d.link) ? (
            <a className="link-button" style={{ fontWeight: 600 }} href={d.link} target="_blank" rel="noopener noreferrer" data-no-translate>
              {d.name}
            </a>
          ) : (
            <button className="link-button" style={{ fontWeight: 600 }} onClick={() => openProofItem(d.name, d).then((m) => m && notify(m))}>
              {d.name}
            </button>
          )}
          <div className="muted small">
            {d.mime === PROOF_LINK_MIME ? 'SharePoint link (opens in SharePoint)' : d.mime === 'application/pdf' ? 'PDF' : 'Picture'}
            {d.mime === PROOF_LINK_MIME ? '' : ` · ${Math.round(d.bytes / 1000)} KB`} · {d.uploadedBy}, {dateTimeLabel(d.receivedAt)}
          </div>
          {!d.link && (
            <div className="mono muted small" title={d.sha256}>
              SHA-256 {d.sha256.slice(0, 16)}…
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
