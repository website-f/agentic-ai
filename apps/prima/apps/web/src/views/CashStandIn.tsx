import { useState } from 'react';
import { api } from '../api';
import { Select } from '../SearchSelect';
import { Chip, ErrorNotice, dateLabel, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/pay-p100.css';

/**
 * P100 B2 (Fauzan, 11 Nov 2026: "the FD can stand in for the CEO when needed"): cash decisions stay the CEO's. The CEO
 * turns a stand-in on here, for dates away or one named request, with a reason; the Finance Director then decides in the
 * CEO's place, with a reason, never on a request they made, and the CEO sees each decision here.
 */
type View = {
  canSet: boolean;
  standsIn: boolean;
  onNow: boolean;
  active: { id: string; kind: 'dates' | 'request'; from: string | null; to: string | null; request: { area: string; companyId: string; ref: string } | null; reason: string; set: { by: string; at: string } }[];
  past: { id: string; kind: string; from: string | null; to: string | null; request: { ref: string } | null; reason: string; ended: { by: string; reason: string } | null }[];
  unseen: { standInId: string; at: string; area: string; ref: string; by: string; decision: string; amount: number; reason: string }[];
};
const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const AREA: Record<string, string> = { arrival: 'Arrival cash advance', exceptional: 'Exceptional guard cash' };

export function CashStandIn({ companyId }: { companyId?: string }) {
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => api.payView('cash-stand-in', {}) as Promise<View>, [tick]);
  const act = useAction();
  const [kind, setKind] = useState<'dates' | 'request'>('dates');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [area, setArea] = useState('arrival');
  const [ref, setRef] = useState('');
  const [reason, setReason] = useState('');
  const [ending, setEnding] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  if (error || !data) return null;
  const run = async (action: string, body: Record<string, unknown>, msg: string) => {
    if (await act.run(() => api.payAction(`cash-stand-in-${action}`, body), msg)) {
      setReason('');
      setRef('');
      setEnding(null);
      setWhy('');
      setTick((n) => n + 1);
    }
  };
  const ready = reason.trim().length >= 5 && (kind === 'dates' ? !!from && !!to && to >= from : !!ref.trim() && !!companyId);
  return (
    <section className="pp-card" aria-labelledby="csi-h" data-testid="cash-stand-in">
      <header className="pp-card-head">
        <div>
          <h2 id="csi-h">Finance Director stands in for the CEO</h2>
          <p>
            {data.canSet
              ? 'Cash decisions are yours. Let the FD decide while you are away, or for one request. The FD gives a reason and you are told of every decision.'
              : 'You may decide cash in the CEO’s place only while the CEO has turned this on. Give a reason; the CEO is told. Never on a request you made.'}
          </p>
        </div>
        <Chip tone={data.onNow ? 'warn' : 'neutral'}>{data.onNow ? 'Stand-in on' : 'Stand-in off'}</Chip>
      </header>
      {data.unseen.length > 0 && (
        <div className="pp-notices" role="status">
          <strong>{data.unseen.length === 1 ? '1 decision the FD made for you' : `${data.unseen.length} decisions the FD made for you`}</strong>
          <ul>
            {data.unseen.map((u) => (
              <li key={`${u.standInId}-${u.ref}`}>
                {dateTimeLabel(u.at)} · {AREA[u.area] ?? u.area} {u.ref}: {u.decision === 'approved' ? 'approved' : 'refused'} {rm(u.amount)} by {u.by}. {u.reason}
              </li>
            ))}
          </ul>
          {data.canSet && (
            <button className="btn btn-sm" disabled={act.busy} onClick={() => Promise.all([...new Set(data.unseen.map((u) => u.standInId))].map((id) => api.payAction('cash-stand-in-seen', { id }))).then(() => setTick((n) => n + 1))}>
              Mark seen
            </button>
          )}
        </div>
      )}
      {data.active.length > 0 ? (
        <ul className="pp-people">
          {data.active.map((s) => (
            <li key={s.id} className="pp-person">
              <div className="pp-person-text">
                <span className="pp-person-name">
                  {s.kind === 'dates' ? `Away ${dateLabel(s.from)} to ${dateLabel(s.to)}` : `${AREA[s.request?.area ?? ''] ?? ''} ${s.request?.ref ?? ''}`}
                </span>
                <span className="pp-person-why">
                  Set by {s.set.by} on {dateTimeLabel(s.set.at)}: {s.reason}
                </span>
              </div>
              {data.canSet &&
                (ending === s.id ? (
                  <div className="pp-inline-form">
                    <input className="input" aria-label="Reason for ending" placeholder="Reason for ending" value={why} onChange={(e) => setWhy(e.target.value)} />
                    <button className="btn btn-sm" disabled={act.busy || why.trim().length < 5} onClick={() => run('end', { id: s.id, reason: why }, 'Stand-in ended.')}>
                      End now
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => setEnding(s.id)}>
                    End
                  </button>
                ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{data.canSet ? 'No stand-in is on. Only you decide cash.' : 'No stand-in is on. Only the CEO decides cash.'}</p>
      )}
      {data.canSet && (
        <div className="pp-name-form">
          <label className="pp-field">
            <span>For</span>
            <Select value={kind} onChange={(e) => setKind(e.target.value as 'dates' | 'request')} aria-label="Stand-in for">
              <option value="dates">Dates I am away</option>
              {companyId && <option value="request">One request</option>}
            </Select>
          </label>
          {kind === 'dates' ? (
            <>
              <label className="pp-field">
                <span>First day away</span>
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="pp-field">
                <span>Last day away</span>
                <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="pp-field">
                <span>Cash type</span>
                <Select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Cash type">
                  <option value="arrival">Arrival cash advance</option>
                  <option value="exceptional">Exceptional guard cash</option>
                </Select>
              </label>
              <label className="pp-field">
                <span>Request reference</span>
                <input className="input" value={ref} placeholder="Request or approval reference" onChange={(e) => setRef(e.target.value)} />
              </label>
            </>
          )}
          <label className="pp-field">
            <span>Reason</span>
            <input className="input" value={reason} placeholder="Why the FD stands in (at least 5 letters)" onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            className="btn btn-primary"
            disabled={act.busy || !ready}
            onClick={() => run('set', kind === 'dates' ? { kind, from, to, reason } : { kind, area, companyId, ref, reason }, 'Stand-in on. The FD may now decide in your place.')}
          >
            Turn stand-in on
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}
