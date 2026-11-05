import { useState } from 'react';
import { api, type FinControls } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction } from '../ui';

/**
 * Where the money sits, fixed deposits and bank charges (Fauzan, 2 Nov 2026: suggestions 15 and 16). Prima finds the
 * placement and the uplift on the bank statement, warns before maturity, and adds up each month's charges against what
 * the bank agreed.
 */

const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
type Fd = FinControls['banking']['fds'][number];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function FixedDeposits({ v }: { v: FinControls }) {
  const act = useAction();
  const b = v.banking;
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = (action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(v.companyId, 'fd', action, input), msg);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Where the money sits</h3>
        <button className="btn btn-sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add fixed deposit'}
        </button>
      </div>
      <p className="small" style={{ padding: '0 12px' }}>
        Current accounts {rm(b.current)} (last statements) · fixed deposits {rm(b.placed)}
        <span className="muted">
          {' '}
          · {b.accounts.map((a) => `${a.bank}: ${a.balance == null ? 'no statement' : `${rm(a.balance)} (${a.asAt})`}`).join(' · ')}
        </span>
      </p>
      <ErrorNotice error={act.error} />
      {adding && (
        <div style={{ padding: 12 }}>
          {(
            [
              ['bank', 'Bank'],
              ['refMasked', 'Certificate or account, last 4 digits'],
              ['amount', 'Amount placed (RM)'],
              ['rate', 'Rate a year (%)'],
              ['doc', 'Placement confirmation (file name)'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input className="input" value={f[k] ?? ''} onChange={set(k)} />
            </Field>
          ))}
          <Field label="Placed from (and paid back into)">
            <select className="select" value={f.bankId ?? ''} onChange={set('bankId')}>
              <option value="">Choose</option>
              {v.statements.map((s) => (
                <option key={s.bank.id} value={s.bank.id}>
                  {s.bank.bank} {s.bank.accountMasked}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Placed on">
            <input className="input" type="date" value={f.placedOn ?? ''} onChange={set('placedOn')} />
          </Field>
          <Field label="Matures on">
            <input className="input" type="date" value={f.maturesOn ?? ''} onChange={set('maturesOn')} />
          </Field>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy}
            onClick={async () => {
              if (await go('add', { ...f, amount: Number(f.amount), rate: Number(f.rate) }, 'Added. Someone else checks it next.')) {
                setAdding(false);
                setF({});
              }
            }}
          >
            Save
          </button>
        </div>
      )}
      <div className="list">
        {b.fds.map((d) => (
          <FdLine key={d.id} d={d} go={go} busy={act.busy} />
        ))}
        {!b.fds.length && <div className="list-item muted">No fixed deposits recorded.</div>}
      </div>
    </section>
  );
}

function FdLine({ d, go, busy }: { d: Fd; go: (action: string, input: Record<string, unknown>, msg: string) => Promise<unknown>; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const chip: [Parameters<typeof Chip>[0]['tone'], string] =
    d.status === 'pending'
      ? ['warn', 'To check']
      : d.matured
        ? ['crit', 'Matured: decide']
        : d.decide
          ? ['warn', 'Maturing soon']
          : d.status === 'uplifted'
            ? [d.upliftSeen ? 'ok' : 'warn', d.upliftSeen ? 'Back in the bank' : 'Uplift asked']
            : d.status === 'closed'
              ? ['neutral', 'Closed']
              : ['info', 'Placed'];
  return (
    <div className="list-item" style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <span>
          {d.bank} {d.refMasked} · {rm(d.amount)} at {d.rate}% · matures {dateLabel(d.maturesOn)}
          <span className="muted">
            {' '}
            · interest about {rm(d.interest)}
            {d.placedSeen ? ' · placement seen in bank' : ''}
          </span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <Chip tone={chip[0]}>{chip[1]}</Chip>
          {(d.status === 'pending' || d.status === 'placed' || (d.status === 'uplifted' && !d.upliftSeen)) && (
            <button className="btn btn-sm" onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Act'}
            </button>
          )}
        </span>
      </div>
      {open && (
        <div style={{ paddingTop: 8 }}>
          {d.status === 'pending' && (
            <>
              <Field label="What you checked it against">
                <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
              </Field>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => go('check', { fdId: d.id, comment: f.comment }, 'Checked.')}>
                Checked
              </button>
            </>
          )}
          {d.status === 'placed' && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Renew to">
                <input className="input" type="date" value={f.to ?? ''} onChange={set('to')} />
              </Field>
              <Field label="New rate (%)">
                <input className="input" value={f.rate ?? ''} onChange={set('rate')} />
              </Field>
              <Field label="Amount renewed (RM)">
                <input className="input" value={f.amount ?? String(d.amount)} onChange={set('amount')} />
              </Field>
              <Field label="Renewal advice (file name)">
                <input className="input" value={f.doc ?? ''} onChange={set('doc')} />
              </Field>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => go('renew', { fdId: d.id, to: f.to, rate: Number(f.rate), amount: Number(f.amount ?? d.amount), doc: f.doc }, 'Renewed.')}
              >
                Renew
              </button>
              <Field label={d.matured || d.decide ? 'Or uplift it' : 'Uplift early: reason'}>
                <input className="input" value={f.why ?? ''} onChange={set('why')} />
              </Field>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => go('uplift', { fdId: d.id, comment: f.why || undefined }, 'Uplift recorded. Prima looks for the money.')}
              >
                Uplift
              </button>
            </div>
          )}
          {d.status === 'uplifted' && !d.upliftSeen && (
            <>
              <Field label="Close without the money seen on the statement (team leader, FD, CEO): reason">
                <input className="input" value={f.why ?? ''} onChange={set('why')} />
              </Field>
              <button className="btn btn-sm" disabled={busy} onClick={() => go('close', { fdId: d.id, comment: f.why }, 'Closed.')}>
                Close
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function BankCharges({ v }: { v: FinControls }) {
  const act = useAction();
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = (action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(v.companyId, 'charges', action, input), msg);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Bank charges, {v.banking.period}</h3>
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        Prima adds up the charges and fees on each statement. Record what the bank agreed once per account; a month above it is explained by a reviewer (refund
        asked, or why it is right).
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {v.banking.charges.map((c) => (
          <div key={c.bankId} className="list-item" style={{ display: 'block' }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <span>
                {c.bank} · {c.charges == null ? 'no statement' : `${rm(c.charges)} in ${c.lines.length} line(s)`}
                <span className="muted"> · agreed {c.terms ? `up to ${rm(c.terms.monthlyMax)}` : 'not recorded'}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <Chip tone={c.toExplain ? 'warn' : c.over ? 'info' : 'ok'}>
                  {c.toExplain ? 'Above agreed' : c.review ? 'Explained' : c.charges == null ? 'Waiting' : 'Within'}
                </Chip>
                <button className="btn btn-sm" onClick={() => setEdit(edit === c.bankId ? null : c.bankId)}>
                  {edit === c.bankId ? 'Close' : 'Open'}
                </button>
              </span>
            </div>
            {edit === c.bankId && (
              <div style={{ paddingTop: 8 }}>
                {c.lines.length > 0 && (
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {c.lines.map((l, i) => (
                      <li key={i}>
                        {dateLabel(l.date)} · {l.description} · {rm(l.amount)}
                      </li>
                    ))}
                  </ul>
                )}
                {c.review && (
                  <p className="small">
                    Explained by {c.review.explained.by}: {c.review.explained.comment}
                  </p>
                )}
                {c.toExplain && (
                  <>
                    <Field label="Explanation (refund asked, or why it is right)">
                      <input className="input" value={f.comment ?? ''} onChange={set('comment')} />
                    </Field>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={act.busy}
                      onClick={() => go('explain', { bankId: c.bankId, period: c.period, comment: f.comment }, 'Explained.')}
                    >
                      Save
                    </button>
                  </>
                )}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
                  <Field label="Agreed charges a month (team leader, FD, CEO)">
                    <input className="input" inputMode="decimal" value={f.monthlyMax ?? ''} onChange={set('monthlyMax')} />
                  </Field>
                  <Field label="From the bank's tariff or letter">
                    <input className="input" value={f.note ?? ''} onChange={set('note')} />
                  </Field>
                  <button
                    className="btn btn-sm"
                    disabled={act.busy}
                    onClick={() => go('terms', { bankId: c.bankId, monthlyMax: Number(f.monthlyMax), note: f.note }, 'Saved.')}
                  >
                    Save agreed charges
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
