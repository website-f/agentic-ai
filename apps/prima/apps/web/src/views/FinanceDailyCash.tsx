import { useState } from 'react';
import { api, type FinControls, type FinDesk } from '../api';
import { ErrorNotice, dateLabel, useAction, useLoad } from '../ui';
import { readAsDataUrl, shrinkImage } from './Proof';
import { ExceptionalGuardCash } from './ExceptionalGuardCash';
type Co = FinDesk['companies'][number];
type ReceiptDue = Awaited<ReturnType<typeof api.finDailyCashMine>>['receipts'][number];
const rm = (n: number) => `RM${n.toFixed(2)}`;
function useGo(companyId: string) {
  const act = useAction();
  return { act, go: (action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(companyId, 'dailycash', action, input), msg) };
}
export function DailyCash({ v, co }: { v: FinControls; co: Co }) {
  return <><ExceptionalGuardCash companyId={co.companyId} /><section className="panel"><h3>Legacy cash history</h3><p>Closed to new requests, approvals and payouts. Existing evidence and reconciliation remain available through the controlled legacy API.</p>{v.dailyCash.lists.map(l => <p key={l.id}>{l.id} · {l.status} · {rm(l.total)} · {l.payouts.length} recorded payments</p>)}</section></>;
}
export function MyDailyCash() {
  const { data, error, reload } = useLoad(() => api.finDailyCashMine(), []);
  if (error) return <ErrorNotice error={error} />;
  return data?.receipts.length ? <ReceiptUploads receipts={data.receipts} reload={reload} /> : null;
}
function ReceiptUploads({ receipts, reload }: { receipts: ReceiptDue[]; reload: () => void }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Signed cash receipts to upload</h3>
          <div className="muted small">
            The COO or CEO paid these people in cash. Collect each signed receipt and upload a scan or photo (PDF, JPEG or PNG). Finance cannot settle the list
            until every receipt is in.
          </div>
        </div>
        <span className="muted small">{receipts.length}</span>
      </div>
      <div className="list">
        {receipts.map((r) => (
          <ReceiptLine key={`${r.listId}-${r.payoutId}`} r={r} reload={reload} />
        ))}
      </div>
    </section>
  );
}

function ReceiptLine({ r, reload }: { r: ReceiptDue; reload: () => void }) {
  const { act, go } = useGo(r.companyId);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) return setErr('Attach a PDF, JPEG or PNG file.');
    let data = await readAsDataUrl(f);
    if (f.type !== 'application/pdf') data = await shrinkImage(data);
    const x = await go('receipt', { listId: r.listId, payoutId: r.payoutId, name: f.name, data }, 'Signed receipt uploaded.');
    if (x) reload();
  };
  return (
    <div className="list-item" style={{ display: 'block' }}>
      <div>
        <strong>{r.name}</strong> (…{r.idLast4}) · {r.site} · {dateLabel(r.day)} · {rm(r.amount)}
        <div className="muted small">
          {r.companyId} · paid in cash by {r.paidBy}
        </div>
      </div>
      <label className="btn btn-sm" style={{ marginTop: 6 }}>
        Upload signed receipt
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          aria-label={`Signed receipt for ${r.name} ${r.day}`}
          style={{ display: 'none' }}
          disabled={act.busy}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </label>
      {err && <p className="notice" data-tone="crit">{err}</p>}
      <ErrorNotice error={act.error} />
    </div>
  );
}
