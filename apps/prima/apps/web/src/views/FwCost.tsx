import { useState } from 'react';
import type { ProofInput } from '@prima/core';
import { api, type FwCostBoard } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';
import { DocList, ProofPicker } from './Proof';

/**
 * Recruitment cost (Fauzan, 3 Nov 2026). A foreign worker owned by one company sometimes works under another company's
 * or a branch's job. The host pays FWM a monthly recruitment cost per worker (any day in the month counts as the full
 * month), and FWM pays the owning company back at its own rate. The FD or CEO sets both rates; nothing is guessed.
 * A billed charge is not a payment: "paid" needs the payment reference and slip.
 */

type Placement = FwCostBoard['placements'][number];
type Charge = FwCostBoard['charges'][number];

function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function thisMonth(): string {
  return today().slice(0, 7);
}

function rm(n: number | null | undefined): string {
  return n === null || n === undefined ? 'Unknown' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_TONE: Record<Charge['status'], 'ok' | 'warn' | 'crit' | 'unknown'> = {
  draft: 'unknown',
  approved: 'warn',
  rejected: 'crit',
  billed: 'warn',
  paid: 'ok',
};

const STATUS_LABEL: Record<Charge['status'], string> = {
  draft: 'Waiting for FD/CEO',
  approved: 'Approved',
  rejected: 'Rejected',
  billed: 'Billed, not paid',
  paid: 'Paid',
};

export function FwCostView() {
  const { data, error } = useLoad(() => api.fwCostBoard(), []);
  const [tab, setTab] = useState<'charges' | 'placements' | 'rates' | 'ceo'>('charges');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="recruitment cost" />;
  const running = data.placements.filter((p) => p.running).length;
  const unpaid = data.charges.filter((c) => c.status === 'approved' || c.status === 'billed');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Recruitment cost</h1>
          <p>
            When a foreign worker works under another company's or a branch's job, the host pays FWM a monthly recruitment cost per worker, and FWM pays the
            owning company back. Any day in a month counts as the full month; two hosts in one month pay half each. The Finance Director or CEO sets both rates.
          </p>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="Working under another job" value={running} tone={running ? 'warn' : 'ok'} note="Placements running today" />
        {data.rates && <Kpi label="Charge to host" value={rm(data.rates.charge)} tone={data.rates.charge === null ? 'unknown' : 'ok'} note="Per worker per month" />}
        {data.rates && <Kpi label="Payback to owner" value={rm(data.rates.payback)} tone={data.rates.payback === null ? 'unknown' : 'ok'} note="Per worker per month" />}
        <Kpi label="Months to draft" value={data.toDraft.length} tone={data.toDraft.length ? 'warn' : 'ok'} />
        <Kpi label="Not paid yet" value={unpaid.length} tone={unpaid.length ? 'warn' : 'ok'} note="Approved or billed" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Recruitment cost</h2>
          <div className="tabbar" role="tablist" aria-label="Recruitment cost sections">
            {data.scope !== 'placements' && (
              <button role="tab" aria-selected={tab === 'charges'} onClick={() => setTab('charges')}>
                Charges
              </button>
            )}
            <button role="tab" aria-selected={tab === 'placements' || (data.scope === 'placements' && tab === 'charges')} onClick={() => setTab('placements')}>
              Placements
            </button>
            {data.rates && (
              <button role="tab" aria-selected={tab === 'rates'} onClick={() => setTab('rates')}>
                Rates
              </button>
            )}
            {data.legal && (
              <button role="tab" aria-selected={tab === 'ceo'} onClick={() => setTab('ceo')}>
                CEO log
                {data.legal.status === 'open' && <span className="tab-count">1</span>}
              </button>
            )}
          </div>
        </div>
        {tab === 'charges' && data.scope !== 'placements' && <Charges data={data} />}
        {(tab === 'placements' || (data.scope === 'placements' && tab === 'charges')) && <Placements data={data} />}
        {tab === 'rates' && data.rates && <Rates data={data} />}
        {tab === 'ceo' && data.legal && <CeoLog legal={data.legal} />}
      </section>
    </div>
  );
}

// ---------- Charges ----------

