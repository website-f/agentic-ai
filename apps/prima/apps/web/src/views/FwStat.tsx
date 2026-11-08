import { useState } from 'react';
import { api, type FwStatBoard, type FwStatDraftRow } from '../api';
import { Chip, ErrorNotice, Kpi, Loading, dateLabel, useAction, useLoad } from '../ui';

/**
 * Nepali EPF and SOCSO (Fauzan, 5 Nov 2026). The company holding the worker's permit pays KWSP and PERKESO. The company
 * or branch that used the worker repays that amount each month. The salary is paid by the company or branch that uses
 * the worker. Who used whom comes from FWM's placements (Recruitment cost screen).
 */

type Charge = FwStatBoard['charges'][number];
type Due = FwStatBoard['toCharge'][number];

const KEYS = ['epfEr', 'epfEe', 'socsoEr', 'socsoEe', 'lindungEe'] as const;
const KEY_LABEL: Record<(typeof KEYS)[number], string> = {
  epfEr: 'EPF employer',
  epfEe: 'EPF employee',
  socsoEr: 'SOCSO employer',
  socsoEe: 'SOCSO employee',
  lindungEe: 'LINDUNG 24 Jam',
};
const TONE: Record<Charge['status'], 'warn' | 'info' | 'ok' | 'neutral'> = { issued: 'warn', paid: 'info', received: 'ok', cancelled: 'neutral' };

