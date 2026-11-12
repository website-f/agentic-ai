import { useState } from 'react';
import { api } from '../api';
import { Select } from '../SearchSelect';
import { Chip, ErrorNotice, dateLabel, useAction, useLoad } from '../ui';
import '../styles/pay-p100.css';

/**
 * P100 C12 + J3 (Fauzan, 11 Nov 2026): staff overtime inside the staff payroll, with the on/off switch HR controls (Staff
 * overtime setting), CMS control-room overtime brought in from the CMS roster. Each line is approved or refused by HR with
 * a reason (never their own); an approved line is paid once in the next payroll prepared, an unapproved one never.
 */
type Line = { id: string; name: string; date: string; hours: number; kind: string; source: 'claim' | 'cms'; reason: string; status: 'pending' | 'approved' | 'refused'; decided: { by: string; note: string } | null; paidIn: string | null };
type View = { enabled: boolean; rates: { normal: number; restDay: number; publicHoliday: number }; hoursPerDay: number; mayClaim: boolean; canDecide: boolean; canImport: boolean; mine: Line[]; lines: Line[] };
const KIND: Record<string, string> = { normal: 'Working day', restDay: 'Rest day', publicHoliday: 'Public holiday' };
const TONE = { pending: 'warn', approved: 'ok', refused: 'crit' } as const;
const STATUS = { pending: 'Waiting for HR', approved: 'Approved', refused: 'Refused' } as const;
const thisMonth = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);

export function StaffOvertime() {
  const [tick, setTick] = useState(0);
  const { data, error } = useLoad(() => api.payView('staff-ot', {}) as Promise<View>, [tick]);
  const act = useAction();
  const [month, setMonth] = useState(thisMonth());
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('');
  const [kind, setKind] = useState('normal');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [show, setShow] = useState<'pending' | 'all'>('pending');
  if (error || !data) return null;
  if (!data.canDecide && !data.mayClaim && !data.mine.length) return null;
  const go = async (action: string, body: Record<string, unknown>, msg: string) => {
    if (await act.run(() => api.payAction(action, body), msg)) {
      setReason('');
      setHours('');
      setTick((n) => n + 1);
    }
  };
  const lines = data.canDecide ? data.lines.filter((l) => show === 'all' || l.status === 'pending') : data.mine;
  return (
    <section className="pp-card" aria-labelledby="sot-h" data-testid="staff-overtime">
      <header className="pp-card-head">
        <div>
          <h2 id="sot-h">Overtime in the payroll</h2>
          <p>
            {data.enabled
              ? `HR's overtime switch is on: approved hours are paid once in the next payroll prepared, at ${data.rates.normal}x, ${data.rates.restDay}x and ${data.rates.publicHoliday}x the hourly rate (basic ÷ 26 ÷ ${data.hoursPerDay}). Unapproved hours are never paid.`
              : 'HR’s overtime switch is off: no overtime is paid in the payroll. HR turns it on and names the staff under Staff overtime.'}
          </p>
        </div>
        <Chip tone={data.enabled ? 'ok' : 'neutral'}>{data.enabled ? 'Overtime on' : 'Overtime off'}</Chip>
      </header>
      {data.canImport && data.enabled && (
        <div className="pp-name-form">
          <label className="pp-field">
            <span>CMS roster month</span>
            <input className="input" type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <button className="btn" disabled={act.busy || !month} onClick={() => go('ot-cms-import', { period: month }, 'CMS overtime brought in to approve.')}>
            Bring in CMS overtime
          </button>
        </div>
      )}
      {data.mayClaim && (
        <div className="pp-name-form">
          <label className="pp-field">
            <span>Day</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="pp-field">
            <span>Hours</span>
            <input className="input" inputMode="decimal" value={hours} placeholder="e.g. 2.5" onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="pp-field">
            <span>Kind of day</span>
            <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of day">
              <option value="normal">Working day</option>
              <option value="restDay">Rest day</option>
              <option value="publicHoliday">Public holiday</option>
            </Select>
          </label>
          <label className="pp-field">
            <span>What it was for</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={act.busy || !date || !(Number(hours) > 0) || reason.trim().length < 5} onClick={() => go('ot-claim', { date, hours: Number(hours), kind, reason }, 'Overtime claimed. HR approves it.')}>
            Claim overtime
          </button>
        </div>
      )}
      {data.canDecide && (
        <div className="tabbar" role="tablist" aria-label="Overtime lines">
          <button role="tab" aria-selected={show === 'pending'} onClick={() => setShow('pending')}>
            To approve ({data.lines.filter((l) => l.status === 'pending').length})
          </button>
          <button role="tab" aria-selected={show === 'all'} onClick={() => setShow('all')}>
            All ({data.lines.length})
          </button>
        </div>
      )}
      {lines.length ? (
        <ul className="pp-people">
          {lines.map((l) => (
            <li key={l.id} className="pp-person pp-ot">
              <div className="pp-person-text">
                <span className="pp-person-name">
                  {l.name} · {l.hours} h · {dateLabel(l.date)}
                </span>
                <span className="pp-person-sub">
                  {KIND[l.kind] ?? l.kind} · {l.source === 'cms' ? 'CMS roster' : 'Claimed'} · {l.reason}
                </span>
                {l.decided && <span className="pp-person-why">{l.decided.by}: {l.decided.note}</span>}
                {l.paidIn && <span className="pp-person-why">Paid in payroll {l.paidIn}</span>}
              </div>
              <Chip tone={TONE[l.status]}>{STATUS[l.status]}</Chip>
              {data.canDecide && l.status === 'pending' && (
                <div className="pp-inline-form">
                  <input className="input" aria-label={`Reason for ${l.name}`} placeholder="Reason" value={notes[l.id] ?? ''} onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} />
                  <button className="btn btn-sm btn-primary" disabled={act.busy || (notes[l.id] ?? '').trim().length < 3} onClick={() => go('ot-decide', { id: l.id, decision: 'approve', note: notes[l.id] }, 'Approved. It is paid in the next payroll prepared.')}>
                    Approve
                  </button>
                  <button className="btn btn-sm" disabled={act.busy || (notes[l.id] ?? '').trim().length < 3} onClick={() => go('ot-decide', { id: l.id, decision: 'refuse', note: notes[l.id] }, 'Refused. It is never paid.')}>
                    Refuse
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{data.canDecide ? 'No overtime waiting for you.' : 'No overtime claimed yet.'}</p>
      )}
      <ErrorNotice error={act.error} />
    </section>
  );
}