function Charges({ data }: { data: FwCostBoard }) {
  const months = [...new Set(data.charges.map((c) => c.month))];
  return (
    <div className="list">
      {data.can.draft && data.toDraft.length > 0 && (
        <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <div style={{ fontWeight: 600 }}>Months to draft</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {data.toDraft.map((m) => (
              <DraftButton key={m} month={m} />
            ))}
          </div>
        </div>
      )}
      {months.length === 0 && <div className="empty">No recruitment cost charge yet.</div>}
      {months.map((m) => (
        <Month key={m} month={m} charges={data.charges.filter((c) => c.month === m)} data={data} />
      ))}
    </div>
  );
}

function DraftButton({ month }: { month: string }) {
  const act = useAction();
  return (
    <span>
      <button className="btn btn-sm" disabled={act.busy} onClick={() => act.run(() => api.draftFwCostMonth(month), `Charges for ${month} drafted.`)}>
        Draft {month}
      </button>
      <ErrorNotice error={act.error} />
    </span>
  );
}

function Month({ month, charges, data }: { month: string; charges: Charge[]; data: FwCostBoard }) {
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const act = useAction();
  const decidable = charges.filter((c) => c.canDecide);
  const waitingOnOther = data.can.decide && charges.some((c) => c.status === 'draft' && !c.canDecide);
  const hostTotal = charges.filter((c) => c.direction === 'host_pays_fwm' && c.status !== 'rejected').reduce((s, c) => s + c.total, 0);
  const ownerTotal = charges.filter((c) => c.direction === 'fwm_pays_owner' && c.status !== 'rejected').reduce((s, c) => s + c.total, 0);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600 }}>{month}</div>
        {data.scope === 'all' && (
          <div className="muted small">
            Hosts pay FWM {rm(hostTotal)} · FWM pays owners {rm(ownerTotal)}
          </div>
        )}
      </div>
      {charges.map((c) => (
        <ChargeRow key={c.id} c={c} canBook={data.can.book} />
      ))}
      {waitingOnOther && decidable.length === 0 && <div className="muted small">You drafted these, so another approver (FD or CEO) decides them.</div>}
      {decidable.length > 0 && !deciding && (
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setDeciding('approve')}>
            Approve {month}
          </button>
          <button className="btn btn-sm" onClick={() => setDeciding('reject')}>
            Reject
          </button>
        </div>
      )}
      {deciding && (
        <>
          <input
            className="input"
            aria-label="Reason"
            placeholder={deciding === 'approve' ? 'Reason for approving (needed)' : 'Why it is rejected (needed)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || note.trim().length < 5}
              onClick={async () => {
                const ok = await act.run(
                  () => api.decideFwCostCharges({ month, chargeIds: decidable.map((c) => c.id), approve: deciding === 'approve', note }),
                  deciding === 'approve' ? `${month} approved.` : `${month} rejected.`,
                );
                if (ok) setDeciding(null);
              }}
            >
              {deciding === 'approve' ? 'Approve' : 'Reject'}
            </button>
            <button className="btn btn-sm" onClick={() => setDeciding(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ChargeRow({ c, canBook }: { c: Charge; canBook: boolean }) {
  const [open, setOpen] = useState(false);
  const [booking, setBooking] = useState(false);
  const host = c.direction === 'host_pays_fwm';
  const who = `${c.companyName}${c.branchName ? `, ${c.branchName}` : ''}`;
  const nextStep: 'billed' | 'paid' | null = host
    ? c.status === 'approved'
      ? 'billed'
      : c.status === 'billed'
        ? 'paid'
        : null
    : c.status === 'approved'
      ? 'paid'
      : null;
  const approverWaits = canBook && nextStep === 'paid' && !c.canRecordPaid;
  return (
    <div className="panel" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{host ? `${who} pays FWM` : `FWM pays ${who}`}</div>
          <div className="muted small">
            {c.lines.length} worker{c.lines.length === 1 ? '' : 's'} at {rm(c.rate)} a month
            {c.lines.some((l) => l.share < 1) ? ` (${c.lines.filter((l) => l.share < 1).length} shared with another host)` : ''} = {rm(c.total)} · drafted by {c.draftedBy}
            {c.decidedBy ? ` · ${c.status === 'rejected' ? 'rejected' : 'approved'} by ${c.decidedBy}: ${c.decisionNote ?? ''}` : ''}
          </div>
          {c.invoiceRef && (
            <div className="small">
              Invoice {c.invoiceRef} on {dateLabel(c.invoicedOn)}
            </div>
          )}
          {c.paidRef && (
            <div className="small">
              Paid, ref {c.paidRef} on {dateLabel(c.paidOn)}
            </div>
          )}
        </div>
        <Chip tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Chip>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide workers' : 'Workers'}
        </button>
        {canBook && nextStep && (nextStep === 'billed' || c.canRecordPaid) && !booking && (
          <button className="btn btn-sm" onClick={() => setBooking(true)}>
            {nextStep === 'billed' ? 'Record the invoice' : 'Record the payment'}
          </button>
        )}
      </div>
      {approverWaits && <div className="muted small">You approved this charge, so another Finance member records the payment.</div>}
      {open && (
        <div className="list" style={{ gap: 2 }}>
          {c.lines.map((l) => (
            <div key={l.personId} className="small">
              {l.name} · {l.staffNo} · {l.share < 1 ? `${l.share === 0.5 ? 'half' : `${Math.round(l.share * 100)}% of the`} month, ${rm(l.amount)}` : rm(l.amount)}
            </div>
          ))}
          {c.status === 'paid' && <PaidDocs id={c.id} />}
        </div>
      )}
      {booking && nextStep && <BookForm c={c} step={nextStep} onDone={() => setBooking(false)} />}
    </div>
  );
}

function PaidDocs({ id }: { id: string }) {
  const docs = useLoad(() => api.fwCostDocs(id), [id]);
  return docs.data ? <DocList docs={docs.data} /> : null;
}

function BookForm({ c, step, onDone }: { c: Charge; step: 'billed' | 'paid'; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [on, setOn] = useState(today());
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  return (
    <div className="panel" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="muted small">
        {step === 'billed'
          ? 'Raise the invoice in SQL Account first, then record its number here. An invoice is not a payment.'
          : 'Record the payment only when it has gone through the bank, with the slip attached.'}
      </div>
      <div className="grid-2">
        <input
          className="input"
          aria-label={step === 'billed' ? 'Invoice number' : 'Payment reference'}
          placeholder={step === 'billed' ? 'SQL Account invoice number' : 'Bank payment reference'}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <input className="input" type="date" aria-label={step === 'billed' ? 'Invoice date' : 'Payment date'} value={on} onChange={(e) => setOn(e.target.value)} />
      </div>
      {step === 'paid' && <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly required />}
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || ref.trim().length < 3 || (step === 'paid' && proof.length === 0)}
          onClick={async () => {
            const ok = await act.run(() => api.bookFwCostCharge(c.id, { step, ref, on }, proof), step === 'billed' ? 'Invoice recorded.' : 'Payment recorded.');
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- Placements ----------

function Placements({ data }: { data: FwCostBoard }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = data.placements.filter(
    (p) => !needle || `${p.person?.name ?? ''} ${p.person?.staffNo ?? ''} ${p.ownerName} ${p.hostName} ${p.hostBranchName ?? ''}`.toLowerCase().includes(needle),
  );
  return (
    <div className="list">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', padding: '0 12px' }}>
        <input className="input" aria-label="Search placements" placeholder="Search worker or company" value={q} onChange={(e) => setQ(e.target.value)} />
        {data.can.place && !adding && (
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            Record a placement
          </button>
        )}
      </div>
      {adding && <PlacementForm data={data} onDone={() => setAdding(false)} />}
      {shown.length === 0 && <div className="empty">{data.placements.length ? 'No placement matches.' : 'No worker is under another company’s job.'}</div>}
      {shown.map((p) => (
        <PlacementRow key={p.id} p={p} canEnd={data.can.place} />
      ))}
    </div>
  );
}

function PlacementRow({ p, canEnd }: { p: Placement; canEnd: boolean }) {
  const [ending, setEnding] = useState(false);
  const [to, setTo] = useState(today());
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{p.person?.name ?? p.personId}</div>
          <div className="muted small">
            {p.person?.staffNo} · owned by {p.ownerName} · works under {p.hostName}
            {p.hostBranchName ? `, ${p.hostBranchName}` : ''}
          </div>
          <div className="small">
            From {dateLabel(p.from)}
            {p.to ? ` to ${dateLabel(p.to)}` : ', still running'} · recorded by {p.by}
          </div>
          {p.note && <div className="muted small">{p.note}</div>}
          {p.endNote && <div className="muted small">Ended: {p.endNote}</div>}
        </div>
        <Chip tone={p.running ? 'warn' : 'ok'}>{p.running ? 'Running' : 'Ended'}</Chip>
      </div>
      {canEnd && p.to === null && !ending && (
        <div>
          <button className="btn btn-sm" onClick={() => setEnding(true)}>
            End the placement
          </button>
        </div>
      )}
      {ending && (
        <>
          <div className="grid-2">
            <input className="input" type="date" aria-label="Last day" value={to} onChange={(e) => setTo(e.target.value)} />
            <input className="input" aria-label="Why it ended" placeholder="Why it ended (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || note.trim().length < 5}
              onClick={async () => {
                const ok = await act.run(() => api.endFwPlacement(p.id, { to, note }), 'Placement ended.');
                if (ok) setEnding(false);
              }}
            >
              End
            </button>
            <button className="btn btn-sm" onClick={() => setEnding(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PlacementForm({ data, onDone }: { data: FwCostBoard; onDone: () => void }) {
  const [personId, setPersonId] = useState('');
  const [hostCompanyId, setHost] = useState('');
  const [hostBranchId, setBranch] = useState('');
  const [salaryPaidBy, setPayer] = useState<'company' | 'branch'>('branch');
  const [from, setFrom] = useState(today());
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const worker = data.workers.find((w) => w.id === personId);
  const branches = data.branches.filter((b) => b.companyId === hostCompanyId);
  // Under the owner's own company the worker is only "placed" when they work under one of its branches.
  const ownCompany = worker && hostCompanyId === worker.companyId;
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, margin: '0 12px' }}>
      <select className="select" aria-label="Worker" value={personId} onChange={(e) => setPersonId(e.target.value)}>
        <option value="">Choose the worker</option>
        {data.workers.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} · {w.staffNo} · {w.companyName}
          </option>
        ))}
      </select>
      <div className="grid-2">
        <select
          className="select"
          aria-label="Works under company"
          value={hostCompanyId}
          onChange={(e) => {
            setHost(e.target.value);
            setBranch('');
          }}
        >
          <option value="">Whose job does the worker work under?</option>
          {data.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Branch" value={hostBranchId} onChange={(e) => setBranch(e.target.value)} disabled={!branches.length}>
          <option value="">{branches.length ? (ownCompany ? 'Choose the branch (needed)' : 'No branch, the company itself') : 'No branch'}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="muted small">The worker keeps wearing their own company's uniform at the host's site.</div>
      {hostBranchId && (
        <label className="field">
          <span className="label">Who pays the salary</span>
          <select className="select" aria-label="Who pays the salary" value={salaryPaidBy} onChange={(e) => setPayer(e.target.value === 'company' ? 'company' : 'branch')}>
            <option value="branch">The branch that uses the worker</option>
            <option value="company">The company that uses the worker</option>
          </select>
        </label>
      )}
      <div className="muted small">EPF and SOCSO stay with the company holding the permit; the user repays them each month.</div>
      {ownCompany && !hostBranchId && <div className="muted small">This is the worker's own company. It is a placement only when the worker works under one of its branches.</div>}
      <label className="field">
        <span className="label">First day under that job</span>
        <input className="input" type="date" aria-label="First day" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <input className="input" aria-label="Placement note" placeholder="Note, such as the site or the request" value={note} onChange={(e) => setNote(e.target.value)} />
      <ProofPicker site={null} refText="FWM" items={proof} onChange={setProof} documentsOnly />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !personId || !hostCompanyId || (ownCompany && !hostBranchId) || !from}
          onClick={async () => {
            const ok = await act.run(() => api.recordFwPlacement(personId, { hostCompanyId, hostBranchId: hostBranchId || null, from, note, salaryPaidBy: hostBranchId ? salaryPaidBy : 'company' }, proof), 'Placement recorded.');
            if (ok) onDone();
          }}
        >
          Save
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- Rates ----------

function Rates({ data }: { data: FwCostBoard }) {
  const rates = data.rates!;
  return (
    <div className="list">
      <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <div>
          Host pays FWM: <strong>{rm(rates.charge)}</strong> per worker per month
        </div>
        <div>
          FWM pays the owner back: <strong>{rm(rates.payback)}</strong> per worker per month
        </div>
        {(rates.charge === null || rates.payback === null) && (
          <div className="muted small">A month cannot be drafted until both rates are set. The app never guesses a rate.</div>
        )}
      </div>
      {data.can.rate && <RateForm />}
      {rates.history && (
        <>
          {(['charge', 'payback'] as const).map((k) => (
            <div key={k} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
              <div style={{ fontWeight: 600 }}>{k === 'charge' ? 'Charge to host, history' : 'Payback to owner, history'}</div>
              {rates.history![k].length === 0 && <div className="muted small">Not set.</div>}
              {[...rates.history![k]].reverse().map((s) => (
                <div key={`${s.from}-${s.at}`} className="small">
                  From {s.from}: {rm(s.monthlyPerWorker)} · set by {s.by} · {s.note}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      {data.can.rate && <p className="muted small" style={{ padding: '8px 12px' }}>{data.rule.source}</p>}
    </div>
  );
}

function RateForm() {
  const [kind, setKind] = useState<'charge' | 'payback'>('charge');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(thisMonth());
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, margin: '0 12px' }}>
      <div style={{ fontWeight: 600 }}>Set a rate</div>
      <div className="grid-2">
        <select className="select" aria-label="Which rate" value={kind} onChange={(e) => setKind(e.target.value as 'charge' | 'payback')}>
          <option value="charge">Charge to host (host pays FWM)</option>
          <option value="payback">Payback to owner (FWM pays owner)</option>
        </select>
        <input className="input" type="number" min="0.01" step="0.01" aria-label="RM per worker per month" placeholder="RM per worker per month" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="grid-2">
        <input className="input" type="month" aria-label="From month" min={thisMonth()} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" aria-label="Rate reason" placeholder="Reason (needed)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ErrorNotice error={act.error} />
      <div>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !(Number(amount) > 0) || note.trim().length < 5 || !from}
          onClick={async () => {
            const ok = await act.run(() => api.setFwCostRate({ kind, monthlyPerWorker: Number(amount), from, note }), 'Rate saved.');
            if (ok) {
              setAmount('');
              setNote('');
            }
          }}
        >
          Save rate
        </button>
      </div>
    </div>
  );
}

// ---------- CEO log ----------

type Legal = NonNullable<FwCostBoard['legal']>;

/** Fauzan, 3 Nov 2026: a legal flag never stops the system; it goes to the CEO log and the CEO records the details. */
function CeoLog({ legal }: { legal: Legal }) {
  const [note, setNote] = useState('');
  const act = useAction();
  return (
    <div className="list">
      <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontWeight: 600 }}>Legal flag: workers under another company's job</div>
          <Chip tone={legal.status === 'open' ? 'unknown' : 'warn'}>{legal.status === 'open' ? 'No details yet' : 'Details recorded'}</Chip>
        </div>
        <div className="small">{legal.text}</div>
        <div className="muted small">
          {legal.running} placement{legal.running === 1 ? '' : 's'} running
          {legal.hosts.length ? `, under ${legal.hosts.join('; ')}` : ''}. This flag does not stop anything; only you see it.
        </div>
      </div>
      <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, margin: '0 12px' }}>
        <textarea className="input" rows={3} aria-label="CEO details" placeholder="Details, such as counsel's view or KDN's answer" value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorNotice error={act.error} />
        <div>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || note.trim().length < 5}
            onClick={async () => {
              const ok = await act.run(() => api.addFwCostLegalNote({ note }), 'Details saved to the CEO log.');
              if (ok) setNote('');
            }}
          >
            Save details
          </button>
        </div>
      </div>
      {legal.notes.map((n) => (
        <div key={n.at + n.byId} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
          <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{n.note}</div>
          <div className="muted small">
            {n.by} · {dateLabel(n.at.slice(0, 10))}
          </div>
        </div>
      ))}
    </div>
  );
}
