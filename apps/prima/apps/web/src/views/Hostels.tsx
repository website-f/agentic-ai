import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type HostelBillInput, type HostelBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { RecordButton } from './RecordForm';

/**
 * Hostel bills and utility excess (Fauzan, 26 Oct 2026). Each bill belongs to the company that owns or rents the
 * hostel: the company asks for payment approval, FWM checks it, the Operations Director (private) or OGM (government)
 * approves, then the COO; the company pays and uploads the slip, and FWM keeps it all by hostel and month.
 * Electricity and water above RM30 and RM20 a head are shared by bed-days; HR decides a notice or a deduction.
 */

type HostelRow = HostelBoard['hostels'][number];
type BillRow = HostelRow['bills'][number];
type ChargeRow = HostelBoard['charges'][number];

const KIND_LABEL = { RENT: 'Rent', ELECTRICITY: 'Electricity', WATER: 'Water', MAINTENANCE: 'Maintenance' } as const;
const rm = (n: number) => `RM${n.toFixed(2)}`;

function billTone(b: BillRow): Tone {
  if (b.bill.status === 'paid') return 'ok';
  if (b.daysToDue < 0 || b.bill.status === 'returned') return 'crit';
  return b.remind ? 'warn' : 'neutral';
}

export function HostelsView() {
  const { data, error } = useLoad(() => api.hostelBoard(), []);
  const [tab, setTab] = useState<'bills' | 'utility' | null>(null);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="hostels" />;
  const view = tab ?? (data.role === 'hr' ? 'utility' : 'bills');
  const bills = data.hostels.flatMap((h) => h.bills);
  const mine = bills.filter((b) => Object.values(b.can).some(Boolean));
  const overdue = bills.filter((b) => b.bill.status !== 'paid' && b.daysToDue < 0);
  const undecided = data.charges.filter((c) => !c.charge.decision);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Hostels</h1>
        <p className="muted">
          Each hostel bill belongs to the company that owns or rents the hostel. The company asks for approval, FWM checks it, the Operations Director or OGM
          approves, then the COO. The company pays from its own bank; when Finance records the payment (account, day, reference) it shows here as paid at once,
          with no slip needed. Otherwise the company uploads the slip. Once Finance loads the bank statement, the bill shows where the money was seen leaving.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Waiting for you" value={mine.length} tone={mine.length ? 'warn' : 'ok'} />
        <Kpi label="Overdue" value={overdue.length} tone={overdue.length ? 'crit' : 'ok'} note="Climbs to CoS, COO, CEO" />
        {data.charges.length > 0 && <Kpi label="Utility excess to decide" value={undecided.length} tone={undecided.length ? 'warn' : 'ok'} note="HR decides" />}
      </div>
      <div className="tabbar" role="tablist" aria-label="Hostel sections">
        <button role="tab" aria-selected={view === 'bills'} onClick={() => setTab('bills')}>
          Bills
          {mine.length > 0 && <span className="tab-count">{mine.length}</span>}
        </button>
        {data.charges.length > 0 && (
          <button role="tab" aria-selected={view === 'utility'} onClick={() => setTab('utility')}>
            Utility excess
            {undecided.length > 0 && <span className="tab-count">{undecided.length}</span>}
          </button>
        )}
      </div>
      {view === 'bills' && (
        <>
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
            <RecordButton kind="hostel" label="Add hostel" />
          </div>
          {data.hostels.length === 0 && <div className="empty">No hostel on record.</div>}
          {data.hostels.map((h) => (
            <HostelPanel key={h.hostel.id} h={h} canAdd={data.canAddBill} />
          ))}
        </>
      )}
      {view === 'utility' && <UtilityPanel rows={data.charges} rule={data.rules.utility.source} />}
    </div>
  );
}

function HostelPanel({ h, canAdd }: { h: HostelRow; canAdd: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>{h.hostel.name}</h3>
          <div className="muted small">
            {h.companyName} · {h.hostel.tenure === 'RENTED' ? 'rented' : 'owned'} · {h.residents} of {h.hostel.beds} beds · {h.hostel.sector} sector
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <RecordButton kind="hostel" id={h.hostel.id} label="Edit hostel" />
          {canAdd && !adding && (
            <button className="btn btn-sm" onClick={() => setAdding(true)}>
              Add a bill
            </button>
          )}
        </div>
      </div>
      {/* Payment history by month: an unpaid or unproven month is red. */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }} aria-label="Payment history by month">
        {h.history.map((m) => (
          <Chip key={m.month} tone={m.red ? 'crit' : m.bills === 0 ? 'neutral' : m.paid === m.bills ? 'ok' : 'warn'}>
            {m.month}: {m.bills ? `${m.paid}/${m.bills} paid` : 'no bill'}
          </Chip>
        ))}
      </div>
      {adding && <AddBill hostelId={h.hostel.id} onDone={() => setAdding(false)} />}
      <div className="list">
        {h.bills.length === 0 && <div className="empty">No bills yet.</div>}
        {h.bills.map((b) => (
          <BillItem key={b.bill.id} b={b} />
        ))}
      </div>
    </section>
  );
}

