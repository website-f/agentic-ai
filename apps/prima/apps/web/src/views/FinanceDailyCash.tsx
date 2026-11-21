import { useState } from 'react';
import { api, type FinControls, type FinDesk } from '../api';
import { ErrorNotice, dateLabel, useAction, useLoad } from '../ui';
import { readAsDataUrl, shrinkImage } from './Proof';
import { ExceptionalGuardCash } from './ExceptionalGuardCash';
import { DataTable, type DtColumn, type DtFilter } from '../DataTable';
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
/** P107: the receipts to upload as a table (search, site and company filters, pages); the upload stays on each row. */
const RECEIPT_COLUMNS: DtColumn<ReceiptDue>[] = [
  { id: 'name', label: 'Name', value: (r) => r.name, render: (r) => <><strong>{r.name}</strong> (…{r.idLast4})</>, phone: 'title' },
  { id: 'site', label: 'Site', value: (r) => r.site, phone: 'sub' },
  { id: 'day', label: 'Date', value: (r) => r.day, sort: 'date', render: (r) => dateLabel(r.day) },
  { id: 'amount', label: 'Amount', value: (r) => r.amount, sort: 'money', render: (r) => rm(r.amount) },
  { id: 'company', label: 'Company', value: (r) => r.companyId, hideBelow: 1100 },
  { id: 'paidBy', label: 'Paid by', value: (r) => r.paidBy, hideBelow: 1200 },
];
const RECEIPT_FILTERS: DtFilter<ReceiptDue>[] = [
  { id: 'site', label: 'Site', value: (r) => r.site },
  { id: 'company', label: 'Company', value: (r) => r.companyId },
];
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
      <DataTable
        label="Signed cash receipts to upload"
        stateKey="fin.dailycash.receipts"
        rows={receipts}
        rowKey={(r) => `${r.listId}-${r.payoutId}`}
        columns={RECEIPT_COLUMNS}
        filters={RECEIPT_FILTERS}
        rowEnd={(r) => <ReceiptUpload r={r} reload={reload} />}
      />
    </section>
  );
}

function ReceiptUpload({ r, reload }: { r: ReceiptDue; reload: () => void }) {
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
    <div>
      <label className="btn btn-sm">
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
