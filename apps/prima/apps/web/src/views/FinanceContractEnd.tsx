import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api, type FinControls } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction } from '../ui';

/**
 * Contract ends and money held by clients (Fauzan, 2 Nov 2026: suggestions 3 and 24, automation A11). When a contract
 * ends or is terminated, billing stops and Prima lists the follow-ups: the final invoice, deposits and retention to
 * claim back, IG/BG to release and the stamp duty refund for an agreement cancelled before it started.
 */

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type Dep = FinControls['contractEnd']['deposits'][number];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ContractEnds({ v }: { v: FinControls }) {
  const ce = v.contractEnd;
  if (!ce.ends.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Contracts that ended</h3>
      </div>
      <p className="muted small fin-intro">
        Billing stops on the day a contract ends or is terminated. Prima lists what follows; each line ticks itself when it is done elsewhere (invoice recorded,
        money seen on the bank statement, guarantee closed).
      </p>
      <div className="list">
        {ce.ends.map((e) => (
          <div key={e.contract.id} className="list-item fin-block">
            <div className="row fin-between">
              <span className="fin-strong">
                {e.contract.client} · {e.contract.ref} · {e.contract.terminated ? 'terminated' : 'ended'} {dateLabel(e.contract.endOn)}
              </span>
              <Chip tone={e.late ? 'crit' : e.open ? 'warn' : 'ok'}>{e.open ? `${e.open} to do${e.late ? `, ${e.late} late` : ''}` : 'All done'}</Chip>
            </div>
            <ul className="small fin-ul">
              {e.steps.map((s, i) => (
                <li key={i}>
                  {s.done ? '✓ ' : ''}
                  {s.text}
                  {!s.done && s.by && <span className="muted"> · by {dateLabel(s.by)}</span>}
                </li>
              ))}
              {!e.steps.length && <li className="muted">Nothing held by the client and no guarantee linked to this contract.</li>}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const STATUS: Record<Dep['status'], [Parameters<typeof Chip>[0]['tone'], string]> = {
  pending: ['warn', 'To check'],
  held: ['info', 'Held by client'],
  claimed: ['warn', 'Claimed back'],
  refunded: ['ok', 'Paid back'],
  written_off: ['neutral', 'Written off'],
};

export function ClientDeposits({ v }: { v: FinControls }) {
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ kind: 'deposit' });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = (action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(v.companyId, 'deposits', action, input), msg);
  const ce = v.contractEnd;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Deposits and retention held by clients</h3>
        <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add'}
        </button>
      </div>
      <p className="muted small fin-intro">
        Money a client keeps until the contract ends. A second person checks each one. Claim it back when the contract ends; Prima finds the payment on the bank
        statement.
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div className="fin-pad">
          <Field label="Type">
            <select className="select" value={f.kind} onChange={set('kind')}>
              <option value="deposit">Deposit</option>
              <option value="retention">Retention</option>
            </select>
          </Field>
          <Field label="Contract (fills the client)">
            <Select className="select" value={f.contractId ?? ''} onChange={set('contractId')}>
              <option value="">Not linked: type the client</option>
              {ce.contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client} · {c.ref}
                </option>
              ))}
            </Select>
          </Field>
          {!f.contractId && (
            <Field label="Client">
              <input className="input" value={f.client ?? ''} onChange={set('client')} />
            </Field>
          )}
          <Field label="Amount held (RM)">
            <input className="input" inputMode="decimal" value={f.amount ?? ''} onChange={set('amount')} />
          </Field>
          <Field label="Held since">
            <input className="input" type="date" value={f.heldSince ?? ''} onChange={set('heldSince')} />
          </Field>
          <Field label="Due back on (if the contract says; otherwise worked out from its end)">
            <input className="input" type="date" value={f.dueBackOn ?? ''} onChange={set('dueBackOn')} />
          </Field>
          <Field label="Where it is written (contract clause or receipt)">
            <input className="input" value={f.doc ?? ''} onChange={set('doc')} />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await go('add', { ...f, amount: Number(f.amount), dueBackOn: f.dueBackOn || undefined }, 'Added. Someone else checks it next.')) {
                setAdding(false);
                setF({ kind: 'deposit' });
              }
            }}
          >
            Save
          </button>
        </div>
      )}
      <div className="list">
        {ce.deposits.map((d) => (
          <DepositLine key={d.id} d={d} go={go} busy={act.busy} />
        ))}
        {!ce.deposits.length && <div className="list-item muted">None recorded.</div>}
      </div>
    </section>
  );
}

function DepositLine({ d, go, busy }: { d: Dep; go: (action: string, input: Record<string, unknown>, msg: string) => Promise<unknown>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [tone, label] = STATUS[d.status];
  return (
    <div className="list-item fin-block">
      <div className="row fin-between">
        <span>
          {d.kind === 'deposit' ? 'Deposit' : 'Retention'} {rm(d.amount)} · {d.client}
          {d.contractRef && ` · ${d.contractRef}`}
          {d.dueBack && d.status !== 'refunded' && d.status !== 'written_off' && <span className="muted"> · due back {dateLabel(d.dueBack)}</span>}
          {d.refund && <span className="muted"> · paid back {dateLabel(d.refund.date)}</span>}
        </span>
        <span className="row">
          <Chip tone={tone}>{label}</Chip>
          {['pending', 'held', 'claimed'].includes(d.status) && (
            <button className="btn btn-sm" onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Act'}
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="fin-pt">
          {d.status === 'pending' && (
            <>
              <Field label="What you checked it against">
                <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
              </Field>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go('check', { depositId: d.id, comment: f.comment }, 'Checked.')}>
                Checked
              </button>
            </>
          )}
          {d.status === 'held' && (
            <>
              <Field label="Claim letter reference">
                <input className="input" value={f.ref ?? ''} onChange={set('ref')} />
              </Field>
              <Field label="Documents sent (claim letter, client's release), one per line">
                <textarea className="textarea" rows={2} value={f.docs ?? ''} onChange={set('docs')} />
              </Field>
              <Field label="Why now (only if the contract has not ended)">
                <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
              </Field>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => go('claim', { depositId: d.id, ref: f.ref, docs: f.docs, comment: f.comment || undefined }, 'Claim recorded.')}
              >
                Record the claim
              </button>
            </>
          )}
          {(d.status === 'held' || d.status === 'claimed') && (
            <div className="fin-mt">
              <Field label="Write off (Finance Director or CEO): reason">
                <input className="input" value={f.why ?? ''} onChange={set('why')} />
              </Field>
              <button className="btn btn-sm" disabled={busy || !f.why} onClick={() => go('writeOff', { depositId: d.id, comment: f.why }, 'Written off.')}>
                Write off
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
