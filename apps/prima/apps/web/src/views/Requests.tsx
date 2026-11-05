import { useState } from 'react';
import { CaretDownIcon, CaretUpIcon, HourglassIcon, PlusIcon, ReceiptIcon } from '@phosphor-icons/react';
import type { ProofInput } from '@prima/core';
import { api, type ExpenseBoard, type ExpenseInput } from '../api';
import { Card, PageHead, Stat, Stats, Steps, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { DocList, ProofPicker } from './Proof';
import '../styles/selfservice.css';

/**
 * Operation claims and office requests (Fauzan, 26 Oct 2026). The Operations Manager sets the month's operation claim
 * items and the COO approves. Office consumables (not IT or asset items), office utilities and rent: the company
 * manager requests, the Chief of Staff approves, the COO gives the final approval.
 */

type Row = ExpenseBoard['requests'][number];

const CATEGORY: Record<NonNullable<Row['category']>, string> = {
  SUPPLIES: 'Office supplies',
  UTILITIES: 'Office utilities',
  RENT: 'Office rent',
};
const STATUS: Record<Row['status'], [Tone, string]> = {
  draft: ['neutral', 'Draft'],
  submitted: ['warn', 'Submitted'],
  cos_approved: ['warn', 'Chief of Staff approved'],
  approved: ['ok', 'Approved'],
  returned: ['warn', 'Sent back'],
  rejected: ['crit', 'Rejected'],
};
const rm = (n: number) => `RM${n.toFixed(2)}`;

function thisMonth(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
}

const PAGE_SUB =
  "Operation claims: the Operations Manager sets the month's items, the COO approves. Office supplies (not IT or assets such as furniture or renovation), office utilities and rent: the company manager requests, the Chief of Staff approves, the COO gives the final approval.";

type Filter = 'all' | 'mine' | 'open';

export function RequestsView() {
  const { data, error } = useLoad(() => api.expenseBoard(), []);
  const [adding, setAdding] = useState<'OPS_CLAIM' | 'OFFICE' | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  if (error)
    return (
      <div className="page ss">
        <PageHead title="Claims and requests" sub={PAGE_SUB} />
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page ss">
        <PageHead title="Claims and requests" sub={PAGE_SUB} />
        <Loading what="requests" />
      </div>
    );
  const open = data.requests.filter((r) => r.waitingOn);
  const forMe = data.requests.filter((r) => r.canCos || r.canCoo);
  const shown = filter === 'all' ? data.requests : filter === 'mine' ? forMe : open;
  return (
    <div className="page ss">
      <PageHead
        title="Claims and requests"
        sub={PAGE_SUB}
        actions={
          (data.can.opsClaim || data.can.office) &&
          !adding && (
            <>
              {data.can.opsClaim && (
                <button className="btn btn-primary btn-sm" onClick={() => setAdding('OPS_CLAIM')}>
                  <PlusIcon size={16} aria-hidden="true" />
                  New operation claim
                </button>
              )}
              {data.can.office && (
                <button className={data.can.opsClaim ? 'btn btn-sm' : 'btn btn-primary btn-sm'} onClick={() => setAdding('OFFICE')}>
                  <PlusIcon size={16} aria-hidden="true" />
                  New office request
                </button>
              )}
            </>
          )
        }
      />
      <Stats>
        <Stat label="Waiting for you" value={data.waiting} tone={data.waiting ? 'warn' : 'ok'} icon={<HourglassIcon size={16} />} onClick={() => setFilter('mine')} />
        <Stat label="Open" value={open.length} note={rm(open.reduce((n, r) => n + r.total, 0))} icon={<ReceiptIcon size={16} />} onClick={() => setFilter('open')} />
      </Stats>
      {data.can.office && !adding && (
        <Card title="Start from last month" sub="Rent or utilities from last month's approved request: check the amount, attach this month's bill and send.">
          <div className="ss-actions">
            <Prefill companies={data.companies} />
          </div>
        </Card>
      )}
      {adding && <ExpenseForm kind={adding} companies={data.companies} onDone={() => setAdding(null)} />}
      <Card title="Requests" flush>
        <div className="ss-tools">
          <div className="seg" role="group" aria-label="Which requests">
            {(
              [
                ['all', 'All', data.requests.length],
                ['mine', 'Waiting for me', forMe.length],
                ['open', 'Open', open.length],
              ] as [Filter, string, number][]
            ).map(([k, l, n]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
                <span className="ss-count">{n}</span>
              </button>
            ))}
          </div>
        </div>
        <ul className="ss-rows ss-req">
          {data.requests.length === 0 && <li className="empty">Nothing yet.</li>}
          {data.requests.length > 0 && shown.length === 0 && <li className="empty">Nothing here.</li>}
          {shown.map((r) => (
            <li key={r.id}>
              <RequestLine r={r} companies={data.companies} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** Where a request is on its way: requested, Chief of Staff (office requests only), COO. */
function requestSteps(r: Row): { label: string; state: StepState; note?: string }[] {
  const office = r.kind === 'OFFICE';
  const steps: { label: string; state: StepState; note?: string }[] = [
    { label: 'Requested', state: r.status === 'draft' || r.status === 'returned' ? 'now' : 'done', note: r.status === 'draft' ? 'Draft' : r.status === 'returned' ? 'Sent back' : r.requestedBy },
  ];
  if (office)
    steps.push({
      label: 'Chief of Staff',
      state: r.cosApproval || r.status === 'cos_approved' || r.status === 'approved' ? 'done' : r.status === 'submitted' ? 'now' : r.status === 'rejected' ? 'stopped' : 'todo',
      note: r.cosApproval?.by,
    });
  const cooNow = r.status === 'cos_approved' || (!office && r.status === 'submitted');
  steps.push({
    label: 'COO',
    state:
      r.status === 'approved' ? 'done' : cooNow ? 'now' : r.status === 'rejected' && (!office || r.cosApproval) ? 'stopped' : 'todo',
    note: r.cooDecision?.by,
  });
  return steps;
}

function RequestLine({ r, companies }: { r: Row; companies: ExpenseBoard['companies'] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction();
  const docs = useLoad(() => (open ? api.expenseDocs(r.id) : Promise.resolve([])), [open, r.docIds.length]);
  const decide = r.canCos || r.canCoo;
  const tone = STATUS[r.status][0];
  return (
    <>
      <div className="ss-row" data-tone={decide ? 'warn' : tone === 'crit' ? 'crit' : undefined}>
        <div className="ss-row-main">
          <span className="ss-row-title">
            {r.kind === 'OPS_CLAIM' ? 'Operation claim' : CATEGORY[r.category!]} {r.period}
          </span>
          <span className="ss-meta">
            {r.companyName} · {r.requestedBy}
            {r.waitingOn ? ` · waiting on ${r.waitingOn}` : ''}
          </span>
        </div>
        <div className="ss-actions">
          <span className="ss-amount">{rm(r.total)}</span>
          <Chip tone={tone}>{STATUS[r.status][1]}</Chip>
          <button className={decide && !open ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : decide || r.canEdit ? 'Act' : 'Details'}
            {open ? <CaretUpIcon size={14} aria-hidden="true" /> : <CaretDownIcon size={14} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="ss-req-detail small">
          <Steps steps={requestSteps(r)} />
          <div className="ss-lines">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.item}</td>
                      <td className="num">{rm(l.amount)}</td>
                      <td className="muted">{l.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {r.returned && r.status === 'returned' && (
            <div className="notice small" data-tone="warn">
              Sent back by {r.returned.by}: {r.returned.note}
            </div>
          )}
          {(r.cosApproval || r.cooDecision) && (
            <div className="ss-meta">
              {r.cosApproval && (
                <span>
                  Chief of Staff: {r.cosApproval.by}, {dateTimeLabel(r.cosApproval.at)}
                </span>
              )}
              {r.cooDecision && (
                <span>
                  COO: {r.cooDecision.by}, {dateTimeLabel(r.cooDecision.at)}
                </span>
              )}
            </div>
          )}
          {docs.data && <DocList docs={docs.data} />}
          {r.canEdit && (
            <div className="ss-actions">
              <button className="btn btn-sm" onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel edit' : 'Edit items'}
              </button>
              <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(() => api.submitExpense(r.id), 'Submitted.')}>
                Submit
              </button>
            </div>
          )}
          {editing && <ExpenseForm kind={r.kind} companies={companies} row={r} onDone={() => setEditing(false)} />}
          {decide && (
            <div className="ss-decide">
              <label className="field">
                <span className="label">Your decision</span>
                <input
                  className="input"
                  aria-label="Note"
                  placeholder="Reason (always required; at least 3 letters to send back or reject)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="ss-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !note.trim()}
                  onClick={() => act.run(() => api.decideExpense(r.id, 'approve', note), r.canCos ? 'Approved, sent to the COO.' : 'Approved.')}
                >
                  Approve
                </button>
                <button className="btn btn-sm" disabled={act.busy || note.trim().length < 3} onClick={() => act.run(() => api.decideExpense(r.id, 'return', note), 'Sent back.')}>
                  Send back
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={act.busy || note.trim().length < 3}
                  onClick={() => act.run(() => api.decideExpense(r.id, 'reject', note), 'Rejected.')}
                >
                  Reject
                </button>
              </div>
            </div>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </>
  );
}

function ExpenseForm({ kind, companies, row, onDone }: { kind: 'OPS_CLAIM' | 'OFFICE'; companies: ExpenseBoard['companies']; row?: Row; onDone: () => void }) {
  const [companyId, setCompanyId] = useState(row?.companyId ?? companies[0]?.id ?? '');
  const [period, setPeriod] = useState(row?.period ?? thisMonth());
  const [category, setCategory] = useState<NonNullable<ExpenseInput['category']>>(row?.category ?? 'SUPPLIES');
  const [lines, setLines] = useState<{ item: string; amount: number; note: string }[]>(row?.lines ?? [{ item: '', amount: 0, note: '' }]);
  const [notAsset, setNotAsset] = useState(false);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const setLine = (i: number, p: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const total = lines.reduce((n, l) => n + (l.amount || 0), 0);
  const save = () =>
    act
      .run(
        () =>
          api.saveExpense(
            {
              id: row?.id ?? null,
              kind,
              companyId,
              period,
              category: kind === 'OFFICE' ? category : null,
              lines: lines.filter((l) => l.item.trim()),
              notAsset,
            },
            proof,
          ),
        'Saved as draft. Submit when ready.',
      )
      .then((r) => r && onDone());
  return (
    <Card
      title={
        <>
          {row ? 'Edit' : 'New'} {kind === 'OPS_CLAIM' ? 'operation claim' : 'office request'}
        </>
      }
      sub={`Total ${rm(total)}`}
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onDone}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" disabled={act.busy || !companyId} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="ss-form">
        <div className="ss-grid">
          <label className="field">
            <span className="label">Company</span>
            <select className="select" aria-label="Company" value={companyId} disabled={!!row} onChange={(e) => setCompanyId(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Month</span>
            <input className="input" type="month" aria-label="Month" value={period} disabled={!!row} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          {kind === 'OFFICE' && (
            <label className="field">
              <span className="label">Category</span>
              <select className="select" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                <option value="SUPPLIES">Office supplies</option>
                <option value="UTILITIES">Office utilities</option>
                <option value="RENT">Office rent</option>
              </select>
            </label>
          )}
        </div>
        <div className="ss-form">
          <span className="label">Items</span>
          {lines.map((l, i) => (
            <div key={i} className="ss-line">
              <input className="input" aria-label="Item" placeholder="Item" value={l.item} onChange={(e) => setLine(i, { item: e.target.value })} />
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                aria-label="Amount RM"
                placeholder="RM"
                value={l.amount || ''}
                onChange={(e) => setLine(i, { amount: Number(e.target.value) || 0 })}
              />
              <input className="input" aria-label="Note" placeholder="Note" value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} />
            </div>
          ))}
          <div className="ss-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setLines([...lines, { item: '', amount: 0, note: '' }])}>
              <PlusIcon size={14} aria-hidden="true" />
              Add item
            </button>
          </div>
        </div>
        {kind === 'OFFICE' && category === 'SUPPLIES' && (
          <label className="ss-check">
            <input type="checkbox" checked={notAsset} onChange={(e) => setNotAsset(e.target.checked)} /> These are consumables, not IT or asset items (furniture,
            renovation)
          </label>
        )}
        <ProofPicker site={null} refText="Receipt" items={proof} onChange={setProof} documentsOnly />
        <ErrorNotice error={act.error} />
      </div>
    </Card>
  );
}

/** Central Admin 5F: start this month's rent or utilities from last month's approved request; check, attach the bill, send. */
function Prefill({ companies }: { companies: { id: string; name: string }[] }) {
  const act = useAction();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const start = (category: 'RENT' | 'UTILITIES') =>
    act.run(() => api.prefillOfficeRequest({ companyId, category, period: thisMonth() }), 'Draft ready: check the amount, attach this month’s bill and send.');
  return (
    <>
      {companies.length > 1 && (
        <select className="select ss-prefill-co" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <button className="btn btn-sm" disabled={act.busy || !companyId} onClick={() => start('RENT')}>
        Rent from last month
      </button>
      <button className="btn btn-sm" disabled={act.busy || !companyId} onClick={() => start('UTILITIES')}>
        Utilities from last month
      </button>
      {act.error && <span className="error small">{act.error.message}</span>}
    </>
  );
}
