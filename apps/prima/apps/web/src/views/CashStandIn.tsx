import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { Card } from '../kit';
import { Chip, ErrorNotice, Loading, useAction, useLoad } from '../ui';

// B2 (Fauzan, 11 Nov 2026): "the FD can stand in for the CEO when needed" on cash (arrival cash and exceptional guard
// cash). The CEO turns it on for set dates while away, or for one named request; the FD's decisions come back here.
// P105: office kit card, labelled fields, a company pick-list in place of typing a company id, company names in the
// lists, BM rows. What is sent to the server is unchanged.

export function CashStandInPanel() {
  const { me } = useApp();
  const { data, error } = useLoad(() => api.cashStandIn(), []);
  const act = useAction();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'arrival' | 'exceptional'>('arrival');
  const [companyId, setCompanyId] = useState('');
  const [ref, setRef] = useState('');
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="cash stand-in" />;
  const companyName = (id: string) => me.companies.find((c) => c.id === id)?.name ?? id;
  const send = (body: Record<string, unknown>, ok: string) => act.run(() => api.setCashStandIn(body), ok);
  const why = reason.trim().length >= 5;
  return (
    <Card
      title="Cash: Finance Director stands in"
      sub="Cash decisions are the CEO's. The Finance Director can decide only while this is on: for dates the CEO is away, or for one named request. Each FD decision needs a reason, and it is listed here for the CEO."
      actions={data.activeWindow ? <Chip tone="warn">On until {data.activeWindow.to}</Chip> : <Chip tone="ok">Off</Chip>}
    >
      <div className="hx-stack-tight">
        <ErrorNotice error={act.error} />
        {data.unseen.length > 0 && (
          <>
            <h3 className="hx-form-title">Decided by the Finance Director</h3>
            <ul className="hx-rows">
              {data.unseen.map((u) => (
                <li key={u.id} className="hx-row">
                  <div className="hx-row-main">
                    <span className="hx-row-title">
                      {u.kind === 'arrival' ? 'Arrival cash' : 'Exceptional guard cash'} {u.ref}, RM{u.amount.toFixed(2)}
                    </span>
                    <span className="hx-row-meta">
                      {companyName(u.companyId)} · {u.by}: {u.reason}
                    </span>
                  </div>
                  <div className="hx-row-side">
                    <Chip tone={u.approved ? 'ok' : 'crit'}>{u.approved ? 'Approved' : 'Refused'}</Chip>
                  </div>
                </li>
              ))}
            </ul>
            {data.canSet && (
              <div>
                <button className="btn btn-sm" disabled={act.busy} onClick={() => send({ action: 'seen', id: 'all' }, 'Marked as seen.')}>
                  Mark as seen
                </button>
              </div>
            )}
          </>
        )}
        {data.requests.length > 0 && (
          <p className="small">
            Named requests: {data.requests.map((r) => `${r.ref} (${companyName(r.companyId)})`).join(', ')}
          </p>
        )}
        {data.canSet && (
          <>
            <label className="field">
              <span className="label">Reason (needed, 5 characters or more)</span>
              <input className="input" aria-label="Reason" placeholder="For example: CEO overseas 20 to 24 Nov" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="hx-form">
              <h3 className="hx-form-title">While I am away</h3>
              <div className="hx-form-grid">
                <label className="field">
                  <span className="label">From</span>
                  <input className="input" type="date" aria-label="Away from" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="field">
                  <span className="label">To</span>
                  <input className="input" type="date" aria-label="Away to" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
              <div className="hx-form-actions">
                <button className="btn btn-sm btn-primary" disabled={act.busy || !why || !from || !to} onClick={() => send({ action: 'away', from, to, reason }, 'Stand-in on for those dates.')}>
                  On while I am away
                </button>
                {data.activeWindow && (
                  <button className="btn btn-ghost btn-sm" disabled={act.busy || !why} onClick={() => send({ action: 'end', id: data.activeWindow!.id, reason }, 'Stand-in ended.')}>
                    End now
                  </button>
                )}
              </div>
            </div>
            <div className="hx-form">
              <h3 className="hx-form-title">One named request</h3>
              <div className="hx-form-grid">
                <label className="field">
                  <span className="label">Kind of cash</span>
                  <Select className="select" aria-label="Kind of cash" value={kind} onChange={(e) => setKind(e.target.value as 'arrival' | 'exceptional')}>
                    <option value="arrival">Arrival cash</option>
                    <option value="exceptional">Exceptional guard cash</option>
                  </Select>
                </label>
                <label className="field">
                  <span className="label">Company</span>
                  <Select className="select" aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                    <option value="">Choose</option>
                    {me.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="field">
                  <span className="label">Request reference</span>
                  <input className="input" aria-label="Request reference" placeholder="As shown on the request" value={ref} onChange={(e) => setRef(e.target.value)} />
                </label>
              </div>
              <div className="hx-form-actions">
                <button className="btn btn-sm" disabled={act.busy || !why || !ref || !companyId} onClick={() => send({ action: 'request', kind, companyId, ref, reason }, 'The FD can decide that request.')}>
                  FD decides this one
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
