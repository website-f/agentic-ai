import { Select } from '../SearchSelect';
import { useState, type ReactNode } from 'react';
import {
  ArrowCounterClockwiseIcon,
  HandCoinsIcon,
  PackageIcon,
  PlusIcon,
  ReceiptXIcon,
  ShoppingCartIcon,
  StorefrontIcon,
  UserFocusIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import type { ProofInput, PurCategory } from '@prima/core';
import { api, type PurBoard, type PurRequestInput } from '../api';
import { ProofPicker } from './Proof';
import { DeliveryProofPanel } from './DeliveryProof';
import { RecordButton } from './RecordForm';
import { ImportButton } from './ImportDrawer';
import { WitnessField, emptyWitness } from './Witness';
import { Card, Empty, Facts, PageHead, Search, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, Drawer, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/biz.css';

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

/** The steps every purchase goes through, in order. */
const FLOW: { label: string; at: ReqRow['req']['status'] }[] = [
  { label: 'Quotes', at: 'quoting' },
  { label: 'Approval', at: 'awaiting_approval' },
  { label: 'Order', at: 'approved' },
  { label: 'Receive', at: 'ordered' },
  { label: 'Finance match', at: 'received' },
  { label: 'SQL Account', at: 'posted' },
];
function flowStates(status: ReqRow['req']['status']): StepState[] {
  if (status === 'rejected') return FLOW.map((_, i) => (i === 0 ? 'done' : i === 1 ? 'stopped' : 'todo'));
  const at = FLOW.findIndex((f) => f.at === status);
  return FLOW.map((_, i) => (i < at || status === 'posted' ? 'done' : i === at ? 'now' : 'todo'));
}
const mismatch = (r: ReqRow) => !!r.req.match && !r.req.match.ok && r.req.status === 'received';

/** A labelled control. */
function F({ label, children, span }: { label: string; children: ReactNode; span?: boolean }) {
  return (
    <label className={span ? 'field bz-span' : 'field'}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function PurchasingView() {
  const { data, error } = useLoad(() => api.purBoard(), []);
  const [tab, setTab] = useState<Tab>('requests');
  const [newReq, setNewReq] = useState(false);
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="purchasing" />
      </div>
    );
  const k = data.kpis;
  const r = data.rule;
  const tabs: [Tab, string, number | null][] = [
    ['requests', 'Purchases', k.open],
    ['suppliers', 'Suppliers', data.suppliers.length],
    ['store', 'Store', null],
  ];
  return (
    <div className="page bz-pu">
      <PageHead
        title="Procurement and Inventory"
        sub="Procurement buys all operational and cleaning equipment for the group, under the Operations General Manager."
        actions={
          (canRaise(data.roles) || data.raiseFor.length > 0) && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setTab('requests');
                setNewReq(true);
              }}
            >
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              New purchase
            </button>
          )
        }
      >
        <p className="bz-note">
          Every purchase needs {r.quotesNeeded} quotes from approved suppliers and an online or marketplace price check, then the COO and the CEO approve.
          Nobody approves their own request, and an approver never receives the goods. Finance matches the order, the goods and the e-Invoice before the bill
          goes into SQL Account. The person who gets an item confirms it in their own details.
        </p>
        <p className="notice" data-tone="info">
          Test data. A quote more than {r.onlineTolerancePct}% above the online price needs a reason. Uniforms and equipment are never charged to the guard.
        </p>
      </PageHead>

      <Stats>
        <Stat
          label="Waiting for you"
          value={k.awaitingMe}
          note={k.awaitingMe ? 'Your approval or step' : 'Nothing for you now'}
          tone={k.awaitingMe ? 'warn' : 'ok'}
          icon={<UserFocusIcon size={16} />}
          onClick={() => setTab('requests')}
        />
        <Stat label="Open purchases" value={k.open} tone="info" icon={<ShoppingCartIcon size={16} />} onClick={() => setTab('requests')} />
        <Stat
          label="Invoice mismatches"
          value={k.mismatch}
          note="Order, goods and e-Invoice disagree"
          tone={k.mismatch ? 'crit' : 'ok'}
          icon={<ReceiptXIcon size={16} />}
          onClick={() => setTab('requests')}
        />
        <Stat
          label="Suppliers not ready"
          value={k.suppliersNotReady}
          tone={k.suppliersNotReady ? 'warn' : 'ok'}
          icon={<StorefrontIcon size={16} />}
          onClick={() => setTab('suppliers')}
        />
        <Stat label="Low stock" value={k.lowStock} tone={k.lowStock ? 'warn' : 'ok'} icon={<PackageIcon size={16} />} onClick={() => setTab('store')} />
      </Stats>
      <div className="bz-pu-strip" aria-label="Store follow-ups">
        {(
          [
            ['Not yet confirmed by the person', k.unconfirmed, 'warn'],
            ['Disputed by the person', k.disputed, 'crit'],
            ['To collect from leavers', k.toCollect, 'warn'],
            ['Losses to confirm', k.lossesToConfirm, 'warn'],
            ['Store counts due', k.countsDue, 'warn'],
          ] as [string, number, 'warn' | 'crit'][]
        ).map(([label, n, tone]) => (
          <button key={label} type="button" className="bz-pu-pill" data-tone={n ? tone : 'ok'} onClick={() => setTab('store')}>
            <span className="bz-pu-pill-n">{n}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="tabbar" role="tablist" aria-label="Purchasing">
        {tabs.map(([t, l, n]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
            {n !== null && <span className="bz-count">{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'requests' && <Requests data={data} form={newReq} setForm={setNewReq} />}
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

function Requests({ data, form, setForm }: { data: PurBoard; form: boolean; setForm: (open: boolean) => void }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = data.requests
    .filter((r) => all || !['posted', 'rejected'].includes(r.req.status))
    .filter((r) => !needle || [r.req.title, r.req.ref, r.companyName, r.req.raisedBy, CATEGORY[r.req.category]].some((v) => v.toLowerCase().includes(needle)));
  const mine = rows.filter((r) => r.canApprove);
  const rest = rows.filter((r) => !r.canApprove);
  const current = data.requests.find((r) => r.req.id === open);
  return (
    <>
      <Toolbar
        end={
          <>
            <div className="seg" role="group" aria-label="Which purchases">
              <button aria-pressed={!all} onClick={() => setAll(false)}>
                Open
              </button>
              <button aria-pressed={all} onClick={() => setAll(true)}>
                Show finished
              </button>
            </div>
          </>
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search item, reference, company or person" label="Search purchases" />
      </Toolbar>

      {mine.length > 0 && (
        <Card title="Waiting for your approval" sub="Check the quotes and the online price, then approve or reject with a note." flush>
          <ul className="bz-rows">
            {mine.map((r) => (
              <li key={r.req.id}>
                <RequestRow r={r} onOpen={() => setOpen(r.req.id)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={all ? 'All purchases' : 'Open purchases'} sub={`${rest.length} purchase${rest.length === 1 ? '' : 's'}`} flush>
        {rest.length > 0 ? (
          <ul className="bz-rows">
            {rest.map((r) => (
              <li key={r.req.id}>
                <RequestRow r={r} onOpen={() => setOpen(r.req.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            title={needle ? 'Nothing matches the search.' : all ? 'No purchases yet.' : 'No open purchases.'}
            action={
              !needle && (canRaise(data.roles) || data.raiseFor.length > 0) ? (
                <button className="btn btn-primary" onClick={() => setForm(true)}>
                  <PlusIcon size={16} weight="bold" aria-hidden="true" />
                  New purchase
                </button>
              ) : undefined
            }
          />
        )}
      </Card>

      {current && (
        <Drawer
          title={`${current.req.ref} ${current.req.title}`}
          sub={`${current.companyName} · ${CATEGORY[current.req.category]}`}
          onClose={() => setOpen(null)}
        >
          <RequestDetail key={current.req.id} r={current} data={data} />
        </Drawer>
      )}
      {form && (
        <Drawer title="New purchase" sub="Procurement collects the quotes and checks the online price after you raise it." onClose={() => setForm(false)}>
          <NewRequest data={data} onDone={() => setForm(false)} />
        </Drawer>
      )}
    </>
  );
}

/** One purchase in the inbox: what, who and when, the amount, where it is in the flow. */
function RequestRow({ r, onOpen }: { r: ReqRow; onOpen: () => void }) {
  const states = flowStates(r.req.status);
  return (
    <button type="button" className="bz-row bz-pu-req" data-tone={mismatch(r) ? 'crit' : r.canApprove ? 'warn' : undefined} onClick={onOpen}>
      <span className="bz-row-main">
        <span className="bz-row-title">{r.req.title}</span>
        <span className="bz-row-meta">
          <span className="mono">{r.req.ref}</span> · {r.companyName} · {CATEGORY[r.req.category]}
        </span>
        <span className="bz-row-meta">
          Raised by {r.req.raisedBy}, {dateLabel(r.req.at.slice(0, 10))}
          {r.waiting ? ` · waiting for ${r.waiting}` : ''}
          {r.req.status === 'posted' &&
            (r.paid ? (r.paid.status === 'released' ? ` · paid by Finance ${r.paid.releasedOn ? dateLabel(r.paid.releasedOn) : ''}` : ' · Finance paying') : ' · Finance to pay')}
        </span>
        <span className="bz-pu-track" aria-hidden="true">
          {states.map((s, i) => (
            <span key={i} data-state={s} />
          ))}
        </span>
      </span>
      <span className="bz-row-side">
        <span className="bz-amt">{rm(r.chosen?.amount ?? r.req.total)}</span>
        <span className="bz-sub">{r.chosen ? 'chosen quote' : 'estimated'}</span>
        <Chip tone={r.canApprove ? 'warn' : r.tone}>{mismatch(r) ? 'Invoice mismatch' : STATUS[r.req.status]}</Chip>
      </span>
    </button>
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
  const states = flowStates(r.status);
  const facts: [ReactNode, ReactNode][] = [
    ['Amount', <strong key="a">{rm(row.chosen?.amount ?? r.total)}{row.chosen ? '' : ' estimated'}</strong>],
    ['Raised by', `${r.raisedBy}, ${dateLabel(r.at.slice(0, 10))}`],
    ['Status', <Chip key="s" tone={row.canApprove ? 'warn' : row.tone}>{mismatch(row) ? 'Invoice mismatch' : STATUS[r.status]}</Chip>],
  ];
  if (row.waiting) facts.push(['Waiting for', row.waiting]);
  if (r.tiers.length > 0) facts.push(['Approvals needed', r.tiers.map((t) => ({ manager: 'company manager', coo: 'COO', ceo: 'CEO' })[t]).join(', then ')]);
  if (r.po) facts.push(['Purchase order', `PO ${r.po.ref} ${rm(r.po.amount)}`]);
  if (r.grn) facts.push(['Received', `By ${r.grn.by}, ${dateTimeLabel(r.grn.at)}${r.grn.note ? ` (${r.grn.note})` : ''}`]);
  if (r.invoice)
    facts.push(['Invoice', `${r.invoice.number} ${rm(r.invoice.amount)}${r.invoice.eInvoiceUuid ? `, e-Invoice ${r.invoice.eInvoiceUuid}` : ', no e-Invoice'}`]);
  if (r.posted) facts.push(['SQL Account', r.posted.sqlRef]);
  const history = [
    ...r.approvals.map((a) => `Approved by ${a.by}, ${dateLabel(a.at.slice(0, 10))}`),
    ...(r.rejected ? [`Rejected by ${r.rejected.by}: ${r.rejected.note}`] : []),
    ...(r.rounds ?? []).map(
      (x, i) => `Round ${i + 1} (${rm(x.total)}) rejected by ${x.rejected.by}: ${x.rejected.note}; corrected by ${x.reopened.by}: ${x.reopened.note}`,
    ),
  ];
  return (
    <>
      <Steps
        steps={FLOW.map((f, i) => ({
          label: f.label,
          state: states[i],
          note:
            i === 0 && r.status === 'quoting'
              ? `${r.quotes.length} of ${data.rule.quotesNeeded} quotes`
              : i === 1 && states[i] === 'now' && row.waiting
                ? `Waiting for ${row.waiting}`
                : i === 1 && r.status === 'rejected'
                  ? 'Rejected'
                  : undefined,
        }))}
      />
      <div className="bz-facts">
        <Facts items={facts} />
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

      <section className="bz-sec">
        <h3>Items</h3>
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
      </section>

      {(r.quotes.length > 0 || (r.online ?? []).length > 0) && (
        <section className="bz-sec">
          <h3>Quotes and online price</h3>
          <ul className="bz-pu-quotes">
            {r.quotes.map((q) => (
              <li key={q.supplierId}>
                <span className="bz-row-main">
                  <span className="bz-row-title">{sup(q.supplierId)}</span>
                  <span className="bz-row-meta">Quotation {q.ref}</span>
                </span>
                <span className="bz-chips">
                  {q.supplierId === r.chosenSupplierId && <Chip tone="ok">Chosen</Chip>}
                  {q.amount === row.lowest && <Chip tone="info">Lowest</Chip>}
                  <span className="bz-amt">{rm(q.amount)}</span>
                </span>
              </li>
            ))}
            {(r.online ?? []).map((o, i) => (
              <li key={`o${i}`}>
                <span className="bz-row-main">
                  <span className="bz-row-title">Online price: {o.source}</span>
                  <span className="bz-row-meta">{o.ref}</span>
                </span>
                <span className="bz-amt">{rm(o.amount)}</span>
              </li>
            ))}
          </ul>
          {r.notLowestReason && <p className="bz-note">Not the lowest because: {r.notLowestReason}</p>}
          {r.onlineReason && <p className="bz-note">Dearer than online because: {r.onlineReason}</p>}
        </section>
      )}

      {history.length > 0 && (
        <section className="bz-sec">
          <h3>Approvals</h3>
          <ul className="bz-pu-history">
            {history.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      {r.status === 'quoting' && !proc && <p className="bz-note">Procurement collects the quotes and checks the online price.</p>}
      {proc && r.status === 'quoting' && (
        <>
          <section className="bz-act" aria-label="Add a supplier quote">
            <div className="bz-sec-head">
              <h3>Add a supplier quote</h3>
              <span className="bz-sub">
                {r.quotes.length} of {data.rule.quotesNeeded} quotes · {(r.online ?? []).length ? 'online price checked' : 'online price not checked yet'}
              </span>
            </div>
            <div className="bz-form">
              <F label="Supplier" span>
                <Select className="select" value={quote.supplierId} onChange={(e) => setQuote({ ...quote, supplierId: e.target.value })}>
                  <option value="">Approved supplier…</option>
                  {ready.map((s) => (
                    <option key={s.supplier.id} value={s.supplier.id}>
                      {s.supplier.name}
                    </option>
                  ))}
                </Select>
              </F>
              <F label="Quoted amount">
                <input className="input" placeholder="Quoted amount" inputMode="decimal" value={quote.amount} onChange={(e) => setQuote({ ...quote, amount: e.target.value })} />
              </F>
              <F label="Quotation ref">
                <input className="input" placeholder="Quotation ref" value={quote.ref} onChange={(e) => setQuote({ ...quote, ref: e.target.value })} />
              </F>
            </div>
            <ProofPicker site={null} refText={r.ref} items={quoteDoc} onChange={setQuoteDoc} documentsOnly required />
            <div className="bz-actions">
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
          </section>
          <section className="bz-act" aria-label="Add the online price">
            <h3 className="bz-pu-acth">Add the online price</h3>
            <div className="bz-form">
              <F label="Online source" span>
                <input
                  className="input"
                  placeholder="Website or marketplace (Shopee, Lazada…)"
                  value={online.source}
                  onChange={(e) => setOnline({ ...online, source: e.target.value })}
                />
              </F>
              <F label="Listing link or ref">
                <input className="input" placeholder="Listing link or ref" value={online.ref} onChange={(e) => setOnline({ ...online, ref: e.target.value })} />
              </F>
              <F label="Online price for the same items">
                <input
                  className="input"
                  placeholder="Price for the same items"
                  inputMode="decimal"
                  value={online.amount}
                  onChange={(e) => setOnline({ ...online, amount: e.target.value })}
                />
              </F>
            </div>
            <ProofPicker site={null} refText={r.ref} items={onlineDoc} onChange={setOnlineDoc} documentsOnly required />
            <div className="bz-actions">
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
            <p className="bz-note">Each quote needs the supplier’s quotation and each online price a screenshot of the listing.</p>
          </section>
          {r.quotes.length > 0 && (
            <section className="bz-act" aria-label="Choose the quote">
              <h3 className="bz-pu-acth">Choose the quote and send for approval</h3>
              <div className="bz-form">
                <F label="Chosen quote" span>
                  <Select className="select" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                    {r.quotes.map((q) => (
                      <option key={q.supplierId} value={q.supplierId}>
                        {sup(q.supplierId)} {rm(q.amount)}
                      </option>
                    ))}
                  </Select>
                </F>
                <F label="Reason">
                  <input className="input" placeholder="Reason if not the lowest" value={note} onChange={(e) => setNote(e.target.value)} />
                </F>
                <F label="Reason if dearer than online">
                  <input
                    className="input"
                    placeholder={`Reason if over ${data.rule.onlineTolerancePct}% above online`}
                    value={onlineReason}
                    onChange={(e) => setOnlineReason(e.target.value)}
                  />
                </F>
              </div>
              <div className="bz-actions">
                <button
                  className="btn btn-primary"
                  disabled={act.busy || !chosen}
                  onClick={() => act.run(() => api.purStep(r.id, 'submit', { supplierId: chosen, note, onlineReason }), 'Sent to the COO and CEO for approval.')}
                >
                  Send for approval
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {row.canApprove && (
        <section className="bz-act" aria-label="Your decision">
          <h3 className="bz-pu-acth">Your decision</h3>
          <F label="Note">
            <input className="input" placeholder="Comment (needed to approve or reject)" value={note} onChange={(e) => setNote(e.target.value)} />
          </F>
          <div className="bz-actions">
            <button className="btn btn-primary" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.purStep(r.id, 'approve', { note }), 'Approved.')}>
              Approve
            </button>
            <button className="btn" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.purStep(r.id, 'reject', { note }), 'Rejected.')}>
              Reject
            </button>
          </div>
        </section>
      )}
      {row.canReopen && <Reopen r={r} />}
      {proc && r.status === 'approved' && (
        <section className="bz-act" aria-label="Place the order">
          <h3 className="bz-pu-acth">Place the order</h3>
          <F label="PO number">
            <input className="input" placeholder="Purchase order number" value={po} onChange={(e) => setPo(e.target.value)} />
          </F>
          <div className="bz-actions">
            <button className="btn btn-sm" disabled={act.busy || !po.trim()} onClick={() => act.run(() => api.purStep(r.id, 'order', { ref: po }), 'Order recorded.')}>
              Order placed
            </button>
          </div>
        </section>
      )}
      {row.role === 'store' && r.status === 'ordered' && row.canWork && (
        <section className="bz-act" aria-label="Receive the goods">
          <h3 className="bz-pu-acth">Receive the goods</h3>
          <div className="bz-form">
            {r.lines.map((l, i) => (
              <F key={i} label={`Received ${l.item}`}>
                <input
                  className="input num"
                  placeholder={`Received: ${l.item}`}
                  inputMode="numeric"
                  value={qty[i]}
                  onChange={(e) => setQty(qty.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </F>
            ))}
            <F label="Receipt note" span>
              <input className="input" placeholder="Note (shortages, damage)" value={note} onChange={(e) => setNote(e.target.value)} />
            </F>
          </div>
          <div className="bz-actions">
            <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => act.run(() => api.purStep(r.id, 'receive', { qty: qty.map(Number), note }), 'Goods received.')}>
              Goods received
            </button>
          </div>
        </section>
      )}
      {row.role !== 'store' && r.status === 'ordered' && <p className="bz-note">A storekeeper counts and receives the goods.</p>}
      {row.canFinance && (
        <section className="bz-act" aria-label="Finance">
          <h3 className="bz-pu-acth">Match the invoice</h3>
          <div className="bz-form">
            <F label="Invoice number">
              <input className="input" placeholder="Invoice number" value={inv.number} onChange={(e) => setInv({ ...inv, number: e.target.value })} />
            </F>
            <F label="Invoice amount">
              <input className="input" placeholder="Invoice amount" inputMode="decimal" value={inv.amount} onChange={(e) => setInv({ ...inv, amount: e.target.value })} />
            </F>
            <F label="e-Invoice UUID" span>
              <input
                className="input"
                placeholder="e-Invoice UUID (MyInvois)"
                value={inv.eInvoiceUuid}
                onChange={(e) => setInv({ ...inv, eInvoiceUuid: e.target.value })}
              />
            </F>
          </div>
          <div className="bz-actions">
            <button
              className="btn btn-sm"
              disabled={act.busy || !inv.number.trim() || !inv.amount}
              onClick={() => act.run(() => api.purStep(r.id, 'invoice', { ...inv, amount: Number(inv.amount) }), 'Invoice matched.')}
            >
              Match invoice
            </button>
          </div>
          {r.match?.ok && (
            <>
              <F label="SQL Account ref">
                <input className="input" placeholder="SQL Account purchase invoice no." value={sqlRef} onChange={(e) => setSqlRef(e.target.value)} />
              </F>
              <div className="bz-actions">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy || !sqlRef.trim()}
                  onClick={() => act.run(() => api.purStep(r.id, 'post', { sqlRef }), 'Recorded as entered in SQL Account.')}
                >
                  Entered in SQL Account
                </button>
              </div>
            </>
          )}
        </section>
      )}
      <ErrorNotice error={act.error} />
    </>
  );
}

function NewRequest({ data, onDone }: { data: PurBoard; onDone: () => void }) {
  const act = useAction();
  const companies = data.raiseFor.length ? data.raiseFor : companiesOf(data);
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
  const estimate = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  return (
    <>
      <div className="bz-form">
        {companies.length > 1 && (
          <F label="Company" span>
            <Select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </F>
        )}
        <F label="What is being bought" span>
          <input className="input" placeholder="What is being bought, and why" value={title} onChange={(e) => setTitle(e.target.value)} />
        </F>
        <F label="Category" span>
          <Select className="select" value={category} onChange={(e) => setCategory(e.target.value as PurCategory)}>
            {Object.entries(CATEGORY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </F>
      </div>
      <section className="bz-sec">
        <div className="bz-sec-head">
          <h3>Items</h3>
          <button className="btn btn-sm" onClick={() => setLines([...lines, { item: '', stockItemId: '', qty: '', unitPrice: '' }])}>
            Add line
          </button>
        </div>
        {lines.map((l, i) => {
          const set = (patch: Partial<typeof l>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="bz-act bz-pu-line">
              <span className="bz-sub">Line {i + 1}</span>
              <div className="bz-form">
                <F label="Store item">
                  <Select
                    className="select"
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
                  </Select>
                </F>
                <F label="Item">
                  <input className="input" placeholder="Item" value={l.item} onChange={(e) => set({ item: e.target.value })} />
                </F>
                <F label="Quantity">
                  <input className="input num" placeholder="Qty" inputMode="numeric" value={l.qty} onChange={(e) => set({ qty: e.target.value })} />
                </F>
                <F label="Estimated unit price">
                  <input className="input num" placeholder="Est. unit price" inputMode="decimal" value={l.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} />
                </F>
              </div>
            </div>
          );
        })}
      </section>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button
          className="btn btn-primary"
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
        <span className="bz-sub">Estimated {rm(estimate)}</span>
      </div>
    </>
  );
}

function Suppliers({ data }: { data: PurBoard }) {
  const [form, setForm] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = data.suppliers.filter((s) => !needle || [s.supplier.name, s.companyName, s.supplier.ssmNo].some((v) => v.toLowerCase().includes(needle)));
  const notReady = rows.filter((s) => s.state !== 'approved');
  const ready = rows.filter((s) => s.state === 'approved');
  return (
    <>
      <Toolbar
        end={
          (isProc(data.roles) || data.supplierFor.length > 0) && (
            <button className="btn btn-primary" onClick={() => setForm(true)}>
              <PlusIcon size={16} weight="bold" aria-hidden="true" />
              Add supplier
            </button>
          )
        }
      >
        <Search value={q} onChange={setQ} placeholder="Search supplier, company or SSM number" label="Search suppliers" />
      </Toolbar>
      <p className="notice" data-tone="info">
        A supplier can quote only when Finance has verified its bank account against a bank letter, it has signed a conflict-of-interest declaration and the
        anti-bribery acknowledgement (MACC Act s.17A), and its yearly review is current.
      </p>
      {!data.suppliers.length && (
        <Card>
          <Empty
            title="No suppliers yet."
            action={
              isProc(data.roles) || data.supplierFor.length > 0 ? (
                <button className="btn btn-primary" onClick={() => setForm(true)}>
                  <PlusIcon size={16} weight="bold" aria-hidden="true" />
                  Add supplier
                </button>
              ) : undefined
            }
          >
            A purchase needs quotes from approved suppliers, so add them first.
          </Empty>
        </Card>
      )}
      {notReady.length > 0 && (
        <Card title="Not ready to quote" sub={`${notReady.length} supplier${notReady.length === 1 ? '' : 's'} with checks to finish`} flush>
          <ul className="bz-rows">
            {notReady.map((s) => (
              <li key={s.supplier.id}>
                <SupplierLine s={s} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {ready.length > 0 && (
        <Card title="Approved suppliers" sub={`${ready.length} can quote`} flush>
          <ul className="bz-rows">
            {ready.map((s) => (
              <li key={s.supplier.id}>
                <SupplierLine s={s} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.suppliers.length > 0 && !rows.length && (
        <Card>
          <Empty title="Nothing matches the search." />
        </Card>
      )}
      {form && (
        <Drawer title="Add supplier" sub="Finance verifies the bank account next." onClose={() => setForm(false)}>
          <NewSupplier data={data} onDone={() => setForm(false)} />
        </Drawer>
      )}
    </>
  );
}

function SupplierLine({ s: row }: { s: SupRow }) {
  const [checkNote, setCheckNote] = useState('');
  const act = useAction();
  const [note, setNote] = useState('');
  const s = row.supplier;
  const [tone, label] = SUP_STATE[row.state];
  const company = row.role === 'proc';
  const [blocking, setBlocking] = useState(false);
  const canBlock = (row.role === 'finance' || row.role === 'manager' || row.role === 'proc') && !s.blocked;
  const checks: [string, boolean][] = [
    ['Bank verified', !!s.bank.verifiedOn],
    ['Conflict declaration', !!s.coiDeclaredOn],
    ['Anti-bribery', !!s.abcAckOn],
  ];
  return (
    <div className="bz-row bz-pu-sup" data-tone={tone === 'crit' ? 'crit' : tone === 'warn' ? 'warn' : undefined}>
      <span className="bz-row-main">
        <span className="bz-row-title">
          {s.name} <span className="bz-sub">{row.companyName}</span>
        </span>
        <span className="bz-row-meta">
          SSM {s.ssmNo} · {s.categories.map((c) => CATEGORY[c]).join(', ')}
        </span>
        <span className="bz-row-meta">
          {s.bank.name} ending {s.bank.account.slice(-4)}
          {s.bank.verifiedOn ? `, verified by ${s.bank.verifiedBy}` : ''} · reviewed {s.reviewedOn ? dateLabel(s.reviewedOn) : 'never'}
        </span>
        <span className="bz-chips bz-pu-checks">
          {checks.map(([l, ok]) => (
            <span key={l} className="bz-pu-check" data-ok={ok}>
              {ok ? '✓' : '○'} {l}
            </span>
          ))}
        </span>
        {row.missing.length > 0 && <span className="bz-pu-warn">Missing: {row.missing.join(', ')}</span>}
        {s.blocked && (
          <span className="bz-pu-warn">
            Blocked by {s.blocked.by}: {s.blocked.note}
          </span>
        )}
      </span>
      <span className="bz-row-side">
        <Chip tone={tone}>{label}</Chip>
      </span>
      <div className="bz-pu-sup-acts">
        {row.role === 'finance' && (!s.bank.verifiedOn || (!s.blocked && row.state !== 'approved')) && (
          <input
            className="input"
            aria-label="Check comment"
            placeholder="Comment (needed to verify or review; a short one is fine)"
            value={checkNote}
            onChange={(e) => setCheckNote(e.target.value)}
          />
        )}
        <div className="bz-actions">
          {row.role === 'finance' && !s.bank.verifiedOn && (
            <button
              className="btn btn-sm"
              disabled={act.busy || !checkNote.trim()}
              onClick={() => act.run(() => api.purSupplierStep(s.id, 'verify_bank', checkNote), 'Bank account verified.')}
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
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.purSupplierStep(s.id, 'abc', ''), 'Anti-bribery acknowledgement recorded.')}>
              Anti-bribery signed
            </button>
          )}
          {row.role === 'finance' && !s.blocked && row.state !== 'approved' && (
            <button
              className="btn btn-sm"
              disabled={act.busy || !s.coiDeclaredOn || !s.abcAckOn || !checkNote.trim()}
              title={!s.coiDeclaredOn || !s.abcAckOn ? 'Procurement records the declarations first' : undefined}
              onClick={() => act.run(() => api.purSupplierStep(s.id, 'review', checkNote), 'Yearly review recorded.')}
            >
              Yearly review done (Finance)
            </button>
          )}
          {row.role === 'finance' && s.blocked && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.purSupplierStep(s.id, 'unblock', ''), 'Supplier unblocked.')}>
              Unblock
            </button>
          )}
          {canBlock && (
            <button className="btn btn-sm btn-ghost" aria-expanded={blocking} onClick={() => setBlocking(!blocking)}>
              {blocking ? 'Cancel' : 'Block…'}
            </button>
          )}
        </div>
        {canBlock && blocking && (
          <div className="bz-pu-block">
            <input className="input" aria-label="Reason to block" placeholder="Reason to block" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              className="btn btn-sm btn-danger"
              disabled={act.busy || !note.trim()}
              onClick={() => act.run(() => api.purSupplierStep(s.id, 'block', note), 'Supplier blocked.')}
            >
              Block
            </button>
          </div>
        )}
        <ErrorNotice error={act.error} />
      </div>
    </div>
  );
}

function NewSupplier({ data, onDone }: { data: PurBoard; onDone: () => void }) {
  const act = useAction();
  const companies = data.supplierFor.length ? data.supplierFor : companiesOf(data);
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
    <>
      <div className="bz-form">
        {companies.length > 1 && (
          <F label="Company" span>
            <Select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </F>
        )}
        <F label="Supplier name" span>
          <input className="input" placeholder="Supplier name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </F>
        <F label="SSM number">
          <input className="input" placeholder="SSM number" value={f.ssmNo} onChange={(e) => setF({ ...f, ssmNo: e.target.value })} />
        </F>
        <F label="Category">
          <Select className="select" value={f.categories[0]} onChange={(e) => setF({ ...f, categories: [e.target.value as PurCategory] })}>
            {Object.entries(CATEGORY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </F>
        <F label="Bank">
          <input className="input" placeholder="Bank" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} />
        </F>
        <F label="Bank account number">
          <input className="input" placeholder="Bank account number" inputMode="numeric" value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} />
        </F>
        <label className="row small bz-span">
          <input type="checkbox" checked={f.coiDeclared} onChange={(e) => setF({ ...f, coiDeclared: e.target.checked })} /> Conflict-of-interest declaration signed
        </label>
        <label className="row small bz-span">
          <input type="checkbox" checked={f.abcAck} onChange={(e) => setF({ ...f, abcAck: e.target.checked })} /> Anti-bribery acknowledgement signed
        </label>
      </div>
      <ErrorNotice error={act.error} />
      <div className="bz-form-foot">
        <button
          className="btn btn-primary"
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
      </div>
    </>
  );
}

function GoodwillBilling({ data }: { data: PurBoard }) {
  if (!data.billing.length) return null;
  return (
    <Card
      title="Goodwill Empire billing to companies (draft for Finance)"
      sub="Rental is counted for items a company's guard holds at month end; a sale is counted in the month the guard acknowledges it. Items still on their way to the guard are not billed yet. This is not an invoice or a payment."
    >
      <div className="bz-stack">
        {data.billing.map((b) => (
          <section key={b.month} className="bz-sec">
            <h3>{b.month}</h3>
            {b.companies.length === 0 ? (
              <p className="bz-note">Nothing to bill.</p>
            ) : (
              <div className="table-wrap">
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
                          <span className="bz-amt">{c.total.toFixed(2)}</span>
                          {c.missingPrices > 0 && (
                            <div>
                              <Chip tone="warn">
                                {c.missingPrices} price{c.missingPrices > 1 ? 's' : ''} missing
                              </Chip>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}

function Store({ data }: { data: PurBoard }) {
  const company = isStore(data.roles);
  return (
    <>
      {data.losses.length > 0 && (
        <Card title="Lost or damaged, waiting for confirmation" sub="The company manager confirms or refuses each loss." flush>
          <ul className="bz-rows">
            {data.losses.map((l) => (
              <li key={l.issue.id}>
                <LossLine l={l} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.toCollect.length > 0 && (
        <Card title="To collect from people who have left" flush>
          <ul className="bz-rows">
            {data.toCollect.map((t) => (
              <li key={t.issue.id}>
                <IssueLine t={t} canReturn={company} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Stock" sub={`${data.stock.length} item${data.stock.length === 1 ? '' : 's'} in the store`} actions={<><ImportButton kind="stockItem" /><RecordButton kind="stockItem" label="Add store item" /></>} flush>
        <div className="table-wrap bz-pu-stock">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">In store</th>
                <th className="num">With people</th>
                <th>Life so far</th>
                <th>Last count</th>
                <th>
                  <span className="bz-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.stock.map((s) => (
                <tr key={s.item.id}>
                  <td>
                    <strong className="bz-pu-item">
                      {s.item.name}
                      {s.item.size ? ` ${s.item.size}` : ''}
                    </strong>
                    {data.roles.length > 1 || !company ? <div className="muted small">{s.companyName}</div> : null}
                  </td>
                  <td className="num">
                    <span className="bz-amt">{s.item.onHand}</span>
                    {s.low && (
                      <div>
                        <Chip tone="warn">Reorder</Chip>
                      </div>
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
                    <div>
                      {s.item.lastCount ? `${dateLabel(s.item.lastCount.on)}, counted ${s.item.lastCount.counted}, witness ${s.item.lastCount.witness}` : 'Never'}
                    </div>
                    {(s.item.opening && !s.item.opening.confirmed) || s.countDiff !== 0 || s.countDue ? (
                      <div className="bz-chips bz-pu-cellchips">
                        {s.item.opening && !s.item.opening.confirmed && <Chip tone="warn">Opening stock to confirm</Chip>}
                        {s.countDiff !== 0 && <Chip tone="crit">{s.countDiff > 0 ? `${s.countDiff} more than the record` : `${-s.countDiff} short`}</Chip>}
                        {s.countDue && <Chip tone="warn">Count due</Chip>}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className="bz-pu-rowacts">
                      {company && <CountButton itemId={s.item.id} companyId={s.item.companyId} />}
                      <RecordButton kind="stockItem" id={s.item.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.stock.length && <Empty title="No store items yet." action={<RecordButton kind="stockItem" label="Add store item" primary />} />}
        </div>
      </Card>
      <div className={company ? 'bz-two bz-pu-issue' : 'bz-stack'}>
        {company && <IssueForm data={data} />}
        <Card title="Issued and not yet returned" sub={data.issues.length > 50 ? `Latest 50 of ${data.issues.length}` : `${data.issues.length} issued`} flush>
          {!data.issues.length ? (
            <Empty title="Nothing issued." />
          ) : (
            <ul className="bz-rows">
              {data.issues.slice(0, 50).map((t) => (
                <li key={t.issue.id}>
                  <IssueLine t={t} canReturn={company} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <GoodwillBilling data={data} />
    </>
  );
}

function LossLine({ l }: { l: PurBoard['losses'][number] }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const r = l.issue.returned!;
  return (
    <div className="bz-row bz-pu-block-row" data-tone="warn">
      <span className="bz-row-main">
        <span className="bz-row-title">
          {l.issue.personName}: {l.issue.qty} x {l.itemName} {r.condition}
        </span>
        <span className="bz-row-meta">
          {l.companyName} · recorded by {r.by} {dateLabel(r.at.slice(0, 10))}
          {r.note ? ` · ${r.note}` : ''}
        </span>
      </span>
      <span className="bz-row-side">
        <WarningIcon size={18} aria-hidden="true" className="bz-pu-warnicon" />
      </span>
      <div className="bz-pu-sup-acts">
        {l.canConfirm ? (
          <div className="bz-pu-block">
            <input className="input" aria-label="Note" placeholder="Note (needed to refuse)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn-sm btn-primary" disabled={act.busy || !note.trim()} onClick={() => act.run(() => api.confirmStockLoss(l.issue.id, true, note), 'Loss confirmed.')}>
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
        ) : (
          <p className="bz-note">Waiting for the company manager. The storekeeper never closes a loss alone.</p>
        )}
        <ErrorNotice error={act.error} />
      </div>
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
    <div className="bz-pu-count">
      <input className="input num" aria-label="Counted" placeholder="Counted on the shelf" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
      <WitnessField id={`cnt-${itemId}`} companyId={companyId} value={witness} onChange={setWitness} />
      <div className="bz-actions">
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
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
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
    <div className="bz-row bz-pu-issue-row" data-tone={t.issue.disputed ? 'crit' : undefined}>
      <span className="bz-row-main">
        <span className="bz-row-title">
          {t.issue.personName}: {t.issue.qty} x {t.itemName}
        </span>
        <span className="bz-row-meta">
          {t.companyName} · issued {dateLabel(t.issue.issuedAt.slice(0, 10))} by {t.issue.issuedBy}
          {t.issue.serial ? ` · serial ${t.issue.serial}` : ''}
          {t.issue.acknowledged && t.issue.confirmedAt ? ` · confirmed ${dateLabel(t.issue.confirmedAt.slice(0, 10))}` : ''}
        </span>
        {t.issue.handover && <span className="bz-row-meta">{handoverText(t.issue)}</span>}
        {t.issue.disputed && <span className="bz-pu-warn">The person says: {t.issue.disputed.note}</span>}
      </span>
      <span className="bz-row-side">
        {t.issue.disputed ? (
          <Chip tone="crit">Disputed</Chip>
        ) : !t.issue.acknowledged ? (
          <Chip tone="warn">{t.issue.handover ? handoverStage(t.issue) : 'Not confirmed'}</Chip>
        ) : (
          <Chip tone="ok">Confirmed</Chip>
        )}
        {(t.issue.handover || canReturn) && (
          <span className="bz-actions bz-pu-rowbtns">
            {t.issue.handover && (
              <button className="btn btn-sm" aria-expanded={proof} onClick={() => setProof(!proof)}>
                Proof
              </button>
            )}
            {canReturn && (
              <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
                <ArrowCounterClockwiseIcon size={14} aria-hidden="true" />
                Return
              </button>
            )}
          </span>
        )}
      </span>
      {(proof || open || act.error) && (
        <div className="bz-pu-sup-acts">
          {proof && <DeliveryProofPanel issueId={t.issue.id} />}
          {open && (
            <div className="bz-act">
              <div className="bz-form">
                <F label="Condition">
                  <select className="select" value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)}>
                    <option value="good">Good</option>
                    <option value="worn">Worn</option>
                    <option value="damaged">Damaged</option>
                    <option value="lost">Lost</option>
                  </select>
                </F>
                <F label="What happened">
                  <input className="input" placeholder="What happened (damaged or lost)" value={note} onChange={(e) => setNote(e.target.value)} />
                </F>
              </div>
              <div className="bz-actions">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={act.busy}
                  onClick={() => act.run(() => api.stockReturn(t.issue.id, condition, note), 'Return recorded. Nothing is charged to the guard.')}
                >
                  Record return
                </button>
              </div>
            </div>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
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
    <Card title="Issue to a person" sub="Uniforms and equipment are never charged to the guard.">
      <div className="bz-stack">
        <div className="bz-form">
          {companies.length > 1 && (
            <F label="Company" span>
              <Select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </F>
          )}
          <F label="Find a person">
            <input className="input" placeholder="Find a guard or officer by name" value={find} onChange={(e) => setFind(e.target.value)} />
          </F>
          <F label="Person">
            <Select className="select" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </F>
          <F label="Item" span>
            <Select className="select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Item…</option>
              {stock.map((s) => (
                <option key={s.item.id} value={s.item.id}>
                  {s.item.name}
                  {s.item.size ? ` ${s.item.size}` : ''} ({s.item.onHand} in store)
                </option>
              ))}
            </Select>
          </F>
          <F label="Quantity">
            <input className="input num" placeholder="Qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </F>
          <F label="Serial number">
            <input className="input" placeholder="Serial number (radios, bodycams, devices)" value={serial} onChange={(e) => setSerial(e.target.value)} />
          </F>
          {goodwillStore && (
            <>
              <F label="Operations Manager" span>
                <Select className="select" value={omUserId} onChange={(e) => setOmUserId(e.target.value)}>
                  <option value="">Operations Manager who takes it…</option>
                  {data.govOms.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.title ? ` (${u.title})` : ''}
                    </option>
                  ))}
                </Select>
              </F>
              {needsPatrol && (
                <F label="Patrolling officer" span>
                  <Select className="select" value={patrolPersonId} onChange={(e) => setPatrolPersonId(e.target.value)}>
                    <option value="">Patrolling officer who hands it to the guard…</option>
                    {patrols.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </F>
              )}
            </>
          )}
        </div>
        {goodwillStore ? (
          <p className="bz-note">
            The Operations Manager confirms receiving it. The patrolling officer and the guard then sign on the OM's screen, or the OM attaches their signed
            slips and a photo of the guard holding the item. The company is billed once the guard has it.
          </p>
        ) : (
          <>
            <p className="bz-note">
              Someone with a Prima account confirms receipt in their own details. For a guard with no Prima account, attach the issue slip they signed.
            </p>
            <ProofPicker site={null} refText="Issue slip" items={slip} onChange={setSlip} documentsOnly />
          </>
        )}
        <ErrorNotice error={act.error} />
        <div className="bz-actions">
          <button
            className="btn btn-primary"
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
            <HandCoinsIcon size={16} aria-hidden="true" />
            Issue
          </button>
        </div>
      </div>
    </Card>
  );
}

/** Correct a rejected request and send it again: fresh quotes and a fresh approval round; the rejected round is kept. */
function Reopen({ r }: { r: ReqRow['req'] }) {
  const act = useAction();
  const [note, setNote] = useState('');
  const [lines, setLines] = useState(r.lines.map((l) => ({ ...l, qty: String(l.qty), unitPrice: String(l.unitPrice) })));
  const put = (i: number, k: 'qty' | 'unitPrice', v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <section className="bz-act" aria-label="Correct and send again">
      <h3 className="bz-pu-acth">Correct and send again</h3>
      <p className="bz-note">Correct what the rejection asked for, say what changed, and send it back for fresh quotes and approval.</p>
      <div className="bz-pu-reopen">
        {lines.map((l, i) => (
          <div key={i} className="bz-pu-reopen-line">
            <span className="bz-pu-reopen-item">{l.item}</span>
            <input className="input num" aria-label={`${l.item} quantity`} inputMode="numeric" value={l.qty} onChange={(e) => put(i, 'qty', e.target.value)} />
            <input className="input num" aria-label={`${l.item} estimated price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => put(i, 'unitPrice', e.target.value)} />
          </div>
        ))}
      </div>
      <F label="What was corrected">
        <input className="input" placeholder="What was corrected (required)" value={note} onChange={(e) => setNote(e.target.value)} />
      </F>
      <div className="bz-actions">
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
    </section>
  );
}
