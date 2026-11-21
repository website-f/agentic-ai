import { Select } from '../SearchSelect';
import { useState } from 'react';
import { finStampPenalty } from '@prima/core';
import { api, type FinControls, type FinDesk } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction, useLoad } from '../ui';
import { DataTable, type DtAction } from '../DataTable';

/**
 * Money in (Fauzan, 2 Nov 2026: yes to suggestions 1, 2 and 5). Every contract's monthly invoice in SQL Account, government
 * claims followed up until the money is on the bank statement, and money in with no invoice allocated within 7 days.
 * Prima finds payments on the statement; people allocate and check. The server enforces who may do each step.
 */

type Co = FinDesk['companies'][number];
type MoneyIn = FinControls['moneyIn'];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function useGo(companyId: string) {
  const act = useAction();
  const go = (area: 'billing' | 'govt' | 'moneyin', action: string, input: Record<string, unknown>, msg: string) =>
    act.run(() => api.finControlAction(companyId, area, action, input), msg);
  return { act, go };
}

/**
 * P107: which step box is open under each table row ("Record invoice", "Followed up"…). The row's buttons now sit in the
 * row's action menu; pressing one again closes its box, as the old toggle buttons did.
 */
function useRowModes<M extends string>() {
  const [modes, setModes] = useState<Record<string, M | null>>({});
  const mode = (id: string) => modes[id] ?? null;
  const set = (id: string, m: M | null) => setModes((x) => ({ ...x, [id]: m }));
  const toggle = (id: string, m: M) => setModes((x) => ({ ...x, [id]: x[id] === m ? null : m }));
  return { mode, set, toggle };
}
const block = { display: 'block' } as const;

export function MoneyInPanels({ v, co }: { v: FinControls; co: Co }) {
  return (
    <>
      <Billing v={v} co={co} />
      <GovtClaims m={v.moneyIn} co={co} />
      <Unidentified m={v.moneyIn} co={co} />
      <StampDuty v={v} co={co} />
    </>
  );
}

// ---------- Billing to invoice ----------

function Billing({ v, co }: { v: FinControls; co: Co }) {
  const [period, setPeriod] = useState(v.moneyIn.period);
  const other = useLoad(() => (period === v.moneyIn.period ? Promise.resolve(null) : api.finControls(co.companyId, period)), [period, co.companyId]);
  const m = period === v.moneyIn.period ? v.moneyIn : other.data?.moneyIn;
  const missing = m?.billing.filter((r) => r.status === 'missing').length ?? 0;
  const modes = useRowModes<BillMode>();
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Contracts billed</h3>
          <div className="muted small">
            Every contract that ran in the month has its invoice in SQL Account. Record the invoice number, or why there is none (someone else checks it). A
            contract with neither is named at the close.
          </div>
        </div>
      </div>
      {m && missing > 0 && (
        <div className="notice" data-tone="warn" role="status">
          {missing} contract(s) with no invoice recorded for {m.period}.
        </div>
      )}
      {/* P107: the month's contracts as a table; the billing month picker sits in the table's bar, the steps in each row's menu. */}
      <DataTable
        label="Contracts billed"
        stateKey="fin.billing"
        rows={m?.billing}
        rowKey={(r) => r.contractId}
        loading={!m && other.loading}
        loadingWhat="billing"
        error={other.error}
        toolbar={
          <Select className="select" aria-label="Billing month" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {v.moneyIn.periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        }
        searchText={(r) => `${r.none?.reason ?? ''} ${r.invoice?.note ?? ''}`}
        columns={[
          { id: 'client', label: 'Client', value: (r) => r.client, phone: 'title', render: (r) => <span className="fin-strong">{r.client}</span> },
          { id: 'contract', label: 'Contract', value: (r) => r.contractRef, phone: 'sub' },
          {
            id: 'expected',
            label: 'Contract amount',
            value: (r) => r.expected,
            sort: 'money',
            render: (r) => (r.expected == null ? 'by hours worked' : rm(r.expected)),
          },
          { id: 'sent', label: 'Sent to client', value: (r) => r.sentAmount, sort: 'money', render: (r) => rm(r.sentAmount), hideBelow: 1200 },
          {
            id: 'invoice',
            label: 'Invoice',
            value: (r) => r.invoice?.no ?? '',
            render: (r) => (
              <span className="small">
                {r.invoice
                  ? `${r.invoice.no} ${dateLabel(r.invoice.date)} ${rm(r.invoice.amount)}${r.invoice.note ? ` (${r.invoice.note})` : ''}, ${r.invoice.by}`
                  : ''}
                {r.invoice && r.none ? ' · ' : ''}
                {r.none ? `no invoice: ${r.none.reason} (${r.none.by}${r.none.checked ? `; checked by ${r.none.checked.by}` : ''})` : ''}
                {!r.invoice && !r.none ? '–' : ''}
              </span>
            ),
          },
          { id: 'status', label: 'Status', value: billingStatus, translate: true, render: (r) => <Chip tone={BILL_TONE[r.status] ?? 'crit'}>{billingStatus(r)}</Chip> },
        ]}
        filters={[{ id: 'status', label: 'Status', value: billingStatus }]}
        actions={(r) => {
          const id = m ? `${m.period}:${r.contractId}` : r.contractId;
          return [
            { label: 'Record invoice', hidden: r.status === 'invoiced', onClick: () => modes.toggle(id, 'invoice') },
            { label: 'No invoice this month', hidden: r.status !== 'missing', onClick: () => modes.toggle(id, 'none') },
            { label: 'Check the reason', hidden: r.status !== 'none_to_check', onClick: () => modes.toggle(id, 'check') },
          ];
        }}
        rowDetail={(r) => {
          if (!m) return null;
          const id = `${m.period}:${r.contractId}`;
          const mode = modes.mode(id);
          return mode ? <BillingStep key={`${id}:${mode}`} r={r} co={co} period={m.period} mode={mode} onDone={() => modes.set(id, null)} /> : null;
        }}
        empty={m ? <div className="empty">No contracts ran in {m.period}.</div> : undefined}
      />
    </section>
  );
}

