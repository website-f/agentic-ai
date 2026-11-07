import { useState } from 'react';
import { api, type PublicHolidayBoard } from '../api';
import { Chip, ErrorNotice, Loading, dateTimeLabel, useAction, useLoad } from '../ui';

/**
 * Public holidays (Fauzan, 6 Nov 2026): the Operations Director or the OGM (not the OM) sets each company's 11 public holidays for the year by
 * 10 December. A guard not working on a holiday is still paid one normal day (7.5 hours). Employment Act s.60D.
 */

type Place = PublicHolidayBoard['company'];
type Day = { date: string; label: string };

const COMPULSORY: Day[] = [
  { date: '05-01', label: 'Labour Day' },
  { date: '', label: "Yang di-Pertuan Agong's birthday" },
  { date: '', label: "Ruler's birthday or Federal Territory Day" },
  { date: '08-31', label: 'National Day' },
  { date: '09-16', label: 'Malaysia Day' },
];

export function PublicHolidaysPanel({ companyId, onCompany }: { companyId: string | null; onCompany: (id: string) => void }) {
  const [year, setYear] = useState<number | null>(null);
  const { data, error } = useLoad(() => api.publicHolidayBoard({ companyId, year }), [companyId, year]);
  if (error) return <p className="muted">{error}</p>;
  if (!data) return <Loading what="public holidays" />;
  const places: Place[] = [data.company, ...data.states];
  return (
    <div>
      <p className="muted">
        Each company has 11 paid public holidays a year (Employment Act s.60D), five of them Labour Day, the Agong&apos;s birthday, the Ruler&apos;s
        birthday or Federal Territory Day, National Day and Malaysia Day. The Operations Director or the OGM sets next year&apos;s list
        by 10 December. A guard not working on a holiday is still paid one normal day (7.5 hours). A holiday on the guard&apos;s rest day moves to
        the next working day; a holiday during leave is not a leave day; a guard absent without leave on the working day just before or after
        loses that holiday&apos;s pay.
      </p>
      {!data.ready && (
        <p className="notice" data-tone="warn">
          Public holiday lists are not switched on in this database yet. Nothing can be set until the pay formulas module is installed with
          approval.
        </p>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
        <select className="input" aria-label="Company" value={data.companyId} onChange={(e) => onCompany(e.target.value)}>
          {data.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Year" value={data.year} onChange={(e) => setYear(Number(e.target.value))}>
          {data.years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <Chip tone={data.missing.length ? (data.due.late ? 'crit' : 'warn') : 'ok'}>
          {data.missing.length ? `Missing for ${data.missing.join(', ')} · due ${data.due.dueOn}` : `Set for every state · due ${data.due.dueOn}`}
        </Chip>
      </div>
      {places.map((p) => (
        <PlaceCard key={p.state ?? 'all'} p={p} board={data} />
      ))}
      {data.history.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <h2>Earlier versions</h2>
          </div>
          <div className="list">
            {data.history.map((l) => (
              <div key={l.id} className="list-item small">
                {l.state ?? 'Whole company'} v{l.version}: {l.setBy}, {dateTimeLabel(l.setAt)}. {l.reason}
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="muted small">
        Rule {data.rule.id}: {data.rule.source}
      </p>
    </div>
  );
}

function PlaceCard({ p, board }: { p: Place; board: PublicHolidayBoard }) {
  const [editing, setEditing] = useState(false);
  const title = p.state ?? 'Whole company (used where a state has no list of its own)';
  const l = p.inForce;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {l ? (
          <Chip tone={p.check?.flags.length ? 'warn' : 'ok'}>{p.fromCompanyList ? 'Uses the whole-company list' : `Set, version ${l.version}`}</Chip>
        ) : (
          <Chip tone={p.state ? (board.due.late ? 'crit' : 'warn') : 'info'}>Not set</Chip>
        )}
      </div>
      {l && p.fromCompanyList && !editing && <div className="muted small">Same days as the whole-company list above. Set a list here only if this state's holidays differ.</div>}
      {l && !p.fromCompanyList && !editing && (
        <>
          <table className="table small">
            <tbody>
              {l.days.map((d) => (
                <tr key={d.date}>
                  <td style={{ whiteSpace: 'nowrap' }}>{d.date}</td>
                  <td>{d.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted small">
            {l.setBy}, {dateTimeLabel(l.setAt)}: {l.reason}
          </div>
          {p.check?.flags.map((f) => (
            <p key={f} className="notice small" data-tone="warn">
              {f}
            </p>
          ))}
        </>
      )}
      {p.canSet && !editing && (
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
          {p.list ? 'Change the list' : 'Set the 11 public holidays'}
        </button>
      )}
      {editing && <HolidayForm p={p} board={board} onDone={() => setEditing(false)} />}
    </section>
  );
}

function HolidayForm({ p, board, onDone }: { p: Place; board: PublicHolidayBoard; onDone: () => void }) {
  const start: Day[] = p.list
    ? p.list.days.map((d) => ({ ...d }))
    : p.inForce
      ? p.inForce.days.map((d) => ({ ...d }))
      : [...COMPULSORY.map((d) => ({ date: d.date ? `${board.year}-${d.date}` : '', label: d.label })), ...Array.from({ length: 6 }, () => ({ date: '', label: '' }))];
  const [days, setDays] = useState<Day[]>(start);
  const [reason, setReason] = useState('');
  const act = useAction();
  const set = (i: number, k: keyof Day, v: string) => setDays(days.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  return (
    <div style={{ marginTop: 8 }}>
      <div className="muted small">Enter the {board.year} dates from the gazette for {p.state ?? 'the company'}.</div>
      {days.map((d, i) => (
        <div key={i} style={{ display: 'grid', gap: 6, gridTemplateColumns: 'minmax(140px, 180px) 1fr auto', marginTop: 6 }}>
          <input className="input" type="date" aria-label={`Date ${i + 1}`} min={`${board.year}-01-01`} max={`${board.year}-12-31`} value={d.date} onChange={(e) => set(i, 'date', e.target.value)} />
          <input className="input" aria-label={`Holiday ${i + 1}`} placeholder="Holiday name" value={d.label} onChange={(e) => set(i, 'label', e.target.value)} />
          <button className="btn btn-sm btn-ghost" aria-label={`Remove ${i + 1}`} onClick={() => setDays(days.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => setDays([...days, { date: '', label: '' }])}>
        Add a day (government-declared extra holiday)
      </button>
      <div className="small" style={{ marginTop: 4 }}>
        {days.filter((d) => d.date).length} of 11 entered
      </div>
      <input className="input" style={{ marginTop: 8, display: 'block', width: '100%', boxSizing: 'border-box' }} aria-label="Reason" placeholder="Reason (kept with the list)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={() =>
            act.run(() => api.setPublicHolidays({ companyId: board.companyId, year: board.year, state: p.state, days: days.filter((d) => d.date || d.label), reason }), 'Public holidays saved.').then((r) => {
              if (r) onDone();
            })
          }
        >
          Save the public holidays
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
