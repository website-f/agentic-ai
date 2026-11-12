import { useState } from 'react';
import { api, type RateBook } from '../api';
import { useApp, type ViewName } from '../App';
import { ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';
import '../styles/fin-monitor.css';

/**
 * C5 rate book (Fauzan, 11 Nov 2026: "rates for all things can be set in the system, not predetermined, from now",
 * because prices sometimes change every month). The costing rates per guard that quotations and site profit use, per
 * company, entered by the Finance Director or the CEO from a month with a reason; every change is kept and a month
 * already costed keeps the rate in force then. No rate shows "Rate not set", never zero. Below them, every other rate
 * list in Prima, who enters it and where.
 */

type Data = RateBook;
type Key = Data['keys'][number]['key'] | Data['targetKey']['key'];
type InForce = Data['companies'][number]['rates'][number]['now'];

const rm = (n: number) => `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Head({ onEnter }: { onEnter?: () => void }) {
  return (
    <header className="k-head fm-head">
      <div className="k-head-text">
        <h1>Rate book</h1>
        <p className="k-head-sub">
          The rates Prima uses to cost quotations and site profit. The Finance Director or the CEO enters each rate from a month, with a reason. A
          month already costed keeps the rate that was in force then. Where no rate is entered Prima shows Rate not set, never zero.
        </p>
      </div>
      {onEnter && (
        <div className="k-head-actions">
          <button type="button" className="btn btn-primary" onClick={onEnter}>
            Enter a rate
          </button>
        </div>
      )}
    </header>
  );
}

function RateCell({ r }: { r: InForce }) {
  if (!r) return <span className="fm-notset">Rate not set</span>;
  return (
    <>
      <strong>{rm(r.amount)}</strong>
      <span className="fm-sub">
        {r.scope === 'group' ? 'Every company' : 'This company'} · from <span data-no-translate>{r.from}</span>
      </span>
    </>
  );
}

export function RateBookView() {
  const [n, setN] = useState(0);
  const { data, error, reload } = useLoad(() => api.rateBook(), [n]);
  const [entering, setEntering] = useState(false);
  const [q, setQ] = useState('');
  if (error)
    return (
      <div className="page fm-page">
        <Head />
        <div className="notice" data-tone="crit" role="alert">
          <span>The rate book could not be loaded. {error}</span>{' '}
          <button type="button" className="btn btn-sm" onClick={reload}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="page fm-page">
        <Head />
        <Loading what="the rate book" />
      </div>
    );
  const shown = data.companies.filter((c) => !q.trim() || c.companyName.toLowerCase().includes(q.trim().toLowerCase()));
  const total = data.companies.length;
  return (
    <div className="page fm-page">
      <Head onEnter={data.canSet && !entering ? () => setEntering(true) : undefined} />
      <div className="fm-tiles">
        {data.keys.map((k) => {
          const set = data.companies.filter((c) => c.rates.find((r) => r.key === k.key)?.now).length;
          return (
            <div key={k.key} className="fm-tile" data-tone={set < total ? 'unknown' : undefined}>
              <span className="fm-tile-label">{k.label}</span>
              <span className="fm-tile-value">
                {set} / {total}
              </span>
              <span className="fm-tile-note">{set < total ? 'Companies with the rate set this month' : 'Set for every company this month'}</span>
            </div>
          );
        })}
      </div>
      {entering && data.canSet && (
        <EnterRate
          data={data}
          onClose={() => setEntering(false)}
          onSaved={() => {
            setEntering(false);
            setN((x) => x + 1);
          }}
        />
      )}
      <section className="fm-card" aria-labelledby="fm-rates-h">
        <div className="fm-card-head">
          <div>
            <h2 id="fm-rates-h">Cost per guard, this month</h2>
            <p>
              Hostel and transport count for Nepali guards; uniform and equipment for every guard. Quotations and site profit use the rate in force
              for their month.
            </p>
          </div>
        </div>
        <div className="fm-card-body">
          <div className="fm-tools">
            <input className="input" aria-label="Find a company" placeholder="Find a company" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {total === 0 ? (
            <p className="muted">No company has Finance books yet. The Finance Director starts them in Finance, Settings.</p>
          ) : shown.length === 0 ? (
            <p className="muted">No company matches this.</p>
          ) : (
            <div className="fm-table-wrap">
              <table className="fm-table">
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    {data.keys.map((k) => (
                      <th key={k.key} scope="col">
                        {k.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.companyId}>
                      <th scope="row">{c.companyName}</th>
                      {c.rates.map((r) => (
                        <td key={r.key}>
                          <RateCell r={r.now} />
                          {r.later.length > 0 && (
                            <span className="fm-sub">
                              Next: {r.later[0].amount == null ? 'Rate not set' : rm(r.later[0].amount)} from <span data-no-translate>{r.later[0].from}</span>
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <section className="fm-card" aria-labelledby="fm-target-h">
        <div className="fm-card-head">
          <div>
            <h2 id="fm-target-h">Target margin per site</h2>
            <p>The margin each site should make, as a % of its revenue. Profit per site flags a site below it. No target is preset: until one is set the screen says Target not set.</p>
          </div>
        </div>
        <div className="fm-card-body">
          <ul className="fm-list">
            {shown.map((c) => (
              <li key={c.companyId}>
                <span className="fm-list-main">
                  <strong>{c.companyName}</strong>
                  {c.target.now ? (
                    <span>
                      {c.target.now.amount}% · {c.target.now.scope === 'group' ? 'Every company' : 'This company'} · from <span data-no-translate>{c.target.now.from}</span>
                    </span>
                  ) : (
                    <span>
                      <span className="fm-notset">Target not set</span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <OtherLists data={data} />
      <section className="fm-card" aria-labelledby="fm-hist-h">
        <div className="fm-card-head">
          <div>
            <h2 id="fm-hist-h">Changes</h2>
            <p>Every rate entered, newest first, with who entered it and why. Nothing is deleted.</p>
          </div>
        </div>
        <div className="fm-card-body">
          {data.history.length === 0 ? (
            <p className="muted">No rate entered yet.</p>
          ) : (
            <ul className="fm-list">
              {data.history.map((h, i) => (
                <li key={`${h.at}-${h.key}-${h.companyId ?? 'all'}-${i}`}>
                  <span className="fm-list-main">
                    <strong>
                      {[...data.keys, data.targetKey].find((k) => k.key === h.key)?.label}:{' '}
                      {h.amount == null ? (h.scope === 'group' ? 'Rate not set' : 'Back to the rate for every company') : h.key === 'target_margin' ? `${h.amount}%` : rm(h.amount)}
                    </strong>
                    <span>
                      {h.companyName} · from <span data-no-translate>{h.from}</span> · {h.by}, {dateTimeLabel(h.at)}
                    </span>
                    <span>{h.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function OtherLists({ data }: { data: Data }) {
  const { go } = useApp();
  return (
    <section className="fm-card" aria-labelledby="fm-other-h">
      <div className="fm-card-head">
        <div>
          <h2 id="fm-other-h">Other rate lists</h2>
          <p>Each is entered by its owner on its own screen, from a date, with the history kept. None is preset.</p>
        </div>
      </div>
      <div className="fm-card-body">
        <ul className="fm-list">
          {data.others.map((o) => (
            <li key={o.id}>
              <span className="fm-list-main">
                <strong>{o.title}</strong>
                <span>
                  Entered by the {o.owner} · {o.where}
                </span>
                {o.status ? (
                  o.status.set ? (
                    <span>{o.status.text}</span>
                  ) : (
                    <span>
                      <span className="fm-notset">{o.status.text}</span>
                    </span>
                  )
                ) : (
                  <span>Kept on its own screen</span>
                )}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => go({ view: o.view as ViewName })}>
                Open
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function EnterRate({ data, onClose, onSaved }: { data: Data; onClose: () => void; onSaved: () => void }) {
  const act = useAction();
  const [key, setKey] = useState<Key>(data.keys[0].key);
  const [companyId, setCompanyId] = useState('all');
  const [from, setFrom] = useState(data.month);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const amountOk = amount.trim() === '' || (/^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) >= 0);
  const fromOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(from) && from >= data.earliestFrom;
  const save = async () => {
    const r = await act.run(
      () => api.setRate({ key, companyId, from, amount: amount.trim() === '' ? null : Number(amount), reason: reason.trim() }),
      'Rate saved.',
    );
    if (r) onSaved();
  };
  return (
    <section className="fm-card" aria-labelledby="fm-enter-h">
      <div className="fm-card-head">
        <div>
          <h2 id="fm-enter-h">Enter a rate</h2>
          <p>
            It applies from the month you choose (last month at the earliest). Leave the amount empty to mark it not set, or, for one company, to go
            back to the rate for every company. Enter 0 only for a real no-cost.
          </p>
        </div>
      </div>
      <div className="fm-card-body">
        <div className="fm-form">
          <label className="field">
            <span className="label">Rate</span>
            <select className="select" value={key} onChange={(e) => setKey(e.target.value as Key)}>
              {[...data.keys, data.targetKey].map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">For</span>
            <select className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="all">Every company</option>
              {data.companies.map((c) => (
                <option key={c.companyId} value={c.companyId}>
                  {c.companyName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Starts from (month)</span>
            <input className="input" type="month" min={data.earliestFrom} value={from} aria-invalid={!fromOk} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">{[...data.keys, data.targetKey].find((k) => k.key === key)?.unit}</span>
            <input className="input" inputMode="decimal" placeholder="Rate not set" value={amount} aria-invalid={!amountOk} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field fm-span">
            <span className="label">Reason (needed), for example the supplier quote or the hostel agreement</span>
            <textarea className="textarea" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <ErrorNotice error={act.error} />
        <div className="fm-actions">
          <button type="button" className="btn btn-primary" disabled={act.busy || !amountOk || !fromOk || reason.trim().length < 3} onClick={save}>
            {act.busy ? 'Saving…' : 'Save rate'}
          </button>
          <button type="button" className="btn" disabled={act.busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
