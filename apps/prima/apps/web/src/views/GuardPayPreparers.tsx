import { useState } from 'react';
import { api, type GuardPayBoard } from '../api';
import { Select } from '../SearchSelect';
import { Chip, ErrorNotice, dateLabel, useAction } from '../ui';
import { Avatar } from '../kit';
import '../styles/pay-p100.css';

/**
 * P100 B1 (Fauzan, 11 Nov 2026): each company prepares its own guard pay run. The Company Manager names who prepares it
 * (with a reason, changeable later) and sees every run of the company; HR and the OMs no longer prepare. Everyone else
 * who sees the pay run sees who prepares each company.
 */
type Company = GuardPayBoard['preparers'][number];

export function GuardPayPreparers({ data, onChanged }: { data: GuardPayBoard; onChanged: () => void }) {
  const mine = data.preparers.filter((c) => c.canName);
  const [showAll, setShowAll] = useState(false);
  const others = data.preparers.filter((c) => !c.canName);
  if (!data.preparers.length) return null;
  const shown = showAll ? others : others.slice(0, 4);
  return (
    <section className="pp-card" aria-labelledby="gpp-h" data-testid="guard-pay-preparers">
      <header className="pp-card-head">
        <div>
          <h2 id="gpp-h">Who prepares the pay run</h2>
          <p>
            {mine.length
              ? 'Name who prepares your company’s guard pay. You see every month; the COO approves; you cannot name yourself.'
              : 'Each company prepares its own month: the person its Company Manager names. The COO approves.'}
          </p>
        </div>
        {data.preparing.length > 0 && <Chip tone="ok">You prepare</Chip>}
      </header>
      <div className="pp-companies">
        {mine.map((c) => (
          <CompanyPreparers key={c.companyId} c={c} onChanged={onChanged} />
        ))}
        {shown.map((c) => (
          <CompanyPreparers key={c.companyId} c={c} onChanged={onChanged} />
        ))}
      </div>
      {others.length > 4 && (
        <button className="btn btn-ghost btn-sm pp-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer companies' : `Show all ${others.length} companies`}
        </button>
      )}
    </section>
  );
}

function CompanyPreparers({ c, onChanged }: { c: Company; onChanged: () => void }) {
  const act = useAction();
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [whyRemove, setWhyRemove] = useState('');
  const active = c.preparers.filter((p) => p.active);
  const past = c.preparers.filter((p) => !p.active);
  const free = c.candidates.filter((x) => !active.some((p) => p.userId === x.id));
  const send = async (userId: string, action: 'name' | 'remove', why: string, msg: string) => {
    if (await act.run(() => api.payAction('guard-pay-preparer', { companyId: c.companyId, userId, action, reason: why }), msg)) {
      setPick('');
      setReason('');
      setRemoving(null);
      setWhyRemove('');
      onChanged();
    }
  };
  return (
    <div className="pp-company">
      <div className="pp-company-head">
        <strong>{c.companyName}</strong>
        {active.length ? <Chip tone="ok">{active.length === 1 ? '1 preparer' : `${active.length} preparers`}</Chip> : <Chip tone="warn">No preparer named</Chip>}
      </div>
      {active.length === 0 && (
        <p className="pp-blocked" role="note">
          {c.canName ? 'Nobody can prepare this company’s month until you name someone.' : 'Nobody can prepare this month until the Company Manager names someone.'}
        </p>
      )}
      <ul className="pp-people">
        {active.map((p) => (
          <li key={p.id} className="pp-person">
            <Avatar name={p.userName} size={36} />
            <div className="pp-person-text">
              <span className="pp-person-name">{p.userName}</span>
              <span className="pp-person-sub">{p.title}</span>
              <span className="pp-person-why">
                Named by {p.named.by} on {dateLabel(p.named.at.slice(0, 10))}: {p.named.reason}
              </span>
            </div>
            {c.canName &&
              (removing === p.userId ? (
                <div className="pp-inline-form">
                  <input className="input" aria-label="Reason for removing" placeholder="Reason for removing" value={whyRemove} onChange={(e) => setWhyRemove(e.target.value)} />
                  <button className="btn btn-sm" disabled={act.busy || whyRemove.trim().length < 5} onClick={() => send(p.userId, 'remove', whyRemove, 'Removed. They no longer prepare the pay run.')}>
                    Remove
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setRemoving(p.userId)}>
                  Remove
                </button>
              ))}
          </li>
        ))}
      </ul>
      {c.canName && (
        <div className="pp-name-form">
          {free.length ? (
            <>
              <label className="pp-field">
                <span>Person to prepare</span>
                <Select value={pick} onChange={(e) => setPick(e.target.value)} searchable aria-label="Person to prepare">
                  <option value="">Choose a person</option>
                  {free.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.title ? ` · ${x.title}` : ''}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="pp-field">
                <span>Reason</span>
                <input className="input" value={reason} placeholder="Why this person (at least 5 letters)" onChange={(e) => setReason(e.target.value)} />
              </label>
              <button className="btn btn-primary" disabled={act.busy || !pick || reason.trim().length < 5} onClick={() => send(pick, 'name', reason, 'Named. They can now prepare and submit the month.')}>
                Name preparer
              </button>
            </>
          ) : (
            <p className="muted small">Everyone who can prepare is already named. Only admin executives and managers of the company can be named.</p>
          )}
        </div>
      )}
      {past.length > 0 && (
        <details className="pp-history">
          <summary>Earlier preparers ({past.length})</summary>
          <ul>
            {past.map((p) => (
              <li key={p.id}>
                {p.userName}: removed by {p.removed?.by} on {dateLabel(p.removed?.at.slice(0, 10))}, {p.removed?.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ErrorNotice error={act.error} />
    </div>
  );
}