function rm(n: number): string {
  return `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}
const userOf = (c: { names?: { user: string; branch: string | null }; userName?: string; branchName?: string | null }) =>
  c.names ? `${c.names.user}${c.names.branch ? `, ${c.names.branch}` : ''}` : `${c.userName}${c.branchName ? `, ${c.branchName}` : ''}`;

export function FwStatView() {
  const { data, error } = useLoad(() => api.fwStatBoard(), []);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="Nepali EPF and SOCSO" />;
  const toRepay = data.charges.filter((c) => c.canRepay);
  const toCheck = data.charges.filter((c) => c.canReceive);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Nepali EPF and SOCSO</h1>
          <p>
            The company holding the worker's permit pays EPF and SOCSO. The company or branch that used the worker repays that amount every month, for the days
            it used the worker. The salary is paid by the company or branch that uses the worker.
          </p>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="To repay" value={toRepay.length} tone={toRepay.length ? 'warn' : 'ok'} note="Debit notes waiting for your transfer" />
        <Kpi label="Late" value={data.overdue} tone={data.overdue ? 'crit' : 'ok'} note={`Not repaid within ${data.rule.value.repayDays} days`} />
        {data.financeOwners.length > 0 && <Kpi label="To check in" value={toCheck.length} tone={toCheck.length ? 'warn' : 'ok'} note="Repaid, match to the bank" />}
        {data.financeOwners.length > 0 && <Kpi label="Months to charge" value={data.toCharge.length} tone={data.toCharge.length ? 'warn' : 'ok'} />}
      </div>
      {data.financeOwners.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Months to charge</h2>
          </div>
          <div className="list">
            {data.toCharge.length === 0 && <div className="empty">Every finished month with a placed Nepali worker is charged.</div>}
            {data.toCharge.map((d) => (
              <DueRow key={`${d.ownerCompanyId}|${d.userCompanyId}|${d.userBranchId ?? ''}|${d.period}`} d={d} />
            ))}
          </div>
        </section>
      )}
      {data.placed.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Nepali workers used by another company or branch</h2>
          </div>
          <div className="list">
            {data.placed.map((p) => (
              <div key={p.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                <div style={{ fontWeight: 600 }}>
                  {p.workerName} · {p.staffNo}
                </div>
                <div className="muted small">
                  Permit: {p.ownerName} · used by {userOf(p)} from {dateLabel(p.from)} · salary paid by the {p.salaryPaidBy === 'branch' ? 'branch' : 'company'}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>Debit notes</h2>
        </div>
        <div className="list">
          {data.charges.length === 0 && <div className="empty">No EPF and SOCSO debit note yet.</div>}
          {data.charges.map((c) => (
            <ChargeRow key={c.pairId} c={c} />
          ))}
        </div>
      </section>
    </div>
  );
}

function DueRow({ d }: { d: Due }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {d.period} · {userOf(d)}
          </div>
          <div className="muted small">
            {`${d.workers} Nepali worker${d.workers === 1 ? '' : 's'} of ${d.ownerName}`}
          </div>
        </div>
        {!open && (
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            Prepare the debit note
          </button>
        )}
      </div>
      {open && <IssueForm d={d} onDone={() => setOpen(false)} />}
    </div>
  );
}

type Row = { personId: string; staffNo: string; workerName: string; daysUsed: number; daysInMonth: number; wage: string; paid: Record<(typeof KEYS)[number], string>; expected: FwStatDraftRow['expected']; kwspRef: string; perkesoRef: string; note: string };

function IssueForm({ d, onDone }: { d: Due; onDone: () => void }) {
  const scope = { ownerCompanyId: d.ownerCompanyId, userCompanyId: d.userCompanyId, userBranchId: d.userBranchId, period: d.period };
  const { data, error } = useLoad(() => api.fwStatAct('draft', scope) as Promise<FwStatDraftRow[]>, [d.ownerCompanyId, d.userCompanyId, d.userBranchId, d.period]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState('');
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="the workers" />;
  const list: Row[] =
    rows ??
    data.map((w) => ({
      personId: w.personId,
      staffNo: w.staffNo,
      workerName: w.workerName,
      daysUsed: w.daysUsed,
      daysInMonth: w.daysInMonth,
      wage: String(w.wage || ''),
      paid: Object.fromEntries(KEYS.map((k) => [k, String(w.expected[k])])) as Row['paid'],
      expected: w.expected,
      kwspRef: '',
      perkesoRef: '',
      note: '',
    }));
  const set = (i: number, patch: Partial<Row>) => setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ready = list.every((r) => Number(r.wage) > 0 && r.kwspRef.trim().length >= 3 && r.perkesoRef.trim().length >= 3);
  return (
    <div className="panel" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="muted small">
        Enter what {d.ownerName} paid KWSP and PERKESO for each worker for the whole of {d.period}, with the receipt numbers. The figures start from the published
        rates on the wage; change them to what was paid, and say why when they differ. The user repays its share for the days it used the worker.
      </div>
      {list.map((r, i) => (
        <div key={r.personId} className="panel" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 600 }}>
            {r.workerName} · {r.staffNo}
          </div>
          <div className="muted small">
            {`Used ${r.daysUsed} of ${r.daysInMonth} days`}
          </div>
          <label className="field">
            <span className="label">Wage for the month (RM)</span>
            <input className="input" inputMode="decimal" aria-label={`Wage ${r.staffNo}`} value={r.wage} onChange={(e) => set(i, { wage: e.target.value })} />
          </label>
          <div className="grid-2">
            {KEYS.map((k) => {
              const off = Math.abs(Number(r.paid[k]) - r.expected[k]) > 1;
              return (
                <label key={k} className="field">
                  <span className="label">
                    {KEY_LABEL[k]} paid (RM){off ? ` · rate gives ${rm(r.expected[k])}` : ''}
                  </span>
                  <input className="input" inputMode="decimal" aria-label={`${KEY_LABEL[k]} ${r.staffNo}`} value={r.paid[k]} onChange={(e) => set(i, { paid: { ...r.paid, [k]: e.target.value } })} />
                </label>
              );
            })}
          </div>
          <div className="grid-2">
            <input className="input" aria-label={`KWSP receipt ${r.staffNo}`} placeholder="KWSP receipt number" value={r.kwspRef} onChange={(e) => set(i, { kwspRef: e.target.value })} />
            <input className="input" aria-label={`PERKESO receipt ${r.staffNo}`} placeholder="PERKESO receipt number" value={r.perkesoRef} onChange={(e) => set(i, { perkesoRef: e.target.value })} />
          </div>
          <input className="input" aria-label={`Note ${r.staffNo}`} placeholder="Why a figure differs from the rate (if it does)" value={r.note} onChange={(e) => set(i, { note: e.target.value })} />
        </div>
      ))}
      <input className="input" aria-label="Note on the debit note" placeholder="Note on the debit note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !ready}
          onClick={async () => {
            const lines = list.map((r) => ({
              personId: r.personId,
              wage: Number(r.wage),
              paid: Object.fromEntries(KEYS.map((k) => [k, Number(r.paid[k] || 0)])),
              kwspRef: r.kwspRef.trim(),
              perkesoRef: r.perkesoRef.trim(),
              note: r.note.trim(),
            }));
            const ok = await act.run(() => api.fwStatAct('issue', { ...scope, note, lines }), 'Debit note issued.');
            if (ok) onDone();
          }}
        >
          Issue the debit note
        </button>
        <button className="btn btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ChargeRow({ c }: { c: Charge }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'repay' | 'receive' | 'cancel' | null>(null);
  const [bankRef, setBankRef] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [text, setText] = useState('');
  const act = useAction();
  const done = () => {
    setStep(null);
    setText('');
  };
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {c.ref} · {c.period}
          </div>
          <div className="small">
            <b>{`${userOf(c)} repays ${c.names.owner}: ${rm(c.total)}`}</b>
          </div>
          <div className="muted small">
            {`${c.lines.length} worker${c.lines.length === 1 ? '' : 's'} · issued by ${c.issued.by} on ${dateLabel(c.issued.at.slice(0, 10))} · repay by ${dateLabel(c.dueOn)}${c.internal ? ' · own branch' : ''}`}
          </div>
          {c.paid && (
            <div className="small">
              {`Repaid ${rm(c.paid.amount)} on ${dateLabel(c.paid.paidOn)}, bank reference ${c.paid.bankRef} (${c.paid.by})`}
            </div>
          )}
          {c.received && (
            <div className="small">
              {`Checked in by ${c.received.by}: ${c.received.note}`}
            </div>
          )}
          {c.cancelled && <div className="small">{`Cancelled by ${c.cancelled.by}: ${c.cancelled.reason}`}</div>}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {c.overdue && <Chip tone="crit">Late</Chip>}
          <Chip tone={TONE[c.status]}>{c.statusLabel}</Chip>
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide workers' : 'Workers'}
        </button>
        {c.canRepay && !step && (
          <button className="btn btn-primary btn-sm" onClick={() => setStep('repay')}>
            Record the repayment
          </button>
        )}
        {c.canReceive && !step && (
          <button className="btn btn-primary btn-sm" onClick={() => setStep('receive')}>
            Check in the money
          </button>
        )}
        {c.canCancel && !step && (
          <button className="btn btn-sm" onClick={() => setStep('cancel')}>
            Cancel
          </button>
        )}
      </div>
      {c.status === 'paid' && !c.canReceive && c.paid && <div className="muted small">Waiting for {c.names.owner}'s Finance to match it to the bank.</div>}
      {open && (
        <div className="list" style={{ gap: 4 }}>
          {c.lines.map((l) => (
            <div key={l.personId} className="small">
              <b>
                {l.workerName} · {l.staffNo}
              </b>{' '}
              · {l.daysUsed} of {l.daysInMonth} days · wage {rm(l.wage)} · salary paid by the {l.salaryPaidBy}
              <div className="muted">
                {KEYS.map((k) => `${KEY_LABEL[k]} ${rm(l.charged[k])}`).join(' · ')} · KWSP {l.kwspRef} · PERKESO {l.perkesoRef}
                {l.note ? ` · ${l.note}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {step === 'repay' && (
        <div className="panel" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="muted small">Repay the full {rm(c.total)} in one transfer to {c.names.owner}, then record it here.</div>
          <div className="grid-2">
            <input className="input" aria-label="Bank transfer reference" placeholder="Bank transfer reference" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
            <input className="input" type="date" aria-label="Transfer date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || bankRef.trim().length < 3}
              onClick={async () => {
                if (await act.run(() => api.fwStatAct('repaid', { pairId: c.pairId, bankRef: bankRef.trim(), paidOn, amount: c.total }), 'Repayment recorded.')) done();
              }}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={done}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {(step === 'receive' || step === 'cancel') && (
        <div className="panel" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            className="input"
            aria-label={step === 'receive' ? 'Bank statement line' : 'Why it is cancelled'}
            placeholder={step === 'receive' ? 'Bank statement line or comment (needed)' : 'Why it is cancelled (needed)'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <ErrorNotice error={act.error} />
          <div className="row" style={{ gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={act.busy || text.trim().length < (step === 'cancel' ? 5 : 3)}
              onClick={async () => {
                const ok =
                  step === 'receive'
                    ? await act.run(() => api.fwStatAct('received', { pairId: c.pairId, note: text.trim() }), 'Money checked in.')
                    : await act.run(() => api.fwStatAct('cancel', { pairId: c.pairId, reason: text.trim() }), 'Debit note cancelled.');
                if (ok) done();
              }}
            >
              {step === 'receive' ? 'Checked in' : 'Cancel the debit note'}
            </button>
            <button className="btn btn-sm" onClick={done}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
