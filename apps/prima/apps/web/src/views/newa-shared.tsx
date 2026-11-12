/**
 * P100 newa (Fauzan, 11 Nov 2026): small pieces shared by the new workflow screens: a paper sheet to print (black on
 * white, both languages printed on the paper itself) and a comment box for approvals (every approval keeps a reason).
 */
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PrinterIcon } from '@phosphor-icons/react';
import { inAppShell, printPage } from '../native';
import '../styles/newa.css';

export interface SheetRow {
  /** Malay first, English under it: the paper is bilingual whatever the screen language. */
  ms: string;
  en: string;
  value: ReactNode;
}

interface SheetProps {
  titleMs: string;
  titleEn: string;
  sub?: string;
  rows: SheetRow[];
  draft?: string | null;
  sign?: [string, string][];
}

function Sheet({ titleMs, titleEn, sub, rows, draft, sign }: SheetProps) {
  return (
    <div className="nw-sheet" data-no-translate>
      {draft && <div className="nw-sheet-draft">{draft}</div>}
      <h3>
        {titleMs} / {titleEn}
      </h3>
      {sub && <p className="nw-sheet-sub">{sub}</p>}
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th>
                {r.ms}
                <small>{r.en}</small>
              </th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sign && sign.length > 0 && (
        <div className="nw-sign">
          {sign.map(([a, b], i) => (
            <div key={i}>
              {a}
              <br />
              {b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A paper sheet with its own Print button; only the sheet prints. Inside the phone app it is saved as a file instead. */
export function PaperSheet(props: SheetProps & { file: string }) {
  const [printing, setPrinting] = useState(false);
  const print = () => {
    setPrinting(true);
    setTimeout(() => {
      if (inAppShell()) void printPage(props.file);
      else window.print();
      setPrinting(false);
    }, 60);
  };
  return (
    <div className="nw-stack">
      <div className="nw-actions">
        <button type="button" className="btn btn-primary" onClick={print}>
          <PrinterIcon size={18} aria-hidden="true" /> Print
        </button>
        <span className="nw-note">Print at 100%. Both languages are on the paper.</span>
      </div>
      <Sheet {...props} />
      {printing &&
        createPortal(
          <Sheet {...props} />,
          document.getElementById('newa-print') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'newa-print' })),
        )}
    </div>
  );
}

/** A comment box and the buttons of an approval: every decision keeps a reason. */
export function Decide({
  onDecide,
  busy,
  approveLabel = 'Approve',
  refuseLabel = 'Refuse',
  placeholder = 'Comment (needed to approve or refuse)',
}: {
  onDecide: (approve: boolean, note: string) => void;
  busy: boolean;
  approveLabel?: string;
  refuseLabel?: string | null;
  placeholder?: string;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="nw-stack" style={{ gap: 6 }}>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Comment" placeholder={placeholder} />
      <div className="nw-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || note.trim().length < 3} onClick={() => onDecide(true, note)}>
          {approveLabel}
        </button>
        {refuseLabel && (
          <button type="button" className="btn btn-sm" disabled={busy || note.trim().length < 3} onClick={() => onDecide(false, note)}>
            {refuseLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Ringgit with two decimals and thousands commas. */
export function rm(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'Rate not set';
  return `RM${v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Today in Malaysia, as YYYY-MM-DD. */
export const todayMyt = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