type BillMode = 'invoice' | 'none' | 'check';
type BillRow = MoneyIn['billing'][number];
const billingStatus = (r: BillRow) =>
  r.status === 'invoiced' ? 'Invoiced' : r.status === 'none_checked' ? 'No invoice, checked' : r.status === 'none_to_check' ? 'No invoice, to check' : 'Missing';
const BILL_TONE: Record<string, Parameters<typeof Chip>[0]['tone']> = { invoiced: 'ok', none_checked: 'neutral', none_to_check: 'warn', missing: 'crit' };

/** One contract's billing step (record the invoice, or why there is none, or check that reason), under its row. */
function BillingStep({ r, co, period, mode, onDone }: { r: BillRow; co: Co; period: string; mode: BillMode; onDone: () => void }) {
  const { act, go } = useGo(co.companyId);
  const [form, setForm] = useState({ invoiceNo: '', invoiceDate: '', amount: r.expected ?? r.sentAmount ?? 0, note: '' });
  const [text, setText] = useState('');
  const base = { contractId: r.contractId, period };
  return (
    <div className="fin-stack">
      {mode === 'invoice' && (
        <div className="row">
          <input
            className="input"
            aria-label="SQL Account invoice number"
            placeholder="Invoice no."
            value={form.invoiceNo}
            onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
          />
          <input
            className="input"
            type="date"
            aria-label="Invoice date"
            value={form.invoiceDate}
            onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            aria-label="Invoice amount RM"
            value={form.amount || ''}
            onChange={(e) => setForm({ ...form, amount: Math.max(0, Number(e.target.value) || 0) })}
          />
          <input
            className="input"
            aria-label="Note"
            placeholder="Note (needed if not the contract amount)"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !form.invoiceNo.trim() || !form.invoiceDate || !form.amount}
            onClick={() => go('billing', 'invoice', { ...base, ...form }, 'Invoice recorded.').then((x) => x && onDone())}
          >
            Save
          </button>
        </div>
      )}
      {(mode === 'none' || mode === 'check') && (
        <div className="row">
          <input
            className="input fin-flex"
            aria-label={mode === 'none' ? 'Why there is no invoice' : 'Check comment'}
            placeholder={mode === 'none' ? 'Why (suspended, billed under another contract…)' : 'What you checked'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {mode === 'none' ? (
            <button
              className="btn btn-sm"
              disabled={act.busy || text.trim().length < 5}
              onClick={() => go('billing', 'none', { ...base, reason: text }, 'Sent for a check.').then((x) => x && onDone())}
            >
              Save
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !text.trim()}
                onClick={() => go('billing', 'check', { ...base, comment: text }, 'Checked.').then((x) => x && onDone())}
              >
                Agree
              </button>
              <button
                className="btn btn-sm"
                disabled={act.busy || text.trim().length < 5}
                onClick={() => go('billing', 'check', { ...base, ok: false, comment: text }, 'Sent back: bill it.').then((x) => x && onDone())}
              >
                Not agreed, bill it
              </button>
            </>
          )}
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Government claims ----------

function GovtClaims({ m, co }: { m: MoneyIn; co: Co }) {
  const { act, go } = useGo(co.companyId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ agency: '', invoiceNo: '', amount: 0, claimRef: '', submittedOn: '', contractId: '' });
  const open = m.govt.filter((c) => c.status === 'submitted' || c.status === 'queried');
  const modes = useRowModes<GovtMode>();
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Government claims</h3>
          <div className="muted small">
            Each claim with the date submitted, its reference and when payment is expected ({m.rule.value.govtPayDays} days unless the agency says otherwise).
            Follow up at least every {m.rule.value.govtFollowUpDays} days once it is late. Prima finds the payment on the bank statement.
          </div>
        </div>
        {!adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            Add claim
          </button>
        )}
      </div>
      {adding && (
        <div className="row fin-mb">
          <input
            className="input"
            aria-label="Government client"
            placeholder="Ministry, department or agency"
            value={form.agency}
            onChange={(e) => setForm({ ...form, agency: e.target.value })}
          />
          <input
            className="input"
            aria-label="Invoice number"
            placeholder="SQL Account invoice no."
            value={form.invoiceNo}
            onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            aria-label="Claim amount RM"
            placeholder="Amount RM"
            value={form.amount || ''}
            onChange={(e) => setForm({ ...form, amount: Math.max(0, Number(e.target.value) || 0) })}
          />
          <input
            className="input"
            aria-label="Claim reference"
            placeholder="ePerolehan / iGFMAS / letter ref"
            value={form.claimRef}
            onChange={(e) => setForm({ ...form, claimRef: e.target.value })}
          />
          <input
            className="input"
            type="date"
            aria-label="Date submitted"
            value={form.submittedOn}
            onChange={(e) => setForm({ ...form, submittedOn: e.target.value })}
          />
          <Select className="select" aria-label="Contract" value={form.contractId} onChange={(e) => setForm({ ...form, contractId: e.target.value })}>
            <option value="">Contract (optional)…</option>
            {m.contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.client} · {c.ref}
              </option>
            ))}
          </Select>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !form.agency.trim() || !form.invoiceNo.trim() || !form.amount || !form.claimRef.trim() || !form.submittedOn}
            onClick={() =>
              go('govt', 'add', form, 'Claim added.').then((x) => {
                if (x) {
                  setAdding(false);
                  setForm({ agency: '', invoiceNo: '', amount: 0, claimRef: '', submittedOn: '', contractId: '' });
                }
              })
            }
          >
            Save
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {open.length > 0 && (
        <div className="muted small fin-mb">
          {open.length} waiting, {rm(open.reduce((n, c) => n + c.amount, 0))}; {open.filter((c) => c.overdue).length} past the expected date.
        </div>
      )}
      {/* P107: the claims as a table; the follow-up steps sit in each row's menu, their box and the claim's notes under the row. */}
      <DataTable
        label="Government claims"
        stateKey="fin.govt-claims"
        rows={m.govt}
        rowKey={(c) => c.id}
        searchText={(c) => c.log.map((l) => l.text).join(' ')}
        columns={[
          { id: 'agency', label: 'Agency', value: (c) => c.agency, phone: 'title', render: (c) => <span className="fin-strong">{c.agency}</span> },
          { id: 'invoice', label: 'Invoice', value: (c) => c.invoiceNo, phone: 'sub' },
          { id: 'ref', label: 'Reference', value: (c) => c.claimRef, phone: 'hidden', hideBelow: 1200 },
          { id: 'amount', label: 'Amount', value: (c) => c.amount, sort: 'money', render: (c) => rm(c.amount) },
          { id: 'submitted', label: 'Submitted', value: (c) => c.submittedOn, sort: 'date', phone: 'hidden', hideBelow: 1100 },
          { id: 'expected', label: 'Expected by', value: (c) => c.expectedBy, sort: 'date' },
          { id: 'daysOut', label: 'Days out', value: (c) => c.daysOut, sort: 'number' },
          { id: 'status', label: 'Status', value: govtStatus, translate: true, render: (c) => <Chip tone={GOVT_TONE[govtStatus(c)]}>{govtStatus(c)}</Chip> },
        ]}
        filters={[
          { id: 'status', label: 'Status', value: govtStatus },
          { id: 'agency', label: 'Agency', value: (c) => c.agency },
        ]}
        actions={(c) =>
          c.status === 'submitted' || c.status === 'queried'
            ? (['follow', 'query', 'resubmit', 'cancel'] as const).map(
                (k): DtAction => ({
                  label: { follow: 'Followed up', query: 'Agency queried it', resubmit: 'Resubmitted', cancel: 'Cancel' }[k],
                  onClick: () => modes.toggle(c.id, k),
                }),
              )
            : []
        }
        rowDetail={(c) => {
          const open = c.status === 'submitted' || c.status === 'queried';
          const mode = modes.mode(c.id);
          const shows = c.paid || (c.nextOn && open) || c.log.length > 0 || mode || (open && m.unidentified.some((u) => u.suggest.some((s) => s.claimId === c.id)));
          return shows ? <GovtLine c={c} co={co} unidentified={m.unidentified} mode={mode} onDone={() => modes.set(c.id, null)} /> : null;
        }}
        empty={<div className="empty">No government claims recorded.</div>}
      />
    </section>
  );
}

