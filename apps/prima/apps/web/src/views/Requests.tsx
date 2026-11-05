import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type ExpenseBoard, type ExpenseInput } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { DocList, ProofPicker } from './Proof';

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

export function RequestsView() {
  const { data, error } = useLoad(() => api.expenseBoard(), []);
  const [adding, setAdding] = useState<'OPS_CLAIM' | 'OFFICE' | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="requests" />;
  const open = data.requests.filter((r) => r.waitingOn);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Claims and requests</h1>
        <p className="muted">
          Operation claims: the Operations Manager sets the month's items, the COO approves. Office supplies (not IT or assets such as furniture or renovation),
          office utilities and rent: the company manager requests, the Chief of Staff approves, the COO gives the final approval.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Waiting for you" value={data.waiting} tone={data.waiting ? 'warn' : 'ok'} />
        <Kpi label="Open" value={open.length} note={rm(open.reduce((n, r) => n + r.total, 0))} />
      </div>
      {(data.can.opsClaim || data.can.office) && !adding && (
        <div className="row" style={{ gap: 6, marginBottom: 12 }}>
          {data.can.opsClaim && (
            <button className="btn btn-sm" onClick={() => setAdding('OPS_CLAIM')}>
              New operation claim
            </button>
          )}
          {data.can.office && (
            <button className="btn btn-sm" onClick={() => setAdding('OFFICE')}>
              New office request
            </button>
          )}
          {data.can.office && <Prefill companies={data.companies} />}
        </div>
      )}
      {adding && <ExpenseForm kind={adding} companies={data.companies} onDone={() => setAdding(null)} />}
      <section className="panel">
        <div className="list">
          {data.requests.length === 0 && <div className="empty">Nothing yet.</div>}
          {data.requests.map((r) => (
            <RequestLine key={r.id} r={r} companies={data.companies} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RequestLine({ r, companies }: { r: Row; companies: ExpenseBoard['companies'] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const act = useAction();
  const docs = useLoad(() => (open ? api.expenseDocs(r.id) : Promise.resolve([])), [open, r.docIds.length]);
  const decide = r.canCos || r.canCoo;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.kind === 'OPS_CLAIM' ? 'Operation claim' : CATEGORY[r.category!]} {r.period} · {rm(r.total)}
          </div>
          <div className="muted small">
            {r.companyName} · {r.requestedBy}
            {r.waitingOn ? ` · waiting on ${r.waitingOn}` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Chip>
          <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : decide || r.canEdit ? 'Act' : 'Details'}
          </button>
        </div>
      </div>
      {open && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {r.lines.map((l, i) => (
              <li key={i}>
                {l.item}: {rm(l.amount)}
                {l.note ? ` (${l.note})` : ''}
              </li>
            ))}
          </ul>
          {r.returned && r.status === 'returned' && (
            <div>
              Sent back by {r.returned.by}: {r.returned.note}
            </div>
          )}
          {r.cosApproval && (
            <div>
              Chief of Staff: {r.cosApproval.by}, {dateTimeLabel(r.cosApproval.at)}
            </div>
          )}
          {r.cooDecision && (
            <div>
              COO: {r.cooDecision.by}, {dateTimeLabel(r.cooDecision.at)}
            </div>
          )}
          {docs.data && <DocList docs={docs.data} />}
          {r.canEdit && (
            <div className="row" style={{ gap: 6 }}>
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
            <>
              <input
                className="input"
                aria-label="Note"
                placeholder="Reason (always required; at least 3 letters to send back or reject)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={act.busy || !note.trim()}
                  onClick={() => act.run(() => api.decideExpense(r.id, 'approve', note), r.canCos ? 'Approved, sent to the COO.' : 'Approved.')}
                >
                  Approve
                </button>
                <button
                  className="btn btn-sm"
                  disabled={act.busy || note.trim().length < 3}
                  onClick={() => act.run(() => api.decideExpense(r.id, 'return', note), 'Sent back.')}
                >
                  Send back
                </button>
                <button
                  className="btn btn-sm"
                  disabled={act.busy || note.trim().length < 3}
                  onClick={() => act.run(() => api.decideExpense(r.id, 'reject', note), 'Rejected.')}
                >
                  Reject
                </button>
              </div>
            </>
          )}
          <ErrorNotice error={act.error} />
        </div>
      )}
    </div>
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
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          {row ? 'Edit' : 'New'} {kind === 'OPS_CLAIM' ? 'operation claim' : 'office request'}
        </h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <select className="select" aria-label="Company" value={companyId} disabled={!!row} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input className="input" type="month" aria-label="Month" value={period} disabled={!!row} onChange={(e) => setPeriod(e.target.value)} />
          {kind === 'OFFICE' && (
            <select className="select" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              <option value="SUPPLIES">Office supplies</option>
              <option value="UTILITIES">Office utilities</option>
              <option value="RENT">Office rent</option>
            </select>
          )}
        </div>
        {lines.map((l, i) => (
          <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
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
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => setLines([...lines, { item: '', amount: 0, note: '' }])}>
            Add item
          </button>
        </div>
        {kind === 'OFFICE' && category === 'SUPPLIES' && (
          <label className="small">
            <input type="checkbox" checked={notAsset} onChange={(e) => setNotAsset(e.target.checked)} /> These are consumables, not IT or asset items
            (furniture, renovation)
          </label>
        )}
        <ProofPicker site={null} refText="Receipt" items={proof} onChange={setProof} documentsOnly />
        <ErrorNotice error={act.error} />
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !companyId}
            onClick={() =>
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
                .then((r) => r && onDone())
            }
          >
            Save
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </section>
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
        <select aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
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
