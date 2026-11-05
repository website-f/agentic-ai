import { useState } from 'react';
import type { ProofInput, PurCategory } from '@prima/core';
import { api, type PurBoard, type PurRequestInput } from '../api';
import { ProofPicker } from './Proof';
import { DeliveryProofPanel } from './DeliveryProof';
import { RecordButton } from './RecordForm';
import { WitnessField, emptyWitness } from './Witness';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Procurement and Inventory (Fauzan, 27 Oct 2026). A group department under the Operations General Manager, monitored by
 * the COO and CEO, with 1 executive and 2 storekeepers. The executive gets 3 supplier quotes and checks the online and
 * marketplace price, the COO then the CEO approve, the executive orders and a storekeeper receives. Finance matches the
 * order, the goods and the e-Invoice before the bill goes into SQL Account. The storekeeper issues items and the person
 * confirms receipt in their own details. Never charged to them.
 */

type Tab = 'requests' | 'suppliers' | 'store';
type ReqRow = PurBoard['requests'][number];
type SupRow = PurBoard['suppliers'][number];

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CATEGORY: Record<PurCategory, string> = {
  UNIFORM: 'Uniforms',
  GUARD_EQUIPMENT: 'Guard equipment',
  PATROL_DEVICE: 'Patrol devices and NFC tokens',
  DEVICE: 'Devices: radios, bodycams, translation',
  CLEANING: 'Cleaning equipment and products',
  SERVICES: 'Services',
  IT: 'IT equipment and software',
  OTHER: 'Other',
};
const STATUS: Record<ReqRow['req']['status'], string> = {
  quoting: 'Collecting quotes',
  awaiting_approval: 'Waiting for approval',
  approved: 'Approved, to order',
  rejected: 'Rejected',
  ordered: 'Ordered, to receive',
  received: 'Received, Finance to match',
  posted: 'In SQL Account',
};
const SUP_STATE: Record<SupRow['state'], ['ok' | 'warn' | 'crit' | 'info', string]> = {
  approved: ['ok', 'Approved'],
  review_due: ['warn', 'Yearly review due'],
  incomplete: ['warn', 'Checks missing'],
  blocked: ['crit', 'Blocked'],
};

