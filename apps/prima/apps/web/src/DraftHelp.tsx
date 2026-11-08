import { useEffect, useState } from 'react';
import { DRAFT_HELP_LABELS, bqSuggestionLines, type BillSuggestion, type BqSuggestion, type DraftHelpKind, type PostSuggestion } from '@prima/core';
import { api } from './api';
import type { DraftHelpSuggestion } from './api/draft-help';
import { useLang } from './i18n';

const WARNING_TEXT: Record<string, { bm: string; en: string }> = {
  QUANTITIES_TO_CHECK_ON_SITE: { bm: 'Sahkan semua kuantiti di tapak.', en: 'Check every quantity on site.' },
  NO_RATES_FROM_HELPER: { bm: 'Tiada kadar diberi. Kadar datang dari sebut harga lepas kita atau kontraktor.', en: 'No rates are given. Rates come from our past quotes or the contractor.' },
  HAS_ESTIMATED_QUANTITIES: { bm: 'Ada kuantiti anggaran (bertanda Anggaran).', en: 'Some quantities are estimates (marked Anggaran).' },
  HAS_OPTIONAL_ITEMS: { bm: 'Ada item pilihan.', en: 'Some items are optional.' },
  CHECK_BEFORE_SENDING_FOR_APPROVAL: { bm: 'Semak sebelum hantar untuk kelulusan.', en: 'Check before you send it for approval.' },
  CLOSING_DATE_NOT_SHOWN: { bm: 'Tarikh tutup tidak ditunjukkan.', en: 'The closing date is not shown.' },
  CONFIRM_EVERY_FIGURE: { bm: 'Sahkan setiap angka dengan bil.', en: 'Confirm every figure against the bill.' },
  ATTACH_THE_BILL_AS_USUAL: { bm: 'Lampirkan bil seperti biasa.', en: 'Attach the bill as usual.' },
};
const BILL_LABELS: Record<string, { bm: string; en: string }> = {
  billerName: { bm: 'Pembekal', en: 'Supplier' },
  accountNo: { bm: 'No. akaun', en: 'Account no.' },
  billNo: { bm: 'No. bil', en: 'Bill no.' },
  billDate: { bm: 'Tarikh bil', en: 'Bill date' },
  dueDate: { bm: 'Tarikh akhir bayar', en: 'Due date' },
  periodFrom: { bm: 'Tempoh dari', en: 'Period from' },
  periodTo: { bm: 'Tempoh hingga', en: 'Period to' },
  amountDue: { bm: 'Jumlah perlu dibayar', en: 'Amount due' },
};

export type DraftHelpUse =
  | { kind: 'bq'; suggestion: BqSuggestion; lines: ReturnType<typeof bqSuggestionLines> }
  | { kind: 'job-post'; suggestion: PostSuggestion }
  | { kind: 'bill'; suggestion: BillSuggestion };

/**
 * "Cadangan draf" panel for a form (rule DRAFT-HELP). The host form passes the fields it already holds; the person
 * presses "Use this suggestion" to copy it into the form, then edits and saves the form as usual. This panel saves
 * nothing and never names an AI product. When the server has it off, it shows one plain line.
 */
export function DraftHelp({ kind, form, onUse }: { kind: DraftHelpKind; form: () => unknown; onUse: (use: DraftHelpUse) => void }) {
  const { lang } = useLang();
  const L = lang === 'en' ? DRAFT_HELP_LABELS.en : DRAFT_HELP_LABELS.bm;
  const pick = (x: { bm: string; en: string }) => (lang === 'en' ? x.en : x.bm);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftHelpSuggestion | null>(null);

  useEffect(() => {
    let live = true;
    api.draftHelpStatus().then((s) => live && setAllowed(s.on && s.kinds.includes(kind))).catch(() => live && setAllowed(false));
    return () => { live = false; };
  }, [kind]);

  if (allowed === null) return null;
  if (!allowed) return <p className="muted small">{L.off}</p>;

  const ask = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.draftHelpSuggest(kind, form()));
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 429 ? L.busy : status === 400 ? (e as Error).message : L.failed);
    } finally {
      setBusy(false);
    }
  };
  const use = () => {
    if (!result) return;
    if (kind === 'bq') {
      const s = result.suggestion as BqSuggestion;
      onUse({ kind, suggestion: s, lines: bqSuggestionLines(s) });
    } else if (kind === 'job-post') onUse({ kind, suggestion: result.suggestion as PostSuggestion });
    else onUse({ kind, suggestion: result.suggestion as BillSuggestion });
    setResult(null);
  };

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <strong>{L.title}</strong>
      <p className="muted small">{L.sent}</p>
      {!result && (
        <button className="btn btn-sm" disabled={busy} onClick={ask}>
          {busy ? '…' : L.ask}
        </button>
      )}
      {error && <p className="small" role="alert">{error}</p>}
      {result && (
        <div>
          <p className="small"><span className="chip">{L.title}</span> {L.check}</p>
          {result.kind === 'bq' && <BqPreview s={result.suggestion as BqSuggestion} />}
          {result.kind === 'job-post' && <pre style={{ whiteSpace: 'pre-wrap' }}>{(result.suggestion as PostSuggestion).text}</pre>}
          {result.kind === 'bill' && <BillPreview s={result.suggestion as BillSuggestion} pick={pick} />}
          <ul className="small">
            {result.warnings.map((w) => <li key={w}>{WARNING_TEXT[w] ? pick(WARNING_TEXT[w]) : w}</li>)}
          </ul>
          <button className="btn btn-sm" onClick={use}>{L.use}</button>{' '}
          <button className="btn btn-sm" onClick={() => setResult(null)}>{L.discard}</button>
        </div>
      )}
    </div>
  );
}

function BqPreview({ s }: { s: BqSuggestion }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="small">
        <thead><tr><th>Bil</th><th>Keterangan Kerja</th><th>Kuantiti</th><th>Unit</th><th>Kadar (RM)</th><th>Catatan / Pengiraan</th></tr></thead>
        <tbody>
          {s.sections.map((sec) => [
            <tr key={sec.code}><td><strong>{sec.code}</strong></td><td colSpan={5}><strong>{sec.title}</strong></td></tr>,
            ...sec.lines.map((l) => (
              <tr key={l.code}>
                <td>{l.code}</td><td>{l.item}{l.optional ? ' (Pilihan)' : ''}</td><td>{l.qty}</td><td>{l.unit}</td>
                <td className="muted">—</td><td>{l.working}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
      {s.notes.length > 0 && <ol className="small">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ol>}
    </div>
  );
}

function BillPreview({ s, pick }: { s: BillSuggestion; pick: (x: { bm: string; en: string }) => string }) {
  return (
    <table className="small">
      <tbody>
        {Object.entries(s.fields).map(([k, f]) => (
          <tr key={k}>
            <th style={{ textAlign: 'left' }}>{BILL_LABELS[k] ? pick(BILL_LABELS[k]) : k}</th>
            <td>{f.value == null ? <span className="muted">—</span> : String(f.value)}</td>
            <td className="muted">{f.raw && f.raw !== String(f.value) ? `“${f.raw}”` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