function BillItem({ b }: { b: BillRow }) {
  const [note, setNote] = useState('');
  const [slip, setSlip] = useState<ProofInput[]>([]);
  const [open, setOpen] = useState(false);
  const act = useAction();
  const bill = b.bill;
  const can = b.can.request || b.can.check || b.can.approve || b.can.slip;
  const steps = [
    ['Asked for approval', bill.request],
    ['FWM checked', bill.fwmCheck],
    ['Operations Director / OGM', bill.sectorApproval],
    ['COO', bill.cooApproval],
    ['Payment slip', bill.financePaid && !bill.slip ? { by: `not needed, Finance recorded the payment`, at: bill.financePaid.at, note: '' } : bill.slip],
  ] as const;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {KIND_LABEL[bill.kind]} {bill.period} · {rm(bill.amount)}
          </div>
          <div className="muted small">
            Due {dateLabel(bill.dueOn)}
            {bill.status !== 'paid' && (b.daysToDue < 0 ? ` · ${-b.daysToDue} days overdue` : ` · in ${b.daysToDue} days`)}
            {b.escalatedTo ? ` · reached the ${b.escalatedTo}` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Chip tone={billTone(b)}>{b.waitingOn}</Chip>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
            {open ? 'Hide' : can ? 'Act' : 'Steps'}
          </button>
        </div>
      </div>
      {(bill.financePaid || bill.bankSeen) && (
        <div className="small">
          {bill.financePaid && (
            <>
              Paid by Finance: {rm(bill.financePaid.amount)} from {bill.financePaid.bank} on {dateLabel(bill.financePaid.on)}, ref {bill.financePaid.ref}{' '}
              (recorded by {bill.financePaid.by}).{' '}
            </>
          )}
          {bill.bankSeen && (
            <span>
              Seen leaving {bill.bankSeen.bank} on the bank statement, {dateLabel(bill.bankSeen.date)}.
            </span>
          )}
        </div>
      )}
      {bill.returned && bill.status === 'returned' && (
        <div className="small">
          Sent back by {bill.returned.by}: {bill.returned.note}
        </div>
      )}
      {open && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {steps.map(([label, s]) => (
              <li key={label}>
                {label}: {s ? `${s.by}, ${dateTimeLabel(s.at)}${s.note ? ` · ${s.note}` : ''}` : <span className="muted">not yet</span>}
              </li>
            ))}
          </ul>
          {can && (
            <>
              {b.can.slip && <ProofPicker site={null} refText="Slip" items={slip} onChange={setSlip} documentsOnly required />}
              <input
                className="input"
                aria-label="Note"
                placeholder={b.can.check || b.can.approve ? 'Note (required to send back)' : 'Note (optional)'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <ErrorNotice error={act.error} />
              <div className="row" style={{ gap: 6 }}>
                {b.can.request && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={act.busy}
                    onClick={() => act.run(() => api.hostelBillStep(bill.id, 'request', true, note), 'Sent to FWM.')}
                  >
                    Ask for payment approval
                  </button>
                )}
                {(b.can.check || b.can.approve) && (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={act.busy}
                      onClick={() =>
                        act.run(
                          () => api.hostelBillStep(bill.id, b.can.check ? 'check' : 'approve', true, note),
                          b.can.check ? 'Checked, passed on.' : 'Approved.',
                        )
                      }
                    >
                      {b.can.check ? 'Checked, pass on' : 'Approve'}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={act.busy || note.trim().length < 3}
                      onClick={() => act.run(() => api.hostelBillStep(bill.id, b.can.check ? 'check' : 'approve', false, note), 'Sent back to the company.')}
                    >
                      Send back
                    </button>
                  </>
                )}
                {b.can.slip && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={act.busy || !slip.length}
                    onClick={() => act.run(() => api.hostelBillStep(bill.id, 'slip', true, note, slip), 'Slip on file. The bill is closed.')}
                  >
                    Upload the payment slip
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AddBill({ hostelId, onDone }: { hostelId: string; onDone: () => void }) {
  const [input, setInput] = useState<HostelBillInput>({ hostelId, kind: 'ELECTRICITY', period: '', amount: 0, dueOn: '' });
  const [doc, setDoc] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select
          className="select"
          aria-label="Kind"
          value={input.kind}
          onChange={(e) => setInput({ ...input, kind: e.target.value as HostelBillInput['kind'] })}
        >
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input className="input" type="month" aria-label="Month billed" value={input.period} onChange={(e) => setInput({ ...input, period: e.target.value })} />
        <input
          className="input"
          type="number"
          min={0}
          step="0.01"
          aria-label="Amount RM"
          placeholder="Amount RM"
          value={input.amount || ''}
          onChange={(e) => setInput({ ...input, amount: Number(e.target.value) })}
        />
        <input className="input" type="date" aria-label="Due date" value={input.dueOn} onChange={(e) => setInput({ ...input, dueOn: e.target.value })} />
      </div>
      <ProofPicker site={null} refText="Bill" items={doc} onChange={setDoc} documentsOnly required />
      {(input.kind === 'ELECTRICITY' || input.kind === 'WATER') && (
        <p className="muted small">The app works out the amount above the allowance and each resident's share by bed-days.</p>
      )}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !input.period || !input.amount || !input.dueOn || !doc.length}
          onClick={async () => {
            if (await act.run(() => api.addHostelBill(input, doc), 'Bill added.')) onDone();
          }}
        >
          Save the bill
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function UtilityPanel({ rows, rule }: { rows: ChargeRow[]; rule: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Utility excess per worker</h3>
          <div className="muted small">
            Above RM30 electricity and RM20 water a head a month, shared by bed-days. The 1st and 2nd time are a notice; from the 3rd HR may choose a deduction,
            only when the contract has the utility clause. The count never resets.
          </div>
        </div>
      </div>
      <div className="list">
        {rows.length === 0 && <div className="empty">No utility excess.</div>}
        {rows.map((r) => (
          <ChargeItem key={r.charge.id} r={r} />
        ))}
      </div>
      <p className="muted small">{rule}</p>
    </section>
  );
}

function ChargeItem({ r }: { r: ChargeRow }) {
  const [note, setNote] = useState('');
  const [filing, setFiling] = useState<'clause' | 'ack' | null>(null);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const c = r.charge;
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {c.personName} · {rm(c.share)}
          </div>
          <div className="muted small">
            {c.kind === 'ELECTRICITY' ? 'Electricity' : 'Water'} {c.period} at {r.hostelName}: {rm(c.excess)} above the allowance × {c.bedDays} of{' '}
            {c.totalBedDays} bed-days · excess number {c.count} · contract clause {r.clause ? 'on file' : 'missing'}
          </div>
        </div>
        <Chip tone={c.decision === 'DEDUCTION' ? 'warn' : c.decision === 'NOTICE' ? 'info' : 'unknown'}>
          {c.decision === 'DEDUCTION'
            ? `Deduction, payroll ${c.payrollMonth}`
            : c.decision === 'NOTICE'
              ? c.noticeAck
                ? 'Notice signed'
                : 'Notice given'
              : 'HR to decide'}
        </Chip>
      </div>
      {(r.canDecide || r.canAck) && (
        <>
          {r.canDecide && <input className="input" aria-label="HR note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {r.canDecide && (
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() => act.run(() => api.decideUtilityCharge(c.id, 'NOTICE', note), 'Notice recorded.')}
              >
                Give a notice
              </button>
            )}
            {r.canDecide && (
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !r.deductionAllowed}
                title={r.deductionAllowed ? '' : c.count <= 2 ? 'Notices only for the 1st and 2nd time' : 'No utility clause in the contract'}
                onClick={() => act.run(() => api.decideUtilityCharge(c.id, 'DEDUCTION', note), 'Deduction goes to this month’s payroll.')}
              >
                Deduct from pay
              </button>
            )}
            {r.canAck && (
              <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.ackUtilityNotice(c.id), 'Signed notice recorded.')}>
                Worker signed the notice
              </button>
            )}
          </div>
          {r.canDecide && !r.deductionAllowed && (
            <div className="muted small">
              {c.count <= 2 ? 'Notice only: this is the 1st or 2nd time.' : 'Notice only: the contract has no utility clause yet. FWM gets a task to add it.'}
            </div>
          )}
        </>
      )}
      {r.canFilePapers && (!r.clause || !r.ack) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {!r.clause && (
              <button className="btn btn-sm" aria-pressed={filing === 'clause'} onClick={() => setFiling(filing === 'clause' ? null : 'clause')}>
                File the signed contract clause
              </button>
            )}
            {!r.ack && (
              <button className="btn btn-sm" aria-pressed={filing === 'ack'} onClick={() => setFiling(filing === 'ack' ? null : 'ack')}>
                File the worker's signed acknowledgement
              </button>
            )}
          </div>
          {filing && (
            <>
              <ProofPicker site={null} refText={c.personName.slice(0, 20)} items={proof} onChange={setProof} documentsOnly required />
              <button
                className="btn btn-primary btn-sm"
                disabled={act.busy || !proof.length}
                onClick={async () => {
                  const ok = await act.run(
                    () => api.fileUtilityPaper(c.personId, filing, proof),
                    filing === 'clause' ? 'Contract clause filed.' : 'Signed acknowledgement filed.',
                  );
                  if (ok) {
                    setFiling(null);
                    setProof([]);
                  }
                }}
              >
                Save
              </button>
              <ErrorNotice error={act.error} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