export function PurchasingView() {
  const { data, error } = useLoad(() => api.purBoard(), []);
  const [tab, setTab] = useState<Tab>('requests');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="purchasing" />;
  const k = data.kpis;
  const r = data.rule;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Procurement and Inventory</h1>
        <p className="muted">
          Procurement buys all operational and cleaning equipment for the group, under the Operations General Manager. Every purchase needs {r.quotesNeeded}{' '}
          quotes from approved suppliers and an online or marketplace price check, then the COO and the CEO approve. Nobody approves their own request, and an
          approver never receives the goods. Finance matches the order, the goods and the e-Invoice before the bill goes into SQL Account. The person who gets
          an item confirms it in their own details.
        </p>
        <p className="notice" data-tone="info">
          Test data. A quote more than {r.onlineTolerancePct}% above the online price needs a reason. Uniforms and equipment are never charged to the guard.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Waiting for you" value={k.awaitingMe} tone={k.awaitingMe ? 'warn' : 'ok'} />
        <Kpi label="Open purchases" value={k.open} />
        <Kpi label="Invoice mismatches" value={k.mismatch} tone={k.mismatch ? 'crit' : 'ok'} />
        <Kpi label="Suppliers not ready" value={k.suppliersNotReady} tone={k.suppliersNotReady ? 'warn' : 'ok'} />
        <Kpi label="Low stock" value={k.lowStock} tone={k.lowStock ? 'warn' : 'ok'} />
        <Kpi label="Not yet confirmed by the person" value={k.unconfirmed} tone={k.unconfirmed ? 'warn' : 'ok'} />
        <Kpi label="Disputed by the person" value={k.disputed} tone={k.disputed ? 'crit' : 'ok'} />
        <Kpi label="To collect from leavers" value={k.toCollect} tone={k.toCollect ? 'warn' : 'ok'} />
        <Kpi label="Losses to confirm" value={k.lossesToConfirm} tone={k.lossesToConfirm ? 'warn' : 'ok'} />
        <Kpi label="Store counts due" value={k.countsDue} tone={k.countsDue ? 'warn' : 'ok'} />
      </div>
      <div className="tabbar" role="tablist" aria-label="Purchasing">
        {(
          [
            ['requests', 'Purchases'],
            ['suppliers', 'Suppliers'],
            ['store', 'Store'],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'requests' && <Requests data={data} />}
      {tab === 'suppliers' && <Suppliers data={data} />}
      {tab === 'store' && <Store data={data} />}
    </div>
  );
}

const canRaise = (roles: PurBoard['roles']) => roles.some((x) => x === 'manager' || x === 'staff' || x === 'proc');
const isProc = (roles: PurBoard['roles']) => roles.includes('proc');
const isStore = (roles: PurBoard['roles']) => roles.includes('store') || roles.includes('proc');
const companiesOf = (data: PurBoard) => {
  const seen = new Map<string, string>();
  for (const s of data.stock) seen.set(s.item.companyId, s.companyName);
  for (const s of data.suppliers) seen.set(s.supplier.companyId, s.companyName);
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
};

function Requests({ data }: { data: PurBoard }) {
  const [all, setAll] = useState(false);
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rows = data.requests.filter((r) => all || !['posted', 'rejected'].includes(r.req.status));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Purchases</h3>
        <div className="row" style={{ gap: 6 }}>
          {canRaise(data.roles) && (
            <button className="btn btn-sm" onClick={() => setForm(!form)}>
              New purchase
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setAll(!all)}>
            {all ? 'Hide finished' : 'Show finished'}
          </button>
        </div>
      </div>
      {form && <NewRequest data={data} onDone={() => setForm(false)} />}
      <div className="list">
        {!rows.length && <div className="empty">No open purchases.</div>}
        {rows.map((r) => (
          <div key={r.req.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <button
              className="row"
              style={{
                justifyContent: 'space-between',
                gap: 6,
                flexWrap: 'wrap',
                background: 'none',
                border: 0,
                padding: 0,
                textAlign: 'left',
                color: 'inherit',
                cursor: 'pointer',
              }}
              aria-expanded={open === r.req.id}
              onClick={() => setOpen(open === r.req.id ? null : r.req.id)}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {r.companyName}: {r.req.ref} {r.req.title}
                </div>
                <div className="muted small">
                  {CATEGORY[r.req.category]} · {rm(r.chosen?.amount ?? r.req.total)}
                  {r.chosen ? '' : ' estimated'} · raised by {r.req.raisedBy}, {dateLabel(r.req.at.slice(0, 10))}
                  {r.waiting ? ` · waiting for ${r.waiting}` : ''}
                  {r.req.status === 'posted' && (r.paid ? (r.paid.status === 'released' ? ` · paid by Finance ${r.paid.releasedOn ? dateLabel(r.paid.releasedOn) : ''}` : ' · Finance paying') : ' · Finance to pay')}
                </div>
              </div>
              <Chip tone={r.canApprove ? 'warn' : r.tone}>
                {r.req.match && !r.req.match.ok && r.req.status === 'received' ? 'Invoice mismatch' : STATUS[r.req.status]}
              </Chip>
            </button>
            {open === r.req.id && <RequestDetail r={r} data={data} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function RequestDetail({ r: row, data }: { r: ReqRow; data: PurBoard }) {
  const act = useAction();
  const r = row.req;
  const proc = row.role === 'proc';
  const [note, setNote] = useState('');
  const [onlineReason, setOnlineReason] = useState('');
  const [online, setOnline] = useState({ source: '', ref: '', amount: '' });
  const [quote, setQuote] = useState({ supplierId: '', amount: '', ref: '' });
  const [quoteDoc, setQuoteDoc] = useState<ProofInput[]>([]);
  const [onlineDoc, setOnlineDoc] = useState<ProofInput[]>([]);
  const [chosen, setChosen] = useState(r.quotes[0]?.supplierId ?? '');
  const [po, setPo] = useState('');
  const [qty, setQty] = useState<string[]>(r.lines.map((l) => String(l.qty)));
  const [inv, setInv] = useState({
    number: r.invoice?.number ?? '',
    amount: r.invoice ? String(r.invoice.amount) : '',
    eInvoiceUuid: r.invoice?.eInvoiceUuid ?? '',
  });
  const [sqlRef, setSqlRef] = useState('');
  const sup = (id: string) => data.suppliers.find((s) => s.supplier.id === id)?.supplier.name ?? id;
  const ready = data.suppliers.filter(
    (s) => s.supplier.companyId === r.companyId && s.state === 'approved' && !r.quotes.some((q) => q.supplierId === s.supplier.id),
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Est. price</th>
              {r.grn && <th className="num">Received</th>}
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.item}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{rm(l.unitPrice)}</td>
                {r.grn && <td className="num">{r.grn.qty[i]}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.quotes.length > 0 && (
        <div className="small">
          <strong>Quotes:</strong>{' '}
          {r.quotes
            .map(
              (q) =>
                `${sup(q.supplierId)} ${rm(q.amount)} (${q.ref})${q.supplierId === r.chosenSupplierId ? ', chosen' : ''}${q.amount === row.lowest ? ', lowest' : ''}`,
            )
            .join(' · ')}
        </div>
      )}
      {(r.online ?? []).length > 0 && (
        <div className="small">
          <strong>Online price:</strong> {(r.online ?? []).map((o) => `${o.source} ${rm(o.amount)} (${o.ref})`).join(' · ')}
        </div>
      )}
      {r.notLowestReason && <div className="small">Not the lowest because: {r.notLowestReason}</div>}
      {r.onlineReason && <div className="small">Dearer than online because: {r.onlineReason}</div>}
      <div className="muted small">
        {r.tiers.length > 0 && `Approvals needed: ${r.tiers.map((t) => ({ manager: 'company manager', coo: 'COO', ceo: 'CEO' })[t]).join(', then ')}. `}
        {r.approvals.map((a) => `Approved by ${a.by}, ${dateLabel(a.at.slice(0, 10))}`).join(' · ')}
        {r.rejected ? ` Rejected by ${r.rejected.by}: ${r.rejected.note}` : ''}
        {(r.rounds ?? []).map((x, i) => ` · Round ${i + 1} (${rm(x.total)}) rejected by ${x.rejected.by}: ${x.rejected.note}; corrected by ${x.reopened.by}: ${x.reopened.note}`).join('')}
        {r.po ? ` · PO ${r.po.ref} ${rm(r.po.amount)}` : ''}
        {r.grn ? ` · received by ${r.grn.by}, ${dateTimeLabel(r.grn.at)}${r.grn.note ? ` (${r.grn.note})` : ''}` : ''}
        {r.invoice
          ? ` · invoice ${r.invoice.number} ${rm(r.invoice.amount)}${r.invoice.eInvoiceUuid ? `, e-Invoice ${r.invoice.eInvoiceUuid}` : ', no e-Invoice'}`
          : ''}
        {r.posted ? ` · SQL Account ${r.posted.sqlRef}` : ''}
      </div>
      {row.paid && (
        <div className="notice" data-tone={row.paid.status === 'released' ? 'info' : 'warn'}>
          {row.paid.status === 'released'
            ? `Paid by Finance on ${row.paid.releasedOn ? dateLabel(row.paid.releasedOn) : '?'}, bank ref ${row.paid.bankRef ?? '?'} (${row.paid.paymentId})${row.paid.onStatement ? '; seen leaving on the bank statement' : '; waiting to be seen on the bank statement'}.`
            : `Finance is paying it: ${row.paid.paymentId}, ${row.paid.status}.`}
        </div>
      )}
      {r.match && (
        <div className="notice" data-tone={r.match.ok ? 'info' : 'warn'}>
          {r.match.ok ? 'Three-way match passed: order, goods received and e-Invoice agree.' : `Three-way match failed: ${r.match.notes.join(' ')}`}
        </div>
      )}
      {r.status === 'quoting' && !proc && <div className="muted small">Procurement collects the quotes and checks the online price.</div>}
      {proc && r.status === 'quoting' && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select className="input" aria-label="Supplier" value={quote.supplierId} onChange={(e) => setQuote({ ...quote, supplierId: e.target.value })}>
              <option value="">Approved supplier…</option>
              {ready.map((s) => (
                <option key={s.supplier.id} value={s.supplier.id}>
                  {s.supplier.name}
                </option>
              ))}
            </select>
            <input
              className="input"
              aria-label="Quoted amount"
              placeholder="Quoted amount"
              inputMode="decimal"
              value={quote.amount}
              onChange={(e) => setQuote({ ...quote, amount: e.target.value })}
            />
            <input
              className="input"
              aria-label="Quotation ref"
              placeholder="Quotation ref"
              value={quote.ref}
              onChange={(e) => setQuote({ ...quote, ref: e.target.value })}
            />
            <button
              className="btn btn-sm"
              disabled={act.busy || !quote.supplierId || !quote.amount || !quote.ref.trim() || !quoteDoc.length}
              onClick={() =>
                act
                  .run(
                    () => api.purStep(r.id, 'quote', { supplierId: quote.supplierId, amount: Number(quote.amount), ref: quote.ref, proof: quoteDoc }),
                    'Quote added with the supplier’s document.',
                  )
                  .then((x) => {
                    if (x) {
                      setQuote({ supplierId: '', amount: '', ref: '' });
                      setQuoteDoc([]);
                    }
                  })
              }
            >
              Add quote
            </button>
          </div>
          <ProofPicker site={null} refText={r.ref} items={quoteDoc} onChange={setQuoteDoc} documentsOnly required />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input
              className="input"
              aria-label="Online source"
              placeholder="Website or marketplace (Shopee, Lazada…)"
              value={online.source}
              onChange={(e) => setOnline({ ...online, source: e.target.value })}
            />
            <input
              className="input"
              aria-label="Listing link or ref"
              placeholder="Listing link or ref"
              value={online.ref}
              onChange={(e) => setOnline({ ...online, ref: e.target.value })}
            />
            <input
              className="input"
              aria-label="Online price for the same items"
              placeholder="Price for the same items"
              inputMode="decimal"
              value={online.amount}
              onChange={(e) => setOnline({ ...online, amount: e.target.value })}
            />
            <button
              className="btn btn-sm"
              disabled={act.busy || !online.source.trim() || !online.ref.trim() || !online.amount || !onlineDoc.length}
              onClick={() =>
                act
                  .run(
                    () => api.purStep(r.id, 'online', { source: online.source, ref: online.ref, amount: Number(online.amount), proof: onlineDoc }),
                    'Online price recorded with its screenshot.',
                  )
                  .then((x) => {
                    if (x) {
                      setOnline({ source: '', ref: '', amount: '' });
                      setOnlineDoc([]);
                    }
                  })
              }
            >
              Add online price
            </button>
          </div>
          <ProofPicker site={null} refText={r.ref} items={onlineDoc} onChange={setOnlineDoc} documentsOnly required />
          <div className="muted small">Each quote needs the supplier’s quotation and each online price a screenshot of the listing.</div>
          <div className="muted small">
            {r.quotes.length} of {data.rule.quotesNeeded} quotes · {(r.online ?? []).length ? 'online price checked' : 'online price not checked yet'}
          </div>
          {r.quotes.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <select className="input" aria-label="Chosen quote" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                {r.quotes.map((q) => (
                  <option key={q.supplierId} value={q.supplierId}>
                    {sup(q.supplierId)} {rm(q.amount)}
                  </option>
                ))}
              </select>
              <input className="input" aria-label="Reason" placeholder="Reason if not the lowest" value={note} onChange={(e) => setNote(e.target.value)} />
              <input
                className="input"
                aria-label="Reason if dearer than online"
                placeholder={`Reason if over ${data.rule.onlineTolerancePct}% above online`}
                value={onlineReason}
                onChange={(e) => setOnlineReason(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !chosen}
                onClick={() => act.run(() => api.purStep(r.id, 'submit', { supplierId: chosen, note, onlineReason }), 'Sent to the COO and CEO for approval.')}
              >
                Send for approval
              </button>
            </div>
          )}
        </>
      )}
      {row.canApprove && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="Note" placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.purStep(r.id, 'approve', { note }), 'Approved.')}>
            Approve
          </button>
          <button className="btn btn-sm" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.purStep(r.id, 'reject', { note }), 'Rejected.')}>
            Reject
          </button>
        </div>
      )}
      {row.canReopen && <Reopen r={r} />}
      {proc && r.status === 'approved' && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input className="input" aria-label="PO number" placeholder="Purchase order number" value={po} onChange={(e) => setPo(e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={act.busy || !po.trim()}
            onClick={() => act.run(() => api.purStep(r.id, 'order', { ref: po }), 'Order recorded.')}
          >
            Order placed
          </button>
        </div>
      )}
      {row.role === 'store' && r.status === 'ordered' && row.canWork && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.lines.map((l, i) => (
            <input
              key={i}
              className="input"
              aria-label={`Received ${l.item}`}
              placeholder={`Received: ${l.item}`}
              inputMode="numeric"
              value={qty[i]}
              onChange={(e) => setQty(qty.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
          <input className="input" aria-label="Receipt note" placeholder="Note (shortages, damage)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.purStep(r.id, 'receive', { qty: qty.map(Number), note }), 'Goods received.')}
          >
            Goods received
          </button>
        </div>
      )}
      {row.role !== 'store' && r.status === 'ordered' && <div className="muted small">A storekeeper counts and receives the goods.</div>}
      {row.canFinance && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input
              className="input"
              aria-label="Invoice number"
              placeholder="Invoice number"
              value={inv.number}
              onChange={(e) => setInv({ ...inv, number: e.target.value })}
            />
            <input
              className="input"
              aria-label="Invoice amount"
              placeholder="Invoice amount"
              inputMode="decimal"
              value={inv.amount}
              onChange={(e) => setInv({ ...inv, amount: e.target.value })}
            />
            <input
              className="input"
              aria-label="e-Invoice UUID"
              placeholder="e-Invoice UUID (MyInvois)"
              value={inv.eInvoiceUuid}
              onChange={(e) => setInv({ ...inv, eInvoiceUuid: e.target.value })}
            />
            <button
              className="btn btn-sm"
              disabled={act.busy || !inv.number.trim() || !inv.amount}
              onClick={() => act.run(() => api.purStep(r.id, 'invoice', { ...inv, amount: Number(inv.amount) }), 'Invoice matched.')}
            >
              Match invoice
            </button>
          </div>
          {r.match?.ok && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input
                className="input"
                aria-label="SQL Account ref"
                placeholder="SQL Account purchase invoice no."
                value={sqlRef}
                onChange={(e) => setSqlRef(e.target.value)}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={act.busy || !sqlRef.trim()}
                onClick={() => act.run(() => api.purStep(r.id, 'post', { sqlRef }), 'Recorded as entered in SQL Account.')}
              >
                Entered in SQL Account
              </button>
            </div>
          )}
        </>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewRequest({ data, onDone }: { data: PurBoard; onDone: () => void }) {
  const act = useAction();
  const companies = companiesOf(data);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PurCategory>('UNIFORM');
  const [lines, setLines] = useState<{ item: string; stockItemId: string; qty: string; unitPrice: string }[]>([
    { item: '', stockItemId: '', qty: '', unitPrice: '' },
  ]);
  const stock = data.stock.filter((s) => s.item.companyId === companyId);
  const input: PurRequestInput = {
    title,
    category,
    lines: lines.map((l) => ({ item: l.item, stockItemId: l.stockItemId || null, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
  };
  return (
    <div className="panel" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      {companies.length > 1 && (
        <select className="input" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <input
        className="input"
        aria-label="What is being bought"
        placeholder="What is being bought, and why"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <select className="input" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as PurCategory)}>
        {Object.entries(CATEGORY).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {lines.map((l, i) => {
        const set = (patch: Partial<typeof l>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select
              className="input"
              aria-label="Store item"
              value={l.stockItemId}
              onChange={(e) => {
                const it = stock.find((s) => s.item.id === e.target.value)?.item;
                set({ stockItemId: e.target.value, item: it ? `${it.name}${it.size ? ` ${it.size}` : ''}` : l.item });
              }}
            >
              <option value="">Not a store item</option>
              {stock.map((s) => (
                <option key={s.item.id} value={s.item.id}>
                  {s.item.name}
                  {s.item.size ? ` ${s.item.size}` : ''}
                </option>
              ))}
            </select>
            <input className="input" aria-label="Item" placeholder="Item" value={l.item} onChange={(e) => set({ item: e.target.value })} />
            <input className="input" aria-label="Quantity" placeholder="Qty" inputMode="numeric" value={l.qty} onChange={(e) => set({ qty: e.target.value })} />
            <input
              className="input"
              aria-label="Estimated unit price"
              placeholder="Est. unit price"
              inputMode="decimal"
              value={l.unitPrice}
              onChange={(e) => set({ unitPrice: e.target.value })}
            />
          </div>
        );
      })}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => setLines([...lines, { item: '', stockItemId: '', qty: '', unitPrice: '' }])}>
          Add line
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !companyId || !title.trim()}
          onClick={() =>
            act
              .run(() => api.raisePurRequest(companyId, input), 'Purchase raised. Add the quotes next.')
              .then((x) => {
                if (x) onDone();
              })
          }
        >
          Raise purchase
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function Suppliers({ data }: { data: PurBoard }) {
  const [form, setForm] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Approved suppliers</h3>
        {isProc(data.roles) && (
          <button className="btn btn-sm" onClick={() => setForm(!form)}>
            Add supplier
          </button>
        )}
      </div>
      <p className="muted small">
        A supplier can quote only when Finance has verified its bank account against a bank letter, it has signed a conflict-of-interest declaration and the
        anti-bribery acknowledgement (MACC Act s.17A), and its yearly review is current.
      </p>
      {form && <NewSupplier data={data} onDone={() => setForm(false)} />}
      <div className="list">
        {!data.suppliers.length && <div className="empty">No suppliers yet.</div>}
        {data.suppliers.map((s) => (
          <SupplierLine key={s.supplier.id} s={s} />
        ))}
      </div>
    </section>
  );
}

function SupplierLine({ s: row }: { s: SupRow }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const s = row.supplier;
  const [tone, label] = SUP_STATE[row.state];
  const company = row.role === 'proc';
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {row.companyName}: {s.name}
          </div>
          <div className="muted small">
            SSM {s.ssmNo} · {s.categories.map((c) => CATEGORY[c]).join(', ')} · {s.bank.name} ending {s.bank.account.slice(-4)}
            {s.bank.verifiedOn ? `, verified by ${s.bank.verifiedBy}` : ''} · reviewed {s.reviewedOn ? dateLabel(s.reviewedOn) : 'never'}
          </div>
          {row.missing.length > 0 && <div className="small">Missing: {row.missing.join(', ')}</div>}
          {s.blocked && (
            <div className="small">
              Blocked by {s.blocked.by}: {s.blocked.note}
            </div>
          )}
        </div>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {row.role === 'finance' && !s.bank.verifiedOn && (
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.purSupplierStep(s.id, 'verify_bank', ''), 'Bank account verified.')}
          >
            Bank verified against bank letter
          </button>
        )}
        {company && !s.blocked && !s.coiDeclaredOn && (
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.purSupplierStep(s.id, 'coi', ''), 'Conflict-of-interest declaration recorded.')}
          >
            Conflict declaration received
          </button>
        )}
        {company && !s.blocked && !s.abcAckOn && (
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.purSupplierStep(s.id, 'abc', ''), 'Anti-bribery acknowledgement recorded.')}
          >
            Anti-bribery signed
          </button>
        )}
        {row.role === 'finance' && !s.blocked && row.state !== 'approved' && (
          <button
            className="btn btn-sm"
            disabled={act.busy || !s.coiDeclaredOn || !s.abcAckOn}
            title={!s.coiDeclaredOn || !s.abcAckOn ? 'Procurement records the declarations first' : undefined}
            onClick={() => act.run(() => api.purSupplierStep(s.id, 'review', ''), 'Yearly review recorded.')}
          >
            Yearly review done (Finance)
          </button>
        )}
        {(row.role === 'finance' || row.role === 'manager' || row.role === 'proc') && !s.blocked && (
          <>
            <input className="input" aria-label="Reason to block" placeholder="Reason to block" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              className="btn btn-sm"
              disabled={act.busy || !note.trim()}
              onClick={() => act.run(() => api.purSupplierStep(s.id, 'block', note), 'Supplier blocked.')}
            >
              Block
            </button>
          </>
        )}
        {row.role === 'finance' && s.blocked && (
          <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.purSupplierStep(s.id, 'unblock', ''), 'Supplier unblocked.')}>
            Unblock
          </button>
        )}
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function NewSupplier({ data, onDone }: { data: PurBoard; onDone: () => void }) {
  const act = useAction();
  const companies = companiesOf(data);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [f, setF] = useState({
    name: '',
    ssmNo: '',
    bankName: '',
    bankAccount: '',
    coiDeclared: false,
    abcAck: false,
    categories: ['UNIFORM'] as PurCategory[],
  });
  return (
    <div className="panel" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
      {companies.length > 1 && (
        <select className="input" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <input className="input" aria-label="Supplier name" placeholder="Supplier name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" aria-label="SSM number" placeholder="SSM number" value={f.ssmNo} onChange={(e) => setF({ ...f, ssmNo: e.target.value })} />
      <select className="input" aria-label="Category" value={f.categories[0]} onChange={(e) => setF({ ...f, categories: [e.target.value as PurCategory] })}>
        {Object.entries(CATEGORY).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <input className="input" aria-label="Bank" placeholder="Bank" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
      <input
        className="input"
        aria-label="Bank account number"
        placeholder="Bank account number"
        inputMode="numeric"
        value={f.bankAccount}
        onChange={(e) => setF({ ...f, bankAccount: e.target.value })}
      />
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={f.coiDeclared} onChange={(e) => setF({ ...f, coiDeclared: e.target.checked })} /> Conflict-of-interest declaration
        signed
      </label>
      <label className="row small" style={{ gap: 6 }}>
        <input type="checkbox" checked={f.abcAck} onChange={(e) => setF({ ...f, abcAck: e.target.checked })} /> Anti-bribery acknowledgement signed
      </label>
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy || !companyId}
        onClick={() =>
          act
            .run(() => api.addPurSupplier(companyId, f), 'Supplier added. Finance verifies the bank account next.')
            .then((x) => {
              if (x) onDone();
            })
        }
      >
        Add supplier
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

function GoodwillBilling({ data }: { data: PurBoard }) {
  if (!data.billing.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Goodwill Empire billing to companies (draft for Finance)</h3>
      </div>
      <p className="muted small">
        Rental is counted for items a company's guard holds at month end; a sale is counted in the month the guard acknowledges it. Items still on
        their way to the guard are not billed yet. This is not an invoice or a payment.
      </p>
      {data.billing.map((b) => (
        <div key={b.month} style={{ marginBottom: 12 }}>
          <h4>{b.month}</h4>
          {b.companies.length === 0 ? (
            <p className="muted small">Nothing to bill.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Items</th>
                  <th className="num">Total (RM)</th>
                </tr>
              </thead>
              <tbody>
                {b.companies.map((c) => (
                  <tr key={c.companyId}>
                    <td>{c.companyName}</td>
                    <td className="small">
                      {c.lines.map((l) => `${l.qty} x ${l.itemName} (${l.kind === 'rental' ? 'rental' : 'sale'}${l.unit == null ? ', price not set' : ''})`).join('; ')}
                      {c.notYetReceived > 0 && (
                        <span className="muted">
                          {c.lines.length ? ' · ' : ''}
                          {c.notYetReceived} on the way to the guard, not billed
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {c.total.toFixed(2)}
                      {c.missingPrices > 0 && (
                        <>
                          {' '}
                          <Chip tone="warn">{c.missingPrices} price{c.missingPrices > 1 ? 's' : ''} missing</Chip>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </section>
  );
}

function Store({ data }: { data: PurBoard }) {
  const company = isStore(data.roles);
  return (
    <>
      <GoodwillBilling data={data} />
      {data.losses.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>Lost or damaged, waiting for confirmation</h3>
          </div>
          <div className="list">
            {data.losses.map((l) => (
              <LossLine key={l.issue.id} l={l} />
            ))}
          </div>
        </section>
      )}
      {data.toCollect.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h3>To collect from people who have left</h3>
          </div>
          <div className="list">
            {data.toCollect.map((t) => (
              <IssueLine key={t.issue.id} t={t} canReturn={company} />
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Stock</h3>
          <RecordButton kind="stockItem" label="Add store item" />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">In store</th>
                <th className="num">With people</th>
                <th>Life so far</th>
                <th>Last count</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.stock.map((s) => (
                <tr key={s.item.id}>
                  <td>
                    {s.item.name}
                    {s.item.size ? ` ${s.item.size}` : ''}
                    {data.roles.length > 1 || !company ? <div className="muted small">{s.companyName}</div> : null}
                  </td>
                  <td className="num">
                    {s.item.onHand}
                    {s.low && (
                      <>
                        {' '}
                        <Chip tone="warn">Reorder</Chip>
                      </>
                    )}
                  </td>
                  <td className="num">{s.out}</td>
                  <td className="small">
                    {s.item.consumable
                      ? `Bought ${s.life.received} · used ${s.life.issued}`
                      : `Bought ${s.life.received} · issued ${s.life.issued} · back ${s.life.returned} · damaged ${s.life.damaged} · lost ${s.life.lost}`}
                    {s.life.unconfirmed ? ` · ${s.life.unconfirmed} not confirmed` : ''}
                  </td>
                  <td className="small">
                    {s.item.lastCount ? `${dateLabel(s.item.lastCount.on)}, counted ${s.item.lastCount.counted}, witness ${s.item.lastCount.witness}` : 'Never'}
                    {s.item.opening && !s.item.opening.confirmed && (
                      <>
                        {' '}
                        <Chip tone="warn">Opening stock to confirm</Chip>
                      </>
                    )}
                    {s.countDiff !== 0 && (
                      <>
                        {' '}
                        <Chip tone="crit">{s.countDiff > 0 ? `${s.countDiff} more than the record` : `${-s.countDiff} short`}</Chip>
                      </>
                    )}
                    {s.countDue && (
                      <>
                        {' '}
                        <Chip tone="warn">Count due</Chip>
                      </>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {company && <CountButton itemId={s.item.id} companyId={s.item.companyId} />}
                      <RecordButton kind="stockItem" id={s.item.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {company && <IssueForm data={data} />}
      <section className="panel">
        <div className="panel-head">
          <h3>Issued and not yet returned</h3>
        </div>
        <div className="list">
          {!data.issues.length && <div className="empty">Nothing issued.</div>}
          {data.issues.slice(0, 50).map((t) => (
            <IssueLine key={t.issue.id} t={t} canReturn={company} />
          ))}
        </div>
      </section>
    </>
  );
}

function LossLine({ l }: { l: PurBoard['losses'][number] }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const r = l.issue.returned!;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div style={{ fontWeight: 600 }}>
        {l.issue.personName}: {l.issue.qty} x {l.itemName} {r.condition}
      </div>
      <div className="muted small">
        {l.companyName} · recorded by {r.by} {dateLabel(r.at.slice(0, 10))}
        {r.note ? ` · ${r.note}` : ''}
      </div>
      {l.canConfirm ? (
        <>
          <input className="input" aria-label="Note" placeholder="Note (needed to refuse)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.confirmStockLoss(l.issue.id, true, note), 'Loss confirmed.')}>
              Confirm
            </button>
            <button
              className="btn btn-sm"
              disabled={act.busy || !note.trim()}
              onClick={() => act.run(() => api.confirmStockLoss(l.issue.id, false, note), 'Refused: the item is back on the person until it is returned.')}
            >
              Refuse
            </button>
          </div>
        </>
      ) : (
        <div className="muted small">Waiting for the company manager. The storekeeper never closes a loss alone.</div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function CountButton({ itemId, companyId }: { itemId: string; companyId: string }) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [witness, setWitness] = useState(emptyWitness);
  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Count
      </button>
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
      <input className="input num" aria-label="Counted" placeholder="Counted on the shelf" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
      <WitnessField id={`cnt-${itemId}`} companyId={companyId} value={witness} onChange={setWitness} />
      <button
        className="btn btn-sm btn-primary"
        disabled={act.busy || counted === ''}
        onClick={() =>
          act.run(() => api.stockCount(itemId, Number(counted), witness), 'Count recorded. A difference stays shown until it is explained.').then((x) => {
            if (x) setOpen(false);
          })
        }
      >
        Record count
      </button>
      <ErrorNotice error={act.error} />
    </div>
  );
}

type Issue = PurBoard['issues'][number]['issue'];

/** Where a Goodwill item is on its way to the guard (Fauzan, 2 Nov 2026). */
function handoverStage(i: Issue): string {
  const h = i.handover;
  if (!h) return '';
  if (i.acknowledged) return 'Guard has it';
  if (!h.om) return `With the store, waiting for ${h.omName}`;
  if (h.patrol && !h.patrol.step) return `With ${h.omName}, waiting for ${h.patrol.name}`;
  return `With ${h.patrol ? h.patrol.name : h.omName}, waiting for ${i.personName}`;
}

function handoverText(i: Issue): string {
  const h = i.handover!;
  const d = (at: string) => dateLabel(at.slice(0, 10));
  return [
    `OM ${h.omName}${h.om ? ` received ${d(h.om.at)}` : ' not yet'}`,
    h.patrol ? `patrolling officer ${h.patrol.name}${h.patrol.step ? ` signed ${d(h.patrol.step.at)}` : ' not yet'}` : '',
    `guard${i.acknowledged && i.confirmedAt ? ` signed ${d(i.confirmedAt)}` : ' not yet'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function IssueLine({ t, canReturn }: { t: PurBoard['issues'][number]; canReturn: boolean }) {
  const act = useAction();
  const [condition, setCondition] = useState<'good' | 'worn' | 'damaged' | 'lost'>('good');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState(false);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            {t.issue.personName}: {t.issue.qty} x {t.itemName}
          </div>
          <div className="muted small">
            {t.companyName} · issued {dateLabel(t.issue.issuedAt.slice(0, 10))} by {t.issue.issuedBy}
            {t.issue.serial ? ` · serial ${t.issue.serial}` : ''}
            {t.issue.acknowledged && t.issue.confirmedAt ? ` · confirmed ${dateLabel(t.issue.confirmedAt.slice(0, 10))}` : ''}
          </div>
          {t.issue.handover && <div className="muted small">{handoverText(t.issue)}</div>}
          {t.issue.disputed && <div className="small">The person says: {t.issue.disputed.note}</div>}
        </div>
        {t.issue.disputed ? (
          <Chip tone="crit">Disputed</Chip>
        ) : !t.issue.acknowledged ? (
          <Chip tone="warn">{t.issue.handover ? handoverStage(t.issue) : 'Not confirmed'}</Chip>
        ) : (
          <Chip tone="ok">Confirmed</Chip>
        )}
        {t.issue.handover && (
          <button className="btn btn-sm" aria-expanded={proof} onClick={() => setProof(!proof)}>
            Proof
          </button>
        )}
        {canReturn && (
          <button className="btn btn-sm" onClick={() => setOpen(!open)}>
            Return
          </button>
        )}
      </div>
      {proof && <DeliveryProofPanel issueId={t.issue.id} />}
      {open && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="input" aria-label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)}>
            <option value="good">Good</option>
            <option value="worn">Worn</option>
            <option value="damaged">Damaged</option>
            <option value="lost">Lost</option>
          </select>
          <input
            className="input"
            aria-label="What happened"
            placeholder="What happened (damaged or lost)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={act.busy}
            onClick={() => act.run(() => api.stockReturn(t.issue.id, condition, note), 'Return recorded. Nothing is charged to the guard.')}
          >
            Record return
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function IssueForm({ data }: { data: PurBoard }) {
  const act = useAction();
  const companies = companiesOf(data);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [find, setFind] = useState('');
  const [personId, setPersonId] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('1');
  const [serial, setSerial] = useState('');
  const [slip, setSlip] = useState<ProofInput[]>([]);
  // Goodwill's store issues to guards of every company it serves, never to central staff (Fauzan, 2 Nov 2026).
  const goodwillStore = companyId === 'goodwill';
  const central = new Set(['pwvsb', 'merdeka', 'goodwill']);
  const people = data.people
    .filter((p) => (goodwillStore ? !central.has(p.companyId) : p.companyId === companyId) && (!find || p.name.toLowerCase().includes(find.toLowerCase())))
    .slice(0, 50);
  const stock = data.stock.filter((s) => s.item.companyId === companyId);
  // A Goodwill item goes store -> Operations Manager -> patrolling officer -> guard (Fauzan, 2 Nov 2026).
  const [omUserId, setOmUserId] = useState('');
  const [patrolPersonId, setPatrolPersonId] = useState('');
  const receiver = data.people.find((p) => p.id === personId);
  const needsPatrol = goodwillStore && !!receiver && receiver.role !== 'patrol_officer';
  const patrols = receiver ? data.people.filter((p) => p.role === 'patrol_officer' && p.companyId === receiver.companyId) : [];
  const handoverReady = !goodwillStore || (!!omUserId && (!needsPatrol || !!patrolPersonId));
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Issue to a person</h3>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {companies.length > 1 && (
          <select className="input" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="input"
          aria-label="Find a person"
          placeholder="Find a guard or officer by name"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        <select className="input" aria-label="Person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Choose…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Item…</option>
          {stock.map((s) => (
            <option key={s.item.id} value={s.item.id}>
              {s.item.name}
              {s.item.size ? ` ${s.item.size}` : ''} ({s.item.onHand} in store)
            </option>
          ))}
        </select>
        <input className="input" aria-label="Quantity" placeholder="Qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input
          className="input"
          aria-label="Serial number"
          placeholder="Serial number (radios, bodycams, devices)"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
        />
        {goodwillStore ? (
          <>
            <select className="input" aria-label="Operations Manager" value={omUserId} onChange={(e) => setOmUserId(e.target.value)}>
              <option value="">Operations Manager who takes it…</option>
              {data.govOms.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.title ? ` (${u.title})` : ''}
                </option>
              ))}
            </select>
            {needsPatrol && (
              <select className="input" aria-label="Patrolling officer" value={patrolPersonId} onChange={(e) => setPatrolPersonId(e.target.value)}>
                <option value="">Patrolling officer who hands it to the guard…</option>
                {patrols.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <p className="muted small">
              The Operations Manager confirms receiving it. The patrolling officer and the guard then sign on the OM's screen, or the OM attaches
              their signed slips and a photo of the guard holding the item. The company is billed once the guard has it.
            </p>
          </>
        ) : (
          <>
            <p className="muted small">
              Someone with a Prima account confirms receipt in their own details. For a guard with no Prima account, attach the issue slip they signed.
            </p>
            <ProofPicker site={null} refText="Issue slip" items={slip} onChange={setSlip} documentsOnly />
          </>
        )}
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !personId || !itemId || !handoverReady}
          onClick={() =>
            act.run(
              async () => {
                await api.stockIssue(companyId, {
                  itemId,
                  personId,
                  qty: Number(qty),
                  serial,
                  ...(goodwillStore ? { omUserId, ...(needsPatrol ? { patrolPersonId } : {}) } : slip.length ? { slip } : {}),
                });
                setSlip([]);
              },
              goodwillStore
                ? 'Issued. Waiting for the Operations Manager to confirm.'
                : slip.length
                  ? 'Issued with the signed slip.'
                  : 'Issued. Waiting for the person to confirm.',
            )
          }
        >
          Issue
        </button>
        <ErrorNotice error={act.error} />
      </div>
    </section>
  );
}

/** Correct a rejected request and send it again: fresh quotes and a fresh approval round; the rejected round is kept. */
function Reopen({ r }: { r: ReqRow['req'] }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [lines, setLines] = useState(r.lines.map((l) => ({ ...l, qty: String(l.qty), unitPrice: String(l.unitPrice) })));
  const put = (i: number, k: 'qty' | 'unitPrice', v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="notice" data-tone="info" style={{ display: 'grid', gap: 6 }}>
      <div className="small">Correct what the rejection asked for, say what changed, and send it back for fresh quotes and approval.</div>
      {lines.map((l, i) => (
        <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small" style={{ minWidth: 100 }}>
            {l.item}
          </span>
          <input className="input" aria-label={`${l.item} quantity`} inputMode="numeric" value={l.qty} onChange={(e) => put(i, 'qty', e.target.value)} style={{ width: 80 }} />
          <input className="input" aria-label={`${l.item} estimated price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => put(i, 'unitPrice', e.target.value)} style={{ width: 100 }} />
        </div>
      ))}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input className="input" aria-label="What was corrected" placeholder="What was corrected (required)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button
          className="btn btn-sm btn-primary"
          disabled={act.busy || !note.trim()}
          onClick={() =>
            act.run(
              () => api.purStep(r.id, 'reopen', { note, lines: lines.map((l) => ({ item: l.item, stockItemId: l.stockItemId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })) }),
              'Corrected and sent back to Procurement for quotes.',
            )
          }
        >
          Correct and send again
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}
