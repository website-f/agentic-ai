import { useState } from 'react';
import { api } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad } from '../ui';

const SOURCE: Record<string, string> = {
  staff_pay: 'Staff salary',
  guard_pay: 'Guard and officer salary',
  staff_claim: 'Staff claim',
  guard_advance: 'Guard advance',
  guard_loan: 'Guard loan',
};
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Salary, claim, advance and loan payouts (Fauzan, 23 Nov 2026, D2 and gaps B1, B2). One Finance person prepares the
 * payment and picks the account it goes from; another, at team leader level, records it paid with the bank reference.
 * Prima then looks for it on the bank statement, and a paid payroll needs its SQL Account journal checked by someone else.
 */
export function Payouts({ companyId }: { companyId: string }) {
  const [n, setN] = useState(0);
  const { data, error } = useLoad(() => api.finPayouts(companyId), [companyId, n]);
  const act = useAction();
  const [bank, setBank] = useState<Record<string, string>>({});
  const [ref, setRef] = useState<Record<string, string>>({});
  const [on, setOn] = useState<Record<string, string>>({});
  const [pcb, setPcb] = useState<Record<string, boolean>>({});
  const [jno, setJno] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const done = () => setN((x) => x + 1);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="payouts" />;
  const key = (w: { source: string; sourceId: string }) => `${w.source}:${w.sourceId}`;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Salary and claim payouts</h3>
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        {data.rule}
      </p>
      <ErrorNotice error={act.error} />
      <div className="list">
        {data.waiting.length === 0 && <p className="muted small" style={{ padding: 12 }}>Nothing approved and waiting to be paid.</p>}
        {data.waiting.map((w) => {
          const k = key(w);
          const isPay = w.source === 'staff_pay' || w.source === 'guard_pay';
          return (
            <div key={k} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                <span>
                  <strong>{SOURCE[w.source] ?? w.source}</strong>: {w.label}
                </span>
                <span>{rm(w.amount)}</span>
              </div>
              {w.prepared ? (
                <span className="muted small">
                  Prepared by {w.prepared.by}, from {data.banks.find((b) => b.id === w.prepared!.bankId)?.label ?? 'the account picked'}
                  {w.prepared.note ? `: ${w.prepared.note}` : ''}
                </span>
              ) : (
                <Chip tone="warn">To prepare</Chip>
              )}
              {!w.prepared && w.mayPrepare && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <select className="input" style={{ flex: '1 1 220px' }} value={bank[k] ?? ''} onChange={(e) => setBank((x) => ({ ...x, [k]: e.target.value }))} aria-label="Paid from">
                    <option value="">Paid from which account</option>
                    {data.banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    disabled={act.busy || !bank[k]}
                    onClick={async () => {
                      if (await act.run(() => api.finPayoutPrepare({ source: w.source, sourceId: w.sourceId, bankId: bank[k] }), 'Prepared. Another Finance person records it paid.')) done();
                    }}
                  >
                    Prepare for payment
                  </button>
                </div>
              )}
              {w.mayRecord && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <input className="input" style={{ flex: '1 1 180px' }} placeholder="Bank reference" value={ref[k] ?? ''} onChange={(e) => setRef((x) => ({ ...x, [k]: e.target.value }))} />
                  <input className="input" type="date" style={{ width: 170 }} value={on[k] ?? ''} onChange={(e) => setOn((x) => ({ ...x, [k]: e.target.value }))} aria-label="Paid on" />
                  {isPay && (
                    <label className="small">
                      <input type="checkbox" checked={!!pcb[k]} onChange={(e) => setPcb((x) => ({ ...x, [k]: e.target.checked }))} /> PCB checked
                    </label>
                  )}
                  <button
                    className="btn btn-primary"
                    disabled={act.busy || !(ref[k] ?? '').trim()}
                    onClick={async () => {
                      const body = { source: w.source, sourceId: w.sourceId, bankRef: ref[k], paidOn: on[k] || undefined, pcbChecked: !!pcb[k] };
                      if (await act.run(() => api.finPayoutRecord(body), 'Recorded paid. Prima looks for it on the bank statement.')) done();
                    }}
                  >
                    Record paid
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data.paid.length > 0 && (
        <>
          <div className="panel-head">
            <h3>Paid in the last three months</h3>
          </div>
          <div className="list">
            {data.paid.map((p) => (
              <div key={p.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                  <span>
                    <strong>{SOURCE[p.source] ?? p.source}</strong>: {p.label}
                  </span>
                  <span>{rm(p.amount)}</span>
                </div>
                <span className="muted small">
                  Paid {p.paid ? dateLabel(p.paid.on) : ''} by {p.paid?.by}, ref {p.paid?.ref}.{' '}
                  {p.seen ? `Seen on the statement ${dateLabel(p.seen.date)}.` : ''}
                  {p.journal ? ` Journal ${p.journal.no}${p.journal.checked ? `, checked by ${p.journal.checked.by}` : ', not checked yet'}.` : ''}
                </span>
                {p.notSeen && <Chip tone="crit">Not on the bank statement</Chip>}
                {p.mayEnterJournal && !p.journal && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <input className="input" style={{ flex: '1 1 160px' }} placeholder="SQL Account journal no." value={jno[p.id] ?? ''} onChange={(e) => setJno((x) => ({ ...x, [p.id]: e.target.value }))} />
                    <button
                      className="btn"
                      disabled={act.busy || !(jno[p.id] ?? '').trim()}
                      onClick={async () => {
                        if (await act.run(() => api.finPayoutJournal(companyId, { payoutId: p.id, action: 'enter', no: jno[p.id] }), 'Journal entered. Someone else checks it.')) done();
                      }}
                    >
                      Enter journal
                    </button>
                  </div>
                )}
                {p.mayCheckJournal && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <input className="input" style={{ flex: '1 1 220px' }} placeholder="What you checked (needed)" value={why[p.id] ?? ''} onChange={(e) => setWhy((x) => ({ ...x, [p.id]: e.target.value }))} />
                    <button
                      className="btn"
                      disabled={act.busy || !(why[p.id] ?? '').trim()}
                      onClick={async () => {
                        if (await act.run(() => api.finPayoutJournal(companyId, { payoutId: p.id, action: 'check', comment: why[p.id] }), 'Journal checked.')) done();
                      }}
                    >
                      Check journal
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
