import { useMemo, useState } from 'react';
import { ITEM_CATEGORIES, SALE_PAPER_LABEL, STATE_LABEL, TAG_METHODS, TAG_METHOD_LABEL, labelDisplay, type BaseUom, type ItemCategory, type SalePaperKind, type TagMethod, type TrackingMode } from '@prima/core';
import { api, type ItemBoard } from '../../api';
import { Chip, Drawer, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../../ui';
import { act, any, CAT_LABEL, partyName, readFile, rolesOf, skuName, STATE_TONE } from './shared';
import { openBlob } from '../../native';

// Sale papers: invoice, payment slip and the signed letter of acknowledgement (Fauzan, 6 Nov 2026).
// Moved unchanged from views/Items.tsx in the P85 split; laid out by the item register styles (styles/items.css).

// ---------- Sale papers ----------


/**
 * The four things a sale needs before ownership passes (Fauzan, 6 Nov 2026): the receipt, the seller's invoice, the
 * buyer's payment slip and the buyer's signed letter of acknowledgement of the items received.
 */
export function SalePapers({ data, m }: { data: ItemBoard; m: ItemBoard['movements'][number] }) {
  const a = useAction();
  const roles = rolesOf(data);
  const sellerFinance = (roles.get(m.fromPartyId) ?? []).includes('finance');
  const buyerFinance = (roles.get(m.toPartyId) ?? []).includes('finance');
  const buyerManager = (roles.get(m.toPartyId) ?? []).includes('manager');
  const papers = m.papers ?? [];
  const cur = new Map(papers.map((p) => [p.kind, p]));
  const received = m.lines.some((l) => l.result === 'received') || m.lotLines.some((l) => (l.qtyReceived ?? 0) > 0);
  const [open, setOpen] = useState<SalePaperKind | null>(null);
  const [ref, setRef] = useState('');
  const [date, setDate] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const may = (k: SalePaperKind) => !m.ownership && (k === 'invoice' ? sellerFinance : k === 'payment_slip' ? buyerFinance && !!cur.get('invoice') : buyerManager);
  const view = async (id: string) => {
    const d = await api.itemPaper(id);
    // Open the stored file as a local copy; nothing is sent anywhere.
    const bin = atob(d.data.slice(d.data.indexOf(',') + 1));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    // P96: inside the app (no second window there) the file is saved instead.
    await openBlob(d.name || 'paper', new Blob([bytes], { type: d.mime }));
  };
  const save = async () => {
    if (!open) return;
    const doc = file ? { name: file.name, data: await readFile(file) } : null;
    const r = await a.run(
      () =>
        open === 'acknowledgement'
          ? act({ kind: 'move.acknowledge', movementId: m.id, ref, date, signedBy, doc, reason })
          : act({ kind: 'move.paper', movementId: m.id, paper: open, ref, date, doc: doc ?? { name: '', data: '' }, reason }),
      'Paper recorded.',
    );
    if (r) {
      setOpen(null);
      setRef('');
      setDate('');
      setReason('');
      setFile(null);
    }
  };
  const rows: [string, boolean, string][] = [
    ['Goods received and checked', received, received ? `${m.lines.filter((l) => l.result === 'received').length} unit(s) received` : 'Not yet'],
    ...(['invoice', 'payment_slip', 'acknowledgement'] as SalePaperKind[]).map((k): [string, boolean, string] => {
      const p = cur.get(k);
      return [SALE_PAPER_LABEL[k], !!p, p ? `${p.ref}, dated ${dateLabel(p.date)}, by ${p.by}` : 'Missing'];
    }),
  ];
  const ack = cur.get('acknowledgement');
  return (
    <div className="panel" style={{ display: 'grid', gap: 8 }}>
      <strong>Sale papers: ownership passes only when all four are in</strong>
      <div className="list">
        {rows.map(([label, ok, note]) => (
          <div key={label} className="list-item">
            <div>
              <div>{label}</div>
              <div className="muted small">{note}</div>
            </div>
            <Chip tone={ok ? 'ok' : 'warn'}>{ok ? 'In' : 'Missing'}</Chip>
          </div>
        ))}
      </div>
      {papers.some((p) => p.docId) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {papers
            .filter((p) => p.docId)
            .map((p) => (
              <button key={`${p.kind}-${p.at}`} className="btn btn-sm" onClick={() => void view(p.docId!)}>
                Open {SALE_PAPER_LABEL[p.kind].split(' (')[0].toLowerCase()} {p.ref}
              </button>
            ))}
        </div>
      )}
      {ack?.letter && (
        <div className="panel item-letter" style={{ background: '#fff', color: '#111' }}>
          <strong>Letter of acknowledgement {ack.ref}</strong>
          <p style={{ margin: '6px 0' }}>{ack.letter.text}</p>
          <span className="small">Dated {dateLabel(ack.date)} · recorded by {ack.by}</span>
        </div>
      )}
      {!m.ownership && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(['invoice', 'payment_slip', 'acknowledgement'] as SalePaperKind[])
            .filter(may)
            .map((k) => (
              <button key={k} className="btn btn-sm" aria-pressed={open === k} onClick={() => setOpen(open === k ? null : k)}>
                {cur.get(k) ? 'Replace' : k === 'acknowledgement' ? 'Sign' : 'Attach'} {SALE_PAPER_LABEL[k].split(' (')[0].toLowerCase()}
              </button>
            ))}
        </div>
      )}
      {open && (
        <div style={{ display: 'grid', gap: 6 }}>
          {open === 'acknowledgement' && (
            <span className="muted small">
              The letter is made from the receipt as it stands now: only items received in good order are acknowledged. Damaged, missing and wrong items stay
              with their cases. The person who checked the goods in does not also sign.
            </span>
          )}
          <input className="input" aria-label="Paper reference" placeholder={open === 'invoice' ? 'Invoice number' : open === 'payment_slip' ? 'Payment or bank reference' : 'Letter reference'} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} />
          <input className="input" type="date" aria-label="Date on the paper" value={date} onChange={(e) => setDate(e.target.value)} />
          {open === 'acknowledgement' && <input className="input" aria-label="Signed by" placeholder="Name and position of the person signing" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} />}
          <label className="field">
            <span className="label">{open === 'acknowledgement' ? 'Signed copy (optional, PDF or photo)' : 'Scanned paper (PDF or photo)'}</span>
            <input className="input" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {cur.get(open) && <input className="input" aria-label="Why it is replaced" placeholder="Why the earlier paper is replaced" value={reason} onChange={(e) => setReason(e.target.value)} />}
          <button className="btn" disabled={a.busy || (open !== 'acknowledgement' && !file)} onClick={() => void save()}>
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </div>
  );
}