type Govt = MoneyIn['govt'][number];
type GovtMode = 'follow' | 'query' | 'resubmit' | 'cancel';
const govtStatus = (c: Govt) =>
  c.status === 'paid' ? 'Paid' : c.status === 'cancelled' ? 'Cancelled' : c.stale ? 'Late, follow up' : c.overdue ? 'Late' : c.status === 'queried' ? 'Queried' : 'Waiting';
const GOVT_TONE: Record<string, Parameters<typeof Chip>[0]['tone']> = {
  Paid: 'ok',
  Cancelled: 'neutral',
  'Late, follow up': 'crit',
  Late: 'warn',
  Queried: 'warn',
  Waiting: 'neutral',
};

/** Under a claim's row: when it was paid, the next follow-up, the last note, the bank lines that may pay it, and the open step's box. */
function GovtLine({ c, co, unidentified, mode, onDone }: { c: Govt; co: Co; unidentified: MoneyIn['unidentified']; mode: GovtMode | null; onDone: () => void }) {
  const { act, go } = useGo(co.companyId);
  const [text, setText] = useState('');
  const [on, setOn] = useState('');
  const open = c.status === 'submitted' || c.status === 'queried';
  const lines = unidentified.filter((u) => u.suggest.some((s) => s.claimId === c.id));
  const last = c.log[c.log.length - 1];
  return (
    <div className="fin-stack">
      {(c.paid || (c.nextOn && open)) && (
        <div className="muted small">
          {c.paid ? `paid ${dateLabel(c.paid.date)} ${rm(c.paid.amount)} (${c.paid.how === 'auto' ? 'found by Prima' : c.paid.by})` : ''}
          {c.paid && c.nextOn && open ? ' · ' : ''}
          {c.nextOn && open ? `next follow-up ${dateLabel(c.nextOn)}` : ''}
        </div>
      )}
      {last && (
        <div className="muted small">
          Last: {last.text} ({last.by})
        </div>
      )}
      {open && lines.length > 0 && (
        <div className="row">
          {lines.map((u) => (
            <button
              key={u.lineId}
              className="btn btn-sm btn-primary"
              disabled={act.busy}
              onClick={() =>
                go(
                  'govt',
                  'paid',
                  { claimId: c.id, statementId: u.statementId, lineId: u.lineId, comment: `Bank line ${u.date} ${u.description}` },
                  'Linked as paid.',
                )
              }
            >
              Paid: {dateLabel(u.date)} {rm(u.amount)}
            </button>
          ))}
        </div>
      )}
      {mode && (
        <div className="row">
          <input
            className="input fin-flex"
            aria-label="What happened"
            placeholder={
              mode === 'follow'
                ? 'Who you spoke to and what they said'
                : mode === 'query'
                  ? 'What the agency asked to correct'
                  : mode === 'resubmit'
                    ? 'What was corrected'
                    : 'Why cancel'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {(mode === 'follow' || mode === 'query' || mode === 'resubmit') && (
            <input
              className="input"
              type="date"
              aria-label={mode === 'resubmit' ? 'Date resubmitted' : 'Next follow-up'}
              value={on}
              onChange={(e) => setOn(e.target.value)}
            />
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || text.trim().length < 5 || (mode === 'resubmit' && !on)}
            onClick={() =>
              go('govt', mode, { claimId: c.id, comment: text, ...(mode === 'resubmit' ? { submittedOn: on } : on ? { nextOn: on } : {}) }, 'Saved.').then(
                (x) => {
                  if (x) {
                    onDone();
                    setText('');
                    setOn('');
                  }
                },
              )
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Unidentified money in ----------

function Unidentified({ m, co }: { m: MoneyIn; co: Co }) {
  const [allocating, setAllocating] = useState<Record<string, boolean>>({});
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Money in to identify</h3>
          <div className="muted small">
            Money in on the bank statement that Prima could not match. Find who paid and allocate it within {m.rule.value.unidentifiedDays} days, then post it
            in SQL Account. Someone else checks each allocation.
          </div>
        </div>
      </div>
      {/* P107: the money to identify as a table; "Allocate" opens the same box under the row. */}
      <DataTable
        label="Money in to identify"
        stateKey="fin.money-in-unidentified"
        rows={m.unidentified}
        rowKey={(u) => u.lineId}
        columns={[
          { id: 'date', label: 'Date', value: (u) => u.date, sort: 'date' },
          { id: 'amount', label: 'Amount', value: (u) => u.amount, sort: 'money', render: (u) => <span className="fin-strong">{rm(u.amount)}</span> },
          { id: 'description', label: 'Description', value: (u) => u.description, phone: 'title' },
          { id: 'ref', label: 'Reference', value: (u) => u.ref, phone: 'sub', hideBelow: 1100 },
          { id: 'allocateBy', label: 'Allocate by', value: (u) => u.allocateBy, sort: 'date' },
          {
            id: 'days',
            label: 'Days',
            value: (u) => u.days,
            sort: 'number',
            render: (u) => <Chip tone={u.late ? 'crit' : 'warn'}>{u.late ? `${u.days} days, late` : `${u.days} days`}</Chip>,
          },
        ]}
        filters={[
          {
            id: 'late',
            label: 'Status',
            value: (u) => (u.late ? 'late' : 'ontime'),
            options: [
              { value: 'late', label: 'Late' },
              { value: 'ontime', label: 'On time' },
            ],
          },
        ]}
        rowEnd={(u) =>
          allocating[u.lineId] ? null : (
            <button className="btn btn-sm" onClick={() => setAllocating((x) => ({ ...x, [u.lineId]: true }))}>
              Allocate
            </button>
          )
        }
        rowDetail={(u) =>
          allocating[u.lineId] ? (
            <UnidLine u={u} co={co} />
          ) : u.suggest.length > 0 ? (
            <div className="row">
              {u.suggest.map((s) => (
                <span key={s.claimId} className="muted small">
                  Same amount as government claim {s.invoiceNo} ({s.agency}): link it from the claim.
                </span>
              ))}
            </div>
          ) : null
        }
        empty={<div className="empty">Nothing to identify.</div>}
      />
      {m.toCheck.length > 0 && <h4 className="fin-mt">Allocations to check</h4>}
      <div className="list">
        {m.toCheck.map((a) => (
          <AllocCheck key={a.lineId} a={a} co={co} />
        ))}
      </div>
    </section>
  );
}

/** The allocation box for one bank line (under its row once "Allocate" is pressed). */
function UnidLine({ u, co }: { u: MoneyIn['unidentified'][number]; co: Co }) {
  const { act, go } = useGo(co.companyId);
  const [form, setForm] = useState({ to: 'invoice', ref: '', payer: '', note: '' });
  return (
    <div className="fin-stack">
      {(
        <div className="row">
          <select className="select" aria-label="What it is for" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
            <option value="invoice">Customer invoice</option>
            <option value="intercompany">Group company transfer</option>
            <option value="refund">Refund to us</option>
            <option value="other">Something else</option>
          </select>
          <input
            className="input"
            aria-label="Reference"
            placeholder={form.to === 'invoice' ? 'Invoice no(s).' : form.to === 'intercompany' ? 'Company and reference' : 'Reference'}
            value={form.ref}
            onChange={(e) => setForm({ ...form, ref: e.target.value })}
          />
          <input
            className="input"
            aria-label="Who paid"
            placeholder="Who paid"
            value={form.payer}
            onChange={(e) => setForm({ ...form, payer: e.target.value })}
          />
          <input
            className="input"
            aria-label="Note"
            placeholder={form.to === 'other' ? 'What it is (required)' : 'Note (optional)'}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || form.ref.trim().length < 2 || form.payer.trim().length < 2}
            onClick={() => go('moneyin', 'allocate', { statementId: u.statementId, lineId: u.lineId, ...form }, 'Allocated; someone else checks it.')}
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}

function AllocCheck({ a, co }: { a: MoneyIn['toCheck'][number]; co: Co }) {
  const { act, go } = useGo(co.companyId);
  const [text, setText] = useState('');
  const base = { statementId: a.statementId, lineId: a.lineId };
  return (
    <div className="list-item fin-stack">
      <div>
        <div className="fin-strong">
          {rm(a.amount)} · {dateLabel(a.date)} → {a.to} {a.ref}
        </div>
        <div className="muted small">
          {a.description} · paid by {a.payer}
          {a.note ? ` · ${a.note}` : ''} · allocated by {a.by}
        </div>
      </div>
      <div className="row">
        <input
          className="input fin-flex"
          aria-label="Check comment"
          placeholder="What you checked"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !text.trim()}
          onClick={() => go('moneyin', 'check', { ...base, comment: text }, 'Checked.')}
        >
          Agree
        </button>
        <button
          className="btn btn-sm"
          disabled={act.busy || text.trim().length < 5}
          onClick={() => go('moneyin', 'check', { ...base, ok: false, comment: text }, 'Sent back.')}
        >
          Send back
        </button>
      </div>
      <ErrorNotice error={act.error} />
    </div>
  );
}

// ---------- Stamp duty (Fauzan, 2 Nov 2026: suggestion 19, with the refund procedure for cancelled agreements) ----------

type Stamp = MoneyIn['stamp'];
const STAMP_KIND: Record<string, string> = {
  client_contract: 'Client contract',
  tenancy: 'Tenancy',
  loan: 'Loan',
  hire_purchase: 'Hire purchase',
  supplier: 'Supplier agreement',
  other: 'Other',
};

export function StampDuty({ v, co }: { v: FinControls; co: Co }) {
  const s = v.moneyIn.stamp;
  const { act, go } = useGo2(co.companyId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: 'client_contract', contractId: '', title: '', counterparty: '', signedOn: '', value: 0 });
  const open = s.items.filter((x) => x.status !== 'closed');
  const modes = useRowModes<string>();
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Stamp duty</h3>
          <div className="muted small">
            Agreements are stamped in STAMPS within {s.rule.value.stampDays} days of signing. Someone else checks each certificate. If an agreement is
            cancelled, the refund is prepared with at least {s.rule.value.refundMinDocs} documents and submitted by someone else, within{' '}
            {s.rule.value.refundLimitMonths} months of the agreement&apos;s date (Stamp Act s.57). Late stamping costs RM50 or 10% within 3 months, RM100 or 20%
            after (s.47A).
          </div>
        </div>
        {!adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            Add agreement
          </button>
        )}
      </div>
      {s.endedEarly.length > 0 && (
        <div className="notice" data-tone="warn" role="status">
          Ended early with duty paid: {s.endedEarly.map((x) => `${x.contractRef} ${x.client}`).join('; ')}. Record the cancellation to start the refund.
        </div>
      )}
      {adding && (
        <div className="row fin-mb">
          <Select className="select" aria-label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(STAMP_KIND).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          {form.kind === 'client_contract' ? (
            <Select className="select" aria-label="Contract" value={form.contractId} onChange={(e) => setForm({ ...form, contractId: e.target.value })}>
              <option value="">Choose the contract…</option>
              {s.contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client} · {c.ref}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <input
                className="input"
                aria-label="Agreement"
                placeholder="Agreement"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <input
                className="input"
                aria-label="Other party"
                placeholder="Other party"
                value={form.counterparty}
                onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
              />
            </>
          )}
          <input
            className="input"
            type="date"
            aria-label="Date signed"
            value={form.signedOn}
            onChange={(e) => setForm({ ...form, signedOn: e.target.value })}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            aria-label="Value RM"
            placeholder="Value RM (optional)"
            value={form.value || ''}
            onChange={(e) => setForm({ ...form, value: Math.max(0, Number(e.target.value) || 0) })}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !form.signedOn || (form.kind === 'client_contract' ? !form.contractId : !form.title.trim() || !form.counterparty.trim())}
            onClick={() =>
              go('stamp', 'add', { ...form, contractId: form.kind === 'client_contract' ? form.contractId : null, value: form.value || null }, 'Added.').then(
                (x) => x && setAdding(false),
              )
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      {s.notListed.length > 0 && <div className="muted small">Contracts signed lately and not on this list: {s.notListed.map((c) => c.ref).join(', ')}.</div>}
      {open.length === 0 && s.items.length > 0 && <div className="empty">Nothing to stamp or refund.</div>}
      {/* P107: the agreements as a table; the stamping and refund steps sit in each row's menu, their box under the row. */}
      <DataTable
        label="Stamp duty"
        stateKey="fin.stamp"
        rows={s.items}
        rowKey={(it) => it.id}
        searchText={(it) => `${it.refund?.reason ?? ''} ${it.state.what ?? ''}`}
        columns={[
          { id: 'title', label: 'Agreement', value: (it) => it.title, phone: 'title', render: (it) => <span className="fin-strong">{it.title}</span> },
          { id: 'kind', label: 'Type', value: (it) => STAMP_KIND[it.kind] ?? it.kind, translate: true, phone: 'sub' },
          { id: 'signed', label: 'Date signed', value: (it) => it.signedOn, sort: 'date' },
          { id: 'value', label: 'Value', value: (it) => it.value, sort: 'money', render: (it) => (it.value != null ? rm(it.value) : '–') },
          {
            id: 'cert',
            label: 'Certificate',
            value: (it) => it.stamped?.certNo ?? '',
            render: (it) =>
              it.stamped ? (
                <span className="small">
                  {`${it.stamped.certNo} ${dateLabel(it.stamped.on)} duty ${rm(it.stamped.duty)}${it.stamped.penalty ? ` + penalty ${rm(it.stamped.penalty)}` : ''}${it.stamped.checked ? `, checked by ${it.stamped.checked.by}` : ''}`}
                </span>
              ) : (
                '–'
              ),
          },
          {
            id: 'status',
            label: 'Status',
            value: (it) => it.status.replace('_', ' '),
            translate: true,
            render: (it) => (
              <Chip tone={it.state.late ? 'crit' : it.state.due ? 'warn' : it.status === 'closed' ? 'neutral' : 'ok'}>{it.status.replace('_', ' ')}</Chip>
            ),
          },
        ]}
        filters={[
          { id: 'kind', label: 'Type', value: (it) => it.kind, optionLabel: (k) => STAMP_KIND[k] ?? k },
          { id: 'status', label: 'Status', value: (it) => it.status.replace('_', ' ') },
        ]}
        actions={(it) => {
          const r = it.refund;
          const step = (k: string, label: string, show: boolean): DtAction => ({ label, hidden: !show, onClick: () => modes.toggle(it.id, k) });
          return [
            step('stamped', 'Record certificate', it.status === 'to_stamp'),
            step('check', 'Check certificate', it.status === 'stamped' && !!it.stamped && !it.stamped.checked),
            step('cancelled', 'Agreement cancelled', it.status === 'to_stamp' || it.status === 'stamped'),
            step('docs', 'Refund documents', it.status === 'refund_open'),
            step('submit', 'Submitted to LHDN', it.status === 'refund_open' && !!r && r.docs.length > 0),
            step('outcome', 'LHDN answered', it.status === 'refund_submitted'),
          ];
        }}
        rowDetail={(it) => {
          const mode = modes.mode(it.id);
          return it.refund || it.state.what || mode ? <StampLine it={it} co={co} mode={mode} onDone={() => modes.set(it.id, null)} /> : null;
        }}
        empty={<div className="empty">Nothing to stamp or refund.</div>}
      />
    </section>
  );
}

function useGo2(companyId: string) {
  const act = useAction();
  const go = (area: 'stamp', action: string, input: Record<string, unknown>, msg: string) =>
    act.run(() => api.finControlAction(companyId, area, action, input), msg);
  return { act, go };
}

/** Under an agreement's row: the refund so far, what is due next, and the open step's box. */
function StampLine({ it, co, mode, onDone }: { it: Stamp['items'][number]; co: Co; mode: string | null; onDone: () => void }) {
  const { act, go } = useGo2(co.companyId);
  const [f, setF] = useState({ certNo: '', on: '', duty: 0, penalty: 0, comment: '', ref: '', amount: 0, docs: '', result: 'approved' });
  const base = { stampId: it.id };
  const r = it.refund;
  const step = (action: string, extra: Record<string, unknown>, msg: string) => go('stamp', action, { ...base, ...extra }, msg).then((x) => x && onDone());
  return (
    <div className="fin-stack">
      {r && (
        <div className="muted small">
          {`cancelled ${dateLabel(r.cancelledOn)}: ${r.reason}`}
          {r.submitted ? ` · submitted ${dateLabel(r.submitted.on)} (${r.submitted.ref})` : ''}
          {r.outcome ? ` · LHDN ${r.outcome.result} ${r.outcome.result === 'approved' ? rm(r.outcome.amount) : ''}` : ''}
        </div>
      )}
      {it.state.what && <div className="small">{it.state.what}</div>}
      {mode === 'stamped' && (
        <div className="row">
          <input
            className="input"
            aria-label="Certificate number"
            placeholder="STAMPS certificate no."
            value={f.certNo}
            onChange={(e) => setF({ ...f, certNo: e.target.value })}
          />
          <input className="input" type="date" aria-label="Date stamped" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
          <input
            className="input"
            type="number"
            step="0.01"
            aria-label="Duty RM"
            placeholder="Duty RM"
            value={f.duty || ''}
            onChange={(e) => setF({ ...f, duty: Number(e.target.value) || 0 })}
          />
          <input
            className="input"
            type="number"
            step="0.01"
            aria-label="Penalty RM"
            placeholder="Late penalty RM"
            value={f.penalty || ''}
            onChange={(e) => setF({ ...f, penalty: Number(e.target.value) || 0 })}
          />
          {f.on && f.on > it.stampBy && (
            <span className="muted small">Late: the law's penalty is {rm(finStampPenalty(f.duty, it.stampBy, f.on))} (s.47A).</span>
          )}
          {f.on && Math.abs(f.penalty - finStampPenalty(f.duty, it.stampBy, f.on)) >= 0.005 && (
            <input
              className="input"
              aria-label="Why the penalty is different"
              placeholder="Why the penalty is different (e.g. LHDN remitted it)"
              value={f.comment}
              onChange={(e) => setF({ ...f, comment: e.target.value })}
            />
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !f.certNo.trim() || !f.on}
            onClick={() =>
              step('stamped', { certNo: f.certNo, on: f.on, duty: f.duty, penalty: f.penalty, comment: f.comment }, 'Recorded; someone else checks it.')
            }
          >
            Save
          </button>
        </div>
      )}
      {(mode === 'check' || mode === 'cancelled' || mode === 'outcome' || mode === 'submit') && (
        <div className="row">
          {(mode === 'cancelled' || mode === 'submit' || mode === 'outcome') && (
            <input className="input" type="date" aria-label="Date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
          )}
          {mode === 'submit' && (
            <input
              className="input"
              aria-label="LHDN reference"
              placeholder="LHDN reference"
              value={f.ref}
              onChange={(e) => setF({ ...f, ref: e.target.value })}
            />
          )}
          {mode === 'outcome' && (
            <>
              <select className="select" aria-label="Result" value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}>
                <option value="approved">Approved</option>
                <option value="refused">Refused</option>
              </select>
              {f.result === 'approved' && (
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  aria-label="Amount approved RM"
                  placeholder="Amount RM"
                  value={f.amount || ''}
                  onChange={(e) => setF({ ...f, amount: Number(e.target.value) || 0 })}
                />
              )}
            </>
          )}
          {mode !== 'submit' && (
            <input
              className="input fin-flex"
              aria-label="Comment"
              placeholder={mode === 'cancelled' ? 'Why it was cancelled' : 'Comment'}
              value={f.comment}
              onChange={(e) => setF({ ...f, comment: e.target.value })}
            />
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={() =>
              mode === 'check'
                ? step('check', { comment: f.comment }, 'Checked.')
                : mode === 'cancelled'
                  ? step('cancelled', { cancelledOn: f.on, comment: f.comment }, 'Recorded.')
                  : mode === 'submit'
                    ? step('submit', { on: f.on, ref: f.ref }, 'Recorded.')
                    : step('outcome', { on: f.on, result: f.result, amount: f.amount, comment: f.comment }, 'Recorded.')
            }
          >
            Save
          </button>
          {mode === 'check' && (
            <button
              className="btn btn-sm"
              disabled={act.busy || f.comment.trim().length < 5}
              onClick={() => step('check', { ok: false, comment: f.comment }, 'Sent back.')}
            >
              Send back
            </button>
          )}
        </div>
      )}
      {mode === 'docs' && (
        <div className="row">
          <textarea
            className="input fin-flex"
            rows={3}
            aria-label="Documents, one per line"
            placeholder="One document per line"
            value={f.docs}
            onChange={(e) => setF({ ...f, docs: e.target.value })}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={() =>
              step(
                'docs',
                {
                  docs: f.docs
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
                'Documents listed; someone else submits.',
              )
            }
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
