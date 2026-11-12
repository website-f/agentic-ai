import { Select } from '../SearchSelect';
import { useState } from 'react';
import { ClockCountdownIcon, LightningIcon, TrayIcon } from '@phosphor-icons/react';
import type { ProofInput } from '@prima/core';
import { api, type HostelBillInput, type HostelBoard } from '../api';
import { Card, Empty, PageHead, Search, Stat, Stats, Steps, Toolbar, type StepState } from '../kit';
import { Chip, ErrorNotice, Loading, dateLabel, dateTimeLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { RecordButton } from './RecordForm';
import { NoAddNote } from './FwmAdd';
import { ImportButton } from './ImportDrawer';
import '../styles/hrx.css';
import { HostelStaysPanel } from './FwExtras';

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
  const [tab, setTab] = useState<'bills' | 'utility' | 'stays' | null>(null);
  const [q, setQ] = useState('');
  if (error)
    return (
      <div className="page">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data)
    return (
      <div className="page">
        <Loading what="hostels" />
      </div>
    );
  const view = tab ?? (data.role === 'hr' ? 'utility' : 'bills');
  const bills = data.hostels.flatMap((h) => h.bills);
  const mine = bills.filter((b) => Object.values(b.can).some(Boolean));
  const overdue = bills.filter((b) => b.bill.status !== 'paid' && b.daysToDue < 0);
  const undecided = data.charges.filter((c) => !c.charge.decision);
  const needle = q.trim().toLowerCase();
  const hostels = data.hostels.filter((h) => !needle || [h.hostel.name, h.companyName].some((v) => v.toLowerCase().includes(needle)));
  return (
    <div className="page">
      <PageHead
        title="Hostels"
        sub="Each hostel bill belongs to the company that owns or rents the hostel. The company asks for approval, FWM checks it, the Operations Director or OGM approves, then the COO."
        actions={
          <>
            <ImportButton kind="hostel" />
            <RecordButton kind="hostel" label="Add hostel" primary />
            {/* P93: where the Add button would be, say who adds hostels instead of leaving a silent gap. */}
            {!data.canAddBill && <NoAddNote>Hostels and their bills are added by the company office or FWM.</NoAddNote>}
          </>
        }
      />
      <Stats>
        <Stat label="Waiting for you" value={mine.length} tone={mine.length ? 'warn' : 'ok'} icon={<TrayIcon size={16} />} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'crit' : 'ok'} note="Climbs to CoS, COO, CEO" icon={<ClockCountdownIcon size={16} />} />
        {data.charges.length > 0 && (
          <Stat
            label="Utility excess to decide"
            value={undecided.length}
            tone={undecided.length ? 'warn' : 'ok'}
            note="HR decides"
            icon={<LightningIcon size={16} />}
          />
        )}
      </Stats>
      <div className="tabbar hx-tabs" role="tablist" aria-label="Hostel sections">
        <button role="tab" aria-selected={view === 'bills'} onClick={() => setTab('bills')}>
          Bills
          {mine.length > 0 && <span className="tab-count">{mine.length}</span>}
        </button>
        {/* P100 (E8): who lives in each hostel, check-in and the check-out memo. */}
        <button role="tab" aria-selected={view === 'stays'} onClick={() => setTab('stays')}>
          Who lives here
        </button>
        {data.charges.length > 0 && (
          <button role="tab" aria-selected={view === 'utility'} onClick={() => setTab('utility')}>
            Utility excess
            {undecided.length > 0 && <span className="tab-count">{undecided.length}</span>}
          </button>
        )}
      </div>
      {view === 'bills' && (
        <div className="hx-stack">
          {data.hostels.length > 1 && (
            <Toolbar>
              <Search value={q} onChange={setQ} placeholder="Search hostel or company" label="Search hostels" />
            </Toolbar>
          )}
          {data.hostels.length === 0 && (
            <Card>
              <Empty title="No hostel on record.">
                {data.canAddBill
                  ? 'Add the hostel first (Add hostel, above); its rent and utility bills are then entered on it.'
                  : 'The company office or FWM adds the hostel first; its rent and utility bills are then entered on it.'}
              </Empty>
            </Card>
          )}
          {data.hostels.length > 0 && hostels.length === 0 && (
            <Card>
              <Empty title="No hostel matches the search." />
            </Card>
          )}
          {hostels.map((h) => (
            <HostelPanel key={h.hostel.id} h={h} canAdd={data.canAddBill} />
          ))}
          <p className="hx-source">
            The company pays from its own bank; when Finance records the payment (account, day, reference) it shows here as paid at once, with no slip needed.
            Otherwise the company uploads the slip. Once Finance loads the bank statement, the bill shows where the money was seen leaving.
          </p>
        </div>
      )}
      {view === 'utility' && <UtilityPanel rows={data.charges} rule={data.rules.utility.source} />}
      {view === 'stays' && <HostelStaysPanel />}
    </div>
  );
}

