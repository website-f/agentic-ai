import { useState } from 'react';
import { api, type FinControls, type FinDesk } from '../api';
import { Chip, ErrorNotice, dateLabel, useAction, type Tone } from '../ui';

/**
 * Intercompany balances agreed on both sides every month, and the 13-week cash forecast (Fauzan, 2 Nov 2026:
 * suggestions 12 and 13).
 */

type Co = FinDesk['companies'][number];
type Pair = FinControls['intercompany']['pairs'][number];
const rm = (n: number | null | undefined) => (n == null ? '–' : `RM${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const KIND: Record<string, string> = { management_fee: 'Management fee', recharge: 'Recharges', loan: 'Loan', other: 'Other' };
const STATUS: Record<Pair['status'], [Tone, string]> = {
  agreed: ['ok', 'Agreed'],
  explained: ['info', 'Difference explained'],
  missing: ['warn', 'Waiting for a side'],
  differs: ['crit', 'Sides differ'],
};

export function Intercompany({ v, co }: { v: FinControls; co: Co }) {
  const ic = v.intercompany;
  const act = useAction();
  const [f, setF] = useState({ period: ic.periods[0], withId: ic.companies[0]?.id ?? '', kind: 'management_fee', side: 'owed', amount: 0, sqlRef: '' });
  const [explain, setExplain] = useState<{ key: string; comment: string } | null>(null);
  const go = (action: string, input: Record<string, unknown>, msg: string) =>
    act.run(() => api.finControlAction(co.companyId, 'intercompany', action, input), msg);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Intercompany balances</h3>
          <div className="muted small">
            Each month, record this company&apos;s balance in SQL Account with each other group company (management fees, recharges, loans). Both sides must
            come to RM0.00. A difference is corrected in SQL Account, or explained by a reviewer who entered neither side (up to {rm(ic.explainMax)}). Anything
            not agreed stops both companies&apos; close.
          </div>
        </div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <select className="select" aria-label="Month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
          {ic.periods.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select className="select" aria-label="Other company" value={f.withId} onChange={(e) => setF({ ...f, withId: e.target.value })}>
          {ic.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(KIND).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Who owes" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}>
          <option value="owed">They owe us</option>
          <option value="owe">We owe them</option>
        </select>
        <input
          className="input"
          type="number"
          step="0.01"
          aria-label="Balance RM"
          placeholder="Balance RM"
          value={f.amount || ''}
          onChange={(e) => setF({ ...f, amount: Math.abs(Number(e.target.value)) || 0 })}
        />
        <input
          className="input"
          aria-label="SQL Account account"
          placeholder="SQL Account account or document"
          value={f.sqlRef}
          onChange={(e) => setF({ ...f, sqlRef: e.target.value })}
        />
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || !f.withId || !f.sqlRef.trim()}
          onClick={() =>
            go('record', { period: f.period, withId: f.withId, kind: f.kind, balance: f.side === 'owe' ? -f.amount : f.amount, sqlRef: f.sqlRef }, 'Recorded.')
          }
        >
          Record
        </button>
      </div>
      <ErrorNotice error={act.error} />
      <div className="list">
        {ic.pairs.length === 0 && <div className="empty">No intercompany balances recorded for the last three months.</div>}
        {ic.pairs.map((p) => {
          const key = `${p.period}|${p.withId}|${p.kind}`;
          const [tone, label] = STATUS[p.status];
          return (
            <div key={key} className="list-item" style={{ display: 'block' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong>
                    {p.period} · {p.with} · {KIND[p.kind]}
                  </strong>
                  <div className="muted small">
                    Ours:{' '}
                    {p.mine
                      ? `${rm(p.mine.balance)} (${p.mine.sqlRef}, ${p.mine.by})`
                      : p.carried
                        ? 'not recorded (there was a balance last month)'
                        : 'not recorded'}{' '}
                    · Theirs: {p.theirs ? `${rm(p.theirs.balance)} (${p.theirs.sqlRef}, ${p.theirs.by})` : 'not recorded'}
                    {p.difference != null && Math.abs(p.difference) >= 0.005 ? ` · difference ${rm(p.difference)}` : ''}
                    {p.explained ? ` · explained by ${p.explained.by}: ${p.explained.reason}` : ''}
                  </div>
                </div>
                <Chip tone={tone}>{label}</Chip>
              </div>
              {p.status === 'differs' && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {explain?.key === key ? (
                    <>
                      <input
                        className="input"
                        aria-label="Why the sides differ"
                        placeholder="Why the sides differ (for example a credit note booked next month)"
                        value={explain.comment}
                        onChange={(e) => setExplain({ key, comment: e.target.value })}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={act.busy}
                        onClick={() =>
                          go('explain', { period: p.period, withId: p.withId, kind: p.kind, comment: explain.comment }, 'Explained.').then(
                            (x) => x && setExplain(null),
                          )
                        }
                      >
                        Save
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setExplain({ key, comment: '' })}>
                      Explain the difference (reviewer)
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CashForecast({ v, co }: { v: FinControls; co: Co }) {
  const c = v.cash13;
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ direction: 'in', on: '', amount: 0, label: '', every: '', until: '' });
  const [review, setReview] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const go = (action: string, input: Record<string, unknown>, msg: string) => act.run(() => api.finControlAction(co.companyId, 'cash13', action, input), msg);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>13-week cash forecast</h3>
          <div className="muted small">
            Filled by Prima from the last bank statements, open payments, regular payments (EPF, PERKESO, PCB and HRD on the 15th), the staff payroll, daily
            cash and government claims. Add what Prima cannot know, such as client collections or the guard payroll from JA.
            {c.noStatement.length > 0 && ` No statement loaded yet for: ${c.noStatement.join(', ')} (counted as RM0.00).`}
          </div>
        </div>
        {!adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            Add a line
          </button>
        )}
      </div>
      {c.firstShort && (
        <div className="notice" data-tone="crit" role="status">
          Short of cash from the week of {dateLabel(c.firstShort.from)}: {rm(c.firstShort.closing)}. Lowest point {rm(c.lowest)}.
        </div>
      )}
      {adding && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <select className="select" aria-label="In or out" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
          <input className="input" type="date" aria-label="Date expected" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
          <input
            className="input"
            type="number"
            step="0.01"
            aria-label="Amount RM"
            placeholder="Amount RM"
            value={f.amount || ''}
            onChange={(e) => setF({ ...f, amount: Number(e.target.value) || 0 })}
          />
          <input className="input" aria-label="What it is" placeholder="What it is" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <select className="select" aria-label="Repeats" value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })}>
            <option value="">Once</option>
            <option value="week">Every week</option>
            <option value="month">Every month</option>
          </select>
          {f.every && <input className="input" type="date" aria-label="Repeat until" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} />}
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !f.on || !f.amount || !f.label.trim()}
            onClick={() => go('add', { ...f, every: f.every || null }, 'Added to the forecast.').then((x) => x && setAdding(false))}
          >
            Save
          </button>
        </div>
      )}
      <ErrorNotice error={act.error} />
      <div style={{ overflowX: 'auto' }}>
        <table className="table small">
          <thead>
            <tr>
              <th>Week of</th>
              <th style={{ textAlign: 'right' }}>Opening</th>
              <th style={{ textAlign: 'right' }}>In</th>
              <th style={{ textAlign: 'right' }}>Out</th>
              <th style={{ textAlign: 'right' }}>Closing</th>
            </tr>
          </thead>
          <tbody>
            {c.weeks.map((w) => (
              <tr key={w.week} onClick={() => setOpen(open === w.week ? null : w.week)} style={{ cursor: 'pointer' }}>
                <td>
                  {dateLabel(w.from)}
                  {open === w.week && (
                    <div className="muted">
                      {[
                        ...w.ins.map((x) => `+ ${rm(x.amount)} ${x.label}`),
                        ...w.outs.map((x) => `− ${rm(x.amount)} ${x.label}${x.estimate ? ' (estimate)' : ''}${x.overdue ? ' (overdue)' : ''}`),
                      ].map((t, i) => (
                        <div key={i}>{t}</div>
                      ))}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{rm(w.opening)}</td>
                <td style={{ textAlign: 'right' }}>{rm(w.moneyIn)}</td>
                <td style={{ textAlign: 'right' }}>{rm(w.moneyOut)}</td>
                <td style={{ textAlign: 'right', color: w.closing < 0 ? 'var(--crit, #b3261e)' : undefined }}>{rm(w.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted small">Press a week to see what is in it.</div>
      {c.lines.length > 0 && (
        <div className="muted small" style={{ marginTop: 6 }}>
          Lines added by Finance:{' '}
          {c.lines.map((l) => (
            <span key={l.id}>
              {l.direction === 'in' ? '+' : '−'} {rm(l.amount)} {l.label} ({dateLabel(l.on)}
              {l.repeat ? `, every ${l.repeat.every} to ${dateLabel(l.repeat.until)}` : ''}){' '}
              <button
                className="btn btn-sm"
                disabled={act.busy}
                onClick={() => go('remove', { lineId: l.id, comment: 'No longer expected (removed from the forecast screen)' }, 'Removed.')}
              >
                Remove
              </button>{' '}
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <span className="muted small">
          {c.review ? `Last reviewed by ${c.review.by} on ${dateLabel(c.review.at.slice(0, 10))}: ${c.review.comment}` : 'Not reviewed yet.'}
          {c.reviewDue ? ' Review due this week.' : ''}
        </span>
        <input
          className="input"
          aria-label="Review comment"
          placeholder="Review comment (reviewers)"
          value={review}
          onChange={(e) => setReview(e.target.value)}
        />
        <button
          className="btn btn-sm"
          disabled={act.busy || !review.trim()}
          onClick={() => go('review', { comment: review }, 'Reviewed.').then((x) => x && setReview(''))}
        >
          Reviewed
        </button>
      </div>
    </section>
  );
}
