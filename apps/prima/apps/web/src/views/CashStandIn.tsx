import { Select } from '../SearchSelect';
import { useState } from 'react';
import { api } from '../api';
import { Chip, ErrorNotice, Loading, useAction, useLoad } from '../ui';

// B2 (Fauzan, 11 Nov 2026): "the FD can stand in for the CEO when needed" on cash (arrival cash and exceptional guard
// cash). The CEO turns it on for set dates while away, or for one named request; the FD's decisions come back here.

export function CashStandInPanel() {
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
  const send = (body: Record<string, unknown>, ok: string) => act.run(() => api.setCashStandIn(body), ok);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Cash: Finance Director stands in</h3>
        {data.activeWindow ? <Chip tone="warn">On until {data.activeWindow.to}</Chip> : <Chip tone="ok">Off</Chip>}
      </div>
      <p className="muted small">
        Cash decisions are the CEO's. The Finance Director can decide only while this is on: for dates the CEO is away, or
        for one named request. Each FD decision needs a reason, and it is listed here for the CEO.
      </p>
      <ErrorNotice error={act.error} />
      {data.unseen.length > 0 && (
        <div className="list">
          {data.unseen.map((u) => (
            <div key={u.id} className="list-item small">
              {u.by} {u.approved ? 'approved' : 'refused'} {u.kind === 'arrival' ? 'arrival cash' : 'exceptional guard cash'} {u.ref} ({u.companyId}), RM
              {u.amount.toFixed(2)}: {u.reason}
            </div>
          ))}
          {data.canSet && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => send({ action: 'seen', id: 'all' }, 'Marked as seen.')}>
              Mark as seen
            </button>
          )}
        </div>
      )}
      {data.requests.length > 0 && (
        <div className="small">
          Named requests: {data.requests.map((r) => `${r.ref} (${r.companyId})`).join(', ')}
        </div>
      )}
      {data.canSet && (
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          <input className="input" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn btn-sm" disabled={act.busy || reason.trim().length < 5} onClick={() => send({ action: 'away', from, to, reason }, 'Stand-in on for those dates.')}>
              On while I am away
            </button>
            {data.activeWindow && (
              <button className="btn btn-ghost btn-sm" disabled={act.busy || reason.trim().length < 5} onClick={() => send({ action: 'end', id: data.activeWindow!.id, reason }, 'Stand-in ended.')}>
                End now
              </button>
            )}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Select className="input" value={kind} onChange={(e) => setKind(e.target.value as 'arrival' | 'exceptional')}>
              <option value="arrival">Arrival cash</option>
              <option value="exceptional">Exceptional guard cash</option>
            </Select>
            <input className="input" placeholder="Company id" value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
            <input className="input" placeholder="Request reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            <button className="btn btn-sm" disabled={act.busy || reason.trim().length < 5 || !ref || !companyId} onClick={() => send({ action: 'request', kind, companyId, ref, reason }, 'The FD can decide that request.')}>
              FD decides this one
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