function HostelPanel({ h, canAdd }: { h: HostelRow; canAdd: boolean }) {
  const [adding, setAdding] = useState(false);
  const full = h.hostel.beds > 0 ? Math.min(100, Math.round((h.residents / h.hostel.beds) * 100)) : 0;
  return (
    <Card
      title={h.hostel.name}
      sub={`${h.companyName} · ${h.hostel.tenure === 'RENTED' ? 'rented' : 'owned'} · ${h.hostel.sector} sector`}
      actions={
        <>
          <RecordButton kind="hostel" id={h.hostel.id} label="Edit hostel" />
          {canAdd && !adding && (
            <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
              Add a bill
            </button>
          )}
        </>
      }
      flush
    >
      <div className="hs-top">
        <div className="hs-beds">
          <span className="hs-beds-text">
            <b>{h.residents}</b> of {h.hostel.beds} beds
          </span>
          <span className="hs-meter" aria-hidden="true">
            <span style={{ width: `${full}%` }} />
          </span>
        </div>
        {/* Payment history by month: an unpaid or unproven month is red. */}
        <div className="hs-months" aria-label="Payment history by month">
          {h.history.map((m) => (
            <Chip key={m.month} tone={m.red ? 'crit' : m.bills === 0 ? 'neutral' : m.paid === m.bills ? 'ok' : 'warn'}>
              {m.month}: {m.bills ? `${m.paid}/${m.bills} paid` : 'no bill'}
            </Chip>
          ))}
        </div>
      </div>
      {adding && (
        <div className="hs-add">
          <AddBill hostelId={h.hostel.id} onDone={() => setAdding(false)} />
        </div>
      )}
      {h.bills.length === 0 ? (
        <div className="empty">No bills yet.</div>
      ) : (
        <ul className="hx-rows hs-bills">
          {h.bills.map((b) => (
            <li key={b.bill.id}>
              <BillItem b={b} />
            </li>
          ))}
        </ul>
      )}
    </Card>
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
  const firstOpen = steps.findIndex(([, s]) => !s);
  const tone = billTone(b);
  return (
    <div className="hx-row" data-tone={tone === 'crit' || tone === 'warn' ? tone : undefined}>
      <div className="hx-row-main">
        <span className="hx-row-title">
          {KIND_LABEL[bill.kind]} {bill.period} · {rm(bill.amount)}
        </span>
        <span className="hx-row-meta">
          Due {dateLabel(bill.dueOn)}
          {bill.status !== 'paid' && (b.daysToDue < 0 ? ` · ${-b.daysToDue} days overdue` : ` · in ${b.daysToDue} days`)}
          {b.escalatedTo ? ` · reached the ${b.escalatedTo}` : ''}
        </span>
      </div>
      <div className="hx-row-side">
        <Chip tone={tone}>{b.waitingOn}</Chip>
        <button className={`btn btn-sm${can && !open ? '' : ' btn-ghost'}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : can ? 'Act' : 'Steps'}
        </button>
      </div>
      <div className="hx-row-body">
        {(bill.financePaid || bill.bankSeen) && (
          <p className="hx-row-text">
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
          </p>
        )}
        {bill.returned && bill.status === 'returned' && (
          <p className="notice" data-tone="crit">
            Sent back by {bill.returned.by}: {bill.returned.note}
          </p>
        )}
        {open && (
          <>
            <div className="hs-steps">
              <Steps
                steps={steps.map(([label, s], i) => ({
                  label,
                  state: (s ? 'done' : i === firstOpen ? (bill.status === 'returned' ? 'stopped' : 'now') : 'todo') as StepState,
                  note: s ? `${s.by}, ${dateTimeLabel(s.at)}${s.note ? ` · ${s.note}` : ''}` : 'not yet',
                }))}
              />
            </div>
            {can && (
              <div className="hx-form">
                {b.can.slip && <ProofPicker site={null} refText="Slip" items={slip} onChange={setSlip} documentsOnly required />}
                <label className="field">
                  <span className="label">Note</span>
                  <input
                    className="input"
                    aria-label="Note"
                    placeholder={b.can.check || b.can.approve ? 'Comment (needed to check, approve or send back)' : 'Note (optional)'}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <ErrorNotice error={act.error} />
                <div className="hx-form-actions">
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
                        disabled={act.busy || !note.trim()}
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
                        onClick={() =>
                          act.run(() => api.hostelBillStep(bill.id, b.can.check ? 'check' : 'approve', false, note), 'Sent back to the company.')
                        }
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AddBill({ hostelId, onDone }: { hostelId: string; onDone: () => void }) {
  const [input, setInput] = useState<HostelBillInput>({ hostelId, kind: 'ELECTRICITY', period: '', amount: 0, dueOn: '' });
  const [doc, setDoc] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="hx-form">
      <h4 className="hx-form-title">New bill</h4>
      <div className="hx-form-grid">
        <label className="field">
          <span className="label">Kind</span>
          <Select
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
          </Select>
        </label>
        <label className="field">
          <span className="label">Month billed</span>
          <input className="input" type="month" aria-label="Month billed" value={input.period} onChange={(e) => setInput({ ...input, period: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Amount (RM)</span>
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
        </label>
        <label className="field">
          <span className="label">Due date</span>
          <input className="input" type="date" aria-label="Due date" value={input.dueOn} onChange={(e) => setInput({ ...input, dueOn: e.target.value })} />
        </label>
      </div>
      <ProofPicker site={null} refText="Bill" items={doc} onChange={setDoc} documentsOnly required />
      {(input.kind === 'ELECTRICITY' || input.kind === 'WATER') && (
        <p className="muted small">The app works out the amount above the allowance and each resident's share by bed-days.</p>
      )}
      <ErrorNotice error={act.error} />
      <div className="hx-form-actions">
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
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'decide'>('all');
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) => (only === 'all' || !r.charge.decision) && (!needle || [r.charge.personName, r.hostelName, r.charge.period].some((v) => v.toLowerCase().includes(needle))),
  );
  return (
    <div className="hx-stack-tight">
      {rows.length > 0 && (
        <Toolbar
          end={
            <div className="seg" role="group" aria-label="Which charges">
              <button aria-pressed={only === 'all'} onClick={() => setOnly('all')}>
                All
              </button>
              <button aria-pressed={only === 'decide'} onClick={() => setOnly('decide')}>
                HR to decide
              </button>
            </div>
          }
        >
          <Search value={q} onChange={setQ} placeholder="Search worker, hostel or month" label="Search utility excess" />
        </Toolbar>
      )}
      <UtilityList rows={rows} shown={shown} rule={rule} />
    </div>
  );
}

function UtilityList({ rows, shown, rule }: { rows: ChargeRow[]; shown: ChargeRow[]; rule: string }) {
  return (
    <Card
      title="Utility excess per worker"
      sub="Above RM30 electricity and RM20 water a head a month, shared by bed-days. The 1st and 2nd time are a notice; from the 3rd HR may choose a deduction, only when the contract has the utility clause. The count never resets."
      actions={rows.length > 0 ? <span className="hx-count">{shown.length === rows.length ? `${rows.length} charge${rows.length === 1 ? '' : 's'}` : `${shown.length} of ${rows.length}`}</span> : undefined}
      footer={<p className="hx-source hs-foot">{rule}</p>}
      flush
    >
      {rows.length === 0 ? (
        <Empty title="No utility excess." />
      ) : shown.length === 0 ? (
        <Empty title="Nothing matches." />
      ) : (
        <ul className="hx-rows">
          {shown.map((r) => (
            <li key={r.charge.id}>
              <ChargeItem r={r} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ChargeItem({ r }: { r: ChargeRow }) {
  const [note, setNote] = useState('');
  const [filing, setFiling] = useState<'clause' | 'ack' | null>(null);
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const c = r.charge;
  return (
    <div className="hx-row" data-tone={c.decision ? undefined : 'unknown'}>
      <div className="hx-row-main">
        <span className="hx-row-title">
          {c.personName} · {rm(c.share)}
        </span>
        <span className="hx-row-meta">
          {c.kind === 'ELECTRICITY' ? 'Electricity' : 'Water'} {c.period} at {r.hostelName}: {rm(c.excess)} above the allowance × {c.bedDays} of{' '}
          {c.totalBedDays} bed-days · excess number {c.count} · contract clause {r.clause ? 'on file' : 'missing'}
        </span>
      </div>
      <div className="hx-row-side">
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
      <div className="hx-row-body">
        {(r.canDecide || r.canAck) && (
          <>
            {r.canDecide && (
              <input className="input hs-note" aria-label="HR note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            )}
            <ErrorNotice error={act.error} />
            <div className="hx-row-actions">
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
              <span className="muted small">
                {c.count <= 2 ? 'Notice only: this is the 1st or 2nd time.' : 'Notice only: the contract has no utility clause yet. FWM gets a task to add it.'}
              </span>
            )}
          </>
        )}
        {r.canFilePapers && (!r.clause || !r.ack) && (
          <>
            <div className="hx-row-actions">
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
              <div className="hx-form">
                <ProofPicker site={null} refText={c.personName.slice(0, 20)} items={proof} onChange={setProof} documentsOnly required />
                <ErrorNotice error={act.error} />
                <div className="hx-form-actions">
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
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
